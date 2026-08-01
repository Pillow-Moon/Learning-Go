# Checklist

## 校准计划与工具
- [x] 计划表说明官方文档核查结论（KataGo 无 visits↔段位强度映射；Human-SL 为风格模仿、非强度锚点）
- [x] 计划表说明平台强度设定调研结论（野狐/弈客/星阵均为对局级选择，无全局强度设置）
- [x] `backend/calibration/README.md` 计划表包含 L1/L2/L3 三层方法、执行步骤、记录表格式与回填规则
- [x] 计划表包含耗时预估表与调参选项（9/19 路、每档盘数、扫描上限、只校关键档）
- [x] L1 采用"9 路预扫 + 19 路复核"两段式，避免低 visits 档快速 resign 污染数据（写入文档；执行已取消）
- [x] 计划表包含 L3 自动化锚定操作手册（Human-SL 本地对弈主路径 / 平台人工对弈可选交叉验证 / 社区经验兜底）
- [x] `b18c384nbt-humanv0.bin.gz` 已下载，本机 `katago gtp -human-model` 冒烟通过
- [x] `KataGoGTP` / `selfplay.py` 支持 Human-SL 档位；`calibrate.py` 支持 `--human-sl` 模式
- [x] Human-SL 映射表落盘并给出 BASE 建议值，记录表标注 Human-SL 精度局限（实测：Human-SL 纯风格模仿棋力过弱无均势点，BASE 维持 3000，见 `backend/calibration/2026-08-01-l3-humansl.md`）
- [x] `calibrate.py` 支持 `--plan` 相邻等级批量让子扫描，输出间距报告（均势让子数 + ratio 建议）
- [ ] ~~L1 校准在 b11c768h12 上执行，相邻等级数据落盘~~（已取消：用户决定保留现状参数、不跑对弈校准）
- [ ] ~~L2 跨模型校准执行并给出 factor 建议~~（已取消：用户要求停止两两对弈）
- [x] L3 绝对锚定给出 BASE 建议值（Human-SL 实测 + 社区经验兜底，BASE=3000）
- [ ] ~~ratio / factor / BASE 按校准数据回填到 settingsStore.ts~~（已取消：保留现状参数）
- [ ] ~~回填后重新让子扫描验证：相邻段均势让子数接近 1 子~~（已取消：保留现状参数）

## 设置页强度简化
- [x] 设置页不再显示"AI 强度"下拉与自定义访问量输入，其余设置不变
- [x] custom 档从类型/选项/迁移中移除，旧值 `custom` 迁移为 `am1d`，`customVisits` 无残留
- [x] gameStore / analysisStore / GameControls 无 custom 分支残留
- [x] 复盘/分析/AI 解说/棋力评估固定使用引擎在该场景最强等级（`getStrengthCap` 带场景参数），不随对弈等级变化
- [x] 对弈等级保持局级，未传入时 AI 落子默认业余 1 段（`am1d`）
- [x] 全局 `aiStrength` 状态 / `setAIStrength` / 迁移逻辑无残留
- [x] 后端 analysis 持续读取中间态快照（`isDuringSearch` + `reportDuringSearchEvery`），`GET /analysis/{id}` 在 running 时返回最新 result
- [x] local 引擎分析中前端节流刷新胜率/候选点，结束落地终态
- [x] WASM worker `print` 回调按行转发 `snapshot` 消息，`onExit` 最后解析行落地终态，同样实时刷新
- [x] 前端 tsc 与测试全部通过（38 用例通过；后端 pytest 通过）

## WASM 档位错误注入（Task 11）
- [x] `rankInjection.ts` 移植 KaTrain `ai:p:rank` 盲注式（n_moves 公式 + override 阈值，OGS 校准），选点含合法着法/自杀/打劫过滤
- [x] `WasmEngine.genmove` 对 WASM 简化档启用注入（includePolicy + setStrength 保存档位），分析场景不受影响
- [x] `shared/ai-strength.json` wasmGroups 增 kyuRank（18/10/4/0/-2），标签去"约"（精确档位）；README §2.4 已补（P7b 引用闭环）
- [x] 前端测试 55 例通过（新增 16 例：公式参考值 Python 复算 + 各分支 + 占位/劫过滤）、tsc / oxlint 通过

## B6 全档位 + 差分测速（Task 12）
- [x] wasmGroups 删除，WASM 19 路对弈档位 = am20k~am5d 全部等级（kyuRank 由 id 推导，上限 5 段 = KaTrain 校准可靠范围）；b6c96 maxStrength am3d→am5d；9/13 路不注入
- [x] 对弈档位统一低搜索量（32v）+ KataGo maxTime（20s）兜底，任意档位每手约 5~11s（行业做法，不自研复杂度分段）
- [x] benchmark.ts 差分测速（20v/240v 两次分析取 Δv/Δt，固定开销消除），benchmark.test.ts 重写（固定开销不影响测速）
- [x] 前端 vitest 61 例 / tsc / oxlint 通过；README §2.4/§2.5、P7b、spec 同步
- [ ] ~~P7a 全档扫描验证错误注入档位~~（遗留可选后续：am20k~am5d 抽样 vs Human-SL rank 标尺让 5~7 子扫描，有偏差调 kyuRank）
