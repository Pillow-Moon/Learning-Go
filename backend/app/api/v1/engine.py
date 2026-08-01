"""KataGo 引擎管理接口（模型列表 / 切换 / 下载 / 自对弈校准）。

GET  /engine/models             已安装 + 可下载模型列表 + 当前模型
POST /engine/model              切换到指定模型（需已安装）
POST /engine/model/download     下载指定模型（后台异步）
GET  /engine/model/download/{id} 查询下载进度
POST /engine/calibrate          两个等级配置（模型×visits）自对弈校准
"""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, model_validator

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


class CalibrateRequest(BaseModel):
    """自对弈校准参数：model_a/visits_a vs model_b/visits_b。

    model_a == model_b 时为同模型不同访问量（校准等级倍率）；
    模型不同时为跨模型校准（校准模型系数）。
    human_sl_model + human_sl_side：把 a/b 一侧换成 Human-SL 权重，
    该侧 visits 由 human_sl_config（含 humanSLProfile）决定，visits 传 0。
    """

    model_a: str
    model_b: str
    visits_a: int = Field(default=1, ge=0, le=1_000_000)
    visits_b: int = Field(default=1, ge=0, le=1_000_000)
    size: int = Field(default=19, ge=9, le=19)
    komi: float = Field(default=0.0, ge=-100, le=100)
    handicap: int = Field(default=0, ge=0, le=9)
    games: int = Field(default=4, ge=1, le=50)
    black_side: Literal["a", "b"] = "a"
    human_sl_model: str | None = None
    human_sl_side: Literal["a", "b"] | None = None
    human_sl_config: str | None = None
    human_sl_profile: str | None = None

    @model_validator(mode="after")
    def _check_human_sl(self) -> "CalibrateRequest":
        if (self.human_sl_model is None) != (self.human_sl_side is None):
            raise ValueError("human_sl_model 与 human_sl_side 需同时指定")
        if self.human_sl_side == "a" and self.visits_b <= 0:
            raise ValueError("Human-SL 在 a 侧（visits_a 由配置决定，传 0）；visits_b 必须 > 0")
        if self.human_sl_side == "b" and self.visits_a <= 0:
            raise ValueError("Human-SL 在 b 侧（visits_b 由配置决定，传 0）；visits_a 必须 > 0")
        if self.human_sl_side is None and (self.visits_a <= 0 or self.visits_b <= 0):
            raise ValueError("visits_a / visits_b 必须 > 0")
        return self


@router.post("/calibrate")
async def calibrate(req: CalibrateRequest) -> dict:
    """让两个等级配置自对弈，返回每盘结果与胜率汇总。

    让子棋中黑方先摆子（handicap 子），通常较弱方执黑（black_side）。
    """
    from app.services.selfplay import run_calibration

    try:
        return await run_calibration(
            req.model_a.strip(),
            req.model_b.strip(),
            req.visits_a,
            req.visits_b,
            size=req.size,
            komi=req.komi,
            handicap=req.handicap,
            games=req.games,
            black_side=req.black_side,
            human_sl_model=req.human_sl_model.strip() if req.human_sl_model else None,
            human_sl_side=req.human_sl_side,
            human_sl_config=req.human_sl_config,
            human_sl_profile=req.human_sl_profile,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
