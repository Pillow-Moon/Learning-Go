"""KataGo GTP 模式封装（人机对弈）。

通过 asyncio subprocess 管理 KataGo 进程，发送 GTP 命令并解析响应。
单例管理：全局复用一个 KataGo 进程，崩溃时可重启。

GTP 协议要点：
- 写命令到 stdin（以换行结尾）
- 从 stdout 读响应：首行以 "="（成功）或 "?"（失败）开头，
  内容可跨多行，以空行结束。
- 日志输出到 stderr，不污染 stdout。
"""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from app.core.config import get_settings

logger = logging.getLogger(__name__)

# 列坐标字母（围棋惯例跳过 I）
_LETTERS = "ABCDEFGHJKLMNOPQRSTUVWXYZ"


class KataGoError(RuntimeError):
    """KataGo 返回错误或进程异常。"""


def vertex_to_gtp(vertex: tuple[int, int], board_size: int) -> str:
    """[x, y]（y=0 在顶部）-> GTP 坐标，如 (15, 3) -> 'Q16'。"""
    x, y = vertex
    return f"{_LETTERS[x]}{board_size - y}"


def gtp_to_vertex(coord: str, board_size: int) -> tuple[int, int] | None:
    """GTP 坐标 'Q16' -> [x, y]。pass/resign 返回 None。"""
    coord = coord.strip().upper()
    if coord in ("PASS", "RESIGN", ""):
        return None
    if len(coord) < 2:
        return None
    x = _LETTERS.index(coord[0])
    y = board_size - int(coord[1:])
    return (x, y)


class KataGoGTP:
    """管理单个 KataGo GTP 进程。"""

    def __init__(self, binary: str, model: str, config: str | None = None):
        self.binary = binary
        self.model = model
        self.config = config
        self.proc: asyncio.subprocess.Process | None = None
        self._lock = asyncio.Lock()
        self.board_size = 19

    @property
    def is_running(self) -> bool:
        return self.proc is not None and self.proc.returncode is None

    async def start(self) -> None:
        """启动 KataGo GTP 进程。"""
        if self.is_running:
            return
        args = [self.binary, "gtp", "-model", self.model]
        if self.config and Path(self.config).exists():
            args += ["-config", self.config]
        logger.info("启动 KataGo GTP: %s", " ".join(args))
        self.proc = await asyncio.create_subprocess_exec(
            *args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        # 异步消费 stderr，避免管道写满阻塞
        asyncio.create_task(self._drain_stderr())

    async def _drain_stderr(self) -> None:
        assert self.proc and self.proc.stderr
        try:
            while True:
                line = await self.proc.stderr.readline()
                if not line:
                    break
                logger.debug("[katago] %s", line.decode(errors="ignore").rstrip())
        except Exception:  # noqa: BLE001
            pass

    async def stop(self) -> None:
        if self.proc and self.proc.returncode is None:
            try:
                self.proc.stdin.write(b"quit\n")
                await self.proc.stdin.drain()
                await asyncio.wait_for(self.proc.wait(), timeout=3)
            except Exception:  # noqa: BLE001
                self.proc.kill()
        self.proc = None

    async def _ensure_running(self) -> None:
        if not self.is_running:
            await self.start()

    async def command(self, cmd: str) -> str:
        """发送一条 GTP 命令，返回响应内容（去掉前缀）。失败抛 KataGoError。"""
        async with self._lock:
            await self._ensure_running()
            assert self.proc and self.proc.stdin and self.proc.stdout
            self.proc.stdin.write((cmd + "\n").encode())
            await self.proc.stdin.drain()

            # 读首行（跳过可能的空行）
            first = ""
            while first == "":
                raw = await self.proc.stdout.readline()
                if not raw:
                    raise KataGoError("KataGo 进程已退出")
                first = raw.decode(errors="ignore").strip()

            success = first.startswith("=")
            body = [first[1:].strip()]
            # 读后续行直到空行
            while True:
                raw = await self.proc.stdout.readline()
                if not raw:
                    break
                line = raw.decode(errors="ignore").strip()
                if line == "":
                    break
                body.append(line)
            result = "\n".join(body).strip()
            if not success:
                raise KataGoError(f"GTP 命令失败 [{cmd}]: {result}")
            return result

    # ===== 高层围棋命令 =====

    async def set_board_size(self, size: int) -> None:
        await self.command(f"boardsize {size}")
        self.board_size = size

    async def clear_board(self) -> None:
        await self.command("clear_board")

    async def set_komi(self, komi: float) -> None:
        await self.command(f"komi {komi}")

    async def set_max_visits(self, visits: int) -> None:
        """设置搜索量，控制 AI 难度。"""
        await self.command(f"kata-set-param maxVisits {visits}")

    async def play(self, color: str, vertex: tuple[int, int] | None) -> None:
        """落子。color 为 'B'/'W'，vertex 为 None 表示 pass。"""
        coord = "pass" if vertex is None else vertex_to_gtp(vertex, self.board_size)
        await self.command(f"play {color} {coord}")

    async def genmove(self, color: str) -> tuple[int, int] | None:
        """让 AI 生成一手。返回 [x, y]，pass/resign 返回 None。"""
        resp = await self.command(f"genmove {color}")
        return gtp_to_vertex(resp, self.board_size)


# ===== 全局单例管理 =====

_gtp_instance: KataGoGTP | None = None


def get_katago_gtp() -> KataGoGTP:
    """获取全局 KataGo GTP 实例（惰性创建）。"""
    global _gtp_instance
    if _gtp_instance is None:
        settings = get_settings()
        _gtp_instance = KataGoGTP(
            binary=settings.katago_binary,
            model=settings.katago_model,
            config=settings.katago_config,
        )
    return _gtp_instance
