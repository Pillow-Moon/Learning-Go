/**
 * 课程列表页。
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { getCourses, type CourseListItem } from '../services/api'

export default function CourseListPage() {
  const [courses, setCourses] = useState<CourseListItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getCourses()
      .then(setCourses)
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <p className="hint">加载课程中…</p>

  return (
    <div className="course-list-page">
      <h1>课程</h1>
      <p className="subtitle">从入门到进阶的系统教学。建议先完成棋力评估获取推荐。</p>
      <div className="entry-grid">
        {courses.map((c) => (
          <Link key={c.id} to={`/course/${c.id}`} className="entry-card">
            <h2>{c.title}</h2>
            <p>{c.description}</p>
            <p className="hint">
              维度：{c.dimension} · 难度 {c.difficulty} · {c.lesson_count} 节
            </p>
          </Link>
        ))}
      </div>
    </div>
  )
}
