"""局面分析接口（任务模式）。

POST /analysis        提交分析任务，返回 task_id
GET  /analysis/{id}   轮询任务状态与结果

分析耗时较长（数秒），用 BackgroundTasks 异步执行，结果存内存任务表。
单用户场景内存表足够，无需 Redis。
"""
from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, BackgroundTasks, HTTPException

from app.schemas.game import (
    AnalysisRequest,
    AnalysisStatusResponse,
    AnalysisTaskResponse,
)
from app.services.katago_analysis import get_katago_analysis

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/analysis", tags=["analysis"])

# 内存任务表：task_id -> {status, result, error}
_tasks: dict[str, dict] = {}


async def _run_analysis(task_id: str, correlation_id: str | None, req: AnalysisRequest) -> None:
    try:
        engine = get_katago_analysis()
        moves = [(m.color, m.vertex) for m in req.moves]

        async def _on_snapshot(snapshot: dict) -> None:
            # 中间快照：搜索期间的中间态结果，让前端实时增量渲染
            # （status=running + 最新 result，最终行仍会先写这里再写 done）
            _tasks[task_id] = {"status": "running", "result": snapshot, "error": None}

        result = await engine.analyze(
            moves,
            req.board_size,
            req.komi,
            req.max_visits,
            req.initial_stones,
            on_snapshot=_on_snapshot,
            correlation_id=correlation_id,
        )
        _tasks[task_id] = {"status": "done", "result": result, "error": None}
        logger.info(
            "分析完成: task_id=%s correlation_id=%s status=done",
            task_id,
            correlation_id,
        )
    except Exception as exc:  # noqa: BLE001
        logger.error(
            "分析任务失败: task_id=%s correlation_id=%s: %s",
            task_id,
            correlation_id,
            exc,
            exc_info=True,
        )
        _tasks[task_id] = {"status": "error", "result": None, "error": f"{type(exc).__name__}: {exc!r}"}


@router.post("", response_model=AnalysisTaskResponse)
async def submit_analysis(
    req: AnalysisRequest, background_tasks: BackgroundTasks
) -> AnalysisTaskResponse:
    task_id = uuid.uuid4().hex[:12]
    _tasks[task_id] = {"status": "pending", "result": None, "error": None}
    logger.info(
        "分析请求入队: task_id=%s correlation_id=%s status=pending",
        task_id,
        req.correlation_id,
    )
    background_tasks.add_task(_run_analysis, task_id, req.correlation_id, req)
    return AnalysisTaskResponse(task_id=task_id, status="pending")


@router.get("/{task_id}", response_model=AnalysisStatusResponse)
async def get_analysis(task_id: str) -> AnalysisStatusResponse:
    task = _tasks.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="分析任务不存在")
    return AnalysisStatusResponse(task_id=task_id, **task)
