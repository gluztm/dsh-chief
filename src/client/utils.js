/**
 * utils.js
 *
 * Formatting, session/owner labeling, model name shortening, and hierarchy builder utilities.
 */

import { h } from './react-runtime.js'
import { GENERIC_OWNERS, SESSION_PALETTE } from './constants.js'
import { store } from './store.js'

export function normalizeMaxTurnsVal(raw) {
  if (raw === 0 || raw === '0') return 0
  const n = Math.round(Number(raw))
  return Number.isFinite(n) && n >= 1 ? Math.min(30, n) : 10
}

/** Width-aware truncation so CJK and ASCII labels fit cleanly inside pills & SVG nodes. */
export function clampTitle(text, maxUnits = 14) {
  const raw = String(text === null || text === undefined ? '' : text).replace(/\s+/g, ' ').trim()
  if (!raw) return ''
  let units = 0
  let out = ''
  for (const ch of raw) {
    const w = ch.charCodeAt(0) > 255 ? 1 : 0.58
    if (units + w > maxUnits) return out + '…'
    out += ch
    units += w
  }
  return out
}

export function shortSession(id) {
  if (!id) return ''
  return String(id).replace(/^session-/, '').slice(0, 6)
}

export function ownerLabel(id) {
  if (!id) return ''
  const text = String(id)
  return text.indexOf('session-') === 0 ? shortSession(text) : text
}

export function timeLabel(at) {
  if (!at) return ''
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return ''
  const pad = v => String(v).padStart(2, '0')
  const sameDay = date.toDateString() === new Date().toDateString()
  return (sameDay ? '' : (date.getMonth() + 1) + '/' + date.getDate() + ' ') + pad(date.getHours()) + ':' + pad(date.getMinutes())
}

export function relativeTimeLabel(at) {
  if (!at) return ''
  const diffMs = Math.max(0, Date.now() - Number(at))
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return mins + '分钟前'
  const hours = Math.floor(mins / 60)
  if (hours < 24) return hours + '小时前'
  return timeLabel(at)
}

export function shortModelName(ref, catalog = null, includeChannel = true) {
  const s = String(ref || '').trim()
  if (!s) return '自动跟随'
  const slashIdx = s.indexOf('/')
  const provId = slashIdx > 0 ? s.slice(0, slashIdx) : ''
  const rawModelId = slashIdx > 0 ? s.slice(slashIdx + 1) : s
  // Strip redundant inner vendor prefix like `deepseek/deepseek-v4.1-flash` -> `deepseek-v4.1-flash`
  const leafModel = rawModelId.includes('/') ? rawModelId.split('/').slice(1).join('/') : rawModelId

  const modelsList = (catalog && Array.isArray(catalog.models))
    ? catalog.models
    : (store.secModelsCatalog && Array.isArray(store.secModelsCatalog.models) ? store.secModelsCatalog.models : [])
  const hit = modelsList.find(m => m && m.ref === s)
  const modelLabel = hit && hit.name ? String(hit.name).trim() : leafModel
  const provName = hit && hit.providerName ? String(hit.providerName).trim() : provId

  if (!includeChannel) return clampTitle(modelLabel, 24)

  let chanShort = provName
  if (provId === 'commandcode' || /command\s*code/i.test(provName)) chanShort = 'CC'
  else if (/account/i.test(provId) || /account/i.test(provName)) chanShort = 'Account'
  else if (provId === 'our-free-model') chanShort = 'Free'

  const alreadyHasTag = (chanShort === 'CC' && /\(CC\)/i.test(modelLabel))
    || (chanShort && modelLabel.toLowerCase().includes(chanShort.toLowerCase()))
  const full = alreadyHasTag || !chanShort ? modelLabel : `${chanShort} · ${modelLabel}`
  return clampTitle(full, 20)
}

export function fullModelWithChannel(ref, catalog = null) {
  const s = String(ref || '').trim()
  if (!s) return ''
  if (catalog && catalog.followRef === s && catalog.followLabel) return catalog.followLabel
  const slashIdx = s.indexOf('/')
  const provId = slashIdx > 0 ? s.slice(0, slashIdx) : ''
  const rawModelId = slashIdx > 0 ? s.slice(slashIdx + 1) : s
  const leafModel = rawModelId.includes('/') ? rawModelId.split('/').slice(1).join('/') : rawModelId
  const modelsList = (catalog && Array.isArray(catalog.models)) ? catalog.models : []
  const hit = modelsList.find(m => m && m.ref === s)
  const provLabel = (hit && hit.providerName)
    || (provId === 'commandcode' ? 'Command Code' : provId)
  const modelLabel = (hit && hit.name) ? String(hit.name).trim() : leafModel
  if (!provLabel || modelLabel.toLowerCase().includes(provLabel.toLowerCase())) return modelLabel
  return `${provLabel} · ${modelLabel}`
}

/** Shorten verbose auto-generated subagent IDs like `mnemon-review-072e7e671b4b4078` -> `mnemon-review·072e`. */
export function shortAgentName(name, leafOnly = false) {
  const raw = String(name || '').trim().replace(/^@/, '')
  if (!raw) return ''
  if (raw === 'lead' || raw === 'agent') return '主代理'
  const parts = raw.split('/').filter(Boolean)
  const fmtSeg = seg => seg.replace(/[-_]([0-9a-f]{8,40})$/i, (_, hex) => '·' + hex.slice(0, 4))
  if (leafOnly && parts.length > 1) {
    return fmtSeg(parts[parts.length - 1])
  }
  return parts.map(fmtSeg).join('/')
}

/** Identify internal background checkpoint probes (`@mnemon-review-*` / `@mnemon-run-*`) so they don't clutter task topology. */
export function isInternalProbeName(name) {
  const raw = String(name || '').trim().replace(/^@/, '')
  if (!raw) return false
  const leaf = raw.split('/').pop() || raw
  return /^mnemon-(?:review|run)(?:[-_]|$)/i.test(leaf)
}

/** Reconstruct multi-tier parent -> child subagent pyramid from `store.subagents` (by `parentId` and/or slash path). */
export function buildAgentHierarchy(subagentsRaw, identity, opts = {}) {
  const list = Array.isArray(subagentsRaw) ? subagentsRaw.filter(a => a && a.name) : []
  const rootId = (identity && identity.rootId) || store.sessionId || ''
  const leadEntry = list.find(a => a.name === 'lead' || (rootId && a.id === rootId)) || null
  const allChildren = list.filter(a => a !== leadEntry && a.name !== 'lead')
  const includeProbes = Boolean(opts.includeProbes || store.showInternalProbes)
  const hiddenProbes = includeProbes
    ? []
    : allChildren.filter(a => isInternalProbeName(a.name) && a.status !== 'running' && store.filterAgent !== a.name)
  const hiddenSet = new Set(hiddenProbes)
  const children = allChildren.filter(a => !hiddenSet.has(a))

  const byId = new Map()
  const byName = new Map()
  const byLower = new Map()
  for (const a of children) {
    if (a.id) byId.set(a.id, a)
    byName.set(a.name, a)
    byLower.set(String(a.name).toLowerCase(), a)
  }

  const parentKeyOf = new Map()
  const kidsMap = new Map()
  kidsMap.set('lead', [])
  for (const a of children) kidsMap.set(a.name, [])

  for (const a of children) {
    let pKey = 'lead'
    if (a.parentId && a.parentId !== rootId && byId.has(a.parentId)) {
      const parentAgent = byId.get(a.parentId)
      if (parentAgent && parentAgent.name !== a.name) pKey = parentAgent.name
    } else if (String(a.name).includes('/')) {
      const segs = String(a.name).split('/').filter(Boolean)
      for (let i = segs.length - 1; i >= 1; i--) {
        const prefix = segs.slice(0, i).join('/')
        const found = byName.get(prefix) || byLower.get(prefix.toLowerCase())
        if (found && found.name !== a.name) {
          pKey = found.name
          break
        }
      }
    }
    parentKeyOf.set(a.name, pKey)
    if (!kidsMap.has(pKey)) kidsMap.set(pKey, [])
    kidsMap.get(pKey).push(a)
  }

  const descendantsOf = agentName => {
    const out = []
    const seen = new Set([agentName])
    const stack = [...(kidsMap.get(agentName) || [])]
    while (stack.length) {
      const cur = stack.shift()
      if (!cur || seen.has(cur.name)) continue
      seen.add(cur.name)
      out.push(cur)
      const sub = kidsMap.get(cur.name) || []
      for (const k of sub) stack.push(k)
    }
    return out
  }

  const matchAgentRef = ref => {
    const clean = String(ref || '').trim().replace(/^@/, '')
    if (!clean || GENERIC_OWNERS.has(clean.toLowerCase())) return null
    if (byName.has(clean)) return byName.get(clean)
    const low = clean.toLowerCase()
    if (byLower.has(low)) return byLower.get(low)
    if (byId.has(clean)) return byId.get(clean)
    for (const a of children) {
      const leaf = String(a.name).split('/').pop().toLowerCase()
      if (leaf === low || shortAgentName(a.name, true).toLowerCase() === low) return a
    }
    return null
  }

  return {
    leadEntry,
    children,
    allChildren,
    probeCount: hiddenProbes.length,
    byId,
    byName,
    parentKeyOf,
    kidsMap,
    descendantsOf,
    matchAgentRef,
  }
}

/** Resolve which subagents (and/or lead) are actively advancing or blocking a specific objective task. */
export function resolveTaskAgents(task, allTasks, subagentsRaw, identity) {
  const empty = { agentNames: [], includeLead: false, scopeTaskIds: [], inferredLive: false }
  if (!task) return empty
  const tasks = Array.isArray(allTasks) ? allTasks.filter(Boolean) : []
  const hier = buildAgentHierarchy(subagentsRaw, identity)

  // Collect task + all descendant sub-tasks
  const scopeTasks = [task]
  const scopeSeen = new Set([task.id])
  let idx = 0
  while (idx < scopeTasks.length) {
    const cur = scopeTasks[idx++]
    for (const t of tasks) {
      if (t.parentId === cur.id && !scopeSeen.has(t.id)) {
        scopeSeen.add(t.id)
        scopeTasks.push(t)
      }
    }
  }

  const matched = new Set()
  for (const t of scopeTasks) {
    const candidates = [t.subagent, t.owner, t.session].filter(Boolean)
    for (const ref of candidates) {
      const hit = hier.matchAgentRef(ref)
      if (hit) {
        matched.add(hit.name)
        for (const desc of hier.descendantsOf(hit.name)) matched.add(desc.name)
      }
    }
    for (const a of hier.children) {
      if (a.taskId && a.taskId === t.id) {
        matched.add(a.name)
        for (const desc of hier.descendantsOf(a.name)) matched.add(desc.name)
      } else if (Array.isArray(a.tasks) && a.tasks.some(at => at && at.id === t.id)) {
        matched.add(a.name)
        for (const desc of hier.descendantsOf(a.name)) matched.add(desc.name)
      }
    }
  }

  let inferredLive = false
  let includeLead = false

  if (matched.size === 0) {
    const hasActiveWork = scopeTasks.some(t => t.status === 'doing' || t.status === 'blocked')
    if (hasActiveWork) {
      const running = hier.children.filter(a => a.status === 'running')
      if (running.length > 0) {
        inferredLive = true
        for (const r of running) {
          matched.add(r.name)
          for (const desc of hier.descendantsOf(r.name)) matched.add(desc.name)
        }
      } else {
        includeLead = true
      }
    } else {
      includeLead = true
    }
  }

  // Also include parent Tier-1 agent on the chain if a Tier-2 agent is matched
  for (const name of [...matched]) {
    let p = hier.parentKeyOf.get(name)
    let guard = 0
    while (p && p !== 'lead' && guard++ < 8) {
      matched.add(p)
      p = hier.parentKeyOf.get(p)
    }
  }

  return {
    agentNames: [...matched],
    includeLead,
    scopeTaskIds: [...scopeSeen],
    inferredLive,
  }
}

export function snippetOf(text, needle, radius) {
  const source = String(text || '')
  const lower = String(needle || '').toLowerCase()
  const at = lower ? source.toLowerCase().indexOf(lower) : -1
  if (at < 0) return source.slice(0, radius * 2)
  const from = Math.max(0, at - radius)
  const to = Math.min(source.length, at + lower.length + radius)
  return (from > 0 ? '…' : '') + source.slice(from, to).replace(/\s+/g, ' ') + (to < source.length ? '…' : '')
}

export function sessionIdFromUrl() {
  try {
    const match = (location.pathname + location.search + location.hash).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/)
    return match ? 'session-' + match[1] : ''
  } catch {
    return ''
  }
}

/* ---------------------------------------------------------- host services */

function readBlobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'))
    reader.readAsDataURL(blob)
  })
}

export function encodeImageForChief(file) {
  return readBlobAsDataUrl(file).then(rawUrl => new Promise((resolve, reject) => {
    const matchedMime = rawUrl.match(/^data:([^;]+);base64,/i)?.[1]
    const rawType = (String(file.type || '').toLowerCase() === 'image/jpg' ? 'image/jpeg' : String(file.type || '').toLowerCase())
      || (matchedMime || 'image/png').toLowerCase()
    const normType = rawType === 'image/jpg' ? 'image/jpeg' : rawType
    const extractB64 = url => {
      const m = String(url || '').match(/^data:([^;]+);base64,(.+)$/is)
      return m ? { mediaType: m[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : m[1].toLowerCase(), data: m[2] } : null
    }
    const makeItem = (parsed, previewUrl, fallbackName) => ({
      id: 'img-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      name: fallbackName || file.name || 'image.png',
      mediaType: parsed.mediaType,
      data: parsed.data,
      previewUrl,
    })
    if (normType === 'image/gif' || typeof Image === 'undefined') {
      const parsed = extractB64(rawUrl)
      if (!parsed) return reject(new Error('解析图片失败'))
      return resolve(makeItem(parsed, rawUrl, file.name || 'image.gif'))
    }
    const img = new Image()
    img.onload = () => {
      const w = img.naturalWidth || img.width || 0
      const h = img.naturalHeight || img.height || 0
      const maxSide = 2048
      const tooBigDim = w > maxSide || h > maxSide
      const tooHeavy = (file.size || 0) > 3.5 * 1024 * 1024
      if (!tooBigDim && !tooHeavy) {
        const parsed = extractB64(rawUrl)
        if (parsed) return resolve(makeItem(parsed, rawUrl))
      }
      try {
        const scale = tooBigDim ? Math.min(1, maxSide / Math.max(w, h)) : 1
        const tw = Math.max(1, Math.round(w * scale))
        const th = Math.max(1, Math.round(h * scale))
        const canvas = document.createElement('canvas')
        canvas.width = tw
        canvas.height = th
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('no 2d ctx')
        ctx.drawImage(img, 0, 0, tw, th)
        const outUrl = canvas.toDataURL('image/jpeg', 0.88)
        const parsed = extractB64(outUrl)
        if (!parsed) throw new Error('canvas encode empty')
        resolve(makeItem(parsed, outUrl, (file.name || 'image').replace(/\.[^.]+$/, '') + '.jpg'))
      } catch {
        const parsed = extractB64(rawUrl)
        if (!parsed) return reject(new Error('图片压缩失败'))
        resolve(makeItem(parsed, rawUrl))
      }
    }
    img.onerror = () => {
      const parsed = extractB64(rawUrl)
      if (parsed) resolve(makeItem(parsed, rawUrl))
      else reject(new Error('加载图片失败'))
    }
    img.src = rawUrl
  }))
}

export function truncationNotice(result) {
  const list = result && Array.isArray(result.truncated) ? result.truncated : []
  if (!list.length) return ''
  return '内容太长，以下部分已省略：' + list.map(i => i.field).join(', ')
}

export function colorForRootSession(rootId, selfRootId = '') {
  const id = String(rootId || '').trim()
  if (!id || id === 'lead' || id === 'self' || (selfRootId && id === selfRootId)) {
    return SESSION_PALETTE[0]
  }
  let hash = 0
  for (let i = 0; i < id.length; i += 1) {
    hash = ((hash * 31) + id.charCodeAt(i)) >>> 0
  }
  return SESSION_PALETTE[1 + (hash % (SESSION_PALETTE.length - 1))]
}

function fmtCompactTokens(num) {
  const n = Math.max(0, Math.round(Number(num) || 0))
  if (n >= 1000000) {
    const m = n / 1000000
    return (Math.abs(m - Math.round(m)) < 0.05 ? String(Math.round(m)) : m.toFixed(1).replace(/\.0$/, '')) + 'M'
  }
  if (n >= 100000) return Math.round(n / 1000) + 'K'
  if (n >= 1000) {
    const k = n / 1000
    return (Math.abs(k - Math.round(k)) < 0.05 ? String(Math.round(k)) : k.toFixed(1).replace(/\.0$/, '')) + 'K'
  }
  return String(n)
}

/* ---------------------------------------------------- Spotlight Search */
