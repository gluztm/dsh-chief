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

function resolveTargetOpts(targetOpt) {
  if (!targetOpt || typeof targetOpt === 'string') {
    return {
      customSharedBoardFile: str(targetOpt, ''),
      cwd: '',
      projectKey: '',
      cabinetId: '',
    }
  }
  return {
    customSharedBoardFile: str(targetOpt.customSharedBoardFile || targetOpt.sharedFile, ''),
    cwd: str(targetOpt.cwd, ''),
    projectKey: str(targetOpt.projectKey, ''),
    cabinetId: str(targetOpt.cabinetId, ''),
  }
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

export function precipitatedFilePath(projectKey = 'proj-default', targetOpt) {
  const safe = resolveProjectKey(projectKey || 'proj-default').replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]+/g, '-').slice(0, 72) || 'proj-default'
  return path.join(chiefRootDir(targetOpt), 'precipitated', `${safe}.json`)
}

export function archiveFilePath(targetOpt) {
  const resolved = ensureProjectCabinet(targetOpt)
  return resolved.cabinetFile
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
  return {
    version: ARCHIVE_VERSION,
    migratedLegacy: Boolean(src.migratedLegacy),
    migratedAt: Number(src.migratedAt) || 0,
    legacyOwnerProjectKey: str(src.legacyOwnerProjectKey, ''),
    projects,
  }
}

function writeRegistryRaw(regFile, registry) {
  atomicWriteJson(regFile, normalizeRegistry(registry))
}

function ensureProjectCabinet(targetOpt) {
  const opts = resolveTargetOpts(targetOpt)
  const regFile = cabinetRegistryPath(opts.customSharedBoardFile)
  const legacyFile = legacyArchiveFilePath(opts.customSharedBoardFile)
  const projectKey = opts.projectKey ? resolveProjectKey(opts.projectKey) : resolveProjectKey(opts.cwd)

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

    // 2. Ensure requested projectKey exists in registry
    if (!reg.projects[projectKey]) {
      const now = Date.now()
      const hasMainAlready = Object.values(reg.projects).some(p => p.cabinets.some(c => c.id === 'cab-main'))
      const defaultCabId = hasMainAlready ? `cab-${projectKey.slice(-8)}-main` : 'cab-main'
      const labelPrefix = opts.cwd ? (path.basename(normalizeCwd(opts.cwd)) || '当前工程') : '默认'
      const cabFile = cabinetFilePath(defaultCabId, opts.customSharedBoardFile)
      if (!fs.existsSync(cabFile)) {
        atomicWriteJson(cabFile, normalizeArchiveStore({
          cabinetId: defaultCabId,
          cabinetName: `${labelPrefix} · 主档案柜`,
          projectKey,
        }))
      }
      reg.projects[projectKey] = {
        projectKey,
        cwd: opts.cwd,
        activeCabinetId: defaultCabId,
        cabinets: [
          {
            id: defaultCabId,
            name: `${labelPrefix} · 主档案柜`,
            projectKey,
            cwd: opts.cwd,
            createdAt: now,
            updatedAt: now,
          },
        ],
      }
      dirty = true
    } else if (opts.cwd && !reg.projects[projectKey].cwd) {
      reg.projects[projectKey].cwd = opts.cwd
      dirty = true
    }

    const projEntry = reg.projects[projectKey]
    let selectedCabinet = null
    if (opts.cabinetId) {
      selectedCabinet = projEntry.cabinets.find(c => c.id === opts.cabinetId) || null
      if (!selectedCabinet) {
        // Also check across projects if an explicit cabinetId was passed
        for (const p of Object.values(reg.projects)) {
          const hit = p.cabinets.find(c => c.id === opts.cabinetId)
          if (hit) {
            selectedCabinet = hit
            break
          }
        }
      }
    }
    if (!selectedCabinet) {
      selectedCabinet = projEntry.cabinets.find(c => c.id === projEntry.activeCabinetId) || projEntry.cabinets[0]
    }

    const selectedFile = cabinetFilePath(selectedCabinet.id, opts.customSharedBoardFile)
    if (!fs.existsSync(selectedFile)) {
      atomicWriteJson(selectedFile, normalizeArchiveStore({
        cabinetId: selectedCabinet.id,
        cabinetName: selectedCabinet.name,
        projectKey: selectedCabinet.projectKey,
      }))
    }

    if (dirty || !fs.existsSync(regFile)) {
      writeRegistryRaw(regFile, reg)
    }

    return {
      projectKey,
      cabinetId: selectedCabinet.id,
      cabinetName: selectedCabinet.name,
      cabinetFile: selectedFile,
      registry: reg,
      projectEntry: projEntry,
    }
  } finally {
    release()
  }
}

export function listProjectCabinets(targetOpt) {
  const resolved = ensureProjectCabinet(targetOpt)
  return {
    ok: true,
    projectKey: resolved.projectKey,
    activeCabinetId: resolved.projectEntry.activeCabinetId,
    cabinets: resolved.projectEntry.cabinets.map(c => ({ ...c })),
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

  return {
    id: str(raw.id, '').trim() || nextId('arch'),
    sourceNoteId: str(raw.sourceNoteId, '').trim(),
    title,
    summary,
    folder,
    paperclip,
    tags: normalizeTags(Array.isArray(raw.tags) ? raw.tags : []),
    cold: raw.cold !== false,
    takenOutSessions,
    organizedBy: ['auto', 'chief', 'user'].includes(raw.organizedBy) ? raw.organizedBy : 'auto',
    points,
    body,
    by: clamp(raw.by || 'agent', 40),
    sourceSession: str(raw.sourceSession || raw.session, '').trim(),
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Number(raw.createdAt) || Date.now(),
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

  const items = (Array.isArray(src.items) ? src.items : [])
    .map(normalizeArchiveItem)
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
    cabinetId: str(src.cabinetId, 'cab-main').trim() || 'cab-main',
    cabinetName: clamp(src.cabinetName || '默认主档案柜', 40),
    projectKey: resolveProjectKey(src.projectKey || 'proj-default'),
    migratedSharedAt: Number(src.migratedSharedAt) || 0,
    updatedAt: Number(src.updatedAt) || Date.now(),
    folders,
    items,
  }
}

export function loadArchiveStore(targetOpt) {
  const resolved = ensureProjectCabinet(targetOpt)
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
    // Ensure legacy `archives.json` is migrated to `cabinets/cab-main.json` first
    const resolved = ensureProjectCabinet({ customSharedBoardFile: sharedFile })
    const existing = loadArchiveStore({ customSharedBoardFile: sharedFile, cabinetId: resolved.cabinetId })
    if (existing.migratedSharedAt > 0 && existing.items.length > 0) {
      return { migrated: 0 }
    }

    const sharedBoard = loadBoard(sharedFile)
    const legacyNotes = Array.isArray(sharedBoard && sharedBoard.notes) ? sharedBoard.notes : []
    if (!legacyNotes.length) {
      if (!existing.migratedSharedAt) {
        withArchiveLock({ customSharedBoardFile: sharedFile, cabinetId: resolved.cabinetId }, () => {
          const empty = loadArchiveStore({ customSharedBoardFile: sharedFile, cabinetId: resolved.cabinetId })
          empty.migratedSharedAt = Date.now()
          saveArchiveStore(empty, { customSharedBoardFile: sharedFile, cabinetId: resolved.cabinetId })
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
    withArchiveLock({ customSharedBoardFile: sharedFile, cabinetId: resolved.cabinetId }, () => {
      const store = loadArchiveStore({ customSharedBoardFile: sharedFile, cabinetId: resolved.cabinetId })
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
      saveArchiveStore(store, { customSharedBoardFile: sharedFile, cabinetId: resolved.cabinetId })
    })

    if (migratedCount > 0 && typeof saveBoard === 'function') {
      sharedBoard.notes = []
      if (typeof pushLog === 'function') {
        pushLog(
          sharedBoard,
          `🗄️ 已将 ${migratedCount} 篇历史工程笔记无损沉淀入「档案」柜（默认封存懒加载，不再每轮挤占上下文）`,
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

/** Ultra-lightweight metadata (<120 bytes) for `/snapshot` polling — ZERO archive text or precipitated reads! */
export function getArchiveMeta(rootSessionId = '', targetOpt) {
  const cabInfo = listProjectCabinets(targetOpt)
  const store = loadArchiveStore(targetOpt)
  const sid = String(rootSessionId || '').trim()
  const nonEmptyFolders = new Set(store.items.map(it => it.folder).filter(Boolean))
  const takenOutCount = sid
    ? store.items.filter(it => Array.isArray(it.takenOutSessions) && it.takenOutSessions.includes(sid)).length
    : 0
  return {
    totalCount: store.items.length,
    folderCount: nonEmptyFolders.size || DEFAULT_ARCHIVE_FOLDERS.length,
    takenOutCount,
    unorganizedCount: store.items.filter(it => it.folder === 'inbox' || it.organizedBy === 'auto').length,
    projectKey: cabInfo.projectKey,
    activeCabinetId: cabInfo.activeCabinetId,
    cabinetCount: cabInfo.cabinets.length,
  }
}

/**
 * Tier-1 Lazy Load (`GET /api/dsh-chief/archives`):
 * Returns active cabinet drawers + dossier headers + project cabinets list
 * (+ precipitated vault headers ONLY for the Archives tab UI when caller asks for them).
 */
export function listArchiveHeaders(rootSessionId = '', opts = {}, targetOpt) {
  const target = targetOpt !== undefined
    ? (typeof targetOpt === 'string'
      ? { customSharedBoardFile: targetOpt, cwd: opts && opts.cwd, projectKey: opts && opts.projectKey, cabinetId: opts && opts.cabinetId }
      : { ...opts, ...targetOpt })
    : opts
  const cabInfo = listProjectCabinets(target)
  const store = loadArchiveStore(target)
  const sid = String(rootSessionId || '').trim()
  const needle = String((opts && opts.query) || '').trim().toLowerCase()
  const folderFilter = String((opts && opts.folder) || '').trim()
  const clipFilter = String((opts && opts.paperclip) || '').trim()

  const clipRank = { gold: 0, silver: 1, copper: 2 }
  const sorted = store.items.slice().sort((a, b) => {
    const aOut = sid && a.takenOutSessions.includes(sid) ? 0 : 1
    const bOut = sid && b.takenOutSessions.includes(sid) ? 0 : 1
    if (aOut !== bOut) return aOut - bOut
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

  const headers = filtered.map(it => ({
    id: it.id,
    title: it.title,
    summary: it.summary,
    folder: it.folder,
    paperclip: it.paperclip,
    tags: it.tags,
    cold: it.cold,
    takenOut: Boolean(sid && it.takenOutSessions.includes(sid)),
    organizedBy: it.organizedBy,
    pointCount: Array.isArray(it.points) ? it.points.length : 0,
    pointPreviews: (Array.isArray(it.points) ? it.points : []).slice(0, 4).map(p => p.title),
    bodyLength: (it.body || '').length,
    updatedAt: it.updatedAt,
    createdAt: it.createdAt,
  }))

  const includePrecipitated = Boolean(opts && opts.includePrecipitated)
  const precipitated = includePrecipitated
    ? listPrecipitatedHeaders(cabInfo.projectKey, sid, target)
    : undefined

  return {
    ok: true,
    projectKey: cabInfo.projectKey,
    activeCabinetId: cabInfo.activeCabinetId,
    cabinets: cabInfo.cabinets,
    totalCount: store.items.length,
    takenOutCount: sid ? store.items.filter(it => it.takenOutSessions.includes(sid)).length : 0,
    folders,
    items: headers,
    ...(precipitated !== undefined ? { precipitated } : {}),
  }
}

export function getArchiveDetail(idOrTitle = '', rootSessionId = '', targetOpt) {
  const target = String(idOrTitle || '').trim()
  if (!target) return { ok: false, error: 'archive id or title required' }
  const store = loadArchiveStore(targetOpt)
  const sid = String(rootSessionId || '').trim()
  const hit = store.items.find(it => it.id === target)
    || store.items.find(it => it.title === target)
    || store.items.find(it => it.title.toLowerCase().includes(target.toLowerCase()))
  if (!hit) return { ok: false, error: '未找到工程档案：' + target }

  return {
    ok: true,
    item: {
      id: hit.id,
      title: hit.title,
      summary: hit.summary,
      folder: hit.folder,
      paperclip: hit.paperclip,
      tags: hit.tags,
      cold: hit.cold,
      takenOut: Boolean(sid && hit.takenOutSessions.includes(sid)),
      organizedBy: hit.organizedBy,
      points: hit.points,
      body: hit.body,
      by: hit.by,
      createdAt: hit.createdAt,
      updatedAt: hit.updatedAt,
    },
  }
}

/**
 * Strictly returns ONLY dossiers explicitly taken out onto the current session desk.
 * NEVER reads `precipitated/<projectKey>.json`!
 */
export function getTakenOutArchivesForSession(rootSessionId = '', targetOpt) {
  const sid = String(rootSessionId || '').trim()
  if (!sid) return []
  const store = loadArchiveStore(targetOpt)
  return store.items.filter(it => Array.isArray(it.takenOutSessions) && it.takenOutSessions.includes(sid))
}

/** On-demand search for `chief_board({ action: "archive.search" })` or Chief explicit lookup.
 * Strictly searches ONLY working cabinets — NEVER reads `precipitated/<projectKey>.json`! */
export function searchArchives(query = '', opts = {}, targetOpt) {
  const effectiveTarget = targetOpt !== undefined
    ? targetOpt
    : (opts && (opts.cwd || opts.projectKey || opts.cabinetId || opts.customSharedBoardFile) ? opts : undefined)
  const store = loadArchiveStore(effectiveTarget)
  const folder = String((opts && opts.folder) || '').trim()
  const limit = Math.max(1, Math.min(Number(opts && opts.limit) || 8, 25))
  const rawQ = String(query || '').trim().toLowerCase()
  const terms = rawQ
    .replace(/[？?！!。，,、：:“”"'()（）[\]【】]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

  const scored = []
  for (const it of store.items) {
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
  const folderLabelMap = new Map(store.folders.map(f => [f.id, f.label]))

  return {
    ok: true,
    totalArchives: store.items.length,
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

/* ------------------------------------------- Cabinet & Archive Mutations */

function mutateCabinetRegistry(payload = {}, targetOpt) {
  const op = str(payload.op, '').trim()
  const opts = resolveTargetOpts(targetOpt)
  const resolvedInit = ensureProjectCabinet({
    ...opts,
    cwd: str(payload.cwd, opts.cwd),
    projectKey: str(payload.projectKey, opts.projectKey),
  })
  const regFile = cabinetRegistryPath(opts.customSharedBoardFile)
  const projectKey = resolvedInit.projectKey

  if (op === 'listCabinets') {
    return listProjectCabinets({ ...opts, projectKey })
  }

  const release = acquireFileLock(regFile)
  try {
    const reg = normalizeRegistry(readJsonSafe(regFile, null))
    const proj = reg.projects[projectKey] || resolvedInit.projectEntry
    reg.projects[projectKey] = proj

    if (op === 'createCabinet') {
      const name = clamp(payload.name || payload.label || `工作档案柜 ${proj.cabinets.length + 1}`, 40)
      const dup = proj.cabinets.find(c => c.name === name)
      if (dup) {
        proj.activeCabinetId = dup.id
        writeRegistryRaw(regFile, reg)
        invalidateArchiveCache()
        return {
          ok: true,
          cabinet: dup,
          activeCabinetId: proj.activeCabinetId,
          cabinets: proj.cabinets,
          projectKey,
        }
      }
      const id = nextId('cab')
      const now = Date.now()
      const cabMeta = {
        id,
        name,
        projectKey,
        cwd: proj.cwd || str(payload.cwd, opts.cwd),
        createdAt: now,
        updatedAt: now,
      }
      const cabFile = cabinetFilePath(id, opts.customSharedBoardFile)
      atomicWriteJson(cabFile, normalizeArchiveStore({
        cabinetId: id,
        cabinetName: name,
        projectKey,
      }))
      proj.cabinets.push(cabMeta)
      proj.activeCabinetId = id
      writeRegistryRaw(regFile, reg)
      invalidateArchiveCache()
      return {
        ok: true,
        cabinet: cabMeta,
        activeCabinetId: proj.activeCabinetId,
        cabinets: proj.cabinets,
        projectKey,
      }
    }

    if (op === 'switchCabinet') {
      const targetId = str(payload.cabinetId || payload.id, '').trim()
      const hit = proj.cabinets.find(c => c.id === targetId)
      if (!hit) return { ok: false, error: '未找到目标档案柜：' + targetId }
      proj.activeCabinetId = hit.id
      hit.updatedAt = Date.now()
      writeRegistryRaw(regFile, reg)
      invalidateArchiveCache()
      return {
        ok: true,
        cabinet: hit,
        activeCabinetId: proj.activeCabinetId,
        cabinets: proj.cabinets,
        projectKey,
      }
    }

    if (op === 'renameCabinet') {
      const targetId = str(payload.cabinetId || payload.id, proj.activeCabinetId).trim()
      const name = clamp(payload.name || payload.label, 40)
      if (!name) return { ok: false, error: '请输入档案柜新名称' }
      const hit = proj.cabinets.find(c => c.id === targetId)
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
        cabinet: hit,
        activeCabinetId: proj.activeCabinetId,
        cabinets: proj.cabinets,
        projectKey,
      }
    }

    if (op === 'deleteCabinet') {
      const targetId = str(payload.cabinetId || payload.id, '').trim()
      if (proj.cabinets.length <= 1) {
        return { ok: false, error: '每个工程至少需保留一个主档案柜，不可删除最后一个档案柜' }
      }
      const idx = proj.cabinets.findIndex(c => c.id === targetId)
      if (idx < 0) return { ok: false, error: '未找到要删除的档案柜：' + targetId }
      const [removed] = proj.cabinets.splice(idx, 1)
      if (proj.activeCabinetId === removed.id) {
        proj.activeCabinetId = proj.cabinets[0].id
      }
      writeRegistryRaw(regFile, reg)
      try {
        const rmFile = cabinetFilePath(removed.id, opts.customSharedBoardFile)
        if (fs.existsSync(rmFile)) fs.unlinkSync(rmFile)
      } catch {}
      invalidateArchiveCache()
      return {
        ok: true,
        removedId: removed.id,
        activeCabinetId: proj.activeCabinetId,
        cabinets: proj.cabinets,
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
  const rootSessionId = str(payload.rootSessionId || payload.session, '').trim()
  const baseOpts = resolveTargetOpts(targetOpt)
  const effectiveTarget = {
    ...baseOpts,
    cwd: str(payload.cwd, baseOpts.cwd),
    projectKey: str(payload.projectKey, baseOpts.projectKey),
    cabinetId: str(payload.cabinetId, baseOpts.cabinetId),
  }

  if (['listCabinets', 'createCabinet', 'switchCabinet', 'renameCabinet', 'deleteCabinet'].includes(op)) {
    return mutateCabinetRegistry(payload, effectiveTarget)
  }

  return withArchiveLock(effectiveTarget, (_file, resolved) => {
    const store = loadArchiveStore({ ...effectiveTarget, cabinetId: resolved.cabinetId })
    const lockTarget = { ...effectiveTarget, cabinetId: resolved.cabinetId, projectKey: resolved.projectKey }
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
        existing.updatedAt = Date.now()
        saveArchiveStore(store, lockTarget)
        return { ok: true, item: existing, meta: getArchiveMeta(rootSessionId, lockTarget) }
      }

      const rawTitle = clamp(payload.title || '', 180)
      if (!rawTitle && !nextBody) {
        return { ok: false, error: '新建工程档案需要填写标题或正文内容' }
      }
      const sameTitle = rawTitle ? store.items.find(it => it.title === rawTitle) : null
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
        sameTitle.updatedAt = Date.now()
        saveArchiveStore(store, lockTarget)
        return { ok: true, item: sameTitle, updatedExisting: true, meta: getArchiveMeta(rootSessionId, lockTarget) }
      }

      const parsed = smartParseNoteToDossier({
        title: rawTitle,
        body: nextBody,
        folder: payload.folder,
        paperclip: payload.paperclip,
        tags: Array.isArray(payload.tags) ? payload.tags : (typeof payload.tags === 'string' ? payload.tags.split(/[,，]/) : []),
      })
      const created = normalizeArchiveItem({
        id: nextId('arch'),
        sourceNoteId: str(payload.sourceNoteId, ''),
        title: parsed.title,
        summary: payload.summary || parsed.summary,
        folder: payload.folder || parsed.folder,
        paperclip: payload.paperclip || parsed.paperclip,
        tags: Array.isArray(payload.tags) ? payload.tags : (typeof payload.tags === 'string' ? payload.tags.split(/[,，]/) : []),
        cold: true,
        takenOutSessions: (payload.takeOutNow || payload.takeOut) && rootSessionId ? [rootSessionId] : [],
        organizedBy: ['auto', 'chief', 'user'].includes(payload.organizedBy)
          ? payload.organizedBy
          : (Array.isArray(payload.points) && payload.points.length ? 'user' : 'auto'),
        points: Array.isArray(payload.points) && payload.points.length ? payload.points : parsed.points,
        body: nextBody,
        by: payload.by || 'user',
        sourceSession: rootSessionId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      store.items.unshift(created)
      saveArchiveStore(store, lockTarget)
      return { ok: true, item: created, meta: getArchiveMeta(rootSessionId, lockTarget) }
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

    if (op === 'takeOut' || op === 'putBack') {
      const id = str(payload.archiveId || payload.id, '').trim()
      if (!rootSessionId) return { ok: false, error: '当前未绑定对话会话，无法取出挂到桌面' }
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

      return { ok: false, error: '未知的档案操作：' + op }
    }
    const opRes = runOp()
    return (opRes && opRes.ok && !opRes.cabinetId)
      ? { cabinetId: resolved.cabinetId, ...opRes }
      : opRes
  })
}

export function applyChiefArchiveCurations(curations = [], newFolders = [], targetOpt) {
  if (!Array.isArray(curations) || !curations.length) return { updatedCount: 0 }
  return withArchiveLock(targetOpt, (_file, resolved) => {
    const base = resolveTargetOpts(targetOpt)
    const lockTarget = { ...base, cabinetId: resolved.cabinetId, projectKey: resolved.projectKey }
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
  if (mode === 'none' || !toSid) {
    return { ok: true, policy: mode, transferredCount: 0, mountedCount: 0 }
  }

  const srcTarget = {
    customSharedBoardFile,
    cwd: fromCwd,
    cabinetId: fromCabinetId,
  }
  const dstTarget = {
    customSharedBoardFile,
    cwd: toCwd || fromCwd,
    cabinetId: toCabinetId,
  }

  const srcResolved = ensureProjectCabinet(srcTarget)
  const dstResolved = ensureProjectCabinet(dstTarget)
  const srcStore = loadArchiveStore({ customSharedBoardFile, cabinetId: srcResolved.cabinetId, projectKey: srcResolved.projectKey })

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
    return withArchiveLock({ customSharedBoardFile, cabinetId: dstResolved.cabinetId, projectKey: dstResolved.projectKey }, () => {
      const store = loadArchiveStore({ customSharedBoardFile, cabinetId: dstResolved.cabinetId, projectKey: dstResolved.projectKey })
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
        saveArchiveStore(store, { customSharedBoardFile, cabinetId: dstResolved.cabinetId, projectKey: dstResolved.projectKey })
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
  return withArchiveLock({ customSharedBoardFile, cabinetId: dstResolved.cabinetId, projectKey: dstResolved.projectKey }, () => {
    const dstStore = loadArchiveStore({ customSharedBoardFile, cabinetId: dstResolved.cabinetId, projectKey: dstResolved.projectKey })
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
      saveArchiveStore(dstStore, { customSharedBoardFile, cabinetId: dstResolved.cabinetId, projectKey: dstResolved.projectKey })
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
  const validCategories = ['architecture', 'env', 'contract', 'troubleshooting', 'workflow', 'general']
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
    sourceCabinetId: str(raw.sourceCabinetId, '').trim(),
    sourceDrawer: str(raw.sourceDrawer, '').trim(),
    sourceTitles: Array.isArray(raw.sourceTitles) ? raw.sourceTitles.map(t => clamp(t, 80)).slice(0, 40) : [],
    tags: normalizeTags(Array.isArray(raw.tags) ? raw.tags : []),
    flippedOutSessions,
    by: clamp(raw.by || 'chief', 40),
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Number(raw.createdAt) || Date.now(),
  }
}

function loadPrecipitatedStoreRaw(projectKey = 'proj-default', targetOpt) {
  const file = precipitatedFilePath(projectKey, targetOpt)
  if (!fs.existsSync(file)) {
    return {
      version: 1,
      projectKey: resolveProjectKey(projectKey),
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
    projectKey: resolveProjectKey(projectKey),
    updatedAt: Number(parsed && parsed.updatedAt) || Date.now(),
    items,
  }
}

function savePrecipitatedStoreRaw(projectKey = 'proj-default', store, targetOpt) {
  const file = precipitatedFilePath(projectKey, targetOpt)
  const normalized = {
    version: 1,
    projectKey: resolveProjectKey(projectKey),
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

/** Listed ONLY when user opens the `档案` tab in Web UI (`GET /api/dsh-chief/archives`). */
export function listPrecipitatedHeaders(projectKey = 'proj-default', rootSessionId = '', targetOpt) {
  const file = precipitatedFilePath(projectKey, targetOpt)
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
  const file = precipitatedFilePath(resolvedKey, targetOpt)
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
      return { ok: true, item: existing, file }
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
    return { ok: true, item: created, file }
  } finally {
    release()
  }
}

export function mutatePrecipitated(projectKey = 'proj-default', payload = {}, targetOpt) {
  const resolvedKey = resolveProjectKey(projectKey || payload.projectKey || payload.cwd || 'proj-default')
  const file = precipitatedFilePath(resolvedKey, targetOpt)
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
