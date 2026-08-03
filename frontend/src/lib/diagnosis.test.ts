/**
 * 诊断引擎测试：四类错误分类（提子检测/阶段边界）、多局聚合、训练处方映射。
 */
import { describe, expect, it } from 'vitest'

import {
  capturedInWindow,
  classifyIssue,
  diagnoseGame,
  type DiagnosisPointInput,
} from './diagnosis'
import { aggregateDiagnoses } from './diagnosisStats'
import { buildTrainingPlan } from './trainingPlan'
import type { BoardSize, Move } from './types'

/** 由 [color, vertex] 序列构造 Move[]（pass 用 null） */
function movesFrom(seq: [1 | -1, [number, number] | null][], size: BoardSize = 19): Move[] {
  void size
  return seq.map(([color, vertex], i) => ({
    n: i + 1,
    color,
    vertex,
    pass: vertex == null,
  }))
}

/** 构造 points 数组：仅第 moveIndex 手（1-based）有标注 */
function pointsWith(moveIndex: number, loss: number, verdict: 'bad' | 'doubt', total: number) {
  const points: (DiagnosisPointInput | null)[] = new Array(total + 1).fill(null)
  points[moveIndex] = { position: moveIndex, verdict, loss }
  return points
}

describe('classifyIssue 阶段边界', () => {
  it('19 路：布局区（≤30 手）→ joseki', () => {
    expect(classifyIssue(10, 0, 19)).toBe('joseki')
    expect(classifyIssue(30, 0, 19)).toBe('joseki')
    expect(classifyIssue(31, 0, 19)).toBe('direction')
  })

  it('官子区（≥200 手）→ endgame，优先级高于提子', () => {
    expect(classifyIssue(210, 5, 19)).toBe('endgame')
  })

  it('9 路：阶段边界按棋盘尺寸缩放（30*9/19≈14、200*9/19≈95）', () => {
    expect(classifyIssue(14, 0, 9)).toBe('joseki')
    expect(classifyIssue(15, 0, 9)).toBe('direction')
    expect(classifyIssue(95, 0, 9)).toBe('endgame')
  })
})

describe('capturedInWindow 提子检测', () => {
  it('角部两子被围提（窗口内对方提 2 子）', () => {
    // 9 路：前 14 手铺垫，第 15 手起黑(1,1)(1,2) 被白包围，
    // 第 25 手黑脱先（被打吃不补），第 26 手白(2,2) 提走 2 子
    const ms = movesFrom(
      [
        [1, [8, 8]],
        [-1, [6, 2]],
        [1, [2, 6]],
        [-1, [6, 6]],
        // pass 填充到第 14 手（黑 5 / 白 6 / … / 白 14）
        ...new Array(10).fill(null).map((_, i) => [i % 2 === 0 ? 1 : -1, null] as [1 | -1, null]),
        [1, [1, 1]],
        [-1, [0, 1]],
        [1, [1, 2]],
        [-1, [1, 0]],
        [1, [4, 4]],
        [-1, [0, 2]],
        [1, [5, 5]],
        [-1, [1, 3]],
        [1, [6, 6]],
        [-1, [2, 1]],
        [1, [7, 7]],
        [-1, [2, 2]], // 提黑(1,1)(1,2)
      ],
      9,
    )
    expect(ms.length).toBe(26)
    // 问题手第 25 手：窗口手 25~28 → 手 26 白(2,2) 提 2 子
    expect(capturedInWindow(9, ms, 25)).toBe(2)
  })

  it('无提子时返回 0', () => {
    const ms = movesFrom([
      [1, [3, 3]],
      [-1, [15, 3]],
      [1, [3, 15]],
      [-1, [15, 15]],
    ])
    expect(capturedInWindow(19, ms, 2)).toBe(0)
  })

  it('角部单子被提（窗口内累计 1 子）', () => {
    // 9 路：黑(0,0) 角部，白填两气后提走
    const ms = movesFrom(
      [
        [1, [0, 0]],
        [-1, [1, 0]],
        [1, [4, 4]], // 问题手（脱先）
        [-1, [0, 1]], // 提黑(0,0)
        [1, [5, 5]],
        [-1, [6, 6]],
      ],
      9,
    )
    expect(capturedInWindow(9, ms, 3)).toBe(1)
  })
})

describe('diagnoseGame 单局诊断', () => {
  it('布局区问题手 → joseki', () => {
    const ms = movesFrom([
      [1, [3, 3]],
      [-1, [15, 3]],
      [1, [3, 15]],
      [-1, [15, 15]],
      [1, [9, 9]],
      [-1, [3, 9]],
      [1, [15, 9]],
      [-1, [9, 3]],
      [1, [9, 15]],
      [-1, [9, 6]],
    ])
    const diag = diagnoseGame({
      boardSize: 19,
      moves: ms,
      points: pointsWith(10, 0.12, 'bad', 10),
      gameId: 1,
      result: 'W+R',
    })
    expect(diag.issueCount).toBe(1)
    expect(diag.issues[0].type).toBe('joseki')
    expect(diag.issues[0].moveIndex).toBe(10)
    expect(diag.issues[0].loss).toBeCloseTo(0.12)
    expect(diag.byType.joseki.count).toBe(1)
  })

  it('中盘大龙被吃 → life-death（提子检测命中）', () => {
    const ms = movesFrom(
      [
        [1, [8, 8]],
        [-1, [6, 2]],
        [1, [2, 6]],
        [-1, [6, 6]],
        ...new Array(10).fill(null).map((_, i) => [i % 2 === 0 ? 1 : -1, null] as [1 | -1, null]),
        [1, [1, 1]],
        [-1, [0, 1]],
        [1, [1, 2]],
        [-1, [1, 0]],
        [1, [4, 4]],
        [-1, [0, 2]],
        [1, [5, 5]],
        [-1, [1, 3]],
        [1, [6, 6]],
        [-1, [2, 1]],
        [1, [7, 7]],
        [-1, [2, 2]],
      ],
      9,
    )
    const diag = diagnoseGame({
      boardSize: 9,
      moves: ms,
      points: pointsWith(25, 0.15, 'bad', 26),
      gameId: 2,
      result: 'B+R',
    })
    expect(diag.issueCount).toBe(1)
    expect(diag.issues[0].type).toBe('life-death')
    expect(diag.issues[0].capturedCount).toBe(2)
  })

  it('中盘无提子 → direction', () => {
    // 9 路：前 6 手真实，pass 填充到 40 手（>14 且 <95）
    const ms = movesFrom(
      [
        [1, [2, 2]],
        [-1, [6, 2]],
        [1, [2, 6]],
        [-1, [6, 6]],
        ...new Array(36).fill(null).map((_, i) => [i % 2 === 0 ? 1 : -1, null] as [1 | -1, null]),
      ],
      9,
    )
    expect(ms.length).toBe(40)
    const diag = diagnoseGame({
      boardSize: 9,
      moves: ms,
      points: pointsWith(40, 0.1, 'bad', 40),
    })
    expect(diag.issueCount).toBe(1)
    expect(diag.issues[0].type).toBe('direction')
  })

  it('官子区问题手 → endgame', () => {
    // 9 路：前 4 手真实，pass 填充到 95 手（= endgameStart）
    const ms = movesFrom(
      [
        [1, [2, 2]],
        [-1, [6, 2]],
        [1, [2, 6]],
        [-1, [6, 6]],
        ...new Array(91).fill(null).map((_, i) => [i % 2 === 0 ? 1 : -1, null] as [1 | -1, null]),
      ],
      9,
    )
    expect(ms.length).toBe(95)
    const diag = diagnoseGame({
      boardSize: 9,
      moves: ms,
      points: pointsWith(95, 0.09, 'doubt', 95),
    })
    expect(diag.issueCount).toBe(1)
    expect(diag.issues[0].type).toBe('endgame')
  })

  it('低于 LOSS_DOUBT 阈值的手不纳入诊断', () => {
    const ms = movesFrom([
      [1, [3, 3]],
      [-1, [15, 3]],
    ])
    const diag = diagnoseGame({
      boardSize: 19,
      moves: ms,
      points: pointsWith(2, 0.02, 'doubt', 2),
    })
    expect(diag.issueCount).toBe(0)
  })
})

describe('aggregateDiagnoses 多局聚合', () => {
  function diag(gameId: number, issues: [number, number, number][] /* typeIdx, loss, captured */) {
    void issues
    return {
      gameId,
      createdAt: `2026-08-0${gameId}T00:00:00.000Z`,
      result: 'B+R',
      boardSize: 19,
      issueCount: 3,
      issues: issues.map(([ti, loss]) => ({
        moveIndex: 10 + ti,
        type: (['life-death', 'joseki', 'direction', 'endgame'] as const)[ti],
        loss,
        verdict: 'bad' as const,
        vertex: [3, 3] as [number, number],
        capturedCount: 0,
      })),
      byType: {
        'life-death': { count: 2, avgLoss: 0.1, maxLoss: 0.12 },
        joseki: { count: 1, avgLoss: 0.08, maxLoss: 0.08 },
        direction: { count: 0, avgLoss: 0, maxLoss: 0 },
        endgame: { count: 0, avgLoss: 0, maxLoss: 0 },
      },
    }
  }

  it('统计 totalIssues / topType / perGame 排序', () => {
    const d1 = diag(1, [])
    const d2 = diag(2, [])
    const stats = aggregateDiagnoses([d1, d2])
    expect(stats.gameCount).toBe(2)
    expect(stats.totalIssues).toBe(6)
    expect(stats.topType).toBe('life-death')
    expect(stats.byType['life-death'].count).toBe(4)
    expect(stats.byType.joseki.count).toBe(2)
    expect(stats.byType.direction.count).toBe(0)
    // 时间倒序：gameId 大的在前
    expect(stats.perGame[0].gameId).toBe(2)
    expect(stats.perGame[1].gameId).toBe(1)
    // 平均损失 = 加权平均
    expect(stats.byType['life-death'].avgLoss).toBeCloseTo(0.1)
  })

  it('全部为空时 topType 为 null', () => {
    const empty = {
      ...diag(1, []),
      issueCount: 0,
      issues: [],
      byType: {
        'life-death': { count: 0, avgLoss: 0, maxLoss: 0 },
        joseki: { count: 0, avgLoss: 0, maxLoss: 0 },
        direction: { count: 0, avgLoss: 0, maxLoss: 0 },
        endgame: { count: 0, avgLoss: 0, maxLoss: 0 },
      },
    }
    const stats = aggregateDiagnoses([empty])
    expect(stats.totalIssues).toBe(0)
    expect(stats.topType).toBeNull()
  })
})

describe('buildTrainingPlan 训练处方', () => {
  function statsWith(topCounts: Record<string, number>) {
    const base = {
      'life-death': { count: 0, avgLoss: 0, maxLoss: 0 },
      joseki: { count: 0, avgLoss: 0, maxLoss: 0 },
      direction: { count: 0, avgLoss: 0, maxLoss: 0 },
      endgame: { count: 0, avgLoss: 0, maxLoss: 0 },
    } as Record<string, { count: number; avgLoss: number; maxLoss: number }>
    let total = 0
    for (const [k, v] of Object.entries(topCounts)) {
      base[k].count = v
      base[k].avgLoss = 0.1
      base[k].maxLoss = 0.15
      total += v
    }
    const top = Object.entries(topCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    return {
      gameCount: 3,
      totalIssues: total,
      byType: base,
      topType: top,
      perGame: [],
    }
  }

  it('死活漏算为主 → 死活题专项 + 101 围棋网难度区间随用户等级', () => {
    const plan = buildTrainingPlan(statsWith({ 'life-death': 6, direction: 1 }) as never, 7)
    expect(plan.topType).toBe('life-death')
    expect(plan.headline).toContain('死活漏算')
    expect(plan.exercises[0].title).toBe('死活题专项')
    expect(plan.exercises[0].detail).toContain('6 级 ~ 8 级')
    expect(plan.exercises[0].dailyMinutes).toBe(20)
  })

  it('定式为主 → 定式复习', () => {
    const plan = buildTrainingPlan(statsWith({ joseki: 5, direction: 1 }) as never, 5)
    expect(plan.headline).toContain('定式与布局')
    expect(plan.exercises[0].title).toBe('定式复习')
  })

  it('选点为主 → 选点意识训练', () => {
    const plan = buildTrainingPlan(statsWith({ direction: 4, endgame: 1 }) as never, 7)
    expect(plan.headline).toContain('选点与方向')
    expect(plan.exercises[0].title).toBe('选点意识训练')
  })

  it('无问题手 → 保持型处方', () => {
    const plan = buildTrainingPlan(
      { gameCount: 2, totalIssues: 0, byType: {}, topType: null, perGame: [] } as never,
      7,
    )
    expect(plan.headline).toContain('没有检测到明显问题手')
    expect(plan.exercises[0].title).toBe('保持节奏')
  })
})
