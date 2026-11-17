import crypto from 'node:crypto'

export const AUTO_CONTINUE_SOURCE_KIND = 'dsh-chief-auto-continue'
export const MAX_CONSECUTIVE_AUTO_CONTINUE = 3

const TRANSIENT_ERROR_PATTERNS = [
  /econnreset/i,
  /etimedout/i,
  /epipe/i,
  /enotfound/i,
  /econnrefused/i,
  /eai_again/i,
  /socket hang up/i,
  /fetch failed/i,
  /network(?:\s+error|\s+timeout|\s+unavailable)?/i,
  /timeout/i,
  /timed out/i,
  /premature close/i,
  /stream(?:\s+error|\s+aborted|\s+closed|\s+ended)/i,
  /malformed_response/i,
  /empty response/i,
  /rate.?limit/i,
  /too many requests/i,
  /overload(?:ed)?/i,
  /service unavailable/i,
  /bad gateway/i,
  /gateway timeout/i,
  /temporarily unavailable/i,
  /internal server error/i,
  /connection reset/i,
  /broken pipe/i,
  /\b(?:408|425|429|500|502|503|504|520|521|522|523|524)\b/,
]

const PERMANENT_ERROR_PATTERNS = [
  /invalid[_\s-]*api[_\s-]*key/i,
  /unauthorized/i,
  /authentication/i,
  /forbidden/i,
  /permission denied/i,
  /insufficient[_\s-]*(?:balance|quota|funds|credits)/i,
  /quota[_\s-]*exceeded/i,
  /billing/i,
  /payment required/i,
  /model[_\s-]*not[_\s-]*found/i,
  /context[_\s-]*(?:length|window)[_\s-]*exceeded/i,
  /maximum context length/i,
  /content[_\s-]*policy/i,
  /safety/i,
  /\b(?:401|402|403|404)\b/,
]

const TRANSIENT_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524])
const PERMANENT_STATUS_CODES = new Set([400, 401, 402, 403, 404, 422])

function clampText(text, maxLen = 240) {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  return s.length > maxLen ? s.slice(0, maxLen) + '...' : s
}

/**
 * 跟踪单回合内工具调用生命周期，用于区分「已无任何活动空转」与「执行中/已完成部分工具后的意外中断」，
 * 并在续跑提示词中注入幂等检查提醒，防止重复产生副作用。
 */
export class ToolInvocationTracker {
  constructor() {
    this.pending = new Map()
    this.done = new Set()
    this.seq = 0
  }

  reset() {
    this.pending.clear()
    this.done.clear()
    this.seq = 0
  }

  onCall(data = {}) {
    const rawId = data.toolCallId || data.callId || data.id
    const name = String(data.name || data.toolName || 'tool').trim() || 'tool'
    const key = rawId ? String(rawId) : `${name}#${++this.seq}`
    this.pending.set(key, { key, name, at: Date.now() })
    return key
  }

  onResult(data = {}) {
    const rawId = data.toolCallId || data.callId || data.id
    if (rawId && this.pending.has(String(rawId))) {
      const k = String(rawId)
      const rec = this.pending.get(k)
      this.pending.delete(k)
      this.done.add(rec ? rec.name : k)
      return
    }
    const name = String(data.name || data.toolName || '').trim()
    if (name) {
      for (const [k, rec] of this.pending.entries()) {
        if (rec.name === name) {
          this.pending.delete(k)
          this.done.add(name)
          return
        }
      }
      this.done.add(name)
      return
    }
    const first = this.pending.keys().next()
    if (!first.done) {
      const k = first.value
      const rec = this.pending.get(k)
      this.pending.delete(k)
      this.done.add(rec ? rec.name : k)
    }
  }

  summary() {
    return {
      pendingCount: this.pending.size,
      doneCount: this.done.size,
      pendingNames: [...this.pending.values()].map(x => x.name),
      doneNames: [...this.done.values()],
    }
  }
}

/** 解析 turn/end reason，支持对象格式及 nested reason.kind。 */
export function parseFailureFacts(err) {
  if (!err || typeof err !== 'object') {
    const msg = typeof err === 'string' ? err : ''
    return msg ? { code: 'UNKNOWN_ERROR', status: undefined, message: msg } : undefined
  }
  const code = String(err.code || err.name || err.type || 'UNKNOWN_ERROR').trim()
  const rawStatus = err.status ?? err.statusCode ?? err.httpStatus
  const status = Number.isFinite(Number(rawStatus)) ? Number(rawStatus) : undefined
  const message = clampText(err.message || err.detail || err.reason || code, 400)
  return { code, status, message }
}

/** 判定错误是否属于可恢复的瞬态失败。永久性错误（鉴权/余额不足/模型不存在/超长上下文）返回 false。 */
export function isTransientFailure(failure) {
  if (!failure || typeof failure !== 'object') return false
  const status = failure.status
  const combined = `${failure.code || ''} ${failure.message || ''}`.trim()

  if (typeof status === 'number') {
    if (TRANSIENT_STATUS_CODES.has(status)) return true
    if (PERMANENT_STATUS_CODES.has(status)) {
      // 某些网关在 400/422 下仍可能包装 MALFORMED_RESPONSE 等瞬态格式异常
      if (/malformed_response|empty response/i.test(combined)) return true
      return false
    }
  }

  for (const re of PERMANENT_ERROR_PATTERNS) {
    if (re.test(combined)) return false
  }
  for (const re of TRANSIENT_ERROR_PATTERNS) {
    if (re.test(combined)) return true
  }
  return false
}

/** 解析 DSH turn/end 事件的原因分类。 */
export function classifyTurnEndReason(reason, eventData = null) {
  const extraFailure = eventData && typeof eventData === 'object' && eventData.error !== undefined
    ? parseFailureFacts(eventData.error)
    : undefined
  if (typeof reason === 'string') {
    const kind = reason.trim().toLowerCase()
    return kind ? { kind, nestedKind: '', failure: extraFailure } : undefined
  }
  if (!reason || typeof reason !== 'object') return undefined
  const kind = typeof reason.kind === 'string' ? reason.kind.trim().toLowerCase() : ''
  if (!kind) return undefined
  const nestedObj = reason.reason && typeof reason.reason === 'object' ? reason.reason : null
  const nestedKind = nestedObj && typeof nestedObj.kind === 'string'
    ? nestedObj.kind.trim().toLowerCase()
    : ''
  const rawErr = reason.error !== undefined
    ? reason.error
    : (nestedObj && nestedObj.error !== undefined ? nestedObj.error : undefined)
  const failure = rawErr !== undefined ? parseFailureFacts(rawErr) : extraFailure
  return { kind, nestedKind, failure }
}

function buildContinuePrompt(trigger, toolSummary = {}, failure = null) {
  const pendingCount = Number(toolSummary.pendingCount) || 0
  const doneCount = Number(toolSummary.doneCount) || 0

  let lead = '检测到上一轮执行意外收尾，请基于当前进度与目标继续推进，直到任务完整收口。'
  if (trigger === 'turn/end:max-tokens') {
    lead = '上一轮因输出长度达到上限（max-tokens）被截断，请紧接上文未完成的部分继续推进。'
  } else if (trigger.endsWith(':silent') || trigger === 'turn/end:no-visible-output') {
    lead = '检测到上一轮未输出有效可见内容即结束，请直接承接上下文继续执行未完成步骤或给出明确结论。'
  } else if (trigger === 'turn/end:interrupted') {
    lead = '检测到上一轮执行途中意外中断，请核对现状后继续推进未完成任务。'
  } else if (trigger === 'turn/end:error') {
    const detail = failure
      ? [failure.code, failure.status ? `HTTP ${failure.status}` : '', failure.message].filter(Boolean).join(' · ')
      : ''
    lead = `上一轮因临时异常中断（${clampText(detail || '网络或接口抖动', 120)}），请核对现场后继续完成任务。`
  } else if (trigger === 'idle-stall') {
    lead = '检测到当前会话仍有未完结工作却停滞空转，请继续推进关键步骤并附可验证结果。'
  }

  let guardText = ''
  if (pendingCount > 0) {
    const pendingList = Array.isArray(toolSummary.pendingNames) && toolSummary.pendingNames.length
      ? `（涉及工具：${toolSummary.pendingNames.slice(0, 4).join('、')}）`
      : ''
    guardText = `\n[幂等安全提醒] 中断前仍有工具调用未收尾${pendingList}，请先检查文件/状态是否已写入，确认未产生重复副作用后再继续执行。`
  } else if (doneCount > 0) {
    const doneList = Array.isArray(toolSummary.doneNames) && toolSummary.doneNames.length
      ? `（已完成：${toolSummary.doneNames.slice(0, 4).join('、')}）`
      : ''
    guardText = `\n[幂等安全提醒] 上一轮已有工具调用完成${doneList}，请先核实已有产出，切勿重复执行会覆盖或叠加副作用的步骤。`
  }

  return `[DSH 参谋长 · 断线续跑] ${lead}${guardText}`
}

/**
 * 创建宿主侧 Auto-Continue 恢复引擎（对齐 dsh-auto-continue 状态机）：
 * - 监听 session/event 全生命周期
 * - 在网络/限流/截断/无输出/意外打断时指数退避续跑
 * - 尊重人类主动停止 (aborted)、人类发新消息、永久错误 (401/403/余额不足等) 与参谋长停机状态 (stopped)
 */
export function createAutoContinueEngine(options = {}) {
  const {
    getAgent,
    createMessage = null,
    isChiefStopped = () => false,
    canAutoContinue = null,
    resolveRootSessionId = (sid) => sid,
    onLog = () => {},
    baseDelayMs = 1500,
    maxConsecutive = MAX_CONSECUTIVE_AUTO_CONTINUE,
    echoTtlMs = 30_000,
  } = options

  const sessions = new Map()

  function getSessionState(sessionId) {
    const sid = String(sessionId || '').trim()
    if (!sid) return null
    let st = sessions.get(sid)
    if (!st) {
      st = {
        sessionId: sid,
        consecutive: 0,
        lastAttemptAt: 0,
        lastFailure: null,
        lastToolSummary: { pendingCount: 0, doneCount: 0, pendingNames: [], doneNames: [] },
        turnOutput: 'none', // 'none' | 'silent' | 'visible'
        sawModelActivity: false,
        tools: new ToolInvocationTracker(),
        timer: null,
        pendingEchoes: new Map(), // messageId -> expiresAt
        stats: { scheduled: 0, sent: 0, skippedPermanent: 0, skippedStopped: 0, skippedAborted: 0 },
      }
      sessions.set(sid, st)
    }
    return st
  }

  function pruneEchoes(st) {
    const now = Date.now()
    for (const [id, exp] of st.pendingEchoes.entries()) {
      if (exp <= now) st.pendingEchoes.delete(id)
    }
  }

  function trackEcho(st, messageId) {
    if (!messageId) return
    pruneEchoes(st)
    st.pendingEchoes.set(String(messageId), Date.now() + echoTtlMs)
  }

  function isOurMessage(st, event) {
    const data = event && event.data ? event.data : {}
    const msg = data.message && typeof data.message === 'object' ? data.message : data
    const srcKind = String((data.source && data.source.kind) || (msg.source && msg.source.kind) || '').trim()
    if (srcKind === AUTO_CONTINUE_SOURCE_KIND || srcKind === 'dsh-chief' || srcKind === 'dsh-chief-relay') {
      return true
    }
    const id = String(data.id || data.messageId || msg.id || '').trim()
    pruneEchoes(st)
    if (id && st.pendingEchoes.has(id)) {
      st.pendingEchoes.delete(id)
      return true
    }
    return false
  }

  function cancelPending(sessionId, why = '') {
    const st = getSessionState(sessionId)
    if (!st) return false
    let had = false
    if (st.timer) {
      clearTimeout(st.timer)
      st.timer = null
      had = true
    }
    if (had && why) onLog(sessionId, `取消自动续跑（${why}）`)
    return had
  }

  function computeDelayMs(st) {
    const exp = Math.min(4, Math.max(0, st.consecutive))
    return Math.round(baseDelayMs * Math.pow(2, exp))
  }

  async function fire(sessionId, trigger, { detail = '', bypassGate = false } = {}) {
    const st = getSessionState(sessionId)
    if (!st) return { ok: false, skipped: 'invalid-session' }
    st.timer = null

    const rootId = resolveRootSessionId(sessionId) || sessionId
    if (isChiefStopped(rootId, sessionId)) {
      st.stats.skippedStopped += 1
      onLog(sessionId, '参谋长处于停止状态（stopped），跳过自动续跑')
      return { ok: false, skipped: 'chief-stopped' }
    }

    if (!bypassGate && typeof canAutoContinue === 'function') {
      const verdict = await Promise.resolve(canAutoContinue({ sessionId, rootId, trigger, detail }))
      if (verdict && verdict.allowed === false) {
        st.stats.skippedStopped += 1
        if (verdict.logMessage) onLog(sessionId, verdict.logMessage)
        return { ok: false, skipped: verdict.skipped || 'permission-mode', approvalId: verdict.approvalId }
      }
    }

    if (st.consecutive >= maxConsecutive) {
      onLog(sessionId, `已达连续自动续跑上限（${maxConsecutive} 次），等待人工确认或成功回合恢复`)
      return { ok: false, skipped: 'max-consecutive' }
    }

    const agent = typeof getAgent === 'function' ? await getAgent(sessionId) : null
    if (!agent) {
      onLog(sessionId, `未找到活跃会话句柄，跳过续跑（${trigger}）`)
      return { ok: false, skipped: 'no-agent' }
    }
    if (agent.status === 'running') {
      return { ok: false, skipped: 'agent-running' }
    }
    if (typeof agent.followup !== 'function') {
      onLog(sessionId, `会话不支持 followup 接口，无法发送断线续跑（${trigger}）`)
      return { ok: false, skipped: 'no-followup' }
    }

    const text = buildContinuePrompt(trigger, st.lastToolSummary, st.lastFailure) + (detail ? `\n补充上下文：${clampText(detail, 180)}` : '')
    const fallbackId = `ac-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
    let envelope = null
    if (typeof createMessage === 'function') {
      try {
        envelope = await createMessage(text, AUTO_CONTINUE_SOURCE_KIND)
      } catch {
        envelope = null
      }
    }
    if (!envelope || typeof envelope !== 'object') {
      envelope = {
        id: fallbackId,
        role: 'user',
        content: [{ type: 'text', text }],
        source: { kind: AUTO_CONTINUE_SOURCE_KIND },
        timestamp: Date.now(),
      }
    } else if (!envelope.id) {
      envelope = { ...envelope, id: fallbackId }
    }
    const msgId = String(envelope.id)

    st.lastAttemptAt = Date.now()
    trackEcho(st, msgId)
    try {
      const ret = agent.followup(envelope)
      if (ret && typeof ret.then === 'function') await ret
      st.consecutive += 1
      st.stats.sent += 1
      onLog(sessionId, `断线续跑已触发（原因：${trigger}，第 ${st.consecutive}/${maxConsecutive} 次尝试）`)
      return { ok: true, msgId, trigger, consecutive: st.consecutive }
    } catch (err) {
      st.pendingEchoes.delete(msgId)
      const msg = String(err && err.message ? err.message : err)
      onLog(sessionId, `断线续跑投递失败（${trigger}）：${msg}`)
      return { ok: false, error: msg }
    }
  }

  function schedule(sessionId, trigger, opts = {}) {
    const st = getSessionState(sessionId)
    if (!st) return { scheduled: false, reason: 'invalid-session' }
    const rootId = resolveRootSessionId(sessionId) || sessionId
    if (isChiefStopped(rootId, sessionId)) {
      st.stats.skippedStopped += 1
      cancelPending(sessionId, '参谋长处于停止状态')
      return { scheduled: false, reason: 'chief-stopped' }
    }
    if (st.consecutive >= maxConsecutive) {
      return { scheduled: false, reason: 'max-consecutive' }
    }

    cancelPending(sessionId)
    const delay = typeof opts.delayMs === 'number' ? Math.max(0, opts.delayMs) : computeDelayMs(st)
    st.stats.scheduled += 1
    st.timer = setTimeout(() => {
      void fire(sessionId, trigger, { detail: opts.detail || '' })
    }, delay)
    if (st.timer && typeof st.timer.unref === 'function') st.timer.unref()
    return { scheduled: true, delayMs: delay, trigger }
  }

  function onSessionEvent(session, event) {
    if (!session || !session.id || !event || typeof event !== 'object') return null
    const sessionId = String(session.id).trim()
    if (!sessionId) return null
    const st = getSessionState(sessionId)
    if (!st) return null

    const data = event.data && typeof event.data === 'object' ? event.data : {}
    switch (event.type) {
      case 'turn/start':
        cancelPending(sessionId)
        st.sawModelActivity = false
        st.turnOutput = 'none'
        st.tools.reset()
        return { action: 'turn-started' }

      case 'step/start':
      case 'llm/call':
      case 'llm/start':
      case 'llm/response':
        st.sawModelActivity = true
        if (st.turnOutput === 'none') st.turnOutput = 'silent'
        return null

      case 'assistant/chunk': {
        if (event.surfaceOp) return null
        st.sawModelActivity = true
        const chunk = data.chunk && typeof data.chunk === 'object' ? data.chunk : null
        let visible = false
        if (chunk) {
          visible = (chunk.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text.trim() !== '')
            || chunk.type === 'tool-call-delta'
            || (chunk.type === 'block-start' && chunk.blockType !== 'reasoning' && chunk.blockType !== 'text')
            || (chunk.type === 'block-end' && chunk.block && chunk.block.type !== 'reasoning' && (chunk.block.type !== 'text' || String(chunk.block.text || '').trim() !== ''))
        } else if (typeof data.text === 'string' && data.text.trim() !== '') {
          visible = true
        }
        if (visible) {
          st.turnOutput = 'visible'
        } else if (st.turnOutput === 'none' && (!chunk || (chunk.type !== 'usage' && chunk.type !== 'finish'))) {
          st.turnOutput = 'silent'
        }
        return null
      }

      case 'assistant/message': {
        if (event.surfaceOp) return null
        st.sawModelActivity = true
        const content = data.message && Array.isArray(data.message.content)
          ? data.message.content
          : (Array.isArray(data.content) ? data.content : null)
        const hasVisibleBlocks = Array.isArray(content) && content.some(c => {
          if (!c || typeof c !== 'object') return false
          if (c.type === 'reasoning') return false
          if (c.type === 'text') return String(c.text || '').trim() !== ''
          return true
        })
        if ((typeof data.text === 'string' && data.text.trim() !== '') || hasVisibleBlocks) {
          st.turnOutput = 'visible'
        } else if (st.turnOutput === 'none') {
          st.turnOutput = 'silent'
        }
        return null
      }

      case 'tool/call':
        st.sawModelActivity = true
        st.tools.onCall(data)
        return null

      case 'tool/result':
        st.sawModelActivity = true
        st.tools.onResult(data)
        return null

      case 'user/message':
        if (event.surfaceOp) return null
        if (isOurMessage(st, event)) return { action: 'ignored-echo' }
        {
          const srcKind = String((data.source && data.source.kind) || '').trim()
          if (!srcKind || srcKind === 'user') {
            st.consecutive = 0
            st.lastFailure = null
            cancelPending(sessionId, '用户发送了新消息')
            return { action: 'user-intervened' }
          }
        }
        return null

      case 'turn/end': {
        const parsed = classifyTurnEndReason(data.reason, data)
        if (!parsed) return null
        st.lastToolSummary = st.tools.summary()
        const rootId = resolveRootSessionId(sessionId) || sessionId
        const stopped = isChiefStopped(rootId, sessionId)

        if (parsed.kind === 'aborted' || parsed.nestedKind === 'aborted') {
          st.stats.skippedAborted += 1
          st.consecutive = 0
          st.lastFailure = null
          cancelPending(sessionId, '人工停止回合')
          return { action: 'aborted', scheduled: false }
        }

        if (parsed.kind === 'blocked' || parsed.nestedKind === 'blocked') {
          cancelPending(sessionId, '策略拦截')
          return { action: 'blocked', scheduled: false }
        }

        if (stopped) {
          st.stats.skippedStopped += 1
          cancelPending(sessionId, '参谋长已停止')
          return { action: 'chief-stopped', scheduled: false }
        }

        if (parsed.kind === 'no-visible-output' || (parsed.kind === 'completed' && st.turnOutput === 'silent' && st.lastToolSummary.doneCount === 0)) {
          st.lastFailure = null
          const res = schedule(sessionId, `turn/end:${parsed.kind}:silent`)
          return { action: 'silent-scheduled', ...res }
        }

        if (parsed.kind === 'completed') {
          if (st.turnOutput === 'visible' || st.lastToolSummary.doneCount > 0) {
            st.consecutive = 0
            st.lastFailure = null
          }
          return { action: 'completed', scheduled: false }
        }

        if (parsed.kind === 'max-tokens') {
          st.lastFailure = null
          const res = schedule(sessionId, 'turn/end:max-tokens')
          return { action: 'max-tokens-scheduled', ...res }
        }

        if (parsed.kind === 'interrupted') {
          if (parsed.nestedKind === 'error' && parsed.failure && !isTransientFailure(parsed.failure)) {
            st.lastFailure = parsed.failure
            st.stats.skippedPermanent += 1
            onLog(sessionId, `检测到永久性错误（${parsed.failure.code}${parsed.failure.status ? ` HTTP ${parsed.failure.status}` : ''}），跳过自动续跑`)
            return { action: 'permanent-error-skipped', failure: parsed.failure, scheduled: false }
          }
          st.lastFailure = parsed.failure || null
          const res = schedule(sessionId, 'turn/end:interrupted')
          return { action: 'interrupted-scheduled', ...res }
        }

        if (parsed.kind === 'error') {
          const failure = parsed.failure
            || (data.error !== undefined ? parseFailureFacts(data.error) : null)
            || { code: 'UNKNOWN_ERROR', status: undefined, message: '' }
          st.lastFailure = failure
          if (!isTransientFailure(failure)) {
            st.stats.skippedPermanent += 1
            onLog(sessionId, `检测到永久性错误（${failure.code}${failure.status ? ` HTTP ${failure.status}` : ''}），跳过自动续跑`)
            return { action: 'permanent-error-skipped', failure, scheduled: false }
          }
          const res = schedule(sessionId, 'turn/end:error')
          return { action: 'transient-error-scheduled', failure, ...res }
        }
        return null
      }

      default:
        return null
    }
  }

  function notifyIdleOrInterrupt(sessionId, { kind = 'idle-stall', reason = '', failure = null, immediate = false } = {}) {
    const sid = String(sessionId || '').trim()
    if (!sid) return { scheduled: false, reason: 'no-session' }
    const st = getSessionState(sid)
    if (!st) return { scheduled: false, reason: 'no-session' }
    const rootId = resolveRootSessionId(sid) || sid
    if (isChiefStopped(rootId, sid)) {
      st.stats.skippedStopped += 1
      cancelPending(sid, '参谋长处于停止状态')
      return { scheduled: false, reason: 'chief-stopped' }
    }
    if (failure) {
      st.lastFailure = parseFailureFacts(failure) || null
      if (st.lastFailure && !isTransientFailure(st.lastFailure)) {
        st.stats.skippedPermanent += 1
        return { scheduled: false, reason: 'permanent-error' }
      }
    }
    return schedule(sid, kind, { detail: reason, ...(immediate ? { delayMs: 0 } : {}) })
  }

  function getStats(sessionId = '') {
    if (sessionId) {
      const st = sessions.get(String(sessionId).trim())
      if (!st) return { consecutive: 0, hasPendingTimer: false, stats: { scheduled: 0, sent: 0, skippedPermanent: 0, skippedStopped: 0, skippedAborted: 0 } }
      return {
        consecutive: st.consecutive,
        hasPendingTimer: Boolean(st.timer),
        lastFailure: st.lastFailure,
        lastToolSummary: st.lastToolSummary,
        stats: { ...st.stats },
      }
    }
    return { trackedSessions: sessions.size }
  }

  function dispose() {
    for (const st of sessions.values()) {
      if (st.timer) {
        clearTimeout(st.timer)
        st.timer = null
      }
    }
    sessions.clear()
  }

  return {
    onSessionEvent,
    notifyIdleOrInterrupt,
    cancelSession: cancelPending,
    fireNow: fire,
    getStats,
    dispose,
  }
}
