/**
 * archive-core.js
 *
 * Core archive paths, single file locks, cache accessors, atomic IO, text parsing, and normalization.
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { threadId } from 'node:worker_threads'

export const ARCHIVE_VERSION = 2

const ARCHIVE_CAP = 500

export const POINTS_CAP = 32

export const ARCHIVE_HISTORY_CAP = 5

export const PRECIPITATED_CAP = 300

export const DESKTOP_TOKEN_BUDGET = 2400

export const DESKTOP_MAX_ITEMS = 6

export const DESKTOP_MIN_ITEMS = 4

export const DESKTOP_MAX_ITEMS_CAP = 24

export const DESKTOP_MIN_TOKEN_BUDGET = 1200

export const DESKTOP_MAX_TOKEN_BUDGET = 12000

export function normalizeDesktopCapacity(raw = {}, fallback = {}) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const fb = fallback && typeof fallback === 'object' ? fallback : {}
  const fbItems = Number.isFinite(Number(fb.maxItems)) ? Number(fb.maxItems) : DESKTOP_MAX_ITEMS
  const fbTokens = Number.isFinite(Number(fb.tokenBudget)) ? Number(fb.tokenBudget) : DESKTOP_TOKEN_BUDGET
  const rawItems = Number(src.maxItems)
  const rawTokens = Number(src.tokenBudget)
  const maxItems = Math.max(
    DESKTOP_MIN_ITEMS,
    Math.min(DESKTOP_MAX_ITEMS_CAP, Math.round(Number.isFinite(rawItems) ? rawItems : fbItems)),
  )
  const tokenBudget = Math.max(
    DESKTOP_MIN_TOKEN_BUDGET,
    Math.min(DESKTOP_MAX_TOKEN_BUDGET, Math.round(Number.isFinite(rawTokens) ? rawTokens : fbTokens)),
  )
  return { maxItems, tokenBudget }
}

export const SECRET_PATTERN = /(?:sk-[a-zA-Z0-9_-]{16,}|ghp_[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|Bearer\s+[A-Za-z0-9._~+/=-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/

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

export function nextId(prefix) {
  seq = (seq + 1) % 1000000
  return prefix + '-' + Date.now().toString(36) + '-' + seq.toString(36)
}

export function str(v, fb = '') {
  return typeof v === 'string' ? v : fb
}

export function clamp(v, max) {
  const clean = String(v == null ? '' : v).replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  return clean.slice(0, Math.max(0, max - 1)) + '…'
}

export function cleanMultiline(v, max) {
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

export function normalizeVaultScope(raw) {
  const s = str(raw, '').trim().toLowerCase()
  if (s === 'global') return 'global'
  if (s === 'precipitated' || s === 'cold' || s === 'vault') return 'precipitated'
  return 'session'
}

export function cleanRootSessionId(raw = '') {
  const s = str(raw, '').trim()
  return (!s || s === 'global') ? '' : s
}

export function resolveTargetOpts(targetOpt) {
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

export function normalizeSessionScopeKey(rootSessionId = '') {
  const sid = cleanRootSessionId(rootSessionId)
  if (!sid) return ''
  return 'sess:' + sid.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 72)
}

export function sessionCabinetId(rootSessionId = '') {
  const hash10 = crypto.createHash('sha1').update(String(rootSessionId || 'session')).digest('hex').slice(0, 10)
  return `cab-s-${hash10}`
}

export function withRootScope(targetOpt, rootSessionId = '') {
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

export function normalizeArchiveTitleKey(title) {
  return String(title || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

export function computeEntryContentHash(raw) {
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

const CONTENDED_ARCHIVE_LOCK_CODES = new Set(['EEXIST', 'EPERM', 'EACCES', 'EBUSY'])

export function acquireFileLock(file) {
  if (heldArchiveLocks.has(file)) return () => {}
  const lock = file + '.lock'
  try {
    fs.mkdirSync(path.dirname(lock), { recursive: true })
  } catch {}
  const deadline = Date.now() + 10000
  for (;;) {
    try {
      const fd = fs.openSync(lock, 'wx')
      try {
        fs.writeSync(fd, `${process.pid}:${threadId}`)
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
      const code = err && err.code
      if (code === 'ENOENT' && Date.now() < deadline) {
        try {
          fs.mkdirSync(path.dirname(lock), { recursive: true })
        } catch {}
        sleepSync(2)
        continue
      }
      if (!err || !CONTENDED_ARCHIVE_LOCK_CODES.has(code) || Date.now() >= deadline) {
        try {
          if (Date.now() >= deadline) fs.unlinkSync(lock)
        } catch {}
        heldArchiveLocks.add(file)
        return () => heldArchiveLocks.delete(file)
      }
      if (code === 'EEXIST') {
        try {
          const st = fs.statSync(lock)
          if (Date.now() - st.mtimeMs > 15000) {
            fs.unlinkSync(lock)
            continue
          }
        } catch {}
      }
      sleepSync(2 + Math.floor(Math.random() * 4))
    }
  }
}

let archiveCache = { file: '', mtime: -1, store: null }

export function invalidateArchiveCache() {
  archiveCache = { file: '', mtime: -1, store: null }
}

export function atomicWriteJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${threadId}.${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  let lastErr = null
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      fs.renameSync(tmp, file)
      return
    } catch (err) {
      lastErr = err
      const code = err && err.code
      if (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY') break
      sleepSync(2 + attempt * 2)
    }
  }
  try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp) } catch {}
  if (lastErr) throw lastErr
}

export function readJsonSafe(file, fallback = null) {
  try {
    if (!fs.existsSync(file)) return fallback
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

/* ------------------------------------------- Registry & Legacy Migration */

function stripMarkdownDecorators(text) {
  return String(text || '')
    .replace(/^[#>*\-\d.)\s\u3000]+/, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim()
}

export function firstMeaningfulSentence(text) {
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

export function normalizeFolder(raw, index = 0) {
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

export function normalizePoint(raw, idx = 0) {
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

export function normalizeTags(list) {
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

export function tokenizeArchiveBilingual(text) {
  if (typeof text !== 'string' || !text) return []
  const lower = text.toLowerCase()
  const tokens = []
  const latinMatches = lower.match(/[a-z0-9][a-z0-9._-]*/g)
  if (latinMatches) {
    for (const w of latinMatches) {
      if (w.length <= 64) tokens.push(w)
    }
  }
  const cjkSeqs = lower.match(/[\u4e00-\u9fff]+/g)
  if (cjkSeqs) {
    for (const seqStr of cjkSeqs) {
      if (seqStr.length === 1) {
        tokens.push(seqStr)
        continue
      }
      if (seqStr.length <= 4) tokens.push(seqStr)
      for (let i = 0; i < seqStr.length - 1; i += 1) {
        tokens.push(seqStr.slice(i, i + 2))
      }
    }
  }
  return tokens
}

export function extractArchiveWikiLinks(text) {
  if (typeof text !== 'string' || !text) return []
  const seen = new Set()
  const out = []
  const re = /\[\[([^\]\n]{1,120})\]\]/g
  let m
  while ((m = re.exec(text)) !== null) {
    const target = m[1].split('|')[0].trim()
    if (!target) continue
    const low = target.toLowerCase()
    if (seen.has(low)) continue
    seen.add(low)
    out.push(target)
    if (out.length >= 16) break
  }
  return out
}

export function normalizeArchiveHistory(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const snap of raw) {
    if (!snap || typeof snap !== 'object') continue
    const title = clamp(snap.title || '', 180)
    const body = cleanMultiline(snap.body || '', 8000)
    if (!title && !body) continue
    out.push({
      title: title || '历史版本',
      summary: clamp(snap.summary || '', 140),
      paperclip: ['gold', 'silver', 'copper'].includes(snap.paperclip) ? snap.paperclip : 'silver',
      pointsCount: Math.max(0, Math.round(Number(snap.pointsCount) || 0)),
      body,
      updatedAt: Number(snap.updatedAt) || Date.now(),
      by: clamp(snap.by || 'user', 40),
    })
    if (out.length >= ARCHIVE_HISTORY_CAP) break
  }
  return out
}

export function normalizeSessionIdList(list, cap = 32) {
  if (!Array.isArray(list)) return []
  return [...new Set(list.map(s => String(s || '').trim()).filter(Boolean))].slice(0, cap)
}

export function normalizeDesktopMeta(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw)) {
    const sid = String(k || '').trim()
    if (!sid || !v || typeof v !== 'object') continue
    out[sid] = {
      pinnedAt: Number(v.pinnedAt) || Date.now(),
      by: clamp(v.by || 'user', 30),
      priority: Number.isFinite(Number(v.priority)) ? Number(v.priority) : 0,
    }
  }
  return out
}

export function estimateArchiveTokens(item) {
  if (!item || typeof item !== 'object') return 40
  const pts = (Array.isArray(item.points) ? item.points : []).slice(0, 3)
  const ptText = pts.map(p => `${p.title || ''} ${p.cue || p.detail || ''}`).join(' ')
  const combined = `${item.title || ''}\n${item.summary || ''}\n${ptText || (item.body || '').slice(0, 480)}`
  let cjkCount = 0
  let asciiCount = 0
  for (let i = 0; i < combined.length; i += 1) {
    if (combined.charCodeAt(i) > 127) cjkCount += 1
    else asciiCount += 1
  }
  const est = Math.ceil(cjkCount * 0.85 + asciiCount * 0.28) + 18
  return Math.max(40, est)
}

export function deriveHookFromStructuredItem(raw, forceOrganized = false) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const isOrganized = Boolean(forceOrganized || src.organizedBy === 'chief' || src.hasHook === true)
  if (!isOrganized) {
    return { hasHook: false, hookKeywords: [], hookCue: '' }
  }
  const candidates = []
  if (Array.isArray(src.hookKeywords)) candidates.push(...src.hookKeywords)
  if (Array.isArray(src.tags)) candidates.push(...src.tags)
  if (Array.isArray(src.points)) {
    for (const pt of src.points.slice(0, 4)) {
      if (pt && pt.title) candidates.push(String(pt.title).split(/[：:·—]/)[0])
    }
  }
  if (!candidates.length && src.title) {
    const words = String(src.title).split(/[\s/·：:()（）]+/).filter(w => w.length >= 2)
    candidates.push(...words.slice(0, 3))
  }
  const seen = new Set()
  const hookKeywords = []
  for (const cand of candidates) {
    const kw = clamp(String(cand || '').replace(/^#+/, '').trim(), 16)
    if (!kw || kw === 'anchor') continue
    const low = kw.toLowerCase()
    if (seen.has(low)) continue
    seen.add(low)
    hookKeywords.push(kw)
    if (hookKeywords.length >= 5) break
  }
  if (!hookKeywords.length && src.folder) {
    hookKeywords.push(clamp(src.folder, 16))
  }
  const rawCue = str(src.hookCue, '').trim()
    || (Array.isArray(src.points) && src.points[0] && (src.points[0].cue || src.points[0].title))
    || src.summary
    || firstMeaningfulSentence(src.body || '')
    || src.title
  const hookCue = clamp(rawCue, 40)
  return {
    hasHook: true,
    hookKeywords,
    hookCue,
  }
}

export function normalizeArchiveItem(raw) {
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

  const takenOutSessions = normalizeSessionIdList(raw.takenOutSessions)
  const chiefMountedSessions = normalizeSessionIdList(raw.chiefMountedSessions)
  const leadPulledSessions = normalizeSessionIdList(raw.leadPulledSessions)
  const chiefPulledSessions = normalizeSessionIdList(raw.chiefPulledSessions)
  const chiefDeliveredSessions = normalizeSessionIdList(raw.chiefDeliveredSessions)
  const organizedBy = ['auto', 'chief', 'user'].includes(raw.organizedBy) ? raw.organizedBy : 'auto'
  const tags = normalizeTags(Array.isArray(raw.tags) ? raw.tags : [])
  const rawLinks = Array.isArray(raw.links) ? raw.links.map(x => String(x || '').trim()).filter(Boolean) : []
  const ptLinkText = points.map(p => `${p.title || ''} ${p.detail || ''}`).join('\n')
  const wikiLinks = extractArchiveWikiLinks(`${body}\n${ptLinkText}`)
  const links = [...new Set([...rawLinks, ...wikiLinks])].slice(0, 20)
  const history = normalizeArchiveHistory(raw.history)
  const hook = deriveHookFromStructuredItem({
    ...raw,
    title,
    summary,
    folder,
    tags,
    points,
    body,
    organizedBy,
  }, organizedBy === 'chief' || raw.hasHook === true)
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
    tags,
    links,
    history,
    cold: raw.cold !== false,
    takenOutSessions,
    chiefMountedSessions,
    leadPulledSessions,
    chiefPulledSessions,
    chiefDeliveredSessions,
    desktopMeta: normalizeDesktopMeta(raw.desktopMeta),
    hasHook: hook.hasHook,
    hookKeywords: hook.hookKeywords,
    hookCue: hook.hookCue,
    organizedBy,
    points,
    body,
    contentHash,
    by: clamp(raw.by || 'agent', 40),
    sourceSession: str(raw.sourceSession || raw.session, '').trim(),
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Number(raw.createdAt) || Date.now(),
  }
}

export function normalizeGlobalVaultEntry(raw) {
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

function normalizeRecentlyUnpinnedWatch(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  const seen = new Set()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const id = str(item.id, '').trim()
    const vaultScope = item.vaultScope === 'global' ? 'global' : 'session'
    if (!id) continue
    const key = `${vaultScope}:${id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      id,
      vaultScope,
      title: clamp(item.title || '未命名卷宗', 120),
      folder: str(item.folder, 'inbox').trim() || 'inbox',
      unpinnedAt: Number(item.unpinnedAt) || Date.now(),
      by: clamp(item.by || 'user', 30),
    })
    if (out.length >= 12) break
  }
  return out
}

export function normalizeArchiveStore(raw) {
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

  const cap = normalizeDesktopCapacity({
    maxItems: src.desktopMaxItems,
    tokenBudget: src.desktopTokenBudget,
  })

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
    desktopMaxItems: src.isSystemGlobalVault ? DESKTOP_MAX_ITEMS : cap.maxItems,
    desktopTokenBudget: src.isSystemGlobalVault ? DESKTOP_TOKEN_BUDGET : cap.tokenBudget,
    folders,
    items,
    recentlyUnpinnedWatch: src.isSystemGlobalVault ? [] : normalizeRecentlyUnpinnedWatch(src.recentlyUnpinnedWatch),
  }
}

export function getCachedArchiveStore(file, mtime) {
  if (archiveCache.store && archiveCache.file === file && archiveCache.mtime === mtime) {
    return archiveCache.store
  }
  return null
}

export function setCachedArchiveStore(file, mtime, store) {
  archiveCache = { file, mtime, store }
}

let archiveMutatorHook = null

export function registerArchiveMutatorHook(fn) {
  archiveMutatorHook = typeof fn === 'function' ? fn : null
}

export function invokeArchiveMutatorHook(payload, targetOpt) {
  if (!archiveMutatorHook) {
    return { ok: false, error: 'archive mutator hook not registered' }
  }
  return archiveMutatorHook(payload, targetOpt)
}
