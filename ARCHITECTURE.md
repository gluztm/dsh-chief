# `dsh-chief` 模块架构契约卡（AI 开发速查基准）

> **全局依赖铁律**
> 1. **依赖方向**：`index.js (DI Hub)` ──装配──▶ `{ board-store, subagent-runtime, board-actions, model-tools, api-routes, runtime-hooks }` ──跨域仅走门面──▶ `chief.js` / `archives.js` ──安全执行唯一通路──▶ `chief-executor.js` ──安全内核──▶ `safety/*.js`
> 2. **三禁红线**：① 子模块严禁反向导入门面（`index.js` / `chief.js` / `archives.js`）；② 严禁循环依赖与跨模块 `export let` 可变绑定；③ `pkg/safety/*.js` 严禁依赖业务层或引入 `child_process`，且 `chief-executor.js` + `pkg/safety/*.js` 全集受 MD5 锁保护。
> 3. **构建同步**：改动 `pkg/src/client/` 下任何源码后，必须执行 `npm run build:client` 重新生成 [client.js](file:///D:/Agents%20WorkSpace/DSH-Data/WorkShop/notebook-panel/pkg/client.js)。

---

## 一、宿主装配与后端业务层（`index.js` + 7 模块 + 独立工具）

- **模块**：`index.js` (DI Hub)
  - **职责**：持有进程唯一 `hostState` 与 `deps` 总线，按序装配 6 个工厂模块并对外转调 6 个历史导出。
  - **允许依赖**：`./board-store.js`, `./subagent-runtime.js`, `./board-actions.js`, `./model-tools.js`, `./api-routes.js`, `./runtime-hooks.js`
  - **禁止依赖**：任何子模块反向导入 `./index.js`；绕过 `deps` 私建全局状态容器。
  - **公开 API**：`apply`, `resolveWorkspaceIdForSession`, `getSessionCwd`, `executeHostSessionCompaction`, `deployStateToTargetChief`, `transferChief`
  - **持有状态**：唯一 `hostState`（`activeRuntime`, `activeLlm`, `activeAutoContinue`, `autoSteeredTurns`, `subagentRootMap`, `subagentTreeCache`, `handoffSeq`）与 `deps`。
  - **副作用**：绑定全模块调用链路。
  - **安全边界**：保证进程内只有一套缓存、锁集合与子代理谱系映射，杜绝多实例状态撕裂。

- **模块**：`board-schema.js`
  - **职责**：纯常量、字段长度上限（`BODY_LIMIT` 等）、任务 DAG 与推进流程推演（`planStepId` / `targetPlanStepId` / `resolveActivePlanStepId` / `derivePlanFlowProgress`）、`emptyBoard` 初始化与摘要生成。
  - **允许依赖**：`./memory.js`
  - **禁止依赖**：`index.js`, `board-store.js`, `chief.js`, `archives.js`, `node:fs`
  - **公开 API**：`API`, `BACKEND_BUILD`, `BOARD_VERSION`, `BODY_LIMIT`, `emptyBoard`, `normalizeTask`, `normalizeBoard`, `enforceAnchorCap`, `resolveActivePlanStepId`, `derivePlanFlowProgress` 等 47 项（内部 `seq` 不外泄）。
  - **持有状态**：私有单调 ID 计数器 `seq`。
  - **副作用**：无（纯内存数据结构标准化）。
  - **安全边界**：严格截断超长输入与越界字段，防止畸形载荷撑爆磁盘/上下文。

- **模块**：`board-store.js`
  - **职责**：看板 JSON 文件缓存、跨进程文件锁 `.lock` 与原子写盘（`.tmp` + `renameSync`）。
  - **允许依赖**：`node:fs`, `node:path`, `node:os`, `./board-schema.js`
  - **禁止依赖**：`index.js`, `chief.js`, `archives.js`, `api-routes.js`
  - **公开 API**：`createBoardStore(deps)` → `boardFile`, `loadBoard`, `saveBoard`, `withBoardLock`, `boardForSession`, `boundaries` 等。
  - **持有状态**：全进程唯一 `caches`（Map）与 `heldLocks`（Set）。
  - **副作用**：读写 `~/.dsh/notebook/` 看板文件与 `.lock` 锁文件，写盘后更新 `mtimeMs` 缓存。
  - **安全边界**：`withBoardLock` 通过 `try...finally` 成对释放内存与磁盘锁；`boardForSession` 自动并入全局红线 `pinnedBounds`。

- **模块**：`subagent-runtime.js`
  - **职责**：子代理树谱系解析、`cwd`/`workspaceId` 解析、Token 用量估算与宿主上下文压缩桥接。
  - **允许依赖**：`node:*`, `./memory.js`, `./chief.js`, `./board-schema.js`, `deps`
  - **禁止依赖**：`index.js`, `api-routes.js`, `board-store.js` 直接静态导入（经 `deps`）。
  - **公开 API**：`createSubagentRuntime(deps)` → `resolveRootSessionId`, `getSessionCwd`, `resolveWorkspaceIdForSession`, `refreshSubagentTree`, `executeSubagentAction`, `getSessionContextBreakdown`, `executeHostSessionCompaction`。
  - **持有状态**：读写 `deps.hostState` 的 `subagentRootMap` / `subagentTreeCache` / `handoffSeq`。
  - **副作用**：调用宿主 `sessionController` / `agents` / `subagentController` 派发或接管子代理。
  - **安全边界**：保留 `provider !== 'opendesign'` 防崩补丁；派发简报强制注入 `⛔` 红线（`buildTaskDispatchBrief`）；子代理读写经 `resolveRootSessionId` 收敛至根看板锁。

- **模块**：`board-actions.js`
  - **职责**：`runAction` 看板动作分发、跨窗口 `transferChief` 交接与档案迁移协调。
  - **允许依赖**：`node:fs`, `./digest.js`, `./handoff.js`, `./memory.js`, `./chief.js`, `./archives.js`, `./chief-executor.js`, `./board-schema.js`, `deps`
  - **禁止依赖**：`index.js`, `api-routes.js`
  - **公开 API**：`createBoardActions(deps)` → `runAction`, `runActionUnlocked`, `deployStateToTargetChief`, `transferChief`。
  - **持有状态**：无独立状态（复用 `deps` 锁与缓存）。
  - **副作用**：修改看板任务/计划/记忆/边界、生成新会话并绑定原 `workspaceId`。
  - **安全边界**：`transferChief('create')` 绑定 `workspaceId` 且严格使目标会话参谋长权限回落至 `advisor`。

- **模块**：`api-routes.js`
  - **职责**：向宿主 `webServer` 注册全部 27 条 `/api/dsh-chief/*` 同源 HTTP 路由。
  - **允许依赖**：`node:*`, `./digest.js`, `./memory.js`, `./chief.js`, `./archives.js`, `./chief-executor.js`, `./board-schema.js`, `deps`
  - **禁止依赖**：`index.js`, `chief-state.js` 等内部子模块。
  - **公开 API**：`createApiRoutes(deps)` → `registerRoutes(ctx, ...)`。
  - **持有状态**：无（纯请求路由转发）。
  - **副作用**：解析 JSON 请求体、调用动作与参谋长能力、返回 JSON 响应。
  - **安全边界**：27/27 条路由入口第一行强制执行 `if (!guard(req, res)) return`（绑定 `connection.requestRejection` 401/403，且异常处理严格 fail-closed 返回 `403`）；`readBody` 强制 `BODY_LIMIT` 防 DoS；`POST /chief/suggestion` 统一承接单条与批量建议执行。

- **模块**：`model-tools.js` & `runtime-hooks.js`
  - **职责**：`model-tools.js` 定义并注册 4 个模型工具（`chief_board` / `chief_memory` / `chief_boundaries` / `chief_handoff`，含 `inquiry.reply` 优先问询零打断回传、`chief.request` 主对话直传参谋长请求与只读 `wall.list`）；`runtime-hooks.js` 注册 Cordis `apply(ctx)` 生命周期、旧版迁移、`tools/pre-execute` 全会话（主对话与子代理）事前物理硬防线拦截、`agent/pre-step`（优先注入 `[INQUIRY #...]`）、`auto-continue` 与 `agent/turn-stopping` 子代理自动完结钩子。
  - **允许依赖**：`./chief.js`, `./archives.js`, `./chief-executor.js`, `./board-schema.js`, `./idle-guard.js`, `./auto-continue.js`, `deps`
  - **禁止依赖**：`index.js`, `chief-*` 内部实现。
  - **公开 API**：`createModelTools(deps)` / `createRuntimeHooks(deps)`。
  - **持有状态**：经 `deps.hostState` 管理 `activeAutoContinue` 与 `autoSteeredTurns`。
  - **副作用**：拦截会话启停、在工具实际落地前阻断命中高危硬规则或动态物理驻墙（`guard-walls.json`）的调用（返回 `{ kind: 'deny' }`）、自动解锁下游 DAG `blockedBy` 任务、注入上下文与交接提示词。
  - **安全边界**：`chief_board` 对 AI 严禁暴露 `wall.save` / `wall.setScope` / `wall.remove`，仅人机 UI `/action` 与人类拍板 `guard_wall` 提案可通过 `HUMAN_BOUNDS_CONFIRM_TOKEN` 改写物理驻墙与 `bounds.*`；`autoContinue` 受当前权限档位门禁约束。

---

## 二、参谋长引擎与安全执行层（`chief.js` + 9 模块 + `chief-executor.js` + `safety/` 9 模块）

- **安全内核与执行门面**：`pkg/safety/*.js`（9 模块）+ `chief-executor.js` (**安全核心全集 MD5 锁定**)
  - **独立安全内核 (`pkg/safety/`)**：
    - `safety/audit-log.js`：管理独立只追加审计日志 `chief-audit.jsonl`、`stage`/`rule`/`durationMs` 标准化及敏感凭据自动 `[REDACTED]` 脱敏。
    - `safety/command-analyzer.js`：命令归一化、复合管道分段（`&&`/`||`/`|`/;`/`cmd /c`/`powershell -c` 嵌套）与内联脚本载荷提取（`node -e`/`python -c`/`pwsh`/`iex` 及 Base64 字面量解码）。
    - `safety/guard-walls.js`：管理可跨会话随身复用的动态物理驻墙存储 `~/.dsh/chief/guard-walls.json`（`O_EXCL` `.lock` 互斥锁 + `mtimeMs` 缓存 + 原子重命名），支持 `global`（全工程随身）/ `workspace`（仅当前工程）/ `paused`（暂挂停用）三态与 5 类物理匹配（`forbid_path` / `restrict_write` / `forbid_cmd` / `require_approval_cmd` / `deny_tool`），提供人类专属认证写锁（`verifyBoundsWriteAuth`）及全会话 `evaluatePreExecuteDefense` 事前物理评估入口。
    - `safety/path-guard.js`：工作区真实路径与多级未建目录祖先校验、Symlink/Junction 穿透检测、Windows 保留设备名（`CON`/`NUL`/`COM*`）/NTFS ADS 流阻断与 `bounds.*` 人类确认写入令牌校验（`HUMAN_BOUNDS_CONFIRM_TOKEN`）。
    - `safety/invariant-guards.js`：不可被任何档位或插件覆盖的 `Hard Guard`（高危命令、凭据路径与内联访问、工作区越界、用户 `bounds.forbidden` 红线）。
    - `safety/policy-plugin.js`：只紧不松 JSON 策略插件校验与评估，支持角色上限收紧、禁用工具/路径前缀/命令正则与强制逐项审批，直接拒绝任何试图削弱 `Hard Guard` 或携带函数回调的插件。
    - `safety/policy-engine.js`：四档 `role + capabilities` 能力解析与单次授权作用域（`capabilityScope`）生成/防复用校验。
    - `safety/tool-gate.js`：串联 `Hard Guard -> Guard Walls -> Policy Plugin -> Role+Capabilities -> CapabilityScope` 的统一门禁。
    - `safety/index.js`：安全内核统一导出入口。
  - **`chief-executor.js` 职责**：作为对外兼容门面与唯一物理沙箱执行器（唯一允许调用 `node:child_process`），承载工具描述、DSML/XML 清洗、耗时统计、Stage 3.5 动态物理驻墙检验、L2/L3 懒介入拦截（优先派发在线 `@lead` 执行工作区写改与终端命令，除非用户明确点名参谋长亲自上手）、工具执行与 `runChiefAgenticLoop`。
  - **禁止依赖**：`pkg/safety/*.js` 严禁依赖任何业务模块或 `child_process`；`chief-executor.js` 严禁反向依赖业务子模块。
  - **安全边界**：所有工具与命令执行必经统一门禁与沙箱；`L2 strategist` 与受插件降级操作进入带 `capabilityScope` 锁定的审批队列。

- **模块**：`chief-state.js` (L1) & `chief-models.js` (L2)
  - **职责**：`chief-state.js` 管理 `chief-state.json` 跨进程 `O_EXCL` `.lock` 互斥锁与原子写盘、工作区配置、`permissionMode` + `capabilities` 解析、情景预设（`observer` / `collab` / `away`）、只紧不松 `policyPlugins` 配置持久化与校验、`auditLog` 联动 `safety/audit-log.js`、审批队列（`payloadHash` + `capabilityScope`）、持久化任务账本 `taskLedger`（兼容 `resumeTasks`，冷启动时自动将遗留 `running`/`resuming`/`verifying` 收敛为 `interrupted`，过期条目收敛为 `expired`）、LLM 调用账本 `llmLedger` 与 `managedRun` 硬预算熔断（累计上限夹紧）、里程碑告警队列 `alertEvents`（5s 去重 + 20 条滚动上限）及 `pinned` 翻出索引；`chief-models.js` 管理可用模型目录缓存、失败冷却队列、Token 用量提取/预算检查与 `ctx.llm` 调用。
  - **允许依赖**：`node:*`, `./archives.js`, `./safety/index.js`（L2 仅依赖 `./chief-state.js`）。
  - **禁止依赖**：`chief.js`, `index.js`, L3–L9 上层模块。
  - **持有状态**：`chief-state.js` 唯一持有 `cachedState` / `cachedMtime` / `idSeq` / `heldStateLocks` / `activeResumingTaskIds`；`chief-models.js` 唯一持有 `modelCatalogCache` / `unusableRouteUntil`。
  - **副作用**：读写 `~/.dsh/chief/chief-state.json`（含 `.lock`）及独立只追加日志 `~/.dsh/chief/chief-audit.jsonl`；向工作区写入参谋暂存图片。
  - **安全边界**：启用 `chief` 档位后端强校验 `hasValidChiefRiskAck`；降档自动清零确认戳；非法 `policyPlugins` 配置写入审计并原样拒绝；崩溃遗留任务绝不无确认自动续跑。

- **模块**：`chief-network.js` (L3) & `chief-view.js` (L4)
  - **职责**：`chief-network.js` 处理跨窗口集群信封 `buildMessageEnvelope`、同行进度与定向邮箱递话；`chief-view.js` 聚合六行态势报告与 `getChiefView`，并暴露单向 `registerIdleAutoPilotHook` 解耦 L8。
  - **允许依赖**：向下仅依赖 L1–L3 与 `./chief-executor.js`（只读常量）。
  - **禁止依赖**：`chief.js`, `chief-review.js`, L5–L9。
  - **持有状态**：`chief-view.js` 唯一持有 `idleAutoPilotHook` 与 `summarizingLocks`（Map）。
  - **副作用**：向同工作区/关联窗口投递消息并落盘邮箱状态。
  - **安全边界**：仅传递摘要与安全态势，不外泄冷库隐私；脱敏内部诊断噪音。

- **模块**：`chief-archives.js` (L5) & `chief-compaction.js` (L6)
  - **职责**：`chief-archives.js` 执行 LLM 回合收割、经验沉淀、全局蒸馏、跨窗口递档与托管模式后台「🌙 梦境漫游」（`runManagedDreamRoam`，仅梳理未织钩草稿/撤下桌面观察项归抽屉与提炼 `hookKeywords`/`hookCue`，不改代码且不回推桌面）；`chief-compaction.js` 执行空闲等待、Token 测算、抢救压缩与智能阈值建议。
  - **允许依赖**：`./archives.js` 门面、L1–L4（L6 可依赖 L5）、`./chief-executor.js`。
  - **禁止依赖**：`chief.js`, L7–L9。
  - **持有状态**：无全局可变锁（防重入依赖 `chief-state`）。
  - **副作用**：写三层档案柜或调用宿主 `/compact` 压缩会话。
  - **安全边界**：尊重 `archives.js` 0-token 冷藏隔离与凭据过滤；压缩前自动落盘防丢记忆。

- **模块**：`chief-commands.js` (L7) & `chief-approvals.js` (L8) & `chief-review.js` (L9)
  - **职责**：L7 处理自然语言指令编排（`askOrCommandChief`，含双通道主会话档案注入 `executeChiefArchiveInjectionOp`、`effortOps` 跨模型思考强度调控与 `lockedModelEfforts` 用户 `🔒 锁挡` 硬拦截、`inquiries` 优先问询与 `wallProposals` 手搓物理驻墙呈批）、边界浓缩与 `handleLeadDirectRequestToChief`；L8（`chief-approvals.js`）处理建议卡片（含 `archive_op` / `model_effort`）、顶部与一站式批量执行（`executeBatchSuggestions`）、L2 审批单 `payloadHash` 核验/一次性放行（`handleApprovalDecision`）及提权后自动续跑恢复；L9（`chief-review.js`）处理基于 `runMode` (`off`/`patrol`/`managed`) 的回合巡检/托管督导、`runManagedDreamRoam` 触发、`L3 + 强介入` 一站式安全建议收口执行（输出 `'🏁 一站式战报回执'`）与 5 条件自动休眠守护（`checkAndStopIdleAutoPilot`，默认 15 分钟无活动且 0 在途/doing/待批/问询/未归位观察即切回 `off`）。
  - **允许依赖**：遵循严格单向无环 DAG（`chief-review.js -> chief-approvals.js -> chief-commands.js -> chief-archives.js -> chief-view.js -> chief-models.js -> chief-state.js` + `./chief-executor.js`；门面 `chief.js` 保持严格 67 项导出）。
  - **禁止依赖**：反向导入 `./chief.js` 或同/下层循环依赖。
  - **持有状态**：`chief-review.js` 唯一持有 `reviewTimers`（Map）与 `lastReviewAtByRoot`（Map）。
  - **副作用**：运行参谋工具循环、入队待审批/提权/物理墙提案卡片、批准并核验 `payloadHash` 后触发单次执行与未超期恢复事务续跑。
  - **安全边界**：所有工具与命令执行唯一通过 `chief-executor.js`；L2 审批单一次性消费 + SHA-256 `payloadHash` 防篡改，拒绝与重放必入 `auditLog` 及 `chief-audit.jsonl`；自动续跑严格受 `resumeDepth < 2` 与 30 分钟 TTL 约束；`chatTriggered` 触发对话后顺势背景更新摘要（60 秒节流防抖，不阻塞回复）；`resolveModelInfo` 能力自适应与 `lockedModelEfforts` 锁挡一票否决硬约束。

---

## 三、三层工程档案系统（`archives.js` + 4 模块）

- **模块**：`archive-core.js` (L1 唯一状态所有者) → `archive-cabinets.js` (L2 柜管理) → `archive-precipitated.js` (L3 冷库) → `archive-dossiers.js` (L4 卷宗业务)
  - **职责**：`archive-core` 提供 `DESKTOP_TOKEN_BUDGET = 2400` / `DESKTOP_MAX_ITEMS = 6`、`hookKeywords`/`hookCue`/`hasHook` 归一化、路径/锁/缓存/原子写/密钥检测；`archive-cabinets` 管理多柜注册与旧数据迁移；`archive-precipitated` 管理冷藏冷库 0-token 隔离、人类速览钩子与抽屉归类；`archive-dossiers` 管理三层卷宗 CRUD、谁在看状态计算（`computeArchiveViewerStatus`）、认知桌面预算挤退（入 `recentlyUnpinnedWatch`）、`pullByLead` / `pullByChief` / `markDeliveredToLead` 留痕与跨会话复制。
  - **允许依赖**：严格 `L4 → L3 → L2 → L1` 单向依赖，外部一律导入门面 `./archives.js`（42 项导出）。
  - **禁止依赖**：任何 `archive-*.js` 反向导入 `./archives.js`、`./chief.js` 或 `./index.js`。
  - **持有状态**：`archive-core.js` 唯一持有 `heldArchiveLocks`（Set）、`archiveCache`（经 getter/setter 访问）、`seq` 与 `archiveMutatorHook`。
  - **副作用**：读写项目级/全局级档案柜 JSON 与 `.lock`。
  - **安全边界**：`SECRET_PATTERN` 拦截 API Key/Token 落盘；主对话 `digest` 禁止注入未织钩草稿、全局柜、与未人工翻牌冷库（仅认知桌面置顶全文 + 本局已织钩轻量 `🪝` 索引）；冷库未显式 `flipOut` 恒返回 `[]`（0-token）；`copyPrecipitatedToVault` 必须在 `finally { release() }` 释放冷库锁后才写目标库；所有桌面置顶遵循 `session -> global` 锁序。

---

## 四、客户端 ES Module 架构（`pkg/src/client/` 20 模块 → `pkg/client.js`）

- **分层结构**：`react-runtime.js` / `constants.js` (L0 常量与宿主桥) → `i18n.js` (L0.5 运行时中英双语选择器，零本地模块依赖) → `store.js` (L1 **唯一可变状态所有者**：`store`, `listeners`, `SESSION_SOURCES`, `runtimeRefs`) → `utils.js` (L2 纯工具) / `notify.js` (L2 桌面 `Notification` 与 WebAudio 提示音引擎) / `report.js` (L2 密钥脱敏与 Markdown 战报生成器) → `api.js` (L3 HTTP 通信与会话切换状态清理) / `styles.js` (L3 CSS，含 `.dnb-flow-*` 顺序推进流样式、`.dnb-gear-btn` 顶栏齿轮设置样式、`data-tone="dream"` 毛玻璃与 `.dnb-paper-dossier` 动态俯视纸质卡) → `components/common.js` / `modals.js` (L4 通用组件与弹窗) → `tabs/tasks-flow.js` (L5 推进流与全景 SVG 流程拓扑，绝不反向依赖 `tabs/tasks.js` 与 `tabs/plan.js`) / `tabs/plan.js` (L5 核心目标 + 合并任务板 + 跨会话接力部署 + MemoryTab/HandoffTab) / `tabs/*.js` (L5 其余业务页签，`tabs/tasks.js` 组合 `PlanTab` + `TaskFlowPipelineView` / `TaskFlowCanvasView` 对外呈现统一的「任务」总页) → `components/Panel.js` (L6 主面板顶栏齿轮「设置」入口、正交三态切换、5 大页签与 8 插槽外壳) → `entry.js` (L7 `createClientPlugin()` 入口)。
- **构建与禁忌**：由零依赖拓扑排序打包器 [build-client.mjs](file:///D:/Agents%20WorkSpace/DSH-Data/WorkShop/notebook-panel/pkg/scripts/build-client.mjs) 输出单文件 `pkg/client.js`（`window.__ModuleLoader__.load({ id: 'dsh-chief' })`）；严禁新增跨模块 `export let` 重新赋值，严禁跳过 `npm run build:client`。
- **界面版本徽章与控制交互**：参谋长面板标题栏（`components/Panel.js` `.dnb-ver-chip`）常驻显示 `v1.7.0`，其左侧紧邻旋转齿轮「设置」按钮（点击旋转 `180°` 并切换包含 3 档预设 / 通知 / LLM 预算账本 / 双语切换的设置页面）；顶部收口为 **5 大页签**（`参谋 / 任务 / 协同 / 档案 / 边界`，原「规划」已合并入「任务」，布局自上而下严格为：**核心目标 → 任务拓扑（流程画布 / 组织树）→ 合并任务板（步骤与列表任务树合一）→ 跨会话接力部署**）；顶部正交运行模式切换为 `⏸ 关停 | 🛡 巡检 | 🤖 托管`；档案页常驻置顶认知桌面进度条与三层可折叠纸质卷宗卡（折叠态仅显标题+关键词钩子+谁在看徽章，点击展开）；参谋回复卡右上显示思考挡位角标，驾驶舱与模型选择器搭载 `180°` 扇形思考强度表盘与团队思考强度「自动 / 手动」切换；流光毛玻璃舞台支持鼠标单击立即收起遮罩恢复面板操作，并保持彩色流光外框提示后台仍在运作；`package.json`、`board-schema.js`（`BACKEND_BUILD`）与 `src/client/constants.js`（`EXPECTED_BACKEND_BUILD`）三端强制同源为 `1.7.0`。
