/**
 * 棋局诊断状态（Zustand）：批量整盘分析 → 单局错误分类 → 聚合统计。
 *
 * - 分析逻辑与 reviewStore.analyzeAll 一致（Local 200 / WASM 25 visits 每手）；
 * - 已诊断过的对局自动复用缓存（IndexedDB diagnostics 表）；
 * - LLM 报告由页面层调用 lib/llm 生成，store 保持无网络 IO。
 */
import { create } from 'zustand'

import { getCurrentEngine } from '../engines/manager'
import { useSettingsStore } from './settingsStore'
import type { ReviewPoint } from './reviewStore'
import { buildEngineMoves } from '../lib/boardUtils'
import { diagnoseGame, type GameDiagnosis } from '../lib/diagnosis'
import { aggregateDiagnoses, type DiagnosisStats } from '../lib/diagnosisStats'
import { getDiagnosis, listGames, saveDiagnosis, type GameRecord } from '../lib/db'
import { verdictFor } from '../lib/reviewThresholds'
import type { BoardSize, Move } from '../lib/types'

/** 诊断分析每手 visits：与 reviewStore 一致（Local 200 / WASM 25） */
const DIAG_VISITS_LOCAL = 200
const DIAG_VISITS_WASM = 25

export type DiagnosisStatus = 'idle' | 'running' | 'done' | 'error'

interface DiagnosisState {
  status: DiagnosisStatus
  progress: { done: number; total: number; currentName: string | null }
  error: string | null
  /** 当前批次诊断结果（按时间倒序） */
  diagnostics: GameDiagnosis[]
  stats: DiagnosisStats | null

  /** 批量诊断：已缓存的复用，未分析的逐局整盘分析后分类入库 */
  analyzeGames: (gameIds: number[]) => Promise<void>
  stopAnalysis: () => void
  /** 仅从库中加载已有诊断（不触发分析） */
  refresh: (gameIds: number[]) => Promise<void>
  clear: () => void
}

let cancelFlag = false

/** 单局整盘逐手分析（与 reviewStore.analyzeAll 同逻辑），返回分类结果 */
async function analyzeSingleGame(rec: GameRecord): Promise<GameDiagnosis | null> {
  const total = rec.moves.length
  if (total === 0) return null

  const engine = getCurrentEngine()
  const { engineSource } = useSettingsStore.getState()
  const visits = engineSource === 'local' ? DIAG_VISITS_LOCAL : DIAG_VISITS_WASM
  const boardSize = rec.boardSize as BoardSize
  const points: (ReviewPoint | null)[] = new Array(total + 1).fill(null)

  for (let pos = 1; pos <= total; pos++) {
    if (cancelFlag) return null
    const res = await engine.analyze({
      boardSize,
      komi: rec.komi,
      maxVisits: visits,
      moves: buildEngineMoves(rec.moves.slice(0, pos)),
    })
    if (cancelFlag) return null

    const rootWr = res.root?.winrate ?? null
    const top = res.candidates?.[0] ?? null
    // 标注（第 pos 手 = moves[pos-1]）：该手后黑胜率 vs 前局面榜首黑胜率
    let verdict: ReviewPoint['verdict'] = null
    let loss: number | null = null
    const isPass = rec.moves[pos - 1].pass
    if (!isPass) {
      const prev = points[pos - 1]
      const prevTopBlack =
        prev?.topWinrate != null && prev.topMove != null ? prev.topWinrate : null
      if (prevTopBlack != null && rootWr != null) {
        loss = prevTopBlack - rootWr
        verdict = verdictFor(loss)
      }
    }
    points[pos] = {
      position: pos,
      blackWinrate: rootWr,
      scoreLead: res.root?.scoreLead ?? null,
      topMove: top?.move ?? null,
      topWinrate: top?.winrate ?? null,
      topPv: top?.pv ?? [],
      verdict,
      loss,
    }
  }

  return diagnoseGame({
    boardSize,
    moves: rec.moves as Move[],
    points,
    gameId: rec.id ?? 0,
    createdAt: rec.createdAt,
    result: rec.result,
  })
}

function byTimeDesc(a: GameDiagnosis, b: GameDiagnosis): number {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
}

export const useDiagnosisStore = create<DiagnosisState>((set) => ({
  status: 'idle',
  progress: { done: 0, total: 0, currentName: null },
  error: null,
  diagnostics: [],
  stats: null,

  analyzeGames: async (gameIds) => {
    const engine = getCurrentEngine()
    if (!engine.isReady()) {
      set({
        status: 'error',
        error: '引擎未就绪。请检查本地后端是否已启动，或在设置中切换引擎来源。',
      })
      return
    }
    const games = await listGames(50)
    const byId = new Map(games.map((g) => [g.id ?? -1, g]))
    const ids = gameIds.filter((id) => byId.has(id))
    if (ids.length === 0) {
      set({ status: 'done', diagnostics: [], stats: null, progress: { done: 0, total: 0, currentName: null } })
      return
    }

    cancelFlag = false
    set({
      status: 'running',
      error: null,
      progress: { done: 0, total: ids.length, currentName: null },
    })

    const results: GameDiagnosis[] = []
    try {
      for (let i = 0; i < ids.length; i++) {
        if (cancelFlag) break
        const rec = byId.get(ids[i])!
        set({
          progress: {
            done: i,
            total: ids.length,
            currentName: `${new Date(rec.createdAt).toLocaleString('zh-CN', { hour12: false })} 对局`,
          },
        })
        // 已有诊断结果则复用（重复点击不重复分析）
        let diag = await getDiagnosis(ids[i])
        if (!diag) {
          diag = await analyzeSingleGame(rec)
          if (diag && !cancelFlag) {
            await saveDiagnosis(diag)
          }
        }
        if (diag && !cancelFlag) results.push(diag)
      }
      const sorted = [...results].sort(byTimeDesc)
      set({
        status: 'done',
        diagnostics: sorted,
        stats: aggregateDiagnoses(sorted),
        progress: { done: sorted.length, total: ids.length, currentName: null },
      })
    } catch (err) {
      set({
        status: 'error',
        error: err instanceof Error ? err.message : '诊断失败',
      })
    }
  },

  stopAnalysis: () => {
    cancelFlag = true
    try {
      getCurrentEngine().cancelAnalysis()
    } catch {
      // 引擎未初始化时忽略
    }
    set({ status: 'done' })
  },

  refresh: async (gameIds) => {
    const results: GameDiagnosis[] = []
    for (const id of gameIds) {
      const d = await getDiagnosis(id)
      if (d) results.push(d)
    }
    const sorted = [...results].sort(byTimeDesc)
    set({
      diagnostics: sorted,
      stats: aggregateDiagnoses(sorted),
      status: sorted.length > 0 ? 'done' : 'idle',
      error: null,
      progress: { done: 0, total: 0, currentName: null },
    })
  },

  clear: () => {
    cancelFlag = true
    set({
      status: 'idle',
      progress: { done: 0, total: 0, currentName: null },
      error: null,
      diagnostics: [],
      stats: null,
    })
  },
}))
