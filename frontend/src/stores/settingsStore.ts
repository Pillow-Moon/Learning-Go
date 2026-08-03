/**
 * 全局设置状态（Zustand + localStorage 持久化）。
 *
 * 管理：引擎来源、设备基准分数、棋盘/棋子/主题。
 */
import { create } from 'zustand'
import type { EngineSource } from '../engines/types'
import { getBoardTheme, getStoneStyle, type BoardThemeId, type StoneStyleId } from '../lib/boardThemes'

/** 网页版 WASM 可用模型 ID（模型收敛：只保留 b6c96 轻量兜底模型） */
export type WasmModelId = 'b6c96'

/** LLM 默认配置（DeepSeek OpenAI 兼容端点） */
export const DEFAULT_LLM_BASE_URL = 'https://api.deepseek.com/v1'
export const DEFAULT_LLM_MODEL = 'deepseek-chat'

/** 常用 LLM 模型选项（设置页下拉） */
export const LLM_MODEL_OPTIONS: { id: string; label: string; desc: string }[] = [
  { id: 'deepseek-chat', label: 'DeepSeek-V3', desc: 'DeepSeek 官方（性价比高，中文好）' },
  { id: 'deepseek-reasoner', label: 'DeepSeek-R1', desc: 'DeepSeek 推理模型（更慢更贵）' },
  { id: 'gpt-4o-mini', label: 'GPT-4o-mini', desc: 'OpenAI 轻量（需自备代理）' },
  { id: 'glm-4-flash', label: 'GLM-4-Flash', desc: '智谱免费档（需 baseURL 指向智谱）' },
]


interface SettingsState {
  /** 引擎来源 */
  engineSource: EngineSource
  /** 本地后端 URL（默认 localhost:8000，经 Vite 代理） */
  localBackendURL: string
  /** WASM 引擎模型 */
  wasmModel: WasmModelId
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
  /** 用户业余级位（1~25，数字越小越强；诊断训练处方使用，默认 7） */
  userLevel: number
  /** BYOK LLM：密钥（仅存 localStorage，直连用户配置的 baseURL） */
  llmApiKey: string
  /** BYOK LLM：OpenAI 兼容端点 */
  llmBaseURL: string
  /** BYOK LLM：模型名 */
  llmModel: string

  // 操作
  setEngineSource: (source: EngineSource) => void
  setWasmModel: (id: WasmModelId) => void
  setLocalBenchmarkScore: (score: number) => void
  /** 记录某 WASM 模型实测分数，并作为当前模型分数展示 */
  recordWasmBenchmark: (model: WasmModelId, score: number) => void
  /** 切换 WASM 模型后回填该模型已测分数（未测则为 -1） */
  applyWasmModel: (model: WasmModelId) => void
  setBoardTheme: (id: BoardThemeId) => void
  setStoneStyle: (id: StoneStyleId) => void
  setUiTheme: (theme: 'light' | 'dark') => void
  setUserLevel: (level: number) => void
  setLlmApiKey: (key: string) => void
  setLlmBaseURL: (url: string) => void
  setLlmModel: (model: string) => void
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
    localBenchmarkScore: state.localBenchmarkScore,
    wasmBenchmarkScore: state.wasmBenchmarkScore,
    wasmBenchmarkByModel: state.wasmBenchmarkByModel,
    boardTheme: state.boardTheme,
    stoneStyle: state.stoneStyle,
    uiTheme: state.uiTheme,
    userLevel: state.userLevel,
    llmApiKey: state.llmApiKey,
    llmBaseURL: state.llmBaseURL,
    llmModel: state.llmModel,
  }
  localStorage.setItem('learning-go-settings', JSON.stringify(toSave))
}

/** 级位范围校验（1~25，数字越小越强） */
function clampLevel(level: number): number {
  if (!Number.isFinite(level)) return 7
  return Math.max(1, Math.min(25, Math.round(level)))
}

const persisted = loadPersisted()
// 旧版只存了单一 benchmarkScore（Local 测得），从原始 JSON 里兼容迁移
const legacyScore = (persisted as { benchmarkScore?: number }).benchmarkScore

export const useSettingsStore = create<SettingsState>((set, get) => ({
  engineSource: persisted.engineSource ?? 'browser',
  localBackendURL: persisted.localBackendURL ?? '/api/v1',
  wasmModel: persisted.wasmModel ?? 'b6c96',
  localBenchmarkScore: persisted.localBenchmarkScore ?? legacyScore ?? -1,
  wasmBenchmarkScore: persisted.wasmBenchmarkScore ?? -1,
  wasmBenchmarkByModel: persisted.wasmBenchmarkByModel ?? {},
  boardTheme: getBoardTheme(persisted.boardTheme ?? 'plain').id,
  stoneStyle: getStoneStyle(persisted.stoneStyle ?? 'plain').id,
  uiTheme: persisted.uiTheme === 'dark' ? 'dark' : 'light',
  userLevel: clampLevel(persisted.userLevel ?? 7),
  llmApiKey: persisted.llmApiKey ?? '',
  llmBaseURL: persisted.llmBaseURL ?? DEFAULT_LLM_BASE_URL,
  llmModel: persisted.llmModel ?? DEFAULT_LLM_MODEL,

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
  setUserLevel: (level) => {
    set({ userLevel: clampLevel(level) })
    persist(get())
  },
  setLlmApiKey: (key) => {
    set({ llmApiKey: key })
    persist(get())
  },
  setLlmBaseURL: (url) => {
    set({ llmBaseURL: url })
    persist(get())
  },
  setLlmModel: (model) => {
    set({ llmModel: model })
    persist(get())
  },
}))
