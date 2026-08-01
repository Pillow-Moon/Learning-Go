# P7b: b6c96 能力边界扫描（WASM 唯一模型）
# 5 个简化档位 visits vs Human-SL rank 档，让子扫描 0~2，每点 4 盘，19 路
# 用法: python scripts/p7b_scan.py > p7b.log
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
PY = BACKEND / ".venv" / "Scripts" / "python.exe"
SCRIPT = BACKEND / "scripts" / "calibrate.py"
API = "http://127.0.0.1:8001/api/v1"

# (strength_id, visits, human profile)
CASES = [
    ("am18k", 18, "rank_20k"),
    ("am10k", 180, "rank_10k"),
    ("am4k", 960, "rank_4k"),
    ("am1d", 3000, "rank_1k"),
    ("am3d", 5400, "rank_3d"),
]


def run(label: str, args: list[str]) -> None:
    print(f"\n===== {label} =====", flush=True)
    cmd = [str(PY), str(SCRIPT), "--api", API] + args
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = (proc.stdout or "") + (proc.stderr or "")
    print(out[-4000:], flush=True)


for strength_id, visits, profile in CASES:
    run(
        f"b6c96@{visits}v ({strength_id}) vs Human-SL {profile}",
        [
            "--model-a", "b6c96", "--model-b", "b6c96",
            "--visits-a", str(visits), "--visits-b", "0",
            "--human-sl", "b18c384nbt-humanv0.bin.gz",
            "--human-sl-side", "b",
            "--human-sl-profile", profile,
            "--handicap-scan", "2", "--games", "4", "--size", "19",
        ],
    )

print("\n===== P7b 扫描完成 =====", flush=True)
