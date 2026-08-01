"""KataGo 自对弈校准（AI vs AI，支持让子与跨模型）。

用途：标定「AI 等级 ↔ 棋力」——让两个等级配置（模型 × visits）互相对弈，
通过让子数-胜率关系量化两者的棋力差（以「子」计），据此校准前端的
等级倍率与模型系数，替代拍脑袋估算。

- 同模型（model_a == model_b）：单个 KataGo 进程，每步切换 maxVisits；
- 跨模型：两个独立 KataGo 进程，落子互相同步。
"""
from __future__ import annotations

import asyncio
import logging
import re
from pathlib import Path

from app.core.config import get_settings
from app.services.engine_manager import find_model_file
from app.services.katago_gtp import KataGoGTP, gtp_to_vertex

logger = logging.getLogger(__name__)

# 一盘落子上限（防止引擎互不 pass 死循环）
MAX_MOVES_PER_GAME = 600

# Human-SL 校准默认配置（模板：humanSLProfile=rank_1k）。
# 需要其他段位时由调用方复制并改写 humanSLProfile 后传入 human_sl_config。
HUMAN_SL_DEFAULT_CONFIG = str(
    Path(__file__).resolve().parents[2] / "katago" / "human_calib.cfg"
)


def parse_final_score(raw: str) -> tuple[str, str]:
    """解析 GTP final_score 响应。

    'B+12.5' -> ('B', '12.5')，'W+2' -> ('W', '2')，'0'/'DRAW' -> ('D', '0')。
    返回 (winner: 'B'/'W'/'D', 目差文本)。
    """
    raw = raw.strip().upper()
    m = re.fullmatch(r"([BW])\+([\d.]+)", raw)
    if m:
        return m.group(1), m.group(2)
    return "D", raw or "0"


def summarize(results: list[dict]) -> dict:
    """汇总多盘结果：胜负统计 + 黑方平均目差（正 = 黑好）。"""
    total = len(results)
    black_wins = sum(1 for r in results if r["winner"] == "B")
    white_wins = sum(1 for r in results if r["winner"] == "W")
    draws = total - black_wins - white_wins
    scores = []
    for r in results:
        if r["score"] == "R":
            continue
        try:
            score = float(r["score"])
        except ValueError:
            continue
        scores.append(score if r["winner"] == "B" else -score)
    return {
        "games": total,
        "black_wins": black_wins,
        "white_wins": white_wins,
        "draws": draws,
        "black_win_rate": round(black_wins / total, 3) if total else 0.0,
        "black_avg_score": round(sum(scores) / len(scores), 2) if scores else None,
    }


async def _model_path(model_id: str) -> str:
    """解析模型路径：支持模型 id（b11c768h12）或完整文件名（xxx.bin.gz）。

    用 find_model_file（任意已安装模型，不受可切换白名单限制，如 b6c96 校准）。
    """
    path = find_model_file(model_id)
    if path:
        return path
    raise ValueError(f"模型 {model_id} 未安装（backend/katago/models/）")


def _new_gtp(
    model_path: str,
    *,
    human_model: str | None = None,
    config: str | None = None,
    human_sl_profile: str | None = None,
) -> KataGoGTP:
    settings = get_settings()
    return KataGoGTP(
        binary=settings.katago_binary,
        model=model_path,
        config=config or settings.katago_config,
        human_model=human_model,
        human_sl_profile=human_sl_profile,
    )


async def _play_one(
    black: KataGoGTP,
    white: KataGoGTP,
    *,
    size: int,
    komi: float,
    handicap: int,
    visits_black: int,
    visits_white: int,
    same_process: bool,
    human_color: str | None = None,
) -> dict:
    """下完一盘。返回 {winner, score, moves}。winner: 'B'/'W'/'D'。

    human_color：'B'/'W' 表示该侧是 Human-SL（visits 由 config 决定，不设置
    maxVisits，忽略对应 visits 参数）；None 表示两侧均为常规引擎。
    """
    for proc in (black, white):
        await proc.set_board_size(size)
        await proc.clear_board()
        await proc.set_komi(komi)

    # 搜索量：同进程（同模型）每手切换；不同进程（跨模型/Human-SL）开局设置一次。
    # Human-SL 侧不设置（humanSLChosenMoveProp=1.0 时搜索仅用于 pass/resign 判断）。
    if not same_process:
        if human_color != "B":
            await black.set_max_visits(visits_black)
        if human_color != "W":
            await white.set_max_visits(visits_white)

    # 让子：黑方先摆（引擎自行选择让子位），白方进程同步。
    # 注意：KataGo 的 place_free_handicap 只接受 2~9 子；让 1 子（让先）按
    # 「黑先走、黑不贴目」处理，不摆子。
    if handicap > 1:
        resp = await black.command(f"place_free_handicap {handicap}")
        # KataGo 返回单行空格分隔的多个坐标（如 "F7 E5"），按空白切分
        coords = resp.split()
        if len(coords) != handicap:
            raise RuntimeError(
                f"place_free_handicap 返回 {len(coords)} 个坐标（预期 {handicap}）: {resp}"
            )
        for coord in coords:
            vertex = gtp_to_vertex(coord, size)
            if vertex is None:
                raise RuntimeError(f"让子坐标解析失败: {coord}")
            if not same_process:
                await white.play("B", vertex)

    # 让 2 子以上黑先摆子、白先走；分先与让 1 子（让先）均黑先走
    colors = ["W", "B"] if handicap > 1 else ["B", "W"]
    consecutive_pass = 0
    for step in range(MAX_MOVES_PER_GAME):
        color = colors[step % 2]
        proc = black if color == "B" else white
        visits = visits_black if color == "B" else visits_white
        if same_process:
            await proc.set_max_visits(visits)
        raw = (await proc.command(f"genmove {color}")).strip().upper()
        other = white if color == "B" else black
        if raw == "RESIGN":
            winner = "W" if color == "B" else "B"
            return {"winner": winner, "score": "R", "moves": step + 1}
        if raw == "PASS":
            consecutive_pass += 1
            if consecutive_pass >= 2:
                break
            if not same_process:
                other_color = "W" if color == "B" else "B"
                await other.command(f"play {other_color} pass")
            continue
        consecutive_pass = 0
        vertex = gtp_to_vertex(raw, size)
        if vertex is None:
            raise RuntimeError(f"genmove 返回异常坐标: {raw}")
        if not same_process:
            await other.play(color, vertex)

    winner, score = parse_final_score(await black.command("final_score"))
    return {"winner": winner, "score": score, "moves": step + 1}


async def run_calibration(
    model_a: str,
    model_b: str,
    visits_a: int,
    visits_b: int,
    *,
    size: int = 19,
    komi: float = 0.0,
    handicap: int = 0,
    games: int = 4,
    black_side: str = "a",
    human_sl_model: str | None = None,
    human_sl_side: str | None = None,
    human_sl_config: str | None = None,
    human_sl_profile: str | None = None,
) -> dict:
    """跑校准：model_a/visits_a vs model_b/visits_b 对弈 games 盘。

    black_side 指定谁执黑（让子棋中黑方先摆子，通常较弱方执黑）。
    human_sl_model + human_sl_side：把 a/b 一侧换成 Human-SL 权重（该侧用
    human_sl_config 启动，visits 由配置决定，忽略对应 visits 参数，传 0 即可）。
    human_sl_profile 仅写入返回的 config 记录（段位由配置文件承载）。
    返回 {config, results, summary}。
    """
    if (human_sl_model is None) != (human_sl_side is None):
        raise ValueError("human_sl_model 与 human_sl_side 需同时指定")
    if human_sl_side is not None and human_sl_side not in ("a", "b"):
        raise ValueError("human_sl_side 必须为 'a' 或 'b'")

    path_a = await _model_path(model_a)
    path_b = await _model_path(model_b)
    human_side = human_sl_side if human_sl_model else None
    human_path: str | None = None
    if human_side is not None:
        assert human_sl_model is not None
        human_path = await _model_path(human_sl_model)
        if human_side == "a":
            path_a = human_path
        else:
            path_b = human_path
    # Human-SL 权重与常规模型必为不同文件，始终双进程
    same_process = path_a == path_b and human_side is None

    human_config = human_sl_config or HUMAN_SL_DEFAULT_CONFIG
    if human_side is not None:
        if not Path(human_config).exists():
            raise ValueError(f"Human-SL 配置不存在: {human_config}")
        cfg_a = human_config if human_side == "a" else None
        cfg_b = human_config if human_side == "b" else None
        hm_a = human_path if human_side == "a" else None
        hm_b = human_path if human_side == "b" else None
        proc_a = _new_gtp(path_a, human_model=hm_a, config=cfg_a, human_sl_profile=human_sl_profile)
        proc_b = _new_gtp(path_b, human_model=hm_b, config=cfg_b, human_sl_profile=human_sl_profile)
    else:
        proc_a = _new_gtp(path_a)
        proc_b = proc_a if same_process else _new_gtp(path_b)

    black = proc_a if black_side == "a" else proc_b
    white = proc_b if black_side == "a" else proc_a
    visits_black = visits_a if black_side == "a" else visits_b
    visits_white = visits_b if black_side == "a" else visits_a
    human_color = None
    if human_side is not None:
        human_color = "B" if black_side == human_side else "W"

    try:
        await asyncio.gather(*(p.start() for p in {proc_a, proc_b}))
        results: list[dict] = []
        for _ in range(games):
            try:
                r = await _play_one(
                    black,
                    white,
                    size=size,
                    komi=komi,
                    handicap=handicap,
                    visits_black=visits_black,
                    visits_white=visits_white,
                    same_process=same_process,
                    human_color=human_color,
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("对局失败（跳过）: %s", exc)
                continue
            results.append(r)
    finally:
        await asyncio.gather(*(p.stop() for p in {proc_a, proc_b}))

    if not results:
        raise RuntimeError("所有对局均失败，请检查 KataGo 进程与配置")

    return {
        "config": {
            "model_a": model_a,
            "model_b": model_b,
            "visits_a": visits_a,
            "visits_b": visits_b,
            "size": size,
            "komi": komi,
            "handicap": handicap,
            "games": games,
            "black_side": black_side,
            "human_sl_model": human_sl_model,
            "human_sl_side": human_sl_side,
            "human_sl_config": human_config if human_side is not None else None,
            "human_sl_profile": human_sl_profile if human_side is not None else None,
        },
        "results": results,
        "summary": summarize(results),
    }
