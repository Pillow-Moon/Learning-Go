/**
 * useEngineStatus: 轮询两个引擎的状态，用于设置页展示。
 */
import { useState, useEffect, useCallback } from 'react'
import { localEngine } from './localEngine'
import { wasmEngine } from './wasmEngine'
import type { EngineInfo } from './types'

export interface DualEngineStatus {
  local: EngineInfo
  browser: EngineInfo
}

export function useEngineStatus(pollMs = 3000) {
  const [status, setStatus] = useState<DualEngineStatus>({
    local: { ...localEngine.getInfo() },
    browser: { ...wasmEngine.getInfo() },
  })

  const refresh = useCallback(() => {
    setStatus({
      local: { ...localEngine.getInfo() },
      browser: { ...wasmEngine.getInfo() },
    })
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, pollMs)
    return () => clearInterval(id)
  }, [pollMs, refresh])

  return status
}
