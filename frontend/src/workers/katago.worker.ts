/**
 * KataGo WASM Web Worker（toyoshi/katago-wasm 构建）。
 *
 * 消息协议：
 *   主线程 → Worker:
 *     { type: 'init', modelData: ArrayBuffer, configData: ArrayBuffer }
 *     { type: 'analyze', id: string, query: object }
 *
 *   Worker → 主线程:
 *     { type: 'progress', text: string }
 *     { type: 'ready' }
 *     { type: 'result', id: string, data: object }
 *     { type: 'error', id: string, message: string }
 *
 * 依赖：frontend/public/wasm/katago.js（toyoshi/katago-wasm ES6 modular 构建）
 *
 * 架构说明（重要）：
 *   本构建为 PROXY_TO_PTHREAD 模式，存在两个硬性限制，无法做到"常驻引擎"：
 *   1. callMain 只能调用一次：__emscripten_proxy_main 把 main 派发到 pthread，
 *      main 返回（runtime exit）后线程不可复用，二次 callMain 会永久卡死。
 *   2. stdin 读取被 Emscripten 代理回主线程执行（实测 self.name=''），
 *      同步阻塞 stdin（如 Atomics.wait）会卡死主线程导致死锁，无法实现
 *      "KataGo 常驻 + 动态注入查询"。
 *
 *   因此每次分析都重建 Emscripten Module（createKataGo → FS 写入 → callMain），
 *   但保留三项缓存以降低开销：
 *     - katago.js ES module 只 import 一次（后续 createKataGo 复用命名空间）
 *     - 模型字节只下载/解压/判格一次（本 worker 内存中）
 *     - 分析请求串行排队，避免并发重建互相干扰
 *   单次分析耗时 ≈ createKataGo(~0.5-1s) + NN 初始化(文本模型 ~2s) + 搜索。
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KatagoModule = any

// ---------------------------------------------------------------------------
// Base URL for WASM resources (replaced at build time by Vite)
// ---------------------------------------------------------------------------

const WASM_BASE = import.meta.env.BASE_URL + 'wasm/'

/**
 * katago.js 的完整 URL。
 * 注意：Worker（module worker）中动态 import() 不允许 '/path' 形式的说明符
 * （主线程 HTML 页面宽松支持，worker 严格按 ESM 规范解析会报
 * "Failed to resolve module specifier"），必须使用完整 URL。
 */
const KATAGO_JS_URL = new URL(WASM_BASE + 'katago.js', self.location.origin).href

// ---------------------------------------------------------------------------
// Persistent state（init 阶段准备，分析阶段只读）
// ---------------------------------------------------------------------------

/** katago.js 的 module 命名空间（import 缓存，只加载一次） */
let katagoJsNamespace: Record<string, unknown> | null = null

/** 解压 + 格式判断后的模型字节（只准备一次） */
let modelBytes: Uint8Array | null = null

/** 模型在 MEMFS 中的文件名（含后缀，按内容判断） */
let modelFilename = '/katago/model.txt'

/** analysis.cfg 内容 */
let configBytes: Uint8Array | null = null

let ready = false

// ---------------------------------------------------------------------------
// Per-analysis state（每次 callMain 前重置）
// ---------------------------------------------------------------------------

let currentStdinBytes: Uint8Array | null = null
let currentStdinOffset = 0
let currentStdoutBuf = ''
let currentStderrBuf = ''
/** 跨 print 调用的半行缓冲（print 可能一次给多行或半行） */
let currentPendingLine = ''
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentResolve: ((v: any) => void) | null = null
let currentReject: ((e: Error) => void) | null = null
/** 当前分析请求 id（用于异步错误上报） */
let currentRequestId: string | null = null

// Emscripten 的异步异常（如 pthread 代理的 CppException）无法被 try/catch 捕获，
// 会触发 unhandledrejection / error 事件。KataGo 抛出异常前会先向 stderr 打印
// 详细原因（模型/配置/内存问题等），这里兜底上报给主线程。
self.addEventListener('unhandledrejection', (e) => {
  const reason = (e as PromiseRejectionEvent).reason
  const stderrTail = currentStderrBuf.trim().slice(-500)
  self.postMessage({
    type: 'error',
    id: currentRequestId ?? '',
    message:
      `引擎内部错误: ${fmtErr(reason)}` +
      (stderrTail ? ' — 引擎输出: ' + stderrTail : ''),
  })
})

self.addEventListener('error', (e) => {
  const msg = (e as ErrorEvent).message || String(e)
  const stderrTail = currentStderrBuf.trim().slice(-500)
  self.postMessage({
    type: 'error',
    id: currentRequestId ?? '',
    message:
      `引擎异常: ${msg}` + (stderrTail ? ' — 引擎输出: ' + stderrTail : ''),
  })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 在字节数组中查找子串（KataGo 二进制模型魔数 "@BIN@"） */
function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer
    }
    return i
  }
  return -1
}

/**
 * 解压 gzip 数据（若数据以 gzip 魔数开头）。
 * 生产环境静态托管若不对 .gz 设 Content-Encoding，Worker 收到的就是原始
 * gzip 字节，需要在此解压；dev 下浏览器已自动解压，此分支不会执行。
 */
async function gunzipIfNeeded(data: Uint8Array): Promise<Uint8Array> {
  if (data.length < 2 || data[0] !== 0x1f || data[1] !== 0x8b) {
    return data
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const DS: any = (self as unknown as { DecompressionStream?: any }).DecompressionStream
  if (!DS) {
    throw new Error('当前环境不支持 DecompressionStream，无法解压 gzip 模型')
  }
  // 拷贝到独立的 ArrayBuffer（避免 SharedArrayBuffer 类型问题）
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  const stream = new Blob([copy.buffer])
    .stream()
    .pipeThrough(new DS('gzip'))
  const ab = await new Response(stream).arrayBuffer()
  return new Uint8Array(ab)
}

/** 将任意异常转换为可读字符串（Emscripten 可能抛出非 Error 对象） */
function fmtErr(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`
  try {
    const s = JSON.stringify(e)
    if (s && s !== '{}') return s
  } catch {
    // fall through
  }
  return String(e)
}

/**
 * 从 stdout 中解析出最后一个包含 moveInfos/rootInfo 的 JSON 对象
 * （KataGo 搜索期间会周期性输出同一 query 的中间态，最后一行才是终态）。
 * 跳过引擎日志等非 JSON 行。遇到 error 字段抛出异常。
 */
function parseStdout(
  stdoutBuffer: string,
  stderrBuffer: string,
): Record<string, unknown> {
  const lines = stdoutBuffer.split('\n')
  let last: Record<string, unknown> | null = null
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      if (typeof parsed.error === 'string' && parsed.error !== '') {
        throw new Error(parsed.error)
      }
      if (parsed.moveInfos || parsed.rootInfo) {
        last = parsed
      }
    } catch (e) {
      if (e instanceof SyntaxError) continue
      throw e
    }
  }
  if (last) return last

  const detail = stderrBuffer.trim()
  throw new Error(`未收到分析结果${detail ? ' — ' + detail : ''}`)
}

/**
 * 处理一行完整 stdout：若为分析结果 JSON（含 moveInfos/rootInfo 且无 error），
 * 作为中间快照上报给主线程（不区分搜索中间态/终态，终态由 result 消息单独给出）。
 */
function emitSnapshotIfAnalysis(line: string): void {
  if (!line) return
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(line) as Record<string, unknown>
  } catch {
    return // 非 JSON 行（引擎日志等），忽略
  }
  if (typeof parsed.error === 'string' && parsed.error !== '') return
  if (parsed.moveInfos || parsed.rootInfo) {
    self.postMessage({
      type: 'snapshot',
      id: currentRequestId ?? '',
      data: parsed,
    })
  }
}

// ---------------------------------------------------------------------------
// Module lifecycle
// ---------------------------------------------------------------------------

/** import katago.js（只执行一次，ES module 缓存） */
async function getKatagoJs(): Promise<Record<string, unknown>> {
  if (katagoJsNamespace) return katagoJsNamespace
  // 绕过 Vite 的 import 拦截，用原生 import() 加载 public/ 下的 katago.js
  const rawImport = new Function('url', 'return import(url)')
  let katagoMod: Record<string, unknown>
  try {
    katagoMod = await rawImport(KATAGO_JS_URL)
  } catch (err) {
    throw new Error(
      `katago.js 加载失败: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  katagoJsNamespace = katagoMod
  return katagoMod
}

/** 创建一次性的 Emscripten Module 实例（每次分析重建） */
async function createFreshModule(): Promise<KatagoModule> {
  const katagoMod = await getKatagoJs()
  const createKataGo =
    (katagoMod as Record<string, unknown>).createKataGo ||
    (katagoMod as Record<string, unknown>).default

  if (typeof createKataGo !== 'function') {
    throw new Error('katago.js 未导出 createKataGo 工厂函数')
  }

  currentStdoutBuf = ''
  currentStderrBuf = ''
  currentPendingLine = ''

  try {
    return (createKataGo as (opts: Record<string, unknown>) => Promise<Record<string, unknown>>)({
      locateFile: (path: string) =>
        new URL(WASM_BASE + path, self.location.origin).href,
      noInitialRun: true,

      // stdin: 本次分析的查询 JSON，读完返回 null（EOF）触发引擎退出
      stdin: () => {
        if (!currentStdinBytes || currentStdinOffset >= currentStdinBytes.length) {
          return null // EOF
        }
        return currentStdinBytes[currentStdinOffset++]
      },

      print: (text: string) => {
        // Emscripten TTY 按行回调：每次 print 收到一整行（且不含结尾换行符，
        // put_char 在遇到 \n 时先 out() 输出行内容、不把 \n 传入）。
        // 必须补 '\n'，否则 stdout 缓冲无换行 → parseStdout 的 split('\n')
        // 会把多条响应拼成一条非法 JSON（多行输出时"未收到分析结果"），
        // 且 currentPendingLine 永远拼不出完整行 → 中间态快照无法上报（无流式）。
        currentStdoutBuf += text + '\n'
        currentPendingLine += text + '\n'
        let nl: number
        while ((nl = currentPendingLine.indexOf('\n')) >= 0) {
          const line = currentPendingLine.slice(0, nl).trim()
          currentPendingLine = currentPendingLine.slice(nl + 1)
          if (line) emitSnapshotIfAnalysis(line)
        }
      },

      printErr: (text: string) => {
        currentStderrBuf += text
      },

      onExit: (code: number) => {
        if (!currentResolve || !currentReject) return

        if (code !== 0) {
          const detail = currentStderrBuf.trim()
          currentReject(
            new Error(`引擎退出码 ${code}${detail ? ': ' + detail : ''}`),
          )
          currentResolve = null
          currentReject = null
          return
        }

        try {
          // 兜底：flush 无换行的残行（通常为空，防御 print 不补 \n 的情形）
          const tail = currentPendingLine.trim()
          if (tail) emitSnapshotIfAnalysis(tail)
          const result = parseStdout(currentStdoutBuf, currentStderrBuf)
          currentResolve(result)
        } catch (e) {
          currentReject(e instanceof Error ? e : new Error(String(e)))
        }
        currentResolve = null
        currentReject = null
      },
    })
  } catch (err) {
    const detail = currentStderrBuf.trim()
    throw new Error(
      `KataGo WASM 初始化失败${detail ? ' — ' + detail : ''}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
}

/** 将模型与配置写入新建 Module 的 MEMFS */
function prepareFs(module: KatagoModule): void {
  if (!modelBytes || !configBytes) {
    throw new Error('模型数据未就绪')
  }
  try {
    try {
      module.FS.mkdir('/katago')
    } catch {
      // 目录已存在则忽略
    }
    module.FS.writeFile(modelFilename, modelBytes)
    module.FS.writeFile('/katago/analysis.cfg', configBytes)
  } catch (err) {
    throw new Error(`写入模型到 MEMFS 失败: ${fmtErr(err)}`)
  }
}

/**
 * 执行一次完整分析：重建 Module → 写 FS → callMain → 等待 onExit。
 * 必须在串行队列中调用（同一时刻只有一个 callMain）。
 */
async function runAnalysis(
  query: Record<string, unknown>,
  id: string,
): Promise<Record<string, unknown>> {
  currentRequestId = id
  const queryJson = JSON.stringify(query) + '\n'
  currentStdinBytes = new TextEncoder().encode(queryJson)
  currentStdinOffset = 0
  currentStdoutBuf = ''
  currentStderrBuf = ''
  currentPendingLine = ''

  const module = await createFreshModule()
  prepareFs(module)

  self.postMessage({
    type: 'progress',
    text: `运行分析 (maxVisits: ${String(query.maxVisits ?? query.max_visits ?? '?')})...`,
  })

  const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
    currentResolve = resolve
    currentReject = reject

    try {
      module.callMain([
        'analysis',
        '-model',
        modelFilename,
        '-config',
        '/katago/analysis.cfg',
      ])
    } catch (callErr) {
      // callMain 抛出 CppException（C++ 异常）或 Emscripten 错误，
      // KataGo 的错误详情已在 stderr 中，由外层 catch 拼接返回
      reject(callErr instanceof Error ? callErr : new Error(String(callErr)))
    }
  })

  return result
}

// ---------------------------------------------------------------------------
// Message handler（串行队列）
// ---------------------------------------------------------------------------

/** 分析请求串行队列：同一时刻只有一个 callMain 在跑 */
let analysisChain: Promise<unknown> = Promise.resolve()

self.onmessage = async (e: MessageEvent) => {
  const { type } = e.data as {
    type: string
    id?: string
    [k: string]: unknown
  }

  // ----- init -----
  if (type === 'init') {
    try {
      const { modelData, configData } = e.data as {
        modelData?: ArrayBuffer
        configData?: ArrayBuffer
      }

      if (!modelData || !configData) {
        throw new Error('缺少模型或配置数据')
      }

      currentRequestId = null

      self.postMessage({ type: 'progress', text: '准备模型数据...' })

      // 1) 统一为未压缩内容（生产环境若传来原始 gzip 字节则在此解压）
      const bytes = await gunzipIfNeeded(new Uint8Array(modelData))
      // 2) 按内容判断格式：含 "@BIN@" 魔数 → 二进制 .bin；否则 → 文本 .txt
      const binMagic = new TextEncoder().encode('@BIN@')
      modelFilename =
        indexOfBytes(bytes, binMagic) >= 0
          ? '/katago/model.bin'
          : '/katago/model.txt'
      modelBytes = bytes
      configBytes = new Uint8Array(configData)

      // 3) 预热：真实跑一次最小查询，验证模型/配置可加载
      self.postMessage({ type: 'progress', text: '引擎预热中（首次约需数秒）...' })
      await analysisChain
      analysisChain = analysisChain.then(() =>
        runAnalysis(
          {
            id: 'warmup',
            moves: [],
            rules: 'chinese',
            boardXSize: 9,
            boardYSize: 9,
            komi: 7.5,
            maxVisits: 1,
          },
          '',
        ),
      )
      await analysisChain
      currentRequestId = null

      ready = true
      self.postMessage({
        type: 'progress',
        text: '引擎就绪（每次分析约 3-5 秒）',
      })
      self.postMessage({ type: 'ready' })
    } catch (err) {
      self.postMessage({
        type: 'error',
        id: '',
        message: `初始化失败: ${fmtErr(err)}`,
      })
    }
    return
  }

  // ----- analyze -----
  if (type === 'analyze') {
    const msg = e.data as { id: string; query: Record<string, unknown> }

    if (!ready || !modelBytes || !configBytes) {
      self.postMessage({
        type: 'error',
        id: msg.id,
        message: '引擎未初始化',
      })
      return
    }

    // 串行队列：前一次分析（含 Module 重建）结束后再启动下一次
    const run = analysisChain.then(async () => {
      try {
        const result = await runAnalysis(msg.query, msg.id)
        self.postMessage({ type: 'result', id: msg.id, data: result })
      } catch (err) {
        const stderrTail = currentStderrBuf.trim().slice(-500)
        self.postMessage({
          type: 'error',
          id: msg.id,
          message:
            fmtErr(err) + (stderrTail ? ' — 引擎输出: ' + stderrTail : ''),
        })
      }
    })
    // 确保队列异常不会中断后续请求
    analysisChain = run.catch(() => {})
    return
  }
}

// 满足 TypeScript 的 isolatedModules 要求
export {}
