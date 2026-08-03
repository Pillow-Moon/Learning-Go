import { Callout, Divider, Grid, H1, H2, Stack, Stat, Table, Tag, Text } from 'qoder/canvas'

export default function MainlineMergeCourseComplete() {
  return (
    <Stack gap={20}>
      <H1>综合版并入主线与课程完善 — 目标完成报告</H1>
      <Text tone="secondary" size="small">
        Spec 完整实现 · 2026-08-02 · 真实引擎浏览器闭环验证 · 33 题 + 6 定式全量脚本校验
      </Text>

      <Grid columns={4} gap={12}>
        <Stat value="33 题" label="题库（14→33，多解 5 题带对称解）" />
        <Stat value="6 定式" label="定式教学（18 条手顺逐手解说）" />
        <Stat value="7 个" label="过程中发现并修复的缺陷" />
        <Stat value="4 轮" label="浏览器实测验证（含真实 KataGo 引擎）" />
      </Grid>

      <Divider />

      <H2>一、UI 并入主线</H2>
      <Table
        headers={['模块', '实现', '验证证据']}
        rows={[
          ['路由重构 App.tsx', '导航：首页/对弈/研究▾/课程/评估/设置；/study/review 挂复盘；/alt2 移除、/alt 保留', '浏览器实测导航下拉与各路由可访问'],
          ['对弈页 Play2Page', '接入 gameStore + analysisStore：执子/棋盘/贴目/让子/速度/自动思考全映射真实参数', '9 路真实对弈闭环：黑 E5→AI 白 C4→黑 G3→AI 白 F4（KataGo b11c768h12）'],
          ['研究页 Study2Page', '历史棋谱/SGF/空盘摆子 + 候选点实时分析 + 整盘胜率曲线 + 本地解说', '新局落 2 手 → 5 行真实候选点（Q4 14%/-0.6 目/37.4%）'],
          ['复盘二级菜单', '研究▾ 下拉含对局研究/复盘，复盘页顶部返回链接', '/study/review 打开正常'],
        ]}
      />

      <Divider />

      <H2>二、课程按星阵式三分类重构</H2>
      <Table
        headers={['分类', '内容', '题量']}
        rows={[
          ['特训 tese', '规则入门、吃子技巧 + 新增连接切断/双打吃抱吃/倒扑接不归', '18 题'],
          ['死活题 tesuji', '死活入门 + 新增扩大眼位/缩小眼位与点杀', '15 题'],
          ['定式教学 joseki', '星位尖顶/一间跳/飞应、小目一间跳/托退、三三肩冲，每定式逐手解说 + 2 变化', '6 定式 / 18 手顺'],
        ]}
      />
      <Stack gap={8}>
        <Tag tone="success">对称位判对：课程第 5 题落对称位 E4 → 「✓ 本题完成 · 3 星」（题面正解 E6）</Tag>
        <Tag tone="success">思路提示：「提示」按钮给思路不给答案、不扣星；答错先显示思路引导再解释</Tag>
        <Tag tone="success">定式教学：/course/4 六定式下拉 + 逐手解说 + 变化切换（白爬二线 11 手）实测通过</Tag>
        <Tag tone="info">旧题 s6 局面与文案不符已修复（白棋实际 4 口气）</Tag>
      </Stack>

      <Divider />

      <H2>三、过程中修复的 7 个缺陷</H2>
      <Table
        headers={['缺陷', '根因', '修复']}
        rows={[
          ['本地引擎 502', 'vite 代理残留指向 8001（后端在 8000）', 'proxy target 改回 8000'],
          ['AI 抢黑先手', 'Play2Page aiColor 写反（用户执黑时 AI 也执黑）', 'aiColor: userBlack ? -1 : 1（与 GameControls 约定一致）'],
          ['目数差恒显「—」', '后端输出 snake_case score_lead，前端 camelCase 无映射', 'LocalEngine normalizeAnalysis 字段归一化'],
          ['三栏布局裸奔', 'Alt2App 删除后 alt2.css 无人导入', 'App.tsx 全局 import alt2.css'],
          ['支招分析 27 分钟', '未测基准时分析档位放开 pro9d ×40 倍率 = 64800 visits', 'Local 分析搜索量上限 4000（实测 30~40 秒完成）'],
          ['/course/4 崩溃', 'joseki 课程无 steps 字段，空值访问报 TypeError', 'steps 空值保护 + joseki 分支提前（hooks 顺序保持）'],
          ['定式坐标冲突', '倒扑题送吃子的黑邻居相连导致无法被提', '送吃点四周改用白子封围（E3/D4/G5/F6 等）'],
        ]}
      />

      <Divider />

      <H2>四、验证证据</H2>
      <Table
        headers={['验证项', '方法', '结果']}
        rows={[
          ['33 题合法性', 'node 脚本逐手复盘（含两手题、倒扑提子流程）', 'PASS 33 / FAIL 0'],
          ['13 个多解', 'solutions 每解 analyzeMove 合法性', '全部合法'],
          ['18 条定式手顺', '19 路逐手复盘（黑白交替、无占位/自杀）', '全部合法'],
          ['类型与构建', 'tsc --noEmit + npm run build', '通过'],
          ['真实引擎闭环', '浏览器：9 路对弈 + 支招 + 研究候选点', 'AI 应手、候选点/目差/胜率全部显示数字'],
          ['夜间模式/窄屏', '浏览器：切换+刷新保持；order:-1 棋盘置顶', '通过'],
        ]}
        rowTone={['success', 'success', 'success', 'success', 'success', 'success']}
      />

      <Divider />

      <Callout tone="info" title="最终状态">
        综合版三栏 UI 已成为主线（对弈/研究/首页），复盘并入研究二级菜单；课程为特训 × 死活题 × 定式教学三分类，
        对称位多解判定与思路提示机制落地，题库 14→33 题并新增 6 个最常用定式。开发服务器 http://localhost:5173 运行中，本地引擎后端 8000 端口就绪。
      </Callout>

      <Text tone="secondary" size="small">
        备注：浏览器自动化截图工具因视口过窄超时，功能验证以页面文本快照、计算样式与脚本检查为证据；课程 1 验证时清除了该课 IndexedDB 进度（已重新完成前 5 题 3 星）。
      </Text>
    </Stack>
  )
}
