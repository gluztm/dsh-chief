/**
 * tabs/boundaries.js
 *
 * Global & session boundaries editor cards and BoundariesTab.
 */

import { React, h } from '../react-runtime.js'
import { BOUND_LISTS, BOUND_CAP } from '../constants.js'
import { store, patch } from '../store.js'
import {
  requestConsolidateBounds,
  submitChiefBar,
  copyText,
  addBoundRule,
  toggleBoundPin,
  removeBoundRule,
  editBoundRule,
  toggleBoundSelect,
} from '../api.js'
import { Icon } from '../components/common.js'
import { HandoffTab } from './plan.js'

function BoundCard({ field, label, dot, items, pinnedItems }) {
  const [editingItem, setEditingItem] = React.useState('')
  const [editingVal, setEditingVal] = React.useState('')

  const draft = (store.boundDraft && store.boundDraft[field]) || ''
  const pinDraft = Boolean(store.boundPinDraft && store.boundPinDraft[field])
  const list = Array.isArray(items) ? items : []
  const pinnedSet = new Set(Array.isArray(pinnedItems) ? pinnedItems : [])
  const selected = ((store.boundSelected && store.boundSelected[field]) || []).filter(x => list.includes(x))
  const full = list.length >= BOUND_CAP
  const isConsolidatingCol = store.boundConsolidating === field

  const commit = () => {
    const text = draft.trim()
    if (!text || full) return
    if (!list.includes(text)) void addBoundRule(field, text, pinDraft)
    else patch({ boundDraft: { ...store.boundDraft, [field]: '' } })
  }

  const saveInlineEdit = () => {
    const nextText = editingVal.trim()
    const prevText = editingItem
    setEditingItem('')
    setEditingVal('')
    if (prevText && nextText && nextText !== prevText) {
      void editBoundRule(field, prevText, nextText)
    }
  }

  const pinnedCountInCol = list.filter(x => pinnedSet.has(x)).length

  return h(
    'div',
    { style: { marginBottom: 12 } },
    h(
      'div',
      { className: 'dnb-section-head' },
      h(
        'span',
        {
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            color: field === 'allowed' ? '#34d399' : field === 'forbidden' ? '#ff6961' : '#fbbf24',
          },
        },
        h('span', { style: { width: 7, height: 7, borderRadius: '50%', background: dot } }),
        label,
        pinnedCountInCol > 0
          ? h('span', { style: { fontSize: 10.5, color: '#fbbf24', fontWeight: 600 } }, `📌${pinnedCountInCol}`)
          : null,
      ),
      h(
        'div',
        { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
        list.length >= 2
          ? h('button', {
              className: 'dnb-pill',
              style: {
                height: 21,
                padding: '0 7px',
                fontSize: 10.5,
                color: selected.length >= 2 ? 'var(--dnb-primary-fg, #fff)' : 'var(--dnb-accent)',
                background: selected.length >= 2 ? 'var(--dnb-primary-bg, #2563eb)' : 'rgba(37, 99, 235, 0.12)',
                borderColor: 'rgba(37, 99, 235, 0.28)',
              },
              disabled: Boolean(store.secBusy),
              title: selected.length >= 2
                ? `请参谋长将勾选的 ${selected.length} 条零散规则总结成一条`
                : `请参谋长将【${label}】下的 ${list.length} 条零散规则浓缩总结成一条`,
              onClick: () => void requestConsolidateBounds(field, selected.length >= 2 ? selected : []),
            },
            h(Icon, { name: 'sparkles', size: 10.5 }),
            isConsolidatingCol
              ? '浓缩中…'
              : (selected.length >= 2 ? `${selected.length} 条合一` : '总结成一条'))
          : null,
        list.length ? h('span', null, String(list.length)) : null,
      ),
    ),
    h(
      'div',
      { className: 'dnb-group' },
      list.map((item, idx) => {
        const isPinned = pinnedSet.has(item)
        const isChecked = selected.includes(item)
        const isRowEditing = editingItem === item

        return h(
          'div',
          {
            key: idx + ':' + item,
            className: 'dnb-cell dnb-cell-hover',
            style: {
              justifyContent: 'space-between',
              gap: 8,
              background: isPinned ? 'linear-gradient(90deg, rgba(245, 158, 11, 0.08) 0%, transparent 65%)' : undefined,
            },
          },
          // Front Pushpin Stamp (小图钉戳)
          h('button', {
            className: 'dnb-pin-stamp',
            'data-pinned': isPinned ? '1' : '0',
            title: isPinned
              ? '📌 已定住（全局跨任务共享）· 点击取下图钉改为仅本任务有效'
              : '仅当前任务生效 · 点击盖上小图钉定住为全局共享',
            onClick: () => void toggleBoundPin(field, item, !isPinned),
          }, h(Icon, { name: 'pinStamp', size: 13 })),

          isRowEditing
            ? h('input', {
                className: 'dnb-input',
                style: { flex: 1, height: 26, fontSize: 12, padding: '0 7px' },
                autoFocus: true,
                value: editingVal,
                onChange: e => setEditingVal(e.target.value),
                onBlur: saveInlineEdit,
                onKeyDown: e => {
                  if (e.key === 'Enter') saveInlineEdit()
                  else if (e.key === 'Escape') {
                    setEditingItem('')
                    setEditingVal('')
                  }
                },
              })
            : h(
                'div',
                {
                  style: { display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 },
                  onDoubleClick: () => {
                    setEditingItem(item)
                    setEditingVal(item)
                  },
                },
                isPinned ? h('span', { className: 'dnb-pin-badge' }, '全局') : null,
                h('span', {
                  style: {
                    fontSize: 12.5,
                    wordBreak: 'break-word',
                    flex: 1,
                    fontWeight: isPinned ? 500 : 400,
                  },
                }, item),
              ),

          h(
            'div',
            { style: { display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 } },
            list.length >= 2 && !isRowEditing
              ? h('button', {
                  className: 'dnb-bound-check',
                  'data-checked': isChecked ? '1' : '0',
                  title: isChecked ? '已选入待合并零散边界' : '勾选以挑出多条零散边界合并成一条',
                  onClick: () => toggleBoundSelect(field, item),
                }, h(Icon, { name: 'check', size: 10.5 }))
              : null,
            !isRowEditing
              ? h('button', {
                  className: 'dnb-icon-btn dnb-row-actions',
                  style: { width: 22, height: 22 },
                  title: '编辑条文',
                  onClick: () => {
                    setEditingItem(item)
                    setEditingVal(item)
                  },
                }, h(Icon, { name: 'edit', size: 11.5 }))
              : null,
            h('button', {
              className: 'dnb-icon-btn dnb-row-actions',
              style: { width: 22, height: 22, color: '#ff453a' },
              title: '删除此条边界',
              onClick: () => void removeBoundRule(field, item),
            }, h(Icon, { name: 'x', size: 12 })),
          ),
        )
      }),
      h(
        'div',
        { className: 'dnb-cell', style: { padding: '6px 10px', gap: 7 } },
        h('button', {
          className: 'dnb-pin-stamp',
          'data-pinned': pinDraft ? '1' : '0',
          title: pinDraft ? '📌 新增时直接定住为全局共享（点击切换为仅本任务）' : '新增时仅本任务有效（点击小图钉切换为全局共享）',
          onClick: () => patch({ boundPinDraft: { ...(store.boundPinDraft || {}), [field]: !pinDraft } }),
        }, h(Icon, { name: 'pinStamp', size: 12.5 })),
        h('input', {
          className: 'dnb-input',
          style: { border: 'none', background: 'transparent', padding: '2px 4px', height: 24, flex: 1 },
          placeholder: full
            ? '已达上限'
            : (pinDraft ? '添加全局共享规则（跨任务生效）…' : '添加当前任务规则（点左侧图钉可定住全局）…'),
          disabled: full,
          value: draft,
          onChange: e => patch({ boundDraft: { ...store.boundDraft, [field]: e.target.value } }),
          onKeyDown: e => { if (e.key === 'Enter') commit() },
        }),
        draft.trim()
          ? h('button', {
              className: 'dnb-pill dnb-pill-accent',
              style: { height: 24 },
              onClick: commit,
            }, pinDraft ? '📌 定住添加' : '添加')
          : null,
      ),
    ),
  )
}

export function BoundariesTab({ store: view }) {
  const [showEnv, setShowEnv] = React.useState(false)
  const subTab = view.boundSubTab || 'rules'
  const bounds = (view.board && view.board.bounds) || {}
  const pinnedBounds = (view.board && view.board.pinnedBounds) || {}
  const hasConsolidatableCol = BOUND_LISTS.some(b => ((bounds[b.field] || []).length >= 2))
  const totalPinnedCount = BOUND_LISTS.reduce((acc, b) => acc + ((pinnedBounds[b.field] || []).length), 0)
  const info = view.boundaries || {}
  const rows = [
    ['工作目录', info.sessionWorkingDirectory || info.workingDirectory],
    ['沙箱模式', info.sessionSandboxMode || info.sandboxMode],
    ['可写路径', info.workspaceRoot],
    ['数据文件', info.boardFile],
    ['会话 ID', view.sessionId],
  ].filter(([, val]) => val)

  return h(
    'div',
    { className: 'dnb-view' },
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 10, flexWrap: 'wrap' } },
      h(
        'div',
        { style: { display: 'flex', gap: 6 } },
        h('button', {
          className: 'dnb-pill',
          'data-active': subTab === 'rules' ? '1' : '0',
          onClick: () => patch({ boundSubTab: 'rules' }),
        }, '红线边界'),
        h('button', {
          className: 'dnb-pill',
          'data-active': subTab === 'handoff' ? '1' : '0',
          onClick: () => patch({ boundSubTab: 'handoff' }),
        }, '守护偏好'),
      ),
      subTab === 'rules'
        ? h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' } },
            hasConsolidatableCol
              ? h('button', {
                  className: 'dnb-pill',
                  style: {
                    height: 25,
                    padding: '0 9px',
                    fontSize: 11,
                    color: '#fbbf24',
                    background: 'rgba(245, 158, 11, 0.12)',
                    borderColor: 'rgba(245, 158, 11, 0.34)',
                  },
                  disabled: view.secBusy,
                  title: '请 DSH 参谋长把当前零散、重复的多条重要边界浓缩合并成一条高密度总则',
                  onClick: () => void requestConsolidateBounds('', []),
                }, h(Icon, { name: 'sparkles', size: 11 }), view.boundConsolidating === 'all' ? '浓缩中…' : '零散总结成一条')
              : null,
            h('button', {
              className: 'dnb-pill dnb-pill-accent',
              style: { height: 25, padding: '0 9px', fontSize: 11 },
              disabled: view.secBusy,
              title: '让 DSH 参谋长结合当前撞墙记录与会话纪律提炼新边界，并发起请示供你拍板',
              onClick: () => {
                void submitChiefBar('请结合当前会话的踩坑撞墙记录、工具权限约束与工作约定，简明分点总结工作边界，并向我发起边界注入请示（boundProposals）。')
              },
            }, h(Icon, { name: 'sparkles', size: 11.5 }), view.secBusy && !view.boundConsolidating ? '提炼中…' : '提炼新边界'),
          )
        : null,
    ),
    subTab === 'handoff'
      ? h(HandoffTab, { view })
      : h(
          React.Fragment,
          null,
          h(
            'div',
            {
              style: {
                padding: '7px 10px',
                marginBottom: 10,
                borderRadius: 10,
                background: 'rgba(10, 132, 255, 0.07)',
                border: '1px solid rgba(10, 132, 255, 0.18)',
                fontSize: 11,
                color: 'var(--dnb-text-2)',
                lineHeight: 1.48,
              },
            },
            `🏛 点击规则前的「小图钉戳」即可定住为跨任务全局共享（当前已定住 ${totalPinnedCount} 条）；未定住规则仅在本任务跑。多条零散规则可勾选或直点「总结成一条」请参谋长浓缩合并。`,
          ),
          BOUND_LISTS.map(b =>
            h(BoundCard, {
              key: b.field,
              field: b.field,
              label: b.label,
              dot: b.dot,
              items: bounds[b.field] || [],
              pinnedItems: pinnedBounds[b.field] || [],
            }),
          ),
          h(
            'div',
            { className: 'dnb-group', style: { marginTop: 6 } },
            h(
              'div',
              {
                className: 'dnb-cell dnb-cell-hover',
                style: { cursor: 'pointer', justifyContent: 'space-between' },
                onClick: () => setShowEnv(v => !v),
              },
              h('span', { style: { fontSize: 12.5, color: 'var(--dnb-text-2)', fontWeight: 500 } }, '运行环境信息'),
              h(Icon, {
                name: 'chevron',
                size: 13,
                style: {
                  color: 'var(--dnb-text-3)',
                  transform: showEnv ? 'rotate(90deg)' : 'none',
                  transition: 'transform 0.18s ease',
                },
              }),
            ),
            showEnv
              ? rows.map(([k, v]) =>
                  h(
                    'div',
                    {
                      key: k,
                      className: 'dnb-cell dnb-cell-hover',
                      style: { justifyContent: 'space-between', cursor: 'pointer' },
                      title: '点击复制',
                      onClick: () => copyText(v, '已复制 ' + k),
                    },
                    h('span', { style: { fontSize: 11.5, color: 'var(--dnb-text-3)', flexShrink: 0 } }, k),
                    h('span', {
                      style: {
                        fontSize: 11,
                        color: 'var(--dnb-text-2)',
                        fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: '68%',
                      },
                    }, String(v)),
                  ),
                )
              : null,
          ),
        ),
  )
}

/* ------------------------------------------- DSH Chief Core Views */
