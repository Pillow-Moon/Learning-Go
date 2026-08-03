/**
 * 复盘状态（Zustand）：棋谱加载、导航、整盘逐手分析、胜率曲线、关键点标注。
 *
 * 分析为串行队列：从第 1 手局面逐手分析到最后，每手结果写入 points[position]，
 * 可随时停止（已分析部分保留）。曲线与标注由 points 推导。
 */
import { create } from 'zustand'
import GoBoard from '@sabaki/go-board'

import { getCurrentEngine } from '../engines/manager'
import { useSettingsStore } from './settingsStore'
import { buildEngineMoves } from '../lib/boardUtils'
import { verdictFor } from '../lib/reviewThresholds'
import type { BoardSize, Move, Player, Vertex } from '../lib/types'

/** 整盘分析单点结果 */
export interface ReviewPoint {
  /** 局面编号 = 已落子手数（0 = 开局） */
  position: number
  /** 黑胜率（引擎统一输出黑方视角，0~1） */
  blackWinrate: number | null
  /** 黑方视角目差（正 = 黑领先） */
  scoreLead: number | null
  /** 本局面 AI 推荐榜首着法 */
  topMove: [number, number] | null
  /** 榜首着法的黑方胜率 */
  topWinrate: number | null
  /** 榜首变化图 */
  topPv: [number, number][]
  /** 对「第 position 手」（即 moves[position-1]）的标注；position=0 无标注 */
  verdict: 'good' | 'doubt' | 'bad' | null
  /** 该手胜率损失（黑视角，0~1）；无标注为 null */
  loss: number | null
}

/** 复盘棋谱输入 */
export interface ReviewGame {
  boardSize: BoardSize
  komi: number
  handicap?: number
  handicapStones?: Vertex[]
  moves: Move[]
  result?: string | null
  name?: string | null
}

export type ReviewAnalysisStatus = 'idle' | 'running' | 'done' | 'error'

/**
 * 整盘分析每手 visits：
 * - Local：200 visits/手（19 路约数百手，RTX 级 1~3 分钟可跑完整盘）
 * - WASM：25 visits/手（单线程 + 每次重建 Module，慢；主要用于 9/13 路小棋谱）
 */
const REVIEW_VISITS_LOCAL = 200
const REVIEW_VISITS_WASM = 25

interface ReviewState {
  boardSize: BoardSize
  komi: number
  handicap: number
  handicapStones: Vertex[]
  moves: Move[]
  result: string | null
  name: string | null
  loaded: boolean

  /** 当前显示到第几手（0 = 开局，moves.length = 终局） */
  moveIndex: number

  /** 整盘分析结果，下标 = position（0..moves.length） */
  points: (ReviewPoint | null)[]
  analysisStatus: ReviewAnalysisStatus
  analysisError: string | null
  /** 已完成分析的 position 数（含跳过），用于进度显示 */
  analyzedCount: number

  loadGame: (game: ReviewGame) => void
  gotoMove: (index: number) => void
  stepMove: (delta: number) => void
  /** 摆子：在最后一手后续下（研究页用）；合法返回 true */
  appendMove: (vertex: Vertex) => boolean
  /** 整盘分析：restart=true 从头开始；false 从第一个未分析点继续 */
  analyzeAll: (restart?: boolean) => Promise<void>
  stopAnalysis: () => void
  clear: () => void
}

/** 由着法序列 + 让子重建棋盘（导出供复盘页使用） */
export function buildBoardFromMoves(
  boardSize: BoardSize,
  moves: Move[],
  handicapStones: Vertex[] = [],
): GoBoard {
  // @sabaki/go-board 为 immutable：set/makeMove 返回新棋盘，必须接收返回值
  let board = GoBoard.fromDimensions(boardSize, boardSize)
  for (const v of handicapStones) board = board.set(v, 1)
  for (const m of moves) {
    if (m.pass || m.vertex == null) continue
    const analysis = board.analyzeMove(m.color, m.vertex)
    if (analysis.overwrite || analysis.suicide || analysis.ko) continue
    board = board.makeMove(m.color, m.vertex)
  }
  return board
}

/** 整盘分析取消标志（分析循环与 stopAnalysis 共享） */
let cancelFlag = false

export const useReviewStore = create<ReviewState>((set, get) => {
  /** 引擎取消当前分析（Local 后台任务 / WASM 队列取消） */
  const cancelCurrent = () => {
    try {
      getCurrentEngine().cancelAnalysis()
    } catch {
      // 引擎未初始化时忽略
    }
  }

  return {
    boardSize: 19,
    komi: 7.5,
    handicap: 0,
    handicapStones: [],
    moves: [],
    result: null,
    name: null,
    loaded: false,
    moveIndex: 0,
    points: [],
    analysisStatus: 'idle',
    analysisError: null,
    analyzedCount: 0,

    loadGame: (game) => {
      cancelCurrent()
      set({
        boardSize: game.boardSize,
        komi: game.komi,
        handicap: game.handicap ?? 0,
        handicapStones: game.handicapStones ?? [],
        moves: game.moves,
        result: game.result ?? null,
        name: game.name ?? null,
        loaded: true,
        moveIndex: 0,
        points: new Array(game.moves.length + 1).fill(null),
        analysisStatus: 'idle',
        analysisError: null,
        analyzedCount: 0,
      })
    },

    gotoMove: (index) => {
      const { moves } = get()
      const clamped = Math.max(0, Math.min(moves.length, index))
      set({ moveIndex: clamped })
    },

    stepMove: (delta) => {
      const { moves, moveIndex } = get()
      set({ moveIndex: Math.max(0, Math.min(moves.length, moveIndex + delta)) })
    },

    appendMove: (vertex) => {
      const { boardSize, moves, moveIndex, handicapStones } = get()
      // 非最后一手：先截断后续再落子
      const base = moves.slice(0, moveIndex)
      const color: Player = base.length % 2 === 0 ? 1 : -1
      const board = buildBoardFromMoves(boardSize, base, handicapStones)
      const an = board.analyzeMove(color, vertex)
      if (an.overwrite || an.suicide || an.ko) return false
      const next = [...base, { n: base.length + 1, color, vertex, pass: false }]
      // 追加后旧分析失效（保留已分析部分无意义，直接清空）
      cancelCurrent()
      set({
        moves: next,
        moveIndex: next.length,
        points: new Array(next.length + 1).fill(null),
        analysisStatus: 'idle',
        analysisError: null,
        analyzedCount: 0,
      })
      return true
    },

    analyzeAll: async (restart = false) => {
      const s = get()
      const engine = getCurrentEngine()
      if (s.analysisStatus === 'running') return
      if (!engine.isReady()) {
        set({
          analysisStatus: 'error',
          analysisError: '引擎未就绪。请检查本地后端是否已启动，或在设置中切换引擎来源。',
        })
        return
      }
      const { engineSource } = useSettingsStore.getState()
      const visits =
        engineSource === 'local' ? REVIEW_VISITS_LOCAL : REVIEW_VISITS_WASM

      const total = s.moves.length
      if (total === 0) {
        set({ analysisStatus: 'done', analyzedCount: 1 })
        return
      }

      const points = restart
        ? new Array<ReviewPoint | null>(total + 1).fill(null)
        : [...s.points]
      // 从第一个未分析点继续
      let start = points.findIndex((p) => p == null)
      if (start === -1) start = total

      cancelFlag = false
      set({
        points,
        analysisStatus: 'running',
        analysisError: null,
        analyzedCount: start,
      })

      for (let pos = start; pos <= total; pos++) {
        if (cancelFlag) break
        const engineMoves = buildEngineMoves(s.moves.slice(0, pos), s.handicapStones)

        try {
          const res = await engine.analyze({
            boardSize: s.boardSize,
            komi: s.komi,
            maxVisits: visits,
            moves: engineMoves,
          })
          if (cancelFlag) break

          const rootWr = res.root?.winrate ?? null
          // KataGo 输出为黑方视角（BLACK cfg）：winrate 恒为黑方胜率
          const blackWinrate = rootWr

          const top = res.candidates?.[0] ?? null
          const topWinrate = top?.winrate ?? null

          // 标注（第 pos 手 = moves[pos-1]）：该手后黑胜率 vs 前局面榜首黑胜率
          let verdict: ReviewPoint['verdict'] = null
          let loss: number | null = null
          const isPass = pos >= 1 && s.moves[pos - 1].pass
          if (pos >= 1 && !isPass) {
            const prev = points[pos - 1]
            // prevTopWinrate 为前局面的黑方胜率（榜首着法落子后的黑方视角）
            const prevTopBlack = prev?.topWinrate != null && prev.topMove != null ? prev.topWinrate : null
            if (prevTopBlack != null && blackWinrate != null) {
              loss = prevTopBlack - blackWinrate
              verdict = verdictFor(loss)
            }
          }

          points[pos] = {
            position: pos,
            blackWinrate,
            scoreLead: res.root?.scoreLead ?? null,
            topMove: top?.move ?? null,
            topWinrate,
            topPv: top?.pv ?? [],
            verdict,
            loss,
          }
          set({ points: [...points], analyzedCount: pos + 1 })
        } catch (err) {
          if (cancelFlag) break
          // 单点失败：终止分析并报错（保留已分析部分）
          set({
            analysisStatus: 'error',
            analysisError: err instanceof Error ? err.message : '分析失败',
          })
          return
        }
      }

      set({ analysisStatus: 'done' })
    },

    stopAnalysis: () => {
      cancelFlag = true
      cancelCurrent()
      set({ analysisStatus: 'done' })
    },

    clear: () => {
      cancelCurrent()
      set({
        boardSize: 19,
        komi: 7.5,
        handicap: 0,
        handicapStones: [],
        moves: [],
        result: null,
        name: null,
        loaded: false,
        moveIndex: 0,
        points: [],
        analysisStatus: 'idle',
        analysisError: null,
        analyzedCount: 0,
      })
    },
  }
})
