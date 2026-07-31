"""AI 解说服务：把 KataGo 结构化分析转成自然语言教学解说。

核心原则：KataGo 负责全部棋局推理，LLM 只负责「 narration 」——
把胜率、目差、候选选点、变化图讲成学生能懂的话，不自行计算棋局。

使用 DeepSeek（OpenAI 兼容接口）流式生成，逐块产出文本。
"""
from __future__ import annotations

import json
import logging
from collections.abc import AsyncGenerator

import httpx

from app.core.config import get_settings
from app.schemas.commentary import CommentaryRequest

logger = logging.getLogger(__name__)

_LEVEL_DESC = {
    "beginner": "零基础初学者，请用最通俗的语言，解释基本术语（如气、提子、眼），避免高深战略。",
    "intermediate": "有一定基础的业余棋手，可以讲解常见定式、攻防要点和简单战略。",
    "advanced": "业余高段棋手，可以深入讲解形势判断、大局观和复杂变化。",
}

_SYSTEM_PROMPT = """你是一位耐心、专业的围棋教练。你的任务是根据 KataGo 引擎提供的分析数据，
用中文为学生讲解当前这手棋。

重要原则：
1. 棋局的计算（胜率、最佳选点、变化图）已由 KataGo 完成，你只需把这些数据讲解清楚，
   不要自行推断或编造 KataGo 未提供的具体数字。
2. 先点评学生刚下的这手棋（好在哪 / 问题在哪），再给出 KataGo 推荐的最佳应对及理由。
3. 如有变化图，用「如果……那么……」的方式简述关键变化。
4. 语言简洁清晰，控制在 150 字以内，适合边下边看。
5. 根据学生水平调整讲解深度。"""


def _format_candidates(req: CommentaryRequest) -> str:
    if not req.candidates:
        return "（无 KataGo 分析数据）"
    lines = []
    for i, c in enumerate(req.candidates[:5], 1):
        wr = f"{c.winrate * 100:.1f}%" if c.winrate is not None else "?"
        sl = f"{c.score_lead:+.1f}" if c.score_lead is not None else "?"
        pv = " ".join(c.pv[:6]) if c.pv else ""
        tag = "【推荐】" if i == 1 else f"候选{i}:"
        line = f"{tag} {c.move or 'pass'}，胜率 {wr}，目差 {sl}"
        if pv:
            line += f"，变化：{pv}"
        lines.append(line)
    return "\n".join(lines)


def build_messages(req: CommentaryRequest) -> list[dict]:
    level_hint = _LEVEL_DESC.get(req.level, _LEVEL_DESC["beginner"])
    player_cn = "黑棋" if req.player == "black" else "白棋"
    move_desc = req.move if req.move else "pass（虚手）"

    root_info = ""
    if req.root_winrate is not None:
        root_info = f"\n当前局面胜率（{player_cn}视角）：{req.root_winrate * 100:.1f}%"
    if req.root_score_lead is not None:
        root_info += f"，目差：{req.root_score_lead:+.1f}"

    recent = f"\n最近局势：{req.recent_summary}" if req.recent_summary else ""

    user_content = f"""学生水平：{level_hint}

棋盘规格：{req.board_size}×{req.board_size}
当前手数：第 {req.move_number} 手
刚落子方：{player_cn}
刚下的这手棋：{move_desc}{root_info}{recent}

KataGo 分析（候选选点，按推荐度排序）：
{_format_candidates(req)}

请讲解这手棋。"""

    return [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]


async def stream_commentary(req: CommentaryRequest) -> AsyncGenerator[str, None]:
    """调用 DeepSeek 流式生成解说，逐块 yield 文本。"""
    settings = get_settings()
    if not settings.deepseek_api_key:
        raise RuntimeError("未配置 DEEPSEEK_API_KEY")

    messages = build_messages(req)
    payload = {
        "model": settings.deepseek_model,
        "messages": messages,
        "stream": True,
        "temperature": 0.7,
        "max_tokens": 500,
    }
    headers = {"Authorization": f"Bearer {settings.deepseek_api_key}"}
    url = f"{settings.deepseek_base_url}/chat/completions"

    async with httpx.AsyncClient(timeout=60.0) as client:
        async with client.stream("POST", url, json=payload, headers=headers) as resp:
            if resp.status_code != 200:
                detail = await resp.aread()
                raise RuntimeError(
                    f"DeepSeek API 错误 {resp.status_code}: {detail.decode(errors='ignore')}"
                )
            async for line in resp.aiter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[len("data:"):].strip()
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                    delta = chunk["choices"][0]["delta"].get("content")
                    if delta:
                        yield delta
                except (json.JSONDecodeError, KeyError, IndexError):
                    continue
