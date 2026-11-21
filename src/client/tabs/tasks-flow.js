/**
 * tabs/tasks-flow.js
 *
 * Sequential workflow pipeline topology (`① -> ② -> ③ -> ④ -> ⑤`) and SVG
 * flow canvas with status colors (green/blue/red/gray), sprouted subagent
 * branches, and completion return arrows back to target plan steps.
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
  done: { label: '已完成', agentLabel: '已交卷', hex: '#22c55e', lightHex: '#15803d', bg: 'rgba(34, 197, 94, 0.14)' },
  doing: { label: '推进中', agentLabel: '运行中', hex: '#3b82f6', lightHex: '#1d4ed8', bg: 'rgba(59, 130, 246, 0.14)' },
  blocked: { label: '受阻', agentLabel: '受阻/待批', hex: '#ef4444', lightHex: '#dc2626', bg: 'rgba(239, 68, 68, 0.15)' },
  todo: { label: '待开始', agentLabel: '待命', hex: '#8e8e93', lightHex: '#64748b', bg: 'rgba(142, 142, 147, 0.14)' },
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

function flowDetectLightTheme() {
  if (typeof document === 'undefined' || !document.documentElement) return false
  const root = document.documentElement
  const src = root.getAttribute('data-ds-theme-source') || root.getAttribute('data-ds-theme') || ''
  if (src === 'light') return true
  if (src === 'dark') return false
  return Boolean(document.querySelector && document.querySelector('[data-ds-theme-source="light"]'))
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
          task.title,
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

/**
 * Default narrow-sidebar-friendly vertical workflow pipeline (`① -> ② -> ③ -> ④ -> ⑤`).
 */
export function TaskFlowPipelineView({
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
  hideRail = false,
  statusFilter = 'all',
  expandAllStages = false,
  stepApi = null,
}) {
  const [newStepDraft, setNewStepDraft] = React.useState('')
  const [addingToStageId, setAddingToStageId] = React.useState('')
  const [stageTaskTitle, setStageTaskTitle] = React.useState('')
  const [stageTaskAgent, setStageTaskAgent] = React.useState('')
  const [stageToggleMap, setStageToggleMap] = React.useState({})
  const [openDoneStages, setOpenDoneStages] = React.useState({})
  const stageRefs = React.useRef({})
  const flowRootRef = React.useRef(null)

  const stages = (flowModel && Array.isArray(flowModel.stages)) ? flowModel.stages : []
  const stats = (flowModel && flowModel.stats) || {}

  React.useEffect(() => {
    setStageToggleMap({})
  }, [expandAllStages, statusFilter])

  React.useEffect(() => {
    if (!store.focusTaskId || !flowRootRef.current || typeof flowRootRef.current.querySelector !== 'function') return
    const targetEl = flowRootRef.current.querySelector('[data-flow-spotlight="1"]')
    if (targetEl && typeof targetEl.scrollIntoView === 'function') {
      try {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
      } catch {}
    }
  }, [store.focusTaskId])

  const jumpToStage = stageId => {
    const el = stageRefs.current && stageRefs.current[stageId]
    if (el && typeof el.scrollIntoView === 'function') {
      try {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      } catch {}
    }
  }

  const toggleStageExpand = (stage, curExpanded) => {
    if (!stage) return
    const colKey = 'flow-stage:' + stage.id
    if (collapsed && collapsed.has(colKey) && onToggleCollapse) {
      onToggleCollapse(colKey)
      setStageToggleMap(prev => ({ ...prev, [stage.id]: true }))
      return
    }
    setStageToggleMap(prev => ({ ...prev, [stage.id]: !curExpanded }))
  }

  const appendPlanStep = () => {
    const txt = newStepDraft.trim()
    if (!txt) return
    setNewStepDraft('')
    if (stepApi && typeof stepApi.onAppendStep === 'function') {
      stepApi.onAppendStep(txt)
      return
    }
    const curPlan = board && Array.isArray(board.plan) ? board.plan : []
    const steps = [
      ...curPlan.map(s => ({ id: s.id, text: s.text, done: Boolean(s.done), ...(s.summary ? { summary: s.summary } : {}) })),
      { text: txt, done: false },
    ]
    void act({ action: 'plan.set', steps })
  }

  const submitStageSubtask = stage => {
    const title = stageTaskTitle.trim()
    if (!title) return
    const agent = stageTaskAgent.trim().replace(/^@/, '')
    setStageTaskTitle('')
    setStageTaskAgent('')
    setAddingToStageId('')
    void act({
      action: 'task.add',
      title,
      ...(stage.source === 'plan' ? { planStepId: stage.id } : {}),
      ...(stage.rootTask ? { parentId: stage.rootTask.id } : {}),
      ...(agent ? { owner: agent, subagent: agent } : {}),
    })
  }

  const addStepRow = h(
    'div',
    { className: 'dnb-flow-add-step' },
    h('input', {
      className: 'dnb-input',
      style: { flex: 1, height: 30, borderRadius: 99, padding: '0 12px', fontSize: 12 },
      placeholder: `添加第 ${stages.length + 1} 步（回车保存）…`,
      value: newStepDraft,
      onChange: e => setNewStepDraft(e.target.value),
      onKeyDown: e => { if (e.key === 'Enter') appendPlanStep() },
    }),
    h('button', {
      type: 'button',
      className: 'dnb-pill',
      style: { height: 30, padding: '0 12px', fontSize: 11.5 },
      disabled: !newStepDraft.trim(),
      onClick: appendPlanStep,
    }, '加一步'),
  )

  if (!stages.length) {
    return h(
      'div',
      { ref: flowRootRef, className: 'dnb-flow-root' },
      h(
        'div',
        { className: 'dnb-empty', style: { padding: '14px 10px 10px' } },
        h('div', { style: { marginBottom: 10 } }, bi('还没有步骤或任务', 'No steps or tasks yet')),
        onTriggerAiPlan
          ? h('button', {
              type: 'button',
              className: 'dnb-pill dnb-pill-accent',
              onClick: onTriggerAiPlan,
            }, h(Icon, { name: 'sparkles', size: 13 }), bi('让主对话帮你拆出步骤', 'Ask main chat to plan steps'))
          : null,
      ),
      addStepRow,
    )
  }

  const rankLeadTask = t => (t.status === 'blocked' ? 0 : t.status === 'doing' ? 1 : 2)

  return h(
    'div',
    { ref: flowRootRef, className: 'dnb-flow-root' },

    // Top Milestone Progress Rail: ① — ② — ③ — ④ — ⑤ (skipped when embedded under compact drawer header)
    !hideRail
      ? h(
          'div',
          { className: 'dnb-flow-rail' },
          h(
            'div',
            { className: 'dnb-flow-miles' },
            stages.map((st, idx) =>
              h(
                React.Fragment,
                { key: 'mile-' + st.id },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dnb-flow-mile',
                    'data-status': st.status,
                    title: bi(`步骤 ${st.index}: ${st.title}（${flowStatusLabel(st.status)}）`, `Step ${st.index}: ${st.title} (${flowStatusLabel(st.status)})`),
                    onClick: () => jumpToStage(st.id),
                  },
                  st.status === 'done' ? h(Icon, { name: 'check', size: 10.5 }) : String(st.index),
                ),
                idx < stages.length - 1
                  ? h('span', { className: 'dnb-flow-rail-link', 'data-done': st.status === 'done' ? '1' : '0' })
                  : null,
              ),
            ),
          ),
          h(
            'div',
            { className: 'dnb-flow-rail-meta' },
            bi(`已完成 ${stats.doneStages || 0}/${stats.totalStages || stages.length} 步`, `${stats.doneStages || 0}/${stats.totalStages || stages.length} steps done`),
            stats.runningAgents > 0 ? bi(` · ${stats.runningAgents} 个在跑`, ` · ${stats.runningAgents} active`) : '',
          ),
        )
      : null,

    // Main Vertical Sequential Pipeline
    h(
      'div',
      { className: 'dnb-flow-pipeline' },
      stages.map((stage, idx) => {
        const meta = FLOW_STATUS_META[stage.status] || FLOW_STATUS_META.todo
        const colKey = 'flow-stage:' + stage.id
        const externalCollapsed = Boolean(collapsed && collapsed.has(colKey))
        const branchCount = stage.agentBranches.length
        const doneTaskCount = stage.allTasks.filter(t => t.status === 'done').length
        const blockedTaskCount = stage.allTasks.filter(t => t.status === 'blocked').length
        const liveTaskCount = Math.max(0, stage.allTasks.length - doneTaskCount - blockedTaskCount)
        const activeLeadTasks = stage.leadTasks
          .filter(t => t.status !== 'done')
          .sort((a, b) => rankLeadTask(a) - rankLeadTask(b))
        const doneLeadTasks = stage.leadTasks.filter(t => t.status === 'done')

        const canBindStepMenu = stage.source === 'plan' && stepApi && typeof stage.planIndex === 'number' && stage.planIndex >= 0
        const hasConsultOpen = Boolean(
          canBindStepMenu
          && (
            stepApi.consultIdx === stage.planIndex
            || stepApi.secAskingIdx === stage.planIndex
            || Boolean(stepApi.secAnswers && stepApi.secAnswers[stage.planIndex])
          ),
        )
        const hasSpotlightInStage = Boolean(
          store.focusTaskId
          && (
            stage.allTasks.some(t => t.id === store.focusTaskId)
            || stage.agentBranches.some(b => b.isFocused || (b.children && b.children.some(c => c.isFocused)))
          ),
        )
        const hasSelectedInStage = Boolean(selectedTask && stage.allTasks.some(t => t.id === selectedTask.id))
        const isAddingHere = addingToStageId === stage.id
        const hasManualToggle = Object.prototype.hasOwnProperty.call(stageToggleMap, stage.id)
        const autoExpanded = Boolean(
          expandAllStages
          || statusFilter !== 'all'
          || hasSpotlightInStage
          || hasSelectedInStage
          || stage.status === 'doing'
          || stage.status === 'blocked'
          || flowModel.activeStageId === stage.id,
        )
        const isStageExpanded = !externalCollapsed && (hasManualToggle ? Boolean(stageToggleMap[stage.id]) : autoExpanded)

        const canExpandBody = branchCount > 0 || stage.leadTasks.length > 0
        const hasBody = isStageExpanded && canExpandBody
        const canToggleStage = stage.source === 'plan' || Boolean(stage.rootTask)

        const shouldFoldDoneTasks = doneLeadTasks.length > 0
          && statusFilter !== 'done'
          && (activeLeadTasks.length > 0 || branchCount > 0 || stage.status !== 'done')
        const doneFoldExpanded = Boolean(
          openDoneStages[stage.id]
          || (selectedTask && doneLeadTasks.some(t => t.id === selectedTask.id))
          || (store.focusTaskId && doneLeadTasks.some(t => t.id === store.focusTaskId)),
        )

        const taskSummaryParts = []
        if (blockedTaskCount > 0) taskSummaryParts.push(`${blockedTaskCount} 卡住`)
        if (liveTaskCount > 0) taskSummaryParts.push(`${liveTaskCount} 进行中`)
        if (doneTaskCount > 0) taskSummaryParts.push(`${doneTaskCount} 完成`)
        const taskSummaryLabel = taskSummaryParts.length > 0
          ? taskSummaryParts.join(' · ')
          : (stage.allTasks.length > 0 ? `${stage.allTasks.length} 项任务` : '')

        const openMenuFromEvent = e => {
          if (!canBindStepMenu || typeof stepApi.onOpenStepMenu !== 'function') return
          const useRect = !e.clientX && !e.clientY && e.currentTarget && typeof e.currentTarget.getBoundingClientRect === 'function'
          const rect = useRect ? e.currentTarget.getBoundingClientRect() : null
          const cx = rect ? rect.left : e.clientX
          const cy = rect ? rect.bottom + 4 : e.clientY
          stepApi.onOpenStepMenu(stage.planIndex, cx, cy)
        }

        const consultNode = canBindStepMenu && typeof stepApi.renderStepConsult === 'function'
          ? stepApi.renderStepConsult(stage.planIndex, stage)
          : null

        return h(
          React.Fragment,
          { key: stage.id },
          h(
            'div',
            {
              ref: el => { if (stageRefs.current) stageRefs.current[stage.id] = el },
              className: 'dnb-flow-stage',
              'data-flow-stage-id': stage.id,
              'data-status': stage.status,
              'data-active-step': flowModel.activeStageId === stage.id ? '1' : '0',
              'data-compact': (!hasBody && !isAddingHere && !hasConsultOpen) ? '1' : '0',
            },
            // Stage Header Row (click anywhere neutral to expand/collapse children; right-click for step menu)
            h(
              'div',
              {
                className: 'dnb-flow-stage-head',
                style: canExpandBody ? { cursor: 'pointer' } : undefined,
                onClick: () => {
                  if (canExpandBody) toggleStageExpand(stage, isStageExpanded)
                },
                onContextMenu: e => {
                  if (canBindStepMenu && typeof stepApi.onOpenStepMenu === 'function') {
                    e.preventDefault()
                    e.stopPropagation()
                    openMenuFromEvent(e)
                  }
                },
              },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dnb-flow-step-num',
                  'data-status': stage.status,
                  disabled: !canToggleStage,
                  title: canToggleStage ? (stage.done ? '改回未完成' : '标为已完成，继续下一步') : stage.title,
                  onClick: e => {
                    e.stopPropagation()
                    if (!canToggleStage) return
                    if (canBindStepMenu && typeof stepApi.onToggleStep === 'function') {
                      stepApi.onToggleStep(stage.planIndex)
                    } else {
                      flowToggleStageDone(board, stage)
                    }
                  },
                },
                stage.status === 'done'
                  ? h(Icon, { name: 'check', size: 13 })
                  : stage.status === 'blocked'
                    ? '!'
                    : String(stage.index),
              ),
              h(
                'div',
                { className: 'dnb-flow-stage-main' },
                h(
                  'div',
                  { className: 'dnb-flow-stage-top' },
                  h('span', { className: 'dnb-flow-step-kicker' }, bi('步骤 ', 'Step ') + flowCircledNum(stage.index)),
                  h(
                    'span',
                    { className: 'dnb-flow-status-pill', 'data-status': stage.status },
                    stage.status === 'doing'
                      ? h('span', { className: 'dnb-spin-ring', style: { '--dnb-spin-size': '8px', color: 'currentColor' } })
                      : h('span', { className: 'dnb-flow-dot', style: { background: meta.hex } }),
                    flowStatusLabel(stage.status),
                  ),
                  branchCount > 0
                    ? h('span', { className: 'dnb-flow-count-chip', 'data-kind': 'agents' }, bi(`${branchCount} 子代理`, `${branchCount} agents`))
                    : null,
                  taskSummaryLabel
                    ? h('span', { className: 'dnb-flow-count-chip', 'data-kind': 'tasks' }, taskSummaryLabel)
                    : null,
                ),
                h('div', { className: 'dnb-flow-stage-title', title: stage.title }, stage.title),
                stage.summary
                  ? h('div', { className: 'dnb-flow-stage-summary' }, '✓ ' + stage.summary)
                  : null,
              ),
              h(
                'div',
                { className: 'dnb-flow-stage-ops', onClick: e => e.stopPropagation() },
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
                  onClick: () => setAddingToStageId(isAddingHere ? '' : stage.id),
                }, h(Icon, { name: 'plus', size: 12 })),
                canBindStepMenu && typeof stepApi.onOpenStepMenu === 'function'
                  ? h('button', {
                      type: 'button',
                      className: 'dnb-flow-mini-btn',
                      title: bi('更多操作：问参谋、标完成、删除', 'More: Ask Chief, Done, Delete'),
                      onClick: openMenuFromEvent,
                    }, '⋯')
                  : null,
                canExpandBody
                  ? h('button', {
                      type: 'button',
                      className: 'dnb-flow-mini-btn',
                      title: isStageExpanded ? bi('收起这一步的子任务', 'Collapse step subtasks') : bi('展开这一步的子任务', 'Expand step subtasks'),
                      onClick: () => toggleStageExpand(stage, isStageExpanded),
                    }, h(Icon, {
                      name: 'chevron',
                      size: 12,
                      style: { transform: isStageExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' },
                    }))
                  : null,
              ),
            ),

            // Inline Step Consultation & Chief Answer Drawer (stays accessible even when subtasks are folded)
            consultNode,

            // Inline Quick Subtask / Subagent Adder for this Step
            isAddingHere
              ? h(
                  'div',
                  { className: 'dnb-flow-inline-add' },
                  h('input', {
                    className: 'dnb-input',
                    style: { flex: 1, height: 28, fontSize: 11.5, padding: '0 10px' },
                    placeholder: bi(`给第 ${flowCircledNum(stage.index)} 步加个子任务…`, `Subtask for Step ${flowCircledNum(stage.index)}…`),
                    value: stageTaskTitle,
                    onChange: e => setStageTaskTitle(e.target.value),
                    onKeyDown: e => { if (e.key === 'Enter') submitStageSubtask(stage) },
                  }),
                  h('input', {
                    className: 'dnb-input',
                    style: { width: 92, height: 28, fontSize: 11.5, padding: '0 8px' },
                    placeholder: '@找谁做（选填）',
                    value: stageTaskAgent,
                    onChange: e => setStageTaskAgent(e.target.value),
                    onKeyDown: e => { if (e.key === 'Enter') submitStageSubtask(stage) },
                  }),
                  h('button', {
                    type: 'button',
                    className: 'dnb-primary-btn',
                    style: { height: 28, padding: '0 10px', fontSize: 11.5 },
                    disabled: !stageTaskTitle.trim(),
                    onClick: () => submitStageSubtask(stage),
                  }, '添加'),
                )
              : null,

            // Sprouted Subagent Branches + Lead Tasks (with done-tasks auto-fold inside active stages)
            hasBody
              ? h(
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
                            onJumpToStage: jumpToStage,
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
                              onClick: () => setOpenDoneStages(prev => ({ ...prev, [stage.id]: !doneFoldExpanded })),
                            },
                            h(
                              'span',
                              { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } },
                              h(Icon, { name: 'check', size: 11, style: { color: '#22c55e' } }),
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
              : null,
          ),

          // Sequential Progression Connector Arrow to next stage
          idx < stages.length - 1
            ? h(
                'div',
                {
                  className: 'dnb-flow-connector',
                  'data-done': stage.status === 'done' ? '1' : '0',
                  'data-doing': stage.status === 'doing' ? '1' : '0',
                },
                h(
                  'svg',
                  { width: 22, height: 18, viewBox: '0 0 22 18', fill: 'none', 'aria-hidden': 'true' },
                  h('path', {
                    d: 'M11 1 L11 12.5',
                    stroke: 'currentColor',
                    strokeWidth: stage.status === 'done' ? 2.4 : 1.7,
                    strokeLinecap: 'round',
                    strokeDasharray: stage.status === 'done' ? undefined : '3 3',
                  }),
                  h('path', {
                    d: 'M6.8 10.5 L11 16 L15.2 10.5 Z',
                    fill: 'currentColor',
                  }),
                ),
                stage.status === 'done'
                  ? h('span', { className: 'dnb-flow-conn-tag' }, '进入下一步')
                  : null,
              )
            : null,
        )
      }),
    ),

    // Quick-add next sequential step
    addStepRow,

    // Fallback inspector drawer if selected task is inside a collapsed/filtered branch
    selectedTask && renderInspector && !stages.some(st => {
      const colKey = 'flow-stage:' + st.id
      if (collapsed && collapsed.has(colKey)) return false
      const hasBranchTask = list => list.some(b => b.tasks.some(t => t.id === selectedTask.id) || hasBranchTask(b.children || []))
      return st.leadTasks.some(t => t.id === selectedTask.id) || hasBranchTask(st.agentBranches)
    })
      ? h('div', { style: { marginTop: 10 } }, renderInspector(selectedTask))
      : null,
  )
}

/**
 * Compute coordinates and Bezier curves for the SVG workflow canvas (`TD` or `LR`).
 */
export function computeFlowCanvasLayout(flowModel, isLR = false) {
  const stages = (flowModel && Array.isArray(flowModel.stages)) ? flowModel.stages : []
  const STAGE_W = 208
  const STAGE_H = 66
  const AGENT_W = 194
  const AGENT_H = 58
  const PAD = 18
  const COL_GAP = 62
  const ROW_GAP = 24
  const NEST_OFFSET_X = 24

  const flattenBranches = (list, depth = 0, out = []) => {
    for (const b of list) {
      out.push({ branch: b, depth })
      if (b.children && b.children.length) flattenBranches(b.children, depth + 1, out)
    }
    return out
  }

  const stageBoxes = []
  const stageBoxById = new Map()
  const agentBoxes = []
  const dispatchEdges = []
  const returnEdges = []

  if (!stages.length) {
    return { stages, stageBoxes, agentBoxes, dispatchEdges, returnEdges, svgW: 320, svgH: 150 }
  }

  if (!isLR) {
    // Top-Down Backbone: Stage 1 -> Stage 2 -> ... on the left, sprouted subagents to the right
    let curY = PAD
    for (const stage of stages) {
      const flat = flattenBranches(stage.agentBranches)
      const branchBlockH = flat.length > 0 ? flat.length * AGENT_H + (flat.length - 1) * 12 : 0
      const bandH = Math.max(STAGE_H, branchBlockH)
      const stageY = curY + Math.max(0, Math.round((bandH - STAGE_H) / 2))
      const sb = { stage, x: PAD, y: stageY, w: STAGE_W, h: STAGE_H }
      stageBoxes.push(sb)
      stageBoxById.set(stage.id, sb)

      flat.forEach((entry, bIdx) => {
        const ax = PAD + STAGE_W + COL_GAP + entry.depth * NEST_OFFSET_X
        const ay = curY + bIdx * (AGENT_H + 12)
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
      if (srcStage) {
        const sx = srcStage.x + srcStage.w
        const sy = srcStage.y + 20
        const ax = ab.x
        const ay = ab.y + 18
        const mx = Math.round((sx + ax) / 2)
        dispatchEdges.push({
          key: 'disp-' + ab.name,
          status: ab.status,
          d: `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ay}, ${ax} ${ay}`,
        })
      }
      if (dstStage) {
        const ax = ab.x
        const ay = ab.y + AGENT_H - 16
        const tx = dstStage.x + dstStage.w
        const ty = dstStage.y + dstStage.h - 18
        const ctrl = Math.max(22, Math.round((ax - tx) * 0.48))
        returnEdges.push({
          key: 'ret-' + ab.name,
          status: ab.status,
          crossStep: ab.isCrossStep,
          d: `M ${ax} ${ay} C ${ax - ctrl} ${ay + 9}, ${tx + ctrl} ${ty + 7}, ${tx} ${ty}`,
        })
      }
    }
  } else {
    // Left-Right Backbone: Stage 1 -> Stage 2 -> ... along top, sprouted subagents below
    let curX = PAD
    for (const stage of stages) {
      const flat = flattenBranches(stage.agentBranches)
      const maxDepth = flat.reduce((m, e) => Math.max(m, e.depth), 0)
      const bandW = Math.max(STAGE_W, AGENT_W + maxDepth * NEST_OFFSET_X)
      const sx = curX + Math.round((bandW - STAGE_W) / 2)
      const sb = { stage, x: sx, y: PAD, w: STAGE_W, h: STAGE_H }
      stageBoxes.push(sb)
      stageBoxById.set(stage.id, sb)

      flat.forEach((entry, bIdx) => {
        const ax = curX + entry.depth * NEST_OFFSET_X
        const ay = PAD + STAGE_H + 48 + bIdx * (AGENT_H + 12)
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
      curX += bandW + 38
    }

    for (const ab of agentBoxes) {
      const srcStage = stageBoxById.get(ab.stageId)
      const dstStage = stageBoxById.get(ab.returnTargetId) || srcStage
      if (srcStage) {
        const sx = srcStage.x + Math.round(srcStage.w * 0.34)
        const sy = srcStage.y + srcStage.h
        const ax = ab.x + Math.round(ab.w * 0.25)
        const ay = ab.y
        const my = Math.round((sy + ay) / 2)
        dispatchEdges.push({
          key: 'disp-' + ab.name,
          status: ab.status,
          d: `M ${sx} ${sy} C ${sx} ${my}, ${ax} ${my}, ${ax} ${ay}`,
        })
      }
      if (dstStage) {
        const ax = ab.x + Math.round(ab.w * 0.78)
        const ay = ab.y
        const tx = dstStage.x + Math.round(dstStage.w * 0.72)
        const ty = dstStage.y + dstStage.h
        const my = Math.round((ay + ty) / 2)
        returnEdges.push({
          key: 'ret-' + ab.name,
          status: ab.status,
          crossStep: ab.isCrossStep,
          d: `M ${ax} ${ay} C ${ax + 12} ${my}, ${tx + 12} ${my}, ${tx} ${ty}`,
        })
      }
    }
  }

  const maxX = Math.max(...stageBoxes.map(b => b.x + b.w), ...agentBoxes.map(b => b.x + b.w), 300)
  const maxY = Math.max(...stageBoxes.map(b => b.y + b.h), ...agentBoxes.map(b => b.y + b.h), 150)
  const svgW = maxX + PAD + 14
  const svgH = maxY + PAD + 14
  return { stages, stageBoxes, agentBoxes, dispatchEdges, returnEdges, svgW, svgH }
}

/**
 * Full zoomable/pannable SVG workflow pipeline canvas showing stages ①..N,
 * sprouted subagent branches, and colored return arrows back to target steps.
 */
export function TaskFlowCanvasView({
  flowModel,
  flowLayout,
  board,
  isLR = false,
  zoom,
  setZoom,
  canvasRef,
  panRef,
  selectedTask,
  renderInspector,
  onSelectStage,
}) {
  const [hoveredKey, setHoveredKey] = React.useState('')
  const isLight = flowDetectLightTheme()
  const layout = flowLayout || computeFlowCanvasLayout(flowModel, isLR)
  const { stages, stageBoxes, agentBoxes, dispatchEdges, returnEdges, svgW, svgH } = layout

  const palette = isLight
    ? {
        done: { fill: '#ecfdf5', stroke: '#16a34a', text: '#14532d', badge: '#dcfce7', badgeFg: '#15803d', edge: '#16a34a' },
        doing: { fill: '#eff6ff', stroke: '#2563eb', text: '#1e3a8a', badge: '#dbeafe', badgeFg: '#1d4ed8', edge: '#2563eb' },
        blocked: { fill: '#fef2f2', stroke: '#dc2626', text: '#7f1d1d', badge: '#fee2e2', badgeFg: '#b91c1c', edge: '#dc2626' },
        todo: { fill: '#ffffff', stroke: '#cbd5e1', text: '#334155', badge: '#f1f5f9', badgeFg: '#475569', edge: '#94a3b8' },
        muted: '#64748b',
      }
    : {
        done: { fill: '#10261b', stroke: '#22c55e', text: '#ecfdf5', badge: 'rgba(34,197,94,0.22)', badgeFg: '#86efac', edge: '#22c55e' },
        doing: { fill: '#122038', stroke: '#3b82f6', text: '#eff6ff', badge: 'rgba(59,130,246,0.24)', badgeFg: '#93c5fd', edge: '#3b82f6' },
        blocked: { fill: '#2c1418', stroke: '#ef4444', text: '#fef2f2', badge: 'rgba(239,68,68,0.24)', badgeFg: '#fca5a5', edge: '#ef4444' },
        todo: { fill: '#1d1f26', stroke: 'rgba(148,163,184,0.34)', text: '#e2e8f0', badge: 'rgba(148,163,184,0.16)', badgeFg: '#cbd5e1', edge: '#64748b' },
        muted: '#94a3b8',
      }

  if (!stages.length) {
    return h('div', { className: 'dnb-empty' }, bi('还没有流程图数据', 'No workflow data yet'))
  }

  return h(
    React.Fragment,
    null,
    h(
      'div',
      {
        ref: canvasRef,
        className: 'dnb-canvas',
        style: { padding: 8, textAlign: 'center', cursor: 'grab' },
        onWheel: e => {
          if ((e.ctrlKey || e.metaKey) && setZoom) {
            e.preventDefault()
            const delta = e.deltaY < 0 ? 0.1 : -0.1
            setZoom(z => Math.min(1.6, Math.max(0.42, +(z + delta).toFixed(2))))
          }
        },
        onMouseDown: e => {
          if (e.button !== 0 || (e.target && e.target.closest && e.target.closest('g[data-clickable="1"]'))) return
          const el = canvasRef && canvasRef.current
          if (!el || !panRef) return
          panRef.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop }
          const onMove = ev => {
            if (!panRef.current) return
            el.scrollLeft = panRef.current.sl - (ev.clientX - panRef.current.x)
            el.scrollTop = panRef.current.st - (ev.clientY - panRef.current.y)
          }
          const onUp = () => {
            panRef.current = null
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
          }
          window.addEventListener('mousemove', onMove)
          window.addEventListener('mouseup', onUp)
        },
      },
      h(
        'svg',
        {
          width: Math.round(svgW * (zoom || 1)),
          height: Math.round(svgH * (zoom || 1)),
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
                id: 'dnb-flow-arrow-' + stKey,
                viewBox: '0 0 10 10',
                refX: '8',
                refY: '5',
                markerWidth: '5.8',
                markerHeight: '5.8',
                orient: 'auto-start-reverse',
              },
              h('path', { d: 'M 0 1.5 L 9 5 L 0 8.5 z', fill: palette[stKey].edge }),
            ),
          ),
        ),

        // Sequential Backbone Spine Arrows (Stage i -> Stage i+1)
        stageBoxes.slice(0, -1).map((sb, i) => {
          const nxt = stageBoxes[i + 1]
          const stKey = sb.stage.status
          const edgeColor = palette[stKey].edge
          const d = !isLR
            ? `M ${sb.x + sb.w / 2} ${sb.y + sb.h} L ${nxt.x + nxt.w / 2} ${nxt.y - 3}`
            : `M ${sb.x + sb.w} ${sb.y + sb.h / 2} L ${nxt.x - 3} ${nxt.y + nxt.h / 2}`
          return h('path', {
            key: 'spine-' + sb.stage.id,
            d,
            fill: 'none',
            stroke: edgeColor,
            strokeWidth: stKey === 'done' ? 2.5 : 1.8,
            strokeDasharray: stKey === 'done' ? undefined : '5 4',
            markerEnd: `url(#dnb-flow-arrow-${stKey})`,
          })
        }),

        // Dispatch Curves (Stage -> Subagent)
        dispatchEdges.map(edge =>
          h('path', {
            key: edge.key,
            d: edge.d,
            fill: 'none',
            stroke: palette[edge.status].edge,
            strokeOpacity: 0.55,
            strokeWidth: 1.4,
            strokeDasharray: '4 3',
          }),
        ),

        // Completion Return Curves (Subagent -> Target Plan Stage)
        returnEdges.map(edge => {
          const isDone = edge.status === 'done'
          return h('path', {
            key: edge.key,
            d: edge.d,
            fill: 'none',
            stroke: palette[edge.status].edge,
            strokeWidth: isDone ? 2.3 : 1.6,
            strokeDasharray: isDone ? undefined : '4 3',
            markerEnd: `url(#dnb-flow-arrow-${edge.status})`,
          })
        }),

        // Stage Nodes
        stageBoxes.map(sb => {
          const st = sb.stage
          const p = palette[st.status] || palette.todo
          const hovered = hoveredKey === 'stage:' + st.id
          const canToggle = st.source === 'plan' || Boolean(st.rootTask)
          return h(
            'g',
            {
              key: 'node-' + st.id,
              'data-clickable': '1',
              style: { cursor: 'pointer' },
              onMouseEnter: () => setHoveredKey('stage:' + st.id),
              onMouseLeave: () => setHoveredKey(''),
              onClick: e => {
                e.stopPropagation()
                if (typeof onSelectStage === 'function') {
                  onSelectStage(st)
                  return
                }
                if (st.rootTask) patch({ selectedTaskId: store.selectedTaskId === st.rootTask.id ? '' : st.rootTask.id })
                else if (st.allTasks.length) patch({ selectedTaskId: store.selectedTaskId === st.allTasks[0].id ? '' : st.allTasks[0].id })
                else if (canToggle) flowToggleStageDone(board, st)
              },
            },
            h('rect', {
              x: sb.x,
              y: sb.y,
              width: sb.w,
              height: sb.h,
              rx: 11,
              fill: p.fill,
              stroke: p.stroke,
              strokeWidth: hovered ? 2.2 : 1.5,
            }),
            h('rect', {
              x: sb.x,
              y: sb.y + 7,
              width: 4,
              height: sb.h - 14,
              rx: 2,
              fill: p.stroke,
            }),
            h(
              'g',
              {
                onClick: e => {
                  if (!canToggle) return
                  e.stopPropagation()
                  flowToggleStageDone(board, st)
                },
              },
              h('circle', {
                cx: sb.x + 22,
                cy: sb.y + 23,
                r: 10.5,
                fill: st.status === 'done' ? p.stroke : p.badge,
                stroke: p.stroke,
                strokeWidth: 1.2,
              }),
              h('text', {
                x: sb.x + 22,
                y: sb.y + 27,
                textAnchor: 'middle',
                fontSize: 10.5,
                fontWeight: 700,
                fill: st.status === 'done' ? '#ffffff' : p.badgeFg,
              }, st.status === 'done' ? '✓' : String(st.index)),
            ),
            h('text', {
              x: sb.x + 39,
              y: sb.y + 26,
              fontSize: 11.5,
              fontWeight: 600,
              fill: p.text,
            }, clampTitle(st.title, 14)),
            h('text', {
              x: sb.x + 39,
              y: sb.y + 46,
              fontSize: 10,
              fill: palette.muted,
            }, `${flowStatusLabel(st.status)}${st.agentBranches.length ? bi(` · ${st.agentBranches.length} 代理`, ` · ${st.agentBranches.length} agents`) : ''}${st.allTasks.length ? bi(` · ${st.allTasks.length} 任务`, ` · ${st.allTasks.length} tasks`) : ''}`),
          )
        }),

        // Subagent Branch Nodes
        agentBoxes.map(ab => {
          const p = palette[ab.status] || palette.todo
          const hovered = hoveredKey === 'agent:' + ab.name
          const targetCircle = flowCircledNum(ab.returnTargetIndex)
          return h(
            'g',
            {
              key: 'ab-' + ab.name,
              'data-clickable': '1',
              style: { cursor: 'pointer' },
              onMouseEnter: () => setHoveredKey('agent:' + ab.name),
              onMouseLeave: () => setHoveredKey(''),
              onClick: e => {
                e.stopPropagation()
                if (ab.primaryTask) patch({ selectedTaskId: store.selectedTaskId === ab.primaryTask.id ? '' : ab.primaryTask.id })
                else if (ab.agent && ab.agent.id) openSubagentChat(ab.agent)
              },
            },
            h('rect', {
              x: ab.x,
              y: ab.y,
              width: ab.w,
              height: ab.h,
              rx: 10,
              fill: p.fill,
              stroke: p.stroke,
              strokeWidth: hovered || ab.isFocused ? 2.1 : 1.35,
            }),
            h('circle', { cx: ab.x + 15, cy: ab.y + 20, r: 4.2, fill: p.stroke }),
            h('text', {
              x: ab.x + 24,
              y: ab.y + 24,
              fontSize: 11,
              fontWeight: 600,
              fill: p.text,
            }, '@' + clampTitle(shortAgentName(ab.name, ab.depth > 0), 13)),
            h('text', {
              x: ab.x + 13,
              y: ab.y + 43,
              fontSize: 9.8,
              fontWeight: ab.status === 'done' ? 600 : 500,
              fill: ab.status === 'done' ? p.badgeFg : palette.muted,
            }, `${flowAgentStatusLabel(ab.status)} · ${bi('↩ 回到 ', '↩ -> ')}${targetCircle}`),
          )
        }),
      ),
    ),
    selectedTask && renderInspector ? renderInspector(selectedTask) : null,
  )
}
