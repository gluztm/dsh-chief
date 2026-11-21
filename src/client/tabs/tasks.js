/**
 * src/client/tabs/tasks.js — 任务页签主控制容器（子代理团队、工作关系图与顺序任务板）
 *
 * 【核心职责】
 *   持有 `TasksTab` 的 React 状态与过滤器，编排顶部 Subagent 车队条（Zone 1）、
 *   可折叠工作关系图（Zone 2：流程画布 / 组织树，委托给 `tasks-flow.js` 与 `tasks-pyramid.js`）、
 *   以及顺序推进任务板（Zone 3：联合 `PlanTab` 与 `tasks-widgets.js` 的 `TaskInspectorDrawer`）。
 *
 * 【子模块划分】
 *   - `tabs/tasks-widgets.js`  任务抽屉、新建行与行卡片组件
 *   - `tabs/tasks-pyramid.js`  可展开组织树与 SVG 金字塔视图渲染器
 *   - `tabs/tasks-flow.js`     顺序工作流管道拓扑与 SVG 画布
 */

import { React, h } from '../react-runtime.js'
import {
  STATUSES,
  STATUS_LABEL,
  STATUS_BADGE,
  STATUS_HEX,
  STATUS_BG,
  GENERIC_OWNERS,
} from '../constants.js'
import {
  store,
  patch,
  focusObjectiveInPyramid,
  focusSecInput,
  openSubagentChat,
} from '../store.js'
import { clampTitle, shortAgentName, buildAgentHierarchy, resolveTaskAgents } from '../utils.js'
import { bi, statusLabel } from '../i18n.js'
import { act, sendToComposer, askLeadModel, openTaskEditor } from '../api.js'
import { Icon, StatusBadge, AccCard, SubagentFleetBar } from '../components/common.js'
import {
  buildTaskFlowModel,
  computeFlowCanvasLayout,
  TaskFlowPipelineView,
  TaskFlowCanvasView,
} from './tasks-flow.js'
import { PlanTab } from './plan.js'

import { TaskInspectorDrawer, explainTaskMeaning, AddTask, TaskRow } from './tasks-widgets.js'
import { renderGrandPyramidView } from './tasks-pyramid.js'

export function TasksTab({ board }) {
  const allTasks = (board && Array.isArray(board.tasks)) ? board.tasks.filter(Boolean) : []
  const allById = new Map(allTasks.map(t => [t.id, t]))
  const filterAgent = store.filterAgent || ''
  const statusFilter = store.taskStatusFilter || 'all'
  const topoViewMode = store.taskViewMode === 'graph' ? 'graph' : 'canvas'
  const topoCollapsed = store.topoSectionCollapsed !== false
  const boardCollapsed = Boolean(store.boardSectionCollapsed)
  const subagentsRaw = Array.isArray(store.subagents) ? store.subagents : []
  const hier = buildAgentHierarchy(subagentsRaw, store.agentIdentity)

  const tasks = allTasks.filter(t => {
    if (!t) return false
    if (filterAgent) {
      const hit = hier.matchAgentRef(t.subagent || t.owner || t.session)
      const rawOwner = t.subagent || t.owner || ''
      if ((hit ? hit.name : rawOwner) !== filterAgent) return false
    }
    if (statusFilter !== 'all' && t.status !== statusFilter) return false
    return true
  })

  const childrenOf = id => tasks.filter(t => t.parentId === id && t.id !== id)
  const ids = new Set(tasks.map(t => t.id))
  const isRoot = task => !task.parentId || !ids.has(task.parentId) || task.parentId === task.id
  const roots = [
    ...tasks.filter(t => t.status === 'blocked' && isRoot(t)),
    ...tasks.filter(t => t.status === 'doing' && isRoot(t)),
    ...tasks.filter(t => t.status === 'todo' && isRoot(t)),
    ...tasks.filter(t => t.status === 'done' && isRoot(t)),
  ]

  const focusedTask = store.focusTaskId ? (allTasks.find(t => t && t.id === store.focusTaskId) || null) : null
  const focusInfo = focusedTask ? resolveTaskAgents(focusedTask, allTasks, subagentsRaw, store.agentIdentity) : null
  const focusedAgentSet = new Set(focusInfo ? focusInfo.agentNames : [])
  const focusedTaskScopeSet = new Set(focusInfo ? focusInfo.scopeTaskIds : [])

  const AGENT_W = 196
  const AGENT_H = 54
  const LEAD_W = 204
  const LEAD_H = 58
  const TASK_W = 188
  const TASK_H = 58
  const FOLD_W = 152
  const FOLD_H = 46
  const H_GAP = 20
  const V_GAP = 48
  const NODE_R = 12
  const isLR = store.graphDir === 'LR'

  const [collapsed, setCollapsed] = React.useState(() => new Set())
  const [zoom, setZoom] = React.useState(1)
  const [hoveredId, setHoveredId] = React.useState('')
  const [contextMenu, setContextMenu] = React.useState(null)
  const [addTaskOpen, setAddTaskOpen] = React.useState(false)
  const [expandAllStages, setExpandAllStages] = React.useState(false)
  const [pyrOpenNodes, setPyrOpenNodes] = React.useState(() => new Set())
  const [pyrOpenDetails, setPyrOpenDetails] = React.useState(() => new Set())
  const [pyrOpenDoneGroups, setPyrOpenDoneGroups] = React.useState({})
  const pyrRootRef = React.useRef(null)
  const canvasRef = React.useRef(null)
  const panRef = React.useRef(null)
  const boardSectionRef = React.useRef(null)

  const toggleCollapse = nodeKey => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(nodeKey)) next.delete(nodeKey)
      else next.add(nodeKey)
      return next
    })
  }

  const togglePyrNode = nodeKey => {
    setPyrOpenNodes(prev => {
      const next = new Set(prev)
      if (next.has(nodeKey)) next.delete(nodeKey)
      else next.add(nodeKey)
      return next
    })
  }

  const togglePyrDetail = nodeKey => {
    setPyrOpenDetails(prev => {
      const next = new Set(prev)
      if (next.has(nodeKey)) next.delete(nodeKey)
      else next.add(nodeKey)
      return next
    })
  }

  React.useEffect(() => {
    if (!contextMenu) return undefined
    const close = () => setContextMenu(null)
    const onKey = e => { if (e.key === 'Escape') close() }
    document.addEventListener('click', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [contextMenu])

  // Group root tasks by owning agent ('lead' or subagent name) — shared by both Grand Pyramid & SVG Canvas
  const tasksByAgent = new Map()
  tasksByAgent.set('lead', [])
  for (const a of hier.children) tasksByAgent.set(a.name, [])
  const singleRunningAgent = (() => {
    const running = hier.children.filter(a => a.status === 'running')
    return running.length === 1 ? running[0] : null
  })()
  for (const t of roots) {
    let ownerKey = 'lead'
    const explicitHit = hier.matchAgentRef(t.subagent || t.owner || t.session)
      || hier.children.find(a => a.taskId === t.id || (Array.isArray(a.tasks) && a.tasks.some(at => at && at.id === t.id)))
    if (explicitHit) {
      ownerKey = explicitHit.name
    } else if (
      singleRunningAgent
      && (t.status === 'doing' || (focusedTask && focusedTask.id === t.id && focusInfo && focusInfo.inferredLive))
    ) {
      ownerKey = singleRunningAgent.name
    }
    if (!tasksByAgent.has(ownerKey)) tasksByAgent.set(ownerKey, [])
    tasksByAgent.get(ownerKey).push(t)
  }


  const planSteps = (board && Array.isArray(board.plan)) ? board.plan.filter(Boolean) : []
  const hasPyramidContent = tasks.length > 0 || hier.children.length > 0 || Boolean(board && board.objective) || planSteps.length > 0
  const flowModel = hasPyramidContent
    ? buildTaskFlowModel(board, allTasks, tasks, hier, {
        statusFilter,
        filterAgent,
        focusedTaskScopeSet,
        focusedAgentSet,
      })
    : null
  const flowCanvasLayout = (!topoCollapsed && hasPyramidContent && topoViewMode === 'canvas' && flowModel)
    ? computeFlowCanvasLayout(flowModel, isLR)
    : null
  const svgW = flowCanvasLayout ? flowCanvasLayout.svgW : 320
  const spotlight = null

  const fitZoom = React.useCallback(() => {
    const el = canvasRef.current
    if (!el || !svgW) {
      setZoom(1)
      return
    }
    const avail = Math.max(240, el.clientWidth - 20)
    const ratio = avail < svgW ? Math.max(0.42, avail / svgW) : 1
    setZoom(+ratio.toFixed(2))
  }, [svgW])

  // Auto-fit SVG canvas width when topology drawer opens or canvas layout changes
  React.useEffect(() => {
    if (topoCollapsed || topoViewMode !== 'canvas' || !canvasRef.current) return undefined
    fitZoom()
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(() => fitZoom())
      ro.observe(canvasRef.current)
      return () => ro.disconnect()
    }
    return undefined
  }, [topoCollapsed, topoViewMode, svgW, fitZoom])

  // Smoothly scroll spotlighted branch/card into view in Grand Pyramid
  React.useEffect(() => {
    if (!store.focusTaskId || topoCollapsed) return
    if (topoViewMode === 'graph' && pyrRootRef.current) {
      const targetEl = pyrRootRef.current.querySelector('[data-pyr-spotlight="1"]')
      if (targetEl && typeof targetEl.scrollIntoView === 'function') {
        try {
          targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
        } catch {}
      }
      return
    }
  }, [store.focusTaskId, topoViewMode, topoCollapsed])

  const selectedTask = allTasks.find(t => t && t.id === store.selectedTaskId) || null
  const doneTotal = allTasks.filter(t => t && t.status === 'done').length
  const doingTotal = allTasks.filter(t => t && t.status === 'doing').length
  const blockedTotal = allTasks.filter(t => t && t.status === 'blocked').length
  const todoTotal = allTasks.filter(t => t && t.status === 'todo').length

  const triggerAiPlanGraph = () => {
    const goal = (board && board.objective ? `针对「${board.objective.slice(0, 80)}」，` : '')
    const sent = sendToComposer(goal + '请先调用 chief_board 的 plan.set 定好一二三四五顺序推进步骤，再用 graph.plan（填入对应 planStepId 与可选 targetPlanStepId）和 task.dispatch 调度子代理支线推进。')
    patch({ notice: sent || '请在主对话里让 AI 帮你拆出步骤' })
  }


  const pyramidCtx = {
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
  }

  const STATUS_FILTERS = [
    { key: 'all', label: bi('全部', 'All'), count: allTasks.length },
    { key: 'doing', label: statusLabel('doing'), count: doingTotal, color: '#0a84ff' },
    { key: 'blocked', label: statusLabel('blocked'), count: blockedTotal, color: '#ff453a' },
    { key: 'todo', label: statusLabel('todo'), count: todoTotal, color: '#8e8e93' },
    { key: 'done', label: statusLabel('done'), count: doneTotal, color: '#30d158' },
  ]

  const jumpToBoardStage = stageId => {
    if (!stageId) return
    if (boardCollapsed) patch({ boardSectionCollapsed: false })
    setTimeout(() => {
      const root = boardSectionRef.current
      if (!root || typeof root.querySelector !== 'function') return
      const el = root.querySelector(`[data-flow-stage-id="${stageId}"]`)
      if (el && typeof el.scrollIntoView === 'function') {
        try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }) } catch {}
      }
    }, boardCollapsed ? 60 : 0)
  }

  const topSlot = h(SubagentFleetBar, { board })

  const flowStages = (flowModel && Array.isArray(flowModel.stages)) ? flowModel.stages : []
  const flowStats = (flowModel && flowModel.stats) || {}
  const planDoneCount = planSteps.filter(s => s && s.done).length
  const runningAgentsCount = hier.children.filter(a => a && a.status === 'running').length

  // ==================== Zone 2: Collapsible Pure Visual Work Topology ====================
  const taskTopologySlot = h(
    AccCard,
    {
      open: !topoCollapsed,
      onToggle: () => patch({ topoSectionCollapsed: !topoCollapsed }),
      className: 'dnb-topo-card',
      title: bi('任务关系图', 'Work Map'),
      headTitle: topoCollapsed ? bi('展开任务关系图（流程画布 / 组织树）', 'Expand work map (Flow Canvas / Org Tree)') : bi('收起任务关系图', 'Collapse work map'),
      headerExtra: flowStages.length > 0
        ? h(
            'div',
            {
              className: 'dnb-acc-mini-miles',
              onClick: e => e.stopPropagation(),
            },
            flowStages.slice(0, 8).map((st, idx) =>
              h(
                React.Fragment,
                { key: 'tm-' + st.id },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dnb-acc-mini-mile',
                    'data-status': st.status,
                    title: bi(`步骤 ${st.index}: ${st.title}（跳到对应任务）`, `Step ${st.index}: ${st.title} (jump to task)`),
                    onClick: () => jumpToBoardStage(st.id),
                  },
                  st.status === 'done' ? h(Icon, { name: 'check', size: 9 }) : String(st.index),
                ),
                idx < Math.min(flowStages.length, 8) - 1
                  ? h('span', { className: 'dnb-acc-mini-link', 'data-done': st.status === 'done' ? '1' : '0' })
                  : null,
              ),
            ),
            flowStages.length > 8
              ? h('span', { style: { fontSize: 10, color: 'var(--dnb-text-3)', marginLeft: 2 } }, `+${flowStages.length - 8}`)
              : null,
          )
        : null,
      count: flowStages.length > 0 ? bi(`${flowStats.doneStages || 0}/${flowStats.totalStages || flowStages.length} 步`, `${flowStats.doneStages || 0}/${flowStats.totalStages || flowStages.length} steps`) : '',
      badges: runningAgentsCount > 0
        ? h('span', { className: 'dnb-acc-badge', 'data-tone': 'accent' }, bi(`${runningAgentsCount} 个在忙`, `${runningAgentsCount} active`))
        : null,
      actions: !topoCollapsed
        ? h(
            'div',
            { className: 'dnb-seg', style: { padding: 2 } },
            h('button', {
              type: 'button',
              className: 'dnb-seg-btn',
              style: { padding: '2px 8px', fontSize: 10.5 },
              'data-active': topoViewMode === 'canvas' ? '1' : '0',
              title: bi('流程画布：看步骤顺序和子代理分工', 'Flow Canvas: step order and subagents'),
              onClick: () => patch({ taskViewMode: 'canvas' }),
            }, bi('流程画布', 'Flow Canvas')),
            h('button', {
              type: 'button',
              className: 'dnb-seg-btn',
              style: { padding: '2px 8px', fontSize: 10.5 },
              'data-active': topoViewMode === 'graph' ? '1' : '0',
              title: bi('组织树：按上下级看谁负责哪块任务', 'Org Tree: see who owns each task'),
              onClick: () => patch({ taskViewMode: 'graph' }),
            }, h(Icon, { name: 'network', size: 10.5 }), bi('组织树', 'Org Tree')),
          )
        : null,
    },
    focusedTask
      ? h(
          'div',
          { className: 'dnb-focus-banner', 'data-blocked': focusedTask.status === 'blocked' ? '1' : '0', style: { marginBottom: 8 } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } },
            h(Icon, { name: 'target', size: 13 }),
            h('span', { style: { wordBreak: 'break-word' } },
              (focusedTask.status === 'blocked' ? bi('已高亮卡住的代理：', 'Highlighted blocked: ') : bi('已高亮正在做的子代理：', 'Highlighted active: '))
              + (focusInfo && focusInfo.agentNames.length
                  ? focusInfo.agentNames.map(n => '@' + shortAgentName(n, true)).join(bi('、', ', '))
                  : bi('@主代理', '@Lead'))),
          ),
          h(
            'div',
            { style: { display: 'flex', gap: 5, flexShrink: 0 } },
            h('button', {
              type: 'button',
              className: 'dnb-pill',
              style: { height: 21, padding: '0 7px', fontSize: 10.5 },
              onClick: () => patch({ selectedTaskId: store.selectedTaskId === focusedTask.id ? '' : focusedTask.id }),
            }, bi('详情', 'Details')),
            h('button', {
              type: 'button',
              className: 'dnb-pill',
              style: { height: 21, padding: '0 7px', fontSize: 10.5 },
              onClick: () => patch({ focusTaskId: '' }),
            }, bi('取消高亮 ×', 'Clear ×')),
          ),
        )
      : null,

    hasPyramidContent
      ? topoViewMode === 'canvas'
        ? h(
            React.Fragment,
            null,
            h(
              'div',
              { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, marginBottom: 6 } },
              h('button', {
                type: 'button',
                className: 'dnb-pill',
                style: { height: 22, padding: '0 8px', fontSize: 10.5 },
                onClick: () => patch({ graphDir: isLR ? 'TD' : 'LR' }),
              }, isLR ? bi('横着排', 'Horizontal') : bi('竖着排', 'Vertical')),
              h(
                'div',
                { style: { display: 'flex', gap: 3, alignItems: 'center' } },
                h('button', { type: 'button', className: 'dnb-pill', style: { height: 22, padding: '0 7px' }, onClick: () => setZoom(z => Math.max(0.42, +(z - 0.12).toFixed(2))) }, '−'),
                h('button', { type: 'button', className: 'dnb-pill', style: { height: 22, padding: '0 7px', fontSize: 10.5 }, onClick: fitZoom, title: bi('自动调整大小适应窗口', 'Fit to window width') }, Math.round(zoom * 100) + '%'),
                h('button', { type: 'button', className: 'dnb-pill', style: { height: 22, padding: '0 7px' }, onClick: () => setZoom(z => Math.min(1.6, +(z + 0.12).toFixed(2))) }, '+'),
              ),
            ),
            h(
              'div',
              { className: 'dnb-topo-canvas-wrap' },
              h(TaskFlowCanvasView, {
                flowModel,
                flowLayout: flowCanvasLayout,
                board,
                isLR,
                zoom,
                setZoom,
                canvasRef,
                panRef,
                selectedTask,
                onSelectStage: st => jumpToBoardStage(st.id),
                renderInspector: t => h(TaskInspectorDrawer, { board, task: t }),
              }),
            ),
          )
        : h('div', { className: 'dnb-topo-pyr-wrap' }, renderGrandPyramidView(pyramidCtx))
      : h(
          'div',
          { className: 'dnb-empty', style: { padding: '14px 10px' } },
          h('div', { style: { marginBottom: 8 } }, bi('还没有任务关系图，先添加步骤或拆解任务', 'No work map yet')),
          h('button', {
            type: 'button',
            className: 'dnb-pill dnb-pill-accent',
            onClick: triggerAiPlanGraph,
          }, h(Icon, { name: 'sparkles', size: 12 }), bi('让主对话帮你拆出步骤', 'Ask main chat to plan steps')),
        ),
  )

  // ==================== Zone 3: Unified Progress Task Board (Merged Flow + Plan Board) ====================
  const renderUnifiedBoard = stepApi => {
    const taskMetaParts = []
    if (blockedTotal > 0) taskMetaParts.push(bi(`${blockedTotal} 卡住`, `${blockedTotal} blocked`))
    if (doingTotal > 0) taskMetaParts.push(bi(`${doingTotal} 进行中`, `${doingTotal} active`))
    if (doneTotal > 0) taskMetaParts.push(bi(`${doneTotal} 完成`, `${doneTotal} done`))
    const taskCountLabel = taskMetaParts.length > 0
      ? taskMetaParts.join(' · ')
      : (allTasks.length ? bi(`${doneTotal}/${allTasks.length} 任务`, `${doneTotal}/${allTasks.length} tasks`) : '')

    return h(
      AccCard,
      {
        cardRef: boardSectionRef,
        open: !boardCollapsed,
        onToggle: () => patch({ boardSectionCollapsed: !boardCollapsed }),
        className: 'dnb-board-card',
        title: bi('任务进度板', 'Task Board'),
        headTitle: boardCollapsed ? bi('展开任务进度板', 'Expand Task Board') : bi('收起任务进度板', 'Collapse Task Board'),
        count: [planSteps.length > 0 ? bi(`${planDoneCount}/${planSteps.length} 步`, `${planDoneCount}/${planSteps.length} steps`) : '', taskCountLabel].filter(Boolean).join(' · '),
        actions: h(
          React.Fragment,
          null,
          h('button', {
            type: 'button',
            className: 'dnb-pill',
            'data-active': addTaskOpen ? '1' : '0',
            style: { height: 22, padding: '0 7px', fontSize: 10.5 },
            title: addTaskOpen ? bi('收起添加框', 'Close form') : bi('手动加一条任务', 'Add a task'),
            onClick: () => {
              if (boardCollapsed) patch({ boardSectionCollapsed: false })
              setAddTaskOpen(v => !v)
            },
          }, h(Icon, { name: 'plus', size: 10.5 }), addTaskOpen ? bi('收起', 'Close') : bi('任务', 'Task')),
          flowStages.length > 0
            ? h('button', {
                type: 'button',
                className: 'dnb-mini-btn',
                'data-tone': expandAllStages ? 'accent' : undefined,
                title: expandAllStages ? bi('只展开当前步，折叠其他步骤', 'Focus on current step only') : bi('展开全部步骤', 'Expand all steps'),
                onClick: () => {
                  if (boardCollapsed) patch({ boardSectionCollapsed: false })
                  setExpandAllStages(v => !v)
                },
              }, expandAllStages ? bi('只看当前', 'Focused') : bi('全部展开', 'Expand All'))
            : null,
        ),
      },
      addTaskOpen ? h(AddTask, { board }) : null,

      allTasks.length > 0
        ? h(
            'div',
            { style: { marginBottom: 8 } },
            h(
              'div',
              { className: 'dnb-progress', style: { marginBottom: 6 } },
              doneTotal ? h('div', { style: { width: (doneTotal / allTasks.length) * 100 + '%', background: '#30d158', transition: 'width 0.3s ease' } }) : null,
              doingTotal ? h('div', { style: { width: (doingTotal / allTasks.length) * 100 + '%', background: '#0a84ff', transition: 'width 0.3s ease' } }) : null,
              blockedTotal ? h('div', { style: { width: (blockedTotal / allTasks.length) * 100 + '%', background: '#ff453a', transition: 'width 0.3s ease' } }) : null,
            ),
            h(
              'div',
              { className: 'dnb-text-filter-bar' },
              STATUS_FILTERS.map(f =>
                h(
                  'button',
                  {
                    key: f.key,
                    type: 'button',
                    className: 'dnb-text-filter-btn',
                    'data-active': statusFilter === f.key ? '1' : '0',
                    onClick: () => patch({ taskStatusFilter: f.key }),
                  },
                  f.key === 'doing' && doingTotal > 0
                    ? h('span', { className: 'dnb-spin-ring', style: { '--dnb-spin-size': '8px', color: '#409cff' } })
                    : f.color
                      ? h('span', { style: { width: 5.5, height: 5.5, borderRadius: '50%', background: f.color } })
                      : null,
                  `${f.label} ${f.count}`,
                ),
              ),
              (statusFilter !== 'all' || filterAgent || store.focusTaskId)
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'dnb-text-filter-btn',
                      style: { marginLeft: 'auto' },
                      onClick: () => patch({ taskStatusFilter: 'all', filterAgent: '', focusTaskId: '' }),
                    },
                    bi('重置 ×', 'Reset ×'),
                  )
                : null,
            ),
          )
        : null,

      h(TaskFlowPipelineView, {
        flowModel,
        board,
        collapsed,
        onToggleCollapse: toggleCollapse,
        onExplainTask: t => explainTaskMeaning(t, board),
        onOpenEditor: openTaskEditor,
        onContextMenu: (e, t) => setContextMenu({ x: e.clientX, y: e.clientY, task: t, taskId: t.id }),
        selectedTask,
        renderInspector: t => h(TaskInspectorDrawer, { board, task: t }),
        onTriggerAiPlan: triggerAiPlanGraph,
        hideRail: true,
        statusFilter,
        expandAllStages,
        stepApi,
      }),
    )
  }

  return h(
    React.Fragment,
    null,
    h(PlanTab, {
      board,
      topSlot,
      taskTopologySlot,
      renderUnifiedBoard,
      onTriggerPlanGraph: goalText => {
        const cleanGoal = String(goalText || '').trim()
        const prompt = (cleanGoal ? `针对长期目标「${cleanGoal.slice(0, 100)}」，` : '')
          + '请先调用 chief_board 的 plan.set 定好一二三四五顺序推进步骤，再用 graph.plan（填入对应 planStepId 与可选 targetPlanStepId）和 task.dispatch 将就绪节点并行派发给子代理团队。'
        void askLeadModel(prompt, '拆解任务图')
      },
    }),

    // Right-click Context Menu (still supported as bonus shortcut alongside open buttons!)
    contextMenu && contextMenu.task
      ? h(
          'div',
          {
            className: 'dnb-menu',
            style: {
              left: Math.min(contextMenu.x, (typeof window !== 'undefined' ? window.innerWidth : 800) - 180),
              top: Math.min(contextMenu.y, (typeof window !== 'undefined' ? window.innerHeight : 600) - 240),
            },
          },
          h('div', {
            className: 'dnb-menu-item',
            onClick: () => {
              const t = contextMenu.task
              setContextMenu(null)
              focusObjectiveInPyramid(t.id)
            },
          }, h(Icon, { name: 'target', size: 13 }), '高亮负责的代理'),
          h('div', {
            className: 'dnb-menu-item',
            style: { color: 'var(--dnb-accent)', fontWeight: 500 },
            onClick: () => {
              const t = contextMenu.task
              setContextMenu(null)
              explainTaskMeaning(t, board)
            },
          }, h(Icon, { name: 'sparkles', size: 13 }), '用大白话解释'),
          h('div', {
            className: 'dnb-menu-item',
            onClick: () => {
              const t = contextMenu.task
              setContextMenu(null)
              void act({
                action: 'task.dispatch',
                id: t.id,
                agent: t.subagent || t.owner || ('worker-' + String(t.id).slice(-4)),
              })
            },
          }, h(Icon, { name: 'play', size: 13 }), '交给子代理做'),
          h('div', {
            className: 'dnb-menu-item',
            onClick: () => {
              const t = contextMenu.task
              setContextMenu(null)
              openTaskEditor(t)
            },
          }, h(Icon, { name: 'edit', size: 13 }), '修改任务'),
          contextMenu.task.status !== 'done'
            ? h('div', {
                className: 'dnb-menu-item',
                onClick: () => {
                  const id = contextMenu.taskId
                  setContextMenu(null)
                  void act({ action: 'task.update', id, status: 'done' })
                },
              }, h(Icon, { name: 'check', size: 13 }), '标记完成')
            : null,
          contextMenu.task.status === 'doing' && (contextMenu.task.subagent || contextMenu.task.owner)
            ? h('div', {
                className: 'dnb-menu-item',
                style: { color: '#f59e0b' },
                onClick: () => {
                  const t = contextMenu.task
                  setContextMenu(null)
                  void act({ action: 'team.interrupt', id: t.id, agent: t.subagent || t.owner })
                },
              }, h(Icon, { name: 'stop', size: 13 }), '停止子代理')
            : null,
          h('div', {
            className: 'dnb-menu-item',
            style: { color: '#ff453a' },
            onClick: () => {
              const id = contextMenu.taskId
              setContextMenu(null)
              if (store.selectedTaskId === id) patch({ selectedTaskId: '' })
              if (store.focusTaskId === id) patch({ focusTaskId: '' })
              void act({ action: 'task.remove', id })
            },
          }, h(Icon, { name: 'trash', size: 13 }), '删除'),
        )
      : null,
  )
}

