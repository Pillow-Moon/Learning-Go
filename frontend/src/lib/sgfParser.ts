/**
 * 轻量 SGF 解析：把 SGF 局面字符串解析为 GoBoard。
 * 支持本项目种子数据所用的基础属性：SZ / PL / AB / AW。
 */
import GoBoard from '@sabaki/go-board'

import type { Player, Vertex } from './types'

export interface ParsedSgf {
  board: GoBoard
  boardSize: number
  playerToMove: Player
}

function sgfCoordToVertex(coord: string): Vertex {
  return [coord.charCodeAt(0) - 97, coord.charCodeAt(1) - 97]
}

function extractStones(sgf: string, prop: string): Vertex[] {
  const re = new RegExp(`${prop}((?:\\[[a-z]{2}\\])+)`)
  const m = sgf.match(re)
  if (!m) return []
  const coords = m[1].match(/\[([a-z]{2})\]/g) || []
  return coords.map((c) => sgfCoordToVertex(c.slice(1, 3)))
}

export function parseSgf(sgf: string): ParsedSgf {
  const sizeMatch = sgf.match(/SZ\[(\d+)\]/)
  const boardSize = sizeMatch ? parseInt(sizeMatch[1], 10) : 19
  const plMatch = sgf.match(/PL\[(B|W)\]/)
  const playerToMove: Player = plMatch && plMatch[1] === 'W' ? -1 : 1

  const board = GoBoard.fromDimensions(boardSize, boardSize)
  for (const v of extractStones(sgf, 'AB')) board.set(v, 1)
  for (const v of extractStones(sgf, 'AW')) board.set(v, -1)

  return { board, boardSize, playerToMove }
}

/** GTP 坐标（如 "E4"）-> [x, y]。用于核对正解。 */
export function gtpToVertex(coord: string, boardSize: number): Vertex | null {
  const letters = 'ABCDEFGHJKLMNOPQRST'
  const c = coord.trim().toUpperCase()
  if (c.length < 2) return null
  const x = letters.indexOf(c[0])
  const y = boardSize - parseInt(c.slice(1), 10)
  if (x < 0 || y < 0 || y >= boardSize) return null
  return [x, y]
}
