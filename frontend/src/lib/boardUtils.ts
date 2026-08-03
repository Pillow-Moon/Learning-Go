/**
 * 棋盘绘制与坐标相关的工具函数。
 */
import type { BoardSize, Vertex } from './types'

/** 列坐标字母（围棋惯例跳过 I） */
const COLUMN_LETTERS = 'ABCDEFGHJKLMNOPQRST'

/**
 * 获取指定尺寸棋盘的星位（hoshi）坐标，0-based [x, y]。
 */
export function getStarPoints(size: BoardSize): Vertex[] {
  if (size === 19) {
    const pts = [3, 9, 15]
    const result: Vertex[] = []
    for (const x of pts) for (const y of pts) result.push([x, y])
    return result
  }
  if (size === 13) {
    return [
      [3, 3],
      [3, 9],
      [9, 3],
      [9, 9],
      [6, 6],
    ]
  }
  // 9x9
  return [
    [2, 2],
    [2, 6],
    [6, 2],
    [6, 6],
    [4, 4],
  ]
}

/**
 * 列索引 -> 字母标签（0 -> 'A'）。
 */
export function columnLabel(x: number): string {
  return COLUMN_LETTERS[x] ?? ''
}

/**
 * 行索引 -> 数字标签。y=0 是棋盘顶部，对应最大行号。
 */
export function rowLabel(y: number, size: number): string {
  return String(size - y)
}

/**
 * 把 [x, y] 转成标准围棋坐标字符串，如 "Q16"。
 */
export function vertexToCoord(vertex: Vertex, size: number): string {
  const [x, y] = vertex
  return `${columnLabel(x)}${rowLabel(y, size)}`
}

/**
 * 构造引擎着法序列：让子（黑）作为前缀，之后按实战着法。
 * KataGo 通过着法序列重建棋盘，让子必须以黑方落子形式告知。
 */
export function buildEngineMoves(
  moves: { color: number; vertex: Vertex | null }[],
  handicapStones?: Vertex[],
): [string, [number, number] | null][] {
  const prefix: [string, [number, number] | null][] = (handicapStones ?? []).map(
    (v) => ['B', v],
  )
  const seq: [string, [number, number] | null][] = moves.map((m) => [
    m.color === 1 ? 'B' : 'W',
    m.vertex,
  ])
  return [...prefix, ...seq]
}
