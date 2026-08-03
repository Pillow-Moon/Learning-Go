"""KataGo Analysis 模式封装（局面分析）。

Analysis 引擎使用 JSON 行协议：
- 启动：katago analysis -config <cfg> -model <model>
- 输入（stdin，每行一个 JSON）：
    {"id": "q1", "moves": [["B","Q16"],["W","D4"]], "rules": "chinese", "maxVisits": 100}
- 输出（stdout，每行一个 JSON）：
    {"id": "q1", "moveInfos": [{"move":"Q10","winrate":0.65,"scoreLead":2.3,"pv":[...]}], "rootInfo": {...}}

用于：候选选点、胜率、目差、变化图，是 AI 解说的数据源。
2026-08 精简：GTP 对弈层已删除，坐标转换函数移入本模块。
"""
from __future__ import annotations

import asyncio
import itertools
import json
import logging
from collections.abc import Awaitable, Callable

from app.services import engine_manager

logger = logging.getLogger(__name__)

_id_counter = itertools.count(1)

# ─── GTP 坐标转换（原 katago_gtp，随对弈层删除移入） ────────────────

# 列坐标字母（围棋惯例跳过 I）
_LETTERS = "ABCDEFGHJKLMNOPQRSTUVWXYZ"


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


def _iter_json_objects(line: str):
    """逐个解析一行 stdout 中的全部 JSON 对象。

    KataGo 正常情况每行输出一个 JSON；防御性处理个别异常场景下"一行拼接
    多个响应"（如 `{"id":"qX"}{...完整结果...}`），避免 json.loads 直接抛
    "Extra data" 导致整个分析任务失败。每个对象分别 yield，由调用方按 id /
    isDuringSearch 判断取舍。
    """
    decoder = json.JSONDecoder()
    pos = 0
    n = len(line)
    while pos < n:
        while pos < n and line[pos] in " \t\r\n":
            pos += 1
        if pos >= n:
            break
        try:
            obj, end = decoder.raw_decode(line, pos)
        except json.JSONDecodeError:
            # 行内残余片段无法解析：记录并停止（正常情况下不应出现）
            logger.warning(
                "[katago-analysis] stdout 行含无法解析的片段（已跳过）: %r",
                line[pos : pos + 200],
            )
            break
        yield obj
        pos = end


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
            # KataGo analysis 每行输出整个搜索状态（所有 moveInfos + ownership），
            # 行长度随 visits 增长（20000 visits 实测可超 200KB），超过 StreamReader
            # 默认 64KB 行上限会抛 ValueError("chunk is longer than limit") 导致分析
            # 任务失败、且超长行残留管道污染后续分析。放宽到 8MB。
            limit=8 * 1024 * 1024,
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
        initial_stones: dict | None = None,
        on_snapshot: Callable[[dict], Awaitable[None]] | None = None,
        correlation_id: str | None = None,
    ) -> dict:
        """分析当前局面。

        moves: 历史落子列表，元素为 (color 'B'/'W', vertex 或 None=pass)。
        initial_stones: 可选初始摆子（死活题等静态局面），形如 {"B": [[x,y],...], "W": [...]}，
            引擎先摆子再按 moves 落子。
        on_snapshot: 可选异步回调，搜索期间每收到一行中间态 JSON（isDuringSearch
            =true）都会调用（含最终行），参数为与返回值同结构的格式化结果。
            不传时行为与原来一致（读完全部行直到最终行返回）。
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
            logger.info(
                "[analysis] query=%s correlation_id=%s submitted moves=%d",
                query_id,
                correlation_id or "-",
                len(moves),
            )
            # 构造 moves：[[ "B", "Q16" ], ...]，pass 用 "pass"（空字符串会导致
            # KataGo 报 "Could not parse board location"）
            move_list = []
            for color, vertex in moves:
                loc = "pass" if vertex is None else vertex_to_gtp(vertex, board_size)
                move_list.append([color, loc])

            # 初始摆子（KataGo initialStones 协议：[["b", "Q16"], ["w", "D4"], ...] 数组对）
            initial_list = None
            if initial_stones:
                initial_list = [
                    [color.lower(), vertex_to_gtp(v, board_size)]
                    for color, stones in initial_stones.items()
                    for v in stones
                ]

            query = {
                "id": query_id,
                "moves": move_list,
                "rules": "chinese",
                "boardXSize": board_size,
                "boardYSize": board_size,
                "komi": komi,
                "maxVisits": max_visits,
                "includeOwnership": True,  # 地盘预测（实地/虚地渐变显示需要）
                # 搜索期间每 1 秒输出一次中间态（isDuringSearch: true），
                # 支撑前端实时增量渲染；未设该字段 KataGo 只输出最终行
                "reportDuringSearchEvery": 1.0,
            }
            if initial_list:
                query["initialStones"] = initial_list
            self.proc.stdin.write((json.dumps(query) + "\n").encode())
            await self.proc.stdin.drain()

            # 持续读取同一 query_id 的所有输出行：
            # 搜索期间 KataGo 周期性输出中间态（isDuringSearch: true），
            # 搜索完成输出最终行（isDuringSearch: false）。
            # 中间态逐行回调 on_snapshot（若有），终态 break 返回。
            # 注意：warning/error 行没有 isDuringSearch 字段，不能据此 break，
            # 否则会漏读该查询剩余行、污染下一次分析（可能拼出"Extra data"）。
            last: dict | None = None
            done = False
            while not done:
                raw = await self.proc.stdout.readline()
                if not raw:
                    raise RuntimeError("KataGo Analysis 进程已退出")
                line = raw.decode(errors="ignore").strip()
                if not line:
                    continue
                # 防御：一行可能拼接多个 JSON（异常场景），逐个解析处理
                for resp in _iter_json_objects(line):
                    if resp.get("id") != query_id:
                        continue
                    formatted = self._format_response(resp, board_size)
                    if on_snapshot is not None:
                        await on_snapshot(formatted)
                    last = formatted
                    # 终态判定：isDuringSearch=false（正常结果）或 error（该查询被拒绝）
                    if resp.get("isDuringSearch") is False or "error" in resp:
                        done = True
                        break

            logger.info(
                "[analysis] query=%s correlation_id=%s done",
                query_id,
                correlation_id or "-",
            )
            assert last is not None
            return last

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
            # 地盘预测：正=黑、负=白，绝对值越大越实
            # 注意：KataGo 把 ownership 放在响应顶层，不在 rootInfo 里
            "ownership": resp.get("ownership"),
        }


_analysis_instance: KataGoAnalysis | None = None


def get_katago_analysis() -> KataGoAnalysis:
    global _analysis_instance
    if _analysis_instance is None:
        _analysis_instance = KataGoAnalysis(
            binary=engine_manager.katago_binary_path(),
            model=engine_manager.get_current_model_path(),
            config=engine_manager.analysis_config_path(),
        )
    return _analysis_instance


async def stop_katago_analysis() -> None:
    """停止 Analysis 引擎进程（切换模型时调用，下次请求惰性重启）。"""
    global _analysis_instance
    if _analysis_instance is not None:
        await _analysis_instance.stop()
