/**
 * src/client/components/modals/pickers.js — 模型选择弹出气泡与主动建议胶囊条
 *
 * 【核心职责】
 *   承载 `ModelPickerPopover` 与 `SuggestionBanner`（含 `describeSuggestionMeta`），
 *   提供轻量内联选择气泡与参谋建议逐条/一键采纳控制。
 *
 * 【边界约定】
 *   - 只包含非全屏遮罩类选择器与建议横幅；模态确认弹窗分布在 `modals/{intervention,workflow,safety}.js`。
 */

import { React, h } from '../../react-runtime.js'
import { bi } from '../../i18n.js'
import { patch } from '../../store.js'
import { clampTitle, fullModelWithChannel, shortAgentName } from '../../utils.js'
import {
  updateSecConfig,
  decideSuggestion,
  executePendingSuggestions,
  dismissPendingSuggestions,
} from '../../api.js'
import { Icon, EffortFanGauge, renderStructuredText } from '../common.js'

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
          top: 'calc(100% + 4px)',
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
          bi('思考深度（拖弧线调整 · 点中间自动）', 'Thinking Depth (drag arc · tap center for Auto)')),
        h(EffortFanGauge, {
          compact: true,
          skin: view.uiSkin,
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
      typeLabel: '🚧 新增自定义拦截规则',
      impact: `范围：${sug.targetLabel || '🌐 所有项目通用'}（触发规则会直接拦下）`,
      expect: '确认后生效，助手踩到规则时会被直接拦住',
      tone: '#f87171',
      bg: 'rgba(239, 68, 68, 0.13)',
    }
  }
  if (sug.kind === 'wall_removal') {
    const spec = (sug.wallRemovalSpec && typeof sug.wallRemovalSpec === 'object') ? sug.wallRemovalSpec : {}
    const actText = spec.action === 'remove' ? '永久删掉这条拦截规则' : '暂时停用这条拦截规则'
    return {
      typeLabel: '⚠️ 申请关闭自定义拦截规则（需你确认）',
      impact: `涉及：${spec.wallTitle || sug.targetLabel || '这条自定义拦截规则'}（所有模式都要你同意）`,
      expect: `同意后会${actText}，参谋长不能自己关闭`,
      tone: '#ef4444',
      bg: 'rgba(239, 68, 68, 0.18)',
    }
  }
  if (sug.kind === 'bound') {
    const colLabel = sug.boundField === 'allowed' ? '必须做' : (sug.boundField === 'notes' ? '注意' : '不要做')
    const repCount = Array.isArray(sug.replaces) ? sug.replaces.filter(Boolean).length : 0
    return {
      typeLabel: repCount > 0 ? `📝 合并规矩 (${repCount} 合 1)` : `📝 新增「${colLabel}」`,
      impact: sug.pinGlobal ? '📌 会固定为所有对话通用的规矩' : '只对当前这次对话生效',
      expect: repCount > 0 ? `会合并掉 ${repCount} 条零散规矩` : `会加入「${colLabel}」，提醒助手遵守`,
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

