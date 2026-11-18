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
} from './chief-executor.js'

const APPROVALS_CAP = 30

const AUDIT_LOG_CAP = 80

const RESUME_TASKS_CAP = 20

const DEFAULT_RESUME_TTL_MS = 30 * 60 * 1000

const STATE_VERSION = 1

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
 * Chief-of-Staff visibility matrix (0-Token Global Cold Vault):
 * - Sees current session's Working Cabinet (`session`), if bound to a concrete rootSessionId
 * - Sees ONLY System Global Cold Vault entries explicitly mounted for Chief in THIS session (`chiefMountedSessions`) — 0 Token by default!
 * - Sees Precipitated Vault entries ONLY when explicitly `flippedOut` (`ws.flippedPrecipitatedIds`) for this session!
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
  return path.join(chiefDir(), 'chief-audit.jsonl')
}

function appendAuditJsonlLine(record) {
  try {
    const file = auditJsonlPath()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, JSON.stringify(record) + '\n', 'utf8')
  } catch {}
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
  const validStatuses = ['pending', 'approved', 'rejected', 'executed', 'failed']
  const status = validStatuses.includes(raw.status) ? raw.status : 'pending'
  const validKinds = ['tool', 'relay', 'compact', 'auto_continue']
  const kind = validKinds.includes(raw.kind) ? raw.kind : 'tool'
  const validCategories = ['workspace_file', 'system_command', 'main_workflow', 'subagent_workflow']
  const category = validCategories.includes(raw.category) ? raw.category : 'workspace_file'
  const payload = raw.payload && typeof raw.payload === 'object' ? raw.payload : {}
  const payloadHash = typeof raw.payloadHash === 'string' && raw.payloadHash.trim()
    ? raw.payloadHash.trim()
    : computeApprovalPayloadHash(kind, payload)
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
    resumeTaskId: clamp(raw.resumeTaskId || '', 80),
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
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : nextId('elv'),
    status: 'pending',
    fromMode: normalizePermissionMode(raw.fromMode || 'advisor'),
    targetMode,
    reason: clamp(raw.reason || '当前任务需要更高参谋权限才能继续执行', 260),
    requestedActionSummary: clamp(raw.requestedActionSummary || '', 220),
    resumeTaskId: clamp(raw.resumeTaskId || '', 80),
    expiresAt: Math.max(0, Number(raw.expiresAt) || (createdAt + DEFAULT_RESUME_TTL_MS)),
    by: clamp(raw.by || 'chief', 40),
    createdAt,
  }
}

function normalizeResumeTask(raw) {
  if (!raw || typeof raw !== 'object') return null
  const originalText = cleanMultiline(raw.originalText || '', 2000)
  if (!originalText) return null
  const validStatuses = ['awaiting_elevation', 'awaiting_approval', 'resuming', 'completed', 'cancelled', 'expired', 'failed']
  const status = validStatuses.includes(raw.status) ? raw.status : 'awaiting_approval'
  const createdAt = Number(raw.createdAt) || Date.now()
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : nextId('rtask'),
    status,
    originalText,
    forcedTarget: clamp(raw.forcedTarget || '', 64),
    forcedMode: ['steer', 'followup', 'silent'].includes(raw.forcedMode) ? raw.forcedMode : 'steer',
    savedImagePaths: Array.isArray(raw.savedImagePaths)
      ? raw.savedImagePaths.slice(0, 4).filter(p => p && typeof p.path === 'string').map(p => ({
          index: Number(p.index) || 1,
          path: String(p.path),
          name: clamp(p.name || '', 80),
          mediaType: clamp(p.mediaType || '', 40),
          bytes: Math.max(0, Number(p.bytes) || 0),
        }))
      : [],
    completedActions: Array.isArray(raw.completedActions)
      ? raw.completedActions.map(x => clamp(x, 220)).filter(Boolean).slice(-12)
      : [],
    pendingApprovalIds: Array.isArray(raw.pendingApprovalIds)
      ? [...new Set(raw.pendingApprovalIds.map(x => String(x || '').trim()).filter(Boolean))].slice(0, 12)
      : [],
    elevationId: clamp(raw.elevationId || '', 80),
    resumeDepth: Math.max(0, Math.min(4, Math.round(Number(raw.resumeDepth) || 0))),
    createdAt,
    expiresAt: Math.max(0, Number(raw.expiresAt) || (createdAt + DEFAULT_RESUME_TTL_MS)),
    resolvedAt: Math.max(0, Number(raw.resolvedAt) || 0),
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

export function pushAuditToWs(ws, entry = {}, sessionId = '') {
  if (!ws || typeof ws !== 'object') return null
  if (!Array.isArray(ws.auditLog)) ws.auditLog = []
  const norm = normalizeAuditEntry(entry)
  if (!norm) return null
  ws.auditLog.push(norm)
  if (ws.auditLog.length > AUDIT_LOG_CAP) ws.auditLog = ws.auditLog.slice(-AUDIT_LOG_CAP)
  appendAuditJsonlLine({
    ...(sessionId ? { sessionId: String(sessionId) } : {}),
    ...norm,
  })
  return norm
}

function emptyWorkspace() {
  return {
    config: null,
    chiefRiskAck: null,
    pendingApprovals: [],
    pendingElevation: null,
    resumeTasks: [],
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
  base.chat = (Array.isArray(src.chat) ? src.chat : [])
    .filter(item => item && typeof item === 'object' && typeof item.text === 'string')
    .slice(-CHAT_CAP)
    .map(item => {
      const imageCount = Math.max(0, Math.round(Number(item.imageCount) || 0))
      const kind = item.kind === 'receipt' ? 'receipt' : (item.kind === 'qa' ? 'qa' : '')
      const resumeTaskId = item.resumeTaskId ? String(item.resumeTaskId) : ''
      return {
        id: String(item.id || nextId('chat')),
        role: item.role === 'user' ? 'user' : 'chief',
        text: cleanMultiline(item.text, 2000),
        target: item.target ? String(item.target) : '',
        ...(kind ? { kind } : {}),
        ...(resumeTaskId ? { resumeTaskId } : {}),
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
  base.resumeTasks = (Array.isArray(src.resumeTasks) ? src.resumeTasks : [])
    .map(normalizeResumeTask)
    .filter(Boolean)
    .slice(-RESUME_TASKS_CAP)
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
  return norm
}

export function requestChiefElevation(sessionId = 'global', req = {}) {
  const rootId = String(sessionId || 'global').trim() || 'global'
  return mutateChiefState((state) => {
    const ws = ensureWorkspace(state, rootId)
    return enqueueElevationToWs(ws, { ...(req && typeof req === 'object' ? req : {}), sessionId: rootId })
  })
}

export function upsertResumeTaskOnWs(ws, rawTask = {}) {
  if (!ws || typeof ws !== 'object') return null
  if (!Array.isArray(ws.resumeTasks)) ws.resumeTasks = []
  const existingIdx = rawTask.id ? ws.resumeTasks.findIndex(t => t && t.id === rawTask.id) : -1
  if (existingIdx >= 0) {
    const prev = ws.resumeTasks[existingIdx]
    const merged = normalizeResumeTask({
      ...prev,
      ...rawTask,
      completedActions: rawTask.appendCompletedAction
        ? [...(prev.completedActions || []), rawTask.appendCompletedAction]
        : (rawTask.completedActions || prev.completedActions),
      pendingApprovalIds: rawTask.pendingApprovalIds || prev.pendingApprovalIds,
    })
    if (merged) ws.resumeTasks[existingIdx] = merged
    return merged
  }
  const created = normalizeResumeTask(rawTask)
  if (!created) return null
  ws.resumeTasks.push(created)
  if (ws.resumeTasks.length > RESUME_TASKS_CAP) {
    ws.resumeTasks = ws.resumeTasks.slice(-RESUME_TASKS_CAP)
  }
  return created
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

export function loadChiefState({ forceDisk = false } = {}) {
  const file = stateFilePath()
  try {
    const stat = fs.statSync(file)
    if (!forceDisk && cachedState && stat.mtimeMs === cachedMtime) return cachedState
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    cachedState = normalizeState(parsed)
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

export function extractJsonObject(raw) {
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
