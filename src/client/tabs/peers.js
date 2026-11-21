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

  const [dragPayload, setDragPayload] = React.useState(null)
  const [dropActive, setDropActive] = React.useState('')
  const [confirmStop, setConfirmStop] = React.useState(false)
  const [dispatchTarget, setDispatchTarget] = React.useState('')
  const [dispatchText, setDispatchText] = React.useState('')
  const [showCatalog, setShowCatalog] = React.useState(false)
  const [lockShake, setLockShake] = React.useState(false)

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

  const triggerLockedReject = (reasonHint) => {
    setLockShake(true)
    patch({
      notice: reasonHint || bi(
        '🔒 协同水泡工作中已锁死结构，禁止拆解成员；请等待全员收工或点击「⏹ 急停解体」',
        '🔒 Bubble locked while working; wait until settled or click Emergency Stop',
      ),
    })
  }

  const readDropData = (e) => {
    if (dragPayload) return dragPayload
    try {
      const raw = e && e.dataTransfer ? e.dataTransfer.getData('application/x-dsh-bubble') : ''
      if (raw) return JSON.parse(raw)
    } catch {}
    return null
  }

  const handleDropIntoBubble = (e) => {
    e.preventDefault()
    setDropActive('')
    const payload = readDropData(e)
    setDragPayload(null)
    if (!payload) return
    if (bubbleLocked) {
      triggerLockedReject()
      return
    }
    if (payload.kind === 'session' && payload.sess) {
      if (!payload.sess.linked) requestTogglePeerLink(payload.sess, true)
    } else if (payload.kind === 'harness' && payload.harness && payload.source === 'outside') {
      void toggleBubbleHarness(payload.harness.provider, true, {
        label: payload.harness.label,
        role: payload.harness.roleHint || payload.harness.role,
      })
    }
  }

  const handleDropOutToPool = (e) => {
    e.preventDefault()
    setDropActive('')
    const payload = readDropData(e)
    setDragPayload(null)
    if (!payload) return
    if (bubbleLocked) {
      triggerLockedReject()
      return
    }
    if (payload.kind === 'session' && payload.sess && payload.sess.linked) {
      requestTogglePeerLink(payload.sess, false)
    } else if (payload.kind === 'harness' && payload.harness && payload.source === 'inside') {
      void toggleBubbleHarness(payload.harness.provider, false, { label: payload.harness.label })
    }
  }

  const fedOpen = (view.peersFedCollapsed === null || view.peersFedCollapsed === undefined)
    ? otherSessions.length > 0
    : !view.peersFedCollapsed

  return h(
    'div',
    { className: 'dnb-view' },
    // Section 1: Dynamic Water Bubble Squad & External Harness Arena (Experimental)
    h(
      AccCard,
      {
        open: !view.peersNetCollapsed,
        onToggle: () => patch({ peersNetCollapsed: !view.peersNetCollapsed }),
        title: bi('🫧 协同作战水泡（实验）', '🫧 Collab Bubble Squad (Exp)'),
        headTitle: bubbleLocked
          ? bi('编队已锁定：运行期间禁止拆散会话或外部 Harness，仅可通过急停安全解体', 'Locked during work: member removal blocked until done or emergency stop')
          : bi('将待命独立会话或外部 Harness 拖入大水泡，即可交由参谋长统一调度协同', 'Drag standby sessions or external Harnesses into the Bubble for unified orchestration'),
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
        // Status & Structural Lock Control Strip
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
                : bi('🫧 整备态 · 拖入/点选成员入泡', '🫧 Staging · Drag or + to join'),
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

        // Big Organic Water Bubble Arena (Drop target IN)
        h(
          'div',
          {
            className: 'dnb-bubble-arena',
            'data-locked': bubbleLocked ? '1' : '0',
            'data-drop': dropActive === 'bubble' ? '1' : '0',
            'data-shake': lockShake ? '1' : '0',
            onDragOver: (e) => {
              e.preventDefault()
              if (dropActive !== 'bubble') setDropActive('bubble')
            },
            onDragLeave: (e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) setDropActive('')
            },
            onDrop: handleDropIntoBubble,
          },
          h('div', { className: 'dnb-bubble-membrane', 'aria-hidden': 'true' }),
          // Central Coordinator Anchor
          h(
            'div',
            { className: 'dnb-bubble-core' },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } },
              h('span', { className: 'dnb-bubble-core-orb' }, '✦'),
              h('span', { style: { fontWeight: 700, fontSize: 12.5 } }, bi('DSH 参谋长 · 调度水泡核心', 'DSH Chief · Bubble Core')),
            ),
            h('span', { className: 'dnb-tag', style: { fontSize: 10 } }, `${totalInBubble} ${bi('在线成员', 'members')}`),
          ),

          // Enrolled Members Inside the Bubble
          h(
            'div',
            { className: 'dnb-bubble-members' },
            peers.map(peer => {
              const isRunning = peer.status === 'running'
              const isLinkedPeer = peer.kind === 'peer-session'
              const kindBadge = peer.kind === 'lead'
                ? bi('主对话', 'Lead')
                : (isLinkedPeer ? bi('联动窗口', 'Linked') : bi('子代理', 'Subagent'))
              const isSelected = view.secTarget === peer.key
              const peerRootId = isLinkedPeer ? (peer.id || peer.rootSessionId) : (peer.rootSessionId || selfRootId)
              const col = colorForRootSession(peerRootId, selfRootId)
              const linkedSessObj = isLinkedPeer ? otherSessions.find(s => s && s.id === peerRootId) : null
              const subText = peer.taskTitle || peer.progressSummary || ''
              return h(
                'div',
                {
                  key: peer.key,
                  className: 'dnb-droplet',
                  'data-kind': peer.kind,
                  'data-running': isRunning ? '1' : '0',
                  draggable: isLinkedPeer && !bubbleLocked,
                  style: {
                    '--drop-dot': col.dot,
                    '--drop-bg': col.bg,
                    '--drop-border': col.border,
                    '--drop-text': col.text,
                  },
                  onDragStart: (e) => {
                    if (!isLinkedPeer || bubbleLocked) {
                      e.preventDefault()
                      if (bubbleLocked) triggerLockedReject()
                      return
                    }
                    const payload = { kind: 'session', source: 'inside', sess: linkedSessObj || { id: peerRootId, name: peer.name, linked: true } }
                    setDragPayload(payload)
                    try { e.dataTransfer.setData('application/x-dsh-bubble', JSON.stringify(payload)) } catch {}
                  },
                  onDragEnd: () => { setDragPayload(null); setDropActive('') },
                },
                h(
                  'div',
                  { className: 'dnb-droplet-main' },
                  isRunning
                    ? h('span', { className: 'dnb-spin-ring', style: { '--dnb-spin-size': '9px', color: col.dot } })
                    : h('span', { className: 'dnb-droplet-dot', style: { background: col.dot } }),
                  h('span', { className: 'dnb-droplet-name', title: subText || peer.name }, peer.name),
                  h('span', { className: 'dnb-droplet-kind' }, kindBadge),
                ),
                subText ? h('div', { className: 'dnb-droplet-sub', title: subText }, subText) : null,
                h(
                  'div',
                  { className: 'dnb-droplet-acts' },
                  peer.kind === 'subagent' && peer.id
                    ? h('button', {
                        type: 'button',
                        className: 'dnb-pill',
                        style: { height: 20, padding: '0 6px', fontSize: 10 },
                        title: bi('在分栏打开子代理实时流', 'Open subagent live stream in split pane'),
                        onClick: () => {
                          if (!openSubagentChat(peer)) patch({ notice: bi('该子代理暂无独立面板视图', 'No dedicated pane view for this subagent') })
                        },
                      }, h(Icon, { name: 'chat', size: 10 }), bi('分屏', 'Split'))
                    : null,
                  h('button', {
                    type: 'button',
                    className: 'dnb-pill',
                    'data-active': isSelected ? '1' : '0',
                    style: { height: 20, padding: '0 6px', fontSize: 10 },
                    onClick: () => {
                      patch({
                        secTarget: peer.key,
                        secMode: isRunning ? 'steer' : 'followup',
                        notice: bi('已在下方锁定 @', 'Locked target @') + peer.name,
                      })
                      focusSecInput()
                    },
                  }, bi('@递话', '@Relay')),
                  isLinkedPeer
                    ? h('button', {
                        type: 'button',
                        className: 'dnb-pill',
                        style: { height: 20, padding: '0 5px', fontSize: 10 },
                        title: bubbleLocked
                          ? bi('🔒 工作中禁止拆出联动窗口', '🔒 Locked while working')
                          : bi('拖出或点此脱离联动窗口', 'Eject linked session from Bubble'),
                        onClick: () => {
                          if (bubbleLocked) { triggerLockedReject(); return }
                          requestTogglePeerLink(linkedSessObj || { id: peerRootId, name: peer.name }, false)
                        },
                      }, bubbleLocked ? '🔒' : '×')
                    : null,
                ),
              )
            }),

            enrolledHarnesses.map(hItem => {
              const isRunning = Boolean(hItem.running)
              const acc = hItem.accent || '#38bdf8'
              const isDisp = dispatchTarget === hItem.provider
              const harnessRoleText = hItem.role || hItem.roleHint || bi('外部独立执行进程', 'External Harness')
              return h(
                'div',
                {
                  key: 'harness:' + hItem.provider,
                  className: 'dnb-droplet',
                  'data-kind': 'harness',
                  'data-running': isRunning ? '1' : '0',
                  draggable: !bubbleLocked,
                  style: {
                    '--drop-dot': acc,
                    '--drop-bg': `${acc}1e`,
                    '--drop-border': `${acc}58`,
                    '--drop-text': acc,
                  },
                  onDragStart: (e) => {
                    if (bubbleLocked) {
                      e.preventDefault()
                      triggerLockedReject()
                      return
                    }
                    const payload = { kind: 'harness', source: 'inside', harness: hItem }
                    setDragPayload(payload)
                    try { e.dataTransfer.setData('application/x-dsh-bubble', JSON.stringify(payload)) } catch {}
                  },
                  onDragEnd: () => { setDragPayload(null); setDropActive('') },
                },
                h(
                  'div',
                  { className: 'dnb-droplet-main' },
                  isRunning
                    ? h('span', { className: 'dnb-spin-ring', style: { '--dnb-spin-size': '9px', color: acc } })
                    : h('span', { className: 'dnb-droplet-dot', style: { background: acc } }),
                  h('span', { className: 'dnb-droplet-name' }, hItem.label),
                  h('span', { className: 'dnb-droplet-kind' }, hItem.installed ? 'Harness' : bi('未安装后端', 'Not Installed')),
                ),
                h('div', { className: 'dnb-droplet-sub', title: harnessRoleText }, `${hItem.provider} · ${harnessRoleText}`),
                h(
                  'div',
                  { className: 'dnb-droplet-acts' },
                  h('button', {
                    type: 'button',
                    className: 'dnb-pill',
                    'data-active': isDisp ? '1' : '0',
                    style: { height: 20, padding: '0 6px', fontSize: 10 },
                    title: bi('向该外部 Harness 派发一条独立任务（自动加结构锁）', 'Dispatch one-shot task to external Harness (auto-locks Bubble)'),
                    onClick: () => setDispatchTarget(isDisp ? '' : hItem.provider),
                  }, bi('⚡ 派活', '⚡ Run')),
                  h('button', {
                    type: 'button',
                    className: 'dnb-pill',
                    style: { height: 20, padding: '0 5px', fontSize: 10 },
                    title: bubbleLocked
                      ? bi('🔒 工作中禁止移出外部 Harness', '🔒 Locked while working')
                      : bi('从协同水泡移出该 Harness', 'Remove Harness from Bubble'),
                    onClick: () => {
                      if (bubbleLocked) { triggerLockedReject(); return }
                      if (isDisp) setDispatchTarget('')
                      void toggleBubbleHarness(hItem.provider, false, { label: hItem.label })
                    },
                  }, bubbleLocked ? '🔒' : '×'),
                ),
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
        ),

        // Outer Standby Pool (Drop target OUT to eject when unlocked; Drag/Click IN to join)
        h(
          'div',
          {
            className: 'dnb-bubble-pool',
            'data-locked': bubbleLocked ? '1' : '0',
            'data-drop': dropActive === 'pool' ? '1' : '0',
            onDragOver: (e) => {
              e.preventDefault()
              if (dropActive !== 'pool') setDropActive('pool')
            },
            onDragLeave: (e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) setDropActive('')
            },
            onDrop: handleDropOutToPool,
          },
          h(
            'div',
            { className: 'dnb-bubble-pool-head' },
            h('span', null, bi('外围待命池（拖入或点 + 加入大水泡）', 'Standby Pool (Drag or + into Bubble)')),
            catalogHarnesses.length > 0
              ? h('button', {
                  type: 'button',
                  className: 'dnb-pill',
                  style: { height: 20, padding: '0 7px', fontSize: 10 },
                  onClick: () => setShowCatalog(v => !v),
                }, showCatalog ? bi('收起安装目录', 'Hide Catalog') : bi(`官方外部 Harness (${catalogHarnesses.length})`, `Official Harnesses (${catalogHarnesses.length})`))
              : null,
          ),
          (standbySessions.length > 0 || availableHarnesses.length > 0)
            ? h(
                'div',
                { className: 'dnb-bubble-pool-list' },
                standbySessions.map(sess => {
                  const col = colorForRootSession(sess.id, selfRootId)
                  return h(
                    'div',
                    {
                      key: 'pool-sess:' + sess.id,
                      className: 'dnb-droplet dnb-droplet-standby',
                      draggable: !bubbleLocked,
                      style: {
                        '--drop-dot': col.dot,
                        '--drop-bg': col.bg,
                        '--drop-border': col.border,
                        '--drop-text': col.text,
                      },
                      onDragStart: (e) => {
                        if (bubbleLocked) { e.preventDefault(); triggerLockedReject(); return }
                        const payload = { kind: 'session', source: 'outside', sess }
                        setDragPayload(payload)
                        try { e.dataTransfer.setData('application/x-dsh-bubble', JSON.stringify(payload)) } catch {}
                      },
                      onDragEnd: () => { setDragPayload(null); setDropActive('') },
                    },
                    h(
                      'div',
                      { className: 'dnb-droplet-main' },
                      h('span', { className: 'dnb-droplet-dot', style: { background: col.dot } }),
                      h('span', { className: 'dnb-droplet-name' }, sess.name),
                      h('span', { className: 'dnb-droplet-kind' }, bi('独立会话', 'Session')),
                    ),
                    h('button', {
                      type: 'button',
                      className: 'dnb-pill',
                      style: { height: 20, padding: '0 7px', fontSize: 10 },
                      onClick: () => {
                        if (bubbleLocked) { triggerLockedReject(); return }
                        requestTogglePeerLink(sess, true)
                      },
                    }, bubbleLocked ? '🔒' : bi('+ 入泡', '+ Join')),
                  )
                }),
                availableHarnesses.map(hItem => {
                  const acc = hItem.accent || '#38bdf8'
                  return h(
                    'div',
                    {
                      key: 'pool-harness:' + hItem.provider,
                      className: 'dnb-droplet dnb-droplet-standby',
                      'data-kind': 'harness',
                      draggable: !bubbleLocked,
                      style: {
                        '--drop-dot': acc,
                        '--drop-bg': `${acc}1c`,
                        '--drop-border': `${acc}52`,
                        '--drop-text': acc,
                      },
                      onDragStart: (e) => {
                        if (bubbleLocked) { e.preventDefault(); triggerLockedReject(); return }
                        const payload = { kind: 'harness', source: 'outside', harness: hItem }
                        setDragPayload(payload)
                        try { e.dataTransfer.setData('application/x-dsh-bubble', JSON.stringify(payload)) } catch {}
                      },
                      onDragEnd: () => { setDragPayload(null); setDropActive('') },
                    },
                    h(
                      'div',
                      { className: 'dnb-droplet-main' },
                      h('span', { className: 'dnb-droplet-dot', style: { background: acc } }),
                      h('span', { className: 'dnb-droplet-name' }, hItem.label),
                      h('span', { className: 'dnb-droplet-kind' }, hItem.provider),
                    ),
                    h('button', {
                      type: 'button',
                      className: 'dnb-pill',
                      style: { height: 20, padding: '0 7px', fontSize: 10 },
                      onClick: () => {
                        if (bubbleLocked) { triggerLockedReject(); return }
                        void toggleBubbleHarness(hItem.provider, true, { label: hItem.label, role: hItem.roleHint })
                      },
                    }, bubbleLocked ? '🔒' : bi('+ 入泡', '+ Join')),
                  )
                }),
              )
            : h('div', { style: { fontSize: 11, color: 'var(--dnb-text-3)', padding: '2px 0' } },
                bi('再打开一个 DSH 主窗口，或安装 Codex / Claude Code / ACP Harness 包，即可出现在此拖入大水泡。', 'Open another DSH window or install an external Harness plugin to drag into the Bubble.')),

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
