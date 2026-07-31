/**
 * 纯前端棋力评估计算：移植自 backend/app/services/assessment.py。
 * 输入答题结果 + 实战重合度，输出定级报告。
 */
import coursesData from '../data/courses.json'

export interface ProblemResult {
  category: string
  tag: string
  correct: boolean
}

export interface GameOverlap {
  max_visits: number
  overlap_rate: number
  move_count: number
}

export interface RecommendedCourse {
  id: number
  title: string
  dimension: string
}

export interface AssessmentReport {
  level: string
  overall_score: number
  radar: Record<string, number>
  weak_dimensions: string[]
  recommended_courses: RecommendedCourse[]
}

const CAPTURE_TAGS = new Set(['吃子', '征子', '枷吃', '倒扑', '接不归', '气'])
const LIFE_DEATH_TAGS = new Set(['眼', '双活', '打劫', '禁入点'])
const DIMENSIONS = ['吃子', '围空', '死活', '布局', '官子']

function accuracy(results: ProblemResult[], tags: Set<string>): number | null {
  const filtered = results.filter((r) => tags.has(r.tag))
  if (filtered.length === 0) return null
  return filtered.filter((r) => r.correct).length / filtered.length
}

function levelFromScore(score: number): string {
  if (score >= 90) return '业余1段'
  if (score >= 80) return '1级'
  if (score >= 70) return '5级'
  if (score >= 60) return '10级'
  if (score >= 50) return '15级'
  if (score >= 35) return '20级'
  if (score >= 20) return '25级'
  return '30级'
}

export function computeReport(
  problemResults: ProblemResult[],
  gameOverlaps: GameOverlap[],
): AssessmentReport {
  // 五维雷达
  const captureVal = accuracy(problemResults, CAPTURE_TAGS) ?? 0
  const lifeDeathVal = accuracy(problemResults, LIFE_DEATH_TAGS) ?? 0

  // 三局重合度映射到布局/围空/官子
  const overlaps = gameOverlaps.map((g) => g.overlap_rate)
  const layoutVal = (overlaps[0] ?? 0) * 100
  const territoryVal = (overlaps[1] ?? 0) * 100
  const endgameVal = (overlaps[2] ?? 0) * 100

  const radar: Record<string, number> = {
    吃子: Math.round(captureVal * 100),
    围空: Math.round(territoryVal),
    死活: Math.round(lifeDeathVal * 100),
    布局: Math.round(layoutVal),
    官子: Math.round(endgameVal),
  }

  // 综合分
  const count = Object.values(radar).filter((v) => v > 0).length || 1
  const overall = Math.round(
    Object.values(radar).reduce((a, b) => a + b, 0) / count,
  )

  // 薄弱维度
  const weakDimensions = DIMENSIONS.filter((d) => radar[d] < 40)

  // 推荐课程（匹配薄弱维度 + 难度升序）
  const recommended = (coursesData as any[])
    .filter((c: any) => weakDimensions.includes(c.dimension))
    .sort((a: any, b: any) => a.difficulty - b.difficulty)
    .slice(0, 3)
    .map((c: any) => ({ id: c.id, title: c.title, dimension: c.dimension }))

  return {
    level: levelFromScore(overall),
    overall_score: overall,
    radar,
    weak_dimensions: weakDimensions,
    recommended_courses: recommended,
  }
}
