/**
 * BYOK LLM 调用层：OpenAI 兼容 /chat/completions 接口，直连用户配置的 baseURL。
 *
 * 职责边界：
 * - 只负责传输（fetch）与提示词模板；
 * - 密钥由 settingsStore 管理（localStorage），本模块通过参数接收，不触碰存储；
 * - 棋力判断完全来自 KataGo 客观统计，LLM 只做分类总结与训练建议（防瞎编棋理）。
 */
import type { DiagnosisType } from './diagnosis'
import type { DiagnosisStats } from './diagnosisStats'

export interface LLMConfig {
  apiKey: string
  baseURL: string
  model: string
}

export interface LLMMessage {
  role: 'system' | 'user'
  content: string
}

const DEFAULT_TIMEOUT_MS = 60_000

/** 归一化 baseURL：去尾部斜杠，确保以 /chat/completions 结尾 */
function chatUrl(baseURL: string): string {
  const base = baseURL.trim().replace(/\/+$/, '')
  return `${base}/chat/completions`
}

/**
 * 调用 OpenAI 兼容接口，返回模型正文。
 * 超时（默认 60s）、非 2xx、空返回均抛出中文错误。
 */
export async function callLLM(
  messages: LLMMessage[],
  cfg: LLMConfig,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(chatUrl(cfg.baseURL), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: cfg.model.trim(),
        messages,
        temperature: 0.4,
        max_tokens: 2000,
        stream: false,
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      const detail = body ? `：${body.slice(0, 200)}` : ''
      throw new Error(`LLM 请求失败（HTTP ${res.status}）${detail}`)
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    const content = data.choices?.[0]?.message?.content
    if (!content || content.trim() === '') {
      throw new Error('LLM 返回为空，请检查模型配置或余额')
    }
    return content
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`LLM 请求超时（${timeoutMs / 1000} 秒），请检查网络或更换模型`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

const TYPE_LABEL: Record<DiagnosisType, string> = {
  'life-death': '死活漏算',
  joseki: '定式与布局',
  direction: '选点与方向',
  endgame: '官子',
}

/** 测试连接：发送最小请求，成功返回 true */
export async function testLLMConnection(cfg: LLMConfig): Promise<boolean> {
  const reply = await callLLM(
    [
      { role: 'system', content: '只回复两个字：成功' },
      { role: 'user', content: '连通性测试' },
    ],
    cfg,
    30_000,
  )
  return reply.trim().length > 0
}

/**
 * 构造诊断报告提示词。
 * 输入只含 KataGo 聚合统计 + 用户等级；约束 LLM 不编造棋谱数据、
 * 以该等级可理解的语言输出 Markdown 三段式（诊断结论 / 问题解读 / 训练处方）。
 */
export function buildDiagnosisPrompt(stats: DiagnosisStats, userLevel: number): LLMMessage[] {
  const typeRows = (Object.keys(stats.byType) as DiagnosisType[])
    .map((t) => {
      const s = stats.byType[t]
      return `- ${TYPE_LABEL[t]}：${s.count} 手（平均损失 ${(s.avgLoss * 100).toFixed(1)}%，最大损失 ${(s.maxLoss * 100).toFixed(1)}%，占比 ${(s.share * 100).toFixed(0)}%）`
    })
    .join('\n')

  const gameRows = stats.perGame
    .slice(0, 10)
    .map(
      (g) =>
        `- 对局 ${g.gameId}（${new Date(g.createdAt).toLocaleDateString('zh-CN')}，${g.result ?? '未分胜负'}）：${g.issueCount} 个问题手`,
    )
    .join('\n')

  const topLabel = stats.topType ? TYPE_LABEL[stats.topType] : '无突出类型'

  const system =
    '你是一位资深的围棋教练，擅长辅导业余低段位（级位）自学者。' +
    '你只会基于用户提供的统计数据撰写报告，绝不编造棋谱内容或具体着法。' +
    '语言要求：通俗易懂，避免抽象棋理术语，尽量用"如果…就…"给出可执行动作。'

  const user = [
    `棋手水平：业余 ${userLevel} 级。`,
    `以下是最近 ${stats.gameCount} 盘对局经 KataGo（围棋 AI 引擎）逐手分析后的问题手统计。`,
    `「胜率损失」为黑方视角的胜率下降幅度；问题手 = 胜率损失 ≥3% 的着法。`,
    '',
    `错误类型分布：`,
    typeRows,
    '',
    `最高频问题类型：${topLabel}`,
    '',
    `各局概况：`,
    gameRows,
    '',
    `请输出 Markdown 格式的三段式诊断报告：`,
    `1. **诊断结论**：1~2 句话点明最主要的问题类型及原因（结合统计数字）；`,
    `2. **问题解读**：用该等级棋手能听懂的语言解释这类错误为什么发生、后果是什么；`,
    `3. **训练处方**：给出具体可执行的训练计划，包括：每日死活题难度区间与题量、`,
    `   需要复习的定式（如常见于该等级的对局，可提星位小飞挂角等基础定式）、打谱建议、复盘重点。`,
    '',
    `约束：只能引用上面给出的统计数字；不得虚构棋谱、棋手或胜负信息。`,
  ].join('\n')

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}
