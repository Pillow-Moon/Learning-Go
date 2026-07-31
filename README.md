# 围棋 AI 教学平台（Learning-Go）

带 AI 解说的围棋教学平台，面向零基础到业余段位的学习者。提供人机对弈、局面分析、自然语言教学解说、棋力评估与个性化课程。

## 技术栈

| 层 | 选型 |
|----|------|
| 前端 | React + TypeScript + Vite，自绘 Canvas 棋盘 |
| 状态管理 | Zustand |
| 围棋规则 | @sabaki/go-board（提子、气、劫） |
| 棋谱格式 | @sabaki/sgf |
| 后端 | FastAPI (Python) |
| 围棋引擎 | KataGo（GTP 对弈 + Analysis 分析） |
| AI 解说 | DeepSeek V4 Pro API |
| 数据库 | SQLite（SQLAlchemy + Alembic） |

## 目录结构

```
Learning-Go/
├── backend/          # FastAPI 后端
│   ├── app/          # 应用代码（api/core/models/schemas/services）
│   ├── katago/       # KataGo 二进制 + 权重（不入库）
│   ├── scripts/      # 本地启动脚本
│   ├── migrations/   # Alembic 迁移
│   ├── seed_data/    # 种子数据（课程、题库 SGF）
│   └── tests/
├── frontend/         # React 前端
│   └── src/          # components/stores/pages/services/lib
└── deploy/           # 云服务器部署脚本
```

## 本地开发启动

```powershell
# 终端 1：后端
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m app.core.init_db
uvicorn app.main:app --reload --port 8000

# 终端 2：前端
cd frontend
npm install
npm run dev
```

打开浏览器访问 `http://localhost:5173`。

## 部署策略

- 开发阶段（阶段 1-4）：全程本地，零成本。
- 上线阶段（阶段 5+）：部署到腾讯云/阿里云轻量服务器（2 核 4G Ubuntu），公网 IP 访问，手机在外可无缝续学。

## 许可

个人学习项目。
