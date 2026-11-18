/**
 * subagent-runtime.js
 *
 * Subagent tree resolution, workspace lookup, context accounting, compaction, and Chief runtime bridges.
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { answerMemory } from './memory.js'
import {
  loadChiefState,
  getLinkedCluster,
  collectClusterPeerProgress,
  deliverCrossMessage,
} from './chief.js'
import {
  API,
  newId,
  nowMs,
  str,
  CAP_TASK_TITLE,
  CAP_TASK_INTENT,
  asBool,
  normalizeTask,
  pushLog,
  safe,
} from './board-schema.js'

export function createSubagentRuntime(deps) {

  const boardFile = (...args) => deps.boardFile(...args)
  const boardFileFor = (...args) => deps.boardFileFor(...args)
  const boardForSession = (...args) => deps.boardForSession(...args)
  const composeHandoffFromNarrative = (...args) => deps.composeHandoffFromNarrative(...args)
  const injectInto = (...args) => deps.injectInto(...args)
  const loadBoard = (...args) => deps.loadBoard(...args)
  const runAction = (...args) => deps.runAction(...args)
  const saveBoard = (...args) => deps.saveBoard(...args)
  const withBoardLock = (...args) => deps.withBoardLock(...args)
  const writePending = (...args) => deps.writePending(...args)

  /**
   * Resolve the root Session id for a member of a subagent collaboration tree.
   * Child subagents share their root ("lead") session's chief board so tasks,
   * dependencies, and evidence written by either side appear on one unified graph.
   */
  function resolveRootSessionId(sessionId, agentHint) {
    const sid = String(sessionId || '').trim()
    if (!sid) return ''
    if (deps.hostState.subagentRootMap.has(sid)) return deps.hostState.subagentRootMap.get(sid)
    try {
      if (deps.hostState.activeRuntime) {
        const subagents = deps.hostState.activeRuntime.get('subagents')
        const agents = deps.hostState.activeRuntime.get('agents')
        const agent = agentHint || (agents && typeof agents.get === 'function' ? agents.get(sid) : null)
        if (subagents && typeof subagents.rootOf === 'function' && agent) {
          const root = subagents.rootOf(agent)
          if (root && root.id) {
            const rootId = String(root.id)
            deps.hostState.subagentRootMap.set(sid, rootId)
            return rootId
          }
        }
        if (agent && agent.parentId) {
          let cur = agent
          let guard = 0
          while (cur && cur.parentId && guard++ < 12) {
            if (deps.hostState.subagentRootMap.has(cur.parentId)) {
              const rId = deps.hostState.subagentRootMap.get(cur.parentId)
              deps.hostState.subagentRootMap.set(sid, rId)
              return rId
            }
            const nextParent = agents && typeof agents.get === 'function' ? agents.get(cur.parentId) : null
            if (!nextParent) {
              deps.hostState.subagentRootMap.set(sid, String(cur.parentId))
              return String(cur.parentId)
            }
            cur = nextParent
          }
          if (cur && cur.id) {
            deps.hostState.subagentRootMap.set(sid, String(cur.id))
            return String(cur.id)
          }
        }
      }
    } catch {}
    return sid
  }

  /** Inspect caller's subagent identity ({ self, parent, rootId, isChild, sessionId }). */
  function resolveAgentIdentity(runtime, sessionId, agentHint) {
    const rt = runtime || deps.hostState.activeRuntime
    const sid = String(sessionId || (agentHint && agentHint.id) || '').trim()
    if (!rt || !sid) return null
    try {
      const subagents = rt.get('subagents')
      const agents = rt.get('agents')
      const agent = agentHint || (agents && typeof agents.get === 'function' ? agents.get(sid) : null)
      if (!subagents || !agent) return null
      const names = typeof subagents.namesOf === 'function' ? subagents.namesOf(agent) : null
      const root = typeof subagents.rootOf === 'function' ? subagents.rootOf(agent) : null
      const rootId = root && root.id ? String(root.id) : sid
      if (rootId) deps.hostState.subagentRootMap.set(sid, rootId)
      if (!names) return { self: 'lead', parent: '', rootId, isChild: sid !== rootId, sessionId: sid }
      return {
        self: String(names.self || 'lead'),
        parent: names.parent ? String(names.parent) : '',
        rootId,
        isChild: Boolean(names.parent) || (names.self && names.self !== 'lead'),
        sessionId: sid,
      }
    } catch {
      const rootId = deps.hostState.subagentRootMap.get(sid) || sid
      return { self: sid === rootId ? 'lead' : sid, parent: '', rootId, isChild: sid !== rootId, sessionId: sid }
    }
  }

  /** Refresh and cache the subagent tree for a root session. */
  async function refreshSubagentTree(runtime, sessionId, board) {
    const rt = runtime || deps.hostState.activeRuntime
    const rootId = resolveRootSessionId(sessionId)
    if (!rt || !rootId) return getSubagentRoster(rt, rootId, board)
    try {
      const subagents = rt.get('subagents')
      const agents = rt.get('agents')
      if (subagents && typeof subagents.listDescendants === 'function') {
        const entries = await subagents.listDescendants(rootId)
        if (Array.isArray(entries)) {
          for (const entry of entries) {
            if (entry && entry.id) deps.hostState.subagentRootMap.set(String(entry.id), rootId)
          }
          const rows = [
            {
              id: rootId,
              name: 'lead',
              status: agents && agents.get(rootId)?.status === 'running' ? 'running' : 'inactive',
              description: '主代理 (Root Coordinator)',
              mode: 'continuable',
            },
            ...entries.map(entry => ({
              id: String(entry.id || ''),
              parentId: String(entry.parentId || rootId),
              name: String(entry.path || entry.name || entry.id || ''),
              status: entry.kind === 'diagnostic'
                ? String(entry.reason || 'unavailable')
                : (agents && agents.get(entry.id)?.status === 'running' ? 'running' : 'inactive'),
              description: String(entry.label || entry.description || ''),
              mode: String(entry.mode || 'continuable'),
            })),
          ]
          deps.hostState.subagentTreeCache.set(rootId, rows)
        }
      }
    } catch {}
    return getSubagentRoster(rt, rootId, board)
  }

  /** Synchronous roster combining cached subagent tree + live agent status + board task assignments. */
  function getSubagentRoster(runtime, sessionId, board) {
    const rt = runtime || deps.hostState.activeRuntime
    const rootId = resolveRootSessionId(sessionId)
    const agents = rt ? rt.get('agents') : null
    const cached = deps.hostState.subagentTreeCache.get(rootId) || []
    const byName = new Map()

    const liveStatus = (id, fallback) => {
      try {
        if (agents && typeof agents.get === 'function' && id) {
          const a = agents.get(id)
          if (a) return a.status === 'running' ? 'running' : 'inactive'
        }
      } catch {}
      return fallback || 'inactive'
    }

    for (const row of cached) {
      byName.set(row.name, {
        ...row,
        status: liveStatus(row.id, row.status),
        tasks: [],
      })
    }

    if (!byName.has('lead') && rootId) {
      byName.set('lead', {
        id: rootId,
        name: 'lead',
        status: liveStatus(rootId, 'inactive'),
        description: '主代理 (Root Coordinator)',
        mode: 'continuable',
        tasks: [],
      })
    }

    const tasks = Array.isArray(board && board.tasks) ? board.tasks : []
    for (const t of tasks) {
      const ownerRaw = String(t.subagent || t.owner || '').trim()
      if (!ownerRaw || ownerRaw === 'agent' || ownerRaw === 'operator' || ownerRaw === 'user') continue
      if (!byName.has(ownerRaw)) {
        byName.set(ownerRaw, {
          id: String(t.session || ''),
          name: ownerRaw,
          status: t.status === 'doing' ? liveStatus(t.session, 'running') : 'inactive',
          description: t.title || '',
          mode: 'continuable',
          tasks: [],
        })
      }
      const entry = byName.get(ownerRaw)
      if (entry) {
        entry.tasks.push({ id: t.id, title: t.title, status: t.status })
        if (!entry.taskId && t.status !== 'done') {
          entry.taskId = t.id
          entry.taskTitle = t.title
        }
      }
    }
    return [...byName.values()]
  }

  /** Probe whether the DSH host provides the post-rc.2 named subagent tree APIs. */
  function probeSubagentSupport(rt) {
    const subagents = rt ? safe(() => rt.get('subagents'), null) : null
    if (!subagents) {
      return {
        present: false,
        namedSubagentsSupported: false,
        missingMethods: [],
        minDshVersion: '0.2.2-rc.2',
        warning: '',
      }
    }
    const missingMethods = []
    if (typeof subagents.resolveName !== 'function') missingMethods.push('resolveName')
    if (typeof subagents.rootOf !== 'function') missingMethods.push('rootOf')
    if (typeof subagents.namesOf !== 'function') missingMethods.push('namesOf')
    const ok = missingMethods.length === 0
    return {
      present: true,
      namedSubagentsSupported: ok,
      missingMethods,
      minDshVersion: '0.2.2-rc.2',
      warning: ok
        ? ''
        : '当前 DSH 宿主版本不支持命名子代理树接口（缺少 subagents.resolveName / rootOf / namesOf，常见于 0.2.2-rc.1 及更早版本）。面板其余功能可正常使用；如需使用子代理派发 (task.dispatch) 与插话 (team.steer)，请将 DSH 升级至 >= 0.2.2-rc.2。',
    }
  }

  /** The agent a lookup resolves to: the one named, or the one whose turn this is.
   *  Kept separate from sessionOf because the boundary report has to NAME the
   *  Session it read facts for — the facts were derived from currentInitiator()
   *  while the report said sessionId: null, which is unusable on a machine with
   *  twenty live agents. */
  function agentOf(runtime, sessionId) {
    const agents = runtime.get('agents')
    try {
      if (sessionId && agents && typeof agents.get === 'function') {
        return agents.get(sessionId) || undefined
      }
      if (agents && typeof agents.currentInitiator === 'function') {
        return agents.currentInitiator() || undefined
      }
    } catch {}
    return undefined
  }

  function sessionOf(runtime, sessionId) {
    const agent = agentOf(runtime, sessionId)
    return agent && agent.session ? agent.session : undefined
  }

  /** One registration per route, as the Host web server expects. */
  /** Names that carry no information in a picker: an empty turn marker, a bare
   *  acknowledgement, an injected template, or markup with no words left after
   *  it. A board row is allowed to hold any of these — it is a log line, not a
   *  title — so the gate lives at read time, not at write time. */
  const NAME_NOISE = [
    /^\[pass\]/i,
    /^\[(?:ok|done|fail|warn)\]/i,
    /^\[dsh-mnemon:/i,
    /^\[handoff\b/i,
    /^\[bot team setup\]/i,
    /^\[参谋看板/,
    /^(?:继续|好的|收到|明白|ok|done|yes|no)$/i,
    /^please\s+continue$/i,
    /^\.{2,}$/,
    /^[\s\p{P}\p{S}]+$/u,
  ]

  /** Room a name gets in the picker. A 60-character board objective rendered in
   *  a select box is as unreadable as eight hex characters — it truncates to a
   *  fragment that identifies nothing. 32 keeps a whole clause. */
  const NAME_CAP = 32

  /** True when the text can stand on its own as a label in a picker. */
  function nameWorthShowing(text) {
    const value = str(text, '').replace(/\s+/g, ' ').trim()
    if (value === '') return false
    if (value.replace(/[^\p{L}\p{N}]/gu, '').length < 2) return false
    for (const pattern of NAME_NOISE) {
      if (pattern.test(value)) return false
    }
    return true
  }

  function shortenName(text) {
    const value = str(text, '').replace(/\s+/g, ' ').trim()
    if (value.length <= NAME_CAP) return value
    return value.slice(0, NAME_CAP - 1) + '…'
  }

  function nameCandidate(text) {
    return nameWorthShowing(text) ? shortenName(text) : ''
  }

  /** A human-readable name for one Session.
   *
   *  The picker is how the operator chooses which conversation takes over, so a
   *  row reading `会话 f4ccf574` asks them to recognise a conversation by eight
   *  random hex characters. Three sources, strongest first:
   *
   *  1. The Session's own title. The operator can rename a conversation, and the
   *     title service also derives one from the first prompt — that name is what
   *     the conversation is called everywhere else in the UI, and it survives a
   *     conversation that never wrote a single board row.
   *  2. The board this Session left: a stated objective, the newest memory
   *     headline, the newest open task, the newest note. Only reached when no
   *     title exists (a Session created before the operator named it).
   *  3. The Session header: the leaf of its working directory, then the date it
   *     started. Enough to tell two unnamed conversations apart.
   *
   *  Every source passes the same quality gate, so a `[PASS]` log line or an
   *  injected `[Handoff · part 2]` template is skipped instead of becoming a
   *  label. Returns '' when nothing usable is found; callers then fall back to
   *  the short id, which is at least honest about being an id. */
  function sessionName(runtime, agentOrId) {
    const agent = agentOrId && typeof agentOrId === 'object' ? agentOrId : undefined
    const id = str(agent && agent.id, '') || str(agentOrId, '')
    if (!id) return ''
    const session = agent && agent.session
      ? agent.session
      : safe(() => sessionOf(runtime, id), undefined)

    // Operator-chosen (or derived) title: the only name that exists for a
    // conversation which never touched its board.
    const snap = session
      ? safe(() => {
        const titles = runtime.get('sessionTitle')
        return titles && typeof titles.get === 'function' ? titles.get(session) : undefined
      }, undefined)
      : undefined
    const titled = nameCandidate(snap && snap.title)
    if (titled !== '') return titled

    let board
    try {
      board = loadBoard(boardFileFor(id))
    } catch {
      board = undefined
    }
    if (board) {
      const stated = nameCandidate(board.objective)
      if (stated !== '') return stated
      const memory = Array.isArray(board.memory) ? board.memory : []
      for (let i = memory.length - 1; i >= 0; i -= 1) {
        const fromMemory = nameCandidate(memory[i] && memory[i].title)
        if (fromMemory !== '') return fromMemory
      }
      const tasks = Array.isArray(board.tasks) ? board.tasks : []
      for (const task of tasks) {
        if (!task || task.status === 'done') continue
        const fromTask = nameCandidate(task.title)
        if (fromTask !== '') return fromTask
      }
      const notes = Array.isArray(board.notes) ? board.notes : []
      for (const note of notes) {
        const fromNote = nameCandidate(note && note.title)
        if (fromNote !== '') return fromNote
      }
    }

    // Header: a working directory names the work; a start date at least orders it.
    const header = session && session.header ? session.header : undefined
    const cwd = str(header && header.cwd, '').trim()
    if (cwd !== '') {
      const leaf = safe(() => path.basename(cwd), '')
      const fromCwd = nameCandidate(leaf)
      if (fromCwd !== '') return fromCwd
    }
    const createdAt = Number(header && header.createdAt)
    if (Number.isFinite(createdAt) && createdAt > 0) return dateStamp(createdAt)
    return ''
  }

  /** `M/D` for a Session that has nothing else to go on. */
  function dateStamp(at) {
    const date = new Date(at)
    if (Number.isNaN(date.getTime())) return ''
    return (date.getMonth() + 1) + '/' + date.getDate()
  }

  /** When each Session was last written to disk, read from its own transcript.
   *
   *  The board's heartbeat table only knows Sessions that wrote a board row, so
   *  an untouched conversation shows 0 turns and no time — exactly the row that
   *  most needs a timestamp. The transcript file is touched on every event, so
   *  its mtime answers "when was this conversation last alive" without parsing
   *  a single compressed frame. One directory pass per request; a Session with
   *  no transcript is simply absent from the map. */
  function transcriptTimes() {
    const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
    const root = path.join(home, 'sessions')
    const found = new Map()
    const buckets = safe(() => fs.readdirSync(root), [])
    for (const bucket of buckets) {
      const dir = path.join(root, bucket)
      const names = safe(() => fs.readdirSync(dir), [])
      for (const name of names) {
        const file = path.join(dir, name, 'session.v4.jsonl.zstd')
        let at = 0
        try {
          at = fs.statSync(file).mtimeMs
        } catch {
          continue
        }
        const key = name.indexOf('session-') === 0 ? name : 'session-' + name
        const previous = found.get(key) || 0
        // mtimeMs is a float; every other timestamp on this wire is an integer
        // millisecond stamp, so round rather than leak a fraction into readers
        // that compare with === or format with String().
        const stamp = Math.round(at)
        if (stamp > previous) found.set(key, stamp)
      }
    }
    return found
  }

  /** Normalize a candidate subagent name to DSH's rules: [a-z][a-z0-9-]{0,31}, never 'lead'. */
  function sanitizeSubagentName(raw, fallbackSuffix) {
    let clean = String(raw || '')
      .trim()
      .split('/')
      .pop()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
    if (!clean || clean === 'lead' || clean === 'agent' || clean === 'operator' || clean === 'user' || clean === 'human') {
      clean = 'worker-' + String(fallbackSuffix || newId('w')).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10)
    }
    if (!/^[a-z]/.test(clean)) clean = 'w-' + clean
    return clean.slice(0, 32).replace(/-+$/g, '') || 'worker-1'
  }

  /** Build a self-contained task brief with objective, upstream evidence, and write-back instructions. */
  function buildTaskDispatchBrief(board, task, extraPrompt) {
    const byId = new Map((board.tasks || []).map(t => [t.id, t]))
    const lines = [
      '# 任务委派简报 (dsh-chief Task Dispatch)',
      '',
      '你正在参与主代理（`lead`）统筹的协作任务图。请独立完成以下节点并将结果与证据回写到共享看板：',
      '',
      '- **任务 ID**: `' + task.id + '`',
      '- **任务标题**: ' + task.title,
    ]
    if (board.objective) lines.push('- **全局目标**: ' + board.objective.slice(0, 400))
    if (task.intent) lines.push('- **任务意图 (Intent)**: ' + task.intent)
    if (task.evidence) lines.push('- **验收标准 (Expected Evidence)**: ' + task.evidence)
    if (task.note) lines.push('- **补充说明 (Note)**: ' + task.note)

    if (task.parentId && byId.has(task.parentId)) {
      const parent = byId.get(task.parentId)
      lines.push('- **所属父任务**: #' + parent.id + ' ' + parent.title)
    }

    const deps = (Array.isArray(task.blockedBy) ? task.blockedBy : []).map(id => byId.get(id)).filter(Boolean)
    if (deps.length) {
      lines.push('', '## 上游前置任务产出')
      for (const dep of deps) {
        lines.push('- **#' + dep.id + ' ' + dep.title + '** [' + dep.status + ']' + (dep.evidence ? ' — 证据/结论: ' + dep.evidence : ''))
      }
    }

    const forbidden = board.bounds && Array.isArray(board.bounds.forbidden) ? board.bounds.forbidden : []
    if (forbidden.length) {
      lines.push('', '## 严禁触碰红线 (Forbidden Bounds)')
      for (const item of forbidden.slice(0, 8)) lines.push('- ⛔ ' + item)
    }

    if (extraPrompt && String(extraPrompt).trim()) {
      lines.push('', '## 额外执行指令', String(extraPrompt).trim())
    }

    lines.push(
      '',
      '## 完工回写与跨对话协同要求',
      '1. 完成工作并验证后，**必须**调用 `chief_board` 工具回写参谋看板任务状态与证据：',
      '   `chief_board({ action: "task.update", id: "' + task.id + '", status: "done", evidence: "写明实测结果、修改的文件或关键结论" })`',
      '2. 若遇到无法绕过的阻塞，调用 `chief_board({ action: "task.update", id: "' + task.id + '", status: "blocked", note: "写明阻塞原因" })`。',
      '3. 如需与主对话 (`lead`)、其他兄弟子代理或跨窗口协同会话直接递话/同步结论，调用：',
      '   `chief_board({ action: "mail.send", target: "lead 或子代理名", text: "要同步的关键信息" })`。',
    )
    return lines.join('\n')
  }

  function isInternalProfileCwd(dirPath) {
    return /[\\/]\.dsh[\\/]+profiles(?:$|[\\/])/i.test(String(dirPath || '').trim())
  }

  function listWorkspaceRows(runtime) {
    const rt = runtime || deps.hostState.activeRuntime
    if (!rt) return []
    try {
      const reg = rt.get('workspaceRegistry')
      const rawList = reg && typeof reg.list === 'function' ? reg.list() : []
      return Array.isArray(rawList)
        ? rawList
        : (Array.isArray(rawList && rawList.workspaces) ? rawList.workspaces : (Array.isArray(rawList && rawList.items) ? rawList.items : []))
    } catch {
      return []
    }
  }

  function resolveWorkspaceIdForSession(runtime, sessionId) {
    const sid = String(sessionId || '').trim()
    const rootId = sid ? (resolveRootSessionId(sid) || sid) : ''
    const rows = listWorkspaceRows(runtime)
    if (!rows.length) return ''
    const bySid = rows.find((w) => {
      if (!w) return false
      const sids = Array.isArray(w.sessionIds) ? w.sessionIds : []
      return (sid && sids.includes(sid)) || (rootId && sids.includes(rootId))
    })
    if (bySid && (bySid.workspaceId || bySid.id)) {
      return String(bySid.workspaceId || bySid.id).trim()
    }
    const cwd = getSessionCwd(runtime, sid || rootId)
    if (cwd && !isInternalProfileCwd(cwd)) {
      const normCwd = process.platform === 'win32' ? path.resolve(cwd).toLowerCase() : path.resolve(cwd)
      const byPath = rows.find((w) => {
        if (!w || typeof w.path !== 'string' || !w.path.trim()) return false
        const wNorm = process.platform === 'win32' ? path.resolve(w.path).toLowerCase() : path.resolve(w.path)
        return wNorm === normCwd
      })
      if (byPath && (byPath.workspaceId || byPath.id)) {
        return String(byPath.workspaceId || byPath.id).trim()
      }
    }
    return ''
  }

  function getSessionCwd(runtime, sessionId) {
    const sid = String(sessionId || '').trim()
    const rootId = sid ? (resolveRootSessionId(sid) || sid) : ''
    const rt = runtime || deps.hostState.activeRuntime
    if (rt) {
      try {
        const agents = rt.get('agents')
        const agent = (agents && typeof agents.get === 'function') ? (agents.get(sid) || agents.get(rootId)) : null
        const headerCwd = agent && agent.session && agent.session.header && agent.session.header.cwd
        if (typeof headerCwd === 'string' && headerCwd.trim()) return headerCwd.trim()
        const sessionObj = agent && agent.session ? agent.session : safe(() => sessionOf(rt, sid || rootId), null)
        const wd = rt.get('workingDirectory')
        if (wd && typeof wd.get === 'function' && sessionObj) {
          const wDir = wd.get(sessionObj)
          if (typeof wDir === 'string' && wDir.trim()) return wDir.trim()
        }
      } catch {}
    }
    for (const probeId of [sid, rootId].filter(Boolean)) {
      try {
        const b = loadBoard(boardFileFor(probeId))
        const row = b && b.sessions && (b.sessions[probeId] || b.sessions[sid])
        if (row && typeof row.cwd === 'string' && row.cwd.trim() && !isInternalProfileCwd(row.cwd)) {
          return row.cwd.trim()
        }
      } catch {}
    }
    {
      const rows = listWorkspaceRows(rt)
      if (rows.length) {
        const matched = rows.find((w) => {
          if (!w || typeof w.path !== 'string' || !w.path.trim()) return false
          const sids = Array.isArray(w.sessionIds) ? w.sessionIds : []
          return (sid && sids.includes(sid)) || (rootId && sids.includes(rootId))
        })
        if (matched) return matched.path.trim()
        const sorted = rows
          .filter(w => w && typeof w.path === 'string' && w.path.trim() && !isInternalProfileCwd(w.path))
          .slice()
          .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))
        if (sorted[0]) return sorted[0].path.trim()
      }
    }
    try {
      const boardsDir = path.join(path.dirname(boardFile()), 'boards')
      if (fs.existsSync(boardsDir)) {
        const recentFiles = fs.readdirSync(boardsDir)
          .filter(name => name.endsWith('.json'))
          .map((name) => {
            const full = path.join(boardsDir, name)
            return { full, mtimeMs: safe(() => fs.statSync(full).mtimeMs, 0) }
          })
          .sort((a, b) => b.mtimeMs - a.mtimeMs)
          .slice(0, 15)
        for (const f of recentFiles) {
          const b = safe(() => loadBoard(f.full), null)
          const sessMap = b && b.sessions && typeof b.sessions === 'object' ? Object.values(b.sessions) : []
          for (const row of sessMap) {
            if (row && typeof row.cwd === 'string' && row.cwd.trim() && !isInternalProfileCwd(row.cwd)) {
              return row.cwd.trim()
            }
          }
        }
      }
    } catch {}
    return process.cwd()
  }

  function getSessionContextBreakdown(runtime, sessionId, agentArg = null) {
    const rt = runtime || deps.hostState.activeRuntime
    const sid = String(sessionId || (agentArg && agentArg.id) || '').trim()
    const rootSid = sid ? (resolveRootSessionId(sid, agentArg) || sid) : ''
    const agents = rt ? rt.get('agents') : null
    const ag = agentArg
      || (sid && agents && typeof agents.get === 'function' ? agents.get(sid) : null)
      || (rootSid && agents && typeof agents.get === 'function' ? agents.get(rootSid) : null)

    let contextWindow = 128_000
    let totalTokens = 0
    let seq = 0
    let systemTokens = 0
    let toolsTokens = 0
    let messageTokens = 0
    let modelRef = ''
    let source = 'estimate'

    try {
      const projectionsSvc = rt ? rt.get('sessionProjections') : null
      if (ag && ag.session && projectionsSvc && typeof projectionsSvc.snapshot === 'function') {
        const snap = projectionsSvc.snapshot(ag.session, ['contextPressure', 'contextBreakdown', 'contextTimeline'])
        const values = (snap && snap.values) || {}
        const bd = values.contextBreakdown
        const pressure = values.contextPressure
        const timeline = values.contextTimeline
        if (bd && typeof bd === 'object') {
          if (Number(bd.systemTokens) >= 0) systemTokens = Math.round(Number(bd.systemTokens))
          if (Number(bd.toolsTokens) >= 0) toolsTokens = Math.round(Number(bd.toolsTokens))
          if (Number(bd.messageTokens) >= 0) messageTokens = Math.round(Number(bd.messageTokens))
          if (Number(bd.contextWindow) > 0) contextWindow = Math.round(Number(bd.contextWindow))
          const bdTotal = Number(bd.totalTokens) || (systemTokens + toolsTokens + messageTokens)
          if (bdTotal > 0) {
            totalTokens = Math.round(bdTotal)
            source = 'projection'
          }
        }
        if (pressure && typeof pressure === 'object') {
          if (Number(pressure.contextWindow) > 0) contextWindow = Math.round(Number(pressure.contextWindow))
          const pTok = Number(pressure.projectedTokens) || Number(pressure.pressureTokens) || 0
          if (pTok > totalTokens) {
            totalTokens = Math.round(pTok)
            source = 'projection'
          }
        }
        if (timeline && timeline.current && typeof timeline.current === 'object') {
          const cur = timeline.current
          if (!systemTokens && Number(cur.system) > 0) systemTokens = Math.round(Number(cur.system))
          if (!toolsTokens && Number(cur.tools) > 0) toolsTokens = Math.round(Number(cur.tools))
          if (!totalTokens && Number(cur.total) > 0) totalTokens = Math.round(Number(cur.total))
        }
      }
    } catch {}

    let provider = ''
    let model = ''
    try {
      if (ag && ag.session && typeof ag.session.ownEvents === 'function') {
        const events = ag.session.ownEvents() || []
        seq = events.length
        for (let i = events.length - 1; i >= 0; i -= 1) {
          const ev = events[i]
          if (!ev) continue
          if (!provider && ev.type === 'request/header' && ev.data && ev.data.header && ev.data.header.config) {
            provider = String(ev.data.header.config.provider || '')
            model = String(ev.data.header.config.model || '')
          }
          const usage = ev.usage || (ev.message && ev.message.usage) || (ev.data && ev.data.usage)
          if (!totalTokens && usage && typeof usage === 'object') {
            const calc = (Number(usage.inputTokens) || 0)
              + (Number(usage.cacheReadTokens) || 0)
              + (Number(usage.outputTokens) || 0)
            const uTotal = Number(usage.totalTokens) || calc
            if (uTotal > 0) {
              totalTokens = Math.round(uTotal)
              if (source === 'estimate') source = 'usage'
            }
            if (Number(usage.contextWindow) > 0) contextWindow = Math.round(Number(usage.contextWindow))
            if (!systemTokens && Number(usage.systemTokens) > 0) systemTokens = Math.round(Number(usage.systemTokens))
            if (!toolsTokens && Number(usage.toolsTokens) > 0) toolsTokens = Math.round(Number(usage.toolsTokens))
          }
          if (provider && model && totalTokens > 0) break
        }
      }
    } catch {}

    try {
      const llm = deps.hostState.activeLlm || (rt ? rt.get('llm') : null)
      if (!provider && ag && ag.session && typeof ag.session.requestHeader === 'function') {
        const h = ag.session.requestHeader()
        if (h && h.config) {
          provider = String(h.config.provider || '')
          model = String(h.config.model || '')
        }
      }
      if (provider && model) {
        modelRef = `${provider}/${model}`
        const winCache = (deps.hostState.modelWindowCache = deps.hostState.modelWindowCache || new Map())
        const cachedWin = winCache.get(modelRef)
        if (cachedWin > 0 && contextWindow <= 128_000) {
          contextWindow = cachedWin
        }
        // Historical sessions may reference providers that no longer have an adapter.
        // Never let context-window lookup take down the host process.
        if (llm && typeof llm.resolveModelInfo === 'function' && provider !== 'opendesign') {
          try {
            const infoOrPromise = llm.resolveModelInfo(provider, model)
            if (infoOrPromise && typeof infoOrPromise.then === 'function') {
              infoOrPromise.then((resolved) => {
                if (resolved && Number(resolved.contextWindow) > 0) {
                  winCache.set(modelRef, Math.round(Number(resolved.contextWindow)))
                }
              }).catch(() => {})
            } else if (infoOrPromise && Number(infoOrPromise.contextWindow) > 0) {
              const cw = Math.round(Number(infoOrPromise.contextWindow))
              winCache.set(modelRef, cw)
              contextWindow = cw
            }
          } catch {}
        }
      }
    } catch {}

    // Fallback rough split only when official projection breakdown isn't populated yet
    if (totalTokens > 0 && systemTokens === 0 && toolsTokens === 0 && messageTokens === 0) {
      systemTokens = Math.min(totalTokens, Math.round(Math.min(52_000, Math.max(12_000, contextWindow * 0.04))))
      toolsTokens = Math.min(Math.max(0, totalTokens - systemTokens), 1500)
      messageTokens = Math.max(0, totalTokens - systemTokens - toolsTokens)
    } else if (totalTokens > 0 && messageTokens === 0) {
      messageTokens = Math.max(0, totalTokens - systemTokens - toolsTokens)
    }

    const overheadTokens = systemTokens + toolsTokens
    const usedTokens = Math.max(totalTokens, overheadTokens + messageTokens)
    const otherTokens = Math.max(0, usedTokens - overheadTokens - messageTokens)
    const pct = contextWindow > 0 ? Math.min(100, Math.round((usedTokens / contextWindow) * 100)) : 0

    return {
      totalTokens: usedTokens,
      usedTokens,
      contextWindow,
      pct,
      systemTokens,
      toolsTokens,
      messageTokens,
      otherTokens,
      overheadTokens,
      modelRef,
      seq,
      source,
    }
  }

  function linkedPeersForSession(runtime, rootId) {
    if (!rootId) return { linkedPeersCount: 0, linkedPeersProgress: [] }
    const state = loadChiefState()
    const cluster = getLinkedCluster(state, rootId)
    if (!Array.isArray(cluster) || cluster.length <= 1) {
      return { linkedPeersCount: 0, linkedPeersProgress: [] }
    }
    const linkedPeersProgress = collectClusterPeerProgress(makeChiefDeps(runtime), cluster, rootId)
    return {
      linkedPeersCount: Math.max(0, cluster.length - 1),
      linkedPeersProgress,
    }
  }

  /**
   * Execute host session compaction across Cordis service isolation:
   * 1. Resolve live or archived session agent (`agents.get` -> `sessionController.resolveAgent`).
   * 2. Refuse compaction while the agent is actively running.
   * 3. Prefer unisolated/direct `compaction.compactNow` if present; otherwise invoke
   *    `commands.execute(ag, '/compact', [], signal)` which crosses into `@deepseek-ai/dsh-command-compact`.
   */
  async function executeHostSessionCompaction(rt, sid, cmdId) {
    const targetSid = String(sid || '').trim()
    if (!targetSid) throw new Error('missing target session id for compaction')
    const agents = rt && typeof rt.get === 'function' ? rt.get('agents') : null
    let ag = agents && typeof agents.get === 'function' ? agents.get(targetSid) : null
    if (!ag) {
      const ctrl = rt && typeof rt.get === 'function' ? rt.get('sessionController') : null
      if (ctrl && typeof ctrl.resolveAgent === 'function') {
        try {
          const resolved = await ctrl.resolveAgent(targetSid)
          if (resolved && resolved.agent) ag = resolved.agent
        } catch {}
      }
    }
    if (!ag) throw new Error('target session agent not found for compaction')
    if (ag.status === 'running') throw new Error('agent is busy running; refusing compaction')

    const signal = AbortSignal.timeout(60_000)
    const effectiveCmdId = cmdId || ('chief-compact-' + Date.now().toString(36))

    const compSvc = rt && typeof rt.get === 'function' ? rt.get('compaction') : null
    if (compSvc && typeof compSvc.compactNow === 'function') {
      const directRes = await compSvc.compactNow(ag, signal, effectiveCmdId)
      if (directRes === null) {
        return { ok: true, noop: true, via: 'compaction.compactNow', commandId: effectiveCmdId, text: 'No compactable history yet.' }
      }
      return directRes && typeof directRes === 'object'
        ? { ok: true, noop: false, via: 'compaction.compactNow', ...directRes }
        : { ok: true, noop: false, via: 'compaction.compactNow', result: directRes }
    }

    const cmdSvc = rt && typeof rt.get === 'function' ? rt.get('commands') : null
    if (cmdSvc && typeof cmdSvc.execute === 'function') {
      const execOut = await cmdSvc.execute(ag, '/compact', [], signal)
      const cmdRes = execOut && execOut.result ? execOut.result : execOut
      if (!cmdRes) {
        throw new Error('dsh-command /compact unavailable in runtime')
      }
      if (cmdRes.kind === 'error') {
        throw new Error(String(cmdRes.text || 'host /compact command failed'))
      }
      const text = String(cmdRes.text || '')
      const noop = /no compactable history/i.test(text)
      return {
        ok: true,
        noop,
        via: 'commands:/compact',
        commandId: (execOut && execOut.commandId) || effectiveCmdId,
        text,
        sourceEventSeq: cmdRes.sourceEventSeq,
      }
    }

    throw new Error('dsh-compaction and /compact command services unavailable')
  }

  function makeChiefDeps(runtime) {
    const rt = runtime || deps.hostState.activeRuntime
    return {
      runtime: rt,
      getLlm: () => deps.hostState.activeLlm || (rt ? rt.get('llm') : null),
      getAttachments: () => safe(() => (rt ? rt.get('attachments') : null), null),
      getSessionCwd: (sid) => getSessionCwd(rt, sid),
      getAgentStatus(sid) {
        const agents = rt ? rt.get('agents') : null
        const ag = agents && typeof agents.get === 'function' ? agents.get(sid) : null
        return (ag && ag.status) || 'idle'
      },
      async measureSessionTokens(sid, agentArg) {
        return getSessionContextBreakdown(rt, sid, agentArg)
      },
      composeHandoffFromNarrative(opts) {
        return composeHandoffFromNarrative(opts)
      },
      async compactSessionNow(sid, cmdId) {
        return executeHostSessionCompaction(rt, sid, cmdId)
      },
      stagePendingTransfer(text, fromSid, extra = {}) {
        const cleanText = String(text || '').trim()
        if (!cleanText) return false
        return writePending({
          at: nowMs(),
          by: (extra && extra.by) || 'chief',
          session: fromSid || 'global',
          text: cleanText,
          ...(extra && typeof extra === 'object' ? extra : {}),
        })
      },
      resolveRootSessionId,
      resolveAgentIdentity,
      refreshSubagentTree,
      boardForSession,
      boardFileFor,
      sharedBoardFile: boardFile,
      loadBoard,
      sessionName,
      findLiveCallerAgent,
      runAction,
      answerMemory,
      appendBoardLog(rootSessionId, text, by) {
        if (!rootSessionId) return
        const file = boardFileFor(rootSessionId)
        withBoardLock(file, () => {
          const board = loadBoard(file)
          pushLog(board, text, by || 'chief', rootSessionId)
          saveBoard(board, file)
        })
      },
      executeSubagentAction: (input, callerAgent, signal) => executeSubagentAction(rt, input, callerAgent, signal),
      async controlMainAgent({ rootId = '', sessionId = '', op = 'steer', modelRef = '', reasoningEffort = '', message = '', reason = '' } = {}) {
        const targetSid = String(sessionId || rootId || '').trim()
        if (!targetSid || targetSid === 'global') {
          return { ok: false, error: '当前为空白未绑定会话，无法直接控制主对话代理' }
        }
        const ctrl = rt ? rt.get('sessionController') : null
        if (op === 'switch_model') {
          const rawRef = String(modelRef || '').trim()
          if (!rawRef) return { ok: false, error: 'switch_model 需要 modelRef 参数（如 provider/model）' }
          if (!ctrl || typeof ctrl.selectModel !== 'function') {
            return { ok: false, error: '当前宿主未挂载 sessionController.selectModel 接口' }
          }
          const slash = rawRef.indexOf('/')
          let provider = slash > 0 ? rawRef.slice(0, slash).trim() : ''
          const model = slash > 0 ? rawRef.slice(slash + 1).trim() : rawRef
          if (!provider) {
            const curInfo = getSessionContextBreakdown(rt, targetSid)
            const curRef = String((curInfo && curInfo.modelRef) || '')
            if (curRef.includes('/')) provider = curRef.split('/')[0]
          }
          try {
            const selRes = await ctrl.selectModel({
              sessionId: targetSid,
              ...(provider ? { provider } : {}),
              model,
              ...(reasoningEffort ? { reasoningEffort } : {}),
            })
            return {
              ok: true,
              selected: selRes && selRes.selected ? selRes.selected : { provider, model },
              badge: `🔄 主模型 → ${model}`,
            }
          } catch (err) {
            return { ok: false, error: (err && err.message) || String(err || '切换主模型失败') }
          }
        }
        if (op === 'interrupt') {
          try {
            if (ctrl && typeof ctrl.cancel === 'function') {
              await ctrl.cancel({ sessionId: targetSid })
              return { ok: true, interrupted: true, badge: '⏹ 已中断主对话' }
            }
            const agents = rt ? rt.get('agents') : null
            const ag = agents && typeof agents.get === 'function' ? agents.get(targetSid) : null
            if (ag && typeof ag.interrupt === 'function') {
              await ag.interrupt()
              return { ok: true, interrupted: true, badge: '⏹ 已中断主对话' }
            }
            return { ok: false, error: '当前宿主未提供主对话中断接口' }
          } catch (err) {
            return { ok: false, error: (err && err.message) || String(err || '中断主对话失败') }
          }
        }
        const textBody = String(message || reason || '').trim()
        if (!textBody) return { ok: false, error: '引导主对话需要 message 指令内容' }
        const deliv = await deliverCrossMessage(makeChiefDeps(rt), {
          fromSession: rootId || targetSid,
          fromLabel: 'DSH 参谋长 (控制主代理)',
          target: 'lead',
          subject: reason || '参谋长主对话工作流调控',
          text: textBody,
          mode: op === 'followup' ? 'followup' : 'steer',
        })
        return {
          ...deliv,
          badge: deliv.ok ? `🎯 已${op === 'followup' ? '递话' : '插话'}主代理` : '⚠️ 调控主代理失败',
        }
      },
      async triggerAutoContinueNow(sid, trigger, opts = {}) {
        if (!deps.hostState.activeAutoContinue || typeof deps.hostState.activeAutoContinue.fireNow !== 'function') {
          return { ok: false, error: '断线续跑引擎未挂载' }
        }
        return deps.hostState.activeAutoContinue.fireNow(sid, trigger, { ...(opts || {}), bypassGate: true })
      },
      cancelAutoContinue(sid, reason) {
        return Boolean(
          deps.hostState.activeAutoContinue
          && typeof deps.hostState.activeAutoContinue.cancelSession === 'function'
          && sid
          && deps.hostState.activeAutoContinue.cancelSession(sid, reason || 'chief-halt'),
        )
      },
    }
  }

  /** Find a live calling or root agent handle for subagent operations. */
  function findLiveCallerAgent(runtime, sessionId, callerAgent) {
    if (callerAgent && callerAgent.id) return callerAgent
    const rt = runtime || deps.hostState.activeRuntime
    if (!rt) return null
    const agents = rt.get('agents')
    if (!agents) return null
    const rootId = resolveRootSessionId(sessionId)
    if (sessionId && typeof agents.get === 'function') {
      const exact = agents.get(sessionId)
      if (exact) return exact
    }
    if (rootId && typeof agents.get === 'function') {
      const rootAgent = agents.get(rootId)
      if (rootAgent) return rootAgent
    }
    if (typeof agents.list === 'function') {
      const all = agents.list()
      if (Array.isArray(all) && all.length) return all[0]
    }
    return null
  }

  /**
   * Execute asynchronous subagent team actions (`task.dispatch`, `team.steer`, `team.interrupt`).
   * Works identically whether invoked from the model's `chief_board` tool or from the Web GUI.
   */
  async function executeSubagentAction(runtime, input, callerAgent, signal) {
    const rt = runtime || deps.hostState.activeRuntime
    const args = input && typeof input === 'object' ? input : {}
    const action = str(args.action, '')
    const by = str(args.by, callerAgent ? 'agent' : 'operator')
    const session = str(args.session, callerAgent && callerAgent.id ? String(callerAgent.id) : '')
    const rootId = resolveRootSessionId(session, callerAgent)
    const file = boardFileFor(rootId || session)
    const subagents = rt ? rt.get('subagents') : null
    const agents = rt ? rt.get('agents') : null
    const sig = signal || new AbortController().signal

    if (!rootId && !session) {
      return { ok: false, error: 'no active session bound for subagent operation' }
    }

    const liveCaller = findLiveCallerAgent(rt, rootId || session, callerAgent)

    if (action === 'task.dispatch') {
      const taskId = str(args.taskId !== undefined ? args.taskId : args.id, '').trim()
      if (!taskId) return { ok: false, error: 'task.dispatch requires id (taskId)' }

      const boardSnapshot = loadBoard(file)
      const targetTask = boardSnapshot.tasks.find(t => t.id === taskId)
      if (!targetTask) return { ok: false, error: 'no such task: ' + taskId }

      const unresolved = (targetTask.blockedBy || []).filter(depId => {
        const dep = boardSnapshot.tasks.find(t => t.id === depId)
        return dep && dep.status !== 'done'
      })
      if (unresolved.length && asBool(args.force) !== true) {
        return { ok: false, error: '任务 #' + taskId + ' 仍有未完成的前置依赖: ' + unresolved.join(', ') + '（完成后将自动解锁，或传 force: true 强制派发）' }
      }

      const requestedTarget = str(args.agent || args.subagent || args.target || targetTask.subagent || targetTask.owner, '').trim()
      const brief = buildTaskDispatchBrief(boardSnapshot, targetTask, args.prompt || args.message || args.text)
      let dispatchedName = requestedTarget
      let childSessionId = ''
      let dispatchMode = 'assigned'

      // Case 1: Dispatch to an existing standalone session (session-...)
      if (requestedTarget.startsWith('session-') && agents && typeof agents.get === 'function') {
        const targetSessionAgent = agents.get(requestedTarget)
        if (targetSessionAgent) {
          const delivered = await injectInto(targetSessionAgent, brief)
          if (!delivered.ok) return { ok: false, error: '向会话投递失败: ' + delivered.error }
          childSessionId = requestedTarget
          dispatchMode = 'session-inject'
        }
      } else if (subagents && liveCaller) {
        // Case 2: Use DSH native subagent service (continue existing subagent or spawn/fork a new one)
        if (typeof subagents.resolveName !== 'function' || typeof subagents.startActivation !== 'function') {
          return {
            ok: false,
            error: '当前 DSH 宿主不支持命名子代理 API（缺少 subagents.resolveName / startActivation，例如 0.2.2-rc.1 为重构前旧接口），请将 DSH 升级至 >= 0.2.2-rc.2 后再使用子代理派发与插话。',
          }
        }
        const providerName = str(args.provider, targetTask.preset === 'fork' ? 'fork' : 'spawn') || 'spawn'
        const preset = str(args.preset, targetTask.preset && targetTask.preset !== 'fork' && targetTask.preset !== 'spawn' ? targetTask.preset : '')
        const candidateName = sanitizeSubagentName(requestedTarget, targetTask.id)

        let existingTargetId = ''
        if (requestedTarget && requestedTarget !== 'agent' && requestedTarget !== 'operator' && requestedTarget !== 'lead') {
          try {
            existingTargetId = await subagents.resolveName(liveCaller, requestedTarget, sig)
          } catch {
            try {
              existingTargetId = await subagents.resolveName(liveCaller, candidateName, sig)
            } catch {}
          }
        }

        if (existingTargetId && existingTargetId !== String(liveCaller.id)) {
          await subagents.sendMessage(liveCaller, existingTargetId, [{ type: 'text', text: brief }], { signal: sig })
          dispatchedName = requestedTarget || candidateName
          childSessionId = String(existingTargetId)
          deps.hostState.subagentRootMap.set(childSessionId, rootId)
          dispatchMode = 'send_message'
        } else {
          let activation
          try {
            activation = await subagents.startActivation({
              provider: providerName,
              label: targetTask.title.slice(0, 48),
              name: candidateName,
              prompt: [{ type: 'text', text: brief }],
              parent: liveCaller,
              ...(preset ? { agentPreset: preset } : {}),
              signal: sig,
              delivery: 'parent',
            })
          } catch (spawnErr) {
            // If name collision occurred, retry with a unique suffix
            const msg = String(spawnErr && spawnErr.message ? spawnErr.message : spawnErr)
            if (/already exists|unique|taken|duplicate/i.test(msg)) {
              const fallbackName = sanitizeSubagentName(candidateName + '-' + Math.random().toString(36).slice(2, 5), targetTask.id)
              activation = await subagents.startActivation({
                provider: providerName,
                label: targetTask.title.slice(0, 48),
                name: fallbackName,
                prompt: [{ type: 'text', text: brief }],
                parent: liveCaller,
                ...(preset ? { agentPreset: preset } : {}),
                signal: sig,
                delivery: 'parent',
              })
            } else {
              return { ok: false, error: '启动子代理失败: ' + msg }
            }
          }
          dispatchedName = String((activation && activation.name) || candidateName)
          childSessionId = String((activation && activation.childId) || '')
          if (childSessionId) deps.hostState.subagentRootMap.set(childSessionId, rootId)
          dispatchMode = 'spawn:' + providerName
        }
      } else {
        dispatchedName = sanitizeSubagentName(requestedTarget, targetTask.id)
        dispatchMode = 'board-only (no live parent agent active)'
      }

      const updated = withBoardLock(file, () => {
        const board = loadBoard(file)
        const task = board.tasks.find(t => t.id === taskId)
        if (!task) return { ok: false, error: 'no such task: ' + taskId }
        task.status = 'doing'
        task.owner = dispatchedName
        task.subagent = dispatchedName
        if (childSessionId) task.session = childSessionId
        if (args.preset) task.preset = str(args.preset, '').slice(0, 80)
        task.dispatchedAt = nowMs()
        task.updatedAt = nowMs()
        board.cursor = {
          ...(board.cursor || {}),
          at: nowMs(),
          step: '已派发 #' + task.id + ' ' + task.title.slice(0, 60) + ' → ' + dispatchedName,
          expectedTaskId: task.id,
          by,
          session: rootId || session,
        }
        pushLog(board, '🚀 派发任务 #' + task.id + '「' + task.title.slice(0, 36) + '」→ 子代理 ' + dispatchedName + ' (' + dispatchMode + ')', by, rootId || session)
        return { ok: true, task, board: saveBoard(board, file) }
      })
      if (!updated.ok) return updated
      const roster = await refreshSubagentTree(rt, rootId || session, updated.board)
      return {
        ok: true,
        dispatched: { taskId, agent: dispatchedName, childSessionId, mode: dispatchMode },
        task: updated.task,
        board: updated.board,
        subagents: roster,
      }
    }

    if (action === 'team.steer') {
      const taskId = str(args.taskId !== undefined ? args.taskId : args.id, '').trim()
      const boardSnapshot = loadBoard(file)
      const linkedTask = taskId ? boardSnapshot.tasks.find(t => t.id === taskId) : null
      const targetName = str(args.agent || args.subagent || args.target || (linkedTask && (linkedTask.subagent || linkedTask.owner)), '').trim()
      const text = str(args.message || args.prompt || args.text || args.note, '').trim()
      if (!targetName) return { ok: false, error: 'team.steer requires agent name or task id with assigned subagent' }
      if (!text) return { ok: false, error: 'team.steer requires message / prompt text' }
      if (!subagents || !liveCaller) return { ok: false, error: 'subagents service or live caller agent unavailable' }
      if (typeof subagents.resolveName !== 'function') {
        return {
          ok: false,
          error: '当前 DSH 宿主不支持命名子代理 API（缺少 subagents.resolveName，例如 0.2.2-rc.1 为重构前旧接口），请将 DSH 升级至 >= 0.2.2-rc.2 后再使用子代理派发与插话。',
        }
      }

      let targetId = ''
      try {
        targetId = await subagents.resolveName(liveCaller, targetName, sig)
      } catch (err) {
        return { ok: false, error: '找不到子代理 "' + targetName + '": ' + String(err && err.message ? err.message : err) }
      }
      const messageId = await subagents.sendMessage(liveCaller, targetId, [{ type: 'text', text }], { signal: sig })
      const updated = withBoardLock(file, () => {
        const board = loadBoard(file)
        const task = taskId
          ? board.tasks.find(t => t.id === taskId)
          : board.tasks.find(t => (t.subagent === targetName || t.owner === targetName) && t.status !== 'done')
        if (task) {
          task.status = 'doing'
          task.updatedAt = nowMs()
        }
        pushLog(board, '💬 向子代理 ' + targetName + ' 发送引导指令：' + text.slice(0, 60), by, rootId || session)
        return { ok: true, task, board: saveBoard(board, file) }
      })
      const roster = await refreshSubagentTree(rt, rootId || session, updated.board)
      return { ok: true, messageId, agent: targetName, board: updated.board, subagents: roster }
    }

    if (action === 'team.interrupt') {
      const taskId = str(args.taskId !== undefined ? args.taskId : args.id, '').trim()
      const boardSnapshot = loadBoard(file)
      const linkedTask = taskId ? boardSnapshot.tasks.find(t => t.id === taskId) : null
      const targetName = str(args.agent || args.subagent || args.target || (linkedTask && (linkedTask.subagent || linkedTask.owner)), '').trim()
      if (!targetName) return { ok: false, error: 'team.interrupt requires agent name or task id' }
      if (!subagents || !liveCaller) return { ok: false, error: 'subagents service or live caller agent unavailable' }
      if (typeof subagents.resolveName !== 'function') {
        return {
          ok: false,
          error: '当前 DSH 宿主不支持命名子代理 API（缺少 subagents.resolveName，例如 0.2.2-rc.1 为重构前旧接口），请将 DSH 升级至 >= 0.2.2-rc.2 后再使用子代理派发与插话。',
        }
      }
      if (typeof subagents.interrupt !== 'function') {
        return { ok: false, error: '当前 DSH 宿主不支持 subagents.interrupt，请升级至 >= 0.2.2-rc.2' }
      }

      let targetId = ''
      try {
        targetId = await subagents.resolveName(liveCaller, targetName, sig)
      } catch (err) {
        return { ok: false, error: '找不到子代理 "' + targetName + '": ' + String(err && err.message ? err.message : err) }
      }
      subagents.interrupt(targetId, { kind: 'ancestor', agent: liveCaller })
      const updated = withBoardLock(file, () => {
        const board = loadBoard(file)
        const task = taskId
          ? board.tasks.find(t => t.id === taskId)
          : board.tasks.find(t => (t.subagent === targetName || t.owner === targetName) && t.status === 'doing')
        if (task && asBool(args.keepDoing) !== true) {
          task.status = 'blocked'
          task.note = (task.note ? task.note + '\n' : '') + '[已中断子代理 ' + targetName + ']'
          task.updatedAt = nowMs()
        }
        pushLog(board, '⏹ 已请求中断子代理：' + targetName, by, rootId || session)
        return { ok: true, task, board: saveBoard(board, file) }
      })
      const roster = await refreshSubagentTree(rt, rootId || session, updated.board)
      return { ok: true, interrupted: targetName, board: updated.board, subagents: roster }
    }

    return { ok: false, error: 'unknown subagent action: ' + action }
  }

  /**
   * Mirror native `subagent` / `subagent_fork` / `send_message` / `interrupt_agent`
   * tool calls into the shared root chief board so the visual DAG always reflects
   * live subagent delegations even when the model calls native tools directly.
   */
  function syncSubagentToolCall(runtime, exec, result) {
    try {
      const caller = exec && exec.agent ? exec.agent : null
      const sessionId = caller && caller.id ? String(caller.id) : ''
      if (!sessionId) return
      const rootId = resolveRootSessionId(sessionId, caller)
      const file = boardFileFor(rootId || sessionId)
      const toolName = String((exec && exec.name) || '')
      const args = exec && typeof exec.arguments === 'object' && exec.arguments
        ? exec.arguments
        : (typeof exec?.arguments === 'string' ? safe(() => JSON.parse(exec.arguments), {}) : {})

      if (toolName === 'subagent' || toolName === 'subagent_fork') {
        // Extract started subagent name from presentationMeta, structured value, or rendered text
        let childName = ''
        if (result && result.value && typeof result.value.name === 'string') {
          childName = result.value.name
        } else if (result && Array.isArray(result.content)) {
          const txt = result.content.map(c => c && c.text ? c.text : '').join(' ')
          const m = /started subagent\s+([^\s]+)/i.exec(txt)
          if (m) childName = m[1]
        }
        if (!childName) childName = str(args.name, 'subagent')
        const shortChild = childName.split('/').pop()
        const desc = str(args.description, '').trim() || ('子代理任务: ' + childName)
        const promptText = str(args.prompt, '').trim()
        const presetVal = str(args.agent_preset, toolName === 'subagent_fork' ? 'fork' : 'spawn')

        withBoardLock(file, () => {
          const board = loadBoard(file)
          // Find an existing open task matching this subagent owner or title
          let task = board.tasks.find(t =>
            t.status !== 'done' && (
              t.subagent === childName ||
              t.owner === childName ||
              t.subagent === shortChild ||
              t.owner === shortChild ||
              (desc && t.title.toLowerCase() === desc.toLowerCase())
            ),
          )
          if (task) {
            task.status = 'doing'
            task.owner = childName
            task.subagent = childName
            task.preset = task.preset || presetVal
            if (!task.intent && promptText) task.intent = promptText.slice(0, CAP_TASK_INTENT)
            task.dispatchedAt = nowMs()
            task.updatedAt = nowMs()
          } else {
            const parentId = (board.cursor && board.cursor.expectedTaskId && board.tasks.some(t => t.id === board.cursor.expectedTaskId))
              ? board.cursor.expectedTaskId
              : ''
            task = normalizeTask({
              id: newId('t'),
              title: desc.slice(0, CAP_TASK_TITLE),
              note: '',
              status: 'doing',
              priority: 'normal',
              owner: childName,
              subagent: childName,
              preset: presetVal,
              dispatchedAt: nowMs(),
              session: rootId || sessionId,
              intent: promptText.slice(0, CAP_TASK_INTENT),
              evidence: '',
              blockedBy: [],
              parentId,
              createdAt: nowMs(),
              updatedAt: nowMs(),
            })
            board.tasks.push(task)
          }
          pushLog(board, '🤖 自动同步子代理委派：' + childName + ' → #' + task.id + '「' + task.title.slice(0, 40) + '」', 'agent', rootId || sessionId)
          saveBoard(board, file)
        })
        refreshSubagentTree(runtime, rootId || sessionId).catch(() => {})
      } else if (toolName === 'send_message') {
        const target = str(args.agent, '').trim()
        const msg = str(args.message, '').trim()
        if (!target) return
        withBoardLock(file, () => {
          const board = loadBoard(file)
          const task = board.tasks.find(t => (t.subagent === target || t.owner === target) && t.status !== 'done')
          if (task && task.status !== 'doing') {
            task.status = 'doing'
            task.updatedAt = nowMs()
          }
          pushLog(board, '💬 消息投递 → ' + target + '：' + msg.slice(0, 50), 'agent', rootId || sessionId)
          saveBoard(board, file)
        })
      } else if (toolName === 'interrupt_agent') {
        const target = str(args.agent, '').trim()
        if (!target) return
        withBoardLock(file, () => {
          const board = loadBoard(file)
          pushLog(board, '⏹ 中断子代理：' + target, 'agent', rootId || sessionId)
          saveBoard(board, file)
        })
      }
    } catch {}
  }

  /**
   * Shared fetch for the official Agent Team board. All three renderHandoff call
   * sites need it, and each one used to inline its own try/catch — drift waiting
   * to happen. The caller passes whatever agent handle the context exposes
   * (exec.agent for tools, spCtx.agent for the system prompt, a sessionId string
   * for the panel API — listTasks only needs a stable id).
   */
  function fetchTeamTasks(runtime, agent) {
    try {
      const svc = runtime.get('agentTeams')
      if (!svc || typeof svc.listTasks !== 'function' || !agent) return undefined
      return svc.listTasks(agent) || undefined
    } catch { return undefined }
  }

  return {
    resolveRootSessionId,
    resolveAgentIdentity,
    refreshSubagentTree,
    getSubagentRoster,
    probeSubagentSupport,
    agentOf,
    sessionOf,
    sessionName,
    dateStamp,
    transcriptTimes,
    sanitizeSubagentName,
    buildTaskDispatchBrief,
    isInternalProfileCwd,
    listWorkspaceRows,
    resolveWorkspaceIdForSession,
    getSessionCwd,
    getSessionContextBreakdown,
    linkedPeersForSession,
    executeHostSessionCompaction,
    makeChiefDeps,
    findLiveCallerAgent,
    executeSubagentAction,
    syncSubagentToolCall,
    fetchTeamTasks,
  }
}
