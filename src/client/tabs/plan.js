/**
 * tabs/plan.js
 *
 * Plan, Memory, Notes, and Handoff sub-tabs.
 */

import { React, h } from '../react-runtime.js'
import { DEFAULT_UI_SKIN, UI_SKIN_OPTIONS, EXPECTED_BACKEND_BUILD } from '../constants.js'
import { bi, getUiLangPref, presetList, chiefDisplayName } from '../i18n.js'
import { store, patch, savePlacementPref, saveUiSkin } from '../store.js'
import { clampTitle, shortSession, timeLabel } from '../utils.js'
import {
  call,
  updateSecConfig,
  applyScenarioPreset,
  loadArchives,
  approveGoalApi,
  rejectGoalApi,
  act,
  loadTargets,
  loadHandoff,
  saveHandoffCustom,
  toggleHandoffPin,
  resetHandoffAuto,
  requestTransferWithGuard,
  askLeadModel,
  copyText,
} from '../api.js'
import {
  fireChiefAlertNotification,
  getNotificationPermissionState,
  requestNotificationPermission,
} from '../notify.js'
import { buildSessionReportMarkdown, downloadSessionReportMarkdown } from '../report.js'
import { Icon, Switch, AccCard, renderStructuredText } from '../components/common.js'

export function PlanTab({
  board,
  topSlot = null,
  bentoMeta = null,
  taskTopologySlot = null,
  renderUnifiedBoard = null,
  onTriggerPlanGraph = null,
}) {
  const view = store
  const [objective, setObjective] = React.useState(null)
  const [editingGoal, setEditingGoal] = React.useState(false)
  const [contextMenu, setContextMenu] = React.useState(null)
  const [consultIdx, setConsultIdx] = React.useState(-1)
  const [consultDraft, setConsultDraft] = React.useState('')
  const [secAnswers, setSecAnswers] = React.useState({})
  const [secAskingIdx, setSecAskingIdx] = React.useState(-1)
  const [rejectingGoal, setRejectingGoal] = React.useState(false)
  const [rejectReason, setRejectReason] = React.useState('')
  const [showHandoffPreview, setShowHandoffPreview] = React.useState(false)

  React.useEffect(() => {
    void loadTargets()
  }, [view.sessionId])

  const savedObj = String((board && board.objective) || '').trim()
  const isInterventionLocked = Boolean(view.chiefMeta && view.chiefMeta.tacticalModes && view.chiefMeta.tacticalModes.intervention === true)
  const current = isInterventionLocked ? savedObj : (objective === null ? ((board && board.objective) || '') : objective)
  const steps = (board && Array.isArray(board.plan)) ? board.plan : []
  const doneCount = steps.filter(s => s && s.done).length
  const isGoalMode = (board && board.mode) === 'goal'
  const goalApproval = (board && board.goalApproval) || null

  const commitObjective = async (setGoal = false, resetStalePlan = false) => {
    const nextVal = String(current || '').trim()
    setObjective(null)
    patch({ planResetPrompt: null })
    const res = await act({
      action: 'objective.set',
      objective: nextVal,
      ...(setGoal ? { setGoalMode: true } : {}),
      ...(resetStalePlan ? { resetStalePlan: true } : {}),
    })
    if (res && res.ok) {
      patch({ notice: setGoal ? bi('已设为目标，会帮你盯着做完', 'Goal locked') : bi('目标已保存', 'Goal saved') })
    }
  }

  const saveObjective = () => {
    if (objective === null) return
    const nextVal = String(objective || '').trim()
    if (nextVal !== savedObj && steps.length > 0) {
      patch({ planResetPrompt: { text: nextVal, setGoal: false } })
      setObjective(null)
      return
    }
    void commitObjective(false, false)
  }

  const toggleGoalMode = () => {
    const cleanCurrent = String(current || '').trim()
    if (!isGoalMode) {
      if (!cleanCurrent) {
        patch({ error: '请先写好目标，再点设为目标' })
        return
      }
      if (cleanCurrent !== savedObj && steps.length > 0) {
        patch({ planResetPrompt: { text: cleanCurrent, setGoal: true } })
        setObjective(null)
        return
      }
      void commitObjective(true, false)
      return
    }
    void act({ action: 'mode.set', mode: 'plan' })
    patch({ notice: '已取消目标锁定，切回普通计划模式' })
  }

  const keepIds = list => list.map(s => (s && s.summary ? { id: s.id, text: s.text, done: s.done, summary: s.summary } : { id: s.id, text: s.text, done: s.done }))
  const pushSteps = next => void act({ action: 'plan.set', steps: next })

  const addStepWithText = rawText => {
    const text = String(rawText || '').trim()
    if (!text) return
    const next = keepIds(steps)
    next.push({ text, done: false })
    pushSteps(next)
  }

  const toggleStepDone = idx => {
    const next = keepIds(steps)
    if (!next[idx]) return
    next[idx] = { ...next[idx], done: !next[idx].done }
    pushSteps(next)
  }

  const buildExplainPrompt = (stepText, idx) => {
    const goalCtx = (current || '').trim() ? `（当前核心目标：${String(current).trim().slice(0, 90)}）` : ''
    return `请用通俗易懂的大白话给我解释一下小任务板第 ${idx + 1} 步「${String(stepText || '').slice(0, 80)}」${goalCtx}：\n1. 这条具体是什么意思？\n2. 为什么需要有这个步骤（它解决什么问题、不做会怎样）？`
  }

  const askStepViaChief = async (idx, stepText, customQuestion = '') => {
    setSecAskingIdx(idx)
    try {
      const goalCtx = (current || '').trim() ? `当前核心目标：「${String(current).trim().slice(0, 100)}」。` : ''
      const q = customQuestion
        ? `${goalCtx}针对小任务板第 ${idx + 1} 步「${String(stepText || '').slice(0, 90)}」，用户咨询：${customQuestion}。请结合当前会话上下文，用通俗简明的分点大白话直接解答（不要派活或改状态）。`
        : `${goalCtx}请结合当前会话上下文，用通俗易懂的分点大白话向用户解释小任务板第 ${idx + 1} 步「${String(stepText || '').slice(0, 90)}」：1) 这句话是什么意思；2) 为什么要有这一步；3) 目前这一步做到了什么程度或结论。`
      const out = await call('chief/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session: store.sessionId, text: q }),
      })
      const reply = (out && (out.reply || out.answer || out.text)) || '暂时查不到更多资料，点「问主对话」让 AI 直接回答。'
      setSecAnswers(prev => ({ ...prev, [idx]: reply }))
    } catch (error) {
      patch({ error: String((error && error.message) || error) })
    } finally {
      setSecAskingIdx(-1)
    }
  }

  const renderStepConsult = (i, stepObj = null) => {
    const step = steps[i] || (stepObj ? { text: stepObj.title, done: stepObj.done } : null)
    if (!step) return null
    const isConsulting = consultIdx === i
    const secReply = secAnswers[i] || ''
    const isSecAsking = secAskingIdx === i
    if (!isConsulting && !isSecAsking && !secReply) return null

    return h(
      React.Fragment,
      null,
      isConsulting
        ? h(
            'div',
            {
              style: {
                padding: '8px 10px',
                marginTop: 7,
                borderRadius: 10,
                background: 'var(--dnb-accent-soft, rgba(159, 142, 255, 0.08))',
                border: '1px solid var(--dnb-border-strong)',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              },
              onClick: e => e.stopPropagation(),
            },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' } },
              [
                { label: '这条是什么意思？', q: '这条具体是什么意思？请用通俗大白话解释一下。' },
                { label: '为什么要有这步？', q: '为什么需要有这个步骤？它在整体方案里解决什么问题？' },
                { label: step.done ? '具体改了什么？' : '目前卡在哪？', q: step.done ? '这一步具体查出了什么结论、做了什么修改？' : '这一步目前进展到哪了，有没有卡点？' },
              ].map((preset, pi) =>
                h('button', {
                  key: pi,
                  type: 'button',
                  className: 'dnb-sec-chip',
                  style: { fontSize: 10.5, height: 21, padding: '0 7px' },
                  onClick: () => {
                    const goalCtx = (current || '').trim() ? `（长期目标：${String(current).trim().slice(0, 80)}）` : ''
                    void askLeadModel(
                      `关于小任务板第 ${i + 1} 步「${String(step.text || '').slice(0, 80)}」${goalCtx}：${preset.q}`,
                      '咨询小任务步骤',
                    )
                    setConsultIdx(-1)
                  },
                }, preset.label),
              ),
            ),
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 5 } },
              h('input', {
                className: 'dnb-input',
                style: { flex: 1, height: 27, fontSize: 11.5 },
                autoFocus: true,
                placeholder: '写下你对这一步的疑问，回车问主对话…',
                value: consultDraft,
                onChange: e => setConsultDraft(e.target.value),
                onKeyDown: e => {
                  if (e.key === 'Enter' && consultDraft.trim()) {
                    e.preventDefault()
                    const q = consultDraft.trim()
                    setConsultDraft('')
                    setConsultIdx(-1)
                    void askLeadModel(
                      `关于小任务板第 ${i + 1} 步「${String(step.text || '').slice(0, 80)}」：${q}`,
                      '咨询小任务步骤',
                    )
                  } else if (e.key === 'Escape') {
                    setConsultIdx(-1)
                  }
                },
              }),
              h('button', {
                type: 'button',
                className: 'dnb-primary-btn',
                style: { height: 27, padding: '0 9px', fontSize: 11, flexShrink: 0 },
                disabled: !consultDraft.trim(),
                onClick: () => {
                  const q = consultDraft.trim()
                  if (!q) return
                  setConsultDraft('')
                  setConsultIdx(-1)
                  void askLeadModel(
                    `关于小任务板第 ${i + 1} 步「${String(step.text || '').slice(0, 80)}」：${q}`,
                    '咨询小任务步骤',
                  )
                },
              }, '问主对话'),
              h('button', {
                type: 'button',
                className: 'dnb-pill',
                style: { height: 27, padding: '0 8px', fontSize: 11, flexShrink: 0, color: 'var(--dnb-accent)' },
                disabled: isSecAsking,
                title: '不打断主对话，让参谋长直接在下面解释',
                onClick: () => {
                  const q = consultDraft.trim()
                  setConsultDraft('')
                  setConsultIdx(-1)
                  void askStepViaChief(i, step.text, q)
                },
              }, isSecAsking ? '解答中…' : '✦ 问参谋长'),
            ),
          )
        : null,
      (isSecAsking || secReply)
        ? h(
            'div',
            {
              style: {
                padding: '8px 10px',
                marginTop: 7,
                borderRadius: 9,
                background: 'rgba(128, 128, 136, 0.08)',
                border: '1px solid var(--dnb-border)',
                fontSize: 11.5,
                color: 'var(--dnb-text-2)',
                lineHeight: 1.5,
              },
              onClick: e => e.stopPropagation(),
            },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 } },
              h('span', { style: { fontSize: 10.5, fontWeight: 600, color: 'var(--dnb-accent)' } },
                isSecAsking ? '✦ 参谋长正在查资料准备解释…' : '✦ 参谋长解释'),
              !isSecAsking
                ? h('button', {
                    type: 'button',
                    className: 'dnb-icon-btn',
                    style: { width: 18, height: 18 },
                    title: '收起解释',
                    onClick: () => setSecAnswers(prev => {
                      const copy = { ...prev }
                      delete copy[i]
                      return copy
                    }),
                  }, h(Icon, { name: 'x', size: 11 }))
                : null,
            ),
            isSecAsking ? null : renderStructuredText(secReply),
          )
        : null,
    )
  }

  const stepApi = {
    consultIdx,
    secAskingIdx,
    secAnswers,
    onToggleStep: toggleStepDone,
    onExplainStep: (i, stepTitle) => void askLeadModel(buildExplainPrompt(stepTitle || (steps[i] && steps[i].text) || '', i), '咨询步骤含义'),
    onConsultStep: i => {
      setConsultIdx(consultIdx === i ? -1 : i)
      setConsultDraft('')
    },
    onOpenStepMenu: (i, x, y) => setContextMenu({ stepIndex: i, x, y }),
    onAppendStep: addStepWithText,
    renderStepConsult,
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

  const objCollapsed = Boolean(view.planObjCollapsed)
  const handoffCollapsed = view.handoffSectionCollapsed !== false

  return h(
    'div',
    { className: 'dnb-view' },
    topSlot || null,

    // ==================== Zone 1: Route C Apple Bento Objective & Ring Hero ====================
    (() => {
      const hasGoalText = Boolean((current || '').trim())
      const showTextarea = !isInterventionLocked && (editingGoal || !hasGoalText)
      const totalSteps = bentoMeta ? Number(bentoMeta.totalSteps || 0) : steps.length
      const doneSteps = bentoMeta ? Number(bentoMeta.doneSteps || 0) : doneCount
      const totalTasks = bentoMeta ? Number(bentoMeta.totalTasks || 0) : 0
      const doneTasks = bentoMeta ? Number(bentoMeta.doneTasks || 0) : 0
      const blockedTasks = bentoMeta ? Number(bentoMeta.blockedTasks || 0) : 0
      const runningAgents = bentoMeta ? Number(bentoMeta.runningAgents || 0) : 0
      const ratio = totalSteps > 0
        ? doneSteps / totalSteps
        : (totalTasks > 0 ? doneTasks / totalTasks : 0)
      const pct = Math.max(0, Math.min(100, Math.round(ratio * 100)))
      const ringRadius = 25
      const ringCircumference = +(2 * Math.PI * ringRadius).toFixed(2)
      const ringOffset = +(ringCircumference * (1 - pct / 100)).toFixed(2)
      const ringColor = pct >= 100
        ? 'var(--dnb-sage)'
        : (blockedTasks > 0 ? 'var(--dnb-coral)' : 'var(--dnb-accent)')
      const activeStage = bentoMeta && bentoMeta.activeStage ? bentoMeta.activeStage : null

      return h(
        'div',
        {
          className: 'dnb-obj-card dnb-bento-hero',
          'data-locked': (isInterventionLocked || isGoalMode) ? '1' : '0',
          'data-collapsed': objCollapsed ? '1' : '0',
        },
        // Left Tile: Core Objective + Clean Text/Edit Toggle + Quick Actions
        h(
          'div',
          { className: 'dnb-bento-goal' },
          h(
            'div',
            { className: 'dnb-bento-goal-head' },
            h(
              'div',
              {
                className: 'dnb-bento-head-left',
                style: { cursor: 'pointer' },
                title: objCollapsed ? bi('展开完整 Bento 目标卡', 'Expand Bento goal card') : bi('收起上方详情', 'Collapse card'),
                onClick: () => patch({ planObjCollapsed: !objCollapsed }),
              },
              h(Icon, {
                name: 'chevron',
                size: 12,
                style: {
                  color: 'var(--dnb-text-3)',
                  transform: objCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                  transition: 'transform 0.16s ease',
                  flexShrink: 0,
                },
              }),
              h('span', { className: 'dnb-bento-title' }, bi('核心目标', 'Core Objective')),
              !objCollapsed && board && board.objectiveAt && objective === null
                ? h('span', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', flexShrink: 0 } }, timeLabel(board.objectiveAt))
                : null,
              isInterventionLocked
                ? h('span', { className: 'dnb-acc-badge', 'data-tone': 'amber' }, h(Icon, { name: 'lock', size: 10 }), bi('已锁定', 'Locked'))
                : null,
              isGoalMode
                ? h('span', { className: 'dnb-acc-badge', 'data-tone': 'amber' }, h(Icon, { name: 'target', size: 10 }), bi('盯着做', 'Goal On'))
                : null,
            ),
            h(
              'div',
              { className: 'dnb-bento-head-ops', onClick: e => e.stopPropagation() },
              h('button', {
                type: 'button',
                className: 'dnb-pill',
                style: { height: 22, padding: '0 7px', fontSize: 10.5, gap: 4 },
                title: bi('导出整理好的任务报告 (.md)', 'Export clean task report (.md)'),
                onClick: () => {
                  const md = buildSessionReportMarkdown({
                    board,
                    secView: view.secView,
                    chiefMeta: view.chiefMeta,
                    subagents: view.subagents,
                    guardWalls: view.guardWalls,
                    sessionId: view.sessionId,
                  })
                  const dl = downloadSessionReportMarkdown(md, view.sessionId)
                  if (dl && dl.ok) {
                    patch({ notice: bi('已导出任务报告：', 'Exported report: ') + dl.filename })
                  } else {
                    copyText(md, bi('任务报告已复制到剪贴板', 'Report copied to clipboard'))
                  }
                },
              }, h(Icon, { name: 'fileText', size: 11 }), bi('战报', 'Report')),
              h('button', {
                type: 'button',
                className: 'dnb-pill',
                style: {
                  height: 22,
                  padding: '0 8px',
                  fontSize: 10.5,
                  gap: 4,
                  borderColor: isGoalMode ? 'var(--dnb-amber)' : 'var(--dnb-border-strong)',
                  background: isGoalMode ? 'var(--dnb-amber-soft)' : 'var(--dnb-accent-soft)',
                  color: isGoalMode ? 'var(--dnb-amber)' : 'var(--dnb-accent)',
                  fontWeight: 500,
                },
                title: isGoalMode
                  ? bi('取消目标锁定，切回普通模式', 'Exit goal mode')
                  : bi('设为目标后参谋会盯着做，最后由你确认结束', 'Lock goal; ends only after your approval'),
                onClick: toggleGoalMode,
              }, h(Icon, { name: 'target', size: 11 }), isGoalMode ? bi('退出目标', 'Exit Goal') : bi('设为目标', 'Set Goal')),
              h('button', {
                type: 'button',
                className: 'dnb-pill dnb-pill-accent',
                style: { height: 22, padding: '0 8px', fontSize: 10.5, gap: 4 },
                title: bi('按目标让主对话拆成步骤，再派给子代理做', 'Break goal into steps and assign subagents'),
                onClick: () => {
                  if (typeof onTriggerPlanGraph === 'function') {
                    onTriggerPlanGraph(current)
                    return
                  }
                  const goalText = (current || '').trim()
                  const prompt = (goalText ? `针对长期目标「${goalText.slice(0, 100)}」，` : '')
                    + '请先调用 chief_board 的 plan.set 定好一二三四五顺序推进步骤，再用 graph.plan（填入对应 planStepId 与可选 targetPlanStepId）和 task.dispatch 将就绪节点并行派发给子代理团队。'
                  void askLeadModel(prompt, '拆解任务图')
                  patch({ tab: 'tasks' })
                },
              }, h(Icon, { name: 'sparkles', size: 11 }), bi('拆成步骤', 'Break Down')),
            ),
          ),
          !objCollapsed
            ? h(
                React.Fragment,
                null,
                showTextarea
                  ? h('textarea', {
                      className: 'dnb-bare-area dnb-bento-textarea',
                      style: { minHeight: 46 },
                      autoFocus: editingGoal,
                      placeholder: bi('写下你想实现的目标，点右上「设为目标」后由参谋盯着推进…', 'Write your goal, then click "Set Goal"…'),
                      value: current,
                      onChange: e => { if (!isInterventionLocked) setObjective(e.target.value) },
                      onBlur: () => {
                        setEditingGoal(false)
                        if (!isInterventionLocked) saveObjective()
                      },
                      onKeyDown: e => {
                        if (!isInterventionLocked && (e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                          e.preventDefault()
                          setEditingGoal(false)
                          saveObjective()
                        } else if (e.key === 'Escape') {
                          setEditingGoal(false)
                        }
                      },
                    })
                  : h(
                      'div',
                      {
                        className: 'dnb-bento-goal-text',
                        title: isInterventionLocked ? bi('强介入开启时目标已锁定', 'Goal locked during intervention') : bi('点击可直接修改目标', 'Click to edit goal'),
                        onClick: () => {
                          if (!isInterventionLocked) setEditingGoal(true)
                        },
                      },
                      hasGoalText ? current : bi('还没设置目标，点击这里写下…', 'No objective set — click to write…'),
                    ),
                (isInterventionLocked || isGoalMode || objective !== null || hasGoalText)
                  ? h(
                      'div',
                      { className: 'dnb-bento-goal-foot' },
                      (isInterventionLocked || isGoalMode)
                        ? h('span', { style: { fontSize: 11, color: 'var(--dnb-amber)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 4 } },
                            h(Icon, { name: isInterventionLocked ? 'lock' : 'target', size: 11 }),
                            isInterventionLocked
                              ? bi('强介入中目标已锁，关掉强介入可修改', 'Locked during strong intervention')
                              : bi('正在盯着做完，好了请你点确认', 'Monitoring until your final sign-off'))
                        : h('span', { style: { fontSize: 11, color: 'var(--dnb-text-3)' } },
                            showTextarea ? bi('失焦或 Ctrl+Enter 保存', 'Blur or Ctrl+Enter to save') : bi('点击正文可修改目标', 'Click text to edit')),
                      h(
                        'div',
                        { style: { display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 } },
                        isInterventionLocked
                          ? h('button', {
                              type: 'button',
                              className: 'dnb-pill',
                              style: { height: 21, padding: '0 8px', fontSize: 10.5, borderColor: 'var(--dnb-amber)', color: 'var(--dnb-amber)' },
                              title: bi('关掉强介入后就能改目标', 'Turn off intervention to unlock goal'),
                              onClick: () => void updateSecConfig({ emergencyStopIntervention: true }),
                            }, bi('关掉强介入并解锁', 'Stop & Unlock'))
                          : (!showTextarea
                              ? h('button', {
                                  type: 'button',
                                  className: 'dnb-text-filter-btn',
                                  style: { fontSize: 10.5, gap: 3 },
                                  onClick: () => setEditingGoal(true),
                                }, h(Icon, { name: 'edit', size: 10.5 }), bi('修改', 'Edit'))
                              : null),
                        !isInterventionLocked && objective !== null
                          ? h('button', {
                              type: 'button',
                              className: 'dnb-pill dnb-pill-accent',
                              style: { height: 21, padding: '0 8px', fontSize: 10.5 },
                              onClick: () => {
                                setEditingGoal(false)
                                saveObjective()
                              },
                            }, bi('保存', 'Save'))
                          : null,
                        hasGoalText
                          ? h('button', {
                              type: 'button',
                              className: 'dnb-text-filter-btn',
                              style: { fontSize: 10.5 },
                              title: bi('用大白话讲讲这个目标卡在哪、怎么做', 'Explain this goal in plain words'),
                              onClick: () => {
                                void askLeadModel(
                                  `请用通俗易懂的大白话给我解释一下当前核心目标「${String(current).trim().slice(0, 120)}」：核心卡点是什么、整体打算怎么解决？`,
                                  '咨询核心目标',
                                )
                              },
                            }, bi('解释目标', 'Explain'))
                          : null,
                      ),
                    )
                  : null,
              )
            : h('div', { className: 'dnb-bento-collapsed-preview' }, hasGoalText ? clampTitle(String(current).trim(), 48) : bi('还没填目标', 'No goal yet')),
        ),

        // Right Tile: Animated Progress Ring + Active Focus Pill + Quick Mode Switch
        !objCollapsed && bentoMeta
          ? h(
              'div',
              { className: 'dnb-bento-ring-tile' },
              h(
                'div',
                { className: 'dnb-bento-ring-top' },
                h(
                  'div',
                  { className: 'dnb-bento-ring-wrap' },
                  h(
                    'svg',
                    { className: 'dnb-bento-ring', width: 62, height: 62, viewBox: '0 0 62 62', 'aria-label': `${pct}%` },
                    h('circle', {
                      cx: 31,
                      cy: 31,
                      r: ringRadius,
                      fill: 'none',
                      stroke: 'var(--dnb-border-strong)',
                      strokeWidth: 4.5,
                    }),
                    h('circle', {
                      cx: 31,
                      cy: 31,
                      r: ringRadius,
                      fill: 'none',
                      stroke: ringColor,
                      strokeWidth: 4.5,
                      strokeLinecap: 'round',
                      strokeDasharray: String(ringCircumference),
                      strokeDashoffset: String(ringOffset),
                      transform: 'rotate(-90 31 31)',
                      style: { transition: 'stroke-dashoffset 0.45s cubic-bezier(0.22, 1, 0.36, 1), stroke 0.25s ease' },
                    }),
                  ),
                  h(
                    'div',
                    { className: 'dnb-bento-ring-val' },
                    h('span', { className: 'dnb-bento-ring-num' }, String(pct)),
                    h('span', { className: 'dnb-bento-ring-pct' }, '%'),
                  ),
                ),
                h(
                  'div',
                  { className: 'dnb-bento-stats' },
                  h('div', { className: 'dnb-bento-stat-main' },
                    totalSteps > 0
                      ? bi(`已完成 ${doneSteps} / ${totalSteps} 步`, `${doneSteps} / ${totalSteps} steps`)
                      : bi(`已完成 ${doneTasks} / ${totalTasks} 项`, `${doneTasks} / ${totalTasks} tasks`),
                  ),
                  h(
                    'div',
                    { className: 'dnb-bento-stat-sub' },
                    [
                      totalTasks > 0 ? bi(`${totalTasks} 子任务`, `${totalTasks} tasks`) : '',
                      runningAgents > 0 ? bi(`${runningAgents} 代理在忙`, `${runningAgents} agents`) : '',
                      blockedTasks > 0 ? bi(`${blockedTasks} 卡住`, `${blockedTasks} blocked`) : '',
                    ].filter(Boolean).join(' · ') || bi('按步骤稳步推进', 'Stepping cleanly'),
                  ),
                  activeStage
                    ? h('button', {
                        type: 'button',
                        className: 'dnb-bento-focus-pill',
                        title: bi('定位到当前步骤', 'Jump to active step'),
                        onClick: () => bentoMeta.onJumpActive && bentoMeta.onJumpActive(activeStage.id),
                      },
                        h('span', { className: 'dnb-bento-focus-dot' }),
                        h('span', { className: 'dnb-bento-focus-txt' }, `${bi('第', 'Step ')}${activeStage.index}${bi('步 · ', ' · ')}${clampTitle(activeStage.title, 18)}`),
                      )
                    : (pct === 100 && (totalSteps > 0 || totalTasks > 0)
                        ? h('span', { className: 'dnb-bento-focus-pill', 'data-done': '1' }, h(Icon, { name: 'check', size: 10.5 }), bi('全部步骤已完成', 'All steps done'))
                        : null),
                ),
              ),
              h(
                'div',
                { className: 'dnb-bento-ring-foot' },
                h(
                  'span',
                  { className: 'dnb-bento-foot-hint' },
                  runningAgents > 0
                    ? bi(`${runningAgents} 个子代理并发推进中`, `${runningAgents} subagents active`)
                    : (totalSteps > 0
                        ? bi('点击下方流光节点查看子代理与详情', 'Click any node below for branches & details')
                        : bi('写下目标后点击「拆成步骤」或手动加步', 'Write goal then click Break Down')),
                ),
              ),
            )
          : null,
      )
    })(),

    // Inline Stale Plan Reset Prompt when Objective changed and old steps exist
    view.planResetPrompt
      ? h(
          'div',
          {
            className: 'dnb-group',
            style: {
              marginTop: 8,
              padding: '8px 10px',
              borderColor: 'var(--dnb-amber)',
              background: 'var(--dnb-amber-soft)',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            },
          },
          h('div', { style: { fontSize: 11.5, color: 'var(--dnb-text)', fontWeight: 500 } },
            `你改了目标，下面还有 ${steps.length} 条旧步骤：`),
          h(
            'div',
            { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
            h('button', {
              type: 'button',
              className: 'dnb-mini-btn',
              'data-tone': 'amber',
              onClick: () => void commitObjective(Boolean(view.planResetPrompt.setGoal), true),
            }, '删掉旧步骤重来'),
            h('button', {
              type: 'button',
              className: 'dnb-mini-btn',
              'data-tone': 'accent',
              onClick: () => void commitObjective(Boolean(view.planResetPrompt.setGoal), false),
            }, '保留旧步骤并保存'),
            h('button', {
              type: 'button',
              className: 'dnb-mini-btn',
              onClick: () => patch({ planResetPrompt: null }),
            }, '取消'),
          ),
        )
      : null,

    // Pending Goal Completion Human Approval Card
    (goalApproval && goalApproval.status === 'pending')
      ? h(
          'div',
          { className: 'dnb-goal-approval-card', style: { marginTop: 10 } },
          h('div', { style: { fontSize: 12, fontWeight: 600, color: 'var(--dnb-sage)', display: 'flex', alignItems: 'center', gap: 5 } },
            h(Icon, { name: 'target', size: 13 }),
            bi('参谋长觉得目标完成了，等你确认结束', 'Chief believes the goal is complete — awaiting approval')),
          goalApproval.summary
            ? h('div', { style: { fontSize: 11.5, color: 'var(--dnb-text)', lineHeight: 1.5 } }, goalApproval.summary)
            : null,
          goalApproval.evidence
            ? h('div', {
                style: {
                  padding: '6px 8px',
                  borderRadius: 7,
                  background: 'var(--dnb-card)',
                  border: '1px solid var(--dnb-border)',
                  fontSize: 11,
                  color: 'var(--dnb-text-2)',
                  whiteSpace: 'pre-wrap',
                },
              }, '检查结果：' + goalApproval.evidence)
            : null,
          rejectingGoal
            ? h(
                'div',
                { style: { display: 'flex', gap: 5, marginTop: 2 } },
                h('input', {
                  className: 'dnb-input',
                  style: { height: 26, fontSize: 11.5, flex: 1 },
                  placeholder: '写下哪里不满意，或补充新要求…',
                  value: rejectReason,
                  onChange: e => setRejectReason(e.target.value),
                  onKeyDown: e => {
                    if (e.key === 'Enter' && rejectReason.trim()) {
                      void rejectGoalApi(rejectReason).then(() => {
                        setRejectingGoal(false)
                        setRejectReason('')
                      })
                    }
                  },
                }),
                h('button', {
                  type: 'button',
                  className: 'dnb-primary-btn',
                  style: { height: 26, padding: '0 9px', fontSize: 11 },
                  disabled: view.busy || !rejectReason.trim(),
                  onClick: () => void rejectGoalApi(rejectReason).then(() => {
                    setRejectingGoal(false)
                    setRejectReason('')
                  }),
                }, '退回重做'),
                h('button', {
                  type: 'button',
                  className: 'dnb-pill',
                  style: { height: 26, padding: '0 8px', fontSize: 11 },
                  onClick: () => setRejectingGoal(false),
                }, '取消'),
              )
            : h(
                'div',
                { style: { display: 'flex', gap: 6, marginTop: 2 } },
                h('button', {
                  type: 'button',
                  className: 'dnb-primary-btn',
                  style: { height: 26, padding: '0 11px', fontSize: 11.5, background: 'var(--dnb-sage)', color: '#0d1915', fontWeight: 600, gap: 4 },
                  disabled: view.busy,
                  onClick: () => void approveGoalApi(),
                }, h(Icon, { name: 'check', size: 11 }), bi('批准结项', 'Approve')),
                h('button', {
                  type: 'button',
                  className: 'dnb-pill',
                  style: { height: 26, padding: '0 9px', fontSize: 11.5, gap: 4 },
                  onClick: () => {
                    setRejectingGoal(true)
                    setRejectReason('')
                  },
                }, h(Icon, { name: 'refresh', size: 11 }), bi('退回继续', 'Return')),
              ),
        )
      : null,

    // ==================== Zone 2: Collapsible Visual Work Topology ====================
    taskTopologySlot || null,

    // ==================== Zone 3: Unified Progress Task Board ====================
    typeof renderUnifiedBoard === 'function' ? renderUnifiedBoard(stepApi) : null,

    // ==================== Zone 4: Collapsible Cross-Session Handoff & Chief Deployment ====================
    (() => {
      const targets = Array.isArray(view.targets) ? view.targets : []
      const options = [{ id: 'new', label: '新开一个窗口，把参谋带过去' }].concat(
        targets
          .filter(item => item && item.id !== view.sessionId)
          .map(item => ({
            id: item.id,
            label: [item.name || shortSession(item.id), timeLabel(item.lastSeen)].filter(Boolean).join(' · '),
          })),
      )
      const target = options.some(i => i.id === view.target) ? view.target : 'new'
      const policy = view.deployArchivePolicy || 'none'
      const drawers = Array.isArray(view.archiveFolders) ? view.archiveFolders : []
      const handoffObj = (board && board.handoff) || {}
      const hMeta = view.handoffMeta || {}
      const isPinned = Boolean(handoffObj.pinned || hMeta.pinned)
      const isCustom = Boolean((handoffObj.customText && handoffObj.customText.trim()) || hMeta.isCustom)
      const hSource = isCustom ? (handoffObj.source || hMeta.source || 'human') : 'auto'
      const sourceBadge = hSource === 'human'
        ? { label: bi('你改过', 'Edited'), tone: 'accent' }
        : hSource === 'chief'
          ? { label: bi('参谋已更新', 'Chief updated'), tone: 'green' }
          : { label: bi('自动生成', 'Auto'), tone: undefined }

      const buildTransferOpts = () => ({
        deployChief: true,
        archiveTransferPolicy: policy,
        archiveDrawer: policy === 'drawer' ? (view.deployDrawer || (drawers[0] && drawers[0].id) || 'inbox') : '',
      })

      return h(
        AccCard,
        {
          open: !handoffCollapsed,
          onToggle: () => patch({ handoffSectionCollapsed: !handoffCollapsed }),
          className: 'dnb-handoff-card',
          title: h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } },
            h(Icon, { name: 'workflow', size: 12.5, style: { color: 'var(--dnb-amber)' } }),
            bi('换新窗口接着做', 'Continue in New Window')),
          headTitle: handoffCollapsed ? bi('展开换窗口交接设置', 'Expand handoff options') : bi('收起交接设置', 'Collapse handoff options'),
          bodyStyle: { padding: 10, display: 'flex', flexDirection: 'column', gap: 8 },
          badges: h('span', {
            className: 'dnb-tag',
            style: {
              fontSize: 10,
              background: sourceBadge.tone === 'accent'
                ? 'var(--dnb-accent-soft)'
                : sourceBadge.tone === 'green'
                  ? 'var(--dnb-sage-soft)'
                  : undefined,
              color: sourceBadge.tone === 'accent'
                ? 'var(--dnb-accent)'
                : sourceBadge.tone === 'green'
                  ? 'var(--dnb-sage)'
                  : 'var(--dnb-text-3)',
            },
          }, sourceBadge.label),
          actions: h('button', {
            type: 'button',
            className: 'dnb-mini-btn',
            'data-tone': isPinned ? 'amber' : undefined,
            title: isPinned
              ? bi('已定住，更新不会盖掉你的修改；再点解锁', 'Pinned: updates keep your edits; click to unpin')
              : bi('定住后，自动更新不会覆盖你的内容', 'Stop auto updates from overwriting your edits'),
            onClick: () => void toggleHandoffPin(!isPinned),
          }, h(Icon, { name: 'pin', size: 10.5 }), isPinned ? bi('已定住', 'Pinned') : bi('定住防改', 'Pin')),
        },
        h(
          'div',
          { style: { fontSize: 11, color: 'var(--dnb-text-2)' } },
          bi('选要带去新窗口的档案。模型和规则会一起同步，强介入默认关闭保安全：', 'Pick archives to bring along. Settings sync too, with intervention off:'),
        ),
        h(
          'div',
          { style: { display: 'flex', gap: 4, flexWrap: 'wrap' } },
          [
            { key: 'none', label: bi('不带档案', 'No archives') },
            { key: 'mounted', label: bi('只带认知桌面的资料', 'Cognitive desktop only') },
            { key: 'drawer', label: bi('带选中的分类抽屉', 'Selected folder') },
            { key: 'all', label: bi('带本窗口全部档案', 'All window archives') },
          ].map(p =>
            h('button', {
              key: p.key,
              type: 'button',
              className: 'dnb-mini-btn',
              'data-tone': policy === p.key ? 'accent' : undefined,
              onClick: () => {
                patch({ deployArchivePolicy: p.key })
                if (p.key === 'drawer' && !view.archiveLoaded) void loadArchives(false)
              },
            }, p.label),
          ),
        ),
        policy === 'drawer'
          ? h('select', {
              className: 'dnb-input',
              style: { height: 28, padding: '0 9px', borderRadius: 9, fontSize: 11.5 },
              value: view.deployDrawer || ((drawers[0] && drawers[0].id) || 'inbox'),
              onChange: e => patch({ deployDrawer: e.target.value }),
            }, drawers.length
              ? drawers.map(d => h('option', { key: d.id, value: d.id }, `${d.label} (${d.count || 0} 份)`))
              : [h('option', { key: 'inbox', value: 'inbox' }, '未分类收件箱（加载中…）')])
          : null,
        h(
          'div',
          { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
          h('button', {
            type: 'button',
            className: 'dnb-primary-btn',
            style: { flex: 1, height: 30, fontSize: 11.5, gap: 5 },
            disabled: Boolean(view.handoffBusy),
            onClick: () => void requestTransferWithGuard('create', buildTransferOpts()),
          }, h(Icon, { name: 'workflow', size: 12 }), bi('新开窗口接着做', 'Open New Window & Continue')),
          h('button', {
            type: 'button',
            className: 'dnb-pill',
            style: { height: 30, padding: '0 10px', fontSize: 11.5 },
            disabled: Boolean(view.handoffBusy),
            onClick: async () => {
              const text = store.handoffText || (await loadHandoff())?.text || ''
              if (text) copyText(text, bi('交接单已复制', 'Handoff copied'))
            },
          }, h(Icon, { name: 'copy', size: 12 }), bi('复制交接单', 'Copy Handoff')),
        ),
        h(
          'div',
          { style: { display: 'flex', gap: 6 } },
          h('select', {
            className: 'dnb-input',
            style: { flex: 1, height: 28, padding: '0 10px', borderRadius: 99, fontSize: 11.5 },
            value: target,
            onChange: e => patch({ target: e.target.value }),
          }, options.map(i => h('option', { key: i.id, value: i.id }, i.label))),
          h('button', {
            type: 'button',
            className: 'dnb-pill dnb-pill-accent',
            style: { height: 28, padding: '0 10px', fontSize: 11.5 },
            disabled: Boolean(view.handoffBusy),
            onClick: () => void requestTransferWithGuard(target === 'new' ? 'create' : target, buildTransferOpts()),
          }, '发到选中窗口'),
        ),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 5 } },
            h('button', {
              type: 'button',
              className: 'dnb-mini-btn',
              'data-tone': view.handoffEditing ? 'accent' : undefined,
              onClick: async () => {
                if (view.handoffEditing) {
                  patch({ handoffEditing: false })
                  return
                }
                const res = await loadHandoff()
                const curText = (res && res.text) || store.handoffText || ''
                patch({ handoffEditing: true, handoffDraft: curText })
                setShowHandoffPreview(false)
              },
            }, view.handoffEditing ? bi('收起编辑', 'Done') : h(React.Fragment, null, h(Icon, { name: 'edit', size: 10.5 }), bi('修改交接单', 'Edit Handoff'))),
            h('button', {
              type: 'button',
              className: 'dnb-mini-btn',
              onClick: () => {
                const nextShow = !showHandoffPreview
                setShowHandoffPreview(nextShow)
                if (nextShow) void loadHandoff()
              },
            }, showHandoffPreview ? '收起预览' : '预览交接单'),
            isCustom
              ? h('button', {
                  type: 'button',
                  className: 'dnb-mini-btn',
                  title: '放弃你的修改，改回自动生成',
                  onClick: () => void resetHandoffAuto(),
                }, '↺ 改回自动生成')
              : null,
          ),
          view.transferNote
            ? h('span', { style: { fontSize: 11, color: 'var(--dnb-text-3)' } }, view.transferNote)
            : null,
        ),
        view.handoffEditing
          ? h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 2 } },
              h('textarea', {
                className: 'dnb-input',
                rows: 8,
                style: {
                  width: '100%',
                  fontSize: 11.5,
                  lineHeight: 1.5,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  resize: 'vertical',
                  padding: '8px 10px',
                },
                value: view.handoffDraft || '',
                placeholder: '在这里改交接单（支持 Markdown）。点下方「保存并定住」就不怕被覆盖…',
                onChange: e => patch({ handoffDraft: e.target.value }),
              }),
              h(
                'div',
                { style: { display: 'flex', justifyContent: 'flex-end', gap: 6, flexWrap: 'wrap' } },
                h('button', {
                  type: 'button',
                  className: 'dnb-pill',
                  style: { height: 26, padding: '0 10px', fontSize: 11 },
                  onClick: () => patch({ handoffEditing: false }),
                }, '取消'),
                h('button', {
                  type: 'button',
                  className: 'dnb-pill dnb-pill-accent',
                  style: { height: 26, padding: '0 10px', fontSize: 11 },
                  onClick: () => void saveHandoffCustom(view.handoffDraft, false),
                }, '保存修改'),
                h('button', {
                  type: 'button',
                  className: 'dnb-primary-btn',
                  style: { height: 26, padding: '0 11px', fontSize: 11, background: 'var(--dnb-amber)', color: '#181410', fontWeight: 600, gap: 4 },
                  onClick: () => void saveHandoffCustom(view.handoffDraft, true),
                }, h(Icon, { name: 'pin', size: 11 }), bi('保存并定住', 'Save & Pin')),
              ),
            )
          : null,
        showHandoffPreview && !view.handoffEditing
          ? h('pre', { className: 'dnb-pre', style: { maxHeight: 170, marginTop: 2 } }, view.handoffText || '加载中…')
          : null,
      )
    })(),

    // Upgraded Step Consultation & Action Context Menu
    contextMenu && contextMenu.stepIndex !== undefined
      ? (() => {
          const idx = contextMenu.stepIndex
          const s = steps[idx]
          const stepTitle = String((s && s.text) || '').slice(0, 80)
          const isDone = Boolean(s && s.done)
          return h(
            'div',
            {
              className: 'dnb-menu',
              style: {
                minWidth: 214,
                left: Math.min(contextMenu.x, (typeof window !== 'undefined' ? window.innerWidth : 800) - 226),
                top: Math.min(contextMenu.y, (typeof window !== 'undefined' ? window.innerHeight : 600) - 240),
              },
            },
            h('div', {
              className: 'dnb-menu-item',
              style: { color: 'var(--dnb-accent)', fontWeight: 600 },
              onClick: () => {
                setContextMenu(null)
                void askLeadModel(buildExplainPrompt(stepTitle, idx), '咨询步骤含义')
              },
            }, h(Icon, { name: 'sparkles', size: 13 }), '这条是什么意思 / 为什么有这步'),
            h('div', {
              className: 'dnb-menu-item',
              onClick: () => {
                setContextMenu(null)
                void askStepViaChief(idx, stepTitle)
              },
            }, '✦ 让参谋长解释（不打断主对话）'),
            h('div', {
              className: 'dnb-menu-item',
              onClick: () => {
                setContextMenu(null)
                setConsultIdx(idx)
                setConsultDraft('')
              },
            }, '💬 对这一步随便提问…'),
            h('div', {
              className: 'dnb-menu-item',
              style: { borderTop: '1px solid var(--dnb-border)', marginTop: 3, paddingTop: 6 },
              onClick: () => {
                setContextMenu(null)
                const q = isDone
                  ? `小任务板第 ${idx + 1} 步「${stepTitle}」已标记完成，请简明告诉我这一步具体查出了什么结论、改了哪里？`
                  : `小任务板第 ${idx + 1} 步「${stepTitle}」目前进展如何，有没有遇到卡点？`
                void askLeadModel(q, '询问步骤进展')
              },
            }, isDone ? '问这一步改了什么' : '问这一步做到哪了'),
            isDone
              ? h('div', {
                  className: 'dnb-menu-item',
                  onClick: () => {
                    setContextMenu(null)
                    const next = keepIds(steps)
                    next[idx] = { ...next[idx], done: false }
                    pushSteps(next)
                  },
                }, '改回未完成')
              : h('div', {
                  className: 'dnb-menu-item',
                  onClick: () => {
                    setContextMenu(null)
                    void askLeadModel(
                      `请核验小任务板第 ${idx + 1} 步「${stepTitle}」是否已完成，若已完成请勾选并记录验证依据。`,
                      '核验勾选步骤',
                    )
                  },
                }, '让 AI 检查并标完成'),
            h('div', {
              className: 'dnb-menu-item',
              style: { color: '#ff453a', borderTop: '1px solid var(--dnb-border)', marginTop: 3, paddingTop: 6 },
              onClick: () => {
                setContextMenu(null)
                const next = keepIds(steps)
                next.splice(idx, 1)
                pushSteps(next)
              },
            }, '删除步骤'),
          )
        })()
      : null,
  )
}

/* -------------------------------------- Settings & Configuration Tab (设置页) */

export function HandoffTab({ view }) {
  const meta = view.chiefMeta || {}
  const ledger = (view.secView && view.secView.llmLedger) || meta.llmLedgerSummary || {}
  const byCat = ledger.byCategory || {}
  const mr = ledger.managedRun || {}

  const [appearanceOpen, setAppearanceOpen] = React.useState(true)
  const [presetsOpen, setPresetsOpen] = React.useState(true)
  const [placementOpen, setPlacementOpen] = React.useState(true)
  const [safetyOpen, setSafetyOpen] = React.useState(false)
  const [notifyOpen, setNotifyOpen] = React.useState(false)
  const [ledgerOpen, setLedgerOpen] = React.useState(() => Boolean(mr.tripped))
  const [guardPrefOpen, setGuardPrefOpen] = React.useState(false)
  const [notifPerm, setNotifPerm] = React.useState(() => getNotificationPermissionState())
  const [callsDraft, setCallsDraft] = React.useState(null)
  const savedChiefName = String(
    (view.chiefMeta && view.chiefMeta.chiefName) || '',
  ).trim()
  const [chiefNameDraft, setChiefNameDraft] = React.useState(savedChiefName)

  React.useEffect(() => {
    setChiefNameDraft(savedChiefName)
  }, [savedChiefName])

  React.useEffect(() => {
    void loadTargets()
  }, [view.sessionId])

  React.useEffect(() => {
    if (mr.tripped) setLedgerOpen(true)
  }, [mr.tripped])

  const perm = meta.permissionMode || 'advisor'
  const rm = meta.runMode || 'off'
  const activePreset = (perm === 'advisor' && rm === 'off')
    ? 'observer'
    : ((perm === 'strategist' && rm === 'patrol')
        ? 'collab'
        : ((perm === 'chief' && rm === 'managed') ? 'away' : ''))

  const presets = presetList()
  const maxCalls = Number(meta.managedBudgetMaxCalls ?? (ledger.budget && ledger.budget.maxCalls) ?? 30)
  const maxTokens = Number(meta.managedBudgetMaxTokens ?? (ledger.budget && ledger.budget.maxTokens) ?? 300000)

  const fmtTok = (n) => {
    const val = Math.max(0, Math.round(Number(n) || 0))
    if (val >= 1_000_000) return (val / 1_000_000).toFixed(2).replace(/\.00$/, '') + 'M'
    if (val >= 1_000) return (val / 1_000).toFixed(1).replace(/\.0$/, '') + 'K'
    return String(val)
  }

  const callsPct = maxCalls > 0 ? Math.min(100, Math.round(((mr.calls || 0) / maxCalls) * 100)) : 0
  const tokensPct = maxTokens > 0 ? Math.min(100, Math.round(((mr.tokens || 0) / maxTokens) * 100)) : 0
  const uiLangVal = view.uiLangPref || meta.uiLang || getUiLangPref()
  const langSummary = uiLangVal === 'en' ? 'English' : (uiLangVal === 'zh' ? '简体中文' : bi('自动', 'Auto'))
  const notifPermLabel = notifPerm === 'granted'
    ? bi('已允许通知', 'Allowed')
    : notifPerm === 'denied'
      ? bi('浏览器已屏蔽', 'Blocked')
      : notifPerm === 'default'
        ? bi('待授权', 'Prompt')
        : bi('仅面板内提醒', 'In-Panel Only')

  const commitCallsCap = () => {
    if (callsDraft === null) return
    const raw = Math.max(0, Math.round(Number(callsDraft) || 0))
    const val = raw === 0 ? 0 : Math.min(500, Math.max(3, raw))
    setCallsDraft(null)
    void updateSecConfig({ managedBudgetMaxCalls: val })
  }

  const placementPref = (view && view.placementPref) || { placement: 'both', showComposerEntry: true, showCornerTrigger: true, hideInSubagent: true, subagentOpenMode: 'tab' }
  const placementMode = placementPref.placement || 'both'
  const subOpenMode = placementPref.subagentOpenMode === 'split' ? 'split' : 'tab'
  const globalSafetyOn = meta.globalSafetyGuardEnabled !== false
  const sessionSafetyOn = meta.sessionSafetyGuardEnabled !== false
  const effectiveSafetyOn = Boolean(globalSafetyOn && sessionSafetyOn && (!meta.tacticalModes || meta.tacticalModes.safetyGuardEnabled !== false))
  const placementLabel = placementMode === 'topTab'
    ? bi('仅主页面', 'Main Tab Only')
    : (placementMode === 'sidebar' ? bi('仅右侧栏', 'Sidebar Only') : bi('右侧栏 + 主页面', 'Sidebar + Main Tab'))

  const curSkin = (view && view.uiSkin) || DEFAULT_UI_SKIN
  const curSkinObj = UI_SKIN_OPTIONS.find(o => o.key === curSkin) || UI_SKIN_OPTIONS[0]

  return h(
    React.Fragment,
    null,
    // 1. Appearance, Chief Name & Language (Default Expanded)
    h(
      AccCard,
      {
        open: appearanceOpen,
        onToggle: () => setAppearanceOpen(v => !v),
        tone: 'violet',
        icon: h(Icon, { name: 'palette', size: 13.5, style: { color: 'var(--dnb-accent)' } }),
        title: bi('外观与基础', 'Appearance & Basics'),
        badges: h(
          React.Fragment,
          null,
          h('span', { className: 'dnb-acc-badge', 'data-tone': 'accent' }, bi(curSkinObj.zh, curSkinObj.en)),
          h('span', { className: 'dnb-acc-badge' }, 'v' + EXPECTED_BACKEND_BUILD),
        ),
        preview: `${chiefDisplayName(view)} · ${langSummary}`,
        bodyStyle: { padding: '8px 11px 10px', display: 'flex', flexDirection: 'column', gap: 10 },
      },
      // Chief Name
      h(
        'div',
        null,
        h('div', { style: { fontSize: 11.5, fontWeight: 500, color: 'var(--dnb-text-2)', marginBottom: 5 } },
          bi('参谋长称呼（对主对话 0 字节隔离，全局生效）', 'Chief Name (global across workspaces, 0-byte isolated)')),
        h(
          'div',
          { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
          h('input', {
            className: 'dnb-input',
            style: { flex: 1, minWidth: 150, height: 28, fontSize: 12 },
            maxLength: 24,
            placeholder: bi('起个专属名字（如：哈基米、贾维斯）…', 'Name your Chief (e.g. Hakimi, Jarvis)…'),
            value: chiefNameDraft,
            onChange: e => setChiefNameDraft(e.target.value),
            onKeyDown: e => {
              if (e.key === 'Enter') {
                void updateSecConfig({ chiefName: chiefNameDraft.trim() })
              }
            },
          }),
          h('button', {
            type: 'button',
            className: 'dnb-primary-btn',
            style: { height: 28, padding: '0 10px', fontSize: 11 },
            onClick: () => void updateSecConfig({ chiefName: chiefNameDraft.trim() }),
          }, bi('保存', 'Save')),
          savedChiefName
            ? h('button', {
                type: 'button',
                className: 'dnb-pill',
                style: { height: 28, padding: '0 9px', fontSize: 11 },
                onClick: () => {
                  setChiefNameDraft('')
                  void updateSecConfig({ chiefName: '' })
                },
              }, bi('恢复默认', 'Reset'))
            : null,
        ),
      ),
      // 5 UI Skins
      h(
        'div',
        { style: { paddingTop: 8, borderTop: '1px solid var(--dnb-border)' } },
        h('div', { style: { fontSize: 11.5, fontWeight: 500, color: 'var(--dnb-text-2)', marginBottom: 6 } },
          bi('视觉主题（深浅宿主全自动适配）', 'UI Theme (adapts to dark & light hosts)')),
        h(
          'div',
          { className: 'dnb-skin-grid' },
          UI_SKIN_OPTIONS.map(opt => {
            const isCur = curSkin === opt.key
            return h(
              'button',
              {
                key: opt.key,
                type: 'button',
                className: 'dnb-skin-card',
                'data-active': isCur ? '1' : '0',
                onClick: () => {
                  saveUiSkin(opt.key)
                  patch({ notice: bi('已切换视觉主题：', 'Theme switched to: ') + bi(opt.zh, opt.en) })
                },
              },
              h(
                'div',
                { className: 'dnb-skin-card-head' },
                h('span', { className: 'dnb-skin-card-name' }, bi(opt.zh, opt.en)),
                h(
                  'div',
                  { className: 'dnb-skin-swatches' },
                  opt.swatches.map(hex =>
                    h('span', { key: hex, className: 'dnb-skin-swatch-dot', style: { background: hex } })),
                ),
              ),
              h('div', { className: 'dnb-skin-card-tag' }, bi(opt.tagZh, opt.tagEn)),
              h('div', { className: 'dnb-skin-card-desc' }, bi(opt.descZh, opt.descEn)),
            )
          }),
        ),
      ),
      // Interface Language
      h(
        'div',
        { style: { paddingTop: 8, borderTop: '1px solid var(--dnb-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' } },
        h('span', { style: { fontSize: 11.5, fontWeight: 500, color: 'var(--dnb-text-2)' } },
          bi('界面语言 / Language', 'Interface Language / 语言')),
        h(
          'div',
          { className: 'dnb-seg', style: { padding: 2 } },
          [
            { key: 'auto', label: bi('自动 Auto', 'Auto') },
            { key: 'zh', label: '简体中文' },
            { key: 'en', label: 'English' },
          ].map(opt =>
            h('button', {
              key: opt.key,
              type: 'button',
              className: 'dnb-seg-btn',
              style: { padding: '4px 9px', fontSize: 11 },
              'data-active': uiLangVal === opt.key ? '1' : '0',
              onClick: () => void updateSecConfig({ uiLang: opt.key }),
            }, opt.label),
          ),
        ),
      ),
    ),

    // 2. Scenario Presets (Default Expanded)
    h(
      AccCard,
      {
        open: presetsOpen,
        onToggle: () => setPresetsOpen(v => !v),
        tone: 'cyan',
        title: bi('常用场景预设', 'Scenario Presets'),
        badges: h('span', { className: 'dnb-acc-badge', 'data-tone': activePreset ? 'accent' : undefined },
          activePreset
            ? (presets.find(p => p.id === activePreset)?.title || activePreset)
            : bi('自定义', 'Custom')),
        preview: presets.map(p => p.title).join(' / '),
        bodyStyle: { padding: 0 },
      },
      h(
        'div',
        { className: 'dnb-preset-grid' },
        presets.map(p => {
          const isCur = activePreset === p.id
          return h(
            'button',
            {
              key: p.id,
              type: 'button',
              className: 'dnb-preset-card',
              'data-active': isCur ? '1' : '0',
              title: p.desc,
              onClick: () => void applyScenarioPreset(p.id),
            },
            h('div', { className: 'dnb-preset-title' }, h('span', null, p.icon), h('span', null, p.title)),
            h('span', { className: 'dnb-preset-tag' }, p.tag),
            h('div', { className: 'dnb-preset-desc' }, p.desc),
          )
        }),
      ),
    ),

    // 3. Panel Placement Mode & Session Opt-In (Default Expanded)
    h(
      AccCard,
      {
        open: placementOpen,
        onToggle: () => setPlacementOpen(v => !v),
        tone: 'indigo',
        icon: h(Icon, { name: 'sidebarRight', size: 13.5, style: { color: 'var(--dnb-accent)' } }),
        title: bi('面板显示位置与会话开关', 'Placement & Session Opt-In'),
        badges: h('span', { className: 'dnb-acc-badge', 'data-tone': 'accent' }, placementLabel),
        preview: bi('主页面 / 右侧栏与新会话自动启用控制', 'Main tab vs sidebar and per-session opt-in'),
        bodyStyle: { padding: '8px 11px 10px' },
      },
      h(
        'div',
        { className: 'dnb-seg', style: { padding: 2, marginBottom: 8 } },
        [
          { key: 'both', label: bi('右侧栏 + 主页面', 'Sidebar + Main Tab') },
          { key: 'topTab', label: bi('仅主页面', 'Main Tab Only') },
          { key: 'sidebar', label: bi('仅右侧栏', 'Sidebar Only') },
        ].map(opt =>
          h('button', {
            key: opt.key,
            type: 'button',
            className: 'dnb-seg-btn',
            style: { padding: '4px 8px', fontSize: 11.5 },
            'data-active': placementMode === opt.key ? '1' : '0',
            onClick: () => {
              savePlacementPref({ placement: opt.key })
              patch({ notice: bi('已切换显示位置：', 'Updated placement: ') + opt.label })
            },
          }, opt.label),
        ),
      ),
      h(
        'div',
        { className: 'dnb-cell', style: { justifyContent: 'space-between', padding: '7px 2px' } },
        h('span', { style: { fontSize: 12 } }, bi('输入框旁保留参谋长快捷按钮', 'Keep shortcut button next to composer')),
        h(Switch, {
          checked: placementPref.showComposerEntry !== false,
          onChange: on => savePlacementPref({ showComposerEntry: on }),
        }),
      ),
      h(
        'div',
        { className: 'dnb-cell', style: { justifyContent: 'space-between', padding: '7px 2px' } },
        h('span', { style: { fontSize: 12 } }, bi('右下角保留浮动快捷按钮', 'Keep floating corner button')),
        h(Switch, {
          checked: placementPref.showCornerTrigger !== false,
          onChange: on => savePlacementPref({ showCornerTrigger: on }),
        }),
      ),
      h(
        'div',
        { className: 'dnb-cell', style: { justifyContent: 'space-between', padding: '7px 2px' } },
        h('span', { style: { fontSize: 12 } }, bi('子代理窗口隐藏参谋长页面', 'Hide Chief view in subagent sessions')),
        h(Switch, {
          checked: placementPref.hideInSubagent !== false,
          onChange: on => savePlacementPref({ hideInSubagent: on }),
        }),
      ),
      h(
        'div',
        { className: 'dnb-cell', style: { justifyContent: 'space-between', padding: '7px 2px', gap: 8 } },
        h('span', { style: { fontSize: 12 } }, bi('子代理对话打开方式', 'Open subagent chat in')),
        h(
          'div',
          { className: 'dnb-seg', style: { padding: 2, flexShrink: 0 } },
          [
            { key: 'tab', label: bi('现有栏加页签', 'Sidebar Tab') },
            { key: 'split', label: bi('新开分屏', 'New Split Pane') },
          ].map(opt =>
            h('button', {
              key: opt.key,
              type: 'button',
              className: 'dnb-seg-btn',
              style: { padding: '3px 8px', fontSize: 11 },
              'data-active': subOpenMode === opt.key ? '1' : '0',
              onClick: () => {
                savePlacementPref({ subagentOpenMode: opt.key })
                patch({ notice: bi('已切换子代理打开方式：', 'Subagent open mode: ') + opt.label })
              },
            }, opt.label),
          ),
        ),
      ),
      view && view.sessionId
        ? h(
            'div',
            { className: 'dnb-cell', style: { justifyContent: 'space-between', padding: '7px 2px', gap: 8 } },
            h('div', { style: { minWidth: 0 } },
              h('div', { style: { fontSize: 12 } }, bi('本会话启用参谋长', 'Enable Chief for this session')),
              h('div', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', marginTop: 1 } },
                bi('关闭后本会话恢复普通聊天窗口，不提示也不自动拦截', 'When off, this chat runs clean with no prompts or safety blocking')),
            ),
            h(Switch, {
              checked: meta.sessionEnabled !== false,
              onChange: on => void updateSecConfig({ sessionEnabled: on }),
            }),
          )
        : null,
      h(
        'div',
        { className: 'dnb-cell', style: { justifyContent: 'space-between', padding: '7px 2px', gap: 8 } },
        h('div', { style: { minWidth: 0 } },
          h('div', { style: { fontSize: 12 } }, bi('新会话默认自动启用参谋长', 'Auto-enable Chief in new sessions')),
          h('div', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', marginTop: 1 } },
            bi('默认关闭：只有你点过开启或用过参谋功能的对话，才会启用参谋和安全拦截', 'Off by default: Chief and Safety Block only turn on when you enable or use them')),
        ),
        h(Switch, {
          checked: Boolean(meta.defaultAutoEnableSessions),
          onChange: on => void updateSecConfig({ defaultAutoEnableSessions: on }),
        }),
      ),
      h(
        'div',
        { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', lineHeight: 1.45, marginTop: 4 } },
        bi('切到主页面后可在对话顶部直接大屏切换，修改立即生效无需重启。', 'Switching placement updates the conversation top tab and sidebar immediately without restart.'),
      ),
    ),

    // 4. Built-in Safety Block Toggles (Default Collapsed)
    h(
      AccCard,
      {
        open: safetyOpen,
        onToggle: () => setSafetyOpen(v => !v),
        tone: 'rose',
        icon: h(Icon, { name: effectiveSafetyOn ? 'shieldCheck' : 'shieldOff', size: 13.5, style: { color: effectiveSafetyOn ? 'var(--dnb-sage)' : 'var(--dnb-coral)' } }),
        title: bi('安全拦截（自动防误操作）', 'Safety Block (Auto Protection)'),
        badges: h('span', { className: 'dnb-acc-badge', 'data-tone': effectiveSafetyOn ? 'green' : 'red' },
          effectiveSafetyOn ? bi('保护开启', 'Active') : bi('已关闭', 'Disabled')),
        preview: effectiveSafetyOn
          ? bi('默认开启，防删文件、越界与读密钥', 'Active by default')
          : (!globalSafetyOn ? bi('全部对话已关闭', 'Disabled for all chats') : bi('当前对话已关闭', 'Disabled in this chat')),
        bodyStyle: { padding: 0 },
      },
      view && view.sessionId
        ? h(
            'div',
            { className: 'dnb-cell', style: { justifyContent: 'space-between', gap: 8 } },
            h('div', { style: { minWidth: 0 } },
              h('div', { style: { fontSize: 12 } }, bi('当前对话开启安全拦截（默认开）', 'Enable Safety Block in this chat')),
              h('div', { style: { fontSize: 10.5, color: globalSafetyOn ? 'var(--dnb-text-3)' : 'var(--dnb-coral)', marginTop: 1 } },
                globalSafetyOn
                  ? bi('自动拦住删文件、改项目外文件、读密钥等危险操作', 'Automatically blocks dangerous deletes, out-of-project edits, and secret reads')
                  : bi('已被下方全部对话总开关关闭，请先打开总开关', 'Overridden by the global switch below; turn it on first')),
            ),
            h(Switch, {
              checked: globalSafetyOn && sessionSafetyOn,
              disabled: !globalSafetyOn,
              onChange: on => {
                if (!globalSafetyOn) return
                if (on) {
                  void updateSecConfig({ tacticalModes: { safetyGuardEnabled: true } })
                } else {
                  patch({
                    safetyGuardModalOpen: true,
                    safetyGuardModalScope: 'session',
                    safetyGuardAgreed: false,
                    safetyGuardPauseWalls: false,
                  })
                }
              },
            }),
          )
        : null,
      h(
        'div',
        { className: 'dnb-cell', style: { justifyContent: 'space-between', gap: 8 } },
        h('div', { style: { minWidth: 0 } },
          h('div', { style: { fontSize: 12 } }, bi('全部对话安全拦截总开关（默认开）', 'Safety Block for all chats (master switch)')),
          h('div', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', marginTop: 1 } },
            bi('关闭后所有对话都不会再触发自动拦截（边界页里自己加的拦截规则仍独立生效）', 'Turns off built-in blocking across all chats (your Custom Block Rules stay active)')),
        ),
        h(Switch, {
          checked: globalSafetyOn,
          onChange: on => {
            if (on) {
              void updateSecConfig({ globalSafetyGuardEnabled: true })
            } else {
              patch({
                safetyGuardModalOpen: true,
                safetyGuardModalScope: 'global',
                safetyGuardAgreed: false,
                safetyGuardPauseWalls: false,
              })
            }
          },
        }),
      ),
    ),

    // 5. Milestone Notifications & Gentle Sound (Default Collapsed)
    h(
      AccCard,
      {
        open: notifyOpen,
        onToggle: () => setNotifyOpen(v => !v),
        tone: 'amber',
        title: bi('离开电脑时的提醒和声音', 'Away Alerts & Sound'),
        badges: h('span', { className: 'dnb-acc-badge', 'data-tone': notifPerm === 'granted' ? 'green' : undefined }, notifPermLabel),
        preview: meta.notifyEnabled !== false ? bi('重要节点会通知你', 'Alerts on') : bi('通知已关', 'Alerts off'),
        actions: h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: { height: 21, padding: '0 7px', fontSize: 10.5 },
          title: bi('发一条测试通知，试试弹窗和声音', 'Send a test alert and sound'),
          onClick: async e => {
            e.stopPropagation()
            if (notifPerm === 'default') {
              const p = await requestNotificationPermission()
              setNotifPerm(p)
            }
            const res = fireChiefAlertNotification(
              {
                id: 'test-' + Date.now(),
                kind: 'managed_auto_sleep',
                level: 'success',
                body: bi('提醒功能正常。需要批准、被规则挡住、重连或到上限时都会通知你。', 'Alerts work. You’ll get notified on approvals, blocks, retries, or limits.'),
              },
              { sound: true },
            )
            patch({ notice: res.toast })
          },
        }, bi('测试提醒', 'Test')),
        bodyStyle: { padding: 0 },
      },
      h(
        'div',
        { className: 'dnb-cell', style: { justifyContent: 'space-between' } },
        h('div', { style: { minWidth: 0 } },
          h('div', { style: { fontSize: 12.5 } }, bi('重要节点弹出电脑桌面通知', 'Desktop alerts at key moments')),
          h('div', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', marginTop: 1 } },
            bi('需要你批准、被安全拦截或自定义规则挡住、断线重连或到上限时通知', 'On approvals, safety or custom rule blocks, retries, or limits')),
        ),
        h(Switch, {
          checked: meta.notifyEnabled !== false,
          onChange: async on => {
            if (on && getNotificationPermissionState() === 'default') {
              const p = await requestNotificationPermission()
              setNotifPerm(p)
            }
            void updateSecConfig({ notifyEnabled: on })
          },
        }),
      ),
      h(
        'div',
        { className: 'dnb-cell', style: { justifyContent: 'space-between' } },
        h('span', { style: { fontSize: 12.5 } }, bi('响一下轻提示音（默认关闭）', 'Play a soft sound (off by default)')),
        h(Switch, {
          checked: Boolean(meta.notifySound),
          onChange: on => {
            if (on) {
              fireChiefAlertNotification({ kind: 'auto_continue_rescue', level: 'info', body: bi('提示音已打开', 'Sound on') }, { sound: true })
            }
            void updateSecConfig({ notifySound: on })
          },
        }),
      ),
    ),

    // 6. Chief LLM Ledger & Hard Budget Circuit Breaker (Default Collapsed unless Tripped)
    h(
      AccCard,
      {
        open: ledgerOpen,
        onToggle: () => setLedgerOpen(v => !v),
        tone: 'violet',
        title: bi('参谋花费统计与托管上限', 'Chief Usage & Budget Cap'),
        badges: mr.tripped
          ? h('span', { className: 'dnb-acc-badge', 'data-tone': 'red' }, bi('已到上限停下', 'Cap Reached'))
          : h('span', { className: 'dnb-acc-badge' }, `${ledger.totalCalls || 0}${bi('次', '')} · ${fmtTok(ledger.totalTokens || 0)}`),
        preview: `${bi('本轮托管', 'Managed run')} ${mr.calls || 0}/${maxCalls || '∞'}`,
        actions: h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: { height: 21, padding: '0 7px', fontSize: 10.5 },
          title: bi('清零本轮托管的次数和 Token，恢复可用', 'Reset call and token counts for this run'),
          onClick: e => {
            e.stopPropagation()
            void updateSecConfig({ resetManagedBudget: true })
          },
        }, bi('清零计数', 'Reset')),
        bodyStyle: { padding: '8px 11px 10px' },
      },
      mr.tripped
        ? h(
            'div',
            {
              style: {
                padding: '7px 10px',
                marginBottom: 8,
                borderRadius: 10,
                border: '1px solid var(--dnb-border)',
                borderLeft: '2.5px solid var(--dnb-coral)',
                background: 'var(--dnb-coral-soft)',
                color: 'var(--dnb-coral)',
                fontSize: 11,
                lineHeight: 1.45,
              },
            },
            mr.trippedReason || bi('本轮托管已到上限，自动切回「关停」。你手动提问不受影响。', 'Budget limit reached; switched to "Off". Manual questions still work.'),
          )
        : null,
      h(
        'div',
        { className: 'dnb-ledger-grid' },
        [
          { key: 'chat', label: bi('你问参谋', 'Q&A'), item: byCat.chat || {} },
          { key: 'review', label: bi('巡检 / 盯着做', 'Patrol'), item: byCat.review || {} },
          { key: 'dream', label: bi('梦境漫游 / 整理档案', 'Dream Roam'), item: byCat.dream || {} },
        ].map(cat =>
          h(
            'div',
            { key: cat.key, className: 'dnb-ledger-chip' },
            h('span', { className: 'dnb-ledger-chip-label' }, cat.label),
            h('span', { className: 'dnb-ledger-chip-val' }, `${cat.item.calls || 0}${bi('次', 'x')} · ${fmtTok(cat.item.tokens || 0)}`),
          ),
        ),
      ),
      h(
        'div',
        { className: 'dnb-budget-row' },
        h('div', { className: 'dnb-budget-meta' },
          h('span', null, bi('本轮托管已调用次数', 'Calls used this run')),
          h('span', null, `${mr.calls || 0} / ${maxCalls > 0 ? maxCalls : '∞'}`),
        ),
        h('div', { className: 'dnb-budget-bar' },
          h('div', {
            className: 'dnb-budget-fill',
            'data-warn': callsPct >= 80 && !mr.tripped ? '1' : '0',
            'data-tripped': mr.tripped ? '1' : '0',
            style: { width: `${maxCalls > 0 ? callsPct : 0}%` },
          }),
        ),
      ),
      h(
        'div',
        { className: 'dnb-budget-row' },
        h('div', { className: 'dnb-budget-meta' },
          h('span', null, bi('本轮托管已用 Token', 'Tokens used this run')),
          h('span', null, `${fmtTok(mr.tokens || 0)} / ${maxTokens > 0 ? fmtTok(maxTokens) : '∞'}`),
        ),
        h('div', { className: 'dnb-budget-bar' },
          h('div', {
            className: 'dnb-budget-fill',
            'data-warn': tokensPct >= 80 && !mr.tripped ? '1' : '0',
            'data-tripped': mr.tripped ? '1' : '0',
            style: { width: `${maxTokens > 0 ? tokensPct : 0}%` },
          }),
        ),
      ),
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginTop: 6, flexWrap: 'wrap' } },
        h('span', { style: { fontSize: 11.5, color: 'var(--dnb-text-2)' } }, bi('每次托管最多调用几次 (0=不限)', 'Max calls per run (0=∞)')),
        h('input', {
          type: 'number',
          className: 'dnb-input',
          style: { width: 70, height: 24, textAlign: 'right', padding: '0 7px', borderRadius: 7, fontSize: 11.5 },
          min: 0,
          max: 500,
          value: callsDraft !== null ? callsDraft : String(maxCalls),
          onChange: e => setCallsDraft(e.target.value),
          onBlur: commitCallsCap,
          onKeyDown: e => { if (e.key === 'Enter') commitCallsCap() },
        }),
      ),
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginTop: 6, flexWrap: 'wrap' } },
        h('span', { style: { fontSize: 11.5, color: 'var(--dnb-text-2)' } }, bi('Token 最多用多少', 'Max Tokens')),
        h(
          'div',
          { style: { display: 'flex', gap: 4, flexWrap: 'wrap' } },
          [
            { val: 100_000, label: '100K' },
            { val: 300_000, label: '300K' },
            { val: 500_000, label: '500K' },
            { val: 1_000_000, label: '1M' },
            { val: 0, label: bi('不限', '∞') },
          ].map(opt =>
            h('button', {
              key: opt.label,
              type: 'button',
              className: 'dnb-mini-btn',
              'data-tone': maxTokens === opt.val ? 'accent' : undefined,
              onClick: () => void updateSecConfig({ managedBudgetMaxTokens: opt.val }),
            }, opt.label),
          ),
        ),
      ),
    ),

    // 7. Automation Guard Preferences (Default Collapsed)
    h(
      AccCard,
      {
        open: guardPrefOpen,
        onToggle: () => setGuardPrefOpen(v => !v),
        tone: 'emerald',
        title: bi('自动化设置', 'Automation Settings'),
        showPullHint: false,
        preview: [
          view.autoInject ? bi('自动附带摘要', 'Auto-summary on') : bi('摘要手动附带', 'Auto-summary off'),
          view.guardIdle ? bi('防卡住提醒开', 'Idle guard on') : bi('防卡住提醒关', 'Idle guard off'),
        ].join(' · '),
        headerExtra: h('span', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', fontWeight: 400 } },
          bi('交接单在任务页底', 'Handoff is at bottom of Tasks')),
        bodyStyle: { padding: 0 },
      },
      h(
        'div',
        { className: 'dnb-cell', style: { justifyContent: 'space-between' } },
        h('span', { style: { fontSize: 12.5 } }, bi('每轮对话自动带上进度摘要', 'Attach progress summary every turn')),
        h(Switch, {
          checked: !!view.autoInject,
          onChange: on => {
            patch({ autoInject: on })
            void act({ action: 'settings.set', autoInject: on })
          },
        }),
      ),
      h(
        'div',
        { className: 'dnb-cell', style: { justifyContent: 'space-between' } },
        h('span', { style: { fontSize: 12.5 } }, bi('AI 卡住或偷懒时自动提醒', 'Remind AI if stuck or idle')),
        h(Switch, {
          checked: !!view.guardIdle,
          onChange: on => {
            patch({ guardIdle: on })
            void act({ action: 'settings.set', guardIdle: on })
          },
        }),
      ),
      h(
        'div',
        { className: 'dnb-cell', style: { justifyContent: 'space-between' } },
        h('span', { style: { fontSize: 12.5 } }, bi('一个窗口最多提醒几次', 'Max reminders per window')),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 6 } },
          h('button', {
            className: 'dnb-pill',
            style: { width: 24, height: 24, padding: 0 },
            onClick: () => {
              const next = Math.max(0, Number(view.guardMaxPerSession || 0) - 1)
              patch({ guardMaxPerSession: next })
              void act({ action: 'settings.set', guardMaxPerSession: next })
            },
          }, '−'),
          h('span', { style: { minWidth: 18, textAlign: 'center', fontWeight: 500 } }, String(view.guardMaxPerSession)),
          h('button', {
            className: 'dnb-pill',
            style: { width: 24, height: 24, padding: 0 },
            onClick: () => {
              const next = Math.min(20, Number(view.guardMaxPerSession || 0) + 1)
              patch({ guardMaxPerSession: next })
              void act({ action: 'settings.set', guardMaxPerSession: next })
            },
          }, '+'),
        ),
      ),
      h(
        'div',
        { className: 'dnb-cell', style: { justifyContent: 'space-between' } },
        h('span', { style: { fontSize: 12.5 } }, bi('回复太短就提醒的字数门槛', 'Min reply length before reminder')),
        h('input', {
          type: 'number',
          className: 'dnb-input',
          style: { width: 72, height: 26, textAlign: 'right', padding: '0 8px', borderRadius: 8 },
          min: 0,
          max: 10000,
          value: String(view.guardShortAnswer),
          onChange: e => {
            const next = Math.max(0, Math.min(10000, Math.round(Number(e.target.value) || 0)))
            patch({ guardShortAnswer: next })
            void act({ action: 'settings.set', guardShortAnswer: next })
          },
        }),
      ),
    ),
  )
}

/* -------------------------------------------------------- Boundaries Tab */
