/**
 * AI 解说选项卡：局面分析 + 胜率对比 + AI 解说（流式显示、变化图高亮、解说历史）。
 */
import { useState } from 'react'
import ReactMarkdown from 'react-markdown'

import { useGameStore } from '../stores/gameStore'
import { useAnalysisStore } from '../stores/analysisStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useCommentaryStore } from '../stores/commentaryStore'
import { vertexToCoord } from '../lib/boardUtils'
import { buildCornerSummary } from '../lib/goInsight'
import { buildJosekiSummary } from '../lib/joseki'
import type { Vertex } from '../lib/types'

/** 解说请求中传给 LLM 的候选选点格式 */
interface CommentaryCandidateDto {
  move: string | null
  winrate: number | null
  scoreLead: number | null
  visits: number | null
  pv: string[]
}

type Level = 'beginner' | 'intermediate' | 'advanced'

interface Props {
  onHighlight: (vertices: Vertex[] | null) => void
  /** 领地显示开关状态（由对弈页持有，切换选项卡不丢失） */
  showOwnershipEnabled?: boolean
  /** 领地开关点击（无当前局面分析时由对弈页自动触发分析） */
  onToggleTerritory?: () => void
}

export default function CommentaryPanel({ onHighlight, showOwnershipEnabled, onToggleTerritory }: Props) {
  const engineSource = useSettingsStore((s) => s.engineSource)
  const { moves, board, boardSize, currentPlayer, komi, maxVisits, status } =
    useGameStore()
  const {
    candidates,
    rootWinrate,
    rootScoreLead,
    analyzing,
    error: analysisError,
    analyzedMoveCount,
    analyze,
    stopAnalysis,
    clear,
  } = useAnalysisStore()
  const { text, streaming, error, history, request } = useCommentaryStore()
  const [level, setLevel] = useState<Level>('beginner')

  const last = moves[moves.length - 1]
  const canRequest = moves.length > 0 && !streaming

  // 分析结果（黑白胜率对比）
  const analysisStale =
    analyzedMoveCount >= 0 && analyzedMoveCount !== moves.length
  // rootWinrate 为「当前玩家视角」，换算为黑白双方
  const blackWinrate =
    rootWinrate != null
      ? currentPlayer === 1
        ? rootWinrate
        : 1 - rootWinrate
      : null
  const whiteWinrate = blackWinrate != null ? 1 - blackWinrate : null
  // KataGo 的 scoreLead 为「当前行棋方」视角（正 = 当前方领先）
  const scoreLeader =
    rootScoreLead != null && rootScoreLead !== 0
      ? rootScoreLead > 0
        ? currentPlayer === 1
          ? '黑'
          : '白'
        : currentPlayer === 1
          ? '白'
          : '黑'
      : null

  const handleAnalyze = () => {
    clear()
    const engineMoves: { color: string; vertex: [number, number] | null }[] =
      moves.map((m) => ({
        color: m.color === 1 ? 'B' : 'W',
        vertex: m.vertex,
      }))
    void analyze({ moves: engineMoves, boardSize, komi, maxVisits })
  }

  /** 分析/停止：分析中按钮变为「停止分析」，点击即终止 */
  const handleAnalyzeToggle = () => {
    if (analyzing) {
      stopAnalysis()
    } else {
      handleAnalyze()
    }
  }

  /** 生成 ASCII 棋盘图（X=黑 O=白 .=空，数字=候选点），让 LLM 直接"看到"真实布局 */
  const getBoardState = (cands: { move: [number, number] | null }[]): string => {
    const { signMap } = board
    const cols = 'ABCDEFGHJKLMNOPQRST' // 19 列，跳过 I
    // 候选点标注：用 1~n 替换该点的棋子标记
    const mark = new Map<string, number>()
    cands.forEach((c, i) => {
      if (c.move) {
        const [x, y] = c.move
        if (signMap[y]?.[x] !== undefined) mark.set(`${x},${y}`, i + 1)
      }
    })
    const lines: string[] = []
    lines.push(`  ${cols.split('').join(' ')}`)
    for (let y = 0; y < signMap.length; y++) {
      const rowLabel = String(boardSize - y).padStart(2)
      let row = `${rowLabel} `
      for (let x = 0; x < signMap[y].length; x++) {
        const m = mark.get(`${x},${y}`)
        const sign = signMap[y][x]
        row += m ?? (sign === 1 ? 'X' : sign === -1 ? 'O' : '.')
        if (x < signMap[y].length - 1) row += ' '
      }
      lines.push(row)
    }
    return lines.join('\n')
  }

  /**
   * 以本手落点为中心的局部棋盘图（半径 4，约 9x9）。
   * @ = 本手落点，# = 棋盘外。让 LLM 描述攻防关系时只看局部，避免脑补远处棋子。
   */
  const getLocalBoardState = (center: [number, number]): string => {
    const { signMap } = board
    const cols = 'ABCDEFGHJKLMNOPQRST'
    const [cx, cy] = center
    const r = 4
    const lines: string[] = []
    const x0 = Math.max(0, cx - r)
    const x1 = Math.min(boardSize - 1, cx + r)
    const y0 = Math.max(0, cy - r)
    const y1 = Math.min(boardSize - 1, cy + r)
    // 列标签（局部）
    let colLabel = '  '
    for (let x = x0; x <= x1; x++) {
      colLabel += `${cols[x]} `
    }
    lines.push(colLabel)
    for (let y = y0; y <= y1; y++) {
      let row = `${String(boardSize - y).padStart(2)} `
      for (let x = x0; x <= x1; x++) {
        if (x === cx && y === cy) {
          row += '@'
        } else {
          const sign = signMap[y][x]
          row += sign === 1 ? 'X' : sign === -1 ? 'O' : '.'
        }
        row += ' '
      }
      lines.push(row)
    }
    return lines.join('\n')
  }

  /**
   * 生成棋盘区域势力概览：按 3x3 分区统计黑白子数。
   * 让 LLM 解说全局"势"时依据程序算好的分区数据，而非自行读全盘图（易出错）。
   */
  const getRegionSummary = (): string => {
    const { signMap } = board
    const n = boardSize
    const third = Math.floor(n / 3)
    const regions = [
      ['左上', 0, 0],
      ['上边', third, 0],
      ['右上', 2 * third, 0],
      ['左边', 0, third],
      ['中央', third, third],
      ['右边', 2 * third, third],
      ['左下', 0, 2 * third],
      ['下边', third, 2 * third],
      ['右下', 2 * third, 2 * third],
    ] as const
    const parts: string[] = []
    for (const [name, rx, ry] of regions) {
      let black = 0
      let white = 0
      for (let y = ry; y < Math.min(ry + third, n); y++) {
        for (let x = rx; x < Math.min(rx + third, n); x++) {
          const s = signMap[y]?.[x]
          if (s === 1) black++
          else if (s === -1) white++
        }
      }
      parts.push(`${name} 黑${black} 白${white}`)
    }
    return parts.join('；')
  }

  /**
   * 生成四角定型概览：程序判定每个角是否"定式/已定型"、是否有弱棋。
   * 让 LLM 在谈到角部时引用程序化结论，而不是自行推断。
   */
  const getCornerSummary = (): string => buildCornerSummary(board.signMap, boardSize)

  /** 生成全盘定式识别概览：程序把各角着法与定式库比对（权威依据） */
  const getJosekiSummary = (): string =>
    buildJosekiSummary(
      moves.map((m) => ({ color: m.color, vertex: m.vertex ?? null })),
      boardSize,
    )

  const handleRequest = () => {
    if (!last) return
    const cands: CommentaryCandidateDto[] = (candidates ?? []).slice(0, 5).map((c) => ({
      move: c.move ? vertexToCoord(c.move, boardSize) : null,
      winrate: c.winrate,
      scoreLead: c.scoreLead,
      visits: c.visits,
      pv: c.pv.map((v) => vertexToCoord(v, boardSize)),
    }))

    // 生成着法序列文本，让 LLM 能看到完整局面演变
    const moveHistory = moves
      .map((m) => {
        const color = m.color === 1 ? 'B' : 'W'
        const coord = m.pass ? 'pass' : m.vertex ? vertexToCoord(m.vertex, boardSize) : '?'
        return `${m.n}.${color} ${coord}`
      })
      .join(' ')

    void request({
      move_number: moves.length,
      player: last.color === 1 ? 'black' : 'white',
      move: last.pass ? 'pass' : last.vertex ? vertexToCoord(last.vertex, boardSize) : null,
      board_size: boardSize,
      level,
      candidates: cands,
      root_winrate: rootWinrate,
      root_score_lead: rootScoreLead,
      move_history: moveHistory,
      board_state: getBoardState(candidates ?? []),
      local_board_state: last.vertex
        ? getLocalBoardState(last.vertex)
        : null,
      region_summary: getRegionSummary(),
      corner_summary: getCornerSummary(),
      joseki_summary: getJosekiSummary(),
    })
  }

  return (
    <div className="commentary-panel">
      <div className="commentary-header">
        <h3>AI 解说</h3>
        <select
          className="select level-select"
          value={level}
          onChange={(e) => setLevel(e.target.value as Level)}
        >
          <option value="beginner">入门</option>
          <option value="intermediate">进阶</option>
          <option value="advanced">高段</option>
        </select>
      </div>

      {/* 分析与解说操作 */}
      {engineSource === 'browser' && (
        <p className="hint-sm" style={{ marginTop: 8 }}>
          当前为轻量引擎（WASM b6c96），分析/解说仅供参考；完整棋力请连接本地引擎（设置页「远程连接」指引）。
        </p>
      )}
      <div className="commentary-actions">
        <button
          className="btn"
          onClick={handleAnalyzeToggle}
          disabled={status === 'idle'}
        >
          {analyzing ? '停止分析' : '分析局面'}
        </button>
        {onToggleTerritory && (
          <button
            className={`btn${showOwnershipEnabled ? ' active' : ''}`}
            onClick={onToggleTerritory}
            disabled={status === 'idle'}
            title="显示/隐藏 AI 地盘预测（无分析结果时自动触发分析）"
          >
            领地
          </button>
        )}
        <button
          className="btn primary"
          onClick={handleRequest}
          disabled={!canRequest}
        >
          {streaming ? '解说中…' : '请求解说'}
        </button>
      </div>

      {analysisError && <p className="error">⚠ {analysisError}</p>}
      {error && <p className="error">⚠ {error}</p>}

      {/* 分析结果：黑白胜率对比 */}
      {blackWinrate != null && (
        <div className="winrate-compare">
          <div className="winrate-labels">
            <span className="wr-black">
              黑 {(blackWinrate * 100).toFixed(1)}%
            </span>
            <span className="wr-score">
              {scoreLeader && rootScoreLead != null && (
                <>
                  目差 {scoreLeader} +{Math.abs(rootScoreLead).toFixed(1)}
                </>
              )}
            </span>
            <span className="wr-white">
              白 {(whiteWinrate! * 100).toFixed(1)}%
            </span>
          </div>
          <div className="winrate-track">
            <div
              className="winrate-fill black"
              style={{ width: `${(blackWinrate * 100).toFixed(1)}%` }}
            />
          </div>
          {analysisStale && (
            <p className="hint" style={{ marginTop: 4 }}>
              局面已变化，请重新分析
            </p>
          )}
        </div>
      )}

      {/* 推荐落子（星阵式：推荐度 = 相对最佳着法的胜率比 / 目差 = 该点落子后领先 / 胜率分黑白）
          随分析中间快照实时更新，点击行在棋盘高亮变化图 */}
      {candidates && candidates.length > 0 && (
        <div className="recommend-list">
          <div className="recommend-title">
            <span className="info-label">推荐落子{analyzing ? '（搜索中）' : ''}</span>
            {analyzing && candidates[0]?.visits != null && (
              <span className="hint">已分析 {candidates[0].visits} visits</span>
            )}
          </div>
          <table className="recommend-table">
            <thead>
              <tr>
                <th>落点</th>
                <th title="相对最佳着法的胜率比（榜首 100%）">推荐度</th>
                <th>目差</th>
                <th>胜率</th>
              </tr>
            </thead>
            <tbody>
              {candidates.slice(0, 5).map((c, i) => {
                // 候选点 winrate/scoreLead 为「当前玩家视角」，换算为黑白双方
                const blackWr =
                  c.winrate != null
                    ? currentPlayer === 1
                      ? c.winrate
                      : 1 - c.winrate
                    : null
                const whiteWr = blackWr != null ? 1 - blackWr : null
                const lead = c.scoreLead
                // 推荐度 = 相对榜首胜率比：与胜率排序严格一致（policy 是先验棋感，
                // 与搜索后验胜率可能不同序，不宜直接作推荐度）
                const topWinrate = candidates[0]?.winrate ?? null
                const rec =
                  c.winrate != null && topWinrate != null && topWinrate > 0
                    ? Math.round((c.winrate / topWinrate) * 100)
                    : null
                return (
                  <tr
                    key={i}
                    className={c.pv.length > 0 ? 'clickable' : ''}
                    onClick={() => c.pv.length > 0 && onHighlight(c.pv)}
                  >
                    <td>
                      {i + 1}. {c.move ? vertexToCoord(c.move, boardSize) : 'pass'}
                    </td>
                    <td>{rec != null ? `${rec}%` : '—'}</td>
                    <td className={lead != null ? (lead >= 0 ? 'lead-pos' : 'lead-neg') : ''}>
                      {lead != null ? `${lead >= 0 ? '+' : ''}${lead.toFixed(1)}` : '—'}
                    </td>
                    <td>
                      {blackWr != null
                        ? `黑 ${(blackWr * 100).toFixed(1)}% / 白 ${(whiteWr! * 100).toFixed(1)}%`
                        : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {!candidates && (
        <p className="hint">提示：先点「分析局面」可获得更精准的解说</p>
      )}

      {/* 增量搜索中：展示当前中间快照已分析的 visits（candidates 已按 visits 降序） */}
      {analyzing && candidates && candidates.length > 0 && (
        <p className="hint" style={{ marginTop: 4 }}>
          搜索中…（已分析 {candidates[0].visits ?? 0} visits）
        </p>
      )}

      {text && (
        <div className="commentary-text">
          <ReactMarkdown>{text}</ReactMarkdown>
          {streaming && <span className="cursor">▍</span>}
        </div>
      )}

      {candidates && candidates.some((c) => c.pv.length > 0) && (
        <div className="variations">
          <span className="info-label">变化图（点击在棋盘高亮）：</span>
          <div className="variation-btns">
            {candidates.slice(0, 3).map((c, i) =>
              c.pv.length > 0 ? (
                <button
                  key={i}
                  className="btn variation-btn"
                  onClick={() => onHighlight(c.pv)}
                >
                  {c.move ? vertexToCoord(c.move, boardSize) : 'pass'} 起
                </button>
              ) : null,
            )}
            <button className="btn" onClick={() => onHighlight(null)}>
              清除
            </button>
          </div>
        </div>
      )}

      {history.length > 0 && (
        <details className="commentary-history">
          <summary>解说历史（{history.length}）</summary>
          {history.map((h, i) => (
            <div key={i} className="history-item">
              <strong>第 {h.moveNumber} 手</strong>
              <ReactMarkdown>{h.text}</ReactMarkdown>
            </div>
          ))}
        </details>
      )}
    </div>
  )
}
