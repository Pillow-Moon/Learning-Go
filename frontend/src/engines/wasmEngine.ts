/**
 * WasmEngine：KataGo WebAssembly 引擎（浏览器内运行）。
 *
 * 通过 Web Worker 加载 katago.wasm + 模型，收发 analysis JSON 协议。
 * 模型从 GitHub Release 下载并缓存到 Cache API。
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

/** 模型 CDN URL（b10c384h6，38MB，从 GitHub Release 获取） */
const MODEL_URL =
  'https://github.com/lightvector/KataGo/releases/download/v1.17.0/b10c384h6nbttflrs.bin.gz'

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
      onProgress(Math.round((received / total) * 100))
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
  private pendingRequests = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >()
  private requestId = 0

  async init(): Promise<void> {
    // 1. 下载模型（优先从 Cache API）
    const cache = await caches.open('katago-model')
    let modelData: ArrayBuffer
    const cached = await cache.match(MODEL_URL)
    if (cached) {
      console.log('[WasmEngine] 命中缓存，使用已下载的模型')
      modelData = await cached.arrayBuffer()
    } else {
      console.log('[WasmEngine] 下载模型（~38MB）...')
      modelData = await downloadWithProgress(MODEL_URL, (pct) => {
        console.log(`[WasmEngine] 模型下载进度: ${pct}%`)
      })
      await cache.put(MODEL_URL, new Response(modelData))
      console.log('[WasmEngine] 模型已缓存')
    }

    // 2. 下载分析配置
    console.log('[WasmEngine] 加载分析配置...')
    const configResp = await fetch('/wasm/analysis.cfg')
    if (!configResp.ok) {
      throw new Error(`加载分析配置失败: HTTP ${configResp.status}`)
    }
    const configText = await configResp.text()
    const configData = new TextEncoder().encode(configText).buffer

    // 3. 创建 Worker
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

      this.worker.onmessage = (e: MessageEvent) => {
        const { type, id, data, message, text } = e.data

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
          console.log('[WasmEngine] 就绪')
          resolve()
        } else if (type === 'error') {
          reject(new Error(message ?? '初始化失败'))
        } else if (type === 'progress') {
          console.log('[WasmEngine]', text ?? data)
        }
      }

      this.worker.onerror = (err) => {
        reject(new Error(`Worker 错误: ${err.message}`))
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
      model: 'b10c384h6',
      ready: this.ready,
      benchmarkScore: this.benchmarkScore,
    }
  }

  async analyze(query: {
    boardSize: number
    komi: number
    maxVisits: number
    moves: [string, [number, number] | null][]
  }): Promise<AnalysisResult> {
    this.ensureReady()
    const id = String(++this.requestId)
    const wasmQuery = {
      id,
      moves: query.moves.map(([color, vertex]) => {
        const v = vertex
          ? [vertex[0], query.boardSize - 1 - vertex[1]]
          : null
        return v
          ? [
              color,
              `${String.fromCharCode(97 + v[0])}${String.fromCharCode(97 + v[1])}`,
            ]
          : [color, '']
      }),
      rules: 'chinese',
      boardXSize: query.boardSize,
      boardYSize: query.boardSize,
      komi: query.komi,
      maxVisits: query.maxVisits,
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

    const candidates: Candidate[] = moveInfos.map((info) => ({
      move: gtpToVertex(info.move ?? '', boardSize),
      winrate: info.winrate ?? null,
      scoreLead: info.scoreLead ?? null,
      visits: info.visits ?? null,
      prior: info.prior ?? null,
      pv: (info.pv ?? [])
        .map((m) => gtpToVertex(m, boardSize))
        .filter((v): v is [number, number] => v !== null),
    }))

    const rootInfo = data.rootInfo as
      | { winrate?: number; scoreLead?: number }
      | undefined

    return {
      boardSize,
      candidates,
      root: {
        winrate: rootInfo?.winrate,
        scoreLead: rootInfo?.scoreLead,
      },
    }
  }

  async genmove(
    _color: Player,
    boardSize: number,
    komi: number,
    maxVisits: number,
    moves: [string, [number, number] | null][],
  ): Promise<GenmoveResult> {
    // WASM 引擎通过 analysis 模式实现 genmove（取 top-1 候选）
    const result = await this.analyze({ boardSize, komi, maxVisits, moves })
    const best = result.candidates[0]
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
    this.pendingRequests.clear()
  }

  private ensureReady(): void {
    if (!this.ready) {
      throw new Error('WASM 引擎未就绪，请等待初始化完成')
    }
  }
}

export const wasmEngine = new WasmEngine()
