/**
 * 棋力评估页：编排四阶段流程（规则认知 -> 基础技巧 -> 实战对弈 -> 定级报告）。
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import ProblemStage from '../components/ProblemStage'
import GameStage from '../components/GameStage'
import RadarChart from '../components/RadarChart'
import {
  getAssessmentReport,
  type AssessmentReport,
  type GameOverlapDto,
  type ProblemResultDto,
} from '../services/api'

type Stage = 'intro' | 'rules' | 'techniques' | 'games' | 'report'

export default function AssessmentPage() {
  const [stage, setStage] = useState<Stage>('intro')
  const [problemResults, setProblemResults] = useState<ProblemResultDto[]>([])
  const [gameOverlaps, setGameOverlaps] = useState<GameOverlapDto[]>([])
  const [report, setReport] = useState<AssessmentReport | null>(null)
  const [loadingReport, setLoadingReport] = useState(false)

  // 进入报告阶段时请求定级报告
  useEffect(() => {
    if (stage !== 'report') return
    setLoadingReport(true)
    getAssessmentReport(problemResults, gameOverlaps)
      .then(setReport)
      .finally(() => setLoadingReport(false))
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
      {loadingReport && <p className="hint">生成报告中…</p>}
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
