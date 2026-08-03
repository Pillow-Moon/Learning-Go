/**
 * 对局状态机（Zustand）——本地双人对弈。
 *
 * 规则引擎使用 @sabaki/go-board：
 *  - analyzeMove 做合法性校验（占位 / 自杀 / 打劫）
 *  - makeMove 应用落子，自动处理提子与劫的追踪
 *
 * 2026-08 精简：AI 对弈已移除（对局使用星阵等外部平台，本平台专注复盘），
 * 本状态机只承担本地双人（同屏轮换落子）与棋谱保存。
 *
 * 状态流转：idle -> playing -> ... -> finished（双虚手进入 scoring 确认）。
 */
import { create } from 'zustand'
import GoBoard from '@sabaki/go-board'

import type { BoardSize, GameStatus, Move, Player, Vertex } from '../lib/types'
import { useAnalysisStore } from './analysisStore'
import { movesToSgf, getHandicapPoints } from '../lib/sgf'
import { saveGame } from '../lib/db'

/** 连续 pass 两次视为终局 */
const PASS_TO_END = 2

export interface NewGameOpts {
  size?: BoardSize
  komi?: number
  /** 让子数（0-9，黑摆子，白先走；贴目自动改为 0.5） */
  handicap?: number
}

interface GameState {
  boardSize: BoardSize
  board: GoBoard
  currentPlayer: Player
  moves: Move[]
  status: GameStatus
  result: string | null
  lastMove: Vertex | null
  history: GoBoard[]

  komi: number
  /** 本局让子数（0 = 无让子） */
  handicap: number
  /** 让子摆位（黑） */
  handicapStones: Vertex[]

  newGame: (opts?: NewGameOpts) => void
  playMove: (vertex: Vertex) => boolean
  pass: () => void
  resign: () => void
  undo: () => void
  /** 点目确认：以最后一次分析结果计算胜负并结束对局 */
  confirmScoring: () => void
  /** 继续对弈：撤销最后两手虚手，回到对局 */
  continueScoring: () => void
  /** 对局结束后重置：清空棋盘与着法，回到未开始（idle）状态，保留设置表单 */
  resetToSetup: () => void
}

function emptyBoard(size: BoardSize): GoBoard {
  return GoBoard.fromDimensions(size, size)
}

function trailingPasses(moves: Move[]): number {
  let count = 0
  for (let i = moves.length - 1; i >= 0; i--) {
    if (moves[i].pass) count++
    else break
  }
  return count
}

export const useGameStore = create<GameState>((set, get) => {
  /** 对局结束时自动保存到 IndexedDB（含 SGF 序列化） */
  const autoSave = () => {
    const s = get()
    if (s.status !== 'finished' || s.moves.length === 0) return
    let sgf = ''
    try {
      sgf = movesToSgf({
        boardSize: s.boardSize,
        komi: s.komi,
        result: s.result ?? undefined,
        moves: s.moves,
        handicapStones: s.handicapStones,
      })
    } catch {
      // SGF 序列化失败不阻塞保存
    }
    const record = {
      boardSize: s.boardSize,
      komi: s.komi,
      mode: 'local',
      result: s.result ?? '未知',
      sgf,
      createdAt: '',
      moves: s.moves.map((m) => ({
        n: m.n,
        color: m.color,
        vertex: m.vertex,
        pass: m.pass,
      })),
    }
    saveGame(record).catch(() => {
      // IndexedDB 保存失败静默忽略
    })
  }

  /** 内部：把一手已校验的着法推入状态（ stone 或 pass ）。
   *  连续两次虚手进入「点目」状态（scoring），由用户确认后结束。 */
  const pushMove = (move: Move, newBoard: GoBoard, lastMove: Vertex | null) => {
    const { board, moves, history } = get()
    const newMoves = [...moves, move]
    const doublePass = trailingPasses(newMoves) >= PASS_TO_END
    set({
      history: [...history, board],
      board: newBoard,
      moves: newMoves,
      currentPlayer: (move.color === 1 ? -1 : 1) as Player,
      lastMove,
      status: doublePass ? 'scoring' : 'playing',
      result: null,
    })
    if (doublePass) {
      // 双虚手：进入点目确认，不自动保存（确认后才结束）
      useAnalysisStore.getState().clear()
    }
  }

  return {
    boardSize: 19,
    board: emptyBoard(19),
    currentPlayer: 1,
    moves: [],
    status: 'idle',
    result: null,
    lastMove: null,
    history: [],
    komi: 7.5,
    handicap: 0,
    handicapStones: [],

    newGame: (opts) => {
      const size = opts?.size ?? get().boardSize
      const handicap = opts?.handicap ?? 0
      // 让子摆位（黑），让子棋白先走、贴目 0.5
      const stones = handicap > 0 ? getHandicapPoints(size, handicap) : []
      const board = emptyBoard(size)
      for (const v of stones) board.set(v, 1)
      set({
        boardSize: size,
        board,
        currentPlayer: handicap > 0 ? -1 : 1,
        moves: [],
        status: 'playing',
        result: null,
        lastMove: null,
        history: [],
        komi: handicap > 0 ? 0.5 : opts?.komi ?? 7.5,
        handicap,
        handicapStones: stones,
      })
    },

    playMove: (vertex) => {
      const { status, board, currentPlayer, moves } = get()
      if (status !== 'playing') return false
      const analysis = board.analyzeMove(currentPlayer, vertex)
      if (analysis.overwrite || analysis.suicide || analysis.ko) return false
      const newBoard = board.makeMove(currentPlayer, vertex)
      const move: Move = {
        n: moves.length + 1,
        color: currentPlayer,
        vertex,
        pass: false,
      }
      pushMove(move, newBoard, vertex)
      return true
    },

    pass: () => {
      const { status, board, currentPlayer, moves } = get()
      if (status !== 'playing') return
      const move: Move = {
        n: moves.length + 1,
        color: currentPlayer,
        vertex: null,
        pass: true,
      }
      pushMove(move, board, null)
    },

    resign: () => {
      const { status, currentPlayer } = get()
      if (status !== 'playing') return
      const winner = currentPlayer === 1 ? '白' : '黑'
      set({ status: 'finished', result: `${winner}中盘胜` })
      autoSave()
    },

    undo: () => {
      const { history, moves, status, handicap } = get()
      if (history.length === 0) return
      const newHistory = history.slice(0, -1)
      const prevBoard = history[history.length - 1]
      const newMoves = moves.slice(0, -1)
      const last = newMoves[newMoves.length - 1]
      // 下一手行棋方 = 被撤销那手的一方（让子棋撤销到开局时为白先）
      const undone = moves[moves.length - 1]
      const currentPlayer = undone
        ? undone.color
        : ((handicap > 0 ? -1 : 1) as Player)
      set({
        history: newHistory,
        board: prevBoard,
        moves: newMoves,
        currentPlayer,
        lastMove: last && !last.pass ? last.vertex : null,
        status: status === 'finished' || status === 'scoring' ? 'playing' : status,
        result: null,
      })
    },

    /** 点目确认：以最后一次分析结果计算胜负并结束对局 */
    confirmScoring: () => {
      const s = get()
      if (s.status !== 'scoring') return
      const analysis = useAnalysisStore.getState()
      const scoreLead = analysis.rootScoreLead
      let result: string
      if (scoreLead != null) {
        // 引擎统一输出黑方视角：scoreLead 正 = 黑领先
        const blackDiff = scoreLead
        if (Math.abs(blackDiff) < 0.05) {
          result = '和棋'
        } else {
          const winner = blackDiff > 0 ? '黑' : '白'
          result = `${winner}胜 ${Math.abs(blackDiff).toFixed(1)} 目`
        }
      } else {
        result = '双方虚手，对局结束'
      }
      set({ status: 'finished', result })
      autoSave()
    },

    /** 继续对弈：撤销最后两手虚手，回到对局 */
    continueScoring: () => {
      const s = get()
      if (s.status !== 'scoring') return
      s.undo()
      s.undo()
    },

    resetToSetup: () => {
      const { boardSize } = get()
      set({
        boardSize,
        board: emptyBoard(boardSize),
        currentPlayer: 1,
        moves: [],
        status: 'idle',
        result: null,
        lastMove: null,
        history: [],
        handicap: 0,
        handicapStones: [],
      })
    },
  }
})
