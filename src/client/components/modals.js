/**
 * components/modals.js
 *
 * Popovers, SuggestionBanner, and all safety/risk/approval/elevation/audit confirmation modals.
 */

import { React, h } from '../react-runtime.js'
import { CHIEF_PERMISSION_LABELS, INTERVENTION_TIER_DESC } from '../constants.js'
import { patch, focusSecInput } from '../store.js'
import {
  normalizeMaxTurnsVal,
  clampTitle,
  shortSession,
  fullModelWithChannel,
  shortAgentName,
} from '../utils.js'
import {
  call,
  loadChiefView,
  updateSecConfig,
  decideApproval,
  decideElevation,
  togglePeerSessionLink,
  decideSuggestion,
  executePendingSuggestions,
  dismissPendingSuggestions,
  prefillSuggestion,
  submitChiefBar,
  precipitateArchivesApi,
  relayArchivesWithChiefApi,
  distillToGlobalApi,
  approveGoalApi,
  rejectGoalApi,
  transfer,
} from '../api.js'
import { Icon, renderStructuredText } from './common.js'

export function ModelPickerPopover({ view }) {
  if (!view.secModelMenuOpen) return null
  const catalog = view.secModelsCatalog || (view.secView && view.secView.models) || null
  const currentRef = (view.chiefMeta && view.chiefMeta.modelRef) || ''
  const followRef = (catalog && (catalog.followRef || catalog.defaultRef))
    || (view.chiefMeta && view.chiefMeta.followModelRef)
    || ''
  const followProvider = followRef.includes('/') ? followRef.split('/')[0] : ''
  const followSubtitle = (catalog && catalog.followLabel) || fullModelWithChannel(followRef, catalog)

  const providers = []
  if (catalog && Array.isArray(catalog.providers) && catalog.providers.length) {
    providers.push(...catalog.providers)
  } else if (catalog && Array.isArray(catalog.models)) {
    const byProv = new Map()
    for (const item of catalog.models) {
      if (!item || !item.ref) continue
      const pid = item.provider || item.ref.split('/')[0] || 'default'
      if (!byProv.has(pid)) {
        byProv.set(pid, { id: pid, label: item.providerName || pid, needsKey: Boolean(item.needsKey), models: [] })
      }
      const group = byProv.get(pid)
      if (!item.needsKey) group.needsKey = false
      group.models.push({
        ref: item.ref,
        id: item.id || item.ref,
        label: item.name || item.label || item.id || item.ref,
        isCurrentLead: Boolean(item.isCurrentLead) || item.ref === followRef,
        needsKey: Boolean(item.needsKey),
      })
    }
    providers.push(...byProv.values())
    // Float the main conversation's active provider to the very top, sink unkeyed providers to the bottom
    providers.sort((a, b) => {
      const aLead = a.id === followProvider ? 1 : 0
      const bLead = b.id === followProvider ? 1 : 0
      if (aLead !== bLead) return bLead - aLead
      const aUnkeyed = a.needsKey ? 1 : 0
      const bUnkeyed = b.needsKey ? 1 : 0
      return aUnkeyed - bUnkeyed
    })
  }

  return h(
    React.Fragment,
    null,
    h('div', {
      style: { position: 'fixed', inset: 0, zIndex: 9998 },
      onClick: () => patch({ secModelMenuOpen: false }),
    }),
    h(
      'div',
      {
        className: 'dnb-menu',
        style: {
          position: 'absolute',
          top: 42,
          right: 12,
          minWidth: 244,
          maxWidth: 310,
          maxHeight: 340,
          overflowY: 'auto',
          zIndex: 9999,
        },
      },
      h('div', { style: { padding: '5px 10px 4px', fontSize: 10.5, fontWeight: 600, color: 'var(--dnb-text-3)' } }, '选择参谋长专职模型'),
      h(
        'div',
        {
          className: 'dnb-menu-item',
          style: { justifyContent: 'space-between', gap: 8, fontWeight: !currentRef ? 600 : 400, color: !currentRef ? 'var(--dnb-accent)' : undefined },
          onClick: () => {
            patch({ secModelMenuOpen: false })
            void updateSecConfig({ modelRef: '' })
          },
        },
        h('div', { style: { minWidth: 0, flex: 1 } },
          h('div', null, '✦ 自动跟随主对话模型'),
          followSubtitle
            ? h('div', {
                style: { fontSize: 10.5, color: 'var(--dnb-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                title: followRef,
              }, followSubtitle)
            : null,
        ),
        !currentRef ? h(Icon, { name: 'check', size: 13 }) : null,
      ),
      providers.map(prov =>
        h(
          'div',
          { key: prov.id, style: { marginTop: 4, paddingTop: 4, borderTop: '1px solid var(--dnb-border)', opacity: prov.needsKey ? 0.6 : 1 } },
          h(
            'div',
            { style: { padding: '3px 10px', fontSize: 10.5, color: 'var(--dnb-text-3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 } },
            h('span', null, prov.label || prov.id),
            prov.id === followProvider
              ? h('span', { style: { fontSize: 9.5, color: 'var(--dnb-accent)', fontWeight: 600 } }, '主对话渠道')
              : (prov.needsKey ? h('span', { style: { fontSize: 9.5 } }, '未配密钥') : null),
          ),
          (prov.models || []).map(mod => {
            const active = currentRef === mod.ref
            return h(
              'div',
              {
                key: mod.ref,
                className: 'dnb-menu-item',
                title: mod.ref,
                style: { justifyContent: 'space-between', gap: 6, fontWeight: active ? 600 : 400, color: active ? 'var(--dnb-accent)' : undefined },
                onClick: () => {
                  patch({ secModelMenuOpen: false })
                  void updateSecConfig({ modelRef: mod.ref })
                },
              },
              h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 } }, mod.label || mod.id),
              mod.isCurrentLead
                ? h('span', {
                    style: {
                      fontSize: 9.5,
                      padding: '1px 5px',
                      borderRadius: 99,
                      background: 'rgba(10,132,255,0.14)',
                      color: 'var(--dnb-accent)',
                      flexShrink: 0,
                    },
                  }, '主对话')
                : null,
              active ? h(Icon, { name: 'check', size: 13 }) : null,
            )
          }),
        ),
      ),
      !providers.length
        ? h('div', { style: { padding: '8px 10px', fontSize: 11, color: 'var(--dnb-text-3)' } },
            catalog ? '未检测到额外模型提供商，将自动跟随主对话模型。' : '加载模型列表中…')
        : null,
    ),
  )
}

export function PacePickerPopover({ view }) {
  if (!view.secPaceMenuOpen) return null
  const meta = view.chiefMeta || {}
  const currentPace = meta.paceMode || (meta.autoPilot ? 'auto' : 'manual')
  const PACE_OPTIONS = [
    {
      key: 'manual',
      title: '⏸ 按需手动（默认 · 省 Token）',
      desc: '开着面板绝不后台自动总结或空转；仅在你点「提炼摘要」、浓缩边界或在下方参谋栏发话时才调模型。',
    },
    {
      key: 'smart',
      title: '👁 关键巡检（智能节流）',
      desc: '摘要仍由你手动点；仅在代理撞墙报错或多代理关键节点冷却巡检（忽略内部检查点）。',
    },
    {
      key: 'auto',
      title: '⚡ 全自动托管',
      desc: '仅限本对话生效：自动打理本局档案/非定住边界/阶段摘要，主代理与子代理完工且摘要收尾后自动停机防空转（开启需确认）。',
    },
    {
      key: 'stopped',
      title: '⏹ 停止参谋长（暂停自动化）',
      desc: '暂停后台强介入推跑、空转拦截与断线自动续跑；保留手动问答与手工档案操作，可随时切回恢复。',
    },
  ]
  return h(
    React.Fragment,
    null,
    h('div', {
      style: { position: 'fixed', inset: 0, zIndex: 9998 },
      onClick: () => patch({ secPaceMenuOpen: false }),
    }),
    h(
      'div',
      {
        className: 'dnb-menu',
        style: {
          position: 'absolute',
          top: 42,
          right: 12,
          width: 280,
          zIndex: 9999,
        },
      },
      h('div', { style: { padding: '5px 10px 4px', fontSize: 10.5, fontWeight: 600, color: 'var(--dnb-text-3)' } }, '参谋长工作节奏控制'),
      PACE_OPTIONS.map(opt => {
        const active = currentPace === opt.key
        return h(
          'div',
          {
            key: opt.key,
            className: 'dnb-menu-item',
            style: {
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 8,
              padding: '7px 10px',
              color: active ? 'var(--dnb-accent)' : undefined,
            },
            onClick: () => {
              if (opt.key === 'auto' && currentPace !== 'auto') {
                patch({ secPaceMenuOpen: false, autoPilotConfirmOpen: true })
                return
              }
              patch({ secPaceMenuOpen: false })
              void updateSecConfig({ paceMode: opt.key })
            },
          },
          h('div', { style: { minWidth: 0, flex: 1 } },
            h('div', { style: { fontSize: 12, fontWeight: active ? 600 : 500, marginBottom: 2 } }, opt.title),
            h('div', { style: { fontSize: 10.5, lineHeight: 1.4, color: 'var(--dnb-text-3)', whiteSpace: 'normal' } }, opt.desc),
          ),
          active ? h(Icon, { name: 'check', size: 13, style: { marginTop: 2 } }) : null,
        )
      }),
    ),
  )
}

function describeSuggestionMeta(sug) {
  if (!sug) return { typeLabel: '参谋建议', impact: '协同调整', expect: '按建议推进', tone: 'var(--dnb-accent)', bg: 'rgba(10, 132, 255, 0.12)' }
  if (sug.kind === 'goal_approval') {
    return {
      typeLabel: '🎯 目标结项请示',
      impact: '影响：锁定/完结当前主目标与验收状态',
      expect: '预期：核心目标标为达成并停止继续催跑',
      tone: '#30d158',
      bg: 'rgba(48, 209, 88, 0.12)',
    }
  }
  if (sug.kind === 'bound') {
    const colLabel = sug.boundField === 'allowed' ? '必做事项' : (sug.boundField === 'notes' ? '注意事项' : '禁止红线')
    const repCount = Array.isArray(sug.replaces) ? sug.replaces.filter(Boolean).length : 0
    return {
      typeLabel: repCount > 0 ? `🏛 边界浓缩 (${repCount} 合 1)` : `🏛 ${colLabel}请示`,
      impact: sug.pinGlobal ? '影响：📌 全局定住边界（跨所有任务生效）' : '影响：本任务会话工作边界（实时生效）',
      expect: repCount > 0 ? `预期：替换并清理 ${repCount} 条零散旧边界` : `预期：写入${colLabel}并广播全体代理遵照执行`,
      tone: '#fbbf24',
      bg: 'rgba(245, 158, 11, 0.12)',
    }
  }
  if (sug.kind === 'advice') {
    return {
      typeLabel: '💡 参谋长主动建议',
      impact: `影响：向 @${shortAgentName(sug.targetLabel || sug.target || '主对话')} 递交协同建议`,
      expect: '预期：按建议纠偏方向或补全缺失验证步骤',
      tone: 'var(--dnb-accent)',
      bg: 'rgba(10, 132, 255, 0.12)',
    }
  }
  return {
    typeLabel: '✦ 参谋协同建议',
    impact: `影响：向 @${shortAgentName(sug.targetLabel || sug.target || '主对话')} 发送${sug.mode === 'steer' ? '实时插话' : '顺延指令'}`,
    expect: '预期：按拟定草案执行下一步动作并同步看板',
    tone: 'var(--dnb-accent)',
    bg: 'rgba(10, 132, 255, 0.10)',
  }
}

export function SuggestionBanner({ view }) {
  const rawSuggestions = (view.secView && Array.isArray(view.secView.suggestions))
    ? view.secView.suggestions.filter(s => s && s.status === 'pending')
    : []
  const rankSug = s => (s.kind === 'goal_approval' ? 0 : s.kind === 'bound' ? 1 : 2)
  const suggestions = [...rawSuggestions].sort((a, b) => rankSug(a) - rankSug(b))
  const [expandedId, setExpandedId] = React.useState('')
  const [unselectedIds, setUnselectedIds] = React.useState({})

  if (!suggestions.length) return null

  const selectedList = suggestions.filter(s => !unselectedIds[s.id])
  const selectedGoalCount = selectedList.filter(s => s.kind === 'goal_approval').length
  const selectedNonGoalCount = selectedList.length - selectedGoalCount
  const canExecuteCount = selectedList.length

  const toggleSelect = (id) => {
    setUnselectedIds(prev => {
      const next = { ...prev }
      if (next[id]) delete next[id]
      else next[id] = true
      return next
    })
  }

  return h(
    'div',
    { className: 'dnb-sug-group' },
    // Unified single top action bar
    h(
      'div',
      { className: 'dnb-sug-top' },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flexWrap: 'wrap' } },
        h('span', { style: { fontSize: 12, fontWeight: 700, color: 'var(--dnb-text)' } },
          `💡 参谋长建议 (${suggestions.length})`),
        h('span', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)' } },
          `已勾选 ${canExecuteCount}/${suggestions.length} 项 · 统一执行并产出回执`),
      ),
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 } },
        h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: { height: 26, padding: '0 9px', fontSize: 11, color: 'var(--dnb-text-3)' },
          disabled: Boolean(view.secBusy),
          title: '忽略当前全部待处理建议',
          onClick: () => void dismissPendingSuggestions(suggestions),
        }, '全部忽略'),
        h('button', {
          type: 'button',
          className: 'dnb-primary-btn',
          style: { height: 26, padding: '0 12px', fontSize: 11.5, fontWeight: 700 },
          disabled: Boolean(view.secBusy) || canExecuteCount === 0,
          title: selectedGoalCount > 0 && selectedNonGoalCount > 0
            ? '在当前权限与红线范围内批量执行所选建议（含目标结项请示）并统一汇报回执'
            : '在当前权限与红线范围内统一执行所选建议并输出执行回执',
          onClick: () => void executePendingSuggestions({
            ids: selectedList.map(s => s.id),
            includeGoalApproval: selectedGoalCount > 0,
          }),
        }, view.secBusy ? '执行中…' : `▶ 执行建议 (${canExecuteCount})`),
      ),
    ),

    // Read-only informative suggestion items (NO per-item execute buttons)
    suggestions.slice(0, 6).map(sug => {
      const meta = describeSuggestionMeta(sug)
      const isChecked = !unselectedIds[sug.id]
      const openDraft = expandedId === sug.id
      const replacesList = Array.isArray(sug.replaces) ? sug.replaces.filter(Boolean) : []
      const statusLabel = sug.status === 'applied' ? '已执行' : (sug.status === 'dismissed' ? '已忽略' : '待执行')

      return h(
        'div',
        {
          key: sug.id,
          className: 'dnb-sug-card',
          style: {
            borderColor: isChecked ? undefined : 'var(--dnb-border)',
            opacity: isChecked ? 1 : 0.72,
          },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 4 } },
          h(
            'label',
            { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, cursor: 'pointer', flex: 1 } },
            h('input', {
              type: 'checkbox',
              checked: isChecked,
              onChange: () => toggleSelect(sug.id),
            }),
            h('span', {
              className: 'dnb-tag',
              style: { color: meta.tone, background: meta.bg, fontSize: 10.5, fontWeight: 700 },
            }, meta.typeLabel),
            sug.targetLabel
              ? h('span', { className: 'dnb-tag', style: { fontSize: 10.5 } }, '@' + shortAgentName(sug.targetLabel, true))
              : null,
            h('span', { className: 'dnb-tag', style: { fontSize: 10, color: 'var(--dnb-text-2)' } }, statusLabel),
          ),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 } },
            sug.draftText
              ? h('button', {
                  type: 'button',
                  className: 'dnb-mini-btn',
                  onClick: () => setExpandedId(openDraft ? '' : sug.id),
                }, openDraft ? '收起内容' : '详情')
              : null,
            h('button', {
              type: 'button',
              className: 'dnb-icon-btn',
              style: { width: 20, height: 20 },
              title: '忽略此条建议',
              onClick: () => void decideSuggestion(sug, 'dismiss'),
            }, h(Icon, { name: 'x', size: 12 })),
          ),
        ),
        h('div', { style: { fontSize: 12.2, fontWeight: 600, color: 'var(--dnb-text)', lineHeight: 1.45, marginBottom: 3 } }, sug.title),
        sug.reason
          ? h('div', { style: { fontSize: 11.2, color: 'var(--dnb-text-2)', lineHeight: 1.45, marginBottom: 4 } },
              '原因：' + sug.reason)
          : null,
        h(
          'div',
          { className: 'dnb-sug-meta-row' },
          h('span', { className: 'dnb-tag', style: { fontSize: 10.5 } }, meta.impact),
          h('span', { className: 'dnb-tag', style: { fontSize: 10.5 } }, meta.expect),
        ),
        replacesList.length > 0
          ? h('div', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', marginTop: 4 } },
              `整合替代 ${replacesList.length} 条旧规：` + replacesList.slice(0, 3).map(r => '「' + clampTitle(r, 14) + '」').join('、'))
          : null,
        openDraft && sug.draftText
          ? h('div', {
              style: {
                padding: '6px 9px',
                marginTop: 6,
                borderRadius: 8,
                background: 'var(--dnb-card)',
                border: '1px solid var(--dnb-border)',
                fontSize: 11.5,
                color: 'var(--dnb-text-2)',
                whiteSpace: 'pre-wrap',
              },
            }, renderStructuredText(sug.draftText))
          : null,
      )
    }),
  )
}

export function InterventionConfirmModal({ view, board }) {
  const meta = view.chiefMeta || {}
  const tm = meta.tacticalModes || {}
  const rawBounds = (board && board.bounds) || (view.board && view.board.bounds) || {}
  const savedBoardObj = (board && board.objective) ? String(board.objective).trim() : ''
  const forbiddenList = (Array.isArray(rawBounds.forbidden) ? rawBounds.forbidden : [])
    .map(f => (typeof f === 'string' ? f.trim() : String((f && f.text) || '').trim()))
    .filter(Boolean)

  const [objDraft, setObjDraft] = React.useState(savedBoardObj)
  const [objLocked, setObjLocked] = React.useState(false)
  const [suggestBusy, setSuggestBusy] = React.useState(false)
  const [suggestHistory, setSuggestHistory] = React.useState([])
  const [lastAiText, setLastAiText] = React.useState('')
  const [lastWasAiGuess, setLastWasAiGuess] = React.useState(false)
  const [suggestRationale, setSuggestRationale] = React.useState('')
  const [confirmBusy, setConfirmBusy] = React.useState(false)

  React.useEffect(() => {
    if (!view.interventionModalOpen) return
    setObjDraft(savedBoardObj)
    setObjLocked(false)
    setSuggestBusy(false)
    setSuggestHistory([])
    setLastAiText('')
    setLastWasAiGuess(false)
    setSuggestRationale('')
    setConfirmBusy(false)
  }, [view.interventionModalOpen])

  if (!view.interventionModalOpen) return null
  const permMode = ['advisor', 'assistant', 'strategist', 'chief'].includes(meta.permissionMode) ? meta.permissionMode : 'advisor'
  const trimmedDraft = String(objDraft || '').trim()
  const missingPrerequisite = !trimmedDraft || forbiddenList.length === 0

  const handleSuggestObjective = async () => {
    if (suggestBusy) return
    if (objLocked) {
      patch({ notice: '当前核心目标输入框已锁定，请先点击「解锁」后再点建议或微调' })
      return
    }
    const curText = String(objDraft || '').trim()
    const shouldGuess = !curText || (lastWasAiGuess && lastAiText && curText === lastAiText.trim())
    const nextMode = shouldGuess ? 'guess' : 'refine'
    setSuggestBusy(true)
    try {
      const out = await call('chief/suggest-objective', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          session: view.sessionId,
          draft: curText,
          mode: nextMode,
          previousSuggestions: suggestHistory,
        }),
      })
      if (out && out.suggestion) {
        const nextText = String(out.suggestion).trim()
        setObjDraft(nextText)
        setLastAiText(nextText)
        setLastWasAiGuess(nextMode === 'guess')
        setSuggestHistory(prev => prev.concat(nextText).slice(-12))
        setSuggestRationale(String(out.rationale || ''))
      }
    } catch (error) {
      patch({ error: String((error && error.message) || error) })
    } finally {
      setSuggestBusy(false)
    }
  }

  return h(
    'div',
    {
      className: 'dnb-modal-backdrop',
      onClick: e => {
        if (e.target === e.currentTarget && !confirmBusy) patch({ interventionModalOpen: false })
      },
    },
    h(
      'div',
      { className: 'dnb-modal-card', style: { maxHeight: '86vh', overflowY: 'auto' } },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h('span', { style: { fontSize: 13.5, fontWeight: 700, color: '#f59e0b' } }, '⚡ 启用「主动强介入」— 设定核心目标与风险核对'),
        h('button', {
          type: 'button',
          className: 'dnb-icon-btn',
          style: { width: 22, height: 22 },
          disabled: confirmBusy,
          onClick: () => patch({ interventionModalOpen: false }),
        }, h(Icon, { name: 'x', size: 13 })),
      ),
      // Core Objective Destination Editor inside Modal (建议 + 锁定)
      h(
        'div',
        {
          style: {
            borderRadius: 9,
            padding: '9px 10px',
            border: objLocked
              ? '1px solid rgba(245, 158, 11, 0.55)'
              : (!trimmedDraft ? '1px solid rgba(255, 69, 58, 0.45)' : '1px solid var(--dnb-border)'),
            background: objLocked ? 'rgba(245, 158, 11, 0.07)' : 'var(--dnb-card)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            fontSize: 11.5,
          },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' } },
          h('span', { style: { fontWeight: 700, color: 'var(--dnb-text)' } },
            '🎯 强介入核心目标（默认带入规划核心目标，开启后将自动锁定）'),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 5 } },
            h('button', {
              type: 'button',
              className: 'dnb-mini-btn',
              'data-tone': 'blue',
              disabled: suggestBusy || objLocked,
              title: trimmedDraft && !(lastWasAiGuess && trimmedDraft === lastAiText.trim())
                ? '在您输入框已有文字的基础上由参谋长微调润色'
                : '由参谋长结合对话现状自动猜测建议（可反复点击继续换角度猜意图）',
              onClick: () => void handleSuggestObjective(),
            }, suggestBusy
              ? '推演中…'
              : (trimmedDraft && !(lastWasAiGuess && trimmedDraft === lastAiText.trim()) ? '✦ 微调建议' : '✦ 建议')),
            h('button', {
              type: 'button',
              className: 'dnb-mini-btn',
              'data-tone': objLocked ? 'amber' : 'blue',
              title: objLocked ? '点击解锁以继续编辑或点建议' : '锁定当前核心目标避免误改',
              onClick: () => setObjLocked(v => !v),
            }, objLocked ? '🔒 已锁定' : '🔒 锁定'),
          ),
        ),
        h('textarea', {
          className: 'dnb-input',
          rows: 3,
          readOnly: objLocked,
          placeholder: '输入核心目标，或留空直接点右上「✦ 建议」让参谋长为您揣摩填写（可反复点建议）…',
          style: {
            width: '100%',
            minHeight: 62,
            padding: '7px 9px',
            borderRadius: 7,
            fontSize: 12,
            lineHeight: 1.45,
            resize: 'vertical',
            opacity: objLocked ? 0.88 : 1,
            cursor: objLocked ? 'not-allowed' : 'text',
          },
          value: objDraft,
          onChange: e => {
            if (objLocked) return
            setObjDraft(e.target.value)
            setLastWasAiGuess(false)
          },
        }),
        suggestRationale
          ? h('div', { style: { fontSize: 11, color: '#60a5fa', lineHeight: 1.4 } }, '💡 参谋长思路：' + suggestRationale)
          : null,
        h('div', { style: { fontSize: 11, color: 'var(--dnb-text-3)', lineHeight: 1.4 } },
          !trimmedDraft
            ? h('span', { style: { color: '#ff6961', fontWeight: 600 } }, '⚠ 尚未填写核心目标：建议直接点右上「✦ 建议」自动填充（可反复点猜意图），或自行填写。')
            : '后续参谋长每次介入都会对照此核心目标与「必做事项」核查完成度；开启强介入后将锁定本目标直到关闭。'),
      ),
      // Live Redline Readback
      h(
        'div',
        {
          style: {
            borderRadius: 9,
            padding: '8px 10px',
            border: forbiddenList.length === 0 ? '1px solid rgba(255, 69, 58, 0.45)' : '1px solid var(--dnb-border)',
            background: forbiddenList.length === 0 ? 'rgba(255, 69, 58, 0.08)' : 'var(--dnb-card)',
            display: 'flex',
            flexDirection: 'column',
            gap: 5,
            fontSize: 11.5,
          },
        },
        forbiddenList.length === 0
          ? h('div', null,
              h('strong', null, '已设禁止红线：'),
              h('span', { style: { color: '#ff453a', fontWeight: 600 } }, '未设定（缺少禁止红线时强介入风险较高）'),
            )
          : h(
              'div',
              { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' } },
              h('div', null,
                h('strong', null, '已设禁止红线：'),
                h('span', { style: { color: '#34d399', fontWeight: 700 } }, `已生效 ${forbiddenList.length} 条`),
              ),
              h('button', {
                type: 'button',
                className: 'dnb-mini-btn',
                'data-tone': 'blue',
                onClick: () => patch({ interventionModalOpen: false, tab: 'boundaries', boundSubTab: 'rules' }),
              }, '管理红线'),
            ),
        forbiddenList.length > 0
          ? h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 3, paddingTop: 2 } },
              forbiddenList.slice(0, 3).map((item, idx) =>
                h('div', {
                  key: idx,
                  style: { fontSize: 11, color: 'var(--dnb-text-2)', lineHeight: 1.45, wordBreak: 'break-word' },
                }, '• ' + (item.length > 88 ? item.slice(0, 88) + '…' : item)),
              ),
              forbiddenList.length > 3
                ? h('div', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', marginTop: 1 } },
                    `…另有 ${forbiddenList.length - 3} 条禁止红线共同生效中`)
                : null,
            )
          : null,
        forbiddenList.length === 0
          ? h(
              'div',
              { style: { display: 'flex', gap: 6, marginTop: 3 } },
              h('button', {
                type: 'button',
                className: 'dnb-mini-btn',
                'data-tone': 'amber',
                onClick: () => patch({ interventionModalOpen: false, tab: 'boundaries', boundSubTab: 'rules' }),
              }, '前往设定红线'),
            )
          : null,
      ),
      // 3 Concrete Operational Risks + 4-Tier Permission Behavior
      h(
        'div',
        { style: { fontSize: 11.5, color: 'var(--dnb-text-2)', lineHeight: 1.55 } },
        h('div', { style: { fontWeight: 600, color: 'var(--dnb-text)', marginBottom: 3 } }, '开启后的行为与实操风险：'),
        h('div', { style: { color: '#60a5fa', marginBottom: 4, fontWeight: 600 } },
          `• 当前权限档位联动表现：${INTERVENTION_TIER_DESC[permMode] || INTERVENTION_TIER_DESC.advisor}`),
        h('div', null, '• Token 额外消耗：主对话每轮停顿都将唤醒参谋长核验并可能继续发指令。'),
        h('div', null, '• 对话节奏接管：参谋长会主动插话纠偏与派发下步，点击红色「⏹ 急停」可随时中断。'),
        h('div', null, `• 防死循环熔断：达到 ${normalizeMaxTurnsVal(tm.maxInterventionTurns) === 0 ? '♾️ 无限轮次' : (normalizeMaxTurnsVal(tm.maxInterventionTurns) + ' 轮上限')} 或连续无实际进展将触发熔断保护。`),
      ),
      // Dual Mandatory Disclaimers
      h(
        'div',
        { className: 'dnb-disclaimer-box' },
        h('div', { style: { marginBottom: 4 } },
          h('strong', null, '免责声明 1（模型依赖）：'),
          '参谋长的一切自动审查、强介入驱动、压缩前抢救与红线拦截能力均高度依赖您为参谋长配置的底层大模型能力与上下文质量，不同模型在规划严谨度与遵循指令上的表现存在客观差异。',
        ),
        h('div', null,
          h('strong', null, '免责声明 2（规则冲突）：'),
          '若主会话或当前项目中挂载了过多的系统提示词（System Prompt）、Rules 或硬性规则，可能与本插件的自主干预逻辑产生指令冲突，进而导致介入循环异常、提前熔断或执行偏离预期。',
        ),
      ),
      // Explicit Checkbox Agreement
      h(
        'label',
        { style: { display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 11.5, color: 'var(--dnb-text)', cursor: 'pointer', lineHeight: 1.45 } },
        h('input', {
          type: 'checkbox',
          checked: Boolean(view.interventionAgreed),
          style: { marginTop: 2 },
          onChange: e => patch({ interventionAgreed: Boolean(e.target.checked) }),
        }),
        '我已核对当前目标与红线，理解底层模型与宿主提示词规则冲突可能带来偏离，并确认启用主动强介入。',
      ),
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 } },
        h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: { height: 32, padding: '0 14px', fontSize: 12.5 },
          onClick: () => patch({ interventionModalOpen: false, interventionAgreed: false }),
        }, '取消'),
        h('button', {
          type: 'button',
          className: 'dnb-primary-btn',
          style: { height: 32, padding: '0 15px', fontSize: 12.5, background: '#f59e0b', color: '#111', fontWeight: 700, opacity: (view.interventionAgreed && !confirmBusy) ? 1 : 0.45 },
          disabled: !view.interventionAgreed || confirmBusy,
          onClick: async () => {
            setConfirmBusy(true)
            try {
              const curMax = normalizeMaxTurnsVal(tm.maxInterventionTurns)
              const ok = await updateSecConfig({
                tacticalModes: { ...tm, intervention: true, maxInterventionTurns: curMax },
                confirmedInterventionRisk: true,
                ...(curMax === 0 ? { confirmedUnlimitedTurns: true } : {}),
                ...(trimmedDraft ? { coreObjective: trimmedDraft } : {}),
              })
              if (ok) patch({ interventionModalOpen: false, interventionAgreed: false })
            } finally {
              setConfirmBusy(false)
            }
          },
        }, confirmBusy ? '开启并锁定中…' : (trimmedDraft ? '确认锁定目标并开启强介入' : '确认启用主动强介入')),
      ),
    ),
  )
}

export function UnlimitedTurnsConfirmModal({ view }) {
  if (!view.unlimitedTurnsModalOpen) return null
  const meta = view.chiefMeta || {}
  const tm = meta.tacticalModes || {}
  return h(
    'div',
    {
      className: 'dnb-modal-backdrop',
      onClick: e => {
        if (e.target === e.currentTarget) patch({ unlimitedTurnsModalOpen: false })
      },
    },
    h(
      'div',
      { className: 'dnb-modal-card' },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h('span', { style: { fontSize: 13.5, fontWeight: 700, color: '#f59e0b' } }, '♾️ 开启无限主动督导轮次 — 作者风险确认'),
        h('button', {
          type: 'button',
          className: 'dnb-icon-btn',
          style: { width: 24, height: 24 },
          onClick: () => patch({ unlimitedTurnsModalOpen: false }),
        }, h(Icon, { name: 'x', size: 13 })),
      ),
      h(
        'div',
        { className: 'dnb-disclaimer-box' },
        h('div', { style: { marginBottom: 4 } },
          h('strong', null, '持续推跑风险：'),
          '进入 ♾️ 无限督导模式后，只要参谋长评估主会话仍未完成当前任务，就会持续发送推进/纠偏指令而不再受固定轮数限制。',
        ),
        h('div', null,
          h('strong', null, '拉锯与费用提示：'),
          '参谋长与主对话模型在复杂疑难处可能持续来回探讨或拉锯很久，并显著增加 Token 消耗（仅连续 8 轮无实质变化时才触发兜底防卡死熔断，且您可随时点「⏹ 急停」或把参谋长切为「⏹ 停止」）。',
        ),
      ),
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 } },
        h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: { height: 32, padding: '0 14px', fontSize: 12.5 },
          onClick: () => patch({ unlimitedTurnsModalOpen: false }),
        }, '保留有限轮次'),
        h('button', {
          type: 'button',
          className: 'dnb-primary-btn',
          style: { height: 32, padding: '0 15px', fontSize: 12.5, background: '#f59e0b', color: '#111', fontWeight: 700 },
          onClick: async () => {
            const ok = await updateSecConfig({
              tacticalModes: { ...tm, maxInterventionTurns: 0 },
              confirmedUnlimitedTurns: true,
            })
            if (ok) patch({ unlimitedTurnsModalOpen: false })
          },
        }, '确认启用 ♾️ 无限督导'),
      ),
    ),
  )
}

export function AutoPilotConfirmModal({ view }) {
  if (!view.autoPilotConfirmOpen) return null
  return h(
    'div',
    {
      className: 'dnb-modal-backdrop',
      onClick: e => {
        if (e.target === e.currentTarget) patch({ autoPilotConfirmOpen: false })
      },
    },
    h(
      'div',
      { className: 'dnb-modal-card' },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h('span', { style: { fontSize: 13.5, fontWeight: 700, color: 'var(--dnb-accent)' } }, '⚡ 开启本会话全自动托管 — 作用域与防空转确认'),
        h('button', {
          type: 'button',
          className: 'dnb-icon-btn',
          style: { width: 24, height: 24 },
          onClick: () => patch({ autoPilotConfirmOpen: false }),
        }, h(Icon, { name: 'x', size: 13 })),
      ),
      h(
        'div',
        { className: 'dnb-disclaimer-box' },
        h('div', { style: { marginBottom: 4 } },
          h('strong', null, '1. 仅管当前对话（严格会话隔离）：'),
          '全自动模式下，参谋长会自主打理本对话内的档案分类/归纳、非定住边界、任务进展更新与阶段摘要；绝不触碰全局定住红线、绝不写全局冷库，也绝不向外部对话窗口自动递话或串窗。',
        ),
        h('div', { style: { marginBottom: 4 } },
          h('strong', null, '2. 防空转自动停机机制：'),
          '当主对话代理与所有已派发子代理均结束工作且收尾摘要提炼完成后，参谋长会自动退出全自动托管并恢复为「⏸ 按需手动」，防止后台持续空转浪费算力。',
        ),
        h('div', null,
          h('strong', null, '3. 随时可控：'),
          '您随时可以点击顶部节奏按钮切回手动，或切至「⏹ 停止参谋长」。',
        ),
      ),
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 } },
        h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: { height: 32, padding: '0 14px', fontSize: 12.5 },
          onClick: () => patch({ autoPilotConfirmOpen: false }),
        }, '暂不开启'),
        h('button', {
          type: 'button',
          className: 'dnb-primary-btn',
          style: { height: 32, padding: '0 15px', fontSize: 12.5, fontWeight: 700 },
          onClick: async () => {
            const ok = await updateSecConfig({
              paceMode: 'auto',
              confirmedAutoPilot: true,
            })
            if (ok) patch({ autoPilotConfirmOpen: false })
          },
        }, '⚡ 确认开启本对话全自动托管'),
      ),
    ),
  )
}

export function ArchiveRelayModal({ view }) {
  const m = view.archiveRelayModal
  if (!m) return null
  const items = Array.isArray(m.items) ? m.items : []
  const peers = (view.secView && Array.isArray(view.secView.peers)) ? view.secView.peers : []
  const busy = Boolean(view.relayArchivesBusy)
  const scopeBadgeText = s => (s === 'global' ? '全局' : (s === 'precipitated' ? '沉淀' : '本局'))
  return h(
    'div',
    {
      className: 'dnb-modal-backdrop',
      onClick: e => {
        if (e.target === e.currentTarget && !busy) patch({ archiveRelayModal: null })
      },
    },
    h(
      'div',
      { className: 'dnb-modal-card' },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h('span', { style: { fontSize: 13.5, fontWeight: 700, color: 'var(--dnb-accent)' } },
          `📨 让参谋长带要求递话（已选 ${items.length} 条档案）`),
        h('button', {
          type: 'button',
          className: 'dnb-icon-btn',
          style: { width: 24, height: 24 },
          disabled: busy,
          onClick: () => patch({ archiveRelayModal: null }),
        }, h(Icon, { name: 'x', size: 13 })),
      ),
      h(
        'div',
        { style: { display: 'flex', flexWrap: 'wrap', gap: 5, maxHeight: 108, overflowY: 'auto' } },
        items.map((it, idx) =>
          h(
            'span',
            {
              key: (it.vaultScope || 'session') + ':' + (it.id || idx),
              className: 'dnb-tag',
              style: { fontSize: 11, padding: '2px 8px', background: 'var(--dnb-card)', border: '1px solid var(--dnb-border)' },
            },
            `[${scopeBadgeText(it.vaultScope)}] ${clampTitle(it.title || it.id, 22)}`,
          ),
        ),
      ),
      h(
        'div',
        { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } },
        h('span', { style: { fontSize: 11.5, color: 'var(--dnb-text-3)' } }, '递达对象：'),
        h('select', {
          value: m.target || 'lead',
          disabled: busy,
          style: {
            height: 28,
            borderRadius: 7,
            border: '1px solid var(--dnb-border-strong)',
            background: 'var(--dnb-card)',
            color: 'var(--dnb-text)',
            fontSize: 11.5,
            padding: '0 8px',
            flex: 1,
            minWidth: 120,
          },
          onChange: e => patch({ archiveRelayModal: { ...m, target: e.target.value } }),
        },
          h('option', { value: 'lead' }, '@主对话 (lead)'),
          peers.filter(p => p && p.key && p.key !== 'lead').map(p =>
            h('option', { key: p.key, value: p.key }, '@' + shortAgentName(p.name || p.key, true)),
          ),
        ),
        h('select', {
          value: m.mode || 'followup',
          disabled: busy,
          style: {
            height: 28,
            borderRadius: 7,
            border: '1px solid var(--dnb-border-strong)',
            background: 'var(--dnb-card)',
            color: 'var(--dnb-text)',
            fontSize: 11.5,
            padding: '0 8px',
          },
          onChange: e => patch({ archiveRelayModal: { ...m, mode: e.target.value } }),
        },
          h('option', { value: 'followup' }, '排队递话'),
          h('option', { value: 'steer' }, '运行中插话'),
        ),
      ),
      h('textarea', {
        className: 'dnb-textarea',
        rows: 3,
        disabled: busy,
        style: { fontSize: 12, minHeight: 74, resize: 'vertical' },
        placeholder: '告诉参谋长这批档案要带上什么要求再递给主对话（如：请严格按档案里的接口签名与边界重构，勿修改已有测试契约）…',
        value: m.instruction || '',
        onChange: e => patch({ archiveRelayModal: { ...m, instruction: e.target.value } }),
      }),
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 2 } },
        h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: { height: 32, padding: '0 14px', fontSize: 12.5 },
          disabled: busy,
          onClick: () => patch({ archiveRelayModal: null }),
        }, '取消'),
        h('button', {
          type: 'button',
          className: 'dnb-primary-btn',
          style: { height: 32, padding: '0 15px', fontSize: 12.5, fontWeight: 700 },
          disabled: busy || items.length === 0,
          onClick: () => void relayArchivesWithChiefApi(m),
        }, busy ? '正在整理并递话…' : `📨 递给 @${m.target === 'lead' || !m.target ? '主对话' : shortAgentName(m.target, true)}`),
      ),
    ),
  )
}

export function DistillToGlobalModal({ view }) {
  const m = view.distillGlobalModal
  if (!m) return null
  const busy = Boolean(view.distillBusy)
  const countLabel = Array.isArray(m.ids) && m.ids.length > 0
    ? `已勾选的 ${m.ids.length} 卷本局档案`
    : '本会话档案柜中全部可复用经验'
  return h(
    'div',
    {
      className: 'dnb-modal-backdrop',
      onClick: e => {
        if (e.target === e.currentTarget && !busy) patch({ distillGlobalModal: null })
      },
    },
    h(
      'div',
      { className: 'dnb-modal-card' },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h('span', { style: { fontSize: 13.5, fontWeight: 700, color: 'var(--dnb-accent)' } }, '✦ 让参谋长总结提炼入全局档案库'),
        h('button', {
          type: 'button',
          className: 'dnb-icon-btn',
          style: { width: 24, height: 24 },
          disabled: busy,
          onClick: () => patch({ distillGlobalModal: null }),
        }, h(Icon, { name: 'x', size: 13 })),
      ),
      h(
        'div',
        { style: { fontSize: 12, color: 'var(--dnb-text-2)', lineHeight: 1.5 } },
        `参谋长将自动审查「${countLabel}」，剔除纯一次性过程碎屑，提炼跨对话可复用的工程坐标、规范与排障结论存入「🌐 全局档案柜」（默认保留原会话卷宗，遵守先升全局再沉淀的梯度）。`,
      ),
      h('textarea', {
        className: 'dnb-textarea',
        rows: 2,
        disabled: busy,
        style: { fontSize: 12, minHeight: 56, resize: 'vertical' },
        placeholder: '可选补充提炼侧重（如：重点摘除可跨项目复用的构建命令与架构踩坑结论）…',
        value: m.instruction || '',
        onChange: e => patch({ distillGlobalModal: { ...m, instruction: e.target.value } }),
      }),
      h(
        'label',
        { style: { display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 11.5, color: 'var(--dnb-text)', cursor: 'pointer', lineHeight: 1.45 } },
        h('input', {
          type: 'checkbox',
          checked: Boolean(m.clearSource),
          disabled: busy,
          style: { marginTop: 2 },
          onChange: e => patch({ distillGlobalModal: { ...m, clearSource: Boolean(e.target.checked) } }),
        }),
        '提炼成功后同步移除已提炼来源的本局原卷宗（默认不勾选，保留本局原档）',
      ),
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 2 } },
        h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: { height: 32, padding: '0 14px', fontSize: 12.5 },
          disabled: busy,
          onClick: () => patch({ distillGlobalModal: null }),
        }, '取消'),
        h('button', {
          type: 'button',
          className: 'dnb-primary-btn',
          style: { height: 32, padding: '0 15px', fontSize: 12.5, fontWeight: 700 },
          disabled: busy,
          onClick: () => void distillToGlobalApi(m),
        }, busy ? '参谋长正在提炼…' : '✦ 开始提炼入全局'),
      ),
    ),
  )
}

export function ChiefAdviceModal({ view }) {
  const m = view.chiefAdviceModal
  if (!m) return null
  const busy = Boolean(view.secBusy)
  const draft = String(m.draftText || m.title || '').trim()
  return h(
    'div',
    {
      className: 'dnb-modal-backdrop',
      onClick: e => {
        if (e.target === e.currentTarget && !busy) patch({ chiefAdviceModal: null })
      },
    },
    h(
      'div',
      { className: 'dnb-modal-card' },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h('span', { style: { fontSize: 13.5, fontWeight: 700, color: 'var(--dnb-accent)' } }, '💡 参谋长主动建议'),
        h('button', {
          type: 'button',
          className: 'dnb-icon-btn',
          style: { width: 24, height: 24 },
          disabled: busy,
          onClick: () => patch({ chiefAdviceModal: null }),
        }, h(Icon, { name: 'x', size: 13 })),
      ),
      h(
        'div',
        { style: { fontSize: 13, fontWeight: 600, color: 'var(--dnb-text)', lineHeight: 1.5 } },
        m.title || '参谋长提出了一条阶段调整建议',
      ),
      m.reason
        ? h('div', { style: { fontSize: 12, color: 'var(--dnb-text-2)', lineHeight: 1.5 } }, m.reason)
        : null,
      m.draftText && m.draftText !== m.title
        ? h(
            'div',
            {
              style: {
                padding: '8px 10px',
                borderRadius: 9,
                border: '1px solid var(--dnb-border)',
                background: 'var(--dnb-card)',
                fontSize: 12,
                color: 'var(--dnb-text-2)',
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
              },
            },
            m.draftText,
          )
        : null,
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'flex-end', gap: 7, flexWrap: 'wrap', marginTop: 2 } },
        h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: { height: 32, padding: '0 12px', fontSize: 12 },
          disabled: busy,
          onClick: () => patch({ chiefAdviceModal: null }),
        }, '暂不处理'),
        !m.isSynthetic && m.id
          ? h('button', {
              type: 'button',
              className: 'dnb-pill',
              style: { height: 32, padding: '0 12px', fontSize: 12, color: 'var(--dnb-text-3)' },
              disabled: busy,
              onClick: async () => {
                await decideSuggestion(m, 'dismiss')
                patch({ chiefAdviceModal: null })
              },
            }, '忽略驳回')
          : null,
        draft
          ? h('button', {
              type: 'button',
              className: 'dnb-pill',
              style: { height: 32, padding: '0 12px', fontSize: 12 },
              disabled: busy,
              onClick: () => {
                prefillSuggestion({ ...m, draftText: draft, target: m.target || 'auto' })
                patch({ chiefAdviceModal: null })
                focusSecInput()
              },
            }, '填入许愿框微调')
          : null,
        h('button', {
          type: 'button',
          className: 'dnb-primary-btn',
          style: { height: 32, padding: '0 15px', fontSize: 12.5, fontWeight: 700 },
          disabled: busy,
          onClick: async () => {
            if (m.isSynthetic || !m.id) {
              patch({ chiefAdviceModal: null })
              await submitChiefBar('请采纳此参谋建议并递交主对话推进：' + draft)
            } else {
              await decideSuggestion(m, 'approve')
              patch({ chiefAdviceModal: null })
            }
          },
        }, busy ? '递交中…' : '📨 采纳并递交主对话'),
      ),
    ),
  )
}

export function HazardHaltModal({ view }) {
  const m = view.hazardHaltModal
  const [ackBusy, setAckBusy] = React.useState(false)
  if (!m) return null
  const isBoundHit = m.category === 'boundary_collision'
  const dismissAndAck = async (goTab) => {
    if (ackBusy) return
    setAckBusy(true)
    const alertId = m.id
    patch({
      hazardHaltModal: null,
      ...(goTab ? { tab: goTab, ...(goTab === 'boundaries' ? { boundSubTab: 'rules' } : {}) } : {}),
    })
    try {
      if (alertId) {
        await updateSecConfig({ ackHazardAlertId: alertId })
      }
    } finally {
      setAckBusy(false)
    }
  }
  return h(
    'div',
    {
      className: 'dnb-modal-backdrop',
      onClick: e => {
        if (e.target === e.currentTarget && !ackBusy) void dismissAndAck('')
      },
    },
    h(
      'div',
      {
        className: 'dnb-modal-card',
        style: { borderColor: 'rgba(255, 69, 58, 0.65)', boxShadow: '0 14px 40px rgba(255, 69, 58, 0.22)' },
      },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h(
          'span',
          { style: { fontSize: 13.5, fontWeight: 700, color: '#ff6961' } },
          isBoundHit ? '🚫 撞边界熔断 · 主动强介入已紧急停机' : '🚨 重大不可逆风险拦截 · 主动强介入已紧急停机',
        ),
        h('button', {
          type: 'button',
          className: 'dnb-icon-btn',
          style: { width: 22, height: 22 },
          disabled: ackBusy,
          onClick: () => void dismissAndAck(''),
        }, h(Icon, { name: 'x', size: 13 })),
      ),
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
        h(
          'span',
          {
            className: 'dnb-tag',
            style: {
              background: 'rgba(255, 69, 58, 0.16)',
              color: '#ff6961',
              border: '1px solid rgba(255, 69, 58, 0.35)',
              fontWeight: 700,
            },
          },
          isBoundHit ? '必然撞边界拦阻' : '不可逆风险煞车',
        ),
        m.title
          ? h('span', { style: { fontSize: 12.5, fontWeight: 700, color: 'var(--dnb-text)' } }, m.title)
          : null,
      ),
      h(
        'div',
        {
          style: {
            padding: '9px 11px',
            borderRadius: 9,
            border: '1px solid rgba(255, 69, 58, 0.36)',
            background: 'rgba(255, 69, 58, 0.08)',
            fontSize: 12,
            color: 'var(--dnb-text)',
            lineHeight: 1.55,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          },
        },
        m.reason || '继续推进可能造成不可逆损失或触犯工作边界，参谋长已立即停下后续推送。',
      ),
      m.objective
        ? h(
            'div',
            { style: { fontSize: 11, color: 'var(--dnb-text-3)', lineHeight: 1.4 } },
            '停机前锁定核心目标：',
            m.objective,
          )
        : null,
      h(
        'div',
        { style: { fontSize: 11.5, color: 'var(--dnb-text-2)', lineHeight: 1.45 } },
        '已为您自动关闭「主动强介入」并取消自动续跑，彻底防止继续推进造成损失；请先人工核实或调整方案后再决定是否重启。',
      ),
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'flex-end', gap: 7, flexWrap: 'wrap', marginTop: 2 } },
        h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: { height: 32, padding: '0 12px', fontSize: 12 },
          disabled: ackBusy,
          onClick: () => void dismissAndAck('boundaries'),
        }, '查看边界红线'),
        h('button', {
          type: 'button',
          className: 'dnb-primary-btn',
          style: { height: 32, padding: '0 16px', fontSize: 12.5, fontWeight: 700, background: '#ff453a', color: '#fff' },
          disabled: ackBusy,
          onClick: () => void dismissAndAck(''),
        }, ackBusy ? '确认中…' : '我知道了（已交还人工控制）'),
      ),
    ),
  )
}

export function PrecipitateConfirmModal({ view }) {
  const m = view.precipitateModal
  if (!m) return null
  return h(
    'div',
    {
      className: 'dnb-modal-backdrop',
      onClick: e => {
        if (e.target === e.currentTarget && !view.archivePrecipitating) patch({ precipitateModal: null })
      },
    },
    h(
      'div',
      { className: 'dnb-modal-card' },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h('span', { style: { fontSize: 13.5, fontWeight: 700, color: 'var(--dnb-accent)' } }, '⏬ 沉淀可复用工程经验至冷库'),
        h('button', {
          type: 'button',
          className: 'dnb-icon-btn',
          style: { width: 22, height: 22 },
          disabled: Boolean(view.archivePrecipitating),
          onClick: () => patch({ precipitateModal: null }),
        }, h(Icon, { name: 'x', size: 13 })),
      ),
      h(
        'div',
        { style: { fontSize: 12, color: 'var(--dnb-text-2)', lineHeight: 1.5 } },
        `将从「${m.label || '当前档案'}」中提炼高价值的通用踩坑、架构约定与验收模式，封入同项目全局冷库。冷库条目默认全会话 `,
        h('strong', { style: { color: 'var(--dnb-text)' } }, '0 Token 隔离'),
        '，仅在您需要时点击「翻出」才会临时注入当前对话。',
      ),
      h(
        'label',
        { style: { display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 11.5, color: 'var(--dnb-text)', cursor: 'pointer', lineHeight: 1.45 } },
        h('input', {
          type: 'checkbox',
          checked: Boolean(m.clearSource),
          disabled: Boolean(view.archivePrecipitating),
          style: { marginTop: 2 },
          onChange: e => patch({ precipitateModal: { ...m, clearSource: Boolean(e.target.checked) } }),
        }),
        '沉淀成功后同步清空已沉淀的原工作档案条目（保留冷库精炼经验）',
      ),
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'flex-end', gap: 7 } },
        h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: { height: 28, padding: '0 12px', fontSize: 12 },
          disabled: Boolean(view.archivePrecipitating),
          onClick: () => patch({ precipitateModal: null }),
        }, '取消'),
        h('button', {
          type: 'button',
          className: 'dnb-primary-btn',
          style: { height: 28, padding: '0 14px', fontSize: 12, fontWeight: 600 },
          disabled: Boolean(view.archivePrecipitating),
          onClick: () => void precipitateArchivesApi({
            op: m.op || 'cabinet',
            vaultScope: m.vaultScope || 'global',
            cabinetId: '',
            folder: m.folder || '',
            ...(Array.isArray(m.ids) && m.ids.length > 0 ? { ids: m.ids } : {}),
            clearSource: Boolean(m.clearSource),
          }),
        }, view.archivePrecipitating ? '正在提炼沉淀…' : '开始提炼沉淀'),
      ),
    ),
  )
}

export function PeerLinkConfirmModal({ view }) {
  const m = view.peerLinkConfirmModal
  if (!m) return null
  return h(
    'div',
    {
      className: 'dnb-modal-backdrop',
      onClick: e => {
        if (e.target === e.currentTarget) patch({ peerLinkConfirmModal: null })
      },
    },
    h(
      'div',
      { className: 'dnb-modal-card' },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h('span', { style: { fontSize: 13.5, fontWeight: 700, color: '#f59e0b' } }, '⚠️ 接入互通协同网络 — 上下文防污染确认'),
        h('button', {
          type: 'button',
          className: 'dnb-icon-btn',
          style: { width: 22, height: 22 },
          onClick: () => patch({ peerLinkConfirmModal: null }),
        }, h(Icon, { name: 'x', size: 13 })),
      ),
      h(
        'div',
        {
          style: {
            borderRadius: 9,
            padding: '8px 10px',
            border: '1px solid var(--dnb-border)',
            background: 'var(--dnb-card)',
            fontSize: 11.5,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          },
        },
        h('div', null, h('strong', null, '拟接入窗口：'), m.peerTitle || shortSession(m.peerId)),
        m.peerObjective
          ? h('div', { style: { color: 'var(--dnb-text-2)' } }, h('strong', null, '对方当前目标：'), m.peerObjective)
          : null,
      ),
      h(
        'div',
        { className: 'dnb-disclaimer-box' },
        '一旦接入同一协同网络，两个独立会话将自动共享实时进度、协同信箱与参谋态势。\n',
        h('strong', null, '如果这两个对话处理的并非同一个或强关联的任务，强制联动会同时污染两个对话的上下文与参谋长摘要！'),
        '\n请确认二者任务相关后再接入（后续若随时断开，系统会自动净化并隔离协同摘要与残余记忆）。',
      ),
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'flex-end', gap: 7 } },
        h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: { height: 28, padding: '0 12px', fontSize: 12 },
          onClick: () => patch({ peerLinkConfirmModal: null }),
        }, '取消（不联动）'),
        h('button', {
          type: 'button',
          className: 'dnb-primary-btn',
          style: { height: 28, padding: '0 14px', fontSize: 12, background: '#f59e0b', color: '#111', fontWeight: 700 },
          onClick: async () => {
            const pid = m.peerId
            patch({ peerLinkConfirmModal: null })
            await togglePeerSessionLink(pid, true)
          },
        }, '确认任务相关并接入网络'),
      ),
    ),
  )
}

export function HandoffWarnModal({ view }) {
  const m = view.handoffWarnModal
  if (!m) return null
  return h(
    'div',
    {
      className: 'dnb-modal-backdrop',
      onClick: e => {
        if (e.target === e.currentTarget && !view.secRegenerating) patch({ handoffWarnModal: null })
      },
    },
    h(
      'div',
      { className: 'dnb-modal-card' },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h('span', { style: { fontSize: 13.5, fontWeight: 700, color: '#f59e0b' } }, '⚠️ 交接前提醒：交接单尚未对齐最新状态'),
        h('button', {
          type: 'button',
          className: 'dnb-icon-btn',
          style: { width: 22, height: 22 },
          disabled: Boolean(view.secRegenerating),
          onClick: () => patch({ handoffWarnModal: null }),
        }, h(Icon, { name: 'x', size: 13 })),
      ),
      h(
        'div',
        { className: 'dnb-disclaimer-box' },
        m.reason || '当前交接单若未写好或未同步最新进展，强行交接将打乱下一窗口的上下文！建议先让参谋长提炼并更新交接单后再投递。',
      ),
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'flex-end', gap: 6, flexWrap: 'wrap' } },
        h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: { height: 28, padding: '0 10px', fontSize: 11.5 },
          disabled: Boolean(view.secRegenerating),
          onClick: () => {
            patch({ handoffWarnModal: null, handoffEditing: true, handoffDraft: view.handoffText || '' })
          },
        }, '去手动修改'),
        h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: { height: 28, padding: '0 10px', fontSize: 11.5 },
          disabled: Boolean(view.secRegenerating),
          onClick: () => {
            patch({ handoffWarnModal: null })
            void transfer(m.target, m.opts)
          },
        }, '仍直接交接'),
        h('button', {
          type: 'button',
          className: 'dnb-primary-btn',
          style: { height: 28, padding: '0 12px', fontSize: 11.5, fontWeight: 700 },
          disabled: Boolean(view.secRegenerating),
          onClick: async () => {
            await loadChiefView(true, { syncHandoff: true })
            patch({ handoffWarnModal: null })
            await transfer(m.target, m.opts)
          },
        }, view.secRegenerating ? '参谋长更新交接单中…' : '✦ 让参谋长更新交接单并交接'),
      ),
    ),
  )
}

export function ChiefRiskConfirmModal({ view }) {
  if (!view.chiefRiskModalOpen) return null
  const agreed = Boolean(view.chiefRiskAgreed)
  const busy = Boolean(view.chiefRiskBusy)
  return h(
    'div',
    {
      className: 'dnb-modal-backdrop',
      onClick: e => {
        if (e.target === e.currentTarget && !busy) patch({ chiefRiskModalOpen: false, chiefRiskAgreed: false })
      },
    },
    h(
      'div',
      { className: 'dnb-modal-card' },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h('span', { style: { fontSize: 13.5, fontWeight: 700, color: '#f59e0b' } }, 'L3 · 参谋长模式（进入前确认风险）'),
        h('button', {
          type: 'button',
          className: 'dnb-icon-btn',
          style: { width: 22, height: 22 },
          disabled: busy,
          onClick: () => patch({ chiefRiskModalOpen: false, chiefRiskAgreed: false }),
        }, h(Icon, { name: 'x', size: 13 })),
      ),
      h(
        'div',
        { className: 'dnb-risk-box' },
        h('div', { style: { fontSize: 13.5, fontWeight: 700, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 6 } },
          '⚠️ 高权限模式风险告知'),
        h('div', { style: { fontSize: 12, color: 'var(--dnb-text-2)' } }, '启用后，Agent 可能自主：'),
        h(
          'ul',
          { style: { margin: '0 0 0 18px', padding: 0, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--dnb-text)' } },
          h('li', null, '修改工作区文件'),
          h('li', null, '执行系统命令'),
          h('li', null, '调整主代理及子代理工作流'),
          h('li', null, '执行可能造成不可逆影响的操作'),
        ),
        h('div', { style: { fontSize: 12, fontWeight: 600, color: 'var(--dnb-text-2)' } },
          '即使有安全卫兵，仍然不能保证完全消除风险。'),
      ),
      h(
        'label',
        { className: 'dnb-risk-check' },
        h('input', {
          type: 'checkbox',
          checked: agreed,
          disabled: busy,
          style: { marginTop: 3 },
          onChange: e => patch({ chiefRiskAgreed: Boolean(e.target.checked) }),
        }),
        h('span', null, '我已阅读并知悉上述风险，理解高权限模式可能造成的后果。'),
      ),
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
        h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: { height: 32, padding: '0 14px', fontSize: 12.5 },
          disabled: busy,
          onClick: () => patch({ chiefRiskModalOpen: false, chiefRiskAgreed: false }),
        }, '取消'),
        h('button', {
          type: 'button',
          className: 'dnb-primary-btn',
          style: {
            height: 32,
            padding: '0 16px',
            fontSize: 12.5,
            background: agreed ? '#d97706' : 'var(--dnb-fill)',
            color: agreed ? '#fff' : 'var(--dnb-text-3)',
            fontWeight: 700,
          },
          disabled: !agreed || busy,
          onClick: async () => {
            patch({ chiefRiskBusy: true })
            try {
              const ok = await updateSecConfig({
                permissionMode: 'chief',
                confirmedChiefRisk: true,
              })
              if (ok) patch({ chiefRiskModalOpen: false, chiefRiskAgreed: false })
            } finally {
              patch({ chiefRiskBusy: false })
            }
          },
        }, busy ? 'DSH Chief 校验启用中…' : '确认并启用'),
      ),
      h('div', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', lineHeight: 1.4 } },
        '真正启用必须由 DSH Chief 后端执行风险授权校验，切换回低权限或新会话后将自动重置该高权限授权。'),
    ),
  )
}

export function OperationApprovalModal({ view }) {
  const meta = view.chiefMeta || {}
  const list = (Array.isArray(meta.pendingApprovals) ? meta.pendingApprovals : [])
    .filter(item => item && item.status === 'pending')
  if (!list.length) return null
  const dismissedMap = view.dismissedApprovalIds || {}
  const active = (view.openApprovalModalId && list.find(item => item.id === view.openApprovalModalId))
    || list.find(item => !dismissedMap[item.id])
    || null
  if (!active) return null
  const busy = view.approvalBusyId === active.id
  const idx = list.findIndex(item => item.id === active.id)
  const dismissCurrent = () => {
    if (busy) return
    patch({
      dismissedApprovalIds: { ...dismissedMap, [active.id]: true },
      openApprovalModalId: '',
    })
  }
  return h(
    'div',
    {
      className: 'dnb-modal-backdrop',
      onClick: e => {
        if (e.target === e.currentTarget && !busy) dismissCurrent()
      },
    },
    h(
      'div',
      { className: 'dnb-modal-card' },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h('span', { style: { fontSize: 13.5, fontWeight: 700, color: '#f59e0b' } },
          `L2 · 参谋模式：逐项确认${list.length > 1 ? ` (${idx + 1}/${list.length})` : ''}`),
        h('button', {
          type: 'button',
          className: 'dnb-icon-btn',
          style: { width: 22, height: 22 },
          title: '稍后处理（保留底部授权提醒横幅）',
          disabled: busy,
          onClick: dismissCurrent,
        }, h(Icon, { name: 'x', size: 13 })),
      ),
      h(
        'div',
        { className: 'dnb-op-box' },
        h('div', { style: { fontSize: 13, fontWeight: 700, color: '#d97706', display: 'flex', alignItems: 'center', gap: 6 } },
          '🛡️ 操作授权请求'),
        h('div', { className: 'dnb-op-kv' },
          h('span', { className: 'dnb-op-k' }, '操作：'),
          h('span', null, active.operationLabel || '受控工作区或工作流操作'),
        ),
        h('div', { className: 'dnb-op-kv' },
          h('span', { className: 'dnb-op-k' }, '目标：'),
          h('span', { className: 'dnb-op-code' }, active.targetLabel || '当前工作区'),
        ),
        h('div', { className: 'dnb-op-kv' },
          h('span', { className: 'dnb-op-k' }, '原因：'),
          h('span', null, active.reason || '完成当前参谋推进步骤'),
        ),
        h('div', { className: 'dnb-op-kv' },
          h('span', { className: 'dnb-op-k' }, '影响：'),
          h('span', null, active.impact || '仅在允许本次后执行一次该受控操作'),
        ),
        active.preview
          ? h('pre', {
              style: {
                margin: '2px 0 0',
                padding: '6px 8px',
                borderRadius: 7,
                background: 'var(--dnb-elevated)',
                border: '1px solid var(--dnb-border)',
                fontSize: 10.5,
                maxHeight: 90,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                color: 'var(--dnb-text-2)',
              },
            }, String(active.preview).slice(0, 420))
          : null,
      ),
      h(
        'div',
        { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 2 } },
        h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: { height: 34, justifyContent: 'center', fontSize: 12.5, fontWeight: 600 },
          disabled: busy,
          onClick: () => void decideApproval(active.id, 'reject'),
        }, '拒绝'),
        h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: {
            height: 34,
            justifyContent: 'center',
            fontSize: 12.5,
            fontWeight: 700,
            borderColor: 'rgba(16, 185, 129, 0.52)',
            background: 'rgba(16, 185, 129, 0.14)',
            color: '#10b981',
          },
          disabled: busy,
          onClick: () => void decideApproval(active.id, 'approve'),
        }, busy ? '执行中…' : '允许本次操作'),
      ),
    ),
  )
}

export function ElevationRequestModal({ view }) {
  const meta = view.chiefMeta || {}
  const req = meta.pendingElevation
  if (!req || req.status !== 'pending') return null
  const dismissedMap = view.dismissedElevationIds || {}
  if (dismissedMap[req.id]) return null
  const busy = Boolean(view.elevationBusy)
  const chosenMode = ['assistant', 'strategist', 'chief'].includes(view.elevationChosenMode)
    ? view.elevationChosenMode
    : (req.targetMode || 'strategist')
  const needsRiskCheck = chosenMode === 'chief'
  const agreed = Boolean(view.elevationAgreed)
  const dismissSelf = () => {
    if (busy) return
    patch({ dismissedElevationIds: { ...dismissedMap, [req.id]: true } })
  }
  return h(
    'div',
    {
      className: 'dnb-modal-backdrop',
      onClick: e => {
        if (e.target === e.currentTarget && !busy) dismissSelf()
      },
    },
    h(
      'div',
      { className: 'dnb-modal-card' },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h('span', { style: { fontSize: 13.5, fontWeight: 700, color: '#60a5fa' } }, '⬆️ 模型申请提升权限'),
        h('button', {
          type: 'button',
          className: 'dnb-icon-btn',
          style: { width: 22, height: 22 },
          disabled: busy,
          onClick: dismissSelf,
        }, h(Icon, { name: 'x', size: 13 })),
      ),
      h(
        'div',
        { className: 'dnb-op-box' },
        h('div', { className: 'dnb-op-kv' },
          h('span', { className: 'dnb-op-k' }, '当前档位：'),
          h('span', null, `${CHIEF_PERMISSION_LABELS[req.fromMode] || req.fromMode} → 申请 ${CHIEF_PERMISSION_LABELS[req.targetMode] || req.targetMode}`),
        ),
        h('div', { className: 'dnb-op-kv' },
          h('span', { className: 'dnb-op-k' }, '发起方：'),
          h('span', { className: 'dnb-op-code' }, req.by || 'chief'),
        ),
        h('div', { className: 'dnb-op-kv' },
          h('span', { className: 'dnb-op-k' }, '申请原因：'),
          h('span', null, req.reason || '当前任务需要更高操作权限'),
        ),
        req.requestedActionSummary
          ? h('div', { className: 'dnb-op-kv' },
              h('span', { className: 'dnb-op-k' }, '拟执行：'),
              h('span', null, req.requestedActionSummary),
            )
          : null,
      ),
      h(
        'div',
        { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
        (req.targetMode === 'chief'
          ? ['strategist', 'chief']
          : ['assistant', 'strategist']
        ).map(modeKey => {
          const selected = chosenMode === modeKey
          return h('button', {
            key: modeKey,
            type: 'button',
            className: 'dnb-mini-btn',
            'data-tone': selected ? (modeKey === 'chief' ? 'amber' : 'accent') : undefined,
            disabled: busy,
            onClick: () => patch({ elevationChosenMode: modeKey, elevationAgreed: false }),
          }, modeKey === 'strategist' ? '🛡️ 稳妥方案：仅提权至 L2 参谋模式（逐项授权）' : (CHIEF_PERMISSION_LABELS[modeKey] || modeKey))
        }),
      ),
      needsRiskCheck
        ? h(
            React.Fragment,
            null,
            h(
              'div',
              { className: 'dnb-risk-box' },
              h('div', { style: { fontSize: 13, fontWeight: 700, color: '#f59e0b' } }, '⚠️ 高权限模式风险告知（提权至 L3）'),
              h('div', { style: { fontSize: 11.5, color: 'var(--dnb-text-2)' } },
                '批准进入 L3 · 参谋长模式后，Agent 将可自主修改工作区文件、执行系统命令、切换/协调主与子代理工作流。即使有安全卫兵，仍然不能保证完全消除风险。'),
            ),
            h(
              'label',
              { className: 'dnb-risk-check' },
              h('input', {
                type: 'checkbox',
                checked: agreed,
                disabled: busy,
                style: { marginTop: 3 },
                onChange: e => patch({ elevationAgreed: Boolean(e.target.checked) }),
              }),
              h('span', null, '我已阅读并知悉上述风险，理解高权限模式可能造成的后果。'),
            ),
          )
        : null,
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 2 } },
        h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: { height: 32, padding: '0 14px', fontSize: 12.5 },
          disabled: busy,
          onClick: () => void decideElevation(req.id, 'reject'),
        }, '拒绝提权'),
        h('button', {
          type: 'button',
          className: 'dnb-primary-btn',
          style: {
            height: 32,
            padding: '0 15px',
            fontSize: 12.5,
            fontWeight: 700,
            background: needsRiskCheck ? (agreed ? '#d97706' : 'var(--dnb-fill)') : 'var(--dnb-primary-bg, #2563eb)',
            color: needsRiskCheck ? (agreed ? '#fff' : 'var(--dnb-text-3)') : 'var(--dnb-primary-fg, #fff)',
          },
          disabled: busy || (needsRiskCheck && !agreed),
          onClick: () => void decideElevation(req.id, 'approve', chosenMode, needsRiskCheck ? agreed : false),
        }, busy ? '校验提交中…' : `批准进入 ${CHIEF_PERMISSION_LABELS[chosenMode] || chosenMode}`),
      ),
    ),
  )
}

export function AuditLogModal({ view }) {
  if (!view.auditLogModalOpen) return null
  const meta = view.chiefMeta || {}
  const logs = Array.isArray(meta.auditLog) ? meta.auditLog : []
  return h(
    'div',
    {
      className: 'dnb-modal-backdrop',
      onClick: e => {
        if (e.target === e.currentTarget) patch({ auditLogModalOpen: false })
      },
    },
    h(
      'div',
      { className: 'dnb-modal-card' },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h('span', { style: { fontSize: 13.5, fontWeight: 700, color: 'var(--dnb-text)' } }, '📜 6 级安全架构与审计日志'),
        h('button', {
          type: 'button',
          className: 'dnb-icon-btn',
          style: { width: 22, height: 22 },
          onClick: () => patch({ auditLogModalOpen: false }),
        }, h(Icon, { name: 'x', size: 13 })),
      ),
      h(
        'div',
        { className: 'dnb-pipe-bar' },
        ['用户模式', '操作请求', '安全卫兵硬性规则', '权限判定', '执行器', '审计日志'].map((step, idx, arr) =>
          h(
            React.Fragment,
            { key: step },
            h('span', { className: 'dnb-pipe-node' }, step),
            idx < arr.length - 1 ? h('span', null, '→') : null,
          ),
        ),
      ),
      logs.length === 0
        ? h('div', { style: { padding: '18px 8px', textAlign: 'center', fontSize: 12, color: 'var(--dnb-text-3)' } },
            '当前会话暂无审计记录；权限切换、安全卫兵拦截、逐项授权与执行操作都将实时落盘于此。')
        : h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 340, overflowY: 'auto' } },
            logs.map(entry => {
              const decisionColor = entry.decision === 'allow' || entry.decision === 'approved'
                ? '#34d399'
                : (entry.decision === 'prompt' ? '#60a5fa' : '#ff6961')
              return h(
                'div',
                { key: entry.id, className: 'dnb-audit-row' },
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 } },
                  h('span', { style: { fontWeight: 700, color: decisionColor } },
                    `${entry.stage || 'gate'} · ${entry.decision || ''} (${CHIEF_PERMISSION_LABELS[entry.mode] || entry.mode || 'advisor'})`),
                  h('span', { style: { fontSize: 10, color: 'var(--dnb-text-3)' } },
                    entry.at ? new Date(entry.at).toLocaleTimeString() : ''),
                ),
                h('div', { style: { color: 'var(--dnb-text)' } },
                  `${entry.operation || ''}${entry.target ? ' · ' + entry.target : ''}`),
                entry.outcome || entry.reason
                  ? h('div', { style: { color: 'var(--dnb-text-2)', wordBreak: 'break-word' } }, entry.outcome || entry.reason)
                  : null,
              )
            }),
          ),
    ),
  )
}
