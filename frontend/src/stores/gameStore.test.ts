/**
 * gameStore 规则引擎测试。
 * 覆盖阶段一验收要点：落子交替、提子、自杀禁着、打劫、终局、悔棋。
 */
import { beforeEach, describe, expect, it } from 'vitest'

import { useGameStore } from './gameStore'

/** 取当前状态 */
const s = () => useGameStore.getState()

beforeEach(() => {
  s().newGame({ size: 9 })
})

describe('基础落子', () => {
  it('黑先白后交替落子', () => {
    expect(s().currentPlayer).toBe(1)
    expect(s().playMove([4, 4])).toBe(true)
    expect(s().currentPlayer).toBe(-1)
    expect(s().playMove([2, 2])).toBe(true)
    expect(s().currentPlayer).toBe(1)
    expect(s().moves.length).toBe(2)
  })

  it('不能在已有棋子的位置落子', () => {
    s().playMove([4, 4])
    s().playMove([2, 2])
    // 轮到黑，[4,4] 已有黑子
    expect(s().playMove([4, 4])).toBe(false)
    expect(s().moves.length).toBe(2)
  })
})

describe('提子', () => {
  it('角部单子被提掉，提子数正确', () => {
    // 黑[1,0]，白[0,0]（角），黑[0,1] → 提掉白[0,0]
    expect(s().playMove([1, 0])).toBe(true) // 黑
    expect(s().playMove([0, 0])).toBe(true) // 白（角，气：[0,1]）
    expect(s().playMove([0, 1])).toBe(true) // 黑，紧最后一气
    expect(s().board.get([0, 0])).toBe(0) // 白子被提
    expect(s().board.getCaptures(1)).toBe(1) // 黑提 1 子
  })
})

describe('自杀禁着', () => {
  it('无气且不提子的落子被拒绝', () => {
    // 黑占 [1,0] 与 [0,1]，白下 [0,0] 是自杀
    s().playMove([1, 0]) // 黑
    s().playMove([8, 8]) // 白（他处）
    s().playMove([0, 1]) // 黑
    // 轮到白，[0,0] 是自杀点
    expect(s().playMove([0, 0])).toBe(false)
    expect(s().board.get([0, 0])).toBe(0)
  })
})

describe('打劫', () => {
  it('禁止立即回提（单劫）', () => {
    // 在棋盘中部构造一个单劫形状，黑[5,5] 提白[5,6] 后，白不能立即回提[5,6]
    s().playMove([4, 6]) // 1 黑
    s().playMove([5, 6]) // 2 白（将被提的子）
    s().playMove([6, 6]) // 3 黑
    s().playMove([4, 5]) // 4 白
    s().playMove([5, 7]) // 5 黑
    s().playMove([6, 5]) // 6 白
    s().playMove([8, 8]) // 7 黑（等待手）
    s().playMove([5, 4]) // 8 白
    // 9 黑[5,5] 提白[5,6]，形成劫
    expect(s().playMove([5, 5])).toBe(true)
    expect(s().board.get([5, 6])).toBe(0) // 白[5,6] 被提
    expect(s().board.getCaptures(1)).toBe(1)
    // 轮到白，立即回提 [5,6] 应被劫规则拒绝
    expect(s().currentPlayer).toBe(-1)
    expect(s().playMove([5, 6])).toBe(false)
  })
})

describe('终局与悔棋', () => {
  it('双方连续虚手结束对局', () => {
    s().playMove([4, 4])
    s().pass()
    expect(s().status).toBe('playing')
    s().pass()
    expect(s().status).toBe('finished')
  })

  it('悔棋恢复到上一手', () => {
    s().playMove([4, 4]) // 黑
    s().playMove([2, 2]) // 白
    expect(s().moves.length).toBe(2)
    s().undo()
    expect(s().moves.length).toBe(1)
    expect(s().board.get([2, 2])).toBe(0) // 白子已撤销
    expect(s().currentPlayer).toBe(-1) // 轮回白
    expect(s().lastMove).toEqual([4, 4])
  })

  it('resetToSetup 清空棋盘并回到 idle', () => {
    s().playMove([4, 4])
    s().playMove([2, 2])
    s().resign()
    expect(s().status).toBe('finished')
    expect(s().moves.length).toBe(2)

    s().resetToSetup()
    expect(s().status).toBe('idle')
    expect(s().moves.length).toBe(0)
    expect(s().history.length).toBe(0)
    expect(s().result).toBeNull()
    expect(s().boardSize).toBe(9) // 保留设置
    // 棋盘已清空
    let occupied = false
    for (let x = 0; x < s().boardSize; x++) {
      for (let y = 0; y < s().boardSize; y++) {
        if (s().board.get([x, y]) !== 0) occupied = true
      }
    }
    expect(occupied).toBe(false)
  })
})
