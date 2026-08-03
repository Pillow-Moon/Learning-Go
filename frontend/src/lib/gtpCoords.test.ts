/**
 * GTP 坐标转换回归测试：双端共享输入矩阵（shared/coordinate-cases.json），
 * 与后端 tests/test_coordinates.py 使用同一组用例。
 */
import { describe, expect, it } from 'vitest'
import cases from '@shared/coordinate-cases.json'

import { gtpToVertex, vertexToGtp } from './gtpCoords'

interface CoordCase {
  boardSize: number
  vertex: [number, number]
  gtp: string
}

describe('gtpCoords 共享矩阵往返', () => {
  it.each(cases.cases as CoordCase[])(
    '$boardSize 路 $gtp ↔ [$vertex.0, $vertex.1]',
    ({ boardSize, vertex, gtp }) => {
      // 内部 [x, y] → GTP（列跳过 I，行号从底部起）
      expect(vertexToGtp(vertex, boardSize)).toBe(gtp)
      // GTP → 内部 [x, y]
      expect(gtpToVertex(gtp, boardSize)).toEqual(vertex)
    },
  )
})

describe('gtpCoords 边界', () => {
  it('pass/resign/空串返回 null', () => {
    expect(gtpToVertex('pass', 19)).toBeNull()
    expect(gtpToVertex('resign', 19)).toBeNull()
    expect(gtpToVertex('', 19)).toBeNull()
  })

  it('I 列不存在：J 列的内部 x 为 8（19 路）', () => {
    expect(vertexToGtp([8, 0], 19)).toBe('J19')
    expect(gtpToVertex('J19', 19)).toEqual([8, 0])
  })

  it('底行 y=boardSize-1 对应行号 1', () => {
    expect(vertexToGtp([9, 18], 19)).toBe('K1')
  })
})
