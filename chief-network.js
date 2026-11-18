/**
 * chief-network.js
 *
 * Cross-session messaging, subagent relay, peer directory, and pre-step delta delivery for DSH Chief.
 */

import path from 'node:path'
import {
  MAIL_CAP,
  CHIEF_UPDATE_SOURCE,
  CHIEF_RELAY_SOURCE,
  persistChiefImagesToWorkspace,
  admitChiefImages,
  nextId,
  clamp,
  cleanMultiline,
  normalizeMail,
  loadChiefState,
  mutateChiefState,
  getLinkedCluster,
  ensureWorkspace,
  clusterView,
  stripCheckpointNoise,
  isInternalCheckpointNoise,
} from './chief-state.js'
import { loadDshLlm } from './chief-models.js'

export async function buildMessageEnvelope(text, sourceKind = CHIEF_RELAY_SOURCE, extraSource = {}, imageBlocks = []) {
  const dshLlm = await loadDshLlm()
  const safeImages = Array.isArray(imageBlocks) ? imageBlocks : []
  const content = [...safeImages, ...(text ? [{ type: 'text', text }] : [])]
  if (!content.length) content.push({ type: 'text', text: '' })
  const source = { kind: sourceKind, ...extraSource }
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

export function collectClusterPeerProgress(deps, cluster = [], selfRootId = '') {
  const self = String(selfRootId || '').trim()
  const members = Array.isArray(cluster) ? cluster.filter(sid => sid && sid !== self) : []
  if (!members.length) return []
  const runtime = deps && deps.runtime
  const agentsSvc = runtime ? runtime.get('agents') : null
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
    out.push({
      rootId: sid,
      name,
      status: rootAgent && rootAgent.status === 'running' ? 'running' : 'idle',
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
      progressSummary: summarizeBoardProgress(board),
    })
  }
  return out
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
  const seenIds = new Set()

  for (const memberRootId of cluster) {
    const isCurrentRoot = memberRootId === rootId
    const board = deps.boardForSession(deps.boardFileFor(memberRootId))
    const roster = await deps.refreshSubagentTree(runtime, memberRootId, board)
    const rootAgent = agentsSvc && typeof agentsSvc.get === 'function' ? agentsSvc.get(memberRootId) : null
    const rootTitle = deps.sessionName(runtime, rootAgent || memberRootId) || ('会话 ' + memberRootId.replace(/^session-/, '').slice(0, 8))
    const memberProgressSummary = summarizeBoardProgress(board)

    for (const entry of roster) {
      if (!entry) continue
      const isLead = entry.name === 'lead'
      const key = isCurrentRoot
        ? (isLead ? 'lead' : entry.name)
        : (isLead ? memberRootId : `${memberRootId}:${entry.name}`)
      if (seenIds.has(key)) continue
      seenIds.add(key)
      targets.push({
        key,
        id: entry.id || (isLead ? memberRootId : ''),
        rootId: memberRootId,
        name: isLead ? (isCurrentRoot ? '主对话' : rootTitle) : entry.name,
        handle: isCurrentRoot ? (isLead ? 'lead' : entry.name) : (isLead ? rootTitle : `${rootTitle}/${entry.name}`),
        kind: isLead ? (isCurrentRoot ? 'lead' : 'peer-session') : 'subagent',
        isCurrentRoot,
        status: entry.status === 'running' ? 'running' : 'idle',
        taskTitle: entry.taskTitle || entry.description || (board && board.objective ? clamp(board.objective, 48) : ''),
        ...(isLead ? { progressSummary: memberProgressSummary, objective: clamp(board && board.objective ? board.objective : '', 80) } : {}),
        parentId: entry.parentId || memberRootId,
        mode: entry.mode || 'continuable',
      })
    }
  }

  // Other top-level standalone sessions on this machine that can be linked into the federation
  const otherSessions = []
  for (const ag of liveAgents) {
    const sid = String(ag && ag.id ? ag.id : '')
    if (!sid || archived.has(sid)) continue
    const agRoot = deps.resolveRootSessionId(sid, ag) || sid
    if (agRoot !== sid) continue // skip child subagent sessions here
    if (agRoot === rootId) continue
    const isLinked = cluster.includes(agRoot)
    const b = deps.loadBoard(deps.boardFileFor(agRoot))
    otherSessions.push({
      id: agRoot,
      name: deps.sessionName(runtime, ag) || ('会话 ' + agRoot.replace(/^session-/, '').slice(0, 8)),
      status: ag.status === 'running' ? 'running' : 'idle',
      linked: isLinked,
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
  const q = String(rawTarget || '').trim().replace(/^@/, '')
  if (!q) return null
  const lower = q.toLowerCase()
  if (lower === 'lead' || lower === 'main' || lower === '主对话' || lower === '主代理') {
    return targets.find(t => t.kind === 'lead' && t.isCurrentRoot) || targets[0] || null
  }
  // Exact match by key, id, name, or handle
  for (const t of targets) {
    if (
      t.key.toLowerCase() === lower
      || (t.id && t.id.toLowerCase() === lower)
      || t.name.toLowerCase() === lower
      || t.handle.toLowerCase() === lower
      || t.name.split('/').pop().toLowerCase() === lower
    ) {
      return t
    }
  }
  // Partial substring match
  return targets.find(t =>
    t.name.toLowerCase().includes(lower) || t.handle.toLowerCase().includes(lower),
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
  const directory = await listPeerDirectory(deps, rootId || fromSession)
  const senderRootId = rootId || directory.rootId || ''
  const rawTarget = String(target || 'lead').trim().replace(/^@/, '')

  // Broadcast support: 'all' / '全体' / 'team' (deduplicated single mailbox record for clean drawer UI)
  if (['all', 'team', '全体', '所有人'].includes(rawTarget.toLowerCase())) {
    const recipients = directory.targets.filter(t => t.id !== fromSession)
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
      if (hit && !seenKeys.has(hit.key)) {
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
  if (!peer) {
    return {
      ok: false,
      error: `未找到目标对话 "${rawTarget}"。当前可用目标：${directory.targets.map(t => t.handle).join('、') || '无'}`,
    }
  }

  return deliverSinglePeer(deps, directory, peer, {
    fromSession,
    fromRootId: senderRootId,
    fromLabel,
    text: effectiveText,
    subject,
    mode,
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
  const headerTag = mode === 'steer'
    ? `[DSH 参谋长插话 · 来自 ${fromLabel}]`
    : `[DSH 参谋长递话 · 来自 ${fromLabel}]`
  const formatted = `${headerTag}${subject ? ' ' + subject : ''}\n${textWithImagePaths}\n\n（如需回信或同步进展，可调用参谋看板 chief_board({ action: "mail.send", target: "${fromLabel === 'DSH 参谋长' ? 'lead' : fromLabel}", text: "…" })）`

  let deliveredPhysical = false
  let deliveryMode = 'mailbox-queued'
  let errorNote = ''

  if (mode !== 'silent') {
    // Path A: Subagent delivery via DSH native subagents service
    if (peer.kind === 'subagent' && subagentsSvc) {
      const caller = (agentsSvc && peer.rootId && agentsSvc.get(peer.rootId)) || deps.findLiveCallerAgent(runtime, peer.rootId, null)
      if (caller) {
        try {
          let targetChildId = peer.id
          if (!targetChildId && typeof subagentsSvc.resolveName === 'function') {
            targetChildId = await subagentsSvc.resolveName(caller, peer.name, AbortSignal.timeout(5000))
          }
          if (targetChildId) {
            await subagentsSvc.sendMessage(caller, targetChildId, [...safeBlocks, { type: 'text', text: formatted }], {
              signal: AbortSignal.timeout(10_000),
            })
            deliveredPhysical = true
            deliveryMode = 'subagent-send'
          }
        } catch (err) {
          errorNote = String(err && err.message ? err.message : err)
        }
      }
    }

    // Path B: Direct Agent handle delivery (for root lead, peer standalone sessions, or fallback live child agent)
    if (!deliveredPhysical && agentsSvc && peer.id) {
      let targetAgent = typeof agentsSvc.get === 'function' ? agentsSvc.get(peer.id) : null
      if (!targetAgent && runtime) {
        try {
          const controller = runtime.get('sessionController')
          if (controller && typeof controller.resolveAgent === 'function') {
            const resolved = await controller.resolveAgent(peer.id)
            if (resolved && resolved.agent) targetAgent = resolved.agent
          }
        } catch {}
      }
      if (targetAgent) {
        const envelope = await buildMessageEnvelope(formatted, CHIEF_RELAY_SOURCE, {
          senderName: fromLabel,
          senderSessionId: fromSession || undefined,
          role: mode === 'steer' ? 'steer' : 'relay',
        }, safeBlocks)
        try {
          if (mode === 'steer' && targetAgent.status === 'running' && typeof targetAgent.steer === 'function') {
            const r = targetAgent.steer(envelope)
            if (r && typeof r.then === 'function') await r
            deliveredPhysical = true
            deliveryMode = 'agent-steer'
          } else if (targetAgent.status !== 'running' && typeof targetAgent.followup === 'function') {
            const r = targetAgent.followup(envelope)
            if (r && typeof r.then === 'function') await r
            deliveredPhysical = true
            deliveryMode = 'agent-followup'
          } else if (typeof targetAgent.inject === 'function') {
            const r = targetAgent.inject(envelope)
            if (r && typeof r.then === 'function') await r
            deliveredPhysical = true
            deliveryMode = 'agent-inject'
          } else if (typeof targetAgent.steer === 'function') {
            targetAgent.steer(safeBlocks.length ? formatted + imgSuffix : formatted)
            deliveredPhysical = true
            deliveryMode = 'agent-steer-text'
          }
        } catch (err) {
          errorNote = String(err && err.message ? err.message : err)
        }
      }
    }
  }

  // Always record in the shared cluster mailbox; if physical delivery already carried it,
  // mark the recipient in readBy so `agent/pre-step` will NOT double-deliver it!
  const recipientMarks = deliveredPhysical
    ? [peer.id, peer.key, peer.name].filter(Boolean)
    : []

  const senderRoot = String(fromRootId || (fromSession && deps.resolveRootSessionId && deps.resolveRootSessionId(fromSession)) || directory.rootId || '').trim()
  const targetRoot = String(peer.rootId || directory.rootId || '').trim()
  const participantRoots = [...new Set([senderRoot, targetRoot].filter(Boolean))].sort()
  const channelType = participantRoots.length >= 2 ? 'pair' : 'internal'

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
    readBy: recipientMarks,
    at: Date.now(),
  })

  if (recordMailbox && mailItem) {
    mutateChiefState((state) => {
      const ws = ensureWorkspace(state, peer.rootId || directory.rootId)
      ws.mailbox.push(mailItem)
      if (ws.mailbox.length > MAIL_CAP) ws.mailbox = ws.mailbox.slice(-MAIL_CAP)
    })
  }

  if (recordBoardLog && (peer.rootId || directory.rootId)) {
    const badge = mode === 'steer' ? '⚡ 插话' : mode === 'silent' ? '📌 备忘纸条' : '📨 递话'
    deps.appendBoardLog(
      peer.rootId || directory.rootId,
      `${badge} ${fromLabel} → ${peer.handle}：${clamp(text, 56)}${imgSuffix}`,
      fromLabel,
    )
  }

  return {
    ok: true,
    mail: mailItem,
    target: peer.handle,
    targetId: peer.id,
    deliveredPhysical,
    deliveryMode,
    savedImagePaths: safePaths,
    ...(errorNote && !deliveredPhysical ? { note: '目标暂未在线运行，已存入参谋部协同信箱，将在其下一步自动送达（' + errorNote + '）' } : {}),
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
  mutateChiefState((state) => {
    const view = clusterView(state, rootId)
    const ownWs = ensureWorkspace(state, rootId)

    // 1. Unread mailbox messages addressed to this session/handle (STRICT cluster isolation: ignore detached external peers!)
    for (const mail of view.mailbox) {
      if (mail.detachedFromCluster) continue
      const mailFromRoot = mail.fromRootId || (mail.fromSession && deps.resolveRootSessionId ? deps.resolveRootSessionId(mail.fromSession) : '')
      if (mailFromRoot && mailFromRoot !== rootId && !view.cluster.includes(mailFromRoot)) continue
      const toLower = String(mail.toSession || mail.to || '').toLowerCase()
      const toHandleLower = String(mail.to || '').toLowerCase()
      const isMine = toLower === 'all'
        || toHandleLower === 'all'
        || myHandles.has(toLower)
        || myHandles.has(toHandleLower)
        || myHandles.has(toHandleLower.split('/').pop())
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

  return buildMessageEnvelope(text, CHIEF_UPDATE_SOURCE, { form: 'snapshot' })
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
      const toLower = String(m.toSession || m.to || '').toLowerCase()
      const toHandleLower = String(m.to || '').toLowerCase()
      const relevant = !sid
        || toLower === 'all'
        || toHandleLower === 'all'
        || myHandles.has(toLower)
        || myHandles.has(toHandleLower)
        || myHandles.has(toHandleLower.split('/').pop())
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
