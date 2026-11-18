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
  upsertResumeTaskOnWs,
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
import { askOrCommandChief } from './chief-commands.js'

export async function handleSuggestionDecision(deps, { sessionId, suggestionId, decision, editedText, boundField, pinGlobal }) {
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
            })
          : deps.runAction({
              action: 'bounds.add',
              field: col,
              item: ruleText,
              pinned: shouldPin,
              session: rootId === 'global' ? '' : rootId,
              by: 'DSH 参谋长',
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
      view: await getChiefView(deps, rootId, { autoSummarize: false }),
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

    if (sug.kind !== 'bound' && sug.kind !== 'goal_approval') {
      const cmdSample = `${sug.draftText || ''}\n${sug.title || ''}`.trim()
      const guardRes = evaluateSafetyGuardHardRules({
        tool: 'relay',
        opClass: 'workflow',
        command: cmdSample,
        args: { text: sug.draftText || '', title: sug.title || '' },
        board,
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
            by: 'operator',
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
    })

    if (res && res.ok) {
      executed.push({ id: sug.id, kind: sug.kind, title: sug.title, target: sug.targetLabel || sug.target })
      if (res.boundApplied) {
        summaries.push(`✅ 已应用边界「${res.boundApplied.label}」：${clamp(res.boundApplied.item, 44)}`)
      } else if (res.goalApproved) {
        summaries.push('✅ 已批准并结项当前核心目标')
      } else if (res.delivery && res.delivery.target) {
        summaries.push(`✅ 已采纳并递话给 @${res.delivery.target}：「${clamp(sug.title, 36)}」`)
      } else {
        summaries.push(`✅ 已执行建议：「${clamp(sug.title, 40)}」`)
      }
    } else {
      const errMsg = (res && res.error) || '执行未完成'
      failed.push({ id: sug.id, title: sug.title, error: errMsg })
      summaries.push(`⚠️ 未完成「${clamp(sug.title, 36)}」：${errMsg}`)
    }
  }

  mutateChiefState((st) => {
    const ws = ensureWorkspace(st, rootId)
    pushAuditToWs(ws, {
      mode: permMode,
      stage: 'executor',
      decision: executed.length > 0 ? 'executed' : (blocked.length > 0 ? 'blocked' : 'noop'),
      operation: '统一执行参谋建议',
      target: `${executed.length} 项执行 / ${blocked.length} 项拦截 / ${skippedGoals.length} 项跳过`,
      reason: clamp(summaries.slice(0, 3).join('；'), 200) || '批量执行建议',
      outcome: blocked.length > 0 && executed.length === 0 ? 'blocked' : 'ok',
      by: 'operator',
    }, rootId)
    if (executed.length > 0 || blocked.length > 0 || failed.length > 0) {
      const header = `- 【📋 统一执行参谋建议回执】完成 ${executed.length} 项${blocked.length ? ` · 拦截 ${blocked.length} 项` : ''}${failed.length ? ` · 异常 ${failed.length} 项` : ''}${skippedGoals.length ? ` · 保留目标结项请示 ${skippedGoals.length} 项单独拍板` : ''}`
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
    view: await getChiefView(deps, rootId, { autoSummarize: executed.some(e => e.kind === 'bound') }),
  }
}

/** 处理 L2 参谋模式逐项操作授权弹窗（拒绝 / 允许本次操作）。 */
export async function handleApprovalDecision(deps, {
  sessionId = '',
  approvalId = '',
  decision = 'reject',
} = {}) {
  const rootId = (deps && typeof deps.resolveRootSessionId === 'function' ? deps.resolveRootSessionId(sessionId) : '') || String(sessionId || 'global')
  let found = null
  let currentMode = DEFAULT_CHIEF_PERMISSION_MODE
  let existingNonPending = false
  let hashMismatch = false

  mutateChiefState((state) => {
    const ws = ensureWorkspace(state, rootId)
    const ackOk = hasValidChiefRiskAck(ws)
    const eff = resolveWorkspaceConfig(state, rootId)
    currentMode = normalizePermissionMode(eff.permissionMode, { requireAck: true, hasChiefRiskAck: ackOk })
    const item = (ws.pendingApprovals || []).find(a => a && a.id === approvalId && a.status === 'pending')
    if (!item) {
      existingNonPending = (ws.pendingApprovals || []).some(a => a && a.id === approvalId)
      pushAuditToWs(ws, {
        mode: currentMode,
        stage: 'permission_gate',
        decision: existingNonPending ? 'replayed_approval' : 'invalid_approval_id',
        operation: '伪造或重放审批拦截',
        target: clamp(approvalId || '(empty)', 100),
        reason: existingNonPending ? '该操作审批已处理完毕，拒绝重复提交或重放' : '未找到对应的 pending approvalId，拒绝执行',
        outcome: 'rejected',
        by: 'operator',
      }, rootId)
      return
    }

    const expectedHash = computeApprovalPayloadHash(item.kind, item.payload || {})
    if (decision === 'approve' && item.payloadHash && item.payloadHash !== expectedHash) {
      hashMismatch = true
      found = { ...item, payload: item.payload ? { ...item.payload } : {} }
      item.status = 'failed'
      item.resolvedAt = Date.now()
      item.resolvedBy = 'safety_guard'
      item.resultMessage = '审批载荷哈希校验失败（疑似载荷被篡改）'
      if (item.resumeTaskId && Array.isArray(ws.resumeTasks)) {
        const linkedTask = ws.resumeTasks.find(t => t && t.id === item.resumeTaskId)
        if (linkedTask) {
          linkedTask.status = 'failed'
          linkedTask.resolvedAt = Date.now()
        }
      }
      pushAuditToWs(ws, {
        mode: currentMode,
        stage: 'safety_guard',
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
      if (item.resumeTaskId && Array.isArray(ws.resumeTasks)) {
        const linkedTask = ws.resumeTasks.find(t => t && t.id === item.resumeTaskId)
        if (linkedTask) {
          linkedTask.status = 'cancelled'
          linkedTask.resolvedAt = Date.now()
        }
      }
      pushAuditToWs(ws, {
        mode: currentMode,
        stage: 'permission_gate',
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
      const guardRes = evaluateSafetyGuardHardRules({ tool: 'relay', opClass: 'workflow', command: payload.text || '', board })
      if (guardRes.blocked) {
        execOk = false
        execRes = { ok: false, blockedBySafetyGuard: true, error: guardRes.reason }
        resultMsg = guardRes.reason
        appendChiefAuditLog(rootId, { mode: currentMode, stage: 'safety_guard', decision: 'blocked', operation: found.operationLabel, target: found.targetLabel, reason: guardRes.reason, outcome: 'blocked', by: 'operator' })
      } else {
        const deliv = await deliverCrossMessage(deps, {
          fromSession: rootId,
          fromLabel: payload.fromLabel || 'DSH 参谋 (逐项授权)',
          target: payload.target || 'lead',
          subject: payload.subject || '',
          text: payload.text || '',
          mode: payload.mode || 'steer',
          imageBlocks: Array.isArray(payload.imageBlocks) ? payload.imageBlocks : [],
          savedImagePaths: Array.isArray(payload.savedImagePaths) ? payload.savedImagePaths : [],
        })
        const isLeadTarget = /^(?:lead|main|主对话)$/i.test(String(payload.target || 'lead').trim())
        if (isLeadTarget && (!deliv.ok || (payload.isBlankContext && !deliv.deliveredPhysical)) && deps && typeof deps.stagePendingTransfer === 'function') {
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
        } else {
          execOk = Boolean(deliv && deliv.ok)
          execRes = deliv
          resultMsg = execOk ? `已投递给 ${deliv.target || found.targetLabel}` : ((deliv && deliv.error) || '投递失败')
        }
        appendChiefAuditLog(rootId, { mode: currentMode, stage: 'executor', decision: 'executed_approved', operation: found.operationLabel, target: found.targetLabel, reason: clamp(resultMsg, 120), outcome: execOk ? 'ok' : 'error', by: 'operator' })
      }
    } else if (found.kind === 'compact') {
      const guardRes = evaluateSafetyGuardHardRules({ tool: 'session_compact', opClass: 'workflow', board })
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
        appendChiefAuditLog(rootId, { mode: currentMode, stage: 'executor', decision: 'executed_approved', operation: found.operationLabel, target: found.targetLabel, reason: clamp(resultMsg, 120), outcome: execOk ? 'ok' : 'error', by: 'operator' })
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
      appendChiefAuditLog(rootId, { mode: currentMode, stage: 'executor', decision: 'executed_approved', operation: found.operationLabel, target: found.targetLabel, reason: clamp(resultMsg, 120), outcome: execOk ? 'ok' : 'error', by: 'operator' })
    }
  } catch (err) {
    execOk = false
    execRes = { ok: false, error: (err && err.message) || String(err || 'execution-failed') }
    resultMsg = execRes.error
  }

  let updatedApproval = { ...found, status: execOk ? 'executed' : 'failed', resultMessage: resultMsg }
  let resumeTaskToRun = null
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
      ...(found.resumeTaskId ? { resumeTaskId: found.resumeTaskId } : {}),
      text: execOk
        ? `- 【✅ 已允许并执行】${found.operationLabel} · \`${found.targetLabel}\`\n  结果：${clamp(resultMsg, 240)}`
        : `- 【⚠️ 授权操作未完成】${found.operationLabel} · \`${found.targetLabel}\`\n  说明：${clamp(resultMsg, 240)}`,
      actions: [execOk ? '✅ 逐项授权执行' : '⚠️ 授权执行异常'],
      at: Date.now(),
    })
    if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)

    if (found.resumeTaskId && Array.isArray(ws.resumeTasks)) {
      const task = ws.resumeTasks.find(t => t && t.id === found.resumeTaskId)
      if (task) {
        const doneSummary = `${found.operationLabel} (${found.targetLabel}): ${clamp(resultMsg, 140)}`
        const updatedTask = upsertResumeTaskOnWs(ws, {
          id: task.id,
          appendCompletedAction: doneSummary,
        })
        const siblingPending = (ws.pendingApprovals || []).some(
          a => a && a.id !== approvalId && a.resumeTaskId === task.id && a.status === 'pending',
        )
        if (!execOk) {
          if (updatedTask) {
            updatedTask.status = 'failed'
            updatedTask.resolvedAt = Date.now()
          }
        } else if (!siblingPending && updatedTask) {
          if (updatedTask.expiresAt && Date.now() > updatedTask.expiresAt) {
            updatedTask.status = 'expired'
            updatedTask.resolvedAt = Date.now()
          } else if (found.kind === 'tool' && (updatedTask.resumeDepth || 0) < 2 && updatedTask.status !== 'resuming') {
            updatedTask.status = 'resuming'
            resumeTaskToRun = { ...updatedTask }
          } else if (updatedTask.status === 'awaiting_approval') {
            updatedTask.status = 'completed'
            updatedTask.resolvedAt = Date.now()
          }
        }
      }
    }
  })

  let resumeOut = null
  if (resumeTaskToRun) {
    const execSummaryJson = (() => {
      try { return JSON.stringify(execRes || {}).slice(0, 1000) } catch { return clamp(resultMsg, 400) }
    })()
    try {
      resumeOut = await askOrCommandChief(deps, {
        sessionId: rootId,
        text: resumeTaskToRun.originalText,
        forcedTarget: resumeTaskToRun.forcedTarget || '',
        forcedMode: resumeTaskToRun.forcedMode || 'steer',
        _resumeCtx: {
          resumeTaskId: resumeTaskToRun.id,
          resumeDepth: (resumeTaskToRun.resumeDepth || 0) + 1,
          triggerKind: 'approval',
          executedSummary: `${found.operationLabel} (${found.targetLabel}) => ${execSummaryJson}`,
          savedImagePaths: resumeTaskToRun.savedImagePaths || [],
        },
      })
    } catch (err) {
      resumeOut = { ok: false, error: (err && err.message) || String(err || 'resume failed') }
    }
    mutateChiefState((st) => {
      const ws = ensureWorkspace(st, rootId)
      const task = (ws.resumeTasks || []).find(t => t && t.id === resumeTaskToRun.id)
      if (task && task.status === 'resuming') {
        task.status = resumeOut && resumeOut.ok !== false ? 'completed' : 'failed'
        task.resolvedAt = Date.now()
      }
    })
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
      if (elev.resumeTaskId && Array.isArray(ws.resumeTasks)) {
        const linkedTask = ws.resumeTasks.find(t => t && t.id === elev.resumeTaskId)
        if (linkedTask) {
          linkedTask.status = 'cancelled'
          linkedTask.resolvedAt = Date.now()
        }
      }
      pushAuditToWs(ws, {
        mode: resolveWorkspaceConfig(s, rootId).permissionMode,
        stage: 'permission_gate',
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
  mutateChiefState((s) => {
    const ws = ensureWorkspace(s, rootId)
    ws.pendingElevation = null
    pushAuditToWs(ws, {
      mode: chosenMode,
      stage: 'permission_gate',
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
      ...(elev.resumeTaskId ? { resumeTaskId: elev.resumeTaskId } : {}),
      text: `- 【🔐 已批准提权】当前会话权限已升级为「**${meta.level} · ${meta.title}**」${chosenMode === 'chief' ? '（已完成高风险确认）' : ''}。`,
      actions: [`🔐 升至 ${meta.level}`],
      at: Date.now(),
    })
    if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)

    if (elev.resumeTaskId && Array.isArray(ws.resumeTasks)) {
      const task = ws.resumeTasks.find(t => t && t.id === elev.resumeTaskId)
      if (task) {
        if (task.expiresAt && Date.now() > task.expiresAt) {
          task.status = 'expired'
          task.resolvedAt = Date.now()
        } else if ((task.resumeDepth || 0) < 2 && task.status !== 'resuming') {
          task.status = 'resuming'
          resumeTaskToRun = { ...task }
        }
      }
    }
  })

  let resumeOut = null
  if (resumeTaskToRun) {
    const meta = CHIEF_PERMISSION_META[chosenMode]
    try {
      resumeOut = await askOrCommandChief(deps, {
        sessionId: rootId,
        text: resumeTaskToRun.originalText,
        forcedTarget: resumeTaskToRun.forcedTarget || '',
        forcedMode: resumeTaskToRun.forcedMode || 'steer',
        _resumeCtx: {
          resumeTaskId: resumeTaskToRun.id,
          resumeDepth: (resumeTaskToRun.resumeDepth || 0) + 1,
          triggerKind: 'elevation',
          executedSummary: `已批准提权至 ${meta.level} · ${meta.title}`,
          savedImagePaths: resumeTaskToRun.savedImagePaths || [],
        },
      })
    } catch (err) {
      resumeOut = { ok: false, error: (err && err.message) || String(err || 'elevation resume failed') }
    }
    mutateChiefState((st) => {
      const ws = ensureWorkspace(st, rootId)
      const task = (ws.resumeTasks || []).find(t => t && t.id === resumeTaskToRun.id)
      if (task && task.status === 'resuming') {
        task.status = resumeOut && resumeOut.ok !== false ? 'completed' : 'failed'
        task.resolvedAt = Date.now()
      }
    })
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
