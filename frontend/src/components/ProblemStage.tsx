/**
 * 评估答题阶段：规则认知 / 基础技巧。
 * 渲染题目 SGF 局面，用户点击落子作答，自适应（做满 3 题且正确率 >80% 跳过剩余）。
 */
import { useEffect, useState } from 'react'

import GoBoardCanvas from './GoBoardCanvas'
import { getProblems, submitAnswer, type ProblemOut, type ProblemResultDto } from '../services/api'
import { parseSgf } from '../lib/sgfParser'
import { vertexToCoord } from '../lib/boardUtils'
import type { Vertex } from '../lib/types'

interface Props {
  category: string
  title: string
  onComplete: (results: ProblemResultDto[]) => void
}

export default function ProblemStage({ category, title, onComplete }: Props) {
  const [problems, setProblems] = useState<ProblemOut[]>([])
  const [index, setIndex] = useState(0)
  const [results, setResults] = useState<ProblemResultDto[]>([])
  const [feedback, setFeedback] = useState<{ correct: boolean; explanation: string } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getProblems(category, 5)
      .then((ps) => setProblems(ps))
      .finally(() => setLoading(false))
  }, [category])

  if (loading) return <p className="hint">加载题目中…</p>
  if (problems.length === 0) {
    return (
      <div>
        <p className="hint">暂无该类别题目。</p>
        <button className="btn primary" onClick={() => onComplete([])}>
          跳过此阶段
        </button>
      </div>
    )
  }

  const problem = problems[index]
  const parsed = parseSgf(problem.sgf)

  const handlePlay = async (vertex: Vertex) => {
    if (feedback) return
    const coord = vertexToCoord(vertex, parsed.boardSize)
    const resp = await submitAnswer(problem.id, coord)
    const newResults = [
      ...results,
      { category: problem.category, tag: problem.tag, correct: resp.correct },
    ]
    setResults(newResults)
    setFeedback({ correct: resp.correct, explanation: resp.explanation })
  }

  const next = () => {
    const answered = results.length
    const correctCount = results.filter((r) => r.correct).length
    // 自适应：做满 3 题且正确率 >80% 跳过剩余
    const shouldSkip = answered >= 3 && correctCount / answered > 0.8
    if (shouldSkip || index + 1 >= problems.length) {
      onComplete(results)
      return
    }
    setIndex(index + 1)
    setFeedback(null)
  }

  return (
    <div className="assessment-stage">
      <h2>{title}</h2>
      <p className="hint">
        第 {index + 1} / {problems.length} 题 · 标签：{problem.tag} ·{' '}
        {parsed.playerToMove === 1 ? '黑先' : '白先'}
      </p>
      <div className="assessment-board">
        <GoBoardCanvas
          board={parsed.board}
          boardSize={parsed.boardSize}
          currentPlayer={parsed.playerToMove}
          lastMove={null}
          interactive={!feedback}
          pixelSize={420}
          onPlay={handlePlay}
        />
      </div>
      <p className="hint">点击棋盘选择你的落子。</p>
      {feedback && (
        <div className={`feedback ${feedback.correct ? 'correct' : 'wrong'}`}>
          <strong>{feedback.correct ? '✓ 正确' : '✗ 再想想'}</strong>
          <p>{feedback.explanation}</p>
          <button className="btn primary" onClick={next}>
            {index + 1 >= problems.length ||
            (results.length >= 3 &&
              results.filter((r) => r.correct).length / results.length > 0.8)
              ? '完成本阶段'
              : '下一题'}
          </button>
        </div>
      )}
    </div>
  )
}
