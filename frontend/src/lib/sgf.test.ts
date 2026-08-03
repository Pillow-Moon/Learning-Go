/**
 * SGF 工具测试：序列化/解析往返一致性、让子、pass、结果映射。
 */
import { describe, expect, it } from 'vitest'

import {
  getHandicapPoints,
  movesToSgf,
  parseSgfGame,
  sgfResultToText,
} from './sgf'
import type { Move } from './types'

function moves(seq: [1 | -1, [number, number] | null][]): Move[] {
  return seq.map(([color, vertex], i) => ({
    n: i + 1,
    color,
    vertex,
    pass: vertex == null,
  }))
}

describe('movesToSgf / parseSgfGame 往返', () => {
  it('普通对局：着法/尺寸/贴目/结果完整往返', () => {
    const ms = moves([
      [1, [3, 3]],
      [-1, [15, 3]],
      [1, [3, 15]],
      [-1, [15, 15]],
    ])
    const sgf = movesToSgf({
      boardSize: 19,
      komi: 7.5,
      result: '黑中盘胜',
      moves: ms,
      gameName: '测试对局',
    })
    const game = parseSgfGame(sgf)
    expect(game).not.toBeNull()
    expect(game!.boardSize).toBe(19)
    expect(game!.komi).toBe(7.5)
    expect(game!.result).toBe('B+R')
    expect(game!.gameName).toBe('测试对局')
    expect(game!.moves).toEqual(ms)
    expect(game!.handicap).toBe(0)
  })

  it('虚手（pass）序列化与解析', () => {
    const ms = moves([
      [1, [3, 3]],
      [-1, null],
      [1, null],
    ])
    const sgf = movesToSgf({ boardSize: 9, komi: 7.5, moves: ms })
    const game = parseSgfGame(sgf)
    expect(game!.moves).toEqual(ms)
    expect(game!.moves[1].pass).toBe(true)
    expect(game!.moves[1].vertex).toBeNull()
  })

  it('让子：HA + AB 往返', () => {
    const stones = getHandicapPoints(19, 3)
    expect(stones).toEqual([
      [15, 3],
      [3, 15],
      [15, 15],
    ])
    const ms = moves([[-1, [3, 3]], [1, [15, 3]]]) // 让子后白先
    const sgf = movesToSgf({ boardSize: 19, komi: 0.5, moves: ms, handicapStones: stones })
    const game = parseSgfGame(sgf)
    expect(game!.handicap).toBe(3)
    expect(game!.handicapStones).toEqual(stones)
    expect(game!.moves[0].color).toBe(-1)
  })

  it('9/13/19 路让子点按比例定位', () => {
    expect(getHandicapPoints(9, 2)).toEqual([
      [6, 2],
      [2, 6],
    ])
    expect(getHandicapPoints(13, 4)).toEqual([
      [9, 3],
      [3, 9],
      [9, 9],
      [3, 3],
    ])
    expect(getHandicapPoints(19, 9)).toHaveLength(9)
    expect(getHandicapPoints(9, 9)).toHaveLength(9)
  })

  it('标准 SGF 文本可直接解析（Kogo 定式库格式）', () => {
    const sgf = '(;GM[1]FF[4]CA[UTF-8]SZ[19]KM[7.5]PB[KataGo]PW[KataGo]RE[B+1.5];B[pd];W[dp];B[pp])'
    const game = parseSgfGame(sgf)
    expect(game).not.toBeNull()
    expect(game!.moves).toHaveLength(3)
    expect(game!.moves[0].vertex).toEqual([15, 3]) // pd -> 列 p(15) 行 d(3)
    expect(game!.result).toBe('B+1.5')
  })

  it('非法 SGF 返回 null', () => {
    expect(parseSgfGame('这不是 SGF')).toBeNull()
    expect(parseSgfGame('(;SZ[25])')).toBeNull() // 不支持的尺寸
  })
})

describe('sgfResultToText', () => {
  it('标准 RE 转中文', () => {
    expect(sgfResultToText('B+R')).toBe('黑中盘胜')
    expect(sgfResultToText('W+3.5')).toBe('白胜 3.5')
    expect(sgfResultToText('W+T')).toBe('白超时胜')
    expect(sgfResultToText('Draw')).toBe('Draw')
  })
})
