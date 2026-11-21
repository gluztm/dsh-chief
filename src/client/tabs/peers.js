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

const CODEX_OFFICIAL_SVG_PATH =
  'M11.6475 18.3409C11.0975 18.3409 10.575 18.2364 10.08 18.0274C9.58502 17.8184 9.14502 17.5269 8.76002 17.1529C8.34202 17.2959 7.90751 17.3674 7.45651 17.3674C6.71951 17.3674 6.03751 17.1859 5.41051 16.8229C4.78351 16.4599 4.27751 15.9649 3.89251 15.3379C3.51851 14.7109 3.33151 14.0124 3.33151 13.2424C3.33151 12.9234 3.37551 12.5769 3.46351 12.2029C3.02351 11.7959 2.68251 11.3284 2.44051 10.8004C2.19851 10.2614 2.07751 9.70044 2.07751 9.11744C2.07751 8.52344 2.20401 7.95144 2.45701 7.40144C2.71001 6.85144 3.06201 6.37844 3.51301 5.98244C3.97501 5.57544 4.50851 5.29494 5.11351 5.14094C5.23451 4.51394 5.48751 3.95294 5.87251 3.45794C6.26851 2.95194 6.75252 2.55594 7.32452 2.26994C7.89652 1.98394 8.50702 1.84094 9.15602 1.84094C9.70602 1.84094 10.2285 1.94544 10.7235 2.15444C11.2185 2.36344 11.6585 2.65494 12.0435 3.02894C12.4615 2.88594 12.896 2.81444 13.347 2.81444C14.084 2.81444 14.766 2.99594 15.393 3.35894C16.02 3.72194 16.5205 4.21694 16.8945 4.84394C17.2795 5.47094 17.472 6.16944 17.472 6.93944C17.472 7.25844 17.428 7.60494 17.34 7.97894C17.78 8.38594 18.121 8.85894 18.363 9.39794C18.605 9.92594 18.726 10.4814 18.726 11.0644C18.726 11.6584 18.5995 12.2304 18.3465 12.7804C18.0935 13.3304 17.736 13.8089 17.274 14.2159C16.823 14.6119 16.295 14.8869 15.69 15.0409C15.569 15.6679 15.3105 16.2289 14.9145 16.7239C14.5295 17.2299 14.051 17.6259 13.479 17.9119C12.907 18.1979 12.2965 18.3409 11.6475 18.3409ZM7.57201 16.2784C8.12201 16.2784 8.60051 16.1629 9.00751 15.9319L12.1095 14.1499C12.2195 14.0729 12.2745 13.9684 12.2745 13.8364V12.4174L8.28152 14.7109C8.03952 14.8539 7.79751 14.8539 7.55552 14.7109L4.43701 12.9124C4.43701 12.9454 4.43151 12.9839 4.42051 13.0279C4.42051 13.0719 4.42051 13.1379 4.42051 13.2259C4.42051 13.7869 4.55252 14.3039 4.81651 14.7769C5.09152 15.2389 5.47101 15.6019 5.95501 15.8659C6.43901 16.1409 6.97801 16.2784 7.57201 16.2784ZM7.73701 13.5889C7.80301 13.6219 7.86351 13.6384 7.91851 13.6384C7.97351 13.6384 8.02852 13.6219 8.08352 13.5889L9.32101 12.8794L5.34451 10.5694C5.10251 10.4264 4.98151 10.2119 4.98151 9.92594V6.34544C4.43151 6.58744 3.99151 6.96144 3.66151 7.46744C3.33151 7.96244 3.16651 8.51244 3.16651 9.11744C3.16651 9.65644 3.30401 10.1734 3.57901 10.6684C3.85401 11.1634 4.21151 11.5374 4.65151 11.7904L7.73701 13.5889ZM11.6475 17.2519C12.2305 17.2519 12.7585 17.1199 13.2315 16.8559C13.7045 16.5919 14.0785 16.2289 14.3535 15.7669C14.6285 15.3049 14.766 14.7879 14.766 14.2159V10.6519C14.766 10.5199 14.711 10.4209 14.601 10.3549L13.347 9.62894V14.2324C13.347 14.5184 13.226 14.7329 12.984 14.8759L9.86551 16.6744C10.4045 17.0594 10.9985 17.2519 11.6475 17.2519ZM12.2745 11.2129V8.96894L10.41 7.91294L8.52902 8.96894V11.2129L10.41 12.2689L12.2745 11.2129ZM7.45651 5.94944C7.45651 5.66344 7.57752 5.44894 7.81952 5.30594L10.938 3.50744C10.399 3.12244 9.80502 2.92994 9.15602 2.92994C8.57302 2.92994 8.04501 3.06194 7.57201 3.32594C7.09902 3.58994 6.72502 3.95294 6.45002 4.41494C6.18602 4.87694 6.05401 5.39394 6.05401 5.96594V9.51344C6.05401 9.64544 6.10901 9.74994 6.21902 9.82694L7.45651 10.5529V5.94944ZM15.8385 13.8364C16.3885 13.5944 16.823 13.2204 17.142 12.7144C17.472 12.2084 17.637 11.6584 17.637 11.0644C17.637 10.5254 17.4995 10.0084 17.2245 9.51344C16.9495 9.01844 16.592 8.64444 16.152 8.39144L13.0665 6.60944C13.0005 6.56544 12.94 6.54894 12.885 6.55994C12.83 6.55994 12.775 6.57644 12.72 6.60944L11.4825 7.30244L15.4755 9.62894C15.5965 9.69494 15.6845 9.78294 15.7395 9.89294C15.8055 9.99194 15.8385 10.1129 15.8385 10.2559V13.8364ZM12.522 5.45444C12.764 5.30044 13.006 5.30044 13.248 5.45444L16.383 7.28594C16.383 7.20894 16.383 7.10994 16.383 6.98894C16.383 6.46094 16.251 5.96044 15.987 5.48744C15.734 5.00344 15.3655 4.61844 14.8815 4.33244C14.4085 4.04644 13.8585 3.90344 13.2315 3.90344C12.6815 3.90344 12.203 4.01894 11.796 4.24994L8.69402 6.03194C8.58402 6.10894 8.52902 6.21344 8.52902 6.34544V7.76444L12.522 5.45444Z'

const CLAUDE_OFFICIAL_SVG_PATH =
  'M52.4285 162.873L98.7844 136.879L99.5485 134.602L98.7844 133.334H96.4921L88.7237 132.862L62.2346 132.153L39.3113 131.207L17.0249 130.026L11.4214 128.844L6.2 121.873L6.7094 118.447L11.4214 115.257L18.171 115.847L33.0711 116.911L55.485 118.447L71.6586 119.392L95.728 121.873H99.5485L100.058 120.337L98.7844 119.392L97.7656 118.447L74.5877 102.732L49.4995 86.1905L36.3823 76.62L29.3779 71.7757L25.8121 67.2858L24.2839 57.3608L30.6515 50.2716L39.3113 50.8623L41.4763 51.4531L50.2636 58.1879L68.9842 72.7209L93.4357 90.6804L97.0015 93.6343L98.4374 92.6652L98.6571 91.9801L97.0015 89.2625L83.757 65.2772L69.621 40.8192L63.2534 30.6579L61.5978 24.632C60.9565 22.1032 60.579 20.0111 60.579 17.4246L67.8381 7.49965L71.9133 6.19995L81.7193 7.49965L85.7946 11.0443L91.9074 24.9865L101.714 46.8451L116.996 76.62L121.453 85.4816L123.873 93.6343L124.764 96.1155H126.292V94.6976L127.566 77.9197L129.858 57.3608L132.15 30.8942L132.915 23.4505L136.608 14.4708L143.994 9.62643L149.725 12.344L154.437 19.0788L153.8 23.4505L150.998 41.6463L145.522 70.1215L141.957 89.2625H143.994L146.414 86.7813L156.093 74.0206L172.266 53.698L179.398 45.6635L187.803 36.802L193.152 32.5484H203.34L210.726 43.6549L207.415 55.1159L196.972 68.3492L188.312 79.5739L175.896 96.2095L168.191 109.585L168.882 110.689L170.738 110.53L198.755 104.504L213.91 101.787L231.994 98.7149L240.144 102.496L241.036 106.395L237.852 114.311L218.495 119.037L195.826 123.645L162.07 131.592L161.696 131.893L162.137 132.547L177.36 133.925L183.855 134.279H199.774L229.447 136.524L237.215 141.605L241.8 147.867L241.036 152.711L229.065 158.737L213.019 154.956L175.45 145.977L162.587 142.787H160.805V143.85L171.502 154.366L191.242 172.089L215.82 195.011L217.094 200.682L213.91 205.172L210.599 204.699L188.949 188.394L180.544 181.069L161.696 165.118H160.422V166.772L164.752 173.152L187.803 207.771L188.949 218.405L187.294 221.832L181.308 223.959L174.813 222.777L161.187 203.754L147.305 182.486L136.098 163.345L134.745 164.2L128.075 235.42L125.019 239.082L117.887 241.8L111.902 237.31L108.718 229.984L111.902 215.452L115.722 196.547L118.779 181.541L121.58 162.873L123.291 156.636L123.14 156.219L121.773 156.449L107.699 175.752L86.304 204.699L69.3663 222.777L65.291 224.431L58.2867 220.768L58.9235 214.27L62.8713 208.48L86.304 178.705L100.44 160.155L109.551 149.507L109.462 147.967L108.959 147.924L46.6977 188.512L35.6182 189.93L30.7788 185.44L31.4156 178.115L33.7079 175.752L52.4285 162.873Z'

function HarnessLogoIcon({ provider, size = 18 }) {
  if (provider === 'codex') {
    return h(
      'span',
      { className: 'dnb-brand-badge', 'data-provider': 'codex' },
      h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 21 21',
          fill: 'none',
          'data-official-logo': '1',
          'data-provider': 'codex',
          'aria-hidden': 'true',
          style: { display: 'block', flexShrink: 0 },
        },
        h('path', { d: CODEX_OFFICIAL_SVG_PATH, fill: 'currentColor' }),
      ),
    )
  }
  if (provider === 'claude-code') {
    return h(
      'span',
      { className: 'dnb-brand-badge', 'data-provider': 'claude-code' },
      h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 248 248',
          fill: 'none',
          'data-official-logo': '1',
          'data-provider': 'claude-code',
          'aria-hidden': 'true',
          style: { display: 'block', flexShrink: 0 },
        },
        h('path', { d: CLAUDE_OFFICIAL_SVG_PATH, fill: '#D97757' }),
      ),
    )
  }
  return h(
    'span',
    { className: 'dnb-brand-badge', 'data-provider': provider || 'custom' },
    h(
      'svg',
      {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        'data-official-logo': '1',
        'data-provider': provider || 'custom',
        'aria-hidden': 'true',
        style: { display: 'block', flexShrink: 0 },
      },
      h('rect', { x: 5.5, y: 5.5, width: 13, height: 13, rx: 3.5, stroke: 'currentColor', strokeWidth: 1.7 }),
      h('circle', { cx: 12, cy: 12, r: 2.5, fill: 'currentColor' }),
    ),
  )
}

function buildSquadHierarchy({
  peers,
  enrolledHarnesses,
  standbySessions,
  availableHarnesses,
  selfRootId,
  otherSessions,
}) {
  const peerList = Array.isArray(peers) ? peers.filter(Boolean) : []
  const branchMap = new Map()
  const branches = []
  const orphanSubs = []

  const getRootKey = (p) => String((p && (p.rootId || p.rootSessionId)) || selfRootId || 'lead')

  // First pass: primary lead and linked peer-session roots
  for (const peer of peerList) {
    if (peer.kind === 'subagent') continue
    const isPeer = peer.kind === 'peer-session'
    const rid = isPeer ? String(peer.id || getRootKey(peer)) : getRootKey(peer)
    const accent = colorForRootSession(rid, selfRootId)
    const linkedSessObj = isPeer ? (otherSessions || []).find(s => s && s.id === rid) || null : null
    const branch = {
      uid: isPeer ? `peer:${rid}` : 'primary:lead',
      podKey: isPeer ? `branch:peer:${rid}` : 'branch:lead',
      roleTier: isPeer ? 'peer' : 'primary',
      tierBadge: isPeer ? bi('联动主窗', 'Linked') : bi('主', 'Lead'),
      rootId: rid,
      raw: peer,
      linkedSessObj,
      accent,
      children: [],
    }
    branches.push(branch)
    branchMap.set(rid, branch)
  }

  // Ensure a primary branch always exists when lead hasn't been enumerated yet
  let primaryBranch = branches.find(b => b.roleTier === 'primary') || branches[0] || null
  if (!primaryBranch) {
    const rid = String(selfRootId || 'lead')
    primaryBranch = {
      uid: 'primary:lead',
      podKey: 'branch:lead',
      roleTier: 'primary',
      tierBadge: bi('主', 'Lead'),
      rootId: rid,
      raw: {
        key: 'lead',
        id: rid,
        kind: 'lead',
        name: bi('主对话', 'Main'),
        status: 'idle',
        taskTitle: bi('当前主指挥核心会话', 'Current Lead Session'),
      },
      linkedSessObj: null,
      accent: colorForRootSession(rid, selfRootId),
      children: [],
    }
    branches.unshift(primaryBranch)
    branchMap.set(rid, primaryBranch)
  }

  // Second pass: attach secondary subagents under their owning root branch
  for (const peer of peerList) {
    if (peer.kind !== 'subagent') continue
    const rid = getRootKey(peer)
    const ownerBranch = branchMap.get(rid) || primaryBranch
    const accent = colorForRootSession(rid, selfRootId)
    const item = {
      uid: `sub:${peer.key || peer.id || ownerBranch.children.length}`,
      roleTier: 'secondary',
      tierBadge: bi('次', 'Sub'),
      raw: peer,
      accent,
    }
    if (ownerBranch) ownerBranch.children.push(item)
    else orphanSubs.push(item)
  }
  for (const sub of orphanSubs) primaryBranch.children.push(sub)

  // Strictly include ONLY locally installed/ready external Harnesses (never uninstalled catalog entries)
  const activeEnrolledHarnesses = (enrolledHarnesses || [])
    .filter(hItem => hItem && hItem.provider && (hItem.installed !== false || hItem.running))
  const enrolledProviders = new Set(activeEnrolledHarnesses.map(hItem => hItem.provider))
  const readyStandbyHarnesses = (availableHarnesses || [])
    .filter(hItem => hItem && hItem.provider && hItem.installed !== false && !enrolledProviders.has(hItem.provider))

  const secondaryCount = branches.reduce((sum, b) => sum + b.children.length, 0)
  const peerCount = branches.filter(b => b.roleTier === 'peer').length
  const totalInBubble = peersCountSafe(branches) + activeEnrolledHarnesses.length
  const runningCount = peerList.filter(p => p.status === 'running').length
    + activeEnrolledHarnesses.filter(hItem => hItem.running).length

  return {
    branches,
    harnessWing: activeEnrolledHarnesses,
    standbySessions: (standbySessions || []).filter(Boolean),
    readyStandbyHarnesses,
    counts: {
      primary: branches.filter(b => b.roleTier === 'primary').length,
      secondary: secondaryCount,
      peer: peerCount,
      harness: activeEnrolledHarnesses.length,
      total: totalInBubble,
      running: runningCount,
    },
  }
}

function peersCountSafe(branches) {
  let n = 0
  for (const b of branches) {
    n += 1 + (b.children ? b.children.length : 0)
  }
  return n
}

function computeLiquidLinks(stageEl, hubEl, leadEl, allyElsMap, allies) {
  if (!stageEl || !hubEl || !leadEl) return { w: 0, h: 0, links: [] }
  const sRect = stageEl.getBoundingClientRect()
  const hRect = hubEl.getBoundingClientRect()
  const lRect = leadEl.getBoundingClientRect()
  if (!sRect.width || !sRect.height || !hRect.width || !lRect.width) return { w: 0, h: 0, links: [] }

  const hubBottom = {
    x: hRect.left - sRect.left + hRect.width / 2,
    y: hRect.bottom - sRect.top,
  }
  const leadBox = {
    left: lRect.left - sRect.left,
    right: lRect.right - sRect.left,
    top: lRect.top - sRect.top,
    bottom: lRect.bottom - sRect.top,
    cx: lRect.left - sRect.left + lRect.width / 2,
    cy: lRect.top - sRect.top + lRect.height / 2,
  }

  const links = []
  const addCurve = (id, kind, p1, p2, color, dashed, label) => {
    const dy = p2.y - p1.y
    const spread = Math.max(18, Math.abs(dy) * 0.48)
    const d = `M ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} C ${p1.x.toFixed(1)} ${(p1.y + spread).toFixed(1)}, ${p2.x.toFixed(1)} ${(p2.y - spread).toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
    links.push({
      id,
      kind,
      d,
      x1: p1.x,
      y1: p1.y,
      x2: p2.x,
      y2: p2.y,
      mx: (p1.x + p2.x) / 2,
      my: (p1.y + p2.y) / 2,
      color,
      dashed,
      label,
    })
  }

  addCurve(
    'hub-lead',
    'primary',
    hubBottom,
    { x: leadBox.cx, y: leadBox.top },
    '#38bdf8',
    false,
    allies.length > 0 ? '主控' : '',
  )

  const allyBoxes = []
  let firstHarnessLabeled = false
  let firstPeerLabeled = false

  for (const ally of allies) {
    const el = allyElsMap.get(ally.uid)
    if (!el) continue
    const r = el.getBoundingClientRect()
    if (!r.width) continue
    const box = {
      uid: ally.uid,
      kind: ally.kind,
      left: r.left - sRect.left,
      top: r.top - sRect.top,
      cx: r.left - sRect.left + r.width / 2,
      cy: r.top - sRect.top + r.height / 2,
      color: ally.color,
    }
    allyBoxes.push(box)
    let lbl = ''
    if (ally.kind === 'harness' && !firstHarnessLabeled) {
      firstHarnessLabeled = true
      lbl = '派单'
    } else if (ally.kind === 'peer' && !firstPeerLabeled) {
      firstPeerLabeled = true
      lbl = '联动'
    }
    addCurve(
      `hub-${ally.uid}`,
      ally.kind,
      hubBottom,
      { x: box.cx, y: box.top },
      box.color,
      ally.kind === 'harness',
      lbl,
    )
  }

  if (allyBoxes.length > 0) {
    const topAlly = allyBoxes[0]
    if (topAlly.left > leadBox.right + 18) {
      const yMid = Math.round((leadBox.cy + topAlly.cy) / 2)
      const x1 = leadBox.right
      const x2 = topAlly.left
      links.push({
        id: 'lead-ally-sync',
        kind: 'collab-sync',
        d: `M ${x1.toFixed(1)} ${leadBox.cy.toFixed(1)} C ${((x1 + x2) / 2).toFixed(1)} ${yMid.toFixed(1)}, ${((x1 + x2) / 2).toFixed(1)} ${yMid.toFixed(1)}, ${x2.toFixed(1)} ${topAlly.cy.toFixed(1)}`,
        x1,
        y1: leadBox.cy,
        x2,
        y2: topAlly.cy,
        mx: (x1 + x2) / 2,
        my: yMid,
        color: topAlly.color,
        dashed: true,
        label: '⇄协同',
      })
    }
  }

  return { w: Math.round(sRect.width), h: Math.round(sRect.height), links }
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
  const standbySessions = otherSessions.filter(s => s && !s.linked)

  const [confirmStop, setConfirmStop] = React.useState(false)
  const [dispatchTarget, setDispatchTarget] = React.useState('')
  const [dispatchText, setDispatchText] = React.useState('')
  const [lockShake, setLockShake] = React.useState(false)
  const [dragOverZone, setDragOverZone] = React.useState('')
  const [linkLayout, setLinkLayout] = React.useState({ w: 0, h: 0, links: [] })

  const stageRef = React.useRef(null)
  const hubRef = React.useRef(null)
  const leadRef = React.useRef(null)
  const allyClusterRef = React.useRef(null)
  const dragPayloadRef = React.useRef(null)

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

  const squad = buildSquadHierarchy({
    peers,
    enrolledHarnesses,
    standbySessions,
    availableHarnesses,
    selfRootId,
    otherSessions,
  })
  const { branches, harnessWing, readyStandbyHarnesses, counts } = squad
  const primaryBranch = branches.find(b => b.roleTier === 'primary') || branches[0] || null
  const peerBranches = branches.filter(b => b && b !== primaryBranch)
  const hasRightAllies = peerBranches.length > 0 || harnessWing.length > 0
  const hasStandby = squad.standbySessions.length > 0 || readyStandbyHarnesses.length > 0

  const rightAlliesList = []
  if (hasRightAllies) {
    const hasH = harnessWing.length > 0
    const hasP = peerBranches.length > 0
    const accentColor = bubbleLocked
      ? '#f59e0b'
      : (hasH && harnessWing[0].provider === 'claude-code'
          ? '#D97757'
          : (hasH ? '#38bdf8' : peerBranches[0].accent.dot))
    const linkKind = hasH ? 'harness' : 'peer'
    const linkLbl = hasH && hasP ? bi('派单/联动', 'Ext/Link') : (hasH ? bi('派单', 'Dispatch') : bi('联动', 'Linked'))
    rightAlliesList.push({
      uid: 'ally-cluster',
      kind: linkKind,
      color: accentColor,
      label: linkLbl,
    })
  }

  const layoutSig = [
    view.peersNetCollapsed ? '1' : '0',
    branches.map(b => `${b.uid}:${b.children.length}`).join(','),
    harnessWing.map(hItem => `${hItem.provider}:${hItem.running ? 1 : 0}`).join(','),
    bubbleLocked ? 'L' : 'U',
  ].join('|')

  React.useLayoutEffect(() => {
    if (view.peersNetCollapsed) return undefined
    const measure = () => {
      const allyMap = new Map()
      if (allyClusterRef.current) allyMap.set('ally-cluster', allyClusterRef.current)
      const next = computeLiquidLinks(
        stageRef.current,
        hubRef.current,
        leadRef.current,
        allyMap,
        rightAlliesList,
      )
      setLinkLayout(prev => {
        if (
          prev.w === next.w
          && prev.h === next.h
          && prev.links.length === next.links.length
          && prev.links.every((l, idx) => l.d === next.links[idx].d && l.color === next.links[idx].color && l.label === next.links[idx].label)
        ) {
          return prev
        }
        return next
      })
    }
    measure()
    let ro = null
    if (typeof ResizeObserver !== 'undefined' && stageRef.current) {
      ro = new ResizeObserver(measure)
      ro.observe(stageRef.current)
    }
    return () => {
      if (ro) ro.disconnect()
    }
  }, [layoutSig])

  const triggerLockedReject = (reasonHint) => {
    setLockShake(true)
    patch({
      notice: reasonHint || bi(
        '🔒 协同水泡工作中已锁死结构，禁止拆解成员；请等待全员收工或点击「⏹ 急停解体」',
        '🔒 Bubble locked while working; wait until settled or click Emergency Stop',
      ),
    })
  }

  const performJoin = ({ kind, id, item }) => {
    if (bubbleLocked) {
      triggerLockedReject()
      return
    }
    if (kind === 'standby-session') {
      const sess = item || squad.standbySessions.find(s => s.id === id)
      if (sess) requestTogglePeerLink(sess, true)
    } else if (kind === 'standby-harness') {
      const hObj = item || readyStandbyHarnesses.find(x => x.provider === id)
      if (hObj) {
        void toggleBubbleHarness(hObj.provider, true, {
          label: hObj.label,
          role: hObj.roleHint || hObj.role,
        })
      }
    }
  }

  const performLeave = ({ kind, id, branch }) => {
    if (bubbleLocked) {
      triggerLockedReject()
      return
    }
    if (kind === 'peer-session') {
      const bObj = branch || peerBranches.find(b => b.rootId === id)
      const sessObj = (bObj && bObj.linkedSessObj) || {
        id,
        name: (bObj && bObj.raw && bObj.raw.name) || shortSession(id),
        linked: true,
      }
      requestTogglePeerLink(sessObj, false)
    } else if (kind === 'harness') {
      if (dispatchTarget === id) setDispatchTarget('')
      const hObj = harnessWing.find(x => x.provider === id)
      void toggleBubbleHarness(id, false, { label: (hObj && hObj.label) || id })
    }
  }

  const beginDragItem = (e, payload) => {
    dragPayloadRef.current = payload
    try {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', JSON.stringify(payload))
    } catch {}
  }

  const endDragItem = () => {
    dragPayloadRef.current = null
    setDragOverZone('')
  }

  const readDragPayload = (e) => {
    if (dragPayloadRef.current) return dragPayloadRef.current
    try {
      const raw = e.dataTransfer && e.dataTransfer.getData('text/plain')
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  }

  const handleZoneDragOver = (e, acceptFromZone, zoneName) => {
    const p = dragPayloadRef.current
    if (p && p.fromZone !== acceptFromZone) return
    e.preventDefault()
    if (dragOverZone !== zoneName) setDragOverZone(zoneName)
  }

  const handleMembraneDrop = (e) => {
    e.preventDefault()
    setDragOverZone('')
    const payload = readDragPayload(e)
    dragPayloadRef.current = null
    if (!payload || payload.fromZone !== 'outside') return
    performJoin(payload)
  }

  const handleStandbyDrop = (e) => {
    e.preventDefault()
    setDragOverZone('')
    const payload = readDragPayload(e)
    dragPayloadRef.current = null
    if (!payload || payload.fromZone !== 'inside') return
    performLeave(payload)
  }

  const summaryParts = [
    `${counts.primary} ${bi('主', 'Lead')}`,
    counts.secondary > 0 ? `${counts.secondary} ${bi('次', 'Sub')}` : '',
    counts.peer > 0 ? `${counts.peer} ${bi('联动', 'Peer')}` : '',
    counts.harness > 0 ? `${counts.harness} ${bi('外协', 'Harness')}` : '',
  ].filter(Boolean)

  const dispatchHarnessMeta = dispatchTarget
    ? (harnessWing.find(x => x.provider === dispatchTarget) || readyStandbyHarnesses.find(x => x.provider === dispatchTarget) || null)
    : null

  const fedOpen = (view.peersFedCollapsed === null || view.peersFedCollapsed === undefined)
    ? otherSessions.length > 0
    : !view.peersFedCollapsed

  return h(
    'div',
    { className: 'dnb-view' },
    // Section 1: Bubble-Shaped Collaboration Squad Topology (Experimental)
    h(
      AccCard,
      {
        open: !view.peersNetCollapsed,
        onToggle: () => patch({ peersNetCollapsed: !view.peersNetCollapsed }),
        title: bi('🫧 协同作战水泡（实验）', '🫧 Collab Bubble Squad (Exp)'),
        headTitle: bubbleLocked
          ? bi('编队已锁定：运行期间禁止拆散会话或外部 Harness，仅可通过急停安全解体', 'Locked during work: structural edits blocked until settled or emergency stop')
          : bi('水泡状编队清晰展示团队归属、主次层级与协作连线，支持拖入/点选组队', 'Organic bubble squad clearly shows membership, hierarchy, and collaboration links'),
        count: counts.total ? String(counts.total) : '',
        preview: bubbleLocked
          ? `🔒 ${bubbleLockReason || bi('工作中已锁死', 'Locked while active')}`
          : summaryParts.join(' · '),
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
        // Option A: Unified Liquid Fusion Bubble Canvas (zero nested rigid box stack)
        h(
          'div',
          {
            ref: stageRef,
            className: 'dnb-liquid-canvas',
            'data-locked': bubbleLocked ? '1' : '0',
            'data-shake': lockShake ? '1' : '0',
            'data-dual': hasRightAllies ? '1' : '0',
            'data-dragover': dragOverZone === 'inside' ? '1' : '0',
            onDragOver: e => handleZoneDragOver(e, 'outside', 'inside'),
            onDragLeave: () => { if (dragOverZone === 'inside') setDragOverZone('') },
            onDrop: handleMembraneDrop,
          },
          // Layer 0: Organic Liquid Membrane Contour & Soft Glow Backdrop
          h(
            'svg',
            {
              className: 'dnb-liquid-bg-svg',
              viewBox: '0 0 640 240',
              preserveAspectRatio: 'none',
              'aria-hidden': 'true',
            },
            h(
              'defs',
              null,
              h(
                'radialGradient',
                { id: 'dnb-liq-glow-a', cx: hasRightAllies ? '30%' : '50%', cy: '58%', r: '46%' },
                h('stop', { offset: '0%', stopColor: bubbleLocked ? '#f59e0b' : '#38bdf8', stopOpacity: '0.20' }),
                h('stop', { offset: '100%', stopColor: bubbleLocked ? '#f59e0b' : '#38bdf8', stopOpacity: '0' }),
              ),
              hasRightAllies
                ? h(
                    'radialGradient',
                    { id: 'dnb-liq-glow-b', cx: '73%', cy: '58%', r: '40%' },
                    h('stop', { offset: '0%', stopColor: bubbleLocked ? '#f59e0b' : '#2dd4bf', stopOpacity: '0.15' }),
                    h('stop', { offset: '100%', stopColor: '#2dd4bf', stopOpacity: '0' }),
                  )
                : null,
            ),
            h('rect', { width: 640, height: 240, fill: 'url(#dnb-liq-glow-a)' }),
            hasRightAllies ? h('rect', { width: 640, height: 240, fill: 'url(#dnb-liq-glow-b)' }) : null,
            h('path', {
              className: 'dnb-liquid-contour',
              d: hasRightAllies
                ? 'M 18 134 C 18 42, 150 32, 286 50 C 310 53, 330 53, 354 50 C 490 32, 622 42, 622 134 C 622 218, 496 232, 352 215 C 330 212, 310 212, 288 215 C 144 232, 18 218, 18 134 Z'
                : 'M 94 132 C 94 42, 206 32, 320 32 C 434 32, 546 42, 546 132 C 546 218, 434 228, 320 228 C 206 228, 94 218, 94 132 Z',
              fill: 'none',
            }),
            h('path', {
              className: 'dnb-liquid-specular',
              d: hasRightAllies
                ? 'M 64 53 Q 160 35 256 48'
                : 'M 176 47 Q 320 30 464 47',
              fill: 'none',
            }),
          ),

          // Layer 1: Adaptive Optical Filament Connectors (paths first, top labels second)
          (linkLayout.w > 0 && linkLayout.h > 0 && linkLayout.links.length > 0)
            ? h(
                'svg',
                {
                  className: 'dnb-liquid-links-svg',
                  width: linkLayout.w,
                  height: linkLayout.h,
                  viewBox: `0 0 ${linkLayout.w} ${linkLayout.h}`,
                  'aria-hidden': 'true',
                },
                h(
                  'g',
                  { className: 'dnb-squad-links-paths' },
                  linkLayout.links.map((lk) =>
                    h(
                      'g',
                      { key: 'p-' + lk.id, className: 'dnb-squad-link-group', 'data-kind': lk.kind },
                      h('path', {
                        className: 'dnb-squad-link-path',
                        'data-kind': lk.kind,
                        d: lk.d,
                        fill: 'none',
                        stroke: lk.color,
                        strokeWidth: lk.kind === 'collab-sync' ? 1.4 : 1.7,
                        strokeDasharray: lk.dashed ? '4 4' : undefined,
                        strokeLinecap: 'round',
                        opacity: lk.kind === 'collab-sync' ? 0.72 : 0.65,
                      }),
                      h('circle', { cx: lk.x1, cy: lk.y1, r: 2.3, fill: lk.color, opacity: 0.85 }),
                      h('circle', { cx: lk.x2, cy: lk.y2, r: 2.8, fill: lk.color, opacity: 0.92 }),
                    ),
                  ),
                ),
                h(
                  'g',
                  { className: 'dnb-squad-links-labels' },
                  linkLayout.links.map((lk) => {
                    if (!lk.label) return null
                    const pillW = Math.max(30, Math.round(lk.label.split('').reduce((s, ch) => s + (/[\u4e00-\u9fa5]/.test(ch) ? 9.8 : 6.0), 12)))
                    return h(
                      'g',
                      { key: 'l-' + lk.id, transform: `translate(${lk.mx.toFixed(1)}, ${lk.my.toFixed(1)})` },
                      h('rect', {
                        x: -(pillW / 2),
                        y: -8,
                        width: pillW,
                        height: 16,
                        rx: 8,
                        className: 'dnb-squad-link-pill-bg',
                        stroke: lk.color,
                        strokeWidth: 0.85,
                      }),
                      h(
                        'text',
                        {
                          x: 0,
                          y: 3.1,
                          textAnchor: 'middle',
                          className: 'dnb-squad-link-pill-txt',
                          fill: lk.color,
                        },
                        lk.label,
                      ),
                    )
                  }),
                ),
              )
            : null,

          // Layer 2a: Integrated Minimal Floating Top Bar (merged cleanly inside bubble)
          h(
            'div',
            { className: 'dnb-liquid-topbar' },
            h(
              'div',
              { className: 'dnb-bubble-status', 'data-locked': bubbleLocked ? '1' : '0' },
              h('span', { className: 'dnb-bubble-status-dot' }),
              h(
                'span',
                { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                bubbleLocked
                  ? bi(`🔒 工作中已锁死${bubbleLockReason ? ' · ' + bubbleLockReason : ''}`, `🔒 Locked${bubbleLockReason ? ' · ' + bubbleLockReason : ''}`)
                  : bi('整备协同中 · 拖或点入泡', 'Staging · Drag or click to join'),
              ),
            ),
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 } },
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

          // Layer 2b: Floating Central Coordinator Micro-Hub
          h(
            'div',
            { className: 'dnb-liquid-hub-wrap' },
            h(
              'div',
              {
                ref: hubRef,
                className: 'dnb-liquid-hub',
                'data-locked': bubbleLocked ? '1' : '0',
                title: bi('DSH 参谋长作为统一总调度枢纽，串联主对话、下属子代理、联动主窗与外部 Harness', 'DSH Chief orchestrates Primary Lead, Subagents, Linked Windows & Harnesses'),
              },
              h('span', { className: 'dnb-liquid-hub-star' }, '✦'),
              h('span', { className: 'dnb-liquid-hub-name' }, bi('DSH 参谋长', 'DSH Chief')),
              h('span', { className: 'dnb-liquid-hub-meta' }, `· ${counts.total} ${bi('在编', 'in squad')}`),
              counts.running > 0
                ? h('span', { className: 'dnb-liquid-run-badge' }, `${counts.running} ${bi('运行', 'run')}`)
                : null,
            ),
          ),

          // Layer 2c: Liquid Core Body (Left Primary Core + Satellite Pearls | Right Glass Allies)
          h(
            'div',
            { className: 'dnb-liquid-body', 'data-dual': hasRightAllies ? '1' : '0' },
            // Left Core: Lead Bubble + Close Satellite Pearls
            primaryBranch
              ? (() => {
                  const leadPeer = primaryBranch.raw || {}
                  const leadRunning = leadPeer.status === 'running'
                  const leadTip = leadPeer.taskTitle || leadPeer.progressSummary || leadPeer.objective || bi('当前主指挥核心会话', 'Current primary coordinator session')
                  return h(
                    'div',
                    { className: 'dnb-liquid-lead-cluster' },
                    h(
                      'div',
                      {
                        ref: leadRef,
                        className: 'dnb-liquid-lead-orb',
                        'data-tier': 'primary',
                        'data-running': leadRunning ? '1' : '0',
                        title: leadTip,
                      },
                      leadRunning
                        ? h('span', { className: 'dnb-spin-ring', style: { '--dnb-spin-size': '9px', color: '#38bdf8' } })
                        : h('span', { className: 'dnb-squad-dot', style: { background: '#38bdf8', width: 8, height: 8 } }),
                      h('span', { className: 'dnb-tier-badge', 'data-tier': 'primary' }, primaryBranch.tierBadge),
                      h('span', { className: 'dnb-liquid-lead-name' }, leadPeer.name || bi('主对话', 'Main')),
                      leadPeer.key
                        ? h('button', {
                            type: 'button',
                            className: 'dnb-mini-btn',
                            title: bi('快速向主对话递话调度', 'Send relay to Main'),
                            onClick: () => {
                              patch({
                                secTarget: leadPeer.key,
                                secMode: leadRunning ? 'steer' : 'followup',
                                notice: bi('已在下方锁定 @', 'Locked target @') + (leadPeer.name || leadPeer.key),
                              })
                              focusSecInput()
                            },
                          }, '@递话')
                        : null,
                    ),
                    primaryBranch.children.length > 0
                      ? h(
                          'div',
                          { className: 'dnb-liquid-satellites' },
                          h('span', { className: 'dnb-liquid-sat-prefix' }, `↳ ${bi('次', 'Sub')}`),
                          primaryBranch.children.map((sub) => {
                            const sPeer = sub.raw || {}
                            const sRun = sPeer.status === 'running'
                            const subName = sPeer.name || shortSession(sPeer.id)
                            return h(
                              'div',
                              {
                                key: sub.uid,
                                className: 'dnb-liquid-sat-pill',
                                'data-tier': 'secondary',
                                'data-running': sRun ? '1' : '0',
                                title: `${subName}${sPeer.taskTitle ? ' — ' + sPeer.taskTitle : ''}`,
                              },
                              sRun
                                ? h('span', { className: 'dnb-spin-ring', style: { '--dnb-spin-size': '7px', color: '#38bdf8' } })
                                : h('span', { className: 'dnb-squad-dot', style: { background: 'rgba(56, 189, 248, 0.78)', width: 5.5, height: 5.5 } }),
                              h('span', { className: 'dnb-liquid-sat-name' }, subName),
                              h(
                                'span',
                                { className: 'dnb-sat-acts' },
                                sPeer.id
                                  ? h('button', {
                                      type: 'button',
                                      className: 'dnb-sat-btn',
                                      title: bi('分屏查看该子代理对话流', 'Open subagent split view'),
                                      onClick: () => {
                                        if (!openSubagentChat(sPeer)) patch({ notice: bi('该子代理暂无独立面板视图', 'No dedicated pane view for this subagent') })
                                      },
                                    }, h(Icon, { name: 'chat', size: 9 }), bi('分屏', 'Split'))
                                  : null,
                                sPeer.key
                                  ? h('button', {
                                      type: 'button',
                                      className: 'dnb-sat-btn',
                                      title: bi('向该子代理直接递话', 'Relay to subagent'),
                                      onClick: () => {
                                        patch({
                                          secTarget: sPeer.key,
                                          secMode: sRun ? 'steer' : 'followup',
                                          notice: bi('已在下方锁定 @', 'Locked target @') + subName,
                                        })
                                        focusSecInput()
                                      },
                                    }, '@')
                                  : null,
                              ),
                            )
                          }),
                        )
                      : null,
                  )
                })()
              : null,

            // Right Wing: Organic Glass Ally Pills (External Harnesses & Linked Peer Windows — zero extra wrapper box)
            hasRightAllies
              ? h(
                  'div',
                  {
                    ref: allyClusterRef,
                    className: 'dnb-liquid-ally-cluster',
                  },
                  harnessWing.map((hItem) => {
                    const roleText = hItem.role || hItem.roleHint || bi('外部独立执行进程', 'External Harness')
                    const isLocal = hItem.transport === 'local-cli'
                    const isSelTarget = dispatchTarget === hItem.provider
                    const shortCfg = hItem.configLabel
                      ? (hItem.configLabel.length > 10 ? bi('本机已配', 'Local Cfg') : hItem.configLabel)
                      : ''
                    const subInfo = hItem.running
                      ? bi('执行中', 'Running')
                      : `${isLocal ? bi('直连', 'Local') : bi('插件', 'Plugin')}${shortCfg ? ' · ' + shortCfg : ''}`
                    return h(
                      'div',
                      {
                        key: 'h-' + hItem.provider,
                        className: 'dnb-liquid-ally-pill',
                        'data-tier': 'harness',
                        'data-uid': 'harness:' + hItem.provider,
                        'data-provider': hItem.provider,
                        'data-running': hItem.running ? '1' : '0',
                        draggable: true,
                        title: `${hItem.label || hItem.provider} — ${roleText}\n${bi('独立进程 · 派单自动附带当前红线与物理墙', 'Out-of-process · redlines & walls auto-prepended')}${hItem.binaryPath ? '\n' + hItem.binaryPath : ''}`,
                        onDragStart: e => beginDragItem(e, { fromZone: 'inside', kind: 'harness', id: hItem.provider }),
                        onDragEnd: endDragItem,
                      },
                      h(HarnessLogoIcon, { provider: hItem.provider, size: 18 }),
                      h(
                        'div',
                        { className: 'dnb-ally-info' },
                        h(
                          'div',
                          { className: 'dnb-ally-name-row' },
                          h('span', { className: 'dnb-ally-name' }, hItem.label || hItem.provider),
                          hItem.running ? h('span', { className: 'dnb-spin-ring', style: { '--dnb-spin-size': '7px', color: '#34d399' } }) : null,
                        ),
                        h('div', { className: 'dnb-ally-sub' }, subInfo),
                      ),
                      h(
                        'div',
                        { className: 'dnb-ally-acts' },
                        h('button', {
                          type: 'button',
                          className: 'dnb-pill dnb-pill-accent',
                          'data-active': isSelTarget ? '1' : '0',
                          style: { height: 22, padding: '0 8px', fontSize: 10.5 },
                          onClick: () => setDispatchTarget(d => (d === hItem.provider ? '' : hItem.provider)),
                        }, bi('⚡ 调用', '⚡ Run')),
                        h('button', {
                          type: 'button',
                          className: 'dnb-mini-btn',
                          title: bubbleLocked ? bi('编队已锁，禁止移出', 'Locked while active') : bi('移回待命池', 'Move to standby'),
                          onClick: () => performLeave({ kind: 'harness', id: hItem.provider }),
                        }, bubbleLocked ? '🔒' : '×'),
                      ),
                    )
                  }),
                  peerBranches.map((branch) => {
                    const pPeer = branch.raw || {}
                    const pRun = pPeer.status === 'running'
                    const pSummary = pPeer.taskTitle || pPeer.progressSummary || pPeer.objective || bi('已并入当前协同水泡', 'Linked in Bubble')
                    return h(
                      'div',
                      { key: 'pwrap-' + branch.rootId, className: 'dnb-liquid-peer-block' },
                      h(
                        'div',
                        {
                          className: 'dnb-liquid-ally-pill',
                          'data-tier': 'peer',
                          'data-uid': 'peer:' + branch.rootId,
                          'data-running': pRun ? '1' : '0',
                          draggable: true,
                          title: `${pPeer.name || shortSession(branch.rootId)}\n${pSummary}`,
                          style: {
                            '--pod-dot': branch.accent.dot,
                            '--pod-bg': branch.accent.bg,
                            '--pod-border': branch.accent.border,
                            '--pod-text': branch.accent.text,
                          },
                          onDragStart: e => beginDragItem(e, { fromZone: 'inside', kind: 'peer-session', id: branch.rootId, branch }),
                          onDragEnd: endDragItem,
                        },
                        pRun
                          ? h('span', { className: 'dnb-spin-ring', style: { '--dnb-spin-size': '8px', color: branch.accent.dot } })
                          : h('span', { className: 'dnb-squad-dot', style: { background: branch.accent.dot, width: 7.5, height: 7.5 } }),
                        h(
                          'div',
                          { className: 'dnb-ally-info' },
                          h(
                            'div',
                            { className: 'dnb-ally-name-row' },
                            h('span', { className: 'dnb-tier-badge', 'data-tier': 'peer' }, bi('联动', 'Link')),
                            h('span', { className: 'dnb-ally-name' }, pPeer.name || shortSession(branch.rootId)),
                          ),
                          h('div', { className: 'dnb-ally-sub' }, pSummary),
                        ),
                        h(
                          'div',
                          { className: 'dnb-ally-acts' },
                          pPeer.key
                            ? h('button', {
                                type: 'button',
                                className: 'dnb-mini-btn',
                                title: bi('向该联动窗口递话', 'Relay to linked window'),
                                onClick: () => {
                                  patch({
                                    secTarget: pPeer.key,
                                    secMode: pRun ? 'steer' : 'followup',
                                    notice: bi('已在下方锁定 @', 'Locked target @') + (pPeer.name || pPeer.key),
                                  })
                                  focusSecInput()
                                },
                              }, '@递话')
                            : null,
                          h('button', {
                            type: 'button',
                            className: 'dnb-mini-btn',
                            title: bubbleLocked ? bi('编队已锁，请先急停或等完工后移出', 'Locked while active') : bi('移出当前水泡', 'Eject from Bubble'),
                            onClick: () => performLeave({ kind: 'peer-session', id: branch.rootId, branch }),
                          }, bubbleLocked ? '🔒' : '×'),
                        ),
                      ),
                      branch.children.length > 0
                        ? h(
                            'div',
                            { className: 'dnb-liquid-satellites', 'data-compact': '1' },
                            h('span', { className: 'dnb-liquid-sat-prefix' }, `↳ ${bi('次', 'Sub')}`),
                            branch.children.map((sub) => {
                              const sPeer = sub.raw || {}
                              const sRun = sPeer.status === 'running'
                              const subName = sPeer.name || shortSession(sPeer.id)
                              return h(
                                'div',
                                {
                                  key: sub.uid,
                                  className: 'dnb-liquid-sat-pill',
                                  'data-tier': 'secondary',
                                  'data-running': sRun ? '1' : '0',
                                  title: `${subName}${sPeer.taskTitle ? ' — ' + sPeer.taskTitle : ''}`,
                                },
                                h('span', { className: 'dnb-squad-dot', style: { background: branch.accent.dot, width: 5.5, height: 5.5 } }),
                                h('span', { className: 'dnb-liquid-sat-name' }, subName),
                              )
                            }),
                          )
                        : null,
                    )
                  }),
                )
              : null,
          ),
        ),

        // Inline External Harness One-Click Dispatch Bar
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
              h(HarnessLogoIcon, { provider: dispatchTarget, size: 16 }),
              h('span', { className: 'dnb-dispatch-target-tag' }, '@' + ((dispatchHarnessMeta && dispatchHarnessMeta.label) || dispatchTarget)),
              h('input', {
                type: 'text',
                className: 'dnb-input',
                style: { flex: 1, height: 28, fontSize: 11.5 },
                value: dispatchText,
                placeholder: bi(`向 @${dispatchTarget} 下达任务（自动入队锁定并附带红线与物理墙）…`, `Task for @${dispatchTarget} (auto-enrolls, locks & prepends redlines)…`),
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

        // Compact Standby Pill Dock (Strictly ONLY locally installed Harnesses & open DSH windows)
        h(
          'div',
          {
            className: 'dnb-liquid-dock',
            'data-dragover': dragOverZone === 'outside' ? '1' : '0',
            onDragOver: e => handleZoneDragOver(e, 'inside', 'outside'),
            onDragLeave: () => { if (dragOverZone === 'outside') setDragOverZone('') },
            onDrop: handleStandbyDrop,
          },
          h(
            'div',
            { className: 'dnb-dock-head' },
            h(
              'span',
              { className: 'dnb-dock-title' },
              h('span', { className: 'dnb-dock-dot' }),
              bi('待命池 · 本机已检测可用', 'Standby · Local Ready'),
            ),
            h(
              'span',
              { className: 'dnb-dock-hint' },
              hasStandby
                ? bi('拖入水泡或点 + 入队', 'Drag up or tap + to join')
                : bi('仅展示本机已配置的外部工具与独立窗口', 'Only locally configured tools & open sessions'),
            ),
          ),
          hasStandby
            ? h(
                'div',
                { className: 'dnb-dock-flow' },
                readyStandbyHarnesses.map((hItem) => {
                  const roleText = hItem.roleHint || hItem.role || bi('本机外部执行引擎', 'Local external Harness')
                  const isSelTarget = dispatchTarget === hItem.provider
                  return h(
                    'div',
                    {
                      key: 'harness:' + hItem.provider,
                      className: 'dnb-dock-pill',
                      'data-kind': 'standby-harness',
                      'data-uid': 'standby-harness:' + hItem.provider,
                      'data-provider': hItem.provider,
                      draggable: true,
                      title: `${hItem.label || hItem.provider}（${hItem.configLabel || bi('已安装', 'Ready')}）\n${roleText}${hItem.binaryPath ? '\n' + hItem.binaryPath : ''}`,
                      onDragStart: e => beginDragItem(e, { fromZone: 'outside', kind: 'standby-harness', id: hItem.provider, item: hItem }),
                      onDragEnd: endDragItem,
                      onClick: () => performJoin({ kind: 'standby-harness', id: hItem.provider, item: hItem }),
                    },
                    h(HarnessLogoIcon, { provider: hItem.provider, size: 14 }),
                    h('span', { className: 'dnb-dock-pill-name' }, hItem.label || hItem.provider),
                    h('button', {
                      type: 'button',
                      className: 'dnb-dock-bolt-btn',
                      'data-active': isSelTarget ? '1' : '0',
                      title: bi('⚡ 一键调用并自动纳入水泡锁死', '⚡ One-click run & lock'),
                      onClick: (e) => {
                        e.stopPropagation()
                        setDispatchTarget(d => (d === hItem.provider ? '' : hItem.provider))
                      },
                    }, '⚡'),
                    h('span', { className: 'dnb-dock-plus' }, bubbleLocked ? '🔒' : '+'),
                  )
                }),
                squad.standbySessions.map((sess) => {
                  const col = colorForRootSession(sess.id, selfRootId)
                  const sessTitle = sess.name || shortSession(sess.id)
                  const desc = sess.objective || sess.progressSummary || bi('已打开的独立会话窗口，可拖拽或点击入队', 'Standalone window ready to join')
                  return h(
                    'div',
                    {
                      key: 'sess:' + sess.id,
                      className: 'dnb-dock-pill',
                      'data-kind': 'standby-session',
                      'data-uid': 'standby-sess:' + sess.id,
                      draggable: true,
                      title: `${sessTitle}\n${desc}`,
                      onDragStart: e => beginDragItem(e, { fromZone: 'outside', kind: 'standby-session', id: sess.id, item: sess }),
                      onDragEnd: endDragItem,
                      onClick: () => performJoin({ kind: 'standby-session', id: sess.id, item: sess }),
                    },
                    h('span', { className: 'dnb-squad-dot', style: { background: col.dot, width: 7, height: 7 } }),
                    h('span', { className: 'dnb-dock-pill-name' }, sessTitle),
                    h('span', { className: 'dnb-dock-plus' }, bubbleLocked ? '🔒' : '+'),
                  )
                }),
              )
            : h(
                'div',
                { className: 'dnb-dock-empty' },
                hasRightAllies
                  ? bi('已检测到的本机外协工具与独立窗口均已入队。', 'All detected local Harnesses and standalone windows are enrolled.')
                  : bi('暂未检测到其他可加入的本机外部 Harness 或独立窗口。', 'No standby local Harnesses or standalone windows detected.'),
              ),
        ),
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
