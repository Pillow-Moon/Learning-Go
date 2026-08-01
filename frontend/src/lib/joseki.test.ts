import { describe, expect, it } from 'vitest'

import { buildJosekiSummary, matchCornerJoseki, type PlayedMove } from './joseki'

describe('matchCornerJoseki（数据源：KOGO 定式辞典）', () => {
  const SIZE = 19

  it('左上角：星位小飞挂小飞应，命中星位族、3 手、进行中', () => {
    const seq: [number, number][] = [
      [3, 3], // 黑 星位
      [2, 5], // 白 小飞挂
      [4, 4], // 黑 小飞应
    ]
    const match = matchCornerJoseki(seq, '左上', SIZE)
    expect(match).not.toBeNull()
    expect(match!.joseki.name).toBe('星位')
    expect(match!.line.name.startsWith('星位 · 小飞挂')).toBe(true)
    expect(match!.matchedMoves).toBe(3)
    expect(match!.ongoing).toBe(true)
    expect(match!.complete).toBe(false)
  })

  it('右上角（镜像角）：星位小飞挂小飞应同样命中', () => {
    const seq: [number, number][] = [
      [15, 3],
      [16, 5],
      [14, 4],
    ]
    const match = matchCornerJoseki(seq, '右上', SIZE)
    expect(match?.joseki.name).toBe('星位')
    expect(match?.matchedMoves).toBe(3)
    expect(match?.corner).toBe('右上')
  })

  it('星位点三三：黑挡(2,3) 白爬(3,2)，4 手命中点三三变化', () => {
    const seq: [number, number][] = [
      [3, 3],
      [2, 2],
      [2, 3],
      [3, 2],
    ]
    const match = matchCornerJoseki(seq, '左上', SIZE)
    expect(match?.joseki.name).toBe('星位')
    expect(match?.line.name).toContain('点三三')
    expect(match?.matchedMoves).toBe(4)
  })

  it('点三三进行中：只下到前 2 手（星位+点三三）', () => {
    const seq: [number, number][] = [
      [3, 3],
      [2, 2],
    ]
    const match = matchCornerJoseki(seq, '左上', SIZE)
    expect(match?.joseki.name).toBe('星位')
    expect(match?.matchedMoves).toBe(2)
    expect(match?.ongoing).toBe(true)
  })

  it('偏离：黑星位白挂后黑走非标准应手（(5,0) 不可能出现在定式中）', () => {
    const seq: [number, number][] = [
      [3, 3],
      [2, 5],
      [5, 0],
    ]
    const match = matchCornerJoseki(seq, '左上', SIZE)
    expect(match?.matchedMoves).toBe(2)
    expect(match?.diverged).toBe(true)
  })

  it('转置对称：小目(3,2) 配挂(2,4) 尖(4,3)，命中"小目·小飞挂·尖"', () => {
    const seq: [number, number][] = [
      [3, 2], // 黑 小目（另一种朝向，经转置命中）
      [2, 4], // 白 小飞挂
      [4, 3], // 黑 尖
    ]
    const match = matchCornerJoseki(seq, '左上', SIZE)
    expect(match?.joseki.name).toBe('小目')
    expect(match?.line.name).toContain('小飞挂')
    expect(match?.matchedMoves).toBe(3)
  })

  it('角内只有单方棋子时不做定式匹配', () => {
    expect(matchCornerJoseki([[3, 3]], '左上', SIZE)).toBeNull()
  })
})

describe('buildJosekiSummary', () => {
  it('识别左上角定式并输出概览', () => {
    const moves: PlayedMove[] = [
      { color: 1, vertex: [3, 3] }, // 黑 左上星位
      { color: -1, vertex: [15, 15] }, // 白 右下方向（远角）
      { color: 1, vertex: [9, 9] }, // 黑 中央（脱先）
      { color: -1, vertex: [2, 5] }, // 白 小飞挂
      { color: 1, vertex: [4, 4] }, // 黑 小飞应
    ]
    const summary = buildJosekiSummary(moves, 19)
    expect(summary).toContain('左上角')
    expect(summary).toContain('星位')
    expect(summary).toContain('小飞挂')
  })

  it('黑白双方进入但无匹配：提示新手变化', () => {
    const moves: PlayedMove[] = [
      { color: 1, vertex: [3, 3] },
      { color: -1, vertex: [0, 3] }, // 一路着法，任何定式都不包含
      { color: 1, vertex: [1, 4] },
      { color: -1, vertex: [0, 5] },
    ]
    const summary = buildJosekiSummary(moves, 19)
    expect(summary).toContain('未匹配到已知定式')
  })

  it('点三三方向：黑星位、白点三三，输出"白点黑三三"', () => {
    const moves: PlayedMove[] = [
      { color: 1, vertex: [3, 3] }, // 黑 左上星位
      { color: -1, vertex: [2, 2] }, // 白 点三三
      { color: 1, vertex: [2, 3] }, // 黑 挡
      { color: -1, vertex: [3, 2] }, // 白 爬
    ]
    const summary = buildJosekiSummary(moves, 19)
    expect(summary).toContain('白点黑三三')
    expect(summary).toContain('**星位定式**')
  })

  it('点三三方向：白占角（黑先下别处）、黑点三三，输出"黑点白三三"', () => {
    const moves: PlayedMove[] = [
      { color: 1, vertex: [15, 15] }, // 黑 右下（远角，先下别处）
      { color: -1, vertex: [3, 3] }, // 白 左上星位
      { color: 1, vertex: [2, 2] }, // 黑 点白三三
      { color: -1, vertex: [2, 3] }, // 白 挡
      { color: 1, vertex: [3, 2] }, // 黑 爬
    ]
    const summary = buildJosekiSummary(moves, 19)
    expect(summary).toContain('黑点白三三')
  })

  it('挂角方向：黑星位、白小飞挂，输出"白挂黑星位"', () => {
    const moves: PlayedMove[] = [
      { color: 1, vertex: [3, 3] }, // 黑 左上星位
      { color: -1, vertex: [2, 5] }, // 白 小飞挂
      { color: 1, vertex: [4, 4] }, // 黑 小飞应
    ]
    const summary = buildJosekiSummary(moves, 19)
    expect(summary).toContain('白挂黑星位')
  })

  it('托方向：黑小目、白一间高挂、黑托，输出"白挂黑小目、黑托白"', () => {
    const moves: PlayedMove[] = [
      { color: 1, vertex: [2, 3] }, // 黑 小目
      { color: -1, vertex: [4, 3] }, // 白 一间高挂
      { color: 1, vertex: [4, 2] }, // 黑 托
    ]
    const summary = buildJosekiSummary(moves, 19)
    expect(summary).toContain('白挂黑小目')
    expect(summary).toContain('黑托白')
  })

  it('空盘输出占位文本', () => {
    expect(buildJosekiSummary([], 19)).toContain('暂无可识别的定式')
  })
})
