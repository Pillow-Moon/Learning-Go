/**
 * AI 强度领域逻辑（纯函数，无状态）。
 *
 * 参数单一来源：shared/ai-strength.json（与 backend/scripts/calibrate.py 同源，
 * 禁止在本文件内复制任何标定参数）。
 *
 * 从 settingsStore 迁出（Store 瘦身）：本文件只含领域计算，状态持久化仍在 settingsStore。
 */
import strengthParams from '@shared/ai-strength.json'
import type { EngineSource } from '../engines/types'

/** AI 强度档位 ID：业余 20 级 → 职业九段的统一棋力标尺（对局/评估/解说共用） */
export type AIStrengthId =
  | 'am20k' | 'am19k' | 'am18k' | 'am17k' | 'am16k' | 'am15k' | 'am14k' | 'am13k' | 'am12k' | 'am11k'
  | 'am10k' | 'am9k' | 'am8k' | 'am7k' | 'am6k'
  | 'am5k' | 'am4k' | 'am3k' | 'am2k' | 'am1k'
  | 'am1d' | 'am2d' | 'am3d' | 'am4d' | 'am5d' | 'am6d' | 'am7d'
  | 'pro1d' | 'pro2d' | 'pro3d' | 'pro4d' | 'pro5d' | 'pro6d' | 'pro7d' | 'pro8d' | 'pro9d'

/**
 * AI 强度档位：等级 ↔ 搜索量倍率（相对「业余 1 段」标准档，ratio=1）。
 * 倍率为估算值：等级越高搜索量越大、棋力越强。
 * 职业段位需要足够强的引擎（Local GPU 大模型）才能在可接受时间内完成搜索。
 */
export const AI_STRENGTH_OPTIONS: {
  id: AIStrengthId
  label: string
  ratio: number
  desc?: string
}[] = strengthParams.levels.map((l) => ({
  id: l.id as AIStrengthId,
  label: l.label,
  ratio: l.ratio,
}))

/** 旧档位 id → 最近等级（旧「极速/快速/标准/强力/极强」升级为等级制后的一次性迁移） */
const LEGACY_STRENGTH: Record<string, AIStrengthId> = {
  quick: 'am4k',
  fast: 'am2k',
  standard: 'am1d',
  strong: 'am3d',
  expert: 'am6d',
}

/** 持久化强度迁移：新等级 id 原样返回；旧 id 映射到最近等级；已移除的 'custom' 与未知值回退业余 1 段 */
export function migrateAIStrength(v: unknown): AIStrengthId {
  if (typeof v === 'string' && AI_STRENGTH_OPTIONS.some((o) => o.id === v)) {
    return v as AIStrengthId
  }
  if (typeof v === 'string' && LEGACY_STRENGTH[v]) return LEGACY_STRENGTH[v]
  return 'am1d'
}

/** 按档位取搜索量倍率（兼容旧档位 id） */
export function getAIStrengthRatio(id: string): number {
  return AI_STRENGTH_OPTIONS.find((o) => o.id === id)?.ratio ?? 1
}

/**
 * 等级 id → Human-SL profile（如 am20k → rank_20k）。
 * pro 档无官方 rank 映射返回 null（走正常引擎 visits 体系）。
 * 来源：shared/ai-strength.json 的 levels[].humanSlProfile。
 */
export function getHumanSlProfile(strengthId: AIStrengthId): string | null {
  return (
    strengthParams.levels.find((l) => l.id === strengthId)?.humanSlProfile ?? null
  )
}

/** 模型棋力系数与可达等级上限（按模型名识别；系数为估算值） */
export interface ModelStrengthInfo {
  /** 相对 b6c96 的棋力当量：越小 = 单次评估越强，达到同级棋力所需 visits 越少 */
  factor: number
  /** 该模型可达的最高 AI 等级（更高等级需海量搜索，弱模型不提供，避免虚标） */
  maxStrength: AIStrengthId
}

/** 等级强弱排名（下标越小越弱） */
const RANKED_STRENGTHS: AIStrengthId[] = AI_STRENGTH_OPTIONS.map((o) => o.id)

/** 判断等级是否在某个模型的等级上限内 */
export function isStrengthAllowed(id: AIStrengthId, max: AIStrengthId): boolean {
  return RANKED_STRENGTHS.indexOf(id) <= RANKED_STRENGTHS.indexOf(max)
}

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

/** 某模型可选的 AI 等级选项（按等级上限过滤） */
export function getAvailableStrengths(
  maxStrength: AIStrengthId,
): (typeof AI_STRENGTH_OPTIONS)[number][] {
  return AI_STRENGTH_OPTIONS.filter(
    (o) => RANKED_STRENGTHS.indexOf(o.id) <= RANKED_STRENGTHS.indexOf(maxStrength),
  )
}

/** 每手时间预算（秒）：超过则该等级视为当前引擎/模型配置下不可达，不提供（来源：shared/ai-strength.json） */
const MOVE_TIME_BUDGET = strengthParams.moveTimeBudget

/**
 * 当前可选的最高 AI 等级（可达性上限）：
 * - 未测基准：Local 放开到最高档（模型可随时切换），WASM 按内置模型上限（b6c96 → 业余 3 段）；
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
    if (!isStrengthAllowed(id, modelMax)) continue
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
 * 绝对 visits 基准：业余 1 段在 b6c96（factor=1）上所需的目标访问量（估算值；来源：shared/ai-strength.json）。
 * 由「b10c128 约 1000~2000 visits ≈ 业余 1 段」反推：3000 × factor(0.4) ≈ 1200 visits。
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

/**
 * KaTrain 校准级数（盲注错误注入用）由档位 id 推导：amXk→X、amXd→1-X。
 * 例：am18k→18、am1k→1、am1d→0、am2d→-1、am5d→-4。
 * 上限 5 段（kyu=-4）为 KaTrain OGS 真人对弈校准的可靠范围；
 * 6 段及以上与 pro 档返回 null（不注入，保持纯 visits 体系）。
 * 对弈引擎（genmove）用它决定是否盲注选点；分析场景不走 genmove，天然不受影响。
 */
export function kyuRankFor(strengthId: AIStrengthId | null): number | null {
  if (!strengthId) return null
  const k = /^am(\d+)k$/.exec(strengthId)
  if (k) return Number(k[1])
  const d = /^am(\d+)d$/.exec(strengthId)
  if (d) {
    const kyu = 1 - Number(d[1])
    return kyu >= -4 ? kyu : null
  }
  return null
}

/**
 * 按引擎来源/棋盘大小返回可选档位列表：
 * - 19 路（任意引擎）：全部档位（Local 走 Human-SL 标尺，WASM 走盲注错误注入，
 *   均由 strengthCap 按模型上限过滤；WASM b6c96 上限 am5d = KaTrain 校准可靠范围）
 * - 9/13 路（任意引擎）：全部档位（visits 体系；盲注公式按 19 路校准，小棋盘失真不注入）
 */
export function getStrengthOptionsFor(
  _source: EngineSource,
  _boardSize: number,
  strengthCap: AIStrengthId,
): (typeof AI_STRENGTH_OPTIONS)[number][] {
  return getAvailableStrengths(strengthCap)
}
