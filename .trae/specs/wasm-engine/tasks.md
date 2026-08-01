# Tasks

- [x] Task 1: 修复 CI workflow
  - 修正产物路径: `build-browser.sh` 输出到 `web/assets/`,非 `build/browser/` ✓
  - 将 `katago.js` + `katago.wasm` 上传为 artifact,保留 90 天 ✓
- [x] Task 2: 创建 WASM 专用 analysis.cfg
  - 基于 `backend/katago/katago_analysis.cfg` 创建 `frontend/public/wasm/analysis.cfg` ✓
  - 移除 `openclDeviceToUse`(WASM 用 Eigen,无 OpenCL) ✓
  - 保留 numAnalysisThreads=1, numSearchThreadsPerAnalysisThread=4 ✓
- [x] Task 3: 重写 `katago.worker.ts`
  - 导入: 从 `/wasm/katago.js` 动态导入 `createKataGo` 工厂 ✓
  - init: 加载 WASM 模块,通过 `FS.writeFile` 将模型和配置写入 MEMFS ✓
  - 持久化 analysis session: 单次请求重启模块, stdin 预填充查询→stdout 解析→postMessage ✓
  - 处理 `PROXY_TO_PTHREAD` 模式下的线程协调 ✓
- [x] Task 4: 更新 `wasmEngine.ts`
  - `init()`: 下载模型(Cache API 缓存)+ 配置文件,传 Worker ✓
  - 添加下载进度回调 ✓
  - `parseAnalysisResult()` 解析 KataGo moveInfos/rootInfo → AnalysisResult ✓
- [x] Task 5: 设置页调整
  - 移除 "(需编译产物)" → "(首次需下载模型 ~38MB)" ✓

# Task Dependencies
- Task 3 依赖 Task 2(需要 analysis.cfg)
- Task 4 依赖 Task 3(Worker 协议变更后 wasmEngine 需适配)
- Task 1 独立(CI 纯 GitHub Actions 侧)
- Task 5 独立(纯文本修改)
