/**
 * WasmEngine：KataGo WebAssembly 引擎（浏览器内运行）。
 *
 * 架构：Web Worker 持久化 Emscripten Module 实例。
 * - init: 下载模型 + import katago.js + createModule + FS.writeFile（仅一次）
 * - analyze: 每次 callMain 运行一次 KataGo main()（2-5s，NN 初始化无法跳过）
 *
 * 模型从 GitHub Release 下载并缓存到 Cache API。
 * 后续分析无需重新下载模型、import JS 或写入 MEMFS。
 *
 * 消息协议（与 Web Worker 通信）：
 *   主线程 → Worker：
 *     { type: 'init', modelData: ArrayBuffer, configData: ArrayBuffer }
 *     { type: 'analyze', id: string, query: object }
 *   Worker → 主线程：
 *     { type: 'ready' }
 *     { type: 'result', id: string, data: object }
 *     { type: 'error', id: string, message: string }
 *     { type: 'progress', text: string }
 */
import type {
  AnalysisResult,
  Candidate,
  EngineInfo,
  GenmoveResult,
  GoEngine,
} from './types'
import type { Player } from '../lib/types'
import { kyuRankFor, type AIStrengthId } from '../lib/strength'
import { useSettingsStore, type WasmModelId } from '../stores/settingsStore'
import { boardFromMoves, selectBlindedMove } from '../lib/rankInjection'

/** 各模型对应的文件名（同源 /wasm/ 目录；模型收敛后仅 b6c96） */
const MODEL_FILES: Record<WasmModelId, string> = {
  b6c96: 'b6c96.bin.gz',
}

/**
 * 盲注错误注入档位的搜索量上限（对弈统一低搜索量）：
 * 盲注选点只看 policy（1 visit 即有完整 policy），visits 只影响耗时——
 * 19 路约 2~6s 搜索 + 3~5s 重建 ≈ 每手 5~11s。可调。
 */
const INJECTION_MAX_VISITS = 32
/** 注入档每手时间兜底（秒，KataGo maxTime 官方参数，先到者停） */
const INJECTION_MAX_TIME = 20

// ─── GTP 坐标转换 ───────────────────────────────────────────────

/** GTP 坐标（如 "Q16"）转内部 [x, y] 坐标。注意 GTP 跳过 I 列。 */
function gtpToVertex(
  coord: string,
  boardSize: number,
): [number, number] | null {
  if (!coord || coord === 'pass' || coord === 'resign') return null
  const colChar = coord.charCodeAt(0)
  let x = colChar - 65 // 'A' = 0
  if (colChar > 73) x-- // 跳过 'I'
  const y = boardSize - parseInt(coord.slice(1), 10)
  return [x, y]
}

// ─── 下载辅助 ────────────────────────────────────────────────────

/** 带进度回调的下载 */
async function downloadWithProgress(
  url: string,
  onProgress: (pct: number) => void,
): Promise<ArrayBuffer> {
  const resp = await fetch(url)
  if (!resp.ok) {
    throw new Error(`下载失败 ${url}: HTTP ${resp.status}`)
  }
  const contentLength = resp.headers.get('content-length')
  const total = contentLength ? parseInt(contentLength, 10) : 0
  const reader = resp.body!.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    if (total > 0) {
      // content-length 是传输压缩后的大小，而 body 流是解压后的字节，
      // received 可能超过 total，进度需封顶在 100 避免溢出
      onProgress(Math.min(100, Math.round((received / total) * 100)))
    }
  }
  // 合并 chunks
  const buf = new Uint8Array(received)
  let pos = 0
  for (const chunk of chunks) {
    buf.set(chunk, pos)
    pos += chunk.length
  }
  return buf.buffer
}

// ─── WasmEngine ──────────────────────────────────────────────────

export class WasmEngine implements GoEngine {
  private worker: Worker | null = null
  private ready = false
  private benchmarkScore = -1
  /** 本局 AI 档位（setStrength 传入；盲注错误注入仅对 WASM 简化档生效） */
  private strengthId: AIStrengthId | null = null
  private pendingRequests = new Map<
    string,
    {
      resolve: (v: unknown) => void
      reject: (e: Error) => void
      onSnapshot?: (result: AnalysisResult) => void
      boardSize: number
    }
  >()
  private requestId = 0
  /** init 的 reject（onerror 兜底时使用，init 完成后置空） */
  private initReject: ((e: Error) => void) | null = null
  /** init/initModel 的去重：并发调用共享同一个初始化 Promise */
  private initPromise: Promise<void> | null = null

  /** 按设置中的当前模型初始化 */
  async init(onProgress?: (msg: string, pct?: number) => void): Promise<void> {
    return this.initModel(useSettingsStore.getState().wasmModel, onProgress)
  }

  /** 指定模型初始化（影子引擎预载另一模型用） */
  async initModel(
    model: WasmModelId,
    onProgress?: (msg: string, pct?: number) => void,
  ): Promise<void> {
    // 幂等：已就绪或正在初始化时不重复创建 Worker/Module
    if (this.ready && this.worker) {
      console.log('[WasmEngine] 已就绪，跳过重复初始化')
      return
    }
    if (this.initPromise) {
      return this.initPromise
    }
    this.initPromise = this.doInit(model, onProgress).finally(() => {
      this.initPromise = null
    })
    return this.initPromise
  }

  private async doInit(
    model: WasmModelId,
    onProgress?: (msg: string, pct?: number) => void,
  ): Promise<void> {
    const report = (msg: string, pct?: number) => {
      console.log(`[WasmEngine] ${msg}`)
      onProgress?.(msg, pct)
    }

    // 模型 URL（随模型动态变化，缓存按 URL 隔离）
    const modelUrl = `${import.meta.env.BASE_URL}wasm/${MODEL_FILES[model]}`

    // 1. 下载模型（优先从 Cache API）——占 0~60%
    const cache = await caches.open('katago-model')
    let modelData: ArrayBuffer
    const cached = await cache.match(modelUrl)
    if (cached) {
      report('使用缓存模型', 35)
      modelData = await cached.arrayBuffer()
    } else {
      report('下载模型中...', 5)
      modelData = await downloadWithProgress(modelUrl, (pct) => {
        // pct 为 0~100 的下载进度，映射到 5~60 的初始化进度段
        report('下载模型中...', 5 + Math.round(pct * 0.55))
      })
      await cache.put(modelUrl, new Response(modelData))
      report('模型已缓存', 60)
    }

    // 2. 加载分析配置——60~75%
    report('加载分析配置...', 70)
    const configResp = await fetch(`${import.meta.env.BASE_URL}wasm/analysis.cfg`)
    if (!configResp.ok) {
      throw new Error(`加载分析配置失败: HTTP ${configResp.status}`)
    }
    const configText = await configResp.text()
    const configData = new TextEncoder().encode(configText).buffer

    // 3. 创建 Worker（若存在旧 Worker 先销毁，避免重复实例）——75~90%
    report('启动引擎...', 85)
    this.worker?.terminate()
    this.pendingRequests.clear()
    this.worker = new Worker(
      new URL('../workers/katago.worker.ts', import.meta.url),
      { type: 'module' },
    )

    // 4. 监听 Worker 消息
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Worker 创建失败'))
        return
      }
      this.initReject = reject

      this.worker.onmessage = (e: MessageEvent) => {
        const { type, id, data, message, text } = e.data

        // 中间快照：增量渲染用，不删除 pending，继续等最终 result
        if (type === 'snapshot' && id && this.pendingRequests.has(id)) {
          const pending = this.pendingRequests.get(id)!
          pending.onSnapshot?.(
            this.parseAnalysisResult(
              pending.boardSize,
              data as Record<string, unknown>,
            ),
          )
          return
        }

        // 分析请求结果通过 pendingRequests 路由
        if (id && this.pendingRequests.has(id)) {
          const pending = this.pendingRequests.get(id)!
          this.pendingRequests.delete(id)
          if (type === 'result') {
            pending.resolve(data)
          } else if (type === 'error') {
            pending.reject(new Error(message ?? '分析失败'))
          }
          return
        }

        // 初始化阶段消息
        if (type === 'ready') {
          this.ready = true
          this.initReject = null
          onProgress?.('引擎就绪', 100)
          console.log('[WasmEngine] 就绪')
          resolve()
        } else if (type === 'error') {
          const err = new Error(message ?? '初始化失败')
          this.initReject = null
          reject(err)
        } else if (type === 'progress') {
          console.log('[WasmEngine]', text ?? data)
        }
      }

      // Worker 崩溃/脚本错误：统一兜底（init 与所有进行中的分析请求）
      this.worker.onerror = (err) => {
        const e = new Error(`Worker 错误: ${err.message}`)
        this.ready = false
        for (const [, p] of this.pendingRequests) p.reject(e)
        this.pendingRequests.clear()
        this.initReject?.(e)
        this.initReject = null
      }

      // 5. 发送初始化命令（传递所有权，避免主线程复制大 ArrayBuffer）
      this.worker.postMessage(
        { type: 'init', modelData, configData },
        [modelData, configData],
      )
    })
  }

  isReady(): boolean {
    return this.ready
  }

  getInfo(): EngineInfo {
    return {
      source: 'browser',
      model: useSettingsStore.getState().wasmModel,
      ready: this.ready,
      benchmarkScore: this.benchmarkScore,
    }
  }

  setBenchmarkScore(score: number): void {
    this.benchmarkScore = score
  }

  async analyze(
    query: {
      boardSize: number
      komi: number
      maxVisits: number
      /** 搜索时间上限（秒，KataGo maxTime，与 maxVisits 先到者停） */
      maxTime?: number
      moves: [string, [number, number] | null][]
    },
    onSnapshot?: (result: AnalysisResult) => void,
  ): Promise<AnalysisResult> {
    this.ensureReady()
    const id = String(++this.requestId)

    /** 内部坐标 → GTP 坐标（大写，跳过 I 列，行号从底部起） */
    const toGtp = ([x, y]: [number, number], bs: number): string => {
      const col = x >= 8 ? x + 1 : x // 跳过 I
      const row = bs - y
      return `${String.fromCharCode(65 + col)}${row}`
    }

    const wasmQuery = {
      id,
      moves: query.moves.map(([color, vertex]) =>
        vertex
          ? [color, toGtp(vertex, query.boardSize)]
          : [color, ''],
      ),
      rules: 'chinese',
      boardXSize: query.boardSize,
      boardYSize: query.boardSize,
      komi: query.komi,
      maxVisits: query.maxVisits,
      // 搜索时间上限（秒）：与 maxVisits 先到者停，防止慢设备卡死
      ...(query.maxTime != null ? { maxTime: query.maxTime } : {}),
      includeOwnership: true, // 地盘预测（实地/虚地渐变显示需要）
      includePolicy: true, // 完整 policy 数组（盲注错误注入选点需要）
      reportDuringSearchEvery: 1.0, // 搜索期间每秒输出一次中间态（增量渲染用）
    }

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: (rawData: unknown) => {
          resolve(
            this.parseAnalysisResult(
              query.boardSize,
              rawData as Record<string, unknown>,
            ),
          )
        },
        reject,
        onSnapshot,
        boardSize: query.boardSize,
      })
      this.worker!.postMessage({ type: 'analyze', id, query: wasmQuery })
    })
  }

  /** 将 KataGo 分析引擎响应解析为 AnalysisResult */
  private parseAnalysisResult(
    boardSize: number,
    data: Record<string, unknown>,
  ): AnalysisResult {
    const moveInfos = (data.moveInfos ?? []) as Array<{
      move?: string
      order?: number
      winrate?: number
      scoreLead?: number
      visits?: number
      prior?: number
      pv?: string[]
    }>

    const rootInfo = data.rootInfo as
      | { winrate?: number; scoreLead?: number; currentPlayer?: string }
      | undefined

    // KataGo 按 reportAnalysisWinratesAs=BLACK 以黑方胜率输出。
    // 转换为当前玩家视角，避免轮到白棋时棋盘/解说显示黑方胜率造成误导。
    const flip = rootInfo?.currentPlayer === 'W'
    const toPlayerView = (v: number | null | undefined): number | null =>
      v == null ? null : flip ? 1 - v : v

    const candidates: Candidate[] = moveInfos.map((info) => ({
      move: gtpToVertex(info.move ?? '', boardSize),
      winrate: toPlayerView(info.winrate),
      scoreLead: info.scoreLead ?? null,
      visits: info.visits ?? null,
      prior: info.prior ?? null,
      pv: (info.pv ?? [])
        .map((m) => gtpToVertex(m, boardSize))
        .filter((v): v is [number, number] => v !== null),
    }))

    return {
      boardSize,
      candidates,
      root: {
        winrate: toPlayerView(rootInfo?.winrate) ?? undefined,
        scoreLead: rootInfo?.scoreLead,
      },
      // KataGo 把 ownership 放在响应顶层，不在 rootInfo 里
      ownership: (data.ownership as number[] | undefined) ?? null,
      // includePolicy 输出完整 policy（row-major，末位 pass）；盲注选点用
      policy: (data.policy as number[] | undefined) ?? null,
    }
  }

  async genmove(
    color: Player,
    boardSize: number,
    komi: number,
    maxVisits: number,
    moves: [string, [number, number] | null][],
  ): Promise<GenmoveResult> {
    console.log('[WasmEngine] genmove 开始, moves:', moves.length)

    // KaTrain 式盲注错误注入：WASM 19 路对弈档位（am20k~am5d，kyuRank 由 id 推导）
    // 落子时从随机抽样的 n_moves 个合法点中选 policy 最高者，棋力精确等于对应级别
    // （纯 visits 压不下棋力，见 backend/calibration/2026-08-01-p7b.md 结论 4）。
    // 9/13 路不注入：盲注公式按 19 路校准，小棋盘失真（保持纯 visits 体系）。
    const kyuRank = boardSize === 19 ? kyuRankFor(this.strengthId) : null
    const injecting = kyuRank != null
    // 注入档：选点只看 policy（1 visit 即有完整 policy），visits 只影响耗时——
    // 统一低搜索量 + maxTime 兜底，任意档位每手约 5~11s（先 clamp 再分析，
    // 避免先按档位大 visits 跑满搜索浪费等待时间）
    const effectiveVisits = injecting
      ? Math.min(maxVisits, INJECTION_MAX_VISITS)
      : maxVisits
    const result = await this.analyze({
      boardSize,
      komi,
      maxVisits: effectiveVisits,
      maxTime: injecting ? INJECTION_MAX_TIME : undefined,
      moves,
    })
    console.log('[WasmEngine] genmove 分析完成, candidates:', result.candidates.length)

    if (injecting && result.policy && result.policy.length > 0) {
      const picked = selectBlindedMove({
        boardSize,
        kyuRank,
        policy: result.policy,
        board: boardFromMoves(moves, boardSize),
        player: color,
      })
      console.log('[WasmEngine] genmove 盲注选点:', picked.reason, picked.vertex)
      return {
        vertex: picked.vertex,
        coord: picked.vertex
          ? `${String.fromCharCode(
              65 + (picked.vertex[0] >= 8 ? picked.vertex[0] + 1 : picked.vertex[0]),
            )}${boardSize - picked.vertex[1]}`
          : null,
      }
    }

    const best = result.candidates[0]
    console.log('[WasmEngine] genmove best move:', best?.move)
    return {
      vertex: best?.move ?? null,
      coord: best?.move
        ? `${String.fromCharCode(
            65 + (best.move[0] >= 8 ? best.move[0] + 1 : best.move[0]),
          )}${boardSize - best.move[1]}`
        : null,
    }
  }

  destroy(): void {
    this.worker?.terminate()
    this.worker = null
    this.ready = false
    this.benchmarkScore = -1 // 模型已变，旧基准作废
    this.initReject?.(new Error('引擎已销毁')) // 进行中的 init 立即失败
    this.initReject = null
    this.pendingRequests.clear()
  }

  setStrength(strengthId: AIStrengthId | null): void {
    // WASM 无 Human-SL 引擎；档位保存供盲注错误注入使用（强度同时由调用方按 visits 计算）
    this.strengthId = strengthId
  }

  private ensureReady(): void {
    if (!this.ready) {
      throw new Error('WASM 引擎未就绪，请等待初始化完成')
    }
  }
}

export const wasmEngine = new WasmEngine()
