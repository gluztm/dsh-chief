# `dsh-chief` 模块架构说明（开发参考）

> **依赖规范**
> 1. **依赖方向**：`index.js` ──装配──▶ `{ board-store, subagent-runtime, board-actions, board-handoff, model-tools, api-routes, runtime-hooks }` ──跨域仅走门面──▶ `chief.js` / `archives.js` ──安全执行唯一通路──▶ `chief-executor.js` ──安全内核──▶ `safety/*.js`
> 2. **边界规则**：
>    - 子模块禁止反向导入门面（`index.js` / `chief.js` / `archives.js`）。
>    - 禁止循环依赖与跨模块 `export let` / `export var` 可变导出。
>    - `pkg/safety/*.js` 仅允许相对导入 `./`，禁止依赖业务模块或 `child_process`；`chief-executor.js` 与 `pkg/safety/*.js` 受 MD5 校验保护（见 `audit-v130-redteam-boundaries.mjs` 与 `verify-chief-facade-split.mjs`）。
> 3. **构建同步**：修改 `pkg/src/client/` 下任何源码后，必须运行 `npm run build:client` 重新生成 [client.js](client.js)（由 [build-client.mjs](scripts/build-client.mjs) 拼装）。

---

## 一、宿主装配与后端业务层（53 个后端模块，含 9 个安全模块）

### 1. 宿主装配入口与看板 / 工具 / 路由 / 外设外延（`index.js` + 拆分模块）

- **`index.js`（DI Hub，保留 6 项公开导出）**
  - 持有进程唯一 `hostState` 与 `deps` 总线，按序装配工厂模块并对外转调：`apply`、`resolveWorkspaceIdForSession`、`getSessionCwd`、`executeHostSessionCompaction`、`deployStateToTargetChief`、`transferChief`。
  - 避免多实例各自持锁导致状态冲突。
- **`board-schema.js` & `board-store.js` & `subagent-runtime.js`**
  - `board-schema.js`：维护常量、字段长度上限（`BODY_LIMIT` 等）、任务 DAG 归一化、工作流进度推演、`normalizeCursorBlocked`、`emptyBoard` 与版本标识 `BACKEND_BUILD = '2.0.1'`。
  - `board-store.js`：负责看板 JSON 文件缓存、跨进程 `O_EXCL` 文件锁与带 `threadId` 的原子重命名写盘，自动合并全局红线 `pinnedBounds`。
  - `subagent-runtime.js`：解析子代理树谱系、工作区 `cwd` / `workspaceId`、会话 Token 用量以及 `/compact` 上下文压缩桥接。
- **`board-actions.js` & `board-handoff.js`**
  - `board-actions.js` 处理任务、计划、边界、档案、记忆写操作及单条边界「暂挂」；`board-handoff.js` 生成长程交接单并支持跨会话部署。
- **`api-routes.js`**
  - 注册全部 27 条 `/api/dsh-chief/*` 同源 HTTP 路由；入口首行执行 `if (!guard(req, res)) return`（异常时 fail-closed 返回 `403`），涵盖 TTS/ASR 语音、远程传呼配置、多端主题同步、记忆工坊与文档档案 CRUD。
- **`model-tools.js` & `runtime-hooks.js`**
  - 注册 `chief_board`、`chief_memory`、`chief_boundaries`、`chief_handoff` 4 个模型工具；`runtime-hooks.js` 注册 Cordis `apply(ctx)` 8 处生命周期钩子，在 `tools/pre-execute` 校验 `sessionEnabled` 与 `safetyGuardEnabled` / 物理驻墙，并在异常/拦停/完工节点联动语音播报与远程传呼。
- **扩展能力模块（`v1.8` – `v2.0` 新增）**
  - `chief-tts.js` & `voice-inbox.js`：多引擎语音合成与语音转写路由、口语脱敏、叫名唤醒及 `~/.dsh/chief/voice-inbox/` 语音手记收件箱（经梦境漫游沉淀入库）。
  - `remote-pager.js`：6 通道手机远程传呼（飞书 / 钉钉 / 企业微信 / Telegram / Discord / 自定义 Webhook），带密钥脱敏、HMAC 签名与防刷屏冷却。
  - `chief-theme-diy.js` & `guard-wall-presets.js` & `github-star.js`：AI 主题配色生成与服务端 `~/.dsh/chief/` 多端同步、开箱边界预设包 v2、实时 GitHub Star 计数与 `gh` CLI 直连点星。
  - `external-memory.js` / `external-memory-connectors.js` / `external-memory-studio.js`：参谋专属 `MEMORY.md` + 5 维画像 + 艾宾浩斯曲线、OpenAI/Ollama/Gemini 三协议向量客户端，以及 `mcp-http` / `chief-http` / 只读 Obsidian / `cordis-provider` 桥接（严格对 `@lead` 0 字节隔离）。

---

## 二、安全内核与执行层（`chief-executor.js` + `pkg/safety/` 9 模块）

- **`pkg/safety/`（9 个无业务依赖模块，与 `chief-executor.js` 共受 MD5 锁）**
  - `safety/audit-log.js`：写入只追加审计日志 `chief-audit.jsonl`，自动将疑似凭据脱敏为 `[REDACTED]`。
  - `safety/command-analyzer.js`：命令规范化、复合管道分段与内联脚本载荷提取（`node -e` / `python -c` / `pwsh` / `iex` + Base64）。
  - `safety/guard-walls.js`：维护 `~/.dsh/chief/guard-walls.json`（`global` / `workspace` / `paused`），提供 `verifyBoundsWriteAuth` 与 `evaluatePreExecuteDefense`（先判用户手工物理驻墙，再读 `safetyGuardEnabled` 决定是否执行内置硬规则）。
  - `safety/path-guard.js`：工作区真实路径与多级未建目录校验、Symlink/Junction 检测、Windows 保留设备名/ADS 流拦截与 `HUMAN_BOUNDS_CONFIRM_TOKEN` 校验。
  - `safety/invariant-guards.js`：高危命令、`isDestructiveShellCommand`（剥离非可执行 heredoc 与只读 `grep`/`git log/commit` 分段）、凭据路径与工作区越界检查；支持接收 `safetyGuardEnabled` 开关控制内置规则放行。
  - `safety/policy-plugin.js`：只紧不松 JSON 策略插件校验，拒绝试图削弱内置防线的键。
  - `safety/policy-engine.js`：四档 `role + capabilities` 能力解析与单次授权 `capabilityScope` 防复用。
  - `safety/tool-gate.js`：串联 `Hard Guard -> Guard Walls -> Policy Plugin -> Role+Capabilities -> CapabilityScope` 的统一入口。
  - `safety/index.js`：安全内核统一导出入口。
- **`chief-executor.js`**
  - 对外沙箱与工具执行门面（唯一允许调用 `node:child_process`），承担工具描述、DSML/XML 清洗、物理驻墙检验、L2/L3 懒介入派单给 `@lead` 与 `runChiefAgenticLoop`。

---

## 三、参谋长状态、协同、档案与督导层（`chief.js` 门面 + 16 模块）

- **`chief.js`（纯门面，严格保持 67 项导出）**：聚合以下单向 DAG 分层模块：
  - **`state-schema.js` & `state-media.js` & `chief-state.js` (L1)**：状态结构标准化、媒体持久化与 `chief-state.json` `O_EXCL` 互斥锁管理。包含 `sessionEnabled` / `defaultAutoEnableSessions`、人类专控 `globalSafetyGuardEnabled` & `tacticalModes.safetyGuardEnabled`（非人类调用关闭直接拒绝并写审计，调整纯全局开关不误激活普通会话）、3 档情景预设、`taskLedger` / `llmLedger` / `managedRun` 熔断及 `alertEvents`（5s 去重 + 20 条上限）。
  - **`chief-models.js` (L2)**：可用模型目录缓存、失败冷却队列、`llm.resolveModelInfo` 能力自适应、Token 预算核查与 `ctx.llm` 调用。
  - **`network-harness.js` & `chief-network.js` (L3) & `chief-view.js` (L4)**：免 `ccSwitch` 探测并派发本机 `Codex` / `Claude Code`（`pair` 渠道 + 虚拟根）、跨窗口信封与邮箱管理、待命池过滤（排除 `Mnemon` 后台任务与空白空壳）及 `getChiefView` 六行态势汇总。
  - **`chief-archives.js` (L5) & `chief-compaction.js` (L6)**：回合收割、经验沉淀、托管后台「🌙 梦境漫游」（只整理未织钩草稿和观察队列，不改代码），以及空闲等待、Token 测算和抢救压缩。
  - **`command-helpers.js` / `command-ops.js` / `chief-commands.js` (L7)**：自然语言指令解析与执行（`askOrCommandChief`、双通道档案注入、思考强度调控与 `lockedModelEfforts` 锁定校验、物理墙草案与优先问询）。
  - **`chief-approvals.js` (L8) & `chief-review.js` (L9)**：建议卡与一站式批量执行、`payloadHash` 核验、审批后自动续跑恢复，以及基于 `runMode` (`off`/`patrol`/`managed`) 的巡检、5 条件自动休眠守护与复盘流程。
  - 辅助模块：`auto-continue.js`、`digest.js`、`handoff.js`、`idle-guard.js`（含 `detectMidTurnSpin` 空转识别）。

---

## 四、三层工程档案系统（`archives.js` + 4 模块）

- **单向依赖 `archive-dossiers.js` → `archive-precipitated.js` → `archive-cabinets.js` → `archive-core.js`（外部只走 `archives.js` 42 项导出）**：
  - `archive-core.js`：统一管理锁集合、缓存、`DESKTOP_TOKEN_BUDGET` / `DESKTOP_MAX_ITEMS`、密钥脱敏 `[REDACTED]`、CJK+Latin 双语 BM25 检索引擎与 `history[]` 版本快照数据结构。
  - `archive-cabinets.js`：多柜注册与旧版数据迁移。
  - `archive-precipitated.js`：冷藏冷库管理，未人工翻出恒保持 0 字节隔离。
  - `archive-dossiers.js`：三层卷宗 CRUD、谁在看计算（`computeArchiveViewerStatus`）、`[[双链]]` 解析与暗铜失效下游预警、`rollbackHistory` 无损回滚及认知桌面预算淘汰。

---

## 五、客户端 ES Module 结构（`pkg/src/client/` 48 模块 → `client.js`）

由 [build-client.mjs](scripts/build-client.mjs) 按拓扑顺序打包为单文件 [client.js](client.js)，`package.json`、`board-schema.js`（`BACKEND_BUILD`）与 `src/client/constants.js`（`EXPECTED_BACKEND_BUILD`）版本统一对齐 `2.0.1`：

- **基础与语音引擎**：`react-runtime.js`、`constants.js`、`i18n.js`（`zh/en` 切换）、`store.js`（唯一客户端可变状态）、`utils.js`、`notify.js`、`report.js`、`custom-theme.js`（WCAG 双模派生 + 社区配色 + JSON 导入导出 + 服务端同步）、`tts.js`（TTS/ASR 播报与语音舞台驱动）与 `voice-recorder.js`（免提 VAD 与录音队列）。
- **通信与样式**：`api.js` + `api/{archives,board,chief,transport}.js`；`styles.js` + `styles/{archives,base,bubble,chief,extmem,modals,skins,tasks-flow,theme,tts,v180}.js`。
- **组件与弹窗**：`components/{common,modals,Panel}.js` + `components/modals/{intervention,pickers,safety,theme-diy,workflow}.js`（含独立「外观与主题工坊」页面与极简 `+` 控制面板）。
- **页签视图**：`tabs/{chief,tasks,tasks-flow,tasks-widgets,peers,archives,archives-cards,extmem,extmem-starfield,extmem-studio,boundaries,plan}.js`（顶栏 6 页签 `参谋 / 任务 / 协同 / 档案 / 记忆 / 边界` + `⚙️` 设置、语音舞台、2D/3D 记忆星图、档案 `🎙️ 手记` 子页签与边界单条暂挂）。
