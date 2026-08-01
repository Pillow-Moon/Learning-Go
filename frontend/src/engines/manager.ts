/**
 * 引擎管理器：根据用户设置返回当前激活的 GoEngine 实例。
 *
 * 在 stores 中通过 getCurrentEngine() 获取引擎，避免各 store 直接耦合引擎实现。
 */
import type { GoEngine } from '../engines/types'
import { localEngine } from '../engines/localEngine'
import { wasmEngine } from '../engines/wasmEngine'
import { runBenchmark } from '../engines/benchmark'
import { useSettingsStore } from '../stores/settingsStore'
import { useUiStore } from '../stores/uiStore'

/** 获取当前激活的引擎实例 */
export function getCurrentEngine(): GoEngine {
  const { engineSource } = useSettingsStore.getState()
  return engineSource === 'browser' ? wasmEngine : localEngine
}

/** 尝试初始化当前引擎（静默失败，未就绪由 store 层处理） */
export async function initEngine(): Promise<void> {
  const engine = getCurrentEngine()
  try {
    await engine.init()
  } catch (e) {
    console.warn('[EngineManager] 引擎初始化失败:', e)
  }
}

/**
 * 进入页面时的自动初始化：
 * - browser：加载 WASM 主引擎（显示全局进度条），后台预载另一模型测速
 * - local：静默连接本地后端
 */
export async function autoInitEngines(): Promise<void> {
  const { engineSource } = useSettingsStore.getState()
  if (engineSource === 'browser') {
    await preloadWasmModels()
  } else {
    await initEngine()
  }
}

/** 若 WASM 模型尚未测过基准，则测一次并保存（模型收敛后仅 b6c96） */
async function benchmarkWasmIfNeeded(
  engine: import('../engines/wasmEngine').WasmEngine,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const { wasmBenchmarkByModel, recordWasmBenchmark } = useSettingsStore.getState()
  if ((wasmBenchmarkByModel.b6c96 ?? -1) > 0) return
  try {
    // rounds 不传：按引擎来源自动选择（WASM 2 次 / Local 3 次）
    const { score } = await runBenchmark(engine, undefined, onProgress)
    engine.setBenchmarkScore(score)
    recordWasmBenchmark('b6c96', score)
  } catch (e) {
    console.warn('[EngineManager] WASM 模型 b6c96 测速失败:', e)
  }
}

/** 进行中的预载 Promise（单例去重：StrictMode 双执行或重复调用时共享同一次） */
let preloadPromise: Promise<void> | null = null

/**
 * 进入页面时预载 WASM 模型并自动测速。
 * 并发/重复调用共享同一次执行，避免多个进度写入者交替覆盖导致进度条回跳。
 */
export function preloadWasmModels(): Promise<void> {
  if (!preloadPromise) {
    preloadPromise = doPreloadWasmModels().finally(() => {
      preloadPromise = null
    })
  }
  return preloadPromise
}

async function doPreloadWasmModels(): Promise<void> {
  const { engineSource } = useSettingsStore.getState()
  if (engineSource !== 'browser') return

  const { setWasmLoad } = useUiStore.getState()

  // 单模型加载（模型收敛后仅 b6c96）：init（0~60%）+ 测速（60~100%）
  let mainFrac = 0
  let targetPct = 0
  let displayed = 0
  let lastMsg = '正在加载 WASM 引擎…'
  let timer: number | null = null

  const tick = () => {
    if (displayed < targetPct) {
      // 平滑逼近目标进度：单调递增、不回跳（真实任务推进后按帧补足显示值）
      displayed = Math.min(targetPct, displayed + 1.5)
      setWasmLoad({ loading: true, msg: lastMsg, pct: Math.round(displayed) })
    }
  }

  const publish = (msg: string | undefined, frac?: number) => {
    if (frac != null) mainFrac = Math.max(mainFrac, frac)
    if (msg) lastMsg = msg
    targetPct = Math.max(targetPct, Math.round(mainFrac * 100))
    if (!timer) timer = setInterval(tick, 250)
  }
  publish('正在加载 WASM 引擎…', 0.03)

  const main = (async () => {
    await wasmEngine.init((msg, pct) => {
      publish(`正在加载 WASM 引擎：${msg}`, pct != null ? (pct / 100) * 0.6 : 0.05)
    })
    publish('正在测试引擎速度…', 0.62)
    await benchmarkWasmIfNeeded(wasmEngine, (done, total) => {
      publish('正在测试引擎速度…', 0.6 + (done / total) * 0.4)
    })
    publish('测速完成', 1)
  })()

  await Promise.allSettled([main])
  // 全部真实完成：立即关闭加载页。加载已完成就不再由 tick 匀速爬满 100%，
  // 避免为了视觉平滑而拖延进入时间。
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  setWasmLoad({ loading: false, msg: '' })
}
