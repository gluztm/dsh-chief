/**
 * components/modals.js
 *
 * Popovers, SuggestionBanner, and all safety/risk/approval/elevation/audit confirmation modals.
 */

import { React, h } from '../react-runtime.js'
import { CHIEF_PERMISSION_LABELS, INTERVENTION_TIER_DESC, RUN_MODE_OPTIONS, THINKING_EFFORT_OPTIONS } from '../constants.js'
import { bi, getUiLangPref, runModeMeta, permLabel } from '../i18n.js'
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
  applyScenarioPreset,
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
import { Icon, Switch, EffortFanGauge, renderStructuredText } from './common.js'

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
          minWidth: 262,
          maxWidth: 316,
          maxHeight: 'min(76vh, 480px)',
          overflowY: 'auto',
          zIndex: 9999,
        },
      },
      h('div', { style: { padding: '6px 10px 8px', borderBottom: '1px solid var(--dnb-border)', marginBottom: 4 } },
        h('div', { style: { fontSize: 10.5, fontWeight: 700, color: 'var(--dnb-text-3)', marginBottom: 4 } },
          bi('🧠 思考深度（拖弧线调整 · 点中间自动）', '🧠 Thinking Depth (drag arc · tap center for Auto)')),
        h(EffortFanGauge, {
          compact: true,
          value: (view.chiefMeta && view.chiefMeta.thinkingEffort) || 'auto',
          onChange: nextKey => void updateSecConfig({ thinkingEffort: nextKey }),
        }),
      ),
      h('div', { style: { padding: '5px 10px 4px', fontSize: 10.5, fontWeight: 600, color: 'var(--dnb-text-3)' } },
        bi('选择参谋长使用的模型', 'Choose Chief Model')),
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
          h('div', null, bi('✦ 跟随主对话模型', '✦ Follow main chat model')),
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
            catalog ? bi('没有其他可用模型，默认跟随主对话。', 'No extra providers found; following main chat.') : bi('正在加载模型…', 'Loading models…'))
        : null,
      h(
        'div',
        { className: 'dnb-lang-inline-bar', onClick: e => e.stopPropagation() },
        h('span', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', fontWeight: 600 } }, bi('🌐 语言', '🌐 Lang')),
        h(
          'div',
          { className: 'dnb-seg', style: { padding: 1.5, flex: '0 0 auto' } },
          [
            { key: 'auto', label: bi('自动', 'Auto') },
            { key: 'zh', label: '中文' },
            { key: 'en', label: 'EN' },
          ].map(opt =>
            h('button', {
              key: opt.key,
              type: 'button',
              className: 'dnb-seg-btn',
              style: { padding: '2px 7px', fontSize: 10 },
              'data-active': (view.uiLangPref || getUiLangPref()) === opt.key ? '1' : '0',
              onClick: () => void updateSecConfig({ uiLang: opt.key }),
            }, opt.label),
          ),
        ),
      ),
    ),
  )
}

export function PacePickerPopover({ view }) {
  if (!view.secPaceMenuOpen) return null
  const meta = view.chiefMeta || {}
  const currentRunMode = meta.stopped
    ? 'off'
    : (meta.runMode || (meta.paceMode === 'auto' ? 'managed' : (meta.paceMode === 'smart' ? 'patrol' : 'off')))
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
      h('div', { style: { padding: '5px 10px 4px', fontSize: 10.5, fontWeight: 600, color: 'var(--dnb-text-3)' } },
        bi('选择参谋长的工作方式', 'Choose how Chief runs')),
      RUN_MODE_OPTIONS.map(opt => {
        const rm = runModeMeta(opt.key)
        const active = currentRunMode === opt.key
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
              if (opt.key === 'managed' && currentRunMode !== 'managed') {
                patch({ secPaceMenuOpen: false, autoPilotConfirmOpen: true })
                return
              }
              patch({ secPaceMenuOpen: false })
              void updateSecConfig({
                runMode: opt.key,
                ...(opt.key === 'off' ? { paceMode: 'manual', autoPilot: false } : {}),
              })
            },
          },
          h('div', { style: { minWidth: 0, flex: 1 } },
            h('div', { style: { fontSize: 12, fontWeight: active ? 600 : 500, marginBottom: 2 } }, rm.label || opt.label),
            h('div', { style: { fontSize: 10.5, lineHeight: 1.4, color: 'var(--dnb-text-3)', whiteSpace: 'normal' } }, rm.hint || opt.hint),
          ),
          active ? h(Icon, { name: 'check', size: 13, style: { marginTop: 2 } }) : null,
        )
      }),
    ),
  )
}

function describeSuggestionMeta(sug) {
  if (!sug) return { typeLabel: '建议', impact: '调整协作方式', expect: '按建议继续', tone: 'var(--dnb-accent)', bg: 'rgba(10, 132, 255, 0.12)' }
  if (sug.kind === 'archive_op') {
    return {
      typeLabel: '📌 认知桌面调整',
      impact: `会调整：${sug.targetLabel || '📌 认知桌面'}（每轮发给主对话的少量资料）`,
      expect: '确认后会把资料固定到桌面、撤下，或发给主对话',
      tone: '#f59e0b',
      bg: 'rgba(245, 158, 11, 0.13)',
    }
  }
  if (sug.kind === 'model_effort') {
    return {
      typeLabel: '🧠 调整思考深度',
      impact: `会调整 ${sug.targetLabel || '@主对话'} 的思考深度`,
      expect: '确认后下一轮会按新深度思考',
      tone: '#a5b4fc',
      bg: 'rgba(99, 102, 241, 0.16)',
    }
  }
  if (sug.kind === 'goal_approval') {
    return {
      typeLabel: '🎯 申请确认完成目标',
      impact: '会把当前总目标标为已完成',
      expect: '确认后不再继续催着往下跑',
      tone: '#30d158',
      bg: 'rgba(48, 209, 88, 0.12)',
    }
  }
  if (sug.kind === 'guard_wall') {
    return {
      typeLabel: '🧱 新增物理驻墙',
      impact: `范围：${sug.targetLabel || '🌐 所有项目通用'}（触发规则会直接拦下）`,
      expect: '确认后生效，助手踩到红线时会被直接拦住',
      tone: '#f87171',
      bg: 'rgba(239, 68, 68, 0.13)',
    }
  }
  if (sug.kind === 'wall_removal') {
    const spec = (sug.wallRemovalSpec && typeof sug.wallRemovalSpec === 'object') ? sug.wallRemovalSpec : {}
    const actText = spec.action === 'remove' ? '永久删掉这条物理驻墙' : '暂时停用这条物理驻墙'
    return {
      typeLabel: '⚠️ 申请关闭物理驻墙（需你确认）',
      impact: `涉及：${spec.wallTitle || sug.targetLabel || '这条物理驻墙'}（所有模式都要你同意）`,
      expect: `同意后会${actText}，参谋长不能自己关闭`,
      tone: '#ef4444',
      bg: 'rgba(239, 68, 68, 0.18)',
    }
  }
  if (sug.kind === 'bound') {
    const colLabel = sug.boundField === 'allowed' ? '必做事项' : (sug.boundField === 'notes' ? '注意事项' : '禁止红线')
    const repCount = Array.isArray(sug.replaces) ? sug.replaces.filter(Boolean).length : 0
    return {
      typeLabel: repCount > 0 ? `🏛 合并边界 (${repCount} 合 1)` : `🏛 新增${colLabel}`,
      impact: sug.pinGlobal ? '📌 会固定为所有任务通用的规则' : '只对当前这次对话生效',
      expect: repCount > 0 ? `会合并掉 ${repCount} 条零散规则` : `会加入${colLabel}，让所有助手一起遵守`,
      tone: '#fbbf24',
      bg: 'rgba(245, 158, 11, 0.12)',
    }
  }
  if (sug.kind === 'advice') {
    return {
      typeLabel: '💡 参谋长建议',
      impact: `发给 @${shortAgentName(sug.targetLabel || sug.target || '主对话')} 的参考建议`,
      expect: '按建议调整方向或补上漏掉的检查',
      tone: 'var(--dnb-accent)',
      bg: 'rgba(10, 132, 255, 0.12)',
    }
  }
  return {
    typeLabel: '✦ 协作建议',
    impact: `发给 @${shortAgentName(sug.targetLabel || sug.target || '主对话')} 的${sug.mode === 'steer' ? '插话提示' : '后续消息'}`,
    expect: '确认后会发给对方，并更新进度',
    tone: 'var(--dnb-accent)',
    bg: 'rgba(10, 132, 255, 0.10)',
  }
}

export function SuggestionBanner({ view }) {
  const rawSuggestions = (view.secView && Array.isArray(view.secView.suggestions))
    ? view.secView.suggestions.filter(s => s && s.status === 'pending')
    : []
  const rankSug = s => ((s.kind === 'goal_approval' || s.kind === 'wall_removal') ? 0 : (s.kind === 'bound' || s.kind === 'guard_wall') ? 1 : 2)
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
          `已选 ${canExecuteCount}/${suggestions.length} 项，点右侧一起执行`),
      ),
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 } },
        h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: { height: 26, padding: '0 9px', fontSize: 11, color: 'var(--dnb-text-3)' },
          disabled: Boolean(view.secBusy),
          title: '忽略上面所有建议',
          onClick: () => void dismissPendingSuggestions(suggestions),
        }, '全部忽略'),
        h('button', {
          type: 'button',
          className: 'dnb-primary-btn',
          style: { height: 26, padding: '0 12px', fontSize: 11.5, fontWeight: 700 },
          disabled: Boolean(view.secBusy) || canExecuteCount === 0,
          title: selectedGoalCount > 0 && selectedNonGoalCount > 0
            ? '按当前权限和红线执行选中的建议（包括完成确认），并给你汇报结果'
            : '按当前权限和红线执行选中的建议，并给你汇报结果',
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
                }, openDraft ? '收起' : '详情')
              : null,
            h('button', {
              type: 'button',
              className: 'dnb-icon-btn',
              style: { width: 20, height: 20 },
              title: '忽略这条建议',
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
              `会合并这 ${replacesList.length} 条旧规则：` + replacesList.slice(0, 3).map(r => '「' + clampTitle(r, 14) + '」').join('、'))
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

const MODAL_WALL_TYPE_TAG = {
  forbid_cmd: '🚫 禁跑命令',
  forbid_path: '🚧 禁碰路径',
  restrict_write: '🔐 仅限目录可写',
  require_approval_cmd: '🛡️ 高危命令先请示',
  deny_tool: '⛔ 禁用工具',
}

export function InterventionConfirmModal({ view, board }) {
  const meta = view.chiefMeta || {}
  const tm = meta.tacticalModes || {}
  const rawBounds = (board && board.bounds) || (view.board && view.board.bounds) || {}
  const savedBoardObj = (board && board.objective) ? String(board.objective).trim() : ''
  const forbiddenList = (Array.isArray(rawBounds.forbidden) ? rawBounds.forbidden : [])
    .map(f => (typeof f === 'string' ? f.trim() : String((f && f.text) || '').trim()))
    .filter(Boolean)
  const allWalls = Array.isArray(view.guardWalls) ? view.guardWalls : []
  const activeWalls = allWalls.filter(w => w && w.scope !== 'paused' && w.activeNow !== false)
  const pausedWallsCount = allWalls.filter(w => w && w.scope === 'paused').length

  const [objDraft, setObjDraft] = React.useState(savedBoardObj)
  const [objLocked, setObjLocked] = React.useState(false)
  const [objFlashRed, setObjFlashRed] = React.useState(false)
  const [objGuardHint, setObjGuardHint] = React.useState('')
  const [suggestBusy, setSuggestBusy] = React.useState(false)
  const [suggestHistory, setSuggestHistory] = React.useState([])
  const [lastAiText, setLastAiText] = React.useState('')
  const [lastWasAiGuess, setLastWasAiGuess] = React.useState(false)
  const [suggestRationale, setSuggestRationale] = React.useState('')
  const [confirmBusy, setConfirmBusy] = React.useState(false)
  const [wallsSecCollapsed, setWallsSecCollapsed] = React.useState(false)
  const [redlinesSecCollapsed, setRedlinesSecCollapsed] = React.useState(false)
  const objBoxRef = React.useRef(null)

  React.useEffect(() => {
    if (!view.interventionModalOpen) return
    setObjDraft(savedBoardObj)
    setObjLocked(false)
    setObjFlashRed(false)
    setObjGuardHint('')
    setSuggestBusy(false)
    setSuggestHistory([])
    setLastAiText('')
    setLastWasAiGuess(false)
    setSuggestRationale('')
    setConfirmBusy(false)
    setWallsSecCollapsed(false)
    setRedlinesSecCollapsed(false)
  }, [view.interventionModalOpen])

  if (!view.interventionModalOpen) return null
  const permMode = ['advisor', 'assistant', 'strategist', 'chief'].includes(meta.permissionMode) ? meta.permissionMode : 'advisor'
  const trimmedDraft = String(objDraft || '').trim()
  const triggerObjRedFlash = (hintMsg) => {
    setObjGuardHint(hintMsg || '请先写好总目标，再点右上角「锁定目标」，然后开启强介入。')
    setObjFlashRed(false)
    const fire = () => setObjFlashRed(true)
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fire)
    else setTimeout(fire, 16)
    try {
      if (objBoxRef.current && typeof objBoxRef.current.scrollIntoView === 'function') {
        objBoxRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    } catch {}
  }
  const noDefenseRules = activeWalls.length === 0 && forbiddenList.length === 0
  const allDefenseCollapsed = wallsSecCollapsed && redlinesSecCollapsed
  const toggleAllDefense = () => {
    const next = !allDefenseCollapsed
    setWallsSecCollapsed(next)
    setRedlinesSecCollapsed(next)
  }

  const handleSuggestObjective = async () => {
    if (suggestBusy) return
    if (objLocked) {
      patch({ notice: '目标已锁定，先点「已锁定目标」解锁后再改。' })
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
        h('span', { style: { fontSize: 13.5, fontWeight: 700, color: '#f59e0b' } }, '⚡ 开启强介入：确认目标与安全规则'),
        h('button', {
          type: 'button',
          className: 'dnb-icon-btn',
          style: { width: 22, height: 22 },
          disabled: confirmBusy,
          onClick: () => patch({ interventionModalOpen: false }),
        }, h(Icon, { name: 'x', size: 13 })),
      ),
      // Core Objective Destination Editor inside Modal (建议 + 必须先点选锁定)
      h(
        'div',
        {
          ref: objBoxRef,
          className: objFlashRed ? 'dnb-obj-flash-red' : undefined,
          style: {
            borderRadius: 9,
            padding: '9px 10px',
            border: objLocked
              ? '1px solid rgba(245, 158, 11, 0.58)'
              : '1.5px solid rgba(255, 69, 58, 0.62)',
            background: objLocked ? 'rgba(245, 158, 11, 0.08)' : 'rgba(255, 69, 58, 0.06)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            fontSize: 11.5,
          },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' } },
          h('span', { style: { fontWeight: 700, color: objLocked ? 'var(--dnb-text)' : '#ff6961' } },
            objLocked
              ? '🎯 总目标（已锁定，开启后马上开始）'
              : '🎯 总目标（写好后请点右侧「锁定目标」）'),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 5 } },
            h('button', {
              type: 'button',
              className: 'dnb-mini-btn',
              'data-tone': 'blue',
              disabled: suggestBusy || objLocked,
              title: trimmedDraft && !(lastWasAiGuess && trimmedDraft === lastAiText.trim())
                ? '根据你写的内容，让参谋长帮你改得更清楚'
                : '让参谋长按当前对话帮你写一个目标，可多点几次换个写法',
              onClick: () => void handleSuggestObjective(),
            }, suggestBusy
              ? '生成中…'
              : (trimmedDraft && !(lastWasAiGuess && trimmedDraft === lastAiText.trim()) ? '✦ 帮我改改' : '✦ 帮我写')),
            h('button', {
              type: 'button',
              className: 'dnb-mini-btn',
              'data-tone': objLocked ? 'amber' : 'red',
              title: objLocked ? '点一下解锁就能修改' : '确认目标没问题后点这里锁定',
              onClick: () => {
                if (!objLocked && !trimmedDraft) {
                  triggerObjRedFlash('请先写清楚总目标，再点「锁定目标」。')
                  return
                }
                setObjLocked(v => {
                  const nextLocked = !v
                  if (nextLocked) {
                    setObjFlashRed(false)
                    setObjGuardHint('')
                  }
                  return nextLocked
                })
              },
            }, objLocked ? '🔒 已锁定目标' : '🔓 锁定目标'),
          ),
        ),
        h('textarea', {
          className: 'dnb-input',
          rows: 3,
          readOnly: objLocked,
          placeholder: '写下你要完成的目标；留空直接点右上角「✦ 帮我写」也可以…',
          style: {
            width: '100%',
            minHeight: 62,
            padding: '7px 9px',
            borderRadius: 7,
            fontSize: 12,
            lineHeight: 1.45,
            resize: 'vertical',
            borderColor: !objLocked ? 'rgba(255, 69, 58, 0.52)' : undefined,
            opacity: objLocked ? 0.88 : 1,
            cursor: objLocked ? 'not-allowed' : 'text',
          },
          value: objDraft,
          onChange: e => {
            if (objLocked) return
            setObjDraft(e.target.value)
            setLastWasAiGuess(false)
            if (objFlashRed) setObjFlashRed(false)
            if (objGuardHint) setObjGuardHint('')
          },
        }),
        suggestRationale
          ? h('div', { style: { fontSize: 11, color: '#60a5fa', lineHeight: 1.4 } }, '💡 为什么这么定：' + suggestRationale)
          : null,
        h('div', { style: { fontSize: 11, color: 'var(--dnb-text-3)', lineHeight: 1.4 } },
          !trimmedDraft
            ? h('span', { style: { color: '#ff6961', fontWeight: 600 } }, objGuardHint || '⚠ 请先写好目标（也可以点「✦ 帮我写」），然后点「锁定目标」。')
            : (!objLocked
                ? h('span', { style: { color: '#ff6961', fontWeight: 600 } }, objGuardHint || '⚠ 还差一步：点右上角「🔓 锁定目标」，才能开启强介入。')
                : '✓ 目标已锁定。点下方按钮就会马上按这个目标往下跑，不用再发“继续”。')),
      ),
      // Live Boundaries & Guard Walls Readback (Physical Guard Walls + Forbidden Redlines)
      h(
        'div',
        {
          style: {
            borderRadius: 9,
            padding: '8px 10px',
            border: noDefenseRules ? '1px solid rgba(255, 69, 58, 0.48)' : '1px solid var(--dnb-border)',
            background: noDefenseRules ? 'rgba(255, 69, 58, 0.08)' : 'var(--dnb-card)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            fontSize: 11.5,
          },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', minWidth: 0 } },
            h('strong', null, '🛡️ 安全规则检查：'),
            noDefenseRules
              ? h('span', { style: { color: '#ff453a', fontWeight: 600 } }, '还没设物理驻墙和禁止红线（直接自动跑风险较高）')
              : h(
                  React.Fragment,
                  null,
                  h('span', { style: { color: activeWalls.length > 0 ? '#f87171' : 'var(--dnb-text-3)', fontWeight: 700 } },
                    `🧱 物理驻墙 ${activeWalls.length} 条`),
                  h('span', { style: { color: 'var(--dnb-text-3)' } }, '·'),
                  h('span', { style: { color: forbiddenList.length > 0 ? '#34d399' : 'var(--dnb-text-3)', fontWeight: 700 } },
                    `🚫 禁止红线 ${forbiddenList.length} 条`),
                ),
          ),
          h(
            'div',
            { style: { display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0 } },
            !noDefenseRules
              ? h('button', {
                  type: 'button',
                  className: 'dnb-mini-btn',
                  title: allDefenseCollapsed ? '展开查看物理驻墙和红线详情' : '收起物理驻墙和红线详情',
                  onClick: toggleAllDefense,
                }, allDefenseCollapsed ? '↕ 一键拉开' : '↕ 一键收起')
              : null,
            h('button', {
              type: 'button',
              className: 'dnb-mini-btn',
              'data-tone': noDefenseRules ? 'amber' : 'blue',
              onClick: () => patch({ interventionModalOpen: false, tab: 'boundaries', settingsOpen: false }),
            }, '管理边界'),
          ),
        ),
        // Sub-section 1: Physical Guard Walls
        h(
          'div',
          {
            style: {
              borderRadius: 7,
              border: '1px solid rgba(248, 113, 113, 0.28)',
              background: 'rgba(239, 68, 68, 0.05)',
              overflow: 'hidden',
            },
          },
          h(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 6,
                padding: '5px 8px',
                cursor: 'pointer',
                userSelect: 'none',
              },
              onClick: () => setWallsSecCollapsed(v => !v),
            },
            h('span', { style: { fontSize: 11, fontWeight: 700, color: '#f87171' } },
              `🧱 物理驻墙（踩线直接拦住 · 已生效 ${activeWalls.length} 条${pausedWallsCount > 0 ? ` · ${pausedWallsCount} 条暂停` : ''}）`),
            h(Icon, {
              name: 'chevron',
              size: 12,
              style: {
                color: 'var(--dnb-text-3)',
                transform: wallsSecCollapsed ? 'none' : 'rotate(90deg)',
                transition: 'transform 0.16s ease',
              },
            }),
          ),
          !wallsSecCollapsed
            ? h(
                'div',
                { style: { padding: '0 8px 6px', display: 'flex', flexDirection: 'column', gap: 3.5 } },
                activeWalls.length > 0
                  ? [
                      ...activeWalls.slice(0, 4).map(w => {
                        const scopeTag = w.scope === 'workspace' ? '📁当前项目' : '🌐全局'
                        const typeTag = MODAL_WALL_TYPE_TAG[w.ruleType] || w.ruleType
                        const patStr = Array.isArray(w.patterns) ? w.patterns.join(', ') : ''
                        const previewPat = patStr.length > 52 ? patStr.slice(0, 52) + '…' : patStr
                        return h(
                          'div',
                          { key: w.id, style: { fontSize: 11, color: 'var(--dnb-text-2)', lineHeight: 1.45, wordBreak: 'break-word' } },
                          h('span', { style: { color: '#fca5a5', fontWeight: 600 } }, `• [${scopeTag} · ${typeTag}] `),
                          h('span', { style: { color: 'var(--dnb-text)', fontWeight: 600 } }, w.title || ''),
                          previewPat
                            ? h('span', { style: { color: 'var(--dnb-text-3)', fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 10.5 } }, ` — ${previewPat}`)
                            : null,
                        )
                      }),
                      activeWalls.length > 4
                        ? h('div', { key: 'more-walls', style: { fontSize: 10.5, color: 'var(--dnb-text-3)' } },
                            `…还有 ${activeWalls.length - 4} 条物理驻墙正在生效`)
                        : null,
                    ]
                  : h('div', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)' } },
                      '还没设物理驻墙（可点右上角「管理边界」添加）'),
              )
            : null,
        ),
        // Sub-section 2: Forbidden Redlines
        h(
          'div',
          {
            style: {
              borderRadius: 7,
              border: '1px solid var(--dnb-border)',
              background: 'rgba(148, 163, 184, 0.05)',
              overflow: 'hidden',
            },
          },
          h(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 6,
                padding: '5px 8px',
                cursor: 'pointer',
                userSelect: 'none',
              },
              onClick: () => setRedlinesSecCollapsed(v => !v),
            },
            h('span', { style: { fontSize: 11, fontWeight: 700, color: forbiddenList.length > 0 ? '#34d399' : 'var(--dnb-text-2)' } },
              `🚫 禁止红线（全局和当前规则 · 共 ${forbiddenList.length} 条）`),
            h(Icon, {
              name: 'chevron',
              size: 12,
              style: {
                color: 'var(--dnb-text-3)',
                transform: redlinesSecCollapsed ? 'none' : 'rotate(90deg)',
                transition: 'transform 0.16s ease',
              },
            }),
          ),
          !redlinesSecCollapsed
            ? h(
                'div',
                { style: { padding: '0 8px 6px', display: 'flex', flexDirection: 'column', gap: 3 } },
                forbiddenList.length > 0
                  ? [
                      ...forbiddenList.slice(0, 4).map((item, idx) =>
                        h('div', {
                          key: idx,
                          style: { fontSize: 11, color: 'var(--dnb-text-2)', lineHeight: 1.45, wordBreak: 'break-word' },
                        }, '• ' + (item.length > 88 ? item.slice(0, 88) + '…' : item)),
                      ),
                      forbiddenList.length > 4
                        ? h('div', { key: 'more-redlines', style: { fontSize: 10.5, color: 'var(--dnb-text-3)' } },
                            `…还有 ${forbiddenList.length - 4} 条禁止红线正在生效`)
                        : null,
                    ]
                  : h('div', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)' } }, '还没设禁止红线'),
              )
            : null,
        ),
      ),
      // 3 Concrete Operational Risks + 4-Tier Permission Behavior
      h(
        'div',
        { style: { fontSize: 11.5, color: 'var(--dnb-text-2)', lineHeight: 1.55 } },
        h('div', { style: { fontWeight: 600, color: 'var(--dnb-text)', marginBottom: 3 } }, '开启后会发生什么（请注意风险）：'),
        h('div', { style: { color: '#60a5fa', marginBottom: 4, fontWeight: 600 } },
          `• 当前权限：${INTERVENTION_TIER_DESC[permMode] || INTERVENTION_TIER_DESC.advisor}`),
        h('div', null, '• 会多花 Token：主对话每次停下来，参谋长都会检查一遍，还可能继续发消息。'),
        h('div', null, '• 会主动插话：参谋长会自己插话或安排下一步；点红色「⏹ 急停」能随时停下。'),
        h('div', null, `• 卡住会自动停：到 ${normalizeMaxTurnsVal(tm.maxInterventionTurns) === 0 ? '♾️ 不限轮数' : (normalizeMaxTurnsVal(tm.maxInterventionTurns) + ' 轮')} 或连续没进展时，会自动停下来防止死循环。`),
      ),
      // Dual Mandatory Disclaimers
      h(
        'div',
        { className: 'dnb-disclaimer-box' },
        h('div', { style: { marginBottom: 4 } },
          h('strong', null, '说明 1（效果看模型）：'),
          '参谋长检查准不准、能不能守住红线，很依赖你选的模型能力。不同模型理解规则的稳定度不一样，效果也会有差别。',
        ),
        h('div', null,
          h('strong', null, '说明 2（规则冲突）：'),
          '如果主对话或项目里设了太多系统规则，可能会和这里的自动提示打架，导致提前停机或跑偏。',
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
        '我已核对好目标和安全规则，了解模型和规则可能带来的影响，确认开启强介入。',
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
          style: {
            height: 32,
            padding: '0 15px',
            fontSize: 12.5,
            background: '#f59e0b',
            color: '#111',
            fontWeight: 700,
            opacity: (view.interventionAgreed && objLocked && trimmedDraft && !confirmBusy) ? 1 : 0.48,
          },
          disabled: confirmBusy,
          onClick: async () => {
            if (!trimmedDraft) {
              triggerObjRedFlash('⚠ 请先写好总目标，并点「锁定目标」，再开启强介入。')
              return
            }
            if (!objLocked) {
              triggerObjRedFlash('⚠ 请先点右上角的「🔓 锁定目标」，锁定后再开启强介入。')
              return
            }
            if (!view.interventionAgreed) {
              patch({ notice: '请先勾选下面的确认框' })
              return
            }
            setConfirmBusy(true)
            try {
              const curMax = normalizeMaxTurnsVal(tm.maxInterventionTurns)
              const ok = await updateSecConfig({
                tacticalModes: { ...tm, intervention: true, maxInterventionTurns: curMax },
                confirmedInterventionRisk: true,
                ...(curMax === 0 ? { confirmedUnlimitedTurns: true } : {}),
                coreObjective: trimmedDraft,
                objectiveLocked: true,
                startImmediately: true,
              })
              if (ok) patch({ interventionModalOpen: false, interventionAgreed: false })
            } finally {
              setConfirmBusy(false)
            }
          },
        }, confirmBusy ? '正在开启…' : '确认锁定并开启'),
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
        h('span', { style: { fontSize: 13.5, fontWeight: 700, color: '#f59e0b' } }, '♾️ 开启不限轮数自动推进 — 风险确认'),
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
          h('strong', null, '会一直往下推：'),
          '开启后，只要参谋长觉得任务还没做完，就会一直发指令让它继续跑，不再限制轮数。',
        ),
        h('div', null,
          h('strong', null, '费钱且可能反复拉锯：'),
          '遇到难题时，两边模型可能来回讨论很久，花掉大量 Token。只有连续 8 轮没新进展才会自动停，你随时可以点「⏹ 急停」或把模式切回「⏸ 关停」。',
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
        }, '还是限制轮数'),
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
        }, '确认不限轮数'),
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
        h('span', { style: { fontSize: 13.5, fontWeight: 700, color: '#34d399' } },
          bi('🤖 开启托管模式：确认后台整理与费用上限', '🤖 Enable Managed Mode: Cleanup & Budget Limits')),
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
          h('strong', null, bi('1. 后台盯着进度（不串台）：', '1. Watch progress per chat: ')),
          bi(
            '参谋长会按你的权限等级（L0–L3）盯着目标和红线，出错或断线时帮忙续上。它不会改全局固定红线，也不会翻看长期冷库资料。',
            'Watches goals and rules under your permission level (L0–L3) and resumes dropped chats. Never edits global pinned rules or cold archives.',
          ),
        ),
        h('div', { style: { marginBottom: 4 } },
          h('strong', null, bi('2. 🌙 后台「梦境漫游」轻拢卷宗：', '2. 🌙 Background Dream Roam: ')),
          bi(
            'L1+ 权限时，后台会自动将未织钩子草稿与刚撤下桌面的卷宗分拣入抽屉并织就轻量钩子（只做收纳梳理，不改代码，不擅自回推桌面）。',
            'At L1+, sorts unhooked drafts into archive folders and weaves keyword hooks without modifying code.',
          ),
        ),
        h('div', null,
          h('strong', null, bi('3. 闲置自动停机与费用上限：', '3. Auto-pause & spending cap: ')),
          bi(
            '闲置满 15 分钟（或目标完成且没待办）会自动切回「⏸ 关停」。达到费用上限时也会立刻停下，帮你省钱。',
            'Switches back to ⏸ Off after 15m idle with no open tasks, or right away if the budget cap is reached.',
          ),
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
        }, bi('暂不开启', 'Cancel')),
        h('button', {
          type: 'button',
          className: 'dnb-primary-btn',
          style: { height: 32, padding: '0 15px', fontSize: 12.5, fontWeight: 700 },
          onClick: async () => {
            const ok = await updateSecConfig({
              runMode: 'managed',
              paceMode: 'auto',
              autoPilot: true,
              confirmedAutoPilot: true,
            })
            if (ok) patch({ autoPilotConfirmOpen: false })
          },
        }, bi('🤖 确认开启托管', '🤖 Confirm Managed Mode')),
      ),
    ),
  )
}

export function AwayPresetConfirmModal({ view }) {
  if (!view.awayPresetModalOpen) return null
  const agreed = Boolean(view.awayPresetAgreed)
  const busy = Boolean(view.chiefRiskBusy)
  return h(
    'div',
    {
      className: 'dnb-modal-backdrop',
      onClick: e => {
        if (e.target === e.currentTarget && !busy) patch({ awayPresetModalOpen: false, awayPresetAgreed: false })
      },
    },
    h(
      'div',
      { className: 'dnb-modal-card' },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h('span', { style: { fontSize: 13.5, fontWeight: 700, color: '#f59e0b' } },
          bi('🚀 开启「离桌托管」预设', '🚀 Enable "Away Mode" Preset')),
        h('button', {
          type: 'button',
          className: 'dnb-icon-btn',
          style: { width: 22, height: 22 },
          disabled: busy,
          onClick: () => patch({ awayPresetModalOpen: false, awayPresetAgreed: false }),
        }, h(Icon, { name: 'x', size: 13 })),
      ),
      h(
        'div',
        { className: 'dnb-risk-box' },
        h('div', { style: { fontSize: 12.5, fontWeight: 700, color: '#f59e0b' } },
          bi('⚠️ 开启后会同时打开以下设置（仍受物理驻墙和红线限制）：', '⚠️ Turns on these settings (still bound by guard walls and rules):')),
        h(
          'ul',
          { style: { margin: '0 0 0 18px', padding: 0, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--dnb-text)' } },
          h('li', null, bi('权限升到 L3 · 参谋长模式（可自动调度对话和子代理、断线续跑）', 'Permission: L3 · Chief (auto-guides chats, subagents, and resumes)')),
          h('li', null, bi('工作方式切到 🤖 托管（后台盯进度，用梦境漫游整理档案，闲置 15 分钟自动停）', 'Run mode: 🤖 Managed (watches progress, runs Dream Roam cleanup, auto-pauses after 15m idle)')),
          h('li', null, bi('对话满 80% 自动压缩，并开启 🛡 红线哨兵提醒越界风险', 'Auto-compacts at 80% context and turns on 🛡 Sentinel alerts')),
          h('li', null, bi('设置费用上限（30 次调用或 300K Tokens 自动停），关键节点发桌面通知', 'Stops at budget limit (30 calls or 300K tokens) and sends desktop alerts')),
        ),
      ),
      h(
        'label',
        { className: 'dnb-risk-check' },
        h('input', {
          type: 'checkbox',
          checked: agreed,
          disabled: busy,
          style: { marginTop: 3 },
          onChange: e => patch({ awayPresetAgreed: Boolean(e.target.checked) }),
        }),
        h('span', null, bi(
          '我已了解 L3 高权限和自动托管的风险，确认开启「离桌托管」。',
          'I understand the L3 and auto-managed risks, and confirm enabling Away Mode.',
        )),
      ),
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
        h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: { height: 32, padding: '0 14px', fontSize: 12.5 },
          disabled: busy,
          onClick: () => patch({ awayPresetModalOpen: false, awayPresetAgreed: false }),
        }, bi('取消', 'Cancel')),
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
              const ok = await applyScenarioPreset('away', {
                confirmedChiefRisk: true,
                confirmedAutoPilot: true,
              })
              if (ok) patch({ awayPresetModalOpen: false, awayPresetAgreed: false })
            } finally {
              patch({ chiefRiskBusy: false })
            }
          },
        }, busy ? bi('正在开启…', 'Enabling…') : bi('确认开启离桌托管', 'Enable Away Mode')),
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
          `📨 带上资料发给对话（已选 ${items.length} 份）`),
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
        h('span', { style: { fontSize: 11.5, color: 'var(--dnb-text-3)' } }, '发给谁：'),
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
          h('option', { value: 'followup' }, '排队发送'),
          h('option', { value: 'steer' }, '立刻插话'),
        ),
      ),
      h('textarea', {
        className: 'dnb-textarea',
        rows: 3,
        disabled: busy,
        style: { fontSize: 12, minHeight: 74, resize: 'vertical' },
        placeholder: '写一句附带要求，参谋长会连同资料一起发过去（比如：改代码时别动现有测试）…',
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
        }, busy ? '正在发送…' : `📨 发给 @${m.target === 'lead' || !m.target ? '主对话' : shortAgentName(m.target, true)}`),
      ),
    ),
  )
}

export function DistillToGlobalModal({ view }) {
  const m = view.distillGlobalModal
  if (!m) return null
  const busy = Boolean(view.distillBusy)
  const countLabel = Array.isArray(m.ids) && m.ids.length > 0
    ? `选中的 ${m.ids.length} 份档案`
    : '当前对话里值得长期留存的经验'
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
        h('span', { style: { fontSize: 13.5, fontWeight: 700, color: 'var(--dnb-accent)' } }, '✦ 把经验存到全局档案库'),
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
        `参谋长会从「${countLabel}」里挑出以后还能用的经验，存到「🌐 全局档案柜」。一次性的过程记录会自动过滤，原档案默认保留。`,
      ),
      h('textarea', {
        className: 'dnb-textarea',
        rows: 2,
        disabled: busy,
        style: { fontSize: 12, minHeight: 56, resize: 'vertical' },
        placeholder: '可选：告诉参谋长重点留哪些内容（比如：打包命令或踩坑记录）…',
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
        '保存成功后，顺便删掉当前对话里的原档案（默认保留）',
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
        }, busy ? '正在整理保存…' : '✦ 存到全局档案'),
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
        h('span', { style: { fontSize: 13.5, fontWeight: 700, color: 'var(--dnb-accent)' } }, '💡 参谋长给你的建议'),
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
        m.title || '参谋长有一条新建议',
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
        }, '稍后再看'),
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
            }, '忽略这条')
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
            }, '放到输入框改改')
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
        }, busy ? '正在发送…' : '📨 采纳并告诉主对话'),
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
      ...(goTab ? { tab: goTab, settingsOpen: false } : {}),
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
          isBoundHit ? '🚫 踩到红线，强介入已自动停下' : '🚨 检测到高风险，强介入已自动停下',
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
          isBoundHit ? '即将触犯边界' : '可能有不可逆风险',
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
        m.reason || '继续操作可能会改坏东西或触犯红线，参谋长已经停了下来。',
      ),
      m.objective
        ? h(
            'div',
            { style: { fontSize: 11, color: 'var(--dnb-text-3)', lineHeight: 1.4 } },
            '暂停前的目标：',
            m.objective,
          )
        : null,
      h(
        'div',
        { style: { fontSize: 11.5, color: 'var(--dnb-text-2)', lineHeight: 1.45 } },
        '已经帮你关掉「⚡ 强介入」和自动续跑，避免继续操作出错。请先检查一下情况，确认没问题后再决定要不要重启。',
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
        }, '查看边界规则'),
        h('button', {
          type: 'button',
          className: 'dnb-primary-btn',
          style: { height: 32, padding: '0 16px', fontSize: 12.5, fontWeight: 700, background: '#ff453a', color: '#fff' },
          disabled: ackBusy,
          onClick: () => void dismissAndAck(''),
        }, ackBusy ? '确认中…' : '我知道了'),
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
        h('span', { style: { fontSize: 13.5, fontWeight: 700, color: 'var(--dnb-accent)' } }, '⏬ 把常用经验存到长期冷库'),
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
        `会把「${m.label || '当前档案'}」里值得复用的经验提炼出来，存进项目长期冷库。冷库里的内容平时 `,
        h('strong', { style: { color: 'var(--dnb-text)' } }, '占 0 Token'),
        '，只有你点「翻出」时才会发给当前对话。',
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
        '存进冷库后，顺便删掉原来的零散记录',
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
        }, view.archivePrecipitating ? '正在整理保存…' : '开始保存'),
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
        h('span', { style: { fontSize: 13.5, fontWeight: 700, color: '#f59e0b' } }, '⚠️ 确认连接另一个对话窗口'),
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
        h('div', null, h('strong', null, '要连接的窗口：'), m.peerTitle || shortSession(m.peerId)),
        m.peerObjective
          ? h('div', { style: { color: 'var(--dnb-text-2)' } }, h('strong', null, '对方的目标：'), m.peerObjective)
          : null,
      ),
      h(
        'div',
        { className: 'dnb-disclaimer-box' },
        '连上之后，两个窗口会共享进度和消息。\n',
        h('strong', null, '如果它们做的不是同一件事，连在一起会把两边的资料和摘要弄混。'),
        '\n请确认这两个对话有关联再连接。以后随时断开，资料也会立刻分开。',
      ),
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'flex-end', gap: 7 } },
        h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: { height: 28, padding: '0 12px', fontSize: 12 },
          onClick: () => patch({ peerLinkConfirmModal: null }),
        }, '先不连接'),
        h('button', {
          type: 'button',
          className: 'dnb-primary-btn',
          style: { height: 28, padding: '0 14px', fontSize: 12, background: '#f59e0b', color: '#111', fontWeight: 700 },
          onClick: async () => {
            const pid = m.peerId
            patch({ peerLinkConfirmModal: null })
            await togglePeerSessionLink(pid, true)
          },
        }, '确认相关并连接'),
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
        h('span', { style: { fontSize: 13.5, fontWeight: 700, color: '#f59e0b' } }, '⚠️ 交接单还没更新到最新进度'),
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
        m.reason || '交接单是给新对话看的前情提要。现在还没写最新进展，直接交接会让新对话接不上，建议先更新一下再交接。',
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
        }, '自己去改'),
        h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: { height: 28, padding: '0 10px', fontSize: 11.5 },
          disabled: Boolean(view.secRegenerating),
          onClick: () => {
            patch({ handoffWarnModal: null })
            void transfer(m.target, m.opts)
          },
        }, '直接交接'),
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
        }, view.secRegenerating ? '正在更新交接单…' : '✦ 更新交接单并交接'),
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
        h('span', { style: { fontSize: 13.5, fontWeight: 700, color: '#f59e0b' } },
          bi('L3 · 参谋长模式：确认风险', 'L3 · Chief Mode: Confirm Risks')),
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
          bi('⚠️ 开启高权限前请确认', '⚠️ Before turning on high permissions')),
        h('div', { style: { fontSize: 12, color: 'var(--dnb-text-2)' } }, bi('开启后，AI 可能会自己做这些事：', 'Once enabled, the AI can do these on its own:')),
        h(
          'ul',
          { style: { margin: '0 0 0 18px', padding: 0, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--dnb-text)' } },
          h('li', null, bi('修改你项目里的文件', 'Edit files in your project')),
          h('li', null, bi('运行终端命令', 'Run system commands')),
          h('li', null, bi('调度主对话和子代理的工作', 'Guide main chat and subagents')),
          h('li', null, bi('做一些删改后难以撤回的操作', 'Make changes that are hard to undo')),
        ),
        h('div', { style: { fontSize: 12, fontWeight: 600, color: 'var(--dnb-text-2)' } },
          bi('就算开了安全规则保护，也不能保证不出意外。', 'Even with safety rules on, some risk remains.')),
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
        h('span', null, bi('我已阅读并知悉上述风险，理解高权限模式可能造成的后果。', 'I have read and acknowledge these risks and understand the consequences of high-permission mode.')),
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
        }, bi('取消', 'Cancel')),
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
        }, busy ? bi('正在开启…', 'Enabling…') : bi('确认开启', 'Confirm')),
      ),
      h('div', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', lineHeight: 1.4 } },
        '切换回低权限或开新对话时，高权限会自动关闭，需要重新确认。'),
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
          title: '先不处理（提示会留在底部）',
          disabled: busy,
          onClick: dismissCurrent,
        }, h(Icon, { name: 'x', size: 13 })),
      ),
      h(
        'div',
        { className: 'dnb-op-box' },
        h('div', { style: { fontSize: 13, fontWeight: 700, color: '#d97706', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
          '🛡️ 请你确认这项操作',
          active.kind === 'archive_op'
            ? h('span', { className: 'dnb-tag', style: { fontSize: 10, color: '#fbbf24' } }, '📌 向主对话发资料')
            : (active.kind === 'model_effort'
                ? h('span', { className: 'dnb-tag', style: { fontSize: 10, color: '#a5b4fc' } }, '🧠 调整思考深度')
                : (active.kind === 'auto_continue'
                    ? h('span', { className: 'dnb-tag', style: { fontSize: 10, color: '#38bdf8' } }, '⚡ 断线后继续跑')
                    : null)),
        ),
        h('div', { className: 'dnb-op-kv' },
          h('span', { className: 'dnb-op-k' }, '操作：'),
          h('span', null, active.operationLabel || '需要你批准的操作'),
        ),
        h('div', { className: 'dnb-op-kv' },
          h('span', { className: 'dnb-op-k' }, '目标：'),
          h('span', { className: 'dnb-op-code' }, active.targetLabel || '当前项目'),
        ),
        h('div', { className: 'dnb-op-kv' },
          h('span', { className: 'dnb-op-k' }, '原因：'),
          h('span', null, active.reason || '为了推进当前任务'),
        ),
        h('div', { className: 'dnb-op-kv' },
          h('span', { className: 'dnb-op-k' }, '影响：'),
          h('span', null, active.impact || '只会执行这一次，之后如需继续会再问你'),
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
        h('span', { style: { fontSize: 13.5, fontWeight: 700, color: '#60a5fa' } }, '⬆️ 参谋长申请更高权限'),
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
          h('span', { className: 'dnb-op-k' }, '权限变化：'),
          h('span', null, `${CHIEF_PERMISSION_LABELS[req.fromMode] || req.fromMode} → 申请 ${CHIEF_PERMISSION_LABELS[req.targetMode] || req.targetMode}`),
        ),
        h('div', { className: 'dnb-op-kv' },
          h('span', { className: 'dnb-op-k' }, '谁发起的：'),
          h('span', { className: 'dnb-op-code' }, req.by || 'chief'),
        ),
        h('div', { className: 'dnb-op-kv' },
          h('span', { className: 'dnb-op-k' }, '原因：'),
          h('span', null, req.reason || '当前任务需要更多权限才能继续'),
        ),
        req.requestedActionSummary
          ? h('div', { className: 'dnb-op-kv' },
              h('span', { className: 'dnb-op-k' }, '准备做什么：'),
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
          }, modeKey === 'strategist' ? '🛡️ 更稳妥：只开到 L2 · 参谋模式（每步问你）' : (CHIEF_PERMISSION_LABELS[modeKey] || modeKey))
        }),
      ),
      needsRiskCheck
        ? h(
            React.Fragment,
            null,
            h(
              'div',
              { className: 'dnb-risk-box' },
              h('div', { style: { fontSize: 13, fontWeight: 700, color: '#f59e0b' } }, '⚠️ 升级到 L3 高权限的风险'),
              h('div', { style: { fontSize: 11.5, color: 'var(--dnb-text-2)' } },
                '进入 L3 · 参谋长模式后，AI 可以直接改项目文件、跑命令，也能调度其他助手。就算有安全规则保护，也不能保证不出意外。'),
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
        }, '不批准'),
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
        }, busy ? '正在开启…' : `同意进入 ${CHIEF_PERMISSION_LABELS[chosenMode] || chosenMode}`),
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
        h('span', { style: { fontSize: 13.5, fontWeight: 700, color: 'var(--dnb-text)' } },
          bi('📜 安全检查流程与操作记录', '📜 Security Flow & Action Log')),
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
        [
          bi('权限等级', 'Level'),
          bi('申请操作', 'Request'),
          bi('硬性红线检查', 'Guard Rules'),
          bi('权限检查', 'Permission'),
          bi('实际执行', 'Run'),
          bi('记录留存', 'Log'),
        ].map((step, idx, arr) =>
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
            bi('目前还没有操作记录。以后切换权限、拦截违规操作或你点同意时，都会记在这里。', 'No records yet. Permission changes, blocked actions, and your approvals will appear here.'))
        : h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 340, overflowY: 'auto' } },
            logs.map(entry => {
              const dec = String(entry.decision || '').toLowerCase()
              const isGreen = ['allow', 'approved', 'approved_by_user', 'executed', 'executed_approved', 'elevation_approved', 'mode_changed', 'reset_to_l0'].includes(dec)
              const isBlue = ['prompt', 'pending_approval', 'elevation_requested', 'pending'].includes(dec)
              const decisionColor = isGreen ? '#34d399' : (isBlue ? '#60a5fa' : '#ff6961')
              const ruleTag = entry.rule ? ` [${entry.rule}]` : ''
              const durTag = entry.durationMs > 0 ? `${entry.durationMs}ms · ` : ''
              const detailText = entry.summary || entry.reason || entry.outcome || ''
              return h(
                'div',
                { key: entry.id, className: 'dnb-audit-row' },
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 } },
                  h('span', { style: { fontWeight: 700, color: decisionColor } },
                    `${entry.stage || 'gate'} · ${entry.decision || ''}${ruleTag} (${CHIEF_PERMISSION_LABELS[entry.mode] || entry.mode || 'advisor'})`),
                  h('span', { style: { fontSize: 10, color: 'var(--dnb-text-3)' } },
                    `${durTag}${entry.at ? new Date(entry.at).toLocaleTimeString() : ''}`),
                ),
                h('div', { style: { color: 'var(--dnb-text)' } },
                  `${entry.operation || ''}${entry.target ? ' · ' + entry.target : ''}`),
                detailText
                  ? h('div', { style: { color: 'var(--dnb-text-2)', wordBreak: 'break-word' } }, detailText)
                  : null,
              )
            }),
          ),
    ),
  )
}
