/**
 * 设备基准测试：测量当前引擎的真实搜索速度（visits/s）。
 *
 * 差分测速：每次采样跑两次固定 9 路局面分析（LOW=20 visits / HIGH=240 visits），
 * 速度 = Δvisits / Δ耗时。两次分析共享相同的固定开销（WASM 每次重建 Module
 * 3~5s + 模型初始化；Local 后端无重建开销但同样适用），相减后被消除，
 * 得到纯粹的搜索速度。
 *
 * 背景：旧实现用单次 20 visits 的总耗时折算速度，WASM 上固定开销（3~5s）把
 * 20 visits 摊到 4~7 秒，测出个位数 visits/s，严重低估真实搜索速度（B6 搜索
 * 阶段实际可达数十 visits/s），导致 getStrengthCap / 档位上限计算失真。
 *
 * 采样组数按引擎来源区分（多次采样取中位数，抗单次波动）：
 * - browser（WASM）：每组 2 次分析，默认 2 组（共 4 次分析，每次重建 Module 约 3~5s）；
 * - local：无重建开销、分析快，默认 3 组更稳。
 */
import type { GoEngine } from './types'

/** 差分测速低档查询（固定局面：黑下 D4 后） */
const BENCH_QUERY_LOW = {
  boardSize: 9,
  komi: 7.5,
  maxVisits: 20,
  moves: [['B', [3, 3]]] as [string, [number, number] | null][],
}

/** 差分测速高档查询：与 LOW 的 visits 差越大，固定开销占比越小，测速越准 */
const BENCH_QUERY_HIGH = {
  boardSize: 9,
  komi: 7.5,
  maxVisits: 240,
  moves: [['B', [3, 3]]] as [string, [number, number] | null][],
}

/** 差分 visits 差（HIGH - LOW），测速公式的速度分子 */
const BENCH_DELTA_VISITS = BENCH_QUERY_HIGH.maxVisits - BENCH_QUERY_LOW.maxVisits

export async function runBenchmark(
  engine: GoEngine,
  rounds?: number,
  onProgress?: (done: number, total: number) => void,
): Promise<{ score: number; elapsedMs: number }> {
  if (!engine.isReady()) {
    throw new Error('引擎未就绪，无法运行基准测试')
  }

  // 采样组数：一组 = LOW + HIGH 两次分析，取 Δvisits/Δ耗时
  const total = rounds ?? (engine.getInfo().source === 'browser' ? 2 : 3)

  const samples: number[] = []
  let totalMs = 0
  for (let i = 0; i < total; i++) {
    const t0 = performance.now()
    await engine.analyze(BENCH_QUERY_LOW)
    const t1 = performance.now()
    await engine.analyze(BENCH_QUERY_HIGH)
    const t2 = performance.now()
    totalMs += t2 - t0
    // 差分：T(visits) = F + S×visits，两次耗时相减消除固定开销 F，得纯搜索耗时
    // searchMs = T(HIGH) - T(LOW) = S × Δvisits
    const searchMs = t2 - t1 - (t1 - t0)
    const score = searchMs > 0 ? BENCH_DELTA_VISITS / (searchMs / 1000) : 0
    samples.push(score)
    onProgress?.(i + 1, total)
  }
  samples.sort((a, b) => a - b)
  // 中位数：偶数样本取中间两个的平均
  const mid = Math.floor(samples.length / 2)
  const score =
    samples.length % 2 === 1 ? samples[mid] : (samples[mid - 1] + samples[mid]) / 2

  console.log(
    `[Benchmark] 差分 ${BENCH_QUERY_LOW.maxVisits}→${BENCH_QUERY_HIGH.maxVisits}v ×${total} 组中位数 = ${score.toFixed(1)} visits/s`,
  )

  return { score: Math.round(score * 100) / 100, elapsedMs: Math.round(totalMs) }
}

/**
 * 根据基准分数推荐默认 maxVisits。
 * 分数越高 → 默认 visits 越大。
 */
export function recommendVisits(
  benchmarkScore: number,
  scenario: 'move' | 'analysis' | 'assessment' | 'commentary',
): number {
  // 实测基准（visits/s）
  const base = benchmarkScore

  // 各场景标准档的目标用时（秒）与最小 visits
  const scene: Record<string, { secs: number; min: number }> = {
    move: { secs: 8, min: 10 }, // 人机对弈：标准档每手约 8 秒
    analysis: { secs: 25, min: 20 }, // 局面分析：约 25 秒
    assessment: { secs: 15, min: 15 }, // 棋力评估
    commentary: { secs: 18, min: 15 }, // 解说取数
  }
  const { secs, min } = scene[scenario] ?? { secs: 10, min: 10 }

  const visits = Math.round(base * secs)

  // 上限随基准速度动态放大（标准档 secs 秒 × 8，容纳「极强」4 倍档位及余量）。
  // 旧实现固定上限（move 200 / analysis 500）按 ~5 visits/s 校准，
  // 对 GPU 引擎（数百~上千 visits/s）会严重压制搜索量、浪费硬件性能。
  const max = Math.max(Math.round(base * secs * 8), 200)

  return Math.max(min, Math.min(max, visits))
}
