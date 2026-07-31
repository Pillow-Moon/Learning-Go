/**
 * 课程详情页（纯前端：从 JSON 加载，逐步教学）。
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import GoBoardCanvas from '../components/GoBoardCanvas'
import coursesData from '../data/courses.json'
import { parseSgf, gtpToVertex } from '../lib/sgfParser'
import { vertexToCoord } from '../lib/boardUtils'
import type { Vertex } from '../lib/types'
import { saveCourseProgress, getCourseProgress } from '../lib/db'

interface FlatStep {
  lessonTitle: string
  instruction: string
  sgf: string | null
  expectedMove: string | null
  explanation: string
}

export default function CourseDetailPage() {
  const { id } = useParams()
  const [stepIdx, setStepIdx] = useState(0)
  const [answered, setAnswered] = useState<{ correct: boolean } | null>(null)

  // 从 IndexedDB 恢复进度
  useEffect(() => {
    const loadProgress = async () => {
      if (!id) return
      const progress = await getCourseProgress(Number(id))
      if (progress) {
        setStepIdx(progress.lastStepIndex)
      }
    }
    loadProgress()
  }, [id])

  // 从 JSON 中查找课程
  const course = useMemo(() => {
    if (!id) return null
    const found = coursesData.find((c: any) => c.id === Number(id))
    if (!found) return null
    // 扁平化 steps
    const flat: FlatStep[] = found.lessons.flatMap((l: any) =>
      l.steps.map((s: any) => ({
        lessonTitle: l.title,
        instruction: s.instruction,
        sgf: s.sgf,
        expectedMove: s.expected_move,
        explanation: s.explanation,
      })),
    )
    return { ...found, flatSteps: flat }
  }, [id])

  if (!course) return <p className="hint">课程不存在。</p>

  const step = course.flatSteps[stepIdx]
  const parsed = step.sgf ? parseSgf(step.sgf) : null
  const isLast = stepIdx === course.flatSteps.length - 1

  const handlePlay = (vertex: Vertex) => {
    if (!step.expectedMove || answered || !parsed) return
    const coord = vertexToCoord(vertex, parsed.boardSize)
    const correct = coord.toUpperCase() === step.expectedMove!.toUpperCase()
    setAnswered({ correct })
  }

  const goNext = () => {
    if (isLast) {
      saveCourseProgress({
        courseId: Number(id),
        completedSteps: course.flatSteps.length,
        totalSteps: course.flatSteps.length,
        lastStepIndex: course.flatSteps.length - 1,
      })
      return
    }
    const newIdx = stepIdx + 1
    setStepIdx(newIdx)
    setAnswered(null)
    saveCourseProgress({
      courseId: Number(id),
      completedSteps: newIdx + 1,
      totalSteps: course.flatSteps.length,
      lastStepIndex: newIdx,
    })
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
        {step.lessonTitle} · 步骤 {stepIdx + 1}/{course.flatSteps.length}
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
