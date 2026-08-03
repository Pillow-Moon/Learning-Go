/**
 * 本地引擎解说：基于 KataGo 分析数据（候选点/胜率/目差/定式识别）模板化生成中文棋评。
 * 完全离线、免费，不依赖 LLM；用于对弈解说与复盘当前手点评。
 */
import type { Candidate } from '../engines/types'
import type { Player } from './types'
import { vertexToCoord } from './boardUtils'

export interface LocalCommentaryInput {
  boardSize: number
  /** 下一手行棋方（仅用于行棋提示） */
  currentPlayer: Player
  /** 黑方胜率（引擎统一输出黑方视角，0~1） */
  rootWinrate: number | null
  /** 黑方目差（正 = 黑领先） */
  rootScoreLead: number | null
  /** 候选点（winrate/scoreLead 均为黑方视角） */
  candidates: Candidate[]
  /** 区域势力概览文本（3x3 分区黑白子数） */
  regionSummary: string
  /** 四角定型概览文本 */
  cornerSummary: string
  /** 定式识别概览文本 */
  josekiSummary: string
  /** 手数（已落子数） */
  moveCount: number
}

/** 生成棋评 Markdown 文本 */
export function generateLocalCommentary(input: LocalCommentaryInput): string {
  const parts: string[] = []
  const mover = input.currentPlayer === 1 ? '黑' : '白'

  // 1. 形势判断（rootWinrate/rootScoreLead 均为黑方视角：胜率=黑胜率、目差正=黑领先）
  if (input.rootWinrate != null) {
    const pct = (input.rootWinrate * 100).toFixed(1)
    const verdict =
      input.rootWinrate >= 0.75
        ? `形势十分有利`
        : input.rootWinrate >= 0.6
          ? `形势稍占优势`
          : input.rootWinrate <= 0.25
            ? `形势不利`
            : input.rootWinrate <= 0.4
              ? `形势略处下风`
              : `形势接近，胜负难料`
    parts.push(
      `**形势判断**：黑方胜率 **${pct}%**（${verdict}）。`,
    )
    if (input.rootScoreLead != null) {
      const lead = input.rootScoreLead
      parts.push(
        lead > 0
          ? `目数上黑方领先约 **${lead.toFixed(1)} 目**。`
          : lead < 0
            ? `目数上白方领先约 **${(-lead).toFixed(1)} 目**。`
            : `目数上双方基本持平。`,
      )
    }
  } else {
    parts.push(`**形势判断**：暂无胜率数据（先点击「分析局面」）。`)
  }

  // 2. 行棋提示（轮到谁走）
  parts.push(
    `**行棋提示**：轮到${mover}方落子${input.moveCount > 0 ? `（已下 ${input.moveCount} 手）` : '（开局）'}。`,
  )

  // 3. AI 推荐着法（榜首 + 变化图）
  if (input.candidates.length > 0) {
    const top = input.candidates[0]
    const topCoord = top.move ? vertexToCoord(top.move, input.boardSize) : '虚手'
    const topWin = top.winrate != null ? (top.winrate * 100).toFixed(1) : '—'
    const topLead = top.scoreLead != null ? `${top.scoreLead >= 0 ? '+' : ''}${top.scoreLead.toFixed(1)} 目` : '—'
    parts.push(
      `**AI 推荐**：第一候选 **${topCoord}**（胜率 ${topWin}%，目差 ${topLead}）。`,
    )
    if (top.pv.length > 0) {
      const pvText = top.pv
        .slice(0, Math.min(6, top.pv.length))
        .map((v, i) => `${i % 2 === 0 ? '黑' : '白'}${vertexToCoord(v, input.boardSize)}`)
        .join(' → ')
      parts.push(`变化图：**${pvText}**${top.pv.length > 6 ? ' …' : ''}`)
    }
  }

  // 4. 候选点列表
  if (input.candidates.length >= 2) {
    const list = input.candidates
      .slice(0, 5)
      .map((c, i) => {
        const coord = c.move ? vertexToCoord(c.move, input.boardSize) : '虚手'
        const win = c.winrate != null ? (c.winrate * 100).toFixed(1) : '—'
        const lead = c.scoreLead != null ? `${c.scoreLead >= 0 ? '+' : ''}${c.scoreLead.toFixed(1)}` : '—'
        return `${i + 1}. **${coord}** 胜率 ${win}% / 目差 ${lead}`
      })
      .join('\n')
    parts.push(`**候选点**：\n${list}`)
  }

  // 5. 定式识别（有命中时）
  const josekiLines = input.josekiSummary.trim()
  if (josekiLines && josekiLines !== '未识别到已收录定式' && !josekiLines.includes('无')) {
    parts.push(`**定式参考**：${josekiLines}`)
  }

  // 6. 角部定型
  const cornerLines = input.cornerSummary.trim()
  if (cornerLines && cornerLines !== '暂无' && cornerLines.includes('角')) {
    parts.push(`**角部概览**：${cornerLines}`)
  }

  // 7. 全局概览（区域子数对比）
  const regions = input.regionSummary.split('；')
  if (regions.length > 0) {
    const diff = regions
      .map((r) => {
        const m = r.match(/^(.+?) 黑(\d+) 白(\d+)$/)
        if (!m) return null
        const [, name, b, w] = m
        const bN = parseInt(b, 10)
        const wN = parseInt(w, 10)
        if (Math.abs(bN - wN) < 2) return null
        return `${name}${bN > wN ? '黑' : '白'}子多${Math.abs(bN - wN)}颗`
      })
      .filter((x): x is string => x != null)
    if (diff.length > 0) {
      parts.push(`**全局概览**：${diff.slice(0, 4).join('；')}。`)
    }
  }

  // 8. 落子节奏提示（中盘 vs 序盘/官子，用固定阈值粗判）
  if (input.moveCount <= 20) {
    parts.push(`**阶段提示**：当前处于序盘，重点在于抢占大场与建立根据地，AI 推荐点可作为布局方向参考。`)
  } else if (input.moveCount >= 200) {
    parts.push(`**阶段提示**：进入官子阶段，目数差距往往在此收窄，注意先手官子与劫材。`)
  } else if (input.moveCount >= 60 && input.moveCount < 200) {
    parts.push(`**阶段提示**：当前处于中盘战斗期，注意棋形薄弱处与双方势力的消长。`)
  }

  return parts.join('\n\n')
}
