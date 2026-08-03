import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react()],
  // 共享参数（强度标尺单一来源，后端 calibrate.py 同读）
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  // GitHub Pages 部署：子目录 /Learning-Go/
  base: command === 'build' ? '/Learning-Go/' : '/',
  server: {
    port: 5173,
    // 跨域隔离头：WASM 多线程（pthreads）需要 COOP/COEP
    // 必须用 require-corp（与 toyoshi/katago-wasm 官方 serve.py 一致）：
    // credentialless 在 Chromium 的嵌套 worker/pthread 场景会导致 KataGo 崩溃
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    proxy: {
      // 本地 GPU 引擎（可选）：前端 /api 请求转发到 FastAPI 后端
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
}))
