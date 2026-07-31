/**
 * 应用根组件：路由 + 顶部导航。
 */
import { useEffect } from 'react'
import { Link, Route, Routes } from 'react-router-dom'

import HomePage from './pages/HomePage'
import PlayPage from './pages/PlayPage'
import AssessmentPage from './pages/AssessmentPage'
import CourseListPage from './pages/CourseListPage'
import CourseDetailPage from './pages/CourseDetailPage'
import SettingsPage from './pages/SettingsPage'
import ErrorBoundary from './components/ErrorBoundary'
import { initEngine } from './engines/manager'

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
  // 应用加载时自动尝试连接引擎
  useEffect(() => {
    initEngine()
  }, [])

  return (
    <ErrorBoundary>
      <div className="app">
        <header className="topbar">
          <Link to="/" className="brand">
            围棋 AI 教学
          </Link>
          <nav className="nav">
            <Link to="/play">对弈</Link>
            <Link to="/assessment">棋力评估</Link>
            <Link to="/course">课程</Link>
            <Link to="/settings">设置</Link>
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
