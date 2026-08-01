# 段位校准计划表（Calibration Plan）

> 目标：把前端 AI 强度档位的三组关键参数——等级倍率 `ratio`（`AI_STRENGTH_OPTIONS`）、
> 模型棋力系数 `factor`（`getModelStrengthInfo`）、绝对 visits 基准 `BASE_VISITS_AM1D`
> ——从「拍脑袋估算」校准为「实测可复现」，并锚定到真实段位标尺
> （参照星阵：**相邻段差 1 子**，即均势让子数 d=1）。
>
> 校准链路：`backend/scripts/calibrate.py`（客户端）→ `POST /api/v1/engine/calibrate`（后端）
> → `backend/app/services/selfplay.py`（KataGo 自对弈）。先启动后端，再跑脚本。

---

## 1. 三层校准方法总览

| 层 | 校准对象 | 方法 | 数据来源 | 回填目标 |
|---|---|---|---|---|
| L1 等级间距 | `ratio`（档间搜索量倍率） | 同模型内相邻档让子扫描，找「黑胜率≈50%」的均势让子数 d | `calibrate.py --plan` | `AI_STRENGTH_OPTIONS[].ratio` |
| L2 模型系数 | `factor`（模型棋力系数） | 跨模型同等级同 visits 双进程对弈，测模型间棋力差（子） | `calibrate.py`（跨模型 + `--handicap-scan`） | `getModelStrengthInfo().factor` |
| L3 绝对锚定 | `BASE_VISITS_AM1D` | 本地引擎 vs Human-SL 本地自动对弈，建立「本地等级 ↔ 段位标签」映射 | L3 操作手册（第 4 节） | `BASE_VISITS_AM1D` |

三层相互独立、可分别执行；L1/L2 建立**相对间距**，L3 提供**绝对锚点**，合起来得到完整的
「等级 → 绝对 visits」标尺。

---

## 2. 校准方法详述

### 2.1 L1 等级间距（ratio）：同模型相邻档让子扫描

**原理**：同模型内，相邻等级档（如 `am1k`/`am1d`）按 `visits = BASE_VISITS_AM1D × ratio × factor`
换算成不同搜索量后互相对弈。让子扫描找「黑胜率 ≈ 50%」的均势让子数 d，d 即相邻段差，
目标 **d = 1**（相邻段差 1 子，参照星阵）。低等级固定执黑（黑方先摆子）。

**执行步骤（两段式，避免低 visits 档快速 resign 污染数据）**：

1. **首轮 9 路预扫**：对等级序列的每对相邻档跑 `--plan`，每档 2 盘、扫描 0~2 子，粗筛出
   均势让子数明显偏离 1 的「可疑档对」。
   ```bash
   python backend/scripts/calibrate.py --plan b11c768h12 \
       --levels am1k am1d am2d am3d --games 2 --size 9 --scan 2
   ```
2. **可疑档对 19 路复核**：对预扫中 d≠1 的档对单独复核，每档 4 盘、扫描 0~3 子。
   ```bash
   python backend/scripts/calibrate.py --plan b11c768h12 \
       --levels am1k am1d am2d am3d --games 4 --size 19 --scan 3
   ```
3. 汇总表输出「等级对 | 均势让子数 | ratio 修正建议」，按第 6 节回填。

**注意事项**：
- 低 visits 档（visits < ~100，即 `am6k` 以下）引擎极易快速 resign，数据不可靠，仅作 9 路粗筛，
  正式 L1 建议从 `am1k` 起步。
- 单盘方差大：每档盘数 ≤ 2 时结论只作方向参考；定值至少 4 盘，可疑档加到 8 盘。
- 让子棋 `komi` 保持 0（默认），`black_side` 固定弱方执黑（`--plan` 已内置）。

### 2.2 L2 模型系数（factor）：跨模型同等级同 visits 对弈

**原理**：同一等级（相同目标棋力）在不同模型上所需 visits 不同——模型越强（factor 越小）、
所需 visits 越少。跨模型对弈测出模型间实际棋力差（子），据此修正 factor。

**执行**：两两模型同 visits（如 1000）对弈，`--handicap-scan` 找均势让子数 d（经验：**差 1 子
→ 高棋力模型 factor 约 ×1/8**，即每强 1 子，同级棋力所需 visits 约为弱模型的 1/8）：
```bash
python backend/scripts/calibrate.py --model-a b10c384h6 --model-b b11c768h12 \
    --visits-a 1000 --visits-b 1000 --handicap-scan 3 --games 4
```
两模型应为**同一等级**（前端 `maxStrength` 都允许的等级，如 `am3d`）各自换算 visits 后对弈，
得到的 d 反映「factor 表与真实棋力」的偏差；将实测 d 与 1 对齐即可修正 factor。

**待测组合**：本机三模型两两（b10c384h6 / b10c512h8 / b11c768h12）共 3 对。

### 2.3 L3 绝对锚定：Human-SL 本地自动对弈

**原理**：用 KataGo 官方 Human-SL 权重（模仿人类段位风格）作为「段位标尺」，
与本地引擎各等级档自对弈，把「本地等级 ↔ 段位标签」映射出来，从而推出
`BASE_VISITS_AM1D`（业余 1 段所需绝对 visits）建议值。主路径见第 4 节操作手册。

**可选交叉验证（不阻塞锚定）**：野狐 / 弈客 / 星阵平台人工对弈验证映射。
**即时兜底锚点**：社区经验「b10c128 约 1000~2000 visits ≈ 业余 1 段」→
`BASE_VISITS_AM1D = 3000 × factor(b10c128) = 1200` 与锚点吻合，当前 3000 可作初始值。

### 2.4 错误注入精确档位（KaTrain 盲注式，WASM 已落地）

**实测结论（P7b，`2026-08-01-p7b.md`）**：纯 visits 无法把 KataGo 网络棋力压到人类
低级区间——b6c96 让 2 子仍 100% 全胜、无均势点。低 visits 只降搜索深度，
policy 基本棋感仍在，模拟不出人类低级错误模式。

**方案（KaTrain 式错误注入）**：不依赖「压 visits」降棋力，改为强引擎（任意 visits）+
按等级概率替换选点。本项目落地为 KaTrain **盲注式（Blinded Policy）**
（`ai:p:rank` RankStrategy；n_moves 公式与 override 阈值均来自 KaTrain 的
OGS 真人对弈校准）：每手从全部合法着法中**随机抽 n_moves 个点**（级数越大视野越窄），
再从抽中的点里选 policy 最高者；当局面明朗（最优 policy 超阈值 / 前二合计超阈值 /
pass 进 top5）时直接走最优——模拟低级棋手「看不清局面，但明显正着也会下」。

**实现位置**：`frontend/src/lib/rankInjection.ts`（纯函数，含合法着法/打劫过滤）+
`WasmEngine.genmove`。**WASM（b6c96）19 路对弈档位为 am20k~am5d 全部等级**，
kyuRank 由档位 id 推导（amXk→X、amXd→1-X，上限 5 段 = KaTrain OGS 校准可靠范围，
6 段及以上不注入）；9/13 路不注入（公式按 19 路校准，小棋盘失真）。

**对弈耗时（行业做法，KataGo/KaTrain 同款）**：盲注选点只看 policy
（1 visit 即有完整 policy），搜索量与棋力解耦——对弈档位统一低搜索量
（`INJECTION_MAX_VISITS=32`）保证任意档位每手约 5~11s（重建 3~5s + 搜索 2~6s），
查询带 KataGo 官方 `maxTime`（20s）兜底防慢设备卡死；不按局面复杂度自研分段
（KataGo GTP 的 searchFactorWhenWinning 等自适应参数仅 GTP 模式可用，analysis 模式无）。
分析与复盘不走 genmove，天然不受注入影响。

**验证（P7a 全档扫描，遗留可选后续）**：对全档位抽样（am20k~am5d）与 Human-SL
rank 标尺重跑让子扫描（需让 5~7 子），确认各档均势点对应具体级别；有偏差时调 kyuRank。

### 2.5 WASM 测速口径修正（差分测速，2026-08）

**问题**：旧 benchmark 用单次 20 visits 的总耗时折算 visits/s，而 WASM 每次分析都要
重建 Emscripten Module（3~5s）+ 模型初始化，固定开销把 20 visits 摊到 4~7 秒，
测出个位数 visits/s——严重低估真实搜索速度，导致 `getStrengthCap` 可达等级失真。

**修正**：`frontend/src/engines/benchmark.ts` 改为差分测速——每组采样跑 20v / 240v
两次分析，`速度 = Δvisits / Δ耗时`（`T(v) = F + S×v` 中固定开销 F 被相减消除），
得到纯搜索速度（9 路实测为数十 visits/s 量级，19 路约为其一半）。
`getStrengthCap` / 分析场景可达等级自动按真实速度折算。

---

## 3. 校准记录表格式与落盘规范

每次校准落一个 markdown 文件到 `backend/calibration/`，按日期 + 层级命名，
如 `2026-08-01-l1.md`，包含一次校准的完整记录（可复现的命令 + 逐档结果 + 结论 + 耗时）。

**记录表字段**：

| 日期 | 模型 A | visits A | 对应等级 A | 模型 B | visits B | 对应等级 B | 棋盘大小 | 贴目 | 让子数 | 盘数 | 黑胜率 | 均势让子数 | 结论 | 备注（含实际耗时） |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-08-01 | b11c768h12 | 389 | am1k | b11c768h12 | 540 | am1d | 9 | 0 | 1 | 4 | 52% | 1 | 段差合理 | 预扫 12 分钟 |

**文件模板**：

```markdown
# 2026-08-01 L1 校准记录（b11c768h12，9 路预扫）

- 命令：`python backend/scripts/calibrate.py --plan b11c768h12 --levels am1k am1d am2d --games 2 --size 9 --scan 2`
- 环境：KataGo v1.17.0 · 本机 ~1900 visits/s（b11c768h12）
- 总耗时：约 20 分钟

| 等级对 | visits 低→高 | 均势让子数 | 黑胜率 | 结论 | 备注 |
|---|---|---|---|---|---|
| am1k→am1d | 389→540 | 1 | 52% | 段差合理 | 无需复核 |
| am1d→am2d | 540→729 | 0 | 48% | 差距偏小，待 19 路复核 | 复核查 d |

- 结论摘要：……（下一步动作）
```

---

## 4. L3 自动化锚定操作手册（Human-SL 本地对弈主路径）

### 4.1 权重下载

官方 Human-SL 权重随 KataGo v1.15.0 release 发布（README.txt 有明确指引）：

```bash
# 下载到 backend/katago/models/
curl -L -o backend/katago/models/b18c384nbt-humanv0.bin.gz \
  https://github.com/lightvector/KataGo/releases/download/v1.15.0/b18c384nbt-humanv0.bin.gz
```

### 4.2 启动方式与 humanSLProfile

```bash
backend/katago/katago.exe gtp \
  -model <常规模型，如 b11c768h12.bin.gz> \
  -human-model b18c384nbt-humanv0.bin.gz \
  -config <gtp_human5k_example.cfg 类似配置>
```

配置要点（参考 `backend/katago/gtp_human5k_example.cfg`）：
- `humanSLProfile`：可选 `preaz_20k~9d` / `rank_20k~9d`（模拟对应段位人类风格）。
  - `rank_5k/1k/1d/3d/6d` 即推荐的锚定档位；
  - `preaz_*` 为 AlphaZero 开局流行前的旧风格，一般用 `rank_*`。
- 纯风格模仿时 `humanSLChosenMoveProp = 1.0`，此时**增加 visits 不提高强度**，
  搜索仅用于 pass/resign 判断——自对弈时给 Human-SL 侧留 40 左右 visits 即可。

**重要声明（官方标注）**：Human-SL 是**风格模仿、非强度标定**——段位标签是「模仿目标」，
不是「实测棋力」。低中段位（约 20k~5d）相对可靠，职业高段（6d 以上）仅方向参考，
不用于精确锚定。

### 4.3 执行流程

1. **前置扩展**：当前 `backend/app/services/katago_gtp.py` 的 `KataGoGTP` 启动参数
   （`katago gtp -model … [-config …]`）**不支持 `-human-model`**，自对弈链路
   `selfplay.py` 也未接入 Human-SL。执行 L3 前需先扩展：
   - 给 `KataGoGTP.__init__` 增加 `human_model` / `human_config` 参数，启动命令追加
     `-human-model <human权重> -config <human配置>`；或
   - 写一个手工 GTP 对弈脚本（两个 `katago gtp` 子进程互发 `genmove`/`play`）。
2. 本地引擎各等级档（b11c768h12 × 若干 visits，如 am1k~am6d 档）与 Human-SL 各段位档
   （rank_5k / 1k / 1d / 3d / 6d）做让子扫描（复用 L1 的扫描方法，Human-SL 一侧固定
   `humanSLProfile`），找「本地等级 ↔ 段位标签」均势点。
3. 汇总映射表（示例）：

   | 本地档（b11c768h12） | visits | 均势 Human-SL 段位 | 结论 |
   |---|---|---|---|
   | am1d | 540 | rank_1d | 吻合，BASE_VISITS_AM1D ≈ 3000 |
   | am3d | 972 | rank_3d | 吻合 |
   | am6d | 2268 | rank_5d | 高段仅方向参考 |

4. 推出 `BASE_VISITS_AM1D` 建议值：以「am1d 档 ↔ rank_1d」均势的 visits 反推
   `BASE_VISITS_AM1D = visits_am1d / factor(b11c768h12)`，落盘为 L3 校准记录（`2026-08-01-l3.md`）。

### 4.4 可选交叉验证与兜底

- **平台人工对弈**（野狐 / 弈客 / 星阵）：抽取 2~3 个映射点与真人段位对弈复核，
  不阻塞主路径。
- **社区经验锚点**：b10c128 约 1000~2000 visits ≈ 业余 1 段，用作即时兜底
  （当前 `BASE_VISITS_AM1D=3000` 与该锚点一致）。

---

## 5. 耗时预估

**估算公式**：每盘耗时 ≈ 手数（约 200，9 路约 100）× 每手耗时（= visits ÷ 本机 visits/s）。

本机基准（RTX 3060 Laptop，KataGo v1.17.0，OpenCL tuned）：
**b11c768h12 ≈ 1900 visits/s**。示例：am1d(540v) 每手 0.28s → 每盘约 56s；
am3d(972v) 每手 0.5s → 每盘约 100s；am6d(2268v) 每手 1.2s → 每盘约 240s。

一对相邻档每盘耗时 ≈ `100 × (v_lo + v_hi) / 1900`（黑白各约 100 手），
一对总耗时 = 每盘 ×（scan+1）× games。

### 5.1 L1 预估总耗时（b11c768h12，19 路，每档 4 盘，扫描 0~3 子 → 每对 16 盘）

visits 表（factor=0.18）：am1k=389 · am1d=540 · am2d=729 · am3d=972 · am4d=1296 ·
am5d=1728 · am6d=2268 · am7d=2970 · pro1d=3780 · pro2d=4860 · pro3d=6210 · pro4d=7830 ·
pro5d=9720 · pro6d=11880 · pro7d=14580 · pro8d=17820 · pro9d=21600。

| 相邻档对 | 每盘（s） | 每对 16 盘（约） | 相邻档对 | 每盘（s） | 每对 16 盘（约） |
|---|---|---|---|---|---|
| am1k→am1d | 49 | 13 分 | pro2d→pro3d | 583 | 2.6 小时 |
| am1d→am2d | 67 | 18 分 | pro3d→pro4d | 739 | 3.3 小时 |
| am2d→am3d | 90 | 24 分 | pro4d→pro5d | 924 | 4.1 小时 |
| am3d→am4d | 119 | 32 分 | pro5d→pro6d | 1137 | 5.1 小时 |
| am4d→am5d | 159 | 42 分 | pro6d→pro7d | 1393 | 6.2 小时 |
| am5d→am6d | 210 | 56 分 | pro7d→pro8d | 1705 | 7.6 小时 |
| am6d→am7d | 276 | 74 分 | pro8d→pro9d | 2075 | 9.2 小时 |
| am7d→pro1d | 355 | 95 分 | | | |

> 职业档单对即数小时，**只校关键档**（am1k~am6d 约 3.5 小时）即可满足前端默认对局/评估范围；
> 9 路预扫每对约 2~6 分钟，用于先筛出可疑档对。

### 5.2 L2 预估总耗时（三模型两两，同 1000 visits，双进程并行）

双进程共用 GPU，耗时不叠加、以慢模型为瓶颈（visits/s 为估算，跑前用 benchmark 实测）：

| 模型对 | 慢模型 visits/s | 每盘（s） | 16 盘/对（约） |
|---|---|---|---|
| b10c384h6 vs b10c512h8 | ~3000 | 67 | 18 分 |
| b10c384h6 vs b11c768h12 | ~1900 | 105 | 28 分 |
| b10c512h8 vs b11c768h12 | ~1900 | 105 | 28 分 |

三对合计约 **1.2 小时**。

### 5.3 调参选项

| 参数 | 选项 | 效果 |
|---|---|---|
| `--size` | 9 / 19 | 9 路手数约减半、每盘更快，预扫用；19 路定值 |
| `--games` | 2 / 4 / 8 | 2 盘粗筛方向，4 盘定值，8 盘压噪声（耗时应倍） |
| `--scan` | 2 / 3 / 5 | 覆盖目标段差 1 子，2~3 足够；可疑档加宽 |
| 只校关键档 | 挑 am1k~am6d | 覆盖前端默认范围，避开职业档数小时单对 |
| 低 visits 档 | 跳过或仅 9 路 | <100v 时 resign 频发，数据不可用 |

---

## 6. 回填规则与验证

| 数据 | 回填位置 | 说明 |
|---|---|---|
| L1 均势让子数 | `frontend/src/stores/settingsStore.ts` 的 `AI_STRENGTH_OPTIONS[].ratio` | 同步 `backend/scripts/calibrate.py` 内 `LEVEL_RATIO` |
| L2 实测棋力差 | `getModelStrengthInfo()` 的 `factor` | 同步脚本内 `_MODEL_FACTORS` |
| L3 锚定结果 | `BASE_VISITS_AM1D` | 脚本内同名常量同步 |

**回填步骤**：
1. L1：按「均势让子数 d」修正相邻档 ratio（d=1 不动；d>1 缩小高档 ratio；
   d=0 放大高档 ratio，公式见脚本 `ratio_advice`：目标 `r' = r_lo·(r_hi/r_lo)^(1/d)`）。
2. L2：跨模型棋力差 d 子 → 高棋力模型 factor ≈ ×(1/8)^d 修正。
3. L3：按「am1d ↔ rank_1d」均势 visits 反推 `BASE_VISITS_AM1D`。
4. **回填后重新让子扫描验证**：相邻段均势让子数应接近 1 子；不收敛则再迭代一轮 L1/L2。

---

## 7. P7 档位验证执行说明（Human-SL 引擎化后）

> 2026-08 架构变更：Local 对弈低中档（am20k~am7d）改用 Human-SL 官方 rank 标尺（零校准），
> 强度参数单一来源为 `shared/ai-strength.json`（前端 settingsStore / 后端 calibrate.py / selfplay 同源）。
> 本节验证 Human-SL 档位梯度与 b6c96 能力边界，结果落盘 `backend/calibration/`。

### 前置
- 启动后端（`launcher.bat` 或 `uvicorn app.main:app --port 8000`）
- 模型：`b11c768h12.bin.gz`、`b18c384nbt-humanv0.bin.gz`（Human-SL）、`b6c96.txt.gz`（WASM 文本模型，
  从 `frontend/public/wasm/b6c96.bin.gz` 复制后改扩展名；KataGo 按扩展名识别格式，.bin.gz 会解析失败）

### P7a：Local Human-SL 档位梯度抽样验证
本地档 vs 正常引擎同档让子扫描，确认官方 rank 标注与 visits 换算一致（偏差 ≤1 子）：
```bash
python backend/scripts/calibrate.py --api http://127.0.0.1:8001/api/v1 \
    --model-a b11c768h12 --model-b b11c768h12 \
    --visits-a <amX 档 visits> --visits-b <同档 visits> \
    --handicap-scan 3 --games 4 --size 19
```
抽查档位：am5k/am1k/am1d/am3d/am5d（visits = 3000 × ratio × factor，见 `level_visits`）。
锚点校验：星阵对照表（1K=1300、业1=1400、18K 以下 <460 Elo）。

### P7b：b6c96 能力边界测试（WASM 唯一模型，必做）
b6c96 各简化档 visits vs Human-SL rank_5k/1k/1d/3d 让子扫描：
```bash
# 例：b6c96@3000v（约 1 段档）vs rank_1k
python backend/scripts/calibrate.py --api http://127.0.0.1:8001/api/v1 \
    --model-a b6c96 --model-b b6c96 --visits-a 3000 --visits-b 0 \
    --human-sl b18c384nbt-humanv0.bin.gz --human-sl-side b \
    --human-sl-profile rank_1k --handicap-scan 3 --games 4 --size 19
```
五档 visits：am18k=18 / am10k=180 / am4k=960 / am1d=3000 / am3d=5400。
重点：
- 修正 WASM 简化档位「约」标签（预期「大师（约3段）」可能名不副实——b6c96 为早期 6 层模型）
- 验证 maxStrength=am3d：5400v 若打不过 rank_3d 则下调上限（同步 `shared/ai-strength.json`）
