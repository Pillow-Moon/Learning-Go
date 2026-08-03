/**
 * LocalEngine：通过 fetch 调用本地 FastAPI 后端 + 原生 KataGo。
 *
 * 后端需先启动（双击 launcher.bat 或手动 uvicorn）。
 * 复用现有后端 API 接口：/api/v1/game/move、/api/v1/analysis。
 */
import type { AnalysisResult, EngineInfo, GoEngine } from './types'

const BASE = '/api/v1'

/**
 * 后端分析响应归一化：后端输出 snake_case（score_lead），
 * 前端类型统一 camelCase（scoreLead，与 WASM 引擎一致）。
 * 同时过滤非法候选点（move 缺失）。
 */
function normalizeAnalysis(raw: unknown): AnalysisResult {
  const r = raw as any
  const mapCand = (c: any) => ({
    move: c.move ?? null,
    winrate: c.winrate ?? null,
    scoreLead: c.scoreLead ?? c.score_lead ?? null,
    visits: c.visits ?? null,
    prior: c.prior ?? null,
    pv: Array.isArray(c.pv) ? c.pv : [],
  })
  return {
    boardSize: r.boardSize ?? r.board_size ?? 19,
    candidates: Array.isArray(r.candidates) ? r.candidates.map(mapCand) : [],
    root: {
      winrate: r.root?.winrate ?? r.root_winrate ?? undefined,
      scoreLead:
        r.root?.scoreLead ?? r.root?.score_lead ?? r.root_score_lead ?? undefined,
    },
    ownership: r.ownership ?? null,
    policy: r.policy ?? null,
  }
}

export class LocalEngine implements GoEngine {
  private ready = false
  private model = 'local'
  private benchmarkScore = -1

  async init(): Promise<void> {
    try {
      const resp = await fetch(`${BASE}/health`)
      if (resp.ok) {
        const body = await resp.json()
        this.model = body.katago_model || body.app || 'local'
        this.ready = true
        console.log('[LocalEngine] 后端已连接, 模型:', this.model)
      } else {
        throw new Error(`后端响应异常: ${resp.status}`)
      }
    } catch (e) {
      console.warn('[LocalEngine] 后端未启动或不可达:', e)
      this.ready = false
    }
  }

  isReady(): boolean {
    return this.ready
  }

  getInfo(): EngineInfo {
    return {
      source: 'local',
      model: this.model,
      ready: this.ready,
      benchmarkScore: this.benchmarkScore,
    }
  }

  setBenchmarkScore(score: number): void {
    this.benchmarkScore = score
  }

  /** 获取后端 KataGo 模型信息：已安装（可切换）+ 可下载 + 当前模型 */
  async listModels(): Promise<{
    installed: { id: string; name: string; size_mb: number }[]
    available: { id: string; name: string }[]
    current: string
  }> {
    const resp = await fetch(`${BASE}/engine/models`)
    if (!resp.ok) {
      throw new Error(`获取模型列表失败: ${resp.status}`)
    }
    return resp.json()
  }

  /** 获取后端连接信息（手机远程配置用）：局域网 IP + Tailscale IP + 当前模型 */
  async fetchConnectionInfo(): Promise<{
    lan_ips: string[]
    tailscale_ip: string | null
    katago_model: string
  }> {
    const resp = await fetch(`${BASE}/health`)
    if (!resp.ok) {
      throw new Error(`获取连接信息失败: ${resp.status}`)
    }
    return resp.json()
  }

  /** 启动指定模型的后台下载 */
  async startModelDownload(modelId: string): Promise<{
    status: string
    progress: number
    error: string | null
  }> {
    const resp = await fetch(`${BASE}/engine/model/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelId }),
    })
    if (!resp.ok) {
      const body = await resp.json().catch(() => null)
      throw new Error(body?.detail ?? `发起下载失败: ${resp.status}`)
    }
    return resp.json()
  }

  /** 查询模型下载进度 */
  async getModelDownload(modelId: string): Promise<{
    status: string
    progress: number
    error: string | null
  }> {
    const resp = await fetch(`${BASE}/engine/model/download/${modelId}`)
    if (!resp.ok) {
      throw new Error(`查询下载进度失败: ${resp.status}`)
    }
    return resp.json()
  }

  /** 切换到指定 KataGo 模型（需已下载到 models/ 目录） */
  async switchModel(modelId: string): Promise<{
    changed: boolean
    message: string
  }> {
    const resp = await fetch(`${BASE}/engine/model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelId }),
    })
    if (!resp.ok) {
      const body = await resp.json().catch(() => null)
      throw new Error(body?.detail ?? `切换模型失败: ${resp.status}`)
    }
    const result = await resp.json()
    if (result.changed) {
      // 后端已停掉旧模型进程，下次分析按新模型惰性启动
      this.model = modelId
    }
    return result
  }

  setModel(model: string): void {
    this.model = model
  }

  async analyze(
    query: {
      boardSize: number
      komi: number
      maxVisits: number
      moves: [string, [number, number] | null][]
      initialStones?: { B?: [number, number][]; W?: [number, number][] }
    },
    onSnapshot?: (result: AnalysisResult) => void,
  ): Promise<AnalysisResult> {
    this.ensureReady()

    // 提交分析任务
    const submitResp = await fetch(`${BASE}/analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        board_size: query.boardSize,
        komi: query.komi,
        max_visits: query.maxVisits,
        moves: query.moves.map(([color, vertex]) => ({
          color,
          vertex,
        })),
        initial_stones: query.initialStones,
      }),
    })

    if (!submitResp.ok) {
      throw new Error(`分析请求失败: ${submitResp.status}`)
    }

    const { task_id } = await submitResp.json()

    // 后端按 reportAnalysisWinratesAs=BLACK 输出：winrate 恒为黑方胜率、
    // root/candidates 的 score_lead 恒为黑方视角（正=黑领先）。统一原样透传。

    // 轮询直到完成
    // 大模型（如 b11c768h12，212MB）首次分析需加载权重到 GPU，可能耗时数分钟，
    // 上限放宽到 300 秒（0.5s 间隔 × 600 次）；常规分析远快于此
    const maxAttempts = 600
    for (let i = 0; i < maxAttempts; i++) {
      const statusResp = await fetch(`${BASE}/analysis/${task_id}`)
      if (!statusResp.ok) {
        throw new Error(`查询分析状态失败: ${statusResp.status}`)
      }
      const status = await statusResp.json()
      if (status.status === 'done' && status.result) {
        return normalizeAnalysis(status.result)
      }
      // 中间快照：status=running 且已有 result 时增量回调
      if (status.status === 'running' && status.result) {
        onSnapshot?.(normalizeAnalysis(status.result))
      }
      if (status.status === 'error') {
        throw new Error(status.error ?? '分析失败')
      }
      await new Promise((r) => setTimeout(r, 500))
    }

    throw new Error('分析超时（超过 120 秒）')
  }
  async genmove(): Promise<never> {
    throw new Error('AI 对弈已移除：对局请使用星阵等外部平台，本平台专注复盘')
  }

  destroy(): void {
    this.ready = false
  }

  cancelAnalysis(): void {
    // Local 分析走后端独立任务（/analysis 任务表 + 轮询），无需取消
  }

  private ensureReady(): void {
    if (!this.ready) {
      throw new Error(
        '本地引擎未连接。请先启动后端（双击 launcher.bat 或运行 uvicorn app.main:app --port 8000），然后刷新页面。',
      )
    }
  }
}

/** 全局单例 */
export const localEngine = new LocalEngine()
