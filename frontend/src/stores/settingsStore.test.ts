/**
 * settingsStore 本次改动的纯逻辑测试：
 * - estimateTime 时间估算文案（每手/每次）
 * - WASM 基准按模型独立保存（recordWasmBenchmark / applyWasmModel）
 */
import { beforeEach, describe, expect, it } from 'vitest'

import { useSettingsStore } from './settingsStore'
import { estimateTime, kyuRankFor } from '../lib/strength'

/** 最小 localStorage mock（node 环境无 localStorage，persist 依赖它） */
const mem: Record<string, string> = {}
globalThis.localStorage = {
  getItem: (k: string) => mem[k] ?? null,
  setItem: (k: string, v: string) => {
    mem[k] = String(v)
  },
  removeItem: (k: string) => {
    delete mem[k]
  },
  clear: () => {
    for (const k in mem) delete mem[k]
  },
  key: (i: number) => Object.keys(mem)[i] ?? null,
  get length() {
    return Object.keys(mem).length
  },
} as Storage

const s = () => useSettingsStore.getState()

beforeEach(() => {
  for (const k in mem) delete mem[k]
  useSettingsStore.setState({ wasmBenchmarkScore: -1, wasmBenchmarkByModel: {} })
})

describe('estimateTime', () => {
  it('秒级输出「每手约 X 秒」', () => {
    expect(estimateTime(8, 1, '手')).toBe('每手约 8 秒')
    expect(estimateTime(2.4, 1, '手')).toBe('每手约 2 秒')
  })

  it('分秒输出「每手约 X 分 Y 秒」', () => {
    expect(estimateTime(80, 1, '手')).toBe('每手约 1 分 20 秒')
  })

  it('整分钟输出「每手约 X 分钟」', () => {
    expect(estimateTime(120, 1, '手')).toBe('每手约 2 分钟')
  })

  it('默认单位「次」输出「每次约 X 秒」', () => {
    expect(estimateTime(5, 1)).toBe('每次约 5 秒')
  })

  it('档位倍率生效', () => {
    expect(estimateTime(8, 4, '手')).toBe('每手约 32 秒')
  })
})

describe('kyuRankFor（KaTrain 校准级数推导）', () => {
  it('级位：amXk → X（am20k→20 … am1k→1）', () => {
    expect(kyuRankFor('am20k')).toBe(20)
    expect(kyuRankFor('am18k')).toBe(18)
    expect(kyuRankFor('am10k')).toBe(10)
    expect(kyuRankFor('am4k')).toBe(4)
    expect(kyuRankFor('am1k')).toBe(1)
  })

  it('段位：amXd → 1-X（am1d→0 … am5d→-4，KaTrain 校准上限）', () => {
    expect(kyuRankFor('am1d')).toBe(0)
    expect(kyuRankFor('am2d')).toBe(-1)
    expect(kyuRankFor('am3d')).toBe(-2)
    expect(kyuRankFor('am5d')).toBe(-4)
  })

  it('超出 KaTrain 校准范围（6 段及以上）不注入', () => {
    expect(kyuRankFor('am6d')).toBeNull()
    expect(kyuRankFor('am7d')).toBeNull()
  })

  it('pro 档与空值不注入', () => {
    expect(kyuRankFor('pro1d')).toBeNull()
    expect(kyuRankFor('pro9d')).toBeNull()
    expect(kyuRankFor(null)).toBeNull()
  })
})

describe('WASM 基准（模型收敛后仅 b6c96）', () => {
  it('recordWasmBenchmark 记录当前模型并更新当前分数', () => {
    s().recordWasmBenchmark('b6c96', 100)
    expect(s().wasmBenchmarkScore).toBe(100)
    expect(s().wasmBenchmarkByModel.b6c96).toBe(100)
  })

  it('applyWasmModel 回填该模型已测分数', () => {
    s().recordWasmBenchmark('b6c96', 100)
    s().applyWasmModel('b6c96')
    expect(s().wasmBenchmarkScore).toBe(100)
  })

  it('applyWasmModel 未测模型置 -1，不串用旧分数', () => {
    s().recordWasmBenchmark('b6c96', 100)
    useSettingsStore.setState({ wasmBenchmarkByModel: {} })
    s().applyWasmModel('b6c96')
    expect(s().wasmBenchmarkScore).toBe(-1)
  })

  it('分数持久化到 localStorage 并可恢复', () => {
    s().recordWasmBenchmark('b6c96', 30)
    const raw = JSON.parse(mem['learning-go-settings'])
    expect(raw.wasmBenchmarkByModel.b6c96).toBe(30)
  })
})
