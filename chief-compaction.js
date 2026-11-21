/**
 * chief-compaction.js
 *
 * Idle-wait compaction orchestration, token measurement, rescue harvest, and threshold advisory for DSH Chief.
 */

import { getArchiveDetail } from './archives.js'
import { normalizePermissionMode } from './chief-executor.js'
import {
  CHAT_CAP,
  archiveTargetForRoot,
  nextId,
  clamp,
  hasValidChiefRiskAck,
  COMPACT_THRESHOLD_MIN_PCT,
  COMPACT_TOKEN_HARD_MIN,
  formatCompactTokenShort,
  resolveWorkspaceConfig,
  normalizeTacticalModes,
  queueChiefApproval,
  loadChiefState,
  mutateChiefState,
  ensureWorkspace,
  extractJsonObject,
  updateChiefConfig,
} from './chief-state.js'
import { callChiefLlm } from './chief-models.js'
import { getChiefView } from './chief-view.js'
import { harvestTurnDetailsToArchive } from './chief-archives.js'

const COMPACT_POLL_MS = 180

const COMPACT_IDLE_WAIT_MS = 15_000

export async function waitUntilAgentIdle(getStatusFn, timeoutMs = COMPACT_IDLE_WAIT_MS, pollMs = COMPACT_POLL_MS) {
  const deadline = Date.now() + Math.max(200, timeoutMs)
  while (Date.now() < deadline) {
    let status = 'idle'
    try { status = getStatusFn() || 'idle' } catch {}
    if (status !== 'running') return true
    await new Promise(resolve => setTimeout(resolve, pollMs))
  }
  try {
    return (getStatusFn() || 'idle') !== 'running'
  } catch {
    return false
  }
}

export function measureAgentSessionTokensFallback(agent) {
  if (!agent || !agent.session) return null
  try {
    let totalTokens = 0
    let seq = 0
    let contextWindow = 128_000
    if (typeof agent.session.ownEvents === 'function') {
      const events = agent.session.ownEvents() || []
      seq = events.length
      for (let i = events.length - 1; i >= 0; i -= 1) {
        const ev = events[i]
        const usage = ev && (ev.usage || (ev.message && ev.message.usage) || (ev.data && ev.data.usage))
        if (usage && typeof usage === 'object') {
          const calc = (Number(usage.inputTokens) || 0)
            + (Number(usage.cacheReadTokens) || 0)
            + (Number(usage.outputTokens) || 0)
          totalTokens = Number(usage.totalTokens) || calc
          if (Number(usage.contextWindow) > 0) contextWindow = Number(usage.contextWindow)
          if (totalTokens > 0) break
        }
      }
    }
    return totalTokens > 0 ? { totalTokens, contextWindow, seq } : null
  } catch {
    return null
  }
}

/** Record a visible confirmation card in Chief's right-panel chat when autonomous smart compaction finishes. */
export function recordSmartCompactionChatReceipt(rootId, { cRes, ratioPct = 0, totalTokens = 0, contextWindow = 0, via = '✦ 智选压缩' } = {}) {
  if (!rootId || rootId === 'global' || !cRes || !cRes.ok || cRes.noop) return
  const usageNote = totalTokens > 0 && contextWindow > 0
    ? `（压前占用 ${formatCompactTokenShort(totalTokens)}/${formatCompactTokenShort(contextWindow)} · ${Math.round(ratioPct)}%）`
    : (ratioPct > 0 ? `（压前占用 ${Math.round(ratioPct)}%）` : '')
  const receiptText = `- 【${via}】已先将本轮关键细节抢救入本会话档案柜（#${cRes.harvestId}），并完成主对话静默压缩${usageNote}。`
  mutateChiefState((s) => {
    const ws = ensureWorkspace(s, rootId)
    ws.chat.push({
      id: nextId('chat'),
      role: 'chief',
      text: receiptText,
      actions: ['✦ 智选压缩'],
      at: Date.now(),
    })
    if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
  })
}

/** Shared harvest -> disk verification -> host silent compaction sequence (always harvests into Session Cabinet). */
export async function executeHarvestAndCompact(deps, {
  sid,
  rootId,
  agent = null,
  reason = '',
  seq = 0,
  ratioPct = 0,
  totalTokens = 0,
  contextWindow = 0,
  logLabel = '自动压缩',
} = {}) {
  if (!sid || !rootId || rootId === 'global') {
    return { ok: false, noop: true, error: '当前为空白新对话（未绑定活跃主会话），暂无可压缩的历史上下文' }
  }
  const focusHint = reason
    || (ratioPct > 0
      ? `上下文占用 ${Math.round(ratioPct)}%（${totalTokens}/${contextWindow} tokens），压缩前抢救现场细节。`
      : '阶段节点前抢救工程现场细节入本会话档案柜。')
  const harvest = await harvestTurnDetailsToArchive(deps, {
    sessionId: rootId,
    agent,
    vaultScope: 'session',
    trigger: 'pre-compaction',
    focusHint,
  })
  if (!harvest || !harvest.ok || !harvest.savedId) {
    return { ok: false, error: 'harvest-failed-abort-compact', detail: harvest && harvest.error }
  }

  const targetOpt = archiveTargetForRoot(deps, rootId, { vaultScope: 'session' })
  const verified = getArchiveDetail(harvest.savedId, rootId, targetOpt)
  if (!verified || !verified.ok || !verified.item) {
    return { ok: false, error: 'harvest-verify-failed-abort-compact' }
  }

  const cmdId = `dsh-chief-compact-${Date.now().toString(36)}`
  let compactRes
  try {
    compactRes = await deps.compactSessionNow(sid, cmdId)
  } catch (err) {
    const errMsg = (err && err.message) || String(err || 'compaction-failed')
    if (!/busy running/i.test(errMsg)) {
      mutateChiefState((s) => {
        const ws = ensureWorkspace(s, rootId)
        ws.runtimeGuard.pendingSmartCompact = null
      })
    }
    if (typeof deps.appendBoardLog === 'function' && rootId !== 'global') {
      deps.appendBoardLog(
        rootId,
        `⚠️ ${logLabel}未执行（已抢救档案 #${harvest.savedId}，计数未变动）：${errMsg}`,
        'chief',
      )
    }
    return { ok: false, error: errMsg, harvestId: harvest.savedId }
  }

  if (compactRes && compactRes.noop) {
    mutateChiefState((s) => {
      const ws = ensureWorkspace(s, rootId)
      ws.runtimeGuard.pendingSmartCompact = null
    })
    if (typeof deps.appendBoardLog === 'function' && rootId !== 'global') {
      deps.appendBoardLog(
        rootId,
        `🗄️ ${logLabel}：已先抢救细节入本会话档案柜（#${harvest.savedId}），宿主历史暂无需压缩`,
        'chief',
      )
    }
    return {
      ok: true,
      noop: true,
      harvestId: harvest.savedId,
      ratioPct: Math.round(ratioPct),
      compactRes,
    }
  }

  mutateChiefState((s) => {
    const ws = ensureWorkspace(s, rootId)
    ws.runtimeGuard.lastCompactedSeq = seq > 0 ? seq : ((ws.runtimeGuard.lastCompactedSeq || 0) + 1)
    ws.runtimeGuard.lastCompactedAt = Date.now()
    ws.runtimeGuard.autoCompactCount = (ws.runtimeGuard.autoCompactCount || 0) + 1
    ws.runtimeGuard.pendingSmartCompact = null
  })

  if (typeof deps.appendBoardLog === 'function' && rootId !== 'global') {
    deps.appendBoardLog(
      rootId,
      `🗜️ ${logLabel}：已先抢救细节入本会话档案柜（#${harvest.savedId}）并执行静默压缩${ratioPct > 0 ? `（占 ${Math.round(ratioPct)}%）` : ''}`,
      'chief',
    )
  }
  return {
    ok: true,
    noop: false,
    harvestId: harvest.savedId,
    ratioPct: Math.round(ratioPct),
    compactRes,
  }
}

/** Called by Lead via `chief_board({ action: "context.compact", text })` when `✦ 智选` co-management is enabled. */
export async function requestSmartCompactFromLead(deps, {
  sessionId = '',
  reason = '',
  by = 'lead',
} = {}) {
  const sid = String(sessionId || '').trim()
  if (!sid) return { ok: false, error: '当前未绑定具体会话，无法发起智选压缩' }
  const rootId = (deps && deps.resolveRootSessionId ? deps.resolveRootSessionId(sid) : '') || sid
  const state = loadChiefState()
  const effCfg = resolveWorkspaceConfig(state, rootId)
  const tactical = normalizeTacticalModes(effCfg.tacticalModes)
  if (!tactical.smartCompact && !tactical.autoCompact) {
    return { ok: false, error: '当前未开启「✦ 智选」或自动压缩模式，请先在战术菜单打开开关' }
  }

  const cleanReason = clamp(reason || '主会话判断阶段已收口，主动协同发起归档压缩', 240)
  mutateChiefState((s) => {
    const ws = ensureWorkspace(s, rootId)
    ws.runtimeGuard.pendingSmartCompact = {
      at: Date.now(),
      reason: cleanReason,
      by: clamp(by || 'lead', 40),
    }
  })

  let status = 'idle'
  try {
    if (deps && typeof deps.getAgentStatus === 'function') {
      status = deps.getAgentStatus(sid) || 'idle'
    }
  } catch {}

  if (status === 'running' || !deps || typeof deps.compactSessionNow !== 'function') {
    return {
      ok: true,
      queued: true,
      reason: cleanReason,
      message: '已登记主会话的智选归档压缩请求，本轮收口空闲后将由参谋长抢救细节入本会话档案柜并静默压缩。',
    }
  }

  let usage = null
  try {
    if (typeof deps.measureSessionTokens === 'function') {
      usage = await deps.measureSessionTokens(sid)
    }
  } catch {}
  const contextWindow = Math.max(1000, Number(usage && usage.contextWindow) || 128_000)
  const totalTokens = Number(usage && usage.totalTokens) || 0
  const seq = Math.max(0, Math.round(Number(usage && usage.seq) || 0))
  const ratioPct = totalTokens > 0 ? (totalTokens / contextWindow) * 100 : 0

  const execRes = await executeHarvestAndCompact(deps, {
    sid,
    rootId,
    reason: cleanReason,
    seq,
    ratioPct,
    totalTokens,
    contextWindow,
    logLabel: '✦ 智选压缩(主会话协同)',
  })
  return { ...execRes, compacted: Boolean(execRes && execRes.ok), reason: cleanReason }
}

/**
 * Post-Turn Auto-Compaction Pipeline (strict safety contract):
 * 1. NEVER run inside synchronous `turn-stopping` or while agent.status === 'running'. Wait for idle first.
 * 2. When `smartCompact` (`✦ 智选`) is enabled, hard `compactThresholdPct` is bypassed completely!
 *    Compaction runs ONLY on `pendingSmartCompact` (from Lead or Chief) or Chief's `shouldCompactNow` judgment.
 * 3. Always harvest into Session Cabinet + verify on disk BEFORE calling `compactSessionNow`.
 */
export async function maybeRunPreCompaction(deps, {
  agent = null,
  sessionId = '',
  rootId: explicitRootId = '',
  bypassIdleWait = false,
} = {}) {
  const sid = String(sessionId || (agent && agent.id) || '').trim()
  if (!sid) return { ok: false, skipped: 'no-session' }
  const rootId = explicitRootId || (deps && deps.resolveRootSessionId ? deps.resolveRootSessionId(sid, agent) : '') || sid

  const state = loadChiefState()
  const effCfg = resolveWorkspaceConfig(state, rootId)
  if (effCfg.stopped || effCfg.paceMode === 'stopped') {
    return { ok: false, skipped: 'chief-stopped' }
  }
  const tactical = normalizeTacticalModes(effCfg.tacticalModes)
  const wsSnapshot = ensureWorkspace(state, rootId)
  const hasAck = hasValidChiefRiskAck(wsSnapshot)
  const permMode = normalizePermissionMode(effCfg.permissionMode, { requireAck: true, hasChiefRiskAck: hasAck })
  const pendingSmart = wsSnapshot.runtimeGuard && wsSnapshot.runtimeGuard.pendingSmartCompact

  if (!pendingSmart && !tactical.autoCompact && !tactical.smartCompact) {
    return { ok: false, skipped: 'disabled' }
  }
  if (!deps || typeof deps.compactSessionNow !== 'function') return { ok: false, skipped: 'no-compaction-service' }

  if (permMode === 'advisor' || permMode === 'assistant') {
    return { ok: false, skipped: 'permission-mode', permissionMode: permMode }
  }

  // When `✦ 智选` is enabled and no pending smart request exists, hard threshold does NOT trigger!
  if (!pendingSmart && tactical.smartCompact) {
    return { ok: false, skipped: 'smart-compact-mode', mode: 'smart' }
  }

  const getStatus = () => {
    if (typeof deps.getAgentStatus === 'function') return deps.getAgentStatus(sid)
    return (agent && agent.status) || 'idle'
  }
  if (getStatus() === 'running') {
    if (bypassIdleWait) return { ok: false, skipped: 'running' }
    const becameIdle = await waitUntilAgentIdle(getStatus)
    if (!becameIdle) return { ok: false, skipped: 'busy-running' }
  }

  let usage = null
  try {
    usage = typeof deps.measureSessionTokens === 'function'
      ? await deps.measureSessionTokens(sid, agent)
      : measureAgentSessionTokensFallback(agent)
  } catch {}

  if (pendingSmart) {
    const contextWindow = Math.max(1000, Number(usage && usage.contextWindow) || 128_000)
    const totalTokens = Number(usage && usage.totalTokens) || 0
    const seq = Math.max(0, Math.round(Number(usage && usage.seq) || 0))
    const ratioPct = totalTokens > 0 ? (totalTokens / contextWindow) * 100 : 0
    if (permMode === 'strategist') {
      const dedupeKey = `auto_compact:smart:${sid}:${pendingSmart.at || seq}`
      const apr = queueChiefApproval(rootId, {
        category: 'main_workflow',
        operationLabel: '✦ 智选压缩主对话上下文 (/compact)',
        targetLabel: '当前主会话',
        reason: pendingSmart.reason || '主会话/参谋评估阶段收口，请求压缩历史上下文',
        impact: '将先抢救现场细节入本会话档案柜，再静默压缩主对话历史',
        dedupeKey,
        kind: 'compact',
        payload: { reason: pendingSmart.reason || '✦ 智选协同触发压缩' },
        by: pendingSmart.by || 'chief',
      })
      return { ok: false, pendingApproval: true, approvalId: apr && apr.id, skipped: 'pending-approval' }
    }
    const out = await executeHarvestAndCompact(deps, {
      sid,
      rootId,
      agent,
      reason: pendingSmart.reason || '主会话/参谋长智选协同触发压缩',
      seq,
      ratioPct,
      totalTokens,
      contextWindow,
      logLabel: '✦ 智选压缩',
    })
    const actuallyCompacted = Boolean(out && out.ok && !out.noop)
    if (actuallyCompacted) {
      recordSmartCompactionChatReceipt(rootId, {
        cRes: out,
        ratioPct,
        totalTokens,
        contextWindow,
        via: '✦ 智选压缩',
      })
    }
    return { ...out, smartCompacted: actuallyCompacted }
  }

  if (!usage || !Number(usage.totalTokens)) {
    return { ok: false, skipped: 'no-token-usage' }
  }
  const contextWindow = Math.max(1000, Number(usage.contextWindow) || 128_000)
  const totalTokens = Number(usage.totalTokens) || 0
  const seq = Math.max(0, Math.round(Number(usage.seq) || 0))
  const ratioPct = (totalTokens / contextWindow) * 100
  const lastSeq = (wsSnapshot.runtimeGuard && wsSnapshot.runtimeGuard.lastCompactedSeq) || 0

  const thresholdMode = tactical.compactThresholdMode === 'tokens' ? 'tokens' : 'pct'
  let limitHint = ''
  if (thresholdMode === 'tokens') {
    const thresholdTokens = Math.max(COMPACT_TOKEN_HARD_MIN, Number(tactical.compactThresholdTokens) || 64_000)
    if (totalTokens < thresholdTokens) {
      return {
        ok: false,
        skipped: 'below-threshold',
        mode: 'tokens',
        totalTokens,
        thresholdTokens,
        thresholdInput: formatCompactTokenShort(thresholdTokens),
        ratioPct: Math.round(ratioPct),
      }
    }
    limitHint = `上下文占用 ${formatCompactTokenShort(totalTokens)} 已达到自定阈值 ${formatCompactTokenShort(thresholdTokens)}`
  } else {
    const minPct = Math.max(COMPACT_THRESHOLD_MIN_PCT, Number(tactical.compactThresholdPct) || 80)
    if (ratioPct < minPct) {
      return {
        ok: false,
        skipped: 'below-threshold',
        mode: 'pct',
        ratioPct: Math.round(ratioPct),
        thresholdPct: minPct,
      }
    }
    limitHint = `上下文占用已达 ${Math.round(ratioPct)}%（阈值 ${minPct}%，${totalTokens}/${contextWindow} tokens）`
  }

  if (seq > 0 && seq <= lastSeq) {
    return { ok: false, skipped: 'already-compacted-seq', seq, lastSeq }
  }

  if (permMode === 'strategist') {
    const dedupeKey = `auto_compact:thresh:${sid}:${seq || Math.round(ratioPct)}`
    const apr = queueChiefApproval(rootId, {
      category: 'main_workflow',
      operationLabel: '自动抢救并压缩主对话上下文 (/compact)',
      targetLabel: '当前主会话',
      reason: `${limitHint}，L2 参谋模式需您逐项授权后执行压缩。`,
      impact: '将先抢救细节入本会话档案柜，随后压缩裁剪主对话历史上下文',
      dedupeKey,
      kind: 'compact',
      payload: { reason: `${limitHint}，压缩前抢救现场细节。` },
      by: 'chief',
    })
    return { ok: false, pendingApproval: true, approvalId: apr && apr.id, skipped: 'pending-approval' }
  }

  return executeHarvestAndCompact(deps, {
    sid,
    rootId,
    agent,
    reason: `${limitHint}，压缩前抢救现场细节。`,
    seq,
    ratioPct,
    totalTokens,
    contextWindow,
    logLabel: '自动压缩',
  })
}

export function buildChiefCompactFn(deps, rootId) {
  return async (reason) => {
    if (!rootId || rootId === 'global') {
      return { ok: false, noop: true, skipped: 'blank-context', error: '当前为空白新对话（未绑定活跃主会话），暂无可压缩的历史上下文' }
    }
    if (!deps || typeof deps.compactSessionNow !== 'function') {
      return { ok: false, skipped: 'no-compaction-service', error: '宿主压缩服务未挂载' }
    }
    let usage = null
    try {
      usage = typeof deps.measureSessionTokens === 'function'
        ? await deps.measureSessionTokens(rootId)
        : null
    } catch {}
    const contextWindow = Math.max(1000, Number(usage && usage.contextWindow) || 128_000)
    const totalTokens = Number(usage && usage.totalTokens) || 0
    const seq = Math.max(0, Math.round(Number(usage && usage.seq) || 0))
    const ratioPct = totalTokens > 0 ? (totalTokens / contextWindow) * 100 : 0
    return executeHarvestAndCompact(deps, {
      sid: rootId,
      rootId,
      reason: reason || '参谋长实权工具主动发起抢救与上下文压缩',
      seq,
      ratioPct,
      totalTokens,
      contextWindow,
      logLabel: '参谋长主动压缩',
    })
  }
}

const COMPACT_ADVISOR_SYSTEM = `你是 DSH 参谋长的「上下文与自动压缩策略顾问」。
用户点击了「参谋智设」自动压缩阈值按钮。请结合当前会话的模型上下文窗口、固定开销（系统提示词 + 工具定义）、已用消息数以及当前任务复杂度，给出最合理的自动压缩触发阈值百分比（必须是 5 的倍数，且严格落在给定 [floorPct, 90] 安全区间内）。

设计原则：
1. 若系统提示词+工具开销已经占用了较大比例，或上下文窗口 <= 200K，阈值绝对不能过低，否则连系统提示词都装不满就反复触发压缩，严重降智！
2. 若上下文窗口极大（如 1M 上下文，固定开销只占 ~5%），可适当设低（如 25%~40%，即 250K~400K 左右）来保持模型注意力敏锐度与高速响应，同时留出充足工作空间。
3. 请仅返回合法 JSON 对象：
{
  "recommendedPct": 30,
  "reason": "当前 1M 窗口中固定开销约 52K（5%），30%（约 300K）既能维持长程理解又能防止注意力衰退。"
}`

export async function recommendAndSetCompactThreshold(deps, { sessionId = '' } = {}) {
  const rootId = deps.resolveRootSessionId(sessionId) || String(sessionId || 'global')
  const rawUsage = typeof deps.measureSessionTokens === 'function'
    ? await Promise.resolve(deps.measureSessionTokens(rootId))
    : null
  const usage = (rawUsage && typeof rawUsage === 'object') ? rawUsage : {}

  const contextWindow = Math.max(32000, Number(usage.contextWindow) || 128000)
  const systemTokens = Math.max(0, Number(usage.systemTokens) || 0)
  const toolsTokens = Math.max(0, Number(usage.toolsTokens) || 0)
  const messageTokens = Math.max(0, Number(usage.messageTokens) || 0)
  const usedTokens = Math.max(0, Number(usage.usedTokens) || (systemTokens + toolsTokens + messageTokens))
  const overheadTokens = systemTokens + toolsTokens
  const modelRef = String(usage.modelRef || '').trim()

  const minSafeTokens = Math.max(Math.round(overheadTokens * 2.2), overheadTokens + 45000, 48000)
  const rawFloorPct = Math.ceil(((minSafeTokens / contextWindow) * 100) / 5) * 5
  const floorPct = Math.min(85, Math.max(15, rawFloorPct))

  const basePct = contextWindow >= 800000
    ? 35
    : contextWindow >= 350000
      ? 55
      : contextWindow >= 180000
        ? 65
        : 75
  const heuristicPct = Math.min(90, Math.max(floorPct, basePct))

  const fmtTok = (n) => {
    const v = Math.max(0, Math.round(Number(n) || 0))
    if (v >= 1000000) return `${(v / 1000000).toFixed(v % 1000000 === 0 ? 0 : 1)}M`
    if (v >= 1000) return `${Math.round(v / 1000)}K`
    return String(v)
  }

  let finalPct = heuristicPct
  let llmGuided = false
  let reason = `当前窗口 ${fmtTok(contextWindow)}（系统与工具固定开销 ~${fmtTok(overheadTokens)}），已自动锁定在 ${finalPct}%（~${fmtTok((contextWindow * finalPct) / 100)}），兼顾推理深度与防劣化安全底线。`

  const board = typeof deps.boardForSession === 'function' && typeof deps.boardFileFor === 'function'
    ? deps.boardForSession(deps.boardFileFor(rootId))
    : null
  const objective = board && board.objective ? clamp(board.objective, 160) : '（未设总目标）'
  const activeTaskCount = Array.isArray(board?.tasks)
    ? board.tasks.filter(t => t && (t.status === 'doing' || t.status === 'todo' || t.status === 'blocked')).length
    : 0

  try {
    const advisorPrompt = [
      `- 当前主对话模型: ${modelRef || '默认对话模型'}`,
      `- 上下文总窗口 (contextWindow): ${contextWindow} tokens (${fmtTok(contextWindow)})`,
      `- 系统提示词 (systemTokens): ${systemTokens} tokens (${fmtTok(systemTokens)})`,
      `- 工具定义 (toolsTokens): ${toolsTokens} tokens (${fmtTok(toolsTokens)})`,
      `- 固定开销合计 (overhead): ${overheadTokens} tokens (${((overheadTokens / contextWindow) * 100).toFixed(1)}%)`,
      `- 当前已用总上下文: ${usedTokens} tokens (${((usedTokens / contextWindow) * 100).toFixed(1)}%)`,
      `- 系统硬性安全下限 (floorPct): ${floorPct}% (~${fmtTok((contextWindow * floorPct) / 100)})`,
      `- 启发式基准建议: ${heuristicPct}%`,
      `- 当前任务目标: ${objective}（活跃任务 ${activeTaskCount} 项）`,
      '',
      `请给出 final recommendedPct（5 的倍数，范围 [${floorPct}, 90]）与一句不超过 85 字的中文建议理由。`,
    ].join('\n')

    const llmRes = await callChiefLlm(deps, {
      sessionId: rootId,
      reasonKind: 'recommend_compact',
      system: COMPACT_ADVISOR_SYSTEM,
      prompt: advisorPrompt,
      maxTokens: 320,
    })
    if (llmRes && llmRes.ok && llmRes.text) {
      const parsed = extractJsonObject(llmRes.text)
      if (parsed && Number.isFinite(Number(parsed.recommendedPct))) {
        const snapped = Math.round(Number(parsed.recommendedPct) / 5) * 5
        finalPct = Math.min(90, Math.max(floorPct, snapped))
        if (typeof parsed.reason === 'string' && parsed.reason.trim()) {
          reason = clamp(parsed.reason.trim(), 180)
        }
        llmGuided = true
      }
    }
  } catch {}

  updateChiefConfig({
    sessionId: rootId,
    tacticalModes: {
      compactThresholdPct: finalPct,
      autoCompact: true,
    },
  })

  const view = await getChiefView(deps, rootId, { autoSummarize: false })
  return {
    ok: true,
    recommendedPct: finalPct,
    triggerTokens: Math.round((contextWindow * finalPct) / 100),
    overheadTokens,
    contextWindow,
    systemTokens,
    toolsTokens,
    messageTokens,
    usedTokens,
    floorPct,
    modelRef,
    llmGuided,
    reason,
    view,
  }
}
