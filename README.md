# 围棋 AI 教学平台（Learning-Go）

带 AI 解说的围棋教学平台，面向零基础到业余段位的学习者。提供人机对弈、局面分析、自然语言教学解说、棋力评估与个性化课程。

## 架构

**纯前端 SPA + 可选本地 GPU 引擎**。默认使用浏览器内 KataGo WASM（开发中），当前主力为本地后端引擎。

| 层 | 选型 |
|----|------|
| 前端 | React 19 + TypeScript + Vite，自绘 Canvas 棋盘 |
| 状态管理 | Zustand + localStorage |
| 围棋规则 | @sabaki/go-board（提子、气、劫） |
| 围棋引擎 | KataGo（浏览器 WASM + 本地 GPU 双引擎抽象） |
| AI 解说 | BYOK 模式，浏览器直连 LLM（支持 DeepSeek/OpenRouter 等 9 类 provider） |
| 数据 | localStorage（设置）+ IndexedDB（对局记录/课程进度）+ 静态 JSON（课程/题库） |
| 部署 | GitHub Pages / Vercel（纯前端，零服务器成本） |
| 离线 | PWA（Service Worker + manifest，可安装到手机主屏幕） |

## 快速开始

### 纯前端（无需后端）

```powershell
cd frontend
npm install
npm run dev
```

浏览器打开 `http://localhost:5173`。课程和题库可直接使用，AI 解说需在设置页填入 LLM key。

### 启用 AI 对弈（需要本地后端）

```powershell
# 终端 1：双击启动
deploy\gpu-engine\launcher.bat

# 终端 2
cd frontend
npm run dev
```

前端设置中选择 "Local GPU" 引擎来源。

## 目录结构

```
Learning-Go/
├── frontend/              # 纯前端主目录
│   ├── src/
│   │   ├── components/    # UI 组件（棋盘/控制面板/解说/评估/雷达图）
│   │   ├── engines/       # 引擎抽象层（GoEngine 接口/WASM/Local Engine/基准测试）
│   │   ├── workers/       # Web Workers（KataGo WASM）
│   │   ├── stores/        # Zustand 状态（对局/分析/解说/设置）
│   │   ├── services/      # LLM 客户端（provider 预设/流式调用/CORS 探测）
│   │   ├── pages/         # 路由页面（首页/对弈/评估/课程/设置）
│   │   ├── lib/           # 工具（棋盘绘制/评估计算/SGF解析/IndexedDB）
│   │   └── data/          # 静态数据（课程/题库 JSON）
│   └── public/            # 静态资源 + PWA manifest + Service Worker
├── backend/               # FastAPI 后端（可选本地 GPU 引擎）
├── deploy/                # 部署脚本 + GPU 引擎启动器
└── .gitignore
```

## 功能

- **人机对弈**：9/13/19 路，KataGo 引擎，五档难度
- **局面分析**：候选选点 + 胜率 + 变化图叠加显示
- **AI 解说**：BYOK 模式，支持 9 类 LLM provider，流式输出，无 key 降级展示 KataGo 数据
- **棋力评估**：四阶段定级（规则认知/基础技巧/实战对弈/五维雷达报告）
- **课程系统**：入门到进阶，棋盘交互教学
- **PWA**：可安装到手机主屏幕，离线可用

## 许可

个人学习项目。
