/**
 * 对局状态机（Zustand）。
 *
 * 规则引擎使用 @sabaki/go-board：
 *  - analyzeMove 做合法性校验（占位 / 自杀 / 打劫）
 *  - makeMove 应用落子，自动处理提子与劫的追踪
 *
 * 状态流转：
 *  idle -> playing(等待用户) -> waiting_ai(等待AI) -> playing -> ... -> finished
 *  本地双人模式下不会出现 waiting_ai。
 */
import { create } from 'zustand'
import GoBoard from '@sabaki/go-board'

import type {
  BoardSize,
  GameMode,
  GameStatus,
  Move,
  Player,
  Vertex,
} from '../lib/types'
import { getCurrentEngine } from '../engines/manager'
import { recommendVisits } from '../engines/benchmark'
import { useSettingsStore } from './settingsStore'

/** 连续 pass 两次视为终局 */
const PASS_TO_END = 2

export interface NewGameOpts {
  size?: BoardSize
  mode?: GameMode
  aiColor?: Player
  maxVisits?: number
  komi?: number
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

  // 人机对弈配置
  gameMode: GameMode
  aiColor: Player
  komi: number
  maxVisits: number
  aiError: string | null

  newGame: (opts?: NewGameOpts) => void
  playMove: (vertex: Vertex) => boolean
  pass: () => void
  resign: () => void
  undo: () => void
  requestAiMove: () => Promise<void>
  clearAiError: () => void
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
  /** 内部：把一手已校验的着法推入状态（ stone 或 pass ）。 */
  const pushMove = (move: Move, newBoard: GoBoard, lastMove: Vertex | null) => {
    const { board, moves, history } = get()
    const newMoves = [...moves, move]
    const finished = trailingPasses(newMoves) >= PASS_TO_END
    set({
      history: [...history, board],
      board: newBoard,
      moves: newMoves,
      currentPlayer: (move.color === 1 ? -1 : 1) as Player,
      lastMove,
      status: finished ? 'finished' : 'playing',
      result: finished ? '双方虚手，对局结束' : null,
    })
  }

  /** 内部：若处于人机模式且轮到 AI，则触发 AI 应手。 */
  const maybeTriggerAi = () => {
    const s = get()
    if (
      s.gameMode === 'human_vs_ai' &&
      s.status === 'playing' &&
      s.currentPlayer === s.aiColor
    ) {
      void s.requestAiMove()
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
    gameMode: 'human_vs_human',
    aiColor: -1,
    komi: 7.5,
    maxVisits: 100,
    aiError: null,

    newGame: (opts) => {
      const size = opts?.size ?? get().boardSize
      set({
        boardSize: size,
        board: emptyBoard(size),
        currentPlayer: 1,
        moves: [],
        status: 'playing',
        result: null,
        lastMove: null,
        history: [],
        gameMode: opts?.mode ?? 'human_vs_human',
        aiColor: opts?.aiColor ?? -1,
        komi: opts?.komi ?? 7.5,
        maxVisits: opts?.maxVisits ?? 100,
        aiError: null,
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
      maybeTriggerAi()
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
      maybeTriggerAi()
    },

    resign: () => {
      const { status, currentPlayer } = get()
      if (status !== 'playing' && status !== 'waiting_ai') return
      const winner = currentPlayer === 1 ? '白' : '黑'
      set({ status: 'finished', result: `${winner}中盘胜` })
    },

    undo: () => {
      const { history, moves, status } = get()
      if (history.length === 0) return
      const newHistory = history.slice(0, -1)
      const prevBoard = history[history.length - 1]
      const newMoves = moves.slice(0, -1)
      const last = newMoves[newMoves.length - 1]
      set({
        history: newHistory,
        board: prevBoard,
        moves: newMoves,
        currentPlayer: (newMoves.length % 2 === 0 ? 1 : -1) as Player,
        lastMove: last && !last.pass ? last.vertex : null,
        status: status === 'finished' ? 'playing' : status,
        result: null,
        aiError: null,
      })
    },

    requestAiMove: async () => {
      const s = get()
      if (s.status !== 'playing' || s.currentPlayer !== s.aiColor) return
      set({ status: 'waiting_ai', aiError: null })

      const engine = getCurrentEngine()
      if (!engine.isReady()) {
        set({
          status: 'playing',
          aiError: '引擎未就绪。请检查：本地后端是否已启动？或在设置中切换引擎来源。',
        })
        return
      }

      // 自适应 maxVisits（若用户未手动覆盖）
      const { benchmarkScore, aiStrength } = useSettingsStore.getState()
      let visits = s.maxVisits
      if (benchmarkScore > 0) {
        const ratio = aiStrength === 'fast' ? 0.5 : aiStrength === 'strong' ? 2 : 1
        visits = Math.round(recommendVisits(benchmarkScore, 'move') * ratio)
      }

      const engineMoves: [string, [number, number] | null][] = s.moves.map((m) => [
        m.color === 1 ? 'B' : 'W',
        m.vertex,
      ])

      try {
        const resp = await engine.genmove(
          s.aiColor,
          s.boardSize,
          s.komi,
          visits,
          engineMoves,
        )
        const cur = get()
        if (cur.status !== 'waiting_ai') return

        if (resp.coord === 'resign') {
          const winner = s.aiColor === 1 ? '白' : '黑'
          set({ status: 'finished', result: `${winner}中盘胜（AI 认输）` })
          return
        }
        if (resp.coord === 'pass' || resp.vertex === null) {
          const move: Move = {
            n: cur.moves.length + 1,
            color: s.aiColor,
            vertex: null,
            pass: true,
          }
          pushMove(move, cur.board, null)
          return
        }
        const analysis = cur.board.analyzeMove(s.aiColor, resp.vertex)
        if (analysis.overwrite || analysis.suicide || analysis.ko) {
          const move: Move = {
            n: cur.moves.length + 1,
            color: s.aiColor,
            vertex: null,
            pass: true,
          }
          pushMove(move, cur.board, null)
          return
        }
        const newBoard = cur.board.makeMove(s.aiColor, resp.vertex)
        const move: Move = {
          n: cur.moves.length + 1,
          color: s.aiColor,
          vertex: resp.vertex,
          pass: false,
        }
        pushMove(move, newBoard, resp.vertex)
      } catch (err) {
        set({
          status: 'playing',
          aiError: err instanceof Error ? err.message : 'AI 请求失败',
        })
      }
    },

    clearAiError: () => set({ aiError: null }),
  }
})
