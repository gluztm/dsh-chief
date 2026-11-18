/**
 * tabs/plan.js
 *
 * Plan, Memory, Notes, and Handoff sub-tabs.
 */

import { React, h } from '../react-runtime.js'
import { MEMORY_SECTIONS } from '../constants.js'
import { store, patch } from '../store.js'
import { clampTitle, shortSession, timeLabel } from '../utils.js'
import {
  call,
  updateSecConfig,
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
  loadMemory,
  askMemory,
  addMemory,
  removeMemory,
  askLeadModel,
  copyText,
} from '../api.js'
import { Icon, Switch, ObjectiveRadarStrip, renderStructuredText } from '../components/common.js'

export function PlanTab({ board }) {
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
      patch({ notice: setGoal ? '🎯 已设为长期目标并开启督导' : '核心目标已保存' })
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
        patch({ error: '请先输入本阶段核心目标，再开启目标督导' })
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
    patch({ notice: '已退出目标督导，切回标准计划推进模式' })
  }

  const keepIds = list => list.map(s => ({ id: s.id, text: s.text, done: s.done }))
  const pushSteps = next => void act({ action: 'plan.set', steps: next })

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
      const reply = (out && (out.reply || out.answer || out.text)) || '暂无更多上下文记录，可点「问主模型」由主对话直接解答。'
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
    const next = keepIds(steps).concat([{ text: clean, done: false }])
    pushSteps(next)
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

  return h(
    'div',
    { className: 'dnb-view' },
    h(ObjectiveRadarStrip, { board, compact: true }),

    // ==================== Zone 1: Long-Term Objective & Goal Supervision Box ====================
    h(
      'div',
      {
        className: 'dnb-section-head',
        style: { alignItems: 'center', gap: 6, marginBottom: 6 },
      },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } },
        h('span', { style: { fontWeight: 600, color: 'var(--dnb-text)' } }, '核心目标'),
        isInterventionLocked
          ? h('span', {
              style: {
                padding: '1px 7px',
                borderRadius: 99,
                fontSize: 10.5,
                fontWeight: 600,
                background: 'rgba(245, 158, 11, 0.18)',
                color: '#fbbf24',
                border: '1px solid rgba(245, 158, 11, 0.36)',
              },
            }, '🔒 强介入锁定目的地')
          : null,
        isGoalMode
          ? h('span', {
              style: {
                padding: '1px 7px',
                borderRadius: 99,
                fontSize: 10.5,
                fontWeight: 600,
                background: 'rgba(245, 158, 11, 0.16)',
                color: '#fbbf24',
              },
            }, '🎯 目标督导中')
          : null,
        board && board.objectiveAt && objective === null
          ? h('span', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)' } }, timeLabel(board.objectiveAt))
          : null,
      ),
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 } },
        h('button', {
          className: 'dnb-pill',
          style: {
            height: 23,
            padding: '0 8px',
            fontSize: 11,
            borderColor: isGoalMode ? 'rgba(245, 158, 11, 0.45)' : 'rgba(10, 132, 255, 0.35)',
            background: isGoalMode ? 'rgba(245, 158, 11, 0.14)' : 'rgba(10, 132, 255, 0.09)',
            color: isGoalMode ? '#fbbf24' : 'var(--dnb-accent)',
            fontWeight: 600,
          },
          title: isGoalMode
            ? '退出目标督导并切回标准计划模式'
            : '设为长期目标并开启督导：达成后需您拍板结项才结束',
          onClick: toggleGoalMode,
        }, isGoalMode ? '退出目标' : '🎯 设为目标'),
        h('button', {
          className: 'dnb-pill dnb-pill-accent',
          style: { height: 23, padding: '0 9px', fontSize: 11 },
          title: '根据长期目标让模型拆解可视化金字塔任务图并派发子代理',
          onClick: () => {
            const goalText = (current || '').trim()
            const prompt = (goalText ? `针对长期目标「${goalText.slice(0, 100)}」，` : '')
              + '请调用 chief_board 的 graph.plan 拆解带 parentId 与 blockedBy 的可视化任务图，并用 task.dispatch 将就绪节点并行派发给子代理团队。'
            void askLeadModel(prompt, '拆解任务图')
            patch({ tab: 'tasks' })
          },
        }, h(Icon, { name: 'sparkles', size: 12 }), '拆解任务图'),
      ),
    ),
    h(
      'div',
      {
        className: 'dnb-group',
        style: (isInterventionLocked || isGoalMode)
          ? {
              borderColor: 'rgba(245, 158, 11, 0.45)',
              boxShadow: '0 0 0 1px rgba(245, 158, 11, 0.12)',
            }
          : undefined,
      },
      h('textarea', {
        className: 'dnb-bare-area',
        readOnly: isInterventionLocked,
        style: isInterventionLocked
          ? { opacity: 0.9, cursor: 'not-allowed', color: 'var(--dnb-text)' }
          : undefined,
        placeholder: isInterventionLocked
          ? '主动强介入进行中，核心目标已锁定…'
          : '输入当前阶段核心目标，点击右上「🎯 设为目标」即可开启持续督导…',
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
                padding: '5px 10px 7px',
                borderTop: '1px solid var(--dnb-border)',
                fontSize: 11,
                color: (isInterventionLocked || isGoalMode) ? '#fbbf24' : 'var(--dnb-text-3)',
              },
            },
            h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
              isInterventionLocked
                ? '🔒 强介入监督目的地已锁定：所有自动介入均以本目标为终局，关闭强介入可解锁'
                : isGoalMode
                  ? '🎯 目标督导生效中：达成后将向您请示结项，未获批准不自动退回'
                  : '标准计划推进模式（点击右上「🎯 设为目标」开启持续督导）'),
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 } },
              isInterventionLocked
                ? h('button', {
                    className: 'dnb-pill',
                    style: { height: 21, padding: '0 8px', fontSize: 10.5, borderColor: 'rgba(245, 158, 11, 0.42)', color: '#fbbf24' },
                    title: '关闭主动强介入以解锁修改核心目标',
                    onClick: () => void updateSecConfig({ emergencyStopIntervention: true }),
                  }, '🔓 停用强介入以解锁')
                : null,
              !isInterventionLocked && objective !== null
                ? h('button', {
                    className: 'dnb-pill dnb-pill-accent',
                    style: { height: 21, padding: '0 8px', fontSize: 10.5 },
                    onClick: saveObjective,
                  }, '保存')
                : null,
              (current || '').trim()
                ? h('button', {
                    className: 'dnb-pill',
                    style: { height: 21, padding: '0 8px', fontSize: 10.5 },
                    title: '让模型用大白话解释这个长期目标的核心问题与解决思路',
                    onClick: () => {
                      void askLeadModel(
                        `请用通俗易懂的大白话给我解释一下当前核心目标「${String(current).trim().slice(0, 120)}」：核心卡点是什么、整体打算怎么解决？`,
                        '咨询核心目标',
                      )
                    },
                  }, '咨询目标')
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
            `检测到您修改了核心目标，下方小任务板还有 ${steps.length} 条旧步骤：`),
          h(
            'div',
            { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
            h('button', {
              type: 'button',
              className: 'dnb-mini-btn',
              'data-tone': 'amber',
              onClick: () => void commitObjective(Boolean(view.planResetPrompt.setGoal), true),
            }, '清空旧步骤并重来'),
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
          h('div', { style: { fontSize: 12, fontWeight: 700, color: '#30d158' } }, '🎯 参谋长判定目标已达标 · 等待您拍板结项'),
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
              }, '验证依据：' + goalApproval.evidence)
            : null,
          rejectingGoal
            ? h(
                'div',
                { style: { display: 'flex', gap: 5, marginTop: 2 } },
                h('input', {
                  className: 'dnb-input',
                  style: { height: 26, fontSize: 11.5, flex: 1 },
                  placeholder: '填写驳回原因或补充要求…',
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
                }, '提交驳回'),
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
                }, '↩ 驳回继续'),
              ),
        )
      : null,

    // ==================== Zone 2: Small Task Board (Steps + Consultation) ====================
    h(
      'div',
      { className: 'dnb-section-head', style: { marginTop: 14, alignItems: 'baseline' } },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'baseline', gap: 6 } },
        h('span', { style: { fontWeight: 600, color: 'var(--dnb-text)' } }, '小任务板'),
        h('span', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', fontWeight: 400 } }, '点条目可问含义与原因'),
      ),
      steps.length ? h('span', null, `${doneCount} / ${steps.length}`) : null,
    ),
    steps.length > 0
      ? h(
          React.Fragment,
          null,
          h(
            'div',
            { className: 'dnb-progress', style: { marginBottom: 8 } },
            h('div', { style: { width: (doneCount / steps.length) * 100 + '%', background: '#30d158', transition: 'width 0.3s ease' } }),
          ),
          h(
            'div',
            { className: 'dnb-group' },
            steps.map((step, i) => {
              const isConsulting = consultIdx === i
              const secReply = secAnswers[i] || ''
              const isSecAsking = secAskingIdx === i

              return h(
                React.Fragment,
                { key: step.id || i },
                h(
                  'div',
                  {
                    className: 'dnb-cell dnb-cell-hover',
                    style: { cursor: 'pointer' },
                    title: '点击打开咨询与操作菜单（可问这条是什么意思、为什么有这步）',
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
                      title: step.done ? '点击标回未完成' : '点击标记已完成',
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
                    step.text || '',
                  ),
                  h(
                    'span',
                    { className: 'dnb-row-actions', style: { gap: 4 } },
                    h('button', {
                      className: 'dnb-pill',
                      style: { height: 22, padding: '0 7px', fontSize: 11, color: 'var(--dnb-accent)' },
                      title: '让模型用大白话解释这条是什么意思、为什么有这个步骤',
                      onClick: e => {
                        e.stopPropagation()
                        void askLeadModel(buildExplainPrompt(step.text, i), '咨询步骤含义')
                      },
                    }, '解释'),
                    h('button', {
                      className: 'dnb-pill',
                      'data-active': isConsulting ? '1' : '0',
                      style: { height: 22, padding: '0 7px', fontSize: 11 },
                      title: '展开咨询框，自由提问关于这一步的任何疑问',
                      onClick: e => {
                        e.stopPropagation()
                        setConsultIdx(isConsulting ? -1 : i)
                        setConsultDraft('')
                      },
                    }, '咨询'),
                  ),
                ),

                // Inline Consultation Drawer for this step
                isConsulting
                  ? h(
                      'div',
                      {
                        style: {
                          padding: '8px 11px 9px',
                          background: 'rgba(10, 132, 255, 0.05)',
                          borderTop: '1px solid var(--dnb-border)',
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
                          placeholder: '自由输入对这一步的疑问（回车问主模型）…',
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
                        }, '问模型'),
                        h('button', {
                          className: 'dnb-pill',
                          style: { height: 27, padding: '0 8px', fontSize: 11, flexShrink: 0, color: 'var(--dnb-accent)' },
                          disabled: isSecAsking,
                          title: '不打断主对话，让 DSH 参谋长结合上下文直接在此处下方给出通俗解答',
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

                // Inline Chief Answer Card (when requested without interrupting main chat)
                (isSecAsking || secReply)
                  ? h(
                      'div',
                      {
                        style: {
                          padding: '8px 11px 9px',
                          background: 'rgba(128, 128, 136, 0.08)',
                          borderTop: '1px solid var(--dnb-border)',
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
                          isSecAsking ? '✦ DSH 参谋长正在结合上下文解读此步…' : '✦ DSH 参谋长步骤解读'),
                        !isSecAsking
                          ? h('button', {
                              className: 'dnb-icon-btn',
                              style: { width: 18, height: 18 },
                              title: '收起解读',
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
            }),

            // Quick append step input at bottom of Small Task Board
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
                placeholder: '添加一条小任务步骤（回车新增）…',
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
          h('div', { className: 'dnb-empty', style: { padding: '16px 12px 10px' } }, '小任务板暂无步骤（模型调用 todo_write / plan.set 时会自动同步到这里）'),
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
              placeholder: '手动添加一条小任务步骤（回车新增）…',
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

    // ==================== Zone 3: Cross-Session Handoff & One-Click Chief Deployment ====================
    (() => {
      const targets = Array.isArray(view.targets) ? view.targets : []
      const options = [{ id: 'new', label: '新建独立会话并部署参谋' }].concat(
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
        ? { label: '✏️ 人类手改', tone: 'accent' }
        : hSource === 'chief'
          ? { label: '✦ 参谋已同步', tone: 'green' }
          : { label: '自动渲染', tone: undefined }

      const buildTransferOpts = () => ({
        deployChief: true,
        archiveTransferPolicy: policy,
        archiveDrawer: policy === 'drawer' ? (view.deployDrawer || (drawers[0] && drawers[0].id) || 'inbox') : '',
      })

      return h(
        React.Fragment,
        null,
        h('div', { className: 'dnb-section-head', style: { marginTop: 14 } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
            h('span', { style: { fontWeight: 600, color: 'var(--dnb-text)' } }, '🚀 跨会话接力 & 一键部署参谋'),
            h('span', {
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
          ),
          h('button', {
            type: 'button',
            className: 'dnb-mini-btn',
            'data-tone': isPinned ? 'amber' : undefined,
            title: isPinned
              ? '已定住交接单：参谋长摘要更新时不会覆盖您手写/审定的内容，点击可解除定住'
              : '定住交接单后，参谋长提炼摘要时将禁止自动覆写交接单',
            onClick: () => void toggleHandoffPin(!isPinned),
          }, isPinned ? '📌 已定住(禁参谋改)' : '📌 定住防改'),
        ),
        h(
          'div',
          { className: 'dnb-group', style: { padding: 10, display: 'flex', flexDirection: 'column', gap: 8 } },
          h(
            'div',
            { style: { fontSize: 11, color: 'var(--dnb-text-2)' } },
            '工作档案跟随策略（同步模型/纪律/战术开关，强介入默认安全置关）：',
          ),
          h(
            'div',
            { style: { display: 'flex', gap: 4, flexWrap: 'wrap' } },
            [
              { key: 'none', label: '不带工作档案' },
              { key: 'mounted', label: '仅挂桌面备查' },
              { key: 'drawer', label: '带整个抽屉' },
              { key: 'all', label: '全柜工作档案' },
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
                ? drawers.map(d => h('option', { key: d.id, value: d.id }, `${d.label} (${d.count || 0} 卷)`))
                : [h('option', { key: 'inbox', value: 'inbox' }, '未归类收件箱 (加载抽屉中…)')])
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
            }, '🚀 新建窗口并部署参谋长'),
            h('button', {
              type: 'button',
              className: 'dnb-pill',
              style: { height: 30, padding: '0 10px', fontSize: 11.5 },
              disabled: Boolean(view.handoffBusy),
              onClick: async () => {
                const text = store.handoffText || (await loadHandoff())?.text || ''
                if (text) copyText(text, '自包含交接单已复制')
              },
            }, h(Icon, { name: 'copy', size: 12 }), '复制交接单'),
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
            }, '投递并部署'),
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
              }, view.handoffEditing ? '收起编辑' : '✏️ 编辑交接单'),
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
                    title: '放弃手工版本，恢复由系统与参谋实时渲染交接单',
                    onClick: () => void resetHandoffAuto(),
                  }, '↺ 恢复自动')
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
                  placeholder: '在此手动修订交接单（支持 Markdown）。可点击下方「保存并定住」防止被参谋长自动覆写…',
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
            }, '✦ 让参谋长当场解读（不打断主对话）'),
            h('div', {
              className: 'dnb-menu-item',
              onClick: () => {
                setContextMenu(null)
                setConsultIdx(idx)
                setConsultDraft('')
              },
            }, '💬 针对此步自由提问…'),
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
            }, isDone ? '询问这步具体结果' : '询问进度'),
            isDone
              ? h('div', {
                  className: 'dnb-menu-item',
                  onClick: () => {
                    setContextMenu(null)
                    const next = keepIds(steps)
                    next[idx] = { ...next[idx], done: false }
                    pushSteps(next)
                  },
                }, '标回未完成')
              : h('div', {
                  className: 'dnb-menu-item',
                  onClick: () => {
                    setContextMenu(null)
                    void askLeadModel(
                      `请核验小任务板第 ${idx + 1} 步「${stepTitle}」是否已完成，若已完成请勾选并记录验证依据。`,
                      '核验勾选步骤',
                    )
                  },
                }, '请模型勾选完成'),
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

/* ----------------------------------------------------------- Memory Tab */

function MemoryCard({ item }) {
  const open = store.memOpen === item.id
  const body = String(item.text || '')
  return h(
    'div',
    { className: 'dnb-cell dnb-cell-hover', style: { alignItems: 'flex-start', flexDirection: 'column', gap: 4 } },
    h(
      'div',
      { style: { display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 6 } },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 6 } },
        h('span', { className: 'dnb-tag' }, item.turn ? '第 ' + item.turn + ' 轮' : '手动'),
        h('span', { style: { fontSize: 11, color: 'var(--dnb-text-3)' } }, timeLabel(item.at)),
      ),
      h(
        'div',
        { className: 'dnb-row-actions' },
        body.length > 140
          ? h('button', {
              className: 'dnb-pill',
              style: { height: 22, padding: '0 7px', fontSize: 11 },
              onClick: () => patch({ memOpen: open ? '' : item.id }),
            }, open ? '收起' : '展开')
          : null,
        h('button', {
          className: 'dnb-icon-btn',
          style: { width: 22, height: 22, color: '#ff453a' },
          onClick: () => void removeMemory(item.id),
        }, h(Icon, { name: 'trash', size: 12 })),
      ),
    ),
    item.title ? h('div', { style: { fontWeight: 600, fontSize: 12.5 } }, item.title) : null,
    h(
      'div',
      { style: { fontSize: 12, color: 'var(--dnb-text-2)', lineHeight: 1.5, whiteSpace: 'pre-wrap' } },
      open || body.length <= 140 ? body : body.slice(0, 140) + '…',
    ),
  )
}

export function MemoryTab() {
  React.useEffect(() => {
    if (!store.memSections.length && !store.memBusy) void loadMemory()
  }, [store.sessionId])

  const runAsk = () => {
    if (!(store.memAsk || '').trim()) return
    void askMemory(store.memAsk)
  }

  const sections = Array.isArray(store.memSections) ? store.memSections : []

  return h(
    'div',
    { className: 'dnb-view' },
    // Top Search & Add Bar
    h(
      'div',
      { style: { display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10 } },
      h('input', {
        className: 'dnb-input',
        style: { borderRadius: 99, paddingLeft: 12, height: 32 },
        placeholder: '检索记忆…',
        value: store.memAsk || '',
        onChange: e => patch({ memAsk: e.target.value, memReply: '', memHits: null, memNote: '' }),
        onKeyDown: e => { if (e.key === 'Enter') runAsk() },
      }),
      (store.memAsk || '').trim()
        ? h('button', { className: 'dnb-primary-btn', style: { height: 30 }, onClick: runAsk }, '查询')
        : null,
      h('button', {
        className: 'dnb-pill',
        style: { height: 30 },
        'data-active': store.memComposerOpen ? '1' : '0',
        onClick: () => patch({ memComposerOpen: !store.memComposerOpen }),
      }, h(Icon, { name: 'plus', size: 13 }), '记录'),
    ),

    store.memReply
      ? h('div', { className: 'dnb-group' }, h('pre', { className: 'dnb-pre' }, store.memReply))
      : null,

    // Collapsible New Memory Composer
    store.memComposerOpen
      ? h(
          'div',
          { className: 'dnb-group', style: { padding: 10, marginBottom: 12 } },
          h(
            'div',
            { style: { display: 'flex', gap: 6, marginBottom: 6 } },
            h('input', {
              className: 'dnb-input',
              placeholder: '标题（选填）',
              value: store.memTitle || '',
              onChange: e => patch({ memTitle: e.target.value }),
            }),
            h('select', {
              className: 'dnb-input',
              style: { width: 118, flexShrink: 0 },
              value: store.memSection || 'other',
              onChange: e => patch({ memSection: e.target.value }),
            }, MEMORY_SECTIONS.map(s => h('option', { key: s.key, value: s.key }, s.label))),
          ),
          h('textarea', {
            className: 'dnb-area',
            placeholder: '输入需要持久记住的结论或约束…',
            value: store.memText || '',
            onChange: e => patch({ memText: e.target.value }),
          }),
          h(
            'div',
            { style: { display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 } },
            h('button', { className: 'dnb-pill', onClick: () => patch({ memComposerOpen: false }) }, '取消'),
            h('button', { className: 'dnb-primary-btn', disabled: !(store.memText || '').trim(), onClick: () => void addMemory() }, '保存'),
          ),
        )
      : null,

    sections.length
      ? sections.map(section =>
          h(
            'div',
            { key: section.key, style: { marginBottom: 10 } },
            h('div', { className: 'dnb-section-head' }, h('span', null, section.label), h('span', null, (section.items || []).length)),
            h('div', { className: 'dnb-group' }, (section.items || []).map(item => h(MemoryCard, { item, key: item.id }))),
          ),
        )
      : h('div', { className: 'dnb-empty' }, '暂无记忆条目'),
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
      placeholder: '标签（逗号分隔）',
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
                    if (!confirm('删除笔记「' + clampTitle(note.title || note.body, 16) + '」？')) return
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
      : h('div', { className: 'dnb-empty' }, '暂无工作笔记'),
  )
}

/* -------------------------------------- Engineering Memory Archive Tab (档案柜) */

export function HandoffTab({ view }) {
  React.useEffect(() => {
    void loadTargets()
  }, [view.sessionId])

  return h(
    'div',
    { className: 'dnb-view' },
    // Guard Preferences (Cross-session handoff now lives in `规划` Zone 3)
    h('div', { className: 'dnb-section-head' },
      h('span', { style: { fontWeight: 600, color: 'var(--dnb-text)' } }, '自动化守护偏好'),
      h('span', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', fontWeight: 400 } }, '跨会话接力已收口至「规划」页底部'),
    ),
    h(
      'div',
      { className: 'dnb-group' },
      h(
        'div',
        { className: 'dnb-cell', style: { justifyContent: 'space-between' } },
        h('span', { style: { fontSize: 12.5 } }, '每轮自动注入摘要'),
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
        h('span', { style: { fontSize: 12.5 } }, '空转自动提醒'),
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
        h('span', { style: { fontSize: 12.5 } }, '单会话提醒上限'),
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
        h('span', { style: { fontSize: 12.5 } }, '短回复字数线'),
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
