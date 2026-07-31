"""题库数据模型：Problem（SGF 局面 + 正解 + 干扰项 + 难度 + 标签）。"""
from __future__ import annotations

from sqlalchemy import JSON, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Problem(Base):
    """一道练习题。

    category: 规则认知 / 基础技巧
    tag:      气 / 吃子 / 眼 / 打劫 / 禁入点 / 征子 / 枷吃 / 倒扑 / 接不归 / 双活
    """

    __tablename__ = "problems"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    category: Mapped[str] = mapped_column(String(32))
    tag: Mapped[str] = mapped_column(String(32))
    difficulty: Mapped[int] = mapped_column(Integer, default=1)
    # 题目局面（SGF）；轮到的一方由 SGF 的 PL 或默认推断
    sgf: Mapped[str] = mapped_column(Text)
    # 正解落子（GTP 坐标，如 "C3"）
    correct_move: Mapped[str] = mapped_column(String(8))
    # 干扰项（GTP 坐标列表）
    distractors: Mapped[list] = mapped_column(JSON, default=list)
    # 解析
    explanation: Mapped[str] = mapped_column(Text, default="")
