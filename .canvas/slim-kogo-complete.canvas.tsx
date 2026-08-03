import { Callout, Divider, Grid, H1, H2, Stack, Stat, Table, Tag, Text } from 'qoder/canvas'

export default function SlimAndKogoComplete() {
  return (
    <Stack gap={20}>
      <H1>功能精简与定式教学接入 KOGO 辞典 — 目标完成报告</H1>
      <Text tone="secondary" size="small">
        Spec 完整实现 · 2026-08-02 · 移除 22 个文件 + 接入 3864 条定式变化 · 69 测试全绿
      </Text>

      <Grid columns={4} gap={12}>
        <Stat value="22" label="移除文件（课程/评估/LLM/死代码/alt）" />
        <Stat value="3864" label="KOGO 定式变化线（8 家族）" />
        <Stat value="69" label="单元测试通过" />
        <Stat value="5 项" label="精简后导航（首页/对弈/研究▾/定式/设置）" />
      </Grid>

      <Divider />

      <H2>一、功能精简（保留核心）</H2>
      <Table
        headers={['模块', '处置', '说明']}
        rows={[
          ['对弈 /play', '保留', '本地 AI 对弈，棋谱自动保存（棋谱来源）'],
          ['研究 /study', '保留', 'SGF 导入 / 历史棋谱 / 候选点 / 胜率曲线 / 本地解说'],
          ['复盘 /study/review', '保留', '整盘逐手分析、恶手疑问手标注（星阵收费功能）'],
          ['定式 /joseki', '重构', '接入 KOGO 全量定式辞典（见二）'],
          ['设置 /settings', '保留', '本地引擎 / 棋盘 / 棋子 / 主题（LLM BYOK 区块已移除）'],
          ['课程死活题/特训', '移除', '其他平台免费提供'],
          ['棋力评估', '移除', '其他平台免费提供'],
          ['LLM AI 解说', '移除', 'BYOK 配置整体清除，本地解说保留'],
          ['/alt 对比版', '移除', 'src/alt 整目录 + 路由分支'],
        ]}
      />

      <Divider />

      <H2>二、定式教学接入 KOGO 全量辞典</H2>
      <Text>
        数据源为项目内置的 KOGO 定式辞典中文版（822KB SGF + 提取脚本），新页面
        JosekiBrowsePage 提供三级浏览与逐手演示：
      </Text>
      <Table
        headers={['家族', '变化线数']}
        rows={[
          ['三三', '261'],
          ['小目', '1645'],
          ['星位', '922'],
          ['目外', '617'],
          ['高目', '327'],
          ['三六（超目外）/ 四六（超高目）/ 五五', '84'],
        ]}
      />
      <Stack gap={8}>
        <Tag tone="success">三级浏览：家族 → 定式簇（共享前缀聚类）→ 变化线</Tag>
        <Tag tone="success">逐手播放：首/退/进/尾，黑白交替（canvas 像素检测确认）</Tag>
        <Tag tone="success">变化切换：同簇多变化点击即切换，手数自动重置</Tag>
        <Tag tone="info">置信度标注：常见型 / 变体 / 待复核</Tag>
      </Stack>

      <Divider />

      <H2>三、关键变更文件</H2>
      <Table
        headers={['文件', '变更']}
        rows={[
          ['src/pages/JosekiBrowsePage.tsx', '新增：KOGO 定式浏览页（/joseki）'],
          ['src/App.tsx', '路由导航精简：删 /assessment /course /alt，加 /joseki'],
          ['src/stores/settingsStore.ts', '清除 LLM provider 字段与 4 个方法'],
          ['src/pages/SettingsPage.tsx', '移除「AI 解说（BYOK）」区块（约 220 行）'],
          ['src/alt2/pages/Home2Page.tsx', '首页精简：5 入口 + 真实最近对局（IndexedDB）'],
          ['src/index.css', '删除解说面板/评估页/课程页/旧定式页样式（395 行）'],
          ['src/alt2/pages/Play2Page.tsx 等', '保留（棋盘已用回原版 GoBoardCanvas）'],
        ]}
      />

      <Divider />

      <H2>四、验证证据</H2>
      <Table
        headers={['验证项', '方法', '结果']}
        rows={[
          ['类型与构建', 'tsc --noEmit + npm run build', '通过'],
          ['单元测试', 'vitest run（theme/gameStore/benchmark 等）', '7 文件 69 用例全绿'],
          ['导航与 404', '浏览器：/assessment /course /alt', '均显示「页面不存在」，导航仅 5 项'],
          ['定式页全流程', '浏览器：家族→簇→变化线→逐手→切换', '8 家族、簇列表、变化切换、黑白交替像素确认'],
          ['核心回归', '浏览器：对弈闭环 / 研究候选点 / 复盘页 / 设置页', 'AI 应手、候选点数据、复盘打开、无 BYOK 区块'],
          ['遗留引用', 'grep coursesData/AssessmentPage/LLM/AltApp', '零残留'],
        ]}
        rowTone={['success', 'success', 'success', 'success', 'success', 'success']}
      />

      <Divider />

      <Callout tone="info" title="最终状态">
        平台精简为「对弈 / 研究 / 复盘 / 定式 / 设置」五模块：AI 复盘与对局研究（星阵收费功能）为核心，
        定式教学由 6 个手写定式升级为 KOGO 全量辞典（8 家族 3864 变化）。
        开发服务器 http://localhost:5173 运行中，本地引擎后端 8000 端口就绪。
      </Callout>

      <Text tone="secondary" size="small">
        备注：浏览器自动化截图工具因扩展故障持续超时，验证以页面文本快照、a11y 树、canvas 像素检测与 DOM 计算样式为证据；
        首页最近对局为真实 IndexedDB 数据（浏览器实测时含 2 局测试棋谱）。
      </Text>
    </Stack>
  )
}
