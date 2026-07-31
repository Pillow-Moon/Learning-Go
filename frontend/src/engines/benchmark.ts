/**
 * 设备基准测试：测量当前引擎的 visits/s。
 *
 * 使用固定 9 路局面 + 20 visits 做测试分析，
 * 根据耗时计算 visits/s = 20 / 耗时（秒）。
 */
import type { GoEngine } from './types'

/** 基准测试固定局面：黑下 D4 后 */
const BENCH_QUERY = {
  boardSize: 9,
  komi: 7.5,
  maxVisits: 20,
  moves: [['B', [3, 3]]] as [string, [number, number] | null][],
}

export async function runBenchmark(
  engine: GoEngine,
): Promise<{ score: number; elapsedMs: number }> {
  if (!engine.isReady()) {
    throw new Error('引擎未就绪，无法运行基准测试')
  }

  const t0 = performance.now()
  await engine.analyze(BENCH_QUERY)
  const elapsedMs = performance.now() - t0

  const score = Math.round((20 / (elapsedMs / 1000)) * 100) / 100
  console.log(
    `[Benchmark] 20 visits / ${elapsedMs.toFixed(0)}ms = ${score} visits/s`,
  )

  return { score, elapsedMs: Math.round(elapsedMs) }
}

/**
 * 根据基准分数推荐默认 maxVisits。
 * 分数越高 → 默认 visits 越大。
 */
export function recommendVisits(
  benchmarkScore: number,
  scenario: 'move' | 'analysis' | 'assessment' | 'commentary',
): number {
  // 基于本地 eigenavx2 b10c384h6 的后端实测值 ~3-5 visits/s 做校准
  // benchmarkScore 是 visits/s
  const base = benchmarkScore

  const ratios: Record<string, number> = {
    move: 8, // 人机对弈：期望每手 ~8 秒 → visits = base * 8
    analysis: 25, // 局面分析：期望 ~25 秒
    assessment: 15, // 棋力评估
    commentary: 18, // 解说取数
  }

  const ratio = ratios[scenario] ?? 10
  const visits = Math.round(base * ratio)

  // 限制范围
  const limits: Record<string, [number, number]> = {
    move: [10, 200],
    analysis: [20, 500],
    assessment: [15, 300],
    commentary: [15, 400],
  }

  const [min, max] = limits[scenario] ?? [10, 200]
  return Math.max(min, Math.min(max, visits))
}
