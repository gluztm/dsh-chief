/**
 * src/client/api.js — 客户端 API 总入口门面与会话绑定协调器（`adoptSession`）
 *
 * 【核心职责】
 *   1. 对外部组件统一暴露原本来自单一巨石 `api.js` 的全部动作与请求函数（零改动外部导入路径）。
 *   2. 持有 `clearBoundSessionToBlank` 与 `adoptSession`，负责多宿主入口切换会话时的防抖清理与状态重置。
 *
 * 【模块拆分布局（`src/client/api/`）】
 *   - `api/transport.js` 底层 HTTP `call`、`applySecView`、工作态流光动效与 `apiBridge`
 *   - `api/board.js`     任务板 `act` / `refresh`、交接单、记忆检索、红线与自定义拦截规则
 *   - `api/archives.js`  档案柜加载、收割/沉淀/蒸馏、跨窗口接力与目标审批
 *   - `api/chief.js`     参谋视图、模型目录、协同水泡控制与许愿盒对话提交
 */

import { store, SESSION_SOURCES, patch, isSubagentSessionId, runtimeRefs } from './store.js'
import { sessionIdFromUrl } from './utils.js'
import { call, applySecView } from './api/transport.js'
import {
  refresh,
  act,
  loadTargets,
  loadHandoff,
  saveHandoffCustom,
  toggleHandoffPin,
  resetHandoffAuto,
  toggleSyncHandoffOnDigest,
  requestTransferWithGuard,
  transfer,
  searchBoard,
  sendToComposer,
  askLeadModel,
  copyText,
  addBoundRule,
  toggleBoundPin,
  removeBoundRule,
  editBoundRule,
  toggleBoundSelect,
  saveGuardWallApi,
  setGuardWallScopeApi,
  setAllGuardWallsScopeApi,
  removeGuardWallApi,
  toggleGuardWallSelect,
  mergeGuardWallsApi,
  openTaskEditor,
} from './api/board.js'
import {
  loadArchives,
  loadArchiveDetail,
  mutateArchiveApi,
  requestOrganizeArchives,
  harvestArchivesApi,
  precipitateArchivesApi,
  toggleSelectArchive,
  clearSelectedArchives,
  openArchiveRelayModal,
  relayArchivesWithChiefApi,
  distillToGlobalApi,
  approveGoalApi,
  rejectGoalApi,
  deliverArchiveToChat,
  searchColdArchives,
} from './api/archives.js'
import {
  loadChiefView,
  loadChiefModels,
  updateSecConfig,
  applyScenarioPreset,
  decideApproval,
  decideElevation,
  togglePeerSessionLink,
  toggleBubbleHarness,
  toggleBubbleLock,
  emergencyStopBubble,
  dispatchBubbleHarness,
  refreshBubbleDiscovery,
  requestTogglePeerLink,
  decideSuggestion,
  executePendingSuggestions,
  dismissPendingSuggestions,
  requestConsolidateBounds,
  prefillSuggestion,
  ingestSecImageFiles,
  submitChiefBar,
  fetchGithubStarStatus,
  toggleGithubStarApi,
} from './api/chief.js'

export {
  call,
  applySecView,
  refresh,
  act,
  loadTargets,
  loadHandoff,
  saveHandoffCustom,
  toggleHandoffPin,
  resetHandoffAuto,
  toggleSyncHandoffOnDigest,
  requestTransferWithGuard,
  transfer,
  searchBoard,
  sendToComposer,
  askLeadModel,
  copyText,
  addBoundRule,
  toggleBoundPin,
  removeBoundRule,
  editBoundRule,
  toggleBoundSelect,
  saveGuardWallApi,
  setGuardWallScopeApi,
  setAllGuardWallsScopeApi,
  removeGuardWallApi,
  toggleGuardWallSelect,
  mergeGuardWallsApi,
  openTaskEditor,
  loadArchives,
  loadArchiveDetail,
  mutateArchiveApi,
  requestOrganizeArchives,
  harvestArchivesApi,
  precipitateArchivesApi,
  toggleSelectArchive,
  clearSelectedArchives,
  openArchiveRelayModal,
  relayArchivesWithChiefApi,
  distillToGlobalApi,
  approveGoalApi,
  rejectGoalApi,
  deliverArchiveToChat,
  searchColdArchives,
  loadChiefView,
  loadChiefModels,
  updateSecConfig,
  applyScenarioPreset,
  decideApproval,
  decideElevation,
  togglePeerSessionLink,
  toggleBubbleHarness,
  toggleBubbleLock,
  emergencyStopBubble,
  dispatchBubbleHarness,
  refreshBubbleDiscovery,
  requestTogglePeerLink,
  decideSuggestion,
  executePendingSuggestions,
  dismissPendingSuggestions,
  requestConsolidateBounds,
  prefillSuggestion,
  ingestSecImageFiles,
  submitChiefBar,
  fetchGithubStarStatus,
  toggleGithubStarApi,
}

function clearBoundSessionToBlank() {
  runtimeRefs.sessionClearTimer = null
  let stillActive = ''
  for (const value of SESSION_SOURCES.values()) {
    if (value) stillActive = value
  }
  if (stillActive || sessionIdFromUrl()) return
  if (!store.sessionId) return
  store.sessionId = ''
  patch({
    sessionId: '',
    open: false,
    board: null,
    secView: null,
    secLatestReply: null,
    secTarget: 'auto',
    selectedTaskId: '',
    focusTaskId: '',
    fleetShowAll: false,
    pyramidShowAllAgents: false,
    editTaskId: '',
    editNoteId: '',
    newNote: false,
    askHits: null,
    handoffText: '',
    handoffEdit: null,
    handoffEditing: false,
    handoffDraft: '',
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
    handoffWarnModal: null,
    peerLinkConfirmModal: null,
    mailChannelFilter: 'all',
    mailOpenDrawers: {},
    tacticalMenuOpen: false,
    interventionModalOpen: false,
    interventionAgreed: false,
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
    precipitateModal: null,
    autoPilotConfirmOpen: false,
    archiveRelayModal: null,
    distillGlobalModal: null,
    chiefAdviceModal: null,
    seenAdvicePopupIds: {},
    selectedArchiveMap: {},
    archiveDeskItems: [],
    archiveDeskLoaded: false,
    compactLowWarning: '',
    archiveLoaded: false,
    archiveSessionLoaded: false,
    globalVaultLoaded: false,
    archiveDiffSummary: null,
    archiveCabinetId: '',
    archiveCabinets: [],
    archiveFolders: [],
    archiveItems: [],
    archiveDetails: {},
    archiveOpenFolders: {},
    archiveOpenFiles: {},
    archiveSearchOpen: false,
    archiveMoreMenuOpen: false,
    archiveSelectMode: false,
    chiefMoreMenuOpen: false,
    boundMoreMenuOpen: false,
    qaCollapsedTurnIds: {},
    wallSelectedIds: [],
    wallMergeError: '',
    chiefWorkFx: null,
    seenBackendWorkIds: {},
    archiveUnboundSession: true,
  })
  void refresh()
  if (store.tab === 'archive') void loadArchives(true)
}

export function adoptSession(source, sessionId, inputActions) {
  const cleanSid = sessionId && isSubagentSessionId(sessionId) ? '' : sessionId
  if (cleanSid) SESSION_SOURCES.set(source, cleanSid)
  else SESSION_SOURCES.delete(source)
  if (cleanSid && inputActions && inputActions !== store.inputActions) store.inputActions = inputActions

  let next = ''
  for (const value of SESSION_SOURCES.values()) {
    if (value) next = value
  }
  if (next && runtimeRefs.sessionClearTimer) {
    clearTimeout(runtimeRefs.sessionClearTimer)
    runtimeRefs.sessionClearTimer = null
  }
  // When navigating back to a blank new-chat screen without a session UUID, debounce-clear after 180ms
  if (!next && store.sessionId) {
    if (!runtimeRefs.sessionClearTimer && !sessionIdFromUrl()) {
      runtimeRefs.sessionClearTimer = setTimeout(clearBoundSessionToBlank, 180)
    }
    return
  }
  if (next === store.sessionId) return

  const switchedConversation = Boolean(store.sessionId && next && store.sessionId !== next)
  store.sessionId = next
  patch({
    sessionId: next,
    open: false,
    ...(switchedConversation
      ? {
          board: null,
          secView: null,
          secLatestReply: null,
          secTarget: 'auto',
          selectedTaskId: '',
          focusTaskId: '',
          fleetShowAll: false,
          pyramidShowAllAgents: false,
          editTaskId: '',
          editNoteId: '',
          newNote: false,
          askHits: null,
          handoffText: '',
          handoffEdit: null,
          handoffEditing: false,
          handoffDraft: '',
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
          handoffWarnModal: null,
          peerLinkConfirmModal: null,
          mailChannelFilter: 'all',
          mailOpenDrawers: {},
          tacticalMenuOpen: false,
          interventionModalOpen: false,
          interventionAgreed: false,
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
          precipitateModal: null,
          autoPilotConfirmOpen: false,
          archiveRelayModal: null,
          distillGlobalModal: null,
          chiefAdviceModal: null,
          seenAdvicePopupIds: {},
          hazardHaltModal: null,
          seenHazardAlertIds: {},
          selectedArchiveMap: {},
          archiveDeskItems: [],
          archiveDeskLoaded: false,
          compactLowWarning: '',
          archiveLoaded: false,
          archiveSessionLoaded: false,
          globalVaultLoaded: false,
          archiveDiffSummary: null,
          archiveCabinetId: '',
          archiveCabinets: [],
          archiveFolders: [],
          archiveItems: [],
          archiveDesktop: { pinnedDocuments: [], usedTokens: 0, tokenBudget: 2400, maxItems: 6, usagePct: 0, recentlyUnpinnedWatch: [] },
          archiveViewerSummary: null,
          archiveDetails: {},
          archiveOpenFolders: {},
          archiveOpenFiles: {},
          archiveSearchOpen: false,
          archiveMoreMenuOpen: false,
          archiveSelectMode: false,
          chiefMoreMenuOpen: false,
          boundMoreMenuOpen: false,
          qaCollapsedTurnIds: {},
          wallSelectedIds: [],
          wallMergeError: '',
          chiefWorkFx: null,
          seenBackendWorkIds: {},
          archiveUnboundSession: !next,
        }
      : {}),
  })
  void refresh()
  if (switchedConversation && store.tab === 'archive') void loadArchives(true)
}
