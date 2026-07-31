/**
 * AI 解说状态（Zustand + 浏览器直连 LLM）。
 * 从 settingsStore 取 provider 配置，通过 llmClient 流式调用。
 * 无 key 或调用失败时降级：仅展示 KataGo 原始数据。
 */
import { create } from 'zustand'

import { callLLMStream } from '../services/llmClient'
import { useSettingsStore } from './settingsStore'

/** 解说请求（由 CommentaryPanel 组装传入） */
interface CommentaryRequest {
  move_number: number
  player: 'black' | 'white'
  move: string | null
  board_size: number
  level: 'beginner' | 'intermediate' | 'advanced'
  candidates: { move: string | null; winrate: number | null; scoreLead: number | null; visits: number | null; pv: string[] }[]
  root_winrate: number | null
  root_score_lead: number | null
  recent_summary: string | null
}

export interface CommentaryRecord {
  moveNumber: number
  text: string
}

interface CommentaryState {
  text: string
  streaming: boolean
  error: string | null
  history: CommentaryRecord[]
  currentMove: number | null

  request: (req: CommentaryRequest) => Promise<void>
  reset: () => void
}

/** 根据解说请求组装 LLM 消息 */
function buildMessages(req: CommentaryRequest): { role: 'system' | 'user'; content: string }[] {
  const levelDesc: Record<string, string> = {
    beginner: '零基础初学者，请用最通俗的语言讲解，解释基本术语（如气、提子、眼），避免高深战略。',
    intermediate: '有一定基础的业余棋手，可以讲解常见定式、攻防要点和简单战略。',
    advanced: '业余高段棋手，可以深入讲解形势判断、大局观和复杂变化。',
  }

  const topMoves = req.candidates
    .slice(0, 5)
    .map((c) => {
      const wr = c.winrate != null ? `${(c.winrate * 100).toFixed(1)}%` : '?'
      const sl = c.scoreLead != null ? `${c.scoreLead.toFixed(1)}目` : '?'
      return `  ${c.move ?? 'pass'}: 胜率 ${wr}, 目差 ${sl}, 变化 ${c.pv.join(' ')}`
    })
    .join('\n')

  const system = `你是一位专业的围棋教练。${levelDesc[req.level]}
请根据以下 KataGo 分析数据，为第 ${req.move_number} 手棋（${req.player === 'black' ? '黑' : '白'}方落子${req.move ?? '虚手'}）做教学解说。
解说要点：1）这手棋的意图与效果；2）与最佳选点的对比；3）一句话的改进建议。
控制在 150 字以内，语气亲切自然。`

  const user = `盘面：${req.board_size}路棋盘
当前胜率：${req.root_winrate != null ? (req.root_winrate * 100).toFixed(1) + '%' : '未知'}
目差：${req.root_score_lead != null ? req.root_score_lead.toFixed(1) + '目' : '未知'}
KataGo 候选选点：
${topMoves || '无数据'}`

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

/** 降级：仅展示 KataGo 数据 */
function fallbackText(req: CommentaryRequest): string {
  const top = req.candidates[0]
  if (!top) return '暂无分析数据。'
  const wr = top.winrate != null ? `${(top.winrate * 100).toFixed(1)}%` : '?'
  const sl = top.scoreLead != null ? `${top.scoreLead.toFixed(1)}目` : '?'
  return `[KataGo 分析] 推荐 ${top.move ?? 'pass'}，胜率 ${wr}，目差 ${sl}。\n变化：${top.pv.join(' ')}`
}

export const useCommentaryStore = create<CommentaryState>((set, get) => ({
  text: '',
  streaming: false,
  error: null,
  history: [],
  currentMove: null,

  request: async (req) => {
    if (get().streaming) return
    set({ streaming: true, error: null, text: '', currentMove: req.move_number })

    // 从设置中获取当前 provider
    const { providers, activeProviderId } = useSettingsStore.getState()
    const provider = providers.find((p) => p.id === activeProviderId)

    if (!provider || !provider.apiKey) {
      // 无 key：降级展示 KataGo 数据
      const fallback = fallbackText(req)
      set({ text: fallback, streaming: false })
      return
    }

    try {
      const messages = buildMessages(req)
      let acc = ''
      await callLLMStream(
        { baseURL: provider.baseURL, apiKey: provider.apiKey, model: provider.model },
        messages,
        (chunk) => {
          acc += chunk
          set({ text: acc })
        },
      )
      const finalText = get().text || fallbackText(req)
      set((state) => ({
        streaming: false,
        history: [
          ...state.history,
          { moveNumber: req.move_number, text: finalText },
        ],
      }))
    } catch (err) {
      const fallback = fallbackText(req)
      if (!get().text) {
        set({ text: fallback })
      }
      set({
        streaming: false,
        error: err instanceof Error ? err.message : '解说生成失败',
      })
    }
  },

  reset: () => set({ text: '', error: null, streaming: false, currentMove: null }),
}))
