import { Callout, Divider, Grid, H1, H2, Stack, Stat, Table, Text } from 'qoder/canvas'

export default function WinratePerspectiveFixSummary() {
  return (
    <Stack gap={20}>
      <H1>胜率与目差视角错位修复</H1>
      <Text tone="secondary">
        修复「黑领先 85 目却显示胜率 0%」：KataGo 输出恒为黑方视角，代码却按行棋方翻转，导致 stale 结果黑白胜率颠倒、目差方向错误。
      </Text>

      <Grid columns={4} gap={16}>
        <Stat value="2" label="根因 Bug" />
        <Stat value="8" label="涉及文件" />
        <Stat value="9" label="后端测试通过" />
        <Stat value="73" label="前端测试通过" />
      </Grid>

      <Divider />

      <H2>根因分析</H2>
      <Callout tone="danger" title="KataGo 配置 reportAnalysisWinratesAs=BLACK">
        实测（轮到白、黑大优局面）：rootInfo.winrate=0.9994、scoreLead=+82.69 —— winrate 与 scoreLead
        全部恒为黑方视角，且 moveInfos 与 root 同视角。旧代码把 winrate 翻转成「行棋方视角」、scoreLead
        漏翻，下游又统一按「行棋方视角」解读。
      </Callout>

      <Table
        headers={['#', '问题', '触发条件', '现象']}
        rows={[
          [
            '1',
            'stale 结果胜率颠倒',
            '分析进行中用户落子，分析完成时局面已变',
            '界面用「当前行棋方」解读「分析时行棋方视角」的旧胜率 → 黑白胜率互换（黑领先 85 目显示 0%）',
          ],
          [
            '2',
            'scoreLead 未翻转',
            '轮到白时',
            '目差按行棋方解读黑视角数据 → 方向错误（推荐列表目差同理）',
          ],
        ]}
      />

      <Divider />

      <H2>修复内容</H2>
      <Stack gap={12}>
        <Stack gap={6}>
          <Text weight="semibold">1. 引擎层统一黑方视角</Text>
          <Text tone="secondary" size="small">
            wasmEngine / localEngine：删除 winrate 的 flip 转换，root 与候选的 winrate / scoreLead
            全部原样透传（实测确证 moveInfos 与 root 同为黑视角，修正了「落子后行棋方视角」的错误假设）。
          </Text>
        </Stack>
        <Stack gap={6}>
          <Text weight="semibold">2. 下游统一黑视角解读</Text>
          <Text tone="secondary" size="small">
            CommentaryPanel（黑胜率直接显示、目差正=黑领先）、localCommentary（黑方胜率/黑领先）、
            reviewStore（整盘分析）、ReviewPage 分析 tab、课程 AI 讲解、gameStore 终局点目。
          </Text>
        </Stack>
        <Stack gap={6}>
          <Text weight="semibold">3. stale 结果防御</Text>
          <Text tone="secondary" size="small">
            局面变化后隐藏胜率条、推荐列表、变化图，仅提示「局面已变化，请重新分析」；解说按钮禁用。
            过期数据不再用错误视角展示。
          </Text>
        </Stack>
      </Stack>

      <Divider />

      <H2>验证证据</H2>
      <Table
        headers={['验证项', '方式', '结果']}
        rows={[
          ['后端黑视角断言', 'pytest 纯逻辑 + 真实 KataGo 集成（轮到白黑大优，断言 winrate>0.9 且 scoreLead>0）', '9/9 通过'],
          ['浏览器-轮到黑黑大优', 'Local 引擎 12 手局面分析', '黑 99.9%，目差方向正确'],
          ['浏览器-轮到白黑大优', 'Local 引擎 13 手局面分析', '黑 95.6%（黑视角正确）'],
          ['浏览器-stale', '分析中落子后查看结果', '胜率条/推荐/变化图全隐藏 + 提示 + 解说禁用'],
          ['构建与回归', 'tsc -b / vitest / npm run build / oxlint', '全部通过'],
        ]}
        rowTone={[undefined, undefined, undefined, undefined, undefined]}
      />

      <Text tone="secondary" size="small">
        相关文件：wasmEngine.ts、localEngine.ts、CommentaryPanel.tsx、localCommentary.ts、reviewStore.ts、
        ReviewPage.tsx、gameStore.ts、backend/tests/test_katago.py
      </Text>
    </Stack>
  )
}
