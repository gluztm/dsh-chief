/**
 * Engineering Memory Filing Cabinet v2 (单工程多档案柜 + 跨会话沉淀冷库 · 物理零偷读)
 *
 * Storage Layout under `%DSH_HOME%/chief/` (or `path.dirname(customSharedBoardFile)`):
 * - `cabinets/registry.json`         : Project -> activeCabinetId & cabinets list
 * - `cabinets/<cabinetId>.json`      : Active working filing cabinet (folders + paperclipped dossiers)
 * - `archives.json`                  : Legacy v1 single cabinet (losslessly migrated to `cab-main` on first read)
 * - `precipitated/<projectKey>.json` : Cross-session reusable experience cold vault (ZERO auto-read!)
 *
 * Core Contracts:
 * 1. Multi-Cabinet per Project (`projectKey = resolveProjectKey(cwd)`):
 *    Allows creating, switching, renaming, and removing isolated filing cabinets per workspace project.
 * 2. Working Cabinet Cold Vault (`cold: true`, `takenOutSessions: []` by default):
 *    Never auto-injected into system prompts unless explicitly taken out onto the session desk (`takenOutSessions`)
 *    or queried via on-demand `searchArchives`.
 * 3. Precipitated Cross-Session Cold Vault (`precipitated/<projectKey>.json`):
 *    Stores purified cross-session reusable architecture rules, env coords, contracts, and troubleshooting laws.
 *    STRICTLY 0-TOKEN ISOLATED: `renderDigest`, `renderHandoff`, `runTurnReview`, `searchArchives`, and
 *    cross-session handoff copy NEVER read `precipitated/<projectKey>.json` unless a user explicitly triggers
 *    `flipOut` on a precipitated entry to inspect/co-organize it inside the current session!
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ARCHIVE_VERSION = 2
const ARCHIVE_CAP = 500
const POINTS_CAP = 32
const PRECIPITATED_CAP = 300
const SECRET_PATTERN = /(?:sk-[a-zA-Z0-9_-]{16,}|ghp_[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|Bearer\s+[A-Za-z0-9._~+/=-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/

export const DEFAULT_ARCHIVE_FOLDERS = [
  {
    id: 'coords',
    label: '工程坐标与部署锚点',
    hint: '源码路径、热更口令、端口、部署验证命令与核心坐标',
    accent: '#f59e0b',
    order: 10,
  },
  {
    id: 'incidents',
    label: '排障实录与硬事实',
    hint: '线上/本地故障症状、根因定位、踩坑教训与修复闭环',
    accent: '#ef4444',
    order: 20,
  },
  {
    id: 'contracts',
    label: '架构契约与方法论',
    hint: '接口契约、参数宽容、截断交代、自检断言与工程纪律',
    accent: '#0a84ff',
    order: 30,
  },
  {
    id: 'ops',
    label: '运维链路与机器环境',
    hint: '本机环境硬事实、服务器代理链路、容器与外部服务手册',
    accent: '#10b981',
    order: 40,
  },
  {
    id: 'plans',
    label: '阶段蓝图与归档计划',
    hint: '官方能力对照、阶段性历史计划存档与里程碑复盘',
    accent: '#8b5cf6',
    order: 50,
  },
  {
    id: 'inbox',
    label: '待分拣工作便签',
    hint: '新近沉淀或尚未归类的工程记录，可随时请参谋长整理收纳',
    accent: '#64748b',
    order: 60,
  },
]

const DEFAULT_FOLDER_MAP = new Map(DEFAULT_ARCHIVE_FOLDERS.map(f => [f.id, f]))

let seq = 0
function nextId(prefix) {
  seq = (seq + 1) % 1000000
  return prefix + '-' + Date.now().toString(36) + '-' + seq.toString(36)
}

function str(v, fb = '') {
  return typeof v === 'string' ? v : fb
}

function clamp(v, max) {
  const clean = String(v == null ? '' : v).replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  return clean.slice(0, Math.max(0, max - 1)) + '…'
}

function cleanMultiline(v, max) {
  const text = String(v == null ? '' : v).replace(/\r/g, '').trim()
  if (text.length <= max) return text
  return text.slice(0, Math.max(0, max - 1)) + '…'
}

/* ------------------------------------------- Paths, Project Key & Registry */

export function normalizeCwd(cwd) {
  const raw = str(cwd, '').trim()
  if (!raw) return ''
  try {
    let resolved = path.resolve(raw)
    if (resolved.length > 3) {
      resolved = resolved.replace(/[\\/]+$/, '')
    }
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
  } catch {
    return raw.replace(/[\\/]+$/, '').toLowerCase()
  }
}

export function resolveProjectKey(cwd = '') {
  const raw = str(cwd, '').trim()
  if (!raw) return 'proj-default'
  if (/^proj-[a-z0-9._-]+$/i.test(raw) && !raw.includes('\\') && !raw.includes('/')) {
    return raw.slice(0, 64)
  }
  const norm = normalizeCwd(raw)
  if (!norm) return 'proj-default'
  const baseRaw = path.basename(norm) || 'workspace'
  const safeBase = baseRaw
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 22) || 'ws'
  const hash8 = crypto.createHash('sha1').update(norm).digest('hex').slice(0, 8)
  return `proj-${safeBase}-${hash8}`
}

function chiefRootDir(targetOpt) {
  let sharedFile = ''
  if (typeof targetOpt === 'string') {
    sharedFile = targetOpt
  } else if (targetOpt && typeof targetOpt === 'object') {
    sharedFile = str(targetOpt.customSharedBoardFile || targetOpt.sharedFile, '').trim()
  }
  if (sharedFile) {
    return path.dirname(sharedFile)
  }
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'chief')
}

function normalizeVaultScope(raw) {
  const s = str(raw, '').trim().toLowerCase()
  if (s === 'global') return 'global'
  if (s === 'precipitated' || s === 'cold' || s === 'vault') return 'precipitated'
  return 'session'
}

function cleanRootSessionId(raw = '') {
  const s = str(raw, '').trim()
  return (!s || s === 'global') ? '' : s
}

function resolveTargetOpts(targetOpt) {
  if (!targetOpt || typeof targetOpt === 'string') {
    return {
      customSharedBoardFile: str(targetOpt, ''),
      cwd: '',
      projectKey: '',
      cabinetId: '',
      rootSessionId: '',
      vaultScope: 'session',
    }
  }
  return {
    customSharedBoardFile: str(targetOpt.customSharedBoardFile || targetOpt.sharedFile, ''),
    cwd: str(targetOpt.cwd, ''),
    projectKey: str(targetOpt.projectKey, ''),
    cabinetId: str(targetOpt.cabinetId, ''),
    rootSessionId: cleanRootSessionId(targetOpt.rootSessionId || targetOpt.sessionId || targetOpt.session),
    vaultScope: normalizeVaultScope(targetOpt.vaultScope || targetOpt.scope),
  }
}

function normalizeSessionScopeKey(rootSessionId = '') {
  const sid = cleanRootSessionId(rootSessionId)
  if (!sid) return ''
  return 'sess:' + sid.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 72)
}

function sessionCabinetId(rootSessionId = '') {
  const hash10 = crypto.createHash('sha1').update(String(rootSessionId || 'session')).digest('hex').slice(0, 10)
  return `cab-s-${hash10}`
}

function withRootScope(targetOpt, rootSessionId = '') {
  const sid = cleanRootSessionId(rootSessionId)
  if (!targetOpt || typeof targetOpt === 'string') {
    const base = { customSharedBoardFile: str(targetOpt, ''), vaultScope: 'session' }
    return sid ? { ...base, rootSessionId: sid } : base
  }
  const vaultScope = normalizeVaultScope(targetOpt.vaultScope || targetOpt.scope)
  if (vaultScope === 'global') {
    return { ...targetOpt, vaultScope: 'global' }
  }
  if (!sid) {
    return { ...targetOpt, vaultScope }
  }
  if (cleanRootSessionId(targetOpt.rootSessionId || targetOpt.sessionId || targetOpt.session)) {
    return { ...targetOpt, vaultScope }
  }
  return { ...targetOpt, rootSessionId: sid, vaultScope }
}

export function legacyArchiveFilePath(targetOpt) {
  return path.join(chiefRootDir(targetOpt), 'archives.json')
}

export function cabinetsDirPath(targetOpt) {
  return path.join(chiefRootDir(targetOpt), 'cabinets')
}

export function cabinetRegistryPath(targetOpt) {
  return path.join(cabinetsDirPath(targetOpt), 'registry.json')
}

export function cabinetFilePath(cabinetId = 'cab-main', targetOpt) {
  const safe = String(cabinetId || 'cab-main').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 72) || 'cab-main'
  return path.join(cabinetsDirPath(targetOpt), `${safe}.json`)
}

export function globalChiefVaultFilePath(targetOpt) {
  return path.join(chiefRootDir(targetOpt), 'global-vault', 'vault-chief-global.json')
}

export function globalPrecipitatedFilePath(targetOpt) {
  return path.join(chiefRootDir(targetOpt), 'precipitated', 'vault-global.json')
}

export function precipitatedFilePath(_projectKey = 'proj-default', targetOpt) {
  return globalPrecipitatedFilePath(targetOpt)
}

export function archiveFilePath(targetOpt) {
  const resolved = ensureProjectCabinet(targetOpt)
  return resolved.cabinetFile || ''
}

function normalizeArchiveTitleKey(title) {
  return String(title || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function computeEntryContentHash(raw) {
  const title = String((raw && raw.title) || '').trim()
  const summary = String((raw && raw.summary) || '').trim()
  const body = cleanMultiline((raw && (raw.body !== undefined ? raw.body : raw.rawBody)) || '', 30000)
  return crypto.createHash('sha1').update(`${title}\n${summary}\n${body}`).digest('hex').slice(0, 12)
}

/* ----------------------------------------------------------- Lock & Storage */

const heldArchiveLocks = new Set()
const lockSleeper = new Int32Array(new SharedArrayBuffer(4))

function sleepSync(ms) {
  try {
    Atomics.wait(lockSleeper, 0, 0, ms)
  } catch {}
}

function acquireFileLock(file) {
  if (heldArchiveLocks.has(file)) return () => {}
  const lock = file + '.lock'
  try {
    fs.mkdirSync(path.dirname(lock), { recursive: true })
  } catch {}
  const deadline = Date.now() + 3000
  for (;;) {
    try {
      const fd = fs.openSync(lock, 'wx')
      try {
        fs.writeSync(fd, String(process.pid))
      } catch {}
      fs.closeSync(fd)
      heldArchiveLocks.add(file)
      return () => {
        heldArchiveLocks.delete(file)
        try {
          fs.unlinkSync(lock)
        } catch {}
      }
    } catch (err) {
      if (!err || err.code !== 'EEXIST' || Date.now() >= deadline) {
        try {
          if (Date.now() >= deadline) fs.unlinkSync(lock)
        } catch {}
        heldArchiveLocks.add(file)
        return () => heldArchiveLocks.delete(file)
      }
      try {
        const st = fs.statSync(lock)
        if (Date.now() - st.mtimeMs > 10000) {
          fs.unlinkSync(lock)
          continue
        }
      } catch {}
      sleepSync(3)
    }
  }
}

let archiveCache = { file: '', mtime: -1, store: null }

export function invalidateArchiveCache() {
  archiveCache = { file: '', mtime: -1, store: null }
}

function atomicWriteJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.' + process.pid + '.' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6) + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

function readJsonSafe(file, fallback = null) {
  try {
    if (!fs.existsSync(file)) return fallback
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

/* ------------------------------------------- Registry & Legacy Migration */

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

function ensureProjectCabinet(targetOpt) {
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

function normalizeFolder(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = str(raw.id, '').trim().slice(0, 64)
  if (!id) return null
  const preset = DEFAULT_FOLDER_MAP.get(id)
  return {
    id,
    label: clamp(raw.label || (preset && preset.label) || id, 40),
    hint: clamp(raw.hint || (preset && preset.hint) || '', 100),
    accent: str(raw.accent || (preset && preset.accent) || '#0a84ff', '#0a84ff').slice(0, 24),
    order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : ((preset && preset.order) || (70 + index * 5)),
  }
}

function normalizePoint(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const title = clamp(raw.title || `要点 ${idx + 1}`, 90)
  const detail = cleanMultiline(raw.detail || raw.text || raw.body || '', 6000)
  if (!title && !detail) return null
  const cueSource = str(raw.cue || raw.summary, '').trim()
  const derivedCue = cueSource || firstMeaningfulSentence(detail)
  return {
    id: str(raw.id, '').trim() || ('pt-' + (idx + 1)),
    title: title || clamp(derivedCue || `记忆点 ${idx + 1}`, 60),
    cue: clamp(derivedCue, 110),
    detail: detail || title,
  }
}

function normalizeTags(list) {
  if (!Array.isArray(list)) return []
  const seen = new Set()
  const out = []
  for (const raw of list) {
    const t = String(raw || '').trim().slice(0, 36)
    if (!t) continue
    if (t.toLowerCase() === 'anchor') continue
    const low = t.toLowerCase()
    if (seen.has(low)) continue
    seen.add(low)
    out.push(t)
    if (out.length >= 10) break
  }
  return out
}

function normalizeArchiveItem(raw) {
  if (!raw || typeof raw !== 'object') return null
  const body = cleanMultiline(raw.body || '', 30000)
  const rawTitle = clamp(raw.title || '', 180)
  if (!rawTitle && !body) return null

  const parsedFallback = (!Array.isArray(raw.points) || !raw.points.length || !raw.folder || !raw.summary)
    ? smartParseNoteToDossier(raw)
    : null

  const title = rawTitle || (parsedFallback && parsedFallback.title) || '未命名工程卷宗'
  const folder = str(raw.folder, '').trim() || (parsedFallback && parsedFallback.folder) || 'inbox'
  const validClips = ['gold', 'silver', 'copper']
  const paperclip = validClips.includes(raw.paperclip)
    ? raw.paperclip
    : ((parsedFallback && parsedFallback.paperclip) || 'silver')

  const pointsRaw = Array.isArray(raw.points) && raw.points.length
    ? raw.points
    : ((parsedFallback && parsedFallback.points) || [])
  const points = pointsRaw.map((p, i) => normalizePoint(p, i)).filter(Boolean).slice(0, POINTS_CAP)

  const summary = clamp(
    raw.summary || (parsedFallback && parsedFallback.summary) || (points[0] && (points[0].cue || points[0].title)) || firstMeaningfulSentence(body) || title,
    140,
  )

  const takenOutSessions = Array.isArray(raw.takenOutSessions)
    ? [...new Set(raw.takenOutSessions.map(s => String(s || '').trim()).filter(Boolean))].slice(0, 32)
    : []
  const chiefMountedSessions = Array.isArray(raw.chiefMountedSessions)
    ? [...new Set(raw.chiefMountedSessions.map(s => String(s || '').trim()).filter(Boolean))].slice(0, 32)
    : []
  const contentHash = str(raw.contentHash, '').trim() || computeEntryContentHash({ title, summary, body })

  return {
    id: str(raw.id, '').trim() || nextId('arch'),
    sourceNoteId: str(raw.sourceNoteId, '').trim(),
    originId: str(raw.originId, '').trim(),
    originGlobalId: str(raw.originGlobalId, '').trim(),
    title,
    summary,
    folder,
    paperclip,
    tags: normalizeTags(Array.isArray(raw.tags) ? raw.tags : []),
    cold: raw.cold !== false,
    takenOutSessions,
    chiefMountedSessions,
    organizedBy: ['auto', 'chief', 'user'].includes(raw.organizedBy) ? raw.organizedBy : 'auto',
    points,
    body,
    contentHash,
    by: clamp(raw.by || 'agent', 40),
    sourceSession: str(raw.sourceSession || raw.session, '').trim(),
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Number(raw.createdAt) || Date.now(),
  }
}

function normalizeGlobalVaultEntry(raw) {
  const norm = normalizeArchiveItem({
    ...(raw || {}),
    id: str(raw && raw.id, '').trim() || nextId('glob'),
    cold: true,
  })
  if (!norm) return null
  return {
    ...norm,
    takenOutSessions: Array.isArray(norm.takenOutSessions) ? norm.takenOutSessions : [],
    cold: true,
    chiefMountedSessions: Array.isArray(norm.chiefMountedSessions) ? norm.chiefMountedSessions : [],
  }
}

function normalizeArchiveStore(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const folderMap = new Map()
  for (const def of DEFAULT_ARCHIVE_FOLDERS) {
    folderMap.set(def.id, { ...def })
  }
  if (Array.isArray(src.folders)) {
    src.folders.forEach((f, idx) => {
      const nf = normalizeFolder(f, idx)
      if (nf) folderMap.set(nf.id, nf)
    })
  }

  const normalizer = src.isSystemGlobalVault ? normalizeGlobalVaultEntry : normalizeArchiveItem
  const items = (Array.isArray(src.items) ? src.items : [])
    .map(normalizer)
    .filter(Boolean)
    .slice(0, ARCHIVE_CAP)

  let customIdx = 0
  for (const item of items) {
    if (item.folder && !folderMap.has(item.folder)) {
      customIdx += 1
      folderMap.set(item.folder, {
        id: item.folder,
        label: clamp(item.folder, 40),
        hint: '自定义工程档案抽屉',
        accent: ['#06b6d4', '#ec4899', '#eab308', '#14b8a6'][customIdx % 4],
        order: 55 + customIdx,
      })
    }
  }

  const folders = [...folderMap.values()].sort((a, b) => (a.order || 99) - (b.order || 99))

  return {
    version: ARCHIVE_VERSION,
    isSystemGlobalVault: Boolean(src.isSystemGlobalVault),
    cabinetId: src.isSystemGlobalVault ? '' : (str(src.cabinetId, 'cab-main').trim() || 'cab-main'),
    cabinetName: src.isSystemGlobalVault
      ? '🌐 系统全局档案柜'
      : clamp(src.cabinetName || '默认主档案柜', 40),
    projectKey: src.isSystemGlobalVault ? 'global' : resolveProjectKey(src.projectKey || 'proj-default'),
    migratedSharedAt: Number(src.migratedSharedAt) || 0,
    updatedAt: Number(src.updatedAt) || Date.now(),
    folders,
    items,
  }
}

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
    if (archiveCache.store && archiveCache.file === file && archiveCache.mtime === st.mtimeMs) {
      return archiveCache.store
    }
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    const store = normalizeArchiveStore({
      ...parsed,
      cabinetId: resolved.cabinetId,
      cabinetName: resolved.cabinetName,
      projectKey: resolved.projectKey,
    })
    archiveCache = { file, mtime: st.mtimeMs, store }
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
  archiveCache = { file, mtime, store: normalized }
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

function stripMarkdownDecorators(text) {
  return String(text || '')
    .replace(/^[#>*\-\d.)\s\u3000]+/, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim()
}

function firstMeaningfulSentence(text) {
  const lines = String(text || '')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !/^\|[-:\s|]+\|$/.test(l) && !/^```/.test(l))
  if (!lines.length) return ''
  const candidate = (/^#{1,4}\s+/.test(lines[0]) && lines[1]) ? lines[1] : lines[0]
  const clean = stripMarkdownDecorators(candidate)
  const firstClause = clean.split(/[。；！？\n]/)[0] || clean
  return clamp(firstClause, 115)
}

export function classifyNoteFolder(title, body, tags = []) {
  const tagText = (Array.isArray(tags) ? tags : []).join(' ').toLowerCase()
  const head = `${title || ''} ${tagText}`.toLowerCase()
  const full = `${head} ${String(body || '').slice(0, 500)}`.toLowerCase()

  if (/坐标|锚点|安装源|包体|目录结构|端口|热更|set_bundle|deployed/.test(head)) {
    return 'coords'
  }
  if (/运维|环境|机器|硬事实|astrbot|claudia|sing-box|docker|服务器|tunnel|代理链路/.test(head) || /环境|运维/.test(tagText)) {
    return 'ops'
  }
  if (/计划存档|蓝图|对照表|出图线|交接单三项|阶段|roadmap|archive|plan/.test(head)) {
    return 'plans'
  }
  if (/症状|事故|已修|黑屏|坏了|排障|根因|死胡同|绕行|≠|不等于|踩坑|报错|unauthorized|eperm/.test(head)) {
    return 'incidents'
  }
  if (/契约|方法论|自检|上限|截断|宽容|schema|继承规则|归属|注释|派生标题|具名|必须/.test(head) || /方法论|自检|设计/.test(tagText)) {
    return 'contracts'
  }
  if (/坐标|路径|d:\\|%dsh_home%/.test(full) && /验证|pass/.test(full)) {
    return 'coords'
  }
  if (/##\s*症状|##\s*根因|硬事实/.test(full)) {
    return 'incidents'
  }
  return 'contracts'
}

function inferPaperclip(raw, folder) {
  const tags = (Array.isArray(raw && raw.tags) ? raw.tags : []).map(t => String(t).toLowerCase())
  if (raw && (raw.pinned === true || tags.includes('anchor') || raw.paperclip === 'gold')) {
    return 'gold'
  }
  if (tags.includes('archive') || folder === 'plans') {
    return 'copper'
  }
  return 'silver'
}

export function extractStructuredPoints(title, rawBody) {
  const body = String(rawBody || '').replace(/\r/g, '').trim()
  if (!body) {
    return [
      {
        id: 'pt-1',
        title: '归档标题备忘',
        cue: '当前仅记录卷宗标题，尚未补充详细正文',
        detail: `卷宗《${title || '未命名'}》当前无附加正文，可通过「编辑」随时补充工程细节。`,
      },
    ]
  }

  const lines = body.split('\n')
  const headingIndices = []
  for (let i = 0; i < lines.length; i += 1) {
    if (/^#{2,3}\s+\S/.test(lines[i].trim())) {
      headingIndices.push(i)
    }
  }
  if (headingIndices.length >= 1) {
    const points = []
    const preLines = lines.slice(0, headingIndices[0]).filter(l => !/^#\s+/.test(l.trim()))
    const preText = preLines.join('\n').trim()
    if (preText.length >= 18) {
      points.push({
        id: `pt-${points.length + 1}`,
        title: '背景与总览',
        cue: firstMeaningfulSentence(preText),
        detail: preText,
      })
    }
    for (let hIdx = 0; hIdx < headingIndices.length; hIdx += 1) {
      const start = headingIndices[hIdx]
      const end = hIdx + 1 < headingIndices.length ? headingIndices[hIdx + 1] : lines.length
      const rawHeading = lines[start].trim().replace(/^#{2,3}\s+/, '').trim()
      const secBody = lines.slice(start + 1, end).join('\n').trim()
      if (!secBody && !rawHeading) continue
      points.push({
        id: `pt-${points.length + 1}`,
        title: clamp(stripMarkdownDecorators(rawHeading) || `要点 ${points.length + 1}`, 76),
        cue: firstMeaningfulSentence(secBody) || clamp(rawHeading, 90),
        detail: secBody || rawHeading,
      })
    }
    if (points.length >= 1) return points.slice(0, POINTS_CAP)
  }

  const kvBlocks = []
  let currentKv = null
  for (const rawLine of lines) {
    const trimmed = rawLine.trim()
    if (!trimmed) continue
    const kvMatch = /^([^\s:：|]{2,18}(?:[（(][^）)]{1,18}[）)])?)\s*[：:]\s*(.*)$/.exec(trimmed)
    const numMatch = /^(\d+)\.\s+(?:\[[xX\s]\]\s*)?(.+)$/.exec(trimmed)
    if (kvMatch) {
      if (currentKv) kvBlocks.push(currentKv)
      const rest = kvMatch[2].trim()
      currentKv = {
        title: stripMarkdownDecorators(kvMatch[1]),
        lines: rest ? [rest] : [],
      }
    } else if (numMatch && !currentKv) {
      kvBlocks.push({
        title: clamp(stripMarkdownDecorators(numMatch[2]), 54),
        lines: [trimmed],
      })
    } else if (currentKv) {
      currentKv.lines.push(trimmed)
    } else {
      currentKv = {
        title: clamp(firstMeaningfulSentence(trimmed), 46) || '背景说明',
        lines: [trimmed],
      }
    }
  }
  if (currentKv) kvBlocks.push(currentKv)
  if (kvBlocks.length >= 2) {
    return kvBlocks.slice(0, POINTS_CAP).map((b, i) => {
      const detail = b.lines.join('\n').trim() || b.title
      return {
        id: `pt-${i + 1}`,
        title: clamp(b.title || `要点 ${i + 1}`, 72),
        cue: firstMeaningfulSentence(detail),
        detail,
      }
    })
  }

  const paragraphs = body
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(p => p && !/^#\s+/.test(p))

  if (paragraphs.length >= 2) {
    return paragraphs.slice(0, POINTS_CAP).map((para, idx) => {
      const first = firstMeaningfulSentence(para)
      return {
        id: `pt-${idx + 1}`,
        title: clamp(first || `记忆点 ${idx + 1}`, 56),
        cue: clamp(para.replace(/\s+/g, ' '), 105),
        detail: para,
      }
    })
  }

  const sentences = body
    .split(/(?<=[。！？；])\s*/)
    .map(s => s.trim())
    .filter(Boolean)

  if (sentences.length >= 2 && body.length > 95) {
    const labels = ['核心问题与诱因', '关键判据与机制', '落地规范与避坑', '补充细节']
    const grouped = []
    const chunkSize = sentences.length >= 5 ? 2 : 1
    for (let i = 0; i < sentences.length; i += chunkSize) {
      const slice = sentences.slice(i, i + chunkSize).join('')
      const labelIdx = Math.min(grouped.length, labels.length - 1)
      grouped.push({
        id: `pt-${grouped.length + 1}`,
        title: `${labels[labelIdx]}：${clamp(stripMarkdownDecorators(sentences[i]), 36)}`,
        cue: clamp(stripMarkdownDecorators(slice), 100),
        detail: slice,
      })
    }
    return grouped.slice(0, POINTS_CAP)
  }

  return [
    {
      id: 'pt-1',
      title: clamp(title || firstMeaningfulSentence(body) || '核心记忆点', 64),
      cue: firstMeaningfulSentence(body),
      detail: body,
    },
  ]
}

export function smartParseNoteToDossier(rawNote) {
  const note = rawNote && typeof rawNote === 'object' ? rawNote : {}
  const body = cleanMultiline(note.body || '', 30000)
  const derivedTitle = clamp(
    note.title || firstMeaningfulSentence(body) || '未命名工程卷宗',
    180,
  )
  const folder = str(note.folder, '').trim() || classifyNoteFolder(derivedTitle, body, note.tags)
  const paperclip = inferPaperclip(note, folder)
  const points = extractStructuredPoints(derivedTitle, body)
  const summary = clamp(
    note.summary || (points[0] && points[0].cue) || firstMeaningfulSentence(body) || derivedTitle,
    135,
  )
  return {
    title: derivedTitle,
    summary,
    folder,
    paperclip,
    points,
  }
}

/* ------------------------------------ Non-Destructive Bootstrap Migration */

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

function hasAnyPrecipitatedFilesOnDisk(targetOpt) {
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
      takenOut: Boolean(sid && Array.isArray(it.takenOutSessions) && it.takenOutSessions.includes(sid)),
      chiefMounted: Boolean(isGlobalReq && sid && Array.isArray(it.chiefMountedSessions) && it.chiefMountedSessions.includes(sid)),
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
  const counts = (opts && opts.includeCounts !== false)
    ? getThreeTierArchiveCounts(sid, (opts && opts.flippedIds) || [], baseTarget)
    : undefined

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
    takenOutCount: sid
      ? store.items.filter(it => Array.isArray(it.takenOutSessions) && it.takenOutSessions.includes(sid)).length
      : 0,
    diffSummary: diff.summary,
    folders,
    items: headers,
    ...(precipitated !== undefined ? { precipitated } : {}),
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
  return store.items.filter(it => Array.isArray(it.takenOutSessions) && it.takenOutSessions.includes(sid))
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

/* ------------------------------------------- Cabinet & Archive Mutations */

function mutateCabinetRegistry(payload = {}, targetOpt) {
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
          existing.organizedBy = payload.organizedBy || 'user'
        } else if (bodyChanged) {
          existing.points = extractStructuredPoints(existing.title, existing.body)
        }
        if (typeof payload.summary === 'string' && payload.summary.trim()) {
          existing.summary = clamp(payload.summary, 140)
        } else if (bodyChanged) {
          existing.summary = clamp(
            (existing.points[0] && existing.points[0].cue) || firstMeaningfulSentence(existing.body) || existing.title,
            140,
          )
        }
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

    if (op === 'takeOut' || op === 'putBack') {
      const id = str(payload.archiveId || payload.id, '').trim()
      if (!rootSessionId) return { ok: false, error: '当前未绑定对话会话，无法摆到桌面备选' }
      const item = store.items.find(it => it.id === id)
      if (!item) return { ok: false, error: '未找到该工程档案：' + id }
      const set = new Set(item.takenOutSessions || [])
      if (op === 'takeOut') set.add(rootSessionId)
      else set.delete(rootSessionId)
      item.takenOutSessions = [...set]
      saveArchiveStore(store, lockTarget)
      return {
        ok: true,
        id: item.id,
        title: item.title,
        takenOut: op === 'takeOut',
        isSystemGlobalVault: resolved.vaultScope === 'global',
        counts: getThreeTierArchiveCounts(rootSessionId, [], lockTarget),
        meta: getArchiveMeta(rootSessionId, lockTarget),
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
      target.organizedBy = 'chief'
      target.updatedAt = Date.now()
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

function loadPrecipitatedStoreRaw(_projectKey = 'proj-default', targetOpt) {
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

  const saveRes = mutateArchive({
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
