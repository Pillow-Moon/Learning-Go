/**
 * 全局设置状态（Zustand + localStorage 持久化）。
 *
 * 管理：引擎来源、LLM provider 配置、API key、设备基准分数。
 */
import { create } from 'zustand'
import type { EngineSource } from '../engines/types'
import { getBoardTheme, getStoneStyle, type BoardThemeId, type StoneStyleId } from '../lib/boardThemes'

/** LLM Provider 配置 */
export interface LLMProvider {
  id: string
  name: string
  baseURL: string
  defaultModel: string
  model: string
  apiKey: string
}

/** 网页版 WASM 可用模型 ID（模型收敛：只保留 b6c96 轻量兜底模型） */
export type WasmModelId = 'b6c96'

/** WASM 模型选项（设置页展示用） */
export const WASM_MODEL_OPTIONS: {
  id: WasmModelId
  label: string
  desc: string
}[] = [
  { id: 'b6c96', label: 'b6c96', desc: '6x96 轻量模型' },
]

interface SettingsState {
  /** 引擎来源 */
  engineSource: EngineSource
  /** 本地后端 URL（默认 localhost:8000，经 Vite 代理） */
  localBackendURL: string
  /** WASM 引擎模型 */
  wasmModel: WasmModelId
  /** 所有 LLM provider */
  providers: LLMProvider[]
  /** 当前激活的 provider ID */
  activeProviderId: string
  /** Local GPU 实测基准分数（visits/s，-1=未测试） */
  localBenchmarkScore: number
  /** WASM 实测基准分数（visits/s，-1=未测试；切换模型时按缓存回填） */
  wasmBenchmarkScore: number
  /** 各 WASM 模型实测基准分数（visits/s，按模型独立保存，未测缺省） */
  wasmBenchmarkByModel: Partial<Record<WasmModelId, number>>
  /** 棋盘视觉主题 */
  boardTheme: BoardThemeId
  /** 棋子质感样式 */
  stoneStyle: StoneStyleId
  /** 界面夜间模式 */
  uiTheme: 'light' | 'dark'

  // 操作
  setEngineSource: (source: EngineSource) => void
  setWasmModel: (id: WasmModelId) => void
  setLocalBenchmarkScore: (score: number) => void
  /** 记录某 WASM 模型实测分数，并作为当前模型分数展示 */
  recordWasmBenchmark: (model: WasmModelId, score: number) => void
  /** 切换 WASM 模型后回填该模型已测分数（未测则为 -1） */
  applyWasmModel: (model: WasmModelId) => void
  addProvider: (p: LLMProvider) => void
  updateProvider: (id: string, patch: Partial<LLMProvider>) => void
  removeProvider: (id: string) => void
  setActiveProvider: (id: string) => void
  setBoardTheme: (id: BoardThemeId) => void
  setStoneStyle: (id: StoneStyleId) => void
  setUiTheme: (theme: 'light' | 'dark') => void
}

/** 从 localStorage 恢复持久化字段 */
function loadPersisted(): Partial<SettingsState> {
  try {
    const raw = localStorage.getItem('learning-go-settings')
    if (raw) return JSON.parse(raw)
  } catch {
    /* ignore */
  }
  return {}
}

/** 持久化到 localStorage */
function persist(state: SettingsState): void {
  const toSave = {
    engineSource: state.engineSource,
    localBackendURL: state.localBackendURL,
    wasmModel: state.wasmModel,
    providers: state.providers,
    activeProviderId: state.activeProviderId,
    localBenchmarkScore: state.localBenchmarkScore,
    wasmBenchmarkScore: state.wasmBenchmarkScore,
    wasmBenchmarkByModel: state.wasmBenchmarkByModel,
    boardTheme: state.boardTheme,
    stoneStyle: state.stoneStyle,
    uiTheme: state.uiTheme,
  }
  localStorage.setItem('learning-go-settings', JSON.stringify(toSave))
}

const persisted = loadPersisted()
// 旧版只存了单一 benchmarkScore（Local 测得），从原始 JSON 里兼容迁移
const legacyScore = (persisted as { benchmarkScore?: number }).benchmarkScore

export const useSettingsStore = create<SettingsState>((set, get) => ({
  engineSource: persisted.engineSource ?? 'browser',
  localBackendURL: persisted.localBackendURL ?? '/api/v1',
  wasmModel: persisted.wasmModel ?? 'b6c96',
  providers: persisted.providers ?? [],
  activeProviderId: persisted.activeProviderId ?? '',
  localBenchmarkScore: persisted.localBenchmarkScore ?? legacyScore ?? -1,
  wasmBenchmarkScore: persisted.wasmBenchmarkScore ?? -1,
  wasmBenchmarkByModel: persisted.wasmBenchmarkByModel ?? {},
  boardTheme: getBoardTheme(persisted.boardTheme ?? 'plain').id,
  stoneStyle: getStoneStyle(persisted.stoneStyle ?? 'slate-shell').id,
  uiTheme: persisted.uiTheme === 'dark' ? 'dark' : 'light',

  setEngineSource: (source) => {
    set({ engineSource: source })
    persist(get())
  },

  setWasmModel: (id) => {
    set({ wasmModel: id })
    persist(get())
  },

  setLocalBenchmarkScore: (score) => {
    set({ localBenchmarkScore: score })
    persist(get())
  },

  recordWasmBenchmark: (model, score) => {
    set({
      wasmBenchmarkScore: score,
      wasmBenchmarkByModel: { ...get().wasmBenchmarkByModel, [model]: score },
    })
    persist(get())
  },

  applyWasmModel: (model) => {
    set({ wasmBenchmarkScore: get().wasmBenchmarkByModel[model] ?? -1 })
    persist(get())
  },

  addProvider: (p) => {
    const providers = [...get().providers, p]
    const activeProviderId = get().activeProviderId || p.id
    set({ providers, activeProviderId })
    persist(get())
  },

  updateProvider: (id, patch) => {
    set({
      providers: get().providers.map((p) =>
        p.id === id ? { ...p, ...patch } : p,
      ),
    })
    persist(get())
  },

  removeProvider: (id) => {
    const providers = get().providers.filter((p) => p.id !== id)
    const activeProviderId =
      get().activeProviderId === id
        ? providers[0]?.id ?? ''
        : get().activeProviderId
    set({ providers, activeProviderId })
    persist(get())
  },

  setActiveProvider: (id) => {
    set({ activeProviderId: id })
    persist(get())
  },

  setBoardTheme: (id) => {
    set({ boardTheme: id })
    persist(get())
  },

  setStoneStyle: (id) => {
    set({ stoneStyle: id })
    persist(get())
  },
  setUiTheme: (theme) => {
    set({ uiTheme: theme })
    persist(get())
  },
}))
