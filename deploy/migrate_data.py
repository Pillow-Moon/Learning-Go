"""一次性数据迁移：把本地 SQLite 的用户数据合并到云端数据库。

场景：先在本地开发使用，之后租了云服务器，想把本地积累的对局/学习进度迁过去。

用法（在项目根目录 Learning-Go/ 下）：
    1. 先把本地 backend/learning_go.db 上传到服务器任意路径，例如 /tmp/local.db
       scp backend/learning_go.db user@<服务器IP>:/tmp/local.db
    2. 在服务器上运行：
       backend/.venv/bin/python deploy/migrate_data.py /tmp/local.db

迁移内容：games、course_progress（用户产生的数据）。
课程与题库（courses / problems）以云端种子数据为准，不覆盖。
"""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
TARGET_DB = PROJECT_ROOT / "backend" / "learning_go.db"

# 需要迁移的用户数据表
USER_TABLES = ("games", "course_progress")


def migrate(source_path: str) -> None:
    src = Path(source_path)
    if not src.exists():
        print(f"错误：源数据库不存在：{src}")
        sys.exit(1)
    if not TARGET_DB.exists():
        print(f"错误：目标数据库不存在：{TARGET_DB}（请先运行 init_db）")
        sys.exit(1)

    conn = sqlite3.connect(TARGET_DB)
    conn.execute("ATTACH DATABASE ? AS src", (str(src),))

    for table in USER_TABLES:
        cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
        if not cols:
            print(f"跳过 {table}（目标表不存在）")
            continue
        # 源表可能不存在
        src_exists = conn.execute(
            "SELECT name FROM src.sqlite_master WHERE type='table' AND name=?",
            (table,),
        ).fetchone()
        if not src_exists:
            print(f"跳过 {table}（源库无此表）")
            continue
        col_list = ", ".join(cols)
        conn.execute(f"DELETE FROM {table}")
        cur = conn.execute(
            f"INSERT INTO {table} ({col_list}) SELECT {col_list} FROM src.{table}"
        )
        print(f"迁移 {table}: {cur.rowcount} 行")

    conn.commit()
    conn.close()
    print("迁移完成。")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python deploy/migrate_data.py <本地db路径>")
        sys.exit(1)
    migrate(sys.argv[1])
