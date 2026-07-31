/**
 * WasmEngine：KataGo WebAssembly 引擎（浏览器内运行）。
 *
 * 通过 Web Worker 加载 katago.wasm + 模型，收发 analysis JSON 协议。
 * 模型从 CDN 下载并缓存到 IndexedDB。
 *
 * 消息协议（与 Web Worker 通信）：
 *   主线程 → Worker：
 *     { type: 'init', wasmUrl, modelUrl }
 *     { type: 'analyze', id, query }
 *   Worker → 主线程：
 *     { type: 'ready' }
 *     { type: 'result', id, data }
 *     { type: 'error', id, message }
 *     { type: 'progress', text }
 */
import type {
  AnalysisResult,
  EngineInfo,
  GenmoveResult,
  GoEngine,
} from './types'
import type { Player } from '../lib/types'

/** 模型 CDN URL（b10c384h6，38MB，从 GitHub Release 获取） */
const MODEL_URL =
  'https://github.com/lightvector/KataGo/releases/download/v1.17.0/b10c384h6nbttflrs.bin.gz'

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
    // 创建 Worker
    this.worker = new Worker(
      new URL('../workers/katago.worker.ts', import.meta.url),
      { type: 'module' },
    )

    // 监听 Worker 消息
    this.worker.onmessage = (e: MessageEvent) => {
      const { type, id, data, message } = e.data
      if (type === 'ready') {
        this.ready = true
        console.log('[WasmEngine] 就绪')
        return
      }
      if (type === 'progress') {
        console.log('[WasmEngine]', message)
        return
      }
      const pending = this.pendingRequests.get(id)
      if (!pending) return
      this.pendingRequests.delete(id)
      if (type === 'result') {
        pending.resolve(data)
      } else {
        pending.reject(new Error(message ?? '未知错误'))
      }
    }

    // 向 Worker 发送初始化命令
    return new Promise((resolve, reject) => {
      const id = String(++this.requestId)
      this.pendingRequests.set(id, {
        resolve: () => {
          this.ready = true
          resolve()
        },
        reject,
      })
      // 临时用 ready 事件来 resolve
      this.worker!.onmessage = (e: MessageEvent) => {
        if (e.data.type === 'ready') {
          this.ready = true
          this.pendingRequests.delete(id)
          resolve()
        } else if (e.data.type === 'error') {
          this.pendingRequests.delete(id)
          reject(new Error(e.data.message))
        }
      }
      this.worker!.postMessage({
        type: 'init',
        wasmUrl: new URL('../wasm/katago.js', import.meta.url).href,
        modelUrl: MODEL_URL,
      })
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
        const v = vertex ? [vertex[0], query.boardSize - 1 - vertex[1]] : null
        return v ? [color, `${String.fromCharCode(97 + v[0])}${String.fromCharCode(97 + v[1])}`] : [color, '']
      }),
      rules: 'chinese',
      boardXSize: query.boardSize,
      boardYSize: query.boardSize,
      komi: query.komi,
      maxVisits: query.maxVisits,
    }
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.worker!.postMessage({ type: 'analyze', id, query: wasmQuery })
    }) as Promise<AnalysisResult>
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
        ? `${String.fromCharCode(65 + (best.move[0] >= 8 ? best.move[0] + 1 : best.move[0]))}${boardSize - best.move[1]}`
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
