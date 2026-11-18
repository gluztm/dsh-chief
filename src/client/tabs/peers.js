/**
 * tabs/peers.js
 *
 * Subagent and cross-session collaboration tab.
 */

import { React, h } from '../react-runtime.js'
import { SESSION_PALETTE } from '../constants.js'
import { patch, focusSecInput, openSubagentChat } from '../store.js'
import {
  clampTitle,
  shortSession,
  relativeTimeLabel,
  isInternalProbeName,
  colorForRootSession,
} from '../utils.js'
import { call, loadChiefView, requestTogglePeerLink } from '../api.js'
import { Icon, Switch } from '../components/common.js'

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
        title: '已脱离协同历史（已隔离不注入）',
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
        title: '🌐 全网广播 (@全体)',
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
        title: `🔀 ${sorted.slice(0, 3).map(labelForRoot).join(' · ')}${sorted.length > 3 ? ` 等${sorted.length}窗` : ''} 多方协同`,
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
          title: `↔ ${labelForRoot(pair[0])} ↔ ${labelForRoot(pair[1])} 跨窗传话`,
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
      title: `📁 ${labelForRoot(internalRoot)} 内部信箱`,
      colors: [col],
      order: internalRoot === selfRootId ? 3 : 4,
      defaultOpen: internalRoot === selfRootId,
    }).items.push(mail)
  }

  const drawerList = [...drawersMap.values()]
    .filter(d => mailFilter === 'all' || (mailFilter === 'detached' ? d.kind === 'detached' : d.kind === mailFilter))
    .sort((a, b) => a.order - b.order)

  const hasLinkedNetwork = peers.some(p => p && p.kind === 'peer-session')

  return h(
    'div',
    { className: 'dnb-view' },
    // Section 1: Active Interconnected Peers (Lead + Subagents + Linked Windows)
    h(
      'div',
      { className: 'dnb-section-head' },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
        h('span', null, '当前互通对话网络'),
        hasLinkedNetwork
          ? h('span', {
              className: 'dnb-tag',
              style: { fontSize: 10, background: 'rgba(16,185,129,0.12)', color: '#10b981', fontWeight: 600 },
              title: '已入网的独立对话会自动共享进度与协同信箱；断开联动后参谋摘要立即净化隔离',
            }, '进度实时互通中')
          : null,
      ),
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 5 } },
        (hiddenProbePeers.length > 0 || (view.showInternalProbes && rawPeers.some(p => p && isInternalProbeName(p.name || p.key))))
          ? h('button', {
              className: 'dnb-pill',
              style: { height: 22, fontSize: 10.5, padding: '0 7px', borderStyle: 'dashed' },
              onClick: () => patch({ showInternalProbes: !view.showInternalProbes }),
            }, view.showInternalProbes ? '隐藏内部探针' : `内部探针 (${hiddenProbePeers.length})`)
          : null,
        peers.length > 1
          ? h('button', {
              className: 'dnb-pill dnb-pill-accent',
              style: { height: 22, fontSize: 11, padding: '0 8px' },
              onClick: () => {
                patch({ secTarget: 'all', secMode: 'steer', notice: '已选择向全体成员广播递话' })
                focusSecInput()
              },
            }, '@全体广播')
          : null,
      ),
    ),
    peers.length
      ? h(
          'div',
          { className: 'dnb-group' },
          peers.map(peer => {
            const isRunning = peer.status === 'running'
            const kindBadge = peer.kind === 'lead' ? '主对话' : peer.kind === 'peer-session' ? '联动窗口' : '子代理'
            const isSelected = view.secTarget === peer.key
            const peerRootId = peer.kind === 'peer-session'
              ? (peer.id || peer.rootSessionId)
              : (peer.rootSessionId || selfRootId)
            const col = colorForRootSession(peerRootId, selfRootId)
            const subText = peer.taskTitle || peer.progressSummary || ''
            return h(
              'div',
              {
                key: peer.key,
                className: 'dnb-cell dnb-cell-hover',
                style: {
                  justifyContent: 'space-between',
                  gap: 8,
                  borderLeft: `3px solid ${col.dot}`,
                },
              },
              h(
                'div',
                { style: { flex: 1, minWidth: 0 } },
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
                  isRunning
                    ? h('span', { className: 'dnb-spin-ring', style: { '--dnb-spin-size': '9px', color: col.dot } })
                    : h('span', {
                        style: {
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: col.dot,
                          boxShadow: `0 0 0 2px ${col.bg}`,
                          flexShrink: 0,
                        },
                      }),
                  h('span', { style: { fontWeight: 600, fontSize: 12.5 } }, peer.name),
                  h('span', {
                    className: 'dnb-tag',
                    style: { fontSize: 10, background: col.bg, color: col.text, border: `1px solid ${col.border}` },
                  }, kindBadge),
                ),
                subText
                  ? h('div', {
                      style: {
                        fontSize: 11.5,
                        color: 'var(--dnb-text-2)',
                        marginTop: 3,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      },
                      title: subText,
                    }, subText)
                  : null,
              ),
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 } },
                peer.kind === 'subagent' && peer.id
                  ? h('button', {
                      className: 'dnb-pill',
                      style: { height: 25, padding: '0 8px', fontSize: 11 },
                      title: '在分栏打开子代理实时流',
                      onClick: () => {
                        if (!openSubagentChat(peer)) patch({ notice: '该子代理暂无独立面板视图' })
                      },
                    }, h(Icon, { name: 'chat', size: 11.5 }), '分屏')
                  : null,
                h('button', {
                  className: 'dnb-pill',
                  'data-active': isSelected ? '1' : '0',
                  style: { height: 25, padding: '0 9px', fontSize: 11 },
                  onClick: () => {
                    patch({
                      secTarget: peer.key,
                      secMode: isRunning ? 'steer' : 'followup',
                      notice: '已在下方锁定 @' + peer.name,
                    })
                    focusSecInput()
                  },
                }, '@递话'),
              ),
            )
          }),
        )
      : h('div', { className: 'dnb-group' }, h('div', { className: 'dnb-empty', style: { padding: '16px 12px' } }, '等待会话连接…')),

    // Section 2: Cross-Window Federation Switches (with pollution warning before link)
    h(
      'div',
      { className: 'dnb-section-head', style: { marginTop: 12 } },
      h(
        'span',
        { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } },
        h(Icon, { name: 'link', size: 12 }),
        '跨窗口独立会话联动',
      ),
      otherSessions.length ? h('span', null, otherSessions.filter(s => s.linked).length + '/' + otherSessions.length) : null,
    ),
    otherSessions.length
      ? h(
          'div',
          { className: 'dnb-group' },
          otherSessions.map(sess => {
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
                onChange: on => requestTogglePeerLink(sess, on),
              }),
            )
          }),
        )
      : h(
          'div',
          { className: 'dnb-group' },
          h('div', { style: { padding: '12px 14px', fontSize: 11.5, color: 'var(--dnb-text-3)', lineHeight: 1.5 } },
            '当你同时打开多个独立主对话窗口时，这里会出现联动开关——接入后共享进度与信箱（接入无关任务会提示防污染警告）。'),
        ),

    // Section 3: Color-Coded Collapsible Drawer Mailbox
    h(
      'div',
      { className: 'dnb-section-head', style: { marginTop: 12 } },
      h(
        'span',
        { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } },
        h(Icon, { name: 'mail', size: 12 }),
        '参谋部协同信箱',
      ),
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' } },
        [
          { key: 'all', label: '全部' },
          { key: 'broadcast', label: '🌐 广播' },
          { key: 'cross', label: '↔ 跨窗' },
          { key: 'internal', label: '📁 内部' },
        ].map(f =>
          h('button', {
            key: f.key,
            type: 'button',
            className: 'dnb-mini-btn',
            'data-tone': mailFilter === f.key ? 'accent' : undefined,
            style: { height: 20, padding: '0 7px', fontSize: 10.5 },
            onClick: () => patch({ mailChannelFilter: f.key }),
          }, f.label),
        ),
        mailbox.length ? h('span', { style: { marginLeft: 3 } }, String(mailbox.length)) : null,
      ),
    ),
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
                  h('span', { className: 'dnb-tag', style: { fontSize: 10 } }, `${drawer.items.length}`),
                ),
                h(Icon, {
                  name: 'chevron',
                  size: 13,
                  style: {
                    color: 'var(--dnb-text-3)',
                    transform: isOpen ? 'rotate(90deg)' : 'none',
                    transition: 'transform 0.16s ease',
                    flexShrink: 0,
                  },
                }),
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
      : h('div', { className: 'dnb-group' }, h('div', { className: 'dnb-empty', style: { padding: '18px 12px' } }, '当前筛选下暂无协同通信记录')),
  )
}

/* ------------------------------------ Header Model Popover & Suggestions */
