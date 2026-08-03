import {
  Callout,
  H1,
  MetricsGrid,
  ReportSection,
  ReportShell,
  Stack,
  Table,
  Text,
} from "qoder/canvas";

const headlineMetrics = [
  { label: "需求项", value: 3, unit: "项" },
  { label: "改动文件", value: 6, unit: "个" },
  { label: "新增文件", value: 1, unit: "个" },
  { label: "浏览器验收", value: 3, unit: "/ 3 项" },
];

const requirements: [string, string][] = [
  [
    "变化图「试下」",
    "点候选行显示变化图后按「试下此变化图」，跟随变化图摆子时变化图保持显示、暂停自动分析；「退出试下」恢复对新局面分析",
  ],
  [
    "定式切换崩溃修复",
    "切换家族/簇瞬间 moveList[current-1] 为 undefined 导致 Cannot read properties of undefined (reading 'pass')，已判空修复",
  ],
  [
    "导航按钮图标",
    "8 处 ⏮◀▶⏭ Unicode 符号（Windows 缺字形显示方框）全部替换为内联 SVG 线条箭头",
  ],
];

const changedFiles: [string, string][] = [
  ["frontend/src/components/NavIcons.tsx", "新增：FirstIcon/PrevIcon/NextIcon/LastIcon 四个线条 SVG"],
  ["frontend/src/alt2/pages/Study2Page.tsx", "tryPv 状态；清理/分析两 effect 试下守卫；showHighlights 优先级；工具条 UI；导航按钮换 SVG"],
  ["frontend/src/alt2/alt2.css", "新增 .pv-try-bar / .pv-try-status 样式"],
  ["frontend/src/pages/JosekiBrowsePage.tsx", "lastVertex 判空修复（prevMove）；导航按钮换 SVG"],
  ["frontend/src/index.css", ".review-nav-buttons .btn 增加 inline-flex 对齐"],
];

const evidenceRows: [string, string, string][] = [
  ["类型检查", "npx tsc -b --noEmit", "通过（0 错误）"],
  ["单元测试", "npx vitest run", "57 passed"],
  ["生产构建", "npm run build", "通过（仅既有 chunk 体积警告）"],
  ["代码检查", "npx oxlint", "仅既有 public/sw.js 1 error，非本次引入"],
  [
    "浏览器验收（试下）",
    "两次独立会话，DOM 断言 + canvas 像素分析",
    "导入 SGF → 试下此变化图 → 落子后变化图保持（像素级确认编号棋子仍在）→ 无重新分析 → 退出恢复分析，全流程通过",
  ],
  [
    "浏览器验收（定式切换）",
    "连续快速切换 8 个家族 + 定式行",
    "无崩溃、无 Uncaught TypeError、导航按钮禁用态正确",
  ],
  [
    "浏览器验收（图标）",
    "DOM 断言",
    "两页 8 个按钮均为 14×14 线条 SVG（fill=none stroke=currentColor），无 Unicode 符号残留",
  ],
];

export default function TryVariationReport() {
  return (
    <ReportShell width="wide" ariaLabel="变化图试下与界面缺陷修复完成报告">
      <Stack gap="sectionCompact">
        <header>
          <Stack gap="component">
            <H1>变化图「试下」与界面缺陷修复 — 完成报告</H1>
            <Text tone="secondary">
              计划：变化图固定与界面缺陷修复_task-f1e.md · 2026-08 · 前端 React + KataGo WASM
            </Text>
            <MetricsGrid variant="header" columns={4} items={headlineMetrics} />
          </Stack>
        </header>

        <ReportSection title="完成摘要" divided>
          <Table headers={["需求", "实现"]} rows={requirements} density="comfortable" />
        </ReportSection>

        <ReportSection title="关键步骤" divided>
          <Stack gap="component">
            <Text>
              1. 命名确认：用户将「固定」改名为「试下」（试下此变化图），计划随之更新，UI
              文案与内部状态（tryPv）统一采用该命名。
            </Text>
            <Text>
              2. 「试下」实现：新增 tryPv 快照状态；清理 effect 与分析触发 effect 均加
              tryPv 守卫（试下中不停止/不发起分析）；退出试下时依赖变化自动重估，对新局面重新分析。
            </Text>
            <Text>
              3. 崩溃修复：定位为切换瞬间 line 先变而 current 异步重置，moveList 暂时短于
              current；改为 prevMove 判空后再读 .pass。
            </Text>
            <Text>
              4. 图标替换：新建 NavIcons 共享组件，两页 8 处按钮替换，并补充按钮 flex 对齐样式。
            </Text>
            <Text>
              5. 验证：tsc / 57 单测 / 构建全绿；浏览器两次独立会话逐项实测通过（试下全流程、
              8 家族快速切换、图标 DOM 断言）。
            </Text>
          </Stack>
        </ReportSection>

        <ReportSection title="改动文件（6 个）" divided>
          <Table headers={["文件", "改动"]} rows={changedFiles} density="comfortable" />
        </ReportSection>

        <ReportSection title="验证证据" divided>
          <Table headers={["验证项", "方式", "结果"]} rows={evidenceRows} density="comfortable" />
          <Text tone="secondary" size="small">
            说明：浏览器截图通道本次持续超时（扩展层故障，与页面无关），功能验证改用
            DOM 状态断言 + canvas 像素级分析完成，两次独立会话结果一致。
          </Text>
        </ReportSection>

        <ReportSection title="最终结论" divided>
          <Callout tone="positive" title="目标达成">
            计划全部条目已实现并通过逐项审计：「试下」功能（跟随变化图摆子保持显示、
            暂停研究、退出恢复）、定式切换崩溃修复、8 处导航按钮图标 SVG 化。
          </Callout>
        </ReportSection>
      </Stack>
    </ReportShell>
  );
}
