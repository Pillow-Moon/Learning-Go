/**
 * 定式数据类型定义。
 *
 * 定式数据本体见 josekiKogo.ts（由 scripts/extract-kogo.mjs 从
 * KOGO 定式辞典自动生成，经校验后作为唯一数据源）。
 *
 * 坐标约定：左上角归一化坐标 [x, y]（x=距左边线的间隔数，y=距上边线的间隔数，0 起）。
 * 所有序列均为「黑先、黑白交替」。匹配时程序自动做 8 种对称变换
 * （4 个角 × 转置），因此每条序列只需记录一种朝向。
 */

/** 单一定式变化线（主变化或变着） */
export interface JosekiLine {
  /** 着法序列：左上角归一化坐标，黑先交替 */
  moves: [number, number][]
  /** 定式名（含家族前缀），如 "星位 · 小飞挂 · 小飞应" */
  name: string
  /** 结果评价（可选；解说引用时若缺失则跳过） */
  outcome?: string
  /** 教学要点（供课程/练习使用） */
  note?: string
  /** 置信度：high=常见标准型；medium=常见但存在多种变体；unverified=待复核 */
  confidence: 'high' | 'medium' | 'unverified'
  /** 使用率（可选）：暂无数据源时为 undefined，排序回退原始顺序；后续数据补充后自动生效 */
  frequency?: number
}

/** 一个定式（可含多个变化线） */
export interface Joseki {
  id: string
  /** 定式家族名，如 "星位"、"小目" */
  name: string
  /** 分类标签，用于课程筛选与练习组织 */
  tags: string[]
  /** 数据来源（如 "KOGO 定式辞典"） */
  source?: string
  lines: JosekiLine[]
}
