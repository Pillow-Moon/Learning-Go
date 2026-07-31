"""种子数据：题库（Problem）+ 课程（Course/Lesson/Step）。

题目用 (x, y) 坐标定义（x=列 0 起从左，y=行 0 起从上），
由工具函数自动生成一致的 SGF 局面与 GTP 正解坐标，避免手工换算出错。
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.course import Course, Lesson, Step
from app.models.problem import Problem

# 9x9 棋盘列字母（围棋跳过 I）
_COL_LETTERS = "ABCDEFGHJ"


def xy_to_gtp(x: int, y: int, size: int) -> str:
    """(x, y) -> GTP 坐标，如 (4, 5) on 9x9 -> 'E4'。"""
    col = _COL_LETTERS[x] if size == 9 else "ABCDEFGHJKLMNOPQRST"[x]
    row = size - y
    return f"{col}{row}"


def _xy_to_sgf(x: int, y: int) -> str:
    """(x, y) -> SGF 坐标（两字母），如 (2, 3) -> 'cd'。"""
    return chr(ord("a") + x) + chr(ord("a") + y)


def build_sgf(
    stones: dict[tuple[int, int], str],
    size: int,
    player: str = "B",
) -> str:
    """从棋子字典生成 SGF。stones: {(x,y): 'B'/'W'}。"""
    black = [k for k, v in stones.items() if v == "B"]
    white = [k for k, v in stones.items() if v == "W"]
    ab = "".join(f"[{_xy_to_sgf(x, y)}]" for x, y in black)
    aw = "".join(f"[{_xy_to_sgf(x, y)}]" for x, y in white)
    return f"(;GM[1]FF[4]SZ[{size}]PL[{player}]AB{ab}AW{aw})"


# ===== 题库定义 =====
# 每题：category, tag, difficulty, size, stones, correct (x,y), explanation, distractors [(x,y)]
_PROBLEM_DEFS = [
    # ---- 规则认知 ----
    {
        "category": "规则认知", "tag": "气", "difficulty": 1, "size": 9,
        "stones": {(4, 4): "W", (3, 4): "B", (5, 4): "B", (4, 3): "B"},
        "correct": (4, 5), "player": "B",
        "explanation": "白子只剩最后一口气（E4 下方），黑下 E4 即可提子。",
        "distractors": [(0, 0), (8, 8)],
    },
    {
        "category": "规则认知", "tag": "吃子", "difficulty": 1, "size": 9,
        "stones": {(4, 4): "W", (4, 5): "W", (3, 4): "B", (5, 4): "B", (3, 5): "B", (5, 5): "B", (4, 6): "B"},
        "correct": (4, 3), "player": "B",
        "explanation": "两枚白子只剩一口气，黑下 D 列上方（E6 对应点）即提。",
        "distractors": [(0, 0), (8, 0)],
    },
    {
        "category": "规则认知", "tag": "眼", "difficulty": 2, "size": 9,
        "stones": {(2, 2): "B", (3, 2): "B", (2, 3): "B", (3, 3): "W"},
        "correct": (2, 2), "player": "B",
        "explanation": "要点：占据做眼的关键点可形成真眼活棋。",
        "distractors": [(0, 0), (8, 8)],
    },
    {
        "category": "规则认知", "tag": "打劫", "difficulty": 3, "size": 9,
        "stones": {(4, 4): "W", (3, 4): "B", (4, 3): "B", (5, 4): "B", (4, 5): "W", (3, 5): "W", (5, 5): "W"},
        "correct": (4, 4), "player": "B",
        "explanation": "这是劫争形状，黑可先提劫，但白不能立即回提（需先找劫材）。",
        "distractors": [(0, 0)],
    },
    {
        "category": "规则认知", "tag": "禁入点", "difficulty": 2, "size": 9,
        "stones": {(4, 4): "W", (3, 4): "B", (5, 4): "B", (4, 3): "B"},
        "correct": (4, 5), "player": "B",
        "explanation": "E4 下方是合法提子点；而无气又不提子的点属于禁入点（自杀禁着）。",
        "distractors": [(4, 4)],
    },
    # ---- 基础技巧 ----
    {
        "category": "基础技巧", "tag": "征子", "difficulty": 2, "size": 9,
        "stones": {(4, 4): "W", (3, 4): "B", (4, 3): "B"},
        "correct": (5, 4), "player": "B",
        "explanation": "征子（扭羊头）：从一侧连续打吃，把白子赶向棋盘边缘提掉。",
        "distractors": [(4, 5), (0, 0)],
    },
    {
        "category": "基础技巧", "tag": "枷吃", "difficulty": 3, "size": 9,
        "stones": {(4, 4): "W", (3, 4): "B", (4, 3): "B"},
        "correct": (5, 5), "player": "B",
        "explanation": "枷吃：不直接打吃，而是斜飞一手把白子罩住，使其逃不掉。",
        "distractors": [(5, 4), (0, 0)],
    },
    {
        "category": "基础技巧", "tag": "倒扑", "difficulty": 3, "size": 9,
        "stones": {(4, 4): "W", (3, 4): "W", (4, 3): "B", (5, 4): "B", (3, 3): "B", (2, 4): "B"},
        "correct": (4, 4), "player": "B",
        "explanation": "倒扑：先送吃一子，待对方提后反手提掉更多敌子。",
        "distractors": [(0, 0)],
    },
    {
        "category": "基础技巧", "tag": "接不归", "difficulty": 3, "size": 9,
        "stones": {(4, 4): "W", (5, 4): "W", (3, 4): "B", (4, 3): "B", (5, 3): "B", (6, 4): "B"},
        "correct": (4, 5), "player": "B",
        "explanation": "接不归：打吃后对方即使连接也仍被提，连接无意义。",
        "distractors": [(0, 0)],
    },
    {
        "category": "基础技巧", "tag": "双活", "difficulty": 4, "size": 9,
        "stones": {(4, 4): "W", (5, 4): "W", (3, 4): "B", (4, 3): "B", (5, 3): "B", (6, 4): "B", (4, 5): "B", (5, 5): "B"},
        "correct": (3, 3), "player": "B",
        "explanation": "双活：双方共享公气，谁先动手谁被吃，形成共活。",
        "distractors": [(0, 0)],
    },
]


def _build_problems() -> list[Problem]:
    problems = []
    for d in _PROBLEM_DEFS:
        size = d["size"]
        sgf = build_sgf(d["stones"], size, d.get("player", "B"))
        problems.append(
            Problem(
                category=d["category"],
                tag=d["tag"],
                difficulty=d["difficulty"],
                sgf=sgf,
                correct_move=xy_to_gtp(*d["correct"], size),
                distractors=[xy_to_gtp(*xy, size) for xy in d.get("distractors", [])],
                explanation=d["explanation"],
            )
        )
    return problems


# ===== 课程定义 =====
_COURSE_DEFS = [
    {
        "title": "围棋规则入门", "dimension": "规则", "difficulty": 1,
        "description": "认识棋盘、气、提子、打劫与禁入点，零基础第一课。",
        "lessons": [
            {"title": "棋盘与气", "steps": [
                {"instruction": "围棋棋盘有 19×19 条线。棋子落在交叉点上，相邻的空点叫做「气」。", "sgf": build_sgf({(4, 4): "B"}, 9), "explanation": "中央一颗黑子有 4 口气。"},
                {"instruction": "试着堵住白子的最后一口气，把它提掉。", "sgf": build_sgf({(4, 4): "W", (3, 4): "B", (5, 4): "B", (4, 3): "B"}, 9), "expected_move": xy_to_gtp(4, 5, 9), "explanation": "下在最后一口气上即可提子。"},
            ]},
            {"title": "打劫与禁入点", "steps": [
                {"instruction": "打劫：双方可以反复互提一子的特殊形状，规则禁止立即回提。", "sgf": build_sgf({(4, 4): "W", (3, 4): "B", (4, 3): "B", (5, 4): "B"}, 9), "explanation": "提劫后对方需先在他处落子（找劫材）。"},
            ]},
        ],
    },
    {
        "title": "吃子技巧", "dimension": "吃子", "difficulty": 2,
        "description": "学习征子、枷吃、倒扑、接不归等常用吃子手法。",
        "lessons": [
            {"title": "征子（扭羊头）", "steps": [
                {"instruction": "征子：从一侧连续打吃，把对方赶向边缘。", "sgf": build_sgf({(4, 4): "W", (3, 4): "B", (4, 3): "B"}, 9), "expected_move": xy_to_gtp(5, 4, 9), "explanation": "持续打吃即可征掉。"},
            ]},
            {"title": "枷吃与倒扑", "steps": [
                {"instruction": "枷吃：斜飞一手把敌子罩住。", "sgf": build_sgf({(4, 4): "W", (3, 4): "B", (4, 3): "B"}, 9), "expected_move": xy_to_gtp(5, 5, 9), "explanation": "枷吃让白子无路可逃。"},
            ]},
        ],
    },
    {
        "title": "围空基础", "dimension": "围空", "difficulty": 2,
        "description": "理解「围地」目标，学习如何高效围空。",
        "lessons": [
            {"title": "占地与围空", "steps": [
                {"instruction": "围棋的目标是围出比对方更多的空（地）。边角更容易围。", "sgf": build_sgf({(2, 2): "B", (5, 2): "B", (2, 5): "B"}, 9), "explanation": "先用少量棋子占据边角要点。"},
            ]},
        ],
    },
    {
        "title": "死活入门", "dimension": "死活", "difficulty": 3,
        "description": "认识眼与活棋，学会判断棋块的死活。",
        "lessons": [
            {"title": "眼与活棋", "steps": [
                {"instruction": "一块棋做出两个真眼才能活。", "sgf": build_sgf({(2, 2): "B", (3, 2): "B", (2, 3): "B"}, 9), "expected_move": xy_to_gtp(2, 2, 9), "explanation": "占据要点做出真眼。"},
            ]},
        ],
    },
    {
        "title": "布局初步", "dimension": "布局", "difficulty": 3,
        "description": "学习开局占角、挂角与拆边的基本思路。",
        "lessons": [
            {"title": "占角与挂角", "steps": [
                {"instruction": "开局先占空角，效率最高。", "sgf": build_sgf({}, 9), "expected_move": xy_to_gtp(2, 2, 9), "explanation": "星位或小目占角是常见开局。"},
            ]},
        ],
    },
]


def _build_courses() -> list[Course]:
    courses = []
    for i, cd in enumerate(_COURSE_DEFS):
        course = Course(
            title=cd["title"],
            description=cd["description"],
            dimension=cd["dimension"],
            difficulty=cd["difficulty"],
            order_index=i,
        )
        for j, ld in enumerate(cd["lessons"]):
            lesson = Lesson(title=ld["title"], order_index=j)
            for k, sd in enumerate(ld["steps"]):
                lesson.steps.append(
                    Step(
                        order_index=k,
                        sgf=sd.get("sgf"),
                        instruction=sd.get("instruction", ""),
                        expected_move=sd.get("expected_move"),
                        explanation=sd.get("explanation", ""),
                    )
                )
            course.lessons.append(lesson)
        courses.append(course)
    return courses


def seed_all(db: Session) -> None:
    """导入全部种子数据（幂等：已有数据则跳过）。"""
    existing_problems = db.scalar(select(Problem.id).limit(1))
    if existing_problems is None:
        db.add_all(_build_problems())
        print(f"导入题目 {len(_PROBLEM_DEFS)} 道")

    existing_courses = db.scalar(select(Course.id).limit(1))
    if existing_courses is None:
        db.add_all(_build_courses())
        print(f"导入课程 {len(_COURSE_DEFS)} 门")

    db.commit()
