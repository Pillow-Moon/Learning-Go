/**
 * Diagnosis2Page —— AI 棋局诊断与个性化训练推荐。
 *
 * 数据流：历史棋谱（IndexedDB）→ 批量整盘分析（KataGo）→ 错误分类 →
 * 聚合统计 → 规则训练处方（始终可用）+ LLM 诊断报告（BYOK，可选）。
 * 问题手列表可点击跳转「研究」页对应手数。
 */
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import ReactMarkdown from 'react-markdown'

import { useDiagnosisStore } from '../../stores/diagnosisStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { listGames, type GameRecord } from '../../lib/db'
import { DIAGNOSIS_TYPES, type DiagnosisIssue, type DiagnosisType } from '../../lib/diagnosis'
import { buildTrainingPlan } from '../../lib/trainingPlan'
import { buildDiagnosisPrompt, callLLM } from '../../lib/llm'
import { vertexToCoord } from '../../lib/boardUtils'

const TYPE_META: Record<DiagnosisType, { label: string; color: string }> = {
  'life-death': { label: '死活漏算', color: '#e5534b' },
  joseki: { label: '定式与布局', color: '#e8a33d' },
  direction: { label: '选点与方向', color: '#4b8fe5' },
  endgame: { label: '官子', color: '#8b8b9e' },
}

export default function Diagnosis2Page() {
  const diag = useDiagnosisStore(
    useShallow((s) => ({
      status: s.status,
      progress: s.progress,
      error: s.error,
      diagnostics: s.diagnostics,
      stats: s.stats,
      analyzeGames: s.analyzeGames,
      stopAnalysis: s.stopAnalysis,
    })),
  )
  const userLevel = useSettingsStore((s) => s.userLevel)
  const setUserLevel = useSettingsStore((s) => s.setUserLevel)
  const llmApiKey = useSettingsStore((s) => s.llmApiKey)
  const llmBaseURL = useSettingsStore((s) => s.llmBaseURL)
  const llmModel = useSettingsStore((s) => s.llmModel)

  const [history, setHistory] = useState<GameRecord[]>([])
  const [range, setRange] = useState(10)
  const [llmReport, setLlmReport] = useState<string | null>(null)
  const [llmLoading, setLlmLoading] = useState(false)
  const [llmError, setLlmError] = useState<string | null>(null)

  useEffect(() => {
    listGames(50)
      .then(setHistory)
      .catch(() => setHistory([]))
  }, [])

  const running = diag.status === 'running'
  const selectedIds = useMemo(
    () =>
      history
        .slice(0, range)
        .map((g) => g.id ?? -1)
        .filter((id) => id >= 0),
    [history, range],
  )

  // 训练处方（规则版，始终可用；无 LLM 时作为唯一报告）
  const plan = useMemo(
    () => (diag.stats ? buildTrainingPlan(diag.stats, userLevel) : null),
    [diag.stats, userLevel],
  )

  // 汇总问题手（带局信息，供跳转研究页；按损失降序）
  const allIssues = useMemo(() => {
    const list: { issue: DiagnosisIssue; gameId: number; gameCreatedAt: string }[] = []
    for (const d of diag.diagnostics) {
      for (const issue of d.issues) {
        list.push({ issue, gameId: d.gameId, gameCreatedAt: d.createdAt })
      }
    }
    return list.sort((a, b) => b.issue.loss - a.issue.loss)
  }, [diag.diagnostics])

  const maxCount = diag.stats
    ? Math.max(1, ...DIAGNOSIS_TYPES.map((t) => diag.stats!.byType[t].count))
    : 1

  const handleStart = () => {
    setLlmReport(null)
    setLlmError(null)
    void diag.analyzeGames(selectedIds)
  }

  const handleGenerateReport = async () => {
    if (!diag.stats || llmLoading) return
    setLlmLoading(true)
    setLlmError(null)
    setLlmReport(null)
    try {
      const messages = buildDiagnosisPrompt(diag.stats, userLevel)
      const text = await callLLM(messages, {
        apiKey: llmApiKey,
        baseURL: llmBaseURL,
        model: llmModel,
      })
      setLlmReport(text)
    } catch (err) {
      setLlmError(err instanceof Error ? err.message : '生成失败')
    } finally {
      setLlmLoading(false)
    }
  }

  return (
    <div className="v2-page">
      <div className="v2-layout">
        {/* ===== 左栏：诊断控制 ===== */}
        <aside className="v2-col v2-left">
          <div className="v2-panel">
            <div className="v2-panel-head">棋局诊断</div>
            <div className="v2-panel-body" style={{ padding: 12 }}>
              <div className="v2-opt-row">
                <span className="v2-opt-label">诊断范围</span>
                <select
                  className="select"
                  value={range}
                  onChange={(e) => setRange(Number(e.target.value))}
                  disabled={running}
                >
                  <option value={5}>最近 5 局</option>
                  <option value={10}>最近 10 局</option>
                  <option value={20}>最近 20 局</option>
                </select>
              </div>
              <div className="v2-opt-row">
                <span className="v2-opt-label">我的级位</span>
                <input
                  className="select"
                  type="number"
                  min={1}
                  max={25}
                  value={userLevel}
                  onChange={(e) => setUserLevel(Number(e.target.value))}
                  style={{ width: 72 }}
                />
              </div>
              <div className="v2-actions" style={{ gridTemplateColumns: '1fr' }}>
                <button
                  className={`btn ${running ? 'danger' : 'primary'}`}
                  onClick={running ? diag.stopAnalysis : handleStart}
                  disabled={selectedIds.length === 0 && !running}
                >
                  {running
                    ? '停止诊断'
                    : diag.diagnostics.length > 0
                      ? '重新诊断'
                      : '开始诊断'}
                </button>
              </div>

              {running && (
                <div style={{ marginTop: 10 }}>
                  <div className="info-label">
                    正在分析：{diag.progress.currentName ?? '…'}
                  </div>
                  <div
                    style={{
                      height: 8,
                      background: 'var(--bg-soft, #eee)',
                      borderRadius: 4,
                      marginTop: 4,
                    }}
                  >
                    <div
                      style={{
                        width: `${diag.progress.total > 0 ? (diag.progress.done / diag.progress.total) * 100 : 0}%`,
                        height: '100%',
                        background: 'var(--primary-dark)',
                        borderRadius: 4,
                        transition: 'width 0.3s',
                      }}
                    />
                  </div>
                  <p className="hint-sm" style={{ marginTop: 4 }}>
                    {diag.progress.done} / {diag.progress.total} 局
                  </p>
                </div>
              )}
              {diag.error && (
                <p className="error" style={{ marginTop: 8 }}>
                  {diag.error}
                </p>
              )}
              <p className="hint-sm" style={{ marginTop: 10 }}>
                诊断会逐手调用 KataGo 分析（Local 约 1~3 分钟/局，WASM 较慢）。
                已诊断过的对局会复用缓存。分析期间请勿在其他页面同时使用 AI 对弈。
              </p>
            </div>
          </div>

          <div className="v2-panel">
            <div className="v2-panel-head">历史棋谱（{history.length}）</div>
            <div className="v2-tree">
              {history.length === 0 && (
                <div className="v2-empty">
                  暂无历史对局——先到「对弈」或「研究」页保存几盘再回来诊断
                </div>
              )}
              {history.slice(0, 20).map((rec) => (
                <div key={rec.id} className="v2-tree-row">
                  <span className="v2-tree-tag main">{rec.boardSize}路</span>
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {rec.result} ·{' '}
                    {new Date(rec.createdAt).toLocaleString('zh-CN', { hour12: false })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* ===== 中栏：统计分布 + 问题手 ===== */}
        <div className="v2-col v2-board-col">
          <div className="v2-panel">
            <div className="v2-panel-head">错误类型分布</div>
            <div className="v2-panel-body" style={{ padding: 12 }}>
              {diag.stats ? (
                <>
                  <p className="hint-sm" style={{ marginBottom: 10 }}>
                    最近 {diag.stats.gameCount} 局 · 共 {diag.stats.totalIssues} 个问题手
                    （胜率损失 ≥3%）
                  </p>
                  {DIAGNOSIS_TYPES.map((t) => {
                    const s = diag.stats!.byType[t]
                    const meta = TYPE_META[t]
                    const pct = (s.count / maxCount) * 100
                    return (
                      <div key={t} style={{ marginBottom: 10 }}>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            fontSize: 12,
                            marginBottom: 2,
                          }}
                        >
                          <span>
                            <span
                              style={{
                                display: 'inline-block',
                                width: 8,
                                height: 8,
                                borderRadius: 2,
                                background: meta.color,
                                marginRight: 6,
                              }}
                            />
                            {meta.label}（{s.count} 手）
                          </span>
                          <span className="hint-sm">
                            均损 {(s.avgLoss * 100).toFixed(1)}% · 最大{' '}
                            {(s.maxLoss * 100).toFixed(1)}%
                          </span>
                        </div>
                        <div
                          style={{
                            height: 8,
                            background: 'var(--bg-soft, #eee)',
                            borderRadius: 4,
                          }}
                        >
                          <div
                            style={{
                              width: `${pct}%`,
                              height: '100%',
                              background: meta.color,
                              borderRadius: 4,
                              transition: 'width 0.4s',
                            }}
                          />
                        </div>
                      </div>
                    )
                  })}
                  {diag.stats.totalIssues === 0 && (
                    <div className="v2-empty">该范围内没有检测到问题手</div>
                  )}
                </>
              ) : (
                <div className="v2-empty">在左栏选择范围并点击「开始诊断」</div>
              )}
            </div>
          </div>

          <div className="v2-panel">
            <div className="v2-panel-head">问题手（{allIssues.length}）</div>
            <div className="v2-panel-body" style={{ padding: 8 }}>
              {allIssues.length === 0 ? (
                <div className="v2-empty">暂无问题手，点击左侧开始诊断</div>
              ) : (
                <div className="issue-list">
                  {allIssues.slice(0, 60).map(({ issue, gameId }) => (
                    <Link
                      key={`${gameId}-${issue.moveIndex}`}
                      to={`/study?game=${gameId}&move=${issue.moveIndex}`}
                      className="issue-item"
                      style={{ textDecoration: 'none' }}
                      title="在研究页查看该手"
                    >
                      <span
                        className="issue-label"
                        style={{ background: TYPE_META[issue.type].color }}
                      >
                        {TYPE_META[issue.type].label}
                      </span>
                      <span className="issue-move">
                        第 {issue.moveIndex} 手 ·{' '}
                        {issue.vertex ? vertexToCoord(issue.vertex, 19) : '虚手'}
                      </span>
                      <span className="issue-loss">
                        -{(issue.loss * 100).toFixed(1)}%
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ===== 右栏：训练处方 + LLM 报告 ===== */}
        <aside className="v2-col v2-right">
          <div className="v2-panel">
            <div className="v2-panel-head">训练处方（规则版）</div>
            <div className="v2-panel-body" style={{ padding: 12 }}>
              {plan ? (
                <>
                  <p style={{ margin: '0 0 10px', fontWeight: 600 }}>{plan.headline}</p>
                  {plan.exercises.map((e, i) => (
                    <div key={i} style={{ marginBottom: 10 }}>
                      <div className="info-label">
                        {e.title}
                        {e.dailyMinutes ? `（约 ${e.dailyMinutes} 分钟/天）` : ''}
                      </div>
                      <p className="hint-sm" style={{ margin: '4px 0 0' }}>
                        {e.detail}
                      </p>
                    </div>
                  ))}
                  <div className="info-label">推荐资源</div>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                    {plan.resources.map((r, i) => (
                      <li key={i} className="hint-sm">
                        {r}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <div className="v2-empty">完成诊断后自动生成</div>
              )}
            </div>
          </div>

          <div className="v2-panel">
            <div className="v2-panel-head">AI 诊断报告（LLM）</div>
            <div className="v2-panel-body" style={{ padding: 12 }}>
              {llmApiKey.trim() ? (
                <button
                  className="btn primary"
                  onClick={handleGenerateReport}
                  disabled={!diag.stats || llmLoading}
                >
                  {llmLoading ? '生成中…（最长 60 秒）' : '生成 AI 诊断报告'}
                </button>
              ) : (
                <p className="hint-sm">
                  未配置 LLM 密钥——<Link to="/settings">前往设置</Link>
                  配置后可生成 AI 总结报告（规则版处方不受影响）。
                </p>
              )}
              {llmError && <p className="error" style={{ marginTop: 8 }}>{llmError}</p>}
              {llmReport && (
                <div className="v2-comment" style={{ marginTop: 10 }}>
                  <div className="v2-comment-text">
                    <ReactMarkdown>{llmReport}</ReactMarkdown>
                  </div>
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
