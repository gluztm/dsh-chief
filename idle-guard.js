/**
 * Idle-turn guard.
 *
 * A turn can close with the model having said one or two sentences and called
 * nothing — no tool, no edit, no board write. When the chief still holds open
 * work, that close is premature: the next reader (the human, or a fresh Session
 * after a handoff) sees an answer that claims progress nothing backs.
 *
 * The guard runs inside `agent/turn-stopping`, which the loop awaits BEFORE the
 * turn commits and re-reads its inbox afterwards:
 *
 *   if (turnEnds && this.inbox.nextStep.length === 0)
 *     await this.dispatch.serial('agent/turn-stopping', { turn, signal })
 *   if (turnEnds && this.inbox.nextStep.length === 0) break
 *
 * so a `agent.steer(message)` here puts one message in `next-step` and the loop
 * runs one more step instead of closing. Nothing else in the plugin can do that.
 *
 * The judgment is about RECORDING, not about tool use. A turn that ran ten
 * commands but never touched the plan leaves the same unreadable board as a
 * turn that did nothing, and the next reader cannot tell the two apart. So the
 * gate is "did this turn write the plan or move a cursor", never "did it call
 * some tool" — the latter is what made the guard silent through the exact case
 * it exists for.
 *
 * Three shapes fire, each capped so a stubborn model cannot loop forever:
 *   1. idle-close  — open work on the board, short answer, nothing recorded.
 *   2. stale-plan  — open steps, real work done, but the plan was not moved.
 *   3. no-plan     — the turn worked with an empty plan: nothing is open only
 *                    because nothing was ever written down.
 * A cursor that names a step ("step") but was not refreshed this turn makes
 * stale-plan say so explicitly: the notice then reads "you said you were doing
 * X — still doing it?" instead of the generic "the plan did not move".
 * Plain Q&A on an empty board is still left alone: no tool call, no plan, short
 * answer is ordinary conversation, and the guard must not tax it.
 */

/** Producer-owned source kind; must be non-empty and never "plugin". */
export const IDLE_SOURCE = { kind: 'dsh-chief-idle-guard' }

/** How many interventions one Session may take before the guard goes quiet. */
export const DEFAULT_MAX_PER_SESSION = 3

/** Default ceiling for a still-short answer, in characters. */
export const DEFAULT_SHORT_ANSWER = 600

/**
 * The two numbers the guard decides with, read from the machine's settings so a
 * busy operator can loosen them without editing the package. Clamped here, not
 * at the write site: a hand-edited board file must not be able to turn the
 * guard into a loop machine (0 nudges off is fine, 500 is not).
 */
export function guardLimits(settings) {
  const flags = settings || {}
  return {
    maxPerSession: countOr(flags.guardMaxPerSession, DEFAULT_MAX_PER_SESSION, 0, 20),
    shortAnswer: countOr(flags.guardShortAnswer, DEFAULT_SHORT_ANSWER, 0, 10000),
  }
}

function countOr(value, fallback, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

/**
 * The board actions that count as recording progress. A `chief_board` call
 * that only reads (snapshot) is not progress; moving a task, rewriting the
 * plan, or stamping the cursor is. Kept as one regex because the call ledger
 * only carries `arguments` as a JSON string, never as an object.
 */
const PLAN_WRITE_ACTION = /"action"\s*:\s*"(?:plan\.set|graph\.plan|task\.add|task\.batch|task\.update|task\.claim|task\.release|task\.dispatch|task\.verify|team\.steer|team\.interrupt|cursor\.set)"/

/**
 * Whether one tool call moved the board. `todo_write` and subagent delegations
 * always count (the host mirrors them into the plan/task graph); `chief_board`
 * counts only for the writing actions, so a snapshot does not silence the guard.
 */
export function isPlanWrite(name, argumentsValue) {
  const tool = String(name || '')
  if (tool === 'todo_write' || tool === 'subagent' || tool === 'subagent_fork' || tool === 'send_message') return true
  if (tool !== 'chief_board') return false
  return PLAN_WRITE_ACTION.test(String(argumentsValue === undefined || argumentsValue === null ? '' : argumentsValue))
}

/** Per-Session id → Set of turns that wrote the plan. */
const planWriteTurns = new Map()

function planWriteSet(sessionId) {
  let set = planWriteTurns.get(sessionId)
  if (!set) {
    set = new Set()
    planWriteTurns.set(sessionId, set)
    if (planWriteTurns.size > 64) {
      const oldest = planWriteTurns.keys().next().value
      if (oldest !== undefined && oldest !== sessionId) planWriteTurns.delete(oldest)
    }
  }
  return set
}

/** Record that this turn moved the plan or the cursor. */
export function notePlanWrite(sessionId, turn) {
  const id = String(sessionId || '')
  const value = Number(turn)
  if (!id || !Number.isFinite(value)) return
  const set = planWriteSet(id)
  set.add(value)
  if (set.size > 64) planWriteTurns.set(id, new Set([...set].sort((a, b) => b - a).slice(0, 32)))
}

/**
 * Same-call repetition is the other way a turn stops moving: it re-runs the
 * failing command, re-writes the same file, re-reads the same path. No plan
 * check can see it — the plan can look healthy while nothing advances — so it
 * needs its own ledger, and the only lever the host exposes is a steer.
 */
const LOOP_REPEAT = 4

/** A session's recent calls, capped, so one long turn cannot grow it forever. */
const callTrail = new Map()

/** Tools whose identical repetition is ordinary, not a stuck loop. */
const READ_ONLY_ACTION = /"action"\s*:\s*"(?:snapshot|memory\.ask)"/u

function isReadOnlyCall(name, argumentsValue) {
  if (String(name || '') !== 'chief_board') return false
  return READ_ONLY_ACTION.test(String(argumentsValue === undefined || argumentsValue === null ? '' : argumentsValue))
}

function hashCall(name, argumentsValue) {
  const text = String(name || '') + '\u0000'
    + String(argumentsValue === undefined || argumentsValue === null ? '' : argumentsValue)
  let hash = 5381
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0
  }
  return hash.toString(36) + ':' + text.length.toString(36)
}

export function noteCallTrail(sessionId, name, argumentsValue) {
  const id = String(sessionId || '')
  let trail = callTrail.get(id)
  if (!trail) {
    trail = []
    callTrail.set(id, trail)
    if (callTrail.size > 64) {
      const oldest = callTrail.keys().next().value
      if (oldest !== undefined && oldest !== id) callTrail.delete(oldest)
    }
  }
  trail.push({
    key: hashCall(name, argumentsValue),
    name: String(name || ''),
    readOnly: isReadOnlyCall(name, argumentsValue),
    preview: String(argumentsValue === undefined || argumentsValue === null ? '' : argumentsValue).slice(0, 120),
  })
  if (trail.length > 16) trail.splice(0, trail.length - 16)
}

/** Read-only repeats get a higher bar: re-reading after each edit is normal. */
const LOOP_REPEAT_READ = LOOP_REPEAT + 3

/**
 * The tail of this Session's calls when the same (name, arguments) pair has
 * just repeated. Returns null for anything less: the same tool with different
 * arguments is a normal sweep, not a loop.
 */
export function turnLooping(sessionId) {
  const trail = callTrail.get(String(sessionId || ''))
  if (!trail || trail.length < LOOP_REPEAT) return null
  const last = trail[trail.length - 1]
  let count = 0
  for (let index = trail.length - 1; index >= 0; index -= 1) {
    if (trail[index].key !== last.key) break
    count += 1
  }
  if (count < (last.readOnly ? LOOP_REPEAT_READ : LOOP_REPEAT)) return null
  return { name: last.name, preview: last.preview, count }
}

/** Forget the trail after it was acted on, so the next turn starts clean. */
export function clearCallTrail(sessionId) {
  callTrail.delete(String(sessionId || ''))
}

/**
 * Whether this turn recorded anything on the board. Same shape as
 * `turnHadToolCall`: the incremental ledger first, then a bounded scan of the
 * Session log, so a missed event cannot make the guard cry wolf about work
 * that did happen.
 */
export function turnWrotePlan(sessionId, turn, session) {
  const id = String(sessionId || '')
  const value = Number(turn)
  if (id && planWriteSet(id).has(value)) return true
  if (!session || typeof session.snapshotEvents !== 'function') return false
  try {
    const events = session.snapshotEvents()
    const from = Math.max(0, events.length - 400)
    for (let index = events.length - 1; index >= from; index -= 1) {
      const event = events[index]
      if (!event || !event.data || event.data.turn !== value) continue
      if (event.type !== 'tool/call') continue
      if (isPlanWrite(event.data.name, event.data.arguments)) return true
    }
  } catch {}
  return false
}

/**
 * The board actions that write the objective itself, as opposed to the step
 * list standing in for it. `plan.set` carries an optional objective, so it
 * counts when the argument is present.
 */
const GOAL_WRITE_ACTION = /"action"\s*:\s*"(?:objective\.set|plan\.set)"/u
const GOAL_ARGUMENT = /"objective"\s*:\s*"[^"]/u

/**
 * Whether this turn stated a goal. Scanned rather than ledgered: a goal write
 * happens at most a handful of times per Session, so the bounded scan costs
 * nothing and needs no second map to keep in sync.
 */
export function turnWroteGoal(sessionId, turn, session) {
  if (!session || typeof session.snapshotEvents !== 'function') return false
  const value = Number(turn)
  try {
    const events = session.snapshotEvents()
    const from = Math.max(0, events.length - 400)
    for (let index = events.length - 1; index >= from; index -= 1) {
      const event = events[index]
      if (!event || !event.data || event.data.turn !== value) continue
      if (event.type !== 'tool/call') continue
      if (String(event.data.name || '') !== 'chief_board') continue
      const text = String(event.data.arguments === undefined || event.data.arguments === null ? '' : event.data.arguments)
      if (!GOAL_WRITE_ACTION.test(text)) continue
      if (GOAL_ARGUMENT.test(text)) return true
    }
  } catch {}
  return false
}

/**
 * The last turn this Session was already nudged in. Steering re-opens the same
 * turn, so without this record a model that answers twice would be nudged twice
 * inside one turn — one nudge per turn is the useful shape.
 */
const nudgedTurn = new Map()

/** Incremental `tool/call` bookkeeping, keyed by Session id → Set of turns. */
const toolCallTurns = new Map()

/** Intervention counts per Session, so the cap survives board reloads. */
const interventions = new Map()

function turnSet(sessionId) {
  let set = toolCallTurns.get(sessionId)
  if (!set) {
    set = new Set()
    toolCallTurns.set(sessionId, set)
    if (toolCallTurns.size > 64) {
      const oldest = toolCallTurns.keys().next().value
      if (oldest !== undefined && oldest !== sessionId) toolCallTurns.delete(oldest)
    }
  }
  return set
}

/** Record that this turn called at least one tool. */
export function noteToolCall(sessionId, turn) {
  const id = String(sessionId || '')
  const value = Number(turn)
  if (!id || !Number.isFinite(value)) return
  turnSet(id).add(value)
  const set = turnSet(id)
  if (set.size > 64) {
    const keep = [...set].sort((a, b) => b - a).slice(0, 32)
    toolCallTurns.set(id, new Set(keep))
  }
}

/**
 * Whether this turn called a tool. Prefers the incremental record and falls
 * back to a bounded scan of the Session log, so a reload or a missed event
 * cannot make the guard fire on work that did happen.
 */
export function turnHadToolCall(sessionId, turn, session) {
  const id = String(sessionId || '')
  const value = Number(turn)
  if (id && turnSet(id).has(value)) return true
  if (!session || typeof session.snapshotEvents !== 'function') return false
  try {
    const events = session.snapshotEvents()
    const from = Math.max(0, events.length - 400)
    for (let index = events.length - 1; index >= from; index -= 1) {
      const event = events[index]
      if (!event || !event.data || event.data.turn !== value) continue
      if (event.type === 'tool/call') return true
    }
  } catch {}
  return false
}

/**
 * Read the visible answer of this turn: how much text it actually printed, and
 * whether an assistant message was committed at all. Reasoning does not count as
 * output — a model that thinks silently and closes has produced nothing the
 * reader can use, which is exactly what the guard exists for.
 */
export function readAnswer(session, turn) {
  const result = { hasMessage: false, chars: 0, thoughtChars: 0 }
  if (!session || typeof session.snapshotEvents !== 'function') return result
  try {
    const events = session.snapshotEvents()
    for (const event of events) {
      if (!event || !event.data || event.data.turn !== turn) continue
      if (event.type !== 'assistant/message') continue
      const message = event.data.message
      result.hasMessage = true
      if (message && Array.isArray(message.content)) {
        for (const block of message.content) {
          if (!block || typeof block.text !== 'string') continue
          if (block.type === 'text') result.chars += block.text.length
          else if (block.type === 'reasoning') result.thoughtChars += block.text.length
        }
      }
    }
  } catch {}
  return result
}

/** Open work on the board: unfinished plan steps and tasks that are not done. */
export function openWork(board) {
  const steps = Array.isArray(board && board.plan) ? board.plan.filter(step => !step.done) : []
  const tasks = Array.isArray(board && board.tasks) ? board.tasks.filter(task => task.status !== 'done') : []
  return { steps, tasks, total: steps.length + tasks.length }
}

/**
 * Decide whether this close is premature. Every condition must hold, so the
 * guard stays out of ordinary conversation.
 */
export function shouldGuard({ board, session, sessionId, turn, settings }) {
  const flags = settings || {}
  if (flags.guardIdle === false) return null
  // One nudge per turn: steering re-opens the same turn, so a second close in
  // that turn must not steer again or the model could be nudged forever.
  if (nudgedTurn.get(String(sessionId || '')) === Number(turn)) return null

  const used = interventions.get(String(sessionId)) || 0
  const limits = guardLimits(flags)
  if (used >= limits.maxPerSession) return null

  const answer = readAnswer(session, turn)
  // No committed answer means the turn produced nothing for the reader yet;
  // it may still be mid-flight or aborted, and neither is the guard's business.
  if (!answer.hasMessage) return null

  const work = openWork(board)
  const wrote = turnWrotePlan(sessionId, turn, session)
  const called = turnHadToolCall(sessionId, turn, session)

  // Shape 4, loop: the same call repeated without changing anything. Checked
  // before the plan shapes because a stuck turn satisfies every plan condition
  // — it is calling tools, and a rewrite of the plan would only hide the stall.
  if (called) {
    const loop = turnLooping(sessionId)
    if (loop) return { kind: 'loop', work, answer, loop }
  }

  // Shape 5, no-goal: a board run in goal mode with no objective has nothing to
  // steer toward, so every step list written on it is decoration. A turn that
  // set the objective is done with this question, whatever else it did.
  const objective = String((board && board.objective) || '').trim()
  if ((board && board.mode) === 'goal' && !objective) {
    if (!called || turnWroteGoal(sessionId, turn, session)) return null
    return { kind: 'no-goal', work, answer }
  }

  // Shape 3, no-plan: the board never held a plan or task graph, so nothing can
  // be "open". A turn that actually did work leaves the reader with no record
  // of what it was doing or what comes next.
  const hasPlan = Array.isArray(board && board.plan) && board.plan.length > 0
  const hasTaskGraph = Array.isArray(board && board.tasks) && board.tasks.length > 0
  if (!hasPlan && !hasTaskGraph) {
    if (!called || wrote) return null
    return { kind: 'no-plan', work, answer }
  }

  // A board whose steps are all done and whose tasks are all closed is a clean
  // board: there is no next step to demand, so the plan question is moot.
  if (work.total === 0) return null
  if (wrote) return null

  // Shape 1, idle-close: no tool call at all and a short answer. Shape 2,
  // stale-plan: real work was done, the plan was left where it was. A long
  // answer without a tool call stays alone — that is prose, not progress.
  if (!called) {
    if (answer.chars > limits.shortAnswer) return null
    return { kind: 'idle-close', work, answer }
  }
  return { kind: 'stale-plan', work, answer }
}

/**
 * Build the single message the guard steers in. Shaped as a plain user message
 * with a fresh identity: the inbox only needs unique ids, and the durable log
 * needs a producer-owned source kind.
 *
 * The opening line names the actual failure, because the three shapes need
 * three different repairs: a silent turn must start working, a working turn
 * must move the plan, and a planless turn must write one down first. Telling a
 * busy turn "you did not call any tool" would be a lie the model can disprove
 * from its own transcript, which is the fastest way to lose its attention.
 */
export function buildNotice({ kind, work, answer, loop, board }) {
  const steps = work.steps.slice(0, 3).map(step => '· ' + String(step.text).slice(0, 80))
  const tasks = work.tasks.slice(0, 3).map(task => '· ' + String(task.title).slice(0, 80))
  const counting = '(' + work.steps.length + ' 个规划步骤 / ' + work.tasks.length + ' 条待办)'
  const cursorStep = String((board && board.cursor && board.cursor.step) || '').slice(0, 80)
  const lines = ['[参谋看板 · 空转拦截]']
  if (kind === 'loop') {
    const call = loop || { name: '?', preview: '', count: 0 }
    lines.push(
      '同一个调用你已经连着做了 ' + call.count + ' 次，参数一个字都没变：' + call.name
        + (call.preview ? ' ' + call.preview : '') + '。'
        + '同样输入只会得到同样结果 —— 这不是在推进，是在原地转。',
    )
  } else if (kind === 'no-goal') {
    lines.push(
      '参谋看板处在「持续目标」模式，但板子上连一句目标都没有：这轮做了 ' + work.total
        + ' 项 ' + counting + '，却没有一句能说明这些动作是为了什么。'
        + '没有目标，步骤列表接着改也只是原地打转。',
    )
  } else if (kind === 'no-plan') {
    lines.push(
      '这个会话还没写过规划：这轮动手了，参谋看板上却连一条规划都没有（记忆里也没有下一步）。'
        + '换一个人接手、或者上下文满了换会话，谁也说不清你要做到哪、做到第几步了。',
    )
  } else if (kind === 'stale-plan') {
    lines.push(
      '你这轮做了事，但规划一步没动：参谋看板上还有 ' + work.total + ' 项没做完 ' + counting + '。'
        + '下一步是什么、刚才那步算不算做完，只能靠猜。',
    )
    if (cursorStep) {
      lines.push('断点上写着「做到: ' + cursorStep + '」—— 这轮做完它了吗？做完了 plan.set 标 done、cursor.set 写下一句；没做完就更新 cursor.set 说清楚卡在哪。')
    }
  } else {
    lines.push(
      '你这轮没有调用任何工具，回答只有 ' + answer.chars + ' 字就收工了，但参谋看板上还有 ' + work.total + ' 项没做完 ' + counting + '。',
    )
  }
  if (steps.length) lines.push('未完成的规划：', ...steps)
  if (tasks.length) lines.push('未完成的待办：', ...tasks)
  if (kind === 'loop') {
    lines.push(
      '不要再用同一个参数试一遍。收工前换一种做法，或者说清楚为什么走不动：',
      '1) 先读一遍上一次的真实输出（报错原文、文件当前内容、接口返回），别凭印象重试，',
      '2) 换维度：缩小范围、换参数、换工具、换路径 —— 只要输入真变了，结果才可能变，',
      '3) 如果确认这条路走不通，就在回答里明说「卡住了，因为 …」，并把卡点写进 chief_board 的 cursor.set(blocked) 与 log.add。',
    )
  } else if (kind === 'no-goal') {
    lines.push(
      '不要就这样结束。先把目标写下来，再谈推进：',
      '1) chief_board objective.set 写一句「这活最终要变成什么样」——一句话，可验收，别写过程，',
      '2) 目标写完后，回答「目标有没有真的前进」，没前进就明说没前进、卡在哪；',
      '3) 如果这活本来就是一串可勾的步骤、不需要持续目标，用 mode.set 回到 plan，别让空目标一直挂着。',
    )
  } else if (kind === 'no-plan') {
    lines.push(
      '不要就这样结束。下一步至少做一件，然后才收工：',
      '1) 先 chief_board plan.set 写下这份活儿的 3–6 步（只写你能立刻推进的，别写愿望清单），',
      '2) 再调工具真正推进第一步（读 / 改 / 跑），',
      '3) 做完就把那一步标 done，并把结论与证据写进板子（task.update 的 evidence）。',
      '如果这轮本来就只是回答问题、不需要动手，就在回答里明确说「本轮无进展，因为 …」，并把原因写进 chief_board 的 log.add。',
    )
  } else if (kind === 'stale-plan') {
    lines.push(
      '不要就这样结束。收工前把板子改成它的实际状态：',
      '1) 做完的步骤 plan.set 标 done，没做的留着，新发现的不确定的写进 cursor.set 的 blocked，',
      '2) cursor.set 写清「做到 / 下一句做 / 卡在」，下一轮或下一个人照着走，',
      '3) 如果确实做完了，把结论与证据写进板子（task.update 的 evidence）再结束。',
      '如果这轮只是探路、确实没有可落地的进展，就在回答里说「本轮无进展，因为 …」，并把原因写进 log.add。',
    )
  } else {
    lines.push(
      '不要就这样结束。下一步至少做一件，然后才收工：',
      '1) 调工具真正推进一项（读 / 改 / 跑），',
      '2) 用 chief_board 把状态改对（task.update 的状态或 plan.set 的 done），',
      '3) 如果确实做完了，把结论与证据写进板子（task.update 的 evidence）再结束。',
      '如果这轮本来就只是回答问题、不需要动手，就在回答里明确说「本轮无进展，因为 …」，并把原因写进 chief_board 的 log.add。',
    )
  }
  return buildMessage(lines.join('\n'))
}

let messageSeq = 0

function buildMessage(text) {
  messageSeq += 1
  const id = 'idle-guard-' + Date.now().toString(36) + '-' + messageSeq.toString(36)
  return {
    id,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { ...IDLE_SOURCE },
  }
}

/** Count one intervention so the per-Session cap is enforced. */
export function noteIntervention(sessionId, turn) {
  const id = String(sessionId || '')
  if (!id) return
  interventions.set(id, (interventions.get(id) || 0) + 1)
  const value = Number(turn)
  if (Number.isFinite(value)) nudgedTurn.set(id, value)
}

/** Reset the guard's per-Session bookkeeping (used by tests and by settings resets). */
export function clearInterventions(sessionId) {
  const id = String(sessionId || '')
  if (!id) {
    interventions.clear()
    nudgedTurn.clear()
    return
  }
  interventions.delete(id)
  nudgedTurn.delete(id)
}

/** Whether this Session still has interventions left (for reporting). */
export function remainingInterventions(sessionId, settings) {
  const limits = guardLimits(settings)
  return Math.max(0, limits.maxPerSession - (interventions.get(String(sessionId || '')) || 0))
}
