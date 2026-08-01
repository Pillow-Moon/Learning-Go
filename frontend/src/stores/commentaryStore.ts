/**
 * AI 解说状态（Zustand + 浏览器直连 LLM）。
 * 从 settingsStore 取 provider 配置，通过 llmClient 流式调用。
 * 无 key 或调用失败时降级：仅展示 KataGo 原始数据。
 */
import { create } from 'zustand'

import { callLLMStream } from '../services/llmClient'
import { useSettingsStore } from './settingsStore'

/** 解说请求（由 CommentaryPanel 组装传入） */
interface CommentaryRequest {
  move_number: number
  player: 'black' | 'white'
  move: string | null
  board_size: number
  level: 'beginner' | 'intermediate' | 'advanced'
  candidates: { move: string | null; winrate: number | null; scoreLead: number | null; visits: number | null; pv: string[] }[]
  root_winrate: number | null
  root_score_lead: number | null
  /** 完整着法序列，如 "1.B Q16 2.W D4 3.B C3 ..." */
  move_history: string | null
  /** 当前棋盘真实棋子分布，如 "黑: Q16 D4 ...; 白: C3 ..."（LLM 以此为准，不再自行推断棋盘） */
  board_state: string | null
  /** 以本手落点为中心的局部棋盘图（约 9x9，@ = 本手落点） */
  local_board_state: string | null
  /** 区域势力概览：3x3 分区黑白子数统计（全局"势"的权威数据） */
  region_summary: string | null
  /** 四角定型概览：程序判定各角是否"定式/已定型"、是否有弱棋（局部定型的权威数据） */
  corner_summary: string | null
  /** 定式识别概览：程序把各角着法与定式库比对的结果（定式名称的权威数据） */
  joseki_summary: string | null
}

export interface CommentaryRecord {
  moveNumber: number
  text: string
}

interface CommentaryState {
  text: string
  streaming: boolean
  error: string | null
  history: CommentaryRecord[]
  currentMove: number | null

  request: (req: CommentaryRequest) => Promise<void>
  reset: () => void
}

/** 坐标 -> 方位描述（如 "C17" -> "左上角"，"K10" -> "中央"）。避免 LLM 自行解析坐标出错。 */
function coordToPosition(coord: string | null, size: number): string {
  if (!coord) return '虚手'
  const m = coord.match(/^([A-T])(\d+)$/)
  if (!m) return coord
  const x = 'ABCDEFGHJKLMNOPQRST'.indexOf(m[1])
  const y = size - Number(m[2]) // 行号越大越靠上
  const third = Math.floor(size / 3)
  const col = x < third ? '左' : x >= size - third ? '右' : '中'
  const row = y < third ? '上' : y >= size - third ? '下' : '中'
  if (col === '中' && row === '中') return '中央'
  if (col === '中') return `${row}边`
  if (row === '中') return `${col}边`
  return `${col}${row}角`
}

/** 根据解说请求组装 LLM 消息 */
function buildMessages(req: CommentaryRequest): { role: 'system' | 'user'; content: string }[] {
  const levelDesc: Record<string, string> = {
    beginner: '零基础初学者，请用最通俗的语言讲解，解释基本术语（如气、提子、眼），避免高深战略。',
    intermediate: '有一定基础的业余棋手，可以讲解常见定式、攻防要点和简单战略。',
    advanced: '业余高段棋手，可以深入讲解形势判断、大局观和复杂变化。',
  }

  const playerName = req.player === 'black' ? '黑' : '白'
  const opponentName = req.player === 'black' ? '白' : '黑'

  const topMoves = req.candidates
    .slice(0, 5)
    .map((c) => {
      const wr = c.winrate != null ? `${(c.winrate * 100).toFixed(1)}%` : '?'
      const sl = c.scoreLead != null ? `${c.scoreLead.toFixed(1)}目` : '?'
      const pos = coordToPosition(c.move, req.board_size)
      return `  ${c.move ?? 'pass'}（${pos}）: 胜率 ${wr}, 目差 ${sl}, 变化 ${c.pv.join(' ')}`
    })
    .join('\n')

  const system = `你是一位专业的围棋教练。${levelDesc[req.level]}
请为第 ${req.move_number} 手棋做教学解说。
注意：这手棋是「${playerName}方刚下的 ${req.move ?? '虚手'}」（落点方位：${coordToPosition(req.move, req.board_size)}），已经落在棋盘上了。
角色说明：${playerName}方是刚落下本手的一方（本手方）；黑白轮换，下一步由${opponentName}方落子（下一步行棋方）。
下面提供的候选选点是 KataGo 分析当前局面后，推荐给「下一步行棋方（${opponentName}方）」的走法，不是对这手棋的替代方案。每个候选点后括号内已标注其棋盘方位（如"左上角""右边""中央"），描述位置时直接使用这些方位，不要自行推断。
坐标纪律（硬性，违反即视为错误）：指认位置时**禁止自行推算坐标**——坐标换算极易出错（例如把右下角写成 Q5 却当作左下角、把中央说成天元）。需要指认落点时只能二选一：
A. 引用候选点列表中的坐标，并**直接照抄其后括号内程序已标注的方位**（候选点里写"Q5（右下角）"就表述为"右下角"），不得重新解读方位；
B. 只用方位词或模糊描述（如"左下角一带""抢占大场""向中央出头"），不出现任何坐标。
两方「建议」中的每个具体选点**必须来自候选点列表**，绝不给出候选点之外的坐标。
重要：user 消息中会提供五类信息，分工明确：
1. 「区域势力概览」：棋盘按 3x3 划分的九个区域，各区域黑白子数的统计（如"左上 黑2 白5"）。它只用于判断全局"势"的分布（谁在哪个方向子力多），**不代表局部是否定型**。
2. 「定式识别概览」：程序已把各角着法与定式库比对，标出识别到的定式名称（如"识别到 **星位定式**：点三三 · 退（已偏离）"）、进行中状态或"未匹配到已知定式"。**定式名称以此为准**：概览点明的定式，解说时必须使用该名称（"族名+定式"整体用 **加粗** 标记，客户端会渲染为加粗）、不得自行改叫其他定式；概览未点名的定式（库外变化），只能按"常见应对/新手变化"描述，或谨慎表述为"接近**某定式**的类似变化"，不得断言。定式状态一律用括号短词表述：（已完成）/（正在进行）/（已偏离）。概览中"攻防前提"（如"白点黑三三""白挂黑星位"）是程序判定的攻防方向，供你理解该角谁攻谁（谁点谁三三、谁挂谁），解说时**不必原样复述**"白点黑三三"这类术语，用自然语言表达（如"白棋点入黑角三三"）；概览无攻防前提时，不得自行断言攻防方向。
3. 「角部定型概览」：程序已判定四个角是否为"定式或常见应对（局部已定型）"、是否有弱棋。这是判断局部定型与否的**权威依据**，谈角部时必须以它为准（见下两条铁律）。
4. 「本手落点局部图」：以这手棋落点为中心约 9x9 的区域，@ 就是这手棋本身。描述攻防关系（紧贴、扳、夹击、牵制、压力等）时，**只依据局部图中实际可见的棋子**：只有当 @ 或候选点与对方棋子上下左右紧邻（正交相邻，斜对角不算）时，才可用"扳""贴""紧逼"这类接触性说法；不相邻时只能描述方向与作用（如"扩张上边模样""威胁左上角""占大场"）。局部图以外的棋子一律视为远处，不得声称与之"紧贴""相邻"或"夹击"。
5. 「当前棋盘 ASCII 图」：全盘 X=黑 O=白 .=空，数字标注候选点，作为补充参考，不得凭它臆造局部图中看不到的攻防关系。

定式与定型铁律：
- 若「定式识别概览」点名某角为某定式（如 **星位定式**：点三三），解说该角时必须用这个名称（"族名+定式"整体保持 **加粗**），并用括号短词说明其状态：（已完成）/（正在进行）/（已偏离）。若已完成，可简要说明其结果（如黑取外势、白取实地）；概览未给出的结果，不要自行断言。
- 若「角部定型概览」标注某角为"定式或常见应对（局部已定型，两分）"，那么该角的黑白交换是双方都能接受的正规下法。谈到这里时**禁止**用"势均力敌的争夺""虚""薄弱""孤单""压制与被压制"等措辞，应表述为"这是常见定式/定型交换，局部两分，双方各有所得"。
- 只有当「角部定型概览」标注某角"有弱棋"或"未定型"，或「定式识别概览」标注"未匹配到已知定式"时，才可谈该处的薄弱、攻防、纠缠或新手变化。
- 若本手落点所在角已被判定"已定型"，本手又是新落子，说明本手是定型后的后续（扩张、脱先、向中腹出头等），按这个角度解说，不要重复描述"该角尚未确定、双方在争夺"。
专业术语：解说应尽量使用围棋通用表述——先手便宜、扳头、生根、取势、守角、挂角、夹击、拆边、大场、急所、厚薄、实地、外势、模样、打入、侵消、脱先等，并解释清楚含义（入门档）或直接使用（进阶/高段档）。

解说必须把局部与全局结合起来：先讲这手棋在局部的作用，再讲它对全局"势"的影响（结合区域势力分布），并预测下一步。绝对不要臆想图上不存在的棋子，不要描述图上没有的边角或薄弱处。
解说步骤：1）先识别本手是否属于定式/常见应对（结合角部定型概览与着法序列）；2）根据区域势力概览判断全局形势，评价${playerName}方这手棋的意图和效果（局部+全局两方面）；3）统一给出「建议」：在建议块内把两方分开、各自独立成节——先给**下一步行棋方（${opponentName}方）**的选点建议（**每个选点必须从候选点列表里挑选**，直接用其程序标注的方位 + 一句话理由，如作用方向、针对对方哪部分棋），再单独给**本手方（${playerName}方）**一句改进建议（作为以后类似局面的参考，可用方位或模糊表述）。两节用加粗小标题区分（如 **${opponentName}方建议** / **${playerName}方建议**），内容不要混在一起写。
控制在 200 字以内，语气亲切自然。可以使用 Markdown 增强可读性（如 **加粗** 关键点、必要时用 \`-\` 列表），客户端会正常渲染 Markdown。`

  const user = `盘面：${req.board_size}路棋盘
区域势力概览（9 区黑/白子数，仅用于判断全局势力分布）：
${req.region_summary ?? '未知'}

角部定型概览（程序判定，局部定型与否以此为准）：
${req.corner_summary ?? '未知'}

定式识别概览（程序与定式库比对结果，定式名称以此为准）：
${req.joseki_summary ?? '未知'}

本手落点局部图（@ = 本手落点，X=黑 O=白 .=空；只此区域内可见的棋子才可能与这手棋发生攻防关系）：
${req.local_board_state ?? '未知'}

当前棋盘 ASCII 图（X=黑 O=白 .=空，数字=候选点；列从左到右为 A B C D E F G H J K L M N O P Q R S T，行从上到下为 ${req.board_size} 到 1）：
${req.board_state ?? '未知'}
着法序列：${req.move_history ?? '无'}
当前胜率：${req.root_winrate != null ? (req.root_winrate * 100).toFixed(1) + '%' : '未知'}
目差：${req.root_score_lead != null ? req.root_score_lead.toFixed(1) + '目' : '未知'}
KataGo 推荐「${opponentName}方」下一步候选（按数字标注顺序）：
${topMoves || '无数据'}`

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

/** 降级：仅展示 KataGo 数据 */
function fallbackText(req: CommentaryRequest): string {
  const top = req.candidates[0]
  if (!top) return '暂无分析数据。'
  const wr = top.winrate != null ? `${(top.winrate * 100).toFixed(1)}%` : '?'
  const sl = top.scoreLead != null ? `${top.scoreLead.toFixed(1)}目` : '?'
  return `[KataGo 分析] 推荐 ${top.move ?? 'pass'}，胜率 ${wr}，目差 ${sl}。\n变化：${top.pv.join(' ')}`
}

export const useCommentaryStore = create<CommentaryState>((set, get) => ({
  text: '',
  streaming: false,
  error: null,
  history: [],
  currentMove: null,

  request: async (req) => {
    if (get().streaming) return
    set({ streaming: true, error: null, text: '', currentMove: req.move_number })

    // 从设置中获取当前 provider
    const { providers, activeProviderId } = useSettingsStore.getState()
    const provider = providers.find((p) => p.id === activeProviderId)

    if (!provider || !provider.apiKey) {
      // 未配置 LLM：明确提示，降级展示 KataGo 数据
      const fallback = fallbackText(req)
      const reason = !provider
        ? '未启用任何 LLM 配置（请到设置页启用）。'
        : '当前 LLM 配置缺少 API Key。'
      set({ text: `[${reason}]\n${fallback}`, streaming: false, error: reason })
      return
    }

    try {
      const messages = buildMessages(req)
      let acc = ''
      const finalText = await callLLMStream(
        { baseURL: provider.baseURL, apiKey: provider.apiKey, model: provider.model },
        messages,
        (chunk) => {
          acc += chunk
          set({ text: acc })
        },
      )
      if (!finalText.trim()) {
        throw new Error('LLM 返回了空内容（API Key 或模型可能不可用）')
      }
      set((state) => ({
        streaming: false,
        history: [
          ...state.history,
          { moveNumber: req.move_number, text: finalText },
        ],
      }))
    } catch (err) {
      const fallback = fallbackText(req)
      if (!get().text) {
        set({ text: fallback })
      }
      set({
        streaming: false,
        error: err instanceof Error ? err.message : '解说生成失败',
      })
    }
  },

  reset: () => set({ text: '', error: null, streaming: false, currentMove: null }),
}))
