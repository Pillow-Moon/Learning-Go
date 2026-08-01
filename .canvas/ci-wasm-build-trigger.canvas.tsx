import {
  Divider, Grid, H1, H2, Stack, Stat, Table, Text, Link,
} from 'qoder/canvas'

export default function CiWasmBuildTrigger() {
  return (
    <Stack gap={20}>
      <Stack gap={6}>
        <H1>修复 CI 并触发 KataGo WASM 构建</H1>
        <Text tone="secondary">
          改进 build-wasm.yml 竞态容错 + 推送修复 + 自动触发 Run #2
        </Text>
      </Stack>

      <Grid columns={3} gap={16}>
        <Stat label="Workflow Run" value="#2" tone="success" description="当前运行中" />
        <Stat label="Commit" value="02d5fc6" description="已推送到 main" />
        <Stat label="产物路径" value="frontend/public/wasm/" description="katago.js + katago.wasm" />
      </Grid>

      <Divider />

      <H2>修复内容</H2>
      <Table
        headers={['文件', '变更', '说明']}
        rows={[
          ['build-wasm.yml', 'git push → pull --rebase + push', '带容错：失败时输出 warning，不阻塞 CI'],
          ['git 全局配置', 'http.proxy = 127.0.0.1:7897', '终端走代理，解决 GitHub 443 端口连接失败'],
        ]}
      />

      <Divider />

      <H2>执行流程</H2>
      <Table
        headers={['步骤', '状态', '详情']}
        rows={[
          ['1. 修复竞态风险', '完成', 'git pull --rebase origin main && git push 带 warning 容错'],
          ['2. 配置 git 代理', '完成', 'http.proxy / https.proxy = 127.0.0.1:7897'],
          ['3. 推送修复', '完成', '02d5fc6 → main（修复后的 workflow 上线）'],
          ['4. 自动触发', '运行中', 'workflow 文件变更匹配 paths 过滤，自动触发 Run #2'],
          ['5. 产物生成', '等待中', 'katago.wasm + katago.js → frontend/public/wasm/'],
        ]}
      />

      <Divider />

      <Stack gap={8}>
        <Text size="small">
          Run #2 使用修复后的 workflow（含 pull --rebase 容错），即使构建期间有其他提交也不会因 non-fast-forward 失败。
        </Text>
        <Link href="https://github.com/PillowMonth/Learning-Go/actions/workflows/build-wasm.yml">
          在 GitHub Actions 查看构建进度
        </Link>
      </Stack>
    </Stack>
  )
}
