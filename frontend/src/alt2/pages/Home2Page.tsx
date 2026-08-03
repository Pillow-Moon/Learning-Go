/**
 * Home2Page —— 精简版首页
 * 核心入口：对弈 / 研究 / 复盘 / 定式 / 设置 + 最近对局（IndexedDB 真实数据）。
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listGames, type GameRecord } from '../../lib/db'

const ENTRIES = [
  { to: '/play', title: '对弈', desc: '与本地 AI 对弈，棋谱自动保存', icon: '⚔' },
  { to: '/study', title: '对局研究', desc: '摆子、候选点、整盘分析与关键点标注', icon: '🔍' },
  { to: '/study', title: '复盘', desc: '逐手回看、胜率曲线，恶手疑问手一目了然', icon: '🔄' },
  { to: '/joseki', title: '定式', desc: 'KOGO 定式辞典：8 大分类 3800+ 变化', icon: '📖' },
  { to: '/settings', title: '设置', desc: '本地引擎 / 棋盘 / 棋子 / 主题', icon: '⚙' },
]

export default function Home2Page() {
  const [recent, setRecent] = useState<GameRecord[]>([])

  useEffect(() => {
    listGames()
      .then((all) => setRecent(all.slice(-4).reverse()))
      .catch(() => setRecent([]))
  }, [])

  return (
    <div className="home-page">
      <h1>围棋 AI 教学</h1>
      <p className="subtitle">本地 AI 对弈 · 研究 · 复盘 · 定式 —— 不联网，不花钱</p>

      <div className="entry-grid">
        {ENTRIES.map((e) => (
          <Link key={e.to} to={e.to} className="entry-card">
            <div className="v2-entry-icon">{e.icon}</div>
            <h2 style={{ fontSize: 18 }}>{e.title}</h2>
            <p>{e.desc}</p>
          </Link>
        ))}
      </div>

      <div className="v2-home-split">
        <div>
          <div className="v2-section-title">最近对局</div>
          <div className="v2-recent-list">
            {recent.length === 0 && (
              <div className="v2-empty">暂无对局，去「对弈」下一盘吧</div>
            )}
            {recent.map((g) => (
              <Link key={g.id} to="/study" className="v2-recent-item">
                <div className="v2-recent-top">
                  <span className="v2-recent-result">{g.result}</span>
                  <span className="v2-recent-stamp">
                    {new Date(g.createdAt).toLocaleString('zh-CN', { hour12: false })}
                  </span>
                </div>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
                  {g.boardSize} 路对局 · {g.moves.length} 手
                </div>
                <span className="v2-recent-moves">点击进入研究页查看</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
