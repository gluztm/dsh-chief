/**
 * board-handoff.js — 边界汇总、长程交接单生成与跨会话状态投放部署辅助模块
 *
 * 【核心职责】
 *   为 `board-actions.js` 的 `createBoardActions(deps)` 提供档案归属解析（`archiveTarget`）、
 *   边界聚合（`boundaries`）、叙事交接单推导（`resolveEffectiveHandoff`）、档案摘取收集、
 *   以及跨会话 `deployStateToTargetChief` / `transferChief` 投递实现。
 *
 * 【边界约定】
 *   - 无全局可变状态，通过 `createBoardHandoffHelpers(deps, shared)` 与主动作分发器共享纯函数契约。
 */

import fs from 'node:fs'
import { planFromTodos, objectiveFromGoal, planSignature } from './digest.js'
import { renderHandoff } from './handoff.js'
import {
  loadChiefState,
  resolveWorkspaceConfig,
  deployChiefWorkspaceState,
  hasValidChiefRiskAck,
} from './chief.js'
import {
  resolveProjectKey,
  listArchiveHeaders,
  copyArchivesBetweenSessionsOrCabinets,
  getTakenOutArchivesForSession,
  getTakenOutGlobalForSession,
  getFlippedOutPrecipitatedForSession,
} from './archives.js'
import {
  DEFAULT_CHIEF_PERMISSION_MODE,
  normalizePermissionMode,
} from './chief-executor.js'
import {
  newId,
  nowMs,
  emptyBoard,
  str,
  asBool,
  normalizeTask,
  BOUND_FIELDS,
  BOUND_CAP,
  normalizeBounds,
  pushLog,
  safe,
} from './board-schema.js'

export function createBoardHandoffHelpers(deps, shared) {
  const agentOf = (...args) => deps.agentOf(...args)
  const boardFile = (...args) => deps.boardFile(...args)
  const boardFileFor = (...args) => deps.boardFileFor(...args)
  const boardForSession = (...args) => deps.boardForSession(...args)
  const clearPending = (...args) => deps.clearPending(...args)
  const clearPendingDeploy = (...args) => deps.clearPendingDeploy(...args)
  const fetchTeamTasks = (...args) => deps.fetchTeamTasks(...args)
  const getSessionCwd = (...args) => deps.getSessionCwd(...args)
  const isInternalProfileCwd = (...args) => deps.isInternalProfileCwd(...args)
  const loadBoard = (...args) => deps.loadBoard(...args)
  const makeChiefDeps = (...args) => deps.makeChiefDeps(...args)
  const readPending = (...args) => deps.readPending(...args)
  const readPendingDeploy = (...args) => deps.readPendingDeploy(...args)
  const resolveBoundRootSid = (...args) => deps.resolveBoundRootSid(...args)
  const resolveRootSessionId = (...args) => deps.resolveRootSessionId(...args)
  const resolveWorkspaceIdForSession = (...args) => deps.resolveWorkspaceIdForSession(...args)
  const saveBoard = (...args) => deps.saveBoard(...args)
  const sessionName = (...args) => deps.sessionName(...args)
  const withBoardLock = (...args) => deps.withBoardLock(...args)
  const writePending = (...args) => deps.writePending(...args)
  const writePendingDeploy = (...args) => deps.writePendingDeploy(...args)
  const isObjectiveLockedByIntervention = (...args) => shared.isObjectiveLockedByIntervention(...args)

  function boundaries(runtime, sessionId) {
    const wd = runtime.get('workingDirectory')
    const sandboxPolicy = runtime.get('sandboxPolicy')
    const webApp = runtime.get('webApp')
    const tools = runtime.get('tools')
    const file = boardFile()
    const agent = agentOf(runtime, sessionId)
    const session = agent && agent.session ? agent.session : undefined
    const resolvedSessionId = str(agent && agent.id, '') || str(sessionId, '') || null
    const sessionResolved = !!(agent && agent.session)
    return {
      workingDirectory: safe(() => wd.defaultDirectory, process.cwd()),
      sandboxMode: safe(() => sandboxPolicy.defaultMode, 'unknown'),
      workspaceRoot: safe(() => sandboxPolicy.workspaceRoot, null),
      extraWritableRoots: safe(() => sandboxPolicy.additionalWritableRoots, null),
      profile: process.env.DSH_PROFILE || null,
      dshHome: process.env.DSH_HOME || null,
      boardFile: file,
      boardExists: safe(() => fs.existsSync(file), false),
      webUrl: safe(() => webApp.getAdvertisedUrl(), null),
      toolCount: safe(() => tools.definitions().length, null),
      sessionId: resolvedSessionId,
      sessionResolved,
      sessionWorkingDirectory: session ? safe(() => wd.get(session), null) : null,
      sessionSandboxMode: session ? safe(() => sandboxPolicy.resolve({ session }).mode, null) : null,
      sessionSandboxOverride: session ? safe(() => sandboxPolicy.overrideOf(session) ?? null, null) : null,
      liveAgents: safe(() => (runtime.get('agents').list() || []).map(agent => ({
        id: String(agent.id),
        canInject: typeof agent.inject === 'function',
      })), []),
      pendingTransfer: readPending() ? true : false,
      pid: process.pid,
      platform: process.platform,
      node: process.version,
      cwd: process.cwd(),
    }
  }

  function archiveTarget(runtime, sessionId, optOrId = '') {
    const opts = optOrId && typeof optOrId === 'object'
      ? optOrId
      : { cabinetId: typeof optOrId === 'string' ? optOrId : '' }
    const vaultScope = opts.vaultScope === 'global' ? 'global' : 'session'
    const sid = String(sessionId || '').trim()
    const rootSid = resolveBoundRootSid(sid)
    let cabinetId = vaultScope !== 'global' && typeof opts.cabinetId === 'string' ? opts.cabinetId.trim() : ''
    if (vaultScope !== 'global' && !cabinetId && rootSid) {
      try {
        cabinetId = loadBoard(boardFileFor(rootSid)).activeCabinetId || ''
      } catch {}
    }
    return {
      customSharedBoardFile: boardFile(),
      cwd: getSessionCwd(runtime, rootSid || (sid !== 'global' ? sid : '')),
      vaultScope,
      ...(vaultScope !== 'global' && rootSid ? { rootSessionId: rootSid } : {}),
      ...(vaultScope !== 'global' && cabinetId ? { cabinetId } : {}),
    }
  }

  function composeHandoffFromNarrative({ board, narrativeText = '', cluster = [] } = {}) {
    const b = board || emptyBoard()
    const lines = ['# 交接单（参谋长提炼同步版）', '']
    if (b.objective) {
      lines.push('## 总目标', `- ${b.objective}`, '')
    }
    if (b.cursor && (b.cursor.step || b.cursor.next || b.cursor.blocked)) {
      lines.push('## 当前断点', `- 当前步骤：${b.cursor.step || '无'}`, b.cursor.next ? `- 下一步：${b.cursor.next}` : '', b.cursor.blocked ? `- 阻塞点：${b.cursor.blocked}` : '', '')
    }
    if (narrativeText) {
      lines.push('## 参谋长态势研判与进展摘要', narrativeText.trim(), '')
    }
    const openSteps = (b.plan || []).filter(s => s && !s.done)
    if (openSteps.length) {
      lines.push('## 待推进计划', ...openSteps.slice(0, 8).map((s, i) => `${i + 1}. ${s.text}`), '')
    }
    const openTasks = (b.tasks || []).filter(t => t && t.status !== 'done')
    if (openTasks.length) {
      lines.push('## 未完任务', ...openTasks.slice(0, 8).map(t => `- [${t.status}] #${t.id} ${t.title}${t.note ? `（${String(t.note).slice(0, 100)}）` : ''}`), '')
    }
    const fb = (b.bounds && b.bounds.forbidden) || []
    const al = (b.bounds && b.bounds.allowed) || []
    const nt = (b.bounds && b.bounds.notes) || []
    if (fb.length || al.length || nt.length) {
      lines.push('## 生效红线与工作边界')
      if (fb.length) lines.push(...fb.slice(0, 6).map(x => `- 🚫 禁止：${x}`))
      if (al.length) lines.push(...al.slice(0, 4).map(x => `- ✅ 必做：${x}`))
      if (nt.length) lines.push(...nt.slice(0, 4).map(x => `- 📌 注意：${x}`))
      lines.push('')
    }
    if (Array.isArray(cluster) && cluster.length > 1) {
      lines.push(`## 当前协同网络`, `- 已联通协同群组共 ${cluster.length} 个独立会话。`, '')
    }
    return lines.filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n').slice(0, 12000)
  }

  function resolveEffectiveHandoff(runtime, sessionId, board, extraTeamTasks = undefined) {
    const b = board || emptyBoard()
    const h = b.handoff || {}
    const rootSid = sessionId ? (resolveRootSessionId(sessionId) || sessionId) : ''
    const customText = typeof h.customText === 'string' ? h.customText.trim() : ''
    const pinned = Boolean(h.pinned)
    const syncOnDigest = Boolean(h.syncOnDigest)

    const teamTasks = extraTeamTasks !== undefined
      ? extraTeamTasks
      : fetchTeamTasks(runtime, sessionId ? { id: sessionId } : null)
    const takenOutArchives = rootSid ? collectTakenOutAndFlipped(runtime, rootSid, b.activeCabinetId) : []
    const autoText = renderHandoff(b, boundaries(runtime, sessionId), 5200, sessionId, {
      teamTasks,
      takenOutArchives,
    })

    const effectiveText = customText ? h.customText : autoText
    let chiefNarrativeAt = 0
    let chiefNarrativeText = ''
    try {
      const st = loadChiefState()
      const ws = st && st.workspaces && st.workspaces[rootSid || 'global']
      if (ws && ws.narrative && ws.narrative.text) {
        chiefNarrativeText = ws.narrative.text
        chiefNarrativeAt = Number(ws.narrative.at) || 0
      }
    } catch {}

    const updatedAt = Number(h.updatedAt) || Number(h.at) || 0
    const hasRichWork = Boolean(b.objective || (b.plan && b.plan.length) || (b.tasks && b.tasks.length) || (b.memory && b.memory.length))
    const isIncomplete = !effectiveText.trim() || (!customText && !b.objective && !(b.tasks && b.tasks.length) && !(b.plan && b.plan.length))
    const isStale = !pinned && Boolean(
      hasRichWork && (
        (chiefNarrativeText && h.source !== 'human' && chiefNarrativeAt > updatedAt + 2000)
        || (Number(b.updatedAt) > updatedAt + 60_000 && !customText)
      ),
    )

    return {
      text: effectiveText,
      autoText,
      source: customText ? (h.source || 'human') : 'auto',
      isCustom: Boolean(customText),
      pinned,
      pinnedAt: Number(h.pinnedAt) || 0,
      pinnedBy: h.pinnedBy || '',
      updatedAt,
      handoffAt: Number(h.at) || 0,
      syncOnDigest,
      isIncomplete,
      isStale,
      hasNarrativeUpdate: Boolean(chiefNarrativeText && chiefNarrativeAt > updatedAt + 2000),
    }
  }

  /** Combine Session-Cabinet mounted items with explicitly flipped precipitated entries (NEVER reads Global Cabinet!). */
  function collectTakenOutAndFlipped(runtime, rootId, cabinetId = '') {
    if (!rootId) return []
    const targetOpt = archiveTarget(runtime, rootId, { cabinetId, vaultScope: 'session' })
    const working = getTakenOutArchivesForSession(rootId, targetOpt).map(e => ({
      ...e,
      _deskScope: 'session',
      folderLabel: `本局桌面/${e.folder || '档案'}`,
      title: `[桌面强调·本局] ${e.title}`,
    }))
    const globalTargetOpt = archiveTarget(runtime, rootId, { cabinetId: '', vaultScope: 'global' })
    const takenGlobal = getTakenOutGlobalForSession(rootId, globalTargetOpt).map(e => ({
      ...e,
      _deskScope: 'global',
      folderLabel: `全局桌面/${e.folder || '经验'}`,
      title: `[桌面强调·全局] ${e.title}`,
    }))
    const state = loadChiefState()
    const ws = state && state.workspaces && state.workspaces[rootId]
    const flippedIds = ws && Array.isArray(ws.flippedPrecipitatedIds) ? ws.flippedPrecipitatedIds : []
    let mappedFlipped = []
    if (flippedIds.length) {
      const projectKey = resolveProjectKey(targetOpt.cwd)
      const flippedEntries = getFlippedOutPrecipitatedForSession(projectKey, rootId, true, targetOpt)
      mappedFlipped = flippedEntries.map(e => ({
        ...e,
        _deskScope: 'precipitated',
        folder: e.category || 'contracts',
        folderLabel: `沉淀桌面/${e.category || '经验'}`,
        title: `[桌面强调·沉淀] ${e.title}`,
      }))
    }
    return [...working, ...takenGlobal, ...mappedFlipped]
  }

  /** Collect digest-safe archive context for Lead/Subagent prompt: ONLY desk-spotlight items + Chief-curated session hooks (0 raw/global/cold leak!). */
  function collectDigestArchiveContext(runtime, rootId, cabinetId = '') {
    const takenOutArchives = rootId ? collectTakenOutAndFlipped(runtime, rootId, cabinetId) : []
    let sessionHookedArchives = []
    let desktopUsedTokens = 0
    if (rootId && rootId !== 'global') {
      try {
        const targetOpt = archiveTarget(runtime, rootId, { cabinetId, vaultScope: 'session' })
        const hdrRes = listArchiveHeaders(rootId, { vaultScope: 'session', includeCounts: false }, targetOpt)
        if (hdrRes && hdrRes.ok) {
          desktopUsedTokens = Number(hdrRes.desktop && hdrRes.desktop.usedTokens) || 0
          sessionHookedArchives = (Array.isArray(hdrRes.items) ? hdrRes.items : [])
            .filter(it => it && it.hasHook && !it.takenOut)
            .slice(0, 6)
            .map(it => ({
              id: it.id,
              title: it.title,
              folder: it.folder,
              hookKeywords: Array.isArray(it.hookKeywords) ? it.hookKeywords : [],
              hookCue: it.hookCue || '',
            }))
        }
      } catch {}
    }
    let smartCompactActive = false
    let chiefPermissionMode = DEFAULT_CHIEF_PERMISSION_MODE
    if (rootId) {
      try {
        const st = loadChiefState()
        const cfg = resolveWorkspaceConfig(st, rootId)
        const ws = st && st.workspaces && st.workspaces[rootId]
        const tm = (cfg && cfg.tacticalModes) || {}
        smartCompactActive = Boolean(tm.smartCompact)
        chiefPermissionMode = normalizePermissionMode(cfg && cfg.permissionMode, {
          requireAck: true,
          hasChiefRiskAck: hasValidChiefRiskAck(ws),
        })
      } catch {}
    }
    return { takenOutArchives, sessionHookedArchives, desktopUsedTokens, smartCompactActive, chiefPermissionMode }
  }

  /* ------------------------------------------------------------------- auto sync */

  /** todo_write → plan. Skipped when the plan already says the same thing. */
  function syncPlanFromTodos(args, sessionId) {
    const steps = planFromTodos(args)
    if (!steps) return
    const file = boardFileFor(sessionId)
    withBoardLock(file, () => {
      const board = loadBoard(file)
      if (planSignature(board.plan) === planSignature(steps)) return
      board.plan = steps
      saveBoard(board, file)
    })
  }

  /** create_goal / update_goal → objective. */
  function syncObjective(name, args, sessionId) {
    if (isObjectiveLockedByIntervention(sessionId)) return
    const objective = objectiveFromGoal(name, args)
    if (!objective) return
    const file = boardFileFor(sessionId)
    withBoardLock(file, () => {
      const board = loadBoard(file)
      const wantGoalMode = name === 'create_goal'
      if (board.objective === objective && (!wantGoalMode || board.mode === 'goal')) return
      const previous = board.objective
      board.objective = objective.slice(0, 2000)
      board.objectiveBy = String(sessionId || '')
      board.objectiveAt = nowMs()
      if (wantGoalMode) {
        board.mode = 'goal'
        if (board.goalApproval && board.goalApproval.status !== 'pending') board.goalApproval = null
      }
      board.objectiveUpdatedAt = board.objectiveAt
      pushLog(board, '长期目标改为：' + objective.slice(0, 60) + (previous && previous !== objective ? '（原：' + previous.slice(0, 40) + '）' : ''), 'agent', sessionId)
      saveBoard(board, file)
    })
  }

  /** Put one packet into exactly one place, because the operator asked for it.
   *
   *  Shape matters more than anything else here. The queue in front of an agent
   *  records what it was handed, and the session log stores that record verbatim
   *  (`agent/inbox/spliced`). A bare string there makes the whole log unloadable
   *  ("requires message objects"), and a message without a producer-owned
   *  `source.kind` makes the client crash while it resolves submission
   *  insertions. So the payload is always a complete message: id, role, content,
   *  and a source kind this package owns.
   */
  const HANDOFF_SOURCE = { kind: 'dsh-chief-handoff' }

  function buildHandoffMessage(text) {
    deps.hostState.handoffSeq += 1
    return {
      id: 'handoff-' + Date.now().toString(36) + '-' + deps.hostState.handoffSeq.toString(36),
      role: 'user',
      content: [{ type: 'text', text }],
      source: { ...HANDOFF_SOURCE },
    }
  }

  async function injectInto(agent, text) {
    if (!agent || typeof agent.inject !== 'function') {
      return { ok: false, error: '这个 agent 没有 inject 方法' }
    }
    const message = buildHandoffMessage(text)
    const shapes = [message, { content: message.content, source: message.source, role: message.role, id: message.id }]
    for (const shape of shapes) {
      try {
        const result = agent.inject(shape)
        if (result && typeof result.then === 'function') await result
        return { ok: true }
      } catch {}
    }
    return { ok: false, error: 'inject 不接受完整消息形状（纯文本会写坏会话日志，不试）' }
  }

  /**
   * System-level handover & state deployment to a target Chief workspace (`一键部署参谋`).
   * Copies active objective, mode, plan steps, unfinished tasks (scrubbing stale `doing` / child handles),
   * cursor, bounds, and Chief facts/narrative/chat — while optionally copying working cabinet archives
   * per `archiveTransferPolicy` ('none' | 'mounted' | 'drawer' | 'all') and strictly NEVER leaking precipitated cold vault.
   */
  function deployStateToTargetChief(runtime, {
    fromSessionId = '',
    toSessionId = '',
    archiveTransferPolicy = 'none',
    archiveDrawer = '',
    toCabinetId = '',
    customNote = '',
  } = {}) {
    const fromRoot = resolveRootSessionId(fromSessionId) || String(fromSessionId || '').trim()
    const toRoot = resolveRootSessionId(toSessionId) || String(toSessionId || '').trim()
    if (!fromRoot || !toRoot || fromRoot === toRoot) {
      return { ok: false, error: '跨会话移交需要两个不同的会话 ID' }
    }

    const srcBoard = boardForSession(boardFileFor(fromRoot))
    const destFile = boardFileFor(toRoot)
    let copiedTaskCount = 0
    let copiedStepCount = 0

    withBoardLock(destFile, () => {
      const dest = loadBoard(destFile)
      if (srcBoard.objective) {
        dest.objective = srcBoard.objective
        dest.objectiveBy = srcBoard.objectiveBy || fromRoot
        dest.objectiveAt = srcBoard.objectiveAt || nowMs()
        dest.objectiveUpdatedAt = nowMs()
      }
      dest.mode = srcBoard.mode === 'goal' ? 'goal' : 'plan'
      dest.goalApproval = null

      if (Array.isArray(srcBoard.plan) && srcBoard.plan.length > 0) {
        dest.plan = srcBoard.plan.map(step => ({
          id: step.id || newId('s'),
          text: step.text,
          done: Boolean(step.done),
        }))
        copiedStepCount = dest.plan.length
      }

      const srcTasks = Array.isArray(srcBoard.tasks) ? srcBoard.tasks : []
      const unfinished = srcTasks.filter(t => t && t.status !== 'done')
      const unfinishedIds = new Set(unfinished.map(t => t.id))
      const existingIds = new Set((dest.tasks || []).map(t => t.id))
      for (const rawTask of unfinished) {
        if (existingIds.has(rawTask.id)) continue
        const remainingBlockers = (rawTask.blockedBy || []).filter(bid => unfinishedIds.has(bid))
        const droppedDoneCount = (rawTask.blockedBy || []).length - remainingBlockers.length
        dest.tasks.push(normalizeTask({
          ...rawTask,
          status: rawTask.status === 'doing' ? 'todo' : rawTask.status,
          session: '',
          subagent: '',
          blockedBy: remainingBlockers,
          note: droppedDoneCount > 0
            ? [rawTask.note, `[接力已自动解除 ${droppedDoneCount} 项已完成前置依赖]`].filter(Boolean).join(' ')
            : rawTask.note,
          updatedAt: nowMs(),
        }))
        copiedTaskCount += 1
      }

      if (srcBoard.cursor && (srcBoard.cursor.step || srcBoard.cursor.next || srcBoard.cursor.blocked)) {
        dest.cursor = {
          ...srcBoard.cursor,
          at: nowMs(),
          by: 'deploy',
          session: fromRoot,
        }
      }

      // Merge local non-pinned bounds from source session board into destination session board
      const srcLocal = srcBoard.localBounds || { allowed: [], forbidden: [], notes: [] }
      const destBounds = normalizeBounds(dest.bounds)
      for (const col of BOUND_FIELDS) {
        const merged = new Set(destBounds[col] || [])
        for (const item of (srcLocal[col] || [])) merged.add(item)
        destBounds[col] = [...merged].slice(0, BOUND_CAP)
      }
      dest.bounds = destBounds

      // Carry non-anchor handoff context notes selectively if target has room
      dest.handoff = {
        at: nowMs(),
        by: 'deploy',
        session: fromRoot,
        customText: '',
        pinned: false,
        pinnedAt: 0,
        pinnedBy: '',
        updatedAt: 0,
        source: 'auto',
        syncOnDigest: false,
      }
      pushLog(
        dest,
        `🚀 已系统级移交部署自会话 ${fromRoot.slice(0, 12)}：计划 ${copiedStepCount} 步、未完任务 ${copiedTaskCount} 项`,
        'deploy',
        toRoot,
      )
      saveBoard(dest, destFile)
    })

    const chiefRes = deployChiefWorkspaceState(makeChiefDeps(runtime), {
      fromRootId: fromRoot,
      toRootId: toRoot,
      fromTitle: sessionName(runtime, fromRoot) || fromRoot,
      customText: customNote,
      objective: srcBoard.objective || '',
    })

    let archiveCopyRes = { ok: true, policy: 'none', copiedCount: 0 }
    const policy = ['none', 'mounted', 'drawer', 'all'].includes(archiveTransferPolicy)
      ? archiveTransferPolicy
      : 'none'
    if (policy !== 'none') {
      archiveCopyRes = copyArchivesBetweenSessionsOrCabinets({
        fromRootSessionId: fromRoot,
        toRootSessionId: toRoot,
        fromCwd: getSessionCwd(runtime, fromRoot),
        toCwd: getSessionCwd(runtime, toRoot),
        fromCabinetId: srcBoard.activeCabinetId || '',
        toCabinetId: toCabinetId || loadBoard(boardFileFor(toRoot)).activeCabinetId || '',
        policy,
        drawer: archiveDrawer,
        customSharedBoardFile: boardFile(),
      })
    }

    return {
      ok: true,
      fromSessionId: fromRoot,
      toSessionId: toRoot,
      copiedTaskCount,
      copiedStepCount,
      chiefDeployed: chiefRes,
      archiveTransfer: archiveCopyRes,
    }
  }

  async function transferChief(runtime, args, sessionId) {
    const passed = args && typeof args === 'object' ? args : {}
    const target = typeof passed.target === 'string' ? passed.target.trim() : 'new'
    const deployChief = asBool(passed.deployChief) !== false
    const archiveTransferPolicy = ['none', 'mounted', 'drawer', 'all'].includes(str(passed.archiveTransferPolicy, 'none'))
      ? str(passed.archiveTransferPolicy, 'none')
      : 'none'
    const archiveDrawer = str(passed.archiveDrawer, '')
    const toCabinetId = str(passed.toCabinetId, '')
    const customNote = str(passed.customNote, '')

    const board = boardForSession(boardFileFor(sessionId))
    const rootSid = resolveRootSessionId(sessionId) || sessionId
    const packet = resolveEffectiveHandoff(runtime, sessionId, board).text
    const by = typeof passed.by === 'string' && passed.by ? passed.by : 'user'

    if (!target || target === 'new' || target === 'latest') {
      if (!writePending({ at: nowMs(), by, session: sessionId, text: packet })) {
        return { ok: false, error: '待领取文件写入失败' }
      }
      if (deployChief && rootSid) {
        writePendingDeploy({
          at: nowMs(),
          by,
          fromSessionId: rootSid,
          archiveTransferPolicy,
          archiveDrawer,
          toCabinetId,
          customNote,
        })
      }
      const owner = boardFileFor(sessionId)
      withBoardLock(owner, () => {
        const next = loadBoard(owner)
        pushLog(next, '交接单与参谋接力包已投放：等下一个新会话自动部署领取', by, sessionId)
        saveBoard(next, owner)
      })
      return { ok: true, mode: 'pending', deployQueued: deployChief, text: packet }
    }

    if (target === 'create') {
      const controller = runtime.get('sessionController')
      const parked = writePending({ at: nowMs(), by, session: sessionId, text: packet })
      if (!parked) return { ok: false, error: '待领取文件写入失败' }
      if (deployChief && rootSid) {
        writePendingDeploy({
          at: nowMs(),
          by,
          fromSessionId: rootSid,
          archiveTransferPolicy,
          archiveDrawer,
          toCabinetId,
          customNote,
        })
      }
      if (!controller || typeof controller.create !== 'function') {
        return { ok: false, error: '这个部署没有 sessionController，交接单已放进待领取', mode: 'pending', text: packet }
      }
      const matchedWorkspaceId = resolveWorkspaceIdForSession(runtime, rootSid || sessionId)
      const srcCwd = getSessionCwd(runtime, rootSid || sessionId)
      const fallbackCwdReq = srcCwd && !isInternalProfileCwd(srcCwd) ? { cwd: srcCwd } : {}
      const createReq = matchedWorkspaceId ? { workspaceId: matchedWorkspaceId } : fallbackCwdReq

      let created
      try {
        created = await controller.create(createReq)
      } catch (error) {
        if (createReq.workspaceId) {
          try {
            created = await controller.create(fallbackCwdReq)
          } catch (fallbackErr) {
            return {
              ok: false,
              error: '唤起新会话失败：' + String((fallbackErr && fallbackErr.message) || fallbackErr),
              mode: 'pending',
              text: packet,
            }
          }
        } else {
          return {
            ok: false,
            error: '唤起新会话失败：' + String((error && error.message) || error),
            mode: 'pending',
            text: packet,
          }
        }
      }
      const createdId = str(created && created.sessionId, '')
      if (!createdId) return { ok: false, error: '新会话没有返回 id', mode: 'pending', text: packet }

      let deployResult = null
      if (deployChief && rootSid && readPendingDeploy()) {
        clearPendingDeploy()
        deployResult = deployStateToTargetChief(runtime, {
          fromSessionId: rootSid,
          toSessionId: createdId,
          archiveTransferPolicy,
          archiveDrawer,
          toCabinetId,
          customNote,
        })
      }

      const owner = boardFileFor(sessionId)
      if (!readPending()) {
        withBoardLock(owner, () => {
          const next = loadBoard(owner)
          pushLog(next, '交接单与参谋已由新会话 ' + createdId.replace(/^session-/, '').slice(0, 8) + ' 领取部署', by, sessionId)
          saveBoard(next, owner)
        })
        return { ok: true, mode: 'created', sessionId: createdId, delivered: true, deployResult, text: packet }
      }
      const agents = runtime.get('agents')
      const fresh = agents && typeof agents.get === 'function' ? agents.get(createdId) : undefined
      const delivered = fresh ? await injectInto(fresh, packet) : { ok: false, error: '新会话还没有活的 agent，交接单留在待领取' }
      if (delivered.ok) clearPending()
      withBoardLock(owner, () => {
        const next = loadBoard(owner)
        pushLog(
          next,
          (delivered.ok ? '交接单与参谋已部署至新会话 ' : '新会话已建（交接单仍待领取）：') + createdId.replace(/^session-/, '').slice(0, 8),
          by,
          sessionId,
        )
        saveBoard(next, owner)
      })
      return { ok: delivered.ok, mode: delivered.ok ? 'created' : 'pending', sessionId: createdId, deployResult, text: packet }
    }

    let deployResult = null
    if (deployChief && rootSid && target !== rootSid) {
      deployResult = deployStateToTargetChief(runtime, {
        fromSessionId: rootSid,
        toSessionId: target,
        archiveTransferPolicy,
        archiveDrawer,
        toCabinetId,
        customNote,
      })
    }

    const agents = runtime.get('agents')
    const agent = agents && typeof agents.get === 'function' ? agents.get(target) : undefined
    if (!agent) {
      writePending({ at: nowMs(), by, session: sessionId, text: packet, failedTarget: target })
      return {
        ok: Boolean(deployResult && deployResult.ok),
        error: deployResult && deployResult.ok ? '' : '目标会话没有活的 agent：已改成待领取，下次新会话可取',
        mode: 'pending',
        deployResult,
        text: packet,
      }
    }
    const delivered = await injectInto(agent, packet)
    const owner = boardFileFor(sessionId)
    withBoardLock(owner, () => {
      const next = loadBoard(owner)
      pushLog(
        next,
        (delivered.ok ? '交接单与参谋已投放到会话 ' : '投放失败（' + delivered.error + '）：') + String(target).replace(/^session-/, '').slice(0, 8),
        by,
        sessionId,
      )
      saveBoard(next, owner)
    })
    if (!delivered.ok) {
      writePending({ at: nowMs(), by, session: sessionId, text: packet, failedTarget: target })
      return { ok: false, error: delivered.error, mode: 'pending', deployResult, text: packet }
    }
    return { ok: true, mode: 'injected', target, deployResult, text: packet }
  }

  return {
    boundaries,
    archiveTarget,
    composeHandoffFromNarrative,
    resolveEffectiveHandoff,
    collectTakenOutAndFlipped,
    collectDigestArchiveContext,
    syncPlanFromTodos,
    syncObjective,
    buildHandoffMessage,
    injectInto,
    deployStateToTargetChief,
    transferChief,
  }
}
