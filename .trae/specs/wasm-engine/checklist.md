# Checklist

- [x] CI workflow 路径修正为 `web/assets/katago.js` + `web/assets/katago.wasm`
- [x] `frontend/public/wasm/analysis.cfg` 存在且不含 OpenCL 配置
- [x] `katago.worker.ts` 使用 `createKataGo()` 动态导入真实 WASM 模块
- [x] Worker 初始化后 `FS.writeFile` 写入模型和配置到 MEMFS
- [x] Worker 以 analysis 模式启动(`callMain(["analysis", ...])`)
- [x] Worker 支持多个 analysis 请求通过 stdin/stdout 协议收发
- [x] `wasmEngine.init()` 下载模型并用 Cache API 缓存
- [x] `wasmEngine.init()` 传递模型/配置 URL 给 Worker
- [x] 设置页 "Browser WASM" 移除"(需编译产物)"
- [x] 切换引擎时 `initEngine()` 正确调用新的 wasmEngine.init()
