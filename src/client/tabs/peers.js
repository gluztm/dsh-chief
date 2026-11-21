/**
 * tabs/peers.js
 *
 * Subagent and cross-session collaboration tab.
 */

import { React, h } from '../react-runtime.js'
import { SESSION_PALETTE } from '../constants.js'
import { bi } from '../i18n.js'
import { patch, focusSecInput, openSubagentChat } from '../store.js'
import {
  clampTitle,
  shortSession,
  relativeTimeLabel,
  isInternalProbeName,
  colorForRootSession,
} from '../utils.js'
import {
  call,
  loadChiefView,
  requestTogglePeerLink,
  toggleBubbleHarness,
  toggleBubbleLock,
  emergencyStopBubble,
  dispatchBubbleHarness,
} from '../api.js'
import { Icon, Switch, AccCard } from '../components/common.js'

function hashStrSeed(str) {
  let hVal = 2166136261
  const s = String(str || '')
  for (let i = 0; i < s.length; i += 1) {
    hVal ^= s.charCodeAt(i)
    hVal = Math.imul(hVal, 16777619)
  }
  return (hVal >>> 0) % 10000
}

function clampNum(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v)
}

function computeTankGeometry(width, height, hasOutside) {
  const W = Math.max(280, Number(width) || 540)
  const H = Math.max(280, Number(height) || 326)
  const cx = hasOutside ? Math.round(W * 0.35) : Math.round(W * 0.5)
  const cy = Math.round(H * 0.5)
  const R = hasOutside
    ? Math.max(88, Math.min(H * 0.42, W * 0.29))
    : Math.max(106, Math.min(H * 0.44, W * 0.40))
  return { W, H, cx, cy, R, hubR: 25, hasOutside }
}

function shortOrbLabel(name, kind) {
  const raw = String(name || '').trim()
  if (!raw) return kind === 'lead' ? '主对话' : '会话'
  if (raw.length <= 7) return raw
  return raw.slice(0, 6) + '…'
}

function harnessInstallCmdFor(provider, itemCmd) {
  if (itemCmd) return itemCmd
  const p = String(provider || '').trim()
  return p ? `dsh plugin --profile desktop add @deepseek-ai/dsh-subagent-${p}` : ''
}

function buildBubbleOrbs({
  peers,
  enrolledHarnesses,
  standbySessions,
  availableHarnesses,
  catalogHarnesses,
  selfRootId,
  otherSessions,
  bubbleLocked,
}) {
  const list = []
  const enrolledProviders = new Set()
  const availableProviders = new Set()
  const catalogByProvider = new Map()
  for (const item of (catalogHarnesses || [])) {
    if (item && item.provider) catalogByProvider.set(item.provider, item)
  }

  for (const peer of peers) {
    if (!peer) continue
    const isLinkedPeer = peer.kind === 'peer-session'
    const peerRootId = isLinkedPeer ? (peer.id || peer.rootSessionId) : (peer.rootSessionId || selfRootId)
    const col = colorForRootSession(peerRootId, selfRootId)
    const linkedSessObj = isLinkedPeer ? otherSessions.find(s => s && s.id === peerRootId) : null
    const subText = peer.taskTitle || peer.progressSummary || (peer.kind === 'lead' ? '当前主指挥核心会话' : '泡内协同成员')
    const r = peer.kind === 'lead' ? 34 : (isLinkedPeer ? 30 : 26)
    const tagText = peer.kind === 'lead' ? '主' : (isLinkedPeer ? '窗' : '子')
    list.push({
      uid: 'peer:' + peer.key,
      zone: 'inside',
      kind: peer.kind,
      label: peer.name || (peer.kind === 'lead' ? '主对话' : shortSession(peer.id)),
      shortLabel: shortOrbLabel(peer.name, peer.kind),
      badge: tagText,
      kindName: peer.kind === 'lead' ? bi('主对话', 'Lead') : (isLinkedPeer ? bi('联动窗口', 'Linked') : bi('子代理', 'Subagent')),
      subText,
      r,
      installed: true,
      installCmd: '',
      running: peer.status === 'running',
      canLeave: isLinkedPeer,
      canJoin: false,
      draggable: !bubbleLocked || isLinkedPeer,
      accent: col,
      raw: peer,
      linkedSessObj,
      peerRootId,
    })
  }
  for (const hItem of enrolledHarnesses) {
    if (!hItem || !hItem.provider) continue
    enrolledProviders.add(hItem.provider)
    const acc = hItem.accent || '#38bdf8'
    const roleText = hItem.role || hItem.roleHint || bi('外部独立执行进程', 'External Harness')
    const catItem = catalogByProvider.get(hItem.provider)
    list.push({
      uid: 'harness:' + hItem.provider,
      zone: 'inside',
      kind: 'harness',
      label: hItem.label || hItem.provider,
      shortLabel: shortOrbLabel(hItem.label || hItem.provider, 'harness'),
      badge: hItem.provider.length <= 7 ? hItem.provider : '外挂',
      kindName: hItem.installed ? 'Harness' : bi('未安装后端', 'Not Installed'),
      subText: `${hItem.provider} · ${roleText}`,
      r: 31,
      installed: Boolean(hItem.installed),
      transport: hItem.transport || '',
      installCmd: hItem.installed ? '' : harnessInstallCmdFor(hItem.provider, catItem && catItem.installCmd),
      running: Boolean(hItem.running),
      canLeave: true,
      canJoin: false,
      draggable: true,
      accent: {
        dot: acc,
        bg: `${acc}26`,
        border: `${acc}7a`,
        text: acc,
      },
      raw: hItem,
    })
  }
  for (const sess of standbySessions) {
    if (!sess || !sess.id) continue
    const col = colorForRootSession(sess.id, selfRootId)
    list.push({
      uid: 'standby-sess:' + sess.id,
      zone: 'outside',
      kind: 'standby-session',
      label: sess.name || shortSession(sess.id),
      shortLabel: shortOrbLabel(sess.name || shortSession(sess.id), 'peer-session'),
      badge: '待命',
      kindName: bi('独立会话', 'Session'),
      subText: sess.objective || sess.progressSummary || bi('未加入水泡的独立会话，可直接抓入水泡', 'Standalone session ready to drag into Bubble'),
      r: 28,
      installed: true,
      installCmd: '',
      running: sess.status === 'running',
      canLeave: false,
      canJoin: true,
      draggable: true,
      accent: col,
      raw: sess,
    })
  }
  for (const hItem of availableHarnesses) {
    if (!hItem || !hItem.provider || enrolledProviders.has(hItem.provider)) continue
    availableProviders.add(hItem.provider)
    const acc = hItem.accent || '#38bdf8'
    const roleText = hItem.roleHint || hItem.role || bi('外部独立执行进程', 'External Harness')
    const isLocalCli = hItem.transport === 'local-cli'
    list.push({
      uid: 'standby-harness:' + hItem.provider,
      zone: 'outside',
      kind: 'standby-harness',
      label: hItem.label || hItem.provider,
      shortLabel: shortOrbLabel(hItem.label || hItem.provider, 'harness'),
      badge: isLocalCli ? bi('本机就绪', 'Local') : bi('就绪', 'Ready'),
      kindName: isLocalCli ? bi('Harness · 本机直连', 'Harness · Local') : bi('Harness · 已安装', 'Harness · Ready'),
      subText: `${hItem.provider} · ${roleText}`,
      r: 27,
      installed: true,
      transport: hItem.transport || '',
      installCmd: '',
      running: false,
      canLeave: false,
      canJoin: true,
      draggable: true,
      accent: {
        dot: acc,
        bg: `${acc}24`,
        border: `${acc}75`,
        text: acc,
      },
      raw: hItem,
    })
  }
  for (const hItem of (catalogHarnesses || [])) {
    if (!hItem || !hItem.provider) continue
    if (enrolledProviders.has(hItem.provider) || availableProviders.has(hItem.provider)) continue
    const acc = hItem.accent || '#38bdf8'
    const roleText = hItem.roleHint || bi('外部 Harness 执行进程', 'External Harness')
    list.push({
      uid: 'standby-harness:' + hItem.provider,
      zone: 'outside',
      kind: 'standby-harness',
      label: hItem.label || hItem.provider,
      shortLabel: shortOrbLabel(hItem.label || hItem.provider, 'harness'),
      badge: bi('未装', 'Setup'),
      kindName: bi('Harness · 待安装', 'Harness · Setup'),
      subText: `${hItem.provider} · ${roleText}`,
      r: 26,
      installed: false,
      installCmd: harnessInstallCmdFor(hItem.provider, hItem.installCmd),
      running: false,
      canLeave: false,
      canJoin: true,
      draggable: true,
      accent: {
        dot: acc,
        bg: `${acc}16`,
        border: `${acc}58`,
        text: acc,
      },
      raw: hItem,
    })
  }
  return list
}

function initialBodyPos(orb, idxInZone, countInZone, geo) {
  const seed = hashStrSeed(orb.uid)
  const baseAngle = ((idxInZone + 0.5) / Math.max(1, countInZone)) * Math.PI * 2 + (seed % 100) * 0.01
  const velAngle = baseAngle + 1.15
  const spd = orb.running ? 32 : 20
  if (orb.zone === 'inside') {
    const orbit = clampNum(geo.R * 0.54, geo.hubR + orb.r + 6, Math.max(geo.hubR + orb.r + 8, geo.R - orb.r - 6))
    return {
      x: geo.cx + Math.cos(baseAngle) * orbit,
      y: geo.cy + Math.sin(baseAngle) * orbit,
      vx: Math.cos(velAngle) * spd,
      vy: Math.sin(velAngle) * spd,
      seed,
    }
  }
  const minX = geo.cx + geo.R + orb.r + 14
  const maxX = Math.max(minX + 12, geo.W - orb.r - 12)
  const colSpan = Math.max(12, maxX - minX)
  const colIdx = idxInZone % 2
  const rowCount = Math.max(1, Math.ceil(countInZone / 2))
  const rowIdx = Math.floor(idxInZone / 2)
  const rx = minX + ((colIdx === 0 ? 0.25 : 0.78) * colSpan)
  const ry = clampNum(((rowIdx + 0.5) / rowCount) * (geo.H - 42) + 21, orb.r + 12, geo.H - orb.r - 12)
  return {
    x: clampNum(rx, minX, geo.W - orb.r - 10),
    y: ry,
    vx: Math.cos(velAngle) * spd,
    vy: Math.sin(velAngle) * spd,
    seed,
  }
}

function syncPhysicsBodies(bodiesMap, orbs, geo) {
  const activeUids = new Set(orbs.map(o => o.uid))
  for (const key of bodiesMap.keys()) {
    if (!activeUids.has(key)) bodiesMap.delete(key)
  }
  const insideOrbs = orbs.filter(o => o.zone === 'inside')
  const outsideOrbs = orbs.filter(o => o.zone === 'outside')
  orbs.forEach((orb) => {
    const prev = bodiesMap.get(orb.uid)
    if (!prev) {
      const idx = orb.zone === 'inside'
        ? insideOrbs.findIndex(o => o.uid === orb.uid)
        : outsideOrbs.findIndex(o => o.uid === orb.uid)
      const cnt = orb.zone === 'inside' ? insideOrbs.length : outsideOrbs.length
      const init = initialBodyPos(orb, idx, cnt, geo)
      bodiesMap.set(orb.uid, {
        ...init,
        uid: orb.uid,
        zone: orb.zone,
        r: orb.r,
        hovered: false,
        running: orb.running,
        color: orb.accent.dot,
      })
      return
    }
    prev.zone = orb.zone
    prev.r = orb.r
    prev.running = orb.running
    prev.color = orb.accent.dot
  })
}

function stepBubblePhysics(bodiesMap, orbs, geo, { dt, drag, paused, locked }) {
  if (paused) return
  const bodies = orbs.map(o => bodiesMap.get(o.uid)).filter(Boolean)
  for (const b of bodies) {
    const isDragged = drag && drag.uid === b.uid && drag.moved
    if (isDragged) {
      let nx = drag.x
      let ny = drag.y
      if (locked) {
        const dx = nx - geo.cx
        const dy = ny - geo.cy
        const dist = Math.hypot(dx, dy) || 0.001
        if (b.zone === 'inside') {
          const maxD = Math.max(8, geo.R - b.r - 2)
          if (dist > maxD) {
            nx = geo.cx + (dx / dist) * (maxD + 4)
            ny = geo.cy + (dy / dist) * (maxD + 4)
          }
        } else {
          const minD = geo.R + b.r + 4
          if (dist < minD) {
            nx = geo.cx + (dx / dist) * Math.max(8, minD - 4)
            ny = geo.cy + (dy / dist) * Math.max(8, minD - 4)
          }
        }
      }
      b.x = clampNum(nx, b.r + 4, geo.W - b.r - 4)
      b.y = clampNum(ny, b.r + 4, geo.H - b.r - 4)
      continue
    }

    if (b.hovered) {
      b.vx *= Math.pow(0.06, dt)
      b.vy *= Math.pow(0.06, dt)
    } else {
      const spd = Math.hypot(b.vx, b.vy) || 0.001
      const minSpd = b.running ? 24 : 15
      const maxSpd = b.running ? 44 : 28
      if (spd > maxSpd * 1.4) {
        const damp = Math.pow(0.22, dt)
        b.vx *= damp
        b.vy *= damp
      } else if (spd > maxSpd) {
        const s = maxSpd / spd
        b.vx *= s
        b.vy *= s
      } else if (spd < minSpd) {
        const s = minSpd / spd
        b.vx *= s
        b.vy *= s
      }
    }

    b.x += b.vx * dt
    b.y += b.vy * dt

    if (b.zone === 'inside') {
      const hdx = b.x - geo.cx
      const hdy = b.y - geo.cy
      const hDist = Math.hypot(hdx, hdy) || 0.001
      const minHubDist = geo.hubR + b.r + 5
      if (hDist < minHubDist) {
        const nx = hdx / hDist
        const ny = hdy / hDist
        b.x = geo.cx + nx * minHubDist
        b.y = geo.cy + ny * minHubDist
        const vn = b.vx * nx + b.vy * ny
        if (vn < 0) {
          b.vx -= 1.9 * vn * nx
          b.vy -= 1.9 * vn * ny
        }
      }

      const dx = b.x - geo.cx
      const dy = b.y - geo.cy
      const dist = Math.hypot(dx, dy) || 0.001
      const maxDist = Math.max(8, geo.R - b.r - 4)
      if (dist > maxDist) {
        const nx = dx / dist
        const ny = dy / dist
        b.x = geo.cx + nx * maxDist
        b.y = geo.cy + ny * maxDist
        const vn = b.vx * nx + b.vy * ny
        if (vn > 0) {
          b.vx -= 1.92 * vn * nx
          b.vy -= 1.92 * vn * ny
        }
      }
    } else {
      const minX = b.r + 8
      const maxX = Math.max(minX + 4, geo.W - b.r - 8)
      const minY = b.r + 8
      const maxY = Math.max(minY + 4, geo.H - b.r - 8)
      if (b.x < minX) { b.x = minX; if (b.vx < 0) b.vx = -b.vx * 0.94 }
      else if (b.x > maxX) { b.x = maxX; if (b.vx > 0) b.vx = -b.vx * 0.94 }
      if (b.y < minY) { b.y = minY; if (b.vy < 0) b.vy = -b.vy * 0.94 }
      else if (b.y > maxY) { b.y = maxY; if (b.vy > 0) b.vy = -b.vy * 0.94 }

      const dx = b.x - geo.cx
      const dy = b.y - geo.cy
      const dist = Math.hypot(dx, dy) || 0.001
      const minOuter = geo.R + b.r + 8
      if (dist < minOuter) {
        const nx = dx / dist
        const ny = dy / dist
        b.x = geo.cx + nx * minOuter
        b.y = geo.cy + ny * minOuter
        const vn = b.vx * nx + b.vy * ny
        if (vn < 0) {
          b.vx -= 1.92 * vn * nx
          b.vy -= 1.92 * vn * ny
        }
      }
    }
  }

  for (let i = 0; i < bodies.length; i += 1) {
    const a = bodies[i]
    for (let j = i + 1; j < bodies.length; j += 1) {
      const b = bodies[j]
      if (a.zone !== b.zone) continue
      const aDragged = drag && drag.uid === a.uid && drag.moved
      const bDragged = drag && drag.uid === b.uid && drag.moved
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.hypot(dx, dy) || 0.001
      const minD = a.r + b.r + 4
      if (dist < minD) {
        const nx = dx / dist
        const ny = dy / dist
        const overlap = minD - dist
        if (aDragged && !bDragged) {
          b.x += nx * overlap
          b.y += ny * overlap
        } else if (bDragged && !aDragged) {
          a.x -= nx * overlap
          a.y -= ny * overlap
        } else {
          a.x -= nx * overlap * 0.5
          a.y -= ny * overlap * 0.5
          b.x += nx * overlap * 0.5
          b.y += ny * overlap * 0.5
        }
        const rvx = b.vx - a.vx
        const rvy = b.vy - a.vy
        const relVel = rvx * nx + rvy * ny
        if (relVel < 0) {
          const impulse = -0.94 * relVel
          if (!aDragged) { a.vx -= impulse * nx; a.vy -= impulse * ny }
          if (!bDragged) { b.vx += impulse * nx; b.vy += impulse * ny }
        }
      }
    }
  }
}

function drawBubbleTankCanvas(ctx, dpr, geo, bodiesMap, orbs, { tNow, locked, isLight }) {
  if (!ctx) return
  ctx.save()
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, geo.W, geo.H)

  if (geo.hasOutside) {
    ctx.save()
    ctx.font = '600 10.5px "Microsoft YaHei UI", sans-serif'
    ctx.fillStyle = isLight ? 'rgba(71, 85, 105, 0.58)' : 'rgba(148, 163, 184, 0.50)'
    ctx.textAlign = 'right'
    ctx.fillText('外围待命域 · 拖入左泡协同', geo.W - 14, 21)
    ctx.restore()
  }

  const grad = ctx.createRadialGradient(
    geo.cx - geo.R * 0.28,
    geo.cy - geo.R * 0.28,
    geo.R * 0.08,
    geo.cx,
    geo.cy,
    geo.R,
  )
  if (locked) {
    grad.addColorStop(0, isLight ? 'rgba(251, 191, 36, 0.14)' : 'rgba(245, 158, 11, 0.12)')
    grad.addColorStop(1, isLight ? 'rgba(217, 119, 6, 0.18)' : 'rgba(245, 158, 11, 0.22)')
  } else {
    grad.addColorStop(0, isLight ? 'rgba(56, 189, 248, 0.11)' : 'rgba(56, 189, 248, 0.13)')
    grad.addColorStop(1, isLight ? 'rgba(16, 185, 129, 0.14)' : 'rgba(56, 189, 248, 0.20)')
  }

  ctx.beginPath()
  ctx.arc(geo.cx, geo.cy, geo.R, 0, Math.PI * 2)
  ctx.fillStyle = grad
  ctx.fill()
  ctx.lineWidth = locked ? 2.2 : 1.7
  ctx.strokeStyle = locked
    ? (isLight ? 'rgba(217, 119, 6, 0.72)' : 'rgba(251, 191, 36, 0.72)')
    : (isLight ? 'rgba(2, 132, 199, 0.54)' : 'rgba(103, 232, 249, 0.52)')
  ctx.stroke()

  if (locked) {
    ctx.save()
    ctx.setLineDash([7, 5])
    ctx.lineWidth = 1.2
    ctx.strokeStyle = isLight ? 'rgba(217, 119, 6, 0.42)' : 'rgba(245, 158, 11, 0.44)'
    ctx.beginPath()
    ctx.arc(geo.cx, geo.cy, geo.R + 5, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  } else {
    ctx.save()
    ctx.beginPath()
    ctx.arc(geo.cx, geo.cy, geo.R - 6, -Math.PI * 0.80, -Math.PI * 0.52)
    ctx.strokeStyle = isLight ? 'rgba(255, 255, 255, 0.72)' : 'rgba(224, 242, 254, 0.36)'
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.stroke()
    ctx.restore()
  }

  for (const orb of orbs) {
    if (orb.zone !== 'inside' || !orb.running) continue
    const b = bodiesMap.get(orb.uid)
    if (!b) continue
    ctx.save()
    ctx.setLineDash([4, 4])
    ctx.lineDashOffset = -(tNow * 24)
    ctx.lineWidth = 1.3
    ctx.strokeStyle = orb.accent.dot
    ctx.globalAlpha = 0.52
    ctx.beginPath()
    ctx.moveTo(geo.cx, geo.cy)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
    ctx.restore()
  }

  ctx.restore()
}

export function PeersTab({ view }) {
  React.useEffect(() => {
    void loadChiefView(false)
  }, [view.sessionId])

  const sec = view.secView || {}
  const selfRootId = view.sessionId || ''
  const rawPeers = Array.isArray(sec.peers) ? sec.peers : []
  const hiddenProbePeers = view.showInternalProbes
    ? []
    : rawPeers.filter(p => p && p.kind === 'subagent' && p.status !== 'running' && isInternalProbeName(p.name || p.key))
  const hiddenProbeSet = new Set(hiddenProbePeers)
  const peers = rawPeers.filter(p => !hiddenProbeSet.has(p))
  const otherSessions = Array.isArray(sec.otherSessions) ? sec.otherSessions : []
  const mailbox = Array.isArray(sec.mailbox) ? sec.mailbox : []

  // Build human-readable session title lookup & color resolver across cluster
  const rootNameMap = new Map()
  if (selfRootId) rootNameMap.set(selfRootId, '主对话')
  for (const p of peers) {
    if (p && p.kind === 'lead') rootNameMap.set(p.rootSessionId || p.id || selfRootId, p.name || '主对话')
    else if (p && p.kind === 'peer-session') rootNameMap.set(p.id || p.rootSessionId, p.name || shortSession(p.id))
  }
  for (const s of otherSessions) {
    if (s && s.id && !rootNameMap.has(s.id)) rootNameMap.set(s.id, s.name || shortSession(s.id))
  }
  const labelForRoot = (rid) => {
    if (!rid || (selfRootId && rid === selfRootId)) return '主对话'
    return clampTitle(rootNameMap.get(rid) || shortSession(rid), 14)
  }

  // Classify and group mailbox messages into clean color-coded drawers
  const mailFilter = view.mailChannelFilter || 'all'
  const openDrawers = (view.mailOpenDrawers && typeof view.mailOpenDrawers === 'object') ? view.mailOpenDrawers : {}
  const drawersMap = new Map()
  const ensureDrawer = (key, meta) => {
    if (!drawersMap.has(key)) drawersMap.set(key, { key, ...meta, items: [] })
    return drawersMap.get(key)
  }

  for (const mail of mailbox) {
    if (!mail) continue
    if (mail.detachedFromCluster) {
      ensureDrawer('detached', {
        kind: 'detached',
        title: bi('已脱离协同历史（已隔离不注入）', 'Detached History (Isolated)'),
        colors: [{ dot: '#8e8e93', bg: 'rgba(142,142,147,0.1)', border: 'rgba(142,142,147,0.3)' }],
        order: 99,
        defaultOpen: false,
      }).items.push(mail)
      continue
    }
    const fromR = String(mail.fromRootId || mail.fromSession || selfRootId || '').trim()
    const toR = String(mail.toRootId || '').trim()
    const participants = Array.isArray(mail.participantRoots)
      ? [...new Set(mail.participantRoots.filter(Boolean).map(String))]
      : []
    const isBroadcast = mail.channelType === 'broadcast' || toR === 'all' || String(mail.toSession || mail.to || '').toLowerCase() === 'all'
    if (isBroadcast) {
      const cols = (participants.length > 0 ? participants : [selfRootId].filter(Boolean))
        .slice(0, 4)
        .map(id => colorForRootSession(id, selfRootId))
      ensureDrawer('broadcast', {
        kind: 'broadcast',
        title: bi('🌐 全网广播 (@全体)', '🌐 Broadcast (@All)'),
        colors: cols.length ? cols : [SESSION_PALETTE[0], SESSION_PALETTE[1]],
        order: 0,
        defaultOpen: true,
      }).items.push(mail)
      continue
    }
    const uniqueRoots = [...new Set([...participants, fromR, (toR && toR !== 'all' ? toR : '')].filter(Boolean))]
    if (mail.channelType === 'multi' || uniqueRoots.length > 2) {
      const sorted = uniqueRoots.slice().sort()
      ensureDrawer('multi:' + sorted.join('|'), {
        kind: 'cross',
        title: `🔀 ${sorted.slice(0, 3).map(labelForRoot).join(' · ')}${sorted.length > 3 ? bi(` 等${sorted.length}窗`, ` +${sorted.length}`) : ''} ${bi('多方协同', 'Group Relay')}`,
        colors: sorted.slice(0, 4).map(id => colorForRootSession(id, selfRootId)),
        order: 1,
        defaultOpen: true,
      }).items.push(mail)
      continue
    }
    if (mail.channelType === 'pair' || (fromR && toR && fromR !== toR && toR !== 'all')) {
      const pair = [fromR || selfRootId, toR || fromR].filter(Boolean).sort()
      if (pair.length >= 2 && pair[0] !== pair[1]) {
        ensureDrawer('pair:' + pair.join('|'), {
          kind: 'cross',
          title: `↔ ${labelForRoot(pair[0])} ↔ ${labelForRoot(pair[1])} ${bi('跨窗传话', 'Cross-Window')}`,
          colors: pair.map(id => colorForRootSession(id, selfRootId)),
          order: 2,
          defaultOpen: true,
        }).items.push(mail)
        continue
      }
    }
    const internalRoot = fromR || (toR && toR !== 'all' ? toR : '') || selfRootId || 'self'
    const col = colorForRootSession(internalRoot, selfRootId)
    ensureDrawer('internal:' + internalRoot, {
      kind: 'internal',
      title: `📁 ${labelForRoot(internalRoot)} ${bi('内部信箱', 'Internal')}`,
      colors: [col],
      order: internalRoot === selfRootId ? 3 : 4,
      defaultOpen: internalRoot === selfRootId,
    }).items.push(mail)
  }

  const drawerList = [...drawersMap.values()]
    .filter(d => mailFilter === 'all' || (mailFilter === 'detached' ? d.kind === 'detached' : d.kind === mailFilter))
    .sort((a, b) => a.order - b.order)

  const hasLinkedNetwork = peers.some(p => p && p.kind === 'peer-session')
  const bubble = (sec.bubble && typeof sec.bubble === 'object') ? sec.bubble : {}
  const bubbleLocked = Boolean(bubble.locked)
  const bubbleAutoLocked = Boolean(bubble.autoLocked)
  const bubbleLockReason = String(bubble.lockReason || '')
  const enrolledHarnesses = Array.isArray(bubble.enrolledHarnesses) ? bubble.enrolledHarnesses : []
  const availableHarnesses = Array.isArray(bubble.availableHarnesses) ? bubble.availableHarnesses : []
  const catalogHarnesses = Array.isArray(bubble.catalogHarnesses) ? bubble.catalogHarnesses : []
  const standbySessions = otherSessions.filter(s => s && !s.linked)
  const totalInBubble = peers.length + enrolledHarnesses.length

  const [confirmStop, setConfirmStop] = React.useState(false)
  const [dispatchTarget, setDispatchTarget] = React.useState('')
  const [dispatchText, setDispatchText] = React.useState('')
  const [showCatalog, setShowCatalog] = React.useState(false)
  const [lockShake, setLockShake] = React.useState(false)
  const [selectedUid, setSelectedUid] = React.useState('')
  const [physicsPaused, setPhysicsPaused] = React.useState(() => {
    try {
      return Boolean(typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    } catch {
      return false
    }
  })

  const tankRef = React.useRef(null)
  const canvasRef = React.useRef(null)
  const bodiesRef = React.useRef(new Map())
  const nodeElsRef = React.useRef(new Map())
  const dragRef = React.useRef(null)
  const tankSizeRef = React.useRef({ w: 540, h: 326 })
  const latestSimRef = React.useRef({ orbs: [], locked: false, paused: false, hasOutside: false, tankHeight: 326 })

  React.useEffect(() => {
    if (!confirmStop) return undefined
    const timer = setTimeout(() => setConfirmStop(false), 4500)
    return () => clearTimeout(timer)
  }, [confirmStop])

  React.useEffect(() => {
    if (!lockShake) return undefined
    const timer = setTimeout(() => setLockShake(false), 520)
    return () => clearTimeout(timer)
  }, [lockShake])

  const orbs = buildBubbleOrbs({
    peers,
    enrolledHarnesses,
    standbySessions,
    availableHarnesses,
    catalogHarnesses,
    selfRootId,
    otherSessions,
    bubbleLocked,
  })
  const hasOutside = orbs.some(o => o.zone === 'outside')
  const tankHeight = orbs.length > 6 ? 350 : 326
  const curW = (tankRef.current && tankRef.current.clientWidth) || tankSizeRef.current.w || 540
  const geoNow = computeTankGeometry(curW, tankHeight, hasOutside)
  syncPhysicsBodies(bodiesRef.current, orbs, geoNow)
  latestSimRef.current = {
    orbs,
    locked: bubbleLocked,
    paused: physicsPaused,
    hasOutside,
    tankHeight,
  }

  React.useEffect(() => {
    if (selectedUid && !orbs.some(o => o.uid === selectedUid)) {
      setSelectedUid('')
    }
  }, [selectedUid, orbs.length])

  React.useEffect(() => {
    const tankEl = tankRef.current
    if (!tankEl) return undefined
    let ro = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver((entries) => {
        for (const ent of entries) {
          const nw = Math.round(ent.contentRect.width || tankEl.clientWidth || 540)
          if (nw > 120) tankSizeRef.current.w = nw
        }
      })
      ro.observe(tankEl)
    }

    let rafId = 0
    let lastTs = performance.now()
    const startTs = lastTs

    const frame = (now) => {
      const dt = Math.min(0.032, Math.max(0.004, (now - lastTs) / 1000))
      lastTs = now
      const tNow = (now - startTs) / 1000
      const sim = latestSimRef.current
      const w = Math.max(280, tankEl.clientWidth || tankSizeRef.current.w || 540)
      tankSizeRef.current.w = w
      const geo = computeTankGeometry(w, sim.tankHeight, sim.hasOutside)

      syncPhysicsBodies(bodiesRef.current, sim.orbs, geo)
      stepBubblePhysics(bodiesRef.current, sim.orbs, geo, {
        dt,
        drag: dragRef.current,
        paused: sim.paused,
        locked: sim.locked,
      })

      for (const orb of sim.orbs) {
        const b = bodiesRef.current.get(orb.uid)
        const el = nodeElsRef.current.get(orb.uid)
        if (!b || !el) continue
        const x0 = b.x - b.r
        const y0 = b.y - b.r
        const isDragging = Boolean(dragRef.current && dragRef.current.uid === orb.uid && dragRef.current.moved)
        el.style.transform = `translate3d(${x0.toFixed(2)}px, ${y0.toFixed(2)}px, 0)`
        el.style.zIndex = isDragging ? '12' : (b.hovered ? '8' : (orb.zone === 'inside' ? '4' : '3'))
      }

      const canvas = canvasRef.current
      if (canvas) {
        const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1)
        const tw = Math.round(geo.W * dpr)
        const th = Math.round(geo.H * dpr)
        if (canvas.width !== tw || canvas.height !== th) {
          canvas.width = tw
          canvas.height = th
          canvas.style.width = geo.W + 'px'
          canvas.style.height = geo.H + 'px'
        }
        const ctx2d = canvas.getContext('2d')
        const rootEl = typeof document !== 'undefined' ? document.documentElement : null
        const themeAttr = rootEl && (rootEl.getAttribute('data-ds-theme-source') || rootEl.getAttribute('data-ds-theme'))
        const isLight = themeAttr === 'light'
        drawBubbleTankCanvas(ctx2d, dpr, geo, bodiesRef.current, sim.orbs, {
          tNow,
          locked: sim.locked,
          isLight,
        })
      }

      rafId = requestAnimationFrame(frame)
    }

    rafId = requestAnimationFrame(frame)
    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      if (ro) ro.disconnect()
    }
  }, [view.peersNetCollapsed])

  const triggerLockedReject = (reasonHint) => {
    setLockShake(true)
    patch({
      notice: reasonHint || bi(
        '🔒 协同水泡工作中已锁死结构，禁止拆解成员；请等待全员收工或点击「⏹ 急停解体」',
        '🔒 Bubble locked while working; wait until settled or click Emergency Stop',
      ),
    })
  }

  const performOrbJoin = (orb) => {
    if (bubbleLocked) {
      triggerLockedReject()
      return
    }
    if (orb.kind === 'standby-session' && orb.raw) {
      requestTogglePeerLink(orb.raw, true)
    } else if (orb.kind === 'standby-harness' && orb.raw) {
      void toggleBubbleHarness(orb.raw.provider, true, {
        label: orb.raw.label,
        role: orb.raw.roleHint || orb.raw.role,
      })
    }
  }

  const performOrbLeave = (orb) => {
    if (bubbleLocked) {
      triggerLockedReject()
      return
    }
    if (orb.kind === 'peer-session') {
      requestTogglePeerLink(orb.linkedSessObj || { id: orb.peerRootId, name: orb.label, linked: true }, false)
    } else if (orb.kind === 'harness' && orb.raw) {
      if (dispatchTarget === orb.raw.provider) setDispatchTarget('')
      void toggleBubbleHarness(orb.raw.provider, false, { label: orb.raw.label })
    }
  }

  const handleOrbPointerDown = (e, orb) => {
    if (e.button !== 0) return
    if (e.target && e.target.closest && e.target.closest('button')) return
    const tankEl = tankRef.current
    if (!tankEl) return
    const b = bodiesRef.current.get(orb.uid)
    if (!b) return
    const rect = tankEl.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    try { e.currentTarget.setPointerCapture?.(e.pointerId) } catch {}
    dragRef.current = {
      uid: orb.uid,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      x: b.x,
      y: b.y,
      ox: b.x - px,
      oy: b.y - py,
      lastX: px,
      lastY: py,
      lastT: performance.now(),
      vx: 0,
      vy: 0,
      moved: false,
    }
  }

  const handleOrbPointerMove = (e, orb) => {
    const d = dragRef.current
    if (!d || d.uid !== orb.uid || d.pointerId !== e.pointerId) return
    const tankEl = tankRef.current
    if (!tankEl) return
    const rect = tankEl.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) >= 6) {
      d.moved = true
    }
    if (!d.moved) return
    const nowT = performance.now()
    const dt = Math.max(0.008, (nowT - d.lastT) / 1000)
    const rawVx = clampNum((px - d.lastX) / dt, -140, 140)
    const rawVy = clampNum((py - d.lastY) / dt, -140, 140)
    d.vx = d.vx * 0.45 + rawVx * 0.55
    d.vy = d.vy * 0.45 + rawVy * 0.55
    d.lastX = px
    d.lastY = py
    d.lastT = nowT
    d.x = px + d.ox
    d.y = py + d.oy
  }

  const handleOrbPointerEnd = (e, orb) => {
    const d = dragRef.current
    if (!d || d.uid !== orb.uid || d.pointerId !== e.pointerId) return
    try { e.currentTarget.releasePointerCapture?.(e.pointerId) } catch {}
    dragRef.current = null
    const b = bodiesRef.current.get(orb.uid)
    if (!d.moved) {
      setSelectedUid(cur => (cur === orb.uid ? '' : orb.uid))
      return
    }
    if (!b) return
    const w = (tankRef.current && tankRef.current.clientWidth) || tankSizeRef.current.w || 540
    const geo = computeTankGeometry(w, tankHeight, hasOutside)
    const dx = b.x - geo.cx
    const dy = b.y - geo.cy
    const dist = Math.hypot(dx, dy) || 0.001

    if (orb.zone === 'outside' && orb.canJoin && dist < geo.R + b.r * 0.2) {
      if (bubbleLocked) {
        const nx = dx / dist
        const ny = dy / dist
        b.x = geo.cx + nx * (geo.R + b.r + 12)
        b.y = geo.cy + ny * (geo.R + b.r + 12)
        b.vx = nx * 42
        b.vy = ny * 42
        triggerLockedReject()
        return
      }
      performOrbJoin(orb)
      return
    }

    if (orb.zone === 'inside' && orb.canLeave && dist > geo.R + b.r * 0.35) {
      if (bubbleLocked) {
        const nx = dx / dist
        const ny = dy / dist
        const pullD = Math.max(geo.hubR + b.r + 6, geo.R - b.r - 8)
        b.x = geo.cx + nx * pullD
        b.y = geo.cy + ny * pullD
        b.vx = -nx * 42
        b.vy = -ny * 42
        triggerLockedReject()
        return
      }
      performOrbLeave(orb)
      return
    }

    b.vx = clampNum(d.vx * 0.35, -36, 36)
    b.vy = clampNum(d.vy * 0.35, -36, 36)
  }

  const selectedOrb = selectedUid ? orbs.find(o => o.uid === selectedUid) || null : null

  const fedOpen = (view.peersFedCollapsed === null || view.peersFedCollapsed === undefined)
    ? otherSessions.length > 0
    : !view.peersFedCollapsed

  return h(
    'div',
    { className: 'dnb-view' },
    // Section 1: Real-Time 2D Physics Water Bubble Arena & External Harness Tank (Experimental)
    h(
      AccCard,
      {
        open: !view.peersNetCollapsed,
        onToggle: () => patch({ peersNetCollapsed: !view.peersNetCollapsed }),
        title: bi('🫧 协同作战水泡（实验）', '🫧 Collab Bubble Squad (Exp)'),
        headTitle: bubbleLocked
          ? bi('编队已锁定：运行期间禁止拆散会话或外部 Harness，仅可通过急停安全解体', 'Locked during work: member removal blocked until done or emergency stop')
          : bi('直接按住水泡中的任意成员泡泡拖入或拖出大水泡，自由漂浮碰撞协同', 'Grab and drag any bubble orb directly into or out of the main Bubble'),
        count: totalInBubble ? String(totalInBubble) : '',
        preview: bubbleLocked
          ? `🔒 ${bubbleLockReason || bi('工作中已锁死', 'Locked while active')}`
          : (peers.length ? peers.slice(0, 3).map(p => p.name).join(' · ') : bi('整备待命中…', 'Ready to form squad…')),
        bodyStyle: { padding: '10px' },
        actions: h(
          React.Fragment,
          null,
          (hiddenProbePeers.length > 0 || (view.showInternalProbes && rawPeers.some(p => p && isInternalProbeName(p.name || p.key))))
            ? h('button', {
                type: 'button',
                className: 'dnb-pill',
                style: { height: 22, fontSize: 10.5, padding: '0 7px', borderStyle: 'dashed' },
                onClick: () => patch({ showInternalProbes: !view.showInternalProbes }),
              }, view.showInternalProbes ? bi('隐藏内部探针', 'Hide Probes') : bi(`内部探针 (${hiddenProbePeers.length})`, `Probes (${hiddenProbePeers.length})`))
            : null,
          peers.length > 1
            ? h('button', {
                type: 'button',
                className: 'dnb-pill dnb-pill-accent',
                style: { height: 22, fontSize: 10.5, padding: '0 8px' },
                onClick: () => {
                  patch({ secTarget: 'all', secMode: 'steer', notice: bi('已选择向全体成员广播递话', 'Target set to broadcast @All') })
                  focusSecInput()
                },
              }, bi('@全体广播', '@Broadcast'))
            : null,
        ),
      },
      h(
        'div',
        { className: 'dnb-bubble-stage' },
        // Status, Physics Motion & Structural Lock Control Strip
        h(
          'div',
          { className: 'dnb-bubble-bar' },
          h(
            'div',
            { className: 'dnb-bubble-status', 'data-locked': bubbleLocked ? '1' : '0' },
            h('span', { className: 'dnb-bubble-status-dot' }),
            h(
              'span',
              { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
              bubbleLocked
                ? bi(`🔒 工作中已锁死${bubbleLockReason ? ' · ' + bubbleLockReason : ''}`, `🔒 Locked${bubbleLockReason ? ' · ' + bubbleLockReason : ''}`)
                : bi('🫧 物理水泡域 · 抓泡泡拖入/拖出', '🫧 Physics Tank · Grab & drag orbs'),
            ),
          ),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 } },
            h('button', {
              type: 'button',
              className: 'dnb-pill',
              'data-active': physicsPaused ? '0' : '1',
              style: { height: 22, padding: '0 7px', fontSize: 10.5 },
              title: physicsPaused ? bi('恢复泡泡自由漂浮与弹性碰撞', 'Resume bubble floating physics') : bi('暂停漂浮方便逐个静态点选', 'Pause floating motion'),
              onClick: () => setPhysicsPaused(v => !v),
            }, physicsPaused ? bi('⏸ 静止', '⏸ Paused') : bi('🫧 漂浮中', '🫧 Floating')),
            h('button', {
              type: 'button',
              className: 'dnb-pill',
              disabled: bubbleAutoLocked && bubbleLocked,
              'data-active': bubble.manualLocked ? '1' : '0',
              style: { height: 22, padding: '0 8px', fontSize: 10.5 },
              title: (bubbleAutoLocked && bubbleLocked)
                ? bi('有成员运行中，自动锁生效中；请先急停或等完工后再解锁', 'Auto-locked by active workers; finish or Emergency Stop first')
                : (bubbleLocked ? bi('点击解除手动编队锁', 'Unlock manual squad lock') : bi('开干前手动锁死当前编队结构，防误拆', 'Manually lock squad structure before starting work')),
              onClick: () => {
                if (bubbleAutoLocked && bubbleLocked) {
                  triggerLockedReject()
                  return
                }
                void toggleBubbleLock(!bubble.manualLocked)
              },
            }, (bubbleAutoLocked && bubbleLocked)
              ? bi('🔒 自动锁定中', '🔒 Auto-Locked')
              : (bubble.manualLocked ? bi('🔓 解锁', '🔓 Unlock') : bi('🔒 锁死编队', '🔒 Lock'))),
            bubbleLocked
              ? h('button', {
                  type: 'button',
                  className: 'dnb-pill dnb-bubble-estop-btn',
                  'data-confirm': confirmStop ? '1' : '0',
                  style: { height: 22, padding: '0 8px', fontSize: 10.5 },
                  title: bi('安全急停所有在途子代理、跨窗与外部 Harness，并解锁水泡', 'Interrupt all running workers & Harnesses and unlock Bubble'),
                  onClick: () => {
                    if (!confirmStop) {
                      setConfirmStop(true)
                      return
                    }
                    setConfirmStop(false)
                    setDispatchTarget('')
                    void emergencyStopBubble()
                  },
                }, confirmStop ? bi('确认急停全员?', 'Confirm Stop?') : bi('⏹ 急停解体', '⏹ Stop & Unlock'))
              : null,
          ),
        ),

        // 2D Real-Time Physics Soap Bubble Tank
        h(
          'div',
          {
            ref: tankRef,
            className: 'dnb-bubble-tank dnb-bubble-arena',
            'data-locked': bubbleLocked ? '1' : '0',
            'data-shake': lockShake ? '1' : '0',
            style: { height: tankHeight + 'px' },
          },
          h('canvas', {
            ref: canvasRef,
            className: 'dnb-bubble-fx',
            'aria-hidden': 'true',
          }),
          // Central Coordinator Micro-Hub pinned at (geoNow.cx, geoNow.cy)
          h(
            'div',
            {
              className: 'dnb-bubble-center-hub',
              'data-locked': bubbleLocked ? '1' : '0',
              style: {
                transform: `translate3d(${(geoNow.cx - 25).toFixed(1)}px, ${(geoNow.cy - 25).toFixed(1)}px, 0)`,
              },
              title: bi('DSH 参谋长核心调度枢纽', 'DSH Chief Core Hub'),
            },
            h('span', { className: 'dnb-bubble-center-icon' }, '✦'),
            h('span', { className: 'dnb-bubble-center-count' }, String(totalInBubble)),
          ),

          // Live Drifting & Bouncing Spherical Member Orbs
          orbs.map((orb) => {
            const body = bodiesRef.current.get(orb.uid)
            const x0 = body ? (body.x - orb.r) : (geoNow.cx - orb.r)
            const y0 = body ? (body.y - orb.r) : (geoNow.cy - orb.r)
            const isSel = selectedUid === orb.uid
            const showLockTag = bubbleLocked && (orb.canJoin || orb.canLeave)
            return h(
              'div',
              {
                key: orb.uid,
                ref: (el) => {
                  if (el) nodeElsRef.current.set(orb.uid, el)
                  else nodeElsRef.current.delete(orb.uid)
                },
                className: 'dnb-orb',
                'data-uid': orb.uid,
                'data-zone': orb.zone,
                'data-kind': orb.kind,
                'data-installed': orb.installed ? '1' : '0',
                'data-running': orb.running ? '1' : '0',
                'data-selected': isSel ? '1' : '0',
                title: `${orb.label}（${orb.kindName}）\n${orb.subText}`,
                style: {
                  width: (orb.r * 2) + 'px',
                  height: (orb.r * 2) + 'px',
                  transform: `translate3d(${x0.toFixed(2)}px, ${y0.toFixed(2)}px, 0)`,
                  '--orb-dot': orb.accent.dot,
                  '--orb-bg': orb.accent.bg,
                  '--orb-border': orb.accent.border,
                  '--orb-text': orb.accent.text,
                },
                onPointerEnter: () => {
                  const b = bodiesRef.current.get(orb.uid)
                  if (b) b.hovered = true
                },
                onPointerLeave: () => {
                  const b = bodiesRef.current.get(orb.uid)
                  if (b) b.hovered = false
                },
                onPointerDown: e => handleOrbPointerDown(e, orb),
                onPointerMove: e => handleOrbPointerMove(e, orb),
                onPointerUp: e => handleOrbPointerEnd(e, orb),
                onPointerCancel: e => handleOrbPointerEnd(e, orb),
              },
              h(
                'div',
                { className: 'dnb-orb-top' },
                orb.running
                  ? h('span', { className: 'dnb-spin-ring', style: { '--dnb-spin-size': '8px', color: orb.accent.dot } })
                  : h('span', { className: 'dnb-orb-dot', style: { background: orb.accent.dot } }),
              ),
              h('div', { className: 'dnb-orb-label' }, orb.shortLabel),
              h('div', { className: 'dnb-orb-badge' }, showLockTag ? `🔒 ${orb.badge}` : orb.badge),
            )
          }),
        ),

        // Inline External Harness Dispatch Input Bar (when ⚡ 派活 clicked)
        dispatchTarget
          ? h(
              'form',
              {
                className: 'dnb-bubble-dispatch-bar',
                onSubmit: async (e) => {
                  e.preventDefault()
                  const txt = dispatchText.trim()
                  if (!txt) return
                  const p = dispatchTarget
                  setDispatchText('')
                  setDispatchTarget('')
                  await dispatchBubbleHarness(p, txt)
                },
              },
              h('input', {
                type: 'text',
                className: 'dnb-input',
                style: { flex: 1, height: 28, fontSize: 11.5 },
                value: dispatchText,
                placeholder: bi(`向 @${dispatchTarget} 下达自包含任务（自动带当前红线与物理墙约束）…`, `Task for @${dispatchTarget} (constraints auto-prepended)…`),
                onChange: e => setDispatchText(e.target.value),
              }),
              h('button', {
                type: 'submit',
                className: 'dnb-pill dnb-pill-accent',
                style: { height: 28, padding: '0 10px', fontSize: 11 },
              }, bi('执行并锁定', 'Run & Lock')),
              h('button', {
                type: 'button',
                className: 'dnb-pill',
                style: { height: 28, padding: '0 8px', fontSize: 11 },
                onClick: () => setDispatchTarget(''),
              }, bi('取消', 'Cancel')),
            )
          : null,

        // Selected Orb Action Inspector Strip + Official Harness Install Toggle
        h(
          'div',
          { className: 'dnb-bubble-inspector', 'data-empty': selectedOrb ? '0' : '1' },
          selectedOrb
            ? h(
                React.Fragment,
                null,
                h(
                  'div',
                  { className: 'dnb-bubble-inspector-info' },
                  h('span', { className: 'dnb-droplet-dot', style: { background: selectedOrb.accent.dot } }),
                  h('span', { style: { fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap' } }, selectedOrb.label),
                  h('span', { className: 'dnb-droplet-kind', style: { color: selectedOrb.accent.text, borderColor: selectedOrb.accent.border } }, selectedOrb.kindName),
                  h('span', { className: 'dnb-bubble-inspector-sub', title: selectedOrb.subText }, selectedOrb.subText),
                ),
                h(
                  'div',
                  { className: 'dnb-bubble-inspector-acts' },
                  (selectedOrb.kind === 'subagent' && selectedOrb.raw && selectedOrb.raw.id)
                    ? h('button', {
                        type: 'button',
                        className: 'dnb-pill',
                        style: { height: 21, padding: '0 7px', fontSize: 10.5 },
                        onClick: () => {
                          if (!openSubagentChat(selectedOrb.raw)) patch({ notice: bi('该子代理暂无独立面板视图', 'No dedicated pane view for this subagent') })
                        },
                      }, h(Icon, { name: 'chat', size: 10 }), bi('分屏', 'Split'))
                    : null,
                  (selectedOrb.zone === 'inside' && selectedOrb.kind !== 'harness' && selectedOrb.raw)
                    ? h('button', {
                        type: 'button',
                        className: 'dnb-pill',
                        style: { height: 21, padding: '0 7px', fontSize: 10.5 },
                        onClick: () => {
                          patch({
                            secTarget: selectedOrb.raw.key,
                            secMode: selectedOrb.running ? 'steer' : 'followup',
                            notice: bi('已在下方锁定 @', 'Locked target @') + selectedOrb.label,
                          })
                          focusSecInput()
                        },
                      }, bi('@递话', '@Relay'))
                    : null,
                  ((selectedOrb.kind === 'harness' || selectedOrb.kind === 'standby-harness') && selectedOrb.installed && selectedOrb.raw)
                    ? h('button', {
                        type: 'button',
                        className: 'dnb-pill dnb-pill-accent',
                        'data-active': dispatchTarget === selectedOrb.raw.provider ? '1' : '0',
                        style: { height: 21, padding: '0 8px', fontSize: 10.5 },
                        onClick: () => setDispatchTarget(d => (d === selectedOrb.raw.provider ? '' : selectedOrb.raw.provider)),
                      }, bi('⚡ 一键调用', '⚡ Run Now'))
                    : null,
                  selectedOrb.installCmd
                    ? h('button', {
                        type: 'button',
                        className: 'dnb-pill',
                        style: { height: 21, padding: '0 7px', fontSize: 10.5 },
                        title: selectedOrb.installCmd,
                        onClick: () => {
                          try { navigator.clipboard?.writeText(selectedOrb.installCmd) } catch {}
                          patch({ notice: bi('已复制安装命令：', 'Copied install command: ') + selectedOrb.installCmd })
                        },
                      }, bi('复制安装命令', 'Copy Install Cmd'))
                    : null,
                  selectedOrb.canJoin
                    ? h('button', {
                        type: 'button',
                        className: 'dnb-pill dnb-pill-accent',
                        style: { height: 21, padding: '0 8px', fontSize: 10.5 },
                        onClick: () => performOrbJoin(selectedOrb),
                      }, bubbleLocked ? '🔒' : bi('+ 入泡', '+ Join'))
                    : null,
                  selectedOrb.canLeave
                    ? h('button', {
                        type: 'button',
                        className: 'dnb-pill',
                        style: { height: 21, padding: '0 7px', fontSize: 10.5 },
                        onClick: () => performOrbLeave(selectedOrb),
                      }, bubbleLocked ? '🔒' : bi('× 移出', '× Eject'))
                    : null,
                ),
              )
            : h(
                'div',
                { style: { fontSize: 11, color: 'var(--dnb-text-3)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                hasOutside
                  ? bi('💡 悬停泡泡即刹停，按住直接拖入/拖出大水泡，轻点泡泡可展开专属操作', '💡 Hover to pause orb, drag across membrane to join/eject, tap to inspect')
                  : bi('💡 悬停或按住甩动泡泡体验碰撞，再开 DSH 窗口或安装外部 Harness 即可跨端组泡', '💡 Drag orbs to play or open another DSH window / Harness to form a cross-tool squad'),
              ),
          catalogHarnesses.length > 0
            ? h('button', {
                type: 'button',
                className: 'dnb-pill',
                style: { height: 21, padding: '0 8px', fontSize: 10.5, flexShrink: 0 },
                onClick: () => setShowCatalog(v => !v),
              }, showCatalog ? bi('收起安装目录', 'Hide Catalog') : bi(`官方外部 Harness (${catalogHarnesses.length})`, `Official Harnesses (${catalogHarnesses.length})`))
            : null,
        ),

        showCatalog && catalogHarnesses.length > 0
          ? h(
              'div',
              { className: 'dnb-bubble-catalog' },
              h('div', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', marginBottom: 4 } },
                bi('⚠️ 外部 Harness 运行在独立进程中（不经过主进程物理墙），派单前会自动附带当前禁止红线，并锁死水泡防误拆：', '⚠️ External Harnesses run out-of-process (active redlines are prepended to each dispatch while Bubble locks):')),
              catalogHarnesses.map(item =>
                h(
                  'div',
                  { key: item.provider, className: 'dnb-bubble-catalog-row' },
                  h('span', { style: { fontWeight: 600, fontSize: 11 } }, `${item.label} (${item.provider})`),
                  h('code', { className: 'dnb-mono', style: { fontSize: 10, color: 'var(--dnb-text-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.installCmd),
                  h('button', {
                    type: 'button',
                    className: 'dnb-pill',
                    style: { height: 20, padding: '0 6px', fontSize: 10 },
                    onClick: () => {
                      try { navigator.clipboard?.writeText(item.installCmd) } catch {}
                      patch({ notice: bi('已复制安装命令：', 'Copied install command: ') + item.installCmd })
                    },
                  }, bi('复制命令', 'Copy')),
                ),
              ),
            )
          : null,
      ),
    ),

    // Section 2: Cross-Window Federation Switches (locks alongside Bubble during active work)
    h(
      AccCard,
      {
        open: fedOpen,
        onToggle: () => patch({ peersFedCollapsed: fedOpen }),
        icon: h(Icon, { name: 'link', size: 12.5, style: { color: 'var(--dnb-text-2)' } }),
        title: bi('跨窗口独立会话联动', 'Cross-Window Session Federation'),
        count: otherSessions.length ? `${otherSessions.filter(s => s.linked).length}/${otherSessions.length}` : '0',
        preview: bubbleLocked
          ? bi('🔒 编队工作中已锁定联动关系', '🔒 Federation locked during active work')
          : bi('多开独立主对话窗口后可在此开启联动', 'Open another standalone session window to link here'),
        bodyStyle: { padding: 0 },
      },
      otherSessions.length
        ? otherSessions.map(sess => {
            const col = colorForRootSession(sess.id, selfRootId)
            return h(
              'div',
              {
                key: sess.id,
                className: 'dnb-cell',
                style: {
                  justifyContent: 'space-between',
                  gap: 10,
                  borderLeft: `3px solid ${sess.linked ? col.dot : col.border}`,
                },
              },
              h(
                'div',
                { style: { flex: 1, minWidth: 0 } },
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                  sess.status === 'running'
                    ? h('span', { className: 'dnb-spin-ring', style: { '--dnb-spin-size': '8px', color: col.dot } })
                    : h('span', {
                        style: {
                          width: 7.5,
                          height: 7.5,
                          borderRadius: '50%',
                          background: col.dot,
                          flexShrink: 0,
                        },
                      }),
                  h('span', { style: { fontWeight: 500, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, sess.name),
                  sess.openTasks ? h('span', { className: 'dnb-tag', style: { fontSize: 10, background: col.bg, color: col.text } }, sess.openTasks + ' 待办') : null,
                ),
                (sess.objective || sess.progressSummary)
                  ? h('div', { style: { fontSize: 11, color: 'var(--dnb-text-3)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, sess.objective || sess.progressSummary)
                  : null,
              ),
              h(Switch, {
                checked: Boolean(sess.linked),
                disabled: bubbleLocked,
                onChange: on => {
                  if (bubbleLocked) { triggerLockedReject(); return }
                  requestTogglePeerLink(sess, on)
                },
              }),
            )
          })
        : h('div', { style: { padding: '12px 14px', fontSize: 11.5, color: 'var(--dnb-text-3)', lineHeight: 1.5 } },
            '当你同时打开多个独立主对话窗口时，这里会出现联动开关——也可直接从上方水泡池拖入大水泡协同。'),
    ),

    // Section 3: Color-Coded Collapsible Drawer Mailbox
    h(
      AccCard,
      {
        open: !view.peersMailCollapsed,
        onToggle: () => patch({ peersMailCollapsed: !view.peersMailCollapsed }),
        icon: h(Icon, { name: 'mail', size: 12.5, style: { color: 'var(--dnb-text-2)' } }),
        title: bi('参谋部协同信箱', 'Chief Collaboration Mailbox'),
        count: mailbox.length ? String(mailbox.length) : '',
        preview: drawerList.length ? bi(`${drawerList.length} 个通道抽屉`, `${drawerList.length} channel drawers`) : bi('暂无协同通信记录', 'No relay messages yet'),
        actions: h(
          'div',
          { className: 'dnb-text-filter-bar', style: { padding: 0, gap: 3 } },
          [
            { key: 'all', label: bi('全部', 'All') },
            { key: 'broadcast', label: bi('广播', 'Broadcast') },
            { key: 'cross', label: bi('跨窗', 'Cross') },
            { key: 'internal', label: bi('内部', 'Internal') },
          ].map(f =>
            h('button', {
              key: f.key,
              type: 'button',
              className: 'dnb-text-filter-btn',
              'data-active': mailFilter === f.key ? '1' : '0',
              onClick: () => patch({ mailChannelFilter: f.key }),
            }, f.label),
          ),
        ),
      },
      drawerList.length
        ? h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 7 } },
            drawerList.map(drawer => {
              const hasExplicit = Object.prototype.hasOwnProperty.call(openDrawers, drawer.key)
              const isOpen = hasExplicit ? Boolean(openDrawers[drawer.key]) : drawer.defaultOpen
              const primaryColor = drawer.colors[0] || SESSION_PALETTE[0]
              const secondColor = drawer.colors[1] || primaryColor
              const accentBorder = drawer.colors.length > 1
                ? `linear-gradient(180deg, ${primaryColor.dot}, ${secondColor.dot})`
                : primaryColor.dot

              return h(
                'div',
                {
                  key: drawer.key,
                  className: 'dnb-group',
                  style: {
                    marginBottom: 0,
                    overflow: 'hidden',
                    opacity: drawer.kind === 'detached' ? 0.72 : 1,
                  },
                },
                h(
                  'div',
                  {
                    className: 'dnb-drawer-head',
                    style: {
                      borderLeft: 'none',
                      boxShadow: drawer.colors.length > 1 ? undefined : `inset 3px 0 0 ${primaryColor.dot}`,
                      position: 'relative',
                      background: isOpen ? primaryColor.bg : undefined,
                    },
                    onClick: () => patch({
                      mailOpenDrawers: { ...openDrawers, [drawer.key]: !isOpen },
                    }),
                  },
                  drawer.colors.length > 1
                    ? h('span', {
                        style: {
                          position: 'absolute',
                          left: 0,
                          top: 0,
                          bottom: 0,
                          width: 3,
                          background: accentBorder,
                        },
                      })
                    : null,
                  h(
                    'div',
                    { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 } },
                    h(Icon, {
                      name: 'chevron',
                      size: 12,
                      style: {
                        color: 'var(--dnb-text-3)',
                        transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                        transition: 'transform 0.16s ease',
                        flexShrink: 0,
                      },
                    }),
                    h(
                      'span',
                      { style: { display: 'inline-flex', alignItems: 'center', gap: 2, flexShrink: 0 } },
                      drawer.colors.map((c, idx) =>
                        h('span', {
                          key: idx,
                          style: {
                            width: 7,
                            height: 7,
                            borderRadius: '50%',
                            background: c.dot,
                            marginLeft: idx > 0 ? -2 : 0,
                            border: '1px solid var(--dnb-card)',
                          },
                        })),
                    ),
                    h('span', {
                      style: {
                        fontSize: 12,
                        fontWeight: 600,
                        color: 'var(--dnb-text)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      },
                    }, drawer.title),
                    h('span', { className: 'dnb-acc-count', style: { fontSize: 10 } }, `${drawer.items.length}`),
                  ),
                  h('span', { className: 'dnb-acc-pull-hint' }, isOpen ? bi('收起 ▴', 'Fold ▴') : bi('拉起 ▾', 'Pull ▾')),
                ),
                isOpen
                  ? drawer.items.slice(0, 15).map(mail => {
                      const modeLabel = mail.mode === 'steer' ? '⚡ 插话' : mail.mode === 'silent' ? '📌 备忘' : '📨 递话'
                      const fColor = colorForRootSession(mail.fromRootId || mail.fromSession || selfRootId, selfRootId)
                      const tRoot = mail.toRootId && mail.toRootId !== 'all' ? mail.toRootId : ''
                      const tColor = tRoot ? colorForRootSession(tRoot, selfRootId) : primaryColor
                      return h(
                        'div',
                        {
                          key: mail.id,
                          className: 'dnb-cell',
                          style: {
                            flexDirection: 'column',
                            alignItems: 'flex-start',
                            gap: 4,
                            borderTop: '1px solid var(--dnb-border)',
                          },
                        },
                        h(
                          'div',
                          { style: { display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' } },
                          h(
                            'div',
                            { style: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600 } },
                            h('span', { style: { width: 6, height: 6, borderRadius: '50%', background: fColor.dot, flexShrink: 0 } }),
                            h('span', { style: { color: fColor.text || 'var(--dnb-text-2)' } }, mail.from || '参谋长'),
                            h('span', { style: { color: 'var(--dnb-text-3)' } }, '→'),
                            h('span', { style: { color: mail.to === 'all' ? 'var(--dnb-accent)' : tColor.text } }, '@' + (mail.to || 'lead')),
                            h('span', { className: 'dnb-tag', style: { fontSize: 10, fontWeight: 500 } }, modeLabel),
                          ),
                          h('span', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)' } }, relativeTimeLabel(mail.at)),
                        ),
                        mail.subject ? h('div', { style: { fontSize: 12, fontWeight: 600 } }, mail.subject) : null,
                        h('div', { style: { fontSize: 12, color: 'var(--dnb-text-2)', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, mail.text),
                      )
                    })
                  : null,
              )
            }),
          )
        : h('div', { className: 'dnb-empty', style: { padding: '16px 12px' } }, '当前筛选下暂无协同通信记录'),
    ),
  )
}

/* ------------------------------------ Header Model Popover & Suggestions */
