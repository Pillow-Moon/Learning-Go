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
import sys
from pathlib import Path

from app.core.config import get_settings
from app.services import engine_manager

logger = logging.getLogger(__name__)

# 列坐标字母（围棋惯例跳过 I）
_LETTERS = "ABCDEFGHJKLMNOPQRSTUVWXYZ"


def _human_gtp_cfg_path() -> str:
    """Human-SL 对弈配置路径：绿色包内（只读）；开发 = backend/katago/human_gtp.cfg。"""
    if getattr(sys, "frozen", False):
        return str(Path(sys._MEIPASS) / "katago" / "human_gtp.cfg")
    return str(Path(__file__).resolve().parents[2] / "katago" / "human_gtp.cfg")


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

    def __init__(
        self,
        binary: str,
        model: str,
        config: str | None = None,
        human_model: str | None = None,
        human_sl_profile: str | None = None,
    ):
        """human_model：Human-SL 权重路径（启动时追加 -human-model <path>）。

        human_sl_profile 仅作记录（日志），Human-SL 段位由 config 文件中的
        humanSLProfile 字段承载（KataGo 启动参数不含 profile）。
        """
        self.binary = binary
        self.model = model
        self.config = config
        self.human_model = human_model
        self.human_sl_profile = human_sl_profile
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
        if self.human_model:
            args += ["-human-model", self.human_model]
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

    async def set_human_sl_profile(self, profile: str) -> None:
        """动态切换 Human-SL 档位（rank_20k~rank_9d，运行中生效无需重启）。"""
        await self.command(f"kata-set-param humanSLProfile {profile}")

    async def set_human_sl_pikl_lambda(self, value: float) -> None:
        """Human-SL 搜索抑制系数：1e8 = 纯风格（不抑制人类随手）；
        0.08 ≈ 官方 9d 增强档（抑制 KataGo 不认同的着法，棋力更强更不像人类）。"""
        await self.command(f"kata-set-param humanSLChosenMovePiklLambda {value}")

    async def set_human_sl_explore(self, enabled: bool) -> None:
        """官方 9d 增强配方：enabled 时 80% visits 探索人类着法且衰减不收敛。

        增强档（am6d/am7d）用 0.8 / 2.0；普通档恢复 0.0 / 0.2。
        """
        await self.command(
            f"kata-set-param humanSLRootExploreProbWeightless {0.8 if enabled else 0.0}"
        )
        await self.command(
            f"kata-set-param humanSLCpuctPermanent {2.0 if enabled else 0.2}"
        )

    async def play(self, color: str, vertex: tuple[int, int] | None) -> None:
        """落子。color 为 'B'/'W'，vertex 为 None 表示 pass。"""
        coord = "pass" if vertex is None else vertex_to_gtp(vertex, self.board_size)
        await self.command(f"play {color} {coord}")

    async def genmove(self, color: str) -> tuple[int, int] | None:
        """让 AI 生成一手。返回 [x, y]，pass/resign 返回 None。"""
        resp = await self.command(f"genmove {color}")
        return gtp_to_vertex(resp, self.board_size)


# ===== 全局单例管理（按模式区分：normal 正常模型 / human_sl Human-SL 对弈模型） =====

_gtp_instance: KataGoGTP | None = None
_gtp_mode: str | None = None


def get_katago_gtp() -> KataGoGTP:
    """获取全局 KataGo GTP 实例（normal 模式，惰性创建；向后兼容）。

    对弈接口请使用 ensure_play_mode() 按档位模式获取。
    """
    global _gtp_instance, _gtp_mode
    if _gtp_instance is None or _gtp_mode != "normal":
        _gtp_instance = KataGoGTP(
            binary=engine_manager.katago_binary_path(),
            model=engine_manager.get_current_model_path(),
            config=engine_manager.gtp_config_path(),
        )
        _gtp_mode = "normal"
    return _gtp_instance


async def ensure_play_mode(mode: str) -> KataGoGTP:
    """确保 GTP 单例处于指定对弈模式（normal / human_sl），跨模式切换时停旧进程。

    - normal：当前模型（b11c768h12）+ 默认配置，按 visits 控强度（pro 档/9路13路）
    - human_sl：正常模型 + -human-model humanv0（官方附加模式，human_gtp.cfg），
      按 rank profile 控强度（am20k~am7d），档位运行时 kata-set-param 动态切换
    """
    global _gtp_instance, _gtp_mode
    if _gtp_instance is not None and _gtp_mode != mode:
        await stop_katago_gtp()
    if _gtp_instance is None:
        settings = get_settings()
        if mode == "human_sl":
            _gtp_instance = KataGoGTP(
                binary=engine_manager.katago_binary_path(),
                model=engine_manager.get_current_model_path(),
                human_model=engine_manager.get_human_sl_model_path(),
                human_sl_profile="rank_5k",
                config=_human_gtp_cfg_path(),
            )
            _gtp_mode = "human_sl"
        else:
            _gtp_instance = KataGoGTP(
                binary=engine_manager.katago_binary_path(),
                model=engine_manager.get_current_model_path(),
                config=engine_manager.gtp_config_path(),
            )
            _gtp_mode = "normal"
    return _gtp_instance


async def stop_katago_gtp() -> None:
    """停止 GTP 引擎进程（切换模型/模式时调用，下次请求惰性重启）。"""
    global _gtp_instance, _gtp_mode
    if _gtp_instance is not None:
        await _gtp_instance.stop()
    _gtp_instance = None
    _gtp_mode = None


def is_any_gtp_running() -> bool:
    """当前是否有任意模式的 GTP 实例在运行（控制面板状态用）。"""
    return _gtp_instance is not None and _gtp_instance.is_running
