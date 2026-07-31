"""课程系统数据模型：Course -> Lesson -> Step，以及学习进度 CourseProgress。"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Course(Base):
    """一门课程（如「入门：规则与吃子」）。"""

    __tablename__ = "courses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(128))
    description: Mapped[str] = mapped_column(Text, default="")
    # 能力维度标签：吃子 / 围空 / 死活 / 布局 / 官子 / 规则
    dimension: Mapped[str] = mapped_column(String(32), default="规则")
    difficulty: Mapped[int] = mapped_column(Integer, default=1)  # 1 起
    order_index: Mapped[int] = mapped_column(Integer, default=0)

    lessons: Mapped[list[Lesson]] = relationship(
        back_populates="course", cascade="all, delete-orphan",
        order_by="Lesson.order_index",
    )


class Lesson(Base):
    """课程下的一节。"""

    __tablename__ = "lessons"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id"))
    title: Mapped[str] = mapped_column(String(128))
    order_index: Mapped[int] = mapped_column(Integer, default=0)

    course: Mapped[Course] = relationship(back_populates="lessons")
    steps: Mapped[list[Step]] = relationship(
        back_populates="lesson", cascade="all, delete-orphan",
        order_by="Step.order_index",
    )


class Step(Base):
    """一节课中的一个教学步骤（绑定一个 SGF 局面）。"""

    __tablename__ = "steps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    lesson_id: Mapped[int] = mapped_column(ForeignKey("lessons.id"))
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    # 教学局面（SGF）；可为空表示纯文字步骤
    sgf: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 讲解文字
    instruction: Mapped[str] = mapped_column(Text, default="")
    # 期望落子（GTP 坐标，如 "Q16"）；为空表示无交互
    expected_move: Mapped[str | None] = mapped_column(String(8), nullable=True)
    # 落子后的解释
    explanation: Mapped[str] = mapped_column(Text, default="")

    lesson: Mapped[Lesson] = relationship(back_populates="steps")


class CourseProgress(Base):
    """单用户学习进度（按课程聚合）。"""

    __tablename__ = "course_progress"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id"), unique=True)
    completed_lessons: Mapped[int] = mapped_column(Integer, default=0)
    total_lessons: Mapped[int] = mapped_column(Integer, default=0)
    correct_count: Mapped[int] = mapped_column(Integer, default=0)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    time_spent: Mapped[float] = mapped_column(Float, default=0.0)  # 秒
    finished: Mapped[int] = mapped_column(Integer, default=0)  # 0/1
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
