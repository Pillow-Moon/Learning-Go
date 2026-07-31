/**
 * 课程列表页（纯前端：从 JSON 加载）。
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import coursesData from '../data/courses.json'

interface CourseSummary {
  id: number; title: string; description: string
  dimension: string; difficulty: number; lesson_count: number
}

export default function CourseListPage() {
  const [courses] = useState<CourseSummary[]>(() =>
    coursesData.map((c: any) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      dimension: c.dimension,
      difficulty: c.difficulty,
      lesson_count: c.lessons?.length ?? 0,
    })),
  )

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
