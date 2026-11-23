/**
 * tabs/plan.js
 *
 * Plan, Memory, Notes, and Handoff sub-tabs.
 */

import { React, h } from '../react-runtime.js'
import { bi, getUiLangPref, presetList } from '../i18n.js'
import { store, patch, savePlacementPref } from '../store.js'
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
import { Icon, Switch, ObjectiveRadarStrip, AccCard, renderStructuredText } from '../components/common.js'

export function PlanTab({
  board,
  topSlot = null,
  taskTopologySlot = null,
  renderUnifiedBoard = null,
  renderStepTasks = null,
  orphanTasksSlot = null,
  taskBoardExtra = null,
  onTriggerPlanGraph = null,
}) {
  const view = store
  const [objective, setObjective] = React.useState(null)
  const [contextMenu, setContextMenu] = React.useState(null)
  const [consultIdx, setConsultIdx] = React.useState(-1)
  const [consultDraft, setConsultDraft] = React.useState('')
  const [secAnswers, setSecAnswers] = React.useState({})
  const [secAskingIdx, setSecAskingIdx] = React.useState(-1)
  const [newStepText, setNewStepText] = React.useState('')
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
      patch({ notice: setGoal ? '🎯 已设为目标，会帮你盯着做完' : '目标已保存' })
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

  const addNewStep = () => {
    const clean = newStepText.trim()
    if (!clean) return
    setNewStepText('')
    addStepWithText(clean)
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
                borderRadius: 9,
                background: 'rgba(10, 132, 255, 0.06)',
                border: '1px solid rgba(10, 132, 255, 0.22)',
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
    topSlot !== null ? topSlot : h(ObjectiveRadarStrip, { board, compact: true }),

    // ==================== Zone 1: Collapsible Core Objective Card ====================
    h(
      AccCard,
      {
        open: !objCollapsed,
        onToggle: () => patch({ planObjCollapsed: !objCollapsed }),
        className: 'dnb-obj-card',
        title: bi('核心目标', 'Core Objective'),
        headTitle: objCollapsed ? bi('展开并修改目标', 'Expand goal') : bi('收起目标卡片', 'Collapse goal'),
        showPullHint: false,
        style: (isInterventionLocked || isGoalMode)
          ? {
              borderColor: 'rgba(245, 158, 11, 0.45)',
              boxShadow: '0 0 0 1px rgba(245, 158, 11, 0.10)',
            }
          : undefined,
        bodyStyle: { padding: 0 },
        badges: (isInterventionLocked || isGoalMode)
          ? h(
              React.Fragment,
              null,
              isInterventionLocked
                ? h('span', { className: 'dnb-acc-badge', 'data-tone': 'amber' }, bi('🔒 已锁定', '🔒 Locked'))
                : null,
              isGoalMode
                ? h('span', { className: 'dnb-acc-badge', 'data-tone': 'amber' }, bi('🎯 盯着做', '🎯 Goal On'))
                : null,
            )
          : null,
        headerExtra: !objCollapsed && board && board.objectiveAt && objective === null
          ? h('span', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', flexShrink: 0 } }, timeLabel(board.objectiveAt))
          : null,
        preview: (current || '').trim() ? clampTitle(String(current).trim(), 30) : bi('还没填目标', 'No goal yet'),
        actions: h(
          React.Fragment,
          null,
          h('button', {
            type: 'button',
            className: 'dnb-pill',
            style: { height: 22, padding: '0 6px', fontSize: 10.5 },
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
                patch({ notice: bi('📄 已导出任务报告：', '📄 Exported report: ') + dl.filename })
              } else {
                copyText(md, bi('📄 任务报告已复制到剪贴板', '📄 Report copied to clipboard'))
              }
            },
          }, bi('📄 战报', '📄 Report')),
          h('button', {
            type: 'button',
            className: 'dnb-pill',
            style: {
              height: 22,
              padding: '0 7px',
              fontSize: 10.5,
              borderColor: isGoalMode ? 'rgba(245, 158, 11, 0.45)' : 'rgba(10, 132, 255, 0.35)',
              background: isGoalMode ? 'rgba(245, 158, 11, 0.14)' : 'rgba(10, 132, 255, 0.09)',
              color: isGoalMode ? '#fbbf24' : 'var(--dnb-accent)',
              fontWeight: 600,
            },
            title: isGoalMode
              ? bi('取消目标锁定，切回普通模式', 'Exit goal mode')
              : bi('设为目标后参谋会盯着做，最后由你确认结束', 'Lock goal; ends only after your approval'),
            onClick: toggleGoalMode,
          }, isGoalMode ? bi('退出目标', 'Exit Goal') : bi('🎯 设为目标', '🎯 Set Goal')),
          h('button', {
            type: 'button',
            className: 'dnb-pill dnb-pill-accent',
            style: { height: 22, padding: '0 8px', fontSize: 10.5 },
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
      },
      h('textarea', {
        className: 'dnb-bare-area',
        style: isInterventionLocked
          ? { minHeight: 50, opacity: 0.9, cursor: 'not-allowed', color: 'var(--dnb-text)' }
          : { minHeight: 50 },
        readOnly: isInterventionLocked,
        placeholder: isInterventionLocked
          ? bi('强介入开启中，目标暂时不能改…', 'Strong intervention on; goal locked…')
          : bi('写下你想实现的目标，再点右上「🎯 设为目标」…', 'Write your goal, then click "🎯 Set Goal"…'),
        value: current,
        onChange: e => { if (!isInterventionLocked) setObjective(e.target.value) },
        onBlur: () => { if (!isInterventionLocked) saveObjective() },
        onKeyDown: e => {
          if (!isInterventionLocked && (e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault()
            saveObjective()
          }
        },
      }),
      (isInterventionLocked || isGoalMode || objective !== null || (current || '').trim())
        ? h(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                padding: (isInterventionLocked || isGoalMode) ? '5px 10px 7px' : '4px 10px 6px',
                borderTop: '1px solid var(--dnb-border)',
                fontSize: 11,
                color: (isInterventionLocked || isGoalMode) ? '#fbbf24' : 'var(--dnb-text-3)',
              },
            },
            (isInterventionLocked || isGoalMode)
              ? h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                  isInterventionLocked
                    ? '🔒 强介入开启时目标已锁，关掉强介入才能改'
                    : '🎯 正在盯着做完，好了会请你点确认')
              : h('span', null),
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 } },
              isInterventionLocked
                ? h('button', {
                    type: 'button',
                    className: 'dnb-pill',
                    style: { height: 21, padding: '0 8px', fontSize: 10.5, borderColor: 'rgba(245, 158, 11, 0.42)', color: '#fbbf24' },
                    title: '关掉强介入后就能改目标',
                    onClick: () => void updateSecConfig({ emergencyStopIntervention: true }),
                  }, '🔓 关掉强介入并解锁')
                : null,
              !isInterventionLocked && objective !== null
                ? h('button', {
                    type: 'button',
                    className: 'dnb-pill dnb-pill-accent',
                    style: { height: 21, padding: '0 8px', fontSize: 10.5 },
                    onClick: saveObjective,
                  }, '保存')
                : null,
              (current || '').trim()
                ? h('button', {
                    type: 'button',
                    className: 'dnb-text-filter-btn',
                    style: { fontSize: 10.5 },
                    title: '用大白话讲讲这个目标卡在哪、怎么做',
                    onClick: () => {
                      void askLeadModel(
                        `请用通俗易懂的大白话给我解释一下当前核心目标「${String(current).trim().slice(0, 120)}」：核心卡点是什么、整体打算怎么解决？`,
                        '咨询核心目标',
                      )
                    },
                  }, '解释目标')
                : null,
            ),
          )
        : null,
    ),

    // Inline Stale Plan Reset Prompt when Objective changed and old steps exist
    view.planResetPrompt
      ? h(
          'div',
          {
            className: 'dnb-group',
            style: {
              marginTop: 8,
              padding: '8px 10px',
              borderColor: 'rgba(245, 158, 11, 0.42)',
              background: 'rgba(245, 158, 11, 0.07)',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            },
          },
          h('div', { style: { fontSize: 11.5, color: 'var(--dnb-text)', fontWeight: 600 } },
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
          h('div', { style: { fontSize: 12, fontWeight: 700, color: '#30d158' } }, '🎯 参谋长觉得目标完成了，等你确认结束'),
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
                  style: { height: 26, padding: '0 11px', fontSize: 11.5, background: '#30d158', color: '#09180e', fontWeight: 700 },
                  disabled: view.busy,
                  onClick: () => void approveGoalApi(),
                }, '✅ 批准结项'),
                h('button', {
                  type: 'button',
                  className: 'dnb-pill',
                  style: { height: 26, padding: '0 9px', fontSize: 11.5 },
                  onClick: () => {
                    setRejectingGoal(true)
                    setRejectReason('')
                  },
                }, '↩ 退回继续'),
              ),
        )
      : null,

    // ==================== Zone 2: Collapsible Visual Work Topology ====================
    taskTopologySlot || null,

    // ==================== Zone 3: Unified Progress Task Board ====================
    typeof renderUnifiedBoard === 'function'
      ? renderUnifiedBoard(stepApi)
      : h(
          React.Fragment,
          null,
          h(
            'div',
            { className: 'dnb-section-head', style: { marginTop: 12, alignItems: 'baseline' } },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'baseline', gap: 6 } },
              h('span', { style: { fontWeight: 600, color: 'var(--dnb-text)' } }, bi('任务进度板', 'Task Board')),
              h('span', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', fontWeight: 400 } }, bi('点任一条可展开详情或提问', 'Click any item for details or Q&A')),
            ),
            (steps.length || taskBoardExtra)
              ? h('span', null, [steps.length ? `${doneCount} / ${steps.length} 步` : '', taskBoardExtra || ''].filter(Boolean).join(' · '))
              : null,
          ),
          (steps.length > 0 || orphanTasksSlot)
            ? h(
                React.Fragment,
                null,
                steps.length > 0
                  ? h(
                      'div',
                      { className: 'dnb-progress', style: { marginBottom: 8 } },
                      h('div', { style: { width: (doneCount / steps.length) * 100 + '%', background: '#30d158', transition: 'width 0.3s ease' } }),
                    )
                  : null,
                h(
                  'div',
                  { className: 'dnb-group' },
                  steps.map((step, i) => {
                    const isConsulting = consultIdx === i
                    const stepTasksNode = renderStepTasks ? renderStepTasks(step, i) : null

                    return h(
                      React.Fragment,
                      { key: step.id || i },
                      h(
                        'div',
                        {
                          className: 'dnb-cell dnb-cell-hover',
                          style: { cursor: 'pointer' },
                          title: '打开菜单：可提问、标完成或删除',
                          onClick: e => {
                            e.preventDefault()
                            e.stopPropagation()
                            setContextMenu({ stepIndex: i, x: e.clientX, y: e.clientY })
                          },
                          onContextMenu: e => {
                            e.preventDefault()
                            e.stopPropagation()
                            setContextMenu({ stepIndex: i, x: e.clientX, y: e.clientY })
                          },
                        },
                        h(
                          'span',
                          {
                            className: 'dnb-ring',
                            title: step.done ? '改回未完成' : '标为已完成',
                            style: step.done
                              ? { background: '#30d158', borderColor: '#30d158', cursor: 'pointer' }
                              : { cursor: 'pointer' },
                            onClick: e => {
                              e.preventDefault()
                              e.stopPropagation()
                              const next = keepIds(steps)
                              next[i] = { ...next[i], done: !step.done }
                              pushSteps(next)
                            },
                          },
                          step.done ? h(Icon, { name: 'check', size: 11 }) : null,
                        ),
                        h(
                          'span',
                          {
                            style: {
                              flex: 1,
                              fontSize: 12.5,
                              color: step.done ? 'var(--dnb-text-3)' : 'var(--dnb-text)',
                              textDecoration: step.done ? 'line-through' : 'none',
                            },
                          },
                          h('span', { className: 'dnb-step-idx-tag' }, `第 ${i + 1} 步`),
                          step.text || '',
                        ),
                        h(
                          'span',
                          { className: 'dnb-row-actions', style: { gap: 4 } },
                          h('button', {
                            className: 'dnb-pill',
                            style: { height: 22, padding: '0 7px', fontSize: 11, color: 'var(--dnb-accent)' },
                            title: '用大白话解释这一步',
                            onClick: e => {
                              e.stopPropagation()
                              void askLeadModel(buildExplainPrompt(step.text, i), '咨询步骤含义')
                            },
                          }, '解释'),
                          h('button', {
                            className: 'dnb-pill',
                            'data-active': isConsulting ? '1' : '0',
                            style: { height: 22, padding: '0 7px', fontSize: 11 },
                            title: '打开提问框，问这一步不懂的地方',
                            onClick: e => {
                              e.stopPropagation()
                              setConsultIdx(isConsulting ? -1 : i)
                              setConsultDraft('')
                            },
                          }, '提问'),
                        ),
                      ),
                      renderStepConsult(i, step),
                      stepTasksNode || null,
                    )
                  }),

                  orphanTasksSlot || null,

                  h(
                    'div',
                    {
                      className: 'dnb-cell',
                      style: { padding: '6px 11px', gap: 6 },
                    },
                    h(Icon, { name: 'plus', size: 13, style: { color: 'var(--dnb-text-3)' } }),
                    h('input', {
                      className: 'dnb-input',
                      style: { border: 'none', background: 'transparent', padding: '2px 4px', height: 24, flex: 1, fontSize: 12 },
                      placeholder: '加一个新步骤，按回车保存…',
                      value: newStepText,
                      onChange: e => setNewStepText(e.target.value),
                      onKeyDown: e => {
                        if (e.key === 'Enter' && newStepText.trim()) {
                          e.preventDefault()
                          addNewStep()
                        }
                      },
                    }),
                    newStepText.trim()
                      ? h('button', {
                          className: 'dnb-pill dnb-pill-accent',
                          style: { height: 22, padding: '0 8px', fontSize: 11 },
                          onClick: addNewStep,
                        }, '添加')
                      : null,
                  ),
                ),
              )
            : h(
                'div',
                { className: 'dnb-group' },
                h('div', { className: 'dnb-empty', style: { padding: '16px 12px 10px' } }, '还没有步骤和任务。AI 列好计划后会自动显示在这里，你也能自己添加'),
                h(
                  'div',
                  {
                    className: 'dnb-cell',
                    style: { padding: '6px 11px', gap: 6, borderTop: '1px solid var(--dnb-border)' },
                  },
                  h(Icon, { name: 'plus', size: 13, style: { color: 'var(--dnb-text-3)' } }),
                  h('input', {
                    className: 'dnb-input',
                    style: { border: 'none', background: 'transparent', padding: '2px 4px', height: 24, flex: 1, fontSize: 12 },
                    placeholder: '自己加一步，按回车保存…',
                    value: newStepText,
                    onChange: e => setNewStepText(e.target.value),
                    onKeyDown: e => {
                      if (e.key === 'Enter' && newStepText.trim()) {
                        e.preventDefault()
                        addNewStep()
                      }
                    },
                  }),
                ),
              ),
        ),

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
        ? { label: '✏️ 你改过', tone: 'accent' }
        : hSource === 'chief'
          ? { label: '✦ 参谋已更新', tone: 'green' }
          : { label: '自动生成', tone: undefined }

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
          title: bi('🚀 换新窗口接着做', '🚀 Continue in New Window'),
          headTitle: handoffCollapsed ? bi('展开换窗口交接设置', 'Expand handoff options') : bi('收起交接设置', 'Collapse handoff options'),
          bodyStyle: { padding: 10, display: 'flex', flexDirection: 'column', gap: 8 },
          badges: h('span', {
            className: 'dnb-tag',
            style: {
              fontSize: 10,
              background: sourceBadge.tone === 'accent'
                ? 'rgba(10,132,255,0.14)'
                : sourceBadge.tone === 'green'
                  ? 'rgba(48,209,88,0.14)'
                  : undefined,
              color: sourceBadge.tone === 'accent'
                ? 'var(--dnb-accent)'
                : sourceBadge.tone === 'green'
                  ? '#30d158'
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
          }, isPinned ? bi('📌 已定住', '📌 Pinned') : bi('📌 定住防改', '📌 Pin')),
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
            style: { flex: 1, height: 30, fontSize: 11.5 },
            disabled: Boolean(view.handoffBusy),
            onClick: () => void requestTransferWithGuard('create', buildTransferOpts()),
          }, bi('🚀 新开窗口接着做', '🚀 Open New Window & Continue')),
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
            }, view.handoffEditing ? '收起编辑' : '✏️ 修改交接单'),
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
                placeholder: '在这里改交接单（支持 Markdown）。点下方「📌 保存并定住」就不怕被覆盖…',
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
                  style: { height: 26, padding: '0 11px', fontSize: 11, background: '#f59e0b', color: '#111', fontWeight: 700 },
                  onClick: () => void saveHandoffCustom(view.handoffDraft, true),
                }, '📌 保存并定住'),
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

/* ------------------------------------------------------------ Notes Tab */

function NoteEditor({ note }) {
  const isNew = !note
  const submit = () => {
    if (!(store.editNoteTitle || '').trim() && !(store.editNoteBody || '').trim()) return
    const tags = String(store.editNoteTags || '').split(/[,，]/).map(t => t.trim()).filter(Boolean)
    const payload = { action: 'note.write', title: store.editNoteTitle, body: store.editNoteBody, tags }
    if (!isNew) {
      payload.noteId = note.id
      if (note.shared) payload.scope = 'shared'
    }
    patch({ editNoteId: '', newNote: false, notice: '笔记已保存' })
    void act(payload)
  }
  return h(
    'div',
    { className: 'dnb-group', style: { padding: 10, marginBottom: 12 } },
    h('input', {
      className: 'dnb-input',
      placeholder: '标题',
      value: store.editNoteTitle || '',
      onChange: e => patch({ editNoteTitle: e.target.value }),
    }),
    h('div', { style: { height: 6 } }),
    h('textarea', {
      className: 'dnb-area',
      style: { minHeight: 84 },
      placeholder: '写点笔记…',
      value: store.editNoteBody || '',
      onChange: e => patch({ editNoteBody: e.target.value }),
      onKeyDown: e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault()
          submit()
        }
      },
    }),
    h('div', { style: { height: 6 } }),
    h('input', {
      className: 'dnb-input',
      placeholder: '标签（用逗号隔开）',
      value: store.editNoteTags || '',
      onChange: e => patch({ editNoteTags: e.target.value }),
      onKeyDown: e => { if (e.key === 'Enter') { e.preventDefault(); submit() } },
    }),
    h(
      'div',
      { style: { display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 } },
      h('button', { className: 'dnb-pill', onClick: () => patch({ editNoteId: '', newNote: false }) }, '取消'),
      h('button', {
        className: 'dnb-primary-btn',
        disabled: !(store.editNoteTitle || '').trim() && !(store.editNoteBody || '').trim(),
        onClick: submit,
      }, '保存'),
    ),
  )
}

function NotesTab({ board }) {
  const notes = (board && Array.isArray(board.notes)) ? board.notes : []
  const editing = store.editNoteId ? notes.find(n => n && n.id === store.editNoteId) : null

  return h(
    'div',
    { className: 'dnb-view' },
    h(
      'div',
      { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 } },
      h('span', { style: { fontSize: 12, color: 'var(--dnb-text-2)', fontWeight: 500 } }, notes.length ? `共 ${notes.length} 篇` : ''),
      h('button', {
        className: 'dnb-primary-btn',
        onClick: () => patch({ newNote: true, editNoteId: '', editNoteTitle: '', editNoteBody: '', editNoteTags: '' }),
      }, h(Icon, { name: 'plus', size: 13 }), '新建笔记'),
    ),
    store.newNote ? h(NoteEditor, { note: null }) : null,
    editing ? h(NoteEditor, { note: editing }) : null,
    notes.length
      ? notes.map(note => {
          const pinned = note.pinned === true || (note.tags || []).some(t => String(t).toLowerCase() === 'anchor')
          return h(
            'div',
            {
              key: note.id,
              className: 'dnb-group dnb-note-card',
              style: {
                padding: '10px 12px',
                borderColor: pinned ? 'rgba(10, 132, 255, 0.35)' : undefined,
              },
            },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 } },
              h(
                'div',
                { style: { fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
                pinned ? h(Icon, { name: 'pin', size: 12, style: { color: 'var(--dnb-accent)' } }) : null,
                note.title || '无标题',
                (note.tags || []).map(tag => h('span', { className: 'dnb-tag', key: tag }, tag)),
              ),
              h(
                'div',
                { className: 'dnb-row-actions' },
                h('button', {
                  className: 'dnb-icon-btn',
                  style: { width: 24, height: 24 },
                  title: pinned ? '取消置顶' : '置顶',
                  onClick: () => void act({ action: note.pinned ? 'note.unpin' : 'note.pin', noteId: note.id }),
                }, h(Icon, { name: 'pin', size: 12 })),
                h('button', {
                  className: 'dnb-icon-btn',
                  style: { width: 24, height: 24 },
                  title: '编辑',
                  onClick: () => patch({
                    editNoteId: note.id,
                    newNote: false,
                    editNoteTitle: note.title || '',
                    editNoteBody: note.body || '',
                    editNoteTags: (note.tags || []).join(', '),
                    editNoteShared: note.shared === true,
                  }),
                }, h(Icon, { name: 'edit', size: 12 })),
                h('button', {
                  className: 'dnb-icon-btn',
                  style: { width: 24, height: 24, color: '#ff453a' },
                  title: '删除',
                  onClick: () => {
                    if (!confirm('确定删掉笔记「' + clampTitle(note.title || note.body, 16) + '」吗？')) return
                    void act({ action: 'note.remove', noteId: note.id, scope: note.shared ? 'shared' : '' })
                  },
                }, h(Icon, { name: 'trash', size: 12 })),
              ),
            ),
            note.body
              ? h('div', { style: { fontSize: 12, color: 'var(--dnb-text-2)', lineHeight: 1.55, whiteSpace: 'pre-wrap', marginTop: 5, maxHeight: 180, overflow: 'auto' } }, note.body)
              : null,
            h(
              'div',
              { style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, fontSize: 11, color: 'var(--dnb-text-3)' } },
              note.shared ? h('span', null, '共享') : null,
              h('span', null, timeLabel(note.updatedAt)),
            ),
          )
        })
      : h('div', { className: 'dnb-empty' }, '还没有笔记'),
  )
}

/* -------------------------------------- Engineering Memory Archive Tab (档案柜) */

export function HandoffTab({ view }) {
  const [presetsOpen, setPresetsOpen] = React.useState(true)
  const [placementOpen, setPlacementOpen] = React.useState(true)
  const [safetyOpen, setSafetyOpen] = React.useState(true)
  const [notifyOpen, setNotifyOpen] = React.useState(true)
  const [ledgerOpen, setLedgerOpen] = React.useState(true)
  const [langOpen, setLangOpen] = React.useState(true)
  const [guardPrefOpen, setGuardPrefOpen] = React.useState(true)
  const [notifPerm, setNotifPerm] = React.useState(() => getNotificationPermissionState())
  const [callsDraft, setCallsDraft] = React.useState(null)

  React.useEffect(() => {
    void loadTargets()
  }, [view.sessionId])

  const meta = view.chiefMeta || {}
  const perm = meta.permissionMode || 'advisor'
  const rm = meta.runMode || 'off'
  const activePreset = (perm === 'advisor' && rm === 'off')
    ? 'observer'
    : ((perm === 'strategist' && rm === 'patrol')
        ? 'collab'
        : ((perm === 'chief' && rm === 'managed') ? 'away' : ''))

  const presets = presetList()
  const ledger = (view.secView && view.secView.llmLedger) || meta.llmLedgerSummary || {}
  const byCat = ledger.byCategory || {}
  const mr = ledger.managedRun || {}
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

  return h(
    React.Fragment,
    null,
    // 1. Scenario Presets
    h(
      AccCard,
      {
        open: presetsOpen,
        onToggle: () => setPresetsOpen(v => !v),
        tone: 'cyan',
        title: bi('🚀 常用场景预设', '🚀 Scenario Presets'),
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

    // 1.5 Panel Placement Mode (Main Page Tab / Right Sidebar — GitHub Issue #5)
    h(
      AccCard,
      {
        open: placementOpen,
        onToggle: () => setPlacementOpen(v => !v),
        tone: 'indigo',
        title: bi('🖥️ 面板显示位置（主页面 / 右侧栏）', '🖥️ Panel Placement (Main Page / Sidebar)'),
        badges: h('span', { className: 'dnb-acc-badge', 'data-tone': 'accent' }, placementLabel),
        preview: bi('支持把参谋系统放到对话顶部主页面或右侧栏', 'Place Chief in main conversation tab or right sidebar'),
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

    // 1.8 Built-in Safety Block Toggles (Per-Session + Global Master Switch — GitHub Issue #6)
    h(
      AccCard,
      {
        open: safetyOpen,
        onToggle: () => setSafetyOpen(v => !v),
        tone: 'rose',
        title: bi('🛡️ 安全拦截（自动防误操作）', '🛡️ Safety Block (Auto Protection)'),
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
              h('div', { style: { fontSize: 10.5, color: globalSafetyOn ? 'var(--dnb-text-3)' : '#f87171', marginTop: 1 } },
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

    // 2. Milestone Notifications & Gentle Sound
    h(
      AccCard,
      {
        open: notifyOpen,
        onToggle: () => setNotifyOpen(v => !v),
        tone: 'amber',
        title: bi('🔔 离开电脑时的提醒和声音', '🔔 Away Alerts & Sound'),
        badges: h('span', { className: 'dnb-acc-badge', 'data-tone': notifPerm === 'granted' ? 'green' : undefined }, notifPermLabel),
        preview: meta.notifyEnabled !== false ? bi('重要节点会通知你', 'Alerts on') : bi('通知已关', 'Alerts off'),
        actions: h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: { height: 21, padding: '0 7px', fontSize: 10.5 },
          title: bi('发一条测试通知，试试弹窗和声音', 'Send a test alert and sound'),
          onClick: async () => {
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

    // 3. Chief LLM Ledger & Hard Budget Circuit Breaker
    h(
      AccCard,
      {
        open: ledgerOpen,
        onToggle: () => setLedgerOpen(v => !v),
        tone: 'violet',
        title: bi('📊 参谋花费统计与托管上限', '📊 Chief Usage & Budget Cap'),
        badges: mr.tripped
          ? h('span', { className: 'dnb-acc-badge', 'data-tone': 'red' }, bi('🛑 已到上限停下', '🛑 Cap Reached'))
          : h('span', { className: 'dnb-acc-badge' }, `${ledger.totalCalls || 0}${bi('次', '')} · ${fmtTok(ledger.totalTokens || 0)}`),
        preview: `${bi('本轮托管', 'Managed run')} ${mr.calls || 0}/${maxCalls || '∞'}`,
        actions: h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: { height: 21, padding: '0 7px', fontSize: 10.5 },
          title: bi('清零本轮托管的次数和 Token，恢复可用', 'Reset call and token counts for this run'),
          onClick: () => void updateSecConfig({ resetManagedBudget: true }),
        }, bi('↺ 清零计数', '↺ Reset')),
        bodyStyle: { padding: '8px 11px 10px' },
      },
      mr.tripped
        ? h(
            'div',
            {
              style: {
                padding: '6px 9px',
                marginBottom: 8,
                borderRadius: 8,
                border: '1px solid rgba(239, 68, 68, 0.42)',
                background: 'rgba(239, 68, 68, 0.12)',
                color: '#f87171',
                fontSize: 11,
                lineHeight: 1.45,
              },
            },
            '🛑 ',
            mr.trippedReason || bi('本轮托管已到上限，自动切回「⏸ 关停」。你手动提问不受影响。', 'Budget limit reached; switched to "⏸ Off". Manual questions still work.'),
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

    // 4. Interface Language Switch
    h(
      AccCard,
      {
        open: langOpen,
        onToggle: () => setLangOpen(v => !v),
        tone: 'blue',
        title: bi('🌐 界面语言 / Interface Language', '🌐 Interface Language / 界面语言'),
        preview: uiLangVal === 'en' ? 'English' : (uiLangVal === 'zh' ? '简体中文' : bi('自动跟随主界面', 'Auto (Follow App)')),
        bodyStyle: { padding: '8px 11px' },
      },
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
            style: { padding: '4px 8px', fontSize: 11.5 },
            'data-active': uiLangVal === opt.key ? '1' : '0',
            onClick: () => void updateSecConfig({ uiLang: opt.key }),
          }, opt.label),
        ),
      ),
    ),

    // 5. Existing Automation Guard Preferences Card
    h(
      AccCard,
      {
        open: guardPrefOpen,
        onToggle: () => setGuardPrefOpen(v => !v),
        tone: 'emerald',
        title: bi('自动化设置', 'Automation Settings'),
        showPullHint: false,
        headerExtra: h('span', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', fontWeight: 400 } },
          bi('换窗口交接的功能在「任务」页最下面', 'Handoff options are at the bottom of Tasks')),
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
