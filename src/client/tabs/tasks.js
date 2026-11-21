/**
 * tabs/tasks.js
 *
 * Tasks tab: TaskInspectorDrawer, AddTask, TaskRow, pyramid topology, and TasksTab.
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

function TaskInspectorDrawer({ board, task }) {
  const [dispatchAgent, setDispatchAgent] = React.useState('')
  const [dispatchProvider, setDispatchProvider] = React.useState('spawn')
  const [dispatchPrompt, setDispatchPrompt] = React.useState('')
  const [newAssumption, setNewAssumption] = React.useState('')

  React.useEffect(() => {
    if (!task) return
    const suggested = String(task.subagent || task.owner || '').trim()
    const clean = suggested && !['agent', 'operator', 'user'].includes(suggested)
      ? suggested
      : ('worker-' + String(task.id || '').replace(/[^a-z0-9]/gi, '').slice(-4))
    setDispatchAgent(clean)
    setDispatchProvider(task.preset === 'fork' ? 'fork' : 'spawn')
  }, [task && task.id, task && task.owner, task && task.subagent])

  if (!task) return null
  const allTasks = (board && Array.isArray(board.tasks)) ? board.tasks : []
  const byId = new Map(allTasks.map(t => [t.id, t]))
  const editing = store.editTaskId === task.id
  const subagents = Array.isArray(store.subagents) ? store.subagents.filter(a => a && a.name && a.name !== 'lead') : []
  const assignedName = task.subagent || task.owner || ''
  const matchedAgent = subagents.find(a => a.name === assignedName) || null

  const saveTask = () => {
    const title = (store.editTaskTitle || '').trim()
    if (!title) return
    patch({ editTaskId: '' })
    void act({
      action: 'task.update',
      id: task.id,
      title,
      note: store.editTaskNote || '',
      intent: store.editTaskIntent || '',
      evidence: store.editTaskEvidence || '',
      parentId: store.editTaskParentId || '',
      planStepId: store.editTaskPlanStepId || '',
      targetPlanStepId: store.editTaskTargetPlanStepId || '',
      blockedBy: store.editTaskBlockedBy || [],
    })
  }

  const triggerDispatch = (force = false) => {
    const agentName = (dispatchAgent || '').trim() || ('worker-' + String(task.id).slice(-4))
    const promptText = dispatchPrompt.trim()
    setDispatchPrompt('')
    void act({
      action: 'task.dispatch',
      id: task.id,
      agent: agentName,
      provider: dispatchProvider,
      ...(promptText ? { prompt: promptText } : {}),
      ...(force ? { force: true } : {}),
    })
  }

  const unresolvedDeps = (Array.isArray(task.blockedBy) ? task.blockedBy : []).filter(depId => {
    const d = byId.get(depId)
    return d && d.status !== 'done'
  })

  const removeDep = depId => {
    const next = (task.blockedBy || []).filter(id => id !== depId)
    void act({ action: 'task.update', id: task.id, blockedBy: next })
  }

  const addDep = depId => {
    if (!depId || depId === task.id) return
    const cur = Array.isArray(task.blockedBy) ? task.blockedBy : []
    if (!cur.includes(depId)) {
      void act({ action: 'task.update', id: task.id, blockedBy: [...cur, depId] })
    }
  }

  const addAssumption = () => {
    const txt = newAssumption.trim()
    if (!txt) return
    setNewAssumption('')
    void act({ action: 'task.update', id: task.id, assumption: txt })
  }

  return h(
    'div',
    { className: 'dnb-sheet' },
    h('div', { className: 'dnb-sheet-handle' }),

    // Title + Actions Header
    h(
      'div',
      { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 } },
      h(
        'div',
        { style: { flex: 1, minWidth: 0 } },
        h('div', { style: { fontWeight: 600, fontSize: 13.5, lineHeight: 1.35 } }, task.title),
        assignedName
          ? h('div', { style: { fontSize: 11, color: 'var(--dnb-accent)', marginTop: 2 } }, '@' + assignedName)
          : null,
      ),
      h(
        'div',
        { style: { display: 'flex', gap: 4 } },
        h('button', {
          className: 'dnb-icon-btn',
          title: editing ? '取消编辑' : '编辑详情',
          'data-active': editing ? '1' : '0',
          onClick: () => editing ? patch({ editTaskId: '' }) : openTaskEditor(task),
        }, h(Icon, { name: 'edit', size: 13 })),
        h('button', {
          className: 'dnb-icon-btn',
          style: { color: '#ff453a' },
          title: '删除节点',
          onClick: () => {
            patch({ selectedTaskId: '', editTaskId: '' })
            void act({ action: 'task.remove', id: task.id })
          },
        }, h(Icon, { name: 'trash', size: 13 })),
        h('button', {
          className: 'dnb-icon-btn',
          title: '收起',
          onClick: () => patch({ selectedTaskId: '', editTaskId: '' }),
        }, h(Icon, { name: 'x', size: 14 })),
      ),
    ),

    // Segmented Status Switcher
    h(
      'div',
      { className: 'dnb-seg', style: { marginBottom: 10 } },
      STATUSES.map(st =>
        h('button', {
          key: st,
          className: 'dnb-seg-btn',
          'data-active': task.status === st ? '1' : '0',
          onClick: () => void act({ action: 'task.update', id: task.id, status: st }),
        },
          h('span', { style: { width: 6, height: 6, borderRadius: '50%', background: STATUS_HEX[st] } }),
          STATUS_LABEL[st],
        ),
      ),
    ),

    // Subagent Dispatch Capsule
    h(
      'div',
      { className: 'dnb-group', style: { padding: '8px 10px', marginBottom: 8 } },
      h(
        'div',
        { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
        h('input', {
          className: 'dnb-input',
          style: { width: 108, height: 28, padding: '0 9px', borderRadius: 99, fontSize: 11.5 },
          placeholder: '子代理名…',
          value: dispatchAgent,
          onChange: e => setDispatchAgent(e.target.value),
        }),
        h('select', {
          className: 'dnb-input',
          style: { width: 'auto', height: 28, padding: '0 8px', borderRadius: 99, fontSize: 11.5 },
          value: dispatchProvider,
          onChange: e => setDispatchProvider(e.target.value),
        },
          h('option', { value: 'spawn' }, '独立上下文'),
          h('option', { value: 'fork' }, '继承上下文'),
        ),
        h('button', {
          className: 'dnb-primary-btn',
          style: { height: 28, marginLeft: 'auto' },
          onClick: () => triggerDispatch(false),
        }, h(Icon, { name: 'play', size: 11 }), task.status === 'doing' ? '唤醒' : '派发'),
        unresolvedDeps.length > 0
          ? h('button', {
              className: 'dnb-pill',
              style: { height: 28 },
              title: '忽略前置依赖直接启动',
              onClick: () => triggerDispatch(true),
            }, '强制')
          : null,
        matchedAgent && matchedAgent.id
          ? h('button', {
              className: 'dnb-pill',
              style: { height: 28 },
              onClick: () => openSubagentChat(matchedAgent),
            }, h(Icon, { name: 'chat', size: 12 }), '对话')
          : null,
        task.status === 'doing' && assignedName
          ? h('button', {
              className: 'dnb-pill dnb-pill-danger',
              style: { height: 28, padding: '0 8px' },
              onClick: () => void act({ action: 'team.interrupt', id: task.id, agent: assignedName }),
            }, h(Icon, { name: 'stop', size: 11 }))
          : null,
      ),
      h(
        'div',
        { style: { display: 'flex', gap: 6, marginTop: 6 } },
        h('input', {
          className: 'dnb-input',
          style: { flex: 1, height: 28, padding: '0 10px', borderRadius: 99, fontSize: 11.5 },
          placeholder: '补充执行指令（回车发送）…',
          value: dispatchPrompt,
          onChange: e => setDispatchPrompt(e.target.value),
          onKeyDown: e => {
            if (e.key === 'Enter' && dispatchPrompt.trim()) {
              if (task.status === 'doing' && assignedName) {
                const msg = dispatchPrompt.trim()
                setDispatchPrompt('')
                void act({ action: 'team.steer', id: task.id, agent: assignedName, message: msg })
              } else {
                triggerDispatch(false)
              }
            }
          },
        }),
        assignedName && dispatchPrompt.trim()
          ? h('button', {
              className: 'dnb-pill dnb-pill-accent',
              style: { height: 28 },
              onClick: () => {
                const msg = dispatchPrompt.trim()
                setDispatchPrompt('')
                void act({ action: 'team.steer', id: task.id, agent: assignedName, message: msg })
              },
            }, '引导')
          : null,
      ),
    ),

    // Parent & Dependencies Pills
    h(
      'div',
      { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 } },
      h('select', {
        className: 'dnb-pill',
        style: { height: 24, padding: '0 8px', maxWidth: 150 },
        value: task.parentId || '',
        onChange: e => void act({ action: 'task.update', id: task.id, parentId: e.target.value }),
      },
        h('option', { value: '' }, '顶层节点'),
        allTasks
          .filter(t => t.id !== task.id)
          .map(t => h('option', { key: t.id, value: t.id }, '父级: ' + clampTitle(t.title, 10))),
      ),
      (board && Array.isArray(board.plan) && board.plan.length > 0)
        ? h(
            React.Fragment,
            null,
            h('select', {
              className: 'dnb-pill',
              style: { height: 24, padding: '0 8px', maxWidth: 146 },
              title: '该任务所属的推进步骤',
              value: task.planStepId || '',
              onChange: e => {
                patch({ editTaskPlanStepId: e.target.value })
                void act({ action: 'task.update', id: task.id, planStepId: e.target.value })
              },
            },
              h('option', { value: '' }, '步骤: 自动归位'),
              board.plan.map((s, idx) => h('option', { key: s.id, value: s.id }, `步骤 ${idx + 1}: ${clampTitle(s.text, 9)}`)),
            ),
            h('select', {
              className: 'dnb-pill',
              style: { height: 24, padding: '0 8px', maxWidth: 146 },
              title: '子代理或任务完成后回指的目标步骤',
              value: task.targetPlanStepId || '',
              onChange: e => {
                patch({ editTaskTargetPlanStepId: e.target.value })
                void act({ action: 'task.update', id: task.id, targetPlanStepId: e.target.value })
              },
            },
              h('option', { value: '' }, '回指: 同归属步'),
              board.plan.map((s, idx) => h('option', { key: s.id, value: s.id }, `回指 ${idx + 1}: ${clampTitle(s.text, 9)}`)),
            ),
          )
        : null,
      (task.blockedBy || []).map(depId => {
        const dep = byId.get(depId)
        const isDone = dep && dep.status === 'done'
        return h(
          'span',
          {
            key: depId,
            className: 'dnb-tag',
            style: {
              background: isDone ? STATUS_BG.done : 'rgba(245, 158, 11, 0.16)',
              color: isDone ? STATUS_HEX.done : '#fbbf24',
              padding: '2px 8px',
            },
          },
          (dep ? clampTitle(dep.title, 9) : depId.slice(-5)),
          h('span', {
            style: { cursor: 'pointer', marginLeft: 3, opacity: 0.75 },
            onClick: () => removeDep(depId),
          }, '×'),
        )
      }),
      h('select', {
        className: 'dnb-pill',
        style: { height: 24, padding: '0 8px', maxWidth: 118 },
        value: '',
        onChange: e => addDep(e.target.value),
      },
        h('option', { value: '' }, '+ 前置依赖'),
        allTasks
          .filter(t => t.id !== task.id && !(task.blockedBy || []).includes(t.id))
          .map(t => h('option', { key: t.id, value: t.id }, clampTitle(t.title, 11))),
      ),
    ),

    // Edit Form or Clean Summary
    editing
      ? h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 } },
          h('input', {
            className: 'dnb-input',
            placeholder: '标题',
            value: store.editTaskTitle,
            onChange: e => patch({ editTaskTitle: e.target.value }),
          }),
          h('input', {
            className: 'dnb-input',
            placeholder: '意图 (Intent)',
            value: store.editTaskIntent,
            onChange: e => patch({ editTaskIntent: e.target.value }),
          }),
          h('input', {
            className: 'dnb-input',
            placeholder: '验收依据 (Evidence)',
            value: store.editTaskEvidence,
            onChange: e => patch({ editTaskEvidence: e.target.value }),
          }),
          h('textarea', {
            className: 'dnb-area',
            placeholder: '备注',
            value: store.editTaskNote,
            onChange: e => patch({ editTaskNote: e.target.value }),
          }),
          h(
            'div',
            { style: { display: 'flex', gap: 6, justifyContent: 'flex-end' } },
            h('button', { className: 'dnb-pill', onClick: () => patch({ editTaskId: '' }) }, '取消'),
            h('button', { className: 'dnb-primary-btn', onClick: saveTask }, '保存'),
          ),
        )
      : h(
          'div',
          { style: { fontSize: 11.5, color: 'var(--dnb-text-2)', display: 'flex', flexDirection: 'column', gap: 3 } },
          task.intent ? h('div', null, '意图 · ' + task.intent) : null,
          task.evidence ? h('div', { style: { color: '#30d158' } }, '结论 · ' + task.evidence) : null,
          task.note ? h('div', null, task.note) : null,
        ),

    // Assumptions Checklist (shown when present or editing)
    (Array.isArray(task.assumptions) && task.assumptions.length > 0) || editing
      ? h(
          'div',
          { style: { marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--dnb-border)' } },
          (task.assumptions || []).map((assum, idx) =>
            h(
              'div',
              { key: idx, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 11.5 } },
              h('button', {
                className: 'dnb-ring',
                style: assum.verified ? { background: '#30d158', borderColor: '#30d158' } : { borderColor: '#f59e0b' },
                onClick: () => {
                  if (!assum.verified) void act({ action: 'task.verify', id: task.id, assumptionIndex: idx })
                },
              }, assum.verified ? h(Icon, { name: 'check', size: 10 }) : null),
              h('span', { style: assum.verified ? { textDecoration: 'line-through', opacity: 0.55 } : null }, assum.text),
            ),
          ),
          editing
            ? h(
                'div',
                { style: { display: 'flex', gap: 6, marginTop: 4 } },
                h('input', {
                  className: 'dnb-input',
                  style: { height: 26, fontSize: 11.5 },
                  placeholder: '添加待验证假设…',
                  value: newAssumption,
                  onChange: e => setNewAssumption(e.target.value),
                  onKeyDown: e => { if (e.key === 'Enter') addAssumption() },
                }),
                h('button', { className: 'dnb-pill', style: { height: 26 }, onClick: addAssumption }, '添加'),
              )
            : null,
        )
      : null,
  )
}

/* ------------------------------------------------------------ Tasks Tab */

function explainTaskMeaning(task, board) {
  if (!task) return
  const title = String(task.title || task.id || '').trim()
  const goalCtx = (board && board.objective) ? `（当前长期目标：${String(board.objective).slice(0, 90)}）` : ''
  const extraCtx = task.intent ? `\n补充已知意图：${task.intent}` : ''
  void askLeadModel(
    `请用通俗易懂的大白话给我解释一下任务节点「${title}」${goalCtx}：${extraCtx}\n1. 这条任务具体是什么意思？\n2. 为什么需要有这一步（它解决什么问题、在整体推进里起什么作用）？`,
    '咨询任务含义',
  )
}

function AddTask({ board }) {
  const [text, setText] = React.useState('')
  const [parentId, setParentId] = React.useState('')
  const [planStepId, setPlanStepId] = React.useState('')
  const [ownerPick, setOwnerPick] = React.useState('')
  const [customOwner, setCustomOwner] = React.useState('')
  const [blockedById, setBlockedById] = React.useState('')
  const allTasks = (board && Array.isArray(board.tasks)) ? board.tasks.filter(Boolean) : []
  const planSteps = (board && Array.isArray(board.plan)) ? board.plan.filter(Boolean) : []
  const openTasks = allTasks.filter(task => task.status !== 'done')
  const hier = buildAgentHierarchy(store.subagents, store.agentIdentity)
  const knownAgents = hier.children

  const resolvedOwner = ownerPick === '__custom__' ? customOwner.trim().replace(/^@/, '') : ownerPick.trim().replace(/^@/, '')

  const submit = () => {
    const title = text.trim()
    if (!title) return
    setText('')
    const args = { action: 'task.add', title }
    if (parentId) args.parentId = parentId
    if (planStepId) args.planStepId = planStepId
    if (resolvedOwner) {
      args.owner = resolvedOwner
      args.subagent = resolvedOwner
    }
    if (blockedById) args.blockedBy = [blockedById]
    setBlockedById('')
    void act(args)
  }

  return h(
    'div',
    { className: 'dnb-group', style: { padding: '9px 10px', marginBottom: 10 } },
    h(
      'div',
      { style: { display: 'flex', gap: 6, alignItems: 'center' } },
      h('input', {
        className: 'dnb-input',
        style: { borderRadius: 99, paddingLeft: 13, height: 32, flex: 1 },
        placeholder: '添加新任务或子目标（回车直接创建）…',
        value: text,
        onChange: e => setText(e.target.value),
        onKeyDown: e => { if (e.key === 'Enter') submit() },
      }),
      h('button', {
        className: 'dnb-primary-btn',
        style: { height: 32, padding: '0 12px', flexShrink: 0 },
        disabled: !text.trim(),
        onClick: submit,
      }, h(Icon, { name: 'plus', size: 12 }), '添加'),
    ),
    // All task association options laid out openly in one crisp row
    h(
      'div',
      { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 7 } },
      planSteps.length > 0
        ? h('select', {
            className: 'dnb-pill',
            style: { flex: '1 1 112px', height: 26, padding: '0 8px', fontSize: 11 },
            value: planStepId,
            title: '选择挂入哪个顺序推进步骤',
            onChange: e => setPlanStepId(e.target.value),
          },
            h('option', { value: '' }, '步骤：自动归入当前步'),
            planSteps.map((s, idx) => h('option', { key: s.id, value: s.id }, `步骤 ${idx + 1} · ${clampTitle(s.text, 12)}`)),
          )
        : null,
      h('select', {
        className: 'dnb-pill',
        style: { flex: '1 1 112px', height: 26, padding: '0 8px', fontSize: 11 },
        value: parentId,
        title: '选择挂载在哪个父级任务之下',
        onChange: e => setParentId(e.target.value),
      },
        h('option', { value: '' }, '父节点：顶层直属'),
        allTasks.map(t => h('option', { key: t.id, value: t.id }, '父级 · ' + clampTitle(t.title, 13))),
      ),
      h('select', {
        className: 'dnb-pill',
        style: { flex: '1 1 112px', height: 26, padding: '0 8px', fontSize: 11 },
        value: blockedById,
        title: '选择需要先完成的前置依赖任务',
        onChange: e => setBlockedById(e.target.value),
      },
        h('option', { value: '' }, '前置依赖：无'),
        openTasks.map(t => h('option', { key: t.id, value: t.id }, '等待 · ' + clampTitle(t.title, 13))),
      ),
      knownAgents.length > 0
        ? h('select', {
            className: 'dnb-pill',
            style: { flex: '1 1 110px', height: 26, padding: '0 8px', fontSize: 11 },
            value: ownerPick,
            title: '直接指派给现有子代理或自定义子代理',
            onChange: e => setOwnerPick(e.target.value),
          },
            h('option', { value: '' }, '指派：@主代理'),
            knownAgents.map(a => h('option', { key: a.name, value: a.name }, '指派：@' + shortAgentName(a.name, true))),
            h('option', { value: '__custom__' }, '+ 自定义新子代理…'),
          )
        : null,
      (knownAgents.length === 0 || ownerPick === '__custom__')
        ? h('input', {
            className: 'dnb-input',
            style: { flex: '1 1 100px', minWidth: 96, height: 26, borderRadius: 99, padding: '0 10px', fontSize: 11 },
            placeholder: '@指派子代理（选填）',
            value: knownAgents.length === 0 ? ownerPick : customOwner,
            onChange: e => knownAgents.length === 0 ? setOwnerPick(e.target.value) : setCustomOwner(e.target.value),
            onKeyDown: e => { if (e.key === 'Enter') submit() },
          })
        : null,
    ),
  )
}

function TaskRow({ task, board, depth = 0 }) {
  const next = STATUSES[(STATUSES.indexOf(task.status) + 1) % STATUSES.length]
  const isSelected = store.selectedTaskId === task.id
  const isFocused = store.focusTaskId === task.id
  const isDone = task.status === 'done'
  const isDoing = task.status === 'doing'
  const isBlocked = task.status === 'blocked'
  const color = STATUS_HEX[task.status] || STATUS_HEX.todo
  const rawAgent = task.subagent || task.owner || ''
  const showAgentTag = rawAgent && !GENERIC_OWNERS.has(String(rawAgent).toLowerCase())
  const stepIdx = (board && Array.isArray(board.plan) && task.planStepId)
    ? board.plan.findIndex(s => s && s.id === task.planStepId)
    : -1

  return h(
    'div',
    {
      className: 'dnb-cell dnb-cell-hover',
      style: {
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: 6,
        paddingLeft: 12 + depth * 18,
        background: isSelected
          ? 'var(--dnb-card-hover)'
          : isBlocked
            ? 'rgba(255, 69, 58, 0.05)'
            : isDoing
              ? 'rgba(10, 132, 255, 0.05)'
              : undefined,
        borderLeft: (isBlocked || isDoing) ? `3px solid ${color}` : '3px solid transparent',
      },
    },
    h(
      'div',
      { style: { display: 'flex', alignItems: 'flex-start', gap: 8, width: '100%' } },
      h(
        'button',
        {
          className: 'dnb-ring',
          style: {
            marginTop: 1,
            ...(isDone
              ? { background: color, borderColor: color }
              : {
                  borderColor: isDoing ? 'rgba(10, 132, 255, 0.34)' : color,
                  background: isDoing ? 'rgba(10, 132, 255, 0.10)' : isBlocked ? STATUS_BG.blocked : 'transparent',
                }),
          },
          title: '切换状态为 ' + STATUS_LABEL[next],
          onClick: e => {
            e.stopPropagation()
            void act({ action: 'task.update', id: task.id, status: next })
          },
        },
        isDone
          ? h(Icon, { name: 'check', size: 11 })
          : isDoing
            ? h('span', { className: 'dnb-spin-ring', style: { '--dnb-spin-size': '10px', color: '#409cff' } })
            : null,
      ),
      h(
        'div',
        {
          style: { flex: 1, minWidth: 0, cursor: 'pointer' },
          onClick: () => patch({ selectedTaskId: isSelected ? '' : task.id }),
        },
        h(
          'div',
          {
            style: {
              fontWeight: (isDoing || isBlocked) ? 600 : 500,
              fontSize: 12.5,
              lineHeight: 1.4,
              color: isDone ? 'var(--dnb-text-3)' : 'var(--dnb-text)',
              textDecoration: isDone ? 'line-through' : 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexWrap: 'wrap',
              wordBreak: 'break-word',
            },
          },
          task.title,
          stepIdx >= 0
            ? h('span', { className: 'dnb-tag' }, `步骤 ${stepIdx + 1}`)
            : null,
          showAgentTag
            ? h('span', { className: 'dnb-tag', style: { color: 'var(--dnb-accent)' } }, '@' + shortAgentName(rawAgent))
            : null,
        ),
        task.intent
          ? h('div', { style: { fontSize: 11, color: 'var(--dnb-text-2)', marginTop: 2 } }, '意图 · ' + task.intent)
          : null,
        task.evidence
          ? h('div', { style: { fontSize: 11, color: '#30d158', marginTop: 2 } }, '结论 · ' + task.evidence)
          : null,
        (Array.isArray(task.blockedBy) && task.blockedBy.length && !isDone)
          ? h('div', { style: { fontSize: 11, color: '#fbbf24', marginTop: 2 } }, '等待前置 ' + task.blockedBy.length + ' 项')
          : null,
      ),
      h(StatusBadge, { status: task.status }),
    ),
    // Laid-out status & action pills right inside list row too
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap', paddingLeft: 26 } },
      h(
        'div',
        { style: { display: 'flex', gap: 4, flexWrap: 'wrap' } },
        STATUSES.map(st =>
          h('button', {
            key: st,
            className: 'dnb-pyr-st-btn',
            'data-st': st,
            'data-active': task.status === st ? '1' : '0',
            onClick: e => {
              e.stopPropagation()
              if (task.status !== st) void act({ action: 'task.update', id: task.id, status: st })
            },
          }, st === 'done' ? '✓ 完成' : STATUS_LABEL[st]),
        ),
      ),
      h(
        'div',
        { style: { display: 'flex', gap: 4, flexWrap: 'wrap' } },
        h('button', {
          className: 'dnb-pyr-act-btn',
          'data-accent': '1',
          title: '让模型用大白话解释这条任务是什么意思、为什么需要这一步',
          onClick: e => { e.stopPropagation(); explainTaskMeaning(task, board) },
        }, h(Icon, { name: 'sparkles', size: 11 }), '解释'),
        h('button', {
          className: 'dnb-pyr-act-btn',
          title: '派发或唤醒子代理执行此任务',
          onClick: e => {
            e.stopPropagation()
            void act({
              action: 'task.dispatch',
              id: task.id,
              agent: task.subagent || task.owner || ('worker-' + String(task.id).slice(-4)),
            })
          },
        }, h(Icon, { name: 'play', size: 10.5 }), isDoing ? '唤醒' : '派发'),
        h('button', {
          className: 'dnb-pyr-act-btn',
          title: '在金字塔树中框选高亮负责推进此任务的代理',
          onClick: e => { e.stopPropagation(); focusObjectiveInPyramid(isFocused ? '' : task.id) },
        }, h(Icon, { name: 'target', size: 11 }), isFocused ? '取消框选' : '框选'),
        h('button', {
          className: 'dnb-pyr-act-btn',
          onClick: e => {
            e.stopPropagation()
            if (isSelected && store.editTaskId === task.id) {
              patch({ selectedTaskId: '', editTaskId: '' })
            } else {
              openTaskEditor(task)
            }
          },
        }, h(Icon, { name: 'edit', size: 11 }), isSelected ? '收起' : '编辑'),
        h('button', {
          className: 'dnb-pyr-act-btn',
          'data-danger': '1',
          onClick: e => {
            e.stopPropagation()
            if (store.selectedTaskId === task.id) patch({ selectedTaskId: '', editTaskId: '' })
            if (store.focusTaskId === task.id) patch({ focusTaskId: '' })
            void act({ action: 'task.remove', id: task.id })
          },
        }, h(Icon, { name: 'trash', size: 11 }), '删除'),
      ),
    ),
    isSelected ? h(TaskInspectorDrawer, { board, task }) : null,
  )
}

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

  // Build SVG Canvas Pyramid Coordinates (used when `viewMode === 'canvas'`)
  const layoutPyramidTree = () => {
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
        const badgeLabel = (isBlockedFocus ? '⚠ 受阻关联 · ' : '🎯 正在推进 · ')
          + (agentCount > 0 ? `${agentCount} 名子代理` : '主代理直管')
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
    patch({ notice: sent || '请在对话中让模型规划流程任务图' })
  }

  /* ---------------- Expandable Attention-First Organization Tree ---------------- */

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
                h('span', { className: 'dnb-flow-done-fold-hint' }, doneExpanded ? bi('收起 ▴', 'Fold ▴') : bi('拉起 ▾', 'Pull ▾')),
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
            title: detailOpen ? '点击收起详情' : '点击拉起任务详情与操作',
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
              title: '点击切换为 ' + (STATUS_LABEL[nextStatus] || nextStatus),
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
                title: '存在未完成前置依赖',
              }, `⏳${unresolvedDeps.length}`)
            : null,
          kids.length > 0
            ? h('span', { className: 'dnb-acc-count', style: { fontSize: 9.5 } }, bi(`${kids.length}子项`, `${kids.length} sub`))
            : null,
          h('span', { className: 'dnb-pyr-detail-pill' }, detailOpen ? bi('收起 ▴', 'Fold ▴') : bi('详情 ▾', 'Details ▾')),
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
                            }, '⏳ 等待前置：' + clampTitle(d.title || d.id, 14)),
                          ),
                          doneDeps.map(d =>
                            h('span', {
                              key: d.id,
                              className: 'dnb-tag',
                              style: { background: STATUS_BG.done, color: '#30d158', fontSize: 10.5 },
                            }, '✓ 前置就绪：' + clampTitle(d.title || d.id, 12)),
                          ),
                        )
                      : null,
                    task.intent ? h('div', { style: { fontSize: 11.5, color: 'var(--dnb-text-2)', lineHeight: 1.42, wordBreak: 'break-word' } }, '意图 · ' + task.intent) : null,
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
                  title: '让模型用通俗大白话解释这条任务',
                  onClick: () => explainTaskMeaning(task, board),
                }, h(Icon, { name: 'sparkles', size: 11 }), '解释'),
                h('button', {
                  type: 'button',
                  className: 'dnb-pyr-act-btn',
                  title: '派发或唤醒子代理推进此任务',
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
                      onClick: () => { if (!openSubagentChat(matchedAgent)) patch({ notice: '该子代理暂无独立会话面板' }) },
                    }, h(Icon, { name: 'chat', size: 11 }), '对话')
                  : null,
                h('button', {
                  type: 'button',
                  className: 'dnb-pyr-act-btn',
                  style: isFocusedTarget ? { borderColor: '#409cff', color: '#409cff', background: 'rgba(10,132,255,0.14)' } : undefined,
                  onClick: () => focusObjectiveInPyramid(isFocusedTarget ? '' : task.id),
                }, h(Icon, { name: 'target', size: 11 }), isFocusedTarget ? '已框选' : '框选'),
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
    const desc = agentObj.taskTitle || agentObj.description || (isRunning ? '正在推进分配任务…' : (directTasks.length ? `挂载 ${directTasks.length} 项任务` : '待命 / 已完成回报'))

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
            title: detailOpen ? '点击收起代理操作' : '点击拉起代理详情与指令按钮',
          },
          totalKids > 0
            ? h('button', {
                type: 'button',
                className: 'dnb-flow-mini-btn',
                style: { width: 18, height: 18, flexShrink: 0 },
                title: childrenOpen ? '收起下级子代理与任务' : `展开 ${totalKids} 个下级子节点`,
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
          h('span', { className: 'dnb-pyr-detail-pill' }, detailOpen ? bi('收起 ▴', 'Fold ▴') : bi('详情 ▾', 'Details ▾')),
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
                      title: bi('在分屏打开该子代理独立会话视图', 'Open split pane for subagent'),
                      onClick: () => {
                        if (!openSubagentChat(agentObj)) patch({ notice: bi('该子代理暂无独立会话视图', 'No dedicated view for this subagent') })
                      },
                    }, h(Icon, { name: 'chat', size: 11 }), bi('分屏对话', 'Split Chat'))
                  : null,
                h('button', {
                  type: 'button',
                  className: 'dnb-pyr-act-btn',
                  title: bi('锁定底部参谋长输入栏直接给该子代理递话或插话', 'Lock bottom input to steer/relay to this subagent'),
                  onClick: () => {
                    patch({
                      secTarget: agentObj.name,
                      secMode: isRunning ? 'steer' : 'followup',
                      notice: bi('已在下方锁定 @', 'Locked target @') + shortAgentName(agentObj.name, true) + bi('，输入指令回车即达', ', type instruction & Enter'),
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
                spotTone === 'blocked' ? '⚠ 受阻关联代理 · @' + shortAgentName(ag.name, true) : '🎯 正在推进 · @' + shortAgentName(ag.name, true),
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
                  title: groupOpen ? '收起直管任务' : `展开 ${leadDirectRoots.length} 项直管任务`,
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
                h('span', { style: { fontWeight: 700, fontSize: 12, color: 'var(--dnb-text)' } }, bi('主代理直管任务', 'Lead Direct Tasks')),
                h('span', { className: 'dnb-acc-count', style: { fontSize: 9.5 } }, bi(`${leadDirectRoots.length} 项`, `${leadDirectRoots.length}`)),
                h('span', { className: 'dnb-pyr-detail-pill' }, groupDetailOpen ? bi('收起 ▴', 'Fold ▴') : bi('操作 ▾', 'Actions ▾')),
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
                          patch({ secTarget: 'lead', secMode: 'steer', notice: bi('已在下方锁定 @主对话', 'Locked target @Lead') })
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
            ? (leadOpen ? bi('点击收起主代理下级任务与子代理', 'Collapse Lead tasks & subagents') : bi('点击展开主代理下级任务与子代理', 'Expand Lead tasks & subagents'))
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
                  title: leadOpen ? bi('收起组织树下级节点', 'Collapse org tree children') : bi('展开组织树下级节点', 'Expand org tree children'),
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
              ? h('span', { className: 'dnb-acc-count', style: { color: '#409cff' } }, bi(`${doingTotal} 推进`, `${doingTotal} doing`))
              : null,
            blockedTotal > 0
              ? h('span', { className: 'dnb-acc-count', style: { color: '#ff453a' } }, bi(`${blockedTotal} 受阻`, `${blockedTotal} blocked`))
              : null,
            doneTotal > 0
              ? h('span', { className: 'dnb-acc-count', style: { color: '#30d158' } }, bi(`${doneTotal}/${allTasks.length} 完`, `${doneTotal}/${allTasks.length} done`))
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
              title: bi('让主对话模型将目标拆解为任务图并调度子代理', 'Ask Lead model to decompose objective & dispatch subagents'),
              onClick: e => {
                e.stopPropagation()
                triggerAiPlanGraph()
              },
            }, h(Icon, { name: 'sparkles', size: 10.5 }), bi('拆解', 'Plan')),
            treeItems.length > 0
              ? h('span', { className: 'dnb-acc-pull-hint' }, leadOpen ? bi('收起 ▴', 'Fold ▴') : bi('拉起 ▾', 'Pull ▾'))
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

  /* ---------------- Optional SVG Zoom Canvas Renderers ---------------- */

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
        }, `+${node.hiddenAgents.length} 名空闲子代理`),
        h('text', {
          x: x + w / 2, y: y + 35,
          textAnchor: 'middle',
          fill: 'var(--dnb-accent, #0a84ff)',
          fontSize: 10,
        }, '点击展开全部'),
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
      const desc = ag.taskTitle || ag.description || (isRunning ? '正在执行任务…' : '待命 / 已完成')

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
      title: bi('可视化工作拓扑', 'Work Topology'),
      headTitle: topoCollapsed ? bi('点击拉起可视化工作拓扑（流程画布 / 组织树）', 'Expand work topology (Flow Canvas / Org Tree)') : bi('点击收起可视化工作拓扑', 'Collapse work topology'),
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
                    title: bi(`步骤 ${st.index}: ${st.title}（点击定位到下方任务板）`, `Step ${st.index}: ${st.title} (jump to board)`),
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
        ? h('span', { className: 'dnb-acc-badge', 'data-tone': 'accent' }, bi(`${runningAgentsCount} 代理`, `${runningAgentsCount} active`))
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
              title: bi('顺序推进流 + 子代理分支与回指箭头 SVG 流程画布', 'Sequential stages + subagent branches SVG flow canvas'),
              onClick: () => patch({ taskViewMode: 'canvas' }),
            }, bi('流程画布', 'Flow Canvas')),
            h('button', {
              type: 'button',
              className: 'dnb-seg-btn',
              style: { padding: '2px 8px', fontSize: 10.5 },
              'data-active': topoViewMode === 'graph' ? '1' : '0',
              title: bi('按主/子代理层级展开拉起的组织树', 'Expandable Lead / Subagent hierarchy tree'),
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
              (focusedTask.status === 'blocked' ? bi('已框选受阻关联代理：', 'Focused blocked agents: ') : bi('已框选正在推进的子代理：', 'Focused active subagents: '))
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
            }, bi('退出框选 ×', 'Unfocus ×')),
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
              }, isLR ? bi('横向流', 'Horizontal') : bi('竖向流', 'Vertical')),
              h(
                'div',
                { style: { display: 'flex', gap: 3, alignItems: 'center' } },
                h('button', { type: 'button', className: 'dnb-pill', style: { height: 22, padding: '0 7px' }, onClick: () => setZoom(z => Math.max(0.42, +(z - 0.12).toFixed(2))) }, '−'),
                h('button', { type: 'button', className: 'dnb-pill', style: { height: 22, padding: '0 7px', fontSize: 10.5 }, onClick: fitZoom, title: bi('点击自动适配当前宽度', 'Auto-fit canvas width') }, Math.round(zoom * 100) + '%'),
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
        : h('div', { className: 'dnb-topo-pyr-wrap' }, renderGrandPyramid())
      : h(
          'div',
          { className: 'dnb-empty', style: { padding: '14px 10px' } },
          h('div', { style: { marginBottom: 8 } }, bi('暂无推进流程或任务拓扑', 'No work topology or flow graph yet')),
          h('button', {
            type: 'button',
            className: 'dnb-pill dnb-pill-accent',
            onClick: triggerAiPlanGraph,
          }, h(Icon, { name: 'sparkles', size: 12 }), bi('让模型规划推进流程', 'Ask Lead to Plan Execution Flow')),
        ),
  )

  // ==================== Zone 3: Unified Progress Task Board (Merged Flow + Plan Board) ====================
  const renderUnifiedBoard = stepApi => {
    const taskMetaParts = []
    if (blockedTotal > 0) taskMetaParts.push(bi(`${blockedTotal} 受阻`, `${blockedTotal} blocked`))
    if (doingTotal > 0) taskMetaParts.push(bi(`${doingTotal} 推进`, `${doingTotal} active`))
    if (doneTotal > 0) taskMetaParts.push(bi(`${doneTotal} 已完`, `${doneTotal} done`))
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
        title: bi('推进任务板', 'Progress Task Board'),
        headTitle: boardCollapsed ? bi('点击拉起推进任务板', 'Expand Progress Task Board') : bi('点击收起推进任务板', 'Collapse Progress Task Board'),
        count: [planSteps.length > 0 ? bi(`${planDoneCount}/${planSteps.length} 步`, `${planDoneCount}/${planSteps.length} steps`) : '', taskCountLabel].filter(Boolean).join(' · '),
        actions: h(
          React.Fragment,
          null,
          h('button', {
            type: 'button',
            className: 'dnb-pill',
            'data-active': addTaskOpen ? '1' : '0',
            style: { height: 22, padding: '0 7px', fontSize: 10.5 },
            title: addTaskOpen ? bi('收起新增任务表单', 'Close add-task form') : bi('展开新增任务表单', 'Add new task'),
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
                title: expandAllStages ? bi('切回聚焦模式（自动折叠已完成与未开始步骤）', 'Switch back to focused mode') : bi('一键展开全部步骤', 'Expand all steps'),
                onClick: () => {
                  if (boardCollapsed) patch({ boardSectionCollapsed: false })
                  setExpandAllStages(v => !v)
                },
              }, expandAllStages ? bi('仅看聚焦', 'Focused') : bi('全展开', 'Expand All'))
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
          }, h(Icon, { name: 'target', size: 13 }), '框选负责代理'),
          h('div', {
            className: 'dnb-menu-item',
            style: { color: 'var(--dnb-accent)', fontWeight: 500 },
            onClick: () => {
              const t = contextMenu.task
              setContextMenu(null)
              explainTaskMeaning(t, board)
            },
          }, h(Icon, { name: 'sparkles', size: 13 }), '问含义与原因'),
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
          }, h(Icon, { name: 'play', size: 13 }), '派发子代理'),
          h('div', {
            className: 'dnb-menu-item',
            onClick: () => {
              const t = contextMenu.task
              setContextMenu(null)
              openTaskEditor(t)
            },
          }, h(Icon, { name: 'edit', size: 13 }), '编辑节点'),
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

/* ------------------------------------------------------------- Plan Tab */
