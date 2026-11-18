/**
 * archive-precipitated.js
 *
 * Double-blind precipitated cold vault storage, flip-out gating, and lock-safe vault promotion.
 */

import fs from 'node:fs'
import path from 'node:path'
import {
  POINTS_CAP,
  PRECIPITATED_CAP,
  SECRET_PATTERN,
  nextId,
  str,
  clamp,
  cleanMultiline,
  resolveProjectKey,
  normalizeVaultScope,
  cleanRootSessionId,
  resolveTargetOpts,
  globalPrecipitatedFilePath,
  acquireFileLock,
  atomicWriteJson,
  readJsonSafe,
  normalizePoint,
  normalizeTags,
  firstMeaningfulSentence,
  extractStructuredPoints,
  invokeArchiveMutatorHook,
} from './archive-core.js'
import { loadGlobalVaultRaw, loadArchiveStore } from './archive-cabinets.js'

export function hasAnyPrecipitatedFilesOnDisk(targetOpt) {
  const globalFile = globalPrecipitatedFilePath(targetOpt)
  if (fs.existsSync(globalFile)) return true
  const dir = path.dirname(globalFile)
  try {
    if (!fs.existsSync(dir)) return false
    return fs.readdirSync(dir).some(name => name.endsWith('.json'))
  } catch {
    return false
  }
}

function normalizePrecipitatedEntry(raw) {
  if (!raw || typeof raw !== 'object') return null
  const title = clamp(raw.title || '', 180)
  const rawBody = cleanMultiline(raw.rawBody || raw.body || '', 30000)
  if (!title && !rawBody) return null
  const points = (Array.isArray(raw.points) ? raw.points : [])
    .map((p, idx) => normalizePoint(p, idx))
    .filter(Boolean)
    .slice(0, POINTS_CAP)
  const validCategories = ['coords', 'incidents', 'contracts', 'ops', 'plans', 'architecture', 'env', 'contract', 'troubleshooting', 'workflow', 'general']
  const category = validCategories.includes(raw.category) ? raw.category : 'general'
  const flippedOutSessions = Array.isArray(raw.flippedOutSessions)
    ? [...new Set(raw.flippedOutSessions.map(s => str(s, '').trim()).filter(Boolean))].slice(0, 32)
    : []

  return {
    id: str(raw.id, '').trim() || nextId('prec'),
    title: title || '跨会话可复用工程经验',
    category,
    summary: clamp(raw.summary || (points[0] && points[0].cue) || firstMeaningfulSentence(rawBody) || title, 180),
    points: points.length ? points : extractStructuredPoints(title, rawBody),
    rawBody,
    purified: raw.purified !== false,
    sourceCabinetId: str(raw.sourceCabinetId || raw.sourceCabinet, '').trim(),
    sourceDrawer: str(raw.sourceDrawer, '').trim(),
    sourceSession: str(raw.sourceSession, '').trim(),
    sourceTitles: Array.isArray(raw.sourceTitles) ? raw.sourceTitles.map(t => clamp(t, 80)).slice(0, 40) : [],
    tags: normalizeTags(Array.isArray(raw.tags) ? raw.tags : []),
    flippedOutSessions,
    by: clamp(raw.by || 'chief', 40),
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Number(raw.createdAt) || Date.now(),
  }
}

/** One-time lossless merge from legacy per-project `precipitated/*.json` files into unified `precipitated/vault-global.json`. */
function ensureGlobalPrecipitatedVault(targetOpt) {
  const globalFile = globalPrecipitatedFilePath(targetOpt)
  if (fs.existsSync(globalFile)) return globalFile
  const dir = path.dirname(globalFile)
  if (!fs.existsSync(dir)) return globalFile
  let legacyFiles = []
  try {
    legacyFiles = fs.readdirSync(dir)
      .filter(name => name.endsWith('.json') && name !== 'vault-global.json')
      .map(name => path.join(dir, name))
  } catch {
    legacyFiles = []
  }
  if (!legacyFiles.length) return globalFile

  const merged = []
  const seenIds = new Set()
  const seenKeys = new Set()
  for (const lf of legacyFiles) {
    const parsed = readJsonSafe(lf, null)
    const rawItems = Array.isArray(parsed && parsed.items) ? parsed.items : []
    for (const rawItem of rawItems) {
      const norm = normalizePrecipitatedEntry(rawItem)
      if (!norm) continue
      const dedupeKey = `${norm.title}::${norm.createdAt || 0}`
      if (seenIds.has(norm.id) || seenKeys.has(dedupeKey)) continue
      seenIds.add(norm.id)
      seenKeys.add(dedupeKey)
      merged.push(norm)
    }
  }
  if (!merged.length) return globalFile
  merged.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  atomicWriteJson(globalFile, {
    version: 1,
    projectKey: 'global',
    updatedAt: Date.now(),
    items: merged.slice(0, PRECIPITATED_CAP),
  })
  return globalFile
}

export function loadPrecipitatedStoreRaw(_projectKey = 'proj-default', targetOpt) {
  const file = ensureGlobalPrecipitatedVault(targetOpt)
  if (!fs.existsSync(file)) {
    return {
      version: 1,
      projectKey: 'global',
      updatedAt: 0,
      items: [],
    }
  }
  const parsed = readJsonSafe(file, null)
  const items = (Array.isArray(parsed && parsed.items) ? parsed.items : [])
    .map(normalizePrecipitatedEntry)
    .filter(Boolean)
    .slice(0, PRECIPITATED_CAP)
  return {
    version: 1,
    projectKey: 'global',
    updatedAt: Number(parsed && parsed.updatedAt) || Date.now(),
    items,
  }
}

function savePrecipitatedStoreRaw(_projectKey = 'proj-default', store, targetOpt) {
  const file = globalPrecipitatedFilePath(targetOpt)
  const normalized = {
    version: 1,
    projectKey: 'global',
    updatedAt: Date.now(),
    items: (Array.isArray(store && store.items) ? store.items : [])
      .map(normalizePrecipitatedEntry)
      .filter(Boolean)
      .slice(0, PRECIPITATED_CAP),
  }
  atomicWriteJson(file, normalized)
  return normalized
}

/**
 * STRICT 0-TOKEN GUARD:
 * Unless `hasExplicitFlipOutFlag === true` (tracked independently per session in `chief-state.json`
 * `ws.flippedPrecipitatedIds`), this function returns `[]` IMMEDIATELY without touching disk at all!
 */
export function getFlippedOutPrecipitatedForSession(projectKey = 'proj-default', rootSessionId = '', hasExplicitFlipOutFlag = false, targetOpt) {
  if (!hasExplicitFlipOutFlag || !str(rootSessionId, '').trim()) {
    return []
  }
  const sid = str(rootSessionId, '').trim()
  const store = loadPrecipitatedStoreRaw(projectKey, targetOpt)
  return store.items.filter(it => Array.isArray(it.flippedOutSessions) && it.flippedOutSessions.includes(sid))
}

/**
 * Losslessly copy a precipitated cold-vault entry into `session` or `global` vault WITHOUT deleting the precipitated item.
 * Reads & releases precipitated lock BEFORE calling `mutateArchive` to strictly prevent lock-order inversion.
 */
export function copyPrecipitatedToVault(projectKey = 'proj-default', payload = {}, targetOpt) {
  const pid = str(payload.id || payload.precipitatedId, '').trim()
  if (!pid) return { ok: false, error: 'missing precipitated id' }
  const targetScope = normalizeVaultScope(payload.targetScope || payload.toScope || 'session') === 'global' ? 'global' : 'session'
  const rootSid = cleanRootSessionId(payload.rootSessionId || payload.session || (targetOpt && targetOpt.rootSessionId))
  if (targetScope === 'session' && !rootSid) {
    return { ok: false, error: '当前为空白新对话，请先发送一条消息建立会话后再调入本局档案库' }
  }

  const base = resolveTargetOpts(targetOpt)
  const file = globalPrecipitatedFilePath(base)
  const release = acquireFileLock(file)
  let snapshot = null
  try {
    const pStore = loadPrecipitatedStoreRaw(projectKey, base)
    const hit = pStore.items.find(it => it.id === pid)
    if (!hit) return { ok: false, error: '未找到沉淀条目：' + pid }
    snapshot = {
      id: hit.id,
      title: hit.title,
      category: hit.category || '经验',
      summary: hit.summary || '',
      points: Array.isArray(hit.points) ? hit.points.map(p => ({ ...p })) : [],
      body: hit.body || '',
      tags: Array.isArray(hit.tags) ? hit.tags.slice() : [],
    }
  } finally {
    release()
  }

  const catFolderMap = {
    contracts: 'contracts',
    architecture: 'architecture',
    patterns: 'ops',
    pitfalls: 'pitfalls',
    toolchain: 'ops',
  }
  const folder = catFolderMap[snapshot.category] || 'ops'
  const pointText = snapshot.points.map(pt => `- ${pt.title}：${pt.detail || pt.cue || ''}`).join('\n')
  const fullBody = [
    snapshot.body || snapshot.summary,
    pointText ? '\n### 精炼要点\n' + pointText : '',
  ].filter(Boolean).join('\n')

  const saveRes = invokeArchiveMutatorHook({
    op: 'save',
    vaultScope: targetScope,
    rootSessionId: rootSid,
    folder,
    paperclip: 'silver',
    title: snapshot.title,
    summary: snapshot.summary,
    points: snapshot.points,
    body: fullBody || snapshot.title,
    tags: [...new Set(['沉淀调入', snapshot.category, ...snapshot.tags].filter(Boolean))],
    by: 'user',
    takeOutNow: Boolean(payload.takeOutNow && targetScope === 'session'),
  }, {
    ...base,
    vaultScope: targetScope,
    rootSessionId: targetScope === 'session' ? rootSid : '',
    cabinetId: '',
  })

  if (!saveRes || !saveRes.ok) return saveRes || { ok: false, error: '调入目标档案库失败' }
  return {
    ...saveRes,
    copiedFromPrecipitatedId: snapshot.id,
    targetScope,
    lossless: true,
  }
}

/** Listed ONLY for Chief background sealed-archive watch (never injected into Lead prompt unless placed on desk). */
export function collectSealedWatchSummary(rootSessionId = '', projectKey = 'proj-default', targetOpt, opts = {}) {
  const sid = cleanRootSessionId(rootSessionId)
  const base = resolveTargetOpts(targetOpt)
  const capPerVault = Math.max(2, Math.min(Number(opts.limitPerVault) || 8, 16))

  let sessionSealed = []
  let globalSealed = []
  let precipSealed = []

  if (sid) {
    try {
      const sStore = loadArchiveStore({
        customSharedBoardFile: base.customSharedBoardFile,
        cwd: base.cwd,
        projectKey: base.projectKey,
        cabinetId: base.cabinetId,
        rootSessionId: sid,
        vaultScope: 'session',
      })
      if (!sStore.unboundSession) {
        sessionSealed = (sStore.items || [])
          .filter(it => !Array.isArray(it.takenOutSessions) || !it.takenOutSessions.includes(sid))
          .slice(0, capPerVault)
          .map(it => ({ id: it.id, scope: 'session', title: it.title, folder: it.folder, summary: it.summary }))
      }
    } catch {}
  }

  try {
    const gStore = loadGlobalVaultRaw(base)
    globalSealed = (gStore.items || [])
      .filter(it => !sid || !Array.isArray(it.takenOutSessions) || !it.takenOutSessions.includes(sid))
      .slice(0, capPerVault)
      .map(it => ({ id: it.id, scope: 'global', title: it.title, folder: it.folder, summary: it.summary, chiefMounted: Boolean(sid && Array.isArray(it.chiefMountedSessions) && it.chiefMountedSessions.includes(sid)) }))
  } catch {}

  if (hasAnyPrecipitatedFilesOnDisk(base)) {
    try {
      const pStore = loadPrecipitatedStoreRaw(projectKey || base.projectKey || 'proj-default', base)
      precipSealed = (pStore.items || [])
        .filter(it => !sid || !Array.isArray(it.flippedOutSessions) || !it.flippedOutSessions.includes(sid))
        .slice(0, capPerVault)
        .map(it => ({ id: it.id, scope: 'precipitated', title: it.title, category: it.category, summary: it.summary }))
    } catch {}
  }

  return { sessionSealed, globalSealed, precipSealed }
}

/** Listed ONLY when user opens the `档案` tab in Web UI (`GET /api/dsh-chief/archives`). */
export function listPrecipitatedHeaders(projectKey = 'proj-default', rootSessionId = '', targetOpt) {
  const file = ensureGlobalPrecipitatedVault(targetOpt)
  if (!fs.existsSync(file)) return []
  const sid = str(rootSessionId, '').trim()
  const store = loadPrecipitatedStoreRaw(projectKey, targetOpt)
  return store.items.map(it => ({
    id: it.id,
    title: it.title,
    category: it.category,
    summary: it.summary,
    purified: it.purified,
    sourceCabinetId: it.sourceCabinetId,
    sourceDrawer: it.sourceDrawer,
    sourceTitles: it.sourceTitles,
    tags: it.tags,
    pointCount: Array.isArray(it.points) ? it.points.length : 0,
    flippedOut: Boolean(sid && Array.isArray(it.flippedOutSessions) && it.flippedOutSessions.includes(sid)),
    points: (it.points || []).map(p => ({ id: p.id, title: p.title, cue: p.cue, detail: p.detail })),
    createdAt: it.createdAt,
    updatedAt: it.updatedAt,
  }))
}

export function getPrecipitatedDetail(projectKey = 'proj-default', id = '', rootSessionId = '', targetOpt) {
  const target = str(id, '').trim()
  if (!target) return { ok: false, error: 'missing precipitated id' }
  const store = loadPrecipitatedStoreRaw(projectKey, targetOpt)
  const hit = store.items.find(it => it.id === target)
  if (!hit) return { ok: false, error: '未找到沉淀经验条目：' + target }
  const sid = str(rootSessionId, '').trim()
  return {
    ok: true,
    item: {
      ...hit,
      flippedOut: Boolean(sid && hit.flippedOutSessions.includes(sid)),
    },
  }
}

export function savePrecipitatedEntry(projectKey = 'proj-default', entry = {}, targetOpt) {
  const resolvedKey = resolveProjectKey(projectKey)
  const file = globalPrecipitatedFilePath(targetOpt)
  const release = acquireFileLock(file)
  try {
    const store = loadPrecipitatedStoreRaw(resolvedKey, targetOpt)
    const bodyCheck = cleanMultiline(entry.rawBody || entry.body || '', 30000)
    if (SECRET_PATTERN.test(bodyCheck)) {
      return { ok: false, error: '沉淀内容疑似包含敏感密钥或私密凭据，已拒绝写入冷库' }
    }
    const existing = entry.id ? store.items.find(it => it.id === entry.id) : null
    if (existing) {
      const updated = normalizePrecipitatedEntry({ ...existing, ...entry, id: existing.id, updatedAt: Date.now() })
      Object.assign(existing, updated)
      savePrecipitatedStoreRaw(resolvedKey, store, targetOpt)
      return { ok: true, item: existing, entry: existing, file }
    }
    const created = normalizePrecipitatedEntry({
      ...entry,
      id: str(entry.id, '').trim() || nextId('prec'),
      flippedOutSessions: [], // Strictly cold-isolated by default!
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    if (!created) return { ok: false, error: '无法写入空的沉淀经验' }
    store.items.unshift(created)
    savePrecipitatedStoreRaw(resolvedKey, store, targetOpt)
    return { ok: true, item: created, entry: created, file }
  } finally {
    release()
  }
}

export function mutatePrecipitated(projectKey = 'proj-default', payload = {}, targetOpt) {
  const resolvedKey = resolveProjectKey(projectKey || payload.projectKey || payload.cwd || 'proj-default')
  const file = globalPrecipitatedFilePath(targetOpt)
  const op = str(payload.op, '').trim()
  const sid = str(payload.rootSessionId || payload.session, '').trim()
  const id = str(payload.precipitatedId || payload.id, '').trim()

  const release = acquireFileLock(file)
  try {
    const store = loadPrecipitatedStoreRaw(resolvedKey, targetOpt)

    if (op === 'flipOut' || op === 'sealBack') {
      if (!sid) return { ok: false, error: '当前未绑定对话会话' }
      const item = store.items.find(it => it.id === id)
      if (!item) return { ok: false, error: '未找到沉淀经验：' + id }
      const set = new Set(item.flippedOutSessions || [])
      if (op === 'flipOut') set.add(sid)
      else set.delete(sid)
      item.flippedOutSessions = [...set]
      item.updatedAt = Date.now()
      savePrecipitatedStoreRaw(resolvedKey, store, targetOpt)
      return {
        ok: true,
        id: item.id,
        title: item.title,
        flippedOut: op === 'flipOut',
        flippedIdsForSession: store.items
          .filter(it => it.flippedOutSessions.includes(sid))
          .map(it => it.id),
      }
    }

    if (op === 'deletePrecipitated') {
      const idx = store.items.findIndex(it => it.id === id)
      if (idx < 0) return { ok: false, error: '未找到沉淀经验：' + id }
      const [removed] = store.items.splice(idx, 1)
      savePrecipitatedStoreRaw(resolvedKey, store, targetOpt)
      return { ok: true, removedId: removed.id, title: removed.title }
    }

    if (op === 'updatePrecipitated') {
      const item = store.items.find(it => it.id === id)
      if (!item) return { ok: false, error: '未找到沉淀经验：' + id }
      const next = normalizePrecipitatedEntry({ ...item, ...payload, id: item.id, updatedAt: Date.now() })
      Object.assign(item, next)
      savePrecipitatedStoreRaw(resolvedKey, store, targetOpt)
      return { ok: true, item }
    }

    return { ok: false, error: '未知的沉淀库操作：' + op }
  } finally {
    release()
  }
}
