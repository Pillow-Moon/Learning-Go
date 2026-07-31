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
 * 架构说明：
 *   每次分析请求独立加载 WASM 模块、写入 MEMFS、调用 callMain、
 *   收集 stdout 后返回原始 KataGo JSON（坐标转换由 wasmEngine.ts 负责）。
 *   避免 PROXY_TO_PTHREAD 下持久化 stdin pipe 的复杂度。
 *
 *   模型与配置文件在 init 阶段传入并保存在 Worker 内存中，
 *   后续每次分析复用，无需重新下载。
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KatagoModule = any

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let modelBuffer: ArrayBuffer | null = null
let configBytes: Uint8Array | null = null
let ready = false

// ---------------------------------------------------------------------------
// Single-shot analysis
// ---------------------------------------------------------------------------

/**
 * 加载一次 WASM 模块，执行单次分析，返回引擎原始 JSON 响应。
 */
async function runSingleAnalysis(
  modelBytes: Uint8Array,
  cfgBytes: Uint8Array,
  query: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const queryJson = JSON.stringify(query) + '\n'
  const stdinBytes = new TextEncoder().encode(queryJson)
  let stdinOffset = 0

  let stdoutBuf = ''
  let stderrBuf = ''

  return new Promise((resolve, reject) => {
    // 动态导入 katago ES6 模块（Vite 在构建时忽略此路径，运行时由浏览器解析）
    // @ts-expect-error - /wasm/katago.js is a runtime asset served from public/
    import(/* @vite-ignore */ '/wasm/katago.js')
      .then((katagoMod) => {
        // -sEXPORT_NAME=createKataGo → named export "createKataGo"
        // 某些构建可能只暴露 default
        const createKataGo =
          (katagoMod as Record<string, unknown>).createKataGo ||
          (katagoMod as Record<string, unknown>).default

        if (typeof createKataGo !== 'function') {
          reject(new Error('katago.js 未导出 createKataGo 工厂函数'))
          return
        }

        ;(createKataGo as (opts: Record<string, unknown>) => Promise<Record<string, unknown>>)({
          locateFile: (path: string) => `/wasm/${path}`,
          stdin: () => {
            if (stdinOffset < stdinBytes.length) return stdinBytes[stdinOffset++]
            return null // EOF：引擎完成当前 query 后退出
          },
          print: (text: string) => {
            stdoutBuf += text
          },
          printErr: (text: string) => {
            stderrBuf += text
          },
          onExit: (code: number) => {
            if (code !== 0) {
              const detail = stderrBuf.trim()
              reject(new Error(`引擎退出码 ${code}${detail ? ': ' + detail : ''}`))
              return
            }

            try {
              const raw = parseStdout(stdoutBuf, stderrBuf)
              resolve(raw)
            } catch (e) {
              reject(e)
            }
          },
        }).then((mod) => {
          const m = mod as KatagoModule
          // 写入模型与配置到 MEMFS
          m.FS.writeFile('/katago/model.bin.gz', modelBytes)
          m.FS.writeFile('/katago/analysis.cfg', cfgBytes)
          // 启动分析引擎（PROXY_TO_PTHREAD 下立即返回）
          m.callMain([
            'analysis',
            '-model',
            '/katago/model.bin.gz',
            '-config',
            '/katago/analysis.cfg',
          ])
        }).catch(reject)
      })
      .catch(reject)
  })
}

/**
 * 从 stdout 中解析出第一个包含 moveInfos/rootInfo 的 JSON 对象。
 * 跳过引擎日志等非 JSON 行。遇到 error 字段抛出异常。
 */
function parseStdout(
  stdoutBuffer: string,
  stderrBuffer: string,
): Record<string, unknown> {
  const lines = stdoutBuffer.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      if (typeof parsed.error === 'string' && parsed.error !== '') {
        throw new Error(parsed.error)
      }
      if (parsed.moveInfos || parsed.rootInfo) {
        return parsed
      }
    } catch (e) {
      if (e instanceof SyntaxError) continue
      throw e
    }
  }

  const detail = stderrBuffer.trim()
  throw new Error(`未收到分析结果${detail ? ' — ' + detail : ''}`)
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

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

      modelBuffer = modelData
      configBytes = new Uint8Array(configData)
      ready = true

      self.postMessage({
        type: 'progress',
        text: '模型数据已加载到 Worker',
      })
      self.postMessage({ type: 'ready' })
    } catch (err) {
      self.postMessage({
        type: 'error',
        id: '',
        message: `初始化失败: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
    return
  }

  // ----- analyze -----
  if (type === 'analyze') {
    const msg = e.data as { id: string; query: Record<string, unknown> }

    if (!ready || !modelBuffer || !configBytes) {
      self.postMessage({
        type: 'error',
        id: msg.id,
        message: '引擎未初始化',
      })
      return
    }

    const maxVisits =
      (msg.query.maxVisits as string | number) ??
      (msg.query.max_visits as string | number) ??
      '?'

    self.postMessage({
      type: 'progress',
      text: `加载 WASM 模块并运行分析 (maxVisits: ${String(maxVisits)})...`,
    })

    try {
      const result = await runSingleAnalysis(
        new Uint8Array(modelBuffer),
        configBytes,
        msg.query,
      )
      self.postMessage({ type: 'result', id: msg.id, data: result })
    } catch (err) {
      self.postMessage({
        type: 'error',
        id: msg.id,
        message: err instanceof Error ? err.message : String(err),
      })
    }
    return
  }
}

// 满足 TypeScript 的 isolatedModules 要求
export {}
