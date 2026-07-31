/**
 * 对弈页：棋盘 + 控制面板 + 解说面板。
 * 支持本地双人与人机对弈（KataGo）、局面分析、AI 解说与变化图高亮。
 */
import { useEffect, useState } from 'react'

import GoBoardCanvas from '../components/GoBoardCanvas'
import GameControls from '../components/GameControls'
import CommentaryPanel from '../components/CommentaryPanel'
import { useGameStore } from '../stores/gameStore'
import { useAnalysisStore } from '../stores/analysisStore'
import type { Vertex } from '../lib/types'

export default function PlayPage() {
  const { board, boardSize, currentPlayer, lastMove, status, moves, playMove } =
    useGameStore()
  const { candidates, analyzedMoveCount, clear } = useAnalysisStore()
  const [highlightPv, setHighlightPv] = useState<Vertex[] | null>(null)

  // 局面变化（落子/悔棋）后清除过期的分析结果与高亮
  useEffect(() => {
    clear()
    setHighlightPv(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moves.length])

  const showCandidates = analyzedMoveCount === moves.length ? candidates : null

  return (
    <div className="play-page">
      <div className="board-area">
        <GoBoardCanvas
          board={board}
          boardSize={boardSize}
          currentPlayer={currentPlayer}
          lastMove={lastMove}
          interactive={status === 'playing'}
          candidates={showCandidates}
          highlights={highlightPv}
          onPlay={(v) => playMove(v)}
        />
      </div>
      <div className="side-panels">
        <GameControls />
        <CommentaryPanel onHighlight={setHighlightPv} />
      </div>
    </div>
  )
}
