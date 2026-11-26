/**
 * archive-dossiers.js
 *
 * Working dossier CRUD, session/global diffing, search, AI curations, and cross-session copy.
 */

import fs from 'node:fs'
import {
  POINTS_CAP,
  SECRET_PATTERN,
  DEFAULT_ARCHIVE_FOLDERS,
  DESKTOP_TOKEN_BUDGET,
  DESKTOP_MAX_ITEMS,
  normalizeDesktopCapacity,
  nextId,
  str,
  clamp,
  cleanMultiline,
  normalizeVaultScope,
  cleanRootSessionId,
  resolveTargetOpts,
  withRootScope,
  globalChiefVaultFilePath,
  normalizeArchiveTitleKey,
  computeEntryContentHash,
  normalizeFolder,
  normalizePoint,
  normalizeTags,
  normalizeSessionIdList,
  normalizeDesktopMeta,
  estimateArchiveTokens,
  deriveHookFromStructuredItem,
  normalizeArchiveItem,
  normalizeGlobalVaultEntry,
  firstMeaningfulSentence,
  extractStructuredPoints,
  smartParseNoteToDossier,
  registerArchiveMutatorHook,
} from './archive-core.js'
import {
  ensureProjectCabinet,
  listProjectCabinets,
  loadGlobalVaultRaw,
  saveGlobalVaultRaw,
  loadArchiveStore,
  saveArchiveStore,
  withArchiveLock,
  mutateCabinetRegistry,
} from './archive-cabinets.js'
import { hasAnyPrecipitatedFilesOnDisk, loadPrecipitatedStoreRaw, listPrecipitatedHeaders } from './archive-precipitated.js'

/**
 * 0-Token Guard for System Global Vault:
 * Returns ONLY entries the User explicitly mounted for Chief in THIS conversation (`chiefMountedSessions`).
 * By default returns `[]` without reading or leaking anything into conversation context.
 */
export function getChiefMountedGlobalForSession(rootSessionId = '', targetOpt) {
  const sid = cleanRootSessionId(rootSessionId)
  if (!sid) return []
  const file = globalChiefVaultFilePath(targetOpt)
  if (!fs.existsSync(file)) return []
  const store = loadGlobalVaultRaw(targetOpt)
  return store.items.filter(it => Array.isArray(it.chiefMountedSessions) && it.chiefMountedSessions.includes(sid))
}

/**
 * Returns ONLY System Global Vault entries explicitly placed onto THIS session's desk (`takenOutSessions`),
 * so both Lead & Chief emphasize them in prompt context while sealed global entries stay hidden from Lead.
 */
export function getTakenOutGlobalForSession(rootSessionId = '', targetOpt) {
  const sid = cleanRootSessionId(rootSessionId)
  if (!sid) return []
  const file = globalChiefVaultFilePath(targetOpt)
  if (!fs.existsSync(file)) return []
  const store = loadGlobalVaultRaw(targetOpt)
  return store.items.filter(it => Array.isArray(it.takenOutSessions) && it.takenOutSessions.includes(sid))
}

/**
 * Computes bidirectional diff between the active conversation's Local Session Cabinet and the System Global Vault.
 */
export function computeSessionGlobalDiff(sessionItems = [], globalItems = [], rootSessionId = '') {
  const sid = cleanRootSessionId(rootSessionId)
  const sArr = Array.isArray(sessionItems) ? sessionItems : []
  const gArr = Array.isArray(globalItems) ? globalItems : []

  const gById = new Map()
  const gByOriginId = new Map()
  const gByTitle = new Map()
  for (const g of gArr) {
    if (!g) continue
    gById.set(g.id, g)
    if (g.originId) gByOriginId.set(g.originId, g)
    const tk = normalizeArchiveTitleKey(g.title)
    if (tk && !gByTitle.has(tk)) gByTitle.set(tk, g)
  }

  const sById = new Map()
  const sByOriginGlobal = new Map()
  const sByTitle = new Map()
  for (const s of sArr) {
    if (!s) continue
    sById.set(s.id, s)
    if (s.originGlobalId) sByOriginGlobal.set(s.originGlobalId, s)
    const tk = normalizeArchiveTitleKey(s.title)
    if (tk && !sByTitle.has(tk)) sByTitle.set(tk, s)
  }

  const sessionDiffMap = new Map()
  const globalDiffMap = new Map()
  let localOnlyCount = 0
  let globalOnlyCount = 0
  let syncedCount = 0
  let modifiedCount = 0
  const localOnlyBriefs = []

  if (sid) {
    for (const s of sArr) {
      if (!s) continue
      const gMatch = (s.originGlobalId && gById.get(s.originGlobalId))
        || gByOriginId.get(s.id)
        || gByTitle.get(normalizeArchiveTitleKey(s.title))
        || null
      if (!gMatch) {
        localOnlyCount += 1
        sessionDiffMap.set(s.id, { diffStatus: 'local_only', matchedGlobalId: '' })
        if (localOnlyBriefs.length < 25) {
          localOnlyBriefs.push({
            id: s.id,
            title: s.title,
            summary: s.summary,
            folder: s.folder,
            paperclip: s.paperclip,
            diffStatus: 'local_only',
            updatedAt: s.updatedAt,
          })
        }
      } else {
        const sHash = computeEntryContentHash(s)
        const gHash = computeEntryContentHash(gMatch)
        if (sHash === gHash) {
          syncedCount += 1
          sessionDiffMap.set(s.id, { diffStatus: 'synced', matchedGlobalId: gMatch.id })
        } else {
          modifiedCount += 1
          sessionDiffMap.set(s.id, { diffStatus: 'local_modified', matchedGlobalId: gMatch.id })
          if (localOnlyBriefs.length < 25) {
            localOnlyBriefs.push({
              id: s.id,
              title: s.title,
              summary: s.summary,
              folder: s.folder,
              paperclip: s.paperclip,
              diffStatus: 'local_modified',
              matchedGlobalId: gMatch.id,
              updatedAt: s.updatedAt,
            })
          }
        }
      }
    }
  }

  for (const g of gArr) {
    if (!g) continue
    if (!sid) {
      globalDiffMap.set(g.id, { diffStatus: 'unbound', matchedSessionItemId: '' })
      continue
    }
    const sMatch = sByOriginGlobal.get(g.id)
      || (g.originId ? sById.get(g.originId) : null)
      || sByTitle.get(normalizeArchiveTitleKey(g.title))
      || null
    if (!sMatch) {
      globalOnlyCount += 1
      globalDiffMap.set(g.id, { diffStatus: 'global_only', matchedSessionItemId: '' })
    } else {
      const sHash = computeEntryContentHash(sMatch)
      const gHash = computeEntryContentHash(g)
      globalDiffMap.set(g.id, {
        diffStatus: sHash === gHash ? 'synced' : 'differs',
        matchedSessionItemId: sMatch.id,
      })
    }
  }

  return {
    sessionDiffMap,
    globalDiffMap,
    summary: {
      unboundSession: !sid,
      sessionTotal: sid ? sArr.length : 0,
      globalTotal: gArr.length,
      localOnlyCount,
      globalOnlyCount: sid ? globalOnlyCount : gArr.length,
      syncedCount,
      modifiedCount,
      localOnlyBriefs,
    },
  }
}

/** Ultra-lightweight metadata (<160 bytes) for `/snapshot` polling — ZERO archive text or precipitated reads! */
export function getArchiveMeta(rootSessionId = '', targetOpt) {
  const effectiveTarget = withRootScope(targetOpt, rootSessionId)
  const cabInfo = listProjectCabinets(effectiveTarget)
  const store = loadArchiveStore(effectiveTarget)
  const sid = cleanRootSessionId(rootSessionId)
  const nonEmptyFolders = new Set(store.items.map(it => it.folder).filter(Boolean))
  const takenOutCount = (sid && cabInfo.vaultScope !== 'global' && !cabInfo.unboundSession)
    ? store.items.filter(it => Array.isArray(it.takenOutSessions) && it.takenOutSessions.includes(sid)).length
    : 0
  return {
    totalCount: store.items.length,
    folderCount: nonEmptyFolders.size || DEFAULT_ARCHIVE_FOLDERS.length,
    takenOutCount,
    unorganizedCount: store.items.filter(it => it.folder === 'inbox' || it.organizedBy === 'auto').length,
    scope: cabInfo.vaultScope || cabInfo.scope || 'session',
    vaultScope: cabInfo.vaultScope || cabInfo.scope || 'session',
    isSystemGlobalVault: Boolean(cabInfo.isSystemGlobalVault),
    unboundSession: Boolean(cabInfo.unboundSession),
    projectKey: cabInfo.projectKey,
    activeCabinetId: cabInfo.activeCabinetId,
    cabinetCount: cabInfo.cabinets.length,
  }
}

/** Counts across all 3 tiers (`session`, `global`, `precipitated`) for UI tabs & `/snapshot`. */
export function getThreeTierArchiveCounts(rootSessionId = '', flippedIds = [], targetOpt) {
  const sid = cleanRootSessionId(rootSessionId)
  const base = resolveTargetOpts(targetOpt)
  const sessionStore = sid
    ? loadArchiveStore({ customSharedBoardFile: base.customSharedBoardFile, cwd: base.cwd, projectKey: base.projectKey, rootSessionId: sid, vaultScope: 'session' })
    : { items: [], unboundSession: true }
  const globalStore = loadGlobalVaultRaw(base)
  let precipitatedCount = 0
  let flippedCount = Array.isArray(flippedIds) ? flippedIds.length : 0
  if (hasAnyPrecipitatedFilesOnDisk(base)) {
    const pStore = loadPrecipitatedStoreRaw(base.projectKey || 'proj-default', base)
    precipitatedCount = pStore.items.length
    if (sid) {
      flippedCount = pStore.items.filter(it => Array.isArray(it.flippedOutSessions) && it.flippedOutSessions.includes(sid)).length
    }
  }
  const globalMountedCount = sid
    ? globalStore.items.filter(it => Array.isArray(it.chiefMountedSessions) && it.chiefMountedSessions.includes(sid)).length
    : 0
  const globalTakenOutCount = sid
    ? globalStore.items.filter(it => Array.isArray(it.takenOutSessions) && it.takenOutSessions.includes(sid)).length
    : 0
  return {
    sessionCount: Array.isArray(sessionStore.items) ? sessionStore.items.length : 0,
    globalCount: Array.isArray(globalStore.items) ? globalStore.items.length : 0,
    globalMountedCount,
    globalTakenOutCount,
    precipitatedCount,
    flippedCount,
    unboundSession: !sid,
  }
}

export function computeArchiveViewerStatus(item, sid = '', vaultScope = 'session') {
  const takenOut = Boolean(sid && Array.isArray(item?.takenOutSessions) && item.takenOutSessions.includes(sid))
  if (takenOut) {
    return {
      code: 'on_desktop',
      tone: 'amber',
      label: vaultScope === 'global'
        ? '📌 桌面在读(全局调入) · 主代理与参谋同看'
        : '📌 桌面在读 · 主代理与参谋同看',
    }
  }
  if (vaultScope === 'global') {
    if (sid && Array.isArray(item?.chiefDeliveredSessions) && item.chiefDeliveredSessions.includes(sid)) {
      return { code: 'global_delivered', tone: 'cyan', label: '📨 参谋已递交本局主代理' }
    }
    if (sid && (
      (Array.isArray(item?.chiefMountedSessions) && item.chiefMountedSessions.includes(sid))
      || (Array.isArray(item?.chiefPulledSessions) && item.chiefPulledSessions.includes(sid))
    )) {
      return { code: 'chief_reading', tone: 'accent', label: '👁️ 参谋参阅中' }
    }
    if (item?.hasHook) {
      return { code: 'global_hooked', tone: 'purple', label: '🪝 参谋见钩可拉（主会话隔离）' }
    }
    return { code: 'human_only', tone: 'muted', label: '🔒 仅人类可见（待整理织钩）' }
  }
  if (sid && Array.isArray(item?.leadPulledSessions) && item.leadPulledSessions.includes(sid)) {
    return { code: 'lead_pulled', tone: 'emerald', label: '📖 主代理已拉阅 · 参谋可读' }
  }
  if (sid && Array.isArray(item?.chiefDeliveredSessions) && item.chiefDeliveredSessions.includes(sid)) {
    return { code: 'chief_delivered', tone: 'cyan', label: '📨 参谋已递交主代理 · 参谋可读' }
  }
  if (item?.hasHook) {
    return { code: 'session_hooked', tone: 'teal', label: '🪝 主代理见钩可拉 · 参谋可读' }
  }
  return { code: 'chief_only', tone: 'blue', label: '👁️ 仅参谋可读（待整理织钩）' }
}

function buildDesktopSummary(sid, sessionStore, globalStore) {
  const pinnedDocuments = []
  if (sid) {
    const pushDesk = (items, scope) => {
      for (const it of (Array.isArray(items) ? items : [])) {
        if (!Array.isArray(it.takenOutSessions) || !it.takenOutSessions.includes(sid)) continue
        const meta = (it.desktopMeta && it.desktopMeta[sid]) || {}
        pinnedDocuments.push({
          id: it.id,
          title: it.title,
          summary: it.summary,
          folder: it.folder,
          paperclip: it.paperclip,
          vaultScope: scope,
          tags: it.tags || [],
          hasHook: Boolean(it.hasHook),
          hookKeywords: Array.isArray(it.hookKeywords) ? it.hookKeywords : [],
          hookCue: it.hookCue || '',
          estimatedTokens: estimateArchiveTokens(it),
          pinnedAt: Number(meta.pinnedAt) || Number(it.updatedAt) || 0,
          pinnedBy: meta.by || 'user',
          viewerStatus: computeArchiveViewerStatus(it, sid, scope),
          points: Array.isArray(it.points) ? it.points : [],
        })
      }
    }
    if (sessionStore && !sessionStore.unboundSession) pushDesk(sessionStore.items, 'session')
    if (globalStore) pushDesk(globalStore.items, 'global')
  }
  pinnedDocuments.sort((a, b) => (b.pinnedAt || 0) - (a.pinnedAt || 0))
  const usedTokens = pinnedDocuments.reduce((acc, it) => acc + (Number(it.estimatedTokens) || 0), 0)
  const cap = normalizeDesktopCapacity({
    maxItems: sessionStore && !sessionStore.unboundSession ? sessionStore.desktopMaxItems : DESKTOP_MAX_ITEMS,
    tokenBudget: sessionStore && !sessionStore.unboundSession ? sessionStore.desktopTokenBudget : DESKTOP_TOKEN_BUDGET,
  })
  return {
    pinnedDocuments,
    usedTokens,
    tokenBudget: cap.tokenBudget,
    maxItems: cap.maxItems,
    usagePct: Math.min(100, Math.round((usedTokens / cap.tokenBudget) * 100)),
    recentlyUnpinnedWatch: (sessionStore && Array.isArray(sessionStore.recentlyUnpinnedWatch))
      ? sessionStore.recentlyUnpinnedWatch
      : [],
  }
}

function buildPrecipitatedFolderMeta(precipList = []) {
  const counts = {}
  const golds = {}
  const folderMap = new Map(DEFAULT_ARCHIVE_FOLDERS.map(f => [f.id, { ...f }]))
  for (const p of (Array.isArray(precipList) ? precipList : [])) {
    if (!p) continue
    const fid = str(p.folder, 'ops').trim() || 'ops'
    counts[fid] = (counts[fid] || 0) + 1
    if (p.paperclip === 'gold') golds[fid] = (golds[fid] || 0) + 1
    if (!folderMap.has(fid)) {
      folderMap.set(fid, {
        id: fid,
        label: clamp(fid, 40),
        hint: '冷藏沉淀分类抽屉',
        accent: '#f59e0b',
        order: 65,
      })
    }
  }
  return [...folderMap.values()]
    .sort((a, b) => (a.order || 99) - (b.order || 99))
    .map(f => ({ ...f, count: counts[f.id] || 0, goldCount: golds[f.id] || 0 }))
}

/**
 * Tier-1 Lazy Load (`GET /api/dsh-chief/archives`):
 * - `scope === 'global'`: reads standalone System Global Cold Vault (`global-vault/vault-chief-global.json`),
 *   computes live diff against current conversation's Session Cabinet (when bound), and returns `isSystemGlobalVault: true`.
 * - `scope === 'session'`: reads ONLY this root conversation's Local Session Cabinet (strictly isolated 1:1),
 *   computes diff against System Global Vault so each card knows whether it is local_only / synced / local_modified.
 */
export function listArchiveHeaders(rootSessionId = '', opts = {}, targetOpt) {
  const sid = cleanRootSessionId(rootSessionId || (opts && (opts.rootSessionId || opts.sessionId)))
  const requestedScope = normalizeVaultScope((opts && (opts.vaultScope || opts.scope)) || (targetOpt && typeof targetOpt === 'object' && (targetOpt.vaultScope || targetOpt.scope)))
  const baseTarget = targetOpt !== undefined
    ? (typeof targetOpt === 'string'
      ? { customSharedBoardFile: targetOpt, cwd: opts && opts.cwd, projectKey: opts && opts.projectKey, cabinetId: opts && opts.cabinetId, vaultScope: requestedScope }
      : { ...opts, ...targetOpt, vaultScope: requestedScope })
    : { ...(opts || {}), vaultScope: requestedScope }
  const target = withRootScope(baseTarget, sid)
  const isGlobalReq = requestedScope === 'global'
  const cabInfo = listProjectCabinets(target)
  const store = isGlobalReq ? loadGlobalVaultRaw(baseTarget) : loadArchiveStore(target)
  const globalVault = isGlobalReq ? store : loadGlobalVaultRaw(baseTarget)
  const sessionStore = isGlobalReq
    ? (sid ? loadArchiveStore({ customSharedBoardFile: baseTarget.customSharedBoardFile, cwd: baseTarget.cwd, projectKey: baseTarget.projectKey, rootSessionId: sid, vaultScope: 'session' }) : { items: [], unboundSession: true })
    : store
  const diff = computeSessionGlobalDiff(
    sessionStore && !sessionStore.unboundSession ? sessionStore.items : [],
    globalVault.items,
    sid,
  )

  const needle = String((opts && opts.query) || '').trim().toLowerCase()
  const folderFilter = String((opts && opts.folder) || '').trim()
  const clipFilter = String((opts && opts.paperclip) || '').trim()

  const clipRank = { gold: 0, silver: 1, copper: 2 }
  const sorted = store.items.slice().sort((a, b) => {
    const aPinned = isGlobalReq
      ? (sid && Array.isArray(a.chiefMountedSessions) && a.chiefMountedSessions.includes(sid) ? 0 : 1)
      : (sid && Array.isArray(a.takenOutSessions) && a.takenOutSessions.includes(sid) ? 0 : 1)
    const bPinned = isGlobalReq
      ? (sid && Array.isArray(b.chiefMountedSessions) && b.chiefMountedSessions.includes(sid) ? 0 : 1)
      : (sid && Array.isArray(b.takenOutSessions) && b.takenOutSessions.includes(sid) ? 0 : 1)
    if (aPinned !== bPinned) return aPinned - bPinned
    const cDiff = (clipRank[a.paperclip] ?? 1) - (clipRank[b.paperclip] ?? 1)
    if (cDiff !== 0) return cDiff
    return (b.updatedAt || 0) - (a.updatedAt || 0)
  })

  const filtered = sorted.filter((it) => {
    if (folderFilter && it.folder !== folderFilter) return false
    if (clipFilter && it.paperclip !== clipFilter) return false
    if (!needle) return true
    const hay = [
      it.title,
      it.summary,
      (it.hookKeywords || []).join(' '),
      it.hookCue || '',
      (it.tags || []).join(' '),
      ...(it.points || []).map(p => `${p.title} ${p.cue}`),
      it.body,
    ].join('\n').toLowerCase()
    return hay.includes(needle)
  })

  const countsByFolder = {}
  const goldByFolder = {}
  for (const it of store.items) {
    countsByFolder[it.folder] = (countsByFolder[it.folder] || 0) + 1
    if (it.paperclip === 'gold') {
      goldByFolder[it.folder] = (goldByFolder[it.folder] || 0) + 1
    }
  }

  const folders = store.folders.map(f => ({
    ...f,
    count: countsByFolder[f.id] || 0,
    goldCount: goldByFolder[f.id] || 0,
  }))

  const activeScopeName = isGlobalReq ? 'global' : 'session'
  const headers = filtered.map((it) => {
    const diffEntry = (isGlobalReq ? diff.globalDiffMap.get(it.id) : diff.sessionDiffMap.get(it.id)) || {}
    return {
      id: it.id,
      originId: it.originId || '',
      originGlobalId: it.originGlobalId || '',
      title: it.title,
      summary: it.summary,
      folder: it.folder,
      paperclip: it.paperclip,
      tags: it.tags,
      cold: true,
      hasHook: Boolean(it.hasHook),
      hookKeywords: Array.isArray(it.hookKeywords) ? it.hookKeywords : [],
      hookCue: it.hookCue || '',
      estimatedTokens: estimateArchiveTokens(it),
      takenOut: Boolean(sid && Array.isArray(it.takenOutSessions) && it.takenOutSessions.includes(sid)),
      chiefMounted: Boolean(isGlobalReq && sid && Array.isArray(it.chiefMountedSessions) && it.chiefMountedSessions.includes(sid)),
      leadPulled: Boolean(!isGlobalReq && sid && Array.isArray(it.leadPulledSessions) && it.leadPulledSessions.includes(sid)),
      chiefPulled: Boolean(sid && Array.isArray(it.chiefPulledSessions) && it.chiefPulledSessions.includes(sid)),
      chiefDelivered: Boolean(sid && Array.isArray(it.chiefDeliveredSessions) && it.chiefDeliveredSessions.includes(sid)),
      viewerStatus: computeArchiveViewerStatus(it, sid, activeScopeName),
      diffStatus: diffEntry.diffStatus || (isGlobalReq ? (sid ? 'global_only' : 'unbound') : 'local_only'),
      matchedGlobalId: !isGlobalReq ? (diffEntry.matchedGlobalId || '') : '',
      matchedSessionItemId: isGlobalReq ? (diffEntry.matchedSessionItemId || '') : '',
      contentHash: it.contentHash || computeEntryContentHash(it),
      organizedBy: it.organizedBy,
      pointCount: Array.isArray(it.points) ? it.points.length : 0,
      pointPreviews: (Array.isArray(it.points) ? it.points : []).slice(0, 4).map(p => p.title),
      bodyLength: (it.body || '').length,
      updatedAt: it.updatedAt,
      createdAt: it.createdAt,
    }
  })

  const includePrecipitated = Boolean(opts && opts.includePrecipitated)
  const precipitated = includePrecipitated
    ? listPrecipitatedHeaders(cabInfo.projectKey, sid, target)
    : undefined
  const precipitatedFolders = includePrecipitated ? buildPrecipitatedFolderMeta(precipitated) : undefined
  const desktop = buildDesktopSummary(sid, sessionStore, globalVault)
  const counts = (opts && opts.includeCounts !== false)
    ? getThreeTierArchiveCounts(sid, (opts && opts.flippedIds) || [], baseTarget)
    : undefined

  const hookedCount = store.items.filter(it => it.hasHook).length
  const viewerSummary = isGlobalReq
    ? {
        scope: 'global',
        hookedCount,
        totalCount: store.items.length,
        label: `🌐 全局档案柜：主会话默认隔离 · ${hookedCount}/${store.items.length} 份已织就钩子（参谋见钩可拉）`,
      }
    : {
        scope: 'session',
        hookedCount,
        totalCount: store.items.length,
        label: `🗂️ 本局档案柜：参谋随时可读 · ${hookedCount}/${store.items.length} 份已织就钩子（主代理见钩可拉）`,
      }

  return {
    ok: true,
    scope: isGlobalReq ? 'global' : (cabInfo.vaultScope || cabInfo.scope || 'session'),
    vaultScope: isGlobalReq ? 'global' : (cabInfo.vaultScope || cabInfo.scope || 'session'),
    isSystemGlobalVault: isGlobalReq,
    unboundSession: isGlobalReq ? false : Boolean(cabInfo.unboundSession),
    rootSessionId: sid,
    projectKey: isGlobalReq ? 'global' : cabInfo.projectKey,
    activeCabinetId: isGlobalReq ? '' : cabInfo.activeCabinetId,
    cabinets: isGlobalReq ? [] : cabInfo.cabinets,
    totalCount: store.items.length,
    takenOutCount: desktop.pinnedDocuments.length,
    desktop,
    viewerSummary,
    recentlyUnpinnedWatch: desktop.recentlyUnpinnedWatch,
    diffSummary: diff.summary,
    folders,
    items: headers,
    ...(precipitated !== undefined ? { precipitated, precipitatedFolders, precipitatedViewerSummary: { scope: 'precipitated', label: '🧊 冷藏档案柜：仅人类可见（钩子专供人类速览 · 主会话与参谋均 0 Token 隔离）' } } : {}),
    ...(counts !== undefined ? { counts } : {}),
  }
}

export function getArchiveDetail(idOrTitle = '', rootSessionId = '', targetOpt) {
  const target = String(idOrTitle || '').trim()
  if (!target) return { ok: false, error: 'archive id or title required' }
  const sid = cleanRootSessionId(rootSessionId)
  const base = resolveTargetOpts(targetOpt)
  const isGlobal = base.vaultScope === 'global'
  const resolved = ensureProjectCabinet(withRootScope(targetOpt, sid))
  if (!isGlobal && resolved.unboundSession) {
    return { ok: false, error: '当前为空白新对话，尚未建立本会话档案柜' }
  }
  const store = isGlobal ? loadGlobalVaultRaw(targetOpt) : loadArchiveStore(withRootScope(targetOpt, sid))
  const hit = store.items.find(it => it.id === target)
    || store.items.find(it => it.title === target)
    || store.items.find(it => it.title.toLowerCase().includes(target.toLowerCase()))
  if (!hit) return { ok: false, error: '未找到工程档案：' + target }

  return {
    ok: true,
    vaultScope: isGlobal ? 'global' : (resolved.vaultScope || 'session'),
    isSystemGlobalVault: isGlobal,
    item: {
      id: hit.id,
      originId: hit.originId || '',
      originGlobalId: hit.originGlobalId || '',
      title: hit.title,
      summary: hit.summary,
      folder: hit.folder,
      paperclip: hit.paperclip,
      tags: hit.tags,
      cold: hit.cold,
      takenOut: Boolean(sid && Array.isArray(hit.takenOutSessions) && hit.takenOutSessions.includes(sid)),
      chiefMounted: Boolean(isGlobal && sid && Array.isArray(hit.chiefMountedSessions) && hit.chiefMountedSessions.includes(sid)),
      hasHook: Boolean(hit.hasHook),
      hookKeywords: Array.isArray(hit.hookKeywords) ? hit.hookKeywords : [],
      hookCue: hit.hookCue || '',
      estimatedTokens: estimateArchiveTokens(hit),
      viewerStatus: computeArchiveViewerStatus(hit, sid, isGlobal ? 'global' : 'session'),
      organizedBy: hit.organizedBy,
      points: hit.points,
      body: hit.body,
      contentHash: hit.contentHash || computeEntryContentHash(hit),
      by: hit.by,
      createdAt: hit.createdAt,
      updatedAt: hit.updatedAt,
    },
  }
}

/**
 * Strictly returns ONLY dossiers explicitly taken out onto the current session desk
 * FROM THIS CONVERSATION'S SESSION CABINET. NEVER reads Global Cabinet or `precipitated`!
 */
export function getTakenOutArchivesForSession(rootSessionId = '', targetOpt) {
  const sid = cleanRootSessionId(rootSessionId)
  if (!sid) return []
  const base = resolveTargetOpts(targetOpt)
  const store = loadArchiveStore({
    customSharedBoardFile: base.customSharedBoardFile,
    cwd: base.cwd,
    projectKey: base.projectKey,
    cabinetId: base.cabinetId,
    rootSessionId: sid,
    vaultScope: 'session',
  })
  if (store.unboundSession) return []
  const cap = normalizeDesktopCapacity({ maxItems: store.desktopMaxItems })
  return store.items
    .filter(it => Array.isArray(it.takenOutSessions) && it.takenOutSessions.includes(sid))
    .sort((a, b) => {
      const aPin = Number(a?.desktopMeta?.[sid]?.pinnedAt || a.updatedAt || 0)
      const bPin = Number(b?.desktopMeta?.[sid]?.pinnedAt || b.updatedAt || 0)
      return bPin - aPin
    })
    .slice(0, cap.maxItems)
}

function scoreAndRankArchiveItems(store, query = '', opts = {}) {
  const folder = String((opts && opts.folder) || '').trim()
  const limit = Math.max(1, Math.min(Number(opts && opts.limit) || 8, 25))
  const rawQ = String(query || '').trim().toLowerCase()
  const terms = rawQ
    .replace(/[？?！!。，,、：:“”"'()（）[\]【】]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

  const scored = []
  for (const it of (store && Array.isArray(store.items) ? store.items : [])) {
    if (folder && it.folder !== folder) continue
    if (!terms.length) {
      scored.push({ score: it.paperclip === 'gold' ? 5 : 2, it })
      continue
    }
    const titleLow = it.title.toLowerCase()
    const sumLow = it.summary.toLowerCase()
    const tagLow = (it.tags || []).join(' ').toLowerCase()
    const ptsLow = (it.points || []).map(p => `${p.title} ${p.cue} ${p.detail}`).join('\n').toLowerCase()
    const bodyLow = (it.body || '').toLowerCase()

    let score = 0
    for (const term of terms) {
      if (titleLow.includes(term)) score += 8
      if (tagLow.includes(term)) score += 5
      if (sumLow.includes(term)) score += 4
      if (ptsLow.includes(term)) score += 3
      else if (bodyLow.includes(term)) score += 2
    }
    if (score > 0) {
      if (it.paperclip === 'gold') score += 1
      scored.push({ score, it })
    }
  }

  scored.sort((a, b) => b.score - a.score || (b.it.updatedAt || 0) - (a.it.updatedAt || 0))
  const folderLabelMap = new Map((store && Array.isArray(store.folders) ? store.folders : []).map(f => [f.id, f.label]))

  return {
    totalArchives: store && Array.isArray(store.items) ? store.items.length : 0,
    matchCount: scored.length,
    hits: scored.slice(0, limit).map(({ it }) => ({
      id: it.id,
      title: it.title,
      folder: it.folder,
      folderLabel: folderLabelMap.get(it.folder) || it.folder,
      paperclip: it.paperclip,
      summary: it.summary,
      tags: it.tags,
      points: (it.points || []).map(p => ({ id: p.id, title: p.title, cue: p.cue })),
      updatedAt: it.updatedAt,
    })),
  }
}

/** On-demand search for `chief_board({ action: "archive.search" })` inside THIS conversation's Session Cabinet.
 * Strictly NEVER reads System Global Vault or `precipitated`! */
export function searchArchives(query = '', opts = {}, targetOpt) {
  const rawTarget = targetOpt !== undefined
    ? (typeof targetOpt === 'string'
      ? { customSharedBoardFile: targetOpt, vaultScope: 'session' }
      : { ...targetOpt, vaultScope: 'session' })
    : (opts && (opts.cwd || opts.projectKey || opts.cabinetId || opts.customSharedBoardFile || opts.rootSessionId || opts.sessionId)
      ? { ...opts, vaultScope: 'session' }
      : { vaultScope: 'session' })
  const store = loadArchiveStore(rawTarget)
  if (store.unboundSession) {
    return { ok: true, totalArchives: 0, matchCount: 0, hits: [], unboundSession: true }
  }
  return {
    ok: true,
    ...scoreAndRankArchiveItems(store, query, opts),
  }
}

/** On-demand search strictly for Chief (`askChief`) across the System Global Cold Vault (`global-vault/vault-chief-global.json`).
 * NEVER exposed to Lead/Subagent `chief_board` tools. */
export function searchGlobalVaultForChief(query = '', opts = {}, targetOpt) {
  const rawTarget = targetOpt !== undefined
    ? (typeof targetOpt === 'string' ? { customSharedBoardFile: targetOpt, vaultScope: 'global' } : { ...targetOpt, vaultScope: 'global' })
    : { ...(opts || {}), vaultScope: 'global' }
  const store = loadGlobalVaultRaw(rawTarget)
  return {
    ok: true,
    vaultScope: 'global',
    isSystemGlobalVault: true,
    ...scoreAndRankArchiveItems(store, query, opts),
  }
}

function upsertWatchEntry(store, item, vaultScope, by = 'user') {
  if (!store || !item || !item.id) return
  const arr = Array.isArray(store.recentlyUnpinnedWatch) ? store.recentlyUnpinnedWatch.slice() : []
  const filtered = arr.filter(x => !(x && x.id === item.id && x.vaultScope === vaultScope))
  filtered.unshift({
    id: item.id,
    vaultScope: vaultScope === 'global' ? 'global' : 'session',
    title: clamp(item.title || '未命名卷宗', 120),
    folder: str(item.folder, 'inbox').trim() || 'inbox',
    unpinnedAt: Date.now(),
    by: clamp(by || 'user', 30),
  })
  store.recentlyUnpinnedWatch = filtered.slice(0, 12)
}

function removeWatchEntry(store, id, vaultScope = '') {
  if (!store || !Array.isArray(store.recentlyUnpinnedWatch) || !id) return
  store.recentlyUnpinnedWatch = store.recentlyUnpinnedWatch.filter(x =>
    !(x && x.id === id && (!vaultScope || x.vaultScope === vaultScope))
  )
}

function mutateDesktopPinState(op, payload, effectiveTarget, baseOpts) {
  const sid = cleanRootSessionId(payload.rootSessionId || payload.session || effectiveTarget.rootSessionId)
  if (!sid) return { ok: false, error: '当前未绑定对话会话，无法操作认知桌面' }
  const id = str(payload.archiveId || payload.id, '').trim()
  const targetScope = normalizeVaultScope(payload.vaultScope || payload.scope || effectiveTarget.vaultScope) === 'global' ? 'global' : 'session'
  const by = clamp(payload.by || 'user', 30)
  const isPin = op === 'takeOut' || op === 'pinToDesktop'

  const sessionOpt = {
    ...baseOpts,
    cwd: effectiveTarget.cwd || baseOpts.cwd,
    projectKey: effectiveTarget.projectKey || baseOpts.projectKey,
    cabinetId: targetScope === 'session' ? (effectiveTarget.cabinetId || baseOpts.cabinetId) : '',
    rootSessionId: sid,
    vaultScope: 'session',
  }
  const globalOpt = {
    ...baseOpts,
    cwd: effectiveTarget.cwd || baseOpts.cwd,
    projectKey: effectiveTarget.projectKey || baseOpts.projectKey,
    cabinetId: '',
    rootSessionId: sid,
    vaultScope: 'global',
  }

  // Always lock session -> global to maintain strict single lock ordering
  return withArchiveLock(sessionOpt, (_sFile, sResolved) => {
    const sessTarget = { ...sessionOpt, cabinetId: sResolved.cabinetId, projectKey: sResolved.projectKey, vaultScope: 'session' }
    const sessStore = loadArchiveStore(sessTarget)
    return withArchiveLock(globalOpt, () => {
      const globStore = loadGlobalVaultRaw(globalOpt)
      const activeStore = targetScope === 'global' ? globStore : sessStore
      const targetItem = activeStore.items.find(it => it.id === id)
        || activeStore.items.find(it => normalizeArchiveTitleKey(it.title) === normalizeArchiveTitleKey(id))
      if (!targetItem) return { ok: false, error: '未找到该工程档案：' + id }

      let sessDirty = false
      let globDirty = false
      const evictedTitles = []
      const evictedItems = []

      if (isPin) {
        const clipWeight = { copper: 1, silver: 2, gold: 3 }
        const otherPinned = []
        const pushOther = (items, sc) => {
          for (const it of items) {
            if (!Array.isArray(it.takenOutSessions) || !it.takenOutSessions.includes(sid)) continue
            if (sc === targetScope && it.id === targetItem.id) continue
            const meta = (it.desktopMeta && it.desktopMeta[sid]) || {}
            otherPinned.push({
              item: it,
              scope: sc,
              tokens: estimateArchiveTokens(it),
              priority: (clipWeight[it.paperclip] || 2) * 10 + (Number(meta.priority) || 0),
              pinnedAt: Number(meta.pinnedAt) || Number(it.updatedAt) || 0,
            })
          }
        }
        pushOther(sessStore.items, 'session')
        pushOther(globStore.items, 'global')

        const cap = normalizeDesktopCapacity({
          maxItems: sessStore.desktopMaxItems,
          tokenBudget: sessStore.desktopTokenBudget,
        })
        const itemTokens = estimateArchiveTokens(targetItem)
        let usedTokens = otherPinned.reduce((sum, x) => sum + x.tokens, 0)
        otherPinned.sort((a, b) => a.priority - b.priority || a.pinnedAt - b.pinnedAt)

        while ((otherPinned.length >= cap.maxItems || (otherPinned.length > 0 && usedTokens + itemTokens > cap.tokenBudget))) {
          if (payload.autoEvict === false || payload.strictBudget === true) {
            return {
              ok: false,
              overBudget: true,
              usedTokens,
              itemTokens,
              tokenBudget: cap.tokenBudget,
              maxItems: cap.maxItems,
              error: `认知桌面容量已达上限（当前 ${usedTokens}/${cap.tokenBudget} Tokens，${otherPinned.length}/${cap.maxItems} 份），需先撤下旧文档或右上角「⋯」扩容桌面`,
            }
          }
          const victim = otherPinned.shift()
          if (!victim) break
          victim.item.takenOutSessions = (victim.item.takenOutSessions || []).filter(s => s !== sid)
          if (victim.item.desktopMeta && victim.item.desktopMeta[sid]) {
            delete victim.item.desktopMeta[sid]
          }
          usedTokens = Math.max(0, usedTokens - victim.tokens)
          evictedTitles.push(victim.item.title)
          evictedItems.push({ id: victim.item.id, title: victim.item.title, vaultScope: victim.scope })
          upsertWatchEntry(sessStore, victim.item, victim.scope, by)
          if (victim.scope === 'global') globDirty = true
          else sessDirty = true
        }

        targetItem.takenOutSessions = normalizeSessionIdList([...(targetItem.takenOutSessions || []), sid])
        targetItem.desktopMeta = normalizeDesktopMeta({
          ...(targetItem.desktopMeta || {}),
          [sid]: {
            pinnedAt: Date.now(),
            by,
            priority: clipWeight[targetItem.paperclip] || 2,
          },
        })
        removeWatchEntry(sessStore, targetItem.id, targetScope)
        sessDirty = true
        if (targetScope === 'global') globDirty = true
      } else {
        targetItem.takenOutSessions = (targetItem.takenOutSessions || []).filter(s => s !== sid)
        if (targetItem.desktopMeta && targetItem.desktopMeta[sid]) {
          delete targetItem.desktopMeta[sid]
        }
        upsertWatchEntry(sessStore, targetItem, targetScope, by)
        sessDirty = true
        if (targetScope === 'global') globDirty = true
      }

      if (sessDirty) saveArchiveStore(sessStore, sessTarget)
      if (globDirty) saveGlobalVaultRaw(globStore, globalOpt)

      const desktop = buildDesktopSummary(sid, sessStore, globStore)
      return {
        ok: true,
        id: targetItem.id,
        title: targetItem.title,
        takenOut: isPin,
        evictedTitles,
        evictedItems,
        desktop,
        isSystemGlobalVault: targetScope === 'global',
        counts: getThreeTierArchiveCounts(sid, [], sessTarget),
        meta: getArchiveMeta(sid, targetScope === 'global' ? globalOpt : sessTarget),
      }
    })
  })
}

/* ------------------------------------------- Cabinet & Archive Mutations */

export function mutateArchive(payload = {}, targetOpt) {
  const op = str(payload.op, 'save').trim()
  const baseOpts = resolveTargetOpts(targetOpt)
  const vaultScope = normalizeVaultScope(payload.vaultScope || payload.scope || baseOpts.vaultScope)
  const rootSessionId = cleanRootSessionId(payload.rootSessionId || payload.session || baseOpts.rootSessionId)
  const effectiveTarget = {
    ...baseOpts,
    cwd: str(payload.cwd, baseOpts.cwd),
    projectKey: str(payload.projectKey, baseOpts.projectKey),
    cabinetId: str(payload.cabinetId, baseOpts.cabinetId),
    rootSessionId,
    vaultScope,
  }

  if (['listCabinets', 'createCabinet', 'switchCabinet', 'renameCabinet', 'deleteCabinet'].includes(op)) {
    return mutateCabinetRegistry({ ...payload, vaultScope }, effectiveTarget)
  }

  if (op === 'takeOut' || op === 'pinToDesktop' || op === 'putBack' || op === 'unpinFromDesktop') {
    return mutateDesktopPinState(op, payload, effectiveTarget, baseOpts)
  }

  if (op === 'desktopStatus') {
    const sessStore = rootSessionId
      ? loadArchiveStore({ ...effectiveTarget, vaultScope: 'session' })
      : { items: [], unboundSession: true, recentlyUnpinnedWatch: [] }
    const globStore = loadGlobalVaultRaw(effectiveTarget)
    return {
      ok: true,
      desktop: buildDesktopSummary(rootSessionId, sessStore, globStore),
      sessionHooks: (sessStore.items || []).filter(it => it.hasHook && !(it.takenOutSessions || []).includes(rootSessionId)).map(it => ({
        id: it.id, title: it.title, folder: it.folder, hookKeywords: it.hookKeywords || [], hookCue: it.hookCue || '',
      })),
      globalHooks: (globStore.items || []).filter(it => it.hasHook && !(it.takenOutSessions || []).includes(rootSessionId)).map(it => ({
        id: it.id, title: it.title, folder: it.folder, hookKeywords: it.hookKeywords || [], hookCue: it.hookCue || '',
      })),
    }
  }

  return withArchiveLock(effectiveTarget, (_file, resolved) => {
    const store = loadArchiveStore({ ...effectiveTarget, cabinetId: resolved.cabinetId, rootSessionId: resolved.rootSessionId, vaultScope: resolved.vaultScope })
    const lockTarget = { ...effectiveTarget, cabinetId: resolved.cabinetId, projectKey: resolved.projectKey, rootSessionId: resolved.rootSessionId, vaultScope: resolved.vaultScope }
    const runOp = () => {

    if (op === 'createFolder' || op === 'saveFolder') {
      const rawLabel = clamp(payload.label || payload.folderLabel || payload.folder, 40)
      if (!rawLabel) return { ok: false, error: '请输入文件夹抽屉名称' }
      const id = str(payload.folderId, '').trim()
        || ('folder-' + rawLabel.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, '-').slice(0, 24) + '-' + Date.now().toString(36).slice(-3))
      const existing = store.folders.find(f => f.id === id || f.label === rawLabel)
      if (existing) {
        if (payload.hint !== undefined) existing.hint = clamp(payload.hint, 100)
        if (payload.accent) existing.accent = str(payload.accent, existing.accent).slice(0, 24)
        saveArchiveStore(store, lockTarget)
        return { ok: true, folder: existing }
      }
      const created = normalizeFolder({
        id,
        label: rawLabel,
        hint: payload.hint || '自定义工程记忆抽屉',
        accent: payload.accent || '#06b6d4',
        order: 55 + store.folders.length,
      })
      store.folders.push(created)
      saveArchiveStore(store, lockTarget)
      return { ok: true, folder: created }
    }

    if (op === 'save' || op === 'create' || op === 'update') {
      const id = str(payload.archiveId || payload.id, '').trim()
      const existing = id ? store.items.find(it => it.id === id) : null

      const nextBody = typeof payload.body === 'string'
        ? cleanMultiline(payload.body, 30000)
        : (existing ? existing.body : '')
      if (SECRET_PATTERN.test(nextBody)) {
        return { ok: false, error: '档案内容疑似包含密钥或私密凭据，已拒绝入库' }
      }

      if (existing) {
        const bodyChanged = typeof payload.body === 'string' && payload.body.trim() !== existing.body.trim()
        if (typeof payload.title === 'string' && payload.title.trim()) {
          existing.title = clamp(payload.title, 180)
        }
        if (typeof payload.body === 'string') {
          existing.body = nextBody
        }
        if (typeof payload.folder === 'string' && payload.folder.trim()) {
          existing.folder = payload.folder.trim()
        }
        if (['gold', 'silver', 'copper'].includes(payload.paperclip)) {
          existing.paperclip = payload.paperclip
        }
        if (Array.isArray(payload.tags)) {
          existing.tags = normalizeTags(payload.tags)
        } else if (typeof payload.tags === 'string') {
          existing.tags = normalizeTags(payload.tags.split(/[,，]/))
        }
        if (Array.isArray(payload.points) && payload.points.length) {
          existing.points = payload.points.map((p, i) => normalizePoint(p, i)).filter(Boolean).slice(0, POINTS_CAP)
          existing.organizedBy = ['auto', 'chief', 'user'].includes(payload.organizedBy) ? payload.organizedBy : 'user'
        } else if (bodyChanged) {
          existing.points = extractStructuredPoints(existing.title, existing.body)
        }
        if (['auto', 'chief', 'user'].includes(payload.organizedBy)) {
          existing.organizedBy = payload.organizedBy
        }
        if (typeof payload.summary === 'string' && payload.summary.trim()) {
          existing.summary = clamp(payload.summary, 140)
        } else if (bodyChanged) {
          existing.summary = clamp(
            (existing.points[0] && existing.points[0].cue) || firstMeaningfulSentence(existing.body) || existing.title,
            140,
          )
        }
        const hookNow = deriveHookFromStructuredItem({
          ...existing,
          ...(Array.isArray(payload.hookKeywords) ? { hookKeywords: payload.hookKeywords } : {}),
          ...(typeof payload.hookCue === 'string' ? { hookCue: payload.hookCue } : {}),
        }, existing.organizedBy === 'chief' || payload.hasHook === true || existing.hasHook === true)
        existing.hasHook = hookNow.hasHook
        existing.hookKeywords = hookNow.hookKeywords
        existing.hookCue = hookNow.hookCue
        existing.contentHash = computeEntryContentHash(existing)
        existing.updatedAt = Date.now()
        saveArchiveStore(store, lockTarget)
        return {
          ok: true,
          isSystemGlobalVault: resolved.vaultScope === 'global',
          item: existing,
          meta: getArchiveMeta(rootSessionId, lockTarget),
        }
      }

      const rawTitle = clamp(payload.title || '', 180)
      if (!rawTitle && !nextBody) {
        return { ok: false, error: '新建工程档案需要填写标题或正文内容' }
      }
      const titleKey = normalizeArchiveTitleKey(rawTitle)
      const sameTitle = titleKey
        ? store.items.find(it => normalizeArchiveTitleKey(it.title) === titleKey)
        : null
      if (sameTitle && payload.upsertByTitle !== false) {
        sameTitle.body = nextBody || sameTitle.body
        if (payload.folder) sameTitle.folder = str(payload.folder, sameTitle.folder).trim()
        if (['gold', 'silver', 'copper'].includes(payload.paperclip)) sameTitle.paperclip = payload.paperclip
        if (payload.tags) {
          sameTitle.tags = normalizeTags(Array.isArray(payload.tags) ? payload.tags : String(payload.tags).split(/[,，]/))
        }
        sameTitle.points = Array.isArray(payload.points) && payload.points.length
          ? payload.points.map((p, i) => normalizePoint(p, i)).filter(Boolean).slice(0, POINTS_CAP)
          : extractStructuredPoints(sameTitle.title, sameTitle.body)
        sameTitle.summary = clamp(
          payload.summary || (sameTitle.points[0] && sameTitle.points[0].cue) || firstMeaningfulSentence(sameTitle.body) || sameTitle.title,
          140,
        )
        sameTitle.contentHash = computeEntryContentHash(sameTitle)
        sameTitle.updatedAt = Date.now()
        saveArchiveStore(store, lockTarget)
        return {
          ok: true,
          isSystemGlobalVault: resolved.vaultScope === 'global',
          item: sameTitle,
          updatedExisting: true,
          meta: getArchiveMeta(rootSessionId, lockTarget),
        }
      }

      const parsed = smartParseNoteToDossier({
        title: rawTitle,
        body: nextBody,
        folder: payload.folder,
        paperclip: payload.paperclip,
        tags: Array.isArray(payload.tags) ? payload.tags : (typeof payload.tags === 'string' ? payload.tags.split(/[,，]/) : []),
      })
      const baseCreated = {
        id: nextId(resolved.vaultScope === 'global' ? 'glob' : 'arch'),
        sourceNoteId: str(payload.sourceNoteId, ''),
        originId: str(payload.originId, ''),
        originGlobalId: str(payload.originGlobalId, ''),
        title: parsed.title,
        summary: payload.summary || parsed.summary,
        folder: payload.folder || parsed.folder,
        paperclip: payload.paperclip || parsed.paperclip,
        tags: Array.isArray(payload.tags) ? payload.tags : (typeof payload.tags === 'string' ? payload.tags.split(/[,，]/) : []),
        cold: true,
        takenOutSessions: (payload.takeOutNow || payload.takeOut) && rootSessionId && resolved.vaultScope !== 'global' ? [rootSessionId] : [],
        chiefMountedSessions: resolved.vaultScope === 'global' && payload.mountChief && rootSessionId ? [rootSessionId] : [],
        hasHook: Boolean(payload.hasHook || payload.organizedBy === 'chief'),
        ...(Array.isArray(payload.hookKeywords) ? { hookKeywords: payload.hookKeywords } : {}),
        ...(typeof payload.hookCue === 'string' ? { hookCue: payload.hookCue } : {}),
        organizedBy: ['auto', 'chief', 'user'].includes(payload.organizedBy)
          ? payload.organizedBy
          : (Array.isArray(payload.points) && payload.points.length ? 'user' : 'auto'),
        points: Array.isArray(payload.points) && payload.points.length ? payload.points : parsed.points,
        body: nextBody,
        by: payload.by || 'user',
        sourceSession: rootSessionId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      const created = resolved.vaultScope === 'global'
        ? normalizeGlobalVaultEntry(baseCreated)
        : normalizeArchiveItem(baseCreated)
      store.items.unshift(created)
      saveArchiveStore(store, lockTarget)
      return {
        ok: true,
        isSystemGlobalVault: resolved.vaultScope === 'global',
        item: created,
        meta: getArchiveMeta(rootSessionId, lockTarget),
      }
    }

    if (op === 'delete' || op === 'remove') {
      const id = str(payload.archiveId || payload.id, '').trim()
      const idx = store.items.findIndex(it => it.id === id)
      if (idx < 0) return { ok: false, error: '未找到要删除的档案：' + id }
      const [removed] = store.items.splice(idx, 1)
      saveArchiveStore(store, lockTarget)
      return { ok: true, removedId: removed.id, title: removed.title, meta: getArchiveMeta(rootSessionId, lockTarget) }
    }

    if (op === 'clearByIds' || op === 'clearFolder') {
      const ids = new Set(Array.isArray(payload.ids) ? payload.ids.map(x => String(x || '').trim()).filter(Boolean) : [])
      const folder = str(payload.folder, '').trim()
      const before = store.items.length
      store.items = store.items.filter((it) => {
        if (op === 'clearFolder') return it.folder !== folder
        return !ids.has(it.id)
      })
      const removedCount = before - store.items.length
      if (removedCount > 0) saveArchiveStore(store, lockTarget)
      return { ok: true, removedCount, meta: getArchiveMeta(rootSessionId, lockTarget) }
    }

    if (op === 'mountChief' || op === 'unmountChief') {
      if (resolved.vaultScope !== 'global') {
        return { ok: false, error: '仅系统全局档案柜支持参谋长参阅挂载操作' }
      }
      if (!rootSessionId) {
        return { ok: false, error: '当前为空白新对话（尚未绑定会话 ID），请先在主会话发送一条消息后再供参谋长参阅' }
      }
      const id = str(payload.archiveId || payload.id, '').trim()
      const item = store.items.find(it => it.id === id)
      if (!item) return { ok: false, error: '未找到该全局档案：' + id }
      const set = new Set(item.chiefMountedSessions || [])
      if (op === 'mountChief') set.add(rootSessionId)
      else set.delete(rootSessionId)
      item.chiefMountedSessions = [...set]
      saveArchiveStore(store, lockTarget)
      return {
        ok: true,
        id: item.id,
        title: item.title,
        chiefMounted: op === 'mountChief',
        isSystemGlobalVault: true,
        counts: getThreeTierArchiveCounts(rootSessionId, [], lockTarget),
      }
    }

    if (op === 'pullByLead') {
      if (resolved.vaultScope === 'global') {
        return { ok: false, denied: true, error: '主代理不可直接拉取全局档案柜未上桌卷宗，请由参谋长整理呈递或摆上桌面' }
      }
      if (!rootSessionId) {
        return { ok: false, error: '当前为空白新对话，尚未建立本局档案柜' }
      }
      const q = str(payload.archiveId || payload.id || payload.title, '').trim()
      if (!q) return { ok: false, error: 'pullByLead 需要指定档案 id 或标题' }
      const qLow = q.toLowerCase()
      const item = store.items.find(it => it.id === q)
        || store.items.find(it => it.title === q)
        || store.items.find(it => it.title.toLowerCase().includes(qLow))
      if (!item) return { ok: false, error: '未找到本局工程档案：' + q }
      const isOnDesk = Array.isArray(item.takenOutSessions) && item.takenOutSessions.includes(rootSessionId)
      if (!item.hasHook && !isOnDesk && payload.allowUnorganized !== true) {
        return { ok: false, unhooked: true, error: `本局档案《${item.title}》尚未经过参谋长整理织就钩子，暂未向主代理开放拉阅` }
      }
      item.leadPulledSessions = normalizeSessionIdList([...(item.leadPulledSessions || []), rootSessionId])
      saveArchiveStore(store, lockTarget)
      return {
        ok: true,
        vaultScope: 'session',
        item: {
          ...item,
          viewerStatus: computeArchiveViewerStatus(item, rootSessionId, 'session'),
        },
      }
    }

    if (op === 'pullByChief') {
      const q = str(payload.archiveId || payload.id || payload.title, '').trim()
      if (!q) return { ok: false, error: 'pullByChief 需要指定档案 id 或标题' }
      const qLow = q.toLowerCase()
      const item = store.items.find(it => it.id === q)
        || store.items.find(it => it.title === q)
        || store.items.find(it => it.title.toLowerCase().includes(qLow))
      if (!item) return { ok: false, error: '未找到工程档案：' + q }
      if (resolved.vaultScope === 'global') {
        const mounted = Boolean(rootSessionId && Array.isArray(item.chiefMountedSessions) && item.chiefMountedSessions.includes(rootSessionId))
        if (!item.hasHook && !mounted && payload.allowUnhooked !== true) {
          return { ok: false, unhooked: true, error: `全局档案《${item.title}》尚未经过参谋整理织就钩子，请先由人类整理或开放参阅` }
        }
      }
      if (rootSessionId) {
        item.chiefPulledSessions = normalizeSessionIdList([...(item.chiefPulledSessions || []), rootSessionId])
        if (resolved.vaultScope === 'global') {
          item.chiefMountedSessions = normalizeSessionIdList([...(item.chiefMountedSessions || []), rootSessionId])
        }
        saveArchiveStore(store, lockTarget)
      }
      return {
        ok: true,
        vaultScope: resolved.vaultScope,
        isSystemGlobalVault: resolved.vaultScope === 'global',
        item: {
          ...item,
          viewerStatus: computeArchiveViewerStatus(item, rootSessionId, resolved.vaultScope),
        },
      }
    }

    if (op === 'markDeliveredToLead') {
      if (!rootSessionId) return { ok: false, error: '当前为空白新对话，无法向主代理递交档案' }
      const q = str(payload.archiveId || payload.id || payload.title, '').trim()
      if (!q) return { ok: false, error: 'markDeliveredToLead 需要指定档案 id 或标题' }
      const qLow = q.toLowerCase()
      const item = store.items.find(it => it.id === q)
        || store.items.find(it => it.title === q)
        || store.items.find(it => it.title.toLowerCase().includes(qLow))
      if (!item) return { ok: false, error: '未找到工程档案：' + q }
      item.chiefDeliveredSessions = normalizeSessionIdList([...(item.chiefDeliveredSessions || []), rootSessionId])
      saveArchiveStore(store, lockTarget)
      return {
        ok: true,
        vaultScope: resolved.vaultScope,
        isSystemGlobalVault: resolved.vaultScope === 'global',
        item: {
          ...item,
          viewerStatus: computeArchiveViewerStatus(item, rootSessionId, resolved.vaultScope),
        },
      }
    }

    if (op === 'clearUnpinnedWatch') {
      const targetIds = Array.isArray(payload.ids) ? new Set(payload.ids.map(String)) : null
      if (resolved.vaultScope === 'session') {
        store.recentlyUnpinnedWatch = targetIds
          ? (store.recentlyUnpinnedWatch || []).filter(w => w && !targetIds.has(w.id))
          : []
        saveArchiveStore(store, lockTarget)
      }
      return { ok: true, recentlyUnpinnedWatch: store.recentlyUnpinnedWatch || [] }
    }

    if (op === 'setDesktopCapacity') {
      if (resolved.vaultScope !== 'session') {
        return { ok: false, error: '认知桌面容量仅在当前会话档案柜设置，请先绑定对话窗口' }
      }
      const nextCap = normalizeDesktopCapacity(
        {
          maxItems: payload.maxItems,
          tokenBudget: payload.tokenBudget,
        },
        {
          maxItems: store.desktopMaxItems,
          tokenBudget: store.desktopTokenBudget,
        },
      )
      store.desktopMaxItems = nextCap.maxItems
      store.desktopTokenBudget = nextCap.tokenBudget
      store.updatedAt = Date.now()
      saveArchiveStore(store, lockTarget)
      return {
        ok: true,
        maxItems: nextCap.maxItems,
        tokenBudget: nextCap.tokenBudget,
      }
    }

    if (op === 'cycleClip' || op === 'setClip') {
      const id = str(payload.archiveId || payload.id, '').trim()
      const item = store.items.find(it => it.id === id)
      if (!item) return { ok: false, error: '未找到该工程档案：' + id }
      const order = ['gold', 'silver', 'copper']
      if (order.includes(payload.paperclip)) {
        item.paperclip = payload.paperclip
      } else {
        const nextIdx = (order.indexOf(item.paperclip) + 1) % order.length
        item.paperclip = order[nextIdx]
      }
      item.updatedAt = Date.now()
      saveArchiveStore(store, lockTarget)
      return { ok: true, id: item.id, paperclip: item.paperclip }
    }

    if (op === 'moveFolder') {
      const id = str(payload.archiveId || payload.id, '').trim()
      const folder = str(payload.folder, '').trim()
      if (!folder) return { ok: false, error: '请选择目标文件夹抽屉' }
      const item = store.items.find(it => it.id === id)
      if (!item) return { ok: false, error: '未找到该工程档案：' + id }
      item.folder = folder
      if (payload.folderLabel && !store.folders.some(f => f.id === folder)) {
        store.folders.push(normalizeFolder({ id: folder, label: payload.folderLabel, order: 58 }))
      }
      if (resolved.vaultScope === 'session' && folder !== 'inbox') {
        removeWatchEntry(store, item.id, 'session')
      }
      item.updatedAt = Date.now()
      saveArchiveStore(store, lockTarget)
      return { ok: true, id: item.id, folder: item.folder }
    }

    if (op === 'copyToGlobal' || op === 'copyToSession') {
      const id = str(payload.archiveId || payload.id, '').trim()
      const srcItem = store.items.find(it => it.id === id)
      if (!srcItem) return { ok: false, error: '未找到要复制的工程档案：' + id }
      const targetScope = op === 'copyToGlobal' ? 'global' : 'session'
      if (targetScope === 'session' && !rootSessionId) {
        return { ok: false, error: '当前为空白新对话，请先发送一条消息建立会话后再引入本会话档案柜' }
      }
      const dstBase = {
        customSharedBoardFile: baseOpts.customSharedBoardFile,
        cwd: effectiveTarget.cwd,
        projectKey: effectiveTarget.projectKey,
        rootSessionId: targetScope === 'session' ? rootSessionId : '',
        vaultScope: targetScope,
        cabinetId: '',
      }
      const titleKey = normalizeArchiveTitleKey(srcItem.title)
      const copyRes = withArchiveLock(dstBase, (_dstFile, dstResolved) => {
        const dstTarget = { ...dstBase, cabinetId: dstResolved.cabinetId, projectKey: dstResolved.projectKey, vaultScope: targetScope }
        const dstStore = targetScope === 'global' ? loadGlobalVaultRaw(dstTarget) : loadArchiveStore(dstTarget)
        const now = Date.now()
        let savedItem

        if (targetScope === 'global') {
          const existing = dstStore.items.find(g =>
            (srcItem.originGlobalId && g.id === srcItem.originGlobalId)
            || (g.originId && g.originId === srcItem.id)
            || (titleKey && normalizeArchiveTitleKey(g.title) === titleKey)
          )
          const preservedChiefMounts = existing
            ? (Array.isArray(existing.chiefMountedSessions) ? existing.chiefMountedSessions : [])
            : (payload.mountChief && rootSessionId ? [rootSessionId] : [])
          const nextEntry = normalizeGlobalVaultEntry({
            ...srcItem,
            id: existing ? existing.id : nextId('glob'),
            originId: srcItem.id,
            originGlobalId: '',
            chiefMountedSessions: preservedChiefMounts,
            sourceSession: srcItem.sourceSession || rootSessionId,
            updatedAt: now,
          })
          if (existing) {
            Object.assign(existing, nextEntry)
            savedItem = existing
          } else {
            dstStore.items.unshift(nextEntry)
            savedItem = nextEntry
          }
          saveGlobalVaultRaw(dstStore, dstTarget)
          const sessSnapshot = resolved.vaultScope === 'session'
            ? store.items.map(it => (it.id === srcItem.id && payload.removeSource !== true ? { ...it, originGlobalId: savedItem.id } : it))
            : []
          const diff = computeSessionGlobalDiff(sessSnapshot, dstStore.items, rootSessionId)
          return {
            ok: true,
            targetScope: 'global',
            isSystemGlobalVault: true,
            targetCabinetId: '',
            item: savedItem,
            diffSummary: diff.summary,
            counts: getThreeTierArchiveCounts(rootSessionId, [], dstBase),
          }
        }

        // targetScope === 'session'
        const mountOnSession = payload.takeOut === true
        const existingSess = dstStore.items.find(s =>
          s.originGlobalId === srcItem.id
          || (srcItem.originId && s.id === srcItem.originId)
          || (titleKey && normalizeArchiveTitleKey(s.title) === titleKey)
        )
        const nextSessItem = normalizeArchiveItem({
          ...srcItem,
          id: existingSess ? existingSess.id : nextId('arch'),
          originGlobalId: srcItem.id,
          originId: '',
          takenOutSessions: mountOnSession
            ? [...new Set([...(existingSess ? (existingSess.takenOutSessions || []) : []), rootSessionId])]
            : (existingSess ? (existingSess.takenOutSessions || []) : []),
          sourceSession: rootSessionId,
          updatedAt: now,
        })
        if (existingSess) {
          Object.assign(existingSess, nextSessItem)
          savedItem = existingSess
        } else {
          dstStore.items.unshift(nextSessItem)
          savedItem = nextSessItem
        }
        saveArchiveStore(dstStore, dstTarget)
        const globalItems = resolved.vaultScope === 'global' ? store.items : loadGlobalVaultRaw(baseOpts).items
        const diff = computeSessionGlobalDiff(dstStore.items, globalItems, rootSessionId)
        return {
          ok: true,
          targetScope: 'session',
          isSystemGlobalVault: false,
          targetCabinetId: dstResolved.cabinetId,
          item: savedItem,
          diffSummary: diff.summary,
          counts: getThreeTierArchiveCounts(rootSessionId, [], dstBase),
        }
      })

      if (copyRes && copyRes.ok) {
        if (payload.removeSource === true && resolved.vaultScope !== targetScope) {
          const idx = store.items.findIndex(it => it.id === id)
          if (idx >= 0) {
            store.items.splice(idx, 1)
            saveArchiveStore(store, lockTarget)
            copyRes.counts = getThreeTierArchiveCounts(rootSessionId, [], dstBase)
          }
        } else if (targetScope === 'global' && resolved.vaultScope === 'session' && copyRes.item && srcItem.originGlobalId !== copyRes.item.id) {
          srcItem.originGlobalId = copyRes.item.id
          saveArchiveStore(store, lockTarget)
        }
      }
      return copyRes
    }

      return { ok: false, error: '未知的档案操作：' + op }
    }
    const opRes = runOp()
    return (opRes && opRes.ok && !opRes.cabinetId && !opRes.isSystemGlobalVault)
      ? { cabinetId: resolved.cabinetId, isSystemGlobalVault: resolved.vaultScope === 'global', ...opRes }
      : opRes
  })
}

export function applyChiefArchiveCurations(curations = [], newFolders = [], targetOpt) {
  if (!Array.isArray(curations) || !curations.length) return { updatedCount: 0 }
  return withArchiveLock(targetOpt, (_file, resolved) => {
    const base = resolveTargetOpts(targetOpt)
    const lockTarget = {
      ...base,
      cabinetId: resolved.cabinetId,
      projectKey: resolved.projectKey,
      rootSessionId: resolved.rootSessionId || base.rootSessionId,
      vaultScope: resolved.vaultScope || base.vaultScope,
    }
    const store = loadArchiveStore(lockTarget)
    if (Array.isArray(newFolders)) {
      newFolders.forEach((nf, idx) => {
        if (!nf || !nf.id) return
        const cleanId = String(nf.id).trim().slice(0, 48)
        if (!cleanId) return
        const existing = store.folders.find(f => f.id === cleanId)
        if (existing) {
          if (nf.label) existing.label = clamp(nf.label, 40)
          if (nf.hint) existing.hint = clamp(nf.hint, 100)
        } else {
          const created = normalizeFolder({
            id: cleanId,
            label: nf.label || cleanId,
            hint: nf.hint || '由 DSH 参谋长整理归纳的工程档案抽屉',
            accent: nf.accent || '#06b6d4',
            order: 52 + idx,
          })
          if (created) store.folders.push(created)
        }
      })
    }

    let updatedCount = 0
    for (const c of curations) {
      if (!c || !c.id) continue
      const target = store.items.find(it => it.id === c.id)
      if (!target) continue
      if (typeof c.folder === 'string' && c.folder.trim()) {
        const fId = c.folder.trim().slice(0, 48)
        target.folder = fId
        if (c.folderLabel && !store.folders.some(f => f.id === fId)) {
          const created = normalizeFolder({
            id: fId,
            label: c.folderLabel,
            hint: '由 DSH 参谋长整理建立的工程抽屉',
            accent: '#06b6d4',
          })
          if (created) store.folders.push(created)
        }
      }
      if (['gold', 'silver', 'copper'].includes(c.paperclip)) {
        target.paperclip = c.paperclip
      }
      if (typeof c.summary === 'string' && c.summary.trim()) {
        target.summary = clamp(c.summary, 140)
      }
      if (Array.isArray(c.tags) && c.tags.length) {
        target.tags = normalizeTags(c.tags)
      }
      if (Array.isArray(c.points) && c.points.length) {
        const validPts = c.points.map((p, idx) => normalizePoint(p, idx)).filter(Boolean).slice(0, POINTS_CAP)
        if (validPts.length) {
          target.points = validPts
        }
      }
      const hook = deriveHookFromStructuredItem({
        ...target,
        ...(Array.isArray(c.hookKeywords) ? { hookKeywords: c.hookKeywords } : {}),
        ...(typeof c.hookCue === 'string' && c.hookCue.trim() ? { hookCue: c.hookCue.trim() } : {}),
      }, true)
      target.hasHook = hook.hasHook
      target.hookKeywords = hook.hookKeywords
      target.hookCue = hook.hookCue
      target.organizedBy = 'chief'
      target.updatedAt = Date.now()
      if (target.folder !== 'inbox' || c.clearUnpinnedWatch) {
        removeWatchEntry(store, target.id)
      }
      updatedCount += 1
    }

    if (updatedCount > 0) {
      saveArchiveStore(store, lockTarget)
    }
    return { updatedCount }
  })
}

/* --------------------- Cross-Session Handoff Archive Copy (Never Precipitated) */

/**
 * Transfers ONLY active cabinet dossiers selected by `policy`:
 * - `'none'`: zero transfers
 * - `'mounted'`: only dossiers explicitly taken out on `fromRootSessionId` (`takenOutSessions`)
 * - `'drawer'`: dossiers inside `drawer` folder in source cabinet
 * - `'all'`: all dossiers in source active cabinet
 * Strictly NEVER reads or transfers `precipitated/<projectKey>.json`!
 */
export function copyArchivesBetweenSessionsOrCabinets({
  fromRootSessionId = '',
  toRootSessionId = '',
  fromCwd = '',
  toCwd = '',
  fromCabinetId = '',
  toCabinetId = '',
  policy = 'none',
  drawer = '',
  customSharedBoardFile = '',
}) {
  const mode = ['none', 'mounted', 'drawer', 'all'].includes(policy) ? policy : 'none'
  const fromSid = str(fromRootSessionId, '').trim()
  const toSid = str(toRootSessionId, '').trim()
  if (mode === 'none' || !fromSid || !toSid) {
    return { ok: true, policy: mode, transferredCount: 0, mountedCount: 0 }
  }

  const srcTarget = {
    customSharedBoardFile,
    cwd: fromCwd,
    cabinetId: fromCabinetId,
    rootSessionId: fromSid,
    vaultScope: 'session',
  }
  const dstTarget = {
    customSharedBoardFile,
    cwd: toCwd || fromCwd,
    cabinetId: toCabinetId,
    rootSessionId: toSid,
    vaultScope: 'session',
  }

  const srcResolved = ensureProjectCabinet(srcTarget)
  const dstResolved = ensureProjectCabinet(dstTarget)
  if (srcResolved.unboundSession || dstResolved.unboundSession) {
    return { ok: true, policy: mode, transferredCount: 0, mountedCount: 0 }
  }
  const srcStore = loadArchiveStore({ customSharedBoardFile, cabinetId: srcResolved.cabinetId, projectKey: srcResolved.projectKey, rootSessionId: fromSid, vaultScope: 'session' })

  let selected = []
  if (mode === 'mounted') {
    selected = srcStore.items.filter(it => fromSid && Array.isArray(it.takenOutSessions) && it.takenOutSessions.includes(fromSid))
  } else if (mode === 'drawer') {
    const fId = str(drawer, '').trim()
    selected = srcStore.items.filter(it => !fId || it.folder === fId)
  } else if (mode === 'all') {
    selected = srcStore.items.slice()
  }

  if (!selected.length) {
    return {
      ok: true,
      policy: mode,
      sameCabinet: srcResolved.cabinetId === dstResolved.cabinetId,
      targetCabinetId: dstResolved.cabinetId,
      transferredCount: 0,
      mountedCount: 0,
    }
  }

  // Same cabinet: update `takenOutSessions` on selected items directly (mount mounted items or selected drawer items for target)
  if (srcResolved.cabinetId === dstResolved.cabinetId) {
    return withArchiveLock({ customSharedBoardFile, cabinetId: dstResolved.cabinetId, projectKey: dstResolved.projectKey, rootSessionId: toSid, vaultScope: 'session' }, () => {
      const store = loadArchiveStore({ customSharedBoardFile, cabinetId: dstResolved.cabinetId, projectKey: dstResolved.projectKey, rootSessionId: toSid, vaultScope: 'session' })
      let mountedCount = 0
      const selectedIds = new Set(selected.map(s => s.id))
      for (const it of store.items) {
        if (!selectedIds.has(it.id)) continue
        const shouldMount = mode === 'mounted' || (fromSid && Array.isArray(it.takenOutSessions) && it.takenOutSessions.includes(fromSid)) || mode === 'drawer'
        if (shouldMount) {
          const set = new Set(it.takenOutSessions || [])
          if (!set.has(toSid)) {
            set.add(toSid)
            it.takenOutSessions = [...set]
            mountedCount += 1
          }
        }
      }
      if (mountedCount > 0) {
        saveArchiveStore(store, { customSharedBoardFile, cabinetId: dstResolved.cabinetId, projectKey: dstResolved.projectKey, rootSessionId: toSid, vaultScope: 'session' })
      }
      return {
        ok: true,
        policy: mode,
        sameCabinet: true,
        targetCabinetId: dstResolved.cabinetId,
        transferredCount: selected.length,
        mountedCount,
      }
    })
  }

  // Different cabinets: copy folders metadata & dossiers into destination cabinet
  return withArchiveLock({ customSharedBoardFile, cabinetId: dstResolved.cabinetId, projectKey: dstResolved.projectKey, rootSessionId: toSid, vaultScope: 'session' }, () => {
    const dstStore = loadArchiveStore({ customSharedBoardFile, cabinetId: dstResolved.cabinetId, projectKey: dstResolved.projectKey, rootSessionId: toSid, vaultScope: 'session' })
    const folderIds = new Set(dstStore.folders.map(f => f.id))
    for (const f of srcStore.folders) {
      if (!folderIds.has(f.id)) {
        dstStore.folders.push({ ...f })
        folderIds.add(f.id)
      }
    }
    const existingTitles = new Map(dstStore.items.map(it => [it.title, it]))
    let copiedCount = 0
    let mountedCount = 0
    for (const srcItem of selected) {
      const shouldMount = mode === 'mounted' || (fromSid && srcItem.takenOutSessions.includes(fromSid))
      const dup = existingTitles.get(srcItem.title)
      if (dup) {
        if (shouldMount && !dup.takenOutSessions.includes(toSid)) {
          dup.takenOutSessions.push(toSid)
          mountedCount += 1
        }
        dup.updatedAt = Date.now()
        copiedCount += 1
        continue
      }
      const cloned = normalizeArchiveItem({
        ...srcItem,
        id: nextId('arch'),
        takenOutSessions: shouldMount ? [toSid] : [],
        updatedAt: Date.now(),
      })
      if (cloned) {
        dstStore.items.unshift(cloned)
        copiedCount += 1
        if (shouldMount) mountedCount += 1
      }
    }
    if (copiedCount > 0 || mountedCount > 0) {
      saveArchiveStore(dstStore, { customSharedBoardFile, cabinetId: dstResolved.cabinetId, projectKey: dstResolved.projectKey, rootSessionId: toSid, vaultScope: 'session' })
    }
    return {
      ok: true,
      policy: mode,
      sameCabinet: false,
      targetCabinetId: dstResolved.cabinetId,
      transferredCount: copiedCount,
      mountedCount,
    }
  })
}

/* --------------------- Precipitated Cross-Session Vault (STRICTLY 0 AUTO-READ) */

registerArchiveMutatorHook(mutateArchive)
