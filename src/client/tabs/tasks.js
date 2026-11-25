/**
 * src/client/tabs/tasks.js — 任务页签主控制容器（子代理车队与合一任务流光图）
 *
 * 【核心职责】
 *   持有 `TasksTab` 的 React 状态与过滤器，编排顶部 Subagent 车队条与联合 `PlanTab` 的
 *   Apple Bento 目标圆环全景卡 + 统一任务流光图交互画布（`TaskBeamFlowView`，含主干顺序曲线与子代理发出/回归曲线）。
 */

import { React, h } from '../react-runtime.js'
import { store, patch, focusObjectiveInPyramid } from '../store.js'
import { shortAgentName, buildAgentHierarchy, resolveTaskAgents } from '../utils.js'
import { bi, statusLabel } from '../i18n.js'
import { act, sendToComposer, askLeadModel, openTaskEditor } from '../api.js'
import { Icon, AccCard } from '../components/common.js'
import { buildTaskFlowModel, TaskBeamFlowView } from './tasks-flow.js'
import { PlanTab } from './plan.js'
import { TaskInspectorDrawer, explainTaskMeaning, AddTask } from './tasks-widgets.js'

export function TasksTab({ board }) {
  const allTasks = (board && Array.isArray(board.tasks)) ? board.tasks.filter(Boolean) : []
  const filterAgent = store.filterAgent || ''
  const statusFilter = store.taskStatusFilter || 'all'
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

  const focusedTask = store.focusTaskId ? (allTasks.find(t => t && t.id === store.focusTaskId) || null) : null
  const focusInfo = focusedTask ? resolveTaskAgents(focusedTask, allTasks, subagentsRaw, store.agentIdentity) : null
  const focusedAgentSet = new Set(focusInfo ? focusInfo.agentNames : [])
  const focusedTaskScopeSet = new Set(focusInfo ? focusInfo.scopeTaskIds : [])

  const [collapsed, setCollapsed] = React.useState(() => new Set())
  const [contextMenu, setContextMenu] = React.useState(null)
  const [addTaskOpen, setAddTaskOpen] = React.useState(false)
  const [stageFocusReq, setStageFocusReq] = React.useState(null)
  const boardSectionRef = React.useRef(null)

  const toggleCollapse = nodeKey => {
    setCollapsed(prev => {
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

  const planSteps = (board && Array.isArray(board.plan)) ? board.plan.filter(Boolean) : []
  const hasFlowContent = tasks.length > 0 || hier.children.length > 0 || Boolean(board && board.objective) || planSteps.length > 0
  const flowModel = hasFlowContent
    ? buildTaskFlowModel(board, allTasks, tasks, hier, {
        statusFilter,
        filterAgent,
        focusedTaskScopeSet,
        focusedAgentSet,
      })
    : null

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

  const STATUS_FILTERS = [
    { key: 'all', label: bi('全部', 'All'), count: allTasks.length },
    { key: 'doing', label: statusLabel('doing'), count: doingTotal, color: 'var(--dnb-accent, #9f8eff)' },
    { key: 'blocked', label: statusLabel('blocked'), count: blockedTotal, color: 'var(--dnb-coral, #f28b88)' },
    { key: 'todo', label: statusLabel('todo'), count: todoTotal, color: 'var(--dnb-text-3, #8e8e93)' },
    { key: 'done', label: statusLabel('done'), count: doneTotal, color: 'var(--dnb-sage, #63d1b0)' },
  ]

  const jumpToBoardStage = stageId => {
    if (!stageId) return
    if (boardCollapsed) patch({ boardSectionCollapsed: false })
    setStageFocusReq({ id: stageId, seq: Date.now() })
    setTimeout(() => {
      const root = boardSectionRef.current
      if (!root || typeof root.querySelector !== 'function') return
      const el = root.querySelector(`[data-flow-stage-id="${stageId}"]`)
      if (el && typeof el.scrollIntoView === 'function') {
        try {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        } catch {}
      }
    }, boardCollapsed ? 60 : 0)
  }

  const flowStages = (flowModel && Array.isArray(flowModel.stages)) ? flowModel.stages : []
  const planDoneCount = planSteps.filter(s => s && s.done).length
  const runningAgentsCount = hier.children.filter(a => a && a.status === 'running').length
  const activeFlowStage = flowStages.find(s => s.id === (flowModel && flowModel.activeStageId))
    || flowStages.find(s => s && !s.done && s.status !== 'done')
    || null
  const bentoMeta = {
    totalSteps: flowStages.length,
    doneSteps: flowStages.length > 0 ? flowStages.filter(s => s.status === 'done').length : planDoneCount,
    totalTasks: allTasks.length,
    doneTasks: doneTotal,
    blockedTasks: blockedTotal,
    runningAgents: runningAgentsCount,
    activeStage: activeFlowStage,
    onJumpActive: stageId => jumpToBoardStage(stageId),
  }

  // ==================== Unified Task Flow Canvas Board ====================
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
        title: bi('任务关系图', 'Work Map'),
        headTitle: boardCollapsed ? bi('展开任务关系图', 'Expand Work Map') : bi('收起任务关系图', 'Collapse Work Map'),
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
                      title: bi(`步骤 ${st.index}: ${st.title}（跳到对应步骤）`, `Step ${st.index}: ${st.title} (jump to step)`),
                      onClick: () => jumpToBoardStage(st.id),
                    },
                    st.status === 'done' ? h(Icon, { name: 'check', size: 9 }) : (st.status === 'blocked' ? '!' : String(st.index)),
                  ),
                  idx < Math.min(flowStages.length, 8) - 1
                    ? h('span', { className: 'dnb-acc-mini-link', 'data-done': st.status === 'done' ? '1' : '0' })
                    : null,
                ),
              ),
              flowStages.length > 8
                ? h('span', { style: { fontSize: 10, color: 'var(--dnb-text-3)', marginLeft: 3 } }, `+${flowStages.length - 8}`)
                : null,
            )
          : null,
        count: [planSteps.length > 0 ? bi(`${planDoneCount}/${planSteps.length} 步`, `${planDoneCount}/${planSteps.length} steps`) : '', taskCountLabel].filter(Boolean).join(' · '),
        badges: runningAgentsCount > 0
          ? h('span', { className: 'dnb-acc-badge', 'data-tone': 'accent' }, bi(`${runningAgentsCount} 个在忙`, `${runningAgentsCount} active`))
          : null,
        actions: h('button', {
          type: 'button',
          className: 'dnb-pill',
          'data-active': addTaskOpen ? '1' : '0',
          style: { height: 22, padding: '0 8px', fontSize: 10.5 },
          title: addTaskOpen ? bi('收起添加框', 'Close form') : bi('手动加一条任务', 'Add a task'),
          onClick: () => {
            if (boardCollapsed) patch({ boardSectionCollapsed: false })
            setAddTaskOpen(v => !v)
          },
        }, h(Icon, { name: 'plus', size: 10.5 }), addTaskOpen ? bi('收起', 'Close') : bi('任务', 'Task')),
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

      addTaskOpen ? h(AddTask, { board }) : null,

      allTasks.length > 0
        ? h(
            'div',
            { style: { marginBottom: 8 } },
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
                    ? h('span', { className: 'dnb-spin-ring', style: { '--dnb-spin-size': '8px', color: 'var(--dnb-accent, #9f8eff)' } })
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

      h(TaskBeamFlowView, {
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
        statusFilter,
        stepApi,
        externalSelectStage: stageFocusReq,
      }),
    )
  }

  return h(
    React.Fragment,
    null,
    h(PlanTab, {
      board,
      topSlot: null,
      bentoMeta,
      taskTopologySlot: null,
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
                style: { color: 'var(--dnb-amber)' },
                onClick: () => {
                  const t = contextMenu.task
                  setContextMenu(null)
                  void act({ action: 'team.interrupt', id: t.id, agent: t.subagent || t.owner })
                },
              }, h(Icon, { name: 'stop', size: 13 }), '停止子代理')
            : null,
          h('div', {
            className: 'dnb-menu-item',
            style: { color: 'var(--dnb-coral)' },
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

