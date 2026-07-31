"""对局记录模型。"""
from datetime import datetime

from sqlalchemy import JSON, DateTime, Float, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Game(Base):
    """一盘棋的完整记录。

    moves 以 JSON 数组存储，每个元素形如：
        {"n": 1, "color": "B", "vertex": "Q16"}
    其中 vertex 使用 SGF 坐标（aa 表示左上角），pass 记为 ""，resign 记为 "resign"。
    """

    __tablename__ = "games"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # 棋盘规格
    board_size: Mapped[int] = mapped_column(Integer, default=19)
    komi: Mapped[float] = mapped_column(Float, default=7.5)

    # 对局模式：human_vs_human / human_vs_ai
    game_mode: Mapped[str] = mapped_column(String(32), default="human_vs_human")
    # AI 难度（maxVisits），仅 human_vs_ai 有意义
    ai_max_visits: Mapped[int] = mapped_column(Integer, default=100)

    # 棋局内容
    moves: Mapped[list] = mapped_column(JSON, default=list)
    sgf: Mapped[str | None] = mapped_column(Text, nullable=True)

    # 状态：in_progress / finished
    status: Mapped[str] = mapped_column(String(16), default="in_progress")
    # 结果，如 "B+R"、"W+2.5"、"B+Time"
    result: Mapped[str | None] = mapped_column(String(16), nullable=True)

    # 时间戳
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    def __repr__(self) -> str:
        return f"<Game id={self.id} {self.board_size}x{self.board_size} {self.status}>"
