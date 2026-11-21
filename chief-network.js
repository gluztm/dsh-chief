/**
 * chief-network.js
 *
 * Cross-session messaging, subagent relay, peer directory, and pre-step delta delivery for DSH Chief.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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
  getLinkedCluster,
  ensureWorkspace,
  resolveWorkspaceConfig,
  OFFICIAL_HARNESS_CATALOG,
  setBubbleHarnessMembership,
  clusterView,
  stripCheckpointNoise,
  isInternalCheckpointNoise,
} from './chief-state.js'
import { loadDshLlm } from './chief-models.js'
import { listGuardWalls } from './chief-executor.js'

let chiefDirectRequestHook = null

export function registerChiefDirectRequestHook(fn) {
  chiefDirectRequestHook = typeof fn === 'function' ? fn : null
}

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
    const targetChoices = [...directory.targets.map(t => t.handle), ...new Set(availHarnesses)].filter(Boolean)
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
        const envelopeSourceKind = envelopeKind === 'execution_request'
          ? CHIEF_EXEC_REQ_SOURCE
          : (envelopeKind === 'inquiry' ? CHIEF_INQUIRY_SOURCE : CHIEF_RELAY_SOURCE)
        const envelope = await buildMessageEnvelope(formatted, envelopeSourceKind, {
          senderName: fromLabel,
          senderSessionId: fromSession || undefined,
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

const PROBE_EXTERNAL_PROVIDER_NAMES = [
  'codex',
  'claude-code',
  'acp',
  'dsh-sdk',
  'opencode',
  'antigravity',
  'gemini',
]

let localHarnessCache = { at: 0, envSig: '', map: new Map() }

function isRegularFileSafe(p) {
  if (!p) return false
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

function platformBinCandidates(baseName) {
  return process.platform === 'win32'
    ? [`${baseName}.exe`, `${baseName}.cmd`, `${baseName}.bat`, baseName]
    : [baseName]
}

function findInSystemPath(candidates = []) {
  const rawPath = String(process.env.PATH || '')
  if (!rawPath) return ''
  for (const dir of rawPath.split(path.delimiter)) {
    const cleanDir = dir.trim().replace(/^"+|"+$/g, '')
    if (!cleanDir) continue
    for (const fileName of candidates) {
      const full = path.join(cleanDir, fileName)
      if (isRegularFileSafe(full)) return full
    }
  }
  return ''
}

function resolveCodexFromAppAlias(aliasPath) {
  try {
    const target = fs.readlinkSync(aliasPath)
    if (!target) return ''
    if (path.basename(target).toLowerCase() === 'codex.exe' && isRegularFileSafe(target)) return target
    const dir = path.dirname(target)
    for (const cand of [
      path.join(dir, 'codex.exe'),
      path.join(dir, 'resources', 'codex.exe'),
      path.join(path.dirname(dir), 'resources', 'codex.exe'),
    ]) {
      if (isRegularFileSafe(cand)) return cand
    }
  } catch {}
  return ''
}

function posixFallbackPaths(baseName) {
  const home = os.homedir()
  return [
    `/opt/homebrew/bin/${baseName}`,
    `/usr/local/bin/${baseName}`,
    path.join(home, '.local', 'bin', baseName),
    path.join(home, '.npm-global', 'bin', baseName),
    path.join(home, '.volta', 'bin', baseName),
    path.join(home, '.bun', 'bin', baseName),
    path.join(home, '.asdf', 'shims', baseName),
  ]
}

function probeLocalCodexBinary() {
  const envBin = String(process.env.DSH_CHIEF_CODEX_BIN || '').trim()
  if (envBin && isRegularFileSafe(envBin)) return envBin

  const fromPath = findInSystemPath(platformBinCandidates('codex'))
  if (fromPath) return fromPath

  if (process.platform === 'win32') {
    const localApp = String(process.env.LOCALAPPDATA || '')
    if (localApp) {
      const aliasRoot = path.join(localApp, 'Microsoft', 'WindowsApps')
      try {
        const entries = fs.readdirSync(aliasRoot, { withFileTypes: true })
        for (const ent of entries) {
          if (ent.isDirectory() && /^OpenAI\.Codex_/i.test(ent.name)) {
            const pkgAliasDir = path.join(aliasRoot, ent.name)
            try {
              for (const sub of fs.readdirSync(pkgAliasDir, { withFileTypes: true })) {
                if (!sub.name.toLowerCase().endsWith('.exe')) continue
                const hit = resolveCodexFromAppAlias(path.join(pkgAliasDir, sub.name))
                if (hit) return hit
              }
            } catch {}
          } else if (/^codex.*\.exe$/i.test(ent.name)) {
            const hit = resolveCodexFromAppAlias(path.join(aliasRoot, ent.name))
            if (hit) return hit
          }
        }
      } catch {}
    }

    // Direct Windows Store MSIX fallback when WindowsApps is readable
    const winAppsDir = process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'WindowsApps') : 'C:\\Program Files\\WindowsApps'
    try {
      const dirs = fs.readdirSync(winAppsDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && /^OpenAI\.Codex_/i.test(d.name))
        .map(d => d.name)
        .sort()
        .reverse()
      for (const dirName of dirs) {
        for (const rel of ['app\\resources\\codex.exe', 'resources\\codex.exe', 'app\\codex.exe']) {
          const cand = path.join(winAppsDir, dirName, rel)
          if (isRegularFileSafe(cand)) return cand
        }
      }
    } catch {}

    const appData = String(process.env.APPDATA || '')
    const home = os.homedir()
    for (const cand of [
      appData ? path.join(appData, 'npm', 'codex.cmd') : '',
      localApp ? path.join(localApp, 'pnpm', 'codex.cmd') : '',
      path.join(home, 'scoop', 'shims', 'codex.exe'),
      path.join(home, 'scoop', 'shims', 'codex.cmd'),
      path.join(home, '.local', 'bin', 'codex.exe'),
      path.join(home, '.local', 'bin', 'codex'),
    ]) {
      if (isRegularFileSafe(cand)) return cand
    }
    return ''
  }

  for (const cand of posixFallbackPaths('codex')) {
    if (isRegularFileSafe(cand)) return cand
  }
  return ''
}

function findVersionedClaudeExe(baseDir, nestedHashDir = false) {
  if (!baseDir) return ''
  try {
    const vers = fs.readdirSync(baseDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort()
      .reverse()
    for (const ver of vers) {
      const verDir = path.join(baseDir, ver)
      if (!nestedHashDir) {
        const direct = path.join(verDir, 'claude.exe')
        if (isRegularFileSafe(direct)) return direct
      } else {
        try {
          const subDirs = fs.readdirSync(verDir, { withFileTypes: true }).filter(d => d.isDirectory())
          for (const sub of subDirs) {
            const nested = path.join(verDir, sub.name, 'claude.exe')
            if (isRegularFileSafe(nested)) return nested
          }
        } catch {}
      }
    }
  } catch {}
  return ''
}

function probeLocalClaudeBinary() {
  const envBin = String(process.env.DSH_CHIEF_CLAUDE_BIN || '').trim()
  if (envBin && isRegularFileSafe(envBin)) return envBin

  const fromPath = findInSystemPath(platformBinCandidates('claude'))
  if (fromPath) return fromPath

  if (process.platform === 'win32') {
    const localApp = String(process.env.LOCALAPPDATA || '')
    const appData = String(process.env.APPDATA || '')
    if (localApp) {
      const claude3p = findVersionedClaudeExe(path.join(localApp, 'Claude-3p', 'claude-code'), true)
        || findVersionedClaudeExe(path.join(localApp, 'Claude-3p', 'claude-code'), false)
      if (claude3p) return claude3p

      try {
        const pkgsDir = path.join(localApp, 'Packages')
        const claudePkgs = fs.readdirSync(pkgsDir, { withFileTypes: true })
          .filter(d => d.isDirectory() && /^AnthropicPBC\.Claude_/i.test(d.name))
        for (const pkg of claudePkgs) {
          const base = path.join(pkgsDir, pkg.name, 'LocalCache', 'Roaming', 'Claude', 'claude-code')
          const hit = findVersionedClaudeExe(base, true) || findVersionedClaudeExe(base, false)
          if (hit) return hit
        }
      } catch {}
    }
    if (appData) {
      const roamingHit = findVersionedClaudeExe(path.join(appData, 'Claude', 'claude-code'), true)
        || findVersionedClaudeExe(path.join(appData, 'Claude', 'claude-code'), false)
      if (roamingHit) return roamingHit
    }

    const home = os.homedir()
    for (const cand of [
      path.join(home, '.local', 'bin', 'claude.exe'),
      path.join(home, '.local', 'bin', 'claude'),
      appData ? path.join(appData, 'npm', 'claude.cmd') : '',
      localApp ? path.join(localApp, 'pnpm', 'claude.cmd') : '',
      path.join(home, 'scoop', 'shims', 'claude.exe'),
      path.join(home, 'scoop', 'shims', 'claude.cmd'),
    ]) {
      if (isRegularFileSafe(cand)) return cand
    }
    return ''
  }

  for (const cand of posixFallbackPaths('claude')) {
    if (isRegularFileSafe(cand)) return cand
  }
  return ''
}

function isDirSafe(p) {
  if (!p) return false
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

function probeLocalCodexConfig() {
  const customHome = String(process.env.CODEX_HOME || '').trim()
  const candidates = [
    customHome ? { dir: customHome, label: 'CODEX_HOME' } : null,
    { dir: path.join(os.homedir(), '.codex'), label: '~/.codex' },
  ].filter(Boolean)
  for (const item of candidates) {
    if (isRegularFileSafe(path.join(item.dir, 'config.toml')) || isRegularFileSafe(path.join(item.dir, 'auth.json')) || isDirSafe(item.dir)) {
      return { configured: true, configLabel: item.label }
    }
  }
  if (String(process.env.OPENAI_API_KEY || '').trim()) {
    return { configured: true, configLabel: 'OPENAI_API_KEY' }
  }
  if (String(process.env.AZURE_OPENAI_API_KEY || '').trim()) {
    return { configured: true, configLabel: 'AZURE_OPENAI' }
  }
  return { configured: false, configLabel: '' }
}

function probeLocalClaudeConfig() {
  const customDir = String(process.env.CLAUDE_CONFIG_DIR || '').trim()
  const home = os.homedir()
  const appData = String(process.env.APPDATA || '')
  const candidates = [
    customDir ? { check: customDir, type: 'dir', label: 'CLAUDE_CONFIG_DIR' } : null,
    { check: path.join(home, '.claude.json'), type: 'file', label: '~/.claude.json' },
    { check: path.join(home, '.claude'), type: 'dir', label: '~/.claude' },
    appData ? { check: path.join(appData, 'Claude', 'claude_desktop_config.json'), type: 'file', label: 'Claude Desktop' } : null,
  ].filter(Boolean)
  for (const item of candidates) {
    const ok = item.type === 'file' ? isRegularFileSafe(item.check) : isDirSafe(item.check)
    if (ok) {
      return { configured: true, configLabel: item.label }
    }
  }
  if (String(process.env.CLAUDE_CODE_OAUTH_TOKEN || '').trim()) {
    return { configured: true, configLabel: 'OAuth Token' }
  }
  if (String(process.env.ANTHROPIC_API_KEY || '').trim()) {
    return { configured: true, configLabel: 'ANTHROPIC_API_KEY' }
  }
  if (String(process.env.ANTHROPIC_AUTH_TOKEN || '').trim()) {
    return { configured: true, configLabel: 'ANTHROPIC_AUTH_TOKEN' }
  }
  if (String(process.env.CLAUDE_CODE_USE_BEDROCK || '').trim()) {
    return { configured: true, configLabel: 'Bedrock' }
  }
  if (String(process.env.CLAUDE_CODE_USE_VERTEX || '').trim()) {
    return { configured: true, configLabel: 'Vertex' }
  }
  return { configured: false, configLabel: '' }
}

/** Pure filesystem detection of local external Harness CLIs (`codex`, `claude-code`) with 60s TTL cache. */
export function detectLocalHarnessBinaries({ force = false } = {}) {
  const now = Date.now()
  const envSig = [
    process.env.DSH_CHIEF_CODEX_BIN || '',
    process.env.DSH_CHIEF_CLAUDE_BIN || '',
    process.env.CODEX_HOME || '',
    process.env.CLAUDE_CONFIG_DIR || '',
    process.env.OPENAI_API_KEY ? '1' : '0',
    process.env.AZURE_OPENAI_API_KEY ? '1' : '0',
    process.env.ANTHROPIC_API_KEY ? '1' : '0',
    process.env.ANTHROPIC_AUTH_TOKEN ? '1' : '0',
    process.env.CLAUDE_CODE_OAUTH_TOKEN ? '1' : '0',
    process.env.CLAUDE_CODE_USE_BEDROCK ? '1' : '0',
    process.env.CLAUDE_CODE_USE_VERTEX ? '1' : '0',
  ].join('|')
  if (!force && envSig === localHarnessCache.envSig && (now - localHarnessCache.at) < 60_000) {
    return localHarnessCache.map
  }
  const found = new Map()
  const codexBin = probeLocalCodexBinary()
  if (codexBin) {
    const codexCfg = probeLocalCodexConfig()
    found.set('codex', {
      provider: 'codex',
      binaryPath: codexBin,
      transport: 'local-cli',
      configured: codexCfg.configured,
      configLabel: codexCfg.configLabel,
    })
  }
  const claudeBin = probeLocalClaudeBinary()
  if (claudeBin) {
    const claudeCfg = probeLocalClaudeConfig()
    found.set('claude-code', {
      provider: 'claude-code',
      binaryPath: claudeBin,
      transport: 'local-cli',
      configured: claudeCfg.configured,
      configLabel: claudeCfg.configLabel,
    })
  }
  localHarnessCache = { at: now, envSig, map: found }
  return found
}

/** Discover registered external Harness backends (`ctx.subagents` + local `ctx.subprocess` direct CLIs). */
export function discoverHarnessProviders(runtime, hostState = null) {
  const sub = runtime && typeof runtime.get === 'function' ? runtime.get('subagents') : null
  const subprocessSvc = (runtime && typeof runtime.get === 'function' ? runtime.get('subprocess') : null)
    || (hostState && hostState.activeSubprocess)
    || null
  const foundMap = new Map()
  const addProv = (pname, prov, transport = 'dsh-subagent', binaryPath = '', meta = {}) => {
    const clean = String(pname || '').trim()
    if (!clean || clean === 'spawn' || clean === 'fork') return
    if (prov && typeof prov.prepareContinuable === 'function') return
    if (!foundMap.has(clean)) {
      foundMap.set(clean, {
        prov: prov || { name: clean },
        transport,
        binaryPath,
        configured: meta.configured !== undefined ? Boolean(meta.configured) : (transport === 'dsh-subagent'),
        configLabel: meta.configLabel || (transport === 'dsh-subagent' ? 'DSH 插件' : ''),
      })
    }
  }

  if (sub && sub.providers instanceof Map) {
    for (const [pname, prov] of sub.providers.entries()) addProv(pname, prov, 'dsh-subagent', '')
  }
  if (sub && typeof sub.getProvider === 'function') {
    for (const candidate of PROBE_EXTERNAL_PROVIDER_NAMES) {
      try {
        const prov = sub.getProvider(candidate)
        if (prov) addProv(prov.name || candidate, prov, 'dsh-subagent', '')
      } catch {}
    }
  }
  if (hostState && hostState.detectedHarnessProviders instanceof Map) {
    for (const [pname, prov] of hostState.detectedHarnessProviders.entries()) addProv(pname, prov, 'dsh-subagent', '')
  }

  // Layer 2: Directly detected local Codex / Claude Code CLIs via host ctx.subprocess
  if (subprocessSvc && typeof subprocessSvc.spawn === 'function') {
    const localBins = detectLocalHarnessBinaries()
    for (const [pname, info] of localBins.entries()) {
      addProv(pname, { name: pname }, 'local-cli', info.binaryPath, {
        configured: info.configured,
        configLabel: info.configLabel,
      })
    }
  }

  const available = []
  for (const [pname, entry] of foundMap.entries()) {
    const prov = entry.prov
    const official = OFFICIAL_HARNESS_CATALOG.find(item => item.provider === pname)
    const caps = (prov && prov.capabilities && typeof prov.capabilities === 'object') ? prov.capabilities : {}
    available.push({
      provider: pname,
      label: (official && official.label) || String((prov && prov.label) || pname),
      packageName: (official && official.packageName) || '',
      accent: (official && official.accent) || '#38bdf8',
      roleHint: (official && official.roleHint) || '外部 Harness 执行进程',
      mode: 'one-shot',
      installed: true,
      transport: entry.transport,
      binaryPath: entry.binaryPath || '',
      configured: Boolean(entry.configured),
      configLabel: entry.configLabel || '',
      capabilities: {
        agentPreset: Boolean(caps.agentPreset),
        outputSchema: Boolean(caps.outputSchema),
        depthLimit: Boolean(caps.depthLimit),
      },
    })
  }

  const availableNames = new Set(available.map(x => x.provider))
  const catalog = OFFICIAL_HARNESS_CATALOG
    .filter(item => !availableNames.has(item.provider))
    .map(item => ({
      ...item,
      mode: 'one-shot',
      installed: false,
      transport: '',
      binaryPath: '',
      installCmd: `dsh plugin --profile desktop add ${item.packageName}`,
    }))

  return { available, catalog }
}

/** Compute live Bubble squad membership, available Harnesses, and hard structural lock state. */
export function computeBubbleState(deps, rootId, state, directory = null) {
  const rid = String(rootId || 'global').trim() || 'global'
  const st = state || loadChiefState()
  const ws = ensureWorkspace(st, rid)
  const cfg = resolveWorkspaceConfig(st, rid)
  const cluster = (directory && Array.isArray(directory.cluster)) ? directory.cluster : getLinkedCluster(st, rid)
  const enrolledHarnesses = Array.isArray(ws.bubbleHarnesses) ? ws.bubbleHarnesses.slice() : []
  const enrolledSet = new Set(enrolledHarnesses.map(h => h && h.provider).filter(Boolean))
  const targets = (directory && Array.isArray(directory.targets)) ? directory.targets : []
  const disc = discoverHarnessProviders(deps && deps.runtime, deps && deps.hostState)

  const activeRunners = targets
    .filter(t => t && t.status === 'running')
    .map(t => ({ key: t.key, id: t.id, name: t.name, kind: t.kind }))

  const activeExternalRuns = []
  const runsMap = deps && deps.hostState && deps.hostState.activeBubbleRuns
  if (runsMap instanceof Map) {
    for (const run of runsMap.values()) {
      if (run && (!run.rootId || run.rootId === rid)) {
        activeExternalRuns.push({
          runId: run.id,
          provider: run.provider,
          label: run.label,
          childId: run.childId || '',
          transport: run.transport || '',
          startedAt: run.startedAt || 0,
        })
      }
    }
  }

  const hasCrossSquad = cluster.length > 1 || enrolledHarnesses.length > 0
  const interventionActive = Boolean(cfg && cfg.tacticalModes && cfg.tacticalModes.intervention && !cfg.stopped)
  const autoLocked = activeExternalRuns.length > 0
    || (hasCrossSquad && (activeRunners.length > 0 || interventionActive))
  const manualLocked = Boolean(ws.bubbleLock && ws.bubbleLock.manualLocked)
  const locked = manualLocked || autoLocked

  const reasons = []
  if (activeExternalRuns.length > 0) reasons.push(`${activeExternalRuns.length} 个外部 Harness 执行中`)
  if (hasCrossSquad && activeRunners.length > 0) reasons.push(`${activeRunners.length} 个会话/子代理运行中`)
  if (hasCrossSquad && interventionActive) reasons.push('主动强介入督导进行中')
  if (manualLocked && ws.bubbleLock && ws.bubbleLock.reason) reasons.push(ws.bubbleLock.reason)
  else if (manualLocked) reasons.push('已手动锁定编队结构')

  return {
    locked,
    autoLocked,
    manualLocked,
    lockReason: reasons.join(' · '),
    hasCrossSquad,
    activeRunners,
    activeExternalRuns,
    enrolledHarnesses: enrolledHarnesses.map(h => {
      const avail = disc.available.find(a => a.provider === h.provider)
      const official = OFFICIAL_HARNESS_CATALOG.find(item => item.provider === h.provider)
      const roleHint = (avail && avail.roleHint) || (official && official.roleHint) || '外部 Harness 执行进程'
      return {
        ...h,
        role: h.role || roleHint,
        roleHint,
        installed: Boolean(avail),
        transport: (avail && avail.transport) || h.transport || '',
        binaryPath: (avail && avail.binaryPath) || '',
        configured: Boolean(avail && avail.configured),
        configLabel: (avail && avail.configLabel) || '',
        running: activeExternalRuns.some(r => r.provider === h.provider),
      }
    }),
    availableHarnesses: disc.available.filter(a => !enrolledSet.has(a.provider)),
    catalogHarnesses: disc.catalog,
  }
}

const BUBBLE_LOCK_ERR = '🔒 协同水泡工作中已锁死结构，不允许中途拆解或改动编队；请等待全员收工或点击「⏹ 急停解体」'

const CLAUDE_FORWARD_ENV_KEYS = [
  'CLAUDE_CONFIG_DIR',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
  'API_TIMEOUT_MS',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_BEARER_TOKEN_BEDROCK',
  'AWS_REGION',
  'AWS_PROFILE',
  'ANTHROPIC_VERTEX_PROJECT_ID',
  'CLOUD_ML_REGION',
  'GOOGLE_APPLICATION_CREDENTIALS',
]

const CODEX_FORWARD_ENV_KEYS = [
  'CODEX_HOME',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_ORG_ID',
  'OPENAI_PROJECT',
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_ENDPOINT',
  'AZURE_OPENAI_API_VERSION',
]

function resolveLocalCliArgv(binaryPath, cliArgs = []) {
  const bin = String(binaryPath || '').trim()
  if (!bin) return cliArgs
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)) {
    try {
      const fd = fs.openSync(bin, 'r')
      const buf = Buffer.alloc(16384)
      let bytes = 0
      try {
        bytes = fs.readSync(fd, buf, 0, buf.length, 0)
      } finally {
        fs.closeSync(fd)
      }
      const txt = buf.toString('utf8', 0, bytes)
      const binDir = path.dirname(bin)
      const dpRe = /(?:%dp0%|%~dp0)[\\/]*([^\r\n"'`<>|*?\t]+?\.(?:mjs|cjs|js|exe))(?=["'\s]|$)/gi
      let m
      while ((m = dpRe.exec(txt)) !== null) {
        const rel = String(m[1] || '').replace(/[\\/]+/g, path.sep)
        const resolved = path.resolve(binDir, rel)
        const baseLower = path.basename(resolved).toLowerCase()
        if (!baseLower || baseLower === 'node.exe' || !isRegularFileSafe(resolved)) continue
        if (baseLower.endsWith('.exe')) return [resolved, ...cliArgs]
        return [process.execPath, resolved, ...cliArgs]
      }
      const absRe = /(["'])([A-Za-z]:[\\/][^"'\r\n]+?\.(?:exe|mjs|cjs|js))\1/gi
      while ((m = absRe.exec(txt)) !== null) {
        const resolved = path.normalize(String(m[2] || ''))
        const baseLower = path.basename(resolved).toLowerCase()
        if (!baseLower || baseLower === 'node.exe' || !isRegularFileSafe(resolved)) continue
        if (baseLower.endsWith('.exe')) return [resolved, ...cliArgs]
        return [process.execPath, resolved, ...cliArgs]
      }
    } catch {}
    return [process.env.ComSpec || 'cmd.exe', '/d', '/s', '/c', bin, ...cliArgs]
  }
  return [bin, ...cliArgs]
}

/** Build explicit opt-in child env for out-of-process external CLIs (passes dsh-subprocess scrub without leaking DEEPSEEK_* / DSH_*). */
function buildExternalHarnessEnv(provider) {
  const keys = provider === 'claude-code'
    ? CLAUDE_FORWARD_ENV_KEYS
    : (provider === 'codex' ? CODEX_FORWARD_ENV_KEYS : [])
  if (!keys.length) return undefined
  const out = {}
  for (const k of keys) {
    const val = process.env[k]
    if (typeof val === 'string' && val.length > 0) {
      out[k] = val
    }
  }
  return Object.keys(out).length ? out : undefined
}

const HARNESS_TARGET_ALIASES = {
  claude: 'claude-code',
  claudecode: 'claude-code',
  'claude code': 'claude-code',
  'claude-code': 'claude-code',
  codex: 'codex',
  'openai-codex': 'codex',
}

/** Resolve an external Harness target identifier or alias against enrolled/available Harnesses in the Bubble. */
export function resolveExternalHarnessTarget(runtime, hostState, rootId, rawTarget) {
  const clean = String(rawTarget || '').trim().replace(/^@/, '').toLowerCase()
  if (!clean) return null
  const canonical = HARNESS_TARGET_ALIASES[clean] || clean
  const bState = computeBubbleState({ runtime, hostState }, rootId)
  const enrolledList = Array.isArray(bState.enrolledHarnesses) ? bState.enrolledHarnesses : []
  const availList = Array.isArray(bState.availableHarnesses) ? bState.availableHarnesses : []

  const matchItem = (item) => {
    if (!item || !item.provider || item.installed === false) return false
    const pLow = String(item.provider).trim().toLowerCase()
    const lLow = String(item.label || '').trim().toLowerCase()
    return pLow === canonical || pLow === clean || lLow === clean
  }

  const enrolledHit = enrolledList.find(matchItem)
  if (enrolledHit) {
    return {
      provider: enrolledHit.provider,
      label: enrolledHit.label || enrolledHit.provider,
      transport: enrolledHit.transport || '',
      installed: Boolean(enrolledHit.installed),
      enrolled: true,
    }
  }

  const availHit = availList.find(matchItem)
  if (availHit) {
    return {
      provider: availHit.provider,
      label: availHit.label || availHit.provider,
      transport: availHit.transport || '',
      installed: Boolean(availHit.installed),
      enrolled: false,
    }
  }
  return null
}

/** Unified out-of-process external Harness dispatcher shared by HTTP routes & DSH Chief relays. */
export async function dispatchBubbleHarness(deps, {
  rootId = '',
  provider = '',
  text = '',
  label = '',
  fromLabel = 'DSH 参谋长',
  force = false,
  allowAutoEnroll = true,
} = {}) {
  const rid = String(rootId || 'global').trim() || 'global'
  const cleanProvider = clamp(String(provider || '').trim(), 64)
  const taskText = typeof text === 'string' ? text.trim() : ''
  const taskLabel = clamp(String(label || taskText || cleanProvider).trim(), 48)
  if (!cleanProvider || !taskText) {
    return { ok: false, statusCode: 400, error: '需要指定目标 Harness provider 与任务内容' }
  }

  const runtime = deps && deps.runtime
  const subagents = runtime && typeof runtime.get === 'function' ? runtime.get('subagents') : null
  const agentsSvc = runtime && typeof runtime.get === 'function' ? runtime.get('agents') : null
  const subprocessSvc = (runtime && typeof runtime.get === 'function' ? runtime.get('subprocess') : null)
    || (deps && deps.hostState && deps.hostState.activeSubprocess)
    || null
  const prov = subagents && typeof subagents.getProvider === 'function' ? subagents.getProvider(cleanProvider) : null
  const localHit = detectLocalHarnessBinaries().get(cleanProvider) || null
  const canUseSubagent = Boolean(subagents && typeof subagents.startActivation === 'function' && prov)
  const canUseLocalCli = Boolean(subprocessSvc && typeof subprocessSvc.spawn === 'function' && localHit && localHit.binaryPath)

  if (!canUseSubagent && !canUseLocalCli) {
    return {
      ok: false,
      statusCode: 400,
      error: `当前宿主未检测到「${cleanProvider}」外部插件，也未找到本机 CLI（可安装 @deepseek-ai/dsh-subagent-${cleanProvider} 或本机 CLI 后重试）`,
    }
  }

  const liveCaller = (agentsSvc && typeof agentsSvc.get === 'function' ? agentsSvc.get(rid) : null)
    || (deps && typeof deps.findLiveCallerAgent === 'function' ? deps.findLiveCallerAgent(runtime, rid, null) : null)
  if (!canUseLocalCli && canUseSubagent && !liveCaller) {
    return {
      ok: false,
      statusCode: 400,
      error: '当前主对话会话未激活，请先在主窗口发一条消息激活会话',
    }
  }

  const stNow = loadChiefState()
  const wsNow = ensureWorkspace(stNow, rid)
  const official = OFFICIAL_HARNESS_CATALOG.find(item => item.provider === cleanProvider)
  const displayLabel = (official && official.label) || String((prov && prov.label) || cleanProvider)
  const isEnrolled = Array.isArray(wsNow.bubbleHarnesses) && wsNow.bubbleHarnesses.some(h => h && h.provider === cleanProvider)

  if (!isEnrolled) {
    const dirNow = await listPeerDirectory(deps, rid).catch(() => ({ targets: [], cluster: [] }))
    const bState = computeBubbleState(deps, rid, stNow, dirNow)
    if (bState.locked && force !== true) {
      return { ok: false, locked: true, statusCode: 409, error: BUBBLE_LOCK_ERR, bubble: bState }
    }
    if (!allowAutoEnroll) {
      return { ok: false, statusCode: 400, error: `外部 Harness「${displayLabel}」尚未编入当前协同水泡` }
    }
    setBubbleHarnessMembership(rid, {
      provider: cleanProvider,
      label: displayLabel,
      role: (official && official.roleHint) || '外部 Harness 执行进程',
      joined: true,
    })
  }

  let actionCwd = process.cwd()
  try {
    const resolvedCwd = deps && typeof deps.getSessionCwd === 'function' ? deps.getSessionCwd(rid) : ''
    if (resolvedCwd) actionCwd = resolvedCwd
  } catch {}

  let boardNow = null
  try {
    if (rid && deps && typeof deps.boardForSession === 'function' && typeof deps.boardFileFor === 'function') {
      boardNow = deps.boardForSession(deps.boardFileFor(rid))
    }
  } catch {}
  const forbiddenList = (boardNow && boardNow.bounds && Array.isArray(boardNow.bounds.forbidden))
    ? boardNow.bounds.forbidden.filter(Boolean).slice(0, 8)
    : []
  const activeWalls = listGuardWalls({ cwd: actionCwd }).filter(w => w && w.activeNow).slice(0, 8)
  const constraintLines = []
  if (forbiddenList.length) {
    constraintLines.push('禁止红线: ' + forbiddenList.join('；'))
  }
  if (activeWalls.length) {
    constraintLines.push('物理驻墙保护: ' + activeWalls.map(w => `${w.title}(${(w.patterns || []).join(', ')})`).join('；'))
  }
  const safePrompt = constraintLines.length
    ? `[DSH 参谋长协同水泡派单 · 外部独立进程需严格遵守以下边界]\n${constraintLines.join('\n')}\n\n[任务内容]\n${taskText}`
    : taskText

  if (deps && deps.hostState && !(deps.hostState.activeBubbleRuns instanceof Map)) {
    deps.hostState.activeBubbleRuns = new Map()
  }
  const activeRuns = deps && deps.hostState ? deps.hostState.activeBubbleRuns : null

  const ac = new AbortController()
  const runKey = nextId('brun')
  const recordDispatchState = (childIdVal, transportLabel) => {
    appendChiefAuditLog(rid, {
      kind: 'bubble_harness_dispatch',
      decision: 'allowed',
      tool: cleanProvider,
      reason: `${fromLabel} 向水泡外部 Harness「${cleanProvider}」(${transportLabel}) 派发任务并自动锁死编队：${taskLabel}`,
    })
    mutateChiefState((st) => {
      const ws = ensureWorkspace(st, rid)
      ws.mailbox.push({
        id: nextId('mail'),
        from: fromLabel || 'DSH 参谋长',
        fromSession: rid,
        fromRootId: rid,
        to: cleanProvider,
        toSession: childIdVal || cleanProvider,
        toRootId: rid,
        subject: `外部 Harness 派单 · ${cleanProvider}`,
        text: taskText.slice(0, 1200),
        mode: 'followup',
        channelType: 'internal',
        readBy: [rid],
        at: Date.now(),
      })
      if (ws.mailbox.length > MAIL_CAP) ws.mailbox = ws.mailbox.slice(-MAIL_CAP)
      ws.chat.push({
        id: nextId('chat'),
        role: 'chief',
        kind: 'receipt',
        text: `- 【⚡ 水泡派单 · ${cleanProvider}】已启动${transportLabel === 'local-cli' ? '本机 CLI 直连' : '外部 Harness'}执行「${taskLabel}」，编队已自动锁定保护。`,
        actions: ['🔒 编队工作中已锁死'],
        at: Date.now(),
      })
      if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
    })
  }

  const writeSettlementReceipt = (childIdVal, outText, ok = true) => {
    const bodyTxt = clamp(String(outText || '').trim() || (ok ? '外部 Harness 任务已完成' : '外部 Harness 执行未返回有效结果'), 1400)
    mutateChiefState((st) => {
      const ws = ensureWorkspace(st, rid)
      ws.mailbox.push({
        id: nextId('mail'),
        from: `@${cleanProvider}`,
        fromSession: childIdVal || cleanProvider,
        fromRootId: rid,
        to: 'lead',
        toSession: rid,
        toRootId: rid,
        subject: `外部 Harness 回执 · ${cleanProvider}`,
        text: bodyTxt,
        mode: 'followup',
        channelType: 'internal',
        readBy: [],
        at: Date.now(),
      })
      if (ws.mailbox.length > MAIL_CAP) ws.mailbox = ws.mailbox.slice(-MAIL_CAP)
      ws.chat.push({
        id: nextId('chat'),
        role: 'chief',
        kind: 'receipt',
        text: ok
          ? `- 【✅ @${cleanProvider} 交卷】${bodyTxt.slice(0, 320)}`
          : `- 【⚠️ @${cleanProvider} 异常中断】${bodyTxt.slice(0, 320)}`,
        actions: [ok ? '解开对应执行锁' : '🔓 已释放执行锁'],
        at: Date.now(),
      })
      if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
    })
  }

  let childId = runKey
  let usedTransport = 'dsh-subagent'

  if (canUseSubagent && liveCaller) {
    const activation = await subagents.startActivation({
      provider: cleanProvider,
      label: taskLabel,
      prompt: [{ type: 'text', text: safePrompt }],
      parent: liveCaller,
      signal: ac.signal,
      delivery: 'parent',
    })
    childId = String((activation && activation.childId) || '') || runKey
    if (activeRuns) {
      activeRuns.set(runKey, {
        id: runKey,
        rootId: rid,
        provider: cleanProvider,
        label: taskLabel,
        childId,
        transport: 'dsh-subagent',
        startedAt: Date.now(),
        abortController: ac,
      })
    }
    recordDispatchState(childId, 'dsh-subagent')

    if (activation && activation.result && typeof activation.result.then === 'function') {
      Promise.resolve(activation.result)
        .then((resVal) => {
          if (ac.signal.aborted) return
          const outText = (resVal && (resVal.text || resVal.output || resVal.summary))
            || (typeof resVal === 'string' ? resVal : '外部 Harness 任务已完成')
          writeSettlementReceipt(childId, outText, true)
        })
        .catch((err) => {
          if (ac.signal.aborted) return
          writeSettlementReceipt(childId, (err && err.message) || err || '执行失败', false)
        })
        .finally(() => {
          if (activeRuns) activeRuns.delete(runKey)
        })
    }
  } else {
    // Path B: Direct invocation of local Codex / Claude Code CLI via DSH host ctx.subprocess
    usedTransport = 'local-cli'
    const tmpOutFile = cleanProvider === 'codex'
      ? path.join(os.tmpdir(), `dsh-bubble-${cleanProvider}-${runKey}.txt`)
      : ''
    const cliArgs = cleanProvider === 'codex'
      ? ['exec', '--skip-git-repo-check', '--color', 'never', '-C', actionCwd, '-s', 'workspace-write', '-o', tmpOutFile, '-']
      : ['-p', '--output-format', 'text', '--no-session-persistence']
    const argv = resolveLocalCliArgv(localHit.binaryPath, cliArgs)

    const envOverrides = buildExternalHarnessEnv(cleanProvider)
    const handle = subprocessSvc.spawn({
      argv,
      cwd: actionCwd,
      graceMs: 4000,
      signal: ac.signal,
      ...(envOverrides ? { env: envOverrides } : {}),
      stdio: {
        stdin: { data: safePrompt },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    })

    const outChunks = []
    const errChunks = []
    const appendChunk = (arr, byteRefSet, chunk) => {
      if (byteRefSet.n >= 65536) return
      const s = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '')
      arr.push(s)
      byteRefSet.n += s.length
    }
    const outLen = { n: 0 }
    const errLen = { n: 0 }
    try { handle.stdout?.on?.('data', chunk => appendChunk(outChunks, outLen, chunk)) } catch {}
    try { handle.stderr?.on?.('data', chunk => appendChunk(errChunks, errLen, chunk)) } catch {}

    if (activeRuns) {
      activeRuns.set(runKey, {
        id: runKey,
        rootId: rid,
        provider: cleanProvider,
        label: taskLabel,
        childId,
        transport: 'local-cli',
        startedAt: Date.now(),
        abortController: ac,
        terminate: () => {
          try { if (handle && typeof handle.terminate === 'function') handle.terminate() } catch {}
        },
      })
    }
    recordDispatchState(childId, 'local-cli')

    const cleanTmpOut = () => {
      if (!tmpOutFile) return
      try { fs.rmSync(tmpOutFile, { force: true }) } catch {}
    }

    if (handle && handle.done && typeof handle.done.then === 'function') {
      Promise.resolve(handle.done)
        .then((outcome) => {
          let outText = ''
          if (tmpOutFile) {
            try {
              if (fs.existsSync(tmpOutFile)) outText = fs.readFileSync(tmpOutFile, 'utf8').trim()
            } catch {}
          }
          if (!outText) outText = outChunks.join('').trim()
          const errTail = errChunks.join('').trim().slice(-400)
          const exitCode = outcome && typeof outcome.exitCode === 'number' ? outcome.exitCode : 0
          if (ac.signal.aborted) return
          if (exitCode !== 0) {
            const diagParts = [outText, errTail].filter(Boolean)
            const combinedDiag = diagParts.join(outText && errTail ? '\n' : '').trim()
            const failMsg = combinedDiag
              ? `退出码 ${exitCode}：${clamp(combinedDiag, 1200)}`
              : `外部 CLI 进程以退出码 ${exitCode} 结束`
            writeSettlementReceipt(childId, failMsg, false)
          } else {
            writeSettlementReceipt(childId, outText || '本机 CLI 任务已执行完成', true)
          }
        })
        .catch((err) => {
          if (ac.signal.aborted) return
          writeSettlementReceipt(childId, (err && err.message) || err || 'CLI 调用失败', false)
        })
        .finally(() => {
          cleanTmpOut()
          if (activeRuns) activeRuns.delete(runKey)
        })
    } else {
      cleanTmpOut()
    }
  }

  return {
    ok: true,
    runId: runKey,
    childId,
    provider: cleanProvider,
    label: displayLabel,
    transport: usedTransport,
    bubbleLocked: true,
  }
}
