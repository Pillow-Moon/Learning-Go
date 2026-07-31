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

/**
 * 流式调用 LLM（SSE）。
 * onChunk 每收到一个 token 调用一次。
 * 返回完整文本。
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
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: true,
      temperature: 0.7,
      max_tokens: 800,
    }),
  })

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '')
    throw new Error(`LLM 请求失败 (${resp.status}): ${errText.slice(0, 200)}`)
  }

  const reader = resp.body?.getReader()
  if (!reader) throw new Error('无法读取响应流')

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

/**
 * CORS 探测：发送 OPTIONS 预检请求，检查是否允许跨域。
 * 成功返回 true，失败返回 false。
 */
export async function testCORS(baseURL: string): Promise<boolean> {
  try {
    const resp = await fetch(`${baseURL}/chat/completions`, {
      method: 'OPTIONS',
      headers: {
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,authorization',
      },
    })
    return resp.ok
  } catch {
    return false
  }
}

/**
 * 连通性测试：发送一个最小请求（无 stream），验证 API key 和端点是否正常。
 */
export async function testConnection(config: LLMConfig): Promise<{
  ok: boolean
  error?: string
  corsOk: boolean
}> {
  const corsOk = await testCORS(config.baseURL)
  if (!corsOk) {
    return {
      ok: false,
      error: 'CORS 不支持：此服务不允许浏览器直连。建议使用支持 CORS 的 provider（如 DeepSeek），或通过 OpenRouter 中转。',
      corsOk: false,
    }
  }

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
      }),
    })

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
      error: `网络错误: ${e instanceof Error ? e.message : String(e)}`,
      corsOk: true,
    }
  }
}
