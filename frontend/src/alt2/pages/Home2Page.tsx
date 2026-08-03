/**
 * Home2Page —— 精简版首页
 * 核心入口：研究·复盘 / 定式 / 诊断 / 设置 + 最近对局（IndexedDB 真实数据）。
 * 2026-08 精简：AI 对弈已删除，首页不再提供对弈入口；图标用内联 SVG（避免 emoji 字体缺失显示方框）。
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listGames, type GameRecord } from '../../lib/db'

/** 内联 SVG 图标（stroke=currentColor，随主题变色；参照 App.tsx 主题按钮写法） */
const ICON_STYLE = {
  width: 26,
  height: 26,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

const Icons = {
  study: (
    <svg {...ICON_STYLE}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
      <path d="M8.5 11h5M11 8.5v5" />
    </svg>
  ),
  joseki: (
    <svg {...ICON_STYLE}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      <path d="M9 7h7M9 11h5" />
    </svg>
  ),
  diagnosis: (
    <svg {...ICON_STYLE}>
      <path d="M4 20h16" />
      <rect x="6" y="12" width="3" height="8" rx="1" />
      <rect x="10.5" y="7" width="3" height="13" rx="1" />
      <rect x="15" y="3" width="3" height="17" rx="1" />
    </svg>
  ),
  settings: (
    <svg {...ICON_STYLE}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.08a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.08a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z" />
    </svg>
  ),
}

const ENTRIES = [
  {
    to: '/study',
    title: '研究·复盘',
    desc: 'SGF 导入、摆子、候选点、整盘分析与关键点标注',
    icon: Icons.study,
  },
  {
    to: '/joseki',
    title: '定式',
    desc: 'KOGO 定式辞典：8 大分类 3800+ 变化',
    icon: Icons.joseki,
  },
  {
    to: '/diagnosis',
    title: '诊断',
    desc: '错误分类统计与个性化训练处方',
    icon: Icons.diagnosis,
  },
  {
    to: '/settings',
    title: '设置',
    desc: '本地引擎 / 棋盘 / 棋子 / 主题',
    icon: Icons.settings,
  },
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
      <p className="subtitle">对局研究 · 复盘 · 诊断 · 定式 —— 本地运行</p>

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
              <div className="v2-empty">暂无对局，去星阵等平台对弈后导入 SGF 复盘</div>
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
