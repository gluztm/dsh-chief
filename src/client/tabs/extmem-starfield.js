/**
 * src/client/tabs/extmem-starfield.js — 极简 LivingMemory 风格星云图谱 (2D/3D) 与艾宾浩斯遗忘曲线
 *
 * 【核心职责】
 *   1. 将参谋记忆映射为「主星团 + Satellite 卫星星团」有机宇宙图谱，结合柔和星云光晕与长弧贝塞尔关联线；
 *   2. 画布内嵌极简悬浮控件：居中毛玻璃检索栏、左下角分类图例筛选、右下角缩放/连线/年轮回放、右侧滑出详情抽屉；
 *   3. 保持 2D SVG 与 3D Canvas 双模切换，以及艾宾浩斯遗忘巩固曲线与单点强化。
 *
 * 【边界约定】
 *   - 零外部库、零网络请求；保留 `EXTMEM_*` / `ExtMem*` / `extMem*` 导出与 M10 门禁标记。
 */

import { React, h } from '../react-runtime.js'
import { bi } from '../i18n.js'
import { isHostLightTheme } from '../styles.js'
import { Icon } from '../components/common.js'

export const EXTMEM_CAT_ORDER = ['preference', 'rule', 'decision', 'lesson', 'bond']

export const EXTMEM_CAT_META = {
  preference: { key: 'preference', labelZh: '习惯偏好', labelEn: 'Preference', color: '#8f9df8', glyph: '●' },
  rule: { key: 'rule', labelZh: '规矩底线', labelEn: 'Rule', color: '#e88b6d', glyph: '●' },
  decision: { key: 'decision', labelZh: '项目决策', labelEn: 'Decision', color: '#5eb8e5', glyph: '●' },
  lesson: { key: 'lesson', labelZh: '踩坑教训', labelEn: 'Lesson', color: '#58c9a8', glyph: '●' },
  bond: { key: 'bond', labelZh: '人物约定', labelEn: 'Bond', color: '#e6b865', glyph: '●' },
}

export function extMemCatMeta(cat) {
  return EXTMEM_CAT_META[cat] || EXTMEM_CAT_META.preference
}

function extMemHash32(str) {
  let hval = 2166136261
  const s = String(str || '')
  for (let i = 0; i < s.length; i += 1) {
    hval = Math.imul(hval ^ s.charCodeAt(i), 16777619) >>> 0
  }
  return hval
}

function extMemDateMs(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim())
  if (!m) return 0
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

function extMemVitalityColor(vitality, pinned) {
  if (pinned) return '#e6b865'
  if (vitality >= 72) return '#58c9a8'
  if (vitality >= 40) return '#5eb8e5'
  return '#94a3b8'
}

// Organic galaxy-cluster anchors (center hero cluster + 4 asymmetric satellite clusters)
const EXTMEM_CLUSTER_SLOTS = [
  { x: 324, y: 192, rx: 86, ry: 74, az: 0, el: 0, rad3: 0 },
  { x: 546, y: 184, rx: 64, ry: 58, az: 0.25, el: 0.15, rad3: 122 },
  { x: 128, y: 176, rx: 60, ry: 54, az: 2.95, el: -0.1, rad3: 118 },
  { x: 206, y: 82, rx: 46, ry: 42, az: 2.25, el: 0.65, rad3: 108 },
  { x: 454, y: 288, rx: 48, ry: 42, az: -0.9, el: -0.6, rad3: 110 },
]

export function extMemBuildConstellation(items = [], searchQuery = '', timelineRatio = 1, activeCategoryFilter = 'all') {
  const list = Array.isArray(items) ? items.filter(Boolean) : []
  const cx = 324
  const cy = 192

  const ordered = list.map((it, origIdx) => ({
    item: it,
    origIdx,
    ts: extMemDateMs(it.date || it.lastActive || '') || (Date.now() - origIdx * 86400000),
  })).sort((a, b) => a.ts - b.ts)

  const visibleCount = ordered.length === 0
    ? 0
    : Math.max(1, Math.min(ordered.length, Math.ceil(ordered.length * Math.max(0.05, Math.min(1, timelineRatio)))))
  const visibleIdSet = new Set(ordered.slice(0, visibleCount).map((entry, idx) => entry.item.id || `idx-${entry.origIdx}-${idx}`))

  const q = String(searchQuery || '').trim().toLowerCase()
  const byCatBuckets = new Map()
  for (const cat of EXTMEM_CAT_ORDER) byCatBuckets.set(cat, [])
  list.forEach((it, idx) => {
    const cat = EXTMEM_CAT_META[it.category] ? it.category : 'preference'
    byCatBuckets.get(cat).push({ it, idx })
  })

  // Sort categories by size descending so largest cluster occupies center hero slot
  const rankedCats = [...EXTMEM_CAT_ORDER].sort((a, b) => (byCatBuckets.get(b)?.length || 0) - (byCatBuckets.get(a)?.length || 0))
  const slotByCat = new Map()
  rankedCats.forEach((cat, idx) => slotByCat.set(cat, EXTMEM_CLUSTER_SLOTS[idx] || EXTMEM_CLUSTER_SLOTS[0]))

  const nodes = []
  const nodeById = new Map()
  const clusters = []

  for (const cat of EXTMEM_CAT_ORDER) {
    const bucket = byCatBuckets.get(cat) || []
    const slot = slotByCat.get(cat)
    const meta = extMemCatMeta(cat)
    const haloR = bucket.length > 0 ? Math.min(88, 34 + Math.sqrt(bucket.length) * 18) : 38

    clusters.push({
      cat,
      labelZh: meta.labelZh,
      labelEn: meta.labelEn,
      color: meta.color,
      cx: slot.x,
      cy: slot.y,
      haloR,
      count: bucket.length,
      dimmed: activeCategoryFilter !== 'all' && activeCategoryFilter !== cat,
    })

    const c3x = slot.rad3 * Math.cos(slot.el) * Math.cos(slot.az)
    const c3y = slot.rad3 * Math.sin(slot.el)
    const c3z = slot.rad3 * Math.cos(slot.el) * Math.sin(slot.az)

    const smallBucket = bucket.length >= 2 && bucket.length <= 8
    const spreadRx = smallBucket ? Math.max(haloR, 80) : haloR * 0.78
    const spreadRy = smallBucket ? Math.max(haloR * 0.88, 66) : haloR * 0.72

    bucket.forEach(({ it, idx }, k) => {
      const id = String(it.id || `idx-${idx}`)
      const seed = extMemHash32(id + '::' + (it.text || ''))
      const goldenAngle = smallBucket
        ? (k * (2 * Math.PI)) / bucket.length + ((seed % 60) * Math.PI) / 1800
        : k * 2.399963 + ((seed % 360) * Math.PI) / 1800
      const radialNorm = bucket.length <= 1
        ? 0
        : (smallBucket ? 0.85 : Math.sqrt((k + 0.4) / Math.max(1, bucket.length)))
      const jitterX = smallBucket ? 0 : ((seed & 0xff) / 255 - 0.5) * 10
      const jitterY = smallBucket ? 0 : (((seed >> 8) & 0xff) / 255 - 0.5) * 10
      const x = Math.max(58, Math.min(602, slot.x + Math.cos(goldenAngle) * radialNorm * spreadRx + jitterX))
      const y = Math.max(56, Math.min(330, slot.y + Math.sin(goldenAngle) * radialNorm * spreadRy + jitterY))

      const phi3 = (((seed >> 8) & 0xff) / 255 - 0.5) * 1.3
      const localR3 = 18 + radialNorm * 42
      const x3 = c3x + localR3 * Math.cos(phi3) * Math.cos(goldenAngle)
      const y3 = c3y + localR3 * Math.sin(phi3)
      const z3 = c3z + localR3 * Math.cos(phi3) * Math.sin(goldenAngle)

      const vitality = Number.isFinite(Number(it.vitality)) ? Number(it.vitality) : 85
      const baseR = it.pinned ? 5.6 : (3.1 + (vitality / 100) * 2.2)
      const textLower = String(it.text || it.preview || '').toLowerCase()
      const matchesSearch = !q || textLower.includes(q) || meta.labelZh.includes(q) || meta.labelEn.toLowerCase().includes(q)
      const matchesCat = activeCategoryFilter === 'all' || cat === activeCategoryFilter
      const visible = timelineRatio >= 0.999 || visibleIdSet.has(id)

      const node = {
        id,
        item: it,
        cat,
        color: meta.color,
        glyph: meta.glyph,
        x,
        y,
        x3,
        y3,
        z3,
        r: baseR,
        vitality,
        pinned: Boolean(it.pinned),
        visible,
        dimmed: !matchesSearch || !matchesCat,
        keywords: Array.isArray(it.keywords) ? it.keywords : [],
        shortLabel: String(it.title || it.text || it.preview || '').replace(/\s+/g, ' ').slice(0, 14),
      }
      nodes.push(node)
      nodeById.set(id, node)
    })
  }

  // Label bounding-box aware 2D repulsion so adjacent star labels never overlap
  const estimateLabelHalfWidth = (lbl) => {
    let w = 14
    for (const ch of String(lbl || '')) w += /[\u1100-\u11ff\u2e80-\ua4cf\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/.test(ch) ? 10 : 5.5
    return Math.max(46, Math.min(78, w * 0.5))
  }
  if (nodes.length > 1) {
    for (let iter = 0; iter < 28; iter += 1) {
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const a = nodes[i]
          const b = nodes[j]
          const reqX = estimateLabelHalfWidth(a.shortLabel) + estimateLabelHalfWidth(b.shortLabel) + 10
          const reqY = 38
          let dx = b.x - a.x
          let dy = b.y - a.y
          if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
            dx = ((i % 2) * 2 - 1) * 4
            dy = ((j % 2) * 2 - 1) * 4
          }
          const ox = reqX - Math.abs(dx)
          const oy = reqY - Math.abs(dy)
          if (ox > 0 && oy > 0) {
            // Separate along the axis of least penetration
            if (oy <= ox * 0.45) {
              const stepY = oy * 0.55 * (dy >= 0 ? 1 : -1)
              a.y = Math.max(56, Math.min(330, a.y - stepY))
              b.y = Math.max(56, Math.min(330, b.y + stepY))
            } else {
              const stepX = ox * 0.52 * (dx >= 0 ? 1 : -1)
              const stepY = (dy >= 0 ? 1 : -1) * Math.min(4, oy * 0.12)
              a.x = Math.max(58, Math.min(602, a.x - stepX))
              b.x = Math.max(58, Math.min(602, b.x + stepX))
              a.y = Math.max(56, Math.min(330, a.y - stepY))
              b.y = Math.max(56, Math.min(330, b.y + stepY))
            }
          }
        }
      }
    }
  }

  // Edges: sparse organic intra-cluster threads + curved cross-cluster semantic arcs
  const edges = []
  const edgeKeys = new Set()
  const addEdge = (a, b, kind, label = '') => {
    if (!a || !b || a.id === b.id) return
    const key = a.id < b.id ? `${a.id}::${b.id}` : `${b.id}::${a.id}`
    if (edgeKeys.has(key)) return
    edgeKeys.add(key)
    edges.push({ id: `${kind}-${edges.length}`, a: a.id, b: b.id, kind, label })
  }

  for (let i = 0; i < nodes.length && edges.length < 48; i += 1) {
    const ni = nodes[i]
    if (!ni.keywords.length) continue
    for (let j = i + 1; j < nodes.length && edges.length < 48; j += 1) {
      const nj = nodes[j]
      if (!nj.keywords.length) continue
      const shared = ni.keywords.find(kw => nj.keywords.includes(kw))
      if (shared) addEdge(ni, nj, ni.cat === nj.cat ? 'cluster' : 'keyword', shared)
    }
  }

  // Ensure sparse gentle intra-cluster structure for small buckets & graceful cluster bridges
  const catReps = []
  for (const cat of EXTMEM_CAT_ORDER) {
    const group = nodes.filter(n => n.cat === cat)
    if (!group.length) continue
    catReps.push(group[0])
    for (let i = 0; i < Math.min(group.length - 1, 6); i += 1) {
      addEdge(group[i], group[i + 1], 'cluster')
    }
  }
  for (let i = 1; i < catReps.length; i += 1) {
    addEdge(catReps[0], catReps[i], 'bridge')
  }

  return { cx, cy, nodes, nodeById, edges, clusters, totalCount: list.length, visibleCount }
}

export function ExtMemVitalityRing({ percent = 100, size = 42 }) {
  const p = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)))
  const stroke = 3.8
  const r = (size - stroke * 2) / 2
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - p / 100)
  const color = p >= 72 ? 'var(--dnb-sage, #58c9a8)' : (p >= 40 ? 'var(--dnb-accent, #8f9df8)' : 'var(--dnb-amber, #e6b865)')
  return h(
    'div',
    { className: 'dnb-extmem-ring-wrap', style: { width: size, height: size } },
    h(
      'svg',
      { width: size, height: size, viewBox: `0 0 ${size} ${size}`, style: { transform: 'rotate(-90deg)' } },
      h('circle', {
        cx: size / 2,
        cy: size / 2,
        r,
        fill: 'none',
        stroke: 'var(--dnb-fill, rgba(148,163,184,0.22))',
        strokeWidth: stroke,
      }),
      h('circle', {
        cx: size / 2,
        cy: size / 2,
        r,
        fill: 'none',
        stroke: color,
        strokeWidth: stroke,
        strokeLinecap: 'round',
        strokeDasharray: `${circ.toFixed(1)} ${circ.toFixed(1)}`,
        strokeDashoffset: offset.toFixed(1),
        style: { transition: 'stroke-dashoffset 0.4s ease' },
      }),
    ),
    h('span', { className: 'dnb-extmem-ring-val' }, `${p}%`),
  )
}

export function ExtMemStarCanvas({
  items = [],
  writable = true,
  mode: externalMode,
  onModeChange,
  resetSignal = 0,
  activeCategoryFilter = 'all',
  onCategoryFilterChange,
  sampleNotes = [],
  onQuickAddSample,
  onReinforce,
  onTogglePin,
  onUpdateItem,
  onForget,
}) {
  const [innerMode, setInnerMode] = React.useState('2d')
  const mode = externalMode === '3d' || externalMode === '2d' ? externalMode : innerMode
  const setMode = next => {
    setInnerMode(next)
    if (onModeChange) onModeChange(next)
  }

  const [showLines, setShowLines] = React.useState(true)
  const [timelineOpen, setTimelineOpen] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState('')
  const [timelineRatio, setTimelineRatio] = React.useState(1)
  const [playing, setPlaying] = React.useState(false)
  const [selectedId, setSelectedId] = React.useState('')
  const [hoverId, setHoverId] = React.useState('')
  const [zoom2d, setZoom2d] = React.useState(1)
  const [pan2d, setPan2d] = React.useState({ x: 0, y: 0 })
  const [dragging2d, setDragging2d] = React.useState(false)
  const [dragging3d, setDragging3d] = React.useState(false)
  const [editingText, setEditingText] = React.useState(null)
  const [busyAction, setBusyAction] = React.useState(false)

  const panDragRef = React.useRef(null)
  const canvas3dRef = React.useRef(null)
  const cam3dRef = React.useRef({ yaw: 0.35, pitch: -0.18, zoom: 1.05 })
  const drag3dRef = React.useRef(null)
  const proj3dNodesRef = React.useRef([])
  const raf3dRef = React.useRef(0)

  const graph = React.useMemo(
    () => extMemBuildConstellation(items, searchQuery, timelineRatio, activeCategoryFilter),
    [items, searchQuery, timelineRatio, activeCategoryFilter],
  )

  const catCounts = React.useMemo(() => {
    const map = new Map()
    for (const c of EXTMEM_CAT_ORDER) map.set(c, 0)
    for (const n of graph.nodes) map.set(n.cat, (map.get(n.cat) || 0) + 1)
    return map
  }, [graph.nodes])

  const selectedNode = selectedId ? (graph.nodeById.get(selectedId) || null) : null
  const hoveredNode = hoverId ? (graph.nodeById.get(hoverId) || null) : null
  const focusId = hoverId || selectedId

  React.useEffect(() => {
    setEditingText(null)
  }, [selectedId])

  React.useEffect(() => {
    if (!resetSignal) return
    setZoom2d(1)
    setPan2d({ x: 0, y: 0 })
    setSearchQuery('')
    setTimelineRatio(1)
    setPlaying(false)
    setSelectedId('')
    cam3dRef.current = { yaw: 0.35, pitch: -0.18, zoom: 1.05 }
  }, [resetSignal])

  React.useEffect(() => {
    if (!playing) return undefined
    const timer = setInterval(() => {
      setTimelineRatio(prev => {
        const next = prev + 0.08
        if (next >= 1) {
          setPlaying(false)
          return 1
        }
        return next
      })
    }, 180)
    return () => clearInterval(timer)
  }, [playing])

  const focusNeighbors = React.useMemo(() => {
    const s = new Set()
    if (!focusId) return s
    s.add(focusId)
    for (const e of graph.edges) {
      if (e.a === focusId) s.add(e.b)
      if (e.b === focusId) s.add(e.a)
    }
    return s
  }, [focusId, graph.edges])

  const triggerFocusFirstMatch = () => {
    const hit = graph.nodes.find(n => n.visible && !n.dimmed)
    if (hit) {
      setSelectedId(hit.id)
      setZoom2d(1.25)
      setPan2d({ x: graph.cx - hit.x, y: graph.cy - hit.y })
    }
  }

  // 3D Canvas renderer
  React.useEffect(() => {
    if (mode !== '3d') return undefined
    let active = true
    const render3d = () => {
      if (!active) return
      const canvas = canvas3dRef.current
      if (canvas) {
        const ctx = canvas.getContext('2d')
        if (ctx) {
          const w = canvas.clientWidth || 640
          const hPx = canvas.clientHeight || 420
          const dpr = Math.max(1, Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1))
          if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hPx * dpr)) {
            canvas.width = Math.round(w * dpr)
            canvas.height = Math.round(hPx * dpr)
          }
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          ctx.clearRect(0, 0, w, hPx)

          const light = isHostLightTheme()
          const cam = cam3dRef.current
          if (!drag3dRef.current && !hoverId) cam.yaw += 0.0018
          const cosY = Math.cos(cam.yaw)
          const sinY = Math.sin(cam.yaw)
          const cosP = Math.cos(cam.pitch)
          const sinP = Math.sin(cam.pitch)
          const fov = 440 * cam.zoom

          const project = (px, py, pz) => {
            const x1 = px * cosY - pz * sinY
            const z1 = px * sinY + pz * cosY
            const y2 = py * cosP - z1 * sinP
            const z2 = py * sinP + z1 * cosP
            const dist = 420 + z2
            const scale = fov / Math.max(120, dist)
            return { sx: w / 2 + x1 * scale, sy: hPx / 2 + y2 * scale, scale, depth: z2 }
          }

          const projected = []
          const projById = new Map()
          for (const n of graph.nodes) {
            if (!n.visible) continue
            const p = project(n.x3, n.y3, n.z3)
            const entry = { node: n, ...p, sr: Math.max(2.6, n.r * p.scale * 0.95) }
            projected.push(entry)
            projById.set(n.id, entry)
          }

          if (showLines) {
            ctx.lineWidth = 1
            for (const e of graph.edges) {
              const pa = projById.get(e.a)
              const pb = projById.get(e.b)
              if (!pa || !pb) continue
              const isFocusEdge = focusId && (e.a === focusId || e.b === focusId)
              ctx.beginPath()
              ctx.moveTo(pa.sx, pa.sy)
              const midX = (pa.sx + pb.sx) / 2
              const midY = (pa.sy + pb.sy) / 2 - 22
              ctx.quadraticCurveTo(midX, midY, pb.sx, pb.sy)
              if (isFocusEdge) {
                ctx.strokeStyle = light ? 'rgba(37, 99, 235, 0.72)' : 'rgba(148, 197, 255, 0.78)'
              } else {
                ctx.strokeStyle = light ? 'rgba(100, 116, 139, 0.18)' : 'rgba(148, 163, 184, 0.20)'
              }
              ctx.stroke()
            }
          }

          projected.sort((a, b) => b.depth - a.depth)
          proj3dNodesRef.current = projected
          for (const p of projected) {
            const { node: n, sx, sy, sr } = p
            const isSel = n.id === selectedId
            const isHov = n.id === hoverId
            const isFocus = !focusId || focusNeighbors.has(n.id)
            const alpha = (n.dimmed || !isFocus) ? 0.16 : (0.48 + (n.vitality / 100) * 0.52)

            ctx.save()
            ctx.globalAlpha = alpha * (isSel || isHov ? 0.34 : 0.18)
            ctx.fillStyle = n.color
            ctx.beginPath()
            ctx.arc(sx, sy, sr * 2.4, 0, Math.PI * 2)
            ctx.fill()

            ctx.globalAlpha = alpha
            ctx.fillStyle = n.color
            ctx.beginPath()
            ctx.arc(sx, sy, isSel || isHov ? sr + 1.5 : sr, 0, Math.PI * 2)
            ctx.fill()

            if (n.pinned) {
              ctx.strokeStyle = '#e6b865'
              ctx.lineWidth = 1.2
              ctx.beginPath()
              ctx.arc(sx, sy, sr + 3.2, 0, Math.PI * 2)
              ctx.stroke()
            }
            if (isSel || isHov) {
              ctx.fillStyle = light ? '#0f172a' : '#f1f5f9'
              ctx.font = '600 11px system-ui, -apple-system, sans-serif'
              ctx.textAlign = 'center'
              ctx.fillText(n.shortLabel, sx, sy + sr + 14)
            }
            ctx.restore()
          }
        }
      }
      raf3dRef.current = requestAnimationFrame(render3d)
    }
    raf3dRef.current = requestAnimationFrame(render3d)
    return () => {
      active = false
      if (raf3dRef.current) cancelAnimationFrame(raf3dRef.current)
    }
  }, [mode, graph, showLines, focusId, selectedId, hoverId, focusNeighbors])

  const W = 660
  const H = 390
  const vw = W / zoom2d
  const vh = H / zoom2d
  const vx = graph.cx - vw / 2 - pan2d.x
  const vy = graph.cy - vh / 2 - pan2d.y
  const viewBoxStr = `${vx.toFixed(1)} ${vy.toFixed(1)} ${vw.toFixed(1)} ${vh.toFixed(1)}`

  const resetCamera = () => {
    setZoom2d(1)
    setPan2d({ x: 0, y: 0 })
    cam3dRef.current = { yaw: 0.35, pitch: -0.18, zoom: 1.05 }
  }

  const handle3dPointerDown = e => {
    drag3dRef.current = { x: e.clientX, y: e.clientY, moved: false }
    setDragging3d(true)
  }
  const handle3dPointerMove = e => {
    const rect = e.currentTarget.getBoundingClientRect()
    const lx = e.clientX - rect.left
    const ly = e.clientY - rect.top
    if (drag3dRef.current) {
      const dx = e.clientX - drag3dRef.current.x
      const dy = e.clientY - drag3dRef.current.y
      if (Math.hypot(dx, dy) > 3) drag3dRef.current.moved = true
      drag3dRef.current.x = e.clientX
      drag3dRef.current.y = e.clientY
      cam3dRef.current.yaw += dx * 0.008
      cam3dRef.current.pitch = Math.max(-1.25, Math.min(1.25, cam3dRef.current.pitch + dy * 0.007))
      return
    }
    let best = ''
    let bestDist = 20
    for (const p of proj3dNodesRef.current) {
      const d = Math.hypot(p.sx - lx, p.sy - ly)
      if (d < Math.max(12, p.sr + 6) && d < bestDist) {
        bestDist = d
        best = p.node.id
      }
    }
    if (best !== hoverId) setHoverId(best)
  }
  const handle3dPointerUp = e => {
    const d = drag3dRef.current
    drag3dRef.current = null
    setDragging3d(false)
    if (d && !d.moved) {
      const rect = e.currentTarget.getBoundingClientRect()
      const lx = e.clientX - rect.left
      const ly = e.clientY - rect.top
      let hit = ''
      let bestDist = 22
      for (const p of proj3dNodesRef.current) {
        const dist = Math.hypot(p.sx - lx, p.sy - ly)
        if (dist < Math.max(14, p.sr + 7) && dist < bestDist) {
          bestDist = dist
          hit = p.node.id
        }
      }
      setSelectedId(prev => (prev === hit ? '' : hit))
    }
  }

  return h(
    'div',
    { className: 'dnb-extmem-sky' },

    // Stage Container with Floating LivingMemory Controls
    h(
      'div',
      { className: 'dnb-extmem-sky-stage' },

      // Top-Center Floating Search Capsule
      h(
        'div',
        { className: 'dnb-extmem-float-search', onPointerDown: e => e.stopPropagation() },
        h('input', {
          className: 'dnb-extmem-float-search-input',
          placeholder: bi('搜索人物、主题或记忆…', 'Search stars, rules, notes…'),
          value: searchQuery,
          onChange: e => setSearchQuery(e.target.value),
          onKeyDown: e => {
            if (e.key === 'Enter') triggerFocusFirstMatch()
          },
        }),
        searchQuery
          ? h('button', {
              type: 'button',
              className: 'dnb-extmem-ctrl-btn',
              style: { minWidth: 20, height: 22, padding: '0 4px' },
              onClick: () => setSearchQuery(''),
            }, h(Icon, { name: 'x', size: 11 }))
          : null,
        h('button', {
          type: 'button',
          className: 'dnb-extmem-float-search-btn',
          onClick: triggerFocusFirstMatch,
        }, h(Icon, { name: 'search', size: 11.5 }), bi('检索图谱', 'Locate')),
      ),

      // Main 3D Canvas or 2D SVG Graph
      mode === '3d'
        ? h('canvas', {
            ref: canvas3dRef,
            className: 'dnb-extmem-sky-canvas3d',
            'data-dragging': dragging3d ? '1' : '0',
            onPointerDown: handle3dPointerDown,
            onPointerMove: handle3dPointerMove,
            onPointerUp: handle3dPointerUp,
            onPointerLeave: () => { drag3dRef.current = null; setDragging3d(false); setHoverId('') },
            onWheel: e => {
              e.preventDefault()
              cam3dRef.current.zoom = Math.max(0.65, Math.min(2.2, cam3dRef.current.zoom - e.deltaY * 0.0012))
            },
          })
        : h(
            'svg',
            {
              className: 'dnb-extmem-sky-svg',
              viewBox: viewBoxStr,
              'data-dragging': dragging2d ? '1' : '0',
              onPointerDown: e => {
                if (e.target && e.target.closest && e.target.closest('[data-star-node]')) return
                panDragRef.current = { x: e.clientX, y: e.clientY, moved: false }
                setDragging2d(true)
              },
              onPointerMove: e => {
                if (!panDragRef.current) return
                const dx = e.clientX - panDragRef.current.x
                const dy = e.clientY - panDragRef.current.y
                if (Math.hypot(dx, dy) > 3) panDragRef.current.moved = true
                panDragRef.current.x = e.clientX
                panDragRef.current.y = e.clientY
                setPan2d(prev => ({
                  x: Math.max(-220, Math.min(220, prev.x + dx / zoom2d)),
                  y: Math.max(-140, Math.min(140, prev.y + dy / zoom2d)),
                }))
              },
              onPointerUp: () => {
                const d = panDragRef.current
                panDragRef.current = null
                setDragging2d(false)
                if (d && !d.moved) setSelectedId('')
              },
              onPointerLeave: () => {
                panDragRef.current = null
                setDragging2d(false)
              },
            },
            h(
              'defs',
              null,
              graph.clusters.map(cl =>
                h(
                  'radialGradient',
                  { key: `grad-${cl.cat}`, id: `dnbExtMemNebula-${cl.cat}`, cx: '50%', cy: '50%', r: '50%' },
                  h('stop', { offset: '0%', stopColor: cl.color, stopOpacity: '0.26' }),
                  h('stop', { offset: '58%', stopColor: cl.color, stopOpacity: '0.09' }),
                  h('stop', { offset: '100%', stopColor: cl.color, stopOpacity: '0' }),
                )),
              h(
                'filter',
                { id: 'dnbExtMemStarGlow', x: '-60%', y: '-60%', width: '220%', height: '220%' },
                h('feGaussianBlur', { stdDeviation: '2.2', result: 'blur' }),
                h('feMerge', null, h('feMergeNode', { in: 'blur' }), h('feMergeNode', { in: 'SourceGraphic' })),
              ),
            ),

            // Soft Constellation Cluster Halos (LivingMemory Nebula Style)
            graph.clusters.map(cl => {
              const op = cl.count === 0 ? 0.42 : (cl.dimmed ? 0.2 : 1)
              return h(
                'g',
                { key: `halo-${cl.cat}`, opacity: op, style: { transition: 'opacity 0.2s ease' } },
                h('circle', {
                  cx: cl.cx,
                  cy: cl.cy,
                  r: cl.haloR,
                  fill: `url(#dnbExtMemNebula-${cl.cat})`,
                }),
                h('circle', {
                  cx: cl.cx,
                  cy: cl.cy,
                  r: cl.haloR * 0.94,
                  fill: 'none',
                  stroke: cl.color,
                  strokeOpacity: cl.count > 0 ? 0.14 : 0.09,
                  strokeDasharray: '3 5',
                  strokeWidth: 0.9,
                }),
              )
            }),

            // Curved Semantic & Cluster Edges
            showLines
              ? graph.edges.map((e, idx) => {
                  const na = graph.nodeById.get(e.a)
                  const nb = graph.nodeById.get(e.b)
                  if (!na || !nb || !na.visible || !nb.visible) return null
                  const isFocusEdge = focusId && (e.a === focusId || e.b === focusId)
                  const dx = nb.x - na.x
                  const dy = nb.y - na.y
                  const bend = (idx % 2 === 0 ? 1 : -1) * (e.kind === 'bridge' || e.kind === 'keyword' ? 0.24 : 0.14)
                  const mx = (na.x + nb.x) / 2 - dy * bend
                  const my = (na.y + nb.y) / 2 + dx * bend
                  const stroke = isFocusEdge
                    ? 'var(--dnb-accent, #60a5fa)'
                    : (e.kind === 'keyword' ? 'rgba(230, 184, 101, 0.55)' : 'rgba(148, 163, 184, 0.34)')
                  const op = focusId
                    ? (isFocusEdge ? 0.88 : 0.08)
                    : (e.kind === 'bridge' ? 0.28 : (e.kind === 'keyword' ? 0.48 : 0.22))
                  return h('path', {
                    key: e.id,
                    d: `M ${na.x.toFixed(1)} ${na.y.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${nb.x.toFixed(1)} ${nb.y.toFixed(1)}`,
                    fill: 'none',
                    stroke,
                    strokeWidth: isFocusEdge ? 1.6 : 0.95,
                    opacity: op,
                  })
                })
              : null,

            // Memory Star Nodes
            graph.nodes.map(n => {
              if (!n.visible) return null
              const isSelected = n.id === selectedId
              const isHovered = n.id === hoverId
              const isFocused = !focusId || focusNeighbors.has(n.id)
              const vitOp = 0.42 + (n.vitality / 100) * 0.58
              const nodeOp = (n.dimmed || !isFocused) ? 0.15 : vitOp
              const showLabel = isSelected || isHovered || (!n.dimmed && isFocused && graph.nodes.length <= 16)

              return h(
                'g',
                {
                  key: n.id,
                  'data-star-node': '1',
                  style: { cursor: 'pointer', transition: 'opacity 0.16s ease' },
                  opacity: nodeOp,
                  onMouseEnter: () => setHoverId(n.id),
                  onMouseLeave: () => setHoverId(prev => (prev === n.id ? '' : prev)),
                  onClick: e => {
                    e.stopPropagation()
                    setSelectedId(prev => (prev === n.id ? '' : n.id))
                  },
                },
                h('circle', {
                  cx: n.x,
                  cy: n.y,
                  r: n.r * (isSelected || isHovered ? 2.8 : 2.1),
                  fill: n.color,
                  opacity: isSelected || isHovered ? 0.34 : 0.16,
                }),
                n.pinned
                  ? h('circle', {
                      cx: n.x,
                      cy: n.y,
                      r: n.r + 3.0,
                      fill: 'none',
                      stroke: '#e6b865',
                      strokeWidth: 1.15,
                    })
                  : null,
                h('circle', {
                  cx: n.x,
                  cy: n.y,
                  r: isSelected || isHovered ? n.r + 1.5 : n.r,
                  fill: n.color,
                  filter: (n.vitality >= 72 || isSelected || isHovered) ? 'url(#dnbExtMemStarGlow)' : undefined,
                  stroke: isSelected ? '#ffffff' : 'rgba(255,255,255,0.45)',
                  strokeWidth: isSelected ? 1.5 : 0.65,
                }),
                showLabel
                  ? h('text', {
                      x: n.x,
                      y: n.y + n.r + 12,
                      textAnchor: 'middle',
                      fontSize: isSelected || isHovered ? 10.5 : 9.2,
                      fontWeight: isSelected || isHovered ? 600 : 450,
                      fill: 'var(--dnb-text-2, #cbd5e1)',
                    }, n.shortLabel)
                  : null,
              )
            }),
          ),

      // Empty State Frosted Guide Card (Preserves crisp sample onboarding)
      graph.nodes.length === 0
        ? h(
            'div',
            { className: 'dnb-extmem-empty-float', onPointerDown: e => e.stopPropagation() },
            h('div', { style: { fontSize: 12.5, fontWeight: 600, color: 'var(--dnb-text, #f1f5f9)' } },
              bi('星图尚在等待第一束光', 'Memory galaxy awaits its first star')),
            h('div', { style: { fontSize: 11, color: 'var(--dnb-text-3, #94a3b8)', lineHeight: 1.45 } },
              bi('点下方任一示例，或在右上角点「记一条」写下你的习惯与规矩。', 'Pick a starter below or click Add Note to light your first cluster.')),
            sampleNotes.length > 0
              ? h(
                  'div',
                  { style: { display: 'flex', flexWrap: 'wrap', gap: 5, justifyContent: 'center', marginTop: 2 } },
                  sampleNotes.map((sample, idx) =>
                    h('button', {
                      key: idx,
                      type: 'button',
                      className: 'dnb-mini-btn',
                      style: { fontSize: 10.5, textAlign: 'left' },
                      onClick: () => onQuickAddSample && onQuickAddSample(sample),
                    }, `+ ${String(sample).slice(0, 22)}${String(sample).length > 22 ? '…' : ''}`)),
                )
              : null,
          )
        : null,

      // Lightweight Hover Tooltip
      hoveredNode
        ? h(
            'div',
            { className: 'dnb-extmem-sky-tooltip' },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 } },
              h('span', { style: { width: 6, height: 6, borderRadius: '50%', background: hoveredNode.color } }),
              h('span', { style: { fontWeight: 600 } }, bi(extMemCatMeta(hoveredNode.cat).labelZh, extMemCatMeta(hoveredNode.cat).labelEn)),
              h('span', { style: { opacity: 0.72 } }, `${hoveredNode.vitality}%`),
              hoveredNode.pinned ? h('span', { style: { color: '#e6b865' } }, bi('常驻', 'Pinned')) : null,
            ),
            h('div', null, hoveredNode.item.text || hoveredNode.item.preview),
          )
        : null,

      // Bottom-Left Floating Legend Pill
      h(
        'div',
        { className: 'dnb-extmem-float-legend', onPointerDown: e => e.stopPropagation() },
        EXTMEM_CAT_ORDER.map(cat => {
          const m = extMemCatMeta(cat)
          const active = activeCategoryFilter === cat
          const cnt = catCounts.get(cat) || 0
          return h('button', {
            key: cat,
            type: 'button',
            className: 'dnb-extmem-legend-chip',
            'data-active': active ? '1' : '0',
            onClick: () => onCategoryFilterChange && onCategoryFilterChange(active ? 'all' : cat),
          },
          h('span', { style: { width: 6, height: 6, borderRadius: '50%', background: m.color, flexShrink: 0 } }),
          `${bi(m.labelZh, m.labelEn)}${cnt > 0 ? `: ${cnt}` : ''}`)
        }),
      ),

      // Bottom-Right Floating Compact Controls (Timeline + Links + Zoom)
      h(
        'div',
        { className: 'dnb-extmem-float-controls', onPointerDown: e => e.stopPropagation() },
        timelineOpen && graph.totalCount >= 2
          ? h(
              'div',
              { className: 'dnb-extmem-timeline-pop' },
              h('button', {
                type: 'button',
                className: 'dnb-extmem-ctrl-btn',
                onClick: () => {
                  if (playing) setPlaying(false)
                  else {
                    if (timelineRatio >= 0.99) setTimelineRatio(0.15)
                    setPlaying(true)
                  }
                },
              }, h(Icon, { name: playing ? 'stop' : 'play', size: 10.5 })),
              h('input', {
                type: 'range',
                min: 0.1,
                max: 1,
                step: 0.05,
                value: timelineRatio,
                className: 'dnb-extmem-timeline-slider',
                onChange: e => {
                  setPlaying(false)
                  setTimelineRatio(Number(e.target.value))
                },
              }),
              h('span', { style: { fontVariantNumeric: 'tabular-nums', minWidth: 28, textAlign: 'right' } }, `${graph.visibleCount}/${graph.totalCount}`),
            )
          : null,
        h(
          'div',
          { className: 'dnb-extmem-ctrl-bar' },
          onModeChange
            ? null
            : h('button', {
                type: 'button',
                className: 'dnb-extmem-ctrl-btn',
                'data-active': mode === '3d' ? '1' : '0',
                onClick: () => setMode(mode === '2d' ? '3d' : '2d'),
              }, mode === '2d' ? '2D' : '3D'),
          graph.totalCount >= 2
            ? h('button', {
                type: 'button',
                className: 'dnb-extmem-ctrl-btn',
                'data-active': timelineOpen ? '1' : '0',
                title: bi('时间年轮回放', 'Timeline replay'),
                onClick: () => setTimelineOpen(v => !v),
              }, bi('年轮', 'Replay'))
            : null,
          h('button', {
            type: 'button',
            className: 'dnb-extmem-ctrl-btn',
            'data-active': showLines ? '1' : '0',
            onClick: () => setShowLines(v => !v),
          }, bi('连线', 'Links')),
          mode === '2d'
            ? h(
                React.Fragment,
                null,
                h('button', {
                  type: 'button',
                  className: 'dnb-extmem-ctrl-btn',
                  title: bi('放大', 'Zoom in'),
                  onClick: () => setZoom2d(z => Math.min(2.4, Number((z + 0.2).toFixed(2)))),
                }, '+'),
                h('button', {
                  type: 'button',
                  className: 'dnb-extmem-ctrl-btn',
                  title: bi('缩小', 'Zoom out'),
                  onClick: () => setZoom2d(z => Math.max(0.7, Number((z - 0.2).toFixed(2)))),
                }, '−'),
              )
            : null,
          h('button', {
            type: 'button',
            className: 'dnb-extmem-ctrl-btn',
            title: bi('重置视角', 'Reset'),
            onClick: resetCamera,
          }, h(Icon, { name: 'refresh', size: 11 })),
        ),
      ),

      // Selected Star Floating Inspector Overlay (or below stage on narrow sidebars)
      selectedNode
        ? h(
            'div',
            { className: 'dnb-extmem-inspector dnb-extmem-inspector-float', onPointerDown: e => e.stopPropagation() },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 } },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 } },
                h('span', {
                  className: 'dnb-extmem-cat-pill',
                  'data-active': '1',
                  style: { '--cat-color': selectedNode.color, cursor: 'default', fontSize: 10.5 },
                },
                h('span', { className: 'dnb-extmem-cat-dot' }),
                bi(extMemCatMeta(selectedNode.cat).labelZh, extMemCatMeta(selectedNode.cat).labelEn)),
                h('span', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', fontVariantNumeric: 'tabular-nums' } },
                  selectedNode.pinned ? bi('常驻', 'Pinned') : `${selectedNode.vitality}%`),
              ),
              h('button', {
                type: 'button',
                className: 'dnb-extmem-ctrl-btn',
                style: { color: 'var(--dnb-text-3)' },
                onClick: () => setSelectedId(''),
              }, h(Icon, { name: 'x', size: 12 })),
            ),

            h('div', { className: 'dnb-extmem-vitalbar' },
              h('div', {
                className: 'dnb-extmem-vitalfill',
                style: {
                  width: `${selectedNode.vitality}%`,
                  background: extMemVitalityColor(selectedNode.vitality, selectedNode.pinned),
                },
              }),
            ),

            editingText !== null
              ? h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                  h('textarea', {
                    className: 'dnb-input',
                    rows: 3,
                    style: { width: '100%', padding: '7px 9px', fontSize: 11.5, lineHeight: 1.45, boxSizing: 'border-box' },
                    value: editingText,
                    onChange: e => setEditingText(e.target.value),
                  }),
                  h(
                    'div',
                    { style: { display: 'flex', gap: 6, justifyContent: 'flex-end' } },
                    h('button', {
                      type: 'button',
                      className: 'dnb-mini-btn',
                      onClick: () => setEditingText(null),
                    }, bi('取消', 'Cancel')),
                    h('button', {
                      type: 'button',
                      className: 'dnb-primary-btn',
                      style: { height: 26, padding: '0 10px', fontSize: 11 },
                      disabled: busyAction || !editingText.trim(),
                      onClick: async () => {
                        if (!onUpdateItem) return
                        setBusyAction(true)
                        try {
                          await onUpdateItem({ id: selectedNode.id, text: editingText.trim() })
                          setEditingText(null)
                        } finally {
                          setBusyAction(false)
                        }
                      },
                    }, bi('保存', 'Save')),
                  ),
                )
              : h('div', { style: { fontSize: 12, lineHeight: 1.55, color: 'var(--dnb-text)', wordBreak: 'break-word' } },
                  selectedNode.item.text || selectedNode.item.preview),

            selectedNode.item.date || selectedNode.item.hits > 0
              ? h('div', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', display: 'flex', gap: 8 } },
                  selectedNode.item.date ? h('span', null, selectedNode.item.date) : null,
                  selectedNode.item.hits > 0 ? h('span', null, bi(`激活 ${selectedNode.item.hits} 次`, `${selectedNode.item.hits} recalls`)) : null)
              : null,

            writable && selectedNode.id
              ? h(
                  'div',
                  { className: 'dnb-extmem-cat-pills' },
                  EXTMEM_CAT_ORDER.map(cat => {
                    const m = extMemCatMeta(cat)
                    return h('button', {
                      key: cat,
                      type: 'button',
                      className: 'dnb-extmem-cat-pill',
                      style: { '--cat-color': m.color, fontSize: 10, padding: '2px 7px' },
                      'data-active': selectedNode.cat === cat ? '1' : '0',
                      disabled: busyAction,
                      onClick: async () => {
                        if (!onUpdateItem || selectedNode.cat === cat) return
                        setBusyAction(true)
                        try { await onUpdateItem({ id: selectedNode.id, category: cat }) } finally { setBusyAction(false) }
                      },
                    }, h('span', { className: 'dnb-extmem-cat-dot' }), bi(m.labelZh, m.labelEn))
                  }),
                )
              : null,

            focusNeighbors.size > 1
              ? h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' } },
                  h('span', { style: { fontSize: 10, color: 'var(--dnb-text-3)' } }, bi('关联：', 'Linked:')),
                  [...focusNeighbors].filter(nid => nid !== selectedNode.id).slice(0, 3).map(nid => {
                    const nb = graph.nodeById.get(nid)
                    if (!nb) return null
                    return h('button', {
                      key: nid,
                      type: 'button',
                      className: 'dnb-mini-btn',
                      style: { fontSize: 10, padding: '2px 6px' },
                      onClick: () => setSelectedId(nid),
                    }, nb.shortLabel)
                  }),
                )
              : null,

            writable && selectedNode.id
              ? h(
                  'div',
                  { style: { display: 'flex', gap: 5, flexWrap: 'wrap', paddingTop: 6, marginTop: 'auto', borderTop: '1px solid var(--dnb-border)' } },
                  h('button', {
                    type: 'button',
                    className: 'dnb-mini-btn',
                    'data-tone': 'accent',
                    disabled: busyAction,
                    onClick: async () => {
                      if (!onReinforce) return
                      setBusyAction(true)
                      try { await onReinforce(selectedNode.id) } finally { setBusyAction(false) }
                    },
                  }, h(Icon, { name: 'bolt', size: 11 }), bi('强化', 'Boost')),
                  h('button', {
                    type: 'button',
                    className: 'dnb-mini-btn',
                    'data-tone': selectedNode.pinned ? 'amber' : undefined,
                    disabled: busyAction,
                    onClick: async () => {
                      if (!onTogglePin) return
                      setBusyAction(true)
                      try { await onTogglePin(selectedNode.id, !selectedNode.pinned) } finally { setBusyAction(false) }
                    },
                  }, h(Icon, { name: 'pin', size: 11 }), selectedNode.pinned ? bi('取消', 'Unpin') : bi('常驻', 'Pin')),
                  h('button', {
                    type: 'button',
                    className: 'dnb-mini-btn',
                    disabled: busyAction,
                    onClick: () => setEditingText(selectedNode.item.text || selectedNode.item.preview || ''),
                  }, h(Icon, { name: 'edit', size: 11 })),
                  h('button', {
                    type: 'button',
                    className: 'dnb-mini-btn',
                    style: { marginLeft: 'auto', color: 'var(--dnb-coral, #f28b88)' },
                    disabled: busyAction,
                    onClick: async () => {
                      if (!onForget) return
                      setBusyAction(true)
                      try {
                        await onForget(selectedNode.id)
                        setSelectedId('')
                      } finally {
                        setBusyAction(false)
                      }
                    },
                  }, h(Icon, { name: 'trash', size: 11 })),
                )
              : null,
          )
        : null,
    ),
  )
}

export function ExtMemDecayChart({ items = [], halfLifeDays = 21, onReinforce }) {
  const [pickedItem, setPickedItem] = React.useState(null)
  const W = 540
  const H = 196
  const padL = 36
  const padR = 16
  const padT = 18
  const padB = 28
  const plotW = W - padL - padR
  const plotH = H - padT - padB
  const maxDays = 60

  const xForDay = d => padL + (Math.max(0, Math.min(maxDays, d)) / maxDays) * plotW
  const yForPct = p => padT + (1 - Math.max(0, Math.min(100, p)) / 100) * plotH

  const { naturalPath, boostedPath, boostedArea } = React.useMemo(() => {
    const natPts = []
    const bstPts = []
    for (let d = 0; d <= maxDays; d += 2) {
      const rNat = Math.max(12, Math.round(Math.exp((-d * Math.LN2) / halfLifeDays) * 100))
      const rBst = Math.max(12, Math.round(Math.exp((-d * Math.LN2) / (halfLifeDays * 1.9)) * 100))
      natPts.push(`${xForDay(d).toFixed(1)},${yForPct(rNat).toFixed(1)}`)
      bstPts.push(`${xForDay(d).toFixed(1)},${yForPct(rBst).toFixed(1)}`)
    }
    const nPath = `M ${natPts.join(' L ')}`
    const bPath = `M ${bstPts.join(' L ')}`
    const bArea = `${bPath} L ${xForDay(maxDays).toFixed(1)},${yForPct(0).toFixed(1)} L ${xForDay(0).toFixed(1)},${yForPct(0).toFixed(1)} Z`
    return { naturalPath: nPath, boostedPath: bPath, boostedArea: bArea }
  }, [halfLifeDays])

  const plottedItems = (Array.isArray(items) ? items : []).slice(0, 24)

  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
    h(
      'svg',
      { viewBox: `0 0 ${W} ${H}`, style: { width: '100%', height: 'auto', display: 'block', overflow: 'visible' } },
      h(
        'defs',
        null,
        h(
          'linearGradient',
          { id: 'dnbExtMemCurveFill', x1: '0%', y1: '0%', x2: '0%', y2: '100%' },
          h('stop', { offset: '0%', stopColor: '#8f9df8', stopOpacity: '0.24' }),
          h('stop', { offset: '100%', stopColor: '#8f9df8', stopOpacity: '0.02' }),
        ),
      ),

      [100, 72, 40, 12].map(pct =>
        h(
          'g',
          { key: pct },
          h('line', {
            x1: padL,
            y1: yForPct(pct),
            x2: W - padR,
            y2: yForPct(pct),
            stroke: pct === 40 ? 'rgba(230,184,101,0.34)' : 'var(--dnb-border, rgba(148,163,184,0.18))',
            strokeDasharray: pct === 100 ? undefined : '3 4',
            strokeWidth: 1,
          }),
          h('text', {
            x: padL - 6,
            y: yForPct(pct) + 3.5,
            textAnchor: 'end',
            fontSize: 9.5,
            fill: 'var(--dnb-text-3, #94a3b8)',
          }, `${pct}%`),
        )),

      [0, 15, 30, 45, 60].map(day =>
        h('text', {
          key: day,
          x: xForDay(day),
          y: H - 8,
          textAnchor: 'middle',
          fontSize: 9.5,
          fill: 'var(--dnb-text-3, #94a3b8)',
        }, day === 0 ? bi('今天', 'Today') : `${day}${bi('天', 'd')}`)),

      h('path', { d: boostedArea, fill: 'url(#dnbExtMemCurveFill)' }),
      h('path', { d: boostedPath, fill: 'none', stroke: '#8f9df8', strokeWidth: 2, strokeLinecap: 'round' }),
      h('path', { d: naturalPath, fill: 'none', stroke: '#5eb8e5', strokeWidth: 1.5, strokeDasharray: '5 4', opacity: 0.78 }),

      plottedItems.map((it, idx) => {
        const meta = extMemCatMeta(it.category)
        const d = Math.min(maxDays, Math.max(0, Number(it.daysSince) || 0))
        const px = xForDay(d)
        const py = yForPct(Number(it.vitality) || 80)
        const isSel = pickedItem && pickedItem.id === it.id
        return h(
          'g',
          {
            key: it.id || idx,
            style: { cursor: 'pointer' },
            onClick: () => setPickedItem(prev => (prev && prev.id === it.id ? null : it)),
          },
          it.pinned
            ? h('circle', { cx: px, cy: py, r: 7.2, fill: 'none', stroke: '#e6b865', strokeWidth: 1.3 })
            : null,
          h('circle', {
            cx: px,
            cy: py,
            r: isSel ? 5.8 : 4.2,
            fill: meta.color,
            stroke: isSel ? '#ffffff' : 'rgba(255,255,255,0.55)',
            strokeWidth: isSel ? 1.6 : 0.8,
          }),
        )
      }),
    ),

    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', fontSize: 10.5, color: 'var(--dnb-text-3)' } },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
        h('span', null, h('span', { style: { color: '#5eb8e5' } }, '┈ '), bi(`自然遗忘（半衰期 ${halfLifeDays} 天）`, `Natural (H=${halfLifeDays}d)`)),
        h('span', null, h('span', { style: { color: '#8f9df8' } }, '━ '), bi('多次召回巩固曲线', 'Reinforced recall')),
      ),
      h('span', null, bi('点击散点查看或强化记忆', 'Click any dot to inspect')),
    ),

    pickedItem
      ? h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              padding: '8px 10px',
              borderRadius: 9,
              border: '1px solid var(--dnb-border)',
              background: 'var(--dnb-surface-sub)',
              fontSize: 11.5,
            },
          },
          h('div', { style: { flex: 1, minWidth: 0 } },
            h('div', { style: { fontWeight: 550, color: 'var(--dnb-text)', wordBreak: 'break-word' } }, pickedItem.text || pickedItem.preview),
            h('div', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', marginTop: 2 } },
              `${bi('当前活力', 'Vitality')} ${pickedItem.vitality}% · ${pickedItem.pinned ? bi('常驻不衰减', 'Pinned') : bi(`距上次活跃 ${pickedItem.daysSince || 0} 天`, `${pickedItem.daysSince || 0}d idle`)}`),
          ),
          !pickedItem.pinned && onReinforce
            ? h('button', {
                type: 'button',
                className: 'dnb-mini-btn',
                'data-tone': 'accent',
                onClick: () => {
                  void onReinforce(pickedItem.id)
                  setPickedItem(null)
                },
              }, h(Icon, { name: 'bolt', size: 11 }), bi('立即巩固', 'Boost'))
            : null,
        )
      : null,
  )
}
