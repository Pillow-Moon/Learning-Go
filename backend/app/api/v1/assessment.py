"""棋力评估接口：取题、判题、生成定级报告。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.problem import Problem
from app.schemas.assessment import (
    AnswerRequest,
    AnswerResponse,
    AssessmentReport,
    AssessmentReportRequest,
)
from app.services.assessment import compute_report

router = APIRouter(prefix="/assessment", tags=["assessment"])


class ProblemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    category: str
    tag: str
    difficulty: int
    sgf: str


@router.get("/problems", response_model=list[ProblemOut])
def list_problems(
    category: str | None = Query(None),
    tag: str | None = Query(None),
    limit: int = Query(5, ge=1, le=50),
    db: Session = Depends(get_db),
) -> list[Problem]:
    """按类别/标签取题（用于自适应测试）。"""
    stmt = select(Problem)
    if category:
        stmt = stmt.where(Problem.category == category)
    if tag:
        stmt = stmt.where(Problem.tag == tag)
    stmt = stmt.order_by(Problem.difficulty, Problem.id).limit(limit)
    return list(db.scalars(stmt).all())


@router.post("/answer", response_model=AnswerResponse)
def answer(req: AnswerRequest, db: Session = Depends(get_db)) -> AnswerResponse:
    """判定作答。vertex 为 GTP 坐标，与正解比较（忽略大小写）。"""
    problem = db.get(Problem, req.problem_id)
    if problem is None:
        raise HTTPException(status_code=404, detail="题目不存在")
    correct = req.vertex.strip().upper() == problem.correct_move.strip().upper()
    return AnswerResponse(
        correct=correct,
        correct_move=problem.correct_move,
        explanation=problem.explanation,
    )


@router.post("/report", response_model=AssessmentReport)
def report(
    req: AssessmentReportRequest, db: Session = Depends(get_db)
) -> AssessmentReport:
    """根据答题与实战重合度生成定级报告。"""
    return compute_report(req, db)
