"""KataGo 引擎与模型管理（运行时切换模型）。

模型文件约定放在 backend/katago/models/ 下（*.bin.gz）。
切换模型流程：
1. 校验模型文件存在
2. 停止 GTP 与 Analysis 进程（下次请求按新模型惰性重启）
3. 更新运行时状态（health 接口可见）
4. 持久化到 .env（重启后端后仍生效）
"""
from __future__ import annotations

import asyncio
import logging
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from app.core.config import get_settings

logger = logging.getLogger(__name__)

# backend/ 根目录（本文件位于 backend/app/services/）
BACKEND_DIR = Path(__file__).resolve().parents[2]

MODEL_SUFFIXES = (".bin.gz", ".gz")


def _app_root() -> Path:
    """绿色包程序目录：打包后 = exe 所在目录（数据/配置随程序）；开发 = backend/。"""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return BACKEND_DIR

# KataGo release 版本（下载 URL 用）。
# 发布页：https://github.com/lightvector/KataGo/releases/tag/v1.17.0
# 固定使用 v1.17.0：后续版本可能移除/改名下列资产，404 时回发布页核对文件名。
KATAGO_VERSION = "v1.17.0"

# 可下载模型目录：模型 id → GitHub release 资产文件名。
# 注意：v1.17.0 只附带 3 个模型资产（nbt 系列），
# 旧版本的 b6c96/b18c384/b20c256 等简单名模型在 v1.17.0 不存在（会 404）。
# 模型收敛：本地正常模型只保留 b11c768h12（分析/解说/评估 + pro 档对弈）；
# 其余旧模型（b10c384h6/b10c512h8）不再提供下载入口。
AVAILABLE_MODELS: dict[str, str] = {
    "b11c768h12": "b11c768h12nbt3tflrs-fson-silu.bin.gz",
}

# Human-SL 对弈模型（内置：绿色包随附；开发环境放 models/ 目录）
HUMAN_SL_MODEL_ID = "b18c384nbt-humanv0"

# 可切换模型白名单（模型收敛：仅正常模型 + Human-SL 对弈模型；
# 目录中其他旧模型文件不列入切换/展示列表）
_SWITCHABLE_MODELS = {"b11c768h12", HUMAN_SL_MODEL_ID}

# 运行时当前模型 id（None 时回退到 settings.katago_model）
_current_model_id: str | None = None

# 下载任务状态：model_id -> {status: downloading|done|error, progress, error}
_downloads: dict[str, dict] = {}


def _models_dir() -> Path:
    """模型目录：绿色包 = 程序目录/data/models（可迁移）；开发 = backend/katago/models。"""
    if getattr(sys, "frozen", False):
        return _app_root() / "data" / "models"
    return BACKEND_DIR / "katago" / "models"


def ensure_bundled_models() -> None:
    """绿色包：首次启动把包内模型/katago.exe 复制到数据目录。

    KataGo 需要真实文件路径（不能直接读 PyInstaller 包内只读资源），
    复制一次后走数据目录，整个目录可迁移。开发环境（未打包）为 no-op。
    """
    if not getattr(sys, "frozen", False):
        return
    meipass = Path(getattr(sys, "_MEIPASS", ""))
    # 模型
    src_models = meipass / "models"
    if src_models.exists():
        dst = _models_dir()
        dst.mkdir(parents=True, exist_ok=True)
        for src in src_models.glob("*.bin.gz"):
            target = dst / src.name
            if not target.exists():
                shutil.copy2(src, target)
                logger.info("已复制内置模型: %s", src.name)
    # katago.exe 及其依赖 DLL（OpenCL/压缩/运行时库），整目录复制
    src_katago = meipass / "katago"
    if src_katago.exists():
        dst_katago = _app_root() / "data" / "katago"
        dst_katago.mkdir(parents=True, exist_ok=True)
        for f in src_katago.iterdir():
            if not f.is_file():
                continue
            target = dst_katago / f.name
            if not target.exists():
                shutil.copy2(f, target)
                logger.info("已复制内置引擎文件: %s", f.name)
    # 配置文件（可编辑：用户可在数据目录调整）
    for name in ("katago_gtp.cfg", "katago_analysis.cfg", "human_gtp.cfg"):
        src_cfg = meipass / "katago" / name
        if src_cfg.exists():
            dst_cfg = _app_root() / "data" / "katago" / name
            if not dst_cfg.exists():
                dst_cfg.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src_cfg, dst_cfg)
                logger.info("已复制内置配置: %s", name)
    # OpenCL tuning（避免首次 autotune 数分钟；不同 GPU 首次仍会自调）
    src_tune = meipass / "katago" / "KataGoData" / "opencltuning"
    if src_tune.exists():
        dst_tune = _app_root() / "data" / "katago" / "KataGoData" / "opencltuning"
        dst_tune.mkdir(parents=True, exist_ok=True)
        for f in src_tune.glob("*.txt"):
            target = dst_tune / f.name
            if not target.exists():
                shutil.copy2(f, target)
                logger.info("已复制 OpenCL tuning: %s", f.name)


def katago_binary_path() -> str:
    """KataGo 可执行文件路径：绿色包优先数据目录（首次启动已复制），否则包内；开发按配置。"""
    if getattr(sys, "frozen", False):
        local = _app_root() / "data" / "katago" / "katago.exe"
        if local.exists():
            return str(local)
        bundled = Path(getattr(sys, "_MEIPASS", "")) / "katago" / "katago.exe"
        if bundled.exists():
            return str(bundled)
    return get_settings().katago_binary


def _bundled_config(name: str) -> str:
    """绿色包内配置文件路径：优先数据目录（可编辑），否则包内只读。"""
    local = _app_root() / "data" / "katago" / name
    if local.exists():
        return str(local)
    bundled = Path(getattr(sys, "_MEIPASS", "")) / "katago" / name
    if bundled.exists():
        return str(bundled)
    return str(BACKEND_DIR / "katago" / name)


def gtp_config_path() -> str:
    """GTP 配置路径（对弈）：绿色包走包内/数据目录；开发按配置。"""
    if getattr(sys, "frozen", False):
        return _bundled_config("katago_gtp.cfg")
    return get_settings().katago_config


def analysis_config_path() -> str:
    """Analysis 配置路径（局面分析）：绿色包走包内/数据目录；开发按配置。"""
    if getattr(sys, "frozen", False):
        return _bundled_config("katago_analysis.cfg")
    return get_settings().katago_analysis_config


def model_id_from_filename(filename: str) -> str:
    """b10c384h6.bin.gz → b10c384h6"""
    for suffix in MODEL_SUFFIXES:
        if filename.endswith(suffix):
            return filename[: -len(suffix)]
    return filename.rsplit(".", 1)[0]


def list_available_models() -> list[dict]:
    """扫描 models 目录，返回 [{id, name, size_mb, path}]，按名称排序。

    只返回白名单内的模型（模型收敛后旧模型文件不再展示/可切换）。
    """
    models = []
    for p in sorted(_models_dir().glob("*")):
        if not p.is_file() or not p.name.endswith(MODEL_SUFFIXES):
            continue
        mid = model_id_from_filename(p.name)
        if mid not in _SWITCHABLE_MODELS:
            continue
        models.append(
            {
                "id": mid,
                "name": mid,
                "size_mb": round(p.stat().st_size / 1e6, 1),
                "path": str(p),
            }
        )
    return models


def get_human_sl_model_path() -> str:
    """Human-SL 对弈模型路径（不存在时抛 ValueError，提示安装）。"""
    p = _models_dir() / f"{HUMAN_SL_MODEL_ID}.bin.gz"
    if not p.exists():
        raise ValueError(
            f"Human-SL 对弈模型不存在: {p}。请确认 b18c384nbt-humanv0.bin.gz 已放入 models 目录。"
        )
    return str(p)


def get_human_sl_model_path_checked() -> bool:
    """Human-SL 对弈模型是否就绪（不抛异常，控制面板状态用）。"""
    try:
        get_human_sl_model_path()
        return True
    except ValueError:
        return False


def get_lan_ips() -> list[str]:
    """枚举本机局域网 IPv4 地址（供手机端配置 localBackendURL）。"""
    ips: set[str] = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            addr = info[4][0]
            if addr and not addr.startswith("127."):
                ips.add(addr)
    except OSError:
        pass
    # 兜底：UDP 连接法（不真正发包，仅取本机出口地址）
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    return sorted(ips)


def get_tailscale_ip() -> str | None:
    """尝试读取 Tailscale 100.x 地址（未安装/未登录返回 None）。"""
    exe = shutil.which("tailscale")
    if exe is None:
        cand = Path("C:/Program Files/Tailscale/tailscale.exe")
        if cand.exists():
            exe = str(cand)
    if not exe:
        return None
    try:
        out = subprocess.run(
            [exe, "ip", "-4"], capture_output=True, text=True, timeout=5
        )
        if out.returncode == 0:
            for line in out.stdout.splitlines():
                ip = line.strip()
                if ip.startswith("100."):
                    return ip
    except (OSError, subprocess.SubprocessError):
        pass
    return None


def list_downloadable_models() -> list[dict]:
    """可选模型中未安装的（可供一键下载）。"""
    installed_ids = {m["id"] for m in list_available_models()}
    return [{"id": i, "name": i} for i in AVAILABLE_MODELS if i not in installed_ids]


def find_model_file(model_id: str) -> str | None:
    """按 id 或完整文件名查找 models 目录中的任意模型文件。

    校准/自对弈（selfplay）用，不受「可切换白名单」限制（如 b6c96 仅用于 WASM 校准）。
    支持 .bin.gz / .txt.gz（WASM 文本模型）两种后缀。
    """
    for p in _models_dir().glob("*"):
        if not p.is_file():
            continue
        name = p.name
        base = None
        for suffix in (".bin.gz", ".txt.gz", ".gz"):
            if name.endswith(suffix):
                base = name[: -len(suffix)]
                break
        if base is None:
            continue
        if base == model_id or name == model_id:
            return str(p)
    return None


# ===== 模型下载（后台任务，标准库 urllib，无需新依赖） =====


def get_model_download(model_id: str) -> dict | None:
    return _downloads.get(model_id)


def start_model_download(model_id: str) -> dict:
    """启动模型下载（异步后台执行）。模型不存在/已安装时抛 ValueError。"""
    asset = AVAILABLE_MODELS.get(model_id)
    if asset is None:
        raise ValueError(f"未知模型: {model_id}")
    target = _models_dir() / f"{model_id}.bin.gz"
    if target.exists():
        raise ValueError(f"模型 {model_id} 已安装")
    if _downloads.get(model_id, {}).get("status") == "downloading":
        raise ValueError(f"模型 {model_id} 正在下载中")

    state = {"status": "downloading", "progress": 0, "error": None}
    _downloads[model_id] = state
    asyncio.create_task(_download_worker(model_id, asset, target, state))
    logger.info("开始下载模型: %s", model_id)
    return state


def _system_proxy() -> str | None:
    """读取 Windows 系统代理（urllib 默认不读系统代理，大文件直连易被切断）。"""
    try:
        import winreg

        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Internet Settings",
        )
        try:
            enable, _ = winreg.QueryValueEx(key, "ProxyEnable")
            if not enable:
                return None
            server, _ = winreg.QueryValueEx(key, "ProxyServer")
        finally:
            winreg.CloseKey(key)
    except OSError:
        return None

    server = (server or "").strip()
    if not server:
        return None
    # ProxyServer 可能为 "host:port"、"http://host:port"、或 "http=..;https=.."
    if "=" in server:
        for part in server.split(";"):
            part = part.strip()
            if part.lower().startswith("https="):
                server = part.split("=", 1)[1].strip()
                break
        else:
            return None
    if "://" not in server:
        server = "http://" + server
    return server


def _build_opener() -> urllib.request.OpenerDirector:
    """构建下载 opener：优先走系统代理，否则退回环境变量代理/直连。"""
    proxy = _system_proxy()
    if proxy:
        return urllib.request.build_opener(
            urllib.request.ProxyHandler({"http": proxy, "https": proxy})
        )
    return urllib.request.build_opener()


def _download_once(
    opener: urllib.request.OpenerDirector,
    url: str,
    tmp: Path,
    state: dict,
) -> None:
    """单次下载：支持 Range 断点续传，写入 .part 临时文件。"""
    offset = tmp.stat().st_size if tmp.exists() else 0
    headers = {"User-Agent": "Learning-Go"}
    if offset > 0:
        headers["Range"] = f"bytes={offset}-"
    req = urllib.request.Request(url, headers=headers)
    with opener.open(req, timeout=120) as resp:
        status = getattr(resp, "status", 200)
        # 完整大小：优先 Content-Range（bytes start-end/total）
        content_range = resp.headers.get("Content-Range")
        if content_range and "/" in content_range:
            total = int(content_range.rsplit("/", 1)[1])
        else:
            total = int(resp.headers.get("Content-Length") or 0)
            if status == 206:
                total += offset
        # 服务器支持续传（206）则追加，否则从头覆盖（防止数据错乱）
        if offset > 0 and status == 206:
            mode, written = "ab", offset
        else:
            mode, written = "wb", 0
        with open(tmp, mode) as f:
            while True:
                chunk = resp.read(65536)
                if not chunk:
                    break
                f.write(chunk)
                written += len(chunk)
                if total > 0:
                    state["progress"] = min(99, round(written / total * 100))


def _sync_download(url: str, target: Path, state: dict) -> None:
    """下载到 .part 并原子改名；自动重试（大文件下载易被网络切断）。"""
    tmp = target.with_suffix(target.suffix + ".part")
    opener = _build_opener()
    last_err: Exception | None = None
    for attempt in range(3):
        try:
            _download_once(opener, url, tmp, state)
            tmp.replace(target)
            return
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            logger.warning(
                "模型下载中断（第 %d/3 次），保留断点续传重试: %s",
                attempt + 1,
                exc,
            )
            time.sleep(2)
    assert last_err is not None
    raise last_err


async def _download_worker(model_id: str, asset: str, target: Path, state: dict) -> None:
    url = f"https://github.com/lightvector/KataGo/releases/download/{KATAGO_VERSION}/{asset}"
    try:
        await asyncio.to_thread(_sync_download, url, target, state)
        state["status"] = "done"
        state["progress"] = 100
        logger.info("模型下载完成: %s", model_id)
    except Exception as exc:  # noqa: BLE001
        # 保留 .part 文件，下次重新下载时自动从断点续传
        state["status"] = "error"
        state["error"] = f"下载失败（已自动重试 3 次，可再次点击下载续传）：{exc}"
        logger.error("模型下载失败 %s: %s", model_id, exc)


def get_current_model_id() -> str:
    """当前模型 id；首次调用从 settings.katago_model 推导。"""
    global _current_model_id
    if _current_model_id is None:
        settings = get_settings()
        _current_model_id = model_id_from_filename(Path(settings.katago_model).name)
    return _current_model_id


def get_current_model_path() -> str:
    """当前模型的绝对路径。

    指定模型文件不存在时（如绿色包无 .env、配置指向旧模型），
    回退到可切换白名单内第一个可用模型（绿色包即 b11c768h12），避免启动失败。
    """
    model_id = get_current_model_id()
    candidates = [p for p in _models_dir().glob("*") if p.is_file()]
    for p in candidates:
        if model_id_from_filename(p.name) == model_id:
            return str(p)
    # 回退：白名单内第一个可用模型
    available = list_available_models()
    if available:
        logger.warning(
            "当前模型 %s 不存在，回退到 %s", model_id, available[0]["id"]
        )
        return available[0]["path"]
    # 回退配置路径（保持与旧行为一致）
    return get_settings().katago_model


def get_effective_model_id() -> str:
    """实际使用的模型 id（配置指向不存在时回退白名单第一个；health/控制面板展示用）。"""
    return model_id_from_filename(Path(get_current_model_path()).name)


def _persist_env(model_id: str) -> None:
    """把 KATAGO_MODEL 写入 backend/.env，保证重启后端后仍生效。"""
    env_file = _app_root() / ".env"
    if not env_file.exists():
        logger.info("未找到 .env，跳过模型持久化（仅当前进程生效）")
        return
    text = env_file.read_text(encoding="utf-8")
    new_line = f"KATAGO_MODEL=./katago/models/{model_id}.bin.gz"
    if re.search(r"(?m)^KATAGO_MODEL=", text):
        text = re.sub(r"(?m)^KATAGO_MODEL=.*$", new_line, text)
    else:
        text = text.rstrip("\n") + "\n" + new_line + "\n"
    env_file.write_text(text, encoding="utf-8")
    logger.info("已更新 .env: KATAGO_MODEL=%s", new_line)


async def switch_model(model_id: str) -> dict:
    """切换到指定模型。模型文件不存在抛 ValueError。"""
    available = {m["id"]: m for m in list_available_models()}
    if model_id not in available:
        raise ValueError(
            f"模型 {model_id} 不存在。请先下载到 backend/katago/models/ "
            "(可运行 scripts/download_katago.ps1 -Model <id>)。"
        )

    if model_id == get_current_model_id():
        return {"model": model_id, "changed": False, "message": "已是当前模型"}

    # 停止两个引擎进程，下次请求惰性重启（使用新模型）
    from app.services.katago_analysis import stop_katago_analysis
    from app.services.katago_gtp import stop_katago_gtp

    await stop_katago_gtp()
    await stop_katago_analysis()

    global _current_model_id
    _current_model_id = model_id
    _persist_env(model_id)
    logger.info("已切换模型: %s", model_id)
    return {
        "model": model_id,
        "changed": True,
        "message": f"已切换到 {model_id}，首次分析需重新加载模型",
    }
