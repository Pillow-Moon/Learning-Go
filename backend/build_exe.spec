# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec：Learning-Go 后端绿色包（console 模式，模型内置）。

构建：cd backend && python -m PyInstaller build_exe.spec --distpath ../dist
产物：dist/WeiQiAI-Engine/（onedir，模型在 _internal 内，首次启动复制到程序目录 data/）

打包内容：
- Python 运行时 + FastAPI 后端（app.main:main 为控制台入口）
- katago.exe + human_gtp.cfg（Human-SL 对弈）
- b11c768h12（分析/正常对弈）+ b18c384nbt-humanv0（Human-SL 对弈）
- shared/ai-strength.json（强度参数单一来源）
"""
from PyInstaller.utils.hooks import collect_all

# pydantic v2 为 Rust 扩展，需 collect_all 收集二进制与隐藏导入
_datas, _binaries, _hiddenimports = collect_all("pydantic")

a = Analysis(
    ["app/main.py"],
    pathex=["."],
    binaries=_binaries,
    datas=_datas
    + [
        ("katago/human_gtp.cfg", "katago"),
        ("katago/katago_gtp.cfg", "katago"),
        ("katago/katago_analysis.cfg", "katago"),
        ("katago/katago.exe", "katago"),
        ("katago/*.dll", "katago"),  # katago.exe 运行依赖（OpenCL/压缩/运行时库）
        ("katago/KataGoData/opencltuning/*.txt", "katago/KataGoData/opencltuning"),  # OpenCL tune（避免首次 autotune 数分钟）
        ("katago/models/b11c768h12.bin.gz", "models"),
        ("katago/models/b18c384nbt-humanv0.bin.gz", "models"),
        ("../shared/ai-strength.json", "shared"),
        ("app/api/v1/admin.html", "api/v1"),
    ],
    hiddenimports=_hiddenimports
    + [
        # uvicorn 按协议/事件循环动态导入，需显式收集
        "uvicorn.logging",
        "uvicorn.loops",
        "uvicorn.loops.auto",
        "uvicorn.protocols",
        "uvicorn.protocols.http",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.websockets",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.lifespan",
        "uvicorn.lifespan.on",
        "uvicorn.lifespan.off",
    ],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="WeiQiAI-Engine",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,  # 控制台窗口：日志 + 连接指引 + 关闭即停止
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    name="WeiQiAI-Engine",
)
