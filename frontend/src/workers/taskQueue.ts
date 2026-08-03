/**
 * KataGo Worker 串行任务队列（从 katago.worker.ts 解耦的纯逻辑）。
 *
 * 语义（与消息处理解耦，供单元测试直接覆盖）：
 * - 串行执行：同一时刻只有一个任务在跑（单次 callMain 架构限制）
 * - urgent（对弈落子）：插入队首插队执行，且不受 cancel 影响
 * - cancel：跳过所有排队中的普通任务；正在运行的无法中断
 *   （单次 callMain 限制），其结果返回时会被主线程端忽略
 */

export interface QueuedTask {
  id: string
  urgent: boolean
  cancelled: boolean
  run: () => Promise<void>
}

let taskQueue: QueuedTask[] = []
let pumping = false

/** 串行执行队列（同一时刻只有一个任务在跑） */
export async function pumpQueue(): Promise<void> {
  if (pumping) return
  pumping = true
  while (taskQueue.length > 0) {
    const task = taskQueue.shift()!
    if (task.cancelled) continue
    try {
      await task.run()
    } catch {
      // run 内部已上报错误（postMessage error），这里兜底避免队列中断
    }
  }
  pumping = false
}

export function enqueueTask(task: QueuedTask): void {
  if (task.urgent) taskQueue.unshift(task)
  else taskQueue.push(task)
  void pumpQueue()
}

/** 取消所有排队中的普通任务（urgent 不受影响） */
export function cancelQueuedTasks(): void {
  for (const t of taskQueue) {
    if (!t.urgent) t.cancelled = true
  }
}

/** 测试专用：清空队列与运行状态（生产代码不调用） */
export function resetTaskQueue(): void {
  taskQueue = []
  pumping = false
}
