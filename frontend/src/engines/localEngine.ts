/**
 * LocalEngine：通过 fetch 调用本地 FastAPI 后端 + 原生 KataGo。
 *
 * 后端需先启动（双击 launcher.bat 或手动 uvicorn）。
 * 复用现有后端 API 接口：/api/v1/game/move、/api/v1/analysis。
 */
import type {
  AnalysisResult,
  EngineInfo,
  GenmoveResult,
  GoEngine,
} from './types'
import type { Player } from '../lib/types'

const BASE = '/api/v1'

export class LocalEngine implements GoEngine {
  private ready = false
  private model = 'local'
  private benchmarkScore = -1

  async init(): Promise<void> {
    try {
      const resp = await fetch(`${BASE}/health`)
      if (resp.ok) {
        this.ready = true
        console.log('[LocalEngine] 后端已连接')
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

  setModel(model: string): void {
    this.model = model
  }

  async analyze(query: {
    boardSize: number
    komi: number
    maxVisits: number
    moves: [string, [number, number] | null][]
  }): Promise<AnalysisResult> {
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
      }),
    })

    if (!submitResp.ok) {
      throw new Error(`分析请求失败: ${submitResp.status}`)
    }

    const { task_id } = await submitResp.json()

    // 轮询直到完成
    const maxAttempts = 240 // 最多等 120 秒（0.5s 间隔）
    for (let i = 0; i < maxAttempts; i++) {
      const statusResp = await fetch(`${BASE}/analysis/${task_id}`)
      if (!statusResp.ok) {
        throw new Error(`查询分析状态失败: ${statusResp.status}`)
      }
      const status = await statusResp.json()
      if (status.status === 'done' && status.result) {
        return status.result
      }
      if (status.status === 'error') {
        throw new Error(status.error ?? '分析失败')
      }
      await new Promise((r) => setTimeout(r, 500))
    }

    throw new Error('分析超时（超过 120 秒）')
  }

  async genmove(
    color: Player,
    boardSize: number,
    komi: number,
    maxVisits: number,
    moves: [string, [number, number] | null][],
  ): Promise<GenmoveResult> {
    this.ensureReady()

    const dtoMoves = moves.map(([c, v]) => ({
      // color 可为 'B'/'W' (string) 或 1/-1 (Player number)
      color: c === 'B' || String(c) === '1' ? 'B' : 'W',
      vertex: v,
    }))

    const resp = await fetch(`${BASE}/game/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        board_size: boardSize,
        komi,
        max_visits: maxVisits,
        moves: dtoMoves,
        ai_color: color === 1 ? 'B' : 'W',
      }),
    })

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '')
      throw new Error(`AI 应手请求失败: ${resp.status} ${errText}`)
    }

    const data = await resp.json()
    return {
      vertex: data.ai_move as [number, number] | null,
      coord: data.ai_move_coord ?? null,
    }
  }

  destroy(): void {
    this.ready = false
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
