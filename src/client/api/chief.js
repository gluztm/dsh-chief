/**
 * src/client/api/chief.js — 参谋长视图、模型目录、协同水泡联动、审批/提权与许愿盒对话 API
 *
 * 【核心职责】
 *   承载 `loadChiefView` / `loadChiefModels` / `updateSecConfig` / 场景预设一键套用、
 *   操作审批（`decideApproval`）与权限提权（`decideElevation`）、
 *   协同水泡加退队/外协调用/锁死急停/待命池刷新扫描（`refreshBubbleDiscovery`）、
 *   以及建议条采纳、红线合并、图片附件摄入与底部许愿盒提交（`submitChiefBar`）。
 *
 * 【边界约定】
 *   - 处于 `src/client/api/*` 业务上层，单向依赖 `transport.js`、`board.js` 与 `archives.js`。
 */

import { CHIEF_PERMISSION_LABELS, SEC_IMAGE_MIMES, SEC_MAX_IMAGES } from '../constants.js'
import { store, patch, runtimeRefs } from '../store.js'
import { clampTitle, shortSession, fullModelWithChannel, encodeImageForChief } from '../utils.js'
import { bi } from '../i18n.js'
import { apiBridge, call, applySecView, classifyChiefWorkFx, resolveChiefSuggestionWorkFx, withChiefWorkFx } from './transport.js'
import { refresh, loadHandoff } from './board.js'
import { loadArchives } from './archives.js'

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
        patch({ notice: '✦ 摘要已更新，并同步到了交接单' })
        void loadHandoff()
      } else if (value.handoffSyncResult.skipped === 'pinned-by-human') {
        patch({ notice: regenerate ? '摘要已更新（交接单已定住防改，没有覆盖）' : '交接单已定住防改，跳过同步' })
      } else if (regenerate) {
        patch({ notice: '摘要已更新' })
      }
    } else if (regenerate) {
      patch({ notice: '摘要已更新' })
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
    if (nextCfg && typeof nextCfg.uiLang === 'string') {
      const normLang = setRuntimeUiLang(nextCfg.uiLang)
      patch({
        uiLangPref: normLang,
        chiefMeta: { ...store.chiefMeta, uiLang: normLang },
      })
    }
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
      patch({ error: (value && value.error) || '保存设置失败' })
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
    const resolvedSessionEnabled = (value.config && typeof value.config.sessionEnabled === 'boolean')
      ? value.config.sessionEnabled
      : ((value.view && value.view.config && typeof value.view.config.sessionEnabled === 'boolean')
          ? value.view.config.sessionEnabled
          : null)
    const resolvedDefaultAutoEnable = (value.config && typeof value.config.defaultAutoEnableSessions === 'boolean')
      ? value.config.defaultAutoEnableSessions
      : ((value.view && value.view.config && typeof value.view.config.defaultAutoEnableSessions === 'boolean')
          ? value.view.config.defaultAutoEnableSessions
          : null)
    const resolvedRunMode = (value.config && typeof value.config.runMode === 'string')
      ? value.config.runMode
      : ((value.view && value.view.config && typeof value.view.config.runMode === 'string')
          ? value.view.config.runMode
          : null)
    const resolvedPaceMode = (value.config && typeof value.config.paceMode === 'string')
      ? value.config.paceMode
      : ((value.view && value.view.config && typeof value.view.config.paceMode === 'string')
          ? value.view.config.paceMode
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
      ...((resolvedLocks || resolvedTeamEffortMode || resolvedSessionEnabled !== null || resolvedDefaultAutoEnable !== null || resolvedRunMode !== null || resolvedPaceMode !== null)
        ? {
            chiefMeta: {
              ...store.chiefMeta,
              ...(resolvedLocks ? { lockedModelEfforts: resolvedLocks } : {}),
              ...(resolvedTeamEffortMode ? { teamEffortMode: resolvedTeamEffortMode === 'manual' ? 'manual' : 'auto' } : {}),
              ...(resolvedSessionEnabled !== null ? { sessionEnabled: resolvedSessionEnabled } : {}),
              ...(resolvedDefaultAutoEnable !== null ? { defaultAutoEnableSessions: resolvedDefaultAutoEnable } : {}),
              ...(resolvedRunMode !== null ? { runMode: resolvedRunMode } : {}),
              ...(resolvedPaceMode !== null ? { paceMode: resolvedPaceMode, stopped: resolvedPaceMode === 'stopped' } : {}),
            },
          }
        : {}),
      ...(updatedSubagents ? { subagents: updatedSubagents } : {}),
    })
    if (resolvedLocks) void refresh()
    if (nextCfg.ackHazardAlertId) {
      // Quietly acknowledged; no intrusive toast needed
    } else if (nextCfg.emergencyStopIntervention) {
      patch({ notice: '⏹ 已急停：强介入和自动续跑都已停下' })
    } else if (typeof nextCfg.permissionMode === 'string') {
      const savedPerm = (value.config && value.config.permissionMode)
        || (value.view && value.view.config && value.view.config.permissionMode)
        || ''
      if (savedPerm && savedPerm !== nextCfg.permissionMode) {
        patch({
          staleBackendDetected: true,
          staleBackendDismissed: false,
          error: '权限设置没生效，后台还在跑旧版本。请重启一下 DeepSeek Harness 客户端。',
        })
        return null
      }
      const permMap = {
        advisor: '已切到 L0 · 顾问模式：只看不改，只在需要时提建议',
        assistant: '已切到 L1 · 助手模式：可整理记忆和档案，不改你的项目文件',
        strategist: '已切到 L2 · 参谋模式：改文件或发消息前都会先弹窗问你',
        chief: '已开启 L3 · 参谋长模式：可自主调度和改文件，仍受安全规则限制',
      }
      patch({ notice: permMap[nextCfg.permissionMode] || '已更新权限设置' })
    } else if (nextCfg.tacticalModes && typeof nextCfg.tacticalModes === 'object') {
      if (value.compactLowWarning) {
        patch({ notice: '⚠️ ' + value.compactLowWarning })
      } else if (normalizeMaxTurnsVal(nextCfg.tacticalModes.maxInterventionTurns) === 0 && Object.prototype.hasOwnProperty.call(nextCfg.tacticalModes, 'maxInterventionTurns') && !nextCfg.confirmedInterventionRisk) {
        patch({ notice: '♾️ 已开启不限轮数：只要任务没完，参谋长就会一直催着继续' })
      } else if (typeof nextCfg.tacticalModes.intervention === 'boolean' && nextCfg.confirmedInterventionRisk) {
        const ko = value.immediateKickoff
        patch({
          notice: nextCfg.tacticalModes.intervention
            ? (ko && ko.triggered
                ? '⚡ 已开启强介入并锁好目标，马上开始推进'
                : (ko && ko.queuedApproval
                    ? '⚡ 已开启强介入，请在弹窗里同意第一步操作'
                    : '⚡ 已开启强介入并锁好目标'))
            : '已关闭强介入',
        })
      } else if (typeof nextCfg.tacticalModes.intervention === 'boolean' && Object.keys(nextCfg.tacticalModes).length === 1) {
        patch({ notice: nextCfg.tacticalModes.intervention ? '⚡ 已开启强介入' : '已关闭强介入' })
      } else {
        patch({ notice: '✦ 已更新自动控制开关' })
      }
    } else if (typeof nextCfg.runMode === 'string') {
      const rmMap = {
        off: '⏸ 已切到关停：后台不花额度，也不自动检查，只在你提问或点按钮时工作',
        patrol: '🛡 已切到巡检：平时不花额度，只在报错、断线或触发物理驻墙时介入',
        managed: '🤖 已切到托管：后台盯着进度、用梦境漫游整理档案，闲置 15 分钟自动停下',
      }
      patch({ notice: rmMap[nextCfg.runMode] || '已更新运行方式' })
    } else if (typeof nextCfg.thinkingEffort === 'string') {
      patch({ notice: `🧠 思考深度已切到「${nextCfg.thinkingEffort === 'auto' ? '自动' : nextCfg.thinkingEffort}」` })
    } else if (typeof nextCfg.teamEffortMode === 'string') {
      patch({
        notice: nextCfg.teamEffortMode === 'manual'
          ? '✋ 团队思考深度已设为手动，参谋长不会自动调整'
          : '🪄 团队思考深度已设为自动，参谋长会按任务情况调整',
      })
    } else if (nextCfg.directSetAgentEffort && typeof nextCfg.directSetAgentEffort === 'object') {
      const t = nextCfg.directSetAgentEffort.target || 'lead'
      const e = nextCfg.directSetAgentEffort.reasoningEffort || nextCfg.directSetAgentEffort.effort || 'medium'
      patch({ notice: `🧠 已把 @${t} 的思考深度调成 ${e}` })
    } else if (nextCfg.toggleLockAgentEffort && typeof nextCfg.toggleLockAgentEffort === 'object') {
      const t = nextCfg.toggleLockAgentEffort.target || 'lead'
      const l = Boolean(nextCfg.toggleLockAgentEffort.locked)
      patch({ notice: l ? `🔒 已锁定 @${t} 的思考深度，参谋长不能自动改` : `🔓 已解锁 @${t} 的思考深度` })
    } else if (nextCfg.preset) {
      const presetMap = {
        observer: bi('👁 已切到「只读旁观」：L0 · ⏸ 关停 · 低思考深度', '👁 Switched to Observer: L0 · Off · Low thinking'),
        collab: bi('🤝 已切到「日常协作」：L2 · 🛡 巡检 · 每步问你 · 🛡 红线哨兵', '🤝 Switched to Co-Pilot: L2 · Patrol · Ask first · 🛡 Sentinel'),
        away: bi('🚀 已切到「离桌托管」：L3 · 🤖 托管 · 80%自动压缩 · 30次/300K上限', '🚀 Switched to Away Mode: L3 · Managed · 80% compact · 30 calls/300K cap'),
      }
      patch({ notice: presetMap[nextCfg.preset] || bi('✦ 已套用预设模式', '✦ Preset applied') })
    } else if (typeof nextCfg.uiLang === 'string') {
      const langNames = { auto: bi('自动', 'Auto'), zh: '简体中文', en: 'English' }
      patch({ notice: bi('🌐 语言已切到：', '🌐 Language: ') + (langNames[nextCfg.uiLang] || nextCfg.uiLang) })
    } else if (nextCfg.resetManagedBudget) {
      patch({ notice: bi('↺ 已清零本轮托管额度计数', '↺ Managed usage counter reset') })
    } else if (typeof nextCfg.notifyEnabled === 'boolean') {
      patch({ notice: nextCfg.notifyEnabled ? bi('🔔 已开启桌面通知提醒', '🔔 Desktop alerts on') : bi('🔕 已关闭桌面通知提醒', '🔕 Desktop alerts off') })
    } else if (typeof nextCfg.notifySound === 'boolean') {
      patch({ notice: nextCfg.notifySound ? bi('🔊 已开启提示音', '🔊 Sound on') : bi('🔇 已关闭提示音', '🔇 Sound off') })
    } else if (typeof nextCfg.sessionEnabled === 'boolean') {
      patch({
        notice: nextCfg.sessionEnabled
          ? bi('✅ 已在本会话启用参谋长（提示词、看板与安全卫兵已生效）', '✅ Chief enabled for this session (prompt, board & safety guard active)')
          : bi('⏸ 已退出本会话参谋长（本会话恢复普通零侵入模式）', '⏸ Chief disabled for this session (zero-intrusion mode)'),
      })
      void refresh()
      void loadChiefView(false)
    } else if (typeof nextCfg.defaultAutoEnableSessions === 'boolean') {
      patch({
        notice: nextCfg.defaultAutoEnableSessions
          ? bi('⚡ 新会话将默认自动启用参谋长', '⚡ New sessions will auto-enable Chief by default')
          : bi('🛡 新会话已恢复默认按需启用（普通窗口零侵入）', '🛡 New sessions stay opt-in by default (zero intrusion)'),
      })
      void refresh()
    } else if (nextCfg.managedBudgetMaxCalls !== undefined || nextCfg.managedBudgetMaxTokens !== undefined) {
      patch({ notice: bi('💰 已更新托管费用上限', '💰 Spending limits updated') })
    } else if (typeof nextCfg.paceMode === 'string') {
      const paceNotice = nextCfg.paceMode === 'stopped'
        ? '⏹ 已停止参谋长：自动推进和后台检查都已暂停'
        : nextCfg.paceMode === 'auto'
          ? '⚡ 已开启本对话托管：只管当前窗口，做完后会自动停下'
          : nextCfg.paceMode === 'smart'
            ? '已切到巡检：平时不运行，遇到卡点或报错才介入'
            : '已切到手动：后台不自动运行，只在你主动点按钮或发消息时工作'
      patch({ notice: paceNotice })
    } else if (typeof nextCfg.autoPilot === 'boolean') {
      patch({ notice: nextCfg.autoPilot ? '⚡ 已开启当前对话托管' : '已切到手动模式' })
    } else if (typeof nextCfg.modelRef === 'string') {
      const cat = (value && value.view && value.view.models) || store.secModelsCatalog
      const followHint = (cat && (cat.followLabel || fullModelWithChannel(cat.followRef || cat.defaultRef, cat))) || ''
      patch({
        notice: nextCfg.modelRef
          ? '参谋长当前模型：' + fullModelWithChannel(nextCfg.modelRef, cat)
          : '已切回跟随主对话模型' + (followHint ? '（' + followHint + '）' : ''),
      })
    }
    return value
  } catch (error) {
    const payload = error && error.payload
    if (payload && payload.requireChiefRiskConfirm) {
      if (nextCfg && nextCfg.preset === 'away') {
        patch({ awayPresetModalOpen: true, awayPresetAgreed: false, secPermMenuOpen: false, secPaceMenuOpen: false })
        return null
      }
      patch({ chiefRiskModalOpen: true, chiefRiskAgreed: false, secPermMenuOpen: false })
      return null
    }
    if (payload && payload.requireAutoPilotConfirm) {
      if (nextCfg && nextCfg.preset === 'away') {
        patch({ awayPresetModalOpen: true, awayPresetAgreed: false, secPermMenuOpen: false, secPaceMenuOpen: false })
        return null
      }
      patch({ autoPilotConfirmOpen: true, secPaceMenuOpen: false })
      return null
    }
    patch({ error: String((error && error.message) || error) })
    return null
  }
}

export async function applyScenarioPreset(presetId, extra = {}) {
  const id = String(presetId || '').trim().toLowerCase()
  if (!id) return null
  if (id === 'away' && !(extra && extra.confirmedChiefRisk && extra.confirmedAutoPilot)) {
    const meta = store.chiefMeta || {}
    const alreadyReady = Boolean(meta.chiefRiskVerified) && meta.permissionMode === 'chief' && meta.runMode === 'managed'
    if (!alreadyReady) {
      patch({ awayPresetModalOpen: true, awayPresetAgreed: false, secPermMenuOpen: false, secPaceMenuOpen: false })
      return null
    }
  }
  return updateSecConfig({ preset: id, ...extra })
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
            ? '✓ 已批准并继续完成了原任务'
            : ((value && value.executed) ? '✓ 已批准并执行这次操作' : '✓ 已批准操作'))
        : '已拒绝这次操作',
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
            ? ('已批准升到 ' + (CHIEF_PERMISSION_LABELS[value.permissionMode || targetMode] || targetMode) + ' 并继续运行')
            : ('已批准升到 ' + (CHIEF_PERMISSION_LABELS[value.permissionMode || targetMode] || targetMode)))
        : '已拒绝提升权限',
    })
    return value
  } catch (error) {
    const payload = error && error.payload
    if (payload && payload.requireChiefRiskConfirm) {
      patch({ elevationBusy: false, error: '进入 L3 · 参谋长模式前，请先勾选风险确认框' })
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
        ? '已连上该对话，两边会同步进度和消息'
        : '已断开连接，两边的摘要和记录已分开',
    })
    return value
  } catch (error) {
    patch({ error: String((error && error.message) || error) })
    void loadChiefView(false)
    return null
  }
}

export async function toggleBubbleHarness(provider, joined, meta = {}) {
  try {
    const value = await call('chief/link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session: store.sessionId,
        op: 'harness_toggle',
        provider,
        label: meta.label || '',
        role: meta.role || '',
        joined: Boolean(joined),
      }),
    })
    patch({
      notice: joined
        ? bi(`🫧 已将 ${meta.label || provider} 拖入协同水泡`, `🫧 Added ${meta.label || provider} to Bubble`)
        : bi(`🫧 已将 ${meta.label || provider} 移出协同水泡`, `🫧 Removed ${meta.label || provider} from Bubble`),
    })
    return value
  } catch (error) {
    patch({ error: String((error && error.message) || error) })
    void loadChiefView(false)
    return null
  }
}

export async function toggleBubbleLock(locked, reason = '') {
  try {
    const value = await call('chief/link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session: store.sessionId,
        op: 'bubble_lock',
        locked: Boolean(locked),
        reason,
      }),
    })
    patch({
      notice: locked
        ? bi('🔒 协同水泡结构已锁死，禁止工作期间拆解成员', '🔒 Bubble structure locked while active')
        : bi('🔓 已解除协同水泡结构锁定', '🔓 Bubble structure unlocked'),
    })
    return value
  } catch (error) {
    patch({ error: String((error && error.message) || error) })
    void loadChiefView(false)
    return null
  }
}

export async function emergencyStopBubble() {
  try {
    const value = await call('chief/link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session: store.sessionId,
        op: 'bubble_emergency_stop',
      }),
    })
    patch({
      notice: bi(
        `⏹ 已急停解体并停止 ${(value && value.stoppedCount) || 0} 个在途执行，水泡结构已解锁`,
        `⏹ Stopped ${(value && value.stoppedCount) || 0} active run(s) & unlocked Bubble`,
      ),
    })
    return value
  } catch (error) {
    patch({ error: String((error && error.message) || error) })
    void loadChiefView(false)
    return null
  }
}

export async function dispatchBubbleHarness(provider, text, label = '') {
  try {
    const value = await call('chief/link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session: store.sessionId,
        op: 'harness_dispatch',
        provider,
        text,
        label,
      }),
    })
    patch({
      notice: bi(
        `⚡ 已向 @${provider} 派发外部协同任务，水泡已自动锁死保护`,
        `⚡ Dispatched to @${provider}; Bubble structure auto-locked`,
      ),
    })
    return value
  } catch (error) {
    patch({ error: String((error && error.message) || error) })
    void loadChiefView(false)
    return null
  }
}

export async function refreshBubbleDiscovery() {
  try {
    const value = await call('chief/link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session: store.sessionId,
        op: 'bubble_refresh',
      }),
    })
    const ref = (value && value.refreshed) || {}
    const hCount = Number(ref.harnesses) || 0
    const sCount = Number(ref.otherSessions) || 0
    patch({
      notice: bi(
        `↻ 已刷新待命池：发现 ${hCount} 个外部工具 · ${sCount} 个其他对话窗口`,
        `↻ Refreshed Standby: ${hCount} external tool(s) · ${sCount} conversation window(s)`,
      ),
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
          patch({ notice: `${isPinned ? '📌 ' : ''}已把 ${replacedN} 条规则合并进【${label}】${isPinned ? '（所有任务通用）' : '（只限这次）'}` })
        } else {
          patch({ notice: `${isPinned ? '📌 已添加到全局' : '已添加到本对话'}【${label}】` })
        }
      } else if (sug.kind === 'guard_wall') {
        const applied = value && value.wallApplied
        patch({ notice: '🧱 已启用物理驻墙：' + ((applied && applied.title) || sug.title || '') })
      } else if (sug.kind === 'wall_removal') {
        const removed = value && value.wallRemoved
        patch({
          notice: removed && removed.action === 'remove'
            ? `🧱 已删除物理驻墙：${removed.title || sug.title || ''}`
            : `⏸ 已暂停物理驻墙：${(removed && removed.title) || sug.title || ''}`,
        })
      } else if (sug.kind === 'advice') {
        patch({ notice: '💡 已采纳建议并发送 → @' + (sug.targetLabel || sug.target || '主对话') })
      } else {
        patch({ notice: '已发送 → @' + (sug.targetLabel || sug.target) })
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
      const parts = [`✓ 已执行 ${execCount} 条建议`]
      if (blockedCount > 0) parts.push(`拦住 ${blockedCount} 条越界建议`)
      if (skippedGoals > 0) parts.push(`还有 ${skippedGoals} 条完成确认需要你单独点`)
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
    { tone: 'bounds', tab: 'boundaries', boundSubTab: 'rules', label: '正在合并边界规则…' },
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
            notice: '🏛 边界规则已合并成 1 条，请在上方建议卡片里确认',
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
    notice: '已填到下面输入框，改好就能发',
  })
  if (sug.id && !sug.isSynthetic) void decideSuggestion(sug, 'dismiss')
}

export async function ingestSecImageFiles(fileList) {
  const incoming = Array.from(fileList || []).filter(f => {
    if (!f) return false
    const t = String(f.type || '').toLowerCase()
    if (t === 'image/jpg' || SEC_IMAGE_MIMES.has(t)) return true
    return /\.(png|jpe?g|webp|gif)$/i.test(String(f.name || ''))
  })
  if (!incoming.length) {
    patch({ notice: '只支持 PNG、JPG、WebP、GIF 图片' })
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
    patch({ notice: `一次最多传 ${SEC_MAX_IMAGES} 张，已选前 ${slots} 张` })
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
          if (wp && wp.title) pushAction('新物理驻墙：' + clampTitle(wp.title, 14))
        }
        for (const wr of (value.wallRemovalProposals || [])) {
          if (wr && wr.title) pushAction('⚠️ 申请关墙：' + clampTitle(wr.title, 14))
        }
        for (const bp of (value.boundProposals || [])) {
          if (bp && bp.draftText) pushAction('建议改边界：' + clampTitle(bp.draftText, 12))
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
                  ? `⚠️ 参谋长申请关闭 ${value.wallRemovalProposals.length} 条物理驻墙，请在上方建议卡片里决定`
                  : `✨ 已生成 ${createdSugCount} 条待确认建议，点顶部「▶ 执行建议」就能生效`,
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


apiBridge.loadChiefView = loadChiefView
