/**
 * 对弈页：左侧棋盘 + 右侧选项卡面板（对局 / AI 解说）。
 * 对局开始后自动切到 AI 解说，「对局」tab 收缩为紧凑状态条。
 */
import { useEffect, useState } from 'react'

import GoBoardCanvas from '../components/GoBoardCanvas'
import GameControls from '../components/GameControls'
import CommentaryPanel from '../components/CommentaryPanel'
import { useGameStore } from '../stores/gameStore'
import { useAnalysisStore } from '../stores/analysisStore'
import type { Vertex } from '../lib/types'

type SideTab = 'game' | 'commentary'

export default function PlayPage() {
  const { board, boardSize, currentPlayer, lastMove, status, moves, playMove, komi, maxVisits } =
    useGameStore()
  const { candidates, ownership, analyzedMoveCount, analyze, clear } = useAnalysisStore()
  const [highlightPv, setHighlightPv] = useState<Vertex[] | null>(null)
  const [activeTab, setActiveTab] = useState<SideTab>('game')
  // 领地显示开关（仿星阵：按一下显示地盘渐变、再按关闭；默认关闭）
  const [showOwnershipEnabled, setShowOwnershipEnabled] = useState(false)

  // 局面变化（落子/悔棋）后清除过期的分析结果与高亮
  useEffect(() => {
    clear()
    setHighlightPv(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moves.length])

  // 对局开始后，「对局设置」收缩为侧边栏并自动切到 AI 解说；对局结束切回「对局」tab
  useEffect(() => {
    if (status === 'playing' || status === 'waiting_ai') {
      setActiveTab('commentary')
    } else if (status === 'finished') {
      setActiveTab('game')
    }
  }, [status])

  const showCandidates = analyzedMoveCount === moves.length ? candidates : null
  const showOwnership = showOwnershipEnabled ? ownership : null

  /** 领地开关：当前局面无分析结果时先触发分析（获取地盘预测），完成后自动显示 */
  const handleTerritoryToggle = () => {
    if (status === 'idle') return
    if (analyzedMoveCount !== moves.length) {
      setShowOwnershipEnabled(true)
      clear()
      const engineMoves = moves.map((m) => ({
        color: m.color === 1 ? 'B' : 'W',
        vertex: m.vertex,
      }))
      void analyze({ moves: engineMoves, boardSize, komi, maxVisits })
    } else {
      setShowOwnershipEnabled((v) => !v)
    }
  }

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
          ownership={showOwnership}
          highlights={highlightPv}
          onPlay={(v) => playMove(v)}
        />
      </div>
      <div className="side-panels">
        <div className="side-tabs">
          <div className="side-tabbar" role="tablist">
            <button
              role="tab"
              aria-selected={activeTab === 'game'}
              className={`side-tab${activeTab === 'game' ? ' active' : ''}`}
              onClick={() => setActiveTab('game')}
            >
              对局
            </button>
            <button
              role="tab"
              aria-selected={activeTab === 'commentary'}
              className={`side-tab${activeTab === 'commentary' ? ' active' : ''}`}
              onClick={() => setActiveTab('commentary')}
            >
              AI 解说
            </button>
          </div>
          {activeTab === 'game' ? (
            <GameControls />
          ) : (
            <CommentaryPanel
              onHighlight={setHighlightPv}
              showOwnershipEnabled={showOwnershipEnabled}
              onToggleTerritory={handleTerritoryToggle}
            />
          )}
        </div>
      </div>
    </div>
  )
}
