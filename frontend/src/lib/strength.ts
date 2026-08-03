/**
 * AI 分析深度领域逻辑（纯函数，无状态）。
 *
 * 参数单一来源：shared/ai-strength.json（禁止在本文件内复制任何标定参数）。
 * 2026-08 精简：AI 对弈与 Human-SL 已删除，本模块只保留「分析场景」的
 * maxVisits 深度分级（按场景 × 等级 × 模型棋力系数换算）。
 */
import strengthParams from '@shared/ai-strength.json'
import type { EngineSource } from '../engines/types'

/** AI 深度档位 ID（分析场景用；业余 20 级 → 职业九段统一标尺） */
export type AIStrengthId =
  | 'am20k' | 'am19k' | 'am18k' | 'am17k' | 'am16k' | 'am15k' | 'am14k' | 'am13k' | 'am12k' | 'am11k'
  | 'am10k' | 'am9k' | 'am8k' | 'am7k' | 'am6k'
  | 'am5k' | 'am4k' | 'am3k' | 'am2k' | 'am1k'
  | 'am1d' | 'am2d' | 'am3d' | 'am4d' | 'am5d' | 'am6d' | 'am7d'
  | 'pro1d' | 'pro2d' | 'pro3d' | 'pro4d' | 'pro5d' | 'pro6d' | 'pro7d' | 'pro8d' | 'pro9d'

/** 等级 id → 搜索量倍率（相对业余 1 段 ratio=1；来源：shared/ai-strength.json） */
export function getAIStrengthRatio(id: string): number {
  return strengthParams.levels.find((l) => l.id === id)?.ratio ?? 1
}

/** 模型棋力系数与可达等级上限（按模型名识别） */
export interface ModelStrengthInfo {
  /** 相对 b6c96 的棋力当量：越小 = 单次评估越强，达到同级棋力所需 visits 越少 */
  factor: number
  /** 该模型可达的最高 AI 等级（更高等级需海量搜索，弱模型不提供，避免虚标） */
  maxStrength: AIStrengthId
}

/** 等级强弱排名（下标越小越弱） */
const RANKED_STRENGTHS: AIStrengthId[] = strengthParams.levels.map((l) => l.id as AIStrengthId)

/**
 * 按模型名取棋力系数与等级上限（子串匹配）。
 * 单一来源：shared/ai-strength.json 的 models 表；未识别模型按 modelDefault 保守处理。
 */
export function getModelStrengthInfo(modelId: string): ModelStrengthInfo {
  const id = modelId.toLowerCase()
  const m = strengthParams.models.find((x) => id.includes(x.id))
  if (m) {
    return { factor: m.factor, maxStrength: m.maxStrength as AIStrengthId }
  }
  return {
    factor: strengthParams.modelDefault.factor,
    maxStrength: strengthParams.modelDefault.maxStrength as AIStrengthId,
  }
}

/** 每手时间预算（秒）：超过则该等级视为当前引擎/模型配置下不可达，不提供（来源：shared/ai-strength.json） */
const MOVE_TIME_BUDGET = strengthParams.moveTimeBudget

/**
 * 当前可选的最高 AI 等级（可达性上限）：
 * - 未测基准：Local 放开到最高档，WASM 按内置模型上限（b6c96 → 业余 3 段）；
 * - 已测基准：取「每手耗时 ≤ MOVE_TIME_BUDGET」的最高等级。
 *   耗时 = 绝对访问量 / 实测速度，弱模型或慢引擎搜不快，高段位自然不可达。
 * 场景（scenario）按 SCENE_RATIO 折算时间预算：分析/评估等场景允许更多用时，可达到更高等级。
 */
export function getStrengthCap(
  source: EngineSource,
  modelId: string,
  benchmarkScore: number,
  scenario: keyof typeof SCENE_RATIO = 'move',
): AIStrengthId {
  const modelMax =
    source === 'local' ? 'pro9d' : getModelStrengthInfo(modelId).maxStrength
  if (benchmarkScore <= 0) return modelMax
  const { factor } = getModelStrengthInfo(modelId)
  const budget = MOVE_TIME_BUDGET / SCENE_RATIO[scenario]
  for (let i = RANKED_STRENGTHS.length - 1; i >= 0; i--) {
    const id = RANKED_STRENGTHS[i]
    if (RANKED_STRENGTHS.indexOf(id) > RANKED_STRENGTHS.indexOf(modelMax)) continue
    const visits = BASE_VISITS_AM1D * getAIStrengthRatio(id) * factor
    if (visits / benchmarkScore <= budget) return id
  }
  return RANKED_STRENGTHS[0]
}

/** 指定场景下可达的最高 AI 等级 id（即 getStrengthCap 带场景的结果） */
export function getScenarioMaxStrength(
  source: EngineSource,
  modelId: string,
  benchmarkScore: number,
  scenario: keyof typeof SCENE_RATIO,
): AIStrengthId {
  return getStrengthCap(source, modelId, benchmarkScore, scenario)
}

/** 对局/分析等场景的目标用时系数（相对对局每手，保持各场景搜索深度差异；来源：shared/ai-strength.json） */
const SCENE_RATIO = strengthParams.sceneRatio

/**
 * 绝对 visits 基准：业余 1 段在 b6c96（factor=1）上所需的目标访问量（来源：shared/ai-strength.json）。
 */
const BASE_VISITS_AM1D = strengthParams.baseVisitsAm1d

/**
 * 按 AI 等级 + 模型棋力系数计算目标访问量（绝对标定，与硬件速度解耦）：
 * 目标访问量 = 绝对基准 × 场景系数 × 等级倍率 × 模型系数。
 * 同段位下：弱模型（系数大）需要更多访问量才能达到同级棋力，强模型（系数小）更少；
 * 引擎快慢只影响耗时，不改变访问量。
 */
export function aiVisitsFor(
  strengthId: AIStrengthId,
  scenario: 'move' | 'analysis' | 'assessment' | 'commentary',
  modelId: string,
): number {
  const ratio = getAIStrengthRatio(strengthId)
  const { factor } = getModelStrengthInfo(modelId)
  return Math.round(BASE_VISITS_AM1D * SCENE_RATIO[scenario] * ratio * factor)
}

/** 由标准档基准用时（秒/次）× 档位倍率，估算实际用时文本；unit 为时间单位（次/手） */
export function estimateTime(baseTime: number, ratio: number, unit = '次'): string {
  const secs = Math.max(1, Math.round(baseTime * ratio))
  if (secs >= 60) {
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return s > 0 ? `每${unit}约 ${m} 分 ${s} 秒` : `每${unit}约 ${m} 分钟`
  }
  return `每${unit}约 ${secs} 秒`
}
