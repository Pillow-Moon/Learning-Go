import { Callout, Divider, Grid, H1, H2, Stack, Stat, Table, Tag, Text } from 'qoder/canvas'

export default function EngineFallbackFixSummary() {
  return (
    <Stack gap={20}>
      <H1>修复模型回退警告刷屏 — 目标完成报告</H1>
      <Text tone="secondary" size="small">
        Spec 完整实现 · 2026-08-02 · 后端修复 + 模拟验证 + 7 测试全绿
      </Text>

      <Grid columns={4} gap={12}>
        <Stat value="2s→0" label="告警频率（轮询后不再重复）" />
        <Stat value="1 个" label="修改文件（engine_manager.py）" />
        <Stat value="7" label="后端测试通过（两次运行）" />
        <Stat value="1 次" label="修复后警告出现上限" />
      </Grid>

      <Divider />

      <H2>问题根因</H2>
      <Table
        headers={['环节', '现象', '根因']}
        rows={[
          ['运行实例配置', '当前模型显示 b11c768h12，但日志持续报 b10c384h6 回退', '绿色包 exe 旁 .env 残留已下架的旧模型 b10c384h6（白名单仅剩 b11c768h12 + Human-SL）'],
          ['回退逻辑', 'get_current_model_path() 每次调用都打一条 warning', '回退分支只告警、不修正 _current_model_id，也不持久化 .env'],
          ['控制面板', '日志面板每 2 秒刷 1 条警告，500 条环形缓冲被挤满', '/admin/status 每 2 秒轮询 → get_effective_model_id() → 每次都重新走回退分支'],
        ]}
      />
      <Callout tone="warning" title="刷屏链路">
        控制面板 2s 轮询 /admin/status → get_effective_model_id() → get_current_model_path() → 配置仍指向 b10c384h6 → 每次重复回退、重复告警 → 日志缓冲被刷爆，排障日志被淹没。
      </Callout>

      <Divider />

      <H2>代码修改</H2>
      <Text>
        backend/app/services/engine_manager.py — get_current_model_path() 回退分支改为「一次性修正」：
      </Text>
      <Table
        headers={['修改前', '修改后']}
        rows={[
          ['每次回退都 logger.warning，_current_model_id 保持旧值，.env 不更新', '仅在 _current_model_id != fallback_id 时告警一次，随即更新 _current_model_id 并 _persist_env 持久化 .env'],
          ['轮询每次重复回退 → 刷屏', '首次回退后配置即被修正，后续调用直接命中正常分支，警告不再出现'],
          ['重启后 .env 仍是旧值，问题复发', '绿色包 exe 旁 .env 被自动改写为 b11c768h12，重启后配置仍正确'],
        ]}
      />
      <Stack gap={8}>
        <Tag tone="success">同事件循环内无 await，不存在并发重复修正</Tag>
        <Tag tone="info">开发环境 .env 已是 b11c768h12，直接命中正常分支，不受影响</Tag>
        <Tag tone="info">前端 / admin.html 无需改动，刷屏源在后端轮询触发的回退</Tag>
      </Stack>

      <Divider />

      <H2>验证结果</H2>
      <Table
        headers={['验证项', '方法', '结果']}
        rows={[
          ['无回归', 'pytest tests -q（两次独立运行）', '7 passed'],
          ['回退只告警一次', '环境变量指向不存在的模型，连续调用 get_current_model_path() 两次', 'first_warnings=1、after_second=1、model_id_now=b11c768h12，断言通过'],
          ['.env 自动修正且无污染', '_persist_env 实际写入后与备份 Compare-Object 比对', '零差异（开发 .env 本就为 b11c768h12，写入幂等无害），备份已清理'],
          ['无残留文件', '检查 .env.verifybak', '已删除'],
        ]}
        rowTone={['success', 'success', 'success', 'success']}
      />

      <Divider />

      <Callout tone="info" title="最终状态">
        下次打开控制面板，该警告最多出现 1 次（首次轮询自动修正配置），其后日志恢复正常，无需手动修改任何配置文件；绿色包 exe 旁 .env 被自动改写为 KATAGO_MODEL=./katago/models/b11c768h12.bin.gz。
      </Callout>

      <Text tone="secondary" size="small">
        遗留：绿色包实际运行环境（exe + data/models）的最终部署观察留待用户侧确认；其核心断言已被同代码路径的模拟验证直接覆盖。
      </Text>
    </Stack>
  )
}
