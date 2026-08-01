/**
 * 棋力评估页：编排四阶段流程（规则认知 -> 基础技巧 -> 实战对弈 -> 定级报告）。
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import ProblemStage from '../components/ProblemStage'
import GameStage from '../components/GameStage'
import RadarChart from '../components/RadarChart'
import { computeReport, type AssessmentReport } from '../lib/assessment'
import { useSettingsStore } from '../stores/settingsStore'

/** 评估流程各阶段 */
type Stage = 'intro' | 'rules' | 'techniques' | 'games' | 'report'

/** 答题结果 */
interface ProblemResult {
  category: string
  tag: string
  correct: boolean
}

/** 实战重合度 */
interface GameOverlap {
  max_visits: number
  overlap_rate: number
  move_count: number
}

export default function AssessmentPage() {
  const engineSource = useSettingsStore((s) => s.engineSource)
  const [stage, setStage] = useState<Stage>('intro')
  const [problemResults, setProblemResults] = useState<ProblemResult[]>([])
  const [gameOverlaps, setGameOverlaps] = useState<GameOverlap[]>([])
  const [report, setReport] = useState<AssessmentReport | null>(null)

  // 进入报告阶段时本地计算定级报告
  useEffect(() => {
    if (stage !== 'report') return
    setReport(computeReport(problemResults, gameOverlaps))
  }, [stage, problemResults, gameOverlaps])

  if (stage === 'intro') {
    return (
      <div className="assessment-page">
        <h1>棋力评估</h1>
        <p className="subtitle">
          评估分四个阶段：规则认知、基础技巧、实战对弈、定级报告。
          完成后会得到你的棋力等级、五维能力雷达图与个性化课程推荐。
        </p>
        <button className="btn primary" onClick={() => setStage('rules')}>
          开始评估
        </button>
      </div>
    )
  }

  if (stage === 'rules') {
    return (
      <div className="assessment-page">
        <ProblemStage
          category="规则认知"
          title="第一阶段：规则认知"
          onComplete={(results) => {
            setProblemResults((prev) => [...prev, ...results])
            setStage('techniques')
          }}
        />
      </div>
    )
  }

  if (stage === 'techniques') {
    return (
      <div className="assessment-page">
        <ProblemStage
          category="基础技巧"
          title="第二阶段：基础技巧"
          onComplete={(results) => {
            setProblemResults((prev) => [...prev, ...results])
            setStage('games')
          }}
        />
      </div>
    )
  }

  if (stage === 'games') {
    return (
      <div className="assessment-page">
        {engineSource === 'browser' && (
          <p className="hint-sm" style={{ marginBottom: 12 }}>
            当前为轻量引擎（WASM b6c96），实战评估结果仅供参考；建议连接本地引擎获得准确评估（设置页「远程连接」指引）。
          </p>
        )}
        <GameStage
          onComplete={(overlaps) => {
            setGameOverlaps(overlaps)
            setStage('report')
          }}
        />
      </div>
    )
  }

  // report
  return (
    <div className="assessment-page report-page">
      <h1>定级报告</h1>
      {report && (
        <>
          <div className="report-level">
            <span className="level-badge">{report.level}</span>
            <span className="hint">综合分 {report.overall_score}</span>
          </div>
          <RadarChart data={report.radar} />
          {report.weak_dimensions.length > 0 && (
            <p className="hint">
              薄弱环节：{report.weak_dimensions.join('、')}
            </p>
          )}
          <div className="report-courses">
            <h3>推荐课程</h3>
            {report.recommended_courses.map((c) => (
              <Link key={c.id} to={`/course/${c.id}`} className="entry-card">
                <h2>{c.title}</h2>
                <p>维度：{c.dimension}</p>
              </Link>
            ))}
          </div>
          <div className="report-actions">
            <Link to="/course" className="btn primary">
              进入课程
            </Link>
            <button className="btn" onClick={() => window.location.reload()}>
              重新评估
            </button>
          </div>
        </>
      )}
    </div>
  )
}
