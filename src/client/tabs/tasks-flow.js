/**
 * tabs/tasks-flow.js
 *
 * Unified workflow pipeline & serpentine Bezier beam canvas (`① -> ② -> ③ -> ...`)
 * with inline subagent dispatch & return curves and detail inspector drawer.
 */

import { React, h } from '../react-runtime.js'
import { STATUSES, STATUS_LABEL, GENERIC_OWNERS } from '../constants.js'
import { bi } from '../i18n.js'
import { store, patch, focusObjectiveInPyramid, openSubagentChat } from '../store.js'
import { clampTitle, shortAgentName, isInternalProbeName } from '../utils.js'
import { act } from '../api.js'
import { Icon } from '../components/common.js'

const FLOW_CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫']

const FLOW_STATUS_META = {
  done: { label: '已完成', agentLabel: '已交卷', hex: 'var(--dnb-sage, #63d1b0)', lightHex: 'var(--dnb-sage, #2b9b7b)', bg: 'var(--dnb-sage-soft, rgba(99, 209, 176, 0.14))' },
  doing: { label: '推进中', agentLabel: '运行中', hex: 'var(--dnb-accent, #9f8eff)', lightHex: 'var(--dnb-accent, #6f5ce8)', bg: 'var(--dnb-accent-soft, rgba(159, 142, 255, 0.16))' },
  blocked: { label: '受阻', agentLabel: '受阻/待批', hex: 'var(--dnb-coral, #f28b88)', lightHex: 'var(--dnb-coral, #d45d5d)', bg: 'var(--dnb-coral-soft, rgba(242, 139, 136, 0.14))' },
  todo: { label: '待开始', agentLabel: '待命', hex: 'var(--dnb-text-3, #8e8e93)', lightHex: 'var(--dnb-text-3, #64748b)', bg: 'var(--dnb-fill, rgba(142, 142, 147, 0.12))' },
}

function flowAppendPlanStep(board, text, stepApi) {
  const txt = String(text || '').trim()
  if (!txt) return false
  if (stepApi && typeof stepApi.onAppendStep === 'function') {
    stepApi.onAppendStep(txt)
    return true
  }
  const curPlan = board && Array.isArray(board.plan) ? board.plan : []
  const steps = [
    ...curPlan.map(s => ({ id: s.id, text: s.text, done: Boolean(s.done), ...(s.summary ? { summary: s.summary } : {}) })),
    { text: txt, done: false },
  ]
  void act({ action: 'plan.set', steps })
  return true
}

function flowSubmitStageSubtask(stage, title, agent) {
  const cleanTitle = String(title || '').trim()
  if (!cleanTitle || !stage) return false
  const cleanAgent = String(agent || '').trim().replace(/^@/, '')
  void act({
    action: 'task.add',
    title: cleanTitle,
    ...(stage.source === 'plan' ? { planStepId: stage.id } : {}),
    ...(stage.rootTask ? { parentId: stage.rootTask.id } : {}),
    ...(cleanAgent ? { owner: cleanAgent, subagent: cleanAgent } : {}),
  })
  return true
}

function flowOpenStageMenu(stage, stepApi, e) {
  if (!stage || stage.source !== 'plan' || !stepApi || typeof stepApi.onOpenStepMenu !== 'function' || typeof stage.planIndex !== 'number' || stage.planIndex < 0) return
  const useRect = !e.clientX && !e.clientY && e.currentTarget && typeof e.currentTarget.getBoundingClientRect === 'function'
  const rect = useRect ? e.currentTarget.getBoundingClientRect() : null
  const cx = rect ? rect.left : e.clientX
  const cy = rect ? rect.bottom + 4 : e.clientY
  stepApi.onOpenStepMenu(stage.planIndex, cx, cy)
}

function flowRenderAddStepRow({ stageCount, draft, setDraft, onAppend }) {
  return h(
    'div',
    { className: 'dnb-flow-add-step' },
    h('input', {
      className: 'dnb-input',
      style: { flex: 1, height: 30, borderRadius: 99, padding: '0 12px', fontSize: 12 },
      placeholder: bi(`添加第 ${stageCount + 1} 步（回车保存）…`, `Add step ${stageCount + 1} (Enter to save)…`),
      value: draft,
      onChange: e => setDraft(e.target.value),
      onKeyDown: e => { if (e.key === 'Enter') onAppend() },
    }),
    h('button', {
      type: 'button',
      className: 'dnb-pill',
      style: { height: 30, padding: '0 12px', fontSize: 11.5 },
      disabled: !String(draft || '').trim(),
      onClick: onAppend,
    }, bi('加一步', 'Add Step')),
  )
}

function flowRenderStepActionsRow({ stage, canBindStepMenu, stepApi, isAddingHere, onToggleAdd, inlineExtra }) {
  return h(
    React.Fragment,
    null,
    canBindStepMenu && typeof stepApi.onExplainStep === 'function'
      ? h('button', {
          type: 'button',
          className: 'dnb-flow-step-text-btn',
          style: { color: 'var(--dnb-accent)' },
          title: bi('用大白话解释这一步', 'Explain this step simply'),
          onClick: () => stepApi.onExplainStep(stage.planIndex, stage.title),
        }, bi('解释', 'Explain'))
      : null,
    canBindStepMenu && typeof stepApi.onConsultStep === 'function'
      ? h('button', {
          type: 'button',
          className: 'dnb-flow-step-text-btn',
          'data-active': stepApi.consultIdx === stage.planIndex ? '1' : '0',
          title: bi('打开提问框，问主对话或参谋长', 'Ask main chat or Chief'),
          onClick: () => stepApi.onConsultStep(stage.planIndex),
        }, bi('提问', 'Ask'))
      : null,
    h('button', {
      type: 'button',
      className: 'dnb-flow-mini-btn',
      'data-active': isAddingHere ? '1' : '0',
      title: bi('给这一步加子任务或找助手', 'Add subtask or assign subagent'),
      onClick: onToggleAdd,
    }, h(Icon, { name: 'plus', size: 12 })),
    canBindStepMenu && typeof stepApi.onOpenStepMenu === 'function'
      ? h('button', {
          type: 'button',
          className: 'dnb-flow-mini-btn',
          title: bi('更多操作：问参谋、标完成、删除', 'More: Ask Chief, Done, Delete'),
          onClick: e => flowOpenStageMenu(stage, stepApi, e),
        }, '⋯')
      : null,
    inlineExtra || null,
  )
}

function flowRenderInlineSubtaskAdder({ stage, title, setTitle, agent, setAgent, onSubmit }) {
  return h(
    'div',
    { className: 'dnb-flow-inline-add' },
    h('input', {
      className: 'dnb-input',
      style: { flex: 1, height: 28, fontSize: 11.5, padding: '0 10px' },
      placeholder: bi(`给第 ${flowCircledNum(stage.index)} 步加个子任务…`, `Subtask for Step ${flowCircledNum(stage.index)}…`),
      value: title,
      onChange: e => setTitle(e.target.value),
      onKeyDown: e => { if (e.key === 'Enter') onSubmit() },
    }),
    h('input', {
      className: 'dnb-input',
      style: { width: 92, height: 28, fontSize: 11.5, padding: '0 8px' },
      placeholder: bi('@找谁做（选填）', '@agent (optional)'),
      value: agent,
      onChange: e => setAgent(e.target.value),
      onKeyDown: e => { if (e.key === 'Enter') onSubmit() },
    }),
    h('button', {
      type: 'button',
      className: 'dnb-primary-btn',
      style: { height: 28, padding: '0 10px', fontSize: 11.5 },
      disabled: !String(title || '').trim(),
      onClick: onSubmit,
    }, bi('添加', 'Add')),
  )
}

function flowRenderStageChildrenBody({
  stage,
  board,
  flowModel,
  activeLeadTasks,
  doneLeadTasks,
  shouldFoldDoneTasks,
  doneFoldExpanded,
  onToggleDoneFold,
  onJumpToStage,
  onExplainTask,
  onOpenEditor,
  onContextMenu,
  renderInspector,
}) {
  return h(
    'div',
    { className: 'dnb-flow-stage-body' },
    stage.agentBranches.length > 0
      ? h(
          'div',
          { className: 'dnb-flow-branches' },
          stage.agentBranches.map(branch =>
            h(FlowAgentBranchCard, {
              key: branch.name,
              branch,
              board,
              stageById: flowModel.stageById,
              onJumpToStage,
              onExplainTask,
              onOpenEditor,
              onContextMenu,
              renderInspector,
            }),
          ),
        )
      : null,
    activeLeadTasks.length > 0
      ? h(
          'div',
          { className: 'dnb-flow-lead-tasks' },
          activeLeadTasks.map(t =>
            h(FlowMiniTaskItem, {
              key: t.id,
              task: t,
              board,
              stageById: flowModel.stageById,
              onExplainTask,
              onOpenEditor,
              onContextMenu,
              renderInspector,
            }),
          ),
        )
      : null,
    doneLeadTasks.length > 0
      ? shouldFoldDoneTasks
        ? h(
            'div',
            { className: 'dnb-flow-done-fold' },
            h(
              'button',
              {
                type: 'button',
                className: 'dnb-flow-done-fold-btn',
                'data-open': doneFoldExpanded ? '1' : '0',
                onClick: onToggleDoneFold,
              },
              h(
                'span',
                { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } },
                h(Icon, { name: 'check', size: 11, style: { color: 'var(--dnb-sage, #63d1b0)' } }),
                bi(`已完成 ${doneLeadTasks.length} 项任务`, `${doneLeadTasks.length} done tasks`),
              ),
              h(
                'span',
                { className: 'dnb-flow-done-fold-hint' },
                doneFoldExpanded ? bi('收起 ▴', 'Hide ▴') : bi('展开 ▾', 'Show ▾'),
              ),
            ),
            doneFoldExpanded
              ? h(
                  'div',
                  { className: 'dnb-flow-lead-tasks', style: { marginTop: 4 } },
                  doneLeadTasks.map(t =>
                    h(FlowMiniTaskItem, {
                      key: t.id,
                      task: t,
                      board,
                      stageById: flowModel.stageById,
                      onExplainTask,
                      onOpenEditor,
                      onContextMenu,
                      renderInspector,
                    }),
                  ),
                )
              : null,
          )
        : h(
            'div',
            { className: 'dnb-flow-lead-tasks' },
            doneLeadTasks.map(t =>
              h(FlowMiniTaskItem, {
                key: t.id,
                task: t,
                board,
                stageById: flowModel.stageById,
                onExplainTask,
                onOpenEditor,
                onContextMenu,
                renderInspector,
              }),
            ),
          )
      : null,
  )
}

function flowStageToggleAction(board, stage, stepApi) {
  if (!stage) return
  const canBindStepMenu = stage.source === 'plan' && stepApi && typeof stage.planIndex === 'number' && stage.planIndex >= 0
  if (canBindStepMenu && typeof stepApi.onToggleStep === 'function') {
    stepApi.onToggleStep(stage.planIndex)
  } else {
    flowToggleStageDone(board, stage)
  }
}

function flowStatusLabel(status) {
  switch (status) {
    case 'done': return bi('已完成', 'Done')
    case 'doing': return bi('推进中', 'Doing')
    case 'blocked': return bi('受阻', 'Blocked')
    default: return bi('待开始', 'To Do')
  }
}

function flowAgentStatusLabel(status) {
  switch (status) {
    case 'done': return bi('已交卷', 'Returned')
    case 'doing': return bi('运行中', 'Running')
    case 'blocked': return bi('受阻/待批', 'Blocked')
    default: return bi('等待中', 'Waiting')
  }
}

function flowCircledNum(idx) {
  return FLOW_CIRCLED[idx - 1] || String(idx)
}

function flowTopoSortRoots(roots) {
  if (roots.length <= 1) return roots.slice()
  const byId = new Map(roots.map(t => [t.id, t]))
  const inDeg = new Map(roots.map(t => [t.id, 0]))
  const adj = new Map(roots.map(t => [t.id, []]))
  for (const t of roots) {
    for (const depId of (Array.isArray(t.blockedBy) ? t.blockedBy : [])) {
      if (byId.has(depId) && depId !== t.id) {
        inDeg.set(t.id, (inDeg.get(t.id) || 0) + 1)
        adj.get(depId).push(t.id)
      }
    }
  }
  const ready = roots.filter(t => (inDeg.get(t.id) || 0) === 0).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
  const ordered = []
  const placed = new Set()
  while (ready.length) {
    const cur = ready.shift()
    if (!cur || placed.has(cur.id)) continue
    placed.add(cur.id)
    ordered.push(cur)
    for (const nxtId of adj.get(cur.id) || []) {
      const deg = (inDeg.get(nxtId) || 1) - 1
      inDeg.set(nxtId, deg)
      if (deg <= 0) {
        ready.push(byId.get(nxtId))
        ready.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
      }
    }
  }
  for (const t of roots) {
    if (!placed.has(t.id)) ordered.push(t)
  }
  return ordered
}

function flowResolveActiveStepId(board, stages) {
  if (!stages.length) return ''
  const cursorStep = String((board && board.cursor && board.cursor.step) || '').trim().toLowerCase()
  if (cursorStep) {
    const exact = stages.find(s => !s.done && s.title.toLowerCase() === cursorStep)
    if (exact) return exact.id
    const prefix = stages.find(s => !s.done && (
      s.title.toLowerCase().startsWith(cursorStep)
      || cursorStep.startsWith(s.title.toLowerCase().slice(0, 24))
    ))
    if (prefix) return prefix.id
  }
  const firstOpen = stages.find(s => !s.done)
  return firstOpen ? firstOpen.id : stages[stages.length - 1].id
}

/**
 * Build the UI workflow pipeline model combining sequential plan stages,
 * multi-tier subagent branches (`hier.kidsMap`), task assignments, and return edges.
 */
export function buildTaskFlowModel(board, allTasksRaw, filteredTasksRaw, hier, opts = {}) {
  const safeBoard = board && typeof board === 'object' ? board : {}
  const allTasks = Array.isArray(allTasksRaw) ? allTasksRaw.filter(Boolean) : []
  const filteredTasks = Array.isArray(filteredTasksRaw) ? filteredTasksRaw.filter(Boolean) : allTasks
  const filteredSet = new Set(filteredTasks.map(t => t.id))
  const rawPlan = Array.isArray(safeBoard.plan) ? safeBoard.plan : []
  const planEntries = rawPlan.map((s, rawIdx) => ({ s, rawIdx })).filter(({ s }) => s && s.text)
  const childrenAgents = (hier && Array.isArray(hier.children))
    ? hier.children.filter(a => a && a.name && !(isInternalProbeName(a.name) && a.status !== 'running' && opts.filterAgent !== a.name))
    : []

  const focusedTaskScopeSet = opts.focusedTaskScopeSet || new Set()
  const focusedAgentSet = opts.focusedAgentSet || new Set()

  let mode = 'empty'
  let stages = []

  if (planEntries.length > 0) {
    mode = 'plan'
    stages = planEntries.map(({ s, rawIdx }, idx) => ({
      id: String(s.id || ('s-' + (idx + 1))),
      index: idx + 1,
      planIndex: rawIdx,
      title: String(s.text || ''),
      done: s.done === true,
      summary: String(s.summary || ''),
      source: 'plan',
      rootTask: null,
      allTasks: [],
      leadTasks: [],
      agentBranches: [],
      status: 'todo',
    }))
  } else if (allTasks.length > 0) {
    mode = 'task-root'
    const ids = new Set(allTasks.map(t => t.id))
    const roots = flowTopoSortRoots(allTasks.filter(t => !t.parentId || !ids.has(t.parentId) || t.parentId === t.id))
    stages = roots.map((t, idx) => ({
      id: 's-' + t.id,
      index: idx + 1,
      planIndex: -1,
      title: String(t.title || ''),
      done: t.status === 'done',
      summary: String(t.evidence || ''),
      source: 'task-root',
      rootTask: t,
      allTasks: [],
      leadTasks: [],
      agentBranches: [],
      status: 'todo',
    }))
  } else if (childrenAgents.length > 0 || String(safeBoard.objective || '').trim()) {
    mode = 'synthetic'
    stages = [{
      id: 'stage-main',
      index: 1,
      planIndex: -1,
      title: String(safeBoard.objective || '').trim() || '当前主线任务',
      done: false,
      summary: '',
      source: 'synthetic',
      rootTask: null,
      allTasks: [],
      leadTasks: [],
      agentBranches: [],
      status: 'todo',
    }]
  }

  if (!stages.length) {
    return {
      mode: 'empty',
      stages: [],
      stageById: new Map(),
      activeStageId: '',
      stats: { totalStages: 0, doneStages: 0, doingStages: 0, blockedStages: 0, totalAgents: 0, runningAgents: 0, doneAgents: 0 },
    }
  }

  const stageById = new Map(stages.map(s => [s.id, s]))
  const taskById = new Map(allTasks.map(t => [t.id, t]))
  const activeStageId = flowResolveActiveStepId(safeBoard, stages)
  const doneRev = [...stages].reverse().find(s => s.done)
  const lastDoneStageId = doneRev ? doneRev.id : activeStageId

  const taskStageCache = new Map()
  const resolveTaskStageId = (task, seen = new Set()) => {
    if (!task) return activeStageId
    if (taskStageCache.has(task.id)) return taskStageCache.get(task.id)
    let hitId = ''
    if (task.planStepId && stageById.has(task.planStepId)) {
      hitId = task.planStepId
    } else if (stageById.has('s-' + task.id)) {
      hitId = 's-' + task.id
    } else {
      const byPrefix = stages.find(s => s.title && task.title && s.title.startsWith(task.title))
      if (byPrefix) hitId = byPrefix.id
    }
    if (!hitId && task.parentId && taskById.has(task.parentId) && !seen.has(task.id)) {
      seen.add(task.id)
      hitId = resolveTaskStageId(taskById.get(task.parentId), seen)
    }
    if (!hitId) {
      hitId = task.status === 'done' ? (lastDoneStageId || activeStageId) : activeStageId
    }
    taskStageCache.set(task.id, hitId)
    return hitId
  }

  for (const t of allTasks) {
    const sid = resolveTaskStageId(t)
    const st = stageById.get(sid) || stages[0]
    st.allTasks.push(t)
  }

  // Match tasks to subagents (same hierarchy logic as Grand Pyramid so branches stay faithful)
  const tasksByAgent = new Map()
  for (const a of childrenAgents) tasksByAgent.set(a.name, [])
  const claimedTaskIds = new Set()

  for (const t of allTasks) {
    const hit = hier && typeof hier.matchAgentRef === 'function'
      ? (hier.matchAgentRef(t.subagent || t.owner || t.session)
        || childrenAgents.find(a => a.taskId === t.id || (Array.isArray(a.tasks) && a.tasks.some(at => at && at.id === t.id))))
      : null
    if (hit && tasksByAgent.has(hit.name)) {
      tasksByAgent.get(hit.name).push(t)
      claimedTaskIds.add(t.id)
    } else {
      const ref = String(t.subagent || '').trim()
      if (ref && !GENERIC_OWNERS.has(ref.toLowerCase())) {
        if (!tasksByAgent.has(ref)) tasksByAgent.set(ref, [])
        tasksByAgent.get(ref).push(t)
        claimedTaskIds.add(t.id)
      }
    }
  }

  const deriveAgentStatus = (agentObj, ownTasks, childNodes) => {
    const rawSt = String((agentObj && agentObj.status) || '').trim().toLowerCase()
    const hasBlocked = ownTasks.some(t => t.status === 'blocked')
      || /error|fail|crash|blocked/.test(rawSt)
      || childNodes.some(c => c.status === 'blocked')
    if (hasBlocked) return 'blocked'
    const hasDoing = ownTasks.some(t => t.status === 'doing')
      || rawSt === 'running' || rawSt === 'active' || rawSt === 'working'
      || childNodes.some(c => c.status === 'doing')
    if (hasDoing) return 'doing'
    const allOwnDone = ownTasks.length > 0 && ownTasks.every(t => t.status === 'done')
    const hasOpenOwn = ownTasks.some(t => t.status === 'todo' || t.status === 'doing' || t.status === 'blocked')
    const ended = rawSt !== '' && rawSt !== 'running' && rawSt !== 'active' && rawSt !== 'working' && rawSt !== 'todo' && rawSt !== 'queued'
    if (allOwnDone || (ended && !hasOpenOwn && (childNodes.length === 0 || childNodes.every(c => c.status === 'done')))) {
      return 'done'
    }
    return 'todo'
  }

  let runningAgents = 0
  let doneAgents = 0
  const visitedAgents = new Set()

  const buildBranchNode = (agentObj, fallbackStageId) => {
    if (!agentObj || !agentObj.name || visitedAgents.has(agentObj.name)) return null
    visitedAgents.add(agentObj.name)

    const rawKids = (hier && hier.kidsMap && hier.kidsMap.get(agentObj.name)) || []
    const ownAllTasks = tasksByAgent.get(agentObj.name) || []
    const primaryTask = ownAllTasks.find(t => t.status === 'doing' || t.status === 'blocked')
      || ownAllTasks.find(t => t.status === 'todo')
      || ownAllTasks[0]
      || null

    let ownStageId = primaryTask ? resolveTaskStageId(primaryTask) : ''
    const preliminaryChildNodes = rawKids
      .filter(k => !opts.filterAgent || k.name === opts.filterAgent)
      .map(k => buildBranchNode(k, ownStageId || fallbackStageId))
      .filter(Boolean)

    if (!ownStageId && preliminaryChildNodes.length) {
      ownStageId = preliminaryChildNodes[0].fromStepId
    }
    const status = deriveAgentStatus(agentObj, ownAllTasks, preliminaryChildNodes)
    if (status === 'doing') runningAgents += 1
    else if (status === 'done') doneAgents += 1

    if (!ownStageId || !stageById.has(ownStageId)) {
      ownStageId = status === 'done'
        ? (lastDoneStageId || fallbackStageId || activeStageId)
        : (fallbackStageId || activeStageId)
    }

    const rawTargetId = primaryTask && primaryTask.targetPlanStepId ? primaryTask.targetPlanStepId : ''
    const returnTargetId = (rawTargetId && stageById.has(rawTargetId)) ? rawTargetId : ownStageId
    const returnStage = stageById.get(returnTargetId) || stageById.get(ownStageId) || stages[0]
    const visibleOwnTasks = ownAllTasks.filter(t => filteredSet.has(t.id))
    const isFocused = focusedAgentSet.has(agentObj.name)
      || ownAllTasks.some(t => focusedTaskScopeSet.has(t.id))
      || preliminaryChildNodes.some(c => c.isFocused)

    return {
      name: agentObj.name,
      id: String(agentObj.id || ''),
      agent: agentObj,
      status,
      ownAllTasks,
      tasks: visibleOwnTasks,
      primaryTask,
      fromStepId: ownStageId,
      returnTargetId: returnStage.id,
      returnTargetIndex: returnStage.index,
      returnTargetTitle: returnStage.title,
      isCrossStep: returnStage.id !== ownStageId,
      isFocused,
      children: preliminaryChildNodes,
    }
  }

  // Mount Tier-1 subagents (or filtered target agent) onto their resolved stage
  const tier1Agents = opts.filterAgent
    ? childrenAgents.filter(a => a.name === opts.filterAgent)
    : ((hier && hier.kidsMap && hier.kidsMap.get('lead')) || childrenAgents.filter(a => !hier || !hier.byName.has(hier.parentKeyOf.get(a.name))))

  for (const ag of tier1Agents) {
    const branch = buildBranchNode(ag, activeStageId)
    if (!branch) continue
    if (opts.statusFilter && opts.statusFilter !== 'all') {
      const hasFiltered = branch.tasks.length > 0 || branch.status === opts.statusFilter || branch.children.length > 0
      if (!hasFiltered) continue
    }
    const st = stageById.get(branch.fromStepId) || stages[0]
    st.agentBranches.push(branch)
  }

  // Also mount any virtual subagent names declared on tasks that aren't live in store.subagents
  for (const [agentName, aTasks] of tasksByAgent.entries()) {
    if (visitedAgents.has(agentName) || !aTasks.length) continue
    if (opts.filterAgent && agentName !== opts.filterAgent) continue
    const syntheticAgent = { name: agentName, id: '', status: aTasks.some(t => t.status === 'doing') ? 'running' : 'done' }
    const branch = buildBranchNode(syntheticAgent, activeStageId)
    if (!branch) continue
    if (opts.statusFilter && opts.statusFilter !== 'all' && !branch.tasks.length && branch.status !== opts.statusFilter) continue
    const st = stageById.get(branch.fromStepId) || stages[0]
    st.agentBranches.push(branch)
  }

  // Remaining lead / direct tasks under each stage
  for (const st of stages) {
    st.leadTasks = st.allTasks.filter(t => {
      if (!filteredSet.has(t.id) || claimedTaskIds.has(t.id)) return false
      // In task-root mode, if the root task itself IS the stage and has no subagent/children hidden, still list direct tasks that aren't purely redundant unless user needs controls
      return true
    })
  }

  // Derive 4-state status for each stage
  const firstOpen = stages.find(s => !s.done) || null
  const hasAnyDone = stages.some(s => s.done)
  const hasAnyActivity = hasAnyDone
    || Boolean(String((safeBoard.cursor && safeBoard.cursor.step) || '').trim())
    || allTasks.some(t => t.status !== 'todo')
    || childrenAgents.length > 0

  let doneStages = 0
  let doingStages = 0
  let blockedStages = 0
  for (const st of stages) {
    if (st.done) {
      st.status = 'done'
      doneStages += 1
    } else if (
      st.allTasks.some(t => t.status === 'blocked')
      || st.agentBranches.some(b => b.status === 'blocked')
    ) {
      st.status = 'blocked'
      blockedStages += 1
    } else if (
      st.allTasks.some(t => t.status === 'doing')
      || st.agentBranches.some(b => b.status === 'doing')
      || (firstOpen && firstOpen.id === st.id && hasAnyActivity)
    ) {
      st.status = 'doing'
      doingStages += 1
    } else {
      st.status = 'todo'
    }
  }

  return {
    mode,
    stages,
    stageById,
    activeStageId,
    stats: {
      totalStages: stages.length,
      doneStages,
      doingStages,
      blockedStages,
      totalAgents: visitedAgents.size,
      runningAgents,
      doneAgents,
    },
  }
}

function flowToggleStageDone(board, stage) {
  if (!stage) return
  if (stage.source === 'plan' && board && Array.isArray(board.plan)) {
    const steps = board.plan.map(s => ({
      id: s.id,
      text: s.text,
      done: s.id === stage.id ? !s.done : Boolean(s.done),
      ...(s.summary ? { summary: s.summary } : {}),
    }))
    void act({ action: 'plan.set', steps })
  } else if (stage.source === 'task-root' && stage.rootTask) {
    void act({ action: 'task.update', id: stage.rootTask.id, status: stage.done ? 'todo' : 'done' })
  }
}

function FlowMiniTaskItem({ task, board, stageById, onExplainTask, onOpenEditor, onContextMenu, renderInspector }) {
  const isSelected = store.selectedTaskId === task.id
  const isFocused = store.focusTaskId === task.id
  const isDone = task.status === 'done'
  const isDoing = task.status === 'doing'
  const isBlocked = task.status === 'blocked'
  const next = STATUSES[(STATUSES.indexOf(task.status) + 1) % STATUSES.length]
  const meta = FLOW_STATUS_META[task.status] || FLOW_STATUS_META.todo
  const targetStage = task.targetPlanStepId && task.targetPlanStepId !== task.planStepId && stageById
    ? stageById.get(task.targetPlanStepId)
    : null

  return h(
    'div',
    { className: 'dnb-flow-task-wrap', 'data-flow-spotlight': isFocused ? '1' : undefined },
    h(
      'div',
      {
        className: 'dnb-flow-task-row',
        'data-status': task.status,
        'data-selected': isSelected ? '1' : '0',
        onClick: () => patch({ selectedTaskId: isSelected ? '' : task.id }),
        onContextMenu: e => {
          if (onContextMenu) {
            e.preventDefault()
            e.stopPropagation()
            onContextMenu(e, task)
          }
        },
      },
      h(
        'button',
        {
          type: 'button',
          className: 'dnb-ring',
          style: isDone
            ? { background: '#22c55e', borderColor: '#22c55e', color: '#fff', flexShrink: 0 }
            : { borderColor: meta.hex, flexShrink: 0 },
          title: '切换为 ' + STATUS_LABEL[next],
          onClick: e => {
            e.stopPropagation()
            void act({ action: 'task.update', id: task.id, status: next })
          },
        },
        isDone
          ? h(Icon, { name: 'check', size: 10 })
          : isDoing
            ? h('span', { className: 'dnb-spin-ring', style: { '--dnb-spin-size': '9px', color: '#3b82f6' } })
            : null,
      ),
      h(
        'div',
        { style: { flex: 1, minWidth: 0 } },
        h(
          'div',
          { className: 'dnb-flow-task-title', 'data-done': isDone ? '1' : '0' },
          cleanFlowTitle(task.title),
          targetStage
            ? h('span', { className: 'dnb-flow-xstep-pill' }, '→ 步骤 ' + flowCircledNum(targetStage.index))
            : null,
        ),
        task.evidence && isDone
          ? h('div', { className: 'dnb-flow-task-ev' }, '✓ ' + clampTitle(task.evidence, 42))
          : task.intent
            ? h('div', { className: 'dnb-flow-task-sub' }, clampTitle(task.intent, 42))
            : null,
      ),
      h(
        'div',
        { className: 'dnb-flow-task-actions', onClick: e => e.stopPropagation() },
        onExplainTask
          ? h('button', {
              type: 'button',
              className: 'dnb-flow-mini-btn',
              title: '用大白话解释这条',
              onClick: () => onExplainTask(task),
            }, h(Icon, { name: 'sparkles', size: 11 }))
          : null,
        h('button', {
          type: 'button',
          className: 'dnb-flow-mini-btn',
          title: isDoing ? '唤醒子代理' : '派发子代理',
          onClick: () => void act({
            action: 'task.dispatch',
            id: task.id,
            agent: task.subagent || task.owner || ('worker-' + String(task.id).slice(-4)),
          }),
        }, h(Icon, { name: 'play', size: 10 })),
        h('button', {
          type: 'button',
          className: 'dnb-flow-mini-btn',
          'data-active': isFocused ? '1' : '0',
          title: isFocused ? '取消高亮定位' : '在图里高亮定位',
          onClick: () => focusObjectiveInPyramid(isFocused ? '' : task.id),
        }, h(Icon, { name: 'target', size: 10.5 })),
        onOpenEditor
          ? h('button', {
              type: 'button',
              className: 'dnb-flow-mini-btn',
              title: '修改任务',
              onClick: () => onOpenEditor(task),
            }, h(Icon, { name: 'edit', size: 10.5 }))
          : null,
      ),
    ),
    isSelected && renderInspector ? renderInspector(task) : null,
  )
}

function FlowAgentBranchCard({
  branch,
  board,
  stageById,
  depth = 0,
  onJumpToStage,
  onExplainTask,
  onOpenEditor,
  onContextMenu,
  renderInspector,
}) {
  const meta = FLOW_STATUS_META[branch.status] || FLOW_STATUS_META.todo
  const targetCircle = flowCircledNum(branch.returnTargetIndex)
  const returnText = branch.status === 'done'
    ? (branch.isCrossStep ? bi(`↩ 已完成 · 结果交给步骤 ${targetCircle}`, `↩ Done · Hands off to Step ${targetCircle}`) : bi(`↩ 已完成 · 回到步骤 ${targetCircle}`, `↩ Done · Back to Step ${targetCircle}`))
    : branch.status === 'blocked'
      ? bi(`⚠ 卡住了 · 解决后回到步骤 ${targetCircle}`, `⚠ Blocked · Back to Step ${targetCircle}`)
      : branch.status === 'doing'
        ? bi(`⇢ 进行中 · 做完回到步骤 ${targetCircle}`, `⇢ Running · Back to Step ${targetCircle}`)
        : bi(`⇢ 待开始 · 做完回到步骤 ${targetCircle}`, `⇢ Waiting · Back to Step ${targetCircle}`)

  return h(
    'div',
    {
      className: 'dnb-flow-branch-node',
      'data-status': branch.status,
      'data-focused': branch.isFocused ? '1' : '0',
      'data-flow-spotlight': branch.isFocused ? '1' : undefined,
      style: depth > 0 ? { marginLeft: 12 } : undefined,
    },
    h(
      'div',
      { className: 'dnb-flow-agent-card', 'data-status': branch.status, 'data-focused': branch.isFocused ? '1' : '0' },
      h(
        'div',
        { className: 'dnb-flow-agent-head' },
        h(
          'div',
          { className: 'dnb-flow-agent-id' },
          h(Icon, { name: 'agentSub', size: 13 }),
          h('span', { className: 'dnb-flow-agent-name' }, '@' + shortAgentName(branch.name, depth > 0)),
          h(
            'span',
            { className: 'dnb-flow-status-pill', 'data-status': branch.status },
            branch.status === 'doing'
              ? h('span', { className: 'dnb-spin-ring', style: { '--dnb-spin-size': '8px', color: 'currentColor' } })
              : h('span', { className: 'dnb-flow-dot', style: { background: meta.hex } }),
            flowAgentStatusLabel(branch.status),
          ),
        ),
        h(
          'div',
          { className: 'dnb-flow-agent-tools' },
          branch.agent && branch.agent.id
            ? h('button', {
                type: 'button',
                className: 'dnb-flow-mini-btn',
                title: bi('打开子代理聊天窗口', 'Open subagent chat'),
                onClick: () => openSubagentChat(branch.agent),
              }, h(Icon, { name: 'chat', size: 11 }))
            : null,
          branch.primaryTask
            ? h('button', {
                type: 'button',
                className: 'dnb-flow-mini-btn',
                title: bi('查看或修改对应任务', 'View or edit linked task'),
                onClick: () => patch({ selectedTaskId: store.selectedTaskId === branch.primaryTask.id ? '' : branch.primaryTask.id }),
              }, h(Icon, { name: 'sliders', size: 11 }))
            : null,
        ),
      ),

      branch.tasks.length > 0
        ? h(
            'div',
            { className: 'dnb-flow-agent-tasks' },
            branch.tasks.map(t =>
              h(FlowMiniTaskItem, {
                key: t.id,
                task: t,
                board,
                stageById,
                onExplainTask,
                onOpenEditor,
                onContextMenu,
                renderInspector,
              }),
            ),
          )
        : null,

      // Explicit return pointer back to target plan stage
      h(
        'button',
        {
          type: 'button',
          className: 'dnb-flow-return-badge',
          'data-status': branch.status,
          title: bi(`跳到步骤 ${targetCircle} ${branch.returnTargetTitle}`, `Jump to Step ${targetCircle}: ${branch.returnTargetTitle}`),
          onClick: () => onJumpToStage && onJumpToStage(branch.returnTargetId),
        },
        h('span', null, returnText),
        branch.isCrossStep
          ? h('span', { className: 'dnb-flow-return-sub' }, clampTitle(branch.returnTargetTitle, 14))
          : null,
      ),
    ),

    branch.children && branch.children.length > 0
      ? h(
          'div',
          { className: 'dnb-flow-sub-indent' },
          branch.children.map(kid =>
            h(FlowAgentBranchCard, {
              key: kid.name,
              branch: kid,
              board,
              stageById,
              depth: depth + 1,
              onJumpToStage,
              onExplainTask,
              onOpenEditor,
              onContextMenu,
              renderInspector,
            }),
          ),
        )
      : null,
  )
}

function beamFlattenBranches(list, depth = 0, out = []) {
  for (const b of (Array.isArray(list) ? list : [])) {
    if (!b) continue
    out.push({ branch: b, depth })
    if (Array.isArray(b.children) && b.children.length) {
      beamFlattenBranches(b.children, depth + 1, out)
    }
  }
  return out
}

function cleanFlowTitle(raw) {
  return String(raw || '')
    .replace(/^(?:\s*\[\s*[xX✓✔]?\s*\]\s*)+/, '')
    .trim() || String(raw || '').trim()
}

function splitSvgLines(text, maxChars = 15.5, maxLines = 2) {
  const clean = cleanFlowTitle(text)
  if (!clean) return ['']
  const lines = []
  let cur = ''
  let curW = 0
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i]
    const w = ch.charCodeAt(0) > 127 ? 1 : 0.56
    if (curW + w > maxChars && cur) {
      if (lines.length + 1 >= maxLines) {
        cur = cur.slice(0, Math.max(1, cur.length - 1)) + '…'
        lines.push(cur)
        return lines
      }
      lines.push(cur)
      cur = ch
      curW = w
    } else {
      cur += ch
      curW += w
    }
  }
  if (cur) lines.push(cur)
  return lines.slice(0, maxLines)
}

/**
 * Deterministic SVG dot-matrix workflow layout (`isLR=false`: vertical spine left
 * with sprouted subagents right; `isLR=true`: horizontal spine top with subagents below).
 */
export function computeFlowCanvasLayout(flowModel, isLR = false) {
  const stages = (flowModel && Array.isArray(flowModel.stages)) ? flowModel.stages : []
  const STAGE_W = 246
  const STAGE_H = 74
  const AGENT_W = 204
  const AGENT_H = 60
  const PAD = 20
  const COL_GAP = 68
  const ROW_GAP = 26
  const AGENT_GAP = 12
  const NEST_OFFSET_X = 22

  const stageBoxes = []
  const stageBoxById = new Map()
  const agentBoxes = []
  const spineEdges = []
  const dispatchEdges = []
  const returnEdges = []

  if (!stages.length) {
    return { stages, stageBoxes, agentBoxes, spineEdges, dispatchEdges, returnEdges, svgW: 320, svgH: 150 }
  }

  if (!isLR) {
    // Top-Down Backbone: clean vertical stages left + subagent lanes right
    let curY = PAD
    for (const stage of stages) {
      const flat = beamFlattenBranches(stage.agentBranches)
      const branchBlockH = flat.length > 0 ? flat.length * AGENT_H + (flat.length - 1) * AGENT_GAP : 0
      const bandH = Math.max(STAGE_H, branchBlockH)
      const stageY = curY + Math.max(0, Math.round((bandH - STAGE_H) / 2))
      const sb = { stage, x: PAD, y: stageY, w: STAGE_W, h: STAGE_H }
      stageBoxes.push(sb)
      stageBoxById.set(stage.id, sb)

      flat.forEach((entry, bIdx) => {
        const ax = PAD + STAGE_W + COL_GAP + entry.depth * NEST_OFFSET_X
        const ay = curY + bIdx * (AGENT_H + AGENT_GAP)
        agentBoxes.push({
          ...entry.branch,
          depth: entry.depth,
          stageId: stage.id,
          x: ax,
          y: ay,
          w: AGENT_W,
          h: AGENT_H,
        })
      })
      curY += bandH + ROW_GAP
    }

    for (const ab of agentBoxes) {
      const srcStage = stageBoxById.get(ab.stageId)
      const dstStage = stageBoxById.get(ab.returnTargetId) || srcStage
      const stKey = ['done', 'doing', 'blocked'].includes(ab.status) ? ab.status : 'todo'
      const active = stKey === 'doing'
      if (srcStage) {
        const sx = srcStage.x + srcStage.w
        const sy = srcStage.y + 22
        const ax = ab.x - 2
        const ay = ab.y + 19
        const mx = Math.round((sx + ax) / 2)
        dispatchEdges.push({
          key: `disp-${ab.stageId}-${ab.name}`,
          status: stKey,
          active,
          d: `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ay}, ${ax} ${ay}`,
        })
      }
      if (dstStage) {
        const ax = ab.x
        const ay = ab.y + AGENT_H - 16
        const tx = dstStage.x + dstStage.w + 3
        const ty = dstStage.y + dstStage.h - 18
        const isCross = Boolean(ab.isCrossStep && dstStage.stage.id !== ab.stageId)
        const ctrl = isCross ? Math.max(36, Math.round((ax - tx) * 0.62)) : Math.max(24, Math.round((ax - tx) * 0.48))
        returnEdges.push({
          key: `ret-${ab.stageId}-${ab.name}`,
          status: stKey,
          active,
          crossStep: isCross,
          d: `M ${ax} ${ay} C ${ax - ctrl} ${ay + 10}, ${tx + ctrl} ${ty + 8}, ${tx} ${ty}`,
        })
      }
    }
  } else {
    // Left-Right Backbone: horizontal stages along top + subagent lanes below
    let curX = PAD
    for (const stage of stages) {
      const flat = beamFlattenBranches(stage.agentBranches)
      const maxDepth = flat.reduce((m, e) => Math.max(m, e.depth), 0)
      const bandW = Math.max(STAGE_W, AGENT_W + maxDepth * NEST_OFFSET_X)
      const sx = curX + Math.round((bandW - STAGE_W) / 2)
      const sb = { stage, x: sx, y: PAD, w: STAGE_W, h: STAGE_H }
      stageBoxes.push(sb)
      stageBoxById.set(stage.id, sb)

      flat.forEach((entry, bIdx) => {
        const ax = curX + entry.depth * NEST_OFFSET_X
        const ay = PAD + STAGE_H + 52 + bIdx * (AGENT_H + AGENT_GAP)
        agentBoxes.push({
          ...entry.branch,
          depth: entry.depth,
          stageId: stage.id,
          x: ax,
          y: ay,
          w: AGENT_W,
          h: AGENT_H,
        })
      })
      curX += bandW + 42
    }

    for (const ab of agentBoxes) {
      const srcStage = stageBoxById.get(ab.stageId)
      const dstStage = stageBoxById.get(ab.returnTargetId) || srcStage
      const stKey = ['done', 'doing', 'blocked'].includes(ab.status) ? ab.status : 'todo'
      const active = stKey === 'doing'
      if (srcStage) {
        const sx = srcStage.x + Math.round(srcStage.w * 0.34)
        const sy = srcStage.y + srcStage.h
        const ax = ab.x + Math.round(ab.w * 0.25)
        const ay = ab.y - 2
        const my = Math.round((sy + ay) / 2)
        dispatchEdges.push({
          key: `disp-${ab.stageId}-${ab.name}`,
          status: stKey,
          active,
          d: `M ${sx} ${sy} C ${sx} ${my}, ${ax} ${my}, ${ax} ${ay}`,
        })
      }
      if (dstStage) {
        const ax = ab.x + Math.round(ab.w * 0.78)
        const ay = ab.y
        const tx = dstStage.x + Math.round(dstStage.w * 0.72)
        const ty = dstStage.y + dstStage.h + 3
        const my = Math.round((ay + ty) / 2)
        const isCross = Boolean(ab.isCrossStep && dstStage.stage.id !== ab.stageId)
        returnEdges.push({
          key: `ret-${ab.stageId}-${ab.name}`,
          status: stKey,
          active,
          crossStep: isCross,
          d: `M ${ax} ${ay} C ${ax + 14} ${my}, ${tx + 14} ${my}, ${tx} ${ty}`,
        })
      }
    }
  }

  for (let i = 0; i < stageBoxes.length - 1; i += 1) {
    const sb = stageBoxes[i]
    const nxt = stageBoxes[i + 1]
    const st1 = sb.stage.status
    const st2 = nxt.stage.status
    const edgeStatus = (st1 === 'blocked' || st2 === 'blocked')
      ? 'blocked'
      : (st1 === 'done' ? 'done' : ((st1 === 'doing' || st2 === 'doing') ? 'doing' : 'todo'))
    const d = !isLR
      ? `M ${sb.x + sb.w / 2} ${sb.y + sb.h} L ${nxt.x + nxt.w / 2} ${nxt.y - 4}`
      : `M ${sb.x + sb.w} ${sb.y + sb.h / 2} L ${nxt.x - 4} ${nxt.y + nxt.h / 2}`
    spineEdges.push({
      key: `spine-${sb.stage.id}->${nxt.stage.id}`,
      edgeStatus,
      active: st1 === 'doing' || st2 === 'doing',
      d,
    })
  }

  const maxX = Math.max(...stageBoxes.map(b => b.x + b.w), ...agentBoxes.map(b => b.x + b.w), 260)
  const maxY = Math.max(...stageBoxes.map(b => b.y + b.h), ...agentBoxes.map(b => b.y + b.h), 120)
  const svgW = maxX + PAD
  const svgH = maxY + PAD
  return { stages, stageBoxes, agentBoxes, spineEdges, dispatchEdges, returnEdges, svgW, svgH }
}

/**
 * Unified Task Flow Board: Dot-matrix interactive SVG workflow canvas
 * (vertical backbone + subagent branches + Bezier dispatch/return arcs + zoom/pan)
 * paired with bottom inline step inspector & consultation drawer.
 */
export function TaskBeamFlowView({
  flowModel,
  board,
  collapsed,
  onToggleCollapse,
  onExplainTask,
  onOpenEditor,
  onContextMenu,
  selectedTask,
  renderInspector,
  onTriggerAiPlan,
  statusFilter = 'all',
  stepApi = null,
  externalSelectStage = null,
}) {
  const stages = (flowModel && Array.isArray(flowModel.stages)) ? flowModel.stages : []
  const canvasRef = React.useRef(null)
  const panRef = React.useRef(null)
  const [isLR, setIsLR] = React.useState(false)
  const [zoom, setZoom] = React.useState(1)
  const [hoveredKey, setHoveredKey] = React.useState('')
  const [selectedStageId, setSelectedStageId] = React.useState('')
  const [drawerOpen, setDrawerOpen] = React.useState(true)
  const [openDoneStages, setOpenDoneStages] = React.useState({})
  const [addingToStageId, setAddingToStageId] = React.useState('')
  const [stageTaskTitle, setStageTaskTitle] = React.useState('')
  const [stageTaskAgent, setStageTaskAgent] = React.useState('')
  const [newStepDraft, setNewStepDraft] = React.useState('')

  const rankLeadTask = t => (t.status === 'blocked' ? 0 : t.status === 'doing' ? 1 : 2)
  const stageSig = stages.map(s => {
    const flat = beamFlattenBranches(s.agentBranches)
    const agSig = flat.map(e => `${e.branch.name}:${e.branch.status}:${e.branch.returnTargetId || ''}`).join(',')
    return `${s.id}:${s.status}:${s.title.length}:${agSig}`
  }).join('|')

  React.useEffect(() => {
    if (externalSelectStage && externalSelectStage.id && stages.some(s => s.id === externalSelectStage.id)) {
      setSelectedStageId(externalSelectStage.id)
      setDrawerOpen(true)
    }
  }, [externalSelectStage && externalSelectStage.seq])

  React.useEffect(() => {
    if (selectedTask) {
      const hitStage = stages.find(st => st.allTasks.some(t => t && t.id === selectedTask.id))
      if (hitStage) {
        setSelectedStageId(hitStage.id)
        setDrawerOpen(true)
        return
      }
    }
    if (!stages.length) {
      if (selectedStageId) setSelectedStageId('')
      return
    }
    if (!selectedStageId || !stages.some(s => s.id === selectedStageId)) {
      setSelectedStageId(flowModel?.activeStageId || stages[0].id)
    }
  }, [stageSig, flowModel?.activeStageId, selectedTask?.id])

  const appendPlanStep = () => {
    const txt = newStepDraft.trim()
    if (!txt) return
    setNewStepDraft('')
    flowAppendPlanStep(board, txt, stepApi)
  }

  const submitStageSubtask = stage => {
    if (!flowSubmitStageSubtask(stage, stageTaskTitle, stageTaskAgent)) return
    setStageTaskTitle('')
    setStageTaskAgent('')
    setAddingToStageId('')
  }

  const addStepRow = flowRenderAddStepRow({
    stageCount: stages.length,
    draft: newStepDraft,
    setDraft: setNewStepDraft,
    onAppend: appendPlanStep,
  })

  if (!stages.length) {
    return h(
      'div',
      { className: 'dnb-beam-pipeline' },
      h(
        'div',
        { className: 'dnb-empty', style: { padding: '16px 12px 12px' } },
        h('div', { style: { marginBottom: 10 } }, bi('还没有步骤或任务，在下方加一步或让主对话拆解', 'No steps yet — add below or ask main chat')),
        onTriggerAiPlan
          ? h('button', {
              type: 'button',
              className: 'dnb-pill dnb-pill-accent',
              onClick: onTriggerAiPlan,
            }, h(Icon, { name: 'sparkles', size: 12.5 }), bi('让主对话帮你拆出步骤', 'Ask main chat to plan steps'))
          : null,
      ),
      addStepRow,
    )
  }

  const layout = computeFlowCanvasLayout(flowModel, isLR)
  const { stageBoxes, agentBoxes, spineEdges, dispatchEdges, returnEdges, svgW, svgH } = layout
  const zoomPct = Math.round(zoom * 100)

  const selectedStage = stages.find(s => s.id === selectedStageId) || stages.find(s => s.id === flowModel?.activeStageId) || stages[0]
  const selCanBindMenu = selectedStage && selectedStage.source === 'plan' && stepApi && typeof selectedStage.planIndex === 'number' && selectedStage.planIndex >= 0
  const selCanToggle = selectedStage && (selectedStage.source === 'plan' || Boolean(selectedStage.rootTask))
  const selIsAdding = selectedStage && addingToStageId === selectedStage.id
  const selConsultNode = selCanBindMenu && typeof stepApi.renderStepConsult === 'function'
    ? stepApi.renderStepConsult(selectedStage.planIndex, selectedStage)
    : null
  const selActiveLeadTasks = selectedStage
    ? selectedStage.leadTasks.filter(t => t.status !== 'done').sort((a, b) => rankLeadTask(a) - rankLeadTask(b))
    : []
  const selDoneLeadTasks = selectedStage
    ? selectedStage.leadTasks.filter(t => t.status === 'done')
    : []
  const selHasChildren = selectedStage && (selectedStage.agentBranches.length > 0 || selectedStage.leadTasks.length > 0)
  const selShouldFoldDone = selectedStage && selDoneLeadTasks.length > 0
    && statusFilter !== 'done'
    && (selActiveLeadTasks.length > 0 || selectedStage.agentBranches.length > 0 || selectedStage.status !== 'done')
  const selDoneFoldExpanded = Boolean(
    selectedStage && (
      openDoneStages[selectedStage.id]
      || (selectedTask && selDoneLeadTasks.some(t => t.id === selectedTask.id))
      || (store.focusTaskId && selDoneLeadTasks.some(t => t.id === store.focusTaskId))
    ),
  )

  const canvasMinH = Math.min(430, Math.max(210, Math.round(svgH * zoom) + 18))

  return h(
    'div',
    { className: 'dnb-beam-pipeline' },
    h(
      'div',
      { className: 'dnb-flow-canvas-shell' },
      h(
        'div',
        { className: 'dnb-flow-canvas-bar' },
        h(
          'div',
          { className: 'dnb-flow-zoom-group', role: 'group', 'aria-label': bi('拓扑方向', 'Flow Direction') },
          h('button', {
            type: 'button',
            className: 'dnb-flow-zoom-btn',
            'data-active': !isLR ? '1' : '0',
            onClick: () => setIsLR(false),
          }, bi('竖着排', 'Vertical')),
          h('button', {
            type: 'button',
            className: 'dnb-flow-zoom-btn',
            'data-active': isLR ? '1' : '0',
            onClick: () => setIsLR(true),
          }, bi('横着排', 'Horizontal')),
        ),
        h(
          'div',
          { className: 'dnb-flow-zoom-group', role: 'group', 'aria-label': bi('缩放控制', 'Zoom') },
          h('button', {
            type: 'button',
            className: 'dnb-flow-zoom-btn',
            title: bi('缩小画布', 'Zoom out'),
            onClick: () => setZoom(z => Math.max(0.55, +(z - 0.1).toFixed(2))),
          }, '−'),
          h('button', {
            type: 'button',
            className: 'dnb-flow-zoom-btn',
            title: bi('重置为 100%', 'Reset zoom to 100%'),
            onClick: () => setZoom(1),
          }, `${zoomPct}%`),
          h('button', {
            type: 'button',
            className: 'dnb-flow-zoom-btn',
            title: bi('放大画布', 'Zoom in'),
            onClick: () => setZoom(z => Math.min(1.5, +(z + 0.1).toFixed(2))),
          }, '+'),
        ),
      ),
      h(
        'div',
        {
          ref: canvasRef,
          className: 'dnb-canvas',
          style: { minHeight: canvasMinH, maxHeight: 500, padding: 10, textAlign: 'center', cursor: 'grab' },
          onWheel: e => {
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault()
              const delta = e.deltaY < 0 ? 0.1 : -0.1
              setZoom(z => Math.min(1.5, Math.max(0.55, +(z + delta).toFixed(2))))
            }
          },
          onMouseDown: e => {
            if (e.button !== 0 || (e.target && e.target.closest && e.target.closest('g[data-clickable="1"]'))) return
            const el = canvasRef.current
            if (!el) return
            panRef.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop }
            const onMove = ev => {
              if (!panRef.current) return
              el.scrollLeft = panRef.current.sl - (ev.clientX - panRef.current.x)
              el.scrollTop = panRef.current.st - (ev.clientY - panRef.current.y)
            }
            const onUp = () => {
              panRef.current = null
              if (typeof window !== 'undefined') {
                window.removeEventListener('mousemove', onMove)
                window.removeEventListener('mouseup', onUp)
              }
            }
            if (typeof window !== 'undefined') {
              window.addEventListener('mousemove', onMove)
              window.addEventListener('mouseup', onUp)
            }
          },
        },
        h(
          'svg',
          {
            className: 'dnb-flow-svg',
            width: Math.round(svgW * zoom),
            height: Math.round(svgH * zoom),
            viewBox: `0 0 ${svgW} ${svgH}`,
            style: { display: 'inline-block', userSelect: 'none' },
          },
          h(
            'defs',
            null,
            ['done', 'doing', 'blocked', 'todo'].map(stKey =>
              h(
                'marker',
                {
                  key: 'mk-' + stKey,
                  id: 'dnb-beam-arrow-' + stKey,
                  viewBox: '0 0 10 10',
                  refX: '7.5',
                  refY: '5',
                  markerWidth: '5.5',
                  markerHeight: '5.5',
                  orient: 'auto-start-reverse',
                },
                h('path', {
                  className: 'dnb-beam-arrow-path',
                  'data-status': stKey,
                  d: 'M 0.8 1.5 L 9 5 L 0.8 8.5 z',
                }),
              ),
            ),
          ),

          // Sequential Spine Arrows
          spineEdges.map(edge =>
            h(
              React.Fragment,
              { key: edge.key },
              h('path', {
                className: 'dnb-beam-edge',
                'data-status': edge.edgeStatus,
                markerEnd: `url(#dnb-beam-arrow-${edge.edgeStatus})`,
                d: edge.d,
              }),
              edge.active
                ? h('path', {
                    className: 'dnb-beam-pulse',
                    'data-status': edge.edgeStatus,
                    d: edge.d,
                  })
                : null,
            ),
          ),

          // Subagent Dispatch Curves (Step -> Subagent)
          dispatchEdges.map(edge =>
            h(
              React.Fragment,
              { key: edge.key },
              h('path', {
                className: 'dnb-beam-dispatch',
                'data-status': edge.status,
                d: edge.d,
              }),
              edge.active
                ? h('path', {
                    className: 'dnb-beam-sub-pulse',
                    'data-status': edge.status,
                    d: edge.d,
                  })
                : null,
            ),
          ),

          // Subagent Return Curves (Subagent -> Target Step)
          returnEdges.map(edge =>
            h(
              React.Fragment,
              { key: edge.key },
              h('path', {
                className: 'dnb-beam-return',
                'data-status': edge.status,
                'data-cross': edge.crossStep ? '1' : '0',
                markerEnd: `url(#dnb-beam-arrow-${edge.status})`,
                d: edge.d,
              }),
              edge.active
                ? h('path', {
                    className: 'dnb-beam-sub-pulse',
                    'data-status': edge.status,
                    d: edge.d,
                  })
                : null,
            ),
          ),

          // Stage Nodes
          stageBoxes.map(sb => {
            const st = sb.stage
            const isSelected = Boolean(drawerOpen && selectedStage && selectedStage.id === st.id)
            const isActiveStep = flowModel?.activeStageId === st.id
            const canToggle = st.source === 'plan' || Boolean(st.rootTask)
            const hovered = hoveredKey === 'stage:' + st.id
            const titleLines = splitSvgLines(st.title, 15.5, 2)
            const twoLine = titleLines.length > 1
            const flatCount = beamFlattenBranches(st.agentBranches).length
            const metaText = `${flowStatusLabel(st.status)}${flatCount ? bi(` · ${flatCount} 代理`, ` · ${flatCount} agents`) : ''}${st.allTasks.length ? bi(` · ${st.allTasks.length} 任务`, ` · ${st.allTasks.length} tasks`) : ''}`
            return h(
              'g',
              {
                key: 'node-' + st.id,
                className: 'dnb-beam-node',
                'data-flow-stage-id': st.id,
                'data-status': st.status,
                'data-selected': isSelected ? '1' : '0',
                'data-hovered': hovered ? '1' : '0',
                'data-active-step': isActiveStep ? '1' : '0',
                'data-clickable': '1',
                style: { cursor: 'pointer' },
                onMouseEnter: () => setHoveredKey('stage:' + st.id),
                onMouseLeave: () => setHoveredKey(''),
                onClick: e => {
                  e.stopPropagation()
                  if (selectedStage && selectedStage.id === st.id) {
                    setDrawerOpen(v => !v)
                  } else {
                    setSelectedStageId(st.id)
                    setDrawerOpen(true)
                  }
                },
                onContextMenu: e => {
                  if (st.source === 'plan' && stepApi && typeof stepApi.onOpenStepMenu === 'function') {
                    e.preventDefault()
                    e.stopPropagation()
                    flowOpenStageMenu(st, stepApi, e)
                  }
                },
              },
              h('title', null, cleanFlowTitle(st.title)),
              h('rect', {
                className: 'dnb-beam-node-rect',
                x: sb.x,
                y: sb.y,
                width: sb.w,
                height: sb.h,
                rx: 12,
              }),
              h('rect', {
                className: 'dnb-beam-node-bar',
                x: sb.x + 1,
                y: sb.y + 9,
                width: 4,
                height: sb.h - 18,
                rx: 2,
              }),
              h(
                'g',
                {
                  style: canToggle ? { cursor: 'pointer' } : undefined,
                  onClick: e => {
                    if (!canToggle) return
                    e.stopPropagation()
                    flowStageToggleAction(board, st, stepApi)
                  },
                },
                h('circle', {
                  className: 'dnb-beam-idx-circle',
                  cx: sb.x + 23,
                  cy: sb.y + (twoLine ? 25 : 27),
                  r: 10.5,
                }),
                h(
                  'text',
                  {
                    className: 'dnb-beam-idx-text',
                    x: sb.x + 23,
                    y: sb.y + (twoLine ? 29 : 31),
                    textAnchor: 'middle',
                    fontSize: 10.5,
                    fontWeight: 700,
                  },
                  st.status === 'done' ? '✓' : (st.status === 'blocked' ? '!' : String(st.index)),
                ),
              ),
              h(
                'text',
                {
                  className: 'dnb-beam-svg-title',
                  x: sb.x + 41,
                  y: sb.y + (twoLine ? 23 : 29),
                  textAnchor: 'start',
                  fontSize: 11.5,
                  fontWeight: 600,
                },
                titleLines[0],
              ),
              twoLine
                ? h(
                    'text',
                    {
                      className: 'dnb-beam-svg-title',
                      x: sb.x + 41,
                      y: sb.y + 39,
                      textAnchor: 'start',
                      fontSize: 11.5,
                      fontWeight: 600,
                    },
                    titleLines[1],
                  )
                : null,
              h(
                'text',
                {
                  className: 'dnb-beam-svg-meta',
                  x: sb.x + 41,
                  y: sb.y + (twoLine ? 60 : 54),
                  textAnchor: 'start',
                  fontSize: 10,
                  fontWeight: 500,
                },
                metaText,
              ),
            )
          }),

          // Subagent Branch Nodes
          agentBoxes.map(ab => {
            const stKey = ['done', 'doing', 'blocked'].includes(ab.status) ? ab.status : 'todo'
            const hovered = hoveredKey === `agent:${ab.stageId}:${ab.name}`
            const targetCircle = flowCircledNum(ab.returnTargetIndex)
            const aKey = `ab-${ab.stageId}-${ab.name}`
            const displayAgent = '@' + clampTitle(shortAgentName(ab.name, ab.depth > 0), 15)
            const retLabel = ab.isCrossStep
              ? `${flowAgentStatusLabel(stKey)} · ↩ ${bi('交给 ', '→ ')}${targetCircle}`
              : `${flowAgentStatusLabel(stKey)} · ↩ ${bi('回到 ', '↩ ')}${targetCircle}`
            return h(
              'g',
              {
                key: aKey,
                className: 'dnb-beam-agent-node',
                'data-status': stKey,
                'data-focused': ab.isFocused ? '1' : '0',
                'data-hovered': hovered ? '1' : '0',
                'data-clickable': '1',
                style: { cursor: 'pointer' },
                onMouseEnter: () => setHoveredKey(`agent:${ab.stageId}:${ab.name}`),
                onMouseLeave: () => setHoveredKey(''),
                onClick: e => {
                  e.stopPropagation()
                  setSelectedStageId(ab.stageId)
                  setDrawerOpen(true)
                  if (ab.primaryTask) {
                    patch({ selectedTaskId: store.selectedTaskId === ab.primaryTask.id ? '' : ab.primaryTask.id })
                  } else if (ab.agent && ab.agent.id) {
                    openSubagentChat(ab.agent)
                  }
                },
              },
              h('title', null, `@${ab.name} · ${retLabel}`),
              h('rect', {
                className: 'dnb-beam-agent-rect',
                x: ab.x,
                y: ab.y,
                width: ab.w,
                height: ab.h,
                rx: 10,
              }),
              h('circle', {
                className: 'dnb-beam-agent-dot-svg',
                cx: ab.x + 15,
                cy: ab.y + 21,
                r: 4.2,
              }),
              h(
                'text',
                {
                  className: 'dnb-beam-agent-svg-name',
                  x: ab.x + 25,
                  y: ab.y + 25,
                  textAnchor: 'start',
                  fontSize: 11.5,
                  fontWeight: 600,
                },
                displayAgent,
              ),
              h(
                'text',
                {
                  className: 'dnb-beam-agent-svg-meta',
                  x: ab.x + 14,
                  y: ab.y + 44,
                  textAnchor: 'start',
                  fontSize: 10,
                  fontWeight: stKey === 'done' ? 600 : 500,
                },
                retLabel,
              ),
            )
          }),
        ),
      ),
    ),

    // Inline Selected Node Focus & Action Drawer
    drawerOpen && selectedStage
      ? h(
          'div',
          {
            className: 'dnb-beam-drawer',
            'data-status': selectedStage.status,
          },
          h(
            'div',
            { className: 'dnb-beam-drawer-head' },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0, flex: 1 } },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dnb-beam-idx',
                  'data-status': selectedStage.status,
                  disabled: !selCanToggle,
                  title: selCanToggle ? (selectedStage.done ? bi('改回未完成', 'Reopen') : bi('标为已完成', 'Complete')) : cleanFlowTitle(selectedStage.title),
                  onClick: () => selCanToggle && flowStageToggleAction(board, selectedStage, stepApi),
                },
                selectedStage.status === 'done'
                  ? h(Icon, { name: 'check', size: 11 })
                  : (selectedStage.status === 'blocked' ? '!' : String(selectedStage.index)),
              ),
              h(
                'div',
                { style: { minWidth: 0, flex: 1 } },
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 2 } },
                  h('span', { className: 'dnb-flow-step-kicker' }, bi('步骤 ', 'Step ') + flowCircledNum(selectedStage.index)),
                  h('span', { className: 'dnb-flow-status-pill', 'data-status': selectedStage.status }, flowStatusLabel(selectedStage.status)),
                  selCanToggle
                    ? h('button', {
                        type: 'button',
                        className: 'dnb-flow-step-text-btn',
                        onClick: () => flowStageToggleAction(board, selectedStage, stepApi),
                      }, selectedStage.done ? bi('重开这步', 'Reopen') : bi('标为完成', 'Complete'))
                    : null,
                ),
                h('div', { className: 'dnb-beam-drawer-title' }, cleanFlowTitle(selectedStage.title)),
                selectedStage.summary
                  ? h('div', { className: 'dnb-flow-stage-summary' }, selectedStage.summary)
                  : null,
              ),
            ),
            h(
              'div',
              { className: 'dnb-flow-stage-ops' },
              flowRenderStepActionsRow({
                stage: selectedStage,
                canBindStepMenu: selCanBindMenu,
                stepApi,
                isAddingHere: selIsAdding,
                onToggleAdd: () => setAddingToStageId(selIsAdding ? '' : selectedStage.id),
                inlineExtra: h('button', {
                  type: 'button',
                  className: 'dnb-flow-mini-btn',
                  title: bi('收起详情抽屉', 'Close drawer'),
                  onClick: () => setDrawerOpen(false),
                }, h(Icon, { name: 'x', size: 11 })),
              }),
            ),
          ),
          selConsultNode,
          selIsAdding
            ? flowRenderInlineSubtaskAdder({
                stage: selectedStage,
                title: stageTaskTitle,
                setTitle: setStageTaskTitle,
                agent: stageTaskAgent,
                setAgent: setStageTaskAgent,
                onSubmit: () => submitStageSubtask(selectedStage),
              })
            : null,
          selHasChildren
            ? flowRenderStageChildrenBody({
                stage: selectedStage,
                board,
                flowModel,
                activeLeadTasks: selActiveLeadTasks,
                doneLeadTasks: selDoneLeadTasks,
                shouldFoldDoneTasks: selShouldFoldDone,
                doneFoldExpanded: selDoneFoldExpanded,
                onToggleDoneFold: () => setOpenDoneStages(prev => ({ ...prev, [selectedStage.id]: !selDoneFoldExpanded })),
                onJumpToStage: id => { setSelectedStageId(id); setDrawerOpen(true) },
                onExplainTask,
                onOpenEditor,
                onContextMenu,
                renderInspector,
              })
            : null,
        )
      : null,

    addStepRow,

    selectedTask && renderInspector && (!selectedStage || !selectedStage.allTasks.some(t => t.id === selectedTask.id) || !drawerOpen)
      ? h('div', { style: { marginTop: 8 } }, renderInspector(selectedTask))
      : null,
  )
}
