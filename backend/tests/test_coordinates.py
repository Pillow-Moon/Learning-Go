"""GTP 坐标转换回归测试。

与前端 src/lib/gtpCoords.test.ts 共享同一输入矩阵
（shared/coordinate-cases.json，单一来源，禁止各自复制）。
"""
import json
from pathlib import Path

import pytest

from app.services.katago_analysis import gtp_to_vertex, vertex_to_gtp

_CASES = json.loads(
    (
        Path(__file__).resolve().parents[2]  # Learning-Go/
        / "shared"
        / "coordinate-cases.json"
    ).read_text(encoding="utf-8")
)["cases"]


@pytest.mark.parametrize(
    "case",
    _CASES,
    ids=lambda c: f"{c['boardSize']}-{c['gtp']}",
)
def test_shared_matrix_roundtrip(case):
    """共享矩阵：内部 [x, y] -> GTP 与 GTP -> 内部 [x, y] 双向一致。"""
    board_size = case["boardSize"]
    vertex = tuple(case["vertex"])
    gtp = case["gtp"]
    assert vertex_to_gtp(vertex, board_size) == gtp
    assert gtp_to_vertex(gtp, board_size) == vertex


def test_pass_resign_empty_return_none():
    """pass/resign/空串统一返回 None（前端同为 null）。"""
    for special in ("pass", "PASS", "resign", "RESIGN", ""):
        assert gtp_to_vertex(special, 19) is None


def test_lowercase_gtp_is_normalized():
    """后端按 GTP 惯例接受小写输入（前端只接受大写，属各自边界差异）。"""
    assert gtp_to_vertex("q16", 19) == (15, 3)


def test_malformed_coord_returns_none():
    """长度不足 1 的输入不抛异常，返回 None。"""
    assert gtp_to_vertex("A", 19) is None
