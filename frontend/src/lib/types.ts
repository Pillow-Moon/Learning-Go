/**
 * 围棋基础类型定义。
 * Sign / Vertex 复用 @sabaki/go-board 的定义，保持与规则引擎一致。
 */
import type { Sign, Vertex } from '@sabaki/go-board'

export type { Sign, Vertex }

/** 棋子颜色：黑=1，白=-1（与 @sabaki/go-board 一致） */
export type Player = 1 | -1

/** 对局状态机 */
export type GameStatus =
  | 'idle' // 未开始
  | 'playing' // 进行中（等待用户落子）
  | 'waiting_ai' // 等待 AI 生成应手
  | 'finished' // 已结束

/** 对局模式 */
export type GameMode = 'human_vs_human' | 'human_vs_ai'

/** 一手棋记录 */
export interface Move {
  /** 手数（从 1 开始） */
  n: number
  /** 落子方 */
  color: Player
  /** 落点；pass 为 null */
  vertex: Vertex | null
  /** 是否为 pass */
  pass: boolean
}

/** 支持的棋盘尺寸 */
export type BoardSize = 9 | 13 | 19
