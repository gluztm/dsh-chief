/**
 * DSH Chief Engine (DSH 参谋长核心引擎)
 *
 * Bridges human natural-language intent, DS-Bot style narrative memory digests,
 * and cross-session / subagent SuperAgent communication on top of the shared chief.
 *
 * Key capabilities:
 * 1. Independent Chief Model selector (`ctx.llm`) with lowest-reasoning fast routing & fallback.
 * 2. Two-tier memory inspired by DS-Bot: atomic durable facts + prose narrative digest ("摘要").
 * 3. Natural-language command decomposition -> targeted relay / interjection (`steer` / `followup` / `silent`).
 * 4. Cross-session & subagent communication bus (`mail.send` / `mail.inbox` / `mail.ack` + linked peer windows).
 * 5. Post-turn background review & proactive Suggestion Pills (with toggleable Auto-Pilot mode).
 * 6. KV-Cache friendly delta updates via `agent/pre-step` (never mutating historical messages).
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import {
  DEFAULT_ARCHIVE_FOLDERS,
  resolveProjectKey,
  loadArchiveStore,
  getChiefMountedGlobalForSession,
  getTakenOutGlobalForSession,
  collectSealedWatchSummary,
  listArchiveHeaders,
  getArchiveDetail,
  searchArchives,
  searchGlobalVaultForChief,
  smartParseNoteToDossier,
  mutateArchive,
  applyChiefArchiveCurations,
  copyPrecipitatedToVault,
  getFlippedOutPrecipitatedForSession,
  listPrecipitatedHeaders,
  getPrecipitatedDetail,
  savePrecipitatedEntry,
  mutatePrecipitated,
} from './archives.js'
import {
  CHIEF_PERMISSION_MODES,
  DEFAULT_CHIEF_PERMISSION_MODE,
  CHIEF_PERMISSION_META,
  normalizePermissionMode,
  permissionRank,
  evaluateSafetyGuardHardRules,
  evaluateChiefPermissionGate,
  describeControlledOperationMeta,
  executeChiefToolCall,
  CHIEF_TOOLS_PROMPT_GUIDE,
  runChiefAgenticLoop,
  stripToolCallMarkup,
} from './chief-executor.js'

export { CHIEF_PERMISSION_MODES, DEFAULT_CHIEF_PERMISSION_MODE, CHIEF_PERMISSION_META, normalizePermissionMode }

const APPROVALS_CAP = 30
const AUDIT_LOG_CAP = 80

const STATE_VERSION = 1
const FACTS_CAP = 120
const FACT_TEXT_MAX = 260
const CHAT_CAP = 36
const MAIL_CAP = 80
const SUGGESTIONS_CAP = 6
const MODEL_TIMEOUT_MS = 90_000
const CATALOG_TTL_MS = 10_000
const REVIEW_DELAY_MS = 2_800
const AUTO_SUMMARY_COOLDOWN_MS = 5 * 60_000
const SMART_REVIEW_COOLDOWN_MS = 3 * 60_000
const AUTO_REVIEW_COOLDOWN_MS = 90_000
// Thinking models spend several thousand output tokens on internal reasoning before emitting text;
// small caps (e.g. 2k-4k) starve the visible answer to empty string.
const SUMMARY_MAX_TOKENS = 16_384
const SUMMARY_RETRY_MAX_TOKENS = 32_768

export const CHIEF_UPDATE_SOURCE = 'dsh-chief-update'
export const CHIEF_RELAY_SOURCE = 'dsh-chief-relay'

const SECRET_PATTERN = /(?:sk-[a-zA-Z0-9_-]{16,}|ghp_[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|Bearer\s+[A-Za-z0-9._~+/=-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/

let dshLlmModulePromise = null
async function loadDshLlm() {
  if (!dshLlmModulePromise) {
    dshLlmModulePromise = import('@deepseek-ai/dsh-llm').catch(() => null)
  }
  return dshLlmModulePromise
}

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

function resolveSessionWorkspaceCwd(deps, sessionId) {
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

function archiveTargetForRoot(deps, rootId, extra = '') {
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
 * Chief-of-Staff visibility matrix (0-Token Global Cold Vault):
 * - Sees current session's Working Cabinet (`session`), if bound to a concrete rootSessionId
 * - Sees ONLY System Global Cold Vault entries explicitly mounted for Chief in THIS session (`chiefMountedSessions`) — 0 Token by default!
 * - Sees Precipitated Vault entries ONLY when explicitly `flippedOut` (`ws.flippedPrecipitatedIds`) for this session!
 */
function collectChiefVisibleArchives(deps, rootId, stateSnapshot = null) {
  const sid = rootId && rootId !== 'global' ? String(rootId).trim() : ''
  const sessionTarget = sid ? archiveTargetForRoot(deps, sid, { vaultScope: 'session' }) : null
  const globalTarget = archiveTargetForRoot(deps, sid || 'global', { vaultScope: 'global' })
  const baseOpt = sessionTarget || globalTarget
  const projectKey = resolveProjectKey(baseOpt.cwd)

  let deskSessionItems = []
  let deskGlobalItems = []
  let deskFlippedItems = []
  let mountedGlobalItems = []
  let sealedWatch = { sessionSealed: [], globalSealed: [], precipSealed: [] }

  try {
    if (sessionTarget) {
      const stSess = loadArchiveStore(sessionTarget)
      const allSess = Array.isArray(stSess.items) ? stSess.items : []
      deskSessionItems = allSess.filter(it => Array.isArray(it.takenOutSessions) && it.takenOutSessions.includes(sid)).slice(0, 6)
    }
  } catch {}
  try {
    if (sid) {
      deskGlobalItems = getTakenOutGlobalForSession(sid, globalTarget).slice(0, 6)
      mountedGlobalItems = getChiefMountedGlobalForSession(sid, globalTarget).slice(0, 6)
    }
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
function nextId(prefix) {
  idSeq = (idSeq + 1) % 1000000
  return prefix + '-' + Date.now().toString(36) + '-' + idSeq.toString(36)
}

function clamp(value, max) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  return text.slice(0, Math.max(0, max - 1)) + '…'
}

function cleanMultiline(value, max) {
  const text = String(value == null ? '' : value).replace(/\r/g, '').trim()
  if (text.length <= max) return text
  return text.slice(0, Math.max(0, max - 1)) + '…'
}

function secretLike(text) {
  return SECRET_PATTERN.test(String(text || ''))
}

function chiefDir() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'chief')
}

function stateFilePath() {
  return path.join(chiefDir(), 'chief-state.json')
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
  const validStatuses = ['pending', 'approved', 'rejected', 'executed', 'failed']
  const status = validStatuses.includes(raw.status) ? raw.status : 'pending'
  const validKinds = ['tool', 'relay', 'compact', 'auto_continue']
  const kind = validKinds.includes(raw.kind) ? raw.kind : 'tool'
  const validCategories = ['workspace_file', 'system_command', 'main_workflow', 'subagent_workflow']
  const category = validCategories.includes(raw.category) ? raw.category : 'workspace_file'
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
    payload: raw.payload && typeof raw.payload === 'object' ? raw.payload : {},
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
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : nextId('elv'),
    status: 'pending',
    fromMode: normalizePermissionMode(raw.fromMode || 'advisor'),
    targetMode,
    reason: clamp(raw.reason || '当前任务需要更高参谋权限才能继续执行', 260),
    requestedActionSummary: clamp(raw.requestedActionSummary || '', 220),
    by: clamp(raw.by || 'chief', 40),
    createdAt: Number(raw.createdAt) || Date.now(),
  }
}

function normalizeAuditEntry(raw) {
  if (!raw || typeof raw !== 'object') return null
  const op = clamp(raw.operation || raw.tool || '', 80)
  if (!op) return null
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : nextId('aud'),
    at: Number(raw.at) || Date.now(),
    mode: normalizePermissionMode(raw.mode || DEFAULT_CHIEF_PERMISSION_MODE),
    stage: clamp(raw.stage || 'executor', 40),
    decision: clamp(raw.decision || 'executed', 40),
    operation: op,
    target: clamp(raw.target || '', 140),
    reason: clamp(raw.reason || '', 220),
    outcome: clamp(raw.outcome || 'ok', 40),
    by: clamp(raw.by || 'chief', 40),
  }
}

function pushAuditToWs(ws, entry = {}) {
  if (!ws || typeof ws !== 'object') return null
  if (!Array.isArray(ws.auditLog)) ws.auditLog = []
  const norm = normalizeAuditEntry(entry)
  if (!norm) return null
  ws.auditLog.push(norm)
  if (ws.auditLog.length > AUDIT_LOG_CAP) ws.auditLog = ws.auditLog.slice(-AUDIT_LOG_CAP)
  return norm
}

function emptyWorkspace() {
  return {
    config: null,
    chiefRiskAck: null,
    pendingApprovals: [],
    pendingElevation: null,
    auditLog: [],
    facts: [],
    narrative: { hash: '', text: '', at: 0, byModel: '', clusterSig: '' },
    suggestions: [],
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
      lastAutoArchiveOrgAt: 0,
    },
    flippedPrecipitatedIds: [],
  }
}

function normalizeFact(raw) {
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

function normalizeSuggestion(raw) {
  if (!raw || typeof raw !== 'object') return null
  const title = clamp(raw.title, 90)
  if (!title) return null
  const kind = ['bound', 'board', 'goal_approval', 'relay', 'advice'].includes(raw.kind) ? raw.kind : 'relay'
  const boundField = ['forbidden', 'allowed', 'notes'].includes(raw.boundField) ? raw.boundField : 'forbidden'
  const replaces = Array.isArray(raw.replaces)
    ? raw.replaces.map(x => String(x || '').trim()).filter(Boolean).slice(0, 20)
    : []
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : nextId('sug'),
    kind,
    boundField,
    replaces,
    pinGlobal: Boolean(raw.pinGlobal),
    fromAgent: clamp(raw.fromAgent || '', 48),
    title,
    reason: clamp(raw.reason || '', 220),
    target: clamp(raw.target || (kind === 'bound' ? 'bounds' : kind === 'goal_approval' ? 'board' : 'lead'), 64),
    targetLabel: clamp(raw.targetLabel || raw.target || (kind === 'bound' ? '工作边界' : kind === 'goal_approval' ? '目标结项批示' : kind === 'advice' ? '参谋进言' : '主对话'), 40),
    mode: ['steer', 'followup', 'silent'].includes(raw.mode) ? raw.mode : (kind === 'advice' ? 'followup' : 'steer'),
    draftText: cleanMultiline(raw.draftText || '', 600),
    evidence: cleanMultiline(raw.evidence || '', 600),
    missing: clamp(raw.missing || '', 300),
    boardOp: raw.boardOp && typeof raw.boardOp === 'object' ? raw.boardOp : null,
    popup: Boolean(raw.popup || kind === 'advice'),
    urgency: ['normal', 'high'].includes(raw.urgency) ? raw.urgency : 'normal',
    status: ['pending', 'applied', 'dismissed'].includes(raw.status) ? raw.status : 'pending',
    createdAt: Number(raw.createdAt) || Date.now(),
  }
}

function normalizeMail(raw) {
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
  base.chat = (Array.isArray(src.chat) ? src.chat : [])
    .filter(item => item && typeof item === 'object' && typeof item.text === 'string')
    .slice(-CHAT_CAP)
    .map(item => {
      const imageCount = Math.max(0, Math.round(Number(item.imageCount) || 0))
      return {
        id: String(item.id || nextId('chat')),
        role: item.role === 'user' ? 'user' : 'chief',
        text: cleanMultiline(item.text, 2000),
        target: item.target ? String(item.target) : '',
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
    lastAutoArchiveOrgAt: Math.max(0, Number(rg.lastAutoArchiveOrgAt) || 0),
  }
  base.chiefRiskAck = normalizeChiefRiskAck(src.chiefRiskAck)
  base.pendingApprovals = (Array.isArray(src.pendingApprovals) ? src.pendingApprovals : [])
    .map(normalizePendingApproval)
    .filter(Boolean)
    .slice(-APPROVALS_CAP)
  base.pendingElevation = normalizePendingElevation(src.pendingElevation)
  base.auditLog = (Array.isArray(src.auditLog) ? src.auditLog : [])
    .map(normalizeAuditEntry)
    .filter(Boolean)
    .slice(-AUDIT_LOG_CAP)
  const ackOk = hasValidChiefRiskAck(base)
  if (src.config && typeof src.config === 'object') {
    const validPaces = ['manual', 'smart', 'auto', 'stopped']
    const pm = validPaces.includes(src.config.paceMode) ? src.config.paceMode : undefined
    const rawStopped = typeof src.config.stopped === 'boolean' ? src.config.stopped : (pm === 'stopped')
    const rawPerm = typeof src.config.permissionMode === 'string'
      ? normalizePermissionMode(src.config.permissionMode, { requireAck: true, hasChiefRiskAck: ackOk })
      : DEFAULT_CHIEF_PERMISSION_MODE
    base.config = {
      ...(typeof src.config.modelRef === 'string' ? { modelRef: src.config.modelRef.trim() } : {}),
      permissionMode: rawPerm,
      ...(typeof src.config.stopped === 'boolean' || pm === 'stopped' ? { stopped: rawStopped } : {}),
      ...(pm ? { paceMode: pm, autoPilot: !rawStopped && pm === 'auto', autoReview: !rawStopped && pm !== 'manual' } : {}),
      ...(src.config.tacticalModes && typeof src.config.tacticalModes === 'object'
        ? { tacticalModes: normalizeTacticalModes(src.config.tacticalModes) }
        : {}),
    }
  }
  base.flippedPrecipitatedIds = Array.isArray(src.flippedPrecipitatedIds)
    ? [...new Set(src.flippedPrecipitatedIds.map(x => String(x || '').trim()).filter(Boolean))].slice(0, 20)
    : []
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
  const permissionMode = normalizePermissionMode(rawPerm, {
    requireAck: true,
    hasChiefRiskAck: ackOk,
  })
  const chiefRiskVerified = permissionMode === 'chief' ? ackOk : false
  return {
    modelRef,
    paceMode,
    stopped,
    permissionMode,
    chiefRiskVerified,
    autoPilot: !stopped && paceMode === 'auto',
    autoReview: !stopped && paceMode !== 'manual',
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

function normalizeTacticalModes(raw) {
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
  return {
    version: STATE_VERSION,
    config: {
      modelRef: typeof cfg.modelRef === 'string' ? cfg.modelRef.trim() : '',
      paceMode,
      stopped,
      permissionMode: DEFAULT_CHIEF_PERMISSION_MODE,
      autoPilot: !stopped && paceMode === 'auto',
      autoReview: !stopped && paceMode !== 'manual',
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
    return pushAuditToWs(ws, entry)
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
  const norm = normalizePendingApproval({ ...item, status: 'pending', dedupeKey: dKey })
  if (!norm) return null
  ws.pendingApprovals.push(norm)
  if (ws.pendingApprovals.length > APPROVALS_CAP) {
    ws.pendingApprovals = ws.pendingApprovals.slice(-APPROVALS_CAP)
  }
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
  const norm = normalizePendingElevation({
    fromMode: currentMode,
    targetMode,
    reason: req.reason || 'Agent 申请提升权限以继续当前任务',
    requestedActionSummary: req.requestedActionSummary || '',
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
  })
  return norm
}

export function requestChiefElevation(sessionId = 'global', req = {}) {
  const rootId = String(sessionId || 'global').trim() || 'global'
  return mutateChiefState((state) => {
    const ws = ensureWorkspace(state, rootId)
    return enqueueElevationToWs(ws, req)
  })
}

let cachedState = null
let cachedMtime = 0

export function loadChiefState() {
  const file = stateFilePath()
  try {
    const stat = fs.statSync(file)
    if (cachedState && stat.mtimeMs === cachedMtime) return cachedState
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    cachedState = normalizeState(parsed)
    cachedMtime = stat.mtimeMs
    return cachedState
  } catch {
    if (!cachedState) cachedState = normalizeState({})
    return cachedState
  }
}

export function saveChiefState(state) {
  const normalized = normalizeState(state)
  const file = stateFilePath()
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = file + '.' + process.pid + '.' + Date.now().toString(36) + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(normalized, null, 2), 'utf8')
    fs.renameSync(tmp, file)
    try {
      cachedMtime = fs.statSync(file).mtimeMs
    } catch {
      cachedMtime = Date.now()
    }
  } catch {}
  cachedState = normalized
  return normalized
}

export function mutateChiefState(mutator) {
  const state = loadChiefState()
  const result = mutator(state)
  saveChiefState(state)
  return result
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

function ensureWorkspace(state, rootId) {
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
function clusterView(state, rootId) {
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

let modelCatalogCache = { at: 0, items: [] }

export function invalidateChiefModelCatalog() {
  modelCatalogCache = { at: 0, items: [] }
  unusableRouteUntil.clear()
}

function splitModelRef(ref) {
  const clean = String(ref || '').trim()
  const idx = clean.indexOf('/')
  if (idx <= 0 || idx >= clean.length - 1) return null
  return { provider: clean.slice(0, idx), model: clean.slice(idx + 1), ref: clean }
}

function stripVendorPrefixFromModelId(modelId) {
  const raw = String(modelId || '').trim()
  if (!raw.includes('/')) return raw
  const parts = raw.split('/').filter(Boolean)
  return parts.length > 1 ? parts.slice(1).join('/') : raw
}

function shortProviderTag(providerId, providerName) {
  const pid = String(providerId || '').toLowerCase()
  const pname = String(providerName || '').trim()
  if (pid === 'commandcode' || /command\s*code/i.test(pname)) return 'Command Code'
  if (pid.includes('account') || /account/i.test(pname)) return pname || 'DeepSeek Account'
  if (pid === 'our-free-model') return 'Free Model'
  return pname || providerId || ''
}

export function formatChiefModelLabel(ref, items = [], providers = [], compact = false) {
  const parsed = splitModelRef(ref)
  if (!parsed) return compact ? '自动跟随' : ''
  const hit = Array.isArray(items) ? items.find(it => it && it.ref === parsed.ref) : null
  const provObj = Array.isArray(providers) ? providers.find(p => p && p.id === parsed.provider) : null
  const provLabel = shortProviderTag(parsed.provider, (hit && hit.providerName) || (provObj && (provObj.name || provObj.label)) || parsed.provider)
  const rawModelName = (hit && hit.name) ? String(hit.name).trim() : stripVendorPrefixFromModelId(parsed.model)

  if (compact) {
    // Keep channel crystal-clear so Command Code DS is never confused with official DeepSeek API
    const shortProv = parsed.provider === 'commandcode' ? 'CC' : provLabel
    const alreadyTagged = /\(CC\)/i.test(rawModelName) && shortProv === 'CC'
    const base = alreadyTagged ? rawModelName : (shortProv ? `${shortProv} · ${rawModelName}` : rawModelName)
    return clamp(base, 24)
  }
  const alreadyHasProv = provLabel && rawModelName.toLowerCase().includes(provLabel.toLowerCase())
  return alreadyHasProv || !provLabel ? rawModelName : `${provLabel} · ${rawModelName}`
}

function detectUnkeyedProviders(runtime, llm) {
  const missing = new Set()
  if (!runtime || !llm || typeof llm.listConfigurableProviders !== 'function') return missing
  try {
    const settings = runtime.get('settings')
    const credentials = runtime.get('credentials')
    if (!settings || !credentials || typeof settings.describe !== 'function') return missing
    const sections = new Map((settings.describe({ redactSecrets: true }) || []).map(s => [s.ns, s]))
    for (const entry of (llm.listConfigurableProviders() || [])) {
      if (!entry || !entry.provider || !Array.isArray(entry.settingsPath)) continue
      const sec = sections.get(entry.settingsNs)
      const profile = entry.settingsPath.reduce((v, k) => v?.[k], sec?.value)
      const keyEnv = typeof profile?.apiKeyEnv === 'string' && profile.apiKeyEnv ? profile.apiKeyEnv : ''
      if (keyEnv && process.env[keyEnv] === '') {
        // Explicit empty env hint; async describe handled below when needed
      }
    }
  } catch {}
  return missing
}

async function detectMissingProviderKeysAsync(runtime, llm, providerIds) {
  const missing = detectUnkeyedProviders(runtime, llm)
  if (!runtime || !llm || typeof llm.listConfigurableProviders !== 'function') return missing
  try {
    const settings = runtime.get('settings')
    const credentials = runtime.get('credentials')
    if (!settings || !credentials || typeof settings.describe !== 'function' || typeof credentials.describe !== 'function') {
      return missing
    }
    const sections = new Map((settings.describe({ redactSecrets: true }) || []).map(s => [s.ns, s]))
    const keyRefs = new Map()
    for (const entry of (llm.listConfigurableProviders() || [])) {
      if (!entry || !entry.provider || !Array.isArray(entry.settingsPath)) continue
      const sec = sections.get(entry.settingsNs)
      const profile = entry.settingsPath.reduce((v, k) => v?.[k], sec?.value)
      if (typeof profile?.apiKeyEnv === 'string' && profile.apiKeyEnv) {
        keyRefs.set(entry.provider, profile.apiKeyEnv)
      }
    }
    await Promise.all(
      providerIds
        .filter(id => keyRefs.has(id))
        .map(async (id) => {
          const info = await Promise.resolve(credentials.describe(keyRefs.get(id))).catch(() => undefined)
          if (info && info.configured === false) missing.add(id)
        }),
    )
  } catch {}
  return missing
}

function extractAgentModelRef(agent) {
  if (!agent) return ''
  try {
    const sess = agent.session
    const header = sess && typeof sess.requestHeader === 'function'
      ? sess.requestHeader()
      : (sess && sess.header ? sess.header : null)
    const candidates = [
      header && header.config,
      header,
      sess && sess.config,
      sess && sess.modelSelection,
      agent.modelSelection,
      agent.config,
    ]
    for (const cfg of candidates) {
      if (cfg && typeof cfg.provider === 'string' && cfg.provider && typeof cfg.model === 'string' && cfg.model) {
        if (!cfg.provider.startsWith('local-agent')) {
          return `${cfg.provider}/${cfg.model}`
        }
      }
    }
  } catch {}
  return ''
}

function sessionModelRef(deps, sessionId) {
  if (!deps || !deps.runtime) return ''
  try {
    const agents = deps.runtime.get('agents')
    if (!agents || typeof agents.get !== 'function') return ''
    if (sessionId) {
      const direct = extractAgentModelRef(agents.get(sessionId))
      if (direct) return direct
      const rootId = deps.resolveRootSessionId ? deps.resolveRootSessionId(sessionId) : ''
      if (rootId && rootId !== sessionId) {
        const rootRef = extractAgentModelRef(agents.get(rootId))
        if (rootRef) return rootRef
      }
    }
  } catch {}
  return ''
}

function profileDefaultModelRef(runtime) {
  if (!runtime) return ''
  try {
    const sel = runtime.get('agentDefaultModel')?.currentSelection?.()
    if (sel && sel.provider && sel.model && !String(sel.provider).startsWith('local-agent')) {
      return `${sel.provider}/${sel.model}`
    }
  } catch {}
  return ''
}

export async function listChiefModels(deps, fresh = false, sessionId = '') {
  const llm = deps.getLlm ? deps.getLlm() : null
  const runtime = deps.runtime
  const state = loadChiefState()
  const rootSid = (deps && deps.resolveRootSessionId ? deps.resolveRootSessionId(sessionId) : '') || String(sessionId || '').trim()
  const effCfg = resolveWorkspaceConfig(state, rootSid)
  let selectedRef = effCfg.modelRef || ''

  const leadRef = sessionModelRef(deps, sessionId)
  const profileDefaultRef = profileDefaultModelRef(runtime)
  const followRef = leadRef || profileDefaultRef || ''

  if (!llm || typeof llm.listProviders !== 'function' || typeof llm.listModels !== 'function') {
    const resolvedRef = selectedRef || followRef || ''
    return {
      available: false,
      selectedRef,
      followRef,
      followLabel: formatChiefModelLabel(followRef, [], [], false),
      defaultRef: followRef,
      resolvedRef,
      resolvedLabel: formatChiefModelLabel(resolvedRef, [], [], true),
      models: [],
    }
  }

  const rawProviders = (llm.listProviders() || []).filter(p => p && p.id && !String(p.id).startsWith('local-agent'))
  const registeredProviderIds = new Set(rawProviders.map(p => String(p.id)))

  // Auto-heal stale selectedRef if its provider was uninstalled/removed (e.g. legacy `opendesign/...`)
  if (selectedRef) {
    const parsedSel = splitModelRef(selectedRef)
    if (!parsedSel || (registeredProviderIds.size > 0 && !registeredProviderIds.has(parsedSel.provider))) {
      selectedRef = ''
      mutateChiefState((s) => {
        s.config.modelRef = ''
      })
    }
  }

  let items = []
  if (!fresh && modelCatalogCache.items.length > 0 && Date.now() - modelCatalogCache.at < CATALOG_TTL_MS) {
    items = modelCatalogCache.items.slice()
  } else {
    try {
      const missingKeys = await detectMissingProviderKeysAsync(runtime, llm, [...registeredProviderIds])
      for (const provider of rawProviders) {
        const pid = String(provider.id)
        const pname = String(provider.name || provider.label || pid)
        const needsKey = missingKeys.has(pid)
        let models = []
        try {
          models = (await llm.listModels(pid)) || []
        } catch {
          continue
        }
        for (const m of models) {
          if (!m || !m.id) continue
          items.push({
            ref: `${pid}/${m.id}`,
            provider: pid,
            providerName: pname,
            id: String(m.id),
            name: String(m.name || m.label || m.id),
            ...(needsKey ? { needsKey: true } : {}),
          })
        }
      }
    } catch {}
    modelCatalogCache = { at: Date.now(), items: items.slice() }
  }

  // Ensure the active main-conversation model (`followRef`) & `profileDefaultRef` appear in the catalog
  // even when a dynamic provider (e.g. Command Code) only returned a subset in `listModels()`!
  const ensureListed = async (refToEnsure, markCurrent = false) => {
    const parsed = splitModelRef(refToEnsure)
    if (!parsed || !registeredProviderIds.has(parsed.provider)) return
    const existing = items.find(it => it.ref === parsed.ref)
    if (existing) {
      if (markCurrent) existing.isCurrentLead = true
      return
    }
    const provObj = rawProviders.find(p => String(p.id) === parsed.provider)
    const pname = String((provObj && (provObj.name || provObj.label)) || parsed.provider)
    let displayName = stripVendorPrefixFromModelId(parsed.model)
    try {
      if (typeof llm.resolveModelInfo === 'function') {
        const info = await llm.resolveModelInfo(parsed.provider, parsed.model)
        if (info && typeof info.name === 'string' && info.name.trim()) {
          displayName = info.name.trim()
        }
      }
    } catch {}
    const entry = {
      ref: parsed.ref,
      provider: parsed.provider,
      providerName: pname,
      id: parsed.model,
      name: displayName,
      ...(markCurrent ? { isCurrentLead: true } : {}),
    }
    // Insert at the top of its provider group so it is immediately visible without scrolling
    const firstProvIdx = items.findIndex(it => it.provider === parsed.provider)
    if (firstProvIdx >= 0) items.splice(firstProvIdx, 0, entry)
    else items.unshift(entry)
  }

  await ensureListed(followRef, true)
  if (profileDefaultRef && profileDefaultRef !== followRef) {
    await ensureListed(profileDefaultRef, false)
  }
  if (selectedRef && selectedRef !== followRef && selectedRef !== profileDefaultRef) {
    await ensureListed(selectedRef, false)
  }

  const picked = pickRouteFromItems(items, selectedRef, followRef, deps, sessionId, registeredProviderIds)
  const resolvedRef = (picked && picked.ref) || selectedRef || followRef || ''
  return {
    available: items.length > 0 || Boolean(resolvedRef),
    selectedRef,
    followRef,
    followLabel: formatChiefModelLabel(followRef, items, rawProviders, false),
    defaultRef: followRef,
    resolvedRef,
    resolvedLabel: formatChiefModelLabel(resolvedRef, items, rawProviders, true),
    models: items,
  }
}

const unusableRouteUntil = new Map()

function isRouteCoolingDown(ref, provider) {
  const now = Date.now()
  if (ref && (unusableRouteUntil.get(ref) || 0) > now) return true
  if (provider && (unusableRouteUntil.get('prov:' + provider) || 0) > now) return true
  return false
}

function markRouteFailure(route, err) {
  if (!route) return
  const msg = String(err && err.message ? err.message : err || '')
  const code = String(err && (err.code || err.failure?.code) ? (err.code || err.failure?.code) : '')
  // Missing API key / auth error / hosted loop engine cannot serve auxiliary completions
  if (/api[_ -]?key|unauthorized|authentication|401|403|not configured|missing key|no key|credentials/i.test(msg) || /AUTH|KEY/i.test(code)) {
    unusableRouteUntil.set('prov:' + route.provider, Date.now() + 90_000)
  } else if (/HOSTED_ENGINE_ROUTE|not a model endpoint|no adapter/i.test(msg) || code === 'HOSTED_ENGINE_ROUTE') {
    unusableRouteUntil.set(route.ref, Date.now() + 300_000)
  } else {
    unusableRouteUntil.set(route.ref, Date.now() + 20_000)
  }
}

function buildRouteQueue(items, selectedRef, followRef, deps, sessionId, registeredProviderIds = null) {
  const seen = new Set()
  const out = []
  const isProviderRegistered = (prov) => {
    if (!prov || String(prov).startsWith('local-agent')) return false
    if (registeredProviderIds && registeredProviderIds.size > 0) return registeredProviderIds.has(prov)
    return true
  }
  const pushCand = (cand, allowUnlisted = false) => {
    const parsed = splitModelRef(cand)
    if (!parsed || !isProviderRegistered(parsed.provider)) return
    if (seen.has(parsed.ref)) return
    if (!allowUnlisted && items.length > 0 && !items.some(it => it.ref === parsed.ref && !it.needsKey)) return
    seen.add(parsed.ref)
    out.push(parsed)
  }

  const liveLeadRef = sessionModelRef(deps, sessionId)
  const primaryFollow = liveLeadRef || followRef || profileDefaultModelRef(deps && deps.runtime)

  if (selectedRef) {
    // Explicit user-pinned Chief model: try it first, then same-provider models, then main session model
    pushCand(selectedRef, true)
    const selParsed = splitModelRef(selectedRef)
    if (selParsed) {
      for (const it of items) {
        if (it && it.provider === selParsed.provider && !it.needsKey) pushCand(it.ref, false)
        if (out.length >= 3) break
      }
    }
    if (primaryFollow) pushCand(primaryFollow, true)
  } else if (primaryFollow) {
    // Auto-follow main conversation mode:
    // MUST use the exact provider/model of the main conversation (e.g. `commandcode/deepseek/deepseek-v4.1-flash`)
    // and NEVER silently jump across to a paid official API provider (like `deepseek/...`)!
    pushCand(primaryFollow, true)
    if (followRef && followRef !== primaryFollow) pushCand(followRef, true)
    const followParsed = splitModelRef(primaryFollow)
    if (followParsed) {
      for (const it of items) {
        if (it && it.provider === followParsed.provider && !it.needsKey) pushCand(it.ref, false)
        if (out.length >= 4) break
      }
    }
  } else {
    // Only when neither a pinned model nor any main/default model exists at all: pick keyed catalog models
    const seenProviders = new Set()
    for (const it of items) {
      if (!it || !it.ref || it.needsKey || seenProviders.has(it.provider)) continue
      seenProviders.add(it.provider)
      pushCand(it.ref, false)
    }
  }

  // Prefer routes not currently cooling down, keeping cooled ones only as last-resort tail
  const healthy = out.filter(r => !isRouteCoolingDown(r.ref, r.provider))
  const cooled = out.filter(r => isRouteCoolingDown(r.ref, r.provider))
  return [...healthy, ...cooled]
}

function pickRouteFromItems(items, selectedRef, followRef, deps, sessionId, registeredProviderIds = null) {
  const queue = buildRouteQueue(items, selectedRef, followRef, deps, sessionId, registeredProviderIds)
  return queue[0] || null
}

async function callOneRoute(llm, route, system, userText, maxTokens = SUMMARY_MAX_TOKENS, sessionId = '', imageBlocks = []) {
  let effort
  let modelDefaultMaxTokens
  try {
    if (typeof llm.resolveModelInfo === 'function') {
      const info = await llm.resolveModelInfo(route.provider, route.model)
      if (typeof info?.defaultMaxTokens === 'number' && info.defaultMaxTokens > 0) {
        modelDefaultMaxTokens = info.defaultMaxTokens
      }
      const efforts = info?.reasoning?.efforts
      if (Array.isArray(efforts) && efforts.length > 0) {
        effort = efforts.some(e => e.id === 'off') ? 'off' : efforts[0]?.id
      }
    }
  } catch {}

  const targetBudget = Math.max(Number(maxTokens) || 0, SUMMARY_MAX_TOKENS)
  const firstBudget = modelDefaultMaxTokens ? Math.min(modelDefaultMaxTokens, targetBudget) : targetBudget
  const retryBudget = firstBudget < targetBudget ? targetBudget : SUMMARY_RETRY_MAX_TOKENS
  const budgets = retryBudget > firstBudget ? [firstBudget, retryBudget] : [firstBudget]
  const safeImages = Array.isArray(imageBlocks) ? imageBlocks : []

  const runOnce = async (budget) => {
    const userContent = [...safeImages, { type: 'text', text: userText || '请查看附图并回答。' }]
    const request = {
      provider: route.provider,
      model: route.model,
      ...(sessionId ? { sessionId } : {}),
      ...(effort !== undefined ? { reasoningEffort: effort } : {}),
      system,
      messages: [{ role: 'user', content: userContent }],
      maxTokens: budget,
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    }

    const dshLlm = await loadDshLlm()
    if (dshLlm && typeof dshLlm.BlockAssembler === 'function') {
      const assembler = new dshLlm.BlockAssembler()
      for await (const chunk of llm.stream(request)) {
        assembler.push(chunk)
      }
      const finish = assembler.finish
      if (finish && (finish.kind === 'error' || finish.kind === 'aborted')) {
        const err = new Error(finish.failure?.message || finish.failure?.code || finish.kind || 'LLM request error')
        err.failure = finish.failure
        throw err
      }
      const text = assembler
        .blocks()
        .filter(b => b && b.type === 'text' && typeof b.text === 'string')
        .map(b => b.text)
        .join('\n')
        .trim()
      return { text, finishKind: finish?.kind || '', modelRef: route.ref }
    }

    // Pure standalone fallback stream reader (for unit tests / lightweight hosts)
    const parts = []
    let finishKind = ''
    for await (const chunk of llm.stream(request)) {
      if (!chunk || typeof chunk !== 'object') continue
      if (chunk.type === 'text-delta' || chunk.type === 'text_delta') {
        if (typeof chunk.text === 'string') parts.push(chunk.text)
        else if (typeof chunk.delta === 'string') parts.push(chunk.delta)
      } else if (chunk.type === 'text' && typeof chunk.text === 'string') parts.push(chunk.text)
      else if (typeof chunk.content === 'string') parts.push(chunk.content)
      else if (chunk.type === 'finish') {
        finishKind = chunk.reason?.kind || chunk.finishReason || ''
        if (finishKind === 'error') {
          const err = new Error(chunk.reason?.failure?.message || 'LLM stream error')
          err.failure = chunk.reason?.failure
          throw err
        }
      }
    }
    return { text: parts.join('').trim(), finishKind, modelRef: route.ref }
  }

  let lastRes = { text: '', finishKind: '', modelRef: route.ref }
  for (let i = 0; i < budgets.length; i += 1) {
    const res = await runOnce(budgets[i])
    lastRes = res
    if (res.text && res.finishKind !== 'max-tokens') {
      return { text: res.text, modelRef: res.modelRef }
    }
  }
  return { text: lastRes.text, modelRef: lastRes.modelRef }
}

async function filterVisionRoutes(llm, queue) {
  const visionRoutes = []
  const unknownRoutes = []
  for (const route of queue) {
    let info = null
    try {
      if (typeof llm.resolveModelInfo === 'function') {
        info = await Promise.resolve(llm.resolveModelInfo(route.provider, route.model))
      }
    } catch {}
    const mods = Array.isArray(info?.inputModalities)
      ? info.inputModalities
      : (Array.isArray(route.inputModalities) ? route.inputModalities : null)
    if (mods) {
      if (mods.includes('image')) visionRoutes.push(route)
    } else {
      unknownRoutes.push(route)
    }
  }
  return [...visionRoutes, ...unknownRoutes]
}

export async function callChiefLlm(deps, {
  sessionId = '',
  system,
  prompt,
  maxTokens = SUMMARY_MAX_TOKENS,
  imageBlocks = [],
  allowTextFallbackOnVisionMiss = false,
}) {
  const safeImages = Array.isArray(imageBlocks) ? imageBlocks : []
  if (deps && typeof deps.callLlmOverride === 'function') {
    return deps.callLlmOverride({ sessionId, system, prompt, maxTokens, imageBlocks: safeImages, allowTextFallbackOnVisionMiss })
  }
  const llm = deps.getLlm ? deps.getLlm() : null
  if (!llm || typeof llm.stream !== 'function') {
    return { ok: false, error: '当前环境未挂载 LLM 服务' }
  }
  const catalog = await listChiefModels(deps, false, sessionId)
  const regSet = typeof llm.listProviders === 'function'
    ? new Set((llm.listProviders() || []).filter(p => p && p.id && !String(p.id).startsWith('local-agent')).map(p => String(p.id)))
    : null
  const baseQueue = buildRouteQueue(catalog.models, catalog.selectedRef, catalog.followRef || catalog.defaultRef, deps, sessionId, regSet)
  if (!baseQueue.length) {
    return { ok: false, error: '未找到可用的参谋长模型，请在 DSH 设置中配置模型供应商' }
  }

  let queue = baseQueue
  let sendImages = safeImages
  let degradedToTextOnly = false
  if (safeImages.length > 0) {
    const visionQueue = await filterVisionRoutes(llm, baseQueue)
    if (visionQueue.length > 0) {
      queue = visionQueue
    } else if (allowTextFallbackOnVisionMiss) {
      queue = baseQueue
      sendImages = []
      degradedToTextOnly = true
    } else {
      return {
        ok: false,
        error: '当前参谋长及备选模型均不支持图片输入（仅纯文本），请在右上角切换支持视觉的多模态模型（如 Gemini / Claude / GPT-4o / Qwen-VL 等）后再试。',
      }
    }
  }

  let lastError = '模型返回内容为空'
  for (const route of queue.slice(0, 4)) {
    try {
      const res = await callOneRoute(llm, route, system, prompt, maxTokens, sessionId, sendImages)
      if (res.text) return { ok: true, text: res.text, modelRef: res.modelRef, degradedToTextOnly }
      lastError = `${route.ref} 返回内容为空`
      markRouteFailure(route, new Error(lastError))
    } catch (err) {
      lastError = String(err && err.message ? err.message : err)
      if (sendImages.length > 0 && allowTextFallbackOnVisionMiss) {
        try {
          const textRes = await callOneRoute(llm, route, system, prompt, maxTokens, sessionId, [])
          if (textRes.text) return { ok: true, text: textRes.text, modelRef: textRes.modelRef, degradedToTextOnly: true }
        } catch {}
      }
      markRouteFailure(route, err)
    }
  }
  return { ok: false, error: lastError, degradedToTextOnly }
}

/* -------------------------------------------------------------------------- */
/* Peer Discovery & Cross-Conversation Delivery ("递话 / 插话")               */
/* -------------------------------------------------------------------------- */

export async function buildMessageEnvelope(text, sourceKind = CHIEF_RELAY_SOURCE, extraSource = {}, imageBlocks = []) {
  const dshLlm = await loadDshLlm()
  const safeImages = Array.isArray(imageBlocks) ? imageBlocks : []
  const content = [...safeImages, ...(text ? [{ type: 'text', text }] : [])]
  if (!content.length) content.push({ type: 'text', text: '' })
  const source = { kind: sourceKind, ...extraSource }
  if (dshLlm && typeof dshLlm.createUserMessage === 'function') {
    try {
      return dshLlm.createUserMessage({ content, source })
    } catch {}
  }
  return {
    id: nextId('secmsg'),
    role: 'user',
    content,
    source,
  }
}

function summarizeBoardProgress(board) {
  const tasks = Array.isArray(board && board.tasks) ? board.tasks : []
  const doneCount = tasks.filter(t => t && t.status === 'done').length
  const doingCount = tasks.filter(t => t && t.status === 'doing').length
  const blockedCount = tasks.filter(t => t && t.status === 'blocked').length
  const todoCount = tasks.filter(t => t && t.status === 'todo').length
  const plan = Array.isArray(board && board.plan) ? board.plan : []
  const planDone = plan.filter(s => s && s.done).length
  const cursorStep = clamp(board && board.cursor && board.cursor.step ? board.cursor.step : '', 48)
  const parts = []
  if (tasks.length > 0) parts.push(`任务 ${doneCount}完/${doingCount}做${blockedCount ? `/${blockedCount}阻` : ''}/${tasks.length}`)
  else if (plan.length > 0) parts.push(`步骤 ${planDone}/${plan.length}`)
  if (cursorStep) parts.push(`断点:${cursorStep}`)
  return parts.join(' · ')
}

export function collectClusterPeerProgress(deps, cluster = [], selfRootId = '') {
  const self = String(selfRootId || '').trim()
  const members = Array.isArray(cluster) ? cluster.filter(sid => sid && sid !== self) : []
  if (!members.length) return []
  const runtime = deps && deps.runtime
  const agentsSvc = runtime ? runtime.get('agents') : null
  const out = []
  for (const sid of members) {
    let board = null
    try {
      board = deps.boardForSession ? deps.boardForSession(deps.boardFileFor(sid)) : null
    } catch {}
    if (!board) continue
    let rootAgent = null
    try {
      rootAgent = agentsSvc && typeof agentsSvc.get === 'function' ? agentsSvc.get(sid) : null
    } catch {}
    const name = (deps.sessionName && deps.sessionName(runtime, rootAgent || sid)) || ('会话 ' + sid.replace(/^session-/, '').slice(0, 8))
    const tasks = Array.isArray(board.tasks) ? board.tasks : []
    const doneCount = tasks.filter(t => t && t.status === 'done').length
    const doingCount = tasks.filter(t => t && t.status === 'doing').length
    const blockedCount = tasks.filter(t => t && t.status === 'blocked').length
    const todoCount = tasks.filter(t => t && t.status === 'todo').length
    const topTasks = tasks
      .filter(t => t && t.status !== 'done')
      .slice(0, 3)
      .map(t => `[${t.status}] #${t.id} ${clamp(t.title, 44)}`)
    const recentConclusions = (Array.isArray(board.memory) ? board.memory : [])
      .filter(m => m && !isInternalCheckpointNoise(m.title || m.text))
      .slice(-2)
      .map(m => clamp(stripCheckpointNoise(m.title || m.text), 72))
      .filter(Boolean)
    out.push({
      rootId: sid,
      name,
      status: rootAgent && rootAgent.status === 'running' ? 'running' : 'idle',
      objective: clamp(board.objective || '', 120),
      cursorStep: clamp(board.cursor && board.cursor.step ? board.cursor.step : '', 90),
      cursorNext: clamp(board.cursor && board.cursor.next ? board.cursor.next : '', 90),
      cursorBlocked: clamp(board.cursor && board.cursor.blocked ? board.cursor.blocked : '', 90),
      doingCount,
      doneCount,
      blockedCount,
      todoCount,
      topTasks,
      recentConclusions,
      progressSummary: summarizeBoardProgress(board),
    })
  }
  return out
}

/** Build complete addressable peer directory across lead, subagents, and federated root sessions. */
export async function listPeerDirectory(deps, sessionId) {
  const rootId = deps.resolveRootSessionId(sessionId) || String(sessionId || '')
  const state = loadChiefState()
  const cluster = getLinkedCluster(state, rootId)
  const runtime = deps.runtime
  const agentsSvc = runtime ? runtime.get('agents') : null
  const liveAgents = agentsSvc && typeof agentsSvc.list === 'function' ? agentsSvc.list() : []
  const archived = (() => {
    try {
      const list = runtime && runtime.get('workspaceRegistry')?.archivedSessionIds
      return Array.isArray(list) ? new Set(list) : new Set()
    } catch {
      return new Set()
    }
  })()

  const targets = []
  const seenIds = new Set()

  for (const memberRootId of cluster) {
    const isCurrentRoot = memberRootId === rootId
    const board = deps.boardForSession(deps.boardFileFor(memberRootId))
    const roster = await deps.refreshSubagentTree(runtime, memberRootId, board)
    const rootAgent = agentsSvc && typeof agentsSvc.get === 'function' ? agentsSvc.get(memberRootId) : null
    const rootTitle = deps.sessionName(runtime, rootAgent || memberRootId) || ('会话 ' + memberRootId.replace(/^session-/, '').slice(0, 8))
    const memberProgressSummary = summarizeBoardProgress(board)

    for (const entry of roster) {
      if (!entry) continue
      const isLead = entry.name === 'lead'
      const key = isCurrentRoot
        ? (isLead ? 'lead' : entry.name)
        : (isLead ? memberRootId : `${memberRootId}:${entry.name}`)
      if (seenIds.has(key)) continue
      seenIds.add(key)
      targets.push({
        key,
        id: entry.id || (isLead ? memberRootId : ''),
        rootId: memberRootId,
        name: isLead ? (isCurrentRoot ? '主对话' : rootTitle) : entry.name,
        handle: isCurrentRoot ? (isLead ? 'lead' : entry.name) : (isLead ? rootTitle : `${rootTitle}/${entry.name}`),
        kind: isLead ? (isCurrentRoot ? 'lead' : 'peer-session') : 'subagent',
        isCurrentRoot,
        status: entry.status === 'running' ? 'running' : 'idle',
        taskTitle: entry.taskTitle || entry.description || (board && board.objective ? clamp(board.objective, 48) : ''),
        ...(isLead ? { progressSummary: memberProgressSummary, objective: clamp(board && board.objective ? board.objective : '', 80) } : {}),
        parentId: entry.parentId || memberRootId,
        mode: entry.mode || 'continuable',
      })
    }
  }

  // Other top-level standalone sessions on this machine that can be linked into the federation
  const otherSessions = []
  for (const ag of liveAgents) {
    const sid = String(ag && ag.id ? ag.id : '')
    if (!sid || archived.has(sid)) continue
    const agRoot = deps.resolveRootSessionId(sid, ag) || sid
    if (agRoot !== sid) continue // skip child subagent sessions here
    if (agRoot === rootId) continue
    const isLinked = cluster.includes(agRoot)
    const b = deps.loadBoard(deps.boardFileFor(agRoot))
    otherSessions.push({
      id: agRoot,
      name: deps.sessionName(runtime, ag) || ('会话 ' + agRoot.replace(/^session-/, '').slice(0, 8)),
      status: ag.status === 'running' ? 'running' : 'idle',
      linked: isLinked,
      objective: clamp(b && b.objective ? b.objective : '', 80),
      openTasks: Array.isArray(b && b.tasks) ? b.tasks.filter(t => t.status !== 'done').length : 0,
      progressSummary: summarizeBoardProgress(b),
    })
  }

  return {
    rootId,
    cluster,
    targets,
    otherSessions,
  }
}

function matchTargetPeer(targets, rawTarget) {
  const q = String(rawTarget || '').trim().replace(/^@/, '')
  if (!q) return null
  const lower = q.toLowerCase()
  if (lower === 'lead' || lower === 'main' || lower === '主对话' || lower === '主代理') {
    return targets.find(t => t.kind === 'lead' && t.isCurrentRoot) || targets[0] || null
  }
  // Exact match by key, id, name, or handle
  for (const t of targets) {
    if (
      t.key.toLowerCase() === lower
      || (t.id && t.id.toLowerCase() === lower)
      || t.name.toLowerCase() === lower
      || t.handle.toLowerCase() === lower
      || t.name.split('/').pop().toLowerCase() === lower
    ) {
      return t
    }
  }
  // Partial substring match
  return targets.find(t =>
    t.name.toLowerCase().includes(lower) || t.handle.toLowerCase().includes(lower),
  ) || null
}

/**
 * Deliver a message across conversations (lead <-> subagent, subagent <-> subagent, session <-> session).
 * Modes:
 * - 'steer': cut into next step boundary immediately if running, or wake if idle.
 * - 'followup': queue for next turn / wake idle session without cutting running step.
 * - 'silent': record in chief mailbox so the recipient sees it cleanly at its next pre-step without waking an idle session.
 */
function buildSavedImageNotice(savedImagePaths) {
  const list = Array.isArray(savedImagePaths) ? savedImagePaths.filter(item => item && item.path) : []
  if (!list.length) return ''
  return [
    '',
    '🖼️ [用户原图已落盘至工作区路径]：',
    ...list.map(item => `- ${item.path}${item.name ? ` (${item.name})` : ''}`),
    '⚠️ 请直接查阅附带图片或使用读图/文件工具读取上述原始路径后再动手，严禁只凭参谋长转述文本猜测或编造未确认的图内信息！',
  ].join('\n')
}

export async function deliverCrossMessage(deps, {
  fromSession = '',
  fromLabel = 'DSH 参谋长',
  target = 'lead',
  text = '',
  subject = '',
  mode = 'steer',
  images = [],
  imageBlocks: preAdmittedBlocks = null,
  savedImagePaths: preSavedPaths = null,
  recordBoardLog = true,
}) {
  const cleanBody = cleanMultiline(text, 2400)
  const rawImages = Array.isArray(images) ? images : []
  const hasPreAdmitted = Array.isArray(preAdmittedBlocks) && preAdmittedBlocks.length > 0
  let savedPaths = Array.isArray(preSavedPaths) ? preSavedPaths : []
  if (!savedPaths.length && rawImages.length > 0) {
    try {
      savedPaths = persistChiefImagesToWorkspace(deps, fromSession, rawImages)
    } catch {}
  }

  if (!cleanBody && !rawImages.length && !hasPreAdmitted && !savedPaths.length) {
    return { ok: false, error: '递话内容不能为空' }
  }

  let admittedBlocks = hasPreAdmitted ? preAdmittedBlocks : []
  if (!hasPreAdmitted && rawImages.length > 0) {
    try {
      admittedBlocks = await admitChiefImages(deps, rawImages)
    } catch (err) {
      if (!savedPaths.length) {
        return { ok: false, error: String(err && err.message ? err.message : err) }
      }
      // Degrade cleanly to path-based image delivery if host attachments service is unavailable
      admittedBlocks = []
    }
  }
  const effectiveText = cleanBody || (admittedBlocks.length || savedPaths.length ? '请查看随信附带的图片与落盘路径。' : '')
  const totalImgCount = Math.max(admittedBlocks.length, savedPaths.length)
  const imgTag = totalImgCount > 0 ? ` [附图 ×${totalImgCount}]` : ''

  const rootId = (deps.resolveRootSessionId && deps.resolveRootSessionId(fromSession)) || String(fromSession || directoryRootFallback(fromSession))
  const directory = await listPeerDirectory(deps, rootId || fromSession)
  const senderRootId = rootId || directory.rootId || ''
  const rawTarget = String(target || 'lead').trim().replace(/^@/, '')

  // Broadcast support: 'all' / '全体' / 'team' (deduplicated single mailbox record for clean drawer UI)
  if (['all', 'team', '全体', '所有人'].includes(rawTarget.toLowerCase())) {
    const recipients = directory.targets.filter(t => t.id !== fromSession)
    const deliveries = []
    const deliveredReadMarks = []
    for (const peer of recipients) {
      const res = await deliverSinglePeer(deps, directory, peer, {
        fromSession,
        fromRootId: senderRootId,
        fromLabel,
        text: effectiveText,
        subject,
        mode,
        imageBlocks: admittedBlocks,
        savedImagePaths: savedPaths,
        recordBoardLog: false,
        recordMailbox: false,
      })
      deliveries.push({ target: peer.handle, ok: res.ok, mode: res.deliveryMode })
      if (res.deliveredPhysical) {
        if (peer.id) deliveredReadMarks.push(peer.id)
        if (peer.key) deliveredReadMarks.push(peer.key)
        if (peer.name) deliveredReadMarks.push(peer.name)
      }
    }
    const participantRoots = [...new Set([senderRootId, ...(directory.cluster || [])].filter(Boolean))].sort()
    const imgNoticeBlock = buildSavedImageNotice(savedPaths)
    const textWithImagePaths = imgNoticeBlock ? `${effectiveText}\n${imgNoticeBlock}` : effectiveText
    const broadcastId = nextId('bcast')
    const mailItem = normalizeMail({
      id: nextId('mail'),
      from: fromLabel,
      fromSession,
      fromRootId: senderRootId,
      to: 'all',
      toSession: 'all',
      toRootId: 'all',
      participantRoots,
      channelType: participantRoots.length > 1 ? 'broadcast' : 'internal',
      broadcastId,
      subject,
      text: totalImgCount > 0 ? `${textWithImagePaths}${imgTag}` : textWithImagePaths,
      imageCount: totalImgCount,
      mode,
      deliveredPhysical: deliveries.some(d => d.ok && d.mode !== 'mailbox-queued'),
      readBy: [...new Set(deliveredReadMarks)],
      at: Date.now(),
    })
    if (mailItem) {
      mutateChiefState((state) => {
        const ws = ensureWorkspace(state, senderRootId || directory.rootId)
        ws.mailbox.push(mailItem)
        if (ws.mailbox.length > MAIL_CAP) ws.mailbox = ws.mailbox.slice(-MAIL_CAP)
      })
    }
    if (recordBoardLog && rootId) {
      deps.appendBoardLog(rootId, `📡 ${fromLabel} 向全体成员广播递话（${deliveries.filter(d => d.ok).length} 个目标）：${clamp(effectiveText, 56)}${imgTag}`, fromLabel)
    }
    return { ok: true, broadcast: true, target: 'all', mail: mailItem, deliveries, savedImagePaths: savedPaths }
  }

  // Multi-target comma-separated support (e.g. "sessionA,sessionB" or "worker1,worker2")
  if (/[,，]/.test(rawTarget)) {
    const parts = rawTarget.split(/[,，]/).map(s => s.trim().replace(/^@/, '')).filter(Boolean)
    const matched = []
    const seenKeys = new Set()
    for (const part of parts) {
      const hit = matchTargetPeer(directory.targets, part)
      if (hit && !seenKeys.has(hit.key)) {
        seenKeys.add(hit.key)
        matched.push(hit)
      }
    }
    if (matched.length >= 2) {
      const deliveries = []
      const readMarks = []
      const roots = new Set([senderRootId].filter(Boolean))
      for (const peer of matched) {
        if (peer.rootId) roots.add(peer.rootId)
        const res = await deliverSinglePeer(deps, directory, peer, {
          fromSession,
          fromRootId: senderRootId,
          fromLabel,
          text: effectiveText,
          subject,
          mode,
          imageBlocks: admittedBlocks,
          savedImagePaths: savedPaths,
          recordBoardLog: false,
          recordMailbox: false,
        })
        deliveries.push({ target: peer.handle, ok: res.ok, mode: res.deliveryMode })
        if (res.deliveredPhysical) {
          if (peer.id) readMarks.push(peer.id)
          if (peer.key) readMarks.push(peer.key)
          if (peer.name) readMarks.push(peer.name)
        }
      }
      const participantRoots = [...roots].sort()
      const imgNoticeBlock = buildSavedImageNotice(savedPaths)
      const textWithImagePaths = imgNoticeBlock ? `${effectiveText}\n${imgNoticeBlock}` : effectiveText
      const mailItem = normalizeMail({
        id: nextId('mail'),
        from: fromLabel,
        fromSession,
        fromRootId: senderRootId,
        to: matched.map(m => m.handle).join('、'),
        toSession: matched.map(m => m.id || m.key).join(','),
        toRootId: participantRoots.length > 1 ? 'multi' : (participantRoots[0] || ''),
        participantRoots,
        channelType: participantRoots.length >= 3 ? 'multi' : (participantRoots.length === 2 ? 'pair' : 'internal'),
        broadcastId: nextId('multi'),
        subject,
        text: totalImgCount > 0 ? `${textWithImagePaths}${imgTag}` : textWithImagePaths,
        imageCount: totalImgCount,
        mode,
        deliveredPhysical: deliveries.some(d => d.ok && d.mode !== 'mailbox-queued'),
        readBy: [...new Set(readMarks)],
        at: Date.now(),
      })
      if (mailItem) {
        mutateChiefState((state) => {
          const ws = ensureWorkspace(state, senderRootId || directory.rootId)
          ws.mailbox.push(mailItem)
          if (ws.mailbox.length > MAIL_CAP) ws.mailbox = ws.mailbox.slice(-MAIL_CAP)
        })
      }
      return { ok: true, multi: true, target: matched.map(m => m.handle).join('、'), mail: mailItem, deliveries, savedImagePaths: savedPaths }
    }
  }

  const peer = matchTargetPeer(directory.targets, rawTarget)
  if (!peer) {
    return {
      ok: false,
      error: `未找到目标对话 "${rawTarget}"。当前可用目标：${directory.targets.map(t => t.handle).join('、') || '无'}`,
    }
  }

  return deliverSinglePeer(deps, directory, peer, {
    fromSession,
    fromRootId: senderRootId,
    fromLabel,
    text: effectiveText,
    subject,
    mode,
    imageBlocks: admittedBlocks,
    savedImagePaths: savedPaths,
    recordBoardLog,
    recordMailbox: true,
  })
}

function directoryRootFallback(fromSession) {
  return String(fromSession || 'global')
}

async function deliverSinglePeer(deps, directory, peer, {
  fromSession,
  fromRootId = '',
  fromLabel,
  text,
  subject,
  mode,
  imageBlocks = [],
  savedImagePaths = [],
  recordBoardLog,
  recordMailbox = true,
}) {
  const runtime = deps.runtime
  const agentsSvc = runtime ? runtime.get('agents') : null
  const subagentsSvc = runtime ? runtime.get('subagents') : null
  const safeBlocks = Array.isArray(imageBlocks) ? imageBlocks : []
  const safePaths = Array.isArray(savedImagePaths) ? savedImagePaths : []
  const imgCount = Math.max(safeBlocks.length, safePaths.length)
  const imgSuffix = imgCount > 0 ? ` [附图 ×${imgCount}]` : ''
  const imgNoticeBlock = buildSavedImageNotice(safePaths)
  const textWithImagePaths = imgNoticeBlock ? `${text}\n${imgNoticeBlock}` : text
  const headerTag = mode === 'steer'
    ? `[DSH 参谋长插话 · 来自 ${fromLabel}]`
    : `[DSH 参谋长递话 · 来自 ${fromLabel}]`
  const formatted = `${headerTag}${subject ? ' ' + subject : ''}\n${textWithImagePaths}\n\n（如需回信或同步进展，可调用参谋看板 chief_board({ action: "mail.send", target: "${fromLabel === 'DSH 参谋长' ? 'lead' : fromLabel}", text: "…" })）`

  let deliveredPhysical = false
  let deliveryMode = 'mailbox-queued'
  let errorNote = ''

  if (mode !== 'silent') {
    // Path A: Subagent delivery via DSH native subagents service
    if (peer.kind === 'subagent' && subagentsSvc) {
      const caller = (agentsSvc && peer.rootId && agentsSvc.get(peer.rootId)) || deps.findLiveCallerAgent(runtime, peer.rootId, null)
      if (caller) {
        try {
          let targetChildId = peer.id
          if (!targetChildId && typeof subagentsSvc.resolveName === 'function') {
            targetChildId = await subagentsSvc.resolveName(caller, peer.name, AbortSignal.timeout(5000))
          }
          if (targetChildId) {
            await subagentsSvc.sendMessage(caller, targetChildId, [...safeBlocks, { type: 'text', text: formatted }], {
              signal: AbortSignal.timeout(10_000),
            })
            deliveredPhysical = true
            deliveryMode = 'subagent-send'
          }
        } catch (err) {
          errorNote = String(err && err.message ? err.message : err)
        }
      }
    }

    // Path B: Direct Agent handle delivery (for root lead, peer standalone sessions, or fallback live child agent)
    if (!deliveredPhysical && agentsSvc && peer.id) {
      let targetAgent = typeof agentsSvc.get === 'function' ? agentsSvc.get(peer.id) : null
      if (!targetAgent && runtime) {
        try {
          const controller = runtime.get('sessionController')
          if (controller && typeof controller.resolveAgent === 'function') {
            const resolved = await controller.resolveAgent(peer.id)
            if (resolved && resolved.agent) targetAgent = resolved.agent
          }
        } catch {}
      }
      if (targetAgent) {
        const envelope = await buildMessageEnvelope(formatted, CHIEF_RELAY_SOURCE, {
          senderName: fromLabel,
          senderSessionId: fromSession || undefined,
          role: mode === 'steer' ? 'steer' : 'relay',
        }, safeBlocks)
        try {
          if (mode === 'steer' && targetAgent.status === 'running' && typeof targetAgent.steer === 'function') {
            const r = targetAgent.steer(envelope)
            if (r && typeof r.then === 'function') await r
            deliveredPhysical = true
            deliveryMode = 'agent-steer'
          } else if (targetAgent.status !== 'running' && typeof targetAgent.followup === 'function') {
            const r = targetAgent.followup(envelope)
            if (r && typeof r.then === 'function') await r
            deliveredPhysical = true
            deliveryMode = 'agent-followup'
          } else if (typeof targetAgent.inject === 'function') {
            const r = targetAgent.inject(envelope)
            if (r && typeof r.then === 'function') await r
            deliveredPhysical = true
            deliveryMode = 'agent-inject'
          } else if (typeof targetAgent.steer === 'function') {
            targetAgent.steer(safeBlocks.length ? formatted + imgSuffix : formatted)
            deliveredPhysical = true
            deliveryMode = 'agent-steer-text'
          }
        } catch (err) {
          errorNote = String(err && err.message ? err.message : err)
        }
      }
    }
  }

  // Always record in the shared cluster mailbox; if physical delivery already carried it,
  // mark the recipient in readBy so `agent/pre-step` will NOT double-deliver it!
  const recipientMarks = deliveredPhysical
    ? [peer.id, peer.key, peer.name].filter(Boolean)
    : []

  const senderRoot = String(fromRootId || (fromSession && deps.resolveRootSessionId && deps.resolveRootSessionId(fromSession)) || directory.rootId || '').trim()
  const targetRoot = String(peer.rootId || directory.rootId || '').trim()
  const participantRoots = [...new Set([senderRoot, targetRoot].filter(Boolean))].sort()
  const channelType = participantRoots.length >= 2 ? 'pair' : 'internal'

  const mailItem = normalizeMail({
    id: nextId('mail'),
    from: fromLabel,
    fromSession,
    fromRootId: senderRoot,
    to: peer.handle,
    toSession: peer.id || peer.key,
    toRootId: targetRoot,
    participantRoots,
    channelType,
    subject,
    text: imgCount > 0 ? `${textWithImagePaths}${imgSuffix}` : textWithImagePaths,
    imageCount: imgCount,
    mode,
    deliveredPhysical,
    readBy: recipientMarks,
    at: Date.now(),
  })

  if (recordMailbox && mailItem) {
    mutateChiefState((state) => {
      const ws = ensureWorkspace(state, peer.rootId || directory.rootId)
      ws.mailbox.push(mailItem)
      if (ws.mailbox.length > MAIL_CAP) ws.mailbox = ws.mailbox.slice(-MAIL_CAP)
    })
  }

  if (recordBoardLog && (peer.rootId || directory.rootId)) {
    const badge = mode === 'steer' ? '⚡ 插话' : mode === 'silent' ? '📌 备忘纸条' : '📨 递话'
    deps.appendBoardLog(
      peer.rootId || directory.rootId,
      `${badge} ${fromLabel} → ${peer.handle}：${clamp(text, 56)}${imgSuffix}`,
      fromLabel,
    )
  }

  return {
    ok: true,
    mail: mailItem,
    target: peer.handle,
    targetId: peer.id,
    deliveredPhysical,
    deliveryMode,
    savedImagePaths: safePaths,
    ...(errorNote && !deliveredPhysical ? { note: '目标暂未在线运行，已存入参谋部协同信箱，将在其下一步自动送达（' + errorNote + '）' } : {}),
  }
}

/* -------------------------------------------------------------------------- */
/* KV-Cache Friendly Pre-Step Delta Note (`agent/pre-step`)                   */
/* -------------------------------------------------------------------------- */

export async function consumePreStepDelta(deps, agent) {
  const sessionId = String(agent && agent.id ? agent.id : '').trim()
  if (!sessionId) return null
  const rootId = deps.resolveRootSessionId(sessionId, agent) || sessionId
  const identity = deps.resolveAgentIdentity(deps.runtime, sessionId, agent)
  const myHandles = new Set(
    [
      sessionId,
      identity && identity.self ? identity.self : '',
      identity && !identity.isChild ? 'lead' : '',
      identity && !identity.isChild ? '主对话' : '',
    ].filter(Boolean).map(s => s.toLowerCase()),
  )

  const deltaLines = []
  mutateChiefState((state) => {
    const view = clusterView(state, rootId)
    const ownWs = ensureWorkspace(state, rootId)

    // 1. Unread mailbox messages addressed to this session/handle (STRICT cluster isolation: ignore detached external peers!)
    for (const mail of view.mailbox) {
      if (mail.detachedFromCluster) continue
      const mailFromRoot = mail.fromRootId || (mail.fromSession && deps.resolveRootSessionId ? deps.resolveRootSessionId(mail.fromSession) : '')
      if (mailFromRoot && mailFromRoot !== rootId && !view.cluster.includes(mailFromRoot)) continue
      const toLower = String(mail.toSession || mail.to || '').toLowerCase()
      const toHandleLower = String(mail.to || '').toLowerCase()
      const isMine = toLower === 'all'
        || toHandleLower === 'all'
        || myHandles.has(toLower)
        || myHandles.has(toHandleLower)
        || myHandles.has(toHandleLower.split('/').pop())
      if (!isMine) continue
      if (mail.fromSession && mail.fromSession === sessionId) continue
      const alreadyRead = (mail.readBy || []).some(r => myHandles.has(String(r).toLowerCase()))
      if (alreadyRead) continue

      mail.readBy = [...new Set([...(mail.readBy || []), sessionId, ...(identity?.self ? [identity.self] : [])])]
      deltaLines.push(`- 📨 来自 **${mail.from}** 的协同来信${mail.subject ? '（' + mail.subject + '）' : ''}：${mail.text}`)
    }

    // 2. Newly added/updated durable facts since this session last checked
    const lastSeenFact = Number(ownWs.seenFactsAt[sessionId] || 0)
    const now = Date.now()
    if (lastSeenFact === 0) {
      // First step: freeze baseline without injecting noise if already covered, unless facts exist
      ownWs.seenFactsAt[sessionId] = now
      if (view.facts.length > 0) {
        const topFacts = view.facts.slice(-8)
        for (const f of topFacts) {
          deltaLines.push(`- 📌 团队记忆与纪律：${f.text}`)
        }
      }
    } else {
      const freshFacts = view.facts.filter(f => (f.updatedAt || f.addedAt || 0) > lastSeenFact)
      if (freshFacts.length > 0) {
        ownWs.seenFactsAt[sessionId] = Math.max(...freshFacts.map(f => f.updatedAt || f.addedAt || now))
        for (const f of freshFacts.slice(-6)) {
          deltaLines.push(`- 📌 最新记忆变更（${f.by || '参谋长'}）：${f.text}`)
        }
      }
    }
  })

  if (deltaLines.length === 0) return null

  const text = [
    '## DSH 参谋长 · 跨对话协同与记忆增量',
    '以下是自你上一轮以来收到的跨对话来信或最新团队纪律变更（仅作上下文参考与协同配合）：',
    '',
    ...deltaLines,
  ].join('\n')

  return buildMessageEnvelope(text, CHIEF_UPDATE_SOURCE, { form: 'snapshot' })
}

/* -------------------------------------------------------------------------- */
/* Concise Structured Bullet Summary ("摘要" · 宰相简报)                       */
/* -------------------------------------------------------------------------- */

const SUMMARY_FORMAT_REV = 'v5-six-goal-lines'

const NARRATIVE_SYSTEM = [
  '你是「DSH 参谋长」（如同统揽全局的宰相），负责把当前工作区和协同团队的目标、进展、纪律与红线边界，提炼成用户一眼扫完就能掌握全局的「摘要」。',
  '严格遵守以下【简明结构化 · 分点作答】规范：',
  '1. 使用简体中文，语气精炼干脆、直击要害，严禁寒暄套话与冗长铺垫。',
  '2. 全文分为 2 到 4 个模块，每个模块以一行 `## 模块短标题` 开头（如 `## 核心目标与态势`、`## 关键结论与进展`、`## 协作纪律与红线`、`## 协作纪律与边界`）。',
  '3. **每个模块下方必须全部使用 `- ` 分点列表作答（严禁写成挤在一起的长段落散文！）**。每一点控制在 1 行（最多不超过 2 行），推荐在要点开头用方括号短标签提亮，如 `- 【总目标】…`、`- 【推进中】…`、`- 【已完】…`、`- 【已验证】…`、`- 【结论】…`、`- 【待办】…`、`- 【待收尾】…`、`- 【注意】…`、`- 【归因纪律】…`、`- 【收尾纪律】…`、`- 【并列直接原因】…`、`- 【受阻】…`、`- 【禁止红线】…`、`- 【必做事项】…`。',
  '4. **去噪与聚合铁律**：遇到大量同前缀或已结束的后台巡检子代理（如 `mnemon-review-*`），**严禁逐一报菜名罗列**，必须合并成一句话统计；自动忽略 `[dsh-mnemon:...]` 等系统内部检查点噪音。',
  '5. 具体路径、端口、版本号、命令原样保留，同一事实绝不重复，只陈述真实输入，第一个 `## ` 之前不要输出任何多余字符。',
].join('\n')

const CONCISE_BRIEF_NARRATIVE_EXTRA = [
  '',
  '⚡ 【当前已开启极简战报模式 — 六句话目标边界系列（最高优先级覆盖一切细节规则！）】：',
  '- **一切以目标为导向，说人话，拒绝任何事务细节**：严禁出现任何文件路径、文件名、代码符号/函数名、行号、端口号、Token/字节数、耗时、版本号、终端命令或具体计数统计！',
  '- **严格只输出如下 1 个标题 + 刚好 6 行单句列表（不要多也不要少）**：',
  '  ## 极简目标战报',
  '  - 【🎯 总目标】用一句人话说清最终要达成的目标。',
  '  - 【🚀 当前推进目标】用一句人话说清现在正聚焦推进的阶段目标。',
  '  - 【⛔ 受阻目标】若无受阻写“当前暂无受阻目标”；若有受阻，用一句人话点明卡住的目标与原因。',
  '  - 【🧰 需要什么】用一句人话说明达成目标还缺的前提、验证或支撑条件（无则写“条件已齐备，可顺畅推进”）。',
  '  - 【🙋 用户需要提供什么】若需要您拍板、授权、提供账号/素材或重启确认写一句人话；无需操作写“暂无需您额外提供，可继续推进”。',
  '  - 【💡 参谋长建议】用一句人话给出最清晰可执行的建议或建议弹窗拍板方向。',
  '- 每条控制在 1 句精炼大白话（20~55 字），切忌写成事务流水账或代码改动清单！',
].join('\n')

/** Remove or qualitatively normalize raw numeric parameters, file paths & technical trivia when Concise Brief Mode (`极简战报模式`) is enabled. */
export function sanitizeConciseBriefText(text) {
  const src = String(text || '')
  if (!src.trim()) return ''
  return src
    .replace(/[A-Za-z]:\\[^\s"'`）)】]+/g, '本地相关目录')
    .replace(/(?:^|\s)\/(?:[\w.-]+\/)+[\w.-]*/g, ' 相关路径')
    .replace(/\b[\w.-]+\.(?:m?[jt]sx?|py|json|ya?ml|md|css|html|sh|ps1)\b/gi, '相关模块')
    .replace(/`[^`]{2,64}`/g, '对应能力')
    .replace(/\bv?\d+\.\d+\.\d+(?:-[a-z0-9.]+)?\b/gi, '当前版本')
    .replace(/\bL\d+(?:\s*[-~–]\s*L?\d+)?\b/g, '相关位置')
    .replace(/:\d{2,5}\b/g, '')
    .replace(/(?:端口|port)\s*\d{2,5}/gi, '对应端口')
    .replace(/(?:第)\s*\d+(?:\.\d+)?\s*(?:行|页|步|轮|阶段)/gi, '当前阶段')
    .replace(/(?:耗时|用时|约|共|已有|剩余|累计|包含|存在|触发|达到|占比)\s*\d+(?:\.\d+)?\s*(?:ms|s|毫秒|秒|分钟|小时|天|字节|bytes?|KB|MB|GB|K|M|%|％|项|个|条|卷|次|步|轮|行|页|张|名|家|处)/gi, (m) => {
      if (/(?:%|％)/.test(m)) return '相应比例'
      if (/(?:ms|s|毫秒|秒|分钟|小时)/.test(m)) return '短暂耗时'
      if (/(?:KB|MB|GB|K|M|字节|bytes?)/i.test(m)) return '一定体量'
      return '若干进展'
    })
    .replace(/\b\d+(?:\.\d+)?\s*(?:%|％)/g, '相应比例')
    .replace(/\b\d+(?:\.\d+)?\s*(?:ms|毫秒|KB|MB|GB)(?![a-z0-9_])/gi, '相应规模')
    .replace(/(^|\s)#\d+\b/g, '$1该目标')
    .replace(/\b\d{3,}\b/g, '若干')
    .replace(/(?<=[\u4e00-\u9fa5\s])\d+(?=[\s]*(?:项|个|条|卷|次|步|轮|名|处|份|行))/g, '若干')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Synthesize the 6-line goal-only human report (`六句话目标边界系列`) shared by Narrative fallback & AskChief fallback. */
function buildConciseSixLineReport({ board, blocked = [], doing = [], todo = [], done = [], workers = [], suggestions = [], needFromUserHint = '' }) {
  const clean = (s, max = 54) => sanitizeConciseBriefText(clamp(String(s || '').replace(/\s+/g, ' ').trim(), max))
  const planSteps = Array.isArray(board && board.plan) ? board.plan.filter(Boolean) : []
  const openPlan = planSteps.filter(s => !s.done)
  const donePlan = planSteps.filter(s => s.done)
  const objText = (board && board.objective) ? clean(board.objective, 56) : '按您当前的指令完成本阶段目标'
  let curText = '等待您确认方向后启动推进'
  if (doing.length > 0) {
    curText = clean(doing[0].title, 54)
  } else if (blocked.length > 0) {
    curText = '正聚焦排查并疏通受阻目标：' + clean(blocked[0].title, 44)
  } else if (todo.length > 0) {
    curText = '准备推进下一项目标：' + clean(todo[0].title, 46)
  } else if (openPlan.length > 0) {
    curText = clean(openPlan[0].text, 54)
  } else if (done.length > 0 || (donePlan.length > 0 && !openPlan.length)) {
    curText = '本阶段核心事项已基本收尾，待核对确认后交卷'
  }

  let blockedText = '当前暂无受阻目标，推进链路顺畅'
  if (blocked.length > 0) {
    const b0 = blocked[0]
    blockedText = clean(b0.title, 40) + (b0.note ? '（症结：' + clean(b0.note, 34) + '）' : '（需排查卡点条件）')
  }

  let needWhatText = '前提条件与执行环境基本齐备，可按既定节奏完成验证与收尾'
  if (blocked.length > 0) {
    needWhatText = '需要先解除受阻卡点并补齐相关前置验证条件'
  } else if (todo.length > 0 && workers.some(w => w.status === 'running')) {
    needWhatText = '需要等当前并行协作收口并完成关键结果核验'
  } else if (todo.length > 0) {
    needWhatText = '需要按序完成剩余收尾环节与最终效果检验'
  } else if (openPlan.length > 0) {
    needWhatText = '需要推进或确认当前待完成环节：' + clean(openPlan[0].text, 40)
  } else if (!board || !board.objective) {
    needWhatText = '需要明确具体的最终验收标准或本轮预期效果'
  }

  const pendingBoundOrApproval = (Array.isArray(suggestions) ? suggestions : []).find(
    s => s && s.status === 'pending' && (s.kind === 'goal_approval' || s.kind === 'bound' || s.kind === 'advice'),
  )
  let userNeedText = '暂无需您额外提供，参谋长与主对话可继续自动推进'
  if (needFromUserHint) {
    userNeedText = clean(needFromUserHint, 54)
  } else if (pendingBoundOrApproval) {
    userNeedText = '请您查看并拍板确认「' + clean(pendingBoundOrApproval.title, 38) + '」'
  } else if (blocked.length > 0 && /权限|登录|账号|密钥|token|重启|确认|决定|选择/i.test(String(blocked[0].note || blocked[0].title || ''))) {
    userNeedText = '需要您协助授权、提供凭据或拍板选定解决路线'
  } else if (openPlan.length > 0 && /用户|确认|拍板|点头|决定|选择/.test(String(openPlan[0].text || ''))) {
    userNeedText = '需要您拍板选定下一步路线：' + clean(openPlan[0].text, 38)
  }

  let adviceText = '建议保持当前推进节奏，收口前做一轮完整实测核对即可交卷'
  if (pendingBoundOrApproval && pendingBoundOrApproval.kind === 'advice') {
    adviceText = clean(pendingBoundOrApproval.reason || pendingBoundOrApproval.draftText || pendingBoundOrApproval.title, 54)
  } else if (blocked.length > 0) {
    adviceText = '建议先集中解决首要受阻目标，必要时由参谋长向主对话插话纠偏'
  } else if (openPlan.length > 0 && doing.length === 0 && todo.length === 0) {
    adviceText = '建议按当前待定环节及时确认方向，确认后即可顺畅续跑'
  } else if (todo.length > 0) {
    adviceText = '建议优先收拢在手推进项，顺势拿下紧接的待办目标'
  } else if ((done.length > 0 || (donePlan.length > 0 && !openPlan.length)) && !doing.length && !todo.length) {
    adviceText = '建议您核对整体表现，满意后即可批准结项或开启下一目标'
  }

  return [
    '## 极简目标战报',
    `- 【🎯 总目标】${objText}`,
    `- 【🚀 当前推进目标】${curText}`,
    `- 【⛔ 受阻目标】${blockedText}`,
    `- 【🧰 需要什么】${needWhatText}`,
    `- 【🙋 用户需要提供什么】${userNeedText}`,
    `- 【💡 参谋长建议】${adviceText}`,
  ].join('\n')
}

function shortAgentBriefName(name) {
  const raw = String(name || '').trim()
  if (!raw) return ''
  return raw
    .split('/')
    .map(seg => seg.replace(/[-_]([0-9a-f]{8,40})$/i, (_, hex) => '·' + hex.slice(0, 4)))
    .join('/')
}

function stripCheckpointNoise(text) {
  return String(text || '')
    .replace(/\[dsh-mnemon:[^\]]*\][\s\S]*/gi, '')
    .replace(/Bounded completed checkpoint[\s\S]*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isInternalCheckpointNoise(text) {
  const s = stripCheckpointNoise(text)
  if (!s) return true
  if (/^Mnemon idle checkpoint review\b/i.test(s)) return true
  return false
}

function summarizeSubagentsCompact(workers) {
  if (!Array.isArray(workers) || workers.length === 0) return ''
  const running = workers.filter(w => w.status === 'running')
  const idle = workers.filter(w => w.status !== 'running')
  const parts = []
  if (running.length > 0) {
    const detail = running.slice(0, 4).map(w => {
      const cleanTask = w.taskTitle && !isInternalCheckpointNoise(w.taskTitle) ? `（推进：${clamp(w.taskTitle, 28)}）` : ''
      return `@${shortAgentBriefName(w.name)}${cleanTask}`
    }).join('、')
    parts.push(`${running.length} 运行中：${detail}${running.length > 4 ? ' 等' : ''}`)
  }
  if (idle.length > 0) {
    if (running.length === 0 && idle.length <= 3) {
      parts.push(`待命：${idle.map(w => '@' + shortAgentBriefName(w.name)).join('、')}`)
    } else {
      parts.push(`${idle.length} 已结束/待命`)
    }
  }
  return `共 ${workers.length} 名子代理（${parts.join('；')}）`
}

function buildNarrativeInput({ board, facts, cluster, targets, peerProgress = [], archiveDigest = null }) {
  const bounds = (board && board.bounds) || { allowed: [], forbidden: [], notes: [] }
  const tasks = Array.isArray(board && board.tasks) ? board.tasks : []
  const memory = (Array.isArray(board && board.memory) ? board.memory : [])
    .filter(m => m && !isInternalCheckpointNoise(m.title || m.text))
  const anchors = (Array.isArray(board && board.notes) ? board.notes : []).filter(n => (n.tags || []).includes('anchor'))

  const lines = []
  if (board && board.objective) lines.push(`当前总目标：${board.objective}`)
  if ((bounds.forbidden || []).length) lines.push(`禁止红线：${bounds.forbidden.join('；')}`)
  if ((bounds.allowed || []).length) lines.push(`必做事项：${bounds.allowed.join('；')}`)
  if ((bounds.notes || []).length) lines.push(`边界注意：${bounds.notes.join('；')}`)

  if (cluster.length > 1) {
    lines.push(`跨窗口协同频道：当前已串联 ${cluster.length} 个主对话窗口协同作业（网络内自动共享进度）。`)
  }
  if (Array.isArray(peerProgress) && peerProgress.length > 0) {
    lines.push('', '【协同对话网络共享进度】')
    for (const p of peerProgress) {
      lines.push(`- 联动对话「${p.name}」[${p.status === 'running' ? '🟢运行中' : '⚪空闲'}]：目标="${p.objective || '未设'}" | 任务=${p.doneCount}完/${p.doingCount}做/${p.blockedCount}阻/${p.todoCount}待${p.cursorStep ? ` | 断点=${p.cursorStep}` : ''}`)
      if (Array.isArray(p.topTasks) && p.topTasks.length) {
        lines.push(`  · 在手任务：${p.topTasks.join('；')}`)
      }
      if (Array.isArray(p.recentConclusions) && p.recentConclusions.length) {
        lines.push(`  · 近期结论：${p.recentConclusions.join('；')}`)
      }
    }
  }
  const activeWorkers = targets.filter(t => t.kind === 'subagent' && !/^mnemon-(?:review|run)/i.test(String(t.name || t.key || '')))
  if (activeWorkers.length > 0) {
    lines.push(`子代理态势：${summarizeSubagentsCompact(activeWorkers)}`)
  }

  if (facts.length > 0) {
    lines.push('', '【持久记忆与纪律条目】')
    for (const f of facts) {
      lines.push(`- [${f.category}] ${f.text}`)
    }
  }

  if (anchors.length > 0) {
    lines.push('', '【关键锚点笔记】')
    for (const a of anchors.slice(0, 8)) {
      lines.push(`- ${a.title}：${clamp(a.body, 220)}`)
    }
  }

  if (tasks.length > 0) {
    const done = tasks.filter(t => t.status === 'done')
    const open = tasks.filter(t => t.status !== 'done')
    lines.push('', '【任务图态势】')
    for (const t of open.slice(0, 10)) {
      lines.push(`- 未完 [${t.status}] #${t.id} ${t.title}${t.owner ? '（@' + shortAgentBriefName(t.owner) + '）' : ''}${t.note ? '：' + clamp(t.note, 120) : ''}`)
    }
    for (const t of done.slice(-8)) {
      lines.push(`- 已完 #${t.id} ${t.title}${t.evidence ? '（证据：' + clamp(t.evidence, 140) + '）' : ''}`)
    }
  }

  if (memory.length > 0) {
    lines.push('', '【近期回合关键结论】')
    for (const m of memory.slice(-10)) {
      const cleaned = stripCheckpointNoise(m.title || m.text)
      if (cleaned) lines.push(`- [${m.section}] ${clamp(cleaned, 180)}`)
    }
  }

  if (archiveDigest) {
    const dSess = Array.isArray(archiveDigest.deskSessionItems) ? archiveDigest.deskSessionItems : []
    const dGlob = Array.isArray(archiveDigest.deskGlobalItems) ? archiveDigest.deskGlobalItems : []
    const dFlip = Array.isArray(archiveDigest.deskFlippedItems) ? archiveDigest.deskFlippedItems : []
    const mGlob = Array.isArray(archiveDigest.mountedGlobalItems) ? archiveDigest.mountedGlobalItems : []
    const sw = archiveDigest.sealedWatch || {}
    const deskAll = [
      ...dSess.map(it => `[桌面·本局(主可见)] 《${clamp(it.title, 40)}》：${clamp(it.summary || it.body, 140)}`),
      ...dGlob.map(it => `[桌面·全局(主可见)] 《${clamp(it.title, 40)}》：${clamp(it.summary || it.body, 140)}`),
      ...dFlip.map(it => `[桌面·沉淀(主可见)] 《${clamp(it.title, 40)}》：${clamp(it.summary || it.rawBody, 140)}`),
    ]
    if (deskAll.length > 0) {
      lines.push('', '【当前摆上桌面备选（重点强调，主对话与参谋长共同可见）】', ...deskAll.slice(0, 8).map(x => '- ' + x))
    }
    if (mGlob.length > 0) {
      lines.push('', '【参谋长单独参阅中的全局档案（主对话不可见）】')
      for (const it of mGlob.slice(0, 5)) {
        lines.push(`- [全局参阅] 《${clamp(it.title, 40)}》：${clamp(it.summary || it.body, 120)}`)
      }
    }
    const sealedLines = [
      ...((sw.sessionSealed || []).slice(0, 4).map(it => `- [本局封存·仅参谋关注] 《${clamp(it.title, 36)}》：${clamp(it.summary, 90)}`)),
      ...((sw.globalSealed || []).slice(0, 4).map(it => `- [全局封存·仅参谋关注] 《${clamp(it.title, 36)}》：${clamp(it.summary, 90)}`)),
      ...((sw.precipSealed || []).slice(0, 3).map(it => `- [沉淀封存·仅参谋关注] 《${clamp(it.title, 36)}》：${clamp(it.summary, 90)}`)),
    ]
    if (sealedLines.length > 0) {
      lines.push('', '【参谋长后台守望的三库封存索引（主对话上下文零注入）】', ...sealedLines)
    }
  }

  return lines.join('\n').trim()
}

/** Deterministic structured bullet summary when no LLM key is configured or while first summary is warming up. */
function buildFallbackNarrative({ board, facts, targets, peerProgress = [], conciseBrief = false, suggestions = [] }) {
  const sections = []
  const tasks = Array.isArray(board && board.tasks) ? board.tasks : []
  const blocked = tasks.filter(t => t.status === 'blocked')
  const doing = tasks.filter(t => t.status === 'doing')
  const todo = tasks.filter(t => t.status === 'todo')
  const done = tasks.filter(t => t.status === 'done')
  const workers = targets.filter(t => t.kind === 'subagent' && !/^mnemon-(?:review|run)/i.test(String(t.name || t.key || '')))

  if (conciseBrief) {
    return buildConciseSixLineReport({ board, blocked, doing, todo, done, workers, suggestions })
  }

  const statusBullets = []
  if (board && board.objective) {
    statusBullets.push(`- 【总目标】${clamp(board.objective, 150)}`)
  }
  for (const b of blocked.slice(0, 4)) {
    statusBullets.push(`- 【受阻】${clamp(b.title, 70)}${b.note ? ' — ' + clamp(b.note, 70) : ''}`)
  }
  for (const d of doing.slice(0, 4)) {
    const who = d.subagent || d.owner ? `（@${shortAgentBriefName(d.subagent || d.owner)}）` : ''
    statusBullets.push(`- 【推进中】${clamp(d.title, 72)}${who}`)
  }
  if (tasks.length > 0) {
    statusBullets.push(`- 【任务进度】已完成 ${done.length} 项 / 推进中 ${doing.length} 项 / 受阻 ${blocked.length} 项 / 待推进 ${todo.length} 项`)
  }
  if (workers.length > 0) {
    statusBullets.push(`- 【子代理团队】${summarizeSubagentsCompact(workers)}`)
  }
  if (Array.isArray(peerProgress) && peerProgress.length > 0) {
    for (const p of peerProgress.slice(0, 4)) {
      statusBullets.push(`- 【协同进度·${clamp(p.name, 22)}】${p.objective ? clamp(p.objective, 70) + ' · ' : ''}任务 ${p.doneCount}完/${p.doingCount}做${p.blockedCount ? `/${p.blockedCount}阻` : ''}${p.cursorStep ? '（断点：' + clamp(p.cursorStep, 32) + '）' : ''}`)
    }
  }
  if (statusBullets.length > 0) {
    sections.push('## 核心目标与态势\n' + statusBullets.join('\n'))
  }

  const otherFacts = facts.filter(f => f.category !== 'discipline' && f.category !== 'preference')
  const mem = (Array.isArray(board && board.memory) ? board.memory : [])
    .filter(m => m && !isInternalCheckpointNoise(m.title || m.text))
    .slice(-5)
  const progressBullets = [
    ...otherFacts.slice(-5).map(f => `- 【结论】${clamp(stripCheckpointNoise(f.text), 130)}`),
    ...mem.map(m => `- 【进展】${clamp(stripCheckpointNoise(m.title || m.text), 120)}`),
  ]
  if (progressBullets.length > 0) {
    sections.push('## 关键结论与进展\n' + progressBullets.join('\n'))
  }

  const bounds = (board && board.bounds) || { allowed: [], forbidden: [], notes: [] }
  const disciplines = facts.filter(f => f.category === 'discipline' || f.category === 'preference')
  const ruleBullets = []
  for (const f of (bounds.forbidden || []).slice(0, 6)) ruleBullets.push(`- 【禁止红线】${clamp(f, 110)}`)
  for (const a of (bounds.allowed || []).slice(0, 4)) ruleBullets.push(`- 【必做事项】${clamp(a, 110)}`)
  for (const n of (bounds.notes || []).slice(0, 3)) ruleBullets.push(`- 【注意事项】${clamp(n, 110)}`)
  for (const d of disciplines.slice(-5)) ruleBullets.push(`- 【协作纪律】${clamp(d.text, 120)}`)
  if (ruleBullets.length > 0) {
    sections.push('## 协作纪律与边界\n' + ruleBullets.join('\n'))
  }

  if (sections.length === 0) {
    return '## 尚无沉淀摘要\n- 【状态】当前会话刚启动，暂未沉淀阶段结论或红线纪律\n- 【用法】可在下方参谋栏直接立规矩、查进展，或用一句话拆话调度主对话与各子代理'
  }
  return sections.join('\n\n')
}

const summarizingLocks = new Map()

export async function getChiefView(deps, sessionId, { regenerate = false, autoSummarize = false, syncHandoff = undefined, _skipAutoPilotCheck = false } = {}) {
  const rootId = deps.resolveRootSessionId(sessionId) || String(sessionId || 'global')
  const directory = await listPeerDirectory(deps, rootId)
  const board = deps.boardForSession(deps.boardFileFor(rootId))
  const state = loadChiefState()
  const view = clusterView(state, rootId)
  const modelsInfo = await listChiefModels(deps, false, rootId)
  const effCfgBefore = resolveWorkspaceConfig(state, rootId)
  const paceMode = effCfgBefore.paceMode || 'manual'
  const isConciseBrief = Boolean(effCfgBefore.tacticalModes && effCfgBefore.tacticalModes.conciseBrief)
  const currentSig = view.clusterSig || computeClusterSig(directory.cluster)
  const peerProgress = directory.cluster.length > 1
    ? collectClusterPeerProgress(deps, directory.cluster, rootId)
    : []
  const archiveDigest = collectChiefVisibleArchives(deps, rootId, state)

  const rawInput = buildNarrativeInput({
    board,
    facts: view.facts,
    cluster: directory.cluster,
    targets: directory.targets,
    peerProgress,
    archiveDigest,
  })
  const inputHash = rawInput
    ? crypto.createHash('sha256').update(SUMMARY_FORMAT_REV + '\n' + (isConciseBrief ? 'concise:1' : 'concise:0') + '\n' + currentSig + '\n' + rawInput).digest('hex').slice(0, 24)
    : 'empty'

  const isClusterSigValid = (nar) => {
    if (!nar || !nar.text) return false
    if (nar.clusterSig && nar.clusterSig !== currentSig) return false
    if (!nar.clusterSig && directory.cluster.length > 1) return false
    return true
  }

  const hasSaved = isClusterSigValid(view.narrative)
  const lastSummaryAt = Number((view.narrative && view.narrative.at) || 0)
  const isFresh = !rawInput || (hasSaved && view.narrative.hash === inputHash)
  const cooledForAuto = Date.now() - lastSummaryAt >= AUTO_SUMMARY_COOLDOWN_MS
  const allowBackgroundSummary = paceMode === 'auto' && autoSummarize && !isFresh && cooledForAuto

  // Human-paced rule: ONLY call LLM when operator explicitly clicked Regenerate (`regenerate: true`),
  // OR when operator explicitly chose `paceMode === 'auto'` AND the 5-minute cooldown has elapsed!
  if (rawInput && (regenerate || allowBackgroundSummary) && modelsInfo.available && !summarizingLocks.has(rootId)) {
    const job = (async () => {
      const sysPrompt = isConciseBrief
        ? (NARRATIVE_SYSTEM + CONCISE_BRIEF_NARRATIVE_EXTRA)
        : NARRATIVE_SYSTEM
      const res = await callChiefLlm(deps, {
        sessionId: rootId,
        system: sysPrompt,
        prompt: rawInput + (isConciseBrief
          ? '\n\n请开启【极简战报模式】：分结构列出多个简明短句，不写具体数字参数，精确概括现状：'
          : '\n\n请按上述规范输出简体中文摘要：'),
        maxTokens: SUMMARY_MAX_TOKENS,
      })
      if (res.ok && res.text) {
        const finalNarText = isConciseBrief ? sanitizeConciseBriefText(res.text) : res.text
        mutateChiefState((s) => {
          const ws = ensureWorkspace(s, rootId)
          ws.narrative = {
            hash: inputHash,
            text: finalNarText,
            at: Date.now(),
            byModel: res.modelRef || '',
            clusterSig: currentSig,
          }
        })
      }
    })().finally(() => {
      summarizingLocks.delete(rootId)
    })
    summarizingLocks.set(rootId, job)
    if (regenerate) {
      await job.catch(() => {})
    }
  }

  const latestState = loadChiefState()
  const latestView = clusterView(latestState, rootId)
  const hasLatestSaved = isClusterSigValid(latestView.narrative)
  const latestFresh = !rawInput || (hasLatestSaved && latestView.narrative.hash === inputHash)
  const narrativeText = (hasLatestSaved && (!isConciseBrief || latestFresh))
    ? (isConciseBrief ? sanitizeConciseBriefText(latestView.narrative.text) : latestView.narrative.text)
    : buildFallbackNarrative({ board, facts: latestView.facts, targets: directory.targets, peerProgress, conciseBrief: isConciseBrief, suggestions: latestView.suggestions })

  // Optional 1-click Handoff Packet Sync on Digest regeneration or explicit sync request (strictly blocked if pinned by human!)
  let handoffSyncResult = null
  const latestBoardBeforeSync = deps.boardForSession(deps.boardFileFor(rootId))
  const shouldSyncHandoff = syncHandoff !== undefined
    ? Boolean(syncHandoff)
    : Boolean(regenerate && latestBoardBeforeSync && latestBoardBeforeSync.handoff && latestBoardBeforeSync.handoff.syncOnDigest)
  if (shouldSyncHandoff && typeof deps.runAction === 'function') {
    const isPinned = Boolean(latestBoardBeforeSync && latestBoardBeforeSync.handoff && latestBoardBeforeSync.handoff.pinned)
    if (isPinned) {
      handoffSyncResult = {
        synced: false,
        skipped: 'pinned-by-human',
        reason: 'pinned',
        message: '交接单已被人工定住，参谋长跳过自动覆写',
      }
    } else {
      const composed = typeof deps.composeHandoffFromNarrative === 'function'
        ? deps.composeHandoffFromNarrative(rootId, narrativeText)
        : ''
      if (composed && composed.trim()) {
        const saveRes = deps.runAction({
          action: 'handoff.save',
          session: rootId === 'global' ? '' : rootId,
          by: 'chief',
          source: 'chief',
          text: composed,
        })
        const isLocked = Boolean(saveRes && (saveRes.pinned || saveRes.locked))
        handoffSyncResult = saveRes && saveRes.ok
          ? { synced: true, at: Date.now() }
          : {
              synced: false,
              ...(isLocked ? { skipped: 'pinned-by-human' } : {}),
              reason: isLocked ? 'pinned' : 'error',
              message: (saveRes && saveRes.error) || '同步失败',
            }
      }
    }
  }

  const ownWsBeforeStop = ensureWorkspace(latestState, rootId)
  const effectiveConfigBeforeStop = resolveWorkspaceConfig(latestState, rootId)
  if (
    !_skipAutoPilotCheck
    && rootId
    && rootId !== 'global'
    && effectiveConfigBeforeStop.autoPilot
    && effectiveConfigBeforeStop.paceMode === 'auto'
    && !effectiveConfigBeforeStop.stopped
  ) {
    await checkAndStopIdleAutoPilot(deps, rootId, {
      allowStartupGrace: true,
      directory,
      currentFresh: latestFresh,
      fromViewCheck: true,
    }).catch(() => null)
  }

  const finalState = loadChiefState()
  const finalView = clusterView(finalState, rootId)
  const ownWs = ensureWorkspace(finalState, rootId)
  const effectiveConfig = resolveWorkspaceConfig(finalState, rootId)
  const narrativeAt = hasLatestSaved
    ? (latestView.narrative.at || 0)
    : (ownWs.narrative && ownWs.narrative.at ? ownWs.narrative.at : (board.updatedAt || 0))
  const finalNarrativeText = ownWs.narrative && ownWs.narrative.text && (!isConciseBrief || latestFresh)
    ? (isConciseBrief ? sanitizeConciseBriefText(ownWs.narrative.text) : ownWs.narrative.text)
    : narrativeText
  return {
    ok: true,
    rootId,
    config: effectiveConfig,
    models: modelsInfo,
    narrative: {
      text: finalNarrativeText,
      at: narrativeAt,
      byModel: hasLatestSaved ? (latestView.narrative.byModel || '') : ((ownWs.narrative && ownWs.narrative.byModel) || ''),
      clusterSig: currentSig,
      isLiveZeroToken: !hasLatestSaved && !(ownWs.narrative && ownWs.narrative.text),
      hasUnsummarizedChanges: Boolean(rawInput && !latestFresh && !(ownWs.narrative && ownWs.narrative.hash === inputHash)),
      summarizing: summarizingLocks.has(rootId),
      fresh: latestFresh || Boolean(ownWs.narrative && ownWs.narrative.hash === inputHash),
    },
    ...(handoffSyncResult ? { handoffSyncResult } : {}),
    facts: finalView.facts.slice().reverse(),
    suggestions: finalView.suggestions.slice().reverse(),
    chat: finalView.chat.slice(-40).map((c) => {
      if (!c || typeof c !== 'object') return c
      const cleaned = stripToolCallMarkup(c.text || '')
      return cleaned !== c.text
        ? { ...c, text: cleaned || '（该条历史响应仅包含内部工具调用标记，已自动净化）' }
        : c
    }),
    mailbox: finalView.mailbox.slice(-30).reverse(),
    peers: directory.targets,
    otherSessions: directory.otherSessions,
    cluster: directory.cluster,
    peerProgress,
    flippedPrecipitatedIds: (ownWs.flippedPrecipitatedIds || []).slice(),
    runtimeGuard: { ...ownWs.runtimeGuard },
    chiefRiskAck: ownWs.chiefRiskAck ? { ...ownWs.chiefRiskAck } : null,
    pendingApprovals: (Array.isArray(ownWs.pendingApprovals) ? ownWs.pendingApprovals : []).slice(-15).reverse(),
    pendingElevation: ownWs.pendingElevation ? { ...ownWs.pendingElevation } : null,
    auditLog: (Array.isArray(ownWs.auditLog) ? ownWs.auditLog : []).slice(-50).reverse(),
  }
}

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

    // Clone safe workspace chief config (model, pace, tactical preferences), ALWAYS forcing intervention=false & L0 advisor!
    const fromCfg = resolveWorkspaceConfig(state, fromKey)
    toWs.config = {
      modelRef: fromCfg.modelRef || '',
      paceMode: fromCfg.paceMode || 'manual',
      permissionMode: DEFAULT_CHIEF_PERMISSION_MODE,
      autoPilot: Boolean(fromCfg.autoPilot),
      autoReview: Boolean(fromCfg.autoReview),
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

const ASK_CHIEF_SYSTEM = [
  '你是「DSH 参谋长」（DSH Chief）——遵循四级权限安全架构（`L0 顾问 advisor` / `L1 助手 assistant` / `L2 参谋 strategist` / `L3 参谋长 chief`）的协同参谋中枢，新对话默认位于最低只读档 `L0 顾问模式`。',
  '你**绝不只是**被动的记忆检索器或传话筒！在当前所处权限允许范围内，你既可以动用实权工具直接核验/执行（或申请提权），也实时掌握：',
  '1) 主代理（@lead）与各子代理的**实时对话流快照**（刚刚说了什么、正在调什么工具、卡在哪里）；',
  '2) 参谋看板总目标、实时断点游标（cursor）、计划（plan）与任务拓扑（推进中 / 受阻 / 待办 / 已完成证据）；',
  '3) 双层工作边界（📌 定住全局跨任务共享边界 vs 仅当前任务边界）与持久记忆、便签、协同信箱。',
  '',
  '请精准洞悉用户意图——你的输入框就是用户的【全能许愿框】（态势汇报、只读核查、整理/维护看板与档案、修改工作区文件、调整主代理与子代理工作流、连接/断开协同网络或申请提权），并**只输出一个合法 JSON 对象**：',
  '{',
  '  "reply": "必须【简明、结构化、分点作答】！用换行 `- 【标签】结论` 列出（优先使用语义清晰标签：如【总目标】【实测执行】【推进中】【已完】【已验证】【结论】【待办】【受阻】【禁止红线】【权限提示】【下一步建议】），直给干货，绝不说『记忆里没有这条』，绝不堆砌废话或暴露内部 sessionId",',
  '  "toolCalls": [',
  '    { "tool": "read_file|list_dir|search_files|write_file|edit_file|run_command|main_agent_control|subagent_dispatch|subagent_steer|subagent_interrupt|archive_write|session_compact|request_permission_elevation", "args": {} }',
  '  ],',
  '  "elevationRequest": {',
  '    "targetMode": "assistant|strategist|chief",',
  '    "reason": "说明为何需要用户批准提权",',
  '    "requestedActionSummary": "拟执行的核心动作简述"',
  '  },',
  '  "relays": [',
  '    { "target": "成员 key 或名字（如 lead / 子代理名 / session-xxx / all）", "mode": "steer|followup|silent", "subject": "简短事由", "text": "替用户转化好的清晰可执行指令" }',
  '  ],',
  '  "memoryChanges": [',
  '    { "op": "add", "category": "discipline|architecture|progress|preference|team", "text": "一句独立完整的持久事实或规矩（不超过200字，绝不存密钥密码）" },',
  '    { "op": "edit", "index": 2, "text": "替换第2条的新内容" },',
  '    { "op": "remove", "index": 3 }',
  '  ],',
  '  "boundProposals": [',
  '    {',
  '      "field": "forbidden|allowed|notes",',
  '      "item": "拟请示用户注入的一句话高密度边界条文",',
  '      "reason": "撞墙教训、提炼依据或浓缩说明",',
  '      "replaces": ["可选：当把多条零散边界浓缩合并成一条时，逐字列出被合并替代的原边界条文"],',
  '      "pinGlobal": false',
  '    }',
  '  ],',
  '  "boardOps": [',
  '    { "op": "objective.set", "objective": "新总目标" },',
  '    { "op": "task.add", "title": "任务名", "owner": "可选负责人", "priority": "high|normal|low" },',
  '    { "op": "task.update", "id": "已有任务ID", "status": "todo|doing|blocked|done", "note": "可选进展或阻塞说明", "evidence": "可选完成证据", "owner": "可选负责人" },',
  '    { "op": "task.remove", "id": "要删除的任务ID" },',
  '    { "op": "task.reset", "status": "可选(all|open|done)，清空/重设任务列表", "resetPlan": false },',
  '    { "op": "graph.plan", "replace": false, "objective": "可选新目标", "tasks": [{ "id": "step1", "title": "重编任务", "owner": "", "priority": "high|normal|low", "blockedBy": [] }] },',
  '    { "op": "cursor.set", "step": "当前步骤", "next": "下一步具体动作", "blocked": "阻塞点（无则空串）" },',
  '    { "op": "bounds.set", "field": "forbidden|allowed|notes", "items": ["整列覆盖的新边界条文列表"] },',
  '    { "op": "bounds.forbid", "item": "用户明确下令立即写入的禁止红线", "pinGlobal": false },',
  '    { "op": "bounds.allow", "item": "用户明确下令立即写入的必做事项", "pinGlobal": false },',
  '    { "op": "bounds.note", "item": "用户明确下令立即写入的注意事项", "pinGlobal": false },',
  '    { "op": "bounds.remove", "field": "forbidden|allowed|notes", "item": "要移除的旧边界条文", "pinGlobal": false }',
  '  ],',
  '  "archiveOps": [',
  '    { "op": "organize", "vaultScope": "session|global", "scope": "unorganized|all", "instruction": "整理分类要求" },',
  '    { "op": "distill_to_global", "ids": ["可选：指定本局档案ID，留空自动筛选可复用本局经验"], "instruction": "提炼入全局要求" },',
  '    { "op": "take_out|put_back|mount_chief|unmount_chief|copy_to_global|copy_to_session|pull_precipitated|delete", "vaultScope": "session|global|precipitated", "id": "目标档案ID", "title": "或标题关键词", "targetScope": "session|global" },',
  '    { "op": "save", "vaultScope": "session|global", "title": "档案标题", "folder": "inbox|architecture|contracts|pitfalls|ops", "summary": "摘要", "body": "正文", "takeOut": false }',
  '  ],',
  '  "networkOps": [',
  '    { "op": "link|unlink", "targetSessionId": "目标独立会话ID或名称关键词" }',
  '  ]',
  '}',
  '',
  '宰相参谋与行事准则：',
  '- 【实权执行优先（禁止退化为纯传话筒）】：当用户要求你直接查文件、检查代码、修改补丁、跑测试/命令、直接派发/纠偏/中断子代理、记入档案或立即压缩时，务必先用 `toolCalls` 亲自执行并拿回真实结果后再汇报！只有用户明确要求转告 `@lead` / 其他窗口，或明确属主对话长程编码任务时，才使用 `relays` 递话。',
  '- 【许愿框全权自治】：无论整理/分类/提炼档案入全局、上下桌面、设定/覆盖/清空边界、重设/重编任务（`task.reset`/`graph.plan`），还是连接/断开独立窗口协同网络（`networkOps`），只要用户开口许愿且符合当前权限，直接输出对应 JSON ops 执行到位（严禁越级让本局档案直接跳级沉淀，必须遵循 `本局 -> 全局 -> 沉淀` 梯度），绝不推辞让用户自己去点按钮！',
  '- 【严守当前权限与禁止红线】：绝不越过当前权限等级上限，也绝不执行触发 `禁止红线 (forbidden)` 的写操作或高危命令。',
  '- 【问进展 / 问步骤 / 问卡点 / 求建议】：当用户询问“现在在做什么 / 处于什么步骤 / 目前进度如何 / 卡在哪里”等态势问题时，你面前的上下文已经完整包含「实时对话流快照」+「小任务板 (Plan)」+「任务图」+「断点游标」！直接用简明人话分点作答并放进 JSON 的 `reply` 字段，**严禁退化成纯工具 XML/DSML 标签输出，更严禁盲目运行 `run_command` / `list_dir` 扫盘**！只有用户明确要求去核查具体源码文件/跑命令实测时，才在 JSON `toolCalls` 里调工具。',
  '- 【代维护看板】：当用户让你「把某任务标为完成/受阻」「记一下下一步干啥」「改总目标」时，直接通过 `boardOps`（`task.update` / `cursor.set` / `objective.set` / `task.add`）落实（若强介入已锁定核心目标，则提示先解锁或关闭强介入）。',
  '- 【边界奏请与零散浓缩】：',
  '  1) 总结踩坑红线或必做要求时，生成 `boundProposals` 呈交用户拍板（若用户提到「全局定住/以后所有任务都生效」则设 `"pinGlobal": true`）；只有用户明确下令「直接写进禁止/必做边界」时才用 `boardOps`。',
  '  2) 当用户要求「把重要的零散边界总结成一条 / 合并重复边界」时，仔细阅读现有边界，保留关键命令名/路径/硬红线，浓缩为 1 条精炼总则放入 `boundProposals[0].item`，并把被它吸收替代的旧条文原样放进 `replaces` 数组（若被合并旧规中含 📌 全局定住项，则 `"pinGlobal": true`）。',
  '- 【看图与带图拆话】：当用户附带上传图片时，请直接结合图片画面诊断 UI 样式、报错截图或架构图；若你在 relays 中向代理拆话派活，系统会自动把用户附带的图片一并转送给目标代理。',
].join('\n')

const CONCISE_BRIEF_ASK_EXTRA = [
  '',
  '⚡ 【极简战报模式已开启 — reply 字段强约束（六句话目标边界系列）】：',
  '- 一切以目标为导向，说人话，拒绝任何文件/代码/命令/端口/数字/计数等事务细节！',
  '- 总结现状或汇报进度时，优先按如下 6 条一句话边界结构输出：',
  '  ## 极简目标战报',
  '  - 【🎯 总目标】一句话说清最终目标',
  '  - 【🚀 当前推进目标】一句话说清正在推进的目标',
  '  - 【⛔ 受阻目标】一句话点明受阻处或“当前暂无受阻目标”',
  '  - 【🧰 需要什么】一句话说明还需什么条件或验证',
  '  - 【🙋 用户需要提供什么】一句话说明需用户提供/拍板的内容（或“暂无需您额外提供”）',
  '  - 【💡 参谋长建议】一句话给出明确建议',
].join('\n')

const CONSOLIDATE_BOUNDS_SYSTEM = [
  '你是「DSH 参谋长」（宰相级边界治理中枢）。用户的边界列表中积累了多条零散、重复或同一主题的规则。',
  '请将给定的多条零散边界**浓缩合并成唯一 1 条**高信息密度、表述清晰、可直接执行的精炼总则（不超过 180 字）。',
  '硬性要求：',
  '- 必须完整保留关键具象锚点（如禁止的具体命令 `git push` / `install_bundle`、具体目录路径、权限红线），绝不能浓缩成空洞套话！',
  '- 用紧凑的分号或并列短句收纳核心约束，去除重复啰嗦的铺垫词。',
  '- **只输出一个合法 JSON 对象**：',
  '{',
  '  "item": "浓缩合并后的单条精炼边界总则（≤180字）",',
  '  "reason": "简述合并了哪几类零散约束（≤70字）"',
  '}',
].join('\n')

/**
 * Inspect live in-memory conversation streams (`agent.session.deriveMessages()`)
 * across `@lead` and active/recent `@subagents` so DSH Chief has real-time
 * situational awareness even before a turn settles into `board.tasks` or `board.memory`.
 */
function collectLiveConversationsDigest(deps, rootId, directory) {
  const entries = []
  const runtime = deps && deps.runtime
  const agentsSvc = runtime ? runtime.get('agents') : null
  if (!agentsSvc || typeof agentsSvc.get !== 'function') {
    return { entries, summaryLines: [] }
  }

  const allTargets = Array.isArray(directory && directory.targets) ? directory.targets : []
  // Filter out idle internal checkpoint probes (`mnemon-review-*`) so real workers stand out
  const meaningfulTargets = allTargets.filter(t => {
    if (!t || !t.id) return false
    if (t.kind === 'lead') return true
    if (t.status === 'running') return true
    return !/^mnemon-review/i.test(String(t.name || t.handle || ''))
  })

  // Prioritize: lead first, then running subagents/peers, then up to 4 recent workers
  const ordered = [
    ...meaningfulTargets.filter(t => t.kind === 'lead'),
    ...meaningfulTargets.filter(t => t.kind !== 'lead' && t.status === 'running'),
    ...meaningfulTargets.filter(t => t.kind !== 'lead' && t.status !== 'running'),
  ].slice(0, 6)

  if (!ordered.length && rootId) {
    ordered.push({ key: 'lead', id: rootId, handle: 'lead', name: '主对话', kind: 'lead', status: 'idle', taskTitle: '' })
  }

  for (const peer of ordered) {
    let agent = null
    try {
      agent = agentsSvc.get(peer.id)
    } catch {}
    if (!agent || !agent.session || typeof agent.session.deriveMessages !== 'function') continue

    let msgs = []
    try {
      msgs = agent.session.deriveMessages() || []
    } catch {
      continue
    }
    if (!Array.isArray(msgs) || !msgs.length) continue

    const liveStatus = agent.status === 'running' ? 'running' : (peer.status || 'idle')
    let lastUser = ''
    const recentAssistant = []
    const recentTools = []

    const tail = msgs.slice(-8)
    for (const m of tail) {
      if (!m || !m.role) continue
      const isInjected = m.source && m.source.kind && m.source.kind !== 'user'
      const blocks = Array.isArray(m.content)
        ? m.content
        : (typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : [])

      const textParts = []
      for (const b of blocks) {
        if (!b || typeof b !== 'object') continue
        if (b.type === 'text' && typeof b.text === 'string') {
          textParts.push(b.text)
        } else if ((b.type === 'tool_use' || b.type === 'tool-call' || b.type === 'toolCall') && (b.name || b.toolName)) {
          const tName = String(b.name || b.toolName)
          let argHint = ''
          try {
            const rawArgs = b.input || b.arguments || b.args
            const obj = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs
            if (obj && typeof obj === 'object') {
              const keyVal = obj.command || obj.cmd || obj.action || obj.path || obj.file_path || obj.query || obj.url || obj.agent || obj.title || ''
              if (keyVal && !secretLike(String(keyVal))) argHint = clamp(String(keyVal), 48)
            }
          } catch {}
          recentTools.push(argHint ? `${tName}(${argHint})` : tName)
        }
      }

      const txt = stripCheckpointNoise(textParts.join('\n').trim())
      if (!txt || isInternalCheckpointNoise(txt) || secretLike(txt)) continue

      if (m.role === 'user' && !isInjected) {
        lastUser = clamp(txt, 260)
      } else if (m.role === 'assistant') {
        recentAssistant.push(clamp(txt, 380))
      }
    }

    if (!lastUser && !recentAssistant.length && !recentTools.length) continue
    entries.push({
      key: peer.key,
      handle: peer.handle || peer.name || peer.key,
      kind: peer.kind,
      status: liveStatus,
      taskTitle: peer.taskTitle || '',
      lastUser,
      lastAssistant: recentAssistant.length ? recentAssistant[recentAssistant.length - 1] : '',
      recentTools: recentTools.slice(-4),
    })
  }

  const summaryLines = entries.map((e) => {
    const parts = [`- **@${e.handle}** [${e.status === 'running' ? '🟢运行中' : '⚪空闲'}]${e.taskTitle ? '（负责：' + clamp(e.taskTitle, 48) + '）' : ''}`]
    if (e.lastUser) parts.push(`  · 最近用户指令：${e.lastUser}`)
    if (e.recentTools.length) parts.push(`  · 近期工具动作：${e.recentTools.join(' → ')}`)
    if (e.lastAssistant) parts.push(`  · 最新回复/进展：${e.lastAssistant}`)
    return parts.join('\n')
  })

  return { entries, summaryLines }
}

function extractJsonObject(raw) {
  const text = String(raw || '').trim()
  if (!text) return null
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  try {
    const direct = JSON.parse(stripped)
    if (direct && typeof direct === 'object') return direct
  } catch {}
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first !== -1 && last > first) {
    try {
      const sliced = JSON.parse(text.slice(first, last + 1))
      if (sliced && typeof sliced === 'object') return sliced
    } catch {}
  }
  return null
}

function applyFactChanges(ws, numberedFacts, changes, actor = 'user', meta = {}) {
  const applied = []
  if (!Array.isArray(changes) || !changes.length) return applied
  const originRootId = typeof meta.originRootId === 'string' ? meta.originRootId : ''
  const clusterRoots = Array.isArray(meta.peerRootIds) ? meta.peerRootIds : []

  for (const ch of changes.slice(0, 12)) {
    if (!ch || typeof ch !== 'object') continue
    const op = String(ch.op || '').trim()
    if (op === 'add') {
      const category = ch.category || 'discipline'
      const fact = normalizeFact({
        text: ch.text,
        category,
        by: actor,
        source: 'chief',
        originRootId: originRootId && originRootId !== 'global' ? originRootId : '',
        peerRootIds: category === 'team' ? clusterRoots : [],
      })
      if (!fact) continue
      const dup = ws.facts.find(f => f.text === fact.text)
      if (dup) {
        dup.updatedAt = Date.now()
        continue
      }
      ws.facts.push(fact)
      if (ws.facts.length > FACTS_CAP) ws.facts = ws.facts.slice(-FACTS_CAP)
      applied.push({ op: 'add', text: fact.text })
    } else if (op === 'edit') {
      const target = numberedFacts[Number(ch.index) - 1]
      const nextText = clamp(ch.text, FACT_TEXT_MAX)
      if (!target || !nextText || secretLike(nextText)) continue
      const found = ws.facts.find(f => f.id === target.id)
      if (found && !found.pinned) {
        found.text = nextText
        found.updatedAt = Date.now()
        applied.push({ op: 'edit', text: nextText })
      }
    } else if (op === 'remove') {
      const target = numberedFacts[Number(ch.index) - 1]
      if (!target) continue
      const idx = ws.facts.findIndex(f => f.id === target.id)
      if (idx !== -1 && !ws.facts[idx].pinned) {
        const [removed] = ws.facts.splice(idx, 1)
        applied.push({ op: 'remove', text: removed.text })
      }
    }
  }
  return applied
}

function applyBoardOps(deps, rootId, boardOps, opts = {}) {
  const executed = []
  if (!Array.isArray(boardOps) || !boardOps.length || !deps || typeof deps.runAction !== 'function') return executed
  const forceSessionOnly = Boolean(opts && opts.forceSessionOnly)
  const allowLockedObjectiveWrite = Boolean(opts && opts.allowLockedObjectiveWrite)
  const effCfg = resolveWorkspaceConfig(loadChiefState(), rootId)
  const objectiveLocked = Boolean(effCfg && effCfg.tacticalModes && effCfg.tacticalModes.intervention) && !allowLockedObjectiveWrite

  for (const opItem of boardOps.slice(0, 10)) {
    if (!opItem || typeof opItem !== 'object') continue
    const op = String(opItem.op || '').trim()
    if (op === 'objective.set' && opItem.objective) {
      if (objectiveLocked) {
        executed.push('核心目标已锁定（强介入进行中，跳过改写）')
        continue
      }
      deps.runAction({ action: 'objective.set', objective: String(opItem.objective), session: rootId, by: 'chief' })
      executed.push('更新目标：' + clamp(opItem.objective, 40))
    } else if (op === 'task.add' && opItem.title) {
      deps.runAction({
        action: 'task.add',
        title: String(opItem.title),
        owner: opItem.owner ? String(opItem.owner) : '',
        subagent: opItem.owner ? String(opItem.owner) : '',
        priority: opItem.priority || 'normal',
        session: rootId,
        by: 'chief',
      })
      executed.push('新增任务：' + clamp(opItem.title, 40))
    } else if (op === 'task.update' && (opItem.id || opItem.taskId)) {
      const tid = String(opItem.id || opItem.taskId).trim()
      const res = deps.runAction({
        action: 'task.update',
        id: tid,
        ...(typeof opItem.status === 'string' ? { status: opItem.status } : {}),
        ...(typeof opItem.note === 'string' ? { note: opItem.note } : {}),
        ...(typeof opItem.evidence === 'string' ? { evidence: opItem.evidence } : {}),
        ...(typeof opItem.owner === 'string' ? { owner: opItem.owner } : {}),
        session: rootId,
        by: 'chief',
      })
      if (res && res.ok) executed.push(`更新任务 #${tid}${opItem.status ? ' → ' + opItem.status : ''}`)
    } else if (op === 'task.remove' && (opItem.id || opItem.taskId)) {
      const tid = String(opItem.id || opItem.taskId).trim()
      const res = deps.runAction({ action: 'task.remove', id: tid, session: rootId, by: 'chief' })
      if (res && res.ok) executed.push(`移除任务 #${tid}`)
    } else if (op === 'task.reset') {
      const res = deps.runAction({
        action: 'task.reset',
        ...(typeof opItem.status === 'string' ? { status: opItem.status } : {}),
        ...(opItem.resetPlan !== undefined ? { resetPlan: Boolean(opItem.resetPlan) } : {}),
        session: rootId,
        by: 'chief',
      })
      if (res && res.ok) executed.push(`重设任务看板(${res.removedCount ?? 0}项)`)
    } else if ((op === 'graph.plan' || op === 'task.batch') && Array.isArray(opItem.tasks) && opItem.tasks.length > 0) {
      const canSetObj = !objectiveLocked && typeof opItem.objective === 'string' && opItem.objective.trim()
      const res = deps.runAction({
        action: 'graph.plan',
        tasks: opItem.tasks,
        ...(canSetObj ? { objective: opItem.objective } : {}),
        ...(opItem.replace !== undefined ? { replace: Boolean(opItem.replace) } : {}),
        session: rootId,
        by: 'chief',
      })
      if (res && res.ok) executed.push(`重编任务拓扑(${(res.tasks || opItem.tasks).length}项)`)
    } else if (op === 'cursor.set') {
      const res = deps.runAction({
        action: 'cursor.set',
        ...(typeof opItem.step === 'string' ? { step: opItem.step } : {}),
        ...(typeof opItem.next === 'string' ? { next: opItem.next } : {}),
        ...(typeof opItem.blocked === 'string' ? { blocked: opItem.blocked } : {}),
        session: rootId,
        by: 'chief',
      })
      if (res && res.ok) executed.push('更新推进断点')
    } else if (op === 'plan.resetForGoal') {
      const res = deps.runAction({ action: 'plan.resetForGoal', session: rootId, by: 'chief' })
      if (res && res.ok) executed.push('清空陈旧计划以便按新目标重编')
    } else if (op === 'plan.set' && Array.isArray(opItem.steps)) {
      const steps = opItem.steps.map(s => (typeof s === 'string' ? { text: s, done: false } : s)).filter(Boolean)
      if (steps.length > 0) {
        const res = deps.runAction({ action: 'plan.set', steps, session: rootId, by: 'chief' })
        if (res && res.ok) executed.push(`更新计划共 ${steps.length} 步`)
      }
    } else if (op === 'goal.proposeApproval') {
      const res = deps.runAction({
        action: 'goal.proposeApproval',
        objective: String(opItem.objective || ''),
        summary: String(opItem.summary || ''),
        evidence: String(opItem.evidence || ''),
        session: rootId,
        by: 'chief',
      })
      if (res && res.ok) executed.push('呈批目标结项')
    } else if (op === 'bounds.set') {
      const rawField = String(opItem.field || '').trim().toLowerCase()
      const normField = rawField === 'must' ? 'allowed' : rawField
      const col = ['forbidden', 'allowed', 'notes'].includes(normField) ? normField : ''
      if (col && Array.isArray(opItem.items)) {
        const items = opItem.items.map(x => clamp(x, 220)).filter(Boolean)
        const res = deps.runAction({ action: 'bounds.set', field: col, items, session: rootId, by: 'chief' })
        if (res && res.ok) executed.push(`覆写边界(${col})共 ${items.length} 条`)
      } else if (Array.isArray(opItem.allowed) || Array.isArray(opItem.must) || Array.isArray(opItem.forbidden) || Array.isArray(opItem.notes)) {
        const allowList = Array.isArray(opItem.allowed) ? opItem.allowed : opItem.must
        const res = deps.runAction({
          action: 'bounds.set',
          ...(Array.isArray(allowList) ? { allowed: allowList.map(x => clamp(x, 220)).filter(Boolean) } : {}),
          ...(Array.isArray(opItem.forbidden) ? { forbidden: opItem.forbidden.map(x => clamp(x, 220)).filter(Boolean) } : {}),
          ...(Array.isArray(opItem.notes) ? { notes: opItem.notes.map(x => clamp(x, 220)).filter(Boolean) } : {}),
          session: rootId,
          by: 'chief',
        })
        if (res && res.ok) executed.push('重置边界列表')
      }
    } else if ((op === 'bounds.forbid' || op === 'bounds.allow' || op === 'bounds.must' || op === 'bounds.note') && opItem.item) {
      const field = op === 'bounds.forbid' ? 'forbidden' : (op === 'bounds.note' ? 'notes' : 'allowed')
      const label = field === 'forbidden' ? '红线' : (field === 'notes' ? '注意' : '必做')
      const val = clamp(opItem.item, 220)
      const pinned = forceSessionOnly ? false : Boolean(opItem.pinGlobal)
      if (val) {
        const res = deps.runAction({
          action: 'bounds.add',
          field,
          item: val,
          pinned,
          session: rootId,
          by: 'chief',
        })
        if (res && res.ok) {
          executed.push(`${pinned ? '📌全局' : '本任务'}${label}：${clamp(val, 30)}`)
        }
      }
    } else if (op === 'bounds.remove' && opItem.item) {
      const field = ['forbidden', 'allowed', 'notes'].includes(opItem.field) ? opItem.field : 'forbidden'
      const val = clamp(opItem.item, 220)
      const pinned = forceSessionOnly ? false : Boolean(opItem.pinGlobal)
      if (val) {
        const res = deps.runAction({
          action: 'bounds.remove',
          field,
          item: val,
          pinned,
          session: rootId,
          by: 'chief',
        })
        if (res && res.ok) {
          executed.push(`移除边界：${clamp(val, 30)}`)
        }
      }
    }
  }
  return executed
}

/**
 * Execute Wishing-Box `archiveOps` across Session / Global / Precipitated vaults
 * while strictly preserving the upward gradient (`session -> global -> precipitated`;
 * direct session -> precipitated jump is forbidden).
 */
async function applyArchiveOps(deps, rootId, archiveOps, ctx = {}) {
  const executed = []
  if (!Array.isArray(archiveOps) || !archiveOps.length) return { executed, changed: false }
  const sid = rootId && rootId !== 'global' ? String(rootId).trim() : ''
  const globalOpt = archiveTargetForRoot(deps, sid || 'global', { vaultScope: 'global' })
  const sessionOpt = sid ? archiveTargetForRoot(deps, sid, { vaultScope: 'session' }) : null
  const projectKey = resolveProjectKey(globalOpt.cwd)
  let changed = false

  const resolveItemInScope = (scope, rawId, rawTitle) => {
    const idQ = String(rawId || '').trim()
    const titleQ = String(rawTitle || '').trim().toLowerCase()
    if (scope === 'precipitated') {
      const items = listPrecipitatedHeaders(projectKey, sid, globalOpt) || []
      if (idQ) {
        const exact = items.find(it => it.id === idQ)
        if (exact) return exact.id
      }
      if (titleQ) {
        const byTitle = items.find(it => String(it.title || '').toLowerCase().includes(titleQ))
        if (byTitle) return byTitle.id
      }
      return idQ
    }
    const opt = scope === 'global' ? globalOpt : sessionOpt
    if (!opt) return idQ
    const store = loadArchiveStore(opt)
    const items = Array.isArray(store.items) ? store.items : []
    if (idQ) {
      const exact = items.find(it => it.id === idQ)
      if (exact) return exact.id
    }
    if (titleQ) {
      const byTitle = items.find(it => String(it.title || '').toLowerCase().includes(titleQ))
      if (byTitle) return byTitle.id
    }
    return idQ
  }

  for (const opItem of archiveOps.slice(0, 8)) {
    if (!opItem || typeof opItem !== 'object') continue
    const op = String(opItem.op || '').trim()
    const scope = opItem.vaultScope === 'precipitated'
      ? 'precipitated'
      : (opItem.vaultScope === 'global' ? 'global' : 'session')

    if (op === 'organize') {
      const orgScope = opItem.vaultScope === 'global' ? 'global' : 'session'
      if (orgScope === 'session' && !sid) continue
      const r = await organizeArchivesWithChief(deps, {
        sessionId: sid || 'global',
        vaultScope: orgScope,
        ids: Array.isArray(opItem.ids) ? opItem.ids : [],
        scope: opItem.scope === 'all' ? 'all' : 'unorganized',
        instruction: String(opItem.instruction || ctx.input || ''),
      }).catch(() => null)
      if (r && r.ok) {
        changed = true
        executed.push(`整理${orgScope === 'global' ? '全局' : '本局'}档案 ×${r.updatedCount ?? 0}`)
      }
    } else if (op === 'distill_to_global' || op === 'distill') {
      if (!sid) continue
      const r = await distillSessionArchivesToGlobal(deps, {
        sessionId: sid,
        ids: Array.isArray(opItem.ids) ? opItem.ids : (opItem.id ? [opItem.id] : []),
        instruction: String(opItem.instruction || ctx.input || ''),
      }).catch(() => null)
      if (r && r.ok) {
        changed = true
        executed.push(`提炼入全局 ×${r.createdCount ?? 0}`)
      }
    } else if (op === 'save' || op === 'create') {
      if (scope === 'precipitated') continue // strict gradient: cannot write directly into precipitated
      if (scope === 'session' && !sid) continue
      const targetOpt = scope === 'global' ? globalOpt : sessionOpt
      const r = mutateArchive({
        op: 'save',
        vaultScope: scope,
        rootSessionId: sid,
        folder: opItem.folder || 'inbox',
        paperclip: ['gold', 'silver', 'copper'].includes(opItem.paperclip) ? opItem.paperclip : 'silver',
        title: clamp(opItem.title || '参谋长工作归档', 160),
        summary: clamp(opItem.summary || '', 400),
        body: cleanMultiline(opItem.body || opItem.summary || opItem.title || '', 12000),
        takeOutNow: Boolean(opItem.takeOut),
        by: 'chief',
      }, targetOpt)
      if (r && r.ok) {
        changed = true
        executed.push(`存档(${scope === 'global' ? '全局' : '本局'})：《${clamp(opItem.title || '', 24)}》`)
      }
    } else if (op === 'take_out' || op === 'put_back') {
      if (!sid) continue
      const hitId = resolveItemInScope(scope, opItem.id || opItem.archiveId, opItem.title)
      if (!hitId) continue
      if (scope === 'precipitated') {
        const pOp = op === 'take_out' ? 'flipOut' : 'sealBack'
        const r = mutatePrecipitated(projectKey, { op: pOp, id: hitId, rootSessionId: sid }, { ...globalOpt, rootSessionId: sid })
        if (r && r.ok) {
          updateWorkspaceFlippedIds(sid, pOp === 'flipOut' ? { flippedId: hitId } : { sealId: hitId })
          changed = true
          executed.push(`${op === 'take_out' ? '摆上桌面(沉淀)' : '放回封存(沉淀)'} #${hitId}`)
        }
      } else {
        const targetOpt = scope === 'global' ? globalOpt : sessionOpt
        const r = mutateArchive({
          op: op === 'take_out' ? 'takeOut' : 'putBack',
          vaultScope: scope,
          rootSessionId: sid,
          id: hitId,
        }, targetOpt)
        if (r && r.ok) {
          changed = true
          executed.push(`${op === 'take_out' ? '摆上桌面' : '放回封存'} #${hitId}`)
        }
      }
    } else if (op === 'mount_chief' || op === 'unmount_chief') {
      if (!sid) continue
      const hitId = resolveItemInScope('global', opItem.id || opItem.archiveId, opItem.title)
      if (!hitId) continue
      const r = mutateArchive({
        op: op === 'mount_chief' ? 'mountChief' : 'unmountChief',
        vaultScope: 'global',
        rootSessionId: sid,
        id: hitId,
      }, globalOpt)
      if (r && r.ok) {
        changed = true
        executed.push(`${op === 'mount_chief' ? '参阅全局档案' : '取消全局参阅'} #${hitId}`)
      }
    } else if (op === 'copy_to_global') {
      if (!sid) continue
      const hitId = resolveItemInScope('session', opItem.id || opItem.archiveId, opItem.title)
      if (!hitId) continue
      const r = mutateArchive({ op: 'copyToGlobal', vaultScope: 'session', rootSessionId: sid, id: hitId }, sessionOpt)
      if (r && r.ok) {
        changed = true
        executed.push(`升入全局档案 #${hitId}`)
      }
    } else if (op === 'copy_to_session') {
      if (!sid) continue
      const hitId = resolveItemInScope('global', opItem.id || opItem.archiveId, opItem.title)
      if (!hitId) continue
      const r = mutateArchive({ op: 'copyToSession', vaultScope: 'global', rootSessionId: sid, id: hitId }, globalOpt)
      if (r && r.ok) {
        changed = true
        executed.push(`全局调入本局 #${hitId}`)
      }
    } else if (op === 'pull_precipitated') {
      const targetScope = opItem.targetScope === 'global' ? 'global' : 'session'
      if (targetScope === 'session' && !sid) continue
      const hitId = resolveItemInScope('precipitated', opItem.id || opItem.archiveId, opItem.title)
      if (!hitId) continue
      const r = copyPrecipitatedToVault(projectKey, {
        id: hitId,
        targetScope,
        rootSessionId: sid,
        takeOutNow: Boolean(opItem.takeOut),
      }, { ...globalOpt, rootSessionId: sid })
      if (r && r.ok) {
        changed = true
        executed.push(`沉淀无损调入${targetScope === 'global' ? '全局' : '本局'} #${hitId}`)
      }
    } else if (op === 'move_folder' && opItem.folder) {
      if (scope === 'precipitated') continue
      if (scope === 'session' && !sid) continue
      const targetOpt = scope === 'global' ? globalOpt : sessionOpt
      const hitId = resolveItemInScope(scope, opItem.id || opItem.archiveId, opItem.title)
      if (!hitId) continue
      const r = mutateArchive({ op: 'moveFolder', vaultScope: scope, rootSessionId: sid, id: hitId, folder: opItem.folder }, targetOpt)
      if (r && r.ok) {
        changed = true
        executed.push(`移动档案分类 → ${opItem.folder}`)
      }
    } else if (op === 'delete' || op === 'remove') {
      if (scope === 'precipitated') continue
      if (scope === 'session' && !sid) continue
      const targetOpt = scope === 'global' ? globalOpt : sessionOpt
      const hitId = resolveItemInScope(scope, opItem.id || opItem.archiveId, opItem.title)
      if (!hitId) continue
      const r = mutateArchive({ op: 'delete', vaultScope: scope, rootSessionId: sid, id: hitId }, targetOpt)
      if (r && r.ok) {
        changed = true
        executed.push(`移除${scope === 'global' ? '全局' : '本局'}档案 #${hitId}`)
      }
    }
  }

  return { executed, changed }
}

/** Execute Wishing-Box `networkOps` to link or unlink standalone DSH sessions. */
function applyNetworkOps(rootId, networkOps, directory) {
  const executed = []
  if (!Array.isArray(networkOps) || !networkOps.length || !rootId || rootId === 'global') return executed
  const otherSessions = (directory && Array.isArray(directory.otherSessions)) ? directory.otherSessions : []

  for (const opItem of networkOps.slice(0, 6)) {
    if (!opItem || typeof opItem !== 'object') continue
    const op = String(opItem.op || '').trim()
    if (op !== 'link' && op !== 'unlink') continue
    const rawQ = String(opItem.targetSessionId || opItem.target || opItem.sessionId || opItem.name || '').trim()
    if (!rawQ) continue
    const qLower = rawQ.toLowerCase()
    const match = otherSessions.find(s =>
      s.id === rawQ
      || String(s.id).toLowerCase().includes(qLower)
      || (s.name && String(s.name).toLowerCase().includes(qLower))
    )
    const targetSid = match ? match.id : (/^session-/i.test(rawQ) ? rawQ : '')
    if (!targetSid || targetSid === rootId) continue
    const r = setPeerLink(rootId, targetSid, op === 'link')
    if (r && r.ok) {
      executed.push(`${op === 'link' ? '连接协同窗口' : '断开协同窗口'}：${match ? match.name : targetSid.slice(0, 14)}`)
    }
  }
  return executed
}

/** Detect pure beginner progress/status questions where all truth is already in live snapshot + board (zero disk/shell tools needed). */
function isPureStatusInquiry(rawText) {
  const q = String(rawText || '').trim()
  if (!q || q.length > 90) return false
  if (/read_file|write_file|edit_file|run_command|list_dir|search_files|执行|运行|测试|跑一下|改一下|写一个|修一下|删除|新建|创建|安装|部署|派发|递话|转告|中断|清[空理]|重设|重置|提炼|浓缩|合并/.test(q)) {
    return false
  }
  return /(?:现在在做什么|在做什么|在干嘛|在干什么|处于什么步骤|什么步骤|第几步|到哪一步|到哪了|做到哪|进度|进展|情况如何|怎么样了|当前状态|实时状态|团队在|主对话在|主代理在|子代理在)/.test(q)
}

/** Detect explicit user requests asking Chief to immediately compress/compact context. */
export function isExplicitCompactCommand(rawText) {
  const q = String(rawText || '').trim()
  if (!q || q.length > 80) return false
  if (/不要压缩|别压缩|不用压缩|停止压缩|关闭压缩|取消压缩|为什么|为啥|没触发|未触发|不能|无法|报错|失败|是什么|原理|区别|开关|怎么(?:设置|用|开|关)/.test(q)) {
    return false
  }
  if (/^\/compact(?:\s|$)/i.test(q)) return true
  if (!/压缩/.test(q)) return false
  if (/文件|图片|视频|音频|zip|tar|gzip|rar|7z|打包/i.test(q) && !/上下文|对话|会话|历史|记忆|session|context/i.test(q)) {
    return false
  }
  return /^(?:请|麻烦|帮我|给我|你|可以|先|赶紧|立即|立刻|马上|现在|把[\u4e00-\u9fa5]{0,12})*(?:执行|触发|做一下|跑一下|开始|进行|归档并|抢救并)?(?:一键|手动|静默)?(?:当前|一下|下)?(?:上下文|对话|会话|历史|内容|内存)?压缩(?:当前|一下|下)?(?:上下文|对话|会话|历史|内存)?(?:吧|一下|下|呀|啊|哦|嘛|呢|好了|好吗|可以吗|！|!|。|\.)*$/i.test(q)
}

/**
 * Holistic offline/fallback intelligence synthesizer so DSH Chief NEVER
 * utters "记忆里没有这条" even if every configured LLM provider is unreachable.
 */
function buildSmartFallbackReply({ input, board, liveDigest, directory, facts = [], mailbox = [], conciseBrief = false }) {
  const q = String(input || '').trim()
  const qLower = q.toLowerCase()
  const tasks = Array.isArray(board && board.tasks) ? board.tasks : []
  const planSteps = Array.isArray(board && board.plan) ? board.plan.filter(Boolean) : []
  const openPlan = planSteps.filter(s => !s.done)
  const donePlan = planSteps.filter(s => s.done)
  const doing = tasks.filter(t => t.status === 'doing')
  const blocked = tasks.filter(t => t.status === 'blocked')
  const todo = tasks.filter(t => t.status === 'todo')
  const done = tasks.filter(t => t.status === 'done')
  const cursor = (board && board.cursor) || {}
  const bounds = (board && board.bounds) || { allowed: [], forbidden: [], notes: [] }
  const pinnedBounds = (board && board.pinnedBounds) || { allowed: [], forbidden: [], notes: [] }
  const workers = ((directory && directory.targets) || []).filter(t => t.kind === 'subagent')
  const runningWorkers = workers.filter(w => w.status === 'running')
  const liveEntries = (liveDigest && liveDigest.entries) || []
  const leadLive = liveEntries.find(e => e.kind === 'lead') || liveEntries[0] || null
  const cleanMem = (Array.isArray(board && board.memory) ? board.memory : [])
    .filter(m => m && !isInternalCheckpointNoise(m.title || m.text))

  if (conciseBrief) {
    return buildConciseSixLineReport({ board, blocked, doing, todo, done, workers })
  }

  const asksBounds = /边界|红线|禁止|允许|必做|规矩|约束/.test(q)
  const asksTeam = /子代理|团队|谁在|分工|成员|subagent|worker/i.test(qLower)
  const asksBlocked = /卡在哪|受阻|阻塞|报错|问题|风险|撞墙|block/i.test(qLower)
  const asksProgress = /进展|进度|怎么样|到哪|在做什么|在干嘛|干什么|处于什么步骤|什么步骤|第几步|情况|状态|汇报|总结|下一步|status|progress/i.test(qLower)

  const bullets = []

  if (asksBounds) {
    const fList = bounds.forbidden || []
    const aList = bounds.allowed || []
    const nList = bounds.notes || []
    const pinCount = (pinnedBounds.forbidden?.length || 0) + (pinnedBounds.allowed?.length || 0) + (pinnedBounds.notes?.length || 0)
    bullets.push(`- 【生效边界概览】共 ${fList.length + aList.length + nList.length} 条生效（其中 📌 定住全局共享 ${pinCount} 条）。`)
    if (fList.length) bullets.push(`- 【禁止红线】${fList.slice(0, 5).map(x => (pinnedBounds.forbidden?.includes(x) ? '📌' : '') + clamp(x, 60)).join('；')}`)
    if (aList.length) bullets.push(`- 【必做事项】${aList.slice(0, 4).map(x => (pinnedBounds.allowed?.includes(x) ? '📌' : '') + clamp(x, 60)).join('；')}`)
    if (nList.length) bullets.push(`- 【注意事项】${nList.slice(0, 3).map(x => (pinnedBounds.notes?.includes(x) ? '📌' : '') + clamp(x, 60)).join('；')}`)
    if (!fList.length && !aList.length && !nList.length) {
      bullets.push('- 【提示】当前尚未配置边界规则，可在「边界」页添加并点击 📌 定住为跨任务共享，或点「✦ 提炼新边界」。')
    }
    return bullets.join('\n')
  }

  if (asksTeam && !asksProgress) {
    bullets.push(`- 【团队编制】${workers.length ? summarizeSubagentsCompact(workers) : '当前仅主代理（@lead）单线作业，尚未派生子代理。'}`)
    for (const w of runningWorkers.slice(0, 5)) {
      bullets.push(`- 【运行中 · @${shortAgentBriefName(w.handle)}】${w.taskTitle ? clamp(w.taskTitle, 80) : '正在执行委派任务'}`)
    }
    for (const e of liveEntries.filter(x => x.kind !== 'lead').slice(0, 3)) {
      if (e.lastAssistant || e.recentTools.length) {
        bullets.push(`- 【@${shortAgentBriefName(e.handle)} 现场】${e.recentTools.length ? '调用 ' + e.recentTools.join(' → ') + '；' : ''}${clamp(e.lastAssistant, 100)}`)
      }
    }
    return bullets.join('\n')
  }

  // Keyword match across tasks, facts, notes, live stream, and memory if user asked a specific domain question
  if (!asksProgress && !asksBlocked) {
    const tokens = qLower
      .replace(/[？?！!。，,、：:“”"'()（）[\]【】]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 2 && !/^(现在|目前|什么|怎么|请问|帮我|一下|看看|告诉)$/.test(t))

    const hits = []
    for (const t of tasks) {
      const hay = `${t.title} ${t.note || ''} ${t.evidence || ''}`.toLowerCase()
      if (tokens.some(tk => hay.includes(tk))) {
        hits.push(`- 【任务 #${t.id} · ${t.status}】${clamp(t.title, 65)}${t.evidence ? '（证据：' + clamp(t.evidence, 70) + '）' : t.note ? '（' + clamp(t.note, 70) + '）' : ''}`)
      }
    }
    for (const f of facts) {
      if (tokens.some(tk => String(f.text || '').toLowerCase().includes(tk))) {
        hits.push(`- 【持久记录】${clamp(f.text, 120)}`)
      }
    }
    for (const m of cleanMem.slice(-15)) {
      const txt = stripCheckpointNoise(m.title || m.text)
      if (tokens.some(tk => txt.toLowerCase().includes(tk))) {
        hits.push(`- 【近期回合】${clamp(txt, 120)}`)
      }
    }
    if (hits.length > 0) {
      return hits.slice(0, 6).join('\n')
    }
  }

  // Comprehensive Live Situation & Progress Briefing (default + asksProgress + asksBlocked)
  if (board && board.objective) {
    bullets.push(`- 【核心目标】${clamp(board.objective, 130)}`)
  }
  if (cursor.step || cursor.next || cursor.blocked) {
    const curParts = []
    if (cursor.step) curParts.push(`正在推进「${clamp(cursor.step, 70)}」`)
    if (cursor.blocked) curParts.push(`卡点：${clamp(cursor.blocked, 80)}`)
    if (cursor.next) curParts.push(`下一步：${clamp(cursor.next, 80)}`)
    bullets.push(`- 【实时断点】${curParts.join('；')}`)
  }
  if (planSteps.length > 0) {
    bullets.push(`- 【小任务板 (${donePlan.length}/${planSteps.length})】${openPlan.length ? '当前待推进：' + clamp(openPlan[0].text, 90) : '全部步骤已勾选完成'}${donePlan.length ? '（最近已完成：' + clamp(donePlan[donePlan.length - 1].text, 55) + '）' : ''}`)
  }
  if (tasks.length > 0) {
    bullets.push(`- 【任务盘点】共 ${tasks.length} 项：🟢推进中 ${doing.length} · 🔴受阻 ${blocked.length} · ⏳待办 ${todo.length} · ✅已完成 ${done.length}`)
    for (const b of blocked.slice(0, 3)) {
      bullets.push(`- 【🔴 受阻卡点】#${b.id} ${clamp(b.title, 64)}${b.note ? ' — ' + clamp(b.note, 85) : ''}`)
    }
    for (const d of doing.slice(0, 3)) {
      const ownerTag = d.subagent || d.owner ? `（@${shortAgentBriefName(d.subagent || d.owner)}）` : ''
      bullets.push(`- 【🟢 正在推进】#${d.id} ${clamp(d.title, 68)}${ownerTag}${d.note ? '：' + clamp(d.note, 65) : ''}`)
    }
    if (!doing.length && !blocked.length && done.length > 0) {
      const lastDone = done[done.length - 1]
      bullets.push(`- 【最近完工】#${lastDone.id} ${clamp(lastDone.title, 68)}${lastDone.evidence ? '（' + clamp(lastDone.evidence, 80) + '）' : ''}`)
    }
  }
  if (runningWorkers.length > 0) {
    bullets.push(`- 【活跃子代理】${runningWorkers.length} 名正在运行：${runningWorkers.slice(0, 4).map(w => '@' + shortAgentBriefName(w.handle) + (w.taskTitle ? '（' + clamp(w.taskTitle, 32) + '）' : '')).join('、')}`)
  }
  if (leadLive && (leadLive.lastAssistant || leadLive.recentTools.length || leadLive.lastUser)) {
    const toolStr = leadLive.recentTools.length ? `刚执行 ${leadLive.recentTools.slice(-3).join(' → ')}；` : ''
    const msgStr = leadLive.lastAssistant
      ? clamp(leadLive.lastAssistant, 140)
      : (leadLive.lastUser ? `收到指令「${clamp(leadLive.lastUser, 90)}」` : '')
    bullets.push(`- 【主对话现场 (${leadLive.status === 'running' ? '运行中' : '就绪'})】${toolStr}${msgStr}`)
  } else if (cleanMem.length > 0) {
    const latest = stripCheckpointNoise(cleanMem[cleanMem.length - 1].title || cleanMem[cleanMem.length - 1].text)
    if (latest) bullets.push(`- 【最新回合结论】${clamp(latest, 140)}`)
  }
  if (mailbox.length > 0) {
    const lastMail = mailbox[mailbox.length - 1]
    if (lastMail && lastMail.text) {
      bullets.push(`- 【最新协同通信】${lastMail.from || '成员'} → @${lastMail.to || 'lead'}：${clamp(lastMail.text, 90)}`)
    }
  }

  // Tactical next-step suggestion
  if (blocked.length > 0) {
    bullets.push(`- 【参谋建议】当前有 ${blocked.length} 项任务受阻，建议优先排障 #${blocked[0].id}，或让我直接向主代理/对应子代理插话调整方案。`)
  } else if (doing.length > 0 || runningWorkers.length > 0) {
    bullets.push('- 【参谋建议】主线正在推进中；如需纠偏方向或补充约束，可直接告诉我「让 @某成员 注意……」，我立即替你插话传达。')
  } else if (openPlan.length > 0) {
    bullets.push(`- 【参谋建议】小任务板下一待办步骤为「${clamp(openPlan[0].text, 55)}」，可直接确认执行或让我转告主对话继续。`)
  } else if (todo.length > 0) {
    bullets.push(`- 【参谋建议】当前无运行中代理，尚有 ${todo.length} 项待办（首项：#${todo[0].id} ${clamp(todo[0].title, 40)}），可吩咐主对话继续推进。`)
  } else if (!bullets.length) {
    bullets.push('- 【当前态势】本会话尚未开始任务或记录目标；你可以直接在主对话下达任务，或在下方让我替你立目标、定边界、派分工。')
  }

  return bullets.join('\n')
}

function deterministicConsolidateClauses(items) {
  const seen = new Set()
  const clauses = []
  for (const raw of items) {
    const parts = String(raw || '')
      .split(/[；;。\n]+/)
      .map(s => s.replace(/^[•·\-*\d.)\s📌]+/, '').trim())
      .filter(Boolean)
    for (const p of parts) {
      const norm = p.toLowerCase().replace(/\s+/g, '')
      if (!norm || seen.has(norm)) continue
      if ([...seen].some(existing => existing.includes(norm) || (norm.length > 6 && norm.includes(existing)))) {
        if (norm.length > 6) {
          for (const ex of [...seen]) {
            if (norm.includes(ex) && norm !== ex) {
              const idx = clauses.findIndex(c => c.toLowerCase().replace(/\s+/g, '') === ex)
              if (idx !== -1) {
                clauses[idx] = p
                seen.delete(ex)
                seen.add(norm)
              }
            }
          }
        }
        continue
      }
      seen.add(norm)
      clauses.push(p)
    }
  }
  return clamp(clauses.join('；'), 220)
}

/**
 * Consolidate multiple scattered/overlapping boundary rules into ONE concise master rule,
 * creating a pending Prime Minister approval card (`replaces: sourceItems`) so the user
 * can approve & optionally pin it globally (`📌 定住全局`).
 */
export async function consolidateBoundsWithChief(deps, {
  sessionId = '',
  field = '',
  items = [],
  instruction = '',
} = {}) {
  const rootId = (deps.resolveRootSessionId && deps.resolveRootSessionId(sessionId)) || String(sessionId || 'global')
  const board = deps.boardForSession && deps.boardFileFor
    ? deps.boardForSession(deps.boardFileFor(rootId))
    : { bounds: { allowed: [], forbidden: [], notes: [] }, pinnedBounds: { allowed: [], forbidden: [], notes: [] } }
  const bounds = (board && board.bounds) || { allowed: [], forbidden: [], notes: [] }
  const pinnedBounds = (board && board.pinnedBounds) || { allowed: [], forbidden: [], notes: [] }
  const BOUND_COL_LABEL = { forbidden: '禁止红线', allowed: '必做事项', notes: '注意事项' }

  // Determine which column(s) to consolidate
  const targetCols = []
  const explicitItems = Array.isArray(items)
    ? items.map(x => String(x || '').trim()).filter(Boolean)
    : []

  const normField = String(field || '').trim().toLowerCase() === 'must' ? 'allowed' : field
  if (['forbidden', 'allowed', 'notes'].includes(normField)) {
    const colList = Array.isArray(bounds[normField]) ? bounds[normField] : []
    const chosen = explicitItems.length >= 2
      ? colList.filter(x => explicitItems.includes(x))
      : colList
    if (chosen.length < 2) {
      return { ok: false, error: `【${BOUND_COL_LABEL[normField]}】当前不足 2 条规则，无需浓缩合并。` }
    }
    targetCols.push({ col: normField, sourceItems: chosen })
  } else if (explicitItems.length >= 2) {
    // Infer column with most matches, default forbidden
    let bestCol = 'forbidden'
    let bestHits = -1
    for (const c of ['forbidden', 'allowed', 'notes']) {
      const hits = (bounds[c] || []).filter(x => explicitItems.includes(x)).length
      if (hits > bestHits) {
        bestHits = hits
        bestCol = c
      }
    }
    targetCols.push({ col: bestCol, sourceItems: explicitItems })
  } else {
    for (const c of ['forbidden', 'allowed', 'notes']) {
      const colList = Array.isArray(bounds[c]) ? bounds[c] : []
      if (colList.length >= 2) {
        targetCols.push({ col: c, sourceItems: colList })
      }
    }
    if (!targetCols.length) {
      return { ok: false, error: '当前各边界分栏均不足 2 条零散规则，暂时无需合并。' }
    }
  }

  const createdProposals = []
  for (const { col, sourceItems } of targetCols) {
    const colLabel = BOUND_COL_LABEL[col] || '禁止红线'
    const hadPinned = sourceItems.some(x => (pinnedBounds[col] || []).includes(x))
    const prompt = [
      `目标边界分栏：【${colLabel}】（${col}）`,
      instruction ? `用户额外要求：${clamp(instruction, 200)}` : '',
      `待浓缩合并的 ${sourceItems.length} 条零散边界：`,
      ...sourceItems.map((it, idx) => `${idx + 1}. ${(pinnedBounds[col] || []).includes(it) ? '[📌全局定住] ' : ''}${it}`),
      '',
      '请将以上零散规则浓缩合并为唯一 1 条高密度总则（保留具体命令、路径与硬红线），只输出 JSON：',
    ].filter(Boolean).join('\n')

    const llmRes = await callChiefLlm(deps, {
      sessionId: rootId,
      system: CONSOLIDATE_BOUNDS_SYSTEM,
      prompt,
      maxTokens: SUMMARY_MAX_TOKENS,
    })

    const parsed = llmRes.ok ? extractJsonObject(llmRes.text) : null
    const mergedText = clamp(
      (parsed && (parsed.item || parsed.draftText || parsed.text)) || deterministicConsolidateClauses(sourceItems),
      220,
    )
    const mergedReason = clamp(
      (parsed && parsed.reason) || `已将【${colLabel}】下 ${sourceItems.length} 条零散边界浓缩合成为 1 条总则，批准后自动替换原零散条目。`,
      180,
    )

    if (!mergedText || secretLike(mergedText)) continue

    mutateChiefState((s) => {
      const ws = ensureWorkspace(s, rootId)
      // Dismiss older pending consolidation proposals for the exact same column to avoid clutter
      for (const existing of ws.suggestions) {
        if (existing.status === 'pending' && existing.kind === 'bound' && existing.boundField === col && Array.isArray(existing.replaces) && existing.replaces.length > 0) {
          existing.status = 'dismissed'
        }
      }
      const sug = normalizeSuggestion({
        kind: 'bound',
        boundField: col,
        fromAgent: '✦ 参谋长浓缩',
        title: `${colLabel} ${sourceItems.length} 合 1：${clamp(mergedText, 26)}`,
        reason: mergedReason,
        target: 'bounds',
        targetLabel: colLabel,
        mode: 'silent',
        draftText: mergedText,
        replaces: sourceItems,
        pinGlobal: hadPinned,
      })
      if (sug) {
        ws.suggestions.push(sug)
        createdProposals.push(sug)
      }
    })
  }

  if (!createdProposals.length) {
    return { ok: false, error: '未能生成浓缩边界，请稍后重试。' }
  }

  const replyLines = createdProposals.map(p =>
    `- 【${p.targetLabel} · ${p.replaces.length} 合 1】${p.draftText}（可在上方请示卡片选「📌 定住全局」或「仅本任务」一键替换）`,
  )

  return {
    ok: true,
    proposals: createdProposals,
    reply: replyLines.join('\n'),
    view: await getChiefView(deps, rootId, { autoSummarize: false }),
  }
}

const ORGANIZE_ARCHIVES_SYSTEM = [
  '你是「DSH 参谋长」的工程档案馆馆长。请把杂乱的工程笔记按「档案柜文件夹抽屉 → 曲别针卷宗 → 分条记忆点 → 小点记忆」结构化整理收纳。',
  '',
  '【核心铁律】',
  '1. 默认标准抽屉 ID（优先归入这 5 个抽屉；仅当用户指令明确要求新建分类时才在 newFolders 中定义新抽屉）：',
  '   - "coords"    : 工程坐标与部署锚点（源码路径、端口、热更口令、验证脚本命令）',
  '   - "incidents" : 排障实录与硬事实（症状→根因→修复、踩坑实录、线上/本地故障）',
  '   - "contracts" : 架构契约与方法论（写入/截断/类型宽容契约、自检断言、设计规范）',
  '   - "ops"       : 运维链路与机器环境（本机环境硬事实、服务器/代理/容器链路、运维手册）',
  '   - "plans"     : 阶段蓝图与归档计划（能力对照表、历史阶段计划存档、交接里程碑）',
  '2. 曲别针等级 (`paperclip`)：',
  '   - "gold"   : 跨会话最核心必查锚点（如工程坐标、核心红线实录）',
  '   - "silver" : 标准已验证工程经验/契约/排障记录',
  '   - "copper" : 阶段性历史存档/旧计划备查',
  '3. 分条分块记忆点 (`points`)：',
  '   - 每份卷宗提炼 2～6 个结构清晰的「记忆点」，禁止把整篇堆成 1 大坨！',
  '   - 每个记忆点必须包含：',
  '     * `title` : 记忆点短标题（≤24字，点明这一条讲什么，如「症状表现」「根因与服务注入契约」「部署态验证命令」）',
  '     * `cue`   : 一句话速览钩子（≤48字，未展开时就能扫一眼看懂结论）',
  '     * `detail`: 点击展开的「小点记忆」（**必须无损保留**原文中的具体命令、文件路径、行号、参数名、错误码与核心判据，严禁编造原文没有的事实！）',
  '4. **只输出一个合法 JSON 对象**，格式如下：',
  '{',
  '  "newFolders": [',
  '    { "id": "custom-key", "label": "新抽屉名称", "hint": "简短说明" }',
  '  ],',
  '  "items": [',
  '    {',
  '      "id": "原样回填输入的档案 id",',
  '      "folder": "coords|incidents|contracts|ops|plans 或自定义 id",',
  '      "paperclip": "gold|silver|copper",',
  '      "summary": "一句话卷宗总提要（≤52字）",',
  '      "tags": ["精炼标签1", "精炼标签2"],',
  '      "points": [',
  '        { "title": "记忆点标题", "cue": "速览钩子", "detail": "展开后的详细小点记忆（保留命令与路径）" }',
  '      ]',
  '    }',
  '  ]',
  '}',
].join('\n')

/**
 * Organize & structure engineering archives via DSH Chief LLM (`请参谋长整理收纳`).
 * Classifies dossiers into filing-cabinet folders, assigns gold/silver/copper paperclips,
 * and breaks walls of text into crisp `points: [{ title, cue, detail }]` while 100% preserving raw `body`!
 */
export async function organizeArchivesWithChief(deps, {
  sessionId = '',
  vaultScope = 'session',
  cabinetId = '',
  ids = [],
  folder = '',
  scope = 'unorganized',
  instruction = '',
} = {}) {
  const rootId = (deps.resolveRootSessionId && deps.resolveRootSessionId(sessionId)) || String(sessionId || 'global')
  const effScope = vaultScope === 'global' ? 'global' : 'session'
  if (effScope === 'session' && (!rootId || rootId === 'global')) {
    return {
      ok: false,
      error: '当前为空白新对话，尚未建立本会话档案柜；如需整理全局知识请切至「🌐 全局档案柜」',
    }
  }
  const targetOpt = archiveTargetForRoot(deps, rootId, { cabinetId, vaultScope: effScope })
  const store = loadArchiveStore(targetOpt)

  if (!store.items.length) {
    return {
      ok: false,
      error: '当前「档案」柜中暂无可整理的工程卷宗，可先新建卷宗或将便签沉淀入柜。',
    }
  }

  const explicitIds = Array.isArray(ids) ? ids.map(x => String(x || '').trim()).filter(Boolean) : []
  let candidates = []
  if (explicitIds.length > 0) {
    const idSet = new Set(explicitIds)
    candidates = store.items.filter(it => idSet.has(it.id))
  } else if (folder) {
    candidates = store.items.filter(it => it.folder === folder)
  } else if (scope === 'all') {
    candidates = store.items.slice()
  } else {
    // Prefer unorganized / inbox / single-point items first; if all were already organized, take newest batch
    const unorg = store.items.filter(it => it.folder === 'inbox' || it.organizedBy !== 'chief' || (it.points || []).length <= 1)
    candidates = unorg.length > 0 ? unorg : store.items.slice(0, 8)
  }

  if (!candidates.length) {
    return { ok: false, error: '未找到符合筛选范围的工程档案。' }
  }

  const BATCH_SIZE = 5
  const MAX_ITEMS_PER_RUN = explicitIds.length > 0 ? Math.min(explicitIds.length, 15) : 10
  const selected = candidates.slice(0, MAX_ITEMS_PER_RUN)
  const remainingCount = Math.max(0, candidates.length - selected.length)

  const folderLines = store.folders.map(f => `- "${f.id}": ${f.label}（${f.hint || ''}）`)
  const allCurations = []
  const allNewFolders = []
  let usedLlm = false

  for (let offset = 0; offset < selected.length; offset += BATCH_SIZE) {
    const batch = selected.slice(offset, offset + BATCH_SIZE)
    const promptParts = [
      '现有档案柜文件夹抽屉：',
      ...folderLines,
      instruction ? `\n用户收纳叮嘱：${clamp(instruction, 240)}` : '',
      `\n待整理收纳的 ${batch.length} 份工程卷宗：`,
    ]
    batch.forEach((item, idx) => {
      promptParts.push(
        `\n--- 卷宗 #${idx + 1} ---`,
        `id: ${item.id}`,
        `标题: ${item.title}`,
        `当前抽屉: ${item.folder} | 当前曲别针: ${item.paperclip} | 原标签: ${(item.tags || []).join(', ') || '无'}`,
        `原始正文:\n${cleanMultiline(item.body || item.summary || item.title, 2600)}`,
      )
    })

    const llmRes = await callChiefLlm(deps, {
      sessionId: rootId,
      system: ORGANIZE_ARCHIVES_SYSTEM,
      prompt: promptParts.filter(Boolean).join('\n'),
      maxTokens: SUMMARY_MAX_TOKENS,
    })

    const parsed = llmRes.ok ? extractJsonObject(llmRes.text) : null
    if (parsed && Array.isArray(parsed.items) && parsed.items.length > 0) {
      usedLlm = true
      if (Array.isArray(parsed.newFolders)) {
        for (const nf of parsed.newFolders) allNewFolders.push(nf)
      }
      const byId = new Map(parsed.items.filter(x => x && x.id).map(x => [String(x.id).trim(), x]))
      for (const orig of batch) {
        const cur = byId.get(orig.id)
        if (cur) {
          allCurations.push(cur)
        } else {
          const fb = smartParseNoteToDossier(orig)
          allCurations.push({
            id: orig.id,
            folder: fb.folder,
            paperclip: fb.paperclip,
            summary: fb.summary,
            tags: orig.tags,
            points: fb.points,
          })
        }
      }
    } else {
      // Deterministic high-precision fallback when LLM is offline or returned non-JSON
      for (const orig of batch) {
        const fb = smartParseNoteToDossier(orig)
        allCurations.push({
          id: orig.id,
          folder: orig.folder === 'inbox' ? fb.folder : (orig.folder || fb.folder),
          paperclip: fb.paperclip,
          summary: fb.summary,
          tags: orig.tags,
          points: fb.points,
        })
      }
    }
  }

  const applied = applyChiefArchiveCurations(allCurations, allNewFolders, targetOpt)
  const refreshedList = listArchiveHeaders(rootId, { includePrecipitated: false }, targetOpt)
  const folderNameMap = new Map(refreshedList.folders.map(f => [f.id, f.label]))

  const folderStats = new Map()
  for (const c of allCurations) {
    const fName = folderNameMap.get(c.folder) || c.folder
    folderStats.set(fName, (folderStats.get(fName) || 0) + 1)
  }
  const statSummary = [...folderStats.entries()].map(([k, n]) => `「${k}」${n} 卷`).join('、')
  const reply = `- 【档案收纳完成】已${usedLlm ? '由参谋长模型深度提炼' : '按结构规则分拣'} **${applied.updatedCount} 份**工程卷宗（归入 ${statSummary}），每份均已拆解「记忆点 → 小点记忆」，原文 100% 无损封存。`
    + (remainingCount > 0 ? `\n- 【分批提示】柜内另有 ${remainingCount} 份卷宗待精修，可再点一次「请参谋长整理收纳」继续完成剩余部分。` : '')

  mutateChiefState((s) => {
    const ws = ensureWorkspace(s, rootId)
    ws.chat.push(
      {
        id: nextId('chat'),
        role: 'user',
        text: instruction ? `整理工程档案：${instruction}` : `请参谋长整理收纳工程档案（${applied.updatedCount} 卷）`,
        actions: [],
        at: Date.now(),
      },
      {
        id: nextId('chat'),
        role: 'chief',
        text: reply,
        actions: [`已收纳 ${applied.updatedCount} 卷档案`],
        at: Date.now(),
      },
    )
    if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
  })

  if (typeof deps.appendBoardLog === 'function' && rootId !== 'global') {
    deps.appendBoardLog(rootId, `🗄️ 参谋长完成工程档案收纳：共精修 ${applied.updatedCount} 卷（${statSummary}）`, 'chief')
  }

  return {
    ok: true,
    updatedCount: applied.updatedCount,
    remainingCount,
    usedLlm,
    reply,
    archives: refreshedList,
    view: await getChiefView(deps, rootId, { autoSummarize: false }),
  }
}

const HARVEST_ARCHIVE_SYSTEM = [
  '你是「DSH 参谋长」的高精度上下文抢救员。当前即将执行上下文压缩或用户主动抢救本轮现场细节，请从原始对话与看板轨迹中无损抢救工程硬细节并归档！',
  '要求：',
  '1. 重点抓取：**具体文件路径、行号、真实命令/脚本参数、刚确认的报错根因与结论、尚未完成的断点、未解决的阻塞细节**，严禁泛泛而谈或丢弃关键参数。',
  '2. 绝对不要编造原文未出现的文件名或命令。',
  '3. 只输出一个合法 JSON 对象：',
  '{',
  '  "folder": "coords|incidents|contracts|ops|plans",',
  '  "paperclip": "gold|silver|copper",',
  '  "title": "精炼明确归档标题（≤38字）",',
  '  "summary": "一句话总结核心工程事实（≤56字）",',
  '  "tags": ["标签1", "标签2"],',
  '  "points": [',
  '    { "title": "记忆点短标题", "cue": "速览钩子", "detail": "含原文件路径/命令/结论的高保真明细" }',
  '  ]',
  '}',
].join('\n')

function collectRawSessionEvidence(deps, { sessionId = '', rootId = '', agent = null }) {
  const board = deps && deps.boardForSession && deps.boardFileFor
    ? deps.boardForSession(deps.boardFileFor(rootId))
    : null
  const lines = []
  if (board && board.objective) lines.push(`【当前总目标】${board.objective}`)
  if (board && board.cursor && (board.cursor.step || board.cursor.next || board.cursor.blocked)) {
    lines.push(`【断点游标】当前=${board.cursor.step || '无'} | 下一步=${board.cursor.next || '无'} | 阻塞=${board.cursor.blocked || '无'}`)
  }
  const tasks = Array.isArray(board && board.tasks) ? board.tasks : []
  const openTasks = tasks.filter(t => t.status !== 'done').slice(0, 6)
  if (openTasks.length > 0) {
    lines.push('【进行中/未完任务】')
    for (const t of openTasks) {
      lines.push(`- [${t.status}] #${t.id} ${t.title}${t.note ? `（${clamp(t.note, 100)}）` : ''}`)
    }
  }

  let targetAgent = agent
  if (!targetAgent && deps && deps.runtime) {
    try {
      const agentsSvc = deps.runtime.get('agents')
      if (agentsSvc && typeof agentsSvc.get === 'function') {
        targetAgent = agentsSvc.get(sessionId) || agentsSvc.get(rootId)
      }
    } catch {}
  }

  const pathsFound = new Set()
  const cmdsFound = new Set()
  const rawTurns = []
  try {
    if (targetAgent && targetAgent.session && typeof targetAgent.session.deriveMessages === 'function') {
      const msgs = targetAgent.session.deriveMessages() || []
      for (const m of msgs.slice(-14)) {
        if (!m || !m.role) continue
        if (m.source && m.source.kind && m.source.kind !== 'user' && m.role === 'user') continue
        const blocks = Array.isArray(m.content)
          ? m.content
          : (typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : [])
        for (const b of blocks) {
          if (!b || typeof b !== 'object') continue
          if (b.type === 'text' && typeof b.text === 'string') {
            const clean = stripCheckpointNoise(b.text)
            if (!clean || isInternalCheckpointNoise(clean) || secretLike(clean)) continue
            rawTurns.push(`${m.role === 'user' ? 'User' : 'Assistant'}: ${clamp(clean, 500)}`)
            const pathMatches = clean.match(/(?:[A-Za-z]:)?(?:[\\/][^\s'"`<>|]{2,70})+/g) || []
            for (const p of pathMatches.slice(0, 8)) pathsFound.add(p)
          } else if ((b.type === 'tool_use' || b.type === 'tool-call' || b.type === 'toolCall') && (b.name || b.toolName)) {
            const name = String(b.name || b.toolName)
            const rawArgs = b.input || b.arguments || b.args
            let obj = null
            try { obj = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs } catch {}
            const cmd = obj && (obj.command || obj.cmd || obj.CommandLine)
            const fpath = obj && (obj.path || obj.file_path || obj.Path)
            if (fpath && !secretLike(String(fpath))) pathsFound.add(String(fpath))
            if (cmd && !secretLike(String(cmd))) cmdsFound.add(clamp(String(cmd), 140))
            rawTurns.push(`Tool[${name}]: ${clamp(JSON.stringify(obj || {}), 220)}`)
          }
        }
      }
    }
  } catch {}

  if (pathsFound.size > 0) lines.push('', '【涉及路径与符号】\n' + [...pathsFound].slice(0, 12).map(p => `- ${p}`).join('\n'))
  if (cmdsFound.size > 0) lines.push('', '【近期执行命令】\n' + [...cmdsFound].slice(0, 8).map(c => `- \`${c}\``).join('\n'))
  if (rawTurns.length > 0) lines.push('', '【近期对话与工具流水】\n' + rawTurns.slice(-10).join('\n'))
  return {
    board,
    text: lines.join('\n').trim(),
    hasTranscript: rawTurns.length > 0,
    pathCount: pathsFound.size,
    cmdCount: cmdsFound.size,
  }
}

/** High-precision harvest of recent session details into active working archive cabinet (`pre-compaction` or `manual`). */
export async function harvestTurnDetailsToArchive(deps, {
  sessionId = '',
  agent = null,
  trigger = 'manual',
  focusHint = '',
  cabinetId = '',
  vaultScope = 'session',
} = {}) {
  const rootId = (deps && deps.resolveRootSessionId && deps.resolveRootSessionId(sessionId, agent)) || String(sessionId || 'global')
  const effScope = vaultScope === 'global' ? 'global' : 'session'
  if (effScope === 'session' && (!rootId || rootId === 'global')) {
    return { ok: false, error: '当前为空白新对话（未绑定会话 ID），请先发送一条消息或切至「🌐 全局档案柜」再抢救归档' }
  }
  const targetOpt = archiveTargetForRoot(deps, rootId, { cabinetId, vaultScope: effScope })
  const evidence = collectRawSessionEvidence(deps, { sessionId: sessionId || rootId, rootId, agent })
  const bodySource = [
    focusHint ? `【抢救焦点提示】${cleanMultiline(focusHint, 240)}` : '',
    evidence.text || `【抢救快照】时间 ${new Date().toLocaleString('zh-CN')} | 触发原因：${trigger}`,
  ].filter(Boolean).join('\n\n')

  let parsed = null
  let usedLlm = false
  try {
    const llmRes = await callChiefLlm(deps, {
      sessionId: rootId,
      system: HARVEST_ARCHIVE_SYSTEM,
      prompt: `触发模式：${trigger === 'pre-compaction' ? '上下文压缩前自动高保真抢救' : '用户手动抢救当前工作细节入柜'}\n\n${cleanMultiline(bodySource, 5200)}`,
      maxTokens: SUMMARY_MAX_TOKENS,
    })
    if (llmRes && llmRes.ok && llmRes.text) {
      parsed = extractJsonObject(llmRes.text)
      if (parsed && (parsed.title || (Array.isArray(parsed.points) && parsed.points.length > 0))) {
        usedLlm = true
      }
    }
  } catch {}

  const fallback = smartParseNoteToDossier({
    title: `${trigger === 'pre-compaction' ? '【压缩前抢救】' : '【细节抢救】'}${clamp(focusHint || (evidence.board && evidence.board.objective) || '本轮工作现场细节', 28)}`,
    body: bodySource,
  })
  const d = new Date()
  const timeStamp = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const title = clamp((parsed && parsed.title) || `${fallback.title || '工作细节抢救'} (${timeStamp})`, 70)
  const folder = String((parsed && parsed.folder) || fallback.folder || 'incidents').trim()
  const paperclip = ['gold', 'silver', 'copper'].includes(parsed && parsed.paperclip)
    ? parsed.paperclip
    : (trigger === 'pre-compaction' ? 'gold' : fallback.paperclip)
  const summary = clamp((parsed && parsed.summary) || fallback.summary || clamp(bodySource, 110), 180)
  const tags = Array.isArray(parsed && parsed.tags) && parsed.tags.length > 0
    ? parsed.tags.slice(0, 6)
    : [trigger === 'pre-compaction' ? '压缩抢救' : '细节抢救', ...(evidence.cmdCount > 0 ? ['命令流水'] : [])]
  const points = Array.isArray(parsed && parsed.points) && parsed.points.length > 0
    ? parsed.points
    : fallback.points

  const saveRes = mutateArchive({
    op: 'save',
    session: rootId,
    folder,
    paperclip,
    title,
    summary,
    tags,
    points,
    body: bodySource,
  }, targetOpt)

  if (!saveRes || !saveRes.ok || !saveRes.item || !saveRes.item.id) {
    return { ok: false, error: (saveRes && saveRes.error) || '工作档案写入失败，未执行后续操作' }
  }

  // Strictly verify persistence on disk before returning ok!
  const verify = getArchiveDetail(saveRes.item.id, rootId, targetOpt)
  if (!verify || !verify.ok || !verify.item || verify.item.id !== saveRes.item.id) {
    return { ok: false, error: '档案硬盘落盘复核失败' }
  }

  if (deps && typeof deps.appendBoardLog === 'function' && rootId !== 'global') {
    deps.appendBoardLog(rootId, `📥 已将本轮工程细节抢救入柜：《${title}》（trigger=${trigger}）`, 'chief')
  }

  return {
    ok: true,
    trigger,
    usedLlm,
    savedId: saveRes.item.id,
    item: verify.item,
    cabinetId: targetOpt.cabinetId || verify.cabinetId || '',
    archives: listArchiveHeaders(rootId, { includePrecipitated: trigger === 'manual' }, targetOpt),
  }
}

const PRECIPITATE_EXPERIENCE_SYSTEM = [
  '你是「DSH 参谋长」的知识沉淀总编。请把当前工作档案柜（或指定抽屉）的多份工作卷宗脱水提炼为 1~3 条**跨会话长期可复用**的高密度经验胶囊，准备封存入 0-Token 冷库！',
  '原则：',
  '1. **去水保干**：彻底剔除单轮聊天客套话、过时中间试错步骤与一次性状态；只保留长期有价值的【工程架构契约 / 踩坑根因与解法 / 核心文件路径与校验命令】。',
  '2. 保留真实文件名、函数名、配置键、关键命令，绝不编造不存在的细节。',
  '3. 只输出一个合法 JSON 对象：',
  '{',
  '  "entries": [',
  '    {',
  '      "title": "沉淀经验短标题（≤36字）",',
  '      "category": "coords|incidents|contracts|ops",',
  '      "summary": "一句话价值摘要（≤60字）",',
  '      "tags": ["标签1", "标签2"],',
  '      "points": [',
  '        { "title": "要点标题", "cue": "一句话钩子", "detail": "完整可复用步骤/路径/契约" }',
  '      ],',
  '      "body": "完整精炼正文"',
  '    }',
  '  ]',
  '}',
].join('\n')

/** Purify working archive items into reusable long-term entries saved to `precipitated/vault-global.json`. */
export async function precipitateExperienceWithChief(deps, {
  sessionId = '',
  vaultScope = 'global',
  op = 'cabinet',
  cabinetId = '',
  folder = '',
  ids = [],
  clearSource = false,
} = {}) {
  if (vaultScope !== 'global') {
    return {
      ok: false,
      error: '实行三层档案梯度制度：本会话档案不可直接沉淀入冷库！请先点击「🌐 升级入全局」进入全局档案柜，再从全局档案柜沉淀可复用冷经验。',
    }
  }
  const rootId = (deps && deps.resolveRootSessionId && deps.resolveRootSessionId(sessionId)) || String(sessionId || 'global')
  const effScope = 'global'
  const targetOpt = archiveTargetForRoot(deps, rootId, { cabinetId, vaultScope: effScope })
  const store = loadArchiveStore(targetOpt)
  const projectKey = resolveProjectKey(targetOpt.cwd)

  const idSet = Array.isArray(ids) && ids.length > 0
    ? new Set(ids.map(x => String(x || '').trim()).filter(Boolean))
    : null
  const selectedItems = idSet
    ? store.items.filter(it => idSet.has(String(it.id)))
    : ((op === 'drawer' && folder) ? store.items.filter(it => it.folder === folder) : store.items.slice())

  if (!selectedItems.length) {
    return { ok: false, error: '当前选定范围暂无工作档案可沉淀' }
  }

  const promptBody = selectedItems.slice(0, 12).map((it, idx) => [
    `--- 工作档案 #${idx + 1}: 《${it.title}》 (drawer=${it.folder}, clip=${it.paperclip}) ---`,
    `提要: ${it.summary || '无'}`,
    Array.isArray(it.points) && it.points.length > 0
      ? '记忆点:\n' + it.points.map(p => `- ${p.title}: ${p.detail || p.cue}`).join('\n')
      : `正文:\n${cleanMultiline(it.body, 1500)}`,
  ].join('\n')).join('\n\n')

  let entriesRaw = null
  let usedLlm = false
  try {
    const llmRes = await callChiefLlm(deps, {
      sessionId: rootId,
      system: PRECIPITATE_EXPERIENCE_SYSTEM,
      prompt: `待沉淀工程档案范围：${op === 'drawer' && folder ? `抽屉 ${folder}` : '整柜'}（共 ${selectedItems.length} 卷）\n\n${cleanMultiline(promptBody, 6400)}`,
      maxTokens: SUMMARY_MAX_TOKENS,
    })
    if (llmRes && llmRes.ok && llmRes.text) {
      const parsed = extractJsonObject(llmRes.text)
      if (parsed && Array.isArray(parsed.entries) && parsed.entries.length > 0) {
        entriesRaw = parsed.entries.slice(0, 4)
        usedLlm = true
      }
    }
  } catch {}

  if (!entriesRaw) {
    // Deterministic distillation fallback preserving high-signal points & paths
    const leadTitle = op === 'drawer' && folder
      ? `【${folder} 沉淀】${selectedItems[0].title}`
      : `【工程沉淀】${selectedItems[0].title}${selectedItems.length > 1 ? ` 等 ${selectedItems.length} 卷精华` : ''}`
    const mergedPoints = []
    const mergedTags = new Set(['已沉淀'])
    const bodyBlocks = []
    for (const it of selectedItems.slice(0, 8)) {
      for (const tg of (it.tags || [])) mergedTags.add(tg)
      bodyBlocks.push(`### ${it.title}\n${cleanMultiline(it.summary || it.body, 500)}`)
      if (Array.isArray(it.points) && it.points.length > 0) {
        for (const pt of it.points.slice(0, 3)) {
          mergedPoints.push(pt)
        }
      } else {
        mergedPoints.push({
          title: clamp(it.title, 32),
          cue: clamp(it.summary || it.body, 56),
          detail: cleanMultiline(it.body || it.summary, 420),
        })
      }
    }
    entriesRaw = [{
      title: clamp(leadTitle, 64),
      category: folder || selectedItems[0].folder || 'contracts',
      summary: clamp(selectedItems.map(x => x.summary || x.title).filter(Boolean).slice(0, 2).join('；'), 140),
      tags: [...mergedTags].slice(0, 6),
      points: mergedPoints.slice(0, 10),
      body: bodyBlocks.join('\n\n'),
    }]
  }

  const savedEntries = []
  for (const raw of entriesRaw) {
    const res = savePrecipitatedEntry(projectKey, {
      ...raw,
      sourceCabinet: store.cabinetName || store.cabinetId,
      sourceCount: selectedItems.length,
    }, targetOpt)
    if (res && res.ok && res.entry) savedEntries.push(res.entry)
  }

  if (!savedEntries.length) {
    return { ok: false, error: '沉淀写入冷库失败，已保留原有工作档案' }
  }

  let clearedSource = false
  if (clearSource) {
    if (!idSet && op === 'drawer' && folder) {
      mutateArchive({ op: 'clearFolder', folder }, targetOpt)
      clearedSource = true
    } else {
      mutateArchive({ op: 'clearByIds', ids: selectedItems.map(x => x.id) }, targetOpt)
      clearedSource = true
    }
  }

  if (deps && typeof deps.appendBoardLog === 'function' && rootId !== 'global') {
    deps.appendBoardLog(rootId, `⏬ 已从${selectedItems.length} 卷工作档案提炼 ${savedEntries.length} 条可复用经验封存入 0-Token 冷库`, 'chief')
  }

  return {
    ok: true,
    projectKey,
    usedLlm,
    createdCount: savedEntries.length,
    entries: savedEntries,
    clearedSource,
    archives: listArchiveHeaders(rootId, { includePrecipitated: true }, targetOpt),
  }
}

const DISTILL_TO_GLOBAL_SYSTEM = [
  '你是「DSH 参谋长」的知识萃取总编。请审查当前「本会话工作档案柜」中的临时工作卷宗：',
  '1. **摘除一次性噪音**：剔除只属于本次调试流水账、临时状态快照或纯闲聊过渡的信息；',
  '2. **萃取可复用精华**：只摘出并总结未来跨会话仍长期有用的【工程坐标、入口路径、架构契约、核心命令、接口定义、通用踩坑与红线经验】；',
  '3. **浓缩成全局卷宗**：同类主题合并为 1~4 卷高信息密度、结构清晰的全局档案，保留真实文件名/函数名/命令参数，严禁编造；',
  '4. **只输出一个合法 JSON 对象**：',
  '{',
  '  "entries": [',
  '    {',
  '      "title": "全局档案短标题（≤36字）",',
  '      "folder": "coords|incidents|contracts|ops",',
  '      "paperclip": "gold|silver",',
  '      "summary": "一句话可复用价值摘要（≤60字）",',
  '      "tags": ["标签1", "标签2"],',
  '      "points": [',
  '        { "title": "要点标题", "cue": "一句话钩子", "detail": "完整可复用步骤/路径/契约" }',
  '      ],',
  '      "body": "完整精炼正文"',
  '    }',
  '  ]',
  '}',
].join('\n')

/** Extract, summarize, and distill reusable items from the current Session Cabinet into the Global Vault (`vaultScope: 'global'`). */
export async function distillSessionArchivesToGlobal(deps, {
  sessionId = '',
  cabinetId = '',
  ids = null,
  folder = '',
  clearSource = false,
  instruction = '',
} = {}) {
  const rootId = (deps && deps.resolveRootSessionId && deps.resolveRootSessionId(sessionId)) || String(sessionId || '').trim()
  if (!rootId || rootId === 'global') {
    return { ok: false, error: '当前未绑定具体对话会话，无法从本局档案柜提炼入全局库' }
  }

  const sessionOpt = archiveTargetForRoot(deps, rootId, { cabinetId, vaultScope: 'session' })
  const globalOpt = archiveTargetForRoot(deps, rootId, { vaultScope: 'global' })
  const store = loadArchiveStore(sessionOpt)

  const idSet = Array.isArray(ids) && ids.length > 0
    ? new Set(ids.map(x => String(x || '').trim()).filter(Boolean))
    : null
  const folderClean = typeof folder === 'string' ? folder.trim() : ''
  let selected = idSet
    ? store.items.filter(it => idSet.has(String(it.id)))
    : (folderClean ? store.items.filter(it => it.folder === folderClean) : store.items.slice())

  if (!selected.length) {
    return { ok: false, error: '当前本会话档案柜暂无可供提炼的档案条目' }
  }

  // Prioritize reusable engineering anchors/clips first
  const clipRank = { gold: 0, silver: 1, copper: 2 }
  selected = [...selected].sort((a, b) => (clipRank[a.paperclip] ?? 1) - (clipRank[b.paperclip] ?? 1))

  const promptBody = selected.slice(0, 14).map((it, idx) => [
    `--- 本局档案 #${idx + 1}: 《${it.title}》 (folder=${it.folder}, clip=${it.paperclip}) ---`,
    `提要: ${it.summary || '无'}`,
    Array.isArray(it.points) && it.points.length > 0
      ? '记忆点:\n' + it.points.map(p => `- ${p.title}: ${p.detail || p.cue}`).join('\n')
      : `正文:\n${cleanMultiline(it.body, 1400)}`,
  ].join('\n')).join('\n\n')

  let entriesRaw = null
  let usedLlm = false
  try {
    const llmRes = await callChiefLlm(deps, {
      sessionId: rootId,
      system: DISTILL_TO_GLOBAL_SYSTEM,
      prompt: [
        instruction ? `用户指定提炼侧重：${clamp(instruction, 240)}\n` : '',
        `待萃取本局工作档案（共 ${selected.length} 卷）：`,
        cleanMultiline(promptBody, 6800),
      ].filter(Boolean).join('\n'),
      maxTokens: SUMMARY_MAX_TOKENS,
    })
    if (llmRes && llmRes.ok && llmRes.text) {
      const parsed = extractJsonObject(llmRes.text)
      if (parsed && Array.isArray(parsed.entries) && parsed.entries.length > 0) {
        entriesRaw = parsed.entries.slice(0, 4)
        usedLlm = true
      }
    }
  } catch {}

  if (!entriesRaw) {
    // Deterministic fallback: distill gold/silver/reusable items grouped cleanly into global vault entries
    const reusable = selected.filter(it => it.paperclip !== 'copper')
    const pool = reusable.length ? reusable : selected
    const lead = pool[0]
    const mergedPoints = []
    const bodyBlocks = []
    const mergedTags = new Set(['全局萃取', ...(instruction ? ['专项提炼'] : [])])
    for (const it of pool.slice(0, 8)) {
      for (const tg of (it.tags || [])) mergedTags.add(tg)
      bodyBlocks.push(`### 《${it.title}》\n${cleanMultiline(it.summary || it.body, 480)}`)
      if (Array.isArray(it.points) && it.points.length > 0) {
        for (const pt of it.points.slice(0, 3)) mergedPoints.push(pt)
      } else {
        mergedPoints.push({
          title: clamp(it.title, 32),
          cue: clamp(it.summary || it.body, 56),
          detail: cleanMultiline(it.body || it.summary, 420),
        })
      }
    }
    const validFolders = new Set(['coords', 'incidents', 'contracts', 'ops', 'inbox'])
    entriesRaw = [{
      title: clamp(`【全局萃取】${lead.title}${pool.length > 1 ? ` 等 ${pool.length} 卷精选` : ''}`, 56),
      folder: validFolders.has(lead.folder) ? lead.folder : 'contracts',
      paperclip: lead.paperclip === 'gold' ? 'gold' : 'silver',
      summary: clamp(pool.map(x => x.summary || x.title).filter(Boolean).slice(0, 2).join('；'), 140),
      tags: [...mergedTags].slice(0, 6),
      points: mergedPoints.slice(0, 10),
      body: bodyBlocks.join('\n\n'),
    }]
  }

  const savedEntries = []
  const validFolders = new Set(['coords', 'incidents', 'contracts', 'ops', 'inbox'])
  for (const raw of entriesRaw) {
    if (!raw || typeof raw !== 'object') continue
    const title = clamp(raw.title || '全局萃取卷宗', 64)
    const f = validFolders.has(raw.folder) ? raw.folder : 'contracts'
    const clip = raw.paperclip === 'gold' ? 'gold' : 'silver'
    const res = mutateArchive({
      op: 'save',
      vaultScope: 'global',
      folder: f,
      paperclip: clip,
      title,
      summary: clamp(raw.summary || '', 160),
      tags: Array.isArray(raw.tags) ? raw.tags.slice(0, 8) : ['全局萃取'],
      points: Array.isArray(raw.points) ? raw.points : [],
      body: cleanMultiline(raw.body || raw.summary || title, 4000),
      by: 'DSH 参谋长萃取',
      rootSessionId: rootId,
    }, globalOpt)
    if (res && res.ok && res.item) savedEntries.push(res.item)
  }

  if (!savedEntries.length) {
    return { ok: false, error: '全局档案柜写入失败，已保留原有本局工作档案' }
  }

  let clearedSource = false
  if (clearSource) {
    if (!idSet && folderClean) {
      mutateArchive({ op: 'clearFolder', folder: folderClean, vaultScope: 'session' }, sessionOpt)
      clearedSource = true
    } else {
      mutateArchive({ op: 'clearByIds', ids: selected.map(x => x.id), vaultScope: 'session' }, sessionOpt)
      clearedSource = true
    }
  }

  const summaryReply = `- 【✦ 本局萃取入全局】已从本会话 ${selected.length} 卷工作档案中摘除临时噪音并提炼 **${savedEntries.length} 卷**可复用精华存入「🌐 全局档案柜」${clearedSource ? '（已按勾选清理本局原卷宗）' : '（本局原卷宗无损保留）'}：${savedEntries.map(e => `《${e.title}》`).join('、')}。`
  mutateChiefState((s) => {
    const ws = ensureWorkspace(s, rootId)
    ws.chat.push({
      id: nextId('chat'),
      role: 'chief',
      text: summaryReply,
      actions: [`萃取入全局 ×${savedEntries.length}`],
      at: Date.now(),
    })
    if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
  })
  if (deps && typeof deps.appendBoardLog === 'function') {
    deps.appendBoardLog(rootId, `✦ 参谋长已从本局 ${selected.length} 卷档案摘出可复用精华，保存 ${savedEntries.length} 卷入全局档案柜`, 'chief')
  }

  const stNow = loadChiefState()
  const wsNow = stNow.workspaces ? stNow.workspaces[rootId] : null
  const flippedIds = wsNow && Array.isArray(wsNow.flippedPrecipitatedIds) ? wsNow.flippedPrecipitatedIds : []
  return {
    ok: true,
    usedLlm,
    createdCount: savedEntries.length,
    entries: savedEntries,
    clearedSource,
    reply: summaryReply,
    archives: listArchiveHeaders(rootId, { vaultScope: 'session', includePrecipitated: true, flippedIds }, sessionOpt),
    globalArchives: listArchiveHeaders(rootId, { vaultScope: 'global', includePrecipitated: true, flippedIds }, globalOpt),
    view: await getChiefView(deps, rootId, { autoSummarize: false }),
  }
}

function buildChiefArchiveUpsertFn(deps, rootId) {
  return async (arc) => {
    const sc = arc && arc.vaultScope === 'global' ? 'global' : 'session'
    const opt = archiveTargetForRoot(deps, rootId, { vaultScope: sc })
    return mutateArchive({
      op: 'save',
      session: rootId,
      folder: (arc && arc.folder) || 'inbox',
      paperclip: 'silver',
      title: (arc && arc.title) || '参谋长工作归档',
      summary: (arc && arc.summary) || '',
      body: (arc && arc.body) || '',
      tags: Array.isArray(arc && arc.tags) ? arc.tags : [],
      by: 'chief',
    }, opt)
  }
}

function buildChiefCompactFn(deps, rootId) {
  return async (reason) => {
    if (!rootId || rootId === 'global') {
      return { ok: false, noop: true, skipped: 'blank-context', error: '当前为空白新对话（未绑定活跃主会话），暂无可压缩的历史上下文' }
    }
    if (!deps || typeof deps.compactSessionNow !== 'function') {
      return { ok: false, skipped: 'no-compaction-service', error: '宿主压缩服务未挂载' }
    }
    let usage = null
    try {
      usage = typeof deps.measureSessionTokens === 'function'
        ? await deps.measureSessionTokens(rootId)
        : null
    } catch {}
    const contextWindow = Math.max(1000, Number(usage && usage.contextWindow) || 128_000)
    const totalTokens = Number(usage && usage.totalTokens) || 0
    const seq = Math.max(0, Math.round(Number(usage && usage.seq) || 0))
    const ratioPct = totalTokens > 0 ? (totalTokens / contextWindow) * 100 : 0
    return executeHarvestAndCompact(deps, {
      sid: rootId,
      rootId,
      reason: reason || '参谋长实权工具主动发起抢救与上下文压缩',
      seq,
      ratioPct,
      totalTokens,
      contextWindow,
      logLabel: '参谋长主动压缩',
    })
  }
}

export async function askOrCommandChief(deps, {
  sessionId = '',
  text = '',
  forcedTarget = '',
  forcedMode = 'steer',
  images = [],
}) {
  const rawInput = cleanMultiline(text, 2000)
  const rawImages = Array.isArray(images) ? images : []
  if (!rawInput && !rawImages.length) {
    return { ok: false, error: '请输入要询问或吩咐参谋长的内容或上传图片' }
  }

  const rootId = deps.resolveRootSessionId(sessionId) || String(sessionId || 'global')
  const savedImagePaths = rawImages.length > 0 ? persistChiefImagesToWorkspace(deps, rootId, rawImages) : []
  let imageBlocks = []
  if (rawImages.length > 0) {
    try {
      imageBlocks = await admitChiefImages(deps, rawImages)
    } catch (err) {
      if (!savedImagePaths.length) {
        return { ok: false, error: String(err && err.message ? err.message : err) }
      }
      imageBlocks = []
    }
  }

  const effectiveImgCount = Math.max(imageBlocks.length, savedImagePaths.length)
  const input = rawInput || '请结合我上传的图片进行分析处理。'
  const userDisplayText = rawInput || `[上传图片 ×${effectiveImgCount}]`
  const imgMeta = effectiveImgCount > 0 ? { imageCount: effectiveImgCount } : {}

  const directory = await listPeerDirectory(deps, rootId)
  const board = deps.boardForSession(deps.boardFileFor(rootId))
  const state = loadChiefState()
  const effCfg = resolveWorkspaceConfig(state, rootId)
  const ownWs = ensureWorkspace(state, rootId)
  const hasChiefRiskAck = hasValidChiefRiskAck(ownWs)
  const permissionMode = normalizePermissionMode(effCfg.permissionMode || DEFAULT_CHIEF_PERMISSION_MODE, {
    requireAck: true,
    hasChiefRiskAck,
  })
  const permRank = permissionRank(permissionMode)
  const isConciseBrief = Boolean(effCfg.tacticalModes && effCfg.tacticalModes.conciseBrief)
  const view = clusterView(state, rootId)
  const targetOpt = archiveTargetForRoot(deps, rootId)
  const peerProgress = Array.isArray(directory.cluster) && directory.cluster.length > 1
    ? collectClusterPeerProgress(deps, directory.cluster, rootId)
    : []

  const denyChiefSystemInAdvisor = async (opName, reasonText) => {
    const elev = requestChiefElevation(rootId, {
      fromMode: permissionMode,
      targetMode: 'assistant',
      reason: reasonText,
      requestedActionSummary: clamp(input, 160),
      by: 'chief',
    })
    appendChiefAuditLog(rootId, {
      mode: permissionMode,
      stage: 'permission_gate',
      decision: 'deny_mode',
      operation: opName,
      target: 'chief_system',
      reason: reasonText,
      outcome: 'denied',
      by: 'chief',
    })
    const denyReply = `- 【🔒 权限受限（当前 L0 顾问只读）】${reasonText}\n- 【🔐 已发起提权请示】请点击顶部「🔐 同意提权至 L1 · 助手模式」弹窗后再执行参谋系统维护。`
    mutateChiefState((s) => {
      const ws = ensureWorkspace(s, rootId)
      ws.chat.push(
        { id: nextId('chat'), role: 'user', text: userDisplayText, ...imgMeta, actions: [], at: Date.now() },
        { id: nextId('chat'), role: 'chief', text: denyReply, actions: ['🔒 L0 顾问只读', ...(elev ? ['🔐 请示提权 L1'] : [])], at: Date.now() },
      )
      if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
    })
    return {
      ok: true,
      deniedByMode: true,
      elevationRequested: elev,
      reply: denyReply,
      relays: [],
      memoryChanges: [],
      boardOps: [],
      actionBadges: ['🔒 L0 顾问只读', ...(elev ? ['🔐 请示提权 L1'] : [])],
      view: await getChiefView(deps, rootId, { autoSummarize: false }),
    }
  }

  // Fast path: if user explicitly picked a concrete target pill AND used direct relay mode without asking chief to decompose
  if (forcedTarget && forcedTarget !== 'auto') {
    const delivery = await deliverCrossMessage(deps, {
      fromSession: rootId,
      fromLabel: '用户 (经 DSH 参谋长)',
      target: forcedTarget,
      text: rawInput || '请查看随信附带的图片与落盘路径。',
      mode: ['steer', 'followup', 'silent'].includes(forcedMode) ? forcedMode : 'steer',
      imageBlocks,
      savedImagePaths,
    })
    const reply = delivery.ok
      ? `已按你的指定向 ${delivery.target || forcedTarget} ${forcedMode === 'steer' ? '插话' : forcedMode === 'silent' ? '投递备忘纸条' : '递话'}${effectiveImgCount ? `（附带 ${effectiveImgCount} 张图片，原图已落盘）` : ''}${delivery.note ? '（' + delivery.note + '）' : '。'}`
      : `投递失败：${delivery.error}`

    mutateChiefState((s) => {
      const ws = ensureWorkspace(s, rootId)
      ws.chat.push(
        { id: nextId('chat'), role: 'user', text: userDisplayText, target: forcedTarget, ...imgMeta, actions: [], at: Date.now() },
        { id: nextId('chat'), role: 'chief', text: reply, actions: [delivery.ok ? `→ ${delivery.target || forcedTarget}` : '投递失败'], at: Date.now() },
      )
      if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
    })

    return {
      ok: delivery.ok,
      reply,
      relays: [delivery],
      savedImagePaths,
      memoryChanges: [],
      boardOps: [],
      view: await getChiefView(deps, rootId, { autoSummarize: false }),
    }
  }

  // Direct natural-language command to organize/curate the Engineering Archive Cabinet (`整理档案` / `收纳档案`)
  if (!forcedTarget || forcedTarget === 'auto') {
    if (/(?:档案|卷宗|老笔记)/.test(input) && /(?:整理|收纳|归类|分拣|拆解)/.test(input)) {
      if (permRank < 1) {
        return denyChiefSystemInAdvisor('整理参谋档案', '整理与归类档案库属于「参谋系统维护」操作，需「L1 · 助手模式」及以上权限。')
      }
      const orgScope = /全局/.test(input) ? 'global' : 'session'
      const orgRes = await organizeArchivesWithChief(deps, {
        sessionId: rootId,
        vaultScope: orgScope,
        scope: /全部|所有|全柜/.test(input) ? 'all' : 'unorganized',
        instruction: input,
      })
      if (orgRes.ok) {
        appendChiefAuditLog(rootId, {
          mode: permissionMode,
          stage: 'executor',
          decision: 'executed',
          operation: '整理参谋档案',
          target: orgScope,
          reason: clamp(input, 120),
          outcome: 'ok',
          by: 'chief',
        })
        return {
          ok: true,
          reply: orgRes.reply,
          relays: [],
          memoryChanges: [],
          boardOps: [`收纳档案 ${orgRes.updatedCount} 卷`],
          archives: orgRes.archives,
          view: orgRes.view,
        }
      }
    }
  }

  // 0-Token Precipitated Vault Contract: ONLY read precipitated vault if this session EXPLICITLY flipped entries out!
  const flippedIds = Array.isArray(ownWs.flippedPrecipitatedIds) ? ownWs.flippedPrecipitatedIds : []
  const flippedVaultLines = []
  if (flippedIds.length > 0) {
    const projectKey = resolveProjectKey(targetOpt.cwd)
    const flippedItems = getFlippedOutPrecipitatedForSession(projectKey, rootId, true, targetOpt)
    if (flippedItems.length > 0) {
      flippedVaultLines.push('', '## 8. 本会话已显式翻出的跨会话沉淀经验（仅包含用户显式翻出授权的条目）')
      for (const entry of flippedItems) {
        flippedVaultLines.push(`- 🏛️ [沉淀/${entry.category}] 《${entry.title}》：${entry.summary}`)
        if (Array.isArray(entry.points) && entry.points.length > 0) {
          for (const pt of entry.points.slice(0, 4)) {
            flippedVaultLines.push(`    * ${pt.title}：${clamp(pt.detail || pt.cue, 200)}`)
          }
        } else if (entry.body) {
          flippedVaultLines.push(`    * 正文：${clamp(entry.body, 280)}`)
        }
      }
    }
  }

  // Watch all 3 archive vaults in background (sealed items NEVER leak to Lead unless placed onto desk!)
  const visibleArchives = collectChiefVisibleArchives(deps, rootId, state)
  const watchLines = []
  const fmtWatchTag = (label, it) => `[${label}${it.id ? ` | id=${it.id}` : ''}] 《${clamp(it.title, 36)}》：${clamp(it.summary, 80)}`
  const watchEntries = [
    ...visibleArchives.deskSessionItems.map(it => fmtWatchTag('桌面·本局(主可见)', it)),
    ...visibleArchives.deskGlobalItems.map(it => fmtWatchTag('桌面·全局(主可见)', it)),
    ...visibleArchives.deskFlippedItems.map(it => fmtWatchTag('桌面·沉淀(主可见)', it)),
    ...visibleArchives.mountedGlobalItems.map(it => fmtWatchTag('全局参阅·主隐', it)),
    ...((visibleArchives.sealedWatch && visibleArchives.sealedWatch.sessionSealed) || []).map(it => fmtWatchTag('本局封存·主隐', it)),
    ...((visibleArchives.sealedWatch && visibleArchives.sealedWatch.globalSealed) || []).map(it => fmtWatchTag('全局封存·主隐', it)),
    ...((visibleArchives.sealedWatch && visibleArchives.sealedWatch.precipSealed) || []).map(it => fmtWatchTag('沉淀封存·主隐', it)),
  ]
  if (watchEntries.length > 0) {
    watchLines.push('', '## 9. 参谋长三库档案全览（封存项仅参谋长关注、未注入主对话；上桌面备选项主对话亦重点看到；支持许愿框 archiveOps）', ...watchEntries.map(x => '- ' + x))
  }

  // On-demand lazy archive lookup ONLY when the user explicitly asks Chief about archives (Chief searches Session + System Global Cold Vault on demand)
  const asksArchiveExplicitly = /(?:档案|卷宗|归档|以前|历史记录|工程坐标|老笔记|全局|沉淀|查一下.*(?:怎么|路径|命令|配置))/.test(input)
  const onDemandArchiveLines = []
  if (asksArchiveExplicitly) {
    const sessionTarget = rootId && rootId !== 'global' ? archiveTargetForRoot(deps, rootId, { vaultScope: 'session' }) : null
    const globalTarget = archiveTargetForRoot(deps, rootId, { vaultScope: 'global' })
    const foundSess = sessionTarget ? searchArchives(input, { limit: 3, vaultScope: 'session' }, sessionTarget) : { ok: true, hits: [] }
    const foundGlob = searchGlobalVaultForChief(input, { limit: 3 }, globalTarget)
    const combinedHits = [
      ...(Array.isArray(foundSess.hits) ? foundSess.hits.map(h => ({ ...h, _scopeLabel: '本会话档案', _target: sessionTarget })) : []),
      ...(Array.isArray(foundGlob.hits) ? foundGlob.hits.map(h => ({ ...h, _scopeLabel: '系统全局档案', _target: globalTarget })) : []),
    ]
    if (combinedHits.length > 0) {
      onDemandArchiveLines.push('', '## 7. 按需调取的档案柜卷宗（含本会话档案柜与参谋长专属全局档案柜，仅参谋长侧检索）')
      for (let i = 0; i < combinedHits.length; i += 1) {
        const hit = combinedHits[i]
        onDemandArchiveLines.push(`- 📎 [${hit._scopeLabel}/${hit.folderLabel}] 《${hit.title}》：${hit.summary}`)
        if (i < 3) {
          const det = getArchiveDetail(hit.id, rootId, hit._target)
          if (det.ok && det.item && Array.isArray(det.item.points)) {
            for (const pt of det.item.points.slice(0, 4)) {
              onDemandArchiveLines.push(`    * ${pt.title}：${clamp(pt.detail || pt.cue, 180)}`)
            }
          }
        }
      }
    }
  }

  // Gather real-time conversation stream + cursor + dual-tier bounds + task breakdown
  const liveDigest = collectLiveConversationsDigest(deps, rootId, directory)
  const numberedFacts = view.facts.slice()
  const tasks = Array.isArray(board && board.tasks) ? board.tasks : []
  const doingTasks = tasks.filter(t => t.status === 'doing')
  const blockedTasks = tasks.filter(t => t.status === 'blocked')
  const todoTasks = tasks.filter(t => t.status === 'todo')
  const doneTasks = tasks.filter(t => t.status === 'done')
  const cursor = (board && board.cursor) || {}
  const pinnedBounds = (board && board.pinnedBounds) || { allowed: [], forbidden: [], notes: [] }
  const allBounds = (board && board.bounds) || { allowed: [], forbidden: [], notes: [] }
  const fmtBoundCol = (col) => {
    const list = allBounds[col] || []
    if (!list.length) return '（无）'
    const pinSet = new Set(pinnedBounds[col] || [])
    return list.map(x => `${pinSet.has(x) ? '📌[全局定住] ' : '[本任务] '}${x}`).join('；')
  }

  const meaningfulPeers = directory.targets.filter(
    t => t.kind === 'lead' || t.status === 'running' || !/^mnemon-review/i.test(String(t.name || t.handle || '')),
  )
  const hiddenIdleProbes = Math.max(0, directory.targets.length - meaningfulPeers.length)

  const promptLines = [
    '## 1. 当前可通信成员名录 (Peers)',
    ...(meaningfulPeers.length
      ? meaningfulPeers.slice(0, 16).map(t => `- key="${t.key}" | 名称="${t.handle}" | 类型=${t.kind} | 状态=${t.status}${t.taskTitle ? ' | 当前负责: ' + t.taskTitle : ''}`)
      : ['- key="lead" | 名称="主对话" | 类型=lead']),
    ...(hiddenIdleProbes > 0 ? [`（另有 ${hiddenIdleProbes} 个已空闲后台检查点探针已折叠）`] : []),
    ...((directory.otherSessions && directory.otherSessions.length > 0)
      ? [
          '',
          '## 1.5 本机其他独立会话窗口（可用许愿框 networkOps 连接 link / 断开 unlink）',
          ...directory.otherSessions.slice(0, 12).map(s => `- sessionId="${s.id}" | 名称="${s.name}" | 状态=${s.status} | 已互联=${s.linked ? '是' : '否'}${s.objective ? ' | 目标=' + clamp(s.objective, 50) : ''}`),
        ]
      : []),
    '',
    '## 2. 主对话与子代理【实时对话流现场快照】(Live Transcripts)',
    ...(liveDigest.summaryLines.length
      ? liveDigest.summaryLines
      : ['（当前暂无活跃对话流消息）']),
    '',
    '## 3. 参谋看板目标、断点游标与任务图态势',
    `- 总目标: ${board.objective || '（未设）'}`,
    `- 实时断点游标 (Cursor): 当前步骤="${cursor.step || '无'}" | 下一步="${cursor.next || '无'}" | 阻塞点="${cursor.blocked || '无'}"`,
    `- 计划步骤 (Plan): ${((board.plan || []).slice(0, 8).map(s => `${s.done ? '[✓]' : '[ ]'} ${clamp(s.text, 60)}`).join('；')) || '（无）'}`,
    `- 🔴 受阻任务 (${blockedTasks.length} 项): ${blockedTasks.slice(0, 6).map(t => `#${t.id} ${t.title}${t.owner ? '(@' + shortAgentBriefName(t.owner) + ')' : ''}${t.note ? ' [原因:' + clamp(t.note, 80) + ']' : ''}`).join('；') || '（无）'}`,
    `- 🔵 推进中任务 (${doingTasks.length} 项): ${doingTasks.slice(0, 6).map(t => `#${t.id} ${t.title}${t.owner ? '(@' + shortAgentBriefName(t.owner) + ')' : ''}${t.note ? ' [' + clamp(t.note, 60) + ']' : ''}`).join('；') || '（无）'}`,
    `- ⚪ 待办任务 (${todoTasks.length} 项): ${todoTasks.slice(0, 6).map(t => `#${t.id} ${t.title}${t.owner ? '(@' + shortAgentBriefName(t.owner) + ')' : ''}`).join('；') || '（无）'}`,
    `- ✅ 最近完成 (${doneTasks.length} 项): ${doneTasks.slice(-5).map(t => `#${t.id} ${t.title}${t.evidence ? ' [证据:' + clamp(t.evidence, 60) + ']' : ''}`).join('；') || '（无）'}`,
    '',
    '## 4. 当前生效边界（📌全局定住 vs 本任务）',
    `- 禁止红线 (forbidden): ${fmtBoundCol('forbidden')}`,
    `- 必做事项 (allowed): ${fmtBoundCol('allowed')}`,
    `- 注意事项 (notes): ${fmtBoundCol('notes')}`,
    '',
    '## 5. 编号持久记忆条目 (Facts)',
    ...(numberedFacts.length
      ? numberedFacts.map((f, idx) => `[${idx + 1}] (${f.category}) ${f.text}`)
      : ['（暂无条目）']),
    '',
    '## 6. 近期回合摘要与协同信箱参考',
    ...((board.memory || [])
      .filter(m => m && !isInternalCheckpointNoise(m.title || m.text))
      .slice(-6)
      .map(m => `- [回合/${m.section}] ${clamp(stripCheckpointNoise(m.title || m.text), 150)}`)),
    ...(peerProgress.length > 0
      ? [
          '',
          '## 6.5 当前互通协同网络邻居实时进度（已共享进度）',
          ...peerProgress.map(p => `- 🌐 [${p.title}] ${p.objective ? `目标="${p.objective}" | ` : ''}${p.progressSummary || '暂无板卡进度'}${p.cursorStep ? ` | 当前="${p.cursorStep}"` : ''}`),
        ]
      : []),
    ...(view.mailbox.slice(-4).map(m => `- [信箱 ${m.from} → @${m.to}] ${clamp(m.text, 120)}`)),
    ...onDemandArchiveLines,
    ...flippedVaultLines,
    ...watchLines,
    '',
    `## 参谋长执行权限与显示模式：permissionMode=${permissionMode}${isConciseBrief ? ' | 极简战报=开启' : ''}`,
    describeThreePartyBoundariesForPrompt(permissionMode),
    '## 用户刚刚对你说的话：',
    input,
    ...(savedImagePaths.length > 0
      ? [
          '',
          `🖼️ 用户随信上传了 ${savedImagePaths.length} 张原图（已真实落盘到工作区）：`,
          ...savedImagePaths.map(p => `- ${p.path}`),
          '（重要提示：若当前参谋长模型不支持视觉看图，请把任务与上述绝对路径直接调度/递话给支持看图或读文件工具的主对话 @lead / 子代理处理，严禁臆造图内细节！）',
        ]
      : []),
  ]

  const isBlankContext = liveDigest.summaryLines.length === 0 && !board.objective && !(board.plan || []).length
  const resolvedCwd = deps && typeof deps.getSessionCwd === 'function' ? deps.getSessionCwd(rootId) : ''
  const explicitCompactReq = !imageBlocks.length && isExplicitCompactCommand(input)
  const statusOnlyInquiry = !imageBlocks.length && !explicitCompactReq && isPureStatusInquiry(input)

  const effectiveSystem = [
    ASK_CHIEF_SYSTEM,
    ...(isConciseBrief ? [CONCISE_BRIEF_ASK_EXTRA] : []),
    ...(isBlankContext
      ? [
          '',
          '🌱 【当前处于空白新上下文（主对话尚未开聊）】：',
          resolvedCwd ? `- 当前已解析工作区根目录：${resolvedCwd}` : '',
          '- 若用户让你查找/分析/修改当前工作区项目文件，请依据当前 permissionMode 直接调用你的真实 JSON `toolCalls` 工具（如 `list_dir` / `search_files` / `read_file` / `edit_file` / `run_command`）处理并如实汇报；绝对禁止直接向用户输出 `<｜DSML｜calls>` 等原始工具调用标签！',
          '- 若尚无主对话历史，除非用户明确命令且会话已存在，不要无故调用 `session_compact`；若用户明确想把任务留给主对话开场接手，可放进 `relays`（`target: "lead"`）由系统自动暂存待领交接包。',
        ].filter(Boolean)
      : []),
    ...(statusOnlyInquiry
      ? [
          '',
          '⚡ 【当前问题属于「主对话/团队实时态势询问」快速通道】：',
          '- 严禁调用任何工具，严禁输出任何 XML/DSML 工具标签（如 `<｜DSML｜calls>`），严禁扫盘或运行 Shell！',
          '- 请直接根据上下文里已经给出的「实时对话流快照」「小任务板 (Plan)」「任务图」「断点游标」与「协同邻居进度」，输出唯一合法 JSON（仅填 `"reply"`，`"toolCalls": []`）。',
        ]
      : []),
    '',
    CHIEF_TOOLS_PROMPT_GUIDE,
  ].join('\n')

  const upsertArchiveFn = buildChiefArchiveUpsertFn(deps, rootId)
  const compactNowFn = buildChiefCompactFn(deps, rootId)

  const loopRes = await runChiefAgenticLoop(deps, {
    rootId,
    sessionId: rootId,
    system: effectiveSystem,
    initialPrompt: promptLines.join('\n'),
    imageBlocks,
    allowTextFallbackOnVisionMiss: savedImagePaths.length > 0,
    permissionMode,
    hasChiefRiskAck,
    board,
    maxSteps: statusOnlyInquiry ? 1 : 4,
    readOnlyToolsOnly: false,
    disableTools: statusOnlyInquiry,
    callLlmFn: (callOpts) => callChiefLlm(deps, { ...callOpts, maxTokens: SUMMARY_MAX_TOKENS }),
    extractJsonFn: extractJsonObject,
    upsertArchiveFn,
    compactNowFn,
    queueApprovalFn: (item) => queueChiefApproval(rootId, item),
    requestElevationFn: (req) => requestChiefElevation(rootId, req),
    recordAuditFn: (entry) => appendChiefAuditLog(rootId, entry),
  })

  const llmRes = (loopRes && loopRes.llmRes) || { ok: false, error: 'agentic loop no response' }
  if (imageBlocks.length > 0 && !llmRes.ok && !savedImagePaths.length) {
    return {
      ok: false,
      error: llmRes.error || '当前参谋长模型无法识别图片，请在右上角切换支持视觉的多模态模型后重试',
    }
  }

  let parsed = (loopRes && loopRes.parsed) || (llmRes.ok ? extractJsonObject(llmRes.text) : null)
  const loopBadges = Array.isArray(loopRes && loopRes.toolBadges) ? [...loopRes.toolBadges] : []
  const loopToolRecords = Array.isArray(loopRes && loopRes.toolRecords) ? loopRes.toolRecords : []
  const queuedApprovals = Array.isArray(loopRes && loopRes.pendingApprovals) ? [...loopRes.pendingApprovals] : []
  const queuedElevations = Array.isArray(loopRes && loopRes.elevationRequests) ? [...loopRes.elevationRequests] : []
  const compactToolRec = loopToolRecords.find(r => r && r.tool === 'session_compact') || null
  let forcedCompactOut = null
  let workflowBlockedNeedsElevation = false
  let chiefSystemBlockedNeedsElevation = false

  if (explicitCompactReq && !compactToolRec) {
    const compactGuard = evaluateSafetyGuardHardRules({ tool: 'session_compact', opClass: 'workflow', board })
    if (compactGuard.blocked) {
      forcedCompactOut = { ok: false, blockedBySafetyGuard: true, error: compactGuard.reason }
      loopBadges.push(compactGuard.badge || '🛡️ 卫兵拦截压缩')
      appendChiefAuditLog(rootId, { mode: permissionMode, stage: 'safety_guard', decision: 'blocked', operation: '压缩主对话', target: 'current', reason: compactGuard.reason, outcome: 'blocked', by: 'chief' })
    } else {
      const compactGate = evaluateChiefPermissionGate({ permissionMode, hasChiefRiskAck, opClass: 'workflow', tool: 'session_compact' })
      if (compactGate.decision === 'deny_mode' || compactGate.decision === 'deny_unacknowledged_l3') {
        workflowBlockedNeedsElevation = true
        forcedCompactOut = { ok: false, deniedByMode: true, error: compactGate.error }
        loopBadges.push(compactGate.badge || '🔒 权限禁压')
        appendChiefAuditLog(rootId, { mode: permissionMode, stage: 'permission_gate', decision: compactGate.decision, operation: '压缩主对话', target: 'current', reason: compactGate.error, outcome: 'denied', by: 'chief' })
      } else if (compactGate.decision === 'require_approval') {
        const apr = queueChiefApproval(rootId, {
          category: 'main_workflow',
          operationLabel: '压缩主对话上下文 (/compact)',
          targetLabel: '当前主会话',
          reason: clamp(input, 140),
          impact: '会触发主会话历史压缩，先抢救细节入本会话档案柜再压缩裁剪历史上下文',
          kind: 'compact',
          payload: { reason: `用户指令触发：${input}` },
          by: 'chief',
        })
        if (apr) queuedApprovals.push(apr)
        forcedCompactOut = { ok: false, pendingApproval: true, error: '当前处于「L2 · 参谋模式」，压缩主对话请求已提交操作授权弹窗，请点击「允许本次操作」后执行。' }
        loopBadges.push('🛡️ 待确认 /compact')
        appendChiefAuditLog(rootId, { mode: permissionMode, stage: 'permission_gate', decision: 'pending_approval', operation: '压缩主对话', target: 'current', reason: clamp(input, 120), outcome: 'pending', by: 'chief' })
      } else {
        forcedCompactOut = await compactNowFn(`用户指令触发：${input}`).catch(err => ({
          ok: false,
          error: (err && err.message) || String(err || '压缩执行失败'),
        }))
        appendChiefAuditLog(rootId, {
          mode: permissionMode,
          stage: 'executor',
          decision: 'executed',
          operation: '压缩主对话',
          target: 'current',
          reason: clamp(input, 120),
          outcome: forcedCompactOut && forcedCompactOut.ok ? 'ok' : 'error',
          by: 'chief',
        })
        if (forcedCompactOut && forcedCompactOut.ok) {
          loopBadges.push(forcedCompactOut.noop ? '🗄️ 已归档(免压)' : '🗜 完成抢救压缩')
        } else {
          loopBadges.push('⚠️ 压缩未完成')
        }
      }
    }
  }

  // Graceful intelligent fallback if LLM is offline / unconfigured / returned non-JSON
  if (!parsed) {
    // 1) Explicit @peer relay syntax
    const mentionMatch = input.match(/^@([^\s:：,，]+)[:：,，\s]+([\s\S]+)$/)
    if (mentionMatch) {
      const targetName = mentionMatch[1]
      const msgBody = mentionMatch[2].trim()
      const delivery = await deliverCrossMessage(deps, {
        fromSession: rootId,
        fromLabel: '用户 (经 DSH 参谋长)',
        target: targetName,
        text: msgBody,
        mode: 'steer',
        imageBlocks,
        savedImagePaths,
      })
      const fallbackReply = delivery.ok
        ? `- 【已递话】已向 @${delivery.target} 插话传达指令${savedImagePaths.length ? `（附原图路径 ×${savedImagePaths.length}）` : ''}。`
        : `- 【投递失败】未找到目标 ${targetName}（${delivery.error}）`
      mutateChiefState((s) => {
        const ws = ensureWorkspace(s, rootId)
        ws.chat.push(
          { id: nextId('chat'), role: 'user', text: userDisplayText, ...imgMeta, actions: [], at: Date.now() },
          { id: nextId('chat'), role: 'chief', text: fallbackReply, actions: [], at: Date.now() },
        )
        if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
      })
      return {
        ok: delivery.ok,
        reply: fallbackReply,
        relays: [delivery],
        savedImagePaths,
        memoryChanges: [],
        boardOps: [],
        view: await getChiefView(deps, rootId, { autoSummarize: false }),
      }
    }

    // 2) Natural-language request to consolidate scattered boundaries into one
    if (!imageBlocks.length && /边界|红线/.test(input) && /总结成一条|合并成一条|浓缩|合一|整合/.test(input)) {
      if (permRank < 1) {
        return denyChiefSystemInAdvisor('浓缩呈批工作边界', '总结与呈批工作边界需要「L1 · 助手模式」及以上权限。')
      }
      const targetCol = /允许|必做/.test(input) ? 'allowed' : /注意/.test(input) ? 'notes' : ''
      const consRes = await consolidateBoundsWithChief(deps, {
        sessionId: rootId,
        field: targetCol,
        instruction: input,
      })
      if (consRes.ok) {
        mutateChiefState((s) => {
          const ws = ensureWorkspace(s, rootId)
          ws.chat.push(
            { id: nextId('chat'), role: 'user', text: userDisplayText, ...imgMeta, actions: [], at: Date.now() },
            { id: nextId('chat'), role: 'chief', text: consRes.reply, actions: ['呈批浓缩边界'], at: Date.now() },
          )
          if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
        })
        return {
          ok: true,
          reply: consRes.reply,
          relays: [],
          memoryChanges: [],
          boardOps: [],
          boundProposals: consRes.proposals,
          view: consRes.view,
        }
      }
    }

    // 2.5) Wishing Box offline shortcuts: distill to global / reset tasks / unlink peer sessions
    if (!imageBlocks.length && /(?:提炼|摘取|抽取|总结)/.test(input) && /全局/.test(input)) {
      if (permRank < 1) {
        return denyChiefSystemInAdvisor('提炼入全局档案', '提炼经验写入全局冷库需要「L1 · 助手模式」及以上权限。')
      }
      const distRes = await distillSessionArchivesToGlobal(deps, {
        sessionId: rootId,
        instruction: input,
      })
      if (distRes.ok) {
        mutateChiefState((s) => {
          const ws = ensureWorkspace(s, rootId)
          ws.chat.push(
            { id: nextId('chat'), role: 'user', text: userDisplayText, ...imgMeta, actions: [], at: Date.now() },
            { id: nextId('chat'), role: 'chief', text: distRes.reply, actions: [`提炼入全局 ×${distRes.createdCount || 0}`], at: Date.now() },
          )
          if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
        })
        return {
          ok: true,
          reply: distRes.reply,
          relays: [],
          memoryChanges: [],
          boardOps: [],
          archiveOps: [`提炼入全局 ×${distRes.createdCount || 0}`],
          archives: distRes.archives,
          view: distRes.view,
        }
      }
    }

    if (!imageBlocks.length && /(?:清空|重设|重置)/.test(input) && /(?:任务|看板)/.test(input)) {
      if (permRank < 1) {
        return denyChiefSystemInAdvisor('重设任务看板', '修改或重设参谋看板任务需要「L1 · 助手模式」及以上权限。')
      }
      const resetRes = deps.runAction
        ? deps.runAction({ action: 'task.reset', status: 'all', resetPlan: /计划|全部/.test(input), session: rootId, by: 'chief' })
        : { ok: false }
      if (resetRes && resetRes.ok) {
        const msg = '- 【已重设任务看板】已按你的要求清空重设本会话任务列表。'
        mutateChiefState((s) => {
          const ws = ensureWorkspace(s, rootId)
          ws.chat.push(
            { id: nextId('chat'), role: 'user', text: userDisplayText, ...imgMeta, actions: [], at: Date.now() },
            { id: nextId('chat'), role: 'chief', text: msg, actions: ['重设任务看板'], at: Date.now() },
          )
          if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
        })
        return {
          ok: true,
          reply: msg,
          relays: [],
          memoryChanges: [],
          boardOps: ['重设任务看板'],
          board: resetRes.board,
          view: await getChiefView(deps, rootId, { autoSummarize: false }),
        }
      }
    }

    if (!imageBlocks.length && /(?:断开|取消|解除)/.test(input) && /(?:协同|网络|连接|关联)/.test(input)) {
      if (permRank < 1) {
        return denyChiefSystemInAdvisor('调整协同网络', '连接或断开跨窗口协同网络需要「L1 · 助手模式」及以上权限。')
      }
      const linkedPeers = ((directory && directory.otherSessions) || []).filter(p => p.linked)
      const qLower = input.toLowerCase()
      const targetsToUnlink = /全部|所有/.test(input)
        ? linkedPeers
        : linkedPeers.filter(p => qLower.includes(String(p.id).toLowerCase()) || (p.name && qLower.includes(String(p.name).toLowerCase())))
      const chosen = targetsToUnlink.length > 0 ? targetsToUnlink : (linkedPeers.length === 1 ? linkedPeers : [])
      if (chosen.length > 0) {
        const badges = []
        for (const p of chosen) {
          const r = setPeerLink(rootId, p.id, false)
          if (r && r.ok) badges.push(`断开协同：${p.name}`)
        }
        if (badges.length > 0) {
          const msg = `- 【已断开协同网络】${badges.join('；')}`
          mutateChiefState((s) => {
            const ws = ensureWorkspace(s, rootId)
            ws.chat.push(
              { id: nextId('chat'), role: 'user', text: userDisplayText, ...imgMeta, actions: [], at: Date.now() },
              { id: nextId('chat'), role: 'chief', text: msg, actions: badges, at: Date.now() },
            )
            if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
          })
          return {
            ok: true,
            reply: msg,
            relays: [],
            memoryChanges: [],
            boardOps: [],
            networkOps: badges,
            view: await getChiefView(deps, rootId, { autoSummarize: false }),
          }
        }
      }
    }

    // 2.5) Deterministic reply when user explicitly requested compaction
    if (forcedCompactOut) {
      const compactMsg = forcedCompactOut.ok
        ? (forcedCompactOut.noop
            ? `- 【已归档(免压)】已抢救当前现场记录入本会话档案柜${forcedCompactOut.harvestId ? `（#${forcedCompactOut.harvestId}）` : ''}；当前主对话历史暂无需压缩。`
            : `- 【已完成抢救与上下文压缩】已将关键细节抢救入本会话档案柜${forcedCompactOut.harvestId ? `（#${forcedCompactOut.harvestId}）` : ''}，并完成主对话上下文静默压缩。`)
        : (forcedCompactOut.pendingApproval
            ? `- 【🛡️ 待逐项确认】${forcedCompactOut.error}`
            : forcedCompactOut.deniedByMode
              ? `- 【🔒 权限受限】${forcedCompactOut.error}`
              : `- 【压缩未完成】${forcedCompactOut.error || '当前暂无可压缩历史或宿主压缩服务暂未就绪。'}`)
      let autoElevOut = null
      if (workflowBlockedNeedsElevation && !queuedElevations.length) {
        autoElevOut = requestChiefElevation(rootId, {
          fromMode: permissionMode,
          targetMode: 'strategist',
          reason: '执行主对话上下文压缩 (/compact) 需要「L2 · 参谋模式（逐项确认）」或以上权限',
          requestedActionSummary: clamp(input, 140),
          by: 'chief',
        })
      }
      mutateChiefState((s) => {
        const ws = ensureWorkspace(s, rootId)
        ws.chat.push(
          { id: nextId('chat'), role: 'user', text: userDisplayText, ...imgMeta, actions: [], at: Date.now() },
          { id: nextId('chat'), role: 'chief', text: compactMsg, actions: loopBadges, at: Date.now() },
        )
        if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
      })
      return {
        ok: true,
        reply: compactMsg,
        relays: [],
        memoryChanges: [],
        boardOps: [],
        actionBadges: loopBadges,
        toolRecords: loopToolRecords,
        pendingApprovals: queuedApprovals,
        ...(autoElevOut ? { elevationRequested: autoElevOut } : {}),
        view: await getChiefView(deps, rootId, { autoSummarize: false }),
      }
    }

    // 3) Fallback summary + auto-elevation if a read-only/assistant tool wall occurred
    const deniedToolRec = loopToolRecords.find(r => r && r.result && r.result.deniedByMode)
    let fallbackElev = queuedElevations[0] || null
    if (deniedToolRec && !fallbackElev) {
      fallbackElev = requestChiefElevation(rootId, {
        fromMode: permissionMode,
        targetMode: deniedToolRec.result.requiredMode || 'strategist',
        reason: deniedToolRec.result.error || '执行请求的操作需要更高权限',
        requestedActionSummary: clamp(input, 160),
        by: 'chief',
      })
    }
    const strippedPlain = llmRes.ok && llmRes.text ? stripToolCallMarkup(llmRes.text).trim() : ''
    const usablePlainLlm = strippedPlain && !strippedPlain.startsWith('{') && strippedPlain.length >= 6
      ? cleanMultiline(strippedPlain, 900)
      : ''
    const archiveFallback = onDemandArchiveLines.length > 1
      ? ['- 【已从沉淀档案柜按需检索到以下卷宗】', ...onDemandArchiveLines.slice(2)].join('\n')
      : ''
    const rawFallbackReply = usablePlainLlm || archiveFallback || buildSmartFallbackReply({
      input,
      board,
      liveDigest,
      directory,
      facts: numberedFacts,
      mailbox: view.mailbox,
      conciseBrief: isConciseBrief,
    })
    const replyText = isConciseBrief ? sanitizeConciseBriefText(rawFallbackReply) : rawFallbackReply

    mutateChiefState((s) => {
      const ws = ensureWorkspace(s, rootId)
      ws.chat.push(
        { id: nextId('chat'), role: 'user', text: userDisplayText, ...imgMeta, actions: [], at: Date.now() },
        { id: nextId('chat'), role: 'chief', text: replyText, actions: loopBadges, at: Date.now() },
      )
      if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
    })
    return {
      ok: true,
      reply: replyText,
      relays: [],
      memoryChanges: [],
      boardOps: [],
      actionBadges: loopBadges,
      toolRecords: loopToolRecords,
      pendingApprovals: queuedApprovals,
      ...(fallbackElev ? { elevationRequested: fallbackElev } : {}),
      view: await getChiefView(deps, rootId, { autoSummarize: false }),
    }
  }

  // Execute decomposed relays with strict 4-tier workflow permission gating
  const relayResults = []
  const actionBadges = [...loopBadges]
  const relayGate = evaluateChiefPermissionGate({
    permissionMode,
    hasChiefRiskAck,
    opClass: 'workflow',
    tool: 'relay',
  })

  for (const r of (Array.isArray(parsed.relays) ? parsed.relays : []).slice(0, 8)) {
    if (!r || !r.text) continue
    const targetName = r.target || 'lead'
    const isLeadTarget = /^(?:lead|main|主对话)$/i.test(String(targetName).trim())
    const relayMode = ['steer', 'followup', 'silent'].includes(r.mode) ? r.mode : 'steer'

    const relayGuard = evaluateSafetyGuardHardRules({ tool: 'relay', opClass: 'workflow', command: r.text, board })
    if (relayGuard.blocked) {
      actionBadges.push(relayGuard.badge || '🛡️ 卫兵拦递话')
      relayResults.push({ ok: false, target: targetName, blockedBySafetyGuard: true, error: relayGuard.reason })
      appendChiefAuditLog(rootId, { mode: permissionMode, stage: 'safety_guard', decision: 'blocked', operation: '工作流递话', target: String(targetName), reason: relayGuard.reason, outcome: 'blocked', by: 'chief' })
      continue
    }

    if (relayGate.decision === 'deny_mode' || relayGate.decision === 'deny_unacknowledged_l3') {
      workflowBlockedNeedsElevation = true
      actionBadges.push(relayGate.badge || '🔒 权限禁调工作流')
      relayResults.push({ ok: false, target: targetName, deniedByMode: true, error: relayGate.error })
      appendChiefAuditLog(rootId, { mode: permissionMode, stage: 'permission_gate', decision: relayGate.decision, operation: isLeadTarget ? '调整主对话工作流' : '调整子代理工作流', target: String(targetName), reason: relayGate.error, outcome: 'denied', by: 'chief' })
      continue
    }

    if (relayGate.decision === 'require_approval') {
      const apr = queueChiefApproval(rootId, {
        category: isLeadTarget ? 'main_workflow' : 'subagent_workflow',
        operationLabel: isLeadTarget ? '调整主对话工作流（投递指令）' : '调整子代理工作流（投递指令）',
        targetLabel: isLeadTarget ? '主对话 (@lead)' : `@${targetName}`,
        reason: clamp(r.subject || '参谋建议向代理投递工作流指令', 140),
        impact: isLeadTarget ? '将向主对话注入工作流指令并触发继续推进' : '将唤醒或引导子代理执行新任务指令',
        preview: clamp(r.text, 240),
        kind: 'relay',
        payload: {
          fromSession: rootId,
          fromLabel: 'DSH 参谋 (逐项授权)',
          target: targetName,
          subject: r.subject || '',
          text: r.text,
          mode: relayMode,
          imageBlocks,
          savedImagePaths,
          isBlankContext,
        },
        by: 'chief',
      })
      if (apr) queuedApprovals.push(apr)
      actionBadges.push(`🛡️ 待确认递话 → ${isLeadTarget ? '主对话' : targetName}`)
      relayResults.push({ ok: false, pendingApproval: true, approvalId: apr && apr.id, target: targetName })
      appendChiefAuditLog(rootId, { mode: permissionMode, stage: 'permission_gate', decision: 'pending_approval', operation: isLeadTarget ? '主对话工作流递话' : '子代理工作流递话', target: String(targetName), reason: clamp(r.subject || r.text, 120), outcome: 'pending', by: 'chief' })
      continue
    }

    // L3 Chief mode: execute directly
    const deliv = await deliverCrossMessage(deps, {
      fromSession: rootId,
      fromLabel: 'DSH 参谋长 (代用户传达)',
      target: targetName,
      subject: r.subject || '',
      text: r.text,
      mode: relayMode,
      imageBlocks,
      savedImagePaths,
    })
    if (isLeadTarget && (!deliv.ok || (isBlankContext && !deliv.deliveredPhysical)) && typeof deps.stagePendingTransfer === 'function') {
      const staged = deps.stagePendingTransfer(
        `[DSH 参谋长预派发指令${r.subject ? ' · ' + r.subject : ''}]\n${r.text}`,
        rootId,
        { by: 'chief', subject: r.subject || '' },
      )
      if (staged) {
        relayResults.push({ ...deliv, ok: true, target: '主对话(待领)', mode: 'pending-transfer', stagedPending: true })
        actionBadges.push('暂存待领 → 主对话')
        appendChiefAuditLog(rootId, { mode: permissionMode, stage: 'executor', decision: 'executed', operation: '主对话待领递话', target: '主对话', reason: clamp(r.subject || r.text, 120), outcome: 'ok', by: 'chief' })
        continue
      }
    }
    relayResults.push(deliv)
    appendChiefAuditLog(rootId, { mode: permissionMode, stage: 'executor', decision: 'executed', operation: isLeadTarget ? '主对话递话' : '子代理递话', target: String(deliv.target || targetName), reason: clamp(r.subject || r.text, 120), outcome: deliv.ok ? 'ok' : 'error', by: 'chief' })
    if (deliv.ok) actionBadges.push(`${relayMode === 'steer' ? '插话' : '递话'} → ${deliv.target}`)
  }

  // Execute Chief-system ops (L1 Assistant+ required; strictly denied in L0 Advisor)
  const hasSystemOps = Boolean(
    (Array.isArray(parsed.boardOps) && parsed.boardOps.length > 0)
    || (Array.isArray(parsed.archiveOps) && parsed.archiveOps.length > 0)
    || (Array.isArray(parsed.networkOps) && parsed.networkOps.length > 0)
    || (Array.isArray(parsed.memoryChanges) && parsed.memoryChanges.length > 0)
    || (Array.isArray(parsed.boundProposals) && parsed.boundProposals.length > 0),
  )
  const systemGate = evaluateChiefPermissionGate({
    permissionMode,
    hasChiefRiskAck,
    opClass: 'chief_system',
    tool: 'chief_system',
  })

  let executedBoardOps = []
  let executedArchiveOps = []
  let executedNetworkOps = []
  let appliedFacts = []
  const proposedBounds = []
  const existingBounds = (board && board.bounds) || { allowed: [], forbidden: [], notes: [] }
  const rawBoundProposals = Array.isArray(parsed.boundProposals) ? parsed.boundProposals.slice(0, 4) : []

  if (hasSystemOps && systemGate.decision === 'deny_mode') {
    chiefSystemBlockedNeedsElevation = true
    actionBadges.push(systemGate.badge || '🔒 L0禁改参谋系统')
    appendChiefAuditLog(rootId, {
      mode: permissionMode,
      stage: 'permission_gate',
      decision: 'deny_mode',
      operation: '修改参谋系统(看板/记忆/档案)',
      target: 'chief_system',
      reason: systemGate.error,
      outcome: 'denied',
      by: 'chief',
    })
  } else if (hasSystemOps) {
    executedBoardOps = applyBoardOps(deps, rootId, parsed.boardOps)
    for (const b of executedBoardOps) actionBadges.push(b)

    const archiveExec = await applyArchiveOps(deps, rootId, parsed.archiveOps, { input })
    executedArchiveOps = archiveExec.executed || []
    for (const a of executedArchiveOps) actionBadges.push(a)

    executedNetworkOps = applyNetworkOps(rootId, parsed.networkOps, directory)
    for (const n of executedNetworkOps) actionBadges.push(n)

    if (executedBoardOps.length || executedArchiveOps.length || executedNetworkOps.length) {
      appendChiefAuditLog(rootId, {
        mode: permissionMode,
        stage: 'executor',
        decision: 'executed',
        operation: '维护参谋系统',
        target: [...executedBoardOps, ...executedArchiveOps, ...executedNetworkOps].slice(0, 3).join('；'),
        reason: clamp(input, 120),
        outcome: 'ok',
        by: 'chief',
      })
    }
  }

  // Handle explicit model elevationRequest OR auto-generate when an action hit mode wall
  let finalElevation = queuedElevations[0] || null
  if (parsed.elevationRequest && typeof parsed.elevationRequest === 'object' && parsed.elevationRequest.targetMode) {
    const reqTarget = normalizePermissionMode(parsed.elevationRequest.targetMode)
    if (permissionRank(reqTarget) > permRank) {
      const elv = requestChiefElevation(rootId, {
        fromMode: permissionMode,
        targetMode: reqTarget,
        reason: clamp(parsed.elevationRequest.reason || '完成用户当前任务需要提升参谋权限', 240),
        requestedActionSummary: clamp(parsed.elevationRequest.requestedActionSummary || input, 180),
        by: 'chief',
      })
      if (elv) {
        finalElevation = elv
        actionBadges.push(`🔐 请示提权 ${CHIEF_PERMISSION_META[reqTarget].level}`)
      }
    }
  } else if (!finalElevation) {
    const deniedToolRec = loopToolRecords.find(r => r && r.result && r.result.deniedByMode)
    const neededMode = (deniedToolRec && deniedToolRec.result && deniedToolRec.result.requiredMode)
      || (workflowBlockedNeedsElevation ? 'strategist' : (chiefSystemBlockedNeedsElevation ? 'assistant' : ''))
    if (neededMode && permissionRank(neededMode) > permRank) {
      const elv = requestChiefElevation(rootId, {
        fromMode: permissionMode,
        targetMode: neededMode,
        reason: neededMode === 'assistant'
          ? '该操作需要维护参谋看板、记忆或档案（需「L1 · 助手模式」及以上）'
          : '该操作需要修改工作区或调度主对话/子代理工作流（需「L2 · 参谋模式」或以上）',
        requestedActionSummary: clamp(input, 180),
        by: 'chief',
      })
      if (elv) {
        finalElevation = elv
        actionBadges.push(`🔐 请示提权 ${CHIEF_PERMISSION_META[neededMode].level}`)
      }
    }
  }

  const cleanedParsedReply = stripToolCallMarkup(parsed.reply || '').trim()
  const compactOutcomeNote = forcedCompactOut
    ? (forcedCompactOut.ok
        ? (forcedCompactOut.noop
            ? `【已归档(免压)】已将本轮现场记录存入本会话档案柜${forcedCompactOut.harvestId ? `（#${forcedCompactOut.harvestId}）` : ''}，宿主历史暂无需进一步压缩。`
            : `【已完成抢救与上下文压缩】已将关键细节存入本会话档案柜${forcedCompactOut.harvestId ? `（#${forcedCompactOut.harvestId}）` : ''}，并完成主对话静默压缩。`)
        : (forcedCompactOut.pendingApproval
            ? `【🛡️ 待逐项确认】${forcedCompactOut.error}`
            : `【压缩未完成】${forcedCompactOut.error || '宿主压缩服务未就绪'}`))
    : (compactToolRec && compactToolRec.ok === false && !compactToolRec.pendingApproval
        ? `（⚠️ 实测压缩提示：${compactToolRec.error || '压缩未完成'}）`
        : '')
  const permissionStatusNotes = []
  if (queuedApprovals.length > 0 && !/操作授权|允许本次操作/.test(cleanedParsedReply)) {
    permissionStatusNotes.push(`- 【🛡️ 待逐项确认】已为您弹出「操作授权请求」弹窗（共 ${queuedApprovals.length} 项受控操作），点击「允许本次操作」后才会实际执行。`)
  }
  if (finalElevation && !/提权/.test(cleanedParsedReply)) {
    const tgtMeta = CHIEF_PERMISSION_META[finalElevation.targetMode] || {}
    permissionStatusNotes.push(`- 【🔐 已申请提权】当前为「${CHIEF_PERMISSION_META[permissionMode].level} · ${CHIEF_PERMISSION_META[permissionMode].title}」，已向您发起提权至「${tgtMeta.level || ''} · ${tgtMeta.title || finalElevation.targetMode}」的申请弹窗。`)
  }
  const baseParsedReply = cleanedParsedReply || buildSmartFallbackReply({ input, board, liveDigest, directory, facts: numberedFacts, mailbox: view.mailbox, conciseBrief: isConciseBrief }) || '- 【已执行】已按你的吩咐安排妥当。'
  const combinedParsedReply = [
    compactOutcomeNote,
    baseParsedReply,
    ...permissionStatusNotes,
  ].filter(Boolean).join('\n')
  const rawReplyText = cleanMultiline(combinedParsedReply, 1100)
  const replyText = isConciseBrief ? sanitizeConciseBriefText(rawReplyText) : rawReplyText

  const BOUND_COL_LABEL = { forbidden: '禁止红线', allowed: '必做事项', notes: '注意事项' }

  mutateChiefState((s) => {
    const ws = ensureWorkspace(s, rootId)
    if (systemGate.decision === 'allow') {
      const activeCluster = getLinkedCluster(s, rootId)
      appliedFacts = applyFactChanges(ws, numberedFacts, parsed.memoryChanges, 'user', {
        originRootId: rootId,
        peerRootIds: activeCluster.filter(id => id !== rootId),
      })
      for (const f of appliedFacts) {
        actionBadges.push((f.op === 'add' ? '记入：' : f.op === 'edit' ? '修订：' : '移除：') + clamp(f.text, 24))
      }

      for (const bp of rawBoundProposals) {
        if (!bp || typeof bp !== 'object') continue
        const rawBpField = String(bp.field || '').trim().toLowerCase()
        const normBpField = rawBpField === 'must' ? 'allowed' : rawBpField
        const col = ['forbidden', 'allowed', 'notes'].includes(normBpField) ? normBpField : 'forbidden'
        const itemText = clamp(bp.item || bp.draftText || bp.text || '', 220)
        if (!itemText || secretLike(itemText)) continue
        const replaces = Array.isArray(bp.replaces)
          ? bp.replaces.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim().slice(0, 240)).slice(0, 20)
          : []
        const colExisting = Array.isArray(existingBounds[col]) ? existingBounds[col] : []
        if (!replaces.length && colExisting.some(x => String(x).trim() === itemText)) continue
        const dupPending = ws.suggestions.some(
          existing => existing.status === 'pending' && existing.kind === 'bound' && existing.draftText === itemText,
        )
        if (dupPending) continue
        const colLabel = BOUND_COL_LABEL[col] || '禁止红线'
        const hadPinnedInReplaces = replaces.some(r => ((board.pinnedBounds && board.pinnedBounds[col]) || []).includes(r))
        const sug = normalizeSuggestion({
          kind: 'bound',
          boundField: col,
          fromAgent: replaces.length ? '✦ 参谋长浓缩' : '✦ 参谋长提炼',
          title: replaces.length
            ? `${colLabel} ${replaces.length} 合 1：${clamp(itemText, 26)}`
            : `拟入${colLabel}：${clamp(itemText, 30)}`,
          reason: clamp(
            bp.reason || (replaces.length
              ? `将 ${replaces.length} 条零散边界浓缩合成为 1 条，请拍板替换。`
              : '根据会话上下文总结的工作边界，请拍板注入。'),
            180,
          ),
          target: 'bounds',
          targetLabel: colLabel,
          mode: 'silent',
          draftText: itemText,
          replaces,
          pinGlobal: Boolean(bp.pinGlobal) || hadPinnedInReplaces,
        })
        if (sug) {
          ws.suggestions.push(sug)
          proposedBounds.push(sug)
          actionBadges.push(`${replaces.length ? '浓缩' : '呈批'}${colLabel}：${clamp(itemText, 18)}`)
        }
      }
    }

    ws.chat.push(
      { id: nextId('chat'), role: 'user', text: userDisplayText, ...imgMeta, actions: [], at: Date.now() },
      { id: nextId('chat'), role: 'chief', text: replyText, actions: actionBadges, at: Date.now() },
    )
    if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
  })

  // Refresh narrative summary in background if facts, board, archives, or network changed
  const shouldRefreshNarrative = appliedFacts.length > 0
    || executedBoardOps.length > 0
    || executedArchiveOps.length > 0
    || executedNetworkOps.length > 0
  const freshView = await getChiefView(deps, rootId, { autoSummarize: shouldRefreshNarrative })
  const freshBoard = executedBoardOps.length > 0 && deps.boardForSession && deps.boardFileFor
    ? deps.boardForSession(deps.boardFileFor(rootId))
    : undefined
  let freshArchives
  if (executedArchiveOps.length > 0) {
    try {
      const sc = rootId && rootId !== 'global' ? 'session' : 'global'
      const opt = archiveTargetForRoot(deps, rootId, { vaultScope: sc })
      const flIds = (freshView && freshView.flippedPrecipitatedIds) || []
      freshArchives = listArchiveHeaders(rootId, { vaultScope: sc, includePrecipitated: true, flippedIds: flIds }, opt)
    } catch {}
  }

  return {
    ok: true,
    reply: replyText,
    relays: relayResults,
    actionBadges,
    memoryChanges: appliedFacts,
    boardOps: executedBoardOps,
    archiveOps: executedArchiveOps,
    networkOps: executedNetworkOps,
    boundProposals: proposedBounds,
    toolRecords: loopToolRecords,
    pendingApprovals: queuedApprovals,
    ...(finalElevation ? { elevationRequested: finalElevation } : {}),
    permissionMode,
    ...(freshBoard ? { board: freshBoard } : {}),
    ...(freshArchives ? { archives: freshArchives } : {}),
    view: freshView,
  }
}

function describeThreePartyBoundariesForPrompt(permissionMode) {
  const mode = normalizePermissionMode(permissionMode)
  if (mode === 'advisor') {
    return '- 四级权限当前档 [L0 · 顾问模式 READ ONLY · 默认模式]：仅允许读取看板与允许访问的项目状态、分析与建言；严禁修改工作区文件、运行系统命令、修改参谋系统或调整主对话/子代理工作流（需要时可调用 request_permission_elevation 申请提权）。'
  }
  if (mode === 'assistant') {
    return '- 四级权限当前档 [L1 · 助手模式 ASSISTANT]：允许只读查证项目，并自主维护参谋系统（记忆、档案柜、看板配置、边界呈批）；严禁直接修改项目工作区或接管主对话/子代理工作流（需要时可申请提权至 L2/L3）。'
  }
  if (mode === 'strategist') {
    return '- 四级权限当前档 [L2 · 参谋模式 ADVISOR WITH APPROVAL · 逐项授权]：可自主维护参谋系统；涉及修改工作区文件、执行系统命令或调整主对话/子代理工作流时，每项受控操作均会弹窗等待用户逐项点击「允许本次操作」后方可执行。'
  }
  return '- 四级权限当前档 [L3 · 参谋长模式 CHIEF OF STAFF · 主动风险知悉]：已获用户勾选确认风险，允许在安全卫兵硬性规则与禁止红线护栏内直接读写工作区、执行命令、切换或协调主对话及子代理工作流并完成维护与压缩。'
}

/**
 * Multi-Archive Combinatorial Relay (`递话`):
 * Bundles 1+ archives across Session / Global / Precipitated vaults together with the user's explicit instruction
 * and delivers them cleanly to `@lead` or the specified target agent.
 */
export async function relayArchivesWithChief(deps, { sessionId, items = [], instruction = '', target = 'lead', mode = 'steer', cabinetId = '' } = {}) {
  const rawSid = String(sessionId || '').trim()
  const rootId = (deps.resolveRootSessionId && deps.resolveRootSessionId(rawSid)) || rawSid || 'global'
  const selected = Array.isArray(items) ? items.slice(0, 8) : []
  const reqText = cleanMultiline(instruction, 800)
  if (!selected.length && !reqText) {
    return { ok: false, error: '请先勾选至少 1 份档案或输入带话要求' }
  }

  const baseOpt = archiveTargetForRoot(deps, rootId, { cabinetId, vaultScope: 'session' })
  const projectKey = resolveProjectKey(baseOpt.cwd)
  const loaded = []
  const scopeLabelMap = { session: '本局档案', global: '全局档案', precipitated: '沉淀冷库' }

  for (const ref of selected) {
    if (!ref || !ref.id) continue
    const rawSc = ref.scope || ref.vaultScope
    const sc = ['session', 'global', 'precipitated'].includes(rawSc) ? rawSc : 'session'
    let entry = null
    if (sc === 'precipitated') {
      const pRes = getPrecipitatedDetail(projectKey, ref.id, rootId, baseOpt)
      if (pRes && pRes.ok && pRes.item) entry = pRes.item
    } else {
      const opt = archiveTargetForRoot(deps, rootId, { cabinetId: sc === 'session' ? cabinetId : '', vaultScope: sc })
      const aRes = getArchiveDetail(ref.id, rootId, opt)
      if (aRes && aRes.ok && aRes.item) entry = aRes.item
    }
    if (entry) {
      loaded.push({ scope: sc, scopeLabel: scopeLabelMap[sc], item: entry })
    } else if (ref.title) {
      loaded.push({ scope: sc, scopeLabel: scopeLabelMap[sc], item: { id: ref.id, title: ref.title, summary: ref.summary || '', body: '', points: [] } })
    }
  }

  if (!loaded.length && selected.length) {
    return { ok: false, error: '未能读取所选档案内容，请刷新档案列表后重试' }
  }

  const header = `📎 【参谋长代用户带要求递交工程档案（共 ${loaded.length} 份）】`
  const reqBlock = reqText
    ? `📝 【用户本次明确要求】：\n${reqText}`
    : '📝 【用户要求】：请重点结合以下档案内容对照推进当前任务。'
  const docBlocks = loaded.map((d, idx) => {
    const it = d.item
    const pts = Array.isArray(it.points) && it.points.length
      ? it.points.slice(0, 5).map(p => `  - ${p.title}：${clamp(p.detail || p.cue, 160)}`).join('\n')
      : ''
    const rawSnippet = cleanMultiline(it.rawBody || it.body || it.summary || '', 360)
    return [
      `### ${idx + 1}. [${d.scopeLabel}] 《${clamp(it.title || '未命名档案', 56)}》`,
      it.summary ? `> 摘要：${clamp(it.summary, 140)}` : '',
      pts || '',
      rawSnippet && !pts ? rawSnippet : '',
    ].filter(Boolean).join('\n')
  })

  const fullText = [header, reqBlock, '', ...docBlocks].join('\n\n')
  const safeMode = ['steer', 'followup', 'silent'].includes(mode) ? mode : 'steer'
  const delivery = await deliverCrossMessage(deps, {
    fromSession: rootId,
    fromLabel: '用户（经 DSH 参谋长递送档案）',
    target: target || 'lead',
    subject: loaded.length === 1 ? `递交档案《${clamp(loaded[0].item.title, 28)}》` : `合并递交 ${loaded.length} 份档案`,
    text: fullText,
    mode: safeMode,
  })

  const titlesStr = loaded.map(d => `《${clamp(d.item.title, 24)}》`).join('、')
  mutateChiefState((s) => {
    const ws = ensureWorkspace(s, rootId)
    ws.chat.push(
      {
        id: nextId('chat'),
        role: 'user',
        text: `📎 递送档案 ${titlesStr || '（无）'}${reqText ? `\n要求：${reqText}` : ''}`,
        actions: [],
        at: Date.now(),
      },
      {
        id: nextId('chat'),
        role: 'chief',
        text: delivery.ok
          ? `- 【已按要求合并递话】已将 ${titlesStr} 连同你的要求（${safeMode === 'steer' ? '立即插话' : safeMode === 'silent' ? '静默纸条' : '排入续行'}）传达给 ${delivery.target || target || '@lead'}。`
          : `- 【递话失败】${delivery.error || '目标不可达'}`,
        actions: delivery.ok ? [`→ ${delivery.target || target || 'lead'} (${loaded.length}卷)`] : ['递话失败'],
        at: Date.now(),
      },
    )
    if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
  })

  return {
    ok: Boolean(delivery && delivery.ok),
    error: delivery && !delivery.ok ? delivery.error : '',
    delivery,
    count: loaded.length,
    view: await getChiefView(deps, rootId, { autoSummarize: false }),
  }
}

/**
 * Prime Minister Boundary Proposal API (`chief_board` action `"bounds.propose"`).
 * Lead or subagents submit wall-hits / boundary lessons here instead of silently mutating global bounds;
 * DSH Chief curates them and prompts the user for approval before injecting into `board.bounds`.
 */
export function proposeBoundToChief(deps, { sessionId, callerAgent, by, field, item, items, reason }) {
  const sid = String(sessionId || (callerAgent && callerAgent.id) || '').trim()
  const rootId = (deps.resolveRootSessionId && deps.resolveRootSessionId(sid, callerAgent)) || sid || 'global'
  const identity = deps.resolveAgentIdentity ? deps.resolveAgentIdentity(deps.runtime, sid, callerAgent) : null
  const speaker = identity && identity.isChild
    ? `@${identity.self}`
    : (by && by !== 'agent' ? String(by) : '@lead')

  const rawCol = String(field || '').trim().toLowerCase()
  const normCol = rawCol === 'must' ? 'allowed' : rawCol
  const col = ['forbidden', 'allowed', 'notes'].includes(normCol) ? normCol : 'forbidden'
  const BOUND_COL_LABEL = { forbidden: '禁止红线', allowed: '必做事项', notes: '注意事项' }
  const colLabel = BOUND_COL_LABEL[col] || '禁止红线'

  const rawItems = []
  if (typeof item === 'string' && item.trim()) rawItems.push(item.trim())
  if (Array.isArray(items)) {
    for (const entry of items) {
      if (typeof entry === 'string' && entry.trim()) rawItems.push(entry.trim())
    }
  }
  if (!rawItems.length) {
    return { ok: false, error: 'bounds.propose requires item (string) or items (string[])' }
  }

  const board = deps.boardForSession && deps.boardFileFor && rootId !== 'global'
    ? deps.boardForSession(deps.boardFileFor(rootId))
    : null
  const existingCol = Array.isArray(board?.bounds?.[col]) ? board.bounds[col] : []

  const proposed = []
  const skippedDuplicates = []

  mutateChiefState((state) => {
    const ws = ensureWorkspace(state, rootId)
    for (const rawRule of rawItems.slice(0, 6)) {
      const ruleText = clamp(rawRule, 220)
      if (!ruleText || secretLike(ruleText)) continue
      if (existingCol.some(x => String(x).trim() === ruleText)) {
        skippedDuplicates.push(ruleText)
        continue
      }
      const dupPending = ws.suggestions.some(
        s => s.status === 'pending' && s.kind === 'bound' && s.draftText === ruleText,
      )
      if (dupPending) {
        skippedDuplicates.push(ruleText)
        continue
      }
      const sug = normalizeSuggestion({
        kind: 'bound',
        boundField: col,
        fromAgent: speaker,
        title: `拟入${colLabel}：${clamp(ruleText, 30)}`,
        reason: clamp(reason || `${speaker} 在执行中上报的边界约束，请批准后注入全局边界。`, 180),
        target: 'bounds',
        targetLabel: colLabel,
        mode: 'silent',
        draftText: ruleText,
      })
      if (sug) {
        const pendingNonBound = ws.suggestions.filter(s => s.status === 'pending' && s.kind !== 'bound')
        const pendingAll = ws.suggestions.filter(s => s.status === 'pending')
        if (pendingAll.length >= SUGGESTIONS_CAP && pendingNonBound.length > 0) {
          pendingNonBound[0].status = 'dismissed'
        }
        ws.suggestions.push(sug)
        proposed.push(sug)
      }
    }
  })

  if (proposed.length && typeof deps.appendBoardLog === 'function' && rootId !== 'global') {
    deps.appendBoardLog(
      rootId,
      `🏛 收到边界奏请 (${colLabel})：${proposed.map(p => clamp(p.draftText, 40)).join('；')}`,
      speaker,
    )
  }

  return {
    ok: true,
    proposed: proposed.map(p => ({ id: p.id, field: p.boundField, item: p.draftText, from: p.fromAgent })),
    skippedDuplicates,
    message: proposed.length
      ? `已呈交 DSH 参谋长（共 ${proposed.length} 条），参谋长正请示用户批准后注入全局【${colLabel}】。`
      : '该边界已在全局边界或待批请示列表中，无需重复上报。',
  }
}

/* -------------------------------------------------------------------------- */
/* Post-Turn Silent Review & Proactive Suggestion Pills                       */
/* -------------------------------------------------------------------------- */

const TURN_REVIEW_SYSTEM = [
  '你是「DSH 参谋长」（宰相级协同与督导中枢）的后台复盘与督导模块。某个对话刚结束一轮输出。',
  '请阅读最新对话片段、工作区核心目标、计划步骤、团队状态、生效边界（🚫 禁止红线 / ✅ 必做事项 / 💡 注意事项）、持久记忆与当前开启的战术开关，只输出一个 JSON 对象：',
  '',
  '1. `memoryChanges`：仅当出现跨轮次持久有效的规矩、分工、关键架构结论或踩坑教训时才新增/修订/删除；普通干活过程返回 `[]`。严禁保存密码或密钥。',
  '2. `boardOps`：若发现当前 `计划步骤 (Plan)` 明显仍对应旧需求/与最新 `总目标 (Objective)` 严重脱节（stale plan），务必输出 `{ "op": "plan.resetForGoal" }` 或 `{ "op": "plan.set", "steps": [...] }` 自动修正计划；也可更新 `task.update` / `cursor.set`。注意：当 `INTERVENTION_SUPERVISOR` 开启时，核心目标已锁定，严禁输出 `objective.set` 擅改目标！',
  '3. `planAssessment`：`{ "stale": true|false, "reason": "…" }`，指明当前计划步骤是否与总目标失配陈旧。',
  '4. `goalStatus` 与 `unmetMustDo`：当开启 `GOAL_MODE` 或 `INTERVENTION_SUPERVISOR`（主动强介入）时重点评估，取值 `"in_progress" | "achieved" | "blocked"`。',
  '   - **核心目标目的地铁律**：只要 `工作区核心目标 (Objective)` 非空，主动强介入的所有介入判断**一律以该核心目标有无完成作为最终目的地**（仅当核心目标为空时才退回对照最新用户原始诉求）。',
  '   - **必做事项核验铁律**：`已有工作边界` 中的 `必做事项 (allowed)` 为硬性交付清单！在主对话/子代理交上来的作业未完成任何一条适用必做事项或缺少对应交付/验证证据前，**必须将未完成项逐条写入 `unmetMustDo` 数组，并保持 `goalStatus: "in_progress"` 与 `shouldIntervene: true`**（严禁判为 `"achieved"`）！',
  '   - 仅当核心目标与全部适用必做事项均已完成并有实证支撑时，才可设 `goalStatus: "achieved"`（并填 `goalSummary` 与 `goalEvidence`）；否则填 `goalMissing`。',
  '5. `hazardStop`（**强介入紧急安全煞车与撞边界熔断 · 最高优先级，优先于一切续推！**）：',
  '   - `{ "triggered": false, "category": "none|irreversible_risk|boundary_collision", "title": "", "reason": "" }`',
  '   - 当 `INTERVENTION_SUPERVISOR` 或 `AUTO_PILOT_SESSION_ONLY` 开启时，你必须严密审查：主/子代理刚刚提出、准备执行、请求用户拍板，或接下来继续推进是否**存在重大不可逆风险，或继续推进必然会撞穿当前生效边界（尤其 🚫 禁止红线）**？',
  '   - **重要提示（下列仅是常见举例，绝不限于此！）**：包括但不限于实际花钱/扣费/下单/付费 API 调用、不可逆删除或清空文件/数据/仓库、下载超大文件占用巨额磁盘或流量、关闭/重启服务器或关键宿主服务、对外公开推送/发布不可撤回变更、破坏宿主机隔离边界、以及任何一旦继续推跑就会导致不可逆损失或必然撞穿红线的情形。',
  '   - 一旦命中任一上述风险或必然撞边界：**必须立即设 `"hazardStop": { "triggered": true, "category": "...", "title": "简短醒目告警标题", "reason": "用清晰人话说清具体会造成什么不可逆损失或必然撞上哪条边界，以及为何必须立即停下等用户处理" }`，并强制设 `"shouldIntervene": false`、`interventionText: ""`**（严禁再推下一轮！）。',
  '6. `shouldIntervene` & `interventionText`：当开启「主动强介入 (`INTERVENTION_SUPERVISOR`)」且 `hazardStop.triggered === false`、主代理停下时，对照「核心目标 + 必做事项 + 最新用户诉求」逐项核验！只要目标或必做事项尚未真正做完、缺少实测验证证据却自称完成，必须设 `shouldIntervene: true` 并写出清晰可执行、可直接投递给 `@lead` 继续推进下一回合的督导指令；若处于 `strictVerify` 模式但回复无实测输出证据，务必驳回自称完成并要求补跑验证；若开启 `conciseBrief`，督导指令严格限定在 3 条以内要点。仅当核心目标与必做事项均已完成 (`achieved`)、或正在等待子代理回信时，设 `shouldIntervene: false`。',
  '7. `suggestions`（最多 1 条，宁缺毋滥）：',
  '   - `"kind": "bound"`：明显撞墙或发现长期红线/必做规矩时请示注入边界；',
  '   - `"kind": "relay"`：发现明确跨对话信息差时的递话建议；',
  '   - `"kind": "advice"`：当主模型陷入明显可替代方案、环境坑点或需提醒用户拍板的关键决策时提出一句话建议，可带 `"popup": true|false`（仅关键分叉/阻塞决策设 `true`）。',
  '8. `shouldCompactNow` & `compactReason`：仅当 `SMART_COMPACT_CO_MANAGED`（✦ 智选）启用时评估！此时硬性上下文阈值已退让为辅助，由你与主会话共同把控压缩时机：只要一个完整阶段目标刚刚收口、工作流切换阶段、出现大量重复试错/工具噪音日志、或上下文估算已达 ≥30% 且适合归档脱水时，果断设 `shouldCompactNow: true` 并填写一句话 `compactReason`；仅在刚起步或上下文极轻时保持 `false`。',
  '9. `AUTO_PILOT_SESSION_ONLY`（全自动托管安全边界）：当激活标志包含 `AUTO_PILOT_SESSION_ONLY` 时，所有自动决策仅限本对话会话内部！严禁将本会话规律生成 `"pinGlobal": true` 的全局定住边界，严禁跨出本对话去篡改全局档案柜或无关独立窗口；发现跨窗口传递信息时可留待人工审批。',
  '',
  '输出格式（严格 JSON）：',
  '{',
  '  "memoryChanges": [{ "op": "add", "category": "discipline|architecture|progress|preference|team", "text": "…" }],',
  '  "boardOps": [],',
  '  "planAssessment": { "stale": false, "reason": "" },',
  '  "goalStatus": "in_progress",',
  '  "goalSummary": "",',
  '  "goalEvidence": "",',
  '  "goalMissing": "",',
  '  "unmetMustDo": [],',
  '  "hazardStop": { "triggered": false, "category": "none", "title": "", "reason": "" },',
  '  "shouldIntervene": false,',
  '  "interventionText": "",',
  '  "shouldCompactNow": false,',
  '  "compactReason": "",',
  '  "suggestions": []',
  '}',
].join('\n')

/** High-precision backup safety net if the turn-review model missed `hazardStop.triggered` despite unmistakable irreversible hazard or boundary collision cues. */
function detectEmergencyHazardFallback({ parsed, digestText = '', bounds = {}, isInterventionActive = false }) {
  const rawHs = parsed && parsed.hazardStop && typeof parsed.hazardStop === 'object' ? parsed.hazardStop : null
  if (rawHs && rawHs.triggered === true && (rawHs.reason || rawHs.title)) {
    return {
      triggered: true,
      category: clamp(rawHs.category || 'irreversible_risk', 40) || 'irreversible_risk',
      title: clamp(rawHs.title || '强介入安全煞车 · 已自动停止', 120),
      reason: cleanMultiline(rawHs.reason || rawHs.title || '继续推进存在不可逆重大风险或必然撞穿边界，已暂停强介入并等待您的指示。', 520),
    }
  }
  if (!isInterventionActive) {
    return { triggered: false, category: 'none', title: '', reason: '' }
  }

  const assistantParts = String(digestText || '').split(/(?:^|\n)Assistant:\s*/)
  const lastAssistant = assistantParts.length > 1 ? assistantParts[assistantParts.length - 1] : String(digestText || '')
  const reviewNotes = `${String(parsed?.goalMissing || '')}\n${String(parsed?.interventionText || '')}`

  if (String(parsed?.goalStatus || '') === 'blocked' && /(?:不可逆|重大损失|撞[^\n。]{0,8}(?:红线|边界)|违反[^\n。]{0,8}禁止|花钱|扣费|付费|下单|删库|永久删除|大文件|关闭服务器|停服|破坏宿主机)/.test(reviewNotes)) {
    return {
      triggered: true,
      category: /红线|边界|禁止/.test(reviewNotes) ? 'boundary_collision' : 'irreversible_risk',
      title: /红线|边界|禁止/.test(reviewNotes) ? '继续推进将撞穿工作边界 · 已急停' : '检测到重大不可逆风险 · 已急停',
      reason: cleanMultiline(parsed.goalMissing || parsed.interventionText || '继续推进可能导致不可逆损失或触犯工作边界，已立即停止主动强介入。', 520),
    }
  }

  const askHighRiskConfirmRe = /(?:需要|请)(?:您|用户)?(?:亲自|人工|手动)?(?:确认|授权|拍板|批准)[^\n。]{0,50}(?:花钱|扣费|付款|付费|下单|充值|永久删除|清空目录|格式化|关闭服务器|停服|重启宿主|下载[^\n。]{0,20}(?:GB|大文件)|不可逆)/i
  const mConfirm = lastAssistant.match(askHighRiskConfirmRe)
  if (mConfirm) {
    return {
      triggered: true,
      category: 'irreversible_risk',
      title: '高危/不可逆操作等待用户拍板 · 已急停',
      reason: cleanMultiline(`主对话提示需要您确认高风险操作（${mConfirm[0]}），为防止造成不可逆损失，已自动停止强介入推跑。`, 520),
    }
  }

  const forbiddenList = Array.isArray(bounds && bounds.forbidden) ? bounds.forbidden : []
  if (forbiddenList.length > 0 && /(?:继续[^\n。]{0,12}(?:必|将|会)[^\n。]{0,10}(?:触犯|违反|撞上)|已触及[^\n。]{0,8}禁止红线|必然撞边界)/.test(reviewNotes)) {
    return {
      triggered: true,
      category: 'boundary_collision',
      title: '继续推进必然撞穿禁止红线 · 已急停',
      reason: cleanMultiline(reviewNotes, 520),
    }
  }

  return { triggered: false, category: 'none', title: '', reason: '' }
}

const reviewTimers = new Map()
const COMPACT_POLL_MS = 180
const COMPACT_IDLE_WAIT_MS = 15_000

async function waitUntilAgentIdle(getStatusFn, timeoutMs = COMPACT_IDLE_WAIT_MS, pollMs = COMPACT_POLL_MS) {
  const deadline = Date.now() + Math.max(200, timeoutMs)
  while (Date.now() < deadline) {
    let status = 'idle'
    try { status = getStatusFn() || 'idle' } catch {}
    if (status !== 'running') return true
    await new Promise(resolve => setTimeout(resolve, pollMs))
  }
  try {
    return (getStatusFn() || 'idle') !== 'running'
  } catch {
    return false
  }
}

function measureAgentSessionTokensFallback(agent) {
  if (!agent || !agent.session) return null
  try {
    let totalTokens = 0
    let seq = 0
    let contextWindow = 128_000
    if (typeof agent.session.ownEvents === 'function') {
      const events = agent.session.ownEvents() || []
      seq = events.length
      for (let i = events.length - 1; i >= 0; i -= 1) {
        const ev = events[i]
        const usage = ev && (ev.usage || (ev.message && ev.message.usage) || (ev.data && ev.data.usage))
        if (usage && typeof usage === 'object') {
          const calc = (Number(usage.inputTokens) || 0)
            + (Number(usage.cacheReadTokens) || 0)
            + (Number(usage.outputTokens) || 0)
          totalTokens = Number(usage.totalTokens) || calc
          if (Number(usage.contextWindow) > 0) contextWindow = Number(usage.contextWindow)
          if (totalTokens > 0) break
        }
      }
    }
    return totalTokens > 0 ? { totalTokens, contextWindow, seq } : null
  } catch {
    return null
  }
}

/** Record a visible confirmation card in Chief's right-panel chat when autonomous smart compaction finishes. */
function recordSmartCompactionChatReceipt(rootId, { cRes, ratioPct = 0, totalTokens = 0, contextWindow = 0, via = '✦ 智选压缩' } = {}) {
  if (!rootId || rootId === 'global' || !cRes || !cRes.ok || cRes.noop) return
  const usageNote = totalTokens > 0 && contextWindow > 0
    ? `（压前占用 ${formatCompactTokenShort(totalTokens)}/${formatCompactTokenShort(contextWindow)} · ${Math.round(ratioPct)}%）`
    : (ratioPct > 0 ? `（压前占用 ${Math.round(ratioPct)}%）` : '')
  const receiptText = `- 【${via}】已先将本轮关键细节抢救入本会话档案柜（#${cRes.harvestId}），并完成主对话静默压缩${usageNote}。`
  mutateChiefState((s) => {
    const ws = ensureWorkspace(s, rootId)
    ws.chat.push({
      id: nextId('chat'),
      role: 'chief',
      text: receiptText,
      actions: ['✦ 智选压缩'],
      at: Date.now(),
    })
    if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
  })
}

/** Shared harvest -> disk verification -> host silent compaction sequence (always harvests into Session Cabinet). */
async function executeHarvestAndCompact(deps, {
  sid,
  rootId,
  agent = null,
  reason = '',
  seq = 0,
  ratioPct = 0,
  totalTokens = 0,
  contextWindow = 0,
  logLabel = '自动压缩',
} = {}) {
  if (!sid || !rootId || rootId === 'global') {
    return { ok: false, noop: true, error: '当前为空白新对话（未绑定活跃主会话），暂无可压缩的历史上下文' }
  }
  const focusHint = reason
    || (ratioPct > 0
      ? `上下文占用 ${Math.round(ratioPct)}%（${totalTokens}/${contextWindow} tokens），压缩前抢救现场细节。`
      : '阶段节点前抢救工程现场细节入本会话档案柜。')
  const harvest = await harvestTurnDetailsToArchive(deps, {
    sessionId: rootId,
    agent,
    vaultScope: 'session',
    trigger: 'pre-compaction',
    focusHint,
  })
  if (!harvest || !harvest.ok || !harvest.savedId) {
    return { ok: false, error: 'harvest-failed-abort-compact', detail: harvest && harvest.error }
  }

  const targetOpt = archiveTargetForRoot(deps, rootId, { vaultScope: 'session' })
  const verified = getArchiveDetail(harvest.savedId, rootId, targetOpt)
  if (!verified || !verified.ok || !verified.item) {
    return { ok: false, error: 'harvest-verify-failed-abort-compact' }
  }

  const cmdId = `dsh-chief-compact-${Date.now().toString(36)}`
  let compactRes
  try {
    compactRes = await deps.compactSessionNow(sid, cmdId)
  } catch (err) {
    const errMsg = (err && err.message) || String(err || 'compaction-failed')
    if (!/busy running/i.test(errMsg)) {
      mutateChiefState((s) => {
        const ws = ensureWorkspace(s, rootId)
        ws.runtimeGuard.pendingSmartCompact = null
      })
    }
    if (typeof deps.appendBoardLog === 'function' && rootId !== 'global') {
      deps.appendBoardLog(
        rootId,
        `⚠️ ${logLabel}未执行（已抢救档案 #${harvest.savedId}，计数未变动）：${errMsg}`,
        'chief',
      )
    }
    return { ok: false, error: errMsg, harvestId: harvest.savedId }
  }

  if (compactRes && compactRes.noop) {
    mutateChiefState((s) => {
      const ws = ensureWorkspace(s, rootId)
      ws.runtimeGuard.pendingSmartCompact = null
    })
    if (typeof deps.appendBoardLog === 'function' && rootId !== 'global') {
      deps.appendBoardLog(
        rootId,
        `🗄️ ${logLabel}：已先抢救细节入本会话档案柜（#${harvest.savedId}），宿主历史暂无需压缩`,
        'chief',
      )
    }
    return {
      ok: true,
      noop: true,
      harvestId: harvest.savedId,
      ratioPct: Math.round(ratioPct),
      compactRes,
    }
  }

  mutateChiefState((s) => {
    const ws = ensureWorkspace(s, rootId)
    ws.runtimeGuard.lastCompactedSeq = seq > 0 ? seq : ((ws.runtimeGuard.lastCompactedSeq || 0) + 1)
    ws.runtimeGuard.lastCompactedAt = Date.now()
    ws.runtimeGuard.autoCompactCount = (ws.runtimeGuard.autoCompactCount || 0) + 1
    ws.runtimeGuard.pendingSmartCompact = null
  })

  if (typeof deps.appendBoardLog === 'function' && rootId !== 'global') {
    deps.appendBoardLog(
      rootId,
      `🗜️ ${logLabel}：已先抢救细节入本会话档案柜（#${harvest.savedId}）并执行静默压缩${ratioPct > 0 ? `（占 ${Math.round(ratioPct)}%）` : ''}`,
      'chief',
    )
  }
  return {
    ok: true,
    noop: false,
    harvestId: harvest.savedId,
    ratioPct: Math.round(ratioPct),
    compactRes,
  }
}

/** Called by Lead via `chief_board({ action: "context.compact", text })` when `✦ 智选` co-management is enabled. */
export async function requestSmartCompactFromLead(deps, {
  sessionId = '',
  reason = '',
  by = 'lead',
} = {}) {
  const sid = String(sessionId || '').trim()
  if (!sid) return { ok: false, error: '当前未绑定具体会话，无法发起智选压缩' }
  const rootId = (deps && deps.resolveRootSessionId ? deps.resolveRootSessionId(sid) : '') || sid
  const state = loadChiefState()
  const effCfg = resolveWorkspaceConfig(state, rootId)
  const tactical = normalizeTacticalModes(effCfg.tacticalModes)
  if (!tactical.smartCompact && !tactical.autoCompact) {
    return { ok: false, error: '当前未开启「✦ 智选」或自动压缩模式，请先在战术菜单打开开关' }
  }

  const cleanReason = clamp(reason || '主会话判断阶段已收口，主动协同发起归档压缩', 240)
  mutateChiefState((s) => {
    const ws = ensureWorkspace(s, rootId)
    ws.runtimeGuard.pendingSmartCompact = {
      at: Date.now(),
      reason: cleanReason,
      by: clamp(by || 'lead', 40),
    }
  })

  let status = 'idle'
  try {
    if (deps && typeof deps.getAgentStatus === 'function') {
      status = deps.getAgentStatus(sid) || 'idle'
    }
  } catch {}

  if (status === 'running' || !deps || typeof deps.compactSessionNow !== 'function') {
    return {
      ok: true,
      queued: true,
      reason: cleanReason,
      message: '已登记主会话的智选归档压缩请求，本轮收口空闲后将由参谋长抢救细节入本会话档案柜并静默压缩。',
    }
  }

  let usage = null
  try {
    if (typeof deps.measureSessionTokens === 'function') {
      usage = await deps.measureSessionTokens(sid)
    }
  } catch {}
  const contextWindow = Math.max(1000, Number(usage && usage.contextWindow) || 128_000)
  const totalTokens = Number(usage && usage.totalTokens) || 0
  const seq = Math.max(0, Math.round(Number(usage && usage.seq) || 0))
  const ratioPct = totalTokens > 0 ? (totalTokens / contextWindow) * 100 : 0

  const execRes = await executeHarvestAndCompact(deps, {
    sid,
    rootId,
    reason: cleanReason,
    seq,
    ratioPct,
    totalTokens,
    contextWindow,
    logLabel: '✦ 智选压缩(主会话协同)',
  })
  return { ...execRes, compacted: Boolean(execRes && execRes.ok), reason: cleanReason }
}

/**
 * Post-Turn Auto-Compaction Pipeline (strict safety contract):
 * 1. NEVER run inside synchronous `turn-stopping` or while agent.status === 'running'. Wait for idle first.
 * 2. When `smartCompact` (`✦ 智选`) is enabled, hard `compactThresholdPct` is bypassed completely!
 *    Compaction runs ONLY on `pendingSmartCompact` (from Lead or Chief) or Chief's `shouldCompactNow` judgment.
 * 3. Always harvest into Session Cabinet + verify on disk BEFORE calling `compactSessionNow`.
 */
export async function maybeRunPreCompaction(deps, {
  agent = null,
  sessionId = '',
  rootId: explicitRootId = '',
  bypassIdleWait = false,
} = {}) {
  const sid = String(sessionId || (agent && agent.id) || '').trim()
  if (!sid) return { ok: false, skipped: 'no-session' }
  const rootId = explicitRootId || (deps && deps.resolveRootSessionId ? deps.resolveRootSessionId(sid, agent) : '') || sid

  const state = loadChiefState()
  const effCfg = resolveWorkspaceConfig(state, rootId)
  if (effCfg.stopped || effCfg.paceMode === 'stopped') {
    return { ok: false, skipped: 'chief-stopped' }
  }
  const tactical = normalizeTacticalModes(effCfg.tacticalModes)
  const wsSnapshot = ensureWorkspace(state, rootId)
  const hasAck = hasValidChiefRiskAck(wsSnapshot)
  const permMode = normalizePermissionMode(effCfg.permissionMode, { requireAck: true, hasChiefRiskAck: hasAck })
  const pendingSmart = wsSnapshot.runtimeGuard && wsSnapshot.runtimeGuard.pendingSmartCompact

  if (!pendingSmart && !tactical.autoCompact && !tactical.smartCompact) {
    return { ok: false, skipped: 'disabled' }
  }
  if (!deps || typeof deps.compactSessionNow !== 'function') return { ok: false, skipped: 'no-compaction-service' }

  if (permMode === 'advisor' || permMode === 'assistant') {
    return { ok: false, skipped: 'permission-mode', permissionMode: permMode }
  }

  // When `✦ 智选` is enabled and no pending smart request exists, hard threshold does NOT trigger!
  if (!pendingSmart && tactical.smartCompact) {
    return { ok: false, skipped: 'smart-compact-mode', mode: 'smart' }
  }

  const getStatus = () => {
    if (typeof deps.getAgentStatus === 'function') return deps.getAgentStatus(sid)
    return (agent && agent.status) || 'idle'
  }
  if (getStatus() === 'running') {
    if (bypassIdleWait) return { ok: false, skipped: 'running' }
    const becameIdle = await waitUntilAgentIdle(getStatus)
    if (!becameIdle) return { ok: false, skipped: 'busy-running' }
  }

  let usage = null
  try {
    usage = typeof deps.measureSessionTokens === 'function'
      ? await deps.measureSessionTokens(sid, agent)
      : measureAgentSessionTokensFallback(agent)
  } catch {}

  if (pendingSmart) {
    const contextWindow = Math.max(1000, Number(usage && usage.contextWindow) || 128_000)
    const totalTokens = Number(usage && usage.totalTokens) || 0
    const seq = Math.max(0, Math.round(Number(usage && usage.seq) || 0))
    const ratioPct = totalTokens > 0 ? (totalTokens / contextWindow) * 100 : 0
    if (permMode === 'strategist') {
      const dedupeKey = `auto_compact:smart:${sid}:${pendingSmart.at || seq}`
      const apr = queueChiefApproval(rootId, {
        category: 'main_workflow',
        operationLabel: '✦ 智选压缩主对话上下文 (/compact)',
        targetLabel: '当前主会话',
        reason: pendingSmart.reason || '主会话/参谋评估阶段收口，请求压缩历史上下文',
        impact: '将先抢救现场细节入本会话档案柜，再静默压缩主对话历史',
        dedupeKey,
        kind: 'compact',
        payload: { reason: pendingSmart.reason || '✦ 智选协同触发压缩' },
        by: pendingSmart.by || 'chief',
      })
      return { ok: false, pendingApproval: true, approvalId: apr && apr.id, skipped: 'pending-approval' }
    }
    const out = await executeHarvestAndCompact(deps, {
      sid,
      rootId,
      agent,
      reason: pendingSmart.reason || '主会话/参谋长智选协同触发压缩',
      seq,
      ratioPct,
      totalTokens,
      contextWindow,
      logLabel: '✦ 智选压缩',
    })
    const actuallyCompacted = Boolean(out && out.ok && !out.noop)
    if (actuallyCompacted) {
      recordSmartCompactionChatReceipt(rootId, {
        cRes: out,
        ratioPct,
        totalTokens,
        contextWindow,
        via: '✦ 智选压缩',
      })
    }
    return { ...out, smartCompacted: actuallyCompacted }
  }

  if (!usage || !Number(usage.totalTokens)) {
    return { ok: false, skipped: 'no-token-usage' }
  }
  const contextWindow = Math.max(1000, Number(usage.contextWindow) || 128_000)
  const totalTokens = Number(usage.totalTokens) || 0
  const seq = Math.max(0, Math.round(Number(usage.seq) || 0))
  const ratioPct = (totalTokens / contextWindow) * 100
  const lastSeq = (wsSnapshot.runtimeGuard && wsSnapshot.runtimeGuard.lastCompactedSeq) || 0

  const thresholdMode = tactical.compactThresholdMode === 'tokens' ? 'tokens' : 'pct'
  let limitHint = ''
  if (thresholdMode === 'tokens') {
    const thresholdTokens = Math.max(COMPACT_TOKEN_HARD_MIN, Number(tactical.compactThresholdTokens) || 64_000)
    if (totalTokens < thresholdTokens) {
      return {
        ok: false,
        skipped: 'below-threshold',
        mode: 'tokens',
        totalTokens,
        thresholdTokens,
        thresholdInput: formatCompactTokenShort(thresholdTokens),
        ratioPct: Math.round(ratioPct),
      }
    }
    limitHint = `上下文占用 ${formatCompactTokenShort(totalTokens)} 已达到自定阈值 ${formatCompactTokenShort(thresholdTokens)}`
  } else {
    const minPct = Math.max(COMPACT_THRESHOLD_MIN_PCT, Number(tactical.compactThresholdPct) || 80)
    if (ratioPct < minPct) {
      return {
        ok: false,
        skipped: 'below-threshold',
        mode: 'pct',
        ratioPct: Math.round(ratioPct),
        thresholdPct: minPct,
      }
    }
    limitHint = `上下文占用已达 ${Math.round(ratioPct)}%（阈值 ${minPct}%，${totalTokens}/${contextWindow} tokens）`
  }

  if (seq > 0 && seq <= lastSeq) {
    return { ok: false, skipped: 'already-compacted-seq', seq, lastSeq }
  }

  if (permMode === 'strategist') {
    const dedupeKey = `auto_compact:thresh:${sid}:${seq || Math.round(ratioPct)}`
    const apr = queueChiefApproval(rootId, {
      category: 'main_workflow',
      operationLabel: '自动抢救并压缩主对话上下文 (/compact)',
      targetLabel: '当前主会话',
      reason: `${limitHint}，L2 参谋模式需您逐项授权后执行压缩。`,
      impact: '将先抢救细节入本会话档案柜，随后压缩裁剪主对话历史上下文',
      dedupeKey,
      kind: 'compact',
      payload: { reason: `${limitHint}，压缩前抢救现场细节。` },
      by: 'chief',
    })
    return { ok: false, pendingApproval: true, approvalId: apr && apr.id, skipped: 'pending-approval' }
  }

  return executeHarvestAndCompact(deps, {
    sid,
    rootId,
    agent,
    reason: `${limitHint}，压缩前抢救现场细节。`,
    seq,
    ratioPct,
    totalTokens,
    contextWindow,
    logLabel: '自动压缩',
  })
}

function extractLatestTurnDigest(agent, turn) {
  if (!agent || !agent.session) return null
  try {
    if (typeof agent.session.deriveMessages === 'function') {
      const msgs = agent.session.deriveMessages() || []
      let latestUserPrompt = ''
      for (let i = msgs.length - 1; i >= 0; i -= 1) {
        const um = msgs[i]
        if (!um || um.role !== 'user') continue
        if (um.source && um.source.kind && um.source.kind !== 'user') continue
        const uBlocks = Array.isArray(um.content) ? um.content : []
        const uTxt = uBlocks
          .filter(b => b && b.type === 'text' && typeof b.text === 'string')
          .map(b => b.text)
          .join('\n')
          .trim()
        if (uTxt && !isInternalCheckpointNoise(uTxt)) {
          latestUserPrompt = clamp(uTxt, 1000)
          break
        }
      }

      const tail = msgs.slice(-6)
      const lines = []
      let hasUser = false
      for (const m of tail) {
        if (!m || !m.role) continue
        if (m.source && m.source.kind && m.source.kind !== 'user' && m.role === 'user') continue
        const blocks = Array.isArray(m.content) ? m.content : []
        const txt = blocks
          .filter(b => b && b.type === 'text' && typeof b.text === 'string')
          .map(b => b.text)
          .join('\n')
          .trim()
        if (!txt || isInternalCheckpointNoise(txt)) continue
        if (m.role === 'user') {
          hasUser = true
          lines.push('User: ' + clamp(txt, 1200))
        } else if (m.role === 'assistant') {
          lines.push('Assistant: ' + clamp(txt, 900))
        }
      }
      if (lines.length > 0) return { text: lines.join('\n'), hasUser, latestUserPrompt, stamp: msgs.length }
    }
  } catch {}
  return null
}

const lastReviewAtByRoot = new Map()

export function scheduleChiefTurnReview(deps, { agent, sessionId, turn }) {
  const sid = String(sessionId || (agent && agent.id) || '').trim()
  if (!sid) return
  // Never waste tokens reviewing internal mnemon checkpoint / probe subagents
  if (/^mnemon-(?:review|run)/i.test(sid) || /^mnemon-(?:review|run)/i.test(String((agent && agent.name) || ''))) {
    return
  }
  const state = loadChiefState()
  const rootKey = (deps && deps.resolveRootSessionId ? deps.resolveRootSessionId(sid, agent) : '') || sid
  const effCfg = resolveWorkspaceConfig(state, rootKey)
  const paceMode = effCfg.paceMode || 'manual'
  if (effCfg.stopped || paceMode === 'stopped') {
    clearTimeout(reviewTimers.get(rootKey))
    reviewTimers.delete(rootKey)
    return
  }
  const tactical = normalizeTacticalModes(effCfg.tacticalModes)
  const wsSnap = state.workspaces && state.workspaces[rootKey] ? state.workspaces[rootKey] : null
  const pendingSmart = Boolean(wsSnap && wsSnap.runtimeGuard && wsSnap.runtimeGuard.pendingSmartCompact)
  const board = deps && deps.boardForSession && deps.boardFileFor
    ? deps.boardForSession(deps.boardFileFor(rootKey))
    : null
  const isGoalMode = Boolean(board && board.mode === 'goal')
  const hasHighPriorityChannel = isGoalMode || tactical.autoCompact || tactical.smartCompact || pendingSmart || tactical.intervention || tactical.redlineSentinel || tactical.strictVerify

  // Default 'manual' mode without tactical/goal active: ZERO background LLM calls!
  if (!hasHighPriorityChannel && (paceMode === 'manual' || effCfg.autoReview === false)) return

  clearTimeout(reviewTimers.get(rootKey))
  const delayMs = hasHighPriorityChannel ? 1_200 : REVIEW_DELAY_MS
  const timer = setTimeout(() => {
    reviewTimers.delete(rootKey)
    runTurnReview(deps, { agent, sessionId: sid, turn }).catch(() => {})
  }, delayMs)
  timer.unref?.()
  reviewTimers.set(rootKey, timer)
}

export async function runTurnReview(deps, { agent, sessionId, turn, force = false }) {
  const sid = String(sessionId || (agent && agent.id) || '').trim()
  if (!sid) return { ok: false, skipped: 'no-session' }
  const rootId = (deps.resolveRootSessionId && deps.resolveRootSessionId(sid, agent)) || sid

  const stateBefore = loadChiefState()
  const effCfgBefore = resolveWorkspaceConfig(stateBefore, rootId)
  const tactical = normalizeTacticalModes(effCfgBefore.tacticalModes)
  const paceMode = effCfgBefore.paceMode || 'manual'
  if (!force && (effCfgBefore.stopped || paceMode === 'stopped')) {
    return { ok: false, skipped: 'chief-stopped' }
  }
  const wsBefore = ensureWorkspace(stateBefore, rootId)
  const board = deps.boardForSession && deps.boardFileFor
    ? deps.boardForSession(deps.boardFileFor(rootId))
    : null
  const isGoalMode = Boolean(board && board.mode === 'goal')
  const pendingSmart = Boolean(wsBefore.runtimeGuard && wsBefore.runtimeGuard.pendingSmartCompact)
  const smartCoManaged = Boolean(tactical.smartCompact)
  const hasHighPriority = isGoalMode || tactical.intervention || tactical.redlineSentinel || tactical.strictVerify || tactical.autoCompact || tactical.smartCompact || pendingSmart

  if (!force && !hasHighPriority && paceMode === 'manual') {
    return { ok: false, skipped: 'manual' }
  }

  // Always check pre-compaction pipeline first when autoCompact/smartCompact/pendingSmartCompact is active
  if (tactical.autoCompact || tactical.smartCompact || pendingSmart) {
    const preRes = await maybeRunPreCompaction(deps, { agent, sessionId: sid, rootId, bypassIdleWait: Boolean(force) })
      .catch((err) => {
        const msg = (err && err.message) || String(err || 'pre-compact-error')
        if (typeof deps.appendBoardLog === 'function' && rootId !== 'global') {
          deps.appendBoardLog(rootId, `⚠️ 自动压缩检测异常：${msg}`, 'chief')
        }
        return { ok: false, error: msg }
      })
    if (preRes && preRes.ok && preRes.smartCompacted) {
      return { ok: true, smartCompacted: true, harvestId: preRes.harvestId }
    }
  }

  // If ONLY fixed-threshold autoCompact was on (without smartCompact or supervisor/pace), exit cleanly here
  const needsSupervisorLlm = isGoalMode || tactical.intervention || tactical.redlineSentinel || tactical.strictVerify || smartCoManaged || paceMode !== 'manual'
  if (!force && !needsSupervisorLlm) return { ok: true, onlyCompactionChecked: true }

  const digest = extractLatestTurnDigest(agent, turn)
  if (!digest || !digest.text) return { ok: false, skipped: 'no-digest' }

  const cursorKey = `${sid}`
  if (!force && wsBefore.reviewCursors[cursorKey] === digest.stamp) {
    return { ok: false, skipped: 'same-stamp' }
  }

  const identity = deps.resolveAgentIdentity ? deps.resolveAgentIdentity(deps.runtime, sid, agent) : null
  if (identity && /^mnemon-(?:review|run)/i.test(String(identity.self || ''))) return { ok: false, skipped: 'mnemon' }

  const hasWallCue = /(?:permission denied|eacces|eperm|forbidden|blocked|not allowed|sandbox|read-only|撞墙|受阻|权限拒绝|越界)/i.test(digest.text)
  const now = Date.now()
  const lastAt = Number(lastReviewAtByRoot.get(rootId) || 0)
  const cooldownMs = hasHighPriority
    ? (smartCoManaged && !isGoalMode && !tactical.intervention ? 12_000 : 4_000)
    : (paceMode === 'smart' ? (hasWallCue ? 45_000 : SMART_REVIEW_COOLDOWN_MS) : AUTO_REVIEW_COOLDOWN_MS)
  if (!force && now - lastAt < cooldownMs) return { ok: false, skipped: 'cooldown' }

  // Wait if supervisor/goal/smart-compact is active so turn-stopping settles to idle before evaluating usage
  if ((tactical.intervention || isGoalMode || smartCoManaged) && typeof deps.getAgentStatus === 'function' && !force) {
    await waitUntilAgentIdle(() => deps.getAgentStatus(sid), 5_000, 150)
  }

  const directory = await listPeerDirectory(deps, rootId)
  const realPeers = directory.targets.filter(t => !/^mnemon-(?:review|run)/i.test(String(t.name || t.handle || '')))

  let liveUsage = null
  if (smartCoManaged) {
    try {
      liveUsage = typeof deps.measureSessionTokens === 'function'
        ? await deps.measureSessionTokens(sid, agent)
        : measureAgentSessionTokensFallback(agent)
    } catch {}
  }

  // In 'smart' background mode (without supervisor/goal), gate LLM call on wall cue or multi-agent human turn;
  // when ONLY smartCoManaged is enabled in manual pace, evaluate only after enough turns or context pressure.
  if (!force && !isGoalMode && !tactical.intervention && !tactical.redlineSentinel && !tactical.strictVerify) {
    if (smartCoManaged && paceMode === 'manual') {
      const ratio = liveUsage && liveUsage.contextWindow ? (Number(liveUsage.totalTokens) || 0) / Number(liveUsage.contextWindow) : 0
      const sinceCompact = now - ((wsBefore.runtimeGuard && wsBefore.runtimeGuard.lastCompactedAt) || 0)
      if ((digest.stamp < 4 && ratio < 0.25) || sinceCompact < 20_000) {
        return { ok: false, skipped: 'smart-compact-light' }
      }
    } else {
      if (paceMode === 'smart' && !hasWallCue && !(digest.hasUser && realPeers.length > 1)) {
        return { ok: false, skipped: 'smart-quiet' }
      }
      if (!digest.hasUser && realPeers.length <= 1 && !hasWallCue) return { ok: false, skipped: 'single-quiet' }
    }
  }

  if (!deps.callLlmOverride) {
    const modelsInfo = await listChiefModels(deps, false, rootId)
    if (!modelsInfo.available) return { ok: false, skipped: 'no-models' }
  }

  lastReviewAtByRoot.set(rootId, now)
  const speaker = identity && identity.isChild ? `子代理 @${identity.self}` : '主对话 (@lead)'
  const view = clusterView(stateBefore, rootId)
  const numberedFacts = view.facts.slice()
  const bounds = (board && board.bounds) || { allowed: [], forbidden: [], notes: [] }
  const planSteps = Array.isArray(board && board.plan) ? board.plan : []
  const tasks = Array.isArray(board && board.tasks) ? board.tasks : []

  const activeTargets = realPeers.filter(t => t.key === 'lead' || t.status === 'running').slice(0, 10)
  const idleCount = Math.max(0, realPeers.length - activeTargets.length)
  const activeFlags = [
    isGoalMode ? 'GOAL_MODE' : '',
    tactical.intervention ? 'INTERVENTION_SUPERVISOR' : '',
    smartCoManaged ? 'SMART_COMPACT_CO_MANAGED' : '',
    tactical.strictVerify ? 'STRICT_VERIFY' : '',
    tactical.redlineSentinel ? 'REDLINE_SENTINEL' : '',
    tactical.conciseBrief ? 'CONCISE_BRIEF_3_BULLETS' : '',
    Boolean(paceMode === 'auto' && effCfgBefore.autoPilot && !effCfgBefore.stopped) ? 'AUTO_PILOT_SESSION_ONLY' : '',
  ].filter(Boolean)

  const smartUsageHint = smartCoManaged
    ? `智选共管状态（硬阈值已停用）：消息序号≈${digest.stamp}${liveUsage && liveUsage.totalTokens ? `，当前估算上下文 ${liveUsage.totalTokens}/${liveUsage.contextWindow} (${Math.round((liveUsage.totalTokens / liveUsage.contextWindow) * 100)}%)` : ''}`
    : ''

  const prompt = [
    `当前激活监督模式：${activeFlags.join(' | ') || paceMode}`,
    ...(smartUsageHint ? [smartUsageHint] : []),
    `工作区总目标 (Objective)：${(board && board.objective) || '（暂未开启 /goal 固定目标 — 请对照下方最新用户原始诉求核验完成度）'}`,
    `最新用户原始诉求：${digest.latestUserPrompt || '（见下方对话片段）'}`,
    `当前计划步骤 (Plan)：${planSteps.length ? planSteps.map((s, i) => `${i + 1}.${s.done ? '[✓]' : '[ ]'} ${clamp(s.text, 60)}`).join('；') : '（空）'}`,
    `当前任务列表 (Tasks)：${tasks.length ? tasks.slice(0, 10).map(t => `[${t.status}] #${t.id} ${clamp(t.title, 48)}`).join('；') : '（空）'}`,
    `刚刚结束回合的对话身份：${speaker}（sessionId=${sid}）`,
    `活跃团队成员：${activeTargets.map(t => `${t.handle}[key=${t.key}, ${t.status}${t.taskTitle ? ', 任务:' + t.taskTitle : ''}]`).join('；')}${idleCount > 0 ? `（另有 ${idleCount} 名空闲子代理已折叠）` : ''}`,
    '',
    '已有工作边界（禁止红线严防撞穿；必做事项提交结项前须逐项核验是否完成）：',
    `- 禁止：${(bounds.forbidden || []).join('；') || '（暂无）'}`,
    `- 必做事项 (allowed · 必须交付确认)：${(bounds.allowed || []).join('；') || '（暂无）'}`,
    `- 注意：${(bounds.notes || []).join('；') || '（暂无）'}`,
    '',
    '已有持久记忆条目：',
    ...(numberedFacts.length ? numberedFacts.map((f, i) => `[${i + 1}] (${f.category}) ${f.text}`) : ['（暂无）']),
    '',
    '本轮最新对话片段：',
    digest.text,
  ].join('\n')

  const res = await callChiefLlm(deps, {
    sessionId: rootId,
    system: TURN_REVIEW_SYSTEM,
    prompt,
    maxTokens: SUMMARY_MAX_TOKENS,
  })
  if (!res.ok) return { ok: false, error: res.error }

  const parsed = extractJsonObject(res.text)
  if (!parsed) return { ok: false, error: 'non-json-review' }

  const cfgNow = resolveWorkspaceConfig(loadChiefState(), rootId)
  const wsNowPerm = ensureWorkspace(loadChiefState(), rootId)
  const hasAckNow = hasValidChiefRiskAck(wsNowPerm)
  const permNow = normalizePermissionMode(cfgNow.permissionMode, { requireAck: true, hasChiefRiskAck: hasAckNow })
  const permRankNow = permissionRank(permNow)
  const autoPilot = Boolean(cfgNow.paceMode === 'auto' && cfgNow.autoPilot && !cfgNow.stopped)
  const rawSuggestions = (Array.isArray(parsed.suggestions) ? parsed.suggestions : [])
    .map(raw => normalizeSuggestion({ ...raw, fromAgent: raw?.fromAgent || speaker }))
    .filter(Boolean)
    .slice(0, 1)

  // Stale plan check & auto-reconcile (L1+ only; L0 Advisor is strictly read-only)
  const isStalePlan = Boolean(parsed.planAssessment && parsed.planAssessment.stale)
  const parsedBoardOps = Array.isArray(parsed.boardOps) ? parsed.boardOps.slice() : []
  if (permRankNow >= 1 && isStalePlan && !parsedBoardOps.some(op => op && (op.op === 'plan.resetForGoal' || op.op === 'plan.set'))) {
    parsedBoardOps.unshift({ op: 'plan.resetForGoal' })
  }
  const executedOps = permRankNow >= 1 && parsedBoardOps.length > 0 && deps.runAction
    ? applyBoardOps(deps, rootId, parsedBoardOps, { forceSessionOnly: autoPilot })
    : []

  const unmetMustDo = Array.isArray(parsed.unmetMustDo)
    ? parsed.unmetMustDo.map(x => clamp(String(x || '').trim(), 140)).filter(Boolean).slice(0, 6)
    : []
  const hazardInfo = detectEmergencyHazardFallback({
    parsed,
    digestText: digest.text,
    bounds,
    isInterventionActive: Boolean(tactical.intervention || autoPilot),
  })
  const hasObjectiveTarget = Boolean(board && String(board.objective || '').trim())
  const evalGoalCompletion = isGoalMode || (Boolean(tactical.intervention) && hasObjectiveTarget)
  const isGoalAchieved = !hazardInfo.triggered
    && evalGoalCompletion
    && String(parsed.goalStatus || '') === 'achieved'
    && unmetMustDo.length === 0
  let goalProposalCreated = false
  if (permRankNow >= 1 && isGoalAchieved && deps.runAction && hasObjectiveTarget) {
    const existingApproval = board && board.goalApproval
    const alreadyPendingSame = existingApproval
      && existingApproval.status === 'pending'
      && existingApproval.objective === board.objective
    if (!alreadyPendingSame) {
      const propRes = deps.runAction({
        action: 'goal.proposeApproval',
        objective: board.objective || '',
        summary: cleanMultiline(parsed.goalSummary || '核心目标及必做事项验证均已完成，建议结项。', 320),
        evidence: cleanMultiline(parsed.goalEvidence || '', 420),
        session: rootId,
        by: 'DSH 参谋长',
      })
      goalProposalCreated = Boolean(propRes && propRes.ok)
    }
  }

  let circuitTripped = false
  let circuitReason = ''
  let hazardStopped = false
  let hazardAlertCreated = null
  let interventionMessage = ''
  let interventionForApproval = ''
  let interventionDedupeKey = ''
  const autoRelays = []
  const relaysForApproval = []
  const autoBoundUpdates = []
  let shouldAutoOrganizeSession = false

  const isInternalRelayTarget = (targetRaw) => {
    const tq = String(targetRaw || '').trim().replace(/^@/, '')
    if (!tq) return false
    const lower = tq.toLowerCase()
    if (['lead', 'main', '主对话', '主代理'].includes(lower)) return true
    return realPeers.some(p =>
      p.kind !== 'peer-session'
      && p.kind !== 'session'
      && (p.key === tq || p.handle === tq || p.id === tq || p.name === tq)
    )
  }

  mutateChiefState((s) => {
    const ws = ensureWorkspace(s, rootId)
    ws.reviewCursors[cursorKey] = digest.stamp
    if (autoPilot) {
      ws.runtimeGuard.autoPilotHadTurn = true
    }
    if (permRankNow >= 1) {
      const activeCluster = getLinkedCluster(s, rootId)
      applyFactChanges(ws, numberedFacts, parsed.memoryChanges, speaker, {
        originRootId: rootId,
        peerRootIds: activeCluster.filter(id => id !== rootId),
      })

      // Goal achieved: create user approval suggestion pill (NEVER exit goal mode automatically!)
      if (isGoalAchieved) {
        const goalSig = crypto
          .createHash('sha1')
          .update(String((board && board.objective) || '') + '|' + String(parsed.goalEvidence || parsed.goalSummary || ''))
          .digest('hex')
          .slice(0, 12)
        const hasPendingGoalSug = ws.suggestions.some(
          sug => sug.status === 'pending' && sug.kind === 'goal_approval',
        )
        if (!hasPendingGoalSug) {
          const goalSug = normalizeSuggestion({
            kind: 'goal_approval',
            fromAgent: '🎯 目标督导参谋',
            title: '🎯 核心目标与必做事项已达成，请示批准结项',
            reason: cleanMultiline(parsed.goalSummary || '主对话已完成当前设定核心目标及全部必做事项，请批示是否结束督导。', 220),
            evidence: cleanMultiline(parsed.goalEvidence || '', 480),
            target: 'board',
            targetLabel: '目标结项',
            mode: 'silent',
            draftText: cleanMultiline(parsed.goalSummary || '批准结项并退出督导模式', 400),
          })
          if (goalSug) ws.suggestions.push(goalSug)
        }
        if (ws.runtimeGuard.lastGoalAchievedSig !== goalSig) {
          ws.runtimeGuard.lastGoalAchievedSig = goalSig
          ws.chat.push({
            id: nextId('chat'),
            role: 'chief',
            text: `- 【🎯 核心目标已达成 · 停止继续推送】${cleanMultiline(parsed.goalSummary || '核心目标与必做事项均已完成并核验通过。', 260)}`,
            actions: ['目标达成收口'],
            at: Date.now(),
          })
          if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
        }
      }

      for (const sug of rawSuggestions) {
        if (sug.kind === 'bound') {
          const colList = Array.isArray(bounds[sug.boundField]) ? bounds[sug.boundField] : []
          if (colList.some(x => String(x).trim() === sug.draftText)) continue
          if (autoPilot && sug.draftText) {
            sug.pinGlobal = false
            sug.status = 'applied'
            autoBoundUpdates.push({ field: sug.boundField, item: sug.draftText })
            continue
          }
        }
        if (autoPilot && sug.kind === 'relay' && sug.draftText && isInternalRelayTarget(sug.target)) {
          if (permNow === 'chief' && hasAckNow) {
            sug.status = 'applied'
            autoRelays.push(sug)
            continue
          } else if (permNow === 'strategist') {
            sug.status = 'applied'
            relaysForApproval.push(sug)
            continue
          }
        }
        const dup = ws.suggestions.some(
          existing => existing.status === 'pending'
            && existing.kind === sug.kind
            && (sug.kind === 'bound'
              ? existing.draftText === sug.draftText
              : (sug.kind === 'advice'
                ? (existing.title === sug.title && existing.draftText === sug.draftText)
                : (existing.target === sug.target && existing.title === sug.title))),
        )
        if (!dup) {
          const pending = ws.suggestions.filter(item => item.status === 'pending')
          if (pending.length >= 5) {
            const victim = pending.find(item => item.kind !== 'bound' && item.kind !== 'goal_approval' && item.kind !== 'advice') || pending[0]
            victim.status = 'dismissed'
          }
          ws.suggestions.push(sug)
        }
      }

      if (autoPilot && rootId && rootId !== 'global') {
        const lastOrgAt = Number(ws.runtimeGuard.lastAutoArchiveOrgAt || 0)
        if (!lastOrgAt || Date.now() - lastOrgAt > 180_000) {
          shouldAutoOrganizeSession = true
        }
      }
    }

    // 0) Emergency hazard / boundary-collision gate takes highest priority under Strong Intervention
    if (hazardInfo.triggered && (tactical.intervention || autoPilot)) {
      hazardStopped = true
      circuitTripped = true
      circuitReason = hazardInfo.reason || hazardInfo.title
      if (!ws.config || typeof ws.config !== 'object') ws.config = resolveWorkspaceConfig(s, rootId)
      ws.config.tacticalModes = {
        ...normalizeTacticalModes(ws.config.tacticalModes),
        intervention: false,
      }
      s.config.tacticalModes = {
        ...normalizeTacticalModes(s.config.tacticalModes),
        intervention: false,
      }
      hazardAlertCreated = {
        id: nextId('hazard'),
        category: hazardInfo.category || 'irreversible_risk',
        title: hazardInfo.title || '强介入紧急煞车 · 已停止推进',
        reason: hazardInfo.reason || '继续推进可能造成不可逆损失或必然撞穿工作边界，已立即停止强介入。',
        objective: clamp((board && board.objective) || '', 300),
        at: Date.now(),
      }
      ws.runtimeGuard.hazardAlert = hazardAlertCreated
      ws.runtimeGuard.circuitBroken = true
      ws.runtimeGuard.circuitReason = hazardAlertCreated.reason
      ws.runtimeGuard.interventionTurns = 0
      ws.runtimeGuard.unchangedCount = 0
      interventionMessage = ''
      ws.chat.push({
        id: nextId('chat'),
        role: 'chief',
        text: `- 【🚨 紧急煞车 · 强介入已停】${hazardAlertCreated.title}\n  理由：${hazardAlertCreated.reason}`,
        actions: ['高危急停'],
        at: Date.now(),
      })
      if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
      pushAuditToWs(ws, { mode: permNow, stage: 'safety_guard', decision: 'hazard_stop', operation: '强介入紧急煞车', target: 'lead', reason: hazardAlertCreated.reason, outcome: 'blocked', by: 'chief' })
    } else {
      // Intervention Supervisor follow-up + Circuit Breaker (differentiated across L0 / L1 / L2 / L3)
      const unmetMustDoFallback = unmetMustDo.length > 0
        ? '当前尚有以下【必做事项】未确认交付或缺少验证证据，请逐项补齐并交卷：\n' + unmetMustDo.map((u, idx) => `${idx + 1}. ${u}`).join('\n')
        : ''
      const candidateIntervention = parsed.interventionText
        || unmetMustDoFallback
        || (parsed.nextActionForLead && (parsed.shouldIntervene || parsed.goalStatus === 'in_progress') ? parsed.nextActionForLead : '')
      if (!isGoalAchieved && tactical.intervention && (parsed.shouldIntervene || parsed.goalStatus === 'in_progress' || unmetMustDo.length > 0) && candidateIntervention) {
        const assistantTail = (digest.text.split('Assistant:').pop() || digest.text)
        const sig = crypto
          .createHash('sha1')
          .update(JSON.stringify({
            objective: (board && board.objective) || '',
            goalStatus: parsed.goalStatus || '',
            donePlanCount: planSteps.filter(p => p.done).length,
            doneTaskCount: tasks.filter(t => t.status === 'done').length,
            blockedTaskCount: tasks.filter(t => t.status === 'blocked').length,
            assistantTail: clamp(assistantTail, 140),
          }))
          .digest('hex')
          .slice(0, 12)

        const prevSig = ws.runtimeGuard.lastDigestHash
        const nextUnchanged = prevSig === sig ? (ws.runtimeGuard.unchangedCount + 1) : 1
        const nextTurns = ws.runtimeGuard.interventionTurns + 1
        const isUnlimitedTurns = tactical.maxInterventionTurns === 0
        const maxTurns = isUnlimitedTurns ? Infinity : Math.max(1, Number(tactical.maxInterventionTurns) || 10)
        const unchangedLimit = isUnlimitedTurns ? 8 : 3

        if ((!isUnlimitedTurns && nextTurns > maxTurns) || nextUnchanged >= unchangedLimit) {
          circuitTripped = true
          circuitReason = !isUnlimitedTurns && nextTurns > maxTurns
            ? `接管督导连续介入已达上限 (${maxTurns} 轮)，触发安全熔断，已自动退回人工监督。`
            : `连续 ${unchangedLimit} 轮检测进展无实质变化，触发死循环熔断，已自动关闭接管督导并交还用户控制。`
          if (!ws.config || typeof ws.config !== 'object') ws.config = resolveWorkspaceConfig(s, rootId)
          ws.config.tacticalModes = {
            ...normalizeTacticalModes(ws.config.tacticalModes),
            intervention: false,
          }
          s.config.tacticalModes = {
            ...normalizeTacticalModes(s.config.tacticalModes),
            intervention: false,
          }
          ws.runtimeGuard.circuitBroken = true
          ws.runtimeGuard.circuitReason = circuitReason
          ws.runtimeGuard.interventionTurns = 0
          ws.runtimeGuard.unchangedCount = 0
          ws.chat.push({
            id: nextId('chat'),
            role: 'chief',
            text: `- 【⚠️ 安全熔断】${circuitReason}`,
            actions: ['熔断停机'],
            at: Date.now(),
          })
          if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
        } else {
          ws.runtimeGuard.lastDigestHash = sig
          ws.runtimeGuard.unchangedCount = nextUnchanged
          ws.runtimeGuard.interventionTurns = nextTurns
          ws.runtimeGuard.circuitBroken = false
          ws.runtimeGuard.circuitReason = ''
          const cleanBody = cleanMultiline(candidateIntervention, tactical.conciseBrief ? 420 : 1200)

          if (permRankNow === 0) {
            // L0 Advisor: strict read-only inspection brief in panel chat only (never touches board or @lead)
            if (prevSig !== sig || nextTurns === 1) {
              ws.chat.push({
                id: nextId('chat'),
                role: 'chief',
                text: `- 【👁 L0 顾问只读督导巡检】目标核验状态：\`${parsed.goalStatus || 'in_progress'}\`\n- 【诊断与建议】${clamp(cleanBody, 280)}`,
                actions: ['L0 只读巡检', '建议不下发'],
                at: Date.now(),
              })
              if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
            }
            pushAuditToWs(ws, { mode: permNow, stage: 'permission_gate', decision: 'readonly_inspection', operation: '强介入只读巡检', target: 'chief_panel', reason: clamp(cleanBody, 120), outcome: 'ok', by: 'chief' })
          } else if (permRankNow === 1) {
            // L1 Assistant: manages internal Chief board/facts/suggestions only; does NOT inject into @lead
            const sug = normalizeSuggestion({
              kind: 'advice',
              fromAgent: '🗂 L1 助手督导建议',
              title: 'L1 强介入建议（等待拍板，未自动递给主对话）',
              reason: clamp(parsed.goalMissing || 'L1 助手模式不接管主代理工作流，您可一键采纳递交主对话。', 200),
              target: 'lead',
              targetLabel: '主对话',
              mode: 'followup',
              draftText: cleanBody,
              popup: false,
            })
            if (sug) ws.suggestions.push(sug)
            ws.chat.push({
              id: nextId('chat'),
              role: 'chief',
              text: `- 【🗂 L1 助手督导建议】已整理本轮看板进展，并生成待采纳推进建议（L1 不自动插话主对话）：\n${clamp(cleanBody, 260)}`,
              actions: ['L1 内务自治', '转人工采纳'],
              at: Date.now(),
            })
            if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
            pushAuditToWs(ws, { mode: permNow, stage: 'permission_gate', decision: 'suggested_only', operation: '强介入转建议卡', target: 'lead', reason: clamp(cleanBody, 120), outcome: 'ok', by: 'chief' })
          } else if (permRankNow === 2) {
            // L2 Strategist: requires explicit user approval popup before sending followup into @lead!
            interventionForApproval = cleanBody
            interventionDedupeKey = `intv:${rootId}:${digest.stamp}:${sig}`
            pushAuditToWs(ws, { mode: permNow, stage: 'permission_gate', decision: 'pending_approval', operation: '强介入督导主对话', target: 'lead', reason: clamp(cleanBody, 120), outcome: 'pending', by: 'chief' })
          } else {
            // L3 Chief of Staff (ack verified): full autonomous intervention
            interventionMessage = cleanBody
            pushAuditToWs(ws, { mode: permNow, stage: 'executor', decision: 'executed', operation: '强介入自动督导推进', target: 'lead', reason: clamp(cleanBody, 120), outcome: 'ok', by: 'chief' })
          }
        }
      }
    }
  })

  if (hazardStopped && deps && typeof deps.cancelAutoContinue === 'function') {
    try { deps.cancelAutoContinue(sid, 'hazard-stop') } catch {}
    if (rootId && rootId !== sid) {
      try { deps.cancelAutoContinue(rootId, 'hazard-stop') } catch {}
    }
  }

  // When both Smart Compact & Intervention trigger on the same turn:
  // L3 runs harvest + compact silently first; L2 queues approval popup; L0/L1 never auto-compact.
  let smartCompacted = false
  if (permRankNow >= 2 && smartCoManaged && parsed.shouldCompactNow === true && typeof deps.compactSessionNow === 'function') {
    const wsNow = ensureWorkspace(loadChiefState(), rootId)
    const lastCompactedAt = (wsNow.runtimeGuard && wsNow.runtimeGuard.lastCompactedAt) || 0
    const sinceLast = Date.now() - lastCompactedAt
    if (force || !lastCompactedAt || sinceLast >= 20_000) {
      const compactReason = clamp(parsed.compactReason || '参谋长评估当前阶段已收口，执行智选归档压缩', 220)
      if (permRankNow === 2) {
        queueChiefApproval(rootId, {
          category: 'main_workflow',
          operationLabel: '✦ 智选压缩主对话上下文 (/compact)',
          targetLabel: '当前主会话',
          reason: compactReason,
          impact: '将先抢救摘要入本会话档案柜，随后压缩裁剪主对话历史',
          dedupeKey: `smart_compact:${rootId}:${wsNow.runtimeGuard.lastCompactedSeq || 0}:${digest.stamp}`,
          kind: 'compact',
          payload: { reason: compactReason },
          by: 'chief',
        })
      } else {
        let st = 'idle'
        try { if (typeof deps.getAgentStatus === 'function') st = deps.getAgentStatus(sid) || 'idle' } catch {}
        if (st === 'running' && !force && typeof deps.getAgentStatus === 'function') {
          await waitUntilAgentIdle(() => deps.getAgentStatus(sid), 8_000, 200)
          try { st = deps.getAgentStatus(sid) || 'idle' } catch {}
        }
        if (st === 'running' && !force) {
          mutateChiefState((s) => {
            const ws = ensureWorkspace(s, rootId)
            ws.runtimeGuard.pendingSmartCompact = { at: Date.now(), reason: compactReason, by: 'chief' }
          })
        } else {
          const contextWindow = Math.max(1000, Number(liveUsage && liveUsage.contextWindow) || 128_000)
          const totalTokens = Number(liveUsage && liveUsage.totalTokens) || 0
          const seq = Math.max(0, Math.round(Number(liveUsage && liveUsage.seq) || digest.stamp || 0))
          const ratioPct = totalTokens > 0 ? (totalTokens / contextWindow) * 100 : 0
          const cRes = await executeHarvestAndCompact(deps, {
            sid,
            rootId,
            agent,
            reason: compactReason,
            seq,
            ratioPct,
            totalTokens,
            contextWindow,
            logLabel: '✦ 智选压缩(参谋长判断)',
          }).catch((err) => {
            const msg = (err && err.message) || String(err || 'smart-compact-error')
            if (typeof deps.appendBoardLog === 'function' && rootId !== 'global') {
              deps.appendBoardLog(rootId, `⚠️ ✦ 智选压缩失败：${msg}`, 'chief')
            }
            return { ok: false, error: msg }
          })
          if (cRes && cRes.ok && !cRes.noop) {
            smartCompacted = true
            recordSmartCompactionChatReceipt(rootId, {
              cRes,
              ratioPct,
              totalTokens,
              contextWindow,
              via: '✦ 智选压缩',
            })
          }
        }
      }
    }
  }

  if (interventionForApproval) {
    queueChiefApproval(rootId, {
      category: 'main_workflow',
      operationLabel: '强介入督导主对话继续推进',
      targetLabel: '主对话 (@lead)',
      reason: '当前处于「L2 · 参谋模式」，强介入向主对话发推进指令前需您逐项授权',
      impact: '点击「允许本次操作」后将立即向主对话唤醒投递以下督导指令',
      preview: clamp(interventionForApproval, 260),
      dedupeKey: interventionDedupeKey,
      kind: 'relay',
      payload: {
        fromSession: rootId,
        fromLabel: 'DSH 参谋 (强介入逐项授权)',
        target: 'lead',
        subject: '参谋强介入督导推进',
        text: interventionForApproval,
        mode: 'followup',
      },
      by: 'chief',
    })
  }

  if (interventionMessage) {
    const tags = [
      tactical.strictVerify ? '严格校验实测' : '',
      tactical.redlineSentinel ? '红线哨兵巡检' : '',
      tactical.conciseBrief ? '精炼要点' : '',
    ].filter(Boolean).join(' · ')
    await deliverCrossMessage(deps, {
      fromSession: rootId,
      fromLabel: `DSH 参谋长 (接管督导${tags ? '·' + tags : ''})`,
      target: 'lead',
      subject: '参谋长自动督导推进',
      text: interventionMessage,
      mode: 'followup',
    })
  }

  if (permRankNow >= 1 && autoBoundUpdates.length > 0 && deps.runAction) {
    for (const b of autoBoundUpdates) {
      deps.runAction({
        action: 'bounds.add',
        field: b.field,
        item: b.item,
        pinned: false,
        session: rootId,
        by: 'DSH 参谋长 (全自动托管)',
      })
      executedOps.push(`本局自动边界(${b.field})：${clamp(b.item, 32)}`)
    }
  }

  if (permRankNow >= 1 && shouldAutoOrganizeSession && rootId && rootId !== 'global') {
    try {
      const sessOpt = archiveTargetForRoot(deps, rootId, { vaultScope: 'session' })
      const stSess = loadArchiveStore(sessOpt)
      const unorgCount = (stSess.items || []).filter(
        it => it.folder === 'inbox' || it.organizedBy !== 'chief' || (it.points || []).length <= 1,
      ).length
      if (unorgCount >= 3) {
        mutateChiefState((s) => {
          const ws = ensureWorkspace(s, rootId)
          ws.runtimeGuard.lastAutoArchiveOrgAt = Date.now()
        })
        await organizeArchivesWithChief(deps, {
          sessionId: rootId,
          vaultScope: 'session',
          scope: 'unorganized',
          instruction: '全自动托管轮后整理本会话未归档记录（仅限本会话）',
        }).catch(() => null)
      }
    } catch {}
  }

  for (const sug of relaysForApproval) {
    queueChiefApproval(rootId, {
      category: 'main_workflow',
      operationLabel: '向工作流成员投递自动指令',
      targetLabel: sug.target === 'lead' ? '主对话 (@lead)' : `@${sug.target}`,
      reason: clamp(sug.title || 'L2 参谋模式逐项授权自动递话', 140),
      impact: '允许后将把该条工作流指令投递给目标成员',
      preview: clamp(sug.draftText || '', 240),
      dedupeKey: `autorelay:${rootId}:${digest.stamp}:${sug.target}`,
      kind: 'relay',
      payload: {
        fromSession: rootId,
        fromLabel: 'DSH 参谋 (逐项授权)',
        target: sug.target,
        subject: sug.title,
        text: sug.draftText,
        mode: sug.mode || 'silent',
      },
      by: 'chief',
    })
  }

  for (const sug of autoRelays) {
    await deliverCrossMessage(deps, {
      fromSession: rootId,
      fromLabel: 'DSH 参谋长 (自动托管)',
      target: sug.target,
      subject: sug.title,
      text: sug.draftText,
      mode: sug.mode || 'silent',
    })
  }

  let autoPilotStopRes = null
  if (autoPilot && !interventionMessage && autoRelays.length === 0 && !circuitTripped) {
    autoPilotStopRes = await checkAndStopIdleAutoPilot(deps, rootId, {
      allowStartupGrace: false,
      directory,
      fromViewCheck: false,
    }).catch(() => null)
  }

  return {
    ok: true,
    permissionMode: permNow,
    executedOps,
    isStalePlan,
    unmetMustDo,
    goalAchieved: isGoalAchieved,
    goalProposalCreated,
    hazardStopped,
    ...(hazardAlertCreated ? { hazardAlert: hazardAlertCreated } : {}),
    intervened: Boolean(interventionMessage),
    queuedInterventionApproval: Boolean(interventionForApproval),
    smartCompacted,
    circuitTripped,
    circuitReason,
    ...(autoPilotStopRes ? { autoPilotStopped: Boolean(autoPilotStopRes.stopped) } : {}),
  }
}

/**
 * Anti-idle safeguard for session-scoped Full Auto-Pilot (`paceMode === 'auto'`):
 * Once Lead and all real non-probe child subagents within THIS session finish working AND
 * the closing narrative digest has finished catching up, automatically stand down to `manual`
 * so Chief never idles/spins indefinitely after work completes.
 */
export async function checkAndStopIdleAutoPilot(deps, sessionId, opts = {}) {
  const sidRaw = String(sessionId || '').trim()
  const rootId = String(
    (deps && typeof deps.resolveRootSessionId === 'function' ? deps.resolveRootSessionId(sidRaw) : sidRaw) || sidRaw || '',
  ).trim()
  if (!rootId || rootId === 'global') {
    return { ok: true, stopped: false, reason: 'not-session' }
  }

  const stBefore = loadChiefState()
  const effBefore = resolveWorkspaceConfig(stBefore, rootId)
  const wsBefore = ensureWorkspace(stBefore, rootId)
  if (effBefore.stopped || effBefore.paceMode !== 'auto' || !effBefore.autoPilot) {
    return { ok: true, stopped: false, reason: 'not-autopilot' }
  }
  if (reviewTimers.has(rootId)) {
    return { ok: true, stopped: false, reason: 'review-pending' }
  }

  const hasRunningInSession = (dirObj) => {
    try {
      if (deps && typeof deps.getAgentStatus === 'function' && deps.getAgentStatus(rootId) === 'running') {
        return true
      }
    } catch {}
    try {
      const agentsMap = deps && deps.runtime && typeof deps.runtime.get === 'function'
        ? deps.runtime.get('agents')
        : null
      if (agentsMap && typeof agentsMap[Symbol.iterator] === 'function') {
        for (const item of agentsMap) {
          const ag = Array.isArray(item) ? item[1] : item
          if (!ag || typeof ag !== 'object') continue
          const agSid = String(ag.id || '').trim()
          if (!agSid) continue
          const agRoot = (deps && typeof deps.resolveRootSessionId === 'function' ? deps.resolveRootSessionId(agSid, ag) : '') || agSid
          if (agRoot !== rootId) continue
          const agName = String(ag.name || ag.handle || '')
          if (/^mnemon-(?:review|run)/i.test(agName)) continue
          if (ag.status === 'running') return true
        }
      }
    } catch {}
    const targets = dirObj && Array.isArray(dirObj.targets) ? dirObj.targets : []
    for (const t of targets) {
      if (!t || t.kind === 'peer-session' || t.kind === 'session') continue
      if (t.rootId && t.rootId !== rootId) continue
      const tName = String(t.name || t.handle || '')
      if (/^mnemon-(?:review|run)/i.test(tName)) continue
      if (t.status === 'running') return true
    }
    return false
  }

  const dirInitial = opts.directory || (deps ? await listPeerDirectory(deps, rootId) : { targets: [] })
  if (hasRunningInSession(dirInitial)) {
    return { ok: true, stopped: false, reason: 'agent-running' }
  }

  if (opts.allowStartupGrace !== false) {
    const startedAt = Number((wsBefore.runtimeGuard && wsBefore.runtimeGuard.autoPilotStartedAt) || 0)
    const hadTurn = Boolean(wsBefore.runtimeGuard && wsBefore.runtimeGuard.autoPilotHadTurn)
    if (!hadTurn && startedAt > 0 && Date.now() - startedAt < 15_000) {
      return { ok: true, stopped: false, reason: 'startup-grace' }
    }
  }

  if (opts.currentFresh !== true && deps) {
    const preView = await getChiefView(deps, rootId, {
      regenerate: false,
      autoSummarize: false,
      _skipAutoPilotCheck: true,
    }).catch(() => null)
    const nar = preView && preView.narrative
    if (nar && nar.hasUnsummarizedChanges && !nar.fresh) {
      if (nar.summarizing) {
        return { ok: true, stopped: false, reason: 'summarizing' }
      }
      if (preView.models && preView.models.available && !summarizingLocks.has(rootId)) {
        await getChiefView(deps, rootId, {
          regenerate: true,
          autoSummarize: false,
          _skipAutoPilotCheck: true,
        }).catch(() => null)
      }
    }
  }

  if (reviewTimers.has(rootId)) {
    return { ok: true, stopped: false, reason: 'review-pending' }
  }
  const dirFinal = deps ? await listPeerDirectory(deps, rootId) : dirInitial
  if (hasRunningInSession(dirFinal)) {
    return { ok: true, stopped: false, reason: 'agent-running' }
  }

  let stoppedNow = false
  mutateChiefState((s) => {
    const ws = ensureWorkspace(s, rootId)
    const effNow = resolveWorkspaceConfig(s, rootId)
    if (effNow.stopped || effNow.paceMode !== 'auto' || !effNow.autoPilot) return
    if (!ws.config || typeof ws.config !== 'object') ws.config = { ...effNow }
    ws.config.paceMode = 'manual'
    ws.config.autoPilot = false
    ws.config.autoReview = false
    if (s.config && s.config.paceMode === 'auto') {
      s.config.paceMode = 'manual'
      s.config.autoPilot = false
      s.config.autoReview = false
    }
    ws.chat.push({
      id: nextId('chat'),
      role: 'chief',
      text: '- 【⚡→⏸️ 防空转自动收工】本会话主代理与子代理均已结束任务且阶段摘要已收口，已自动退出「全自动托管」退回按需手动，随时可再次手动开启。',
      actions: ['防空转收工'],
      at: Date.now(),
    })
    if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
    stoppedNow = true
  })

  return { ok: true, stopped: stoppedNow, reason: stoppedNow ? 'idle-completed' : 'already-stopped' }
}

export async function handleSuggestionDecision(deps, { sessionId, suggestionId, decision, editedText, boundField, pinGlobal }) {
  const rootId = deps.resolveRootSessionId(sessionId) || String(sessionId || 'global')
  let found = null
  mutateChiefState((state) => {
    const ws = ensureWorkspace(state, rootId)
    const item = ws.suggestions.find(s => s.id === suggestionId)
    if (!item) return
    item.status = decision === 'approve' ? 'applied' : 'dismissed'
    found = { ...item }
  })
  if (!found) return { ok: false, error: '未找到该请示或建议卡片' }

  if (decision === 'approve' && found.kind === 'bound') {
    const rawBf = String(boundField || '').trim().toLowerCase()
    const normBf = rawBf === 'must' ? 'allowed' : rawBf
    const rawFoundBf = String(found.boundField || '').trim().toLowerCase()
    const normFoundBf = rawFoundBf === 'must' ? 'allowed' : rawFoundBf
    const col = ['forbidden', 'allowed', 'notes'].includes(normBf)
      ? normBf
      : (['forbidden', 'allowed', 'notes'].includes(normFoundBf) ? normFoundBf : 'forbidden')
    const BOUND_COL_LABEL = { forbidden: '禁止红线', allowed: '必做事项', notes: '注意事项' }
    const colLabel = BOUND_COL_LABEL[col] || '禁止红线'
    const ruleText = clamp(editedText || found.draftText || found.title, 220)
    if (!ruleText) return { ok: false, error: '边界条文不能为空' }

    const shouldPin = typeof pinGlobal === 'boolean' ? pinGlobal : Boolean(found.pinGlobal)
    const replaces = Array.isArray(found.replaces) ? found.replaces.filter(Boolean) : []

    const writeRes = deps.runAction
      ? (replaces.length > 0
          ? deps.runAction({
              action: 'bounds.consolidate',
              field: col,
              removeItems: replaces,
              item: ruleText,
              pinned: shouldPin,
              session: rootId === 'global' ? '' : rootId,
              by: 'DSH 参谋长',
            })
          : deps.runAction({
              action: 'bounds.add',
              field: col,
              item: ruleText,
              pinned: shouldPin,
              session: rootId === 'global' ? '' : rootId,
              by: 'DSH 参谋长',
            }))
      : { ok: false, error: 'runAction unavailable' }
    if (!writeRes || !writeRes.ok) {
      return { ok: false, error: (writeRes && writeRes.error) || '写入边界失败' }
    }

    const scopeTag = shouldPin ? '📌 全局共享边界（跨任务生效）' : '本任务边界（仅当前会话树生效）'
    // Broadcast a silent boundary decree so running lead/subagents immediately see the new rule on next pre-step
    mutateChiefState((state) => {
      const ws = ensureWorkspace(state, rootId)
      const cluster = getLinkedCluster(state, rootId)
      const decree = normalizeMail({
        from: 'DSH 参谋长 (边界颁布)',
        fromSession: rootId === 'global' ? '' : rootId,
        fromRootId: rootId === 'global' ? '' : rootId,
        to: 'all',
        toSession: 'all',
        toRootId: 'all',
        participantRoots: cluster,
        channelType: cluster.length > 1 ? 'broadcast' : 'internal',
        broadcastId: nextId('bcast'),
        subject: `用户已批准${replaces.length ? `浓缩${colLabel}（${replaces.length} 合 1）` : `新${colLabel}`}`,
        text: `- 【${colLabel} · ${scopeTag}】${shouldPin ? '📌 ' : ''}${ruleText}${replaces.length ? `\n- 【已整合替代】原 ${replaces.length} 条零散边界已合并为此条总则` : ''}${found.reason ? `\n- 【缘由】${found.reason}` : ''}\n请主代理与全体子代理自即刻起严格遵守！`,
        mode: 'silent',
        deliveredPhysical: false,
      })
      if (decree) {
        ws.mailbox.push(decree)
        if (ws.mailbox.length > MAIL_CAP) ws.mailbox = ws.mailbox.slice(-MAIL_CAP)
      }
    })

    return {
      ok: true,
      boundApplied: { field: col, label: colLabel, item: ruleText, pinned: shouldPin, replacedCount: replaces.length },
      view: await getChiefView(deps, rootId, { autoSummarize: true }),
    }
  }

  if (decision === 'approve' && found.kind === 'goal_approval') {
    const res = deps.runAction
      ? deps.runAction({ action: 'goal.approve', session: rootId, by: 'user' })
      : { ok: false, error: 'runAction unavailable' }
    return {
      ok: Boolean(res && res.ok),
      goalApproved: true,
      view: await getChiefView(deps, rootId, { autoSummarize: false }),
    }
  }

  if (decision !== 'approve' && found.kind === 'goal_approval') {
    const res = deps.runAction
      ? deps.runAction({
          action: 'goal.reject',
          reason: editedText || '暂不结项，继续推进完善',
          session: rootId,
          by: 'user',
        })
      : { ok: false }
    return {
      ok: Boolean(res && res.ok),
      goalRejected: true,
      view: await getChiefView(deps, rootId, { autoSummarize: false }),
    }
  }

  if (decision === 'approve' && (found.kind === 'relay' || found.kind === 'advice')) {
    const body = editedText ? cleanMultiline(editedText, 1200) : found.draftText
    const deliverTarget = found.target || 'lead'
    const shouldDeliver = Boolean(body && deliverTarget !== 'none' && deliverTarget !== 'chief')
    const delivery = shouldDeliver
      ? await deliverCrossMessage(deps, {
          fromSession: rootId,
          fromLabel: found.kind === 'advice' ? 'DSH 参谋长 (获批进言)' : 'DSH 参谋长 (获批建议)',
          target: deliverTarget,
          subject: found.title,
          text: body,
          mode: found.mode || (found.kind === 'advice' ? 'followup' : 'steer'),
        })
      : { ok: true, skippedDelivery: true }
    if (found.kind === 'advice' && typeof deps.appendBoardLog === 'function' && rootId !== 'global') {
      deps.appendBoardLog(rootId, `💡 用户已拍板采纳参谋进言：${clamp(found.title, 40)}`, 'user')
    }
    return {
      ok: delivery.ok !== false,
      adviceApplied: found.kind === 'advice',
      delivery,
      view: await getChiefView(deps, rootId, { autoSummarize: false }),
    }
  }

  return {
    ok: true,
    view: await getChiefView(deps, rootId, { autoSummarize: false }),
  }
}

export function updateChiefConfig(patch) {
  const safePatch = patch && typeof patch === 'object' ? patch : {}
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
      safePatch.paceMode === 'auto'
      || (typeof safePatch.paceMode !== 'string' && safePatch.stopped !== true && safePatch.autoPilot === true)
    )
    if (wantsAutoPilot && effBefore.paceMode !== 'auto' && safePatch.confirmedAutoPilot !== true) {
      return {
        ok: false,
        requireAutoPilotConfirm: true,
        error: '开启「⚡ 全自动托管」需先确认本会话自治范围与防空转退出弹窗（confirmedAutoPilot: true）',
      }
    }
    if (ws && wantsAutoPilot && effBefore.paceMode !== 'auto') {
      ws.runtimeGuard.autoPilotStartedAt = Date.now()
      ws.runtimeGuard.autoPilotHadTurn = false
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

    const applyPatchTo = (targetCfg, allowIntervention, allowAutoPilot = allowIntervention, allowPermSync = false) => {
      if (typeof safePatch.modelRef === 'string') targetCfg.modelRef = safePatch.modelRef.trim()
      if (allowPermSync && normalizedReqPerm) {
        targetCfg.permissionMode = normalizedReqPerm
      }
      if (typeof safePatch.paceMode === 'string' && ['manual', 'smart', 'auto', 'stopped'].includes(safePatch.paceMode)) {
        const nextPace = (!allowAutoPilot && safePatch.paceMode === 'auto') ? 'manual' : safePatch.paceMode
        targetCfg.paceMode = nextPace
        const isStopped = nextPace === 'stopped'
        targetCfg.stopped = isStopped
        targetCfg.autoPilot = !isStopped && nextPace === 'auto' && allowAutoPilot
        targetCfg.autoReview = !isStopped && nextPace !== 'manual'
      } else if (typeof safePatch.stopped === 'boolean') {
        targetCfg.stopped = safePatch.stopped
        if (safePatch.stopped) {
          targetCfg.paceMode = 'stopped'
          targetCfg.autoPilot = false
          targetCfg.autoReview = false
        } else {
          if (targetCfg.paceMode === 'stopped') targetCfg.paceMode = 'manual'
          if (!allowAutoPilot && targetCfg.paceMode === 'auto') targetCfg.paceMode = 'manual'
          targetCfg.autoPilot = targetCfg.paceMode === 'auto' && allowAutoPilot
          targetCfg.autoReview = targetCfg.paceMode !== 'manual'
        }
      } else if (typeof safePatch.autoPilot === 'boolean') {
        const nextAuto = Boolean(safePatch.autoPilot && allowAutoPilot)
        targetCfg.stopped = false
        targetCfg.paceMode = nextAuto ? 'auto' : 'manual'
        targetCfg.autoPilot = nextAuto
        targetCfg.autoReview = nextAuto
      }
      if (!allowAutoPilot && targetCfg.paceMode === 'auto') {
        targetCfg.paceMode = 'manual'
        targetCfg.autoPilot = false
      }
      if (typeof safePatch.autoReview === 'boolean' && typeof safePatch.paceMode !== 'string' && typeof safePatch.stopped !== 'boolean') {
        targetCfg.autoReview = safePatch.autoReview
        if (!safePatch.autoReview) {
          targetCfg.stopped = false
          targetCfg.paceMode = 'manual'
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

    if (!ws.config || typeof ws.config !== 'object') ws.config = { ...effBefore }
    applyPatchTo(ws.config, true, true, true)
    // Session permissionMode, intervention, and autoPilot NEVER leak globally across new sessions!
    state.config.permissionMode = DEFAULT_CHIEF_PERMISSION_MODE
    applyPatchTo(state.config, false, false, false)

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
      ...(compactLowWarning ? { compactLowWarning } : {}),
      config: { ...finalCfg, tacticalModes: { ...finalCfg.tacticalModes } },
    }
  })
}

/** 处理 L2 参谋模式逐项操作授权弹窗（拒绝 / 允许本次操作）。 */
export async function handleApprovalDecision(deps, {
  sessionId = '',
  approvalId = '',
  decision = 'reject',
} = {}) {
  const rootId = (deps && typeof deps.resolveRootSessionId === 'function' ? deps.resolveRootSessionId(sessionId) : '') || String(sessionId || 'global')
  let found = null
  let currentMode = DEFAULT_CHIEF_PERMISSION_MODE

  mutateChiefState((state) => {
    const ws = ensureWorkspace(state, rootId)
    const ackOk = hasValidChiefRiskAck(ws)
    const eff = resolveWorkspaceConfig(state, rootId)
    currentMode = normalizePermissionMode(eff.permissionMode, { requireAck: true, hasChiefRiskAck: ackOk })
    const item = (ws.pendingApprovals || []).find(a => a && a.id === approvalId && a.status === 'pending')
    if (!item) return
    found = { ...item, payload: item.payload ? { ...item.payload } : {} }
    if (decision !== 'approve') {
      item.status = 'rejected'
      item.resolvedAt = Date.now()
      item.resolvedBy = 'operator'
      item.resultMessage = '用户拒绝执行本次操作'
      pushAuditToWs(ws, {
        mode: currentMode,
        stage: 'permission_gate',
        decision: 'rejected_by_user',
        operation: item.operationLabel,
        target: item.targetLabel,
        reason: item.reason,
        outcome: 'rejected',
        by: 'operator',
      })
      ws.chat.push({
        id: nextId('chat'),
        role: 'chief',
        text: `- 【⛔ 已拒绝本次操作】${item.operationLabel} · \`${item.targetLabel}\``,
        actions: ['⛔ 用户拒绝操作'],
        at: Date.now(),
      })
      if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
    } else {
      item.status = 'approved'
      item.resolvedAt = Date.now()
      item.resolvedBy = 'operator'
      pushAuditToWs(ws, {
        mode: currentMode,
        stage: 'permission_gate',
        decision: 'approved_by_user',
        operation: item.operationLabel,
        target: item.targetLabel,
        reason: item.reason,
        outcome: 'approved',
        by: 'operator',
      })
    }
  })

  if (!found) return { ok: false, error: '未找到该待确认操作或已处理完毕' }
  if (decision !== 'approve') {
    return {
      ok: true,
      rejected: true,
      approval: { ...found, status: 'rejected' },
      view: await getChiefView(deps, rootId, { autoSummarize: false }),
    }
  }

  const board = deps && deps.boardForSession && deps.boardFileFor
    ? deps.boardForSession(deps.boardFileFor(rootId))
    : null
  const payload = found.payload || {}
  let execOk = false
  let execRes = null
  let resultMsg = ''

  try {
    if (found.kind === 'tool' && payload.tool) {
      execRes = await executeChiefToolCall(deps, { tool: payload.tool, args: payload.args || {} }, {
        rootId,
        sessionId: payload.sessionId || rootId,
        cwd: payload.cwd || resolveSessionWorkspaceCwd(deps, rootId),
        permissionMode: currentMode === 'chief' ? 'chief' : 'strategist',
        hasChiefRiskAck: currentMode === 'chief',
        approvedOnce: true,
        board,
        upsertArchiveFn: buildChiefArchiveUpsertFn(deps, rootId),
        compactNowFn: buildChiefCompactFn(deps, rootId),
        recordAuditFn: (entry) => appendChiefAuditLog(rootId, entry),
        by: 'operator(逐项授权)',
      })
      execOk = Boolean(execRes && execRes.ok)
      resultMsg = execOk
        ? `已执行 ${found.operationLabel}（${found.targetLabel}）`
        : (execRes && execRes.error) || '执行未成功'
    } else if (found.kind === 'relay') {
      const guardRes = evaluateSafetyGuardHardRules({ tool: 'relay', opClass: 'workflow', command: payload.text || '', board })
      if (guardRes.blocked) {
        execOk = false
        execRes = { ok: false, blockedBySafetyGuard: true, error: guardRes.reason }
        resultMsg = guardRes.reason
        appendChiefAuditLog(rootId, { mode: currentMode, stage: 'safety_guard', decision: 'blocked', operation: found.operationLabel, target: found.targetLabel, reason: guardRes.reason, outcome: 'blocked', by: 'operator' })
      } else {
        const deliv = await deliverCrossMessage(deps, {
          fromSession: rootId,
          fromLabel: payload.fromLabel || 'DSH 参谋 (逐项授权)',
          target: payload.target || 'lead',
          subject: payload.subject || '',
          text: payload.text || '',
          mode: payload.mode || 'steer',
          imageBlocks: Array.isArray(payload.imageBlocks) ? payload.imageBlocks : [],
          savedImagePaths: Array.isArray(payload.savedImagePaths) ? payload.savedImagePaths : [],
        })
        const isLeadTarget = /^(?:lead|main|主对话)$/i.test(String(payload.target || 'lead').trim())
        if (isLeadTarget && (!deliv.ok || (payload.isBlankContext && !deliv.deliveredPhysical)) && deps && typeof deps.stagePendingTransfer === 'function') {
          const staged = deps.stagePendingTransfer(
            `[DSH 参谋预派发指令${payload.subject ? ' · ' + payload.subject : ''}]\n${payload.text || ''}`,
            rootId,
            { by: 'chief', subject: payload.subject || '' },
          )
          if (staged) {
            execOk = true
            execRes = { ...deliv, ok: true, stagedPending: true, target: '主对话(待领)' }
            resultMsg = '已暂存主对话待领交接指令'
          } else {
            execOk = Boolean(deliv && deliv.ok)
            execRes = deliv
            resultMsg = execOk ? `已投递给 ${deliv.target || found.targetLabel}` : ((deliv && deliv.error) || '投递失败')
          }
        } else {
          execOk = Boolean(deliv && deliv.ok)
          execRes = deliv
          resultMsg = execOk ? `已投递给 ${deliv.target || found.targetLabel}` : ((deliv && deliv.error) || '投递失败')
        }
        appendChiefAuditLog(rootId, { mode: currentMode, stage: 'executor', decision: 'executed_approved', operation: found.operationLabel, target: found.targetLabel, reason: clamp(resultMsg, 120), outcome: execOk ? 'ok' : 'error', by: 'operator' })
      }
    } else if (found.kind === 'compact') {
      const guardRes = evaluateSafetyGuardHardRules({ tool: 'session_compact', opClass: 'workflow', board })
      if (guardRes.blocked) {
        execOk = false
        execRes = { ok: false, blockedBySafetyGuard: true, error: guardRes.reason }
        resultMsg = guardRes.reason
      } else {
        execRes = await buildChiefCompactFn(deps, rootId)(payload.reason || found.reason)
        execOk = Boolean(execRes && execRes.ok)
        if (execOk && !execRes.noop) {
          recordSmartCompactionChatReceipt(rootId, {
            cRes: execRes,
            ratioPct: Number(execRes.ratioPct) || 0,
            via: '🛡️ 逐项授权压缩',
          })
        }
        resultMsg = execOk
          ? (execRes.noop ? '已抢救细节入本会话档案柜（当前历史免压）' : '已抢救细节并完成主对话上下文静默压缩')
          : ((execRes && execRes.error) || '压缩未完成')
        appendChiefAuditLog(rootId, { mode: currentMode, stage: 'executor', decision: 'executed_approved', operation: found.operationLabel, target: found.targetLabel, reason: clamp(resultMsg, 120), outcome: execOk ? 'ok' : 'error', by: 'operator' })
      }
    } else if (found.kind === 'auto_continue') {
      if (deps && typeof deps.triggerAutoContinueNow === 'function') {
        execRes = await deps.triggerAutoContinueNow(payload.sessionId || rootId, payload.trigger || 'turn/end:approved', { detail: payload.detail || '' })
        execOk = Boolean(execRes && execRes.ok)
        resultMsg = execOk ? '已触发主对话断线续跑' : ((execRes && execRes.error) || '断线续跑未触发')
      } else {
        execOk = false
        resultMsg = '当前宿主未提供续跑回调接口'
      }
      appendChiefAuditLog(rootId, { mode: currentMode, stage: 'executor', decision: 'executed_approved', operation: found.operationLabel, target: found.targetLabel, reason: clamp(resultMsg, 120), outcome: execOk ? 'ok' : 'error', by: 'operator' })
    }
  } catch (err) {
    execOk = false
    execRes = { ok: false, error: (err && err.message) || String(err || 'execution-failed') }
    resultMsg = execRes.error
  }

  let updatedApproval = { ...found, status: execOk ? 'executed' : 'failed', resultMessage: resultMsg }
  mutateChiefState((state) => {
    const ws = ensureWorkspace(state, rootId)
    const item = (ws.pendingApprovals || []).find(a => a && a.id === approvalId)
    if (item) {
      item.status = execOk ? 'executed' : 'failed'
      item.resultMessage = clamp(resultMsg, 260)
      updatedApproval = { ...item }
    }
    ws.chat.push({
      id: nextId('chat'),
      role: 'chief',
      text: execOk
        ? `- 【✅ 已允许并执行】${found.operationLabel} · \`${found.targetLabel}\`\n  结果：${clamp(resultMsg, 240)}`
        : `- 【⚠️ 授权操作未完成】${found.operationLabel} · \`${found.targetLabel}\`\n  说明：${clamp(resultMsg, 240)}`,
      actions: [execOk ? '✅ 逐项授权执行' : '⚠️ 授权执行异常'],
      at: Date.now(),
    })
    if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
  })

  const latestBoard = deps && deps.boardForSession && deps.boardFileFor
    ? deps.boardForSession(deps.boardFileFor(rootId))
    : undefined
  return {
    ok: true,
    executed: execOk,
    executionOk: execOk,
    approval: updatedApproval,
    result: execRes,
    ...(latestBoard ? { board: latestBoard } : {}),
    view: await getChiefView(deps, rootId, { autoSummarize: false }),
  }
}

/** 处理模型/主代理提交的权限升级请求；若批准为最高档 L3 必须由后端校验 confirmedChiefRisk。 */
export async function handleElevationDecision(deps, {
  sessionId = '',
  elevationId = '',
  decision = 'reject',
  targetMode = '',
  confirmedChiefRisk = false,
} = {}) {
  const rootId = (deps && typeof deps.resolveRootSessionId === 'function' ? deps.resolveRootSessionId(sessionId) : '') || String(sessionId || 'global')
  const stateBefore = loadChiefState()
  const wsBefore = ensureWorkspace(stateBefore, rootId)
  const elev = wsBefore.pendingElevation
  if (!elev || (elevationId && elev.id !== elevationId)) {
    return { ok: false, error: '当前没有待处理的提权申请' }
  }

  if (decision !== 'approve') {
    mutateChiefState((s) => {
      const ws = ensureWorkspace(s, rootId)
      ws.pendingElevation = null
      pushAuditToWs(ws, {
        mode: resolveWorkspaceConfig(s, rootId).permissionMode,
        stage: 'permission_gate',
        decision: 'elevation_rejected',
        operation: '拒绝提权申请',
        target: `${elev.fromMode} -> ${elev.targetMode}`,
        reason: elev.reason,
        outcome: 'rejected',
        by: 'operator',
      })
      ws.chat.push({
        id: nextId('chat'),
        role: 'chief',
        text: `- 【🔒 已拒绝提权申请】维持当前权限，未升级至 ${CHIEF_PERMISSION_META[elev.targetMode]?.level || elev.targetMode}。`,
        actions: ['🔒 拒绝提权'],
        at: Date.now(),
      })
      if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
    })
    return { ok: true, rejected: true, view: await getChiefView(deps, rootId, { autoSummarize: false }) }
  }

  const chosenMode = normalizePermissionMode(targetMode || elev.targetMode)
  if (permissionRank(chosenMode) <= 0) {
    return { ok: false, error: '无效的提权目标档位' }
  }
  if (chosenMode === 'chief' && confirmedChiefRisk !== true) {
    appendChiefAuditLog(rootId, {
      mode: resolveWorkspaceConfig(loadChiefState(), rootId).permissionMode,
      stage: 'permission_gate',
      decision: 'deny_unacknowledged_l3',
      operation: 'L3 提权风险校验',
      target: 'chief',
      reason: '批准提权至最高档 L3 前必须勾选风险知悉确认',
      outcome: 'denied',
      by: 'operator',
    })
    return {
      ok: false,
      requireChiefRiskConfirm: true,
      error: '提权至最高档「L3 · 参谋长模式」必须先阅读风险告知并勾选确认（confirmedChiefRisk: true）！',
    }
  }

  const cfgRes = updateChiefConfig({
    sessionId: rootId,
    permissionMode: chosenMode,
    confirmedChiefRisk: chosenMode === 'chief',
    by: 'operator(提权审批)',
  })
  if (!cfgRes || cfgRes.ok === false) {
    return cfgRes || { ok: false, error: '提权应用失败' }
  }

  mutateChiefState((s) => {
    const ws = ensureWorkspace(s, rootId)
    ws.pendingElevation = null
    pushAuditToWs(ws, {
      mode: chosenMode,
      stage: 'permission_gate',
      decision: 'elevation_approved',
      operation: '批准提权',
      target: `${CHIEF_PERMISSION_META[elev.fromMode]?.level || elev.fromMode} -> ${CHIEF_PERMISSION_META[chosenMode].level}`,
      reason: elev.reason,
      outcome: 'approved',
      by: 'operator',
    })
    const meta = CHIEF_PERMISSION_META[chosenMode]
    ws.chat.push({
      id: nextId('chat'),
      role: 'chief',
      text: `- 【🔐 已批准提权】当前会话权限已升级为「**${meta.level} · ${meta.title}**」${chosenMode === 'chief' ? '（已完成高风险确认）' : ''}。`,
      actions: [`🔐 升至 ${meta.level}`],
      at: Date.now(),
    })
    if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
  })

  return {
    ok: true,
    approvedMode: chosenMode,
    permissionMode: chosenMode,
    config: cfgRes.config,
    view: await getChiefView(deps, rootId, { autoSummarize: false }),
  }
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

export function readMailboxForAgent(deps, { sessionId, callerAgent, unreadOnly = false }) {
  const sid = String(sessionId || (callerAgent && callerAgent.id) || '').trim()
  const rootId = deps.resolveRootSessionId(sid, callerAgent) || sid || 'global'
  const identity = deps.resolveAgentIdentity(deps.runtime, sid, callerAgent)
  const myHandles = new Set(
    [
      sid,
      identity && identity.self ? identity.self : '',
      identity && !identity.isChild ? 'lead' : '',
    ].filter(Boolean).map(v => v.toLowerCase()),
  )

  const out = []
  mutateChiefState((state) => {
    const view = clusterView(state, rootId)
    for (const m of view.mailbox) {
      const toLower = String(m.toSession || m.to || '').toLowerCase()
      const toHandleLower = String(m.to || '').toLowerCase()
      const relevant = !sid
        || toLower === 'all'
        || toHandleLower === 'all'
        || myHandles.has(toLower)
        || myHandles.has(toHandleLower)
        || myHandles.has(toHandleLower.split('/').pop())
        || m.fromSession === sid
      if (!relevant) continue
      const isRead = (m.readBy || []).some(r => myHandles.has(String(r).toLowerCase()))
      if (unreadOnly && isRead) continue
      if (!isRead && sid && m.fromSession !== sid) {
        m.readBy = [...new Set([...(m.readBy || []), sid, ...(identity?.self ? [identity.self] : [])])]
      }
      out.push({ ...m, unread: !isRead })
    }
  })
  return out.slice(-25)
}

const COMPACT_ADVISOR_SYSTEM = `你是 DSH 参谋长的「上下文与自动压缩策略顾问」。
用户点击了「参谋智设」自动压缩阈值按钮。请结合当前会话的模型上下文窗口、固定开销（系统提示词 + 工具定义）、已用消息数以及当前任务复杂度，给出最合理的自动压缩触发阈值百分比（必须是 5 的倍数，且严格落在给定 [floorPct, 90] 安全区间内）。

设计原则：
1. 若系统提示词+工具开销已经占用了较大比例，或上下文窗口 <= 200K，阈值绝对不能过低，否则连系统提示词都装不满就反复触发压缩，严重降智！
2. 若上下文窗口极大（如 1M 上下文，固定开销只占 ~5%），可适当设低（如 25%~40%，即 250K~400K 左右）来保持模型注意力敏锐度与高速响应，同时留出充足工作空间。
3. 请仅返回合法 JSON 对象：
{
  "recommendedPct": 30,
  "reason": "当前 1M 窗口中固定开销约 52K（5%），30%（约 300K）既能维持长程理解又能防止注意力衰退。"
}`

export async function recommendAndSetCompactThreshold(deps, { sessionId = '' } = {}) {
  const rootId = deps.resolveRootSessionId(sessionId) || String(sessionId || 'global')
  const rawUsage = typeof deps.measureSessionTokens === 'function'
    ? await Promise.resolve(deps.measureSessionTokens(rootId))
    : null
  const usage = (rawUsage && typeof rawUsage === 'object') ? rawUsage : {}

  const contextWindow = Math.max(32000, Number(usage.contextWindow) || 128000)
  const systemTokens = Math.max(0, Number(usage.systemTokens) || 0)
  const toolsTokens = Math.max(0, Number(usage.toolsTokens) || 0)
  const messageTokens = Math.max(0, Number(usage.messageTokens) || 0)
  const usedTokens = Math.max(0, Number(usage.usedTokens) || (systemTokens + toolsTokens + messageTokens))
  const overheadTokens = systemTokens + toolsTokens
  const modelRef = String(usage.modelRef || '').trim()

  const minSafeTokens = Math.max(Math.round(overheadTokens * 2.2), overheadTokens + 45000, 48000)
  const rawFloorPct = Math.ceil(((minSafeTokens / contextWindow) * 100) / 5) * 5
  const floorPct = Math.min(85, Math.max(15, rawFloorPct))

  const basePct = contextWindow >= 800000
    ? 35
    : contextWindow >= 350000
      ? 55
      : contextWindow >= 180000
        ? 65
        : 75
  const heuristicPct = Math.min(90, Math.max(floorPct, basePct))

  const fmtTok = (n) => {
    const v = Math.max(0, Math.round(Number(n) || 0))
    if (v >= 1000000) return `${(v / 1000000).toFixed(v % 1000000 === 0 ? 0 : 1)}M`
    if (v >= 1000) return `${Math.round(v / 1000)}K`
    return String(v)
  }

  let finalPct = heuristicPct
  let llmGuided = false
  let reason = `当前窗口 ${fmtTok(contextWindow)}（系统与工具固定开销 ~${fmtTok(overheadTokens)}），已自动锁定在 ${finalPct}%（~${fmtTok((contextWindow * finalPct) / 100)}），兼顾推理深度与防劣化安全底线。`

  const board = typeof deps.boardForSession === 'function' && typeof deps.boardFileFor === 'function'
    ? deps.boardForSession(deps.boardFileFor(rootId))
    : null
  const objective = board && board.objective ? clamp(board.objective, 160) : '（未设总目标）'
  const activeTaskCount = Array.isArray(board?.tasks)
    ? board.tasks.filter(t => t && (t.status === 'doing' || t.status === 'todo' || t.status === 'blocked')).length
    : 0

  try {
    const advisorPrompt = [
      `- 当前主对话模型: ${modelRef || '默认对话模型'}`,
      `- 上下文总窗口 (contextWindow): ${contextWindow} tokens (${fmtTok(contextWindow)})`,
      `- 系统提示词 (systemTokens): ${systemTokens} tokens (${fmtTok(systemTokens)})`,
      `- 工具定义 (toolsTokens): ${toolsTokens} tokens (${fmtTok(toolsTokens)})`,
      `- 固定开销合计 (overhead): ${overheadTokens} tokens (${((overheadTokens / contextWindow) * 100).toFixed(1)}%)`,
      `- 当前已用总上下文: ${usedTokens} tokens (${((usedTokens / contextWindow) * 100).toFixed(1)}%)`,
      `- 系统硬性安全下限 (floorPct): ${floorPct}% (~${fmtTok((contextWindow * floorPct) / 100)})`,
      `- 启发式基准建议: ${heuristicPct}%`,
      `- 当前任务目标: ${objective}（活跃任务 ${activeTaskCount} 项）`,
      '',
      `请给出 final recommendedPct（5 的倍数，范围 [${floorPct}, 90]）与一句不超过 85 字的中文建议理由。`,
    ].join('\n')

    const llmRes = await callChiefLlm(deps, {
      sessionId: rootId,
      system: COMPACT_ADVISOR_SYSTEM,
      prompt: advisorPrompt,
      maxTokens: 320,
    })
    if (llmRes && llmRes.ok && llmRes.text) {
      const parsed = extractJsonObject(llmRes.text)
      if (parsed && Number.isFinite(Number(parsed.recommendedPct))) {
        const snapped = Math.round(Number(parsed.recommendedPct) / 5) * 5
        finalPct = Math.min(90, Math.max(floorPct, snapped))
        if (typeof parsed.reason === 'string' && parsed.reason.trim()) {
          reason = clamp(parsed.reason.trim(), 180)
        }
        llmGuided = true
      }
    }
  } catch {}

  updateChiefConfig({
    sessionId: rootId,
    tacticalModes: {
      compactThresholdPct: finalPct,
      autoCompact: true,
    },
  })

  const view = await getChiefView(deps, rootId, { autoSummarize: false })
  return {
    ok: true,
    recommendedPct: finalPct,
    triggerTokens: Math.round((contextWindow * finalPct) / 100),
    overheadTokens,
    contextWindow,
    systemTokens,
    toolsTokens,
    messageTokens,
    usedTokens,
    floorPct,
    modelRef,
    llmGuided,
    reason,
    view,
  }
}

const OBJECTIVE_SUGGEST_SYSTEM = [
  '你是「DSH 参谋长」（宰相级总目标顾问）。用户正准备开启「主动强介入模式」，需要锁定一条「核心目标」作为所有后续参谋介入判断与验收的唯一最终目的地。',
  '有两种协作模式，请严格遵循：',
  '1. `mode = "refine"`（微调已有文字）：输入框中已有用户自己写下的核心目标草案。你必须在**严格尊重保留用户原有核心意图、主语、约束和具象锚点**的前提下，将其微调润色为一条表述更凝练、验收标准更清晰、适合强介入持续核验的一句话核心目标（不超过 120 字），严禁推翻或另起炉灶。',
  '2. `mode = "guess"`（建议 / 反复揣摩用户意图）：用户未填写核心目标，或认为上一轮建议还不够贴切并**继续点击「建议」让你重新猜**。请综合当前主对话与子代理实时流、最新用户原始诉求、小任务板（Plan）、任务表、必做事项与近期结论，猜出用户此刻最核心的真实落地目标；**严禁与 `已给过的建议列表 (previousSuggestions)` 重复或仅换一两个虚词**，每次重猜都应尝试更贴合场景、不同切入维度或更具体可验收的表述（不超过 120 字）。',
  '',
  '只输出一个合法 JSON 对象：',
  '{',
  '  "suggestion": "建议或微调后的核心目标一句话（≤120字，不要加引号或序号）",',
  '  "rationale": "一句简明大白话说明为何这样拟定/微调（≤55字）"',
  '}',
].join('\n')

/**
 * Suggest (with repeated intent guessing) or micro-tune an existing draft Core Objective
 * when enabling Strong Intervention mode.
 */
export async function suggestCoreObjectiveWithChief(deps, {
  sessionId = '',
  draft = '',
  mode = 'auto',
  previousSuggestions = [],
} = {}) {
  const rootId = (deps && typeof deps.resolveRootSessionId === 'function' ? deps.resolveRootSessionId(sessionId) : sessionId) || String(sessionId || 'global')
  const rawDraft = String(draft || '').replace(/\s+/g, ' ').trim()
  const prevList = (Array.isArray(previousSuggestions) ? previousSuggestions : [])
    .map(x => String(x || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(-12)

  const normalizedDraft = rawDraft.toLowerCase()
  const isCycleOfPreviousAi = Boolean(
    rawDraft && prevList.some(p => p.toLowerCase() === normalizedDraft),
  )
  const effectiveMode = (mode === 'refine' || (mode === 'auto' && rawDraft && !isCycleOfPreviousAi))
    ? 'refine'
    : 'guess'

  const directory = await listPeerDirectory(deps, rootId)
  const board = deps && deps.boardForSession && deps.boardFileFor
    ? deps.boardForSession(deps.boardFileFor(rootId))
    : null
  const liveDigest = collectLiveConversationsDigest(deps, rootId, directory)
  const state = loadChiefState()
  const view = clusterView(state, rootId)
  const numberedFacts = view.facts.slice(-8)
  const planSteps = Array.isArray(board && board.plan) ? board.plan.filter(Boolean) : []
  const openPlan = planSteps.filter(s => !s.done)
  const tasks = Array.isArray(board && board.tasks) ? board.tasks : []
  const activeTasks = tasks.filter(t => t && (t.status === 'doing' || t.status === 'todo' || t.status === 'blocked'))
  const bounds = (board && board.bounds) || { allowed: [], forbidden: [], notes: [] }
  const leadEntry = (liveDigest.entries || []).find(e => e.kind === 'lead') || (liveDigest.entries || [])[0] || null
  const latestUser = (leadEntry && leadEntry.lastUser) ? leadEntry.lastUser : ''
  const existingObj = board && board.objective ? String(board.objective).trim() : ''

  // Build non-repeating deterministic fallback candidates ordered by attempt index
  const buildFallbackCandidate = () => {
    if (effectiveMode === 'refine' && rawDraft) {
      const cleanDraft = clamp(rawDraft.replace(/[。；;]+$/, ''), 96)
      const refined = /完成|实现|通过|验证|修复|交付|生成|输出/.test(cleanDraft)
        ? `${cleanDraft}，确保可实测验收后收尾`
        : `完成「${cleanDraft}」并完成实测核验`
      return {
        suggestion: clamp(refined, 120),
        rationale: '已保留您原有核心意图，并补充清晰的可验收收口标准。',
      }
    }

    const candidates = []
    if (latestUser) {
      candidates.push({
        suggestion: clamp(`彻底完成用户当前诉求「${clamp(latestUser, 72)}」并经实测核验交付`, 120),
        rationale: '根据主对话最近一次真实诉求提炼的核心目标。',
      })
    }
    if (openPlan.length > 0) {
      candidates.push({
        suggestion: clamp(`按小任务板推进完成：${openPlan.slice(0, 2).map(s => clamp(s.text, 38)).join(' → ')}`, 120),
        rationale: '聚焦小任务板当前尚未勾选的待办节点。',
      })
    }
    if (activeTasks.length > 0) {
      candidates.push({
        suggestion: clamp(`攻克在手关键任务（${activeTasks.slice(0, 2).map(t => clamp(t.title, 36)).join('、')}）并通过验证`, 120),
        rationale: '围绕目前推进中与待办的核心任务收敛目标。',
      })
    }
    if (existingObj) {
      candidates.push({
        suggestion: clamp(`${existingObj.replace(/[。；;]+$/, '')}，完成全部必做事项与实证验收`, 120),
        rationale: '在当前规划核心目标基础上强化完结验收基准。',
      })
    }
    if (bounds.allowed && bounds.allowed.length > 0) {
      candidates.push({
        suggestion: clamp(`推进完成本轮主线研发与交付（必做：${clamp(bounds.allowed[0], 55)}）`, 120),
        rationale: '结合当前必做事项清单拟定的可监督落地目标。',
      })
    }
    if (leadEntry && leadEntry.lastAssistant) {
      candidates.push({
        suggestion: clamp(`收口当前主线工作（${clamp(leadEntry.lastAssistant, 68)}）并验证通过`, 120),
        rationale: '结合主对话最新工作现场推断的收尾目标。',
      })
    }
    candidates.push(
      {
        suggestion: '完整实现本轮设定功能需求、完成自测校验并清晰交付最终结果',
        rationale: '通用端到端实现与实测交付目标。',
      },
      {
        suggestion: '排查解决当前阻断卡点与遗留缺陷，确保系统运行稳定并通过复测',
        rationale: '偏向排查修复与稳定收口的兜底目标。',
      },
    )

    const prevNormSet = new Set(prevList.map(x => x.toLowerCase()))
    const chosen = candidates.find(c => !prevNormSet.has(String(c.suggestion || '').toLowerCase()))
      || candidates[prevList.length % candidates.length]
    return chosen
  }

  const promptLines = [
    `当前执行模式: ${effectiveMode === 'refine' ? 'refine（在用户已有核心目标文字上微调润色）' : 'guess（结合现场上下文猜想用户想要的核心目标，允许反复点建议继续猜）'}`,
    `工作区当前已填核心目标: ${existingObj || '（空）'}`,
    ...(rawDraft ? [`用户输入框当前文字: ${rawDraft}`] : ['用户输入框当前文字: （空）']),
    ...(prevList.length > 0 ? [`已给过的建议（严禁重复或仅微调措辞，须从新角度继续猜）:\n${prevList.map((p, i) => `  ${i + 1}. ${p}`).join('\n')}`] : []),
    `主对话最近用户原始诉求: ${latestUser || '（暂未捕捉）'}`,
    `小任务板 (Plan) 未完步骤: ${openPlan.slice(0, 4).map(s => clamp(s.text, 60)).join('；') || '（无）'}`,
    `在手任务 (doing/blocked/todo): ${activeTasks.slice(0, 5).map(t => `[${t.status}] ${clamp(t.title, 48)}`).join('；') || '（无）'}`,
    `必做事项 (allowed): ${(bounds.allowed || []).slice(0, 4).join('；') || '（无）'}`,
    `禁止红线 (forbidden): ${(bounds.forbidden || []).slice(0, 4).join('；') || '（无）'}`,
    `主对话现场摘要: ${leadEntry ? clamp(leadEntry.lastAssistant || '', 260) : '（无）'}`,
    ...(numberedFacts.length ? [`近期重要结论: ${numberedFacts.slice(-4).map(f => clamp(f.text, 90)).join('；')}`] : []),
  ]

  let suggestion = ''
  let rationale = ''
  let llmUsed = false

  try {
    const llmRes = await callChiefLlm(deps, {
      sessionId: rootId,
      system: OBJECTIVE_SUGGEST_SYSTEM,
      prompt: promptLines.join('\n'),
      maxTokens: 320,
    })
    if (llmRes && llmRes.ok && llmRes.text) {
      const parsed = extractJsonObject(llmRes.text)
      if (parsed && typeof parsed.suggestion === 'string' && parsed.suggestion.trim()) {
        const cleaned = cleanMultiline(stripToolCallMarkup(parsed.suggestion), 160).replace(/\s+/g, ' ').trim()
        const isDuplicateGuess = effectiveMode === 'guess' && prevList.some(p => p.toLowerCase() === cleaned.toLowerCase())
        if (cleaned && !isDuplicateGuess) {
          suggestion = clamp(cleaned, 120)
          rationale = clamp(String(parsed.rationale || '').trim(), 90)
          llmUsed = true
        }
      }
    }
  } catch {}

  if (!suggestion) {
    const fb = buildFallbackCandidate()
    suggestion = fb.suggestion
    rationale = fb.rationale
  }

  return {
    ok: true,
    suggestion,
    rationale: rationale || (effectiveMode === 'refine' ? '已在您原文基础上完成微调。' : '已结合当前对话态势为您揣摩建议。'),
    mode: effectiveMode,
    llmUsed,
  }
}
