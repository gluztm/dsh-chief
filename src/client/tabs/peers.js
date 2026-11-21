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
import { call, loadChiefView, requestTogglePeerLink } from '../api.js'
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
        title: bi('已断开的历史（不发给主对话）', 'Disconnected History (Isolated)'),
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
        title: bi('🌐 全体广播 (@全体)', '🌐 Broadcast (@All)'),
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
        title: `🔀 ${sorted.slice(0, 3).map(labelForRoot).join(' · ')}${sorted.length > 3 ? bi(` 等${sorted.length}个窗口`, ` +${sorted.length}`) : ''} ${bi('多窗对话', 'Group Chat')}`,
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
          title: `↔ ${labelForRoot(pair[0])} ↔ ${labelForRoot(pair[1])} ${bi('跨窗消息', 'Cross-Window')}`,
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
      title: `📁 ${labelForRoot(internalRoot)} ${bi('内部消息', 'Internal')}`,
      colors: [col],
      order: internalRoot === selfRootId ? 3 : 4,
      defaultOpen: internalRoot === selfRootId,
    }).items.push(mail)
  }

  const drawerList = [...drawersMap.values()]
    .filter(d => mailFilter === 'all' || (mailFilter === 'detached' ? d.kind === 'detached' : d.kind === mailFilter))
    .sort((a, b) => a.order - b.order)

  const hasLinkedNetwork = peers.some(p => p && p.kind === 'peer-session')
  const fedOpen = (view.peersFedCollapsed === null || view.peersFedCollapsed === undefined)
    ? otherSessions.length > 0
    : !view.peersFedCollapsed

  return h(
    'div',
    { className: 'dnb-view' },
    // Section 1: Active Interconnected Peers (Lead + Subagents + Linked Windows)
    h(
      AccCard,
      {
        open: !view.peersNetCollapsed,
        onToggle: () => patch({ peersNetCollapsed: !view.peersNetCollapsed }),
        title: bi('已连接的对话和助手', 'Connected Chats & Agents'),
        headTitle: hasLinkedNetwork
          ? bi('连上的窗口会共享进度和消息。断开后两边资料会立刻分开，互不影响。', 'Linked windows share progress and messages. Unlinking separates their summaries right away.')
          : undefined,
        count: peers.length ? String(peers.length) : '',
        preview: peers.length ? peers.slice(0, 3).map(p => p.name).join(' · ') : bi('等待连接对话…', 'Waiting for chats…'),
        bodyStyle: { padding: 0 },
        actions: h(
          React.Fragment,
          null,
          (hiddenProbePeers.length > 0 || (view.showInternalProbes && rawPeers.some(p => p && isInternalProbeName(p.name || p.key))))
            ? h('button', {
                type: 'button',
                className: 'dnb-pill',
                style: { height: 22, fontSize: 10.5, padding: '0 7px', borderStyle: 'dashed' },
                onClick: () => patch({ showInternalProbes: !view.showInternalProbes }),
              }, view.showInternalProbes ? bi('隐藏后台检查', 'Hide Checks') : bi(`后台检查 (${hiddenProbePeers.length})`, `Checks (${hiddenProbePeers.length})`))
            : null,
          peers.length > 1
            ? h('button', {
                type: 'button',
                className: 'dnb-pill dnb-pill-accent',
                style: { height: 22, fontSize: 10.5, padding: '0 8px' },
                onClick: () => {
                  patch({ secTarget: 'all', secMode: 'steer', notice: bi('已选好发给所有人，请在下方输入', 'Sending to everyone; type below') })
                  focusSecInput()
                },
              }, bi('@发给全体', '@Message All'))
            : null,
        ),
      },
      peers.length
        ? peers.map(peer => {
            const isRunning = peer.status === 'running'
            const kindBadge = peer.kind === 'lead' ? bi('主对话', 'Lead') : peer.kind === 'peer-session' ? bi('联动窗口', 'Linked') : bi('子代理', 'Subagent')
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
                      style: { height: 24, padding: '0 8px', fontSize: 10.5 },
                      title: bi('在分屏查看子代理对话', 'View subagent chat in split pane'),
                      onClick: () => {
                        if (!openSubagentChat(peer)) patch({ notice: bi('这个子代理没有独立聊天窗口', 'This subagent has no separate chat pane') })
                      },
                    }, h(Icon, { name: 'chat', size: 11 }), bi('分屏', 'Split'))
                  : null,
                h('button', {
                  className: 'dnb-pill',
                  'data-active': isSelected ? '1' : '0',
                  style: { height: 24, padding: '0 8px', fontSize: 10.5 },
                  onClick: () => {
                    patch({
                      secTarget: peer.key,
                      secMode: isRunning ? 'steer' : 'followup',
                      notice: bi('已选好发给 @', 'Sending to @') + peer.name,
                    })
                    focusSecInput()
                  },
                }, bi('@递话', '@Relay')),
              ),
            )
          })
        : h('div', { className: 'dnb-empty', style: { padding: '16px 12px' } }, bi('还没有连接其他对话…', 'Waiting for chats…')),
    ),

    // Section 2: Cross-Window Federation Switches (with pollution warning before link)
    h(
      AccCard,
      {
        open: fedOpen,
        onToggle: () => patch({ peersFedCollapsed: fedOpen }),
        icon: h(Icon, { name: 'link', size: 12.5, style: { color: 'var(--dnb-text-2)' } }),
        title: bi('连接其他对话窗口', 'Connect Other Windows'),
        count: otherSessions.length ? `${otherSessions.filter(s => s.linked).length}/${otherSessions.length}` : '0',
        preview: bi('同时开了多个窗口时可在这里连接', 'Link multiple open chat windows here'),
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
                onChange: on => requestTogglePeerLink(sess, on),
              }),
            )
          })
        : h('div', { style: { padding: '12px 14px', fontSize: 11.5, color: 'var(--dnb-text-3)', lineHeight: 1.5 } },
            bi('同时打开多个对话窗口时，这里会出现开关。连上后会共享进度和消息；如果任务无关，会先弹出提醒。', 'Switches appear here when multiple chat windows are open. Linked windows share progress and messages, with a warning for unrelated tasks.')),
    ),

    // Section 3: Color-Coded Collapsible Drawer Mailbox
    h(
      AccCard,
      {
        open: !view.peersMailCollapsed,
        onToggle: () => patch({ peersMailCollapsed: !view.peersMailCollapsed }),
        icon: h(Icon, { name: 'mail', size: 12.5, style: { color: 'var(--dnb-text-2)' } }),
        title: bi('协同消息记录', 'Team Messages'),
        count: mailbox.length ? String(mailbox.length) : '',
        preview: drawerList.length ? bi(`${drawerList.length} 组消息`, `${drawerList.length} groups`) : bi('还没有消息记录', 'No messages yet'),
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
                  h('span', { className: 'dnb-acc-pull-hint' }, isOpen ? bi('收起 ▴', 'Collapse ▴') : bi('展开 ▾', 'Expand ▾')),
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
        : h('div', { className: 'dnb-empty', style: { padding: '16px 12px' } }, bi('这个分类下还没有消息', 'No messages in this filter')),
    ),
  )
}

/* ------------------------------------ Header Model Popover & Suggestions */
