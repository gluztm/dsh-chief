/**
 * components/common.js
 *
 * Shared primitives: Icon, ChiefErrorBoundary, Switch, SearchDrawer, badges, fleet bars, and structured narrative renderer.
 */

import { React, h } from '../react-runtime.js'
import { STATUSES, STATUS_LABEL, STATUS_BADGE, SIX_GOAL_ROWS_META } from '../constants.js'
import { store, patch, focusObjectiveInPyramid, openSubagentChat } from '../store.js'
import {
  clampTitle,
  shortAgentName,
  isInternalProbeName,
  buildAgentHierarchy,
  resolveTaskAgents,
} from '../utils.js'
import {
  submitChiefBar,
  loadArchives,
  loadArchiveDetail,
  searchColdArchives,
  refresh,
  act,
  searchBoard,
} from '../api.js'

export function Icon({ name, size = 14, style }) {
  const props = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    style: { display: 'inline-block', verticalAlign: '-2px', flexShrink: 0, ...style },
  }
  switch (name) {
    case 'search':
      return h('svg', props, h('circle', { cx: 11, cy: 11, r: 7 }), h('path', { d: 'm20 20-3.5-3.5' }))
    case 'refresh':
      return h('svg', props, h('path', { d: 'M20 11A8.1 8.1 0 0 0 4.5 9M4 5v4h4' }), h('path', { d: 'M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4' }))
    case 'plus':
      return h('svg', props, h('path', { d: 'M12 5v14M5 12h14' }))
    case 'x':
      return h('svg', props, h('path', { d: 'M18 6 6 18M6 6l12 12' }))
    case 'check':
      return h('svg', props, h('path', { d: 'm5 12 5 5L20 7' }))
    case 'sparkles':
      return h('svg', props,
        h('path', { d: 'M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z' }),
        h('path', { d: 'M19 16l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z' }),
      )
    case 'network':
      return h('svg', props,
        h('rect', { x: 9, y: 3, width: 6, height: 5, rx: 1.5 }),
        h('rect', { x: 3, y: 16, width: 6, height: 5, rx: 1.5 }),
        h('rect', { x: 15, y: 16, width: 6, height: 5, rx: 1.5 }),
        h('path', { d: 'M12 8v4m0 0H6v4m6-4h6v4' }),
      )
    case 'list':
      return h('svg', props, h('path', { d: 'M9 6h11M9 12h11M9 18h11M5 6h.01M5 12h.01M5 18h.01' }))
    case 'play':
      return h('svg', props, h('polygon', { points: '6 4 20 12 6 20 6 4' }))
    case 'stop':
      return h('svg', props, h('rect', { x: 6, y: 6, width: 12, height: 12, rx: 2 }))
    case 'send':
      return h('svg', props, h('path', { d: 'M22 2 11 13' }), h('polygon', { points: '22 2 15 22 11 13 2 9 22 2' }))
    case 'chat':
      return h('svg', props, h('path', { d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' }))
    case 'sliders':
      return h('svg', props, h('path', { d: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6' }))
    case 'trash':
      return h('svg', props, h('path', { d: 'M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6h12z' }))
    case 'edit':
      return h('svg', props, h('path', { d: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z' }))
    case 'copy':
      return h('svg', props, h('rect', { x: 9, y: 9, width: 12, height: 12, rx: 2 }), h('path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }))
    case 'pin':
      return h('svg', props, h('path', { d: 'M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16h14v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1z' }))
    case 'pinStamp':
      return h('svg', props,
        h('g', { transform: 'rotate(34 12 12)' },
          h('path', {
            d: 'M9 4h6l-.6 5.2 2.4 2.2v1.6H7.2v-1.6l2.4-2.2L9 4z',
            fill: 'currentColor',
            fillOpacity: 0.28,
          }),
          h('path', { d: 'M8 4h8M9.3 4l-.5 5.1L6.6 11.3V13h10.8v-1.7l-2.2-2.2L14.7 4M12 13v7.5' }),
        ),
      )
    case 'chevron':
      return h('svg', props, h('path', { d: 'm9 18 6-6-6-6' }))
    case 'arrowUp':
      return h('svg', props, h('path', { d: 'M12 19V5' }), h('path', { d: 'm6 11 6-6 6 6' }))
    case 'link':
      return h('svg', props, h('path', { d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' }), h('path', { d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' }))
    case 'mail':
      return h('svg', props, h('rect', { x: 3, y: 5, width: 18, height: 14, rx: 2.5 }), h('path', { d: 'm3 7 9 6 9-6' }))
    case 'bolt':
      return h('svg', props, h('polygon', { points: '13 2 3 14 12 14 11 22 21 10 12 10 13 2' }))
    case 'target':
      return h('svg', props,
        h('circle', { cx: 12, cy: 12, r: 7.5 }),
        h('circle', { cx: 12, cy: 12, r: 2.5 }),
        h('path', { d: 'M12 2v3M12 19v3M2 12h3M19 12h3' }),
      )
    case 'alert':
      return h('svg', props,
        h('path', { d: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z' }),
        h('path', { d: 'M12 9v4M12 17h.01' }),
      )
    case 'folder':
      return h('svg', props,
        h('path', { d: 'M3 7a2 2 0 0 1 2-2h4.2a2 2 0 0 1 1.5.7L12.2 7H19a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z' }),
      )
    case 'folderOpen':
      return h('svg', props,
        h('path', { d: 'M3 7a2 2 0 0 1 2-2h4.2a2 2 0 0 1 1.5.7L12.2 7H19a2 2 0 0 1 2 2v1.5' }),
        h('path', { d: 'M3 10.5h16.6a1.5 1.5 0 0 1 1.4 1.9l-1.5 6A2 2 0 0 1 17.6 20H5a2 2 0 0 1-2-2V10.5z' }),
      )
    case 'paperclip':
      return h('svg', props,
        h('path', { d: 'm21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48' }),
      )
    case 'image':
      return h('svg', props,
        h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2.5 }),
        h('circle', { cx: 8.5, cy: 9.5, r: 1.5 }),
        h('path', { d: 'm21 15-4.8-4.8a1.5 1.5 0 0 0-2.1 0L6 18.3' }),
      )
    case 'archive':
      return h('svg', props,
        h('rect', { x: 3, y: 4, width: 18, height: 5, rx: 1.5 }),
        h('path', { d: 'M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9' }),
        h('path', { d: 'M10 13h4' }),
      )
    case 'trayOut':
      return h('svg', props,
        h('path', { d: 'M12 15V4' }),
        h('path', { d: 'm8 8 4-4 4 4' }),
        h('path', { d: 'M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3' }),
      )
    case 'trayIn':
      return h('svg', props,
        h('path', { d: 'M12 4v11' }),
        h('path', { d: 'm8 11 4 4 4-4' }),
        h('path', { d: 'M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3' }),
      )
    default:
      return null
  }
}

/* ---------------------------------------------------- Error Boundary */

export class ChiefErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error, info) {
    console.error('dsh-chief view boundary caught error:', error, info)
  }
  render() {
    if (this.state.error) {
      return h(
        'div',
        { className: 'dnb-group', style: { padding: 16, textAlign: 'center', marginTop: 12 } },
        h('div', { style: { fontWeight: 500, fontSize: 13, marginBottom: 6 } }, '视图渲染已自动恢复保护'),
        h('div', { style: { fontSize: 11.5, color: 'var(--dnb-text-2)', marginBottom: 12, wordBreak: 'break-word' } },
          String(this.state.error && this.state.error.message ? this.state.error.message : this.state.error)),
        h('button', {
          className: 'dnb-primary-btn',
          onClick: () => {
            this.setState({ error: null })
            void refresh()
          },
        }, '重新加载'),
      )
    }
    return this.props.children
  }
}

/* ----------------------------------------------------- iOS Micro-Flat CSS */

export function Switch({ checked, onChange, disabled = false, title = '', small = false }) {
  return h(
    'button',
    {
      type: 'button',
      role: 'switch',
      disabled: Boolean(disabled),
      'aria-checked': checked ? 'true' : 'false',
      'aria-disabled': disabled ? 'true' : 'false',
      'data-disabled': disabled ? '1' : '0',
      title: title || undefined,
      className: 'dnb-switch',
      'data-on': checked ? '1' : '0',
      style: small ? { transform: 'scale(0.82)', transformOrigin: 'center' } : undefined,
      onClick: () => {
        if (disabled) return
        onChange(!checked)
      },
    },
    h('span', { className: 'dnb-switch-thumb' }),
  )
}

export function SearchDrawer({ view }) {
  if (!view.searchOpen) return null
  const run = () => {
    const text = (view.askText || '').trim()
    if (!text) return
    const hits = searchBoard(text)
    patch({ askHits: hits, askNote: '' })
  }
  const askModel = () => {
    const text = (view.askText || '').trim()
    if (!text) return
    patch({ secInput: text, secTarget: 'auto', searchOpen: false, askHits: null })
    void submitChiefBar()
  }

  return h(
    'div',
    { style: { padding: '0 12px 8px', flexShrink: 0 }, className: 'dnb-view' },
    h(
      'div',
      { style: { display: 'flex', gap: 6, alignItems: 'center' } },
      h('input', {
        className: 'dnb-input',
        style: { borderRadius: 99, paddingLeft: 12, height: 30 },
        placeholder: '搜索记忆、任务、协同信箱…',
        autoFocus: true,
        value: view.askText || '',
        onChange: e => {
          const val = e.target.value
          patch({ askText: val, askHits: val.trim() ? searchBoard(val) : null })
        },
        onKeyDown: e => {
          if (e.key === 'Enter') run()
          if (e.key === 'Escape') patch({ searchOpen: false, askHits: null })
        },
      }),
      (view.askText || '').trim()
        ? h('button', {
            className: 'dnb-pill',
            style: { height: 30 },
            disabled: view.archiveSearchBusy,
            onClick: () => void searchColdArchives(view.askText),
            title: '按需穿透搜索封存懒加载的长期工程档案柜',
          }, h(Icon, { name: 'archive', size: 12 }), view.archiveSearchBusy ? '检索中…' : '搜档案柜')
        : null,
      (view.askText || '').trim()
        ? h('button', {
            className: 'dnb-pill dnb-pill-accent',
            style: { height: 30 },
            onClick: askModel,
            title: '直接交给 DSH 参谋长回答或拆话',
          }, h(Icon, { name: 'sparkles', size: 12 }), '问参谋长')
        : null,
    ),
    Array.isArray(view.askHits)
      ? h(
          'div',
          { className: 'dnb-group', style: { marginTop: 6, marginBottom: 0, maxHeight: 180, overflow: 'auto' } },
          view.askHits.length
            ? view.askHits.map((item, idx) =>
                h(
                  'div',
                  {
                    key: item.id + '-' + idx,
                    className: 'dnb-cell dnb-cell-hover',
                    style: { cursor: 'pointer', padding: '7px 12px' },
                    onClick: () => {
                      const nextPatch = { tab: item.tab || 'chief', searchOpen: false }
                      if (item.subTab) nextPatch.secSubTab = item.subTab
                      if (item.showRawTurns) nextPatch.secShowRawTurns = true
                      if (item.tab === 'tasks') nextPatch.selectedTaskId = item.id
                      if (item.tab === 'archive' && item.archiveId) {
                        nextPatch.archiveOpenFolders = { ...(store.archiveOpenFolders || {}), ...(item.folderId ? { [item.folderId]: true } : {}) }
                        nextPatch.archiveOpenFiles = { ...(store.archiveOpenFiles || {}), [item.archiveId]: true }
                        patch(nextPatch)
                        void loadArchives(false)
                        void loadArchiveDetail(item.archiveId, false)
                        return
                      }
                      patch(nextPatch)
                    },
                  },
                  h('span', { className: 'dnb-tag', style: { color: 'var(--dnb-accent)' } }, item.kind),
                  h('div', { style: { flex: 1, minWidth: 0 } },
                    h('div', { style: { fontWeight: 500, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.title),
                    item.snippet ? h('div', { style: { fontSize: 11, color: 'var(--dnb-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.snippet) : null,
                  ),
                ),
              )
            : h('div', { style: { padding: '10px 12px', fontSize: 11.5, color: 'var(--dnb-text-3)', textAlign: 'center' } }, '无匹配结果'),
        )
      : null,
  )
}

/* ----------------------------- Status Badge & Objective Radar Strip */

export function StatusBadge({ status, style }) {
  const st = STATUSES.includes(status) ? status : 'todo'
  return h(
    'span',
    { className: 'dnb-status-badge', 'data-status': st, style },
    st === 'doing'
      ? h('span', { className: 'dnb-spin-ring', style: { '--dnb-spin-size': '9.5px', color: '#409cff' } })
      : null,
    STATUS_BADGE[st] || STATUS_LABEL[st],
  )
}

/**
 * Prominent radar strip highlighting Advancing (`doing`) and Blocked (`blocked`) objectives.
 * Clicking any card jumps straight to the Pyramid Tree view and frames the active subagents!
 */
export function ObjectiveRadarStrip({ board, compact = false }) {
  const allTasks = (board && Array.isArray(board.tasks)) ? board.tasks.filter(Boolean) : []
  const blockedTasks = allTasks.filter(t => t.status === 'blocked')
  const doingTasks = allTasks.filter(t => t.status === 'doing')
  const subagents = Array.isArray(store.subagents) ? store.subagents : []
  const identity = store.agentIdentity || null

  if (!blockedTasks.length && !doingTasks.length) return null

  const items = [
    ...blockedTasks.map(t => ({ task: t, kind: 'blocked' })),
    ...doingTasks.map(t => ({ task: t, kind: 'doing' })),
  ]

  return h(
    'div',
    { className: 'dnb-radar-strip' },
    items.slice(0, compact ? 3 : 6).map(({ task, kind }) => {
      const isFocused = store.focusTaskId === task.id
        && store.tab === 'tasks'
        && (store.taskViewMode === 'graph' || store.taskViewMode === 'canvas')
      const resolved = resolveTaskAgents(task, allTasks, subagents, identity)
      const agentLabels = resolved.agentNames.length
        ? resolved.agentNames.slice(0, 2).map(n => '@' + shortAgentName(n, true)).join('、')
          + (resolved.agentNames.length > 2 ? ' 等 ' + resolved.agentNames.length + ' 代理' : '')
        : '@主代理'
      const subReason = kind === 'blocked' && (task.note || (board && board.cursor && board.cursor.blocked))
        ? clampTitle(task.note || board.cursor.blocked, 20)
        : ''

      return h(
        'div',
        {
          key: task.id,
          className: 'dnb-radar-card',
          'data-kind': kind,
          'data-focused': isFocused ? '1' : '0',
          title: kind === 'blocked'
            ? '受阻目标：点击跳转金字塔视角定位负责子代理'
            : '推进目标：点击跳转金字塔视角框选正在推进的子代理',
          onClick: () => {
            if (isFocused) {
              patch({ focusTaskId: '' })
            } else {
              focusObjectiveInPyramid(task.id)
            }
          },
        },
        h(StatusBadge, { status: kind }),
        h(
          'div',
          { style: { flex: 1, minWidth: 0 } },
          h(
            'div',
            {
              style: {
                fontWeight: 600,
                fontSize: 12.5,
                color: 'var(--dnb-text)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              },
            },
            task.title || task.id,
          ),
          h(
            'div',
            {
              style: {
                fontSize: 11,
                color: kind === 'blocked' ? 'rgba(255, 110, 100, 0.92)' : 'var(--dnb-text-2)',
                marginTop: 1.5,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              },
            },
            (kind === 'blocked' ? '受阻关联：' : '推进代理：') + agentLabels + (subReason ? ' · ' + subReason : ''),
          ),
        ),
        h(
          'span',
          {
            className: 'dnb-pill',
            style: {
              height: 23,
              padding: '0 8px',
              fontSize: 10.5,
              color: isFocused ? '#fff' : (kind === 'blocked' ? '#ff453a' : '#409cff'),
              background: isFocused
                ? (kind === 'blocked' ? '#ff453a' : '#0a84ff')
                : (kind === 'blocked' ? 'rgba(255,69,58,0.12)' : 'rgba(10,132,255,0.12)'),
              borderColor: kind === 'blocked' ? 'rgba(255,69,58,0.38)' : 'rgba(10,132,255,0.38)',
              flexShrink: 0,
            },
          },
          h(Icon, { name: 'target', size: 11.5 }),
          isFocused ? '已框选' : '看代理',
        ),
      )
    }),
  )
}

/* ---------------------------------------------------- Subagent Fleet Bar */

export function SubagentFleetBar({ board }) {
  const subagents = Array.isArray(store.subagents) ? store.subagents : []
  const [steerAgent, setSteerAgent] = React.useState('')
  const [steerText, setSteerText] = React.useState('')
  const hier = buildAgentHierarchy(subagents, store.agentIdentity)
  const children = hier.children
  const runningCount = children.filter(a => a.status === 'running').length

  const activeAgentObj = children.find(a => a.name === steerAgent) || null

  const sendSteer = () => {
    const msg = steerText.trim()
    if (!steerAgent || !msg) return
    setSteerText('')
    void act({ action: 'team.steer', agent: steerAgent, message: msg })
  }

  if (!children.length && !store.showInternalProbes) return null

  const isCollapsed = Boolean(store.fleetCollapsed)
  const hasMany = children.length > 10
  const showAll = Boolean(store.fleetShowAll)
  const hasAnyProbe = hier.probeCount > 0 || (store.showInternalProbes && hier.allChildren.some(a => isInternalProbeName(a.name)))

  // Determine visible pills when expanded in smart-compact mode
  let visibleAgents = children
  let hiddenCount = 0
  if (!isCollapsed && hasMany && !showAll) {
    const allTasks = (board && Array.isArray(board.tasks)) ? board.tasks : []
    const busyNames = new Set(
      allTasks
        .filter(t => t && t.status !== 'done')
        .map(t => {
          const hit = hier.matchAgentRef(t.subagent || t.owner || t.session)
          return hit ? hit.name : ''
        })
        .filter(Boolean),
    )
    const priority = children.filter(
      a => a.status === 'running' || busyNames.has(a.name) || a.name === store.filterAgent || a.name === steerAgent,
    )
    visibleAgents = priority.length > 0 ? priority : children.slice(-3)
    hiddenCount = Math.max(0, children.length - visibleAgents.length)
  }

  return h(
    'div',
    { className: 'dnb-group', style: { padding: isCollapsed ? '7px 10px' : '8px 10px', marginBottom: 10 } },
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: isCollapsed ? 0 : 6 } },
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11.5,
            fontWeight: 600,
            color: 'var(--dnb-text-2)',
            cursor: 'pointer',
            minWidth: 0,
          },
          onClick: () => patch({ fleetCollapsed: !isCollapsed }),
          title: isCollapsed ? '点击展开子代理团队' : '点击收起子代理团队',
        },
        runningCount > 0
          ? h('span', { className: 'dnb-spin-ring', style: { '--dnb-spin-size': '8px', color: '#409cff' } })
          : h('span', {
              style: {
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: 'var(--dnb-text-3)',
                flexShrink: 0,
              },
            }),
        '子代理团队',
        h(
          'span',
          { style: { color: runningCount > 0 ? '#409cff' : 'var(--dnb-text-3)', fontWeight: 500 } },
          runningCount ? `${runningCount} 运行中 · 共 ${children.length}` : `共 ${children.length} 成员`,
        ),
      ),
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 } },
        store.filterAgent
          ? h('button', {
              className: 'dnb-pill',
              style: { height: 22, fontSize: 11, padding: '0 8px' },
              onClick: () => { patch({ filterAgent: '' }); setSteerAgent('') },
            }, '清除筛选')
          : null,
        h('button', {
          className: 'dnb-pill',
          style: { height: 22, fontSize: 11, padding: '0 8px' },
          onClick: () => patch({ fleetCollapsed: !isCollapsed }),
        },
          isCollapsed ? `展示 (${children.length})` : '收起',
          h(Icon, {
            name: 'chevron',
            size: 11,
            style: {
              transform: isCollapsed ? 'rotate(90deg)' : 'rotate(-90deg)',
              transition: 'transform 0.16s ease',
            },
          }),
        ),
      ),
    ),
    !isCollapsed
      ? h(
          'div',
          { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } },
          visibleAgents.map(agent => {
            const isRunning = agent.status === 'running'
            const isSelected = store.filterAgent === agent.name || steerAgent === agent.name
            const pKey = hier.parentKeyOf.get(agent.name)
            const isTier2 = pKey && pKey !== 'lead'
            return h(
              'button',
              {
                key: agent.name,
                className: 'dnb-pill',
                'data-active': isSelected ? '1' : '0',
                style: {
                  height: 25,
                  padding: '0 9px',
                  borderColor: isRunning && !isSelected ? 'rgba(10, 132, 255, 0.38)' : undefined,
                },
                title: '@' + agent.name + (isTier2 ? '（上级：@' + pKey + '）' : '') + (agent.description ? ' — ' + agent.description : ''),
                onClick: () => {
                  const next = store.filterAgent === agent.name ? '' : agent.name
                  patch({ filterAgent: next })
                  setSteerAgent(steerAgent === agent.name ? '' : agent.name)
                },
              },
              isRunning
                ? h('span', { className: 'dnb-spin-ring', style: { '--dnb-spin-size': '8px', color: '#409cff' } })
                : h('span', {
                    style: {
                      width: 6.5,
                      height: 6.5,
                      borderRadius: '50%',
                      background: 'var(--dnb-text-3)',
                    },
                  }),
              '@' + shortAgentName(agent.name),
            )
          }),
          hiddenCount > 0
            ? h('button', {
                className: 'dnb-pill',
                style: { height: 25, padding: '0 9px', fontSize: 11, borderStyle: 'dashed', color: 'var(--dnb-text-3)' },
                title: '展示其余已结束/待命的子代理成员',
                onClick: () => patch({ fleetShowAll: true }),
              }, '+' + hiddenCount + ' 展示全部')
            : (hasMany && showAll
                ? h('button', {
                    className: 'dnb-pill',
                    style: { height: 25, padding: '0 9px', fontSize: 11, color: 'var(--dnb-text-3)' },
                    onClick: () => patch({ fleetShowAll: false }),
                  }, '折叠空闲')
                : null),
          hasAnyProbe
            ? h('button', {
                className: 'dnb-pill',
                'data-active': store.showInternalProbes ? '1' : '0',
                style: { height: 24, padding: '0 8px', fontSize: 10.5, borderStyle: 'dashed', opacity: 0.78 },
                title: store.showInternalProbes ? '隐藏后台记忆检查点探针 (@mnemon-review)' : '显示后台记忆检查点探针 (@mnemon-review)',
                onClick: () => patch({ showInternalProbes: !store.showInternalProbes }),
              }, store.showInternalProbes ? '隐藏内部探针' : `内部探针 (${hier.probeCount})`)
            : null,
        )
      : null,
    !isCollapsed && steerAgent
      ? h(
          'div',
          { style: { display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--dnb-border)' } },
          activeAgentObj && activeAgentObj.id
            ? h('button', {
                className: 'dnb-pill',
                style: { height: 28 },
                title: '在分栏打开该子代理对话',
                onClick: () => {
                  if (!openSubagentChat(activeAgentObj)) {
                    patch({ notice: '当前子代理尚未建立独立会话视图' })
                  }
                },
              }, h(Icon, { name: 'chat', size: 12 }), '对话')
            : null,
          h('input', {
            className: 'dnb-input',
            style: { flex: 1, height: 28, padding: '0 10px', borderRadius: 99, fontSize: 11.5 },
            placeholder: '给 @' + shortAgentName(steerAgent) + ' 发指令…',
            value: steerText,
            onChange: e => setSteerText(e.target.value),
            onKeyDown: e => { if (e.key === 'Enter') sendSteer() },
          }),
          h('button', {
            className: 'dnb-primary-btn',
            style: { height: 28, padding: '0 10px' },
            disabled: !steerText.trim(),
            onClick: sendSteer,
          }, '发送'),
          h('button', {
            className: 'dnb-pill dnb-pill-danger',
            style: { height: 28, padding: '0 8px' },
            title: '停止当前轮次',
            onClick: () => void act({ action: 'team.interrupt', agent: steerAgent }),
          }, h(Icon, { name: 'stop', size: 11 })),
        )
      : null,
  )
}

/* ----------------------------------------------- Bottom Sheet Inspector */

function classifyBulletTagTone(tag) {
  const t = String(tag || '')
  if (
    /禁止|红线|受阻|错误|失败|撞墙|高危|违规|严禁|崩溃|死锁/.test(t)
    || (/风险|告警|异常/.test(t) && !/保障|兜底|已解|可控|无风险|解除/.test(t))
  ) {
    return { bg: 'rgba(255, 69, 58, 0.16)', fg: '#ff6961', border: 'rgba(255, 69, 58, 0.30)', spinning: false }
  }
  if (/完成|已完|结论|必做|允许|已解|就绪|已验证|通过|已执行|已处理|兜底|保障|达成/.test(t)) {
    return { bg: 'rgba(48, 209, 88, 0.15)', fg: '#30d158', border: 'rgba(48, 209, 88, 0.28)', spinning: false }
  }
  if (/待办|待收尾|待推进|未完|未开始|待定|搁置|排队|空闲|休眠/.test(t)) {
    return { bg: 'rgba(142, 142, 147, 0.16)', fg: '#a1a1aa', border: 'rgba(142, 142, 147, 0.26)', spinning: false }
  }
  if (/注意|提醒|警告|警惕|纪律|顺序|验收|待验|核对|原因|约束|谨慎|观察|复核|风险/.test(t)) {
    return { bg: 'rgba(245, 158, 11, 0.16)', fg: '#fbbf24', border: 'rgba(245, 158, 11, 0.30)', spinning: false }
  }
  if (/推进|进行中|执行中|运行中|处理中|排查中|构建中|同步中|验证中/.test(t)) {
    return { bg: 'rgba(10, 132, 255, 0.16)', fg: '#409cff', border: 'rgba(10, 132, 255, 0.32)', spinning: true }
  }
  return { bg: 'rgba(10, 132, 255, 0.14)', fg: '#409cff', border: 'rgba(10, 132, 255, 0.26)', spinning: false }
}

function classifySectionHeadingTone(heading) {
  const s = String(heading || '')
  const hasWarn = /纪律|边界|注意|提醒|警告|风险|约束|验收|待验/.test(s)
  const hasRed = /禁止|红线|受阻|阻塞|错误|告警|故障/.test(s)
  if (hasWarn && hasRed) {
    return { fg: '#fbbf24', bar: 'linear-gradient(180deg, #f59e0b 0%, #ff453a 100%)' }
  }
  if (hasRed) {
    return { fg: '#ff6961', bar: '#ff453a' }
  }
  if (hasWarn) {
    return { fg: '#fbbf24', bar: '#f59e0b' }
  }
  if (/已完成|达成|放行|收口/.test(s)) {
    return { fg: '#34d399', bar: '#30d158' }
  }
  if (/待办|未完成|遗留|后续/.test(s)) {
    return { fg: '#a1a1aa', bar: '#8e8e93' }
  }
  return { fg: '#60a5fa', bar: '#0a84ff' }
}

export function renderStructuredHeading(heading, compact) {
  if (!heading) return null
  const tone = classifySectionHeadingTone(heading)
  return h(
    'div',
    { className: compact ? 'dnb-struct-head is-compact' : 'dnb-struct-head', style: { color: tone.fg } },
    h('span', { className: 'dnb-struct-bar', style: { background: tone.bar } }),
    h('span', null, heading),
  )
}

function splitTaggedBullet(rawLine) {
  const clean = String(rawLine || '')
    .replace(/\[dsh-mnemon:[^\]]*\][\s\S]*/gi, '')
    .replace(/^[-*•]\s+/, '')
    .replace(/^\d+[.)、]\s+/, '')
    .trim()
  if (!clean) return null
  const m = clean.match(/^【([^】]{1,12})】\s*(.*)$/)
  if (m) {
    return { badge: m[1].trim(), body: m[2].trim() || m[1].trim() }
  }
  return { badge: '', body: clean }
}

export function parseNarrativeBlocks(raw) {
  const text = String(raw || '').trim()
  if (!text) return []
  const lines = text.split(/\r?\n/)
  const blocks = []
  let current = null

  const ensureBlock = () => {
    if (!current) current = { heading: '', items: [] }
    return current
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    if (/^\[dsh-mnemon:/i.test(line)) continue
    const headingMatch = line.match(/^#{1,3}\s+(.+)$/)
    if (headingMatch) {
      if (current && (current.heading || current.items.length)) blocks.push(current)
      current = { heading: headingMatch[1].trim(), items: [] }
      continue
    }
    if (/^(?:[-*•]|\d+[.)、])\s+/.test(line) || /^【[^】]{1,12}】/.test(line)) {
      const parsed = splitTaggedBullet(line)
      if (parsed) ensureBlock().items.push({ kind: 'bullet', ...parsed })
    } else {
      const cleanedPara = line
        .replace(/\[dsh-mnemon:[^\]]*\][\s\S]*/gi, '')
        .trim()
      if (!cleanedPara) continue
      ensureBlock().items.push({ kind: 'para', body: cleanedPara })
    }
  }
  if (current && (current.heading || current.items.length)) blocks.push(current)
  return blocks
}

export function renderStructuredItem(item, key) {
  if (!item) return null
  if (item.kind === 'bullet') {
    const tone = item.badge ? classifyBulletTagTone(item.badge) : null
    return h(
      'div',
      {
        key,
        style: {
          display: 'flex',
          alignItems: 'flex-start',
          gap: 7,
          padding: '3.5px 0',
          fontSize: 12.2,
          lineHeight: 1.52,
          color: 'var(--dnb-text)',
        },
      },
      item.badge
        ? h(
            'span',
            {
              style: {
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4.5,
                padding: '1px 6.5px',
                borderRadius: 6,
                fontSize: 10.5,
                fontWeight: 700,
                background: tone.bg,
                color: tone.fg,
                border: '1px solid ' + tone.border,
                flexShrink: 0,
                marginTop: 1.5,
              },
            },
            tone.spinning
              ? h('span', { className: 'dnb-spin-ring', style: { '--dnb-spin-size': '9px', color: tone.fg } })
              : null,
            item.badge,
          )
        : h('span', {
            style: {
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: 'var(--dnb-accent)',
              flexShrink: 0,
              marginTop: 7,
            },
          }),
      h('span', { style: { flex: 1, minWidth: 0, wordBreak: 'break-word' } }, item.body),
    )
  }
  return h('p', { key, className: 'dnb-prose-p' }, item.body)
}

export function renderStructuredText(rawText) {
  const blocks = parseNarrativeBlocks(rawText)
  if (!blocks.length) {
    return h('div', { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, String(rawText || ''))
  }
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
    blocks.map((blk, bi) =>
      h(
        'div',
        { key: bi, style: { marginTop: bi === 0 ? 0 : 6 } },
        blk.heading ? renderStructuredHeading(blk.heading, true) : null,
        blk.items.map((it, ii) => renderStructuredItem(it, `${bi}-${ii}`)),
      ),
    ),
  )
}

export function parseSixGoalBrief(raw) {
  const text = String(raw || '').trim()
  if (!text) return null
  const rowsByKey = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const clean = rawLine.trim().replace(/^(?:[-*•]\s+)/, '')
    const m = clean.match(/^【([^】]{2,18})】\s*[：:]?\s*(.+)$/)
    if (!m) continue
    const tag = m[1].trim().replace(/^[^\u4e00-\u9fa5A-Za-z]+/, '').trim()
    const body = m[2].trim()
    const def = SIX_GOAL_ROWS_META.find(r => r.aliases.includes(tag))
    if (def && body && !rowsByKey[def.key]) {
      rowsByKey[def.key] = { ...def, body }
    }
  }
  const matched = SIX_GOAL_ROWS_META.filter(r => rowsByKey[r.key]).map(r => rowsByKey[r.key])
  return matched.length >= 2 ? matched : null
}

export function orderChatHistoryNewestFirst(rawList) {
  const items = Array.isArray(rawList) ? rawList.filter(Boolean) : []
  const groups = []
  for (let i = 0; i < items.length; i += 1) {
    const cur = items[i]
    const next = items[i + 1]
    if (cur && cur.role === 'user' && next && next.role === 'chief') {
      groups.push([cur, next])
      i += 1
    } else {
      groups.push([cur])
    }
  }
  groups.reverse()
  return groups.flat()
}
