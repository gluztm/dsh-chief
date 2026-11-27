/**
 * remote-pager.js — 手机远程传呼与审批推送引擎（飞书 / 钉钉 / 企业微信 / Telegram / Discord / Webhook）
 *
 * 【核心职责】
 *   1. 在用户离家或挂机跑长任务期间，将参谋长的高价值节点告警（待审批/提权、安全拦停、高危急停、托管收工、预算熔断）
 *      与人工主动推送进度，脱敏并格式化送达用户手机端。
 *   2. 监听 `state-schema.js` 的 `pushAlertEventToWs` 事件总线，在不侵入任何原有业务逻辑的情况下实现零耦合自动传呼。
 *   3. 严格脱敏与单向隔离：绝不导入 `chief-state.js`、`index.js` 或 `node:child_process`，任何错误信息均剥离 Webhook / Token / Secret。
 */

import crypto from 'node:crypto'
import {
  clamp,
  normalizePagerConfig,
  redactPagerConfigForUi,
  registerAlertEventListener,
  scrubExternalMemoryText,
} from './state-schema.js'

const pagerRuntimeStats = {
  sentCount: 0,
  failedCount: 0,
  lastChannel: '',
  lastEventKind: '',
  lastSentAt: 0,
  lastLatencyMs: 0,
  lastError: '',
  lastErrorAt: 0,
}

const pagerHolder = {
  configGetter: null,
}

const lastSentByKey = new Map()

export function registerPagerConfigGetter(fn) {
  pagerHolder.configGetter = typeof fn === 'function' ? fn : null
}

export function mapAlertKindToPagerEventKey(kind = '') {
  const k = String(kind || '').trim().toLowerCase()
  if (k === 'pending_approval' || k === 'pending_elevation') return 'approvalRequired'
  if (k === 'guard_wall_blocked' || k === 'safety_guard_blocked') return 'wallBlocked'
  if (k === 'hazard_halt') return 'hazardHalt'
  if (k === 'managed_auto_sleep' || k === 'goal_achieved') return 'taskDone'
  if (k === 'budget_circuit_break') return 'budgetBreak'
  return ''
}

function redactSecretsFromPagerError(rawMsg, cfg = {}) {
  let msg = scrubExternalMemoryText(String(rawMsg == null ? '' : rawMsg))
  for (const sec of [cfg.webhookUrl, cfg.secret, cfg.telegramBotToken]) {
    const s = typeof sec === 'string' ? sec.trim() : ''
    if (s && s.length >= 6) {
      msg = msg.split(s).join('***')
    }
  }
  return msg.replace(/\s+/g, ' ').trim().slice(0, 220)
}

function formatPagerPlainText(cfg, { level = 'info', title = '', body = '', sessionId = '' } = {}) {
  const cleanTitle = clamp(scrubExternalMemoryText(String(title || '').trim()), 140) || '参谋长通知'
  const cleanBody = clamp(scrubExternalMemoryText(String(body || '').trim()), 600)
  const prefix = String(cfg.quietPrefix || '[DSH 参谋长]').trim()
  const badge = level === 'danger' ? '🚨' : (level === 'warn' ? '⚠️' : (level === 'success' ? '✅' : 'ℹ️'))
  const lines = [`${prefix} ${badge} ${cleanTitle}`]
  if (cleanBody) lines.push(cleanBody)
  if (sessionId && sessionId !== 'global') lines.push(`会话：${String(sessionId).slice(0, 48)}`)
  return {
    cleanTitle,
    cleanBody,
    plainText: lines.join('\n'),
  }
}

export function buildPagerRequestPayload(rawCfg, eventSpec = {}) {
  const cfg = normalizePagerConfig(rawCfg)
  const { cleanTitle, cleanBody, plainText } = formatPagerPlainText(cfg, eventSpec)
  const channel = cfg.channel
  const headers = { 'content-type': 'application/json' }
  const kind = String(eventSpec.kind || 'manual').trim() || 'manual'
  const level = String(eventSpec.level || 'info').trim() || 'info'
  const atMs = Number(eventSpec.at) || Date.now()

  if (channel === 'telegram') {
    const base = (cfg.webhookUrl ? cfg.webhookUrl.replace(/\/+$/, '') : '') || 'https://api.telegram.org'
    const url = `${base}/bot${cfg.telegramBotToken}/sendMessage`
    return {
      url,
      headers,
      body: {
        chat_id: cfg.telegramChatId,
        text: plainText,
        disable_web_page_preview: true,
      },
    }
  }

  let url = cfg.webhookUrl
  if (channel === 'feishu') {
    const body = {
      msg_type: 'text',
      content: { text: plainText },
    }
    if (cfg.secret) {
      const ts = String(Math.floor(atMs / 1000))
      const sign = crypto.createHmac('sha256', `${ts}\n${cfg.secret}`).update('').digest('base64')
      body.timestamp = ts
      body.sign = sign
    }
    return { url, headers, body }
  }

  if (channel === 'dingtalk') {
    if (cfg.secret) {
      const ts = String(atMs)
      const sign = encodeURIComponent(
        crypto.createHmac('sha256', cfg.secret).update(`${ts}\n${cfg.secret}`).digest('base64'),
      )
      const sep = url.includes('?') ? '&' : '?'
      url = `${url}${sep}timestamp=${ts}&sign=${sign}`
    }
    const mdText = `### ${cfg.quietPrefix} ${cleanTitle}\n\n${cleanBody || '请回桌面端查看详情'}`
    return {
      url,
      headers,
      body: {
        msgtype: 'markdown',
        markdown: {
          title: `${cfg.quietPrefix} ${cleanTitle}`,
          text: mdText,
        },
      },
    }
  }

  if (channel === 'wecom') {
    const mdContent = `**${cfg.quietPrefix} ${cleanTitle}**${cleanBody ? `\n> ${cleanBody}` : ''}`
    return {
      url,
      headers,
      body: {
        msgtype: 'markdown',
        markdown: { content: mdContent },
      },
    }
  }

  if (channel === 'discord') {
    const colorMap = { danger: 0xef4444, warn: 0xf59e0b, success: 0x10b981, info: 0x6366f1 }
    return {
      url,
      headers,
      body: {
        embeds: [
          {
            title: `${cfg.quietPrefix} ${cleanTitle}`.slice(0, 240),
            description: cleanBody || '（无附加正文）',
            color: colorMap[level] || colorMap.info,
            footer: { text: 'DSH 参谋长 · 远程传呼' },
            timestamp: new Date(atMs).toISOString(),
          },
        ],
      },
    }
  }

  const rawBody = {
    source: 'dsh-chief',
    event: kind,
    level,
    title: cleanTitle,
    body: cleanBody,
    text: plainText,
    sessionId: String(eventSpec.sessionId || ''),
    at: atMs,
  }
  if (cfg.secret) {
    const hexSig = crypto.createHmac('sha256', cfg.secret).update(JSON.stringify(rawBody)).digest('hex')
    headers['x-dsh-chief-signature'] = `sha256=${hexSig}`
  }
  return { url, headers, body: rawBody }
}

function validatePagerChannelCredentials(cfg) {
  if (cfg.channel === 'telegram') {
    if (!cfg.telegramBotToken || !cfg.telegramChatId) {
      return 'Telegram 通道需要同时填写 Bot Token 与 Chat ID'
    }
    return ''
  }
  if (!cfg.webhookUrl) {
    return '尚未填写 Webhook 地址'
  }
  return ''
}

export async function sendRemotePagerMessage(
  rawCfg,
  eventSpec = {},
  { fetchImpl = globalThis.fetch, bypassCooldown = false } = {},
) {
  const cfg = normalizePagerConfig(rawCfg)
  const credErr = validatePagerChannelCredentials(cfg)
  if (credErr) {
    return { ok: false, code: 'MISSING_CONFIG', error: credErr }
  }
  if (typeof fetchImpl !== 'function') {
    return { ok: false, code: 'FETCH_UNAVAILABLE', error: '当前运行环境不支持 HTTP 传呼请求' }
  }

  const now = Date.now()
  const dedupeKey = `${cfg.channel}:${String(eventSpec.dedupeKey || eventSpec.kind || 'manual')}`
  const cooldownMs = Math.max(0, (Number(cfg.cooldownSec) || 15) * 1000)
  if (!bypassCooldown && cooldownMs > 0) {
    const prevAt = Number(lastSentByKey.get(dedupeKey)) || 0
    if (prevAt > 0 && (now - prevAt) < cooldownMs) {
      return { ok: true, skipped: true, reason: 'cooldown' }
    }
  }
  lastSentByKey.set(dedupeKey, now)
  if (lastSentByKey.size > 120) {
    const oldest = lastSentByKey.keys().next().value
    if (oldest) lastSentByKey.delete(oldest)
  }

  const req = buildPagerRequestPayload(cfg, { ...eventSpec, at: eventSpec.at || now })
  const ac = new AbortController()
  const timer = setTimeout(() => {
    try { ac.abort(new Error('timeout')) } catch {}
  }, cfg.timeoutMs || 10000)
  if (timer && typeof timer.unref === 'function') timer.unref()

  const startedAt = Date.now()
  try {
    const resp = await fetchImpl(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: ac.signal,
    })
    if (!resp || !resp.ok) {
      const status = resp ? resp.status : 0
      let errText = ''
      try { errText = resp ? await resp.text() : '' } catch {}
      const cleanErr = redactSecretsFromPagerError(errText, cfg)
      const msg = `传呼通道返回 HTTP ${status || 'network'}${cleanErr ? `：${cleanErr}` : ''}`
      pagerRuntimeStats.failedCount += 1
      pagerRuntimeStats.lastChannel = cfg.channel
      pagerRuntimeStats.lastError = msg
      pagerRuntimeStats.lastErrorAt = Date.now()
      return { ok: false, code: 'UPSTREAM_ERROR', status, error: msg }
    }
    const latencyMs = Math.max(1, Date.now() - startedAt)
    pagerRuntimeStats.sentCount += 1
    pagerRuntimeStats.lastChannel = cfg.channel
    pagerRuntimeStats.lastEventKind = String(eventSpec.kind || 'manual')
    pagerRuntimeStats.lastSentAt = Date.now()
    pagerRuntimeStats.lastLatencyMs = latencyMs
    pagerRuntimeStats.lastError = ''
    pagerRuntimeStats.lastErrorAt = 0
    return {
      ok: true,
      channel: cfg.channel,
      latencyMs,
      sentAt: pagerRuntimeStats.lastSentAt,
    }
  } catch (err) {
    const isTimeout = Boolean(ac.signal.aborted) || /abort|timeout/i.test(String(err && err.message ? err.message : err))
    const msg = isTimeout
      ? `传呼推送超时（超过 ${Math.round((cfg.timeoutMs || 10000) / 1000)} 秒）`
      : `传呼推送失败：${redactSecretsFromPagerError(err && err.message ? err.message : err, cfg)}`
    pagerRuntimeStats.failedCount += 1
    pagerRuntimeStats.lastChannel = cfg.channel
    pagerRuntimeStats.lastError = msg
    pagerRuntimeStats.lastErrorAt = Date.now()
    return { ok: false, code: isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR', error: msg }
  } finally {
    clearTimeout(timer)
  }
}

export async function testRemotePager(rawCfg, { text = '', fetchImpl = globalThis.fetch } = {}) {
  const sample = String(text || '').trim() || '手机远程传呼通道已连通！挂机遇到待批弹窗、安全拦截或任务收工时，我会第一时间传呼你。'
  return sendRemotePagerMessage(
    rawCfg,
    {
      kind: 'test',
      level: 'success',
      title: '远程传呼测试消息',
      body: sample,
      dedupeKey: `test:${Date.now()}`,
    },
    { fetchImpl, bypassCooldown: true },
  )
}

export function getRemotePagerStatus(rawCfg = null) {
  return {
    ok: true,
    pager: redactPagerConfigForUi(rawCfg),
    runtime: { ...pagerRuntimeStats },
  }
}

export function resetPagerRuntimeForTest() {
  lastSentByKey.clear()
  pagerRuntimeStats.sentCount = 0
  pagerRuntimeStats.failedCount = 0
  pagerRuntimeStats.lastChannel = ''
  pagerRuntimeStats.lastEventKind = ''
  pagerRuntimeStats.lastSentAt = 0
  pagerRuntimeStats.lastLatencyMs = 0
  pagerRuntimeStats.lastError = ''
  pagerRuntimeStats.lastErrorAt = 0
}

registerAlertEventListener((alertEv, ws) => {
  try {
    if (!pagerHolder.configGetter || !alertEv) return
    const rawCfg = pagerHolder.configGetter()
    const cfg = normalizePagerConfig(rawCfg)
    if (!cfg.enabled) return
    const eventKey = mapAlertKindToPagerEventKey(alertEv.kind)
    if (!eventKey || !cfg.events[eventKey]) return
    void sendRemotePagerMessage(cfg, {
      ...alertEv,
      sessionId: (ws && ws.sessionId) || '',
    }).catch(() => {})
  } catch {}
})
