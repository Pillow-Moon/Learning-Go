/**
 * AI 解说状态（Zustand）。
 * 管理解说请求、流式文本累积与解说历史。
 */
import { create } from 'zustand'

import {
  requestCommentary,
  streamCommentary,
  type CommentaryRequest,
} from '../services/api'

export interface CommentaryRecord {
  moveNumber: number
  text: string
}

interface CommentaryState {
  text: string
  streaming: boolean
  error: string | null
  history: CommentaryRecord[]
  /** 当前解说对应的手数 */
  currentMove: number | null

  request: (req: CommentaryRequest) => Promise<void>
  reset: () => void
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
    try {
      const { task_id } = await requestCommentary(req)
      let acc = ''
      await streamCommentary(task_id, (chunk) => {
        acc += chunk
        set({ text: acc })
      })
      const finalText = get().text
      set((state) => ({
        streaming: false,
        history: [
          ...state.history,
          { moveNumber: req.move_number, text: finalText },
        ],
      }))
    } catch (err) {
      set({
        streaming: false,
        error: err instanceof Error ? err.message : '解说生成失败',
      })
    }
  },

  reset: () => set({ text: '', error: null, streaming: false, currentMove: null }),
}))
