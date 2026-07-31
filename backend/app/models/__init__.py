"""ORM 模型汇总导出。

新增模型时在此导入，确保 Alembic 与 Base.metadata 能发现全部表。
"""
from app.core.database import Base
from app.models.course import Course, CourseProgress, Lesson, Step
from app.models.game import Game
from app.models.problem import Problem

__all__ = [
    "Base",
    "Game",
    "Course",
    "Lesson",
    "Step",
    "CourseProgress",
    "Problem",
]
