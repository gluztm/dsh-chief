/**
 * chief-approvals.js
 *
 * Human decision handlers for suggestions, L2 per-action approvals, and permission elevations for DSH Chief.
 */

import {
  DEFAULT_CHIEF_PERMISSION_MODE,
  CHIEF_PERMISSION_META,
  normalizePermissionMode,
  permissionRank,
  evaluateSafetyGuardHardRules,
  executeChiefToolCall,
  HUMAN_BOUNDS_CONFIRM_TOKEN,
  buildCapabilityScope,
  verifyCapabilityScope,
  mutateGuardWalls,
} from './chief-executor.js'
import {
  CHAT_CAP,
  MAIL_CAP,
  resolveSessionWorkspaceCwd,
  nextId,
  clamp,
  cleanMultiline,
  hasValidChiefRiskAck,
  computeApprovalPayloadHash,
  upsertTaskLedgerOnWs,
  markTaskResumingActive,
  unmarkTaskResumingActive,
  pushAuditToWs,
  normalizeMail,
  resolveWorkspaceConfig,
  appendChiefAuditLog,
  loadChiefState,
  mutateChiefState,
  getLinkedCluster,
  ensureWorkspace,
  updateChiefConfig,
} from './chief-state.js'
import { deliverCrossMessage } from './chief-network.js'
import { getChiefView } from './chief-view.js'
import { buildChiefArchiveUpsertFn } from './chief-archives.js'
import { buildChiefCompactFn, recordSmartCompactionChatReceipt } from './chief-compaction.js'
import { askOrCommandChief, executeChiefArchiveInjectionOp } from './chief-commands.js'

export async function handleSuggestionDecision(deps, { sessionId, suggestionId, decision, editedText, boundField, pinGlobal, _suppressChatReceipt = false, _byUserClick = true }) {
  const rootId = deps.resolveRootSessionId(sessionId) || String(sessionId || 'global')
  let found = null
  mutateChiefState((state) => {
    const ws = ensureWorkspace(state, rootId)
    const item = ws.suggestions.find(s => s.id === suggestionId)
    if (!item) return
    item.status = decision === 'approve' ? 'applied' : 'dismissed'
    found = { ...item }
  })
  if (!found) return { ok: false, error: '未找到该请示或建议卡片' }

  if (decision === 'approve' && found.kind === 'bound') {
    const rawBf = String(boundField || '').trim().toLowerCase()
    const normBf = rawBf === 'must' ? 'allowed' : rawBf
    const rawFoundBf = String(found.boundField || '').trim().toLowerCase()
    const normFoundBf = rawFoundBf === 'must' ? 'allowed' : rawFoundBf
    const col = ['forbidden', 'allowed', 'notes'].includes(normBf)
      ? normBf
      : (['forbidden', 'allowed', 'notes'].includes(normFoundBf) ? normFoundBf : 'forbidden')
    const BOUND_COL_LABEL = { forbidden: '禁止红线', allowed: '必做事项', notes: '注意事项' }
    const colLabel = BOUND_COL_LABEL[col] || '禁止红线'
    const ruleText = clamp(editedText || found.draftText || found.title, 220)
    if (!ruleText) return { ok: false, error: '边界条文不能为空' }

    const shouldPin = typeof pinGlobal === 'boolean' ? pinGlobal : Boolean(found.pinGlobal)
    const replaces = Array.isArray(found.replaces) ? found.replaces.filter(Boolean) : []

    const writeRes = deps.runAction
      ? (replaces.length > 0
          ? deps.runAction({
              action: 'bounds.consolidate',
              field: col,
              removeItems: replaces,
              item: ruleText,
              pinned: shouldPin,
              session: rootId === 'global' ? '' : rootId,
              by: 'DSH 参谋长',
              _callerOrigin: 'human_approval',
              _humanConfirmToken: HUMAN_BOUNDS_CONFIRM_TOKEN,
            })
          : deps.runAction({
              action: 'bounds.add',
              field: col,
              item: ruleText,
              pinned: shouldPin,
              session: rootId === 'global' ? '' : rootId,
              by: 'DSH 参谋长',
              _callerOrigin: 'human_approval',
              _humanConfirmToken: HUMAN_BOUNDS_CONFIRM_TOKEN,
            }))
      : { ok: false, error: 'runAction unavailable' }
    if (!writeRes || !writeRes.ok) {
      return { ok: false, error: (writeRes && writeRes.error) || '写入边界失败' }
    }

    const scopeTag = shouldPin ? '📌 全局共享边界（跨任务生效）' : '本任务边界（仅当前会话树生效）'
    // Broadcast a silent boundary decree so running lead/subagents immediately see the new rule on next pre-step
    mutateChiefState((state) => {
      const ws = ensureWorkspace(state, rootId)
      const cluster = getLinkedCluster(state, rootId)
      const decree = normalizeMail({
        from: 'DSH 参谋长 (边界颁布)',
        fromSession: rootId === 'global' ? '' : rootId,
        fromRootId: rootId === 'global' ? '' : rootId,
        to: 'all',
        toSession: 'all',
        toRootId: 'all',
        participantRoots: cluster,
        channelType: cluster.length > 1 ? 'broadcast' : 'internal',
        broadcastId: nextId('bcast'),
        subject: `用户已批准${replaces.length ? `浓缩${colLabel}（${replaces.length} 合 1）` : `新${colLabel}`}`,
        text: `- 【${colLabel} · ${scopeTag}】${shouldPin ? '📌 ' : ''}${ruleText}${replaces.length ? `\n- 【已整合替代】原 ${replaces.length} 条零散边界已合并为此条总则` : ''}${found.reason ? `\n- 【缘由】${found.reason}` : ''}\n请主代理与全体子代理自即刻起严格遵守！`,
        mode: 'silent',
        deliveredPhysical: false,
      })
      if (decree) {
        ws.mailbox.push(decree)
        if (ws.mailbox.length > MAIL_CAP) ws.mailbox = ws.mailbox.slice(-MAIL_CAP)
      }
    })

    return {
      ok: true,
      boundApplied: { field: col, label: colLabel, item: ruleText, pinned: shouldPin, replacedCount: replaces.length },
      view: await getChiefView(deps, rootId, { autoSummarize: true }),
    }
  }

  if (decision === 'approve' && found.kind === 'guard_wall') {
    const cwdNow = resolveSessionWorkspaceCwd(deps, rootId)
    const spec = found.wallSpec && typeof found.wallSpec === 'object' ? found.wallSpec : {
      title: String(found.title || '参谋长生成的自定义拦截规则').replace(/^(?:🧱|🚧)\s*(?:驻防物理墙|新增拦截规则)[:：]\s*/, ''),
      scope: found.pinGlobal === false ? 'workspace' : 'global',
      ruleType: 'forbid_path',
      patterns: String(found.draftText || '').split(/[,，;\n]+/).map(s => s.trim()).filter(Boolean),
      reason: found.reason || '',
      source: 'chief_crafted',
    }
    const wallRes = mutateGuardWalls({
      op: 'save',
      wall: { ...spec, source: 'chief_crafted' },
      cwd: cwdNow,
      callerOrigin: 'human_approval',
      humanConfirmToken: HUMAN_BOUNDS_CONFIRM_TOKEN,
    })
    if (!wallRes || !wallRes.ok) {
      return { ok: false, error: (wallRes && wallRes.error) || '自定义拦截规则启用失败' }
    }
    mutateChiefState((state) => {
      const ws = ensureWorkspace(state, rootId)
      if (!_suppressChatReceipt) {
        ws.chat.push({
          id: nextId('chat'),
          role: 'chief',
          kind: 'receipt',
          text: `- 【🚧 自定义拦截规则已启用】${wallRes.wall.title}\n- 【拦截范围】${wallRes.wall.scope === 'workspace' ? '仅绑定当前工程' : '🌐 全局随身常驻'} | 规则：\`${wallRes.wall.patterns.join(', ')}\``,
          actions: ['启用自定义拦截规则'],
          at: Date.now(),
        })
        if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
      }
      pushAuditToWs(ws, {
        mode: resolveWorkspaceConfig(state, rootId).permissionMode,
        stage: 'guard_wall',
        rule: 'guard_wall_approved',
        decision: 'executed',
        operation: '启用自定义拦截规则',
        target: wallRes.wall.title,
        reason: wallRes.wall.patterns.join(', '),
        outcome: 'ok',
        by: 'operator',
      }, rootId)
    })
    return {
      ok: true,
      wallApplied: wallRes.wall,
      guardWalls: wallRes.walls,
      view: await getChiefView(deps, rootId, { autoSummarize: false }),
    }
  }

  if (decision === 'approve' && found.kind === 'wall_removal') {
    const cwdNow = resolveSessionWorkspaceCwd(deps, rootId)
    const spec = (found.wallRemovalSpec && typeof found.wallRemovalSpec === 'object') ? found.wallRemovalSpec : {}
    const targetWallId = String(spec.wallId || '').trim()
    const opType = spec.action === 'remove' ? 'remove' : 'set_scope'
    if (!targetWallId) {
      return { ok: false, error: '关闭规则申请缺少有效的目标规则 ID (wallId)' }
    }
    const wallRes = mutateGuardWalls({
      op: opType,
      wallId: targetWallId,
      ...(opType === 'set_scope' ? { scope: 'paused' } : {}),
      cwd: cwdNow,
      callerOrigin: 'human_approval',
      humanConfirmToken: HUMAN_BOUNDS_CONFIRM_TOKEN,
    })
    if (!wallRes || !wallRes.ok) {
      return { ok: false, error: (wallRes && wallRes.error) || '按人工批复调整自定义拦截规则失败' }
    }
    const wallTitle = spec.wallTitle || (wallRes.wall && wallRes.wall.title) || targetWallId
    const actVerb = opType === 'remove' ? '删除移除' : '暂停休眠'
    mutateChiefState((state) => {
      const ws = ensureWorkspace(state, rootId)
      if (!_suppressChatReceipt) {
        ws.chat.push({
          id: nextId('chat'),
          role: 'chief',
          kind: 'receipt',
          text: `- 【🚧 已按人工批示${actVerb}自定义拦截规则】${wallTitle} (\`${targetWallId}\`)\n- 【代理上报与调整依据】${clamp(spec.blockerEvidence || found.reason || '主/子代理命中拦截无法绕过，参谋呈报经人类批准后执行', 180)}`,
          actions: [`已${actVerb}拦截规则`],
          at: Date.now(),
        })
        if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
      }
      pushAuditToWs(ws, {
        mode: resolveWorkspaceConfig(state, rootId).permissionMode,
        stage: 'guard_wall',
        rule: 'wall_removal_approved',
        decision: 'executed',
        operation: `人工批复${actVerb}自定义拦截规则`,
        target: `${wallTitle} (${targetWallId})`,
        reason: clamp(spec.reason || found.reason || '代理命中拦截无法绕过，经人类显式审批后放行', 180),
        outcome: 'ok',
        by: 'operator',
      }, rootId)
    })
    return {
      ok: true,
      wallRemoved: { wallId: targetWallId, title: wallTitle, action: opType === 'remove' ? 'remove' : 'pause' },
      guardWalls: wallRes.walls,
      view: _suppressChatReceipt ? null : await getChiefView(deps, rootId, { autoSummarize: false }),
    }
  }

  if (decision === 'approve' && found.kind === 'goal_approval') {
    const res = deps.runAction
      ? deps.runAction({ action: 'goal.approve', session: rootId, by: 'user' })
      : { ok: false, error: 'runAction unavailable' }
    return {
      ok: Boolean(res && res.ok),
      goalApproved: true,
      view: await getChiefView(deps, rootId, { autoSummarize: false }),
    }
  }

  if (decision !== 'approve' && found.kind === 'goal_approval') {
    const res = deps.runAction
      ? deps.runAction({
          action: 'goal.reject',
          reason: editedText || '暂不结项，继续推进完善',
          session: rootId,
          by: 'user',
        })
      : { ok: false }
    return {
      ok: Boolean(res && res.ok),
      goalRejected: true,
      view: await getChiefView(deps, rootId, { autoSummarize: false }),
    }
  }

  if (decision === 'approve' && found.kind === 'archive_op') {
    const spec = (found.archiveSpec && typeof found.archiveSpec === 'object')
      ? found.archiveSpec
      : ((found.archiveOp && typeof found.archiveOp === 'object') ? found.archiveOp : {})
    const archRes = await executeChiefArchiveInjectionOp(deps, rootId, {
      op: spec.op || 'pin_to_desktop',
      vaultScope: spec.vaultScope || 'session',
      id: spec.id || '',
      title: spec.title || found.title || '',
      target: spec.target || found.target || 'lead',
      instruction: editedText || spec.instruction || found.reason || '',
    }, { byLabel: 'DSH 参谋长 (获批档案调配)' }).catch(e => ({ ok: false, error: (e && e.message) || 'archive-op-failed' }))
    return {
      ok: Boolean(archRes && archRes.ok),
      archiveApplied: archRes,
      error: archRes && !archRes.ok ? archRes.error : '',
      view: _suppressChatReceipt ? null : await getChiefView(deps, rootId, { autoSummarize: false }),
    }
  }

  if (decision === 'approve' && found.kind === 'model_effort') {
    const spec = (found.effortSpec && typeof found.effortSpec === 'object')
      ? found.effortSpec
      : ((found.effortOp && typeof found.effortOp === 'object') ? found.effortOp : {})
    const target = spec.target || found.target || 'lead'
    const eff = spec.effort || 'medium'
    const effReason = spec.reason || found.reason || '按参谋建议调整思考强度'
    const effRes = deps && typeof deps.controlMainAgent === 'function'
      ? await deps.controlMainAgent({
          rootId,
          sessionId: rootId,
          op: 'set_effort',
          target,
          reasoningEffort: eff,
          reason: effReason,
          byUser: Boolean(_byUserClick !== false),
        }).catch(e => ({ ok: false, error: (e && e.message) || 'effort-failed' }))
      : { ok: false, error: '当前宿主未绑定会话控制接口' }
    return {
      ok: Boolean(effRes && effRes.ok),
      effortApplied: effRes,
      lockedByUser: Boolean(effRes && effRes.lockedByUser),
      error: effRes && !effRes.ok ? effRes.error : '',
      view: _suppressChatReceipt ? null : await getChiefView(deps, rootId, { autoSummarize: false }),
    }
  }

  if (decision === 'approve' && (found.kind === 'relay' || found.kind === 'advice')) {
    const body = editedText ? cleanMultiline(editedText, 1200) : found.draftText
    const deliverTarget = found.target || 'lead'
    const shouldDeliver = Boolean(body && deliverTarget !== 'none' && deliverTarget !== 'chief')
    const delivery = shouldDeliver
      ? await deliverCrossMessage(deps, {
          fromSession: rootId,
          fromLabel: found.kind === 'advice' ? 'DSH 参谋长 (获批进言)' : 'DSH 参谋长 (获批建议)',
          target: deliverTarget,
          subject: found.title,
          text: body,
          mode: found.mode || (found.kind === 'advice' ? 'followup' : 'steer'),
        })
      : { ok: true, skippedDelivery: true }
    if (found.kind === 'advice' && typeof deps.appendBoardLog === 'function' && rootId !== 'global') {
      deps.appendBoardLog(rootId, `💡 用户已拍板采纳参谋进言：${clamp(found.title, 40)}`, 'user')
    }
    return {
      ok: delivery.ok !== false,
      adviceApplied: found.kind === 'advice',
      delivery,
      view: await getChiefView(deps, rootId, { autoSummarize: false }),
    }
  }

  return {
    ok: true,
    view: await getChiefView(deps, rootId, { autoSummarize: false }),
  }
}

/** 统一批量执行当前授权边界内的待处理建议并产出单一结构化回执（Bundle 4）。 */
export async function executeBatchSuggestions(deps, {
  sessionId = '',
  ids = [],
  includeGoalApproval = false,
  pinGlobalDefault = undefined,
  skipGuardWalls = false,
  skipGlobalBounds = false,
  byAutoRunner = false,
  skipChatReceipt = false,
} = {}) {
  const rootId = (deps && typeof deps.resolveRootSessionId === 'function' ? deps.resolveRootSessionId(sessionId) : '') || String(sessionId || 'global')
  const stateSnap = loadChiefState()
  const wsSnap = ensureWorkspace(stateSnap, rootId)
  const effCfg = resolveWorkspaceConfig(stateSnap, rootId)
  const permMode = normalizePermissionMode(effCfg.permissionMode, {
    requireAck: true,
    hasChiefRiskAck: hasValidChiefRiskAck(wsSnap),
  })
  const board = deps && deps.boardForSession && deps.boardFileFor
    ? deps.boardForSession(deps.boardFileFor(rootId))
    : null

  const idFilter = Array.isArray(ids) && ids.length > 0 ? new Set(ids.map(String)) : null
  const allPending = (wsSnap.suggestions || []).filter(s => s && s.status === 'pending' && (!idFilter || idFilter.has(s.id)))
  if (!allPending.length) {
    return {
      ok: true,
      executedCount: 0,
      skippedGoalCount: 0,
      blockedCount: 0,
      failedCount: 0,
      executed: [],
      blocked: [],
      skippedGoals: [],
      summaries: ['当前没有待执行的参谋长建议。'],
      view: skipChatReceipt ? null : await getChiefView(deps, rootId, { autoSummarize: false }),
    }
  }

  const executed = []
  const blocked = []
  const failed = []
  const skippedGoals = []
  const summaries = []

  for (const sug of allPending) {
    if (sug.kind === 'goal_approval' && !includeGoalApproval) {
      skippedGoals.push({ id: sug.id, title: sug.title })
      continue
    }
    if (skipGuardWalls && (sug.kind === 'guard_wall' || sug.kind === 'wall_removal')) {
      skippedGoals.push({ id: sug.id, title: sug.title })
      continue
    }
    if (sug.kind === 'wall_removal' && byAutoRunner) {
      skippedGoals.push({ id: sug.id, title: sug.title })
      continue
    }
    if (skipGlobalBounds && sug.kind === 'bound' && sug.pinGlobal) {
      skippedGoals.push({ id: sug.id, title: sug.title })
      continue
    }

    if (sug.kind !== 'bound' && sug.kind !== 'goal_approval' && sug.kind !== 'guard_wall' && sug.kind !== 'wall_removal') {
      const cmdSample = `${sug.draftText || ''}\n${sug.title || ''}`.trim()
      const guardRes = evaluateSafetyGuardHardRules({
        tool: 'relay',
        opClass: 'workflow',
        command: cmdSample,
        args: { text: sug.draftText || '', title: sug.title || '' },
        board,
        safetyGuardEnabled: !(effCfg && effCfg.tacticalModes && effCfg.tacticalModes.safetyGuardEnabled === false),
      })
      if (guardRes.blocked) {
        mutateChiefState((st) => {
          const ws = ensureWorkspace(st, rootId)
          const item = ws.suggestions.find(x => x && x.id === sug.id && x.status === 'pending')
          if (item) item.status = 'dismissed'
          pushAuditToWs(ws, {
            mode: permMode,
            stage: 'safety_guard',
            decision: 'blocked',
            operation: '批量执行参谋建议拦截',
            target: clamp(sug.title, 80),
            reason: guardRes.reason,
            outcome: 'blocked',
            by: byAutoRunner ? 'chief' : 'operator',
          }, rootId)
        })
        blocked.push({ id: sug.id, title: sug.title, reason: guardRes.reason })
        summaries.push(`⛔ 已拦截建议「${clamp(sug.title, 36)}」：${guardRes.reason}`)
        continue
      }
    }

    const res = await handleSuggestionDecision(deps, {
      sessionId: rootId,
      suggestionId: sug.id,
      decision: 'approve',
      pinGlobal: sug.kind === 'bound' && typeof pinGlobalDefault === 'boolean' ? pinGlobalDefault : undefined,
      _suppressChatReceipt: true,
      _byUserClick: !byAutoRunner,
    })

    if (res && res.ok) {
      executed.push({ id: sug.id, kind: sug.kind, title: sug.title, target: sug.targetLabel || sug.target })
      if (res.boundApplied) {
        summaries.push(`✅ 已应用边界「${res.boundApplied.label}」：${clamp(res.boundApplied.item, 44)}`)
      } else if (res.wallApplied) {
        const w = res.wallApplied
        const scopeLabel = w.scope === 'workspace' ? '仅本工程' : '🌐全局随身'
        const patPreview = Array.isArray(w.patterns) ? clamp(w.patterns.join(', '), 60) : ''
        summaries.push(`🚧 已启用自定义拦截规则「${clamp(w.title, 36)}」（${scopeLabel}${patPreview ? ` · \`${patPreview}\`` : ''}）`)
      } else if (res.wallRemoved) {
        const r = res.wallRemoved
        summaries.push(`🚧 已按人工批复${r.action === 'remove' ? '删除' : '暂停'}自定义拦截规则「${clamp(r.title || r.wallId, 36)}」`)
      } else if (res.goalApproved) {
        summaries.push('✅ 已批准并结项当前核心目标')
      } else if (res.archiveApplied && res.archiveApplied.actionText) {
        summaries.push(`✅ ${res.archiveApplied.actionText}`)
      } else if (res.effortApplied && res.effortApplied.reasoningEffort) {
        summaries.push(`✅ 🧠 已调挡 @${res.effortApplied.target || 'lead'} → ${res.effortApplied.reasoningEffort}`)
      } else if (res.delivery && res.delivery.target) {
        summaries.push(`✅ 已采纳并递话给 @${res.delivery.target}：「${clamp(sug.title, 36)}」`)
      } else {
        summaries.push(`✅ 已执行建议：「${clamp(sug.title, 40)}」`)
      }
    } else {
      const errMsg = (res && res.error) || '执行未完成'
      failed.push({ id: sug.id, title: sug.title, error: errMsg })
      summaries.push(`${res && res.lockedByUser ? '🔒' : '⚠️'} ${res && res.lockedByUser ? '用户已锁挡跳过' : '未完成'}「${clamp(sug.title, 36)}」：${errMsg}`)
    }
  }

  mutateChiefState((st) => {
    const ws = ensureWorkspace(st, rootId)
    pushAuditToWs(ws, {
      mode: permMode,
      stage: 'executor',
      decision: executed.length > 0 ? 'executed' : (blocked.length > 0 ? 'blocked' : 'noop'),
      operation: byAutoRunner ? 'L3强介入一站式执行建议' : '统一执行参谋建议',
      target: `${executed.length} 项执行 / ${blocked.length} 项拦截 / ${skippedGoals.length} 项跳过`,
      reason: clamp(summaries.slice(0, 3).join('；'), 200) || '批量执行建议',
      outcome: blocked.length > 0 && executed.length === 0 ? 'blocked' : 'ok',
      by: byAutoRunner ? 'chief' : 'operator',
    }, rootId)
    if (!skipChatReceipt && (executed.length > 0 || blocked.length > 0 || failed.length > 0)) {
      const header = `- 【📋 统一执行参谋建议回执】完成 ${executed.length} 项${blocked.length ? ` · 拦截 ${blocked.length} 项` : ''}${failed.length ? ` · 异常 ${failed.length} 项` : ''}${skippedGoals.length ? ` · 保留需单独拍板项 ${skippedGoals.length} 项` : ''}`
      const actionTags = [`📋 执行建议 ×${executed.length}`]
      if (blocked.length) actionTags.push(`🛡️ 红线拦截 ×${blocked.length}`)
      ws.chat.push({
        id: nextId('chat'),
        role: 'chief',
        kind: 'receipt',
        text: [header, ...summaries.map(line => `  ${line}`)].join('\n'),
        actions: actionTags,
        at: Date.now(),
      })
      if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
    }
  })

  return {
    ok: true,
    executedCount: executed.length,
    skippedGoalCount: skippedGoals.length,
    blockedCount: blocked.length,
    failedCount: failed.length,
    executed,
    blocked,
    failed,
    skippedGoals,
    summaries,
    view: skipChatReceipt ? null : await getChiefView(deps, rootId, { autoSummarize: executed.some(e => e.kind === 'bound') }),
  }
}

/** 处理 L2 参谋模式逐项操作授权弹窗（拒绝 / 允许本次操作）。 */
export async function handleApprovalDecision(deps, {
  sessionId = '',
  approvalId = '',
  decision = 'reject',
  reason = '',
} = {}) {
  const rootId = (deps && typeof deps.resolveRootSessionId === 'function' ? deps.resolveRootSessionId(sessionId) : '') || String(sessionId || 'global')
  let found = null
  let currentMode = DEFAULT_CHIEF_PERMISSION_MODE
  let effPolicyPlugins = []
  let effSafetyGuardEnabled = true
  let existingNonPending = false
  let hashMismatch = false

  mutateChiefState((state) => {
    const ws = ensureWorkspace(state, rootId)
    const ackOk = hasValidChiefRiskAck(ws)
    const eff = resolveWorkspaceConfig(state, rootId)
    currentMode = normalizePermissionMode(eff.permissionMode, { requireAck: true, hasChiefRiskAck: ackOk })
    effPolicyPlugins = Array.isArray(eff.policyPlugins) ? eff.policyPlugins : []
    effSafetyGuardEnabled = !(eff && eff.tacticalModes && eff.tacticalModes.safetyGuardEnabled === false)
    const item = (ws.pendingApprovals || []).find(a => a && a.id === approvalId && a.status === 'pending')
    if (!item) {
      existingNonPending = (ws.pendingApprovals || []).some(a => a && a.id === approvalId)
      pushAuditToWs(ws, {
        mode: currentMode,
        stage: 'permission_gate',
        rule: existingNonPending ? 'replayed_approval' : 'invalid_approval_id',
        decision: existingNonPending ? 'replayed_approval' : 'invalid_approval_id',
        operation: '伪造或重放审批拦截',
        target: clamp(approvalId || '(empty)', 100),
        reason: existingNonPending ? '该操作审批已处理完毕，拒绝重复提交或重放' : '未找到对应的 pending approvalId，拒绝执行',
        outcome: 'rejected',
        by: 'operator',
      }, rootId)
      return
    }

    const linkedTaskId = item.taskId || item.resumeTaskId || ''
    const expectedHash = computeApprovalPayloadHash(item.kind, item.payload || {})
    if (decision === 'approve' && item.payloadHash && item.payloadHash !== expectedHash) {
      hashMismatch = true
      found = { ...item, payload: item.payload ? { ...item.payload } : {} }
      item.status = 'failed'
      item.resolvedAt = Date.now()
      item.resolvedBy = 'safety_guard'
      item.resultMessage = '审批载荷哈希校验失败（疑似载荷被篡改）'
      const ledgerList = Array.isArray(ws.taskLedger) ? ws.taskLedger : (Array.isArray(ws.resumeTasks) ? ws.resumeTasks : [])
      if (linkedTaskId) {
        const linkedTask = ledgerList.find(t => t && (t.taskId === linkedTaskId || t.id === linkedTaskId))
        if (linkedTask) {
          linkedTask.status = 'failed'
          linkedTask.updatedAt = Date.now()
          linkedTask.resolvedAt = Date.now()
          linkedTask.lastReceipt = '审批载荷哈希校验失败，事务中止'
        }
      }
      pushAuditToWs(ws, {
        mode: currentMode,
        stage: 'safety_guard',
        rule: 'tampered_approval_payload',
        decision: 'tampered_approval_payload',
        operation: item.operationLabel,
        target: item.targetLabel,
        reason: 'approval payload SHA-256 校验失败，拒绝执行',
        outcome: 'rejected',
        by: 'safety_guard',
      }, rootId)
      ws.chat.push({
        id: nextId('chat'),
        role: 'chief',
        kind: 'receipt',
        text: `- 【🛡️ 审批载荷完整性校验失败】已拦截执行「${item.operationLabel} · \`${item.targetLabel}\`」（签名摘要不匹配）。`,
        actions: ['🛡️ 载荷篡改拦截'],
        at: Date.now(),
      })
      if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
      return
    }

    found = { ...item, payload: item.payload ? { ...item.payload } : {} }
    if (decision !== 'approve') {
      item.status = 'rejected'
      item.resolvedAt = Date.now()
      item.resolvedBy = 'operator'
      item.resultMessage = '用户拒绝执行本次操作'
      const ledgerList = Array.isArray(ws.taskLedger) ? ws.taskLedger : (Array.isArray(ws.resumeTasks) ? ws.resumeTasks : [])
      if (linkedTaskId) {
        const linkedTask = ledgerList.find(t => t && (t.taskId === linkedTaskId || t.id === linkedTaskId))
        if (linkedTask) {
          linkedTask.status = 'cancelled'
          linkedTask.updatedAt = Date.now()
          linkedTask.resolvedAt = Date.now()
          linkedTask.lastReceipt = '用户拒绝本次操作授权'
        }
      }
      pushAuditToWs(ws, {
        mode: currentMode,
        stage: 'permission_gate',
        rule: 'rejected_by_user',
        decision: 'rejected_by_user',
        operation: item.operationLabel,
        target: item.targetLabel,
        reason: item.reason,
        outcome: 'rejected',
        by: 'operator',
      }, rootId)
      ws.chat.push({
        id: nextId('chat'),
        role: 'chief',
        kind: 'receipt',
        text: `- 【⛔ 已拒绝本次操作】${item.operationLabel} · \`${item.targetLabel}\``,
        actions: ['⛔ 用户拒绝操作'],
        at: Date.now(),
      })
      if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
    } else {
      item.status = 'approved'
      item.resolvedAt = Date.now()
      item.resolvedBy = 'operator'
      pushAuditToWs(ws, {
        mode: currentMode,
        stage: 'permission_gate',
        rule: 'approved_by_user',
        decision: 'approved_by_user',
        operation: item.operationLabel,
        target: item.targetLabel,
        reason: item.reason,
        outcome: 'approved',
        by: 'operator',
      }, rootId)
    }
  })

  if (!found) return { ok: false, error: existingNonPending ? '该操作授权已处理完毕，禁止重复放行' : '未找到该待确认操作或已处理完毕' }
  if (hashMismatch) return { ok: false, tampered: true, error: '审批载荷哈希校验失败，已拒绝执行并写入安全审计' }
  if (decision !== 'approve') {
    return {
      ok: true,
      rejected: true,
      approval: { ...found, status: 'rejected' },
      view: await getChiefView(deps, rootId, { autoSummarize: false }),
    }
  }

  const board = deps && deps.boardForSession && deps.boardFileFor
    ? deps.boardForSession(deps.boardFileFor(rootId))
    : null
  const payload = found.payload || {}
  const resolvedScope = found.capabilityScope || buildCapabilityScope({
    kind: found.kind,
    tool: payload.tool || found.kind,
    args: payload.args || {},
    cwd: payload.cwd || resolveSessionWorkspaceCwd(deps, rootId),
    target: payload.target || '',
  })
  let execOk = false
  let execRes = null
  let resultMsg = ''

  try {
    if (found.kind === 'tool' && payload.tool) {
      execRes = await executeChiefToolCall(deps, { tool: payload.tool, args: payload.args || {} }, {
        rootId,
        sessionId: payload.sessionId || rootId,
        cwd: payload.cwd || resolveSessionWorkspaceCwd(deps, rootId),
        permissionMode: currentMode === 'chief' ? 'chief' : 'strategist',
        hasChiefRiskAck: currentMode === 'chief',
        policyPlugins: effPolicyPlugins,
        safetyGuardEnabled: effSafetyGuardEnabled,
        capabilityScope: resolvedScope,
        approvedOnce: true,
        board,
        upsertArchiveFn: buildChiefArchiveUpsertFn(deps, rootId),
        compactNowFn: buildChiefCompactFn(deps, rootId),
        recordAuditFn: (entry) => appendChiefAuditLog(rootId, entry),
        by: 'operator(逐项授权)',
      })
      execOk = Boolean(execRes && execRes.ok)
      resultMsg = execOk
        ? `已执行 ${found.operationLabel}（${found.targetLabel}）`
        : (execRes && execRes.error) || '执行未成功'
    } else if (found.kind === 'relay') {
      const scopeCheck = verifyCapabilityScope(resolvedScope, { kind: 'relay', tool: 'relay', target: payload.target || '' })
      if (!scopeCheck.ok) {
        execOk = false
        execRes = { ok: false, deniedByScopeMismatch: true, error: scopeCheck.error }
        resultMsg = scopeCheck.error
        appendChiefAuditLog(rootId, { mode: currentMode, stage: 'scope_guard', rule: scopeCheck.rule, decision: 'rejected', operation: found.operationLabel, target: found.targetLabel, reason: scopeCheck.error, outcome: 'rejected', by: 'operator' })
      } else {
        const guardRes = evaluateSafetyGuardHardRules({ tool: 'relay', opClass: 'workflow', command: payload.text || '', board, safetyGuardEnabled: effSafetyGuardEnabled })
        if (guardRes.blocked) {
          execOk = false
          execRes = { ok: false, blockedBySafetyGuard: true, error: guardRes.reason }
          resultMsg = guardRes.reason
          appendChiefAuditLog(rootId, { mode: currentMode, stage: 'safety_guard', rule: guardRes.rule || 'hard_guard', decision: 'blocked', operation: found.operationLabel, target: found.targetLabel, reason: guardRes.reason, outcome: 'blocked', by: 'operator' })
        } else {
          const deliv = await deliverCrossMessage(deps, {
            fromSession: rootId,
            fromLabel: payload.fromLabel || 'DSH 参谋 (逐项授权)',
            target: payload.target || 'lead',
            subject: payload.subject || '',
            text: payload.text || '',
            mode: payload.mode || 'steer',
            envelopeKind: payload.envelopeKind || 'execution_request',
            taskId: payload.taskId || '',
            imageBlocks: Array.isArray(payload.imageBlocks) ? payload.imageBlocks : [],
            savedImagePaths: Array.isArray(payload.savedImagePaths) ? payload.savedImagePaths : [],
          })
          const isLeadTarget = /^(?:lead|main|主对话)$/i.test(String(payload.target || 'lead').trim())
          if (isLeadTarget && !deliv.deliveryError && (!deliv.ok || (payload.isBlankContext && !deliv.deliveredPhysical)) && deps && typeof deps.stagePendingTransfer === 'function') {
            const staged = deps.stagePendingTransfer(
              `[DSH 参谋预派发指令${payload.subject ? ' · ' + payload.subject : ''}]\n${payload.text || ''}`,
              rootId,
              { by: 'chief', subject: payload.subject || '' },
            )
            if (staged) {
              execOk = true
              execRes = { ...deliv, ok: true, stagedPending: true, target: '主对话(待领)' }
              resultMsg = '已暂存主对话待领交接指令'
            } else {
              execOk = Boolean(deliv && deliv.ok)
              execRes = deliv
              resultMsg = execOk ? `已投递给 ${deliv.target || found.targetLabel}` : ((deliv && deliv.error) || '投递失败')
            }
          } else if (deliv && !deliv.deliveredPhysical && deliv.deliveryError) {
            execOk = false
            execRes = { ...deliv, ok: false, error: deliv.deliveryError }
            resultMsg = deliv.deliveryError
          } else {
            execOk = Boolean(deliv && deliv.ok)
            execRes = deliv
            resultMsg = execOk ? `已投递给 ${deliv.target || found.targetLabel}` : ((deliv && deliv.error) || '投递失败')
          }
          appendChiefAuditLog(rootId, { mode: currentMode, stage: 'executor', rule: 'approved_once', decision: 'executed_approved', operation: found.operationLabel, target: found.targetLabel, reason: clamp(resultMsg, 120), outcome: execOk ? 'ok' : 'error', by: 'operator' })
        }
      }
    } else if (found.kind === 'compact') {
      const guardRes = evaluateSafetyGuardHardRules({ tool: 'session_compact', opClass: 'workflow', board, safetyGuardEnabled: effSafetyGuardEnabled })
      if (guardRes.blocked) {
        execOk = false
        execRes = { ok: false, blockedBySafetyGuard: true, error: guardRes.reason }
        resultMsg = guardRes.reason
      } else {
        execRes = await buildChiefCompactFn(deps, rootId)(payload.reason || found.reason)
        execOk = Boolean(execRes && execRes.ok)
        if (execOk && !execRes.noop) {
          recordSmartCompactionChatReceipt(rootId, {
            cRes: execRes,
            ratioPct: Number(execRes.ratioPct) || 0,
            via: '🛡️ 逐项授权压缩',
          })
        }
        resultMsg = execOk
          ? (execRes.noop ? '已抢救细节入本会话档案柜（当前历史免压）' : '已抢救细节并完成主对话上下文静默压缩')
          : ((execRes && execRes.error) || '压缩未完成')
        appendChiefAuditLog(rootId, { mode: currentMode, stage: 'executor', rule: 'approved_once', decision: 'executed_approved', operation: found.operationLabel, target: found.targetLabel, reason: clamp(resultMsg, 120), outcome: execOk ? 'ok' : 'error', by: 'operator' })
      }
    } else if (found.kind === 'archive_op') {
      const scopeCheck = verifyCapabilityScope(resolvedScope, { kind: 'archive_op', tool: 'archive_op', target: payload.title || payload.id || found.targetLabel || '' })
      if (!scopeCheck.ok) {
        execOk = false
        execRes = { ok: false, deniedByScopeMismatch: true, error: scopeCheck.error }
        resultMsg = scopeCheck.error
        appendChiefAuditLog(rootId, { mode: currentMode, stage: 'scope_guard', rule: scopeCheck.rule, decision: 'rejected', operation: found.operationLabel, target: found.targetLabel, reason: scopeCheck.error, outcome: 'rejected', by: 'operator' })
      } else {
        execRes = await executeChiefArchiveInjectionOp(deps, rootId, payload, { input: found.reason || '', byLabel: 'DSH 参谋 (逐项授权档案调配)' })
        execOk = Boolean(execRes && execRes.ok)
        resultMsg = execOk ? (execRes.actionText || '已完成授权档案调配') : ((execRes && execRes.error) || '档案调配失败')
        appendChiefAuditLog(rootId, { mode: currentMode, stage: 'executor', rule: 'approved_once', decision: 'executed_approved', operation: found.operationLabel, target: found.targetLabel, reason: clamp(resultMsg, 120), outcome: execOk ? 'ok' : 'error', by: 'operator' })
      }
    } else if (found.kind === 'model_effort') {
      const effTarget = payload.target || 'lead'
      const scopeCheck = verifyCapabilityScope(resolvedScope, { kind: 'model_effort', tool: 'model_effort', target: effTarget })
      if (!scopeCheck.ok) {
        execOk = false
        execRes = { ok: false, deniedByScopeMismatch: true, error: scopeCheck.error }
        resultMsg = scopeCheck.error
        appendChiefAuditLog(rootId, { mode: currentMode, stage: 'scope_guard', rule: scopeCheck.rule, decision: 'rejected', operation: found.operationLabel, target: found.targetLabel, reason: scopeCheck.error, outcome: 'rejected', by: 'operator' })
      } else if (deps && typeof deps.controlMainAgent === 'function') {
        execRes = await deps.controlMainAgent({
          rootId,
          sessionId: rootId,
          op: 'set_effort',
          target: effTarget,
          reasoningEffort: payload.reasoningEffort || payload.effort || 'medium',
          reason: payload.reason || found.reason || '',
          byUser: false,
        })
        execOk = Boolean(execRes && execRes.ok)
        resultMsg = execOk
          ? `已将 @${effTarget} 思考强度调为 ${execRes.reasoningEffort || payload.reasoningEffort || 'medium'}`
          : ((execRes && execRes.error) || '思考强度调配未成功')
        appendChiefAuditLog(rootId, { mode: currentMode, stage: execRes && execRes.lockedByUser ? 'model_effort_lock' : 'executor', rule: execRes && execRes.lockedByUser ? 'user_effort_lock' : 'approved_once', decision: execOk ? 'executed_approved' : 'blocked', operation: found.operationLabel, target: found.targetLabel, reason: clamp(resultMsg, 120), outcome: execOk ? 'ok' : 'blocked', by: 'operator' })
      } else {
        execOk = false
        resultMsg = '当前宿主未提供代理思考强度控制接口'
      }
    } else if (found.kind === 'auto_continue') {
      if (deps && typeof deps.triggerAutoContinueNow === 'function') {
        execRes = await deps.triggerAutoContinueNow(payload.sessionId || rootId, payload.trigger || 'turn/end:approved', { detail: payload.detail || '' })
        execOk = Boolean(execRes && execRes.ok)
        resultMsg = execOk ? '已触发主对话断线续跑' : ((execRes && execRes.error) || '断线续跑未触发')
      } else {
        execOk = false
        resultMsg = '当前宿主未提供续跑回调接口'
      }
      appendChiefAuditLog(rootId, { mode: currentMode, stage: 'executor', rule: 'approved_once', decision: 'executed_approved', operation: found.operationLabel, target: found.targetLabel, reason: clamp(resultMsg, 120), outcome: execOk ? 'ok' : 'error', by: 'operator' })
    }
  } catch (err) {
    execOk = false
    execRes = { ok: false, error: (err && err.message) || String(err || 'execution-failed') }
    resultMsg = execRes.error
  }

  let updatedApproval = { ...found, status: execOk ? 'executed' : 'failed', resultMessage: resultMsg }
  let resumeTaskToRun = null
  const linkedTaskId = found.taskId || found.resumeTaskId || ''
  mutateChiefState((state) => {
    const ws = ensureWorkspace(state, rootId)
    const item = (ws.pendingApprovals || []).find(a => a && a.id === approvalId)
    if (item) {
      item.status = execOk ? 'executed' : 'failed'
      item.resultMessage = clamp(resultMsg, 260)
      updatedApproval = { ...item }
    }
    ws.chat.push({
      id: nextId('chat'),
      role: 'chief',
      kind: 'receipt',
      ...(linkedTaskId ? { resumeTaskId: linkedTaskId } : {}),
      text: execOk
        ? `- 【✅ 已允许并执行】${found.operationLabel} · \`${found.targetLabel}\`\n  结果：${clamp(resultMsg, 240)}`
        : `- 【⚠️ 授权操作未完成】${found.operationLabel} · \`${found.targetLabel}\`\n  说明：${clamp(resultMsg, 240)}`,
      actions: [execOk ? '✅ 逐项授权执行' : '⚠️ 授权执行异常'],
      at: Date.now(),
    })
    if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)

    const ledgerList = Array.isArray(ws.taskLedger) ? ws.taskLedger : (Array.isArray(ws.resumeTasks) ? ws.resumeTasks : [])
    if (linkedTaskId) {
      const task = ledgerList.find(t => t && (t.taskId === linkedTaskId || t.id === linkedTaskId))
      if (task) {
        const doneSummary = `${found.operationLabel} (${found.targetLabel}): ${clamp(resultMsg, 140)}`
        const updatedTask = upsertTaskLedgerOnWs(ws, {
          taskId: task.taskId || task.id,
          id: task.taskId || task.id,
          appendCompletedAction: doneSummary,
          lastReceipt: clamp(resultMsg, 240),
        })
        const siblingPending = (ws.pendingApprovals || []).some(
          a => a && a.id !== approvalId && (a.taskId === (task.taskId || task.id) || a.resumeTaskId === (task.taskId || task.id)) && a.status === 'pending',
        )
        if (!execOk) {
          if (updatedTask) {
            updatedTask.status = 'failed'
            updatedTask.updatedAt = Date.now()
            updatedTask.resolvedAt = Date.now()
          }
        } else if (!siblingPending && updatedTask) {
          if (updatedTask.expiresAt && Date.now() > updatedTask.expiresAt) {
            updatedTask.status = 'expired'
            updatedTask.updatedAt = Date.now()
            updatedTask.resolvedAt = Date.now()
          } else if (found.kind === 'tool' && (updatedTask.retryCount || updatedTask.resumeDepth || 0) < 2 && updatedTask.status !== 'resuming') {
            markTaskResumingActive(updatedTask.taskId || updatedTask.id)
            updatedTask.status = 'resuming'
            updatedTask.updatedAt = Date.now()
            resumeTaskToRun = { ...updatedTask }
          } else if (updatedTask.status === 'awaiting_approval') {
            updatedTask.status = 'completed'
            updatedTask.updatedAt = Date.now()
            updatedTask.resolvedAt = Date.now()
          }
        }
      }
    }
  })

  let resumeOut = null
  if (resumeTaskToRun) {
    const rTaskId = resumeTaskToRun.taskId || resumeTaskToRun.id
    const execSummaryJson = (() => {
      try { return JSON.stringify(execRes || {}).slice(0, 1000) } catch { return clamp(resultMsg, 400) }
    })()
    try {
      const spec = resumeTaskToRun.resumeSpec || resumeTaskToRun
      resumeOut = await askOrCommandChief(deps, {
        sessionId: rootId,
        text: spec.originalText || resumeTaskToRun.originalText,
        forcedTarget: spec.forcedTarget || resumeTaskToRun.forcedTarget || '',
        forcedMode: spec.forcedMode || resumeTaskToRun.forcedMode || 'steer',
        _resumeCtx: {
          resumeTaskId: rTaskId,
          resumeDepth: (resumeTaskToRun.retryCount || resumeTaskToRun.resumeDepth || 0) + 1,
          triggerKind: 'approval',
          executedSummary: `${found.operationLabel} (${found.targetLabel}) => ${execSummaryJson}`,
          savedImagePaths: spec.savedImagePaths || resumeTaskToRun.savedImagePaths || [],
        },
      })
      mutateChiefState((st) => {
        const ws = ensureWorkspace(st, rootId)
        const ledgerList = Array.isArray(ws.taskLedger) ? ws.taskLedger : (ws.resumeTasks || [])
        const task = ledgerList.find(t => t && (t.taskId === rTaskId || t.id === rTaskId))
        if (task && (task.status === 'resuming' || task.status === 'verifying')) {
          task.status = 'verifying'
          task.updatedAt = Date.now()
          const verifiedOk = Boolean(resumeOut && resumeOut.ok !== false)
          task.status = verifiedOk ? 'completed' : 'failed'
          task.lastReceipt = clamp((resumeOut && (resumeOut.reply || resumeOut.error)) || resultMsg, 260)
          task.resolvedAt = Date.now()
        }
      })
    } catch (err) {
      resumeOut = { ok: false, error: (err && err.message) || String(err || 'resume failed') }
      mutateChiefState((st) => {
        const ws = ensureWorkspace(st, rootId)
        const ledgerList = Array.isArray(ws.taskLedger) ? ws.taskLedger : (ws.resumeTasks || [])
        const task = ledgerList.find(t => t && (t.taskId === rTaskId || t.id === rTaskId))
        if (task && (task.status === 'resuming' || task.status === 'verifying')) {
          task.status = 'failed'
          task.updatedAt = Date.now()
          task.lastReceipt = clamp(resumeOut.error, 260)
          task.resolvedAt = Date.now()
        }
      })
    } finally {
      unmarkTaskResumingActive(rTaskId)
    }
  }

  const latestBoard = (resumeOut && resumeOut.board)
    || (deps && deps.boardForSession && deps.boardFileFor
      ? deps.boardForSession(deps.boardFileFor(rootId))
      : undefined)
  return {
    ok: true,
    executed: execOk,
    executionOk: execOk,
    approval: updatedApproval,
    result: execRes,
    ...(resumeOut ? { resumed: true, resumeTaskId: resumeTaskToRun.id, resumeReply: resumeOut.reply || '', resumePendingApprovals: resumeOut.pendingApprovals || [] } : {}),
    ...(latestBoard ? { board: latestBoard } : {}),
    view: (resumeOut && resumeOut.view) || await getChiefView(deps, rootId, { autoSummarize: false }),
  }
}

/** 处理模型/主代理提交的权限升级请求；若批准为最高档 L3 必须由后端校验 confirmedChiefRisk。 */
export async function handleElevationDecision(deps, {
  sessionId = '',
  elevationId = '',
  decision = 'reject',
  targetMode = '',
  confirmedChiefRisk = false,
} = {}) {
  const rootId = (deps && typeof deps.resolveRootSessionId === 'function' ? deps.resolveRootSessionId(sessionId) : '') || String(sessionId || 'global')
  const stateBefore = loadChiefState()
  const wsBefore = ensureWorkspace(stateBefore, rootId)
  const elev = wsBefore.pendingElevation
  if (!elev || (elevationId && elev.id !== elevationId)) {
    appendChiefAuditLog(rootId, {
      mode: resolveWorkspaceConfig(stateBefore, rootId).permissionMode,
      stage: 'permission_gate',
      decision: 'invalid_elevation_id',
      operation: '无效提权请求拦截',
      target: clamp(elevationId || '(none)', 80),
      reason: '当前没有匹配的可处理提权申请',
      outcome: 'rejected',
      by: 'operator',
    })
    return { ok: false, error: '当前没有待处理的提权申请' }
  }

  if (decision !== 'approve') {
    mutateChiefState((s) => {
      const ws = ensureWorkspace(s, rootId)
      ws.pendingElevation = null
      const elevTaskId = elev.taskId || elev.resumeTaskId || ''
      const ledgerList = Array.isArray(ws.taskLedger) ? ws.taskLedger : (ws.resumeTasks || [])
      if (elevTaskId) {
        const linkedTask = ledgerList.find(t => t && (t.taskId === elevTaskId || t.id === elevTaskId))
        if (linkedTask) {
          linkedTask.status = 'cancelled'
          linkedTask.updatedAt = Date.now()
          linkedTask.resolvedAt = Date.now()
          linkedTask.lastReceipt = '用户拒绝提权申请'
        }
      }
      pushAuditToWs(ws, {
        mode: resolveWorkspaceConfig(s, rootId).permissionMode,
        stage: 'permission_gate',
        rule: 'elevation_rejected',
        decision: 'elevation_rejected',
        operation: '拒绝提权申请',
        target: `${elev.fromMode} -> ${elev.targetMode}`,
        reason: elev.reason,
        outcome: 'rejected',
        by: 'operator',
      }, rootId)
      ws.chat.push({
        id: nextId('chat'),
        role: 'chief',
        kind: 'receipt',
        text: `- 【🔒 已拒绝提权申请】维持当前权限，未升级至 ${CHIEF_PERMISSION_META[elev.targetMode]?.level || elev.targetMode}。`,
        actions: ['🔒 拒绝提权'],
        at: Date.now(),
      })
      if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
    })
    return { ok: true, rejected: true, view: await getChiefView(deps, rootId, { autoSummarize: false }) }
  }

  const chosenMode = normalizePermissionMode(targetMode || elev.targetMode)
  if (permissionRank(chosenMode) <= 0) {
    return { ok: false, error: '无效的提权目标档位' }
  }
  if (chosenMode === 'chief' && confirmedChiefRisk !== true) {
    appendChiefAuditLog(rootId, {
      mode: resolveWorkspaceConfig(loadChiefState(), rootId).permissionMode,
      stage: 'permission_gate',
      decision: 'deny_unacknowledged_l3',
      operation: 'L3 提权风险校验',
      target: 'chief',
      reason: '批准提权至最高档 L3 前必须勾选风险知悉确认',
      outcome: 'denied',
      by: 'operator',
    })
    return {
      ok: false,
      requireChiefRiskConfirm: true,
      error: '提权至最高档「L3 · 参谋长模式」必须先阅读风险告知并勾选确认（confirmedChiefRisk: true）！',
    }
  }

  const cfgRes = updateChiefConfig({
    sessionId: rootId,
    permissionMode: chosenMode,
    confirmedChiefRisk: chosenMode === 'chief',
    by: 'operator(提权审批)',
  })
  if (!cfgRes || cfgRes.ok === false) {
    return cfgRes || { ok: false, error: '提权应用失败' }
  }

  let resumeTaskToRun = null
  const elevTaskId = elev.taskId || elev.resumeTaskId || ''
  mutateChiefState((s) => {
    const ws = ensureWorkspace(s, rootId)
    ws.pendingElevation = null
    pushAuditToWs(ws, {
      mode: chosenMode,
      stage: 'permission_gate',
      rule: 'elevation_approved',
      decision: 'elevation_approved',
      operation: '批准提权',
      target: `${CHIEF_PERMISSION_META[elev.fromMode]?.level || elev.fromMode} -> ${CHIEF_PERMISSION_META[chosenMode].level}`,
      reason: elev.reason,
      outcome: 'approved',
      by: 'operator',
    }, rootId)
    const meta = CHIEF_PERMISSION_META[chosenMode]
    ws.chat.push({
      id: nextId('chat'),
      role: 'chief',
      kind: 'receipt',
      ...(elevTaskId ? { resumeTaskId: elevTaskId } : {}),
      text: `- 【🔐 已批准提权】当前会话权限已升级为「**${meta.level} · ${meta.title}**」${chosenMode === 'chief' ? '（已完成高风险确认）' : ''}。`,
      actions: [`🔐 升至 ${meta.level}`],
      at: Date.now(),
    })
    if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)

    const ledgerList = Array.isArray(ws.taskLedger) ? ws.taskLedger : (ws.resumeTasks || [])
    if (elevTaskId) {
      const task = ledgerList.find(t => t && (t.taskId === elevTaskId || t.id === elevTaskId))
      if (task) {
        if (task.expiresAt && Date.now() > task.expiresAt) {
          task.status = 'expired'
          task.updatedAt = Date.now()
          task.resolvedAt = Date.now()
        } else if ((task.retryCount || task.resumeDepth || 0) < 2 && task.status !== 'resuming') {
          markTaskResumingActive(task.taskId || task.id)
          task.status = 'resuming'
          task.updatedAt = Date.now()
          resumeTaskToRun = { ...task }
        }
      }
    }
  })

  let resumeOut = null
  if (resumeTaskToRun) {
    const rTaskId = resumeTaskToRun.taskId || resumeTaskToRun.id
    const meta = CHIEF_PERMISSION_META[chosenMode]
    try {
      const spec = resumeTaskToRun.resumeSpec || resumeTaskToRun
      resumeOut = await askOrCommandChief(deps, {
        sessionId: rootId,
        text: spec.originalText || resumeTaskToRun.originalText,
        forcedTarget: spec.forcedTarget || resumeTaskToRun.forcedTarget || '',
        forcedMode: spec.forcedMode || resumeTaskToRun.forcedMode || 'steer',
        _resumeCtx: {
          resumeTaskId: rTaskId,
          resumeDepth: (resumeTaskToRun.retryCount || resumeTaskToRun.resumeDepth || 0) + 1,
          triggerKind: 'elevation',
          executedSummary: `已批准提权至 ${meta.level} · ${meta.title}`,
          savedImagePaths: spec.savedImagePaths || resumeTaskToRun.savedImagePaths || [],
        },
      })
      mutateChiefState((st) => {
        const ws = ensureWorkspace(st, rootId)
        const ledgerList = Array.isArray(ws.taskLedger) ? ws.taskLedger : (ws.resumeTasks || [])
        const task = ledgerList.find(t => t && (t.taskId === rTaskId || t.id === rTaskId))
        if (task && (task.status === 'resuming' || task.status === 'verifying')) {
          task.status = 'verifying'
          task.updatedAt = Date.now()
          task.status = resumeOut && resumeOut.ok !== false ? 'completed' : 'failed'
          task.lastReceipt = clamp((resumeOut && (resumeOut.reply || resumeOut.error)) || `提权至 ${meta.level} 后已自动续跑`, 260)
          task.resolvedAt = Date.now()
        }
      })
    } catch (err) {
      resumeOut = { ok: false, error: (err && err.message) || String(err || 'elevation resume failed') }
      mutateChiefState((st) => {
        const ws = ensureWorkspace(st, rootId)
        const ledgerList = Array.isArray(ws.taskLedger) ? ws.taskLedger : (ws.resumeTasks || [])
        const task = ledgerList.find(t => t && (t.taskId === rTaskId || t.id === rTaskId))
        if (task && (task.status === 'resuming' || task.status === 'verifying')) {
          task.status = 'failed'
          task.updatedAt = Date.now()
          task.lastReceipt = clamp(resumeOut.error, 260)
          task.resolvedAt = Date.now()
        }
      })
    } finally {
      unmarkTaskResumingActive(rTaskId)
    }
  }

  return {
    ok: true,
    approvedMode: chosenMode,
    permissionMode: chosenMode,
    config: cfgRes.config,
    ...(resumeOut ? { resumed: true, resumeTaskId: resumeTaskToRun.id, resumeReply: resumeOut.reply || '', pendingApprovals: resumeOut.pendingApprovals || [] } : {}),
    ...(resumeOut && resumeOut.board ? { board: resumeOut.board } : {}),
    view: (resumeOut && resumeOut.view) || await getChiefView(deps, rootId, { autoSummarize: false }),
  }
}
