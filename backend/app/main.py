"""FastAPI 应用入口。"""
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.v1.router import api_router
from app.core.config import get_settings

settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    description="围棋 AI 教学平台后端 API",
    version="0.1.0",
    debug=settings.debug,
)

# 开发阶段允许前端开发服务器跨域（生产环境同源部署后可收紧）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")


@app.get("/api/v1/info", include_in_schema=False)
def info() -> dict:
    return {"app": settings.app_name, "docs": "/docs", "api": "/api/v1"}


# ===== 生产模式：serve 前端构建产物（SPA）=====
# 路径：Learning-Go/frontend/dist
_FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"

if _FRONTEND_DIST.exists():
    _assets = _FRONTEND_DIST / "assets"
    if _assets.exists():
        app.mount("/assets", StaticFiles(directory=_assets), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_spa(full_path: str):
        """非 API 路由一律返回 index.html，交给前端路由处理。"""
        candidate = _FRONTEND_DIST / full_path
        if full_path and candidate.exists() and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(_FRONTEND_DIST / "index.html")

else:

    @app.get("/")
    def root() -> dict:
        return {"app": settings.app_name, "docs": "/docs", "api": "/api/v1"}
