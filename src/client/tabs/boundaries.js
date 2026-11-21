/**
 * tabs/boundaries.js
 *
 * Global & session boundaries editor cards and BoundariesTab.
 */

import { React, h } from '../react-runtime.js'
import { BOUND_LISTS, BOUND_CAP } from '../constants.js'
import { bi } from '../i18n.js'
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
  saveGuardWallApi,
  setGuardWallScopeApi,
  removeGuardWallApi,
  toggleGuardWallSelect,
  mergeGuardWallsApi,
} from '../api.js'
import { Icon, AccCard } from '../components/common.js'

const WALL_TYPE_META = {
  forbid_cmd: { label: '🚫 禁跑命令', placeholder: '输入命令关键字或正则（如 npm publish、git push --force）…' },
  forbid_path: { label: '🚧 禁碰路径', placeholder: '输入禁止读写目录或文件（如 .github/workflows、DSHGuard）…' },
  restrict_write: { label: '🔐 仅限某目录可写', placeholder: '输入唯一允许写入的白名单目录绝对/相对路径…' },
  require_approval_cmd: { label: '🛡️ 高危命令先请示', placeholder: '输入需强制拦停审批的命令特征（如 prisma migrate）…' },
  deny_tool: { label: '⛔ 禁用工具', placeholder: '输入禁用的工具名（如 run_command、write_file）…' },
}

function GuardWallsCard({ view }) {
  const [wallMenuOpen, setWallMenuOpen] = React.useState(false)
  React.useEffect(() => {
    if (!wallMenuOpen) return
    const close = () => setWallMenuOpen(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [wallMenuOpen])

  const walls = Array.isArray(view.guardWalls) ? view.guardWalls : []
  const activeCount = walls.filter(w => w && w.activeNow).length
  const collapsed = Boolean(view.wallCollapsed)
  const formOpen = Boolean(view.wallFormOpen)
  const draftField = WALL_TYPE_META[view.wallDraftField] ? view.wallDraftField : 'forbid_cmd'
  const draftScope = view.wallDraftScope === 'workspace' ? 'workspace' : 'global'
  const draftTitle = view.wallDraftTitle || ''
  const draftPattern = view.wallDraftPattern || ''
  const selectedIds = (Array.isArray(view.wallSelectedIds) ? view.wallSelectedIds : [])
    .filter(id => walls.some(w => w && w.id === id))
  const selectedSet = new Set(selectedIds)

  const bucketCounts = {}
  for (const w of walls) {
    if (!w || !w.ruleType) continue
    const k = (w.scope === 'paused' ? 'paused|' : 'active|') + w.ruleType
    bucketCounts[k] = (bucketCounts[k] || 0) + 1
  }
  const hasMergeableWallGroup = Object.values(bucketCounts).some(c => c >= 2)

  const submitNewWall = () => {
    void saveGuardWallApi({
      title: draftTitle,
      ruleType: draftField,
      pattern: draftPattern,
      scope: draftScope,
    })
  }

  return h(
    AccCard,
    {
      open: !collapsed,
      onToggle: () => patch({ wallCollapsed: !collapsed }),
      className: 'dnb-wall-box',
      icon: h(Icon, { name: 'shieldSentinel', size: 13.5, style: { color: activeCount > 0 ? '#ef4444' : '#f87171', flexShrink: 0 } }),
      title: bi('物理驻墙 · 事前硬拦截', 'Guard Wall · Pre-Tool Hard Block'),
      preview: walls.length
        ? `${activeCount} ${bi('生效', 'active')} · ${walls.slice(0, 2).map(w => w.title).join(bi('、', ', '))}`
        : bi('全会话工具前拦截物理哨兵就绪', 'Session-wide pre-tool physical sentinel ready'),
      bodyStyle: { padding: 0 },
      badges: h(
        'span',
        {
          className: 'dnb-seg-dot',
          style: activeCount > 0 ? { background: 'rgba(239,68,68,0.18)', color: '#f87171' } : undefined,
        },
        bi(`${activeCount}/${walls.length} 生效`, `${activeCount}/${walls.length} active`),
      ),
      actions: h(
        React.Fragment,
        null,
        h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: { height: 22, padding: '0 8px', fontSize: 10.5 },
          onClick: () => {
            const nextOpen = !formOpen
            patch({ wallFormOpen: nextOpen, ...(nextOpen ? { wallCollapsed: false } : {}) })
          },
        }, formOpen ? '收起表单' : '+ 驻墙'),
        h(
          'div',
          { className: 'dnb-more-wrap' },
          h('button', {
            type: 'button',
            className: 'dnb-pill',
            style: { height: 22, padding: '0 7px', fontSize: 10.5 },
            'data-active': wallMenuOpen ? '1' : '0',
            title: '更多筑墙与合并操作',
            onClick: e => {
              e.stopPropagation()
              setWallMenuOpen(v => !v)
            },
          }, selectedIds.length >= 2 ? `⋯ (${selectedIds.length})` : '⋯'),
          wallMenuOpen
            ? h(
                'div',
                { className: 'dnb-more-menu', style: { minWidth: 184 } },
                h('button', {
                  type: 'button',
                  className: 'dnb-more-item',
                  disabled: view.secBusy,
                  title: '让参谋长按你的大白话帮你手搓物理驻墙规则并发起一键落锁确认',
                  onClick: () => {
                    setWallMenuOpen(false)
                    void submitChiefBar(
                      '请帮我根据当前工程重点保护目录与高危操作，手搓可复用的事前防御物理驻墙提案（wallProposals），默认 global 随身生效；若同时识别到需要补充的工作边界红线/必做项，也请一并填入 boundProposals，全部写入 JSON 数组供我一键确认落锁。',
                      'craft_wall',
                    )
                  },
                }, h('span', null, view.secBusy && view.chiefQuickAction === 'craft_wall' ? '⏳ 正在手搓筑墙…' : '✨ 参谋手搓筑墙')),
                selectedIds.length >= 2
                  ? h('button', {
                      type: 'button',
                      className: 'dnb-more-item',
                      'data-danger': '1',
                      title: '合并已勾选的同类型物理驻墙（若误选了不同拦截类型会弹出错误提醒阻止合并）',
                      onClick: () => {
                        setWallMenuOpen(false)
                        void mergeGuardWallsApi({ wallIds: selectedIds })
                      },
                    }, h('span', null, `⇄ 合并所选 (${selectedIds.length})`))
                  : (hasMergeableWallGroup
                      ? h('button', {
                          type: 'button',
                          className: 'dnb-more-item',
                          title: '仅按相同拦截类型自动合并多堵同类物理驻墙（禁碰路径只和禁碰路径合并，绝不跨类混并）',
                          onClick: () => {
                            setWallMenuOpen(false)
                            void mergeGuardWallsApi({ autoGroup: true })
                          },
                        }, h('span', null, '✦ 同类一键合并'))
                      : null),
              )
            : null,
        ),
      ),
    },
    view.wallMergeError
      ? h(
          'div',
          {
            style: {
              padding: '7px 11px',
              borderBottom: '1px solid rgba(248, 113, 113, 0.35)',
              background: 'rgba(239, 68, 68, 0.16)',
              color: '#fca5a5',
              fontSize: 11.5,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            },
          },
          h('span', null, view.wallMergeError),
          h('span', { style: { cursor: 'pointer', paddingLeft: 6, flexShrink: 0 }, onClick: () => patch({ wallMergeError: '', error: '' }) }, '×'),
        )
      : null,
    formOpen
      ? h(
          'div',
          { style: { padding: '8px 12px 10px', borderBottom: '1px solid var(--dnb-border)', display: 'flex', flexDirection: 'column', gap: 7 } },
          h(
            'div',
            { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
            h('input', {
              className: 'dnb-input',
              style: { flex: '1 1 140px', height: 28, fontSize: 11.5 },
              placeholder: '物理墙名称（如：锁死生产发布 / 保护核心配置）',
              value: draftTitle,
              onChange: e => patch({ wallDraftTitle: e.target.value }),
            }),
            h(
              'select',
              {
                className: 'dnb-input',
                style: { width: 'auto', height: 28, fontSize: 11, padding: '0 8px' },
                value: draftField,
                onChange: e => patch({ wallDraftField: e.target.value }),
              },
              Object.entries(WALL_TYPE_META).map(([k, meta]) =>
                h('option', { key: k, value: k }, meta.label)),
            ),
          ),
          h('input', {
            className: 'dnb-input',
            style: { height: 28, fontSize: 11.5 },
            placeholder: (WALL_TYPE_META[draftField] && WALL_TYPE_META[draftField].placeholder) || '输入匹配规则（多项可用逗号分隔）',
            value: draftPattern,
            onChange: e => patch({ wallDraftPattern: e.target.value }),
            onKeyDown: e => { if (e.key === 'Enter') submitNewWall() },
          }),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' } },
            h(
              'div',
              { style: { display: 'flex', gap: 5 } },
              h('button', {
                type: 'button',
                className: 'dnb-wall-scope-btn',
                'data-active': draftScope === 'global' ? '1' : '0',
                onClick: () => patch({ wallDraftScope: 'global' }),
              }, '🌐 全局随身'),
              h('button', {
                type: 'button',
                className: 'dnb-wall-scope-btn',
                'data-active': draftScope === 'workspace' ? '1' : '0',
                onClick: () => patch({ wallDraftScope: 'workspace' }),
              }, '📁 仅本工程'),
            ),
            h('button', {
              type: 'button',
              className: 'dnb-primary-btn',
              style: { height: 26, padding: '0 10px', fontSize: 11 },
              disabled: !draftTitle.trim() || !draftPattern.trim() || view.busy,
              onClick: submitNewWall,
            }, '🧱 立即驻防落锁'),
          ),
        )
      : null,
    walls.length > 0
      ? walls.map(w => {
          const typeMeta = WALL_TYPE_META[w.ruleType] || { label: w.ruleType }
          const patText = Array.isArray(w.patterns) ? w.patterns.join(' , ') : ''
          const isChecked = selectedSet.has(w.id)
          return h(
            'div',
            { key: w.id, className: 'dnb-wall-item', style: w.scope === 'paused' ? { opacity: 0.62 } : undefined },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 } },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 } },
                h('span', { style: { fontSize: 12, fontWeight: 600, color: w.activeNow ? 'var(--dnb-text)' : 'var(--dnb-text-2)' } }, w.title),
                h('span', { className: 'dnb-tag', style: { fontSize: 10 } }, typeMeta.label),
                w.source === 'chief_crafted'
                  ? h('span', { className: 'dnb-tag', style: { fontSize: 10, color: 'var(--dnb-accent)' } }, '参谋手搓')
                  : null,
              ),
              h(
                'div',
                { style: { display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0 } },
                walls.length >= 2
                  ? h('button', {
                      type: 'button',
                      className: 'dnb-bound-check',
                      'data-checked': isChecked ? '1' : '0',
                      title: isChecked ? '已勾选，可点击「合并所选」与同类型物理墙合并' : '勾选以合并多条同类型物理驻墙（禁跨类型合并）',
                      onClick: () => toggleGuardWallSelect(w.id),
                    }, h(Icon, { name: 'check', size: 10.5 }))
                  : null,
                h('button', {
                  type: 'button',
                  className: 'dnb-icon-btn',
                  style: { width: 20, height: 20, flexShrink: 0, color: 'var(--dnb-text-3)' },
                  title: '人工拆除该物理墙（AI 模型无权调用拆除）',
                  onClick: () => void removeGuardWallApi(w.id),
                }, h(Icon, { name: 'x', size: 11 })),
              ),
            ),
            h('code', {
              style: {
                display: 'block',
                width: '100%',
                fontSize: 11,
                lineHeight: 1.45,
                color: w.activeNow ? '#f87171' : 'var(--dnb-text-3)',
                fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
                wordBreak: 'break-all',
              },
            }, patText),
            h(
              'div',
              { className: 'dnb-wall-actions-row' },
              [
                { key: 'global', label: '🌐 全局' },
                { key: 'workspace', label: '📁 本工程' },
                { key: 'paused', label: '⏸ 暂挂' },
              ].map(opt =>
                h('button', {
                  key: opt.key,
                  type: 'button',
                  className: 'dnb-wall-scope-btn',
                  'data-active': w.scope === opt.key ? '1' : '0',
                  onClick: () => { if (w.scope !== opt.key) void setGuardWallScopeApi(w.id, opt.key) },
                }, opt.label)),
            ),
          )
        })
      : h(
          'div',
          { style: { padding: '10px 12px', fontSize: 11, color: 'var(--dnb-text-3)' } },
          '尚未手动筑墙。全会话工具前拦截物理哨兵已就绪，点击右上角「+ 驻墙」或让参谋长手搓一条即可全对话随身生效。',
        ),
  )
}

function BoundCard({ field, label, dot, items, pinnedItems, view }) {
  const [editingItem, setEditingItem] = React.useState('')
  const [editingVal, setEditingVal] = React.useState('')

  const collapsedCols = (view && view.boundCollapsedCols) || store.boundCollapsedCols || {}
  const isColCollapsed = Boolean(collapsedCols[field])
  const toggleColCollapsed = () => patch({
    boundCollapsedCols: { ...collapsedCols, [field]: !isColCollapsed },
  })

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

  const uiLabel = label === '必做事项'
    ? bi('必做事项', 'Must Do')
    : label === '禁止红线'
      ? bi('禁止红线', 'Forbidden')
      : label === '注意事项'
        ? bi('注意事项', 'Watchouts')
        : label
  return h(
    AccCard,
    {
      open: !isColCollapsed,
      onToggle: toggleColCollapsed,
      accentColor: dot,
      title: uiLabel,
      headTitle: isColCollapsed ? bi(`点击拉开【${uiLabel}】`, `Expand ${uiLabel}`) : bi(`点击收起【${uiLabel}】`, `Collapse ${uiLabel}`),
      icon: h('span', { style: { width: 7, height: 7, borderRadius: '50%', background: dot, flexShrink: 0 } }),
      count: list.length ? String(list.length) : '',
      badges: pinnedCountInCol > 0
        ? h('span', { className: 'dnb-acc-badge', 'data-tone': 'amber' }, `📌${pinnedCountInCol}`)
        : null,
      preview: list.length ? list.slice(0, 2).join('；') : '尚未添加规则',
      bodyStyle: { padding: 0 },
      actions: list.length >= 2
        ? h('button', {
            type: 'button',
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
    },
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
  )
}

export function BoundariesTab({ store: view }) {
  const [showEnv, setShowEnv] = React.useState(false)
  React.useEffect(() => {
    if (!view.boundMoreMenuOpen) return
    const close = () => patch({ boundMoreMenuOpen: false })
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [view.boundMoreMenuOpen])

  const bounds = (view.board && view.board.bounds) || {}
  const pinnedBounds = (view.board && view.board.pinnedBounds) || {}
  const hasConsolidatableCol = BOUND_LISTS.some(b => ((bounds[b.field] || []).length >= 2))
  const totalPinnedCount = BOUND_LISTS.reduce((acc, b) => acc + ((pinnedBounds[b.field] || []).length), 0)
  const collapsedCols = view.boundCollapsedCols || {}
  const allSectionsCollapsed = Boolean(view.wallCollapsed)
    && BOUND_LISTS.every(b => Boolean(collapsedCols[b.field]))
  const toggleAllBoundSections = () => {
    if (allSectionsCollapsed) {
      patch({ wallCollapsed: false, boundCollapsedCols: {} })
    } else {
      setShowEnv(false)
      patch({
        wallCollapsed: true,
        boundCollapsedCols: { allowed: true, forbidden: true, notes: true },
      })
    }
  }
  const info = view.boundaries || {}
  const rows = [
    [bi('工作目录', 'Working Dir'), info.sessionWorkingDirectory || info.workingDirectory],
    [bi('沙箱模式', 'Sandbox'), info.sessionSandboxMode || info.sandboxMode],
    [bi('可写路径', 'Writable Root'), info.workspaceRoot],
    [bi('数据文件', 'Board File'), info.boardFile],
    [bi('会话 ID', 'Session ID'), view.sessionId],
  ].filter(([, val]) => val)

  return h(
    'div',
    { className: 'dnb-view' },
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 10, flexWrap: 'wrap' } },
      h(
        'div',
        {
          style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 },
          title: bi(
            `当前已定住 ${totalPinnedCount} 条全局共享边界（点击每条规则前的小图钉即可跨任务固定）`,
            `${totalPinnedCount} pinned global boundaries (click the pin icon on any rule to persist across tasks)`,
          ),
        },
        h('span', { style: { fontSize: 12.5, fontWeight: 600, color: 'var(--dnb-text)' } }, bi('红线边界', 'Redlines & Bounds')),
        totalPinnedCount > 0
          ? h('span', { className: 'dnb-acc-count', style: { fontSize: 10.5 } }, `📌 ${totalPinnedCount}`)
          : null,
      ),
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 5 } },
        h('button', {
          className: 'dnb-pill',
          style: { height: 25, padding: '0 9px', fontSize: 11 },
          disabled: view.secBusy,
          title: '让 DSH 参谋长结合当前撞墙记录与会话纪律提炼新边界，并发起请示供你拍板',
          onClick: () => {
            void submitChiefBar(
              '请结合当前会话的踩坑撞墙记录、工具权限约束与工作约定，简明分点总结工作边界，并务必完整填入 JSON 的 boundProposals 数组向我发起边界注入请示（若提到具体条文请每条都放进 boundProposals）。',
              'extract_bounds',
            )
          },
        }, h(Icon, { name: 'sparkles', size: 11 }), view.secBusy && view.chiefQuickAction === 'extract_bounds' ? '提炼中…' : (view.secBusy && !view.boundConsolidating ? '提炼中…' : '提炼新边界')),
        h(
          'div',
          { className: 'dnb-more-wrap', onClick: e => e.stopPropagation() },
          h('button', {
            type: 'button',
            className: 'dnb-pill',
            style: { height: 25, padding: '0 7px', fontSize: 11 },
            'data-active': view.boundMoreMenuOpen ? '1' : '0',
            title: '更多边界维护选项',
            onClick: () => patch({ boundMoreMenuOpen: !view.boundMoreMenuOpen }),
          }, '⋯'),
          view.boundMoreMenuOpen
            ? h(
                'div',
                { className: 'dnb-more-menu', style: { minWidth: 184 } },
                h('button', {
                  type: 'button',
                  className: 'dnb-more-item',
                  onClick: () => {
                    patch({ boundMoreMenuOpen: false })
                    toggleAllBoundSections()
                  },
                }, h('span', null, allSectionsCollapsed ? '↕ 展开全部分组' : '↕ 收起全部分组')),
                hasConsolidatableCol
                  ? h('button', {
                      type: 'button',
                      className: 'dnb-more-item',
                      disabled: view.secBusy,
                      title: '请 DSH 参谋长把当前零散、重复的多条重要边界浓缩合并成一条高密度总则',
                      onClick: () => {
                        patch({ boundMoreMenuOpen: false })
                        void requestConsolidateBounds('', [])
                      },
                    }, h('span', null, view.boundConsolidating === 'all' ? '浓缩中…' : '✦ 零散总结成一条'))
                  : null,
              )
            : null,
        ),
      ),
    ),
    h(GuardWallsCard, { view }),
    BOUND_LISTS.map(b =>
      h(BoundCard, {
        key: b.field,
        field: b.field,
        label: b.label,
        dot: b.dot,
        items: bounds[b.field] || [],
        pinnedItems: pinnedBounds[b.field] || [],
        view,
      }),
    ),
    h(
      AccCard,
      {
        open: showEnv,
        onToggle: () => setShowEnv(v => !v),
        title: bi('运行环境信息', 'Runtime Environment'),
        count: rows.length ? String(rows.length) : '',
        preview: info.workspaceRoot || info.sessionWorkingDirectory || info.workingDirectory || '',
        bodyStyle: { padding: 0 },
      },
      rows.map(([k, v]) =>
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
      ),
    ),
  )
}

/* ------------------------------------------- DSH Chief Core Views */
