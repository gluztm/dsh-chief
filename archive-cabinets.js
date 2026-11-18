/**
 * archive-cabinets.js
 *
 * Project cabinet registry, legacy shared-board migration, and locked Global/Session vault IO.
 */

import fs from 'node:fs'
import path from 'node:path'
import {
  ARCHIVE_VERSION,
  SECRET_PATTERN,
  nextId,
  str,
  clamp,
  resolveProjectKey,
  normalizeVaultScope,
  cleanRootSessionId,
  resolveTargetOpts,
  normalizeSessionScopeKey,
  sessionCabinetId,
  legacyArchiveFilePath,
  cabinetRegistryPath,
  cabinetFilePath,
  globalChiefVaultFilePath,
  acquireFileLock,
  invalidateArchiveCache,
  atomicWriteJson,
  readJsonSafe,
  normalizeArchiveItem,
  normalizeArchiveStore,
  smartParseNoteToDossier,
  getCachedArchiveStore,
  setCachedArchiveStore,
} from './archive-core.js'

function normalizeRegistry(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const projects = {}
  if (src.projects && typeof src.projects === 'object') {
    for (const [k, proj] of Object.entries(src.projects)) {
      if (!proj || typeof proj !== 'object') continue
      const pKey = resolveProjectKey(k)
      const cabinets = (Array.isArray(proj.cabinets) ? proj.cabinets : [])
        .filter(c => c && typeof c === 'object' && str(c.id, '').trim())
        .map(c => ({
          id: str(c.id, '').trim().slice(0, 72),
          name: clamp(c.name || '默认档案柜', 40),
          projectKey: pKey,
          cwd: str(c.cwd, '').slice(0, 260),
          createdAt: Number(c.createdAt) || Date.now(),
          updatedAt: Number(c.updatedAt) || Number(c.createdAt) || Date.now(),
        }))
      if (!cabinets.length) continue
      const activeCabinetId = cabinets.some(c => c.id === proj.activeCabinetId)
        ? proj.activeCabinetId
        : cabinets[0].id
      projects[pKey] = {
        projectKey: pKey,
        cwd: str(proj.cwd, '').slice(0, 260),
        activeCabinetId,
        cabinets,
      }
    }
  }
  const sessions = {}
  if (src.sessions && typeof src.sessions === 'object') {
    for (const [rawKey, sess] of Object.entries(src.sessions)) {
      if (!sess || typeof sess !== 'object') continue
      const rSid = str(sess.rootSessionId || rawKey.replace(/^sess:/, ''), '').trim()
      const sKey = normalizeSessionScopeKey(rSid)
      if (!sKey) continue
      const pKey = resolveProjectKey(sess.projectKey || sess.cwd || 'proj-default')
      const cabinets = (Array.isArray(sess.cabinets) ? sess.cabinets : [])
        .filter(c => c && typeof c === 'object' && str(c.id, '').trim())
        .map(c => ({
          id: str(c.id, '').trim().slice(0, 72),
          name: clamp(c.name || '本对话工作档案柜', 40),
          projectKey: pKey,
          rootSessionId: rSid,
          cwd: str(c.cwd, '').slice(0, 260),
          createdAt: Number(c.createdAt) || Date.now(),
          updatedAt: Number(c.updatedAt) || Number(c.createdAt) || Date.now(),
        }))
      if (!cabinets.length) continue
      const activeCabinetId = cabinets.some(c => c.id === sess.activeCabinetId)
        ? sess.activeCabinetId
        : cabinets[0].id
      sessions[sKey] = {
        sessionKey: sKey,
        rootSessionId: rSid,
        projectKey: pKey,
        cwd: str(sess.cwd, '').slice(0, 260),
        activeCabinetId,
        cabinets,
      }
    }
  }
  let globalEntry = null
  if (src.global && typeof src.global === 'object') {
    const gCabs = (Array.isArray(src.global.cabinets) ? src.global.cabinets : [])
      .filter(c => c && typeof c === 'object' && str(c.id, '').trim())
      .map(c => ({
        id: str(c.id, '').trim().slice(0, 72),
        name: clamp(c.name || '🌐 全局工作档案柜', 40),
        projectKey: 'global',
        cwd: '',
        createdAt: Number(c.createdAt) || Date.now(),
        updatedAt: Number(c.updatedAt) || Number(c.createdAt) || Date.now(),
      }))
    if (gCabs.length) {
      globalEntry = {
        projectKey: 'global',
        cwd: '',
        activeCabinetId: gCabs.some(c => c.id === src.global.activeCabinetId) ? src.global.activeCabinetId : gCabs[0].id,
        cabinets: gCabs,
      }
    }
  }
  return {
    version: ARCHIVE_VERSION,
    migratedLegacy: Boolean(src.migratedLegacy),
    migratedGlobalAt: Number(src.migratedGlobalAt) || 0,
    migratedAt: Number(src.migratedAt) || 0,
    legacyOwnerProjectKey: str(src.legacyOwnerProjectKey, ''),
    projects,
    sessions,
    global: globalEntry,
  }
}

function writeRegistryRaw(regFile, registry) {
  atomicWriteJson(regFile, normalizeRegistry(registry))
}

function claimSessionOwnLegacyItems(reg, projectKey, rootSessionId, opts) {
  const claimed = []
  const seenTitles = new Set()
  const candidateCabIds = new Set(['cab-main'])
  const projEntry = reg.projects && reg.projects[projectKey]
  if (projEntry && Array.isArray(projEntry.cabinets)) {
    for (const c of projEntry.cabinets) {
      if (c && c.id) candidateCabIds.add(c.id)
    }
  }
  for (const cabId of candidateCabIds) {
    const file = cabinetFilePath(cabId, opts.customSharedBoardFile)
    const parsed = readJsonSafe(file, null)
    const items = Array.isArray(parsed && parsed.items) ? parsed.items : []
    for (const rawItem of items) {
      if (!rawItem || str(rawItem.sourceSession, '').trim() !== rootSessionId) continue
      const norm = normalizeArchiveItem(rawItem)
      if (!norm || seenTitles.has(norm.title)) continue
      seenTitles.add(norm.title)
      claimed.push(norm)
    }
  }
  return claimed
}

export function ensureProjectCabinet(targetOpt) {
  const opts = resolveTargetOpts(targetOpt)
  const regFile = cabinetRegistryPath(opts.customSharedBoardFile)
  const legacyFile = legacyArchiveFilePath(opts.customSharedBoardFile)
  const projectKey = opts.projectKey ? resolveProjectKey(opts.projectKey) : resolveProjectKey(opts.cwd)
  const sessKey = normalizeSessionScopeKey(opts.rootSessionId)
  const vaultScope = opts.vaultScope === 'global' ? 'global' : 'session'

  const release = acquireFileLock(regFile)
  try {
    let reg = normalizeRegistry(readJsonSafe(regFile, null))
    let dirty = false

    // 1. One-time lossless migration from legacy `%DSH_HOME%/chief/archives.json` -> `cabinets/cab-main.json`
    if (!reg.migratedLegacy && fs.existsSync(legacyFile)) {
      const legacyParsed = readJsonSafe(legacyFile, null)
      const cabMainFile = cabinetFilePath('cab-main', opts.customSharedBoardFile)
      if (legacyParsed && !fs.existsSync(cabMainFile)) {
        const normalizedLegacy = normalizeArchiveStore({
          ...legacyParsed,
          cabinetId: 'cab-main',
          cabinetName: '默认主档案柜',
          projectKey,
        })
        atomicWriteJson(cabMainFile, normalizedLegacy)
      }
      if (!reg.projects[projectKey]) {
        const now = Date.now()
        reg.projects[projectKey] = {
          projectKey,
          cwd: opts.cwd,
          activeCabinetId: 'cab-main',
          cabinets: [
            {
              id: 'cab-main',
              name: opts.cwd ? `${path.basename(opts.cwd) || '当前工程'} · 主档案柜` : '默认主档案柜',
              projectKey,
              cwd: opts.cwd,
              createdAt: now,
              updatedAt: now,
            },
          ],
        }
        reg.legacyOwnerProjectKey = projectKey
      }
      reg.migratedLegacy = true
      reg.migratedAt = Date.now()
      dirty = true
    }

    // 2. SYSTEM GLOBAL COLD VAULT (`vaultScope === 'global'`):
    // Mirrors Precipitated Vault's system-level cold storage: NEVER auto-populated from cab-main or project cabinets,
    // NEVER follows conversation context automatically (0 Token until Chief-search hit or explicit mount/import).
    if (vaultScope === 'global') {
      const globalFile = globalChiefVaultFilePath(opts.customSharedBoardFile)
      if (dirty) {
        writeRegistryRaw(regFile, reg)
      }
      return {
        scope: 'global',
        vaultScope: 'global',
        isSystemGlobalVault: true,
        unboundSession: false,
        sessionKey: '',
        rootSessionId: opts.rootSessionId || '',
        projectKey: 'global',
        cabinetId: '',
        cabinetName: '🌐 系统全局档案柜（0 Token 冷封存 · 仅参谋与您可见）',
        cabinetFile: globalFile,
        registry: reg,
        projectEntry: {
          projectKey: 'global',
          activeCabinetId: '',
          cabinets: [],
        },
      }
    }

    // 3B. STRICT SESSION-ISOLATED WORKING CABINET (`sess:<rootSessionId>`):
    // Working cabinets are strictly 1-to-1 with ONE root conversation (never shared across sessions!).
    if (sessKey) {
      if (!reg.sessions[sessKey]) {
        const now = Date.now()
        const defaultCabId = sessionCabinetId(opts.rootSessionId)
        const cabFile = cabinetFilePath(defaultCabId, opts.customSharedBoardFile)
        if (!fs.existsSync(cabFile)) {
          const ownItems = claimSessionOwnLegacyItems(reg, projectKey, opts.rootSessionId, opts)
          atomicWriteJson(cabFile, normalizeArchiveStore({
            cabinetId: defaultCabId,
            cabinetName: '本对话工作档案柜',
            projectKey,
            items: ownItems,
          }))
        }
        reg.sessions[sessKey] = {
          sessionKey: sessKey,
          rootSessionId: opts.rootSessionId,
          projectKey,
          cwd: opts.cwd,
          activeCabinetId: defaultCabId,
          cabinets: [
            {
              id: defaultCabId,
              name: '本对话工作档案柜',
              projectKey,
              rootSessionId: opts.rootSessionId,
              cwd: opts.cwd,
              createdAt: now,
              updatedAt: now,
            },
          ],
        }
        dirty = true
      } else {
        if (opts.cwd && !reg.sessions[sessKey].cwd) {
          reg.sessions[sessKey].cwd = opts.cwd
          dirty = true
        }
        if (projectKey && reg.sessions[sessKey].projectKey !== projectKey && opts.cwd) {
          reg.sessions[sessKey].projectKey = projectKey
          dirty = true
        }
      }

      const sessEntry = reg.sessions[sessKey]
      let selectedCabinet = null
      // Strictly match ONLY within THIS session's own cabinets (never cross-mount cab-main/cab-global!)
      if (opts.cabinetId) {
        selectedCabinet = sessEntry.cabinets.find(c => c.id === opts.cabinetId) || null
      }
      if (!selectedCabinet) {
        selectedCabinet = sessEntry.cabinets.find(c => c.id === sessEntry.activeCabinetId) || sessEntry.cabinets[0]
      }
      const selectedFile = cabinetFilePath(selectedCabinet.id, opts.customSharedBoardFile)
      if (!fs.existsSync(selectedFile)) {
        atomicWriteJson(selectedFile, normalizeArchiveStore({
          cabinetId: selectedCabinet.id,
          cabinetName: selectedCabinet.name,
          projectKey,
        }))
      }
      if (dirty || !fs.existsSync(regFile)) {
        writeRegistryRaw(regFile, reg)
      }
      return {
        scope: 'session',
        vaultScope: 'session',
        unboundSession: false,
        sessionKey: sessKey,
        rootSessionId: opts.rootSessionId,
        projectKey: sessEntry.projectKey || projectKey,
        cabinetId: selectedCabinet.id,
        cabinetName: selectedCabinet.name,
        cabinetFile: selectedFile,
        registry: reg,
        projectEntry: sessEntry,
      }
    }

    // 3C. Unbound / blank new conversation: MUST NOT fall back to cab-main or cab-global!
    if (dirty || !fs.existsSync(regFile)) {
      writeRegistryRaw(regFile, reg)
    }
    return {
      scope: 'session',
      vaultScope: 'session',
      unboundSession: true,
      sessionKey: '',
      rootSessionId: '',
      projectKey,
      cabinetId: '',
      cabinetName: '本会话尚未开始（空白新对话）',
      cabinetFile: '',
      registry: reg,
      projectEntry: {
        projectKey,
        activeCabinetId: '',
        cabinets: [],
      },
    }
  } finally {
    release()
  }
}

export function archiveFilePath(targetOpt) {
  const resolved = ensureProjectCabinet(targetOpt)
  return resolved.cabinetFile || ''
}

export function listProjectCabinets(targetOpt) {
  const resolved = ensureProjectCabinet(targetOpt)
  const isGlobal = Boolean(resolved.isSystemGlobalVault || resolved.vaultScope === 'global')
  return {
    ok: true,
    scope: isGlobal ? 'global' : (resolved.scope || 'session'),
    vaultScope: isGlobal ? 'global' : (resolved.vaultScope || resolved.scope || 'session'),
    isSystemGlobalVault: isGlobal,
    unboundSession: isGlobal ? false : Boolean(resolved.unboundSession),
    rootSessionId: resolved.rootSessionId || '',
    projectKey: resolved.projectKey,
    activeCabinetId: isGlobal ? '' : (resolved.projectEntry ? resolved.projectEntry.activeCabinetId : ''),
    cabinets: isGlobal
      ? []
      : (resolved.projectEntry && Array.isArray(resolved.projectEntry.cabinets) ? resolved.projectEntry.cabinets : []).map(c => ({ ...c })),
  }
}

/* ------------------------------------------- Normalization */

export function mutateCabinetRegistry(payload = {}, targetOpt) {
  const op = str(payload.op, '').trim()
  const opts = resolveTargetOpts(targetOpt)
  const vaultScope = normalizeVaultScope(payload.vaultScope || payload.scope || opts.vaultScope)
  if (vaultScope === 'global') {
    if (op === 'listCabinets') {
      return {
        ok: true,
        scope: 'global',
        vaultScope: 'global',
        isSystemGlobalVault: true,
        projectKey: 'global',
        activeCabinetId: '',
        cabinets: [],
      }
    }
    return {
      ok: false,
      isSystemGlobalVault: true,
      error: '系统全局档案柜采用单一冷存储卷（与沉淀库同构），不支持多分柜创建、切换或删除',
    }
  }
  const rootSid = cleanRootSessionId(payload.rootSessionId || payload.session || opts.rootSessionId)
  const resolvedInit = ensureProjectCabinet({
    ...opts,
    cwd: str(payload.cwd, opts.cwd),
    projectKey: str(payload.projectKey, opts.projectKey),
    rootSessionId: rootSid,
    vaultScope,
  })
  const regFile = cabinetRegistryPath(opts.customSharedBoardFile)
  const projectKey = resolvedInit.projectKey
  const sessKey = normalizeSessionScopeKey(rootSid)

  if (op === 'listCabinets') {
    return listProjectCabinets({ ...opts, projectKey, rootSessionId: rootSid, vaultScope })
  }

  if (resolvedInit.unboundSession || !sessKey) {
    return {
      ok: false,
      unboundSession: true,
      error: '当前为空白新对话（尚未绑定会话 ID），请先在主会话发送一条消息，或切换到「🌐 全局档案柜」',
    }
  }

  const release = acquireFileLock(regFile)
  try {
    const reg = normalizeRegistry(readJsonSafe(regFile, null))
    if (!reg.sessions[sessKey]) reg.sessions[sessKey] = resolvedInit.projectEntry
    const container = reg.sessions[sessKey]
    const scopeMeta = { scope: 'session', vaultScope: 'session', rootSessionId: rootSid }

    if (op === 'createCabinet') {
      const name = clamp(payload.name || payload.label || `工作档案柜 ${container.cabinets.length + 1}`, 40)
      const dup = container.cabinets.find(c => c.name === name)
      if (dup) {
        container.activeCabinetId = dup.id
        writeRegistryRaw(regFile, reg)
        invalidateArchiveCache()
        return {
          ok: true,
          ...scopeMeta,
          cabinet: dup,
          activeCabinetId: container.activeCabinetId,
          cabinets: container.cabinets,
          projectKey,
        }
      }
      const id = nextId('cab')
      const now = Date.now()
      const cabMeta = {
        id,
        name,
        projectKey,
        ...(rootSid && sessKey ? { rootSessionId: rootSid } : {}),
        cwd: container.cwd || str(payload.cwd, opts.cwd),
        createdAt: now,
        updatedAt: now,
      }
      const cabFile = cabinetFilePath(id, opts.customSharedBoardFile)
      atomicWriteJson(cabFile, normalizeArchiveStore({
        cabinetId: id,
        cabinetName: name,
        projectKey,
      }))
      container.cabinets.push(cabMeta)
      container.activeCabinetId = id
      writeRegistryRaw(regFile, reg)
      invalidateArchiveCache()
      return {
        ok: true,
        ...scopeMeta,
        cabinet: cabMeta,
        activeCabinetId: container.activeCabinetId,
        cabinets: container.cabinets,
        projectKey,
      }
    }

    if (op === 'switchCabinet') {
      const targetId = str(payload.cabinetId || payload.id, '').trim()
      const hit = container.cabinets.find(c => c.id === targetId)
      if (!hit) return { ok: false, error: '当前范围下未找到目标档案柜：' + targetId }
      container.activeCabinetId = hit.id
      hit.updatedAt = Date.now()
      writeRegistryRaw(regFile, reg)
      invalidateArchiveCache()
      return {
        ok: true,
        ...scopeMeta,
        cabinet: hit,
        activeCabinetId: container.activeCabinetId,
        cabinets: container.cabinets,
        projectKey,
      }
    }

    if (op === 'renameCabinet') {
      const targetId = str(payload.cabinetId || payload.id, container.activeCabinetId).trim()
      const name = clamp(payload.name || payload.label, 40)
      if (!name) return { ok: false, error: '请输入档案柜新名称' }
      const hit = container.cabinets.find(c => c.id === targetId)
      if (!hit) return { ok: false, error: '未找到档案柜：' + targetId }
      hit.name = name
      hit.updatedAt = Date.now()
      writeRegistryRaw(regFile, reg)
      const cabFile = cabinetFilePath(hit.id, opts.customSharedBoardFile)
      const cabStore = normalizeArchiveStore(readJsonSafe(cabFile, { cabinetId: hit.id, projectKey }))
      cabStore.cabinetName = name
      atomicWriteJson(cabFile, cabStore)
      invalidateArchiveCache()
      return {
        ok: true,
        ...scopeMeta,
        cabinet: hit,
        activeCabinetId: container.activeCabinetId,
        cabinets: container.cabinets,
        projectKey,
      }
    }

    if (op === 'deleteCabinet') {
      const targetId = str(payload.cabinetId || payload.id, '').trim()
      if (container.cabinets.length <= 1) {
        return { ok: false, error: '每个范围至少需保留一个工作档案柜，不可删除最后一个档案柜' }
      }
      const idx = container.cabinets.findIndex(c => c.id === targetId)
      if (idx < 0) return { ok: false, error: '未找到要删除的档案柜：' + targetId }
      const [removed] = container.cabinets.splice(idx, 1)
      if (container.activeCabinetId === removed.id) {
        container.activeCabinetId = container.cabinets[0].id
      }
      writeRegistryRaw(regFile, reg)
      try {
        const rmFile = cabinetFilePath(removed.id, opts.customSharedBoardFile)
        if (fs.existsSync(rmFile)) fs.unlinkSync(rmFile)
      } catch {}
      invalidateArchiveCache()
      return {
        ok: true,
        ...scopeMeta,
        removedId: removed.id,
        activeCabinetId: container.activeCabinetId,
        cabinets: container.cabinets,
        projectKey,
      }
    }

    return { ok: false, error: '未知的档案柜操作：' + op }
  } finally {
    release()
  }
}

export function bootstrapArchivesFromSharedBoard({ sharedFile, loadBoard, saveBoard, pushLog }) {
  try {
    if (!sharedFile || !fs.existsSync(sharedFile)) return { migrated: 0 }
    // Ensure legacy `archives.json` & old board.notes migrate once into Global Cabinet (not into every blank chat!)
    const globalTarget = { customSharedBoardFile: sharedFile, vaultScope: 'global' }
    const resolved = ensureProjectCabinet(globalTarget)
    const storeTarget = { customSharedBoardFile: sharedFile, vaultScope: 'global', cabinetId: resolved.cabinetId }
    const existing = loadArchiveStore(storeTarget)
    if (existing.migratedSharedAt > 0 && existing.items.length > 0) {
      return { migrated: 0 }
    }

    const sharedBoard = loadBoard(sharedFile)
    const legacyNotes = Array.isArray(sharedBoard && sharedBoard.notes) ? sharedBoard.notes : []
    if (!legacyNotes.length) {
      if (!existing.migratedSharedAt) {
        withArchiveLock(storeTarget, () => {
          const empty = loadArchiveStore(storeTarget)
          empty.migratedSharedAt = Date.now()
          saveArchiveStore(empty, storeTarget)
        })
      }
      return { migrated: 0 }
    }

    const backupFile = path.join(path.dirname(sharedFile), 'board.pre-archive-backup.json')
    try {
      if (!fs.existsSync(backupFile)) {
        fs.copyFileSync(sharedFile, backupFile)
      }
    } catch {}

    let migratedCount = 0
    withArchiveLock(storeTarget, () => {
      const store = loadArchiveStore(storeTarget)
      const existingSourceIds = new Set(store.items.map(it => it.sourceNoteId).filter(Boolean))
      const existingTitles = new Set(store.items.map(it => it.title))

      for (const note of legacyNotes) {
        if (!note || (!note.title && !note.body)) continue
        if (SECRET_PATTERN.test(String(note.body || ''))) continue
        if ((note.id && existingSourceIds.has(note.id)) || (note.title && existingTitles.has(note.title))) {
          continue
        }
        const parsed = smartParseNoteToDossier(note)
        const item = normalizeArchiveItem({
          id: nextId('arch'),
          sourceNoteId: note.id || '',
          title: parsed.title,
          summary: parsed.summary,
          folder: parsed.folder,
          paperclip: parsed.paperclip,
          tags: note.tags || [],
          cold: true,
          takenOutSessions: [],
          organizedBy: 'auto',
          points: parsed.points,
          body: note.body || '',
          by: note.by || 'agent',
          sourceSession: note.session || '',
          createdAt: note.createdAt || note.updatedAt || Date.now(),
          updatedAt: note.updatedAt || Date.now(),
        })
        if (item) {
          store.items.push(item)
          migratedCount += 1
        }
      }

      store.migratedSharedAt = Date.now()
      saveArchiveStore(store, storeTarget)
    })

    if (migratedCount > 0 && typeof saveBoard === 'function') {
      sharedBoard.notes = []
      if (typeof pushLog === 'function') {
        pushLog(
          sharedBoard,
          `🗄️ 已将 ${migratedCount} 篇历史工程笔记无损沉淀入「全局档案柜」（默认封存懒加载，不再每轮挤占上下文）`,
          'system',
          '',
        )
      }
      saveBoard(sharedBoard, sharedFile)
    }

    return { migrated: migratedCount }
  } catch {
    return { migrated: 0 }
  }
}

/* ------------------------------------------- Lazy-Loading Query & Mutations */

/**
 * Loads the standalone System Global Cold Vault (`global-vault/vault-chief-global.json`).
 * Structurally peers with `precipitated/vault-global.json`: NEVER shares files with `cabinets/`,
 * NEVER auto-follows conversation context (0 Token unless explicitly mounted or Chief-searched).
 */
export function loadGlobalVaultRaw(targetOpt) {
  const file = globalChiefVaultFilePath(targetOpt)
  if (!fs.existsSync(file)) {
    return normalizeArchiveStore({
      isSystemGlobalVault: true,
      projectKey: 'global',
      updatedAt: 0,
      items: [],
    })
  }
  const parsed = readJsonSafe(file, null)
  return normalizeArchiveStore({
    ...(parsed && typeof parsed === 'object' ? parsed : {}),
    isSystemGlobalVault: true,
    projectKey: 'global',
  })
}

export function saveGlobalVaultRaw(store, targetOpt) {
  const file = globalChiefVaultFilePath(targetOpt)
  const normalized = normalizeArchiveStore({
    ...(store && typeof store === 'object' ? store : {}),
    isSystemGlobalVault: true,
    projectKey: 'global',
    updatedAt: Date.now(),
  })
  atomicWriteJson(file, normalized)
  return normalized
}

export function loadArchiveStore(targetOpt) {
  const resolved = ensureProjectCabinet(targetOpt)
  if (resolved.vaultScope === 'global') {
    return loadGlobalVaultRaw(targetOpt)
  }
  if (resolved.unboundSession || !resolved.cabinetFile) {
    return {
      ...normalizeArchiveStore({
        cabinetId: '',
        cabinetName: resolved.cabinetName || '本会话尚未开始（空白新对话）',
        projectKey: resolved.projectKey,
      }),
      unboundSession: true,
    }
  }
  const file = resolved.cabinetFile
  try {
    const st = fs.statSync(file)
    const cached = getCachedArchiveStore(file, st.mtimeMs)
    if (cached) return cached
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    const store = normalizeArchiveStore({
      ...parsed,
      cabinetId: resolved.cabinetId,
      cabinetName: resolved.cabinetName,
      projectKey: resolved.projectKey,
    })
    setCachedArchiveStore(file, st.mtimeMs, store)
    return store
  } catch {
    return normalizeArchiveStore({
      cabinetId: resolved.cabinetId,
      cabinetName: resolved.cabinetName,
      projectKey: resolved.projectKey,
    })
  }
}

export function saveArchiveStore(store, targetOpt) {
  const resolved = ensureProjectCabinet(targetOpt)
  if (resolved.vaultScope === 'global') {
    return saveGlobalVaultRaw(store, targetOpt)
  }
  if (resolved.unboundSession || !resolved.cabinetFile) {
    throw new Error('当前未绑定具体对话（空白新对话），不能写入本会话档案柜')
  }
  const file = resolved.cabinetFile
  const normalized = normalizeArchiveStore({
    ...store,
    cabinetId: resolved.cabinetId,
    cabinetName: resolved.cabinetName,
    projectKey: resolved.projectKey,
    updatedAt: Date.now(),
  })
  atomicWriteJson(file, normalized)
  let mtime = Date.now()
  try {
    mtime = fs.statSync(file).mtimeMs
  } catch {}
  setCachedArchiveStore(file, mtime, normalized)
  return normalized
}

export function withArchiveLock(targetOpt, fn) {
  const resolved = ensureProjectCabinet(targetOpt)
  if (resolved.vaultScope === 'global') {
    const file = globalChiefVaultFilePath(targetOpt)
    const release = acquireFileLock(file)
    invalidateArchiveCache()
    try {
      return fn(file, resolved)
    } finally {
      release()
    }
  }
  if (resolved.unboundSession || !resolved.cabinetFile) {
    return {
      ok: false,
      unboundSession: true,
      error: '当前为空白新对话（尚未绑定会话 ID），请先在主会话发送一条消息，或切换到「🌐 全局档案柜」',
    }
  }
  const file = resolved.cabinetFile
  const release = acquireFileLock(file)
  invalidateArchiveCache()
  try {
    return fn(file, resolved)
  } finally {
    release()
  }
}

/* ------------------------------------------- Smart Note -> Dossier Parser */
