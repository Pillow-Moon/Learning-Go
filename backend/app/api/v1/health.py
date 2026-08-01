"""健康检查接口。"""
from fastapi import APIRouter

from app.core.config import get_settings
from app.services import engine_manager

router = APIRouter(tags=["health"])


@router.get("/health")
def health_check() -> dict:
    settings = get_settings()
    return {
        "status": "ok",
        "app": settings.app_name,
        "debug": settings.debug,
        # 运行时当前模型（切换后立即反映），而非配置文件里的默认值
        "katago_model": engine_manager.get_effective_model_id(),
        # 手机端配置 localBackendURL 用：局域网 IP 列表 + Tailscale 100.x 地址
        "lan_ips": engine_manager.get_lan_ips(),
        "tailscale_ip": engine_manager.get_tailscale_ip(),
    }
