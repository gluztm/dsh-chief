/**
 * tabs/plan.js
 *
 * Plan, Memory, Notes, and Handoff sub-tabs.
 */

import { React, h } from '../react-runtime.js'
import { EXPECTED_BACKEND_BUILD } from '../constants.js'
import { bi, getUiLangPref, presetList, chiefDisplayName } from '../i18n.js'
import { patch, savePlacementPref, saveNavLayout, openThemeStudio } from '../store.js'
import {
  clampTitle,
  shortSession,
  timeLabel,
  detectChiefBrandFromModelRef,
  rollChiefBrandNickname,
} from '../utils.js'
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
  fetchChiefTtsStatusApi,
  probeChiefTtsApi,
  fetchRemotePagerStatusApi,
  testRemotePagerApi,
  sendRemotePagerDigestApi,
} from '../api.js'
import {
  fireChiefAlertNotification,
  getNotificationPermissionState,
  requestNotificationPermission,
  isTabTitleBadgeEnabled,
  setTabTitleBadgeEnabled,
} from '../notify.js'
import {
  listBrowserSpeechVoices,
  playChiefAudioBase64,
  speakChiefText,
  stopChiefSpeech,
} from '../tts.js'
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
  const [goalMenuOpen, setGoalMenuOpen] = React.useState(false)

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
    if (!contextMenu && !goalMenuOpen) return undefined
    const close = () => {
      setContextMenu(null)
      setGoalMenuOpen(false)
    }
    const onKey = e => { if (e.key === 'Escape') close() }
    document.addEventListener('click', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [contextMenu, goalMenuOpen])

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
          'data-dnb-section': 'tasks-plan',
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
              h(
                'div',
                { className: 'dnb-more-wrap' },
                h('button', {
                  type: 'button',
                  className: 'dnb-pill',
                  style: { height: 22, padding: '0 6px', fontSize: 11 },
                  'data-active': goalMenuOpen ? '1' : '0',
                  title: bi('战报导出与目标解释', 'Report export & explain'),
                  onClick: () => setGoalMenuOpen(v => !v),
                }, '⋯'),
                goalMenuOpen
                  ? h(
                      'div',
                      { className: 'dnb-more-menu', style: { minWidth: 164 } },
                      h('button', {
                        type: 'button',
                        className: 'dnb-more-item',
                        onClick: () => {
                          setGoalMenuOpen(false)
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
                      }, h(Icon, { name: 'fileText', size: 12 }), bi('导出任务战报 (.md)', 'Export Report (.md)')),
                      hasGoalText
                        ? h('button', {
                            type: 'button',
                            className: 'dnb-more-item',
                            onClick: () => {
                              setGoalMenuOpen(false)
                              void askLeadModel(
                                `请用通俗易懂的大白话给我解释一下当前核心目标「${String(current).trim().slice(0, 120)}」：核心卡点是什么、整体打算怎么解决？`,
                                '咨询核心目标',
                              )
                            },
                          }, h(Icon, { name: 'sparkles', size: 12 }), bi('用大白话解释目标', 'Explain Goal'))
                        : null,
                    )
                  : null,
              ),
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
                (isInterventionLocked || isGoalMode || showTextarea)
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
                            bi('失焦或 Ctrl+Enter 保存', 'Blur or Ctrl+Enter to save')),
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
                          : null,
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
        'div',
        { 'data-dnb-section': 'tasks-handoff' },
        h(
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
        ),
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

  const rawSettingsTab = (view && view.settingsSubTab) || 'basics'
  const settingsTab = ['basics', 'voice', 'notify', 'safety'].includes(rawSettingsTab) ? rawSettingsTab : 'basics'
  const setSettingsTab = next => patch({ settingsSubTab: next })

  const [appearanceOpen, setAppearanceOpen] = React.useState(true)
  const [presetsOpen, setPresetsOpen] = React.useState(true)
  const [placementOpen, setPlacementOpen] = React.useState(true)
  const [safetyOpen, setSafetyOpen] = React.useState(true)
  const [notifyOpen, setNotifyOpen] = React.useState(true)
  const [ttsDraft, setTtsDraft] = React.useState(null)
  const [ttsAdvOpen, setTtsAdvOpen] = React.useState(false)
  const [ttsProbeBusy, setTtsProbeBusy] = React.useState(false)
  const [ttsProbeMsg, setTtsProbeMsg] = React.useState('')
  const [browserVoices, setBrowserVoices] = React.useState(() => listBrowserSpeechVoices())
  const [pagerOpen, setPagerOpen] = React.useState(true)
  const [pagerDraft, setPagerDraft] = React.useState(null)
  const [pagerBusy, setPagerBusy] = React.useState(false)
  const [pagerMsg, setPagerMsg] = React.useState('')
  const [showWebhookUrl, setShowWebhookUrl] = React.useState(true)
  const [showPagerSecret, setShowPagerSecret] = React.useState(false)
  const [showTgToken, setShowTgToken] = React.useState(false)
  const [tabBadgeOn, setTabBadgeOn] = React.useState(() => isTabTitleBadgeEnabled())
  const [ledgerOpen, setLedgerOpen] = React.useState(true)
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
    if (settingsTab !== 'voice') return undefined
    void fetchChiefTtsStatusApi()
    setBrowserVoices(listBrowserSpeechVoices())
    if (typeof window !== 'undefined' && window.speechSynthesis && typeof window.speechSynthesis.addEventListener === 'function') {
      const onVoices = () => setBrowserVoices(listBrowserSpeechVoices())
      window.speechSynthesis.addEventListener('voiceschanged', onVoices)
      return () => window.speechSynthesis.removeEventListener('voiceschanged', onVoices)
    }
    return undefined
  }, [settingsTab])

  React.useEffect(() => {
    if (settingsTab === 'notify') void fetchRemotePagerStatusApi()
  }, [settingsTab])

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

  const settingsTabs = [
    { key: 'basics', label: bi('常规与布局', 'General') },
    { key: 'voice', label: bi('语音与朗读', 'Voice') },
    { key: 'notify', label: bi('通知与传呼', 'Alerts') },
    { key: 'safety', label: bi('安全与账本', 'Safety') },
  ]

  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
    h(
      'div',
      { className: 'dnb-seg', style: { padding: 2 } },
      settingsTabs.map(t =>
        h('button', {
          key: t.key,
          type: 'button',
          className: 'dnb-seg-btn',
          style: { padding: '5px 8px', fontSize: 11.5 },
          'data-active': settingsTab === t.key ? '1' : '0',
          onClick: () => setSettingsTab(t.key),
        }, t.label),
      ),
    ),

    // ---------------- TAB 1: BASICS & LAYOUT ----------------
    settingsTab === 'basics'
      ? h(
          React.Fragment,
          null,
          h(
            AccCard,
            {
              open: appearanceOpen,
              onToggle: () => setAppearanceOpen(v => !v),
              tone: 'violet',
              icon: h(Icon, { name: 'sliders', size: 13.5, style: { color: 'var(--dnb-accent)' } }),
              title: bi('称呼与布局', 'Identity & Layout'),
              badges: h('span', { className: 'dnb-acc-badge' }, 'v' + EXPECTED_BACKEND_BUILD),
              preview: `${chiefDisplayName(view)} · ${langSummary}`,
              bodyStyle: { padding: '8px 11px 10px', display: 'flex', flexDirection: 'column', gap: 10 },
            },
      // Chief Name
      h(
        'div',
        null,
        h('div', { style: { fontSize: 11.5, fontWeight: 500, color: 'var(--dnb-text-2)', marginBottom: 5 } },
          bi('参谋长称呼（仅自己可见，全局生效，不打扰主对话）', 'Chief Name (private to you, global across chats)')),
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
            className: 'dnb-pill',
            style: { height: 28, padding: '0 9px', fontSize: 11 },
            title: bi('按当前模型随机抽一个昵称并切对应代表色', 'Roll a nickname matching current model & theme color'),
            onClick: () => {
              const catNow = view.secModelsCatalog || (view.secView && view.secView.models) || null
              const curRef = meta.modelRef || meta.resolvedModelRef || meta.followModelRef || ''
              const curBrand = detectChiefBrandFromModelRef(curRef, catNow)
              const rolled = rollChiefBrandNickname(curBrand ? curBrand.key : '', chiefNameDraft)
              setChiefNameDraft(rolled)
              void updateSecConfig({ chiefName: rolled })
            },
          }, bi('🎲 随一个', '🎲 Roll')),
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
        h('div', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', marginTop: 4, lineHeight: 1.45 } },
          bi('✨ 彩蛋：叫 Claude/小克(温润纸感)、GPT/小G(静谧森系)、Gemini/哈基米(星夜幻想)、DeepSeek/鲸鱼娘(原生简约) 会自动切换对应代表色；换模型也会自动随一个昵称。',
            '✨ Easter egg: Naming Claude, GPT, Gemini, or DeepSeek (or nicknames) auto-switches to its signature color theme; switching models rolls a matching name.')),
      ),
      // Navigation Layout Style (Top Classic Tabs vs Left Minimalist Rail)
      h(
        'div',
        { style: { paddingTop: 8, borderTop: '1px solid var(--dnb-border)' } },
        h('div', { style: { fontSize: 11.5, fontWeight: 500, color: 'var(--dnb-text-2)', marginBottom: 6 } },
          bi('导航排列样式（宽屏即时生效，窄侧栏自动回退顶部）', 'Navigation Layout (Wide View Toggle)')),
        h(
          'div',
          { className: 'dnb-skin-grid' },
          [
            {
              key: 'top',
              zh: '顶部标签（经典）',
              en: 'Top Tabs (Classic)',
              tagZh: '紧凑横向',
              tagEn: 'Compact Horizontal',
              descZh: '所有页签居中平铺在顶栏下方，适合所有窗口宽度',
              descEn: 'Clean horizontal segmented strip under the header',
            },
            {
              key: 'sidebar',
              zh: '左侧工作台（极简）',
              en: 'Left Rail (Studio)',
              tagZh: '左栏右画布',
              tagEn: 'Rail + Wide Stage',
              descZh: '左侧极简竖排导航轨 + 右侧沉浸大画布（所有页签统一生效）',
              descEn: 'Minimalist left navigation rail with full-width stage for all tabs',
            },
          ].map(item => {
            const active = (view.navLayout || 'sidebar') === item.key
            return h(
              'button',
              {
                key: item.key,
                type: 'button',
                className: 'dnb-skin-card',
                'data-active': active ? '1' : '0',
                onClick: () => {
                  saveNavLayout(item.key)
                  patch({ notice: bi('已切换导航排列：', 'Navigation layout: ') + bi(item.zh, item.en) })
                },
              },
              h(
                'div',
                { className: 'dnb-skin-card-head' },
                h('span', { className: 'dnb-skin-card-name' }, bi(item.zh, item.en)),
                h('span', { className: 'dnb-acc-badge', 'data-tone': active ? 'accent' : undefined, style: { fontSize: 10 } }, bi(item.tagZh, item.tagEn)),
              ),
              h('div', { className: 'dnb-skin-card-desc' }, bi(item.descZh, item.descEn)),
            )
          }),
        ),
      ),
      // Dedicated Theme Studio entry
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            flexWrap: 'wrap',
            paddingTop: 6,
            borderTop: '1px solid var(--dnb-border)',
          },
        },
        h('span', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', lineHeight: 1.45 } },
          bi('🎨 切换预设主题或进入 DIY 工坊（主题多端同步）。',
            '🎨 Switch theme presets or open the DIY Workshop (synced across devices).')),
        h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: { height: 26, padding: '0 10px', fontSize: 11 },
          onClick: () => openThemeStudio(),
        }, bi('🎨 打开外观与 DIY 工坊 →', '🎨 Open Theme Studio →')),
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
        )
      : null,

    // ---------------- TAB 2: VOICE & TTS ----------------
    settingsTab === 'voice'
      ? (() => {
          const savedTts = (meta.tts && typeof meta.tts === 'object') ? meta.tts : {}
          const effTts = ttsDraft ? { ...savedTts, ...ttsDraft } : savedTts
          const ttsProv = effTts.provider || 'deepseek'
          const ttsVoice = effTts.voiceId || (ttsProv === 'deepseek' ? 'stella' : 'alloy')
          const ttsStatusInfo = view.ttsStatusInfo || null
          const hostDs = (ttsStatusInfo && ttsStatusInfo.hostDeepSeek) || null
          const ttsRt = (ttsStatusInfo && ttsStatusInfo.runtime) || {}
          const lastDsErr = ttsRt.lastProvider === 'deepseek' ? String(ttsRt.lastError || '').trim() : ''
          const lastDsAuthFail = /401|403|鉴权/i.test(lastDsErr)
          const dsVerifiedOk = ttsRt.lastProvider === 'deepseek' && !ttsRt.lastError && Number(ttsRt.synthesisCount) > 0
          const ttsPlayer = view.ttsPlayer || {}
          const setTtsField = (fields) => {
            setTtsDraft(prev => ({ ...savedTts, ...(prev || {}), ...fields }))
          }
          const buildSavePayload = (extraPatch = null) => {
            const merged = { ...savedTts, ...(ttsDraft || {}), ...(extraPatch || {}) }
            delete merged.hasApiKey
            return merged
          }
          const saveTtsNow = async (extraPatch = null) => {
            const payload = buildSavePayload(extraPatch)
            const res = await updateSecConfig({ tts: payload })
            if (res && res.ok !== false) {
              setTtsDraft(null)
              void fetchChiefTtsStatusApi()
            }
            return res
          }
          const runTtsProbe = async () => {
            setTtsProbeBusy(true)
            setTtsProbeMsg('')
            const sample = bi('你好，我是你的参谋长。语音播报链路已就绪，重要情况我会第一时间向你汇报。', 'Hello, this is DSH Chief. Voice playback is ready.')
            try {
              const payload = buildSavePayload()
              if (payload.provider === 'browser') {
                const res = await speakChiefText(sample, {
                  itemId: 'probe:settings',
                  label: bi('语音试听', 'Voice Test'),
                  style: 'full',
                  overrideConfig: payload,
                })
                setTtsProbeMsg(res && res.ok
                  ? bi('✅ 正在使用本机系统语音试听…', '✅ Speaking via browser voice…')
                  : `⚠️ ${(res && res.error) || bi('系统语音暂不可用', 'Browser voice unavailable')}`)
                return
              }
              const res = await probeChiefTtsApi({ config: payload, text: sample })
              if (res && res.ok && res.audioBase64) {
                setTtsProbeMsg(`✅ ${bi('试听成功', 'Ready')} · ${res.latencyMs || 0}ms · ${((Number(res.bytes) || 0) / 1024).toFixed(1)}KB`)
                await playChiefAudioBase64(res.audioBase64, res.mimeType || 'audio/wav', {
                  itemId: 'probe:settings',
                  label: bi('语音试听', 'Voice Test'),
                  provider: res.provider || payload.provider,
                  speed: payload.speed || 1.0,
                  volume: payload.volume ?? 0.9,
                })
              } else {
                setTtsProbeMsg(`⚠️ ${(res && res.error) || bi('试听失败', 'Probe failed')}`)
              }
            } finally {
              void fetchChiefTtsStatusApi()
              setTtsProbeBusy(false)
            }
          }
          const provBadge = ttsProv === 'deepseek'
            ? `DeepSeek · ${ttsVoice}`
            : (ttsProv === 'openai-compat' ? `OpenAI · ${ttsVoice}` : bi('本机系统语音', 'System Voice'))

          return h(
            AccCard,
            {
              open: true,
              onToggle: null,
              tone: 'indigo',
              icon: h(Icon, { name: 'volume', size: 13.5, style: { color: 'var(--dnb-accent)' } }),
              title: bi('语音参谋长（TTS 播报与语音面聊）', 'Voice Chief (TTS & Voice Chat)'),
              badges: h('span', { className: 'dnb-acc-badge', 'data-tone': effTts.enabled ? 'accent' : undefined }, provBadge),
              preview: effTts.enabled
                ? [
                    effTts.autoSpeakAlerts ? bi('重要提醒开口说', 'Spoken alerts') : '',
                    effTts.autoSpeakReplies ? bi('新回复自动播', 'Auto replies') : '',
                  ].filter(Boolean).join(' · ') || bi('点击单条可朗读', 'Click reply to speak')
                : bi('按需点读可用，自动播报未开', 'Manual click ready · Auto off'),
              bodyStyle: { padding: '9px 11px 11px', display: 'flex', flexDirection: 'column', gap: 9 },
            },
            // Engine selector
            h(
              'div',
              null,
              h('div', { style: { fontSize: 11.5, fontWeight: 500, color: 'var(--dnb-text-2)', marginBottom: 5 } },
                bi('发音引擎', 'Speech Engine')),
              h(
                'div',
                { className: 'dnb-seg', style: { padding: 2 } },
                [
                  { key: 'deepseek', label: bi('DeepSeek 官方', 'DeepSeek API') },
                  { key: 'openai-compat', label: bi('OpenAI 兼容', 'OpenAI Compat') },
                  { key: 'browser', label: bi('本机系统语音', 'System Voice') },
                ].map(opt =>
                  h('button', {
                    key: opt.key,
                    type: 'button',
                    className: 'dnb-seg-btn',
                    style: { padding: '4px 7px', fontSize: 11 },
                    'data-active': ttsProv === opt.key ? '1' : '0',
                    onClick: () => setTtsField({
                      provider: opt.key,
                      voiceId: opt.key === 'deepseek' ? 'stella' : (opt.key === 'openai-compat' ? 'alloy' : effTts.voiceId),
                      format: opt.key === 'deepseek' ? 'wav' : (opt.key === 'openai-compat' ? 'mp3' : effTts.format),
                    }),
                  }, opt.label),
                ),
              ),
            ),

            // DeepSeek panel
            ttsProv === 'deepseek'
              ? h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: 7 } },
                  hostDs
                    ? (() => {
                        let dsTone = 'amber'
                        let dsText = bi(`⚠️ 未检测到 DSH 官方登录或 ${hostDs.apiKeyEnv || 'DEEPSEEK_API_KEY'}：可在 DSH 登录账号、填密钥或改用本机系统语音`,
                          `⚠️ No DSH login or ${hostDs.apiKeyEnv || 'DEEPSEEK_API_KEY'} found: sign in, enter a key, or use System Voice`)
                        if (savedTts.hasApiKey) {
                          dsTone = lastDsErr ? 'amber' : 'green'
                          dsText = lastDsErr
                            ? bi(`⚠️ 自定义密钥上次试听异常：${lastDsErr}`, `⚠️ Custom key probe failed: ${lastDsErr}`)
                            : bi('✅ 已就绪：使用自定义密钥', '✅ Ready: Custom key saved')
                        } else if (hostDs.authMode === 'dsh-account') {
                          dsTone = lastDsErr ? 'amber' : 'green'
                          dsText = lastDsErr
                            ? bi(`⚠️ 已识别 DSH 官方登录凭据，但上次试听异常：${lastDsErr}`,
                                `⚠️ DSH official account detected, but probe failed: ${lastDsErr}`)
                            : bi('✅ 已自动复用 DSH 官方登录凭据（语音合成与语音转写均可直连，免填 Key）',
                                '✅ Ready: Reusing signed-in DSH official account credentials')
                        } else if (hostDs.configured) {
                          if (lastDsErr) {
                            dsTone = 'amber'
                            dsText = bi(`⚠️ 检测到宿主 ${hostDs.apiKeyEnv || 'DEEPSEEK_API_KEY'}，但上次试听异常：${lastDsErr}`,
                              `⚠️ Host ${hostDs.apiKeyEnv || 'DEEPSEEK_API_KEY'} detected, but probe failed: ${lastDsErr}`)
                          } else if (dsVerifiedOk) {
                            dsTone = 'green'
                            dsText = bi(`✅ 已验证宿主 ${hostDs.apiKeyEnv || 'DEEPSEEK_API_KEY'} 可用`,
                              `✅ Verified host ${hostDs.apiKeyEnv || 'DEEPSEEK_API_KEY'}`)
                          } else {
                            dsTone = undefined
                            dsText = bi(`ℹ️ 已检测到宿主 ${hostDs.apiKeyEnv || 'DEEPSEEK_API_KEY'}（尚未验证，点下方「🔊 试听测试」验证）`,
                              `ℹ️ Host ${hostDs.apiKeyEnv || 'DEEPSEEK_API_KEY'} detected (click Test Voice below to verify)`)
                          }
                        }
                        return h('div', {
                          className: 'dnb-tts-status-pill',
                          ...(dsTone ? { 'data-tone': dsTone } : {}),
                        }, dsText)
                      })()
                    : null,
                  (ttsStatusInfo && ttsStatusInfo.stt)
                    ? h('div', {
                        className: 'dnb-tts-status-pill',
                        'data-tone': (ttsStatusInfo.stt.local && ttsStatusInfo.stt.local.ready)
                          ? 'green'
                          : (ttsStatusInfo.stt.deepseekAsr && !lastDsAuthFail ? undefined : 'amber'),
                      },
                        ttsStatusInfo.stt.local && ttsStatusInfo.stt.local.ready
                          ? bi(`🎙️ 语音输入已就绪：优先使用 DSH 本地离线识别（${ttsStatusInfo.stt.local.providerId || 'SenseVoice'}）`,
                               `🎙️ Voice Input Ready: Local DSH STT (${ttsStatusInfo.stt.local.providerId || 'SenseVoice'})`)
                          : (ttsStatusInfo.stt.deepseekAsr
                              ? bi('🎙️ 语音输入将使用 DeepSeek 云端转写（受上方 DeepSeek 凭据有效性影响）', '🎙️ Voice Input: DeepSeek Cloud ASR')
                              : bi('🎙️ 本地语音模型未准备且无 DeepSeek 凭据，将使用浏览器语音识别', '🎙️ Falling back to browser speech recognition')))
                    : null,
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' } },
                h('span', { style: { fontSize: 11.5, color: 'var(--dnb-text-2)' } }, bi('声线选择', 'Voice')),
                h(
                  'div',
                  { style: { display: 'flex', gap: 4, flexWrap: 'wrap' } },
                  [
                    { id: 'stella', label: bi('Stella · 女声', 'Stella · Female') },
                    { id: 'tide', label: bi('Tide · 男声', 'Tide · Male') },
                  ].map(v =>
                    h('button', {
                      key: v.id,
                      type: 'button',
                      className: 'dnb-mini-btn',
                      'data-tone': ttsVoice === v.id ? 'accent' : undefined,
                      onClick: () => setTtsField({ voiceId: v.id }),
                    }, v.label),
                  ),
                ),
              ),
              h(
                'div',
                { className: 'dnb-cell', style: { justifyContent: 'space-between', padding: '4px 0', borderBottom: 'none' } },
                h('span', { style: { fontSize: 11.5, color: 'var(--dnb-text-2)' } },
                  bi('自动过滤 Markdown 符号（避免念出星号反引号）', 'Filter Markdown symbols automatically')),
                h(Switch, {
                  checked: effTts.filterMarkdown !== false,
                  onChange: on => setTtsField({ filterMarkdown: on }),
                }),
              ),
              h('button', {
                type: 'button',
                className: 'dnb-mini-btn',
                style: { alignSelf: 'flex-start' },
                onClick: () => setTtsAdvOpen(v => !v),
              }, ttsAdvOpen ? bi('▾ 收起自定义密钥 / 代理地址', '▾ Hide custom key & base URL') : bi('▸ 自定义密钥或代理地址（可选）', '▸ Custom API Key / Base URL (optional)')),
              ttsAdvOpen
                ? h(
                    'div',
                    { className: 'dnb-tts-field-grid' },
                    h('input', {
                      className: 'dnb-input',
                      style: { height: 27, fontSize: 11.5 },
                      placeholder: bi('Base URL（默认 api.deepseek.com）', 'Base URL (default api.deepseek.com)'),
                      value: effTts.baseUrl || '',
                      onChange: e => setTtsField({ baseUrl: e.target.value }),
                    }),
                    h('div', { style: { display: 'flex', gap: 4 } },
                      h('input', {
                        type: 'password',
                        className: 'dnb-input',
                        style: { height: 27, fontSize: 11.5, flex: 1 },
                        placeholder: savedTts.hasApiKey ? bi('已加密保存（留空不改）', 'Saved (leave blank to keep)') : bi('专用 API Key（可选）', 'Dedicated API Key (optional)'),
                        value: effTts.apiKey || '',
                        onChange: e => setTtsField({ apiKey: e.target.value, clearApiKey: false }),
                      }),
                      savedTts.hasApiKey
                        ? h('button', {
                            type: 'button',
                            className: 'dnb-mini-btn',
                            onClick: () => void saveTtsNow({ apiKey: '', clearApiKey: true }),
                          }, bi('清除', 'Clear'))
                        : null,
                    ),
                  )
                : null,
            )
          : null,

        // OpenAI-compatible panel
        ttsProv === 'openai-compat'
          ? h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 7 } },
              h(
                'div',
                { style: { display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' } },
                h('span', { style: { fontSize: 11, color: 'var(--dnb-text-3)' } }, bi('一键预设：', 'Presets:')),
                h('button', {
                  type: 'button',
                  className: 'dnb-mini-btn',
                  onClick: () => setTtsField({ baseUrl: 'http://127.0.0.1:8880/v1', model: 'kokoro', voiceId: 'zf_xiaobei', format: 'mp3' }),
                }, bi('本地 Kokoro / Edge-TTS', 'Local Kokoro / Edge-TTS')),
                h('button', {
                  type: 'button',
                  className: 'dnb-mini-btn',
                  onClick: () => setTtsField({ baseUrl: 'https://api.openai.com/v1', model: 'tts-1', voiceId: 'alloy', format: 'mp3' }),
                }, 'OpenAI TTS'),
              ),
              h(
                'div',
                { className: 'dnb-tts-field-grid' },
                h('input', {
                  className: 'dnb-input',
                  style: { height: 27, fontSize: 11.5 },
                  placeholder: 'Base URL (http://127.0.0.1:8880/v1)',
                  value: effTts.baseUrl || '',
                  onChange: e => setTtsField({ baseUrl: e.target.value }),
                }),
                h('input', {
                  className: 'dnb-input',
                  style: { height: 27, fontSize: 11.5 },
                  placeholder: bi('模型（如 tts-1 / kokoro）', 'Model (e.g. tts-1)'),
                  value: effTts.model || 'tts-1',
                  onChange: e => setTtsField({ model: e.target.value }),
                }),
                h('input', {
                  className: 'dnb-input',
                  style: { height: 27, fontSize: 11.5 },
                  placeholder: bi('音色（如 alloy / nova）', 'Voice (e.g. alloy)'),
                  value: effTts.voiceId || 'alloy',
                  onChange: e => setTtsField({ voiceId: e.target.value }),
                }),
                h('select', {
                  className: 'dnb-input',
                  style: { height: 27, fontSize: 11.5 },
                  value: ['mp3', 'wav', 'opus'].includes(effTts.format) ? effTts.format : 'mp3',
                  onChange: e => setTtsField({ format: e.target.value }),
                },
                  h('option', { value: 'mp3' }, 'mp3'),
                  h('option', { value: 'wav' }, 'wav'),
                  h('option', { value: 'opus' }, 'opus'),
                ),
                h('input', {
                  className: 'dnb-input',
                  style: { height: 27, fontSize: 11.5 },
                  placeholder: bi('环境变量名（如 OPENAI_API_KEY）', 'Env var (e.g. OPENAI_API_KEY)'),
                  value: effTts.apiKeyEnv || '',
                  onChange: e => setTtsField({ apiKeyEnv: e.target.value }),
                }),
                h('div', { style: { display: 'flex', gap: 4 } },
                  h('input', {
                    type: 'password',
                    className: 'dnb-input',
                    style: { height: 27, fontSize: 11.5, flex: 1 },
                    placeholder: savedTts.hasApiKey ? bi('已加密保存（留空不改）', 'Saved (leave blank to keep)') : bi('API Key（本地免填）', 'API Key (optional locally)'),
                    value: effTts.apiKey || '',
                    onChange: e => setTtsField({ apiKey: e.target.value, clearApiKey: false }),
                  }),
                  savedTts.hasApiKey
                    ? h('button', {
                        type: 'button',
                        className: 'dnb-mini-btn',
                        onClick: () => void saveTtsNow({ apiKey: '', clearApiKey: true }),
                      }, bi('清除', 'Clear'))
                    : null,
                ),
              ),
            )
          : null,

        // Browser system speech panel
        ttsProv === 'browser'
          ? h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
              h('div', { style: { fontSize: 11, color: 'var(--dnb-text-3)' } },
                bi('使用系统自带语音合成，完全本地离线、零额外 API 花费。', 'Uses OS built-in speech synthesis: completely offline with zero API cost.')),
              h('select', {
                className: 'dnb-input',
                style: { height: 28, fontSize: 11.5 },
                value: effTts.browserVoice || '',
                onChange: e => setTtsField({ browserVoice: e.target.value }),
              },
                h('option', { value: '' }, bi('自动按中/英文匹配系统声线', 'Auto-match system voice by language')),
                browserVoices.map(v =>
                  h('option', { key: v.name, value: v.name }, `${v.name}${v.lang ? ` (${v.lang})` : ''}`)),
              ),
            )
          : null,

        // Speed, volume, and auto-speak switches
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', paddingTop: 6, borderTop: '1px solid var(--dnb-border)' } },
          h('span', { style: { fontSize: 11.5, color: 'var(--dnb-text-2)' } }, bi('语速', 'Speed')),
          h(
            'div',
            { style: { display: 'flex', gap: 4 } },
            [0.85, 1.0, 1.15, 1.3].map(sp =>
              h('button', {
                key: sp,
                type: 'button',
                className: 'dnb-mini-btn',
                'data-tone': Math.abs((Number(effTts.speed) || 1.0) - sp) < 0.03 ? 'accent' : undefined,
                onClick: () => setTtsField({ speed: sp }),
              }, `${sp}x`),
            ),
          ),
          h('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
            h('span', { style: { fontSize: 11.5, color: 'var(--dnb-text-2)' } }, bi('音量', 'Vol')),
            h('input', {
              type: 'range',
              min: 0.1,
              max: 1.0,
              step: 0.05,
              value: effTts.volume ?? 0.9,
              style: { width: 72 },
              onChange: e => setTtsField({ volume: Number(e.target.value) }),
            }),
            h('span', { style: { fontSize: 11, color: 'var(--dnb-text-3)', minWidth: 30 } }, `${Math.round((effTts.volume ?? 0.9) * 100)}%`),
          ),
        ),

        h(
          'div',
          { className: 'dnb-cell', style: { justifyContent: 'space-between', padding: '4px 0' } },
          h('div', { style: { minWidth: 0 } },
            h('div', { style: { fontSize: 12 } }, bi('开启自动语音播报总开关', 'Enable automatic voice announcements')),
            h('div', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)' } },
              bi('单条消息旁的 🔊 按钮随时可用；打开此项后才会在后台自动出声', 'Manual 🔊 buttons always work; turn this on for automatic speech'))),
          h(Switch, {
            checked: Boolean(effTts.enabled),
            onChange: on => void saveTtsNow({ enabled: on }),
          }),
        ),
        effTts.enabled
          ? h(
              React.Fragment,
              null,
              h(
                'div',
                { className: 'dnb-cell', style: { justifyContent: 'space-between', padding: '4px 0' } },
                h('span', { style: { fontSize: 12 } }, bi('重要节点自动口语播报（审批/拦截/停机）', 'Speak key alerts automatically')),
                h(Switch, {
                  checked: Boolean(effTts.autoSpeakAlerts),
                  onChange: on => void saveTtsNow({ autoSpeakAlerts: on }),
                }),
              ),
              h(
                'div',
                { className: 'dnb-cell', style: { justifyContent: 'space-between', padding: '4px 0' } },
                h('span', { style: { fontSize: 12 } }, bi('参谋新回复自动播报', 'Auto-speak new Chief replies')),
                h(Switch, {
                  checked: Boolean(effTts.autoSpeakReplies),
                  onChange: on => void saveTtsNow({ autoSpeakReplies: on }),
                }),
              ),
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 } },
                h('span', { style: { fontSize: 11.5, color: 'var(--dnb-text-2)' } }, bi('自动播报口语风格', 'Auto speech style')),
                h(
                  'div',
                  { className: 'dnb-seg', style: { padding: 2 } },
                  [
                    { key: 'brief', label: bi('简洁口语简报', 'Brief Summary') },
                    { key: 'full', label: bi('完整朗读', 'Full Text') },
                  ].map(opt =>
                    h('button', {
                      key: opt.key,
                      type: 'button',
                      className: 'dnb-seg-btn',
                      style: { padding: '3px 8px', fontSize: 11 },
                      'data-active': (effTts.speechStyle || 'brief') === opt.key ? '1' : '0',
                      onClick: () => void saveTtsNow({ speechStyle: opt.key }),
                    }, opt.label),
                  ),
                ),
              ),
            )
          : null,
        h(
          'div',
          { className: 'dnb-cell', style: { justifyContent: 'space-between', padding: '4px 0', borderBottom: 'none' } },
          h('span', { style: { fontSize: 11.5, color: 'var(--dnb-text-2)' } }, bi('云端不可用时自动降级本机系统语音', 'Fallback to system voice if cloud fails')),
          h(Switch, {
            checked: effTts.fallbackToBrowser !== false,
            onChange: on => void saveTtsNow({ fallbackToBrowser: on }),
          }),
        ),
        h(
          'div',
          { className: 'dnb-cell', style: { justifyContent: 'space-between', padding: '4px 0', borderBottom: 'none' } },
          h('div', null,
            h('div', { style: { fontSize: 11.5, color: 'var(--dnb-text-2)' } }, bi('语音模式默认开启免提连续聊（VAD 自动收发）', 'Hands-free auto-VAD in Voice Mode')),
            h('div', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)' } }, bi('说完停顿自动发送，播报完自动续听，开口即聊。', 'Auto-sends after pause and resumes listening after reply.')),
          ),
          h(Switch, {
            checked: Boolean(effTts.handsFreeVad),
            onChange: on => void saveTtsNow({ handsFreeVad: on }),
          }),
        ),
        effTts.handsFreeVad
          ? h(
              'div',
              { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' } },
              h('span', { style: { fontSize: 11, color: 'var(--dnb-text-3)' } }, bi('说话停顿判定时长', 'Pause detection delay')),
              h(
                'div',
                { className: 'dnb-seg', style: { padding: 2 } },
                [
                  { ms: 900, label: '0.9s' },
                  { ms: 1300, label: '1.3s' },
                  { ms: 2000, label: '2.0s' },
                ].map(opt =>
                  h('button', {
                    key: opt.ms,
                    type: 'button',
                    className: 'dnb-seg-btn',
                    style: { padding: '2px 8px', fontSize: 10.5 },
                    'data-active': (Number(effTts.vadSilenceMs) || 1300) === opt.ms ? '1' : '0',
                    onClick: () => void saveTtsNow({ vadSilenceMs: opt.ms }),
                  }, opt.label),
                ),
              ),
            )
          : null,

        // Action row
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', paddingTop: 4 } },
          h('button', {
            type: 'button',
            className: 'dnb-pill dnb-primary',
            style: { height: 27, padding: '0 11px', fontSize: 11.5 },
            onClick: () => void saveTtsNow(),
          }, bi('保存语音配置', 'Save Voice Settings')),
          h('button', {
            type: 'button',
            className: 'dnb-pill',
            style: { height: 27, padding: '0 10px', fontSize: 11.5 },
            disabled: ttsProbeBusy,
            onClick: () => void runTtsProbe(),
          }, ttsProbeBusy ? bi('合成中…', 'Testing…') : bi('🔊 试听测试', '🔊 Test Voice')),
          (ttsPlayer.status === 'playing' || ttsPlayer.status === 'loading')
            ? h('button', {
                type: 'button',
                className: 'dnb-pill',
                style: { height: 27, padding: '0 10px', fontSize: 11.5 },
                onClick: () => stopChiefSpeech(),
              }, bi('⏹ 停止', '⏹ Stop'))
            : null,
          ttsProbeMsg
            ? h('span', {
                style: {
                  fontSize: 11,
                  color: ttsProbeMsg.startsWith('✅') ? 'var(--dnb-sage)' : 'var(--dnb-amber)',
                  lineHeight: 1.35,
                },
              }, ttsProbeMsg)
            : null,
        ),
      )
        })()
      : null,

    // ---------------- TAB 3: ALERTS & REMOTE PAGER ----------------
    settingsTab === 'notify'
      ? h(
          React.Fragment,
          null,
          h(
            AccCard,
            {
              open: notifyOpen,
              onToggle: () => setNotifyOpen(v => !v),
              tone: 'amber',
              title: bi('离开电脑时的提醒、声音与标题角标', 'Desktop Alerts, Sound & Tab Badge'),
              badges: h('span', { className: 'dnb-acc-badge', 'data-tone': notifPerm === 'granted' ? 'green' : undefined }, notifPermLabel),
              preview: meta.notifyEnabled !== false ? bi('重要节点会通知你', 'Alerts on') : bi('通知已关', 'Alerts off'),
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
            h(
              'div',
              { className: 'dnb-cell', style: { justifyContent: 'space-between' } },
              h('div', { style: { minWidth: 0 } },
                h('div', { style: { fontSize: 12.5 } }, bi('切走页面时闪烁网页标题角标（🔔 需要你）', 'Flash browser tab badge when away (🔔)')),
                h('div', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', marginTop: 1 } },
                  bi('你切去别的标签页时在标题栏闪烁提示，回来查看会自动恢复原标题', 'Alerts in tab bar when page is hidden and clears on focus')),
              ),
              h(Switch, {
                checked: tabBadgeOn,
                onChange: on => {
                  setTabBadgeOn(setTabTitleBadgeEnabled(on))
                },
              }),
            ),
            h(
              'div',
              { style: { padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 } },
              h('button', {
                type: 'button',
                className: 'dnb-pill',
                style: { height: 26, padding: '0 10px', fontSize: 11.5 },
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
                      body: bi('提醒与网页标题角标工作正常（看顶部标签标题）。', 'Alerts and tab badge verified.'),
                    },
                    { sound: true, flashTitle: tabBadgeOn },
                  )
                  patch({ notice: res.toast })
                },
              }, bi('🔔 测试桌面提醒与标题角标', '🔔 Test Alert & Tab Badge')),
            ),
          ),

          // Mobile Remote Pager (Feishu / DingTalk / WeCom / Telegram / Discord / Webhook)
          (() => {
            const savedPager = (meta.remotePager && typeof meta.remotePager === 'object') ? meta.remotePager : {}
            const effPager = pagerDraft ? { ...savedPager, ...pagerDraft } : savedPager
            const effEvents = (effPager.events && typeof effPager.events === 'object') ? effPager.events : {}
            const ch = effPager.channel || 'feishu'
            const pagerInfo = view.pagerStatusInfo || null
            const pagerRt = (pagerInfo && pagerInfo.runtime) || {}
            const chLabels = {
              feishu: bi('飞书', 'Feishu'),
              dingtalk: bi('钉钉', 'DingTalk'),
              wecom: bi('企业微信', 'WeCom'),
              telegram: 'Telegram',
              discord: 'Discord',
              webhook: bi('通用 Webhook', 'Webhook'),
            }
            const setPagerField = (fields) => {
              setPagerDraft(prev => ({ ...savedPager, ...(prev || {}), ...fields }))
            }
            const setPagerEventField = (evKey, val) => {
              setPagerField({
                events: {
                  approvalRequired: effEvents.approvalRequired !== false,
                  wallBlocked: effEvents.wallBlocked !== false,
                  hazardHalt: effEvents.hazardHalt !== false,
                  taskDone: effEvents.taskDone !== false,
                  budgetBreak: effEvents.budgetBreak !== false,
                  [evKey]: Boolean(val),
                },
              })
            }
            const buildPagerSavePayload = (extraPatch = null) => {
              const merged = { ...savedPager, ...(pagerDraft || {}), ...(extraPatch || {}) }
              delete merged.hasWebhookUrl
              delete merged.webhookHostHint
              delete merged.hasSecret
              delete merged.hasTelegramBotToken
              return merged
            }
            const savePagerNow = async (extraPatch = null) => {
              const payload = buildPagerSavePayload(extraPatch)
              const res = await updateSecConfig({ remotePager: payload })
              if (res && res.ok !== false) {
                setPagerDraft(null)
                void fetchRemotePagerStatusApi()
              }
              return res
            }
            const runPagerTest = async () => {
              setPagerBusy(true)
              setPagerMsg('')
              try {
                const payload = buildPagerSavePayload()
                const res = await testRemotePagerApi({ config: payload })
                setPagerMsg(res && res.ok
                  ? `✅ ${bi('测试消息已送达手机', 'Delivered')} · ${res.latencyMs || 0}ms`
                  : `⚠️ ${(res && res.error) || bi('发送失败', 'Failed')}`)
              } finally {
                setPagerBusy(false)
              }
            }
            const pushDigestNow = async () => {
              setPagerBusy(true)
              setPagerMsg('')
              try {
                const narText = (view.narrative && view.narrative.text) || ''
                const payload = buildPagerSavePayload()
                const res = await sendRemotePagerDigestApi({
                  config: payload,
                  title: bi('桌面工作台当前进展速报', 'Current Task Progress'),
                  body: narText ? clampTitle(narText, 240) : bi('参谋长工作台一切正常运行中。', 'DSH Chief workspace running smoothly.'),
                })
                setPagerMsg(res && res.ok
                  ? `✅ ${bi('已推送当前进展到手机', 'Digest sent')} · ${res.latencyMs || 0}ms`
                  : `⚠️ ${(res && res.error) || bi('推送失败', 'Failed')}`)
              } finally {
                setPagerBusy(false)
              }
            }

            return h(
              AccCard,
              {
                open: pagerOpen,
                onToggle: () => setPagerOpen(v => !v),
                tone: 'teal',
                icon: h(Icon, { name: 'globe', size: 13.5, style: { color: 'var(--dnb-sage)' } }),
                title: bi('手机远程传呼（离家挂机推送）', 'Mobile Remote Pager'),
                badges: h('span', { className: 'dnb-acc-badge', 'data-tone': effPager.enabled ? 'green' : undefined },
                  effPager.enabled ? `${chLabels[ch] || ch} · ON` : bi('未开启', 'Off')),
                preview: effPager.enabled
                  ? `${chLabels[ch] || ch}${savedPager.webhookHostHint ? ` · ${savedPager.webhookHostHint}` : ''}${pagerRt.sentCount ? ` · ${bi(`已发 ${pagerRt.sentCount} 次`, `${pagerRt.sentCount} sent`)}` : ''}`
                  : bi('挂机撞墙、需要你审批或收工休眠时，秒推通知到手机', 'Push alerts to Feishu, DingTalk, WeCom, Telegram or Discord'),
                bodyStyle: { padding: '9px 11px 11px', display: 'flex', flexDirection: 'column', gap: 9 },
              },
              h(
                'div',
                { className: 'dnb-cell', style: { justifyContent: 'space-between', padding: '4px 0', borderBottom: 'none' } },
                h('span', { style: { fontSize: 11.5, fontWeight: 500, color: 'var(--dnb-text-2)' } },
                  bi('开启自动传呼推送到手机', 'Enable automatic mobile alerts')),
                h(Switch, {
                  checked: Boolean(effPager.enabled),
                  onChange: on => void savePagerNow({ enabled: on }),
                }),
              ),
              h(
                'div',
                null,
                h('div', { style: { fontSize: 11.5, fontWeight: 500, color: 'var(--dnb-text-2)', marginBottom: 5 } },
                  bi('接收通道', 'Channel')),
                h(
                  'div',
                  { style: { display: 'flex', gap: 4, flexWrap: 'wrap' } },
                  ['feishu', 'dingtalk', 'wecom', 'telegram', 'discord', 'webhook'].map(k =>
                    h('button', {
                      key: k,
                      type: 'button',
                      className: 'dnb-mini-btn',
                      'data-tone': ch === k ? 'accent' : undefined,
                      onClick: () => setPagerField({ channel: k }),
                    }, chLabels[k]),
                  ),
                ),
              ),
              ch === 'telegram'
                ? h(
                    'div',
                    { className: 'dnb-tts-field-grid' },
                    h('div', { style: { display: 'flex', gap: 4 } },
                      h('input', {
                        type: showTgToken ? 'text' : 'password',
                        className: 'dnb-input',
                        style: { height: 27, fontSize: 11.5, flex: 1 },
                        placeholder: savedPager.hasTelegramBotToken ? bi('Bot Token 已加密保存（留空不改）', 'Token saved (blank to keep)') : 'Telegram Bot Token',
                        value: effPager.telegramBotToken || '',
                        onChange: e => setPagerField({ telegramBotToken: e.target.value, clearTelegramBotToken: false }),
                      }),
                      h('button', {
                        type: 'button',
                        className: 'dnb-mini-btn',
                        title: showTgToken ? bi('隐藏 Token', 'Hide') : bi('显示 Token', 'Show'),
                        onClick: () => setShowTgToken(v => !v),
                      }, showTgToken ? bi('隐藏', 'Hide') : bi('显示', 'Show')),
                      savedPager.hasTelegramBotToken
                        ? h('button', {
                            type: 'button',
                            className: 'dnb-mini-btn',
                            onClick: () => void savePagerNow({ telegramBotToken: '', clearTelegramBotToken: true }),
                          }, bi('清除', 'Clear'))
                        : null,
                    ),
                    h('input', {
                      className: 'dnb-input',
                      style: { height: 27, fontSize: 11.5 },
                      placeholder: bi('Chat ID（如 123456789）', 'Telegram Chat ID'),
                      value: effPager.telegramChatId || '',
                      onChange: e => setPagerField({ telegramChatId: e.target.value }),
                    }),
                  )
                : h(
                    'div',
                    { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                    h('div', { style: { display: 'flex', gap: 4 } },
                      h('input', {
                        type: showWebhookUrl ? 'text' : 'password',
                        className: 'dnb-input',
                        style: { height: 27, fontSize: 11.5, flex: 1 },
                        placeholder: savedPager.hasWebhookUrl
                          ? bi(`推送地址已加密保存（${savedPager.webhookHostHint || '已配置'}，留空不改）`, `Webhook saved (${savedPager.webhookHostHint || 'configured'})`)
                          : bi('粘贴群机器人推送地址 (https://...)', 'Paste Webhook URL (https://...)'),
                        value: effPager.webhookUrl || '',
                        onChange: e => setPagerField({ webhookUrl: e.target.value, clearWebhookUrl: false }),
                      }),
                      h('button', {
                        type: 'button',
                        className: 'dnb-mini-btn',
                        title: showWebhookUrl ? bi('隐藏链接', 'Mask URL') : bi('显示链接', 'Show URL'),
                        onClick: () => setShowWebhookUrl(v => !v),
                      }, showWebhookUrl ? bi('隐藏', 'Hide') : bi('显示', 'Show')),
                      savedPager.hasWebhookUrl
                        ? h('button', {
                            type: 'button',
                            className: 'dnb-mini-btn',
                            onClick: () => void savePagerNow({ webhookUrl: '', clearWebhookUrl: true }),
                          }, bi('清除', 'Clear'))
                        : null,
                    ),
                    (ch === 'feishu' || ch === 'dingtalk' || ch === 'webhook')
                      ? h('div', { style: { display: 'flex', gap: 4 } },
                          h('input', {
                            type: showPagerSecret ? 'text' : 'password',
                            className: 'dnb-input',
                            style: { height: 27, fontSize: 11.5, flex: 1 },
                            placeholder: savedPager.hasSecret
                              ? bi('安全密钥已加密保存（留空不改）', 'Secret saved (blank to keep)')
                              : bi('安全签名密钥（选填，用于校验消息来源）', 'Optional signing Secret'),
                            value: effPager.secret || '',
                            onChange: e => setPagerField({ secret: e.target.value, clearSecret: false }),
                          }),
                          h('button', {
                            type: 'button',
                            className: 'dnb-mini-btn',
                            title: showPagerSecret ? bi('隐藏密钥', 'Hide') : bi('显示密钥', 'Show'),
                            onClick: () => setShowPagerSecret(v => !v),
                          }, showPagerSecret ? bi('隐藏', 'Hide') : bi('显示', 'Show')),
                          savedPager.hasSecret
                            ? h('button', {
                                type: 'button',
                                className: 'dnb-mini-btn',
                                onClick: () => void savePagerNow({ secret: '', clearSecret: true }),
                              }, bi('清除', 'Clear'))
                            : null,
                        )
                      : null,
                  ),
              h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                h('div', { style: { fontSize: 11, fontWeight: 500, color: 'var(--dnb-text-2)' } },
                  bi('触发传呼的重要节点', 'Alert Triggers')),
                h(
                  'div',
                  { style: { display: 'flex', gap: 5, flexWrap: 'wrap' } },
                  [
                    { key: 'approvalRequired', label: bi('🔐 需要你审批/提权', 'Approvals') },
                    { key: 'wallBlocked', label: bi('🧱 安全墙拦停', 'Guard Wall') },
                    { key: 'hazardHalt', label: bi('🚨 高危急停', 'Hazard Halt') },
                    { key: 'taskDone', label: bi('🌙 托管休眠/完成', 'Task Done') },
                    { key: 'budgetBreak', label: bi('🛑 预算熔断', 'Budget Cap') },
                  ].map(ev =>
                    h('button', {
                      key: ev.key,
                      type: 'button',
                      className: 'dnb-mini-btn',
                      'data-tone': effEvents[ev.key] !== false ? 'accent' : undefined,
                      onClick: () => setPagerEventField(ev.key, effEvents[ev.key] === false),
                    }, ev.label),
                  ),
                ),
              ),
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', paddingTop: 2 } },
                h('button', {
                  type: 'button',
                  className: 'dnb-pill dnb-primary',
                  style: { height: 27, padding: '0 11px', fontSize: 11.5 },
                  onClick: () => void savePagerNow(),
                }, bi('保存传呼配置', 'Save Pager Config')),
                h('button', {
                  type: 'button',
                  className: 'dnb-pill',
                  style: { height: 27, padding: '0 10px', fontSize: 11.5 },
                  disabled: pagerBusy,
                  onClick: () => void runPagerTest(),
                }, pagerBusy ? bi('发送中…', 'Testing…') : bi('📱 发测试消息到手机', '📱 Send Test')),
                h('button', {
                  type: 'button',
                  className: 'dnb-pill',
                  style: { height: 27, padding: '0 10px', fontSize: 11.5 },
                  disabled: pagerBusy,
                  onClick: () => void pushDigestNow(),
                }, bi('📤 推当前进展', '📤 Push Digest')),
                pagerMsg
                  ? h('span', {
                      style: {
                        fontSize: 11,
                        color: pagerMsg.startsWith('✅') ? 'var(--dnb-sage)' : 'var(--dnb-amber)',
                        lineHeight: 1.35,
                      },
                    }, pagerMsg)
                  : null,
              ),
            )
          })(),
        )
      : null,

    // ---------------- TAB 4: SAFETY & LEDGER ----------------
    settingsTab === 'safety'
      ? h(
          React.Fragment,
          null,
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
      : null,
  )
}

/* -------------------------------------------------------- Boundaries Tab */
