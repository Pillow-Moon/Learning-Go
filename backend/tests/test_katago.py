"""KataGo 集成层纯逻辑测试（无需 KataGo 二进制）。

覆盖 Analysis 响应格式化——这些是集成正确性的关键且不依赖外部进程。
含黑方视角断言（reportAnalysisWinratesAs=BLACK 时 winrate/scoreLead 恒为黑方视角）。
2026-08 精简：GTP 对弈层（katago_gtp）已随 AI 对弈删除。
"""
import json
import os
import subprocess

import pytest

from app.services.katago_analysis import KataGoAnalysis

_KATAGO_EXE = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "katago", "katago.exe")
)
_KATAGO_MODEL = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "katago", "models", "b11c768h12.bin.gz")
)
_KATAGO_CFG = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "katago", "katago_analysis.cfg")
)


def test_format_response():
    # 模拟 KataGo Analysis 引擎的原始 JSON 响应
    raw = {
        "id": "q1",
        "moveInfos": [
            {
                "move": "Q16",
                "winrate": 0.65,
                "scoreLead": 2.3,
                "visits": 80,
                "prior": 0.3,
                "pv": ["Q16", "D4", "D17"],
            },
            {
                "move": "D4",
                "winrate": 0.55,
                "scoreLead": 1.1,
                "visits": 20,
                "prior": 0.2,
                "pv": ["D4"],
            },
        ],
        "rootInfo": {"winrate": 0.6, "scoreLead": 1.8},
    }
    result = KataGoAnalysis._format_response(raw, 19)
    assert result["board_size"] == 19
    # 按 visits 降序，Q16(80) 在前
    assert result["candidates"][0]["move"] == (15, 3)
    assert result["candidates"][0]["winrate"] == 0.65
    assert result["candidates"][0]["pv"][0] == (15, 3)
    assert result["candidates"][1]["move"] == (3, 15)
    assert result["root"]["winrate"] == 0.6


def test_format_response_keeps_black_perspective():
    """KataGo 配置 reportAnalysisWinratesAs=BLACK：winrate/scoreLead 恒为黑方视角
    （正=黑领先），后端 _format_response 必须原样透传、不得翻转。
    模拟「轮到白、黑大优」局面：黑胜率≈1、scoreLead 为正（黑领先）。"""
    raw = {
        "id": "q1",
        "moveInfos": [
            {
                "move": "E4",
                "winrate": 0.999,
                "scoreLead": 18.5,
                "visits": 10,
                "prior": 0.5,
                "pv": ["E4"],
            },
        ],
        "rootInfo": {"winrate": 0.998, "scoreLead": 21.2, "currentPlayer": "W"},
    }
    result = KataGoAnalysis._format_response(raw, 9)
    # 黑方视角原样透传（不翻转、不取反）
    assert result["root"]["winrate"] == 0.998
    assert result["root"]["score_lead"] == 21.2
    assert result["candidates"][0]["winrate"] == 0.999
    assert result["candidates"][0]["score_lead"] == 18.5

@pytest.mark.skipif(
    not (
        os.path.exists(_KATAGO_EXE)
        and os.path.exists(_KATAGO_MODEL)
        and os.path.exists(_KATAGO_CFG)
    ),
    reason="需要 KataGo 二进制与模型",
)
def test_analysis_black_perspective_integration():
    """集成断言（真实 KataGo）：
    1) 提交「轮到白、黑大优」局面（initialStones 数组对 + moves），
       断言 rootInfo.winrate 接近 1（黑方胜率）、scoreLead 为正（黑领先）；
    2) moveInfos 与 root 同视角；
    3) initialStones 数组对协议可用（不报错）。"""
    proc = subprocess.Popen(
        [_KATAGO_EXE, "analysis", "-model", _KATAGO_MODEL, "-config", _KATAGO_CFG],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        # 黑围左下大片（约 24 子），白中央一子被围（黑大优）
        black = [
            [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1],
            [1, 2], [7, 2], [1, 3], [7, 3], [1, 4], [7, 4],
            [1, 5], [7, 5], [1, 6], [7, 6],
            [1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7], [7, 7],
        ]
        white = [[4, 4]]
        init = [
            ["b", f"{chr(65 + x)}{9 - y}"] for x, y in black
        ] + [
            ["w", f"{chr(65 + x)}{9 - y}"] for x, y in white
        ]
        query = {
            "id": "q1",
            "moves": [["B", "A9"]],  # 黑先下一手 -> 轮到白
            "rules": "chinese",
            "boardXSize": 9,
            "boardYSize": 9,
            "komi": 7.5,
            "maxVisits": 30,
            "initialStones": init,
        }
        proc.stdin.write(json.dumps(query) + "\n")
        proc.stdin.flush()
        line = proc.stdout.readline()
        resp = json.loads(line)
        root = resp.get("rootInfo", {})
        assert root.get("currentPlayer") == "W", f"应轮到白: {root}"
        assert root.get("winrate", 0) > 0.9, f"黑方胜率应接近 1: {root}"
        assert root.get("scoreLead", 0) > 0, f"黑方目差应为正: {root}"
        move_info = (resp.get("moveInfos") or [{}])[0]
        assert move_info.get("winrate", 0) > 0.9, f"候选黑方胜率应接近 1: {move_info}"
        assert move_info.get("scoreLead", 0) > 0, f"候选黑方目差应为正: {move_info}"
    finally:
        proc.kill()
