/**
 * chief-network.js — 跨会话消息路由、子代理通信、休眠/活跃会话目录与 pre-step delta 投递
 *
 * 【核心职责】
 *   承载协同队伍全量目录查询（含活跃与免切窗发现休眠会话 `listPeerDirectory`）、
 *   跨会话/子代理单播及广播消息构建投递（`deliverCrossMessage` / `buildMessageEnvelope`）、
 *   pre-step delta 消费与代理信箱读取；外部 Harness CLI 探测与派发已拆入 `network-harness.js`。
 *
 * 【导出兼容性】
 *   全量 re-export `network-harness.js` 的公共函数，对 `chief.js` 与 `api-routes.js` 保持零契约变更。
 */


import fs from 'node:fs'
import {
  MAIL_CAP,
  CHAT_CAP,
  CHIEF_UPDATE_SOURCE,
  CHIEF_RELAY_SOURCE,
  CHIEF_INQUIRY_SOURCE,
  CHIEF_EXEC_REQ_SOURCE,
  persistChiefImagesToWorkspace,
  admitChiefImages,
  nextId,
  clamp,
  cleanMultiline,
  normalizeMail,
  loadChiefState,
  mutateChiefState,
  answerChiefInquiry,
  appendChiefAuditLog,
  recordWorkspaceAlertEvent,
  getLinkedCluster,
  ensureWorkspace,
  resolveWorkspaceConfig,
  clusterView,
  stripCheckpointNoise,
  isInternalCheckpointNoise,
} from './chief-state.js'
import { loadDshLlm } from './chief-models.js'

let chiefDirectRequestHook = null

export function registerChiefDirectRequestHook(fn) {
  chiefDirectRequestHook = typeof fn === 'function' ? fn : null
}

function sanitizeJsonValue(val, depth = 0) {
  if (depth > 8) return undefined
  if (val === null) return null
  const t = typeof val
  if (t === 'string' || t === 'boolean') return val
  if (t === 'number') {
    if (!Number.isFinite(val)) return undefined
    return Object.is(val, -0) ? 0 : val
  }
  if (t !== 'object') return undefined
  if (Array.isArray(val)) {
    const arr = []
    for (const item of val) {
      const cleanItem = sanitizeJsonValue(item, depth + 1)
      if (cleanItem !== undefined) arr.push(cleanItem)
    }
    return arr
  }
  return sanitizeJsonRecord(val, depth + 1)
}

function sanitizeJsonRecord(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || depth > 8) return {}
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    if (!k || typeof k !== 'string') continue
    if (v === undefined || typeof v === 'function' || typeof v === 'symbol') continue
    const clean = sanitizeJsonValue(v, depth + 1)
    if (clean !== undefined) out[k] = clean
  }
  return out
}

function formatDeliveryFailureHint(code, rawMessage) {
  const cleanCode = String(code || '').trim()
  const cleanMsg = String(rawMessage || '').trim()
  if (cleanCode === 'agent-preset/not-found' || cleanCode === 'agent-preset/invalid') {
    return `当前会话绑定的 Agent 预设不可用（${cleanMsg || cleanCode}），可能是对应预设插件未兼容当前 DSH 版本或被禁用；请检查插件状态，或新建对话后继续`
  }
  if (cleanCode === 'session/writer-held') {
    return `目标会话正被其他进程或窗口占用写入锁（${cleanMsg || cleanCode}）`
  }
  if (cleanCode === 'session/subagent-owned') {
    return `目标会话归属子代理通道，不支持直接按主会话唤醒（${cleanMsg || cleanCode}）`
  }
  if (cleanCode && cleanCode !== 'session/not-found') {
    return cleanMsg ? `${cleanCode}: ${cleanMsg}` : cleanCode
  }
  return cleanMsg
}

export async function buildMessageEnvelope(text, sourceKind = CHIEF_RELAY_SOURCE, extraSource = {}, imageBlocks = []) {
  const dshLlm = await loadDshLlm()
  const safeImages = Array.isArray(imageBlocks) ? imageBlocks : []
  const content = [...safeImages, ...(text ? [{ type: 'text', text }] : [])]
  if (!content.length) content.push({ type: 'text', text: '' })
  const source = sanitizeJsonRecord({
    kind: String(sourceKind || CHIEF_RELAY_SOURCE),
    ...(extraSource && typeof extraSource === 'object' ? extraSource : {}),
  })
  if (!source.kind) source.kind = String(sourceKind || CHIEF_RELAY_SOURCE)
  if (dshLlm && typeof dshLlm.createUserMessage === 'function') {
    try {
      return dshLlm.createUserMessage({ content, source })
    } catch {}
  }
  return {
    id: nextId('secmsg'),
    role: 'user',
    content,
    source,
  }
}

function summarizeBoardProgress(board) {
  const tasks = Array.isArray(board && board.tasks) ? board.tasks : []
  const doneCount = tasks.filter(t => t && t.status === 'done').length
  const doingCount = tasks.filter(t => t && t.status === 'doing').length
  const blockedCount = tasks.filter(t => t && t.status === 'blocked').length
  const todoCount = tasks.filter(t => t && t.status === 'todo').length
  const plan = Array.isArray(board && board.plan) ? board.plan : []
  const planDone = plan.filter(s => s && s.done).length
  const cursorStep = clamp(board && board.cursor && board.cursor.step ? board.cursor.step : '', 48)
  const parts = []
  if (tasks.length > 0) parts.push(`任务 ${doneCount}完/${doingCount}做${blockedCount ? `/${blockedCount}阻` : ''}/${tasks.length}`)
  else if (plan.length > 0) parts.push(`步骤 ${planDone}/${plan.length}`)
  if (cursorStep) parts.push(`断点:${cursorStep}`)
  return parts.join(' · ')
}

export const PEER_DROP_TTL_MS = 15 * 60_000

/**
 * Find cross-session (`pair`) incoming messages in `targetRootId`'s mailbox within `maxAgeMs`
 * that have not yet received a reply from `targetRootId` back to the sender.
 */
export function findUnansweredIncomingPeerMails(state, targetRootId, maxAgeMs = PEER_DROP_TTL_MS) {
  const target = String(targetRootId || '').trim()
  if (!state || typeof state !== 'object' || !target || target === 'global') return []
  const workspaces = state.workspaces && typeof state.workspaces === 'object' ? state.workspaces : {}
  const targetWs = workspaces[target]
  if (!targetWs || !Array.isArray(targetWs.mailbox) || !targetWs.mailbox.length) return []

  const now = Date.now()
  const cutoff = now - Math.max(1000, Number(maxAgeMs) || PEER_DROP_TTL_MS)
  const latestBySender = new Map()

  for (const m of targetWs.mailbox) {
    if (!m || m.detachedFromCluster) continue
    if (m.routedStatus === 'unrouted' || m.routedStatus === 'stale_target') continue
    if (m.channelType !== 'pair') continue
    if (m.toRootId !== target) continue
    const fromRoot = String(m.fromRootId || '').trim()
    if (!fromRoot || fromRoot === target || fromRoot.startsWith('harness:')) continue
    const at = Number(m.at) || 0
    if (at < cutoff) continue
    const prev = latestBySender.get(fromRoot)
    if (!prev || at >= (Number(prev.at) || 0)) {
      latestBySender.set(fromRoot, m)
    }
  }

  if (!latestBySender.size) return []
  const out = []
  for (const [fromRoot, incoming] of latestBySender.entries()) {
    const incomingAt = Number(incoming.at) || 0
    const senderWs = workspaces[fromRoot]
    const searchPools = [targetWs.mailbox, ...(senderWs && Array.isArray(senderWs.mailbox) ? [senderWs.mailbox] : [])]
    let hasReply = false
    for (const pool of searchPools) {
      for (const r of pool) {
        if (!r || r.detachedFromCluster) continue
        if (r.routedStatus === 'unrouted' || r.routedStatus === 'stale_target') continue
        if (r.channelType !== 'pair' && r.channelType !== 'broadcast') continue
        if (r.fromRootId !== target) continue
        if (r.toRootId !== fromRoot && r.toRootId !== 'all') continue
        if ((Number(r.at) || 0) >= incomingAt) {
          hasReply = true
          break
        }
      }
      if (hasReply) break
    }
    if (!hasReply) out.push({ fromRootId: fromRoot, incoming })
  }
  return out
}

export function hasUnansweredIncomingPeerMail(state, targetRootId, maxAgeMs = PEER_DROP_TTL_MS) {
  return findUnansweredIncomingPeerMails(state, targetRootId, maxAgeMs).length > 0
}

export function clearPeerDropState(rootId) {
  const rid = String(rootId || '').trim()
  if (!rid || rid === 'global') return false
  const snap = loadChiefState()
  const existing = snap?.workspaces?.[rid]?.runtimeGuard?.peerDropState
  if (!existing) return false
  let cleared = false
  mutateChiefState((state) => {
    const ws = state && state.workspaces ? state.workspaces[rid] : null
    if (ws && ws.runtimeGuard && ws.runtimeGuard.peerDropState) {
      ws.runtimeGuard.peerDropState = null
      cleared = true
    }
  })
  return cleared
}

export function syncPeerDropToWaitingSenders(deps, { droppedRootId, reason = '', trigger = '', skipped = '' } = {}) {
  const dropped = String(droppedRootId || '').trim()
  if (!dropped || dropped === 'global') return { notified: [] }
  const runtime = deps && deps.runtime
  const droppedTitle = (deps && typeof deps.sessionName === 'function' ? deps.sessionName(runtime, dropped) : '')
    || ('会话 ' + dropped.replace(/^session-/, '').slice(0, 8))
  const cleanReason = clamp(reason || skipped || trigger || '中途断流', 180)
  const cleanTrigger = clamp(trigger || '', 60)
  const cleanSkipped = clamp(skipped || '', 60)
  const pendingAlerts = []
  const notified = []

  mutateChiefState((state) => {
    const droppedWs = ensureWorkspace(state, dropped)
    droppedWs.runtimeGuard.peerDropState = {
      at: Date.now(),
      reason: cleanReason,
      trigger: cleanTrigger,
      skipped: cleanSkipped,
    }
    const cluster = getLinkedCluster(state, dropped)
    const waiting = findUnansweredIncomingPeerMails(state, dropped)
      .filter(item => item && item.fromRootId && cluster.includes(item.fromRootId))
    for (const { fromRootId, incoming } of waiting) {
      const senderWs = ensureWorkspace(state, fromRootId)
      const dedupeKey = `peerdrop:${dropped}:${incoming.id}`
      if (senderWs.mailbox.some(m => m && m.broadcastId === dedupeKey)) continue
      const noticeText = `⚠️ 协同对端「${droppedTitle}」(${dropped.slice(0, 16)}) 中途断流未恢复（原因：${cleanReason}），其对你的跨窗消息尚未回传结果。请勿继续干等：可重发 mail.send 续催，或提示用户检查对端窗口。`
      const syncMail = normalizeMail({
        id: nextId('mail'),
        from: 'DSH 参谋长 (跨窗状态同步)',
        fromSession: dropped,
        fromRootId: dropped,
        to: 'lead',
        toSession: fromRootId,
        toRootId: fromRootId,
        participantRoots: [dropped, fromRootId].sort(),
        channelType: 'internal',
        broadcastId: dedupeKey,
        subject: `对端断流提醒 · ${droppedTitle}`,
        text: noticeText,
        mode: 'silent',
        deliveredPhysical: false,
        routedStatus: 'queued',
        resolvedVia: 'peer-drop-sync',
        readBy: [],
        at: Date.now(),
      })
      if (syncMail) {
        senderWs.mailbox.push(syncMail)
        if (senderWs.mailbox.length > MAIL_CAP) senderWs.mailbox = senderWs.mailbox.slice(-MAIL_CAP)
      }
      notified.push(fromRootId)
      pendingAlerts.push({ fromRootId, dedupeKey, noticeText })
    }
  })

  for (const item of pendingAlerts) {
    try {
      recordWorkspaceAlertEvent(item.fromRootId, {
        kind: 'peer_session_dropped',
        level: 'warn',
        title: '⚠️ 协同对端中途断流',
        body: clamp(item.noticeText, 180),
        dedupeKey: item.dedupeKey,
      })
    } catch {}
    try {
      if (deps && typeof deps.appendBoardLog === 'function') {
        deps.appendBoardLog(item.fromRootId, item.noticeText, 'chief')
      }
    } catch {}
  }
  return { notified }
}

export function collectClusterPeerProgress(deps, cluster = [], selfRootId = '') {
  const self = String(selfRootId || '').trim()
  const members = Array.isArray(cluster) ? cluster.filter(sid => sid && sid !== self) : []
  if (!members.length) return []
  const runtime = deps && deps.runtime
  const agentsSvc = runtime ? runtime.get('agents') : null
  const state = loadChiefState()
  const now = Date.now()
  const out = []
  for (const sid of members) {
    let board = null
    try {
      board = deps.boardForSession ? deps.boardForSession(deps.boardFileFor(sid)) : null
    } catch {}
    if (!board) continue
    let rootAgent = null
    try {
      rootAgent = agentsSvc && typeof agentsSvc.get === 'function' ? agentsSvc.get(sid) : null
    } catch {}
    const name = (deps.sessionName && deps.sessionName(runtime, rootAgent || sid)) || ('会话 ' + sid.replace(/^session-/, '').slice(0, 8))
    const isRunning = Boolean(rootAgent && rootAgent.status === 'running')
    const peerWs = state && state.workspaces ? state.workspaces[sid] : null
    const drop = peerWs && peerWs.runtimeGuard ? peerWs.runtimeGuard.peerDropState : null
    const isDropped = Boolean(drop && Number(drop.at) > 0 && (now - Number(drop.at) < PEER_DROP_TTL_MS) && !isRunning)
    const tasks = Array.isArray(board.tasks) ? board.tasks : []
    const doneCount = tasks.filter(t => t && t.status === 'done').length
    const doingCount = tasks.filter(t => t && t.status === 'doing').length
    const blockedCount = tasks.filter(t => t && t.status === 'blocked').length
    const todoCount = tasks.filter(t => t && t.status === 'todo').length
    const topTasks = tasks
      .filter(t => t && t.status !== 'done')
      .slice(0, 3)
      .map(t => `[${t.status}] #${t.id} ${clamp(t.title, 44)}`)
    const recentConclusions = (Array.isArray(board.memory) ? board.memory : [])
      .filter(m => m && !isInternalCheckpointNoise(m.title || m.text))
      .slice(-2)
      .map(m => clamp(stripCheckpointNoise(m.title || m.text), 72))
      .filter(Boolean)
    const baseProg = summarizeBoardProgress(board)
    const dropBanner = isDropped ? `⚠️ 断流未恢复(${clamp(drop.reason || drop.skipped || '中断', 36)})` : ''
    out.push({
      rootId: sid,
      name,
      status: isRunning ? 'running' : 'idle',
      ...(isDropped ? { interrupted: true, dropReason: drop.reason || '' } : {}),
      objective: clamp(board.objective || '', 120),
      cursorStep: clamp(board.cursor && board.cursor.step ? board.cursor.step : '', 90),
      cursorNext: clamp(board.cursor && board.cursor.next ? board.cursor.next : '', 90),
      cursorBlocked: clamp(board.cursor && board.cursor.blocked ? board.cursor.blocked : '', 90),
      doingCount,
      doneCount,
      blockedCount,
      todoCount,
      topTasks,
      recentConclusions,
      progressSummary: [dropBanner, baseProg].filter(Boolean).join(' · '),
    })
  }
  return out
}

const BACKGROUND_SESSION_TITLE_RE = /^(?:mnemon\s*[·•:\-]|memory\s+maintenance\b|mnemon-(?:review|run|maint)|chief-probe\b|dsh-chief-probe\b)/i
const BACKGROUND_SESSION_ID_RE = /^(?:mnemon|subagent|chief-probe|dsh-chief-probe)-/i
const USER_SESSION_ORIGINS = new Set(['user', 'human', 'interactive'])

function isSubagentHeader(hdr, agentObj = null) {
  if (hdr && (hdr.origin === 'subagent' || hdr.parentSession || hdr.parentSessionId || Number(hdr.delegationDepth || 0) > 0)) {
    return true
  }
  if (agentObj && (agentObj.origin === 'subagent' || agentObj.parentId || agentObj.parentSession || agentObj.parentSessionId || Number(agentObj.delegationDepth || 0) > 0)) {
    return true
  }
  return false
}

function isHiddenOrNonUserSession({ sid = '', header = null, title = '', agent = null, liveSession = null } = {}) {
  if (isSubagentHeader(header, agent)) return true
  const trimmedSid = String(sid || '').trim()
  if (trimmedSid && BACKGROUND_SESSION_ID_RE.test(trimmedSid)) return true
  const hdrOrigin = String((header && header.origin) || '').trim().toLowerCase()
  if (hdrOrigin && !USER_SESSION_ORIGINS.has(hdrOrigin)) return true
  const agOrigin = String((agent && agent.origin) || '').trim().toLowerCase()
  if (agOrigin && !USER_SESSION_ORIGINS.has(agOrigin)) return true
  if (
    (agent && agent.blank === true)
    || (header && header.blank === true)
    || (liveSession && (liveSession.blank === true || liveSession.seq === 0))
  ) {
    return true
  }
  const t = String(title || (agent && (agent.title || agent.name)) || '').trim()
  if (t && BACKGROUND_SESSION_TITLE_RE.test(t)) return true
  return false
}

/** Build complete addressable peer directory across lead, subagents, and federated root sessions. */
export async function listPeerDirectory(deps, sessionId) {
  const rootId = deps.resolveRootSessionId(sessionId) || String(sessionId || '')
  const state = loadChiefState()
  const cluster = getLinkedCluster(state, rootId)
  const runtime = deps.runtime
  const agentsSvc = runtime ? runtime.get('agents') : null
  const liveAgents = agentsSvc && typeof agentsSvc.list === 'function' ? agentsSvc.list() : []
  const archived = (() => {
    try {
      const list = runtime && runtime.get('workspaceRegistry')?.archivedSessionIds
      return Array.isArray(list) ? new Set(list) : new Set()
    } catch {
      return new Set()
    }
  })()

  const targets = []
  const seenKeys = new Set()
  const seenComposite = new Set()
  const clusterSnapshots = []
  const peerSessionTitles = new Set()

  for (const memberRootId of cluster) {
    const isCurrentRoot = memberRootId === rootId
    const board = deps.boardForSession(deps.boardFileFor(memberRootId))
    const roster = await deps.refreshSubagentTree(runtime, memberRootId, board)
    const rootAgent = agentsSvc && typeof agentsSvc.get === 'function' ? agentsSvc.get(memberRootId) : null
    const dormantCached = deps && deps.hostState && deps.hostState.dormantTitleCache instanceof Map
      ? deps.hostState.dormantTitleCache.get(memberRootId)
      : null
    const rootTitle = deps.sessionName(runtime, rootAgent || memberRootId)
      || (dormantCached && dormantCached.title)
      || ('会话 ' + memberRootId.replace(/^session-/, '').slice(0, 8))
    const memberProgressSummary = summarizeBoardProgress(board)
    if (!isCurrentRoot && rootTitle) peerSessionTitles.add(String(rootTitle).trim().toLowerCase())
    clusterSnapshots.push({ memberRootId, isCurrentRoot, board, roster, rootTitle, memberProgressSummary })
  }

  for (const snap of clusterSnapshots) {
    const { memberRootId, isCurrentRoot, board, roster, rootTitle, memberProgressSummary } = snap
    for (const entry of roster) {
      if (!entry) continue
      const isLead = entry.name === 'lead'
      const hasVerifiedChild = !isLead && Boolean(
        entry.verifiedInstance !== false
        && !entry.stale
        && entry.id
        && entry.id !== memberRootId
        && entry.status !== 'stale'
        && entry.status !== 'unavailable',
      )
      const entryNameLower = String(entry.name || '').trim().toLowerCase()
      if (!isLead && !hasVerifiedChild && entryNameLower && peerSessionTitles.has(entryNameLower)) {
        continue
      }
      const kind = isLead
        ? (isCurrentRoot ? 'lead' : 'peer-session')
        : (hasVerifiedChild ? 'subagent' : 'stale')
      const resolvedId = isLead
        ? memberRootId
        : (hasVerifiedChild ? String(entry.id) : '')
      const key = isCurrentRoot
        ? (isLead ? 'lead' : entry.name)
        : (isLead ? memberRootId : `${memberRootId}:${entry.name}`)
      const compositeId = `${kind}:${resolvedId || key}`
      if (seenKeys.has(key) || seenComposite.has(compositeId)) continue
      seenKeys.add(key)
      seenComposite.add(compositeId)
      const peerWs = isLead && !isCurrentRoot && state && state.workspaces ? state.workspaces[memberRootId] : null
      const peerDrop = peerWs && peerWs.runtimeGuard ? peerWs.runtimeGuard.peerDropState : null
      const isPeerInterrupted = Boolean(
        peerDrop && Number(peerDrop.at) > 0 && (Date.now() - Number(peerDrop.at) < PEER_DROP_TTL_MS) && entry.status !== 'running',
      )
      targets.push({
        key,
        id: resolvedId,
        agentId: resolvedId,
        rootId: memberRootId,
        parentRootId: memberRootId,
        name: isLead ? (isCurrentRoot ? '主对话' : rootTitle) : entry.name,
        handle: isCurrentRoot ? (isLead ? 'lead' : entry.name) : (isLead ? rootTitle : `${rootTitle}/${entry.name}`),
        kind,
        isCurrentRoot,
        verifiedInstance: isLead || hasVerifiedChild,
        routable: isLead || hasVerifiedChild,
        status: kind === 'stale' ? 'stale' : (entry.status === 'running' ? 'running' : 'idle'),
        ...(isPeerInterrupted ? { interrupted: true, dropReason: peerDrop.reason || peerDrop.skipped || '' } : {}),
        taskTitle: entry.taskTitle || entry.description || (board && board.objective ? clamp(board.objective, 48) : ''),
        ...(isLead ? { progressSummary: memberProgressSummary, objective: clamp(board && board.objective ? board.objective : '', 80) } : {}),
        parentId: isLead ? memberRootId : (hasVerifiedChild ? (entry.parentId || memberRootId) : ''),
        mode: entry.mode || 'continuable',
      })
    }
  }
  const routableFirst = targets.filter(t => t.kind !== 'stale')
  const staleLast = targets.filter(t => t.kind === 'stale')
  targets.length = 0
  targets.push(...routableFirst, ...staleLast)

  // Other top-level standalone sessions on this machine (live + dormant/unvisited) that can be linked into the federation
  const liveSessBySid = new Map()
  try {
    const sessSvc = runtime && typeof runtime.get === 'function' ? runtime.get('sessions') : null
    const sList = sessSvc && typeof sessSvc.list === 'function' ? sessSvc.list() : []
    for (const s of Array.isArray(sList) ? sList : []) {
      if (!s || !s.id) continue
      liveSessBySid.set(String(s.id), s)
    }
  } catch {}

  const otherSessions = []
  const seenOtherIds = new Set()
  for (const ag of liveAgents) {
    const sid = String(ag && ag.id ? ag.id : '')
    if (!sid || archived.has(sid)) continue
    const agRoot = deps.resolveRootSessionId(sid, ag) || sid
    if (agRoot !== sid) continue // skip child subagent sessions here
    if (agRoot === rootId || seenOtherIds.has(agRoot)) continue
    const liveS = liveSessBySid.get(agRoot) || null
    const hdr = (liveS && liveS.header) || (ag && ag.header) || null
    const resolvedLiveName = deps.sessionName(runtime, ag) || ''
    if (isHiddenOrNonUserSession({ sid: agRoot, header: hdr, title: resolvedLiveName, agent: ag, liveSession: liveS })) continue
    seenOtherIds.add(agRoot)
    const isLinked = cluster.includes(agRoot)
    const b = deps.loadBoard(deps.boardFileFor(agRoot))
    otherSessions.push({
      id: agRoot,
      name: resolvedLiveName || ('会话 ' + agRoot.replace(/^session-/, '').slice(0, 8)),
      status: ag.status === 'running' ? 'running' : 'idle',
      dormant: false,
      linked: isLinked,
      objective: clamp(b && b.objective ? b.objective : '', 80),
      openTasks: Array.isArray(b && b.tasks) ? b.tasks.filter(t => t.status !== 'done').length : 0,
      progressSummary: summarizeBoardProgress(b),
    })
  }

  // Also discover dormant / unvisited root sessions scoped strictly to active user workspaces (no orphan/background disk scan)
  const hostState = deps && deps.hostState && typeof deps.hostState === 'object' ? deps.hostState : null
  if (hostState && !(hostState.dormantTitleCache instanceof Map)) {
    hostState.dormantTitleCache = new Map()
  }
  const titleCache = hostState ? hostState.dormantTitleCache : null

  const dormantCandidates = []
  const seenCandidates = new Set()
  const pushCandidate = (rawSid, headerHint = null, liveSessionHint = null) => {
    const sid = String(rawSid || '').trim()
    if (!sid || sid === rootId || archived.has(sid) || seenOtherIds.has(sid) || seenCandidates.has(sid)) return
    const liveS = liveSessionHint || liveSessBySid.get(sid) || null
    const effHeader = headerHint || (liveS && liveS.header) || null
    if (isHiddenOrNonUserSession({ sid, header: effHeader, liveSession: liveS })) return
    const agRoot = deps.resolveRootSessionId(sid) || sid
    if (agRoot !== sid) return
    seenCandidates.add(sid)
    dormantCandidates.push(sid)
  }

  let hasWorkspaceRegistry = false
  try {
    const wr = runtime && typeof runtime.get === 'function' ? runtime.get('workspaceRegistry') : null
    if (wr && typeof wr.list === 'function') {
      hasWorkspaceRegistry = true
      const wsList = wr.list()
      for (const ws of Array.isArray(wsList) ? wsList : []) {
        if (!ws) continue
        for (const sid of Array.isArray(ws.sessionIds) ? ws.sessionIds : []) {
          pushCandidate(sid)
        }
      }
    }
  } catch {}

  if (!hasWorkspaceRegistry) {
    for (const s of liveSessBySid.values()) {
      pushCandidate(s.id, s.header || null, s)
    }
  }

  const sessionQuery = runtime && typeof runtime.get === 'function' ? runtime.get('sessionQuery') : null
  const boundedDormant = dormantCandidates.slice(0, 40)
  const uncachedIds = boundedDormant.filter(sid => !titleCache || !titleCache.has(sid))
  if (uncachedIds.length > 0 && sessionQuery && typeof sessionQuery.readTitleSnapshots === 'function') {
    try {
      const tSig = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(2500)
        : undefined
      const obsList = await sessionQuery.readTitleSnapshots(uncachedIds, tSig)
      if (Array.isArray(obsList)) {
        for (const obs of obsList) {
          if (!obs || !obs.sessionId) continue
          const obsSid = String(obs.sessionId)
          if (obs.status !== 'fulfilled' || !obs.value) {
            if (titleCache) {
              titleCache.set(obsSid, { title: '', isSubagent: false, isHidden: true, missing: true, blank: true })
            }
            continue
          }
          const hdr = obs.value.session || null
          const folded = String((obs.value.title && obs.value.title.title) || '').trim()
          const liveS = liveSessBySid.get(obsSid) || null
          const isSub = isSubagentHeader(hdr)
          const isHidden = isHiddenOrNonUserSession({ sid: obsSid, header: hdr, title: folded, liveSession: liveS })
          if (titleCache) {
            titleCache.set(obsSid, { title: folded, isSubagent: isSub, isHidden, missing: false, blank: !folded })
          }
        }
      }
    } catch {}
  }

  for (const sid of boundedDormant) {
    let cachedMeta = titleCache ? titleCache.get(sid) : null
    if (!cachedMeta) {
      const liveS = liveSessBySid.get(sid) || null
      const hdr = liveS && liveS.header ? liveS.header : null
      const isSub = isSubagentHeader(hdr)
      const isHidden = isHiddenOrNonUserSession({ sid, header: hdr, liveSession: liveS })
      cachedMeta = { title: '', isSubagent: isSub, isHidden, missing: false, blank: false }
      if (titleCache) titleCache.set(sid, cachedMeta)
    }
    if (cachedMeta.missing || cachedMeta.isSubagent || cachedMeta.isHidden) continue
    const b = deps.loadBoard(deps.boardFileFor(sid))
    const hasBoardContent = Boolean(b && (b.objective || (Array.isArray(b.tasks) && b.tasks.length > 0)))
    const foldedTitle = cachedMeta.title || ''
    const namedTitle = foldedTitle || deps.sessionName(runtime, sid) || ''
    if (!namedTitle && !hasBoardContent && !cluster.includes(sid)) continue
    if (cachedMeta.blank && !hasBoardContent && !cluster.includes(sid)) continue
    const resolvedName = namedTitle || ('会话 ' + sid.replace(/^session-/, '').slice(0, 8))
    if (isHiddenOrNonUserSession({ sid, title: resolvedName })) continue
    seenOtherIds.add(sid)
    otherSessions.push({
      id: sid,
      name: resolvedName,
      status: 'idle',
      dormant: true,
      linked: cluster.includes(sid),
      objective: clamp(b && b.objective ? b.objective : '', 80),
      openTasks: Array.isArray(b && b.tasks) ? b.tasks.filter(t => t.status !== 'done').length : 0,
      progressSummary: summarizeBoardProgress(b),
    })
  }

  return {
    rootId,
    cluster,
    targets,
    otherSessions,
  }
}

function matchTargetPeer(targets, rawTarget) {
  let q = String(rawTarget || '').trim().replace(/^@/, '')
  if (!q) return null
  let kindFilter = ''
  const kindMatch = q.match(/^(lead|peer-session|subagent|stale):(.*)$/i)
  if (kindMatch) {
    kindFilter = kindMatch[1].toLowerCase()
    q = String(kindMatch[2] || '').trim()
    if (!q) return null
  }
  const pool = kindFilter
    ? targets.filter(t => t && String(t.kind || '').toLowerCase() === kindFilter)
    : targets
  const routable = pool.filter(t => t && t.kind !== 'stale' && t.routable !== false)
  const stale = pool.filter(t => t && (t.kind === 'stale' || t.routable === false))
  const lower = q.toLowerCase()
  if (!kindFilter && (lower === 'lead' || lower === 'main' || lower === '主对话' || lower === '主代理')) {
    return routable.find(t => t.kind === 'lead' && t.isCurrentRoot) || routable[0] || null
  }
  const kindPriority = t => (t.kind === 'lead' || t.kind === 'peer-session' ? 0 : 1)
  const sortCandidates = list => list.slice().sort((a, b) =>
    (kindPriority(a) - kindPriority(b)) || (Number(Boolean(b.isCurrentRoot)) - Number(Boolean(a.isCurrentRoot))),
  )
  // 1. Exact id / agentId / key match on live/routable targets first
  for (const t of routable) {
    if (
      (t.id && t.id.toLowerCase() === lower)
      || (t.agentId && t.agentId.toLowerCase() === lower)
      || t.key.toLowerCase() === lower
    ) {
      return t
    }
  }
  // 2a. Exact handle match on live/routable targets
  const handleHits = routable.filter(t => String(t.handle || '').toLowerCase() === lower)
  if (handleHits.length === 1) return handleHits[0]
  if (handleHits.length > 1) return sortCandidates(handleHits)[0]

  // 2b. Exact name match with cross-session disambiguation
  const exactNameHits = routable.filter(t => String(t.name || '').toLowerCase() === lower)
  if (exactNameHits.length === 1) return exactNameHits[0]
  if (exactNameHits.length > 1) {
    const sessionHits = exactNameHits.filter(t => t.kind === 'lead' || t.kind === 'peer-session')
    if (sessionHits.length === 1) return sessionHits[0]
    const localHits = exactNameHits.filter(t => t.isCurrentRoot)
    if (localHits.length === 1) return localHits[0]
    return { _ambiguous: true, candidates: sortCandidates(exactNameHits) }
  }

  // 2c. Short-name match with local-first resolution or ambiguity error
  const shortHits = routable.filter(t => String(t.name || '').split('/').pop().toLowerCase() === lower)
  if (shortHits.length === 1) return shortHits[0]
  if (shortHits.length > 1) {
    const localHits = shortHits.filter(t => t.isCurrentRoot)
    if (localHits.length === 1) return localHits[0]
    return { _ambiguous: true, candidates: sortCandidates(shortHits) }
  }

  // 3. Partial substring match prioritizing lead / peer-session, then local subagents, then remote
  const leadOrPeerFuzzy = routable.find(t =>
    (t.kind === 'lead' || t.kind === 'peer-session')
    && (t.name.toLowerCase().includes(lower) || t.handle.toLowerCase().includes(lower)),
  )
  if (leadOrPeerFuzzy) return leadOrPeerFuzzy
  const localFuzzy = routable.find(t =>
    t.isCurrentRoot && (t.name.toLowerCase().includes(lower) || t.handle.toLowerCase().includes(lower)),
  )
  if (localFuzzy) return localFuzzy
  const remoteFuzzy = routable.find(t =>
    t.name.toLowerCase().includes(lower) || t.handle.toLowerCase().includes(lower),
  )
  if (remoteFuzzy) return remoteFuzzy
  // 4. Fallback exact match against stale entries so deliverSinglePeer emits a precise stale_target rejection
  return stale.find(t =>
    t.key.toLowerCase() === lower
    || t.handle.toLowerCase() === lower
    || t.name.toLowerCase() === lower
    || t.name.split('/').pop().toLowerCase() === lower,
  ) || null
}

/**
 * Deliver a message across conversations (lead <-> subagent, subagent <-> subagent, session <-> session).
 * Modes:
 * - 'steer': cut into next step boundary immediately if running, or wake if idle.
 * - 'followup': queue for next turn / wake idle session without cutting running step.
 * - 'silent': record in chief mailbox so the recipient sees it cleanly at its next pre-step without waking an idle session.
 */
function buildSavedImageNotice(savedImagePaths) {
  const list = Array.isArray(savedImagePaths) ? savedImagePaths.filter(item => item && item.path) : []
  if (!list.length) return ''
  return [
    '',
    '🖼️ [用户原图已落盘至工作区路径]：',
    ...list.map(item => `- ${item.path}${item.name ? ` (${item.name})` : ''}`),
    '⚠️ 请直接查阅附带图片或使用读图/文件工具读取上述原始路径后再动手，严禁只凭参谋长转述文本猜测或编造未确认的图内信息！',
  ].join('\n')
}

export async function deliverCrossMessage(deps, {
  fromSession = '',
  fromLabel = 'DSH 参谋长',
  target = 'lead',
  text = '',
  subject = '',
  mode = 'steer',
  envelopeKind = 'relay',
  taskId = '',
  inquiryId = '',
  images = [],
  imageBlocks: preAdmittedBlocks = null,
  savedImagePaths: preSavedPaths = null,
  recordBoardLog = true,
}) {
  const cleanBody = cleanMultiline(text, 2400)
  const rawImages = Array.isArray(images) ? images : []
  const hasPreAdmitted = Array.isArray(preAdmittedBlocks) && preAdmittedBlocks.length > 0
  let savedPaths = Array.isArray(preSavedPaths) ? preSavedPaths : []
  if (!savedPaths.length && rawImages.length > 0) {
    try {
      savedPaths = persistChiefImagesToWorkspace(deps, fromSession, rawImages)
    } catch {}
  }

  if (!cleanBody && !rawImages.length && !hasPreAdmitted && !savedPaths.length) {
    return { ok: false, error: '递话内容不能为空' }
  }

  let admittedBlocks = hasPreAdmitted ? preAdmittedBlocks : []
  if (!hasPreAdmitted && rawImages.length > 0) {
    try {
      admittedBlocks = await admitChiefImages(deps, rawImages)
    } catch (err) {
      if (!savedPaths.length) {
        return { ok: false, error: String(err && err.message ? err.message : err) }
      }
      // Degrade cleanly to path-based image delivery if host attachments service is unavailable
      admittedBlocks = []
    }
  }
  const effectiveText = cleanBody || (admittedBlocks.length || savedPaths.length ? '请查看随信附带的图片与落盘路径。' : '')
  const totalImgCount = Math.max(admittedBlocks.length, savedPaths.length)
  const imgTag = totalImgCount > 0 ? ` [附图 ×${totalImgCount}]` : ''

  const rootId = (deps.resolveRootSessionId && deps.resolveRootSessionId(fromSession)) || String(fromSession || directoryRootFallback(fromSession))
  const rawTargetPre = String(target || 'lead').trim().replace(/^@/, '')
  if (/^(?:chief|dsh-chief|参谋长|参谋)$/i.test(rawTargetPre)) {
    const cleanChiefBody = cleanMultiline(text, 2400)
    if (envelopeKind === 'inquiry_reply') {
      if (!cleanChiefBody) return { ok: false, error: 'inquiry.reply 必须提供非空答复文本 (text)' }
      const effInqId = String(inquiryId || taskId || '').trim()
      const ansRes = answerChiefInquiry(rootId || 'global', {
        inquiryId: effInqId,
        answer: cleanChiefBody,
        by: fromLabel,
      })
      if (recordBoardLog && rootId && typeof deps.appendBoardLog === 'function' && ansRes && ansRes.ok && ansRes.inquiry) {
        deps.appendBoardLog(rootId, `⚡ ${fromLabel} 已原路回传问询 #${ansRes.inquiry.inquiryId}`, fromLabel)
      }
      return {
        ok: Boolean(ansRes && ansRes.ok),
        target: 'DSH 参谋长',
        targetId: 'chief',
        deliveryMode: 'inquiry-reply',
        inquiryAnswered: ansRes && ansRes.inquiry ? ansRes.inquiry : null,
        continueOwnWork: true,
        ...(ansRes && !ansRes.ok ? { error: ansRes.error } : {}),
      }
    }
    if (!cleanChiefBody) return { ok: false, error: '传话给参谋长的内容不能为空' }
    const chiefMail = normalizeMail({
      id: nextId('mail'),
      from: fromLabel,
      fromSession,
      fromRootId: rootId,
      to: 'chief',
      toSession: 'chief',
      toRootId: rootId,
      participantRoots: rootId ? [rootId] : [],
      channelType: 'internal',
      subject: subject || '主对话求助与协同请求',
      text: cleanChiefBody,
      mode: mode || 'followup',
      deliveredPhysical: true,
      readBy: ['chief'],
      at: Date.now(),
    })
    mutateChiefState((state) => {
      const ws = ensureWorkspace(state, rootId || 'global')
      if (chiefMail) {
        ws.mailbox.push(chiefMail)
        if (ws.mailbox.length > MAIL_CAP) ws.mailbox = ws.mailbox.slice(-MAIL_CAP)
      }
    })
    if (recordBoardLog && rootId && typeof deps.appendBoardLog === 'function') {
      deps.appendBoardLog(rootId, `📨 ${fromLabel} → @参谋长：${clamp(cleanChiefBody, 56)}`, fromLabel)
    }
    if (chiefDirectRequestHook) {
      try {
        const hookRes = await chiefDirectRequestHook(deps, {
          fromSession: rootId || fromSession,
          fromLabel,
          subject,
          text: cleanChiefBody,
          mail: chiefMail,
        })
        if (hookRes && typeof hookRes === 'object') {
          return {
            ok: hookRes.ok !== false,
            target: 'DSH 参谋长',
            targetId: 'chief',
            deliveryMode: 'chief-direct-request',
            deliveredPhysical: true,
            mail: chiefMail,
            ...hookRes,
          }
        }
      } catch (err) {
        return {
          ok: false,
          target: 'DSH 参谋长',
          mail: chiefMail,
          error: String(err && err.message ? err.message : err),
        }
      }
    }
    return {
      ok: true,
      target: 'DSH 参谋长',
      targetId: 'chief',
      deliveryMode: 'chief-mailbox',
      deliveredPhysical: true,
      mail: chiefMail,
    }
  }

  const directory = await listPeerDirectory(deps, rootId || fromSession)
  const senderRootId = rootId || directory.rootId || ''
  const rawTarget = rawTargetPre

  // Broadcast support: 'all' / '全体' / 'team' (deduplicated single mailbox record for clean drawer UI)
  if (['all', 'team', '全体', '所有人'].includes(rawTarget.toLowerCase())) {
    const recipients = directory.targets.filter(t =>
      t && t.kind !== 'stale' && t.routable !== false && t.id && t.id !== fromSession,
    )
    const deliveries = []
    const deliveredReadMarks = []
    for (const peer of recipients) {
      const res = await deliverSinglePeer(deps, directory, peer, {
        fromSession,
        fromRootId: senderRootId,
        fromLabel,
        text: effectiveText,
        subject,
        mode,
        imageBlocks: admittedBlocks,
        savedImagePaths: savedPaths,
        recordBoardLog: false,
        recordMailbox: false,
      })
      deliveries.push({ target: peer.handle, ok: res.ok, mode: res.deliveryMode })
      if (res.deliveredPhysical) {
        if (peer.id) deliveredReadMarks.push(peer.id)
        if (peer.key) deliveredReadMarks.push(peer.key)
        if (peer.name) deliveredReadMarks.push(peer.name)
      }
    }
    const participantRoots = [...new Set([senderRootId, ...(directory.cluster || [])].filter(Boolean))].sort()
    const imgNoticeBlock = buildSavedImageNotice(savedPaths)
    const textWithImagePaths = imgNoticeBlock ? `${effectiveText}\n${imgNoticeBlock}` : effectiveText
    const broadcastId = nextId('bcast')
    const mailItem = normalizeMail({
      id: nextId('mail'),
      from: fromLabel,
      fromSession,
      fromRootId: senderRootId,
      to: 'all',
      toSession: 'all',
      toRootId: 'all',
      participantRoots,
      channelType: participantRoots.length > 1 ? 'broadcast' : 'internal',
      broadcastId,
      subject,
      text: totalImgCount > 0 ? `${textWithImagePaths}${imgTag}` : textWithImagePaths,
      imageCount: totalImgCount,
      mode,
      deliveredPhysical: deliveries.some(d => d.ok && d.mode !== 'mailbox-queued'),
      readBy: [...new Set(deliveredReadMarks)],
      at: Date.now(),
    })
    if (mailItem) {
      mutateChiefState((state) => {
        const ws = ensureWorkspace(state, senderRootId || directory.rootId)
        ws.mailbox.push(mailItem)
        if (ws.mailbox.length > MAIL_CAP) ws.mailbox = ws.mailbox.slice(-MAIL_CAP)
      })
    }
    if (recordBoardLog && rootId) {
      deps.appendBoardLog(rootId, `📡 ${fromLabel} 向全体成员广播递话（${deliveries.filter(d => d.ok).length} 个目标）：${clamp(effectiveText, 56)}${imgTag}`, fromLabel)
    }
    return { ok: true, broadcast: true, target: 'all', mail: mailItem, deliveries, savedImagePaths: savedPaths }
  }

  // Multi-target comma-separated support (e.g. "sessionA,sessionB" or "worker1,worker2")
  if (/[,，]/.test(rawTarget)) {
    const parts = rawTarget.split(/[,，]/).map(s => s.trim().replace(/^@/, '')).filter(Boolean)
    const matched = []
    const seenKeys = new Set()
    for (const part of parts) {
      const hit = matchTargetPeer(directory.targets, part)
      if (hit && !hit._ambiguous && hit.kind !== 'stale' && hit.routable !== false && !seenKeys.has(hit.key)) {
        seenKeys.add(hit.key)
        matched.push(hit)
      }
    }
    if (matched.length >= 2) {
      const deliveries = []
      const readMarks = []
      const roots = new Set([senderRootId].filter(Boolean))
      for (const peer of matched) {
        if (peer.rootId) roots.add(peer.rootId)
        const res = await deliverSinglePeer(deps, directory, peer, {
          fromSession,
          fromRootId: senderRootId,
          fromLabel,
          text: effectiveText,
          subject,
          mode,
          imageBlocks: admittedBlocks,
          savedImagePaths: savedPaths,
          recordBoardLog: false,
          recordMailbox: false,
        })
        deliveries.push({ target: peer.handle, ok: res.ok, mode: res.deliveryMode })
        if (res.deliveredPhysical) {
          if (peer.id) readMarks.push(peer.id)
          if (peer.key) readMarks.push(peer.key)
          if (peer.name) readMarks.push(peer.name)
        }
      }
      const participantRoots = [...roots].sort()
      const imgNoticeBlock = buildSavedImageNotice(savedPaths)
      const textWithImagePaths = imgNoticeBlock ? `${effectiveText}\n${imgNoticeBlock}` : effectiveText
      const mailItem = normalizeMail({
        id: nextId('mail'),
        from: fromLabel,
        fromSession,
        fromRootId: senderRootId,
        to: matched.map(m => m.handle).join('、'),
        toSession: matched.map(m => m.id || m.key).join(','),
        toRootId: participantRoots.length > 1 ? 'multi' : (participantRoots[0] || ''),
        participantRoots,
        channelType: participantRoots.length >= 3 ? 'multi' : (participantRoots.length === 2 ? 'pair' : 'internal'),
        broadcastId: nextId('multi'),
        subject,
        text: totalImgCount > 0 ? `${textWithImagePaths}${imgTag}` : textWithImagePaths,
        imageCount: totalImgCount,
        mode,
        deliveredPhysical: deliveries.some(d => d.ok && d.mode !== 'mailbox-queued'),
        readBy: [...new Set(readMarks)],
        at: Date.now(),
      })
      if (mailItem) {
        mutateChiefState((state) => {
          const ws = ensureWorkspace(state, senderRootId || directory.rootId)
          ws.mailbox.push(mailItem)
          if (ws.mailbox.length > MAIL_CAP) ws.mailbox = ws.mailbox.slice(-MAIL_CAP)
        })
      }
      return { ok: true, multi: true, target: matched.map(m => m.handle).join('、'), mail: mailItem, deliveries, savedImagePaths: savedPaths }
    }
  }

  const peer = matchTargetPeer(directory.targets, rawTarget)
  if (peer && peer._ambiguous) {
    return {
      ok: false,
      error: `目标 "${rawTarget}" 在多个联动会话中存在同名代理（${peer.candidates.map(c => c.handle).join('、')}），请使用带会话前缀的完整句柄（如 "${peer.candidates[0].handle}"）或直接发给目标会话 lead。`,
      ambiguousTargets: peer.candidates.map(c => c.handle),
    }
  }
  if (!peer) {
    const extHit = resolveExternalHarnessTarget(deps && deps.runtime, deps && deps.hostState, senderRootId, rawTarget)
    if (extHit) {
      const disp = await dispatchBubbleHarness(deps, {
        rootId: senderRootId,
        provider: extHit.provider,
        text: effectiveText,
        label: subject || clamp(effectiveText, 48),
        fromLabel,
        allowAutoEnroll: true,
      })
      if (!disp.ok) {
        return {
          ok: false,
          error: disp.error || `外部工具 ${extHit.label || extHit.provider} 派单失败`,
          locked: Boolean(disp.locked),
        }
      }
      if (recordBoardLog && rootId && typeof deps.appendBoardLog === 'function') {
        deps.appendBoardLog(rootId, `⚡ ${fromLabel} → @${extHit.provider} 外部派单：${clamp(effectiveText, 56)}`, fromLabel)
      }
      return {
        ok: true,
        target: extHit.label || extHit.provider,
        targetId: extHit.provider,
        deliveryMode: 'bubble-harness',
        transport: disp.transport,
        runId: disp.runId,
        childId: disp.childId,
        deliveredPhysical: true,
        bubbleLocked: true,
      }
    }
    const bAvail = computeBubbleState(deps, senderRootId)
    const availHarnesses = [...(bAvail.enrolledHarnesses || []), ...(bAvail.availableHarnesses || [])]
      .filter(h => h && h.installed !== false)
      .map(h => h.provider)
    const targetChoices = [
      ...directory.targets.filter(t => t && t.kind !== 'stale' && t.routable !== false).map(t => t.handle),
      ...new Set(availHarnesses),
    ].filter(Boolean)
    return {
      ok: false,
      error: `未找到目标对话 "${rawTarget}"。当前可用目标：${targetChoices.join('、') || '无'}`,
    }
  }

  return deliverSinglePeer(deps, directory, peer, {
    fromSession,
    fromRootId: senderRootId,
    fromLabel,
    text: effectiveText,
    subject,
    mode,
    envelopeKind,
    taskId,
    imageBlocks: admittedBlocks,
    savedImagePaths: savedPaths,
    recordBoardLog,
    recordMailbox: true,
  })
}

function directoryRootFallback(fromSession) {
  return String(fromSession || 'global')
}

async function deliverSinglePeer(deps, directory, peer, {
  fromSession,
  fromRootId = '',
  fromLabel,
  text,
  subject,
  mode,
  envelopeKind = 'relay',
  taskId = '',
  imageBlocks = [],
  savedImagePaths = [],
  recordBoardLog,
  recordMailbox = true,
}) {
  const runtime = deps.runtime
  const agentsSvc = runtime ? runtime.get('agents') : null
  const subagentsSvc = runtime ? runtime.get('subagents') : null
  const safeBlocks = Array.isArray(imageBlocks) ? imageBlocks : []
  const safePaths = Array.isArray(savedImagePaths) ? savedImagePaths : []
  const imgCount = Math.max(safeBlocks.length, safePaths.length)
  const imgSuffix = imgCount > 0 ? ` [附图 ×${imgCount}]` : ''
  const imgNoticeBlock = buildSavedImageNotice(safePaths)
  const textWithImagePaths = imgNoticeBlock ? `${text}\n${imgNoticeBlock}` : text
  const headerTag = envelopeKind === 'execution_request'
    ? `[EXECUTION_REQUEST${taskId ? ' #' + taskId : ''} · 来自 ${fromLabel}]`
    : (envelopeKind === 'inquiry'
        ? `[INQUIRY${taskId ? ' #' + taskId : ''} · DSH 参谋长优先问询]`
        : (mode === 'steer'
            ? `[DSH 参谋长插话 · 来自 ${fromLabel}]`
            : `[DSH 参谋长递话 · 来自 ${fromLabel}]`))
  const footerGuide = envelopeKind === 'inquiry'
    ? '（请顺手调用 chief_board({ action: "inquiry.reply", text: "…" }) 原路作答，无需中断手头当前任务！）'
    : `（如遇到需要参谋长协调、建议、或提权执行的需求，可调用 chief_board({ action: "chief.request", text: "…" }) 或 mail.send({ target: "chief", text: "…" })）`
  const formatted = `${headerTag}${subject ? ' ' + subject : ''}\n${textWithImagePaths}\n\n${footerGuide}`

  let deliveredPhysical = false
  let deliveryMode = 'mailbox-queued'
  let routedStatus = 'queued'
  let resolvedAgentId = ''
  let resolvedVia = ''
  let errorNote = ''
  let resolveErrorCode = ''
  let resolveError = ''
  let hadHardError = false
  let pathBBlocked = false

  const senderRoot = String(fromRootId || (fromSession && deps.resolveRootSessionId && deps.resolveRootSessionId(fromSession)) || directory.rootId || '').trim()
  const targetRoot = String(peer.rootId || directory.rootId || '').trim()
  const participantRoots = [...new Set([senderRoot, targetRoot].filter(Boolean))].sort()
  const channelType = participantRoots.length >= 2 ? 'pair' : 'internal'
  const auditRootId = targetRoot || directory.rootId || ''

  // Gate 0: Refuse unbacked / stale phantom entries outright (no Path A/B, never mark readBy)
  if (peer.kind === 'stale' || peer.routable === false) {
    deliveryMode = 'unrouted'
    routedStatus = 'stale_target'
    resolvedAgentId = ''
    resolvedVia = 'rejected:stale_target'
    errorNote = `目标 "${peer.handle}" 当前无运行实例（kind=stale），已拒绝投递以防误投主对话`
    hadHardError = true
    const mailItem = normalizeMail({
      id: nextId('mail'),
      from: fromLabel,
      fromSession,
      fromRootId: senderRoot,
      to: peer.handle,
      toSession: peer.key || '',
      toRootId: targetRoot,
      participantRoots,
      channelType,
      subject,
      text: imgCount > 0 ? `${textWithImagePaths}${imgSuffix}` : textWithImagePaths,
      imageCount: imgCount,
      mode,
      deliveredPhysical: false,
      routedStatus: 'stale_target',
      resolvedAgentId: '',
      resolvedVia: 'rejected:stale_target',
      readBy: [],
      at: Date.now(),
    })
    if (recordMailbox && mailItem) {
      mutateChiefState((state) => {
        const ws = ensureWorkspace(state, auditRootId || directory.rootId)
        ws.mailbox.push(mailItem)
        if (ws.mailbox.length > MAIL_CAP) ws.mailbox = ws.mailbox.slice(-MAIL_CAP)
      })
    }
    if (recordBoardLog && auditRootId) {
      deps.appendBoardLog(auditRootId, `⚠️ 未送达 ${fromLabel} → ${peer.handle}（${clamp(errorNote, 110)}）：${clamp(text, 48)}${imgSuffix}`, fromLabel)
    }
    if (auditRootId) {
      try {
        appendChiefAuditLog(auditRootId, {
          stage: 'mail_routing',
          decision: 'blocked',
          operation: 'mail.send',
          target: peer.handle,
          reason: `kind=stale expected=none@${targetRoot || 'none'} resolved=none via=rejected:stale_target err=${errorNote}`,
          outcome: 'stale_target',
          by: clamp(fromLabel || 'agent', 40),
        })
      } catch {}
    }
    return {
      ok: false,
      error: errorNote,
      deliveryError: errorNote,
      mail: mailItem,
      target: peer.handle,
      targetId: '',
      deliveredPhysical: false,
      deliveryMode: 'unrouted',
      routedStatus: 'stale_target',
      resolvedAgentId: '',
      resolvedVia: 'rejected:stale_target',
      targetKind: peer.kind || '',
      targetRootId: targetRoot,
      crossSession: Boolean(senderRoot && targetRoot && senderRoot !== targetRoot),
      savedImagePaths: safePaths,
    }
  }

  if (mode !== 'silent') {
    // Path A: Subagent delivery via DSH native subagents service
    if (peer.kind === 'subagent' && subagentsSvc) {
      const caller = (agentsSvc && peer.rootId && agentsSvc.get(peer.rootId)) || deps.findLiveCallerAgent(runtime, peer.rootId, null)
      if (caller) {
        try {
          let targetChildId = (peer.id && peer.id !== peer.rootId && (!fromSession || peer.id !== fromSession))
            ? String(peer.id).trim()
            : ''
          if (!targetChildId && typeof subagentsSvc.resolveName === 'function') {
            const candId = await subagentsSvc.resolveName(caller, peer.name, AbortSignal.timeout(5000))
            const cleanCand = candId ? String(candId).trim() : ''
            if (cleanCand && cleanCand !== peer.rootId && cleanCand !== caller.id && (!fromSession || cleanCand !== fromSession)) {
              targetChildId = cleanCand
            }
          }
          if (targetChildId) {
            await subagentsSvc.sendMessage(caller, targetChildId, [...safeBlocks, { type: 'text', text: formatted }], {
              signal: AbortSignal.timeout(10_000),
            })
            deliveredPhysical = true
            deliveryMode = 'subagent-send'
            routedStatus = 'delivered'
            resolvedAgentId = targetChildId
            resolvedVia = 'subagents.sendMessage'
          } else {
            errorNote = `原生 subagents 服务未解析到 "${peer.name}" 的有效子代理实例`
            resolvedVia = 'subagents.resolveName:empty'
          }
        } catch (err) {
          errorNote = String(err && err.message ? err.message : err)
          resolvedVia = 'subagents.sendMessage:error'
          hadHardError = true
        }
      }
    }

    // Path B: Direct Agent handle delivery (strictly verified against self-bounce & root mismatch)
    if (!deliveredPhysical && peer.id) {
      if (peer.kind === 'subagent' && (peer.id === peer.rootId || (fromSession && peer.id === fromSession))) {
        pathBBlocked = true
        deliveryMode = 'unrouted'
        routedStatus = 'unrouted'
        resolvedAgentId = String(peer.id)
        resolvedVia = 'blocked:subagent_id_matches_root_or_sender'
        errorNote = '子代理目标 ID 指向根会话或发件人自身，已阻止 Path B 自回旋误投'
        hadHardError = true
      } else if (peer.kind === 'peer-session' && fromSession && peer.id === fromSession) {
        pathBBlocked = true
        deliveryMode = 'unrouted'
        routedStatus = 'unrouted'
        resolvedAgentId = String(peer.id)
        resolvedVia = 'blocked:self_peer_session'
        errorNote = '目标联动会话与发件人相同，已阻止自回旋投递'
        hadHardError = true
      }

      let targetAgent = null
      let lookupSource = ''
      if (!pathBBlocked) {
        targetAgent = agentsSvc && typeof agentsSvc.get === 'function' ? agentsSvc.get(peer.id) : null
        if (targetAgent) lookupSource = 'agents.get'
        const controller = runtime && typeof runtime.get === 'function' ? runtime.get('sessionController') : null
        if (!targetAgent && controller && typeof controller.resolveAgent === 'function') {
          try {
            const resolved = await controller.resolveAgent(peer.id)
            if (resolved && resolved.agent) {
              targetAgent = resolved.agent
              lookupSource = 'sessionController.resolveAgent'
            } else if (resolved && resolved.error) {
              resolveErrorCode = String(resolved.error.code || '')
              resolveError = String(resolved.error.message || resolved.error)
              errorNote = formatDeliveryFailureHint(resolveErrorCode, resolveError)
              if (resolveErrorCode !== 'session/not-found') hadHardError = true
            }
          } catch (err) {
            resolveErrorCode = String((err && err.code) || '')
            resolveError = String((err && err.message) || err)
            errorNote = formatDeliveryFailureHint(resolveErrorCode, resolveError)
            if (resolveErrorCode !== 'session/not-found') hadHardError = true
          }
        } else if (!targetAgent && !errorNote && !agentsSvc && !controller) {
          errorNote = '宿主 agents 与 sessionController 服务均未就绪'
        }
      }

      if (targetAgent) {
        const actualId = String((targetAgent && targetAgent.id) || '').trim()
        const actualRootId = actualId && typeof deps.resolveRootSessionId === 'function'
          ? String(deps.resolveRootSessionId(actualId, targetAgent) || '').trim()
          : ''
        const bindingViolation = !actualId
          || actualId !== peer.id
          || Boolean(peer.rootId && actualRootId && actualRootId !== peer.rootId)
          || (peer.kind === 'subagent' && (actualId === peer.rootId || (Boolean(fromSession) && actualId === fromSession)))
          || (peer.kind === 'peer-session' && Boolean(fromSession) && actualId === fromSession)
        if (bindingViolation) {
          targetAgent = null
          pathBBlocked = true
          deliveryMode = 'unrouted'
          routedStatus = 'unrouted'
          resolvedAgentId = actualId
          resolvedVia = `blocked:binding_mismatch(${lookupSource || 'unknown'})`
          errorNote = `目标解析绑定校验未通过（expected=${peer.id}@${peer.rootId || 'none'}, actual=${actualId || 'none'}@${actualRootId || 'none'}），已阻止误投并记为 unrouted`
          hadHardError = true
        }
      }

      if (targetAgent) {
        const actualId = String(targetAgent.id || peer.id).trim()
        const envelopeSourceKind = envelopeKind === 'execution_request'
          ? CHIEF_EXEC_REQ_SOURCE
          : (envelopeKind === 'inquiry' ? CHIEF_INQUIRY_SOURCE : CHIEF_RELAY_SOURCE)
        const envelope = await buildMessageEnvelope(formatted, envelopeSourceKind, {
          senderName: fromLabel,
          ...(fromSession ? { senderSessionId: String(fromSession) } : {}),
          role: envelopeKind === 'execution_request'
            ? 'execution_request'
            : (envelopeKind === 'inquiry' ? 'inquiry' : (mode === 'steer' ? 'steer' : 'relay')),
          ...(taskId ? { taskId } : {}),
        }, safeBlocks)
        try {
          if (mode === 'steer' && targetAgent.status === 'running' && typeof targetAgent.steer === 'function') {
            const r = targetAgent.steer(envelope)
            if (r && typeof r.then === 'function') await r
            deliveredPhysical = true
            deliveryMode = 'agent-steer'
            routedStatus = 'delivered'
            resolvedAgentId = actualId
            resolvedVia = `${lookupSource}:agent-steer`
            errorNote = ''
            hadHardError = false
          } else if (targetAgent.status !== 'running' && typeof targetAgent.followup === 'function') {
            const r = targetAgent.followup(envelope)
            if (r && typeof r.then === 'function') await r
            deliveredPhysical = true
            deliveryMode = 'agent-followup'
            routedStatus = 'delivered'
            resolvedAgentId = actualId
            resolvedVia = `${lookupSource}:agent-followup`
            errorNote = ''
            hadHardError = false
          } else if (typeof targetAgent.inject === 'function') {
            const r = targetAgent.inject(envelope)
            if (r && typeof r.then === 'function') await r
            deliveredPhysical = true
            deliveryMode = 'agent-inject'
            routedStatus = 'delivered'
            resolvedAgentId = actualId
            resolvedVia = `${lookupSource}:agent-inject`
            errorNote = ''
            hadHardError = false
          } else if (typeof targetAgent.steer === 'function') {
            targetAgent.steer(safeBlocks.length ? formatted + imgSuffix : formatted)
            deliveredPhysical = true
            deliveryMode = 'agent-steer-text'
            routedStatus = 'delivered'
            resolvedAgentId = actualId
            resolvedVia = `${lookupSource}:agent-steer-text`
            errorNote = ''
            hadHardError = false
          }
        } catch (err) {
          errorNote = String(err && err.message ? err.message : err)
          resolvedVia = `${lookupSource || 'pathB'}:error`
          hadHardError = true
        }
      }
    }
  } else {
    routedStatus = 'queued'
    deliveryMode = 'mailbox-queued'
    resolvedVia = 'silent-mailbox'
  }

  if (!deliveredPhysical && mode !== 'silent') {
    if (pathBBlocked || routedStatus === 'unrouted' || peer.kind === 'subagent') {
      routedStatus = 'unrouted'
      deliveryMode = 'unrouted'
      if (!resolvedVia) resolvedVia = 'unrouted:no_live_subagent'
      if (!errorNote) errorNote = `目标 "${peer.handle}" 无可用运行实例，消息未投递（已记为 unrouted）`
    } else {
      routedStatus = 'queued'
      deliveryMode = 'mailbox-queued'
      if (!resolvedVia) resolvedVia = 'mailbox-queued'
    }
  }

  const isHardDeliveryFailure = !deliveredPhysical && mode !== 'silent' && (routedStatus === 'unrouted' || (hadHardError && Boolean(errorNote) && resolveErrorCode !== 'session/not-found'))

  // Strict readBy invariant: NEVER mark recipient readBy unless physical delivery to a verified agent succeeded!
  const recipientMarks = (deliveredPhysical && resolvedAgentId)
    ? [...new Set([resolvedAgentId, peer.id, peer.key, peer.name].filter(Boolean))]
    : []

  const mailItem = normalizeMail({
    id: nextId('mail'),
    from: fromLabel,
    fromSession,
    fromRootId: senderRoot,
    to: peer.handle,
    toSession: peer.id || peer.key,
    toRootId: targetRoot,
    participantRoots,
    channelType,
    subject,
    text: imgCount > 0 ? `${textWithImagePaths}${imgSuffix}` : textWithImagePaths,
    imageCount: imgCount,
    mode,
    deliveredPhysical,
    routedStatus,
    resolvedAgentId,
    resolvedVia,
    readBy: recipientMarks,
    at: Date.now(),
  })

  if (recordMailbox && mailItem) {
    mutateChiefState((state) => {
      const ws = ensureWorkspace(state, auditRootId || directory.rootId)
      ws.mailbox.push(mailItem)
      if (ws.mailbox.length > MAIL_CAP) ws.mailbox = ws.mailbox.slice(-MAIL_CAP)
    })
  }

  if (recordBoardLog && auditRootId) {
    const badge = mode === 'steer' ? '⚡ 插话' : mode === 'silent' ? '📌 备忘纸条' : '📨 递话'
    const logMsg = isHardDeliveryFailure
      ? `⚠️ 未送达 ${fromLabel} → ${peer.handle}（${clamp(errorNote, 110)}）：${clamp(text, 48)}${imgSuffix}`
      : `${badge} ${fromLabel} → ${peer.handle}：${clamp(text, 56)}${imgSuffix}`
    deps.appendBoardLog(auditRootId, logMsg, fromLabel)
  }

  if (mode !== 'silent' && auditRootId) {
    try {
      appendChiefAuditLog(auditRootId, {
        stage: 'mail_routing',
        decision: routedStatus === 'unrouted' ? 'blocked' : (routedStatus === 'delivered' ? 'executed' : 'queued'),
        operation: 'mail.send',
        target: peer.handle,
        reason: `kind=${peer.kind} expected=${peer.id || 'none'}@${targetRoot || 'none'} resolved=${resolvedAgentId || 'none'} via=${resolvedVia || deliveryMode}${errorNote ? ' err=' + clamp(errorNote, 90) : ''}`,
        outcome: routedStatus,
        by: clamp(fromLabel || 'agent', 40),
      })
    } catch {}
  }

  const finalOk = routedStatus !== 'unrouted' && routedStatus !== 'stale_target'
  if (channelType === 'pair' && finalOk && senderRoot) {
    try { clearPeerDropState(senderRoot) } catch {}
  }
  return {
    ok: finalOk,
    ...(finalOk ? {} : { error: errorNote || '消息未能路由到已确认的目标运行实例' }),
    mail: mailItem,
    target: peer.handle,
    targetId: peer.id,
    deliveredPhysical,
    deliveryMode,
    routedStatus,
    resolvedAgentId,
    resolvedVia,
    targetKind: peer.kind || '',
    targetRootId: targetRoot,
    crossSession: Boolean(senderRoot && targetRoot && senderRoot !== targetRoot),
    savedImagePaths: safePaths,
    ...(resolveErrorCode ? { resolveErrorCode } : {}),
    ...(resolveError ? { resolveError } : {}),
    ...(isHardDeliveryFailure ? { deliveryError: errorNote } : {}),
    ...(errorNote && !deliveredPhysical
      ? {
          note: isHardDeliveryFailure
            ? `${peer.kind === 'lead' ? '未能送达主对话' : '未能送达目标'}：${errorNote}（未写入 readBy，未触发虚假投递）`
            : `目标暂未在线运行，已存入参谋部协同信箱，将在其下一步自动送达（${errorNote}）`,
        }
      : {}),
  }
}

/* -------------------------------------------------------------------------- */
/* KV-Cache Friendly Pre-Step Delta Note (`agent/pre-step`)                   */
/* -------------------------------------------------------------------------- */

export async function consumePreStepDelta(deps, agent) {
  const sessionId = String(agent && agent.id ? agent.id : '').trim()
  if (!sessionId) return null
  const rootId = deps.resolveRootSessionId(sessionId, agent) || sessionId
  const identity = deps.resolveAgentIdentity(deps.runtime, sessionId, agent)
  const myHandles = new Set(
    [
      sessionId,
      identity && identity.self ? identity.self : '',
      identity && !identity.isChild ? 'lead' : '',
      identity && !identity.isChild ? '主对话' : '',
    ].filter(Boolean).map(s => s.toLowerCase()),
  )

  const deltaLines = []
  let hasPriorityInquiry = false
  mutateChiefState((state) => {
    const view = clusterView(state, rootId)
    const ownWs = ensureWorkspace(state, rootId)

    // 0. Highest priority: DSH Chief Inquiry Channel (answer without interrupting own task!)
    if (Array.isArray(ownWs.inquiries)) {
      const nowInq = Date.now()
      for (const inq of ownWs.inquiries) {
        if (!inq || inq.status !== 'pending') continue
        if (inq.expiresAt && nowInq > inq.expiresAt) {
          inq.status = 'expired'
          continue
        }
        const tLower = String(inq.target || 'lead').toLowerCase()
        const matchesMe = myHandles.has(tLower) || (!identity?.isChild && tLower === 'lead')
        if (!matchesMe) continue
        inq.status = 'delivered'
        inq.deliveredAt = nowInq
        hasPriorityInquiry = true
        deltaLines.push(
          `⚡ [INQUIRY #${inq.inquiryId}${inq.taskId ? ' / ' + inq.taskId : ''} · DSH 参谋长优先问询 · 答复后继续原动作勿中断]`
          + `\n  问题：${inq.question}`
          + (inq.context ? `\n  背景：${inq.context}` : '')
          + `\n  ↳ 请在当前回合顺手调用 chief_board({ action: "inquiry.reply", inquiryId: "${inq.inquiryId}", text: "基于真实代码与状态的准确答复" }) 原路回传，然后立即继续你刚才的工作，切勿打断当前计划！`,
        )
      }
    }

    // 1. Unread mailbox messages addressed to this session/handle (STRICT cluster isolation: ignore detached external peers!)
    for (const mail of view.mailbox) {
      if (mail.detachedFromCluster) continue
      if (mail.routedStatus === 'stale_target' || mail.routedStatus === 'unrouted') continue
      const mailFromRoot = mail.fromRootId || (mail.fromSession && deps.resolveRootSessionId ? deps.resolveRootSessionId(mail.fromSession) : '')
      if (mailFromRoot && !String(mailFromRoot).startsWith('harness:') && mailFromRoot !== rootId && !view.cluster.includes(mailFromRoot)) continue
      const toLower = String(mail.toSession || mail.to || '').trim().toLowerCase()
      const toHandleLower = String(mail.to || '').trim().toLowerCase()
      const shortHandleLower = toHandleLower.split('/').pop()
      const isInstanceSpecific = Boolean(toLower && toLower !== 'all' && toLower !== toHandleLower && toLower !== shortHandleLower)
      const isMine = toLower === 'all'
        || toHandleLower === 'all'
        || myHandles.has(toLower)
        || (!isInstanceSpecific && (myHandles.has(toHandleLower) || myHandles.has(shortHandleLower)))
      if (!isMine) continue
      if (mail.fromSession && mail.fromSession === sessionId) continue
      const alreadyRead = (mail.readBy || []).some(r => myHandles.has(String(r).toLowerCase()))
      if (alreadyRead) continue

      mail.readBy = [...new Set([...(mail.readBy || []), sessionId, ...(identity?.self ? [identity.self] : [])])]
      deltaLines.push(`- 📨 来自 **${mail.from}** 的协同来信${mail.subject ? '（' + mail.subject + '）' : ''}：${mail.text}`)
    }

    // 2. Newly added/updated durable facts since this session last checked
    const lastSeenFact = Number(ownWs.seenFactsAt[sessionId] || 0)
    const now = Date.now()
    if (lastSeenFact === 0) {
      // First step: freeze baseline without injecting noise if already covered, unless facts exist
      ownWs.seenFactsAt[sessionId] = now
      if (view.facts.length > 0) {
        const topFacts = view.facts.slice(-8)
        for (const f of topFacts) {
          deltaLines.push(`- 📌 团队记忆与纪律：${f.text}`)
        }
      }
    } else {
      const freshFacts = view.facts.filter(f => (f.updatedAt || f.addedAt || 0) > lastSeenFact)
      if (freshFacts.length > 0) {
        ownWs.seenFactsAt[sessionId] = Math.max(...freshFacts.map(f => f.updatedAt || f.addedAt || now))
        for (const f of freshFacts.slice(-6)) {
          deltaLines.push(`- 📌 最新记忆变更（${f.by || '参谋长'}）：${f.text}`)
        }
      }
    }
  })

  if (deltaLines.length === 0) return null

  const text = [
    '## DSH 参谋长 · 跨对话协同与记忆增量',
    '以下是自你上一轮以来收到的跨对话来信或最新团队纪律变更（仅作上下文参考与协同配合）：',
    '',
    ...deltaLines,
  ].join('\n')

  return buildMessageEnvelope(
    text,
    hasPriorityInquiry ? CHIEF_INQUIRY_SOURCE : CHIEF_UPDATE_SOURCE,
    { form: hasPriorityInquiry ? 'priority_inquiry' : 'snapshot' },
  )
}

/* -------------------------------------------------------------------------- */
/* Concise Structured Bullet Summary ("摘要" · 宰相简报)                       */
/* -------------------------------------------------------------------------- */

export function readMailboxForAgent(deps, { sessionId, callerAgent, unreadOnly = false }) {
  const sid = String(sessionId || (callerAgent && callerAgent.id) || '').trim()
  const rootId = deps.resolveRootSessionId(sid, callerAgent) || sid || 'global'
  const identity = deps.resolveAgentIdentity(deps.runtime, sid, callerAgent)
  const myHandles = new Set(
    [
      sid,
      identity && identity.self ? identity.self : '',
      identity && !identity.isChild ? 'lead' : '',
    ].filter(Boolean).map(v => v.toLowerCase()),
  )

  const out = []
  mutateChiefState((state) => {
    const view = clusterView(state, rootId)
    for (const m of view.mailbox) {
      const toLower = String(m.toSession || m.to || '').trim().toLowerCase()
      const toHandleLower = String(m.to || '').trim().toLowerCase()
      const shortHandleLower = toHandleLower.split('/').pop()
      const isInstanceSpecific = Boolean(toLower && toLower !== 'all' && toLower !== toHandleLower && toLower !== shortHandleLower)
      const relevant = !sid
        || toLower === 'all'
        || toHandleLower === 'all'
        || myHandles.has(toLower)
        || (!isInstanceSpecific && (myHandles.has(toHandleLower) || myHandles.has(shortHandleLower)))
        || m.fromSession === sid
      if (!relevant) continue
      const isRead = (m.readBy || []).some(r => myHandles.has(String(r).toLowerCase()))
      if (unreadOnly && isRead) continue
      if (!isRead && sid && m.fromSession !== sid) {
        m.readBy = [...new Set([...(m.readBy || []), sid, ...(identity?.self ? [identity.self] : [])])]
      }
      out.push({ ...m, unread: !isRead })
    }
  })
  return out.slice(-25)
}
import {
  registerPeerDirectoryReader,
  detectLocalHarnessBinaries,
  discoverHarnessProviders,
  refreshBubbleDiscovery,
  computeBubbleState,
  resolveExternalHarnessTarget,
  dispatchBubbleHarness,
} from './network-harness.js'

registerPeerDirectoryReader(listPeerDirectory)

export {
  detectLocalHarnessBinaries,
  discoverHarnessProviders,
  refreshBubbleDiscovery,
  computeBubbleState,
  resolveExternalHarnessTarget,
  dispatchBubbleHarness,
}
