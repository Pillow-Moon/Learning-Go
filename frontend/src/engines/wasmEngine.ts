/**
 * WasmEngine：KataGo WebAssembly 引擎（浏览器内运行）。
 *
 * 当前为占位实现。WASM 编译需要 Linux + Emscripten 环境，
 * 后续编译完成后替换此文件。
 *
 * 消息协议（与 Web Worker 通信）：
 *   主线程 → Worker：{ type: 'init' | 'analyze' | 'genmove', ... }
 *   Worker → 主线程：{ type: 'ready' | 'result' | 'error', ... }
 */
import type {
  AnalysisResult,
  EngineInfo,
  GenmoveResult,
  GoEngine,
} from './types'
import type { Player } from '../lib/types'

export class WasmEngine implements GoEngine {
  private ready = false
  private benchmarkScore = -1

  async init(): Promise<void> {
    // TODO: 创建 Web Worker，加载 katago.wasm + 模型
    // const worker = new Worker(
    //   new URL('../workers/katago.worker.ts', import.meta.url),
    //   { type: 'module' },
    // )
    throw new Error(
      'WASM 引擎暂未编译。请使用本地 GPU 引擎（LocalEngine）：' +
        '启动后端后，在设置中将引擎来源切换为 "Local GPU"。',
    )
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

  async analyze(): Promise<AnalysisResult> {
    throw new Error('WASM 引擎未实现')
  }

  async genmove(
    _color: Player,
    _boardSize: number,
    _komi: number,
    _maxVisits: number,
    _moves: [string, [number, number] | null][],
  ): Promise<GenmoveResult> {
    throw new Error('WASM 引擎未实现')
  }

  destroy(): void {
    this.ready = false
  }
}

export const wasmEngine = new WasmEngine()
