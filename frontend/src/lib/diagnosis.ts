/**
 * 单局棋谱诊断：将整盘逐手分析结果中的问题手按程序化启发式分类。
 *
 * 分类（MVP 四类，可解释、可测试）：
 * - joseki      布局/定式区（约前 30 手，按棋盘尺寸缩放）出错
 * - endgame     官子区（约 200 手之后，按棋盘尺寸缩放）出错
 * - life-death  中盘且该手后窗口内本方棋子被提 ≥2 颗（死活漏算）
 * - direction   其余中盘问题手（选点/方向；"应手过度"二期再细分）
 *
 * 设计原则：棋力判断完全来自 KataGo 客观数据（胜率损失 + 提子检测），
 * 不引入主观棋理，规则可单测。本模块不依赖 stores，避免循环导入。
 */
import GoBoard from '@sabaki/go-board'

import { LOSS_DOUBT } from './reviewThresholds'
import type { BoardSize, Move, Vertex } from './types'

/** 错误类型：死活漏算 / 定式与布局 / 选点与方向 / 官子 */
export type DiagnosisType = 'life-death' | 'joseki' | 'direction' | 'endgame'

export const DIAGNOSIS_TYPES: DiagnosisType[] = [
  'life-death',
  'joseki',
  'direction',
  'endgame',
]

/** 诊断输入所需的最小子集（与 reviewStore 的 ReviewPoint 结构兼容，结构化类型） */
export interface DiagnosisPointInput {
  position: number
  verdict: 'good' | 'doubt' | 'bad' | null
  loss: number | null
}

/** 单个问题手 */
export interface DiagnosisIssue {
  /** 第几手（1-based） */
  moveIndex: number
  type: DiagnosisType
  /** 黑视角胜率损失（0~1） */
  loss: number
  verdict: 'bad' | 'doubt'
  /** 落点；pass 为 null */
  vertex: Vertex | null
  /** 该手及后续 3 手窗口内本方被提子数（>0 = 漏算特征） */
  capturedCount: number
}

/** 某类型的聚合摘要 */
export interface TypeSummary {
  count: number
  avgLoss: number
  maxLoss: number
}

/** 单局诊断结果 */
export interface GameDiagnosis {
  gameId: number
  createdAt: string
  result: string | null
  boardSize: number
  issueCount: number
  issues: DiagnosisIssue[]
  byType: Record<DiagnosisType, TypeSummary>
}

/** 按棋盘尺寸缩放的阶段边界（19 路基准：布局 ≤30 手、官子 ≥200 手） */
export function phaseBounds(boardSize: number): { josekiEnd: number; endgameStart: number } {
  const ratio = boardSize / 19
  return {
    josekiEnd: Math.round(30 * ratio),
    endgameStart: Math.round(200 * ratio),
  }
}

/** 统计棋盘上某方棋子数 */
function countColor(board: GoBoard, color: 1 | -1): number {
  const map = board.signMap
  let n = 0
  for (const row of map) {
    for (const s of row) {
      if (s === color) n++
    }
  }
  return n
}

/**
 * 计算第 moveIndex 手（1-based）后窗口内本方被提子数。
 * 从该手前局面重建，逐手推进至多 4 手（含对方应手窗口），
 * 累计「对方落子导致本方棋子被提」的数量。
 */
export function capturedInWindow(
  boardSize: BoardSize,
  moves: Move[],
  moveIndex: number,
): number {
  const start = Math.max(0, moveIndex - 1)
  const end = Math.min(moves.length, moveIndex - 1 + 4)
  if (start >= end) return 0
  const moverColor = moves[moveIndex - 1].color

  let board = GoBoard.fromDimensions(boardSize, boardSize)
  for (let i = 0; i < start; i++) {
    const m = moves[i]
    if (m.pass || m.vertex == null) continue
    board = board.makeMove(m.color, m.vertex)
  }

  let captured = 0
  for (let i = start; i < end; i++) {
    const m = moves[i]
    if (m.pass || m.vertex == null) continue
    if (m.color === moverColor) {
      // 本方落子：不改变本方已盘上的子数（无自杀），无需统计
      board = board.makeMove(m.color, m.vertex)
      continue
    }
    // 对方落子：统计本方棋子被提数量
    const victimBefore = countColor(board, moverColor)
    try {
      board = board.makeMove(m.color, m.vertex)
    } catch {
      // 棋谱含非法着法（理论上不会发生）：跳过该手
      continue
    }
    const victimAfter = countColor(board, moverColor)
    if (victimAfter < victimBefore) {
      captured += victimBefore - victimAfter
    }
  }
  return captured
}

/** 分类判定（优先级：布局区 > 官子区 > 中盘提子 > 中盘选点） */
export function classifyIssue(
  moveIndex: number,
  capturedCount: number,
  boardSize: number,
): DiagnosisType {
  const { josekiEnd, endgameStart } = phaseBounds(boardSize)
  if (moveIndex <= josekiEnd) return 'joseki'
  if (moveIndex >= endgameStart) return 'endgame'
  if (capturedCount >= 2) return 'life-death'
  return 'direction'
}

function emptySummary(): TypeSummary {
  return { count: 0, avgLoss: 0, maxLoss: 0 }
}

function buildTypeSummary(issues: DiagnosisIssue[]): Record<DiagnosisType, TypeSummary> {
  const summary = Object.fromEntries(
    DIAGNOSIS_TYPES.map((t) => [t, emptySummary()]),
  ) as Record<DiagnosisType, TypeSummary>
  for (const issue of issues) {
    const s = summary[issue.type]
    s.count++
    s.avgLoss += issue.loss
    s.maxLoss = Math.max(s.maxLoss, issue.loss)
  }
  for (const t of DIAGNOSIS_TYPES) {
    const s = summary[t]
    if (s.count > 0) s.avgLoss = s.avgLoss / s.count
  }
  return summary
}

/** 生成单局诊断：提取问题手 → 分类 → 汇总 */
export function diagnoseGame(input: {
  boardSize: BoardSize
  moves: Move[]
  points: (DiagnosisPointInput | null)[]
  gameId?: number
  createdAt?: string
  result?: string | null
}): GameDiagnosis {
  const { boardSize, moves, points } = input
  const issues: DiagnosisIssue[] = []

  for (let i = 1; i <= moves.length; i++) {
    const p = points[i]
    if (!p) continue
    if (p.verdict !== 'bad' && p.verdict !== 'doubt') continue
    if (p.loss == null || p.loss < LOSS_DOUBT) continue
    const captured = capturedInWindow(boardSize, moves, i)
    issues.push({
      moveIndex: i,
      type: classifyIssue(i, captured, boardSize),
      loss: p.loss,
      verdict: p.verdict,
      vertex: moves[i - 1].vertex,
      capturedCount: captured,
    })
  }

  return {
    gameId: input.gameId ?? 0,
    createdAt: input.createdAt ?? '',
    result: input.result ?? null,
    boardSize,
    issueCount: issues.length,
    issues,
    byType: buildTypeSummary(issues),
  }
}
