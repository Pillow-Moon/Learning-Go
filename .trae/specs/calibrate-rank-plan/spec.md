# 段位校准计划 Spec

## Why
AI 等级体系的三个参数——等级倍率（ratio）、模型系数（factor）、绝对基准（BASE_VISITS_AM1D）——目前均为估算值，导致"业余 N 段"等标签与实际棋力不符。自对弈校准工具（`/engine/calibrate` 接口 + `backend/scripts/calibrate.py`）已就绪。本计划用自对弈校准等级间距与模型系数，并借助其他围棋平台的 AI 对弈把等级锚定到真实段位，让等级标签可验证、可复现。

同时，分析/复盘固定使用引擎最强等级后，每手 visits 显著增大，等待时间变长；当前后端在 KataGo analysis 模式读到第一行中间态快照就返回（大 visits 时远未算完），既浪费算力又让用户干等。需要让分析结果实时增量更新：边算边显示胜率/候选点收敛，最终结果落地。

**官方文档核查结论**：KataGo 官方没有"visits ↔ 段位"的强度映射文档；唯一与段位相关的官方资料是 Human-SL 人类风格模仿（`preaz_20k~9d` / `rank_20k~9d`，权重 `b18c384nbt-humanv0.bin.gz` 为 v1.15.0 release 官方资产），官方明确标注其为风格模仿、非强度标定。因此绝对锚定不能依赖官方文档，主路径改为 Human-SL 本地自动对弈（全自动、可复现、无平台风险），平台人工对弈降级为可选交叉验证。

**平台强度设定调研结论**：
- 对弈：野狐（AI 陪练 1~9 段）、弈客（手机 AI 陪练段位 + 让子棋）、星阵（陪练 7 段/准 8 段/8 段，入门到职业可选）均把 AI 强度作为**对局级设置**（开局前选对手段位），没有"全局 AI 强度"设置页概念。
- 复盘/分析：星阵"AI 研究"是独立的大算力分析服务（按计算量/时长计费，强度固定拉满）；野狐绝艺 AI 复盘、弈客复盘同样固定高算力引擎；本地分析工具 Lizzie / KaTrain（KataGo 官方推荐）分析时直接调高 visits、强度独立于对弈难度。**即各平台复盘/分析一律使用"尽可能强的算力"，与分析对象无关，不暴露段位选择**。
据此简化本应用：删除设置页的 AI 强度选项；对弈强度保持局级（开局选择，不设全局默认）；复盘/分析/AI 解说/棋力评估固定使用当前引擎可达最高等级（`getStrengthCap` 上限）；全局 `aiStrength` 状态随之移除。

## What Changes
- 定义三层校准方法：L1 等级间距（ratio）、L2 模型系数（factor）、L3 绝对锚定（平台 AI / 用户锚点）。
- 定义统一校准记录表与回填规则，校准结果可追溯。
- 定义与其他对弈网站（弈城 / 野狐 / 星阵）KataGo AI 对弈的可行方式与约束。
- 扩展 `calibrate.py`：新增"相邻等级批量让子扫描 + 等级间距报告"模式，自动输出 ratio 修正建议。
- **删除设置页的"AI 强度"区块**（等级下拉 + 自定义访问量输入），强度仅在对弈页开局选择。
- **移除"自定义"档**（手动填访问量）：设置页删输入框后无处可填，保留只会留死配置。
- **复盘/分析/解说/评估固定使用引擎最强等级**：`getStrengthCap` 增加场景参数（按 `180s / SCENE_RATIO[scenario]` 折算场景预算），`analysisStore` 不再读全局 `aiStrength`，改为按该场景可达最高等级计算 visits；对弈等级保持局级（开局选择），**不**同步为全局默认。
- **移除全局 `aiStrength` 状态**：`settingsStore` 删除 `aiStrength` 状态/`setAIStrength`/`migrateAIStrength` 迁移；`gameStore` 对局内 AI 落子的等级来源改为"开局传入的局级值，未传则默认 `am1d`"。
- **分析结果实时增量更新**：后端 `KataGoAnalysis.analyze` 持续读取同一 query 的所有输出行（中间态 `isDuringSearch` 快照），逐行更新任务快照；轮询接口在 `running` 状态也返回最新结果；前端 `analysisStore`/`CommentaryPanel` 节流渲染中间快照（胜率/候选点/目差随搜索推进收敛），最终行落地为终态。**WASM 引擎同样支持流式**：worker 的 `print` 回调按行解析中间态 JSON 并实时转发 `snapshot` 消息，`onExit` 时最后一个解析行即终态（无需常驻引擎，兼容每次重建 Module 的架构）。
- 不改变等级体系结构（业余 20 级 → 职业九段），只移除 custom 档并校准参数。

## Impact
- Affected specs: 无（新增）。
- Affected code:
  - 校准：`backend/scripts/calibrate.py`（新增批量扫描模式）、`frontend/src/stores/settingsStore.ts`（按校准结果回填 ratio / factor / BASE_VISITS_AM1D）。
  - L3 Human-SL 自动化：`backend/app/services/katago_gtp.py`（`KataGoGTP` 支持 `-human-model` + humanSLProfile）、`backend/app/services/selfplay.py`（Human-SL 档位作为对弈一方）、`backend/scripts/calibrate.py`（`--human-sl` 模式）、下载 `b18c384nbt-humanv0.bin.gz` 至 `backend/katago/models/`。
  - 移除设置页强度：`frontend/src/pages/SettingsPage.tsx`（删 AI 强度区块）。
  - 移除 custom：`frontend/src/stores/settingsStore.ts`（类型/选项/迁移/customVisits）、`frontend/src/stores/gameStore.ts`、`frontend/src/stores/analysisStore.ts`（custom 分支）、`frontend/src/components/GameControls.tsx`。
  - 分析用最强等级 + 移除全局 aiStrength：`frontend/src/stores/settingsStore.ts`（`getStrengthCap` 增场景参数；删 `aiStrength` 状态与 `setAIStrength`）、`frontend/src/stores/analysisStore.ts`（改用场景最强等级）、`frontend/src/stores/gameStore.ts`（对局内强度来源改局级值 + `am1d` 兜底）。
  - 分析实时更新：`backend/app/services/katago_analysis.py`（读全部中间行）、`backend/app/api/v1/analysis.py`（running 时返回最新快照）、`frontend/src/engines/localEngine.ts`（轮询时透出中间结果）、`frontend/src/workers/katago.worker.ts`（print 回调按行转发快照）、`frontend/src/engines/wasmEngine.ts`（snapshot 消息路由）、`frontend/src/stores/analysisStore.ts`（节流更新）、`frontend/src/components/CommentaryPanel.tsx`（渲染收敛中的胜率/候选点）。
- 依赖: 后端自对弈服务 `backend/app/services/selfplay.py` 与接口 `/engine/calibrate` 已实现 ✓；本机已安装模型 b10c384h6 / b10c512h8 / b11c768h12 ✓。

## ADDED Requirements

### Requirement: 三层校准方法
校准计划 SHALL 覆盖三层：L1 等级间距、L2 模型系数、L3 绝对锚定，每层定义输入、方法、输出与验收标准。

#### Scenario: L1 等级间距校准（ratio）
- **WHEN** 对同模型内相邻等级档（如业余 2 段 vs 业余 3 段）用 `calibrate.py --handicap-scan` 让子扫描
- **THEN** 得到"让 N 子时黑胜率≈50%"的均势让子数 d，据此判定两档实际棋力差（以子计）
- **AND** 相邻段位的 ratio 步长被校准到"相邻段差 1 子"（传统段位观，参照星阵"相邻段格差 1 子"）

#### Scenario: L2 模型系数校准（factor）
- **WHEN** 对两个模型（如 b11c768h12 vs b10c512h8）同等级同 visits 做跨模型自对弈（双进程）
- **THEN** 测出两模型实际棋力差（子），factor 按差值调整（差 1 子 → factor 按经验倍率 ×8 修正）

#### Scenario: L3 绝对锚定
- **WHEN** 获得至少一个"等级档 ↔ 真实段位"锚点（用户锚点或平台 AI 对弈）
- **THEN** 调整 `BASE_VISITS_AM1D` 使该等级档对应目标段位，其余等级由 L1/L2 相对关系推出

---

### Requirement: 校准记录表
校准过程 SHALL 按统一记录表记录，保证数据可追溯、可复现。记录字段 SHALL 包括：日期、模型 A/B、visits A/B、对应等级 A/B、棋盘大小、贴目、让子数、盘数、黑胜率、均势让子数、结论与备注。

#### Scenario: 记录一次校准
- **WHEN** 执行任何一次校准对弈
- **THEN** 结果按记录表格式落盘（`backend/calibration/` 目录下按日期命名），包含全部字段

#### Scenario: 校准耗时可控
- **WHEN** 校准任务数量较多（L1 五档相邻对 + L2 三模型两两）
- **THEN** 计划表给出耗时预估与调参选项（棋盘大小 / 每档盘数 / 让子扫描上限 / 只校关键档），执行者可压缩时间换取精度，且记录表备注实际耗时
- **AND** L1 首轮用 9 路预扫定级（快、发现显著偏差），再对可疑档 19 路复核，避免低 visits 档快速 resign 污染胜率数据

---

### Requirement: L3 自动化绝对锚定（Human-SL 本地对弈）
校准计划 SHALL 以**全自动**方式完成绝对锚定，不依赖人工平台对弈。主路径：下载官方 Human-SL 权重（`b18c384nbt-humanv0.bin.gz`，KataGo v1.15.0 release 资产），扩展本地引擎以 `-human-model` + `humanSLProfile`（`preaz_20k~9d` / `rank_20k~9d`）启动，让本地引擎各等级档与 Human-SL 各段位档自对弈（让子扫描），自动建立"本地等级 ↔ 段位标签"映射，据此调整 `BASE_VISITS_AM1D`。平台人工对弈降级为可选增强（不阻塞锚定）。社区经验锚点作为即时兜底。

#### Scenario: 全自动建立等级↔段位映射
- **WHEN** 本地引擎各等级档（b11c768h12 × 若干 visits）与 Human-SL 各段位档（如 rank_5k / rank_1k / rank_1d / rank_3d / rank_6d）自对弈（让子扫描）
- **THEN** 得到"本地 X visits ≈ Human-SL Y 段"的均势让子映射表，自动推出 `BASE_VISITS_AM1D` 建议值

#### Scenario: 精度局限被明确标注
- **WHEN** Human-SL 映射结果落盘
- **THEN** 记录表标注官方限制（Human-SL 为风格模仿、非强度标定，段位标签为模仿目标而非实测棋力），锚定精度以低段位（20k~9d 范围内）相对可靠，高段位（职业）仅作方向性参考

#### Scenario: 平台人工对弈为可选增强
- **WHEN** 用户愿意投入人工时间在平台（野狐/弈客/星阵）与 KataGo AI 对弈
- **THEN** 结果作为 Human-SL 映射的交叉验证补充；未做平台对弈不阻塞 L3 完成

---

### Requirement: 校准工具批量扫描
`calibrate.py` SHALL 新增"相邻等级批量扫描"模式：输入等级序列与模型，自动对每对相邻等级做让子扫描，输出等级间距报告（每档均势让子数 + ratio 修正建议）。

#### Scenario: 批量生成间距报告
- **WHEN** 运行 `python scripts/calibrate.py --plan <模型> --levels 业余1段 业余2段 ... --games 4`
- **THEN** 输出每对相邻等级均势让子数表格，并给出 ratio 步长修正建议

---

### Requirement: 参数回填与验证
校准结果 SHALL 回填到等级体系参数，并做验证对弈确认等级一致性。

#### Scenario: 回填后验证
- **WHEN** ratio / factor / BASE 按校准数据更新后
- **THEN** 重新对相邻等级做让子扫描，均势让子数应接近目标值（相邻段差 1 子）

---

### Requirement: 移除设置页 AI 强度选项
设置页 SHALL 不再提供"AI 强度"区块（等级下拉与自定义访问量输入）。强度仅在对弈页开局选择。

#### Scenario: 设置页不再显示强度
- **WHEN** 用户打开设置页
- **THEN** 页面不显示"AI 强度"下拉与自定义访问量输入，其余设置（引擎/模型/棋盘样式/解说配置）不变

---

### Requirement: 移除自定义档
等级体系 SHALL 移除"custom"档。旧持久化值 `custom` 迁移为业余 1 段（`am1d`），`customVisits` 字段不再使用。

#### Scenario: 旧配置迁移
- **WHEN** 用户曾将 AI 强度设为自定义并保存
- **THEN** 升级后默认强度为业余 1 段，无残留死配置

---

### Requirement: 复盘/分析/解说/评估固定使用引擎最强等级
复盘/分析/AI 解说/棋力评估 SHALL 固定使用当前引擎可达的最高等级，不随对弈选择的等级变化，也不暴露等级选择 UI。对弈等级保持局级选择，不设全局默认。

#### Scenario: 分析使用最强等级
- **WHEN** 用户在任何对弈页对局中或加载棋谱后触发局面分析 / AI 解说 / 棋力评估
- **THEN** 分析强度为该引擎在分析场景可达的最高等级：`getStrengthCap` 增加场景参数，按 `每手预算(180s) / SCENE_RATIO[scenario]` 折算该场景时间预算后从高到低取最高可达等级（等价于"各场景每手均不超过 180 秒的极限强度"），与最近一次对弈选择的等级无关

#### Scenario: 对弈等级不影响分析
- **WHEN** 用户用业余 18 级完成一局对弈后复盘分析
- **THEN** 复盘分析仍使用引擎在该场景预算下的最强等级，而不是业余 18 级

#### Scenario: 引擎不同分析强度不同
- **WHEN** 用户在 WASM b6c96 与 Local b11c768 之间切换引擎
- **THEN** 分析强度分别按各自引擎的可达上限计算（弱引擎上限低），保证每手耗时不超过场景预算

### Requirement: 分析结果实时增量更新
分析 SHALL 支持实时增量更新：搜索期间逐步返回中间快照（胜率/候选点/目差随 visits 推进收敛），用户无需等待最终结果即可看到趋势。local 引擎经后端任务表 + 轮询实现；WASM 引擎经 worker `print` 回调按行转发快照实现。

#### Scenario: 分析过程逐步出结果
- **WHEN** 用户触发局面分析（local 引擎、最强等级）
- **THEN** 分析提交后轮询接口在 `running` 状态即返回当前最新快照（root 胜率/目差、candidates、ownership），前端节流刷新展示，无需等全部算完

#### Scenario: WASM 引擎同样逐步出结果
- **WHEN** 用户使用 WASM 引擎分析（最强等级、visits 数万）
- **THEN** worker `print` 回调收到每个中间态 JSON 行时实时转发 `snapshot` 消息，前端节流刷新；无需等 `onExit`

#### Scenario: 分析结束落地终态
- **WHEN** KataGo 输出最终行（`isDuringSearch=false`，WASM 为 `onExit` 前最后解析行）或任务完成
- **THEN** 轮询接口返回 `status=done` + 最终结果 / worker 返回 `result`，前端停止增量更新并固定终态

#### Scenario: 并发/重复查询互不串扰
- **WHEN** 用户在上一分析未完成时触发新分析
- **THEN** 新查询使用新的 query id，旧查询的中间输出不污染新结果（后端按 id 匹配行；WASM 队列串行）

### Requirement: 移除全局 AI 强度状态
全局 `aiStrength` 状态与 `setAIStrength` SHALL 被移除；`gameStore` 对局内 AI 落子的等级来源为开局传入的局级值，未传入时默认业余 1 段（`am1d`）。

#### Scenario: 对局内 AI 强度来源
- **WHEN** 用户开局选择"业余 5 段"开始对弈
- **THEN** 该局 AI 落子使用业余 5 段；分析/解说/评估仍用引擎最强等级，两者互不影响

#### Scenario: 无局级设置时的兜底
- **WHEN** 对局未传入局级 AI 等级（旧数据或异常路径）
- **THEN** AI 落子默认使用业余 1 段（`am1d`）

## MODIFIED Requirements
无。

## REMOVED Requirements
无。
