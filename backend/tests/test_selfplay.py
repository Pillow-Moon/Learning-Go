"""自对弈校准纯逻辑测试（无需 KataGo 二进制）。

覆盖 final_score 解析与结果汇总——这两个是校准数据可信度的关键。
"""
from app.services.selfplay import parse_final_score, summarize


def test_parse_final_score():
    assert parse_final_score("B+12.5") == ("B", "12.5")
    assert parse_final_score("W+2") == ("W", "2")
    assert parse_final_score("b+3.5") == ("B", "3.5")  # 大小写
    assert parse_final_score("0") == ("D", "0")
    assert parse_final_score("DRAW") == ("D", "DRAW")
    assert parse_final_score("") == ("D", "0")


def test_summarize_basic():
    results = [
        {"winner": "B", "score": "3.5", "moves": 200},
        {"winner": "W", "score": "2.0", "moves": 210},
        {"winner": "B", "score": "R", "moves": 150},  # 认输不计目差
    ]
    s = summarize(results)
    assert s["games"] == 3
    assert s["black_wins"] == 2
    assert s["white_wins"] == 1
    assert s["draws"] == 0
    assert s["black_win_rate"] == round(2 / 3, 3)
    # 目差：B+3.5 → +3.5；W+2 → -2；认输跳过
    assert s["black_avg_score"] == 0.75


def test_summarize_all_resign_no_score():
    results = [{"winner": "W", "score": "R", "moves": 100}]
    s = summarize(results)
    assert s["black_avg_score"] is None
    assert s["black_win_rate"] == 0.0
