/**
 * Play2Page —— 本地双人对弈页（2026-08 精简：AI 对弈已移除，对局使用星阵等外部平台）
 * 三栏布局：左栏对局选项，中央棋盘与道具工具栏，右栏选项卡（胜率/落子记录/候选点）。
 * 对局状态机 useGameStore（双人轮换落子）；分析 useAnalysisStore：候选点/领地/胜率/目差。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import GoBoardCanvas from '../../components/GoBoardCanvas'
import { useGameStore } from '../../stores/gameStore'
import { useAnalysisStore } from '../../stores/analysisStore'
import { buildEngineMoves } from '../../lib/boardUtils'
import type { Vertex } from '../../lib/types'

/** 分析深度 → 搜索量（点目/领地/支招分析用，统一低值 + 引擎超时兜底） */
const SPEED_VISITS: Record<string, number> = { slow: 100, normal: 50, fast: 25 }

/** 棋盘坐标标签（A-T 跳 I，行号倒序） */
function coordLabel(x: number, y: number, size: number): string {
  const cols = 'ABCDEFGHJKLMNOPQRST'
  return cols[x] + String(size - y)
}

export default function Play2Page() {
  // 对局状态机（真实引擎）
  const {
    board,
    boardSize,
    currentPlayer,
    lastMove,
    status,
    moves,
    komi,
    handicapStones,
    result,
    newGame,
    playMove,
    pass,
    resign,
    undo,
    confirmScoring,
    continueScoring,
  } = useGameStore()
  // 局面分析
  const {
    candidates,
    rootWinrate,
    rootScoreLead,
    ownership,
    analyzing,
    analyzedMoveCount,
    analyze,
    clear,
  } = useAnalysisStore()

  // 对局选项（UI 状态）
  const [sizeOpt, setSizeOpt] = useState<9 | 13 | 19>(19)
  const [komiOpt, setKomiOpt] = useState('7.5')
  const [handicapOpt, setHandicapOpt] = useState('0')
  const [speed, setSpeed] = useState('normal')

  // 道具与界面状态
  const [territoryOn, setTerritoryOn] = useState(false)
  const [hintOn, setHintOn] = useState(false)
  const [variationOn, setVariationOn] = useState(false)
  const [tab, setTab] = useState<'win' | 'moves' | 'cand'>('win')
  const [highlightPv, setHighlightPv] = useState<Vertex[] | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [seconds, setSeconds] = useState(0)
  const timer = useRef<number | null>(null)

  // 领地显示开关（仿星阵：按钮控制，默认关闭）
  const [showOwnershipEnabled, setShowOwnershipEnabled] = useState(false)

  // 局面变化后清除过期分析
  useEffect(() => {
    clear()
    setHighlightPv(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moves.length])

  // 对局计时
  useEffect(() => {
    if (status === 'finished' || status === 'idle') return
    timer.current = window.setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => {
      if (timer.current) window.clearInterval(timer.current)
    }
  }, [status])

  // 提示自动消失
  useEffect(() => {
    if (!msg) return
    const t = window.setTimeout(() => setMsg(null), 2600)
    return () => window.clearTimeout(t)
  }, [msg])

  // 双方虚手（scoring）：自动触发终局点目分析
  useEffect(() => {
    if (status !== 'scoring') return
    if (analyzing || analyzedMoveCount === moves.length) return
    clear()
    void analyze({
      moves: buildEngineMoves(moves, handicapStones),
      boardSize,
      komi,
      maxVisits: SPEED_VISITS[speed],
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  const flash = (text: string) => setMsg(text)
  const mm = Math.floor(seconds / 60)
  const ss = String(seconds % 60).padStart(2, '0')

  /** 新对局（选项 → newGame） */
  const restart = () => {
    newGame({
      size: sizeOpt,
      komi: Number(komiOpt),
      handicap: Number(handicapOpt),
    })
    setSeconds(0)
    setTerritoryOn(false)
    setHintOn(false)
    setVariationOn(false)
    setShowOwnershipEnabled(false)
    setHighlightPv(null)
    flash('新对局开始')
  }

  // 开局状态：idle 时展示选项面板，用户点「新对局」开始
  const started = status !== 'idle'

  // 候选点实时显示（分析中即可见，完成后落地；局面变化后隐藏）
  const showCandidates =
    analyzedMoveCount === moves.length || analyzing ? candidates : null
  // 变化图：榜首 pv 序列（原样式：带顺序编号的高亮）
  const boardHighlights = useMemo(() => {
    if (!variationOn || !showCandidates || !showCandidates[0]) return null
    return showCandidates[0].pv.filter((v) => v != null).slice(0, 10)
  }, [variationOn, showCandidates])

  // 候选点表格点击高亮（优先于变化图道具的榜首 pv）
  const showHighlights = highlightPv ?? boardHighlights

  // 领地覆盖层（按钮开关；点目状态强制显示）
  const showOwnership = showOwnershipEnabled || status === 'scoring' ? ownership : null

  /** 领地按钮：未分析触发分析，分析中/已完成切换显示 */
  const handleTerritoryToggle = () => {
    if (status === 'idle' || status === 'scoring') return
    if (analyzing) {
      setShowOwnershipEnabled((v) => !v)
      return
    }
    if (analyzedMoveCount !== moves.length) {
      setShowOwnershipEnabled(true)
      clear()
      void analyze({
        moves: buildEngineMoves(moves, handicapStones),
        boardSize,
        komi,
        maxVisits: SPEED_VISITS[speed],
      })
    } else {
      setShowOwnershipEnabled((v) => !v)
    }
  }

  /** 支招：触发当前局面分析 */
  const handleHint = () => {
    setHintOn(!hintOn)
    if (!hintOn) {
      flash('支招：AI 分析当前局面')
    }
    if (!showCandidates) {
      clear()
      void analyze({
        moves: buildEngineMoves(moves, handicapStones),
        boardSize,
        komi,
        maxVisits: SPEED_VISITS[speed],
      })
    }
  }

  const blackWinPct =
    rootWinrate != null ? Math.round(rootWinrate * 1000) / 10 : null
  const whiteWinPct = blackWinPct != null ? Math.round((100 - blackWinPct) * 10) / 10 : null
  const leadText = rootScoreLead != null ? rootScoreLead.toFixed(1) : null

  const moveRows: Array<{ no: number; black?: string; white?: string }> = []
  for (let i = 0; i < moves.length; i += 2) {
    const b = moves[i]
    const w = moves[i + 1]
    moveRows.push({
      no: i + 1,
      black: b ? (b.pass ? '虚' : coordLabel(b.vertex![0], b.vertex![1], boardSize)) : '',
      white: w ? (w.pass ? '虚' : coordLabel(w.vertex![0], w.vertex![1], boardSize)) : '',
    })
  }

  return (
    <div className="v2-page">
      <div className="v2-layout">
        {/* ===== 左栏：对局选项 ===== */}
        <aside className="v2-col v2-left">
          <div className="v2-panel">
            <div className="v2-opponent">
              <div className="v2-avatar">双</div>
              <div>
                <div className="v2-opponent-name">本地双人</div>
                <span className="v2-rank-badge">同屏轮换落子</span>
              </div>
            </div>
            <p className="hint-sm" style={{ padding: '0 12px 10px' }}>
              AI 对弈已移除：请使用星阵等外部平台对局，再导入 SGF 到「研究」页复盘。
            </p>
          </div>

          <div className="v2-panel">
            <div className="v2-panel-head">对局选项</div>
            <div className="v2-opt-row">
              <span className="v2-opt-label">棋盘</span>
              <div className="seg-group" style={{ flex: 1 }}>
                {([9, 13, 19] as const).map((s) => (
                  <button
                    key={s}
                    className={`seg-btn ${sizeOpt === s ? 'active' : ''}`}
                    onClick={() => setSizeOpt(s)}
                  >
                    {s} 路
                  </button>
                ))}
              </div>
            </div>
            <div className="v2-opt-row">
              <span className="v2-opt-label">贴目</span>
              <select
                className="select"
                value={komiOpt}
                onChange={(e) => setKomiOpt(e.target.value)}
              >
                <option value="6.5">6.5 目</option>
                <option value="7.5">7.5 目</option>
                <option value="8.5">8.5 目</option>
              </select>
            </div>
            <div className="v2-opt-row">
              <span className="v2-opt-label">让子</span>
              <select
                className="select"
                value={handicapOpt}
                onChange={(e) => setHandicapOpt(e.target.value)}
              >
                {[0, 2, 4, 6, 8, 9].map((n) => (
                  <option key={n} value={String(n)}>
                    {n === 0 ? '不让子' : `让 ${n} 子`}
                  </option>
                ))}
              </select>
            </div>
            <div className="v2-opt-row">
              <span className="v2-opt-label">分析深度</span>
              <select
                className="select"
                value={speed}
                onChange={(e) => setSpeed(e.target.value)}
              >
                <option value="slow">深度</option>
                <option value="normal">标准</option>
                <option value="fast">快速</option>
              </select>
            </div>
          </div>

          <div className="v2-panel">
            <div className="v2-actions">
              <button className="btn primary wide" onClick={restart}>
                新对局
              </button>
              <button className="btn" onClick={undo} disabled={moves.length === 0 || status === 'idle'}>
                悔棋
              </button>
              <button
                className="btn danger"
                onClick={resign}
                disabled={status !== 'playing'}
              >
                认输
              </button>
            </div>
          </div>
        </aside>

        {/* ===== 中央：道具 + 棋盘 ===== */}
        <div className="v2-col v2-board-col">
          <div className="v2-toolbar">
            <button
              className={`v2-tool-btn ${showOwnershipEnabled ? 'active' : ''}`}
              onClick={() => {
                setTerritoryOn(!territoryOn)
                handleTerritoryToggle()
              }}
              disabled={!started || status === 'scoring'}
            >
              <span className="v2-tool-icon">▦</span>领地
            </button>
            <button
              className={`v2-tool-btn ${hintOn ? 'active' : ''}`}
              onClick={handleHint}
              disabled={!started}
            >
              <span className="v2-tool-icon">◎</span>支招
            </button>
            <button
              className={`v2-tool-btn ${variationOn ? 'active' : ''}`}
              onClick={() => {
                setVariationOn(!variationOn)
                flash(variationOn ? '已关闭变化图' : '变化图：AI 构想（榜首变化）')
              }}
              disabled={!started}
            >
              <span className="v2-tool-icon">⬡</span>变化图
            </button>
            <button
              className="v2-tool-btn"
              onClick={pass}
              disabled={status !== 'playing'}
            >
              <span className="v2-tool-icon">空</span>虚手
            </button>
            <span className="v2-toolbar-sep" />
            <button
              className={`v2-tool-btn ${status === 'scoring' ? 'active' : ''}`}
              onClick={() => {
                setShowOwnershipEnabled(true)
                if (status === 'scoring') {
                  flash('请确认点目结果')
                } else {
                  flash('点目：需双方虚手后确认')
                }
              }}
              disabled={!started}
            >
              <span className="v2-tool-icon">⚖</span>点目
            </button>
            <div className="v2-turn">
              {status === 'idle' && <b>未开始</b>}
              {status === 'playing' && (
                <>
                  <span
                    className="turn-dot"
                    style={{
                      background: currentPlayer === 1 ? 'var(--text)' : 'var(--surface)',
                      border: '1px solid var(--border)',
                    }}
                  />{' '}
                  <b>{currentPlayer === 1 ? '黑方' : '白方'}落子</b>
                </>
              )}
              {status === 'scoring' && <b>点目确认</b>}
              {status === 'finished' && <b>对局结束</b>}
            </div>
          </div>

          <div className="v2-board-wrap">
            <GoBoardCanvas
              board={board}
              boardSize={boardSize}
              currentPlayer={currentPlayer}
              lastMove={lastMove}
              interactive={status === 'playing'}
              candidates={hintOn ? showCandidates : null}
              ownership={showOwnership}
              highlights={showHighlights}
              onPlay={(v) => {
                void playMove(v)
              }}
            />
            {msg && <div className="v2-board-msg">{msg}</div>}
            {status === 'finished' && result && (
              <div className="v2-board-msg" style={{ borderColor: 'var(--danger)' }}>
                {result}
              </div>
            )}
          </div>

          <div className="v2-statusbar">
            <span className="v2-stat">
              手数 <b>{moves.length}</b>
            </span>
            <span className="v2-stat">
              用时 <b>{mm}:{ss}</b>
            </span>
            <span className="v2-stat">
              贴目 <b>{komi}</b>
            </span>
          </div>

          {/* 点目确认面板 */}
          {status === 'scoring' && (
            <div className="scoring-panel">
              <div className="scoring-title">双方虚手，是否以当前形势确认点目？</div>
              <div className="scoring-actions">
                <button className="btn primary" onClick={confirmScoring}>
                  确认点目
                </button>
                <button className="btn" onClick={continueScoring}>
                  继续对弈
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ===== 右栏：选项卡面板 ===== */}
        <aside className="v2-col v2-right">
          <div className="side-tabs">
            <div className="side-tabbar">
              <button className={`side-tab ${tab === 'win' ? 'active' : ''}`} onClick={() => setTab('win')}>
                胜率
              </button>
              <button className={`side-tab ${tab === 'moves' ? 'active' : ''}`} onClick={() => setTab('moves')}>
                落子记录
              </button>
              <button className={`side-tab ${tab === 'cand' ? 'active' : ''}`} onClick={() => setTab('cand')}>
                候选点
              </button>
            </div>

            {tab === 'win' && (
              <div className="controls">
                <div className="winrate-compare">
                  <div className="winrate-labels">
                    <span className="wr-black">黑 {blackWinPct != null ? `${blackWinPct}%` : '—'}</span>
                    <span className="wr-white">白 {whiteWinPct != null ? `${whiteWinPct}%` : '—'}</span>
                  </div>
                  <div className="winrate-track">
                    <div className="winrate-fill" style={{ width: `${blackWinPct ?? 50}%` }} />
                  </div>
                </div>
                <div className="v2-scoreline">
                  目数差{' '}
                  <span
                    className={`v2-score ${leadText != null && leadText.startsWith('-') ? 'lead-white' : 'lead-black'}`}
                  >
                    {leadText != null ? `${leadText} 目` : '—'}
                  </span>
                </div>
                <div className="v2-wr-foot">
                  <span>本地双人</span>
                  <span>让子：{handicapOpt === '0' ? '无' : handicapOpt}</span>
                  <span>{moves.length} 手</span>
                </div>
                {analyzing && <p className="hint-sm">AI 分析中…（实时更新）</p>}
              </div>
            )}

            {tab === 'moves' && (
              <div className="controls" style={{ padding: '8px 0' }}>
                <div className="v2-movelist">
                  {moveRows.length === 0 && <div className="v2-empty">尚无落子，点击「新对局」开始</div>}
                  {moveRows.map((row) => (
                    <div
                      key={row.no}
                      className={`v2-move-row ${row.no === moves.length || (row.no === moves.length - 1 && moves.length % 2 === 0) ? 'current' : ''}`}
                    >
                      <span className="v2-move-no">{row.no}</span>
                      <span className="v2-move-b">{row.black}</span>
                      <span className="v2-move-w">{row.white}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === 'cand' && (
              <div className="controls">
                {hintOn && showCandidates && showCandidates.length > 0 ? (
                  <table className="recommend-table v2-cand-table">
                    <thead>
                      <tr>
                        <th>落点</th>
                        <th title="AI 选点概率（policy），搜索收敛后与胜率排序一致">推荐度</th>
                        <th title="落子后黑方目差（正=黑领先）">目差</th>
                        <th>胜率</th>
                      </tr>
                    </thead>
                    <tbody>
                      {showCandidates.slice(0, 5).map((c, i) => (
                        <tr
                          key={i}
                          className={c.pv.length > 0 ? 'clickable' : ''}
                          onClick={() => c.pv.length > 0 && setHighlightPv(c.pv)}
                        >
                          <td>
                            {i + 1}. {c.move ? coordLabel(c.move[0], c.move[1], boardSize) : 'pass'}
                          </td>
                          <td>{c.prior != null ? `${Math.round(c.prior * 100)}%` : '—'}</td>
                          <td className={c.scoreLead != null && c.scoreLead >= 0 ? 'lead-pos' : 'lead-neg'}>
                            {c.scoreLead != null ? `${c.scoreLead >= 0 ? '+' : ''}${c.scoreLead.toFixed(1)}` : '—'}
                          </td>
                          <td>{c.winrate != null ? `${(c.winrate * 100).toFixed(1)}%` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="v2-empty">
                    {!started
                      ? '开始对局后可用'
                      : '点击工具栏「支招」查看 AI 推荐选点'}
                  </div>
                )}
                <p className="hint-sm">点击候选行可查看变化图</p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
