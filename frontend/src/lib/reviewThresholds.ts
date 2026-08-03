/**
 * 复盘/诊断共用的标注阈值（黑视角胜率损失，0~1）与标注判定。
 * 独立成模块：reviewStore（复盘分析）、diagnosisStore（批量诊断）共用，
 * 避免 lib 层反向依赖 stores 造成循环导入。
 */
export const LOSS_BAD = 0.08 // 恶手
export const LOSS_DOUBT = 0.03 // 疑问手
export const LOSS_GOOD = 0.01 // 好手

/** 标注某一手：loss = 前局面的榜首黑胜率 - 该手后黑胜率 */
export function verdictFor(loss: number | null): 'good' | 'doubt' | 'bad' | null {
  if (loss == null) return null
  if (loss >= LOSS_BAD) return 'bad'
  if (loss >= LOSS_DOUBT) return 'doubt'
  if (loss <= LOSS_GOOD) return 'good'
  return null
}
