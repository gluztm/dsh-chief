/**
 * chief-state.js — 参谋全局持久化状态读写锁、集群协同与运行配置主控模块
 *
 * 【核心职责】
 *   1. 管理单例 `cachedState`、跨进程排他锁（`acquireStateLock` + `try...finally { release() }`）、
 *      `mtimeMs` 缓存失效及 `renameSync` 原子落盘。
 *   2. 管理工作区配置变更（`updateChiefConfig`）、审批/提权/账本入队、集群联通（`setPeerLink`）、
 *      跨会话部署（`deployChiefWorkspaceState`）、托管预算熔断及水泡结构锁（`setBubbleManualLock`）。
 *   3. Re-export `state-schema.js` 与 `state-media.js` 全部原对外契约，保持 `chief.js` 67 个导出零变化。
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { threadId } from 'node:worker_threads'
import {
  resolveProjectKey,
  loadArchiveStore,
  loadGlobalVaultRaw,
  getChiefMountedGlobalForSession,
  getTakenOutGlobalForSession,
  collectSealedWatchSummary,
  getFlippedOutPrecipitatedForSession,
} from './archives.js'
import {
  DEFAULT_CHIEF_PERMISSION_MODE,
  CHIEF_PERMISSION_META,
  normalizePermissionMode,
  permissionRank,
  auditJsonlPath as safetyAuditJsonlPath,
  appendAuditJsonlRecord,
  validatePolicyPluginList,
} from './safety/index.js'
import {
  APPROVALS_CAP,
  AUDIT_LOG_CAP,
  TASK_LEDGER_CAP,
  DEFAULT_RESUME_TTL_MS,
  FACTS_CAP,
  FACT_TEXT_MAX,
  CHAT_CAP,
  MAIL_CAP,
  CHIEF_RUN_MODES,
  DEFAULT_MANAGED_IDLE_TIMEOUT_MS,
  LLM_LEDGER_RECENT_CAP,
  DEFAULT_MANAGED_BUDGET_MAX_CALLS,
  DEFAULT_MANAGED_BUDGET_MAX_TOKENS,
  CHIEF_SCENARIO_PRESETS,
  normalizeUiLang,
  normalizeManagedBudgetCalls,
  normalizeManagedBudgetTokens,
  classifyChiefLlmCategory,
  LLM_LEDGER_CALLS_MAX,
  LLM_LEDGER_TOKENS_MAX,
  emptyLlmLedger,
  normalizeLlmLedger,
  summarizeLlmLedger,
  pushAlertEventToWs,
  normalizeRunMode,
  normalizeThinkingEffort,
  normalizeTeamEffortMode,
  nextId,
  clamp,
  cleanMultiline,
  secretLike,
  containsChiefNameSecret,
  normalizeChiefName,
  computeApprovalPayloadHash,
  hasValidChiefRiskAck,
  normalizePendingApproval,
  normalizePendingElevation,
  normalizeTaskLedgerEntry,
  recoverTaskLedgerEntriesOnDiskLoad,
  normalizeAuditEntry,
  emptyWorkspace,
  normalizeFact,
  normalizeInquiryItem,
  normalizeMail,
  COMPACT_PCT_WARN_FLOOR,
  COMPACT_TOKEN_HARD_MIN,
  COMPACT_TOKEN_WARN_FLOOR,
  formatCompactTokenShort,
  parseCompactTokensInput,
  resolveWorkspaceConfig,
  isChiefSessionEnabled,
  normalizeTacticalModes,
  normalizeState,
  normalizeBubbleHarness,
  markTaskResumingActive,
  unmarkTaskResumingActive,
  SUGGESTIONS_CAP,
  MODEL_TIMEOUT_MS,
  CATALOG_TTL_MS,
  REVIEW_DELAY_MS,
  AUTO_SUMMARY_COOLDOWN_MS,
  SMART_REVIEW_COOLDOWN_MS,
  AUTO_REVIEW_COOLDOWN_MS,
  SUMMARY_MAX_TOKENS,
  SUMMARY_RETRY_MAX_TOKENS,
  CHIEF_UPDATE_SOURCE,
  CHIEF_RELAY_SOURCE,
  CHIEF_INQUIRY_SOURCE,
  CHIEF_EXEC_REQ_SOURCE,
  CHAT_OPPORTUNISTIC_SUMMARY_COOLDOWN_MS,
  CHIEF_THINKING_EFFORTS,
  ALERT_EVENTS_CAP,
  CHIEF_UI_LANGS,
  DEFAULT_EXTERNAL_MEMORY_CONFIG,
  normalizeExternalMemoryConfig,
  redactExternalMemoryConfigForUi,
  normalizeTtsConfig,
  redactTtsConfigForUi,
  normalizePagerConfig,
  redactPagerConfigForUi,
  scrubExternalMemoryText,
  normalizeAlertEvent,
  normalizeLockedModelEfforts,
  resolveAlignedModelEffort,
  normalizeSuggestion,
  COMPACT_THRESHOLD_MIN_PCT,
  COMPACT_THRESHOLD_MAX_PCT,
  shortAgentBriefName,
  stripCheckpointNoise,
  isInternalCheckpointNoise,
  extractJsonObject,
  beginChiefActiveWork,
  updateChiefActiveWork,
  endChiefActiveWork,
  getChiefActiveWork,
  OFFICIAL_HARNESS_CATALOG,
  stripModelControlMarkup,
  normalizeUiSkinPref,
  normalizeServerCustomSkin,
} from './state-schema.js'
import {
  archiveTargetForRoot,
  resolveSessionWorkspaceCwd,
  persistChiefImagesToWorkspace,
  admitChiefImages,
} from './state-media.js'
import { registerPagerConfigGetter } from './remote-pager.js'

export {
  markTaskResumingActive,
  unmarkTaskResumingActive,
  FACTS_CAP,
  FACT_TEXT_MAX,
  CHAT_CAP,
  MAIL_CAP,
  SUGGESTIONS_CAP,
  MODEL_TIMEOUT_MS,
  CATALOG_TTL_MS,
  REVIEW_DELAY_MS,
  AUTO_SUMMARY_COOLDOWN_MS,
  SMART_REVIEW_COOLDOWN_MS,
  AUTO_REVIEW_COOLDOWN_MS,
  SUMMARY_MAX_TOKENS,
  SUMMARY_RETRY_MAX_TOKENS,
  CHIEF_UPDATE_SOURCE,
  CHIEF_RELAY_SOURCE,
  CHIEF_INQUIRY_SOURCE,
  CHIEF_EXEC_REQ_SOURCE,
  CHAT_OPPORTUNISTIC_SUMMARY_COOLDOWN_MS,
  CHIEF_RUN_MODES,
  DEFAULT_MANAGED_IDLE_TIMEOUT_MS,
  CHIEF_THINKING_EFFORTS,
  ALERT_EVENTS_CAP,
  LLM_LEDGER_RECENT_CAP,
  DEFAULT_MANAGED_BUDGET_MAX_CALLS,
  DEFAULT_MANAGED_BUDGET_MAX_TOKENS,
  CHIEF_UI_LANGS,
  CHIEF_SCENARIO_PRESETS,
  normalizeUiLang,
  normalizeManagedBudgetCalls,
  normalizeManagedBudgetTokens,
  classifyChiefLlmCategory,
  emptyLlmLedger,
  normalizeLlmLedger,
  summarizeLlmLedger,
  normalizeAlertEvent,
  pushAlertEventToWs,
  normalizeRunMode,
  normalizeThinkingEffort,
  normalizeLockedModelEfforts,
  resolveAlignedModelEffort,
  nextId,
  clamp,
  cleanMultiline,
  secretLike,
  containsChiefNameSecret,
  normalizeChiefName,
  computeApprovalPayloadHash,
  hasValidChiefRiskAck,
  recoverTaskLedgerEntriesOnDiskLoad,
  normalizeFact,
  normalizeSuggestion,
  normalizeInquiryItem,
  normalizeMail,
  COMPACT_THRESHOLD_MIN_PCT,
  COMPACT_THRESHOLD_MAX_PCT,
  COMPACT_PCT_WARN_FLOOR,
  COMPACT_TOKEN_HARD_MIN,
  COMPACT_TOKEN_WARN_FLOOR,
  formatCompactTokenShort,
  parseCompactTokensInput,
  resolveWorkspaceConfig,
  isChiefSessionEnabled,
  emptyWorkspace,
  normalizeTacticalModes,
  shortAgentBriefName,
  stripCheckpointNoise,
  isInternalCheckpointNoise,
  extractJsonObject,
  beginChiefActiveWork,
  updateChiefActiveWork,
  endChiefActiveWork,
  getChiefActiveWork,
  OFFICIAL_HARNESS_CATALOG,
  normalizeBubbleHarness,
  stripModelControlMarkup,
}
export {
  resolveSessionWorkspaceCwd,
  archiveTargetForRoot,
  persistChiefImagesToWorkspace,
  admitChiefImages,
}

/** Render lightweight Chief-only identity instruction (0-byte isolated from @lead). */
export function buildChiefIdentityPromptLine(cfgOrState) {
  const src = cfgOrState && typeof cfgOrState === 'object'
    ? (cfgOrState.config && typeof cfgOrState.config === 'object' ? cfgOrState.config : cfgOrState)
    : loadChiefState().config
  const name = normalizeChiefName(src && src.chiefName)
  if (!name) return ''
  return `🏷️ 【你的专属称呼】：用户为你取的专属名字是「${name}」。在回复用户时自然以「${name}」自称即可（此设定对主对话 0 字节隔离）。`
}

export function touchWorkspaceActivity(sessionId) {
  const sid = String(sessionId || '').trim()
  if (!sid || sid === 'global') return false
  try {
    if (!isChiefSessionEnabled(loadChiefState(), sid)) return false
    mutateChiefState((state) => {
      const ws = ensureWorkspace(state, sid)
      if (!ws.runtimeGuard || typeof ws.runtimeGuard !== 'object') ws.runtimeGuard = {}
      ws.runtimeGuard.lastActivityAt = Date.now()
    })
    return true
  } catch {
    return false
  }
}

export function activateChiefSession(sessionId, { force = false } = {}) {
  const sid = String(sessionId || '').trim()
  if (!sid || sid === 'global') return false
  try {
    const st0 = loadChiefState()
    const explicit = st0 && st0.workspaces && st0.workspaces[sid] && st0.workspaces[sid].config
      ? st0.workspaces[sid].config.sessionEnabled
      : undefined
    if (explicit === true) return true
    if (!force && explicit === false) return false
    mutateChiefState((state) => {
      const effBefore = resolveWorkspaceConfig(state, sid)
      const ws = ensureWorkspace(state, sid)
      if (!ws.config || typeof ws.config !== 'object') {
        ws.config = {
          modelRef: effBefore.modelRef || '',
          paceMode: effBefore.paceMode || 'manual',
          runMode: effBefore.runMode || 'off',
          thinkingEffort: effBefore.thinkingEffort || 'auto',
          teamEffortMode: effBefore.teamEffortMode || 'auto',
          managedIdleTimeoutMs: effBefore.managedIdleTimeoutMs || DEFAULT_MANAGED_IDLE_TIMEOUT_MS,
          notifyEnabled: effBefore.notifyEnabled !== false,
          notifySound: Boolean(effBefore.notifySound),
          uiLang: effBefore.uiLang || 'auto',
          managedBudgetMaxCalls: effBefore.managedBudgetMaxCalls ?? DEFAULT_MANAGED_BUDGET_MAX_CALLS,
          managedBudgetMaxTokens: effBefore.managedBudgetMaxTokens ?? DEFAULT_MANAGED_BUDGET_MAX_TOKENS,
          lockedModelEfforts: { ...(effBefore.lockedModelEfforts || {}) },
          permissionMode: effBefore.permissionMode || DEFAULT_CHIEF_PERMISSION_MODE,
          tacticalModes: { ...effBefore.tacticalModes },
          sessionEnabled: true,
        }
      } else {
        ws.config.sessionEnabled = true
      }
    })
    return true
  } catch {
    return false
  }
}


export function collectChiefVisibleArchives(deps, rootId, stateSnapshot = null) {
  const sid = rootId && rootId !== 'global' ? String(rootId).trim() : ''
  const sessionTarget = sid ? archiveTargetForRoot(deps, sid, { vaultScope: 'session' }) : null
  const globalTarget = archiveTargetForRoot(deps, sid || 'global', { vaultScope: 'global' })
  const baseOpt = sessionTarget || globalTarget
  const projectKey = resolveProjectKey(baseOpt.cwd)

  let deskSessionItems = []
  let deskGlobalItems = []
  let deskFlippedItems = []
  let mountedGlobalItems = []
  let sessionItems = []
  let recentlyUnpinnedWatch = []
  let globalHookIndex = []
  let sealedWatch = { sessionSealed: [], globalSealed: [], precipSealed: [] }

  try {
    if (sessionTarget) {
      const stSess = loadArchiveStore(sessionTarget)
      const allSess = Array.isArray(stSess.items) ? stSess.items : []
      deskSessionItems = allSess.filter(it => Array.isArray(it.takenOutSessions) && it.takenOutSessions.includes(sid)).slice(0, 6)
      sessionItems = allSess.slice(0, 16).map(it => ({
        id: it.id,
        title: it.title,
        folder: it.folder,
        summary: it.summary,
        paperclip: it.paperclip,
        hasHook: Boolean(it.hasHook),
        hookKeywords: Array.isArray(it.hookKeywords) ? it.hookKeywords : [],
        hookCue: it.hookCue || '',
        takenOut: Array.isArray(it.takenOutSessions) && it.takenOutSessions.includes(sid),
        points: Array.isArray(it.points) ? it.points.slice(0, 3) : [],
      }))
      recentlyUnpinnedWatch = Array.isArray(stSess.recentlyUnpinnedWatch) ? stSess.recentlyUnpinnedWatch.slice() : []
    }
  } catch {}
  try {
    const gStore = loadGlobalVaultRaw(globalTarget)
    const gAll = Array.isArray(gStore && gStore.items) ? gStore.items : []
    if (sid) {
      deskGlobalItems = getTakenOutGlobalForSession(sid, globalTarget).slice(0, 6)
      mountedGlobalItems = getChiefMountedGlobalForSession(sid, globalTarget).slice(0, 6)
      // Also include entries Chief pulled in this session
      const pulledSet = new Set(mountedGlobalItems.map(x => x.id))
      for (const g of gAll) {
        if (g && Array.isArray(g.chiefPulledSessions) && g.chiefPulledSessions.includes(sid) && !pulledSet.has(g.id)) {
          mountedGlobalItems.push(g)
          pulledSet.add(g.id)
          if (mountedGlobalItems.length >= 6) break
        }
      }
    }
    globalHookIndex = gAll
      .filter(it =>
        it
        && it.hasHook === true
        && (!sid || (!Array.isArray(it.takenOutSessions) || !it.takenOutSessions.includes(sid)))
        && (!sid || (!Array.isArray(it.chiefMountedSessions) || !it.chiefMountedSessions.includes(sid)))
        && (!sid || (!Array.isArray(it.chiefPulledSessions) || !it.chiefPulledSessions.includes(sid)))
      )
      .slice(0, 12)
      .map(it => ({
        id: it.id,
        title: it.title,
        folder: it.folder,
        paperclip: it.paperclip,
        hookKeywords: Array.isArray(it.hookKeywords) ? it.hookKeywords : [],
        hookCue: it.hookCue || '',
      }))
  } catch {}
  try {
    if (sid) {
      const st = stateSnapshot || loadChiefState()
      const ws = st && st.workspaces && st.workspaces[sid]
      const flippedIds = ws && Array.isArray(ws.flippedPrecipitatedIds) ? ws.flippedPrecipitatedIds : []
      if (flippedIds.length > 0) {
        deskFlippedItems = getFlippedOutPrecipitatedForSession(projectKey, sid, true, baseOpt).slice(0, 6)
      }
    }
  } catch {}
  try {
    sealedWatch = collectSealedWatchSummary(sid, projectKey, baseOpt, { limitPerVault: 8 })
  } catch {}

  return {
    deskSessionItems,
    deskGlobalItems,
    deskFlippedItems,
    mountedGlobalItems,
    sessionItems,
    recentlyUnpinnedWatch,
    globalHookIndex,
    sealedWatch,
    sessionTarget,
    globalTarget,
  }
}

/** Persist raw uploaded images onto local workspace `.dsh-chief/uploads/` so any agent can inspect raw files even when LLM vision is unavailable. */

function chiefDir() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'chief')
}

registerPagerConfigGetter(() => {
  try {
    return loadChiefState().config.remotePager
  } catch {
    return null
  }
})

function stateFilePath() {
  return path.join(chiefDir(), 'chief-state.json')
}

export function auditJsonlPath() {
  return safetyAuditJsonlPath()
}

export function pushAuditToWs(ws, entry = {}, sessionId = '') {
  if (!ws || typeof ws !== 'object') return null
  if (!Array.isArray(ws.auditLog)) ws.auditLog = []
  const norm = normalizeAuditEntry(entry)
  if (!norm) return null
  ws.auditLog.push(norm)
  if (ws.auditLog.length > AUDIT_LOG_CAP) ws.auditLog = ws.auditLog.slice(-AUDIT_LOG_CAP)
  appendAuditJsonlRecord(norm, sessionId)
  return norm
}

export function appendChiefAuditLog(sessionId = 'global', entry = {}) {
  const rootId = String(sessionId || 'global').trim() || 'global'
  return mutateChiefState((state) => {
    const ws = ensureWorkspace(state, rootId)
    return pushAuditToWs(ws, entry, rootId)
  })
}

export function enqueueApprovalToWs(ws, item = {}) {
  if (!ws || typeof ws !== 'object') return null
  if (!Array.isArray(ws.pendingApprovals)) ws.pendingApprovals = []
  const dKey = clamp(item.dedupeKey || '', 120)
  if (dKey) {
    const existing = ws.pendingApprovals.find(a => a && a.status === 'pending' && a.dedupeKey === dKey)
    if (existing) return existing
  }
  const kind = item.kind || 'tool'
  const payload = item.payload && typeof item.payload === 'object' ? item.payload : {}
  const now = Date.now()
  const norm = normalizePendingApproval({
    ...item,
    status: 'pending',
    dedupeKey: dKey,
    payloadHash: computeApprovalPayloadHash(kind, payload),
    expiresAt: Number(item.expiresAt) || (now + DEFAULT_RESUME_TTL_MS),
  })
  if (!norm) return null
  ws.pendingApprovals.push(norm)
  if (ws.pendingApprovals.length > APPROVALS_CAP) {
    ws.pendingApprovals = ws.pendingApprovals.slice(-APPROVALS_CAP)
  }
  pushAlertEventToWs(ws, {
    kind: 'pending_approval',
    level: 'warn',
    title: '🔐 等待人类逐项审批',
    body: clamp(`${norm.operationLabel}${norm.targetLabel ? ' · ' + norm.targetLabel : ''}`, 180),
    dedupeKey: 'apr:' + norm.id,
    at: now,
  })
  return norm
}

export function queueChiefApproval(sessionId = 'global', item = {}) {
  const rootId = String(sessionId || 'global').trim() || 'global'
  return mutateChiefState((state) => {
    const ws = ensureWorkspace(state, rootId)
    return enqueueApprovalToWs(ws, item)
  })
}

export function enqueueElevationToWs(ws, req = {}) {
  if (!ws || typeof ws !== 'object') return null
  const currentMode = normalizePermissionMode(
    ws.config && ws.config.permissionMode ? ws.config.permissionMode : DEFAULT_CHIEF_PERMISSION_MODE,
    { requireAck: true, hasChiefRiskAck: hasValidChiefRiskAck(ws) },
  )
  const targetMode = normalizePermissionMode(req.targetMode || 'strategist')
  if (permissionRank(targetMode) <= permissionRank(currentMode)) return null
  const now = Date.now()
  const norm = normalizePendingElevation({
    fromMode: currentMode,
    targetMode,
    reason: req.reason || 'Agent 申请提升权限以继续当前任务',
    requestedActionSummary: req.requestedActionSummary || '',
    resumeTaskId: req.resumeTaskId || '',
    expiresAt: Number(req.expiresAt) || (now + DEFAULT_RESUME_TTL_MS),
    by: req.by || 'chief',
  })
  if (!norm) return null
  ws.pendingElevation = norm
  pushAuditToWs(ws, {
    mode: currentMode,
    stage: 'permission_gate',
    decision: 'elevation_requested',
    operation: '申请提权',
    target: `${CHIEF_PERMISSION_META[currentMode].level} -> ${CHIEF_PERMISSION_META[targetMode].level}`,
    reason: norm.reason,
    outcome: 'pending',
    by: norm.by,
  }, req.sessionId || '')
  pushAlertEventToWs(ws, {
    kind: 'pending_elevation',
    level: 'warn',
    title: '⬆️ 参谋申请提权',
    body: clamp(`${CHIEF_PERMISSION_META[currentMode].level} -> ${CHIEF_PERMISSION_META[targetMode].level}：${norm.reason}`, 180),
    dedupeKey: 'elv:' + norm.id,
    at: now,
  })
  return norm
}

export function requestChiefElevation(sessionId = 'global', req = {}) {
  const rootId = String(sessionId || 'global').trim() || 'global'
  return mutateChiefState((state) => {
    const ws = ensureWorkspace(state, rootId)
    return enqueueElevationToWs(ws, { ...(req && typeof req === 'object' ? req : {}), sessionId: rootId })
  })
}

export function upsertTaskLedgerOnWs(ws, rawTask = {}) {
  if (!ws || typeof ws !== 'object') return null
  if (!Array.isArray(ws.taskLedger)) {
    ws.taskLedger = Array.isArray(ws.resumeTasks) ? ws.resumeTasks : []
  }
  ws.resumeTasks = ws.taskLedger
  const lookupId = rawTask.taskId || rawTask.id
  const existingIdx = lookupId ? ws.taskLedger.findIndex(t => t && (t.taskId === lookupId || t.id === lookupId)) : -1
  if (existingIdx >= 0) {
    const prev = ws.taskLedger[existingIdx]
    const merged = normalizeTaskLedgerEntry({
      ...prev,
      ...rawTask,
      updatedAt: Date.now(),
      completedActions: rawTask.appendCompletedAction
        ? [...(prev.completedActions || []), rawTask.appendCompletedAction]
        : (rawTask.completedActions || prev.completedActions),
      pendingApprovalIds: rawTask.pendingApprovalIds || prev.pendingApprovalIds,
    })
    if (merged) ws.taskLedger[existingIdx] = merged
    return merged
  }
  const created = normalizeTaskLedgerEntry(rawTask)
  if (!created) return null
  ws.taskLedger.push(created)
  if (ws.taskLedger.length > TASK_LEDGER_CAP) {
    ws.taskLedger = ws.taskLedger.slice(-TASK_LEDGER_CAP)
    ws.resumeTasks = ws.taskLedger
  }
  return created
}

export function upsertResumeTaskOnWs(ws, rawTask = {}) {
  return upsertTaskLedgerOnWs(ws, rawTask)
}

export function enqueueChiefInquiryOnWs(ws, raw = {}) {
  if (!ws || typeof ws !== 'object') return null
  if (!Array.isArray(ws.inquiries)) ws.inquiries = []
  const norm = normalizeInquiryItem(raw)
  if (!norm) return null
  const dup = ws.inquiries.find(
    q => q && (q.status === 'pending' || q.status === 'delivered') && q.question === norm.question && q.target === norm.target,
  )
  if (dup) return dup
  ws.inquiries.push(norm)
  if (ws.inquiries.length > 24) ws.inquiries = ws.inquiries.slice(-24)
  return norm
}

export function answerChiefInquiry(sessionId = 'global', { inquiryId = '', answer = '', by = 'lead' } = {}) {
  const rootId = String(sessionId || 'global').trim() || 'global'
  const cleanAns = cleanMultiline(answer || '', 1200)
  if (!cleanAns) return { ok: false, error: 'inquiry.reply 需要非空答复文本 (text)' }
  return mutateChiefState((state) => {
    const ws = ensureWorkspace(state, rootId)
    if (!Array.isArray(ws.inquiries)) ws.inquiries = []
    let idx = inquiryId
      ? ws.inquiries.findIndex(q => q && (q.inquiryId === inquiryId || q.id === inquiryId))
      : -1
    if (idx < 0 && !inquiryId) {
      for (let i = ws.inquiries.length - 1; i >= 0; i -= 1) {
        if (ws.inquiries[i] && (ws.inquiries[i].status === 'pending' || ws.inquiries[i].status === 'delivered')) {
          idx = i
          break
        }
      }
    }
    if (idx < 0) return { ok: false, error: `未找到待回复问询：${inquiryId || '最近未答问询'}` }
    const existing = ws.inquiries[idx]
    if (!existing || existing.status === 'answered' || (existing.status !== 'pending' && existing.status !== 'delivered')) {
      const prevId = (existing && existing.inquiryId) || inquiryId
      const prevStatus = (existing && existing.status) || 'unknown'
      pushAuditToWs(ws, {
        mode: resolveWorkspaceConfig(state, rootId).permissionMode,
        stage: 'inquiry_channel',
        rule: 'inquiry_reply_replay_rejected',
        decision: 'rejected',
        operation: '拦截重复问询答复',
        target: prevId,
        reason: `问询 #${prevId} 已结案 (status=${prevStatus})，拒绝重放覆写`,
        outcome: 'rejected',
        by: clamp(by || 'lead', 40),
      }, rootId)
      return {
        ok: false,
        alreadyAnswered: true,
        code: 'inquiry_already_answered',
        error: `问询 #${prevId} 已回复结案，拒绝重复应答`,
        inquiry: existing,
      }
    }
    const now = Date.now()
    const item = {
      ...existing,
      status: 'answered',
      answer: cleanAns,
      answeredBy: clamp(by || 'lead', 40),
      answeredAt: now,
    }
    ws.inquiries[idx] = item
    if (item.taskId) {
      upsertTaskLedgerOnWs(ws, {
        taskId: item.taskId,
        kind: 'inquiry',
        status: 'completed',
        inquiryId: item.inquiryId,
        lastReceipt: `已收到 ${item.answeredBy} 原路答复：${clamp(cleanAns, 120)}`,
        resolvedAt: now,
      })
    }
    ws.chat.push({
      id: nextId('chat'),
      role: 'chief',
      kind: 'receipt',
      text: `- 【⚡ 优先问询回执 #${item.inquiryId}】已收到 \`${item.answeredBy}\` 不中断原路回复：\n- 【问】${item.question}\n- 【答】${cleanAns}`,
      actions: [`问询已回执 #${item.inquiryId}`],
      at: now,
    })
    if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
    pushAuditToWs(ws, {
      mode: resolveWorkspaceConfig(state, rootId).permissionMode,
      stage: 'inquiry_channel',
      rule: 'inquiry_reply',
      decision: 'answered',
      operation: '优先问询原路回复',
      target: item.inquiryId,
      reason: clamp(cleanAns, 140),
      outcome: 'ok',
      by: item.answeredBy,
    }, rootId)
    return { ok: true, inquiry: item }
  })
}

const STATE_LOCK_WAIT_MS = 10000

const STATE_LOCK_STALE_MS = 15000

const STATE_LOCK_CONTENDED_CODES = new Set(['EEXIST', 'EPERM', 'EACCES', 'EBUSY'])

const heldStateLocks = new Set()

const stateLockSleeper = new Int32Array(new SharedArrayBuffer(4))

function sleepStateLockSync(ms) {
  try {
    Atomics.wait(stateLockSleeper, 0, 0, ms)
  } catch {}
}

/** Cross-process O_EXCL lock around `chief-state.json` read-modify-write cycles (fixes red-team E1). */
function acquireStateLock(file = stateFilePath()) {
  if (heldStateLocks.has(file)) return () => {}
  const lock = file + '.lock'
  try {
    fs.mkdirSync(path.dirname(lock), { recursive: true })
  } catch {}
  const deadline = Date.now() + STATE_LOCK_WAIT_MS
  for (;;) {
    try {
      const fd = fs.openSync(lock, 'wx')
      try {
        fs.writeSync(fd, `${process.pid}:${threadId}`)
      } catch {}
      fs.closeSync(fd)
      heldStateLocks.add(file)
      return () => {
        heldStateLocks.delete(file)
        try {
          fs.unlinkSync(lock)
        } catch {}
      }
    } catch (error) {
      const code = error && error.code
      if (code === 'ENOENT' && Date.now() < deadline) {
        try {
          fs.mkdirSync(path.dirname(lock), { recursive: true })
        } catch {}
        sleepStateLockSync(2)
        continue
      }
      if (!error || !STATE_LOCK_CONTENDED_CODES.has(code)) {
        heldStateLocks.add(file)
        return () => heldStateLocks.delete(file)
      }
      if (Date.now() >= deadline) {
        try {
          fs.unlinkSync(lock)
        } catch {}
        heldStateLocks.add(file)
        return () => heldStateLocks.delete(file)
      }
      if (code === 'EEXIST') {
        try {
          const stat = fs.statSync(lock)
          if (Date.now() - stat.mtimeMs > STATE_LOCK_STALE_MS) {
            fs.unlinkSync(lock)
            continue
          }
        } catch {}
      }
      sleepStateLockSync(2 + Math.floor(Math.random() * 4))
    }
  }
}

export function withChiefStateLock(fn) {
  const file = stateFilePath()
  const release = acquireStateLock(file)
  try {
    return fn()
  } finally {
    release()
  }
}

let cachedState = null

let cachedMtime = 0

function applyColdLoadLedgerRecovery(state) {
  if (!state || !state.workspaces || typeof state.workspaces !== 'object') return false
  let changed = false
  const now = Date.now()
  for (const ws of Object.values(state.workspaces)) {
    if (!ws || !Array.isArray(ws.taskLedger) || ws.taskLedger.length === 0) continue
    const beforeStatuses = ws.taskLedger.map(t => t && t.status)
    const recovered = recoverTaskLedgerEntriesOnDiskLoad(ws.taskLedger, now)
    ws.taskLedger = recovered
    ws.resumeTasks = recovered
    for (let i = 0; i < recovered.length; i += 1) {
      if (recovered[i] && recovered[i].status !== beforeStatuses[i]) {
        changed = true
      }
    }
  }
  return changed
}

export function loadChiefState({ forceDisk = false } = {}) {
  const file = stateFilePath()
  try {
    const stat = fs.statSync(file)
    if (!forceDisk && cachedState && stat.mtimeMs === cachedMtime) return cachedState
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    const nextState = normalizeState(parsed)
    applyColdLoadLedgerRecovery(nextState)
    cachedState = nextState
    cachedMtime = stat.mtimeMs
    return cachedState
  } catch {
    if (forceDisk) {
      cachedState = normalizeState({})
      cachedMtime = -1
      return cachedState
    }
    if (!cachedState) cachedState = normalizeState({})
    return cachedState
  }
}

export function reconcileChiefStateOnBoot() {
  return mutateChiefState((state) => applyColdLoadLedgerRecovery(state))
}

export function saveChiefState(state) {
  const normalized = normalizeState(state)
  const file = stateFilePath()
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.${threadId}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 6)}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(normalized, null, 2), 'utf8')
    let renameErr = null
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        fs.renameSync(tmp, file)
        renameErr = null
        break
      } catch (err) {
        renameErr = err
        const code = err && err.code
        if (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY') break
        sleepStateLockSync(2 + attempt * 2)
      }
    }
    if (renameErr) {
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp) } catch {}
      throw renameErr
    }
    try {
      cachedMtime = fs.statSync(file).mtimeMs
    } catch {
      cachedMtime = -1
    }
  } catch {}
  cachedState = normalized
  return normalized
}

export function mutateChiefState(mutator) {
  return withChiefStateLock(() => {
    const state = loadChiefState({ forceDisk: true })
    const result = mutator(state)
    saveChiefState(state)
    return result
  })
}

/** Find connected component of linked root sessions (undirected graph). */
export function getLinkedCluster(state, rootSessionId) {
  const seed = String(rootSessionId || '').trim()
  if (!seed) return ['global']
  const visited = new Set([seed])
  const queue = [seed]
  const links = (state && state.links) || {}
  while (queue.length > 0) {
    const cur = queue.shift()
    const direct = Array.isArray(links[cur]) ? links[cur] : []
    for (const peer of direct) {
      if (peer && !visited.has(peer)) {
        visited.add(peer)
        queue.push(peer)
      }
    }
    for (const [other, list] of Object.entries(links)) {
      if (Array.isArray(list) && list.includes(cur) && !visited.has(other)) {
        visited.add(other)
        queue.push(other)
      }
    }
  }
  return [...visited].sort()
}

export function computeClusterSig(cluster = []) {
  return [...new Set((Array.isArray(cluster) ? cluster : []).map(x => String(x || '').trim()).filter(Boolean))].sort().join('|')
}

export function setPeerLink(rootA, rootB, linked) {
  const a = String(rootA || '').trim()
  const b = String(rootB || '').trim()
  if (!a || !b || a === b) return { ok: false, error: '需要两个不同的主会话才能建立协同连接' }
  return mutateChiefState((state) => {
    const affected = new Set([
      ...getLinkedCluster(state, a),
      ...getLinkedCluster(state, b),
    ])
    const setA = new Set(state.links[a] || [])
    const setB = new Set(state.links[b] || [])
    if (linked) {
      setA.add(b)
      setB.add(a)
    } else {
      setA.delete(b)
      setB.delete(a)
    }
    if (setA.size) state.links[a] = [...setA]
    else delete state.links[a]
    if (setB.size) state.links[b] = [...setB]
    else delete state.links[b]

    // Topology isolation guard: purge stale narrative caches on EVERY affected session whose cluster changed
    // so detaching from a peer cluster NEVER leaves residual peer context inside Chief's narrative digest!
    const now = Date.now()
    for (const sid of affected) {
      const ws = ensureWorkspace(state, sid)
      const nextCluster = getLinkedCluster(state, sid)
      const nextSig = computeClusterSig(nextCluster)
      if (!ws.narrative || ws.narrative.clusterSig !== nextSig) {
        ws.narrative = { hash: '', text: '', at: 0, byModel: '', clusterSig: nextSig }
      }
      if (!linked) {
        ws.seenFactsAt = { [sid]: now }
      } else {
        ws.seenFactsAt = {}
      }
    }
    return { ok: true, cluster: getLinkedCluster(state, a) }
  })
}

export function ensureWorkspace(state, rootId) {
  const key = String(rootId || 'global').trim() || 'global'
  if (!state.workspaces[key]) state.workspaces[key] = emptyWorkspace()
  return state.workspaces[key]
}

function filterFactsForCluster(rawFacts, clusterSet, rootId) {
  return (Array.isArray(rawFacts) ? rawFacts : []).filter((f) => {
    if (!f || !f.text) return false
    if (f.originRootId && !clusterSet.has(f.originRootId)) return false
    if (f.category === 'team' && Array.isArray(f.peerRootIds) && f.peerRootIds.length > 0) {
      // A team fact created during multi-session collaboration stays ONLY if another participant besides rootId remains linked
      const participants = f.originRootId ? [f.originRootId, ...f.peerRootIds] : f.peerRootIds
      const peerStillLinked = participants.some(pid => pid && pid !== rootId && clusterSet.has(pid))
      if (!peerStillLinked) return false
    }
    return true
  })
}

function annotateMailClusterState(mail, clusterSet) {
  if (!mail || typeof mail !== 'object') return mail
  const isHarnessRoot = id => typeof id === 'string' && id.startsWith('harness:')
  const fromOut = Boolean(mail.fromRootId && !isHarnessRoot(mail.fromRootId) && !clusterSet.has(mail.fromRootId))
  const toOut = Boolean(mail.toRootId && mail.toRootId !== 'all' && !isHarnessRoot(mail.toRootId) && !clusterSet.has(mail.toRootId))
  const detachedFromCluster = fromOut || toOut
  return detachedFromCluster ? { ...mail, detachedFromCluster: true } : mail
}

/** Merge facts & mailbox across all linked peer sessions in the federation cluster, isolating detached artifacts. */
export function clusterView(state, rootId) {
  const cluster = getLinkedCluster(state, rootId)
  const clusterSig = computeClusterSig(cluster)
  const clusterSet = new Set(cluster)
  const primary = ensureWorkspace(state, rootId)
  if (cluster.length <= 1) {
    return {
      cluster,
      clusterSig,
      primary,
      facts: filterFactsForCluster(primary.facts, clusterSet, rootId),
      mailbox: (primary.mailbox || []).map(m => annotateMailClusterState(m, clusterSet)),
      suggestions: primary.suggestions.filter(s => s.status === 'pending'),
      chat: primary.chat,
      narrative: primary.narrative,
    }
  }
  const factMap = new Map()
  const mailMap = new Map()
  for (const sid of cluster) {
    const ws = ensureWorkspace(state, sid)
    for (const f of filterFactsForCluster(ws.facts, clusterSet, rootId)) factMap.set(f.id, f)
    for (const m of ws.mailbox) {
      if (m && m.broadcastId && m.channelType === 'broadcast') {
        mailMap.set('bcast:' + m.broadcastId, annotateMailClusterState(m, clusterSet))
      } else {
        mailMap.set(m.id, annotateMailClusterState(m, clusterSet))
      }
    }
  }
  const facts = [...factMap.values()].sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0)).slice(-FACTS_CAP)
  const mailbox = [...mailMap.values()].sort((a, b) => (a.at || 0) - (b.at || 0)).slice(-MAIL_CAP)
  return {
    cluster,
    clusterSig,
    primary,
    facts,
    mailbox,
    suggestions: primary.suggestions.filter(s => s.status === 'pending'),
    chat: primary.chat,
    narrative: primary.narrative,
  }
}

/* -------------------------------------------------------------------------- */
/* Model Catalog & Auxiliary LLM Caller                                       */
/* -------------------------------------------------------------------------- */

/** Manage which cold precipitated-vault entries are explicitly unsealed/flipped into a single root session. */
export function updateWorkspaceFlippedIds(sessionId, { flippedId = '', sealId = '', clearAll = false } = {}) {
  const key = String(sessionId || 'global').trim() || 'global'
  return mutateChiefState((state) => {
    const ws = ensureWorkspace(state, key)
    const set = new Set(ws.flippedPrecipitatedIds || [])
    if (clearAll) {
      set.clear()
    } else {
      if (flippedId) set.add(String(flippedId).trim())
      if (sealId) set.delete(String(sealId).trim())
    }
    ws.flippedPrecipitatedIds = [...set].slice(-20)
    return { ok: true, flippedPrecipitatedIds: ws.flippedPrecipitatedIds.slice() }
  })
}

/** One-click system deployment of Chief state (`facts`, `narrative`, `chat`/`mailbox` bridge) to a target Chief workspace (strictly keeping `flippedPrecipitatedIds = []`). */
export function deployChiefWorkspaceState(deps, {
  fromRootId = '',
  toRootId = '',
  fromTitle = '',
  customText = '',
  objective = '',
} = {}) {
  const fromKey = String(fromRootId || 'global').trim() || 'global'
  const toKey = String(toRootId || '').trim()
  if (!toKey) return { ok: false, error: '目标会话 ID 不能为空' }

  return mutateChiefState((state) => {
    const fromWs = ensureWorkspace(state, fromKey)
    const toWs = ensureWorkspace(state, toKey)

    const existingTexts = new Set(toWs.facts.map(f => f.text.trim()))
    let copiedFacts = 0
    for (const f of fromWs.facts) {
      if (!f || !f.text) continue
      const norm = f.text.trim()
      if (existingTexts.has(norm)) continue
      existingTexts.add(norm)
      toWs.facts.push({
        ...f,
        id: nextId('fact'),
        originRootId: toKey === 'global' ? (f.originRootId || '') : toKey,
        peerRootIds: [],
        source: f.source || `移交自 ${fromTitle || fromKey}`,
        updatedAt: Date.now(),
      })
      copiedFacts += 1
    }
    if (toWs.facts.length > FACTS_CAP) {
      const pinned = toWs.facts.filter(f => f.pinned)
      const rest = toWs.facts.filter(f => !f.pinned).slice(-(FACTS_CAP - pinned.length))
      toWs.facts = [...pinned, ...rest].slice(-FACTS_CAP)
    }

    if (fromWs.narrative && fromWs.narrative.text && !toWs.narrative.text) {
      toWs.narrative = {
        ...fromWs.narrative,
        hash: fromWs.narrative.hash || '',
        clusterSig: toKey,
        at: Date.now(),
      }
    }

    const briefLines = [
      `- 【跨会话接力部署】本会话参谋状态已自 **${fromTitle || fromKey}** 系统级一键移交部署完成（新对话默认以 **L0 · 顾问模式** 安全启动）。`,
      objective ? `- 【继承总目标】${clamp(objective, 180)}` : '',
      copiedFacts > 0 ? `- 【继承纪律与事实】共继承 **${copiedFacts} 条**核心记忆与纪律。` : '',
      customText ? `- 【附带交接叮嘱】${clamp(customText, 240)}` : '',
    ].filter(Boolean).join('\n')

    const mailItem = normalizeMail({
      id: nextId('mail'),
      from: 'DSH 参谋长 (接力部署)',
      fromSession: fromKey,
      to: 'lead',
      toSession: toKey,
      subject: `跨会话参谋部署：自 ${fromTitle || fromKey}`,
      text: briefLines,
      mode: 'silent',
      deliveredPhysical: false,
      at: Date.now(),
    })
    if (mailItem) {
      toWs.mailbox.push(mailItem)
      if (toWs.mailbox.length > MAIL_CAP) toWs.mailbox = toWs.mailbox.slice(-MAIL_CAP)
    }

    toWs.chat.push({
      id: nextId('chat'),
      role: 'chief',
      text: briefLines,
      actions: ['系统接力部署', '默认 L0 顾问', ...(copiedFacts > 0 ? [`继承记忆 ×${copiedFacts}`] : [])],
      at: Date.now(),
    })
    if (toWs.chat.length > CHAT_CAP) toWs.chat = toWs.chat.slice(-CHAT_CAP)

    // Clone safe workspace chief config (model, effort, tactical preferences), ALWAYS forcing intervention=false, runMode='off' & L0 advisor!
    const fromCfg = resolveWorkspaceConfig(state, fromKey)
    toWs.config = {
      modelRef: fromCfg.modelRef || '',
      paceMode: 'manual',
      runMode: 'off',
      thinkingEffort: fromCfg.thinkingEffort || 'auto',
      teamEffortMode: fromCfg.teamEffortMode || 'auto',
      managedIdleTimeoutMs: fromCfg.managedIdleTimeoutMs || DEFAULT_MANAGED_IDLE_TIMEOUT_MS,
      permissionMode: DEFAULT_CHIEF_PERMISSION_MODE,
      autoPilot: false,
      autoReview: false,
      tacticalModes: {
        ...normalizeTacticalModes(fromCfg.tacticalModes),
        intervention: false,
      },
    }
    toWs.chiefRiskAck = null
    toWs.pendingApprovals = []
    toWs.pendingElevation = null
    pushAuditToWs(toWs, {
      mode: DEFAULT_CHIEF_PERMISSION_MODE,
      stage: 'deploy',
      decision: 'reset_to_l0',
      operation: '跨会话接力部署',
      target: toKey,
      reason: '新对话强制从最低档 L0 顾问模式安全启动并清空高权限状态',
      outcome: 'ok',
      by: 'deploy',
    })
    toWs.runtimeGuard.interventionTurns = 0
    toWs.runtimeGuard.unchangedCount = 0
    toWs.runtimeGuard.circuitBroken = false
    toWs.runtimeGuard.circuitReason = ''

    // Strictly keep precipitated cold vault isolated at 0-token default in destination session!
    toWs.flippedPrecipitatedIds = []

    return {
      ok: true,
      copiedFacts,
      narrativeCopied: Boolean(fromWs.narrative && fromWs.narrative.text),
      flippedPrecipitatedIds: [],
      config: { ...toWs.config, tacticalModes: { ...toWs.config.tacticalModes } },
    }
  })
}

/* -------------------------------------------------------------------------- */
/* Chief Command Bar: All-Seeing Strategist + Relay + Bounds + Board Ops  */
/* -------------------------------------------------------------------------- */

export function updateChiefConfig(patch) {
  const rawInput = patch && typeof patch === 'object' ? patch : {}
  const rawPreset = typeof rawInput.preset === 'string' ? rawInput.preset.trim().toLowerCase() : ''
  const presetSpec = CHIEF_SCENARIO_PRESETS[rawPreset] || null
  const safePatch = presetSpec
    ? {
        ...presetSpec,
        ...rawInput,
        tacticalModes: {
          ...(presetSpec.tacticalModes || {}),
          ...(rawInput.tacticalModes && typeof rawInput.tacticalModes === 'object' ? rawInput.tacticalModes : {}),
        },
      }
    : rawInput
  const sid = String(safePatch.sessionId || safePatch.session || '').trim() || 'global'
  if (typeof safePatch.chiefName === 'string' && containsChiefNameSecret(safePatch.chiefName)) {
    return {
      ok: false,
      blocked: true,
      error: '参谋长名称检测到疑似密钥/令牌，已硬拦截拒绝写入',
    }
  }
  const GLOBAL_ONLY_CFG_KEYS = new Set(['defaultAutoEnableSessions', 'uiLang', 'uiSkin', 'customSkin', 'notifyEnabled', 'notifySound', 'chiefName', 'externalMemory', 'tts', 'remotePager'])
  const META_CFG_KEYS = new Set([
    'sessionId',
    'session',
    'by',
    'byUser',
    '_fromUiPanel',
    'confirmedDisableSafetyGuard',
    'safetyGuardScope',
  ])
  const payloadKeys = Object.keys(safePatch).filter(k => !META_CFG_KEYS.has(k) && safePatch[k] !== undefined)
  const callerBy = typeof safePatch.by === 'string' ? safePatch.by.trim() : ''
  const isHumanBy = !callerBy || /^(?:user|human|operator|ui_panel)$/i.test(callerBy)
  const isHumanLockCaller = safePatch._fromUiPanel === true
    || (safePatch.byUser === true && isHumanBy)

  const incomingTacticalRaw = safePatch.tacticalModes && typeof safePatch.tacticalModes === 'object'
    ? safePatch.tacticalModes
    : null
  const hasTacticalSafetyField = Boolean(incomingTacticalRaw && typeof incomingTacticalRaw.safetyGuardEnabled === 'boolean')
  const wantsGlobalSafetyToggle = typeof safePatch.globalSafetyGuardEnabled === 'boolean'
    || Boolean(hasTacticalSafetyField && (sid === 'global' || safePatch.safetyGuardScope === 'global'))
  const targetGlobalSafetyVal = typeof safePatch.globalSafetyGuardEnabled === 'boolean'
    ? safePatch.globalSafetyGuardEnabled
    : (wantsGlobalSafetyToggle && hasTacticalSafetyField ? Boolean(incomingTacticalRaw.safetyGuardEnabled) : undefined)
  const wantsSessionSafetyToggle = Boolean(hasTacticalSafetyField && sid !== 'global' && safePatch.safetyGuardScope !== 'global')
  const targetSessionSafetyVal = wantsSessionSafetyToggle
    ? Boolean(incomingTacticalRaw.safetyGuardEnabled)
    : undefined

  const isGlobalSafetyOnly = payloadKeys.length > 0 && payloadKeys.every(k =>
    k === 'globalSafetyGuardEnabled'
    || (k === 'tacticalModes' && wantsGlobalSafetyToggle && !wantsSessionSafetyToggle && Object.keys(incomingTacticalRaw || {}).length === 1),
  )
  const isGlobalPrefOnly = payloadKeys.length > 0 && payloadKeys.every(k => GLOBAL_ONLY_CFG_KEYS.has(k))
  const isDefaultAutoOnly = payloadKeys.length === 1 && payloadKeys[0] === 'defaultAutoEnableSessions'
  return mutateChiefState((state) => {
    const existingWs = state.workspaces && state.workspaces[sid] ? state.workspaces[sid] : null
    const effBeforeCheck = resolveWorkspaceConfig(state, sid)
    const prevGlobalSafety = !(state.config && state.config.tacticalModes && state.config.tacticalModes.safetyGuardEnabled === false)
    const prevSessionSafety = !(existingWs && existingWs.config && existingWs.config.tacticalModes && existingWs.config.tacticalModes.safetyGuardEnabled === false)
    const isActualGlobalChange = wantsGlobalSafetyToggle && (Boolean(targetGlobalSafetyVal) !== prevGlobalSafety)
    const isActualSessionChange = wantsSessionSafetyToggle && (Boolean(targetSessionSafetyVal) !== prevSessionSafety)
    const actuallyDisablingGlobal = wantsGlobalSafetyToggle && targetGlobalSafetyVal === false && prevGlobalSafety === true
    const actuallyDisablingSession = wantsSessionSafetyToggle && targetSessionSafetyVal === false && prevSessionSafety === true
    if (wantsGlobalSafetyToggle || wantsSessionSafetyToggle) {
      if (!isHumanLockCaller) {
        const blockEntry = {
          mode: effBeforeCheck.permissionMode,
          stage: 'safety_guard_toggle',
          rule: 'safety_guard_human_only',
          decision: 'blocked',
          operation: wantsGlobalSafetyToggle ? '修改全局安全拦截开关' : '修改会话安全拦截开关',
          target: wantsGlobalSafetyToggle ? 'global' : sid,
          reason: `未授权来源 (${callerBy || 'unknown'}) 试图修改安全拦截开关，仅允许人类通过控制或设置面板显式操作`,
          outcome: 'rejected',
          by: clamp(callerBy || 'unknown', 40),
        }
        if (existingWs) pushAuditToWs(existingWs, blockEntry, sid)
        else {
          const normBlock = normalizeAuditEntry(blockEntry)
          if (normBlock) appendAuditJsonlRecord(normBlock, sid)
        }
        return {
          ok: false,
          blocked: true,
          code: 'safety_guard_human_only',
          error: '安全拦截开关仅允许人类通过面板显式操作，已拦截非人类来源修改',
        }
      }
      if ((actuallyDisablingGlobal || actuallyDisablingSession) && safePatch.confirmedDisableSafetyGuard !== true) {
        return {
          ok: false,
          requireSafetyGuardConfirm: true,
          scope: actuallyDisablingGlobal ? 'global' : 'session',
          error: '关闭安全拦截需先在确认弹窗中勾选确认（confirmedDisableSafetyGuard: true）',
        }
      }
    }
    if (isGlobalSafetyOnly) {
      const nextGlobalVal = Boolean(targetGlobalSafetyVal)
      state.config.tacticalModes = {
        ...normalizeTacticalModes(state.config.tacticalModes),
        safetyGuardEnabled: nextGlobalVal,
      }
      if (isActualGlobalChange) {
        const toggleEntry = {
          mode: effBeforeCheck.permissionMode,
          stage: 'safety_guard_toggle',
          rule: 'safety_guard_toggled',
          decision: nextGlobalVal ? 'executed' : 'disabled',
          operation: '切换全局安全拦截总开关',
          target: 'global',
          reason: nextGlobalVal ? '人类显式开启全局安全拦截总开关' : '人类确认风险后关闭全局安全拦截总开关',
          outcome: 'ok',
          by: clamp(callerBy || 'operator', 40),
        }
        if (existingWs) pushAuditToWs(existingWs, toggleEntry, sid)
        else {
          const normToggle = normalizeAuditEntry(toggleEntry)
          if (normToggle) appendAuditJsonlRecord(normToggle, sid)
        }
      }
      const nextCfg = resolveWorkspaceConfig(state, sid)
      return {
        ok: true,
        config: { ...nextCfg, tacticalModes: { ...nextCfg.tacticalModes } },
        llmLedger: summarizeLlmLedger(existingWs && existingWs.llmLedger, nextCfg),
      }
    }
    if (isDefaultAutoOnly || (isGlobalPrefOnly && !(existingWs && existingWs.config))) {
      if (typeof safePatch.defaultAutoEnableSessions === 'boolean') {
        state.config.defaultAutoEnableSessions = safePatch.defaultAutoEnableSessions
      }
      if (typeof safePatch.uiLang === 'string') {
        state.config.uiLang = normalizeUiLang(safePatch.uiLang)
      }
      if (typeof safePatch.uiSkin === 'string') {
        state.config.uiSkin = normalizeUiSkinPref(safePatch.uiSkin)
      }
      if (safePatch.customSkin !== undefined) {
        state.config.customSkin = normalizeServerCustomSkin(safePatch.customSkin)
      }
      if (typeof safePatch.notifyEnabled === 'boolean') {
        state.config.notifyEnabled = safePatch.notifyEnabled
      }
      if (typeof safePatch.notifySound === 'boolean') {
        state.config.notifySound = safePatch.notifySound
      }
      if (typeof safePatch.chiefName === 'string') {
        state.config.chiefName = normalizeChiefName(safePatch.chiefName)
      }
      if (safePatch.externalMemory && typeof safePatch.externalMemory === 'object') {
        state.config.externalMemory = normalizeExternalMemoryConfig(safePatch.externalMemory, state.config.externalMemory)
      }
      if (safePatch.tts && typeof safePatch.tts === 'object') {
        state.config.tts = normalizeTtsConfig(safePatch.tts, state.config.tts)
      }
      if (safePatch.remotePager && typeof safePatch.remotePager === 'object') {
        state.config.remotePager = normalizePagerConfig(safePatch.remotePager, state.config.remotePager)
      }
      const nextCfg = resolveWorkspaceConfig(state, sid)
      const redactedExt = redactExternalMemoryConfigForUi(nextCfg.externalMemory)
      const redactedTts = redactTtsConfigForUi(nextCfg.tts)
      const redactedPager = redactPagerConfigForUi(nextCfg.remotePager)
      return {
        ok: true,
        config: {
          ...nextCfg,
          externalMemory: redactedExt,
          tts: redactedTts,
          remotePager: redactedPager,
          tacticalModes: { ...nextCfg.tacticalModes },
        },
        llmLedger: summarizeLlmLedger(existingWs && existingWs.llmLedger, nextCfg),
      }
    }
    const ws = ensureWorkspace(state, sid)
    const effBefore = resolveWorkspaceConfig(state, sid)
    const prevTactical = normalizeTacticalModes(effBefore.tacticalModes)
    if (typeof safePatch.ackHazardAlertId === 'string' && safePatch.ackHazardAlertId.trim()) {
      const ackId = safePatch.ackHazardAlertId.trim()
      if (ws && ws.runtimeGuard && ws.runtimeGuard.hazardAlert && (ackId === '*' || ws.runtimeGuard.hazardAlert.id === ackId)) {
        ws.runtimeGuard.hazardAlert = null
      }
      const hasOtherKeys = Object.keys(safePatch).some(
        k => k !== 'sessionId' && k !== 'session' && k !== 'ackHazardAlertId',
      )
      if (!hasOtherKeys) {
        const curCfg = resolveWorkspaceConfig(state, sid)
        return {
          ok: true,
          clearedHazardAlert: true,
          config: { ...curCfg, tacticalModes: { ...curCfg.tacticalModes } },
          runtimeGuard: ws ? { ...ws.runtimeGuard } : null,
        }
      }
    }

    if (safePatch.emergencyStopIntervention === true) {
      if (ws) {
        if (!ws.config || typeof ws.config !== 'object') ws.config = { ...effBefore }
        ws.config.tacticalModes = { ...normalizeTacticalModes(ws.config.tacticalModes), intervention: false }
        ws.config.runMode = 'off'
        ws.config.autoPilot = false
        ws.config.paceMode = 'manual'
        ws.config.stopped = true
        ws.runtimeGuard.interventionTurns = 0
        ws.runtimeGuard.unchangedCount = 0
        ws.runtimeGuard.circuitBroken = false
        ws.runtimeGuard.circuitReason = ''
        ws.runtimeGuard.hazardAlert = null
      }
      state.config.tacticalModes = { ...normalizeTacticalModes(state.config.tacticalModes), intervention: false }
      state.config.runMode = 'off'
      state.config.autoPilot = false
      state.config.paceMode = 'manual'
      const stoppedCfg = resolveWorkspaceConfig(state, sid)
      return {
        ok: true,
        emergencyStopped: true,
        config: { ...stoppedCfg, tacticalModes: { ...stoppedCfg.tacticalModes } },
        runtimeGuard: ws ? { ...ws.runtimeGuard } : null,
      }
    }

    // Hard gate on model thinking effort lock mutations (human UI / explicit byUser only)
    const wantsLockMutation = safePatch.lockedModelEfforts !== undefined
      || safePatch.toggleLockAgentEffort !== undefined
      || safePatch.teamEffortMode !== undefined
    if (wantsLockMutation && !isHumanLockCaller) {
      pushAuditToWs(ws, {
        mode: effBefore.permissionMode,
        stage: 'model_effort_lock',
        rule: 'effort_lock_human_only',
        decision: 'blocked',
        operation: '修改模型思考强度锁挡',
        target: sid,
        reason: `未授权来源 (${callerBy || 'unknown'}) 试图修改 lockedModelEfforts，仅允许人类面板显式操作`,
        outcome: 'rejected',
        by: clamp(callerBy || 'unknown', 40),
      }, sid)
      return {
        ok: false,
        blocked: true,
        lockedByUser: true,
        code: 'effort_lock_human_only',
        error: '思考强度锁挡 (lockedModelEfforts) 仅允许人类通过面板或显式 byUser 授权修改，已拦截越权变更',
      }
    }
    if (
      typeof safePatch.thinkingEffort === 'string'
      && effBefore.lockedModelEfforts
      && effBefore.lockedModelEfforts.chief === true
      && !isHumanLockCaller
    ) {
      pushAuditToWs(ws, {
        mode: effBefore.permissionMode,
        stage: 'model_effort_lock',
        rule: 'effort_lock_human_only',
        decision: 'blocked',
        operation: '修改参谋长思考强度',
        target: sid,
        reason: `参谋长思考强度已被用户锁定 (lockedModelEfforts.chief)，拒绝非人类来源 (${callerBy || 'unknown'}) 修改`,
        outcome: 'rejected',
        by: clamp(callerBy || 'unknown', 40),
      }, sid)
      return {
        ok: false,
        blocked: true,
        lockedByUser: true,
        code: 'effort_lock_human_only',
        error: '参谋长思考强度已被用户锁定 (lockedModelEfforts.chief)，仅允许人类显式修改',
      }
    }

    // Check explicit Policy Plugin list (restrict-only) BEFORE applying any changes
    let validatedPlugins = null
    if (safePatch.policyPlugins !== undefined) {
      const plugCheck = validatePolicyPluginList(safePatch.policyPlugins)
      if (!plugCheck.ok) {
        pushAuditToWs(ws, {
          mode: effBefore.permissionMode,
          stage: 'policy_plugin',
          rule: plugCheck.code || 'policy_plugin_rejected',
          decision: 'rejected',
          operation: '配置只紧不松策略插件',
          target: sid,
          reason: plugCheck.error,
          outcome: 'rejected',
          by: clamp(safePatch.by || 'operator', 40),
        }, sid)
        return {
          ok: false,
          code: plugCheck.code || 'POLICY_PLUGIN_WEAKENING_FORBIDDEN',
          error: plugCheck.error,
        }
      }
      validatedPlugins = plugCheck.plugins
    }

    // Check explicit permission mode transition BEFORE applying any changes
    let normalizedReqPerm = ''
    if (typeof safePatch.permissionMode === 'string' && safePatch.permissionMode.trim()) {
      normalizedReqPerm = normalizePermissionMode(safePatch.permissionMode)
      if (normalizedReqPerm === 'chief' && safePatch.confirmedChiefRisk !== true && !hasValidChiefRiskAck(ws)) {
        pushAuditToWs(ws, {
          mode: effBefore.permissionMode,
          stage: 'permission_gate',
          decision: 'deny_unacknowledged_l3',
          operation: '切换 L3 参谋长模式',
          target: sid,
          reason: '未阅读并勾选确认高权限风险告知（confirmedChiefRisk: true）',
          outcome: 'denied',
          by: 'operator',
        })
        return {
          ok: false,
          requireChiefRiskConfirm: true,
          error: '启用「L3 · 参谋长模式」前必须阅读高权限风险告知并主动勾选确认（confirmedChiefRisk: true）',
        }
      }
    }

    let incomingTactical = incomingTacticalRaw ? { ...incomingTacticalRaw } : null
    if (incomingTactical && incomingTactical.intervention === true && !prevTactical.intervention) {
      if (safePatch.confirmedInterventionRisk !== true) {
        return {
          ok: false,
          error: '开启「接管督导模式」需先确认双项风险免责声明（confirmedInterventionRisk: true）',
        }
      }
      if (ws) {
        ws.runtimeGuard.interventionTurns = 0
        ws.runtimeGuard.unchangedCount = 0
        ws.runtimeGuard.circuitBroken = false
        ws.runtimeGuard.circuitReason = ''
        ws.runtimeGuard.hazardAlert = null
        ws.runtimeGuard.lastGoalAchievedSig = ''
      }
    }

    const wantsUnlimitedTurns = Boolean(
      incomingTactical
      && (incomingTactical.maxInterventionTurns === 0 || incomingTactical.maxInterventionTurns === '0')
    )
    if (wantsUnlimitedTurns && prevTactical.maxInterventionTurns !== 0 && safePatch.confirmedUnlimitedTurns !== true) {
      return {
        ok: false,
        error: '切换至「♾️ 无限督导轮次」需先通过作者风险确认弹窗（confirmedUnlimitedTurns: true）',
      }
    }

    const wantsAutoPilot = Boolean(
      safePatch.runMode === 'managed'
      || safePatch.paceMode === 'auto'
      || (typeof safePatch.paceMode !== 'string' && typeof safePatch.runMode !== 'string' && safePatch.stopped !== true && safePatch.autoPilot === true)
    )
    if (wantsAutoPilot && effBefore.runMode !== 'managed' && effBefore.paceMode !== 'auto' && safePatch.confirmedAutoPilot !== true) {
      return {
        ok: false,
        requireAutoPilotConfirm: true,
        error: '开启「🤖 托管模式」需先确认本会话自治范围与 5 条件自动休眠保护（confirmedAutoPilot: true）',
      }
    }
    if (ws && wantsAutoPilot && (effBefore.runMode !== 'managed' || effBefore.paceMode !== 'auto')) {
      const now = Date.now()
      ws.runtimeGuard.autoPilotStartedAt = now
      ws.runtimeGuard.managedStartedAt = now
      ws.runtimeGuard.lastActivityAt = now
      ws.runtimeGuard.autoPilotHadTurn = false
      ws.llmLedger = normalizeLlmLedger(ws.llmLedger)
      ws.llmLedger.managedRun = {
        startedAt: now,
        calls: 0,
        tokens: 0,
        tripped: false,
        trippedAt: 0,
        trippedReason: '',
      }
    }
    if (ws && !wantsAutoPilot && safePatch.runMode === 'patrol' && ws.llmLedger && ws.llmLedger.managedRun && ws.llmLedger.managedRun.tripped) {
      ws.llmLedger.managedRun.tripped = false
      ws.llmLedger.managedRun.trippedAt = 0
      ws.llmLedger.managedRun.trippedReason = ''
    }
    if (ws && safePatch.resetManagedBudget === true) {
      ws.llmLedger = normalizeLlmLedger(ws.llmLedger)
      ws.llmLedger.managedRun = {
        startedAt: Date.now(),
        calls: 0,
        tokens: 0,
        tripped: false,
        trippedAt: 0,
        trippedReason: '',
      }
    }
    if (ws && safePatch.resetLlmLedger === true) {
      ws.llmLedger = emptyLlmLedger()
    }

    let compactLowWarning = ''
    if (incomingTactical && typeof incomingTactical.compactThresholdInput === 'string') {
      const parsedTok = parseCompactTokensInput(incomingTactical.compactThresholdInput)
      if (!parsedTok.ok) {
        return { ok: false, error: parsedTok.error }
      }
      incomingTactical.compactThresholdTokens = parsedTok.tokens
      incomingTactical.compactThresholdInput = parsedTok.displayInput
      compactLowWarning = parsedTok.lowWarning || ''
    } else if (incomingTactical && typeof incomingTactical.compactThresholdTokens === 'number') {
      const safeTok = Math.max(COMPACT_TOKEN_HARD_MIN, Math.round(incomingTactical.compactThresholdTokens))
      incomingTactical.compactThresholdTokens = safeTok
      incomingTactical.compactThresholdInput = formatCompactTokenShort(safeTok)
      if (safeTok < COMPACT_TOKEN_WARN_FLOOR) {
        compactLowWarning = `当前阈值（${incomingTactical.compactThresholdInput}）低于安全建议线 32K，可能导致上下文频繁压缩丢失现场细节`
      }
    }

    const applyPatchTo = (targetCfg, allowIntervention, allowAutoPilot = allowIntervention, allowPermSync = false, allowLocks = false, allowSafetyGuardToggle = false) => {
      if (typeof safePatch.modelRef === 'string') targetCfg.modelRef = safePatch.modelRef.trim()
      if (typeof safePatch.thinkingEffort === 'string') {
        targetCfg.thinkingEffort = normalizeThinkingEffort(safePatch.thinkingEffort)
      }
      if (allowLocks && typeof safePatch.teamEffortMode === 'string') {
        targetCfg.teamEffortMode = normalizeTeamEffortMode(safePatch.teamEffortMode)
      }
      if (Number.isFinite(Number(safePatch.managedIdleTimeoutMs)) && Number(safePatch.managedIdleTimeoutMs) >= 50) {
        targetCfg.managedIdleTimeoutMs = Math.min(2 * 60 * 60 * 1000, Math.round(Number(safePatch.managedIdleTimeoutMs)))
      }
      if (typeof safePatch.notifyEnabled === 'boolean') targetCfg.notifyEnabled = safePatch.notifyEnabled
      if (typeof safePatch.notifySound === 'boolean') targetCfg.notifySound = safePatch.notifySound
      if (typeof safePatch.uiLang === 'string') targetCfg.uiLang = normalizeUiLang(safePatch.uiLang)
      if (safePatch.managedBudgetMaxCalls !== undefined) {
        targetCfg.managedBudgetMaxCalls = normalizeManagedBudgetCalls(safePatch.managedBudgetMaxCalls)
      }
      if (safePatch.managedBudgetMaxTokens !== undefined) {
        targetCfg.managedBudgetMaxTokens = normalizeManagedBudgetTokens(safePatch.managedBudgetMaxTokens)
      }
      if (allowLocks && (
        (safePatch.lockedModelEfforts && typeof safePatch.lockedModelEfforts === 'object')
        || (safePatch.toggleLockAgentEffort && typeof safePatch.toggleLockAgentEffort === 'object')
      )) {
        const curLocks = { ...(targetCfg.lockedModelEfforts || {}) }
        if (safePatch.lockedModelEfforts && typeof safePatch.lockedModelEfforts === 'object') {
          for (const [lk, lv] of Object.entries(safePatch.lockedModelEfforts)) {
            const ck = String(lk || '').trim().slice(0, 64)
            if (!ck) continue
            if (lv === true) curLocks[ck] = true
            else delete curLocks[ck]
          }
        }
        if (safePatch.toggleLockAgentEffort && typeof safePatch.toggleLockAgentEffort === 'object') {
          const lk = String(safePatch.toggleLockAgentEffort.target || 'lead').trim().slice(0, 64)
          if (lk) {
            if (safePatch.toggleLockAgentEffort.locked === true) curLocks[lk] = true
            else delete curLocks[lk]
          }
        }
        targetCfg.lockedModelEfforts = curLocks
      }
      if (allowPermSync && normalizedReqPerm) {
        targetCfg.permissionMode = normalizedReqPerm
      }
      if (typeof safePatch.runMode === 'string' && CHIEF_RUN_MODES.includes(safePatch.runMode)) {
        const nextRun = (!allowAutoPilot && safePatch.runMode === 'managed') ? 'off' : safePatch.runMode
        targetCfg.runMode = nextRun
        targetCfg.stopped = false
        targetCfg.paceMode = nextRun === 'managed' ? 'auto' : (nextRun === 'patrol' ? 'smart' : 'manual')
        targetCfg.autoPilot = nextRun === 'managed' && allowAutoPilot
        targetCfg.autoReview = nextRun === 'managed' && allowAutoPilot
      } else if (typeof safePatch.paceMode === 'string' && ['manual', 'smart', 'auto', 'stopped'].includes(safePatch.paceMode)) {
        const nextPace = (!allowAutoPilot && safePatch.paceMode === 'auto') ? 'manual' : safePatch.paceMode
        targetCfg.paceMode = nextPace
        const isStopped = nextPace === 'stopped'
        targetCfg.stopped = isStopped
        targetCfg.runMode = isStopped ? 'off' : (nextPace === 'auto' ? 'managed' : (nextPace === 'smart' ? 'patrol' : 'off'))
        targetCfg.autoPilot = !isStopped && nextPace === 'auto' && allowAutoPilot
        targetCfg.autoReview = !isStopped && nextPace === 'auto' && allowAutoPilot
      } else if (typeof safePatch.stopped === 'boolean') {
        targetCfg.stopped = safePatch.stopped
        if (safePatch.stopped) {
          targetCfg.paceMode = 'stopped'
          targetCfg.runMode = 'off'
          targetCfg.autoPilot = false
          targetCfg.autoReview = false
        } else {
          if (targetCfg.paceMode === 'stopped') targetCfg.paceMode = 'manual'
          if (!allowAutoPilot && targetCfg.paceMode === 'auto') targetCfg.paceMode = 'manual'
          targetCfg.runMode = normalizeRunMode(targetCfg.runMode, targetCfg)
          targetCfg.autoPilot = targetCfg.paceMode === 'auto' && allowAutoPilot
          targetCfg.autoReview = targetCfg.paceMode === 'auto' && allowAutoPilot
        }
      } else if (typeof safePatch.autoPilot === 'boolean') {
        const nextAuto = Boolean(safePatch.autoPilot && allowAutoPilot)
        targetCfg.stopped = false
        targetCfg.paceMode = nextAuto ? 'auto' : 'manual'
        targetCfg.runMode = nextAuto ? 'managed' : 'off'
        targetCfg.autoPilot = nextAuto
        targetCfg.autoReview = nextAuto
      }
      if (!allowAutoPilot && (targetCfg.paceMode === 'auto' || targetCfg.runMode === 'managed')) {
        targetCfg.paceMode = 'manual'
        targetCfg.runMode = 'off'
        targetCfg.autoPilot = false
        targetCfg.autoReview = false
      }
      if (typeof safePatch.autoReview === 'boolean' && typeof safePatch.paceMode !== 'string' && typeof safePatch.runMode !== 'string' && typeof safePatch.stopped !== 'boolean') {
        targetCfg.autoReview = safePatch.autoReview
        if (!safePatch.autoReview) {
          targetCfg.stopped = false
          targetCfg.paceMode = 'manual'
          targetCfg.runMode = 'off'
        }
      }
      if (incomingTactical) {
        const prevTargetTactical = normalizeTacticalModes(targetCfg.tacticalModes)
        const merged = normalizeTacticalModes({
          ...prevTargetTactical,
          ...incomingTactical,
        })
        if (!allowIntervention) merged.intervention = false
        if (!allowSafetyGuardToggle) {
          merged.safetyGuardEnabled = prevTargetTactical.safetyGuardEnabled !== false
        }
        targetCfg.tacticalModes = merged
      } else if (!allowIntervention && targetCfg.tacticalModes) {
        targetCfg.tacticalModes = { ...normalizeTacticalModes(targetCfg.tacticalModes), intervention: false }
      }
    }

    if (!ws.config || typeof ws.config !== 'object') {
      ws.config = {
        modelRef: effBefore.modelRef || '',
        paceMode: effBefore.paceMode || 'manual',
        runMode: effBefore.runMode || 'off',
        thinkingEffort: effBefore.thinkingEffort || 'auto',
        teamEffortMode: effBefore.teamEffortMode || 'auto',
        managedIdleTimeoutMs: effBefore.managedIdleTimeoutMs || DEFAULT_MANAGED_IDLE_TIMEOUT_MS,
        notifyEnabled: effBefore.notifyEnabled !== false,
        notifySound: Boolean(effBefore.notifySound),
        uiLang: effBefore.uiLang || 'auto',
        managedBudgetMaxCalls: effBefore.managedBudgetMaxCalls ?? DEFAULT_MANAGED_BUDGET_MAX_CALLS,
        managedBudgetMaxTokens: effBefore.managedBudgetMaxTokens ?? DEFAULT_MANAGED_BUDGET_MAX_TOKENS,
        lockedModelEfforts: { ...(effBefore.lockedModelEfforts || {}) },
        permissionMode: effBefore.permissionMode || DEFAULT_CHIEF_PERMISSION_MODE,
        tacticalModes: { ...effBefore.tacticalModes },
      }
    }
    applyPatchTo(ws.config, true, true, true, isHumanLockCaller, wantsSessionSafetyToggle)
    if (wantsGlobalSafetyToggle) {
      state.config.tacticalModes = {
        ...normalizeTacticalModes(state.config.tacticalModes),
        safetyGuardEnabled: Boolean(targetGlobalSafetyVal),
      }
      if (isActualGlobalChange) {
        pushAuditToWs(ws, {
          mode: resolveWorkspaceConfig(state, sid).permissionMode,
          stage: 'safety_guard_toggle',
          rule: 'safety_guard_toggled',
          decision: targetGlobalSafetyVal ? 'executed' : 'disabled',
          operation: '切换全局安全拦截总开关',
          target: 'global',
          reason: targetGlobalSafetyVal ? '人类显式开启全局安全拦截总开关' : '人类确认风险后关闭全局安全拦截总开关',
          outcome: 'ok',
          by: clamp(callerBy || 'operator', 40),
        }, sid)
      }
    }
    if (wantsSessionSafetyToggle && isActualSessionChange) {
      pushAuditToWs(ws, {
        mode: resolveWorkspaceConfig(state, sid).permissionMode,
        stage: 'safety_guard_toggle',
        rule: 'safety_guard_toggled',
        decision: targetSessionSafetyVal ? 'executed' : 'disabled',
        operation: '切换会话安全拦截开关',
        target: sid,
        reason: targetSessionSafetyVal ? '人类显式开启本会话安全拦截' : '人类确认风险后关闭本会话安全拦截',
        outcome: 'ok',
        by: clamp(callerBy || 'operator', 40),
      }, sid)
    }
    if (typeof safePatch.defaultAutoEnableSessions === 'boolean') {
      state.config.defaultAutoEnableSessions = safePatch.defaultAutoEnableSessions
    }
    if (typeof safePatch.chiefName === 'string') {
      state.config.chiefName = normalizeChiefName(safePatch.chiefName)
    }
    if (typeof safePatch.uiSkin === 'string') {
      state.config.uiSkin = normalizeUiSkinPref(safePatch.uiSkin)
    }
    if (safePatch.customSkin !== undefined) {
      state.config.customSkin = normalizeServerCustomSkin(safePatch.customSkin)
    }
    if (safePatch.externalMemory && typeof safePatch.externalMemory === 'object') {
      state.config.externalMemory = normalizeExternalMemoryConfig(safePatch.externalMemory, state.config.externalMemory)
    }
    if (safePatch.tts && typeof safePatch.tts === 'object') {
      state.config.tts = normalizeTtsConfig(safePatch.tts, state.config.tts)
    }
    if (safePatch.remotePager && typeof safePatch.remotePager === 'object') {
      state.config.remotePager = normalizePagerConfig(safePatch.remotePager, state.config.remotePager)
    }
    if (typeof safePatch.sessionEnabled === 'boolean') {
      ws.config.sessionEnabled = safePatch.sessionEnabled
      if (!safePatch.sessionEnabled) {
        ws.config.runMode = 'off'
        ws.config.paceMode = 'manual'
        ws.config.stopped = false
        ws.config.autoPilot = false
        ws.config.autoReview = false
        ws.config.tacticalModes = { ...normalizeTacticalModes(ws.config.tacticalModes), intervention: false }
      }
    } else if (!isGlobalPrefOnly && sid !== 'global') {
      ws.config.sessionEnabled = true
    }
    if (validatedPlugins !== null) {
      if (safePatch.policyPluginsScope === 'global') {
        state.config.policyPlugins = validatedPlugins
      } else {
        ws.config.policyPlugins = validatedPlugins
      }
      pushAuditToWs(ws, {
        mode: resolveWorkspaceConfig(state, sid).permissionMode,
        stage: 'policy_plugin',
        rule: 'policy_plugin_updated',
        decision: 'executed',
        operation: '更新安全策略插件',
        target: `${safePatch.policyPluginsScope === 'global' ? 'global' : sid} (${validatedPlugins.length} 个)`,
        reason: `已加载 ${validatedPlugins.length} 个只紧不松安全策略插件`,
        outcome: 'ok',
        by: clamp(safePatch.by || 'operator', 40),
      }, sid)
    }
    // Session permissionMode, intervention, lockedModelEfforts, and autoPilot NEVER leak globally across new sessions!
    state.config.permissionMode = DEFAULT_CHIEF_PERMISSION_MODE
    applyPatchTo(state.config, false, false, false, false)

    if (normalizedReqPerm) {
      if (normalizedReqPerm === 'chief' && safePatch.confirmedChiefRisk === true) {
        ws.chiefRiskAck = {
          acknowledged: true,
          at: Date.now(),
          by: clamp(safePatch.by || 'operator', 40),
          version: '1.2.1',
        }
      } else if (normalizedReqPerm !== 'chief') {
        ws.chiefRiskAck = null
      }
      if (normalizedReqPerm !== effBefore.permissionMode) {
        if (ws.pendingElevation && permissionRank(normalizedReqPerm) >= permissionRank(ws.pendingElevation.targetMode)) {
          ws.pendingElevation = null
        }
        pushAuditToWs(ws, {
          mode: normalizedReqPerm,
          stage: 'permission_gate',
          decision: 'mode_changed',
          operation: '切换权限等级',
          target: `${CHIEF_PERMISSION_META[effBefore.permissionMode].level} -> ${CHIEF_PERMISSION_META[normalizedReqPerm].level}`,
          reason: normalizedReqPerm === 'chief' ? '用户勾选风险声明并确认启用 L3 参谋长模式' : `用户主动切换至 ${CHIEF_PERMISSION_META[normalizedReqPerm].title}`,
          outcome: 'ok',
          by: clamp(safePatch.by || 'operator', 40),
        })
      }
    }

    const finalCfg = resolveWorkspaceConfig(state, sid)
    if (!compactLowWarning && finalCfg.tacticalModes.compactThresholdMode === 'tokens' && finalCfg.tacticalModes.compactThresholdTokens < COMPACT_TOKEN_WARN_FLOOR) {
      compactLowWarning = `当前阈值（${finalCfg.tacticalModes.compactThresholdInput}）低于安全建议线 32K，可能导致上下文频繁压缩丢失现场细节`
    } else if (!compactLowWarning && finalCfg.tacticalModes.compactThresholdMode !== 'tokens' && finalCfg.tacticalModes.compactThresholdPct < COMPACT_PCT_WARN_FLOOR) {
      compactLowWarning = `当前触发比例（${finalCfg.tacticalModes.compactThresholdPct}%）低于安全建议线 ${COMPACT_PCT_WARN_FLOOR}%，可能导致上下文频繁提前归档压缩`
    }
    return {
      ok: true,
      ...(presetSpec ? { appliedPreset: presetSpec.id } : {}),
      ...(compactLowWarning ? { compactLowWarning } : {}),
      config: {
        ...finalCfg,
        externalMemory: redactExternalMemoryConfigForUi(finalCfg.externalMemory),
        tts: redactTtsConfigForUi(finalCfg.tts),
        remotePager: redactPagerConfigForUi(finalCfg.remotePager),
        tacticalModes: { ...finalCfg.tacticalModes },
      },
      llmLedger: summarizeLlmLedger(ws.llmLedger, finalCfg),
    }
  })
}

export function mutateChiefFact(deps, { sessionId, op, id, text, category, pinned }) {
  const rootId = deps.resolveRootSessionId(sessionId) || String(sessionId || 'global')
  return mutateChiefState((state) => {
    const ws = ensureWorkspace(state, rootId)
    if (op === 'add') {
      const cat = category || 'discipline'
      const activeCluster = getLinkedCluster(state, rootId)
      const fact = normalizeFact({
        text,
        category: cat,
        by: 'user',
        pinned: Boolean(pinned),
        originRootId: rootId === 'global' ? '' : rootId,
        peerRootIds: cat === 'team' ? activeCluster.filter(pid => pid !== rootId) : [],
      })
      if (!fact) return { ok: false, error: '条目无效或包含敏感凭据' }
      ws.facts.push(fact)
      if (ws.facts.length > FACTS_CAP) ws.facts = ws.facts.slice(-FACTS_CAP)
      return { ok: true, fact }
    }
    const target = ws.facts.find(f => f.id === id)
    if (!target) return { ok: false, error: '未找到该记忆条目' }
    if (op === 'remove') {
      ws.facts = ws.facts.filter(f => f.id !== id)
      return { ok: true }
    }
    if (op === 'pin') {
      target.pinned = Boolean(pinned)
      target.updatedAt = Date.now()
      return { ok: true, fact: target }
    }
    if (op === 'edit') {
      const clean = clamp(text, FACT_TEXT_MAX)
      if (!clean || secretLike(clean)) return { ok: false, error: '内容无效或包含敏感凭据' }
      target.text = clean
      if (category) target.category = category
      target.updatedAt = Date.now()
      return { ok: true, fact: target }
    }
    return { ok: false, error: '未知操作: ' + op }
  })
}

export function recordWorkspaceAlertEvent(rootSessionId, spec = {}) {
  const key = String(rootSessionId || 'global').trim() || 'global'
  try {
    return mutateChiefState((state) => {
      const ws = ensureWorkspace(state, key)
      return pushAlertEventToWs(ws, spec)
    })
  } catch {
    return null
  }
}

function tripManagedBudgetCircuit(state, ws, rootId, reason) {
  const now = Date.now()
  const effNow = resolveWorkspaceConfig(state, rootId)
  if (!ws.config || typeof ws.config !== 'object') ws.config = { ...effNow }
  ws.config.runMode = 'off'
  ws.config.paceMode = 'manual'
  ws.config.autoPilot = false
  ws.config.autoReview = false
  ws.config.tacticalModes = { ...normalizeTacticalModes(ws.config.tacticalModes), intervention: false }
  if (state.config && (state.config.runMode === 'managed' || state.config.paceMode === 'auto')) {
    state.config.runMode = 'off'
    state.config.paceMode = 'manual'
    state.config.autoPilot = false
    state.config.autoReview = false
  }
  ws.llmLedger = normalizeLlmLedger(ws.llmLedger)
  ws.llmLedger.managedRun.tripped = true
  ws.llmLedger.managedRun.trippedAt = now
  ws.llmLedger.managedRun.trippedReason = clamp(reason || '已触及托管硬预算上限，自动熔断休眠', 200)
  ws.chat.push({
    id: nextId('chat'),
    role: 'chief',
    kind: 'receipt',
    text: `- 【🛑 托管硬预算熔断】${ws.llmLedger.managedRun.trippedReason}\n- 已自动将运行模式退回「⏸ 关停」（人工问答仍可随时使用），保护 Token 费用。`,
    actions: ['🛑 硬预算熔断'],
    at: now,
  })
  if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
  pushAuditToWs(ws, {
    mode: effNow.permissionMode,
    stage: 'budget_guard',
    rule: 'managed_budget_exceeded',
    decision: 'tripped',
    operation: '托管硬预算上限熔断',
    target: rootId,
    reason: ws.llmLedger.managedRun.trippedReason,
    outcome: 'blocked',
    by: 'chief',
  }, rootId)
  pushAlertEventToWs(ws, {
    kind: 'budget_circuit_break',
    level: 'danger',
    title: '🛑 托管已达预算上限并熔断',
    body: ws.llmLedger.managedRun.trippedReason,
    dedupeKey: `budget:${rootId}:${ws.llmLedger.managedRun.startedAt || 0}`,
    at: now,
  })
  return ws.llmLedger.managedRun.trippedReason
}

/** Check before background Managed LLM calls; never blocks human-initiated chat or consultation. */
export function checkManagedBudgetBeforeCall(rootSessionId, reasonKind = '') {
  const rootId = String(rootSessionId || 'global').trim() || 'global'
  const category = classifyChiefLlmCategory(reasonKind)
  if (category !== 'review' && category !== 'dream') {
    return { allowed: true, category }
  }
  const st = loadChiefState()
  const effCfg = resolveWorkspaceConfig(st, rootId)
  const wsSnap = st.workspaces && st.workspaces[rootId] ? st.workspaces[rootId] : null
  const ledger = normalizeLlmLedger(wsSnap && wsSnap.llmLedger)
  const mr = ledger.managedRun
  if (mr.tripped && !effCfg.stopped && effCfg.runMode !== 'patrol') {
    return {
      allowed: false,
      tripped: true,
      category,
      reason: mr.trippedReason || '本轮托管硬预算已触发熔断，请重置计数后再继续',
    }
  }
  if (effCfg.stopped || effCfg.runMode !== 'managed') {
    return { allowed: true, category }
  }
  const maxCalls = normalizeManagedBudgetCalls(effCfg.managedBudgetMaxCalls)
  const maxTokens = normalizeManagedBudgetTokens(effCfg.managedBudgetMaxTokens)
  let exceedReason = ''
  if (mr.tripped) {
    exceedReason = mr.trippedReason || '本轮托管硬预算已触发熔断，请重置计数后再继续'
  } else if (maxCalls > 0 && mr.calls >= maxCalls) {
    exceedReason = `托管后台 LLM 调用已达上限 ${mr.calls}/${maxCalls} 次`
  } else if (maxTokens > 0 && mr.tokens >= maxTokens) {
    exceedReason = `托管后台 Token 消耗已达上限 ${formatCompactTokenShort(mr.tokens)}/${formatCompactTokenShort(maxTokens)}`
  }
  if (!exceedReason) {
    return { allowed: true, category }
  }
  const trippedReason = mutateChiefState((state) => {
    const ws = ensureWorkspace(state, rootId)
    return tripManagedBudgetCircuit(state, ws, rootId, exceedReason)
  })
  return { allowed: false, tripped: true, category, reason: trippedReason }
}

/** Record every Chief LLM call usage and enforce Managed-mode hard budget cap immediately when reached. */
export function recordChiefLlmUsage(rootSessionId, {
  reasonKind = '',
  modelRef = '',
  inputTokens = 0,
  outputTokens = 0,
  estimated = false,
  ok = true,
} = {}) {
  const rootId = String(rootSessionId || 'global').trim() || 'global'
  const category = classifyChiefLlmCategory(reasonKind)
  const inTok = Math.min(LLM_LEDGER_TOKENS_MAX, Math.max(0, Math.round(Number(inputTokens) || 0)))
  const outTok = Math.min(LLM_LEDGER_TOKENS_MAX, Math.max(0, Math.round(Number(outputTokens) || 0)))
  const totTok = Math.min(LLM_LEDGER_TOKENS_MAX, inTok + outTok)
  const now = Date.now()
  return mutateChiefState((state) => {
    const ws = ensureWorkspace(state, rootId)
    const effCfg = resolveWorkspaceConfig(state, rootId)
    ws.llmLedger = normalizeLlmLedger(ws.llmLedger)
    const ledger = ws.llmLedger
    ledger.totalCalls = Math.min(LLM_LEDGER_CALLS_MAX, ledger.totalCalls + 1)
    ledger.totalInputTokens = Math.min(LLM_LEDGER_TOKENS_MAX, ledger.totalInputTokens + inTok)
    ledger.totalOutputTokens = Math.min(LLM_LEDGER_TOKENS_MAX, ledger.totalOutputTokens + outTok)
    ledger.totalTokens = Math.min(LLM_LEDGER_TOKENS_MAX, ledger.totalTokens + totTok)
    if (!ledger.byCategory[category]) ledger.byCategory[category] = { calls: 0, tokens: 0 }
    ledger.byCategory[category].calls = Math.min(LLM_LEDGER_CALLS_MAX, ledger.byCategory[category].calls + 1)
    ledger.byCategory[category].tokens = Math.min(LLM_LEDGER_TOKENS_MAX, ledger.byCategory[category].tokens + totTok)
    ledger.recent.push({
      id: nextId('llm'),
      at: now,
      category,
      reasonKind: clamp(reasonKind || '', 40),
      modelRef: clamp(modelRef || '', 80),
      inputTokens: inTok,
      outputTokens: outTok,
      totalTokens: totTok,
      estimated: Boolean(estimated),
      ok: ok !== false,
    })
    if (ledger.recent.length > LLM_LEDGER_RECENT_CAP) {
      ledger.recent = ledger.recent.slice(-LLM_LEDGER_RECENT_CAP)
    }

    let trippedReason = ''
    if (!effCfg.stopped && effCfg.runMode === 'managed' && (category === 'review' || category === 'dream')) {
      if (!ledger.managedRun.startedAt) ledger.managedRun.startedAt = now
      ledger.managedRun.calls = Math.min(LLM_LEDGER_CALLS_MAX, ledger.managedRun.calls + 1)
      ledger.managedRun.tokens = Math.min(LLM_LEDGER_TOKENS_MAX, ledger.managedRun.tokens + totTok)
      const maxCalls = normalizeManagedBudgetCalls(effCfg.managedBudgetMaxCalls)
      const maxTokens = normalizeManagedBudgetTokens(effCfg.managedBudgetMaxTokens)
      if (maxCalls > 0 && ledger.managedRun.calls >= maxCalls) {
        trippedReason = tripManagedBudgetCircuit(
          state,
          ws,
          rootId,
          `托管后台 LLM 调用已达硬预算上限 (${ledger.managedRun.calls}/${maxCalls} 次)`,
        )
      } else if (maxTokens > 0 && ledger.managedRun.tokens >= maxTokens) {
        trippedReason = tripManagedBudgetCircuit(
          state,
          ws,
          rootId,
          `托管后台 Token 消耗已达硬预算上限 (${formatCompactTokenShort(ledger.managedRun.tokens)}/${formatCompactTokenShort(maxTokens)})`,
        )
      }
    }
    return {
      ok: true,
      category,
      tripped: Boolean(ws.llmLedger.managedRun.tripped && trippedReason),
      trippedReason,
      ledger: summarizeLlmLedger(ws.llmLedger, resolveWorkspaceConfig(state, rootId)),
    }
  })
}

export function setBubbleHarnessMembership(rootId, { provider, label = '', role = '', joined = true } = {}) {
  const rid = String(rootId || '').trim()
  const pName = clamp(String(provider || '').trim(), 64)
  if (!rid) return { ok: false, error: '当前会话尚未绑定，无法调整协同水泡' }
  if (!pName || pName === 'spawn' || pName === 'fork') {
    return { ok: false, error: '无效的外部 Harness Provider 名称' }
  }
  return mutateChiefState((state) => {
    const ws = ensureWorkspace(state, rid)
    const cur = Array.isArray(ws.bubbleHarnesses) ? ws.bubbleHarnesses : []
    if (joined) {
      const entry = normalizeBubbleHarness({ provider: pName, label, role, joinedAt: Date.now() })
      const next = cur.filter(item => item && item.provider !== pName)
      next.push(entry)
      ws.bubbleHarnesses = next.slice(-12)
      pushAuditToWs(ws, {
        kind: 'bubble_harness_join',
        decision: 'allowed',
        tool: pName,
        reason: `将外部 Harness「${entry.label}」拖入协同作战水泡`,
      }, rid)
    } else {
      ws.bubbleHarnesses = cur.filter(item => item && item.provider !== pName)
      pushAuditToWs(ws, {
        kind: 'bubble_harness_leave',
        decision: 'allowed',
        tool: pName,
        reason: `将外部 Harness「${pName}」移出协同作战水泡`,
      }, rid)
    }
    return { ok: true, bubbleHarnesses: ws.bubbleHarnesses.slice() }
  })
}

export function setBubbleManualLock(rootId, { locked = false, reason = '' } = {}) {
  const rid = String(rootId || '').trim()
  if (!rid) return { ok: false, error: '当前会话尚未绑定' }
  return mutateChiefState((state) => {
    const ws = ensureWorkspace(state, rid)
    ws.bubbleLock = {
      manualLocked: Boolean(locked),
      lockedAt: locked ? Date.now() : 0,
      reason: locked ? clamp(reason || '手动锁定编队结构，防止工作中拆散', 120) : '',
    }
    pushAuditToWs(ws, {
      kind: 'bubble_lock_set',
      decision: 'allowed',
      tool: 'bubble_lock',
      reason: locked ? `锁定协同水泡结构：${ws.bubbleLock.reason}` : '解除协同水泡手动结构锁',
    }, rid)
    return { ok: true, bubbleLock: { ...ws.bubbleLock } }
  })
}

