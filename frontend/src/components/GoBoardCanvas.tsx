/**
 * 自绘 Canvas 围棋棋盘。
 *
 * 职责：纯渲染 + 鼠标交互。规则判断全部交给上层（@sabaki/go-board 规则引擎）。
 * 支持 9/13/19 路、坐标标注、星位、悬停预览、最后一手标记、分析候选叠加、变化图、领地渐变、高 DPI。
 */
import { useEffect, useRef, useState } from 'react'
import type GoBoard from '@sabaki/go-board'

import type { Player, Vertex } from '../lib/types'
import type { Candidate } from '../engines/types'
import { columnLabel, getStarPoints, rowLabel } from '../lib/boardUtils'
import { getBoardTheme, getStoneStyle, type BoardTheme, type BoardThemeId, type StoneStyleId, type StoneVisual } from '../lib/boardThemes'
import { useSettingsStore } from '../stores/settingsStore'

const MARGIN = 28
const MAX_CANDIDATES = 5

/** 响应式棋盘的最大边长（px）：自适应左侧空间但不超过此值，保证全屏时完整显示 */
const MAX_BOARD = 720

interface Props {
  board: GoBoard
  boardSize: number
  currentPlayer: Player
  lastMove: Vertex | null
  interactive?: boolean
  pixelSize?: number
  /** 覆盖全局设置的棋盘主题 */
  theme?: BoardThemeId
  /** 分析候选选点（叠加显示） */
  candidates?: Candidate[] | null
  /** 地盘预测（正=黑、负=白，绝对值越大越实） */
  ownership?: number[] | null
  /** 变化图高亮顶点序列 */
  highlights?: Vertex[] | null
  /** 变化图第一手颜色（调用方传当前执子方；缺省时序列按黑先交替） */
  highlightFirstColor?: Player
  onPlay?: (vertex: Vertex) => void
}

export default function GoBoardCanvas({
  board,
  boardSize,
  currentPlayer,
  lastMove,
  interactive = true,
  pixelSize,
  theme: themeProp,
  candidates,
  ownership,
  highlights,
  highlightFirstColor = 1,
  onPlay,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<Vertex | null>(null)
  const storeTheme = useSettingsStore((s) => s.boardTheme)
  const stoneStyle = useSettingsStore((s) => s.stoneStyle)
  const theme: BoardTheme = getBoardTheme(themeProp ?? storeTheme)

  // 未传 pixelSize（对弈页）时按容器宽度自适应填满左侧空间；其余页面传入固定尺寸
  const responsive = pixelSize == null
  const [size, setSize] = useState(pixelSize ?? 600)

  useEffect(() => {
    if (!responsive) return
    const el = containerRef.current
    if (!el) return
    const update = () => {
      const w = Math.floor(el.clientWidth)
      if (w > 0) setSize(Math.min(MAX_BOARD, w))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [responsive])

  const cellSize = (size - 2 * MARGIN) / (boardSize - 1)

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
    canvas.width = size * dpr
    canvas.height = size * dpr
    canvas.style.width = `${size}px`
    canvas.style.height = `${size}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // 背景
    ctx.fillStyle = theme.boardBg
    ctx.fillRect(0, 0, size, size)

    // 网格线
    ctx.strokeStyle = theme.line
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
    ctx.fillStyle = theme.line
    for (const sp of getStarPoints(boardSize as 9 | 13 | 19)) {
      const [sx, sy] = toPixel(sp)
      ctx.beginPath()
      ctx.arc(sx, sy, Math.max(2.5, cellSize * 0.08), 0, Math.PI * 2)
      ctx.fill()
    }

    // 坐标标签
    ctx.fillStyle = theme.line
    ctx.font = `${Math.max(10, cellSize * 0.32)}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (let x = 0; x < boardSize; x++) {
      const [px] = toPixel([x, 0])
      ctx.fillText(columnLabel(x), px, MARGIN * 0.45)
      ctx.fillText(columnLabel(x), px, size - MARGIN * 0.45)
    }
    for (let y = 0; y < boardSize; y++) {
      const [, py] = toPixel([0, y])
      ctx.fillText(rowLabel(y, boardSize), MARGIN * 0.45, py)
      ctx.fillText(rowLabel(y, boardSize), size - MARGIN * 0.45, py)
    }

    // 地盘预测（渐变：黑/白方地盘，越实颜色越深）
    if (ownership && ownership.length === boardSize * boardSize) {
      for (let y = 0; y < boardSize; y++) {
        for (let x = 0; x < boardSize; x++) {
          const v = ownership[y * boardSize + x]
          if (v == null || Math.abs(v) < 0.02) continue
          const [px, py] = toPixel([x, y])
          const half = cellSize * 0.46
          ctx.fillStyle =
            v > 0
              ? `rgba(30,30,30,${(Math.min(Math.abs(v), 1) * 0.45).toFixed(3)})`
              : `rgba(245,245,245,${(Math.min(Math.abs(v), 1) * 0.55).toFixed(3)})`
          ctx.fillRect(px - half, py - half, half * 2, half * 2)
        }
      }
    }

    // 棋子
    for (let x = 0; x < boardSize; x++) {
      for (let y = 0; y < boardSize; y++) {
        const sign = board.get([x, y])
        if (sign === 0 || sign == null) continue
        const [px, py] = toPixel([x, y])
        drawStone(ctx, px, py, cellSize * 0.47, sign as Player, theme, stoneStyle)
      }
    }

    // 分析候选叠加（仅空点）
    if (candidates && candidates.length > 0) {
      drawCandidates(ctx, candidates, board, toPixel, cellSize, theme)
    }

    // 变化图高亮（半透明黑白棋 + 顺序编号）
    if (highlights && highlights.length > 0) {
      drawHighlights(ctx, highlights, toPixel, cellSize, theme, highlightFirstColor)
    }

    // 最后一手标记
    if (lastMove) {
      const sign = board.get(lastMove)
      const [lx, ly] = toPixel(lastMove)
      ctx.strokeStyle = sign === 1 ? theme.lastMoveBlack : theme.lastMoveWhite
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
        drawStone(ctx, hx, hy, cellSize * 0.47, currentPlayer, theme, stoneStyle)
        ctx.globalAlpha = 1
      }
    }
  }, [board, boardSize, lastMove, hover, currentPlayer, interactive, size, cellSize, candidates, ownership, highlights, highlightFirstColor, theme, stoneStyle])

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
    <div ref={containerRef} style={{ width: '100%' }}>
      <canvas
        ref={canvasRef}
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
        onClick={handleClick}
        style={{ cursor: interactive ? 'pointer' : 'default', borderRadius: 4, display: 'block' }}
      />
    </div>
  )
}

/**
 * 绘制一颗棋子（对齐 OGS 的 Phong 渲染观感）：
 * 基础渐变（左上高光区亮、边缘暗）+ 可选高光斑 + 可选贝壳平行线 + Plain 描边。
 * 导出供设置页缩略图等场景复用。
 */
export function drawStone(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  color: Player,
  theme: BoardTheme,
  styleId: StoneStyleId,
) {
  const style = getStoneStyle(styleId)
  const v: StoneVisual = color === 1 ? style.black : style.white

  // 阴影（OGS shadow 向右下偏移）
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.3)'
  ctx.shadowBlur = radius * 0.2
  ctx.shadowOffsetX = radius * 0.15
  ctx.shadowOffsetY = radius * 0.18

  // 基础渐变：高光点偏左上（光源方向），边缘变暗
  const grad = ctx.createRadialGradient(
    cx - radius * 0.3,
    cy - radius * 0.35,
    radius * 0.1,
    cx,
    cy,
    radius,
  )
  grad.addColorStop(0, lighten(v.base, 0.28))
  grad.addColorStop(0.5, v.base)
  grad.addColorStop(1, v.edge)
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // 质感附加效果（裁剪到棋子圆形内）
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.clip()

  // 高光斑：强度越大越集中明亮
  if (v.specular > 0.05) {
    const hx = cx - radius * 0.34
    const hy = cy - radius * 0.4
    const hr = radius * (0.55 - v.specular * 0.28)
    const alpha = 0.25 + v.specular * 0.6
    const sg = ctx.createRadialGradient(hx, hy, 0, hx, hy, hr)
    sg.addColorStop(0, color === 1 ? `rgba(205,225,255,${alpha.toFixed(3)})` : `rgba(255,255,255,${alpha.toFixed(3)})`)
    sg.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = sg
    ctx.beginPath()
    ctx.arc(hx, hy, hr, 0, Math.PI * 2)
    ctx.fill()
  }

  // 贝壳平行线（OGS shell_lines：斜向平行细纹）
  if (v.shell) {
    ctx.strokeStyle = 'rgba(194,191,198,0.4)'
    ctx.lineWidth = Math.max(0.5, radius * 0.045)
    const angle = -0.55
    const cosA = Math.cos(angle)
    const sinA = Math.sin(angle)
    const nLines = 7
    const sep = (radius * 1.8) / nLines
    for (let i = -3; i <= 3; i++) {
      const off = i * sep
      ctx.beginPath()
      ctx.moveTo(
        cx + cosA * -radius * 2 + sinA * off,
        cy + sinA * -radius * 2 - cosA * off,
      )
      ctx.lineTo(
        cx + cosA * radius * 2 + sinA * off,
        cy + sinA * radius * 2 - cosA * off,
      )
      ctx.stroke()
    }
  }
  ctx.restore()

  // Plain 样式：棋盘线色描边
  if (styleId === 'plain') {
    ctx.beginPath()
    ctx.strokeStyle = theme.line
    ctx.lineWidth = Math.max(0.6, radius * 0.07)
    ctx.arc(cx, cy, radius - Math.max(0.3, radius * 0.03), 0, Math.PI * 2)
    ctx.stroke()
  }
}

/** 16 进制颜色 -> RGB */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = hex.replace('#', '')
  return {
    r: parseInt(m.slice(0, 2), 16),
    g: parseInt(m.slice(2, 4), 16),
    b: parseInt(m.slice(4, 6), 16),
  }
}

/** 16 进制颜色提亮 / 变暗（factor > 0 提亮，< 0 变暗），返回 hex */
function lighten(hex: string, factor: number): string {
  const { r, g, b } = hexToRgb(hex)
  const f = (c: number) => Math.min(255, Math.max(0, Math.round(c + (factor < 0 ? c * factor : (255 - c) * factor))))
  return `rgb(${f(r)},${f(g)},${f(b)})`
}

/** 棋盘底色是否偏暗（用于选择叠加文字/标记的明暗） */
function isDarkBoard(theme: BoardTheme): boolean {
  const { r, g, b } = hexToRgb(theme.boardBg)
  return 0.299 * r + 0.587 * g + 0.114 * b < 140
}

/**
 * 绘制变化图高亮：半透明黑白棋 + 顺序编号（1、2、3…）。
 * 颜色按序列奇偶交替（第一手 = firstColor，即当前执子方），
 * 黑棋上白字、白棋上黑字，保证编号清晰可辨。
 */
function drawHighlights(
  ctx: CanvasRenderingContext2D,
  highlights: Vertex[],
  toPixel: (v: Vertex) => [number, number],
  cellSize: number,
  theme: BoardTheme,
  firstColor: Player,
) {
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  highlights.forEach((v, idx) => {
    const [px, py] = toPixel(v)
    const color: Player = idx % 2 === 0 ? firstColor : ((firstColor * -1) as Player)
    const radius = cellSize * 0.46

    // 半透明棋子（纯色圆 + 同色描边；不调 drawStone，避免阴影叠加导致视觉杂乱）
    ctx.globalAlpha = 0.55
    ctx.fillStyle = color === 1 ? '#1a1a1a' : '#f5f5f5'
    ctx.beginPath()
    ctx.arc(px, py, radius, 0, Math.PI * 2)
    ctx.fill()
    ctx.lineWidth = Math.max(1, cellSize * 0.05)
    ctx.strokeStyle = theme.line
    ctx.stroke()

    // 顺序编号（黑棋上白字、白棋上黑字）
    ctx.globalAlpha = 0.95
    ctx.fillStyle = color === 1 ? '#ffffff' : '#1a1a1a'
    ctx.font = `bold ${Math.max(10, cellSize * 0.32)}px sans-serif`
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
  theme: BoardTheme,
) {
  const dark = isDarkBoard(theme)
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
      ctx.fillStyle = dark ? 'rgba(255,120,110,0.95)' : 'rgba(200,40,40,0.9)'
      ctx.beginPath()
      ctx.moveTo(px, py - r)
      ctx.lineTo(px - r * 0.9, py + r * 0.7)
      ctx.lineTo(px + r * 0.9, py + r * 0.7)
      ctx.closePath()
      ctx.fill()
    } else {
      // 次选：蓝色圆点
      ctx.fillStyle = dark ? 'rgba(110,170,255,0.85)' : 'rgba(30,90,180,0.75)'
      ctx.beginPath()
      ctx.arc(px, py, cellSize * 0.16, 0, Math.PI * 2)
      ctx.fill()
    }

    // 胜率标签
    ctx.fillStyle = dark ? '#f0f0f0' : '#1a1a1a'
    ctx.font = `bold ${Math.max(9, cellSize * 0.26)}px sans-serif`
    ctx.fillText(`${pct}%`, px, py - cellSize * 0.42)
  })

  ctx.restore()
}
