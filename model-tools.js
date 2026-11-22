/**
 * model-tools.js
 *
 * Model tool definitions and execution handlers (chief_board, chief_memory, chief_boundaries, chief_handoff).
 */

import { MEMORY_SECTIONS } from './memory.js'
import {
  listPeerDirectory,
  deliverCrossMessage,
  requestSmartCompactFromLead,
  proposeBoundToChief,
  readMailboxForAgent,
  requestChiefElevation,
  appendChiefAuditLog,
  CHIEF_PERMISSION_META,
} from './chief.js'
import { normalizePermissionMode } from './chief-executor.js'
import { computeBubbleState } from './chief-network.js'

function summarizeBubbleSnapshot(secDeps, rootId, dir) {
  try {
    const rid = rootId || 'global'
    const b = computeBubbleState(secDeps, rid, null, dir || null)
    const clusterLen = Array.isArray(dir && dir.cluster) ? dir.cluster.length : 0
    const linkedPeersCount = clusterLen > 0
      ? Math.max(0, clusterLen - 1)
      : (Array.isArray(dir && dir.targets) ? dir.targets.filter(t => t && t.kind === 'peer-session').length : 0)
    return {
      locked: Boolean(b && b.locked),
      enrolledHarnesses: (Array.isArray(b && b.enrolledHarnesses) ? b.enrolledHarnesses : []).map(h => ({
        provider: h.provider,
        label: h.label || h.provider,
        role: h.role || h.roleHint || '',
        installed: h.installed !== false,
        configured: Boolean(h.configured),
        running: Boolean(h.running),
      })),
      availableHarnesses: (Array.isArray(b && b.availableHarnesses) ? b.availableHarnesses : [])
        .filter(h => h && h.installed !== false)
        .map(h => ({
          provider: h.provider,
          label: h.label || h.provider,
          role: h.role || h.roleHint || '',
          configured: Boolean(h.configured),
        })),
      linkedPeersCount,
    }
  } catch {
    return { locked: false, enrolledHarnesses: [], availableHarnesses: [], linkedPeersCount: 0 }
  }
}
import {
  STATUSES,
  PRIORITIES,
  nowMs,
  emptyBoard,
  str,
  asBool,
  normalizeBoundFieldName,
  BOUND_CAP,
  pushLog,
  summary,
} from './board-schema.js'

export function createModelTools(deps) {

  const boardFileFor = (...args) => deps.boardFileFor(...args)
  const boardForSession = (...args) => deps.boardForSession(...args)
  const boundaries = (...args) => deps.boundaries(...args)
  const executeSubagentAction = (...args) => deps.executeSubagentAction(...args)
  const fetchTeamTasks = (...args) => deps.fetchTeamTasks(...args)
  const loadBoard = (...args) => deps.loadBoard(...args)
  const makeChiefDeps = (...args) => deps.makeChiefDeps(...args)
  const refreshSubagentTree = (...args) => deps.refreshSubagentTree(...args)
  const resolveAgentIdentity = (...args) => deps.resolveAgentIdentity(...args)
  const resolveEffectiveHandoff = (...args) => deps.resolveEffectiveHandoff(...args)
  const resolveRootSessionId = (...args) => deps.resolveRootSessionId(...args)
  const runAction = (...args) => deps.runAction(...args)
  const saveBoard = (...args) => deps.saveBoard(...args)
  const transferChief = (...args) => deps.transferChief(...args)
  const withBoardLock = (...args) => deps.withBoardLock(...args)

  /* ----------------------------------------------------------------------- tools */

  const BOARD_PARAMETERS = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'snapshot',
          'graph.plan',
          'task.batch',
          'task.add',
          'task.update',
          'task.claim',
          'task.release',
          'task.remove',
          'task.verify',
          'task.dispatch',
          'team.steer',
          'team.interrupt',
          'team.list',
          'mail.send',
          'mail.inbox',
          'plan.set',
          'objective.set',
          'mode.set',
          'bounds.propose',
          'bounds.add',
          'bounds.pin',
          'bounds.remove',
          'bounds.edit',
          'bounds.consolidate',
          'bounds.set',
          'settings.set',
          'handoff.mark',
          'cursor.set',
          'log.add',
          'note.add',
          'note.write',
          'note.pin',
          'note.unpin',
          'note.remove',
          'note.read',
          'archive.search',
          'archive.pull',
          'archive.read',
          'archive.save',
          'context.compact',
          'permission.request',
          'inquiry.reply',
          'chief.request',
          'wall.list',
          'memory.add',
          'memory.remove',
          'memory.ask',
        ],
        description:
          'Board operation (MUST be called whenever recording tasks/status/conclusions or relaying messages; plain text alone does NOT update the board or notify peers). '
          + 'Use "graph.plan" (or "task.batch") to plan a hierarchical/DAG task graph in one call (supports parentId, blockedBy, planStepId, targetPlanStepId, owner/subagent, intent, evidence). '
          + 'For multi-step workflows, define ordered steps via "plan.set" first and bind tasks/subagents with "planStepId" (and optional "targetPlanStepId") so the workflow topology displays step-by-step progress and subagent return arrows. '
          + 'Use "task.dispatch" to spawn or message a subagent, "team.steer" to steer a subagent, and "mail.send" to relay messages or dispatch work across lead/subagents/linked sessions/enrolled Bubble harnesses (pass provider id as target). '
          + 'Use "inquiry.reply" (inquiryId, text) whenever you see a priority [INQUIRY #id] from DSH Chief — answer accurately and continue your current work immediately without stopping. '
          + 'Use "chief.request" (subject, text) to ask DSH Chief for cross-session coordination, permission elevation, to report exploration & planning results, or when blocked by an insurmountable guard wall that cannot be bypassed safely. '
          + 'Use "wall.list" (read-only) to inspect currently active persistent guard walls defending high-risk paths/commands. '
          + 'Use "bounds.propose" (field: "forbidden"|"allowed"|"notes", item, reason) when hitting a permission/sandbox/environment wall or summarizing boundaries ("allowed" = 必做事项, "forbidden" = 禁止红线, "notes" = 注意事项) so DSH Chief can request user approval. '
          + 'Use "permission.request" (targetMode: "assistant"|"strategist"|"chief", reason) when requesting higher DSH Chief permission tier from the user. '
          + 'Session Engineering Archives ("archive.search", "archive.pull", "archive.read", "archive.save") access ONLY the current conversation\'s Session Cabinet (never Global Cabinet or unflipped Precipitated cold vault). '
          + 'When you see a hook 🪝 in the digest, call "archive.pull" (with id or title) to read that curated dossier on demand. '
          + 'When Smart Co-Managed Compaction ("✦ 智选") is enabled, call "context.compact" with a concise phase-summary in "text" at clean phase boundaries to ask DSH Chief to harvest details into this session\'s cabinet and compact.',
      },
      tasks: {
        type: 'array',
        description: 'graph.plan / task.batch: array of task nodes to create or update in the DAG. Items may reference each other via id/key in parentId and blockedBy.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Task id or temporary symbolic key (e.g. "t1", "api-design") referenced by parentId or blockedBy.' },
            title: { type: 'string', description: 'Short task title.' },
            parentId: { type: 'string', description: 'Parent task id/key for hierarchical decomposition.' },
            planStepId: { type: 'string', description: 'Optional plan step id (from board.plan) this task or subagent branch belongs to; auto-binds to the current active step if omitted.' },
            targetPlanStepId: { type: 'string', description: 'Optional plan step id that this task/subagent reports back to upon completion (defaults to planStepId; set to a later step for cross-step handoff).' },
            blockedBy: { type: 'array', items: { type: 'string' }, description: 'Upstream task ids/keys that must finish (done) before this task unlocks.' },
            owner: { type: 'string', description: 'Assigned subagent name (e.g. "researcher", "coder", "verifier") or owner.' },
            subagent: { type: 'string', description: 'Subagent name to bind to this task.' },
            preset: { type: 'string', description: 'Optional subagent provider/preset ("spawn", "fork", or preset id).' },
            intent: { type: 'string', description: 'Why this task exists / goal.' },
            evidence: { type: 'string', description: 'Verification criteria (before done) or verification proof (when done).' },
            note: { type: 'string', description: 'Detailed notes or context.' },
            priority: { type: 'string', enum: PRIORITIES },
            status: { type: 'string', enum: STATUSES },
            assumption: { type: 'string', description: 'Optional assumption to track and verify.' },
          },
          required: ['title'],
          additionalProperties: false,
        },
      },
      replace: {
        type: 'boolean',
        description: 'graph.plan: when true, replaces existing tasks instead of merging.',
      },
      agent: {
        type: 'string',
        description: 'task.dispatch / team.steer / team.interrupt: target subagent name (e.g. "coder", "reviewer").',
      },
      subagent: {
        type: 'string',
        description: 'Alias for agent/owner on task operations.',
      },
      provider: {
        type: 'string',
        enum: ['spawn', 'fork'],
        description: 'task.dispatch: subagent provider ("spawn" for fresh context, "fork" to inherit conversation history). Default "spawn".',
      },
      preset: {
        type: 'string',
        description: 'task.dispatch / task.add: optional agent_preset for the child subagent.',
      },
      prompt: {
        type: 'string',
        description: 'task.dispatch / team.steer: extra instructions or steering message delivered to the subagent.',
      },
      message: {
        type: 'string',
        description: 'team.steer: message to deliver to the target subagent.',
      },
      force: {
        type: 'boolean',
        description: 'task.dispatch: when true, dispatch even if upstream blockedBy tasks are not done yet.',
      },
      mode: {
        type: 'string',
        enum: ['plan', 'goal'],
        description: 'mode.set: how this board is run. plan = a list of steps being ticked off. goal = one persistent objective steered toward.',
      },
      id: { type: 'string', description: 'Task id for update/claim/release/remove/dispatch/verify, or archive id for archive.pull / archive.read / archive.save.' },
      inquiryId: { type: 'string', description: 'Inquiry id (e.g. inq_xxx) when action is "inquiry.reply".' },
      noteId: { type: 'string', description: 'Note id for note.write / note.pin / note.unpin / note.remove; omit to create a new note.' },
      archiveId: { type: 'string', description: 'Archive dossier id for archive.pull / archive.read / archive.save (on-demand session cabinet lookup/pull).' },
      query: { type: 'string', description: 'Keyword query for archive.search (searched only on explicit user demand).' },
      folder: { type: 'string', description: 'Filing cabinet drawer id for archive.search / archive.save (coords / incidents / contracts / ops / plans / inbox).' },
      paperclip: { type: 'string', enum: ['gold', 'silver', 'copper'], description: 'Paperclip importance badge for archive.save ("gold" anchor, "silver" verified, "copper" historical).' },
      summary: { type: 'string', description: 'Concise 1-line summary for archive.save.' },
      points: {
        type: 'array',
        description: 'Structured memory points for archive.save: [{ title, cue?, detail }].',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            cue: { type: 'string' },
            detail: { type: 'string' },
          },
          required: ['title', 'detail'],
          additionalProperties: false,
        },
      },
      step: { type: 'string', description: 'cursor.set: which plan step is open right now, in your own words.' },
      next: { type: 'string', description: 'cursor.set: the very next action — concrete enough to execute without re-reading the transcript.' },
      blocked: { type: 'string', description: 'cursor.set: ONLY fill when execution is genuinely stalled/cannot proceed (e.g. missing credentials, permission denied, unresolved error). MUST pass empty string "" when not blocked — NEVER put "无", "none", user preferences/rules, or resolved notes here.' },
      clear: { type: 'boolean', description: 'cursor.set: wipe step / next / blocked instead of overwriting them.' },
      expectedTaskId: { type: 'string', description: 'cursor.set: task id this cursor is working on — the panel highlights that node in the tree.' },
      memoryId: { type: 'string', description: 'Memory entry id for memory.remove.' },
      question: { type: 'string', description: 'Question for memory.ask; answered only from what this conversation already recorded.' },
      section: {
        type: 'string',
        enum: ['progress', 'decision', 'verify', 'open', 'other'],
        description: 'Memory section for memory.add: progress / decision / verify / open / other.',
      },
      body: { type: 'string', description: 'Note body, Markdown allowed.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Note tags.' },
      pinned: { type: 'boolean', description: 'note.write: mark this note pinned (anchor); bounds.add / bounds.pin / bounds.consolidate: when true, pin boundary globally across ALL tasks/sessions (📌); when false, keep boundary scoped to current task only.' },
      title: { type: 'string', description: 'Task title for task.add (or a rename in task.update); note.write: the note headline.' },
      note: { type: 'string', description: 'Free-form detail for the task.' },
      owner: { type: 'string', description: 'task.add / task.claim: who holds this task; defaults to the caller.' },
      intent: { type: 'string', description: 'task.add / task.update: why this task exists — the reason that survives a compaction.' },
      evidence: { type: 'string', description: 'task.add / task.update: what would prove it done — a command, a file, a probe name.' },
      blockedBy: { type: 'array', items: { type: 'string' }, description: 'task.add / task.update: task ids this task waits on — claim refuses while any of them is not done.' },
      assumption: { type: 'string', description: 'task.add / task.update: record an assumption you are making — stays visible until task.verify marks it true.' },
      assumptionIndex: { type: 'number', description: 'task.verify: which assumption (0-based) to mark as verified.' },
      taskId: { type: 'string', description: 'task id for task.update / task.claim / task.release / task.remove / task.verify / task.dispatch (alias for id).' },
      target: { type: 'string', description: 'task.add / task.update / task.dispatch: who this task is assigned to — visible in tree view as owner label.' },
      parentId: { type: 'string', description: 'task.add / task.update: parent task id for tree hierarchy — renders the child indented under its parent.' },
      planStepId: { type: 'string', description: 'task.add / task.update / task.dispatch: optional plan step id (from board.plan) this task or subagent belongs to; auto-binds to the current active step if omitted.' },
      targetPlanStepId: { type: 'string', description: 'task.add / task.update / task.dispatch: optional plan step id that this task/subagent reports back to upon completion (defaults to planStepId).' },
      status: { type: 'string', enum: STATUSES, description: 'Task status.' },
      priority: { type: 'string', enum: PRIORITIES, description: 'Task priority.' },
      field: {
        type: 'string',
        enum: ['allowed', 'must', 'forbidden', 'notes'],
        description: 'bounds.propose / bounds.set: target boundary column ("forbidden" = 禁止红线, "allowed"/"must" = 必做事项, or "notes" = 注意事项).',
      },
      item: { type: 'string', description: 'bounds.propose / bounds.add / bounds.pin / bounds.remove / bounds.edit / bounds.consolidate: boundary rule text.' },
      oldItem: { type: 'string', description: 'bounds.edit: existing boundary rule text to replace.' },
      removeItems: { type: 'array', items: { type: 'string' }, description: 'bounds.consolidate: scattered boundary rules to remove and replace with item.' },
      reason: { type: 'string', description: 'bounds.propose / permission.request: justification for why this boundary or permission tier is needed.' },
      targetMode: { type: 'string', enum: ['assistant', 'strategist', 'chief'], description: 'permission.request: requested DSH Chief permission tier.' },
      items: { type: 'array', items: { type: 'string' }, description: 'bounds.propose (multiple rules) or bounds.set (new contents of column named by field).' },
      allowed: { type: 'array', items: { type: 'string' }, description: 'bounds.set: the whole 必做 (allowed) column.' },
      forbidden: { type: 'array', items: { type: 'string' }, description: 'bounds.set: the whole 禁止 column.' },
      notes: { type: 'array', items: { type: 'string' }, description: 'bounds.set: the whole 注意 column.' },
      autoInject: { type: 'boolean', description: 'settings.set: hand the digest to every turn of this machine.' },
      guardIdle: { type: 'boolean', description: 'settings.set: keep steering a turn that closes without doing anything.' },
      guardMaxPerSession: { type: 'number', description: 'settings.set: how many nudges one Session may take before the guard goes quiet (0-20, default 3).' },
      guardShortAnswer: { type: 'number', description: 'settings.set: the answer length below which a silent turn counts as an idle close (0-10000, default 600).' },
      objective: { type: 'string', description: 'The plan objective for plan.set / graph.plan / objective.set.' },
      steps: {
        type: 'array',
        description: 'Ordered plan steps for plan.set; each step is { id?, text, done }.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Existing step id from the board; omit for a new step.' },
            text: { type: 'string' },
            done: { type: 'boolean' },
          },
          required: ['text'],
          additionalProperties: false,
        },
      },
      text: { type: 'string', description: 'One handoff log line for log.add, or message text for team.steer / mail.send.' },
      subject: { type: 'string', description: 'mail.send: optional short subject line.' },
      delivery: {
        type: 'string',
        enum: ['steer', 'followup', 'silent'],
        description: 'mail.send: delivery posture ("steer" cuts into next step boundary, "followup" queues/wakes next turn, "silent" drops into chief inbox for next pre-step).',
      },
      unreadOnly: { type: 'boolean', description: 'mail.inbox: when true, returns only unread messages.' },
      reasoningEffort: {
        type: 'string',
        enum: ['off', 'low', 'medium', 'high', 'xhigh'],
        description: 'task.dispatch: optional model reasoning effort hint (respects user 🔒 lock).',
      },
      by: { type: 'string', description: 'Who acts: an agent label or a user name. Defaults to "agent".' },
      session: { type: 'string', description: 'Session id that owns the change; the GUI fills it automatically.' },
      scope: { type: 'string', enum: ['session', 'shared'], description: 'Board to hit. Default "session" = the caller\'s own (or root tree) board; "shared" = the machine-wide anchor board.' },
    },
    required: ['action'],
    additionalProperties: false,
  }

  function boardTool(runtime) {
    return {
      name: 'chief_board',
      description:
        'Shared task graph, subagent team controller, cross-session communication bus, plan, and anchor chief (参谋看板, coordinated by DSH 参谋长). '
        + 'MANDATORY DISCIPLINE: (1) Always call this tool to record objectives, task status changes (doing/blocked/done + evidence), or pinned conclusions — oral text alone counts as NOT recorded. '
        + '(2) Always call "mail.send", "task.dispatch", or "team.steer" when relaying information or delegating across lead/subagents/sessions — oral @mentions do NOT reach peers. '
        + '(3) When you hit a permission/sandbox/environment wall or are asked to summarize boundaries, call action="bounds.propose" (field="forbidden"|"allowed"|"notes", item, reason; note "allowed" represents 必做事项) to submit to DSH Chief (宰相), who requests user approval before injecting into global bounds.',
      parameters: BOARD_PARAMETERS,
      output: {
        schema: { type: 'object', description: 'The board summary after the operation.' },
        render(_args, value) {
          const view = value && typeof value === 'object' ? value : {}
          const lines = []
          if (view.ok === false) {
            lines.push('failed: ' + String(view.error))
            if (/bounds list too long/.test(String(view.error))) lines.push('bounds: one column holds at most ' + BOUND_CAP + ' entries')
          }
          if (view.archiveSearch) {
            const hits = Array.isArray(view.archiveSearch.hits) ? view.archiveSearch.hits : []
            lines.push('🗄️ archive search (' + hits.length + ' / ' + (view.archiveSearch.totalArchives || 0) + ' cold dossiers):')
            for (const h of hits) {
              lines.push('  📎 [' + h.folderLabel + '] «' + h.title + '» (' + h.id + ') — ' + h.summary)
            }
            if (!hits.length) lines.push('  (no matching cold archives)')
          }
          if (view.archiveItem) {
            const it = view.archiveItem
            const hooks = Array.isArray(it.hookKeywords) && it.hookKeywords.length ? ` 🪝[${it.hookKeywords.join(' · ')}]` : ''
            const pulledTag = Array.isArray(it.leadPulledSessions) && it.leadPulledSessions.length ? ' · 📖 主代理已拉阅' : ''
            lines.push('📎 archive «' + it.title + '» [' + it.folder + ' · ' + it.paperclip + pulledTag + '] (' + it.id + ')' + hooks)
            if (it.hookCue) lines.push('hookCue: ' + it.hookCue)
            lines.push('summary: ' + (it.summary || ''))
            for (const pt of Array.isArray(it.points) ? it.points : []) {
              lines.push('  • ' + pt.title + ': ' + (pt.detail || pt.cue || ''))
            }
            if (it.body) lines.push('--- raw body ---\n' + it.body)
          }
          if (view.archiveSaved) {
            lines.push('🗄️ archived dossier «' + view.archiveSaved.title + '» → drawer [' + view.archiveSaved.folder + '] (' + view.archiveSaved.id + ', cold-sealed)')
          }
          if (view.mailDelivered) {
            lines.push('📨 mail delivered → ' + view.mailDelivered.target + ' (' + view.mailDelivered.mode + ')')
          }
          if (view.boundProposed) {
            lines.push('🏛 ' + view.boundProposed.message)
            for (const p of view.boundProposed.proposed || []) {
              lines.push('  [' + p.field + '] ' + p.item + ' (by ' + p.from + ')')
            }
          }
          if (view.elevationRequested) {
            const elv = view.elevationRequested
            const tgt = CHIEF_PERMISSION_META[elv.targetMode] || {}
            lines.push(`🔐 elevation requested → ${tgt.level || ''} ${tgt.title || elv.targetMode}: ${elv.reason || ''}`)
          } else if (view.elevationMessage) {
            lines.push('🔐 ' + view.elevationMessage)
          }
          if (Array.isArray(view.inbox)) {
            lines.push('📬 mailbox (' + view.inbox.length + ' messages):')
            for (const m of view.inbox.slice(-10)) {
              lines.push('  ' + (m.unread ? '[NEW] ' : '') + m.from + ' → ' + m.to + (m.subject ? ' (' + m.subject + ')' : '') + ': ' + String(m.text || '').slice(0, 140))
            }
            if (Array.isArray(view.peers) && view.peers.length) {
              lines.push('📡 addressable peers: ' + view.peers.map(p => p.handle + '[' + p.status + ']').join(' · '))
            }
          }
          if (view.dispatched) {
            lines.push('🚀 dispatched task #' + view.dispatched.taskId + ' → subagent ' + view.dispatched.agent + ' (' + view.dispatched.mode + ')')
          }
          if (view.interrupted) {
            lines.push('⏹ interrupted subagent ' + view.interrupted)
          }
          if (view.messageId && view.agent) {
            lines.push('💬 steered subagent ' + view.agent + ' (messageId: ' + view.messageId + ')')
          }
          const subagents = Array.isArray(view.subagents) ? view.subagents.filter(a => a && a.name !== 'lead') : []
          if (subagents.length) {
            lines.push('子代理团队 (' + subagents.length + '): ' + subagents.map(a => a.name + '[' + a.status + ']').join(' · '))
          }
          const teamTasks = Array.isArray(view.teamTasks) ? view.teamTasks : []
          if (teamTasks.length) {
            lines.push('团队共享任务 ' + teamTasks.length + ' 项：')
            for (const t of teamTasks) {
              const st = t.status === 'in_progress' ? 'doing' : t.status === 'completed' ? 'done' : t.status
              lines.push('  [' + st + '] ' + t.id + ' ' + t.subject + (t.owner ? ' → ' + t.owner : '') + (t.blockedBy.length ? ' [等 ' + t.blockedBy.join(',') + ']' : ''))
            }
          }
          const counts = view.counts || {}
          lines.push('todo ' + (counts.todo || 0) + ' / doing ' + (counts.doing || 0) + ' / blocked ' + (counts.blocked || 0) + ' / done ' + (counts.done || 0))
          for (const task of Array.isArray(view.tasks) ? view.tasks : []) {
            const unverified = (Array.isArray(task.assumptions) ? task.assumptions : []).filter(a => !a.verified).length
            const parentInfo = task.parentId ? ' [父:' + task.parentId + ']' : ''
            const depInfo = (Array.isArray(task.blockedBy) ? task.blockedBy : []).length && task.status !== 'done'
              ? ' [等 ' + task.blockedBy.join(',') + ']'
              : ''
            const evInfo = task.evidence ? ' ✓证据:' + String(task.evidence).slice(0, 40) : ''
            lines.push('[' + task.status + '] #' + task.id + ' ' + task.title + (task.owner ? ' — @' + task.owner : '') + parentInfo + depInfo + (unverified > 0 ? ' ⚠' + unverified + '假设' : '') + evInfo)
          }
          const notesShown = Array.isArray(view.notes) ? view.notes : []
          for (const note of notesShown) {
            lines.push('note «' + (note.title || '(untitled)') + '» ' + (note.tags || []).join('/') + '  (' + note.id + ')')
          }
          const notesTotal = typeof view.notesCount === 'number' ? view.notesCount : notesShown.length
          const notesHidden = Math.max(0, notesTotal - notesShown.length)
          if (notesHidden > 0) {
            lines.push('notes: ' + notesShown.length + ' of ' + notesTotal + ' shown — ' + notesHidden + ' older note(s) are not in this answer')
          } else {
            lines.push('notes: ' + notesTotal + ' (all shown)')
          }
          const logShown = Array.isArray(view.log) ? view.log.length : 0
          const logTotal = typeof view.logCount === 'number' ? view.logCount : logShown
          if (logTotal > logShown) {
            lines.push('log: ' + logShown + ' of ' + logTotal + ' lines shown')
          }
          const truncated = Array.isArray(view.truncated) ? view.truncated : []
          if (truncated.length > 0) {
            const parts = truncated.map(item => item.field + ' ' + item.sent + ' → ' + item.kept + ' chars')
            lines.push('truncated: ' + parts.join('; '))
          }
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      async execute(args, exec) {
        const passed = args && typeof args === 'object' ? args : {}
        const callerAgent = exec && exec.agent ? exec.agent : null
        const rawSession = typeof passed.session === 'string' && passed.session
          ? passed.session
          : (callerAgent && callerAgent.id ? String(callerAgent.id) : '')
        const session = resolveRootSessionId(rawSession, callerAgent) || rawSession
        const identity = resolveAgentIdentity(runtime, rawSession, callerAgent)
        const byDefault = passed.by || (identity && identity.isChild ? identity.self : 'agent')

        if (passed.action === 'team.list') {
          try {
            const board = session ? loadBoard(boardFileFor(session)) : emptyBoard()
            const roster = await refreshSubagentTree(runtime, session, board)
            const svc = runtime.get('agentTeams')
            const rawTeamTasks = (svc && typeof svc.listTasks === 'function' && callerAgent) ? (svc.listTasks(callerAgent) || []) : []
            const secDeps = makeChiefDeps(runtime)
            const dir = await listPeerDirectory(secDeps, session || rawSession).catch(() => null)
            return {
              ok: true,
              subagents: roster,
              teamTasks: rawTeamTasks.map(t => ({
                id: t.id, subject: t.subject, status: t.status,
                owner: t.ownerName || '', blockedBy: t.blockedBy || [],
                ready: t.ready, revision: t.revision,
              })),
              bubble: summarizeBubbleSnapshot(secDeps, session || rawSession, dir),
              ...summary(board, roster),
            }
          } catch (err) {
            return { ok: false, error: 'team.list: ' + String(err && err.message || err) }
          }
        }

        if (passed.action === 'bounds.propose') {
          const propRes = proposeBoundToChief(makeChiefDeps(runtime), {
            sessionId: rawSession,
            callerAgent,
            by: byDefault,
            field: normalizeBoundFieldName(passed.field) || 'forbidden',
            item: str(passed.item || passed.text || passed.note || passed.body, ''),
            items: Array.isArray(passed.items) ? passed.items : undefined,
            reason: str(passed.reason || passed.intent || passed.subject, ''),
          })
          if (!propRes.ok) return { ok: false, error: propRes.error }
          const board = session ? boardForSession(boardFileFor(session)) : emptyBoard()
          const roster = session ? await refreshSubagentTree(runtime, session, board) : []
          return {
            ok: true,
            boundProposed: propRes,
            ...summary(board, roster),
          }
        }

        if (passed.action === 'inquiry.reply') {
          const replyBody = str(passed.text || passed.body || passed.message || passed.note, '').trim()
          if (!replyBody) return { ok: false, error: 'inquiry.reply 需要非空 text 参数' }
          const deliv = await deliverCrossMessage(makeChiefDeps(runtime), {
            fromSession: rawSession || session,
            fromLabel: byDefault,
            target: 'chief',
            subject: '优先问询答复',
            text: replyBody,
            envelopeKind: 'inquiry_reply',
            inquiryId: str(passed.inquiryId || passed.id || passed.taskId, ''),
          })
          if (!deliv.ok) return { ok: false, error: deliv.error }
          const board = session ? loadBoard(boardFileFor(session)) : emptyBoard()
          const roster = session ? await refreshSubagentTree(runtime, session, board) : []
          return {
            ok: true,
            inquiryAnswered: deliv.inquiryAnswered || null,
            continueOwnWork: true,
            ...summary(board, roster),
          }
        }

        if (passed.action === 'chief.request') {
          const reqBody = str(passed.text || passed.body || passed.message || passed.note, '').trim()
          if (!reqBody) return { ok: false, error: 'chief.request 需要非空 text 参数' }
          const deliv = await deliverCrossMessage(makeChiefDeps(runtime), {
            fromSession: rawSession || session,
            fromLabel: byDefault,
            target: 'chief',
            subject: str(passed.subject || passed.title, '') || '主对话协同请求',
            text: reqBody,
            mode: 'followup',
          })
          if (!deliv.ok) return { ok: false, error: deliv.error }
          const board = session ? boardForSession(boardFileFor(session)) : emptyBoard()
          const roster = session ? await refreshSubagentTree(runtime, session, board) : []
          return {
            ok: true,
            chiefRequest: {
              mode: deliv.mode || deliv.deliveryMode || 'handled',
              actionTaken: deliv.actionTaken || '',
              taskId: deliv.taskId || '',
              reply: deliv.reply || '',
            },
            ...summary(board, roster),
          }
        }

        if (passed.action === 'mail.send') {
          const target = str(passed.target || passed.agent || passed.subagent, 'lead').trim() || 'lead'
          const msgText = str(passed.text || passed.message || passed.prompt || passed.body || passed.note, '').trim()
          const deliv = await deliverCrossMessage(makeChiefDeps(runtime), {
            fromSession: rawSession,
            fromLabel: byDefault,
            target,
            subject: str(passed.subject || passed.title, ''),
            text: msgText,
            mode: ['steer', 'followup', 'silent'].includes(passed.delivery) ? passed.delivery : 'steer',
          })
          if (!deliv.ok) return { ok: false, error: deliv.error }
          const board = session ? loadBoard(boardFileFor(session)) : emptyBoard()
          const roster = session ? await refreshSubagentTree(runtime, session, board) : []
          return {
            ok: true,
            mailDelivered: {
              target: deliv.broadcast ? 'all' : deliv.target,
              mode: deliv.broadcast ? 'broadcast' : deliv.deliveryMode,
            },
            ...summary(board, roster),
          }
        }

        if (passed.action === 'mail.inbox') {
          const secDeps = makeChiefDeps(runtime)
          const inbox = readMailboxForAgent(secDeps, {
            sessionId: rawSession,
            callerAgent,
            unreadOnly: Boolean(passed.unreadOnly),
          })
          const dir = await listPeerDirectory(secDeps, session || rawSession)
          const board = session ? loadBoard(boardFileFor(session)) : emptyBoard()
          const roster = session ? await refreshSubagentTree(runtime, session, board) : []
          return {
            ok: true,
            inbox,
            peers: dir.targets,
            bubble: summarizeBubbleSnapshot(secDeps, session || rawSession, dir),
            ...summary(board, roster),
          }
        }

        if (passed.action === 'context.compact') {
          const scRes = await requestSmartCompactFromLead(makeChiefDeps(runtime), {
            sessionId: rawSession || session,
            reason: str(passed.text || passed.summary || passed.body || passed.note, ''),
            by: byDefault,
          })
          if (!scRes || scRes.ok === false) {
            return { ok: false, error: (scRes && scRes.error) || '智选压缩请求未能执行' }
          }
          const board = session ? boardForSession(boardFileFor(session)) : emptyBoard()
          const roster = session ? await refreshSubagentTree(runtime, session, board) : []
          return {
            ok: true,
            smartCompact: scRes,
            ...summary(board, roster),
          }
        }

        if (passed.action === 'permission.request') {
          const reqTarget = normalizePermissionMode(passed.targetMode || 'strategist')
          const reasonTxt = str(passed.reason || passed.text || passed.note || passed.intent, '主对话/子代理申请提升 DSH 参谋系统权限以继续任务')
          const elv = requestChiefElevation(session || rawSession || 'global', {
            targetMode: reqTarget,
            reason: reasonTxt,
            requestedActionSummary: str(passed.item || passed.title || passed.text, ''),
            by: byDefault,
          })
          const board = session ? boardForSession(boardFileFor(session)) : emptyBoard()
          const roster = session ? await refreshSubagentTree(runtime, session, board) : []
          return {
            ok: true,
            elevationRequested: elv,
            elevationMessage: elv
              ? `已向用户弹出提权申请（请求升至 ${CHIEF_PERMISSION_META[reqTarget]?.level || reqTarget} · ${CHIEF_PERMISSION_META[reqTarget]?.title || reqTarget}），等待用户点击确认。`
              : '当前权限已满足或高于目标档位，无需重复提权。',
            ...summary(board, roster),
          }
        }

        if (passed.action === 'task.dispatch' || passed.action === 'team.steer' || passed.action === 'team.interrupt') {
          const subRes = await executeSubagentAction(runtime, { ...passed, by: byDefault, session }, callerAgent, exec && exec.signal)
          if (!subRes.ok) return { ok: false, error: subRes.error }
          return {
            ok: true,
            ...(subRes.dispatched ? { dispatched: subRes.dispatched } : {}),
            ...(subRes.interrupted ? { interrupted: subRes.interrupted } : {}),
            ...(subRes.messageId ? { messageId: subRes.messageId, agent: subRes.agent } : {}),
            ...summary(subRes.board, subRes.subagents),
          }
        }

        const actionArgs = session
          ? { ...passed, by: byDefault, session, _callerOrigin: 'model_tool' }
          : { ...passed, by: byDefault, _callerOrigin: 'model_tool' }
        const result = runAction(actionArgs)
        if (!result.ok) {
          if (result.blockedBySafetyGuard) {
            appendChiefAuditLog(session || rawSession || 'global', {
              mode: 'advisor',
              stage: 'safety_guard',
              rule: result.rule || 'bounds_human_only',
              decision: 'blocked',
              operation: String(passed.action || 'bounds'),
              target: String(passed.field || 'bounds'),
              reason: result.error,
              outcome: 'blocked',
              by: byDefault,
            })
          }
          return { ok: false, error: result.error }
        }
        const mergedBoard = session && result.board ? boardForSession(boardFileFor(session)) : result.board
        const roster = session ? await refreshSubagentTree(runtime, session, mergedBoard) : []
        return {
          ok: true,
          ...summary(mergedBoard, roster),
          ...(result.archiveSearch ? { archiveSearch: result.archiveSearch } : {}),
          ...(result.archiveItem ? { archiveItem: result.archiveItem } : {}),
          ...(result.archiveSaved ? { archiveSaved: result.archiveSaved } : {}),
          ...(result.walls ? { guardWalls: result.walls } : {}),
          ...(result.truncated ? { truncated: result.truncated } : {}),
        }
      },
    }
  }

  function memoryTool(runtime) {
    return {
      name: 'chief_memory',
      description:
        'Rolling memory of THIS conversation, kept on its own board: one entry per finished turn, plus anything the human or you mark as worth keeping. '
        + 'Ask with "memory.ask" (question) to get the entries that match — answered only from what was actually recorded, and it says so when nothing matches. '
        + 'Write with "memory.add" (text, optional title/section) when a decision, a gate, or a constraint must survive the next turn; '
        + '"memory.remove" drops one entry by id. Sections: progress / decision / verify / open / other.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['memory.add', 'memory.remove', 'memory.ask'], description: 'Memory operation.' },
          text: { type: 'string', description: 'Entry body for memory.add.' },
          title: { type: 'string', description: 'Short headline for memory.add; defaults to the first 80 chars of text.' },
          section: { type: 'string', enum: MEMORY_SECTIONS.map(section => section.key), description: 'Section for memory.add.' },
          memoryId: { type: 'string', description: 'Entry id for memory.remove.' },
          question: { type: 'string', description: 'Natural-language question for memory.ask.' },
          session: { type: 'string', description: 'Session whose memory to hit; defaults to the calling Agent.' },
          scope: { type: 'string', enum: ['session', 'shared'], description: 'Board to hit. Default "session" = this conversation\'s own memory.' },
        },
        required: ['action'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', description: 'The answer for memory.ask, or the entry that changed.' },
        render(_args, value) {
          const view = value && typeof value === 'object' ? value : {}
          if (view.ok === false) return [{ type: 'text', text: 'failed: ' + String(view.error) }]
          if (typeof view.reply === 'string') {
            const lines = [view.reply]
            if (Array.isArray(view.terms) && view.terms.length) lines.push('terms: ' + view.terms.join('/'))
            return [{ type: 'text', text: lines.join('\n') }]
          }
          const lines = ['memory entries: ' + (view.memoryCount === undefined ? '?' : view.memoryCount)]
          for (const item of Array.isArray(view.memory) ? view.memory : []) {
            lines.push('[' + item.section + '] ' + item.title)
          }
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      async execute(args, exec) {
        const passed = args && typeof args === 'object' ? args : {}
        const session = typeof passed.session === 'string' && passed.session
          ? passed.session
          : (exec && exec.agent && exec.agent.id ? String(exec.agent.id) : '')
        if (!session && passed.scope !== 'shared') {
          return { ok: false, error: 'no session bound — memory is per-conversation now' }
        }
        const result = runAction(session ? { ...passed, session } : passed)
        if (!result.ok) return { ok: false, error: result.error }
        if (passed.action === 'memory.ask') {
          return { ok: true, reply: result.reply, hits: result.hits, terms: result.terms }
        }
        return {
          ok: true,
          memory: summary(result.board).memory,
          memoryCount: summary(result.board).memoryCount,
          ...(result.truncated ? { truncated: result.truncated } : {}),
        }
      },
    }
  }

  function boundariesTool(runtime) {
    return {
      name: 'chief_boundaries',
      description:
        'Report this Harness deployment’s live limits: working directory, sandbox mode, workspace-write roots, '
        + 'profile, the shared chief file, advertised web URL, tool count and process facts. '
        + 'Use it whenever the answer depends on what this Session is actually allowed to touch.',
      parameters: {
        type: 'object',
        properties: {
          session: { type: 'string', description: 'Session to report on; defaults to the calling Agent. Every per-session field is resolved for that Session, not for the process.' },
        },
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', description: 'Boundary facts for this deployment.' },
        render(_args, value) {
          const view = value && typeof value === 'object' ? value : {}
          return [{
            type: 'text',
            text: Object.keys(view).map(key => key + ': ' + JSON.stringify(view[key])).join('\n'),
          }]
        },
      },
      async execute(args, exec) {
        const passed = args && typeof args === 'object' ? args : {}
        const session = str(passed.session, '') || str(exec && exec.agent && exec.agent.id, '')
        return boundaries(runtime, session)
      },
    }
  }

  function handoffTool(runtime) {
    return {
      name: 'chief_handoff',
      description:
        'Produce the handover packet for this machine: objective, where the work stands, the ordered next actions with the intent behind each, '
        + 'the safety bounds to respect before touching anything, key coordinates, what was already tried and failed, and what still waits on the human. '
        + 'Hand it to a fresh Session when the current context is too heavy, so that Session can continue WITHOUT re-reading or decompressing the old transcript. '
        + 'A new Session should call this first. Pass mark:true once the packet was actually handed over.',
      parameters: {
        type: 'object',
        properties: {
          mark: { type: 'boolean', description: 'Stamp handoff.at/by/session to record that this packet was handed over.' },
          session: { type: 'string', description: 'Session handing over; defaults to the calling Agent.' },
          target: { type: 'string', description: 'Deliver instead of just rendering: "new" waits for the next new Session, or pass a live Session id to hand it over now. Only the operator decides this; nothing is transferred on its own.' },
          autoInject: { type: 'boolean', description: 'Turn the per-turn digest on or off. On by default: the digest is registered at the head of the system prompt so the model keeps the board in view for the whole task. Setting false records the preference; it does not remove the section.' },
          guardIdle: { type: 'boolean', description: 'Turn the idle-turn guard on or off (on by default): a turn that closes without moving the plan — no plan written, or open steps left untouched, or a short silent answer while work is still open — is steered one more step.' },
        },
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', description: 'The packet plus a short structural summary.' },
        render(_args, value) {
          const view = value && typeof value === 'object' ? value : {}
          return [{ type: 'text', text: String(view.text || '') }]
        },
      },
      async execute(args, exec) {
        const passed = args && typeof args === 'object' ? args : {}
        const session = typeof passed.session === 'string' && passed.session
          ? passed.session
          : (exec && exec.agent && exec.agent.id ? String(exec.agent.id) : '')

        const auto = asBool(passed.autoInject)
        if (auto !== undefined) {
          // autoInject lives on the shared board — it is a machine-level flag, not
          // per-session content.
          runAction({ action: 'settings.set', autoInject: auto, session, by: 'agent', scope: 'shared' })
        }

        const guard = asBool(passed.guardIdle)
        if (guard !== undefined) {
          runAction({ action: 'settings.set', guardIdle: guard, session, by: 'agent', scope: 'shared' })
        }

        if (typeof passed.target === 'string' && passed.target) {
          const delivered = await transferChief(runtime, { ...passed, by: 'agent' }, session)
          const after = loadBoard(boardFileFor(session))
          const result = {
            ok: delivered.ok,
            mode: delivered.mode,
            text: delivered.text,
            counts: {
              plan: (after.plan || []).length,
              openSteps: (after.plan || []).filter(step => !step.done).length,
              tasks: (after.tasks || []).length,
              openTasks: (after.tasks || []).filter(task => task.status !== 'done').length,
            },
          }
          // undefined is not lossless JSON, so a success carries no error key at all
          if (delivered.ok === false && delivered.error) result.error = String(delivered.error)
          return result
        }

        const selfFile = boardFileFor(session)
        if (asBool(passed.mark) === true) {
          // The tool half writes boards too, so it has to take the same lock as the
          // routes: a mark landing between a route's load and its save would be
          // dropped by whichever rename finished second.
          withBoardLock(selfFile, () => {
            const marked = loadBoard(selfFile)
            marked.handoff = { ...(marked.handoff || {}), at: nowMs(), by: 'agent', session }
            pushLog(marked, '交接单已生成并交出', 'agent', session)
            saveBoard(marked, selfFile)
          })
        }
        // Render the inherited view: a packet handed over before the session ever
        // wrote bounds/objective must still tell the successor what the operator
        // forbade and what the machine is working on.
        const board = boardForSession(selfFile)
        const hInfo = resolveEffectiveHandoff(
          runtime,
          session,
          board,
          fetchTeamTasks(runtime, exec && exec.agent ? exec.agent : null),
        )
        return {
          ok: true,
          text: hInfo.text,
          pinned: hInfo.pinned,
          source: hInfo.source,
          counts: {
            plan: (board.plan || []).length,
            openSteps: (board.plan || []).filter(step => !step.done).length,
            tasks: (board.tasks || []).length,
            openTasks: (board.tasks || []).filter(task => task.status !== 'done').length,
            bounds: board.bounds,
            handoffAt: board.handoff ? board.handoff.at : 0,
          },
        }
      },
    }
  }

  return {
    BOARD_PARAMETERS,
    boardTool,
    memoryTool,
    boundariesTool,
    handoffTool,
  }
}
