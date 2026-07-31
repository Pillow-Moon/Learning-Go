/**
 * 设置页：引擎来源选择 + LLM Provider 配置。
 */
import { useState } from 'react'

import { useSettingsStore, type LLMProvider } from '../stores/settingsStore'
import {
  PROVIDER_PRESETS,
  getPreset,
} from '../services/llmProviders'
import { testConnection } from '../services/llmClient'
import { initEngine } from '../engines/manager'
import type { EngineSource } from '../engines/types'

export default function SettingsPage() {
  const {
    engineSource,
    providers,
    activeProviderId,
    benchmarkScore,
    aiStrength,
    setEngineSource,
    addProvider,
    updateProvider,
    removeProvider,
    setActiveProvider,
    setAIStrength,
  } = useSettingsStore()

  const [selectedPresetId, setSelectedPresetId] = useState('deepseek')
  const [manualModel, setManualModel] = useState('')
  const [manualKey, setManualKey] = useState('')
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{
    ok: boolean
    error?: string
  } | null>(null)

  // 选中的预设
  const preset = getPreset(selectedPresetId)

  /** 添加/替换当前预设为 provider */
  const handleSave = () => {
    if (!preset) return
    const p: LLMProvider = {
      id: preset.id,
      name: preset.name,
      baseURL: preset.baseURL,
      defaultModel: preset.defaultModel,
      model: manualModel || preset.defaultModel,
      apiKey: manualKey,
    }
    // 替换同 ID 的已有 provider，否则新增
    const existing = providers.find((x) => x.id === preset.id)
    if (existing) {
      updateProvider(preset.id, p)
    } else {
      addProvider(p)
    }
    setActiveProvider(preset.id)
  }

  /** 测试当前 provider 连通性（CORS + API key） */
  const handleTest = async () => {
    if (!preset) return
    setTestingId(preset.id)
    setTestResult(null)
    const result = await testConnection({
      baseURL: preset.baseURL,
      apiKey: manualKey,
      model: manualModel || preset.defaultModel,
    })
    setTestResult(result)
    setTestingId(null)
  }

  /** 切换引擎来源 */
  const handleEngineChange = (src: EngineSource) => {
    setEngineSource(src)
    // 重新初始化引擎
    setTimeout(() => initEngine(), 100)
  }

  return (
    <div className="settings-page">
      <h1>设置</h1>

      {/* ===== 引擎来源 ===== */}
      <section className="settings-section">
        <h2>AI 引擎</h2>
        <div className="settings-row">
          <span className="settings-label">引擎来源</span>
          <select
            value={engineSource}
            onChange={(e) => handleEngineChange(e.target.value as EngineSource)}
            className="select"
          >
            <option value="local">Local GPU（本地后端）</option>
            <option value="browser" disabled>
              Browser WASM（暂未编译）
            </option>
          </select>
        </div>
        <div className="settings-row">
          <span className="settings-label">AI 强度</span>
          <select
            value={aiStrength}
            onChange={(e) =>
              setAIStrength(e.target.value as 'fast' | 'standard' | 'strong')
            }
            className="select"
          >
            <option value="fast">快速（减少搜索）</option>
            <option value="standard">标准</option>
            <option value="strong">强力（更多搜索）</option>
          </select>
        </div>
        {benchmarkScore > 0 && (
          <p className="hint">设备基准：{benchmarkScore} visits/s</p>
        )}
      </section>

      {/* ===== LLM Provider ===== */}
      <section className="settings-section">
        <h2>AI 解说（BYOK）</h2>
        <p className="hint">
          选择 LLM 服务商，填入你自己的 API Key。
          密钥仅存储在浏览器本地，不会上传到任何服务器。
        </p>

        {/* 预设选择 */}
        <div className="settings-row">
          <span className="settings-label">服务商</span>
          <select
            value={selectedPresetId}
            onChange={(e) => {
              setSelectedPresetId(e.target.value)
              setTestResult(null)
            }}
            className="select"
          >
            {PROVIDER_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {preset && (
          <>
            <p className="hint" style={{ marginTop: -4 }}>
              {preset.description}
              {preset.corsSupport === true && ' CORS 支持 ✓'}
              {preset.corsSupport === false && ' CORS 不支持 ✗'}
            </p>

            <div className="settings-row">
              <span className="settings-label">API Key</span>
              <input
                type="password"
                value={manualKey}
                onChange={(e) => setManualKey(e.target.value)}
                placeholder="sk-..."
                className="input"
              />
            </div>

            <div className="settings-row">
              <span className="settings-label">模型</span>
              <input
                type="text"
                value={manualModel}
                onChange={(e) => setManualModel(e.target.value)}
                placeholder={preset.defaultModel}
                className="input"
              />
            </div>

            <div className="settings-row" style={{ gap: 10 }}>
              <button className="btn primary" onClick={handleSave}>
                保存
              </button>
              <button
                className="btn"
                onClick={handleTest}
                disabled={!manualKey || testingId === preset.id}
              >
                {testingId === preset.id ? '测试中…' : '测试连接'}
              </button>
            </div>

            {testResult && (
              <div
                className={`feedback ${testResult.ok ? 'correct' : 'wrong'}`}
              >
                {testResult.ok
                  ? '连接成功 ✓'
                  : `连接失败: ${testResult.error}`}
              </div>
            )}
          </>
        )}

        {/* 已保存的 providers */}
        {providers.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <h3>已保存的配置</h3>
            {providers.map((p) => (
              <div key={p.id} className="settings-row">
                <span>
                  {p.name}
                  {p.id === activeProviderId ? ' (当前)' : ''}
                </span>
                <button
                  className="btn small"
                  onClick={() => setActiveProvider(p.id)}
                >
                  启用
                </button>
                <button
                  className="btn small danger"
                  onClick={() => removeProvider(p.id)}
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
