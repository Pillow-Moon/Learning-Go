"""KataGo Analysis 模式封装（局面分析）。

Analysis 引擎使用 JSON 行协议：
- 启动：katago analysis -config <cfg> -model <model>
- 输入（stdin，每行一个 JSON）：
    {"id": "q1", "moves": [["B","Q16"],["W","D4"]], "rules": "chinese", "maxVisits": 100}
- 输出（stdout，每行一个 JSON）：
    {"id": "q1", "moveInfos": [{"move":"Q10","winrate":0.65,"scoreLead":2.3,"pv":[...]}], "rootInfo": {...}}

用于：候选选点、胜率、目差、变化图，是 AI 解说的数据源。
"""
from __future__ import annotations

import asyncio
import itertools
import json
import logging

from app.core.config import get_settings
from app.services.katago_gtp import gtp_to_vertex, vertex_to_gtp

logger = logging.getLogger(__name__)

_id_counter = itertools.count(1)


class KataGoAnalysis:
    """管理单个 KataGo Analysis 引擎进程。"""

    def __init__(self, binary: str, model: str, config: str | None = None):
        self.binary = binary
        self.model = model
        self.config = config
        self.proc: asyncio.subprocess.Process | None = None
        self._lock = asyncio.Lock()

    @property
    def is_running(self) -> bool:
        return self.proc is not None and self.proc.returncode is None

    async def start(self) -> None:
        if self.is_running:
            return
        args = [self.binary, "analysis", "-model", self.model]
        if self.config:
            args += ["-config", self.config]
        logger.info("启动 KataGo Analysis: %s", " ".join(args))
        self.proc = await asyncio.create_subprocess_exec(
            *args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        asyncio.create_task(self._drain_stderr())

    async def _drain_stderr(self) -> None:
        assert self.proc and self.proc.stderr
        try:
            while True:
                line = await self.proc.stderr.readline()
                if not line:
                    break
                logger.debug("[katago-analysis] %s", line.decode(errors="ignore").rstrip())
        except Exception:  # noqa: BLE001
            pass

    async def stop(self) -> None:
        if self.proc and self.proc.returncode is None:
            self.proc.kill()
        self.proc = None

    async def analyze(
        self,
        moves: list[tuple[str, tuple[int, int] | None]],
        board_size: int = 19,
        komi: float = 7.5,
        max_visits: int = 100,
    ) -> dict:
        """分析当前局面。

        moves: 历史落子列表，元素为 (color 'B'/'W', vertex 或 None=pass)。
        返回结构化分析结果：
            {
              "board_size": 19,
              "candidates": [
                 {"move": [x,y], "winrate": 0.65, "score_lead": 2.3,
                  "visits": 80, "pv": [[x,y], ...]}, ...
              ],
              "root": {"winrate": ..., "score_lead": ...}
            }
        """
        async with self._lock:
            if not self.is_running:
                await self.start()
            assert self.proc and self.proc.stdin and self.proc.stdout

            query_id = f"q{next(_id_counter)}"
            # 构造 moves：[[ "B", "Q16" ], ...]，pass 用空字符串
            move_list = []
            for color, vertex in moves:
                loc = "" if vertex is None else vertex_to_gtp(vertex, board_size)
                move_list.append([color, loc])

            query = {
                "id": query_id,
                "moves": move_list,
                "rules": "chinese",
                "boardXSize": board_size,
                "boardYSize": board_size,
                "komi": komi,
                "maxVisits": max_visits,
            }
            self.proc.stdin.write((json.dumps(query) + "\n").encode())
            await self.proc.stdin.drain()

            # 读取对应 id 的响应行
            while True:
                raw = await self.proc.stdout.readline()
                if not raw:
                    raise RuntimeError("KataGo Analysis 进程已退出")
                line = raw.decode(errors="ignore").strip()
                if not line:
                    continue
                resp = json.loads(line)
                if resp.get("id") == query_id:
                    break

            return self._format_response(resp, board_size)

    @staticmethod
    def _format_response(resp: dict, board_size: int) -> dict:
        candidates = []
        for info in resp.get("moveInfos", []):
            vertex = gtp_to_vertex(info.get("move", ""), board_size)
            pv = [gtp_to_vertex(c, board_size) for c in info.get("pv", [])]
            candidates.append(
                {
                    "move": vertex,
                    "winrate": info.get("winrate"),
                    "score_lead": info.get("scoreLead"),
                    "visits": info.get("visits"),
                    "prior": info.get("prior"),
                    "pv": [p for p in pv if p is not None],
                }
            )
        # 按访问量降序（KataGo 通常已排序）
        candidates.sort(key=lambda c: c.get("visits") or 0, reverse=True)
        root = resp.get("rootInfo", {})
        return {
            "board_size": board_size,
            "candidates": candidates,
            "root": {
                "winrate": root.get("winrate"),
                "score_lead": root.get("scoreLead"),
            },
        }


_analysis_instance: KataGoAnalysis | None = None


def get_katago_analysis() -> KataGoAnalysis:
    global _analysis_instance
    if _analysis_instance is None:
        settings = get_settings()
        _analysis_instance = KataGoAnalysis(
            binary=settings.katago_binary,
            model=settings.katago_model,
            config=settings.katago_analysis_config,
        )
    return _analysis_instance
