/**
 * 评估答题阶段：规则认知 / 基础技巧（纯前端版）。
 * 题目从 JSON 加载，答案本地比对。
 */
import { useMemo, useState } from 'react'

import GoBoardCanvas from './GoBoardCanvas'
import problemsData from '../data/problems.json'
import { parseSgf } from '../lib/sgfParser'
import { vertexToCoord } from '../lib/boardUtils'
import type { Vertex } from '../lib/types'

interface ProblemResult {
  category: string
  tag: string
  correct: boolean
}

interface Props {
  category: string
  title: string
  onComplete: (results: ProblemResult[]) => void
}

interface ProblemItem {
  id: number; category: string; tag: string; difficulty: number
  sgf: string; correct_move: string; explanation: string
}

export default function ProblemStage({ category, title, onComplete }: Props) {
  const problems = useMemo<ProblemItem[]>(() => {
    return (problemsData as ProblemItem[])
      .filter((p) => p.category === category)
      .sort(() => Math.random() - 0.5) // 随机打乱
      .slice(0, 5)
  }, [category])

  const [index, setIndex] = useState(0)
  const [results, setResults] = useState<ProblemResult[]>([])
  const [feedback, setFeedback] = useState<{ correct: boolean; explanation: string } | null>(null)

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

  const handlePlay = (vertex: Vertex) => {
    if (feedback) return
    const coord = vertexToCoord(vertex, parsed.boardSize)
    const correct = coord.toUpperCase() === problem.correct_move.toUpperCase()
    const newResults = [
      ...results,
      { category: problem.category, tag: problem.tag, correct },
    ]
    setResults(newResults)
    setFeedback({ correct, explanation: problem.explanation })
  }

  const next = () => {
    const answered = results.length
    const correctCount = results.filter((r) => r.correct).length
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
