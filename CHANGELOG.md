# Changelog

All notable changes to **`dsh-chief`** (**DSH 参谋长**) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

