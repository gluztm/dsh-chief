<div align="center">

<img src="assets/chief-10s-compare.gif" alt="dsh-chief in 10 seconds: left is a plain long session — re-reading the same files, losing parameters to compaction, forgetting when you switch windows; right is Chief — one-click loop breaker, parameters vaulted before compaction, archive carried across windows, minimal report. Read-only by default, zero takeover risk." width="800" />

**Same window, same context — the left one burns budget drifting, the right one closes out.**  
<sub>Read-only by default · zero takeover risk · `dsh plugin --profile web add dsh-chief`</sub>

<br />

<img src="assets/hero-banner.png" alt="DSH Chief (dsh-chief) v1.2.0 — Wish-Driven Multi-Agent Cockpit & 3-Tier Cold Vaults" width="100%" />

<br />

# ✦ DSH Chief (`dsh-chief` · DSH 参谋长)
### DeepSeek Harness Multi-Agent Cockpit · Wishing Box Executor · 3-Tier 0-Token Cold Vaults · `✦ 智选压缩`

[![DSH Compatibility](https://img.shields.io/badge/DSH-%3E%3D%200.2.2--rc.2-38bdf8?style=flat-square)](https://dsh.deepseek.com)
[![npm version](https://img.shields.io/npm/v/dsh-chief?color=cb3837&style=flat-square)](https://www.npmjs.com/package/dsh-chief)
[![DSH Market](https://img.shields.io/badge/DSH%20Market-Listed-f59e0b?style=flat-square)](https://awesome-dsh-plugin.com/p/gluztm/dsh-chief/)
[![Bilibili Demo](https://img.shields.io/badge/Bilibili-Video%20Demo-fb7299?style=flat-square)](https://www.bilibili.com/video/BV1DqsV6QEGi)
[![SuperAgent Ready](https://img.shields.io/badge/SuperAgent-Router--Worker%20Synergy-a855f7?style=flat-square)](https://github.com/deepseek-ai/dsh-superagent-prototype)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D%2022.13-30d158?style=flat-square)](https://nodejs.org)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-0%20External-ffe033?style=flat-square)](#)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-f87171?style=flat-square)](LICENSE)

> **Stop babysitting your AI agents — state your intent in the Wishing Box for Wish-Driven One-Stop Execution (`v1.2.0`)**  
> Inspired by DeepSeek's official **[SuperAgent (`dsh-superagent-prototype`)](https://github.com/deepseek-ai/dsh-superagent-prototype)** *Router + Isolated Workers* architecture to keep focus sharp and context clean.

[简体中文 (`README.md`)](README.md) · **English** · [Changelog (`CHANGELOG.md`)](CHANGELOG.md)

</div>

---

## 🔗 Core Highlights Wired Into DSH Runtime

- **Persistent Router Cockpit**: Unifies the root coordinator, subagents, and linked DSH windows inside one **Full-Spread Pyramid DAG**—zero blind tab switching.
- **Native Split-Pane Streams (`subagentchat`)**: Click `分屏` on any subagent node to open DSH's native `sidebarRight.openResource` live stream.
- **4-Tier Permission Model & 6-Stage Security Pipeline (`chief-executor.js`)**: Every new session starts safely in `L0 Advisor (READ ONLY)` and steps up cleanly through `L1 Assistant`, `L2 Strategist (Per-Action Approval Popup)`, and `L3 Chief of Staff (Mandatory Risk Checkbox + Backend Enforcement)`, backed by Safety Guard hard rules and a live audit log.
- **Ready on Blank New Sessions**: Resolves workspace root via `workspaceRegistry` even before turn 1 in the main chat, and stages `@lead` relays cleanly in `pending-transfer.json`.
- **Objective Lock & Human Sign-Off**: Strong Intervention locks your Core Objective (`0 = ∞` turns supported), verifies `allowed` must-do items, and waits for your explicit **`✅ 批准结项`** click.
- **Cross-Isolation `✦ 智选压缩` & Flexible Thresholds**: Compacts via DSH `/compact` across Cordis service isolation (and wakes dormant agents via `sessionController.resolveAgent`), supporting `10%–95%`, `>= 8,000` tokens, or direct `"压缩吧"` commands.
- **Three-Tier 0-Token Cold Vaults**: Isolates **Session Cabinet**, **System Global Cold Vault** (with live Local ↔ Global diff), and **Double-Blind Precipitated Vault**, spotlighted only via **`📌 摆上桌面`**.
- **Clean Cross-Window Linking & Pinnable Handoffs**: Warns before linking sessions, purges external context immediately on detach, and locks snapshots via **`📌 定住防改`**.

---

## 💡 6 Daily Engineering Pain Points — Solved

Ordinary Todo plugins give you another scratchpad; always-on memory plugins flood every system prompt with stale noise. **`dsh-chief` turns human micromanagement into Wish-Driven One-Stop Execution:**

### 1. Agents Stop Halfway ("I edited the file, please test it yourself")
- **Typical Plugins**: Static checklists let agents self-declare victory.
- **`dsh-chief`**: Locks the Core Objective with Strong Intervention (`0 = ∞`), verifies `allowed` must-do checks, and blocks exit until you click **`✅ 批准结项`**.
- **Instant Override**: High-risk checks prompt first, and the red **`⏹ 急停`** button halts background drives immediately.

### 2. "Lobotomy" Amnesia Right After Context Compaction
- **Typical Plugins**: Auto-compaction wipes out freshly discovered file paths, commands, and errors.
- **`dsh-chief`**: Triggers **`✦ 智选压缩`** when idle at phase boundaries, custom **`10%–95%` / `>= 8k`** thresholds, or direct `"压缩吧"` requests.
- **Atomic Guarantee**: Harvests and disk-verifies notes in the Session Cabinet before `/compact`, never inflating counters on failures or empty no-ops.

### 3. Bloated Memory Injections Mudding the Model's Brain
- **Typical Plugins**: Re-injects megabytes of old logs every turn, burning quota and confusing current reasoning.
- **`dsh-chief`**: All three cold vaults remain **0 bytes / 0 tokens while sealed** (Precipitated Vault is double-blind to both Lead and Chief).
- **On-Demand Precision**: Injects only items explicitly spotlighted via **`📌 摆上桌面`** or flipped out via **`📤 取出`**.

### 4. Chat-Only "Mascot Copilots" or Unbounded Auto-Execution
- **Typical Plugins**: Either powerless chat sidebars or all-or-nothing yolo modes without an audit trail.
- **`dsh-chief`**: Enforces a **4-Tier Permission Model × 6-Stage Unified Security Pipeline** (`User Mode → Action Request → Safety Guard Hard Rules → Permission Gate → Executor → Audit Log`):
  - **L0 · Advisor (`READ ONLY` · Default)**: Strict default on every new or handed-off session—inspects boards/files and advises only.
  - **L1 · Assistant (`ASSISTANT`)**: Maintains Chief memory, vaults, and board config; still blocks direct workspace edits and lead/subagent takeover.
  - **L2 · Strategist (`ADVISOR WITH APPROVAL`)**: Can propose workspace edits, commands, and lead/subagent steering—pops an **Operation Approval Modal** (`Operation / Target / Reason / Impact`) before each controlled action runs once.
  - **L3 · Chief of Staff (`CHIEF OF STAFF`)**: Full autonomous coordination across lead and subagents; requires acknowledging the **High-Privilege Risk Notice checkbox** plus backend `confirmedChiefRisk` enforcement.
  - **Model Elevation & Differentiated Strong Intervention**: Models can formally request privilege elevation (`request_permission_elevation` / `permission.request`), and Strong Intervention adapts its autonomy cleanly across L0–L3.

### 5. Cramped Subagent Views & Verbal Rules Forgotten in 10 Turns
- **Typical Plugins**: Tiny scroll boxes hide blocked workers, and safety instructions scroll out of context.
- **`dsh-chief`**: Full-spread Pyramid DAG + native split-pane stream viewer + **`📌` Global Thumbtack Redlines** persisted across tasks.

### 6. Lost Setup Across Windows & Silent Metered-API Quota Drain
- **Typical Plugins**: New tabs wipe your coordinator rules, while background loops hit expensive metered APIs.
- **`dsh-chief`**: Defaults to **`⏸ On-Demand` (0 background LLM calls)**, strictly aligns `Provider / Model` channels, and clones setup via 1-click Chief handoff.

---

## 📸 Visual Tour (`v1.2.0` 7 High-DPI Views)

### 01 · Wish-Driven Chief Cockpit (`参谋` Tab)
- **4-Tier Permission & Tactical Bar**: Compact `+` trigger on the left with live pills above (`⚡ 强介入 0/♾️`, `✦ 智选压缩`, `🛡 红线哨兵`, `🔵 完全权限`, and `⏹ 急停`).
- **Clear Execution & Compaction Receipts**: Live status narrative, boundary approval cards, and visible `✦ 智选压缩` chat receipts side-by-side.
- **Handoff Sync Toggle**: `同步交接单` control right in the cockpit header.

![01 - Wish-Driven Chief Cockpit Overview](assets/screenshots/01-chief-cockpit-overview.png)

---

### 02 · Full-Spread Pyramid Subagent DAG (`任务` Tab)
- **Zero Cramped Panning**: Root Coordinator sits cleanly at the apex while subagent lanes spread vertically below.
- **Inline Squad Controls**: Transition statuses, ask for plain-language explanations, dispatch tasks, or launch native `分屏` live streams in one click.

<div align="center">
  <img src="assets/screenshots/02-full-spread-pyramid-dag.png" alt="02 - Full-Spread Pyramid Task Topology" width="76%" />
</div>

---

### 03 · Three-Tier 0-Token Cold Vaults & Bidirectional Diff (`档案` Tab)
- **Strict Vault Switcher**: Toggle **💬 Session Cabinet**, **🌐 System Global Vault**, and **🏛️ Precipitated Cold Vault** cleanly from the top bar.
- **4-Tier Paperclip Organization**: Cabinets → Drawers → Gold / Silver / Copper paperclipped dossiers → Unfoldable points & sub-points.
- **Spotlight & Diff Tracking**: Tracks `Synced` / `Local Modified` / `Local Only` diffs; inject selectively via **`📌 摆上桌面`** or send multi-archive **combinatorial relays**.

<div align="center">
  <img src="assets/screenshots/03-cold-archive-cabinet.png" alt="03 - Three-Tier Cold Vaults and Bidirectional Diff" width="68%" />
</div>

---

### 04 · Goal Supervision, Step Q&A & Closure Gate (`规划` Top)
- **Core Objective Lock**: Click **`🎯 设为目标`** to supervise long-horizon goals (locked automatically while Strong Intervention is active).
- **Interactive Step Board**: Click any step to ask Chief *"Why does this step exist?"* without interrupting the main session.

<div align="center">
  <img src="assets/screenshots/04-dual-tier-goal-and-step-qa.png" alt="04 - Goal Supervision and Step Q&A" width="68%" />
</div>

---

### 05 · Cross-Window Peer Linking & Drawer Mailbox (`协同` Tab)
- **Cluster Federation**: Link multiple independent DSH windows to share real-time progress, with instant zero-pollution cleanup on detach.
- **Color-Coded Drawer Mailbox**: Deduplicates `@all` broadcasts and groups messages by channel scope.
- **Lossless Image Staging**: Uploaded screenshots persist directly in `<cwd>/.dsh-chief/uploads/` for multimodal lead fallback.

<div align="center">
  <img src="assets/screenshots/05-cross-session-collab-bus.png" alt="05 - Cross-Window Linking and Mailbox" width="68%" />
</div>

---

### 06 · `📌` Global Thumbtack Redlines & Proposals (`边界` Tab)
- **Task vs. Global Scope**: Pin critical rules with **`📌`** to enforce globally across projects; leave unpinned rules scoped to the active session.
- **Must-Do & Boundary Governance**: Manage `allowed`, `forbidden`, and `notes` rules, approve worker proposals, or consolidate scattered entries cleanly.

<div align="center">
  <img src="assets/screenshots/06-pinned-bounds-and-handoff.png" alt="06 - Global Thumbtack Redlines" width="68%" />
</div>

---

### 07 · Cross-Session Relay, `📌 定住防改` & 1-Click Deployment (`规划` Bottom)
- **Editable & Pinnable Handoff**: Freeze auto-rendered snapshots cleanly via **`📌 定住防改`** (automatically locking auto-sync overwrites).
- **4 Scoped Archive Policies**: Choose `None`, `Spotlight Only`, `Entire Drawer`, or `Full Session Cabinet`—while Precipitated Vault stays isolated.
- **1-Click Chief Deployment & `idle-guard`**: Clones Chief config safely (forcing Strong Intervention off) to a fresh or target session.

<div align="center">
  <img src="assets/screenshots/07-session-handoff-and-guard.png" alt="07 - Cross-Session Relay and Pinnable Handoff" width="68%" />
</div>

---

## ⚠️ Usage Notes & Two Critical Disclaimers

> [!IMPORTANT]
> Keep these two engineering realities in mind before enabling Wishing Box tools, **`⚡ Strong Intervention`**, or **`✦ 智选压缩`**:
>
> 1. **Safety Floor From Plugin Guardrails — Intelligence Ceiling From Your Underlying LLM**
>    - `dsh-chief` guarantees the engineering floor (0-token vault isolation, 4 permission modes, verified pre-compact harvesting, circuit breakers, and `⏹ 急停`).
>    - However, planning rigor, multi-step tool precision, and supervision quality **depend directly on the LLM you assign to DSH Chief**.
>    - Use a strong reasoning flagship model for Chief on complex projects rather than expecting frontier orchestration from tiny models.
> 2. **Avoid Flooding the Model's Brain With Heavy External Prompt Injections**
>    - Do **not** stack huge System Prompts, hundreds of conflicting project Rules, or always-injected memory plugins alongside `dsh-chief`.
>    - **Bloated injections muddy working memory and fracture attention**, frequently clashing with Chief supervision and causing loops or early trips.
>    - Keep global prompts lean and store low-frequency context inside `dsh-chief`'s **0-Token Cold Vaults** for on-demand retrieval.

---

## ⚡ Quick Installation (Zero External Dependencies)

Search **`dsh-chief`** inside [dshmarket](https://github.com/dsh-market/dsh-market) / DSH Plugin Market, or install via CLI (replace `desktop` with `web` for web profile):

```bash
# Option 1: Install from npm registry (recommended — fastest mirrors + auto-update notices)
dsh plugin --profile desktop add dsh-chief

# Option 2: Install the latest published GitHub Release tarball (v1.2.0)
dsh plugin --profile desktop add https://github.com/gluztm/dsh-chief/releases/download/v1.2.0/dsh-chief-1.2.0.tgz

# Option 3: Install directly from GitHub repository
dsh plugin --profile desktop add github:gluztm/dsh-chief
```

### Host Version Compatibility Matrix

| DeepSeek Harness (DSH) Version | Panel / Board / 3-Tier Vaults / Wishing Box | Named Subagent Tree (`task.dispatch` / `team.*`) | Notes |
| :--- | :---: | :---: | :--- |
| **`>= 0.2.2-rc.2` (`rc.3+` recommended)** | ✅ Full support | ✅ Full support | Native `subagents.resolveName` / `rootOf` / `namesOf` |
| `0.2.0 ~ 0.2.2-rc.1` | ✅ Panel works normally | ⚠️ Upgrade banner | Safely guards `team.*` calls with upgrade guidance |

---

## 🛠️ Model Tool Suite (4 Tools)

| Tool Name | Purpose | Key Actions |
| :--- | :--- | :--- |
| **`chief_board`** | Task DAG orchestration, step lists, archive search, inter-agent mail, elevation request, smart compaction | `graph.plan`, `task.add`, `task.update`, `plan.set`, `cursor.set`, `mail.send`, `archive.save`, `archive.search`, `bounds.propose`, `permission.request`, `context.compact` |
| **`chief_memory`** | Session-scoped hot digest items (`decisions`, `progress`, `verify`, `risks`) | `list`, `get`, `add`, `update`, `remove` |
| **`chief_boundaries`** | Global thumbtack redlines (`📌`), must-do checks (`allowed`), and notes | `get`, `set`, `add`, `pin`, `remove` |
| **`chief_handoff`** | Generate self-contained cross-session Markdown handoff packets | `preview` / session relay |

---

## 🛡️ Security & Local-Only Privacy

- **Atomic Exclusive File Locks**: Prevents corruption on `board.json` and 3-tier archive files even under concurrent writes.
- **Zero-Leak 0-Token Vaults**: Sealed dossiers inject **0 bytes** into lead/chief prompts until explicitly pinned to Desk or flipped out.
- **25 Same-Origin Loopback Routes**: Every `/api/dsh-chief/*` endpoint validates loopback origin and host headers.
- **Regex Secret Blocker**: Blocks accidental persistence of `sk-*`, `ghp_*`, Bearer tokens, and OpenSSH private keys; 100% local under `~/.dsh/chief/` with zero telemetry.

---

## 📄 License

Licensed under **[GNU Affero General Public License v3.0 (`AGPL-3.0-only`)](LICENSE)**.
