/**
 * KataGo WASM Web Worker。
 *
 * 消息协议：
 *   主线程 → Worker:
 *     { type: 'init', wasmUrl: string, modelUrl: string }
 *     { type: 'analyze', id: string, query: object }
 *
 *   Worker → 主线程:
 *     { type: 'ready' }
 *     { type: 'result', id: string, data: AnalysisResult }
 *     { type: 'error', id: string, message: string }
 *     { type: 'progress', text: string }
 *
 * 依赖：frontend/wasm/katago.js（Emscripten ES6 modular 构建）
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KatagoModule = any

let mod: KatagoModule | null = null

async function loadWasm(wasmUrl: string): Promise<KatagoModule> {
  // 动态导入 ES6 模块（katago.js 通过 -sMODULARIZE -sEXPORT_ES6 编译）
  const katagoFactory = await import(/* @vite-ignore */ wasmUrl)
  const instance = await katagoFactory.default()
  return instance
}

/** 将模型文件写入 MEMFS */
async function loadModel(module: KatagoModule, modelUrl: string): Promise<void> {
  const resp = await fetch(modelUrl)
  const buffer = await resp.arrayBuffer()
  module.FS.writeFile('/model.bin.gz', new Uint8Array(buffer))
}

/** 发送 analysis query，返回结果 */
function runAnalysis(
  module: KatagoModule,
  query: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const json = JSON.stringify(query) + '\n'
    // 通过 Emscripten 的标准输入模拟发送 query
    // 具体取决于 katago.js 的编译选项
    // PROXY_TO_PTHREAD 模式下需要在主线程触发
    try {
      const result = module._runAnalysisQuery?.(json)
      if (result) {
        resolve(JSON.parse(result))
      } else {
        reject(new Error('Analysis returned no result'))
      }
    } catch (e) {
      reject(e)
    }
  })
}

self.onmessage = async (e: MessageEvent) => {
  const { type } = e.data

  if (type === 'init') {
    try {
      const { wasmUrl, modelUrl } = e.data
      self.postMessage({ type: 'progress', text: '加载 WASM 引擎...' })
      mod = await loadWasm(wasmUrl)

      self.postMessage({ type: 'progress', text: '加载模型...' })
      await loadModel(mod, modelUrl)

      self.postMessage({ type: 'ready' })
    } catch (err) {
      self.postMessage({
        type: 'error',
        id: '',
        message: `初始化失败: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
    return
  }

  if (type === 'analyze') {
    if (!mod) {
      self.postMessage({ type: 'error', id: e.data.id, message: '引擎未初始化' })
      return
    }
    try {
      const result = await runAnalysis(mod, e.data.query)
      self.postMessage({ type: 'result', id: e.data.id, data: result })
    } catch (err) {
      self.postMessage({
        type: 'error',
        id: e.data.id,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

export {}
