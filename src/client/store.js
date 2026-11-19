/**
 * store.js
 *
 * Centralized client store, subscription/patch bus, runtime DOM/Cordis handles, and sidebar navigation helpers.
 */

import { React } from './react-runtime.js'
import { SIDE_ID } from './constants.js'

export const store = {
  open: false,
  panel: '',
  dock: false,
  tab: 'chief',
  board: null,
  boundaries: null,
  error: '',
  notice: '',
  busy: false,
  sessionId: '',
  inputActions: null,
  searchOpen: false,
  askText: '',
  askHits: null,
  askNote: '',
  editTaskId: '',
  editTaskTitle: '',
  editTaskNote: '',
  editTaskIntent: '',
  editTaskEvidence: '',
  editTaskParentId: '',
  editTaskBlockedBy: [],
  selectedTaskId: '',
  focusTaskId: '',
  taskViewMode: 'graph',
  graphDir: 'TD',
  taskStatusFilter: 'all',
  filterAgent: '',
  fleetCollapsed: false,
  fleetShowAll: false,
  pyramidShowAllAgents: false,
  showInternalProbes: false,
  subagents: [],
  agentIdentity: null,
  handoffText: '',
  handoffEdit: null,
  targets: [],
  target: 'new',
  pending: null,
  autoInject: true,
  guardIdle: true,
  guardMaxPerSession: 3,
  guardShortAnswer: 600,
  transferNote: '',
  handoffBusy: false,
  copied: false,
  exported: false,
  transferred: false,
  editNoteId: '',
  editNoteTitle: '',
  editNoteBody: '',
  editNoteTags: '',
  editNoteShared: false,
  newNote: false,
  memAsk: '',
  memReply: '',
  memHits: null,
  memNote: '',
  memSections: [],
  memCount: 0,
  memDigest: '',
  memOpen: '',
  memBusy: false,
  memComposerOpen: false,
  memText: '',
  memTitle: '',
  memSection: 'other',
  boundDraft: { allowed: '', forbidden: '', notes: '' },
  boundPinDraft: { allowed: false, forbidden: false, notes: false },
  boundSelected: { allowed: [], forbidden: [], notes: [] },
  boundConsolidating: '',
  boundSubTab: 'rules',
  boundCollapsedCols: {},
  wallCollapsed: false,
  wallSelectedIds: [],
  wallMergeError: '',
  qaCollapsedTurnIds: {},
  chiefWorkFx: null,
  guardWalls: [],
  wallFormOpen: false,
  wallDraftTitle: '',
  wallDraftPattern: '',
  wallDraftField: 'forbid_cmd',
  wallDraftScope: 'global',
  // DSH Chief state
  chiefMeta: {
    runMode: 'off',
    managedIdleTimeoutMs: 15 * 60 * 1000,
    paceMode: 'manual',
    stopped: false,
    permissionMode: 'advisor',
    thinkingEffort: 'auto',
    teamEffortMode: 'auto',
    lockedModelEfforts: {},
    chiefRiskVerified: false,
    chiefRiskAck: null,
    pendingApprovals: [],
    pendingElevation: null,
    auditLog: [],
    autoPilot: false,
    tacticalModes: {
      intervention: false,
      maxInterventionTurns: 10,
      strictVerify: false,
      autoCompact: false,
      smartCompact: false,
      compactThresholdMode: 'pct',
      compactThresholdPct: 80,
      compactThresholdTokens: 64000,
      compactThresholdInput: '64K',
      redlineSentinel: false,
      conciseBrief: false,
    },
    runtimeGuard: {
      consecutiveInterventionTurns: 0,
      lastInterventionSignature: '',
      circuitBroken: false,
      circuitReason: '',
      lastCompactedSeq: 0,
      lastCompactedAt: 0,
    },
    flippedCount: 0,
    modelRef: '',
    followModelRef: '',
    resolvedModelRef: '',
    pendingSuggestions: 0,
    factsCount: 0,
    mailboxCount: 0,
    linkedPeersCount: 0,
    activeWork: null,
    backendBuild: '',
  },
  seenBackendWorkIds: {},
  staleBackendDetected: false,
  staleBackendDismissed: false,
  hostCompat: null,
  hostCompatDismissed: false,
  handoffMeta: {
    source: 'auto',
    isCustom: false,
    pinned: false,
    syncOnDigest: false,
    isIncomplete: false,
    isStale: false,
    hasNarrativeUpdate: false,
    autoText: '',
    updatedAt: 0,
  },
  handoffEditing: false,
  handoffDraft: '',
  handoffWarnModal: null,
  peerLinkConfirmModal: null,
  mailChannelFilter: 'all',
  mailOpenDrawers: {},
  secView: null,
  secBusy: false,
  chiefQuickAction: '',
  secRegenerating: false,
  secSubTab: 'digest',
  secInput: '',
  secImages: [],
  secDragOver: false,
  secTarget: 'auto',
  secMode: 'steer',
  secLatestReply: null,
  secModelMenuOpen: false,
  secPaceMenuOpen: false,
  secPermMenuOpen: false,
  tacticalMenuOpen: false,
  interventionModalOpen: false,
  interventionAgreed: false,
  unlimitedTurnsModalOpen: false,
  autoPilotConfirmOpen: false,
  chiefRiskModalOpen: false,
  chiefRiskAgreed: false,
  chiefRiskBusy: false,
  dismissedApprovalIds: {},
  openApprovalModalId: '',
  approvalBusyId: '',
  dismissedElevationIds: {},
  elevationChosenMode: '',
  elevationAgreed: false,
  elevationBusy: false,
  auditLogModalOpen: false,
  archiveRelayModal: null,
  relayArchivesBusy: false,
  distillGlobalModal: null,
  distillBusy: false,
  chiefAdviceModal: null,
  seenAdvicePopupIds: {},
  hazardHaltModal: null,
  seenHazardAlertIds: {},
  compactInputDraft: null,
  compactLowWarning: '',
  precipitateModal: null,
  deployArchivePolicy: 'none',
  deployDrawer: '',
  planResetPrompt: null,
  secModelsCatalog: null,
  secNewFactText: '',
  secNewFactCat: 'discipline',
  secShowRawTurns: false,
  // Engineering Memory Filing Cabinet (桌面独立 + 三层档案柜 · Desktop / Session / System Global Cold / Precipitated Cold)
  archiveTabScope: 'desktop',
  archiveSearchOpen: false,
  archiveMoreMenuOpen: false,
  archiveShowEmptyDrawers: false,
  archiveSelectMode: false,
  chiefMoreMenuOpen: false,
  boundMoreMenuOpen: false,
  chiefDisclaimerOpen: false,
  archiveUnboundSession: false,
  archiveSessionLoaded: false,
  globalVaultLoaded: false,
  globalVaultStaleBlocked: false,
  globalVaultDiffFilter: 'all',
  globalShowLocalOnlyDrawer: false,
  archiveDiffSummary: null,
  selectedArchiveMap: {},
  archiveDeskItems: [],
  archiveDeskLoaded: false,
  archiveCounts: {
    sessionCount: 0,
    globalCount: 0,
    globalMountedCount: 0,
    precipitatedCount: 0,
    flippedCount: 0,
    unboundSession: false,
  },
  archiveMeta: {
    projectKey: '',
    activeCabinetId: '',
    cabinetCount: 0,
    totalCount: 0,
    folderCount: 0,
    takenOutCount: 0,
    unorganizedCount: 0,
    precipitatedCount: 0,
    flippedCount: 0,
  },
  archiveLoaded: false,
  archiveLoading: false,
  archiveOrganizing: false,
  archiveOrganizeOpen: false,
  archiveOrganizeScope: 'unorganized',
  archiveOrganizePrompt: '',
  archiveHarvesting: false,
  archiveSweeping: false,
  archivePrecipitating: false,
  archiveProjectKey: '',
  archiveCabinetId: '',
  archiveCabinets: [],
  archiveFolders: [],
  archiveItems: [],
  archiveDesktop: { pinnedDocuments: [], usedTokens: 0, tokenBudget: 2400, maxItems: 6, usagePct: 0, recentlyUnpinnedWatch: [] },
  archiveViewerSummary: null,
  globalVaultFolders: [],
  globalVaultItems: [],
  archivePrecipitated: [],
  precipitatedFolders: [],
  precipitatedViewerSummary: null,
  precipOpenDrawers: { coords: true, incidents: true, contracts: true, ops: true, plans: true, inbox: true },
  flippedPrecipitatedIds: [],
  archiveNewCabinetOpen: false,
  archiveNewCabinetName: '',
  archiveDetails: {},
  archiveDetailLoading: {},
  archiveOpenFolders: {},
  archiveOpenFiles: {},
  archiveOpenPoints: {},
  archiveRawView: {},
  archiveFilterClip: 'all',
  archiveQuery: '',
  archiveEditor: null,
  archiveMoveId: '',
  archiveNewFolderOpen: false,
  archiveNewFolderName: '',
  archiveSearchBusy: false,
}

const listeners = new Set()

export const runtimeRefs = {
  panelEl: null,
  navigation: null,
  layout: null,
  hostCtx: null,
  secInputEl: null,
  dockMountCount: 0,
  sessionClearTimer: null,
  initialRightbarSeeded: false,
  userDismissedChief: false,
}

let noticeTimer = null

let seedAt = 0

export const SESSION_SOURCES = new Map()

export function notify() {
  for (const listener of listeners) {
    try {
      listener()
    } catch (error) {
      console.error('dsh-chief listener failed', error)
    }
  }
}

export function patch(next) {
  Object.assign(store, next)
  if (next && typeof next.notice === 'string' && next.notice) {
    if (noticeTimer) clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => {
      if (store.notice === next.notice) patch({ notice: '' })
    }, 2800)
  }
  notify()
}

export function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useStore() {
  const [, bump] = React.useState(0)
  React.useEffect(() => subscribe(() => bump(v => v + 1)), [])
  return store
}

/* ----------------------------------------------------------- text helpers */

/** Jump directly to the visual Pyramid view and spotlight-frame the subagents advancing `taskId`. */
export function focusObjectiveInPyramid(taskId, opts = {}) {
  if (!taskId) {
    patch({ focusTaskId: '' })
    return
  }
  patch({
    tab: 'tasks',
    taskViewMode: 'graph',
    graphDir: 'TD',
    focusTaskId: taskId,
    filterAgent: '',
    taskStatusFilter: 'all',
    selectedTaskId: opts.openInspector ? taskId : '',
  })
}

export function focusSecInput() {
  setTimeout(() => {
    try {
      if (runtimeRefs.secInputEl && typeof runtimeRefs.secInputEl.focus === 'function') runtimeRefs.secInputEl.focus()
    } catch {}
  }, 30)
}

export function service(name) {
  if (!runtimeRefs.hostCtx || typeof runtimeRefs.hostCtx.get !== 'function') return null
  try {
    return runtimeRefs.hostCtx.get(name) || null
  } catch {
    return null
  }
}

/** Detect whether a DSH sessionId belongs to a subagent (should hide Chief entry). */
export function isSubagentSessionId(sessionId) {
  const sid = typeof sessionId === 'string' ? sessionId.trim() : ''
  if (!sid) return false
  const sessions = service('sessions')
  if (sessions) {
    try {
      if (typeof sessions.subagentAddress === 'function') {
        const addr = sessions.subagentAddress(sid)
        if (addr !== undefined && addr !== null) return true
      }
    } catch {}
    try {
      const snap = sessions.list && typeof sessions.list.getSnapshot === 'function'
        ? sessions.list.getSnapshot()
        : null
      const entry = snap && snap.byId ? snap.byId[sid] : null
      if (entry && typeof entry === 'object') {
        if (entry.origin === 'subagent' || entry.kind === 'subagent') return true
        const parent = entry.parentId || entry.parentSessionId
        if (typeof parent === 'string' && parent.trim() && parent.trim() !== sid) return true
      }
    } catch {}
  }
  const idt = store.agentIdentity
  if (idt && idt.sessionId === sid) {
    if (idt.isSubagent) return true
    if (idt.parentId && idt.parentId !== sid) return true
  }
  const subs = Array.isArray(store.subagents) ? store.subagents : []
  return subs.some(s => s && s.id === sid && s.parentId && s.parentId !== sid)
}

export function selectPanel(id) {
  if (!runtimeRefs.layout || typeof runtimeRefs.layout.selectPanel !== 'function') return false
  try {
    runtimeRefs.layout.selectPanel(id)
    return true
  } catch {
    return false
  }
}

function openTabInRightbar(kind) {
  const face = service('sidebarRight')
  if (!face || typeof face.openTab !== 'function') return false
  try {
    face.openTab(kind, { revealIfOpened: true })
    if (typeof face.isExpanded === 'function' && !face.isExpanded() && typeof face.toggleExpanded === 'function') {
      face.toggleExpanded()
    }
    return true
  } catch {
    const sessionId = store.sessionId
    if (sessionId && typeof face.openTabIn === 'function') {
      try {
        face.openTabIn(sessionId, kind, { revealIfOpened: true })
        return true
      } catch {}
    }
    return false
  }
}

/** Open a subagent's live chat stream in DSH's right sidebar split pane. */
export function openSubagentChat(agent) {
  if (!agent || !agent.id) return false
  const face = service('sidebarRight')
  if (!face || typeof face.openResource !== 'function') return false
  const parent = agent.parentId || (store.agentIdentity && store.agentIdentity.rootId) || store.sessionId
  if (!parent) return false
  const mode = agent.mode || 'continuable'
  const query = new URLSearchParams({ parent, mode })
  const url = 'dsh-resource://subagentchat/session/' + encodeURIComponent(agent.id) + '?' + query.toString()
  try {
    face.openResource(url, { revealIfOpened: true, preferNewPane: true })
    return true
  } catch {
    try {
      face.openResource(url, { revealIfOpened: true })
      return true
    } catch {
      return false
    }
  }
}

export function rightbarExpanded() {
  const face = service('sidebarRight')
  if (!face || typeof face.isExpanded !== 'function') return false
  try {
    return !!face.isExpanded()
  } catch {
    return false
  }
}

function chiefShown() {
  if (typeof document === 'undefined') return false
  const panel = document.querySelector('.dnb-panel')
  if (!panel) return false
  const rect = panel.getBoundingClientRect()
  if (rect.width < 40 || rect.height < 40) return false
  const style = getComputedStyle(panel)
  return style.visibility !== 'hidden' && style.display !== 'none'
}

function whenUnplaced(recover) {
  if (typeof requestAnimationFrame !== 'function') return
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (chiefShown()) return
      try {
        recover()
      } catch {}
    })
  })
}

export function openChief() {
  runtimeRefs.userDismissedChief = false
  if (openTabInRightbar(SIDE_ID)) {
    runtimeRefs.initialRightbarSeeded = true
    whenUnplaced(() => {
      if (selectPanel(SIDE_ID)) return
      patch({ open: true })
    })
    return 'dock'
  }
  if (selectPanel(SIDE_ID)) return 'page'
  return ''
}

export function closeChief() {
  runtimeRefs.userDismissedChief = true
  if (store.open) {
    patch({ open: false })
    return 'overlay'
  }
  if (store.dock && rightbarExpanded()) {
    const face = service('sidebarRight')
    if (face && typeof face.toggleExpanded === 'function') {
      try {
        face.toggleExpanded()
        return 'dock'
      } catch {}
    }
  }
  if (store.panel === SIDE_ID) {
    selectPanel(null)
    if (store.panel === SIDE_ID) patch({ panel: '' })
    return 'page'
  }
  return ''
}

export function toggleChief() {
  const dockShown = !!(store.dock && rightbarExpanded())
  const showing = !!(store.open || store.panel === SIDE_ID || dockShown)
  if (showing) {
    const closed = closeChief()
    if (closed) return closed
  }
  const opened = openChief()
  if (opened) return opened
  patch({ open: true })
  return 'overlay'
}

function tapAddTab(scope) {
  const button = scope && scope.querySelector('[data-dockkit-add-tab]')
  if (!button) return false
  try {
    button.click()
    return true
  } catch {
    return false
  }
}

export function seedRightbarIfEmpty() {
  if (typeof document === 'undefined') return false
  if (runtimeRefs.initialRightbarSeeded || runtimeRefs.userDismissedChief) return false
  if (store.open || store.dock || store.panel === SIDE_ID) {
    runtimeRefs.initialRightbarSeeded = true
    return false
  }
  const empty = document.querySelector('[data-dockkit-empty]')
  if (!empty) return false
  const strips = Array.from(empty.querySelectorAll('[data-dockkit-strip-tabs]'))
  if (strips.some(strip => strip.children.length > 0)) {
    runtimeRefs.initialRightbarSeeded = true
    return false
  }
  const now = Date.now()
  if (now - seedAt < 4000) return false
  seedAt = now
  runtimeRefs.initialRightbarSeeded = true
  if (openTabInRightbar(SIDE_ID)) {
    whenUnplaced(() => {
      if (runtimeRefs.userDismissedChief || chiefShown()) return
      const stillEmpty = document.querySelector('[data-dockkit-empty]')
      if (stillEmpty) tapAddTab(stillEmpty)
    })
    return true
  }
  return tapAddTab(empty)
}

/**
 * Horizontal-only clearance for fixed bottom-right desktop mascots overlapping the composer bar.
 * Never reserves vertical top/bottom padding (fixes body center jump & bottom void bugs).
 */
export function reserveCornerSpace(panelNode, secBarNode) {
  const none = { right: 0 }
  if (!panelNode || typeof document === 'undefined' || typeof window === 'undefined') return none
  const rect = panelNode.getBoundingClientRect()
  if (!rect.width || !rect.height) return none

  const barRect = secBarNode && typeof secBarNode.getBoundingClientRect === 'function'
    ? secBarNode.getBoundingClientRect()
    : { top: rect.bottom - 120, bottom: rect.bottom, left: rect.left, right: rect.right }

  const winW = window.innerWidth || document.documentElement.clientWidth || 0
  const winH = window.innerHeight || document.documentElement.clientHeight || 0
  const isFixedOverlay = el => {
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p)
      if (s.position === 'fixed' && (Number(s.zIndex) >= 10 || s.zIndex === 'auto')) return true
    }
    return false
  }

  let right = 0
  const candidates = document.body.querySelectorAll('img, video, canvas, [data-mascot], [class*="mascot"], [class*="pet"]')
  for (const el of candidates) {
    if (panelNode.contains(el)) continue
    const er = el.getBoundingClientRect()
    if (er.width < 28 || er.height < 28 || er.width > 320 || er.height > 320) continue
    if (er.bottom < winH - 60 || er.right < winW - 80) continue
    const yOverlap = Math.min(er.bottom, barRect.bottom) - Math.max(er.top, barRect.top - 4)
    if (yOverlap <= 0) continue
    if (er.left >= rect.right - 4 || er.right <= rect.left) continue
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) continue
    if (!isFixedOverlay(el)) continue
    const needed = Math.ceil(rect.right - er.left + 8)
    if (needed > right) right = needed
  }
  return {
    right: Math.max(0, Math.min(right, Math.round(rect.width * 0.36), 148)),
  }
}

/* ------------------------------------------------------------------- API */
