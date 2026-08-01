/**
 * 从 KOGO 定式辞典（joseki-kogo-cn.sgf，中文版）提取定式数据，
 * 生成 src/data/josekiKogo.ts（供前端匹配器使用）。
 *
 * 用法：node scripts/extract-kogo.mjs
 * 来源：https://goodfrom-com.github.io/joseki-kogo-cn.sgf
 *   Kogo's Joseki Dictionary，飞扬围棋网 Greenhand 中文翻译。
 *
 * 处理逻辑：
 * 1. KOGO 使用「右上角」约定（SZ=19），先手黑占角。归一化到左上角：
 *    canonical = [18 - x, y]。
 * 2. 每个根节点到叶子的路径 = 一条完整定式变化线（黑先交替）。
 * 3. 节点 N 属性为变化名（如"小飞挂""尖"），拼成可读定式名。
 * 4. 只保留 ≥3 手的线（2 手以内的"定式"无意义）。
 *
 * 数据清洗（KOGO 的"脱先"编码处理）：
 * - pass 节点（着法为 tt，即 19 路棋盘外的 [19,19]）表示"脱先"，不产生着法；
 * - 部分脱先节点直接在序列中记录"脱先方去其他角落下的着法"（如 [15,15]），
 *   归一化后 u>11 或 v>11 的着法判定为"别处着法"，予以剔除——
 *   否则匹配器按角内窗口抽取对局着法时永远对不上这些坐标，会误报"偏离定式"。
 * - "白脱先/黑脱先/脱先"是状态说明而非着法名，不拼进定式名
 *   （否则会出现"星位 · 白脱先 · 星下"这类不像定式名的名字）。
 */
import pkg from '@sabaki/sgf'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const { parse } = pkg
const __dirname = dirname(fileURLToPath(import.meta.url))

const raw = readFileSync(join(__dirname, 'joseki-kogo-cn.sgf'), 'utf8')
const root = parse(raw)[0]

/** 顶层定式族名清理："星(3)" -> "星位"；"小目(2)" -> "小目" 等 */
const OPENING_NAMES = {
  三三: '三三',
  小目: '小目',
  星: '星位',
  目外: '目外',
  高目: '高目',
  三六: '三六（超目外）',
  四六: '四六（超高目）',
  五五: '五五',
}

/** 清理变化名："小飞挂 (a)" -> "小飞挂" */
function cleanName(n) {
  if (!n) return ''
  return String(n)
    .replace(/\s*\([a-z]\)\s*$/i, '')
    .replace(/[。．.]+$/, '')
    .trim()
}

/** KOGO 右上角坐标 (SZ=19) -> 左上角归一化坐标 */
const toCanonical = ([x, y]) => [18 - x, y]

/** 归一化后是否为本角着法（剔除脱先后"别处着法"；拆边等合法延伸可达 u/v=9~11） */
const inCorner = ([u, v]) => u <= 11 && v <= 11

/** SGF 坐标串 "dd" -> [x, y]；非法（如 pass "tt" 越界）返回 null */
function toXY(v) {
  const m = String(v).match(/^([a-z])([a-z])$/)
  if (!m) return null
  const x = m[1].charCodeAt(0) - 97
  const y = m[2].charCodeAt(0) - 97
  return x <= 18 && y <= 18 ? [x, y] : null
}

/** 收集某节点的所有叶子路径 */
function collect(node, moves, names, lines) {
  const b = node.data?.B?.[0]
  const w = node.data?.W?.[0]
  let move = null
  if (b || w) {
    const xy = toXY(b || w)
    const can = xy && toCanonical(xy)
    // pass(tt) 与"别处着法"均不进入定式序列
    if (can && inCorner(can)) move = can
  }
  const n = cleanName(node.data?.N?.[0])
  const nextMoves = move ? [...moves, move] : moves
  // "白脱先/黑脱先/白再脱先/白继续脱先"等是状态说明而非着法名，不拼进定式名
  const nextNames = n && !/脱先/.test(n) ? [...names, n] : names
  const kids = node.children || []
  if (kids.length === 0) {
    lines.push({ moves: nextMoves, names: nextNames })
  } else {
    for (const k of kids) collect(k, nextMoves, nextNames, lines)
  }
}

/** 生成 TS 内容（紧凑格式） */
const families = []
const seen = new Set()
for (const top of root.children || []) {
  const rawOpening = cleanName(top.data?.N?.[0])
  const openingBase = (rawOpening.match(/^([^\d(]+)/) || [rawOpening])[1].trim()
  const opening = OPENING_NAMES[openingBase] || openingBase

  // 顶层节点自身的着法（占角）作为序列第一手；其 N 是家族名，不拼进变化名
  const topMove = top.data?.B?.[0] || top.data?.W?.[0]
  const topXY = topMove ? toXY(topMove) : null
  const topCan = topXY && toCanonical(topXY)
  const baseMoves = topCan && inCorner(topCan) ? [topCan] : []

  const lines = []
  for (const k of top.children || []) collect(k, baseMoves, [], lines)
  if (lines.length === 0 && baseMoves.length > 0) {
    lines.push({ moves: baseMoves, names: [] })
  }

  const josekiLines = []
  for (const { moves, names } of lines) {
    if (moves.length < 3) continue
    const key = moves.map((m) => m.join(',')).join('|')
    if (seen.has(key)) continue
    seen.add(key)
    const name = [opening, ...names].filter(Boolean).join(' · ')
    josekiLines.push({ moves, name })
  }
  families.push({ opening, josekiLines })
}

const famTs = families
  .map(
    (f) =>
      `  {\n` +
      `    id: 'kogo-${f.opening}',\n` +
      `    name: ${JSON.stringify(f.opening)},\n` +
      `    tags: [${JSON.stringify(f.opening)}],\n` +
      `    source: 'KOGO 定式辞典',\n` +
      `    lines: [\n` +
      f.josekiLines
        .map(
          (l) =>
            `      { name: ${JSON.stringify(l.name)}, moves: [${l.moves.map((m) => `[${m[0]},${m[1]}]`).join(',')}], confidence: 'high' as const },`,
        )
        .join('\n') +
      `\n    ],\n` +
      `  }`,
  )
  .join(',\n')

const header = `/**
 * KOGO 定式辞典（中文版）定式数据。
 * 由 scripts/extract-kogo.mjs 自动生成，请勿手改；如需更新请重跑脚本。
 * 来源：https://goodfrom-com.github.io/joseki-kogo-cn.sgf
 *   Kogo's Joseki Dictionary，飞扬围棋网 Greenhand 翻译。
 * 坐标：左上角归一化坐标 [x, y]，黑先交替。
 */
import type { Joseki } from './joseki'

export const JOSEKI_KOGO: Joseki[] = [
${famTs},
]
`

const outPath = join(__dirname, '../src/data/josekiKogo.ts')
writeFileSync(outPath, header, 'utf8')

// ---- 统计 ----
const total = families.reduce((s, f) => s + f.josekiLines.length, 0)
console.log(`顶层定式族: ${families.length}，总变化线: ${total}`)
for (const f of families) {
  console.log(`  ${f.opening}: ${f.josekiLines.length} 条`)
}
console.log(`输出: ${outPath} (${(header.length / 1024).toFixed(1)} KB)`)

// ---- 抽样验证（前缀匹配）----
function hasPrefix(movesArr) {
  for (const f of families) {
    for (const l of f.josekiLines) {
      let ok = true
      for (let i = 0; i < movesArr.length; i++) {
        if (!l.moves[i] || l.moves[i][0] !== movesArr[i][0] || l.moves[i][1] !== movesArr[i][1]) {
          ok = false
          break
        }
      }
      if (ok) return l.name
    }
  }
  return null
}
console.log('--- 抽样验证（返回首个匹配线名）---')
for (const [label, seq] of [
  ['星位小飞挂小飞应', [[3, 3], [2, 5], [4, 4]]],
  ['星位点三三挡下', [[3, 3], [2, 2], [2, 3], [3, 2]]],
  ['星位小飞挂一间低夹', [[3, 3], [2, 5], [2, 7]]],
  ['小目小飞挂', [[2, 3], [4, 2]]],
]) {
  console.log(label + ':', hasPrefix(seq))
}
