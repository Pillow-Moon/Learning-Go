/**
 * 胜率曲线组件（SVG 折线图）：
 * 横轴 = 手数，纵轴 = 黑胜率（0~100%）。
 * 支持关键点标记（好手/疑问手/恶手）、当前手定位、悬浮提示、点击跳转。
 */
import { useMemo, useRef, useState } from 'react'

import type { ReviewPoint } from '../stores/reviewStore'

interface Props {
  /** 整盘分析点（下标 = position，可为空 = 未分析） */
  points: (ReviewPoint | null)[]
  /** 当前导航位置（手数） */
  moveIndex: number
  /** 点击曲线跳转到对应手 */
  onSelect?: (position: number) => void
  height?: number
}

const PAD = { top: 10, right: 12, bottom: 18, left: 34 }

const VERDICT_COLOR: Record<string, string> = {
  good: '#2e7d32',
  doubt: '#f57c00',
  bad: '#c62828',
}

const VERDICT_LABEL: Record<string, string> = {
  good: '好手',
  doubt: '疑问手',
  bad: '恶手',
}

export default function WinrateChart({ points, moveIndex, onSelect, height = 150 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [hoverPos, setHoverPos] = useState<number | null>(null)

  const total = points.length - 1

  const { width, linePath, marked } = useMemo(() => {
    const w = Math.max(280, wrapRef.current?.clientWidth ?? 600)
    const iw = w - PAD.left - PAD.right
    const ih = height - PAD.top - PAD.bottom
    const x = (pos: number) => PAD.left + (total > 0 ? (pos / total) * iw : 0)
    const y = (wr: number | null) =>
      wr == null ? PAD.top : PAD.top + (1 - wr) * ih

    const segs: string[] = []
    let current: string[] = []
    points.forEach((p, i) => {
      if (p?.blackWinrate == null) {
        if (current.length > 0) {
          segs.push(current.join(' '))
          current = []
        }
        return
      }
      const cmd = current.length === 0 ? 'M' : 'L'
      current.push(`${cmd}${x(i).toFixed(1)},${y(p.blackWinrate).toFixed(1)}`)
    })
    if (current.length > 0) segs.push(current.join(' '))

    const marked = points
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p && p.verdict && p.blackWinrate != null)
      .map(({ p, i }) => ({
        i,
        x: x(i),
        y: y(p!.blackWinrate),
        verdict: p!.verdict!,
        loss: p!.loss,
      }))

    return { width: w, linePath: segs, marked }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, total, height])

  const hovered = hoverPos != null ? points[hoverPos] : null

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (total === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const pos = Math.round(((x - PAD.left) / (rect.width - PAD.left - PAD.right)) * total)
    setHoverPos(Math.max(0, Math.min(total, pos)))
  }

  const cur = points[moveIndex]

  return (
    <div className="winrate-chart" ref={wrapRef}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverPos(null)}
        onClick={() => hoverPos != null && onSelect?.(hoverPos)}
      >
        {/* 网格：25/50/75% 胜率线 */}
        {[0.25, 0.5, 0.75].map((v) => (
          <line
            key={v}
            x1={PAD.left}
            x2={width - PAD.right}
            y1={PAD.top + (1 - v) * (height - PAD.top - PAD.bottom)}
            y2={PAD.top + (1 - v) * (height - PAD.top - PAD.bottom)}
            stroke={v === 0.5 ? 'rgba(128,128,128,0.5)' : 'rgba(128,128,128,0.22)'}
            strokeWidth={v === 0.5 ? 1 : 0.6}
            strokeDasharray={v === 0.5 ? '6 4' : undefined}
          />
        ))}

        {/* Y 轴标签 */}
        {[0.5, 0.75, 1].map((v) => (
          <text
            key={v}
            x={PAD.left - 6}
            y={PAD.top + (1 - v) * (height - PAD.top - PAD.bottom) + 3}
            fontSize={9}
            fill="rgba(128,128,128,0.85)"
            textAnchor="end"
          >
            {Math.round(v * 100)}%
          </text>
        ))}

        {/* X 轴：首手 / 中局 / 终局 */}
        <text x={PAD.left} y={height - 5} fontSize={9} fill="rgba(128,128,128,0.85)">
          第 1 手
        </text>
        <text
          x={width - PAD.right}
          y={height - 5}
          fontSize={9}
          fill="rgba(128,128,128,0.85)"
          textAnchor="end"
        >
          第 {total} 手
        </text>

        {/* 折线（分段：未分析区间断开） */}
        {linePath.map((seg, i) => (
          <path
            key={i}
            d={seg}
            fill="none"
            stroke="#1a73e8"
            strokeWidth={1.8}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {/* 关键点标记 */}
        {marked.map((m) => (
          <g key={m.i}>
            <circle cx={m.x} cy={m.y} r={4.5} fill={VERDICT_COLOR[m.verdict]} stroke="#fff" strokeWidth={1} />
            <title>{`第 ${m.i} 手：${VERDICT_LABEL[m.verdict]}（胜率损失 ${(m.loss != null ? m.loss * 100 : 0).toFixed(1)}%）`}</title>
          </g>
        ))}

        {/* 当前手定位 */}
        {cur?.blackWinrate != null && (
          <line
            x1={PAD.left + (total > 0 ? (moveIndex / total) * (width - PAD.left - PAD.right) : 0)}
            x2={PAD.left + (total > 0 ? (moveIndex / total) * (width - PAD.left - PAD.right) : 0)}
            y1={PAD.top}
            y2={height - PAD.bottom}
            stroke="rgba(26,115,232,0.35)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}

        {/* 悬浮点 */}
        {hovered?.blackWinrate != null && (
          <circle
            cx={PAD.left + (total > 0 ? (hoverPos! / total) * (width - PAD.left - PAD.right) : 0)}
            cy={PAD.top + (1 - hovered.blackWinrate) * (height - PAD.top - PAD.bottom)}
            r={4}
            fill="#1a73e8"
            stroke="#fff"
            strokeWidth={1.5}
          />
        )}
      </svg>

      {/* 悬浮提示 */}
      {hovered && hoverPos != null && (
        <div
          className="winrate-tooltip"
          style={{
            left: Math.min(
              width - 150,
              Math.max(4, PAD.left + (total > 0 ? (hoverPos / total) * (width - PAD.left - PAD.right) : 0)),
            ),
            top: Math.max(2, PAD.top + (1 - (hovered.blackWinrate ?? 0.5)) * (height - PAD.top - PAD.bottom) - 34),
          }}
        >
          <strong>第 {hoverPos} 手</strong>
          {hovered.blackWinrate != null && (
            <> 黑胜率 {(hovered.blackWinrate * 100).toFixed(1)}%</>
          )}
          {hovered.verdict && hovered.loss != null && (
            <>
              {' · '}
              <span style={{ color: VERDICT_COLOR[hovered.verdict] }}>
                {VERDICT_LABEL[hovered.verdict]}
                （{hovered.loss < 0 ? '+' : '-'}
                {(Math.abs(hovered.loss) * 100).toFixed(1)}%）
              </span>
            </>
          )}
        </div>
      )}
    </div>
  )
}
