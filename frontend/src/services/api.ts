/**
 * 后端 API 调用层。
 * 开发阶段经 Vite 代理转发到 FastAPI（/api -> 127.0.0.1:8000）。
 */

const BASE = '/api/v1'

export type ColorDto = 'B' | 'W'
export type VertexDto = [number, number] | null

export interface MoveDto {
  color: ColorDto
  vertex: VertexDto
}

export interface GameMoveRequest {
  board_size: number
  komi: number
  max_visits: number
  moves: MoveDto[]
  ai_color: ColorDto
}

export interface GameMoveResponse {
  ai_move: [number, number] | null
  ai_move_coord: string | null
}

export interface Candidate {
  move: [number, number] | null
  winrate: number | null
  score_lead: number | null
  visits: number | null
  prior: number | null
  pv: [number, number][]
}

export interface AnalysisResult {
  board_size: number
  candidates: Candidate[]
  root: { winrate?: number; score_lead?: number }
}

export interface AnalysisStatus {
  task_id: string
  status: 'pending' | 'done' | 'error'
  result?: AnalysisResult
  error?: string
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '')
    throw new Error(`API ${resp.status}: ${detail}`)
  }
  return resp.json() as Promise<T>
}

/** 请求 AI 应手 */
export function requestAiMove(req: GameMoveRequest): Promise<GameMoveResponse> {
  return http<GameMoveResponse>('/game/move', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

/** 提交分析任务 */
export function submitAnalysis(req: {
  board_size: number
  komi: number
  max_visits: number
  moves: MoveDto[]
}): Promise<{ task_id: string; status: string }> {
  return http('/analysis', { method: 'POST', body: JSON.stringify(req) })
}

/** 查询分析任务状态 */
export function getAnalysisStatus(taskId: string): Promise<AnalysisStatus> {
  return http(`/analysis/${taskId}`)
}

/** 提交分析并轮询直到完成 */
export async function analyzePosition(
  req: { board_size: number; komi: number; max_visits: number; moves: MoveDto[] },
  pollInterval = 500,
  timeout = 60000,
): Promise<AnalysisResult> {
  const { task_id } = await submitAnalysis(req)
  const start = Date.now()
  for (;;) {
    const status = await getAnalysisStatus(task_id)
    if (status.status === 'done' && status.result) return status.result
    if (status.status === 'error') throw new Error(status.error ?? '分析失败')
    if (Date.now() - start > timeout) throw new Error('分析超时')
    await new Promise((r) => setTimeout(r, pollInterval))
  }
}

// ===== AI 解说 =====

export interface CommentaryCandidateDto {
  move: string | null
  winrate: number | null
  score_lead: number | null
  visits: number | null
  pv: string[]
}

export interface CommentaryRequest {
  move_number: number
  player: 'black' | 'white'
  move: string | null
  board_size: number
  level: 'beginner' | 'intermediate' | 'advanced'
  candidates: CommentaryCandidateDto[]
  root_winrate: number | null
  root_score_lead: number | null
  recent_summary: string | null
}

/** 提交解说请求，返回 task_id */
export function requestCommentary(
  req: CommentaryRequest,
): Promise<{ task_id: string }> {
  return http('/commentary/generate', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

/** 读取解说 SSE 流，逐块回调 onText；出错抛异常。 */
export async function streamCommentary(
  taskId: string,
  onText: (chunk: string) => void,
): Promise<void> {
  const resp = await fetch(`${BASE}/commentary/stream/${taskId}`)
  if (!resp.ok || !resp.body) {
    throw new Error(`解说请求失败 ${resp.status}`)
  }
  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    // 按 SSE 事件（空行分隔）解析
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      const line = part.trim()
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data) continue
      try {
        const obj = JSON.parse(data)
        if (obj.error) throw new Error(obj.error)
        if (obj.text) onText(obj.text)
      } catch (e) {
        if (e instanceof SyntaxError) continue
        throw e
      }
    }
  }
}

// ===== 棋力评估 =====

export interface ProblemOut {
  id: number
  category: string
  tag: string
  difficulty: number
  sgf: string
}

export interface AnswerResponse {
  correct: boolean
  correct_move: string
  explanation: string
}

export interface ProblemResultDto {
  category: string
  tag: string
  correct: boolean
}

export interface GameOverlapDto {
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

export function getProblems(
  category: string,
  limit = 5,
): Promise<ProblemOut[]> {
  const q = new URLSearchParams({ category, limit: String(limit) })
  return http(`/assessment/problems?${q.toString()}`)
}

export function submitAnswer(
  problemId: number,
  vertex: string,
): Promise<AnswerResponse> {
  return http('/assessment/answer', {
    method: 'POST',
    body: JSON.stringify({ problem_id: problemId, vertex }),
  })
}

export function getAssessmentReport(
  problemResults: ProblemResultDto[],
  gameOverlaps: GameOverlapDto[],
): Promise<AssessmentReport> {
  return http('/assessment/report', {
    method: 'POST',
    body: JSON.stringify({
      problem_results: problemResults,
      game_overlaps: gameOverlaps,
    }),
  })
}

// ===== 课程 =====

export interface CourseListItem {
  id: number
  title: string
  description: string
  dimension: string
  difficulty: number
  lesson_count: number
}

export interface StepOut {
  id: number
  order_index: number
  sgf: string | null
  instruction: string
  expected_move: string | null
  explanation: string
}

export interface LessonOut {
  id: number
  title: string
  order_index: number
  steps: StepOut[]
}

export interface CourseDetail {
  id: number
  title: string
  description: string
  dimension: string
  difficulty: number
  lessons: LessonOut[]
}

export function getCourses(): Promise<CourseListItem[]> {
  return http('/course')
}

export function getCourse(id: number): Promise<CourseDetail> {
  return http(`/course/${id}`)
}

export function updateProgress(
  courseId: number,
  data: {
    completed_lessons?: number
    correct_count?: number
    attempt_count?: number
    time_spent?: number
    finished?: number
  },
): Promise<unknown> {
  return http(`/course/${courseId}/progress`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}
