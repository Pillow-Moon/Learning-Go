"""AI 解说相关的请求/响应模型。

解说管线采用「结构化中间表示」：KataGo 负责棋局推理，
前端把分析结果 + 落子信息组装成 CommentaryRequest，
后端据此构造提示词调用 DeepSeek 生成自然语言教学解说。
"""
from __future__ import annotations

from pydantic import BaseModel, Field


class CommentaryCandidate(BaseModel):
    """候选选点（来自 KataGo 分析）。"""

    move: str | None = None  # GTP 坐标，如 "Q10"
    winrate: float | None = None
    score_lead: float | None = None
    visits: int | None = None
    pv: list[str] = Field(default_factory=list)  # 变化图（GTP 坐标序列）


class CommentaryRequest(BaseModel):
    """解说请求：当前局面 + KataGo 分析 + 教学上下文。"""

    move_number: int
    player: str  # 'black' / 'white'（刚落子的一方）
    move: str | None = None  # 刚落子的 GTP 坐标；pass 为 "pass"
    board_size: int = 19
    # 教学难度分级：beginner / intermediate / advanced
    level: str = "beginner"
    # KataGo 分析数据
    candidates: list[CommentaryCandidate] = Field(default_factory=list)
    root_winrate: float | None = None
    root_score_lead: float | None = None
    # 最近局势摘要（可选，用于上下文连贯）
    recent_summary: str | None = None


class CommentaryTaskResponse(BaseModel):
    task_id: str
