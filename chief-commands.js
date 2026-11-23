/**
 * chief-commands.js — 参谋长自然语言指令主循环（`askOrCommandChief`）与 Lead 直连处理入口
 *
 * 【核心职责】
 *   编排底部许愿盒与自然语言指令的完整生命周期：@对讲直传、离线确定性快捷指令、
 *   多轮 Tool-Loop Agentic 调度（经 `chief-executor.js` 安全门禁）、回执解析与建议入列，
 *   以及注册主代理直连勾子 `handleLeadDirectRequestToChief`。
 *
 * 【模块拆分布局】
 *   - `command-helpers.js`  系统提示词常量、活会话摘要、离线智能兜底回复与紧缩判定
 *   - `command-ops.js`      Fact / Board / Archive / Network 变更执行与边界/目标归并
 *   - 本文件同时保留对外的原有全部 8 项函数导出（函数签名与 `.length` 保持不变）。
 */

import path from 'node:path'
import {
  resolveProjectKey,
  listArchiveHeaders,
  getArchiveDetail,
  searchArchives,
  searchGlobalVaultForChief,
  getFlippedOutPrecipitatedForSession,
} from './archives.js'
import {
  DEFAULT_CHIEF_PERMISSION_MODE,
  CHIEF_PERMISSION_META,
  normalizePermissionMode,
  permissionRank,
  getToolOpClass,
  evaluateSafetyGuardHardRules,
  evaluateChiefPermissionGate,
  buildCapabilityScope,
  validateGuardWallInput,
  listGuardWalls,
  CHIEF_TOOLS_PROMPT_GUIDE,
  runChiefAgenticLoop,
  stripToolCallMarkup,
} from './chief-executor.js'
import {
  CHAT_CAP,
  SUGGESTIONS_CAP,
  SUMMARY_MAX_TOKENS,
  archiveTargetForRoot,
  collectChiefVisibleArchives,
  persistChiefImagesToWorkspace,
  admitChiefImages,
  nextId,
  clamp,
  cleanMultiline,
  secretLike,
  hasValidChiefRiskAck,
  normalizeSuggestion,
  resolveWorkspaceConfig,
  appendChiefAuditLog,
  pushAuditToWs,
  queueChiefApproval,
  requestChiefElevation,
  upsertTaskLedgerOnWs,
  enqueueChiefInquiryOnWs,
  loadChiefState,
  mutateChiefState,
  getLinkedCluster,
  setPeerLink,
  ensureWorkspace,
  clusterView,
  shortAgentBriefName,
  stripCheckpointNoise,
  isInternalCheckpointNoise,
  extractJsonObject,
  resolveSessionWorkspaceCwd,
} from './chief-state.js'
import { callChiefLlm } from './chief-models.js'
import {
  collectClusterPeerProgress,
  listPeerDirectory,
  deliverCrossMessage,
  registerChiefDirectRequestHook,
  computeBubbleState,
  resolveExternalHarnessTarget,
} from './chief-network.js'
import { sanitizeConciseBriefText, getChiefView } from './chief-view.js'
import { organizeArchivesWithChief, distillSessionArchivesToGlobal, buildChiefArchiveUpsertFn } from './chief-archives.js'
import { buildChiefCompactFn } from './chief-compaction.js'
import {
  ASK_CHIEF_SYSTEM,
  CONCISE_BRIEF_ASK_EXTRA,
  CONSULT_CHIEF_EXTRA,
  extractFallbackBoundProposalsFromText,
  collectLiveConversationsDigest,
  isPureStatusInquiry,
  isExplicitCompactCommand,
  buildSmartFallbackReply,
  describeThreePartyBoundariesForPrompt,
} from './command-helpers.js'
import {
  applyFactChanges,
  applyBoardOps,
  MAIN_INJECT_ARCHIVE_OPS,
  normalizeArchiveOpName,
  executeChiefArchiveInjectionOp,
  applyArchiveOps,
  applyNetworkOps,
  consolidateBoundsWithChief,
  proposeBoundToChief,
  suggestCoreObjectiveWithChief,
  registerAskOrCommandChiefRunner,
  handleLeadDirectRequestToChief,
} from './command-ops.js'

export { isExplicitCompactCommand }
export {
  applyFactChanges,
  applyBoardOps,
  executeChiefArchiveInjectionOp,
  consolidateBoundsWithChief,
  proposeBoundToChief,
  suggestCoreObjectiveWithChief,
  handleLeadDirectRequestToChief,
}

export async function askOrCommandChief(deps, {
  sessionId = '',
  text = '',
  forcedTarget = '',
  forcedMode = 'steer',
  quickAction = '',
  images = [],
  _resumeCtx = null,
  _fromLeadRequest = false,
  _wallBlockerEscalation = false,
}) {
  const rawInput = cleanMultiline(text, 2000)
  const rawImages = Array.isArray(images) ? images : []
  if (!rawInput && !rawImages.length) {
    return { ok: false, error: '请输入要询问或吩咐参谋长的内容或上传图片' }
  }

  const rootId = deps.resolveRootSessionId(sessionId) || String(sessionId || 'global')
  const resumeTaskId = _resumeCtx && typeof _resumeCtx.resumeTaskId === 'string' ? _resumeCtx.resumeTaskId : ''
  const resumeDepth = _resumeCtx && Number.isFinite(_resumeCtx.resumeDepth) ? Number(_resumeCtx.resumeDepth) : 0
  const isResumeTurn = Boolean(resumeTaskId)
  const canAttachResume = resumeDepth < 2

  const savedImagePaths = rawImages.length > 0
    ? persistChiefImagesToWorkspace(deps, rootId, rawImages)
    : (_resumeCtx && Array.isArray(_resumeCtx.savedImagePaths) ? _resumeCtx.savedImagePaths : [])
  let imageBlocks = []
  if (rawImages.length > 0) {
    try {
      imageBlocks = await admitChiefImages(deps, rawImages)
    } catch (err) {
      if (!savedImagePaths.length) {
        return { ok: false, error: String(err && err.message ? err.message : err) }
      }
      imageBlocks = []
    }
  }

  const effectiveImgCount = Math.max(imageBlocks.length, savedImagePaths.length)
  const input = rawInput || '请结合我上传的图片进行分析处理。'
  const userDisplayText = rawInput || `[上传图片 ×${effectiveImgCount}]`
  const imgMeta = effectiveImgCount > 0 ? { imageCount: effectiveImgCount } : {}

  const directory = await listPeerDirectory(deps, rootId)
  const board = deps.boardForSession(deps.boardFileFor(rootId))
  const state = loadChiefState()
  const effCfg = resolveWorkspaceConfig(state, rootId)
  const policyPlugins = Array.isArray(effCfg.policyPlugins) ? effCfg.policyPlugins : []
  const ownWs = ensureWorkspace(state, rootId)
  const hasChiefRiskAck = hasValidChiefRiskAck(ownWs)
  const permissionMode = normalizePermissionMode(effCfg.permissionMode || DEFAULT_CHIEF_PERMISSION_MODE, {
    requireAck: true,
    hasChiefRiskAck,
  })
  const permRank = permissionRank(permissionMode)
  const isConciseBrief = Boolean(effCfg.tacticalModes && effCfg.tacticalModes.conciseBrief)
  const view = clusterView(state, rootId)
  const targetOpt = archiveTargetForRoot(deps, rootId)
  const peerProgress = Array.isArray(directory.cluster) && directory.cluster.length > 1
    ? collectClusterPeerProgress(deps, directory.cluster, rootId)
    : []

  const persistTurnChatAndResume = (ws, {
    chiefText,
    actions = [],
    elevationObj = null,
    pendingApprovalList = [],
    target = '',
    forceReceipt = false,
    thinkingEffort = '',
    thinkingEffortMode = '',
  }) => {
    const cleanActions = Array.isArray(actions) ? actions.filter(Boolean) : []
    const isReceipt = Boolean(isResumeTurn || _fromLeadRequest || forceReceipt || elevationObj || pendingApprovalList.length > 0 || cleanActions.length > 0)
    const finalActions = isResumeTurn
      ? [...new Set(['⚡ 授权自动续跑', ...cleanActions])].slice(0, 8)
      : cleanActions.slice(0, 8)
    if (!isResumeTurn && !_fromLeadRequest) {
      ws.chat.push({
        id: nextId('chat'),
        role: 'user',
        text: userDisplayText,
        ...(target ? { target } : {}),
        ...imgMeta,
        actions: [],
        at: Date.now(),
      })
    }
    let attachedTaskId = resumeTaskId
    if (canAttachResume && (elevationObj || pendingApprovalList.length > 0)) {
      const aprIds = pendingApprovalList.map(a => a && a.id).filter(Boolean)
      const primaryApr = pendingApprovalList.find(Boolean) || null
      const task = upsertTaskLedgerOnWs(ws, {
        ...(resumeTaskId ? { id: resumeTaskId, taskId: resumeTaskId } : {}),
        kind: aprIds.length > 0 ? 'approval_resume' : 'elevation_resume',
        status: aprIds.length > 0 ? 'awaiting_approval' : 'awaiting_elevation',
        capabilityScope: primaryApr && primaryApr.capabilityScope ? primaryApr.capabilityScope : null,
        payloadHash: primaryApr && primaryApr.payloadHash ? primaryApr.payloadHash : '',
        resumeSpec: {
          originalText: input,
          forcedTarget,
          forcedMode,
          savedImagePaths,
        },
        originalText: input,
        forcedTarget,
        forcedMode,
        savedImagePaths,
        retryCount: resumeDepth,
        resumeDepth,
        elevationId: elevationObj ? elevationObj.id : '',
        pendingApprovalIds: aprIds,
        ...(_resumeCtx && _resumeCtx.executedSummary ? { appendCompletedAction: _resumeCtx.executedSummary } : {}),
      })
      if (task) {
        attachedTaskId = task.id
        if (elevationObj) {
          elevationObj.taskId = task.id
          elevationObj.resumeTaskId = task.id
          if (task.expiresAt) elevationObj.expiresAt = task.expiresAt
          if (ws.pendingElevation && ws.pendingElevation.id === elevationObj.id) {
            ws.pendingElevation.taskId = task.id
            ws.pendingElevation.resumeTaskId = task.id
            if (task.expiresAt) ws.pendingElevation.expiresAt = task.expiresAt
          }
        }
        if (aprIds.length > 0) {
          const idSet = new Set(aprIds)
          for (const listRef of [pendingApprovalList, ws.pendingApprovals]) {
            if (!Array.isArray(listRef)) continue
            for (const apr of listRef) {
              if (apr && idSet.has(apr.id)) {
                apr.taskId = task.id
                apr.resumeTaskId = task.id
                if (task.expiresAt && !apr.expiresAt) apr.expiresAt = task.expiresAt
              }
            }
          }
        }
      }
    }
    ws.chat.push({
      id: nextId('chat'),
      role: 'chief',
      kind: isReceipt ? 'receipt' : 'qa',
      ...(attachedTaskId ? { resumeTaskId: attachedTaskId } : {}),
      ...(thinkingEffort ? { thinkingEffort } : {}),
      ...(thinkingEffortMode ? { thinkingEffortMode } : {}),
      text: chiefText,
      actions: finalActions,
      at: Date.now(),
    })
    if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
    return attachedTaskId
  }

  const denyChiefSystemInAdvisor = async (opName, reasonText) => {
    const elev = requestChiefElevation(rootId, {
      fromMode: permissionMode,
      targetMode: 'assistant',
      reason: reasonText,
      requestedActionSummary: clamp(input, 160),
      by: 'chief',
    })
    appendChiefAuditLog(rootId, {
      mode: permissionMode,
      stage: 'permission_gate',
      decision: 'deny_mode',
      operation: opName,
      target: 'chief_system',
      reason: reasonText,
      outcome: 'denied',
      by: 'chief',
    })
    const denyReply = `- 【🔒 权限受限（当前 L0 顾问只读）】${reasonText}\n- 【🔐 已发起提权请示】请点击顶部「🔐 同意提权至 L1 · 助手模式」弹窗后再执行参谋系统维护。`
    mutateChiefState((s) => {
      const ws = ensureWorkspace(s, rootId)
      persistTurnChatAndResume(ws, {
        chiefText: denyReply,
        actions: ['🔒 L0 顾问只读', ...(elev ? ['🔐 请示提权 L1'] : [])],
        elevationObj: elev,
        forceReceipt: true,
      })
    })
    return {
      ok: true,
      deniedByMode: true,
      elevationRequested: elev,
      reply: denyReply,
      relays: [],
      memoryChanges: [],
      boardOps: [],
      actionBadges: ['🔒 L0 顾问只读', ...(elev ? ['🔐 请示提权 L1'] : [])],
      view: await getChiefView(deps, rootId, { autoSummarize: false }),
    }
  }

  // Fast path: if user explicitly picked a concrete target pill AND used direct relay mode without asking chief to decompose
  if (forcedTarget && forcedTarget !== 'auto') {
    const delivery = await deliverCrossMessage(deps, {
      fromSession: rootId,
      fromLabel: '用户 (经 DSH 参谋长)',
      target: forcedTarget,
      text: rawInput || '请查看随信附带的图片与落盘路径。',
      mode: ['steer', 'followup', 'silent'].includes(forcedMode) ? forcedMode : 'steer',
      imageBlocks,
      savedImagePaths,
    })
    const reply = delivery.ok
      ? `已按你的指定向 ${delivery.target || forcedTarget} ${forcedMode === 'steer' ? '插话' : forcedMode === 'silent' ? '投递备忘纸条' : '递话'}${effectiveImgCount ? `（附带 ${effectiveImgCount} 张图片，原图已落盘）` : ''}${delivery.note ? '（' + delivery.note + '）' : '。'}`
      : `投递失败：${delivery.error}`

    mutateChiefState((s) => {
      const ws = ensureWorkspace(s, rootId)
      persistTurnChatAndResume(ws, {
        chiefText: reply,
        target: forcedTarget,
        actions: [delivery.ok ? `→ ${delivery.target || forcedTarget}` : '投递失败'],
        forceReceipt: true,
      })
    })

    return {
      ok: delivery.ok,
      reply,
      relays: [delivery],
      savedImagePaths,
      memoryChanges: [],
      boardOps: [],
      view: await getChiefView(deps, rootId, { autoSummarize: false, chatTriggered: !_fromLeadRequest }),
    }
  }

  // Direct natural-language command to organize/curate the Engineering Archive Cabinet (`整理档案` / `收纳档案`)
  if (!forcedTarget || forcedTarget === 'auto') {
    if (/(?:档案|卷宗|老笔记)/.test(input) && /(?:整理|收纳|归类|分拣|拆解)/.test(input)) {
      if (permRank < 1) {
        return denyChiefSystemInAdvisor('整理参谋档案', '整理与归类档案库属于「参谋系统维护」操作，需「L1 · 助手模式」及以上权限。')
      }
      const orgScope = /全局/.test(input) ? 'global' : 'session'
      const orgRes = await organizeArchivesWithChief(deps, {
        sessionId: rootId,
        vaultScope: orgScope,
        scope: /全部|所有|全柜/.test(input) ? 'all' : 'unorganized',
        instruction: input,
      })
      if (orgRes.ok) {
        appendChiefAuditLog(rootId, {
          mode: permissionMode,
          stage: 'executor',
          decision: 'executed',
          operation: '整理参谋档案',
          target: orgScope,
          reason: clamp(input, 120),
          outcome: 'ok',
          by: 'chief',
        })
        if (isResumeTurn) {
          mutateChiefState((s) => {
            const ws = ensureWorkspace(s, rootId)
            persistTurnChatAndResume(ws, {
              chiefText: orgRes.reply,
              actions: [`收纳档案 ${orgRes.updatedCount} 卷`],
              forceReceipt: true,
            })
          })
        }
        return {
          ok: true,
          reply: orgRes.reply,
          relays: [],
          memoryChanges: [],
          boardOps: [`收纳档案 ${orgRes.updatedCount} 卷`],
          archives: orgRes.archives,
          view: orgRes.view,
        }
      }
    }
  }

  // 0-Token Precipitated Vault Contract: ONLY read precipitated vault if this session EXPLICITLY flipped entries out!
  const flippedIds = Array.isArray(ownWs.flippedPrecipitatedIds) ? ownWs.flippedPrecipitatedIds : []
  const flippedVaultLines = []
  if (flippedIds.length > 0) {
    const projectKey = resolveProjectKey(targetOpt.cwd)
    const flippedItems = getFlippedOutPrecipitatedForSession(projectKey, rootId, true, targetOpt)
    if (flippedItems.length > 0) {
      flippedVaultLines.push('', '## 8. 本会话已显式翻出的跨会话沉淀经验（仅包含用户显式翻出授权的条目）')
      for (const entry of flippedItems) {
        flippedVaultLines.push(`- 🏛️ [沉淀/${entry.category}] 《${entry.title}》：${entry.summary}`)
        if (Array.isArray(entry.points) && entry.points.length > 0) {
          for (const pt of entry.points.slice(0, 4)) {
            flippedVaultLines.push(`    * ${pt.title}：${clamp(pt.detail || pt.cue, 200)}`)
          }
        } else if (entry.body) {
          flippedVaultLines.push(`    * 正文：${clamp(entry.body, 280)}`)
        }
      }
    }
  }

  // Watch session & hooked global archives in background (cold vault is 100% isolated from Chief & Lead!)
  const visibleArchives = collectChiefVisibleArchives(deps, rootId, state)
  const watchLines = []
  const fmtWatchTag = (label, it) => `[${label}${it.id ? ` | id=${it.id}` : ''}] 《${clamp(it.title, 36)}》：${clamp(it.summary || it.hookCue, 80)}`
  const watchEntries = [
    ...visibleArchives.deskSessionItems.map(it => fmtWatchTag('桌面·本局(主与参谋共阅)', it)),
    ...visibleArchives.deskGlobalItems.map(it => fmtWatchTag('桌面·全局(主与参谋共阅)', it)),
    ...visibleArchives.deskFlippedItems.map(it => fmtWatchTag('桌面·冷藏已翻牌(主与参谋共阅)', it)),
    ...visibleArchives.mountedGlobalItems.map(it => fmtWatchTag('全局已拉阅·主隐', it)),
    ...((visibleArchives.sessionItems || []).filter(it => !it.takenOut).slice(0, 8).map(it => `[本局档案·参谋随时可读${it.hasHook ? ' 🪝已织钩' : ' (未织钩)'} | id=${it.id}] 《${clamp(it.title, 36)}》：${clamp(it.summary, 70)}`)),
    ...((visibleArchives.recentlyUnpinnedWatch || []).slice(0, 4).map(w => `[刚撤下桌面·待观察归位 | id=${w.id}] 《${clamp(w.title, 36)}》`)),
    ...((visibleArchives.globalHookIndex || []).slice(0, 8).map(it => `[全局钩子·参谋见钩可拉(发 pull_global) | id=${it.id}] 《${clamp(it.title, 36)}》 🪝[${(it.hookKeywords || []).slice(0, 3).join('·')}] ${clamp(it.hookCue, 60)}`)),
  ]
  if (watchEntries.length > 0) {
    watchLines.push('', '## 9. 参谋长档案馆线索与认知桌面（冷库严密隔离；桌面主对话可见；全局仅暴露已织钩子）', ...watchEntries.map(x => '- ' + x))
  }

  // On-demand lazy archive lookup ONLY when the user explicitly asks Chief about archives (searches Session + Hooked Global Vault; unhooked Global/Cold blocked)
  const asksArchiveExplicitly = /(?:档案|卷宗|归档|以前|历史记录|工程坐标|老笔记|全局|查一下.*(?:怎么|路径|命令|配置))/.test(input)
  const onDemandArchiveLines = []
  if (asksArchiveExplicitly) {
    const sessionTarget = rootId && rootId !== 'global' ? archiveTargetForRoot(deps, rootId, { vaultScope: 'session' }) : null
    const globalTarget = archiveTargetForRoot(deps, rootId, { vaultScope: 'global' })
    const foundSess = sessionTarget ? searchArchives(input, { limit: 3, vaultScope: 'session' }, sessionTarget) : { ok: true, hits: [] }
    const foundGlobRaw = searchGlobalVaultForChief(input, { limit: 5 }, globalTarget)
    const pulledOrDeskGlobIds = new Set([
      ...(visibleArchives.mountedGlobalItems || []).map(x => x.id),
      ...(visibleArchives.deskGlobalItems || []).map(x => x.id),
    ])
    const foundGlobHits = (Array.isArray(foundGlobRaw.hits) ? foundGlobRaw.hits : []).filter(h => h && h.hasHook === true).slice(0, 3)
    const combinedHits = [
      ...(Array.isArray(foundSess.hits) ? foundSess.hits.map(h => ({ ...h, _scope: 'session', _scopeLabel: '本会话档案', _target: sessionTarget })) : []),
      ...foundGlobHits.map(h => ({ ...h, _scope: 'global', _scopeLabel: '系统全局档案(已织钩)', _target: globalTarget })),
    ]
    if (combinedHits.length > 0) {
      onDemandArchiveLines.push('', '## 7. 按需检索到的档案卷宗（仅本局与已织钩全局；未拉阅全局仅展示钩子）')
      for (let i = 0; i < combinedHits.length; i += 1) {
        const hit = combinedHits[i]
        if (hit._scope === 'global' && !pulledOrDeskGlobIds.has(hit.id)) {
          onDemandArchiveLines.push(`- 🪝 [全局钩子待拉阅/${hit.folderLabel} | id=${hit.id}] 《${hit.title}》 关键词=[${(hit.hookKeywords || []).join('·')}] ${clamp(hit.hookCue || hit.summary, 90)}（如需详情可输出 archiveOps pull_global）`)
          continue
        }
        onDemandArchiveLines.push(`- 📎 [${hit._scopeLabel}/${hit.folderLabel}] 《${hit.title}》：${hit.summary}`)
        if (i < 3) {
          const det = getArchiveDetail(hit.id, rootId, hit._target)
          if (det.ok && det.item && Array.isArray(det.item.points)) {
            for (const pt of det.item.points.slice(0, 4)) {
              onDemandArchiveLines.push(`    * ${pt.title}：${clamp(pt.detail || pt.cue, 180)}`)
            }
          }
        }
      }
    }
  }

  // Gather real-time conversation stream + cursor + dual-tier bounds + task breakdown
  const liveDigest = collectLiveConversationsDigest(deps, rootId, directory)
  const numberedFacts = view.facts.slice()
  const tasks = Array.isArray(board && board.tasks) ? board.tasks : []
  const doingTasks = tasks.filter(t => t.status === 'doing')
  const blockedTasks = tasks.filter(t => t.status === 'blocked')
  const todoTasks = tasks.filter(t => t.status === 'todo')
  const doneTasks = tasks.filter(t => t.status === 'done')
  const cursor = (board && board.cursor) || {}
  const pinnedBounds = (board && board.pinnedBounds) || { allowed: [], forbidden: [], notes: [] }
  const allBounds = (board && board.bounds) || { allowed: [], forbidden: [], notes: [] }
  const fmtBoundCol = (col) => {
    const list = allBounds[col] || []
    if (!list.length) return '（无）'
    const pinSet = new Set(pinnedBounds[col] || [])
    return list.map(x => `${pinSet.has(x) ? '📌[全局定住] ' : '[本任务] '}${x}`).join('；')
  }

  const meaningfulPeers = directory.targets.filter(
    t => t.kind === 'lead' || t.status === 'running' || !/^mnemon-review/i.test(String(t.name || t.handle || '')),
  )
  const hiddenIdleProbes = Math.max(0, directory.targets.length - meaningfulPeers.length)
  const bubbleCtx = computeBubbleState(deps, rootId, loadChiefState(), directory)
  const bubbleLines = []
  if (bubbleCtx.enrolledHarnesses.length > 0 || bubbleCtx.availableHarnesses.length > 0) {
    bubbleLines.push(
      '',
      '## 6.6 当前协同水泡编队与可用外部工具（可用 relays 的 target="claude-code"|"codex" 派单）',
      `- 水泡结构锁状态: ${bubbleCtx.locked ? `已锁死 (${bubbleCtx.lockReason || '保护中'})` : '整备中（未锁死）'}`,
    )
    if (bubbleCtx.enrolledHarnesses.length > 0) {
      bubbleLines.push(
        ...bubbleCtx.enrolledHarnesses.map(h => `- [已入泡] provider="${h.provider}" | 名称="${h.label || h.provider}" | 通道=${h.transport || 'dsh-subagent'}${h.configLabel ? ` (${h.configLabel})` : ''} | 状态=${h.running ? '执行中' : (h.installed ? '待命可派单' : '未检测到本地/插件')}`),
      )
    }
    if (bubbleCtx.availableHarnesses.length > 0) {
      bubbleLines.push(
        ...bubbleCtx.availableHarnesses.map(h => `- [本机待命可用] provider="${h.provider}" | 名称="${h.label || h.provider}" | 通道=${h.transport || 'dsh-subagent'}${h.configLabel ? ` (${h.configLabel})` : ''}（水泡未锁死时可直接用 relays 派单并自动入泡）`),
      )
    }
  }

  const promptLines = [
    '## 1. 当前可通信成员名录 (Peers)',
    ...(meaningfulPeers.length
      ? meaningfulPeers.slice(0, 16).map(t => `- key="${t.key}" | 名称="${t.handle}" | 类型=${t.kind} | 状态=${t.status}${t.taskTitle ? ' | 当前负责: ' + t.taskTitle : ''}`)
      : ['- key="lead" | 名称="主对话" | 类型=lead']),
    ...(hiddenIdleProbes > 0 ? [`（另有 ${hiddenIdleProbes} 个已空闲后台检查点探针已折叠）`] : []),
    ...((directory.otherSessions && directory.otherSessions.length > 0)
      ? [
          '',
          '## 1.5 本机其他独立会话窗口（可用许愿框 networkOps 连接 link / 断开 unlink）',
          ...directory.otherSessions.slice(0, 12).map(s => `- sessionId="${s.id}" | 名称="${s.name}" | 状态=${s.status} | 已互联=${s.linked ? '是' : '否'}${s.objective ? ' | 目标=' + clamp(s.objective, 50) : ''}`),
        ]
      : []),
    '',
    '## 2. 主对话与子代理【实时对话流现场快照】(Live Transcripts)',
    ...(liveDigest.summaryLines.length
      ? liveDigest.summaryLines
      : ['（当前暂无活跃对话流消息）']),
    '',
    '## 3. 参谋看板目标、断点游标与任务图态势',
    `- 总目标: ${board.objective || '（未设）'}`,
    `- 实时断点游标 (Cursor): 当前步骤="${cursor.step || '无'}" | 下一步="${cursor.next || '无'}" | 阻塞点="${cursor.blocked || '无'}"`,
    `- 计划步骤 (Plan): ${((board.plan || []).slice(0, 8).map(s => `${s.done ? '[✓]' : '[ ]'} ${clamp(s.text, 60)}`).join('；')) || '（无）'}`,
    `- 🔴 受阻任务 (${blockedTasks.length} 项): ${blockedTasks.slice(0, 6).map(t => `#${t.id} ${t.title}${t.owner ? '(@' + shortAgentBriefName(t.owner) + ')' : ''}${t.note ? ' [原因:' + clamp(t.note, 80) + ']' : ''}`).join('；') || '（无）'}`,
    `- 🔵 推进中任务 (${doingTasks.length} 项): ${doingTasks.slice(0, 6).map(t => `#${t.id} ${t.title}${t.owner ? '(@' + shortAgentBriefName(t.owner) + ')' : ''}${t.note ? ' [' + clamp(t.note, 60) + ']' : ''}`).join('；') || '（无）'}`,
    `- ⚪ 待办任务 (${todoTasks.length} 项): ${todoTasks.slice(0, 6).map(t => `#${t.id} ${t.title}${t.owner ? '(@' + shortAgentBriefName(t.owner) + ')' : ''}`).join('；') || '（无）'}`,
    `- ✅ 最近完成 (${doneTasks.length} 项): ${doneTasks.slice(-5).map(t => `#${t.id} ${t.title}${t.evidence ? ' [证据:' + clamp(t.evidence, 60) + ']' : ''}`).join('；') || '（无）'}`,
    '',
    '## 4. 当前生效边界（📌全局定住 vs 本任务）',
    `- 禁止红线 (forbidden): ${fmtBoundCol('forbidden')}`,
    `- 必做事项 (allowed): ${fmtBoundCol('allowed')}`,
    `- 注意事项 (notes): ${fmtBoundCol('notes')}`,
    '',
    '## 5. 编号持久记忆条目 (Facts)',
    ...(numberedFacts.length
      ? numberedFacts.map((f, idx) => `[${idx + 1}] (${f.category}) ${f.text}`)
      : ['（暂无条目）']),
    '',
    '## 6. 近期回合摘要与协同信箱参考',
    ...((board.memory || [])
      .filter(m => m && !isInternalCheckpointNoise(m.title || m.text))
      .slice(-6)
      .map(m => `- [回合/${m.section}] ${clamp(stripCheckpointNoise(m.title || m.text), 150)}`)),
    ...(peerProgress.length > 0
      ? [
          '',
          '## 6.5 当前互通协同网络邻居实时进度（已共享进度）',
          ...peerProgress.map(p => `- 🌐 [${p.title}] ${p.objective ? `目标="${p.objective}" | ` : ''}${p.progressSummary || '暂无板卡进度'}${p.cursorStep ? ` | 当前="${p.cursorStep}"` : ''}`),
        ]
      : []),
    ...bubbleLines,
    ...(view.mailbox.slice(-4).map(m => `- [信箱 ${m.from} → @${m.to}] ${clamp(m.text, 120)}`)),
    ...onDemandArchiveLines,
    ...flippedVaultLines,
    ...watchLines,
    '',
    `## 参谋长执行权限与显示模式：permissionMode=${permissionMode}${isConciseBrief ? ' | 极简战报=开启' : ''}`,
    describeThreePartyBoundariesForPrompt(permissionMode),
    '## 用户刚刚对你说的话：',
    input,
    ...(_resumeCtx && _resumeCtx.resumeTaskId
      ? [
          '',
          `## ⚡ 系统授权恢复执行上下文（自动续跑事务 #${_resumeCtx.resumeTaskId}，当前权限：${permissionMode}）`,
          _resumeCtx.triggerKind === 'elevation'
            ? '- 用户已刚刚批准上述权限升级请求！现在请直接基于用户原始指令调用所需实权工具或动作继续完成任务、核验结果并输出总结回执（切勿只回复“收到”或重复申请刚才的提权）。'
            : `- 用户已逐项批准并执行完成上一步受控操作：\n${_resumeCtx.executedSummary || '（已执行完成）'}\n- **严禁重复调用刚才已执行完毕的同一写操作/终端命令**！请立即核验当前状态、继续执行用户原指令中尚未完成的后续步骤（若有），完成后输出清晰的结构化结项回执。`,
        ]
      : []),
    ...(savedImagePaths.length > 0
      ? [
          '',
          `🖼️ 用户随信上传了 ${savedImagePaths.length} 张原图（已真实落盘到工作区）：`,
          ...savedImagePaths.map(p => `- ${p.path}`),
          '（重要提示：若当前参谋长模型不支持视觉看图，请把任务与上述绝对路径直接调度/递话给支持看图或读文件工具的主对话 @lead / 子代理处理，严禁臆造图内细节！）',
        ]
      : []),
  ]

  const liveSessObj = (() => {
    try {
      const sessSvc = deps && deps.runtime && typeof deps.runtime.get === 'function' ? deps.runtime.get('sessions') : null
      return sessSvc && typeof sessSvc.get === 'function' ? sessSvc.get(rootId) : null
    } catch {
      return null
    }
  })()
  const hasLiveSessionHistory = Boolean(liveSessObj && liveSessObj.blank !== true && Number(liveSessObj.seq || 0) > 0)
  const isBlankContext = Boolean(
    liveDigest.summaryLines.length === 0
    && !board.objective
    && !(board.plan || []).length
    && !(board.tasks || []).length
    && !(board.memory || []).length
    && !(board.log || []).length
    && !Object.keys(board.sessions || {}).length
    && !Number(ownWs && ownWs.runtimeGuard && ownWs.runtimeGuard.lastCompactedSeq)
    && !hasLiveSessionHistory,
  )
  const resolvedCwd = deps && typeof deps.getSessionCwd === 'function' ? deps.getSessionCwd(rootId) : ''
  const cwdForPromptWalls = resolveSessionWorkspaceCwd(deps, rootId) || resolvedCwd
  const activeDynamicWalls = listGuardWalls({ cwd: cwdForPromptWalls }).filter(w => w && w.scope !== 'paused')
  if (activeDynamicWalls.length > 0) {
    promptLines.push(
      '',
      '## 6.8 当前生效自定义拦截规则参考（仅作阻断排查，严禁私拆；仅代理命中拦截无法绕过上报且确无法继续时才可请示审批）',
      ...activeDynamicWalls.slice(0, 8).map(w => `- [${w.id}] (${w.scope}/${w.ruleType}) ${w.title} :: ${Array.isArray(w.patterns) ? w.patterns.join(', ') : ''}`),
    )
  }
  const explicitCompactReq = !imageBlocks.length && isExplicitCompactCommand(input)
  const statusOnlyInquiry = !imageBlocks.length && !explicitCompactReq && quickAction !== 'consult_chief' && !_wallBlockerEscalation && isPureStatusInquiry(input)
  const userExplicitDirect = /(?:参谋长.*?(?:亲自|自己|直接|别找主)|你自己(?:动手|改|跑|查|写)|别派发|勿转主对话)/.test(input)
  const hasLiveLead = Boolean(
    deps
    && deps.runtime
    && typeof deps.runtime.get === 'function'
    && deps.runtime.get('agents')
    && typeof deps.runtime.get('agents').get === 'function'
    && deps.runtime.get('agents').get(rootId),
  )
  const lazyDeferWorkspaceWritesToLead = Boolean(
    !isResumeTurn
    && !_fromLeadRequest
    && !userExplicitDirect
    && hasLiveLead
    && permissionMode === 'chief',
  )

  const effectiveSystem = [
    ASK_CHIEF_SYSTEM,
    ...(isConciseBrief ? [CONCISE_BRIEF_ASK_EXTRA] : []),
    ...(quickAction === 'consult_chief' ? [CONSULT_CHIEF_EXTRA] : []),
    ...(_wallBlockerEscalation
      ? [
          '',
          '🚧 【当前正在评估主/子代理提交的“阻断上报”】：',
          '- 请严格核对代理是否真的命中了上述自定义拦截规则，以及**是否真的没有任何合法替代途径继续完成任务**；',
          '- 若有替代做法（如改用只读核查、调整目标路径/命令或分步处理），**绝不申请关闭规则**，直接在 `reply` 中给出合法绕行路径即可；',
          '- 只有确认确被某条规则彻底卡死无法推进时，才可在 `"wallRemovalProposals"` 中提出针对该精确 `wallId` 的暂停/删除申请单供人类逐项批示！',
        ]
      : []),
    ...(isBlankContext
      ? [
          '',
          '🌱 【当前处于空白新上下文（主对话尚未开聊 · 首轮勘探与计划立项策略）】：',
          resolvedCwd ? `- 当前已解析工作区根目录：${resolvedCwd}` : '',
          !userExplicitDirect
            ? '- 默认开场铁律：首轮优先通过 `"relays"`（`target: "lead"`, `mode: "followup"`）向主对话 @lead 下发开场执行请求，要求主对话：① 先只读勘探代码库与目录结构；② 调用 `chief_board({ action: "graph.plan" })` / 计划工具进入计划模式立项拆解；③ 得出明确结论后调用 `chief_board({ action: "chief.request", subject: "勘探与计划回报", text: "..." })` 回报给参谋长。若当前为 L0/L1 权限不足以投递工作流指令，请同时填写 `"elevationRequest": { "targetMode": "strategist", "reason": "空白新对话首轮需授权向主对话下发勘探与计划立项指令" }`，并将完整勘探请求放进 `"relays"` 或建议备妥（绝对禁止向用户输出 `<｜DSML｜calls>` 等原始工具标签）。'
            : '- 用户已明确点名由你亲自排查/处理工作区，请依据当前 `permissionMode` 调用真实 JSON `toolCalls` 工具（`list_dir` / `search_files` / `read_file` / `edit_file` / `run_command`）处理并如实汇报；绝对禁止向用户输出 `<｜DSML｜calls>` 等原始工具调用标签！',
          '- 若尚无主对话历史，除非用户明确命令且会话已存在，不要无故调用 `session_compact`。',
        ].filter(Boolean)
      : []),
    ...(statusOnlyInquiry
      ? [
          '',
          '⚡ 【当前问题属于「主对话/团队实时态势询问」快速通道】：',
          '- 严禁调用任何工具，严禁输出任何 XML/DSML 工具标签（如 `<｜DSML｜calls>`），严禁扫盘或运行 Shell！',
          '- 请直接根据上下文里已经给出的「实时对话流快照」「小任务板 (Plan)」「任务图」「断点游标」与「协同邻居进度」，输出唯一合法 JSON（仅填 `"reply"`，`"toolCalls": []`）。',
        ]
      : []),
    '',
    CHIEF_TOOLS_PROMPT_GUIDE,
  ].join('\n')

  const upsertArchiveFn = buildChiefArchiveUpsertFn(deps, rootId)
  const compactNowFn = buildChiefCompactFn(deps, rootId)

  const askReasonKind = statusOnlyInquiry
    ? 'quick_status'
    : (/筑墙|物理墙|拦截规则|guard.?wall/i.test(input)
        ? 'craft_wall'
        : (isBlankContext
            ? 'blank_explore'
            : ((effCfg.tacticalModes && effCfg.tacticalModes.intervention) ? 'strong_intervention' : 'ask_chat')))

  const safetyGuardEnabled = !(effCfg && effCfg.tacticalModes && effCfg.tacticalModes.safetyGuardEnabled === false)
  const loopRes = await runChiefAgenticLoop(deps, {
    rootId,
    sessionId: rootId,
    system: effectiveSystem,
    initialPrompt: promptLines.join('\n'),
    imageBlocks,
    allowTextFallbackOnVisionMiss: savedImagePaths.length > 0,
    permissionMode,
    hasChiefRiskAck,
    policyPlugins,
    board,
    maxSteps: statusOnlyInquiry ? 1 : 4,
    readOnlyToolsOnly: false,
    safetyGuardEnabled,
    disableTools: statusOnlyInquiry || (_wallBlockerEscalation && permRank < 3),
    lazyDeferWorkspaceWritesToLead,
    callLlmFn: (callOpts) => callChiefLlm(deps, { reasonKind: askReasonKind, ...callOpts, maxTokens: SUMMARY_MAX_TOKENS }),
    extractJsonFn: extractJsonObject,
    upsertArchiveFn,
    compactNowFn,
    queueApprovalFn: (item) => queueChiefApproval(rootId, item),
    requestElevationFn: (req) => requestChiefElevation(rootId, req),
    recordAuditFn: (entry) => appendChiefAuditLog(rootId, entry),
  })

  const llmRes = (loopRes && loopRes.llmRes) || { ok: false, error: 'agentic loop no response' }
  if (imageBlocks.length > 0 && !llmRes.ok && !savedImagePaths.length) {
    return {
      ok: false,
      error: llmRes.error || '当前参谋长模型无法识别图片，请在右上角切换支持视觉的多模态模型后重试',
    }
  }

  let parsed = (loopRes && loopRes.parsed) || (llmRes.ok ? extractJsonObject(llmRes.text) : null)
  const loopBadges = Array.isArray(loopRes && loopRes.toolBadges) ? [...loopRes.toolBadges] : []
  const loopToolRecords = Array.isArray(loopRes && loopRes.toolRecords) ? loopRes.toolRecords : []
  const queuedApprovals = Array.isArray(loopRes && loopRes.pendingApprovals) ? [...loopRes.pendingApprovals] : []
  const queuedElevations = Array.isArray(loopRes && loopRes.elevationRequests) ? [...loopRes.elevationRequests] : []
  const compactToolRec = loopToolRecords.find(r => r && r.tool === 'session_compact') || null
  let forcedCompactOut = null
  let workflowBlockedNeedsElevation = false
  let chiefSystemBlockedNeedsElevation = false

  if (explicitCompactReq && !compactToolRec) {
    const compactGuard = evaluateSafetyGuardHardRules({ tool: 'session_compact', opClass: 'workflow', board, safetyGuardEnabled })
    if (compactGuard.blocked) {
      forcedCompactOut = { ok: false, blockedBySafetyGuard: true, error: compactGuard.reason }
      loopBadges.push(compactGuard.badge || '🛡️ 卫兵拦截压缩')
      appendChiefAuditLog(rootId, { mode: permissionMode, stage: 'safety_guard', decision: 'blocked', operation: '压缩主对话', target: 'current', reason: compactGuard.reason, outcome: 'blocked', by: 'chief' })
    } else {
      const compactGate = evaluateChiefPermissionGate({ permissionMode, hasChiefRiskAck, policyPlugins, opClass: 'workflow', tool: 'session_compact' })
      if (compactGate.decision === 'deny_mode' || compactGate.decision === 'deny_unacknowledged_l3' || compactGate.decision === 'deny_policy_plugin') {
        workflowBlockedNeedsElevation = compactGate.decision !== 'deny_policy_plugin'
        forcedCompactOut = { ok: false, deniedByMode: true, error: compactGate.error }
        loopBadges.push(compactGate.badge || '🔒 权限禁压')
        appendChiefAuditLog(rootId, { mode: permissionMode, stage: compactGate.decision === 'deny_policy_plugin' ? 'policy_plugin' : 'permission_gate', rule: compactGate.rule || compactGate.decision, decision: compactGate.decision, operation: '压缩主对话', target: 'current', reason: compactGate.error, outcome: 'denied', by: 'chief' })
      } else if (compactGate.decision === 'require_approval') {
        const apr = queueChiefApproval(rootId, {
          category: 'main_workflow',
          operationLabel: '压缩主对话上下文 (/compact)',
          targetLabel: '当前主会话',
          reason: clamp(input, 140),
          impact: '会触发主会话历史压缩，先抢救细节入本会话档案柜再压缩裁剪历史上下文',
          kind: 'compact',
          capabilityScope: buildCapabilityScope({ kind: 'compact', tool: 'session_compact' }),
          payload: { reason: `用户指令触发：${input}` },
          by: 'chief',
        })
        if (apr) queuedApprovals.push(apr)
        forcedCompactOut = { ok: false, pendingApproval: true, error: '当前处于「L2 · 参谋模式」，压缩主对话请求已提交操作授权弹窗，请点击「允许本次操作」后执行。' }
        loopBadges.push('🛡️ 待确认 /compact')
        appendChiefAuditLog(rootId, { mode: permissionMode, stage: 'permission_gate', decision: 'pending_approval', operation: '压缩主对话', target: 'current', reason: clamp(input, 120), outcome: 'pending', by: 'chief' })
      } else {
        forcedCompactOut = await compactNowFn(`用户指令触发：${input}`).catch(err => ({
          ok: false,
          error: (err && err.message) || String(err || '压缩执行失败'),
        }))
        appendChiefAuditLog(rootId, {
          mode: permissionMode,
          stage: 'executor',
          decision: 'executed',
          operation: '压缩主对话',
          target: 'current',
          reason: clamp(input, 120),
          outcome: forcedCompactOut && forcedCompactOut.ok ? 'ok' : 'error',
          by: 'chief',
        })
        if (forcedCompactOut && forcedCompactOut.ok) {
          loopBadges.push(forcedCompactOut.noop ? '🗄️ 已归档(免压)' : '🗜 完成抢救压缩')
        } else {
          loopBadges.push('⚠️ 压缩未完成')
        }
      }
    }
  }

  // Graceful intelligent fallback if LLM is offline / unconfigured / returned non-JSON
  if (!parsed) {
    // 1) Explicit @peer relay syntax
    const mentionMatch = input.match(/^@([^\s:：,，]+)[:：,，\s]+([\s\S]+)$/)
    if (mentionMatch) {
      const targetName = mentionMatch[1]
      const msgBody = mentionMatch[2].trim()
      const delivery = await deliverCrossMessage(deps, {
        fromSession: rootId,
        fromLabel: '用户 (经 DSH 参谋长)',
        target: targetName,
        text: msgBody,
        mode: 'steer',
        imageBlocks,
        savedImagePaths,
      })
      const fallbackReply = delivery.ok
        ? `- 【已递话】已向 @${delivery.target} 插话传达指令${savedImagePaths.length ? `（附原图路径 ×${savedImagePaths.length}）` : ''}。`
        : `- 【投递失败】未找到目标 ${targetName}（${delivery.error}）`
      mutateChiefState((s) => {
        const ws = ensureWorkspace(s, rootId)
        persistTurnChatAndResume(ws, {
          chiefText: fallbackReply,
          actions: [delivery.ok ? `→ ${delivery.target || targetName}` : '投递失败'],
          forceReceipt: true,
        })
      })
      return {
        ok: delivery.ok,
        reply: fallbackReply,
        relays: [delivery],
        savedImagePaths,
        memoryChanges: [],
        boardOps: [],
        view: await getChiefView(deps, rootId, { autoSummarize: false, chatTriggered: !_fromLeadRequest }),
      }
    }

    // 2) Natural-language request to consolidate scattered boundaries into one
    if (!imageBlocks.length && /边界|红线/.test(input) && /总结成一条|合并成一条|浓缩|合一|整合/.test(input)) {
      if (permRank < 1) {
        return denyChiefSystemInAdvisor('浓缩呈批工作边界', '总结与呈批工作边界需要「L1 · 助手模式」及以上权限。')
      }
      const targetCol = /允许|必做/.test(input) ? 'allowed' : /注意/.test(input) ? 'notes' : ''
      const consRes = await consolidateBoundsWithChief(deps, {
        sessionId: rootId,
        field: targetCol,
        instruction: input,
      })
      if (consRes.ok) {
        mutateChiefState((s) => {
          const ws = ensureWorkspace(s, rootId)
          persistTurnChatAndResume(ws, {
            chiefText: consRes.reply,
            actions: ['呈批浓缩边界'],
            forceReceipt: true,
          })
        })
        return {
          ok: true,
          reply: consRes.reply,
          relays: [],
          memoryChanges: [],
          boardOps: [],
          boundProposals: consRes.proposals,
          view: consRes.view,
        }
      }
    }

    // 2.5) Wishing Box offline shortcuts: distill to global / reset tasks / unlink peer sessions
    if (!imageBlocks.length && /(?:提炼|摘取|抽取|总结)/.test(input) && /全局/.test(input)) {
      if (permRank < 1) {
        return denyChiefSystemInAdvisor('提炼入全局档案', '提炼经验写入全局冷库需要「L1 · 助手模式」及以上权限。')
      }
      const distRes = await distillSessionArchivesToGlobal(deps, {
        sessionId: rootId,
        instruction: input,
      })
      if (distRes.ok) {
        mutateChiefState((s) => {
          const ws = ensureWorkspace(s, rootId)
          persistTurnChatAndResume(ws, {
            chiefText: distRes.reply,
            actions: [`提炼入全局 ×${distRes.createdCount || 0}`],
            forceReceipt: true,
          })
        })
        return {
          ok: true,
          reply: distRes.reply,
          relays: [],
          memoryChanges: [],
          boardOps: [],
          archiveOps: [`提炼入全局 ×${distRes.createdCount || 0}`],
          archives: distRes.archives,
          view: distRes.view,
        }
      }
    }

    if (!imageBlocks.length && /(?:清空|重设|重置)/.test(input) && /(?:任务|看板)/.test(input)) {
      if (permRank < 1) {
        return denyChiefSystemInAdvisor('重设任务看板', '修改或重设参谋看板任务需要「L1 · 助手模式」及以上权限。')
      }
      const resetRes = deps.runAction
        ? deps.runAction({ action: 'task.reset', status: 'all', resetPlan: /计划|全部/.test(input), session: rootId, by: 'chief' })
        : { ok: false }
      if (resetRes && resetRes.ok) {
        const msg = '- 【已重设任务看板】已按你的要求清空重设本会话任务列表。'
        mutateChiefState((s) => {
          const ws = ensureWorkspace(s, rootId)
          persistTurnChatAndResume(ws, {
            chiefText: msg,
            actions: ['重设任务看板'],
            forceReceipt: true,
          })
        })
        return {
          ok: true,
          reply: msg,
          relays: [],
          memoryChanges: [],
          boardOps: ['重设任务看板'],
          board: resetRes.board,
          view: await getChiefView(deps, rootId, { autoSummarize: false, chatTriggered: !_fromLeadRequest }),
        }
      }
    }

    if (!imageBlocks.length && /(?:断开|取消|解除)/.test(input) && /(?:协同|网络|连接|关联)/.test(input)) {
      if (permRank < 1) {
        return denyChiefSystemInAdvisor('调整协同网络', '连接或断开跨窗口协同网络需要「L1 · 助手模式」及以上权限。')
      }
      const linkedPeers = ((directory && directory.otherSessions) || []).filter(p => p.linked)
      const qLower = input.toLowerCase()
      const targetsToUnlink = /全部|所有/.test(input)
        ? linkedPeers
        : linkedPeers.filter(p => qLower.includes(String(p.id).toLowerCase()) || (p.name && qLower.includes(String(p.name).toLowerCase())))
      const chosen = targetsToUnlink.length > 0 ? targetsToUnlink : (linkedPeers.length === 1 ? linkedPeers : [])
      if (chosen.length > 0) {
        const badges = []
        for (const p of chosen) {
          const r = setPeerLink(rootId, p.id, false)
          if (r && r.ok) badges.push(`断开协同：${p.name}`)
        }
        if (badges.length > 0) {
          const msg = `- 【已断开协同网络】${badges.join('；')}`
          mutateChiefState((s) => {
            const ws = ensureWorkspace(s, rootId)
            persistTurnChatAndResume(ws, {
              chiefText: msg,
              actions: badges,
              forceReceipt: true,
            })
          })
          return {
            ok: true,
            reply: msg,
            relays: [],
            memoryChanges: [],
            boardOps: [],
            networkOps: badges,
            view: await getChiefView(deps, rootId, { autoSummarize: false, chatTriggered: !_fromLeadRequest }),
          }
        }
      }
    }

    // 2.5) Deterministic reply when user explicitly requested compaction
    if (forcedCompactOut) {
      const compactMsg = forcedCompactOut.ok
        ? (forcedCompactOut.noop
            ? `- 【已归档(免压)】已抢救当前现场记录入本会话档案柜${forcedCompactOut.harvestId ? `（#${forcedCompactOut.harvestId}）` : ''}；当前主对话历史暂无需压缩。`
            : `- 【已完成抢救与上下文压缩】已将关键细节抢救入本会话档案柜${forcedCompactOut.harvestId ? `（#${forcedCompactOut.harvestId}）` : ''}，并完成主对话上下文静默压缩。`)
        : (forcedCompactOut.pendingApproval
            ? `- 【🛡️ 待逐项确认】${forcedCompactOut.error}`
            : forcedCompactOut.deniedByMode
              ? `- 【🔒 权限受限】${forcedCompactOut.error}`
              : `- 【压缩未完成】${forcedCompactOut.error || '当前暂无可压缩历史或宿主压缩服务暂未就绪。'}`)
      let autoElevOut = null
      if (workflowBlockedNeedsElevation && !queuedElevations.length) {
        autoElevOut = requestChiefElevation(rootId, {
          fromMode: permissionMode,
          targetMode: 'strategist',
          reason: '执行主对话上下文压缩 (/compact) 需要「L2 · 参谋模式（逐项确认）」或以上权限',
          requestedActionSummary: clamp(input, 140),
          by: 'chief',
        })
      }
      mutateChiefState((s) => {
        const ws = ensureWorkspace(s, rootId)
        persistTurnChatAndResume(ws, {
          chiefText: compactMsg,
          actions: loopBadges,
          elevationObj: autoElevOut,
          pendingApprovalList: queuedApprovals,
          forceReceipt: true,
          thinkingEffort: llmRes.thinkingEffort || '',
          thinkingEffortMode: llmRes.thinkingEffortMode || effCfg.thinkingEffort || 'auto',
        })
      })
      return {
        ok: true,
        reply: compactMsg,
        relays: [],
        memoryChanges: [],
        boardOps: [],
        actionBadges: loopBadges,
        toolRecords: loopToolRecords,
        pendingApprovals: queuedApprovals,
        ...(autoElevOut ? { elevationRequested: autoElevOut } : {}),
        view: await getChiefView(deps, rootId, { autoSummarize: false, chatTriggered: !_fromLeadRequest }),
      }
    }

    // 3) Fallback summary + auto-elevation if a read-only/assistant tool wall occurred
    const deniedToolRec = loopToolRecords.find(r => r && r.result && r.result.deniedByMode)
    let fallbackElev = queuedElevations[0] || null
    if (deniedToolRec && !fallbackElev) {
      fallbackElev = requestChiefElevation(rootId, {
        fromMode: permissionMode,
        targetMode: deniedToolRec.result.requiredMode || 'strategist',
        reason: deniedToolRec.result.error || '执行请求的操作需要更高权限',
        requestedActionSummary: clamp(input, 160),
        by: 'chief',
      })
    }
    const strippedPlain = llmRes.ok && llmRes.text ? stripToolCallMarkup(llmRes.text).trim() : ''
    const usablePlainLlm = strippedPlain && !strippedPlain.startsWith('{') && strippedPlain.length >= 6
      ? cleanMultiline(strippedPlain, 2200)
      : ''
    const archiveFallback = onDemandArchiveLines.length > 1
      ? ['- 【已从沉淀档案柜按需检索到以下卷宗】', ...onDemandArchiveLines.slice(2)].join('\n')
      : ''
    const rawFallbackReply = usablePlainLlm || archiveFallback || buildSmartFallbackReply({
      input,
      board,
      liveDigest,
      directory,
      facts: numberedFacts,
      mailbox: view.mailbox,
      conciseBrief: isConciseBrief,
    })
    const replyText = isConciseBrief ? sanitizeConciseBriefText(rawFallbackReply) : rawFallbackReply
    const fallbackBounds = (permRank >= 1 && quickAction !== 'consult_chief') ? extractFallbackBoundProposalsFromText(rawFallbackReply, input) : []
    const createdFallbackBounds = []
    const BOUND_COL_LABEL_FB = { forbidden: '禁止红线', allowed: '必做事项', notes: '注意事项' }

    mutateChiefState((s) => {
      const ws = ensureWorkspace(s, rootId)
      const existingFb = (board && board.bounds) || { allowed: [], forbidden: [], notes: [] }
      for (const fb of fallbackBounds) {
        const col = ['forbidden', 'allowed', 'notes'].includes(fb.field) ? fb.field : 'forbidden'
        const colList = Array.isArray(existingFb[col]) ? existingFb[col] : []
        if (colList.some(x => String(x).trim() === fb.item)) continue
        if (ws.suggestions.some(ex => ex && ex.status === 'pending' && ex.kind === 'bound' && ex.draftText === fb.item)) continue
        const colLabel = BOUND_COL_LABEL_FB[col] || '禁止红线'
        const sug = normalizeSuggestion({
          kind: 'bound',
          boundField: col,
          fromAgent: '✦ 参谋长提炼',
          title: `拟入${colLabel}：${clamp(fb.item, 30)}`,
          reason: fb.reason,
          target: 'bounds',
          targetLabel: colLabel,
          mode: 'silent',
          draftText: fb.item,
          pinGlobal: Boolean(fb.pinGlobal),
        })
        if (sug) {
          ws.suggestions.push(sug)
          if (ws.suggestions.length > SUGGESTIONS_CAP) ws.suggestions = ws.suggestions.slice(-SUGGESTIONS_CAP)
          createdFallbackBounds.push(sug)
          loopBadges.push(`呈批${colLabel}：${clamp(fb.item, 18)}`)
        }
      }
      persistTurnChatAndResume(ws, {
        chiefText: replyText,
        actions: loopBadges,
        elevationObj: fallbackElev,
        pendingApprovalList: queuedApprovals,
        forceReceipt: createdFallbackBounds.length > 0,
        thinkingEffort: llmRes.thinkingEffort || '',
        thinkingEffortMode: llmRes.thinkingEffortMode || effCfg.thinkingEffort || 'auto',
      })
    })
    return {
      ok: true,
      reply: replyText,
      relays: [],
      memoryChanges: [],
      boardOps: [],
      boundProposals: createdFallbackBounds,
      actionBadges: loopBadges,
      toolRecords: loopToolRecords,
      pendingApprovals: queuedApprovals,
      ...(fallbackElev ? { elevationRequested: fallbackElev } : {}),
      view: await getChiefView(deps, rootId, { autoSummarize: false, chatTriggered: !_fromLeadRequest }),
    }
  }

  // Execute decomposed relays with strict 4-tier workflow permission gating
  const relayResults = []
  const deliveryFailures = []
  const actionBadges = [...loopBadges]
  const relayGate = evaluateChiefPermissionGate({
    permissionMode,
    hasChiefRiskAck,
    policyPlugins,
    opClass: 'workflow',
    tool: 'relay',
  })

  for (const r of (Array.isArray(parsed.relays) ? parsed.relays : []).slice(0, 8)) {
    if (!r || !r.text) continue
    const targetName = r.target || 'lead'
    const isLeadTarget = /^(?:lead|main|主对话)$/i.test(String(targetName).trim())
    const extHarnessHit = !isLeadTarget
      ? resolveExternalHarnessTarget(deps && deps.runtime, deps && deps.hostState, rootId, targetName)
      : null
    const relayMode = ['steer', 'followup', 'silent'].includes(r.mode) ? r.mode : 'steer'

    const relayGuard = evaluateSafetyGuardHardRules({ tool: 'relay', opClass: 'workflow', command: r.text, board, safetyGuardEnabled })
    if (relayGuard.blocked) {
      actionBadges.push(relayGuard.badge || '🛡️ 卫兵拦递话')
      relayResults.push({ ok: false, target: targetName, blockedBySafetyGuard: true, error: relayGuard.reason })
      appendChiefAuditLog(rootId, { mode: permissionMode, stage: 'safety_guard', rule: relayGuard.rule || 'hard_guard', decision: 'blocked', operation: '工作流递话', target: String(targetName), reason: relayGuard.reason, outcome: 'blocked', by: 'chief' })
      continue
    }

    if (relayGate.decision === 'deny_mode' || relayGate.decision === 'deny_unacknowledged_l3' || relayGate.decision === 'deny_policy_plugin') {
      if (relayGate.decision !== 'deny_policy_plugin') workflowBlockedNeedsElevation = true
      actionBadges.push(relayGate.badge || '🔒 权限禁调工作流')
      relayResults.push({ ok: false, target: targetName, deniedByMode: true, error: relayGate.error })
      appendChiefAuditLog(rootId, {
        mode: permissionMode,
        stage: relayGate.decision === 'deny_policy_plugin' ? 'policy_plugin' : 'permission_gate',
        rule: relayGate.rule || relayGate.decision,
        decision: relayGate.decision,
        operation: isLeadTarget ? '调整主对话工作流' : (extHarnessHit ? '派单外部工具（独立进程）' : '调整子代理工作流'),
        target: String(targetName),
        reason: relayGate.error,
        outcome: 'denied',
        by: 'chief',
      })
      continue
    }

    if (relayGate.decision === 'require_approval') {
      const apr = queueChiefApproval(rootId, {
        category: isLeadTarget ? 'main_workflow' : 'subagent_workflow',
        operationLabel: isLeadTarget ? '调整主对话工作流（投递指令）' : (extHarnessHit ? '派单外部工具（独立进程）' : '调整子代理工作流（投递指令）'),
        targetLabel: isLeadTarget ? '主对话 (@lead)' : (extHarnessHit ? `${extHarnessHit.label} (@${extHarnessHit.provider})` : `@${targetName}`),
        reason: clamp(r.subject || (extHarnessHit ? `参谋建议向外部工具 ${extHarnessHit.label} 派发执行任务` : '参谋建议向代理投递工作流指令'), 140),
        impact: isLeadTarget
          ? '将向主对话注入工作流指令并触发继续推进'
          : (extHarnessHit
              ? '将启动外部工具独立进程执行任务，自动附带禁止红线与自定义拦截规则并锁死协同水泡'
              : '将唤醒或引导子代理执行新任务指令'),
        preview: clamp(r.text, 240),
        kind: 'relay',
        capabilityScope: buildCapabilityScope({ kind: 'relay', tool: 'relay', target: targetName }),
        payload: {
          fromSession: rootId,
          fromLabel: 'DSH 参谋 (执行请求 · 逐项授权)',
          target: targetName,
          subject: r.subject || '',
          text: r.text,
          mode: relayMode,
          envelopeKind: 'execution_request',
          taskId: r.taskId || '',
          imageBlocks,
          savedImagePaths,
          isBlankContext,
        },
        by: 'chief',
      })
      if (apr) queuedApprovals.push(apr)
      actionBadges.push(extHarnessHit ? `🛡️ 待确认外部派单 → ${extHarnessHit.label}` : `🛡️ 待确认递话 → ${isLeadTarget ? '主对话' : targetName}`)
      relayResults.push({ ok: false, pendingApproval: true, approvalId: apr && apr.id, target: targetName })
      appendChiefAuditLog(rootId, {
        mode: permissionMode,
        stage: 'permission_gate',
        decision: 'pending_approval',
        operation: isLeadTarget ? '主对话工作流递话' : (extHarnessHit ? '外部工具派单' : '子代理工作流递话'),
        target: String(targetName),
        reason: clamp(r.subject || r.text, 120),
        outcome: 'pending',
        by: 'chief',
      })
      continue
    }

    // L3 Chief mode: execute via explicit execution_request envelope (never impersonate user)
    const deliv = await deliverCrossMessage(deps, {
      fromSession: rootId,
      fromLabel: 'DSH 参谋长 (执行请求)',
      target: targetName,
      subject: r.subject || '',
      text: r.text,
      mode: relayMode,
      envelopeKind: 'execution_request',
      taskId: r.taskId || '',
      imageBlocks,
      savedImagePaths,
    })
    if (isLeadTarget && !deliv.deliveryError && (!deliv.ok || (isBlankContext && !deliv.deliveredPhysical)) && typeof deps.stagePendingTransfer === 'function') {
      const staged = deps.stagePendingTransfer(
        `[DSH 参谋长预派发指令${r.subject ? ' · ' + r.subject : ''}]\n${r.text}`,
        rootId,
        { by: 'chief', subject: r.subject || '' },
      )
      if (staged) {
        relayResults.push({ ...deliv, ok: true, target: '主对话(待领)', mode: 'pending-transfer', stagedPending: true })
        actionBadges.push('暂存待领 → 主对话')
        appendChiefAuditLog(rootId, { mode: permissionMode, stage: 'executor', decision: 'executed', operation: '主对话待领递话', target: '主对话', reason: clamp(r.subject || r.text, 120), outcome: 'ok', by: 'chief' })
        continue
      }
    }
    const hardFailed = Boolean(!deliv.deliveredPhysical && deliv.deliveryError)
    const relayOk = Boolean(deliv.ok && !hardFailed)
    relayResults.push(deliv)
    appendChiefAuditLog(rootId, {
      mode: permissionMode,
      stage: 'executor',
      decision: 'executed',
      operation: isLeadTarget ? '主对话递话' : (extHarnessHit ? '外部工具派单' : '子代理递话'),
      target: String(deliv.target || targetName),
      reason: clamp(hardFailed ? deliv.deliveryError : (r.subject || r.text), 160),
      outcome: relayOk ? 'ok' : 'error',
      by: 'chief',
    })
    if (hardFailed) {
      deliveryFailures.push(deliv.deliveryError)
      actionBadges.push('⚠️ 未送达主对话')
    } else if (deliv.ok) {
      actionBadges.push(
        deliv.deliveryMode === 'bubble-harness'
          ? `⚡ 外部派单 → ${deliv.target}`
          : `${relayMode === 'steer' ? '插话' : '递话'} → ${deliv.target}`,
      )
    }
  }

  // Execute Chief-system ops (L1 Assistant+ required; strictly denied in L0 Advisor)
  const rawInquiries = Array.isArray(parsed.inquiries) ? parsed.inquiries.slice(0, 3) : []
  const rawWallListSrc = Array.isArray(parsed.wallProposals)
    ? parsed.wallProposals
    : (Array.isArray(parsed.guardWalls) ? parsed.guardWalls : [])
  const rawWallProposals = rawWallListSrc.slice(0, 4)
  const rawBoundListSrc = Array.isArray(parsed.boundProposals) && parsed.boundProposals.length > 0
    ? parsed.boundProposals
    : (Array.isArray(parsed.boundaryProposals) && parsed.boundaryProposals.length > 0
        ? parsed.boundaryProposals
        : extractFallbackBoundProposalsFromText(parsed.reply || '', input))
  const rawArchiveOps = Array.isArray(parsed.archiveOps) ? parsed.archiveOps.slice(0, 8) : []
  const rawEffortOps = Array.isArray(parsed.effortOps) ? parsed.effortOps.slice(0, 6) : []
  const internalArchiveOps = []
  const mainInjectArchiveOps = []
  for (const opItem of rawArchiveOps) {
    if (!opItem || typeof opItem !== 'object') continue
    const normOp = normalizeArchiveOpName(opItem.op)
    const sc = opItem.vaultScope === 'precipitated'
      ? 'precipitated'
      : (opItem.vaultScope === 'global' ? 'global' : 'session')
    if (sc === 'precipitated' || normOp === 'pull_precipitated') {
      internalArchiveOps.push(opItem)
    } else if (MAIN_INJECT_ARCHIVE_OPS.has(normOp)) {
      mainInjectArchiveOps.push({ ...opItem, op: normOp, vaultScope: sc })
    } else if (normOp === 'save' && opItem.takeOut) {
      internalArchiveOps.push({ ...opItem, takeOut: false })
      mainInjectArchiveOps.push({ op: 'pin_to_desktop', vaultScope: sc, title: opItem.title, instruction: opItem.summary || '' })
    } else {
      internalArchiveOps.push(opItem)
    }
  }
  const hasSystemOps = Boolean(
    (Array.isArray(parsed.boardOps) && parsed.boardOps.length > 0)
    || internalArchiveOps.length > 0
    || (Array.isArray(parsed.networkOps) && parsed.networkOps.length > 0)
    || (Array.isArray(parsed.memoryChanges) && parsed.memoryChanges.length > 0)
    || rawBoundListSrc.length > 0
    || rawWallProposals.length > 0,
  )
  const systemGate = evaluateChiefPermissionGate({
    permissionMode,
    hasChiefRiskAck,
    policyPlugins,
    opClass: 'chief_system',
    tool: 'chief_system',
  })

  let executedBoardOps = []
  let executedArchiveOps = []
  let executedNetworkOps = []
  let executedEffortOps = []
  const pendingArchiveSuggestions = []
  const pendingEffortSuggestions = []
  let appliedFacts = []
  const proposedBounds = []
  const existingBounds = (board && board.bounds) || { allowed: [], forbidden: [], notes: [] }
  const rawBoundProposals = rawBoundListSrc.slice(0, 4)

  if (hasSystemOps && systemGate.decision !== 'allow' && systemGate.decision !== 'allow_approved') {
    chiefSystemBlockedNeedsElevation = systemGate.decision === 'deny_mode'
    actionBadges.push(systemGate.badge || '🔒 L0禁改参谋系统')
    appendChiefAuditLog(rootId, {
      mode: permissionMode,
      stage: systemGate.decision === 'deny_policy_plugin' ? 'policy_plugin' : 'permission_gate',
      rule: systemGate.rule || systemGate.decision,
      decision: systemGate.decision,
      operation: '修改参谋系统(看板/记忆/档案)',
      target: 'chief_system',
      reason: systemGate.error,
      outcome: 'denied',
      by: 'chief',
    })
  } else if (hasSystemOps) {
    executedBoardOps = applyBoardOps(deps, rootId, parsed.boardOps, { callerOrigin: 'chief_llm' })
    for (const b of executedBoardOps) actionBadges.push(b)

    const archiveExec = await applyArchiveOps(deps, rootId, internalArchiveOps, { input, allowPinToDesktop: false })
    executedArchiveOps = archiveExec.executed || []
    for (const a of executedArchiveOps) actionBadges.push(a)

    executedNetworkOps = applyNetworkOps(rootId, parsed.networkOps, directory)
    for (const n of executedNetworkOps) actionBadges.push(n)

    if (executedBoardOps.length || executedArchiveOps.length || executedNetworkOps.length) {
      appendChiefAuditLog(rootId, {
        mode: permissionMode,
        stage: 'executor',
        decision: 'executed',
        operation: '维护参谋系统',
        target: [...executedBoardOps, ...executedArchiveOps, ...executedNetworkOps].slice(0, 3).join('；'),
        reason: clamp(input, 120),
        outcome: 'ok',
        by: 'chief',
      })
    }
  }

  // Dual-channel main injection from archives (Channel A: desktop pin/unpin, Channel B: deliver_to_lead)
  // L0/L1 -> Suggestion pill; L2 -> Approval card + TaskLedger; L3 -> Direct execution
  for (const item of mainInjectArchiveOps) {
    const scopeLabel = item.vaultScope === 'global' ? '全局档案柜' : '本局档案柜'
    const refText = item.title ? `《${clamp(item.title, 28)}》` : `#${item.id || item.archiveId || '?'}`
    const opDesc = item.op === 'pin_to_desktop'
      ? `将${scopeLabel}档案置顶桌面`
      : (item.op === 'unpin_from_desktop' ? `将${scopeLabel}档案撤回抽屉` : `向主对话递送${scopeLabel}档案`)
    if (relayGate.decision === 'deny_mode' || relayGate.decision === 'deny_unacknowledged_l3' || relayGate.decision === 'deny_policy_plugin') {
      if (relayGate.decision !== 'deny_policy_plugin' && permRank < 2) {
        pendingArchiveSuggestions.push({
          kind: 'archive_op',
          fromAgent: '📌 参谋档案馆通道',
          title: `${opDesc}：${refText}`,
          reason: clamp(item.instruction || `当前处于 L${permRank} 只读/助手档，后台不直接注入主会话；点「执行建议」即刻落位。`, 180),
          target: item.target || 'lead',
          targetLabel: item.op === 'deliver_to_lead' ? '主对话 (@lead)' : '📌 认知桌面',
          mode: 'steer',
          draftText: `${opDesc} ${refText}${item.instruction ? ' — ' + item.instruction : ''}`,
          archiveSpec: {
            op: item.op,
            vaultScope: item.vaultScope,
            id: item.id || item.archiveId || '',
            title: item.title || '',
            target: item.target || 'lead',
            instruction: item.instruction || '',
          },
        })
        actionBadges.push(`💡 建议档案注入：${refText}`)
      } else {
        workflowBlockedNeedsElevation = workflowBlockedNeedsElevation || relayGate.decision !== 'deny_policy_plugin'
        actionBadges.push(relayGate.badge || '🔒 权限禁注档案')
      }
      continue
    }
    if (relayGate.decision === 'require_approval') {
      const apr = queueChiefApproval(rootId, {
        category: 'main_workflow',
        operationLabel: opDesc,
        targetLabel: `${scopeLabel} · ${refText}`,
        reason: clamp(item.instruction || 'L2 参谋模式：向主对话桌面或正文注入档案前需逐项确认', 140),
        impact: item.op === 'deliver_to_lead' ? '将把该卷宗摘要与要点投递至主对话并唤醒查收' : '将调整主对话共享认知桌面置顶列表（受 2400 Tokens/6 份预算约束）',
        preview: clamp(`${opDesc} ${refText}${item.instruction ? '\n附言：' + item.instruction : ''}`, 240),
        kind: 'archive_op',
        capabilityScope: buildCapabilityScope({ kind: 'archive_op', tool: 'archive_op', target: refText }),
        payload: {
          op: item.op,
          vaultScope: item.vaultScope,
          id: item.id || item.archiveId || '',
          title: item.title || '',
          target: item.target || 'lead',
          instruction: item.instruction || '',
        },
        by: 'chief',
      })
      if (apr) queuedApprovals.push(apr)
      actionBadges.push(`🛡️ 待确认档案注入：${refText}`)
      appendChiefAuditLog(rootId, { mode: permissionMode, stage: 'permission_gate', decision: 'pending_approval', operation: opDesc, target: refText, reason: clamp(input, 120), outcome: 'pending', by: 'chief' })
      continue
    }
    const execOut = await executeChiefArchiveInjectionOp(deps, rootId, item, { input })
    if (execOut && execOut.ok) {
      executedArchiveOps.push(execOut.actionText)
      actionBadges.push(execOut.actionText)
      appendChiefAuditLog(rootId, { mode: permissionMode, stage: 'executor', decision: 'executed', operation: opDesc, target: refText, reason: clamp(input, 120), outcome: 'ok', by: 'chief' })
    }
  }

  // Hot reasoning-effort shifting (`effortOps`) with 4-tier permission gate + teamEffortMode + per-agent user 🔒 veto lock
  const userLocks = (effCfg && effCfg.lockedModelEfforts && typeof effCfg.lockedModelEfforts === 'object') ? effCfg.lockedModelEfforts : {}
  const isManualTeamEffort = Boolean(effCfg && effCfg.teamEffortMode === 'manual')
  if (isManualTeamEffort && rawEffortOps.length > 0) {
    actionBadges.push('✋ 团队思考强度已设为手动，跳过自动调挡')
    appendChiefAuditLog(rootId, {
      mode: permissionMode,
      stage: 'model_effort_lock',
      decision: 'blocked',
      operation: '调节模型思考强度',
      target: rawEffortOps.map(ef => String((ef && (ef.target || ef.agent)) || 'lead').replace(/^@/, '')).join(','),
      reason: '团队思考强度处于「手动」模式，已跳过自动调挡',
      outcome: 'blocked',
      by: 'chief',
    })
  }
  for (const ef of (isManualTeamEffort ? [] : rawEffortOps)) {
    if (!ef || typeof ef !== 'object') continue
    const efTarget = clamp(String(ef.target || ef.agent || 'lead').trim().replace(/^@/, ''), 64) || 'lead'
    const rawEf = String(ef.effort || ef.reasoningEffort || 'medium').trim().toLowerCase()
    const efVal = ['off', 'low', 'medium', 'high', 'xhigh'].includes(rawEf) ? rawEf : 'medium'
    const efReason = clamp(String(ef.reason || '按任务复杂度协同调节模型思考强度').trim(), 180)
    const shortEfTarget = efTarget.split('/').pop()
    const isUserLocked = Boolean(userLocks[efTarget] === true || userLocks[shortEfTarget] === true)
    if (isUserLocked) {
      actionBadges.push(`🔒 用户已锁挡 @${efTarget}`)
      appendChiefAuditLog(rootId, { mode: permissionMode, stage: 'model_effort_lock', decision: 'blocked', operation: '调节模型思考强度', target: efTarget, reason: `用户开启「🔒 锁挡」，阻止调为 ${efVal}`, outcome: 'blocked', by: 'chief' })
      continue
    }
    if (relayGate.decision === 'deny_mode' || relayGate.decision === 'deny_unacknowledged_l3' || relayGate.decision === 'deny_policy_plugin') {
      if (relayGate.decision !== 'deny_policy_plugin' && permRank < 2) {
        pendingEffortSuggestions.push({
          kind: 'model_effort',
          fromAgent: '🧠 思考强度建议',
          title: `建议调挡 @${efTarget} → ${efVal}`,
          reason: efReason,
          target: efTarget,
          targetLabel: efTarget === 'lead' ? '主对话 (@lead)' : `@${efTarget}`,
          mode: 'silent',
          draftText: `将 @${efTarget} 思考强度设为 ${efVal}（${efReason}）`,
          effortSpec: { target: efTarget, effort: efVal, reason: efReason },
        })
        actionBadges.push(`💡 建议调挡 @${efTarget}→${efVal}`)
      } else {
        workflowBlockedNeedsElevation = workflowBlockedNeedsElevation || relayGate.decision !== 'deny_policy_plugin'
        actionBadges.push(relayGate.badge || '🔒 权限禁调档位')
      }
      continue
    }
    if (relayGate.decision === 'require_approval') {
      const apr = queueChiefApproval(rootId, {
        category: 'main_workflow',
        operationLabel: '调节模型思考强度',
        targetLabel: efTarget === 'lead' ? '主对话 (@lead)' : `@${efTarget}`,
        reason: efReason,
        impact: `批准后将静默热调节 @${efTarget} 的推理思考深度为 ${efVal}`,
        preview: `@${efTarget} → ${efVal}`,
        kind: 'model_effort',
        capabilityScope: buildCapabilityScope({ kind: 'model_effort', tool: 'model_effort', target: efTarget }),
        payload: { target: efTarget, reasoningEffort: efVal, reason: efReason },
        by: 'chief',
      })
      if (apr) queuedApprovals.push(apr)
      actionBadges.push(`🛡️ 待确认调挡 @${efTarget}→${efVal}`)
      appendChiefAuditLog(rootId, { mode: permissionMode, stage: 'permission_gate', decision: 'pending_approval', operation: '调节模型思考强度', target: efTarget, reason: efReason, outcome: 'pending', by: 'chief' })
      continue
    }
    if (deps && typeof deps.controlMainAgent === 'function') {
      const ctrlRes = await deps.controlMainAgent({
        rootId,
        sessionId: rootId,
        op: 'set_effort',
        target: efTarget,
        reasoningEffort: efVal,
        reason: efReason,
        byUser: false,
      }).catch(e => ({ ok: false, error: (e && e.message) || 'effort-control-failed' }))
      if (ctrlRes && ctrlRes.ok) {
        const tag = `🧠 调挡 @${efTarget} → ${ctrlRes.reasoningEffort || efVal}`
        executedEffortOps.push(tag)
        actionBadges.push(tag)
      } else if (ctrlRes && ctrlRes.lockedByUser) {
        actionBadges.push(`🔒 用户已锁挡 @${efTarget}`)
      }
    }
  }

  // Handle explicit model elevationRequest OR auto-generate when an action hit mode wall
  let finalElevation = queuedElevations[0] || null
  if (parsed.elevationRequest && typeof parsed.elevationRequest === 'object' && parsed.elevationRequest.targetMode) {
    const reqTarget = normalizePermissionMode(parsed.elevationRequest.targetMode)
    if (permissionRank(reqTarget) > permRank) {
      const elv = requestChiefElevation(rootId, {
        fromMode: permissionMode,
        targetMode: reqTarget,
        reason: clamp(parsed.elevationRequest.reason || '完成用户当前任务需要提升参谋权限', 240),
        requestedActionSummary: clamp(parsed.elevationRequest.requestedActionSummary || input, 180),
        by: 'chief',
      })
      if (elv) {
        finalElevation = elv
        actionBadges.push(`🔐 请示提权 ${CHIEF_PERMISSION_META[reqTarget].level}`)
      }
    }
  } else if (!finalElevation) {
    const deniedToolRec = loopToolRecords.find(r => r && r.result && r.result.deniedByMode)
    const neededMode = (deniedToolRec && deniedToolRec.result && deniedToolRec.result.requiredMode)
      || (workflowBlockedNeedsElevation ? 'strategist' : (chiefSystemBlockedNeedsElevation ? 'assistant' : ''))
    if (neededMode && permissionRank(neededMode) > permRank) {
      const elv = requestChiefElevation(rootId, {
        fromMode: permissionMode,
        targetMode: neededMode,
        reason: neededMode === 'assistant'
          ? '该操作需要维护参谋看板、记忆或档案（需「L1 · 助手模式」及以上）'
          : '该操作需要修改工作区或调度主对话/子代理工作流（需「L2 · 参谋模式」或以上）',
        requestedActionSummary: clamp(input, 180),
        by: 'chief',
      })
      if (elv) {
        finalElevation = elv
        actionBadges.push(`🔐 请示提权 ${CHIEF_PERMISSION_META[neededMode].level}`)
      }
    }
  }

  const cleanedParsedReply = stripToolCallMarkup(parsed.reply || '').trim()
  const compactOutcomeNote = forcedCompactOut
    ? (forcedCompactOut.ok
        ? (forcedCompactOut.noop
            ? `【已归档(免压)】已将本轮现场记录存入本会话档案柜${forcedCompactOut.harvestId ? `（#${forcedCompactOut.harvestId}）` : ''}，宿主历史暂无需进一步压缩。`
            : `【已完成抢救与上下文压缩】已将关键细节存入本会话档案柜${forcedCompactOut.harvestId ? `（#${forcedCompactOut.harvestId}）` : ''}，并完成主对话静默压缩。`)
        : (forcedCompactOut.pendingApproval
            ? `【🛡️ 待逐项确认】${forcedCompactOut.error}`
            : `【压缩未完成】${forcedCompactOut.error || '宿主压缩服务未就绪'}`))
    : (compactToolRec && compactToolRec.ok === false && !compactToolRec.pendingApproval
        ? `（⚠️ 实测压缩提示：${compactToolRec.error || '压缩未完成'}）`
        : '')
  const permissionStatusNotes = []
  for (const failMsg of [...new Set(deliveryFailures)]) {
    permissionStatusNotes.push(`- 【⚠️ 主对话通道受阻】${failMsg}`)
  }
  if (queuedApprovals.length > 0 && !/操作授权|允许本次操作/.test(cleanedParsedReply)) {
    permissionStatusNotes.push(`- 【🛡️ 待逐项确认】已为您弹出「操作授权请求」弹窗（共 ${queuedApprovals.length} 项受控操作），点击「允许本次操作」后才会实际执行。`)
  }
  if (finalElevation && !/提权/.test(cleanedParsedReply)) {
    const tgtMeta = CHIEF_PERMISSION_META[finalElevation.targetMode] || {}
    permissionStatusNotes.push(`- 【🔐 已申请提权】当前为「${CHIEF_PERMISSION_META[permissionMode].level} · ${CHIEF_PERMISSION_META[permissionMode].title}」，已向您发起提权至「${tgtMeta.level || ''} · ${tgtMeta.title || finalElevation.targetMode}」的申请弹窗。`)
  }
  const baseParsedReply = cleanedParsedReply || buildSmartFallbackReply({ input, board, liveDigest, directory, facts: numberedFacts, mailbox: view.mailbox, conciseBrief: isConciseBrief }) || '- 【已执行】已按你的吩咐安排妥当。'
  const combinedParsedReply = [
    compactOutcomeNote,
    baseParsedReply,
    ...permissionStatusNotes,
  ].filter(Boolean).join('\n')
  const rawReplyText = cleanMultiline(combinedParsedReply, 1800)
  const replyText = isConciseBrief ? sanitizeConciseBriefText(rawReplyText) : rawReplyText

  const BOUND_COL_LABEL = { forbidden: '禁止红线', allowed: '必做事项', notes: '注意事项' }
  const createdInquiries = []
  const proposedWalls = []
  const proposedWallRemovals = []
  const cwdForWall = resolveSessionWorkspaceCwd(deps, rootId)
  const rawWallRemovalProposals = Array.isArray(parsed.wallRemovalProposals) ? parsed.wallRemovalProposals.slice(0, 2) : []

  mutateChiefState((s) => {
    const ws = ensureWorkspace(s, rootId)

    // Ultra-strict, all-tier (L0-L3) Human Approval Wall-Removal Proposal Gate
    if (rawWallRemovalProposals.length > 0) {
      const hasWallBlockLog = (Array.isArray(ws.auditLog) ? ws.auditLog : [])
        .some(e => e && e.stage === 'guard_wall' && e.outcome === 'blocked')
      const mentionsBlocker = /(?:撞墙|物理驻墙|物理墙|自定义拦截规则|拦截规则|无法绕过|事前物理拦截|guard_wall|wall-)/i.test(input)
      const hasWallBlockerEvidence = Boolean(_wallBlockerEscalation || (hasWallBlockLog && mentionsBlocker))
      if (!hasWallBlockerEvidence) {
        pushAuditToWs(ws, {
          mode: permissionMode,
          stage: 'guard_wall',
          rule: 'wall_removal_denied_no_blocker_evidence',
          decision: 'rejected',
          operation: '拦截无依据拆墙提议',
          target: 'guard_walls',
          reason: '未收到主/子代理真实撞墙且无法绕过阻断上报，拒绝生成拆墙申请',
          outcome: 'rejected',
          by: 'chief',
        }, rootId)
      } else {
        const activeWalls = listGuardWalls({ cwd: cwdForWall }).filter(w => w && w.scope !== 'paused')
        for (const rawWr of rawWallRemovalProposals) {
          if (!rawWr || typeof rawWr !== 'object') continue
          const reqId = String(rawWr.wallId || rawWr.id || '').trim()
          const reqTitle = String(rawWr.wallTitle || rawWr.title || '').trim()
          const matchedWall = activeWalls.find(w =>
            (reqId && w.id === reqId)
            || (reqTitle && w.title === reqTitle),
          )
          if (!matchedWall) continue
          const blockerEv = cleanMultiline(rawWr.blockerEvidence || rawWr.evidence || '', 260)
          const removeReason = cleanMultiline(rawWr.reason || '', 220)
          if (!blockerEv || !removeReason) continue
          const dupWr = ws.suggestions.some(ex =>
            ex
            && ex.status === 'pending'
            && ex.kind === 'wall_removal'
            && ex.wallRemovalSpec
            && ex.wallRemovalSpec.wallId === matchedWall.id,
          )
          if (dupWr) continue
          const actMode = String(rawWr.action || '').trim().toLowerCase() === 'remove' ? 'remove' : 'pause'
          const patStr = Array.isArray(matchedWall.patterns) ? matchedWall.patterns.join(', ') : ''
          const sug = normalizeSuggestion({
            kind: 'wall_removal',
            fromAgent: '⚠️ 参谋请示关闭拦截规则（阻断复核）',
            title: `请示${actMode === 'remove' ? '删除' : '暂停'}自定义拦截规则：${clamp(matchedWall.title, 28)}`,
            reason: clamp(removeReason, 200),
            target: 'guard_walls',
            targetLabel: clamp(matchedWall.title, 36),
            mode: 'silent',
            draftText: [
              `目标自定义拦截规则：${matchedWall.title} (${matchedWall.id})`,
              `拦截规则：[${matchedWall.ruleType}] ${patStr}`,
              `代理阻断依据：${blockerEv}`,
              `拟批准操作：${actMode === 'remove' ? '永久删除该自定义拦截规则' : '暂停休眠该自定义拦截规则（可随时恢复）'}`,
            ].join('\n'),
            evidence: blockerEv,
            wallRemovalSpec: {
              wallId: matchedWall.id,
              wallTitle: matchedWall.title,
              action: actMode,
              patterns: matchedWall.patterns || [],
              reason: removeReason,
              blockerEvidence: blockerEv,
              reportedBy: _fromLeadRequest ? 'lead/subagent' : 'chief_review',
            },
            popup: true,
            urgency: 'high',
          })
          if (sug) {
            ws.suggestions.push(sug)
            if (ws.suggestions.length > SUGGESTIONS_CAP) ws.suggestions = ws.suggestions.slice(-SUGGESTIONS_CAP)
            proposedWallRemovals.push(sug)
            actionBadges.push(`⚠️ 请示拆墙：${clamp(matchedWall.title, 18)}`)
            pushAuditToWs(ws, {
              mode: permissionMode,
              stage: 'guard_wall',
              rule: 'wall_removal_requested',
              decision: 'pending_approval',
              operation: '参谋呈报人工审批拆墙',
              target: `${matchedWall.title} (${matchedWall.id})`,
              reason: clamp(removeReason, 180),
              outcome: 'pending',
              by: 'chief',
            }, rootId)
          }
        }
      }
    }
    for (const rawInq of rawInquiries) {
      if (!rawInq || typeof rawInq !== 'object') continue
      const qText = cleanMultiline(rawInq.question || rawInq.text || '', 500)
      if (!qText || secretLike(qText)) continue
      const inqTarget = clamp(rawInq.target || 'lead', 48) || 'lead'
      const inqTask = upsertTaskLedgerOnWs(ws, {
        kind: 'inquiry',
        status: 'awaiting_inquiry',
        originalText: `问询 @${inqTarget}：${qText}`,
        forcedTarget: inqTarget,
      })
      const inqItem = enqueueChiefInquiryOnWs(ws, {
        target: inqTarget,
        question: qText,
        context: cleanMultiline(rawInq.context || '', 240),
        taskId: inqTask ? inqTask.taskId : '',
      })
      if (inqItem) {
        createdInquiries.push(inqItem)
        if (inqTask) {
          upsertTaskLedgerOnWs(ws, {
            id: inqTask.taskId,
            taskId: inqTask.taskId,
            kind: 'inquiry',
            status: 'awaiting_inquiry',
            originalText: inqTask.originalText,
            inquiryId: inqItem.inquiryId,
          })
        }
        actionBadges.push(`⚡ 问询 @${inqItem.target} #${inqItem.inquiryId}`)
      }
    }

    if (systemGate.decision === 'allow' || systemGate.decision === 'allow_approved') {
      const activeCluster = getLinkedCluster(s, rootId)
      appliedFacts = applyFactChanges(ws, numberedFacts, parsed.memoryChanges, 'user', {
        originRootId: rootId,
        peerRootIds: activeCluster.filter(id => id !== rootId),
      })
      for (const f of appliedFacts) {
        actionBadges.push((f.op === 'add' ? '记入：' : f.op === 'edit' ? '修订：' : '移除：') + clamp(f.text, 24))
      }

      for (const rawWp of rawWallProposals) {
        if (!rawWp || typeof rawWp !== 'object') continue
        const mappedRuleType = rawWp.ruleType || rawWp.type
          || (rawWp.field === 'path' ? 'forbid_path' : (rawWp.field === 'command' ? 'forbid_cmd' : undefined))
        const wp = {
          ...rawWp,
          title: rawWp.title || rawWp.name || '',
          ...(mappedRuleType ? { ruleType: mappedRuleType } : {}),
          patterns: rawWp.patterns || rawWp.pattern || rawWp.rules,
        }
        const val = validateGuardWallInput(wp, { cwd: cwdForWall })
        if (!val || !val.ok || !val.wall) continue
        if (secretLike(val.wall.title) || val.wall.patterns.some(p => secretLike(p))) continue
        const dupPendingWall = ws.suggestions.some(
          existing => existing
            && existing.status === 'pending'
            && existing.kind === 'guard_wall'
            && existing.wallSpec
            && existing.wallSpec.title === val.wall.title,
        )
        if (dupPendingWall) continue
        const sug = normalizeSuggestion({
          kind: 'guard_wall',
          fromAgent: '🚧 参谋长拦截规则提案',
          title: `拟启用拦截规则：${clamp(val.wall.title, 30)}`,
          reason: clamp(val.wall.reason || '事前硬拦截高危命令或敏感路径，确认后写入 guard-walls 持久落锁。', 180),
          target: 'guard_walls',
          targetLabel: val.wall.scope === 'workspace' ? '📁 本工程拦截规则' : '🌐 全局拦截规则',
          mode: 'silent',
          draftText: `[${val.wall.ruleType}] ${val.wall.patterns.join(', ')}`,
          wallSpec: val.wall,
        })
        if (sug) {
          ws.suggestions.push(sug)
          if (ws.suggestions.length > SUGGESTIONS_CAP) ws.suggestions = ws.suggestions.slice(-SUGGESTIONS_CAP)
          proposedWalls.push(sug)
          actionBadges.push(`🚧 呈批拦截规则：${clamp(val.wall.title, 18)}`)
        }
      }

      for (const rawBp of rawBoundProposals) {
        if (!rawBp) continue
        const bp = typeof rawBp === 'string'
          ? { field: 'forbidden', item: rawBp, reason: '根据会话上下文提炼的工作边界，请拍板注入。' }
          : rawBp
        if (!bp || typeof bp !== 'object') continue
        const rawBpField = String(bp.field || '').trim().toLowerCase()
        const normBpField = rawBpField === 'must' ? 'allowed' : rawBpField
        const col = ['forbidden', 'allowed', 'notes'].includes(normBpField) ? normBpField : 'forbidden'
        const itemText = clamp(bp.item || bp.rule || bp.content || bp.draftText || bp.text || '', 220)
        if (!itemText || secretLike(itemText)) continue
        const replaces = Array.isArray(bp.replaces)
          ? bp.replaces.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim().slice(0, 240)).slice(0, 20)
          : []
        const colExisting = Array.isArray(existingBounds[col]) ? existingBounds[col] : []
        if (!replaces.length && colExisting.some(x => String(x).trim() === itemText)) continue
        const dupPending = ws.suggestions.some(
          existing => existing.status === 'pending' && existing.kind === 'bound' && existing.draftText === itemText,
        )
        if (dupPending) continue
        const colLabel = BOUND_COL_LABEL[col] || '禁止红线'
        const hadPinnedInReplaces = replaces.some(r => ((board.pinnedBounds && board.pinnedBounds[col]) || []).includes(r))
        const sug = normalizeSuggestion({
          kind: 'bound',
          boundField: col,
          fromAgent: replaces.length ? '✦ 参谋长浓缩' : '✦ 参谋长提炼',
          title: replaces.length
            ? `${colLabel} ${replaces.length} 合 1：${clamp(itemText, 26)}`
            : `拟入${colLabel}：${clamp(itemText, 30)}`,
          reason: clamp(
            bp.reason || (replaces.length
              ? `将 ${replaces.length} 条零散边界浓缩合成为 1 条，请拍板替换。`
              : '根据会话上下文总结的工作边界，请拍板注入。'),
            180,
          ),
          target: 'bounds',
          targetLabel: colLabel,
          mode: 'silent',
          draftText: itemText,
          replaces,
          pinGlobal: Boolean(bp.pinGlobal) || hadPinnedInReplaces,
        })
        if (sug) {
          ws.suggestions.push(sug)
          proposedBounds.push(sug)
          actionBadges.push(`${replaces.length ? '浓缩' : '呈批'}${colLabel}：${clamp(itemText, 18)}`)
        }
      }
    }

    for (const rawSug of [...pendingArchiveSuggestions, ...pendingEffortSuggestions]) {
      const sug = normalizeSuggestion(rawSug)
      if (!sug) continue
      const dup = ws.suggestions.some(ex => ex && ex.status === 'pending' && ex.kind === sug.kind && ex.title === sug.title)
      if (!dup) {
        ws.suggestions.push(sug)
        if (ws.suggestions.length > SUGGESTIONS_CAP) ws.suggestions = ws.suggestions.slice(-SUGGESTIONS_CAP)
      }
    }

    persistTurnChatAndResume(ws, {
      chiefText: replyText,
      actions: actionBadges,
      elevationObj: finalElevation,
      pendingApprovalList: queuedApprovals,
      thinkingEffort: llmRes.thinkingEffort || '',
      thinkingEffortMode: llmRes.thinkingEffortMode || effCfg.thinkingEffort || 'auto',
      forceReceipt: Boolean(
        relayResults.length > 0
        || createdInquiries.length > 0
        || proposedWalls.length > 0
        || proposedWallRemovals.length > 0
        || appliedFacts.length > 0
        || executedBoardOps.length > 0
        || executedArchiveOps.length > 0
        || executedEffortOps.length > 0
        || executedNetworkOps.length > 0
        || loopToolRecords.some(r => {
          const tName = r && ((r.call && (r.call.tool || r.call.name)) || (r.result && r.result.tool) || r.tool || '')
          return Boolean(tName && getToolOpClass(tName) !== 'read')
        })
      ),
    })
  })

  // Gently wake idle lead/peer for queued inquiries (if currently running, agent/pre-step picks them up without interruption)
  if (createdInquiries.length > 0 && deps && deps.runtime && typeof deps.runtime.get === 'function') {
    const agentsSvc = deps.runtime.get('agents')
    const leadAgent = agentsSvc && typeof agentsSvc.get === 'function' ? agentsSvc.get(rootId) : null
    if (leadAgent && leadAgent.status && leadAgent.status !== 'running') {
      for (const inqItem of createdInquiries) {
        if (!/^(?:lead|主对话)$/i.test(inqItem.target || 'lead')) continue
        try {
          const nudgeRes = await deliverCrossMessage(deps, {
            fromSession: rootId,
            fromLabel: 'DSH 参谋长 (优先问询)',
            target: inqItem.target || 'lead',
            subject: `#${inqItem.inquiryId}`,
            text: `${inqItem.question}${inqItem.context ? `\n背景：${inqItem.context}` : ''}\n请调用 chief_board({ action: "inquiry.reply", inquiryId: "${inqItem.inquiryId}", text: "..." }) 原路回传，无需中断原计划。`,
            mode: 'followup',
            envelopeKind: 'inquiry',
            taskId: inqItem.inquiryId,
            recordBoardLog: false,
          })
          if (nudgeRes && nudgeRes.deliveredPhysical) {
            mutateChiefState((s) => {
              const ws = ensureWorkspace(s, rootId)
              const rec = Array.isArray(ws.inquiries) && ws.inquiries.find(q => q && q.inquiryId === inqItem.inquiryId)
              if (rec && rec.status === 'pending') {
                rec.status = 'delivered'
                rec.deliveredAt = Date.now()
              }
            })
          }
        } catch {}
      }
    }
  }

  // Refresh narrative summary in background if facts, board, archives, or network changed (plus 60s debounced opportunistic refresh on user chat)
  const shouldRefreshNarrative = appliedFacts.length > 0
    || executedBoardOps.length > 0
    || executedArchiveOps.length > 0
    || executedNetworkOps.length > 0
  const freshView = await getChiefView(deps, rootId, {
    autoSummarize: shouldRefreshNarrative,
    chatTriggered: !_fromLeadRequest,
  })
  const freshBoard = executedBoardOps.length > 0 && deps.boardForSession && deps.boardFileFor
    ? deps.boardForSession(deps.boardFileFor(rootId))
    : undefined
  let freshArchives
  if (executedArchiveOps.length > 0) {
    try {
      const sc = rootId && rootId !== 'global' ? 'session' : 'global'
      const opt = archiveTargetForRoot(deps, rootId, { vaultScope: sc })
      const flIds = (freshView && freshView.flippedPrecipitatedIds) || []
      freshArchives = listArchiveHeaders(rootId, { vaultScope: sc, includePrecipitated: true, flippedIds: flIds }, opt)
    } catch {}
  }

  return {
    ok: true,
    reply: replyText,
    relays: relayResults,
    inquiries: createdInquiries,
    wallProposals: proposedWalls,
    wallRemovalProposals: proposedWallRemovals,
    actionBadges,
    memoryChanges: appliedFacts,
    boardOps: executedBoardOps,
    archiveOps: executedArchiveOps,
    effortOps: executedEffortOps,
    networkOps: executedNetworkOps,
    boundProposals: proposedBounds,
    toolRecords: loopToolRecords,
    pendingApprovals: queuedApprovals,
    thinkingEffort: llmRes.thinkingEffort || '',
    thinkingEffortMode: llmRes.thinkingEffortMode || effCfg.thinkingEffort || 'auto',
    ...(finalElevation ? { elevationRequested: finalElevation } : {}),
    permissionMode,
    ...(freshBoard ? { board: freshBoard } : {}),
    ...(freshArchives ? { archives: freshArchives } : {}),
    view: freshView,
  }
}


registerAskOrCommandChiefRunner(askOrCommandChief)
registerChiefDirectRequestHook(handleLeadDirectRequestToChief)


