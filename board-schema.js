/**
 * board-schema.js
 *
 * Pure schema constants, field caps, DAG normalization, and board summary helpers for dsh-chief.
 */

import { normalizeMemory } from './memory.js'

export const API = '/api/dsh-chief'

export const BACKEND_BUILD = '2.0.0'

export const BOARD_VERSION = 1

const LOG_CAP = 60

export const BODY_LIMIT = 24 * 1024 * 1024

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
export function enforceAnchorCap(notes) {
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

export const STATUSES = ['todo', 'doing', 'blocked', 'done']

export const PRIORITIES = ['high', 'normal', 'low']

let seq = 0

export function newId(prefix) {
  seq += 1
  return prefix + '-' + Date.now().toString(36) + '-' + seq.toString(36)
}

export function nowMs() {
  return Date.now()
}

export function emptyBoard() {
  return {
    version: BOARD_VERSION,
    updatedAt: nowMs(),
    objective: '',
    objectiveBy: '',
    objectiveAt: 0,
    objectiveUpdatedAt: 0,
    activeCabinetId: '',
    goalApproval: null,
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
    handoff: {
      at: 0,
      by: '',
      session: '',
      customText: '',
      pinned: false,
      pinnedAt: 0,
      pinnedBy: '',
      updatedAt: 0,
      source: 'auto',
      syncOnDigest: false,
    },
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
export const LEADING_MARKER = /^[#>*\u3000 \t-]+/u

export function str(value, fallback) {
  return typeof value === 'string' ? value : fallback
}

// Caps the action layer applies BEFORE storing text. They mirror the clamps in
// normalizeTask / normalizeNote / normalizeBoard / memory.js, and they exist as
// a second copy on purpose: the normalize pass cannot report anything (it holds
// no result), so the write path does the clipping itself and records what it
// dropped on the way out.
export const CAP_TASK_TITLE = 240

export const CAP_TASK_NOTE = 2000

export const CAP_TASK_INTENT = 600

export const CAP_TASK_EVIDENCE = 600

export const CAP_ASSUMPTION = 300

export const CAP_NOTE_TITLE = 200

export const CAP_NOTE_BODY = 20000

export const CAP_PLAN_STEP = 400

export const CAP_OBJECTIVE = 2000

export const CAP_CURSOR = 400

export const CAP_LOG_TEXT = 400

export const CAP_MEMORY_TITLE = 80

export const CAP_MEMORY_TEXT = 700 // memory.js MEMORY_TEXT

/* Clip one string to cap and, when it actually lost characters, add a line to
 * the caller's clip list. Returns the clipped value so the call site reads like
 * the plain assignment it replaces. */
export function clipInto(clips, field, text, cap) {
  const value = typeof text === 'string' ? text : ''
  if (value.length <= cap) return value
  if (Array.isArray(clips)) clips.push({ field, sent: value.length, kept: cap })
  return value.slice(0, cap)
}

/* Attach the clip list to a result only when something was clipped, so every
 * untouched write keeps its exact old shape. */
export function clipped(result, clips) {
  if (Array.isArray(clips) && clips.length > 0) result.truncated = clips
  return result
}

/* Transport tolerance. Arguments that reach the tools as text are still the
 * same intent: "true" means true, "['a','b']" means two tags. Reading both
 * shapes here keeps a caller's mistake (a flattened list) from being stored as
 * a one-item list, or worse, dropped entirely. */
export function asBool(value) {
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
export function asCount(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return undefined
    const number = Number(text)
    if (Number.isFinite(number)) return Math.round(number)
  }
  return undefined
}

export function asList(value) {
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

export function normalizeTags(list) {
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

export function normalizeTask(raw) {
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
    planStepId: str(task.planStepId, '').slice(0, 120),
    targetPlanStepId: str(task.targetPlanStepId, '').slice(0, 120),
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
export function reconcileTaskDependencies(board, by, session) {
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

export function normalizeNote(raw) {
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

export const BOUND_FIELDS = ['allowed', 'forbidden', 'notes']

/** Normalize boundary field names, accepting `'must'` as an alias for `'allowed'` (必做事项). */
export function normalizeBoundFieldName(raw) {
  const f = str(raw, '').trim().toLowerCase()
  if (f === 'must' || f === 'must_do' || f === 'mustdo') return 'allowed'
  return BOUND_FIELDS.includes(f) ? f : ''
}

// Hard cap on one bounds column. Two different jobs read this number: loading
// clamps to it (an old or hand-edited board file must never be able to throw
// while being read), and every write path checks it BEFORE storing anything.
// The clamp used to be the only guard, which meant bounds.set accepted 25
// entries and stored 20 under the caller's name — and a bound list is a promise
// about what must not be done, so the five missing entries are not "lost text":
// they are restrictions the caller believes are in force and are not.
export const BOUND_CAP = 20

export function normalizeList(value) {
  return Array.isArray(value)
    ? value.filter(item => typeof item === 'string' && item.trim() !== '').map(item => item.trim().slice(0, 400)).slice(0, BOUND_CAP)
    : []
}

export function normalizeBounds(raw) {
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
export function guardCount(value, fallback, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

function normalizeGoalApproval(raw) {
  if (!raw || typeof raw !== 'object') return null
  const status = ['pending', 'approved', 'rejected'].includes(raw.status) ? raw.status : ''
  if (!status) return null
  return {
    id: str(raw.id, newId('ga')),
    status,
    objective: str(raw.objective, '').slice(0, 600),
    summary: str(raw.summary, '').slice(0, 600),
    evidence: str(raw.evidence, '').slice(0, 800),
    rejectReason: str(raw.rejectReason, '').slice(0, 300),
    at: typeof raw.at === 'number' ? raw.at : nowMs(),
    decidedAt: typeof raw.decidedAt === 'number' ? raw.decidedAt : 0,
  }
}

const CURSOR_BLOCKED_REAL_CONTRAST_RE = /(?:但|但是|不过|然而|仍|依然|还是).{0,12}(?:卡在|卡住|阻塞|受阻|无法|失败|报错|错误|缺少|缺失|无权限|权限拒绝|拒绝|冲突|超限|超时|未通过)|\b(?:but|however|still)\b.{0,24}\b(?:blocked|stalled|fail(?:ed|ing)?|error|missing|denied|cannot|can't|unable|timeout)\b/i

/**
 * Normalize `board.cursor.blocked` so non-blocking / cleared / user-approved remarks
 * (e.g. "无", "无（已获用户批准执行）", "用户已接受当前配置…", "None (approved)")
 * collapse to `""` instead of lighting up a false-positive red alarm pill, while
 * preserving genuine blockers (e.g. "无法连接", "无权限", "没有找到", "等待用户批准",
 * "None of the tests passed", or contrast clauses like "用户已确认，但仍缺少…").
 */
export function normalizeCursorBlocked(raw) {
  const s = String(raw === null || raw === undefined ? '' : raw).replace(/\s+/g, ' ').trim()
  if (!s) return ''
  const unwrapped = s.replace(/^[\s\-—–_\/.,;:!?~`'"“”‘’（）()【】\[\]{}]+|[\s\-—–_\/.,;:!?~`'"“”‘’（）()【】\[\]{}]+$/g, '').trim()
  if (!unwrapped) return ''
  if (/^(?:无|暂无|没有|木有|空|正常|无阻塞|无卡点|无阻碍|无受阻|无障碍|未受阻|未阻塞|不阻塞|不受阻|非阻塞|目前无阻塞|当前无阻塞|暂无阻塞|暂无卡点|没有阻塞|没有卡点|无异常|无报错|已解除|已解决|已清空|已清零|已放行|已通过|已恢复|已批准|已获批|已获批准|已获用户批准|已获用户批准执行|已确认|已同意|none|no|n\/?a|nil|null|empty|nothing|false|ok|clear|cleared|resolved|unblocked|not\s+blocked|no\s+blockers?|no\s+issues?|approved|user\s+approved)$/i.test(unwrapped)) {
    return ''
  }
  if (CURSOR_BLOCKED_REAL_CONTRAST_RE.test(s)) {
    return s.slice(0, 400)
  }
  if (
    /^(?:(?:目前|当前)?(?:无|暂无)(?=$|[\s（(【\[，,；;：:。.\-—/、])|(?:目前|当前)?(?:无|暂无|没有|未|不|非)(?:明显|任何)?(?:阻塞|卡点|阻碍|受阻|障碍|卡住|异常|报错|问题)(?=$|[\s（(【\[，,；;：:。.\-—/、])|(?:已解除|已解决|已放行|已清空|已清零|已恢复|已获(?:用户)?批(?:准)?(?:执行)?|已由用户(?:批准|确认|同意|接受)|用户已(?:接受|批准|确认|同意|拍板|放行|认可)))/.test(s)
  ) {
    return ''
  }
  if (
    /^(?:(?:none|n\/?a|nil|null|nothing)(?=$|\s*[(\[.,;:\-\/])|(?:not\s+blocked|no\s+blockers?(?:\s+found|\s+now|\s+remaining)?|unblocked|resolved|cleared|approved(?:\s+by\s+user)?|user\s+(?:approved|accepted|confirmed))(?=$|[\s(\[.,;:\-\/]))/i.test(s)
  ) {
    return ''
  }
  return s.slice(0, 400)
}

export function normalizeBoard(raw) {
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
    objectiveUpdatedAt: typeof board.objectiveUpdatedAt === 'number' ? board.objectiveUpdatedAt : (typeof board.objectiveAt === 'number' ? board.objectiveAt : 0),
    activeCabinetId: str(board.activeCabinetId, '').trim(),
    goalApproval: normalizeGoalApproval(board.goalApproval),
    // Whitelisted, not free-form: an unknown mode would make every consumer
    // (digest, panel) disagree about which shape the board has.
    mode: board.mode === 'goal' ? 'goal' : 'plan',
    bounds: normalizeBounds(board.bounds),
    pausedBounds: normalizeBounds(board.pausedBounds),
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
      customText: str(board.handoff && board.handoff.customText, '').slice(0, 16000),
      pinned: board.handoff ? board.handoff.pinned === true : false,
      frozenFromAuto: board.handoff ? board.handoff.frozenFromAuto === true : false,
      pinnedAt: board.handoff && typeof board.handoff.pinnedAt === 'number' ? board.handoff.pinnedAt : 0,
      pinnedBy: str(board.handoff && board.handoff.pinnedBy, ''),
      updatedAt: board.handoff && typeof board.handoff.updatedAt === 'number' ? board.handoff.updatedAt : 0,
      source: ['human', 'chief', 'auto'].includes(str(board.handoff && board.handoff.source, '')) ? board.handoff.source : 'auto',
      syncOnDigest: board.handoff ? board.handoff.syncOnDigest === true : false,
    },
    cursor: {
      at: board.cursor && typeof board.cursor.at === 'number' ? board.cursor.at : 0,
      step: str(board.cursor && board.cursor.step, '').slice(0, 400),
      next: str(board.cursor && board.cursor.next, '').slice(0, 400),
      blocked: normalizeCursorBlocked(board.cursor && board.cursor.blocked),
      by: str(board.cursor && board.cursor.by, ''),
      session: str(board.cursor && board.cursor.session, ''),
    },
    plan: plan
      .map(step => {
        const cleanSummary = str(step && step.summary, '').trim().slice(0, 240)
        return {
          id: str(step && step.id, newId('s')),
          text: str(step && step.text, '').slice(0, 400),
          done: step && step.done === true,
          ...(cleanSummary ? { summary: cleanSummary } : {}),
        }
      })
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

export function pushLog(board, text, by, session) {
  board.log.push({ at: nowMs(), by: str(by, ''), session: str(session, ''), text: str(text, '') })
  if (board.log.length > LOG_CAP) board.log = board.log.slice(-LOG_CAP)
}

/** One log line per intervention, naming the shape the guard caught. */
export function guardLogText(verdict, turn, remaining) {
  const tail = '，已催一步（本会话还剩 ' + remaining + ' 次）'
  if (verdict && verdict.kind === 'loop') {
    const loop = verdict.loop || {}
    return '空转拦截：第 ' + turn + ' 轮同一个调用连着做了 ' + (loop.count || 0) + ' 次（'
      + String(loop.name || '?').slice(0, 40) + '）结果没变' + tail
  }
  if (verdict && verdict.kind === 'premature-promise') {
    return '空转拦截：第 ' + turn + ' 轮口头预告「'
      + String(verdict.promiseCue || '').slice(0, 40) + '」却未执行就收工' + tail
  }
  if (verdict && verdict.kind === 'mid-turn-spin') {
    const spin = verdict.spin || verdict.loop || {}
    return '运行中空转急刹：连续空转/报错 ' + (spin.count || 0) + ' 次（'
      + String(spin.name || '?').slice(0, 40) + '）已当场插话纠偏'
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

/* ------------------------------------------------------------------ boundaries */

export function safe(read, fallback) {
  try {
    const value = read()
    return value === undefined ? fallback : value
  } catch {
    return fallback
  }
}

const NOTE_LIMIT = 20

const LOG_LIMIT = 12

export function summary(board, subagents) {
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
      planStepId: task.planStepId || '',
      targetPlanStepId: task.targetPlanStepId || '',
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
    ...(board.pausedBounds ? { pausedBounds: board.pausedBounds } : {}),
    ...(board.pausedPinnedBounds ? { pausedPinnedBounds: board.pausedPinnedBounds } : {}),
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

/* ------------------------------------------------------ workflow pipeline */

/**
 * Resolve which plan step ID is currently active for auto-attaching tasks/subagents.
 * Prefers an open step matching `cursor.step`, then the first incomplete step,
 * and finally the last step when all are done.
 */
export function resolveActivePlanStepId(board) {
  const plan = board && Array.isArray(board.plan) ? board.plan.filter(s => s && s.text) : []
  if (!plan.length) return ''
  const cursorStep = str(board && board.cursor && board.cursor.step, '').trim().toLowerCase()
  if (cursorStep) {
    const exact = plan.find(s => !s.done && str(s.text, '').trim().toLowerCase() === cursorStep)
    if (exact) return exact.id
    const prefix = plan.find(s => !s.done && (
      str(s.text, '').trim().toLowerCase().startsWith(cursorStep)
      || cursorStep.startsWith(str(s.text, '').trim().toLowerCase().slice(0, 24))
    ))
    if (prefix) return prefix.id
  }
  const firstOpen = plan.find(s => !s.done)
  return firstOpen ? firstOpen.id : plan[plan.length - 1].id
}

function topoSortRootTasks(roots) {
  if (roots.length <= 1) return roots.slice()
  const byId = new Map(roots.map(t => [t.id, t]))
  const inDeg = new Map(roots.map(t => [t.id, 0]))
  const adj = new Map(roots.map(t => [t.id, []]))
  for (const t of roots) {
    const deps = Array.isArray(t.blockedBy) ? t.blockedBy : []
    for (const depId of deps) {
      if (byId.has(depId) && depId !== t.id) {
        inDeg.set(t.id, (inDeg.get(t.id) || 0) + 1)
        adj.get(depId).push(t.id)
      }
    }
  }
  const ready = roots.filter(t => (inDeg.get(t.id) || 0) === 0).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
  const ordered = []
  const placed = new Set()
  while (ready.length) {
    const cur = ready.shift()
    if (!cur || placed.has(cur.id)) continue
    placed.add(cur.id)
    ordered.push(cur)
    for (const nxtId of adj.get(cur.id) || []) {
      const deg = (inDeg.get(nxtId) || 1) - 1
      inDeg.set(nxtId, deg)
      if (deg <= 0) {
        ready.push(byId.get(nxtId))
        ready.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
      }
    }
  }
  for (const t of roots) {
    if (!placed.has(t.id)) ordered.push(t)
  }
  return ordered
}

function isInternalProbeAgentName(name) {
  const raw = String(name || '').trim().replace(/^@/, '')
  if (!raw) return false
  const leaf = raw.split('/').pop() || raw
  return /^mnemon-(?:review|run)(?:[-_]|$)/i.test(leaf)
}

/**
 * Derive sequential workflow stages (`① -> ② -> ③ ...`), attached tasks,
 * sprouted subagent branches, return-edge targets, and unified 4-state colors.
 */
export function derivePlanFlowProgress(board, subagents = []) {
  const safeBoard = board && typeof board === 'object' ? board : {}
  const plan = Array.isArray(safeBoard.plan) ? safeBoard.plan.filter(s => s && s.text) : []
  const tasks = Array.isArray(safeBoard.tasks) ? safeBoard.tasks.filter(t => t && t.title) : []
  const rawAgents = Array.isArray(subagents) ? subagents.filter(a => a && a.name && a.name !== 'lead') : []
  const visibleAgents = rawAgents.filter(a => !(isInternalProbeAgentName(a.name) && a.status !== 'running'))

  let mode = 'empty'
  let stages = []

  if (plan.length > 0) {
    mode = 'plan'
    stages = plan.map((s, idx) => ({
      id: str(s.id, `s-${idx + 1}`),
      index: idx + 1,
      text: str(s.text, ''),
      done: s.done === true,
      summary: str(s.summary, ''),
      source: 'plan',
      rootTaskId: '',
      tasks: [],
      agents: [],
      returnEdges: [],
      status: 'todo',
    }))
  } else if (tasks.length > 0) {
    mode = 'task-root'
    const taskIds = new Set(tasks.map(t => t.id))
    const roots = topoSortRootTasks(tasks.filter(t => !t.parentId || !taskIds.has(t.parentId) || t.parentId === t.id))
    stages = roots.map((t, idx) => ({
      id: 's-' + t.id,
      index: idx + 1,
      text: t.title,
      done: t.status === 'done',
      summary: t.evidence || '',
      source: 'task-root',
      rootTaskId: t.id,
      tasks: [],
      agents: [],
      returnEdges: [],
      status: 'todo',
    }))
  } else if (visibleAgents.length > 0 || str(safeBoard.objective, '').trim()) {
    mode = 'synthetic'
    stages = [{
      id: 'stage-main',
      index: 1,
      text: str(safeBoard.objective, '').trim() || '当前主线任务',
      done: false,
      summary: '',
      source: 'synthetic',
      rootTaskId: '',
      tasks: [],
      agents: [],
      returnEdges: [],
      status: 'todo',
    }]
  }

  if (!stages.length) {
    return {
      mode: 'empty',
      stages: [],
      activeStageId: '',
      orphanTasks: [],
      stats: {
        totalStages: 0,
        doneStages: 0,
        doingStages: 0,
        blockedStages: 0,
        totalAgents: 0,
        runningAgents: 0,
        doneAgents: 0,
      },
    }
  }

  const stageById = new Map(stages.map(s => [s.id, s]))
  const taskById = new Map(tasks.map(t => [t.id, t]))
  const activeStepId = resolveActivePlanStepId(safeBoard) || (stages.find(s => !s.done)?.id || stages[stages.length - 1].id)
  const doneStagesRev = [...stages].reverse().find(s => s.done)
  const lastDoneStepId = doneStagesRev ? doneStagesRev.id : activeStepId

  const taskStageCache = new Map()
  const resolveTaskStageId = (task, seen = new Set()) => {
    if (!task) return ''
    if (taskStageCache.has(task.id)) return taskStageCache.get(task.id)
    let hitId = ''
    if (task.planStepId && stageById.has(task.planStepId)) {
      hitId = task.planStepId
    } else if (stageById.has('s-' + task.id)) {
      hitId = 's-' + task.id
    } else {
      const byPrefix = stages.find(s => s.text && task.title && s.text.startsWith(task.title))
      if (byPrefix) hitId = byPrefix.id
    }
    if (!hitId && task.parentId && taskById.has(task.parentId) && !seen.has(task.id)) {
      seen.add(task.id)
      hitId = resolveTaskStageId(taskById.get(task.parentId), seen)
    }
    if (!hitId) {
      if (task.status === 'done') hitId = lastDoneStepId || activeStepId
      else hitId = activeStepId
    }
    taskStageCache.set(task.id, hitId)
    return hitId
  }

  const orphanTasks = []
  for (const t of tasks) {
    const sid = resolveTaskStageId(t)
    const st = sid ? stageById.get(sid) : null
    if (st) st.tasks.push(t)
    else orphanTasks.push(t)
  }

  const matchAgentTasks = agentObj => {
    const aName = str(agentObj && agentObj.name, '').trim().toLowerCase()
    const aLeaf = aName.split('/').pop()
    const aId = str(agentObj && agentObj.id, '').trim()
    const aTaskId = str(agentObj && agentObj.taskId, '').trim()
    const aTaskIds = new Set(Array.isArray(agentObj && agentObj.tasks) ? agentObj.tasks.map(x => str(x && x.id, '').trim()).filter(Boolean) : [])
    if (aTaskId) aTaskIds.add(aTaskId)
    return tasks.filter(t => {
      if (aTaskIds.has(t.id)) return true
      if (aId && t.session && String(t.session) === aId) return true
      const ref = str(t.subagent || t.owner, '').trim().toLowerCase()
      if (!ref || ref === 'lead' || ref === 'agent' || ref === 'operator') return false
      return ref === aName || (aLeaf && ref.split('/').pop() === aLeaf)
    })
  }

  let runningAgents = 0
  let doneAgents = 0
  for (const agentObj of visibleAgents) {
    const agentTasks = matchAgentTasks(agentObj)
    const rawAgentSt = str(agentObj.status, '').trim().toLowerCase()
    const hasBlockedTask = agentTasks.some(t => t.status === 'blocked')
    const hasDoingTask = agentTasks.some(t => t.status === 'doing')
    const hasOpenTask = agentTasks.some(t => t.status === 'todo' || t.status === 'doing' || t.status === 'blocked')
    const allTasksDone = agentTasks.length > 0 && agentTasks.every(t => t.status === 'done')
    const isAgentFailed = /error|fail|crash|blocked/.test(rawAgentSt)
    const isAgentRunning = rawAgentSt === 'running' || rawAgentSt === 'active' || rawAgentSt === 'working'
    const isAgentEnded = rawAgentSt !== '' && !isAgentRunning && !isAgentFailed && rawAgentSt !== 'todo' && rawAgentSt !== 'queued'

    let agentStatus = 'todo'
    if (hasBlockedTask || isAgentFailed) agentStatus = 'blocked'
    else if (isAgentRunning || (!isAgentEnded && hasDoingTask)) agentStatus = 'doing'
    else if (allTasksDone || (isAgentEnded && !hasOpenTask)) agentStatus = 'done'

    if (agentStatus === 'doing') runningAgents += 1
    else if (agentStatus === 'done') doneAgents += 1

    const primaryTask = agentTasks.find(t => t.status === 'doing' || t.status === 'blocked')
      || agentTasks.find(t => t.status === 'todo')
      || agentTasks[0]
      || null

    let fromStepId = primaryTask ? resolveTaskStageId(primaryTask) : ''
    if (!fromStepId || !stageById.has(fromStepId)) {
      fromStepId = agentStatus === 'done' ? (lastDoneStepId || activeStepId) : activeStepId
    }
    const rawTargetId = primaryTask && primaryTask.targetPlanStepId ? primaryTask.targetPlanStepId : ''
    const toStepId = (rawTargetId && stageById.has(rawTargetId)) ? rawTargetId : fromStepId

    const stage = stageById.get(fromStepId) || stages[0]
    const node = {
      name: str(agentObj.name, ''),
      id: str(agentObj.id, ''),
      parentId: str(agentObj.parentId, ''),
      rawStatus: rawAgentSt,
      agentStatus,
      taskIds: agentTasks.map(t => t.id),
      primaryTaskId: primaryTask ? primaryTask.id : '',
      fromStepId: stage.id,
      toStepId,
      crossStep: toStepId !== stage.id,
    }
    stage.agents.push(node)
    stage.returnEdges.push({
      fromAgent: node.name,
      taskId: node.primaryTaskId,
      fromStepId: stage.id,
      toStepId,
      status: agentStatus,
      crossStep: toStepId !== stage.id,
    })
  }

  const firstOpenStage = stages.find(s => !s.done) || null
  const hasAnyDone = stages.some(s => s.done)
  const hasCursorStep = Boolean(str(safeBoard.cursor && safeBoard.cursor.step, '').trim())
  const hasAnyActivity = hasAnyDone
    || hasCursorStep
    || tasks.some(t => t.status !== 'todo')
    || visibleAgents.length > 0

  let doneStages = 0
  let doingStages = 0
  let blockedStages = 0
  for (const stage of stages) {
    if (stage.done) {
      stage.status = 'done'
      doneStages += 1
    } else if (stage.tasks.some(t => t.status === 'blocked') || stage.agents.some(a => a.agentStatus === 'blocked')) {
      stage.status = 'blocked'
      blockedStages += 1
    } else if (
      stage.tasks.some(t => t.status === 'doing')
      || stage.agents.some(a => a.agentStatus === 'doing')
      || (firstOpenStage && firstOpenStage.id === stage.id && hasAnyActivity)
    ) {
      stage.status = 'doing'
      doingStages += 1
    } else {
      stage.status = 'todo'
    }
  }

  return {
    mode,
    stages,
    activeStageId: activeStepId,
    orphanTasks,
    stats: {
      totalStages: stages.length,
      doneStages,
      doingStages,
      blockedStages,
      totalAgents: visibleAgents.length,
      runningAgents,
      doneAgents,
    },
  }
}
