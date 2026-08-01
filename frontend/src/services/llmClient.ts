/**
 * 统一 OpenAI 兼容 LLM 调用层。
 *
 * 支持流式 fetch + SSE 解析 + CORS 探测。
 * 所有调用直接从浏览器发起（BYOK 模式）。
 */

export interface LLMConfig {
  baseURL: string
  apiKey: string
  model: string
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** 构造请求体：DeepSeek V4 默认思考模式会吞掉 content，需显式关闭 */
function buildBody(
  config: LLMConfig,
  messages: ChatMessage[],
  stream: boolean,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    stream,
    temperature: 0.7,
    max_tokens: 1000,
  }
  if (config.baseURL.includes('deepseek.com')) {
    body.thinking = { type: 'disabled' }
  }
  return body
}

/**
 * 流式调用 LLM（SSE）。
 * onChunk 每收到一个 token 调用一次。
 * 返回完整文本。
 *
 * 若流式请求成功但解析不到任何内容（部分兼容端点的 SSE 实现不标准），
 * 自动降级为非流式请求重试，避免静默返回空。
 */
export async function callLLMStream(
  config: LLMConfig,
  messages: ChatMessage[],
  onChunk: (text: string) => void,
): Promise<string> {
  const url = `${config.baseURL}/chat/completions`

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(buildBody(config, messages, true)),
  })

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '')
    throw new Error(`LLM 请求失败 (${resp.status}): ${errText.slice(0, 200)}`)
  }

  const fullText = await parseSSE(resp, onChunk)

  // 流式解析为空 → 非流式重试（部分端点的 SSE 不标准）
  if (!fullText.trim()) {
    return callLLMOnce(config, messages, onChunk)
  }

  return fullText
}

/** 解析 SSE 响应流，返回累积文本 */
async function parseSSE(
  resp: Response,
  onChunk: (text: string) => void,
): Promise<string> {
  const reader = resp.body?.getReader()
  if (!reader) return ''

  const decoder = new TextDecoder()
  let fullText = ''
  let buffer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data:')) continue
        const data = trimmed.slice(5).trim()
        if (data === '[DONE]') continue

        try {
          const json = JSON.parse(data)
          const delta = json.choices?.[0]?.delta?.content
          if (delta) {
            fullText += delta
            onChunk(delta)
          }
        } catch {
          // 跳过无法解析的行
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  return fullText
}

/** 非流式单次调用（流式降级用） */
async function callLLMOnce(
  config: LLMConfig,
  messages: ChatMessage[],
  onChunk: (text: string) => void,
): Promise<string> {
  const resp = await fetch(`${config.baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(buildBody(config, messages, false)),
  })

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '')
    throw new Error(`LLM 请求失败 (${resp.status}): ${errText.slice(0, 200)}`)
  }

  const json = await resp.json().catch(() => null)
  const content: string = json?.choices?.[0]?.message?.content ?? ''
  if (content) onChunk(content)
  return content
}

/**
 * 连通性测试：发送一个最小 POST 请求，验证 CORS 与 API key。
 *
 * 注意：不用 OPTIONS 预检做前置判断——部分服务商不处理预检请求
 * （浏览器层直接 ERR_ABORTED），但真实 POST 完全可用。
 * 以真实 POST 的结果为准：
 *  - 能收到响应（任何状态码）→ CORS 已通，再按状态码判断 key/模型
 *  - fetch 抛错（Failed to fetch）→ CORS 拦截或网络不可达
 */
export async function testConnection(config: LLMConfig): Promise<{
  ok: boolean
  error?: string
  corsOk: boolean
}> {
  try {
    const resp = await fetch(`${config.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 5,
        stream: false,
        // DeepSeek V4 默认思考模式，关闭避免内容被思维链吞掉
        ...(config.baseURL.includes('deepseek.com')
          ? { thinking: { type: 'disabled' } }
          : {}),
      }),
    })

    // 能收到响应（无论状态码）说明 CORS 已通
    if (resp.ok) {
      return { ok: true, corsOk: true }
    }

    const errText = await resp.text().catch(() => '')
    return {
      ok: false,
      error: `API 返回错误 (${resp.status}): ${errText.slice(0, 200)}`,
      corsOk: true,
    }
  } catch (e) {
    return {
      ok: false,
      error: `无法连接服务商：${e instanceof Error ? e.message : String(e)}（浏览器直连被拦截或网络不可达）`,
      corsOk: false,
    }
  }
}
