/**
 * components/Panel.js
 *
 * Root PanelInner layout, header, navigation tabs, shell slot wrappers, and ErrorBoundary-wrapped Panel.
 */

import { React, h } from '../react-runtime.js'
import {
  API,
  SIDE_ID,
  BRAND_NAME,
  EXPECTED_BACKEND_BUILD,
  STATUS_BG,
  TABS,
  DOCK_POLL_MS,
  RUN_MODE_OPTIONS,
  THINKING_EFFORT_OPTIONS,
} from '../constants.js'
import {
  store,
  patch,
  subscribe,
  useStore,
  service,
  isSubagentSessionId,
  focusObjectiveInPyramid,
  selectPanel,
  rightbarExpanded,
  openChief,
  closeChief,
  toggleChief,
  reserveCornerSpace,
  runtimeRefs,
} from '../store.js'
import {
  clampTitle,
  shortSession,
  shortModelName,
  fullModelWithChannel,
  isInternalProbeName,
  sessionIdFromUrl,
} from '../utils.js'
import {
  loadChiefView,
  loadChiefModels,
  loadArchives,
  refresh,
  adoptSession,
} from '../api.js'
import { Style } from '../styles.js'
import { Icon, ChiefErrorBoundary, SearchDrawer } from './common.js'
import {
  ModelPickerPopover,
  PacePickerPopover,
  SuggestionBanner,
  InterventionConfirmModal,
  UnlimitedTurnsConfirmModal,
  AutoPilotConfirmModal,
  ArchiveRelayModal,
  DistillToGlobalModal,
  ChiefAdviceModal,
  HazardHaltModal,
  PrecipitateConfirmModal,
  PeerLinkConfirmModal,
  HandoffWarnModal,
  ChiefRiskConfirmModal,
  OperationApprovalModal,
  ElevationRequestModal,
  AuditLogModal,
} from './modals.js'
import { TasksTab } from '../tabs/tasks.js'
import { PlanTab } from '../tabs/plan.js'
import { ArchiveTab } from '../tabs/archives.js'
import { BoundariesTab } from '../tabs/boundaries.js'
import { ChiefTab, ChiefComposerBar } from '../tabs/chief.js'
import { PeersTab } from '../tabs/peers.js'

function ChiefWorkStageOverlay({ fx }) {
  const fxKey = fx && fx.label ? String(fx.token || fx.id || (fx.tone || 'neon') + ':' + String(fx.label)) : ''
  const [dismissedKey, setDismissedKey] = React.useState('')
  React.useEffect(() => {
    if (!fxKey && dismissedKey) setDismissedKey('')
  }, [fxKey, dismissedKey])
  if (!fxKey) return null
  const stageDismissed = dismissedKey === fxKey
  const tone = fx.tone || 'neon'
  const chars = Array.from(String(fx.label))
  return h(
    React.Fragment,
    null,
    h('div', {
      className: 'dnb-chief-fx-border',
      'data-tone': tone,
      'data-dismissed': stageDismissed ? '1' : '0',
      'aria-hidden': true,
    }),
    !stageDismissed
      ? h(
          'div',
          {
            className: 'dnb-chief-fx-stage',
            'data-tone': tone,
            role: 'status',
            'aria-live': 'polite',
            title: '点击任意处解除毛玻璃遮罩，恢复操作（外框流光表示参谋长仍在运作）',
            onClick: e => {
              e.stopPropagation()
              setDismissedKey(fxKey)
            },
          },
          h(
            'div',
            { className: 'dnb-chief-fx-pill' },
            h('span', { className: 'dnb-chief-fx-ring', 'aria-hidden': true }),
            h(
              'div',
              { className: 'dnb-chief-fx-text' },
              chars.map((ch, idx) =>
                h(
                  'span',
                  {
                    key: idx,
                    className: 'dnb-wave-char',
                    style: { '--char-i': idx },
                  },
                  ch === ' ' ? '\u00A0' : ch,
                ),
              ),
            ),
          ),
          h(
            'div',
            { className: 'dnb-chief-fx-hint' },
            '点击任意处收起遮罩继续操作 · 外框流光表示仍在运作',
          ),
        )
      : null,
  )
}

function PanelInner(props) {
  const view = useStore()
  const isPage = !!(props && props.variant === 'main')
  const isDock = !!(props && props.variant === 'dock')
  const selfRef = React.useRef(null)

  const secBarRef = React.useRef(null)

  React.useEffect(() => {
    const host = isDock || isPage || view.open ? selfRef.current : null
    if (!host) return undefined
    const measure = () => {
      try {
        host.style.removeProperty('--dnb-safe-top')
        host.style.removeProperty('--dnb-safe-bottom')
        const reserve = reserveCornerSpace(host, secBarRef.current)
        const key = String(reserve.right || 0)
        if (key === host.dataset.dnbReserve) return
        host.dataset.dnbReserve = key
        host.style.setProperty('--dnb-safe-right', (reserve.right || 0) + 'px')
      } catch {}
    }
    const timer = setInterval(measure, 3500)
    const first = setTimeout(measure, 450)
    return () => {
      clearInterval(timer)
      clearTimeout(first)
    }
  }, [view.open, isDock, isPage])

  if (!isPage && !isDock && !view.open) return null

  const board = view.board
  const tasks = (board && Array.isArray(board.tasks)) ? board.tasks : []
  const openCount = tasks.filter(t => t && t.status !== 'done').length
  const meta = view.chiefMeta || {}
  const subagentChildrenCount = Array.isArray(view.subagents)
    ? view.subagents.filter(a => (
        a
        && a.name
        && a.name !== 'lead'
        && (view.showInternalProbes || a.status === 'running' || !isInternalProbeName(a.name))
      )).length
    : 0
  const peersBadge = subagentChildrenCount + (meta.linkedPeersCount || 0)
  const secBadge = (meta.pendingSuggestions || 0)
  const archMeta = view.archiveMeta || {}
  const archiveBadge = archMeta.takenOutCount || 0

  const body = view.tab === 'chief'
    ? h(ChiefTab, { board, view })
    : view.tab === 'peers'
      ? h(PeersTab, { view })
      : view.tab === 'plan'
        ? h(PlanTab, { board })
        : view.tab === 'archive'
          ? h(ArchiveTab, { board, view })
          : view.tab === 'boundaries'
            ? h(BoundariesTab, { store: view })
            : h(TasksTab, { board, view })

  const cursorText = board && board.cursor && (board.cursor.next || board.cursor.step || board.cursor.blocked)
    ? (board.cursor.blocked ? '受阻 · ' + board.cursor.blocked : (board.cursor.next || board.cursor.step))
    : ''

  return h(
    React.Fragment,
    null,
    h(Style, null),
    h(
      'div',
      {
        className: isDock ? 'dnb-panel dnb-main dnb-dock' : isPage ? 'dnb-panel dnb-main' : 'dnb-panel',
        role: isPage || isDock ? 'region' : 'dialog',
        'aria-label': BRAND_NAME,
        ref: node => {
          runtimeRefs.panelEl = node
          selfRef.current = node
        },
      },
      // Clean iOS Header with Chief Model Picker & Auto-Pilot Switch
      h(
        'div',
        { className: 'dnb-head', style: { position: 'relative' } },
        h('span', {
          className: 'dnb-title',
          style: { display: 'inline-flex', alignItems: 'center', gap: 5 },
          title: `${BRAND_NAME} v${EXPECTED_BACKEND_BUILD}${meta.backendBuild ? (view.staleBackendDetected ? `（宿主内存后端仍为 v${meta.backendBuild}，重载后同步）` : '（前后端已同步）') : ''}${view.sessionId ? ` · 会话 ${shortSession(view.sessionId)}` : ''}`,
        },
          h(Icon, { name: 'sparkles', size: 14, style: { color: 'var(--dnb-accent)' } }),
          BRAND_NAME,
        ),
        h('span', {
          className: 'dnb-ver-chip',
          'data-stale': view.staleBackendDetected ? '1' : '0',
          title: view.staleBackendDetected
            ? `前端面板 v${EXPECTED_BACKEND_BUILD} · 宿主内存后端仍为 v${meta.backendBuild || '旧版'}（重载插件或重启客户端后同步）`
            : `DSH 参谋长版本：v${EXPECTED_BACKEND_BUILD}${meta.backendBuild ? '（前后端已同步）' : ''}`,
        }, view.staleBackendDetected ? `旧后端 · v${EXPECTED_BACKEND_BUILD}` : ('v' + EXPECTED_BACKEND_BUILD)),
        meta.linkedPeersCount > 0
          ? h('button', {
              className: 'dnb-head-pill',
              style: { height: 21, padding: '0 6px', fontSize: 10.5, color: 'var(--dnb-accent)' },
              title: '已串联跨窗口会话，点击查看协同网络',
              onClick: () => patch({ tab: 'peers' }),
            }, h(Icon, { name: 'link', size: 10.5 }), String(meta.linkedPeersCount))
          : null,
        h(
          'div',
          { className: 'dnb-head-actions' },
          h('button', {
            className: 'dnb-head-pill',
            title: (() => {
              const cat = view.secModelsCatalog || (view.secView && view.secView.models) || null
              const eff = meta.modelRef || meta.resolvedModelRef || meta.followModelRef || ''
              const label = fullModelWithChannel(eff, cat)
              if (!meta.modelRef) {
                return '正在自动跟随主对话模型' + (label ? '：' + label + ' [' + eff + ']' : '') + '（点击可切换专职参谋长模型）'
              }
              return '已固定参谋长专职模型：' + (label || eff) + ' [' + eff + ']（点击可切回跟随主对话）'
            })(),
            onClick: () => {
              const nextOpen = !view.secModelMenuOpen
              patch({ secModelMenuOpen: nextOpen, secPaceMenuOpen: false, secPermMenuOpen: false })
              if (nextOpen) void loadChiefModels(true)
            },
          }, (() => {
            const cat = view.secModelsCatalog || (view.secView && view.secView.models) || null
            const eff = meta.modelRef || meta.resolvedModelRef || meta.followModelRef || ''
            const effortKey = meta.thinkingEffort || 'auto'
            const effortOpt = THINKING_EFFORT_OPTIONS.find(x => x.key === effortKey)
            const effBadge = effortOpt ? effortOpt.shortLabel : '🪄 自动'
            const tag = eff ? clampTitle(shortModelName(eff, cat, true), 14) : '自动'
            return `${tag} · ${effBadge}`
          })()),
          (() => {
            const curRunMode = meta.stopped
              ? 'off'
              : (meta.runMode && ['off', 'patrol', 'managed'].includes(meta.runMode)
                  ? meta.runMode
                  : (meta.paceMode === 'auto' ? 'managed' : (meta.paceMode === 'smart' ? 'patrol' : 'off')))
            return h(
              'div',
              { className: 'dnb-run-mode-pill', role: 'group', 'aria-label': '参谋运行模式' },
              RUN_MODE_OPTIONS.map(opt =>
                h('button', {
                  key: opt.key,
                  type: 'button',
                  className: 'dnb-run-mode-btn',
                  'data-active': curRunMode === opt.key ? '1' : '0',
                  'data-rm': opt.key,
                  title: opt.hint,
                  onClick: () => {
                    if (opt.key === 'managed' && curRunMode !== 'managed') {
                      patch({ autoPilotConfirmOpen: true, secPaceMenuOpen: false })
                      return
                    }
                    patch({ secPaceMenuOpen: false })
                    void updateSecConfig({
                      runMode: opt.key,
                      ...(opt.key === 'off' ? { paceMode: 'manual', autoPilot: false } : {}),
                    })
                  },
                }, opt.shortLabel),
              ),
            )
          })(),
          h('button', {
            className: 'dnb-icon-btn',
            'data-active': view.searchOpen ? '1' : '0',
            title: '搜索与问参谋长',
            onClick: () => patch({ searchOpen: !view.searchOpen, askHits: null }),
          }, h(Icon, { name: 'search', size: 15 })),
          h('button', {
            className: 'dnb-icon-btn',
            title: '同步刷新',
            onClick: () => {
              void refresh()
              if (view.tab === 'archive') void loadArchives(true)
              else void loadChiefView(false)
            },
          }, h(Icon, { name: 'refresh', size: 15, style: view.busy ? { animation: 'dnb-spin 0.9s linear infinite' } : undefined })),
          h('button', {
            className: 'dnb-icon-btn',
            title: isPage ? '返回会话' : '收起',
            onClick: () => {
              if (closeChief()) return
              if (isPage) {
                selectPanel(null)
                return
              }
              patch({ open: false })
            },
          }, h(Icon, { name: 'x', size: 15 })),
        ),
        h(ModelPickerPopover, { view }),
        h(PacePickerPopover, { view }),
      ),

      // Live Cursor Pill (only when active; clickable to spotlight advancing/blocked subagents)
      cursorText
        ? h(
            'div',
            { style: { padding: '0 12px 8px', flexShrink: 0 } },
            h(
              'div',
              {
                style: {
                  padding: '5px 10px',
                  borderRadius: 10,
                  background: board.cursor.blocked ? STATUS_BG.blocked : 'rgba(10, 132, 255, 0.13)',
                  border: board.cursor.blocked ? '1px solid rgba(255, 69, 58, 0.30)' : '1px solid rgba(10, 132, 255, 0.30)',
                  color: board.cursor.blocked ? '#ff453a' : '#409cff',
                  fontSize: 11.5,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6.5,
                  cursor: 'pointer',
                },
                title: '点击跳转金字塔视角查看推进/受阻子代理',
                onClick: () => {
                  const targetTask = (board.cursor.expectedTaskId && tasks.find(t => t && t.id === board.cursor.expectedTaskId))
                    || tasks.find(t => t && (board.cursor.blocked ? t.status === 'blocked' : t.status === 'doing'))
                  if (targetTask) focusObjectiveInPyramid(targetTask.id)
                  else patch({ tab: 'tasks', taskViewMode: 'graph' })
                },
              },
              board.cursor.blocked
                ? '⚠ '
                : h('span', { className: 'dnb-spin-ring', style: { '--dnb-spin-size': '10px', color: '#409cff' } }),
              h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 } }, cursorText),
            ),
          )
        : null,

      // Proactive Suggestion Capsule Banner
      h(SuggestionBanner, { view }),

      h(SearchDrawer, { view }),

      // iOS Segmented Tab Strip (5 Clean Two-Char Tabs)
      h(
        'div',
        { className: 'dnb-seg-wrap' },
        h(
          'div',
          { className: 'dnb-seg' },
          TABS.map(tab => {
            const count = tab.key === 'tasks'
              ? openCount
              : tab.key === 'peers'
                ? peersBadge
                : tab.key === 'chief'
                  ? secBadge
                  : tab.key === 'archive'
                    ? archiveBadge
                    : 0
            return h(
              'button',
              {
                key: tab.key,
                className: 'dnb-seg-btn',
                'data-active': view.tab === tab.key ? '1' : '0',
                onClick: () => patch({ tab: tab.key }),
              },
              tab.label,
              count
                ? h('span', {
                    className: 'dnb-seg-dot',
                    style: tab.key === 'chief'
                      ? { color: 'var(--dnb-accent)', opacity: 1, fontWeight: 700 }
                      : tab.key === 'archive'
                        ? { color: '#f59e0b', opacity: 1, fontWeight: 700 }
                        : undefined,
                  }, String(count))
                : null,
            )
          }),
        ),
      ),

      // Stale Backend Module Notice (if desktop host still holds pre-1.2.0-r5 backend in RAM)
      view.staleBackendDetected && !view.staleBackendDismissed
        ? h(
            'div',
            {
              style: {
                margin: '0 12px 8px',
                padding: '6px 10px',
                borderRadius: 10,
                border: '1px solid rgba(245, 158, 11, 0.42)',
                background: 'rgba(245, 158, 11, 0.12)',
                color: '#f59e0b',
                fontSize: 11.5,
                lineHeight: 1.45,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
              },
            },
            h('span', null, '⚠ 检测到宿主进程仍在运行旧版内存模块（当前面板 v' + EXPECTED_BACKEND_BUILD + (meta.backendBuild ? '，内存后端 v' + meta.backendBuild : '') + '），请重启 DeepSeek Harness 客户端或重载插件后完全生效。'),
            h('span', { style: { cursor: 'pointer', paddingLeft: 6, flexShrink: 0 }, onClick: () => patch({ staleBackendDismissed: true }) }, '×'),
          )
        : null,

      view.hostCompat && view.hostCompat.present && view.hostCompat.namedSubagentsSupported === false && !view.hostCompatDismissed
        ? h(
            'div',
            {
              style: {
                margin: '0 12px 8px',
                padding: '6px 10px',
                borderRadius: 10,
                border: '1px solid rgba(245, 158, 11, 0.42)',
                background: 'rgba(245, 158, 11, 0.12)',
                color: '#f59e0b',
                fontSize: 11.5,
                lineHeight: 1.45,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
              },
            },
            h('span', null, '⚠ ' + (view.hostCompat.warning || '当前 DSH 宿主版本不支持命名子代理 API，请升级至 >= 0.2.2-rc.2。')),
            h('span', { style: { cursor: 'pointer', paddingLeft: 6, flexShrink: 0 }, onClick: () => patch({ hostCompatDismissed: true }) }, '×'),
          )
        : null,

      // Error Banner (only on API failure)
      view.error
        ? h(
            'div',
            {
              style: {
                margin: '0 12px 8px',
                padding: '6px 10px',
                borderRadius: 10,
                background: STATUS_BG.blocked,
                color: '#ff453a',
                fontSize: 11.5,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              },
            },
            h('span', null, view.error),
            h('span', { style: { cursor: 'pointer', paddingLeft: 8 }, onClick: () => patch({ error: '' }) }, '×'),
          )
        : null,

      // Tab Body Protected by Error Boundary
      h(
        'div',
        { className: 'dnb-body' },
        h(ChiefErrorBoundary, { key: view.tab + ':' + (view.sessionId || 'none') }, body),
      ),

      // Persistent Bottom Chief Input & Relay Bar
      h(ChiefComposerBar, { view, barRef: secBarRef }),

      // Chief System Active Working Stage FX Overlay (Frontend action OR Backend auto-maintenance)
      h(ChiefWorkStageOverlay, { fx: view.chiefWorkFx || (meta && meta.activeWork) || null }),

      // Scoped Modal Overlays (Strictly bounded inside .dnb-panel)
      h(ChiefRiskConfirmModal, { view }),
      h(OperationApprovalModal, { view }),
      h(ElevationRequestModal, { view }),
      h(AuditLogModal, { view }),
      h(InterventionConfirmModal, { view, board }),
      h(HazardHaltModal, { view }),
      h(UnlimitedTurnsConfirmModal, { view }),
      h(AutoPilotConfirmModal, { view }),
      h(ArchiveRelayModal, { view }),
      h(DistillToGlobalModal, { view }),
      h(ChiefAdviceModal, { view }),
      h(PrecipitateConfirmModal, { view }),
      h(PeerLinkConfirmModal, { view }),
      h(HandoffWarnModal, { view }),

      // Floating iOS Toast
      view.notice ? h('div', { className: 'dnb-toast' }, view.notice) : null,
    ),
  )
}

export function Panel(props) {
  return h(ChiefErrorBoundary, null, h(PanelInner, props))
}

/* -------------------------------------------------- Session & Triggers */

function useIsSubagentSession(sessionId) {
  const [isSub, setIsSub] = React.useState(isSubagentSessionId(sessionId))
  React.useEffect(() => {
    const check = () => {
      const next = isSubagentSessionId(sessionId)
      setIsSub(prev => (prev === next ? prev : next))
    }
    check()
    const unsubStore = subscribe(check)
    const sessions = service('sessions')
    let unsubSessions = null
    try {
      if (sessions && sessions.list && typeof sessions.list.subscribe === 'function') {
        unsubSessions = sessions.list.subscribe(check)
      } else if (sessions && typeof sessions.subscribe === 'function') {
        unsubSessions = sessions.subscribe(check)
      }
    } catch {}
    return () => {
      unsubStore()
      if (typeof unsubSessions === 'function') {
        try { unsubSessions() } catch {}
      }
    }
  }, [sessionId])
  return isSub
}

export function SessionProbe(props) {
  const sessionId = props && props.sessionId ? String(props.sessionId) : ''
  const inputActions = props ? props.inputActions : null
  const isSubagent = useIsSubagentSession(sessionId)
  React.useEffect(() => {
    if (!sessionId || isSubagent) {
      adoptSession('header', '')
      return undefined
    }
    adoptSession('header', sessionId, inputActions)
    return () => adoptSession('header', '')
  }, [sessionId, inputActions, isSubagent])
  return null
}

function useDockShown() {
  const view = useStore()
  const [expanded, setExpanded] = React.useState(() => rightbarExpanded())
  React.useEffect(() => {
    const read = () => {
      const next = rightbarExpanded()
      setExpanded(prev => (prev === next ? prev : next))
    }
    read()
    const timer = setInterval(read, DOCK_POLL_MS)
    return () => clearInterval(timer)
  }, [])
  return !!(view.dock && expanded)
}

export function ChiefIcon(props) {
  const size = props && typeof props.size === 'number' && props.size > 0 ? props.size : 18
  const active = !!(props && props.active)
  return h(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: active ? 2 : 1.65,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
      focusable: false,
      style: { display: 'block' },
    },
    h('path', { d: 'M13 3.5H7.5A2.5 2.5 0 0 0 5 6v12a2.5 2.5 0 0 0 2.5 2.5h9A2.5 2.5 0 0 0 19 18v-5.5' }),
    h('path', { d: 'M8.5 10h5.5M8.5 13.5h7M8.5 17h4' }),
    h('path', { d: 'M18 3l.9 2.1L21 6l-2.1.9L18 9l-.9-2.1L15 6l2.1-.9L18 3z' }),
  )
}

function TriggerButton(props) {
  const view = useStore()
  const tasks = (view.board && Array.isArray(view.board.tasks)) ? view.board.tasks : []
  const openCount = tasks.filter(t => t && t.status !== 'done').length
  const pendingSug = (view.chiefMeta && view.chiefMeta.pendingSuggestions) || 0
  const badgeCount = openCount + pendingSug
  const dockShown = useDockShown()
  const showing = view.panel === SIDE_ID || dockShown
  const compact = !!(props && props.compact)
  return h(
    'button',
    {
      className: 'dnb-btn',
      'data-active': showing || view.open ? '1' : '0',
      title: (showing || view.open) ? ('收起 ' + BRAND_NAME) : ('打开 ' + BRAND_NAME),
      'aria-label': BRAND_NAME,
      'aria-expanded': showing || view.open ? 'true' : 'false',
      onClick: () => {
        toggleChief()
      },
    },
    h(ChiefIcon, { size: 16, active: showing || view.open }),
    compact ? null : h('span', null, BRAND_NAME),
    badgeCount ? h('span', { className: 'dnb-count' }, String(badgeCount)) : null,
  )
}

export function ComposerEntry(props) {
  const sessionId = props && props.sessionId ? String(props.sessionId) : ''
  const inputActions = props ? props.inputActions : null
  const isSubagent = useIsSubagentSession(sessionId)
  React.useEffect(() => {
    if (!sessionId || isSubagent) {
      adoptSession('composer', '')
      return undefined
    }
    adoptSession('composer', sessionId, inputActions)
    return () => adoptSession('composer', '')
  }, [sessionId, inputActions, isSubagent])
  if (isSubagent) return null
  return h(React.Fragment, null, h(Style, null), h(TriggerButton, { compact: true }))
}

export function CornerTrigger() {
  const view = useStore()
  const dockShown = useDockShown()
  const urlSid = sessionIdFromUrl()
  const isSubagent = useIsSubagentSession(urlSid)
  const showing = view.open || view.panel === SIDE_ID || dockShown
  if (showing || isSubagent) return null
  return h(
    'button',
    {
      className: 'dnb-btn',
      title: '打开 ' + BRAND_NAME,
      'aria-label': BRAND_NAME,
      onClick: () => {
        if (openChief()) return
        patch({ open: true })
      },
      style: {
        position: 'fixed',
        right: '16px',
        bottom: '88px',
        zIndex: 30,
        width: '36px',
        height: '36px',
        borderRadius: '18px',
        border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,136,0.25))',
        background: 'var(--dsw-alias-bg-elevated, rgba(38,38,42,0.9))',
        backdropFilter: 'blur(12px)',
        boxShadow: '0 4px 14px rgba(0,0,0,0.2)',
        color: 'var(--dsw-alias-label-primary)',
      },
    },
    h(ChiefIcon, { size: 17 }),
  )
}

export function MainPanel() {
  React.useEffect(() => {
    patch({ panel: SIDE_ID })
    return () => {
      if (store.panel === SIDE_ID) patch({ panel: '' })
    }
  }, [])
  return h('div', { className: 'dnb-page' }, h(Panel, { variant: 'main' }))
}

export function SidebarChiefTab(props) {
  const sessionId = props && props.sessionId ? String(props.sessionId) : ''
  const isSubagent = useIsSubagentSession(sessionId)
  React.useEffect(() => {
    runtimeRefs.dockMountCount += 1
    patch({ dock: true })
    return () => {
      runtimeRefs.dockMountCount = Math.max(0, runtimeRefs.dockMountCount - 1)
      if (runtimeRefs.dockMountCount === 0 && store.dock) patch({ dock: false })
    }
  }, [])
  React.useEffect(() => {
    if (!sessionId || isSubagent) {
      adoptSession('dock', '')
      return undefined
    }
    adoptSession('dock', sessionId, null)
    return () => adoptSession('dock', '')
  }, [sessionId, isSubagent])
  return h('div', { className: 'dnb-page dnb-dock-page' }, h(Panel, { variant: 'dock' }))
}
