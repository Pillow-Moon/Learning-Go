/**
 * 多局诊断聚合：把最近 N 局棋谱诊断结果汇总为错误类型分布，
 * 供训练处方（规则版）与 LLM 诊断报告（BYOK 版）共用。
 */
import { DIAGNOSIS_TYPES, type DiagnosisType, type GameDiagnosis, type TypeSummary } from './diagnosis'

/** 聚合后的类型统计（含占比） */
export interface TypeStats extends TypeSummary {
  /** 占全部问题手的比例（0~1） */
  share: number
}

/** 多局聚合结果 */
export interface DiagnosisStats {
  gameCount: number
  totalIssues: number
  byType: Record<DiagnosisType, TypeStats>
  /** 最高频问题类型（训练主题依据）；无问题手时为 null */
  topType: DiagnosisType | null
  /** 每局概况（按时间倒序） */
  perGame: {
    gameId: number
    createdAt: string
    issueCount: number
    result: string | null
  }[]
}

/** 聚合多局诊断：统计分布、计算 topType、按时间倒序列出每局概况 */
export function aggregateDiagnoses(diags: GameDiagnosis[]): DiagnosisStats {
  let totalIssues = 0
  const byType = Object.fromEntries(
    DIAGNOSIS_TYPES.map((t) => [
      t,
      { count: 0, avgLoss: 0, maxLoss: 0, share: 0 },
    ]),
  ) as Record<DiagnosisType, TypeStats>

  for (const g of diags) {
    totalIssues += g.issueCount
    for (const t of DIAGNOSIS_TYPES) {
      const s = byType[t]
      s.count += g.byType[t].count
      // avgLoss 先累计总和，最后统一求平均
      s.avgLoss += g.byType[t].avgLoss * g.byType[t].count
      s.maxLoss = Math.max(s.maxLoss, g.byType[t].maxLoss)
    }
  }

  let topType: DiagnosisType | null = null
  for (const t of DIAGNOSIS_TYPES) {
    const s = byType[t]
    if (s.count > 0) {
      s.avgLoss = s.avgLoss / s.count
      s.share = totalIssues > 0 ? s.count / totalIssues : 0
      if (topType == null || s.count > byType[topType].count) topType = t
    }
  }

  const perGame = [...diags]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map((g) => ({
      gameId: g.gameId,
      createdAt: g.createdAt,
      issueCount: g.issueCount,
      result: g.result,
    }))

  return { gameCount: diags.length, totalIssues, byType, topType, perGame }
}
