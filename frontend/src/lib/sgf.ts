/**
 * SGF 工具：完整解析（着法序列/贴目/让子/结果）与序列化导出。
 * 基于 @sabaki/sgf（tokenize/parse/stringify），局面重建交给 @sabaki/go-board。
 */
import {
  parse,
  stringify,
  parseVertex,
  stringifyVertex,
  parseCompressedVertices,
} from '@sabaki/sgf'
import type { SgfNode } from '@sabaki/sgf'

import type { Move, BoardSize, Vertex } from './types'

/** 解析出的棋谱数据 */
export interface SgfGame {
  boardSize: BoardSize
  komi: number
  /** 让子数（HA） */
  handicap: number
  result: string | null
  gameName: string | null
  /** 主变着法序列（不含让子） */
  moves: Move[]
  /** 让子摆位（黑，来自根节点 AB） */
  handicapStones: Vertex[]
}

/** 序列化入参 */
export interface SgfGameMeta {
  boardSize: BoardSize
  komi: number
  result?: string | null
  gameName?: string | null
  /** 实战着法序列 */
  moves: Move[]
  /** 让子摆位（黑，仅导出用，一般由 handicap 推得） */
  handicapStones?: Vertex[]
}

/** 顶点 -> SGF 坐标（如 [3,3] -> 'dd'） */
export function vertexToSgf(v: Vertex): string {
  return stringifyVertex([v[0], v[1]])
}

/**
 * 解析 SGF 文本为棋谱数据（取第一个根节点的主变）。
 * 解析失败返回 null。
 */
export function parseSgfGame(sgfText: string): SgfGame | null {
  let roots: SgfNode[]
  try {
    roots = parse(sgfText)
  } catch {
    return null
  }
  if (roots.length === 0) return null

  const root = roots[0]
  const d = root.data
  const sizeRaw = parseInt(d.SZ?.[0] ?? '19', 10)
  if (sizeRaw !== 9 && sizeRaw !== 13 && sizeRaw !== 19) return null
  const boardSize = sizeRaw as BoardSize
  const komi = d.KM?.[0] != null && !Number.isNaN(parseFloat(d.KM[0])) ? parseFloat(d.KM[0]) : 7.5
  const handicap = parseInt(d.HA?.[0] ?? '0', 10) || 0
  const result = d.RE?.[0] ?? null
  const gameName = d.GN?.[0] ?? null

  // 根节点摆子（让子 AB；AW 罕见，一并收集为黑方让子外的附加子不处理）
  const handicapStones: Vertex[] = []
  for (const ab of d.AB ?? []) {
    const vs = ab.includes(':') ? parseCompressedVertices(ab) : [parseVertex(ab)]
    for (const v of vs) {
      if (v[0] >= 0 && v[1] >= 0) handicapStones.push(v as Vertex)
    }
  }

  // 主变着法
  const moves: Move[] = []
  let node = root
  let n = 0
  while (node.children.length > 0) {
    node = node.children[0]
    const data = node.data
    if (data.B && data.B.length > 0) {
      const v = parseVertex(data.B[0])
      const pass = v[0] < 0 || v[1] < 0
      moves.push({ n: ++n, color: 1, vertex: pass ? null : (v as Vertex), pass })
    } else if (data.W && data.W.length > 0) {
      const v = parseVertex(data.W[0])
      const pass = v[0] < 0 || v[1] < 0
      moves.push({ n: ++n, color: -1, vertex: pass ? null : (v as Vertex), pass })
    }
  }

  return { boardSize, komi, handicap, result, gameName, moves, handicapStones }
}

/** 中文对局结果 -> SGF RE 标准值（B+/W+）；无法映射时原样输出 */
function resultToSgf(result: string | null): string | null {
  if (!result) return null
  if (result.includes('中盘胜')) return result.startsWith('白') ? 'W+R' : 'B+R'
  if (result.includes('双方虚手') || result.includes('和棋')) return 'Draw'
  if (result.startsWith('黑')) return 'B+'
  if (result.startsWith('白')) return 'W+'
  return result
}

/** SGF RE 值 -> 中文结果（用于复盘页展示） */
export function sgfResultToText(re: string | null): string | null {
  if (!re) return null
  const m = re.match(/^([BW])\+(.*)$/)
  if (!m) return re
  const winner = m[1] === 'B' ? '黑' : '白'
  const detail = m[2]
  if (detail === 'R' || detail === 'Resign') return `${winner}中盘胜`
  if (detail === 'T' || detail === 'Time') return `${winner}超时胜`
  if (detail) return `${winner}胜 ${detail}`
  return `${winner}胜`
}

/**
 * 序列化棋谱为 SGF 文本。
 * 根节点含 GM/FF/CA/AP/SZ/KM/HA/RE/GN 与让子 AB，主变为 B/W 序列。
 */
export function movesToSgf(meta: SgfGameMeta): string {
  const rootData: Record<string, string[]> = {
    GM: ['1'],
    FF: ['4'],
    CA: ['UTF-8'],
    AP: ['Learning-Go'],
    SZ: [String(meta.boardSize)],
    KM: [String(meta.komi)],
  }
  const stones = meta.handicapStones ?? []
  if (stones.length > 0) {
    rootData.HA = [String(stones.length)]
    rootData.AB = stones.map((v) => stringifyVertex([v[0], v[1]]))
  }
  const re = resultToSgf(meta.result ?? null)
  if (re) rootData.RE = [re]
  if (meta.gameName) rootData.GN = [meta.gameName]

  const root: SgfNode = { id: 0, data: rootData, parentId: null, children: [] }
  let cur = root
  meta.moves.forEach((m, i) => {
    const prop = m.color === 1 ? 'B' : 'W'
    const val =
      m.pass || m.vertex == null
        ? ''
        : stringifyVertex([m.vertex[0], m.vertex[1]])
    const node: SgfNode = {
      id: i + 1,
      data: { [prop]: [val] },
      parentId: cur.id,
      children: [],
    }
    cur.children = [node]
    cur = node
  })
  return stringify([root])
}

/**
 * 标准让子摆位（黑），按传统顺序返回前 n 个星位/天元。
 * 支持 9/13/19 路；n 超出可用位置时返回全部可用位置。
 */
export function getHandicapPoints(size: BoardSize, n: number): Vertex[] {
  // 各尺寸星位（x, y 顶点坐标，左上角为原点）：
  // 19 路星位在 (3,3)/(15,3)/(3,15)/(15,15)，边星 (9,3) 等，天元 (9,9)
  // 9 路星位在 (2,2)/(6,2)/(2,6)/(6,6)，天元 (4,4)
  // 13 路星位在 (3,3)/(9,3)/(3,9)/(9,9)，天元 (6,6)
  const corner = size === 9 ? 2 : 3
  const edge = Math.floor((size - 1) / 2) // 9路=4, 13路=6, 19路=9
  const last = size - 1 - corner
  // 传统顺序：右上、左下、右下、左上 → 四角；然后左边、右边、上边、下边 → 四边；最后天元
  const points: Vertex[] = [
    [last, corner], // 右上
    [corner, last], // 左下
    [last, last], // 右下
    [corner, corner], // 左上
    [corner, edge], // 左边
    [last, edge], // 右边
    [edge, corner], // 上边
    [edge, last], // 下边
    [edge, edge], // 天元
  ]
  return points.slice(0, Math.min(n, points.length))
}
