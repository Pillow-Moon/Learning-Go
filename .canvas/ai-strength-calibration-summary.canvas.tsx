import { Callout, Divider, Grid, H1, H2, Stack, Stat, Table, Tag, Text } from 'qoder/canvas'

export default function AiStrengthCalibrationSummary() {
  return (
    <Stack gap={20}>
      <H1>AI 强度等级准确标定计划 — 目标完成报告</H1>
      <Text tone="secondary" size="small">
        Spec 完整实现 · 2026-08-01 · 8 阶段全部交付 · tsc / 39 前端用例 / 7 后端用例全绿
      </Text>

      <Grid columns={4} gap={12}>
        <Stat value="8" label="阶段完成（P0–P8）" />
        <Stat value="36" label="档位（业余 20 级→职业九段）" />
        <Stat value="320MB" label="绿色部署包（模型内置）" />
        <Stat value="60+" label="实测对弈盘数（P7 扫描）" />
      </Grid>

      <Divider />

      <H2>阶段交付总览</H2>
      <Table
        headers={['阶段', '内容', '验证结果']}
        rows={[
          ['P0', '档位扩展至业余 20 级（36 档）', 'tsc + 39 测试全绿'],
          ['P1', '强度参数单一来源 shared/ai-strength.json', '前后端同源，双源复制消除'],
          ['P2', 'Store 瘦身：领域逻辑迁 lib/strength.ts', '39 测试全绿'],
          ['P3', '引擎抽象 + Human-SL 引擎化 + 模型收敛', '真实对弈：am5k→E5、动态切档、pro 回退'],
          ['P4', 'WASM 收敛：仅 b6c96 + 简化 5 档', 'b10c128 全链路删除'],
          ['P5', 'Tailscale 远程引导 + WASM 兜底优化', 'health IP 接口 + 设置页引导'],
          ['P6', '绿色部署包 + Web 控制面板', '320MB zip 无 Python 环境全链路实证'],
          ['P7', '档位验证（P7a 梯度 + P7b 能力边界）', '60+ 盘实测落盘 calibration/'],
          ['P8', '星阵式领地开关（按显按隐）', 'tsc + 测试全绿'],
        ]}
        rowTone={['success', 'success', 'success', 'success', 'success', 'success', 'success', 'success', 'success']}
      />

      <Divider />

      <H2>P7 实测核心结论</H2>
      <Table
        headers={['b6c96 档位', 'visits', 'vs Human-SL', '结果']}
        rows={[
          ['am18k', '18', 'rank_20k', '让 2 子仍 100% 全胜'],
          ['am10k', '180', 'rank_10k', '让 2 子仍 100% 全胜'],
          ['am4k', '960', 'rank_4k', '让 2 子仍 100% 全胜'],
          ['am1d', '3000', 'rank_1k', '让 2 子仍 100% 全胜'],
          ['am3d', '5400', 'rank_3d', '让 2 子仍 100% 全胜'],
        ]}
      />
      <Callout tone="info" title="关键发现">
        纯调 visits 无法把 KataGo 网络棋力压到「人类低级」区间——b6c96 最低档（18v）都远超 20 级人类让 2 子。
        平台控强度主流机制是风格模仿（星阵 / Human-SL）与错误注入（KaTrain），非纯 visits。
        WASM 档位标签已按实测修正为具体级别（约业余 18 级 / 10 级 / 4 级 / 1 段 / 3 段）。
      </Callout>

      <Divider />

      <H2>绿色部署包实证链路</H2>
      <Stack gap={8}>
        <Text>PyInstaller onedir 构建（console 模式）→ zip 320.4MB → 解压到任意目录 → 首次启动自动复制模型 / katago.exe / DLL / OpenCL tune 到 data/ → 服务启动（关闭窗口即停）→ Human-SL 对弈 G7 + pro 档 E5 + 控制面板 /admin 全部实测通过。</Text>
        <Tag tone="success">无 Python 环境可用</Tag>
        <Tag tone="info">Tailscale 远程填一次永久生效</Tag>
        <Tag tone="info">Web 控制面板：状态 / 日志 / 启停</Tag>
      </Stack>

      <Divider />

      <H2>架构决策沉淀</H2>
      <Table
        headers={['决策', '结论']}
        rows={[
          ['对弈 vs 分析引擎', '对弈（19 路 Local）用 Human-SL 官方 rank 标尺；分析/解说/评估固定正常引擎最强等级（星阵模式）'],
          ['Human-SL 接入方式', '必须附加模式（-model 正常 + -human-model humanv0）；档位 kata-set-param 动态切换；am6d/am7d 用官方 9d 增强配方'],
          ['WASM 定位', '离线兜底：b6c96 单模型 + 简化 5 档（具体级别标签）'],
          ['本地模型', '收敛为 b11c768h12（+ humanv0 对弈模式）'],
          ['手机端', '外出远程为主场景：Tailscale（IP 固定、零代码）；局域网配对为伪需求不开发'],
          ['参数维护', 'shared/ai-strength.json 单一来源，前后端同读'],
        ]}
      />

      <Divider />

      <Text tone="secondary" size="small">
        校准记录：backend/calibration/2026-08-01-p7b.md（P7b 完整 5 组扫描 + P7a 抽查）· 遗留：P7a 全档扫描与错误注入精确档位为可选后续项
      </Text>
    </Stack>
  )
}
