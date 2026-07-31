"""数据库初始化脚本。

用法（在 backend 目录下）：
    python -m app.core.init_db

创建全部表结构并导入种子数据（课程、题库）。
"""
from app.core.database import Base, SessionLocal, engine
from app.core.seed_data import seed_all
# 导入全部模型，确保注册到 metadata
from app import models  # noqa: F401


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    print("数据库表创建完成：")
    for table in Base.metadata.tables:
        print(f"  - {table}")

    db = SessionLocal()
    try:
        seed_all(db)
        print("种子数据导入完成。")
    finally:
        db.close()


if __name__ == "__main__":
    init_db()
