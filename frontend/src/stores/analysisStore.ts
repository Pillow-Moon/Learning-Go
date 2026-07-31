/**
 * 局面分析状态（Zustand）。
 * 调用后端 Analysis 接口，获取候选选点/胜率/变化图，供棋盘叠加显示与解说使用。
 */
import { create } from 'zustand'

import { analyzePosition, type Candidate, type MoveDto } from '../services/api'

interface AnalysisState {
  candidates: Candidate[] | null
  rootWinrate: number | null
  rootScoreLead: number | null
  analyzing: boolean
  error: string | null
  /** 当前分析对应的局面手数（用于判断是否过期） */
  analyzedMoveCount: number

  analyze: (params: {
    moves: MoveDto[]
    boardSize: number
    komi: number
    maxVisits: number
  }) => Promise<void>
  clear: () => void
}

export const useAnalysisStore = create<AnalysisState>((set) => ({
  candidates: null,
  rootWinrate: null,
  rootScoreLead: null,
  analyzing: false,
  error: null,
  analyzedMoveCount: -1,

  analyze: async ({ moves, boardSize, komi, maxVisits }) => {
    set({ analyzing: true, error: null })
    try {
      const result = await analyzePosition({
        board_size: boardSize,
        komi,
        max_visits: maxVisits,
        moves,
      })
      set({
        candidates: result.candidates,
        rootWinrate: result.root?.winrate ?? null,
        rootScoreLead: result.root?.score_lead ?? null,
        analyzing: false,
        analyzedMoveCount: moves.length,
      })
    } catch (err) {
      set({
        analyzing: false,
        error: err instanceof Error ? err.message : '分析失败',
      })
    }
  },

  clear: () =>
    set({
      candidates: null,
      rootWinrate: null,
      rootScoreLead: null,
      error: null,
      analyzedMoveCount: -1,
    }),
}))
