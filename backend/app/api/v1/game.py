"""人机对弈接口。

采用无状态重放策略：每次请求重置 KataGo 棋盘并回放完整历史，再生成 AI 应手。
单用户场景下回放开销可忽略，且彻底避免前后端棋盘状态不同步。

强度模式（Human-SL 引擎化）：strength_id 映射到 Human-SL profile（am20k~am7d）
时使用 Human-SL 对弈模式（官方 rank 标尺，人类风格）；pro 档/无映射走正常模型 + visits。
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from app.schemas.game import GameMoveRequest, GameMoveResponse
from app.services.katago_gtp import (
    KataGoError,
    ensure_play_mode,
    gtp_to_vertex,
    vertex_to_gtp,
)
from app.services.strength_params import human_sl_profile

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/game", tags=["game"])

# Human-SL 高段增强档（官方 9d 配方：PiklLambda=0.08 + 400 visits 搜索增强）
_HUMAN_SL_ENHANCED = {"am6d", "am7d"}
_HUMAN_SL_VISITS = 400
_HUMAN_SL_PURE_VISITS = 40
_HUMAN_SL_PIKL_LAMBDA = 0.08
_HUMAN_SL_PURE_PIKL_LAMBDA = 100000000


@router.post("/move", response_model=GameMoveResponse)
async def game_move(req: GameMoveRequest) -> GameMoveResponse:
    """请求 AI 应手。moves 需包含用户最新一手。"""
    profile = human_sl_profile(req.strength_id) if req.strength_id else None
    try:
        if profile:
            # Human-SL 对弈模式（官方附加模式）：档位由 rank profile 决定，
            # visits 仅用于 pass/resign 判断；高段增强档按官方 9d 配方
            gtp = await ensure_play_mode("human_sl")
            await gtp.set_human_sl_profile(profile)
            enhanced = req.strength_id in _HUMAN_SL_ENHANCED
            await gtp.set_max_visits(
                _HUMAN_SL_VISITS if enhanced else _HUMAN_SL_PURE_VISITS
            )
            await gtp.set_human_sl_pikl_lambda(
                _HUMAN_SL_PIKL_LAMBDA if enhanced else _HUMAN_SL_PURE_PIKL_LAMBDA
            )
            await gtp.set_human_sl_explore(enhanced)
        else:
            # 正常模式：当前模型 + visits 控强度（pro 档/9路13路）
            gtp = await ensure_play_mode("normal")
            await gtp.set_max_visits(req.max_visits)
        await gtp.set_board_size(req.board_size)
        await gtp.clear_board()
        await gtp.set_komi(req.komi)
        # 回放历史
        for m in req.moves:
            await gtp.play(m.color, m.vertex)
        # 生成 AI 应手（取原始字符串以区分 pass/resign）
        raw = await gtp.command(f"genmove {req.ai_color}")
    except ValueError as exc:
        logger.error("Human-SL 引擎不可用: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except KataGoError as exc:
        logger.error("KataGo 对弈失败: %s", exc)
        raise HTTPException(status_code=503, detail=f"KataGo 不可用：{exc}") from exc

    raw_norm = raw.strip().lower()
    if raw_norm in ("pass", "resign"):
        return GameMoveResponse(ai_move=None, ai_move_coord=raw_norm)
    vertex = gtp_to_vertex(raw, req.board_size)
    coord = vertex_to_gtp(vertex, req.board_size) if vertex else raw_norm
    return GameMoveResponse(ai_move=vertex, ai_move_coord=coord)
