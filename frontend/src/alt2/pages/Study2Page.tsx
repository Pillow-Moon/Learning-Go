/**
 * Study2Page —— 对局研究（已合并复盘能力）
 * 数据源 reviewStore：棋谱载入/导航/摆子/整盘逐手分析/关键点标注/胜率曲线。
 * 当前局面候选点（analysisStore）+ 本地解说。
 * 布局三栏：左栏棋谱来源与研究选项，中央棋盘与导航，右栏选项卡（候选点/胜率曲线/解说）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import ReactMarkdown from 'react-markdown'
import GoBoardCanvas from '../../components/GoBoardCanvas'
import WinrateChart from '../../components/WinrateChart'
import { useReviewStore, buildBoardFromMoves } from '../../stores/reviewStore'
import { useAnalysisStore } from '../../stores/analysisStore'
import { buildEngineMoves } from '../../lib/boardUtils'
import { generateLocalCommentary } from '../../lib/localCommentary'
import { getGameById, listGames, saveGame, type GameRecord } from '../../lib/db'
import { parseSgfGame, sgfResultToText } from '../../lib/sgf'
import type { BoardSize, Move, Player, Vertex } from '../../lib/types'

function coordLabel(x: number, y: number, size: number): string {
  const cols = 'ABCDEFGHJKLMNOPQRST'
  return cols[x] + String(size - y)
}

export default function Study2Page() {
  const [searchParams] = useSearchParams()
  const review = useReviewStore(
    useShallow((s) => ({
      boardSize: s.boardSize,
      komi: s.komi,
      moves: s.moves,
      moveIndex: s.moveIndex,
      points: s.points,
      analysisStatus: s.analysisStatus,
      analyzedCount: s.analyzedCount,
      result: s.result,
      name: s.name,
      handicapStones: s.handicapStones,
      loadGame: s.loadGame,
      gotoMove: s.gotoMove,
      stepMove: s.stepMove,
      appendMove: s.appendMove,
      analyzeAll: s.analyzeAll,
      stopAnalysis: s.stopAnalysis,
    })),
  )
  const {
    candidates,
    rootWinrate,
    rootScoreLead,
    ownership,
    analyzing,
    analyzedMoveCount,
    analyze,
    clear,
    stopAnalysis,
  } = useAnalysisStore()

  // 界面状态
  const [tab, setTab] = useState<'cand' | 'chart' | 'comment'>('cand')
  const [candCount, setCandCount] = useState(5)
  const [varLen, setVarLen] = useState(12)
  const [selectedCand, setSelectedCand] = useState(0)
  const [highlightPv, setHighlightPv] = useState<Vertex[] | null>(null)
  const [history, setHistory] = useState<GameRecord[]>([])
  const [importError, setImportError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [komiOpt, setKomiOpt] = useState(7.5)
  const [territoryOn, setTerritoryOn] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const { boardSize, komi, moves, moveIndex, points, analysisStatus, analyzedCount } = review
  const total = moves.length

  // 历史棋谱加载
  useEffect(() => {
    listGames()
      .then(setHistory)
      .catch(() => setHistory([]))
  }, [])

  // 从诊断页跳转：?game=<id>&move=<手数> —— 加载指定对局并跳到问题手
  useEffect(() => {
    const gameParam = searchParams.get('game')
    if (!gameParam) return
    const gameId = Number(gameParam)
    if (!Number.isFinite(gameId)) return
    const targetMove = Number(searchParams.get('move'))
    void (async () => {
      const rec = await getGameById(gameId)
      if (!rec) return
      review.loadGame({
        boardSize: rec.boardSize as BoardSize,
        komi: rec.komi,
        moves: rec.moves.map((m) => ({
          n: m.n,
          color: m.color as Player,
          vertex: m.vertex,
          pass: m.pass,
        })),
        result: rec.result,
        name: `诊断跳转 · ${new Date(rec.createdAt).toLocaleString('zh-CN', { hour12: false })}`,
      })
      if (Number.isFinite(targetMove)) {
        review.gotoMove(Math.max(0, Math.min(rec.moves.length, targetMove)))
      }
      flash('已从诊断跳转至该手')
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // 手数/棋谱变化：取消进行中的当前局面分析并清空（避免旧分析结果回填到新局面）
  useEffect(() => {
    stopAnalysis()
    clear()
    setHighlightPv(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveIndex, moves])

  // 当前局面分析（候选点）
  useEffect(() => {
    if (moves.length === 0) return
    const t = window.setTimeout(() => {
      void analyze({
        moves: buildEngineMoves(moves.slice(0, moveIndex), review.handicapStones),
        boardSize,
        komi,
        maxVisits: 50,
      })
    }, 150)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveIndex])

  const flash = (text: string) => {
    setMsg(text)
    window.setTimeout(() => setMsg(null), 2600)
  }

  /** 载入棋谱（历史 / SGF / 空盘） */
  const loadGame = (
    newMoves: Move[],
    size: BoardSize,
    komiVal: number,
    name?: string | null,
    result?: string | null,
  ) => {
    review.loadGame({
      boardSize: size,
      komi: komiVal,
      moves: newMoves,
      name: name ?? null,
      result: result ?? null,
    })
    flash('已载入棋谱')
  }

  const loadRecord = (rec: GameRecord) => {
    loadGame(
      rec.moves.map((m) => ({
        n: m.n,
        color: m.color as Player,
        vertex: m.vertex,
        pass: m.pass,
      })),
      rec.boardSize as BoardSize,
      rec.komi,
      `历史对局 · ${new Date(rec.createdAt).toLocaleString('zh-CN', { hour12: false })}`,
      rec.result,
    )
  }

  const importSgf = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const raw = String(reader.result ?? '')
      const game = parseSgfGame(raw)
      if (!game) {
        setImportError('SGF 解析失败：文件格式不支持（仅支持 9/13/19 路棋谱）')
        return
      }
      setImportError(null)
      review.loadGame({
        boardSize: game.boardSize,
        komi: game.komi,
        handicap: game.handicap,
        handicapStones: game.handicapStones,
        moves: game.moves,
        result: sgfResultToText(game.result) ?? game.result,
        name: game.gameName ?? file.name.replace(/\.(sgf|txt)$/i, ''),
      })
      flash('SGF 导入成功')
      // 同时保存到历史棋谱库（供「诊断」页批量分析使用）
      saveGame({
        boardSize: game.boardSize,
        komi: game.komi,
        mode: 'import',
        result: sgfResultToText(game.result) ?? game.result ?? '',
        sgf: raw,
        createdAt: '',
        moves: game.moves.map((m) => ({
          n: m.n,
          color: m.color,
          vertex: m.vertex,
          pass: m.pass,
        })),
      })
        .then(() => listGames().then(setHistory))
        .catch(() => {
          /* 保存失败不影响本次复盘 */
        })
    }
    reader.onerror = () => setImportError('文件读取失败')
    reader.readAsText(file)
  }

  /** 整盘逐手分析（复盘能力）：运行中停止，已分析则继续/重跑 */
  const handleAnalyzeAll = () => {
    if (analysisStatus === 'running') {
      review.stopAnalysis()
    } else if (analysisStatus === 'done' && analyzedCount > 0 && analyzedCount <= moves.length) {
      void review.analyzeAll(false)
    } else {
      void review.analyzeAll(true)
    }
  }

  // 当前显示局面
  const board = useMemo(
    () => buildBoardFromMoves(boardSize, moves.slice(0, moveIndex), review.handicapStones),
    [boardSize, moves, moveIndex, review.handicapStones],
  )
  const currentMove: Move | null = moveIndex > 0 ? moves[moveIndex - 1] : null
  const curPlayer: Player = moveIndex % 2 === 0 ? 1 : -1
  const lastVertex: Vertex | null =
    currentMove && !currentMove.pass ? currentMove.vertex : null

  // 候选点（过期保护：仅当分析对应当前手数或分析中才显示）
  const showCandidates =
    analyzedMoveCount === moveIndex || analyzing ? candidates : null

  // 变化图高亮（点击候选行时优先）
  const selectedPv = useMemo(
    () =>
      candidates && candidates[selectedCand] && candidates[selectedCand].pv.length > 0
        ? candidates[selectedCand].pv.slice(0, varLen)
        : [],
    [candidates, selectedCand, varLen],
  )
  const showHighlights =
    highlightPv && highlightPv.length > 0
      ? highlightPv.slice(0, varLen)
      : selectedPv.length > 0
        ? selectedPv
        : null

  // 关键点列表（整盘分析结果，倒序显示）
  const issues = useMemo(
    () =>
      points
        .map((p, i) => ({ p, i }))
        .filter(({ p }) => p && p.verdict)
        .sort((a, b) => b.i - a.i),
    [points],
  )
  const fullyAnalyzed = points.length > 0 && points.every((p) => p != null)

  // 本地解说（当前局面）
  const commentary = useMemo(() => {
    if (!candidates || moves.length === 0) return null
    return generateLocalCommentary({
      boardSize,
      currentPlayer: curPlayer,
      rootWinrate: rootWinrate ?? null,
      rootScoreLead: rootScoreLead ?? null,
      candidates,
      regionSummary: '',
      cornerSummary: '',
      josekiSummary: '',
      moveCount: moveIndex,
    })
  }, [candidates, rootWinrate, rootScoreLead, boardSize, moveIndex, moves.length, curPlayer])

  const blackWinPct =
    rootWinrate != null ? Math.round(rootWinrate * 1000) / 10 : null
  const leadText = (lead: number | null) =>
    lead != null ? `${lead >= 0 ? '+' : ''}${lead.toFixed(1)} 目` : '—'

  return (
    <div className="v2-page">
      <div className="v2-layout study">
        {/* ===== 左栏：棋谱来源 + 研究选项 ===== */}
        <aside className="v2-col v2-left">
          <div className="v2-panel">
            <div className="v2-panel-head">
              棋谱
              <span className="hint-sm">{review.name ?? '未载入棋谱'}</span>
            </div>
            <div className="v2-actions" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <button
                className="btn sm"
                onClick={() => loadGame([], 19, komiOpt, '空盘新局')}
              >
                新局
              </button>
              <button
                className="btn sm"
                onClick={() => fileRef.current?.click()}
                style={{ textAlign: 'center', cursor: 'pointer' }}
              >
                导入 SGF
                <input
                  ref={fileRef}
                  type="file"
                  accept=".sgf,application/x-go-sgf"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) importSgf(f)
                    e.target.value = ''
                  }}
                />
              </button>
            </div>
            {importError && <p className="error" style={{ padding: '0 16px 10px' }}>{importError}</p>}
            <div className="v2-opt-row">
              <span className="v2-opt-label">棋盘</span>
              <span className="v2-opt-value">{boardSize} 路</span>
            </div>
            <div className="v2-opt-row">
              <span className="v2-opt-label">贴目</span>
              <select
                className="select"
                value={komi}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setKomiOpt(v)
                  // 重载当前棋谱以应用新贴目（分析/曲线使用）
                  review.loadGame({
                    boardSize,
                    komi: v,
                    moves,
                    name: review.name,
                    result: review.result,
                  })
                }}
              >
                <option value={6.5}>6.5 目</option>
                <option value={7.5}>7.5 目</option>
                <option value={8.5}>8.5 目</option>
              </select>
            </div>
            <div className="v2-opt-row">
              <span className="v2-opt-label">推荐点数</span>
              <select
                className="select"
                value={candCount}
                onChange={(e) => setCandCount(Number(e.target.value))}
              >
                {[3, 5, 8].map((n) => (
                  <option key={n} value={n}>
                    {n} 个
                  </option>
                ))}
              </select>
            </div>
            <div className="v2-opt-row">
              <span className="v2-opt-label">变化图长度</span>
              <select
                className="select"
                value={varLen}
                onChange={(e) => setVarLen(Number(e.target.value))}
              >
                {[8, 12, 16].map((n) => (
                  <option key={n} value={n}>
                    {n} 手
                  </option>
                ))}
              </select>
            </div>
            <div className="v2-opt-row">
              <label className="v2-opt-check">
                <input
                  type="checkbox"
                  checked={territoryOn}
                  onChange={(e) => setTerritoryOn(e.target.checked)}
                />
                显示领地（实地预测）
              </label>
            </div>
            {/* 整盘分析（复盘能力） */}
            <div className="v2-actions" style={{ gridTemplateColumns: '1fr' }}>
              <button
                className={`btn ${analysisStatus === 'running' ? 'danger' : 'primary'}`}
                onClick={handleAnalyzeAll}
                disabled={moves.length === 0}
              >
                {analysisStatus === 'running'
                  ? `停止分析（${analyzedCount}/${moves.length + 1}）`
                  : fullyAnalyzed
                    ? '重新分析整盘'
                    : analyzedCount > 0
                      ? '继续分析整盘'
                      : '分析整盘'}
              </button>
            </div>
          </div>

          <div className="v2-panel">
            <div className="v2-panel-head">历史棋谱</div>
            <div className="v2-tree">
              {history.length === 0 && <div className="v2-empty">暂无历史对局</div>}
              {history.map((rec) => (
                <div key={rec.id} className="v2-tree-row" onClick={() => loadRecord(rec)}>
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

        {/* ===== 中央：棋盘 + 导航 ===== */}
        <div className="v2-col v2-board-col">
          <div className="v2-board-wrap">
            <GoBoardCanvas
              board={board}
              boardSize={boardSize}
              currentPlayer={curPlayer}
              lastMove={lastVertex}
              interactive={moveIndex === total}
              candidates={tab === 'cand' ? showCandidates : null}
              ownership={territoryOn ? ownership : null}
              highlights={showHighlights}
              highlightFirstColor={curPlayer}
              onPlay={(v) => {
                if (review.appendMove(v)) flash('已摆子')
              }}
            />
            {msg && <div className="v2-board-msg">{msg}</div>}
          </div>

          <div className="v2-panel">
            <div className="v2-panel-body" style={{ padding: 12 }}>
              <div className="review-nav-buttons">
                <button className="btn" disabled={moveIndex <= 0} onClick={() => review.gotoMove(0)}>
                  ⏮ 首
                </button>
                <button className="btn" disabled={moveIndex <= 0} onClick={() => review.stepMove(-1)}>
                  ◀ 退
                </button>
                <button className="btn" disabled={moveIndex >= total} onClick={() => review.stepMove(1)}>
                  进 ▶
                </button>
                <button className="btn" disabled={moveIndex >= total} onClick={() => review.gotoMove(total)}>
                  尾 ⏭
                </button>
              </div>
            </div>
          </div>

          <div className="v2-statusbar">
            <span className="v2-stat">
              当前手 <b>{moveIndex}</b> / {total}
            </span>
            <span className="v2-stat">
              落子{' '}
              <b>
                {currentMove
                  ? currentMove.pass
                    ? '虚手'
                    : `${currentMove.color === 1 ? '黑' : '白'} ${coordLabel(currentMove.vertex![0], currentMove.vertex![1], boardSize)}`
                  : '—'}
              </b>
            </span>
            <span className="v2-stat">
              黑胜率 <b>{blackWinPct != null ? `${blackWinPct}%` : '—'}</b>
            </span>
            <span className="v2-stat">
              目差 <b>{leadText(rootScoreLead)}</b>
            </span>
            {analyzing && <span className="v2-stat"><b style={{ color: 'var(--primary-dark)' }}>分析中…</b></span>}
          </div>
        </div>

        {/* ===== 右栏：选项卡 ===== */}
        <aside className="v2-col v2-right">
          <div className="side-tabs">
            <div className="side-tabbar">
              <button className={`side-tab ${tab === 'cand' ? 'active' : ''}`} onClick={() => setTab('cand')}>
                候选点
              </button>
              <button className={`side-tab ${tab === 'chart' ? 'active' : ''}`} onClick={() => setTab('chart')}>
                胜率曲线
              </button>
              <button className={`side-tab ${tab === 'comment' ? 'active' : ''}`} onClick={() => setTab('comment')}>
                解说
              </button>
            </div>

            {tab === 'cand' && (
              <div className="controls">
                {showCandidates && showCandidates.length > 0 ? (
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
                      {showCandidates.slice(0, candCount).map((c, i) => (
                        <tr
                          key={i}
                          className={`clickable ${selectedCand === i && highlightPv == null ? 'active' : ''}`}
                          onClick={() => {
                            setSelectedCand(i)
                            setHighlightPv(null)
                            if (c.pv.length > 0) flash('变化图：已显示 AI 构想')
                          }}
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
                    {moves.length === 0
                      ? '载入棋谱或落子后开始分析'
                      : analyzing
                        ? 'AI 分析中…'
                        : '暂无候选点'}
                  </div>
                )}
                <p className="hint-sm">点击候选行查看变化图；棋盘显示到最后一手时可继续摆子</p>
              </div>
            )}

            {tab === 'chart' && (
              <div className="controls">
                <WinrateChart
                  points={points}
                  moveIndex={moveIndex}
                  onSelect={(pos) => review.gotoMove(pos)}
                />
                {/* 关键点列表（复盘能力） */}
                {issues.length > 0 && (
                  <div className="review-issues">
                    <div className="info-label">关键点（{issues.length}）</div>
                    <div className="issue-list">
                      {issues.map(({ p, i }) => (
                        <div
                          key={i}
                          className={`issue-item ${i === moveIndex ? 'active' : ''}`}
                          onClick={() => review.gotoMove(i)}
                        >
                          <span className={`issue-label verdict-${p!.verdict}`}>
                            {p!.verdict === 'bad' ? '恶手' : p!.verdict === 'doubt' ? '疑问手' : '好手'}
                          </span>
                          <span className="issue-move">
                            第 {i} 手 · {p!.topMove ? coordLabel(p!.topMove[0], p!.topMove[1], boardSize) : ''}
                          </span>
                          <span className="issue-loss">
                            {p!.loss != null
                              ? `${p!.loss >= 0 ? '-' : '+'}${(Math.abs(p!.loss) * 100).toFixed(1)}%`
                              : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {issues.length === 0 && moves.length > 0 && (
                  <p className="hint-sm">
                    点击「分析整盘」逐手分析：胜率损失 ≥8% 标恶手、≥3% 标疑问手、≤1% 标好手
                  </p>
                )}
              </div>
            )}

            {tab === 'comment' && (
              <div className="controls">
                {commentary ? (
                  <div className="v2-comment">
                    <div className="v2-comment-title">AI 解说 · 第 {Math.max(1, moveIndex)} 手</div>
                    <div className="v2-comment-text">
                      <ReactMarkdown>{commentary}</ReactMarkdown>
                    </div>
                  </div>
                ) : (
                  <div className="v2-empty">分析当前局面后生成解说</div>
                )}
                <p className="hint-sm">
                  手数 {Math.max(1, moveIndex)} · 黑胜率 {blackWinPct != null ? `${blackWinPct}%` : '—'} ·
                  目数差 {leadText(rootScoreLead)}
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
