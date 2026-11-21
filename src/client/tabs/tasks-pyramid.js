/**
 * src/client/tabs/tasks-pyramid.js — 可展开金字塔组织树与可选 SVG 全景画布渲染器
 *
 * 【核心职责】
 *   1. `renderGrandPyramidView(ctx)`：渲染按主代理/子代理分层且支持渐进展开的组织树视图。
 *   2. `computeTaskPyramidLayout(ctx)` 与 `createPyramidSvgRenderers(ctx)`：计算与绘制全景 SVG 节点/连线。
 *
 * 【边界与 Hook 安全】
 *   - 所有函数均为纯渲染辅助函数（不直接持有 `useState`/`useEffect`），所有状态由 `tabs/tasks.js` 的
 *     `TasksTab` 统一持有并通过 `ctx` 传入，保证 React Hook 调用顺序与重构前 100% 一致。
 */

import { React, h } from '../react-runtime.js'
import { STATUSES, STATUS_LABEL, STATUS_BADGE, STATUS_HEX, STATUS_BG, GENERIC_OWNERS } from '../constants.js'
import { store, patch, focusObjectiveInPyramid, focusSecInput, openSubagentChat } from '../store.js'
import { clampTitle, shortAgentName } from '../utils.js'
import { bi, statusLabel } from '../i18n.js'
import { act, openTaskEditor } from '../api.js'
import { Icon } from '../components/common.js'
import { explainTaskMeaning } from './tasks-widgets.js'

export function computeTaskPyramidLayout(ctx) {
  const {
    filterAgent,
    hier,
    tasks,
    childrenOf,
    focusedTask,
    focusInfo,
    focusedAgentSet,
    focusedTaskScopeSet,
    AGENT_W,
    AGENT_H,
    LEAD_W,
    LEAD_H,
    TASK_W,
    TASK_H,
    FOLD_W,
    FOLD_H,
    H_GAP,
    V_GAP,
    isLR,
    collapsed,
    tasksByAgent,
  } = ctx

  const pNodes = []
  const pNodeById = new Map()
  const taskNodeByTaskId = new Map()
  const agentNodeByName = new Map()
  const visitedTasks = new Set()
  const visitedAgents = new Set()

  const buildTaskSubtree = (task, tier) => {
    if (!task || visitedTasks.has(task.id)) return null
    visitedTasks.add(task.id)
    const nodeKey = 'task:' + task.id
    const allKids = childrenOf(task.id)
    const isCol = collapsed.has(nodeKey)
    const childNodes = isCol
      ? []
      : allKids.map(k => buildTaskSubtree(k, tier + 1)).filter(Boolean)

    const isHighlighted = focusedTaskScopeSet.has(task.id)
      || task.status === 'doing'
      || task.status === 'blocked'

    const node = {
      id: nodeKey,
      kind: 'task',
      task,
      tier,
      w: TASK_W,
      h: TASK_H,
      x: 0,
      y: 0,
      span: 0,
      kidCount: allKids.length,
      hiddenKids: isCol ? allKids.length : 0,
      childNodes,
      activeBranch: isHighlighted || childNodes.some(c => c.activeBranch),
      focusBranch: focusedTaskScopeSet.has(task.id) || childNodes.some(c => c.focusBranch),
    }
    pNodeById.set(nodeKey, node)
    taskNodeByTaskId.set(task.id, node)
    pNodes.push(node)
    return node
  }

  const buildAgentSubtree = (agentObj, tier) => {
    if (!agentObj || visitedAgents.has(agentObj.name)) return null
    visitedAgents.add(agentObj.name)
    const nodeKey = 'agent:' + agentObj.name
    const isCol = collapsed.has(nodeKey)

    const rawSubAgents = (hier.kidsMap.get(agentObj.name) || []).filter(a => !visitedAgents.has(a.name))
    const directTasks = tasksByAgent.get(agentObj.name) || []

    let childNodes = []
    if (!isCol) {
      const subAgentNodes = buildAgentTierChildren(agentObj.name, rawSubAgents, tier + 1)
      const taskNodes = directTasks.map(t => buildTaskSubtree(t, tier + 1)).filter(Boolean)
      childNodes = [...subAgentNodes, ...taskNodes]
    }

    const totalKids = rawSubAgents.length + directTasks.length
    const isAgentFocused = focusedAgentSet.has(agentObj.name)
    const isRunning = agentObj.status === 'running'

    const node = {
      id: nodeKey,
      kind: 'agent',
      agent: agentObj,
      tier,
      w: AGENT_W,
      h: AGENT_H,
      x: 0,
      y: 0,
      span: 0,
      kidCount: totalKids,
      hiddenKids: isCol ? totalKids : 0,
      childNodes,
      activeBranch: isRunning || isAgentFocused || childNodes.some(c => c.activeBranch),
      focusBranch: isAgentFocused || childNodes.some(c => c.focusBranch),
    }
    pNodeById.set(nodeKey, node)
    agentNodeByName.set(agentObj.name, node)
    pNodes.push(node)
    return node
  }

  function buildAgentTierChildren(parentKey, agentList, tier) {
    if (!agentList.length) return []
    const sorted = [...agentList].sort((a, b) => {
      const fa = focusedAgentSet.has(a.name) ? 1 : 0
      const fb = focusedAgentSet.has(b.name) ? 1 : 0
      if (fa !== fb) return fb - fa
      const ra = a.status === 'running' ? 1 : 0
      const rb = b.status === 'running' ? 1 : 0
      if (ra !== rb) return rb - ra
      const ta = (tasksByAgent.get(a.name) || []).length
      const tb = (tasksByAgent.get(b.name) || []).length
      return tb - ta
    })

    if (store.pyramidShowAllAgents || sorted.length <= 8) {
      return sorted.map(a => buildAgentSubtree(a, tier)).filter(Boolean)
    }

    const isImportant = a => (
      a.status === 'running'
      || focusedAgentSet.has(a.name)
      || (filterAgent && a.name === filterAgent)
      || (tasksByAgent.get(a.name) || []).length > 0
      || (hier.kidsMap.get(a.name) || []).length > 0
    )
    const important = sorted.filter(isImportant)
    const shownAgents = important.length > 0 ? important : sorted.slice(0, 4)
    const hiddenIdle = sorted.filter(a => !shownAgents.includes(a))
    const out = shownAgents.map(a => buildAgentSubtree(a, tier)).filter(Boolean)

    if (hiddenIdle.length > 0) {
      const foldId = 'fold:' + parentKey
      const foldNode = {
        id: foldId,
        kind: 'fold',
        parentKey,
        hiddenAgents: hiddenIdle,
        tier,
        w: FOLD_W,
        h: FOLD_H,
        x: 0,
        y: 0,
        span: 0,
        kidCount: 0,
        hiddenKids: 0,
        childNodes: [],
        activeBranch: false,
        focusBranch: false,
      }
      pNodeById.set(foldId, foldNode)
      pNodes.push(foldNode)
      out.push(foldNode)
    }
    return out
  }

  const tier1Agents = !filterAgent
    ? (hier.kidsMap.get('lead') || [])
    : hier.children.filter(a => a.name === filterAgent)
  const leadDirectTasks = tasksByAgent.get('lead') || []
  const leadCollapsed = collapsed.has('agent:lead')
  const leadAgentKids = leadCollapsed ? [] : buildAgentTierChildren('lead', tier1Agents, 1)
  const leadTaskKids = leadCollapsed ? [] : leadDirectTasks.map(t => buildTaskSubtree(t, 1)).filter(Boolean)

  if (!leadCollapsed) {
    for (const t of tasks) {
      if (!visitedTasks.has(t.id)) {
        const extra = buildTaskSubtree(t, 1)
        if (extra) leadTaskKids.push(extra)
      }
    }
  }

  const leadChildren = [...leadAgentKids, ...leadTaskKids]
  const leadTotalKids = tier1Agents.length + leadDirectTasks.length
  const isLeadFocused = Boolean(focusInfo && focusInfo.includeLead)

  const apexNode = {
    id: 'agent:lead',
    kind: 'lead',
    agent: hier.leadEntry || { name: 'lead', status: hier.children.some(a => a.status === 'running') ? 'running' : 'idle' },
    tier: 0,
    w: LEAD_W,
    h: LEAD_H,
    x: 0,
    y: 0,
    span: 0,
    kidCount: leadTotalKids,
    hiddenKids: leadCollapsed ? leadTotalKids : 0,
    childNodes: leadChildren,
    activeBranch: true,
    focusBranch: isLeadFocused || leadChildren.some(c => c.focusBranch),
  }
  pNodeById.set(apexNode.id, apexNode)
  agentNodeByName.set('lead', apexNode)
  pNodes.push(apexNode)

  const measureSpan = node => {
    const ownBreadth = isLR ? node.h : node.w
    const gap = isLR ? 16 : H_GAP
    if (!node.childNodes || !node.childNodes.length) {
      node.span = ownBreadth
      return node.span
    }
    let childrenSpan = 0
    node.childNodes.forEach((c, idx) => {
      if (idx > 0) childrenSpan += gap
      childrenSpan += measureSpan(c)
    })
    node.span = Math.max(ownBreadth, childrenSpan)
    return node.span
  }
  measureSpan(apexNode)

  const padBreadth = 24
  const padDepth = 22
  const placeSubtree = (node, startBreadth, depthPx) => {
    const ownBreadth = isLR ? node.h : node.w
    const ownDepth = isLR ? node.w : node.h
    const gap = isLR ? 16 : H_GAP
    const centerB = startBreadth + node.span / 2

    if (isLR) {
      node.x = depthPx
      node.y = Math.round(centerB - ownBreadth / 2)
    } else {
      node.x = Math.round(centerB - ownBreadth / 2)
      node.y = depthPx
    }

    if (node.childNodes && node.childNodes.length) {
      const totalKidsSpan = node.childNodes.reduce((acc, c) => acc + c.span, 0) + gap * (node.childNodes.length - 1)
      let curB = centerB - totalKidsSpan / 2
      const nextDepthPx = depthPx + ownDepth + V_GAP
      for (const c of node.childNodes) {
        placeSubtree(c, curB, nextDepthPx)
        curB += c.span + gap
      }
    }
  }
  placeSubtree(apexNode, padBreadth, padDepth)

  const depEdges = []
  for (const node of pNodes) {
    if (node.kind !== 'task' || !node.task) continue
    const deps = Array.isArray(node.task.blockedBy) ? node.task.blockedBy : []
    for (const depId of deps) {
      const fromNode = taskNodeByTaskId.get(depId)
      if (fromNode && fromNode !== node) {
        depEdges.push({
          from: fromNode,
          to: node,
          satisfied: fromNode.task.status === 'done',
        })
      }
    }
  }

  let spotlight = null
  if (focusedTask && focusInfo) {
    let framedNodes = pNodes.filter(n => n.kind === 'agent' && focusedAgentSet.has(n.agent.name))
    if (framedNodes.length === 0 && focusInfo.includeLead) {
      const ftNode = taskNodeByTaskId.get(focusedTask.id)
      framedNodes = [apexNode, ...(ftNode ? [ftNode] : [])]
    }
    if (framedNodes.length > 0) {
      const minX = Math.min(...framedNodes.map(n => n.x)) - 14
      const minY = Math.min(...framedNodes.map(n => n.y)) - 28
      const maxX = Math.max(...framedNodes.map(n => n.x + n.w)) + 14
      const maxY = Math.max(...framedNodes.map(n => n.y + n.h)) + 12
      const isBlockedFocus = focusedTask.status === 'blocked'
      const agentCount = framedNodes.filter(n => n.kind === 'agent').length
      const badgeLabel = (isBlockedFocus ? '⚠ 卡住了 · ' : '🎯 进行中 · ')
        + (agentCount > 0 ? `${agentCount} 个子代理` : '主对话自己在做')
        + ' ▸ ' + clampTitle(focusedTask.title || focusedTask.id, 12)
      spotlight = {
        x: minX,
        y: minY,
        w: Math.max(196, maxX - minX),
        h: maxY - minY,
        color: isBlockedFocus ? '#ff453a' : '#409cff',
        isBlocked: isBlockedFocus,
        badgeLabel,
        agentCount,
      }
    }
  }

  return { pNodes, apexNode, depEdges, spotlight }
}

export function renderGrandPyramidView(ctx) {
  const {
    board,
    allTasks,
    allById,
    filterAgent,
    statusFilter,
    hier,
    tasks,
    childrenOf,
    isRoot,
    focusedTask,
    focusInfo,
    focusedAgentSet,
    focusedTaskScopeSet,
    collapsed,
    setContextMenu,
    pyrOpenNodes,
    setPyrOpenNodes,
    pyrOpenDetails,
    pyrOpenDoneGroups,
    setPyrOpenDoneGroups,
    pyrRootRef,
    togglePyrNode,
    togglePyrDetail,
    tasksByAgent,
    spotlight,
    doneTotal,
    doingTotal,
    blockedTotal,
    triggerAiPlanGraph,
  } = ctx

const markTaskSubtreeVisited = (taskList, visitedTaskIds) => {
  for (const t of taskList || []) {
    if (!t || visitedTaskIds.has(t.id)) continue
    visitedTaskIds.add(t.id)
    markTaskSubtreeVisited(childrenOf(t.id), visitedTaskIds)
  }
}

const markAgentSubtreeVisited = (agentObj, visitedAgents, visitedTaskIds) => {
  if (!agentObj || visitedAgents.has(agentObj.name)) return
  visitedAgents.add(agentObj.name)
  markTaskSubtreeVisited(tasksByAgent.get(agentObj.name) || [], visitedTaskIds)
  const subAgents = hier.kidsMap.get(agentObj.name) || []
  for (const sa of subAgents) markAgentSubtreeVisited(sa, visitedAgents, visitedTaskIds)
}

const renderTreeTaskList = (list, visitedTaskIds, groupKey) => {
  const cleanList = (list || []).filter(t => t && !visitedTaskIds.has(t.id))
  if (!cleanList.length) return null
  const rankTreeTask = t => (t.status === 'blocked' ? 0 : t.status === 'doing' ? 1 : 2)
  const activeItems = cleanList.filter(t => t.status !== 'done').sort((a, b) => rankTreeTask(a) - rankTreeTask(b))
  const doneItems = cleanList.filter(t => t.status === 'done')
  const foldDone = doneItems.length > 0 && statusFilter !== 'done' && activeItems.length > 0
  const doneExpanded = Boolean(
    pyrOpenDoneGroups[groupKey]
    || doneItems.some(t => t.id === store.selectedTaskId || t.id === store.focusTaskId),
  )

  if (foldDone && !doneExpanded) {
    markTaskSubtreeVisited(doneItems, visitedTaskIds)
  }

  const wrapTaskItem = t => {
    const tTone = t.status === 'blocked' ? 'blocked' : t.status === 'doing' ? 'doing' : t.status === 'done' ? 'done' : undefined
    return h(
      'div',
      { key: 'tr-' + t.id, className: 'dnb-pyr-subitem', 'data-tone': tTone },
      renderGrandTaskCard(t, visitedTaskIds),
    )
  }

  return h(
    React.Fragment,
    null,
    activeItems.map(wrapTaskItem),
    doneItems.length > 0
      ? foldDone
        ? h(
            'div',
            { key: 'df-' + groupKey, className: 'dnb-flow-done-fold', style: { marginTop: 2 } },
            h(
              'button',
              {
                type: 'button',
                className: 'dnb-flow-done-fold-btn',
                'data-open': doneExpanded ? '1' : '0',
                onClick: () => setPyrOpenDoneGroups(prev => ({ ...prev, [groupKey]: !doneExpanded })),
              },
              h(
                'span',
                { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } },
                h(Icon, { name: 'check', size: 11, style: { color: '#22c55e' } }),
                bi(`已完成 ${doneItems.length} 项任务`, `${doneItems.length} done tasks`),
              ),
              h('span', { className: 'dnb-flow-done-fold-hint' }, doneExpanded ? bi('收起 ▴', 'Hide ▴') : bi('展开 ▾', 'Show ▾')),
            ),
            doneExpanded ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 5, marginTop: 5 } }, doneItems.map(wrapTaskItem)) : null,
          )
        : doneItems.map(wrapTaskItem)
      : null,
  )
}

const renderGrandTaskCard = (task, visitedTaskIds) => {
  if (!task || visitedTaskIds.has(task.id)) return null
  visitedTaskIds.add(task.id)
  const nodeKey = 'task:' + task.id
  const kids = childrenOf(task.id)
  const isSelected = store.selectedTaskId === task.id
  const isFocusedTarget = store.focusTaskId === task.id
  const inFocusScope = focusedTaskScopeSet.has(task.id)
  const isDoing = task.status === 'doing'
  const isBlocked = task.status === 'blocked'
  const isDone = task.status === 'done'
  const nextStatus = STATUSES[(STATUSES.indexOf(task.status) + 1) % STATUSES.length]

  const rawAgent = task.subagent || task.owner || ''
  const showAgentTag = rawAgent && !GENERIC_OWNERS.has(String(rawAgent).toLowerCase())
  const matchedAgent = hier.matchAgentRef(rawAgent)
  const deps = Array.isArray(task.blockedBy) ? task.blockedBy : []
  const unresolvedDeps = deps.map(id => allById.get(id) || { id, title: id }).filter(d => !d.status || d.status !== 'done')
  const doneDeps = deps.map(id => allById.get(id)).filter(d => d && d.status === 'done')

  const spotlightKind = (focusedTask && inFocusScope)
    ? (focusedTask.status === 'blocked' ? 'blocked' : 'doing')
    : ''
  const dimmed = focusedTask && !inFocusScope && !kids.some(k => focusedTaskScopeSet.has(k.id))

  const detailOpen = pyrOpenDetails.has(nodeKey) || isSelected || isFocusedTarget
  const kidsOpen = kids.length > 0 && (
    pyrOpenNodes.has(nodeKey)
    || kids.some(k => focusedTaskScopeSet.has(k.id) || k.id === store.selectedTaskId)
  )
  if (!kidsOpen && kids.length > 0) {
    markTaskSubtreeVisited(kids, visitedTaskIds)
  }

  const handleToggleDetail = () => {
    if (detailOpen) {
      if (isSelected) patch({ selectedTaskId: '', editTaskId: '' })
      if (pyrOpenDetails.has(nodeKey)) togglePyrDetail(nodeKey)
    } else {
      togglePyrDetail(nodeKey)
    }
  }

  return h(
    'div',
    {
      key: nodeKey,
      'data-pyr-spotlight': isFocusedTarget ? '1' : undefined,
      style: { minWidth: 0, opacity: dimmed ? 0.42 : 1, transition: 'opacity 0.2s ease' },
    },
    h(
      'div',
      {
        className: 'dnb-pyr-task-card dnb-pyr-tree-node',
        'data-status': task.status || 'todo',
        'data-spotlight': spotlightKind || undefined,
        'data-open': detailOpen ? '1' : '0',
        onContextMenu: e => {
          e.preventDefault()
          e.stopPropagation()
          setContextMenu({ taskId: task.id, task, x: e.clientX, y: e.clientY })
        },
      },
      // Compact 1-line Tree Node Header (click row to pull open detail & actions)
      h(
        'div',
        {
          className: 'dnb-pyr-node-head',
          onClick: handleToggleDetail,
          title: detailOpen ? '收起详情' : '展开详情和操作',
        },
        kids.length > 0
          ? h('button', {
              type: 'button',
              className: 'dnb-flow-mini-btn',
              style: { width: 18, height: 18, flexShrink: 0 },
              title: kidsOpen ? '收起子任务' : `展开 ${kids.length} 项子任务`,
              onClick: e => {
                e.stopPropagation()
                togglePyrNode(nodeKey)
              },
            }, h(Icon, {
              name: 'chevron',
              size: 11,
              style: { transform: kidsOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s ease' },
            }))
          : null,
        h(
          'button',
          {
            type: 'button',
            className: 'dnb-ring',
            style: isDone
              ? { width: 16, height: 16, background: '#22c55e', borderColor: '#22c55e', color: '#fff', flexShrink: 0 }
              : { width: 16, height: 16, borderColor: STATUS_HEX[task.status] || STATUS_HEX.todo, flexShrink: 0 },
            title: '标为 ' + (STATUS_LABEL[nextStatus] || nextStatus),
            onClick: e => {
              e.stopPropagation()
              void act({ action: 'task.update', id: task.id, status: nextStatus })
            },
          },
          isDone
            ? h(Icon, { name: 'check', size: 9.5 })
            : isDoing
              ? h('span', { className: 'dnb-spin-ring', style: { '--dnb-spin-size': '8.5px', color: '#3b82f6' } })
              : null,
        ),
        h(
          'span',
          {
            className: 'dnb-pyr-node-title',
            'data-done': isDone ? '1' : '0',
          },
          task.title || task.id,
        ),
        showAgentTag
          ? h('span', {
              className: 'dnb-tag',
              style: { fontSize: 9.5, color: 'var(--dnb-accent)', padding: '0 5px', flexShrink: 0 },
            }, '@' + clampTitle(shortAgentName(rawAgent), 10))
          : null,
        unresolvedDeps.length > 0
          ? h('span', {
              className: 'dnb-tag',
              style: { fontSize: 9.5, background: 'rgba(245, 158, 11, 0.16)', color: '#fbbf24', flexShrink: 0 },
              title: '还有前面没做完的任务在等',
            }, `⏳${unresolvedDeps.length}`)
          : null,
        kids.length > 0
          ? h('span', { className: 'dnb-acc-count', style: { fontSize: 9.5 } }, bi(`${kids.length}子项`, `${kids.length} sub`))
          : null,
        h('span', { className: 'dnb-pyr-detail-pill' }, detailOpen ? bi('收起 ▴', 'Hide ▴') : bi('详情 ▾', 'Details ▾')),
      ),

      // Expanded Pull-Open Detail Drawer (hidden by default!)
      detailOpen
        ? h(
            'div',
            { className: 'dnb-pyr-node-detail', onClick: e => e.stopPropagation() },
            (showAgentTag || unresolvedDeps.length > 0 || doneDeps.length > 0 || task.intent || task.evidence || task.note || (Array.isArray(task.assumptions) && task.assumptions.length > 0))
              ? h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                  (showAgentTag || unresolvedDeps.length > 0 || doneDeps.length > 0)
                    ? h(
                        'div',
                        { style: { display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' } },
                        showAgentTag
                          ? h('span', { className: 'dnb-tag', style: { color: 'var(--dnb-accent)', fontWeight: 600, fontSize: 10.5 } }, '@' + shortAgentName(rawAgent))
                          : null,
                        unresolvedDeps.map(d =>
                          h('span', {
                            key: d.id,
                            className: 'dnb-tag',
                            style: { background: 'rgba(245, 158, 11, 0.16)', color: '#fbbf24', fontSize: 10.5 },
                          }, '⏳ 先等做完：' + clampTitle(d.title || d.id, 14)),
                        ),
                        doneDeps.map(d =>
                          h('span', {
                            key: d.id,
                            className: 'dnb-tag',
                            style: { background: STATUS_BG.done, color: '#30d158', fontSize: 10.5 },
                          }, '✓ 已准备好：' + clampTitle(d.title || d.id, 12)),
                        ),
                      )
                    : null,
                  task.intent ? h('div', { style: { fontSize: 11.5, color: 'var(--dnb-text-2)', lineHeight: 1.42, wordBreak: 'break-word' } }, '目的 · ' + task.intent) : null,
                  task.evidence ? h('div', { style: { fontSize: 11.5, color: '#30d158', lineHeight: 1.42, wordBreak: 'break-word' } }, '结论 · ' + task.evidence) : null,
                  task.note ? h('div', { style: { fontSize: 11.5, color: isBlocked ? '#ff6961' : 'var(--dnb-text-2)', lineHeight: 1.42, wordBreak: 'break-word' } }, task.note) : null,
                  Array.isArray(task.assumptions) && task.assumptions.length > 0
                    ? h(
                        'div',
                        { style: { display: 'flex', flexDirection: 'column', gap: 3, marginTop: 2 } },
                        task.assumptions.map((assum, idx) =>
                          h(
                            'div',
                            { key: idx, style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 } },
                            h('button', {
                              className: 'dnb-ring',
                              style: {
                                width: 15,
                                height: 15,
                                ...(assum.verified ? { background: '#30d158', borderColor: '#30d158' } : { borderColor: '#f59e0b' }),
                              },
                              onClick: e => {
                                e.stopPropagation()
                                if (!assum.verified) void act({ action: 'task.verify', id: task.id, assumptionIndex: idx })
                              },
                            }, assum.verified ? h(Icon, { name: 'check', size: 9 }) : null),
                            h('span', { style: assum.verified ? { textDecoration: 'line-through', opacity: 0.58 } : null }, assum.text),
                          ),
                        ),
                      )
                    : null,
                )
              : null,

            h(
              'div',
              { className: 'dnb-pyr-st-row', style: { marginTop: 2 } },
              STATUSES.map(st =>
                h(
                  'button',
                  {
                    key: st,
                    type: 'button',
                    className: 'dnb-pyr-st-btn',
                    'data-st': st,
                    'data-active': task.status === st ? '1' : '0',
                    onClick: () => { if (task.status !== st) void act({ action: 'task.update', id: task.id, status: st }) },
                  },
                  h('span', { style: { width: 5.5, height: 5.5, borderRadius: '50%', background: STATUS_HEX[st] } }),
                  st === 'done' ? '已完成' : STATUS_LABEL[st],
                ),
              ),
            ),

            h(
              'div',
              { className: 'dnb-pyr-act-row' },
              h('button', {
                type: 'button',
                className: 'dnb-pyr-act-btn',
                'data-accent': '1',
                title: '用大白话解释这条任务',
                onClick: () => explainTaskMeaning(task, board),
              }, h(Icon, { name: 'sparkles', size: 11 }), '解释'),
              h('button', {
                type: 'button',
                className: 'dnb-pyr-act-btn',
                title: '让子代理开始或继续做这件事',
                onClick: () => void act({
                  action: 'task.dispatch',
                  id: task.id,
                  agent: rawAgent || ('worker-' + String(task.id).slice(-4)),
                }),
              }, h(Icon, { name: 'play', size: 10.5 }), isDoing ? '唤醒' : '派发'),
              isDoing && showAgentTag
                ? h('button', {
                    type: 'button',
                    className: 'dnb-pyr-act-btn',
                    'data-danger': '1',
                    onClick: () => void act({ action: 'team.interrupt', id: task.id, agent: rawAgent }),
                  }, h(Icon, { name: 'stop', size: 10.5 }), '停止')
                : null,
              matchedAgent && matchedAgent.id
                ? h('button', {
                    type: 'button',
                    className: 'dnb-pyr-act-btn',
                    onClick: () => { if (!openSubagentChat(matchedAgent)) patch({ notice: '这个子代理没有单独的聊天窗口' }) },
                  }, h(Icon, { name: 'chat', size: 11 }), '对话')
                : null,
              h('button', {
                type: 'button',
                className: 'dnb-pyr-act-btn',
                style: isFocusedTarget ? { borderColor: '#409cff', color: '#409cff', background: 'rgba(10,132,255,0.14)' } : undefined,
                onClick: () => focusObjectiveInPyramid(isFocusedTarget ? '' : task.id),
              }, h(Icon, { name: 'target', size: 11 }), isFocusedTarget ? '已高亮' : '高亮'),
              h('button', {
                type: 'button',
                className: 'dnb-pyr-act-btn',
                onClick: () => {
                  if (isSelected) patch({ selectedTaskId: '', editTaskId: '' })
                  else openTaskEditor(task)
                },
              }, h(Icon, { name: 'edit', size: 11 }), isSelected ? '收起编辑' : '编辑'),
              h('button', {
                type: 'button',
                className: 'dnb-pyr-act-btn',
                'data-danger': '1',
                onClick: () => {
                  if (store.selectedTaskId === task.id) patch({ selectedTaskId: '', editTaskId: '' })
                  if (store.focusTaskId === task.id) patch({ focusTaskId: '' })
                  void act({ action: 'task.remove', id: task.id })
                },
              }, h(Icon, { name: 'trash', size: 11 }), '删除'),
            ),

            isSelected ? h(TaskInspectorDrawer, { board, task }) : null,
          )
        : null,
    ),

    // Nested Child Sub-tasks connected with vertical spine (expanded on demand)
    kidsOpen
      ? h(
          'div',
          {
            className: 'dnb-pyr-subtree',
            'data-tone': isBlocked ? 'blocked' : isDoing ? 'doing' : undefined,
          },
          renderTreeTaskList(kids, visitedTaskIds, 'task-kids:' + task.id),
        )
      : null,
  )
}

const renderGrandAgentSubtree = (agentObj, tier, visitedAgents, visitedTaskIds) => {
  if (!agentObj || visitedAgents.has(agentObj.name)) return null
  visitedAgents.add(agentObj.name)

  const nodeKey = 'agent:' + agentObj.name
  const isRunning = agentObj.status === 'running'
  const isAgentFocused = focusedAgentSet.has(agentObj.name)
  const isFiltered = store.filterAgent === agentObj.name
  const subAgents = (hier.kidsMap.get(agentObj.name) || []).filter(a => !visitedAgents.has(a.name))
  const directTasks = tasksByAgent.get(agentObj.name) || []
  const totalKids = subAgents.length + directTasks.length
  const tierLabel = tier === 1 ? '一级代理' : `${tier}级代理`
  const desc = agentObj.taskTitle || agentObj.description || (isRunning ? '正在干活…' : (directTasks.length ? `手头 ${directTasks.length} 项任务` : '空闲 / 已完成'))

  const focusTone = isAgentFocused
    ? (focusedTask && focusedTask.status === 'blocked' ? 'blocked' : 'doing')
    : ''
  const spineTone = focusTone || (isRunning ? 'live' : undefined)

  const detailOpen = pyrOpenDetails.has(nodeKey) || isAgentFocused
  const childrenOpen = totalKids > 0 && (
    pyrOpenNodes.has(nodeKey)
    || isAgentFocused
    || subAgents.some(sa => focusedAgentSet.has(sa.name))
    || directTasks.some(t => focusedTaskScopeSet.has(t.id) || t.id === store.selectedTaskId)
  )
  if (!childrenOpen && totalKids > 0) {
    markTaskSubtreeVisited(directTasks, visitedTaskIds)
    for (const sa of subAgents) markAgentSubtreeVisited(sa, visitedAgents, visitedTaskIds)
  }

  return h(
    'div',
    { key: nodeKey, style: { minWidth: 0 } },
    h(
      'div',
      {
        className: 'dnb-pyr-agent-card dnb-pyr-tree-node',
        'data-running': isRunning ? '1' : '0',
        'data-focused': focusTone || undefined,
        'data-open': detailOpen ? '1' : '0',
      },
      // Compact 1-Line Agent Tree Header
      h(
        'div',
        {
          className: 'dnb-pyr-node-head',
          onClick: () => togglePyrDetail(nodeKey),
          title: detailOpen ? '收起操作' : '展开详情和操作',
        },
        totalKids > 0
          ? h('button', {
              type: 'button',
              className: 'dnb-flow-mini-btn',
              style: { width: 18, height: 18, flexShrink: 0 },
              title: childrenOpen ? '收起下面负责的任务' : `展开 ${totalKids} 个下级任务`,
              onClick: e => {
                e.stopPropagation()
                togglePyrNode(nodeKey)
              },
            }, h(Icon, {
              name: 'chevron',
              size: 11,
              style: { transform: childrenOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s ease' },
            }))
          : null,
        isRunning
          ? h('span', { className: 'dnb-spin-ring', style: { '--dnb-spin-size': '8.5px', color: '#409cff' } })
          : h('span', {
              style: {
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: focusTone === 'blocked' ? '#ff453a' : focusTone === 'doing' ? '#409cff' : 'var(--dnb-text-3)',
                flexShrink: 0,
              },
            }),
        h(Icon, { name: 'agentSub', size: 11.5, style: { color: '#34d399', flexShrink: 0 } }),
        h('span', { style: { fontWeight: 700, fontSize: 12, color: 'var(--dnb-text)', whiteSpace: 'nowrap' } },
          '@' + shortAgentName(agentObj.name, tier > 1)),
        agentObj.reasoningEffort
          ? h('span', { className: 'dnb-chat-effort-badge', style: { fontSize: 9.5 } }, `🧠${agentObj.reasoningEffort}`)
          : null,
        h('span', { className: 'dnb-acc-count', style: { fontSize: 9.5 } }, isRunning ? '运行中' : tierLabel),
        totalKids > 0
          ? h('span', { className: 'dnb-acc-count', style: { fontSize: 9.5 } }, bi(`${totalKids} 项`, `${totalKids}`))
          : null,
        !detailOpen && desc
          ? h('span', { className: 'dnb-acc-preview', style: { fontSize: 11 } }, desc)
          : null,
        h('span', { className: 'dnb-pyr-detail-pill' }, detailOpen ? bi('收起 ▴', 'Hide ▴') : bi('详情 ▾', 'Details ▾')),
      ),

      // Expanded Pull-Open Agent Details & Action Strip
      detailOpen
        ? h(
            'div',
            { className: 'dnb-pyr-node-detail', onClick: e => e.stopPropagation() },
            desc
              ? h('div', { style: { fontSize: 11.5, color: isRunning ? '#409cff' : 'var(--dnb-text-2)', lineHeight: 1.4, wordBreak: 'break-word' } }, desc)
              : null,
            h(
              'div',
              { className: 'dnb-pyr-act-row', style: { marginTop: 2 } },
              agentObj.id
                ? h('button', {
                    type: 'button',
                    className: 'dnb-pyr-act-btn',
                    'data-accent': '1',
                    title: bi('分屏打开这个子代理的聊天窗口', 'Open subagent chat in split view'),
                    onClick: () => {
                      if (!openSubagentChat(agentObj)) patch({ notice: bi('这个子代理没有单独的聊天窗口', 'No dedicated chat for this subagent') })
                    },
                  }, h(Icon, { name: 'chat', size: 11 }), bi('分屏对话', 'Split Chat'))
                : null,
              h('button', {
                type: 'button',
                className: 'dnb-pyr-act-btn',
                title: bi('选中它，在底栏输入框直接发消息', 'Target this subagent in bottom input'),
                onClick: () => {
                  patch({
                    secTarget: agentObj.name,
                    secMode: isRunning ? 'steer' : 'followup',
                    notice: bi('已选中 @', 'Selected @') + shortAgentName(agentObj.name, true) + bi('，在下面输入回车发送', ', type below and press Enter'),
                  })
                  focusSecInput()
                },
              }, h(Icon, { name: 'send', size: 10.5 }), bi('@递话', '@Relay')),
              h('button', {
                type: 'button',
                className: 'dnb-pyr-act-btn',
                style: isFiltered ? { borderColor: 'var(--dnb-accent)', color: 'var(--dnb-accent)' } : undefined,
                onClick: () => patch({ filterAgent: isFiltered ? '' : agentObj.name }),
              }, isFiltered ? bi('显示全员', 'Show All') : bi('只看TA', 'Focus Only')),
              isRunning
                ? h('button', {
                    type: 'button',
                    className: 'dnb-pyr-act-btn',
                    'data-danger': '1',
                    onClick: () => void act({ action: 'team.interrupt', agent: agentObj.name }),
                  }, h(Icon, { name: 'stop', size: 10.5 }), bi('停止', 'Stop'))
                : null,
            ),
          )
        : null,
    ),

    // Vertical Tree Spine connecting Tier-2+ subagents & this agent's assigned tasks (expanded on demand)
    childrenOpen
      ? h(
          'div',
          { className: 'dnb-pyr-subtree', 'data-tone': spineTone },
          subAgents.map(sa =>
            h(
              'div',
              {
                key: 'sa-' + sa.name,
                className: 'dnb-pyr-subitem',
                'data-tone': focusedAgentSet.has(sa.name) ? (focusedTask && focusedTask.status === 'blocked' ? 'blocked' : 'doing') : undefined,
              },
              renderGrandAgentSubtree(sa, tier + 1, visitedAgents, visitedTaskIds),
            ),
          ),
          renderTreeTaskList(directTasks, visitedTaskIds, 'agent:' + agentObj.name),
        )
      : null,
  )
}

const renderGrandPyramid = () => {
  const visitedAgents = new Set()
  const visitedTaskIds = new Set()

  const rawTier1Agents = !filterAgent
    ? (hier.kidsMap.get('lead') || [])
    : hier.children.filter(a => a.name === filterAgent)
  const sortedTier1Agents = [...rawTier1Agents].sort((a, b) => {
    const fa = focusedAgentSet.has(a.name) ? 1 : 0
    const fb = focusedAgentSet.has(b.name) ? 1 : 0
    if (fa !== fb) return fb - fa
    const ra = a.status === 'running' ? 1 : 0
    const rb = b.status === 'running' ? 1 : 0
    if (ra !== rb) return rb - ra
    const ta = (tasksByAgent.get(a.name) || []).length
    const tb = (tasksByAgent.get(b.name) || []).length
    return tb - ta
  })

  // Pre-mark tasks claimed by subagents so leftover tasks under Lead are crisp & deduplicated
  const claimedTaskIds = new Set()
  const markSubtreeClaimed = taskList => {
    for (const t of taskList) {
      if (!t || claimedTaskIds.has(t.id)) continue
      claimedTaskIds.add(t.id)
      markSubtreeClaimed(childrenOf(t.id))
    }
  }
  for (const a of hier.children) {
    markSubtreeClaimed(tasksByAgent.get(a.name) || [])
  }
  const leadDirectRoots = [
    ...(tasksByAgent.get('lead') || []),
    ...tasks.filter(t => !claimedTaskIds.has(t.id) && !(tasksByAgent.get('lead') || []).includes(t) && isRoot(t)),
  ]

  const runningKidsCount = hier.children.filter(a => a.status === 'running').length
  const isLeadSpotlight = Boolean(focusedTask && focusInfo && focusInfo.includeLead && focusedAgentSet.size === 0)
  const apexSpotlightTone = isLeadSpotlight ? (focusedTask.status === 'blocked' ? 'blocked' : 'doing') : ''
  const trunkTone = focusedTask
    ? (focusedTask.status === 'blocked' ? 'blocked' : 'doing')
    : (blockedTotal > 0 ? 'blocked' : doingTotal > 0 ? 'doing' : runningKidsCount > 0 ? 'live' : '')

  const treeItems = []

  for (const ag of sortedTier1Agents) {
    const descAgents = hier.descendantsOf(ag.name)
    const branchHasSpotlight = Boolean(
      focusedTask && (focusedAgentSet.has(ag.name) || descAgents.some(d => focusedAgentSet.has(d.name))),
    )
    const spotTone = branchHasSpotlight
      ? (focusedTask.status === 'blocked' ? 'blocked' : 'doing')
      : ''
    const colTone = spotTone || (ag.status === 'running' ? 'live' : '')
    const dimmedBranch = Boolean(focusedTask && !branchHasSpotlight)

    treeItems.push(
      h(
        'div',
        {
          key: 'col-agent-' + ag.name,
          className: 'dnb-pyr-subitem',
          'data-tone': colTone || undefined,
          'data-pyr-spotlight': branchHasSpotlight ? '1' : undefined,
          style: { opacity: dimmedBranch ? 0.38 : 1 },
        },
        branchHasSpotlight
          ? h(
              'div',
              { className: 'dnb-pyr-spot-tag', 'data-blocked': spotTone === 'blocked' ? '1' : '0' },
              spotTone === 'blocked' ? '⚠ 卡在这个代理 · @' + shortAgentName(ag.name, true) : '🎯 正在做 · @' + shortAgentName(ag.name, true),
            )
          : null,
        renderGrandAgentSubtree(ag, 1, visitedAgents, visitedTaskIds),
      ),
    )
  }

  if (leadDirectRoots.length > 0) {
    if (sortedTier1Agents.length === 0) {
      treeItems.push(renderTreeTaskList(leadDirectRoots, visitedTaskIds, 'lead-direct-root'))
    } else {
      const leadGroupInSpot = Boolean(focusedTask && leadDirectRoots.some(t => focusedTaskScopeSet.has(t.id)))
      const spotTone = leadGroupInSpot ? (focusedTask.status === 'blocked' ? 'blocked' : 'doing') : ''
      const groupKey = 'lead-direct-group'
      const groupDetailOpen = pyrOpenDetails.has(groupKey)
      const groupOpen = pyrOpenNodes.has(groupKey) || leadGroupInSpot || leadDirectRoots.some(t => t.id === store.selectedTaskId)
      if (!groupOpen) {
        markTaskSubtreeVisited(leadDirectRoots, visitedTaskIds)
      }
      treeItems.push(
        h(
          'div',
          {
            key: 'col-lead-direct',
            className: 'dnb-pyr-subitem',
            'data-tone': spotTone || undefined,
            'data-pyr-spotlight': leadGroupInSpot ? '1' : undefined,
            style: { opacity: (focusedTask && !leadGroupInSpot) ? 0.42 : 1 },
          },
          h(
            'div',
            { className: 'dnb-pyr-agent-card dnb-pyr-tree-node', 'data-focused': spotTone || undefined, 'data-open': groupDetailOpen ? '1' : '0' },
            h(
              'div',
              { className: 'dnb-pyr-node-head', onClick: () => togglePyrDetail(groupKey) },
              h('button', {
                type: 'button',
                className: 'dnb-flow-mini-btn',
                style: { width: 18, height: 18, flexShrink: 0 },
                title: groupOpen ? '收起主对话任务' : `展开 ${leadDirectRoots.length} 项主对话任务`,
                onClick: e => {
                  e.stopPropagation()
                  togglePyrNode(groupKey)
                },
              }, h(Icon, {
                name: 'chevron',
                size: 11,
                style: { transform: groupOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s ease' },
              })),
              h(Icon, { name: 'agentLead', size: 12, style: { color: '#60a5fa', flexShrink: 0 } }),
              h('span', { style: { fontWeight: 700, fontSize: 12, color: 'var(--dnb-text)' } }, bi('主对话自己做的任务', 'Main Chat Tasks')),
              h('span', { className: 'dnb-acc-count', style: { fontSize: 9.5 } }, bi(`${leadDirectRoots.length} 项`, `${leadDirectRoots.length}`)),
              h('span', { className: 'dnb-pyr-detail-pill' }, groupDetailOpen ? bi('收起 ▴', 'Hide ▴') : bi('操作 ▾', 'Actions ▾')),
            ),
            groupDetailOpen
              ? h(
                  'div',
                  { className: 'dnb-pyr-node-detail', onClick: e => e.stopPropagation() },
                  h(
                    'div',
                    { className: 'dnb-pyr-act-row' },
                    h('button', {
                      type: 'button',
                      className: 'dnb-pyr-act-btn',
                      onClick: () => {
                        patch({ secTarget: 'lead', secMode: 'steer', notice: bi('已选中 @主对话，在下面发消息', 'Selected @Lead') })
                        focusSecInput()
                      },
                    }, h(Icon, { name: 'send', size: 10.5 }), bi('@主对话', '@Lead')),
                  ),
                )
              : null,
          ),
          groupOpen
            ? h(
                'div',
                { className: 'dnb-pyr-subtree', 'data-tone': spotTone || undefined },
                renderTreeTaskList(leadDirectRoots, visitedTaskIds, groupKey),
              )
            : null,
        ),
      )
    }
  }

  // Catch any cycle/leftover tasks so nothing ever disappears
  const leftovers = tasks.filter(t => !visitedTaskIds.has(t.id))
  for (const lf of leftovers) {
    treeItems.push(
      h(
        'div',
        { key: 'col-lf-' + lf.id, className: 'dnb-pyr-subitem' },
        renderGrandTaskCard(lf, visitedTaskIds),
      ),
    )
  }

  const leadOpen = pyrOpenNodes.has('agent:lead') || Boolean(focusedTask)
  const toggleLeadOpen = () => {
    if (treeItems.length === 0) return
    if (leadOpen) {
      setPyrOpenNodes(prev => {
        const next = new Set(prev)
        next.delete('agent:lead')
        return next
      })
      if (store.focusTaskId) patch({ focusTaskId: '' })
    } else {
      setPyrOpenNodes(prev => {
        const next = new Set(prev)
        next.add('agent:lead')
        return next
      })
    }
  }

  return h(
    'div',
    { ref: pyrRootRef, className: 'dnb-pyr-root' },
    // Tier 0 Compact Apex Node (`👑 主代理 · 总指挥`, click anywhere on card to expand/collapse)
    h(
      'div',
      {
        className: 'dnb-pyr-apex',
        'data-spotlight': apexSpotlightTone || undefined,
        style: treeItems.length > 0 ? { cursor: 'pointer' } : undefined,
        title: treeItems.length > 0
          ? (leadOpen ? bi('收起下面的子代理和任务', 'Collapse tasks & subagents') : bi('展开下面的子代理和任务', 'Expand tasks & subagents'))
          : undefined,
        onClick: treeItems.length > 0 ? toggleLeadOpen : undefined,
      },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', minWidth: 0 } },
          treeItems.length > 0
            ? h('button', {
                type: 'button',
                className: 'dnb-flow-mini-btn',
                style: { width: 18, height: 18, flexShrink: 0 },
                title: leadOpen ? bi('收起组织树下一级', 'Collapse org tree') : bi('展开组织树下一级', 'Expand org tree'),
                onClick: e => {
                  e.stopPropagation()
                  toggleLeadOpen()
                },
              }, h(Icon, {
                name: 'chevron',
                size: 11,
                style: { transform: leadOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s ease' },
              }))
            : null,
          h('span', {
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              height: 20,
              padding: '0 8px',
              borderRadius: 99,
              background: 'rgba(10, 132, 255, 0.18)',
              color: '#409cff',
              fontSize: 11,
              fontWeight: 700,
            },
          }, bi('👑 主代理', '👑 Lead')),
          runningKidsCount > 0
            ? h('span', { className: 'dnb-acc-count', style: { color: '#409cff' } }, bi(`${runningKidsCount} 运行`, `${runningKidsCount} active`))
            : null,
          doingTotal > 0
            ? h('span', { className: 'dnb-acc-count', style: { color: '#409cff' } }, bi(`${doingTotal} 进行中`, `${doingTotal} doing`))
            : null,
          blockedTotal > 0
            ? h('span', { className: 'dnb-acc-count', style: { color: '#ff453a' } }, bi(`${blockedTotal} 卡住`, `${blockedTotal} blocked`))
            : null,
          doneTotal > 0
            ? h('span', { className: 'dnb-acc-count', style: { color: '#30d158' } }, bi(`${doneTotal}/${allTasks.length} 完成`, `${doneTotal}/${allTasks.length} done`))
            : null,
        ),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 } },
          h('button', {
            type: 'button',
            className: 'dnb-mini-btn',
            'data-tone': 'accent',
            style: { height: 22, padding: '0 7px', fontSize: 10.5 },
            title: bi('让主对话把目标拆成步骤，分给子代理做', 'Break goal into steps and assign subagents'),
            onClick: e => {
              e.stopPropagation()
              triggerAiPlanGraph()
            },
          }, h(Icon, { name: 'sparkles', size: 10.5 }), bi('拆解', 'Plan')),
          treeItems.length > 0
            ? h('span', { className: 'dnb-acc-pull-hint' }, leadOpen ? bi('收起 ▴', 'Hide ▴') : bi('展开 ▾', 'Show ▾'))
            : null,
        ),
      ),
      (board && board.objective)
        ? h('div', {
            style: {
              marginTop: 5,
              fontSize: 11.5,
              color: 'var(--dnb-text-2)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            },
            title: board.objective,
          }, '🎯 ' + board.objective)
        : null,
    ),

    // Expandable Vertical Tree under Apex (collapsed by default, click Apex card to pull open)
    (leadOpen && treeItems.length > 0)
      ? h(
          'div',
          { className: 'dnb-pyr-tree-list', 'data-tone': trunkTone || undefined },
          treeItems,
        )
      : null,
  )
}

  return renderGrandPyramid()
}

export function createPyramidSvgRenderers(ctx) {
  const {
    board,
    allById,
    filterAgent,
    hier,
    focusedTask,
    focusInfo,
    focusedAgentSet,
    focusedTaskScopeSet,
    NODE_R,
    isLR,
    collapsed,
    hoveredId,
    setHoveredId,
    setContextMenu,
    toggleCollapse,
    spotlight,
    doneTotal,
    doingTotal,
    blockedTotal,
  } = ctx

const isNodeInSpotlight = node => {
  if (!focusedTask) return true
  if (node.kind === 'lead') return Boolean(focusInfo && (focusInfo.includeLead || focusInfo.agentNames.length > 0))
  if (node.kind === 'agent') return focusedAgentSet.has(node.agent.name)
  if (node.kind === 'task') return focusedTaskScopeSet.has(node.task.id)
  return false
}

const renderPyramidConnectors = parent => {
  const kids = parent.childNodes || []
  if (!kids.length) return null
  const els = []

  if (!isLR) {
    const px = Math.round(parent.x + parent.w / 2)
    const py = parent.y + parent.h
    const minCy = Math.min(...kids.map(k => k.y))
    const midY = Math.round(py + (minCy - py) * 0.5)
    const firstCx = Math.round(kids[0].x + kids[0].w / 2)
    const lastCx = Math.round(kids[kids.length - 1].x + kids[kids.length - 1].w / 2)
    const baseDim = focusedTask && !parent.focusBranch

    els.push(h('path', {
      key: `stem-${parent.id}`,
      d: `M ${px} ${py} V ${midY}`,
      fill: 'none',
      stroke: 'var(--dnb-border-strong, rgba(155,155,168,0.52))',
      strokeWidth: 1.65,
      opacity: baseDim ? 0.25 : 0.9,
    }))

    const barMinX = Math.min(px, firstCx)
    const barMaxX = Math.max(px, lastCx)
    if (barMaxX - barMinX > 1) {
      els.push(h('path', {
        key: `bar-${parent.id}`,
        d: `M ${barMinX} ${midY} H ${barMaxX}`,
        fill: 'none',
        stroke: 'var(--dnb-border-strong, rgba(155,155,168,0.52))',
        strokeWidth: 1.65,
        opacity: baseDim ? 0.25 : 0.9,
      }))
    }

    for (const kid of kids) {
      const cx = Math.round(kid.x + kid.w / 2)
      const cy = kid.y
      const isFocusEdge = Boolean(focusedTask && kid.focusBranch)
      const isLiveEdge = !focusedTask && (
        (kid.kind === 'agent' && kid.agent.status === 'running')
        || (kid.kind === 'task' && (kid.task.status === 'doing' || kid.task.status === 'blocked'))
      )

      els.push(h('path', {
        key: `drop-${parent.id}-${kid.id}`,
        d: `M ${cx} ${midY} V ${cy}`,
        fill: 'none',
        stroke: 'var(--dnb-border-strong, rgba(155,155,168,0.52))',
        strokeWidth: 1.65,
        opacity: (focusedTask && !isFocusEdge) ? 0.22 : 0.9,
      }))

      if (isFocusEdge || isLiveEdge) {
        const hiColor = isFocusEdge
          ? (focusedTask.status === 'blocked' ? '#ff453a' : '#0a84ff')
          : (kid.kind === 'task' && kid.task.status === 'blocked' ? '#ff453a' : '#0a84ff')
        els.push(h('path', {
          key: `hi-${parent.id}-${kid.id}`,
          d: `M ${px} ${py} V ${midY} H ${cx} V ${cy}`,
          fill: 'none',
          stroke: hiColor,
          strokeWidth: 2.3,
          strokeLinejoin: 'round',
          opacity: 0.95,
        }))
      }

      els.push(h('circle', {
        key: `dot-${kid.id}`,
        cx,
        cy,
        r: isFocusEdge ? 3.2 : 2.3,
        fill: isFocusEdge
          ? (focusedTask.status === 'blocked' ? '#ff453a' : '#0a84ff')
          : 'var(--dnb-border-strong, rgba(165,165,178,0.75))',
        opacity: (focusedTask && !isFocusEdge) ? 0.25 : 1,
      }))
    }
  } else {
    const px = parent.x + parent.w
    const py = Math.round(parent.y + parent.h / 2)
    const minCx = Math.min(...kids.map(k => k.x))
    const midX = Math.round(px + (minCx - px) * 0.5)
    const firstCy = Math.round(kids[0].y + kids[0].h / 2)
    const lastCy = Math.round(kids[kids.length - 1].y + kids[kids.length - 1].h / 2)
    const barMinY = Math.min(py, firstCy)
    const barMaxY = Math.max(py, lastCy)

    els.push(h('path', {
      key: `stem-lr-${parent.id}`,
      d: `M ${px} ${py} H ${midX}`,
      fill: 'none',
      stroke: 'var(--dnb-border-strong, rgba(155,155,168,0.52))',
      strokeWidth: 1.6,
    }))
    if (barMaxY - barMinY > 1) {
      els.push(h('path', {
        key: `bar-lr-${parent.id}`,
        d: `M ${midX} ${barMinY} V ${barMaxY}`,
        fill: 'none',
        stroke: 'var(--dnb-border-strong, rgba(155,155,168,0.52))',
        strokeWidth: 1.6,
      }))
    }
    for (const kid of kids) {
      const cx = kid.x
      const cy = Math.round(kid.y + kid.h / 2)
      const isFocusEdge = Boolean(focusedTask && kid.focusBranch)
      els.push(h('path', {
        key: `drop-lr-${parent.id}-${kid.id}`,
        d: `M ${midX} ${cy} H ${cx}`,
        fill: 'none',
        stroke: isFocusEdge ? '#0a84ff' : 'var(--dnb-border-strong, rgba(155,155,168,0.52))',
        strokeWidth: isFocusEdge ? 2.2 : 1.6,
      }))
    }
  }
  return els
}

const renderDepEdge = edge => {
  const { from, to, satisfied } = edge
  const dimmed = focusedTask && !(focusedTaskScopeSet.has(from.task.id) || focusedTaskScopeSet.has(to.task.id))
  const sameRow = Math.abs(from.y - to.y) < 14
  const x1 = sameRow ? (from.x < to.x ? from.x + from.w : from.x) : from.x + from.w / 2
  const y1 = sameRow ? from.y + from.h / 2 : from.y + from.h
  const x2 = sameRow ? (from.x < to.x ? to.x : to.x + to.w) : to.x + to.w / 2
  const y2 = sameRow ? to.y + to.h / 2 : to.y
  const d = sameRow
    ? `M ${x1} ${y1} Q ${(x1 + x2) / 2} ${Math.min(y1, y2) - 22}, ${x2} ${y2}`
    : `M ${x1} ${y1} C ${x1 + 18} ${(y1 + y2) / 2}, ${x2 - 18} ${(y1 + y2) / 2}, ${x2} ${y2}`
  return h('path', {
    key: 'dep-' + from.id + '-' + to.id,
    d,
    fill: 'none',
    stroke: satisfied ? '#30d158' : '#f59e0b',
    strokeWidth: 1.5,
    strokeDasharray: satisfied ? '3 2.5' : '5 3.5',
    markerEnd: satisfied ? 'url(#dnb-arrow-done)' : 'url(#dnb-arrow-wait)',
    opacity: dimmed ? 0.18 : 0.88,
  })
}

const renderPyramidNode = node => {
  const { x, y, w, h: nh, kidCount, hiddenKids } = node
  const isCol = collapsed.has(node.id)
  const dimmed = focusedTask && !isNodeInSpotlight(node)

  if (node.kind === 'lead') {
    const objTitle = (board && board.objective)
      ? clampTitle(board.objective, 13.5)
      : `推进 ${doingTotal} · 受阻 ${blockedTotal} · 完成 ${doneTotal}`
    const runningKids = hier.children.filter(a => a.status === 'running').length

    return h(
      'g',
      {
        key: node.id,
        opacity: dimmed ? 0.35 : 1,
        style: { cursor: 'pointer', transition: 'opacity 0.2s ease' },
        onClick: e => {
          e.stopPropagation()
          if (store.filterAgent || store.focusTaskId) patch({ filterAgent: '', focusTaskId: '' })
        },
      },
      h('rect', {
        x, y, width: w, height: nh, rx: NODE_R + 2,
        fill: 'var(--dnb-elevated, #2a2a30)',
        stroke: 'rgba(10, 132, 255, 0.58)',
        strokeWidth: 1.8,
      }),
      h('rect', {
        x: x + 10, y: y + 9, width: 64, height: 17, rx: 8.5,
        fill: 'rgba(10, 132, 255, 0.18)',
      }),
      h('text', {
        x: x + 42, y: y + 21,
        textAnchor: 'middle',
        fill: '#409cff',
        fontSize: 10.5,
        fontWeight: 700,
      }, '👑 主代理'),
      runningKids > 0
        ? h('text', {
            x: x + w - 12, y: y + 21,
            textAnchor: 'end',
            fill: '#409cff',
            fontSize: 10,
            fontWeight: 600,
          }, `${runningKids} 运行中`)
        : null,
      h('text', {
        x: x + 12, y: y + 43,
        fill: 'var(--dnb-text, #f2f2f7)',
        fontSize: 11.5,
        fontWeight: 500,
      }, objTitle),
      kidCount > 0
        ? h(
            'g',
            { onClick: e => { e.stopPropagation(); toggleCollapse(node.id) } },
            h('rect', {
              x: x + w - 32, y: y + 32, width: 24, height: 16, rx: 8,
              fill: 'var(--dnb-fill, rgba(120,120,128,0.24))',
            }),
            h('text', {
              x: x + w - 20, y: y + 43,
              textAnchor: 'middle',
              fill: 'var(--dnb-text-2, #ebebf5)',
              fontSize: 10,
              fontWeight: 600,
            }, (isCol ? '+' : '−') + (hiddenKids || kidCount)),
          )
        : null,
    )
  }

  if (node.kind === 'fold') {
    return h(
      'g',
      {
        key: node.id,
        opacity: dimmed ? 0.22 : 0.9,
        style: { cursor: 'pointer' },
        onClick: e => { e.stopPropagation(); patch({ pyramidShowAllAgents: true }) },
      },
      h('rect', {
        x, y, width: w, height: nh, rx: NODE_R,
        fill: 'var(--dsw-alias-bg-layer-2, #202024)',
        stroke: 'var(--dnb-border-strong, rgba(140,140,150,0.45))',
        strokeWidth: 1.2,
        strokeDasharray: '4 3',
      }),
      h('text', {
        x: x + w / 2, y: y + 20,
        textAnchor: 'middle',
        fill: 'var(--dnb-text-2, #aeaeb2)',
        fontSize: 11.5,
        fontWeight: 600,
      }, `+${node.hiddenAgents.length} 个空闲助手`),
      h('text', {
        x: x + w / 2, y: y + 35,
        textAnchor: 'middle',
        fill: 'var(--dnb-accent, #0a84ff)',
        fontSize: 10,
      }, '点这里展开'),
    )
  }

  if (node.kind === 'agent') {
    const ag = node.agent
    const isRunning = ag.status === 'running'
    const isAgentFocused = focusedAgentSet.has(ag.name)
    const isFiltered = store.filterAgent === ag.name
    const tierLabel = node.tier === 1 ? '一级代理' : `${node.tier}级代理`
    const accent = isAgentFocused
      ? (focusedTask && focusedTask.status === 'blocked' ? '#ff453a' : '#0a84ff')
      : isRunning
        ? '#0a84ff'
        : 'var(--dnb-border-strong, rgba(140,140,150,0.4))'
    const desc = ag.taskTitle || ag.description || (isRunning ? '正在干活…' : '空闲 / 已完成')

    return h(
      'g',
      {
        key: node.id,
        opacity: dimmed ? 0.24 : 1,
        style: { cursor: 'pointer', transition: 'opacity 0.2s ease' },
        onMouseEnter: () => setHoveredId(node.id),
        onMouseLeave: () => setHoveredId(''),
        onClick: e => {
          e.stopPropagation()
          if (ag.id && e.detail === 2) {
            openSubagentChat(ag)
            return
          }
          patch({ filterAgent: isFiltered ? '' : ag.name })
        },
      },
      (isRunning || isAgentFocused)
        ? h('rect', {
            className: 'dnb-pulse-ring',
            x: x - 2.5, y: y - 2.5, width: w + 5, height: nh + 5, rx: NODE_R + 2,
            fill: 'none',
            stroke: isAgentFocused ? accent : '#0a84ff',
            strokeWidth: 1.8,
          })
        : null,
      h('rect', {
        x, y, width: w, height: nh, rx: NODE_R,
        fill: isAgentFocused
          ? (focusedTask && focusedTask.status === 'blocked' ? 'rgba(255,69,58,0.12)' : 'rgba(10,132,255,0.12)')
          : 'var(--dsw-alias-bg-layer-2, #232328)',
        stroke: isAgentFocused || isRunning || isFiltered ? accent : 'var(--dnb-border)',
        strokeWidth: isAgentFocused ? 2.1 : (isRunning || isFiltered ? 1.6 : 1.1),
      }),
      isRunning
        ? h('circle', {
            className: 'dnb-svg-spin',
            cx: x + 13, cy: y + 18, r: 4,
            fill: 'none',
            stroke: '#409cff',
            strokeWidth: 1.6,
            strokeDasharray: '16 9',
          })
        : h('circle', {
            cx: x + 13, cy: y + 18, r: 4,
            fill: isAgentFocused ? accent : 'var(--dnb-text-3)',
          }),
      h('text', {
        x: x + 23, y: y + 22,
        fill: 'var(--dnb-text, #f2f2f7)',
        fontSize: 11.5,
        fontWeight: 600,
      }, '@' + clampTitle(shortAgentName(ag.name, true), 8.2)),
      h('text', {
        x: x + w - 9, y: y + 21,
        textAnchor: 'end',
        fill: isAgentFocused ? accent : 'var(--dnb-text-3, #8e8e93)',
        fontSize: 9.5,
        fontWeight: 600,
      }, tierLabel),
      h('text', {
        x: x + 12, y: y + 40,
        fill: isRunning ? '#409cff' : 'var(--dnb-text-2, #98989d)',
        fontSize: 10.5,
      }, clampTitle(desc, 12)),
      kidCount > 0
        ? h(
            'g',
            { onClick: e => { e.stopPropagation(); toggleCollapse(node.id) } },
            h('rect', {
              x: x + w - 32, y: y + 30, width: 24, height: 15, rx: 7.5,
              fill: 'var(--dnb-fill, rgba(120,120,128,0.22))',
            }),
            h('text', {
              x: x + w - 20, y: y + 41,
              textAnchor: 'middle',
              fill: 'var(--dnb-text-2, #ebebf5)',
              fontSize: 9.5,
              fontWeight: 600,
            }, (isCol ? '+' : '−') + (hiddenKids || kidCount)),
          )
        : null,
    )
  }

  const { task } = node
  const color = STATUS_HEX[task.status] || STATUS_HEX.todo
  const badgeBg = STATUS_BG[task.status] || STATUS_BG.todo
  const badgeText = STATUS_BADGE[task.status] || STATUS_LABEL[task.status] || task.status
  const isSelected = store.selectedTaskId === task.id
  const isFocusedTarget = store.focusTaskId === task.id
  const isDoing = task.status === 'doing'
  const isBlocked = task.status === 'blocked'
  const isDone = task.status === 'done'
  const unresolvedDepCount = (Array.isArray(task.blockedBy) ? task.blockedBy : []).filter(id => {
    const d = allById.get(id)
    return d && d.status !== 'done'
  }).length

  return h(
    'g',
    {
      key: node.id,
      opacity: dimmed ? 0.25 : 1,
      onMouseEnter: () => setHoveredId(node.id),
      onMouseLeave: () => setHoveredId(''),
      onClick: e => {
        e.stopPropagation()
        const nextSel = isSelected ? '' : task.id
        if (isDoing || isBlocked) {
          patch({
            selectedTaskId: nextSel,
            focusTaskId: isFocusedTarget && !nextSel ? '' : task.id,
          })
        } else {
          patch({ selectedTaskId: nextSel })
        }
      },
      onContextMenu: e => {
        e.preventDefault()
        e.stopPropagation()
        patch({ selectedTaskId: task.id })
        setContextMenu({ taskId: task.id, task, x: e.clientX, y: e.clientY })
      },
      style: { cursor: 'pointer', transition: 'opacity 0.2s ease' },
    },
    (isDoing || isBlocked)
      ? h('rect', {
          className: 'dnb-pulse-ring',
          x: x - 3, y: y - 3, width: w + 6, height: nh + 6, rx: NODE_R + 3,
          fill: 'none', stroke: color, strokeWidth: 2,
        })
      : null,
    h('rect', {
      x, y, width: w, height: nh, rx: NODE_R,
      fill: isBlocked
        ? 'rgba(255, 69, 58, 0.11)'
        : isDoing
          ? 'rgba(10, 132, 255, 0.09)'
          : isSelected
            ? 'var(--dnb-elevated, #2c2c2e)'
            : 'var(--dsw-alias-bg-layer-2, #222225)',
      stroke: (isSelected || isFocusedTarget || isDoing || isBlocked)
        ? color
        : (hoveredId === node.id ? 'var(--dnb-border-strong)' : 'var(--dnb-border)'),
      strokeWidth: (isSelected || isFocusedTarget) ? 2.2 : ((isDoing || isBlocked) ? 1.6 : 1),
    }),
    h('rect', {
      x: x + 9, y: y + 8, width: isBlocked ? 52 : (isDoing ? 66 : 60), height: 16, rx: 8,
      fill: badgeBg,
    }),
    isDoing
      ? h('circle', {
          className: 'dnb-svg-spin',
          cx: x + 19, y: y + 16, r: 3.6,
          fill: 'none',
          stroke: '#409cff',
          strokeWidth: 1.4,
          strokeDasharray: '14 8',
        })
      : null,
    h('text', {
      x: x + (isBlocked ? 35 : (isDoing ? 47 : 39)), y: y + 19.5,
      textAnchor: 'middle',
      fill: color,
      fontSize: 9.5,
      fontWeight: 700,
    }, badgeText),
    unresolvedDepCount > 0
      ? h('text', {
          x: x + w - 10, y: y + 19.5,
          textAnchor: 'end',
          fill: '#f59e0b',
          fontSize: 9.5,
          fontWeight: 600,
        }, `等 ${unresolvedDepCount}`)
      : null,
    h('text', {
      x: x + 11,
      y: y + 43,
      fill: isDone ? 'var(--dnb-text-3, #8e8e93)' : 'var(--dnb-text, #f2f2f7)',
      fontSize: 11.8,
      fontWeight: (isDoing || isBlocked) ? 600 : 500,
    }, clampTitle(task.title || task.id, 12.2)),
    kidCount > 0
      ? h(
          'g',
          { onClick: e => { e.stopPropagation(); toggleCollapse(node.id) } },
          h('rect', {
            x: x + w - 33, y: y + 33, width: 25, height: 16, rx: 8,
            fill: 'var(--dnb-fill, rgba(120,120,128,0.22))',
          }),
          h('text', {
            x: x + w - 20.5, y: y + 44,
            textAnchor: 'middle',
            fill: 'var(--dnb-text-2, #ebebf5)',
            fontSize: 10,
            fontWeight: 600,
          }, (isCol ? '+' : '−') + (hiddenKids || kidCount)),
        )
      : null,
  )
}

const renderSpotlightFrame = sp => {
  if (!sp) return null
  const pillW = Math.min(Math.max(158, sp.w - 8), 268)
  return h(
    'g',
    { key: 'pyramid-spotlight', style: { pointerEvents: 'none' } },
    h('rect', {
      className: 'dnb-spotlight-halo',
      x: sp.x - 4, y: sp.y - 4, width: sp.w + 8, height: sp.h + 8, rx: 18,
      fill: sp.isBlocked ? 'rgba(255, 69, 58, 0.08)' : 'rgba(10, 132, 255, 0.08)',
      stroke: sp.color,
      strokeWidth: 1,
      opacity: 0.55,
    }),
    h('rect', {
      x: sp.x, y: sp.y, width: sp.w, height: sp.h, rx: 15,
      fill: sp.isBlocked ? 'rgba(255, 69, 58, 0.05)' : 'rgba(10, 132, 255, 0.05)',
      stroke: sp.color,
      strokeWidth: 2.3,
    }),
    h('rect', {
      className: 'dnb-spotlight-dash',
      x: sp.x + 3.5, y: sp.y + 3.5, width: Math.max(0, sp.w - 7), height: Math.max(0, sp.h - 7), rx: 12,
      fill: 'none',
      stroke: sp.color,
      strokeWidth: 1.3,
      opacity: 0.85,
    }),
    h('rect', {
      x: sp.x + 10, y: sp.y - 11, width: pillW, height: 22, rx: 11,
      fill: sp.color,
    }),
    h('text', {
      x: sp.x + 10 + pillW / 2,
      y: sp.y + 3.5,
      textAnchor: 'middle',
      fill: '#ffffff',
      fontSize: 10.5,
      fontWeight: 700,
    }, sp.badgeLabel),
  )
}

  return {
    isNodeInSpotlight,
    renderPyramidConnectors,
    renderDepEdge,
    renderPyramidNode,
    renderSpotlightFrame,
  }
}
