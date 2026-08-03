# AGENTS.md — 项目上下文路由

围棋 AI 教学平台（Learning-Go）：React 19 + TS + Vite 纯前端 SPA，可选 FastAPI 本地 GPU 引擎（KataGo）。AI 解说为 BYOK（浏览器直连 LLM）。

## 仓库地图

| 路径 | 内容 |
|------|------|
| `frontend/` | 前端主目录；`src/engines/` 引擎抽象（GoEngine 接口 / WASM / Local Engine），`src/workers/` KataGo WASM，`src/stores/` Zustand 状态，`src/services/` LLM 客户端，`src/pages/` 路由页 |
| `backend/` | FastAPI 后端（可选本地 GPU 引擎）；`app/api/v1/` 路由，`app/services/` KataGo 分析/引擎管理，`app/core/config.py` 配置（.env） |
| `shared/ai-strength.json` | 前后端共享强度标尺，单一来源（前端经 `@shared/*` 别名引入） |
| `deploy/gpu-engine/launcher.bat` | 后端一键启动器（自建 venv + 装依赖 + 下载 KataGo + 生成 .env + 启动服务） |
| `backend/katago/` | KataGo 二进制、模型（b11c768h12）、analysis 配置 |
| `backend/calibration/` | 强度校准记录 |

## 命令（均已与源码核实，勿臆造）

以下命令一律在仓库根 `Learning-Go/` 下执行；PowerShell 不支持 `&&`，多条命令用 `;` 分隔。

### 前端（frontend/，脚本定义见 `frontend/package.json`）

```powershell
cd frontend
npm install
npm run dev        # vite，开发服务器 http://localhost:5173
npm run build      # tsc -b && vite build（tsc 为 type 门；tsconfig.app.json 为 noEmit 纯检查）
npm run lint       # oxlint（配置见 frontend/.oxlintrc.json）
npm run test       # vitest run
npm run preview    # vite preview
```

### 后端（backend/）

```powershell
# 一键启动（推荐）：自建 backend/.venv、装依赖、生成 .env、启动服务
deploy\gpu-engine\launcher.bat

# 手动启动（与 launcher.bat 末行命令一致，需在 backend 目录）
cd backend
.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000

# 替代入口：main.py 的 main()（绿色包控制台入口，同端口 8000）
.venv\Scripts\python.exe -m app.main

# 后端测试（需在 backend 目录；pytest 依赖见 requirements.txt）
.venv\Scripts\python.exe -m pytest tests -q

# 依赖安装（launcher.bat 同款）
.venv\Scripts\pip.exe install -r requirements.txt
```

启动后：API 文档 `http://localhost:8000/docs`，Web 控制面板 `http://localhost:8000/admin`，前端 `http://localhost:5173`。

## 质量门

| 门 | 命令 | 状态 |
|----|------|------|
| 前端 lint | `cd frontend; npm run lint`（oxlint） | 适用 |
| 前端 type | `cd frontend; npm run build`（`tsc -b`，noEmit 纯类型检查） | 适用 |
| 前端 test | `cd frontend; npm run test`（vitest run） | 适用 |
| 后端 lint/type | — | **显式声明不适用**：requirements.txt 与 backend 目录均无 ruff/mypy/pyright 等工具或配置文件（无 pyproject.toml / mypy.ini / .ruff.toml） |
| 后端 test | `.venv\Scripts\python.exe -m pytest tests -q` | 适用（tests/test_katago.py 中真实 KataGo 集成用例在缺少二进制/模型时自动 skip） |

## 改动须知（关键约束）

- **强度标尺单一来源**：`shared/ai-strength.json` 为前后端共用，改动需同步两侧消费方。
- **黑方视角约定**：KataGo 配置 `reportAnalysisWinratesAs=BLACK`，winrate/scoreLead 恒为黑方视角；后端 `_format_response` 必须原样透传、不得翻转（有对应单测断言）。
- **日志环形缓冲**：`install_ring_buffer()` 在 import 时与 startup 事件各装一次；启动 uvicorn 时保持 `log_config=None` 以保留控制面板日志（勿在 CLI 传 `--log-config` 覆盖）。
- **.env 配置**：`backend/.env` 由 launcher.bat 从 `.env.example` 复制生成；KataGo 路径/模型默认值见 `backend/app/core/config.py`（模型 b11c768h12）。
- **测试注意**：后端测试需在 `backend/` 目录运行（依赖 `app` 包可导入）；前端测试用 vitest + jsdom。
