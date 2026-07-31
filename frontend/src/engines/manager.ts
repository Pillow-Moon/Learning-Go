/**
 * 引擎管理器：根据用户设置返回当前激活的 GoEngine 实例。
 *
 * 在 stores 中通过 getCurrentEngine() 获取引擎，避免各 store 直接耦合引擎实现。
 */
import type { GoEngine } from '../engines/types'
import { localEngine } from '../engines/localEngine'
import { wasmEngine } from '../engines/wasmEngine'
import { useSettingsStore } from '../stores/settingsStore'

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
