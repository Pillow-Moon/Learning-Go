/**
 * AI 解说面板：请求解说、流式显示、变化图高亮、解说历史。
 */
import { useState } from 'react'

import { useGameStore } from '../stores/gameStore'
import { useAnalysisStore } from '../stores/analysisStore'
import { useCommentaryStore } from '../stores/commentaryStore'
import { vertexToCoord } from '../lib/boardUtils'
import type { Vertex } from '../lib/types'
import type { CommentaryCandidateDto } from '../services/api'

type Level = 'beginner' | 'intermediate' | 'advanced'

interface Props {
  onHighlight: (vertices: Vertex[] | null) => void
}

export default function CommentaryPanel({ onHighlight }: Props) {
  const { moves, boardSize } = useGameStore()
  const { candidates, rootWinrate, rootScoreLead } = useAnalysisStore()
  const { text, streaming, error, history, request } = useCommentaryStore()
  const [level, setLevel] = useState<Level>('beginner')

  const last = moves[moves.length - 1]
  const canRequest = moves.length > 0 && !streaming

  const handleRequest = () => {
    if (!last) return
    const cands: CommentaryCandidateDto[] = (candidates ?? []).slice(0, 5).map((c) => ({
      move: c.move ? vertexToCoord(c.move, boardSize) : null,
      winrate: c.winrate,
      score_lead: c.score_lead,
      visits: c.visits,
      pv: c.pv.map((v) => vertexToCoord(v, boardSize)),
    }))
    void request({
      move_number: moves.length,
      player: last.color === 1 ? 'black' : 'white',
      move: last.pass ? 'pass' : last.vertex ? vertexToCoord(last.vertex, boardSize) : null,
      board_size: boardSize,
      level,
      candidates: cands,
      root_winrate: rootWinrate,
      root_score_lead: rootScoreLead,
      recent_summary: null,
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

      <button className="btn primary" onClick={handleRequest} disabled={!canRequest}>
        {streaming ? '解说中…' : '请求解说'}
      </button>

      {!candidates && (
        <p className="hint">提示：先点「分析局面」可获得更精准的解说</p>
      )}
      {error && <p className="error">⚠ {error}</p>}

      {text && (
        <div className="commentary-text">
          {text}
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
              <p>{h.text}</p>
            </div>
          ))}
        </details>
      )}
    </div>
  )
}
