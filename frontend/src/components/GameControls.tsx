/**
 * 对局控制面板：对局设置 + 状态显示 + 操作按钮 + 局面分析。
 */
import { useState } from 'react'

import { useGameStore } from '../stores/gameStore'
import { useAnalysisStore } from '../stores/analysisStore'
import { useSettingsStore } from '../stores/settingsStore'
import { getCurrentEngine } from '../engines/manager'
import type { BoardSize, GameMode, Player } from '../lib/types'

const SIZES: BoardSize[] = [9, 13, 19]

const DIFFICULTIES: { label: string; visits: number }[] = [
  { label: '入门', visits: 1 },
  { label: '初级', visits: 10 },
  { label: '业余低段', visits: 50 },
  { label: '业余中段', visits: 200 },
  { label: '业余高段', visits: 1000 },
]

export default function GameControls() {
  const {
    boardSize,
    currentPlayer,
    moves,
    status,
    result,
    board,
    komi,
    maxVisits,
    gameMode,
    aiColor,
    aiError,
    newGame,
    pass,
    resign,
    undo,
    clearAiError,
  } = useGameStore()

  const { analyzing, error: analysisError, analyze, clear } = useAnalysisStore()
  const { engineSource, benchmarkScore } = useSettingsStore()
  const engine = getCurrentEngine()
  const engineInfo = engine.getInfo()

  // 对局设置表单（点击「开始新对局」生效）
  const [size, setSize] = useState<BoardSize>(boardSize)
  const [mode, setMode] = useState<GameMode>(gameMode)
  const [ai, setAi] = useState<Player>(aiColor)
  const [visits, setVisits] = useState<number>(maxVisits)

  const capturesBlack = board.getCaptures(1) ?? 0
  const capturesWhite = board.getCaptures(-1) ?? 0
  const playing = status === 'playing'

  const startGame = () => {
    clear()
    newGame({ size, mode, aiColor: ai, maxVisits: visits })
  }

  const handleAnalyze = () => {
    const engineMoves: { color: string; vertex: [number, number] | null }[] = moves.map((m) => ({
      color: m.color === 1 ? 'B' : 'W',
      vertex: m.vertex,
    }))
    void analyze({ moves: engineMoves, boardSize, komi, maxVisits: visits })
  }

  return (
    <div className="controls">
      {/* 状态区 */}
      <div className="controls-status">
        {status === 'idle' && <p className="hint">设置后点击「开始新对局」</p>}
        {playing && (
          <p className="turn">
            <span
              className="turn-dot"
              style={{ background: currentPlayer === 1 ? '#111' : '#f5f5f5' }}
            />
            轮到 {currentPlayer === 1 ? '黑' : '白'} 落子
          </p>
        )}
        {status === 'waiting_ai' && <p className="turn">AI 思考中…</p>}
        {status === 'finished' && <p className="result">对局结束：{result}</p>}
        {aiError && (
          <p className="error" onClick={clearAiError}>
            ⚠ {aiError}（点击关闭）
          </p>
        )}
        {/* 引擎状态指示 */}
        <div className="engine-status">
          <span
            className="engine-dot"
            style={{ background: engineInfo.ready ? '#4caf50' : '#e53935' }}
            title={engineInfo.ready ? '引擎就绪' : '引擎未就绪'}
          />
          <span className="hint">
            {engineSource === 'local' ? '本地引擎' : 'WASM'}
            {engineInfo.ready ? ' ✓' : ' ✗ 未连接'}
            {benchmarkScore > 0 && ` · ${benchmarkScore} v/s`}
          </span>
        </div>
      </div>

      {/* 信息区 */}
      <div className="controls-info">
        <div className="info-item">
          <span className="info-label">手数</span>
          <span className="info-value">{moves.length}</span>
        </div>
        <div className="info-item">
          <span className="info-label">黑提子</span>
          <span className="info-value">{capturesBlack}</span>
        </div>
        <div className="info-item">
          <span className="info-label">白提子</span>
          <span className="info-value">{capturesWhite}</span>
        </div>
      </div>

      {/* 对局设置 */}
      <div className="setup">
        <div className="setup-row">
          <span className="info-label">棋盘</span>
          {SIZES.map((s) => (
            <button
              key={s}
              className={`size-btn ${s === size ? 'active' : ''}`}
              onClick={() => setSize(s)}
            >
              {s}路
            </button>
          ))}
        </div>
        <div className="setup-row">
          <span className="info-label">模式</span>
          <button
            className={`size-btn ${mode === 'human_vs_human' ? 'active' : ''}`}
            onClick={() => setMode('human_vs_human')}
          >
            双人
          </button>
          <button
            className={`size-btn ${mode === 'human_vs_ai' ? 'active' : ''}`}
            onClick={() => setMode('human_vs_ai')}
          >
            人机
          </button>
        </div>
        {mode === 'human_vs_ai' && (
          <>
            <div className="setup-row">
              <span className="info-label">AI 执</span>
              <button
                className={`size-btn ${ai === -1 ? 'active' : ''}`}
                onClick={() => setAi(-1)}
              >
                白
              </button>
              <button
                className={`size-btn ${ai === 1 ? 'active' : ''}`}
                onClick={() => setAi(1)}
              >
                黑
              </button>
            </div>
            <div className="setup-row">
              <span className="info-label">难度</span>
              <select
                className="select"
                value={visits}
                onChange={(e) => setVisits(Number(e.target.value))}
              >
                {DIFFICULTIES.map((d) => (
                  <option key={d.visits} value={d.visits}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>

      {/* 操作区 */}
      <div className="controls-actions">
        <button className="btn primary" onClick={startGame}>
          开始新对局
        </button>
        <button className="btn" onClick={undo} disabled={moves.length === 0 || status === 'waiting_ai'}>
          悔棋
        </button>
        <button className="btn" onClick={pass} disabled={!playing}>
          虚手
        </button>
        <button
          className="btn danger"
          onClick={() => {
            if (window.confirm('确定认输？')) resign()
          }}
          disabled={status === 'finished' || status === 'idle'}
        >
          认输
        </button>
      </div>

      {/* 分析区 */}
      <div className="analysis-box">
        <button className="btn" onClick={handleAnalyze} disabled={analyzing || status === 'idle'}>
          {analyzing ? '分析中…' : '分析局面'}
        </button>
        {analysisError && <p className="error">⚠ {analysisError}</p>}
      </div>
    </div>
  )
}
