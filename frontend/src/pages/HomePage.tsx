/**
 * 首页：学习进度概览 + 功能入口。
 * 阶段一仅「对弈」可用，其余模块在后续阶段实现。
 */
import { Link } from 'react-router-dom'

interface Entry {
  to: string
  title: string
  desc: string
  ready: boolean
}

const ENTRIES: Entry[] = [
  { to: '/play', title: '对弈', desc: '本地双人对弈 / 人机对弈', ready: true },
  { to: '/assessment', title: '棋力评估', desc: '四阶段定级测试', ready: true },
  { to: '/course', title: '课程', desc: '入门到进阶教学', ready: true },
  { to: '/review', title: '复盘', desc: '逐手回看 + AI 解说', ready: false },
]

export default function HomePage() {
  return (
    <div className="home-page">
      <h1>围棋 AI 教学平台</h1>
      <p className="subtitle">从零基础到业余段位的智能学习助手</p>
      <div className="entry-grid">
        {ENTRIES.map((e) =>
          e.ready ? (
            <Link key={e.to} to={e.to} className="entry-card">
              <h2>{e.title}</h2>
              <p>{e.desc}</p>
            </Link>
          ) : (
            <div key={e.to} className="entry-card disabled">
              <h2>
                {e.title}
                <span className="badge">敬请期待</span>
              </h2>
              <p>{e.desc}</p>
            </div>
          ),
        )}
      </div>
    </div>
  )
}
