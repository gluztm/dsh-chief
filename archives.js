/**
 * Engineering Memory Filing Cabinet (沉淀工程记忆档案库 · 严格懒加载 · 零主动注入)
 *
 * Persists structured long-term engineering dossiers at `%DSH_HOME%/chief/archives.json`.
 *
 * Core Contracts:
 * 1. Cold Vault (`cold: true`, `takenOutSessions: []` by default):
 *    Never auto-injected into system prompts (`renderDigest`), handoff packets (`renderHandoff`),
 *    or background chief reviews. Zero token burn until explicitly requested or taken out by user.
 * 2. Two-Stage Lazy Loading for Web UI:
 *    - `/snapshot` carries ONLY `archiveMeta` counts (<80 bytes).
 *    - `GET /archives` (when clicking `档案` tab) returns folder drawers + lightweight dossier headers
 *      (NO `points` details and NO `body` text).
 *    - `GET /archives/detail?id=...` (when opening a dossier) lazy-loads structured `points` + lossless `body`.
 * 3. Three-Tier Filing Hierarchy:
 *    - Tier 1: Filing Cabinet Folders (`folders`: drawer tabs with color spine & counts)
 *    - Tier 2: Paperclipped Dossier Files (`paperclip`: 'gold' | 'silver' | 'copper', title, summary, tags)
 *    - Tier 3: Structured Memory Points (`points`: `{ id, title, cue, detail }`) -> click point to expand sub-point detail (`小点记忆`), while 100% preserving raw `body`.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ARCHIVE_VERSION = 1
const ARCHIVE_CAP = 500
const POINTS_CAP = 32
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

export function archiveFilePath(customSharedBoardFile) {
  if (customSharedBoardFile) {
    return path.join(path.dirname(customSharedBoardFile), 'archives.json')
  }
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'chief', 'archives.json')
}

/* ----------------------------------------------------------- Lock & Storage */

const heldArchiveLocks = new Set()
const lockSleeper = new Int32Array(new SharedArrayBuffer(4))

function sleepSync(ms) {
  try {
    Atomics.wait(lockSleeper, 0, 0, ms)
  } catch {}
}

function acquireArchiveLock(file) {
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
    // Strip internal routing tag 'anchor' from visual display tags while preserving paperclip='gold'
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
    ? [...new Set(raw.takenOutSessions.map(s => String(s || '').trim()).filter(Boolean))].slice(0, 24)
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

  // Ensure any custom folder referenced by an item exists in `folders`
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
    migratedSharedAt: Number(src.migratedSharedAt) || 0,
    updatedAt: Number(src.updatedAt) || Date.now(),
    folders,
    items,
  }
}

export function loadArchiveStore(customSharedBoardFile) {
  const file = archiveFilePath(customSharedBoardFile)
  try {
    const st = fs.statSync(file)
    if (archiveCache.store && archiveCache.file === file && archiveCache.mtime === st.mtimeMs) {
      return archiveCache.store
    }
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    const store = normalizeArchiveStore(parsed)
    archiveCache = { file, mtime: st.mtimeMs, store }
    return store
  } catch {
    const empty = normalizeArchiveStore({})
    return empty
  }
}

export function saveArchiveStore(store, customSharedBoardFile) {
  const file = archiveFilePath(customSharedBoardFile)
  const normalized = normalizeArchiveStore({ ...store, updatedAt: Date.now() })
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.' + process.pid + '.' + Date.now().toString(36) + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(normalized, null, 2), 'utf8')
  fs.renameSync(tmp, file)
  let mtime = Date.now()
  try {
    mtime = fs.statSync(file).mtimeMs
  } catch {}
  archiveCache = { file, mtime, store: normalized }
  return normalized
}

export function withArchiveLock(customSharedBoardFile, fn) {
  const file = archiveFilePath(customSharedBoardFile)
  const release = acquireArchiveLock(file)
  invalidateArchiveCache()
  try {
    return fn(file)
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
  // Skip bare markdown heading if next line has substance
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

/**
 * Parse raw Markdown/prose engineering notes into structured Memory Points (`记忆点 -> 小点记忆`),
 * while keeping raw `body` 100% intact on the parent dossier.
 */
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

  // Strategy 1: Markdown Headings (`## ...` or `### ...`)
  const headingIndices = []
  for (let i = 0; i < lines.length; i += 1) {
    if (/^#{2,3}\s+\S/.test(lines[i].trim())) {
      headingIndices.push(i)
    }
  }
  if (headingIndices.length >= 1) {
    const points = []
    // Capture preface before first ## heading if substantial (excluding redundant `# Title`)
    const preLines = lines
      .slice(0, headingIndices[0])
      .filter(l => !/^#\s+/.test(l.trim()))
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

  // Strategy 2: Labeled Key-Value Blocks (`包体/源码：...`, `部署态验证：...`, `数据：...`, `坑：...`)
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

  // Strategy 3: Paragraph / Numbered-List / Sentence-Cluster Splitting
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

  // Strategy 4: Dense single-paragraph prose -> split into logical clauses (`。` / `；`) if long
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

/**
 * One-time lossless migration of legacy shared-board engineering notes into `archives.json`.
 * 1. Writes a full backup of `board.json` to `board.pre-archive-backup.json` (never overwrites).
 * 2. Converts every existing note on the shared board into a cold-stored structured dossier in `archives.json`.
 * 3. Clears those migrated notes off `sharedBoard.notes` so they stop polluting every turn's prompt digest!
 */
export function bootstrapArchivesFromSharedBoard({ sharedFile, loadBoard, saveBoard, pushLog }) {
  try {
    if (!sharedFile || !fs.existsSync(sharedFile)) return { migrated: 0 }
    const archFile = archiveFilePath(sharedFile)
    if (fs.existsSync(archFile)) {
      const existing = loadArchiveStore(sharedFile)
      if (existing.migratedSharedAt > 0 || existing.items.length > 0) {
        return { migrated: 0 }
      }
    }

    const sharedBoard = loadBoard(sharedFile)
    const legacyNotes = Array.isArray(sharedBoard && sharedBoard.notes) ? sharedBoard.notes : []
    if (!legacyNotes.length) {
      withArchiveLock(sharedFile, () => {
        const empty = loadArchiveStore(sharedFile)
        empty.migratedSharedAt = Date.now()
        saveArchiveStore(empty, sharedFile)
      })
      return { migrated: 0 }
    }

    // 1. Safety backup of `board.json` before touching anything
    const backupFile = path.join(path.dirname(sharedFile), 'board.pre-archive-backup.json')
    try {
      if (!fs.existsSync(backupFile)) {
        fs.copyFileSync(sharedFile, backupFile)
      }
    } catch {}

    // 2. Precipitate all legacy notes into cold archives
    let migratedCount = 0
    withArchiveLock(sharedFile, () => {
      const store = loadArchiveStore(sharedFile)
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
      saveArchiveStore(store, sharedFile)
    })

    // 3. Remove migrated long-term notes from shared `board.json` so prompt auto-injection drops to ZERO
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

/** Ultra-lightweight metadata (<80 bytes) for `/snapshot` polling — ZERO archive text/headers! */
export function getArchiveMeta(rootSessionId = '', customSharedBoardFile) {
  const store = loadArchiveStore(customSharedBoardFile)
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
  }
}

/**
 * Tier-1 Lazy Load (`GET /api/dsh-chief/archives`):
 * Returns folder drawers + slim dossier headers ONLY (no `points` details, no `body`!).
 */
export function listArchiveHeaders(rootSessionId = '', opts = {}, customSharedBoardFile) {
  const store = loadArchiveStore(customSharedBoardFile)
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

  return {
    ok: true,
    totalCount: store.items.length,
    takenOutCount: sid ? store.items.filter(it => it.takenOutSessions.includes(sid)).length : 0,
    folders,
    items: headers,
  }
}

/**
 * Tier-2 Lazy Load (`GET /api/dsh-chief/archives/detail?id=...`):
 * Loaded ONLY when a user clicks a dossier file or an agent calls `archive.read`.
 */
export function getArchiveDetail(idOrTitle = '', rootSessionId = '', customSharedBoardFile) {
  const target = String(idOrTitle || '').trim()
  if (!target) return { ok: false, error: 'archive id or title required' }
  const store = loadArchiveStore(customSharedBoardFile)
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
 * Strictly returns ONLY dossiers that the user has EXPLICITLY taken out onto the current session desk.
 * Sealed/cold dossiers (`takenOutSessions` without `rootSessionId`) NEVER appear here!
 */
export function getTakenOutArchivesForSession(rootSessionId = '', customSharedBoardFile) {
  const sid = String(rootSessionId || '').trim()
  if (!sid) return []
  const store = loadArchiveStore(customSharedBoardFile)
  return store.items.filter(it => Array.isArray(it.takenOutSessions) && it.takenOutSessions.includes(sid))
}

/** On-demand search for `chief_board({ action: "archive.search" })` or Chief explicit lookup. */
export function searchArchives(query = '', opts = {}, customSharedBoardFile) {
  const store = loadArchiveStore(customSharedBoardFile)
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

export function mutateArchive(payload = {}, customSharedBoardFile) {
  const op = str(payload.op, 'save').trim()
  const rootSessionId = str(payload.rootSessionId || payload.session, '').trim()

  return withArchiveLock(customSharedBoardFile, () => {
    const store = loadArchiveStore(customSharedBoardFile)

    if (op === 'createFolder' || op === 'saveFolder') {
      const rawLabel = clamp(payload.label || payload.folderLabel || payload.folder, 40)
      if (!rawLabel) return { ok: false, error: '请输入文件夹抽屉名称' }
      const id = str(payload.folderId, '').trim()
        || ('folder-' + rawLabel.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, '-').slice(0, 24) + '-' + Date.now().toString(36).slice(-3))
      const existing = store.folders.find(f => f.id === id || f.label === rawLabel)
      if (existing) {
        if (payload.hint !== undefined) existing.hint = clamp(payload.hint, 100)
        if (payload.accent) existing.accent = str(payload.accent, existing.accent).slice(0, 24)
        saveArchiveStore(store, customSharedBoardFile)
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
      saveArchiveStore(store, customSharedBoardFile)
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
        saveArchiveStore(store, customSharedBoardFile)
        return { ok: true, item: existing, meta: getArchiveMeta(rootSessionId, customSharedBoardFile) }
      }

      const rawTitle = clamp(payload.title || '', 180)
      if (!rawTitle && !nextBody) {
        return { ok: false, error: '新建工程档案需要填写标题或正文内容' }
      }
      // Dedupe if exact same title already archived and caller opted into upsert
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
        saveArchiveStore(store, customSharedBoardFile)
        return { ok: true, item: sameTitle, updatedExisting: true, meta: getArchiveMeta(rootSessionId, customSharedBoardFile) }
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
        takenOutSessions: payload.takeOutNow && rootSessionId ? [rootSessionId] : [],
        organizedBy: Array.isArray(payload.points) && payload.points.length ? 'user' : 'auto',
        points: Array.isArray(payload.points) && payload.points.length ? payload.points : parsed.points,
        body: nextBody,
        by: payload.by || 'user',
        sourceSession: rootSessionId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      store.items.unshift(created)
      saveArchiveStore(store, customSharedBoardFile)
      return { ok: true, item: created, meta: getArchiveMeta(rootSessionId, customSharedBoardFile) }
    }

    if (op === 'delete' || op === 'remove') {
      const id = str(payload.archiveId || payload.id, '').trim()
      const idx = store.items.findIndex(it => it.id === id)
      if (idx < 0) return { ok: false, error: '未找到要删除的档案：' + id }
      const [removed] = store.items.splice(idx, 1)
      saveArchiveStore(store, customSharedBoardFile)
      return { ok: true, removedId: removed.id, title: removed.title, meta: getArchiveMeta(rootSessionId, customSharedBoardFile) }
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
      saveArchiveStore(store, customSharedBoardFile)
      return {
        ok: true,
        id: item.id,
        title: item.title,
        takenOut: op === 'takeOut',
        meta: getArchiveMeta(rootSessionId, customSharedBoardFile),
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
      saveArchiveStore(store, customSharedBoardFile)
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
      saveArchiveStore(store, customSharedBoardFile)
      return { ok: true, id: item.id, folder: item.folder }
    }

    return { ok: false, error: '未知的档案操作：' + op }
  })
}

/**
 * Batch-apply Chief LLM organization results (`folder`, `folderLabel`, `paperclip`, `summary`, `tags`, `points`)
 * while 100% preserving each dossier's raw `body` lossless!
 */
export function applyChiefArchiveCurations(curations = [], newFolders = [], customSharedBoardFile) {
  if (!Array.isArray(curations) || !curations.length) return { updatedCount: 0 }
  return withArchiveLock(customSharedBoardFile, () => {
    const store = loadArchiveStore(customSharedBoardFile)
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
      // Raw `target.body` is NEVER overwritten by Chief curation — 100% lossless!
      target.organizedBy = 'chief'
      target.updatedAt = Date.now()
      updatedCount += 1
    }

    if (updatedCount > 0) {
      saveArchiveStore(store, customSharedBoardFile)
    }
    return { updatedCount }
  })
}
