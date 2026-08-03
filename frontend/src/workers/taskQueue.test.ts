/**
 * KataGo Worker 任务队列语义回归测试：
 * 串行执行、urgent 插队、cancel 取消排队中的普通任务。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  cancelQueuedTasks,
  enqueueTask,
  resetTaskQueue,
  type QueuedTask,
} from './taskQueue'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function makeTask(id: string, opts: { urgent?: boolean; delay?: number } = {}): {
  task: QueuedTask
  runs: () => number
} {
  let runs = 0
  const task: QueuedTask = {
    id,
    urgent: opts.urgent ?? false,
    cancelled: false,
    run: async () => {
      runs++
      if (opts.delay) await sleep(opts.delay)
    },
  }
  return { task, runs: () => runs }
}

beforeEach(() => resetTaskQueue())
afterEach(() => resetTaskQueue())

describe('worker 任务队列', () => {
  it('串行 FIFO：按入队顺序执行', async () => {
    const order: string[] = []
    enqueueTask({ id: 'a', urgent: false, cancelled: false, run: async () => { order.push('a') } })
    enqueueTask({ id: 'b', urgent: false, cancelled: false, run: async () => { order.push('b') } })
    await vi.waitFor(() => expect(order).toEqual(['a', 'b']))
  })

  it('urgent 任务插队：正在运行的任务完成后，urgent 先于普通任务执行', async () => {
    const order: string[] = []
    enqueueTask({
      id: 'slow',
      urgent: false,
      cancelled: false,
      run: async () => {
        order.push('slow')
        await sleep(30)
      },
    })
    await sleep(10) // 确保 slow 已开始运行（pumping）
    enqueueTask({ id: 'normal', urgent: false, cancelled: false, run: async () => { order.push('normal') } })
    enqueueTask({ id: 'urgent', urgent: true, cancelled: false, run: async () => { order.push('urgent') } })
    await vi.waitFor(() => expect(order).toEqual(['slow', 'urgent', 'normal']))
  })

  it('cancel 跳过排队中的普通任务，urgent 任务不受影响', async () => {
    const order: string[] = []
    enqueueTask({
      id: 'running',
      urgent: false,
      cancelled: false,
      run: async () => {
        order.push('running')
        await sleep(40)
      },
    })
    await sleep(10) // running 已开始
    enqueueTask({ id: 'queued', urgent: false, cancelled: false, run: async () => { order.push('queued') } })
    enqueueTask({ id: 'urgent', urgent: true, cancelled: false, run: async () => { order.push('urgent') } })
    cancelQueuedTasks()
    await vi.waitFor(() => expect(order).toEqual(['running', 'urgent']))
  })

  it('正在运行的任务无法被 cancel 中断', async () => {
    const { task, runs } = makeTask('long', { delay: 50 })
    enqueueTask(task)
    await sleep(10)
    cancelQueuedTasks()
    await vi.waitFor(() => expect(runs()).toBe(1))
    expect(task.cancelled).toBe(false)
  })

  it('单个任务异常不中断队列（后续任务照常执行）', async () => {
    const order: string[] = []
    enqueueTask({
      id: 'boom',
      urgent: false,
      cancelled: false,
      run: async () => {
        throw new Error('模拟分析失败')
      },
    })
    enqueueTask({ id: 'next', urgent: false, cancelled: false, run: async () => { order.push('next') } })
    await vi.waitFor(() => expect(order).toEqual(['next']))
  })
})
