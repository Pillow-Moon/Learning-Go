"""AI 解说接口（任务模式 + SSE 流式）。

POST /commentary/generate         提交解说请求，返回 task_id
GET  /commentary/stream/{task_id} SSE 流式获取解说文本

频率限制：同一局面 30 秒内不重复生成。
"""
from __future__ import annotations

import hashlib
import json
import logging
import time
import uuid

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.schemas.commentary import CommentaryRequest, CommentaryTaskResponse
from app.services.commentary import stream_commentary

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/commentary", tags=["commentary"])

# task_id -> 解说请求
_tasks: dict[str, CommentaryRequest] = {}
# 局面指纹 -> 上次生成时间戳（频率限制）
_rate: dict[str, float] = {}
_RATE_LIMIT_SECONDS = 30


def _fingerprint(req: CommentaryRequest) -> str:
    """用关键局面信息生成指纹，用于频率限制。"""
    key = f"{req.board_size}:{req.move_number}:{req.move}:{req.player}"
    return hashlib.md5(key.encode()).hexdigest()


@router.post("/generate", response_model=CommentaryTaskResponse)
def generate_commentary(req: CommentaryRequest) -> CommentaryTaskResponse:
    fp = _fingerprint(req)
    now = time.time()
    last = _rate.get(fp)
    if last is not None and now - last < _RATE_LIMIT_SECONDS:
        raise HTTPException(
            status_code=429,
            detail=f"同一局面 {_RATE_LIMIT_SECONDS} 秒内请勿重复请求解说",
        )
    _rate[fp] = now

    task_id = uuid.uuid4().hex[:12]
    _tasks[task_id] = req
    return CommentaryTaskResponse(task_id=task_id)


@router.get("/stream/{task_id}")
async def stream(task_id: str) -> StreamingResponse:
    req = _tasks.get(task_id)
    if req is None:
        raise HTTPException(status_code=404, detail="解说任务不存在")

    async def event_generator():
        try:
            async for chunk in stream_commentary(req):
                payload = json.dumps({"text": chunk}, ensure_ascii=False)
                yield f"data: {payload}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"
        except Exception as exc:  # noqa: BLE001
            logger.error("解说生成失败: %s", exc)
            payload = json.dumps({"error": str(exc)}, ensure_ascii=False)
            yield f"data: {payload}\n\n"
        finally:
            _tasks.pop(task_id, None)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
