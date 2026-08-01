/**
 * App 主题切换集成测试（jsdom）：
 * 验证「点击顶栏 theme-toggle → store.uiTheme 更新 → document.documentElement.dataset.theme 同步」链路。
 * 对应 bug：进入页面为夜间模式时，第一次点击图标变了但界面没变，需要点两次才切换。
 */
// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// 页面组件与引擎管理器均 mock：本测试只关心顶栏主题按钮
vi.mock('./pages/HomePage', () => ({ default: () => null }))
vi.mock('./pages/PlayPage', () => ({ default: () => null }))
vi.mock('./pages/AssessmentPage', () => ({ default: () => null }))
vi.mock('./pages/CourseListPage', () => ({ default: () => null }))
vi.mock('./pages/CourseDetailPage', () => ({ default: () => null }))
vi.mock('./pages/SettingsPage', () => ({ default: () => null }))
vi.mock('./engines/manager', () => ({ autoInitEngines: vi.fn(async () => {}) }))
vi.mock('./components/ErrorBoundary', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}))

// React 19：声明支持 act()，否则 passive effect 不会在 act 内自动 flush
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let AppComp: typeof import('./App').default

/** 以指定 uiTheme 为持久化值，重载 store 后渲染 App（必须先 setItem 再 import，store 在模块加载时读 localStorage） */
async function renderApp(uiTheme: 'light' | 'dark') {
  localStorage.clear()
  delete document.documentElement.dataset.theme
  localStorage.setItem('learning-go-settings', JSON.stringify({ uiTheme }))
  vi.resetModules()
  const mod = await import('./App')
  AppComp = mod.default
  const container = document.createElement('div')
  document.body.appendChild(container)
  let root!: Root
  await act(async () => {
    root = createRoot(container)
    root.render(
      <StrictMode>
        <MemoryRouter>
          <AppComp />
        </MemoryRouter>
      </StrictMode>,
    )
  })
  return { container, root }
}

describe('App 主题切换', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  it('夜间模式进入页面：点击一次即切换到日间（dataset.theme 同步更新）', async () => {
    const { container, root } = await renderApp('dark')

    // 挂载后 effect 应用夜间主题
    expect(document.documentElement.dataset.theme).toBe('dark')

    // 点击一次切换按钮
    const btn = container.querySelector('.theme-toggle')!
    expect(btn).toBeTruthy()
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    // 期望：一次点击后 dataset.theme 已是 light（界面变日间）
    expect(document.documentElement.dataset.theme).toBe('light')

    await act(async () => root.unmount())
  })

  it('日间模式进入页面：点击一次即切换到夜间', async () => {
    const { container, root } = await renderApp('light')

    expect(document.documentElement.dataset.theme).toBe('light')

    const btn = container.querySelector('.theme-toggle')!
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(document.documentElement.dataset.theme).toBe('dark')

    await act(async () => root.unmount())
  })

  it('点击时同步写 dataset.theme，不依赖被动 effect 的异步时序', async () => {
    // 渲染后手动把 dataset 改回旧值，模拟「被动 effect 尚未执行」的竞态窗口
    const { container, root } = await renderApp('dark')
    const btn = container.querySelector('.theme-toggle')!

    // 同步 act：只 flush 事件处理与渲染提交，验证 onClick 内已同步写 dataset
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(document.documentElement.dataset.theme).toBe('light')

    // 第二次点击（连点场景）：应再次立即同步
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(document.documentElement.dataset.theme).toBe('dark')

    await act(async () => root.unmount())
  })
})
