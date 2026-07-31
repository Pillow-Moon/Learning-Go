"""棋力评估服务：从答题结果 + 实战重合度计算定级报告。

五维雷达：吃子 / 围空 / 死活 / 布局 / 官子。
- 吃子、死活 来自练习题正确率（按标签归类）。
- 布局、围空、官子 来自三局实战（按难度递增）的落子重合度。
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.course import Course
from app.schemas.assessment import (
    AssessmentReport,
    AssessmentReportRequest,
    RecommendedCourse,
)

# 标签 -> 雷达维度
CAPTURE_TAGS = {"吃子", "征子", "枷吃", "倒扑", "接不归", "气"}
LIFE_DEATH_TAGS = {"眼", "双活", "打劫", "禁入点"}

DIMENSIONS = ["吃子", "围空", "死活", "布局", "官子"]


def _accuracy(results: list, tags: set[str]) -> float | None:
    """指定标签集合内的正确率（0-1）；无相关题目返回 None。"""
    relevant = [r for r in results if r.tag in tags]
    if not relevant:
        return None
    return sum(1 for r in relevant if r.correct) / len(relevant)


def _level_from_score(score: float) -> str:
    """综合分（0-100）-> 棋力等级。"""
    if score >= 90:
        return "业余1段"
    if score >= 80:
        return "1级"
    if score >= 70:
        return "4级"
    if score >= 60:
        return "7级"
    if score >= 50:
        return "10级"
    if score >= 40:
        return "15级"
    if score >= 30:
        return "20级"
    if score >= 20:
        return "25级"
    return "30级"


def compute_report(req: AssessmentReportRequest, db: Session) -> AssessmentReport:
    radar: dict[str, float] = {}

    # 答题维度
    cap = _accuracy(req.problem_results, CAPTURE_TAGS)
    life = _accuracy(req.problem_results, LIFE_DEATH_TAGS)
    if cap is not None:
        radar["吃子"] = round(cap * 100, 1)
    if life is not None:
        radar["死活"] = round(life * 100, 1)

    # 实战维度：按难度（max_visits）升序映射到 布局/围空/官子
    games = sorted(req.game_overlaps, key=lambda g: g.max_visits)
    game_dims = ["布局", "围空", "官子"]
    for dim, g in zip(game_dims, games):
        radar[dim] = round(max(0.0, min(1.0, g.overlap_rate)) * 100, 1)

    # 综合分：已有维度的平均
    present = list(radar.values())
    overall = round(sum(present) / len(present), 1) if present else 0.0
    level = _level_from_score(overall)

    # 薄弱维度：低于 60 分，按分数升序
    weak = sorted(
        [d for d in DIMENSIONS if radar.get(d, 0) < 60],
        key=lambda d: radar.get(d, 0),
    )

    # 课程推荐：匹配薄弱维度的课程
    recommended: list[RecommendedCourse] = []
    if weak:
        stmt = select(Course).where(Course.dimension.in_(weak)).order_by(
            Course.difficulty, Course.order_index
        )
        courses = db.scalars(stmt).all()
        recommended = [
            RecommendedCourse(id=c.id, title=c.title, dimension=c.dimension)
            for c in courses[:5]
        ]
    if not recommended:
        # 无薄弱项则推荐入门课程
        stmt = select(Course).order_by(Course.difficulty, Course.order_index).limit(3)
        courses = db.scalars(stmt).all()
        recommended = [
            RecommendedCourse(id=c.id, title=c.title, dimension=c.dimension)
            for c in courses
        ]

    return AssessmentReport(
        level=level,
        overall_score=overall,
        radar=radar,
        weak_dimensions=weak,
        recommended_courses=recommended,
    )
