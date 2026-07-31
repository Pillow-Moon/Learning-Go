"""棋力评估相关请求/响应模型。"""
from __future__ import annotations

from pydantic import BaseModel, Field


class ProblemResult(BaseModel):
    """一道题的作答结果。"""

    category: str  # 规则认知 / 基础技巧
    tag: str  # 气 / 吃子 / 征子 / ...
    correct: bool


class GameOverlap(BaseModel):
    """一局实战对弈的落子重合度统计。"""

    max_visits: int
    # 用户落子命中 KataGo top-3 推荐的比例（0-1）
    overlap_rate: float
    move_count: int = 0


class AssessmentReportRequest(BaseModel):
    problem_results: list[ProblemResult] = Field(default_factory=list)
    game_overlaps: list[GameOverlap] = Field(default_factory=list)


class RecommendedCourse(BaseModel):
    id: int
    title: str
    dimension: str


class AssessmentReport(BaseModel):
    level: str  # 如 "15级" / "业余1段"
    overall_score: float  # 0-100
    # 五维能力雷达：吃子 / 围空 / 死活 / 布局 / 官子，各 0-100
    radar: dict[str, float] = Field(default_factory=dict)
    weak_dimensions: list[str] = Field(default_factory=list)
    recommended_courses: list[RecommendedCourse] = Field(default_factory=list)


class AnswerRequest(BaseModel):
    problem_id: int
    vertex: str  # 用户点击的 GTP 坐标


class AnswerResponse(BaseModel):
    correct: bool
    correct_move: str
    explanation: str
