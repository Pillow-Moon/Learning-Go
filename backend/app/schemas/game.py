"""对局与分析相关的请求/响应模型。"""
from __future__ import annotations

from pydantic import BaseModel, Field


class MoveIn(BaseModel):
    """一手棋输入。color: 'B'/'W'；vertex 为 [x, y]，None 表示 pass。"""

    color: str
    vertex: tuple[int, int] | None = None


# ===== 人机对弈 =====


class GameMoveRequest(BaseModel):
    """请求 AI 应手。moves 为完整历史（含用户最新一手），AI 执 ai_color。"""

    board_size: int = 19
    komi: float = 7.5
    max_visits: int = 100
    moves: list[MoveIn] = Field(default_factory=list)
    ai_color: str = "W"


class GameMoveResponse(BaseModel):
    ai_move: tuple[int, int] | None
    ai_move_coord: str | None  # GTP 坐标，或 "pass"/"resign"


# ===== 局面分析 =====


class AnalysisRequest(BaseModel):
    """分析 moves 之后的局面。"""

    board_size: int = 19
    komi: float = 7.5
    max_visits: int = 100
    moves: list[MoveIn] = Field(default_factory=list)


class Candidate(BaseModel):
    move: tuple[int, int] | None
    winrate: float | None = None
    score_lead: float | None = None
    visits: int | None = None
    prior: float | None = None
    pv: list[tuple[int, int]] = Field(default_factory=list)


class AnalysisResult(BaseModel):
    board_size: int
    candidates: list[Candidate] = Field(default_factory=list)
    root: dict = Field(default_factory=dict)


class AnalysisTaskResponse(BaseModel):
    task_id: str
    status: str  # pending / done / error


class AnalysisStatusResponse(BaseModel):
    task_id: str
    status: str  # pending / done / error
    result: AnalysisResult | None = None
    error: str | None = None
