# Changelog

All notable changes to **`dsh-chief`** (**DSH 参谋长**) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-11-16

### Added
- **Executive Chief Agentic Executor & Wishing Box (`chief-executor.js`)**:
  - Added multi-step tool-use loop inside Chief Q&A («✦ 许愿框一站式办理») governed by **4 workspace permission modes**: `read-only` (`👁 仅可查看`), `workspace-write` (`工作区内修改`), `auto-review` (`自动审查 EXP`), and `danger-full-access` (`完全权限`), supporting file reads/edits/listing/search, guarded command execution, subagent control, board/archive updates, and active compaction.
  - Added resilient fallback parsing & UI sanitization across all DSML / XML tool-call tag variants (including double fullwidth bars `<｜｜DSML｜｜ calls>`, single/mixed vertical bars, and unclosed tails), `workspaceRegistry` workspace root resolution on blank new sessions, and automatic `pending-transfer.json` staging when relaying to an unstarted `@lead`.
- **Three-Tier Archive Vaults, Desk Spotlight & System-Level 0-Token Global Cold Vault (`session` / `global` / `precipitated`)**:
  - **💬 本会话档案柜 (`session`)**: Isolated per `rootSessionId` (`registry.sessions[sess:<rootSessionId>]`), visible only to the **User, Current Session (Lead/Subagents), and Chief of Staff**. Unbound blank new chats (including the `'global'` sentinel) render an empty guidance state and never fall back to legacy global cabinets.
  - **🌐 系统全局档案柜 (`global`)**: System-level **0-Token Global Cold Vault** (`global-vault/vault-chief-global.json`)—does **not** follow conversation context (`chiefMountedSessions: []` by default) and never auto-migrates legacy `cab-main.json` cabinets. Supports **Desk Spotlight** («置上桌面»), 1-click **Distill to Global** (`/api/dsh-chief/archives/distill-to-global`), lossless download (`⤵️ 引入本会话`), Chief on-demand mounting (`👁️ 供本会话参谋参阅` / `📥 收回冷存`), and strict `session → global → precipitated` promotion gradient.
  - **🔄 Local ↔ Global Bidirectional Diff & Anti-Bleed Guards**: Live per-session diff (`computeSessionGlobalDiff`) tracks `local_only`, `synced`, `local_modified`, `global_only`, `differs`, and `unbound`, paired with isolated frontend `globalVaultItems` storage and strict stale-host version detection (`BACKEND_BUILD`).
  - **🏛️ 沉淀档案柜 (`precipitated`)**: Unified machine-wide **0-Token Precipitated Experience Vault** (`precipitated/vault-global.json`). Double-blind by default (**neither Chief nor Lead reads any entry**) until the User explicitly clicks **「📤 取出」 (`flipOut`)** for the active session, and immediately re-hidden upon **「📥 封回」 (`sealBack`)**. Supports batch checkboxes and multi-archive combinatorial relay («组合递话»).
- **Cross-Isolation Smart Compaction (`✦ 智选压缩`), `10%–95%` / Token Thresholds & `auto-continue.js`**:
  - Replaced `✦ 智设` with **`✦ 智选压缩` (`tacticalModes.smartCompact`)**: works standalone or alongside `autoCompact` to bypass hard percentage thresholds and trigger harvest-then-compact cleanly at phase boundaries after waiting for the agent to settle idle, posting visible **`✦ 智选压缩`** receipts directly in Chief chat.
  - Added deterministic execution for explicit manual compaction commands («压缩吧», `/compact`, etc.) and resolved Cordis `compaction` service isolation via `commands.execute(ag, '/compact', ...)` fallback + `sessionController.resolveAgent` wake-up, with atomic `runtimeGuard` counters that never inflate on error or no-op.
  - Unlocked configurable auto-compaction thresholds down to **`10%–95%`** (with amber `<25%` confirmation guard) or exact **token thresholds (`>= 8,000`)**, and added **`auto-continue.js`** for guarded long-horizon auto-continuation.
- **Strong Intervention Core Objective Destination & Lock, Unlimited Turns, Emergency Halt & Must-Do Gates**:
  - Dedicated **Core Objective Destination & Lock** in Strong Intervention, preserved unlimited turn limit (`0 = ∞`), **Emergency Hazard Halt** modal + kill switch, and **`allowed` Must-Do Completion Verification Gate** before goal sign-off.
  - Added natural Peer Cluster Progress sharing with zero-pollution detach cleanup, color-coded collapsible drawer mailbox with `@all` deduplication, editable & pinnable handoff (`📌 定住防改` + `frozenFromAuto` + `同步交接单` toggle), and packaged `chief-executor.js` & `auto-continue.js` inside `package.json` `files`.

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

