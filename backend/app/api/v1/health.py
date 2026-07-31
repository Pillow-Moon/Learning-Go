"""健康检查接口。"""
from pathlib import Path

from fastapi import APIRouter

from app.core.config import get_settings

router = APIRouter(tags=["health"])


@router.get("/health")
def health_check() -> dict:
    settings = get_settings()
    # 从模型路径提取版本标识（如 b10c384h6）
    model_stem = Path(settings.katago_model).stem  # e.g. b10c384h6
    return {
        "status": "ok",
        "app": settings.app_name,
        "debug": settings.debug,
        "katago_model": model_stem,
    }
