/**
 * 定式匹配器：把对局着法与定式库比对，识别"正在下/已完成/偏离"哪个定式。
 *
 * 原理：
 * 1. 定式库序列记录为「左上角归一化坐标」（黑先交替），数据源为 KOGO 定式辞典。
 * 2. 对局中同一角落的着法按着法顺序抽出，经 8 种对称变换
 *    （4 个角映射 × 转置）归一化到左上角坐标系。
 * 3. 与定式库各变化线做最长公共前缀匹配，返回最佳结果。
 *
 * 用途：AI 解说的权威"定式识别"依据；后续课程、定式练习可复用同一匹配器。
 */
import { JOSEKI_KOGO } from '../data/josekiKogo'
import type { Joseki, JosekiLine } from '../data/joseki'

export type CornerName = '左上' | '右上' | '左下' | '右下'

/** 单一定式匹配结果 */
export interface JosekiMatch {
  joseki: Joseki
  line: JosekiLine
  corner: CornerName
  /** 命中的着法数（最长公共前缀长度） */
  matchedMoves: number
  /** 定式总着数（line.moves.length） */
  totalMoves: number
  /** 已完整走完定式 */
  complete: boolean
  /** 仍在定式主变化中（尚无冲突着法） */
  ongoing: boolean
  /** 从第 matchedMoves+1 手起偏离该定式 */
  diverged: boolean
}

/** 对局着法的最小形态（供匹配使用） */
export interface PlayedMove {
  color: number
  vertex: [number, number] | null
}

type Transform = (m: [number, number], n: number) => [number, number]

/** 4 个角到左上角归一化坐标的映射（覆盖旋转） */
const CORNER_TRANSFORMS: { name: CornerName; t: Transform }[] = [
  { name: '左上', t: ([x, y]) => [x, y] },
  { name: '右上', t: ([x, y], n) => [n - 1 - x, y] },
  { name: '左下', t: ([x, y], n) => [x, n - 1 - y] },
  { name: '右下', t: ([x, y], n) => [n - 1 - x, n - 1 - y] },
]

/** 转置（x↔y）：覆盖镜像，与角映射组合成完整的 8 种对称 */
const transpose = ([x, y]: [number, number]): [number, number] => [y, x]

/** 各尺寸棋盘的角落窗口半径（覆盖常见定式的落点范围，且四角互不重叠） */
function cornerWindow(size: number): number {
  if (size >= 19) return 9
  if (size >= 13) return 6
  return 4
}

/** 逆变换：把归一化坐标还原为某个角的实际坐标（供后续练习模式使用） */
export function unmapCornerVertex(
  canonical: [number, number],
  corner: CornerName,
  size: number,
): [number, number] {
  const [u, v] = canonical
  const w = size - 1
  switch (corner) {
    case '左上':
      return [u, v]
    case '右上':
      return [w - u, v]
    case '左下':
      return [u, w - v]
    case '右下':
      return [w - u, w - v]
  }
}

/** 计算两个序列的最长公共前缀长度 */
function longestCommonPrefix(a: [number, number][], b: [number, number][]): number {
  let i = 0
  while (i < a.length && i < b.length && a[i][0] === b[i][0] && a[i][1] === b[i][1]) i++
  return i
}

/** 判断 [x, y] 是否落在指定角的窗口内（先经角映射到归一化坐标） */
function inCornerWindow(
  m: [number, number],
  corner: CornerName,
  size: number,
): boolean {
  const w = cornerWindow(size)
  const [u, v] = CORNER_TRANSFORMS.find((c) => c.name === corner)!.t(m, size)
  return u < w && v < w
}

/** 单个角的最佳定式匹配（无匹配返回 null） */
export function matchCornerJoseki(
  cornerMoves: [number, number][],
  corner: CornerName,
  size: number,
): JosekiMatch | null {
  const w = cornerWindow(size)
  const t = CORNER_TRANSFORMS.find((c) => c.name === corner)!.t
  // 归一化到左上角坐标系
  const canonical = cornerMoves
    .map((m) => t(m, size))
    .filter(([u, v]) => u < w && v < w)

  // 归一化后不足 2 手（黑+白各一手）不可能构成定式
  if (canonical.length < 2) return null

  const variants: [number, number][][] = [canonical, canonical.map(transpose)]

  let best: JosekiMatch | null = null
  for (const seq of variants) {
    for (const joseki of JOSEKI_KOGO) {
      for (const line of joseki.lines) {
        // 库线与对局在同一角窗口下比较：过滤窗口外着法
        // （拆边等末端延伸，对局侧 extractCornerMoves 也不会抽取它们）
        const lineCanonical = line.moves.filter(([u, v]) => u < w && v < w)
        if (lineCanonical.length < 2) continue
        const lcp = longestCommonPrefix(seq, lineCanonical)
        if (lcp < 2) continue
        const match: JosekiMatch = {
          joseki,
          line,
          corner,
          matchedMoves: lcp,
          totalMoves: lineCanonical.length,
          complete: lcp === lineCanonical.length,
          ongoing: lcp === seq.length && lcp < lineCanonical.length,
          diverged: lcp < seq.length,
        }
        // 择优：命中越长越优；同长优先完整走完；再按库中顺序
        if (
          !best ||
          match.matchedMoves > best.matchedMoves ||
          (match.matchedMoves === best.matchedMoves && match.complete && !best.complete)
        ) {
          best = match
        }
      }
    }
  }
  return best
}

/** 从整盘着法中抽出某角内、按着法顺序排列的坐标序列 */
export function extractCornerMoves(
  moves: PlayedMove[],
  corner: CornerName,
  size: number,
): { sequence: [number, number][]; black: number; white: number } {
  const sequence: [number, number][] = []
  let black = 0
  let white = 0
  for (const m of moves) {
    if (!m.vertex) continue
    if (!inCornerWindow(m.vertex, corner, size)) continue
    sequence.push(m.vertex)
    if (m.color === 1) black++
    else white++
  }
  return { sequence, black, white }
}

/**
 * 生成全盘「定式识别概览」（AI 解说的权威依据）。
 * 只报告有意义的信息：已识别定式 / 正在走某定式 / 偏离常见定式 / 双方进入但无匹配。
 * 定式名可能很长（KOGO 变化链），概览中截取前 4 段保持紧凑。
 */
function shortName(name: string): string {
  const segs = name.split(' · ').slice(0, 4)
  return segs.length < name.split(' · ').length ? `${segs.join(' · ')}…` : segs.join(' · ')
}

/**
 * 定式名展示格式：大类（族名）+「定式」整体加粗，冒号引出变化段，如
 * "星位 · 小飞挂 · 小飞应" -> "**星位定式**：小飞挂 · 小飞应"。
 * 客户端渲染 Markdown，故加粗可正常显示。
 */
function displayName(name: string): string {
  const segs = name.split(' · ')
  const family = segs[0]
  const rest = segs.slice(1)
  return rest.length ? `**${family}定式**：${shortName(rest.join(' · '))}` : `**${family}定式**`
}

/**
 * 推导定式攻防关系的方向（谁对谁做了什么），如"白点黑三三""白挂黑星位""黑托白"。
 * 依据：角内着法序列的颜色与落点位置——
 * - 占角方 = 该角第一手颜色；
 * - 点三三/点角：异色着法落在角内三三小三角（归一化 u,v≤3）；
 * - 挂角：异色着法落在角外侧（u>3 或 v>3，且在 6 线内），即对方逼近角部；
 * - 托：异色着法紧贴角内任意对方子（曼哈顿距离 1）。
 * 按线名中的关键词门控（只对含"点三三/点角/挂/托"的定式线触发），避免误判。
 */
function attackDirection(
  moves: PlayedMove[],
  corner: CornerName,
  size: number,
  lineName: string,
): string | null {
  const t = CORNER_TRANSFORMS.find((c) => c.name === corner)!.t
  const w = cornerWindow(size)
  const inCorner: { color: number; u: number; v: number }[] = []
  for (const m of moves) {
    if (!m.vertex) continue
    const [u, v] = t(m.vertex, size)
    if (u < w && v < w) inCorner.push({ color: m.color, u, v })
  }
  if (inCorner.length < 2) return null

  const occupier = inCorner[0].color // 占角方（该角第一手）
  const [ou, ov] = [inCorner[0].u, inCorner[0].v]
  const family = lineName.split(' · ')[0]
  const parts: string[] = []

  // 点三三/点角
  if (/点三三|点角/.test(lineName)) {
    for (const m of inCorner) {
      if (m.color === occupier || (m.u === ou && m.v === ov)) continue
      if (m.u <= 3 && m.v <= 3) {
        parts.push(m.color === 1 ? '黑点白三三' : '白点黑三三')
        break
      }
    }
  }

  // 挂角
  if (/挂/.test(lineName)) {
    for (const m of inCorner) {
      if (m.color === occupier || (m.u === ou && m.v === ov)) continue
      if ((m.u > 3 || m.v > 3) && m.u <= 6 && m.v <= 6) {
        parts.push(`${m.color === 1 ? '黑' : '白'}挂${occupier === 1 ? '黑' : '白'}${family}`)
        break
      }
    }
  }

  // 托：主动贴着"已有的"对方子落子（曼哈顿距离 1），该着法方为托方。
  // 只与落子之前的着法比较，避免把后续贴上的棋子（如挡/扳）反向判为托。
  if (/托/.test(lineName)) {
    for (let i = 0; i < inCorner.length; i++) {
      const m = inCorner[i]
      const touching = inCorner
        .slice(0, i)
        .some((p) => p.color !== m.color && Math.abs(p.u - m.u) + Math.abs(p.v - m.v) === 1)
      if (touching) {
        parts.push(m.color === 1 ? '黑托白' : '白托黑')
        break
      }
    }
  }

  return parts.length ? parts.join('、') : null
}

export function buildJosekiSummary(
  moves: PlayedMove[],
  size: number,
): string {
  const parts: string[] = []
  for (const { name: cornerName } of CORNER_TRANSFORMS) {
    const { sequence, black, white } = extractCornerMoves(moves, cornerName, size)
    const total = black + white
    if (total < 2) continue // 角内着法太少，没有可说的

    const match = matchCornerJoseki(sequence, cornerName, size)

    if (match) {
      const name = displayName(match.line.name)
      // 攻防方向（谁点谁三三/谁挂谁/谁托谁）作为 LLM 推理前提，不作为解说用语
      const direction = attackDirection(moves, cornerName, size, match.line.name)
      const state = match.complete ? '已完成' : match.ongoing ? '正在进行' : '已偏离'
      const base = `${cornerName}角：识别到${name}（${state}）`
      parts.push(direction ? `${base}；攻防前提：${direction}` : base)
    } else if (black >= 2 && white >= 2) {
      parts.push(`${cornerName}角：黑白双方均有 2 子以上落子，但未匹配到已知定式（可能是新手变化）`)
    }
  }
  return parts.join('；') || '（暂无可识别的定式）'
}
