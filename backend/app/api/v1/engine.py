"""KataGo 引擎管理接口（模型列表 / 切换 / 下载）。

GET  /engine/models             已安装 + 可下载模型列表 + 当前模型
POST /engine/model              切换到指定模型（需已安装）
POST /engine/model/download     下载指定模型（后台异步）
GET  /engine/model/download/{id} 查询下载进度
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import engine_manager

router = APIRouter(prefix="/engine", tags=["engine"])


class SwitchModelRequest(BaseModel):
    model: str


@router.get("/models")
async def list_models() -> dict:
    return {
        "installed": engine_manager.list_available_models(),
        "available": engine_manager.list_downloadable_models(),
        "current": engine_manager.get_current_model_id(),
    }


@router.post("/model")
async def switch_model(req: SwitchModelRequest) -> dict:
    try:
        return await engine_manager.switch_model(req.model.strip())
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/model/download")
async def download_model(req: SwitchModelRequest) -> dict:
    try:
        return engine_manager.start_model_download(req.model.strip())
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/model/download/{model_id}")
async def get_download_status(model_id: str) -> dict:
    state = engine_manager.get_model_download(model_id)
    if state is None:
        raise HTTPException(status_code=404, detail="无该模型的下载任务")
    return state

