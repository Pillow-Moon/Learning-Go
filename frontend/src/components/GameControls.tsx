/**
 * 对局选项卡（右侧面板）：
 * - 对局未开始：平铺对局设置表单（棋盘/模式/AI 执/AI 等级）+ 开始对局
 * - 对局进行中：收缩为紧凑状态条（状态/手数提子/悔棋/虚手/认输）
 * 局面分析已并入 AI 解说面板。
 */
import { useState } from 'react'

import { useGameStore } from '../stores/gameStore'
import {
  useSettingsStore,
} from '../stores/settingsStore'
import {
  AI_STRENGTH_OPTIONS,
  getStrengthCap,
  getStrengthOptionsFor,
  isStrengthAllowed,
  type AIStrengthId,
} from '../lib/strength'
import { getCurrentEngine } from '../engines/manager'
import type { BoardSize, GameMode, Player } from '../lib/types'

const SIZES: BoardSize[] = [9, 13, 19]

export default function GameControls() {
  const {
    boardSize,
    currentPlayer,
    moves,
    status,
    result,
    board,
    gameMode,
    aiColor,
    aiError,
    newGame,
    pass,
    resign,
    undo,
    resetToSetup,
    clearAiError,
  } = useGameStore()

  const {
    engineSource,
    localBenchmarkScore,
    wasmBenchmarkScore,
  } = useSettingsStore()
  const engine = getCurrentEngine()
  const engineInfo = engine.getInfo()
  const bScore =
    engineSource === 'local' ? localBenchmarkScore : wasmBenchmarkScore
  /** 当前模型名（决定棋力系数） */
  const currentModelId = engineInfo.model
  /** 当前可选最高等级（可达性上限：每手时间预算内可达） */
  const strengthCap = getStrengthCap(engineSource, currentModelId, bScore)

  // 对局设置表单（点击「开始对局」生效）
  const [size, setSize] = useState<BoardSize>(boardSize)
  const [mode, setMode] = useState<GameMode>(gameMode)
  // 玩家执色（1=黑，-1=白）；AI 执相反色（gameStore.aiColor 为 AI 执色）
  const [playerColor, setPlayerColor] = useState<Player>(() => -aiColor as Player)
  // 本局 AI 等级（临时覆盖默认；默认业余 1 段，超出当前引擎上限时下拉会显示提示项）
  const [aiLevel, setAiLevel] = useState<AIStrengthId>('am1d')
  // 认输确认弹窗（不用 window.confirm：在内置 webview 中转发宿主会触发宿主 React 崩溃）
  const [showResignConfirm, setShowResignConfirm] = useState(false)

  const capturesBlack = board.getCaptures(1) ?? 0
  const capturesWhite = board.getCaptures(-1) ?? 0
  const playing = status === 'playing'

  const startGame = () => {
    newGame({ size, mode, aiColor: (-playerColor) as Player, aiStrength: aiLevel })
  }

  return (
    <div className="controls">
      {/* 状态区 */}
      <div className="controls-status">
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
            ⚠ {String(aiError)}（点击关闭）
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
            {bScore > 0 && ` · ${bScore} v/s`}
          </span>
        </div>
      </div>

      {status === 'idle' ? (
        /* ===== 对局设置（展开表单） ===== */
        <div className="setup-form">
          <div className="setup-form-row">
            <div className="seg-group">
              {SIZES.map((s) => (
                <button
                  key={s}
                  className={`seg-btn ${s === size ? 'active' : ''}`}
                  onClick={() => setSize(s)}
                >
                  {s}路
                </button>
              ))}
            </div>
          </div>

          <div className="setup-form-row">
            <div className="seg-group">
              <button
                className={`seg-btn ${mode === 'human_vs_human' ? 'active' : ''}`}
                onClick={() => setMode('human_vs_human')}
              >
                双人
              </button>
              <button
                className={`seg-btn ${mode === 'human_vs_ai' ? 'active' : ''}`}
                onClick={() => setMode('human_vs_ai')}
              >
                人机
              </button>
            </div>
          </div>

          {mode === 'human_vs_ai' && (
            <>
              <div className="setup-form-row">
                <div className="seg-group">
                  <button
                    className={`seg-btn ${playerColor === 1 ? 'active' : ''}`}
                    onClick={() => setPlayerColor(1)}
                  >
                    黑
                  </button>
                  <button
                    className={`seg-btn ${playerColor === -1 ? 'active' : ''}`}
                    onClick={() => setPlayerColor(-1)}
                  >
                    白
                  </button>
                </div>
              </div>

              <div className="setup-form-row">
                <select
                  className="select"
                  value={aiLevel}
                  onChange={(e) => setAiLevel(e.target.value as AIStrengthId)}
                >
                  {/* 档位按 strengthCap 过滤：Local 走 Human-SL 标尺，WASM 走盲注错误注入（am20k~am5d） */}
                  {getStrengthOptionsFor(engineSource, size, strengthCap).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                  {!isStrengthAllowed(aiLevel, strengthCap) && (
                    <option value={aiLevel}>
                      {AI_STRENGTH_OPTIONS.find((o) => o.id === aiLevel)
                        ?.label ?? aiLevel}
                      （超出当前引擎上限）
                    </option>
                  )}
                </select>
              </div>
            </>
          )}

          <button className="btn primary setup-start" onClick={startGame}>
            开始对局
          </button>
        </div>
      ) : (
        /* ===== 对局进行中：收缩为侧边栏（状态条） ===== */
        <>
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

          <div className="game-toolbar">
            <button
              className="btn small"
              onClick={undo}
              disabled={moves.length === 0 || status === 'waiting_ai'}
            >
              悔棋
            </button>
            <button className="btn small" onClick={pass} disabled={!playing}>
              虚手
            </button>
            <button
              className="btn small danger"
              onClick={() => setShowResignConfirm(true)}
              disabled={status === 'finished'}
            >
              认输
            </button>
            {status === 'finished' && (
              <button className="btn small primary" onClick={resetToSetup}>
                新对局
              </button>
            )}
          </div>
        </>
      )}

      {/* 认输确认弹窗（替代 window.confirm） */}
      {showResignConfirm && (
        <div className="modal-overlay" onClick={() => setShowResignConfirm(false)}>
          <div className="modal resign-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>认输</h2>
              <button
                className="btn small"
                onClick={() => setShowResignConfirm(false)}
              >
                关闭
              </button>
            </div>
            <p className="hint" style={{ margin: '12px 0 4px' }}>
              确定认输吗？对局将立即结束。
            </p>
            <div className="resign-modal-actions">
              <button
                className="btn danger"
                onClick={() => {
                  resign()
                  setShowResignConfirm(false)
                }}
              >
                确认认输
              </button>
              <button
                className="btn"
                onClick={() => setShowResignConfirm(false)}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
