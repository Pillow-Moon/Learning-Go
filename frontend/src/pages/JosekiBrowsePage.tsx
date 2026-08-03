/**
 * JosekiBrowsePage —— 定式教学（KOGO 全量定式辞典）
 * 数据源：JOSEKI_KOGO（8 家族、3864 条变化线，左上角归一化坐标，黑先交替）
 * 布局：左栏家族 + 定式簇列表，中央棋盘逐手播放，右栏变化线与导航。
 * 定式簇 = 共享变化前缀的线集合（同一簇即同一定式的多个变化）。
 */
import { useEffect, useMemo, useState } from 'react'
import GoBoardCanvas from '../components/GoBoardCanvas'
import { FirstIcon, PrevIcon, NextIcon, LastIcon } from '../components/NavIcons'
import { JOSEKI_KOGO } from '../data/josekiKogo'
import { buildBoardFromMoves } from '../stores/reviewStore'
import type { JosekiLine } from '../data/joseki'
import type { Move, Player, Vertex } from '../lib/types'

/** 定式簇：共享前缀的多条变化线 */
interface Cluster {
  key: string
  title: string
  lines: JosekiLine[]
}

/** 变化线名 → 簇（去掉最后一段变化名） */
function clusterOf(name: string): string {
  const parts = name.split(' · ')
  return parts.length > 1 ? parts.slice(0, -1).join(' · ') : name
}

const CONFIDENCE_LABEL: Record<JosekiLine['confidence'], string> = {
  high: '常见型',
  medium: '变体',
  unverified: '待复核',
}

export default function JosekiBrowsePage() {
  const [familyIdx, setFamilyIdx] = useState(0)
  const [clusterKey, setClusterKey] = useState<string | null>(null)
  const [lineIdx, setLineIdx] = useState(0)
  const [current, setCurrent] = useState(0)

  const family = JOSEKI_KOGO[familyIdx]

  // 当前家族的定式簇
  const clusters = useMemo<Cluster[]>(() => {
    const map = new Map<string, JosekiLine[]>()
    for (const l of family.lines) {
      const key = clusterOf(l.name)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(l)
    }
    return [...map.entries()].map(([key, lines]) => ({ key, title: key, lines }))
  }, [family])

  // 选中簇/家族变化时重置状态
  useEffect(() => {
    setClusterKey(null)
    setLineIdx(0)
    setCurrent(0)
  }, [familyIdx])

  const cluster = clusterKey
    ? clusters.find((c) => c.key === clusterKey) ?? null
    : null
  const line: JosekiLine | null =
    cluster && cluster.lines[lineIdx] ? cluster.lines[lineIdx] : null
  const total = line?.moves.length ?? 0

  // 切换簇/线时重置手数
  useEffect(() => {
    setCurrent(0)
  }, [clusterKey, lineIdx])

  // 当前线 → GoBoard（左上角归一化坐标，黑先交替）
  const moveList: Move[] = useMemo(
    () =>
      (line?.moves ?? []).map(([x, y], i) => ({
        n: i + 1,
        color: (i % 2 === 0 ? 1 : -1) as Player,
        vertex: [x, y] as Vertex,
        pass: false,
      })),
    [line],
  )
  const board = useMemo(
    () => buildBoardFromMoves(19, moveList.slice(0, current)),
    [moveList, current],
  )
  // 切换定式/簇时 line 先变而 current 异步重置，moveList 可能暂时短于 current，必须判空
  const prevMove = current > 0 ? moveList[current - 1] : null
  const lastVertex: Vertex | null = prevMove && !prevMove.pass ? prevMove.vertex : null
  const curPlayer: Player = current % 2 === 0 ? 1 : -1

  const pickFamily = (idx: number) => {
    setFamilyIdx(idx)
  }

  const pickCluster = (key: string) => {
    setClusterKey(key)
    setLineIdx(0)
  }

  return (
    <div className="v2-page">
      <div className="v2-layout study">
        {/* ===== 左栏：家族 + 定式簇 ===== */}
        <aside className="v2-col v2-left">
          <div className="v2-panel">
            <div className="v2-panel-head">
              定式家族
              <span className="hint-sm">KOGO 辞典</span>
            </div>
            <div className="v2-tree">
              {JOSEKI_KOGO.map((f, i) => (
                <div
                  key={f.id}
                  className={`v2-tree-row ${i === familyIdx ? 'current' : ''}`}
                  onClick={() => pickFamily(i)}
                >
                  <span className="v2-tree-tag main">{f.name}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {f.lines.length} 线
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="v2-panel">
            <div className="v2-panel-head">
              定式
              <span className="hint-sm">{family.name}</span>
            </div>
            <div className="v2-tree">
              {clusters.length === 0 && <div className="v2-empty">暂无数据</div>}
              {clusters.slice(0, 200).map((c) => (
                <div
                  key={c.key}
                  className={`v2-tree-row ${clusterKey === c.key ? 'current' : ''}`}
                  onClick={() => pickCluster(c.key)}
                  title={c.title}
                >
                  <span
                    className="v2-tree-tag"
                    style={{ background: 'var(--text-muted)', maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis' }}
                  >
                    {c.lines.length} 变
                  </span>
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontSize: 12.5,
                    }}
                  >
                    {c.title.replace(`${family.name} · `, '')}
                  </span>
                </div>
              ))}
              {clusters.length > 200 && (
                <div className="v2-empty">仅显示前 200 个定式</div>
              )}
            </div>
          </div>
        </aside>

        {/* ===== 中央：棋盘 ===== */}
        <div className="v2-col v2-board-col">
          <div className="v2-board-wrap">
            <GoBoardCanvas
              board={board}
              boardSize={19}
              currentPlayer={curPlayer}
              lastMove={lastVertex}
              interactive={false}
              candidates={null}
              ownership={null}
              highlights={null}
            />
          </div>

          <div className="v2-statusbar">
            <span className="v2-stat">
              手数 <b>{current}</b> / {total}
            </span>
            <span className="v2-stat">
              定式 <b>{cluster ? cluster.title : '—'}</b>
            </span>
            <span className="v2-stat">
              变化 {line ? `${lineIdx + 1}/${cluster?.lines.length ?? 0}` : '—'}
            </span>
          </div>
        </div>

        {/* ===== 右栏：变化线与导航 ===== */}
        <aside className="v2-col v2-right">
          <div className="side-tabs">
            <div className="side-tabbar">
              <div className="side-tab active">变化</div>
            </div>
            <div className="controls">
              {/* 当前线信息 */}
              <div className="v2-comment">
                <div className="v2-comment-title">当前变化</div>
                <div className="v2-comment-text" style={{ fontSize: 13 }}>
                  {line?.name ?? '请选择定式'}
                </div>
                {line && (
                  <div style={{ marginTop: 6 }}>
                    <span className="v2-rank-badge" style={{ marginTop: 0 }}>
                      {CONFIDENCE_LABEL[line.confidence]}
                    </span>
                  </div>
                )}
              </div>

              {/* 逐手导航 */}
              <div className="review-nav-buttons">
                <button className="btn" disabled={current <= 0} onClick={() => setCurrent(0)}>
                  <FirstIcon /> 首
                </button>
                <button
                  className="btn"
                  disabled={current <= 0}
                  onClick={() => setCurrent((c) => Math.max(0, c - 1))}
                >
                  <PrevIcon /> 退
                </button>
                <button
                  className="btn"
                  disabled={current >= total}
                  onClick={() => setCurrent((c) => Math.min(total, c + 1))}
                >
                  进 <NextIcon />
                </button>
                <button
                  className="btn"
                  disabled={current >= total}
                  onClick={() => setCurrent(total)}
                >
                  尾 <LastIcon />
                </button>
              </div>

              {/* 同簇变化线列表 */}
              {cluster && (
                <>
                  <div className="v2-section-title" style={{ fontSize: 14, marginBottom: 8 }}>
                    本定式变化（{cluster.lines.length}）
                  </div>
                  <div className="v2-tree">
                    {cluster.lines.map((l, i) => (
                      <div
                        key={i}
                        className={`v2-tree-row ${i === lineIdx ? 'current' : ''}`}
                        onClick={() => setLineIdx(i)}
                        title={l.name}
                      >
                        <span className="v2-tree-tag main">{i + 1}</span>
                        <span
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            fontSize: 12.5,
                          }}
                        >
                          {l.name.split(' · ').pop()}
                          <span style={{ color: 'var(--text-muted)', marginLeft: 6, fontSize: 11 }}>
                            {l.moves.length} 手
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
