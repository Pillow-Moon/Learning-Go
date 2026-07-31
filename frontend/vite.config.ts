import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react()],
  // GitHub Pages 部署：子目录 /Learning-Go/
  base: command === 'build' ? '/Learning-Go/' : '/',
  server: {
    port: 5173,
    // 跨域隔离头：WASM 多线程（pthreads）需要 COOP/COEP
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
