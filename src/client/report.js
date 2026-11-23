/**
 * src/client/report.js
 *
 * Clean Markdown session retrospective & debrief report builder with secret redaction
 * and browser `.md` download helper.
 */

import { getUiLang, statusLabel, permLabel, runModeMeta } from './i18n.js'
import { shortSession, shortAgentName, timeLabel } from './utils.js'

const REPORT_SECRET_RE = /(?:sk-[a-zA-Z0-9_-]{16,}|ghp_[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|Bearer\s+[A-Za-z0-9._~+/=-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----|-----BEGIN [A-Z ]*PRIVATE KEY-----)/g

/** Redact credential-like tokens before exporting or copying Markdown reports. */
export function redactReportSecrets(text) {
  return String(text == null ? '' : text).replace(REPORT_SECRET_RE, '[REDACTED]')
}

function fmtTokenCount(n) {
  const num = Math.max(0, Math.round(Number(n) || 0))
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(2).replace(/\.00$/, '') + 'M'
  if (num >= 1_000) return (num / 1_000).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(num)
}

/** Build a structured Markdown retrospective report from current board, Chief digest, bounds & LLM ledger. */
export function buildSessionReportMarkdown({
  board = null,
  secView = null,
  chiefMeta = null,
  subagents = [],
  guardWalls = [],
  sessionId = '',
  lang = '',
} = {}) {
  const useEn = (lang ? lang === 'en' : getUiLang() === 'en')
  const L = (zh, en) => (useEn ? en : zh)
  const b = board && typeof board === 'object' ? board : {}
  const sec = secView && typeof secView === 'object' ? secView : {}
  const meta = chiefMeta && typeof chiefMeta === 'object' ? chiefMeta : {}

  const steps = Array.isArray(b.plan) ? b.plan.filter(s => s && s.text) : []
  const tasks = Array.isArray(b.tasks) ? b.tasks.filter(Boolean) : []
  const bounds = (b.bounds && typeof b.bounds === 'object') ? b.bounds : {}
  const facts = Array.isArray(sec.facts) ? sec.facts : []
  const narText = (sec.narrative && typeof sec.narrative.text === 'string') ? sec.narrative.text.trim() : ''
  const ledger = (sec.llmLedger || meta.llmLedgerSummary || {})
  const byCat = ledger.byCategory || {}
  const mr = ledger.managedRun || {}
  const activeWalls = (Array.isArray(guardWalls) ? guardWalls : []).filter(w => w && w.activeNow)
  const workers = (Array.isArray(subagents) ? subagents : []).filter(a => a && a.name && a.name !== 'lead')

  const doneSteps = steps.filter(s => s.done).length
  const doneTasks = tasks.filter(t => t.status === 'done')
  const doingTasks = tasks.filter(t => t.status === 'doing')
  const blockedTasks = tasks.filter(t => t.status === 'blocked')
  const todoTasks = tasks.filter(t => t.status === 'todo')

  const nowStr = new Date().toLocaleString(useEn ? 'en-US' : 'zh-CN', { hour12: false })
  const permStr = permLabel(meta.permissionMode || 'advisor')
  const runStr = runModeMeta(meta.runMode || 'off').label
  const sessLabel = sessionId ? shortSession(sessionId) : L('未绑定会话', 'Unbound')

  const lines = []
  lines.push(`# ${L('DSH 参谋长 · 任务复盘战报', 'DSH Chief · Session Retrospective Report')}`)
  lines.push('')
  lines.push(`- **${L('当前会话', 'Session')}**: \`${sessLabel}\``)
  lines.push(`- **${L('导出时间', 'Generated')}**: ${nowStr}`)
  lines.push(`- **${L('模式与权限', 'Mode & Tier')}**: ${runStr} · ${permStr}`)
  lines.push(`- **${L('总目标', 'Main Goal')}**: ${b.objective ? String(b.objective).trim() : L('（还没定总目标）', '(Not set)')}`)
  if (b.goalApproval && b.goalApproval.status === 'approved') {
    lines.push(`- **${L('结项状态', 'Goal Status')}**: ✅ ${L('已批准结项', 'Approved')}`)
  } else if (b.mode === 'goal') {
    lines.push(`- **${L('结项状态', 'Goal Status')}**: 🎯 ${L('正在按目标推进', 'Working toward goal')}`)
  }
  lines.push('')

  // Section 1: Planning Pipeline Progress
  lines.push(`## ${L('一、推进步骤', '1. Plan Steps')} (${doneSteps}/${steps.length})`)
  if (steps.length > 0) {
    steps.forEach((s, idx) => {
      const icon = s.done ? '✅' : (b.cursor && b.cursor.step && s.text.includes(b.cursor.step) ? '🔵' : '⬜')
      lines.push(`- ${icon} **${L(`步骤 ${idx + 1}`, `Step ${idx + 1}`)}**: ${s.text}${s.summary ? ` — *${s.summary}*` : ''}`)
    })
  } else {
    lines.push(`- ${L('还没有列出计划步骤。', 'No plan steps yet.')}`)
  }
  lines.push('')

  // Section 2: Tasks & Verified Evidence
  lines.push(`## ${L('二、任务进度和结果', '2. Tasks & Results')} (${doneTasks.length}/${tasks.length} ${L('已完成', 'Done')})`)
  const pushTaskGroup = (title, list) => {
    if (!list.length) return
    lines.push(`### ${title} (${list.length})`)
    for (const t of list) {
      const owner = t.subagent || t.owner
      const ownerTag = owner ? ` (@${shortAgentName(owner)})` : ''
      lines.push(`- **${t.title}**${ownerTag} [${statusLabel(t.status)}]`)
      if (t.evidence) lines.push(`  - ${L('结果说明', 'Evidence')}: ${t.evidence}`)
      if (t.note && t.status !== 'done') lines.push(`  - ${L('备注/卡点', 'Note')}: ${t.note}`)
    }
    lines.push('')
  }
  if (tasks.length > 0) {
    pushTaskGroup(L('受阻任务', 'Blocked'), blockedTasks)
    pushTaskGroup(L('推进中', 'In Progress'), doingTasks)
    pushTaskGroup(L('已完成', 'Completed'), doneTasks)
    pushTaskGroup(L('待推进', 'To Do'), todoTasks)
  } else {
    lines.push(`- ${L('任务列表是空的。', 'No tasks yet.')}`, '')
  }

  // Section 3: Subagents snapshot
  if (workers.length > 0) {
    lines.push(`## ${L('三、协作成员情况', '3. Subagents')} (${workers.length})`)
    for (const w of workers.slice(0, 16)) {
      const stateIcon = w.status === 'running' ? '🔵' : (w.status === 'error' ? '🔴' : '🟢')
      lines.push(`- ${stateIcon} \`@${shortAgentName(w.name)}\` — ${w.status || 'idle'}${w.updatedAt ? ` (${timeLabel(w.updatedAt)})` : ''}`)
    }
    lines.push('')
  }

  // Section 4: Chief Situation Digest
  if (narText) {
    lines.push(`## ${L('四、当前进度摘要', '4. Progress Summary')}`)
    lines.push(narText)
    lines.push('')
  }

  // Section 5: Disciplines, Facts & Boundaries
  const allowed = Array.isArray(bounds.allowed) ? bounds.allowed : []
  const forbidden = Array.isArray(bounds.forbidden) ? bounds.forbidden : []
  const notes = Array.isArray(bounds.notes) ? bounds.notes : []
  if (facts.length > 0 || allowed.length > 0 || forbidden.length > 0 || notes.length > 0 || activeWalls.length > 0) {
    lines.push(`## ${L('五、重要记事和规则', '5. Notes & Rules')}`)
    for (const f of facts.slice(0, 15)) {
      lines.push(`- **[${f.category || 'fact'}]** ${f.text}`)
    }
    for (const item of forbidden) lines.push(`- 🚫 **${L('不要做', 'Don\'t Do')}**: ${item}`)
    for (const item of allowed) lines.push(`- ✅ **${L('必须做', 'Must Do')}**: ${item}`)
    for (const item of notes) lines.push(`- 💡 **${L('注意', 'Watchout')}**: ${item}`)
    for (const w of activeWalls.slice(0, 12)) {
      lines.push(`- 🚧 **${L('自定义拦截规则', 'Custom Block Rule')}** [${w.ruleType}]: ${w.title}`)
    }
    lines.push('')
  }

  // Section 6: Chief LLM Ledger & Budget Status
  lines.push(`## ${L('六、模型用量与托管上限', '6. Model Usage & Budget')}`)
  lines.push(`- **${L('累计用量', 'Total used')}**: ${ledger.totalCalls || 0} ${L('次', 'calls')} · ${fmtTokenCount(ledger.totalTokens || 0)} tokens (${L('输入', 'in')} ${fmtTokenCount(ledger.totalInputTokens || 0)} / ${L('输出', 'out')} ${fmtTokenCount(ledger.totalOutputTokens || 0)})`)
  lines.push(`- **${L('分类明细', 'Breakdown')}**: ${L('问答', 'Q&A')} ${byCat.chat?.calls || 0} (${fmtTokenCount(byCat.chat?.tokens || 0)}) · ${L('巡检', 'Patrol')} ${byCat.review?.calls || 0} (${fmtTokenCount(byCat.review?.tokens || 0)}) · ${L('梦境漫游', 'Dream Roam')} ${byCat.dream?.calls || 0} (${fmtTokenCount(byCat.dream?.tokens || 0)})`)
  const maxCalls = ledger.budget?.maxCalls ?? meta.managedBudgetMaxCalls ?? 30
  const maxTokens = ledger.budget?.maxTokens ?? meta.managedBudgetMaxTokens ?? 300_000
  lines.push(`- **${L('本次托管用量', 'This Managed Run')}**: ${mr.calls || 0}/${maxCalls || '∞'} ${L('次', 'calls')} · ${fmtTokenCount(mr.tokens || 0)}/${maxTokens ? fmtTokenCount(maxTokens) : '∞'} tokens${mr.tripped ? ` (**🛑 ${L('已达上限并自动停下', 'Budget limit reached')}: ${mr.trippedReason || ''}**)` : ''}`)
  lines.push('')

  return redactReportSecrets(lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n')
}

/** Trigger browser file download of a clean `.md` retrospective report. */
export function downloadSessionReportMarkdown(mdText, sessionId = '') {
  const safeText = redactReportSecrets(mdText || '')
  const d = new Date()
  const stamp = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('') + '-' + [
    String(d.getHours()).padStart(2, '0'),
    String(d.getMinutes()).padStart(2, '0'),
  ].join('')
  const sidPart = sessionId ? ('-' + shortSession(sessionId).replace(/[^a-zA-Z0-9_-]/g, '')) : ''
  const filename = `dsh-chief-report${sidPart}-${stamp}.md`

  try {
    if (
      typeof document === 'undefined'
      || !document.body
      || typeof document.createElement !== 'function'
      || typeof Blob === 'undefined'
      || typeof URL === 'undefined'
      || typeof URL.createObjectURL !== 'function'
    ) {
      return { ok: false, fallbackCopy: true, filename }
    }
    const blob = new Blob([safeText], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
    if (typeof setTimeout === 'function' && typeof URL.revokeObjectURL === 'function') {
      const tid = setTimeout(() => {
        try { URL.revokeObjectURL(url) } catch {}
      }, 1500)
      if (tid && typeof tid.unref === 'function') tid.unref()
    }
    return { ok: true, filename }
  } catch {
    return { ok: false, fallbackCopy: true, filename }
  }
}
