/**
 * 应用根组件：路由 + 顶部导航。
 */
import { useEffect, useState } from 'react'
import { Link, Route, Routes } from 'react-router-dom'

import HomePage from './pages/HomePage'
import PlayPage from './pages/PlayPage'
import AssessmentPage from './pages/AssessmentPage'
import CourseListPage from './pages/CourseListPage'
import CourseDetailPage from './pages/CourseDetailPage'
import SettingsPage from './pages/SettingsPage'
import ErrorBoundary from './components/ErrorBoundary'
import { autoInitEngines } from './engines/manager'
import { useSettingsStore } from './stores/settingsStore'
import { useUiStore } from './stores/uiStore'

/** 进入页面自动加载 WASM 引擎时的全屏加载页 */
function WasmLoadScreen() {
  const wasmLoad = useUiStore((s) => s.wasmLoad)
  // 安抚文案：随等待时间轮换，避免卡顿感
  const [comfort, setComfort] = useState('稍等几秒，马上就好')
  useEffect(() => {
    if (!wasmLoad.loading) return
    setComfort('稍等几秒，马上就好')
    const t1 = setTimeout(
      () => setComfort('首次加载需要一点时间，正在为您准备…'),
      6000,
    )
    const t2 = setTimeout(
      () => setComfort('网络较慢时请耐心等待，马上就好'),
      15000,
    )
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [wasmLoad.loading])

  if (!wasmLoad.loading) return null
  return (
    <div className="wasm-screen">
      <div className="wasm-screen-inner">
        <div className="wasm-screen-brand">围棋 AI 教学</div>
        <div className="wasm-screen-title">正在加载 AI 引擎…</div>
        <div className="wasm-screen-bar-row">
          <div
            className={
              wasmLoad.pct != null
                ? 'wasm-screen-bar'
                : 'wasm-screen-bar indeterminate'
            }
          >
            <div
              className="wasm-screen-fill"
              style={{ width: `${wasmLoad.pct ?? 40}%` }}
            />
          </div>
        </div>
        {wasmLoad.pct != null && (
          <div className="wasm-screen-pct">{wasmLoad.pct}%</div>
        )}
        <div className="wasm-screen-msg">{wasmLoad.msg}</div>
        <div className="wasm-screen-comfort">{comfort}</div>
      </div>
    </div>
  )
}

function ComingSoon({ title }: { title: string }) {
  return (
    <div className="coming-soon">
      <h1>{title}</h1>
      <p>该模块正在开发中，敬请期待。</p>
      <Link to="/" className="btn primary">
        返回首页
      </Link>
    </div>
  )
}

export default function App() {
  const uiTheme = useSettingsStore((s) => s.uiTheme)
  const setUiTheme = useSettingsStore((s) => s.setUiTheme)

  // 应用加载时自动初始化引擎（WASM 默认：加载主引擎显示进度条，后台预载另一模型测速）
  useEffect(() => {
    void autoInitEngines()
  }, [])

  // 应用夜间模式
  useEffect(() => {
    document.documentElement.dataset.theme = uiTheme
  }, [uiTheme])

  // 点击时同步应用主题，不依赖 useEffect 的异步时序（被动 effect 可能延迟到空闲调度，
  // 快速连点时会用旧闭包覆盖，导致「点了没反应、要再点一次」）
  const toggleTheme = () => {
    const next = uiTheme === 'dark' ? 'light' : 'dark'
    setUiTheme(next)
    document.documentElement.dataset.theme = next
  }

  return (
    <ErrorBoundary>
      <div className="app">
        <WasmLoadScreen />
        <header className="topbar">
          <Link to="/" className="brand">
            围棋 AI 教学
          </Link>
          <nav className="nav">
            <Link to="/play">对弈</Link>
            <Link to="/assessment">棋力评估</Link>
            <Link to="/course">课程</Link>
            <Link to="/settings">设置</Link>
            <button
              className="theme-toggle"
              title={uiTheme === 'dark' ? '切换到日间模式' : '切换到夜间模式'}
              onClick={toggleTheme}
            >
              {uiTheme === 'dark' ? (
                // 夜间模式：点击切换到日间，显示太阳
                <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="4.2" fill="none" />
                  <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8" />
                </svg>
              ) : (
                // 日间模式：点击切换到夜间，显示月亮
                <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </button>
          </nav>
        </header>
        <main className="main">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/play" element={<PlayPage />} />
            <Route path="/assessment" element={<AssessmentPage />} />
            <Route path="/course" element={<CourseListPage />} />
            <Route path="/course/:id" element={<CourseDetailPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/review" element={<ComingSoon title="复盘" />} />
            <Route path="*" element={<ComingSoon title="页面不存在" />} />
          </Routes>
        </main>
      </div>
    </ErrorBoundary>
  )
}
