/**
 * runtime-hooks.js
 *
 * Cordis plugin lifecycle initialization, board migration, idle guard, auto-continue, routes, and tool registration.
 */

import fs from 'node:fs'
import path from 'node:path'
import { renderDigest } from './digest.js'
import { appendMemory, captureTurn } from './memory.js'
import {
  buildNotice,
  clearCallTrail,
  isPlanWrite,
  noteCallTrail,
  noteIntervention,
  notePlanWrite,
  noteToolCall,
  remainingInterventions,
  shouldGuard,
} from './idle-guard.js'
import {
  loadChiefState,
  resolveWorkspaceConfig,
  invalidateChiefModelCatalog,
  buildMessageEnvelope,
  consumePreStepDelta,
  scheduleChiefTurnReview,
  hasValidChiefRiskAck,
  queueChiefApproval,
  appendChiefAuditLog,
} from './chief.js'
import { createAutoContinueEngine } from './auto-continue.js'
import { bootstrapArchivesFromSharedBoard } from './archives.js'
import { normalizePermissionMode } from './chief-executor.js'
import {
  newId,
  nowMs,
  emptyBoard,
  CAP_TASK_EVIDENCE,
  reconcileTaskDependencies,
  normalizeNote,
  normalizeBoard,
  pushLog,
  guardLogText,
} from './board-schema.js'

export function createRuntimeHooks(deps) {

  const boardFile = (...args) => deps.boardFile(...args)
  const boardFileFor = (...args) => deps.boardFileFor(...args)
  const boardForSession = (...args) => deps.boardForSession(...args)
  const boardTool = (...args) => deps.boardTool(...args)
  const boundariesTool = (...args) => deps.boundariesTool(...args)
  const clearPending = (...args) => deps.clearPending(...args)
  const clearPendingDeploy = (...args) => deps.clearPendingDeploy(...args)
  const collectDigestArchiveContext = (...args) => deps.collectDigestArchiveContext(...args)
  const deployStateToTargetChief = (...args) => deps.deployStateToTargetChief(...args)
  const getSessionCwd = (...args) => deps.getSessionCwd(...args)
  const getSubagentRoster = (...args) => deps.getSubagentRoster(...args)
  const handoffTool = (...args) => deps.handoffTool(...args)
  const injectInto = (...args) => deps.injectInto(...args)
  const linkedPeersForSession = (...args) => deps.linkedPeersForSession(...args)
  const loadBoard = (...args) => deps.loadBoard(...args)
  const makeChiefDeps = (...args) => deps.makeChiefDeps(...args)
  const memoryTool = (...args) => deps.memoryTool(...args)
  const pendingFile = (...args) => deps.pendingFile(...args)
  const probeSubagentSupport = (...args) => deps.probeSubagentSupport(...args)
  const readPending = (...args) => deps.readPending(...args)
  const readPendingDeploy = (...args) => deps.readPendingDeploy(...args)
  const refreshSubagentTree = (...args) => deps.refreshSubagentTree(...args)
  const resolveAgentIdentity = (...args) => deps.resolveAgentIdentity(...args)
  const resolveEffectiveHandoff = (...args) => deps.resolveEffectiveHandoff(...args)
  const resolveRootSessionId = (...args) => deps.resolveRootSessionId(...args)
  const routeTable = (...args) => deps.routeTable(...args)
  const saveBoard = (...args) => deps.saveBoard(...args)
  const sessionBoardFile = (...args) => deps.sessionBoardFile(...args)
  const syncObjective = (...args) => deps.syncObjective(...args)
  const syncPlanFromTodos = (...args) => deps.syncPlanFromTodos(...args)
  const syncSubagentToolCall = (...args) => deps.syncSubagentToolCall(...args)
  const withBoardLock = (...args) => deps.withBoardLock(...args)

  /* ------------------------------------------------------------------------ apply */

  function apply(ctx) {
    const runtime = {
      get(name) {
        try {
          return typeof ctx.get === 'function' ? ctx.get(name) : undefined
        } catch {
          return undefined
        }
      },
    }
    deps.hostState.activeRuntime = runtime

    // 1) Not inflated, not reminded: every prompt assembly carries a small digest,
    //    so a compacted transcript does not take the objective and the open steps
    //    away from the next turn.
    // Migrate a pre-split shared board into per-session boards ONCE: the first
    // session that claims it copies it, so anchors are not lost and no session
    // silently inherits another's tasks.
    ;(function migrateSharedBoard() {
      try {
        const sharedFile = boardFile()
        const dir = path.join(path.dirname(sharedFile), 'boards')
        const flag = path.join(path.dirname(sharedFile), '.split-done')
        if (fs.existsSync(flag)) return
        let stat
        try { stat = fs.statSync(sharedFile) } catch { return }
        if (!stat || !stat.isFile()) return
        const board = normalizeBoard(JSON.parse(fs.readFileSync(sharedFile, 'utf8')))
        const touched = Object.keys(board.sessions || {})
        const targets = new Set(touched)
        // Every note/task that carries a session id also seeds that board; a
        // session with only a heartbeat still gets the shared anchors.
        for (const note of board.notes || []) if (note.session) targets.add(String(note.session))
        for (const task of board.tasks || []) if (task.session) targets.add(String(task.session))
        // No owner at all → keep it as the shared/anchor board only.
        if (!targets.size) return
        const anchors = (board.notes || []).filter(note => (note.tags || []).includes('anchor'))
        fs.mkdirSync(dir, { recursive: true })
        for (const sid of targets) {
          const dst = sessionBoardFile(sid)
          if (fs.existsSync(dst)) continue
          // Seed only what is machine-wide: settings, the heartbeat table, the log
          // tail and the shared anchors. NOT the objective, NOT the plan, NOT the
          // bounds — those stay on the shared board and are inherited on every
          // read (boardForSession), so freezing a copy into each session would
          // recreate exactly the cross-session pollution the split removed.
          const seed = emptyBoard()
          seed.settings = board.settings || seed.settings
          seed.notes = anchors
          seed.sessions = board.sessions || {}
          seed.log = board.log || []
          fs.writeFileSync(dst, JSON.stringify(seed, null, 2), 'utf8')
        }
        fs.writeFileSync(flag, JSON.stringify({ at: nowMs(), seeded: [...targets] }, null, 2), 'utf8')
        // Shrink the shared board to the machine-wide facts only: the objective,
        // the plan, the bounds and the anchors are what a new session inherits,
        // while tasks/notes/memory stay per-session.
        withBoardLock(sharedFile, () => {
          const slim = emptyBoard()
          slim.settings = board.settings || slim.settings
          slim.bounds = board.bounds || slim.bounds
          slim.notes = anchors
          slim.sessions = board.sessions || {}
          slim.log = board.log || []
          slim.objective = board.objective
          slim.objectiveBy = board.objectiveBy
          slim.objectiveAt = board.objectiveAt
          slim.plan = board.plan
          saveBoard(slim, sharedFile)
        })
      } catch {}
    })()

    // Precipitate legacy shared-board engineering notes into `archives.json` ONCE
    // (after creating `board.pre-archive-backup.json`), sealing them as cold lazy-loaded dossiers.
    bootstrapArchivesFromSharedBoard({
      sharedFile: boardFile(),
      loadBoard,
      saveBoard,
      pushLog,
    })

    const isRootStopped = (rootKey, sid) => {
      try {
        const st = loadChiefState()
        const rk = resolveRootSessionId(rootKey || sid) || rootKey || sid
        const cfg = resolveWorkspaceConfig(st, rk)
        return Boolean(cfg.stopped || cfg.paceMode === 'stopped')
      } catch {
        return false
      }
    }

    const autoContinue = createAutoContinueEngine({
      createMessage: (text, sourceKind) => buildMessageEnvelope(text, sourceKind),
      getAgent: async (sid) => {
        try {
          const agents = runtime && runtime.get ? runtime.get('agents') : null
          const direct = agents && typeof agents.get === 'function' ? agents.get(sid) : null
          if (direct) return direct
          const ctrl = runtime && runtime.get ? runtime.get('sessionController') : null
          if (ctrl && typeof ctrl.resolveAgent === 'function') {
            const resolved = await ctrl.resolveAgent(sid)
            if (resolved && resolved.agent) return resolved.agent
          }
          return null
        } catch {
          return null
        }
      },
      isChiefStopped: (rootId, sid) => isRootStopped(rootId, sid),
      canAutoContinue: ({ sessionId, rootId, trigger, detail }) => {
        try {
          const key = rootId || sessionId || 'global'
          const state = loadChiefState()
          const ws = state && state.workspaces && state.workspaces[key] ? state.workspaces[key] : null
          const effCfg = resolveWorkspaceConfig(state, key)
          const hasAck = hasValidChiefRiskAck(ws)
          const mode = normalizePermissionMode(effCfg && effCfg.permissionMode, {
            requireAck: true,
            hasChiefRiskAck: hasAck,
          })
          if (mode === 'advisor') {
            return { allowed: false, skipped: 'advisor-readonly', logMessage: 'L0 顾问模式（只读）：禁止自动向主对话续跑' }
          }
          if (mode === 'assistant') {
            return { allowed: false, skipped: 'assistant-no-workflow', logMessage: 'L1 助手模式：仅维护参谋系统，跳过主对话断线自动续跑' }
          }
          if (mode === 'strategist') {
            const apr = queueChiefApproval(key, {
              category: 'main_workflow',
              operationLabel: '断线自动续跑主对话',
              targetLabel: '主对话 (@lead)',
              reason: `检测到会话中断或未收口（${trigger}），L2 参谋模式需您允许后再发送续跑指令`,
              impact: '点击「允许本次操作」后将立即唤醒主对话继续推进当前任务',
              preview: detail ? String(detail).slice(0, 220) : `触发原因：${trigger}`,
              dedupeKey: `autocont:${sessionId}:${trigger}:${Math.floor(Date.now() / 15_000)}`,
              kind: 'auto_continue',
              payload: { sessionId, trigger, detail: detail || '' },
              by: 'auto-continue',
            })
            appendChiefAuditLog(key, {
              mode,
              stage: 'permission_gate',
              decision: 'pending_approval',
              operation: '断线自动续跑主对话',
              target: sessionId,
              reason: `触发源：${trigger}`,
              outcome: 'pending',
              by: 'auto-continue',
            })
            return {
              allowed: false,
              skipped: 'pending-approval',
              approvalId: apr && apr.id,
              logMessage: `L2 参谋模式：已提交断线续跑逐项授权弹窗（${trigger}）`,
            }
          }
          return { allowed: true }
        } catch {
          return { allowed: false, skipped: 'permission-error' }
        }
      },
      resolveRootSessionId: (sid) => resolveRootSessionId(sid) || sid,
      onLog: (sid, msg) => {
        try {
          const rootId = resolveRootSessionId(sid) || sid
          if (!rootId) return
          const file = boardFileFor(rootId)
          withBoardLock(file, () => {
            const board = loadBoard(file)
            pushLog(board, `🔄 断线续跑：${msg}`, 'chief', sid)
            saveBoard(board, file)
          })
        } catch {}
      },
    })
    deps.hostState.activeAutoContinue = autoContinue
    ctx.effect(() => () => {
      if (deps.hostState.activeAutoContinue === autoContinue) deps.hostState.activeAutoContinue = null
      autoContinue.dispose()
    }, 'dsh-chief: auto-continue cleanup')

    ctx.inject(['llm'], llmCtx => {
      const ownLlm = (llmCtx && llmCtx.llm) || (llmCtx && llmCtx.get ? llmCtx.get('llm') : null)
      if (ownLlm) deps.hostState.activeLlm = ownLlm
      llmCtx.effect(() => () => {
        if (deps.hostState.activeLlm === ownLlm) deps.hostState.activeLlm = null
      }, 'dsh-chief: chief llm service')
    })
    ctx.on?.('llm/adapters-updated', () => invalidateChiefModelCatalog())
    ctx.on?.('settings/document-updated', () => invalidateChiefModelCatalog())

    ctx.effect(() => ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
      const decision = await next()
      try {
        if (!decision || decision.kind === 'reject' || signal?.aborted || !Array.isArray(decision.messages)) {
          return decision
        }
        const deltaMsg = await consumePreStepDelta(makeChiefDeps(runtime), agent)
        if (!deltaMsg) return decision
        return { ...decision, messages: [deltaMsg, ...decision.messages] }
      } catch {
        return decision
      }
    }), 'dsh-chief: chief pre-step delta')

    ctx.inject(['systemPrompt'], spCtx => {
      const systemPrompt = spCtx.get ? spCtx.get('systemPrompt') : undefined
      if (!systemPrompt || typeof systemPrompt.section !== 'function') return
      // Always on, and always FIRST. A model that only meets the chief after
      // ten thousand tokens of other context writes for a while and forgets it,
      // which is exactly the failure the operator kept hitting. The section is
      // registered unconditionally so the board is in front of the model from the
      // first turn; -10000 sorts ahead of every built-in section (they use small
      // positive orders, and equal orders fall back to name order), and the host
      // only requires the order to be a finite number.
      const fallbackAgentId = spCtx && spCtx.agent && spCtx.agent.id ? String(spCtx.agent.id)
        : (spCtx && spCtx.get && spCtx.get('agent') && spCtx.get('agent').id ? String(spCtx.get('agent').id) : '')
      spCtx.effect(() => systemPrompt.section({
        name: 'dsh-chief',
        order: -10000,
        text: (promptCtx) => {
          const liveAgent = (promptCtx && promptCtx.agent) || (spCtx && spCtx.agent) || null
          const curId = liveAgent && liveAgent.id ? String(liveAgent.id) : fallbackAgentId
          const rootId = resolveRootSessionId(curId, liveAgent) || curId
          let teamTasks
          try {
            const svc = runtime.get('agentTeams')
            if (svc && typeof svc.listTasks === 'function' && liveAgent) {
              teamTasks = svc.listTasks(liveAgent)
            }
          } catch {}
          const board = boardForSession(boardFileFor(rootId))
          const agentIdentity = resolveAgentIdentity(runtime, curId, liveAgent)
          const subagents = getSubagentRoster(runtime, rootId, board)
          const linked = linkedPeersForSession(runtime, rootId || 'global')
          const archCtx = collectDigestArchiveContext(runtime, rootId, board.activeCabinetId)
          if (rootId) refreshSubagentTree(runtime, rootId, board).catch(() => {})
          return renderDigest(board, {
            teamTasks,
            agentIdentity,
            subagents,
            linkedPeersCount: linked.linkedPeersCount,
            linkedPeersProgress: linked.linkedPeersProgress,
            takenOutArchives: archCtx.takenOutArchives,
            sessionArchiveBriefs: archCtx.sessionArchiveBriefs,
            smartCompactActive: archCtx.smartCompactActive,
            chiefPermissionMode: archCtx.chiefPermissionMode,
          })
        },
      }), 'dsh-chief: prompt digest')
    })

    // 2) Whatever plan or subagent delegation the model executed is mirrored into the board.
    ctx.effect(() => ctx.on('tools/result', (exec, result) => {
      try {
        if (!exec || !result || result.isError) return
        const caller = exec.agent || null
        const sessionId = caller && caller.id ? String(caller.id) : ''
        const rootId = resolveRootSessionId(sessionId, caller) || sessionId
        if (exec.name === 'todo_write') syncPlanFromTodos(exec.arguments, rootId)
        else if (exec.name === 'create_goal' || exec.name === 'update_goal') syncObjective(exec.name, exec.arguments, rootId)
        else if (exec.name === 'subagent' || exec.name === 'subagent_fork' || exec.name === 'send_message' || exec.name === 'interrupt_agent') {
          syncSubagentToolCall(runtime, exec, result)
        }
      } catch {}
    }), 'dsh-chief: plan & subagent mirror')

    // 2b) A transferred packet + staged Chief deployment waits for one new Session.
    ctx.effect(() => ctx.on('agent/created', async payload => {
      try {
        const agent = payload && payload.agent
        if (!agent || !agent.id) return
        const id = String(agent.id)

        const pendingDeploy = readPendingDeploy()
        if (pendingDeploy && pendingDeploy.fromSessionId && pendingDeploy.fromSessionId !== id) {
          clearPendingDeploy()
          try {
            deployStateToTargetChief(runtime, {
              fromSessionId: pendingDeploy.fromSessionId,
              toSessionId: id,
              archiveTransferPolicy: pendingDeploy.archiveTransferPolicy || 'none',
              archiveDrawer: pendingDeploy.archiveDrawer || '',
              toCabinetId: pendingDeploy.toCabinetId || '',
              customNote: pendingDeploy.customNote || '',
            })
          } catch {}
        }

        const pending = readPending()
        if (!pending) return
        const delivered = await injectInto(agent, pending.text)
        if (delivered.ok) clearPending()
        const file = boardFileFor(id)
        const short = id.replace(/^session-/, '').slice(0, 8)
        withBoardLock(file, () => {
          const board = loadBoard(file)
          pushLog(
            board,
            (delivered.ok ? '交接单已被本会话领取 ' : '交接单投放失败（' + delivered.error + '），仍待领取：') + short,
            'agent',
            id,
          )
          // An injected packet only reaches the conversation, so the board the
          // claimant actually opens would look empty. Keep the packet itself on
          // that board, as a note, so the next reader sees the handover there.
          if (delivered.ok) {
            const title = '接手：' + (String(pending.text).split('\n')[0] || '上一段对话').replace(/^#\s*交接单\s*·\s*/, '').slice(0, 120)
            const body = String(pending.text).slice(0, 6000)
            const same = board.notes.find(note => note.title === title)
            if (same) {
              same.body = body
              same.updatedAt = nowMs()
              same.session = id
            } else {
              board.notes.unshift(normalizeNote({ id: newId('n'), title, body, tags: ['handoff'], by: 'agent', session: id }))
            }
          }
          return saveBoard(board, file)
        })
      } catch {}
    }), 'dsh-chief: deliver pending transfer')

    // 2c) Incremental record of what each turn actually did + Auto-Continue detection
    // on interruptions / transient failures / empty outputs (unless Chief is stopped).
    ctx.effect(() => ctx.on('session/event', (session, event) => {
      try {
        if (!event || !session || !session.id) return
        const id = String(session.id)
        if (event.type === 'tool/call' && event.data) {
          const turn = event.data.turn
          noteToolCall(id, turn)
          if (isPlanWrite(event.data.name, event.data.arguments)) notePlanWrite(id, turn)
          noteCallTrail(id, event.data.name, event.data.arguments)
        }
        autoContinue.onSessionEvent(session, event)

        if (event.type === 'turn/end') {
          const rawReason = event.data && event.data.reason
          const reason = String(rawReason && typeof rawReason === 'object' ? (rawReason.kind || '') : (rawReason || '')).toLowerCase()
          const nestedReason = String(rawReason && typeof rawReason === 'object' && rawReason.reason && typeof rawReason.reason === 'object' ? (rawReason.reason.kind || '') : '').toLowerCase()
          const isStoppedByUserOrPolicy = reason === 'aborted' || reason === 'blocked' || nestedReason === 'aborted' || nestedReason === 'blocked'
          const turnNum = Number(event.data && event.data.turn)
          const steerKey = `${id}:${turnNum}`
          const steeredAt = deps.hostState.autoSteeredTurns.get(steerKey) || 0
          if (steeredAt) deps.hostState.autoSteeredTurns.delete(steerKey)
          if (!isStoppedByUserOrPolicy && !(steeredAt && Date.now() - steeredAt < 30_000)) {
            const rootId = resolveRootSessionId(id) || id
            if (!isRootStopped(rootId, id)) {
              const agents = runtime && runtime.get ? runtime.get('agents') : null
              const liveAgent = agents && typeof agents.get === 'function' ? agents.get(id) : null
              if (liveAgent) {
                scheduleChiefTurnReview(makeChiefDeps(runtime), { agent: liveAgent, sessionId: id, turn: event.data && event.data.turn })
              }
            }
          }
        }
      } catch {}
    }), 'dsh-chief: tool call ledger & auto-continue')

    // 3) One heartbeat per finished turn: which Sessions are still warm — and the
    // idle guard: a turn that closes with a short answer, no tool call, and open
    // work still on the board gets one more step instead of closing.
    ctx.effect(() => ctx.on('agent/turn-stopping', payload => {
      let id = ''
      try {
        const agent = payload && payload.agent
        id = agent && agent.id ? String(agent.id) : ''
        if (!id) return

        const turn = Number(payload && payload.turn)
        const file = boardFileFor(id)

        // One critical section: heartbeat, memory line and the guard verdict all
        // read and rewrite the same board, so a route landing mid-way must not be
        // able to overwrite any of them.
        withBoardLock(file, () => {
          const board = loadBoard(file)

          // Heartbeat, inlined so the three edits share one load and one save.
          try {
            const entry = board.sessions[id] || { lastSeen: 0, cwd: '', turns: 0 }
            entry.lastSeen = nowMs()
            entry.turns = (entry.turns || 0) + 1
            const resolvedCwd = getSessionCwd(runtime, id)
            if (resolvedCwd) entry.cwd = resolvedCwd
            board.sessions[id] = entry
            const ids = Object.keys(board.sessions)
            if (ids.length > 40) {
              ids.sort((a, b) => (board.sessions[a].lastSeen || 0) - (board.sessions[b].lastSeen || 0))
              for (const stale of ids.slice(0, ids.length - 40)) delete board.sessions[stale]
            }
          } catch {}

          // Memory first: every finished turn leaves one line in the board's memory
          // before the guard can decide anything, so asking "what did we do" works
          // even when the turn was idle.
          let capturedEntry = null
          const identity = resolveAgentIdentity(runtime, id, agent)
          try {
            capturedEntry = captureTurn(agent && agent.session, turn, null)
            if (capturedEntry) {
              capturedEntry.session = id
              if (identity && identity.isChild && identity.self) {
                capturedEntry.by = identity.self
              }
              appendMemory(board, capturedEntry)
            }
          } catch {}

          // If a child subagent just finished its turn, auto-settle its assigned
          // 'doing' task on the shared root board and unlock downstream dependencies.
          if (identity && identity.isChild) {
            const selfName = String(identity.self || '').toLowerCase()
            const shortSelf = selfName.split('/').pop()
            let settledCount = 0
            for (const task of board.tasks || []) {
              if (!task || task.status !== 'doing') continue
              const tSub = String(task.subagent || '').toLowerCase()
              const tOwn = String(task.owner || '').toLowerCase()
              const matched = (selfName && (tSub === selfName || tOwn === selfName || tSub.split('/').pop() === shortSelf || tOwn.split('/').pop() === shortSelf))
                || (task.session && String(task.session) === id)
              if (matched && capturedEntry && capturedEntry.text) {
                task.status = 'done'
                if (!task.evidence) {
                  task.evidence = String(capturedEntry.title || capturedEntry.text).slice(0, CAP_TASK_EVIDENCE)
                }
                task.updatedAt = nowMs()
                settledCount += 1
                pushLog(board, '✅ 子代理 ' + identity.self + ' 完成任务 #' + task.id + '「' + task.title.slice(0, 36) + '」', identity.self, id)
              }
            }
            if (settledCount > 0) {
              reconcileTaskDependencies(board, identity.self, id)
            }
            saveBoard(board, file)
            const childRoot = resolveRootSessionId(id, agent) || id
            if (!isRootStopped(childRoot, id)) {
              scheduleChiefTurnReview(makeChiefDeps(runtime), { agent, sessionId: id, turn })
            }
            return
          }

          const rootId = resolveRootSessionId(id, agent) || id
          if (isRootStopped(rootId, id)) {
            saveBoard(board, file)
            return
          }

          // autoInject is machine-wide on the shared board; guardIdle follows the
          // same rule so one switch turns the guard off everywhere.
          const shared = loadBoard(boardFile())
          const settings = { ...(board.settings || {}), ...(shared.settings || {}) }
          const verdict = shouldGuard({ board, session: agent && agent.session, sessionId: id, turn, settings })
          if (!verdict) {
            saveBoard(board, file)
            scheduleChiefTurnReview(makeChiefDeps(runtime), { agent, sessionId: id, turn })
            return
          }

          if (typeof agent.steer !== 'function') {
            pushLog(board, '空转拦截：这个 agent 没有 steer 方法，转由断线续跑模块跟进', 'guard', id)
            saveBoard(board, file)
            autoContinue.notifyIdleOrInterrupt(id, { kind: 'idle-stall', reason: verdict.reason || '' })
            return
          }

          // Steer inside the lock: the notice is queued before another request can
          // observe a board that claims an intervention that never happened.
          const notice = buildNotice({ ...verdict, board })
          agent.steer(notice)
          deps.hostState.autoSteeredTurns.set(`${id}:${turn}`, Date.now())
          if (deps.hostState.autoSteeredTurns.size > 120) {
            const oldest = deps.hostState.autoSteeredTurns.keys().next().value
            if (oldest) deps.hostState.autoSteeredTurns.delete(oldest)
          }
          noteIntervention(id, turn)
          // Clear the trail only once the steer landed: a loop that survived a
          // failed steer deserves the next nudge, not a silent reset.
          if (verdict.kind === 'loop') clearCallTrail(id)
          pushLog(board, guardLogText(verdict, turn, remainingInterventions(id, settings)), 'guard', id)

          // Auto-handoff: when the guard has spent its last intervention and the
          // session still has open work, the turn is not idle — it is stuck in a
          // context that has grown too long to be productive. Generate the
          // handover packet right now so the next Session (or a manual reopen)
          // inherits it instead of a blank board. The steer already fired above
          // tells the model to wrap up; this packet is what the next one reads.
          if (remainingInterventions(id, settings) === 0) {
            try {
              const packet = resolveEffectiveHandoff(runtime, id, board).text
              const pendingFile_ = pendingFile()
              fs.writeFileSync(pendingFile_, JSON.stringify({ text: packet, at: nowMs(), from: id }))
              pushLog(board, '上下文压力：干预计数耗尽，交接单已自动生成并放入待领取', 'handoff', id)
            } catch (handoffError) {
              pushLog(board, '自动交接单生成失败：' + String(handoffError && handoffError.message ? handoffError.message : handoffError).slice(0, 160), 'handoff', id)
            }
          }
          saveBoard(board, file)
        })
      } catch (error) {
        // Never let the guard break the turn boundary.
        try {
          if (!id) return
          const file = boardFileFor(id)
          withBoardLock(file, () => {
            const board = loadBoard(file)
            pushLog(board, '空转拦截自身出错：' + String(error && error.message ? error.message : error).slice(0, 160), 'guard', id)
            saveBoard(board, file)
          })
        } catch {}
      }
    }), 'dsh-chief: session heartbeat and idle guard')

    // Routes: the browser half of this same package calls them same-origin.
    ctx.inject(['webServer'], webCtx => {
      for (const route of routeTable(runtime)) {
        webCtx.effect(() => webCtx.webServer.register(route), 'dsh-chief: route ' + route.path)
      }
    })

    // Model tools: the cross-Session half of the same operations.
    ctx.inject(['tools'], toolCtx => {
      for (const tool of [boardTool(runtime), boundariesTool(runtime), handoffTool(runtime), memoryTool(runtime)]) {
        toolCtx.effect(() => toolCtx.tools.register(tool), 'dsh-chief: tool ' + tool.name)
      }
    })

    // Runtime capability probe for DSH >= 0.2.2-rc.2 named subagent APIs
    ctx.inject(['subagents'], () => {
      const compat = probeSubagentSupport(runtime)
      if (compat.present && !compat.namedSubagentsSupported) {
        try {
          console.warn('[dsh-chief] ' + compat.warning)
        } catch {}
      }
    })
  }

  return {
    apply,
  }
}
