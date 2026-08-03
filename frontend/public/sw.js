/**
 * PWA Service Worker：预缓存核心静态资源，网络优先策略。
 * 用于离线支持和 fast load。
 */

const CACHE_NAME = 'learning-go-v1'

// 预缓存的静态资源（构建后路径）
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/favicon.svg',
  '/manifest.json',
  '/coi-serviceworker.js',
]

// 安装：预缓存核心资源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)),
  )
  // 跳过等待，立即激活
  self.skipWaiting()
})

// 激活：清理旧缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
      ),
    ),
  )
  self.clients.claim()
})

// 请求：网络优先（fallback 到缓存）
self.addEventListener('fetch', (event) => {
  // 跳过非 GET 和 chrome-extension 请求
  if (event.request.method !== 'GET') return
  if (event.request.url.startsWith('chrome-extension://')) return

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // 缓存成功的网络响应
        const cloned = response.clone()
        caches.open(CACHE_NAME).then((cache) =>
          cache.put(event.request, cloned),
        )
        return response
      })
      .catch(() => {
        // 网络失败时从缓存恢复
        return caches.match(event.request)
      }),
  )
})
