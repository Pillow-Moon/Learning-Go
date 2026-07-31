/**
 * KataGo WASM Web Worker（占位）。
 *
 * 消息协议：
 *   主线程 → Worker：{ type: 'init', modelData: ArrayBuffer }
 *                  { type: 'analyze', query: object }
 *                  { type: 'genmove', color, boardSize, komi, maxVisits, moves }
 *
 *   Worker → 主线程：{ type: 'ready', info: object }
 *                   { type: 'result', data: AnalysisResult }
 *                   { type: 'progress', visits: number }
 *                   { type: 'error', message: string }
 *
 * TODO: 集成 katago.js glue + katago.wasm 后实现。
 */
// @ts-nocheck -- WASM 未编译，Worker 为占位

self.onmessage = (_e: MessageEvent) => {
  // 占位：收到任何消息返回"未实现"
  self.postMessage({
    type: 'error',
    message:
      'KataGo WASM 引擎暂未编译。请使用本地 GPU 引擎。',
  })
}

// 标记为模块 Worker（供 Vite 识别）
export {}
