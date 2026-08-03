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
  { label: "需求项", value: 6, unit: "项" },
  { label: "删除文件", value: 3, unit: "个" },
  { label: "改动文件", value: 8, unit: "个" },
  { label: "浏览器验收", value: 4, unit: "/ 4 项" },
];

const requirements = [
  ["解说 Markdown", "react-markdown 渲染解说文本，** 字面量不再外露；补充块级排版样式"],
  ["首页图标", "emoji 全部换成内联 SVG 线条图标（随主题变色），方框消失"],
  ["变化图", "半透明黑白棋子交替 + 1/2/3… 编号（黑棋白字、白棋黑字）"],
  ["研究领地", "「显示领地（实地预测）」复选框，勾选后棋盘显示黑白渐变色块"],
  ["棋盘统一", "研究/定式页统一 252px 网格，棋盘同为 720px、位置一致"],
  ["删除对弈", "Play2Page + gameStore 删除，路由/导航/首页入口/mock 全清，/play 走兜底页"],
];

const changedFiles: [string, string][] = [
  ["frontend/src/alt2/pages/Play2Page.tsx", "删除（对弈页）"],
  ["frontend/src/stores/gameStore.ts", "删除（仅对弈页引用）"],
  ["frontend/src/stores/gameStore.test.ts", "删除（规则引擎测试随模块移除）"],
  ["frontend/src/App.tsx", "删 /play 路由、导航「对弈」、import；注释同步"],
  ["frontend/src/App.theme.test.tsx", "删 Play2Page mock"],
  ["frontend/src/alt2/pages/Home2Page.tsx", "SVG 图标；4 卡（研究·复盘/定式/诊断/设置）；文案更新"],
  ["frontend/src/alt2/pages/Study2Page.tsx", "ReactMarkdown 解说；highlightFirstColor；领地开关 + ownership 传值"],
  ["frontend/src/components/GoBoardCanvas.tsx", "highlightFirstColor prop；drawHighlights 重写为半透明黑白棋 + 编号"],
  ["frontend/src/alt2/alt2.css", "v2-opt-check 复选框样式；v2-comment-text Markdown 排版"],
  ["frontend/src/pages/JosekiBrowsePage.tsx", "删内联 200px 网格覆盖，统一 .v2-layout.study"],
];

const evidenceRows: [string, string, string][] = [
  ["类型检查", "npx tsc -b --noEmit", "通过（0 错误）"],
  ["单元测试", "npx vitest run", "57 passed（删除 gameStore.test 后）"],
  ["生产构建", "npm run build", "通过（仅既有 chunk 体积警告）"],
  ["代码检查", "npx oxlint", "仅既有 public/sw.js 1 error，非本次引入"],
  ["浏览器验收", "Browser 实测（WASM 引擎）", "首页/解说/领地/变化图/定式/404 全部通过"],
];

const screenshots = [
  ".canvas/audit-home.png 首页 4 卡 + SVG 图标",
  ".canvas/audit-comment.png 解说加粗渲染（无 ** 字面量）",
  ".canvas/audit-variation.png 变化图半透明黑白棋 + 编号",
  ".canvas/audit-territory.png 领地渐变色块",
  ".canvas/audit-play404.png /play 兜底页",
];

export default function UiSlimReviewReport() {
  return (
    <ReportShell width="wide" ariaLabel="UI 精简与复盘体验优化完成报告">
      <Stack gap="sectionCompact">
        <header>
          <Stack gap="component">
            <H1>UI 精简与复盘体验优化 — 完成报告</H1>
            <Text tone="secondary">
              计划：UI精简与复盘体验优化_task-f1e.md · 2026-08 · 前端 React + KataGo WASM
            </Text>
            <MetricsGrid variant="header" columns={4} items={headlineMetrics} />
          </Stack>
        </header>

        <ReportSection title="完成摘要" divided>
          <Table
            headers={["需求", "实现"]}
            rows={requirements}
            density="comfortable"
          />
        </ReportSection>

        <ReportSection title="关键步骤" divided>
          <Stack gap="component">
            <Text>
              1. 调研引用面：确认 react-markdown 已在依赖、ownership 链路全通（仅
              Study2Page 硬编码 null）、布局差异源于三套 grid 模板。
            </Text>
            <Text>
              2. 与用户确认架构决策：对弈模式完全删除（含胜率显示），首页「研究」「复盘」合并。
            </Text>
            <Text>
              3. 删除对弈模式：Play2Page / gameStore / gameStore.test 三个文件 +
              App 路由、导航、mock 清理。
            </Text>
            <Text>
              4. 组件层改造：GoBoardCanvas 变化图重绘（半透明黑白棋 + 编号）、
              Study2Page 集成 Markdown 解说与领地开关、首页 SVG 图标、定式页网格统一。
            </Text>
            <Text>
              5. 验证：tsc / 57 单测 / 构建全绿；浏览器逐项实测 4/4 通过并截图存档。
            </Text>
          </Stack>
        </ReportSection>

        <ReportSection title="改动文件（10 个）" divided>
          <Table
            headers={["文件", "改动"]}
            rows={changedFiles}
            density="comfortable"
          />
        </ReportSection>

        <ReportSection title="验证证据" divided>
          <Table
            headers={["验证项", "方式", "结果"]}
            rows={evidenceRows}
            density="comfortable"
          />
          <Stack gap="component">
            <Text tone="secondary">浏览器验收截图（均已确认真实文件）：</Text>
            {screenshots.map((s) => (
              <Text key={s} size="small" tone="secondary">
                {s}
              </Text>
            ))}
          </Stack>
        </ReportSection>

        <ReportSection title="最终结论" divided>
          <Callout tone="positive" title="目标达成">
            计划全部条目已实现并通过逐项审计：对弈模式完全移除（/play 走兜底页），
            首页图标修复，解说 Markdown 渲染，变化图黑白交替编号清晰，
            研究页领地恢复，研究/定式棋盘尺寸与位置一致。
            平台主线收敛为「星阵对弈 → 导入 SGF → 研究复盘 → 诊断 → 定式」。
          </Callout>
        </ReportSection>
      </Stack>
    </ReportShell>
  );
}
