import puppeteer from 'puppeteer-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--no-first-run'],
})

try {
  const page = await browser.newPage()
  page.on('console', (msg) => {
    const t = msg.text()
    if (/(WasmEngine|Worker|WASM|KataGo|Error|error|分析|失败|退出码)/i.test(t)) {
      console.log('[CONSOLE]', t.slice(0, 300))
    }
  })
  page.on('pageerror', (err) => console.log('[PAGEERROR]', (err && err.message) || String(err)))
  page.on('workercreated', (w) => {
    w.on('console', (msg) => console.log('[WORKER-CONSOLE]', msg.text().slice(0, 400)))
    w.on('error', (e) => console.log('[WORKER-ERROR]', (e && e.message) || String(e)))
  })

  // ---------- 1. 设置页：加载 WASM 引擎 ----------
  console.log('==> 打开设置页，加载 WASM ...')
  await page.goto('http://localhost:5173/settings', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await new Promise((r) => setTimeout(r, 1200))
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('加载 WASM 引擎'))
    b && b.click()
  })
  await page.waitForFunction(
    () => {
      const cards = [...document.querySelectorAll('.engine-card')]
      const c = cards.find((x) => x.textContent.includes('Browser WASM'))
      return c && c.textContent.includes('已就绪')
    },
    { timeout: 150000, polling: 500 },
  )
  console.log('==> WASM 已就绪')

  // ---------- 2. 切换到 browser 引擎 ----------
  console.log('==> 切换引擎来源为 Browser WASM ...')
  await page.evaluate(() => {
    const sel = [...document.querySelectorAll('select')].find((s) => s.value === 'local' || s.value === 'browser')
    if (sel) {
      sel.value = 'browser'
      sel.dispatchEvent(new Event('change', { bubbles: true }))
    }
  })
  await new Promise((r) => setTimeout(r, 800))

  // ---------- 3. 对弈页：开始新对局 + 落子 ----------
  console.log('==> 打开对弈页 ...')
  await page.goto('http://localhost:5173/play', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await new Promise((r) => setTimeout(r, 1000))

  // 点"开始新对局"（双人默认）
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('开始新对局'))
    b && b.click()
  })
  await new Promise((r) => setTimeout(r, 500))

  // 在棋盘上落子：四个角（双人交替黑白），点击 canvas 像素坐标
  const canvasBox = await page.evaluate(() => {
    const c = document.querySelector('canvas')
    if (!c) return null
    const r = c.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  })
  console.log('canvas 位置:', JSON.stringify(canvasBox))
  // 19 路：cellSize=(600-56)/18≈30.2，MARGIN=28
  const cell = (canvasBox.w - 56) / 18
  const pts = [
    [3, 3], [15, 15], [3, 15], [15, 3],
  ]
  for (const [vx, vy] of pts) {
    const px = canvasBox.x + 28 + vx * cell
    const py = canvasBox.y + 28 + vy * cell
    await page.mouse.click(px, py)
    await new Promise((r) => setTimeout(r, 400))
  }

  // ---------- 4. 第一次分析 ----------
  console.log('==> 第一次分析局面 ...')
  const t1 = Date.now()
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('分析局面'))
    b && b.click()
  })
  // 等待分析完成：分析中按钮消失（变回"分析局面"）且无错误
  let firstErr = ''
  await page
    .waitForFunction(
      () => {
        const btns = [...document.querySelectorAll('.analysis-box button')].map((b) => b.textContent)
        const err = [...document.querySelectorAll('.analysis-box .error')].map((e) => e.textContent).join('')
        const analyzing = btns.some((t) => t.includes('分析中'))
        return (!analyzing && btns.length > 0) || err
      },
      { timeout: 120000, polling: 500 },
    )
    .catch((e) => (firstErr = String(e)))
  const elapsed1 = ((Date.now() - t1) / 1000).toFixed(1)

  const after1 = await page.evaluate(() => ({
    analysisBox: document.querySelector('.analysis-box').textContent,
    err: [...document.querySelectorAll('.error')].map((e) => e.textContent),
    commentaryHint: [...document.querySelectorAll('.hint')].map((h) => h.textContent).slice(0, 3),
  }))
  console.log(`==> 第一次分析耗时 ${elapsed1}s`)
  console.log(JSON.stringify(after1, null, 2))

  // ---------- 5. 第二次分析（验证持久化复用） ----------
  console.log('==> 第二次分析局面 ...')
  const t2 = Date.now()
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('分析局面'))
    b && b.click()
  })
  await page
    .waitForFunction(
      () => {
        const btns = [...document.querySelectorAll('.analysis-box button')].map((b) => b.textContent)
        const err = [...document.querySelectorAll('.analysis-box .error')].map((e) => e.textContent).join('')
        const analyzing = btns.some((t) => t.includes('分析中'))
        return (!analyzing && btns.length > 0) || err
      },
      { timeout: 120000, polling: 500 },
    )
    .catch(() => {})
  const elapsed2 = ((Date.now() - t2) / 1000).toFixed(1)
  const after2 = await page.evaluate(() => ({
    analysisBox: document.querySelector('.analysis-box').textContent,
    err: [...document.querySelectorAll('.error')].map((e) => e.textContent),
  }))
  console.log(`==> 第二次分析耗时 ${elapsed2}s`)
  console.log(JSON.stringify(after2, null, 2))
} finally {
  await browser.close()
}
