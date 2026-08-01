/**
 * 棋盘视觉主题与棋子样式定义（对齐 Online-Go.com / OGS 的主题体系）。
 * GoBoardCanvas 按主题配色渲染，主题可在设置页切换（settingsStore 持久化）。
 */

/* ===== 棋盘主题 ===== */

export type BoardThemeId = 'plain' | 'night' | 'book'

export interface BoardTheme {
  id: BoardThemeId
  name: string
  /** 棋盘底色 */
  boardBg: string
  /** 网格线 / 星位 / 坐标标签颜色 */
  line: string
  /** 最后一手标记颜色（分别用于黑子、白子上） */
  lastMoveBlack: string
  lastMoveWhite: string
}

/** 棋盘主题（纯色系） */
export const BOARD_THEMES: BoardTheme[] = [
  {
    id: 'plain',
    name: '默认',
    boardBg: '#DCB35C',
    line: '#000000',
    lastMoveBlack: '#ffffff',
    lastMoveWhite: '#000000',
  },
  {
    id: 'book',
    name: '纯白',
    boardBg: '#ffffff',
    line: '#777777',
    lastMoveBlack: '#000000',
    lastMoveWhite: '#000000',
  },
  {
    id: 'night',
    name: '夜间',
    boardBg: '#444444',
    line: '#777777',
    lastMoveBlack: '#ffffff',
    lastMoveWhite: '#000000',
  },
]

/** 旧版主题 id -> 新主题映射（兼容 localStorage 持久化旧值，含已删除的主题） */
const LEGACY_BOARD: Record<string, BoardThemeId> = {
  classic: 'plain',
  pine: 'book',
  slate: 'plain',
  light: 'book',
  granite: 'plain',
  hng: 'night',
  'hng-night': 'night',
  kaya: 'plain',
  'bright-kaya': 'book',
  'red-oak': 'plain',
  persimmon: 'plain',
  'black-walnut': 'plain',
}

export function getBoardTheme(id: string): BoardTheme {
  const mapped = LEGACY_BOARD[id] ?? (id as BoardThemeId)
  return BOARD_THEMES.find((t) => t.id === mapped) ?? BOARD_THEMES[0]
}

/* ===== 棋子样式 ===== */

export type StoneStyleId = 'plain' | 'glass' | 'slate-shell' | 'worn-glass' | 'night'

/** 单色棋子的视觉参数（对应 OGS rendered_stones 的 Phong 渲染） */
export interface StoneVisual {
  /** 基础色 */
  base: string
  /** 边缘暗色 */
  edge: string
  /** 高光强度 0~1（映射 OGS specular_hardness） */
  specular: number
  /** 是否绘制贝壳平行线 */
  shell: boolean
}

export interface StoneStyle {
  id: StoneStyleId
  name: string
  desc: string
  black: StoneVisual
  white: StoneVisual
}

/**
 * OGS 棋子主题（配色/高光取自 online-go/goban themes/rendered_stones.ts）：
 * - Plain：纯色
 * - Glass：黑 rgba(15,15,20) hardness 30 / 白 rgba(207,205,206) hardness 80
 * - Slate（黑 rgba(30,30,35) hardness 17）+ Shell（白 rgba(207,205,206) hardness 24，贝壳线）
 * - Worn Glass：白 rgba(189,189,194) hardness 35
 * - Night：黑 hardness 5 / 白 rgba(100,100,100) hardness 13
 */
export const STONE_STYLES: StoneStyle[] = [
  {
    id: 'plain',
    name: '默认',
    desc: '纯色无光泽，边缘用棋盘线色描边',
    black: { base: '#000000', edge: '#000000', specular: 0, shell: false },
    white: { base: '#ffffff', edge: '#ffffff', specular: 0, shell: false },
  },
  {
    id: 'slate-shell',
    name: '蛤碁石',
    desc: '黑子石板质感，白子蛤壳纹（日本碁石经典组合）',
    black: { base: '#1e1e23', edge: '#0c0c0f', specular: 0.22, shell: false },
    white: { base: '#cfcdce', edge: '#a8a6a9', specular: 0.3, shell: true },
  },
  {
    id: 'glass',
    name: '玻璃',
    desc: '强高光、通透感',
    black: { base: '#0f0f14', edge: '#050507', specular: 0.4, shell: false },
    white: { base: '#cfcdce', edge: '#a8a6a9', specular: 1.0, shell: false },
  },
  {
    id: 'worn-glass',
    name: '旧玻璃',
    desc: '哑光玻璃，磨损感',
    black: { base: '#0f0f14', edge: '#050507', specular: 0.25, shell: false },
    white: { base: '#bdbdc2', edge: '#9d9da4', specular: 0.44, shell: false },
  },
  {
    id: 'night',
    name: '夜间',
    desc: '低对比度，适合夜间棋盘',
    black: { base: '#0f0f14', edge: '#07070a', specular: 0.06, shell: false },
    white: { base: '#646464', edge: '#4c4c4c', specular: 0.16, shell: false },
  },
]

/** 旧版棋子样式 id -> 新样式映射（兼容 localStorage 持久化旧值） */
const LEGACY_STONE: Record<string, StoneStyleId> = {
  glossy: 'glass',
  shell: 'slate-shell',
  glass: 'glass',
  ceramic: 'plain',
}

export function getStoneStyle(id: string): StoneStyle {
  const mapped = LEGACY_STONE[id] ?? (id as StoneStyleId)
  return STONE_STYLES.find((s) => s.id === mapped) ?? STONE_STYLES[0]
}
