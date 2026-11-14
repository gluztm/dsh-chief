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
  loadArchiveStore,
  listArchiveHeaders,
  getArchiveDetail,
  searchArchives,
  smartParseNoteToDossier,
  applyChiefArchiveCurations,
} from './archives.js'

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

function emptyWorkspace() {
  return {
    facts: [],
    narrative: { hash: '', text: '', at: 0, byModel: '' },
    suggestions: [],
    chat: [],
    mailbox: [],
    seenMailAt: {},
    seenFactsAt: {},
    reviewCursors: {},
  }
}

function normalizeFact(raw) {
  if (!raw || typeof raw !== 'object') return null
  const text = clamp(raw.text, FACT_TEXT_MAX)
  if (!text || secretLike(text)) return null
  const validCategories = ['discipline', 'architecture', 'progress', 'preference', 'team']
  const category = validCategories.includes(raw.category) ? raw.category : 'discipline'
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : nextId('fact'),
    text,
    category,
    by: clamp(raw.by || 'chief', 36),
    source: clamp(raw.source || '', 60),
    pinned: Boolean(raw.pinned),
    addedAt: Number(raw.addedAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Number(raw.addedAt) || Date.now(),
  }
}

function normalizeSuggestion(raw) {
  if (!raw || typeof raw !== 'object') return null
  const title = clamp(raw.title, 90)
  if (!title) return null
  const kind = raw.kind === 'bound' ? 'bound' : raw.kind === 'board' ? 'board' : 'relay'
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
    target: clamp(raw.target || (kind === 'bound' ? 'bounds' : 'lead'), 64),
    targetLabel: clamp(raw.targetLabel || raw.target || (kind === 'bound' ? '工作边界' : '主对话'), 40),
    mode: ['steer', 'followup', 'silent'].includes(raw.mode) ? raw.mode : 'steer',
    draftText: cleanMultiline(raw.draftText || '', 600),
    boardOp: raw.boardOp && typeof raw.boardOp === 'object' ? raw.boardOp : null,
    status: ['pending', 'applied', 'dismissed'].includes(raw.status) ? raw.status : 'pending',
    createdAt: Number(raw.createdAt) || Date.now(),
  }
}

function normalizeMail(raw) {
  if (!raw || typeof raw !== 'object') return null
  const imageCount = Math.max(0, Math.round(Number(raw.imageCount) || 0))
  const text = cleanMultiline(raw.text, 1500) || (imageCount > 0 ? `[附图 ×${imageCount}]` : '')
  if (!text) return null
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : nextId('mail'),
    from: clamp(raw.from || 'agent', 48),
    fromSession: String(raw.fromSession || ''),
    to: clamp(raw.to || 'lead', 64),
    toSession: String(raw.toSession || ''),
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
  return base
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
  const validPaces = ['manual', 'smart', 'auto']
  // Default to 'manual' (human-paced, zero background token burn) unless explicitly set to smart/auto
  const paceMode = validPaces.includes(cfg.paceMode) ? cfg.paceMode : 'manual'
  return {
    version: STATE_VERSION,
    config: {
      modelRef: typeof cfg.modelRef === 'string' ? cfg.modelRef.trim() : '',
      paceMode,
      autoPilot: paceMode === 'auto',
      autoReview: paceMode !== 'manual',
    },
    links,
    workspaces,
  }
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

export function setPeerLink(rootA, rootB, linked) {
  const a = String(rootA || '').trim()
  const b = String(rootB || '').trim()
  if (!a || !b || a === b) return { ok: false, error: '需要两个不同的主会话才能建立协同连接' }
  return mutateChiefState((state) => {
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
    return { ok: true, cluster: getLinkedCluster(state, a) }
  })
}

function ensureWorkspace(state, rootId) {
  const key = String(rootId || 'global').trim() || 'global'
  if (!state.workspaces[key]) state.workspaces[key] = emptyWorkspace()
  return state.workspaces[key]
}

/** Merge facts & mailbox across all linked peer sessions in the federation cluster. */
function clusterView(state, rootId) {
  const cluster = getLinkedCluster(state, rootId)
  const primary = ensureWorkspace(state, rootId)
  if (cluster.length <= 1) {
    return {
      cluster,
      primary,
      facts: primary.facts,
      mailbox: primary.mailbox,
      suggestions: primary.suggestions.filter(s => s.status === 'pending'),
      chat: primary.chat,
      narrative: primary.narrative,
    }
  }
  const factMap = new Map()
  const mailMap = new Map()
  for (const sid of cluster) {
    const ws = ensureWorkspace(state, sid)
    for (const f of ws.facts) factMap.set(f.id, f)
    for (const m of ws.mailbox) mailMap.set(m.id, m)
  }
  const facts = [...factMap.values()].sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0)).slice(-FACTS_CAP)
  const mailbox = [...mailMap.values()].sort((a, b) => (a.at || 0) - (b.at || 0)).slice(-MAIL_CAP)
  return {
    cluster,
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
  let selectedRef = state.config.modelRef || ''

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

export async function callChiefLlm(deps, { sessionId = '', system, prompt, maxTokens = SUMMARY_MAX_TOKENS, imageBlocks = [] }) {
  const safeImages = Array.isArray(imageBlocks) ? imageBlocks : []
  if (deps && typeof deps.callLlmOverride === 'function') {
    return deps.callLlmOverride({ sessionId, system, prompt, maxTokens, imageBlocks: safeImages })
  }
  const llm = deps.getLlm ? deps.getLlm() : null
  if (!llm || typeof llm.stream !== 'function') {
    return { ok: false, error: '当前环境未挂载 LLM 服务' }
  }
  const catalog = await listChiefModels(deps, false, sessionId)
  const regSet = typeof llm.listProviders === 'function'
    ? new Set((llm.listProviders() || []).filter(p => p && p.id && !String(p.id).startsWith('local-agent')).map(p => String(p.id)))
    : null
  let queue = buildRouteQueue(catalog.models, catalog.selectedRef, catalog.followRef || catalog.defaultRef, deps, sessionId, regSet)
  if (!queue.length) {
    return { ok: false, error: '未找到可用的参谋长模型，请在 DSH 设置中配置模型供应商' }
  }

  if (safeImages.length > 0) {
    queue = await filterVisionRoutes(llm, queue)
    if (!queue.length) {
      return {
        ok: false,
        error: '当前参谋长及备选模型均不支持图片输入（仅纯文本），请在右上角切换支持视觉的多模态模型（如 Gemini / Claude / GPT-4o / Qwen-VL 等）后再试。',
      }
    }
  }

  let lastError = '模型返回内容为空'
  for (const route of queue.slice(0, 4)) {
    try {
      const res = await callOneRoute(llm, route, system, prompt, maxTokens, sessionId, safeImages)
      if (res.text) return { ok: true, text: res.text, modelRef: res.modelRef }
      lastError = `${route.ref} 返回内容为空`
      markRouteFailure(route, new Error(lastError))
    } catch (err) {
      lastError = String(err && err.message ? err.message : err)
      markRouteFailure(route, err)
    }
  }
  return { ok: false, error: lastError }
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
export async function deliverCrossMessage(deps, {
  fromSession = '',
  fromLabel = 'DSH 参谋长',
  target = 'lead',
  text = '',
  subject = '',
  mode = 'steer',
  images = [],
  imageBlocks: preAdmittedBlocks = null,
  recordBoardLog = true,
}) {
  const cleanBody = cleanMultiline(text, 2400)
  const rawImages = Array.isArray(images) ? images : []
  const hasPreAdmitted = Array.isArray(preAdmittedBlocks) && preAdmittedBlocks.length > 0
  if (!cleanBody && !rawImages.length && !hasPreAdmitted) {
    return { ok: false, error: '递话内容不能为空' }
  }

  let admittedBlocks = hasPreAdmitted ? preAdmittedBlocks : []
  if (!hasPreAdmitted && rawImages.length > 0) {
    try {
      admittedBlocks = await admitChiefImages(deps, rawImages)
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err) }
    }
  }
  const effectiveText = cleanBody || (admittedBlocks.length ? '请查看随信附带的图片。' : '')
  const imgTag = admittedBlocks.length > 0 ? ` [附图 ×${admittedBlocks.length}]` : ''

  const rootId = deps.resolveRootSessionId(fromSession) || String(fromSession || '')
  const directory = await listPeerDirectory(deps, rootId || fromSession)
  const rawTarget = String(target || 'lead').trim().replace(/^@/, '')

  // Broadcast support: 'all' / '全体' / 'team'
  if (['all', 'team', '全体', '所有人'].includes(rawTarget.toLowerCase())) {
    const recipients = directory.targets.filter(t => t.id !== fromSession)
    const deliveries = []
    for (const peer of recipients) {
      const res = await deliverSinglePeer(deps, directory, peer, {
        fromSession,
        fromLabel,
        text: effectiveText,
        subject,
        mode,
        imageBlocks: admittedBlocks,
        recordBoardLog: false,
      })
      deliveries.push({ target: peer.handle, ok: res.ok, mode: res.deliveryMode })
    }
    if (recordBoardLog && rootId) {
      deps.appendBoardLog(rootId, `📡 ${fromLabel} 向全体成员广播递话（${deliveries.filter(d => d.ok).length} 个目标）：${clamp(effectiveText, 56)}${imgTag}`, fromLabel)
    }
    return { ok: true, broadcast: true, deliveries }
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
    fromLabel,
    text: effectiveText,
    subject,
    mode,
    imageBlocks: admittedBlocks,
    recordBoardLog,
  })
}

async function deliverSinglePeer(deps, directory, peer, { fromSession, fromLabel, text, subject, mode, imageBlocks = [], recordBoardLog }) {
  const runtime = deps.runtime
  const agentsSvc = runtime ? runtime.get('agents') : null
  const subagentsSvc = runtime ? runtime.get('subagents') : null
  const safeBlocks = Array.isArray(imageBlocks) ? imageBlocks : []
  const imgCount = safeBlocks.length
  const imgSuffix = imgCount > 0 ? ` [附图 ×${imgCount}]` : ''
  const headerTag = mode === 'steer'
    ? `[DSH 参谋长插话 · 来自 ${fromLabel}]`
    : `[DSH 参谋长递话 · 来自 ${fromLabel}]`
  const formatted = `${headerTag}${subject ? ' ' + subject : ''}\n${text}\n\n（如需回信或同步进展，可调用参谋看板 chief_board({ action: "mail.send", target: "${fromLabel === 'DSH 参谋长' ? 'lead' : fromLabel}", text: "…" })）`

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

  const mailItem = normalizeMail({
    id: nextId('mail'),
    from: fromLabel,
    fromSession,
    to: peer.handle,
    toSession: peer.id || peer.key,
    subject,
    text: imgCount > 0 ? `${text}${imgSuffix}` : text,
    imageCount: imgCount,
    mode,
    deliveredPhysical,
    readBy: recipientMarks,
    at: Date.now(),
  })

  mutateChiefState((state) => {
    const ws = ensureWorkspace(state, peer.rootId || directory.rootId)
    ws.mailbox.push(mailItem)
    if (ws.mailbox.length > MAIL_CAP) ws.mailbox = ws.mailbox.slice(-MAIL_CAP)
  })

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

    // 1. Unread mailbox messages addressed to this session/handle
    for (const mail of view.mailbox) {
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

const SUMMARY_FORMAT_REV = 'v2.1-structured-bullets'

const NARRATIVE_SYSTEM = [
  '你是「DSH 参谋长」（如同统揽全局的宰相），负责把当前工作区和协同团队的目标、进展、纪律与红线边界，提炼成用户一眼扫完就能掌握全局的「摘要」。',
  '严格遵守以下【简明结构化 · 分点作答】规范：',
  '1. 使用简体中文，语气精炼干脆、直击要害，严禁寒暄套话与冗长铺垫。',
  '2. 全文分为 2 到 4 个模块，每个模块以一行 `## 模块短标题` 开头（如 `## 核心目标与态势`、`## 关键结论与进展`、`## 协作纪律与红线`、`## 协作纪律与边界`）。',
  '3. **每个模块下方必须全部使用 `- ` 分点列表作答（严禁写成挤在一起的长段落散文！）**。每一点控制在 1 行（最多不超过 2 行），推荐在要点开头用方括号短标签提亮，如 `- 【总目标】…`、`- 【推进中】…`、`- 【已完】…`、`- 【已验证】…`、`- 【结论】…`、`- 【待办】…`、`- 【待收尾】…`、`- 【注意】…`、`- 【归因纪律】…`、`- 【收尾纪律】…`、`- 【并列直接原因】…`、`- 【受阻】…`、`- 【禁止红线】…`、`- 【允许范围】…`。',
  '4. **去噪与聚合铁律**：遇到大量同前缀或已结束的后台巡检子代理（如 `mnemon-review-*`），**严禁逐一报菜名罗列**，必须合并成一句话统计（如 `- 【团队】1 名子代理运行中，其余 12 名历史巡检已结束`）；自动忽略 `[dsh-mnemon:...]` 等系统内部检查点噪音。',
  '5. 具体路径、端口、版本号、命令原样保留，同一事实绝不重复，只陈述真实输入，第一个 `## ` 之前不要输出任何多余字符。',
].join('\n')

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

function buildNarrativeInput({ board, facts, cluster, targets }) {
  const bounds = (board && board.bounds) || { allowed: [], forbidden: [], notes: [] }
  const tasks = Array.isArray(board && board.tasks) ? board.tasks : []
  const memory = (Array.isArray(board && board.memory) ? board.memory : [])
    .filter(m => m && !isInternalCheckpointNoise(m.title || m.text))
  const anchors = (Array.isArray(board && board.notes) ? board.notes : []).filter(n => (n.tags || []).includes('anchor'))

  const lines = []
  if (board && board.objective) lines.push(`当前总目标：${board.objective}`)
  if ((bounds.forbidden || []).length) lines.push(`禁止红线：${bounds.forbidden.join('；')}`)
  if ((bounds.allowed || []).length) lines.push(`允许范围：${bounds.allowed.join('；')}`)
  if ((bounds.notes || []).length) lines.push(`边界注意：${bounds.notes.join('；')}`)

  if (cluster.length > 1) {
    lines.push(`跨窗口协同频道：当前已串联 ${cluster.length} 个主对话窗口协同作业。`)
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

  return lines.join('\n').trim()
}

/** Deterministic structured bullet summary when no LLM key is configured or while first summary is warming up. */
function buildFallbackNarrative({ board, facts, targets }) {
  const sections = []
  const tasks = Array.isArray(board && board.tasks) ? board.tasks : []
  const blocked = tasks.filter(t => t.status === 'blocked')
  const doing = tasks.filter(t => t.status === 'doing')
  const todo = tasks.filter(t => t.status === 'todo')
  const done = tasks.filter(t => t.status === 'done')
  const workers = targets.filter(t => t.kind === 'subagent' && !/^mnemon-(?:review|run)/i.test(String(t.name || t.key || '')))

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
  for (const a of (bounds.allowed || []).slice(0, 4)) ruleBullets.push(`- 【允许范围】${clamp(a, 110)}`)
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

export async function getChiefView(deps, sessionId, { regenerate = false, autoSummarize = false } = {}) {
  const rootId = deps.resolveRootSessionId(sessionId) || String(sessionId || 'global')
  const directory = await listPeerDirectory(deps, rootId)
  const board = deps.boardForSession(deps.boardFileFor(rootId))
  const state = loadChiefState()
  const view = clusterView(state, rootId)
  const modelsInfo = await listChiefModels(deps, false, rootId)
  const paceMode = (state.config && state.config.paceMode) || 'manual'

  const rawInput = buildNarrativeInput({
    board,
    facts: view.facts,
    cluster: directory.cluster,
    targets: directory.targets,
  })
  const inputHash = rawInput
    ? crypto.createHash('sha256').update(SUMMARY_FORMAT_REV + '\n' + rawInput).digest('hex').slice(0, 24)
    : 'empty'

  const hasSaved = Boolean(view.narrative && view.narrative.text)
  const lastSummaryAt = Number((view.narrative && view.narrative.at) || 0)
  const isFresh = !rawInput || (hasSaved && view.narrative.hash === inputHash)
  const cooledForAuto = Date.now() - lastSummaryAt >= AUTO_SUMMARY_COOLDOWN_MS
  const allowBackgroundSummary = paceMode === 'auto' && autoSummarize && !isFresh && cooledForAuto

  // Human-paced rule: ONLY call LLM when operator explicitly clicked Regenerate (`regenerate: true`),
  // OR when operator explicitly chose `paceMode === 'auto'` AND the 5-minute cooldown has elapsed!
  if (rawInput && (regenerate || allowBackgroundSummary) && modelsInfo.available && !summarizingLocks.has(rootId)) {
    const job = (async () => {
      const res = await callChiefLlm(deps, {
        sessionId: rootId,
        system: NARRATIVE_SYSTEM,
        prompt: rawInput + '\n\n请按上述规范输出简体中文摘要：',
        maxTokens: SUMMARY_MAX_TOKENS,
      })
      if (res.ok && res.text) {
        mutateChiefState((s) => {
          const ws = ensureWorkspace(s, rootId)
          ws.narrative = {
            hash: inputHash,
            text: res.text,
            at: Date.now(),
            byModel: res.modelRef || '',
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
  const hasLatestSaved = Boolean(latestView.narrative && latestView.narrative.text)
  const latestFresh = !rawInput || (hasLatestSaved && latestView.narrative.hash === inputHash)
  const narrativeText = hasLatestSaved
    ? latestView.narrative.text
    : buildFallbackNarrative({ board, facts: latestView.facts, targets: directory.targets })

  return {
    ok: true,
    rootId,
    config: latestState.config,
    models: modelsInfo,
    narrative: {
      text: narrativeText,
      at: hasLatestSaved ? (latestView.narrative.at || 0) : (board.updatedAt || 0),
      byModel: hasLatestSaved ? (latestView.narrative.byModel || '') : '',
      isLiveZeroToken: !hasLatestSaved,
      hasUnsummarizedChanges: Boolean(rawInput && !latestFresh),
      summarizing: summarizingLocks.has(rootId),
      fresh: latestFresh,
    },
    facts: latestView.facts.slice().reverse(),
    suggestions: latestView.suggestions.slice().reverse(),
    chat: latestView.chat.slice(-20),
    mailbox: latestView.mailbox.slice(-30).reverse(),
    peers: directory.targets,
    otherSessions: directory.otherSessions,
    cluster: directory.cluster,
  }
}

/* -------------------------------------------------------------------------- */
/* Chief Command Bar: All-Seeing Strategist + Relay + Bounds + Board Ops  */
/* -------------------------------------------------------------------------- */

const ASK_CHIEF_SYSTEM = [
  '你是「DSH 参谋长」（DSH Chief）——统揽主对话、子代理团队与跨窗口协同的全能参谋宰相。',
  '你**绝不只是**被动的记忆检索器或传话筒！你实时掌握：',
  '1) 主代理（@lead）与各子代理的**实时对话流快照**（刚刚说了什么、正在调什么工具、卡在哪里）；',
  '2) 参谋看板总目标、实时断点游标（cursor）、计划（plan）与任务拓扑（推进中 / 受阻 / 待办 / 已完成证据）；',
  '3) 双层工作边界（📌 定住全局跨任务共享边界 vs 仅当前任务边界）与持久记忆、便签、协同信箱。',
  '',
  '请精准洞悉用户意图（态势汇报、卡点诊断、战术参谋、拆话传话、代维护看板、记忆管理、提炼或浓缩零散边界），并**只输出一个合法 JSON 对象**：',
  '{',
  '  "reply": "必须【简明、结构化、分点作答】！用换行 `- 【标签】结论` 列出（优先使用语义清晰标签：如【总目标】【推进中】【已完】【已验证】【结论】【待办】【待收尾】【注意】【归因纪律】【并列直接原因】【受阻】【禁止红线】【下一步建议】），直给干货，绝不说『记忆里没有这条』，绝不堆砌废话或暴露内部 sessionId",',
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
  '    { "op": "cursor.set", "step": "当前步骤", "next": "下一步具体动作", "blocked": "阻塞点（无则空串）" },',
  '    { "op": "bounds.forbid", "item": "用户明确下令立即写入的禁止红线", "pinGlobal": false },',
  '    { "op": "bounds.allow", "item": "用户明确下令立即写入的允许范围", "pinGlobal": false }',
  '  ]',
  '}',
  '',
  '宰相参谋与行事准则：',
  '- 【问进展 / 问卡点 / 求建议】：结合「实时对话流快照」+「任务图」+「断点游标」综合研判！就算模型还没把最新动作写进参谋看板，你也要从实时对话流里看出主代理和子代理正在干什么、刚跑了什么命令、取得了什么结论或卡在什么报错上，并主动给出 1~2 条切中要害的下一步建议。',
  '- 【代维护看板】：当用户让你「把某任务标为完成/受阻」「记一下下一步干啥」「改总目标」时，直接通过 `boardOps`（`task.update` / `cursor.set` / `objective.set` / `task.add`）落实。',
  '- 【该传必传、该记必记】：用户要求转告/催促/纠偏某代理时生成精准 `relays`（急切纠偏用 `steer`，派下一步用 `followup`，同步背景用 `silent`）；用户立长期规矩或交代关键事实时写入 `memoryChanges`。',
  '- 【边界奏请与零散浓缩】：',
  '  1) 总结踩坑红线时，生成 `boundProposals` 呈交用户拍板（若用户提到「全局定住/以后所有任务都生效」则设 `"pinGlobal": true`）；只有用户明确下令「直接写进禁止/允许边界」时才用 `boardOps`。',
  '  2) 当用户要求「把重要的零散边界总结成一条 / 合并重复边界」时，仔细阅读现有边界，保留关键命令名/路径/硬红线，浓缩为 1 条精炼总则放入 `boundProposals[0].item`，并把被它吸收替代的旧条文原样放进 `replaces` 数组（若被合并旧规中含 📌 全局定住项，则 `"pinGlobal": true`）。',
  '- 【看图与带图拆话】：当用户附带上传图片时，请直接结合图片画面诊断 UI 样式、报错截图或架构图；若你在 relays 中向代理拆话派活，系统会自动把用户附带的图片一并转送给目标代理。',
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

function applyFactChanges(ws, numberedFacts, changes, actor = 'user') {
  const applied = []
  if (!Array.isArray(changes) || !changes.length) return applied

  for (const ch of changes.slice(0, 12)) {
    if (!ch || typeof ch !== 'object') continue
    const op = String(ch.op || '').trim()
    if (op === 'add') {
      const fact = normalizeFact({
        text: ch.text,
        category: ch.category || 'discipline',
        by: actor,
        source: 'chief',
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

function applyBoardOps(deps, rootId, boardOps) {
  const executed = []
  if (!Array.isArray(boardOps) || !boardOps.length) return executed

  for (const opItem of boardOps.slice(0, 10)) {
    if (!opItem || typeof opItem !== 'object') continue
    const op = String(opItem.op || '').trim()
    if (op === 'objective.set' && opItem.objective) {
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
    } else if ((op === 'bounds.forbid' || op === 'bounds.allow') && opItem.item) {
      const field = op === 'bounds.forbid' ? 'forbidden' : 'allowed'
      const val = clamp(opItem.item, 220)
      const pinned = Boolean(opItem.pinGlobal)
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
          executed.push(`${pinned ? '📌全局' : '本任务'}${field === 'forbidden' ? '红线' : '允许'}：${clamp(val, 30)}`)
        }
      }
    }
  }
  return executed
}

/**
 * Holistic offline/fallback intelligence synthesizer so DSH Chief NEVER
 * utters "记忆里没有这条" even if every configured LLM provider is unreachable.
 */
function buildSmartFallbackReply({ input, board, liveDigest, directory, facts = [], mailbox = [] }) {
  const q = String(input || '').trim()
  const qLower = q.toLowerCase()
  const tasks = Array.isArray(board && board.tasks) ? board.tasks : []
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

  const asksBounds = /边界|红线|禁止|允许|规矩|约束/.test(q)
  const asksTeam = /子代理|团队|谁在|分工|成员|subagent|worker/i.test(qLower)
  const asksBlocked = /卡在哪|受阻|阻塞|报错|问题|风险|撞墙|block/i.test(qLower)
  const asksProgress = /进展|进度|怎么样|到哪|在干嘛|干什么|情况|状态|汇报|总结|下一步|status|progress/i.test(qLower)

  const bullets = []

  if (asksBounds) {
    const fList = bounds.forbidden || []
    const aList = bounds.allowed || []
    const nList = bounds.notes || []
    const pinCount = (pinnedBounds.forbidden?.length || 0) + (pinnedBounds.allowed?.length || 0) + (pinnedBounds.notes?.length || 0)
    bullets.push(`- 【生效边界概览】共 ${fList.length + aList.length + nList.length} 条生效（其中 📌 定住全局共享 ${pinCount} 条）。`)
    if (fList.length) bullets.push(`- 【禁止红线】${fList.slice(0, 5).map(x => (pinnedBounds.forbidden?.includes(x) ? '📌' : '') + clamp(x, 60)).join('；')}`)
    if (aList.length) bullets.push(`- 【允许范围】${aList.slice(0, 4).map(x => (pinnedBounds.allowed?.includes(x) ? '📌' : '') + clamp(x, 60)).join('；')}`)
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
  const BOUND_COL_LABEL = { forbidden: '禁止红线', allowed: '允许范围', notes: '注意事项' }

  // Determine which column(s) to consolidate
  const targetCols = []
  const explicitItems = Array.isArray(items)
    ? items.map(x => String(x || '').trim()).filter(Boolean)
    : []

  if (['forbidden', 'allowed', 'notes'].includes(field)) {
    const colList = Array.isArray(bounds[field]) ? bounds[field] : []
    const chosen = explicitItems.length >= 2
      ? colList.filter(x => explicitItems.includes(x))
      : colList
    if (chosen.length < 2) {
      return { ok: false, error: `【${BOUND_COL_LABEL[field]}】当前不足 2 条规则，无需浓缩合并。` }
    }
    targetCols.push({ col: field, sourceItems: chosen })
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
  ids = [],
  folder = '',
  scope = 'unorganized',
  instruction = '',
} = {}) {
  const rootId = (deps.resolveRootSessionId && deps.resolveRootSessionId(sessionId)) || String(sessionId || 'global')
  const sharedFile = typeof deps.sharedBoardFile === 'function' ? deps.sharedBoardFile() : deps.sharedBoardFile
  const store = loadArchiveStore(sharedFile)

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

  const applied = applyChiefArchiveCurations(allCurations, allNewFolders, sharedFile)
  const refreshedList = listArchiveHeaders(rootId, {}, sharedFile)
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

  let imageBlocks = []
  if (rawImages.length > 0) {
    try {
      imageBlocks = await admitChiefImages(deps, rawImages)
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err) }
    }
  }

  const input = rawInput || '请结合我上传的图片进行分析处理。'
  const userDisplayText = rawInput || `[上传图片 ×${imageBlocks.length}]`
  const imgMeta = imageBlocks.length > 0 ? { imageCount: imageBlocks.length } : {}

  const rootId = deps.resolveRootSessionId(sessionId) || String(sessionId || 'global')
  const directory = await listPeerDirectory(deps, rootId)
  const board = deps.boardForSession(deps.boardFileFor(rootId))
  const state = loadChiefState()
  const view = clusterView(state, rootId)

  // Fast path: if user explicitly picked a concrete target pill AND used direct relay mode without asking chief to decompose
  if (forcedTarget && forcedTarget !== 'auto') {
    const delivery = await deliverCrossMessage(deps, {
      fromSession: rootId,
      fromLabel: '用户 (经 DSH 参谋长)',
      target: forcedTarget,
      text: rawInput || '请查看随信附带的图片。',
      mode: ['steer', 'followup', 'silent'].includes(forcedMode) ? forcedMode : 'steer',
      imageBlocks,
    })
    const reply = delivery.ok
      ? `已按你的指定向 ${delivery.target || forcedTarget} ${forcedMode === 'steer' ? '插话' : forcedMode === 'silent' ? '投递备忘纸条' : '递话'}${imageBlocks.length ? `（附带 ${imageBlocks.length} 张图片）` : ''}${delivery.note ? '（' + delivery.note + '）' : '。'}`
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
      memoryChanges: [],
      boardOps: [],
      view: await getChiefView(deps, rootId, { autoSummarize: false }),
    }
  }

  // Direct natural-language command to organize/curate the Engineering Archive Cabinet (`整理档案` / `收纳档案`)
  if (!forcedTarget || forcedTarget === 'auto') {
    if (/(?:档案|卷宗|老笔记)/.test(input) && /(?:整理|收纳|归类|分拣|拆解)/.test(input)) {
      const orgRes = await organizeArchivesWithChief(deps, {
        sessionId: rootId,
        scope: /全部|所有|全柜/.test(input) ? 'all' : 'unorganized',
        instruction: input,
      })
      if (orgRes.ok) {
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

  // On-demand lazy archive lookup ONLY when the user explicitly asks about archives / historical engineering records
  const asksArchiveExplicitly = /(?:档案|卷宗|归档|以前|历史记录|工程坐标|老笔记|查一下.*(?:怎么|路径|命令|配置))/.test(input)
  const onDemandArchiveLines = []
  if (asksArchiveExplicitly) {
    const sharedFile = typeof deps.sharedBoardFile === 'function' ? deps.sharedBoardFile() : deps.sharedBoardFile
    const found = searchArchives(input, { limit: 4 }, sharedFile)
    if (found.ok && found.hits.length > 0) {
      onDemandArchiveLines.push('', '## 7. 按需调取的沉淀工程档案（仅因用户本次提问涉及历史档案而临时检索）')
      for (let i = 0; i < found.hits.length; i += 1) {
        const hit = found.hits[i]
        onDemandArchiveLines.push(`- 📎 [${hit.folderLabel}] 《${hit.title}》：${hit.summary}`)
        if (i < 2) {
          const det = getArchiveDetail(hit.id, rootId, sharedFile)
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
    `- 允许范围 (allowed): ${fmtBoundCol('allowed')}`,
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
    ...(view.mailbox.slice(-4).map(m => `- [信箱 ${m.from} → @${m.to}] ${clamp(m.text, 120)}`)),
    ...onDemandArchiveLines,
    '',
    '## 用户刚刚对你说的话：',
    input,
    ...(imageBlocks.length > 0 ? [`\n（附带 ${imageBlocks.length} 张用户上传图片，请直接查看图片内容作答）`] : []),
  ]

  const llmRes = await callChiefLlm(deps, {
    sessionId: rootId,
    system: ASK_CHIEF_SYSTEM,
    prompt: promptLines.join('\n'),
    maxTokens: SUMMARY_MAX_TOKENS,
    imageBlocks,
  })

  if (imageBlocks.length > 0 && !llmRes.ok) {
    return {
      ok: false,
      error: llmRes.error || '当前参谋长模型无法识别图片，请在右上角切换支持视觉的多模态模型后重试',
    }
  }

  let parsed = llmRes.ok ? extractJsonObject(llmRes.text) : null

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
      })
      const fallbackReply = delivery.ok
        ? `- 【已递话】已向 @${delivery.target} 插话传达指令。`
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
        memoryChanges: [],
        boardOps: [],
        view: await getChiefView(deps, rootId, { autoSummarize: false }),
      }
    }

    // 2) Natural-language request to consolidate scattered boundaries into one
    if (!imageBlocks.length && /边界|红线/.test(input) && /总结成一条|合并成一条|浓缩|合一|整合/.test(input)) {
      const targetCol = /允许/.test(input) ? 'allowed' : /注意/.test(input) ? 'notes' : ''
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

    // 3) If LLM actually returned readable prose (just not wrapped in JSON), use it; otherwise synthesize smart live briefing
    const usablePlainLlm = llmRes.ok && llmRes.text && !llmRes.text.trim().startsWith('{')
      ? cleanMultiline(llmRes.text, 900)
      : ''
    const archiveFallback = onDemandArchiveLines.length > 1
      ? ['- 【已从沉淀档案柜按需检索到以下卷宗】', ...onDemandArchiveLines.slice(2)].join('\n')
      : ''
    const replyText = usablePlainLlm || archiveFallback || buildSmartFallbackReply({
      input,
      board,
      liveDigest,
      directory,
      facts: numberedFacts,
      mailbox: view.mailbox,
    })

    mutateChiefState((s) => {
      const ws = ensureWorkspace(s, rootId)
      ws.chat.push(
        { id: nextId('chat'), role: 'user', text: userDisplayText, ...imgMeta, actions: [], at: Date.now() },
        { id: nextId('chat'), role: 'chief', text: replyText, actions: [], at: Date.now() },
      )
      if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
    })
    return {
      ok: true,
      reply: replyText,
      relays: [],
      memoryChanges: [],
      boardOps: [],
      view: await getChiefView(deps, rootId, { autoSummarize: false }),
    }
  }

  // Execute decomposed relays
  const relayResults = []
  const actionBadges = []
  for (const r of (Array.isArray(parsed.relays) ? parsed.relays : []).slice(0, 8)) {
    if (!r || !r.text) continue
    const deliv = await deliverCrossMessage(deps, {
      fromSession: rootId,
      fromLabel: 'DSH 参谋长 (代用户传达)',
      target: r.target || 'lead',
      subject: r.subject || '',
      text: r.text,
      mode: ['steer', 'followup', 'silent'].includes(r.mode) ? r.mode : 'steer',
      imageBlocks,
    })
    relayResults.push(deliv)
    if (deliv.ok) actionBadges.push(`${r.mode === 'steer' ? '插话' : '递话'} → ${deliv.target}`)
  }

  // Execute board ops
  const executedBoardOps = applyBoardOps(deps, rootId, parsed.boardOps)
  for (const b of executedBoardOps) actionBadges.push(b)

  // Execute durable memory changes & Prime Minister bound proposals (including N-in-1 consolidation)
  let appliedFacts = []
  const proposedBounds = []
  const existingBounds = (board && board.bounds) || { allowed: [], forbidden: [], notes: [] }
  const rawBoundProposals = Array.isArray(parsed.boundProposals) ? parsed.boundProposals.slice(0, 4) : []
  const replyText = cleanMultiline(parsed.reply || '- 【已执行】已按你的吩咐安排妥当。', 1000)

  const BOUND_COL_LABEL = { forbidden: '禁止红线', allowed: '允许范围', notes: '注意事项' }

  mutateChiefState((s) => {
    const ws = ensureWorkspace(s, rootId)
    appliedFacts = applyFactChanges(ws, numberedFacts, parsed.memoryChanges, 'user')
    for (const f of appliedFacts) {
      actionBadges.push((f.op === 'add' ? '记入：' : f.op === 'edit' ? '修订：' : '移除：') + clamp(f.text, 24))
    }

    for (const bp of rawBoundProposals) {
      if (!bp || typeof bp !== 'object') continue
      const col = ['forbidden', 'allowed', 'notes'].includes(bp.field) ? bp.field : 'forbidden'
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

    ws.chat.push(
      { id: nextId('chat'), role: 'user', text: userDisplayText, ...imgMeta, actions: [], at: Date.now() },
      { id: nextId('chat'), role: 'chief', text: replyText, actions: actionBadges, at: Date.now() },
    )
    if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
  })

  // Refresh narrative summary in background if facts or board changed
  const shouldRefreshNarrative = appliedFacts.length > 0 || executedBoardOps.length > 0
  const freshView = await getChiefView(deps, rootId, { autoSummarize: shouldRefreshNarrative })

  return {
    ok: true,
    reply: replyText,
    relays: relayResults,
    memoryChanges: appliedFacts,
    boardOps: executedBoardOps,
    boundProposals: proposedBounds,
    view: freshView,
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

  const col = ['forbidden', 'allowed', 'notes'].includes(field) ? field : 'forbidden'
  const BOUND_COL_LABEL = { forbidden: '禁止红线', allowed: '允许范围', notes: '注意事项' }
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
  '你是「DSH 参谋长」（宰相级协同中枢）的后台复盘与参谋模块。某个对话刚结束一轮输出。',
  '请阅读最新对话片段、团队状态、当前边界与持久记忆，完成两件事并**只输出一个 JSON 对象**：',
  '1. `memoryChanges`：仅当出现跨轮次持久有效的规矩、分工、关键架构结论或踩坑教训时才新增/修订/删除（精炼一句话）；普通干活过程返回 `[]`。严禁保存密码或密钥。',
  '2. `suggestions`（最多 1 条，宁缺毋滥，没有高价值事项必须返回 `[]`）：',
  '   - **类型 A · 宰相边界请示 (`"kind": "bound"`)**：若主代理或子代理在本轮**明显撞墙**（如权限拒绝、沙箱越界、目录不可写、某工具/命令严禁调用、环境硬限制），或用户明确提出了某条应长期遵守的工作红线/允许范围，且尚不在「已有全局边界」中 → 生成一条 `bound` 请示，由用户一键批准后正式注入全局边界！',
  '   - **类型 B · 跨对话递话建议 (`"kind": "relay"`)**：若发现明确的跨对话信息差（如子代理刚查清下游急需的关键结论、或某代理偏离目标需纠偏） → 生成一条简明分点的 `relay` 递话建议。',
  '',
  '输出格式：',
  '{',
  '  "memoryChanges": [',
  '    { "op": "add", "category": "discipline|architecture|progress|preference|team", "text": "…" }',
  '  ],',
  '  "suggestions": [',
  '    {',
  '      "kind": "bound 或 relay",',
  '      "boundField": "当 kind=bound 时必填: forbidden|allowed|notes",',
  '      "title": "一句话简明标题（≤26字）",',
  '      "reason": "简要说明撞墙背景或递话原因（≤65字）",',
  '      "target": "当 kind=relay 时填目标 key（如 lead 或子代理名）；kind=bound 时填 bounds",',
  '      "targetLabel": "目标显示名（如 主对话 / 禁止红线）",',
  '      "mode": "steer|followup|silent",',
  '      "draftText": "kind=bound 时填精炼的一句话边界条文；kind=relay 时填简明分点的递话内容"',
  '    }',
  '  ]',
  '}',
].join('\n')

const reviewTimers = new Map()

function extractLatestTurnDigest(agent, turn) {
  if (!agent || !agent.session) return null
  try {
    if (typeof agent.session.deriveMessages === 'function') {
      const msgs = agent.session.deriveMessages() || []
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
      if (lines.length > 0) return { text: lines.join('\n'), hasUser, stamp: msgs.length }
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
  const paceMode = (state.config && state.config.paceMode) || 'manual'
  // Default 'manual' mode: ZERO automatic background LLM calls! Human controls the rhythm.
  if (paceMode === 'manual' || state.config.autoReview === false) return

  const rootKey = (deps && deps.resolveRootSessionId ? deps.resolveRootSessionId(sid, agent) : '') || sid
  clearTimeout(reviewTimers.get(rootKey))
  const timer = setTimeout(() => {
    reviewTimers.delete(rootKey)
    runTurnReview(deps, { agent, sessionId: sid, turn }).catch(() => {})
  }, REVIEW_DELAY_MS)
  timer.unref?.()
  reviewTimers.set(rootKey, timer)
}

async function runTurnReview(deps, { agent, sessionId, turn }) {
  const rootId = deps.resolveRootSessionId(sessionId, agent) || sessionId
  const stateBefore = loadChiefState()
  const paceMode = (stateBefore.config && stateBefore.config.paceMode) || 'manual'
  if (paceMode === 'manual') return

  const digest = extractLatestTurnDigest(agent, turn)
  if (!digest || !digest.text) return

  const wsBefore = ensureWorkspace(stateBefore, rootId)
  const cursorKey = `${sessionId}`
  if (wsBefore.reviewCursors[cursorKey] === digest.stamp) return

  const identity = deps.resolveAgentIdentity(deps.runtime, sessionId, agent)
  if (identity && /^mnemon-(?:review|run)/i.test(String(identity.self || ''))) return

  const hasWallCue = /(?:permission denied|eacces|eperm|forbidden|blocked|not allowed|sandbox|read-only|撞墙|受阻|权限拒绝|越界)/i.test(digest.text)
  const now = Date.now()
  const lastAt = Number(lastReviewAtByRoot.get(rootId) || 0)
  const cooldownMs = paceMode === 'smart'
    ? (hasWallCue ? 45_000 : SMART_REVIEW_COOLDOWN_MS)
    : AUTO_REVIEW_COOLDOWN_MS
  if (now - lastAt < cooldownMs) return

  const directory = await listPeerDirectory(deps, rootId)
  const realPeers = directory.targets.filter(t => !/^mnemon-(?:review|run)/i.test(String(t.name || t.handle || '')))

  // In 'smart' mode, ONLY review when a hard wall/error cue occurred OR multi-agent milestone with human turn
  if (paceMode === 'smart' && !hasWallCue && !(digest.hasUser && realPeers.length > 1)) {
    return
  }
  if (!digest.hasUser && realPeers.length <= 1 && !hasWallCue) return

  const modelsInfo = await listChiefModels(deps, false, rootId)
  if (!modelsInfo.available) return

  lastReviewAtByRoot.set(rootId, now)
  const speaker = identity && identity.isChild ? `子代理 @${identity.self}` : '主对话 (@lead)'
  const view = clusterView(stateBefore, rootId)
  const numberedFacts = view.facts.slice()
  const board = deps.boardForSession && deps.boardFileFor
    ? deps.boardForSession(deps.boardFileFor(rootId))
    : null
  const bounds = (board && board.bounds) || { allowed: [], forbidden: [], notes: [] }

  const activeTargets = realPeers.filter(t => t.key === 'lead' || t.status === 'running').slice(0, 10)
  const idleCount = Math.max(0, realPeers.length - activeTargets.length)

  const prompt = [
    `刚刚结束回合的对话身份：${speaker}（sessionId=${sessionId}）`,
    `活跃团队成员：${activeTargets.map(t => `${t.handle}[key=${t.key}, ${t.status}${t.taskTitle ? ', 任务:' + t.taskTitle : ''}]`).join('；')}${idleCount > 0 ? `（另有 ${idleCount} 名空闲子代理已折叠）` : ''}`,
    '',
    '已有全局边界（请勿重复提议已有项）：',
    `- 禁止：${(bounds.forbidden || []).join('；') || '（暂无）'}`,
    `- 允许：${(bounds.allowed || []).join('；') || '（暂无）'}`,
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
  if (!res.ok) return

  const parsed = extractJsonObject(res.text)
  if (!parsed) return

  const autoPilot = Boolean(loadChiefState().config.autoPilot)
  const rawSuggestions = (Array.isArray(parsed.suggestions) ? parsed.suggestions : [])
    .map(raw => normalizeSuggestion({ ...raw, fromAgent: raw?.fromAgent || speaker }))
    .filter(Boolean)
    .slice(0, 1)

  let factsChanged = false
  const autoRelays = []

  mutateChiefState((s) => {
    const ws = ensureWorkspace(s, rootId)
    ws.reviewCursors[cursorKey] = digest.stamp
    const applied = applyFactChanges(ws, numberedFacts, parsed.memoryChanges, speaker)
    if (applied.length > 0) factsChanged = true

    for (const sug of rawSuggestions) {
      if (sug.kind === 'bound') {
        const colList = Array.isArray(bounds[sug.boundField]) ? bounds[sug.boundField] : []
        if (colList.some(x => String(x).trim() === sug.draftText)) continue
      }
      // Prime Minister Rule: Boundary changes NEVER auto-execute without explicit user approval!
      if (autoPilot && sug.kind === 'relay' && sug.draftText) {
        sug.status = 'applied'
        autoRelays.push(sug)
      } else {
        const dup = ws.suggestions.some(
          existing => existing.status === 'pending'
            && existing.kind === sug.kind
            && (sug.kind === 'bound' ? existing.draftText === sug.draftText : (existing.target === sug.target && existing.title === sug.title)),
        )
        if (!dup) {
          const pending = ws.suggestions.filter(item => item.status === 'pending')
          if (pending.length >= 5) {
            const victim = pending.find(item => item.kind !== 'bound') || pending[0]
            victim.status = 'dismissed'
          }
          ws.suggestions.push(sug)
        }
      }
    }
  })

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
  // Never chain an automatic LLM summary right after turn review — human controls summary rhythm!
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
    const col = ['forbidden', 'allowed', 'notes'].includes(boundField)
      ? boundField
      : (['forbidden', 'allowed', 'notes'].includes(found.boundField) ? found.boundField : 'forbidden')
    const BOUND_COL_LABEL = { forbidden: '禁止红线', allowed: '允许范围', notes: '注意事项' }
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
      const decree = normalizeMail({
        from: 'DSH 参谋长 (边界颁布)',
        fromSession: '',
        to: 'all',
        toSession: 'all',
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

  if (decision === 'approve' && found.kind === 'relay') {
    const body = editedText ? cleanMultiline(editedText, 1200) : found.draftText
    const delivery = await deliverCrossMessage(deps, {
      fromSession: rootId,
      fromLabel: 'DSH 参谋长 (获批建议)',
      target: found.target,
      subject: found.title,
      text: body,
      mode: found.mode || 'steer',
    })
    return {
      ok: delivery.ok,
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
  return mutateChiefState((state) => {
    if (typeof patch.modelRef === 'string') state.config.modelRef = patch.modelRef.trim()
    if (typeof patch.paceMode === 'string' && ['manual', 'smart', 'auto'].includes(patch.paceMode)) {
      state.config.paceMode = patch.paceMode
      state.config.autoPilot = patch.paceMode === 'auto'
      state.config.autoReview = patch.paceMode !== 'manual'
    } else if (typeof patch.autoPilot === 'boolean') {
      state.config.paceMode = patch.autoPilot ? 'auto' : 'manual'
      state.config.autoPilot = patch.autoPilot
      state.config.autoReview = patch.autoPilot
    }
    if (typeof patch.autoReview === 'boolean' && typeof patch.paceMode !== 'string') {
      state.config.autoReview = patch.autoReview
      if (!patch.autoReview) state.config.paceMode = 'manual'
    }
    return { ok: true, config: { ...state.config } }
  })
}

export function mutateChiefFact(deps, { sessionId, op, id, text, category, pinned }) {
  const rootId = deps.resolveRootSessionId(sessionId) || String(sessionId || 'global')
  return mutateChiefState((state) => {
    const ws = ensureWorkspace(state, rootId)
    if (op === 'add') {
      const fact = normalizeFact({ text, category: category || 'discipline', by: 'user', pinned: Boolean(pinned) })
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
