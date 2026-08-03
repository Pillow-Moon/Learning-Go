/**
 * 围棋引擎抽象层：统一 browser（WASM）与 local（本地后端）两种引擎来源。
 * 2026-08 精简：AI 对弈已删除，引擎只承担局面分析（analyze）职责。
 */

/** 局面分析查询参数 */
export interface AnalysisQuery {
  boardSize: number
  komi: number
  maxVisits: number
  /**
   * 搜索时间上限（秒，KataGo analysis 官方参数）：与 maxVisits 先到者停，
   * 到点引擎自动输出当前结果并结束。对弈注入档用做每手耗时兜底，防止慢设备卡死。
   */
  maxTime?: number
  /** 历史着法：[color, vertex] 或 [color, null]（pass） */
  moves: [string, [number, number] | null][]
  /**
   * 初始摆子（死活题等静态局面）：先摆子再按 moves 落子。
   * KataGo 分析引擎 initialStones 协议，key 为 'B'/'W'。
   */
  initialStones?: { B?: [number, number][]; W?: [number, number][] }
  /**
   * Cross-stack correlation id (optional): shared between the frontend console
   * and backend logs so the same analysis stays traceable across engine sources.
   * Generated per call when absent; the Local engine forwards it as
   * `correlation_id` in the request body, the WASM engine only logs it.
   */
  correlationId?: string
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
  /**
   * KataGo analysis 的完整 policy 数组（row-major，y 自顶部，长度 boardSize²+1，末位 pass）。
   * 仅 WASM 引擎输出（查询带 includePolicy），供盲注错误注入（rankInjection）选点；
   * Local 引擎不解析该字段，为 null。
   */
  policy?: number[] | null
  /**
   * 地盘预测（ownership），KataGo rootInfo.ownership。
   * 长度 = boardSize * boardSize，值域约 [-1, 1]：
   * 正 = 黑方地盘、负 = 白方地盘，绝对值越大越实。
   */
  ownership?: number[] | null
}

/** AI 应手结果（已随 AI 对弈删除） */
export type GenmoveResult = never

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
 * 围棋引擎统一接口（仅分析职责）。
 *
 * 实现者：
 * - WasmEngine（browser：KataGo WASM 在 Web Worker 内运行）
 * - LocalEngine（local：通过 fetch 调用本地 FastAPI 后端 + 原生 KataGo）
 */
export interface GoEngine {
  /** 初始化引擎（加载模型等），完成后 resolve */
  init(): Promise<void>

  /**
   * 局面分析：给定历史着法，返回候选选点与胜率。
   * onSnapshot 可选：搜索期间的中间快照回调（增量渲染用，终态仍由返回值给出）。
   */
  analyze(
    query: AnalysisQuery,
    onSnapshot?: (result: AnalysisResult) => void,
  ): Promise<AnalysisResult>

  /**
   * 取消排队中的局面分析：
   * - WASM：worker 串行队列，取消未开始的普通分析并忽略进行中结果
   * - Local：分析走后端独立任务，不阻塞，no-op
   */
  cancelAnalysis(): void

  /** 引擎是否已初始化完成 */
  isReady(): boolean

  /** 获取引擎元信息 */
  getInfo(): EngineInfo

  /** 销毁引擎（释放资源） */
  destroy(): void
}
