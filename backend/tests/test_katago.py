"""KataGo 集成层纯逻辑测试（无需 KataGo 二进制）。

覆盖坐标转换与 Analysis 响应格式化——这些是集成正确性的关键且不依赖外部进程。
"""
from app.services.katago_gtp import gtp_to_vertex, vertex_to_gtp
from app.services.katago_analysis import KataGoAnalysis


def test_vertex_gtp_roundtrip_19():
    # 19 路：(0,0) 左上 -> A19；(15,3) -> Q16
    assert vertex_to_gtp((0, 0), 19) == "A19"
    assert vertex_to_gtp((15, 3), 19) == "Q16"
    assert gtp_to_vertex("A19", 19) == (0, 0)
    assert gtp_to_vertex("Q16", 19) == (15, 3)


def test_vertex_gtp_roundtrip_9():
    # 9 路：列字母跳过 I，(4,5) -> E4
    assert vertex_to_gtp((4, 5), 9) == "E4"
    assert gtp_to_vertex("E4", 9) == (4, 5)


def test_gtp_special_values():
    assert gtp_to_vertex("pass", 19) is None
    assert gtp_to_vertex("resign", 19) is None
    assert gtp_to_vertex("", 19) is None


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
