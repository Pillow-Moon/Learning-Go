/**
 * 局面分析状态（Zustand）。
 * 调用后端 Analysis 接口，获取候选选点/胜率/变化图，供棋盘叠加显示与解说使用。
 */
import { create } from 'zustand'

import { getCurrentEngine } from '../engines/manager'
import { useSettingsStore } from './settingsStore'
import { aiVisitsFor, getScenarioMaxStrength } from '../lib/strength'
import type { AnalysisResult, Candidate } from '../engines/types'

interface AnalysisState {
  candidates: Candidate[] | null
  rootWinrate: number | null
  rootScoreLead: number | null
  /** 地盘预测（正=黑、负=白，绝对值越大越实） */
  ownership: number[] | null
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
  /** 停止当前分析（WASM：取消排队中的分析并忽略进行中结果，避免阻塞 AI 落子） */
  stopAnalysis: () => void
  clear: () => void
}

/**
 * WASM 单线程 + 串行队列：单次分析搜索量上限。
 * 超出后分析耗时数分钟，会阻塞对弈落子（genmove 在 worker 队列中排队）。
 * 500 visits 约 17~40s（19 路 @15~30 v/s）+ 重建 3~5s，教学参考足够。
 */
const ANALYSIS_MAX_VISITS_WASM = 500

export const useAnalysisStore = create<AnalysisState>((set) => ({
  candidates: null,
  rootWinrate: null,
  rootScoreLead: null,
  ownership: null,
  analyzing: false,
  error: null,
  analyzedMoveCount: -1,

  analyze: async ({ moves, boardSize, komi }: {
    moves: { color: string; vertex: [number, number] | null }[]
    boardSize: number
    komi: number
    maxVisits: number
  }) => {
    set({ analyzing: true, error: null })
    // 节流定时器：try 与 catch 都需要访问，故声明在函数级
    let pendingTimer: ReturnType<typeof setTimeout> | null = null
    try {
      const engine = getCurrentEngine()
      if (!engine.isReady()) {
        throw new Error('引擎未就绪')
      }

      // 分析始终用「当前引擎/模型可达的最高等级」（按分析场景的时间预算折算）
      const { engineSource, localBenchmarkScore, wasmBenchmarkScore } =
        useSettingsStore.getState()
      const bScore =
        engineSource === 'local' ? localBenchmarkScore : wasmBenchmarkScore
      const engineModel = engine.getInfo().model
      const maxStrength = getScenarioMaxStrength(
        engineSource,
        engineModel,
        bScore,
        'analysis',
      )
      const rawVisits = aiVisitsFor(maxStrength, 'analysis', engineModel)
      // WASM 限制单次分析搜索量（串行队列会阻塞对弈落子，见 ANALYSIS_MAX_VISITS_WASM）
      const visits =
        engineSource === 'browser'
          ? Math.min(rawVisits, ANALYSIS_MAX_VISITS_WASM)
          : rawVisits

      const engineMoves: [string, [number, number] | null][] = moves.map((m) => [
        m.color,
        m.vertex,
      ])

      // 中间快照节流：搜索期间 KataGo 周期性输出中间态，300ms 合并一次渲染，
      // 避免高频 set 造成频繁重渲染；节流期间保持 analyzing=true。
      const SNAPSHOT_INTERVAL_MS = 300
      let lastRender = 0
      let pendingSnapshot: AnalysisResult | null = null

      const applySnapshot = (snapshot: AnalysisResult) => {
        set({
          candidates: snapshot.candidates as Candidate[],
          rootWinrate: snapshot.root?.winrate ?? null,
          rootScoreLead: snapshot.root?.scoreLead ?? null,
          ownership: snapshot.ownership ?? null,
          analyzing: true,
        })
      }

      const onSnapshot = (snapshot: AnalysisResult) => {
        const now = Date.now()
        if (now - lastRender >= SNAPSHOT_INTERVAL_MS) {
          lastRender = now
          applySnapshot(snapshot)
          return
        }
        // 距上次渲染不足 300ms：暂存最新快照，稍后补一次渲染
        pendingSnapshot = snapshot
        if (!pendingTimer) {
          pendingTimer = setTimeout(() => {
            pendingTimer = null
            if (pendingSnapshot) {
              lastRender = Date.now()
              applySnapshot(pendingSnapshot)
              pendingSnapshot = null
            }
          }, SNAPSHOT_INTERVAL_MS - (now - lastRender))
        }
      }

      const result = await engine.analyze(
        {
          boardSize,
          komi,
          maxVisits: visits,
          moves: engineMoves,
        },
        onSnapshot,
      )
      if (pendingTimer) {
        clearTimeout(pendingTimer)
        pendingTimer = null
      }
      set({
        candidates: result.candidates as Candidate[],
        rootWinrate: result.root?.winrate ?? null,
        rootScoreLead: result.root?.scoreLead ?? null,
        ownership: result.ownership ?? null,
        analyzing: false,
        analyzedMoveCount: moves.length,
      })
    } catch (err) {
      if (pendingTimer) {
        clearTimeout(pendingTimer)
        pendingTimer = null
      }
      // 主动取消（stopAnalysis / AI 落子前自动停止）：不视为错误
      if (err instanceof Error && err.name === 'AbortError') {
        set({ analyzing: false })
        return
      }
      set({
        analyzing: false,
        error: err instanceof Error ? err.message : '分析失败',
      })
    }
  },

  stopAnalysis: () => {
    getCurrentEngine().cancelAnalysis()
    set({ analyzing: false })
  },

  clear: () =>
    set({
      candidates: null,
      rootWinrate: null,
      rootScoreLead: null,
      ownership: null,
      error: null,
      analyzedMoveCount: -1,
    }),
}))
