/**
 * LLM Provider 预设系统。
 *
 * 支持 9 类 provider，每个预设含 name、baseURL、defaultModel。
 * 所有 provider 使用 OpenAI 兼容接口（/chat/completions）。
 */

export interface ProviderPreset {
  id: string
  name: string
  baseURL: string
  defaultModel: string
  description: string
  /** 是否已知支持浏览器 CORS（null = 未探测） */
  corsSupport: boolean | null
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com',
    defaultModel: 'deepseek-v4-flash',
    description: '推荐：CORS 已验证，性价比高，解说质量好',
    corsSupport: true,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    defaultModel: 'deepseek/deepseek-v4-flash:free',
    description: '多模型聚合，一个 key 用几十种模型',
    corsSupport: null,
  },
  {
    id: 'groq',
    name: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    description: '推理极快，免费额度',
    corsSupport: null,
  },
  {
    id: 'kimi',
    name: 'Kimi (Moonshot)',
    baseURL: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    description: '中文能力强，长上下文',
    corsSupport: null,
  },
  {
    id: 'glm',
    name: 'GLM (智谱)',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
    description: '有免费档',
    corsSupport: null,
  },
  {
    id: 'qwen',
    name: 'Qwen (通义千问)',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-turbo',
    description: '阿里云，中文优化',
    corsSupport: null,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseURL: 'https://api.openai.com',
    defaultModel: 'gpt-4o-mini',
    description: '注意：官方不允许浏览器直连，建议用 OpenRouter 中转',
    corsSupport: false,
  },
  {
    id: 'ollama',
    name: 'Ollama (本地)',
    baseURL: 'http://localhost:11434/v1',
    defaultModel: 'qwen2.5:7b',
    description: '完全本地运行，零费用，无隐私问题',
    corsSupport: null,
  },
  {
    id: 'custom',
    name: '自定义',
    baseURL: 'https://api.openai.com',
    defaultModel: 'gpt-4o-mini',
    description: '填入任意 OpenAI 兼容 API 地址',
    corsSupport: null,
  },
]

/** 根据 ID 获取预设 */
export function getPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id)
}
