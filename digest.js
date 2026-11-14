/**
 * The automatic half of dsh-chief.
 *
 * Three jobs, all meant to survive compaction without the model being reminded:
 *
 * 1. renderDigest(board, extras) — a small, budgeted section injected into every
 *    prompt assembly, so the objective, the plan state, DAG task graph, subagent
 *    team status, and anchor notes are in context even after compaction.
 * 2. Subagent & Team awareness — when running inside a subagent tree, tells the
 *    root agent which DAG leaf tasks are unlocked for parallel dispatch, and tells
 *    each child subagent which task on the shared root board belongs to it.
 * 3. planFromTodos / objectiveFromGoal — mirror the model's own working plan
 *    (`todo_write`, `create_goal`, `update_goal`) into the board.
 */

const DIGEST_BUDGET = 2500

function ownerName(id) {
  const text = String(id || '')
  return text.indexOf('session-') === 0 ? '会话 ' + text.slice(8, 16) : text
}

function shortAgentLabel(name) {
  const raw = String(name || '').trim()
  if (!raw) return ''
  return raw
    .split('/')
    .map(seg => seg.replace(/[-_]([0-9a-f]{8,40})$/i, (_, hex) => '·' + hex.slice(0, 4)))
    .join('/')
}

function boundsLines(board) {
  const bounds = (board && board.bounds) || {}
  const pinned = (board && board.pinnedBounds) || {}
  const pinSet = (col) => new Set(Array.isArray(pinned[col]) ? pinned[col].map(s => String(s).trim()) : [])
  const fmtItem = (col, s, limit = 75) => {
    const clean = String(s || '').trim()
    return (pinSet(col).has(clean) ? '📌' : '') + clamp(clean, limit)
  }
  const forbidden = Array.isArray(bounds.forbidden) ? bounds.forbidden.filter(Boolean) : []
  const allowed = Array.isArray(bounds.allowed) ? bounds.allowed.filter(Boolean) : []
  const notes = Array.isArray(bounds.notes) ? bounds.notes.filter(Boolean) : []
  if (!forbidden.length && !allowed.length && !notes.length) return []
  const lines = ['⚖️ 当前生效边界（📌=全局定住跨任务铁律，其余为本任务边界；全体主子代理必须严守）：']
  if (forbidden.length) lines.push('  🚫 禁止红线: ' + forbidden.slice(0, 6).map(s => fmtItem('forbidden', s)).join(' ； '))
  if (allowed.length) lines.push('  ✅ 允许范围: ' + allowed.slice(0, 5).map(s => fmtItem('allowed', s)).join(' ； '))
  if (notes.length) lines.push('  💡 边界注意: ' + notes.slice(0, 4).map(s => fmtItem('notes', s)).join(' ； '))
  return lines
}

const ANCHOR_TAG = 'anchor'
const ANCHOR_BUDGET = 520
const ANCHOR_RESERVE = 300

const MEMORY_SIGNAL = [
  '已修', '已改', '已部署', '根因', '结论', '验证', '实测', 'PASS', 'FAIL', '失败',
  'commit', 'node ', 'npm ', 'git ', 'http', '\\', '/', '文件', '路径', '命令',
]
const MEMORY_NOISE = ['随时', '谢谢', '希望', '祝你', '不客气', '你现在看到', '我在这里', '有什么可以']

function memoryScore(item) {
  const text = String((item && (item.title || item.text)) || '')
  let score = 0
  for (const word of MEMORY_SIGNAL) if (text.includes(word)) score += 2
  for (const word of MEMORY_NOISE) if (text.includes(word)) score -= 4
  if (/[0-9]/.test(text)) score += 1
  if (item && (item.section === 'decision' || item.section === 'verify')) score += 2
  if (text.length >= 14) score += 1
  return score
}

function memoryLines(board, limit) {
  const pool = (board.memory || [])
    .slice(-Math.max(limit * 3, 10))
    .filter(item => item && (item.title || item.text))
  if (!pool.length) return []
  const ranked = pool
    .map((item, index) => ({ item, index, score: memoryScore(item) }))
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, limit)
    .sort((a, b) => b.index - a.index)
    .map(entry => entry.item)
  const open = ranked.filter(item => item.section === 'open')
  const rest = ranked.filter(item => item.section !== 'open')
  const ordered = open.concat(rest)
  return ['记忆（本对话最近的结论 ' + ranked.length + ' 条）'].concat(
    ordered.map(item => '  · [' + sectionLabel(item.section) + '] ' + clamp(item.title || item.text, 60)),
  )
}

function sectionLabel(key) {
  const labels = { progress: '目标与进展', decision: '决策与结论', verify: '门禁与验证', open: '未完成与风险', other: '其他要点' }
  return labels[key] || '其他要点'
}

function clamp(text, limit) {
  const value = String(text === undefined || text === null ? '' : text).replace(/\s+/g, ' ').trim()
  return value.length > limit ? value.slice(0, limit) + '…' : value
}

function planLines(board, limit) {
  const steps = Array.isArray(board.plan) ? board.plan : []
  const tasks = Array.isArray(board.tasks) ? board.tasks : []
  if (!steps.length) {
    if (tasks.length) {
      return [
        '规划: 已启用任务图模式（共 ' + tasks.length + ' 个任务节点）。可用 graph.plan 批量维护层级(parentId)与依赖(blockedBy)，或用 task.dispatch 派发子代理。',
      ]
    }
    return [
      '规划: 空 —— 复杂或多步任务请先用 chief_board 的 graph.plan 规划可视化任务图（支持 parentId 拆解与 blockedBy 依赖），或用 plan.set / todo_write 写步骤。',
    ]
  }
  const done = steps.filter(step => step.done).length
  const open = steps.filter(step => !step.done)
  const shown = open.slice(0, limit)
  const lines = ['规划 ' + done + '/' + steps.length + (open.length > shown.length ? '（未完成 ' + open.length + '，此处列前 ' + shown.length + '）' : '') + ':']
  for (const step of shown) lines.push('  [ ] ' + clamp(step.text, 90))
  lines.push(
    '  ↳ 每轮先按顺序读这一段：做完的步 plan.set 标 done；新发现的步补进去；'
      + '不再做的旧步删掉；需要拆解子代理并行时用 graph.plan 建任务图并用 task.dispatch 派发。',
  )
  return lines
}

function modeLine(board) {
  const mode = String((board && board.mode) || 'plan')
  if (mode === 'goal') {
    return '模式: goal —— 这活是一个持续目标，不是一串步骤。每轮只回答「目标有没有真的前进」，'
      + '没前进就明说没前进并写清卡在哪；要改目标用 objective.set，别用步骤列表代替目标。'
  }
  return ''
}

function matchAgentTask(task, identity) {
  if (!task || !identity || task.status === 'done') return false
  const self = String(identity.self || '').toLowerCase()
  const shortSelf = self.split('/').pop()
  const owner = String(task.owner || '').toLowerCase()
  const shortOwner = owner.split('/').pop()
  if (self && owner && (owner === self || shortOwner === shortSelf)) return true
  if (identity.sessionId && task.session && String(task.session) === String(identity.sessionId)) return true
  return false
}

function subagentHeaderLines(board, extras) {
  const lines = []
  const identity = extras && extras.agentIdentity ? extras.agentIdentity : null
  const subagents = Array.isArray(extras && extras.subagents) ? extras.subagents : []
  const tasks = Array.isArray(board && board.tasks) ? board.tasks : []
  const byId = new Map(tasks.map(t => [t.id, t]))

  if (identity && identity.isChild) {
    lines.push(
      '🤖 子代理协同身份: 你是子代理 `' + identity.self + '`（上级 `' + (identity.parent || 'lead') + '`，与主代理共享同一份根任务图）。',
    )
    const mine = tasks.filter(t => matchAgentTask(t, identity))
    if (mine.length) {
      for (const t of mine.slice(0, 3)) {
        const upEvidences = (Array.isArray(t.blockedBy) ? t.blockedBy : [])
          .map(depId => byId.get(depId))
          .filter(dep => dep && dep.evidence)
          .map(dep => '#' + dep.id + ':' + clamp(dep.evidence, 60))
        lines.push(
          '  🎯 指派给你的任务: [' + t.status + '] #' + t.id + ' ' + clamp(t.title, 70)
            + (t.intent ? ' | 意图: ' + clamp(t.intent, 70) : '')
            + (upEvidences.length ? ' | 上游成果: ' + upEvidences.join(' ; ') : ''),
        )
      }
      lines.push(
        '  ↳ 【强制回写纪律】任务推进/受阻/完成时必须立即调 chief_board({ action: "task.update", id: "' + mine[0].id + '", status: "doing"|"blocked"|"done", evidence: "验证结果" })！需向主代理或队友同步信息必须调 mail.send；工作中若撞墙（权限/沙箱/红线受阻）必须调 bounds.propose 上报参谋长请示用户！',
      )
    } else {
      lines.push('  ↳ 【强制协同纪律】进展变化必须调 chief_board 更新任务与 evidence；跨代理传话必须调 mail.send；工作中撞墙或发现新禁区必须调 bounds.propose 上报参谋长！')
    }
  } else if (subagents.length > 0) {
    const children = subagents.filter(a => a && a.name !== 'lead')
    if (children.length > 0) {
      const running = children.filter(a => a.status === 'running')
      const idle = children.filter(a => a.status !== 'running')
      const shown = [...running.slice(0, 5), ...idle.slice(0, Math.max(0, 4 - running.length))]
      const summary = shown.map(a => {
        const icon = a.status === 'running' ? '🟢' : a.status === 'inactive' ? '⏸' : '⚠'
        return icon + shortAgentLabel(a.name) + (a.taskId ? '(#' + a.taskId + ')' : '')
      }).join(' · ')
      const restCount = Math.max(0, children.length - shown.length)
      lines.push('🤖 子代理团队 (' + running.length + ' 运行中 / 共 ' + children.length + ' 个): ' + summary + (restCount > 0 ? ' · 另有 ' + restCount + ' 个空闲成员' : ''))
    }
  }
  if (extras && Number(extras.linkedPeersCount) > 0) {
    lines.push('📡 跨窗口协同已开启: 已与 ' + extras.linkedPeersCount + ' 个外部主对话窗口互通，可用 chief_board({ action: "mail.send", target, text }) 跨对话递话。')
  }
  return lines
}

function taskLines(board, limit) {
  const tasks = Array.isArray(board.tasks) ? board.tasks : []
  const open = tasks.filter(task => task.status !== 'done')
  if (!open.length) return []
  const doneIds = new Set(tasks.filter(task => task.status === 'done').map(task => task.id))
  const order = { doing: 0, blocked: 1, todo: 2 }
  const sorted = open.slice().sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3))
  const shown = sorted.slice(0, limit)
  const doneCount = tasks.length - open.length
  const lines = ['任务图 (' + open.length + ' 未完 / ' + doneCount + ' 已完):']

  const childrenOf = {}
  for (const task of tasks) {
    const pid = task.parentId
    if (pid && pid !== ' ') {
      if (!childrenOf[pid]) childrenOf[pid] = []
      childrenOf[pid].push(task)
    }
  }

  // blockedBy 全部 done 的 blocked 任务可以自动或手动解锁
  const ready = open.filter(task =>
    task.status === 'blocked' && Array.isArray(task.blockedBy) && task.blockedBy.length
      && task.blockedBy.every(id => doneIds.has(id)))

  // 无阻塞且无未完成子任务的叶子 todo 节点 -> 可立即并行派发给子代理
  const dispatchable = open.filter(task => {
    if (task.status !== 'todo') return false
    const deps = Array.isArray(task.blockedBy) ? task.blockedBy : []
    if (deps.some(id => !doneIds.has(id))) return false
    const kids = childrenOf[task.id] || []
    if (kids.some(k => k.status !== 'done')) return false
    return true
  })

  // 子任务全部 done 但父任务还挂着的——父任务可以标记 done 了。
  const parentReady = open.filter(task => {
    const kids = childrenOf[task.id]
    return Array.isArray(kids) && kids.length && kids.every(k => k.status === 'done')
  })

  const STALE_TODO_MS = 10 * 60 * 1000
  const staleTodo = open.filter(task => {
    if (task.status !== 'todo') return false
    const at = task.at || task.updatedAt || task.createdAt
    if (!at) return false
    const age = Date.now() - new Date(at).getTime()
    return age > STALE_TODO_MS
  })

  for (const task of shown) {
    const owner = task.owner ? ' @' + clamp(task.owner, 18) : ''
    const parentMark = task.parentId ? ' [父:' + task.parentId + ']' : ''
    const unresolvedDeps = (Array.isArray(task.blockedBy) ? task.blockedBy : []).filter(id => !doneIds.has(id))
    const deps = unresolvedDeps.length && task.status !== 'done'
      ? ' [等 ' + unresolvedDeps.join(',') + ']'
      : ''
    const unverified = (Array.isArray(task.assumptions) ? task.assumptions : []).filter(a => !a.verified).length
    const assumMark = unverified > 0 ? ' ⚠' + unverified + '假设' : ''
    lines.push('  [' + task.status + (task.priority === 'high' ? '!' : '') + '] #' + task.id + ' ' + clamp(task.title, 72) + owner + parentMark + deps + assumMark)
  }
  if (open.length > shown.length) lines.push('  …还有 ' + (open.length - shown.length) + ' 条，用 chief_board snapshot 取全量')
  if (ready.length) {
    lines.push('  🔓 前置依赖已全部完成，可立即解锁：' + ready.slice(0, 3).map(task => '#' + task.id + ' ' + clamp(task.title, 34)).join(' · ')
      + ' —— 调 task.dispatch 派发或 task.update 改 doing')
  }
  if (dispatchable.length) {
    lines.push('  🚀 就绪可并行派发节点 (' + dispatchable.length + ' 个)：' + dispatchable.slice(0, 4).map(t => '#' + t.id + ' ' + clamp(t.title, 28) + (t.owner ? '(@' + t.owner + ')' : '')).join(' · ')
      + ' —— 可用 chief_board({ action: "task.dispatch", id, agent }) 一键派给子代理')
  }
  if (parentReady.length) {
    lines.push('  📦 子任务已全部完成，父任务可收尾：' + parentReady.slice(0, 3).map(task => '#' + task.id + ' ' + clamp(task.title, 34)).join(' · ')
      + ' —— 用 task.update 把父任务标 done 并汇总 evidence')
  }
  if (staleTodo.length) {
    const min = Math.floor((Date.now() - new Date(staleTodo[0].at || staleTodo[0].updatedAt || staleTodo[0].createdAt).getTime()) / 60000)
    lines.push('  ⏰ todo 任务挂了 ' + min + ' 分钟没动：' + staleTodo.slice(0, 3).map(task => '#' + task.id + ' ' + clamp(task.title, 34)).join(' · ')
      + ' —— 认领/派发/删除，别让它挂着')
  }
  return lines
}

function stampOf(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = number => String(number).padStart(2, '0')
  return pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
}

function cursorLines(board) {
  const cursor = board && board.cursor ? board.cursor : null
  const step = clamp(cursor && cursor.step, 120)
  const next = clamp(cursor && cursor.next, 160)
  const blocked = clamp(cursor && cursor.blocked, 120)
  if (!step && !next && !blocked) {
    const open = (Array.isArray(board && board.plan) ? board.plan : []).filter(item => !item.done)
    if (!open.length) return []
    return ['断点: 空 —— 做到哪一步、下一句做什么、卡在哪，一样都没写。规划每往前走一步必须 chief_board cursor.set 记下这三句；换会话或被压缩之后，只有这一段能接上。']
  }
  const at = stampOf(cursor.at)
  const lines = ['现在在哪（断点' + (at ? '，' + at : '，未标时间') + '）:']
  if (step) lines.push('  做到: ' + step)
  if (next) lines.push('  下一句就做: ' + next)
  if (blocked) lines.push('  卡在: ' + blocked)
  if (at) {
    const hours = Math.floor((Date.now() - new Date(cursor.at).getTime()) / 3600000)
    if (hours >= 2) lines.push('  ⚠ 断点已停留 ' + hours + ' 小时，确认一下是不是该更新 cursor.set 了')
  }
  return lines
}

function takenOutArchiveLines(extras, limit, budget) {
  const taken = extras && Array.isArray(extras.takenOutArchives) ? extras.takenOutArchives : []
  // Strictly ZERO auto-injection when cold/sealed: only items explicitly taken out onto this session desk appear.
  if (!taken.length) return []
  const shown = taken.slice(0, limit || 4)
  const header = '📎 当前主动取出的工程档案 ' + taken.length + ' 份（用户从档案柜取出备查）:'
  const total = Number.isFinite(budget) ? Math.max(200, budget) : ANCHOR_BUDGET
  const build = perItem =>
    [header].concat(
      shown.map(item => {
        const pts = (Array.isArray(item.points) ? item.points : []).slice(0, 3).map(p => clamp(p.title, 26)).join(' / ')
        const bodyBit = clamp(item.summary || item.body || '', perItem)
        return '  · 《' + clamp(item.title || '未命名', 36) + '》: ' + bodyBit + (pts ? ' [要点: ' + pts + ']' : '')
      }),
    )
  let perItem = 180
  let lines = build(perItem)
  while (lines.join('\n').length > total && perItem > 60) {
    perItem = Math.max(60, Math.floor(perItem * 0.72))
    lines = build(perItem)
  }
  return lines
}

function anchorLines(board, limit, budget) {
  const notes = Array.isArray(board.notes) ? board.notes : []
  const anchors = notes.filter(note => (note.tags || []).some(tag => String(tag).toLowerCase() === ANCHOR_TAG))
  if (!anchors.length) return []
  const ranked = anchors.slice().sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned))
  const shown = ranked.slice(0, limit)
  const header =
    '锚点笔记 ' + anchors.length +
    (shown.length < anchors.length ? '（此处 ' + shown.length + ' 条，全文用 chief_board snapshot）' : '（压缩后仍保留的硬事实）') + ':'
  const total = Number.isFinite(budget) ? Math.max(180, budget) : ANCHOR_BUDGET
  const build = perNote =>
    [header].concat(shown.map(note => '  · ' + clamp(note.title || '(无标题)', 34) + ': ' + clamp(note.body, perNote)))
  let perNote = 200
  let lines = build(perNote)
  while (lines.join('\n').length > total && perNote > 70) {
    perNote = Math.max(70, Math.floor(perNote * 0.7))
    lines = build(perNote)
  }
  return lines
}

function logLines(board, limit) {
  const log = Array.isArray(board.log) ? board.log : []
  if (!log.length) return []
  return ['最近交接:'].concat(
    log.slice(-limit).map(entry => {
      const stamp = new Date(entry.at)
      const hh = String(stamp.getHours()).padStart(2, '0')
      const mm = String(stamp.getMinutes()).padStart(2, '0')
      return '  ' + hh + ':' + mm + ' ' + clamp(entry.by || '?', 12) + ': ' + clamp(entry.text, 90)
    }),
  )
}

function teamTaskLine(task) {
  const status = task.status === 'in_progress' ? 'doing' : task.status === 'completed' ? 'done' : task.status || 'pending'
  const owner = task.ownerName ? ' → ' + clamp(task.ownerName, 20) : ''
  const blocked = (Array.isArray(task.blockedBy) ? task.blockedBy : []).length && task.status !== 'completed'
    ? ' [等 ' + task.blockedBy.join(',') + ']'
    : ''
  return '  [' + status + '] ' + clamp(task.id, 12) + ' ' + clamp(task.subject, 60) + owner + blocked
}

function teamTaskLines(tasks, max) {
  if (!Array.isArray(tasks) || !tasks.length) return []
  const open = tasks.filter(t => t.status !== 'completed' && t.status !== 'deleted')
  const done = tasks.filter(t => t.status === 'completed')
  const lines = ['团队共享任务 ' + open.length + ' 项' + (done.length ? '（' + done.length + ' 已完成）' : '') + '：']
  for (const t of open.slice(0, max || 8)) lines.push(teamTaskLine(t))
  if (open.length > (max || 8)) lines.push('  …另有 ' + (open.length - (max || 8)) + ' 项（调 team_task_list 看全量）')
  return lines
}

/** The injected section. Never throws: a broken digest must not break a prompt. */
export function renderDigest(board, extras) {
  try {
    const head = ['## 参谋看板（DSH 参谋长指挥看板 · 父子代理与跨对话互通）']
    const mode = modeLine(board)
    if (mode) head.push(mode)
    if (board.objective) {
      const owner = board.objectiveBy ? '（' + ownerName(board.objectiveBy) + ' 设定）' : ''
      head.push('目标' + owner + ': ' + clamp(board.objective, 200))
    }
    const bLines = boundsLines(board)
    if (bLines.length) head.push(...bLines)
    const subLines = subagentHeaderLines(board, extras)
    if (subLines.length) head.push(...subLines)

    const blockerTasks = (Array.isArray(board.tasks) ? board.tasks : []).filter(t => t.status === 'blocked')
    if (blockerTasks.length) {
      head.push('⛔ 未解阻塞 ' + blockerTasks.length + ' 条：' + blockerTasks.slice(0, 3).map(t => '#' + t.id + ' ' + clamp(t.title, 50)).join(' · '))
    }

    const tailReserve =
      memoryLines(board, 3).join('\n').length + logLines(board, 3).join('\n').length + 2

    const hasAnchors = (Array.isArray(board.notes) ? board.notes : []).some(note =>
      (note.tags || []).some(tag => String(tag).toLowerCase() === ANCHOR_TAG),
    )

    const unreadNotes = (Array.isArray(board.notes) ? board.notes : []).filter(note => !(note.readBy || []).length)
    const unreadLine = unreadNotes.length
      ? '📬 未读笔记 ' + unreadNotes.length + ' 条：' + unreadNotes.slice(0, 3).map(n => clamp(n.title || n.body.slice(0, 24), 30)).join(' · ') + (unreadNotes.length > 3 ? ' 等' : '') + '（note.read 打开即标记已读）'
      : ''

    const sections = [
      { key: '规划', build: () => planLines(board, 6), hold: ANCHOR_RESERVE },
      { key: '断点', build: () => cursorLines(board), hold: ANCHOR_RESERVE },
      { key: '待办', build: () => taskLines(board, 10), hold: ANCHOR_RESERVE },
      { key: '团队任务', build: () => teamTaskLines(extras && extras.teamTasks, 8), hold: ANCHOR_RESERVE },
      {
        key: '取出档案',
        build: room => takenOutArchiveLines(extras, 4, Math.min(ANCHOR_BUDGET, Math.max(200, room - tailReserve))),
      },
      { key: '未读笔记', build: () => unreadLine ? [unreadLine] : [], hold: ANCHOR_RESERVE },
      {
        key: '锚点',
        build: room => anchorLines(board, 3, Math.min(ANCHOR_BUDGET, Math.max(180, room - tailReserve))),
      },
      { key: '记忆', build: () => memoryLines(board, 3) },
      { key: '交接痕迹', build: () => logLines(board, 3) },
    ]

    const body = []
    const dropped = []
    let used = head.join('\n').length
    for (const section of sections) {
      const hold = hasAnchors ? section.hold || 0 : 0
      const room = DIGEST_BUDGET - used - hold
      if (room < 80) {
        dropped.push(section.key)
        continue
      }
      const lines = section.build(room)
      if (!lines.length) continue
      let block = lines.join('\n')
      if (block.length > room) {
        block = block.slice(0, room - 24) + '\n  …（' + section.key + '已截断）'
        dropped.push(section.key + '（截断）')
      }
      body.push(block)
      used += block.length + 1
    }

    if (!body.length && !board.objective) {
      head.push('板子尚空：启动多步工作前必须先调 chief_board({ action: "graph.plan", objective, tasks }) 建立分层任务图（写明 parentId、blockedBy 与负责 subagent）。')
    }
    head.push(
      '【强制执行铁律 · 严禁只说不调工具】\n'
      + '  1. 逢变必记：定目标、拆任务、切换推进(doing)/受阻(blocked)/完成(done)、产出结论或断点时，必须当轮调用 chief_board（graph.plan / task.update / cursor.set / note.write）或 chief_memory 落盘，纯文字口头宣告无效。\n'
      + '  2. 逢协必传：派发子代理、给子代理/主代理/联动窗口传话同步关键发现时，必须调用 chief_board 的 task.dispatch / team.steer / mail.send（务必写明目标代理名）。\n'
      + '  3. 撞墙必奏（宰相边界机制）：执行中若撞墙（权限被拒、沙箱受限、目录禁改、路线死胡同）或用户要求总结工作边界，必须调用 chief_board({ action: "bounds.propose", field: "forbidden"|"allowed"|"notes", item: "简明边界条文", reason: "撞墙原因" }) 呈交 DSH 参谋长，由参谋长请示用户批准后注入全局边界。',
    )
    if (dropped.length) {
      head.push('预算不够，这些段没进：' + dropped.join('、') + '。需要就用 chief_board snapshot 取全量。')
    }
    let text = head.concat(body).join('\n')
    if (text.length > DIGEST_BUDGET + 450) text = text.slice(0, DIGEST_BUDGET + 450) + '\n…（参谋看板摘要已截断，用 chief_board 取全量）'
    return text
  } catch {
    return ''
  }
}

/** todo_write → plan. Returns the mapped steps, or null when nothing usable. */
export function planFromTodos(argumentsValue) {
  try {
    const args = argumentsValue && typeof argumentsValue === 'object' ? argumentsValue : {}
    const todos = Array.isArray(args.todos) ? args.todos : []
    const steps = todos
      .map((todo, index) => ({
        id: 'todo-' + index,
        text: clamp(todo && todo.content !== undefined ? todo.content : todo, 200),
        done: !!(todo && todo.status === 'completed'),
      }))
      .filter(step => step.text !== '')
    return steps.length ? steps : null
  } catch {
    return null
  }
}

/** create_goal / update_goal → objective. */
export function objectiveFromGoal(name, argumentsValue) {
  try {
    const args = argumentsValue && typeof argumentsValue === 'object' ? argumentsValue : {}
    if (name === 'update_goal' && args.action && args.action !== 'edit') return null
    const objective = typeof args.objective === 'string' ? args.objective.trim() : ''
    return objective || null
  } catch {
    return null
  }
}

/** Same content? Used to skip writes that would only churn updatedAt. */
export function planSignature(steps) {
  return JSON.stringify((steps || []).map(step => [String(step.text || ''), !!step.done]))
}
