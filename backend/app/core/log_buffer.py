"""内存环形日志缓冲（Web 控制面板日志面板用）。

控制台窗口与 /admin 控制面板双出口：root logger 挂 RingBufferHandler 后，
所有应用日志同时写入内存环形缓冲，最近 N 条可被控制面板接口读取。
"""
from __future__ import annotations

import logging
from collections import deque

_RING_CAPACITY = 500


class RingBufferHandler(logging.Handler):
    """把日志行保留在内存环形缓冲中。"""

    def __init__(self, capacity: int = _RING_CAPACITY) -> None:
        super().__init__()
        self.buffer: deque[str] = deque(maxlen=capacity)

    def emit(self, record: logging.LogRecord) -> None:
        try:
            self.buffer.append(self.format(record))
        except Exception:  # noqa: BLE001 日志不能抛异常
            pass


_ring = RingBufferHandler()
_ring.setFormatter(
    logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s", "%H:%M:%S")
)


def install_ring_buffer() -> None:
    """挂到 root + uvicorn 具名 logger，捕获全应用日志（幂等）。

    uvicorn 默认 propagate=False，access/error 日志不传播到 root，
    因此需要直接挂到 uvicorn.* logger 上（startup 时再次调用以覆盖 dictConfig 重置）。
    """
    root = logging.getLogger()
    if not any(isinstance(h, RingBufferHandler) for h in root.handlers):
        root.addHandler(_ring)
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        lg = logging.getLogger(name)
        if not any(isinstance(h, RingBufferHandler) for h in lg.handlers):
            lg.addHandler(_ring)


def get_logs(tail: int = 200) -> list[str]:
    """返回最近 tail 条日志（默认 200）。"""
    lines = list(_ring.buffer)
    return lines[-tail:]
