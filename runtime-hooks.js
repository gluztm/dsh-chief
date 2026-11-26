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
  buildMidTurnSpinNotice,
  clearCallTrail,
  clearMidTurnSpin,
  detectMidTurnSpin,
  isExternalWaitTool,
  isPlanWrite,
  markMidTurnSpinActed,
  noteCallResult,
  noteCallTrail,
  noteExternalWait,
  noteIntervention,
  notePlanWrite,
  noteToolCall,
  openWork,
  remainingInterventions,
  shouldGuard,
} from './idle-guard.js'
import {
  loadChiefState,
  mutateChiefState,
  resolveWorkspaceConfig,
  invalidateChiefModelCatalog,
  buildMessageEnvelope,
  consumePreStepDelta,
  scheduleChiefTurnReview,
  hasValidChiefRiskAck,
  queueChiefApproval,
  appendChiefAuditLog,
} from './chief.js'
import {
  touchWorkspaceActivity,
  upsertTaskLedgerOnWs,
  normalizeSuggestion,
  ensureWorkspace,
  recordWorkspaceAlertEvent,
  isChiefSessionEnabled,
  activateChiefSession,
  SUGGESTIONS_CAP,
  CHAT_CAP,
  nextId,
  clamp,
} from './chief-state.js'
import { createAutoContinueEngine } from './auto-continue.js'
import {
  clearPeerDropState,
  hasUnansweredIncomingPeerMail,
  syncPeerDropToWaitingSenders,
} from './chief-network.js'
import { bootstrapArchivesFromSharedBoard, resolveProjectKey } from './archives.js'
import { createChiefMemoryHostService, syncChiefTurnAsync } from './external-memory.js'
import { normalizePermissionMode, buildCapabilityScope, evaluatePreExecuteDefense, evaluateSafetyGuardHardRules, listGuardWalls } from './chief-executor.js'
import { shouldInspectRelayAsCommand } from './command-helpers.js'
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
    try {
      if (ctx && typeof ctx.provide === 'function') {
        ctx.provide('chiefMemoryHost', createChiefMemoryHostService())
      }
    } catch {}

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

    const isExplicitStopped = (rootKey, sid) => {
      try {
        const st = loadChiefState()
        const rk = resolveRootSessionId(rootKey || sid) || rootKey || sid
        const cfg = resolveWorkspaceConfig(st, rk)
        return Boolean(cfg.stopped || cfg.paceMode === 'stopped')
      } catch {
        return false
      }
    }

    const isRootStopped = (rootKey, sid) => {
      try {
        const st = loadChiefState()
        const rk = resolveRootSessionId(rootKey || sid) || rootKey || sid
        const cfg = resolveWorkspaceConfig(st, rk)
        return Boolean(cfg.stopped || cfg.paceMode === 'stopped' || (cfg.runMode === 'off' && !(cfg.tacticalModes && cfg.tacticalModes.intervention)))
      } catch {
        return false
      }
    }

    const isSessionActive = (sid, agentObj = null) => {
      try {
        const raw = String(sid || (agentObj && agentObj.id) || '').trim()
        const rk = resolveRootSessionId(raw, agentObj) || raw
        if (!rk || rk === 'global') return false
        return isChiefSessionEnabled(loadChiefState(), rk)
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
      canAutoContinue: ({ sessionId, rootId, trigger, detail, toolSummary, lastIncomingWorkAt }) => {
        try {
          const key = rootId || sessionId || 'global'
          const state = loadChiefState()
          const ws = state && state.workspaces && state.workspaces[key] ? state.workspaces[key] : null
          const effCfg = resolveWorkspaceConfig(state, key)
          const runMode = effCfg && effCfg.runMode ? effCfg.runMode : 'off'
          const interventionOn = Boolean(effCfg && effCfg.tacticalModes && effCfg.tacticalModes.intervention)
          if ((effCfg && effCfg.stopped) || (runMode !== 'patrol' && runMode !== 'managed' && !interventionOn)) {
            return { allowed: false, skipped: 'run-mode-off', logMessage: '参谋处于「⏸ 关停」模式，仅 patrol/managed 或强介入激活时允许 Auto continue 唤醒' }
          }

          // Check forbidden bounds and active guard walls BEFORE continuing
          const cwdForCheck = (key && key !== 'global' && getSessionCwd(runtime, key)) || process.cwd()
          const board = key && key !== 'global' ? boardForSession(boardFileFor(key)) : null

          const isChildSession = Boolean(rootId && sessionId && rootId !== sessionId)
          const isSilentTrigger = String(trigger || '').includes(':silent') || trigger === 'turn/end:no-visible-output' || trigger === 'idle-stall'
          if (isChildSession) {
            if (isSilentTrigger) {
              return { allowed: false, skipped: 'child-subagent-silent', logMessage: '子代理静默/完工收尾，跳过自动续跑以免误唤醒' }
            }
            const ident = resolveAgentIdentity(runtime, sessionId, null)
            const selfName = String((ident && ident.self) || '').toLowerCase()
            const shortSelf = selfName.split('/').pop()
            const hasOpenDoingTask = Boolean(board && Array.isArray(board.tasks) && board.tasks.some(t => {
              if (!t || t.status !== 'doing') return false
              if (t.session && String(t.session) === sessionId) return true
              const tSub = String(t.subagent || '').toLowerCase()
              const tOwn = String(t.owner || '').toLowerCase()
              return Boolean(selfName && (tSub === selfName || tOwn === selfName || tSub.split('/').pop() === shortSelf || tOwn.split('/').pop() === shortSelf))
            }))
            if (!hasOpenDoingTask) {
              return { allowed: false, skipped: 'child-subagent-done', logMessage: '子代理已无进行中任务（已完工），跳过断线续跑以免状态波动' }
            }
          }

          if (!isChildSession && (String(trigger || '').includes(':silent') || trigger === 'turn/end:no-visible-output')) {
            if (toolSummary && toolSummary.hadExternalWaitTool) {
              return { allowed: false, skipped: 'waiting-external-tool', logMessage: '本轮已执行外部协同/等待工具，跳过静默断线续跑' }
            }
            const rosterNow = key && key !== 'global' ? getSubagentRoster(runtime, key, board) : []
            const hasRunningChild = rosterNow.some(a => a && a.name !== 'lead' && a.verifiedInstance !== false && !a.stale && a.status === 'running')
            if (hasRunningChild) {
              return { allowed: false, skipped: 'waiting-running-subagent', logMessage: '存在运行中子代理，主对话静默等待期跳过断线续跑' }
            }
            if (board) {
              const open = openWork(board)
              const hasAnyItems = (Array.isArray(board.plan) && board.plan.length > 0) || (Array.isArray(board.tasks) && board.tasks.length > 0)
              const hasUnansweredPeer = hasUnansweredIncomingPeerMail(state, key)
              const latestBoardDoneAt = Math.max(0, ...((Array.isArray(board.tasks) ? board.tasks : []).map(t => Number(t && t.updatedAt) || 0)))
              const hasFreshDirective = Boolean(lastIncomingWorkAt && (Date.now() - lastIncomingWorkAt < 120_000) && (!latestBoardDoneAt || lastIncomingWorkAt > latestBoardDoneAt))
              if (hasAnyItems && open.total === 0 && !hasUnansweredPeer && !hasFreshDirective) {
                return { allowed: false, skipped: 'board-all-done', logMessage: '看板任务与步骤已全部完成，跳过静默断线续跑' }
              }
              const cursorBlocked = Boolean(board.cursor && String(board.cursor.blocked || '').trim())
              const allTasksBlocked = open.tasks.length > 0 && open.tasks.every(t => t.status === 'blocked')
              if (cursorBlocked || allTasksBlocked) {
                return { allowed: false, skipped: 'waiting-external-blocker', logMessage: '当前处于已登记受阻/外部等待状态，跳过静默断线续跑' }
              }
            }
          }
          const detailSample = `${trigger || ''} ${detail || ''}`.trim()
          const safetyGuardEnabled = !(effCfg && effCfg.tacticalModes && effCfg.tacticalModes.safetyGuardEnabled === false)
          const safetyGuard = evaluateSafetyGuardHardRules({
            tool: 'relay',
            opClass: 'workflow',
            command: shouldInspectRelayAsCommand(detailSample) ? detailSample : '',
            content: detailSample,
            board,
            safetyGuardEnabled,
          })
          if (safetyGuard && safetyGuard.blocked) {
            appendChiefAuditLog(key, {
              mode: effCfg.permissionMode || 'advisor',
              stage: 'safety_guard',
              rule: safetyGuard.rule || 'auto_continue_blocked',
              decision: 'blocked',
              operation: '断线续跑边界检查',
              target: sessionId,
              reason: safetyGuard.reason,
              outcome: 'blocked',
              by: 'auto-continue',
            })
            return { allowed: false, skipped: 'guard-wall-blocked', logMessage: `安全防护阻断自动续跑：${safetyGuard.reason}` }
          }
          const activeWalls = listGuardWalls(cwdForCheck)
          if (detail && Array.isArray(activeWalls) && activeWalls.some(w => w && w.enabled && w.mode === 'deny' && Array.isArray(w.patterns) && w.patterns.some(p => p && detail.includes(p)))) {
            return { allowed: false, skipped: 'guard-wall-blocked', logMessage: '触发自定义拦截规则，已暂停自动续跑等待人工确认' }
          }

          const hasAck = hasValidChiefRiskAck(ws)
          const mode = normalizePermissionMode(effCfg && effCfg.permissionMode, {
            requireAck: true,
            hasChiefRiskAck: hasAck,
          })
          if (mode === 'advisor') {
            return { allowed: false, skipped: 'advisor-readonly', logMessage: 'L0 顾问模式（只读）：检测到断流仅作提示，不向主对话发送续跑请求' }
          }
          if (mode === 'assistant') {
            mutateChiefState((s) => {
              const w = ensureWorkspace(s, key)
              const sug = normalizeSuggestion({
                kind: 'advice',
                fromAgent: '⚡ 断流检测提醒',
                title: `主对话断流待手动续跑（${trigger}）`,
                reason: detail ? String(detail).slice(0, 160) : 'L1 助手模式不接管主对话工作流，点此一键下发续跑请求。',
                target: 'lead',
                targetLabel: '主对话 (@lead)',
                mode: 'followup',
                draftText: `[EXECUTION_REQUEST] 检测到上一轮中断（${trigger}），请核查进度后继续推进。`,
              })
              if (sug && !w.suggestions.some(x => x && x.status === 'pending' && x.title === sug.title)) {
                w.suggestions.push(sug)
                if (w.suggestions.length > SUGGESTIONS_CAP) w.suggestions = w.suggestions.slice(-SUGGESTIONS_CAP)
              }
            })
            return { allowed: false, skipped: 'assistant-no-workflow', logMessage: 'L1 助手模式：已记入建议卡提醒断流，跳过主对话工作流续跑' }
          }
          if (mode === 'strategist') {
            let ledgerId = ''
            mutateChiefState((s) => {
              const w = ensureWorkspace(s, key)
              const entry = upsertTaskLedgerOnWs(w, {
                kind: 'auto_continue',
                status: 'awaiting_approval',
                originalText: `[断线续跑 · ${trigger}] ${detail ? String(detail).slice(0, 160) : '异常中断恢复'}`,
                forcedTarget: 'lead',
                lastReceipt: '等待 L2 逐项授权唤醒主对话',
              })
              if (entry) ledgerId = entry.taskId || entry.id
            })
            const apr = queueChiefApproval(key, {
              category: 'main_workflow',
              operationLabel: '断线自动续跑主对话',
              targetLabel: '主对话 (@lead)',
              reason: `检测到会话中断或未收口（${trigger}），已核验安全防护与拦截规则，L2 参谋模式需您允许后唤醒续跑`,
              impact: '点击「允许本次操作」后将发出 [EXECUTION_REQUEST] 信封唤醒主对话继续推进',
              preview: detail ? String(detail).slice(0, 220) : `触发原因：${trigger}`,
              dedupeKey: `autocont:${sessionId}:${trigger}:${Math.floor(Date.now() / 15_000)}`,
              kind: 'auto_continue',
              taskId: ledgerId,
              resumeTaskId: ledgerId,
              payload: { sessionId, trigger, detail: detail || '', taskId: ledgerId },
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
              taskId: ledgerId,
              logMessage: `L2 参谋模式：已提交断线续跑逐项授权弹窗（${trigger}）`,
            }
          }
          let l3TaskId = ''
          mutateChiefState((s) => {
            const w = ensureWorkspace(s, key)
            const entry = upsertTaskLedgerOnWs(w, {
              kind: 'auto_continue',
              status: 'running',
              originalText: `[L3 断线自动续跑 · ${trigger}] ${detail ? String(detail).slice(0, 160) : '异常中断自动恢复'}`,
              forcedTarget: 'lead',
              lastReceipt: '已过安全防护与拦截规则核验，准备下发 [EXECUTION_REQUEST]',
            })
            if (entry) l3TaskId = entry.taskId || entry.id
          })
          return { allowed: true, taskId: l3TaskId }
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
          if (String(msg || '').includes('断线续跑已触发')) {
            recordWorkspaceAlertEvent(rootId, {
              kind: 'auto_continue_rescue',
              level: 'info',
              title: '🔄 断流救活已触发续跑',
              body: String(msg).slice(0, 180),
              dedupeKey: `rescue:${rootId}:${Math.floor(Date.now() / 5_000)}`,
            })
          }
        } catch {}
      },
      onRecoveryBlocked: ({ rootId, trigger, skipped, reason }) => {
        try {
          if (!rootId || rootId === 'global') return
          syncPeerDropToWaitingSenders(makeChiefDeps(runtime), {
            droppedRootId: rootId,
            trigger,
            skipped,
            reason: reason || skipped || trigger,
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
      let ownLlm = null
      try {
        ownLlm = (llmCtx && typeof llmCtx.get === 'function' ? llmCtx.get('llm') : null)
          || (llmCtx && llmCtx.llm)
          || null
      } catch {}
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
        if (!isSessionActive(agent && agent.id, agent)) return decision
        const deltaMsg = await consumePreStepDelta(makeChiefDeps(runtime), agent)
        if (!deltaMsg) return decision
        return { ...decision, messages: [deltaMsg, ...decision.messages] }
      } catch {
        return decision
      }
    }), 'dsh-chief: chief pre-step delta')

    ctx.inject(['systemPrompt'], spCtx => {
      let systemPrompt
      try {
        systemPrompt = spCtx && typeof spCtx.get === 'function' ? spCtx.get('systemPrompt') : undefined
      } catch {}
      if (!systemPrompt || typeof systemPrompt.section !== 'function') return
      // Always on, and always FIRST. A model that only meets the chief after
      // ten thousand tokens of other context writes for a while and forgets it,
      // which is exactly the failure the operator kept hitting. The section is
      // registered unconditionally so the board is in front of the model from the
      // first turn; -10000 sorts ahead of every built-in section (they use small
      // positive orders, and equal orders fall back to name order), and the host
      // only requires the order to be a finite number.
      const readScopedAgent = (c) => {
        try {
          if (c && typeof c.get === 'function') return c.get('agent') || null
        } catch {}
        return null
      }
      const fallbackAgent = readScopedAgent(spCtx)
      const fallbackAgentId = fallbackAgent && fallbackAgent.id ? String(fallbackAgent.id) : ''
      spCtx.effect(() => systemPrompt.section({
        name: 'dsh-chief',
        order: -10000,
        text: (promptCtx) => {
          const liveAgent = (promptCtx && promptCtx.agent) || readScopedAgent(spCtx) || null
          const promptSessionId = promptCtx && promptCtx.session && promptCtx.session.id
            ? String(promptCtx.session.id)
            : ''
          const curId = (liveAgent && liveAgent.id ? String(liveAgent.id) : '') || promptSessionId || fallbackAgentId
          const rootId = resolveRootSessionId(curId, liveAgent) || curId
          if (!isSessionActive(rootId, liveAgent)) return ''
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
            bubbleSquad: linked.bubbleSquad,
            takenOutArchives: archCtx.takenOutArchives,
            sessionHookedArchives: archCtx.sessionHookedArchives,
            desktopUsedTokens: archCtx.desktopUsedTokens,
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
        if (!isSessionActive(rootId, caller)) return
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
          activateChiefSession(id, { force: true })
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
        activateChiefSession(id, { force: true })
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

    function handleMidTurnSpinCheck(id, rootId) {
      try {
        const agents = runtime && runtime.get ? runtime.get('agents') : null
        const liveAgent = agents && typeof agents.get === 'function' ? agents.get(id) : null
        if (!liveAgent || liveAgent.status !== 'running') return

        const st = loadChiefState()
        const effCfg = resolveWorkspaceConfig(st, rootId)
        if (effCfg.stopped || effCfg.paceMode === 'stopped') return

        const strongIntervention = Boolean(effCfg.tacticalModes && effCfg.tacticalModes.intervention)
        const shared = loadBoard(boardFile())
        const board = boardForSession(boardFileFor(id))
        const settings = { ...(board.settings || {}), ...(shared.settings || {}) }
        const guardIdleEnabled = settings.guardIdle !== false
        if (!strongIntervention && !guardIdleEnabled) return

        const spin = detectMidTurnSpin(id, { strongIntervention })
        if (!spin) return

        const canSteer = typeof liveAgent.steer === 'function'
        const logLine = guardLogText({ kind: 'mid-turn-spin', spin }, 0, 0)
        const ident = resolveAgentIdentity(runtime, id, liveAgent)
        const targetHandle = (ident && ident.isChild && ident.self) ? ident.self : 'lead'

        if (spin.kind === 'exact-loop' && guardIdleEnabled) {
          if (!canSteer) return
          liveAgent.steer(buildMidTurnSpinNotice(spin, board))
          markMidTurnSpinActed(id)
          const bFile = boardFileFor(id)
          withBoardLock(bFile, () => {
            const b = loadBoard(bFile)
            pushLog(b, logLine, 'guard', id)
            saveBoard(b, bFile)
          })
          scheduleChiefTurnReview(makeChiefDeps(runtime), { agent: liveAgent, sessionId: id, abnormalTrigger: 'mid_turn_spin' })
          return
        }

        if (!strongIntervention) return
        const wsSnap = st.workspaces && st.workspaces[rootId] ? st.workspaces[rootId] : null
        const permMode = normalizePermissionMode(effCfg.permissionMode, {
          requireAck: true,
          hasChiefRiskAck: hasValidChiefRiskAck(wsSnap),
        })
        const spinSummary = `${spin.name || 'tool'}${spin.preview ? ' (' + String(spin.preview).slice(0, 60) + ')' : ''}`

        if (permMode === 'chief' && canSteer) {
          liveAgent.steer(buildMidTurnSpinNotice(spin, board))
          markMidTurnSpinActed(id)
          mutateChiefState((s) => {
            const ws = ensureWorkspace(s, rootId)
            ws.chat.push({
              id: nextId('chat'),
              role: 'chief',
              kind: 'receipt',
              text: `- 【⚡ 强介入 · 运行中空转急刹】已当场插话制止 \`@${targetHandle}\` 原地空转/连续报错（${spin.kind} ×${spin.count}：${clamp(spinSummary, 140)}）。`,
              actions: [`⚡ 急刹 ×${spin.count}`],
              at: Date.now(),
            })
            if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
          })
          appendChiefAuditLog(rootId, {
            mode: permMode,
            stage: 'executor',
            rule: 'mid_turn_spin_brake',
            decision: 'executed',
            operation: '强介入运行中空转急刹',
            target: id,
            reason: `${spin.kind} ×${spin.count}: ${clamp(spinSummary, 120)}`,
            outcome: 'ok',
            by: 'chief',
          })
        } else if (permMode === 'strategist') {
          markMidTurnSpinActed(id)
          const noticeObj = buildMidTurnSpinNotice(spin, board)
          const noticeTxt = (noticeObj.content && noticeObj.content[0] && noticeObj.content[0].text) || ''
          queueChiefApproval(rootId, {
            category: 'main_workflow',
            operationLabel: '强介入 · 运行中空转急刹插话',
            targetLabel: targetHandle === 'lead' ? '主对话 (@lead)' : `@${targetHandle}`,
            reason: `检测到运行中连续空转/报错（${spin.kind} ×${spin.count}），L2 参谋模式需您授权后插话急刹`,
            impact: '允许后立即向运行中的目标插入纠偏通知',
            preview: clamp(spinSummary, 200),
            dedupeKey: `midspin:${rootId}:${spin.kind}:${spin.name}`,
            kind: 'relay',
            capabilityScope: buildCapabilityScope({ kind: 'relay', tool: 'relay', target: targetHandle }),
            payload: {
              fromSession: rootId,
              fromLabel: 'DSH 参谋 (运行中空转急刹)',
              target: targetHandle,
              subject: '运行中空转急刹',
              text: noticeTxt,
              mode: 'steer',
            },
            by: 'chief',
          })
        } else {
          markMidTurnSpinActed(id)
          mutateChiefState((s) => {
            const ws = ensureWorkspace(s, rootId)
            ws.chat.push({
              id: nextId('chat'),
              role: 'chief',
              kind: 'receipt',
              text: `- 【👁 运行中空转告警 (${permMode === 'assistant' ? 'L1' : 'L0'})】检测到 \`@${targetHandle}\` 正在连续空转/报错（${spin.kind} ×${spin.count}：${clamp(spinSummary, 140)}），当前权限不自动插话。`,
              actions: ['⚠️ 运行空转告警'],
              at: Date.now(),
            })
            if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
          })
        }
        const bFile = boardFileFor(id)
        withBoardLock(bFile, () => {
          const b = loadBoard(bFile)
          pushLog(b, logLine, 'guard', id)
          saveBoard(b, bFile)
        })
        scheduleChiefTurnReview(makeChiefDeps(runtime), { agent: liveAgent, sessionId: id, abnormalTrigger: 'mid_turn_spin' })
      } catch {}
    }

    // 2c) Incremental record of what each turn actually did + Auto-Continue detection
    // on interruptions / transient failures / empty outputs (unless Chief is stopped).
    ctx.effect(() => ctx.on('session/event', (session, event) => {
      try {
        if (!event || !session || !session.id) return
        const id = String(session.id)
        const rootIdForAct = resolveRootSessionId(id) || id
        if (!isSessionActive(rootIdForAct)) return
        if (event.type === 'turn/start' || event.type === 'user/message' || event.type === 'message/user' || event.type === 'tool/call' || event.type === 'turn/end') {
          touchWorkspaceActivity(rootIdForAct)
        }
        if (event.type === 'turn/start') {
          clearMidTurnSpin(id)
          if (id === rootIdForAct) clearPeerDropState(rootIdForAct)
        } else if (event.type === 'tool/call' && event.data) {
          const turn = event.data.turn
          noteToolCall(id, turn)
          if (isPlanWrite(event.data.name, event.data.arguments)) notePlanWrite(id, turn)
          if (isExternalWaitTool(event.data.name, event.data.arguments)) noteExternalWait(id, turn)
          noteCallTrail(id, event.data.name, event.data.arguments)
          handleMidTurnSpinCheck(id, rootIdForAct)
        } else if (event.type === 'tool/result' && event.data) {
          noteCallResult(id, event.data)
          handleMidTurnSpinCheck(id, rootIdForAct)
        }
        autoContinue.onSessionEvent(session, event)

        if (event.type === 'turn/end') {
          const rawReason = event.data && event.data.reason
          const reason = String(rawReason && typeof rawReason === 'object' ? (rawReason.kind || '') : (rawReason || '')).toLowerCase()
          const nestedReason = String(rawReason && typeof rawReason === 'object' && rawReason.reason && typeof rawReason.reason === 'object' ? (rawReason.reason.kind || '') : '').toLowerCase()
          const isStoppedByUserOrPolicy = reason === 'aborted' || reason === 'blocked' || nestedReason === 'aborted' || nestedReason === 'blocked'
          const abnormalTrig = (reason === 'error' || nestedReason === 'error')
            ? 'turn_error'
            : ((reason === 'interrupted' || nestedReason === 'interrupted' || reason === 'max-tokens' || reason === 'no-visible-output') ? 'stream_interrupted' : '')
          const turnNum = Number(event.data && event.data.turn)
          const steerKey = `${id}:${turnNum}`
          const steeredAt = deps.hostState.autoSteeredTurns.get(steerKey) || 0
          if (steeredAt) deps.hostState.autoSteeredTurns.delete(steerKey)
          const stNow = loadChiefState()
          const rootId = resolveRootSessionId(id) || id
          const cfgNow = resolveWorkspaceConfig(stNow, rootId)
          const strongIntervention = Boolean(cfgNow.tacticalModes && cfgNow.tacticalModes.intervention)
          if (!isStoppedByUserOrPolicy && (strongIntervention || !(steeredAt && Date.now() - steeredAt < 30_000))) {
            if (!isRootStopped(rootId, id) || abnormalTrig) {
              const agents = runtime && runtime.get ? runtime.get('agents') : null
              const liveAgent = agents && typeof agents.get === 'function' ? agents.get(id) : null
              if (liveAgent) {
                scheduleChiefTurnReview(makeChiefDeps(runtime), {
                  agent: liveAgent,
                  sessionId: id,
                  turn: event.data && event.data.turn,
                  ...(abnormalTrig ? { abnormalTrigger: abnormalTrig } : {}),
                })
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
        const turnRootId = resolveRootSessionId(id, agent) || id
        if (!isSessionActive(turnRootId, agent)) return

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
                const returnStepId = task.targetPlanStepId || task.planStepId
                const returnStepIdx = returnStepId && Array.isArray(board.plan)
                  ? board.plan.findIndex(s => s && s.id === returnStepId)
                  : -1
                const returnTag = returnStepIdx >= 0 ? '（已回指步骤 ' + (returnStepIdx + 1) + '）' : ''
                pushLog(board, '✅ 子代理 ' + identity.self + ' 完成任务 #' + task.id + '「' + task.title.slice(0, 36) + '」' + returnTag, identity.self, id)
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
          if (isExplicitStopped(rootId, id)) {
            saveBoard(board, file)
            return
          }

          // autoInject is machine-wide on the shared board; guardIdle follows the
          // same rule so one switch turns the guard off everywhere.
          const shared = loadBoard(boardFile())
          const settings = { ...(board.settings || {}), ...(shared.settings || {}) }
          const effCfg = resolveWorkspaceConfig(loadChiefState(), rootId)
          if (
            capturedEntry
            && effCfg.externalMemory
            && effCfg.externalMemory.enabled
            && effCfg.externalMemory.memorySlot
            && effCfg.externalMemory.memorySlot.syncLeadSummary === true
          ) {
            try {
              const leadCwd = getSessionCwd(runtime, rootId) || ''
              void syncChiefTurnAsync(effCfg.externalMemory, {
                userText: capturedEntry.title || '主对话回合进展',
                chiefReply: capturedEntry.text || '',
                sessionId: rootId,
                workspaceCwd: leadCwd,
                projectKey: resolveProjectKey(leadCwd),
                turnKind: 'lead_summary',
              })
            } catch {}
          }
          const strongIntervention = Boolean(effCfg.tacticalModes && effCfg.tacticalModes.intervention)
          const maxInterventionTurns = Number(effCfg.tacticalModes && effCfg.tacticalModes.maxInterventionTurns) || 0
          let hasRunningSubagent = false
          let hasLinkedPeers = false
          try {
            const rosterForGuard = getSubagentRoster(runtime, rootId, board)
            hasRunningSubagent = Array.isArray(rosterForGuard) && rosterForGuard.some(a =>
              a && a.name !== 'lead' && a.verifiedInstance !== false && !a.stale && a.status === 'running',
            )
            const linkedForGuard = linkedPeersForSession(runtime, rootId || 'global')
            hasLinkedPeers = Boolean(linkedForGuard && Number(linkedForGuard.linkedPeersCount) > 0)
          } catch {}
          const verdict = shouldGuard({
            board,
            session: agent && agent.session,
            sessionId: id,
            turn,
            settings,
            strongIntervention,
            maxInterventionTurns,
            hasRunningSubagent,
            hasLinkedPeers,
          })
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
          const remAfter = remainingInterventions(id, settings, { strongIntervention, maxInterventionTurns })
          pushLog(board, guardLogText(verdict, turn, remAfter), 'guard', id)

          // Auto-handoff backup: when the guard has spent its last intervention and
          // the session still has open work, refresh and back up the handover packet
          // strictly inside this session's own board (notes + handoff timestamp) —
          // NEVER write to global pending-transfer.json where an unrelated new chat
          // could hijack it on creation.
          if (remAfter === 0) {
            try {
              const packet = resolveEffectiveHandoff(runtime, id, board).text
              const backupNow = nowMs()
              if (!board.handoff || !board.handoff.pinned) {
                board.handoff = {
                  ...(board.handoff || {}),
                  at: backupNow,
                  by: 'guard',
                  session: id,
                  updatedAt: backupNow,
                  source: (board.handoff && board.handoff.customText) ? (board.handoff.source || 'human') : 'auto',
                }
              }
              const backupTitle = '自动交接单（干预计数耗尽备份）'
              const backupBody = String(packet || '').slice(0, 6000)
              if (!Array.isArray(board.notes)) board.notes = []
              const sameBackup = board.notes.find(note => note && note.title === backupTitle)
              if (sameBackup) {
                sameBackup.body = backupBody
                sameBackup.updatedAt = backupNow
                sameBackup.session = id
              } else {
                board.notes.unshift(normalizeNote({ id: newId('n'), title: backupTitle, body: backupBody, tags: ['handoff'], by: 'guard', session: id }))
              }
              pushLog(board, '上下文压力：干预计数耗尽，交接单已保存至本会话看板（不再自动派发给新对话）', 'handoff', id)
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

    // Model tools: the cross-Session half of the same operations + whole-session pre-execute physical defense.
    ctx.inject(['tools'], toolCtx => {
      for (const tool of [boardTool(runtime), boundariesTool(runtime), handoffTool(runtime), memoryTool(runtime)]) {
        toolCtx.effect(() => toolCtx.tools.register(tool), 'dsh-chief: tool ' + tool.name)
      }
      const hookOn = typeof toolCtx.on === 'function'
        ? toolCtx.on.bind(toolCtx)
        : (typeof ctx.on === 'function' ? ctx.on.bind(ctx) : null)
      if (hookOn) {
        toolCtx.effect(() => hookOn('tools/pre-execute', async (exec, next) => {
          try {
            if (!exec || !exec.name) return next()
            const caller = exec.agent || null
            const sid = caller && caller.id ? String(caller.id) : ''
            const rootId = resolveRootSessionId(sid, caller) || sid || 'global'
            if (!isSessionActive(rootId, caller)) return next()
            const preState = loadChiefState()
            const preEffCfg = resolveWorkspaceConfig(preState, rootId)
            const safetyGuardEnabled = !(preEffCfg && preEffCfg.tacticalModes && preEffCfg.tacticalModes.safetyGuardEnabled === false)
            const cwd = (sid && getSessionCwd(runtime, sid)) || (rootId !== 'global' && getSessionCwd(runtime, rootId)) || process.cwd()
            const board = rootId && rootId !== 'global' ? boardForSession(boardFileFor(rootId)) : loadBoard(boardFile())
            const verdict = evaluatePreExecuteDefense({
              tool: String(exec.name),
              args: exec.arguments && typeof exec.arguments === 'object' ? exec.arguments : {},
              cwd,
              board,
              safetyGuardEnabled,
            })
            if (verdict && verdict.decision === 'deny') {
              const st = loadChiefState()
              const effCfg = resolveWorkspaceConfig(st, rootId)
              const ident = resolveAgentIdentity(runtime, sid, caller)
              const actorName = (ident && ident.self) || 'lead'
              const isCustomRuleBlock = Boolean(verdict.wallId)
              const sourceIconTitle = isCustomRuleBlock ? '🚧 自定义拦截规则已拦截' : '🛡️ 安全拦截已拦截'
              const sourceLabel = isCustomRuleBlock ? '自定义拦截规则' : '安全拦截'
              const targetPreview = String(
                (exec.arguments && (exec.arguments.path || exec.arguments.file_path || exec.arguments.command || exec.arguments.cmd))
                || exec.name,
              ).slice(0, 120)
              appendChiefAuditLog(rootId, {
                mode: effCfg.permissionMode || 'advisor',
                stage: verdict.stage || (isCustomRuleBlock ? 'guard_wall' : 'safety_guard'),
                rule: verdict.rule || 'pre_execute_denied',
                decision: 'blocked',
                operation: String(exec.name),
                target: targetPreview,
                reason: verdict.reason,
                outcome: 'blocked',
                by: actorName,
              })
              recordWorkspaceAlertEvent(rootId, {
                kind: isCustomRuleBlock ? 'guard_wall_blocked' : 'safety_guard_blocked',
                level: 'danger',
                title: sourceIconTitle,
                body: `@${actorName} 调用 ${exec.name}：${String(verdict.reason || '').slice(0, 140)}`,
                dedupeKey: `wall:${rootId}:${exec.name}:${verdict.wallId || verdict.rule || ''}`,
              })
              try {
                const bFile = rootId !== 'global' ? boardFileFor(rootId) : boardFile()
                withBoardLock(bFile, () => {
                  const b = loadBoard(bFile)
                  pushLog(b, `${sourceIconTitle} @${actorName} 调用 ${exec.name}：${String(verdict.reason || '').slice(0, 110)}`, 'guard', sid || rootId)
                  saveBoard(b, bFile)
                })
              } catch {}
              mutateChiefState((s) => {
                if (!s.workspaces || !s.workspaces[rootId]) return
                const ws = s.workspaces[rootId]
                if (!Array.isArray(ws.chat)) ws.chat = []
                ws.chat.push({
                  id: 'chat-' + Date.now().toString(36),
                  role: 'chief',
                  kind: 'receipt',
                  text: `- 【${sourceIconTitle}】已当场阻断 \`@${actorName}\` 的调用 \`${exec.name}\`\n- 【拦截原因】${verdict.reason}`,
                  actions: [sourceIconTitle],
                  at: Date.now(),
                })
              })
              if (effCfg && (effCfg.runMode === 'patrol' || effCfg.runMode === 'managed') && !effCfg.stopped) {
                scheduleChiefTurnReview(makeChiefDeps(runtime), {
                  agent: caller,
                  sessionId: sid || rootId,
                  abnormalTrigger: 'guard_wall_blocked',
                })
              }
              const escalationCue = isCustomRuleBlock
                ? `（严禁尝试命令或路径变形绕过自定义拦截规则 [${verdict.wallId}]；仅当你确认无任何合法替代方案可继续任务时，可调用 chief_board({ action: "chief.request", subject: "撞墙阻断上报", text: "说明被拦截规则(${verdict.wallId})、为何无法绕过及当前卡点" }) 上报参谋长评估）`
                : ''
              return {
                kind: 'deny',
                reason: `[DSH ${sourceLabel}已拦截] ${verdict.reason}${escalationCue}`,
                info: { stage: verdict.stage, rule: verdict.rule, wallId: verdict.wallId || '' },
              }
            } else if (verdict && verdict.decision === 'ask') {
              const st = loadChiefState()
              const effCfg = resolveWorkspaceConfig(st, rootId)
              const ident = resolveAgentIdentity(runtime, sid, caller)
              const actorName = (ident && ident.self) || 'lead'
              const targetPreview = String(
                (exec.arguments && (exec.arguments.path || exec.arguments.file_path || exec.arguments.command || exec.arguments.cmd))
                || exec.name,
              ).slice(0, 120)
              appendChiefAuditLog(rootId, {
                mode: effCfg.permissionMode || 'advisor',
                stage: verdict.stage || 'guard_wall',
                rule: verdict.rule || 'guard_wall_require_approval_cmd',
                decision: 'pending_approval',
                operation: String(exec.name),
                target: targetPreview,
                reason: verdict.reason,
                outcome: 'pending',
                by: actorName,
              })
              return {
                kind: 'ask',
                reason: `[DSH 自定义拦截规则审批] ${verdict.reason}`,
                displayReason: verdict.displayReason || verdict.reason,
              }
            }
          } catch {}
          return next()
        }), 'dsh-chief: pre-execute physical defense')
      }
    })

    // Runtime capability probe for DSH >= 0.2.2-rc.2 named subagent APIs & external Harness provider tracking
    ctx.inject(['subagents'], () => {
      const compat = probeSubagentSupport(runtime)
      if (compat.present && !compat.namedSubagentsSupported) {
        try {
          console.warn('[dsh-chief] ' + compat.warning)
        } catch {}
      }
      try {
        const sub = runtime && typeof runtime.get === 'function' ? runtime.get('subagents') : null
        if (sub && sub.providers instanceof Map) {
          for (const [pname, prov] of sub.providers.entries()) {
            if (pname && pname !== 'spawn' && pname !== 'fork') {
              deps.hostState.detectedHarnessProviders.set(pname, prov || { name: pname })
            }
          }
        }
      } catch {}
    })
    try {
      ctx.on?.('subagent/provider-added', (prov) => {
        const pname = String((prov && prov.name) || '').trim()
        if (!pname || pname === 'spawn' || pname === 'fork') return
        if (typeof prov?.prepareContinuable === 'function') return
        deps.hostState.detectedHarnessProviders.set(pname, prov)
      })
      ctx.on?.('subagent/provider-removed', (pname) => {
        if (pname) deps.hostState.detectedHarnessProviders.delete(String(pname))
      })
      ctx.on?.('subagent/end', (info) => {
        const cid = String((info && info.id) || '').trim()
        if (!cid) return
        for (const [k, run] of deps.hostState.activeBubbleRuns.entries()) {
          if (run && String(run.childId || '') === cid) {
            deps.hostState.activeBubbleRuns.delete(k)
          }
        }
      })
    } catch {}
    try {
      ctx.inject(['subprocess'], (subProcCtx) => {
        const rt = deps.hostState.activeRuntime
        let subProc = null
        try {
          subProc = (subProcCtx && typeof subProcCtx.get === 'function' ? subProcCtx.get('subprocess') : null)
            || (rt && typeof rt.get === 'function' ? rt.get('subprocess') : null)
            || null
        } catch {}
        deps.hostState.activeSubprocess = subProc
      })
    } catch {}

    // Cold-start safety reconciliation for persistent TaskLedger (stale running/resuming -> interrupted; past TTL -> expired)
    try {
      const bootSt = loadChiefState({ forceDisk: true })
      const hasNeedReconcile = Object.values((bootSt && bootSt.workspaces) || {}).some(
        ws => Array.isArray(ws && ws.taskLedger) && ws.taskLedger.some(t => t && (t.status === 'interrupted' || t.status === 'expired')),
      )
      if (hasNeedReconcile) mutateChiefState(() => {})
    } catch {}

    // Idle watchdog for Strong Intervention: catch already-stalled lead sessions cleanly without extra turns
    const lastWatchdogByRoot = new Map()
    const watchdogTimer = setInterval(() => {
      try {
        const agents = runtime && runtime.get ? runtime.get('agents') : null
        const allAgents = agents && typeof agents.list === 'function' ? (agents.list() || []) : []
        if (!allAgents.length) return
        const state = loadChiefState()
        const now = Date.now()
        for (const ag of allAgents) {
          const agId = String((ag && ag.id) || '').trim()
          if (!agId) continue
          const rootId = resolveRootSessionId(agId, ag) || agId
          if (rootId !== agId) continue
          if (!isChiefSessionEnabled(state, rootId)) continue
          const effCfg = resolveWorkspaceConfig(state, rootId)
          if (effCfg.stopped || effCfg.paceMode === 'stopped') continue
          if (!(effCfg.tacticalModes && effCfg.tacticalModes.intervention)) continue
          if (ag.status === 'running') continue

          const hasRunningChild = allAgents.some(c => {
            const cId = String((c && c.id) || '').trim()
            if (!cId || cId === rootId) return false
            if ((resolveRootSessionId(cId, c) || cId) !== rootId) return false
            if (/^mnemon-(?:review|run)/i.test(String((c && c.name) || cId))) return false
            return c && c.status === 'running'
          })
          if (hasRunningChild) continue

          const ws = state.workspaces && state.workspaces[rootId] ? state.workspaces[rootId] : null
          const rg = (ws && ws.runtimeGuard) || {}
          if (rg.circuitBroken || rg.hazardAlert) continue
          const hasPendingApr = Array.isArray(ws && ws.pendingApprovals) && ws.pendingApprovals.some(a => a && a.status === 'pending')
          if (hasPendingApr || (ws && ws.pendingElevation)) continue
          const hasPendingGoalSug = Array.isArray(ws && ws.suggestions) && ws.suggestions.some(s => s && s.status === 'pending' && s.kind === 'goal_approval')
          if (hasPendingGoalSug) continue

          const refAt = Math.max(Number(rg.lastActivityAt) || 0, Number(lastWatchdogByRoot.get(rootId)) || 0)
          if (now - refAt < 22_000) continue
          lastWatchdogByRoot.set(rootId, now)
          scheduleChiefTurnReview(makeChiefDeps(runtime), {
            agent: ag,
            sessionId: rootId,
            abnormalTrigger: 'idle_watchdog',
          })
        }
      } catch {}
    }, 25_000)
    watchdogTimer.unref?.()
    ctx.effect(() => () => clearInterval(watchdogTimer), 'dsh-chief: strong intervention watchdog cleanup')
  }

  return {
    apply,
  }
}
