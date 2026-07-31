/**
 * 全局设置状态（Zustand + localStorage 持久化）。
 *
 * 管理：引擎来源、LLM provider 配置、API key、设备基准分数。
 */
import { create } from 'zustand'
import type { EngineSource } from '../engines/types'

/** LLM Provider 配置 */
export interface LLMProvider {
  id: string
  name: string
  baseURL: string
  defaultModel: string
  model: string
  apiKey: string
}

interface SettingsState {
  /** 引擎来源 */
  engineSource: EngineSource
  /** 本地后端 URL（默认 localhost:8000，经 Vite 代理） */
  localBackendURL: string
  /** 所有 LLM provider */
  providers: LLMProvider[]
  /** 当前激活的 provider ID */
  activeProviderId: string
  /** 设备基准分数（visits/s，-1=未测试） */
  benchmarkScore: number
  /** 手动 AI 强度档位：fast/standard/strong */
  aiStrength: 'fast' | 'standard' | 'strong'

  // 操作
  setEngineSource: (source: EngineSource) => void
  setBenchmarkScore: (score: number) => void
  addProvider: (p: LLMProvider) => void
  updateProvider: (id: string, patch: Partial<LLMProvider>) => void
  removeProvider: (id: string) => void
  setActiveProvider: (id: string) => void
  setAIStrength: (s: 'fast' | 'standard' | 'strong') => void
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
    providers: state.providers,
    activeProviderId: state.activeProviderId,
    benchmarkScore: state.benchmarkScore,
    aiStrength: state.aiStrength,
  }
  localStorage.setItem('learning-go-settings', JSON.stringify(toSave))
}

const persisted = loadPersisted()

export const useSettingsStore = create<SettingsState>((set, get) => ({
  engineSource: persisted.engineSource ?? 'local',
  localBackendURL: persisted.localBackendURL ?? '/api/v1',
  providers: persisted.providers ?? [],
  activeProviderId: persisted.activeProviderId ?? '',
  benchmarkScore: persisted.benchmarkScore ?? -1,
  aiStrength: persisted.aiStrength ?? 'standard',

  setEngineSource: (source) => {
    set({ engineSource: source })
    persist(get())
  },

  setBenchmarkScore: (score) => {
    set({ benchmarkScore: score })
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

  setAIStrength: (s) => {
    set({ aiStrength: s })
    persist(get())
  },
}))
