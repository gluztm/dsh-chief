# Changelog

All notable changes to **`dsh-chief`** (**DSH 参谋长**) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] - 2026-11-19

### Added

#### 🧱 全会话事前物理驻墙与独立安全内核 (`pkg/safety/` + `tools/pre-execute`)
- **事前物理硬拦截**：主对话、子代理与参谋调用文件或命令落地前统一经过 `tools/pre-execute` 门禁，撞墙直接拒止并写入 `chief-audit.jsonl`。
- **随身复用的动态物理墙**：边界页新增「🧱 物理驻墙」（持久化于 `~/.dsh/chief/guard-walls.json`），支持 `global`（跨窗口自动跟随）/ `workspace`（仅本工程）/ `paused`（暂挂备用）一键切换。
- **大白话手搓与同类合并**：对参谋说白话即可生成 `wallProposals` 草案（人工确认后落锁），支持多选或一键合并相同 `ruleType` 的物理墙（跨类型混选自动拦截）。
- **9 模块独立安全内核**：将硬守卫、命令拆解、路径穿透检测、能力引擎与审计拆为 `pkg/safety/` 9 个零业务依赖模块，与 `chief-executor.js` 全集 MD5 锁定。

#### 🤝 参谋懒介入协同、无感问询与自动续跑 (`chief-commands.js` + `chief-state.js`)
- **主对话优先（懒介入）**：高权限下只要未点名让参谋亲自操刀，工作区改动与命令统一发 `[EXECUTION_REQUEST]` 委派 `@lead` 动手，绝不冒充用户发言。
- **空白新窗口先探路定计划**：新开空白会话直接找参谋时，默认先引导 `@lead` 只读看代码 → `graph.plan` 排计划 → `chief.request` 汇报结论。
- **后台优先问询零打断**：参谋缺细节时经 `agent/pre-step` 递出 `[INQUIRY #id]`，主对话顺手调 `inquiry.reply` 秒回后继续原工作，不打断当前步骤。
- **审批/提权后自动续跑 (`TaskLedger`)**：点完「允许」后按持久化账本自动接上未走完的步骤；异常重启时自动将半途任务安全置为 `interrupted`，不偷偷重跑。

#### 🔒 细粒度能力模型与只紧不松策略 (`policy-engine.js` + `policy-plugin.js`)
- **`role + capabilities` 双层解耦**：界面保持 `advisor / assistant / strategist / chief` 四档，底层放开 `assistant` 低风险看板与档案整理免弹窗，依然严锁文件写入。
- **单次授权防复用与只紧不松插件**：逐项授权绑定目标路径/命令 `capabilityScope`；可选 `policyPlugins` 仅允许收紧规则，试图关闭硬守卫的配置直接拒绝。

### Changed
- **前后台流光舞台提示 (`activeWork`)**：参谋在前台或后台自动巡检、收档、维护边界或刷摘要时，面板自动切页并点亮流动渐变 + 双束光线边框与毛玻璃跃动字提示。
- **强介入双防线核对窗 (`InterventionConfirmModal`)**：开启前并排核对当前生效的「🧱 物理驻墙」与「🚫 禁止红线」，右上角改为「管理边界」并支持一键收起/拉开。
- **问答分组框、红盾哨兵与顺势刷摘要**：每轮提问与回执包进高对比分组外框并支持一键折展，按钮统一靠右下对齐；「🛡 红线哨兵」开启时变红并点亮双层红盾图标；每次聊完按 60 秒节流后台顺势刷新顶部摘要。

### Fixed
- **适配 DSH `0.2.2-rc.5` 原生工具与弹窗审批**：对齐 `dsh-tool-fs`（`read` / `read_image` / `write` / `edit` / `apply_patch`），修复仅禁写路径墙误拦 `str_replace_editor` 只读 `view` 模式的问题，接入 `tools/pre-execute` 原生 `{ kind: 'ask' }` 单次审批弹窗，并兼容多代际 `session(.vN).jsonl(.zstd)` 日志检索。
- **封堵复合管道、内联脚本与多反斜杠凭据变形**：补齐 `&& / || / | / ;`、嵌套 Shell、`node -e / python -c / pwsh / iex`（含 Base64）及引号多反斜杠绕过（如 `copy x ".\\"env`），对 `node .\env\setup.js`、`process.env.NODE_ENV` 与 `$env:TEMP` 保持 0 误杀；`bounds.*` 与驻墙删改强制校验 `HUMAN_BOUNDS_CONFIRM_TOKEN`。

## [1.3.0] - 2026-11-18

### Added

#### 🧩 模块化低耦合架构与双版本 CI (`ARCHITECTURE.md` + `build-client.mjs`)
- **前后端模块化拆分**：将 4 个超长单体文件拆为 **29 个后端模块 + 16 个前端源码模块**，`index.js`、`chief.js`、`archives.js`、`client.js` 公开导出保持 100% 兼容。
- **静态边界与双版本门禁**：强制零 `export let/var` 可变导出、零循环依赖，新增 GitHub Actions Node `22 / 24` 自动门禁。

#### 🔄 审批续跑、独立审计与对话流筛选 (`chief-executor.js` + `chief-state.js`)
- **点完允许自动接着跑 (`resumeTasks`)**：点击「允许本次操作」或完成提权后，按 30 分钟 TTL 与深度熔断自动续接未走完的多步任务，拒绝或超时自动取消不空转。
- **独立只追加审计账本 (`chief-audit.jsonl`)**：权限判定、放行/拒绝与安全拦截统一追加写入 `~/.dsh/chief/chief-audit.jsonl`，不受状态文件截断影响。
- **顶栏版本号与对话流筛选**：标题栏常驻显示当前版本徽章（`v1.3.0`）；参谋页支持 `全部 / 💬 问答 / 📋 回执` 筛选，待定建议统一收拢至顶部「`▶ 执行建议`」。

### Changed
- **跨进程与多线程文件锁加固 (`O_EXCL`)**：`board-store.js`、`chief-state.js`、`archive-core.js` 引入 `threadId` 唯一临时文件与 Windows NTFS `EPERM / EACCES / EBUSY` 随机抖动自旋重试，消除高并发丢写。
- **模型上下文窗口异步回写 (`subagent-runtime.js`)**：兼容同步与异步 `resolveModelInfo` 查询，及时缓存并刷新会话 Token 窗口统计。

### Fixed
- **命令与路径安全卫兵反混淆 (`chief-executor.js`)**：检查前统一执行 NFKC 规范化、PowerShell `-EncodedCommand` 解码、引号拼接与 `^` 插入符折叠；拦截越界写入、凭据符号链接与 NTFS ADS 流（如 `safe.txt:.env`）；待批操作绑定 SHA-256 `payloadHash`，同源 `guard()` 异常默认返回 `403`。
- **修复关闭右侧栏后每 3.2 秒自动弹回**：区分首次启动自动展开与用户手动收起状态，底部入口点击恢复真实折叠/展开（Toggle）。
- **修复档案页「一键收纳入柜」漏收与不刷新**：补齐会话看板、根会话看板与共享便签三路收纳，疑似密钥自动 `[REDACTED]` 脱敏入柜，并即时同步前端分柜计数。

## [1.2.1] - 2026-11-17

### Added

#### 🛡️ 四档会话权限与逐项操作授权 (`chief-executor.js`)
- **四档会话权限**：`advisor`（只读 · 默认）/ `assistant`（助手）/ `strategist`（逐项授权）/ `chief`（高自主）。
- **新会话一律只读起步**：新开窗口与跨窗投递进来的会话统一落在 `advisor`，只观察、只分析、只给方案，不改工作区、不打断主对话。
- **受控操作先弹窗**：改文件、跑命令、调子代理工作流前强制弹出「🛡️ 操作授权请求」，写明做什么 / 改谁 / 为什么 / 有什么影响。
- **单次授权不放永久权**：只有亲手点「允许本次操作」才执行；权限不够时模型主动打报告申请提权，不会自行升档。
- **提权申请闭环**：新增 `request_permission_elevation` 执行工具与 `chief_board permission.request` 动作，弹窗展示申请方、原因与目标档位，高自主档申请时可选择只提到逐项授权档。
- **旧配置自动降级**：未经风险勾选校验的旧版或异常配置一律回落到 `advisor`。

#### 🔒 统一安全流水线与审计日志
- **6 级流水线**：`用户模式 → 操作请求 → 安全卫兵硬性规则 → 权限判定 → 执行器 → 审计日志`。
- **红线对全档位硬兜底**：删库、`git reset --hard`、`.env` 与密钥泄露、全局禁止红线不因放权而松开。
- **高自主档先读风险**：进入前强制弹出「⚠️ 高权限模式风险告知」并勾选确认，后端复核 `confirmedChiefRisk === true`，切回低档或新建对话后自动失效。
- **全程留审计账本**：权限判定与执行结果均写入会话审计日志，支持前端弹窗检索。
- **随时急停**：输入栏红色 `⏹ 急停` 一键切断后台自驱，回到人工接管。

### Changed
- **`⚡ 主动强介入` 随档位差异化**：
  - `advisor`：仅只读巡检诊断与建议输出，不改写工作区，不注入 `@lead` 强推指令。
  - `assistant`：仅自动维护参谋记忆、档案与建议卡，不干预主对话执行流。
  - `strategist`：每轮强介入产生的关键受控动作、递话与压缩均队列化，逐条弹出授权请求，允许后单次执行。
  - `chief`：高自主闭环督导（直控主对话与子代理、纠偏、压缩前抢救与 `auto-continue.js` 续跑），配合死循环熔断与人工结项门禁。

### Fixed
- **修复「🚀 新建窗口并部署参谋长」按钮在深色与标准主题下发白看不清文字**：原 `--dnb-accent` 绑定宿主 `--dsw-alias-brand-primary`（标准深色主题下接近白色 `#f9fafb`），白字按钮对比度崩掉；现改用 `--dsw-alias-state-business-primary` 并引入独立的 `--dnb-primary-bg` / `--dnb-primary-fg` 高对比主按钮令牌，同时补齐暗色 `<select option>` 下拉配色。
- **修复「🚀 新建窗口并部署参谋长」创建会话未绑定当前 `workspaceId`、不自动跳转新窗**：`transferChief('create')` 现会继承当前会话工作区，前端同时兼容 `sessions.open(created)` 切换视图。

## [1.2.0] - 2026-11-16

### Added

#### ✦ 许愿框一站式执行器与四档权限门禁 (`chief-executor.js`)
- **内置多步实权工具循环**：用户可在右侧「✦ 许愿框」一句话直达查改工作区文件、目录搜索、运行安全命令、维护看板、整理档案与主动触发压缩。
- **四档精细权限控制**：支持 `read-only`（仅可查看）、`workspace-write`（工作区内修改）、`auto-review`（自动审查 EXP）与 `danger-full-access`（完全权限）。
- **空白新对话开场即战力**：无历史对话时也能主动定位工作区并下场勘察，无需等主对话先发送消息。
- **空白新对话待领交接暂存**：在空白上下文中拆发指令给尚未创建的 `@lead` 时，自动调用 `stagePendingTransfer` 写入 `pending-transfer.json`，主对话首轮发送即自动衔接。

#### 🏛️ 三层 0-Token 档案金库与双向差分
- **💬 本会话档案柜 (`session`)**：按 `rootSessionId` 实现 1:1 严格会话隔离，仅用户、当前会话代理与参谋长可见。
- **🌐 系统全局档案柜 (`global`)**：系统级 0-Token 冷库（`global-vault/vault-chief-global.json`），默认不随会话自动挂载，绝不自动迁移旧版遗留档案。
- **⇄ 本地 ↔ 全局实时双向差分**：自动标记「仅本地 / 已同步 / 本地已改 / 全局独有」差异，支持一键 `⤵️ 引入本会话`、`提炼入全局` 与增量覆盖更新。
- **🏛️ 沉淀档案柜 (`precipitated`)**：跨对话通用经验冷库（`precipitated/vault-global.json`），默认对主对话与参谋长**双盲 0 字节读取**。
- **📌 摆上桌面聚光灯与组合递话**：支持将任意三库卷宗点亮为「📌 摆上桌面（主+参谋可见）」并支持跨库复选卷宗、附带用户具体指令一键「组合递话」。
- **参谋专属按需检索**：支持逐会话切换 `👁️ 供本会话参谋参阅` / `📥 收回冷存`，或在参谋问答中按需检索全局冷库，用后即走。

#### 🗜️ `✦ 智选压缩` 与长任务自动续推
- **✦ 智选压缩 (`smartCompact`)**：可独立生效或协同 `autoCompact` 跳过固定百分比阈值，待阶段收口且主代理收敛空闲后自动抢救并静默压缩。
- **可见压缩回执卡片**：每次 `✦ 智选压缩` 真实执行后，自动向参谋对话流写入带 `✦ 智选压缩` 徽章的回执卡片（记录档案编号与压前 Token 占比）。
- **手动指令确定性压缩**：用户直说「压缩吧 / 压缩一下 / `/compact`」时绕过纯状态查询通道，确定性执行「先落盘抢救校验 → 再宿主静默压缩」。
- **长任务自动续推模块 (`auto-continue.js`)**：接入宿主 `autoContinue` 协同与参谋急停联动清理机制。

#### 🎯 强介入目标锁定、无限轮数与双安全门禁
- **核心目标目的地锁定**：开启 `⚡ 主动强介入` 后直接锁定核心目标作为唯一终局，防止后台督导跑偏。
- **无限轮次与防卡死熔断**：`maxInterventionTurns` 支持设为 `0 = ∞`（无限轮），同时保留连续无进展兜底熔断与风险弹窗确认。
- **高危操作急停弹窗**：检测高危干预时先弹窗提示风险，搭配输入栏红色 `⏹ 急停` 随时一键切断后台自驱。
- **必做事项结项核验门禁 (`allowed`)**：强介入或 `/goal` 收口前强制逐项核查 `allowed` 必做清单，未验证并获人工点击 `✅ 批准结项` 绝不退出督导模式。

#### 🌐 跨窗协同网、彩色信箱与可定住交接单
- **跨窗互连污染提醒与彻底脱离净化**：接入邻居会话前先弹窗提醒互享进展风险；断开协同立即校验 `clusterSig` 并清除摘要缓存、外部团队记忆与离线信箱残留。
- **彩色可折叠抽屉信箱与广播去重**：按会话固定配色，`@all` 广播自动去重归并，支持按全网广播 / 多方 / 双边 / 内部渠道折叠检索。
- **可手改与 `📌 定住防改` 交接单**：规划页支持手工编辑、一键定住冻结 `[自动渲染]` 快照（并同步锁定 `同步交接单` 开关防覆写）与发车前过期提醒弹窗。

### Changed
- **压缩触发区间全面放宽**：百分比自动压缩阈值由 `50%–95%` 调整为 `10%–95%`（低于 `25%` 弹出琥珀低阈值提示），并新增 `>= 8,000` 精确 Token 阈值模式。
- **交互入口与工作区布局重排**：战术驾驶舱 `+` 按钮收拢至输入栏居左，状态胶囊与权限档位直显于输入栏上方，跨会话接力区与 `📌 定住防改` 统一收口至「规划」页底部。
- **三层冷库晋升梯度规范化**：严格确立 `💬 本会话 → 🌐 系统全局 → 🏛️ 沉淀冷库` 单向逐级晋升规则（禁止本会话越级直接沉淀），并支持无损向下引入。
- **后端接口与打包边界扩展**：后端 `/api/dsh-chief/*` 同源环回保护接口扩展至 25 条；`package.json` `files` 清单补入 `chief-executor.js` 与 `auto-continue.js`。

### Fixed
- **修复手动与自动压缩报 `dsh-compaction service unavailable`**：绕过 Cordis 子分组对 `compaction` 服务的隔离限制，找不到直连服务时自动通过宿主官方 `commands.execute(ag, '/compact', ...)` 执行真压缩。
- **修复休眠会话无法触发压缩**：当 `agents.get(sid)` 未唤醒时，通过 `sessionController.resolveAgent(sid)` 自动恢复空闲会话句柄后再压缩；运行中会话继续安全拦截。
- **修复 `✦ 智选压缩` 静默失效与次数虚增**：重构 `executeHarvestAndCompact` 为严格原子提交——仅在真实压缩成功且非免压时递增 `autoCompactCount`、`lastCompactedSeq` 与 `lastCompactedAt`，报错或无历史免压绝不虚增，并将异常明细写入看板日志。
- **修复 `✦ 智选压缩` 因主代理未收敛空闲而错过触发**：在 `runTurnReview` 判断需要压缩时先等待最多 8 秒直到代理空闲后再执行，减少无谓滞后队列堆积。
- **修复空白新对话发送消息吐出 `<｜｜DSML｜｜ calls>` 源码**：扩展 `chief-executor.js` 解析与剥离正则覆盖双全角竖线、混合空格、单双引号及未闭合残缺标签，并在 `getChiefView` 返回历史记录前再次清洗净化。
- **修复空白新对话工作区路径丢失**：升级 `getSessionCwd` 在无活会话与空板卡时通过 `workspaceRegistry.list()`（优先匹配 `sessionIds`，否则按最新活跃时间兜底）与近期非内部配置文件板卡定位真实项目目录。
- **修复权限模式切换持久化与旧版宿主内存告警**：持久化保存 4 档 `permissionMode`，同步对齐前后端构建标（`1.2.0-r7`），在宿主仍运行旧内存模块或未挂载新版全局变量时友好提示重启客户端。
- **修复本地↔全局冷库前后端防串味问题**：前端独立拆分 `globalVaultItems` 存储状态，并拦截旧版后端误将本地档案当作全局冷库返回的非合规响应。

## [1.1.0] - 2026-11-15

### Added
- **Tactical Cockpit & Per-Workspace Intervention Gate**:
  - Workspace-isolated tactical controls (`intervention` strong-intervention gate with risk confirmation modal, consecutive turn cap & stalls circuit breaker, `strictVerify` empirical evidence enforcement, `redlineSentinel` boundary interceptor, and `conciseBrief` bulleted reporting).
- **Pre-Compaction Harvest-Verify-Compact**:
  - Automatic fact harvesting and disk verification prior to session context compaction without touching sealed cold precipitation vaults.
- **`/goal` Human Approval Gate**:
  - Pending approval cards before agents mutate long-running `/goal` objectives.
- **Dual-Vault Archive Architecture**:
  - Multi-cabinet switching (`cabinets`) for active engineering archives alongside a zero-token cold historical precipitation vault (`~/.dsh/chief/precipitated/`) with explicit per-entry unseal/seal (`翻牌启用/封存`).
- **One-Click Chief Deployment & Media Persistence**:
  - Cross-session Chief deployment cloning safe facts, narrative summary, and workspace preferences (forcing `intervention: false` and `flippedPrecipitatedIds: []`), with 4 archive transfer policies (`none`, `active`, `drawer`, `all`), plus `.dsh-chief-media/` image persistence with path fallback.

### Fixed
- **DSH Host Compatibility & Subagent API Guardrails (Fixes [#1](https://github.com/gluztm/dsh-chief/issues/1), thanks `@edz017`)**:
  - Tightened `package.json` `engines.dsh` constraint from `">=0.2.0"` to `">=0.2.2-rc.2"` so pre-refactor `subagents` hosts (such as `0.2.2-rc.1`) do not silently fail at runtime.
  - Added `probeSubagentSupport(runtime)` runtime capability detection in `index.js` (exposed via `/api/dsh-chief/snapshot` `hostCompat` + startup warning log) and a dismissible amber banner in `client.js`, while `task.dispatch`, `team.steer`, and `team.interrupt` now return clear Chinese upgrade guidance when `subagents.resolveName` is unavailable.
  - Fixed `sidebarRight.openResource` option key from `preferSeparatePane: true` to `preferNewPane: true` in `client.js`.
  - Added a DSH Host Version Compatibility Matrix to both `README.md` and `README.en.md`.

## [1.0.0] - 2026-11-14

### Added
- **Executive Chief Cockpit (`参谋` Tab)**:
  - Human-paced 3-gear briefing control (`⏸ 按需` default with zero background LLM calls, `⚡ 巡检`, and `🤖 托管`), preventing silent token drain.
  - Full `provider/model` channel alignment so the Chief follows the exact provider channel (e.g. CommandCode vs. Official) of the active root conversation.
  - Natural-language dispatch bar supporting `@主对话`, `@子代理`, `@跨窗会话`, and `@全体` broadcast across `steer` (插话), `followup` (递话), and `silent` (备忘) delivery modes.
- **Full-Spread Pyramid Task Topology (`任务` Tab)**:
  - Expanded hierarchical DAG layout placing the Root Coordinator at the apex and subagent squads across clean columns without cramped drag-scroll viewports.
  - Direct inline controls on every node for status transitions (`todo` / `doing` / `blocked` / `done`), plain-language explanation, subagent dispatch, and split-pane live stream inspection.
- **4-Tier Cold Engineering Archive Cabinet (`档案` Tab)**:
  - Dedicated cold-storage vault (`~/.dsh/chief/archives.json`) organized as **Filing Drawers → Paperclipped Dossiers (`璀璨金针` / `标准银针` / `暗古铜针`) → Memory Points → Unfoldable Sub-point Details**.
  - Strict 3-stage lazy loading (`Stage-0` `< 80B` metadata in `/snapshot`, `0` bytes injected into model system prompts while sealed; instant opt-in via `取出备查` or explicit `archive.search`).
  - One-click lossless Chief curation (`请参谋长整理收纳` / `请参谋长重拆此卷`) preserving 100% of raw markdown text.
- **Dual-Tier `/goal` & Interactive Step Board (`规划` Tab)**:
  - Dedicated top `/goal` long-running objective supervisor paired with a bottom step checklist.
  - Click-to-ask context menu on every step (`这条是什么意思 / 为什么有这步` & `让参谋长当场解读（不打断主对话）`).
- **Cross-Session SuperAgent Relay (`协同` Tab)**:
  - Undirected peer-session linking across independent DSH windows with unified directory discovery and shared collaboration mailbox.
- **Global Thumbtack Redline Governance & Self-Contained Handoff (`边界` Tab)**:
  - `📌` thumbtack toggle promoting rules to cross-session global boundaries vs. task-scoped rules, plus human-in-the-loop approval for agent-proposed rules and rule consolidation (`零散总结成一条`).
  - One-click self-contained markdown session handoff (`新建会话并交接`) with automatic frontend session navigation and `idle-guard` premature-stop protection.
- **Model Tool Suite & Local Security Hardening**:
  - Registered 4 structured model tools: `chief_board`, `chief_memory`, `chief_boundaries`, and `chief_handoff`.
  - Loopback + same-origin HTTP route protection across all `/api/dsh-chief/*` endpoints and regex secret blocking against accidental API key / private key persistence.
  - Zero external npm runtime dependencies; licensed under `AGPL-3.0-only`.

