/**
 * 棋局局面洞察：连通块、气数、角部定型判定。
 *
 * 用途：为 AI 解说提供程序化事实（权威数据），
 * 避免 LLM 仅凭 3x3 区域子数统计自行猜测"某处是否定式/是否安定"而出错。
 * 例如：左上角黑5白5且双方均安定 → 程序直接判定"定式或常见应对，局部已定型"。
 */

export interface Group {
  color: 1 | -1
  stones: [number, number][]
  liberties: number
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

/** 计算棋盘上所有同色连通块（正交相连），并统计每块的气数 */
export function getGroups(signMap: number[][], size: number): Group[] {
  const visited = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const groups: Group[] = []

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const color = signMap[y]?.[x] as 1 | -1 | undefined
      if (!color || visited[y][x]) continue

      const stones: [number, number][] = []
      const stack = [[x, y]]
      visited[y][x] = true
      const libertySet = new Set<string>()

      while (stack.length > 0) {
        const [cx, cy] = stack.pop()!
        stones.push([cx, cy])
        for (const [dx, dy] of DIRS) {
          const nx = cx + dx
          const ny = cy + dy
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue
          const s = signMap[ny]?.[nx]
          if (s === color && !visited[ny][nx]) {
            visited[ny][nx] = true
            stack.push([nx, ny])
          } else if (!s) {
            libertySet.add(`${nx},${ny}`)
          }
        }
      }
      groups.push({ color, stones, liberties: libertySet.size })
    }
  }
  return groups
}

interface Corner {
  name: string
  x0: number
  y0: number
}

/**
 * 生成四角定型概览（LLM 解说的权威依据之一）。
 *
 * 判定逻辑（保守启发式）：
 * - 角窗取棋盘前 1/3 范围（19 路为 0..5）。
 * - 一方"安定"：角内存在 ≥2 子且气数 ≥3 的棋块。
 * - 双方均进入且各自安定 → "定式或常见应对，局部已定型"。
 * - 弱棋：角内有气 ≤2 的棋块，或单子气 ≤3。
 */
export function buildCornerSummary(signMap: number[][], size: number): string {
  const third = Math.floor(size / 3)
  const corners: Corner[] = [
    { name: '左上', x0: 0, y0: 0 },
    { name: '右上', x0: size - third, y0: 0 },
    { name: '左下', x0: 0, y0: size - third },
    { name: '右下', x0: size - third, y0: size - third },
  ]
  const groups = getGroups(signMap, size)
  const parts: string[] = []

  for (const { name, x0, y0 } of corners) {
    let black = 0
    let white = 0
    const inWindow = new Set<string>()
    for (let y = y0; y < y0 + third; y++) {
      for (let x = x0; x < x0 + third; x++) {
        const s = signMap[y]?.[x]
        if (s === 1) black++
        else if (s === -1) white++
        if (s) inWindow.add(`${x},${y}`)
      }
    }

    const settled = (color: 1 | -1): boolean =>
      groups.some(
        (g) =>
          g.color === color &&
          g.stones.length >= 2 &&
          g.liberties >= 3 &&
          g.stones.some(([sx, sy]) => inWindow.has(`${sx},${sy}`)),
      )

    const bSettled = settled(1)
    const wSettled = settled(-1)
    const bothEntered = black >= 2 && white >= 2

    const hasWeak = groups.some(
      (g) =>
        g.stones.some(([sx, sy]) => inWindow.has(`${sx},${sy}`)) &&
        (g.liberties <= 2 || (g.stones.length === 1 && g.liberties <= 3)),
    )

    let desc: string
    if (bothEntered && bSettled && wSettled) {
      desc = '黑白均有多子且各自安定，属定式或常见应对（局部已定型，两分）'
    } else if (bothEntered) {
      desc = '黑白均进入但局部尚未完全定型' + (hasWeak ? '，存在弱棋' : '')
    } else if (black >= 2 && bSettled) {
      desc = '黑方已安顿守角，白方尚未进入'
    } else if (white >= 2 && wSettled) {
      desc = '白方已安顿占角，黑方尚未进入'
    } else if (black + white === 0) {
      desc = '尚无棋子'
    } else if (black + white <= 2) {
      desc = '单方一子占角（布局初期）'
    } else {
      desc = '黑白各有棋子，局势未定'
    }
    if (hasWeak && !desc.includes('弱棋')) {
      desc += '；有弱棋'
    }
    parts.push(`${name}角 黑${black}白${white}（${desc}）`)
  }
  return parts.join('；')
}
