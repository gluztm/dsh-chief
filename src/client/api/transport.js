/**
 * src/client/api/transport.js — 底层 HTTP 通信、响应状态同步与参谋工作态动效协调器
 *
 * 【核心职责】
 *   1. `call(path, init)`：统一封装后端请求、版本漂移探测（`EXPECTED_BACKEND_BUILD`）、
 *      响应体内 `board` / `secView` / `archives` 元数据自动同步与错误提取。
 *   2. `syncBackendActiveWork` / `applySecView`：把后端参谋元信息与实时提醒写入前端 `store`。
 *   3. `classifyChiefWorkFx` / `resolveChiefSuggestionWorkFx` / `withChiefWorkFx`：
 *      管理底部参谋条调用时的流光/气泡状态指示与请求时序收敛。
 *
 * 【边界与无环约定】
 *   - 处于 `src/client/api/*` DAG 最底层，不直接 import `board.js` / `archives.js` / `chief.js`。
 *   - 跨模块异步唤醒通过 `apiBridge` 完成，确保 `verify-client-modular-build.mjs` 零环引用。
 */

import { API, EXPECTED_BACKEND_BUILD } from '../constants.js'
import { store, patch, runtimeRefs } from '../store.js'
import { normalizeMaxTurnsVal } from '../utils.js'
import { setRuntimeUiLang } from '../i18n.js'
import { processIncomingAlertEvents } from '../notify.js'

/** Late-bound callbacks populated by upper API domain modules without creating import cycles. */
export const apiBridge = {
  applyArchiveHeaders: null,
  loadArchives: null,
  loadChiefView: null,
  refresh: null,
}

export function syncBackendActiveWork(activeWork) {
  const cleanWork = activeWork && activeWork.id ? activeWork : null
  const prevWork = store.chiefMeta && store.chiefMeta.activeWork
  if (cleanWork) {
    const seen = store.seenBackendWorkIds || {}
    if (!store.chiefWorkFx && cleanWork.tab && !seen[cleanWork.id]) {
      patch({
        tab: cleanWork.tab,
        ...(cleanWork.boundSubTab ? { boundSubTab: cleanWork.boundSubTab } : {}),
        seenBackendWorkIds: { ...seen, [cleanWork.id]: true },
      })
      if (cleanWork.tab === 'archive' && !store.archiveLoaded && apiBridge.loadArchives) void apiBridge.loadArchives(false)
    } else if (cleanWork.id && !seen[cleanWork.id]) {
      patch({ seenBackendWorkIds: { ...seen, [cleanWork.id]: true } })
    }
    if (!runtimeRefs.fastWorkPollTimer && typeof setTimeout === 'function') {
      runtimeRefs.fastWorkPollTimer = setTimeout(() => {
        runtimeRefs.fastWorkPollTimer = null
        if (store.chiefMeta && store.chiefMeta.activeWork) {
          if (apiBridge.refresh) void apiBridge.refresh()
        }
      }, 1200)
    }
  } else if (prevWork && prevWork.id) {
    if (runtimeRefs.fastWorkPollTimer) {
      clearTimeout(runtimeRefs.fastWorkPollTimer)
      runtimeRefs.fastWorkPollTimer = null
    }
    if (prevWork.tab === 'archive' && apiBridge.loadArchives) void apiBridge.loadArchives(true)
    if (apiBridge.loadChiefView) void apiBridge.loadChiefView(false)
  }
}

export function applySecView(viewData) {
  if (!viewData || typeof viewData !== 'object') return
  const pendingSuggestions = Array.isArray(viewData.suggestions)
    ? viewData.suggestions.filter(s => s && s.status === 'pending').length
    : 0
  const factsCount = Array.isArray(viewData.facts) ? viewData.facts.length : 0
  const mailboxCount = Array.isArray(viewData.mailbox) ? viewData.mailbox.length : 0
  const linkedPeersCount = Array.isArray(viewData.cluster) ? Math.max(0, viewData.cluster.length - 1) : 0
  const modelsObj = viewData.models || store.secModelsCatalog || null
  const pinnedRef = (modelsObj && typeof modelsObj.selectedRef === 'string')
    ? modelsObj.selectedRef
    : ((viewData.config && viewData.config.modelRef) || '')
  const followRef = (modelsObj && (modelsObj.followRef || modelsObj.defaultRef))
    || (store.chiefMeta && store.chiefMeta.followModelRef)
    || ''
  const resolvedRef = (modelsObj && modelsObj.resolvedRef) || pinnedRef || followRef || ''
  const prevMeta = store.chiefMeta || {}
  const cfg = (viewData && viewData.config && typeof viewData.config === 'object') ? viewData.config : {}
  const incomingAlerts = Array.isArray(viewData.alertEvents) ? viewData.alertEvents : (prevMeta.alertEvents || [])
  const nextNotifyEnabled = typeof cfg.notifyEnabled === 'boolean' ? cfg.notifyEnabled : (prevMeta.notifyEnabled !== false)
  const nextNotifySound = typeof cfg.notifySound === 'boolean' ? cfg.notifySound : Boolean(prevMeta.notifySound)
  const nextUiLang = typeof cfg.uiLang === 'string' && cfg.uiLang ? cfg.uiLang : (prevMeta.uiLang || 'auto')
  if (typeof cfg.uiLang === 'string' && cfg.uiLang && (cfg.uiLang !== 'auto' || (prevMeta.uiLang && prevMeta.uiLang !== 'auto'))) {
    setRuntimeUiLang(cfg.uiLang)
  }
  const mergedTactical = cfg.tacticalModes && typeof cfg.tacticalModes === 'object'
    ? {
        ...(prevMeta.tacticalModes || {}),
        ...cfg.tacticalModes,
        ...(Object.prototype.hasOwnProperty.call(cfg.tacticalModes, 'maxInterventionTurns')
          ? { maxInterventionTurns: normalizeMaxTurnsVal(cfg.tacticalModes.maxInterventionTurns) }
          : {}),
      }
    : (prevMeta.tacticalModes || {})
  const patchObj = {
    secView: viewData,
    uiLangPref: nextUiLang,
    ...(viewData.models ? { secModelsCatalog: viewData.models } : {}),
    ...(Array.isArray(viewData.guardWalls) ? { guardWalls: viewData.guardWalls } : {}),
    chiefMeta: {
      ...prevMeta,
      chiefName: typeof cfg.chiefName === 'string' ? cfg.chiefName : (prevMeta.chiefName || ''),
      sessionEnabled: typeof cfg.sessionEnabled === 'boolean' ? cfg.sessionEnabled : prevMeta.sessionEnabled,
      defaultAutoEnableSessions: typeof cfg.defaultAutoEnableSessions === 'boolean' ? cfg.defaultAutoEnableSessions : Boolean(prevMeta.defaultAutoEnableSessions),
      globalSafetyGuardEnabled: typeof cfg.globalSafetyGuardEnabled === 'boolean' ? cfg.globalSafetyGuardEnabled : (prevMeta.globalSafetyGuardEnabled !== false),
      sessionSafetyGuardEnabled: typeof cfg.sessionSafetyGuardEnabled === 'boolean' ? cfg.sessionSafetyGuardEnabled : (prevMeta.sessionSafetyGuardEnabled !== false),
      runMode: cfg.runMode || (cfg.stopped ? 'off' : (cfg.paceMode === 'auto' ? 'managed' : (cfg.paceMode === 'smart' ? 'patrol' : 'off'))),
      managedIdleTimeoutMs: Number(cfg.managedIdleTimeoutMs) || prevMeta.managedIdleTimeoutMs || (15 * 60 * 1000),
      notifyEnabled: nextNotifyEnabled,
      notifySound: nextNotifySound,
      uiLang: nextUiLang,
      managedBudgetMaxCalls: cfg.managedBudgetMaxCalls !== undefined ? cfg.managedBudgetMaxCalls : (prevMeta.managedBudgetMaxCalls ?? 30),
      managedBudgetMaxTokens: cfg.managedBudgetMaxTokens !== undefined ? cfg.managedBudgetMaxTokens : (prevMeta.managedBudgetMaxTokens ?? 300000),
      llmLedgerSummary: viewData.llmLedger !== undefined ? viewData.llmLedger : (prevMeta.llmLedgerSummary || null),
      alertEvents: incomingAlerts,
      paceMode: cfg.paceMode || 'manual',
      stopped: Boolean(cfg.stopped || cfg.paceMode === 'stopped'),
      permissionMode: cfg.permissionMode || prevMeta.permissionMode || 'advisor',
      thinkingEffort: cfg.thinkingEffort || prevMeta.thinkingEffort || 'auto',
      teamEffortMode: cfg.teamEffortMode === 'manual' ? 'manual' : (cfg.teamEffortMode === 'auto' ? 'auto' : (prevMeta.teamEffortMode || 'auto')),
      lockedModelEfforts: (cfg.lockedModelEfforts && typeof cfg.lockedModelEfforts === 'object') ? cfg.lockedModelEfforts : (prevMeta.lockedModelEfforts || {}),
      chiefRiskVerified: Boolean(cfg.chiefRiskVerified || (viewData.chiefRiskAck && viewData.chiefRiskAck.acknowledged)),
      chiefRiskAck: viewData.chiefRiskAck !== undefined ? viewData.chiefRiskAck : (prevMeta.chiefRiskAck || null),
      pendingApprovals: Array.isArray(viewData.pendingApprovals) ? viewData.pendingApprovals : [],
      pendingElevation: viewData.pendingElevation !== undefined ? viewData.pendingElevation : null,
      auditLog: Array.isArray(viewData.auditLog) ? viewData.auditLog : [],
      autoPilot: Boolean(cfg.autoPilot),
      tacticalModes: mergedTactical,
      runtimeGuard: viewData.runtimeGuard && typeof viewData.runtimeGuard === 'object'
        ? viewData.runtimeGuard
        : (prevMeta.runtimeGuard || {}),
      flippedCount: Array.isArray(viewData.flippedPrecipitatedIds)
        ? viewData.flippedPrecipitatedIds.length
        : (prevMeta.flippedCount || 0),
      modelRef: pinnedRef,
      followModelRef: followRef,
      resolvedModelRef: resolvedRef,
      pendingSuggestions,
      factsCount,
      mailboxCount,
      linkedPeersCount,
      activeWork: viewData.activeWork !== undefined ? viewData.activeWork : (prevMeta.activeWork || null),
    },
  }
  const nextHazard = viewData.runtimeGuard && viewData.runtimeGuard.hazardAlert
  const seenHazards = store.seenHazardAlertIds || {}
  if (nextHazard && nextHazard.id && (nextHazard.reason || nextHazard.title) && !seenHazards[nextHazard.id] && !(store.hazardHaltModal && store.hazardHaltModal.id === nextHazard.id)) {
    patchObj.seenHazardAlertIds = { ...seenHazards, [nextHazard.id]: true }
    patchObj.hazardHaltModal = nextHazard
  }
  const nextWorkVal = patchObj.chiefMeta.activeWork
  patch(patchObj)
  syncBackendActiveWork(nextWorkVal)
  if (Array.isArray(viewData.alertEvents)) {
    processIncomingAlertEvents(viewData.alertEvents, {
      notifyEnabled: nextNotifyEnabled,
      notifySound: nextNotifySound,
      sessionId: store.sessionId,
    })
  }
}


export async function call(path, init) {
  const response = await fetch(API + '/' + path, {
    cache: 'no-store',
    credentials: 'same-origin',
    ...init,
    headers: { accept: 'application/json', ...(init && init.headers ? init.headers : {}) },
  })
  const text = await response.text()
  let value = null
  try {
    value = text ? JSON.parse(text) : null
  } catch {
    throw new Error('服务返回的数据格式不对：' + text.slice(0, 80))
  }
  if (value && value.board) patch({ board: value.board })
  if (value && Array.isArray(value.subagents)) patch({ subagents: value.subagents })
  if (value && value.agentIdentity) patch({ agentIdentity: value.agentIdentity })
  if (value && value.boundaries) patch({ boundaries: value.boundaries })
  if (value && Array.isArray(value.guardWalls)) patch({ guardWalls: value.guardWalls })
  if (value && (value.chiefMeta || value.hostCompat)) {
    const patchObj = {}
    if (value.chiefMeta) {
      const prevMeta = store.chiefMeta || {}
      const nextChiefMeta = { ...prevMeta, ...value.chiefMeta }
      if (typeof nextChiefMeta.uiLang === 'string' && nextChiefMeta.uiLang && (nextChiefMeta.uiLang !== 'auto' || (prevMeta.uiLang && prevMeta.uiLang !== 'auto'))) {
        setRuntimeUiLang(nextChiefMeta.uiLang)
        patchObj.uiLangPref = nextChiefMeta.uiLang
      }
      patchObj.chiefMeta = nextChiefMeta
      if (String(path || '').startsWith('snapshot')) {
        patchObj.staleBackendDetected = value.chiefMeta.backendBuild !== EXPECTED_BACKEND_BUILD
        if (value.chiefMeta.backendBuild === EXPECTED_BACKEND_BUILD) patchObj.staleBackendDismissed = false
      }
      const rg = value.chiefMeta.runtimeGuard
      const haz = rg && rg.hazardAlert && typeof rg.hazardAlert === 'object' ? rg.hazardAlert : null
      const seenH = store.seenHazardAlertIds || {}
      if (haz && haz.id && (haz.reason || haz.title) && !seenH[haz.id] && !(store.hazardHaltModal && store.hazardHaltModal.id === haz.id)) {
        patchObj.seenHazardAlertIds = { ...seenH, [haz.id]: true }
        patchObj.hazardHaltModal = haz
      }
    }
    const compat = value.hostCompat || (value.chiefMeta && value.chiefMeta.hostCompat)
    if (compat) patchObj.hostCompat = compat
    patch(patchObj)
    if (value.chiefMeta && Object.prototype.hasOwnProperty.call(value.chiefMeta, 'activeWork')) {
      syncBackendActiveWork(value.chiefMeta.activeWork)
    }
    if (value.chiefMeta && Array.isArray(value.chiefMeta.alertEvents)) {
      const effNotify = value.chiefMeta.notifyEnabled !== undefined ? value.chiefMeta.notifyEnabled : (store.chiefMeta && store.chiefMeta.notifyEnabled !== false)
      const effSound = value.chiefMeta.notifySound !== undefined ? value.chiefMeta.notifySound : Boolean(store.chiefMeta && store.chiefMeta.notifySound)
      processIncomingAlertEvents(value.chiefMeta.alertEvents, {
        notifyEnabled: effNotify,
        notifySound: effSound,
        sessionId: store.sessionId,
      })
    }
  }
  if (value && value.archiveMeta) {
    const nextMeta = { ...store.archiveMeta, ...value.archiveMeta }
    const nextCounts = (value.archiveMeta.counts && typeof value.archiveMeta.counts === 'object')
      ? { ...store.archiveCounts, ...value.archiveMeta.counts }
      : store.archiveCounts
    patch({
      archiveMeta: nextMeta,
      archiveCounts: nextCounts,
      ...(nextCounts && typeof nextCounts.unboundSession === 'boolean'
        ? { archiveUnboundSession: Boolean(nextCounts.unboundSession) }
        : {}),
    })
  }
  if (value && Array.isArray(value.deskItems)) {
    patch({ archiveDeskItems: value.deskItems, archiveDeskLoaded: true })
  }
  if (value && value.archives && Array.isArray(value.archives.items) && apiBridge.applyArchiveHeaders) apiBridge.applyArchiveHeaders(value.archives)
  if (value && value.view) applySecView(value.view)
  if (!response.ok || (value && value.ok === false)) {
    const err = new Error((value && value.error) || ('HTTP ' + response.status))
    err.status = response.status
    err.payload = value
    throw err
  }
  return value
}

export function classifyChiefWorkFx(text, quickTag = '') {
  if (quickTag === 'consult_chief') {
    return { tone: 'neon', tab: 'chief', label: '💡 参谋长正在看情况、想建议…' }
  }
  if (quickTag === 'dream_roam') {
    return { tone: 'dream', tab: 'archive', label: '🌙 参谋长正在梦境漫游，帮你整理档案…' }
  }
  if (quickTag === 'craft_wall') {
    return { tone: 'wall', tab: 'boundaries', boundSubTab: 'rules', label: '参谋长正在生成自定义拦截规则…' }
  }
  if (quickTag === 'extract_bounds') {
    return { tone: 'bounds', tab: 'boundaries', boundSubTab: 'rules', label: '参谋长正在整理 AI 规矩…' }
  }
  const clean = String(text || '').trim()
  const hits = []
  if (/梦境漫游|dream.?roam/i.test(clean)) {
    hits.push({ tone: 'dream', tab: 'archive', label: '🌙 参谋长正在梦境漫游，帮你整理档案…' })
  }
  if (/思考强度|思考挡位|推理强度|调挡|reasoningEffort|effortOps/i.test(clean)) {
    hits.push({ tone: 'neon', tab: store.tab || 'chief', label: '🧠 参谋长正在调整思考深度…' })
  }
  if (/置顶桌面|认知桌面|递送.*档案|拉阅.*钩子|archiveOps/i.test(clean)) {
    hits.push({ tone: 'archive', tab: 'archive', label: '📌 参谋长正在整理认知桌面资料…' })
  }
  if (/手搓|驻墙|筑墙|物理墙|拦截规则|guard_?wall|wallProposals/i.test(clean)) {
    hits.push({ tone: 'wall', tab: 'boundaries', boundSubTab: 'rules', label: '参谋长正在生成自定义拦截规则…' })
  }
  if (/提炼.{0,4}(边界|规矩)|工作边界|给 AI 的规矩|红线|必做项|注意事项|boundProposals/i.test(clean)) {
    hits.push({ tone: 'bounds', tab: 'boundaries', boundSubTab: 'rules', label: '参谋长正在整理 AI 规矩…' })
  }
  if (/整理档案|档案柜|卷宗|归档|收纳入柜|桌面档案|抽屉|archive/i.test(clean)) {
    hits.push({ tone: 'archive', tab: 'archive', label: '参谋长正在整理档案…' })
  }
  if (/任务看板|拆解任务|金字塔|子任务|graph\.plan/i.test(clean)) {
    hits.push({ tone: 'tasks', tab: 'tasks', label: '参谋长正在整理任务列表…' })
  }
  if (/执行计划|规划步骤|交接单|handoff/i.test(clean)) {
    hits.push({ tone: 'tasks', tab: 'tasks', label: '参谋长正在拟定执行计划…' })
  }
  if (/协同网络|跨窗|关联会话|子代理|广播/i.test(clean)) {
    hits.push({ tone: 'peers', tab: 'peers', label: '参谋长正在协调各窗口对话…' })
  }
  if (hits.length === 1) return hits[0]
  if (hits.length >= 2) {
    const allBoundaries = hits.every(x => x.tab === 'boundaries')
    return {
      tone: 'neon',
      tab: allBoundaries ? 'boundaries' : (store.tab || 'chief'),
      ...(allBoundaries ? { boundSubTab: 'rules' } : {}),
      label: allBoundaries ? '参谋长正在整理 AI 规矩和拦截规则…' : '参谋长正在批量处理中…',
    }
  }
  return {
    tone: 'neon',
    tab: store.tab || 'chief',
    label: '参谋长正在思考…',
  }
}

export function resolveChiefSuggestionWorkFx(suggestions = []) {
  const list = Array.isArray(suggestions) ? suggestions.filter(Boolean) : []
  if (!list.length) {
    return { tone: 'neon', tab: store.tab || 'chief', label: '参谋长正在执行你选的建议…' }
  }
  const kinds = new Set(list.map(s => String(s.kind || '').trim()))
  if (kinds.size === 1 && kinds.has('guard_wall')) {
    return { tone: 'wall', tab: 'boundaries', boundSubTab: 'rules', label: '参谋长正在启用自定义拦截规则…' }
  }
  if (kinds.size === 1 && kinds.has('wall_removal')) {
    return { tone: 'wall', tab: 'boundaries', boundSubTab: 'rules', label: '⚠️ 正在按你的确认调整自定义拦截规则…' }
  }
  if (kinds.size === 1 && kinds.has('bound')) {
    return { tone: 'bounds', tab: 'boundaries', boundSubTab: 'rules', label: '参谋长正在添加 AI 规矩…' }
  }
  if (kinds.size === 1 && kinds.has('archive_op')) {
    return { tone: 'archive', tab: 'archive', label: '📌 参谋长正在整理认知桌面资料…' }
  }
  if (kinds.size === 1 && kinds.has('model_effort')) {
    return { tone: 'neon', tab: 'chief', label: '🧠 参谋长正在调整思考深度…' }
  }
  const allBoundsPage = [...kinds].every(k => k === 'guard_wall' || k === 'bound')
  return {
    tone: 'neon',
    tab: allBoundsPage ? 'boundaries' : (store.tab || 'chief'),
    ...(allBoundsPage ? { boundSubTab: 'rules' } : {}),
    label: allBoundsPage ? '参谋长正在保存 AI 规矩和拦截规则…' : '🏁 参谋长正在依次执行建议…',
  }
}

export async function withChiefWorkFx(fxSpec = {}, fn) {
  const spec = fxSpec && typeof fxSpec === 'object' ? fxSpec : {}
  const token = 'fx-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)
  const targetTab = spec.tab || store.tab || 'chief'
  const minMs = Number(spec.minMs) || 0
  const startedAt = Date.now()
  patch({
    ...(spec.tab ? { tab: spec.tab } : {}),
    ...(spec.boundSubTab ? { boundSubTab: spec.boundSubTab } : {}),
    chiefWorkFx: {
      token,
      tone: spec.tone || 'neon',
      tab: targetTab,
      label: spec.label || '参谋长正在处理…',
    },
  })
  if (targetTab === 'archive' && !store.archiveLoaded) {
    void loadArchives(false)
  }
  let hadError = false
  try {
    return await fn()
  } catch (err) {
    hadError = true
    throw err
  } finally {
    if (!hadError && minMs > 0 && typeof window !== 'undefined') {
      const waitMs = minMs - (Date.now() - startedAt)
      if (waitMs > 24) {
        await new Promise(resolve => setTimeout(resolve, waitMs))
      }
    }
    if (store.chiefWorkFx && store.chiefWorkFx.token === token) {
      patch({ chiefWorkFx: null })
    }
  }
}

