/**
 * board-actions.js
 *
 * Board action dispatcher, boundary facts, handoff resolution, and cross-session deployment.
 */

import fs from 'node:fs'
import { planFromTodos, objectiveFromGoal, planSignature } from './digest.js'
import { renderHandoff } from './handoff.js'
import { appendMemory, answerMemory, normalizeMemory } from './memory.js'
import {
  loadChiefState,
  resolveWorkspaceConfig,
  deployChiefWorkspaceState,
  hasValidChiefRiskAck,
} from './chief.js'
import {
  resolveProjectKey,
  getArchiveDetail,
  searchArchives,
  mutateArchive,
  copyArchivesBetweenSessionsOrCabinets,
  getTakenOutArchivesForSession,
  getTakenOutGlobalForSession,
  getFlippedOutPrecipitatedForSession,
} from './archives.js'
import { DEFAULT_CHIEF_PERMISSION_MODE, normalizePermissionMode } from './chief-executor.js'
import {
  enforceAnchorCap,
  STATUSES,
  PRIORITIES,
  newId,
  nowMs,
  emptyBoard,
  LEADING_MARKER,
  str,
  CAP_TASK_TITLE,
  CAP_TASK_NOTE,
  CAP_TASK_INTENT,
  CAP_TASK_EVIDENCE,
  CAP_ASSUMPTION,
  CAP_NOTE_TITLE,
  CAP_NOTE_BODY,
  CAP_PLAN_STEP,
  CAP_OBJECTIVE,
  CAP_CURSOR,
  CAP_LOG_TEXT,
  CAP_MEMORY_TITLE,
  CAP_MEMORY_TEXT,
  clipInto,
  clipped,
  asBool,
  asCount,
  asList,
  normalizeTags,
  normalizeTask,
  reconcileTaskDependencies,
  normalizeNote,
  BOUND_FIELDS,
  normalizeBoundFieldName,
  BOUND_CAP,
  normalizeList,
  normalizeBounds,
  guardCount,
  pushLog,
  safe,
  summary,
} from './board-schema.js'

export function createBoardActions(deps) {

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

  /* ------------------------------------------------------------- one operation */

  /**
   * The single operation surface shared by the browser routes and the model
   * tools. Every mutation returns `{ ok, board }` or `{ ok: false, error }`.
   */
  /* Reads never take the lock: loadBoard already caches by mtime and a torn read
   * is impossible (the file is replaced by rename). Every mutation does, so two
   * writers cannot both read the same board and have the later rename throw the
   * earlier one's append away. */
  /* Writes that belong to the machine rather than to the Session that asked.
   * settings are read by every surface, and an anchor note is worth nothing unless
   * a Session that never saw this board can read it: both are promises made to the
   * whole machine, so both land on the shared board whatever the caller passed.
   * Deciding it here instead of trusting scope keeps a caller that forgets the flag
   * from writing a local copy nothing reads — which is exactly how a pinned note
   * used to become a dead flag (pinned=true, no anchor tag, no shared copy). */
  function forcesShared(action, args) {
    if (str(args.scope, '') === 'shared') return true
    if (action === 'settings.set') return true
    if (!str(args.session, '') && action.startsWith('bounds.')) return true
    // note.write only becomes machine-wide when it claims to pin.
    return action === 'note.write' && asBool(args.pinned) === true
  }

  /** Check whether Strong Intervention (`主动强介入`) is active and locks `board.objective` for a session tree. */
  function isObjectiveLockedByIntervention(sessionId) {
    const rawSid = str(sessionId, '').trim()
    if (!rawSid) return false
    try {
      const rootSid = resolveRootSessionId(rawSid) || rawSid
      const cfg = resolveWorkspaceConfig(loadChiefState(), rootSid)
      return Boolean(cfg && cfg.tacticalModes && cfg.tacticalModes.intervention === true)
    } catch {
      return false
    }
  }

  function runAction(input) {
    const args = input && typeof input === 'object' ? input : {}
    const action = str(args.action, 'snapshot')
    if (
      action === 'snapshot'
      || action === 'memory.ask'
      || action === 'archive.search'
      || action === 'archive.read'
      || action === 'archive.save'
    ) {
      return runActionUnlocked(args)
    }
    // Machine-wide writes (settings, pinned anchors) are forced onto the shared
    // board here rather than trusting the caller to pass scope, because the panel
    // never does: a settings write that landed on a session board would flip the
    // checkbox and change nothing at runtime, and a pinned note that landed there
    // would be an anchor no fresh Session could ever read.
    const shared = forcesShared(action, args)
    const session = str(args.session, '')
    const file = shared ? boardFile() : boardFileFor(session)
    return withBoardLock(file, () => runActionUnlocked(args))
  }

  function runActionUnlocked(input) {
    const args = input && typeof input === 'object' ? input : {}
    const action = str(args.action, 'snapshot')
    const by = str(args.by, 'agent')
    const session = str(args.session, '')
    const shared = forcesShared(action, args)
    const file = shared ? boardFile() : boardFileFor(session)

    // Session-scoped Engineering Archives: Lead/Subagents may ONLY access THIS session's cabinet (never global or unflipped precipitated!).
    if (action === 'archive.search') {
      const q = str(args.query !== undefined ? args.query : (args.question !== undefined ? args.question : args.text), '')
      const folder = str(args.folder, '')
      const rootSid = resolveRootSessionId(session) || session
      if (!rootSid) {
        return {
          ok: true,
          archiveSearch: { ok: true, totalArchives: 0, matchCount: 0, hits: [], unboundSession: true },
          board: emptyBoard(),
        }
      }
      const res = searchArchives(q, { folder, limit: 10, vaultScope: 'session' }, archiveTarget(deps.hostState.activeRuntime, rootSid, { cabinetId: str(args.cabinetId, ''), vaultScope: 'session' }))
      return {
        ok: true,
        archiveSearch: res,
        board: session ? loadBoard(file) : emptyBoard(),
      }
    }

    if (action === 'archive.read') {
      const target = str(args.archiveId !== undefined ? args.archiveId : (args.id !== undefined ? args.id : args.title), '').trim()
      if (!target) return { ok: false, error: 'archive.read requires archiveId, id, or title' }
      const rootSid = resolveRootSessionId(session) || session
      if (!rootSid) return { ok: false, error: '当前未绑定对话会话，无法读取本会话档案柜' }
      const res = getArchiveDetail(target, rootSid, archiveTarget(deps.hostState.activeRuntime, rootSid, { cabinetId: str(args.cabinetId, ''), vaultScope: 'session' }))
      if (!res.ok) return { ok: false, error: res.error }
      return {
        ok: true,
        archiveItem: res.item,
        board: session ? loadBoard(file) : emptyBoard(),
      }
    }

    if (action === 'archive.save') {
      const rootSid = resolveRootSessionId(session) || session
      if (!rootSid) return { ok: false, error: '当前未绑定对话会话，无法保存到本会话档案柜' }
      const res = mutateArchive({
        op: 'save',
        vaultScope: 'session',
        archiveId: str(args.archiveId !== undefined ? args.archiveId : args.id, ''),
        title: str(args.title, ''),
        body: typeof args.body === 'string' ? args.body : undefined,
        summary: str(args.summary, ''),
        folder: str(args.folder, ''),
        paperclip: str(args.paperclip, ''),
        tags: asList(args.tags),
        points: Array.isArray(args.points) ? args.points : undefined,
        by,
        rootSessionId: rootSid,
      }, archiveTarget(deps.hostState.activeRuntime, rootSid, { cabinetId: str(args.cabinetId, ''), vaultScope: 'session' }))
      if (!res.ok) return { ok: false, error: res.error }
      if (session) {
        withBoardLock(file, () => {
          const b = loadBoard(file)
          pushLog(b, '🗄️ 归档工程记忆：' + String(res.item.title).slice(0, 50), by, session)
          saveBoard(b, file)
        })
      }
      return {
        ok: true,
        archiveSaved: res.item,
        board: session ? loadBoard(file) : emptyBoard(),
      }
    }

    // A caller with no Session is an unbound surface (blank new conversation,
    // hero state): reads must see an empty board — never the shared anchors —
    // and writes have nowhere legitimate to land, so they fail loudly instead
    // of silently polluting the shared board.
    if (!session && !shared) {
      if (action === 'snapshot') return { ok: true, board: emptyBoard() }
      return { ok: false, error: 'no session bound — the board is per-session now' }
    }

    if (action === 'snapshot') return { ok: true, board: loadBoard(file) }

    const board = loadBoard(file)

    if (action === 'task.reset') {
      const mode = str(args.mode, 'clear').trim().toLowerCase()
      const hadCount = Array.isArray(board.tasks) ? board.tasks.length : 0
      if (mode === 'reopen') {
        board.tasks = (board.tasks || []).map(t => ({
          ...t,
          status: 'todo',
          evidence: '',
          updatedAt: nowMs(),
        }))
        reconcileTaskDependencies(board, by, session)
        pushLog(board, '已将本会话全部任务重置为待推进（共 ' + board.tasks.length + ' 项）', by, session)
      } else {
        board.tasks = []
        if (asBool(args.alsoResetPlan) === true) {
          board.plan = []
          board.cursor = { at: nowMs(), step: '', next: '', blocked: '', by, session }
        }
        pushLog(board, '已重设清空本会话任务列表（原 ' + hadCount + ' 项）', by, session)
      }
      return { ok: true, clearedTasks: hadCount, mode, board: saveBoard(board, file) }
    }

    if (action === 'task.add') {
      const title = str(args.title, '').trim()
      if (!title) return { ok: false, error: 'title required' }
      const clips = []
      const ownerVal = str(args.subagent || args.target || args.owner, by)
      const task = normalizeTask({
        id: str(args.id, '') ? str(args.id, '').slice(0, 64) : newId('t'),
        title: clipInto(clips, 'task.title', title, CAP_TASK_TITLE),
        note: clipInto(clips, 'task.note', str(args.note, ''), CAP_TASK_NOTE),
        status: STATUSES.includes(args.status) ? args.status : 'todo',
        priority: PRIORITIES.includes(args.priority) ? args.priority : 'normal',
        owner: ownerVal,
        subagent: str(args.subagent || args.target, ''),
        preset: str(args.preset, ''),
        session,
        intent: clipInto(clips, 'task.intent', str(args.intent, ''), CAP_TASK_INTENT),
        evidence: clipInto(clips, 'task.evidence', str(args.evidence, ''), CAP_TASK_EVIDENCE),
        blockedBy: Array.isArray(args.blockedBy) ? args.blockedBy : (typeof args.blockedBy === 'string' && args.blockedBy ? args.blockedBy.split(',').map(s => s.trim()) : []),
        parentId: str(args.parentId, '').slice(0, 200),
        assumptions: str(args.assumption, '') ? [{ text: str(args.assumption, '').slice(0, CAP_ASSUMPTION), verified: false, verifiedAt: 0, note: '' }] : [],
        createdAt: nowMs(),
        updatedAt: nowMs(),
      })
      board.tasks.push(task)
      reconcileTaskDependencies(board, by, session)
      pushLog(board, '新建任务：' + task.title, by, session)
      return clipped({ ok: true, task, board: saveBoard(board, file) }, clips)
    }

    if (action === 'graph.plan' || action === 'task.batch') {
      const clips = []
      if (typeof args.objective === 'string' && args.objective.trim()) {
        if (isObjectiveLockedByIntervention(session) && asBool(args._fromInterventionSetup) !== true) {
          if (args.objective.trim() !== String(board.objective || '').trim()) {
            pushLog(board, '🔒 主动强介入已锁定核心目标，忽略本次任务图目标改写', by, session)
          }
        } else {
          board.objective = clipInto(clips, 'objective', args.objective.trim(), CAP_OBJECTIVE)
          board.objectiveBy = session
          board.objectiveAt = nowMs()
        }
      }
      const rawList = Array.isArray(args.tasks) ? args.tasks : (Array.isArray(args.nodes) ? args.nodes : [])
      if (!rawList.length) return { ok: false, error: 'graph.plan requires a non-empty tasks array' }

      if (asBool(args.replace) === true) {
        board.tasks = []
      }

      const keyMap = new Map()
      for (const existing of board.tasks) {
        keyMap.set(existing.id, existing.id)
      }

      const staged = []
      for (let i = 0; i < rawList.length; i += 1) {
        const item = rawList[i] && typeof rawList[i] === 'object' ? rawList[i] : { title: String(rawList[i] || '') }
        const title = str(item.title, '').trim()
        if (!title) continue
        const rawKey = str(item.id || item.key, '').trim()
        const existing = rawKey ? board.tasks.find(t => t.id === rawKey) : null
        const realId = existing ? existing.id : (rawKey && /^[a-zA-Z0-9_-]{1,40}$/.test(rawKey) && !keyMap.has(rawKey) ? rawKey : newId('t'))
        if (rawKey) keyMap.set(rawKey, realId)
        keyMap.set(realId, realId)
        staged.push({ item, existing, realId, title })
      }

      const touchedTasks = []
      for (const { item, existing, realId, title } of staged) {
        const rawParent = str(item.parentId || item.parent, '').trim()
        const resolvedParent = rawParent ? (keyMap.get(rawParent) || rawParent) : ''
        const rawDeps = Array.isArray(item.blockedBy)
          ? item.blockedBy
          : (typeof item.blockedBy === 'string' && item.blockedBy ? item.blockedBy.split(',').map(s => s.trim()) : [])
        const resolvedDeps = rawDeps
          .map(d => str(d, '').trim())
          .filter(Boolean)
          .map(d => keyMap.get(d) || d)
          .filter(d => d !== realId)

        const ownerVal = str(item.subagent || item.target || item.owner, existing ? existing.owner : '')
        const subagentVal = str(item.subagent || item.target || (ownerVal && ownerVal !== 'agent' && ownerVal !== 'operator' ? ownerVal : ''), existing ? existing.subagent : '')

        if (existing) {
          existing.title = clipInto(clips, 'task.title', title, CAP_TASK_TITLE)
          if (typeof item.note === 'string') existing.note = clipInto(clips, 'task.note', item.note, CAP_TASK_NOTE)
          if (typeof item.intent === 'string') existing.intent = clipInto(clips, 'task.intent', item.intent, CAP_TASK_INTENT)
          if (typeof item.evidence === 'string') existing.evidence = clipInto(clips, 'task.evidence', item.evidence, CAP_TASK_EVIDENCE)
          if (ownerVal) existing.owner = ownerVal.slice(0, 200)
          if (subagentVal) existing.subagent = subagentVal.slice(0, 120)
          if (typeof item.preset === 'string') existing.preset = item.preset.slice(0, 80)
          if (rawParent || item.parentId === '') existing.parentId = resolvedParent.slice(0, 200)
          if (item.blockedBy !== undefined) existing.blockedBy = resolvedDeps
          if (STATUSES.includes(item.status)) existing.status = item.status
          if (PRIORITIES.includes(item.priority)) existing.priority = item.priority
          existing.updatedAt = nowMs()
          touchedTasks.push(existing)
        } else {
          const created = normalizeTask({
            id: realId,
            title: clipInto(clips, 'task.title', title, CAP_TASK_TITLE),
            note: clipInto(clips, 'task.note', str(item.note, ''), CAP_TASK_NOTE),
            status: STATUSES.includes(item.status) ? item.status : 'todo',
            priority: PRIORITIES.includes(item.priority) ? item.priority : 'normal',
            owner: ownerVal,
            subagent: subagentVal,
            preset: str(item.preset, ''),
            session,
            intent: clipInto(clips, 'task.intent', str(item.intent, ''), CAP_TASK_INTENT),
            evidence: clipInto(clips, 'task.evidence', str(item.evidence, ''), CAP_TASK_EVIDENCE),
            blockedBy: resolvedDeps,
            parentId: resolvedParent,
            assumptions: str(item.assumption, '') ? [{ text: str(item.assumption, '').slice(0, CAP_ASSUMPTION), verified: false, verifiedAt: 0, note: '' }] : [],
            createdAt: nowMs(),
            updatedAt: nowMs(),
          })
          board.tasks.push(created)
          touchedTasks.push(created)
        }
      }

      reconcileTaskDependencies(board, by, session)
      if (!board.plan.length && board.tasks.length) {
        const roots = board.tasks.filter(t => !t.parentId)
        board.plan = (roots.length ? roots : board.tasks).slice(0, 12).map(t => ({
          id: 's-' + t.id,
          text: t.title + (t.owner ? ' (@' + t.owner + ')' : ''),
          done: t.status === 'done',
        }))
      }
      pushLog(board, '规划任务图：共更新/新增 ' + touchedTasks.length + ' 个任务节点', by, session)
      return clipped({ ok: true, tasks: touchedTasks, board: saveBoard(board, file) }, clips)
    }

    if (action === 'task.update' || action === 'task.claim' || action === 'task.release' || action === 'task.remove') {
      const id = str(args.taskId !== undefined ? args.taskId : args.id, '')
      const index = board.tasks.findIndex(task => task.id === id)
      if (index < 0) return { ok: false, error: 'no such task: ' + id }
      const task = board.tasks[index]
      const clips = []

      if (action === 'task.remove') {
        board.tasks.splice(index, 1)
        for (const other of board.tasks) {
          if (other.parentId === id) other.parentId = task.parentId || ''
          if (Array.isArray(other.blockedBy) && other.blockedBy.includes(id)) {
            other.blockedBy = other.blockedBy.filter(depId => depId !== id)
          }
        }
        reconcileTaskDependencies(board, by, session)
        pushLog(board, '删除任务：' + task.title, by, session)
        return { ok: true, board: saveBoard(board, file) }
      }
      if (action === 'task.claim') {
        const unresolved = (task.blockedBy || []).filter(depId => {
          const dep = board.tasks.find(t => t.id === depId)
          return dep && dep.status !== 'done'
        })
        if (unresolved.length) {
          return { ok: false, error: 'blocked by ' + unresolved.join(', ') + ' — finish or remove those first' }
        }
        task.owner = str(args.owner, by)
        task.session = session || task.session
        task.status = 'doing'
        task.updatedAt = nowMs()
        pushLog(board, '接手任务：' + task.title, by, session)
        return { ok: true, task, board: saveBoard(board, file) }
      }
      if (action === 'task.release') {
        task.owner = ''
        task.subagent = ''
        task.session = ''
        if (task.status === 'doing') task.status = 'todo'
        task.updatedAt = nowMs()
        reconcileTaskDependencies(board, by, session)
        pushLog(board, '释放任务：' + task.title, by, session)
        return { ok: true, task, board: saveBoard(board, file) }
      }
      if (typeof args.title === 'string' && args.title.trim()) task.title = clipInto(clips, 'task.title', args.title.trim(), CAP_TASK_TITLE)
      if (typeof args.note === 'string') task.note = clipInto(clips, 'task.note', args.note, CAP_TASK_NOTE)
      if (typeof args.intent === 'string') task.intent = clipInto(clips, 'task.intent', args.intent, CAP_TASK_INTENT)
      if (typeof args.evidence === 'string') task.evidence = clipInto(clips, 'task.evidence', args.evidence, CAP_TASK_EVIDENCE)
      if (Array.isArray(args.blockedBy)) task.blockedBy = args.blockedBy.map(item => str(item, '')).filter(Boolean)
      else if (typeof args.blockedBy === 'string') task.blockedBy = args.blockedBy.split(',').map(s => s.trim()).filter(Boolean)
      if (typeof args.assumption === 'string' && args.assumption.trim()) {
        task.assumptions.push({ text: clipInto(clips, 'task.assumption', args.assumption.trim(), CAP_ASSUMPTION), verified: false, verifiedAt: 0, note: '' })
      }
      if (typeof args.parentId === 'string') task.parentId = args.parentId.trim().slice(0, 200)
      if (typeof args.owner === 'string') task.owner = str(args.owner, '').slice(0, 200)
      if (typeof args.target === 'string') {
        task.owner = str(args.target, '').slice(0, 200)
        task.subagent = str(args.target, '').slice(0, 120)
      }
      if (typeof args.subagent === 'string') {
        task.subagent = str(args.subagent, '').slice(0, 120)
        if (!args.owner) task.owner = task.subagent
      }
      if (typeof args.preset === 'string') task.preset = str(args.preset, '').slice(0, 80)
      if (typeof args.session === 'string') task.session = str(args.session, '').slice(0, 200)
      const prevStatus = task.status
      if (STATUSES.includes(args.status)) task.status = args.status
      if (PRIORITIES.includes(args.priority)) task.priority = args.priority
      task.updatedAt = nowMs()
      const unlocked = reconcileTaskDependencies(board, by, session)
      if (prevStatus !== task.status) {
        pushLog(board, '任务状态更新：#' + task.id + ' ' + task.title.slice(0, 40) + ' → ' + task.status + (task.evidence && task.status === 'done' ? '（验证：' + task.evidence.slice(0, 50) + '）' : ''), by, session)
        // Sync corresponding plan step if present
        const step = (board.plan || []).find(s => s.id === 's-' + task.id || s.text.startsWith(task.title))
        if (step) step.done = task.status === 'done'
      }
      return clipped({ ok: true, task, unlocked, board: saveBoard(board, file) }, clips)
    }

    if (action === 'task.verify') {
      const id = str(args.taskId !== undefined ? args.taskId : args.id, '')
      const task = board.tasks.find(t => t.id === id)
      if (!task) return { ok: false, error: 'no such task: ' + id }
      const idx = typeof args.assumptionIndex === 'number' ? args.assumptionIndex : -1
      if (idx < 0 || idx >= task.assumptions.length) return { ok: false, error: 'no such assumption index: ' + idx + ' (task has ' + task.assumptions.length + ')' }
      task.assumptions[idx].verified = true
      task.assumptions[idx].verifiedAt = nowMs()
      if (typeof args.note === 'string') task.assumptions[idx].note = str(args.note, '').slice(0, CAP_ASSUMPTION)
      task.updatedAt = nowMs()
      pushLog(board, '验证假设：' + task.title + ' #' + idx + ' — ' + task.assumptions[idx].text.slice(0, 60), by, session)
      return { ok: true, task, board: saveBoard(board, file) }
    }

    if (action === 'plan.set') {
      const clips = []
      if (typeof args.objective === 'string') {
        if (isObjectiveLockedByIntervention(session) && asBool(args._fromInterventionSetup) !== true) {
          if (args.objective.trim() !== String(board.objective || '').trim()) {
            pushLog(board, '🔒 主动强介入已锁定核心目标，保留原核心目标（仅更新计划步骤）', by, session)
          }
        } else {
          board.objective = clipInto(clips, 'objective', args.objective, CAP_OBJECTIVE)
          // Whoever writes the objective owns it. Leaving the previous owner in
          // place made the panel header name the Session that set the *old* text,
          // so a fresh save looked like it came from somebody else.
          board.objectiveBy = session
          board.objectiveAt = nowMs()
          // objective.set logged this write and plan.set did not, so retargeting a
          // board through plan.set left no trace in the log: the objective page
          // said the goal had changed and the log page said nothing had happened.
          // One action, two entry points, one line either way.
          pushLog(board, '目标改为：' + board.objective.slice(0, 60), by, session)
        }
      }
      const steps = asList(args.steps)
      if (steps) {
        board.plan = steps
          .map(raw => {
            // A bare string in a flattened list is one step, not a step with no
            // text: the old shape filtered it out and wiped the plan.
            const step = typeof raw === 'string' ? { text: raw } : (raw && typeof raw === 'object' ? raw : {})
            return {
              id: str(step.id, newId('s')),
              text: clipInto(clips, 'plan.step', str(step.text, ''), CAP_PLAN_STEP),
              done: asBool(step.done) === true,
            }
          })
          .filter(step => step.text !== '')
      }
      return clipped({ ok: true, board: saveBoard(board, file) }, clips)
    }

    if (action === 'mode.set') {
      const mode = str(args.mode, '').trim().toLowerCase()
      if (mode !== 'plan' && mode !== 'goal') return { ok: false, error: 'mode must be plan or goal' }
      const before = board.mode === 'goal' ? 'goal' : 'plan'
      board.mode = mode
      if (mode === 'goal') {
        if (board.goalApproval && board.goalApproval.status !== 'pending') {
          board.goalApproval = null
        }
      } else if (board.goalApproval && board.goalApproval.status === 'pending') {
        board.goalApproval = null
      }
      if (before !== mode) {
        pushLog(
          board,
          '模式改为：' + mode + (mode === 'goal' ? '（开启长期目标持续督导）' : '（回到按步规划推进）'),
          by,
          session,
        )
      }
      return { ok: true, mode, board: saveBoard(board, file) }
    }

    if (action === 'plan.resetForGoal') {
      const hadSteps = Array.isArray(board.plan) ? board.plan.length : 0
      board.plan = []
      board.cursor = {
        at: nowMs(),
        step: '',
        next: '',
        blocked: '',
        by,
        session,
      }
      pushLog(board, `已清空陈旧计划步骤（原 ${hadSteps} 步），等待按最新总目标重编`, by, session)
      return { ok: true, clearedSteps: hadSteps, board: saveBoard(board, file) }
    }

    if (action === 'goal.proposeApproval') {
      const obj = str(args.objective, board.objective).trim().slice(0, 600)
      const summary = str(args.summary, '当前总目标要求已全部完成并已核验，请用户批准结项。').trim().slice(0, 600)
      const evidence = str(args.evidence, '').trim().slice(0, 800)
      // Crucial: keep board.mode === 'goal' until the user explicitly approves!
      board.goalApproval = {
        id: newId('ga'),
        status: 'pending',
        objective: obj,
        summary,
        evidence,
        rejectReason: '',
        at: nowMs(),
        decidedAt: 0,
      }
      pushLog(board, '🎯 参谋长判定目标已达成，呈请用户批准结项：' + summary.slice(0, 60), by, session)
      return { ok: true, goalApproval: board.goalApproval, board: saveBoard(board, file) }
    }

    if (action === 'goal.approve') {
      const prev = board.goalApproval || { id: newId('ga'), objective: board.objective, summary: '', evidence: '', at: nowMs() }
      board.goalApproval = {
        ...prev,
        status: 'approved',
        rejectReason: '',
        decidedAt: nowMs(),
      }
      board.mode = 'plan'
      appendMemory(board, {
        section: '验证结论',
        title: '🎯 目标结项批准：' + String(prev.objective || board.objective || '阶段目标').slice(0, 60),
        text: prev.summary || '用户已批准目标结项并切换回按步规划模式',
        by,
        session,
      })
      pushLog(board, '✅ 用户已批准目标结项，已退出 Goal 督导模式', by, session)
      return { ok: true, goalApproval: board.goalApproval, mode: board.mode, board: saveBoard(board, file) }
    }

    if (action === 'goal.reject') {
      const reason = str(args.reason, '仍需继续推进完善').trim().slice(0, 300)
      const prev = board.goalApproval || { id: newId('ga'), objective: board.objective, summary: '', evidence: '', at: nowMs() }
      board.goalApproval = {
        ...prev,
        status: 'rejected',
        rejectReason: reason,
        decidedAt: nowMs(),
      }
      board.mode = 'goal'
      pushLog(board, '↩ 用户驳回结项批示（继续 Goal 督导）：' + reason.slice(0, 60), by, session)
      return { ok: true, goalApproval: board.goalApproval, mode: board.mode, board: saveBoard(board, file) }
    }

    if (action === 'settings.set') {
      const next = board.settings || { autoInject: true, guardIdle: true }
      const auto = asBool(args.autoInject)
      const guard = asBool(args.guardIdle)
      const maxPerSession = asCount(args.guardMaxPerSession)
      const shortAnswer = asCount(args.guardShortAnswer)
      if (auto !== undefined) next.autoInject = auto
      if (guard !== undefined) next.guardIdle = guard
      if (maxPerSession !== undefined) next.guardMaxPerSession = guardCount(maxPerSession, 3, 0, 20)
      if (shortAnswer !== undefined) next.guardShortAnswer = guardCount(shortAnswer, 600, 0, 10000)
      board.settings = next
      const parts = []
      if (auto !== undefined) parts.push('每轮自动摘要 = ' + (next.autoInject ? '开' : '关'))
      if (guard !== undefined) parts.push('空转拦截 = ' + (next.guardIdle ? '开' : '关'))
      if (maxPerSession !== undefined) parts.push('每会话最多催 = ' + next.guardMaxPerSession + ' 次')
      if (shortAnswer !== undefined) parts.push('短回答门槛 = ' + next.guardShortAnswer + ' 字')
      if (parts.length) pushLog(board, '设置：' + parts.join('；') + '（下一轮就生效）', by, session)
      return { ok: true, settings: next, board: saveBoard(board, file) }
    }

    if (action === 'objective.set') {
      if (isObjectiveLockedByIntervention(session) && asBool(args._fromInterventionSetup) !== true) {
        return {
          ok: false,
          locked: true,
          error: '当前处于「主动强介入」模式，核心目标已锁定；如需修改请先关闭强介入模式。',
        }
      }
      const objective = str(args.objective, '').trim()
      if (!objective) return { ok: false, error: 'objective required' }
      const clips = []
      const changed = board.objective !== objective
      board.objective = clipInto(clips, 'objective', objective, CAP_OBJECTIVE)
      board.objectiveBy = session
      board.objectiveAt = nowMs()
      board.objectiveUpdatedAt = board.objectiveAt
      if (asBool(args.setGoalMode) === true) {
        board.mode = 'goal'
      }
      if (changed && board.goalApproval && board.goalApproval.status !== 'pending') {
        board.goalApproval = null
      }
      if (asBool(args.resetStalePlan) === true) {
        board.plan = []
        board.cursor = { at: nowMs(), step: '', next: '', blocked: '', by, session }
      }
      pushLog(
        board,
        (asBool(args.setGoalMode) === true ? '🎯 设为督导目标：' : '目标改为：') + objective.slice(0, 60),
        by,
        session,
      )
      return clipped({ ok: true, board: saveBoard(board, file) }, clips)
    }

    if (action === 'bounds.set') {
      const current = board.bounds || { allowed: [], forbidden: [], notes: [] }
      // A partial list that looks complete is the worst of the three options: the
      // caller walks away believing it imposed 25 restrictions while the board
      // holds 20. Refusing says so, and says that nothing was written, so the
      // retry is a decision the caller makes rather than a mystery to debug.
      const overCap = list => Array.isArray(list) && list.length > BOUND_CAP
      const tooLongNote = length => 'bounds list too long: ' + length + ' entries, ' + BOUND_CAP
        + ' is the cap — nothing was written; trim the list or split it, then send it again'
      // One column at a time is the safer shape, and the one the panel uses.
      // The three-list form below can only say "here are three lists", so a
      // caller whose local copy happened to be empty (a blank conversation is
      // answered with an empty board) wipes the two columns it never touched.
      // Naming the column makes "this list is now empty" and "I did not touch
      // that list" two different sentences.
      const items = asList(args.items)
      const explicitCol = normalizeBoundFieldName(args.field)
      if (explicitCol && items) {
        if (overCap(items)) return { ok: false, error: tooLongNote(items.length) }
        current[explicitCol] = normalizeList(items)
        board.bounds = current
        pushLog(board, '更新边界（必做 ' + current.allowed.length + ' / 禁止 ' + current.forbidden.length + ' / 注意 ' + current.notes.length + '）', by, session)
        return { ok: true, bounds: current, board: saveBoard(board, file) }
      }
      // The whole-table form checks every list it was handed before touching
      // any of them: a refusal must leave the two valid columns alone as well,
      // otherwise the error message and the board disagree about what happened.
      const given = { allowed: asList(args.allowed !== undefined ? args.allowed : args.must), forbidden: asList(args.forbidden), notes: asList(args.notes) }
      const tooLong = BOUND_FIELDS.filter(name => overCap(given[name]))
      if (tooLong.length) {
        return {
          ok: false,
          error: 'bounds list too long: ' + tooLong.map(name => name + ' has ' + given[name].length).join(', ')
            + ', ' + BOUND_CAP + ' is the cap — nothing was written; trim or split those lists, then send them again',
        }
      }
      if (given.allowed) current.allowed = normalizeList(given.allowed)
      if (given.forbidden) current.forbidden = normalizeList(given.forbidden)
      if (given.notes) current.notes = normalizeList(given.notes)
      board.bounds = current
      pushLog(board, '更新边界（必做 ' + current.allowed.length + ' / 禁止 ' + current.forbidden.length + ' / 注意 ' + current.notes.length + '）', by, session)
      return { ok: true, bounds: current, board: saveBoard(board, file) }
    }

    if (action === 'bounds.add' || action === 'bounds.pin' || action === 'bounds.remove' || action === 'bounds.edit' || action === 'bounds.consolidate') {
      const col = normalizeBoundFieldName(args.field)
      if (!col) {
        return { ok: false, error: 'bounds operation requires field: allowed (必做) | forbidden (禁止) | notes (注意)' }
      }
      const sharedFile = boardFile()
      const isSameFile = file === sharedFile
      const localBounds = normalizeBounds(board.bounds)

      if (action === 'bounds.add') {
        const val = str(args.item !== undefined ? args.item : args.text, '').trim().slice(0, 400)
        if (!val) return { ok: false, error: 'bounds.add requires non-empty item' }
        const pin = asBool(args.pinned) === true || isSameFile

        if (pin) {
          let capErr = ''
          withBoardLock(sharedFile, () => {
            const sb = isSameFile ? board : loadBoard(sharedFile)
            const sBounds = normalizeBounds(sb.bounds)
            if (!sBounds[col].includes(val)) {
              if (sBounds[col].length >= BOUND_CAP) {
                capErr = 'bounds list too long: ' + BOUND_CAP + ' is the cap'
                return
              }
              sBounds[col].push(val)
              sb.bounds = sBounds
              if (!isSameFile) {
                pushLog(sb, '📌 新增全局共享边界（' + col + '）：' + val.slice(0, 50), by, session)
                saveBoard(sb, sharedFile)
              }
            }
          })
          if (capErr) return { ok: false, error: capErr }
          if (!isSameFile) {
            localBounds[col] = localBounds[col].filter(x => x !== val)
            board.bounds = localBounds
          }
          pushLog(board, '📌 定住全局边界（' + col + '）：' + val.slice(0, 50), by, session)
          return { ok: true, pinned: true, item: val, board: saveBoard(board, file) }
        }

        const sharedSnap = normalizeBounds(loadBoard(sharedFile).bounds)
        if (!sharedSnap[col].includes(val) && !localBounds[col].includes(val)) {
          if (sharedSnap[col].length + localBounds[col].length >= BOUND_CAP) {
            return { ok: false, error: 'bounds list too long: ' + BOUND_CAP + ' is the cap' }
          }
          localBounds[col].push(val)
          board.bounds = localBounds
          pushLog(board, '新增本任务边界（' + col + '）：' + val.slice(0, 50), by, session)
        }
        return { ok: true, pinned: false, item: val, board: saveBoard(board, file) }
      }

      if (action === 'bounds.pin') {
        const val = str(args.item !== undefined ? args.item : args.text, '').trim().slice(0, 400)
        if (!val) return { ok: false, error: 'bounds.pin requires item' }
        const pin = asBool(args.pinned) !== false

        if (pin) {
          let capErr = ''
          withBoardLock(sharedFile, () => {
            const sb = isSameFile ? board : loadBoard(sharedFile)
            const sBounds = normalizeBounds(sb.bounds)
            if (!sBounds[col].includes(val)) {
              if (sBounds[col].length >= BOUND_CAP) {
                capErr = 'bounds list too long: ' + BOUND_CAP + ' is the cap'
                return
              }
              sBounds[col].push(val)
              sb.bounds = sBounds
              if (!isSameFile) {
                pushLog(sb, '📌 定住全局共享边界（' + col + '）：' + val.slice(0, 50), by, session)
                saveBoard(sb, sharedFile)
              }
            }
          })
          if (capErr) return { ok: false, error: capErr }
          if (!isSameFile) {
            localBounds[col] = localBounds[col].filter(x => x !== val)
            board.bounds = localBounds
          }
          pushLog(board, '📌 已定住为全局共享边界：' + val.slice(0, 50), by, session)
          return { ok: true, pinned: true, item: val, board: saveBoard(board, file) }
        }

        // Unpin: remove from global shared board, demote onto current session's local board so this task keeps it
        withBoardLock(sharedFile, () => {
          const sb = isSameFile ? board : loadBoard(sharedFile)
          const sBounds = normalizeBounds(sb.bounds)
          if (sBounds[col].includes(val)) {
            sBounds[col] = sBounds[col].filter(x => x !== val)
            sb.bounds = sBounds
            if (!isSameFile) {
              pushLog(sb, '取消全局定住边界（' + col + '）：' + val.slice(0, 50), by, session)
              saveBoard(sb, sharedFile)
            }
          }
        })
        if (!isSameFile) {
          if (!localBounds[col].includes(val) && localBounds[col].length < BOUND_CAP) {
            localBounds[col].push(val)
          }
          board.bounds = localBounds
        }
        pushLog(board, '取消全局定住（改为仅当前任务生效）：' + val.slice(0, 50), by, session)
        return { ok: true, pinned: false, item: val, board: saveBoard(board, file) }
      }

      if (action === 'bounds.remove') {
        const val = str(args.item !== undefined ? args.item : args.text, '').trim()
        if (!val) return { ok: false, error: 'bounds.remove requires item' }
        withBoardLock(sharedFile, () => {
          const sb = isSameFile ? board : loadBoard(sharedFile)
          const sBounds = normalizeBounds(sb.bounds)
          if (sBounds[col].includes(val)) {
            sBounds[col] = sBounds[col].filter(x => x !== val)
            sb.bounds = sBounds
            if (!isSameFile) saveBoard(sb, sharedFile)
          }
        })
        if (!isSameFile) {
          localBounds[col] = localBounds[col].filter(x => x !== val)
          board.bounds = localBounds
        }
        pushLog(board, '移除边界（' + col + '）：' + val.slice(0, 50), by, session)
        return { ok: true, removed: val, board: saveBoard(board, file) }
      }

      if (action === 'bounds.edit') {
        const oldVal = str(args.oldItem, '').trim()
        const newVal = str(args.item !== undefined ? args.item : args.text, '').trim().slice(0, 400)
        if (!oldVal || !newVal) return { ok: false, error: 'bounds.edit requires oldItem and item' }
        let editedInShared = false
        withBoardLock(sharedFile, () => {
          const sb = isSameFile ? board : loadBoard(sharedFile)
          const sBounds = normalizeBounds(sb.bounds)
          const idx = sBounds[col].indexOf(oldVal)
          if (idx !== -1) {
            sBounds[col][idx] = newVal
            sBounds[col] = [...new Set(sBounds[col])]
            sb.bounds = sBounds
            editedInShared = true
            if (!isSameFile) saveBoard(sb, sharedFile)
          }
        })
        if (!isSameFile) {
          if (editedInShared) {
            localBounds[col] = localBounds[col].filter(x => x !== oldVal && x !== newVal)
          } else {
            const idx = localBounds[col].indexOf(oldVal)
            if (idx !== -1) {
              localBounds[col][idx] = newVal
              localBounds[col] = [...new Set(localBounds[col])]
            }
          }
          board.bounds = localBounds
        }
        pushLog(board, '修订边界（' + col + '）：' + newVal.slice(0, 50), by, session)
        return { ok: true, pinned: editedInShared, item: newVal, board: saveBoard(board, file) }
      }

      if (action === 'bounds.consolidate') {
        const newVal = str(args.item !== undefined ? args.item : args.text, '').trim().slice(0, 400)
        if (!newVal) return { ok: false, error: 'bounds.consolidate requires consolidated item' }
        const rawRemove = asList(args.removeItems) || asList(args.replaces) || []
        const removeSet = new Set(rawRemove.map(x => str(x, '').trim()).filter(Boolean))
        const pin = asBool(args.pinned) === true || isSameFile

        withBoardLock(sharedFile, () => {
          const sb = isSameFile ? board : loadBoard(sharedFile)
          const sBounds = normalizeBounds(sb.bounds)
          sBounds[col] = sBounds[col].filter(x => !removeSet.has(x))
          if (pin && !sBounds[col].includes(newVal)) {
            sBounds[col].push(newVal)
            sBounds[col] = sBounds[col].slice(-BOUND_CAP)
          }
          sb.bounds = sBounds
          if (!isSameFile) {
            pushLog(sb, '🏛 浓缩整理边界（' + col + '）：' + newVal.slice(0, 50), by, session)
            saveBoard(sb, sharedFile)
          }
        })
        if (!isSameFile) {
          localBounds[col] = localBounds[col].filter(x => !removeSet.has(x) && x !== newVal)
          if (!pin) {
            localBounds[col].push(newVal)
            localBounds[col] = localBounds[col].slice(-BOUND_CAP)
          }
          board.bounds = localBounds
        }
        pushLog(board, '🏛 浓缩边界（' + removeSet.size + ' 合 1' + (pin ? ' · 📌全局定住' : '') + '）：' + newVal.slice(0, 50), by, session)
        return { ok: true, pinned: pin, item: newVal, replacedCount: removeSet.size, board: saveBoard(board, file) }
      }
    }

    if (action === 'cursor.set') {
      const current = board.cursor || { at: 0, step: '', next: '', blocked: '', by: '', session: '' }
      const clips = []
      if (typeof args.step === 'string') current.step = clipInto(clips, 'cursor.step', args.step, CAP_CURSOR)
      if (typeof args.next === 'string') current.next = clipInto(clips, 'cursor.next', args.next, CAP_CURSOR)
      if (typeof args.blocked === 'string') current.blocked = clipInto(clips, 'cursor.blocked', args.blocked, CAP_CURSOR)
      if (typeof args.expectedTaskId === 'string') current.expectedTaskId = args.expectedTaskId.trim() || undefined
      if (asBool(args.clear) === true) {
        current.step = ''
        current.next = ''
        current.blocked = ''
        delete current.expectedTaskId
      }
      current.at = nowMs()
      current.by = by
      current.session = session
      board.cursor = current
      const head = current.next || current.step || current.blocked || '（已清空）'
      pushLog(board, '断点：' + head.slice(0, 100), by, session)
      return clipped({ ok: true, cursor: current, board: saveBoard(board, file) }, clips)
    }

    if (action === 'note.unpin') {
      const id = str(args.noteId !== undefined ? args.noteId : args.id, '')
      const note = board.notes.find(item => item.id === id)
      if (!note) return { ok: false, error: 'no such note: ' + id }
      if (!note.pinned) return { ok: false, error: 'note is not pinned: ' + id }
      delete note.pinned
      note.tags = (note.tags || []).filter(tag => String(tag).toLowerCase() !== 'anchor')
      note.updatedAt = nowMs()
      const sharedFile = boardFile()
      withBoardLock(sharedFile, () => {
        const sharedBoard = loadBoard(sharedFile)
        const same = sharedBoard.notes.find(item => item.title === note.title)
        if (same) {
          delete same.pinned
          same.tags = (same.tags || []).filter(tag => String(tag).toLowerCase() !== 'anchor')
          same.updatedAt = nowMs()
          saveBoard(sharedBoard, sharedFile)
        }
      })
      pushLog(board, '笔记取消置顶：' + String(note.title).slice(0, 60), by, session)
      return { ok: true, note, board: saveBoard(board, file) }
    }

    if (action === 'note.pin') {
      // Pinning is the one operation that crosses the per-Session boundary on
      // behalf of the agent: a lesson learned here must survive into a session
      // that never sees this board. So pin writes the note into THIS board and
      // copies it, tagged `anchor`, onto the shared board the digest reads.
      const id = str(args.noteId !== undefined ? args.noteId : args.id, '')
      const note = id
        ? board.notes.find(item => item.id === id)
        : board.notes.find(item => item.title === str(args.title, '').trim())
      if (!note) return { ok: false, error: 'no such note: ' + (id || str(args.title, '')) }
      const tags = normalizeTags((note.tags || []).concat(['anchor']))
      note.tags = tags
      note.updatedAt = nowMs()
      note.pinned = true
      const sharedFile = boardFile()
      const copy = { ...note, id: note.id, tags, pinned: true, session: session || note.session || '' }
      withBoardLock(sharedFile, () => {
        const sharedBoard = loadBoard(sharedFile)
        const same = sharedBoard.notes.find(item => item.title === copy.title)
        if (same) {
          same.body = copy.body
          same.tags = copy.tags
          same.pinned = true
          same.updatedAt = nowMs()
          same.by = by
          same.session = copy.session
        } else {
          sharedBoard.notes.unshift(normalizeNote(copy))
        }
        // Anchor notes are what a fresh Session actually reads, so the count is
        // capped. note.pin and a pinned note.write both add anchors, so both run
        // the same eviction here instead of each carrying half of the rule.
        sharedBoard.notes = enforceAnchorCap(sharedBoard.notes)
        pushLog(sharedBoard, '锚点笔记：' + String(note.title).slice(0, 60), by, session)
        saveBoard(sharedBoard, sharedFile)
      })
      pushLog(board, '笔记已钉为锚点（下一会话可见）：' + String(note.title).slice(0, 60), by, session)
      return { ok: true, note, board: saveBoard(board, file) }
    }

    if (action === 'handoff.mark') {
      const prev = board.handoff || {}
      board.handoff = { ...prev, at: nowMs(), by, session }
      pushLog(board, '生成并交接给参谋看板：交接单已更新', by, session)
      return { ok: true, handoff: board.handoff, board: saveBoard(board, file) }
    }

    if (action === 'handoff.save') {
      const prev = board.handoff || {}
      const reqSource = str(args.source, '')
      const isChief = by === 'chief' || by === 'DSH 参谋长' || reqSource === 'chief'
      if (prev.pinned && isChief && asBool(args.force) !== true) {
        return { ok: false, pinned: true, error: '交接单已被人类固定锁定，参谋长不可覆盖' }
      }
      const rawText = args.text !== undefined ? args.text : args.customText
      const customText = str(rawText, '').slice(0, 16000)
      const now = nowMs()
      board.handoff = {
        ...prev,
        at: now,
        by,
        session: session || prev.session || '',
        customText,
        frozenFromAuto: false,
        updatedAt: now,
        source: isChief ? 'chief' : 'human',
      }
      pushLog(board, isChief ? '✦ 参谋长摘要已同步写入交接单' : '✏️ 人类已手动修订并保存交接单', by, session)
      return { ok: true, handoff: board.handoff, board: saveBoard(board, file) }
    }

    if (action === 'handoff.pin') {
      const prev = board.handoff || {}
      const nextPinned = asBool(args.pinned) !== undefined ? asBool(args.pinned) : !Boolean(prev.pinned)
      const now = nowMs()
      let nextCustomText = str(prev.customText, '')
      let nextSource = prev.source || 'auto'
      let nextFrozenFromAuto = Boolean(prev.frozenFromAuto)
      let nextUpdatedAt = Number(prev.updatedAt) || 0

      if (nextPinned && !nextCustomText.trim()) {
        const providedSnap = str(args.snapshotText, '').trim()
        let autoSnap = providedSnap
        if (!autoSnap) {
          try {
            const eff = resolveEffectiveHandoff(deps.hostState.activeRuntime, session || prev.session || '', board)
            autoSnap = str((eff && (eff.text || eff.autoText)) || '', '').trim()
          } catch {}
        }
        if (autoSnap) {
          nextCustomText = autoSnap.slice(0, 16000)
          nextFrozenFromAuto = true
          nextSource = prev.source || 'auto'
          nextUpdatedAt = now
        }
      } else if (!nextPinned && prev.frozenFromAuto === true) {
        nextCustomText = ''
        nextFrozenFromAuto = false
        nextSource = 'auto'
        nextUpdatedAt = now
      }

      board.handoff = {
        ...prev,
        pinned: nextPinned,
        pinnedAt: nextPinned ? now : 0,
        pinnedBy: nextPinned ? by : '',
        customText: nextCustomText,
        frozenFromAuto: nextFrozenFromAuto,
        source: nextSource,
        updatedAt: nextUpdatedAt,
      }
      pushLog(
        board,
        nextPinned
          ? (nextFrozenFromAuto ? '📌 交接单已定住锁定（已冻结当前自动渲染快照，禁止参谋长覆写）' : '📌 交接单已定住锁定：参谋长自动更新已禁止覆写')
          : (prev.frozenFromAuto ? '🔓 交接单已解除定住并恢复自动实时渲染' : '🔓 交接单已解除定住锁定'),
        by,
        session,
      )
      return { ok: true, handoff: board.handoff, board: saveBoard(board, file) }
    }

    if (action === 'handoff.reset') {
      const prev = board.handoff || {}
      const keepPin = asBool(args.keepPin) === true
      board.handoff = {
        ...prev,
        at: nowMs(),
        by,
        session: session || prev.session || '',
        customText: '',
        frozenFromAuto: false,
        updatedAt: nowMs(),
        source: 'auto',
        pinned: keepPin ? Boolean(prev.pinned) : false,
        pinnedAt: keepPin ? (prev.pinnedAt || 0) : 0,
        pinnedBy: keepPin ? (prev.pinnedBy || '') : '',
      }
      pushLog(board, '↺ 已恢复为自动实时渲染的交接单', by, session)
      return { ok: true, handoff: board.handoff, board: saveBoard(board, file) }
    }

    if (action === 'handoff.setSyncOnDigest') {
      const prev = board.handoff || {}
      const enabled = asBool(args.enabled !== undefined ? args.enabled : args.syncOnDigest) === true
      board.handoff = {
        ...prev,
        syncOnDigest: enabled,
      }
      return { ok: true, handoff: board.handoff, board: saveBoard(board, file) }
    }

    if (action === 'log.add' || action === 'note.add') {
      // pushLog appends whatever it is given, but the very next load clamps one
      // entry to 400 characters — so a long handoff line was stored, then silently
      // cut, and the caller was told the write succeeded as sent.
      const clips = []
      const text = clipInto(clips, 'log.text', str(args.text, '').trim(), CAP_LOG_TEXT)
      if (!text) return { ok: false, error: 'text required' }
      pushLog(board, text, by, session)
      return clipped({ ok: true, board: saveBoard(board, file) }, clips)
    }

    if (action === 'note.write') {
      const clips = []
      const id = str(args.noteId !== undefined ? args.noteId : args.id, '')
      const pinnedNote = asBool(args.pinned) === true
      const tagList = asList(args.tags)
      const given = tagList ? normalizeTags(tagList) : undefined
      // Pinning is a promise about reachability, and every reader of that promise
      // — anchorLines, the ANCHOR_CAP eviction, the digest a fresh Session gets —
      // keys off the `anchor` tag, not off this boolean. A write that stored
      // pinned without the tag described a reach it did not have.
      const tags = pinnedNote ? normalizeTags((given || []).concat(['anchor'])) : given
      if (id) {
        const index = board.notes.findIndex(note => note.id === id)
        if (index < 0) return { ok: false, error: 'no such note: ' + id }
        const note = board.notes[index]
        if (typeof args.title === 'string') note.title = clipInto(clips, 'note.title', args.title, CAP_NOTE_TITLE)
        if (typeof args.body === 'string') note.body = clipInto(clips, 'note.body', args.body, CAP_NOTE_BODY)
        if (tags) note.tags = tags
        note.updatedAt = nowMs()
        if (!note.title.trim() && !note.body.trim()) {
          board.notes.splice(index, 1)
          pushLog(board, '笔记被清空并移除', by, session)
          return clipped({ ok: true, board: saveBoard(board, file) }, clips)
        }
        board.notes = enforceAnchorCap(board.notes)
        return clipped({ ok: true, note, board: saveBoard(board, file) }, clips)
      }
      const rawTitle = clipInto(clips, 'note.title', str(args.title, '').trim(), CAP_NOTE_TITLE)
      const body = clipInto(clips, 'note.body', str(args.body, ''), CAP_NOTE_BODY)
      if (!rawTitle && !body.trim()) return { ok: false, error: 'title or body required' }
      // A note written without a title used to be stored untitled: the panel
      // rendered it as «(无标题)», dedupeNotes keyed it by id so every such write
      // added another nameless row, and the same-title merge could never reach it
      // because there was no title to match. Derive the headline from the first
      // non-empty line of the body, minus its leading markdown markers, so the
      // note stays recognisable, mergeable and searchable.
      const firstLine = body
        .split('\n')
        .map(line => line.replace(LEADING_MARKER, '').trim())
        .find(line => line !== '')
      const title = rawTitle || (firstLine || '').slice(0, 60)
      if (title) {
        const same = board.notes.find(note => note.title === title)
        if (same) {
          same.body = body || same.body
          if (given) same.tags = given
          if (pinnedNote) {
            same.pinned = true
            same.tags = normalizeTags((same.tags || []).concat(['anchor']))
          }
          same.updatedAt = nowMs()
          same.by = by
          same.session = session || same.session
          board.notes = enforceAnchorCap(board.notes)
          return clipped({ ok: true, note: same, board: saveBoard(board, file) }, clips)
        }
      }
      const pinned = pinnedNote ? true : undefined
      const note = normalizeNote({ id: newId('n'), title, body, tags: tags || [], by, session, pinned })
      board.notes.unshift(note)
      board.notes = enforceAnchorCap(board.notes)
      pushLog(board, '新建笔记：' + (note.title || note.body.slice(0, 24)), by, session)
      return clipped({ ok: true, note, board: saveBoard(board, file) }, clips)
    }

    if (action === 'note.read') {
      const id = str(args.noteId !== undefined ? args.noteId : args.id, '')
      const note = board.notes.find(n => n.id === id)
      if (!note) return { ok: false, error: 'no such note: ' + id }
      // Read-tracking: the caller's session lands in readBy so the next agent
      // can see who already picked this note up without re-reading it.
      if (session && !note.readBy.includes(session)) {
        note.readBy.push(session)
        saveBoard(board, file)
      }
      return { ok: true, note, board }
    }

    if (action === 'note.remove') {
      const id = str(args.noteId !== undefined ? args.noteId : args.id, '')
      const index = board.notes.findIndex(note => note.id === id)
      if (index < 0) return { ok: false, error: 'no such note: ' + id }
      const [removed] = board.notes.splice(index, 1)
      pushLog(board, '删除笔记：' + (removed.title || removed.body.slice(0, 24)), by, session)
      return { ok: true, board: saveBoard(board, file) }
    }

    // Memory: written by the host as turns close, and by the human or the model
    // when something matters enough to survive the next turn.
    if (action === 'memory.add') {
      const clips = []
      const text = clipInto(clips, 'memory.text', str(args.text !== undefined ? args.text : args.body, '').trim(), CAP_MEMORY_TEXT)
      if (text === '') return { ok: false, error: 'text required' }
      const added = normalizeMemory([{
        id: newId('mem'),
        at: nowMs(),
        turn: typeof args.turn === 'number' ? args.turn : 0,
        section: str(args.section, 'other'),
        title: clipInto(clips, 'memory.title', str(args.title, ''), CAP_MEMORY_TITLE) || text.slice(0, 80),
        text,
        tools: [],
        by: by || 'user',
        session: session || '',
      }])[0]
      appendMemory(board, { ...added, by: by || 'user' })
      pushLog(board, '记忆 += ' + (added.title || added.text.slice(0, 40)), by, session)
      return clipped({ ok: true, memory: board.memory.slice(-6), board: saveBoard(board, file) }, clips)
    }

    if (action === 'memory.remove') {
      const id = str(args.id !== undefined ? args.id : args.memoryId, '')
      const index = board.memory.findIndex(item => item.id === id)
      if (index < 0) return { ok: false, error: 'no such memory: ' + id }
      const [removed] = board.memory.splice(index, 1)
      pushLog(board, '记忆移除：' + (removed.title || removed.text.slice(0, 32)), by, session)
      return { ok: true, board: saveBoard(board, file) }
    }

    if (action === 'memory.ask') {
      // A question is not an operation on the board, and this branch runs
      // unlocked by design (runAction:419), so it must never touch it: anything
      // written here would live in the loadBoard cache only and be thrown away by
      // the next caches.delete, while the returned board told the panel it was
      // saved. Asking leaves no trace, and the board that comes back is byte for
      // byte the one on disk.
      const question = str(args.question !== undefined ? args.question : args.text, '')
      const answer = answerMemory(board, question)
      return { ok: true, reply: answer.reply, hits: answer.hits, terms: answer.terms, board }
    }

    return { ok: false, error: 'unknown action: ' + action }
  }

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

  /** Collect digest-safe archive context for Lead/Subagent prompt: ONLY desk-spotlight items across all 3 vaults (sealed items NEVER leak to Lead), plus Smart Compaction flag & posture. */
  function collectDigestArchiveContext(runtime, rootId, cabinetId = '') {
    const takenOutArchives = rootId ? collectTakenOutAndFlipped(runtime, rootId, cabinetId) : []
    const sessionArchiveBriefs = []
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
    return { takenOutArchives, sessionArchiveBriefs, smartCompactActive, chiefPermissionMode }
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
    forcesShared,
    isObjectiveLockedByIntervention,
    runAction,
    runActionUnlocked,
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
