# Tasks

## A. 校准计划与工具
- [x] Task 1: 编写《段位校准计划表》文档
  将三层校准方法（L1 等级间距 / L2 模型系数 / L3 绝对锚定）、校准记录表格式、回填规则、平台 AI 对弈操作手册整理为一份完整可执行的计划文档，落盘为 `backend/calibration/README.md`（校准计划表本体）。
  - [x] SubTask 1.1: 编写 L1/L2/L3 方法说明与执行步骤
  - [x] SubTask 1.2: 定义校准记录表字段与落盘规范
  - [x] SubTask 1.3: 编写 L3 自动化锚定操作手册（Human-SL 本地对弈主路径 / 平台人工对弈可选交叉验证 / 社区经验兜底）
  - [x] SubTask 1.4: 定义参数回填规则（ratio / factor / BASE）
  - [x] SubTask 1.5: 写入耗时预估表（按本机 visits/s × visits × 局数估算 L1/L2 各步耗时）与调参选项（9/19 路、每档盘数、扫描上限、只校关键档），并说明 L1 采用"9 路预扫 + 19 路复核"两段式

- [x] Task 2: 扩展 calibrate.py 批量扫描模式
  为 `backend/scripts/calibrate.py` 新增"相邻等级批量让子扫描"模式（`--plan <模型> --levels <等级序列> --games N`），自动对每对相邻等级跑让子扫描，输出等级间距报告（均势让子数 + ratio 修正建议）。
  - [x] SubTask 2.1: 实现等级序列解析与相邻档扫描编排
  - [x] SubTask 2.2: 实现间距报告输出（均势让子数表格 + ratio 建议）
  - [x] SubTask 2.3: 补充脚本帮助与用法示例

- [ ] ~~Task 3: 执行 L1 等级间距校准~~（已取消：用户决定保留现状参数、不跑对弈校准）
  用 `calibrate.py` 在 b11c768h12 上对关键相邻等级档（业余 1 级→业余 1 段→业余 3 段→业余 6 段→职业初段等）做让子扫描，结果按记录表落盘。采用两段式：首轮 9 路预扫定级（每档 2 盘、扫描 0~2），发现显著偏差的档对再用 19 路复核（每档 4 盘、扫描 0~3），避免低 visits 档快速 resign 污染数据。
  - [ ] SubTask 3.1: 按 `aiVisitsFor` 公式计算各等级 visits 并执行 9 路预扫
  - [ ] SubTask 3.2: 对可疑档对执行 19 路复核，记录数据到 `backend/calibration/`，产出间距报告
  - [ ] SubTask 3.3: 依据数据给出 ratio 修正建议

- [ ] ~~Task 4: 执行 L2 模型系数校准~~（已取消：用户要求停止两两对弈）
  跨模型（b11c768h12 vs b10c512h8 vs b10c384h6）同等级同 visits 自对弈（双进程），测出模型间棋力差，给出 factor 修正建议。
  - [ ] SubTask 4.1: 三模型两两对弈（19 路、让子扫描）
  - [ ] SubTask 4.2: 记录数据并给出 factor 修正建议

- [x] Task 5: L3 绝对锚定自动化（Human-SL 本地对弈）
  下载官方 Human-SL 权重 `b18c384nbt-humanv0.bin.gz`（v1.15.0 release），扩展 `KataGoGTP` 支持 `-human-model` + `humanSLProfile`（preaz_20k~9d / rank_20k~9d），让本地引擎各等级档与 Human-SL 各段位档自对弈（让子扫描），自动建立"本地等级 ↔ 段位标签"映射，给出 `BASE_VISITS_AM1D` 建议值。平台人工对弈作为可选交叉验证，不阻塞锚定。
  实测结论：Human-SL 纯风格模仿棋力远弱于本地引擎最弱档，找不到均势点，无法据此调整 BASE；建议维持 `BASE_VISITS_AM1D=3000`（与社区锚点一致），已落盘 `backend/calibration/2026-08-01-l3-humansl.md`。
  - [x] SubTask 5.1: 下载 Human-SL 权重并验证本机可运行（`katago gtp -human-model` 冒烟）
  - [x] SubTask 5.2: `KataGoGTP` / `selfplay.py` 支持 Human-SL 档位参数；`calibrate.py` 新增 `--human-sl` 模式
  - [x] SubTask 5.3: 本地引擎各档 vs Human-SL 各段位让子扫描，产出映射表并落盘
  - [x] SubTask 5.4: 依据映射给出 BASE 建议值，记录表标注 Human-SL 精度局限（风格模仿非强度标定，高段位仅方向参考）

- [ ] ~~Task 6: 回填参数并验证~~（已取消：用户决定保留现状参数、不校准，无需回填）
  按 L1/L2/L3 校准数据回填 `settingsStore.ts` 的 ratio / factor / BASE，并重新做相邻等级让子扫描验证（均势让子数应接近目标值）。
  - [ ] SubTask 6.1: 回填参数
  - [ ] SubTask 6.2: 前端 tsc + 测试通过
  - [ ] SubTask 6.3: 验证对弈复核等级一致性

## B. 设置页强度简化（与校准任务独立，可并行）
- [x] Task 7: 删除设置页"AI 强度"区块
  从 `frontend/src/pages/SettingsPage.tsx` 删除 AI 强度下拉与自定义访问量输入及相关计算函数（strengthVisits / strengthOptionText / customTimeText 等不再被设置页使用），其余设置区块不变。
  - [x] SubTask 7.1: 删除设置页强度 UI 与相关局部逻辑
  - [x] SubTask 7.2: 前端 tsc + 测试通过

- [x] Task 8: 移除"自定义"档
  从等级体系移除 custom：`settingsStore.ts` 的 AIStrengthId / AI_STRENGTH_OPTIONS 移除 custom 项、`migrateAIStrength` 将旧值 `custom` 迁移为 `am1d`、删除 `customVisits` 状态与持久化；`gameStore.ts` / `analysisStore.ts` 删除 custom 分支；`GameControls.tsx` 等级下拉不再排除 custom。
  - [x] SubTask 8.1: settingsStore 类型/选项/迁移/customVisits 清理
  - [x] SubTask 8.2: gameStore / analysisStore / GameControls custom 分支清理
  - [x] SubTask 8.3: 前端 tsc + 测试通过

- [x] Task 9: 分析用引擎最强等级 + 移除全局 aiStrength
  复盘/分析/AI 解说/棋力评估固定使用当前引擎可达最高等级（`getStrengthCap` 上限），不随对弈等级变化；移除全局 `aiStrength` 状态（`setAIStrength` / `migrateAIStrength` 迁移逻辑），`gameStore` 对局内 AI 落子等级来源改为开局传入的局级值，未传默认 `am1d`。
  - [x] SubTask 9.1: `settingsStore.getStrengthCap` 增加场景参数（按 `180s / SCENE_RATIO[scenario]` 折算预算），新增"按场景取最强等级"帮助函数；`analysisStore.ts` 改用该等级计算分析 visits，删除 custom 分支
  - [x] SubTask 9.2: `settingsStore.ts` 移除 `aiStrength` 状态 / `setAIStrength` / 迁移逻辑（custom 迁移并入 Task 8）
  - [x] SubTask 9.3: `gameStore.ts` 对局内强度来源改为局级值 + `am1d` 兜底；`GameControls.tsx` 初始等级默认 `am1d`（不再读全局）
  - [x] SubTask 9.4: 前端 tsc + 测试通过

- [x] Task 10: 分析结果实时增量更新（local + WASM）
  后端 `KataGoAnalysis.analyze` 改为持续读取同一 query 的所有输出行（`isDuringSearch` 中间态快照），逐行更新内存任务快照；轮询接口在 `running` 状态返回最新结果；前端 `localEngine` 轮询透出中间结果。WASM 引擎同样流式：worker `print` 回调按行解析中间态 JSON 并实时转发 `snapshot` 消息，`onExit` 时最后解析行落地终态。`analysisStore` 节流刷新，`CommentaryPanel` 展示收敛中的胜率/候选点。
  实现要点：查询 JSON 增加 `reportDuringSearchEvery: 1.0`（KataGo 默认不输出中间行，必须显式开启）；`parseStdout` 改为取最后一个匹配行（终态）。
  - [x] SubTask 10.1: `katago_analysis.py` 读取全部匹配行，逐个回调/写入快照，最终行落地终态
  - [x] SubTask 10.2: `analysis.py` 任务表支持中间快照，`GET /analysis/{id}` 在 running 时返回 `result`
  - [x] SubTask 10.3: `localEngine.ts` 轮询时透出中间结果（`onSnapshot` 回调）
  - [x] SubTask 10.4: `katago.worker.ts` `print` 回调按行解析中间态 JSON，转发 `snapshot` 消息；`onExit` 时最后解析行作为 `result`
  - [x] SubTask 10.5: `wasmEngine.ts` 处理 `snapshot` 消息并透出（`onSnapshot` 回调）
  - [x] SubTask 10.6: `analysisStore` 节流更新（如 300ms 合并，覆盖 local 与 wasm 两路）；`CommentaryPanel` 渲染增量结果并指示"搜索中（N visits）"
  - [x] SubTask 10.7: 后端 pytest + 前端 tsc + 测试通过

- [x] Task 11: WASM 档位错误注入精确档位（KaTrain 盲注式）
  纯 visits 压不下 b6c96 棋力（P7b 实测让 2 子仍 100% 全胜），为使 WASM 简化档棋力精确等于具体级别，落地 KaTrain 盲注式错误注入：新增 `frontend/src/lib/rankInjection.ts` 移植 `ai:p:rank` RankStrategy 的 n_moves 公式与 override 阈值（OGS 校准），`WasmEngine.genmove` 在简化档启用（随机抽 n_moves 个合法点中选 policy 最高；局面明朗直接走最优；合法着法含自杀/打劫过滤）；`shared/ai-strength.json` wasmGroups 增 kyuRank（18/10/4/0/-2），标签去"约"；分析场景不走 genmove 不受影响。
  - [x] SubTask 11.1: `rankInjection.ts` 纯函数（nMovesForKyu / overridesForKyu / boardFromMoves / selectBlindedMove）
  - [x] SubTask 11.2: `wasmEngine.ts` 接入（includePolicy + policy 解析 + setStrength 保存档位 + genmove 注入）
  - [x] SubTask 11.3: 单测 16 例（公式参考值 Python 复算 + 各分支 + 占位/劫过滤）+ 前端 vitest 55 例 / tsc / oxlint 通过

- [x] Task 12: B6 全档位 + WASM 差分测速修正
  - 全档位：删除 wasmGroups 5 档简化，WASM 19 路对弈档位 = am20k~am5d 全部等级（kyuRank 由档位 id 推导 amXk→X / amXd→1-X，上限 5 段 = KaTrain OGS 校准可靠范围；6 段及以上不注入）；b6c96 `maxStrength` am3d→am5d；9/13 路不注入（公式按 19 路校准，小棋盘失真）。
  - 对弈耗时（行业做法，KataGo/KaTrain 同款）：盲注选点只看 policy（1 visit 即有完整 policy），搜索量与棋力解耦——对弈档位统一低搜索量（INJECTION_MAX_VISITS=32）+ 查询带 KataGo 官方 maxTime（20s）兜底，任意档位每手约 5~11s；不按局面复杂度自研分段（GTP 的 searchFactorWhenWinning 仅 GTP 模式可用）。
  - 差分测速：`benchmark.ts` 旧口径（单次 20v 总耗时）把重建 Module 固定开销（3~5s）摊进 visits/s 导致个位数虚低；改为每组跑 20v/240v 两次分析取 Δvisits/Δt，固定开销被消除，`getStrengthCap` 自动按真实速度折算。
  - [x] SubTask 12.1: benchmark.ts 差分测速 + benchmark.test.ts 重写（固定开销不影响测速）
  - [x] SubTask 12.2: ai-strength.json（maxStrength→am5d、删 wasmGroups）+ strength.ts（kyuRankFor 推导、getStrengthOptionsFor 简化）+ 推导测试
  - [x] SubTask 12.3: wasmEngine.ts（AnalysisQuery.maxTime 透传、genmove 先 clamp 后 analyze）
  - [x] SubTask 12.4: 前端 vitest 61 例 / tsc / oxlint 通过；文档同步（README §2.4/§2.5、P7b、本 spec）

- [ ] ~~P7a 全档扫描验证错误注入档位~~（遗留可选后续：全档位抽样 am20k~am5d vs Human-SL rank 标尺让 5~7 子扫描，确认均势点对应具体级别；有偏差调 kyuRank 再校）

# Task Dependencies
- [Task 2] depends on [Task 1]（记录表规范确定后再扩展工具）
- [Task 3] depends on [Task 2]（已取消）
- [Task 4] 可与 [Task 3] 并行（已取消）
- [Task 6] depends on [Task 3]、[Task 4]、[Task 5]（已取消）
- [Task 7] / [Task 8] / [Task 9] 相互关联（同涉及强度体系），建议顺序 8 → 9 → 7（先移除 custom，再改分析来源与全局状态，最后删设置页 UI），可与 A 组任务并行
- [Task 10] 依赖 [Task 9]（分析强度来源确定后，实时增量才与最强等级配套；10.3 复用 9 的分析入口），可与 A 组任务并行
