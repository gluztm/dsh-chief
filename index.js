/**
 * DSH Chief 宿主装配中枢与公共入口 (详契见 ./ARCHITECTURE.md)
 *
 * 模块：index.js (DI Hub)
 * 职责：唯一持有全局 `hostState` 与 `deps` 注入总线；按固定拓扑装配 7 个后端模块并注册 Cordis 插件生命周期。
 * 允许依赖：./board-store.js、./subagent-runtime.js、./board-actions.js、./model-tools.js、./api-routes.js、./runtime-hooks.js
 * 禁止依赖：禁止任何 `board-*` / `subagent-*` / `api-routes` / `model-tools` / `runtime-hooks` 反向导入 `./index.js`；
 *           各工厂间严禁直接静态互导（统一通过 `deps` 延迟解析 peer 辅助函数），严禁产生第二个 `caches`/`heldLocks`。
 * 公开 API：apply, resolveWorkspaceIdForSession, getSessionCwd, executeHostSessionCompaction, deployStateToTargetChief, transferChief (6 个)
 * 持有状态：唯一进程级 `hostState` (activeRuntime, activeLlm, activeAutoContinue, autoSteeredTurns, subagentRootMap, subagentTreeCache, handoffSeq) 与 `deps`
 * 副作用：挂载 Cordis hooks (`apply(ctx)`)、注册 27 条 HTTP 路由、注册 4 个模型工具、驱动 AutoContinue。
 * 安全边界：HTTP 入口强制走 api-routes `guard()` (`requestRejection` 401/403) + `BODY_LIMIT`；保留 `subagent-runtime` 的 `opendesign` 防崩补丁。
 */

import { createBoardStore } from './board-store.js'
import { createModelTools } from './model-tools.js'
import { createApiRoutes } from './api-routes.js'
import { createBoardActions } from './board-actions.js'
import { createSubagentRuntime } from './subagent-runtime.js'
import { createRuntimeHooks } from './runtime-hooks.js'

/**
 * Process-wide mutable host state shared cleanly across all injected modules
 * without creating circular ES module imports or duplicate Map/cache instances.
 */
const hostState = {
  // Active Cordis runtime locator captured in apply(ctx)
  activeRuntime: null,
  // Active host LLM service injected via ctx.inject(['llm'])
  activeLlm: null,
  // Active Auto-Continue engine instance cleaned up on plugin dispose
  activeAutoContinue: null,
  // Recent idle/loop steer timestamps keyed by `sessionId:turn`
  autoSteeredTurns: new Map(),
  // Child subagent id -> root session id lineage map
  subagentRootMap: new Map(),
  // Cached subagent roster rows keyed by root session id
  subagentTreeCache: new Map(),
  // Monotonic sequence counter for injected handover message envelopes
  handoffSeq: 0,
}

/**
 * Central dependency injection bus populated once at module initialization.
 * Each factory resolves peer module helpers through `deps` at call time so
 * static module graphs remain strictly acyclic while preserving singleton locks.
 */
const deps = {
  hostState,
}

// ---------------------------------------------------------------------------
// Dependency Injection Wiring Order
// ---------------------------------------------------------------------------
// Factories do not statically import one another; each module receives the
// shared `deps` container and binds peer helpers lazily inside its closure.
// Registration order below populates `deps` deterministically before any
// request handler, model tool, or Cordis lifecycle hook executes.
// ---------------------------------------------------------------------------

// 1) Storage layer: single `caches` Map and `heldLocks` Set for the process
const boardStore = createBoardStore(deps)
Object.assign(deps, boardStore)

// 2) Subagent & workspace runtime bridge
const subagentRuntime = createSubagentRuntime(deps)
Object.assign(deps, subagentRuntime)

// 3) Board mutations, handoff composition & cross-session deployment
const boardActions = createBoardActions(deps)
Object.assign(deps, boardActions)

// 4) Model-facing tool definitions (`chief_board`, `chief_memory`, etc.)
const modelTools = createModelTools(deps)
Object.assign(deps, modelTools)

// 5) Same-origin HTTP endpoints & connection rejection guards
const apiRoutes = createApiRoutes(deps)
Object.assign(deps, apiRoutes)

// 6) Cordis lifecycle hooks & plugin boot
const runtimeHooks = createRuntimeHooks(deps)
Object.assign(deps, runtimeHooks)

// ---------------------------------------------------------------------------
// Public Host Exports (names, types & parameter arities preserved verbatim)
// ---------------------------------------------------------------------------

/**
 * Resolve the DSH workspaceId associated with a session's working directory.
 *
 * @param {object} runtime - DSH host runtime service locator.
 * @param {string} sessionId - Target session or subagent identifier.
 * @returns {string} Matched workspace ID or empty string.
 */
export function resolveWorkspaceIdForSession(runtime, sessionId) {
  return deps.resolveWorkspaceIdForSession(runtime, sessionId)
}

/**
 * Resolve the real filesystem working directory (cwd) for a session.
 *
 * @param {object} runtime - DSH host runtime service locator.
 * @param {string} sessionId - Target session identifier.
 * @returns {string} Workspace directory path.
 */
export function getSessionCwd(runtime, sessionId) {
  return deps.getSessionCwd(runtime, sessionId)
}

/**
 * Trigger native host session compaction across Cordis command boundaries.
 *
 * @param {object} rt - DSH host runtime service locator.
 * @param {string} sid - Target session identifier.
 * @param {string} cmdId - Compaction command identifier.
 * @returns {Promise<object>} Compaction execution result.
 */
export async function executeHostSessionCompaction(rt, sid, cmdId) {
  return deps.executeHostSessionCompaction(rt, sid, cmdId)
}

/**
 * Deploy Chief state, tasks, plans, bounds, and optional archives into a target session.
 *
 * @param {object} runtime - DSH host runtime service locator.
 * @param {object} [opts] - Cross-session handover and archive transfer options.
 * @returns {object} Deployment summary report.
 */
export function deployStateToTargetChief(runtime, opts = {}) {
  return deps.deployStateToTargetChief(runtime, opts)
}

/**
 * Package a handover packet and deploy or stage transfer to a new or live session.
 *
 * @param {object} runtime - DSH host runtime service locator.
 * @param {object} args - Transfer arguments (`target`, `deployChief`, archive policy).
 * @param {string} sessionId - Originating session identifier.
 * @returns {Promise<object>} Transfer outcome payload.
 */
export async function transferChief(runtime, args, sessionId) {
  return deps.transferChief(runtime, args, sessionId)
}

/**
 * Cordis plugin entry point registering lifecycle hooks, routes, and model tools.
 *
 * @param {object} ctx - Cordis host plugin context.
 * @returns {void}
 */
export function apply(ctx) {
  return deps.apply(ctx)
}
