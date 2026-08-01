"""读取共享强度参数（shared/ai-strength.json）。

前端 settingsStore / lib/strength.ts 与后端均以本文件为参数单一来源，
禁止在后端任何位置复制标定参数。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

if getattr(sys, "frozen", False):
    # 绿色包：参数打进包内（PyInstaller datas）
    _SHARED_JSON = Path(getattr(sys, "_MEIPASS")) / "shared" / "ai-strength.json"
else:
    # 本文件位于 backend/app/services/ → parents[3] = 项目根
    _SHARED_JSON = Path(__file__).resolve().parents[3] / "shared" / "ai-strength.json"

if not _SHARED_JSON.exists():
    raise RuntimeError(f"共享强度参数文件不存在: {_SHARED_JSON}")

_PARAMS: dict = json.loads(_SHARED_JSON.read_text(encoding="utf-8"))


def human_sl_profile(strength_id: str) -> str | None:
    """等级 id → Human-SL profile（如 am20k → rank_20k）；pro 档无映射返回 None。"""
    for level in _PARAMS["levels"]:
        if level["id"] == strength_id:
            return level.get("humanSlProfile")
    return None
