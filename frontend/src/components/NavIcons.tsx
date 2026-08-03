/**
 * 复盘/定式导航图标（内联 SVG，线条风格）。
 * 用 SVG 替代 ⏮◀▶⏭ 等 Unicode 符号——部分 Windows 字体缺字形会显示为方框。
 * stroke=currentColor 随按钮文字颜色（主题）变色；参照 App.tsx 主题按钮写法。
 */
interface IconProps {
  size?: number
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
})

/** 跳到首手（双左箭头） */
export function FirstIcon({ size = 14 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M11 6l-6 6 6 6M18 6l-6 6 6 6" />
    </svg>
  )
}

/** 退一手（左箭头） */
export function PrevIcon({ size = 14 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M14 6l-6 6 6 6" />
    </svg>
  )
}

/** 进一手（右箭头） */
export function NextIcon({ size = 14 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M10 6l6 6-6 6" />
    </svg>
  )
}

/** 跳到尾手（双右箭头） */
export function LastIcon({ size = 14 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M6 6l6 6-6 6M13 6l6 6-6 6" />
    </svg>
  )
}
