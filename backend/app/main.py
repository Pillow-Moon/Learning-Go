"""FastAPI 应用入口。"""
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse

from app.api.v1.router import api_router
from app.core.config import get_settings
from app.core.log_buffer import install_ring_buffer

settings = get_settings()

# 内存环形日志缓冲（Web 控制面板 /admin 日志面板的数据源）
# 注意：uvicorn 启动时会用 dictConfig 重配 root handlers，
# 因此还在 startup 事件里再次安装（见下方 _install_ring），确保 CLI 启动也生效。
install_ring_buffer()

app = FastAPI(
    title=settings.app_name,
    description="围棋 AI 教学平台本地 GPU 引擎",
    version="0.1.0",
    debug=settings.debug,
)


@app.on_event("startup")
def _install_ring() -> None:
    """启动后再装一次日志缓冲（uvicorn dictConfig 之后），保证控制面板日志可用。"""
    install_ring_buffer()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")


@app.get("/", include_in_schema=False)
def root() -> dict:
    return {
        "app": settings.app_name,
        "docs": "/docs",
        "api": "/api/v1",
        "admin": "/admin",
    }


@app.get("/admin", include_in_schema=False, response_class=HTMLResponse)
def admin_page() -> str:
    """Web 控制面板（绿色包内置；Tailscale 组网下手机可远程访问排障）。"""
    html = (
        Path(__file__).resolve().parent / "api" / "v1" / "admin.html"
    ).read_text(encoding="utf-8")
    return html


def main() -> None:
    """绿色包控制台入口：打印连接指引后启动服务（关闭窗口即停止）。"""
    import uvicorn

    from app.services import engine_manager

    # 绿色包：首次启动把内置模型/katago.exe 复制到数据目录（开发环境 no-op）
    engine_manager.ensure_bundled_models()

    print("=" * 60)
    print("  围棋 AI 本地引擎（Learning-Go Backend）")
    print("  控制面板:  http://localhost:8000/admin")
    ips = engine_manager.get_lan_ips()
    if ips:
        print("  局域网:    " + " / ".join(f"http://{ip}:8000" for ip in ips))
    ts = engine_manager.get_tailscale_ip()
    if ts:
        print(f"  Tailscale: http://{ts}:8000（手机远程访问用）")
    print("  手机连接:  设置页「引擎来源 → Local GPU」，地址填 http://<IP>:8000/api/v1")
    print("  停止服务:  关闭本窗口")
    print("=" * 60)
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        # 不覆盖 logging 配置：保留 root 上的环形日志缓冲
        log_config=None,
    )


if __name__ == "__main__":
    main()
