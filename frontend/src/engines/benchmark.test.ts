/**
 * runBenchmark 差分测速逻辑测试：每组采样跑 LOW/HIGH 两次分析，
 * 速度 = Δvisits / Δ耗时（固定开销被消除），按引擎来源决定采样组数。
 */
import { describe, expect, it } from 'vitest'

import { runBenchmark } from './benchmark'
import type { AnalysisResult, EngineInfo, GenmoveResult, GoEngine } from './types'
import type { Player } from '../lib/types'

/** 可控的假引擎：记录 analyze 调用次数，并按 maxVisits 模拟搜索耗时（不含固定开销） */
class FakeEngine implements GoEngine {
  analyzeCalls = 0
  ready = true
  source: 'browser' | 'local' = 'browser'
  /** 每次分析的固定开销（ms），模拟 WASM 重建 Module / 模型初始化 */
  fixedMs = 0
  /** 每 visit 模拟耗时（ms）；保持小值避免测试超时 */
  msPerVisit = 1

  async init(): Promise<void> {}
  isReady(): boolean {
    return this.ready
  }
  getInfo(): EngineInfo {
    return { source: this.source, model: 'fake', ready: this.ready, benchmarkScore: -1 }
  }
  async analyze(query: { maxVisits?: number }): Promise<AnalysisResult> {
    this.analyzeCalls++
    // 总耗时 = 固定开销 + 搜索量 × 每 visit 耗时；差分测速应消除固定开销
    await new Promise((r) =>
      setTimeout(r, this.fixedMs + (query.maxVisits ?? 0) * this.msPerVisit),
    )
    return { boardSize: 9, candidates: [], root: {} }
  }
  async genmove(
    _color: Player,
    _boardSize: number,
    _komi: number,
    _maxVisits: number,
    _moves: [string, [number, number] | null][],
  ): Promise<GenmoveResult> {
    return { vertex: null, coord: null }
  }
  setStrength(): void {}
  cancelAnalysis(): void {}
  destroy(): void {}
}

describe('runBenchmark', () => {
  it('browser（WASM）默认采样 2 组（每组 2 次分析）', async () => {
    const engine = new FakeEngine()
    await runBenchmark(engine)
    expect(engine.analyzeCalls).toBe(4)
  })

  it('local 默认采样 3 组（每组 2 次分析）', async () => {
    const engine = new FakeEngine()
    engine.source = 'local'
    await runBenchmark(engine)
    expect(engine.analyzeCalls).toBe(6)
  })

  it('显式 rounds 覆盖默认采样组数', async () => {
    const engine = new FakeEngine()
    await runBenchmark(engine, 5)
    expect(engine.analyzeCalls).toBe(10)
  })

  it('引擎未就绪时抛错', async () => {
    const engine = new FakeEngine()
    engine.ready = false
    await expect(runBenchmark(engine)).rejects.toThrow('引擎未就绪')
  })

  it('差分测速还原真实搜索速度（1ms/visit → ~1000 visits/s）', async () => {
    const engine = new FakeEngine()
    const { score } = await runBenchmark(engine, 2)
    // setTimeout 毫秒级计时噪声，允许 ±10% 波动
    expect(score).toBeGreaterThan(800)
    expect(score).toBeLessThan(1200)
  })

  it('固定开销（重建 Module）被差分消除，不影响测速结果', async () => {
    // 模拟 WASM：每次分析附加 100ms 固定开销；差分后仍应还原 ~1000 v/s
    // （旧实现会把 220 visits 摊到固定开销上，测出远低于真实值的速度）
    const engine = new FakeEngine()
    engine.fixedMs = 100
    const { score } = await runBenchmark(engine, 2)
    expect(score).toBeGreaterThan(800)
    expect(score).toBeLessThan(1200)
  })

  it('返回有效的 elapsedMs，且进度回调按采样组触发', async () => {
    const engine = new FakeEngine()
    const progress: number[] = []
    const result = await runBenchmark(engine, 3, (done, total) => {
      progress.push(done)
      expect(total).toBe(3)
    })
    expect(progress).toEqual([1, 2, 3])
    expect(result.elapsedMs).toBeGreaterThan(0)
  })
})
