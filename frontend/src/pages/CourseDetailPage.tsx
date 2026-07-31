/**
 * 课程详情页：逐步教学（讲解 + 棋盘演示 + 交互落子）。
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import GoBoardCanvas from '../components/GoBoardCanvas'
import { getCourse, updateProgress, type CourseDetail } from '../services/api'
import { parseSgf, gtpToVertex } from '../lib/sgfParser'
import { vertexToCoord } from '../lib/boardUtils'
import type { Vertex } from '../lib/types'

interface FlatStep {
  lessonTitle: string
  instruction: string
  sgf: string | null
  expectedMove: string | null
  explanation: string
}

export default function CourseDetailPage() {
  const { id } = useParams()
  const [course, setCourse] = useState<CourseDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [stepIdx, setStepIdx] = useState(0)
  const [answered, setAnswered] = useState<{ correct: boolean } | null>(null)

  useEffect(() => {
    if (!id) return
    getCourse(Number(id))
      .then(setCourse)
      .finally(() => setLoading(false))
  }, [id])

  const steps: FlatStep[] = useMemo(() => {
    if (!course) return []
    return course.lessons.flatMap((l) =>
      l.steps.map((s) => ({
        lessonTitle: l.title,
        instruction: s.instruction,
        sgf: s.sgf,
        expectedMove: s.expected_move,
        explanation: s.explanation,
      })),
    )
  }, [course])

  useEffect(() => {
    setAnswered(null)
  }, [stepIdx])

  if (loading) return <p className="hint">加载课程中…</p>
  if (!course) return <p className="hint">课程不存在。</p>

  const step = steps[stepIdx]
  const parsed = step.sgf ? parseSgf(step.sgf) : null
  const isLast = stepIdx === steps.length - 1

  const handlePlay = (vertex: Vertex) => {
    if (!step.expectedMove || answered || !parsed) return
    const coord = vertexToCoord(vertex, parsed.boardSize)
    const correct = coord.toUpperCase() === step.expectedMove.toUpperCase()
    setAnswered({ correct })
  }

  const goNext = () => {
    if (isLast) {
      void updateProgress(course.id, {
        completed_lessons: course.lessons.length,
        finished: 1,
      })
      return
    }
    setStepIdx((i) => i + 1)
  }

  const expectedVertex =
    step.expectedMove && parsed ? gtpToVertex(step.expectedMove, parsed.boardSize) : null

  return (
    <div className="course-detail-page">
      <Link to="/course" className="hint">
        ← 返回课程列表
      </Link>
      <h1>{course.title}</h1>
      <p className="hint">
        {step.lessonTitle} · 步骤 {stepIdx + 1}/{steps.length}
      </p>

      <div className="course-step">
        <div className="course-instruction">
          <p>{step.instruction}</p>
          {step.expectedMove && !answered && (
            <p className="hint">在棋盘上点击你认为正确的落子。</p>
          )}
          {answered && (
            <div className={`feedback ${answered.correct ? 'correct' : 'wrong'}`}>
              <strong>{answered.correct ? '✓ 正确' : '✗ 看看正解'}</strong>
              <p>{step.explanation}</p>
            </div>
          )}
          {!step.expectedMove && step.explanation && (
            <p className="hint">{step.explanation}</p>
          )}
        </div>

        {parsed && (
          <div className="assessment-board">
            <GoBoardCanvas
              board={parsed.board}
              boardSize={parsed.boardSize}
              currentPlayer={parsed.playerToMove}
              lastMove={null}
              highlights={answered && expectedVertex ? [expectedVertex] : null}
              interactive={!!step.expectedMove && !answered}
              pixelSize={400}
              onPlay={handlePlay}
            />
          </div>
        )}
      </div>

      <div className="course-nav">
        <button className="btn" onClick={() => setStepIdx((i) => Math.max(0, i - 1))} disabled={stepIdx === 0}>
          上一步
        </button>
        <button
          className="btn primary"
          onClick={goNext}
          disabled={!!step.expectedMove && !answered}
        >
          {isLast ? '完成课程' : '下一步'}
        </button>
      </div>
    </div>
  )
}
