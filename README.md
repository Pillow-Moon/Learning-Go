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

### 桌面引擎绿色包（推荐，无需 Python）

设置页「下载桌面引擎」或 GitHub Release 获取 `WeiQiAI-Engine-win64.zip`（约 400~450MB，模型内置）：

1. 解压到任意目录（如 `D:\WeiQiAI\`，避免系统盘权限问题）
2. 双击 `WeiQiAI-Engine.exe`（控制台窗口即后端：日志、IP、连接指引；**关闭窗口即停止**）
3. 浏览器打开前端（GitHub Pages 或本地 `npm run dev`），设置中选择 "Local GPU"

> Windows SmartScreen 提示时选「更多信息 → 仍要运行」（未签名）；首次监听防火墙弹窗请允许（局域网/远程访问需要）。

### 手机远程对弈（Tailscale）

在家用电脑是主形态；外出用手机时，通过 Tailscale 连回家里电脑获得完整棋力：

1. 电脑安装 [Tailscale](https://tailscale.com/download) 并登录
2. 手机安装 Tailscale App，登录同一账号
3. 设置页「远程连接」查看本机 Tailscale 地址（`http://100.x.x.x:8000/api/v1`，固定不变），手机端「引擎来源 → Local GPU」填入该地址（填一次永久生效）

> 电脑需保持开机；未配置远程时，手机端回退浏览器 WASM（离线兜底，简化档位）。

### 引擎控制面板

后端自带 Web 控制面板：浏览器访问 `http://localhost:8000/admin`（Tailscale 组网下手机也可访问排障），
可查看引擎状态、实时日志，并重启/停止 KataGo 引擎。

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
│   ├── build_exe.spec     # PyInstaller 绿色包构建（CI 自动产出 zip）
│   └── calibration/       # 强度校准记录（L1/L3 实测结论）
├── shared/                # 前后端共享参数（ai-strength.json 强度标尺单一来源）
├── deploy/                # 部署脚本 + GPU 引擎启动器
└── .gitignore
```

## 功能

- **人机对弈**：9/13/19 路，KataGo 引擎；19 路 Local 档位（业余 20 级 ~ 职业九段）
  - 低中档（am20k~am7d）使用官方 Human-SL 人类风格标尺（rank_20k~rank_7d）
  - 高档（am6d/am7d）搜索增强（官方 9d 配方）；职业档走正常引擎 visits
  - WASM 端为离线兜底：简化 5 档（标签带「约」）
- **局面分析**：候选选点 + 胜率 + 变化图叠加显示；领地显示按钮（仿星阵，按需开关）
- **AI 解说**：BYOK 模式，支持 9 类 LLM provider，流式输出，无 key 降级展示 KataGo 数据
- **棋力评估**：四阶段定级（规则认知/基础技巧/实战对弈/五维雷达报告）
- **课程系统**：入门到进阶，棋盘交互教学
- **PWA**：可安装到手机主屏幕，离线可用（WASM b6c96 兜底）

## 许可

个人学习项目。
