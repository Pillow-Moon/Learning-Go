/**
 * 全局 UI 状态：WASM 引擎自动加载的进度（进入页面时的全局进度条）。
 */
import { create } from 'zustand'

export interface WasmLoadState {
  loading: boolean
  msg: string
  pct?: number
}

interface UiState {
  wasmLoad: WasmLoadState
  setWasmLoad: (s: WasmLoadState) => void
}

export const useUiStore = create<UiState>((set) => ({
  wasmLoad: { loading: false, msg: '' },
  setWasmLoad: (wasmLoad) => set({ wasmLoad }),
}))
