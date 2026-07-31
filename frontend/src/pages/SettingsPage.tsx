/**
 * 设置页：引擎来源选择 + 引擎状态监控 + LLM Provider 配置。
 */
import { useState } from 'react'

import { useSettingsStore, type LLMProvider } from '../stores/settingsStore'
import {
  PROVIDER_PRESETS,
  getPreset,
} from '../services/llmProviders'
import { testConnection } from '../services/llmClient'
import { initEngine } from '../engines/manager'
import { wasmEngine } from '../engines/wasmEngine'
import { useEngineStatus } from '../engines/useEngineStatus'
import type { EngineSource, EngineInfo } from '../engines/types'

/** 引擎状态标签 */
function EngineCard({
  info,
  label,
  active,
  action,
}: {
  info: EngineInfo
  label: string
  active: boolean
  action?: React.ReactNode
}) {
  return (
    <div className={`engine-card${active ? ' active' : ''}`}>
      <div className="engine-card-header">
        <span className={`engine-dot ${info.ready ? 'online' : 'offline'}`} />
        <span className="engine-card-label">{label}</span>
        {active && <span className="engine-card-badge">当前使用</span>}
      </div>
      <div className="engine-card-body">
        <div className="engine-card-row">
          <span className="engine-card-key">KataGo 版本</span>
          <span className="engine-card-value">
            {info.model || '（未检测）'}
          </span>
        </div>
        <div className="engine-card-row">
          <span className="engine-card-key">状态</span>
          <span className={`engine-card-value ${info.ready ? 'text-ok' : 'text-warn'}`}>
            {info.ready ? '已就绪' : '未连接'}
          </span>
        </div>
        {info.benchmarkScore > 0 && (
          <div className="engine-card-row">
            <span className="engine-card-key">基准</span>
            <span className="engine-card-value">
              {info.benchmarkScore} visits/s
            </span>
          </div>
        )}
      </div>
      {action && <div className="engine-card-action">{action}</div>}
    </div>
  )
}

export default function SettingsPage() {
  const {
    engineSource,
    providers,
    activeProviderId,
    aiStrength,
    setEngineSource,
    addProvider,
    updateProvider,
    removeProvider,
    setActiveProvider,
    setAIStrength,
  } = useSettingsStore()

  const engineStatus = useEngineStatus()

  const [loadingWasm, setLoadingWasm] = useState(false)
  const [wasmProgress, setWasmProgress] = useState<{ msg: string; pct?: number } | null>(null)
  const [wasmError, setWasmError] = useState<string | null>(null)

  const handleLoadWasm = async () => {
    setLoadingWasm(true)
    setWasmError(null)
    setWasmProgress({ msg: '准备中...' })

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('加载超时（30 秒），请检查网络后重试')), 30000),
    )

    try {
      await Promise.race([
        wasmEngine.init((msg, pct) => setWasmProgress({ msg, pct })),
        timeout,
      ])
      setWasmProgress(null)
    } catch (e) {
      setWasmError(e instanceof Error ? e.message : '加载失败')
      setWasmProgress(null)
    } finally {
      setLoadingWasm(false)
    }
  }

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
    setTimeout(() => initEngine(), 100)
  }

  return (
    <div className="settings-page">
      <h1>设置</h1>

      {/* ===== AI 引擎 ===== */}
      <section className="settings-section">
        <h2>AI 引擎</h2>
        <div className="engine-cards">
          <EngineCard
            info={engineStatus.local}
            label="Local GPU"
            active={engineSource === 'local'}
            action={
              <a
                href={`${import.meta.env.BASE_URL}setup-windows.bat`}
                download
                className="btn primary small card-btn"
              >
                下载启动器
              </a>
            }
          />
          <EngineCard
            info={engineStatus.browser}
            label="Browser WASM"
            active={engineSource === 'browser'}
            action={
              !engineStatus.browser.ready ? (
                <div className="engine-card-action">
                  {wasmProgress ? (
                    <div className="wasm-progress">
                      <div className="progress-bar">
                        <div
                          className="progress-fill"
                          style={{
                            width: `${wasmProgress.pct ?? (loadingWasm ? 10 : 0)}%`,
                          }}
                        />
                      </div>
                      <span className="progress-text">
                        {wasmProgress.msg}
                        {wasmProgress.pct != null ? ` ${wasmProgress.pct}%` : ''}
                      </span>
                    </div>
                  ) : (
                    <button
                      className="btn primary small card-btn"
                      disabled={loadingWasm}
                      onClick={handleLoadWasm}
                    >
                      {loadingWasm ? '加载中...' : '加载 WASM 引擎'}
                    </button>
                  )}
                  {wasmError && (
                    <p className="hint" style={{ color: 'var(--danger)', marginTop: 6 }}>
                      {wasmError}
                    </p>
                  )}
                </div>
              ) : undefined
            }
          />
        </div>

        <div className="settings-row">
          <span className="settings-label">引擎来源</span>
          <select
            value={engineSource}
            onChange={(e) => handleEngineChange(e.target.value as EngineSource)}
            className="select"
          >
            <option value="local">Local GPU（本地后端）</option>
            <option value="browser">Browser WASM（首次需下载模型 ~38MB）</option>
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
