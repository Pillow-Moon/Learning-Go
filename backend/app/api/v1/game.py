"""人机对弈接口。

采用无状态重放策略：每次请求重置 KataGo 棋盘并回放完整历史，再生成 AI 应手。
单用户场景下回放开销可忽略，且彻底避免前后端棋盘状态不同步。
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from app.schemas.game import GameMoveRequest, GameMoveResponse
from app.services.katago_gtp import KataGoError, get_katago_gtp, gtp_to_vertex, vertex_to_gtp

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/game", tags=["game"])


@router.post("/move", response_model=GameMoveResponse)
async def game_move(req: GameMoveRequest) -> GameMoveResponse:
    """请求 AI 应手。moves 需包含用户最新一手。"""
    gtp = get_katago_gtp()
    try:
        await gtp.set_board_size(req.board_size)
        await gtp.clear_board()
        await gtp.set_komi(req.komi)
        await gtp.set_max_visits(req.max_visits)
        # 回放历史
        for m in req.moves:
            await gtp.play(m.color, m.vertex)
        # 生成 AI 应手（取原始字符串以区分 pass/resign）
        raw = await gtp.command(f"genmove {req.ai_color}")
    except KataGoError as exc:
        logger.error("KataGo 对弈失败: %s", exc)
        raise HTTPException(status_code=503, detail=f"KataGo 不可用：{exc}") from exc

    raw_norm = raw.strip().lower()
    if raw_norm in ("pass", "resign"):
        return GameMoveResponse(ai_move=None, ai_move_coord=raw_norm)
    vertex = gtp_to_vertex(raw, req.board_size)
    coord = vertex_to_gtp(vertex, req.board_size) if vertex else raw_norm
    return GameMoveResponse(ai_move=vertex, ai_move_coord=coord)
