/**
 * The handover packet.
 *
 * A fresh Session inherits neither this transcript nor its summaries, so the
 * packet must stand on its own: what we are doing, what is already done and on
 * what evidence, the ordered next actions with the intent behind each, the
 * bounds to respect before touching anything, the coordinates of the work, what
 * was already tried and failed, and what still waits on the human.
 *
 * If a reader needs to open the old conversation to act, this file is broken.
 */

import { sectionLabel } from './memory.js'

/** 给「关键坐标」预留的字数：锚点是压缩后唯一活下来的硬事实，不能被边界条数挤掉。 */
const ANCHOR_RESERVE = 900
/** 一段分不到这个额度就整段不进，免得留下来只剩一个标题。 */
const MIN_SECTION = 100

function clip(text, limit) {
  const value = String(text === undefined || text === null ? '' : text).replace(/\r/g, '').trim()
  return value.length > limit ? value.slice(0, limit) + '…' : value
}

function stamp(at) {
  if (!at) return '—'
  const date = new Date(at)
  const pad = value => String(value).padStart(2, '0')
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
}

function shortId(id) {
  return String(id || '').replace(/^session-/, '').slice(0, 8)
}

// Session id or plain actor label: the packet says who set the objective, and
// claiming 会话 for a label that is not one sends the reader looking for a
// truncated id that never existed.
function ownerName(id) {
  const text = String(id || '')
  return text.indexOf('session-') === 0 ? '会话 ' + shortId(text) : text
}

/**
 * 段尾的「交代行」：告诉读者这一段没装完、剩下的去哪取。
 * 行级兜底遇到它们要优先保住——同一条单子里，读者知道自己漏了什么
 * 比多读一条条目重要。
 */
const TAIL_NOTICE = /^(?:…还有|…另有|（正文太长|（按预算)/

function isTailNotice(line) {
  return TAIL_NOTICE.test(String(line || '').trim())
}

function tagged(board, tag) {
  const needle = String(tag).toLowerCase()
  return (board.notes || []).filter(note => (note.tags || []).some(item => String(item).toLowerCase() === needle))
}

/**
 * 整项装入：只收整条，收不下就停，并给出「还有 N 条没进」的提示。
 * 一张单子里最贵的资产（锚点、边界、断点）宁可少收，也不在半句处切断——
 * 半句的路径和半句的命令比没有更危险。
 */
function takeWhole(items, room, hintFor) {
  const kept = []
  let used = 0
  for (const item of items) {
    if (used + item.length + 1 > room) break
    kept.push(item)
    used += item.length + 1
  }
  const rest = items.length - kept.length
  return { kept, rest, hint: rest > 0 ? hintFor(rest) : '' }
}

/**
 * @param board      the stored board
 * @param boundaries the live boundary facts from the Host, or {}
 * @param budget     maximum characters for the whole packet
 * @param viewer     who is rendering this packet right now: a Session id, or a
 *                   plain actor label. It is NOT read off the board on purpose —
 *                   see the note at the byline below.
 */
export function renderHandoff(board, boundaries, budget = 5200, viewer = '', extras) {
  try {
    const b = board || {}
    const limits = boundaries || {}
    const plan = Array.isArray(b.plan) ? b.plan : []
    const tasks = Array.isArray(b.tasks) ? b.tasks : []
    const log = Array.isArray(b.log) ? b.log : []
    const memory = Array.isArray(b.memory) ? b.memory : []
    const done = tasks.filter(task => task.status === 'done')
    const open = tasks.filter(task => task.status !== 'done')
    const doing = open.filter(task => task.status === 'doing')
    const blocked = open.filter(task => task.status === 'blocked')
    const openSteps = plan.filter(step => !step.done)
    const doneSteps = plan.filter(step => step.done)
    const bounds = b.bounds || { allowed: [], forbidden: [], notes: [] }
    const anchors = tagged(b, 'anchor')
    const deadEnds = tagged(b, 'dead-end')
    const decisions = tagged(b, 'decision')
    const evidence = done.filter(task => task.evidence)

    const head = []
    head.push('# 交接单 · ' + (clip(b.objective, 48) || '（未写目标）'))
    // 落款说的是「谁把这张单子渲染出来的」，不是「谁上次盖过章」。
    // 旧写法读 b.handoff.session：没盖过章就打成「会话 —」，盖过章就把上一个
    // 交班的人当成生成者——两种都在骗读者。生成者只有调用方知道，所以从参数进来。
    head.push('生成 ' + stamp(Date.now()) + ' · 生成者 ' + (viewer ? clip(ownerName(viewer), 40) : '未指名（直接渲染）') + ' · 板子 rev ' + stamp(b.updatedAt))
    if (b.handoff && b.handoff.at) {
      // 盖章是另一件事：它说的是「这张单子被正式交出过」，交班人可能是上一个会话。
      // 章上既记了动作方（by）也记了会话（session），两个都写出来，读者才不会把
      // 「谁交的」和「谁生成的」搅在一起。
      const stampWho = []
      if (b.handoff.by) stampWho.push(clip(b.handoff.by, 20))
      if (b.handoff.session) stampWho.push(ownerName(b.handoff.session))
      head.push('最近一次交接盖章 ' + stamp(b.handoff.at) + (stampWho.length ? '（' + stampWho.join(' · ') + '）' : ''))
    }
    head.push('')
    head.push('## 一句话')
    head.push(clip(b.objective, 300) || '（板上没有写目标：先补一句再动手）')
    if (b.objectiveBy) head.push('（由' + ownerName(b.objectiveBy) + ' 于 ' + stamp(b.objectiveAt) + ' 设定）')
    head.push('')

    // 「别做的事」是这张单子的底线：读者即使只读了最后几行，也必须看见这四条。
    // 所以它先算好成本，后面每一段都为它留出位置。
    const tail = [
      '## 别做的事',
      '- 不要回翻旧会话、不要解压缩历史摘要：这份单子就是全部所需。真要实现细节，读上面的路径，不要去猜。',
      '- 不要重做「已完成」里带证据的条目；要改先读证据，确认它真的错了。',
      '- 不要把未验证的东西写成已完成；验收口径不清就先问。',
      '- 改板子用 chief_board（snapshot / task.* / plan.set / note.write / log.add），人和你看同一份。',
    ]
    const tailReserve = tail.join('\n').length + 2
    const anchorReserve = anchors.length ? ANCHOR_RESERVE : 0

    // 任务树：父子关系是结构信息，比 flat 列表更能告诉接手人「这条任务属于谁」。
    // 排在「接下来按这个顺序做」之前——读者先看到全貌，再看顺序。
    const taskTreeLines = (() => {
      const childrenOf = {}
      for (const task of tasks) {
        const pid = String(task.parentId || '')
        if (!childrenOf[pid]) childrenOf[pid] = []
        childrenOf[pid].push(task)
      }
      const roots = tasks.filter(task => {
        const pid = String(task.parentId || '')
        return !pid || pid === ' ' || !tasks.some(t => t.id === pid)
      })
      const lines = []
      const walk = (task, depth) => {
        const status = task.status === 'done' ? '✓' : task.status === 'doing' ? '◐' : task.status === 'blocked' ? '✗' : '○'
        const deps = (task.blockedBy || []).length ? ' [等 ' + (task.blockedBy || []).map(id => shortId(id)).join(',') + ']' : ''
        const unverified = (task.assumptions || []).filter(a => !a.verified).length
        const warn = unverified ? ' ⚠' + unverified : ''
        lines.push('  '.repeat(depth) + status + ' ' + clip(task.title, 50) + deps + warn + '（' + shortId(task.id) + '）')
        const kids = (childrenOf[task.id] || []).filter(t => t.status !== 'done')
        for (const kid of kids) walk(kid, depth + 1)
      }
      for (const root of roots) {
        if (root.status === 'done' && !(childrenOf[root.id] || []).some(t => t.status !== 'done')) continue
        walk(root, 0)
      }
      return lines
    })()

    // 段序就是读者需要的顺序。每段自己按分到的额度裁剪，前面的段不许花掉后面段
    // 的预留——旧写法是全部拼好再按字数砍尾巴，边界一多就把「关键坐标」和「已
    // 完成与证据」整段砍掉，且不留任何提示。
    // 官方 AgentTeam 任务：digest 里有交接单也该有，多代理接手时得看到团队板。
    const teamTasks = Array.isArray(extras && extras.teamTasks) ? extras.teamTasks : []
    const teamTaskLines = (() => {
      if (!teamTasks.length) return []
      const open = teamTasks.filter(t => t.status !== 'completed' && t.status !== 'deleted')
      const done = teamTasks.filter(t => t.status === 'completed')
      const lines = ['## 团队共享任务（' + open.length + ' 项' + (done.length ? '，' + done.length + ' 已完成' : '') + '）']
      for (const t of open.slice(0, 8)) {
        const status = t.status === 'in_progress' ? 'doing' : t.status === 'completed' ? 'done' : t.status || 'pending'
        const owner = t.ownerName ? ' → ' + clip(t.ownerName, 20) : ''
        const deps = (Array.isArray(t.blockedBy) ? t.blockedBy : []).length && t.status !== 'completed' ? ' [等 ' + t.blockedBy.join(',') + ']' : ''
        lines.push('- [' + status + '] ' + clip(t.id, 12) + ' ' + clip(t.subject, 60) + owner + deps)
      }
      if (open.length > 8) lines.push('…另有 ' + (open.length - 8) + ' 项（调 team_task_list 看全量）')
      return lines
    })()

    const sections = [
      {
        key: '任务树',
        hold: anchorReserve + tailReserve,
        build: room => {
          if (!taskTreeLines.length) return []
          const lines = ['## 任务树（父子结构）']
          const take = takeWhole(taskTreeLines, room - lines[0].length - 1, rest => '…还有 ' + rest + ' 条任务没进（用 chief_board snapshot 看全量）')
          for (const item of take.kept) lines.push(item)
          if (take.hint) lines.push(take.hint)
          return lines
        },
      },
      {
        key: '团队任务',
        hold: anchorReserve + tailReserve,
        build: room => {
          if (!teamTaskLines.length) return []
          const take = takeWhole(teamTaskLines, room, rest => '…还有 ' + rest + ' 条团队任务没进（调 team_task_list 看全量）')
          const lines = []
          for (const item of take.kept) lines.push(item)
          if (take.hint) lines.push(take.hint)
          return lines
        },
      },
      {
        key: '现在在哪',
        hold: anchorReserve + tailReserve,
        build: room => {
          const lines = ['## 现在在哪']
          const cursor = b.cursor || {}
          const hasCursor = !!(cursor.step || cursor.next || cursor.blocked)
          if (hasCursor) {
            // 断点是下一句该敲什么，换会话后无法从规划里推出来：先给它位置。
            if (cursor.step) lines.push('- 做到：' + clip(cursor.step, 220))
            if (cursor.next) lines.push('- 下一句就做：' + clip(cursor.next, 220))
            if (cursor.blocked) lines.push('- 卡在：' + clip(cursor.blocked, 220))
            lines.push('（断点由 ' + (shortId(cursor.session) || '—') + ' 于 ' + stamp(cursor.at) + ' 写下）')
          }
          lines.push('规划 ' + doneSteps.length + '/' + plan.length + ' 步完成 · 待办 ' + open.length + ' 条（进行中 ' + doing.length + ' / 受阻 ' + blocked.length + '）· 已完成 ' + done.length + ' 条')
          const doingLines = doing.slice(0, 4).map(task => '正在做: ' + clip(task.title, 90) + (task.intent ? ' → 打算 ' + clip(task.intent, 120) : ''))
          const left = room - lines.join('\n').length - 1
          const take = takeWhole(doingLines, left, rest => '…还有 ' + rest + ' 条「正在做」没进（用 chief_board snapshot 看全量）')
          for (const line of take.kept) lines.push(line)
          if (take.hint) lines.push(take.hint)
          return lines
        },
      },
      {
        key: '这一程记住的（本会话自动记忆）',
        hold: anchorReserve + tailReserve,
        build: room => {
          const lines = ['## 这一程记住的（本会话自动记忆）']
          if (!memory.length) {
            lines.push('（这个会话还没攒出记忆：参谋看板会在每轮结束时自己写一条，这里空着说明它还没关过轮）')
            return lines
          }
          const items = memory.slice(-6).map(item => {
            const row = ['- [' + sectionLabel(item.section) + '] ' + clip(item.title || item.text, 90)]
            if (item.text && item.title) row.push('  ' + clip(item.text, 180))
            if ((item.tools || []).length) row.push('  用过：' + clip(item.tools.join(' / '), 120))
            return row.join('\n')
          })
          const left = room - lines[0].length - 1
          const take = takeWhole(items, left, rest => '…还有 ' + rest + ' 条记忆没进（在右上角参谋看板的「记忆」页签里看全文）')
          for (const item of take.kept) lines.push(item)
          if (take.hint) lines.push(take.hint)
          return lines
        },
      },
      {
        key: '接下来按这个顺序做',
        hold: anchorReserve + tailReserve,
        build: room => {
          const lines = ['## 接下来按这个顺序做']
          const items = []
          if (openSteps.length) {
            openSteps.slice(0, 8).forEach((step, index) => items.push((index + 1) + '. ' + clip(step.text, 160)))
          } else if (open.length) {
            items.push('（规划已全部完成，接着做这些待办）')
            open.slice(0, 8).forEach((task, index) => {
              const tag = task.status === 'blocked' && task.blockedReason
                ? '（卡在：' + clip(task.blockedReason, 60) + '）'
                : task.status === 'blocked' ? '（卡在：受阻）' : ''
              items.push((index + 1) + '. ' + clip(task.title, 160) + tag)
            })
          } else {
            items.push('（板上没有下一步：先问用户这一段要达成什么）')
          }
          for (const task of open.filter(item => item.status !== 'doing').slice(0, 6)) {
            const intent = task.intent ? '打算：' + clip(task.intent, 140) : ''
            const judge = task.note ? '判据：' + clip(task.note, 140) : ''
            if (intent || judge) items.push('   · ' + clip(task.title, 70) + ' — ' + [intent, judge].filter(Boolean).join('；'))
          }
          const left = room - lines[0].length - 1
          const take = takeWhole(items, left, rest => '…还有 ' + rest + ' 条没进（用 chief_board snapshot 看全量）')
          for (const item of take.kept) lines.push(item)
          if (take.hint) lines.push(take.hint)
          return lines
        },
      },
      {
        key: '边界（动手前先读这段）',
        hold: anchorReserve + tailReserve,
        build: room => {
          const lines = ['## 边界（动手前先读这段）']
          const mode = limits.sessionSandboxMode || limits.sandboxMode || 'unknown'
          lines.push('- 沙箱：' + mode + (limits.sessionSandboxOverride ? '（会话覆盖）' : '（部署默认）') + ' · 默认 ' + (limits.sandboxMode || '—'))
          lines.push('- 本会话目录：' + (limits.sessionWorkingDirectory || limits.workingDirectory || '—'))
          lines.push('- 部署默认可写根（会话没有 cwd 时用它）：' + (limits.workspaceRoot || '—') + (limits.extraWritableRoots ? ' + ' + limits.extraWritableRoots.join(', ') : ''))
          const items = []
          // 顺序就是优先级：空间不够时先丢「注意」，绝不先丢「禁止」与「必做」。
          // 板子对每个数组各有 20 条上限，所以最坏是 60 条，挤爆时必须靠这个次序活着。
          for (const forbidden of bounds.forbidden) items.push({ label: '禁止', cap: 200, text: forbidden })
          for (const allowed of bounds.allowed) items.push({ label: '必做', cap: 200, text: allowed })
          for (const note of bounds.notes) items.push({ label: '注意', cap: 240, text: note })
          if (!items.length) return lines
          const left = room - lines.join('\n').length - 2
          // 先按「每条都至少还读得懂」的下限排；排不下就让 takeWhole 从队尾丢
          // （队尾就是「注意」），并写明还有几条没列出。
          // 反面教材：把 60 条全压到 24 字，一条条都是「禁止 第1条：bbbb…」，
          // 读者既不知道禁的是什么，也不知道自己漏了什么，比少列几条贵得多。
          const share = Math.floor(left / items.length) - 8
          const built = items.map(item => '- ' + item.label + '：' + clip(item.text, Math.max(40, Math.min(item.cap, share))))
          const take = takeWhole(built, left, rest => '…还有 ' + rest + ' 条边界没列出（用 chief_board snapshot 取全量）')
          for (const line of take.kept) lines.push(line)
          if (take.hint) lines.push(take.hint)
          return lines
        },
      },
      {
        key: '主动取出的工程档案（本会话桌面备查）',
        hold: tailReserve,
        build: room => {
          const taken = extras && Array.isArray(extras.takenOutArchives) ? extras.takenOutArchives : []
          if (!taken.length) return []
          const lines = ['## 主动取出的工程档案（本会话桌面备查）']
          const shown = taken.slice(0, 4)
          const left = room - lines[0].length - 2
          const share = Math.max(80, Math.floor(left / shown.length) - 16)
          const items = shown.map(item => {
            const pts = (Array.isArray(item.points) ? item.points : [])
              .slice(0, 4)
              .map((p, idx) => `${idx + 1}) ${clip(p.title, 40)}: ${clip(p.cue || p.detail, 90)}`)
              .join('\n')
            return '### ' + clip(item.title, 60) + '\n' + clip(pts || item.summary || item.body, Math.min(420, share))
          })
          const take = takeWhole(items, left, rest => '…还有 ' + rest + ' 份取出的档案未列出（用 chief_board archive.read 按需调取）')
          for (const item of take.kept) lines.push(item)
          if (take.hint) lines.push(take.hint)
          return lines
        },
      },
      {
        key: '关键坐标（压缩会丢，所以写在这里）',
        // 只有 tailReserve 要留：锚点自己在为后面的段让路，不许别人再挤它。
        hold: tailReserve,
        build: room => {
          if (!anchors.length) return []
          const lines = ['## 关键坐标（压缩会丢，所以写在这里）']
          const shown = anchors.slice(0, 6)
          const left = room - lines[0].length - 2
          // 先保证每条都有名有正文：等额分配，再谈正文多长。
          const share = Math.floor(left / shown.length) - 12
          const items = shown.map(note => '### ' + clip(note.title, 60) + '\n' + clip(note.body, Math.max(60, Math.min(480, share))))
          let take = takeWhole(items, left, rest => '…还有 ' + rest + ' 条锚点没进（用 chief_board snapshot 取全量）')
          if (!take.kept.length && left > 40) {
            // 连一条都装不下：至少把标题留住，让读者知道去哪取。
            const titles = shown.map(note => '### ' + clip(note.title, 60))
            take = takeWhole(titles, left, rest => '…还有 ' + rest + ' 条锚点没进（用 chief_board snapshot 取全量）')
            for (const line of take.kept) lines.push(line)
            lines.push('（正文太长，这里只列了标题：全文用 chief_board snapshot 取）')
            if (anchors.length > 6) lines.push('…另有 ' + (anchors.length - 6) + ' 条锚点未列出')
            return lines
          }
          for (const item of take.kept) lines.push(item)
          if (take.hint) lines.push(take.hint)
          if (anchors.length > 6) lines.push('…另有 ' + (anchors.length - 6) + ' 条锚点未列出（用 chief_board snapshot 取全量）')
          return lines
        },
      },
      {
        key: '已完成与证据',
        hold: tailReserve,
        build: room => {
          if (!evidence.length) return []
          const lines = ['## 已完成与证据']
          const items = evidence.slice(0, 8).map(task => '- ' + clip(task.title, 80) + ' — ' + clip(task.evidence, 220))
          const left = room - lines[0].length - 1
          const take = takeWhole(items, left, rest => '…还有 ' + rest + ' 条已完成的证据没进（用 chief_board snapshot 看全量）')
          for (const item of take.kept) lines.push(item)
          if (take.hint) lines.push(take.hint)
          return lines
        },
      },
      {
        key: '试过但没走通（别再试一遍）',
        hold: tailReserve,
        build: room => {
          if (!deadEnds.length) return []
          const lines = ['## 试过但没走通（别再试一遍）']
          const items = deadEnds.slice(0, 6).map(note => '- ' + clip(note.title, 50) + '：' + clip(note.body, 260))
          const left = room - lines[0].length - 1
          const take = takeWhole(items, left, rest => '…还有 ' + rest + ' 条失败记录没进（用 chief_board snapshot 看全量）')
          for (const item of take.kept) lines.push(item)
          if (take.hint) lines.push(take.hint)
          return lines
        },
      },
      {
        key: '等用户决定',
        hold: tailReserve,
        build: room => {
          if (!decisions.length) return []
          const lines = ['## 等用户决定']
          const items = decisions.slice(0, 6).map(note => '- ' + clip(note.title, 50) + '：' + clip(note.body, 260))
          const left = room - lines[0].length - 1
          const take = takeWhole(items, left, rest => '…还有 ' + rest + ' 条待定没进（用 chief_board snapshot 看全量）')
          for (const item of take.kept) lines.push(item)
          if (take.hint) lines.push(take.hint)
          return lines
        },
      },
      {
        key: '最近交接痕迹',
        hold: tailReserve,
        build: room => {
          if (!log.length) return []
          const lines = ['## 最近交接痕迹']
          const items = log.slice(-5).map(entry => '- ' + stamp(entry.at) + ' ' + clip(entry.by || '?', 12) + (entry.session ? '(' + shortId(entry.session) + ')' : '') + '：' + clip(entry.text, 100))
          const left = room - lines[0].length - 1
          const take = takeWhole(items, left, rest => '…还有 ' + rest + ' 条痕迹没进（用 chief_board snapshot 看全量）')
          for (const item of take.kept) lines.push(item)
          if (take.hint) lines.push(take.hint)
          return lines
        },
      },
    ]

    const body = []
    const dropped = []
    // 「哪些段没进」这行提示也要占字，先给它留出来，否则预算恰好在边界上时
    // 整张单子会超出 budget 一截。
    const hintReserve = sections.length ? 130 : 0
    let used = head.join('\n').length + 1 + hintReserve
    for (const section of sections) {
      const room = budget - used - (section.hold || 0)
      if (room < MIN_SECTION) {
        dropped.push(section.key)
        continue
      }
      const lines = section.build(room)
      if (!lines.length) continue
      let block = lines.join('\n')
      if (block.length > room) {
        // 兜底：整行丢弃，绝不在半句处切断。
        // 但段尾那几行「…还有 N 条没列出」是这张单子里唯一的交代：读者正是
        // 靠它知道自己漏了什么。所以先把它们摘出来留好位，再从前往后装。
        // 反面教材：直接从头逐行 break，第一版就是这么把「还有 39 条边界没列出」
        // 连同整行一起砍掉的 —— 单子上看不出少了一半，读者以为自己读到了全部。
        const notices = []
        while (lines.length && isTailNotice(lines[lines.length - 1])) notices.unshift(lines.pop())
        const noticeSize = notices.reduce((sum, line) => sum + line.length + 1, 0)
        const fill = room - noticeSize
        const kept = []
        let size = 0
        for (const line of lines) {
          if (size + line.length + 1 > fill) break
          kept.push(line)
          size += line.length + 1
        }
        if (!kept.length && !notices.length) {
          dropped.push(section.key)
          continue
        }
        // 连一条正文都装不下时，至少把交代行留下：读者要知道自己没读到全部。
        block = kept.concat(notices).join('\n')
        dropped.push(section.key + (kept.length ? '（截断）' : '（只留了交代行）'))
      }
      body.push(block)
      used += block.length + 1
    }

    const out = head.concat(body)
    if (dropped.length) {
      out.push('（按预算装了这一份，没进或只进了一部分的段：' + dropped.join('、') + '。要全量用 chief_board snapshot，或直接读 board.json。）')
    }
    out.push('')
    for (const line of tail) out.push(line)
    return out.join('\n')
  } catch (error) {
    return '# 交接单生成失败\n' + String((error && error.message) || error)
  }
}
