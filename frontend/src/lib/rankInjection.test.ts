/**
 * KaTrain 盲注式错误注入（rankInjection）单测。
 * nMovesForKyu 参考值由 Python 复算 KaTrain `RankStrategy.get_n_moves` 公式得到。
 */
import { describe, expect, it } from 'vitest'
import GoBoard from '@sabaki/go-board'

import { boardFromMoves, nMovesForKyu, overridesForKyu, selectBlindedMove } from './rankInjection'

/** 构造 policy 数组：长度 boardSize²+1，末位 pass；未指定的点取 0.002（高于 pass 默认 0.001，避免并列） */
function makePolicy(
  boardSize: number,
  assignments: Record<number, number> = {},
  pass = 0.001,
): number[] {
  const p = new Array(boardSize * boardSize + 1).fill(0.002)
  for (const [idx, v] of Object.entries(assignments)) p[Number(idx)] = v
  p[boardSize * boardSize] = pass
  return p
}

/** 空盘 9 路 */
function emptyBoard(size = 9): GoBoard {
  return GoBoard.fromDimensions(size, size)
}

describe('nMovesForKyu（KaTrain 公式，参考值 Python 复算）', () => {
  it('19 路、200 合法着法：级数越大视野越窄', () => {
    expect(nMovesForKyu(18, 200, 19)).toBe(11) // 18 级
    expect(nMovesForKyu(10, 200, 19)).toBe(20) // 10 级
    expect(nMovesForKyu(4, 200, 19)).toBe(33) // 4 级
    expect(nMovesForKyu(0, 200, 19)).toBe(46) // 1 段
    expect(nMovesForKyu(-2, 200, 19)).toBe(54) // 3 段
  })

  it('合法着法数不同时视野变化', () => {
    expect(nMovesForKyu(18, 50, 19)).toBe(5)
    expect(nMovesForKyu(18, 300, 19)).toBe(9)
    expect(nMovesForKyu(-2, 300, 19)).toBe(86)
  })

  it('9 路空盘（81 合法）与边界兜底', () => {
    expect(nMovesForKyu(18, 81, 9)).toBe(13)
    expect(nMovesForKyu(18, 0, 9)).toBe(1) // 无合法点时至少 1
  })
})

describe('overridesForKyu（KaTrain 校准阈值）', () => {
  it('空盘 override=0.8；级数越低 overridetwo 越接近 0.85', () => {
    expect(overridesForKyu(0, 81, 9)).toEqual({ override: 0.8, overridetwo: 0.85 })
    expect(overridesForKyu(-2, 81, 9)).toEqual({ override: 0.8, overridetwo: 0.85 })
  })

  it('级数 ≥ 8 时 overridetwo 随级数上升', () => {
    expect(overridesForKyu(18, 81, 9).overridetwo).toBe(1.05)
    expect(overridesForKyu(10, 81, 9).overridetwo).toBe(0.89)
  })

  it('棋盘越满 override 越高（点越少越容易走最优）', () => {
    expect(overridesForKyu(0, 40, 9).override).toBeCloseTo(0.8 * (1 - 0.5 * (41 / 81)), 10)
  })
})

describe('boardFromMoves', () => {
  it('重建局面（含 pass 跳过）', () => {
    const moves: [string, [number, number] | null][] = [
      ['B', [3, 3]],
      ['W', [15, 15]],
      ['B', null], // pass：局面不变
      ['B', [3, 4]],
    ]
    const board = boardFromMoves(moves, 19)
    expect(board.signMap[3][3]).toBe(1) // 黑 [3,3]
    expect(board.signMap[15][15]).toBe(-1) // 白 [15,15]
    expect(board.signMap[4][3]).toBe(1) // 黑 [3,4]（signMap[y][x]）
    expect(board.signMap[4][4]).toBe(0)
  })
})

describe('selectBlindedMove', () => {
  it('局面明朗（最优 policy 超阈值）直接走最优', () => {
    const policy = makePolicy(9, { 40: 0.9 }) // 中心 [4,4] 明显最强
    const r = selectBlindedMove({ boardSize: 9, kyuRank: 0, policy, board: emptyBoard(), player: 1, rng: () => 0.5 })
    expect(r).toEqual({ vertex: [4, 4], reason: 'top-policy-override' })
  })

  it('前二 policy 合计超阈值（overridetwo）也走最优', () => {
    const policy = makePolicy(9, { 40: 0.5, 41: 0.4 }) // 0.5+0.4 > 0.85
    const r = selectBlindedMove({ boardSize: 9, kyuRank: 0, policy, board: emptyBoard(), player: 1, rng: () => 0.5 })
    expect(r).toEqual({ vertex: [4, 4], reason: 'top2-policy-override' })
  })

  it('pass 进入 policy top5（接近终局）时走最优', () => {
    const policy = makePolicy(9, { 40: 0.2 }, 0.5) // pass 0.5 最高
    const r = selectBlindedMove({ boardSize: 9, kyuRank: 0, policy, board: emptyBoard(), player: 1, rng: () => 0.5 })
    expect(r).toEqual({ vertex: [4, 4], reason: 'pass-in-top5' })
  })

  it('无明朗局面时盲注：随机抽 n_moves 个点中选 policy 最高', () => {
    // 最优 [4,4]=0.08 低于 override(0.8)；rng=0 恒定 → 抽前 n 个合法点
    // 空盘 9 路 legal=81 → n=13 → 池为 idx 0..12，其中 idx=0 的 policy 最高
    const policy = makePolicy(9, { 0: 0.5, 40: 0.08 })
    const r = selectBlindedMove({ boardSize: 9, kyuRank: 18, policy, board: emptyBoard(), player: 1, rng: () => 0 })
    expect(r.vertex).toEqual([0, 0])
    expect(r.reason).toMatch(/^blind-13-of-81$/)
  })

  it('已占位点不会入选（合法性过滤）', () => {
    const board = emptyBoard()
    board.set([0, 0], 1) // 左上角被黑占
    // policy 给 idx=0（[0,0]）最高分——但该点已被占，应选次优合法点 [1,0]
    const policy = makePolicy(9, { 0: 0.9, 1: 0.9 })
    const r = selectBlindedMove({ boardSize: 9, kyuRank: 0, policy, board, player: 1, rng: () => 0.5 })
    expect(r).toEqual({ vertex: [1, 0], reason: 'top-policy-override' })
  })

  it('policy 为 0 的点不参与盲注抽选', () => {
    const policy = makePolicy(9, { 0: 0.5 })
    policy[0] = 0 // [0,0] policy=0 → 排除出合法池
    // rng=0 → 抽池前 n 个含 policy 的点；[0,0] 不在池中，池首为 idx=1 → [1,0]
    const r = selectBlindedMove({ boardSize: 9, kyuRank: 18, policy, board: emptyBoard(), player: 1, rng: () => 0 })
    expect(r.vertex).toEqual([1, 0])
  })

  it('劫争点被 ko 过滤（白不能立即提回）', () => {
    // 简单劫：白 [4,3] 单气（[4,4] 是其唯一气），黑 [3,3][5,3][4,2] 围之；
    // 黑落 [4,4] 提白后，黑 [4,4] 被白 [3,4][5,4][4,5] 围成单气 → 白提回即劫
    const board = emptyBoard()
    board.set([3, 3], 1).set([5, 3], 1).set([4, 2], 1).set([4, 3], -1)
    board.set([3, 4], -1).set([5, 4], -1).set([4, 5], -1)
    const afterCapture = board.makeMove(1, [4, 4]) // 黑提白
    // 白 [4,3] 提回应被判劫
    expect(afterCapture.analyzeMove(-1, [4, 3]).ko).toBe(true)
    // 完整选择：给 [4,3] 最高 policy，仍不应选中（白被禁）
    const policy = makePolicy(9, { 39: 0.9, 40: 0.05 }) // 39=[4,3]（ko 禁），40=[4,4]（黑占）
    const r = selectBlindedMove({ boardSize: 9, kyuRank: 0, policy, board: afterCapture, player: -1, rng: () => 0.5 })
    expect(r.vertex).not.toEqual([4, 3])
  })

  it('无任何合法着法时返回 pass（vertex null）', () => {
    const board = GoBoard.fromDimensions(1, 1)
    board.set([0, 0], 1) // 1 路满盘，白无可落点
    const policy = makePolicy(1, {}, 0.001)
    const r = selectBlindedMove({ boardSize: 1, kyuRank: 0, policy, board, player: -1, rng: () => 0.5 })
    expect(r).toEqual({ vertex: null, reason: 'no-legal-move' })
  })

  it('pass 的 policy 不低于池中多数点时不会误判（盲注正常执行）', () => {
    // 池默认 0.002、pass 0.001：pass 严格低于全部合法点 → 不在 top5，应走盲注
    const policy = makePolicy(9, { 40: 0.08 })
    const r = selectBlindedMove({ boardSize: 9, kyuRank: 18, policy, board: emptyBoard(), player: 1, rng: () => 0 })
    expect(r.reason).toMatch(/^blind-/)
  })
})
