# Changelog

All notable changes to **`dsh-chief`** (**DSH 参谋长**) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-11-15

### Added
- **Three-Tier Archive Vaults with System-Level 0-Token Global Cold Vault & Bidirectional Diff (`session` / `global` / `precipitated`)**:
  - **💬 本会话档案柜 (`session`)**: Isolated per `rootSessionId` (`registry.sessions[sess:<rootSessionId>]`), visible only to the **User, Current Session (Lead/Subagents), and Chief of Staff**. Unbound blank new chats (including the `'global'` sentinel) render an empty guidance state and never fall back to legacy global cabinets.
  - **🌐 系统全局档案柜 (`global`)**: System-level **0-Token Global Cold Vault** (`global-vault/vault-chief-global.json`)—does **not** follow conversation context (`chiefMountedSessions: []` by default) and never auto-migrates legacy `cab-main.json` cabinets. Invisible to Lead/Subagents until copied via `⤵️ 引入本会话` (`copyToSession`). Chief sees Global entries **only** when explicitly mounted for that session (`mountChief` / `unmountChief`: 「`👁️ 供本会话参谋参阅`」 / 「`📥 收回冷存`」) or via on-demand Q&A search (`searchGlobalVaultForChief` in `askOrCommandChief`).
  - **🔄 Local ↔ Global Bidirectional Diff & Anti-Bleed Guards**: Live per-session diff (`computeSessionGlobalDiff`) tracks `local_only`, `synced`, `local_modified`, `global_only`, `differs`, and `unbound` across Session and Global cards plus a quick-push strip (`localOnlyBriefs`). Added separated frontend `globalVaultItems` store and strict stale-host guard blocking pre-restart responses missing `isSystemGlobalVault: true`.
  - **🏛️ 沉淀档案柜 (`precipitated`)**: Unified machine-wide **0-Token Precipitated Experience Vault** (`precipitated/vault-global.json`). Double-blind by default (**neither Chief nor Lead reads any entry**) until the User explicitly clicks **「📤 取出」 (`flipOut`)** for the active session, and immediately re-hidden upon **「📥 封回」 (`sealBack`)**. Live per-tier counts come from `getThreeTierArchiveCounts`.
- **Natural Peer Cluster Progress & Zero-Pollution Detach**:
  - Conversations linked into a federation cluster automatically share live progress across `PeersTab`, `getChiefView`, Chief Q&A, and `/digest` (`协同进度`), with a mandatory pre-link confirmation modal warning about mutual context pollution before joining unrelated sessions.
  - Detaching (`linked: false`) immediately purges Chief narrative cache via cluster signature validation (`clusterSig`), filters out external `team` facts (`originRootId`/`peerRootIds`), isolates detached mailbox history (`detachedFromCluster`), and blocks stale peer injection on `pre-step`.
- **Color-Coded Collapsible Drawer Mailbox & Broadcast Deduplication**:
  - Assigned deterministic theme-adaptive colors per conversation across network peers and messages.
  - Deduplicated `@all` broadcasts into single cluster-level entries and grouped mailbox history into collapsible channel drawers (`全部 | 🌐 广播 | ↔ 跨窗 | 📁 内部` + folded detached history).
- **Editable & Pinnable Handoff + Auto-Snapshot Freeze**:
  - Added manual handoff editing (`handoff.save`, `handoff.reset`), human pinning (`handoff.pin`) to block Chief overwrites, automatic freezing of the rendered preview into `customText` when pinning from auto-render mode (`frozenFromAuto`), a `同步交接单` toggle beside `提炼摘要` in `ChiefTab` (automatically disabled/locked when pinned), a pre-transfer warning modal when the handoff packet is incomplete or stale, and a friendly restart banner when the host process holds stale in-memory backend routes.
- **`✦ 智选` Co-Managed Compaction, `>= 50%` Hard-Threshold Floor & Centered Composer Controls**:
  - Replaced `✦ 智设` and context-usage ring badges/popovers with **`✦ 智选` (`tacticalModes.smartCompact`)**: when active, hard percentage thresholds are completely bypassed and compaction timing is jointly managed by Chief (`shouldCompactNow`) and Lead (`chief_board` `action: "context.compact"`) at clean phase boundaries after harvesting details to the Session Cabinet.
  - Locked `compactThresholdPct` strictly to **`50%–95%`** (preventing capability degradation from sub-50% compaction) and centered the `+` tactical trigger button inside `.dnb-sec-shell`.

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

