/**
 * 设置页：引擎来源选择 + 引擎状态监控 + LLM Provider 配置。
 */
import { useEffect, useRef, useState } from 'react'

import {
  useSettingsStore,
  type LLMProvider,
  type WasmModelId,
} from '../stores/settingsStore'
import {
  BOARD_THEMES,
  STONE_STYLES,
  getBoardTheme,
  type BoardTheme,
  type BoardThemeId,
  type StoneStyleId,
} from '../lib/boardThemes'
import { drawStone } from '../components/GoBoardCanvas'
import {
  PROVIDER_PRESETS,
  getPreset,
} from '../services/llmProviders'
import { testConnection } from '../services/llmClient'
import { initEngine } from '../engines/manager'
import { wasmEngine } from '../engines/wasmEngine'
import { localEngine } from '../engines/localEngine'
import { runBenchmark } from '../engines/benchmark'
import { useEngineStatus } from '../engines/useEngineStatus'
import type { EngineSource, EngineInfo } from '../engines/types'

/** 缩略图视觉尺寸（CSS 像素）。绘制坐标基于此坐标系，内部缓冲按 dpr 放大以适配高 DPI 屏幕 */
const THUMB_SIZE = 48

/** 后端 Local 模型列表：已安装（可切换）+ 可下载 */
interface LocalModelInfo {
  installed: { id: string; name: string; size_mb: number }[]
  available: { id: string; name: string }[]
}

/** 按设备像素比放大 canvas 内部缓冲，返回 dpr（绘制时通过 setTransform 缩放到 CSS 像素坐标系） */
function fitThumbCanvas(c: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
  const dpr = Math.min(window.devicePixelRatio || 1, 4)
  const px = Math.round(THUMB_SIZE * dpr)
  if (c.width !== px) c.width = px
  if (c.height !== px) c.height = px
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return dpr
}

/** 棋盘主题缩略图：底色 + 网格线 + 边框 */
function BoardThemeThumb({ theme }: { theme: BoardTheme }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    fitThumbCanvas(c, ctx)
    const size = THUMB_SIZE
    ctx.fillStyle = theme.boardBg
    ctx.fillRect(0, 0, size, size)
    ctx.strokeStyle = theme.line
    ctx.lineWidth = 1
    // 2x2 网格
    const inset = size * 0.14
    for (let i = 1; i < 3; i++) {
      const p = (size / 3) * i
      ctx.beginPath()
      ctx.moveTo(p + 0.5, inset)
      ctx.lineTo(p + 0.5, size - inset)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(inset, p + 0.5)
      ctx.lineTo(size - inset, p + 0.5)
      ctx.stroke()
    }
    // 边框
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'
    ctx.lineWidth = 1
    ctx.strokeRect(0.5, 0.5, size - 1, size - 1)
  }, [theme])
  return <canvas ref={ref} className="board-thumb" />
}

/** 棋子样式缩略图：黑子 + 白子 */
function StoneStyleThumb({ styleId }: { styleId: StoneStyleId }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const theme = getBoardTheme('plain')
  useEffect(() => {
    const c = ref.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    fitThumbCanvas(c, ctx)
    ctx.clearRect(0, 0, THUMB_SIZE, THUMB_SIZE)
    drawStone(ctx, 14, 24, 11, 1, theme, styleId)
    drawStone(ctx, 34, 24, 11, -1, theme, styleId)
  }, [styleId, theme])
  return <canvas ref={ref} className="stone-thumb" />
}

/** 引擎状态标签 */
function EngineCard({
  info,
  label,
  active,
  action,
  onClick,
  benchmarkScore,
}: {
  info: EngineInfo
  label: string
  active: boolean
  action?: React.ReactNode
  onClick?: () => void
  benchmarkScore?: number
}) {
  // 优先展示传入的实测分数（测试完成后立即刷新），否则用引擎轮询值
  const score = benchmarkScore ?? info.benchmarkScore
  return (
    <div
      className={`engine-card${active ? ' active' : ''}`}
      onClick={onClick}
      style={onClick ? { cursor: 'pointer' } : undefined}
    >
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
        {score > 0 && (
          <div className="engine-card-row">
            <span className="engine-card-key">基准</span>
            <span className="engine-card-value">
              {score} visits/s
            </span>
          </div>
        )}
      </div>
      {action && (
        <div className="engine-card-action" onClick={(e) => e.stopPropagation()}>
          {action}
        </div>
      )}
    </div>
  )
}

export default function SettingsPage() {
  const {
    engineSource,
    providers,
    activeProviderId,
    localBenchmarkScore,
    wasmBenchmarkScore,
    wasmBenchmarkByModel,
    boardTheme,
    stoneStyle,
    setEngineSource,
    setLocalBenchmarkScore,
    recordWasmBenchmark,
    addProvider,
    updateProvider,
    removeProvider,
    setActiveProvider,
    setBoardTheme,
    setStoneStyle,
  } = useSettingsStore()

  const engineStatus = useEngineStatus()

  const [loadingWasm, setLoadingWasm] = useState(false)
  const [wasmProgress, setWasmProgress] = useState<{ msg: string; pct?: number } | null>(null)
  const [wasmError, setWasmError] = useState<string | null>(null)
  const [localBenchmarking, setLocalBenchmarking] = useState(false)
  const [localBenchmarkError, setLocalBenchmarkError] = useState<string | null>(null)
  const [benchmarkElapsed, setBenchmarkElapsed] = useState(0)
  const [wasmBenchmarking, setWasmBenchmarking] = useState(false)
  const [wasmBenchmarkError, setWasmBenchmarkError] = useState<string | null>(null)
  const [showEngineHelp, setShowEngineHelp] = useState(false)
  const [localModels, setLocalModels] = useState<LocalModelInfo>({ installed: [], available: [] })
  const [humanSlReady, setHumanSlReady] = useState(false)
  const [connInfo, setConnInfo] = useState<{
    lan_ips: string[]
    tailscale_ip: string | null
  } | null>(null)
  const [copied, setCopied] = useState(false)
  const [localModelsError, setLocalModelsError] = useState<string | null>(null)
  const [localModelSwitching, setLocalModelSwitching] = useState(false)
  const [modelSwitchMsg, setModelSwitchMsg] = useState<string | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [downloadMsg, setDownloadMsg] = useState<string | null>(null)

  /** 拉取后端连接信息（局域网/Tailscale IP，手机远程配置用） */
  const refreshConnInfo = async () => {
    if (!engineStatus.local.ready) {
      setConnInfo(null)
      return
    }
    try {
      const info = await localEngine.fetchConnectionInfo()
      setConnInfo(info)
    } catch {
      setConnInfo(null)
    }
  }

  // Local 引擎就绪时拉取连接信息
  useEffect(() => {
    void refreshConnInfo()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineStatus.local.ready])

  /** 复制 Tailscale 地址到剪贴板 */
  const copyTailscale = async () => {
    if (!connInfo?.tailscale_ip) return
    try {
      await navigator.clipboard.writeText(
        `http://${connInfo.tailscale_ip}:8000/api/v1`,
      )
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* 剪贴板不可用（非 https/权限）时忽略 */
    }
  }

  /** 拉取后端模型列表：已安装（可切换）+ 可下载 */
  const fetchLocalModels = async () => {
    setLocalModelsError(null)
    try {
      const data = await localEngine.listModels()
      // Human-SL 对弈引擎单独展示（不作为可切换的分析模型，避免被设为分析模型）
      const HUMAN_SL_MODEL = 'b18c384nbt-humanv0'
      setHumanSlReady(data.installed.some((m) => m.id === HUMAN_SL_MODEL))
      setLocalModels({
        installed: data.installed.filter((m) => m.id !== HUMAN_SL_MODEL),
        available: data.available,
      })
    } catch (e) {
      setLocalModels({ installed: [], available: [] })
      setHumanSlReady(false)
      setLocalModelsError(
        e instanceof Error
          ? `无法获取模型列表：${e.message}（请重启后端以加载新接口）`
          : '无法获取模型列表',
      )
    }
  }

  useEffect(() => {
    if (engineStatus.local.ready) {
      void fetchLocalModels()
    }
  }, [engineStatus.local.ready])

  /** 临时提示自动消失计时器（避免切换/下载提示残留） */
  const msgTimerRef = useRef<{ switch?: number; download?: number }>({})

  /** 显示临时提示，4 秒后自动消失 */
  const showTemporaryMsg = (
    key: 'switch' | 'download',
    setter: (v: string | null) => void,
    msg: string | null,
  ) => {
    const timers = msgTimerRef.current
    if (timers[key] != null) {
      window.clearTimeout(timers[key])
      timers[key] = undefined
    }
    setter(msg)
    if (msg !== null) {
      timers[key] = window.setTimeout(() => {
        setter(null)
        timers[key] = undefined
      }, 4000)
    }
  }

  /** 切换 KataGo 模型：后端停旧进程，基准分数作废需重测 */
  const handleModelSwitch = async (id: string) => {
    if (!id || id === engineStatus.local.model) return
    setLocalModelSwitching(true)
    showTemporaryMsg('switch', setModelSwitchMsg, null)
    showTemporaryMsg('download', setDownloadMsg, null) // 清除残留的下载提示
    try {
      const result = await localEngine.switchModel(id)
      // 新模型性能未知，旧基准分数作废
      localEngine.setBenchmarkScore(-1)
      setLocalBenchmarkScore(-1)
      setLocalBenchmarkError(null)
      await initEngine() // 刷新引擎状态（模型显示）
      await fetchLocalModels()
      showTemporaryMsg(
        'switch',
        setModelSwitchMsg,
        `${result.message}。基准分数已重置，请重新「测试速度」。`,
      )
    } catch (e) {
      showTemporaryMsg(
        'switch',
        setModelSwitchMsg,
        e instanceof Error ? `切换失败：${e.message}` : '切换失败',
      )
    } finally {
      setLocalModelSwitching(false)
    }
  }

  /** 下载指定模型：后台下载 → 轮询进度 → 完成后自动切换 */
  const handleDownloadModel = async (id: string) => {
    if (downloadingId) return // 同时只下载一个
    setDownloadingId(id)
    setDownloadProgress(0)
    showTemporaryMsg('download', setDownloadMsg, null)
    try {
      await localEngine.startModelDownload(id)
      // 轮询下载进度（每 1 秒）
      for (;;) {
        await new Promise((r) => setTimeout(r, 1000))
        const st = await localEngine.getModelDownload(id)
        setDownloadProgress(st.progress)
        if (st.status === 'done') break
        if (st.status === 'error') {
          throw new Error(st.error || '下载失败')
        }
      }
      showTemporaryMsg('download', setDownloadMsg, `模型 ${id} 下载完成，正在切换…`)
      await fetchLocalModels()
      await handleModelSwitch(id)
    } catch (e) {
      showTemporaryMsg(
        'download',
        setDownloadMsg,
        e instanceof Error ? `下载失败：${e.message}` : '下载失败',
      )
    } finally {
      setDownloadingId(null)
    }
  }

  /** 下拉选择：已安装项切换，可下载项（download: 前缀）触发下载 */
  const handleModelSelect = (value: string) => {
    if (value.startsWith('download:')) {
      void handleDownloadModel(value.slice('download:'.length))
    } else {
      void handleModelSwitch(value)
    }
  }

  /** 测试 Local 引擎速度（visits/s），结果用于 AI 强度时间估算与推荐搜索量 */
  const handleBenchmark = async () => {
    setLocalBenchmarking(true)
    setLocalBenchmarkError(null)
    setBenchmarkElapsed(0)
    const t0 = Date.now()
    // 模型加载/分析可能耗时数分钟，用已等待秒数提供反馈
    const timer = window.setInterval(
      () => setBenchmarkElapsed(Math.round((Date.now() - t0) / 1000)),
      500,
    )
    try {
      const { score } = await runBenchmark(localEngine)
      localEngine.setBenchmarkScore(score)
      setLocalBenchmarkScore(score)
    } catch (e) {
      setLocalBenchmarkError(e instanceof Error ? e.message : '基准测试失败')
    } finally {
      window.clearInterval(timer)
      setLocalBenchmarking(false)
    }
  }

  /** 测试 WASM 引擎速度（visits/s），结果按当前模型独立保存，用于 AI 强度时间估算与推荐搜索量 */
  const handleWasmBenchmark = async () => {
    setWasmBenchmarking(true)
    setWasmBenchmarkError(null)
    try {
      const { score } = await runBenchmark(wasmEngine)
      wasmEngine.setBenchmarkScore(score)
      recordWasmBenchmark('b6c96', score)
    } catch (e) {
      setWasmBenchmarkError(e instanceof Error ? e.message : '基准测试失败')
    } finally {
      setWasmBenchmarking(false)
    }
  }

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
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [enableMsg, setEnableMsg] = useState<string | null>(null)

  // 选中的预设
  const preset = getPreset(selectedPresetId)
  // 当前预设已保存的配置（用于回填表单 & 防止空 key 覆盖）
  const savedProvider = providers.find((x) => x.id === selectedPresetId)

  /** 添加/替换当前预设为 provider */
  const handleSave = () => {
    if (!preset) return
    // apiKey 留空时保留已保存的 key，避免空字符串覆盖旧配置
    const p: LLMProvider = {
      id: preset.id,
      name: preset.name,
      baseURL: preset.baseURL,
      defaultModel: preset.defaultModel,
      model: manualModel || savedProvider?.model || preset.defaultModel,
      apiKey: manualKey || savedProvider?.apiKey || '',
    }
    // 替换同 ID 的已有 provider，否则新增
    const existing = providers.find((x) => x.id === preset.id)
    if (existing) {
      updateProvider(preset.id, p)
    } else {
      addProvider(p)
    }
    setActiveProvider(preset.id)
    setSaveMsg(`已保存并启用「${preset.name}」`)
    setEnableMsg(null)
    setTestResult(null)
  }

  /** 测试当前 provider 连通性（CORS + API key） */
  const handleTest = async () => {
    if (!preset) return
    setTestingId(preset.id)
    setTestResult(null)
    setSaveMsg(null)
    setEnableMsg(null)
    const result = await testConnection({
      baseURL: preset.baseURL,
      // key 留空时用已保存的 key 测试
      apiKey: manualKey || savedProvider?.apiKey || '',
      model: manualModel || savedProvider?.model || preset.defaultModel,
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
        <div className="section-head">
          <h2>AI 引擎</h2>
          <button
            className="btn small"
            onClick={() => setShowEngineHelp(true)}
          >
            引擎与模型说明
          </button>
        </div>
        <p className="hint">点击卡片切换引擎来源，引擎状态实时显示。</p>
        <div className="engine-cards">
          <EngineCard
            info={engineStatus.browser}
            label="Browser WASM"
            active={engineSource === 'browser'}
            onClick={() => handleEngineChange('browser')}
            benchmarkScore={wasmBenchmarkScore}
            action={
              <div>
                <div className="card-btn-row">
                  <button
                    className="btn primary small card-btn"
                    disabled={engineStatus.browser.ready || loadingWasm}
                    onClick={handleLoadWasm}
                  >
                    {loadingWasm
                      ? '加载中...'
                      : engineStatus.browser.ready
                        ? '已加载'
                        : '加载 WASM 引擎'}
                  </button>
                  <button
                    className="btn small card-btn"
                    disabled={!engineStatus.browser.ready || wasmBenchmarking}
                    onClick={handleWasmBenchmark}
                  >
                    {wasmBenchmarking ? '测试中…' : '测试速度'}
                  </button>
                </div>
                {wasmProgress && (
                  <div className="wasm-progress" style={{ marginTop: 8 }}>
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
                )}
                {wasmError && (
                  <p className="hint" style={{ color: 'var(--danger)', marginTop: 6 }}>
                    {wasmError}
                  </p>
                )}
                {wasmBenchmarkError && (
                  <p className="hint" style={{ color: 'var(--danger)', marginTop: 6 }}>
                    {wasmBenchmarkError}
                  </p>
                )}
              </div>
            }
          />
          <EngineCard
            info={engineStatus.local}
            label="Local GPU"
            active={engineSource === 'local'}
            onClick={() => handleEngineChange('local')}
            benchmarkScore={localBenchmarkScore}
            action={
              <div>
                <div className="card-btn-row">
                  <a
                    href={`${import.meta.env.BASE_URL}setup-windows.bat`}
                    download
                    className="btn primary small card-btn"
                  >
                    下载启动器
                  </a>
                  <button
                    className="btn small card-btn"
                    disabled={!engineStatus.local.ready || localBenchmarking}
                    onClick={handleBenchmark}
                  >
                    {localBenchmarking ? '测试中…' : '测试速度'}
                  </button>
                </div>
                {localBenchmarking && (
                  <div className="wasm-progress" style={{ marginTop: 8 }}>
                    <div className="progress-bar indeterminate">
                      <div className="progress-fill" />
                    </div>
                    <span className="progress-text">
                      正在测试（首次分析需加载模型，大模型可能需数分钟）… 已等待{' '}
                      {benchmarkElapsed} 秒
                    </span>
                  </div>
                )}
                {localBenchmarkError && (
                  <p
                    className="hint"
                    style={{ color: 'var(--danger)', marginTop: 6 }}
                  >
                    {localBenchmarkError}
                  </p>
                )}
              </div>
            }
          />
        </div>

        {engineSource === 'browser' && (
          <div className="settings-row">
            <span className="settings-label">KataGo 模型</span>
            <span className="hint-sm" style={{ alignSelf: 'center' }}>
              内置轻量模型 b6c96（离线兜底，固定不可切换）
            </span>
          </div>
        )}
        {engineSource === 'local' && (
          <>
            <div className="settings-row">
              <span className="settings-label">KataGo 模型</span>
              <select
                value={engineStatus.local.model}
                onChange={(e) => handleModelSelect(e.target.value)}
                className="select"
                disabled={
                  localModelSwitching ||
                  downloadingId !== null ||
                  !engineStatus.local.ready
                }
              >
                {localModels.installed.length > 0 && (
                  <optgroup label="已安装">
                    {localModels.installed.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                        {m.size_mb > 0 ? `（${m.size_mb} MB）` : ''}
                      </option>
                    ))}
                  </optgroup>
                )}
                {localModels.available.length > 0 && (
                  <optgroup label="可下载（选择即下载并切换）">
                    {localModels.available.map((m) => (
                      <option key={m.id} value={`download:${m.id}`}>
                        {m.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {localModels.installed.length === 0 &&
                  localModels.available.length === 0 && (
                    <option value="">
                      {engineStatus.local.ready
                        ? '未检测到模型'
                        : '后端未连接'}
                    </option>
                  )}
              </select>
            </div>
            <p className="hint-sm" style={{ marginTop: 8 }}>
              {humanSlReady
                ? 'Human-SL 对弈引擎：已就绪（对弈档位 am20k~am7d 使用官方人类风格标尺，自动启用，无需切换模型）'
                : 'Human-SL 对弈引擎：未安装（对弈将回退 visits 档位；请将 b18c384nbt-humanv0.bin.gz 放入 models 目录）'}
            </p>
            {downloadingId && (
              <div className="wasm-progress" style={{ marginTop: 8 }}>
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{ width: `${downloadProgress}%` }}
                  />
                </div>
                <span className="progress-text">
                  正在下载 {downloadingId}… {downloadProgress}%
                </span>
              </div>
            )}
            {downloadMsg && (
              <p className="hint-sm" style={{ marginTop: 8 }}>
                {downloadMsg}
              </p>
            )}
            {localModelsError && (
              <p
                className="hint-sm"
                style={{ color: 'var(--danger)', marginTop: 8 }}
              >
                {localModelsError}
              </p>
            )}
            {modelSwitchMsg && (
              <p className="hint-sm" style={{ marginTop: 8 }}>
                {modelSwitchMsg}
              </p>
            )}
            <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
              {/* GitHub Pages 部署时 hostname 形如 <owner>.github.io；本地开发此链接无效仅提示 */}
              <a
                className="btn small"
                href={`https://github.com/${window.location.hostname.split('.')[0]}/Learning-Go/releases/latest`}
                target="_blank"
                rel="noreferrer"
              >
                下载桌面引擎（绿色包，免安装）
              </a>
              <span className="hint-sm">无需 Python 环境，解压即用</span>
            </div>
            <div className="remote-connect" style={{ marginTop: 12 }}>
              <h3 style={{ fontSize: 14, marginBottom: 6 }}>远程连接（手机端）</h3>
              <p className="hint-sm">
                外出时手机连回本机引擎，获得完整棋力与人类风格对弈。三步配置，Tailscale 地址固定、填一次永久生效：
              </p>
              <ol className="help-list" style={{ margin: '6px 0 8px 18px', fontSize: 13 }}>
                <li>电脑安装 Tailscale（tailscale.com/download）并登录</li>
                <li>手机安装 Tailscale App，登录同一账号</li>
                <li>
                  手机设置页「引擎来源 → Local GPU」，在下方地址栏填入{' '}
                  <code>
                    {connInfo?.tailscale_ip
                      ? `http://${connInfo.tailscale_ip}:8000/api/v1`
                      : 'http://100.x.x.x:8000/api/v1'}
                  </code>
                </li>
              </ol>
              {connInfo?.tailscale_ip ? (
                <p className="hint-sm">
                  本机 Tailscale 地址：<code>{`http://${connInfo.tailscale_ip}:8000/api/v1`}</code>{' '}
                  <button className="btn small" onClick={() => void copyTailscale()}>
                    {copied ? '已复制' : '复制'}
                  </button>
                </p>
              ) : (
                <p className="hint-sm" style={{ color: 'var(--warning)' }}>
                  未检测到 Tailscale（电脑需保持开机；Tailscale 地址固定不变，配置一次即可）
                </p>
              )}
              {connInfo && connInfo.lan_ips.length > 0 && (
                <p className="hint-sm" style={{ marginTop: 4 }}>
                  局域网地址（同一 Wi-Fi 下参考）：
                  {connInfo.lan_ips.map((ip) => `http://${ip}:8000/api/v1`).join('；')}
                </p>
              )}
            </div>
          </>
        )}
        {engineSource === 'local' && localBenchmarkScore <= 0 && (
          <p className="hint-sm" style={{ marginTop: 8 }}>
            Local GPU 性能因硬件而异，请先启动后端并点击「测试速度」实测本机计算速度，AI 强度的计算时间将按实测结果估算。
          </p>
        )}
        {engineSource === 'browser' && wasmBenchmarkScore <= 0 && (
          <p className="hint-sm" style={{ marginTop: 8 }}>
            WASM 性能因硬件而异，请先加载 WASM 引擎并点击「测试速度」实测本机计算速度，AI 强度的计算时间将按实测结果估算。
          </p>
        )}
        {engineSource === 'browser' && wasmBenchmarkScore > 0 && wasmBenchmarkScore < 50 && (
          <p className="hint-sm" style={{ marginTop: 8, color: 'var(--warning)' }}>
            当前设备 WASM 性能较弱（{Math.round(wasmBenchmarkScore)} visits/s），分析等待时间较长；
            外出需要完整棋力时，可按上方「远程连接」指引配置 Tailscale 连回本地引擎。
          </p>
        )}
      </section>

      {/* ===== 棋盘样式 ===== */}
      <section className="settings-section">
        <h2>棋盘样式</h2>
        <p className="hint">选择棋盘的配色主题与棋子质感，切换后立即生效并保存。</p>
        <div className="settings-row">
          <span className="settings-label">主题</span>
          <select
            value={boardTheme}
            onChange={(e) => setBoardTheme(e.target.value as BoardThemeId)}
            className="select"
          >
            {BOARD_THEMES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <BoardThemeThumb theme={getBoardTheme(boardTheme)} />
        </div>
        <div className="settings-row">
          <span className="settings-label">棋子样式</span>
          <select
            value={stoneStyle}
            onChange={(e) => setStoneStyle(e.target.value as StoneStyleId)}
            className="select"
          >
            {STONE_STYLES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <StoneStyleThumb styleId={stoneStyle} />
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
              const id = e.target.value
              setSelectedPresetId(id)
              const saved = providers.find((x) => x.id === id)
              setManualModel(saved?.model ?? '')
              setManualKey('') // key 不回填明文，留空表示保留原值
              setTestResult(null)
              setSaveMsg(null)
              setEnableMsg(null)
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
            <p className="hint" style={{ marginTop: 8 }}>
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
                disabled={
                  (!manualKey && !savedProvider?.apiKey) ||
                  testingId === preset.id
                }
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
                  {p.id === activeProviderId ? '（当前使用）' : ''}
                  {!p.apiKey && (
                    <span style={{ color: 'var(--danger)', marginLeft: 6 }}>
                      缺 API Key
                    </span>
                  )}
                </span>
                <button
                  className="btn small"
                  disabled={p.id === activeProviderId}
                  onClick={() => {
                    // 表单当前正编辑同一家且填了 key/模型时，先保存再启用，
                    // 避免"填 key 后点启用不生效"
                    if (selectedPresetId === p.id) {
                      const patch: Partial<LLMProvider> = {}
                      if (manualKey) patch.apiKey = manualKey
                      if (manualModel) patch.model = manualModel
                      if (Object.keys(patch).length > 0) {
                        updateProvider(p.id, patch)
                      }
                    }
                    setActiveProvider(p.id)
                    setEnableMsg(`已启用「${p.name}」，AI 解说将使用该配置`)
                    // 回填表单，方便查看/修改
                    setSelectedPresetId(p.id)
                    setManualModel(p.model)
                    setManualKey('') // key 不回填明文，留空表示保留原值
                    setTestResult(null)
                  }}
                >
                  {p.id === activeProviderId ? '使用中' : '启用'}
                </button>
                <button
                  className="btn small danger"
                  onClick={() => {
                    removeProvider(p.id)
                    setEnableMsg(null)
                  }}
                >
                  删除
                </button>
              </div>
            ))}
            {enableMsg && (
              <div className="feedback correct" style={{ marginTop: 8 }}>
                {enableMsg}
              </div>
            )}
          </div>
        )}

        {saveMsg && (
          <div className="feedback correct" style={{ marginTop: 8 }}>
            {saveMsg}
          </div>
        )}
      </section>

      {showEngineHelp && (
        <EngineHelpModal
          byModel={wasmBenchmarkByModel}
          onClose={() => setShowEngineHelp(false)}
        />
      )}
    </div>
  )
}

/**
 * 引擎与模型说明弹窗：直接给出选择建议，讲清 WASM vs Local、模型差异，
 * 以及「大模型低访问量 vs 小模型高访问量」在时间相同时的具体差别。
 * 已实测的模型会附上具体数字，未测的提示补测。
 */
function EngineHelpModal({
  byModel,
  onClose,
}: {
  byModel: Partial<Record<WasmModelId, number>>
  onClose: () => void
}) {
  const scoreOf = (id: WasmModelId) => byModel[id] ?? -1
  const anyMeasured = scoreOf('b6c96') > 0
  // 例：同样等 5 秒，各模型能搜多少访问量
  const budgetSecs = 5
  const fmtVisits = (v: number) => `${v.toLocaleString()} 次`

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>引擎与模型说明</h2>
          <button className="btn small" onClick={onClose}>
            关闭
          </button>
        </div>

        <h3>WASM 与 Local GPU 的区别</h3>
        <table className="cmp-table">
          <thead>
            <tr>
              <th>项目</th>
              <th>Browser WASM</th>
              <th>Local GPU</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>运行位置</td>
              <td>浏览器内（网页版 KataGo）</td>
              <td>本机后端（完整 KataGo）</td>
            </tr>
            <tr>
              <td>是否需要安装</td>
              <td>否，加载即用</td>
              <td>需先启动后端</td>
            </tr>
            <tr>
              <td>速度</td>
              <td>取决于 CPU/浏览器，通常较慢</td>
              <td>可用 GPU 加速，通常快得多</td>
            </tr>
            <tr>
              <td>适合场景</td>
              <td>快速体验、机器一般</td>
              <td>认真对弈、追求棋力</td>
            </tr>
          </tbody>
        </table>

        <h3>WASM 内置模型（b6c96 轻量）</h3>
        <p className="hint">
          网页版 WASM 内置单个轻量模型 b6c96，定位是离线兜底：体积小、加载快，
          适合入门级教学（9/13 路、基础课程）与外出临时对弈；评估/解说等场景结果仅供参考，
          建议连接本地引擎获得完整棋力与人类风格对弈。
        </p>
        <table className="cmp-table">
          <thead>
            <tr>
              <th>模型</th>
              <th>特点</th>
              <th>实测速度</th>
              <th>等 {budgetSecs} 秒能搜</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>b6c96</td>
              <td>6x96 轻量模型</td>
              <td>
                {scoreOf('b6c96') > 0
                  ? `${scoreOf('b6c96').toLocaleString()} visits/s`
                  : <span className="hint-sm">未测</span>}
              </td>
              <td>
                {scoreOf('b6c96') > 0
                  ? fmtVisits(Math.round(scoreOf('b6c96') * budgetSecs))
                  : <span className="hint-sm">未测</span>}
              </td>
            </tr>
          </tbody>
        </table>
        {!anyMeasured && (
          <p className="hint-sm" style={{ color: 'var(--danger)', marginTop: 6 }}>
            尚未实测：点击「测试速度」后，上表数字会自动填充。
          </p>
        )}

        <h3>访问量（visits）说明</h3>
        <p className="hint">
          「访问量」是 AI 每手落子前模拟搜索的次数。模型大小决定单次评估的质量，
          访问量决定评估的数量；同段位下弱模型需要更多访问量（单次评估弱）、强模型更少。
          引擎快慢只影响每手耗时，不改变访问量。
        </p>

        <h3>怎么选（直接建议）</h3>
        <ul className="help-list">
          <li>
            <strong>外出 / 机器一般 / 想开箱即用</strong>：Browser WASM（内置 b6c96，无需安装），
            离线也可用。
          </li>
          <li>
            <strong>本机有独立显卡 / 追求棋力</strong>：Local GPU（b11c768h12 大模型 + Human-SL 人类风格对弈）。
          </li>
          <li>
            <strong>外出需要完整棋力</strong>：按设置页「远程连接」指引配置 Tailscale，
            手机即可连回本地引擎。
          </li>
          <li>
            <strong>AI 强度按等级选</strong>：等级上限由可达性决定：每手超过约 3 分钟搜不完的等级不提供
            ——WASM b6c96 搜不快，能选的段位很低（最高约 3 段）；本地 GPU 大模型上限高。
            下拉会显示每手时间，据此权衡。
          </li>
        </ul>
      </div>
    </div>
  )
}
