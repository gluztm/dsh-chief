# How `dsh-chief` Evolved: From a Right-Sidebar Notepad to a Multi-Agent Voice Hub

[简体中文 (`EVOLUTION.md`)](EVOLUTION.md) · [Back to README (`README.en.md`)](README.en.md) · [Changelog (`CHANGELOG.md`)](CHANGELOG.md) · [Architecture (`ARCHITECTURE.md`)](ARCHITECTURE.md)

---

If you check `dsh-chief`'s CSS classes, almost all of them start with `dnb-`. On line 119 of `runtime-hooks.js`, there is still a migration helper that moves legacy shared boards into per-session boards.

`dnb` stands for **DSH Notebook**.

What now runs as **53 backend modules (9 in `pkg/safety/`) + 48 frontend modules**—handling speaker-out Voice Chief alerts & wake commands, a 6-channel mobile pager, multi-origin theme syncing, bilingual BM25 / WikiLink / rollback archives, pre-execute checks, and multi-agent coordination—started from a much simpler goal: hang a notepad in the right sidebar of DeepSeek Harness (DSH), backed by one shared JSON file, so the AI stops forgetting context mid-task.

From `v1.0.0` on November 14, 2026 through `v2.0.0` on November 27, 2026 (14 days of iteration), `CHANGELOG.md` tracks changes commit by commit. This page steps back to explain what broke at each stage and why the code looks the way it does today.

---

## Architecture Evolution (`v1.0` → `v2.0`)

<div align="center">
  <img src="assets/evolution-roadmap-en.gif" alt="dsh-chief architecture evolution animation" width="900" />
</div>

```mermaid
flowchart TD
  S0["Early Idea (dnb- / notebook)\nRight-sidebar scratchpad backed by one JSON file"]
  S1["Stage 1 · v1.0.0 ~ v1.1.0\nRead-Only Sidekick: Cold Vaults + Pre-Compaction Save\n8 source files · Does not touch workspace files"]
  S2["Stage 2 · v1.2.0 ~ v1.2.1\nExecutor Tools, 4 Permission Tiers & 6-Stage Security Gate\n10 source files · client.js grows to 16,749 lines"]
  S3["Stage 3 · v1.3.0\nSplit Oversized Files, Add O_EXCL Locks & CI Guardrails\n29 backend + 16 frontend modules · Zero external deps"]
  S4["Stage 4 · v1.4.0\n9-Module Safety Kernel at tools/pre-execute\nMain chat edits code; Chief plans, reviews, and guards"]
  S5["Stage 5 · v1.5.0 ~ v1.6.0\nToken & Spend Limits: 2,400-Token Desktop + 5 Tabs\nSVG Flow Canvas · Hard Budget Breaker · Away Alerts"]
  S6["Stage 6 · v1.7.0 ~ v1.7.1\nMain Tab + Local Codex/Claude + Opt-In Sessions\nSafety Guard Toggles & False-Positive Fixes · Unified 2-Concept Guards"]
  S7["Stage 7 · v1.8.0\nBuilt-in 5-Skin Themes + Bento Beam Flow + Collab 2.0 (Gemini CLI)\nGlobal Chief Naming · Live GitHub Star Sync"]
  S8["Stage 8 · v1.9.0\nChief-Only Memory Studio (2D/3D Starfield + External Bridge) + DIY Themes\nDefault Left Rail · Guard Wall Presets v2 · 21 Live-QA Fixes"]
  S9["Stage 9 · v2.0.0\nVoice Chief Alerts & Wake + 6-Channel Mobile Pager + Multi-Origin Theme Sync\nBilingual BM25 / Rollback / WikiLinks · 3-Protocol Embedding · 53 + 48 modules"]

  S0 --> S1 --> S2 --> S3 --> S4 --> S5 --> S6 --> S7 --> S8 --> S9
```

### Size and Focus by Stage

| Stage | Versions & Dates | Code Structure | Primary Role | Core Problem Solved |
| :--- | :--- | :--- | :--- | :--- |
| Stage 1 | `v1.0.0` – `v1.1.0`<br>Nov 14 – 15 | 8 source files<br>(`client.js` 10,607 lines) | Sidebar scratchpad & co-pilot | `/compact` wiped verified paths and errors; always-on memory plugins wasted tokens |
| Stage 2 | `v1.2.0` – `v1.2.1`<br>Nov 16 – 17 | 10 source files<br>(`client.js` 16,749 lines, `chief.js` 8,008 lines) | Permission-gated assistant | Once Chief had shell/file tools, unrestricted access was risky while full lockdown was useless |
| Stage 3 | `v1.3.0`<br>Nov 18 | 29 backend + 16 frontend modules<br>(0 external npm deps) | Modular & concurrency base | 16K-line files were fragile; concurrent writes hit Windows locks; obfuscated commands slipped checks |
| Stage 4 | `v1.4.0`<br>Nov 19 | 38 backend (9 safety) + 16 frontend | Pre-execute gate across agents | Old checks only watched Chief itself, missing `@lead` & subagents; high-tier Chief hijacked edits |
| Stage 5 | `v1.5.0` – `v1.6.0`<br>Nov 20 – 21 | 38 backend + 20 frontend<br>(5 tabs + top gear) | Token & away-run control | Scattered switches hid token spend; archive growth risked bloating prompts; overnight runs needed hard caps |
| Stage 6 | `v1.7.0` – `v1.7.1`<br>Nov 22 – 23 | 44 backend (9 safety) + 39 frontend | Opt-in multi-agent hub | Narrow sidebar cramped team graphs; local `Codex` / `Claude Code` worked in silos; plain chats hit global hooks |
| Stage 7 | `v1.8.0`<br>Nov 24 – 25 | 45 backend (9 safety) + 39 frontend | Collab 2.0 & Theme System | View clutter around Org Tree; external CLIs lacked live streams & chaining; UI needed adaptive skins |
| Stage 8 | `v1.9.0`<br>Nov 26 | 50 backend (9 safety) + 45 frontend | Chief Memory Studio & DIY | Chief lacked persistent isolated memory/profile; external memory connectors needed one clean bridge |
| Stage 9 | `v2.0.0`<br>Nov 27 | **53 backend (9 safety) + 48 frontend** | **Voice Alerts & Remote Pager Hub** | Unattended failures went unnoticed away from screen; plain archives lacked BM25/links/rollback; skins needed server sync |

---

## 1. From a Sidebar Notepad to a Co-Pilot (`v1.0.0` → `v1.1.0`)

Anyone running long coding tasks with an AI runs into the same three headaches:

- Around turn 80, context fills up and `/compact` runs. Verified paths, port numbers, and stack traces disappear into a short summary, so the model reads the repo again from scratch.
- Several subagents work in parallel across separate tabs, and checking who stalled means clicking into each one.
- Typical memory plugins inject dozens of stale notes into the system prompt every turn, burning tokens and distracting the model.

`v1.0.0` targeted those three points from the right sidebar without modifying the main chat flow:

1. **Cold-Stored Archive Cabinets**: Notes lived in a four-layer archive (`Drawers -> Dossiers -> Points -> Details`). Sealed notes injected **0 bytes** into prompts and loaded only when explicitly pulled or searched.
2. **Human-Controlled Cadence & Billing Channels**: Default mode was `⏸ On-Demand` with zero background LLM calls. Manual Chief requests matched the session's exact `provider/model` channel so subscription routes did not accidentally fall back to pay-per-token billing.
3. **Save Before Compacting (`v1.1.0`)**: Right before `/compact` ran, Chief wrote active paths, commands, and findings to disk, verified the write, and then triggered compaction.

`v1.1.0` also resolved the first real compatibility bug (`Issue #1`): older DSH builds lacked the refactored subagent APIs and threw at runtime. Adding `probeSubagentSupport` let older hosts mount the panel cleanly while blocking unsupported dispatches with clear upgrade guidance.

At that stage, the notepad could watch and record, but still **could not run actions**. Even checking a quick file or triggering compaction required copy-pasting back and forth.

---

## 2. Adding File and Shell Tools, Then Adding Permission Limits (`v1.2.0` → `v1.2.1`)

`v1.2.0` added a built-in executor (`chief-executor.js`).

Typing plain instructions into the sidebar composer allowed Chief to read workspace files, search directories, organize archives, and trigger **Smart Compact** (even waking dormant sessions when host services isolated direct compaction). Storage expanded into three isolated vaults (**Session / Global / Precipitated**) with two-way diffing.

Giving an AI shell and file access immediately raised a sharper problem: leave permissions open and one bad turn can run `git reset --hard` or leak `.env` keys into notes; lock everything down and you are back to read-only.

One day later, `v1.2.1` put clear limits around execution:

- **Four Tiers, Read-Only Start**: `advisor` (read-only default), `assistant`, `strategist` (per-action approval), and `chief` (high autonomy). New and handed-off sessions always start at `advisor`.
- **Six-Stage Pipeline**: Every action goes through `User tier -> Request -> Hard guards -> Policy decision -> Executor -> Audit log`.
- **Single-Use Approvals & Instant Halt**: Under `strategist`, edits and commands pop a clear confirmation card stating what changes and why. Clicking **Allow** authorizes one run, not permanent access; upgrading to `chief` requires reading and checking a risk prompt verified by the backend; clicking the red `⏹ Halt` button stops background loops immediately.

The permission model worked, while the source tree grew unwieldy.

In four days, everything landed in **10 source files**: `archives.js` hit 2,796 lines, `index.js` hit 6,075 lines, `chief.js` hit 8,008 lines, and `client.js` reached **16,749 lines**. Tweaking one button meant scrolling past unrelated code, concurrent windows collided on Windows file locks, and long files made it easy to miss safety invariants.

---

## 3. Splitting Large Files, Adding File Locks, and Enforcing CI Checks (`v1.3.0`)

Piling more changes onto a 16,749-line file would not hold up. `v1.3.0` paused new features for structural cleanup:

- **Compatible Split**: Public exports, HTTP routes, and UI behavior stayed 100% compatible while four giant files split into **29 backend modules + 16 frontend modules**. To keep zero external runtime dependencies, a small topological bundler (`build-client.mjs`) builds `src/client/` into `client.js`.
- **CI Structural Rules**: Automated checks across Node 22 and Node 24 enforce **zero circular imports, zero mutable `export let` bindings**, and fixed export surfaces on every change.
- **Concurrency & De-Obfuscation**:
  - Board, state, and archive saves switched to `O_EXCL` spin locks with `threadId`-tagged temp files and retry jitter for Windows NTFS `EPERM / EACCES / EBUSY` errors;
  - Security verdicts moved out of mutable state JSON into an append-only `chief-audit.jsonl`;
  - Paused multi-step actions gained durable auto-resume (`resumeTasks`) after human approval;
  - Command checks learned to unwrap NFKC homoglyphs, PowerShell `-EncodedCommand` payloads, quote splits, `^` carets, and Windows NTFS ADS paths (`safe.txt:.env`).

Without stopping at `v1.3.0` to split the codebase, the standalone safety kernel and later features would have been much harder to keep bug-free.

---

## 4. Checking Actions Before Execution Without Taking Over the Main Chat (`v1.4.0`)

With the structure cleaner, two practical gaps showed up in daily runs:

1. Earlier checks guarded Chief's own executor, yet **the main chat (`@lead`) and its subagents** made most of the actual file edits and shell calls. Spotting a bad command in logs afterward was too late.
2. At higher tiers (`L2` / `L3`), Chief sometimes edited code itself when asked a quick sidebar question, stepping on `@lead`'s uncommitted work.

`v1.4.0` addressed both:

- **Standalone Safety Kernel at `tools/pre-execute`**: Security checks moved out of business modules into **9 standalone files under `pkg/safety/`**, checksum-locked alongside `chief-executor.js`. Hooking into DSH's `tools/pre-execute` meant reads, writes, and commands from `@lead`, subagents, and Chief all pass **Guard Walls** (`global` / `workspace` / `paused`) before touching disk. Users can draft rules in plain text for manual approval, and even `L3` models cannot delete or disable locked walls.
- **Lazy Delegation**: Chief focuses on planning, reviews, and guardrails. Unless you explicitly ask Chief to edit directly, workspace changes dispatch to `@lead` as `[EXECUTION_REQUEST]` items. Blank new chats start with read-only inspection and `graph.plan`, and mid-run questions slip into `@lead`'s queue as non-blocking `[INQUIRY]` cards.

That turned the plugin from a passive observer into a shared pre-execute gate across the whole agent team.

---

## 5. Controlling Prompt Tokens and Spend for Unattended Runs (`v1.5.0` → `v1.6.0`)

As features piled up, new users ran into two practical worries: too many switches made it hard to tell what spent background tokens, growing archives threatened to bloat prompts, and leaving Away Mode on overnight felt risky without hard limits.

`v1.5.0` and `v1.6.0` focused on trimming noise and adding spend limits:

- **Cognitive Desktop (`v1.5.0`)**: Like keeping only current papers on your desk and filing the rest in drawers, **only items pinned to the Cognitive Desktop (up to `2,400 Tokens / 6 items`) go into each main prompt turn**. Overflow moves back into a watch queue with `🪝` keyword hooks so agents pull older notes on demand via `archive.pull`.
- **Two Separate Control Axes & Auto-Sleep (`v1.5.0`)**: Scattered switches merged into bottom **permission tiers (`L0–L3`)** and top **run cadence (`off / patrol / managed`)**. `off` and idle `patrol` spend zero background tokens; `managed` organizes unhooked drafts quietly via **Dream Roam** (`🌙 梦境漫游`) and drops back to `off` after 15 idle minutes with zero open tasks. A 180° effort gauge (`🪄 Auto` by default) saves high reasoning effort for blocked debugging and wall drafting. Issues `#3` and `#4` also drove full light-theme popover fixes and hiding Chief buttons inside subagent panes.
- **5-Tab Layout & Away-Mode Safety Nets (`v1.6.0`)**: Merged **Plan** into **Tasks** (5 tabs: `Chief / Tasks / Peers / Archives / Guards`), moved configuration into the top-bar `⚙️` gear, and added the **SVG Flow Canvas** + click-to-expand **Org Tree**. Unattended runs gained **7 milestone alerts**, a **categorized LLM ledger + default `30 calls / 300K tokens` circuit breaker**, redacted `.md` battle report exports, three starter presets (**Observer / Co-Pilot / Away Mode**), live `zh / en` switching, and plain-language docs.

---

## 6. Direct Local CLI Collaboration, Main Tab, and Per-Session Opt-In (`v1.7.0`)

Once single-window tracking and budget caps worked reliably, daily workflows (`Issues #5` and `#6`) exposed three remaining gaps:

1. **One Machine Runs Multiple AI CLIs**: Developers often run local **`Codex`** and **`Claude Code`** alongside DSH windows, without a shared place to form squads, dispatch tasks, or enforce the same redlines.
2. **A Narrow Sidebar Runs Out of Room**: Inspecting flow graphs, peer links, and subagent rows in a thin side column feels tight, and clicking subagent buttons stacked extra split panes.
3. **Global Hooks Should Stay Out of Plain Chats (`Issue #6`)**: Once a plugin attaches to process-wide `tools/pre-execute`, intercepting plain chat windows where the user never opened Chief creates friction—especially without a UI toggle or when benign heredocs, read-only `git`/`grep` commands, or cleared `cursor.blocked` remarks trigger false alarms.

`v1.7.0` fixed all three:

- **Collaboration System & Local CLI Dispatch (`Peers` Tab)**: Redesigned the `Peers` squad canvas for `@lead`, subagents, linked windows, and local external CLIs. It discovers and dispatches local `Codex` and `Claude Code` without `ccSwitch` (including Windows `.cmd` shims and dormant workspace scans) with active redlines and Guard Walls attached, locks active squads (`HTTP 409`) with one-click `⏹ Halt`, routes external replies under cross-window pairs, filters out `Mnemon` tasks and empty `DS Bot` shells from Standby, keeps the canvas still until agents work, and gives `@lead` full squad visibility plus L2/L3 archive pull.
- **Main Tab Layout & Subagent Routing (`#5`)**: Registers a clean `Chief` / `参谋长` tab in `conversation.view`, hides the duplicate host composer while active, fits `0.2.2-rc.3` viewport height cleanly, provides independent placement/button toggles, and routes subagent clicks into **existing sidebar tabs** (`revealIfOpened: true`) with an optional split-pane toggle.
- **Opt-In Sessions, Safety Guard Switches & False-Positive Fixes (`#6`)**:
  - Switched from process-wide interception to **per-session opt-in (`sessionEnabled`)**: unactivated plain chats and their subagents pass all 8 backend hooks untouched;
  - Added human-only **per-session and global Safety Guard switches** in Settings (default on, independent of Redline Sentinel and manual Guard Walls, confirm-gated & audited, persisted across reloads);
  - Updated `isDestructiveShellCommand` to stop flagging non-executable document heredocs, `export` prefixes, `grep`/`rg`, `git log --format=`, `git commit`, and unpiped `echo`, while adding `normalizeCursorBlocked` across backend and frontend so cleared/approved remarks no longer light up red `Blocked` pills.
- **Final File Split**: Split remaining 2,000+ line files so the package runs cleanly across **44 backend modules (9 in `pkg/safety/`) + 39 frontend modules**, still with zero external npm dependencies.

---

## 7. Theme System, Unified Beam Flow & Collaboration 2.0 (`v1.7.1` → `v1.8.0`)

`v1.7.1` brought DSH `0.2.3-alpha.2` compatibility and consolidated overlapping controls into two clear concepts (`🛡️ Safety Block` and `📝 Rules for AI`). Then `v1.8.0` overhauled the ergonomics and multi-agent pipeline:

- **Built-in 5-Skin Themes & Adaptive Dials**: Introduced **Frosted Mist** alongside **Warm Paper / Botanical / Starlight / Classic Clean**, replaced boxy borders with hairline dividers, and added the theme-adaptive `EffortFanGauge`.
- **Bento Objective Ring + Unified Beam Flow**: Replaced separate Org Tree views with a single serpentine Bezier beam canvas showing subagent dispatch and return curves directly beneath steps.
- **Collaboration 2.0 & Live GitHub Star Sync**: Added `Gemini CLI` discovery, redacted live output streams, 2-hop handoff chaining (`Codex → Claude Code / Gemini CLI`), anti-self-steer routing guards, live GitHub Star sync via `gh` CLI, and 0-byte isolated custom Chief naming.

---

## 8. Chief-Only Memory Studio, External Bridges & DIY Workshop (`v1.9.0`)

With squad orchestration stable, `v1.9.0` added long-term memory and visual customization strictly scoped away from `@lead`:

- **Chief-Only Memory Studio (0-byte `@lead` isolation)**: Ships an out-of-the-box `MEMORY.md` notebook, Ebbinghaus decay/reinforcement bars, a 2D SVG / 3D Canvas Constellation Starfield, locked 5-section `USER_PROFILE.md`, and X-Ray recall testing—while opening `mcp-http`, dual-slot `chief-http`, read-only `markdown-vault` (Obsidian BM25), and `cordis-provider`.
- **DIY Theme Studio & Default Left Rail**: Derives full dark/light tokens from 4 base swatches, extracts 6-color palettes from images on `<canvas>`, stores up to 25MB wallpapers in `IndexedDB`, and ships Chief AI DIY alongside Guard Wall Presets v2 and 21 live-QA fixes.

---

## 9. Voice Chief Alerts, 6-Channel Mobile Pager & 3-Protocol Vector Archives (`v2.0.0`)

`v2.0.0` closes the loop when you step away from your desk or prefer hands-free voice supervision without giving up hard safety gates:

- **Voice Chief & Inline Voice Stage (`chief-tts.js` / `src/client/tts.js` / `voice-recorder.js`)**: Combines DeepSeek `/v1/tools/tts`, OpenAI `/v1/audio/speech`, and offline speech (scrubbing secrets and code paths) with SenseVoice + DeepSeek ASR recognition. Replaces full-screen blur with an inline Voice Stage (`Alt+V`, hands-free VAD, name-call wake) where push commands still strictly traverse L0–L3 permission approvals before touching `@lead`.
- **6-Channel Mobile Pager (`remote-pager.js`)**: Dispatches scrubbed milestone alerts to **Feishu, DingTalk, WeCom, Telegram, Discord, and HMAC-signed Webhooks** with cooldown deduplication.
- **Voice Inbox & `Archives → 🎙️ Notes` (`voice-inbox.js`)**: Queues voice notes under `~/.dsh/chief/voice-inbox/` for Dream Roam digestion into memory, profile, diary, and voice manuscripts.
- **Bilingual BM25 + Rollback + `[[WikiLinks]]` + 3-Protocol Embedding**: Upgrades Project Archives with CJK+Latin BM25 full-body ranking, 5-version `history[]` one-click rollback, bidirectional `[[Target]]` links with copper deprecation warnings, and `OpenAI / Ollama / Gemini` embedding support—plus `@iridiumgit`'s community **Tide Blue** theme, JSON palette export/import, and server-side multi-origin sync across `~/.dsh/chief/` (Issue `#7`).

---

## Before vs. After

```mermaid
flowchart TB
  subgraph Early["Early Companion (v1.0)"]
    E1["Surface: Narrow right sidebar only"]
    E2["Scope: Inside a single chat window"]
    E3["Memory: Manual cold archive pulls"]
    E4["Safety: Prompt rules + passive logs"]
    E1 --> E2 --> E3 --> E4
  end

  subgraph Current["Current Hub (v2.0)"]
    C1["Interaction: Main tab + Sidebar + Speaker Voice Alerts + 6-Channel Pager"]
    C2["Coordination: Main chat + Subagents + Peer windows + Codex / Claude / Gemini CLI"]
    C3["Memory: 2,400T Desktop + BM25/Links/Rollback + 0-Byte Starfield & Voice Notes"]
    C4["Safety: Isolated 9-module tools/pre-execute kernel + Guard Walls + Budget cap"]
    C1 --> C2 --> C3 --> C4
  end

  Early -.->|"14 days · continuous evolution to v2.0.0"| Current
```

---

## Four Lessons From These Releases

Looking back across the evolution from `v1.0` to `v2.0`, four engineering principles still hold everything together:

1. **Memory is there to save prompt tokens, not stuff every turn.**  
   Whether via the `2,400`-token Cognitive Desktop + BM25/`[[WikiLink]]` on-demand pulls or the 0-byte `@lead` isolation of Memory Studio and Voice Notes, keep main chat context clean.

2. **Put brakes and confirmations in place before giving tools.**  
   Starting read-only at `L0`, gating voice dispatch behind real L0–L3 approvals, and enforcing the 9-module `tools/pre-execute` kernel stop accidents without trapping normal workflows.

3. **Keep teams audible and reachable even when you step away.**  
   Visual beam flow, hard spend breakers, speaker-out alerts, and 6-channel mobile pagers keep long runs observable at and away from your desk.

4. **Stay quiet when not asked.**  
   Zero idle background LLM calls, untouched unactivated chats, and clear alerts only when action is genuinely needed.
