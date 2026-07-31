/**
 * 五维能力雷达图（SVG）。
 * 维度固定顺序：吃子 / 围空 / 死活 / 布局 / 官子。
 */
interface Props {
  data: Record<string, number>
  size?: number
}

const DIMS = ['吃子', '围空', '死活', '布局', '官子']

export default function RadarChart({ data, size = 260 }: Props) {
  const cx = size / 2
  const cy = size / 2
  const R = size / 2 - 36
  const n = DIMS.length

  const pointAt = (index: number, ratio: number): [number, number] => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / n
    return [cx + Math.cos(angle) * R * ratio, cy + Math.sin(angle) * R * ratio]
  }

  const gridLevels = [0.25, 0.5, 0.75, 1]
  const dataPoints = DIMS.map((d, i) => pointAt(i, (data[d] ?? 0) / 100))
  const dataPath = dataPoints.map((p) => p.join(',')).join(' ')

  return (
    <svg width={size} height={size} className="radar-chart">
      {/* 网格 */}
      {gridLevels.map((lv) => (
        <polygon
          key={lv}
          points={DIMS.map((_, i) => pointAt(i, lv).join(',')).join(' ')}
          fill="none"
          stroke="#ddd6c8"
          strokeWidth={1}
        />
      ))}
      {/* 轴线 + 标签 */}
      {DIMS.map((d, i) => {
        const [x, y] = pointAt(i, 1)
        const [lx, ly] = pointAt(i, 1.18)
        return (
          <g key={d}>
            <line x1={cx} y1={cy} x2={x} y2={y} stroke="#ddd6c8" strokeWidth={1} />
            <text
              x={lx}
              y={ly}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={13}
              fill="#5b4636"
            >
              {d}
            </text>
            <text
              x={lx}
              y={ly + 14}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={11}
              fill="#8a8578"
            >
              {Math.round(data[d] ?? 0)}
            </text>
          </g>
        )
      })}
      {/* 数据多边形 */}
      <polygon
        points={dataPath}
        fill="rgba(184,134,11,0.25)"
        stroke="#b8860b"
        strokeWidth={2}
      />
      {dataPoints.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r={3} fill="#b8860b" />
      ))}
    </svg>
  )
}
