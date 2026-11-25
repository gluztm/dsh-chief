/**
 * src/client/tabs/tasks-widgets.js — 任务抽屉详情、快捷添加行与基础任务行组件
 *
 * 【核心职责】
 *   承载任务检验底部抽屉（`TaskInspectorDrawer`）、人类可读解释助手（`explainTaskMeaning`）、
 *   内联新增表单（`AddTask`）与任务列表行（`TaskRow`）。
 *
 * 【边界约定】
 *   - 只负责通用任务条目与编辑抽屉组件，不含金字塔组织树或顺序工作流拓扑。
 */

import { React, h } from '../react-runtime.js'
import { STATUSES, STATUS_LABEL, STATUS_HEX, STATUS_BG } from '../constants.js'
import { store, patch, openSubagentChat } from '../store.js'
import { clampTitle, shortAgentName, buildAgentHierarchy } from '../utils.js'
import { act, askLeadModel, openTaskEditor } from '../api.js'
import { Icon } from '../components/common.js'

export function TaskInspectorDrawer({ board, task }) {
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
          title: editing ? '取消修改' : '修改任务详情',
          'data-active': editing ? '1' : '0',
          onClick: () => editing ? patch({ editTaskId: '' }) : openTaskEditor(task),
        }, h(Icon, { name: 'edit', size: 13 })),
        h('button', {
          className: 'dnb-icon-btn',
          style: { color: '#ff453a' },
          title: '删掉这条任务',
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
          placeholder: '填子代理名称…',
          value: dispatchAgent,
          onChange: e => setDispatchAgent(e.target.value),
        }),
        h('select', {
          className: 'dnb-input',
          style: { width: 'auto', height: 28, padding: '0 8px', borderRadius: 99, fontSize: 11.5 },
          value: dispatchProvider,
          onChange: e => setDispatchProvider(e.target.value),
        },
          h('option', { value: 'spawn' }, '新建空白对话'),
          h('option', { value: 'fork' }, '带当前对话背景'),
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
              title: '不等前面做完，直接开始',
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
          placeholder: '补充要求，按回车发给它…',
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
            }, '发过去')
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
        h('option', { value: '' }, '最上层任务'),
        allTasks
          .filter(t => t.id !== task.id)
          .map(t => h('option', { key: t.id, value: t.id }, '属于: ' + clampTitle(t.title, 10))),
      ),
      (board && Array.isArray(board.plan) && board.plan.length > 0)
        ? h(
            React.Fragment,
            null,
            h('select', {
              className: 'dnb-pill',
              style: { height: 24, padding: '0 8px', maxWidth: 146 },
              title: '这条任务属于哪一步',
              value: task.planStepId || '',
              onChange: e => {
                patch({ editTaskPlanStepId: e.target.value })
                void act({ action: 'task.update', id: task.id, planStepId: e.target.value })
              },
            },
              h('option', { value: '' }, '步骤: 自动匹配'),
              board.plan.map((s, idx) => h('option', { key: s.id, value: s.id }, `步骤 ${idx + 1}: ${clampTitle(s.text, 9)}`)),
            ),
            h('select', {
              className: 'dnb-pill',
              style: { height: 24, padding: '0 8px', maxWidth: 146 },
              title: '做完后把结果交回哪一步',
              value: task.targetPlanStepId || '',
              onChange: e => {
                patch({ editTaskTargetPlanStepId: e.target.value })
                void act({ action: 'task.update', id: task.id, targetPlanStepId: e.target.value })
              },
            },
              h('option', { value: '' }, '交回: 当前这一步'),
              board.plan.map((s, idx) => h('option', { key: s.id, value: s.id }, `交回 ${idx + 1}: ${clampTitle(s.text, 9)}`)),
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
        h('option', { value: '' }, '+ 先等谁做完'),
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
            placeholder: '为什么要做（目的）',
            value: store.editTaskIntent,
            onChange: e => patch({ editTaskIntent: e.target.value }),
          }),
          h('input', {
            className: 'dnb-input',
            placeholder: '怎么才算做完（检查标准）',
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
          task.intent ? h('div', null, '目的 · ' + task.intent) : null,
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
                  placeholder: '加一条要确认的问题…',
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

export function explainTaskMeaning(task, board) {
  if (!task) return
  const title = String(task.title || task.id || '').trim()
  const goalCtx = (board && board.objective) ? `（当前长期目标：${String(board.objective).slice(0, 90)}）` : ''
  const extraCtx = task.intent ? `\n补充已知意图：${task.intent}` : ''
  void askLeadModel(
    `请用通俗易懂的大白话给我解释一下任务节点「${title}」${goalCtx}：${extraCtx}\n1. 这条任务具体是什么意思？\n2. 为什么需要有这一步（它解决什么问题、在整体推进里起什么作用）？`,
    '咨询任务含义',
  )
}

export function AddTask({ board }) {
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
        placeholder: '写下新任务，按回车加上…',
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
            title: '放到哪一步下面',
            onChange: e => setPlanStepId(e.target.value),
          },
            h('option', { value: '' }, '步骤：自动放到当前步'),
            planSteps.map((s, idx) => h('option', { key: s.id, value: s.id }, `步骤 ${idx + 1} · ${clampTitle(s.text, 12)}`)),
          )
        : null,
      h('select', {
        className: 'dnb-pill',
        style: { flex: '1 1 112px', height: 26, padding: '0 8px', fontSize: 11 },
        value: parentId,
        title: '作为哪个大任务的子任务',
        onChange: e => setParentId(e.target.value),
      },
        h('option', { value: '' }, '父级：最上层任务'),
        allTasks.map(t => h('option', { key: t.id, value: t.id }, '属于 · ' + clampTitle(t.title, 13))),
      ),
      h('select', {
        className: 'dnb-pill',
        style: { flex: '1 1 112px', height: 26, padding: '0 8px', fontSize: 11 },
        value: blockedById,
        title: '选一个要先做完的任务',
        onChange: e => setBlockedById(e.target.value),
      },
        h('option', { value: '' }, '先等谁：不用等'),
        openTasks.map(t => h('option', { key: t.id, value: t.id }, '等待 · ' + clampTitle(t.title, 13))),
      ),
      knownAgents.length > 0
        ? h('select', {
            className: 'dnb-pill',
            style: { flex: '1 1 110px', height: 26, padding: '0 8px', fontSize: 11 },
            value: ownerPick,
            title: '交给哪个子代理去做',
            onChange: e => setOwnerPick(e.target.value),
          },
            h('option', { value: '' }, '交给：@主对话'),
            knownAgents.map(a => h('option', { key: a.name, value: a.name }, '交给：@' + shortAgentName(a.name, true))),
            h('option', { value: '__custom__' }, '+ 新建子代理…'),
          )
        : null,
      (knownAgents.length === 0 || ownerPick === '__custom__')
        ? h('input', {
            className: 'dnb-input',
            style: { flex: '1 1 100px', minWidth: 96, height: 26, borderRadius: 99, padding: '0 10px', fontSize: 11 },
            placeholder: '@交给哪个子代理（选填）',
            value: knownAgents.length === 0 ? ownerPick : customOwner,
            onChange: e => knownAgents.length === 0 ? setOwnerPick(e.target.value) : setCustomOwner(e.target.value),
            onKeyDown: e => { if (e.key === 'Enter') submit() },
          })
        : null,
    ),
  )
}

