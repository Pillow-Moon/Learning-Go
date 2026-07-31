"""课程系统接口：课程列表、详情、学习进度。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.database import get_db
from app.models.course import Course, CourseProgress, Lesson, Step

router = APIRouter(prefix="/course", tags=["course"])


# ===== 响应模型 =====


class StepOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    order_index: int
    sgf: str | None
    instruction: str
    expected_move: str | None
    explanation: str


class LessonOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    order_index: int
    steps: list[StepOut] = []


class CourseListItem(BaseModel):
    id: int
    title: str
    description: str
    dimension: str
    difficulty: int
    lesson_count: int


class CourseDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    description: str
    dimension: str
    difficulty: int
    lessons: list[LessonOut] = []


class ProgressUpdate(BaseModel):
    completed_lessons: int | None = None
    correct_count: int | None = None
    attempt_count: int | None = None
    time_spent: float | None = None
    finished: int | None = None


class ProgressOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    course_id: int
    completed_lessons: int
    total_lessons: int
    correct_count: int
    attempt_count: int
    finished: int


# ===== 接口 =====


@router.get("", response_model=list[CourseListItem])
def list_courses(db: Session = Depends(get_db)) -> list[CourseListItem]:
    courses = db.scalars(
        select(Course)
        .options(selectinload(Course.lessons))
        .order_by(Course.difficulty, Course.order_index)
    ).all()
    return [
        CourseListItem(
            id=c.id,
            title=c.title,
            description=c.description,
            dimension=c.dimension,
            difficulty=c.difficulty,
            lesson_count=len(c.lessons),
        )
        for c in courses
    ]


@router.get("/{course_id}", response_model=CourseDetail)
def get_course(course_id: int, db: Session = Depends(get_db)) -> CourseDetail:
    course = db.scalar(
        select(Course)
        .where(Course.id == course_id)
        .options(
            selectinload(Course.lessons).selectinload(Lesson.steps)
        )
    )
    if course is None:
        raise HTTPException(status_code=404, detail="课程不存在")
    return CourseDetail.model_validate(course)


@router.post("/{course_id}/progress", response_model=ProgressOut)
def update_progress(
    course_id: int, body: ProgressUpdate, db: Session = Depends(get_db)
) -> CourseProgress:
    course = db.get(Course, course_id)
    if course is None:
        raise HTTPException(status_code=404, detail="课程不存在")

    progress = db.scalar(
        select(CourseProgress).where(CourseProgress.course_id == course_id)
    )
    if progress is None:
        lesson_count = db.scalar(
            select(Lesson.id).where(Lesson.course_id == course_id).limit(1)
        )
        total = len(course.lessons) if course.lessons else 0
        progress = CourseProgress(course_id=course_id, total_lessons=total)
        db.add(progress)

    if body.completed_lessons is not None:
        progress.completed_lessons = body.completed_lessons
    if body.correct_count is not None:
        progress.correct_count = body.correct_count
    if body.attempt_count is not None:
        progress.attempt_count = body.attempt_count
    if body.time_spent is not None:
        progress.time_spent = body.time_spent
    if body.finished is not None:
        progress.finished = body.finished

    db.commit()
    db.refresh(progress)
    return progress
