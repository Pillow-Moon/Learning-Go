/**
 * KaTrain 式盲注错误注入（Blinded Policy）——WASM 档位"精确等于具体级别"的实现核心。
 *
 * 背景：P7b 实测（backend/calibration/2026-08-01-p7b.md 结论 3/4）显示纯 visits 无法把
 * KataGo 网络棋力压到人类低级区间（b6c96 让 2 子仍 100% 全胜）——低 visits 只降搜索
 * 深度，policy 基本棋感仍在，模拟不出人类低级错误。要精确等于具体级别需 KaTrain 式
 * 错误注入而非纯 visits（思路见 backend/calibration/README.md §2.4）。
 *
 * 机制（移植自 KaTrain `ai:p:rank` RankStrategy，公式经 OGS 真人对弈校准）：
 * 低级棋手每手只"考虑"少数几个点（视野窄），但局面明朗时也会下正着——
 * 1. 由 kyu_rank 计算盲注视野 n_moves（级数越大视野越窄），从全部合法着法中
 *    随机抽 n_moves 个点（无放回等概率）；
 * 2. 若 pass 在 policy top5（接近终局）或最优点的 policy 超过阈值（局面明朗）→
 *    直接走全局最优合法点；
 * 3. 否则从抽中的点里选 policy 最高的落子（纯棋感，无深层搜索）。
 * 棋力由 kyu_rank 决定（18 级→18，1 段→0，3 段→-2），与搜索量（visits）解耦。
 *
 * 注意：policy 是 KataGo 网络的单次前向输出（与搜索量无关），因此盲注选择
 * 不受 maxVisits 影响；弱档保持低 visits 也不会因"棋感仍在"而棋力虚高。
 */
import GoBoard from '@sabaki/go-board'

import type { Player, Vertex } from './types'

/**
 * KaTrain 盲注视野公式：级数 kyuRank 下，从全部合法着法中随机抽取多少个点
 * 再选最佳（n_moves 越大 = 视野越宽 = 棋力越强）。
 * 移植自 katrain/core/ai.py `RankStrategy.get_n_moves`（OGS 真人对弈校准）。
 */
export function nMovesForKyu(
  kyuRank: number,
  legalMoveCount: number,
  boardSize: number,
): number {
  const boardSquares = boardSize * boardSize
  const normLegMoves = legalMoveCount / boardSquares

  const orig = 0.063015 + (0.7624 * boardSquares) / 10 ** (-0.05737 * kyuRank + 1.9482)
  const exponentTerm = 3.002 * normLegMoves ** 2 - normLegMoves - 0.034889 * kyuRank - 0.5097
  const modified =
    (0.3931 + 0.6559 * normLegMoves * Math.exp(-(exponentTerm ** 2)) - 0.01093 * kyuRank) * orig
  const denominator = 1.31165 * (modified + 1) - 0.082653

  return Math.max(1, Math.round((boardSquares * normLegMoves) / denominator))
}

/**
 * 局面明朗时的 override 阈值（KaTrain `RankStrategy.should_play_top_move` 的校准参数）：
 * - override：最优着法 policy 超过该值 → 直接走最优（该点太明显，低级棋手也会下）
 * - overridetwo：前二着法 policy 合计超过该值 → 直接走最优
 */
export function overridesForKyu(
  kyuRank: number,
  legalMoveCount: number,
  boardSize: number,
): { override: number; overridetwo: number } {
  const boardSquares = boardSize * boardSize
  const fillRatio = (boardSquares - legalMoveCount) / boardSquares
  const override = 0.8 * (1 - 0.5 * fillRatio)
  const overridetwo = 0.85 + Math.max(0, 0.02 * (kyuRank - 8))
  return { override, overridetwo }
}

/** 从 moves 历史重建当前局面（pass 跳过；历史着法均已由上层校验合法） */
export function boardFromMoves(
  moves: [string, [number, number] | null][],
  boardSize: number,
): GoBoard {
  let board = GoBoard.fromDimensions(boardSize, boardSize)
  for (const [color, v] of moves) {
    if (!v) continue // pass：局面不变
    board = board.makeMove(color === 'B' ? 1 : -1, v)
  }
  return board
}

/** 无放回等概率抽样（Fisher-Yates 部分洗牌，取前 k 个） */
function pickRandom(pool: number[], k: number, rng: () => number): number[] {
  const arr = [...pool]
  const n = Math.min(k, arr.length)
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rng() * (arr.length - i))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr.slice(0, n)
}

export interface BlindedSelectOptions {
  boardSize: number
  /** KaTrain 校准级数（由档位 id 推导：amXk→X、amXd→1-X，上限 5 段） */
  kyuRank: number
  /** KataGo analysis policy 数组：长度 boardSize²+1，row-major（y 自顶部），末位为 pass */
  policy: number[]
  /** 当前局面（含 moves 历史后的盘面） */
  board: GoBoard
  /** 行棋方：1 黑 / -1 白（与 @sabaki/go-board 一致） */
  player: Player
  /** 随机源（测试注入用）；默认 Math.random */
  rng?: () => number
}

export interface BlindedSelectResult {
  /** 选中的落点；null = 无可落子（pass） */
  vertex: Vertex | null
  /** 选择原因（调试/日志用） */
  reason: string
}

/**
 * 盲注选点（KaTrain `RankStrategy.generate_move` 的选择逻辑）：
 * 1. 合法着法池：过滤占位/自杀/打劫，且 policy > 0；
 * 2. 明朗检查：pass 在 policy top5、最优 policy 超阈值、前二合计超阈值 → 走最优；
 * 3. 否则随机抽 n_moves 个合法点，从中选 policy 最高者。
 */
export function selectBlindedMove(options: BlindedSelectOptions): BlindedSelectResult {
  const { boardSize, kyuRank, policy, board, player } = options
  const rng = options.rng ?? Math.random
  const size = boardSize
  const boardSquares = size * size
  const signMap = board.signMap
  const toVertex = (idx: number): Vertex => [idx % size, Math.floor(idx / size)]

  // 1. 合法着法池（排除 pass；policy 数组末位为 pass）
  const legalIndices: number[] = []
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (signMap[y][x] !== 0) continue
      const info = board.analyzeMove(player, [x, y])
      if (info.overwrite || info.suicide || info.ko) continue
      const idx = y * size + x
      if (idx < policy.length && policy[idx] > 0) legalIndices.push(idx)
    }
  }
  if (legalIndices.length === 0) {
    return { vertex: null, reason: 'no-legal-move' }
  }

  // 2. 合法点按 policy 降序（盲注池与 override 判断共用）
  const ranked = legalIndices
    .map((idx) => ({ idx, pol: policy[idx] ?? 0 }))
    .sort((a, b) => b.pol - a.pol)
  const best = ranked[0]
  const top2 = ranked[1]

  // 3. 局面明朗检查（KaTrain should_play_top_move）：
  //    - pass 在全局 policy top5（含 pass 排序）→ 接近终局，直接走最优
  //    - 最优 policy 超过 override → 该点太明显，直接走最优
  //    - 前二 policy 合计超过 overridetwo → 直接走最优
  const passPolicy = policy[boardSquares] ?? 0
  // pass 是否在全局（含 pass）前 5：池中 policy 严格大于 pass 的点少于 5 个即并列前 5
  const passInTop5 =
    passPolicy > 0 && ranked.filter((r) => r.pol > passPolicy).length < 5
  const { override, overridetwo } = overridesForKyu(kyuRank, legalIndices.length, size)

  if (passInTop5) return { vertex: toVertex(best.idx), reason: 'pass-in-top5' }
  if (best.pol > override) return { vertex: toVertex(best.idx), reason: 'top-policy-override' }
  if (top2 && best.pol + top2.pol > overridetwo) {
    return { vertex: toVertex(best.idx), reason: 'top2-policy-override' }
  }

  // 4. 盲注：随机抽 n_moves 个合法点，从中选 policy 最高者
  const n = nMovesForKyu(kyuRank, legalIndices.length, size)
  const picked = pickRandom(legalIndices, n, rng)
  let chosen = picked[0]
  for (const idx of picked) {
    if ((policy[idx] ?? 0) > (policy[chosen] ?? 0)) chosen = idx
  }
  return { vertex: toVertex(chosen), reason: `blind-${n}-of-${legalIndices.length}` }
}
