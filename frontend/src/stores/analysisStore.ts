/**
 * 局面分析状态（Zustand）。
 * 调用后端 Analysis 接口，获取候选选点/胜率/变化图，供棋盘叠加显示与解说使用。
 */
import { create } from 'zustand'

import { getCurrentEngine } from '../engines/manager'
import { recommendVisits } from '../engines/benchmark'
import { useSettingsStore } from './settingsStore'
import type { Candidate } from '../engines/types'

interface AnalysisState {
  candidates: Candidate[] | null
  rootWinrate: number | null
  rootScoreLead: number | null
  analyzing: boolean
  error: string | null
  /** 当前分析对应的局面手数（用于判断是否过期） */
  analyzedMoveCount: number

  analyze: (params: {
    moves: { color: string; vertex: [number, number] | null }[]
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

  analyze: async ({ moves, boardSize, komi, maxVisits }: {
    moves: { color: string; vertex: [number, number] | null }[]
    boardSize: number
    komi: number
    maxVisits: number
  }) => {
    set({ analyzing: true, error: null })
    try {
      const engine = getCurrentEngine()
      if (!engine.isReady()) {
        throw new Error('引擎未就绪')
      }

      // 自适应 maxVisits
      const { benchmarkScore, aiStrength } = useSettingsStore.getState()
      let visits = maxVisits
      if (benchmarkScore > 0) {
        const ratio = aiStrength === 'fast' ? 0.5 : aiStrength === 'strong' ? 2 : 1
        visits = Math.round(recommendVisits(benchmarkScore, 'analysis') * ratio)
      }

      const engineMoves: [string, [number, number] | null][] = moves.map((m) => [
        m.color,
        m.vertex,
      ])

      const result = await engine.analyze({
        boardSize,
        komi,
        maxVisits: visits,
        moves: engineMoves,
      })
      set({
        candidates: result.candidates as Candidate[],
        rootWinrate: result.root?.winrate ?? null,
        rootScoreLead: result.root?.scoreLead ?? null,
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
