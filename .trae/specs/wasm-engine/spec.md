# KataGo Browser WASM 引擎 Spec

## Why
项目现有的 `wasmEngine.ts` 和 `katago.worker.ts` 是针对 KataGo WASM 设计的,但缺少编译产物( `.wasm` / `.js` 文件),导致"Browser WASM"选项是空壳。`toyoshi/katago-wasm` 项目已验证 KataGo v1.16.5 可通过 Emscripten 6.0.3 编译为 ES6 模块化 WASM(b6c96 模型 148 visits/s),b10c384h6 外推 5-6 visits/s,和原生 Eigen 后端基本持平。

## What Changes
- 修复 CI workflow 使其正确产出 `katago.js` + `katago.wasm`
- 重写 `katago.worker.ts` 接入真实 WASM 模块( `createKataGo()` 工厂 + MEMFS + 持久化 analysis session)
- 更新 `wasmEngine.ts` 适配新 Worker 协议和模型下载
- 新增 WASM 专用 `analysis.cfg`(Eigen 后端,无 OpenCL)
- 设置页移除"需编译产物"提示,Browser WASM 成为真正可用的选项

## Impact
- Affected specs: 无(新增)
- Affected code: `.github/workflows/build-wasm.yml`, `frontend/src/workers/katago.worker.ts`, `frontend/src/engines/wasmEngine.ts`, `frontend/src/engines/manager.ts`, `frontend/public/wasm/analysis.cfg`, `frontend/src/pages/SettingsPage.tsx`
- 依赖: COOP/COEP 头已在 `vite.config.ts` 配置 ✓,PWA manifest 已存在 ✓

## ADDED Requirements

### Requirement: CI 产出 WASM 产物
CI workflow SHALL 通过 `toyoshi/katago-wasm` 编译管线产出 `katago.js`(132 KiB) + `katago.wasm`(5.4 MiB),上传为 GitHub Actions artifact。

#### Scenario: 手动触发编译
- **WHEN** 开发者在 GitHub Actions 手动触发 `Build KataGo WASM`
- **THEN** 60 分钟内产出 artifact 包含 `katago.js` 和 `katago.wasm`

---

### Requirement: WASM Worker 接入真实模块
`katago.worker.ts` SHALL 使用 `createKataGo()` ES6 工厂加载真实 WASM 模块,通过 Emscripten MEMFS 写入模型和配置文件,以 analysis 模式启动 KataGo,并通过 stdin/stdout 协议收发分析请求。

#### Scenario: Worker 初始化
- **WHEN** Worker 收到 `{ type: 'init', modelUrl, configUrl }` 消息
- **THEN** Worker 加载 WASM 模块、写入模型和配置到 MEMFS、启动 `analysis` 引擎、回发 `{ type: 'ready' }`

#### Scenario: 持久化 analysis session
- **WHEN** Worker 初始化完成后收到 `{ type: 'analyze', id, query }` 消息
- **THEN** 通过 stdin 向分析引擎发送查询,解析 stdout 返回的 JSON 结果,回发 `{ type: 'result', id, data }`

---

### Requirement: WasmEngine 模型下载与缓存
`wasmEngine.ts` 的 `init()` SHALL 下载 KataGo 模型( `b10c384h6.bin.gz`,38MB)和分析配置文件到浏览器,通过 Cache API 缓存,然后传递给 Worker。

#### Scenario: 首次加载
- **WHEN** 用户首次切换到 Browser WASM 引擎
- **THEN** 模型从 GitHub Releases CDN 下载(~38MB),显示下载进度

#### Scenario: 缓存命中
- **WHEN** 用户再次加载(模型已缓存)
- **THEN** 跳过下载,直接初始化 Worker

---

### Requirement: 设置页更新
设置页"Browser WASM"选项 SHALL 移除"(需编译产物)"免责声明。用户选择后引擎自动下载模型并初始化。

#### Scenario: 选择 Browser WASM
- **WHEN** 用户设置页选择"Browser WASM"
- **THEN** 引擎自动开始初始化和模型下载,状态反映在 `isReady()` 中

## MODIFIED Requirements
无。

## REMOVED Requirements
无。
