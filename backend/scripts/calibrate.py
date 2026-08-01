"""AI 等级校准脚本：让两个等级配置（模型 × visits）自对弈，量化棋力差（以让子计）。

调用后端接口 POST /api/v1/engine/calibrate（需先启动后端，且对应模型已安装）。

用法示例：
  # 同模型 b11c768h12：业余 3 段 vs 业余 6 段（visits 由 aiVisitsFor 公式算出），分先 4 盘
  python scripts/calibrate.py --model-a b11c768h12 --model-b b11c768h12 \
      --visits-a 972 --visits-b 2268 --games 4

  # 让子扫描 0~3 子，自动找「黑胜率 ≈ 50%」的均势让子数（即两档棋力差）
  python scripts/calibrate.py --model-a b11c768h12 --model-b b11c768h12 \
      --visits-a 972 --visits-b 2268 --handicap-scan 3 --games 4

  # 跨模型同 visits（标定模型系数）：b11c768h12 vs b10c512h8
  python scripts/calibrate.py --model-a b11c768h12 --model-b b10c512h8 \
      --visits-a 1000 --visits-b 1000 --handicap-scan 3 --games 4

  # L1 批量相邻等级让子扫描（--plan）：对相邻档自动换算 visits 并逐对扫描
  python scripts/calibrate.py --plan b11c768h12 --levels am1k am1d am2d am3d \
      --games 4 --size 19 --scan 3

  # 9 路快速预扫（首轮筛选可疑档对，盘少、扫描浅）
  python scripts/calibrate.py --plan b11c768h12 --levels am1k am1d am2d am3d \
      --games 2 --size 9 --scan 2

说明：
  - 让子棋中黑方先摆 handicap 个子再白先走，黑胜率 ≈ 50% 表示两档棋力差 ≈ handicap 子；
  - 通常让较弱方执黑（--black-side 指定较弱方是 a 还是 b，--plan 模式固定弱方执黑）；
  - --plan 模式 visits 换算：aiVisitsFor = 3000 × ratio(等级) × factor(模型)，
    映射表与前端 frontend/src/stores/settingsStore.ts 的 AI_STRENGTH_OPTIONS /
    getModelStrengthInfo 保持一致，修改前端时需同步。
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

# ===== 等级/模型映射（单一来源：shared/ai-strength.json，与前端 settingsStore 同源）=====

_SHARED_JSON = Path(__file__).resolve().parents[2] / "shared" / "ai-strength.json"


def _load_params() -> dict:
    """读取共享强度参数（等级表/模型系数/基准）。"""
    if not _SHARED_JSON.exists():
        sys.exit(f"共享强度参数文件不存在: {_SHARED_JSON}")
    with open(_SHARED_JSON, encoding="utf-8") as f:
        return json.load(f)


_PARAMS = _load_params()

# AI 等级 id → 搜索量倍率（相对业余 1 段 ratio=1）
LEVEL_RATIO: dict[str, float] = {l["id"]: l["ratio"] for l in _PARAMS["levels"]}

# visits 绝对基准：业余 1 段在 b6c96（factor=1）上的目标访问量
BASE_VISITS_AM1D = _PARAMS["baseVisitsAm1d"]

# 模型 id 子串 → 棋力系数 factor（未识别按 modelDefault 保守）
_MODEL_FACTORS: list[tuple[str, float]] = [
    (m["id"], m["factor"]) for m in _PARAMS["models"]
]
_MODEL_FACTOR_DEFAULT = _PARAMS["modelDefault"]["factor"]  # 未知模型（含 b10c384）


def model_factor(model_id: str) -> float:
    """按模型 id（子串匹配）取棋力系数，与 settingsStore.getModelStrengthInfo 一致。"""
    mid = model_id.lower()
    for key, factor in _MODEL_FACTORS:
        if key in mid:
            return factor
    return _MODEL_FACTOR_DEFAULT


def level_visits(model_id: str, level: str) -> int:
    """等级 id → 绝对 visits：BASE_VISITS_AM1D × ratio × factor（move 场景 SCENE_RATIO=1）。"""
    return round(BASE_VISITS_AM1D * LEVEL_RATIO[level] * model_factor(model_id))


# ===== Human-SL 配置管理 =====

# Human-SL 校准配置目录（backend/katago/）
HUMAN_CALIB_DIR = Path(__file__).resolve().parents[1] / "katago"


def ensure_human_config(profile: str) -> str:
    """为 Human-SL profile 准备配置文件 human_calib_<profile>.cfg（返回路径）。

    目标不存在或 humanSLProfile 行与 profile 不符时，从模板
    human_calib.cfg（humanSLProfile=rank_1k）复制并改写该行。
    """
    template = HUMAN_CALIB_DIR / "human_calib.cfg"
    target = HUMAN_CALIB_DIR / f"human_calib_{profile}.cfg"
    if not template.exists():
        sys.exit(f"Human-SL 校准配置模板不存在: {template}")
    if target.exists() and f"humanSLProfile = {profile}" in target.read_text(encoding="utf-8"):
        return str(target)
    text = template.read_text(encoding="utf-8")
    new_text = re.sub(r"(?m)^humanSLProfile\s*=.*$", f"humanSLProfile = {profile}", text)
    target.write_text(new_text, encoding="utf-8")
    return str(target)


def human_sl_rank_value(profile: str) -> int | None:
    """段位标尺数值：rank_1k → -1，rank_1d → 1，rank_3d → 3；解析失败返回 None。"""
    m = re.fullmatch(r"rank_(\d+)([kd])", profile)
    if not m:
        return None
    n, unit = int(m.group(1)), m.group(2)
    return n if unit == "d" else -n


def human_sl_verdict(profile: str, d: int | None, rate: float | None) -> str:
    """由均势让子数 d 给出「本地相对 Human-SL 段位」结论。

    d = 本地引擎（执黑）让 Human-SL 的子数：d=0 同段位；d>0 本地强 d 子（≈ d 段）；
    d=0 但黑胜率明显低于 50% → Human 更强（需反向让子定量）；d 达上限黑仍
    大胜 → 本地强于 Human 超出扫描范围。
    """
    rv = human_sl_rank_value(profile)
    if rv is None:
        return f"Human-SL 段位标签 {profile} 无法换算（仅方向参考）"
    if d is None or rate is None:
        return "未找到有效均势点（对局异常或全部失败）"
    if d == 0 and rate <= 0.35:
        return (f"Human-SL {profile} 分先占优（黑胜率仅 {rate * 100:.0f}%）："
                f"本地弱于 {profile}，差距需反向让子定量")
    if d == 0:
        return f"本地 ≈ Human-SL {profile}（{_rank_label(rv)}），同段位"
    if rate >= 0.65:
        return (f"本地强于 {profile} ≥ {d + 1} 子（让 {d} 子黑胜率 {rate * 100:.0f}%："
                f"约 {_rank_label(rv + d + 1)} 或更强）")
    return f"本地强于 {profile} 约 {d} 子（≈ {_rank_label(rv + d)}）"


def _rank_label(v: int) -> str:
    """标尺数值 → 段位标签：-2→3级，-1→1级，0→级段之间，1→1段，3→3段。"""
    if v == 0:
        return "级段之间"
    if v < 0:
        return f"{1 - v}级"
    return f"{v}段"


def call_calibrate(api: str, payload: dict) -> dict:
    """调用 POST /engine/calibrate。"""
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        api.rstrip("/") + "/engine/calibrate",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=5400) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        sys.exit(f"接口错误 {exc.code}: {detail}")
    except urllib.error.URLError as exc:
        sys.exit(f"无法连接后端（{exc.reason}），请先启动后端并确认 --api 地址")


def print_game(result: dict, idx: int) -> None:
    winner_cn = {"B": "黑", "W": "白", "D": "和"}.get(result["winner"], "?")
    if result["score"] == "R":
        score = "（认输）"
    else:
        score = f"（{result['score']} 目）" if result["winner"] != "D" else ""
    print(f"  第 {idx} 盘：{winner_cn}胜 {score} · {result['moves']} 手")


def print_summary(summary: dict, *, black_label: str, white_label: str) -> None:
    s = summary
    print(
        f"\n汇总（{s['games']} 盘）：黑({black_label}) {s['black_wins']} 胜 · "
        f"白({white_label}) {s['white_wins']} 胜 · 和 {s['draws']}"
    )
    print(f"黑胜率 {s['black_win_rate'] * 100:.1f}%", end="")
    if s["black_avg_score"] is not None:
        print(f" · 黑平均目差 {s['black_avg_score']:+.1f}", end="")
    print()


def _human_side_label(args: argparse.Namespace, side: str) -> str:
    """侧标签：Human-SL 侧显示 Human-SL(profile)，否则 model@visits。"""
    if getattr(args, "human_sl", None) and getattr(args, "human_sl_side", None) == side:
        return f"Human-SL({args.human_sl_profile})"
    model = args.model_a if side == "a" else args.model_b
    visits = args.visits_a if side == "a" else args.visits_b
    return f"{model}@{visits}"


def _calibrate_payload(args: argparse.Namespace, handicap: int) -> dict:
    """构建校准请求 payload（human_sl 存在时附加 Human-SL 字段）。

    Human-SL 扫描中让 0 子（分先）用标准贴目 7.5：9 路 komi=0 时黑先手优势约 7 目，
    让 0 子会变成「黑必胜」，均势点无意义；让子档（>=1）保持 komi=0（让子不贴目）。
    用户显式 --komi 非 0 时以其为准。
    """
    payload = {
        "model_a": args.model_a,
        "model_b": args.model_b,
        "visits_a": args.visits_a,
        "visits_b": args.visits_b,
        "size": args.size,
        "komi": args.komi,
        "handicap": handicap,
        "games": args.games,
        "black_side": args.black_side,
    }
    if getattr(args, "human_sl", None):
        if handicap == 0 and args.komi == 0.0:
            payload["komi"] = 7.5
        payload.update(
            {
                "human_sl_model": args.human_sl,
                "human_sl_side": args.human_sl_side,
                "human_sl_config": args.human_sl_config,
                "human_sl_profile": args.human_sl_profile,
            }
        )
    return payload


def run_once(args: argparse.Namespace) -> None:
    payload = _calibrate_payload(args, args.handicap)
    data = call_calibrate(args.api, payload)
    cfg = data["config"]
    black_ab, white_ab = args.black_side, "b" if args.black_side == "a" else "a"
    print(
        f"对局：{_human_side_label(args, black_ab)} vs {_human_side_label(args, white_ab)} · "
        f"{cfg['size']} 路 · 贴目 {cfg['komi']} · 让 {cfg['handicap']} 子 · {cfg['games']} 盘"
    )
    for i, r in enumerate(data["results"], 1):
        print_game(r, i)
    print_summary(
        data["summary"],
        black_label=_human_side_label(args, black_ab),
        white_label=_human_side_label(args, white_ab),
    )


def run_scan(args: argparse.Namespace) -> tuple[int, float] | None:
    """让子扫描：handicap 0..max 各跑 games 盘，找黑胜率最接近 50% 的点。

    返回 (均势让子数, 黑胜率)，未找到均势点（全部偏离 50%）时返回最接近的点。
    """
    black_ab = args.black_side
    white_ab = "b" if black_ab == "a" else "a"
    rows: list[tuple[int, float | None, int]] = []  # (handicap, black_win_rate, games)
    for h in range(0, args.handicap_scan + 1):
        payload = _calibrate_payload(args, h)
        print(
            f"—— 让 {h} 子（黑={_human_side_label(args, black_ab)}"
            f" vs 白={_human_side_label(args, white_ab)}）——"
        )
        try:
            data = call_calibrate(args.api, payload)
        except SystemExit as exc:
            print(f"  [让 {h} 子调用失败，跳过本档] {exc}")
            rows.append((h, None, 0))
            continue
        for i, r in enumerate(data["results"], 1):
            print_game(r, i)
        s = data["summary"]
        rows.append((h, s["black_win_rate"], s["games"]))
        print(f"黑胜率 {s['black_win_rate'] * 100:.1f}%\n")

    print("\n===== 让子扫描汇总 =====")
    print("让子数 | 黑胜率 | 盘数")
    for h, rate, n in rows:
        if rate is None:
            print(f"  {h}    | 失败   |  0")
            continue
        bar = "#" * round(rate * 20)
        print(f"  {h}    | {rate * 100:5.1f}% | {n:2d} {bar}")
    # 找最接近 50% 的让子数（跳过失败档）
    valid = [r for r in rows if r[1] is not None]
    best = min(valid, key=lambda r: abs(r[1] - 0.5), default=None)
    if best is not None:
        h, rate, _ = best
        assert rate is not None
        verdict = (
            f"两档棋力差约 {h} 子（让 {h} 子时黑胜率 {rate * 100:.1f}% 最接近均势）。"
            if abs(rate - 0.5) <= 0.35
            else f"未找到均势点（让 {h} 子时黑胜率仍为 {rate * 100:.1f}%，两档差距超出扫描范围）。"
        )
        print(f"\n结论：{verdict}")
        print("说明：让子棋黑方先摆子，黑胜率≈50% 表示黑（较弱方）靠 N 子弥补后与白方均势。")
    else:
        print("\n结论：所有让子档均对局失败，无有效数据（详见上方失败记录）。")
    if best is None:
        return None
    h, rate, _ = best
    return h, rate


def ratio_advice(lo: str, hi: str, d: int | None) -> str:
    """按实测均势让子数 d（目标：相邻段差 1 子）给出 hi 档 ratio 修正建议。

    经验假设：棋力差（子）≈ k·log(r_hi/r_lo)。目标 d=1，则期望
    log(r_hi'/r_lo) = log(r_hi/r_lo)/d，即 r_hi' = r_lo·(r_hi/r_lo)^(1/d)。
    d=0（差距不足 1 子）时无法外推，经验上建议将 log 差距翻倍放大。
    """
    r_lo, r_hi = LEVEL_RATIO[lo], LEVEL_RATIO[hi]
    if d is None:
        return "无均势点：两档差距超出扫描范围，建议加大 --scan"
    if d == 1:
        return "步长合理，ratio 保持现状"
    if d > 1:
        target = r_lo * math.exp(math.log(r_hi / r_lo) / d)
        return f"差距偏大：{hi} 的 ratio 建议由 {r_hi} 缩至约 {target:.2f}"
    target = r_lo * (r_hi / r_lo) ** 2
    return f"差距偏小：{hi} 的 ratio 建议由 {r_hi} 放大至约 {target:.2f}"


def run_human_sl_scan(args: argparse.Namespace, parser: argparse.ArgumentParser, model: str) -> None:
    """L3 Human-SL 锚定扫描：--levels 每个本地等级档与 Human-SL profile 让子扫描。

    本地引擎固定执黑摆子（black_side = 非 human 侧，与让子棋「弱方执黑」约定一致）：
    均势让子数 d 表示「本地让 Human-SL d 子后均势」——d=0 同段位；d>0 本地强 d 子
    （≈ d 段）。每个 profile 单独跑一次本模式（--human-sl-profile 切换，自动生成配置）。
    """
    levels = args.levels or []
    if not levels:
        parser.error("--human-sl 模式下 --levels 至少需要 1 个等级 id")
    unknown = [lv for lv in levels if lv not in LEVEL_RATIO]
    if unknown:
        parser.error(
            f"未知等级 id: {', '.join(unknown)}\n可用等级: {', '.join(LEVEL_RATIO)}"
        )
    factor = model_factor(model)
    human_config = ensure_human_config(args.human_sl_profile)
    # 本地引擎执黑（黑方先摆让子）；Human-SL 在另一侧执白
    black_side = "a" if args.human_sl_side == "b" else "b"
    print(
        f"===== L3 Human-SL 锚定扫描：模型 {model}（factor={factor}）· {args.size} 路 · "
        f"每档 {args.games} 盘 · 扫描 0~{args.scan} 子 ====="
    )
    print(
        f"Human-SL: {args.human_sl}（{args.human_sl_side} 侧执白，profile 由配置决定）"
        f" · profile={args.human_sl_profile} · config={human_config}\n"
    )
    rows: list[tuple[str, int, tuple[int, float] | None]] = []
    for lv in levels:
        visits = level_visits(model, lv)
        print(f"—— 等级 {lv}({visits}v) vs Human-SL {args.human_sl_profile} ——")
        scan_args = argparse.Namespace(
            model_a=model,
            model_b=model,
            visits_a=visits,
            visits_b=0,
            size=args.size,
            komi=args.komi,
            handicap_scan=args.scan,
            games=args.games,
            black_side=black_side,
            api=args.api,
            human_sl=args.human_sl,
            human_sl_side=args.human_sl_side,
            human_sl_config=human_config,
            human_sl_profile=args.human_sl_profile,
        )
        best = run_scan(scan_args)
        rows.append((lv, visits, best))

    print("\n===== L3 映射表（本地等级 ↔ Human-SL 段位标签）=====")
    print(f"{'本地档':<8} | {'visits':>6} | {'均势让子(本地让HL)':>12} | {'黑胜率':>6} | 结论")
    for lv, visits, best in rows:
        if best is None:
            d, rate = None, None
            rate_txt = "-"
        else:
            d, rate = best
            rate_txt = f"{rate * 100:.1f}%"
        print(
            f"{lv:<8} | {visits:>6} | {d if d is not None else '-':>12} | "
            f"{rate_txt:>6} | {human_sl_verdict(args.human_sl_profile, d, rate)}"
        )
    print("\n注：d = 本地让 Human-SL 的子数（黑胜率≈50% 即均势）；星阵经验相邻段差 1 子"
          "（19 路口径，9 路让 1 子对应差距更大），d=0 → 本地≈该段位，d=N → 本地高 N 段。"
          "Human-SL 为风格模仿非强度标定，中低段位（20k~5d）相对可靠，高段仅方向参考。")


def run_plan(args: argparse.Namespace, parser: argparse.ArgumentParser) -> None:
    """L1 批量相邻等级让子扫描：--levels 中每对相邻档自动换算 visits 并扫描。

    低等级固定执黑（model_a=弱档、black_side=a），visits 按
    BASE_VISITS_AM1D × ratio × factor 换算；汇总输出「等级对 | 均势让子数 | ratio 修正建议」。
    --human-sl 存在时改为 L3 锚定扫描（每个等级档 vs Human-SL profile）。
    """
    model = args.plan
    if getattr(args, "human_sl", None):
        run_human_sl_scan(args, parser, model)
        return
    levels = args.levels or []
    if len(levels) < 2:
        parser.error("--levels 至少需要 2 个等级 id")
    unknown = [lv for lv in levels if lv not in LEVEL_RATIO]
    if unknown:
        parser.error(
            f"未知等级 id: {', '.join(unknown)}\n可用等级: {', '.join(LEVEL_RATIO)}"
        )
    factor = model_factor(model)
    print(
        f"===== L1 相邻等级让子扫描：模型 {model}（factor={factor}）· {args.size} 路 · "
        f"每档 {args.games} 盘 · 扫描 0~{args.scan} 子 ====="
    )
    pairs: list[tuple[str, str, int, int, tuple[int, float] | None]] = []
    for lo, hi in zip(levels, levels[1:]):
        visits_lo = level_visits(model, lo)
        visits_hi = level_visits(model, hi)
        print(f"\n—— 等级对 {lo}({visits_lo}v) → {hi}({visits_hi}v)：弱方 {lo} 执黑 ——")
        scan_args = argparse.Namespace(
            model_a=model,
            model_b=model,
            visits_a=visits_lo,
            visits_b=visits_hi,
            size=args.size,
            komi=args.komi,
            handicap_scan=args.scan,
            games=args.games,
            black_side="a",
            api=args.api,
        )
        best = run_scan(scan_args)
        pairs.append((lo, hi, visits_lo, visits_hi, best))

    print("\n===== 相邻等级扫描汇总（均势让子数 = 相邻段差，目标 1 子）=====")
    print(f"{'等级对':<12} | {'低档v':>6} | {'高档v':>6} | {'均势让子':>6} | "
          f"{'黑胜率':>6} | ratio 修正建议")
    for lo, hi, visits_lo, visits_hi, best in pairs:
        if best is None:
            d, rate = None, None
            rate_txt = "-"
        else:
            d, rate = best
            rate_txt = f"{rate * 100:.1f}%"
        print(f"{f'{lo}→{hi}':<12} | {visits_lo:>6} | {visits_hi:>6} | "
              f"{d if d is not None else '-':>6} | {rate_txt:>6} | {ratio_advice(lo, hi, d)}")
    print("\n注：ratio 修正建议基于「棋力差(子) ∝ log(ratio 比值)」经验假设，"
          "回填前端后需重新扫描验证相邻段差≈1 子。")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="AI 等级自对弈校准（调用后端 /engine/calibrate）"
    )
    parser.add_argument("--api", default="http://127.0.0.1:8000/api/v1",
                        help="后端 API 根地址（默认 http://127.0.0.1:8000/api/v1）")
    parser.add_argument("--model-a", default=None, help="引擎 A 模型 id（需已安装；与 --plan 互斥）")
    parser.add_argument("--model-b", default=None, help="引擎 B 模型 id（需已安装；与 --plan 互斥）")
    parser.add_argument("--visits-a", type=int, default=None,
                        help="引擎 A 每手访问量（与 --plan 互斥）")
    parser.add_argument("--visits-b", type=int, default=None,
                        help="引擎 B 每手访问量（与 --plan 互斥）")
    parser.add_argument("--size", type=int, default=19, help="棋盘大小（默认 19，--plan 预扫建议 9）")
    parser.add_argument("--komi", type=float, default=0.0, help="贴目（让子棋默认 0）")
    parser.add_argument("--games", type=int, default=4, help="每档盘数（默认 4）")
    parser.add_argument("--black-side", choices=["a", "b"], default="a",
                        help="谁执黑（通常较弱方执黑，让子时黑先摆子）")
    parser.add_argument("--handicap", type=int, default=0, help="单次校准的让子数")
    parser.add_argument("--handicap-scan", type=int, default=None,
                        help="让子扫描上限（0~N 各跑 games 盘，自动找均势点）")
    parser.add_argument("--plan", metavar="MODEL", default=None,
                        help="L1 批量相邻等级让子扫描：对 --levels 相邻档自动换算 visits 并逐对扫描"
                             "（visits = 3000 × ratio × factor）；与 --model-a/--model-b/--visits-a/--visits-b 互斥")
    parser.add_argument("--levels", nargs="+", default=None,
                        help="等级 id 序列（至少 2 个，如 am1k am1d am2d am3d；仅 --plan 模式使用）")
    parser.add_argument("--scan", type=int, default=3,
                        help="--plan 模式的让子扫描上限（0~N 各跑 games 盘，默认 3；仅 --plan 模式使用）")
    parser.add_argument("--human-sl", metavar="MODEL", default=None,
                        help="Human-SL 权重模型（文件名或 id，如 b18c384nbt-humanv0.bin.gz）；"
                             "把 --human-sl-side 指定的一侧换成 Human-SL（该侧 visits 由配置决定）")
    parser.add_argument("--human-sl-side", choices=["a", "b"], default="b",
                        help="Human-SL 所在侧（默认 b；让子扫描中 Human-SL 侧固定执黑）")
    parser.add_argument("--human-sl-profile", default="rank_1k",
                        help="Human-SL 段位 profile（rank_20k~9d，默认 rank_1k）；"
                             "自动生成 backend/katago/human_calib_<profile>.cfg")
    args = parser.parse_args()

    # --human-sl 时统一生成 profile 配置文件（单次模式与 plan 模式共用）
    if args.human_sl:
        args.human_sl_config = ensure_human_config(args.human_sl_profile)

    if args.plan is not None:
        if (args.model_a or args.model_b
                or args.visits_a is not None or args.visits_b is not None):
            parser.error("--plan 与 --model-a/--model-b/--visits-a/--visits-b 互斥，请二选一")
        run_plan(args, parser)
    elif (args.model_a and args.model_b
            and args.visits_a is not None and args.visits_b is not None):
        if args.levels:
            parser.error("--levels 仅用于 --plan 模式")
        if args.handicap_scan is not None:
            run_scan(args)
        else:
            run_once(args)
    else:
        parser.error("需提供 --plan（含 --levels）或完整的 --model-a/--model-b/--visits-a/--visits-b")


if __name__ == "__main__":
    main()
