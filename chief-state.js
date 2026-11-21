/**
 * chief-state.js
 *
 * State, configuration, persistence, workspace lifecycle, and shared pure helpers for DSH Chief.
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { threadId } from 'node:worker_threads'
import {
  resolveProjectKey,
  loadArchiveStore,
  loadGlobalVaultRaw,
  getChiefMountedGlobalForSession,
  getTakenOutGlobalForSession,
  collectSealedWatchSummary,
  getFlippedOutPrecipitatedForSession,
} from './archives.js'
import {
  DEFAULT_CHIEF_PERMISSION_MODE,
  CHIEF_PERMISSION_META,
  normalizePermissionMode,
  permissionRank,
  auditJsonlPath as safetyAuditJsonlPath,
  normalizeAuditRecord,
  appendAuditJsonlRecord,
  resolveRoleCapabilities,
  buildCapabilityScope,
  validatePolicyPluginList,
} from './safety/index.js'

const APPROVALS_CAP = 30

const AUDIT_LOG_CAP = 80

const RESUME_TASKS_CAP = 20

const TASK_LEDGER_CAP = 30

const DEFAULT_RESUME_TTL_MS = 30 * 60 * 1000

const STATE_VERSION = 1

const activeResumingTaskIds = new Set()

export function markTaskResumingActive(taskId) {
  const id = String(taskId || '').trim()
  if (id) activeResumingTaskIds.add(id)
}

export function unmarkTaskResumingActive(taskId) {
  const id = String(taskId || '').trim()
  if (id) activeResumingTaskIds.delete(id)
}

export const FACTS_CAP = 120

export const FACT_TEXT_MAX = 260

export const CHAT_CAP = 36

export const MAIL_CAP = 80

export const SUGGESTIONS_CAP = 6

export const MODEL_TIMEOUT_MS = 90_000

export const CATALOG_TTL_MS = 10_000

export const REVIEW_DELAY_MS = 2_800

export const AUTO_SUMMARY_COOLDOWN_MS = 5 * 60_000

export const SMART_REVIEW_COOLDOWN_MS = 3 * 60_000

export const AUTO_REVIEW_COOLDOWN_MS = 90_000

// Thinking models spend several thousand output tokens on internal reasoning before emitting text;
// small caps (e.g. 2k-4k) starve the visible answer to empty string.
export const SUMMARY_MAX_TOKENS = 16_384

export const SUMMARY_RETRY_MAX_TOKENS = 32_768

export const CHIEF_UPDATE_SOURCE = 'dsh-chief-update'

export const CHIEF_RELAY_SOURCE = 'dsh-chief-relay'

export const CHIEF_INQUIRY_SOURCE = 'dsh-chief-inquiry'

export const CHIEF_EXEC_REQ_SOURCE = 'dsh-chief-execution-request'

export const CHAT_OPPORTUNISTIC_SUMMARY_COOLDOWN_MS = 60_000

export const CHIEF_RUN_MODES = ['off', 'patrol', 'managed']

export const DEFAULT_MANAGED_IDLE_TIMEOUT_MS = 15 * 60 * 1000

export const CHIEF_THINKING_EFFORTS = ['auto', 'off', 'low', 'medium', 'high', 'xhigh']

export const ALERT_EVENTS_CAP = 20

export const LLM_LEDGER_RECENT_CAP = 20

export const DEFAULT_MANAGED_BUDGET_MAX_CALLS = 30

export const DEFAULT_MANAGED_BUDGET_MAX_TOKENS = 300_000

export const CHIEF_UI_LANGS = ['auto', 'zh', 'en']

export const CHIEF_SCENARIO_PRESETS = {
  observer: {
    id: 'observer',
    permissionMode: 'advisor',
    runMode: 'off',
    thinkingEffort: 'low',
    tacticalModes: {
      intervention: false,
      autoCompact: false,
      smartCompact: false,
      redlineSentinel: false,
    },
    notifyEnabled: true,
  },
  collab: {
    id: 'collab',
    permissionMode: 'strategist',
    runMode: 'patrol',
    thinkingEffort: 'auto',
    tacticalModes: {
      intervention: false,
      redlineSentinel: true,
    },
    notifyEnabled: true,
  },
  away: {
    id: 'away',
    permissionMode: 'chief',
    runMode: 'managed',
    thinkingEffort: 'auto',
    tacticalModes: {
      autoCompact: true,
      compactThresholdMode: 'pct',
      compactThresholdPct: 80,
      redlineSentinel: true,
    },
    notifyEnabled: true,
    managedBudgetMaxCalls: DEFAULT_MANAGED_BUDGET_MAX_CALLS,
    managedBudgetMaxTokens: DEFAULT_MANAGED_BUDGET_MAX_TOKENS,
  },
}

export function normalizeUiLang(raw) {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (s === 'zh' || s === 'zh-cn' || s === 'zh-hans') return 'zh'
  if (s === 'en' || s === 'en-us' || s === 'en-gb') return 'en'
  return 'auto'
}

export function normalizeManagedBudgetCalls(raw) {
  if (raw === 0 || raw === '0') return 0
  const n = Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_MANAGED_BUDGET_MAX_CALLS
  if (n <= 0) return 0
  return Math.min(500, Math.max(3, Math.round(n)))
}

export function normalizeManagedBudgetTokens(raw) {
  if (raw === 0 || raw === '0') return 0
  const n = Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_MANAGED_BUDGET_MAX_TOKENS
  if (n <= 0) return 0
  return Math.min(5_000_000, Math.max(10_000, Math.round(n)))
}

export function classifyChiefLlmCategory(reasonKind = '') {
  const rk = String(reasonKind || '').trim().toLowerCase()
  if (!rk) return 'chat'
  if (
    rk === 'dream_roam'
    || rk === 'precipitate'
    || rk === 'distill'
    || rk.startsWith('archive_')
  ) {
    return 'dream'
  }
  if (
    rk === 'turn_review'
    || rk === 'auto_summary'
    || rk === 'chat_summary'
    || rk === 'wall_blocked'
    || rk === 'strong_intervention'
    || rk === 'hazard_diagnosis'
    || rk === 'idle_watchdog'
    || rk === 'config_activated'
  ) {
    return 'review'
  }
  if (
    rk === 'ask_chief'
    || rk === 'consult_chief'
    || rk === 'blank_explore'
    || rk === 'craft_wall'
    || rk === 'extract_bounds'
    || rk === 'consolidate_bounds'
    || rk === 'suggest_objective'
    || rk === 'recommend_compact'
  ) {
    return 'chat'
  }
  return 'other'
}

const LLM_LEDGER_CALLS_MAX = 1_000_000
const LLM_LEDGER_TOKENS_MAX = 1_000_000_000

export function emptyLlmLedger() {
  return {
    totalCalls: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    byCategory: {
      chat: { calls: 0, tokens: 0 },
      review: { calls: 0, tokens: 0 },
      dream: { calls: 0, tokens: 0 },
      other: { calls: 0, tokens: 0 },
    },
    managedRun: {
      startedAt: 0,
      calls: 0,
      tokens: 0,
      tripped: false,
      trippedAt: 0,
      trippedReason: '',
    },
    recent: [],
  }
}

export function normalizeLlmLedger(raw) {
  const base = emptyLlmLedger()
  if (!raw || typeof raw !== 'object') return base
  const nonNegTs = v => Math.max(0, Math.round(Number(v) || 0))
  const clampCalls = v => Math.min(LLM_LEDGER_CALLS_MAX, Math.max(0, Math.round(Number(v) || 0)))
  const clampTokens = v => Math.min(LLM_LEDGER_TOKENS_MAX, Math.max(0, Math.round(Number(v) || 0)))
  base.totalCalls = clampCalls(raw.totalCalls)
  base.totalInputTokens = clampTokens(raw.totalInputTokens)
  base.totalOutputTokens = clampTokens(raw.totalOutputTokens)
  base.totalTokens = clampTokens(raw.totalTokens) || clampTokens(base.totalInputTokens + base.totalOutputTokens)
  const rawCats = raw.byCategory && typeof raw.byCategory === 'object' ? raw.byCategory : {}
  for (const k of ['chat', 'review', 'dream', 'other']) {
    const c = rawCats[k] && typeof rawCats[k] === 'object' ? rawCats[k] : {}
    base.byCategory[k] = { calls: clampCalls(c.calls), tokens: clampTokens(c.tokens) }
  }
  const mr = raw.managedRun && typeof raw.managedRun === 'object' ? raw.managedRun : {}
  base.managedRun = {
    startedAt: nonNegTs(mr.startedAt),
    calls: clampCalls(mr.calls),
    tokens: clampTokens(mr.tokens),
    tripped: Boolean(mr.tripped),
    trippedAt: nonNegTs(mr.trippedAt),
    trippedReason: clamp(mr.trippedReason || '', 220),
  }
  base.recent = (Array.isArray(raw.recent) ? raw.recent : [])
    .filter(r => r && typeof r === 'object')
    .slice(-LLM_LEDGER_RECENT_CAP)
    .map(r => {
      const inTok = clampTokens(r.inputTokens)
      const outTok = clampTokens(r.outputTokens)
      return {
        id: typeof r.id === 'string' && r.id ? r.id : nextId('llm'),
        at: nonNegTs(r.at) || Date.now(),
        category: ['chat', 'review', 'dream', 'other'].includes(r.category) ? r.category : 'other',
        reasonKind: clamp(r.reasonKind || '', 40),
        modelRef: clamp(r.modelRef || '', 80),
        inputTokens: inTok,
        outputTokens: outTok,
        totalTokens: clampTokens(r.totalTokens) || clampTokens(inTok + outTok),
        estimated: Boolean(r.estimated),
        ok: r.ok !== false,
      }
    })
  return base
}

export function summarizeLlmLedger(rawLedger, cfg = null) {
  const ledger = normalizeLlmLedger(rawLedger)
  const maxCalls = cfg && cfg.managedBudgetMaxCalls !== undefined
    ? normalizeManagedBudgetCalls(cfg.managedBudgetMaxCalls)
    : DEFAULT_MANAGED_BUDGET_MAX_CALLS
  const maxTokens = cfg && cfg.managedBudgetMaxTokens !== undefined
    ? normalizeManagedBudgetTokens(cfg.managedBudgetMaxTokens)
    : DEFAULT_MANAGED_BUDGET_MAX_TOKENS
  return {
    totalCalls: ledger.totalCalls,
    totalInputTokens: ledger.totalInputTokens,
    totalOutputTokens: ledger.totalOutputTokens,
    totalTokens: ledger.totalTokens,
    byCategory: {
      chat: { ...ledger.byCategory.chat },
      review: { ...ledger.byCategory.review },
      dream: { ...ledger.byCategory.dream },
      other: { ...ledger.byCategory.other },
    },
    managedRun: { ...ledger.managedRun },
    budget: {
      maxCalls,
      maxTokens,
    },
    recent: ledger.recent.slice(-8),
  }
}

export function normalizeAlertEvent(raw) {
  if (!raw || typeof raw !== 'object') return null
  const title = clamp(raw.title || '', 100)
  if (!title) return null
  const validKinds = [
    'pending_approval',
    'pending_elevation',
    'guard_wall_blocked',
    'auto_continue_rescue',
    'managed_auto_sleep',
    'budget_circuit_break',
    'hazard_halt',
  ]
  const kind = validKinds.includes(raw.kind) ? raw.kind : 'pending_approval'
  const level = ['info', 'warn', 'danger', 'success'].includes(raw.level) ? raw.level : 'info'
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : nextId('alt'),
    kind,
    level,
    title,
    body: clamp(raw.body || '', 220),
    dedupeKey: clamp(raw.dedupeKey || '', 100),
    at: Number(raw.at) || Date.now(),
  }
}

export function pushAlertEventToWs(ws, spec = {}) {
  if (!ws || typeof ws !== 'object') return null
  if (!Array.isArray(ws.alertEvents)) ws.alertEvents = []
  const norm = normalizeAlertEvent(spec)
  if (!norm) return null
  if (norm.dedupeKey) {
    const dup = ws.alertEvents.find(
      a => a && a.dedupeKey === norm.dedupeKey && Math.abs(norm.at - (Number(a.at) || 0)) < 5_000,
    )
    if (dup) return dup
  }
  ws.alertEvents.push(norm)
  if (ws.alertEvents.length > ALERT_EVENTS_CAP) {
    ws.alertEvents = ws.alertEvents.slice(-ALERT_EVENTS_CAP)
  }
  return norm
}

export function normalizeRunMode(raw, fallbackCfg = null) {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (s === 'off' || s === 'patrol' || s === 'managed') return s
  if (s === 'stopped' || s === 'manual') return 'off'
  if (s === 'smart') return 'patrol'
  if (s === 'auto' || s === 'autopilot') return 'managed'
  if (fallbackCfg && typeof fallbackCfg === 'object') {
    if (fallbackCfg.stopped || fallbackCfg.paceMode === 'stopped') return 'off'
    if (fallbackCfg.autoPilot || fallbackCfg.paceMode === 'auto') return 'managed'
    if (fallbackCfg.paceMode === 'smart') return 'patrol'
  }
  return 'off'
}

export function normalizeThinkingEffort(raw) {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (CHIEF_THINKING_EFFORTS.includes(s)) return s
  return 'auto'
}

function normalizeTeamEffortMode(raw) {
  return String(raw || '').trim().toLowerCase() === 'manual' ? 'manual' : 'auto'
}

export function normalizeLockedModelEfforts(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw)) {
    const cleanKey = String(k || '').trim().slice(0, 64)
    if (!cleanKey) continue
    if (v === true) out[cleanKey] = true
  }
  return out
}

const EFFORT_ORDER_LADDER = ['off', 'low', 'medium', 'high', 'xhigh']

export function resolveAlignedModelEffort(desiredEffort, supportedEfforts = []) {
  const list = Array.isArray(supportedEfforts)
    ? supportedEfforts.map(e => (typeof e === 'string' ? e : (e && e.id ? String(e.id) : ''))).filter(Boolean)
    : []
  if (!list.length) return undefined
  const want = String(desiredEffort || '').trim().toLowerCase()
  if (!want || want === 'auto') {
    if (list.includes('medium')) return 'medium'
    return list[Math.floor(list.length / 2)] || list[0]
  }
  if (list.includes(want)) return want
  const wantIdx = EFFORT_ORDER_LADDER.indexOf(want)
  if (wantIdx < 0) return list[0]
  for (let d = 1; d < EFFORT_ORDER_LADDER.length; d += 1) {
    if (wantIdx - d >= 0 && list.includes(EFFORT_ORDER_LADDER[wantIdx - d])) {
      return EFFORT_ORDER_LADDER[wantIdx - d]
    }
    if (wantIdx + d < EFFORT_ORDER_LADDER.length && list.includes(EFFORT_ORDER_LADDER[wantIdx + d])) {
      return EFFORT_ORDER_LADDER[wantIdx + d]
    }
  }
  return list[0]
}

export function touchWorkspaceActivity(sessionId) {
  const sid = String(sessionId || '').trim()
  if (!sid || sid === 'global') return false
  try {
    mutateChiefState((state) => {
      const ws = ensureWorkspace(state, sid)
      if (!ws.runtimeGuard || typeof ws.runtimeGuard !== 'object') ws.runtimeGuard = {}
      ws.runtimeGuard.lastActivityAt = Date.now()
    })
    return true
  } catch {
    return false
  }
}

const SECRET_PATTERN = /(?:sk-[a-zA-Z0-9_-]{16,}|ghp_[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|Bearer\s+[A-Za-z0-9._~+/=-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/

let dshAttachmentModulePromise = null

async function loadDshAttachment() {
  if (!dshAttachmentModulePromise) {
    dshAttachmentModulePromise = import('@deepseek-ai/dsh-attachment').catch(() => null)
  }
  return dshAttachmentModulePromise
}

const CHIEF_MAX_IMAGES = 4

const CHIEF_IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

function normalizeUploadedImage(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  let mediaType = String(raw.mediaType || raw.mimeType || raw.type || '').trim().toLowerCase()
  let data = String(raw.data || raw.base64 || '').trim()
  const dataUrlMatch = data.match(/^data:([^;]+);base64,(.+)$/is)
  if (dataUrlMatch) {
    if (!mediaType) mediaType = dataUrlMatch[1].trim().toLowerCase()
    data = dataUrlMatch[2].trim()
  }
  if (mediaType === 'image/jpg') mediaType = 'image/jpeg'
  data = data.replace(/\s+/g, '')
  if (!CHIEF_IMAGE_MEDIA_TYPES.has(mediaType) || !data) return null
  const ext = mediaType === 'image/jpeg' ? 'jpg' : (mediaType.split('/')[1] || 'png')
  const name = typeof raw.name === 'string' && raw.name.trim()
    ? clamp(raw.name.trim(), 80)
    : `chief-image-${idx + 1}.${ext}`
  return { name, mediaType, data }
}

export function resolveSessionWorkspaceCwd(deps, sessionId) {
  const rootId = (deps && typeof deps.resolveRootSessionId === 'function' ? deps.resolveRootSessionId(sessionId) : '') || sessionId
  try {
    if (deps && typeof deps.getSessionCwd === 'function') {
      const c = deps.getSessionCwd(rootId) || deps.getSessionCwd(sessionId)
      if (c && fs.existsSync(c)) return c
    }
    if (deps && typeof deps.boardForSession === 'function' && typeof deps.boardFileFor === 'function') {
      const b = deps.boardForSession(deps.boardFileFor(rootId))
      const sess = b && b.sessions && (b.sessions[rootId] || b.sessions[sessionId])
      if (sess && sess.cwd && fs.existsSync(sess.cwd)) return sess.cwd
    }
  } catch {}
  return process.cwd()
}

export function archiveTargetForRoot(deps, rootId, extra = '') {
  const opts = extra && typeof extra === 'object' ? extra : { cabinetId: String(extra || '') }
  const vaultScope = opts.vaultScope === 'global' ? 'global' : 'session'
  const sharedFile = deps && (typeof deps.sharedBoardFile === 'function' ? deps.sharedBoardFile() : deps.sharedBoardFile)
  const cwd = resolveSessionWorkspaceCwd(deps, rootId)
  let cab = opts.cabinetId ? String(opts.cabinetId).trim() : ''
  if (vaultScope !== 'global' && !cab && deps && typeof deps.boardForSession === 'function' && typeof deps.boardFileFor === 'function' && rootId && rootId !== 'global') {
    try {
      const b = deps.boardForSession(deps.boardFileFor(rootId))
      if (b && typeof b.activeCabinetId === 'string') cab = b.activeCabinetId.trim()
    } catch {}
  }
  return {
    customSharedBoardFile: sharedFile || '',
    cwd,
    vaultScope,
    ...(vaultScope !== 'global' && rootId && rootId !== 'global' ? { rootSessionId: String(rootId).trim() } : {}),
    ...(cab ? { cabinetId: cab } : {}),
  }
}

/**
 * Chief-of-Staff visibility matrix (Three-Tier Hook Architecture):
 * - Session Working Cabinet: Chief can always read session items + `recentlyUnpinnedWatch`.
 * - Global Vault: Unorganized global items (without hooks) are 0-token invisible to Chief!
 *   Organized global items expose ONLY lightweight `globalHookIndex` (`hasHook: true`),
 *   until Chief explicitly pulls/mounts them (`chiefMountedSessions` / `chiefPulledSessions`).
 * - Precipitated Cold Vault: 100% invisible to Chief (0 disk read, 0 hook leak) unless User explicitly `flippedOut`!
 */
export function collectChiefVisibleArchives(deps, rootId, stateSnapshot = null) {
  const sid = rootId && rootId !== 'global' ? String(rootId).trim() : ''
  const sessionTarget = sid ? archiveTargetForRoot(deps, sid, { vaultScope: 'session' }) : null
  const globalTarget = archiveTargetForRoot(deps, sid || 'global', { vaultScope: 'global' })
  const baseOpt = sessionTarget || globalTarget
  const projectKey = resolveProjectKey(baseOpt.cwd)

  let deskSessionItems = []
  let deskGlobalItems = []
  let deskFlippedItems = []
  let mountedGlobalItems = []
  let sessionItems = []
  let recentlyUnpinnedWatch = []
  let globalHookIndex = []
  let sealedWatch = { sessionSealed: [], globalSealed: [], precipSealed: [] }

  try {
    if (sessionTarget) {
      const stSess = loadArchiveStore(sessionTarget)
      const allSess = Array.isArray(stSess.items) ? stSess.items : []
      deskSessionItems = allSess.filter(it => Array.isArray(it.takenOutSessions) && it.takenOutSessions.includes(sid)).slice(0, 6)
      sessionItems = allSess.slice(0, 16).map(it => ({
        id: it.id,
        title: it.title,
        folder: it.folder,
        summary: it.summary,
        paperclip: it.paperclip,
        hasHook: Boolean(it.hasHook),
        hookKeywords: Array.isArray(it.hookKeywords) ? it.hookKeywords : [],
        hookCue: it.hookCue || '',
        takenOut: Array.isArray(it.takenOutSessions) && it.takenOutSessions.includes(sid),
        points: Array.isArray(it.points) ? it.points.slice(0, 3) : [],
      }))
      recentlyUnpinnedWatch = Array.isArray(stSess.recentlyUnpinnedWatch) ? stSess.recentlyUnpinnedWatch.slice() : []
    }
  } catch {}
  try {
    const gStore = loadGlobalVaultRaw(globalTarget)
    const gAll = Array.isArray(gStore && gStore.items) ? gStore.items : []
    if (sid) {
      deskGlobalItems = getTakenOutGlobalForSession(sid, globalTarget).slice(0, 6)
      mountedGlobalItems = getChiefMountedGlobalForSession(sid, globalTarget).slice(0, 6)
      // Also include entries Chief pulled in this session
      const pulledSet = new Set(mountedGlobalItems.map(x => x.id))
      for (const g of gAll) {
        if (g && Array.isArray(g.chiefPulledSessions) && g.chiefPulledSessions.includes(sid) && !pulledSet.has(g.id)) {
          mountedGlobalItems.push(g)
          pulledSet.add(g.id)
          if (mountedGlobalItems.length >= 6) break
        }
      }
    }
    globalHookIndex = gAll
      .filter(it =>
        it
        && it.hasHook === true
        && (!sid || (!Array.isArray(it.takenOutSessions) || !it.takenOutSessions.includes(sid)))
        && (!sid || (!Array.isArray(it.chiefMountedSessions) || !it.chiefMountedSessions.includes(sid)))
        && (!sid || (!Array.isArray(it.chiefPulledSessions) || !it.chiefPulledSessions.includes(sid)))
      )
      .slice(0, 12)
      .map(it => ({
        id: it.id,
        title: it.title,
        folder: it.folder,
        paperclip: it.paperclip,
        hookKeywords: Array.isArray(it.hookKeywords) ? it.hookKeywords : [],
        hookCue: it.hookCue || '',
      }))
  } catch {}
  try {
    if (sid) {
      const st = stateSnapshot || loadChiefState()
      const ws = st && st.workspaces && st.workspaces[sid]
      const flippedIds = ws && Array.isArray(ws.flippedPrecipitatedIds) ? ws.flippedPrecipitatedIds : []
      if (flippedIds.length > 0) {
        deskFlippedItems = getFlippedOutPrecipitatedForSession(projectKey, sid, true, baseOpt).slice(0, 6)
      }
    }
  } catch {}
  try {
    sealedWatch = collectSealedWatchSummary(sid, projectKey, baseOpt, { limitPerVault: 8 })
  } catch {}

  return {
    deskSessionItems,
    deskGlobalItems,
    deskFlippedItems,
    mountedGlobalItems,
    sessionItems,
    recentlyUnpinnedWatch,
    globalHookIndex,
    sealedWatch,
    sessionTarget,
    globalTarget,
  }
}

/** Persist raw uploaded images onto local workspace `.dsh-chief/uploads/` so any agent can inspect raw files even when LLM vision is unavailable. */
export function persistChiefImagesToWorkspace(deps, sessionId, rawImages) {
  const list = Array.isArray(rawImages) ? rawImages.slice(0, CHIEF_MAX_IMAGES) : []
  if (!list.length) return []
  const normalized = list.map((item, idx) => normalizeUploadedImage(item, idx)).filter(Boolean)
  if (!normalized.length) return []

  const cwd = resolveSessionWorkspaceCwd(deps, sessionId)
  const uploadDir = path.join(cwd, '.dsh-chief', 'uploads')
  fs.mkdirSync(uploadDir, { recursive: true })

  const d = new Date()
  const stamp = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('') + '-' + [
    String(d.getHours()).padStart(2, '0'),
    String(d.getMinutes()).padStart(2, '0'),
    String(d.getSeconds()).padStart(2, '0'),
  ].join('')

  const saved = []
  for (let idx = 0; idx < normalized.length; idx += 1) {
    const img = normalized[idx]
    const ext = img.mediaType === 'image/jpeg' ? 'jpg' : (img.mediaType.split('/')[1] || 'png')
    const baseRaw = path.basename(String(img.name || `image-${idx + 1}`), path.extname(String(img.name || '')))
    const safeName = baseRaw.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || `image-${idx + 1}`
    const fileName = `${stamp}-${idx + 1}-${safeName}.${ext}`
    const absPath = path.join(uploadDir, fileName)
    const buf = Buffer.from(img.data, 'base64')
    fs.writeFileSync(absPath, buf)
    saved.push({
      index: idx + 1,
      path: absPath,
      name: img.name || fileName,
      mediaType: img.mediaType,
      bytes: buf.length,
    })
  }
  return saved
}

export async function admitChiefImages(deps, rawImages) {
  const list = Array.isArray(rawImages) ? rawImages.slice(0, CHIEF_MAX_IMAGES) : []
  if (!list.length) return []
  const normalized = list.map((item, idx) => normalizeUploadedImage(item, idx)).filter(Boolean)
  if (!normalized.length) {
    throw new Error('上传的图片格式不受支持（仅支持 PNG / JPEG / WebP / GIF Base64）')
  }

  if (deps && typeof deps.admitImagesOverride === 'function') {
    const refs = await deps.admitImagesOverride(normalized)
    return (Array.isArray(refs) ? refs : []).filter(Boolean).map(attachment => ({ type: 'image', attachment }))
  }

  const attachmentsSvc = deps && typeof deps.getAttachments === 'function'
    ? deps.getAttachments()
    : (deps && deps.runtime && typeof deps.runtime.get === 'function' ? deps.runtime.get('attachments') : null)
  if (!attachmentsSvc) {
    throw new Error('当前 DSH 运行环境未挂载 attachments 图片服务，无法处理图片上传')
  }

  const attMod = await loadDshAttachment()
  if (attMod && typeof attMod.admitEncodedImages === 'function') {
    const refs = await attMod.admitEncodedImages(attachmentsSvc, normalized)
    return (Array.isArray(refs) ? refs : []).map(attachment => ({ type: 'image', attachment }))
  }

  if (typeof attachmentsSvc.saveImages === 'function') {
    const payload = normalized.map(img => ({
      data: Uint8Array.from(Buffer.from(img.data, 'base64')),
      mediaType: img.mediaType,
      name: img.name,
    }))
    const refs = await attachmentsSvc.saveImages(payload)
    return (Array.isArray(refs) ? refs : []).map(attachment => ({ type: 'image', attachment }))
  }

  throw new Error('attachments 服务缺少 saveImages / admitEncodedImages 接口')
}

let idSeq = 0

export function nextId(prefix) {
  idSeq = (idSeq + 1) % 1000000
  return prefix + '-' + Date.now().toString(36) + '-' + idSeq.toString(36)
}

export function clamp(value, max) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  return text.slice(0, Math.max(0, max - 1)) + '…'
}

export function cleanMultiline(value, max) {
  const text = String(value == null ? '' : value).replace(/\r/g, '').trim()
  if (text.length <= max) return text
  return text.slice(0, Math.max(0, max - 1)) + '…'
}

export function secretLike(text) {
  return SECRET_PATTERN.test(String(text || ''))
}

function chiefDir() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'chief')
}

function stateFilePath() {
  return path.join(chiefDir(), 'chief-state.json')
}

export function auditJsonlPath() {
  return safetyAuditJsonlPath()
}

function canonicalSortJsonValue(val) {
  if (val === null || val === undefined) return null
  if (Array.isArray(val)) return val.map(v => canonicalSortJsonValue(v))
  if (typeof val === 'object') {
    const out = {}
    for (const k of Object.keys(val).sort()) {
      const v = val[k]
      if (v !== undefined) out[k] = canonicalSortJsonValue(v)
    }
    return out
  }
  return val
}

export function computeApprovalPayloadHash(kind = 'tool', payload = {}) {
  const canonical = JSON.stringify(canonicalSortJsonValue({
    kind: String(kind || 'tool'),
    payload: payload && typeof payload === 'object' ? payload : {},
  }))
  return crypto.createHash('sha256').update(canonical).digest('hex')
}

function normalizeChiefRiskAck(raw) {
  if (!raw || typeof raw !== 'object' || raw.acknowledged !== true) return null
  const at = Number(raw.at) || 0
  if (at <= 0) return null
  return {
    acknowledged: true,
    at,
    by: clamp(raw.by || 'operator', 40),
    version: clamp(raw.version || '1.2.1', 20),
  }
}

export function hasValidChiefRiskAck(ws) {
  return Boolean(ws && ws.chiefRiskAck && ws.chiefRiskAck.acknowledged === true && Number(ws.chiefRiskAck.at) > 0)
}

function normalizePendingApproval(raw) {
  if (!raw || typeof raw !== 'object') return null
  const opLabel = clamp(raw.operationLabel || raw.operation || '', 80)
  if (!opLabel) return null
  const validStatuses = ['pending', 'approved', 'rejected', 'executed', 'failed', 'expired']
  const status = validStatuses.includes(raw.status) ? raw.status : 'pending'
  const validKinds = ['tool', 'relay', 'compact', 'auto_continue', 'archive_op', 'model_effort']
  const kind = validKinds.includes(raw.kind) ? raw.kind : 'tool'
  const validCategories = ['workspace_file', 'system_command', 'main_workflow', 'subagent_workflow']
  const category = validCategories.includes(raw.category) ? raw.category : 'workspace_file'
  const payload = raw.payload && typeof raw.payload === 'object' ? raw.payload : {}
  const payloadHash = typeof raw.payloadHash === 'string' && raw.payloadHash.trim()
    ? raw.payloadHash.trim()
    : computeApprovalPayloadHash(kind, payload)
  const taskId = clamp(raw.taskId || raw.resumeTaskId || '', 80)
  const capabilityScope = raw.capabilityScope && typeof raw.capabilityScope === 'object'
    ? raw.capabilityScope
    : buildCapabilityScope({
        kind,
        tool: payload.tool || kind,
        args: payload.args || {},
        cwd: payload.cwd || '',
        target: payload.target || '',
      })
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : nextId('apr'),
    status,
    category,
    operationLabel: opLabel,
    targetLabel: clamp(raw.targetLabel || raw.target || '', 120),
    reason: clamp(raw.reason || '', 240),
    impact: clamp(raw.impact || '', 220),
    preview: cleanMultiline(raw.preview || '', 420),
    kind,
    payload,
    payloadHash,
    capabilityScope,
    taskId,
    resumeTaskId: taskId,
    expiresAt: Math.max(0, Number(raw.expiresAt) || 0),
    dedupeKey: clamp(raw.dedupeKey || '', 120),
    by: clamp(raw.by || 'chief', 40),
    createdAt: Number(raw.createdAt) || Date.now(),
    resolvedAt: Number(raw.resolvedAt) || 0,
    resolvedBy: clamp(raw.resolvedBy || '', 40),
    resultMessage: clamp(raw.resultMessage || '', 260),
  }
}

function normalizePendingElevation(raw) {
  if (!raw || typeof raw !== 'object') return null
  if (raw.status && raw.status !== 'pending') return null
  const targetMode = normalizePermissionMode(raw.targetMode)
  if (targetMode === 'advisor') return null
  const createdAt = Number(raw.createdAt) || Date.now()
  const taskId = clamp(raw.taskId || raw.resumeTaskId || '', 80)
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : nextId('elv'),
    status: 'pending',
    fromMode: normalizePermissionMode(raw.fromMode || 'advisor'),
    targetMode,
    reason: clamp(raw.reason || '当前任务需要更高参谋权限才能继续执行', 260),
    requestedActionSummary: clamp(raw.requestedActionSummary || '', 220),
    requestedCapabilities: Array.isArray(raw.requestedCapabilities)
      ? raw.requestedCapabilities.map(c => clamp(c, 60)).filter(Boolean).slice(0, 12)
      : [],
    taskId,
    resumeTaskId: taskId,
    expiresAt: Math.max(0, Number(raw.expiresAt) || (createdAt + DEFAULT_RESUME_TTL_MS)),
    by: clamp(raw.by || 'chief', 40),
    createdAt,
  }
}

const VALID_TASK_LEDGER_STATUSES = [
  'proposed',
  'awaiting_elevation',
  'awaiting_approval',
  'awaiting_inquiry',
  'dispatched',
  'running',
  'resuming',
  'verifying',
  'completed',
  'interrupted',
  'rejected',
  'cancelled',
  'expired',
  'failed',
]

function normalizeTaskLedgerEntry(raw) {
  if (!raw || typeof raw !== 'object') return null
  const spec = raw.resumeSpec && typeof raw.resumeSpec === 'object' ? raw.resumeSpec : {}
  const originalText = cleanMultiline(spec.originalText || raw.originalText || '', 2000)
  if (!originalText) return null
  const status = VALID_TASK_LEDGER_STATUSES.includes(raw.status) ? raw.status : 'awaiting_approval'
  const createdAt = Number(raw.createdAt) || Date.now()
  const updatedAt = Number(raw.updatedAt) || createdAt
  const taskId = typeof (raw.taskId || raw.id) === 'string' && (raw.taskId || raw.id)
    ? String(raw.taskId || raw.id)
    : nextId('rtask')
  const validKinds = ['approval_resume', 'elevation_resume', 'tool_execution', 'inquiry', 'auto_continue']
  const kind = validKinds.includes(raw.kind)
    ? raw.kind
    : (raw.elevationId || status === 'awaiting_elevation' ? 'elevation_resume' : 'approval_resume')
  const forcedTarget = clamp(spec.forcedTarget !== undefined ? spec.forcedTarget : (raw.forcedTarget || ''), 64)
  const forcedModeRaw = spec.forcedMode !== undefined ? spec.forcedMode : raw.forcedMode
  const forcedMode = ['steer', 'followup', 'silent'].includes(forcedModeRaw) ? forcedModeRaw : 'steer'
  const rawImages = Array.isArray(spec.savedImagePaths) ? spec.savedImagePaths : raw.savedImagePaths
  const savedImagePaths = Array.isArray(rawImages)
    ? rawImages.slice(0, 4).filter(p => p && typeof p.path === 'string').map(p => ({
        index: Number(p.index) || 1,
        path: String(p.path),
        name: clamp(p.name || '', 80),
        mediaType: clamp(p.mediaType || '', 40),
        bytes: Math.max(0, Number(p.bytes) || 0),
      }))
    : []
  const rawCompleted = Array.isArray(spec.completedActions) ? spec.completedActions : raw.completedActions
  const completedActions = Array.isArray(rawCompleted)
    ? rawCompleted.map(x => clamp(x, 220)).filter(Boolean).slice(-12)
    : []
  const retryCount = Math.max(0, Math.min(4, Math.round(Number(raw.retryCount !== undefined ? raw.retryCount : raw.resumeDepth) || 0)))
  const capabilityScope = raw.capabilityScope && typeof raw.capabilityScope === 'object' ? raw.capabilityScope : null
  const payloadHash = typeof raw.payloadHash === 'string' ? raw.payloadHash.trim() : ''
  return {
    id: taskId,
    taskId,
    kind,
    status,
    capabilityScope,
    payloadHash,
    resumeSpec: {
      originalText,
      forcedTarget,
      forcedMode,
      savedImagePaths,
      completedActions,
    },
    originalText,
    forcedTarget,
    forcedMode,
    savedImagePaths,
    completedActions,
    pendingApprovalIds: Array.isArray(raw.pendingApprovalIds)
      ? [...new Set(raw.pendingApprovalIds.map(x => String(x || '').trim()).filter(Boolean))].slice(0, 12)
      : [],
    elevationId: clamp(raw.elevationId || '', 80),
    inquiryId: clamp(raw.inquiryId || '', 80),
    lastReceipt: cleanMultiline(raw.lastReceipt || '', 300),
    retryCount,
    resumeDepth: retryCount,
    createdAt,
    updatedAt,
    expiresAt: Math.max(0, Number(raw.expiresAt) || (createdAt + DEFAULT_RESUME_TTL_MS)),
    resolvedAt: Math.max(0, Number(raw.resolvedAt) || 0),
  }
}

export function recoverTaskLedgerEntriesOnDiskLoad(entries, now = Date.now()) {
  if (!Array.isArray(entries)) return []
  return entries.map((entry) => {
    if (!entry || typeof entry !== 'object') return entry
    const tid = entry.taskId || entry.id
    if (
      (entry.status === 'running' || entry.status === 'resuming' || entry.status === 'verifying')
      && !activeResumingTaskIds.has(tid)
    ) {
      return {
        ...entry,
        status: 'interrupted',
        updatedAt: now,
        lastReceipt: entry.lastReceipt || '检测到上次运行中断，已安全降级为 interrupted 等待人工确认续跑',
      }
    }
    if (
      (entry.status === 'proposed' || entry.status === 'awaiting_approval' || entry.status === 'awaiting_elevation' || entry.status === 'awaiting_inquiry')
      && entry.expiresAt > 0
      && now > entry.expiresAt
    ) {
      return {
        ...entry,
        status: 'expired',
        updatedAt: now,
        resolvedAt: entry.resolvedAt || now,
      }
    }
    return entry
  })
}

function normalizeAuditEntry(raw) {
  return normalizeAuditRecord(raw, DEFAULT_CHIEF_PERMISSION_MODE)
}

export function pushAuditToWs(ws, entry = {}, sessionId = '') {
  if (!ws || typeof ws !== 'object') return null
  if (!Array.isArray(ws.auditLog)) ws.auditLog = []
  const norm = normalizeAuditEntry(entry)
  if (!norm) return null
  ws.auditLog.push(norm)
  if (ws.auditLog.length > AUDIT_LOG_CAP) ws.auditLog = ws.auditLog.slice(-AUDIT_LOG_CAP)
  appendAuditJsonlRecord(norm, sessionId)
  return norm
}

function emptyWorkspace() {
  const sharedLedger = []
  return {
    config: null,
    chiefRiskAck: null,
    pendingApprovals: [],
    pendingElevation: null,
    taskLedger: sharedLedger,
    resumeTasks: sharedLedger,
    auditLog: [],
    facts: [],
    narrative: { hash: '', text: '', at: 0, byModel: '', clusterSig: '' },
    suggestions: [],
    inquiries: [],
    chat: [],
    mailbox: [],
    seenMailAt: {},
    seenFactsAt: {},
    reviewCursors: {},
    runtimeGuard: {
      lastCompactedSeq: 0,
      lastCompactedAt: 0,
      interventionTurns: 0,
      lastDigestHash: '',
      unchangedCount: 0,
      cooldownUntil: 0,
      circuitBroken: false,
      circuitReason: '',
      hazardAlert: null,
      lastGoalAchievedSig: '',
      autoPilotStartedAt: 0,
      autoPilotHadTurn: false,
      managedStartedAt: 0,
      lastActivityAt: 0,
      lastDreamRoamAt: 0,
      lastAutoArchiveOrgAt: 0,
    },
    flippedPrecipitatedIds: [],
    llmLedger: emptyLlmLedger(),
    alertEvents: [],
    bubbleHarnesses: [],
    bubbleLock: { manualLocked: false, lockedAt: 0, reason: '' },
  }
}

export function normalizeFact(raw) {
  if (!raw || typeof raw !== 'object') return null
  const text = clamp(raw.text, FACT_TEXT_MAX)
  if (!text || secretLike(text)) return null
  const validCategories = ['discipline', 'architecture', 'progress', 'preference', 'team']
  const category = validCategories.includes(raw.category) ? raw.category : 'discipline'
  const peerRootIds = Array.isArray(raw.peerRootIds)
    ? [...new Set(raw.peerRootIds.map(x => String(x || '').trim()).filter(Boolean))].slice(0, 16)
    : []
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : nextId('fact'),
    text,
    category,
    by: clamp(raw.by || 'chief', 36),
    source: clamp(raw.source || '', 60),
    originRootId: typeof raw.originRootId === 'string' ? raw.originRootId.trim() : '',
    ...(peerRootIds.length ? { peerRootIds } : {}),
    pinned: Boolean(raw.pinned),
    addedAt: Number(raw.addedAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Number(raw.addedAt) || Date.now(),
  }
}

export function normalizeSuggestion(raw) {
  if (!raw || typeof raw !== 'object') return null
  const title = clamp(raw.title, 90)
  if (!title) return null
  const kind = ['bound', 'board', 'goal_approval', 'relay', 'advice', 'guard_wall', 'wall_removal', 'archive_op', 'model_effort'].includes(raw.kind) ? raw.kind : 'relay'
  const boundField = ['forbidden', 'allowed', 'notes'].includes(raw.boundField) ? raw.boundField : 'forbidden'
  const replaces = Array.isArray(raw.replaces)
    ? raw.replaces.map(x => String(x || '').trim()).filter(Boolean).slice(0, 20)
    : []
  const wallSpec = raw.wallSpec && typeof raw.wallSpec === 'object' ? { ...raw.wallSpec } : null
  const wallRemovalSpec = raw.wallRemovalSpec && typeof raw.wallRemovalSpec === 'object' ? { ...raw.wallRemovalSpec } : null
  const archiveSpec = (raw.archiveSpec && typeof raw.archiveSpec === 'object')
    ? { ...raw.archiveSpec }
    : ((raw.archiveOp && typeof raw.archiveOp === 'object') ? { ...raw.archiveOp } : null)
  const effortSpec = (raw.effortSpec && typeof raw.effortSpec === 'object')
    ? { ...raw.effortSpec }
    : ((raw.effortOp && typeof raw.effortOp === 'object') ? { ...raw.effortOp } : null)
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : nextId('sug'),
    kind,
    boundField,
    replaces,
    pinGlobal: Boolean(raw.pinGlobal),
    ...(wallSpec ? { wallSpec } : {}),
    ...(wallRemovalSpec ? { wallRemovalSpec } : {}),
    ...(archiveSpec ? { archiveSpec } : {}),
    ...(effortSpec ? { effortSpec } : {}),
    fromAgent: clamp(raw.fromAgent || '', 48),
    title,
    reason: clamp(raw.reason || '', 220),
    target: clamp(raw.target || (kind === 'bound' ? 'bounds' : (kind === 'guard_wall' || kind === 'wall_removal') ? 'guard_walls' : kind === 'goal_approval' ? 'board' : kind === 'archive_op' ? 'archive' : kind === 'model_effort' ? 'lead' : 'lead'), 64),
    targetLabel: clamp(raw.targetLabel || raw.target || (kind === 'bound' ? '工作边界' : kind === 'guard_wall' ? '物理驻墙' : kind === 'wall_removal' ? '物理驻墙拆墙申请' : kind === 'goal_approval' ? '目标结项批示' : kind === 'advice' ? '参谋进言' : kind === 'archive_op' ? '档案与桌面调配' : kind === 'model_effort' ? '模型思考强度调节' : '主对话'), 40),
    mode: ['steer', 'followup', 'silent'].includes(raw.mode) ? raw.mode : (kind === 'advice' ? 'followup' : 'steer'),
    draftText: cleanMultiline(raw.draftText || '', 600),
    evidence: cleanMultiline(raw.evidence || '', 600),
    missing: clamp(raw.missing || '', 300),
    boardOp: raw.boardOp && typeof raw.boardOp === 'object' ? raw.boardOp : null,
    popup: Boolean(raw.popup || kind === 'advice' || kind === 'wall_removal'),
    urgency: ['normal', 'high'].includes(raw.urgency) ? raw.urgency : (kind === 'wall_removal' ? 'high' : 'normal'),
    status: ['pending', 'applied', 'dismissed'].includes(raw.status) ? raw.status : 'pending',
    createdAt: Number(raw.createdAt) || Date.now(),
  }
}

export function normalizeInquiryItem(raw) {
  if (!raw || typeof raw !== 'object') return null
  const question = cleanMultiline(raw.question || raw.text || '', 600)
  if (!question) return null
  const status = ['pending', 'delivered', 'answered', 'expired'].includes(raw.status) ? raw.status : 'pending'
  const inquiryId = typeof (raw.inquiryId || raw.id) === 'string' && (raw.inquiryId || raw.id)
    ? String(raw.inquiryId || raw.id)
    : nextId('inq')
  return {
    id: inquiryId,
    inquiryId,
    taskId: clamp(raw.taskId || '', 80),
    target: clamp(raw.target || 'lead', 64),
    question,
    context: clamp(raw.context || '', 220),
    answer: cleanMultiline(raw.answer || '', 1200),
    status,
    by: clamp(raw.by || 'chief', 40),
    answeredBy: clamp(raw.answeredBy || '', 40),
    createdAt: Number(raw.createdAt) || Date.now(),
    deliveredAt: Number(raw.deliveredAt) || 0,
    answeredAt: Number(raw.answeredAt) || 0,
    expiresAt: Number(raw.expiresAt) || ((Number(raw.createdAt) || Date.now()) + DEFAULT_RESUME_TTL_MS),
  }
}

export function normalizeMail(raw) {
  if (!raw || typeof raw !== 'object') return null
  const imageCount = Math.max(0, Math.round(Number(raw.imageCount) || 0))
  const text = cleanMultiline(raw.text, 1500) || (imageCount > 0 ? `[附图 ×${imageCount}]` : '')
  if (!text) return null
  const participantRoots = Array.isArray(raw.participantRoots)
    ? [...new Set(raw.participantRoots.map(x => String(x || '').trim()).filter(Boolean))].sort().slice(0, 24)
    : []
  const validChannels = ['internal', 'pair', 'multi', 'broadcast']
  const channelType = validChannels.includes(raw.channelType) ? raw.channelType : ''
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : nextId('mail'),
    from: clamp(raw.from || 'agent', 48),
    fromSession: String(raw.fromSession || ''),
    fromRootId: String(raw.fromRootId || ''),
    to: clamp(raw.to || 'lead', 64),
    toSession: String(raw.toSession || ''),
    toRootId: String(raw.toRootId || ''),
    ...(participantRoots.length ? { participantRoots } : {}),
    ...(channelType ? { channelType } : {}),
    ...(raw.broadcastId ? { broadcastId: String(raw.broadcastId) } : {}),
    subject: clamp(raw.subject || '', 80),
    text,
    ...(imageCount > 0 ? { imageCount } : {}),
    mode: ['steer', 'followup', 'silent'].includes(raw.mode) ? raw.mode : 'steer',
    deliveredPhysical: Boolean(raw.deliveredPhysical),
    readBy: Array.isArray(raw.readBy) ? raw.readBy.map(String).slice(0, 32) : [],
    at: Number(raw.at) || Date.now(),
  }
}

function normalizeWorkspace(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const base = emptyWorkspace()
  base.facts = (Array.isArray(src.facts) ? src.facts : []).map(normalizeFact).filter(Boolean).slice(-FACTS_CAP)
  if (src.narrative && typeof src.narrative === 'object') {
    base.narrative = {
      hash: String(src.narrative.hash || ''),
      text: String(src.narrative.text || ''),
      at: Number(src.narrative.at) || 0,
      byModel: String(src.narrative.byModel || ''),
      clusterSig: String(src.narrative.clusterSig || ''),
    }
  }
  base.suggestions = (Array.isArray(src.suggestions) ? src.suggestions : [])
    .map(normalizeSuggestion)
    .filter(Boolean)
    .slice(-SUGGESTIONS_CAP * 2)
  base.inquiries = (Array.isArray(src.inquiries) ? src.inquiries : [])
    .map(normalizeInquiryItem)
    .filter(Boolean)
    .slice(-24)
  base.chat = (Array.isArray(src.chat) ? src.chat : [])
    .filter(item => item && typeof item === 'object' && typeof item.text === 'string')
    .slice(-CHAT_CAP)
    .map(item => {
      const imageCount = Math.max(0, Math.round(Number(item.imageCount) || 0))
      const kind = item.kind === 'receipt' ? 'receipt' : (item.kind === 'qa' ? 'qa' : '')
      const resumeTaskId = item.resumeTaskId ? String(item.resumeTaskId) : ''
      const thinkingEffort = typeof item.thinkingEffort === 'string' && item.thinkingEffort ? item.thinkingEffort : ''
      const thinkingEffortMode = item.thinkingEffortMode === 'auto' || item.thinkingEffortMode === 'manual' ? item.thinkingEffortMode : ''
      return {
        id: String(item.id || nextId('chat')),
        role: item.role === 'user' ? 'user' : 'chief',
        text: cleanMultiline(item.text, 2000),
        target: item.target ? String(item.target) : '',
        ...(kind ? { kind } : {}),
        ...(resumeTaskId ? { resumeTaskId } : {}),
        ...(thinkingEffort ? { thinkingEffort } : {}),
        ...(thinkingEffortMode ? { thinkingEffortMode } : {}),
        ...(item.isOneStopReport ? { isOneStopReport: true } : {}),
        ...(imageCount > 0 ? { imageCount } : {}),
        actions: Array.isArray(item.actions) ? item.actions.slice(0, 8) : [],
        at: Number(item.at) || Date.now(),
      }
    })
  base.mailbox = (Array.isArray(src.mailbox) ? src.mailbox : []).map(normalizeMail).filter(Boolean).slice(-MAIL_CAP)
  base.seenMailAt = src.seenMailAt && typeof src.seenMailAt === 'object' ? { ...src.seenMailAt } : {}
  base.seenFactsAt = src.seenFactsAt && typeof src.seenFactsAt === 'object' ? { ...src.seenFactsAt } : {}
  base.reviewCursors = src.reviewCursors && typeof src.reviewCursors === 'object' ? { ...src.reviewCursors } : {}
  const rg = src.runtimeGuard && typeof src.runtimeGuard === 'object' ? src.runtimeGuard : {}
  base.runtimeGuard = {
    lastCompactedSeq: Math.max(0, Math.round(Number(rg.lastCompactedSeq) || 0)),
    lastCompactedAt: Math.max(0, Number(rg.lastCompactedAt) || 0),
    autoCompactCount: Math.max(0, Math.round(Number(rg.autoCompactCount) || 0)),
    pendingSmartCompact: rg.pendingSmartCompact && typeof rg.pendingSmartCompact === 'object'
      ? {
          at: Number(rg.pendingSmartCompact.at) || Date.now(),
          reason: clamp(rg.pendingSmartCompact.reason || '', 240),
          by: clamp(rg.pendingSmartCompact.by || 'lead', 40),
        }
      : null,
    interventionTurns: Math.max(0, Math.round(Number(rg.interventionTurns) || 0)),
    lastDigestHash: String(rg.lastDigestHash || ''),
    unchangedCount: Math.max(0, Math.round(Number(rg.unchangedCount) || 0)),
    cooldownUntil: Math.max(0, Number(rg.cooldownUntil) || 0),
    circuitBroken: Boolean(rg.circuitBroken),
    circuitReason: String(rg.circuitReason || ''),
    hazardAlert: rg.hazardAlert && typeof rg.hazardAlert === 'object' && (rg.hazardAlert.reason || rg.hazardAlert.title)
      ? {
          id: String(rg.hazardAlert.id || ''),
          category: clamp(rg.hazardAlert.category || 'irreversible_risk', 40),
          title: clamp(rg.hazardAlert.title || '强介入安全煞停', 120),
          reason: cleanMultiline(rg.hazardAlert.reason || '', 600),
          objective: clamp(rg.hazardAlert.objective || '', 300),
          at: Math.max(0, Number(rg.hazardAlert.at) || 0),
        }
      : null,
    lastGoalAchievedSig: String(rg.lastGoalAchievedSig || ''),
    autoPilotStartedAt: Math.max(0, Number(rg.autoPilotStartedAt) || 0),
    autoPilotHadTurn: Boolean(rg.autoPilotHadTurn),
    managedStartedAt: Math.max(0, Number(rg.managedStartedAt) || Number(rg.autoPilotStartedAt) || 0),
    lastActivityAt: Math.max(0, Number(rg.lastActivityAt) || 0),
    lastDreamRoamAt: Math.max(0, Number(rg.lastDreamRoamAt) || 0),
    lastAutoArchiveOrgAt: Math.max(0, Number(rg.lastAutoArchiveOrgAt) || 0),
  }
  base.chiefRiskAck = normalizeChiefRiskAck(src.chiefRiskAck)
  base.pendingApprovals = (Array.isArray(src.pendingApprovals) ? src.pendingApprovals : [])
    .map(normalizePendingApproval)
    .filter(Boolean)
    .slice(-APPROVALS_CAP)
  base.pendingElevation = normalizePendingElevation(src.pendingElevation)
  const rawLedgerSrc = Array.isArray(src.taskLedger) && src.taskLedger.length > 0
    ? src.taskLedger
    : (Array.isArray(src.resumeTasks) ? src.resumeTasks : [])
  const normalizedLedger = rawLedgerSrc
    .map(normalizeTaskLedgerEntry)
    .filter(Boolean)
    .slice(-TASK_LEDGER_CAP)
  base.taskLedger = normalizedLedger
  base.resumeTasks = normalizedLedger
  base.auditLog = (Array.isArray(src.auditLog) ? src.auditLog : [])
    .map(normalizeAuditEntry)
    .filter(Boolean)
    .slice(-AUDIT_LOG_CAP)
  const ackOk = hasValidChiefRiskAck(base)
  if (src.config && typeof src.config === 'object') {
    const validPaces = ['manual', 'smart', 'auto', 'stopped']
    const pm = validPaces.includes(src.config.paceMode) ? src.config.paceMode : undefined
    const rawStopped = typeof src.config.stopped === 'boolean' ? src.config.stopped : (pm === 'stopped')
    const rm = normalizeRunMode(src.config.runMode, { ...src.config, stopped: rawStopped, paceMode: pm })
    const rawPerm = typeof src.config.permissionMode === 'string'
      ? normalizePermissionMode(src.config.permissionMode, { requireAck: true, hasChiefRiskAck: ackOk })
      : DEFAULT_CHIEF_PERMISSION_MODE
    const plugCheck = validatePolicyPluginList(src.config.policyPlugins)
    const policyPlugins = plugCheck.ok ? plugCheck.plugins : []
    const lockedModelEfforts = normalizeLockedModelEfforts(src.config.lockedModelEfforts)
    const managedIdleTimeoutMs = Number.isFinite(Number(src.config.managedIdleTimeoutMs)) && Number(src.config.managedIdleTimeoutMs) >= 50
      ? Math.min(2 * 60 * 60 * 1000, Math.round(Number(src.config.managedIdleTimeoutMs)))
      : DEFAULT_MANAGED_IDLE_TIMEOUT_MS
    base.config = {
      ...(typeof src.config.modelRef === 'string' ? { modelRef: src.config.modelRef.trim() } : {}),
      permissionMode: rawPerm,
      runMode: rm,
      managedIdleTimeoutMs,
      ...(typeof src.config.notifyEnabled === 'boolean' ? { notifyEnabled: src.config.notifyEnabled } : {}),
      ...(typeof src.config.notifySound === 'boolean' ? { notifySound: src.config.notifySound } : {}),
      ...(typeof src.config.uiLang === 'string' ? { uiLang: normalizeUiLang(src.config.uiLang) } : {}),
      ...(src.config.managedBudgetMaxCalls !== undefined ? { managedBudgetMaxCalls: normalizeManagedBudgetCalls(src.config.managedBudgetMaxCalls) } : {}),
      ...(src.config.managedBudgetMaxTokens !== undefined ? { managedBudgetMaxTokens: normalizeManagedBudgetTokens(src.config.managedBudgetMaxTokens) } : {}),
      ...(typeof src.config.thinkingEffort === 'string' ? { thinkingEffort: normalizeThinkingEffort(src.config.thinkingEffort) } : {}),
      ...(typeof src.config.teamEffortMode === 'string' ? { teamEffortMode: normalizeTeamEffortMode(src.config.teamEffortMode) } : {}),
      ...(Object.keys(lockedModelEfforts).length ? { lockedModelEfforts } : {}),
      ...(typeof src.config.stopped === 'boolean' || pm === 'stopped' ? { stopped: rawStopped } : {}),
      ...(pm ? { paceMode: pm, autoPilot: !rawStopped && pm === 'auto', autoReview: !rawStopped && pm !== 'manual' } : {}),
      ...(policyPlugins.length > 0 ? { policyPlugins } : {}),
      ...(src.config.tacticalModes && typeof src.config.tacticalModes === 'object'
        ? { tacticalModes: normalizeTacticalModes(src.config.tacticalModes) }
        : {}),
    }
  }
  base.flippedPrecipitatedIds = Array.isArray(src.flippedPrecipitatedIds)
    ? [...new Set(src.flippedPrecipitatedIds.map(x => String(x || '').trim()).filter(Boolean))].slice(0, 20)
    : []
  base.llmLedger = normalizeLlmLedger(src.llmLedger)
  base.alertEvents = (Array.isArray(src.alertEvents) ? src.alertEvents : [])
    .map(normalizeAlertEvent)
    .filter(Boolean)
    .slice(-ALERT_EVENTS_CAP)
  const rawHarnesses = Array.isArray(src.bubbleHarnesses) ? src.bubbleHarnesses : []
  const seenHarnesses = new Set()
  base.bubbleHarnesses = []
  for (const hItem of rawHarnesses) {
    const normH = normalizeBubbleHarness(hItem)
    if (!normH || seenHarnesses.has(normH.provider)) continue
    seenHarnesses.add(normH.provider)
    base.bubbleHarnesses.push(normH)
    if (base.bubbleHarnesses.length >= 12) break
  }
  const rawBl = src.bubbleLock && typeof src.bubbleLock === 'object' ? src.bubbleLock : {}
  base.bubbleLock = {
    manualLocked: Boolean(rawBl.manualLocked),
    lockedAt: Math.max(0, Number(rawBl.lockedAt) || 0),
    reason: clamp(rawBl.reason || '', 120),
  }
  return base
}

export const COMPACT_THRESHOLD_MIN_PCT = 10

export const COMPACT_THRESHOLD_MAX_PCT = 95

export const COMPACT_PCT_WARN_FLOOR = 25

export const COMPACT_TOKEN_HARD_MIN = 8_000

export const COMPACT_TOKEN_WARN_FLOOR = 32_000

/** Format a token threshold cleanly into compact K/M display notation (e.g. `64K`, `1M`). */
export function formatCompactTokenShort(tokens) {
  const n = Math.max(0, Math.round(Number(tokens) || 0))
  if (n >= 1_000_000 && n % 100_000 === 0) {
    const m = n / 1_000_000
    return (Number.isInteger(m) ? String(m) : m.toFixed(1).replace(/\.0$/, '')) + 'M'
  }
  if (n >= 1_000) {
    const k = n / 1_000
    return (k >= 100 ? String(Math.round(k)) : k.toFixed(1).replace(/\.0$/, '')) + 'K'
  }
  return String(n)
}

/**
 * Parse custom context size threshold input (`'1M'` -> 1,000,000; `'64K'` -> 64,000; bare `'64'` -> `64K`).
 * Bare numbers without a unit default to K, and values below `32K` attach a low-threshold warning.
 */
export function parseCompactTokensInput(rawInput) {
  const s = String(rawInput ?? '').trim()
  if (!s) return { ok: false, error: '请输入上下文阈值，例如 64K、1M 或纯数字（无单位默认为 K）' }
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(k|m|t|tokens?)?$/i)
  if (!m) return { ok: false, error: '格式无效：支持如 64K、1M 或纯数字（无单位默认为 K）' }
  const num = Number(m[1])
  if (!Number.isFinite(num) || num <= 0) return { ok: false, error: '上下文阈值必须大于 0' }
  const unit = (m[2] || 'k').toLowerCase()
  let rawTokens = 0
  if (unit === 'm') rawTokens = Math.round(num * 1_000_000)
  else if (unit === 'k') rawTokens = Math.round(num * 1_000)
  else rawTokens = Math.round(num)
  const tokens = Math.max(COMPACT_TOKEN_HARD_MIN, rawTokens)
  const displayInput = formatCompactTokenShort(tokens)
  const lowWarning = tokens < COMPACT_TOKEN_WARN_FLOOR
    ? `当前阈值（${displayInput}）低于安全建议线 32K，可能导致上下文频繁压缩丢失现场细节`
    : ''
  return {
    ok: true,
    tokens,
    rawTokens,
    clampedToMin: rawTokens < COMPACT_TOKEN_HARD_MIN,
    displayInput,
    lowWarning,
  }
}

/** Resolve effective Chief config for a specific root session (isolates `intervention` and `permissionMode` per session). */
export function resolveWorkspaceConfig(state, sessionId = '') {
  const safeState = state && typeof state === 'object' ? state : {}
  const base = safeState.config && typeof safeState.config === 'object' ? safeState.config : {}
  const baseTactical = normalizeTacticalModes(base.tacticalModes)
  const sid = String(sessionId || '').trim()
  const ws = sid && safeState.workspaces && safeState.workspaces[sid] ? safeState.workspaces[sid] : null
  const wsCfg = ws && ws.config && typeof ws.config === 'object' ? ws.config : null
  const validPaces = ['manual', 'smart', 'auto', 'stopped']
  const basePaceSafe = validPaces.includes(base.paceMode) && !(sid && base.paceMode === 'auto')
    ? base.paceMode
    : 'manual'
  const rawPaceMode = wsCfg && validPaces.includes(wsCfg.paceMode)
    ? wsCfg.paceMode
    : basePaceSafe
  const explicitStopped = wsCfg && typeof wsCfg.stopped === 'boolean'
    ? wsCfg.stopped
    : (typeof base.stopped === 'boolean' ? base.stopped : false)
  const stopped = rawPaceMode === 'stopped' || explicitStopped
  const paceMode = stopped ? 'stopped' : rawPaceMode
  const modelRef = wsCfg && typeof wsCfg.modelRef === 'string'
    ? wsCfg.modelRef.trim()
    : (typeof base.modelRef === 'string' ? base.modelRef.trim() : '')
  const mergedTactical = wsCfg && wsCfg.tacticalModes
    ? normalizeTacticalModes({ ...baseTactical, ...wsCfg.tacticalModes })
    : { ...baseTactical, ...(sid ? { intervention: false } : {}) }
  const ackOk = hasValidChiefRiskAck(ws)
  const rawPerm = (wsCfg && typeof wsCfg.permissionMode === 'string')
    ? wsCfg.permissionMode
    : DEFAULT_CHIEF_PERMISSION_MODE
  const globalPlugCheck = validatePolicyPluginList(base.policyPlugins)
  const wsPlugCheck = validatePolicyPluginList(wsCfg && wsCfg.policyPlugins)
  const policyPlugins = [
    ...(globalPlugCheck.ok ? globalPlugCheck.plugins : []),
    ...(wsPlugCheck.ok ? wsPlugCheck.plugins : []),
  ]
  const resolvedRoleCaps = resolveRoleCapabilities(rawPerm, {
    hasChiefRiskAck: ackOk,
    policyPlugins,
  })
  const permissionMode = resolvedRoleCaps.role
  const chiefRiskVerified = permissionMode === 'chief' ? ackOk : false
  const runMode = stopped
    ? 'off'
    : (wsCfg && typeof wsCfg.runMode === 'string' && CHIEF_RUN_MODES.includes(wsCfg.runMode)
        ? wsCfg.runMode
        : normalizeRunMode(undefined, { stopped, paceMode, autoPilot: paceMode === 'auto' }))
  const thinkingEffort = normalizeThinkingEffort(
    (wsCfg && typeof wsCfg.thinkingEffort === 'string' && wsCfg.thinkingEffort)
      || (typeof base.thinkingEffort === 'string' && base.thinkingEffort)
      || 'auto',
  )
  const teamEffortMode = normalizeTeamEffortMode(
    (wsCfg && typeof wsCfg.teamEffortMode === 'string' && wsCfg.teamEffortMode)
      || (typeof base.teamEffortMode === 'string' && base.teamEffortMode)
      || 'auto',
  )
  const lockedModelEfforts = normalizeLockedModelEfforts(wsCfg && wsCfg.lockedModelEfforts)
  const managedIdleTimeoutMs = wsCfg && Number.isFinite(Number(wsCfg.managedIdleTimeoutMs)) && Number(wsCfg.managedIdleTimeoutMs) >= 50
    ? Math.min(2 * 60 * 60 * 1000, Math.round(Number(wsCfg.managedIdleTimeoutMs)))
    : (Number.isFinite(Number(base.managedIdleTimeoutMs)) && Number(base.managedIdleTimeoutMs) >= 50
        ? Math.min(2 * 60 * 60 * 1000, Math.round(Number(base.managedIdleTimeoutMs)))
        : DEFAULT_MANAGED_IDLE_TIMEOUT_MS)
  const notifyEnabled = typeof (wsCfg && wsCfg.notifyEnabled) === 'boolean'
    ? wsCfg.notifyEnabled
    : (typeof base.notifyEnabled === 'boolean' ? base.notifyEnabled : true)
  const notifySound = typeof (wsCfg && wsCfg.notifySound) === 'boolean'
    ? wsCfg.notifySound
    : (typeof base.notifySound === 'boolean' ? base.notifySound : false)
  const uiLang = normalizeUiLang(
    (wsCfg && typeof wsCfg.uiLang === 'string' && wsCfg.uiLang)
      || (typeof base.uiLang === 'string' && base.uiLang)
      || 'auto',
  )
  const managedBudgetMaxCalls = (wsCfg && wsCfg.managedBudgetMaxCalls !== undefined)
    ? normalizeManagedBudgetCalls(wsCfg.managedBudgetMaxCalls)
    : (base.managedBudgetMaxCalls !== undefined
        ? normalizeManagedBudgetCalls(base.managedBudgetMaxCalls)
        : DEFAULT_MANAGED_BUDGET_MAX_CALLS)
  const managedBudgetMaxTokens = (wsCfg && wsCfg.managedBudgetMaxTokens !== undefined)
    ? normalizeManagedBudgetTokens(wsCfg.managedBudgetMaxTokens)
    : (base.managedBudgetMaxTokens !== undefined
        ? normalizeManagedBudgetTokens(base.managedBudgetMaxTokens)
        : DEFAULT_MANAGED_BUDGET_MAX_TOKENS)
  return {
    modelRef,
    paceMode,
    runMode,
    managedIdleTimeoutMs,
    notifyEnabled,
    notifySound,
    uiLang,
    managedBudgetMaxCalls,
    managedBudgetMaxTokens,
    thinkingEffort,
    teamEffortMode,
    lockedModelEfforts,
    stopped,
    permissionMode,
    capabilities: resolvedRoleCaps.capabilities,
    policyPlugins,
    chiefRiskVerified,
    autoPilot: !stopped && runMode === 'managed',
    autoReview: !stopped && runMode === 'managed',
    tacticalModes: mergedTactical,
  }
}

const DEFAULT_TACTICAL_MODES = {
  intervention: false,
  autoCompact: false,
  smartCompact: false,
  compactThresholdMode: 'pct',
  compactThresholdPct: 80,
  compactThresholdTokens: 64_000,
  compactThresholdInput: '64K',
  strictVerify: false,
  redlineSentinel: false,
  conciseBrief: false,
  maxInterventionTurns: 10,
}

export function normalizeTacticalModes(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const pct = Math.round(Number(src.compactThresholdPct) || DEFAULT_TACTICAL_MODES.compactThresholdPct)
  const mode = src.compactThresholdMode === 'tokens' ? 'tokens' : 'pct'
  const rawTokens = Math.round(Number(src.compactThresholdTokens) || DEFAULT_TACTICAL_MODES.compactThresholdTokens)
  const compactThresholdTokens = Math.max(COMPACT_TOKEN_HARD_MIN, rawTokens)
  const compactThresholdInput = typeof src.compactThresholdInput === 'string' && src.compactThresholdInput.trim()
    ? src.compactThresholdInput.trim()
    : formatCompactTokenShort(compactThresholdTokens)
  const rawTurns = src.maxInterventionTurns
  const isZeroTurns = rawTurns === 0 || rawTurns === '0'
  const parsedTurns = isZeroTurns
    ? 0
    : Math.min(30, Math.max(1, Math.round(Number(rawTurns) || DEFAULT_TACTICAL_MODES.maxInterventionTurns)))
  return {
    intervention: Boolean(src.intervention),
    autoCompact: Boolean(src.autoCompact),
    smartCompact: Boolean(src.smartCompact),
    compactThresholdMode: mode,
    compactThresholdPct: Math.min(COMPACT_THRESHOLD_MAX_PCT, Math.max(COMPACT_THRESHOLD_MIN_PCT, pct)),
    compactThresholdTokens,
    compactThresholdInput,
    strictVerify: Boolean(src.strictVerify),
    redlineSentinel: Boolean(src.redlineSentinel),
    conciseBrief: Boolean(src.conciseBrief),
    maxInterventionTurns: parsedTurns,
  }
}

function normalizeState(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const cfg = src.config && typeof src.config === 'object' ? src.config : {}
  const links = {}
  if (src.links && typeof src.links === 'object') {
    for (const [k, list] of Object.entries(src.links)) {
      if (!k || !Array.isArray(list)) continue
      const clean = [...new Set(list.map(v => String(v || '').trim()).filter(v => v && v !== k))]
      if (clean.length) links[k] = clean
    }
  }
  const workspaces = {}
  if (src.workspaces && typeof src.workspaces === 'object') {
    for (const [k, ws] of Object.entries(src.workspaces)) {
      if (!k) continue
      workspaces[k] = normalizeWorkspace(ws)
    }
  }
  const validPaces = ['manual', 'smart', 'auto', 'stopped']
  // Default to 'manual' (human-paced, zero background token burn) unless explicitly set to smart/auto
  const rawPace = validPaces.includes(cfg.paceMode) ? cfg.paceMode : 'manual'
  const stopped = rawPace === 'stopped' || Boolean(cfg.stopped)
  const paceMode = stopped ? 'stopped' : rawPace
  const globalPlugRes = validatePolicyPluginList(cfg.policyPlugins)
  return {
    version: STATE_VERSION,
    config: {
      modelRef: typeof cfg.modelRef === 'string' ? cfg.modelRef.trim() : '',
      paceMode,
      runMode: stopped ? 'off' : normalizeRunMode(cfg.runMode, { stopped, paceMode }),
      managedIdleTimeoutMs: Number.isFinite(Number(cfg.managedIdleTimeoutMs)) && Number(cfg.managedIdleTimeoutMs) >= 50
        ? Math.min(2 * 60 * 60 * 1000, Math.round(Number(cfg.managedIdleTimeoutMs)))
        : DEFAULT_MANAGED_IDLE_TIMEOUT_MS,
      notifyEnabled: typeof cfg.notifyEnabled === 'boolean' ? cfg.notifyEnabled : true,
      notifySound: typeof cfg.notifySound === 'boolean' ? cfg.notifySound : false,
      uiLang: normalizeUiLang(cfg.uiLang),
      managedBudgetMaxCalls: normalizeManagedBudgetCalls(cfg.managedBudgetMaxCalls),
      managedBudgetMaxTokens: normalizeManagedBudgetTokens(cfg.managedBudgetMaxTokens),
      thinkingEffort: normalizeThinkingEffort(cfg.thinkingEffort),
      teamEffortMode: normalizeTeamEffortMode(cfg.teamEffortMode),
      stopped,
      permissionMode: DEFAULT_CHIEF_PERMISSION_MODE,
      autoPilot: !stopped && paceMode === 'auto',
      autoReview: !stopped && paceMode !== 'manual',
      ...(globalPlugRes.ok && globalPlugRes.plugins.length > 0 ? { policyPlugins: globalPlugRes.plugins } : {}),
      tacticalModes: normalizeTacticalModes(cfg.tacticalModes),
    },
    links,
    workspaces,
  }
}

export function appendChiefAuditLog(sessionId = 'global', entry = {}) {
  const rootId = String(sessionId || 'global').trim() || 'global'
  return mutateChiefState((state) => {
    const ws = ensureWorkspace(state, rootId)
    return pushAuditToWs(ws, entry, rootId)
  })
}

export function enqueueApprovalToWs(ws, item = {}) {
  if (!ws || typeof ws !== 'object') return null
  if (!Array.isArray(ws.pendingApprovals)) ws.pendingApprovals = []
  const dKey = clamp(item.dedupeKey || '', 120)
  if (dKey) {
    const existing = ws.pendingApprovals.find(a => a && a.status === 'pending' && a.dedupeKey === dKey)
    if (existing) return existing
  }
  const kind = item.kind || 'tool'
  const payload = item.payload && typeof item.payload === 'object' ? item.payload : {}
  const now = Date.now()
  const norm = normalizePendingApproval({
    ...item,
    status: 'pending',
    dedupeKey: dKey,
    payloadHash: computeApprovalPayloadHash(kind, payload),
    expiresAt: Number(item.expiresAt) || (now + DEFAULT_RESUME_TTL_MS),
  })
  if (!norm) return null
  ws.pendingApprovals.push(norm)
  if (ws.pendingApprovals.length > APPROVALS_CAP) {
    ws.pendingApprovals = ws.pendingApprovals.slice(-APPROVALS_CAP)
  }
  pushAlertEventToWs(ws, {
    kind: 'pending_approval',
    level: 'warn',
    title: '🔐 等待人类逐项审批',
    body: clamp(`${norm.operationLabel}${norm.targetLabel ? ' · ' + norm.targetLabel : ''}`, 180),
    dedupeKey: 'apr:' + norm.id,
    at: now,
  })
  return norm
}

export function queueChiefApproval(sessionId = 'global', item = {}) {
  const rootId = String(sessionId || 'global').trim() || 'global'
  return mutateChiefState((state) => {
    const ws = ensureWorkspace(state, rootId)
    return enqueueApprovalToWs(ws, item)
  })
}

export function enqueueElevationToWs(ws, req = {}) {
  if (!ws || typeof ws !== 'object') return null
  const currentMode = normalizePermissionMode(
    ws.config && ws.config.permissionMode ? ws.config.permissionMode : DEFAULT_CHIEF_PERMISSION_MODE,
    { requireAck: true, hasChiefRiskAck: hasValidChiefRiskAck(ws) },
  )
  const targetMode = normalizePermissionMode(req.targetMode || 'strategist')
  if (permissionRank(targetMode) <= permissionRank(currentMode)) return null
  const now = Date.now()
  const norm = normalizePendingElevation({
    fromMode: currentMode,
    targetMode,
    reason: req.reason || 'Agent 申请提升权限以继续当前任务',
    requestedActionSummary: req.requestedActionSummary || '',
    resumeTaskId: req.resumeTaskId || '',
    expiresAt: Number(req.expiresAt) || (now + DEFAULT_RESUME_TTL_MS),
    by: req.by || 'chief',
  })
  if (!norm) return null
  ws.pendingElevation = norm
  pushAuditToWs(ws, {
    mode: currentMode,
    stage: 'permission_gate',
    decision: 'elevation_requested',
    operation: '申请提权',
    target: `${CHIEF_PERMISSION_META[currentMode].level} -> ${CHIEF_PERMISSION_META[targetMode].level}`,
    reason: norm.reason,
    outcome: 'pending',
    by: norm.by,
  }, req.sessionId || '')
  pushAlertEventToWs(ws, {
    kind: 'pending_elevation',
    level: 'warn',
    title: '⬆️ 参谋申请提权',
    body: clamp(`${CHIEF_PERMISSION_META[currentMode].level} -> ${CHIEF_PERMISSION_META[targetMode].level}：${norm.reason}`, 180),
    dedupeKey: 'elv:' + norm.id,
    at: now,
  })
  return norm
}

export function requestChiefElevation(sessionId = 'global', req = {}) {
  const rootId = String(sessionId || 'global').trim() || 'global'
  return mutateChiefState((state) => {
    const ws = ensureWorkspace(state, rootId)
    return enqueueElevationToWs(ws, { ...(req && typeof req === 'object' ? req : {}), sessionId: rootId })
  })
}

export function upsertTaskLedgerOnWs(ws, rawTask = {}) {
  if (!ws || typeof ws !== 'object') return null
  if (!Array.isArray(ws.taskLedger)) {
    ws.taskLedger = Array.isArray(ws.resumeTasks) ? ws.resumeTasks : []
  }
  ws.resumeTasks = ws.taskLedger
  const lookupId = rawTask.taskId || rawTask.id
  const existingIdx = lookupId ? ws.taskLedger.findIndex(t => t && (t.taskId === lookupId || t.id === lookupId)) : -1
  if (existingIdx >= 0) {
    const prev = ws.taskLedger[existingIdx]
    const merged = normalizeTaskLedgerEntry({
      ...prev,
      ...rawTask,
      updatedAt: Date.now(),
      completedActions: rawTask.appendCompletedAction
        ? [...(prev.completedActions || []), rawTask.appendCompletedAction]
        : (rawTask.completedActions || prev.completedActions),
      pendingApprovalIds: rawTask.pendingApprovalIds || prev.pendingApprovalIds,
    })
    if (merged) ws.taskLedger[existingIdx] = merged
    return merged
  }
  const created = normalizeTaskLedgerEntry(rawTask)
  if (!created) return null
  ws.taskLedger.push(created)
  if (ws.taskLedger.length > TASK_LEDGER_CAP) {
    ws.taskLedger = ws.taskLedger.slice(-TASK_LEDGER_CAP)
    ws.resumeTasks = ws.taskLedger
  }
  return created
}

export function upsertResumeTaskOnWs(ws, rawTask = {}) {
  return upsertTaskLedgerOnWs(ws, rawTask)
}

export function enqueueChiefInquiryOnWs(ws, raw = {}) {
  if (!ws || typeof ws !== 'object') return null
  if (!Array.isArray(ws.inquiries)) ws.inquiries = []
  const norm = normalizeInquiryItem(raw)
  if (!norm) return null
  const dup = ws.inquiries.find(
    q => q && (q.status === 'pending' || q.status === 'delivered') && q.question === norm.question && q.target === norm.target,
  )
  if (dup) return dup
  ws.inquiries.push(norm)
  if (ws.inquiries.length > 24) ws.inquiries = ws.inquiries.slice(-24)
  return norm
}

export function answerChiefInquiry(sessionId = 'global', { inquiryId = '', answer = '', by = 'lead' } = {}) {
  const rootId = String(sessionId || 'global').trim() || 'global'
  const cleanAns = cleanMultiline(answer || '', 1200)
  if (!cleanAns) return { ok: false, error: 'inquiry.reply 需要非空答复文本 (text)' }
  return mutateChiefState((state) => {
    const ws = ensureWorkspace(state, rootId)
    if (!Array.isArray(ws.inquiries)) ws.inquiries = []
    let idx = inquiryId
      ? ws.inquiries.findIndex(q => q && (q.inquiryId === inquiryId || q.id === inquiryId))
      : -1
    if (idx < 0 && !inquiryId) {
      for (let i = ws.inquiries.length - 1; i >= 0; i -= 1) {
        if (ws.inquiries[i] && (ws.inquiries[i].status === 'pending' || ws.inquiries[i].status === 'delivered')) {
          idx = i
          break
        }
      }
    }
    if (idx < 0) return { ok: false, error: `未找到待回复问询：${inquiryId || '最近未答问询'}` }
    const existing = ws.inquiries[idx]
    if (!existing || existing.status === 'answered' || (existing.status !== 'pending' && existing.status !== 'delivered')) {
      const prevId = (existing && existing.inquiryId) || inquiryId
      const prevStatus = (existing && existing.status) || 'unknown'
      pushAuditToWs(ws, {
        mode: resolveWorkspaceConfig(state, rootId).permissionMode,
        stage: 'inquiry_channel',
        rule: 'inquiry_reply_replay_rejected',
        decision: 'rejected',
        operation: '拦截重复问询答复',
        target: prevId,
        reason: `问询 #${prevId} 已结案 (status=${prevStatus})，拒绝重放覆写`,
        outcome: 'rejected',
        by: clamp(by || 'lead', 40),
      }, rootId)
      return {
        ok: false,
        alreadyAnswered: true,
        code: 'inquiry_already_answered',
        error: `问询 #${prevId} 已回复结案，拒绝重复应答`,
        inquiry: existing,
      }
    }
    const now = Date.now()
    const item = {
      ...existing,
      status: 'answered',
      answer: cleanAns,
      answeredBy: clamp(by || 'lead', 40),
      answeredAt: now,
    }
    ws.inquiries[idx] = item
    if (item.taskId) {
      upsertTaskLedgerOnWs(ws, {
        taskId: item.taskId,
        kind: 'inquiry',
        status: 'completed',
        inquiryId: item.inquiryId,
        lastReceipt: `已收到 ${item.answeredBy} 原路答复：${clamp(cleanAns, 120)}`,
        resolvedAt: now,
      })
    }
    ws.chat.push({
      id: nextId('chat'),
      role: 'chief',
      kind: 'receipt',
      text: `- 【⚡ 优先问询回执 #${item.inquiryId}】已收到 \`${item.answeredBy}\` 不中断原路回复：\n- 【问】${item.question}\n- 【答】${cleanAns}`,
      actions: [`问询已回执 #${item.inquiryId}`],
      at: now,
    })
    if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
    pushAuditToWs(ws, {
      mode: resolveWorkspaceConfig(state, rootId).permissionMode,
      stage: 'inquiry_channel',
      rule: 'inquiry_reply',
      decision: 'answered',
      operation: '优先问询原路回复',
      target: item.inquiryId,
      reason: clamp(cleanAns, 140),
      outcome: 'ok',
      by: item.answeredBy,
    }, rootId)
    return { ok: true, inquiry: item }
  })
}

const STATE_LOCK_WAIT_MS = 10000

const STATE_LOCK_STALE_MS = 15000

const STATE_LOCK_CONTENDED_CODES = new Set(['EEXIST', 'EPERM', 'EACCES', 'EBUSY'])

const heldStateLocks = new Set()

const stateLockSleeper = new Int32Array(new SharedArrayBuffer(4))

function sleepStateLockSync(ms) {
  try {
    Atomics.wait(stateLockSleeper, 0, 0, ms)
  } catch {}
}

/** Cross-process O_EXCL lock around `chief-state.json` read-modify-write cycles (fixes red-team E1). */
function acquireStateLock(file = stateFilePath()) {
  if (heldStateLocks.has(file)) return () => {}
  const lock = file + '.lock'
  try {
    fs.mkdirSync(path.dirname(lock), { recursive: true })
  } catch {}
  const deadline = Date.now() + STATE_LOCK_WAIT_MS
  for (;;) {
    try {
      const fd = fs.openSync(lock, 'wx')
      try {
        fs.writeSync(fd, `${process.pid}:${threadId}`)
      } catch {}
      fs.closeSync(fd)
      heldStateLocks.add(file)
      return () => {
        heldStateLocks.delete(file)
        try {
          fs.unlinkSync(lock)
        } catch {}
      }
    } catch (error) {
      const code = error && error.code
      if (code === 'ENOENT' && Date.now() < deadline) {
        try {
          fs.mkdirSync(path.dirname(lock), { recursive: true })
        } catch {}
        sleepStateLockSync(2)
        continue
      }
      if (!error || !STATE_LOCK_CONTENDED_CODES.has(code)) {
        heldStateLocks.add(file)
        return () => heldStateLocks.delete(file)
      }
      if (Date.now() >= deadline) {
        try {
          fs.unlinkSync(lock)
        } catch {}
        heldStateLocks.add(file)
        return () => heldStateLocks.delete(file)
      }
      if (code === 'EEXIST') {
        try {
          const stat = fs.statSync(lock)
          if (Date.now() - stat.mtimeMs > STATE_LOCK_STALE_MS) {
            fs.unlinkSync(lock)
            continue
          }
        } catch {}
      }
      sleepStateLockSync(2 + Math.floor(Math.random() * 4))
    }
  }
}

export function withChiefStateLock(fn) {
  const file = stateFilePath()
  const release = acquireStateLock(file)
  try {
    return fn()
  } finally {
    release()
  }
}

let cachedState = null

let cachedMtime = 0

function applyColdLoadLedgerRecovery(state) {
  if (!state || !state.workspaces || typeof state.workspaces !== 'object') return false
  let changed = false
  const now = Date.now()
  for (const ws of Object.values(state.workspaces)) {
    if (!ws || !Array.isArray(ws.taskLedger) || ws.taskLedger.length === 0) continue
    const beforeStatuses = ws.taskLedger.map(t => t && t.status)
    const recovered = recoverTaskLedgerEntriesOnDiskLoad(ws.taskLedger, now)
    ws.taskLedger = recovered
    ws.resumeTasks = recovered
    for (let i = 0; i < recovered.length; i += 1) {
      if (recovered[i] && recovered[i].status !== beforeStatuses[i]) {
        changed = true
      }
    }
  }
  return changed
}

export function loadChiefState({ forceDisk = false } = {}) {
  const file = stateFilePath()
  try {
    const stat = fs.statSync(file)
    if (!forceDisk && cachedState && stat.mtimeMs === cachedMtime) return cachedState
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    const nextState = normalizeState(parsed)
    applyColdLoadLedgerRecovery(nextState)
    cachedState = nextState
    cachedMtime = stat.mtimeMs
    return cachedState
  } catch {
    if (forceDisk) {
      cachedState = normalizeState({})
      cachedMtime = -1
      return cachedState
    }
    if (!cachedState) cachedState = normalizeState({})
    return cachedState
  }
}

export function reconcileChiefStateOnBoot() {
  return mutateChiefState((state) => applyColdLoadLedgerRecovery(state))
}

export function saveChiefState(state) {
  const normalized = normalizeState(state)
  const file = stateFilePath()
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.${threadId}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 6)}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(normalized, null, 2), 'utf8')
    let renameErr = null
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        fs.renameSync(tmp, file)
        renameErr = null
        break
      } catch (err) {
        renameErr = err
        const code = err && err.code
        if (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY') break
        sleepStateLockSync(2 + attempt * 2)
      }
    }
    if (renameErr) {
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp) } catch {}
      throw renameErr
    }
    try {
      cachedMtime = fs.statSync(file).mtimeMs
    } catch {
      cachedMtime = -1
    }
  } catch {}
  cachedState = normalized
  return normalized
}

export function mutateChiefState(mutator) {
  return withChiefStateLock(() => {
    const state = loadChiefState({ forceDisk: true })
    const result = mutator(state)
    saveChiefState(state)
    return result
  })
}

/** Find connected component of linked root sessions (undirected graph). */
export function getLinkedCluster(state, rootSessionId) {
  const seed = String(rootSessionId || '').trim()
  if (!seed) return ['global']
  const visited = new Set([seed])
  const queue = [seed]
  const links = (state && state.links) || {}
  while (queue.length > 0) {
    const cur = queue.shift()
    const direct = Array.isArray(links[cur]) ? links[cur] : []
    for (const peer of direct) {
      if (peer && !visited.has(peer)) {
        visited.add(peer)
        queue.push(peer)
      }
    }
    for (const [other, list] of Object.entries(links)) {
      if (Array.isArray(list) && list.includes(cur) && !visited.has(other)) {
        visited.add(other)
        queue.push(other)
      }
    }
  }
  return [...visited].sort()
}

export function computeClusterSig(cluster = []) {
  return [...new Set((Array.isArray(cluster) ? cluster : []).map(x => String(x || '').trim()).filter(Boolean))].sort().join('|')
}

export function setPeerLink(rootA, rootB, linked) {
  const a = String(rootA || '').trim()
  const b = String(rootB || '').trim()
  if (!a || !b || a === b) return { ok: false, error: '需要两个不同的主会话才能建立协同连接' }
  return mutateChiefState((state) => {
    const affected = new Set([
      ...getLinkedCluster(state, a),
      ...getLinkedCluster(state, b),
    ])
    const setA = new Set(state.links[a] || [])
    const setB = new Set(state.links[b] || [])
    if (linked) {
      setA.add(b)
      setB.add(a)
    } else {
      setA.delete(b)
      setB.delete(a)
    }
    if (setA.size) state.links[a] = [...setA]
    else delete state.links[a]
    if (setB.size) state.links[b] = [...setB]
    else delete state.links[b]

    // Topology isolation guard: purge stale narrative caches on EVERY affected session whose cluster changed
    // so detaching from a peer cluster NEVER leaves residual peer context inside Chief's narrative digest!
    const now = Date.now()
    for (const sid of affected) {
      const ws = ensureWorkspace(state, sid)
      const nextCluster = getLinkedCluster(state, sid)
      const nextSig = computeClusterSig(nextCluster)
      if (!ws.narrative || ws.narrative.clusterSig !== nextSig) {
        ws.narrative = { hash: '', text: '', at: 0, byModel: '', clusterSig: nextSig }
      }
      if (!linked) {
        ws.seenFactsAt = { [sid]: now }
      } else {
        ws.seenFactsAt = {}
      }
    }
    return { ok: true, cluster: getLinkedCluster(state, a) }
  })
}

export function ensureWorkspace(state, rootId) {
  const key = String(rootId || 'global').trim() || 'global'
  if (!state.workspaces[key]) state.workspaces[key] = emptyWorkspace()
  return state.workspaces[key]
}

function filterFactsForCluster(rawFacts, clusterSet, rootId) {
  return (Array.isArray(rawFacts) ? rawFacts : []).filter((f) => {
    if (!f || !f.text) return false
    if (f.originRootId && !clusterSet.has(f.originRootId)) return false
    if (f.category === 'team' && Array.isArray(f.peerRootIds) && f.peerRootIds.length > 0) {
      // A team fact created during multi-session collaboration stays ONLY if another participant besides rootId remains linked
      const participants = f.originRootId ? [f.originRootId, ...f.peerRootIds] : f.peerRootIds
      const peerStillLinked = participants.some(pid => pid && pid !== rootId && clusterSet.has(pid))
      if (!peerStillLinked) return false
    }
    return true
  })
}

function annotateMailClusterState(mail, clusterSet) {
  if (!mail || typeof mail !== 'object') return mail
  const fromOut = Boolean(mail.fromRootId && !clusterSet.has(mail.fromRootId))
  const toOut = Boolean(mail.toRootId && mail.toRootId !== 'all' && !clusterSet.has(mail.toRootId))
  const detachedFromCluster = fromOut || toOut
  return detachedFromCluster ? { ...mail, detachedFromCluster: true } : mail
}

/** Merge facts & mailbox across all linked peer sessions in the federation cluster, isolating detached artifacts. */
export function clusterView(state, rootId) {
  const cluster = getLinkedCluster(state, rootId)
  const clusterSig = computeClusterSig(cluster)
  const clusterSet = new Set(cluster)
  const primary = ensureWorkspace(state, rootId)
  if (cluster.length <= 1) {
    return {
      cluster,
      clusterSig,
      primary,
      facts: filterFactsForCluster(primary.facts, clusterSet, rootId),
      mailbox: (primary.mailbox || []).map(m => annotateMailClusterState(m, clusterSet)),
      suggestions: primary.suggestions.filter(s => s.status === 'pending'),
      chat: primary.chat,
      narrative: primary.narrative,
    }
  }
  const factMap = new Map()
  const mailMap = new Map()
  for (const sid of cluster) {
    const ws = ensureWorkspace(state, sid)
    for (const f of filterFactsForCluster(ws.facts, clusterSet, rootId)) factMap.set(f.id, f)
    for (const m of ws.mailbox) {
      if (m && m.broadcastId && m.channelType === 'broadcast') {
        mailMap.set('bcast:' + m.broadcastId, annotateMailClusterState(m, clusterSet))
      } else {
        mailMap.set(m.id, annotateMailClusterState(m, clusterSet))
      }
    }
  }
  const facts = [...factMap.values()].sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0)).slice(-FACTS_CAP)
  const mailbox = [...mailMap.values()].sort((a, b) => (a.at || 0) - (b.at || 0)).slice(-MAIL_CAP)
  return {
    cluster,
    clusterSig,
    primary,
    facts,
    mailbox,
    suggestions: primary.suggestions.filter(s => s.status === 'pending'),
    chat: primary.chat,
    narrative: primary.narrative,
  }
}

/* -------------------------------------------------------------------------- */
/* Model Catalog & Auxiliary LLM Caller                                       */
/* -------------------------------------------------------------------------- */

/** Manage which cold precipitated-vault entries are explicitly unsealed/flipped into a single root session. */
export function updateWorkspaceFlippedIds(sessionId, { flippedId = '', sealId = '', clearAll = false } = {}) {
  const key = String(sessionId || 'global').trim() || 'global'
  return mutateChiefState((state) => {
    const ws = ensureWorkspace(state, key)
    const set = new Set(ws.flippedPrecipitatedIds || [])
    if (clearAll) {
      set.clear()
    } else {
      if (flippedId) set.add(String(flippedId).trim())
      if (sealId) set.delete(String(sealId).trim())
    }
    ws.flippedPrecipitatedIds = [...set].slice(-20)
    return { ok: true, flippedPrecipitatedIds: ws.flippedPrecipitatedIds.slice() }
  })
}

/** One-click system deployment of Chief state (`facts`, `narrative`, `chat`/`mailbox` bridge) to a target Chief workspace (strictly keeping `flippedPrecipitatedIds = []`). */
export function deployChiefWorkspaceState(deps, {
  fromRootId = '',
  toRootId = '',
  fromTitle = '',
  customText = '',
  objective = '',
} = {}) {
  const fromKey = String(fromRootId || 'global').trim() || 'global'
  const toKey = String(toRootId || '').trim()
  if (!toKey) return { ok: false, error: '目标会话 ID 不能为空' }

  return mutateChiefState((state) => {
    const fromWs = ensureWorkspace(state, fromKey)
    const toWs = ensureWorkspace(state, toKey)

    const existingTexts = new Set(toWs.facts.map(f => f.text.trim()))
    let copiedFacts = 0
    for (const f of fromWs.facts) {
      if (!f || !f.text) continue
      const norm = f.text.trim()
      if (existingTexts.has(norm)) continue
      existingTexts.add(norm)
      toWs.facts.push({
        ...f,
        id: nextId('fact'),
        originRootId: toKey === 'global' ? (f.originRootId || '') : toKey,
        peerRootIds: [],
        source: f.source || `移交自 ${fromTitle || fromKey}`,
        updatedAt: Date.now(),
      })
      copiedFacts += 1
    }
    if (toWs.facts.length > FACTS_CAP) {
      const pinned = toWs.facts.filter(f => f.pinned)
      const rest = toWs.facts.filter(f => !f.pinned).slice(-(FACTS_CAP - pinned.length))
      toWs.facts = [...pinned, ...rest].slice(-FACTS_CAP)
    }

    if (fromWs.narrative && fromWs.narrative.text && !toWs.narrative.text) {
      toWs.narrative = {
        ...fromWs.narrative,
        hash: fromWs.narrative.hash || '',
        clusterSig: toKey,
        at: Date.now(),
      }
    }

    const briefLines = [
      `- 【跨会话接力部署】本会话参谋状态已自 **${fromTitle || fromKey}** 系统级一键移交部署完成（新对话默认以 **L0 · 顾问模式** 安全启动）。`,
      objective ? `- 【继承总目标】${clamp(objective, 180)}` : '',
      copiedFacts > 0 ? `- 【继承纪律与事实】共继承 **${copiedFacts} 条**核心记忆与纪律。` : '',
      customText ? `- 【附带交接叮嘱】${clamp(customText, 240)}` : '',
    ].filter(Boolean).join('\n')

    const mailItem = normalizeMail({
      id: nextId('mail'),
      from: 'DSH 参谋长 (接力部署)',
      fromSession: fromKey,
      to: 'lead',
      toSession: toKey,
      subject: `跨会话参谋部署：自 ${fromTitle || fromKey}`,
      text: briefLines,
      mode: 'silent',
      deliveredPhysical: false,
      at: Date.now(),
    })
    if (mailItem) {
      toWs.mailbox.push(mailItem)
      if (toWs.mailbox.length > MAIL_CAP) toWs.mailbox = toWs.mailbox.slice(-MAIL_CAP)
    }

    toWs.chat.push({
      id: nextId('chat'),
      role: 'chief',
      text: briefLines,
      actions: ['系统接力部署', '默认 L0 顾问', ...(copiedFacts > 0 ? [`继承记忆 ×${copiedFacts}`] : [])],
      at: Date.now(),
    })
    if (toWs.chat.length > CHAT_CAP) toWs.chat = toWs.chat.slice(-CHAT_CAP)

    // Clone safe workspace chief config (model, effort, tactical preferences), ALWAYS forcing intervention=false, runMode='off' & L0 advisor!
    const fromCfg = resolveWorkspaceConfig(state, fromKey)
    toWs.config = {
      modelRef: fromCfg.modelRef || '',
      paceMode: 'manual',
      runMode: 'off',
      thinkingEffort: fromCfg.thinkingEffort || 'auto',
      teamEffortMode: fromCfg.teamEffortMode || 'auto',
      managedIdleTimeoutMs: fromCfg.managedIdleTimeoutMs || DEFAULT_MANAGED_IDLE_TIMEOUT_MS,
      permissionMode: DEFAULT_CHIEF_PERMISSION_MODE,
      autoPilot: false,
      autoReview: false,
      tacticalModes: {
        ...normalizeTacticalModes(fromCfg.tacticalModes),
        intervention: false,
      },
    }
    toWs.chiefRiskAck = null
    toWs.pendingApprovals = []
    toWs.pendingElevation = null
    pushAuditToWs(toWs, {
      mode: DEFAULT_CHIEF_PERMISSION_MODE,
      stage: 'deploy',
      decision: 'reset_to_l0',
      operation: '跨会话接力部署',
      target: toKey,
      reason: '新对话强制从最低档 L0 顾问模式安全启动并清空高权限状态',
      outcome: 'ok',
      by: 'deploy',
    })
    toWs.runtimeGuard.interventionTurns = 0
    toWs.runtimeGuard.unchangedCount = 0
    toWs.runtimeGuard.circuitBroken = false
    toWs.runtimeGuard.circuitReason = ''

    // Strictly keep precipitated cold vault isolated at 0-token default in destination session!
    toWs.flippedPrecipitatedIds = []

    return {
      ok: true,
      copiedFacts,
      narrativeCopied: Boolean(fromWs.narrative && fromWs.narrative.text),
      flippedPrecipitatedIds: [],
      config: { ...toWs.config, tacticalModes: { ...toWs.config.tacticalModes } },
    }
  })
}

/* -------------------------------------------------------------------------- */
/* Chief Command Bar: All-Seeing Strategist + Relay + Bounds + Board Ops  */
/* -------------------------------------------------------------------------- */

export function updateChiefConfig(patch) {
  const rawInput = patch && typeof patch === 'object' ? patch : {}
  const rawPreset = typeof rawInput.preset === 'string' ? rawInput.preset.trim().toLowerCase() : ''
  const presetSpec = CHIEF_SCENARIO_PRESETS[rawPreset] || null
  const safePatch = presetSpec
    ? {
        ...presetSpec,
        ...rawInput,
        tacticalModes: {
          ...(presetSpec.tacticalModes || {}),
          ...(rawInput.tacticalModes && typeof rawInput.tacticalModes === 'object' ? rawInput.tacticalModes : {}),
        },
      }
    : rawInput
  const sid = String(safePatch.sessionId || safePatch.session || '').trim() || 'global'
  return mutateChiefState((state) => {
    const ws = ensureWorkspace(state, sid)
    const effBefore = resolveWorkspaceConfig(state, sid)
    const prevTactical = normalizeTacticalModes(effBefore.tacticalModes)
    if (typeof safePatch.ackHazardAlertId === 'string' && safePatch.ackHazardAlertId.trim()) {
      const ackId = safePatch.ackHazardAlertId.trim()
      if (ws && ws.runtimeGuard && ws.runtimeGuard.hazardAlert && (ackId === '*' || ws.runtimeGuard.hazardAlert.id === ackId)) {
        ws.runtimeGuard.hazardAlert = null
      }
      const hasOtherKeys = Object.keys(safePatch).some(
        k => k !== 'sessionId' && k !== 'session' && k !== 'ackHazardAlertId',
      )
      if (!hasOtherKeys) {
        const curCfg = resolveWorkspaceConfig(state, sid)
        return {
          ok: true,
          clearedHazardAlert: true,
          config: { ...curCfg, tacticalModes: { ...curCfg.tacticalModes } },
          runtimeGuard: ws ? { ...ws.runtimeGuard } : null,
        }
      }
    }

    if (safePatch.emergencyStopIntervention === true) {
      if (ws) {
        if (!ws.config || typeof ws.config !== 'object') ws.config = { ...effBefore }
        ws.config.tacticalModes = { ...normalizeTacticalModes(ws.config.tacticalModes), intervention: false }
        ws.runtimeGuard.interventionTurns = 0
        ws.runtimeGuard.unchangedCount = 0
        ws.runtimeGuard.circuitBroken = false
        ws.runtimeGuard.circuitReason = ''
        ws.runtimeGuard.hazardAlert = null
      }
      state.config.tacticalModes = { ...normalizeTacticalModes(state.config.tacticalModes), intervention: false }
      const stoppedCfg = resolveWorkspaceConfig(state, sid)
      return {
        ok: true,
        emergencyStopped: true,
        config: { ...stoppedCfg, tacticalModes: { ...stoppedCfg.tacticalModes } },
        runtimeGuard: ws ? { ...ws.runtimeGuard } : null,
      }
    }

    // Hard gate on model thinking effort lock mutations (human UI / explicit byUser only)
    const callerBy = typeof safePatch.by === 'string' ? safePatch.by.trim() : ''
    const isHumanBy = !callerBy || /^(?:user|human|operator|ui_panel)$/i.test(callerBy)
    const isHumanLockCaller = safePatch._fromUiPanel === true
      || (safePatch.byUser === true && isHumanBy)
    const wantsLockMutation = safePatch.lockedModelEfforts !== undefined
      || safePatch.toggleLockAgentEffort !== undefined
      || safePatch.teamEffortMode !== undefined
    if (wantsLockMutation && !isHumanLockCaller) {
      pushAuditToWs(ws, {
        mode: effBefore.permissionMode,
        stage: 'model_effort_lock',
        rule: 'effort_lock_human_only',
        decision: 'blocked',
        operation: '修改模型思考强度锁挡',
        target: sid,
        reason: `未授权来源 (${callerBy || 'unknown'}) 试图修改 lockedModelEfforts，仅允许人类面板显式操作`,
        outcome: 'rejected',
        by: clamp(callerBy || 'unknown', 40),
      }, sid)
      return {
        ok: false,
        blocked: true,
        lockedByUser: true,
        code: 'effort_lock_human_only',
        error: '思考强度锁挡 (lockedModelEfforts) 仅允许人类通过面板或显式 byUser 授权修改，已拦截越权变更',
      }
    }
    if (
      typeof safePatch.thinkingEffort === 'string'
      && effBefore.lockedModelEfforts
      && effBefore.lockedModelEfforts.chief === true
      && !isHumanLockCaller
    ) {
      pushAuditToWs(ws, {
        mode: effBefore.permissionMode,
        stage: 'model_effort_lock',
        rule: 'effort_lock_human_only',
        decision: 'blocked',
        operation: '修改参谋长思考强度',
        target: sid,
        reason: `参谋长思考强度已被用户锁定 (lockedModelEfforts.chief)，拒绝非人类来源 (${callerBy || 'unknown'}) 修改`,
        outcome: 'rejected',
        by: clamp(callerBy || 'unknown', 40),
      }, sid)
      return {
        ok: false,
        blocked: true,
        lockedByUser: true,
        code: 'effort_lock_human_only',
        error: '参谋长思考强度已被用户锁定 (lockedModelEfforts.chief)，仅允许人类显式修改',
      }
    }

    // Check explicit Policy Plugin list (restrict-only) BEFORE applying any changes
    let validatedPlugins = null
    if (safePatch.policyPlugins !== undefined) {
      const plugCheck = validatePolicyPluginList(safePatch.policyPlugins)
      if (!plugCheck.ok) {
        pushAuditToWs(ws, {
          mode: effBefore.permissionMode,
          stage: 'policy_plugin',
          rule: plugCheck.code || 'policy_plugin_rejected',
          decision: 'rejected',
          operation: '配置只紧不松策略插件',
          target: sid,
          reason: plugCheck.error,
          outcome: 'rejected',
          by: clamp(safePatch.by || 'operator', 40),
        }, sid)
        return {
          ok: false,
          code: plugCheck.code || 'POLICY_PLUGIN_WEAKENING_FORBIDDEN',
          error: plugCheck.error,
        }
      }
      validatedPlugins = plugCheck.plugins
    }

    // Check explicit permission mode transition BEFORE applying any changes
    let normalizedReqPerm = ''
    if (typeof safePatch.permissionMode === 'string' && safePatch.permissionMode.trim()) {
      normalizedReqPerm = normalizePermissionMode(safePatch.permissionMode)
      if (normalizedReqPerm === 'chief' && safePatch.confirmedChiefRisk !== true && !hasValidChiefRiskAck(ws)) {
        pushAuditToWs(ws, {
          mode: effBefore.permissionMode,
          stage: 'permission_gate',
          decision: 'deny_unacknowledged_l3',
          operation: '切换 L3 参谋长模式',
          target: sid,
          reason: '未阅读并勾选确认高权限风险告知（confirmedChiefRisk: true）',
          outcome: 'denied',
          by: 'operator',
        })
        return {
          ok: false,
          requireChiefRiskConfirm: true,
          error: '启用「L3 · 参谋长模式」前必须阅读高权限风险告知并主动勾选确认（confirmedChiefRisk: true）',
        }
      }
    }

    const incomingTacticalRaw = safePatch.tacticalModes && typeof safePatch.tacticalModes === 'object'
      ? safePatch.tacticalModes
      : null
    let incomingTactical = incomingTacticalRaw ? { ...incomingTacticalRaw } : null
    if (incomingTactical && incomingTactical.intervention === true && !prevTactical.intervention) {
      if (safePatch.confirmedInterventionRisk !== true) {
        return {
          ok: false,
          error: '开启「接管督导模式」需先确认双项风险免责声明（confirmedInterventionRisk: true）',
        }
      }
      if (ws) {
        ws.runtimeGuard.interventionTurns = 0
        ws.runtimeGuard.unchangedCount = 0
        ws.runtimeGuard.circuitBroken = false
        ws.runtimeGuard.circuitReason = ''
        ws.runtimeGuard.hazardAlert = null
        ws.runtimeGuard.lastGoalAchievedSig = ''
      }
    }

    const wantsUnlimitedTurns = Boolean(
      incomingTactical
      && (incomingTactical.maxInterventionTurns === 0 || incomingTactical.maxInterventionTurns === '0')
    )
    if (wantsUnlimitedTurns && prevTactical.maxInterventionTurns !== 0 && safePatch.confirmedUnlimitedTurns !== true) {
      return {
        ok: false,
        error: '切换至「♾️ 无限督导轮次」需先通过作者风险确认弹窗（confirmedUnlimitedTurns: true）',
      }
    }

    const wantsAutoPilot = Boolean(
      safePatch.runMode === 'managed'
      || safePatch.paceMode === 'auto'
      || (typeof safePatch.paceMode !== 'string' && typeof safePatch.runMode !== 'string' && safePatch.stopped !== true && safePatch.autoPilot === true)
    )
    if (wantsAutoPilot && effBefore.runMode !== 'managed' && effBefore.paceMode !== 'auto' && safePatch.confirmedAutoPilot !== true) {
      return {
        ok: false,
        requireAutoPilotConfirm: true,
        error: '开启「🤖 托管模式」需先确认本会话自治范围与 5 条件自动休眠保护（confirmedAutoPilot: true）',
      }
    }
    if (ws && wantsAutoPilot && (effBefore.runMode !== 'managed' || effBefore.paceMode !== 'auto')) {
      const now = Date.now()
      ws.runtimeGuard.autoPilotStartedAt = now
      ws.runtimeGuard.managedStartedAt = now
      ws.runtimeGuard.lastActivityAt = now
      ws.runtimeGuard.autoPilotHadTurn = false
      ws.llmLedger = normalizeLlmLedger(ws.llmLedger)
      ws.llmLedger.managedRun = {
        startedAt: now,
        calls: 0,
        tokens: 0,
        tripped: false,
        trippedAt: 0,
        trippedReason: '',
      }
    }
    if (ws && !wantsAutoPilot && safePatch.runMode === 'patrol' && ws.llmLedger && ws.llmLedger.managedRun && ws.llmLedger.managedRun.tripped) {
      ws.llmLedger.managedRun.tripped = false
      ws.llmLedger.managedRun.trippedAt = 0
      ws.llmLedger.managedRun.trippedReason = ''
    }
    if (ws && safePatch.resetManagedBudget === true) {
      ws.llmLedger = normalizeLlmLedger(ws.llmLedger)
      ws.llmLedger.managedRun = {
        startedAt: Date.now(),
        calls: 0,
        tokens: 0,
        tripped: false,
        trippedAt: 0,
        trippedReason: '',
      }
    }
    if (ws && safePatch.resetLlmLedger === true) {
      ws.llmLedger = emptyLlmLedger()
    }

    let compactLowWarning = ''
    if (incomingTactical && typeof incomingTactical.compactThresholdInput === 'string') {
      const parsedTok = parseCompactTokensInput(incomingTactical.compactThresholdInput)
      if (!parsedTok.ok) {
        return { ok: false, error: parsedTok.error }
      }
      incomingTactical.compactThresholdTokens = parsedTok.tokens
      incomingTactical.compactThresholdInput = parsedTok.displayInput
      compactLowWarning = parsedTok.lowWarning || ''
    } else if (incomingTactical && typeof incomingTactical.compactThresholdTokens === 'number') {
      const safeTok = Math.max(COMPACT_TOKEN_HARD_MIN, Math.round(incomingTactical.compactThresholdTokens))
      incomingTactical.compactThresholdTokens = safeTok
      incomingTactical.compactThresholdInput = formatCompactTokenShort(safeTok)
      if (safeTok < COMPACT_TOKEN_WARN_FLOOR) {
        compactLowWarning = `当前阈值（${incomingTactical.compactThresholdInput}）低于安全建议线 32K，可能导致上下文频繁压缩丢失现场细节`
      }
    }

    const applyPatchTo = (targetCfg, allowIntervention, allowAutoPilot = allowIntervention, allowPermSync = false, allowLocks = false) => {
      if (typeof safePatch.modelRef === 'string') targetCfg.modelRef = safePatch.modelRef.trim()
      if (typeof safePatch.thinkingEffort === 'string') {
        targetCfg.thinkingEffort = normalizeThinkingEffort(safePatch.thinkingEffort)
      }
      if (allowLocks && typeof safePatch.teamEffortMode === 'string') {
        targetCfg.teamEffortMode = normalizeTeamEffortMode(safePatch.teamEffortMode)
      }
      if (Number.isFinite(Number(safePatch.managedIdleTimeoutMs)) && Number(safePatch.managedIdleTimeoutMs) >= 50) {
        targetCfg.managedIdleTimeoutMs = Math.min(2 * 60 * 60 * 1000, Math.round(Number(safePatch.managedIdleTimeoutMs)))
      }
      if (typeof safePatch.notifyEnabled === 'boolean') targetCfg.notifyEnabled = safePatch.notifyEnabled
      if (typeof safePatch.notifySound === 'boolean') targetCfg.notifySound = safePatch.notifySound
      if (typeof safePatch.uiLang === 'string') targetCfg.uiLang = normalizeUiLang(safePatch.uiLang)
      if (safePatch.managedBudgetMaxCalls !== undefined) {
        targetCfg.managedBudgetMaxCalls = normalizeManagedBudgetCalls(safePatch.managedBudgetMaxCalls)
      }
      if (safePatch.managedBudgetMaxTokens !== undefined) {
        targetCfg.managedBudgetMaxTokens = normalizeManagedBudgetTokens(safePatch.managedBudgetMaxTokens)
      }
      if (allowLocks && (
        (safePatch.lockedModelEfforts && typeof safePatch.lockedModelEfforts === 'object')
        || (safePatch.toggleLockAgentEffort && typeof safePatch.toggleLockAgentEffort === 'object')
      )) {
        const curLocks = { ...(targetCfg.lockedModelEfforts || {}) }
        if (safePatch.lockedModelEfforts && typeof safePatch.lockedModelEfforts === 'object') {
          for (const [lk, lv] of Object.entries(safePatch.lockedModelEfforts)) {
            const ck = String(lk || '').trim().slice(0, 64)
            if (!ck) continue
            if (lv === true) curLocks[ck] = true
            else delete curLocks[ck]
          }
        }
        if (safePatch.toggleLockAgentEffort && typeof safePatch.toggleLockAgentEffort === 'object') {
          const lk = String(safePatch.toggleLockAgentEffort.target || 'lead').trim().slice(0, 64)
          if (lk) {
            if (safePatch.toggleLockAgentEffort.locked === true) curLocks[lk] = true
            else delete curLocks[lk]
          }
        }
        targetCfg.lockedModelEfforts = curLocks
      }
      if (allowPermSync && normalizedReqPerm) {
        targetCfg.permissionMode = normalizedReqPerm
      }
      if (typeof safePatch.runMode === 'string' && CHIEF_RUN_MODES.includes(safePatch.runMode)) {
        const nextRun = (!allowAutoPilot && safePatch.runMode === 'managed') ? 'off' : safePatch.runMode
        targetCfg.runMode = nextRun
        targetCfg.stopped = false
        targetCfg.paceMode = nextRun === 'managed' ? 'auto' : (nextRun === 'patrol' ? 'smart' : 'manual')
        targetCfg.autoPilot = nextRun === 'managed' && allowAutoPilot
        targetCfg.autoReview = nextRun === 'managed' && allowAutoPilot
      } else if (typeof safePatch.paceMode === 'string' && ['manual', 'smart', 'auto', 'stopped'].includes(safePatch.paceMode)) {
        const nextPace = (!allowAutoPilot && safePatch.paceMode === 'auto') ? 'manual' : safePatch.paceMode
        targetCfg.paceMode = nextPace
        const isStopped = nextPace === 'stopped'
        targetCfg.stopped = isStopped
        targetCfg.runMode = isStopped ? 'off' : (nextPace === 'auto' ? 'managed' : (nextPace === 'smart' ? 'patrol' : 'off'))
        targetCfg.autoPilot = !isStopped && nextPace === 'auto' && allowAutoPilot
        targetCfg.autoReview = !isStopped && nextPace === 'auto' && allowAutoPilot
      } else if (typeof safePatch.stopped === 'boolean') {
        targetCfg.stopped = safePatch.stopped
        if (safePatch.stopped) {
          targetCfg.paceMode = 'stopped'
          targetCfg.runMode = 'off'
          targetCfg.autoPilot = false
          targetCfg.autoReview = false
        } else {
          if (targetCfg.paceMode === 'stopped') targetCfg.paceMode = 'manual'
          if (!allowAutoPilot && targetCfg.paceMode === 'auto') targetCfg.paceMode = 'manual'
          targetCfg.runMode = normalizeRunMode(targetCfg.runMode, targetCfg)
          targetCfg.autoPilot = targetCfg.paceMode === 'auto' && allowAutoPilot
          targetCfg.autoReview = targetCfg.paceMode === 'auto' && allowAutoPilot
        }
      } else if (typeof safePatch.autoPilot === 'boolean') {
        const nextAuto = Boolean(safePatch.autoPilot && allowAutoPilot)
        targetCfg.stopped = false
        targetCfg.paceMode = nextAuto ? 'auto' : 'manual'
        targetCfg.runMode = nextAuto ? 'managed' : 'off'
        targetCfg.autoPilot = nextAuto
        targetCfg.autoReview = nextAuto
      }
      if (!allowAutoPilot && (targetCfg.paceMode === 'auto' || targetCfg.runMode === 'managed')) {
        targetCfg.paceMode = 'manual'
        targetCfg.runMode = 'off'
        targetCfg.autoPilot = false
        targetCfg.autoReview = false
      }
      if (typeof safePatch.autoReview === 'boolean' && typeof safePatch.paceMode !== 'string' && typeof safePatch.runMode !== 'string' && typeof safePatch.stopped !== 'boolean') {
        targetCfg.autoReview = safePatch.autoReview
        if (!safePatch.autoReview) {
          targetCfg.stopped = false
          targetCfg.paceMode = 'manual'
          targetCfg.runMode = 'off'
        }
      }
      if (incomingTactical) {
        const merged = normalizeTacticalModes({
          ...normalizeTacticalModes(targetCfg.tacticalModes),
          ...incomingTactical,
        })
        if (!allowIntervention) merged.intervention = false
        targetCfg.tacticalModes = merged
      } else if (!allowIntervention && targetCfg.tacticalModes) {
        targetCfg.tacticalModes = { ...normalizeTacticalModes(targetCfg.tacticalModes), intervention: false }
      }
    }

    if (!ws.config || typeof ws.config !== 'object') {
      ws.config = {
        modelRef: effBefore.modelRef || '',
        paceMode: effBefore.paceMode || 'manual',
        runMode: effBefore.runMode || 'off',
        thinkingEffort: effBefore.thinkingEffort || 'auto',
        teamEffortMode: effBefore.teamEffortMode || 'auto',
        managedIdleTimeoutMs: effBefore.managedIdleTimeoutMs || DEFAULT_MANAGED_IDLE_TIMEOUT_MS,
        notifyEnabled: effBefore.notifyEnabled !== false,
        notifySound: Boolean(effBefore.notifySound),
        uiLang: effBefore.uiLang || 'auto',
        managedBudgetMaxCalls: effBefore.managedBudgetMaxCalls ?? DEFAULT_MANAGED_BUDGET_MAX_CALLS,
        managedBudgetMaxTokens: effBefore.managedBudgetMaxTokens ?? DEFAULT_MANAGED_BUDGET_MAX_TOKENS,
        lockedModelEfforts: { ...(effBefore.lockedModelEfforts || {}) },
        permissionMode: effBefore.permissionMode || DEFAULT_CHIEF_PERMISSION_MODE,
        tacticalModes: { ...effBefore.tacticalModes },
      }
    }
    applyPatchTo(ws.config, true, true, true, isHumanLockCaller)
    if (validatedPlugins !== null) {
      if (safePatch.policyPluginsScope === 'global') {
        state.config.policyPlugins = validatedPlugins
      } else {
        ws.config.policyPlugins = validatedPlugins
      }
      pushAuditToWs(ws, {
        mode: resolveWorkspaceConfig(state, sid).permissionMode,
        stage: 'policy_plugin',
        rule: 'policy_plugin_updated',
        decision: 'executed',
        operation: '更新安全策略插件',
        target: `${safePatch.policyPluginsScope === 'global' ? 'global' : sid} (${validatedPlugins.length} 个)`,
        reason: `已加载 ${validatedPlugins.length} 个只紧不松安全策略插件`,
        outcome: 'ok',
        by: clamp(safePatch.by || 'operator', 40),
      }, sid)
    }
    // Session permissionMode, intervention, lockedModelEfforts, and autoPilot NEVER leak globally across new sessions!
    state.config.permissionMode = DEFAULT_CHIEF_PERMISSION_MODE
    applyPatchTo(state.config, false, false, false, false)

    if (normalizedReqPerm) {
      if (normalizedReqPerm === 'chief' && safePatch.confirmedChiefRisk === true) {
        ws.chiefRiskAck = {
          acknowledged: true,
          at: Date.now(),
          by: clamp(safePatch.by || 'operator', 40),
          version: '1.2.1',
        }
      } else if (normalizedReqPerm !== 'chief') {
        ws.chiefRiskAck = null
      }
      if (normalizedReqPerm !== effBefore.permissionMode) {
        if (ws.pendingElevation && permissionRank(normalizedReqPerm) >= permissionRank(ws.pendingElevation.targetMode)) {
          ws.pendingElevation = null
        }
        pushAuditToWs(ws, {
          mode: normalizedReqPerm,
          stage: 'permission_gate',
          decision: 'mode_changed',
          operation: '切换权限等级',
          target: `${CHIEF_PERMISSION_META[effBefore.permissionMode].level} -> ${CHIEF_PERMISSION_META[normalizedReqPerm].level}`,
          reason: normalizedReqPerm === 'chief' ? '用户勾选风险声明并确认启用 L3 参谋长模式' : `用户主动切换至 ${CHIEF_PERMISSION_META[normalizedReqPerm].title}`,
          outcome: 'ok',
          by: clamp(safePatch.by || 'operator', 40),
        })
      }
    }

    const finalCfg = resolveWorkspaceConfig(state, sid)
    if (!compactLowWarning && finalCfg.tacticalModes.compactThresholdMode === 'tokens' && finalCfg.tacticalModes.compactThresholdTokens < COMPACT_TOKEN_WARN_FLOOR) {
      compactLowWarning = `当前阈值（${finalCfg.tacticalModes.compactThresholdInput}）低于安全建议线 32K，可能导致上下文频繁压缩丢失现场细节`
    } else if (!compactLowWarning && finalCfg.tacticalModes.compactThresholdMode !== 'tokens' && finalCfg.tacticalModes.compactThresholdPct < COMPACT_PCT_WARN_FLOOR) {
      compactLowWarning = `当前触发比例（${finalCfg.tacticalModes.compactThresholdPct}%）低于安全建议线 ${COMPACT_PCT_WARN_FLOOR}%，可能导致上下文频繁提前归档压缩`
    }
    return {
      ok: true,
      ...(presetSpec ? { appliedPreset: presetSpec.id } : {}),
      ...(compactLowWarning ? { compactLowWarning } : {}),
      config: { ...finalCfg, tacticalModes: { ...finalCfg.tacticalModes } },
      llmLedger: summarizeLlmLedger(ws.llmLedger, finalCfg),
    }
  })
}

export function mutateChiefFact(deps, { sessionId, op, id, text, category, pinned }) {
  const rootId = deps.resolveRootSessionId(sessionId) || String(sessionId || 'global')
  return mutateChiefState((state) => {
    const ws = ensureWorkspace(state, rootId)
    if (op === 'add') {
      const cat = category || 'discipline'
      const activeCluster = getLinkedCluster(state, rootId)
      const fact = normalizeFact({
        text,
        category: cat,
        by: 'user',
        pinned: Boolean(pinned),
        originRootId: rootId === 'global' ? '' : rootId,
        peerRootIds: cat === 'team' ? activeCluster.filter(pid => pid !== rootId) : [],
      })
      if (!fact) return { ok: false, error: '条目无效或包含敏感凭据' }
      ws.facts.push(fact)
      if (ws.facts.length > FACTS_CAP) ws.facts = ws.facts.slice(-FACTS_CAP)
      return { ok: true, fact }
    }
    const target = ws.facts.find(f => f.id === id)
    if (!target) return { ok: false, error: '未找到该记忆条目' }
    if (op === 'remove') {
      ws.facts = ws.facts.filter(f => f.id !== id)
      return { ok: true }
    }
    if (op === 'pin') {
      target.pinned = Boolean(pinned)
      target.updatedAt = Date.now()
      return { ok: true, fact: target }
    }
    if (op === 'edit') {
      const clean = clamp(text, FACT_TEXT_MAX)
      if (!clean || secretLike(clean)) return { ok: false, error: '内容无效或包含敏感凭据' }
      target.text = clean
      if (category) target.category = category
      target.updatedAt = Date.now()
      return { ok: true, fact: target }
    }
    return { ok: false, error: '未知操作: ' + op }
  })
}

export function shortAgentBriefName(name) {
  const raw = String(name || '').trim()
  if (!raw) return ''
  return raw
    .split('/')
    .map(seg => seg.replace(/[-_]([0-9a-f]{8,40})$/i, (_, hex) => '·' + hex.slice(0, 4)))
    .join('/')
}

export function stripCheckpointNoise(text) {
  return String(text || '')
    .replace(/\[dsh-mnemon:[^\]]*\][\s\S]*/gi, '')
    .replace(/Bounded completed checkpoint[\s\S]*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isInternalCheckpointNoise(text) {
  const s = stripCheckpointNoise(text)
  if (!s) return true
  if (/^Mnemon idle checkpoint review\b/i.test(s)) return true
  return false
}

function repairJsonInvalidEscapes(jsonStr) {
  let out = ''
  let inString = false
  for (let i = 0; i < jsonStr.length; i += 1) {
    const ch = jsonStr[i]
    if (!inString) {
      if (ch === '"') inString = true
      out += ch
      continue
    }
    if (ch === '"') {
      inString = false
      out += ch
      continue
    }
    if (ch === '\\') {
      const next = jsonStr[i + 1]
      if (next === undefined) {
        out += '\\\\'
        continue
      }
      if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(jsonStr.slice(i + 2, i + 6))) {
        out += jsonStr.slice(i, i + 6)
        i += 5
        continue
      }
      if ('"\\/bfnrt'.includes(next)) {
        out += '\\' + next
        i += 1
        continue
      }
      // Escape invalid bare backslash (e.g. regex \s, \., Windows D:\path) inside JSON strings
      out += '\\\\'
      continue
    }
    out += ch
  }
  return out
}

function tryParseJsonRobust(candidate) {
  if (!candidate) return null
  try {
    const parsed = JSON.parse(candidate)
    if (parsed && typeof parsed === 'object') return parsed
  } catch {}
  try {
    const repaired = repairJsonInvalidEscapes(candidate)
    const parsed = JSON.parse(repaired)
    if (parsed && typeof parsed === 'object') return parsed
  } catch {}
  return null
}

export function extractJsonObject(raw) {
  const text = String(raw || '').trim()
  if (!text) return null
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const direct = tryParseJsonRobust(stripped)
  if (direct) return direct
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first !== -1 && last > first) {
    const sliced = tryParseJsonRobust(text.slice(first, last + 1))
    if (sliced) return sliced
  }
  return null
}

const activeChiefWorkMap = new Map()
const ACTIVE_CHIEF_WORK_TTL_MS = 90_000

export function beginChiefActiveWork(rootSessionId, spec = {}) {
  const key = String(rootSessionId || 'global').trim() || 'global'
  const id = 'cwork-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
  activeChiefWorkMap.set(key, {
    id,
    tone: String(spec.tone || 'neon'),
    tab: String(spec.tab || ''),
    boundSubTab: String(spec.boundSubTab || ''),
    label: String(spec.label || '参谋长正在自动维护中...'),
    startedAt: Date.now(),
  })
  return id
}

export function updateChiefActiveWork(rootSessionId, workId, patchSpec = {}) {
  const key = String(rootSessionId || 'global').trim() || 'global'
  const cur = activeChiefWorkMap.get(key)
  if (!cur || (workId && cur.id !== workId)) return false
  activeChiefWorkMap.set(key, {
    ...cur,
    ...(patchSpec.tone ? { tone: String(patchSpec.tone) } : {}),
    ...(patchSpec.tab !== undefined ? { tab: String(patchSpec.tab || '') } : {}),
    ...(patchSpec.boundSubTab !== undefined ? { boundSubTab: String(patchSpec.boundSubTab || '') } : {}),
    ...(patchSpec.label ? { label: String(patchSpec.label) } : {}),
  })
  return true
}

export function endChiefActiveWork(rootSessionId, workId = '') {
  const key = String(rootSessionId || 'global').trim() || 'global'
  const cur = activeChiefWorkMap.get(key)
  if (!cur) return false
  if (workId && cur.id !== workId) return false
  activeChiefWorkMap.delete(key)
  return true
}

export function getChiefActiveWork(rootSessionId) {
  const key = String(rootSessionId || 'global').trim() || 'global'
  const cur = activeChiefWorkMap.get(key)
  if (!cur) return null
  if (Date.now() - Number(cur.startedAt || 0) > ACTIVE_CHIEF_WORK_TTL_MS) {
    activeChiefWorkMap.delete(key)
    return null
  }
  return { ...cur }
}

/** Persist a critical alert event onto a workspace so UI can fire desktop notifications / gentle chimes without replay storms. */
export function recordWorkspaceAlertEvent(rootSessionId, spec = {}) {
  const key = String(rootSessionId || 'global').trim() || 'global'
  try {
    return mutateChiefState((state) => {
      const ws = ensureWorkspace(state, key)
      return pushAlertEventToWs(ws, spec)
    })
  } catch {
    return null
  }
}

function tripManagedBudgetCircuit(state, ws, rootId, reason) {
  const now = Date.now()
  const effNow = resolveWorkspaceConfig(state, rootId)
  if (!ws.config || typeof ws.config !== 'object') ws.config = { ...effNow }
  ws.config.runMode = 'off'
  ws.config.paceMode = 'manual'
  ws.config.autoPilot = false
  ws.config.autoReview = false
  ws.config.tacticalModes = { ...normalizeTacticalModes(ws.config.tacticalModes), intervention: false }
  if (state.config && (state.config.runMode === 'managed' || state.config.paceMode === 'auto')) {
    state.config.runMode = 'off'
    state.config.paceMode = 'manual'
    state.config.autoPilot = false
    state.config.autoReview = false
  }
  ws.llmLedger = normalizeLlmLedger(ws.llmLedger)
  ws.llmLedger.managedRun.tripped = true
  ws.llmLedger.managedRun.trippedAt = now
  ws.llmLedger.managedRun.trippedReason = clamp(reason || '已触及托管硬预算上限，自动熔断休眠', 200)
  ws.chat.push({
    id: nextId('chat'),
    role: 'chief',
    kind: 'receipt',
    text: `- 【🛑 托管硬预算熔断】${ws.llmLedger.managedRun.trippedReason}\n- 已自动将运行模式退回「⏸ 关停」（人工问答仍可随时使用），保护 Token 费用。`,
    actions: ['🛑 硬预算熔断'],
    at: now,
  })
  if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
  pushAuditToWs(ws, {
    mode: effNow.permissionMode,
    stage: 'budget_guard',
    rule: 'managed_budget_exceeded',
    decision: 'tripped',
    operation: '托管硬预算上限熔断',
    target: rootId,
    reason: ws.llmLedger.managedRun.trippedReason,
    outcome: 'blocked',
    by: 'chief',
  }, rootId)
  pushAlertEventToWs(ws, {
    kind: 'budget_circuit_break',
    level: 'danger',
    title: '🛑 托管已达预算上限并熔断',
    body: ws.llmLedger.managedRun.trippedReason,
    dedupeKey: `budget:${rootId}:${ws.llmLedger.managedRun.startedAt || 0}`,
    at: now,
  })
  return ws.llmLedger.managedRun.trippedReason
}

/** Check before background Managed LLM calls; never blocks human-initiated chat or consultation. */
export function checkManagedBudgetBeforeCall(rootSessionId, reasonKind = '') {
  const rootId = String(rootSessionId || 'global').trim() || 'global'
  const category = classifyChiefLlmCategory(reasonKind)
  if (category !== 'review' && category !== 'dream') {
    return { allowed: true, category }
  }
  const st = loadChiefState()
  const effCfg = resolveWorkspaceConfig(st, rootId)
  const wsSnap = st.workspaces && st.workspaces[rootId] ? st.workspaces[rootId] : null
  const ledger = normalizeLlmLedger(wsSnap && wsSnap.llmLedger)
  const mr = ledger.managedRun
  if (mr.tripped && !effCfg.stopped && effCfg.runMode !== 'patrol') {
    return {
      allowed: false,
      tripped: true,
      category,
      reason: mr.trippedReason || '本轮托管硬预算已触发熔断，请重置计数后再继续',
    }
  }
  if (effCfg.stopped || effCfg.runMode !== 'managed') {
    return { allowed: true, category }
  }
  const maxCalls = normalizeManagedBudgetCalls(effCfg.managedBudgetMaxCalls)
  const maxTokens = normalizeManagedBudgetTokens(effCfg.managedBudgetMaxTokens)
  let exceedReason = ''
  if (mr.tripped) {
    exceedReason = mr.trippedReason || '本轮托管硬预算已触发熔断，请重置计数后再继续'
  } else if (maxCalls > 0 && mr.calls >= maxCalls) {
    exceedReason = `托管后台 LLM 调用已达上限 ${mr.calls}/${maxCalls} 次`
  } else if (maxTokens > 0 && mr.tokens >= maxTokens) {
    exceedReason = `托管后台 Token 消耗已达上限 ${formatCompactTokenShort(mr.tokens)}/${formatCompactTokenShort(maxTokens)}`
  }
  if (!exceedReason) {
    return { allowed: true, category }
  }
  const trippedReason = mutateChiefState((state) => {
    const ws = ensureWorkspace(state, rootId)
    return tripManagedBudgetCircuit(state, ws, rootId, exceedReason)
  })
  return { allowed: false, tripped: true, category, reason: trippedReason }
}

/** Record every Chief LLM call usage and enforce Managed-mode hard budget cap immediately when reached. */
export function recordChiefLlmUsage(rootSessionId, {
  reasonKind = '',
  modelRef = '',
  inputTokens = 0,
  outputTokens = 0,
  estimated = false,
  ok = true,
} = {}) {
  const rootId = String(rootSessionId || 'global').trim() || 'global'
  const category = classifyChiefLlmCategory(reasonKind)
  const inTok = Math.min(LLM_LEDGER_TOKENS_MAX, Math.max(0, Math.round(Number(inputTokens) || 0)))
  const outTok = Math.min(LLM_LEDGER_TOKENS_MAX, Math.max(0, Math.round(Number(outputTokens) || 0)))
  const totTok = Math.min(LLM_LEDGER_TOKENS_MAX, inTok + outTok)
  const now = Date.now()
  return mutateChiefState((state) => {
    const ws = ensureWorkspace(state, rootId)
    const effCfg = resolveWorkspaceConfig(state, rootId)
    ws.llmLedger = normalizeLlmLedger(ws.llmLedger)
    const ledger = ws.llmLedger
    ledger.totalCalls = Math.min(LLM_LEDGER_CALLS_MAX, ledger.totalCalls + 1)
    ledger.totalInputTokens = Math.min(LLM_LEDGER_TOKENS_MAX, ledger.totalInputTokens + inTok)
    ledger.totalOutputTokens = Math.min(LLM_LEDGER_TOKENS_MAX, ledger.totalOutputTokens + outTok)
    ledger.totalTokens = Math.min(LLM_LEDGER_TOKENS_MAX, ledger.totalTokens + totTok)
    if (!ledger.byCategory[category]) ledger.byCategory[category] = { calls: 0, tokens: 0 }
    ledger.byCategory[category].calls = Math.min(LLM_LEDGER_CALLS_MAX, ledger.byCategory[category].calls + 1)
    ledger.byCategory[category].tokens = Math.min(LLM_LEDGER_TOKENS_MAX, ledger.byCategory[category].tokens + totTok)
    ledger.recent.push({
      id: nextId('llm'),
      at: now,
      category,
      reasonKind: clamp(reasonKind || '', 40),
      modelRef: clamp(modelRef || '', 80),
      inputTokens: inTok,
      outputTokens: outTok,
      totalTokens: totTok,
      estimated: Boolean(estimated),
      ok: ok !== false,
    })
    if (ledger.recent.length > LLM_LEDGER_RECENT_CAP) {
      ledger.recent = ledger.recent.slice(-LLM_LEDGER_RECENT_CAP)
    }

    let trippedReason = ''
    if (!effCfg.stopped && effCfg.runMode === 'managed' && (category === 'review' || category === 'dream')) {
      if (!ledger.managedRun.startedAt) ledger.managedRun.startedAt = now
      ledger.managedRun.calls = Math.min(LLM_LEDGER_CALLS_MAX, ledger.managedRun.calls + 1)
      ledger.managedRun.tokens = Math.min(LLM_LEDGER_TOKENS_MAX, ledger.managedRun.tokens + totTok)
      const maxCalls = normalizeManagedBudgetCalls(effCfg.managedBudgetMaxCalls)
      const maxTokens = normalizeManagedBudgetTokens(effCfg.managedBudgetMaxTokens)
      if (maxCalls > 0 && ledger.managedRun.calls >= maxCalls) {
        trippedReason = tripManagedBudgetCircuit(
          state,
          ws,
          rootId,
          `托管后台 LLM 调用已达硬预算上限 (${ledger.managedRun.calls}/${maxCalls} 次)`,
        )
      } else if (maxTokens > 0 && ledger.managedRun.tokens >= maxTokens) {
        trippedReason = tripManagedBudgetCircuit(
          state,
          ws,
          rootId,
          `托管后台 Token 消耗已达硬预算上限 (${formatCompactTokenShort(ledger.managedRun.tokens)}/${formatCompactTokenShort(maxTokens)})`,
        )
      }
    }
    return {
      ok: true,
      category,
      tripped: Boolean(ws.llmLedger.managedRun.tripped && trippedReason),
      trippedReason,
      ledger: summarizeLlmLedger(ws.llmLedger, resolveWorkspaceConfig(state, rootId)),
    }
  })
}

export const OFFICIAL_HARNESS_CATALOG = [
  {
    provider: 'codex',
    label: 'Codex',
    packageName: '@deepseek-ai/dsh-subagent-codex',
    accent: '#10b981',
    roleHint: '独立代码实现 / 重构 / 单测',
  },
  {
    provider: 'claude-code',
    label: 'Claude Code',
    packageName: '@deepseek-ai/dsh-subagent-claude-code',
    accent: '#f59e0b',
    roleHint: '架构审查 / 深度排障 / 代码评审',
  },
  {
    provider: 'acp',
    label: 'ACP Agent',
    packageName: '@deepseek-ai/dsh-subagent-acp',
    accent: '#a855f7',
    roleHint: '通用 ACP 外部 Harness 进程',
  },
  {
    provider: 'dsh-sdk',
    label: 'DSH Sub-Instance',
    packageName: '@deepseek-ai/dsh-subagent-dsh-sdk',
    accent: '#38bdf8',
    roleHint: '独立 Profile / 模型 DSH 子实例',
  },
]

export function normalizeBubbleHarness(raw) {
  if (!raw || typeof raw !== 'object') return null
  const provider = clamp(String(raw.provider || '').trim(), 64)
  if (!provider || provider === 'spawn' || provider === 'fork') return null
  const meta = OFFICIAL_HARNESS_CATALOG.find(item => item.provider === provider)
  return {
    provider,
    label: clamp(raw.label || (meta ? meta.label : provider), 48),
    role: clamp(raw.role || (meta ? meta.roleHint : '外部 Harness 协同成员'), 90),
    accent: (meta && meta.accent) || '#38bdf8',
    joinedAt: Math.max(0, Number(raw.joinedAt) || Date.now()),
  }
}

export function setBubbleHarnessMembership(rootId, { provider, label = '', role = '', joined = true } = {}) {
  const rid = String(rootId || '').trim()
  const pName = clamp(String(provider || '').trim(), 64)
  if (!rid) return { ok: false, error: '当前会话尚未绑定，无法调整协同水泡' }
  if (!pName || pName === 'spawn' || pName === 'fork') {
    return { ok: false, error: '无效的外部 Harness Provider 名称' }
  }
  return mutateChiefState((state) => {
    const ws = ensureWorkspace(state, rid)
    const cur = Array.isArray(ws.bubbleHarnesses) ? ws.bubbleHarnesses : []
    if (joined) {
      const entry = normalizeBubbleHarness({ provider: pName, label, role, joinedAt: Date.now() })
      const next = cur.filter(item => item && item.provider !== pName)
      next.push(entry)
      ws.bubbleHarnesses = next.slice(-12)
      pushAuditToWs(ws, {
        kind: 'bubble_harness_join',
        decision: 'allowed',
        tool: pName,
        reason: `将外部 Harness「${entry.label}」拖入协同作战水泡`,
      }, rid)
    } else {
      ws.bubbleHarnesses = cur.filter(item => item && item.provider !== pName)
      pushAuditToWs(ws, {
        kind: 'bubble_harness_leave',
        decision: 'allowed',
        tool: pName,
        reason: `将外部 Harness「${pName}」移出协同作战水泡`,
      }, rid)
    }
    return { ok: true, bubbleHarnesses: ws.bubbleHarnesses.slice() }
  })
}

export function setBubbleManualLock(rootId, { locked = false, reason = '' } = {}) {
  const rid = String(rootId || '').trim()
  if (!rid) return { ok: false, error: '当前会话尚未绑定' }
  return mutateChiefState((state) => {
    const ws = ensureWorkspace(state, rid)
    ws.bubbleLock = {
      manualLocked: Boolean(locked),
      lockedAt: locked ? Date.now() : 0,
      reason: locked ? clamp(reason || '手动锁定编队结构，防止工作中拆散', 120) : '',
    }
    pushAuditToWs(ws, {
      kind: 'bubble_lock_set',
      decision: 'allowed',
      tool: 'bubble_lock',
      reason: locked ? `锁定协同水泡结构：${ws.bubbleLock.reason}` : '解除协同水泡手动结构锁',
    }, rid)
    return { ok: true, bubbleLock: { ...ws.bubbleLock } }
  })
}
