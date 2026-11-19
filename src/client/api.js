/**
 * api.js
 *
 * HTTP client, Chief/Board state actions, archive/memory/handoff mutations, and session binding.
 */

import {
  API,
  SIDE_ID,
  EXPECTED_BACKEND_BUILD,
  CHIEF_PERMISSION_LABELS,
  FACT_CAT_LABEL,
  SECTION_LABEL,
  SEC_IMAGE_MIMES,
  SEC_MAX_IMAGES,
} from './constants.js'
import {
  store,
  SESSION_SOURCES,
  patch,
  service,
  isSubagentSessionId,
  runtimeRefs,
} from './store.js'
import {
  normalizeMaxTurnsVal,
  clampTitle,
  shortSession,
  fullModelWithChannel,
  shortAgentName,
  snippetOf,
  sessionIdFromUrl,
  encodeImageForChief,
  truncationNotice,
} from './utils.js'

function syncBackendActiveWork(activeWork) {
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
      if (cleanWork.tab === 'archive' && !store.archiveLoaded) void loadArchives(false)
    } else if (cleanWork.id && !seen[cleanWork.id]) {
      patch({ seenBackendWorkIds: { ...seen, [cleanWork.id]: true } })
    }
    if (!runtimeRefs.fastWorkPollTimer && typeof setTimeout === 'function') {
      runtimeRefs.fastWorkPollTimer = setTimeout(() => {
        runtimeRefs.fastWorkPollTimer = null
        if (store.chiefMeta && store.chiefMeta.activeWork) {
          void refresh()
        }
      }, 1200)
    }
  } else if (prevWork && prevWork.id) {
    if (runtimeRefs.fastWorkPollTimer) {
      clearTimeout(runtimeRefs.fastWorkPollTimer)
      runtimeRefs.fastWorkPollTimer = null
    }
    if (prevWork.tab === 'archive') void loadArchives(true)
    void loadChiefView(false)
  }
}

function applySecView(viewData) {
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
    ...(viewData.models ? { secModelsCatalog: viewData.models } : {}),
    ...(Array.isArray(viewData.guardWalls) ? { guardWalls: viewData.guardWalls } : {}),
    chiefMeta: {
      ...prevMeta,
      runMode: cfg.runMode || (cfg.stopped ? 'off' : (cfg.paceMode === 'auto' ? 'managed' : (cfg.paceMode === 'smart' ? 'patrol' : 'off'))),
      managedIdleTimeoutMs: Number(cfg.managedIdleTimeoutMs) || prevMeta.managedIdleTimeoutMs || (15 * 60 * 1000),
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
    throw new Error('接口返回异常：' + text.slice(0, 80))
  }
  if (value && value.board) patch({ board: value.board })
  if (value && Array.isArray(value.subagents)) patch({ subagents: value.subagents })
  if (value && value.agentIdentity) patch({ agentIdentity: value.agentIdentity })
  if (value && value.boundaries) patch({ boundaries: value.boundaries })
  if (value && Array.isArray(value.guardWalls)) patch({ guardWalls: value.guardWalls })
  if (value && (value.chiefMeta || value.hostCompat)) {
    const patchObj = {}
    if (value.chiefMeta) {
      const nextChiefMeta = { ...store.chiefMeta, ...value.chiefMeta }
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
  if (value && value.archives && Array.isArray(value.archives.items)) applyArchiveHeaders(value.archives)
  if (value && value.view) applySecView(value.view)
  if (!response.ok || (value && value.ok === false)) {
    const err = new Error((value && value.error) || ('HTTP ' + response.status))
    err.status = response.status
    err.payload = value
    throw err
  }
  return value
}

export async function loadChiefView(regenerate = false, opts = {}) {
  if (regenerate) patch({ secRegenerating: true, error: '' })
  try {
    const qs = new URLSearchParams()
    if (store.sessionId) qs.set('session', store.sessionId)
    if (regenerate) qs.set('regenerate', '1')
    const syncHandoff = typeof opts.syncHandoff === 'boolean' ? opts.syncHandoff : undefined
    if (typeof syncHandoff === 'boolean') qs.set('syncHandoff', syncHandoff ? '1' : '0')
    const usePost = Boolean(regenerate || typeof syncHandoff === 'boolean')
    const value = await call(
      'chief/view' + (qs.toString() ? '?' + qs.toString() : ''),
      usePost
        ? {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              session: store.sessionId,
              ...(regenerate ? { regenerate: true } : {}),
              ...(typeof syncHandoff === 'boolean' ? { syncHandoff } : {}),
            }),
          }
        : undefined,
    )
    if (value && value.ok) applySecView(value)
    if (value && value.handoffSyncResult) {
      if (value.handoffSyncResult.synced) {
        patch({ notice: '✦ 摘要已提炼并同步更新至交接单' })
        void loadHandoff()
      } else if (value.handoffSyncResult.skipped === 'pinned-by-human') {
        patch({ notice: regenerate ? '摘要已提炼（交接单已被人类定住，保持未覆写）' : '交接单已被人类定住，跳过同步' })
      } else if (regenerate) {
        patch({ notice: '摘要已重新提炼' })
      }
    } else if (regenerate) {
      patch({ notice: '摘要已重新提炼' })
    }
    return value
  } catch (error) {
    if (regenerate) patch({ error: String((error && error.message) || error) })
    return null
  } finally {
    if (regenerate) patch({ secRegenerating: false })
  }
}

export async function loadChiefModels(fresh = false) {
  try {
    const qs = new URLSearchParams()
    if (fresh) qs.set('fresh', '1')
    if (store.sessionId) qs.set('session', store.sessionId)
    const value = await call('chief/models' + (qs.toString() ? '?' + qs.toString() : ''))
    if (value && value.ok) {
      patch({
        secModelsCatalog: value,
        chiefMeta: {
          ...store.chiefMeta,
          modelRef: typeof value.selectedRef === 'string' ? value.selectedRef : store.chiefMeta.modelRef,
          followModelRef: value.followRef || value.defaultRef || store.chiefMeta.followModelRef || '',
          resolvedModelRef: value.resolvedRef || store.chiefMeta.resolvedModelRef || '',
        },
      })
    }
    return value
  } catch {
    return null
  }
}

export async function updateSecConfig(nextCfg) {
  try {
    let lockPatchPayload = null
    if (nextCfg && nextCfg.toggleLockAgentEffort && typeof nextCfg.toggleLockAgentEffort === 'object') {
      const t = String(nextCfg.toggleLockAgentEffort.target || 'lead').trim()
      const l = Boolean(nextCfg.toggleLockAgentEffort.locked)
      const aliases = Array.isArray(nextCfg.toggleLockAgentEffort.aliases)
        ? nextCfg.toggleLockAgentEffort.aliases.map(x => String(x || '').trim()).filter(Boolean)
        : []
      const shortT = t.includes('/') ? t.split('/').pop() : ''
      const keys = Array.from(new Set([t, shortT, ...aliases].filter(Boolean)))
      if (keys.length) {
        lockPatchPayload = {}
        for (const k of keys) lockPatchPayload[k] = l
      }
    }
    const value = await call('chief/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...nextCfg,
        ...(lockPatchPayload ? { lockedModelEfforts: lockPatchPayload } : {}),
        session: store.sessionId,
      }),
    })
    if (value && value.requireAutoPilotConfirm) {
      patch({ autoPilotConfirmOpen: true, secPaceMenuOpen: false })
      return null
    }
    if (!value || value.ok === false) {
      patch({ error: (value && value.error) || '更新参谋长配置失败' })
      return null
    }
    const resolvedLocks = (value.config && value.config.lockedModelEfforts && typeof value.config.lockedModelEfforts === 'object')
      ? value.config.lockedModelEfforts
      : ((value.view && value.view.config && value.view.config.lockedModelEfforts && typeof value.view.config.lockedModelEfforts === 'object')
          ? value.view.config.lockedModelEfforts
          : null)
    const resolvedTeamEffortMode = (value.config && typeof value.config.teamEffortMode === 'string')
      ? value.config.teamEffortMode
      : ((value.view && value.view.config && typeof value.view.config.teamEffortMode === 'string')
          ? value.view.config.teamEffortMode
          : null)
    const updatedSubagents = resolvedLocks && Array.isArray(store.subagents)
      ? store.subagents.map(ag => {
          if (!ag || typeof ag !== 'object') return ag
          const nm = String(ag.name || '').replace(/^@/, '')
          const shortNm = nm.split('/').pop()
          const lockedNow = Boolean(
            (nm && resolvedLocks[nm])
            || (shortNm && resolvedLocks[shortNm])
            || (ag.id && resolvedLocks[ag.id]),
          )
          return { ...ag, effortLocked: lockedNow }
        })
      : null
    patch({
      compactInputDraft: null,
      compactLowWarning: value.compactLowWarning || '',
      ...((resolvedLocks || resolvedTeamEffortMode)
        ? {
            chiefMeta: {
              ...store.chiefMeta,
              ...(resolvedLocks ? { lockedModelEfforts: resolvedLocks } : {}),
              ...(resolvedTeamEffortMode ? { teamEffortMode: resolvedTeamEffortMode === 'manual' ? 'manual' : 'auto' } : {}),
            },
          }
        : {}),
      ...(updatedSubagents ? { subagents: updatedSubagents } : {}),
    })
    if (resolvedLocks) void refresh()
    if (nextCfg.ackHazardAlertId) {
      // Quietly acknowledged; no intrusive toast needed
    } else if (nextCfg.emergencyStopIntervention) {
      patch({ notice: '⏹ 已紧急关停「主动强介入」，自动驱动与巡检续跑已停机' })
    } else if (typeof nextCfg.permissionMode === 'string') {
      const savedPerm = (value.config && value.config.permissionMode)
        || (value.view && value.view.config && value.view.config.permissionMode)
        || ''
      if (savedPerm && savedPerm !== nextCfg.permissionMode) {
        patch({
          staleBackendDetected: true,
          staleBackendDismissed: false,
          error: '参谋长权限未在后端生效（宿主仍在运行旧版内存模块），请重启一次 DeepSeek Harness 客户端。',
        })
        return null
      }
      const permMap = {
        advisor: '已切换为 L0 · 顾问模式（只读观察/分析/建议，不改工作区与工作流）',
        assistant: '已切换为 L1 · 助手模式（仅可维护参谋记忆、档案与看板配置）',
        strategist: '已切换为 L2 · 参谋模式（修改工作区或主/子工作流前将弹窗逐项授权）',
        chief: '已通过风险确认并进入 L3 · 参谋长模式（高自主执行，受安全卫兵与审计日志约束）',
      }
      patch({ notice: permMap[nextCfg.permissionMode] || '已更新参谋长执行权限' })
    } else if (nextCfg.tacticalModes && typeof nextCfg.tacticalModes === 'object') {
      if (value.compactLowWarning) {
        patch({ notice: '⚠️ ' + value.compactLowWarning })
      } else if (normalizeMaxTurnsVal(nextCfg.tacticalModes.maxInterventionTurns) === 0 && Object.prototype.hasOwnProperty.call(nextCfg.tacticalModes, 'maxInterventionTurns') && !nextCfg.confirmedInterventionRisk) {
        patch({ notice: '♾️ 已启用无限督导轮次（只要参谋长判定未完成就会继续 push）' })
      } else if (typeof nextCfg.tacticalModes.intervention === 'boolean' && nextCfg.confirmedInterventionRisk) {
        const ko = value.immediateKickoff
        patch({
          notice: nextCfg.tacticalModes.intervention
            ? (ko && ko.triggered
                ? '⚡ 已开启「主动强介入」并锁定总目标，正在立即唤醒推进'
                : (ko && ko.queuedApproval
                    ? '⚡ 已开启「主动强介入」，请授权首轮推进弹窗'
                    : '⚡ 已开启「主动强介入」并锁定核心总目标'))
            : '已关闭「主动强介入」模式',
        })
      } else if (typeof nextCfg.tacticalModes.intervention === 'boolean' && Object.keys(nextCfg.tacticalModes).length === 1) {
        patch({ notice: nextCfg.tacticalModes.intervention ? '⚡ 已开启「主动强介入」模式' : '已关闭「主动强介入」模式' })
      } else {
        patch({ notice: '✦ 已更新参谋长战术驾驶舱开关' })
      }
    } else if (typeof nextCfg.runMode === 'string') {
      const rmMap = {
        off: '⏸ 已切至「关停模式」：后台 0 LLM 消耗、0 巡检、0 梦境漫游（仅显式发话/按钮生效）',
        patrol: '🛡 已切至「巡检模式」：常规回合 0 Token，阻墙拦截/高危报错/断流时精准唤醒（支持 Auto continue）',
        managed: '🤖 已开启「托管模式」：持续监工督导 + 🌙 梦境漫游轻拢卷宗织钩子 + 15 分钟闲置自动休眠',
      }
      patch({ notice: rmMap[nextCfg.runMode] || '已更新参谋长运行模式' })
    } else if (typeof nextCfg.thinkingEffort === 'string') {
      patch({ notice: `🧠 已切换参谋长思考强度为「${nextCfg.thinkingEffort === 'auto' ? '自适应换挡' : nextCfg.thinkingEffort}」` })
    } else if (typeof nextCfg.teamEffortMode === 'string') {
      patch({
        notice: nextCfg.teamEffortMode === 'manual'
          ? '✋ 团队思考强度已设为「手动」：参谋长不再自动调节主/子代理思考强度'
          : '🪄 团队思考强度已设为「自动」：参谋长将按当前权限范围自动调节',
      })
    } else if (nextCfg.directSetAgentEffort && typeof nextCfg.directSetAgentEffort === 'object') {
      const t = nextCfg.directSetAgentEffort.target || 'lead'
      const e = nextCfg.directSetAgentEffort.reasoningEffort || nextCfg.directSetAgentEffort.effort || 'medium'
      patch({ notice: `🧠 已调整 @${t} 模型思考强度为 ${e}` })
    } else if (nextCfg.toggleLockAgentEffort && typeof nextCfg.toggleLockAgentEffort === 'object') {
      const t = nextCfg.toggleLockAgentEffort.target || 'lead'
      const l = Boolean(nextCfg.toggleLockAgentEffort.locked)
      patch({ notice: l ? `🔒 已锁定 @${t} 思考挡位，参谋 L2/L3 无法自动覆写` : `🔓 已解除 @${t} 思考挡位锁定` })
    } else if (typeof nextCfg.paceMode === 'string') {
      const paceNotice = nextCfg.paceMode === 'stopped'
        ? '⏹ 已停止参谋长：后台强介入、空转监控与断线续跑全部暂停（可随时切回恢复）'
        : nextCfg.paceMode === 'auto'
          ? '⚡ 已开启本会话全自动托管（仅管当前对话，完工且摘要收尾后自动停机防空转）'
          : nextCfg.paceMode === 'smart'
            ? '已切为「关键巡检」：仅在撞墙或关键节点节流巡检，摘要按需手动提炼'
            : '已切为「按需手动」：后台零自动总结，仅在你点提炼或发话时调用模型'
      patch({ notice: paceNotice })
    } else if (typeof nextCfg.autoPilot === 'boolean') {
      patch({ notice: nextCfg.autoPilot ? '⚡ 已开启本会话全自动协同托管' : '已切换为按需手动模式' })
    } else if (typeof nextCfg.modelRef === 'string') {
      const cat = (value && value.view && value.view.models) || store.secModelsCatalog
      const followHint = (cat && (cat.followLabel || fullModelWithChannel(cat.followRef || cat.defaultRef, cat))) || ''
      patch({
        notice: nextCfg.modelRef
          ? '参谋长专职模型：' + fullModelWithChannel(nextCfg.modelRef, cat)
          : '已恢复跟随主对话模型' + (followHint ? '（' + followHint + '）' : ''),
      })
    }
    return value
  } catch (error) {
    const payload = error && error.payload
    if (payload && payload.requireChiefRiskConfirm) {
      patch({ chiefRiskModalOpen: true, chiefRiskAgreed: false, secPermMenuOpen: false })
      return null
    }
    if (payload && payload.requireAutoPilotConfirm) {
      patch({ autoPilotConfirmOpen: true, secPaceMenuOpen: false })
      return null
    }
    patch({ error: String((error && error.message) || error) })
    return null
  }
}

export async function decideApproval(approvalId, decision) {
  if (!approvalId) return null
  patch({ approvalBusyId: approvalId, error: '' })
  try {
    const value = await call('chief/approval', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session: store.sessionId,
        id: approvalId,
        decision,
      }),
    })
    patch({
      approvalBusyId: '',
      openApprovalModalId: '',
      notice: decision === 'approve'
        ? (value && value.resumed
            ? '✓ 已授权执行并自动续跑完成原任务'
            : ((value && value.executed) ? '✓ 已授权并执行本次操作' : '✓ 已批准操作'))
        : '已拒绝本次受控操作申请',
    })
    return value
  } catch (error) {
    patch({ approvalBusyId: '', error: String((error && error.message) || error) })
    return null
  }
}

export async function decideElevation(elevationId, decision, targetMode, confirmedChiefRisk = false) {
  if (!elevationId) return null
  patch({ elevationBusy: true, error: '' })
  try {
    const value = await call('chief/elevation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session: store.sessionId,
        id: elevationId,
        decision,
        ...(targetMode ? { targetMode } : {}),
        confirmedChiefRisk: Boolean(confirmedChiefRisk),
      }),
    })
    patch({
      elevationBusy: false,
      elevationAgreed: false,
      elevationChosenMode: '',
      notice: decision === 'approve'
        ? (value && value.resumed
            ? ('已批准提权至 ' + (CHIEF_PERMISSION_LABELS[value.permissionMode || targetMode] || targetMode) + ' 并自动续跑')
            : ('已批准提权至 ' + (CHIEF_PERMISSION_LABELS[value.permissionMode || targetMode] || targetMode)))
        : '已拒绝模型的权限提升申请',
    })
    return value
  } catch (error) {
    const payload = error && error.payload
    if (payload && payload.requireChiefRiskConfirm) {
      patch({ elevationBusy: false, error: '进入 L3 参谋长模式必须勾选风险知悉确认' })
      return null
    }
    patch({ elevationBusy: false, error: String((error && error.message) || error) })
    return null
  }
}

export async function togglePeerSessionLink(peerId, linked) {
  try {
    const value = await call('chief/link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session: store.sessionId, peerSession: peerId, linked }),
    })
    patch({
      notice: linked
        ? '已接入跨对话协同网络（进度与信箱实时同步）'
        : '已脱离协同网络：参谋摘要与协同上下文已隔离净化',
    })
    return value
  } catch (error) {
    patch({ error: String((error && error.message) || error) })
    return null
  }
}

export function requestTogglePeerLink(sess, nextLinked) {
  if (!sess || !sess.id) return
  if (nextLinked) {
    patch({
      peerLinkConfirmModal: {
        peerId: sess.id,
        peerTitle: sess.name || shortSession(sess.id),
        peerObjective: sess.objective || '',
      },
    })
    return
  }
  void togglePeerSessionLink(sess.id, false)
}

export async function decideSuggestion(sug, decision, editedText = '', boundField = '', pinGlobal = undefined) {
  if (!sug || !sug.id) return null
  patch({ secBusy: true, error: '' })
  try {
    const value = await call('chief/suggestion', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session: store.sessionId,
        id: sug.id,
        decision,
        ...(editedText ? { text: editedText } : {}),
        ...(boundField ? { boundField } : {}),
        ...(typeof pinGlobal === 'boolean' ? { pinGlobal } : {}),
      }),
    })
    if (decision === 'approve') {
      if (sug.kind === 'bound') {
        const applied = (value && value.boundApplied) || {}
        const label = applied.label || sug.targetLabel || '边界'
        const isPinned = Boolean(applied.pinned)
        const replacedN = Number(applied.replacedCount || (Array.isArray(sug.replaces) ? sug.replaces.length : 0))
        if (replacedN > 0) {
          patch({ notice: `${isPinned ? '📌 ' : ''}已将 ${replacedN} 条零散规则浓缩合并进【${label}】${isPinned ? '（全局共享）' : '（仅本任务）'}` })
        } else {
          patch({ notice: `${isPinned ? '📌 已批准并定住全局' : '已批准注入本任务'}【${label}】` })
        }
      } else if (sug.kind === 'guard_wall') {
        const applied = value && value.wallApplied
        patch({ notice: '🧱 已落锁物理驻墙：' + ((applied && applied.title) || sug.title || '') })
      } else if (sug.kind === 'wall_removal') {
        const removed = value && value.wallRemoved
        patch({
          notice: removed && removed.action === 'remove'
            ? `🧱 已批准拆除物理驻墙：${removed.title || sug.title || ''}`
            : `⏸ 已批准暂挂物理驻墙：${(removed && removed.title) || sug.title || ''}`,
        })
      } else if (sug.kind === 'advice') {
        patch({ notice: '💡 已采纳参谋长建议并递交 → @' + (sug.targetLabel || sug.target || '主对话') })
      } else {
        patch({ notice: '已递话 → @' + (sug.targetLabel || sug.target) })
      }
      void refresh()
    }
    return value
  } catch (error) {
    patch({ error: String((error && error.message) || error) })
    return null
  } finally {
    patch({ secBusy: false })
  }
}

export async function executePendingSuggestions(opts = {}) {
  const allPending = (store.secView && Array.isArray(store.secView.suggestions))
    ? store.secView.suggestions.filter(s => s && s.status === 'pending')
    : []
  const targetList = (Array.isArray(opts.ids) && opts.ids.length)
    ? allPending.filter(s => opts.ids.includes(s.id))
    : allPending
  const fxSpec = resolveChiefSuggestionWorkFx(targetList)
  return await withChiefWorkFx({ ...fxSpec, minMs: 480 }, async () => {
    patch({ secBusy: true, error: '' })
    try {
      const value = await call('chief/suggestion', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          session: store.sessionId,
          decision: 'execute_batch',
          batch: true,
          ...(Array.isArray(opts.ids) && opts.ids.length ? { ids: opts.ids } : {}),
          ...(typeof opts.includeGoalApproval === 'boolean' ? { includeGoalApproval: opts.includeGoalApproval } : {}),
          ...(typeof opts.pinGlobalDefault === 'boolean' ? { pinGlobalDefault: opts.pinGlobalDefault } : {}),
        }),
      })
      const execCount = Number(value && value.executedCount) || 0
      const blockedCount = Number(value && value.blockedCount) || 0
      const skippedGoals = Number(value && value.skippedGoalCount) || 0
      const parts = [`✓ 已执行 ${execCount} 项参谋建议`]
      if (blockedCount > 0) parts.push(`拦截 ${blockedCount} 项越界建议`)
      if (skippedGoals > 0) parts.push(`保留 ${skippedGoals} 项结项请示单独拍板`)
      patch({ notice: parts.join(' · ') })
      void refresh()
      return value
    } catch (error) {
      patch({ error: String((error && error.message) || error) })
      return null
    } finally {
      patch({ secBusy: false })
    }
  })
}

export async function dismissPendingSuggestions(list = []) {
  const targets = (Array.isArray(list) ? list : []).filter(s => s && s.id && s.status === 'pending')
  if (!targets.length) return true
  patch({ secBusy: true, error: '' })
  try {
    for (const sug of targets) {
      await call('chief/suggestion', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session: store.sessionId, id: sug.id, decision: 'dismiss' }),
      })
    }
    patch({ notice: `已忽略 ${targets.length} 条建议` })
    void refresh()
    return true
  } catch (error) {
    patch({ error: String((error && error.message) || error) })
    return false
  } finally {
    patch({ secBusy: false })
  }
}

export async function requestConsolidateBounds(field = '', items = []) {
  if (store.secBusy || store.boundConsolidating) return null
  const tag = field || 'all'
  return await withChiefWorkFx(
    { tone: 'bounds', tab: 'boundaries', boundSubTab: 'rules', label: '参谋长正在浓缩边界中...' },
    async () => {
      patch({ boundConsolidating: tag, secBusy: true, error: '' })
      try {
        const cleanItems = Array.isArray(items) ? items.filter(Boolean) : []
        const value = await call('chief/consolidate-bounds', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            session: store.sessionId,
            field,
            items: cleanItems,
          }),
        })
        if (value && value.ok) {
          const nextSel = { ...(store.boundSelected || { allowed: [], forbidden: [], notes: [] }) }
          if (field && nextSel[field]) nextSel[field] = []
          else {
            nextSel.allowed = []
            nextSel.forbidden = []
            nextSel.notes = []
          }
          patch({
            boundSelected: nextSel,
            notice: '🏛 参谋长已将零散边界浓缩为 1 条，请在上方请示卡拍板',
          })
        }
        return value
      } catch (error) {
        patch({ error: String((error && error.message) || error) })
        return null
      } finally {
        patch({ boundConsolidating: '', secBusy: false })
      }
    },
  )
}

export function prefillSuggestion(sug) {
  if (!sug) return
  patch({
    secTarget: sug.target || 'lead',
    secMode: sug.mode || 'steer',
    secInput: sug.draftText || '',
    notice: '已填入底部许愿框，可微调后发送',
  })
  if (sug.id && !sug.isSynthetic) void decideSuggestion(sug, 'dismiss')
}

export async function mutateFact(payload) {
  try {
    const value = await call('chief/fact', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session: store.sessionId, ...payload }),
    })
    if (payload.op === 'add') patch({ notice: '已记入持久条目' })
    else if (payload.op === 'remove') patch({ notice: '已移除条目' })
    return value
  } catch (error) {
    patch({ error: String((error && error.message) || error) })
    return null
  }
}

export async function ingestSecImageFiles(fileList) {
  const incoming = Array.from(fileList || []).filter(f => {
    if (!f) return false
    const t = String(f.type || '').toLowerCase()
    if (t === 'image/jpg' || SEC_IMAGE_MIMES.has(t)) return true
    return /\.(png|jpe?g|webp|gif)$/i.test(String(f.name || ''))
  })
  if (!incoming.length) {
    patch({ notice: '仅支持 PNG / JPEG / WebP / GIF 格式图片' })
    return
  }
  const existing = Array.isArray(store.secImages) ? store.secImages : []
  const slots = Math.max(0, SEC_MAX_IMAGES - existing.length)
  if (!slots) {
    patch({ notice: `最多一次上传 ${SEC_MAX_IMAGES} 张图片` })
    return
  }
  const picked = incoming.slice(0, slots)
  if (incoming.length > slots) {
    patch({ notice: `单次最多 ${SEC_MAX_IMAGES} 张，已截取前 ${slots} 张` })
  }
  const encoded = []
  for (const file of picked) {
    try {
      encoded.push(await encodeImageForChief(file))
    } catch (err) {
      patch({ error: String((err && err.message) || err) })
    }
  }
  if (encoded.length) {
    const latest = Array.isArray(store.secImages) ? store.secImages : []
    patch({ secImages: [...latest, ...encoded].slice(0, SEC_MAX_IMAGES) })
  }
}

function classifyChiefWorkFx(text, quickTag = '') {
  if (quickTag === 'consult_chief') {
    return { tone: 'neon', tab: 'chief', label: '💡 参谋长正在研判局势与拟定建议...' }
  }
  if (quickTag === 'dream_roam') {
    return { tone: 'dream', tab: 'archive', label: '🌙 参谋长正在梦境漫游 · 轻拢卷宗与织就钩子中...' }
  }
  if (quickTag === 'craft_wall') {
    return { tone: 'wall', tab: 'boundaries', boundSubTab: 'rules', label: '参谋长正在手搓驻墙中...' }
  }
  if (quickTag === 'extract_bounds') {
    return { tone: 'bounds', tab: 'boundaries', boundSubTab: 'rules', label: '参谋长正在提炼边界中...' }
  }
  const clean = String(text || '').trim()
  const hits = []
  if (/梦境漫游|dream.?roam/i.test(clean)) {
    hits.push({ tone: 'dream', tab: 'archive', label: '🌙 参谋长正在梦境漫游 · 轻拢卷宗与织就钩子中...' })
  }
  if (/思考强度|思考挡位|推理强度|调挡|reasoningEffort|effortOps/i.test(clean)) {
    hits.push({ tone: 'neon', tab: store.tab || 'chief', label: '🧠 参谋长正在调配模型思考强度中...' })
  }
  if (/置顶桌面|认知桌面|递送.*档案|拉阅.*钩子|archiveOps/i.test(clean)) {
    hits.push({ tone: 'archive', tab: 'archive', label: '📌 参谋长正在调配认知桌面与卷宗钩子中...' })
  }
  if (/手搓|驻墙|筑墙|物理墙|guard_?wall|wallProposals/i.test(clean)) {
    hits.push({ tone: 'wall', tab: 'boundaries', boundSubTab: 'rules', label: '参谋长正在手搓驻墙中...' })
  }
  if (/提炼.{0,4}边界|工作边界|红线|必做项|注意事项|boundProposals/i.test(clean)) {
    hits.push({ tone: 'bounds', tab: 'boundaries', boundSubTab: 'rules', label: '参谋长正在调配红线边界中...' })
  }
  if (/整理档案|档案柜|卷宗|归档|收纳入柜|桌面档案|抽屉|archive/i.test(clean)) {
    hits.push({ tone: 'archive', tab: 'archive', label: '参谋长正在整理档案中...' })
  }
  if (/任务看板|拆解任务|金字塔|子任务|graph\.plan/i.test(clean)) {
    hits.push({ tone: 'tasks', tab: 'tasks', label: '参谋长正在编排任务看板中...' })
  }
  if (/执行计划|规划步骤|交接单|handoff/i.test(clean)) {
    hits.push({ tone: 'tasks', tab: 'plan', label: '参谋长正在推演执行计划中...' })
  }
  if (/协同网络|跨窗|关联会话|子代理|广播/i.test(clean)) {
    hits.push({ tone: 'peers', tab: 'peers', label: '参谋长正在协调团队网络中...' })
  }
  if (hits.length === 1) return hits[0]
  if (hits.length >= 2) {
    const allBoundaries = hits.every(x => x.tab === 'boundaries')
    return {
      tone: 'neon',
      tab: allBoundaries ? 'boundaries' : (store.tab || 'chief'),
      ...(allBoundaries ? { boundSubTab: 'rules' } : {}),
      label: allBoundaries ? '参谋长正在手搓驻墙与边界中...' : '参谋长正在统筹操作参谋系统中...',
    }
  }
  return {
    tone: 'neon',
    tab: store.tab || 'chief',
    label: '参谋长正在推演研判中...',
  }
}

function resolveChiefSuggestionWorkFx(suggestions = []) {
  const list = Array.isArray(suggestions) ? suggestions.filter(Boolean) : []
  if (!list.length) {
    return { tone: 'neon', tab: store.tab || 'chief', label: '参谋长正在统一落地参谋建议中...' }
  }
  const kinds = new Set(list.map(s => String(s.kind || '').trim()))
  if (kinds.size === 1 && kinds.has('guard_wall')) {
    return { tone: 'wall', tab: 'boundaries', boundSubTab: 'rules', label: '参谋长正在落锁物理驻墙中...' }
  }
  if (kinds.size === 1 && kinds.has('wall_removal')) {
    return { tone: 'wall', tab: 'boundaries', boundSubTab: 'rules', label: '⚠️ 正在按人工批准调整物理驻墙...' }
  }
  if (kinds.size === 1 && kinds.has('bound')) {
    return { tone: 'bounds', tab: 'boundaries', boundSubTab: 'rules', label: '参谋长正在注入红线边界中...' }
  }
  if (kinds.size === 1 && kinds.has('archive_op')) {
    return { tone: 'archive', tab: 'archive', label: '📌 参谋长正在调配认知桌面与卷宗钩子中...' }
  }
  if (kinds.size === 1 && kinds.has('model_effort')) {
    return { tone: 'neon', tab: 'chief', label: '🧠 参谋长正在调配模型思考强度中...' }
  }
  const allBoundsPage = [...kinds].every(k => k === 'guard_wall' || k === 'bound')
  return {
    tone: 'neon',
    tab: allBoundsPage ? 'boundaries' : (store.tab || 'chief'),
    ...(allBoundsPage ? { boundSubTab: 'rules' } : {}),
    label: allBoundsPage ? '参谋长正在同步落锁驻墙与边界中...' : '🏁 参谋长正在一站式推进建议清单中...',
  }
}

async function withChiefWorkFx(fxSpec = {}, fn) {
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
      label: spec.label || '参谋长正在工作中...',
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

export async function submitChiefBar(overrideText = '', quickTag = '') {
  const text = String(overrideText || store.secInput || '').trim()
  const imgs = overrideText ? [] : (Array.isArray(store.secImages) ? store.secImages : [])
  if ((!text && !imgs.length) || store.secBusy) return
  const target = overrideText ? 'auto' : (store.secTarget || 'auto')
  const mode = store.secMode || 'steer'
  const fxSpec = classifyChiefWorkFx(text, quickTag)
  await withChiefWorkFx(fxSpec, async () => {
    patch({
      secBusy: true,
      chiefQuickAction: quickTag || '',
      ...(overrideText ? {} : { secInput: '', secImages: [] }),
      error: '',
    })
    try {
      const value = await call('chief/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          session: store.sessionId,
          text,
          target,
          mode,
          ...(quickTag ? { quickAction: quickTag } : {}),
          images: imgs.map(({ name, mediaType, data }) => ({ name, mediaType, data })),
        }),
      })
      if (value) {
        const actions = []
        const seenActions = new Set()
        const pushAction = (label) => {
          const clean = typeof label === 'string' ? label.trim() : ''
          if (!clean || seenActions.has(clean)) return
          seenActions.add(clean)
          actions.push(clean)
        }
        for (const b of (value.actionBadges || [])) pushAction(b)
        for (const r of (value.relays || [])) {
          if (r && r.ok) pushAction('→ ' + (r.target || target))
        }
        for (const b of (value.boardOps || [])) pushAction(b)
        for (const a of (value.archiveOps || [])) pushAction(a)
        for (const n of (value.networkOps || [])) pushAction(n)
        for (const m of (value.memoryChanges || [])) {
          if (m && m.text) pushAction((m.op === 'remove' ? '移除：' : '记入：') + clampTitle(m.text, 14))
        }
        for (const wp of (value.wallProposals || [])) {
          if (wp && wp.title) pushAction('呈批驻墙：' + clampTitle(wp.title, 14))
        }
        for (const wr of (value.wallRemovalProposals || [])) {
          if (wr && wr.title) pushAction('⚠️ 请示拆墙：' + clampTitle(wr.title, 14))
        }
        for (const bp of (value.boundProposals || [])) {
          if (bp && bp.draftText) pushAction('呈批边界：' + clampTitle(bp.draftText, 12))
        }
        if (value.view) applySecView(value.view)
        const createdSugCount = (Array.isArray(value.wallProposals) ? value.wallProposals.length : 0)
          + (Array.isArray(value.wallRemovalProposals) ? value.wallRemovalProposals.length : 0)
          + (Array.isArray(value.boundProposals) ? value.boundProposals.length : 0)
        const hasWallRemovalOnly = (Array.isArray(value.wallRemovalProposals) && value.wallRemovalProposals.length > 0)
          && !(Array.isArray(value.wallProposals) && value.wallProposals.length > 0)
          && !(Array.isArray(value.boundProposals) && value.boundProposals.length > 0)
        const autoDestTab = createdSugCount > 0
          ? (hasWallRemovalOnly ? (store.tab || 'chief') : 'boundaries')
          : ((Array.isArray(value.archiveOps) && value.archiveOps.length > 0 && fxSpec.tab === 'chief') ? 'archive' : '')
        patch({
          ...(autoDestTab && autoDestTab !== store.tab ? { tab: autoDestTab, ...(autoDestTab === 'boundaries' ? { boundSubTab: 'rules' } : {}) } : {}),
          secLatestReply: {
            text: value.reply || '- 【已处理】已按吩咐执行完毕。',
            actions,
            at: Date.now(),
          },
          ...(createdSugCount > 0
            ? {
                notice: hasWallRemovalOnly
                  ? `⚠️ 参谋请示人工审批拆墙（${value.wallRemovalProposals.length} 项），请在建议栏拍板批准或忽略`
                  : `✨ 已生成 ${createdSugCount} 项待确认提案，请点面板顶部「▶ 执行建议」一键落锁生效`,
              }
            : {}),
        })
        if (createdSugCount > 0 && runtimeRefs.panelEl) {
          try {
            const scroller = runtimeRefs.panelEl.querySelector('.dnb-body')
            if (scroller && typeof scroller.scrollTo === 'function') {
              scroller.scrollTo({ top: 0, behavior: 'smooth' })
            } else if (typeof runtimeRefs.panelEl.scrollTo === 'function') {
              runtimeRefs.panelEl.scrollTo({ top: 0, behavior: 'smooth' })
            }
          } catch {}
        }
        if (Array.isArray(value.archiveOps) && value.archiveOps.length > 0) {
          void loadArchives(true)
        }
        if (actions.length) void refresh()
      }
    } catch (error) {
      patch({
        ...(overrideText ? {} : { secInput: text, secImages: imgs }),
        error: String((error && error.message) || error),
      })
    } finally {
      patch({ secBusy: false, chiefQuickAction: '' })
    }
  })
}

function applyArchiveHeaders(payload, invalidateIds = null, requestedScope = '') {
  if (!payload || typeof payload !== 'object') return
  const isSystemGlobalResp = payload.isSystemGlobalVault === true
  const targetScope = String(
    requestedScope
    || payload.requestedScope
    || payload.vaultScope
    || payload.scope
    || ''
  ).toLowerCase()

  // Hard anti-bleed guard: if Global vault was requested but running host lacks `isSystemGlobalVault: true` (stale memory module),
  // block writing into `globalVaultItems` or `archiveItems` so local items NEVER bleed into Global!
  if (targetScope === 'global' && !isSystemGlobalResp) {
    patch({
      globalVaultLoaded: false,
      globalVaultItems: [],
      globalVaultStaleBlocked: true,
      staleBackendDetected: true,
    })
    return
  }

  const items = Array.isArray(payload.items) ? payload.items : []
  const folders = Array.isArray(payload.folders)
    ? payload.folders
    : (isSystemGlobalResp ? store.globalVaultFolders : store.archiveFolders)
  const precipitated = Array.isArray(payload.precipitated) ? payload.precipitated : store.archivePrecipitated
  const flippedPrecipitatedIds = Array.isArray(payload.flippedPrecipitatedIds)
    ? payload.flippedPrecipitatedIds
    : store.flippedPrecipitatedIds
  const nextCounts = (payload.counts && typeof payload.counts === 'object')
    ? { ...(store.archiveCounts || {}), ...payload.counts }
    : (store.archiveCounts || {})
  const nextDiffSummary = (payload.diffSummary && typeof payload.diffSummary === 'object')
    ? payload.diffSummary
    : store.archiveDiffSummary

  let nextDetails = store.archiveDetails || {}
  if (Array.isArray(invalidateIds) && invalidateIds.length) {
    nextDetails = { ...nextDetails }
    for (const id of invalidateIds) delete nextDetails[id]
  }
  if (Object.keys(nextDetails).length > 0 && items.length > 0) {
    let touched = false
    const headerMap = new Map(items.map(it => [it.id, it]))
    const synced = { ...nextDetails }
    for (const [id, det] of Object.entries(synced)) {
      const hdr = headerMap.get(id)
      if (!hdr) continue
      if (
        det.takenOut !== hdr.takenOut
        || det.chiefMounted !== hdr.chiefMounted
        || det.paperclip !== hdr.paperclip
        || det.folder !== hdr.folder
        || det.updatedAt !== hdr.updatedAt
      ) {
        if (det.updatedAt !== hdr.updatedAt) {
          delete synced[id]
        } else {
          synced[id] = {
            ...det,
            takenOut: hdr.takenOut,
            chiefMounted: hdr.chiefMounted,
            paperclip: hdr.paperclip,
            folder: hdr.folder,
          }
        }
        touched = true
      }
    }
    if (touched) nextDetails = synced
  }

  if (isSystemGlobalResp) {
    patch({
      archiveLoaded: true,
      globalVaultLoaded: true,
      globalVaultStaleBlocked: false,
      globalVaultFolders: folders,
      globalVaultItems: items,
      archivePrecipitated: precipitated,
      ...(Array.isArray(payload.precipitatedFolders) ? { precipitatedFolders: payload.precipitatedFolders } : {}),
      ...(payload.precipitatedViewerSummary ? { precipitatedViewerSummary: payload.precipitatedViewerSummary } : {}),
      ...(payload.desktop && typeof payload.desktop === 'object' ? { archiveDesktop: payload.desktop } : {}),
      ...(payload.viewerSummary && typeof payload.viewerSummary === 'object' ? { archiveViewerSummary: payload.viewerSummary } : {}),
      flippedPrecipitatedIds,
      archiveCounts: nextCounts,
      archiveDiffSummary: nextDiffSummary,
      archiveDetails: nextDetails,
      ...(Array.isArray(payload.deskItems) ? { archiveDeskItems: payload.deskItems, archiveDeskLoaded: true } : {}),
    })
    return
  }

  const cabinets = Array.isArray(payload.cabinets) ? payload.cabinets : store.archiveCabinets
  const activeCabinetId = payload.activeCabinetId !== undefined
    ? String(payload.activeCabinetId || '')
    : (store.archiveCabinetId || '')
  const projectKey = payload.projectKey !== undefined ? String(payload.projectKey || '') : (store.archiveProjectKey || '')
  const unboundSession = typeof payload.unboundSession === 'boolean'
    ? payload.unboundSession
    : Boolean(nextCounts && nextCounts.unboundSession)
  const openFolders = { ...(store.archiveOpenFolders || {}) }
  if (!store.archiveSessionLoaded && Object.keys(openFolders).length === 0) {
    const firstNonEmpty = folders.find(f => f && f.count > 0)
    if (firstNonEmpty) openFolders[firstNonEmpty.id] = true
  }

  patch({
    archiveLoaded: true,
    archiveSessionLoaded: true,
    archiveProjectKey: projectKey,
    archiveCabinetId: activeCabinetId,
    archiveCabinets: cabinets,
    archiveFolders: folders,
    archiveItems: items,
    archivePrecipitated: precipitated,
    ...(Array.isArray(payload.precipitatedFolders) ? { precipitatedFolders: payload.precipitatedFolders } : {}),
    ...(payload.precipitatedViewerSummary ? { precipitatedViewerSummary: payload.precipitatedViewerSummary } : {}),
    ...(payload.desktop && typeof payload.desktop === 'object' ? { archiveDesktop: payload.desktop } : {}),
    ...(payload.viewerSummary && typeof payload.viewerSummary === 'object' ? { archiveViewerSummary: payload.viewerSummary } : {}),
    flippedPrecipitatedIds,
    archiveCounts: nextCounts,
    archiveDiffSummary: nextDiffSummary,
    archiveUnboundSession: unboundSession,
    archiveOpenFolders: openFolders,
    archiveDetails: nextDetails,
    ...(Array.isArray(payload.deskItems) ? { archiveDeskItems: payload.deskItems, archiveDeskLoaded: true } : {}),
  })
}

/** Tier-1 Lazy Load: called ONLY when the user opens or switches scope in the `档案` tab */
export async function loadArchives(force = false, cabinetIdOverride = '', scopeOverride = '') {
  if (store.archiveLoading) return null
  const rawScope = scopeOverride || store.archiveTabScope || 'desktop'
  const activeScope = rawScope === 'desktop' ? 'session' : rawScope
  const alreadyLoaded = activeScope === 'global'
    ? store.globalVaultLoaded
    : (activeScope === 'precipitated' ? store.archiveLoaded : store.archiveSessionLoaded)
  if (alreadyLoaded && !force && !cabinetIdOverride && !scopeOverride) return null
  patch({ archiveLoading: true, error: '' })
  try {
    const qs = new URLSearchParams()
    if (store.sessionId) qs.set('session', store.sessionId)
    qs.set('scope', activeScope)
    const cid = (activeScope === 'precipitated' || activeScope === 'global')
      ? ''
      : (cabinetIdOverride || store.archiveCabinetId || '')
    if (cid && cid !== 'cab-global') {
      qs.set('cabinetId', cid)
    }
    const value = await call('archives' + (qs.toString() ? '?' + qs.toString() : ''))
    if (value && value.ok) {
      applyArchiveHeaders(value, [], activeScope)
      const openIds = Object.keys(store.archiveOpenFiles || {}).filter(id => store.archiveOpenFiles[id] && !store.archiveDetails[id])
      for (const id of openIds) {
        void loadArchiveDetail(id, true, { scope: activeScope })
      }
    }
    return value
  } catch (error) {
    patch({ error: String((error && error.message) || error) })
    return null
  } finally {
    patch({ archiveLoading: false })
  }
}

/** Tier-2 Lazy Load: called ONLY when the user clicks a paperclipped dossier card to unfold its points */
export async function loadArchiveDetail(archiveId, force = false, opts = {}) {
  const id = String(archiveId || '').trim()
  if (!id) return null
  if (!force && store.archiveDetails && store.archiveDetails[id]) {
    return store.archiveDetails[id]
  }
  if (store.archiveDetailLoading && store.archiveDetailLoading[id]) return null
  patch({ archiveDetailLoading: { ...(store.archiveDetailLoading || {}), [id]: true } })
  try {
    const rawScope = (opts && (opts.scope || opts.vaultScope)) || store.archiveTabScope || 'session'
    const activeScope = rawScope === 'desktop' ? 'session' : rawScope
    const qs = new URLSearchParams({ id })
    if (store.sessionId) qs.set('session', store.sessionId)
    if (activeScope === 'global') qs.set('scope', 'global')
    if (store.archiveCabinetId && activeScope === 'session') qs.set('cabinetId', store.archiveCabinetId)
    if (opts && opts.precipitated) qs.set('precipitated', '1')
    const value = await call('archives/detail?' + qs.toString())
    if (value && value.ok && value.item) {
      patch({
        archiveDetails: {
          ...(store.archiveDetails || {}),
          [value.item.id]: value.item,
        },
      })
      return value.item
    }
    return null
  } catch (error) {
    patch({ error: String((error && error.message) || error) })
    return null
  } finally {
    const nextLoad = { ...(store.archiveDetailLoading || {}) }
    delete nextLoad[id]
    patch({ archiveDetailLoading: nextLoad })
  }
}

export async function mutateArchiveApi(payload, toastLabel = '') {
  try {
    const vaultScope = (payload && (payload.vaultScope || payload.scope))
      || (store.archiveTabScope === 'global' ? 'global' : 'session')
    const cabinetId = vaultScope === 'global'
      ? ''
      : ((payload && payload.cabinetId !== undefined) ? payload.cabinetId : (store.archiveCabinetId || ''))
    const value = await call('archives', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session: store.sessionId || sessionIdFromUrl(),
        vaultScope,
        cabinetId,
        ...payload,
      }),
    })
    if (value && value.ok) {
      if (payload.op === 'switchCabinet' || payload.op === 'createCabinet' || payload.op === 'deleteCabinet') {
        patch({ archiveDetails: {}, archiveOpenFolders: {}, archiveOpenFiles: {} })
      }
      if (value.item && value.item.id) {
        patch({
          archiveDetails: {
            ...(store.archiveDetails || {}),
            [value.item.id]: value.item,
          },
        })
      }
      if (payload.op === 'delete' && (payload.archiveId || payload.id)) {
        const delId = payload.archiveId || payload.id
        const nextOpen = { ...(store.archiveOpenFiles || {}) }
        const nextDet = { ...(store.archiveDetails || {}) }
        delete nextOpen[delId]
        delete nextDet[delId]
        patch({ archiveOpenFiles: nextOpen, archiveDetails: nextDet })
      }
      if (value.archives && typeof value.archives === 'object') {
        const targetScopeForHeaders = payload.op === 'pullPrecipitated'
          ? (payload.targetScope === 'global' ? 'global' : 'session')
          : (vaultScope === 'global' ? 'global' : 'session')
        applyArchiveHeaders({
          ...value.archives,
          ...(value.counts && typeof value.counts === 'object' ? { counts: value.counts } : {}),
          ...(Array.isArray(value.flippedPrecipitatedIds) ? { flippedPrecipitatedIds: value.flippedPrecipitatedIds } : {}),
          ...(Array.isArray(value.deskItems) ? { deskItems: value.deskItems } : {}),
        }, [], targetScopeForHeaders)
      }
      const extraPatch = {}
      if (value.board && typeof value.board === 'object') {
        extraPatch.board = value.board
      }
      if (value.archiveMeta && typeof value.archiveMeta === 'object') {
        extraPatch.archiveMeta = value.archiveMeta
      }
      if (value.diffSummary && typeof value.diffSummary === 'object') {
        extraPatch.archiveDiffSummary = value.diffSummary
      }
      if (value.counts && typeof value.counts === 'object') {
        extraPatch.archiveCounts = { ...(store.archiveCounts || {}), ...value.counts }
      }
      if (Array.isArray(value.deskItems)) {
        extraPatch.archiveDeskItems = value.deskItems
        extraPatch.archiveDeskLoaded = true
      }
      if (payload.op === 'copyToGlobal') {
        extraPatch.globalVaultLoaded = false
      } else if (payload.op === 'copyToSession') {
        extraPatch.archiveSessionLoaded = false
      } else if (payload.op === 'pullPrecipitated') {
        if (payload.targetScope === 'global') extraPatch.globalVaultLoaded = false
        else extraPatch.archiveSessionLoaded = false
      }
      if (payload.op === 'precipitateNotes') {
        const swept = Number(value.sweptCount || 0)
        if (swept > 0) {
          const opened = {}
          const folders = Array.isArray(value.savedFolders) && value.savedFolders.length
            ? value.savedFolders
            : ['inbox']
          for (const fId of folders) {
            if (fId) opened[fId] = true
          }
          extraPatch.archiveOpenFolders = { ...(store.archiveOpenFolders || {}), ...opened }
          extraPatch.notice = `已将 ${swept} 篇临时便签封存入本会话档案柜`
        } else {
          extraPatch.notice = '当前暂无可收纳的临时便签'
        }
      } else if (toastLabel) {
        extraPatch.notice = toastLabel
      }
      if (Object.keys(extraPatch).length) patch(extraPatch)
      if (payload.op === 'copyToGlobal' && store.archiveTabScope === 'global') {
        void loadArchives(true, '', 'global')
      } else if (payload.op === 'pullPrecipitated' && store.archiveTabScope === payload.targetScope) {
        void loadArchives(true, '', payload.targetScope)
      }
    }
    return value
  } catch (error) {
    patch({ error: String((error && error.message) || error) })
    return null
  }
}

export async function requestOrganizeArchives(opts = {}) {
  if (store.archiveOrganizing) return null
  const isDream = Boolean(opts.dream || opts.reasonKind === 'dream_roam')
  return await withChiefWorkFx(
    isDream
      ? { tone: 'dream', tab: 'archive', label: '🌙 参谋长正在梦境漫游 · 轻拢卷宗与织就钩子中...' }
      : { tone: 'archive', tab: 'archive', label: '参谋长正在整理档案中...' },
    async () => {
      patch({ archiveOrganizing: true, error: '' })
      try {
        const vaultScope = opts.vaultScope || (store.archiveTabScope === 'global' ? 'global' : 'session')
        const value = await call('archives/organize', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            session: store.sessionId || sessionIdFromUrl(),
            vaultScope,
            cabinetId: vaultScope === 'global' ? '' : (opts.cabinetId !== undefined ? opts.cabinetId : (store.archiveCabinetId || '')),
            ids: Array.isArray(opts.ids) ? opts.ids : [],
            folder: opts.folder || '',
            scope: opts.scope || store.archiveOrganizeScope || 'unorganized',
            instruction: opts.instruction !== undefined ? opts.instruction : (store.archiveOrganizePrompt || ''),
            ...(isDream ? { reasonKind: 'dream_roam' } : {}),
          }),
        })
        if (value && value.ok) {
          const openIds = Object.keys(store.archiveOpenFiles || {}).filter(k => store.archiveOpenFiles[k])
          const nextDetails = { ...(store.archiveDetails || {}) }
          for (const k of openIds) delete nextDetails[k]
          patch({
            archiveDetails: nextDetails,
            archiveOrganizeOpen: false,
            archiveOrganizePrompt: '',
            notice: value.updatedCount > 0
              ? `✦ 参谋长已按层次整理收纳 ${value.updatedCount} 份工程卷宗（原文 100% 无损保留）`
              : '✦ 当前卷宗已分门别类，无需重复拆整',
          })
          void loadArchives(true, '', vaultScope)
          for (const k of openIds) {
            void loadArchiveDetail(k, true, { scope: vaultScope })
          }
        }
        return value
      } catch (error) {
        patch({ error: String((error && error.message) || error) })
        return null
      } finally {
        patch({ archiveOrganizing: false })
      }
    },
  )
}

export async function harvestArchivesApi(focusHint = '', opts = {}) {
  if (store.archiveHarvesting) return null
  return await withChiefWorkFx(
    { tone: 'archive', tab: 'archive', label: '参谋长正在抢救归档中...' },
    async () => {
      patch({ archiveHarvesting: true, error: '' })
      try {
        const vaultScope = (opts && opts.vaultScope) || (store.archiveTabScope === 'global' ? 'global' : 'session')
        const value = await call('archives/harvest', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            session: store.sessionId || sessionIdFromUrl(),
            vaultScope,
            cabinetId: (opts && opts.cabinetId !== undefined) ? opts.cabinetId : (store.archiveCabinetId || ''),
            focusHint,
          }),
        })
        if (value && value.ok) {
          patch({
            notice: value.count > 0
              ? `📥 已抢救 ${value.count} 份本轮对话工程细节入柜（防压缩失忆）`
              : '📥 当前对话暂无新增重要工程细节',
          })
          void loadArchives(true)
        }
        return value
      } catch (error) {
        patch({ error: String((error && error.message) || error) })
        return null
      } finally {
        patch({ archiveHarvesting: false })
      }
    },
  )
}

export async function precipitateArchivesApi(opts = {}) {
  if (store.archivePrecipitating) return null
  return await withChiefWorkFx(
    { tone: 'archive', tab: 'archive', label: '参谋长正在沉淀经验入库中...' },
    async () => {
      patch({ archivePrecipitating: true, error: '' })
      try {
        const vaultScope = opts.vaultScope || 'global'
        const value = await call('archives/precipitate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            session: store.sessionId || sessionIdFromUrl(),
            vaultScope,
            op: opts.op || 'cabinet',
            cabinetId: '',
            folder: opts.folder || '',
            ...(Array.isArray(opts.ids) && opts.ids.length > 0 ? { ids: opts.ids } : {}),
            clearSource: Boolean(opts.clearSource),
          }),
        })
        if (value && value.ok) {
          patch({
            precipitateModal: null,
            notice: value.count > 0
              ? `⏬ 已提炼 ${value.count} 条可复用经验封入冷库（默认 0 Token 隔离）`
              : '⏬ 当前卷宗暂无更多可沉淀经验',
          })
          void loadArchives(true, '', vaultScope)
        }
        return value
      } catch (error) {
        patch({ error: String((error && error.message) || error) })
        return null
      } finally {
        patch({ archivePrecipitating: false })
      }
    },
  )
}

export function toggleSelectArchive(id, vaultScope = 'session', title = '') {
  const aid = String(id || '').trim()
  if (!aid) return
  const vs = vaultScope === 'global' ? 'global' : (vaultScope === 'precipitated' ? 'precipitated' : 'session')
  const key = vs + ':' + aid
  const prev = { ...(store.selectedArchiveMap || {}) }
  if (prev[key]) delete prev[key]
  else prev[key] = { id: aid, vaultScope: vs, title: String(title || aid) }
  patch({ selectedArchiveMap: prev })
}

export function clearSelectedArchives() {
  patch({ selectedArchiveMap: {} })
}

export function openArchiveRelayModal(items) {
  const list = Array.isArray(items) ? items.filter(x => x && x.id) : []
  if (!list.length) return
  patch({
    archiveRelayModal: {
      items: list.map(x => ({
        id: String(x.id),
        vaultScope: x.vaultScope === 'global' ? 'global' : (x.vaultScope === 'precipitated' ? 'precipitated' : 'session'),
        title: String(x.title || x.id),
      })),
      instruction: '',
      target: 'lead',
      mode: 'followup',
    },
  })
}

export async function relayArchivesWithChiefApi(modalState) {
  if (store.relayArchivesBusy) return null
  const items = Array.isArray(modalState && modalState.items) ? modalState.items : []
  if (!items.length) return null
  return await withChiefWorkFx(
    { tone: 'archive', tab: 'archive', label: '参谋长正在整合递交档案中...' },
    async () => {
      patch({ relayArchivesBusy: true, error: '' })
      try {
        const value = await call('chief/relay-archives', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            session: store.sessionId || sessionIdFromUrl(),
            cabinetId: store.archiveCabinetId || '',
            items: items.map(it => ({
              id: it.id,
              scope: it.vaultScope || it.scope || 'session',
              vaultScope: it.vaultScope || it.scope || 'session',
              title: it.title || it.id,
            })),
            instruction: String((modalState && modalState.instruction) || '').trim(),
            target: (modalState && modalState.target) || 'lead',
            mode: (modalState && modalState.mode) || 'followup',
          }),
        })
        if (value && value.ok) {
          patch({
            archiveRelayModal: null,
            selectedArchiveMap: {},
            notice: `📨 参谋长已带要求整合 ${items.length} 条档案并递交给 @${modalState.target === 'lead' || !modalState.target ? '主对话' : shortAgentName(modalState.target, true)}`,
          })
          void refresh()
        }
        return value
      } catch (error) {
        patch({ error: String((error && error.message) || error) })
        return null
      } finally {
        patch({ relayArchivesBusy: false })
      }
    },
  )
}

export async function distillToGlobalApi(modalState) {
  if (store.distillBusy) return null
  return await withChiefWorkFx(
    { tone: 'archive', tab: 'archive', label: '参谋长正在提炼全局档案中...' },
    async () => {
      patch({ distillBusy: true, error: '' })
      try {
        const ids = Array.isArray(modalState && modalState.ids) && modalState.ids.length > 0
          ? modalState.ids
          : null
        const value = await call('archives/distill-to-global', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            session: store.sessionId || sessionIdFromUrl(),
            cabinetId: store.archiveCabinetId || '',
            ids,
            clearSource: Boolean(modalState && modalState.clearSource),
            instruction: String((modalState && modalState.instruction) || '').trim(),
          }),
        })
        if (value && value.ok) {
          const nextPatch = {
            distillGlobalModal: null,
            selectedArchiveMap: {},
            globalVaultLoaded: false,
            notice: value.createdCount > 0
              ? `✦ 已从本局提炼 ${value.createdCount} 份可复用工程档案存入「🌐 全局档案柜」`
              : '✦ 当前本局暂无更多待提炼的新增可复用经验',
          }
          if (value.globalArchives && Array.isArray(value.globalArchives.items)) {
            nextPatch.globalVaultItems = value.globalArchives.items
            nextPatch.globalVaultLoaded = true
          }
          if (Array.isArray(value.deskItems)) {
            nextPatch.archiveDeskItems = value.deskItems
            nextPatch.archiveDeskLoaded = true
          }
          patch(nextPatch)
          if (ids && modalState && modalState.clearSource) void loadArchives(true, '', 'session')
        }
        return value
      } catch (error) {
        patch({ error: String((error && error.message) || error) })
        return null
      } finally {
        patch({ distillBusy: false })
      }
    },
  )
}

export async function approveGoalApi() {
  const value = await act({ action: 'goal.approve' })
  if (value && value.ok) patch({ notice: '✅ 已批准目标结项并切换回标准计划模式' })
  return value
}

export async function rejectGoalApi(reason) {
  const text = String(reason || '').trim()
  if (!text) {
    patch({ error: '请简短说明驳回原因与补充要求' })
    return null
  }
  const value = await act({ action: 'goal.reject', reason: text })
  if (value && value.ok) patch({ notice: '↩ 已驳回结项，目标督导将继续推进' })
  return value
}

export async function deliverArchiveToChat(headerOrDetail, point = null) {
  let detail = headerOrDetail
  if (!point && (!detail || !Array.isArray(detail.points))) {
    const loaded = await loadArchiveDetail(headerOrDetail && headerOrDetail.id)
    if (loaded) detail = loaded
  }
  if (!detail) return
  const lines = []
  if (point) {
    lines.push(`📎 调阅工程档案《${detail.title}》→ 记忆点「${point.title}」：`)
    lines.push(point.detail || point.cue || point.title)
  } else {
    lines.push(`📎 调阅工程档案《${detail.title}》：`)
    if (detail.summary) lines.push(`提要：${detail.summary}`)
    const pts = Array.isArray(detail.points) ? detail.points : []
    if (pts.length) {
      pts.slice(0, 8).forEach((p, idx) => {
        lines.push(`${idx + 1}. 【${p.title}】${p.detail || p.cue || ''}`)
      })
    } else if (detail.body) {
      lines.push(detail.body.slice(0, 1500))
    }
  }
  await askLeadModel(lines.join('\n'), '调阅工程档案')
}

export async function searchColdArchives(queryText) {
  const q = String(queryText || '').trim()
  if (!q || store.archiveSearchBusy) return
  patch({ archiveSearchBusy: true })
  try {
    const qs = new URLSearchParams({ q })
    const sid = store.sessionId || sessionIdFromUrl()
    if (sid) qs.set('session', sid)
    if (store.archiveTabScope === 'global') qs.set('scope', 'global')
    const value = await call('archives?' + qs.toString())
    if (value && value.ok && Array.isArray(value.items)) {
      const folderMap = new Map((value.folders || []).map(f => [f.id, f.label]))
      const archHits = value.items.slice(0, 12).map(it => ({
        kind: '封存档案',
        tab: 'archive',
        folderId: it.folder,
        archiveId: it.id,
        id: it.id,
        title: `${it.paperclip === 'gold' ? '📎 ' : ''}${it.title}`,
        snippet: `[${folderMap.get(it.folder) || it.folder}] ${it.summary || ''}`,
      }))
      const localHits = searchBoard(q).filter(hItem => hItem.tab !== 'archive')
      patch({
        askHits: [...archHits, ...localHits],
        notice: archHits.length ? `已在封存档案柜检出 ${archHits.length} 卷匹配记录` : '封存档案柜中未检出匹配卷宗',
      })
    }
  } catch (error) {
    patch({ error: String((error && error.message) || error) })
  } finally {
    patch({ archiveSearchBusy: false })
  }
}

export async function refresh() {
  const fromUrl = sessionIdFromUrl()
  if (!store.sessionId && fromUrl) {
    patch({ sessionId: fromUrl })
  }
  try {
    await call('snapshot' + (store.sessionId ? '?session=' + encodeURIComponent(store.sessionId) : ''))
    const panelActive = Boolean(store.dock || store.panel === SIDE_ID || store.open)
    if (panelActive && (!store.secView || store.tab === 'chief' || store.tab === 'peers' || (store.chiefMeta && store.chiefMeta.pendingSuggestions > 0))) {
      void loadChiefView(false)
    }
    if (store.error) patch({ error: '' })
  } catch (error) {
    patch({ error: String((error && error.message) || error) })
  }
}

export async function act(action) {
  patch({ busy: true, error: '' })
  try {
    const effSession = (action && action.session !== undefined)
      ? action.session
      : (store.sessionId || sessionIdFromUrl())
    const result = await call('action', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...action, session: effSession, by: (action && action.by) || 'user' }),
    })
    let notice = truncationNotice(result)
    if (!notice && result && result.dispatched) {
      notice = '已派发 @' + result.dispatched.agent
    } else if (!notice && result && result.interrupted) {
      notice = '已停止 @' + result.interrupted
    } else if (!notice && result && result.messageId && result.agent) {
      notice = '已发送给 @' + result.agent
    }
    if (notice) patch({ notice })
    return result
  } catch (error) {
    const msg = String((error && error.message) || error)
    if (/unknown action:/i.test(msg)) {
      patch({
        staleBackendDetected: true,
        staleBackendDismissed: false,
        error: '检测到客户端内存仍驻留旧版参谋部后端（尚未加载新动作），请完整关闭并重新打开 DeepSeek Harness 客户端即可生效。',
      })
    } else {
      patch({ error: msg })
    }
    return null
  } finally {
    patch({ busy: false })
  }
}

export async function loadTargets() {
  try {
    const value = await call('sessions' + (store.sessionId ? '?session=' + encodeURIComponent(store.sessionId) : ''))
    patch({
      targets: (value && Array.isArray(value.sessions)) ? value.sessions : [],
      pending: (value && value.pending) || null,
      autoInject: !!(value && value.autoInject),
      guardIdle: !(value && value.guardIdle === false),
      guardMaxPerSession: Number.isFinite(Number(value && value.guardMaxPerSession))
        ? Number(value.guardMaxPerSession)
        : 3,
      guardShortAnswer: Number.isFinite(Number(value && value.guardShortAnswer))
        ? Number(value.guardShortAnswer)
        : 600,
    })
  } catch (error) {
    patch({ error: String((error && error.message) || error) })
  }
}

export async function loadHandoff() {
  patch({ handoffBusy: true, error: '' })
  try {
    const value = await call('handoff' + (store.sessionId ? '?session=' + encodeURIComponent(store.sessionId) : ''))
    const text = value && value.text ? value.text : ''
    const nextMeta = {
      source: (value && value.source) || 'auto',
      isCustom: Boolean(value && value.isCustom),
      pinned: Boolean(value && value.pinned),
      syncOnDigest: Boolean(value && value.syncOnDigest),
      isIncomplete: Boolean(value && value.isIncomplete),
      isStale: Boolean(value && value.isStale),
      hasNarrativeUpdate: Boolean(value && value.hasNarrativeUpdate),
      autoText: (value && value.autoText) || '',
      updatedAt: Number(value && (value.updatedAt || value.handoffAt)) || 0,
    }
    patch({
      handoffText: text,
      handoffMeta: nextMeta,
      ...(store.handoffEditing ? {} : { handoffDraft: text }),
    })
    return value || { ok: true, text, ...nextMeta }
  } catch (error) {
    patch({ error: String((error && error.message) || error) })
    return null
  } finally {
    patch({ handoffBusy: false })
  }
}

export async function saveHandoffCustom(text, pinAfter = false) {
  const cleanText = String(text || '')
  const res = await act({ action: 'handoff.save', text: cleanText, source: 'human', by: 'user' })
  if (res && res.ok) {
    if (pinAfter) {
      await act({ action: 'handoff.pin', pinned: true, by: 'user' })
    }
    patch({ handoffEditing: false, notice: pinAfter ? '✏️ 已保存交接单并定住防改' : '✏️ 已保存手动交接单' })
    await loadHandoff()
  }
  return res
}

export async function toggleHandoffPin(nextPinned, snapshotOverride = '') {
  let snapshotText = String(
    snapshotOverride
    || store.handoffText
    || (store.handoffMeta && store.handoffMeta.autoText)
    || '',
  )
  if (nextPinned && !snapshotText) {
    const loaded = await loadHandoff()
    snapshotText = String((loaded && loaded.text) || store.handoffText || '')
  }
  const res = await act({
    action: 'handoff.pin',
    pinned: Boolean(nextPinned),
    ...(nextPinned && snapshotText ? { snapshotText } : {}),
    by: 'user',
  })
  if (res && res.ok) {
    patch({ notice: nextPinned ? '📌 已定住交接单（已固化当前快照，参谋长不可自动覆写）' : '🔓 已解除交接单定住锁定' })
    await loadHandoff()
  }
  return res
}

export async function resetHandoffAuto() {
  const res = await act({ action: 'handoff.reset', by: 'user' })
  if (res && res.ok) {
    patch({ handoffEditing: false, notice: '↺ 已恢复为系统实时自动生成交接单' })
    await loadHandoff()
  }
  return res
}

export async function toggleSyncHandoffOnDigest(enabled) {
  if (store.board && store.board.handoff && store.board.handoff.pinned) {
    patch({ notice: '🔒 交接单已被人类定住，需先解除定住才能开启自动同步' })
    return null
  }
  const res = await act({ action: 'handoff.setSyncOnDigest', enabled: Boolean(enabled), by: 'user' })
  if (res && res.ok) {
    patch({ notice: enabled ? '✦ 提炼摘要后将自动同步至交接单' : '已关闭摘要同步交接单（仅手工更新）' })
    await loadHandoff()
  }
  return res
}

export async function requestTransferWithGuard(target, opts = {}) {
  const info = await loadHandoff()
  const hMeta = (info && typeof info === 'object') ? info : (store.handoffMeta || {})
  const pinned = Boolean(hMeta.pinned || (store.board && store.board.handoff && store.board.handoff.pinned))
  const staleOrIncomplete = !pinned && Boolean(hMeta.isIncomplete || hMeta.isStale || hMeta.hasNarrativeUpdate)
  if (staleOrIncomplete) {
    const reason = hMeta.isIncomplete
      ? '当前交接单内容尚不完整（缺少目标、步骤或最新参谋摘要），直接交接会打乱新对话的上下文衔接。'
      : '参谋长已更新最新态势摘要，但当前交接单尚未同步更新；直接交接可能让新窗口读到过期进度，建议先等参谋长刷新交接单。'
    patch({
      handoffWarnModal: {
        target,
        opts,
        reason,
        isIncomplete: Boolean(hMeta.isIncomplete),
      },
    })
    return null
  }
  return transfer(target, opts)
}

export async function transfer(target, opts = {}) {
  patch({ transferNote: '投递中…', error: '' })
  try {
    const value = await call('transfer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        target,
        session: store.sessionId,
        by: 'user',
        deployChief: opts.deployChief !== false,
        archiveTransferPolicy: opts.archiveTransferPolicy || store.deployArchivePolicy || 'none',
        ...(opts.archiveDrawer || store.deployDrawer ? { archiveDrawer: opts.archiveDrawer || store.deployDrawer } : {}),
        ...(opts.toCabinetId ? { toCabinetId: opts.toCabinetId } : {}),
        ...(opts.customNote ? { customNote: opts.customNote } : {}),
      }),
    })
    const created = value && value.mode === 'created' && value.sessionId ? String(value.sessionId) : ''
    let note = '已放入待领取队列（含参谋预部署）'
    if (value && value.mode === 'injected') note = '已投递至目标会话并部署参谋'
    if (created) {
      patch({ transferred: true })
      setTimeout(() => patch({ transferred: false }), 2000)
      note = '已创建新会话 ' + shortSession(created) + ' 并部署参谋'
      const sessionsSvc = service('sessions') || (runtimeRefs.navigation && runtimeRefs.navigation.sessions) || null
      if (sessionsSvc && typeof sessionsSvc.open === 'function') {
        try {
          sessionsSvc.open(created)
        } catch {}
      } else if (runtimeRefs.navigation && typeof runtimeRefs.navigation.openSession === 'function') {
        try {
          runtimeRefs.navigation.openSession(created)
        } catch {}
      }
    }
    patch({
      transferNote: note,
      notice: note,
      handoffText: value && value.text ? value.text : store.handoffText,
    })
    void loadTargets()
    return value
  } catch (error) {
    patch({ transferNote: '失败：' + String((error && error.message) || error) })
    return null
  }
}

export async function loadMemory() {
  patch({ memBusy: true, error: '' })
  try {
    const value = await call('memory' + (store.sessionId ? '?session=' + encodeURIComponent(store.sessionId) : ''))
    patch({
      memSections: (value && Array.isArray(value.sections)) ? value.sections : [],
      memCount: Number(value && value.count) || 0,
      memDigest: (value && value.digest) || '',
    })
  } catch (error) {
    patch({ error: String((error && error.message) || error) })
  } finally {
    patch({ memBusy: false })
  }
}

export async function askMemory(question) {
  const text = String(question || '').trim()
  if (!text) return
  patch({ memBusy: true, memNote: '' })
  try {
    const value = await call('action', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'memory.ask', question: text, session: store.sessionId, by: 'user' }),
    })
    patch({
      memReply: (value && value.reply) || '',
      memHits: (value && value.hits) || [],
      memNote: value && value.terms && value.terms.length ? value.terms.join(' · ') : '',
    })
  } catch (error) {
    patch({ memNote: String((error && error.message) || error) })
  } finally {
    patch({ memBusy: false })
  }
}

export async function addMemory() {
  const text = store.memText.trim()
  const title = store.memTitle.trim()
  const section = store.memSection
  if (!text) return
  patch({ memText: '', memTitle: '', memComposerOpen: false, notice: '已记入记忆' })
  await act({ action: 'memory.add', text, title, section })
  void loadMemory()
}

export async function removeMemory(id) {
  await act({ action: 'memory.remove', id })
  void loadMemory()
}

export function searchBoard(term) {
  const needle = String(term || '').trim().toLowerCase()
  if (!needle) return []
  const board = store.board || {}
  const sec = store.secView || {}
  const hits = []
  const hit = text => String(text || '').toLowerCase().includes(needle)
  for (const fact of sec.facts || []) {
    if (hit(fact.text)) {
      hits.push({ kind: '纪律/记忆', tab: 'chief', subTab: 'facts', id: fact.id, title: FACT_CAT_LABEL[fact.category] || '记忆条目', snippet: snippetOf(fact.text, needle, 36) })
    }
  }
  for (const task of board.tasks || []) {
    if (hit(task.title) || hit(task.note) || hit(task.intent) || hit(task.evidence)) {
      hits.push({ kind: '任务', tab: 'tasks', id: task.id, title: task.title, snippet: snippetOf(task.note || task.evidence || task.title, needle, 34) })
    }
  }
  for (const mail of sec.mailbox || []) {
    if (hit(mail.text) || hit(mail.subject) || hit(mail.from) || hit(mail.to)) {
      hits.push({ kind: '协同信箱', tab: 'peers', id: mail.id, title: (mail.from || '参谋长') + ' → ' + (mail.to || '成员'), snippet: snippetOf(mail.text, needle, 34) })
    }
  }
  for (const note of board.notes || []) {
    if (hit(note.title) || hit(note.body) || (note.tags || []).some(hit)) {
      hits.push({ kind: '临时便签', tab: 'archive', id: note.id, title: note.title || '无标题', snippet: snippetOf(note.body || note.title, needle, 36) })
    }
  }
  if (store.archiveLoaded && Array.isArray(store.archiveItems)) {
    for (const arch of store.archiveItems) {
      if (hit(arch.title) || hit(arch.summary) || (arch.tags || []).some(hit) || (arch.pointPreviews || []).some(hit)) {
        hits.push({
          kind: '工程档案',
          tab: 'archive',
          folderId: arch.folder,
          archiveId: arch.id,
          id: arch.id,
          title: (arch.paperclip === 'gold' ? '📎 ' : '') + (arch.title || '无标题'),
          snippet: snippetOf(arch.summary || (arch.pointPreviews || []).join(' · '), needle, 36),
        })
      }
    }
  }
  for (const step of board.plan || []) {
    if (hit(step.text)) hits.push({ kind: '规划', tab: 'plan', id: step.id, title: step.text, snippet: '' })
  }
  if (hit(board.objective)) hits.push({ kind: '目标', tab: 'plan', id: 'objective', title: '当前目标', snippet: snippetOf(board.objective, needle, 36) })
  for (const item of board.memory || []) {
    if (hit(item.title) || hit(item.text)) {
      hits.push({ kind: '回合记录', tab: 'chief', subTab: 'facts', showRawTurns: true, id: item.id, title: item.title || SECTION_LABEL[item.section] || '记忆', snippet: snippetOf(item.text || item.title, needle, 36) })
    }
  }
  return hits
}

export function sendToComposer(text) {
  const actions = store.inputActions
  if (!actions || typeof actions !== 'object') return null
  const setters = ['setDraft', 'setText', 'replaceText', 'updateText', 'appendText', 'insertText']
  for (const name of setters) {
    const fn = actions[name]
    if (typeof fn !== 'function') continue
    try {
      if (fn(text) === false) continue
    } catch {
      continue
    }
    const submit = typeof actions.submit === 'function' ? actions.submit : (typeof actions.send === 'function' ? actions.send : null)
    if (submit) {
      try {
        submit()
        return '已发送至对话'
      } catch {}
    }
    return '已填入输入框'
  }
  return null
}

export async function askLeadModel(promptText, subject = '步骤咨询') {
  const clean = String(promptText || '').trim()
  if (!clean) return
  const sent = sendToComposer(clean)
  if (sent) {
    patch({ notice: sent + ' · 等待模型解答' })
    return
  }
  try {
    await call('chief/relay', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session: store.sessionId,
        by: '用户咨询',
        target: 'lead',
        subject,
        text: clean,
        mode: 'followup',
      }),
    })
    patch({ notice: '已发送给主对话模型解答' })
  } catch (error) {
    copyText(clean, '问题已复制，可粘贴到对话框提问')
  }
}

export function copyText(text, label = '已复制') {
  if (!text) return
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(String(text)).then(
        () => patch({ copied: true, notice: label }),
        () => {},
      )
      setTimeout(() => patch({ copied: false }), 1400)
    }
  } catch {}
}

/* ----------------------------------------------------------- Icons (SVG) */

export async function addBoundRule(field, item, pinned = false) {
  const res = await act({ action: 'bounds.add', field, item, pinned: Boolean(pinned) })
  if (!res || store.error) return
  patch({
    boundDraft: { ...store.boundDraft, [field]: '' },
    notice: pinned ? '📌 已添加并定住为全局共享边界' : '已添加至当前任务边界（点击前方的图钉可定住全局）',
  })
}

export async function toggleBoundPin(field, item, nextPinned) {
  const res = await act({ action: 'bounds.pin', field, item, pinned: Boolean(nextPinned) })
  if (!res || store.error) return
  patch({
    notice: nextPinned
      ? '📌 已盖上小图钉 · 定住为跨任务全局共享边界'
      : '已取下小图钉 · 改为仅当前任务生效',
  })
}

export async function removeBoundRule(field, item) {
  const nextSel = { ...(store.boundSelected || { allowed: [], forbidden: [], notes: [] }) }
  if (Array.isArray(nextSel[field])) {
    nextSel[field] = nextSel[field].filter(x => x !== item)
    patch({ boundSelected: nextSel })
  }
  await act({ action: 'bounds.remove', field, item })
}

export async function editBoundRule(field, oldItem, nextItem) {
  const trimmed = String(nextItem || '').trim()
  if (!trimmed || trimmed === oldItem) return
  const res = await act({ action: 'bounds.edit', field, oldItem, item: trimmed })
  if (res && !store.error) patch({ notice: '已更新边界条文' })
}

export function toggleBoundSelect(field, item) {
  const curMap = store.boundSelected || { allowed: [], forbidden: [], notes: [] }
  const cur = Array.isArray(curMap[field]) ? curMap[field] : []
  const next = cur.includes(item) ? cur.filter(x => x !== item) : cur.concat(item)
  patch({ boundSelected: { ...curMap, [field]: next } })
}

export async function saveGuardWallApi({ title, ruleType = 'forbid_cmd', pattern = '', patterns = null, scope = 'global', reason = '', writeOnly = false }) {
  const cleanTitle = String(title || '').trim()
  const cleanPattern = String(pattern || '').trim()
  const patList = Array.isArray(patterns) && patterns.length > 0
    ? patterns
    : (cleanPattern ? cleanPattern.split(/[\r\n,;，；]+/).map(s => s.trim()).filter(Boolean) : [])
  if (!cleanTitle || !patList.length) {
    patch({ error: '物理驻墙需要填写规则名称与至少 1 条匹配规则' })
    return null
  }
  const res = await act({
    action: 'wall.save',
    wall: {
      title: cleanTitle,
      ruleType,
      patterns: patList,
      scope,
      reason: String(reason || '').trim(),
      writeOnly: Boolean(writeOnly),
      source: 'manual',
    },
  })
  if (res && res.ok) {
    patch({
      wallFormOpen: false,
      wallDraftTitle: '',
      wallDraftPattern: '',
      notice: `🧱 已落锁物理驻墙「${cleanTitle}」（${scope === 'workspace' ? '仅本工程' : '🌐 全局随身'}）`,
    })
  }
  return res
}

export async function setGuardWallScopeApi(wallId, scope) {
  if (!wallId || !scope) return null
  const res = await act({ action: 'wall.setScope', wallId, scope })
  if (res && res.ok) {
    const labelMap = { global: '🌐 全局随身', workspace: '📁 仅本工程', paused: '⏸ 暂挂停用' }
    patch({ notice: `🧱 已切换物理墙作用域 → ${labelMap[scope] || scope}` })
  }
  return res
}

export async function removeGuardWallApi(wallId) {
  if (!wallId) return null
  const res = await act({ action: 'wall.remove', wallId })
  if (res && res.ok) {
    const curSel = Array.isArray(store.wallSelectedIds) ? store.wallSelectedIds : []
    patch({
      wallSelectedIds: curSel.filter(id => id !== wallId),
      wallMergeError: '',
      notice: '🧱 已拆除该条物理驻墙',
    })
  }
  return res
}

export function toggleGuardWallSelect(wallId) {
  const id = String(wallId || '').trim()
  if (!id) return
  const prev = Array.isArray(store.wallSelectedIds) ? store.wallSelectedIds : []
  const next = prev.includes(id) ? prev.filter(x => x !== id) : prev.concat(id)
  patch({ wallSelectedIds: next, wallMergeError: '', error: '' })
}

export async function mergeGuardWallsApi({ wallIds = [], autoGroup = false } = {}) {
  const walls = Array.isArray(store.guardWalls) ? store.guardWalls : []
  if (!autoGroup) {
    const cleanIds = [...new Set((Array.isArray(wallIds) ? wallIds : []).filter(id => walls.some(w => w && w.id === id)))]
    if (cleanIds.length < 2) {
      const msg = '请至少勾选 2 条相同类型的物理驻墙后再合并'
      patch({ wallMergeError: msg, error: msg })
      return { ok: false, code: 'MERGE_MIN_TWO', error: msg }
    }
    const picked = walls.filter(w => cleanIds.includes(w.id))
    const ruleTypes = new Set(picked.map(w => w.ruleType))
    if (ruleTypes.size > 1) {
      const msg = '⛔ 禁止跨类型合并物理驻墙：仅允许相同拦截类型的物理驻墙合并（如「禁碰路径」只能与「禁碰路径」合并），请取消异类勾选！'
      patch({ wallMergeError: msg, error: msg })
      return { ok: false, code: 'CROSS_TYPE_MERGE_FORBIDDEN', error: msg }
    }
  }
  patch({ wallMergeError: '', error: '' })
  return await withChiefWorkFx(
    { tone: 'wall', tab: 'boundaries', boundSubTab: 'rules', label: '参谋长正在合并同类驻墙中...', minMs: 520 },
    async () => {
      const res = await act({
        action: 'wall.merge',
        wallIds: Array.isArray(wallIds) ? wallIds : [],
        autoGroup: Boolean(autoGroup),
      })
      if (!res || !res.ok) {
        const msg = (res && res.error) || store.error || '合并物理驻墙失败'
        patch({ wallMergeError: msg, error: msg })
        return res || { ok: false, error: msg }
      }
      patch({
        wallSelectedIds: [],
        wallMergeError: '',
        notice: `🧱 已将 ${res.mergedCount || 2} 条同类物理驻墙合并为 ${res.createdCount || 1} 条`,
      })
      return res
    },
  )
}

export function openTaskEditor(task) {
  if (!task) return
  patch({
    selectedTaskId: task.id,
    editTaskId: task.id,
    editTaskTitle: task.title || '',
    editTaskNote: task.note || '',
    editTaskIntent: task.intent || '',
    editTaskEvidence: task.evidence || '',
    editTaskParentId: task.parentId || '',
    editTaskBlockedBy: Array.isArray(task.blockedBy) ? [...task.blockedBy] : [],
  })
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
          memSections: [],
          memCount: 0,
          memDigest: '',
          memReply: '',
          memHits: null,
          memOpen: '',
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
