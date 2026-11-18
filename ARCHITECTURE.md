# `dsh-chief` 模块架构契约卡（AI 开发速查基准）

> **全局依赖铁律**
> 1. **依赖方向**：`index.js (DI Hub)` ──装配──▶ `{ board-store, subagent-runtime, board-actions, model-tools, api-routes, runtime-hooks }` ──跨域仅走门面──▶ `chief.js` / `archives.js` ──安全执行唯一通路──▶ `chief-executor.js`
> 2. **三禁红线**：① 子模块严禁反向导入门面（`index.js` / `chief.js` / `archives.js`）；② 严禁循环依赖与跨模块 `export let` 可变绑定；③ 严禁修改 [chief-executor.js](file:///D:/Agents%20WorkSpace/DSH-Data/WorkShop/notebook-panel/pkg/chief-executor.js) 安全内核语义。
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
  - **职责**：纯常量、字段长度上限（`BODY_LIMIT` 等）、任务 DAG 状态推演、`emptyBoard` 初始化与摘要生成。
  - **允许依赖**：`./memory.js`
  - **禁止依赖**：`index.js`, `board-store.js`, `chief.js`, `archives.js`, `node:fs`
  - **公开 API**：`API`, `BACKEND_BUILD`, `BOARD_VERSION`, `BODY_LIMIT`, `emptyBoard`, `normalizeTask`, `normalizeBoard`, `enforceAnchorCap` 等 45 项（内部 `seq` 不外泄）。
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
  - **职责**：`model-tools.js` 定义并注册 4 个模型工具（`chief_board` / `chief_memory` / `chief_boundaries` / `chief_handoff`）；`runtime-hooks.js` 注册 Cordis `apply(ctx)` 生命周期、旧版迁移、`auto-continue` 与 `agent/turn-stopping` 子代理自动完结钩子。
  - **允许依赖**：`./chief.js`, `./archives.js`, `./chief-executor.js`, `./board-schema.js`, `./idle-guard.js`, `./auto-continue.js`, `deps`
  - **禁止依赖**：`index.js`, `chief-*` 内部实现。
  - **公开 API**：`createModelTools(deps)` / `createRuntimeHooks(deps)`。
  - **持有状态**：经 `deps.hostState` 管理 `activeAutoContinue` 与 `autoSteeredTurns`。
  - **副作用**：拦截会话启停、自动解锁下游 DAG `blockedBy` 任务、注入上下文与交接提示词。
  - **安全边界**：`chief_board permission.request` 与模型工具不可跳过人工提权审批直接赋予 `chief` 权限；`autoContinue` 受当前权限档位门禁约束。

---

## 二、参谋长引擎与安全执行层（`chief.js` + 9 模块 + `chief-executor.js`）

- **模块**：`chief-executor.js` (**独立安全执行核，MD5 锁定**)
  - **职责**：定义四档权限模型（`advisor` / `assistant` / `strategist` / `chief`）、安全卫兵硬规则（`evaluateSafetyGuardHardRules`）、工具门禁（`evaluateChiefPermissionGate`）、工具沙箱执行（`executeChiefToolCall`）与 `runChiefAgenticLoop`。
  - **允许依赖**：仅 `node:fs`, `node:path`, `node:child_process`
  - **禁止依赖**：任何业务逻辑模块（`chief-*.js`, `archives.js`, `index.js`）；严禁被拆散或与业务层合并！
  - **公开 API**：权限常量与归一化、`CHIEF_TOOLS_PROMPT_GUIDE`、`evaluateSafetyGuardHardRules`、`evaluateChiefPermissionGate`、`executeChiefToolCall`、`runChiefAgenticLoop`。
  - **持有状态**：无跨请求可变全局状态。
  - **副作用**：受控读写工作区文件、执行只读搜索或批准后的命令。
  - **安全边界**：唯一物理执行网关；硬规则对全部四档位强制生效；L2 `strategist` 写/执行工具必入审批队列而非当场执行；命令超时与输出截断兜底。

- **模块**：`chief-state.js` (L1) & `chief-models.js` (L2)
  - **职责**：`chief-state.js` 管理 `chief-state.json` 跨进程 `O_EXCL` `.lock` 互斥锁与原子写盘、工作区配置、`permissionMode` 校验与降档清零、`auditLog` 与独立只追加账本 `chief-audit.jsonl`、`approvalQueue`/`elevationQueue`（含 SHA-256 `payloadHash` 绑定）与轻量化恢复事务账本 `resumeTasks`、`pinned` 翻出索引；`chief-models.js` 管理可用模型目录缓存、失败冷却队列与 `ctx.llm` 调用。
  - **允许依赖**：`node:*`, `./archives.js`, `./chief-executor.js`（L2 仅依赖 `./chief-state.js`）。
  - **禁止依赖**：`chief.js`, `index.js`, L3–L9 上层模块。
  - **持有状态**：`chief-state.js` 唯一持有 `cachedState` / `cachedMtime` / `idSeq` / `heldStateLocks`；`chief-models.js` 唯一持有 `modelCatalogCache` / `unusableRouteUntil`。
  - **副作用**：读写 `~/.dsh/chief/chief-state.json`（含 `.lock`）及独立只追加日志 `~/.dsh/chief/chief-audit.jsonl`；向工作区写入参谋暂存图片。
  - **安全边界**：启用 `chief` 档位后端强校验 `hasValidChiefRiskAck`（`confirmedChiefRisk === true`）；降档自动清零确认戳；异常与拒批行为同步写入内存截断队列与永不截断的 `chief-audit.jsonl`。

- **模块**：`chief-network.js` (L3) & `chief-view.js` (L4)
  - **职责**：`chief-network.js` 处理跨窗口集群信封 `buildMessageEnvelope`、同行进度与定向邮箱递话；`chief-view.js` 聚合六行态势报告与 `getChiefView`，并暴露单向 `registerIdleAutoPilotHook` 解耦 L8。
  - **允许依赖**：向下仅依赖 L1–L3 与 `./chief-executor.js`（只读常量）。
  - **禁止依赖**：`chief.js`, `chief-review.js`, L5–L9。
  - **持有状态**：`chief-view.js` 唯一持有 `idleAutoPilotHook` 与 `summarizingLocks`（Map）。
  - **副作用**：向同工作区/关联窗口投递消息并落盘邮箱状态。
  - **安全边界**：仅传递摘要与安全态势，不外泄冷库隐私；脱敏内部诊断噪音。

- **模块**：`chief-archives.js` (L5) & `chief-compaction.js` (L6)
  - **职责**：`chief-archives.js` 执行 LLM 回合收割、经验沉淀、全局蒸馏与跨窗口递档；`chief-compaction.js` 执行空闲等待、Token 测算、抢救压缩与智能阈值建议。
  - **允许依赖**：`./archives.js` 门面、L1–L4（L6 可依赖 L5）、`./chief-executor.js`。
  - **禁止依赖**：`chief.js`, L7–L9。
  - **持有状态**：无全局可变锁（防重入依赖 `chief-state`）。
  - **副作用**：写三层档案柜或调用宿主 `/compact` 压缩会话。
  - **安全边界**：尊重 `archives.js` 0-token 沉淀封存与凭据过滤；压缩前自动落盘防丢记忆。

- **模块**：`chief-commands.js` (L7) & `chief-review.js` (L8) & `chief-approvals.js` (L9)
  - **职责**：L7 处理自然语言指令编排（`askOrCommandChief`，支持 `_resumeCtx` 授权恢复上下文）、边界浓缩与目标建议；L8 处理防抖回合审查、`runTurnReview` 与自动驾驶防空转收工（启动时向 `chief-view.js` 注册 `checkAndStopIdleAutoPilot` 钩子）；L9 处理建议卡片与顶部统一批量执行（`executeBatchSuggestions`）、L2 审批单 `payloadHash` 核验/一次性放行（`handleApprovalDecision`）及提权裁决后自动续跑恢复（`handleElevationDecision`）。
  - **允许依赖**：遵循严格偏序 DAG（L7→L1..L6 + `./chief-executor.js`；L8→L1..L7；L9→L1..L7 + `./chief-executor.js`；门面 `chief.js` 共 67 项导出）。
  - **禁止依赖**：反向导入 `./chief.js` 或下层调用上层。
  - **持有状态**：`chief-review.js` 唯一持有 `reviewTimers`（Map）与 `lastReviewAtByRoot`（Map）。
  - **副作用**：运行参谋工具循环、入队待审批/提权卡片、批准并核验 `payloadHash` 后触发单次执行与未超期恢复事务续跑。
  - **安全边界**：所有工具与命令执行唯一通过 `chief-executor.js`（已加固反斜杠/引号/参数插入/`-EncodedCommand`/写内容体红线检查及 Symlink/NTFS ADS 凭据阻断）；L2 审批单一次性消费 + SHA-256 `payloadHash` 防篡改，拒绝与重放必入 `auditLog` 及 `chief-audit.jsonl`；自动续跑严格受 `resumeDepth < 2` 与 30 分钟 TTL 约束。

---

## 三、三层工程档案系统（`archives.js` + 4 模块）

- **模块**：`archive-core.js` (L1 唯一状态所有者) → `archive-cabinets.js` (L2 柜管理) → `archive-precipitated.js` (L3 冷库) → `archive-dossiers.js` (L4 卷宗业务)
  - **职责**：`archive-core` 提供路径/锁/缓存/原子写/密钥检测/mutator 钩子槽；`archive-cabinets` 管理多柜注册与 `board.json` 旧数据迁移；`archive-precipitated` 管理沉淀冷库 0-token 封存与跨库调入；`archive-dossiers` 管理普通卷宗 CRUD、Diff、搜索与跨会话复制（加载时注册 mutator 钩子）。
  - **允许依赖**：严格 `L4 → L3 → L2 → L1` 单向依赖，外部一律导入门面 `./archives.js`。
  - **禁止依赖**：任何 `archive-*.js` 反向导入 `./archives.js`、`./chief.js` 或 `./index.js`。
  - **持有状态**：`archive-core.js` 唯一持有 `heldArchiveLocks`（Set）、`archiveCache`（经 getter/setter 访问）、`seq` 与 `archiveMutatorHook`。
  - **副作用**：读写项目级/全局级档案柜 JSON 与 `.lock`。
  - **安全边界**：`SECRET_PATTERN` 拦截 API Key/Token 落盘；冷库未显式 `flipOut` 恒返回 `[]`（0-token）；`copyPrecipitatedToVault` 必须在 `finally { release() }` 释放冷库锁后才调用目标库写入，彻底杜绝锁序死锁；跨会话复制永不自动泄露冷库内容。

---

## 四、客户端 ES Module 架构（`pkg/src/client/` 16 模块 → `pkg/client.js`）

- **分层结构**：`react-runtime.js` / `constants.js` (L0 常量与宿主桥) → `store.js` (L1 **唯一可变状态所有者**：`store`, `listeners`, `SESSION_SOURCES`, `runtimeRefs`) → `utils.js` (L2 纯工具) → `api.js` (L3 HTTP 通信与会话切换状态清理) / `styles.js` (L3 CSS) → `components/common.js` / `modals.js` (L4 通用组件与 14 个安全弹窗) → `tabs/*.js` (L5 6 个业务页签) → `components/Panel.js` (L6 主面板与 8 插槽外壳) → `entry.js` (L7 `createClientPlugin()` 入口)。
- **构建与禁忌**：由零依赖拓扑排序打包器 [build-client.mjs](file:///D:/Agents%20WorkSpace/DSH-Data/WorkShop/notebook-panel/pkg/scripts/build-client.mjs) 输出单文件 `pkg/client.js`（`window.__ModuleLoader__.load({ id: 'dsh-chief' })`）；严禁新增跨模块 `export let` 重新赋值，严禁跳过 `npm run build:client`。
- **界面版本徽章与控制交互**：参谋长面板标题栏（`components/Panel.js` `.dnb-ver-chip`）常驻显示 `v1.3.0`；`SuggestionBanner` 顶部提供唯一「▶ 执行建议」入口并区隔问答/回执样式（`tabs/chief.js`）；右下角与输入栏触发按钮采用真 Toggle 与启动单次引导（`store.js`/`entry.js`），手动关闭后绝不自动弹回。发版前打包脚本将强校验 `package.json`、`board-schema.js`（`BACKEND_BUILD`）与 `src/client/constants.js`（`EXPECTED_BACKEND_BUILD`）三端一致。
