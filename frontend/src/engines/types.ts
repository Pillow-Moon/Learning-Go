/**
 * 围棋引擎抽象层：统一 browser（WASM）与 local（本地后端）两种引擎来源。
 */

import type { Player, Vertex } from '../lib/types'

/** 局面分析查询参数 */
export interface AnalysisQuery {
  boardSize: number
  komi: number
  maxVisits: number
  /** 历史着法：[color, vertex] 或 [color, null]（pass） */
  moves: [string, [number, number] | null][]
}

/** 单个候选选点 */
export interface Candidate {
  move: [number, number] | null
  winrate: number | null
  scoreLead: number | null
  visits: number | null
  prior: number | null
  pv: [number, number][]
}

/** 局面分析结果 */
export interface AnalysisResult {
  boardSize: number
  candidates: Candidate[]
  root: { winrate?: number; scoreLead?: number }
}

/** AI 应手结果 */
export interface GenmoveResult {
  vertex: Vertex | null
  coord: string | null // GTP 坐标，或 "pass"/"resign"
}

/** 引擎信息 */
export interface EngineInfo {
  source: 'browser' | 'local'
  model: string
  ready: boolean
  /** 设备基准：visits/s，未测试时为 -1 */
  benchmarkScore: number
}

/** 引擎来源类型 */
export type EngineSource = 'browser' | 'local'

/**
 * 围棋引擎统一接口。
 *
 * 实现者：
 * - WasmEngine（browser：KataGo WASM 在 Web Worker 内运行）
 * - LocalEngine（local：通过 fetch 调用本地 FastAPI 后端 + 原生 KataGo）
 */
export interface GoEngine {
  /** 初始化引擎（加载模型等），完成后 resolve */
  init(): Promise<void>

  /** 局面分析：给定历史着法，返回候选选点与胜率 */
  analyze(query: AnalysisQuery): Promise<AnalysisResult>

  /** AI 生成一手棋（用于人机对弈） */
  genmove(
    color: Player,
    boardSize: number,
    komi: number,
    maxVisits: number,
    moves: [string, [number, number] | null][],
  ): Promise<GenmoveResult>

  /** 引擎是否已初始化完成 */
  isReady(): boolean

  /** 获取引擎元信息 */
  getInfo(): EngineInfo

  /** 销毁引擎（释放资源） */
  destroy(): void
}
