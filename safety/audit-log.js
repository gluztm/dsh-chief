/**
 * safety/audit-log.js
 *
 * Independent append-only audit ledger (`chief-audit.jsonl`), secret redaction,
 * and structured audit record normalization for DSH Chief.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const SECRET_REDACT_PATTERN = /(?:sk-[a-zA-Z0-9_-]{16,}|ghp_[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|Bearer\s+[A-Za-z0-9._~+/=-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$))/g

let auditIdSeq = 0

function nextAuditId() {
  auditIdSeq = (auditIdSeq + 1) % 1_000_000
  return 'aud-' + Date.now().toString(36) + '-' + auditIdSeq.toString(36)
}

function clampSingleLine(value, max) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  return text.slice(0, Math.max(0, max - 1)) + '…'
}

export function redactAuditText(text, maxLen = 220) {
  const raw = String(text == null ? '' : text)
  if (!raw) return ''
  const redacted = raw.replace(SECRET_REDACT_PATTERN, '[REDACTED]')
  return clampSingleLine(redacted, maxLen)
}

export function auditJsonlPath() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'chief', 'chief-audit.jsonl')
}

export function normalizeAuditRecord(raw, defaultMode = 'advisor') {
  if (!raw || typeof raw !== 'object') return null
  const op = clampSingleLine(raw.operation || raw.tool || '', 80)
  if (!op) return null
  const modeRaw = String(raw.mode || defaultMode || 'advisor').trim().toLowerCase()
  const mode = ['advisor', 'assistant', 'strategist', 'chief'].includes(modeRaw) ? modeRaw : 'advisor'
  const rawDuration = Number(raw.durationMs)
  const durationMs = Number.isFinite(rawDuration) && rawDuration >= 0 ? Math.round(rawDuration) : 0
  const reason = redactAuditText(raw.reason || '', 220)
  const summary = redactAuditText(raw.summary || raw.reason || '', 220)
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : nextAuditId(),
    at: Number(raw.at) || Date.now(),
    mode,
    stage: clampSingleLine(raw.stage || 'executor', 40),
    rule: clampSingleLine(raw.rule || '', 80),
    decision: clampSingleLine(raw.decision || 'executed', 40),
    operation: op,
    target: redactAuditText(raw.target || '', 140),
    summary,
    reason,
    outcome: clampSingleLine(raw.outcome || 'ok', 40),
    durationMs,
    by: clampSingleLine(raw.by || 'chief', 40),
  }
}

export function appendAuditJsonlRecord(record, sessionId = '') {
  try {
    const file = auditJsonlPath()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const payload = sessionId ? { sessionId: String(sessionId), ...record } : record
    fs.appendFileSync(file, JSON.stringify(payload) + '\n', 'utf8')
  } catch {}
}

export function readRecentAuditJsonl({ sessionId = '', limit = 80 } = {}) {
  const file = auditJsonlPath()
  if (!fs.existsSync(file)) return []
  try {
    const raw = fs.readFileSync(file, 'utf8')
    const lines = raw.split(/\r?\n/).filter(Boolean)
    const cap = Math.max(1, Math.min(500, Number(limit) || 80))
    const out = []
    for (let i = lines.length - 1; i >= 0 && out.length < cap; i -= 1) {
      try {
        const parsed = JSON.parse(lines[i])
        if (!parsed || typeof parsed !== 'object') continue
        if (sessionId && parsed.sessionId && parsed.sessionId !== sessionId) continue
        out.push(parsed)
      } catch {}
    }
    return out.reverse()
  } catch {
    return []
  }
}
