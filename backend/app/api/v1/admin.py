"""Web 控制面板接口（状态 / 日志 / 引擎控制）。

浏览器访问 http://localhost:8000/admin 查看面板（Tailscale 组网下手机也可远程访问排障）。
无鉴权：本地工具定位，家庭单用户场景风险可控。
"""
from __future__ import annotations

import logging

from fastapi import APIRouter

from app.core.log_buffer import get_logs
from app.services import engine_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])

# 后端服务端口（绿色包固定 8000；开发环境可能改，仅作展示）
_PORT = 8000


@router.get("/status")
def admin_status() -> dict:
    """引擎/模型/网络连接状态（控制面板轮询用）。"""
    return {
        "status": "ok",
        "model": engine_manager.get_effective_model_id(),
        "lan_ips": engine_manager.get_lan_ips(),
        "tailscale_ip": engine_manager.get_tailscale_ip(),
        "port": _PORT,
    }


@router.get("/logs")
def admin_logs(tail: int = 200) -> dict:
    """最近 tail 条日志（默认 200，上限 500）。"""
    return {"lines": get_logs(min(max(tail, 1), 500))}


@router.post("/engine/restart")
async def admin_engine_restart() -> dict:
    """停止 KataGo 分析引擎进程（下次请求自动惰性重启）。"""
    from app.services.katago_analysis import stop_katago_analysis

    await stop_katago_analysis()
    logger.info("控制面板：分析引擎已停止（下次请求自动重启）")
    return {"ok": True, "message": "分析引擎已停止，下次请求自动重启"}


@router.post("/engine/stop")
async def admin_engine_stop() -> dict:
    """停止 KataGo 分析引擎进程（保持后端服务运行）。"""
    from app.services.katago_analysis import stop_katago_analysis

    await stop_katago_analysis()
    logger.info("控制面板：分析引擎已停止")
    return {"ok": True, "message": "分析引擎已停止"}
