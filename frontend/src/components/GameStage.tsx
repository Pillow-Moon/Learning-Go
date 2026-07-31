/**
 * 评估实战对弈阶段：3 局 9 路，难度递增（maxVisits 1/50/200）。
 * 每局统计用户落子命中 KataGo top-3 推荐的比例（重合度），不看胜负。
 * 使用引擎抽象层（GoEngine），不再依赖后端 API。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import GoBoard from '@sabaki/go-board'

import GoBoardCanvas from './GoBoardCanvas'
import { getCurrentEngine } from '../engines/manager'
import type { Candidate } from '../engines/types'
import type { Player, Vertex } from '../lib/types'

const BOARD_SIZE = 9
const KOMI = 7.5
const REFERENCE_VISITS = 100
const MAX_USER_MOVES = 12
const GAMES = [
  { maxVisits: 1, label: '第 1 局（入门对手）' },
  { maxVisits: 50, label: '第 2 局（业余低段对手）' },
  { maxVisits: 200, label: '第 3 局（业余中段对手）' },
]

const vkey = (v: Vertex) => `${v[0]},${v[1]}`

interface Props {
  onComplete: (overlaps: { max_visits: number; overlap_rate: number; move_count: number }[]) => void
}

export default function GameStage({ onComplete }: Props) {
  const [gameIdx, setGameIdx] = useState(0)
  const [board, setBoard] = useState(() => GoBoard.fromDimensions(BOARD_SIZE, BOARD_SIZE))
  const [moves, setMoves] = useState<[string, [number, number] | null][]>([])
  const [userToMove, setUserToMove] = useState(true)
  const [busy, setBusy] = useState(false)
  const [top3, setTop3] = useState<string[]>([])
  const hitsRef = useRef(0)
  const userMovesRef = useRef(0)
  const [status, setStatus] = useState('')
  const overlapsRef = useRef<{ max_visits: number; overlap_rate: number; move_count: number }[]>([])
  const engine = getCurrentEngine()

  const current = GAMES[gameIdx]

  // 轮到用户时，预取当前局面的参考分析（top-3）
  useEffect(() => {
    if (!userToMove || busy || !engine.isReady()) return
    let cancelled = false
    engine
      .analyze({ boardSize: BOARD_SIZE, komi: KOMI, maxVisits: REFERENCE_VISITS, moves })
      .then((res) => {
        if (cancelled) return
        setTop3(
          res.candidates
            .slice(0, 3)
            .filter((c: Candidate) => c.move)
            .map((c: Candidate) => vkey(c.move as Vertex)),
        )
      })
      .catch(() => setTop3([]))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moves.length, userToMove, busy, gameIdx])

  const finishGame = useCallback(() => {
    const userMoves = userMovesRef.current
    const overlapRate = userMoves > 0 ? hitsRef.current / userMoves : 0
    overlapsRef.current = [
      ...overlapsRef.current,
      { max_visits: current.maxVisits, overlap_rate: overlapRate, move_count: userMoves },
    ]
    if (gameIdx + 1 >= GAMES.length) {
      onComplete(overlapsRef.current)
    } else {
      setGameIdx((i) => i + 1)
      setBoard(GoBoard.fromDimensions(BOARD_SIZE, BOARD_SIZE))
      setMoves([])
      setUserToMove(true)
      setTop3([])
      hitsRef.current = 0
      userMovesRef.current = 0
      setStatus('')
    }
  }, [current.maxVisits, gameIdx, onComplete])

  const handlePlay = async (vertex: Vertex) => {
    if (!userToMove || busy) return
    const analysis = board.analyzeMove(1 as Player, vertex)
    if (analysis.overwrite || analysis.suicide || analysis.ko) return

    if (top3.includes(vkey(vertex))) hitsRef.current += 1
    userMovesRef.current += 1

    const newBoard = board.makeMove(1 as Player, vertex)
    const newMoves: [string, [number, number] | null][] = [...moves, ['B', vertex]]
    setBoard(newBoard)
    setMoves(newMoves)

    if (userMovesRef.current >= MAX_USER_MOVES) {
      setStatus('已达到本局手数上限。')
      setUserToMove(false)
      finishGame()
      return
    }

    // AI 应手（通过引擎抽象层）
    setBusy(true)
    setUserToMove(false)
    try {
      const resp = await engine.genmove(-1 as Player, BOARD_SIZE, KOMI, current.maxVisits, newMoves)
      const aiBoard = resp.vertex ? newBoard.makeMove(-1 as Player, resp.vertex) : newBoard
      setBoard(aiBoard)
      setMoves([...newMoves, ['W', resp.vertex]])
    } catch {
      setStatus('AI 不可用，本局提前结束。')
      finishGame()
      return
    } finally {
      setBusy(false)
    }
    setUserToMove(true)
  }

  return (
    <div className="assessment-stage">
      <h2>实战对弈</h2>
      <p className="hint">
        {current.label} · 你执黑 · 进度 {gameIdx + 1}/{GAMES.length} · 已下{' '}
        {userMovesRef.current}/{MAX_USER_MOVES} 手
        {!engine.isReady() && ' （引擎未就绪，请先启动后端）'}
      </p>
      <div className="assessment-board">
        <GoBoardCanvas
          board={board}
          boardSize={BOARD_SIZE}
          currentPlayer={1}
          lastMove={null}
          interactive={userToMove && !busy && engine.isReady()}
          pixelSize={420}
          onPlay={handlePlay}
        />
      </div>
      <p className="hint">
        {busy ? 'AI 思考中…' : '尽量下出你认为最好的一手（系统会对照 AI 推荐评估）。'}
      </p>
      {status && <p className="hint">{status}</p>}
      <button
        className="btn"
        onClick={finishGame}
        disabled={busy || userMovesRef.current === 0}
      >
        结束本局
      </button>
    </div>
  )
}
