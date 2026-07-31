"""后端集成测试：评估判题、定级报告、课程接口。

依赖已初始化的本地数据库（含种子数据）。运行：
    cd backend && .venv/Scripts/python -m pytest tests/ -q
"""
from fastapi.testclient import TestClient

from app.core.database import SessionLocal
from app.main import app
from app.models.problem import Problem
from app.services.assessment import _level_from_score

client = TestClient(app)


def test_health():
    resp = client.get("/api/v1/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_level_mapping():
    assert _level_from_score(95) == "业余1段"
    assert _level_from_score(45) == "15级"
    assert _level_from_score(10) == "30级"


def test_list_problems():
    resp = client.get("/api/v1/assessment/problems", params={"category": "规则认知"})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) > 0
    assert all(p["category"] == "规则认知" for p in data)


def test_answer_wrong_then_correct():
    # 取一道题，直接从数据库读其正解
    db = SessionLocal()
    problem = db.query(Problem).first()
    db.close()
    assert problem is not None

    # 错误答案（一个几乎不可能正确的坐标）
    wrong = client.post(
        "/api/v1/assessment/answer",
        json={"problem_id": problem.id, "vertex": "ZZ"},
    )
    assert wrong.status_code == 200
    assert wrong.json()["correct"] is False

    # 正确答案
    right = client.post(
        "/api/v1/assessment/answer",
        json={"problem_id": problem.id, "vertex": problem.correct_move},
    )
    assert right.status_code == 200
    assert right.json()["correct"] is True


def test_report():
    resp = client.post(
        "/api/v1/assessment/report",
        json={
            "problem_results": [
                {"category": "规则认知", "tag": "气", "correct": True},
                {"category": "规则认知", "tag": "吃子", "correct": True},
                {"category": "基础技巧", "tag": "征子", "correct": False},
            ],
            "game_overlaps": [
                {"max_visits": 1, "overlap_rate": 0.6, "move_count": 10},
                {"max_visits": 50, "overlap_rate": 0.4, "move_count": 10},
                {"max_visits": 200, "overlap_rate": 0.2, "move_count": 10},
            ],
        },
    )
    assert resp.status_code == 200
    report = resp.json()
    assert "level" in report
    assert "radar" in report
    # 吃子维度含：气(对)+吃子(对)+征子(错) = 2/3 -> 66.7
    assert report["radar"]["吃子"] == 66.7
    # 布局/围空/官子 来自三局重合度 0.6/0.4/0.2
    assert report["radar"]["布局"] == 60.0
    assert report["radar"]["围空"] == 40.0
    assert report["radar"]["官子"] == 20.0
    assert "recommended_courses" in report


def test_course_list_and_detail():
    lst = client.get("/api/v1/course")
    assert lst.status_code == 200
    courses = lst.json()
    assert len(courses) > 0

    detail = client.get(f"/api/v1/course/{courses[0]['id']}")
    assert detail.status_code == 200
    assert "lessons" in detail.json()
