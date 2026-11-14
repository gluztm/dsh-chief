/**
 * Host half of dsh-chief.
 *
 * Owns one JSON file that every Session and every DSH process on this machine
 * shares, exposes it to the browser half over same-origin routes, and exposes
 * the same operations to the model as tools, so a task written in one Session
 * can be read, claimed and finished from another one.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import { renderDigest, planFromTodos, objectiveFromGoal, planSignature } from './digest.js'
import { renderHandoff } from './handoff.js'
import {
  MEMORY_SECTIONS,
  appendMemory,
  answerMemory,
  captureTurn,
  memorySections,
  normalizeMemory,
  renderMemoryDigest,
} from './memory.js'
import {
  buildNotice,
  clearCallTrail,
  isPlanWrite,
  noteCallTrail,
  noteIntervention,
  notePlanWrite,
  noteToolCall,
  remainingInterventions,
  shouldGuard,
} from './idle-guard.js'
import {
  loadChiefState,
  getLinkedCluster,
  setPeerLink,
  invalidateChiefModelCatalog,
  listChiefModels,
  listPeerDirectory,
  deliverCrossMessage,
  consumePreStepDelta,
  getChiefView,
  askOrCommandChief,
  consolidateBoundsWithChief,
  organizeArchivesWithChief,
  proposeBoundToChief,
  scheduleChiefTurnReview,
  handleSuggestionDecision,
  updateChiefConfig,
  mutateChiefFact,
  readMailboxForAgent,
} from './chief.js'
import {
  bootstrapArchivesFromSharedBoard,
  getArchiveMeta,
  listArchiveHeaders,
  getArchiveDetail,
  searchArchives,
  mutateArchive,
  getTakenOutArchivesForSession,
} from './archives.js'

const API = '/api/dsh-chief'
const BOARD_VERSION = 1
const LOG_CAP = 60
const BODY_LIMIT = 128 * 1024
// How many anchor notes the shared board keeps. Anchors are what a fresh
// Session reads before it has any context, so this is a budget, not a list.
/**
 * Keeps the anchor set at the size the digest can actually show.
 *
 * Two paths add anchors — note.pin and a pinned note.write — and only the first
 * used to run this, so the shared board grew past the cap and every note's
 * share of the fixed ANCHOR_RESERVE shrank. The eviction also used to skip every
 * pinned note, which after the above meant it could never drop anything: the
 * notes it was meant to trim were exactly the ones a pinned write leaves
 * pinned=true on. Age is the tie-breaker that always exists: the oldest anchor
 * goes first, pinned ones included, because a board that names thirteen lessons
 * has already outgrown the point where a reader can hold them. An anchor older
 * than the cap loses the tag rather than the note: the lesson stays readable in
 * the panel and out of the digest, and its pinned flag goes with it, because
 * pinned only ranks notes inside the anchor set.
 */
function enforceAnchorCap(notes) {
  const anchors = notes.filter(item => (item.tags || []).includes('anchor'))
  if (anchors.length <= ANCHOR_CAP) return notes
  // Newest first, drop the tail. Ties on updatedAt (a burst of pins inside one
  // millisecond) fall back to board order, which already puts the newest first,
  // so the tie itself resolves the same way the timestamps would.
  const ordered = anchors.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  const demoteIds = new Set(ordered.slice(ANCHOR_CAP).map(item => item.id))
  return notes.map(item => {
    if (!demoteIds.has(item.id)) return item
    const tags = (item.tags || []).filter(tag => tag !== 'anchor')
    const demoted = Object.assign({}, item, { tags })
    delete demoted.pinned
    return demoted
  })
}

const ANCHOR_CAP = 12

const STATUSES = ['todo', 'doing', 'blocked', 'done']
const PRIORITIES = ['high', 'normal', 'low']

let seq = 0
function newId(prefix) {
  seq += 1
  return prefix + '-' + Date.now().toString(36) + '-' + seq.toString(36)
}

function nowMs() {
  return Date.now()
}

function pendingFile() {
  return path.join(path.dirname(boardFile()), 'pending-transfer.json')
}

function readPending() {
  try {
    const raw = JSON.parse(fs.readFileSync(pendingFile(), 'utf8'))
    return raw && typeof raw.text === 'string' && raw.text ? raw : null
  } catch {
    return null
  }
}

function writePending(value) {
  try {
    fs.mkdirSync(path.dirname(pendingFile()), { recursive: true })
    fs.writeFileSync(pendingFile(), JSON.stringify(value, null, 2), 'utf8')
    return true
  } catch {
    return false
  }
}

function clearPending() {
  try {
    fs.unlinkSync(pendingFile())
  } catch {}
}

function boardFile() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'chief', 'board.json')
}

/** Active runtime reference for resolving subagent tree lineage and live status. */
let activeRuntime = null
let activeLlm = null
const subagentRootMap = new Map()
const subagentTreeCache = new Map()

/**
 * Resolve the root Session id for a member of a subagent collaboration tree.
 * Child subagents share their root ("lead") session's chief board so tasks,
 * dependencies, and evidence written by either side appear on one unified graph.
 */
function resolveRootSessionId(sessionId, agentHint) {
  const sid = String(sessionId || '').trim()
  if (!sid) return ''
  if (subagentRootMap.has(sid)) return subagentRootMap.get(sid)
  try {
    if (activeRuntime) {
      const subagents = activeRuntime.get('subagents')
      const agents = activeRuntime.get('agents')
      const agent = agentHint || (agents && typeof agents.get === 'function' ? agents.get(sid) : null)
      if (subagents && typeof subagents.rootOf === 'function' && agent) {
        const root = subagents.rootOf(agent)
        if (root && root.id) {
          const rootId = String(root.id)
          subagentRootMap.set(sid, rootId)
          return rootId
        }
      }
      if (agent && agent.parentId) {
        let cur = agent
        let guard = 0
        while (cur && cur.parentId && guard++ < 12) {
          if (subagentRootMap.has(cur.parentId)) {
            const rId = subagentRootMap.get(cur.parentId)
            subagentRootMap.set(sid, rId)
            return rId
          }
          const nextParent = agents && typeof agents.get === 'function' ? agents.get(cur.parentId) : null
          if (!nextParent) {
            subagentRootMap.set(sid, String(cur.parentId))
            return String(cur.parentId)
          }
          cur = nextParent
        }
        if (cur && cur.id) {
          subagentRootMap.set(sid, String(cur.id))
          return String(cur.id)
        }
      }
    }
  } catch {}
  return sid
}

/** Inspect caller's subagent identity ({ self, parent, rootId, isChild, sessionId }). */
function resolveAgentIdentity(runtime, sessionId, agentHint) {
  const rt = runtime || activeRuntime
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
    if (rootId) subagentRootMap.set(sid, rootId)
    if (!names) return { self: 'lead', parent: '', rootId, isChild: sid !== rootId, sessionId: sid }
    return {
      self: String(names.self || 'lead'),
      parent: names.parent ? String(names.parent) : '',
      rootId,
      isChild: Boolean(names.parent) || (names.self && names.self !== 'lead'),
      sessionId: sid,
    }
  } catch {
    const rootId = subagentRootMap.get(sid) || sid
    return { self: sid === rootId ? 'lead' : sid, parent: '', rootId, isChild: sid !== rootId, sessionId: sid }
  }
}

/** Refresh and cache the subagent tree for a root session. */
async function refreshSubagentTree(runtime, sessionId, board) {
  const rt = runtime || activeRuntime
  const rootId = resolveRootSessionId(sessionId)
  if (!rt || !rootId) return getSubagentRoster(rt, rootId, board)
  try {
    const subagents = rt.get('subagents')
    const agents = rt.get('agents')
    if (subagents && typeof subagents.listDescendants === 'function') {
      const entries = await subagents.listDescendants(rootId)
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          if (entry && entry.id) subagentRootMap.set(String(entry.id), rootId)
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
        subagentTreeCache.set(rootId, rows)
      }
    }
  } catch {}
  return getSubagentRoster(rt, rootId, board)
}

/** Synchronous roster combining cached subagent tree + live agent status + board task assignments. */
function getSubagentRoster(runtime, sessionId, board) {
  const rt = runtime || activeRuntime
  const rootId = resolveRootSessionId(sessionId)
  const agents = rt ? rt.get('agents') : null
  const cached = subagentTreeCache.get(rootId) || []
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

/** One JSON board per Session (or shared across a subagent tree rooted at lead):
 *  %DSH_HOME%/chief/boards/<sid>.json. */
function sessionBoardFile(sessionId) {
  const rootSid = resolveRootSessionId(sessionId)
  const sid = String(rootSid || '').replace(/[^\w-]/g, '')
  const dir = path.join(path.dirname(boardFile()), 'boards')
  return sid ? path.join(dir, sid + '.json') : ''
}

function boardFileFor(sessionId) {
  return sessionBoardFile(sessionId) || boardFile()
}

function emptyBoard() {
  return {
    version: BOARD_VERSION,
    updatedAt: nowMs(),
    objective: '',
    objectiveBy: '',
    objectiveAt: 0,
    // 'plan' or 'goal'. A plan is a list of steps being ticked off; a goal is
    // one persistent objective steered toward, where rewriting the step list
    // every turn hides the fact that the objective never moved. The model picks
    // it, the digest leads with it, the panel shows it. Listed here and in
    // normalizeBoard or it would be dropped on the next load.
    mode: 'plan',
    bounds: { allowed: [], forbidden: [], notes: [] },
    // autoInject ON: the digest is the point of the board. A section the model
    // only sees when someone remembers to flip a switch is a section the model
    // forgets mid-task, which is the failure this plugin exists to prevent.
    settings: { autoInject: true, guardIdle: true, guardMaxPerSession: 3, guardShortAnswer: 600 },
    // Where the work actually stands right now. A plan says what the shape of
    // the job is; the cursor says which step is open, what the very next action
    // is, and what is blocking it. Long tasks die from losing that one line, so
    // it is a first-class field and the digest leads with it.
    cursor: { at: 0, step: '', next: '', blocked: '', by: '', session: '' },
    handoff: { at: 0, by: '', session: '' },
    plan: [],
    tasks: [],
    notes: [],
    memory: [],
    sessions: {},
    log: [],
  }
}

// Leading markdown a note body may carry when it is used as its own headline:
// '- item', '## heading', '> quote', '* bullet', plus full-width spaces.
const LEADING_MARKER = /^[#>*\u3000 \t-]+/u

function str(value, fallback) {
  return typeof value === 'string' ? value : fallback
}

// Caps the action layer applies BEFORE storing text. They mirror the clamps in
// normalizeTask / normalizeNote / normalizeBoard / memory.js, and they exist as
// a second copy on purpose: the normalize pass cannot report anything (it holds
// no result), so the write path does the clipping itself and records what it
// dropped on the way out.
const CAP_TASK_TITLE = 240
const CAP_TASK_NOTE = 2000
const CAP_TASK_INTENT = 600
const CAP_TASK_EVIDENCE = 600
const CAP_ASSUMPTION = 300
const CAP_NOTE_TITLE = 200
const CAP_NOTE_BODY = 20000
const CAP_PLAN_STEP = 400
const CAP_OBJECTIVE = 2000
const CAP_CURSOR = 400
const CAP_LOG_TEXT = 400
const CAP_MEMORY_TITLE = 80
const CAP_MEMORY_TEXT = 700 // memory.js MEMORY_TEXT

/* Clip one string to cap and, when it actually lost characters, add a line to
 * the caller's clip list. Returns the clipped value so the call site reads like
 * the plain assignment it replaces. */
function clipInto(clips, field, text, cap) {
  const value = typeof text === 'string' ? text : ''
  if (value.length <= cap) return value
  if (Array.isArray(clips)) clips.push({ field, sent: value.length, kept: cap })
  return value.slice(0, cap)
}

/* Attach the clip list to a result only when something was clipped, so every
 * untouched write keeps its exact old shape. */
function clipped(result, clips) {
  if (Array.isArray(clips) && clips.length > 0) result.truncated = clips
  return result
}

/* Transport tolerance. Arguments that reach the tools as text are still the
 * same intent: "true" means true, "['a','b']" means two tags. Reading both
 * shapes here keeps a caller's mistake (a flattened list) from being stored as
 * a one-item list, or worse, dropped entirely. */
function asBool(value) {
  if (value === true || value === false) return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase()
    if (text === 'true' || text === '1' || text === 'yes' || text === 'y' || text === 'on') return true
    if (text === 'false' || text === '0' || text === 'no' || text === 'n' || text === 'off') return false
  }
  return undefined
}

/* Every count that reaches the tools as text still means the same number, so
 * "5" and 5 are the same setting. Out-of-range values are clamped by the guard
 * itself, but reading them here keeps the log line honest. */
function asCount(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return undefined
    const number = Number(text)
    if (Number.isFinite(number)) return Math.round(number)
  }
  return undefined
}

function asList(value) {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (!text) return undefined
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text)
      if (Array.isArray(parsed)) return parsed
    } catch {}
  }
  // A flattened list is still a list: split on the separators a caller would
  // have used rather than storing the whole line as one item.
  return text
    .split(/[,，\n]/u)
    .map(part => part.trim())
    .filter(part => part !== '')
}

function normalizeTags(list) {
  // Deduplicated: note.pin appends 'anchor' to a list that may already carry it
  // (a note written with tags then pinned), and a repeated tag renders as
  // "anchor/anchor" in the panel and counts twice against the tag column.
  const seen = new Set()
  return list
    .filter(tag => typeof tag === 'string' && tag.trim() !== '')
    .map(tag => tag.trim().slice(0, 40))
    .filter(tag => {
      if (seen.has(tag)) return false
      seen.add(tag)
      return true
    })
    .slice(0, 12)
}

function normalizeTask(raw) {
  const task = raw && typeof raw === 'object' ? raw : {}
  const status = STATUSES.includes(task.status) ? task.status : 'todo'
  return {
    id: str(task.id, newId('t')),
    title: str(task.title, '').slice(0, 240),
    note: str(task.note, '').slice(0, 2000),
    status,
    priority: PRIORITIES.includes(task.priority) ? task.priority : 'normal',
    owner: str(task.owner, ''),
    session: str(task.session, ''),
    subagent: str(task.subagent, '').slice(0, 120),
    preset: str(task.preset, '').slice(0, 80),
    dispatchedAt: typeof task.dispatchedAt === 'number' ? task.dispatchedAt : 0,
    intent: str(task.intent, '').slice(0, 600),
    evidence: str(task.evidence, '').slice(0, 600),
    blockedBy: Array.isArray(task.blockedBy) ? task.blockedBy.map(item => str(item, '')).filter(Boolean) : [],
    parentId: str(task.parentId, '').slice(0, 200),
    assumptions: Array.isArray(task.assumptions) ? task.assumptions.map(a => ({
      text: str(a && a.text, '').slice(0, CAP_ASSUMPTION),
      verified: a && a.verified === true,
      verifiedAt: typeof (a && a.verifiedAt) === 'number' ? a.verifiedAt : 0,
      note: str(a && a.note, '').slice(0, CAP_ASSUMPTION),
    })).filter(a => a.text) : [],
    createdAt: typeof task.createdAt === 'number' ? task.createdAt : nowMs(),
    updatedAt: typeof task.updatedAt === 'number' ? task.updatedAt : nowMs(),
  }
}

/**
 * Keep DAG dependency statuses coherent whenever tasks are added or updated:
 * - A 'todo' task whose blockedBy contains unfinished tasks becomes 'blocked'.
 * - A 'blocked' task whose blockedBy is non-empty and now ALL 'done' unlocks to 'todo'.
 */
function reconcileTaskDependencies(board, by, session) {
  if (!board || !Array.isArray(board.tasks)) return []
  const byId = new Map(board.tasks.map(t => [t.id, t]))
  const unlocked = []
  for (const task of board.tasks) {
    if (!task || task.status === 'done') continue
    const deps = (Array.isArray(task.blockedBy) ? task.blockedBy : []).filter(id => id && id !== task.id && byId.has(id))
    task.blockedBy = deps
    if (!deps.length) continue
    const allDone = deps.every(id => {
      const dep = byId.get(id)
      return dep && dep.status === 'done'
    })
    if (!allDone && task.status === 'todo') {
      task.status = 'blocked'
      task.updatedAt = nowMs()
    } else if (allDone && task.status === 'blocked') {
      task.status = 'todo'
      task.updatedAt = nowMs()
      unlocked.push(task)
    }
  }
  if (unlocked.length && typeof pushLog === 'function') {
    pushLog(
      board,
      '依赖齐备自动解锁：' + unlocked.map(t => '#' + t.id + ' ' + t.title.slice(0, 30)).join('、'),
      by || 'system',
      session || '',
    )
  }
  return unlocked
}

function normalizeNote(raw) {
  const note = raw && typeof raw === 'object' ? raw : {}
  const tags = Array.isArray(note.tags) ? note.tags : []
  return {
    id: str(note.id, newId('n')),
    title: str(note.title, '').slice(0, 200),
    body: str(note.body, '').slice(0, 20000),
    tags: normalizeTags(tags),
    by: str(note.by, ''),
    session: str(note.session, ''),
    // Kept, because pin marks pinned anchors ahead of the rest in anchorLines,
    // and the mark used to be dropped here on the way to disk — a note pinned
    // once and never re-matched by title lost its rank on the next save.
    // Omitted (not false) so ordinary notes stay out of the file unchanged.
    pinned: note.pinned === true ? true : undefined,
    readBy: Array.isArray(note.readBy) ? note.readBy.map(item => str(item, '')).filter(Boolean) : [],
    createdAt: typeof note.createdAt === 'number' ? note.createdAt : nowMs(),
    updatedAt: typeof note.updatedAt === 'number' ? note.updatedAt : nowMs(),
  }
}

const BOUND_FIELDS = ['allowed', 'forbidden', 'notes']

// Hard cap on one bounds column. Two different jobs read this number: loading
// clamps to it (an old or hand-edited board file must never be able to throw
// while being read), and every write path checks it BEFORE storing anything.
// The clamp used to be the only guard, which meant bounds.set accepted 25
// entries and stored 20 under the caller's name — and a bound list is a promise
// about what must not be done, so the five missing entries are not "lost text":
// they are restrictions the caller believes are in force and are not.
const BOUND_CAP = 20

function normalizeList(value) {
  return Array.isArray(value)
    ? value.filter(item => typeof item === 'string' && item.trim() !== '').map(item => item.trim().slice(0, 400)).slice(0, BOUND_CAP)
    : []
}

function normalizeBounds(raw) {
  const bounds = raw && typeof raw === 'object' ? raw : {}
  return {
    allowed: normalizeList(bounds.allowed),
    forbidden: normalizeList(bounds.forbidden),
    notes: normalizeList(bounds.notes),
  }
}

function dedupeNotes(list) {
  const seen = new Set()
  const out = []
  for (const note of list) {
    const key = note.title ? 'title:' + note.title : 'id:' + note.id
    if (seen.has(key)) continue
    seen.add(key)
    out.push(note)
  }
  return out
}

function normalizeSessions(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const out = {}
  for (const id of Object.keys(source).slice(0, 40)) {
    const entry = source[id] && typeof source[id] === 'object' ? source[id] : {}
    out[id] = {
      lastSeen: typeof entry.lastSeen === 'number' ? entry.lastSeen : nowMs(),
      cwd: str(entry.cwd, ''),
      turns: typeof entry.turns === 'number' ? entry.turns : 0,
    }
  }
  return out
}

/** One bounded integer setting, defaulted on read so an old board still loads. */
function guardCount(value, fallback, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

function normalizeBoard(raw) {
  const board = raw && typeof raw === 'object' ? raw : {}
  const plan = Array.isArray(board.plan) ? board.plan : []
  const tasks = Array.isArray(board.tasks) ? board.tasks : []
  const log = Array.isArray(board.log) ? board.log : []
  const notes = Array.isArray(board.notes) ? board.notes : []
  return {
    version: BOARD_VERSION,
    updatedAt: typeof board.updatedAt === 'number' ? board.updatedAt : nowMs(),
    objective: str(board.objective, ''),
    objectiveBy: str(board.objectiveBy, ''),
    objectiveAt: typeof board.objectiveAt === 'number' ? board.objectiveAt : 0,
    // Whitelisted, not free-form: an unknown mode would make every consumer
    // (digest, panel) disagree about which shape the board has.
    mode: board.mode === 'goal' ? 'goal' : 'plan',
    bounds: normalizeBounds(board.bounds),
    // Unknown settings keys are dropped on purpose; every flag the plugin reads
    // must be listed here or it silently disappears on the next load.
    settings: {
      // Defaults to ON now that the section is registered unconditionally: the
      // flag records the operator's preference, and an OLD board that stored
      // false must not read back as "off" while the digest is still injected.
      autoInject: !(board.settings && board.settings.autoInject === false),
      guardIdle: !(board.settings && board.settings.guardIdle === false),
      // Counts, not flags: the guard's two numbers live on the same board so an
      // operator can loosen them without editing the package. Clamped when read.
      guardMaxPerSession: guardCount(board.settings && board.settings.guardMaxPerSession, 3, 0, 20),
      guardShortAnswer: guardCount(board.settings && board.settings.guardShortAnswer, 600, 0, 10000),
    },
    handoff: {
      at: board.handoff && typeof board.handoff.at === 'number' ? board.handoff.at : 0,
      by: str(board.handoff && board.handoff.by, ''),
      session: str(board.handoff && board.handoff.session, ''),
    },
    cursor: {
      at: board.cursor && typeof board.cursor.at === 'number' ? board.cursor.at : 0,
      step: str(board.cursor && board.cursor.step, '').slice(0, 400),
      next: str(board.cursor && board.cursor.next, '').slice(0, 400),
      blocked: str(board.cursor && board.cursor.blocked, '').slice(0, 400),
      by: str(board.cursor && board.cursor.by, ''),
      session: str(board.cursor && board.cursor.session, ''),
    },
    plan: plan
      .map(step => ({
        id: str(step && step.id, newId('s')),
        text: str(step && step.text, '').slice(0, 400),
        done: step && step.done === true,
      }))
      .filter(step => step.text !== ''),
    tasks: tasks.map(normalizeTask).filter(task => task.title !== ''),
    notes: dedupeNotes(notes.map(normalizeNote).filter(note => note.title !== '' || note.body !== '')),
    // Rolling conversation memory. Not in the notes list on purpose: notes are
    // hand-written and the human owns them, memory is written by the host as
    // turns close and only the panel and the digest read it.
    memory: normalizeMemory(board.memory),
    sessions: normalizeSessions(board.sessions),
    log: log.slice(-LOG_CAP).map(entry => ({
      at: typeof entry.at === 'number' ? entry.at : nowMs(),
      by: str(entry.by, ''),
      session: str(entry.session, ''),
      text: str(entry.text, '').slice(0, 400),
    })),
  }
}

/* ------------------------------------------------------------------ storage */

/* Per-file caches keyed by path — one board per Session, one shared board for
 * the global anchor/settings. */
const caches = new Map()

function loadBoard(file) {
  file = file || boardFile()
  const entry = caches.get(file) || { mtime: -1, board: null }
  try {
    const stat = fs.statSync(file)
    if (entry.board && entry.mtime === stat.mtimeMs) return entry.board
    const board = normalizeBoard(JSON.parse(fs.readFileSync(file, 'utf8')))
    caches.set(file, { mtime: stat.mtimeMs, board })
    return board
  } catch {
    return entry.board && entry.mtime === -1 ? entry.board : emptyBoard()
  }
}

function saveBoard(board, file) {
  file = file || boardFile()
  board.version = BOARD_VERSION
  board.updatedAt = nowMs()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.' + process.pid + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(board, null, 2), 'utf8')
  fs.renameSync(tmp, file)
  let mtime = -1
  try {
    mtime = fs.statSync(file).mtimeMs
  } catch {}
  caches.set(file, { mtime, board })
  return board
}

function pushLog(board, text, by, session) {
  board.log.push({ at: nowMs(), by: str(by, ''), session: str(session, ''), text: str(text, '') })
  if (board.log.length > LOG_CAP) board.log = board.log.slice(-LOG_CAP)
}

/** One log line per intervention, naming the shape the guard caught. */
function guardLogText(verdict, turn, remaining) {
  const tail = '，已催一步（本会话还剩 ' + remaining + ' 次）'
  if (verdict && verdict.kind === 'loop') {
    const loop = verdict.loop || {}
    return '空转拦截：第 ' + turn + ' 轮同一个调用连着做了 ' + (loop.count || 0) + ' 次（'
      + String(loop.name || '?').slice(0, 40) + '）结果没变' + tail
  }
  if (verdict && verdict.kind === 'no-goal') {
    return '空转拦截：第 ' + turn + ' 轮板子处在 goal 模式却没有目标' + tail
  }
  if (verdict && verdict.kind === 'no-plan') {
    return '空转拦截：第 ' + turn + ' 轮动手了但参谋看板上没有规划' + tail
  }
  if (verdict && verdict.kind === 'stale-plan') {
    return '空转拦截：第 ' + turn + ' 轮做了事但规划没动（还有 '
      + (verdict.work ? verdict.work.total : 0) + ' 项未完成）' + tail
  }
  return '空转拦截：第 ' + turn + ' 轮没有工具调用、回答 '
    + (verdict && verdict.answer ? verdict.answer.chars : 0) + ' 字就收工' + tail
}

/* ----------------------------------------------------------------- write lock */

/* Every mutation is a read-modify-write of one JSON file. `rename` makes the
 * write itself atomic, but nothing stops two writers from reading the same
 * board, each appending their own entry, and the second rename silently
 * discarding the first one's task, note or memory line. A turn-stopping
 * listener and a browser route land in the same Session board often enough to
 * lose data that way, so the whole read-modify-write runs under
 * `<file>.lock`, created with O_EXCL (works across processes and across the
 * host/browser halves). */
const LOCK_WAIT_MS = 3000
const LOCK_STALE_MS = 10000
const heldLocks = new Set()
const lockSleeper = new Int32Array(new SharedArrayBuffer(4))

function sleepSync(ms) {
  try {
    Atomics.wait(lockSleeper, 0, 0, ms)
  } catch {}
}

/** Take the board lock. Returns a release function; always call it in a finally.
 *  Nested calls on the same path return a no-op release instead of deadlocking:
 *  every holder here is synchronous, so "already held" can only mean "held by
 *  my own call stack". */
function acquireBoardLock(file) {
  file = file || boardFile()
  if (heldLocks.has(file)) return () => {}
  const lock = file + '.lock'
  try {
    fs.mkdirSync(path.dirname(lock), { recursive: true })
  } catch {}
  const deadline = Date.now() + LOCK_WAIT_MS
  for (;;) {
    try {
      const fd = fs.openSync(lock, 'wx')
      try {
        fs.writeSync(fd, String(process.pid))
      } catch {}
      fs.closeSync(fd)
      heldLocks.add(file)
      return () => {
        heldLocks.delete(file)
        try {
          fs.unlinkSync(lock)
        } catch {}
      }
    } catch (error) {
      if (!error || error.code !== 'EEXIST') {
        // Best effort: an unwritable lock path must not fail every board write.
        // The rename alone is still atomic, so the only loss is serialisation.
        heldLocks.add(file)
        return () => heldLocks.delete(file)
      }
      if (Date.now() >= deadline) {
        // A wedged holder must not freeze the board for the rest of the
        // session: break it once and continue without the lock.
        try {
          fs.unlinkSync(lock)
        } catch {}
        heldLocks.add(file)
        return () => heldLocks.delete(file)
      }
      try {
        const stat = fs.statSync(lock)
        if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
          fs.unlinkSync(lock)
          continue
        }
      } catch {}
      sleepSync(3)
    }
  }
}

/** Run one read-modify-write under the lock, with a cache-invalidated read so
 *  the board it mutates is the one currently on disk. */
function withBoardLock(file, run) {
  const target = file || boardFile()
  const release = acquireBoardLock(target)
  caches.delete(target)
  try {
    return run()
  } finally {
    release()
  }
}

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

  // Cold-storage Engineering Archives: strictly on-demand lookup/save, never auto-loaded.
  if (action === 'archive.search') {
    const q = str(args.query !== undefined ? args.query : (args.question !== undefined ? args.question : args.text), '')
    const folder = str(args.folder, '')
    const res = searchArchives(q, { folder, limit: 10 }, boardFile())
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
    const res = getArchiveDetail(target, rootSid, boardFile())
    if (!res.ok) return { ok: false, error: res.error }
    return {
      ok: true,
      archiveItem: res.item,
      board: session ? loadBoard(file) : emptyBoard(),
    }
  }

  if (action === 'archive.save') {
    const rootSid = resolveRootSessionId(session) || session
    const res = mutateArchive({
      op: 'save',
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
    }, boardFile())
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
      board.objective = clipInto(clips, 'objective', args.objective.trim(), CAP_OBJECTIVE)
      board.objectiveBy = session
      board.objectiveAt = nowMs()
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
    // Logged even when unchanged is pointless, but logged when flipped is the
    // only record of *why* the digest suddenly reads differently.
    if (before !== mode) {
      pushLog(
        board,
        '模式改为：' + mode + (mode === 'goal' ? '（这活按持续目标推进，不用步骤列表代替）' : '（回到步骤推进）'),
        by,
        session,
      )
    }
    return { ok: true, mode, board: saveBoard(board, file) }
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
    const objective = str(args.objective, '').trim()
    if (!objective) return { ok: false, error: 'objective required' }
    const clips = []
    board.objective = clipInto(clips, 'objective', objective, CAP_OBJECTIVE)
    board.objectiveBy = session
    board.objectiveAt = nowMs()
    pushLog(board, '目标改为：' + objective.slice(0, 60), by, session)
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
    if (BOUND_FIELDS.indexOf(str(args.field, '')) >= 0 && items) {
      if (overCap(items)) return { ok: false, error: tooLongNote(items.length) }
      current[str(args.field, '')] = normalizeList(items)
      board.bounds = current
      pushLog(board, '更新边界（允许 ' + current.allowed.length + ' / 禁止 ' + current.forbidden.length + ' / 注意 ' + current.notes.length + '）', by, session)
      return { ok: true, bounds: current, board: saveBoard(board, file) }
    }
    // The whole-table form checks every list it was handed before touching
    // any of them: a refusal must leave the two valid columns alone as well,
    // otherwise the error message and the board disagree about what happened.
    const given = { allowed: asList(args.allowed), forbidden: asList(args.forbidden), notes: asList(args.notes) }
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
    pushLog(board, '更新边界（允许 ' + current.allowed.length + ' / 禁止 ' + current.forbidden.length + ' / 注意 ' + current.notes.length + '）', by, session)
    return { ok: true, bounds: current, board: saveBoard(board, file) }
  }

  if (action === 'bounds.add' || action === 'bounds.pin' || action === 'bounds.remove' || action === 'bounds.edit' || action === 'bounds.consolidate') {
    const col = str(args.field, '').trim()
    if (!BOUND_FIELDS.includes(col)) {
      return { ok: false, error: 'bounds operation requires field: allowed | forbidden | notes' }
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
    board.handoff = { at: nowMs(), by, session }
    pushLog(board, '生成并交接给参谋看板：交接单已更新', by, session)
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

/* ------------------------------------------------------------------ boundaries */

function safe(read, fallback) {
  try {
    const value = read()
    return value === undefined ? fallback : value
  } catch {
    return fallback
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

/* ---------------------------------------------------------------------- routes */

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > BODY_LIMIT) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (!text) return resolve({})
      try {
        resolve(JSON.parse(text))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

/**
 * The board a Session gets to READ: its own, plus the limited things that are
 * deliberately machine-wide. Writes never go through here — they always hit the
 * raw per-session file, so this view can never leak one conversation's work
 * into another one.
 *
 * What crosses the boundary, and why:
 *   - notes: all of them, anchors first. A lesson pinned in one conversation is
 *     exactly the thing that must survive into the next one, and title-dedupe
 *     keeps the session's own copy when it has one. Every other note on the
 *     shared board crosses too, because a write nobody can read back is
 *     write-only storage: demoting an anchor past the cap used to erase its
 *     lesson from every panel, which is the opposite of what the cap promises.
 *     Each inherited note carries shared:true, so the panel can send its edit
 *     and its delete to the board the note actually lives on instead of the
 *     session board, where the host would answer "no such note".
 *   - bounds: always, and only, the shared list. Bounds are standing
 *     instructions from the operator ("don't commit", "install_bundle dies with
 *     EPERM"); a fresh conversation that cannot see them starts by breaking
 *     them. The panel edits that one shared list, so a session's seeded copy is
 *     a snapshot, not a decision: handing it back would shadow every later edit.
 *     A stale operator instruction is worse than a missing one.
 *   - objective: only while the session has none of its own, same reasoning —
 *     a new conversation should know what the machine is working on, but as
 *     soon as it states its own goal the shared one is gone.
 *   - settings: never inherited here; autoInject/guardIdle are machine flags
 *     read straight off the shared board at their point of use.
 */
function boardForSession(file) {
  const board = loadBoard(file)
  try {
    if (file === boardFile()) {
      const pinnedOnly = normalizeBounds(board.bounds)
      return {
        ...board,
        bounds: pinnedOnly,
        pinnedBounds: pinnedOnly,
        localBounds: { allowed: [], forbidden: [], notes: [] },
        inherited: { anchors: 0, notes: 0, bounds: false, objective: false },
      }
    }
    const shared = loadBoard()
    const out = { ...board }
    const inherited = { anchors: 0, notes: 0, bounds: false, objective: false }

    const sharedNotes = shared.notes || []
    const anchors = sharedNotes.filter(note => (note.tags || []).includes('anchor'))
    const others = sharedNotes.filter(note => !(note.tags || []).includes('anchor'))
    // Anchors first, then the rest: the front of the list is what a reader
    // reaches first, and an anchor outranks a working note for that slot.
    const carry = anchors.concat(others)
    if (carry.length) {
      const seen = new Set((board.notes || []).map(note => note.title))
      const extra = carry.filter(note => !seen.has(note.title))
      if (extra.length) {
        out.notes = (board.notes || []).concat(extra.map(note => ({ ...note, session: note.session || '', shared: true })))
        inherited.anchors = extra.filter(note => (note.tags || []).includes('anchor')).length
        inherited.notes = extra.length
      }
    }

    // Two-tier boundaries:
    //   1) Pinned Global Shared (`shared.bounds`) — stamped with 📌, inherited across ALL tasks/conversations.
    //   2) Task-Local (`board.bounds`) — applies ONLY to this root session & its subagent tree.
    const pinnedBounds = normalizeBounds(shared.bounds)
    const rawLocal = normalizeBounds(board.bounds)
    const localBounds = { allowed: [], forbidden: [], notes: [] }
    const mergedBounds = { allowed: [], forbidden: [], notes: [] }
    for (const col of BOUND_FIELDS) {
      const pinList = pinnedBounds[col] || []
      const pinSet = new Set(pinList)
      const localOnly = (rawLocal[col] || []).filter(item => !pinSet.has(item))
      localBounds[col] = localOnly
      mergedBounds[col] = pinList.concat(localOnly).slice(0, BOUND_CAP)
    }
    out.bounds = mergedBounds
    out.pinnedBounds = pinnedBounds
    out.localBounds = localBounds
    inherited.bounds = Boolean(
      pinnedBounds.allowed.length || pinnedBounds.forbidden.length || pinnedBounds.notes.length,
    )

    // "never wrote one" is not the same state as "wrote an empty one". The panel
    // paints the borrowed objective into the very textarea a Session edits, so
    // erasing it and pressing 保存目标 used to write objective:'' — and the next
    // read handed the shared text straight back, leaving the box disobedient with
    // no visible reason. objectiveAt is the record of "this Session stated an
    // objective, even if the statement was 'none'": plan.set/objective.set stamp
    // it, inheritance never does.
    const statedOwn = typeof board.objectiveAt === 'number' && board.objectiveAt > 0
    if (!str(board.objective, '') && !statedOwn) {
      if (str(shared.objective, '')) {
        out.objective = shared.objective
        out.objectiveBy = shared.objectiveBy || ''
        out.objectiveAt = shared.objectiveAt || 0
        inherited.objective = true
      }
    }

    out.inherited = inherited
    return out
  } catch {
    return board
  }
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

function makeChiefDeps(runtime) {
  const rt = runtime || activeRuntime
  return {
    runtime: rt,
    getLlm: () => activeLlm || (rt ? rt.get('llm') : null),
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
  }
}

/** Find a live calling or root agent handle for subagent operations. */
function findLiveCallerAgent(runtime, sessionId, callerAgent) {
  if (callerAgent && callerAgent.id) return callerAgent
  const rt = runtime || activeRuntime
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
  const rt = runtime || activeRuntime
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
        subagentRootMap.set(childSessionId, rootId)
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
        if (childSessionId) subagentRootMap.set(childSessionId, rootId)
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

function routeTable(runtime) {
  const guard = (req, res) => {
    const connection = runtime.get('connection')
    if (connection && typeof connection.requestRejection === 'function') {
      try {
        const rejection = connection.requestRejection({ headers: req.headers })
        if (rejection) {
          sendJson(res, rejection, { ok: false, error: rejection === 401 ? 'unauthorized' : 'forbidden' })
          return false
        }
      } catch {}
    }
    return true
  }

  return [
    {
      path: API + '/snapshot',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          let sessionId = ''
          try {
            sessionId = new URL(req.url || '/', 'http://127.0.0.1').searchParams.get('session') || ''
          } catch {}
          const board = sessionId ? boardForSession(boardFileFor(sessionId)) : emptyBoard()
          const subagents = sessionId ? await refreshSubagentTree(runtime, sessionId, board) : []
          const agentIdentity = sessionId ? resolveAgentIdentity(runtime, sessionId) : null
          const secState = loadChiefState()
          const rootSid = resolveRootSessionId(sessionId) || sessionId || 'global'
          const cluster = getLinkedCluster(secState, rootSid)
          let pendingSuggestions = 0
          let factsCount = 0
          let mailboxCount = 0
          for (const cid of cluster) {
            const ws = secState.workspaces && secState.workspaces[cid]
            if (!ws) continue
            if (Array.isArray(ws.suggestions)) pendingSuggestions += ws.suggestions.filter(s => s.status === 'pending').length
            if (Array.isArray(ws.facts)) factsCount += ws.facts.length
            if (Array.isArray(ws.mailbox)) mailboxCount += ws.mailbox.length
          }
          let followModelRef = ''
          try {
            const agentsSvc = runtime && runtime.get('agents')
            const ag = agentsSvc && typeof agentsSvc.get === 'function' ? (agentsSvc.get(sessionId) || agentsSvc.get(rootSid)) : null
            const hdr = ag && ag.session && typeof ag.session.requestHeader === 'function'
              ? ag.session.requestHeader()
              : (ag && ag.session && ag.session.header ? ag.session.header : null)
            const hcfg = hdr && hdr.config ? hdr.config : hdr
            if (hcfg && hcfg.provider && hcfg.model && !String(hcfg.provider).startsWith('local-agent')) {
              followModelRef = `${hcfg.provider}/${hcfg.model}`
            } else {
              const defSel = runtime && runtime.get('agentDefaultModel')?.currentSelection?.()
              if (defSel && defSel.provider && defSel.model && !String(defSel.provider).startsWith('local-agent')) {
                followModelRef = `${defSel.provider}/${defSel.model}`
              }
            }
          } catch {}
          let pinnedModelRef = (secState.config && secState.config.modelRef) || ''
          if (pinnedModelRef) {
            try {
              const llmSvc = runtime && runtime.get('llm')
              if (llmSvc && typeof llmSvc.listProviders === 'function') {
                const provs = new Set((llmSvc.listProviders() || []).map(p => p && p.id).filter(Boolean))
                const pName = pinnedModelRef.split('/')[0]
                if (provs.size > 0 && !provs.has(pName)) pinnedModelRef = ''
              }
            } catch {}
          }
          sendJson(res, 200, {
            ok: true,
            board,
            subagents,
            agentIdentity,
            teamTasks: sessionId ? fetchTeamTasks(runtime, { id: sessionId }) : undefined,
            boundaries: boundaries(runtime, sessionId),
            chiefMeta: {
              paceMode: (secState.config && secState.config.paceMode) || 'manual',
              autoPilot: Boolean(secState.config && secState.config.autoPilot),
              modelRef: pinnedModelRef,
              followModelRef,
              resolvedModelRef: pinnedModelRef || followModelRef || '',
              pendingSuggestions,
              factsCount,
              mailboxCount,
              linkedPeersCount: Math.max(0, cluster.length - 1),
            },
            archiveMeta: getArchiveMeta(rootSid, boardFile()),
          })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error && error.message ? error.message : error) })
        }
      },
    },
    {
      path: API + '/digest',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          let sessionId = ''
          try {
            sessionId = new URL(req.url || '/', 'http://127.0.0.1').searchParams.get('session') || ''
          } catch {}
          const board = sessionId ? loadBoard(boardFileFor(sessionId)) : emptyBoard()
          const fullBoard = sessionId ? boardForSession(boardFileFor(sessionId)) : board
          const subagents = sessionId ? await refreshSubagentTree(runtime, sessionId, fullBoard) : []
          const agentIdentity = sessionId ? resolveAgentIdentity(runtime, sessionId) : null
          const rootSid = resolveRootSessionId(sessionId) || sessionId
          sendJson(res, 200, {
            ok: true,
            digest: renderDigest(fullBoard, {
              subagents,
              agentIdentity,
              teamTasks: sessionId ? fetchTeamTasks(runtime, { id: sessionId }) : undefined,
              takenOutArchives: rootSid ? getTakenOutArchivesForSession(rootSid, boardFile()) : [],
            }),
            sessions: board.sessions || {},
            updatedAt: board.updatedAt,
          })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error && error.message ? error.message : error) })
        }
      },
    },
    {
      path: API + '/memory',
      handler: (req, res) => {
        if (!guard(req, res)) return
        let sessionId = ''
        try {
          sessionId = new URL(req.url || '/', 'http://127.0.0.1').searchParams.get('session') || ''
        } catch {}
        const board = sessionId ? loadBoard(boardFileFor(sessionId)) : emptyBoard()
        sendJson(res, 200, {
          ok: true,
          sections: memorySections(board, 8),
          count: (board.memory || []).length,
          digest: renderMemoryDigest(board, 400),
          settings: board.settings || {},
          updatedAt: board.updatedAt,
        })
      },
    },
    {
      path: API + '/transfer',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          const body = await readBody(req)
          const result = await transferChief(runtime, body, typeof body.session === 'string' ? body.session : '')
          sendJson(res, result.ok ? 200 : 400, result)
        } catch (error) {
          sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) })
        }
      },
    },
    {
      path: API + '/sessions',
      handler: (req, res) => {
        if (!guard(req, res)) return
        let sessionId = ''
        try {
          sessionId = new URL(req.url || '/', 'http://127.0.0.1').searchParams.get('session') || ''
        } catch {}
        const agents = runtime.get('agents')
        const own = loadBoard(boardFileFor(sessionId))
        const shared = loadBoard()
        const fresher = (a, b) => ((a && a.lastSeen) || 0) >= ((b && b.lastSeen) || 0) ? a : b
        const heartbeat = id => {
          const a = (own.sessions || {})[id]
          const b = (shared.sessions || {})[id]
          return fresher(a, b) || {}
        }
        const settings = shared.settings || {}
        const list = agents && typeof agents.list === 'function' ? agents.list() : []
        const archived = safe(() => runtime.get('workspaceRegistry').archivedSessionIds, [])
        const retired = Array.isArray(archived) ? archived : []
        const live = list.filter(agent => {
          const id = String(agent.id)
          return id === sessionId || !retired.includes(id)
        })
        const touched = transcriptTimes()
        sendJson(res, 200, {
          ok: true,
          sessions: live.map(agent => {
            const id = String(agent.id)
            const row = heartbeat(id)
            const seen = row.lastSeen || touched.get(id) || 0
            return {
              id,
              name: sessionName(runtime, agent),
              turns: row.turns || 0,
              lastSeen: seen,
            }
          }),
          archived: retired.length,
          pending: readPending() ? { at: readPending().at, by: readPending().by } : null,
          autoInject: !(settings.autoInject === false),
          guardIdle: !(settings.guardIdle === false),
          guardMaxPerSession: guardCount(settings.guardMaxPerSession, 3, 0, 20),
          guardShortAnswer: guardCount(settings.guardShortAnswer, 600, 0, 10000),
        })
      },
    },
    {
      path: API + '/handoff',
      handler: (req, res) => {
        if (!guard(req, res)) return
        let sessionId = ''
        try {
          sessionId = new URL(req.url || '/', 'http://127.0.0.1').searchParams.get('session') || ''
        } catch {}
        const board = sessionId ? boardForSession(boardFileFor(sessionId)) : emptyBoard()
        const pending = readPending()
        const rootSid = resolveRootSessionId(sessionId) || sessionId
        sendJson(res, 200, {
          ok: true,
          text: renderHandoff(board, boundaries(runtime, sessionId), 5200, sessionId, {
            teamTasks: fetchTeamTasks(runtime, sessionId ? { id: sessionId } : null),
            takenOutArchives: rootSid ? getTakenOutArchivesForSession(rootSid, boardFile()) : [],
          }),
          handoffAt: board.handoff ? board.handoff.at : 0,
          autoInject: !((board.settings || {}).autoInject === false),
          guardIdle: !((board.settings || {}).guardIdle === false),
          pending: pending ? { at: pending.at, by: pending.by, failedTarget: pending.failedTarget || '' } : null,
        })
      },
    },
    {
      path: API + '/action',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          const body = await readBody(req)
          const sessionId = body && typeof body.session === 'string' ? body.session : ''
          const actName = body && typeof body.action === 'string' ? body.action : ''
          if (actName === 'bounds.propose') {
            const propRes = proposeBoundToChief(makeChiefDeps(runtime), {
              sessionId,
              by: typeof body.by === 'string' ? body.by : 'operator',
              field: typeof body.field === 'string' ? body.field : 'forbidden',
              item: typeof body.item === 'string' ? body.item : (typeof body.text === 'string' ? body.text : ''),
              items: Array.isArray(body.items) ? body.items : undefined,
              reason: typeof body.reason === 'string' ? body.reason : '',
            })
            const board = sessionId ? boardForSession(boardFileFor(sessionId)) : emptyBoard()
            const subagents = sessionId ? await refreshSubagentTree(runtime, sessionId, board) : []
            sendJson(res, propRes.ok ? 200 : 400, {
              ...propRes,
              board,
              subagents,
              boundaries: boundaries(runtime, sessionId),
            })
            return
          }
          if (actName === 'task.dispatch' || actName === 'team.steer' || actName === 'team.interrupt') {
            const subResult = await executeSubagentAction(runtime, body, null)
            sendJson(res, subResult.ok ? 200 : 400, {
              ...subResult,
              boundaries: boundaries(runtime, sessionId),
            })
            return
          }
          const result = runAction(body)
          const mergedBoard = result.ok && result.board && sessionId
            ? boardForSession(boardFileFor(sessionId))
            : result.board
          const subagents = sessionId && mergedBoard ? await refreshSubagentTree(runtime, sessionId, mergedBoard) : []
          sendJson(res, result.ok ? 200 : 400, {
            ...result,
            ...(mergedBoard ? { board: mergedBoard } : {}),
            subagents,
            boundaries: boundaries(runtime, sessionId),
          })
        } catch (error) {
          sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) })
        }
      },
    },
    {
      path: API + '/chief/view',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          const url = new URL(req.url || '/', 'http://127.0.0.1')
          let sessionId = url.searchParams.get('session') || ''
          let regenerate = url.searchParams.get('regenerate') === '1'
          if (req.method === 'POST') {
            const body = await readBody(req).catch(() => ({}))
            if (typeof body.session === 'string' && body.session) sessionId = body.session
            if (body.regenerate === true) regenerate = true
          }
          const view = await getChiefView(makeChiefDeps(runtime), sessionId, { regenerate, autoSummarize: !regenerate })
          sendJson(res, 200, view)
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error && error.message ? error.message : error) })
        }
      },
    },
    {
      path: API + '/chief/ask',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          const body = await readBody(req)
          const sessionId = typeof body.session === 'string' ? body.session : ''
          const out = await askOrCommandChief(makeChiefDeps(runtime), {
            sessionId,
            text: typeof body.text === 'string' ? body.text : '',
            forcedTarget: typeof body.target === 'string' ? body.target : '',
            forcedMode: typeof body.mode === 'string' ? body.mode : 'steer',
          })
          const board = out.ok && sessionId ? boardForSession(boardFileFor(sessionId)) : undefined
          sendJson(res, out.ok ? 200 : 400, board ? { ...out, board } : out)
        } catch (error) {
          sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) })
        }
      },
    },
    {
      path: API + '/chief/relay',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          const body = await readBody(req)
          const sessionId = typeof body.session === 'string' ? body.session : ''
          const out = await deliverCrossMessage(makeChiefDeps(runtime), {
            fromSession: sessionId,
            fromLabel: typeof body.by === 'string' && body.by ? body.by : 'DSH 参谋长',
            target: typeof body.target === 'string' ? body.target : 'lead',
            subject: typeof body.subject === 'string' ? body.subject : '',
            text: typeof body.text === 'string' ? body.text : '',
            mode: typeof body.mode === 'string' ? body.mode : 'steer',
          })
          const view = await getChiefView(makeChiefDeps(runtime), sessionId, { autoSummarize: false })
          sendJson(res, out.ok ? 200 : 400, { ...out, view })
        } catch (error) {
          sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) })
        }
      },
    },
    {
      path: API + '/chief/models',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          const url = new URL(req.url || '/', 'http://127.0.0.1')
          const fresh = url.searchParams.get('fresh') === '1'
          const sessionId = url.searchParams.get('session') || ''
          const catalog = await listChiefModels(makeChiefDeps(runtime), fresh, sessionId)
          sendJson(res, 200, { ok: true, ...catalog })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error && error.message ? error.message : error) })
        }
      },
    },
    {
      path: API + '/chief/config',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          const body = await readBody(req)
          const updated = updateChiefConfig(body || {})
          const sessionId = typeof body.session === 'string' ? body.session : ''
          const view = await getChiefView(makeChiefDeps(runtime), sessionId, { autoSummarize: false })
          sendJson(res, 200, { ...updated, view })
        } catch (error) {
          sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) })
        }
      },
    },
    {
      path: API + '/chief/link',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          const body = await readBody(req)
          const sessionId = typeof body.session === 'string' ? body.session : ''
          const peerSession = typeof body.peerSession === 'string' ? body.peerSession : ''
          const rootA = resolveRootSessionId(sessionId) || sessionId
          const rootB = resolveRootSessionId(peerSession) || peerSession
          const linked = Boolean(body.linked)
          const out = setPeerLink(rootA, rootB, linked)
          if (!out.ok) {
            sendJson(res, 400, out)
            return
          }
          const view = await getChiefView(makeChiefDeps(runtime), rootA, { autoSummarize: false })
          sendJson(res, 200, { ...out, view })
        } catch (error) {
          sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) })
        }
      },
    },
    {
      path: API + '/chief/suggestion',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          const body = await readBody(req)
          const sessionId = typeof body.session === 'string' ? body.session : ''
          const out = await handleSuggestionDecision(makeChiefDeps(runtime), {
            sessionId,
            suggestionId: typeof body.id === 'string' ? body.id : '',
            decision: body.decision === 'approve' ? 'approve' : 'dismiss',
            editedText: typeof body.text === 'string' ? body.text : '',
            boundField: typeof body.boundField === 'string' ? body.boundField : '',
            pinGlobal: typeof body.pinGlobal === 'boolean' ? body.pinGlobal : undefined,
          })
          const board = out.ok && sessionId ? boardForSession(boardFileFor(sessionId)) : undefined
          sendJson(res, out.ok ? 200 : 400, board ? { ...out, board } : out)
        } catch (error) {
          sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) })
        }
      },
    },
    {
      path: API + '/chief/consolidate-bounds',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          const body = await readBody(req)
          const sessionId = typeof body.session === 'string' ? body.session : ''
          const out = await consolidateBoundsWithChief(makeChiefDeps(runtime), {
            sessionId,
            field: typeof body.field === 'string' ? body.field : '',
            items: Array.isArray(body.items) ? body.items : [],
            instruction: typeof body.instruction === 'string' ? body.instruction : '',
          })
          const board = sessionId ? boardForSession(boardFileFor(sessionId)) : undefined
          sendJson(res, out.ok ? 200 : 400, board ? { ...out, board } : out)
        } catch (error) {
          sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) })
        }
      },
    },
    {
      path: API + '/chief/fact',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          const body = await readBody(req)
          const sessionId = typeof body.session === 'string' ? body.session : ''
          const out = mutateChiefFact(makeChiefDeps(runtime), {
            sessionId,
            op: typeof body.op === 'string' ? body.op : 'add',
            id: typeof body.id === 'string' ? body.id : '',
            text: typeof body.text === 'string' ? body.text : '',
            category: typeof body.category === 'string' ? body.category : 'discipline',
            pinned: Boolean(body.pinned),
          })
          if (!out.ok) {
            sendJson(res, 400, out)
            return
          }
          const view = await getChiefView(makeChiefDeps(runtime), sessionId, { autoSummarize: false })
          sendJson(res, 200, { ...out, view })
        } catch (error) {
          sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) })
        }
      },
    },
    {
      path: API + '/archives',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          const url = new URL(req.url || '/', 'http://127.0.0.1')
          if (req.method === 'GET' || !req.method) {
            const sessionId = url.searchParams.get('session') || ''
            const rootSid = resolveRootSessionId(sessionId) || sessionId
            const query = url.searchParams.get('q') || ''
            const folder = url.searchParams.get('folder') || ''
            const paperclip = url.searchParams.get('paperclip') || ''
            const out = listArchiveHeaders(rootSid, { query, folder, paperclip }, boardFile())
            sendJson(res, 200, {
              ...out,
              archiveMeta: getArchiveMeta(rootSid, boardFile()),
            })
            return
          }

          const body = await readBody(req)
          const sessionId = typeof body.session === 'string' ? body.session : ''
          const rootSid = resolveRootSessionId(sessionId) || sessionId
          const op = typeof body.op === 'string' ? body.op : 'save'

          if (op === 'precipitateNotes') {
            // Sweep active board.notes (session and/or shared) into cold-stored archives.json
            const noteIds = Array.isArray(body.noteIds) ? new Set(body.noteIds.map(String)) : null
            let sweptCount = 0
            const sweepFromFile = (targetFile) => {
              if (!targetFile || !fs.existsSync(targetFile)) return
              withBoardLock(targetFile, () => {
                const b = loadBoard(targetFile)
                if (!Array.isArray(b.notes) || !b.notes.length) return
                const keep = []
                for (const note of b.notes) {
                  if (noteIds && !noteIds.has(note.id)) {
                    keep.push(note)
                    continue
                  }
                  const saved = mutateArchive({
                    op: 'save',
                    sourceNoteId: note.id,
                    title: note.title,
                    body: note.body,
                    tags: note.tags,
                    paperclip: (note.pinned || (note.tags || []).includes('anchor')) ? 'gold' : undefined,
                    by: note.by || 'user',
                    rootSessionId: rootSid,
                  }, boardFile())
                  if (saved.ok) sweptCount += 1
                  else keep.push(note)
                }
                if (keep.length !== b.notes.length) {
                  b.notes = keep
                  pushLog(b, `🗄️ 已将 ${sweptCount} 篇便签沉淀封存入「档案」柜`, 'operator', sessionId)
                  saveBoard(b, targetFile)
                }
              })
            }
            if (sessionId) sweepFromFile(boardFileFor(sessionId))
            sweepFromFile(boardFile())
            const board = sessionId ? boardForSession(boardFileFor(sessionId)) : emptyBoard()
            const archives = listArchiveHeaders(rootSid, {}, boardFile())
            sendJson(res, 200, {
              ok: true,
              sweptCount,
              board,
              archives,
              archiveMeta: getArchiveMeta(rootSid, boardFile()),
            })
            return
          }

          const out = mutateArchive({
            ...body,
            op,
            rootSessionId: rootSid,
          }, boardFile())
          if (!out.ok) {
            sendJson(res, 400, out)
            return
          }
          const archives = listArchiveHeaders(rootSid, {}, boardFile())
          sendJson(res, 200, {
            ...out,
            archives,
            archiveMeta: getArchiveMeta(rootSid, boardFile()),
          })
        } catch (error) {
          sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) })
        }
      },
    },
    {
      path: API + '/archives/detail',
      handler: (req, res) => {
        if (!guard(req, res)) return
        try {
          const url = new URL(req.url || '/', 'http://127.0.0.1')
          const id = url.searchParams.get('id') || ''
          const sessionId = url.searchParams.get('session') || ''
          const rootSid = resolveRootSessionId(sessionId) || sessionId
          const out = getArchiveDetail(id, rootSid, boardFile())
          sendJson(res, out.ok ? 200 : 404, out)
        } catch (error) {
          sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) })
        }
      },
    },
    {
      path: API + '/archives/organize',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        try {
          const body = await readBody(req)
          const sessionId = typeof body.session === 'string' ? body.session : ''
          const rootSid = resolveRootSessionId(sessionId) || sessionId
          const out = await organizeArchivesWithChief(makeChiefDeps(runtime), {
            sessionId: rootSid,
            ids: Array.isArray(body.ids) ? body.ids : [],
            folder: typeof body.folder === 'string' ? body.folder : '',
            scope: typeof body.scope === 'string' ? body.scope : 'unorganized',
            instruction: typeof body.instruction === 'string' ? body.instruction : '',
          })
          sendJson(res, out.ok ? 200 : 400, {
            ...out,
            archiveMeta: getArchiveMeta(rootSid, boardFile()),
          })
        } catch (error) {
          sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) })
        }
      },
    },
  ]
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
    if (wantGoalMode) board.mode = 'goal'
    pushLog(board, '长期目标(/goal)改为：' + objective.slice(0, 60) + (previous && previous !== objective ? '（原：' + previous.slice(0, 40) + '）' : ''), 'agent', sessionId)
    saveBoard(board, file)
  })
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

/* ----------------------------------------------------------------------- tools */

const BOARD_PARAMETERS = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: [
        'snapshot',
        'graph.plan',
        'task.batch',
        'task.add',
        'task.update',
        'task.claim',
        'task.release',
        'task.remove',
        'task.verify',
        'task.dispatch',
        'team.steer',
        'team.interrupt',
        'team.list',
        'mail.send',
        'mail.inbox',
        'plan.set',
        'objective.set',
        'mode.set',
        'bounds.propose',
        'bounds.add',
        'bounds.pin',
        'bounds.remove',
        'bounds.edit',
        'bounds.consolidate',
        'bounds.set',
        'settings.set',
        'handoff.mark',
        'cursor.set',
        'log.add',
        'note.add',
        'note.write',
        'note.pin',
        'note.unpin',
        'note.remove',
        'note.read',
        'archive.search',
        'archive.read',
        'archive.save',
        'memory.add',
        'memory.remove',
        'memory.ask',
      ],
      description:
        'Board operation (MUST be called whenever recording tasks/status/conclusions or relaying messages; plain text alone does NOT update the board or notify peers). '
        + 'Use "graph.plan" (or "task.batch") to plan a hierarchical/DAG task graph in one call (supports parentId, blockedBy, owner/subagent, intent, evidence). '
        + 'Use "task.dispatch" to spawn or message a subagent, "team.steer" to steer a subagent, and "mail.send" to relay messages across lead/subagents/sessions. '
        + 'Use "bounds.propose" (field: "forbidden"|"allowed"|"notes", item, reason) when hitting a permission/sandbox/environment wall or summarizing boundaries so DSH Chief can request user approval. '
        + 'Cold Engineering Archives ("archive.search", "archive.read", "archive.save") store precipitated long-term engineering memories lazily and are NEVER auto-injected: call archive.search / archive.read ONLY when the user explicitly requests historical archive lookup, or archive.save when asked to precipitate a durable engineering lesson.',
    },
    tasks: {
      type: 'array',
      description: 'graph.plan / task.batch: array of task nodes to create or update in the DAG. Items may reference each other via id/key in parentId and blockedBy.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Task id or temporary symbolic key (e.g. "t1", "api-design") referenced by parentId or blockedBy.' },
          title: { type: 'string', description: 'Short task title.' },
          parentId: { type: 'string', description: 'Parent task id/key for hierarchical decomposition.' },
          blockedBy: { type: 'array', items: { type: 'string' }, description: 'Upstream task ids/keys that must finish (done) before this task unlocks.' },
          owner: { type: 'string', description: 'Assigned subagent name (e.g. "researcher", "coder", "verifier") or owner.' },
          subagent: { type: 'string', description: 'Subagent name to bind to this task.' },
          preset: { type: 'string', description: 'Optional subagent provider/preset ("spawn", "fork", or preset id).' },
          intent: { type: 'string', description: 'Why this task exists / goal.' },
          evidence: { type: 'string', description: 'Verification criteria (before done) or verification proof (when done).' },
          note: { type: 'string', description: 'Detailed notes or context.' },
          priority: { type: 'string', enum: PRIORITIES },
          status: { type: 'string', enum: STATUSES },
          assumption: { type: 'string', description: 'Optional assumption to track and verify.' },
        },
        required: ['title'],
        additionalProperties: false,
      },
    },
    replace: {
      type: 'boolean',
      description: 'graph.plan: when true, replaces existing tasks instead of merging.',
    },
    agent: {
      type: 'string',
      description: 'task.dispatch / team.steer / team.interrupt: target subagent name (e.g. "coder", "reviewer").',
    },
    subagent: {
      type: 'string',
      description: 'Alias for agent/owner on task operations.',
    },
    provider: {
      type: 'string',
      enum: ['spawn', 'fork'],
      description: 'task.dispatch: subagent provider ("spawn" for fresh context, "fork" to inherit conversation history). Default "spawn".',
    },
    preset: {
      type: 'string',
      description: 'task.dispatch / task.add: optional agent_preset for the child subagent.',
    },
    prompt: {
      type: 'string',
      description: 'task.dispatch / team.steer: extra instructions or steering message delivered to the subagent.',
    },
    message: {
      type: 'string',
      description: 'team.steer: message to deliver to the target subagent.',
    },
    force: {
      type: 'boolean',
      description: 'task.dispatch: when true, dispatch even if upstream blockedBy tasks are not done yet.',
    },
    mode: {
      type: 'string',
      enum: ['plan', 'goal'],
      description: 'mode.set: how this board is run. plan = a list of steps being ticked off. goal = one persistent objective steered toward.',
    },
    id: { type: 'string', description: 'Task id for update/claim/release/remove/dispatch/verify, or archive id for archive.read / archive.save.' },
    noteId: { type: 'string', description: 'Note id for note.write / note.pin / note.unpin / note.remove; omit to create a new note.' },
    archiveId: { type: 'string', description: 'Archive dossier id for archive.read / archive.save (on-demand cold archive lookup/update).' },
    query: { type: 'string', description: 'Keyword query for archive.search (searched only on explicit user demand).' },
    folder: { type: 'string', description: 'Filing cabinet drawer id for archive.search / archive.save (coords / incidents / contracts / ops / plans / inbox).' },
    paperclip: { type: 'string', enum: ['gold', 'silver', 'copper'], description: 'Paperclip importance badge for archive.save ("gold" anchor, "silver" verified, "copper" historical).' },
    summary: { type: 'string', description: 'Concise 1-line summary for archive.save.' },
    points: {
      type: 'array',
      description: 'Structured memory points for archive.save: [{ title, cue?, detail }].',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          cue: { type: 'string' },
          detail: { type: 'string' },
        },
        required: ['title', 'detail'],
        additionalProperties: false,
      },
    },
    step: { type: 'string', description: 'cursor.set: which plan step is open right now, in your own words.' },
    next: { type: 'string', description: 'cursor.set: the very next action — concrete enough to execute without re-reading the transcript.' },
    blocked: { type: 'string', description: 'cursor.set: what is blocking right now, or empty when nothing is.' },
    clear: { type: 'boolean', description: 'cursor.set: wipe step / next / blocked instead of overwriting them.' },
    expectedTaskId: { type: 'string', description: 'cursor.set: task id this cursor is working on — the panel highlights that node in the tree.' },
    memoryId: { type: 'string', description: 'Memory entry id for memory.remove.' },
    question: { type: 'string', description: 'Question for memory.ask; answered only from what this conversation already recorded.' },
    section: {
      type: 'string',
      enum: ['progress', 'decision', 'verify', 'open', 'other'],
      description: 'Memory section for memory.add: progress / decision / verify / open / other.',
    },
    body: { type: 'string', description: 'Note body, Markdown allowed.' },
    tags: { type: 'array', items: { type: 'string' }, description: 'Note tags.' },
    pinned: { type: 'boolean', description: 'note.write: mark this note pinned (anchor); bounds.add / bounds.pin / bounds.consolidate: when true, pin boundary globally across ALL tasks/sessions (📌); when false, keep boundary scoped to current task only.' },
    title: { type: 'string', description: 'Task title for task.add (or a rename in task.update); note.write: the note headline.' },
    note: { type: 'string', description: 'Free-form detail for the task.' },
    owner: { type: 'string', description: 'task.add / task.claim: who holds this task; defaults to the caller.' },
    intent: { type: 'string', description: 'task.add / task.update: why this task exists — the reason that survives a compaction.' },
    evidence: { type: 'string', description: 'task.add / task.update: what would prove it done — a command, a file, a probe name.' },
    blockedBy: { type: 'array', items: { type: 'string' }, description: 'task.add / task.update: task ids this task waits on — claim refuses while any of them is not done.' },
    assumption: { type: 'string', description: 'task.add / task.update: record an assumption you are making — stays visible until task.verify marks it true.' },
    assumptionIndex: { type: 'number', description: 'task.verify: which assumption (0-based) to mark as verified.' },
    taskId: { type: 'string', description: 'task id for task.update / task.claim / task.release / task.remove / task.verify / task.dispatch (alias for id).' },
    target: { type: 'string', description: 'task.add / task.update / task.dispatch: who this task is assigned to — visible in tree view as owner label.' },
    parentId: { type: 'string', description: 'task.add / task.update: parent task id for tree hierarchy — renders the child indented under its parent.' },
    status: { type: 'string', enum: STATUSES, description: 'Task status.' },
    priority: { type: 'string', enum: PRIORITIES, description: 'Task priority.' },
    field: {
      type: 'string',
      enum: ['allowed', 'forbidden', 'notes'],
      description: 'bounds.propose / bounds.set: target boundary column ("forbidden", "allowed", or "notes").',
    },
    item: { type: 'string', description: 'bounds.propose / bounds.add / bounds.pin / bounds.remove / bounds.edit / bounds.consolidate: boundary rule text.' },
    oldItem: { type: 'string', description: 'bounds.edit: existing boundary rule text to replace.' },
    removeItems: { type: 'array', items: { type: 'string' }, description: 'bounds.consolidate: scattered boundary rules to remove and replace with item.' },
    reason: { type: 'string', description: 'bounds.propose: brief context on why this boundary is needed (e.g. wall hit, permission block, or user request).' },
    items: { type: 'array', items: { type: 'string' }, description: 'bounds.propose (multiple rules) or bounds.set (new contents of column named by field).' },
    allowed: { type: 'array', items: { type: 'string' }, description: 'bounds.set: the whole 允许 column.' },
    forbidden: { type: 'array', items: { type: 'string' }, description: 'bounds.set: the whole 禁止 column.' },
    notes: { type: 'array', items: { type: 'string' }, description: 'bounds.set: the whole 注意 column.' },
    autoInject: { type: 'boolean', description: 'settings.set: hand the digest to every turn of this machine.' },
    guardIdle: { type: 'boolean', description: 'settings.set: keep steering a turn that closes without doing anything.' },
    guardMaxPerSession: { type: 'number', description: 'settings.set: how many nudges one Session may take before the guard goes quiet (0-20, default 3).' },
    guardShortAnswer: { type: 'number', description: 'settings.set: the answer length below which a silent turn counts as an idle close (0-10000, default 600).' },
    objective: { type: 'string', description: 'The plan objective for plan.set / graph.plan / objective.set.' },
    steps: {
      type: 'array',
      description: 'Ordered plan steps for plan.set; each step is { id?, text, done }.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Existing step id from the board; omit for a new step.' },
          text: { type: 'string' },
          done: { type: 'boolean' },
        },
        required: ['text'],
        additionalProperties: false,
      },
    },
    text: { type: 'string', description: 'One handoff log line for log.add, or message text for team.steer / mail.send.' },
    subject: { type: 'string', description: 'mail.send: optional short subject line.' },
    delivery: {
      type: 'string',
      enum: ['steer', 'followup', 'silent'],
      description: 'mail.send: delivery posture ("steer" cuts into next step boundary, "followup" queues/wakes next turn, "silent" drops into chief inbox for next pre-step).',
    },
    unreadOnly: { type: 'boolean', description: 'mail.inbox: when true, returns only unread messages.' },
    by: { type: 'string', description: 'Who acts: an agent label or a user name. Defaults to "agent".' },
    session: { type: 'string', description: 'Session id that owns the change; the GUI fills it automatically.' },
    scope: { type: 'string', enum: ['session', 'shared'], description: 'Board to hit. Default "session" = the caller\'s own (or root tree) board; "shared" = the machine-wide anchor board.' },
  },
  required: ['action'],
  additionalProperties: false,
}

const NOTE_LIMIT = 20
const LOG_LIMIT = 12

function summary(board, subagents) {
  const counts = { todo: 0, doing: 0, blocked: 0, done: 0 }
  for (const task of board.tasks) counts[task.status] = (counts[task.status] || 0) + 1
  return {
    counts,
    open: board.tasks.filter(task => task.status !== 'done').length,
    tasks: board.tasks.map(task => ({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      owner: task.owner,
      subagent: task.subagent || '',
      preset: task.preset || '',
      session: task.session,
      parentId: task.parentId || '',
      blockedBy: Array.isArray(task.blockedBy) ? task.blockedBy : [],
      intent: task.intent || '',
      evidence: task.evidence || '',
      assumptions: Array.isArray(task.assumptions) ? task.assumptions : [],
      note: task.note,
      dispatchedAt: task.dispatchedAt || 0,
      updatedAt: task.updatedAt,
    })),
    ...(Array.isArray(subagents) ? { subagents } : {}),
    objective: board.objective,
    bounds: board.bounds || { allowed: [], forbidden: [], notes: [] },
    ...(board.pinnedBounds ? { pinnedBounds: board.pinnedBounds } : {}),
    plan: board.plan,
    notes: board.notes.slice(0, NOTE_LIMIT).map(note => ({
      id: note.id,
      title: note.title,
      body: note.body.length > 400 ? note.body.slice(0, 400) + '…' : note.body,
      tags: note.tags,
      by: note.by,
      session: note.session,
      updatedAt: note.updatedAt,
    })),
    notesCount: board.notes.length,
    notesLimit: NOTE_LIMIT,
    log: board.log.slice(-LOG_LIMIT),
    logCount: board.log.length,
    memory: (board.memory || []).slice(-12).map(item => ({
      id: item.id,
      at: item.at,
      turn: item.turn,
      section: item.section,
      title: item.title,
      text: item.text,
      tools: item.tools,
      by: item.by,
    })),
    memoryCount: (board.memory || []).length,
    updatedAt: board.updatedAt,
  }
}

function boardTool(runtime) {
  return {
    name: 'chief_board',
    description:
      'Shared task graph, subagent team controller, cross-session communication bus, plan, and anchor chief (参谋看板, coordinated by DSH 参谋长). '
      + 'MANDATORY DISCIPLINE: (1) Always call this tool to record objectives, task status changes (doing/blocked/done + evidence), or pinned conclusions — oral text alone counts as NOT recorded. '
      + '(2) Always call "mail.send", "task.dispatch", or "team.steer" when relaying information or delegating across lead/subagents/sessions — oral @mentions do NOT reach peers. '
      + '(3) When you hit a permission/sandbox/environment wall or are asked to summarize boundaries, call action="bounds.propose" (field="forbidden"|"allowed"|"notes", item, reason) to submit to DSH Chief (宰相), who requests user approval before injecting into global bounds.',
    parameters: BOARD_PARAMETERS,
    output: {
      schema: { type: 'object', description: 'The board summary after the operation.' },
      render(_args, value) {
        const view = value && typeof value === 'object' ? value : {}
        const lines = []
        if (view.ok === false) {
          lines.push('failed: ' + String(view.error))
          if (/bounds list too long/.test(String(view.error))) lines.push('bounds: one column holds at most ' + BOUND_CAP + ' entries')
        }
        if (view.archiveSearch) {
          const hits = Array.isArray(view.archiveSearch.hits) ? view.archiveSearch.hits : []
          lines.push('🗄️ archive search (' + hits.length + ' / ' + (view.archiveSearch.totalArchives || 0) + ' cold dossiers):')
          for (const h of hits) {
            lines.push('  📎 [' + h.folderLabel + '] «' + h.title + '» (' + h.id + ') — ' + h.summary)
          }
          if (!hits.length) lines.push('  (no matching cold archives)')
        }
        if (view.archiveItem) {
          const it = view.archiveItem
          lines.push('📎 archive «' + it.title + '» [' + it.folder + ' · ' + it.paperclip + '] (' + it.id + ')')
          lines.push('summary: ' + (it.summary || ''))
          for (const pt of Array.isArray(it.points) ? it.points : []) {
            lines.push('  • ' + pt.title + ': ' + (pt.detail || pt.cue || ''))
          }
          if (it.body) lines.push('--- raw body ---\n' + it.body)
        }
        if (view.archiveSaved) {
          lines.push('🗄️ archived dossier «' + view.archiveSaved.title + '» → drawer [' + view.archiveSaved.folder + '] (' + view.archiveSaved.id + ', cold-sealed)')
        }
        if (view.mailDelivered) {
          lines.push('📨 mail delivered → ' + view.mailDelivered.target + ' (' + view.mailDelivered.mode + ')')
        }
        if (view.boundProposed) {
          lines.push('🏛 ' + view.boundProposed.message)
          for (const p of view.boundProposed.proposed || []) {
            lines.push('  [' + p.field + '] ' + p.item + ' (by ' + p.from + ')')
          }
        }
        if (Array.isArray(view.inbox)) {
          lines.push('📬 mailbox (' + view.inbox.length + ' messages):')
          for (const m of view.inbox.slice(-10)) {
            lines.push('  ' + (m.unread ? '[NEW] ' : '') + m.from + ' → ' + m.to + (m.subject ? ' (' + m.subject + ')' : '') + ': ' + String(m.text || '').slice(0, 140))
          }
          if (Array.isArray(view.peers) && view.peers.length) {
            lines.push('📡 addressable peers: ' + view.peers.map(p => p.handle + '[' + p.status + ']').join(' · '))
          }
        }
        if (view.dispatched) {
          lines.push('🚀 dispatched task #' + view.dispatched.taskId + ' → subagent ' + view.dispatched.agent + ' (' + view.dispatched.mode + ')')
        }
        if (view.interrupted) {
          lines.push('⏹ interrupted subagent ' + view.interrupted)
        }
        if (view.messageId && view.agent) {
          lines.push('💬 steered subagent ' + view.agent + ' (messageId: ' + view.messageId + ')')
        }
        const subagents = Array.isArray(view.subagents) ? view.subagents.filter(a => a && a.name !== 'lead') : []
        if (subagents.length) {
          lines.push('子代理团队 (' + subagents.length + '): ' + subagents.map(a => a.name + '[' + a.status + ']').join(' · '))
        }
        const teamTasks = Array.isArray(view.teamTasks) ? view.teamTasks : []
        if (teamTasks.length) {
          lines.push('团队共享任务 ' + teamTasks.length + ' 项：')
          for (const t of teamTasks) {
            const st = t.status === 'in_progress' ? 'doing' : t.status === 'completed' ? 'done' : t.status
            lines.push('  [' + st + '] ' + t.id + ' ' + t.subject + (t.owner ? ' → ' + t.owner : '') + (t.blockedBy.length ? ' [等 ' + t.blockedBy.join(',') + ']' : ''))
          }
        }
        const counts = view.counts || {}
        lines.push('todo ' + (counts.todo || 0) + ' / doing ' + (counts.doing || 0) + ' / blocked ' + (counts.blocked || 0) + ' / done ' + (counts.done || 0))
        for (const task of Array.isArray(view.tasks) ? view.tasks : []) {
          const unverified = (Array.isArray(task.assumptions) ? task.assumptions : []).filter(a => !a.verified).length
          const parentInfo = task.parentId ? ' [父:' + task.parentId + ']' : ''
          const depInfo = (Array.isArray(task.blockedBy) ? task.blockedBy : []).length && task.status !== 'done'
            ? ' [等 ' + task.blockedBy.join(',') + ']'
            : ''
          const evInfo = task.evidence ? ' ✓证据:' + String(task.evidence).slice(0, 40) : ''
          lines.push('[' + task.status + '] #' + task.id + ' ' + task.title + (task.owner ? ' — @' + task.owner : '') + parentInfo + depInfo + (unverified > 0 ? ' ⚠' + unverified + '假设' : '') + evInfo)
        }
        const notesShown = Array.isArray(view.notes) ? view.notes : []
        for (const note of notesShown) {
          lines.push('note «' + (note.title || '(untitled)') + '» ' + (note.tags || []).join('/') + '  (' + note.id + ')')
        }
        const notesTotal = typeof view.notesCount === 'number' ? view.notesCount : notesShown.length
        const notesHidden = Math.max(0, notesTotal - notesShown.length)
        if (notesHidden > 0) {
          lines.push('notes: ' + notesShown.length + ' of ' + notesTotal + ' shown — ' + notesHidden + ' older note(s) are not in this answer')
        } else {
          lines.push('notes: ' + notesTotal + ' (all shown)')
        }
        const logShown = Array.isArray(view.log) ? view.log.length : 0
        const logTotal = typeof view.logCount === 'number' ? view.logCount : logShown
        if (logTotal > logShown) {
          lines.push('log: ' + logShown + ' of ' + logTotal + ' lines shown')
        }
        const truncated = Array.isArray(view.truncated) ? view.truncated : []
        if (truncated.length > 0) {
          const parts = truncated.map(item => item.field + ' ' + item.sent + ' → ' + item.kept + ' chars')
          lines.push('truncated: ' + parts.join('; '))
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args, exec) {
      const passed = args && typeof args === 'object' ? args : {}
      const callerAgent = exec && exec.agent ? exec.agent : null
      const rawSession = typeof passed.session === 'string' && passed.session
        ? passed.session
        : (callerAgent && callerAgent.id ? String(callerAgent.id) : '')
      const session = resolveRootSessionId(rawSession, callerAgent) || rawSession
      const identity = resolveAgentIdentity(runtime, rawSession, callerAgent)
      const byDefault = passed.by || (identity && identity.isChild ? identity.self : 'agent')

      if (passed.action === 'team.list') {
        try {
          const board = session ? loadBoard(boardFileFor(session)) : emptyBoard()
          const roster = await refreshSubagentTree(runtime, session, board)
          const svc = runtime.get('agentTeams')
          const rawTeamTasks = (svc && typeof svc.listTasks === 'function' && callerAgent) ? (svc.listTasks(callerAgent) || []) : []
          return {
            ok: true,
            subagents: roster,
            teamTasks: rawTeamTasks.map(t => ({
              id: t.id, subject: t.subject, status: t.status,
              owner: t.ownerName || '', blockedBy: t.blockedBy || [],
              ready: t.ready, revision: t.revision,
            })),
            ...summary(board, roster),
          }
        } catch (err) {
          return { ok: false, error: 'team.list: ' + String(err && err.message || err) }
        }
      }

      if (passed.action === 'bounds.propose') {
        const propRes = proposeBoundToChief(makeChiefDeps(runtime), {
          sessionId: rawSession,
          callerAgent,
          by: byDefault,
          field: str(passed.field, 'forbidden'),
          item: str(passed.item || passed.text || passed.note || passed.body, ''),
          items: Array.isArray(passed.items) ? passed.items : undefined,
          reason: str(passed.reason || passed.intent || passed.subject, ''),
        })
        if (!propRes.ok) return { ok: false, error: propRes.error }
        const board = session ? boardForSession(boardFileFor(session)) : emptyBoard()
        const roster = session ? await refreshSubagentTree(runtime, session, board) : []
        return {
          ok: true,
          boundProposed: propRes,
          ...summary(board, roster),
        }
      }

      if (passed.action === 'mail.send') {
        const target = str(passed.target || passed.agent || passed.subagent, 'lead').trim() || 'lead'
        const msgText = str(passed.text || passed.message || passed.prompt || passed.body || passed.note, '').trim()
        const deliv = await deliverCrossMessage(makeChiefDeps(runtime), {
          fromSession: rawSession,
          fromLabel: byDefault,
          target,
          subject: str(passed.subject || passed.title, ''),
          text: msgText,
          mode: ['steer', 'followup', 'silent'].includes(passed.delivery) ? passed.delivery : 'steer',
        })
        if (!deliv.ok) return { ok: false, error: deliv.error }
        const board = session ? loadBoard(boardFileFor(session)) : emptyBoard()
        const roster = session ? await refreshSubagentTree(runtime, session, board) : []
        return {
          ok: true,
          mailDelivered: {
            target: deliv.broadcast ? 'all' : deliv.target,
            mode: deliv.broadcast ? 'broadcast' : deliv.deliveryMode,
          },
          ...summary(board, roster),
        }
      }

      if (passed.action === 'mail.inbox') {
        const secDeps = makeChiefDeps(runtime)
        const inbox = readMailboxForAgent(secDeps, {
          sessionId: rawSession,
          callerAgent,
          unreadOnly: Boolean(passed.unreadOnly),
        })
        const dir = await listPeerDirectory(secDeps, session || rawSession)
        const board = session ? loadBoard(boardFileFor(session)) : emptyBoard()
        const roster = session ? await refreshSubagentTree(runtime, session, board) : []
        return {
          ok: true,
          inbox,
          peers: dir.targets,
          ...summary(board, roster),
        }
      }

      if (passed.action === 'task.dispatch' || passed.action === 'team.steer' || passed.action === 'team.interrupt') {
        const subRes = await executeSubagentAction(runtime, { ...passed, by: byDefault, session }, callerAgent, exec && exec.signal)
        if (!subRes.ok) return { ok: false, error: subRes.error }
        return {
          ok: true,
          ...(subRes.dispatched ? { dispatched: subRes.dispatched } : {}),
          ...(subRes.interrupted ? { interrupted: subRes.interrupted } : {}),
          ...(subRes.messageId ? { messageId: subRes.messageId, agent: subRes.agent } : {}),
          ...summary(subRes.board, subRes.subagents),
        }
      }

      const result = runAction(session ? { ...passed, by: byDefault, session } : { ...passed, by: byDefault })
      if (!result.ok) return { ok: false, error: result.error }
      const mergedBoard = session && result.board ? boardForSession(boardFileFor(session)) : result.board
      const roster = session ? await refreshSubagentTree(runtime, session, mergedBoard) : []
      return {
        ok: true,
        ...summary(mergedBoard, roster),
        ...(result.archiveSearch ? { archiveSearch: result.archiveSearch } : {}),
        ...(result.archiveItem ? { archiveItem: result.archiveItem } : {}),
        ...(result.archiveSaved ? { archiveSaved: result.archiveSaved } : {}),
        ...(result.truncated ? { truncated: result.truncated } : {}),
      }
    },
  }
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

function memoryTool(runtime) {
  return {
    name: 'chief_memory',
    description:
      'Rolling memory of THIS conversation, kept on its own board: one entry per finished turn, plus anything the human or you mark as worth keeping. '
      + 'Ask with "memory.ask" (question) to get the entries that match — answered only from what was actually recorded, and it says so when nothing matches. '
      + 'Write with "memory.add" (text, optional title/section) when a decision, a gate, or a constraint must survive the next turn; '
      + '"memory.remove" drops one entry by id. Sections: progress / decision / verify / open / other.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['memory.add', 'memory.remove', 'memory.ask'], description: 'Memory operation.' },
        text: { type: 'string', description: 'Entry body for memory.add.' },
        title: { type: 'string', description: 'Short headline for memory.add; defaults to the first 80 chars of text.' },
        section: { type: 'string', enum: MEMORY_SECTIONS.map(section => section.key), description: 'Section for memory.add.' },
        memoryId: { type: 'string', description: 'Entry id for memory.remove.' },
        question: { type: 'string', description: 'Natural-language question for memory.ask.' },
        session: { type: 'string', description: 'Session whose memory to hit; defaults to the calling Agent.' },
        scope: { type: 'string', enum: ['session', 'shared'], description: 'Board to hit. Default "session" = this conversation\'s own memory.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', description: 'The answer for memory.ask, or the entry that changed.' },
      render(_args, value) {
        const view = value && typeof value === 'object' ? value : {}
        if (view.ok === false) return [{ type: 'text', text: 'failed: ' + String(view.error) }]
        if (typeof view.reply === 'string') {
          const lines = [view.reply]
          if (Array.isArray(view.terms) && view.terms.length) lines.push('terms: ' + view.terms.join('/'))
          return [{ type: 'text', text: lines.join('\n') }]
        }
        const lines = ['memory entries: ' + (view.memoryCount === undefined ? '?' : view.memoryCount)]
        for (const item of Array.isArray(view.memory) ? view.memory : []) {
          lines.push('[' + item.section + '] ' + item.title)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args, exec) {
      const passed = args && typeof args === 'object' ? args : {}
      const session = typeof passed.session === 'string' && passed.session
        ? passed.session
        : (exec && exec.agent && exec.agent.id ? String(exec.agent.id) : '')
      if (!session && passed.scope !== 'shared') {
        return { ok: false, error: 'no session bound — memory is per-conversation now' }
      }
      const result = runAction(session ? { ...passed, session } : passed)
      if (!result.ok) return { ok: false, error: result.error }
      if (passed.action === 'memory.ask') {
        return { ok: true, reply: result.reply, hits: result.hits, terms: result.terms }
      }
      return {
        ok: true,
        memory: summary(result.board).memory,
        memoryCount: summary(result.board).memoryCount,
        ...(result.truncated ? { truncated: result.truncated } : {}),
      }
    },
  }
}

function boundariesTool(runtime) {
  return {
    name: 'chief_boundaries',
    description:
      'Report this Harness deployment’s live limits: working directory, sandbox mode, workspace-write roots, '
      + 'profile, the shared chief file, advertised web URL, tool count and process facts. '
      + 'Use it whenever the answer depends on what this Session is actually allowed to touch.',
    parameters: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session to report on; defaults to the calling Agent. Every per-session field is resolved for that Session, not for the process.' },
      },
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', description: 'Boundary facts for this deployment.' },
      render(_args, value) {
        const view = value && typeof value === 'object' ? value : {}
        return [{
          type: 'text',
          text: Object.keys(view).map(key => key + ': ' + JSON.stringify(view[key])).join('\n'),
        }]
      },
    },
    async execute(args, exec) {
      const passed = args && typeof args === 'object' ? args : {}
      const session = str(passed.session, '') || str(exec && exec.agent && exec.agent.id, '')
      return boundaries(runtime, session)
    },
  }
}

function handoffTool(runtime) {
  return {
    name: 'chief_handoff',
    description:
      'Produce the handover packet for this machine: objective, where the work stands, the ordered next actions with the intent behind each, '
      + 'the safety bounds to respect before touching anything, key coordinates, what was already tried and failed, and what still waits on the human. '
      + 'Hand it to a fresh Session when the current context is too heavy, so that Session can continue WITHOUT re-reading or decompressing the old transcript. '
      + 'A new Session should call this first. Pass mark:true once the packet was actually handed over.',
    parameters: {
      type: 'object',
      properties: {
        mark: { type: 'boolean', description: 'Stamp handoff.at/by/session to record that this packet was handed over.' },
        session: { type: 'string', description: 'Session handing over; defaults to the calling Agent.' },
        target: { type: 'string', description: 'Deliver instead of just rendering: "new" waits for the next new Session, or pass a live Session id to hand it over now. Only the operator decides this; nothing is transferred on its own.' },
        autoInject: { type: 'boolean', description: 'Turn the per-turn digest on or off. On by default: the digest is registered at the head of the system prompt so the model keeps the board in view for the whole task. Setting false records the preference; it does not remove the section.' },
        guardIdle: { type: 'boolean', description: 'Turn the idle-turn guard on or off (on by default): a turn that closes without moving the plan — no plan written, or open steps left untouched, or a short silent answer while work is still open — is steered one more step.' },
      },
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', description: 'The packet plus a short structural summary.' },
      render(_args, value) {
        const view = value && typeof value === 'object' ? value : {}
        return [{ type: 'text', text: String(view.text || '') }]
      },
    },
    async execute(args, exec) {
      const passed = args && typeof args === 'object' ? args : {}
      const session = typeof passed.session === 'string' && passed.session
        ? passed.session
        : (exec && exec.agent && exec.agent.id ? String(exec.agent.id) : '')

      const auto = asBool(passed.autoInject)
      if (auto !== undefined) {
        // autoInject lives on the shared board — it is a machine-level flag, not
        // per-session content.
        runAction({ action: 'settings.set', autoInject: auto, session, by: 'agent', scope: 'shared' })
      }

      const guard = asBool(passed.guardIdle)
      if (guard !== undefined) {
        runAction({ action: 'settings.set', guardIdle: guard, session, by: 'agent', scope: 'shared' })
      }

      if (typeof passed.target === 'string' && passed.target) {
        const delivered = await transferChief(runtime, { ...passed, by: 'agent' }, session)
        const after = loadBoard(boardFileFor(session))
        const result = {
          ok: delivered.ok,
          mode: delivered.mode,
          text: delivered.text,
          counts: {
            plan: (after.plan || []).length,
            openSteps: (after.plan || []).filter(step => !step.done).length,
            tasks: (after.tasks || []).length,
            openTasks: (after.tasks || []).filter(task => task.status !== 'done').length,
          },
        }
        // undefined is not lossless JSON, so a success carries no error key at all
        if (delivered.ok === false && delivered.error) result.error = String(delivered.error)
        return result
      }

      const selfFile = boardFileFor(session)
      if (asBool(passed.mark) === true) {
        // The tool half writes boards too, so it has to take the same lock as the
        // routes: a mark landing between a route's load and its save would be
        // dropped by whichever rename finished second.
        withBoardLock(selfFile, () => {
          const marked = loadBoard(selfFile)
          marked.handoff = { at: nowMs(), by: 'agent', session }
          pushLog(marked, '交接单已生成并交出', 'agent', session)
          saveBoard(marked, selfFile)
        })
      }
      // Render the inherited view: a packet handed over before the session ever
      // wrote bounds/objective must still tell the successor what the operator
      // forbade and what the machine is working on.
      const board = boardForSession(selfFile)
      const limits = boundaries(runtime, session)
      const rootSid = resolveRootSessionId(session) || session
      return {
        ok: true,
        text: renderHandoff(board, limits, 5200, session, {
          teamTasks: fetchTeamTasks(runtime, exec && exec.agent ? exec.agent : null),
          takenOutArchives: rootSid ? getTakenOutArchivesForSession(rootSid, boardFile()) : [],
        }),
        counts: {
          plan: (board.plan || []).length,
          openSteps: (board.plan || []).filter(step => !step.done).length,
          tasks: (board.tasks || []).length,
          openTasks: (board.tasks || []).filter(task => task.status !== 'done').length,
          bounds: board.bounds,
          handoffAt: board.handoff ? board.handoff.at : 0,
        },
      }
    },
  }
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
let handoffSeq = 0

function buildHandoffMessage(text) {
  handoffSeq += 1
  return {
    id: 'handoff-' + Date.now().toString(36) + '-' + handoffSeq.toString(36),
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

export async function transferChief(runtime, args, sessionId) {
  const passed = args && typeof args === 'object' ? args : {}
  const target = typeof passed.target === 'string' ? passed.target.trim() : 'new'
  // The packet is rendered from the sender's own board — the receiving board
  // stays untouched (per-session isolation; the transfer text is what moves).
  // Read through boardForSession so the packet still carries the operator's
  // bounds and the machine objective when this session never wrote its own.
  const board = boardForSession(boardFileFor(sessionId))
  const rootSid = resolveRootSessionId(sessionId) || sessionId
  const packet = renderHandoff(board, boundaries(runtime, sessionId), 5200, sessionId, {
    teamTasks: fetchTeamTasks(runtime, sessionId ? { id: sessionId } : null),
    takenOutArchives: rootSid ? getTakenOutArchivesForSession(rootSid, boardFile()) : [],
  })
  const by = typeof passed.by === 'string' && passed.by ? passed.by : 'user'

  if (!target || target === 'new' || target === 'latest') {
    if (!writePending({ at: nowMs(), by, session: sessionId, text: packet })) {
      return { ok: false, error: '待领取文件写入失败' }
    }
    const owner = boardFileFor(sessionId)
    withBoardLock(owner, () => {
      const next = loadBoard(owner)
      pushLog(next, '交接单已投放：等下一个新会话领取', by, sessionId)
      saveBoard(next, owner)
    })
    return { ok: true, mode: 'pending', text: packet }
  }

  // One-click handover: open the successor conversation here instead of
  // asking the operator to create one by hand and then find it in a picker.
  // The packet is parked BEFORE the create call: if creation dies half way the
  // next conversation still picks it up, and if it succeeds the
  // agent/created listener races us for the file — whoever clears it wins,
  // so the packet is never injected twice.
  if (target === 'create') {
    const controller = runtime.get('sessionController')
    const parked = writePending({ at: nowMs(), by, session: sessionId, text: packet })
    if (!parked) return { ok: false, error: '待领取文件写入失败' }
    if (!controller || typeof controller.create !== 'function') {
      return { ok: false, error: '这个部署没有 sessionController，交接单已放进待领取', mode: 'pending', text: packet }
    }
    let created
    try {
      created = await controller.create({})
    } catch (error) {
      return {
        ok: false,
        error: '唤起新会话失败：' + String((error && error.message) || error),
        mode: 'pending',
        text: packet,
      }
    }
    const createdId = str(created && created.sessionId, '')
    if (!createdId) return { ok: false, error: '新会话没有返回 id', mode: 'pending', text: packet }
    const owner = boardFileFor(sessionId)
    // The listener got there first: the packet is gone and that conversation
    // already carries it.
    if (!readPending()) {
      withBoardLock(owner, () => {
        const next = loadBoard(owner)
        pushLog(next, '交接单已由新会话 ' + createdId.replace(/^session-/, '').slice(0, 8) + ' 领取', by, sessionId)
        saveBoard(next, owner)
      })
      return { ok: true, mode: 'created', sessionId: createdId, delivered: true, text: packet }
    }
    const agents = runtime.get('agents')
    const fresh = agents && typeof agents.get === 'function' ? agents.get(createdId) : undefined
    const delivered = fresh ? await injectInto(fresh, packet) : { ok: false, error: '新会话还没有活的 agent，交接单留在待领取' }
    if (delivered.ok) clearPending()
    withBoardLock(owner, () => {
      const next = loadBoard(owner)
      pushLog(
        next,
        (delivered.ok ? '交接单已交给新会话 ' : '新会话已建（交接单仍待领取）：') + createdId.replace(/^session-/, '').slice(0, 8),
        by,
        sessionId,
      )
      saveBoard(next, owner)
    })
    return { ok: delivered.ok, mode: delivered.ok ? 'created' : 'pending', sessionId: createdId, text: packet }
  }

  const agents = runtime.get('agents')
  const agent = agents && typeof agents.get === 'function' ? agents.get(target) : undefined
  if (!agent) {
    writePending({ at: nowMs(), by, session: sessionId, text: packet, failedTarget: target })
    return { ok: false, error: '目标会话没有活的 agent：已改成待领取，下次新会话可取', mode: 'pending', text: packet }
  }
  const delivered = await injectInto(agent, packet)
  const owner = boardFileFor(sessionId)
  withBoardLock(owner, () => {
    const next = loadBoard(owner)
    pushLog(
      next,
      (delivered.ok ? '交接单已投放到会话 ' : '投放失败（' + delivered.error + '）：') + String(target).replace(/^session-/, '').slice(0, 8),
      by,
      sessionId,
    )
    saveBoard(next, owner)
  })
  if (!delivered.ok) {
    writePending({ at: nowMs(), by, session: sessionId, text: packet, failedTarget: target })
    return { ok: false, error: delivered.error, mode: 'pending', text: packet }
  }
  return { ok: true, mode: 'injected', target, text: packet }
}

/* ------------------------------------------------------------------------ apply */

export function apply(ctx) {
  const runtime = {
    get(name) {
      try {
        return typeof ctx.get === 'function' ? ctx.get(name) : undefined
      } catch {
        return undefined
      }
    },
  }
  activeRuntime = runtime

  // 1) Not inflated, not reminded: every prompt assembly carries a small digest,
  //    so a compacted transcript does not take the objective and the open steps
  //    away from the next turn.
  // Migrate a pre-split shared board into per-session boards ONCE: the first
  // session that claims it copies it, so anchors are not lost and no session
  // silently inherits another's tasks.
  ;(function migrateSharedBoard() {
    try {
      const sharedFile = boardFile()
      const dir = path.join(path.dirname(sharedFile), 'boards')
      const flag = path.join(path.dirname(sharedFile), '.split-done')
      if (fs.existsSync(flag)) return
      let stat
      try { stat = fs.statSync(sharedFile) } catch { return }
      if (!stat || !stat.isFile()) return
      const board = normalizeBoard(JSON.parse(fs.readFileSync(sharedFile, 'utf8')))
      const touched = Object.keys(board.sessions || {})
      const targets = new Set(touched)
      // Every note/task that carries a session id also seeds that board; a
      // session with only a heartbeat still gets the shared anchors.
      for (const note of board.notes || []) if (note.session) targets.add(String(note.session))
      for (const task of board.tasks || []) if (task.session) targets.add(String(task.session))
      // No owner at all → keep it as the shared/anchor board only.
      if (!targets.size) return
      const anchors = (board.notes || []).filter(note => (note.tags || []).includes('anchor'))
      fs.mkdirSync(dir, { recursive: true })
      for (const sid of targets) {
        const dst = sessionBoardFile(sid)
        if (fs.existsSync(dst)) continue
        // Seed only what is machine-wide: settings, the heartbeat table, the log
        // tail and the shared anchors. NOT the objective, NOT the plan, NOT the
        // bounds — those stay on the shared board and are inherited on every
        // read (boardForSession), so freezing a copy into each session would
        // recreate exactly the cross-session pollution the split removed.
        const seed = emptyBoard()
        seed.settings = board.settings || seed.settings
        seed.notes = anchors
        seed.sessions = board.sessions || {}
        seed.log = board.log || []
        fs.writeFileSync(dst, JSON.stringify(seed, null, 2), 'utf8')
      }
      fs.writeFileSync(flag, JSON.stringify({ at: nowMs(), seeded: [...targets] }, null, 2), 'utf8')
      // Shrink the shared board to the machine-wide facts only: the objective,
      // the plan, the bounds and the anchors are what a new session inherits,
      // while tasks/notes/memory stay per-session.
      withBoardLock(sharedFile, () => {
        const slim = emptyBoard()
        slim.settings = board.settings || slim.settings
        slim.bounds = board.bounds || slim.bounds
        slim.notes = anchors
        slim.sessions = board.sessions || {}
        slim.log = board.log || []
        slim.objective = board.objective
        slim.objectiveBy = board.objectiveBy
        slim.objectiveAt = board.objectiveAt
        slim.plan = board.plan
        saveBoard(slim, sharedFile)
      })
    } catch {}
  })()

  // Precipitate legacy shared-board engineering notes into `archives.json` ONCE
  // (after creating `board.pre-archive-backup.json`), sealing them as cold lazy-loaded dossiers.
  bootstrapArchivesFromSharedBoard({
    sharedFile: boardFile(),
    loadBoard,
    saveBoard,
    pushLog,
  })

  ctx.inject(['llm'], llmCtx => {
    const ownLlm = (llmCtx && llmCtx.llm) || (llmCtx && llmCtx.get ? llmCtx.get('llm') : null)
    if (ownLlm) activeLlm = ownLlm
    llmCtx.effect(() => () => {
      if (activeLlm === ownLlm) activeLlm = null
    }, 'dsh-chief: chief llm service')
  })
  ctx.on?.('llm/adapters-updated', () => invalidateChiefModelCatalog())
  ctx.on?.('settings/document-updated', () => invalidateChiefModelCatalog())

  ctx.effect(() => ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next()
    try {
      if (!decision || decision.kind === 'reject' || signal?.aborted || !Array.isArray(decision.messages)) {
        return decision
      }
      const deltaMsg = await consumePreStepDelta(makeChiefDeps(runtime), agent)
      if (!deltaMsg) return decision
      return { ...decision, messages: [deltaMsg, ...decision.messages] }
    } catch {
      return decision
    }
  }), 'dsh-chief: chief pre-step delta')

  ctx.inject(['systemPrompt'], spCtx => {
    const systemPrompt = spCtx.get ? spCtx.get('systemPrompt') : undefined
    if (!systemPrompt || typeof systemPrompt.section !== 'function') return
    // Always on, and always FIRST. A model that only meets the chief after
    // ten thousand tokens of other context writes for a while and forgets it,
    // which is exactly the failure the operator kept hitting. The section is
    // registered unconditionally so the board is in front of the model from the
    // first turn; -10000 sorts ahead of every built-in section (they use small
    // positive orders, and equal orders fall back to name order), and the host
    // only requires the order to be a finite number.
    const fallbackAgentId = spCtx && spCtx.agent && spCtx.agent.id ? String(spCtx.agent.id)
      : (spCtx && spCtx.get && spCtx.get('agent') && spCtx.get('agent').id ? String(spCtx.get('agent').id) : '')
    spCtx.effect(() => systemPrompt.section({
      name: 'dsh-chief',
      order: -10000,
      text: (promptCtx) => {
        const liveAgent = (promptCtx && promptCtx.agent) || (spCtx && spCtx.agent) || null
        const curId = liveAgent && liveAgent.id ? String(liveAgent.id) : fallbackAgentId
        const rootId = resolveRootSessionId(curId, liveAgent) || curId
        let teamTasks
        try {
          const svc = runtime.get('agentTeams')
          if (svc && typeof svc.listTasks === 'function' && liveAgent) {
            teamTasks = svc.listTasks(liveAgent)
          }
        } catch {}
        const board = boardForSession(boardFileFor(rootId))
        const agentIdentity = resolveAgentIdentity(runtime, curId, liveAgent)
        const subagents = getSubagentRoster(runtime, rootId, board)
        const secState = loadChiefState()
        const linkedPeersCount = Math.max(0, getLinkedCluster(secState, rootId || 'global').length - 1)
        const takenOutArchives = rootId ? getTakenOutArchivesForSession(rootId, boardFile()) : []
        if (rootId) refreshSubagentTree(runtime, rootId, board).catch(() => {})
        return renderDigest(board, { teamTasks, agentIdentity, subagents, linkedPeersCount, takenOutArchives })
      },
    }), 'dsh-chief: prompt digest')
  })

  // 2) Whatever plan or subagent delegation the model executed is mirrored into the board.
  ctx.effect(() => ctx.on('tools/result', (exec, result) => {
    try {
      if (!exec || !result || result.isError) return
      const caller = exec.agent || null
      const sessionId = caller && caller.id ? String(caller.id) : ''
      const rootId = resolveRootSessionId(sessionId, caller) || sessionId
      if (exec.name === 'todo_write') syncPlanFromTodos(exec.arguments, rootId)
      else if (exec.name === 'create_goal' || exec.name === 'update_goal') syncObjective(exec.name, exec.arguments, rootId)
      else if (exec.name === 'subagent' || exec.name === 'subagent_fork' || exec.name === 'send_message' || exec.name === 'interrupt_agent') {
        syncSubagentToolCall(runtime, exec, result)
      }
    } catch {}
  }), 'dsh-chief: plan & subagent mirror')

  // 2b) A transferred packet waits for exactly one new Session.
  ctx.effect(() => ctx.on('agent/created', async payload => {
    try {
      const agent = payload && payload.agent
      if (!agent || !agent.id) return
      const pending = readPending()
      if (!pending) return
      const delivered = await injectInto(agent, pending.text)
      if (delivered.ok) clearPending()
      // The claim is logged on the NEW session's own board, not the sender's.
      // A brand-new Session's turn-stopping write can land while this runs, so
      // the claim re-reads under the lock and keeps whatever else got there.
      const id = String(agent.id)
      const file = boardFileFor(id)
      const short = id.replace(/^session-/, '').slice(0, 8)
      withBoardLock(file, () => {
        const board = loadBoard(file)
        pushLog(
          board,
          (delivered.ok ? '交接单已被本会话领取 ' : '交接单投放失败（' + delivered.error + '），仍待领取：') + short,
          'agent',
          id,
        )
        // An injected packet only reaches the conversation, so the board the
        // claimant actually opens would look empty. Keep the packet itself on
        // that board, as a note, so the next reader sees the handover there.
        if (delivered.ok) {
          const title = '接手：' + (String(pending.text).split('\n')[0] || '上一段对话').replace(/^#\s*交接单\s*·\s*/, '').slice(0, 120)
          const body = String(pending.text).slice(0, 6000)
          const same = board.notes.find(note => note.title === title)
          if (same) {
            same.body = body
            same.updatedAt = nowMs()
            same.session = id
          } else {
            board.notes.unshift(normalizeNote({ id: newId('n'), title, body, tags: ['handoff'], by: 'agent', session: id }))
          }
        }
        return saveBoard(board, file)
      })
    } catch {}
  }), 'dsh-chief: deliver pending transfer')

  // 2c) Incremental record of what each turn actually did: which turns called a
  // tool at all, and which of them moved the plan. The idle guard reads both
  // first and falls back to the Session log, so a dropped event cannot make it
  // cry wolf about work that did happen — and, more importantly, a turn that ran
  // commands without touching the plan is recorded as exactly that.
  ctx.effect(() => ctx.on('session/event', (session, event) => {
    try {
      if (!event || event.type !== 'tool/call') return
      if (!event.data || !session || !session.id) return
      const id = String(session.id)
      const turn = event.data.turn
      noteToolCall(id, turn)
      if (isPlanWrite(event.data.name, event.data.arguments)) notePlanWrite(id, turn)
      // The loop shape needs the call itself, not just the turn: same tool with
      // the same arguments N times is the tell that nothing is moving.
      noteCallTrail(id, event.data.name, event.data.arguments)
    } catch {}
  }), 'dsh-chief: tool call ledger')

  // 3) One heartbeat per finished turn: which Sessions are still warm — and the
  // idle guard: a turn that closes with a short answer, no tool call, and open
  // work still on the board gets one more step instead of closing.
  ctx.effect(() => ctx.on('agent/turn-stopping', payload => {
    let id = ''
    try {
      const agent = payload && payload.agent
      id = agent && agent.id ? String(agent.id) : ''
      if (!id) return

      const turn = Number(payload && payload.turn)
      const file = boardFileFor(id)

      // One critical section: heartbeat, memory line and the guard verdict all
      // read and rewrite the same board, so a route landing mid-way must not be
      // able to overwrite any of them.
      withBoardLock(file, () => {
        const board = loadBoard(file)

        // Heartbeat, inlined so the three edits share one load and one save.
        try {
          const entry = board.sessions[id] || { lastSeen: 0, cwd: '', turns: 0 }
          entry.lastSeen = nowMs()
          entry.turns = (entry.turns || 0) + 1
          board.sessions[id] = entry
          const ids = Object.keys(board.sessions)
          if (ids.length > 40) {
            ids.sort((a, b) => (board.sessions[a].lastSeen || 0) - (board.sessions[b].lastSeen || 0))
            for (const stale of ids.slice(0, ids.length - 40)) delete board.sessions[stale]
          }
        } catch {}

        // Memory first: every finished turn leaves one line in the board's memory
        // before the guard can decide anything, so asking "what did we do" works
        // even when the turn was idle.
        let capturedEntry = null
        const identity = resolveAgentIdentity(runtime, id, agent)
        try {
          capturedEntry = captureTurn(agent && agent.session, turn, null)
          if (capturedEntry) {
            capturedEntry.session = id
            if (identity && identity.isChild && identity.self) {
              capturedEntry.by = identity.self
            }
            appendMemory(board, capturedEntry)
          }
        } catch {}

        // If a child subagent just finished its turn, auto-settle its assigned
        // 'doing' task on the shared root board and unlock downstream dependencies.
        if (identity && identity.isChild) {
          const selfName = String(identity.self || '').toLowerCase()
          const shortSelf = selfName.split('/').pop()
          let settledCount = 0
          for (const task of board.tasks || []) {
            if (!task || task.status !== 'doing') continue
            const tSub = String(task.subagent || '').toLowerCase()
            const tOwn = String(task.owner || '').toLowerCase()
            const matched = (selfName && (tSub === selfName || tOwn === selfName || tSub.split('/').pop() === shortSelf || tOwn.split('/').pop() === shortSelf))
              || (task.session && String(task.session) === id)
            if (matched && capturedEntry && capturedEntry.text) {
              task.status = 'done'
              if (!task.evidence) {
                task.evidence = String(capturedEntry.title || capturedEntry.text).slice(0, CAP_TASK_EVIDENCE)
              }
              task.updatedAt = nowMs()
              settledCount += 1
              pushLog(board, '✅ 子代理 ' + identity.self + ' 完成任务 #' + task.id + '「' + task.title.slice(0, 36) + '」', identity.self, id)
            }
          }
          if (settledCount > 0) {
            reconcileTaskDependencies(board, identity.self, id)
          }
          saveBoard(board, file)
          scheduleChiefTurnReview(makeChiefDeps(runtime), { agent, sessionId: id, turn })
          return
        }

        // autoInject is machine-wide on the shared board; guardIdle follows the
        // same rule so one switch turns the guard off everywhere.
        const shared = loadBoard(boardFile())
        const settings = { ...(board.settings || {}), ...(shared.settings || {}) }
        const verdict = shouldGuard({ board, session: agent && agent.session, sessionId: id, turn, settings })
        if (!verdict) {
          saveBoard(board, file)
          scheduleChiefTurnReview(makeChiefDeps(runtime), { agent, sessionId: id, turn })
          return
        }

        if (typeof agent.steer !== 'function') {
          pushLog(board, '空转拦截：这个 agent 没有 steer 方法，无法补一步', 'guard', id)
          saveBoard(board, file)
          return
        }

        // Steer inside the lock: the notice is queued before another request can
        // observe a board that claims an intervention that never happened.
        const notice = buildNotice({ ...verdict, board })
        agent.steer(notice)
        noteIntervention(id, turn)
        // Clear the trail only once the steer landed: a loop that survived a
        // failed steer deserves the next nudge, not a silent reset.
        if (verdict.kind === 'loop') clearCallTrail(id)
        pushLog(board, guardLogText(verdict, turn, remainingInterventions(id, settings)), 'guard', id)

        // Auto-handoff: when the guard has spent its last intervention and the
        // session still has open work, the turn is not idle — it is stuck in a
        // context that has grown too long to be productive. Generate the
        // handover packet right now so the next Session (or a manual reopen)
        // inherits it instead of a blank board. The steer already fired above
        // tells the model to wrap up; this packet is what the next one reads.
        if (remainingInterventions(id, settings) === 0) {
          try {
            const rootForHandoff = resolveRootSessionId(id) || id
            const packet = renderHandoff(board, boundaries(runtime, id), 5200, id, {
              takenOutArchives: rootForHandoff ? getTakenOutArchivesForSession(rootForHandoff, boardFile()) : [],
            })
            const pendingFile_ = pendingFile()
            fs.writeFileSync(pendingFile_, JSON.stringify({ text: packet, at: nowMs(), from: id }))
            pushLog(board, '上下文压力：干预计数耗尽，交接单已自动生成并放入待领取', 'handoff', id)
          } catch (handoffError) {
            pushLog(board, '自动交接单生成失败：' + String(handoffError && handoffError.message ? handoffError.message : handoffError).slice(0, 160), 'handoff', id)
          }
        }
        saveBoard(board, file)
      })
    } catch (error) {
      // Never let the guard break the turn boundary.
      try {
        if (!id) return
        const file = boardFileFor(id)
        withBoardLock(file, () => {
          const board = loadBoard(file)
          pushLog(board, '空转拦截自身出错：' + String(error && error.message ? error.message : error).slice(0, 160), 'guard', id)
          saveBoard(board, file)
        })
      } catch {}
    }
  }), 'dsh-chief: session heartbeat and idle guard')

  // Routes: the browser half of this same package calls them same-origin.
  ctx.inject(['webServer'], webCtx => {
    for (const route of routeTable(runtime)) {
      webCtx.effect(() => webCtx.webServer.register(route), 'dsh-chief: route ' + route.path)
    }
  })

  // Model tools: the cross-Session half of the same operations.
  ctx.inject(['tools'], toolCtx => {
    for (const tool of [boardTool(runtime), boundariesTool(runtime), handoffTool(runtime), memoryTool(runtime)]) {
      toolCtx.effect(() => toolCtx.tools.register(tool), 'dsh-chief: tool ' + tool.name)
    }
  })
}
