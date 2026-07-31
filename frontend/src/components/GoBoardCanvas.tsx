/**
 * 自绘 Canvas 围棋棋盘。
 *
 * 职责：纯渲染 + 鼠标交互。规则判断全部交给上层（gameStore / @sabaki/go-board）。
 * 支持 9/13/19 路、坐标标注、星位、悬停预览、最后一手标记、分析候选叠加、高 DPI。
 */
import { useEffect, useRef, useState } from 'react'
import type GoBoard from '@sabaki/go-board'

import type { Player, Vertex } from '../lib/types'
import type { Candidate } from '../engines/types'
import { columnLabel, getStarPoints, rowLabel } from '../lib/boardUtils'

const BOARD_BG = '#E8C778'
const LINE_COLOR = '#5b4636'
const LABEL_COLOR = '#5b4636'
const MARGIN = 28
const MAX_CANDIDATES = 5

interface Props {
  board: GoBoard
  boardSize: number
  currentPlayer: Player
  lastMove: Vertex | null
  interactive?: boolean
  pixelSize?: number
  /** 分析候选选点（叠加显示） */
  candidates?: Candidate[] | null
  /** 变化图高亮顶点序列 */
  highlights?: Vertex[] | null
  onPlay?: (vertex: Vertex) => void
}

export default function GoBoardCanvas({
  board,
  boardSize,
  currentPlayer,
  lastMove,
  interactive = true,
  pixelSize = 600,
  candidates,
  highlights,
  onPlay,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [hover, setHover] = useState<Vertex | null>(null)

  const cellSize = (pixelSize - 2 * MARGIN) / (boardSize - 1)

  const toPixel = (v: Vertex): [number, number] => [
    MARGIN + v[0] * cellSize,
    MARGIN + v[1] * cellSize,
  ]

  const toVertex = (px: number, py: number): Vertex | null => {
    const x = Math.round((px - MARGIN) / cellSize)
    const y = Math.round((py - MARGIN) / cellSize)
    if (x < 0 || x >= boardSize || y < 0 || y >= boardSize) return null
    const [cx, cy] = toPixel([x, y])
    if (Math.hypot(px - cx, py - cy) > cellSize * 0.48) return null
    return [x, y]
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = pixelSize * dpr
    canvas.height = pixelSize * dpr
    canvas.style.width = `${pixelSize}px`
    canvas.style.height = `${pixelSize}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // 背景
    ctx.fillStyle = BOARD_BG
    ctx.fillRect(0, 0, pixelSize, pixelSize)

    // 网格线
    ctx.strokeStyle = LINE_COLOR
    ctx.lineWidth = 1
    for (let i = 0; i < boardSize; i++) {
      const [x0, y0] = toPixel([i, 0])
      const [x1, y1] = toPixel([i, boardSize - 1])
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y1)
      ctx.stroke()
      const [hx0, hy0] = toPixel([0, i])
      const [hx1, hy1] = toPixel([boardSize - 1, i])
      ctx.beginPath()
      ctx.moveTo(hx0, hy0)
      ctx.lineTo(hx1, hy1)
      ctx.stroke()
    }

    // 星位
    ctx.fillStyle = LINE_COLOR
    for (const sp of getStarPoints(boardSize as 9 | 13 | 19)) {
      const [sx, sy] = toPixel(sp)
      ctx.beginPath()
      ctx.arc(sx, sy, Math.max(2.5, cellSize * 0.08), 0, Math.PI * 2)
      ctx.fill()
    }

    // 坐标标签
    ctx.fillStyle = LABEL_COLOR
    ctx.font = `${Math.max(10, cellSize * 0.32)}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (let x = 0; x < boardSize; x++) {
      const [px] = toPixel([x, 0])
      ctx.fillText(columnLabel(x), px, MARGIN * 0.45)
      ctx.fillText(columnLabel(x), px, pixelSize - MARGIN * 0.45)
    }
    for (let y = 0; y < boardSize; y++) {
      const [, py] = toPixel([0, y])
      ctx.fillText(rowLabel(y, boardSize), MARGIN * 0.45, py)
      ctx.fillText(rowLabel(y, boardSize), pixelSize - MARGIN * 0.45, py)
    }

    // 棋子
    for (let x = 0; x < boardSize; x++) {
      for (let y = 0; y < boardSize; y++) {
        const sign = board.get([x, y])
        if (sign === 0 || sign == null) continue
        const [px, py] = toPixel([x, y])
        drawStone(ctx, px, py, cellSize * 0.47, sign as Player)
      }
    }

    // 分析候选叠加（仅空点）
    if (candidates && candidates.length > 0) {
      drawCandidates(ctx, candidates, board, toPixel, cellSize)
    }

    // 变化图高亮（带顺序编号）
    if (highlights && highlights.length > 0) {
      drawHighlights(ctx, highlights, toPixel, cellSize)
    }

    // 最后一手标记
    if (lastMove) {
      const sign = board.get(lastMove)
      const [lx, ly] = toPixel(lastMove)
      ctx.strokeStyle = sign === 1 ? '#fff' : '#000'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(lx, ly, cellSize * 0.18, 0, Math.PI * 2)
      ctx.stroke()
    }

    // 悬停预览
    if (hover && interactive) {
      const sign = board.get(hover)
      if (sign === 0) {
        const [hx, hy] = toPixel(hover)
        ctx.globalAlpha = 0.4
        drawStone(ctx, hx, hy, cellSize * 0.47, currentPlayer)
        ctx.globalAlpha = 1
      }
    }
  }, [board, boardSize, lastMove, hover, currentPlayer, interactive, pixelSize, cellSize, candidates, highlights])

  const handleMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!interactive) return
    const rect = e.currentTarget.getBoundingClientRect()
    setHover(toVertex(e.clientX - rect.left, e.clientY - rect.top))
  }

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!interactive || !onPlay) return
    const rect = e.currentTarget.getBoundingClientRect()
    const v = toVertex(e.clientX - rect.left, e.clientY - rect.top)
    if (v) onPlay(v)
  }

  return (
    <canvas
      ref={canvasRef}
      onMouseMove={handleMove}
      onMouseLeave={() => setHover(null)}
      onClick={handleClick}
      style={{ cursor: interactive ? 'pointer' : 'default', borderRadius: 4 }}
    />
  )
}

/** 绘制一颗带渐变和高光的棋子 */
function drawStone(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  color: Player,
) {
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.35)'
  ctx.shadowBlur = radius * 0.25
  ctx.shadowOffsetX = radius * 0.08
  ctx.shadowOffsetY = radius * 0.12
  const grad = ctx.createRadialGradient(
    cx - radius * 0.3,
    cy - radius * 0.3,
    radius * 0.1,
    cx,
    cy,
    radius,
  )
  if (color === 1) {
    grad.addColorStop(0, '#6a6a6a')
    grad.addColorStop(1, '#000000')
  } else {
    grad.addColorStop(0, '#ffffff')
    grad.addColorStop(1, '#c4c4c4')
  }
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** 绘制变化图高亮（半透明圆 + 顺序编号） */
function drawHighlights(
  ctx: CanvasRenderingContext2D,
  highlights: Vertex[],
  toPixel: (v: Vertex) => [number, number],
  cellSize: number,
) {
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  highlights.forEach((v, idx) => {
    const [px, py] = toPixel(v)
    ctx.fillStyle = 'rgba(220,120,0,0.35)'
    ctx.beginPath()
    ctx.arc(px, py, cellSize * 0.42, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#7a3b00'
    ctx.font = `bold ${Math.max(10, cellSize * 0.34)}px sans-serif`
    ctx.fillText(String(idx + 1), px, py)
  })
  ctx.restore()
}

/** 绘制分析候选选点标记（最佳着用三角，其余用圆点 + 胜率） */
function drawCandidates(
  ctx: CanvasRenderingContext2D,
  candidates: Candidate[],
  board: GoBoard,
  toPixel: (v: Vertex) => [number, number],
  cellSize: number,
) {
  const top = candidates
    .filter((c) => c.move && board.get(c.move) === 0)
    .slice(0, MAX_CANDIDATES)

  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  top.forEach((c, idx) => {
    if (!c.move) return
    const [px, py] = toPixel(c.move)
    const winrate = c.winrate ?? 0
    const pct = Math.round(winrate * 100)

    if (idx === 0) {
      // 最佳着：红色三角
      const r = cellSize * 0.28
      ctx.fillStyle = 'rgba(200,40,40,0.9)'
      ctx.beginPath()
      ctx.moveTo(px, py - r)
      ctx.lineTo(px - r * 0.9, py + r * 0.7)
      ctx.lineTo(px + r * 0.9, py + r * 0.7)
      ctx.closePath()
      ctx.fill()
    } else {
      // 次选：蓝色圆点
      ctx.fillStyle = 'rgba(30,90,180,0.75)'
      ctx.beginPath()
      ctx.arc(px, py, cellSize * 0.16, 0, Math.PI * 2)
      ctx.fill()
    }

    // 胜率标签
    ctx.fillStyle = '#1a1a1a'
    ctx.font = `bold ${Math.max(9, cellSize * 0.26)}px sans-serif`
    ctx.fillText(`${pct}%`, px, py - cellSize * 0.42)
  })

  ctx.restore()
}
