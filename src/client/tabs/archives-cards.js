/**
 * src/client/tabs/archives-cards.js — 档案页签卡片组件库（回形针、编辑卡、抽屉文件夹、卷宗卡与冷库卡）
 *
 * 【核心职责】
 *   承载工程档案 4 页 UI 共用的单条档案卡片渲染组件：`ArchiveEditorCard`、
 *   `renderArchiveFolderDrawer`、`ArchiveDossierCard`（“一沓纸”正面/展开态）与 `ArchiveColdCard`，
 *   以及辅助 `PaperclipPin` 与 `resolveDossierViewerMeta`。
 *
 * 【边界约定】
 *   - 仅负责单卡/文件夹级渲染与卡片局部交互；顶部四页切换、全局搜索与批量栏保留在 `tabs/archives.js`。
 */

import { React, h } from '../react-runtime.js'
import { PAPERCLIP_META } from '../constants.js'
import { store, patch } from '../store.js'
import { clampTitle, timeLabel } from '../utils.js'
import {
  loadArchiveDetail,
  mutateArchiveApi,
  requestOrganizeArchives,
  toggleSelectArchive,
  openArchiveRelayModal,
  deliverArchiveToChat,
  copyText,
} from '../api.js'
import { Icon } from '../components/common.js'

function PaperclipPin({ paperclip = 'silver', onClick }) {
  const meta = PAPERCLIP_META[paperclip] || PAPERCLIP_META.silver
  return h(
    'button',
    {
      type: 'button',
      className: 'dnb-paperclip-pin',
      title: meta.tip,
      onClick: e => {
        e.stopPropagation()
        if (onClick) onClick()
      },
    },
    h(
      'svg',
      {
        width: 14,
        height: 18,
        viewBox: '0 0 18 24',
        fill: 'none',
        stroke: meta.pinStroke || meta.color,
        strokeWidth: paperclip === 'gold' ? 2.25 : 1.9,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
      },
      h('path', {
        d: 'M6 7.5v8.8a3.2 3.2 0 0 0 6.4 0V5.6a4.6 4.6 0 0 0-9.2 0v11.2a6 6 0 0 0 12 0V8.5',
      }),
      paperclip === 'gold'
        ? h('circle', { cx: 14.8, cy: 3.6, r: 1.35, fill: '#fff7b2', stroke: 'none' })
        : null,
    ),
  )
}

function resolveDossierViewerMeta(item, scope) {
  const vs = item && item.viewerStatus && typeof item.viewerStatus === 'object' ? item.viewerStatus : null
  const fullLabel = (vs && vs.label) || (vs && vs.badgeText) || (
    item && item.takenOut
      ? '已放到桌面：主对话和参谋都能看'
      : scope === 'precipitated'
        ? '仅你可见：主对话和参谋都看不到'
        : scope === 'global'
          ? (item && item.chiefMounted ? '参谋正在看 · 主对话看不到' : (item && item.hasHook ? '参谋可按关键词查看 · 主对话看不到' : '仅你可见（还没打标签）'))
          : (item && item.leadPulled ? '主对话已查看 · 参谋也能看' : (item && item.hasHook ? '主对话可按关键词查看 · 参谋能看' : '仅参谋能看（还没打标签）'))
  )
  let shortText = '参谋'
  let dataViewer = 'chief'
  if ((vs && (vs.code === 'on_desktop' || vs.mode === 'desktop')) || (item && item.takenOut)) {
    dataViewer = 'desktop'
    shortText = '桌面'
  } else if ((vs && (vs.code === 'lead_pulled' || vs.mode === 'lead_pulled')) || (item && item.leadPulled)) {
    dataViewer = 'lead'
    shortText = '主已拉'
  } else if ((vs && (vs.code === 'chief_reading' || vs.mode === 'chief_mounted')) || (item && (item.chiefMounted || item.chiefPulled))) {
    dataViewer = 'chief-reading'
    shortText = '参阅中'
  } else if ((vs && (vs.code === 'global_hooked' || vs.code === 'session_hooked' || vs.mode === 'chief_hook')) || (item && item.hasHook)) {
    dataViewer = 'hook'
    shortText = '见钩'
  } else if (scope === 'precipitated' || (scope === 'global' && !(item && item.hasHook))) {
    dataViewer = 'human'
    shortText = '仅人类'
  }
  return { shortText, fullLabel, dataViewer }
}

export function ArchiveEditorCard({ folders, editor, defaultScope = '' }) {
  if (!editor) return null
  const isEdit = Boolean(editor.id)
  const editorScope = editor.vaultScope || defaultScope || (store.archiveTabScope === 'global' ? 'global' : 'session')
  const isGlobalEditor = editorScope === 'global'
  const folderList = Array.isArray(folders) && folders.length
    ? folders
    : [{ id: 'coords', label: '项目入口与配置' }, { id: 'incidents', label: '问题排查记录' }, { id: 'inbox', label: '待整理便签' }]

  const updateField = patchObj => {
    patch({ archiveEditor: { ...editor, ...patchObj } })
  }

  const saveDossier = async () => {
    const title = String(editor.title || '').trim()
    const body = String(editor.body || '').trim()
    if (!title && !body) return
    const out = await mutateArchiveApi({
      op: 'save',
      vaultScope: editorScope,
      archiveId: editor.id || '',
      title,
      summary: String(editor.summary || '').trim(),
      folder: editor.folder || 'coords',
      paperclip: editor.paperclip || 'silver',
      tags: String(editor.tags || '').split(/[,，]/).map(s => s.trim()).filter(Boolean),
      body,
      upsertByTitle: !isEdit ? false : undefined,
    }, isEdit
      ? (isGlobalEditor ? '已更新全局档案' : '已更新本局档案')
      : (isGlobalEditor ? '已存到全局档案' : '已存到本局档案'))
    if (out && out.ok) {
      const savedItem = out.item
      const nextOpenFolders = { ...(store.archiveOpenFolders || {}) }
      const nextOpenFiles = { ...(store.archiveOpenFiles || {}) }
      if (savedItem && savedItem.folder) {
        nextOpenFolders[isGlobalEditor ? ('global:' + savedItem.folder) : savedItem.folder] = true
      }
      if (savedItem && savedItem.id) nextOpenFiles[savedItem.id] = true
      patch({
        archiveEditor: null,
        archiveOpenFolders: nextOpenFolders,
        archiveOpenFiles: nextOpenFiles,
      })
    }
  }

  return h(
    'div',
    {
      className: 'dnb-group',
      style: { padding: 11, marginBottom: 10, borderColor: 'rgba(37, 99, 235, 0.36)' },
    },
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 } },
      h('span', { style: { fontSize: 12, fontWeight: 600, color: 'var(--dnb-accent)' } },
        isGlobalEditor
          ? (isEdit ? '编辑全局档案' : '新建全局档案')
          : (isEdit ? '编辑本局档案' : '新建本局档案')),
      h('button', {
        className: 'dnb-icon-btn',
        style: { width: 22, height: 22 },
        onClick: () => patch({ archiveEditor: null }),
      }, h(Icon, { name: 'x', size: 13 })),
    ),
    h(
      'div',
      { style: { display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' } },
      h('select', {
        className: 'dnb-input',
        style: { flex: 1, minWidth: 130, height: 28, fontSize: 11.5, padding: '0 8px' },
        value: editor.folder || 'coords',
        onChange: e => updateField({ folder: e.target.value }),
      }, folderList.map(f => h('option', { key: f.id, value: f.id }, '抽屉：' + f.label))),
      h('select', {
        className: 'dnb-input',
        style: { width: 110, height: 28, fontSize: 11.5, padding: '0 8px' },
        value: editor.paperclip || 'silver',
        onChange: e => updateField({ paperclip: e.target.value }),
      },
        h('option', { value: 'gold' }, '金别针 · 核心'),
        h('option', { value: 'silver' }, '银别针 · 常用'),
        h('option', { value: 'copper' }, '铜别针 · 备用'),
      ),
    ),
    h('input', {
      className: 'dnb-input',
      style: { marginBottom: 6, fontWeight: 600 },
      placeholder: '输入档案标题…',
      value: editor.title || '',
      onChange: e => updateField({ title: e.target.value }),
    }),
    h('input', {
      className: 'dnb-input',
      style: { marginBottom: 6, fontSize: 11.5 },
      placeholder: '一句话简介（可不填）…',
      value: editor.summary || '',
      onChange: e => updateField({ summary: e.target.value }),
    }),
    h('textarea', {
      className: 'dnb-textarea',
      rows: 5,
      style: { marginBottom: 6, fontSize: 12, lineHeight: 1.55 },
      placeholder: '输入正文内容（支持 ## 小标题分段）…',
      value: editor.body || '',
      onChange: e => updateField({ body: e.target.value }),
    }),
    h('input', {
      className: 'dnb-input',
      style: { marginBottom: 8, fontSize: 11.5 },
      placeholder: '关键词标签，用逗号隔开…',
      value: editor.tags || '',
      onChange: e => updateField({ tags: e.target.value }),
    }),
    h(
      'div',
      { style: { display: 'flex', justifyContent: 'flex-end', gap: 6 } },
      h('button', { className: 'dnb-pill', onClick: () => patch({ archiveEditor: null }) }, '取消'),
      h('button', {
        className: 'dnb-primary-btn',
        disabled: !(editor.title || '').trim() && !(editor.body || '').trim(),
        onClick: () => void saveDossier(),
      }, isEdit ? '保存' : '存到档案柜'),
    ),
  )
}

export function renderArchiveFolderDrawer({
  drawerKey,
  folder,
  items,
  drawerOpen,
  onToggle,
  renderChild,
  onOrganize,
  onPrecipitate,
  onCreateInFolder,
  openMenuKey,
  setOpenMenuKey,
}) {
  const accent = folder.accent || '#64748b'
  const menuId = 'drawer:' + drawerKey
  const menuOpen = openMenuKey === menuId
  const hasActions = Boolean((onOrganize && items.length > 0) || (onPrecipitate && items.length > 0) || onCreateInFolder)

  return h(
    'div',
    {
      key: 'drawer-' + drawerKey,
      className: 'dnb-cabinet-drawer',
      'data-open': drawerOpen ? '1' : '0',
    },
    h(
      'div',
      { className: 'dnb-drawer-box' },
      h(
        'div',
        {
          className: 'dnb-drawer-front',
          onClick: onToggle,
          title: folder.hint || (drawerOpen ? '收起' : '展开'),
        },
        h('span', { className: 'dnb-drawer-spine', style: { background: accent } }),
        h(Icon, {
          name: 'chevron',
          size: 12,
          style: {
            color: 'var(--dnb-text-3)',
            transform: drawerOpen ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 0.16s ease',
            flexShrink: 0,
          },
        }),
        h(Icon, { name: drawerOpen ? 'folderOpen' : 'folder', size: 15, style: { color: accent } }),
        h('span', {
          style: {
            fontWeight: 600,
            fontSize: 12.5,
            color: 'var(--dnb-text)',
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          },
        }, folder.label || folder.id),
        h('span', { className: 'dnb-acc-count', style: { flexShrink: 0 } }, `${items.length}`),
        drawerOpen && hasActions
          ? h(
              'div',
              {
                className: 'dnb-more-wrap',
                onClick: e => e.stopPropagation(),
              },
              h('button', {
                type: 'button',
                className: 'dnb-icon-btn',
                style: { width: 22, height: 22, color: 'var(--dnb-text-3)' },
                title: '更多操作',
                onClick: () => setOpenMenuKey(menuOpen ? '' : menuId),
              }, '⋯'),
              menuOpen
                ? h(
                    'div',
                    { className: 'dnb-more-menu' },
                    onOrganize && items.length > 0
                      ? h('button', {
                          type: 'button',
                          className: 'dnb-more-item',
                          onClick: () => { setOpenMenuKey(''); onOrganize() },
                        }, '✦ 整理这个抽屉')
                      : null,
                    onCreateInFolder
                      ? h('button', {
                          type: 'button',
                          className: 'dnb-more-item',
                          onClick: () => { setOpenMenuKey(''); onCreateInFolder() },
                        }, '+ 在这里新建档案')
                      : null,
                    onPrecipitate && items.length > 0
                      ? h('button', {
                          type: 'button',
                          className: 'dnb-more-item',
                          onClick: () => { setOpenMenuKey(''); onPrecipitate() },
                        }, '🧊 转入冷藏库')
                      : null,
                  )
                : null,
            )
          : null,
      ),
      drawerOpen
        ? h(
            'div',
            { className: 'dnb-drawer-well' },
            items.length > 0
              ? h('div', { className: 'dnb-paper-stack' }, items.map((it, idx) => renderChild(it, idx)))
              : h('div', { style: { padding: '6px 4px', fontSize: 11, color: 'var(--dnb-text-3)' } }, '里面还是空的'),
          )
        : null,
    ),
  )
}

export function ArchiveDossierCard({ item, idx, folders, view, scopeOverride = '', openMenuKey, setOpenMenuKey }) {
  const activeScope = scopeOverride || (view.archiveTabScope === 'global' ? 'global' : 'session')
  const isGlobalScope = activeScope === 'global'
  const isOpen = Boolean(view.archiveOpenFiles && view.archiveOpenFiles[item.id])
  const detail = view.archiveDetails && view.archiveDetails[item.id] ? view.archiveDetails[item.id] : null
  const loadingDetail = Boolean(view.archiveDetailLoading && view.archiveDetailLoading[item.id])
  const showRaw = Boolean(view.archiveRawView && view.archiveRawView[item.id])
  const movingThis = view.archiveMoveId === item.id
  const clip = PAPERCLIP_META[item.paperclip] || PAPERCLIP_META.silver
  const points = detail && Array.isArray(detail.points) ? detail.points : []

  const toggleOpenFile = () => {
    const nextOpen = !isOpen
    patch({
      archiveOpenFiles: { ...(view.archiveOpenFiles || {}), [item.id]: nextOpen },
    })
    if (nextOpen && !detail) {
      void loadArchiveDetail(item.id, false, { scope: activeScope })
    }
  }

  const allPointsExpanded = points.length > 0 && points.every((pt, pIdx) => {
    const pKey = item.id + ':' + (pt.id || ('pt-' + (pIdx + 1)))
    return Boolean(view.archiveOpenPoints && view.archiveOpenPoints[pKey])
  })

  const toggleAllPoints = () => {
    if (!points.length) return
    const nextMap = { ...(view.archiveOpenPoints || {}) }
    for (let i = 0; i < points.length; i += 1) {
      const pKey = item.id + ':' + (points[i].id || ('pt-' + (i + 1)))
      if (allPointsExpanded) delete nextMap[pKey]
      else nextMap[pKey] = true
    }
    patch({ archiveOpenPoints: nextMap })
  }

  const openEditorForThis = async () => {
    const full = detail || (await loadArchiveDetail(item.id, false, { scope: activeScope }))
    if (!full) return
    patch({
      archiveEditor: {
        id: full.id,
        vaultScope: activeScope,
        title: full.title || '',
        summary: full.summary || '',
        folder: full.folder || item.folder || 'coords',
        paperclip: full.paperclip || item.paperclip || 'silver',
        tags: (full.tags || []).join(', '),
        body: full.body || '',
      },
    })
  }

  const selKey = (isGlobalScope ? 'global' : 'session') + ':' + item.id
  const isSelected = Boolean(view.selectedArchiveMap && view.selectedArchiveMap[selKey])
  const showCheckbox = Boolean(view.archiveSelectMode || isSelected)
  const viewerMeta = resolveDossierViewerMeta(item, activeScope)
  const hookList = Array.isArray(item.hookKeywords) && item.hookKeywords.length
    ? item.hookKeywords.slice(0, 4)
    : ((Array.isArray(item.tags) && item.tags.length) ? item.tags.slice(0, 3) : (item.folder ? [item.folder] : []))

  const isBoundSession = Boolean(view.sessionId && !view.archiveUnboundSession)
  const menuId = 'card:' + activeScope + ':' + item.id
  const cardMenuOpen = openMenuKey === menuId

  return h(
    'div',
    {
      className: 'dnb-dossier-card dnb-paper-dossier',
      'data-open': isOpen ? '1' : '0',
      'data-expanded': isOpen ? '1' : '0',
      'data-out': (item.takenOut || (isGlobalScope && item.chiefMounted)) ? '1' : '0',
      'data-viewer': viewerMeta.dataViewer,
      style: { animationDelay: Math.min(idx * 20, 120) + 'ms' },
    },
    h(PaperclipPin, {
      paperclip: item.paperclip,
      onClick: () => void mutateArchiveApi({ op: 'cycleClip', archiveId: item.id, vaultScope: activeScope }, '已切换重要程度'),
    }),

    // Top-Down Paper Header + Hover Peek Drawer
    h(
      'div',
      {
        className: 'dnb-dossier-head',
        onClick: toggleOpenFile,
        title: viewerMeta.fullLabel,
      },
      h(
        'div',
        { className: 'dnb-paper-head' },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 } },
          showCheckbox
            ? h('input', {
                type: 'checkbox',
                className: 'dnb-archive-check',
                checked: isSelected,
                onClick: e => e.stopPropagation(),
                onChange: () => toggleSelectArchive(item.id, isGlobalScope ? 'global' : 'session', item.title),
              })
            : null,
          h('div', { className: 'dnb-paper-title' }, item.title || '未命名档案'),
        ),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 } },
          h('span', { className: 'dnb-viewer-badge', 'data-viewer': viewerMeta.dataViewer }, viewerMeta.shortText),
          h(Icon, {
            name: 'chevron',
            size: 11.5,
            style: {
              color: isOpen ? 'var(--dnb-accent)' : 'var(--dnb-text-3)',
              transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: 'transform 0.16s ease',
            },
          }),
        ),
      ),

      // Hover Slide-Out: reveals keyword hooks & cue cleanly when mouse glides across the stacked sheets
      h(
        'div',
        { className: 'dnb-paper-peek' },
        h(
          'div',
          null,
          h(
            'div',
            { className: 'dnb-hook-strip' },
            hookList.map(kw => h('span', { key: kw, className: 'dnb-hook-chip' }, '#', kw)),
            item.hookCue
              ? h('span', {
                  style: {
                    fontSize: 10.5,
                    color: 'var(--dnb-text-3)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: 1,
                    minWidth: 70,
                  },
                }, item.hookCue)
              : null,
          ),
        ),
      ),
    ),

    // Unfolded Body + Clean 2 Primary Buttons + More Menu (on click only)
    isOpen
      ? h(
          'div',
          { className: 'dnb-points-sheet', style: { paddingTop: 6 } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, fontSize: 10.5, color: 'var(--dnb-text-3)', flexWrap: 'wrap' } },
            h('span', null, viewerMeta.fullLabel),
            item.updatedAt ? h('span', null, timeLabel(item.updatedAt)) : null,
          ),
          item.summary
            ? h('div', { style: { fontSize: 11.5, color: 'var(--dnb-text-2)', lineHeight: 1.48 } }, item.summary)
            : null,

          // Folder switcher (revealed when Move clicked from More menu)
          !isGlobalScope && movingThis
            ? h(
                'div',
                {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    flexWrap: 'wrap',
                    padding: '6px 8px',
                    borderRadius: 8,
                    background: 'var(--dnb-card)',
                    border: '1px solid var(--dnb-border)',
                  },
                },
                h('span', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)' } }, '移到：'),
                (folders || []).map(f =>
                  h('button', {
                    key: f.id,
                    type: 'button',
                    className: 'dnb-mini-btn',
                    'data-tone': f.id === item.folder ? 'accent' : undefined,
                    onClick: () => {
                      patch({
                        archiveMoveId: '',
                        archiveOpenFolders: { ...(view.archiveOpenFolders || {}), [f.id]: true },
                      })
                      void mutateArchiveApi({ op: 'moveFolder', archiveId: item.id, folder: f.id, vaultScope: activeScope }, '已移到「' + f.label + '」')
                    },
                  }, f.label),
                ),
              )
            : null,

          // Memory Points
          loadingDetail && !detail
            ? h(
                'div',
                { style: { padding: '6px 2px', fontSize: 11, color: 'var(--dnb-text-3)', display: 'flex', alignItems: 'center', gap: 6 } },
                h(Icon, { name: 'refresh', size: 11.5, style: { animation: 'dnb-spin 0.9s linear infinite' } }),
                '加载中…',
              )
            : points.length > 0
              ? points.map((pt, pIdx) => {
                  const ptId = pt.id || ('pt-' + (pIdx + 1))
                  const pKey = item.id + ':' + ptId
                  const ptOpen = Boolean(view.archiveOpenPoints && view.archiveOpenPoints[pKey])
                  const numBadge = String(pIdx + 1).padStart(2, '0')
                  return h(
                    'div',
                    { key: ptId, className: 'dnb-mem-point', 'data-open': ptOpen ? '1' : '0' },
                    h(
                      'div',
                      {
                        className: 'dnb-mem-point-row',
                        onClick: () => patch({ archiveOpenPoints: { ...(view.archiveOpenPoints || {}), [pKey]: !ptOpen } }),
                      },
                      h('span', { className: 'dnb-mem-point-idx' }, numBadge),
                      h(
                        'div',
                        { style: { flex: 1, minWidth: 0 } },
                        h('div', { style: { fontSize: 11.5, fontWeight: 600, color: 'var(--dnb-text)', lineHeight: 1.4 } },
                          pt.title || ('要点 ' + (pIdx + 1))),
                        !ptOpen && pt.cue && pt.cue !== pt.title
                          ? h('div', {
                              style: { fontSize: 10.5, color: 'var(--dnb-text-3)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                            }, pt.cue)
                          : null,
                      ),
                      h(Icon, {
                        name: 'chevron',
                        size: 11.5,
                        style: {
                          color: ptOpen ? 'var(--dnb-accent)' : 'var(--dnb-text-3)',
                          marginTop: 3,
                          transform: ptOpen ? 'rotate(90deg)' : 'none',
                          transition: 'transform 0.15s ease',
                        },
                      }),
                    ),
                    ptOpen
                      ? h(
                          'div',
                          { className: 'dnb-subpoint-detail' },
                          h('div', null, pt.detail || pt.cue || pt.title),
                          h(
                            'div',
                            { style: { display: 'flex', justifyContent: 'flex-end', gap: 5, marginTop: 6 } },
                            h('button', {
                              type: 'button',
                              className: 'dnb-mini-btn',
                              onClick: () => copyText(`【${item.title} · ${pt.title}】\n${pt.detail || pt.cue || ''}`, '已复制这条内容'),
                            }, '复制'),
                            h('button', {
                              type: 'button',
                              className: 'dnb-mini-btn',
                              'data-tone': 'accent',
                              onClick: () => void deliverArchiveToChat(detail || item, pt),
                            }, '发给对话'),
                          ),
                        )
                      : null,
                  )
                })
              : h('div', { style: { fontSize: 11, color: 'var(--dnb-text-3)', padding: '2px 0' } }, '还没拆出要点，点右下角 ⋯ 让参谋长整理一下。'),

          // Lossless Raw Body
          showRaw && detail
            ? h(
                'div',
                { style: { borderRadius: 8, border: '1px solid var(--dnb-border)', background: 'var(--dnb-card)', overflow: 'hidden' } },
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 9px', borderBottom: '1px solid var(--dnb-border)', fontSize: 10.5, color: 'var(--dnb-text-3)' } },
                  h('span', null, `原文 (${(detail.body || '').length} 字)`),
                  h('button', {
                    type: 'button',
                    className: 'dnb-mini-btn',
                    style: { height: 20, fontSize: 10.5 },
                    onClick: () => copyText(detail.body || '', '已复制全文'),
                  }, '复制'),
                ),
                h('pre', { className: 'dnb-pre', style: { maxHeight: 220 } }, detail.body || '（空）'),
              )
            : null,

          // Restrained Bottom Bar: Max 2 Primary Actions + 1 `⋯` Overflow Menu
          h(
            'div',
            { className: 'dnb-dossier-actions' },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' } },
              h('button', {
                type: 'button',
                className: 'dnb-mini-btn',
                'data-tone': item.takenOut ? 'amber' : undefined,
                disabled: !item.takenOut && !isBoundSession,
                onClick: e => {
                  e.stopPropagation()
                  if (!item.takenOut && !isBoundSession) return
                  void mutateArchiveApi(
                    { op: item.takenOut ? 'putBack' : 'takeOut', archiveId: item.id, vaultScope: activeScope },
                    item.takenOut ? '已从桌面撤回' : '📌 已放到认知桌面',
                  )
                },
              }, item.takenOut ? '撤出桌面' : '📌 放上桌面'),
              isGlobalScope
                ? h('button', {
                    type: 'button',
                    className: 'dnb-mini-btn',
                    'data-tone': item.chiefMounted ? 'accent' : undefined,
                    disabled: !item.chiefMounted && !isBoundSession,
                    onClick: e => {
                      e.stopPropagation()
                      if (!item.chiefMounted && !isBoundSession) return
                      void mutateArchiveApi(
                        { op: item.chiefMounted ? 'unmountChief' : 'mountChief', archiveId: item.id, vaultScope: 'global' },
                        item.chiefMounted ? '已取消参谋参阅' : '👁️ 已开放参谋参阅',
                      )
                    },
                  }, item.chiefMounted ? '参谋参阅中' : '参谋参阅')
                : h('button', {
                    type: 'button',
                    className: 'dnb-mini-btn',
                    'data-tone': 'accent',
                    onClick: e => {
                      e.stopPropagation()
                      openArchiveRelayModal([{ id: item.id, vaultScope: 'session', title: item.title }])
                    },
                  }, '📨 递话'),
            ),
            h(
              'div',
              { className: 'dnb-more-wrap', onClick: e => e.stopPropagation() },
              h('button', {
                type: 'button',
                className: 'dnb-mini-btn',
                title: '更多操作',
                onClick: () => setOpenMenuKey(cardMenuOpen ? '' : menuId),
              }, '⋯'),
              cardMenuOpen
                ? h(
                    'div',
                    { className: 'dnb-more-menu', 'data-pos': 'up' },
                    isGlobalScope
                      ? h('button', {
                          type: 'button',
                          className: 'dnb-more-item',
                          onClick: () => {
                            setOpenMenuKey('')
                            openArchiveRelayModal([{ id: item.id, vaultScope: 'global', title: item.title }])
                          },
                        }, '📨 发给主对话')
                      : null,
                    isGlobalScope
                      ? h('button', {
                          type: 'button',
                          className: 'dnb-more-item',
                          disabled: !isBoundSession,
                          onClick: () => {
                            setOpenMenuKey('')
                            void mutateArchiveApi({ op: 'copyToSession', archiveId: item.id, vaultScope: 'global' }, '已复制到本局档案')
                          },
                        }, '⤵️ 复制到本局')
                      : h('button', {
                          type: 'button',
                          className: 'dnb-more-item',
                          onClick: () => {
                            setOpenMenuKey('')
                            void mutateArchiveApi({ op: 'copyToGlobal', archiveId: item.id, vaultScope: 'session' }, '已存到全局档案')
                          },
                        }, item.diffStatus === 'synced' ? '✓ 同步到全局' : '🌐 存到全局'),
                    isGlobalScope
                      ? h('button', {
                          type: 'button',
                          className: 'dnb-more-item',
                          onClick: () => {
                            setOpenMenuKey('')
                            patch({
                              precipitateModal: {
                                op: 'single',
                                vaultScope: 'global',
                                cabinetId: '',
                                ids: [item.id],
                                label: `全局档案《${clampTitle(item.title, 24)}》`,
                                clearSource: false,
                              },
                            })
                          },
                        }, '🧊 转入冷藏库')
                      : null,
                    !isGlobalScope
                      ? h('button', {
                          type: 'button',
                          className: 'dnb-more-item',
                          onClick: () => {
                            setOpenMenuKey('')
                            patch({ archiveMoveId: movingThis ? '' : item.id })
                          },
                        }, '📁 换个抽屉')
                      : null,
                    h('div', { className: 'dnb-more-sep' }),
                    h('button', {
                      type: 'button',
                      className: 'dnb-more-item',
                      onClick: () => {
                        setOpenMenuKey('')
                        void requestOrganizeArchives({ ids: [item.id], scope: 'selected', vaultScope: activeScope })
                      },
                    }, '✦ 让参谋重整这份'),
                    points.length > 1
                      ? h('button', {
                          type: 'button',
                          className: 'dnb-more-item',
                          onClick: () => { setOpenMenuKey(''); toggleAllPoints() },
                        }, allPointsExpanded ? '全部收起' : '全部展开')
                      : null,
                    h('button', {
                      type: 'button',
                      className: 'dnb-more-item',
                      onClick: () => {
                        setOpenMenuKey('')
                        patch({ archiveRawView: { ...(view.archiveRawView || {}), [item.id]: !showRaw } })
                      },
                    }, showRaw ? '隐藏原文' : '📄 看原文'),
                    h('button', {
                      type: 'button',
                      className: 'dnb-more-item',
                      onClick: () => {
                        setOpenMenuKey('')
                        void mutateArchiveApi({ op: 'cycleClip', archiveId: item.id, vaultScope: activeScope }, '已切换重要程度')
                      },
                    }, `📎 换曲别针 (${clip.short})`),
                    h('button', {
                      type: 'button',
                      className: 'dnb-more-item',
                      'data-active': isSelected ? '1' : '0',
                      onClick: () => {
                        setOpenMenuKey('')
                        patch({ archiveSelectMode: true })
                        toggleSelectArchive(item.id, isGlobalScope ? 'global' : 'session', item.title)
                      },
                    }, isSelected ? '✓ 已勾选' : '☑️ 勾选批量递话'),
                    h('div', { className: 'dnb-more-sep' }),
                    h('button', {
                      type: 'button',
                      className: 'dnb-more-item',
                      onClick: () => { setOpenMenuKey(''); void openEditorForThis() },
                    }, '✎ 编辑'),
                    h('button', {
                      type: 'button',
                      className: 'dnb-more-item',
                      'data-danger': '1',
                      onClick: () => {
                        setOpenMenuKey('')
                        if (!confirm('确定要删除《' + clampTitle(item.title, 20) + '》吗？')) return
                        void mutateArchiveApi({ op: 'delete', archiveId: item.id, vaultScope: activeScope }, '已删除')
                      },
                    }, '🗑️ 删除'),
                  )
                : null,
            ),
          ),
        )
      : null,
  )
}

export function ArchiveColdCard({ p, idx, view, flippedSet, isBoundSession, openMenuKey, setOpenMenuKey }) {
  const isFlipped = flippedSet.has(p.id)
  const key = 'prec_' + p.id
  const isOpen = Boolean(view.archiveOpenFiles && view.archiveOpenFiles[key])
  const detail = (view.archiveDetails && view.archiveDetails[p.id]) || null
  const isSelected = Boolean(view.selectedArchiveMap && view.selectedArchiveMap['precipitated:' + p.id])
  const showCheckbox = Boolean(view.archiveSelectMode || isSelected)
  const hooks = Array.isArray(p.hookKeywords) && p.hookKeywords.length
    ? p.hookKeywords.slice(0, 4)
    : (Array.isArray(p.tags) && p.tags.length ? p.tags.slice(0, 3) : [p.category || 'ops'])
  const vMeta = resolveDossierViewerMeta({ ...p, takenOut: isFlipped }, 'precipitated')
  const menuId = 'cold:' + p.id
  const menuOpen = openMenuKey === menuId

  const toggleOpen = () => {
    const nextOpen = !isOpen
    patch({ archiveOpenFiles: { ...(view.archiveOpenFiles || {}), [key]: nextOpen } })
    if (nextOpen && !detail) void loadArchiveDetail(p.id, false, { precipitated: true })
  }

  return h(
    'div',
    {
      key: p.id,
      className: 'dnb-paper-dossier',
      'data-expanded': isOpen ? '1' : '0',
      'data-viewer': vMeta.dataViewer,
      style: { animationDelay: Math.min(idx * 20, 120) + 'ms' },
    },
    h(PaperclipPin, { paperclip: p.paperclip || 'gold' }),
    h(
      'div',
      { className: 'dnb-dossier-head', onClick: toggleOpen, title: vMeta.fullLabel },
      h(
        'div',
        { className: 'dnb-paper-head' },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 } },
          showCheckbox
            ? h('input', {
                type: 'checkbox',
                className: 'dnb-archive-check',
                checked: isSelected,
                onClick: e => e.stopPropagation(),
                onChange: () => toggleSelectArchive(p.id, 'precipitated', p.title),
              })
            : null,
          h('div', { className: 'dnb-paper-title' }, p.title),
        ),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 } },
          h('span', { className: 'dnb-viewer-badge', 'data-viewer': vMeta.dataViewer }, vMeta.shortText),
          h(Icon, {
            name: 'chevron',
            size: 11.5,
            style: { color: isOpen ? 'var(--dnb-accent)' : 'var(--dnb-text-3)', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.16s ease' },
          }),
        ),
      ),
      h(
        'div',
        { className: 'dnb-paper-peek' },
        h(
          'div',
          null,
          h(
            'div',
            { className: 'dnb-hook-strip' },
            hooks.map(kw => h('span', { key: kw, className: 'dnb-hook-chip' }, '#', kw)),
            p.hookCue
              ? h('span', {
                  style: { fontSize: 10.5, color: 'var(--dnb-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 70 },
                }, p.hookCue)
              : null,
          ),
        ),
      ),
    ),
    isOpen
      ? h(
          'div',
          { className: 'dnb-points-sheet', style: { paddingTop: 6 } },
          h('div', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)' } }, vMeta.fullLabel),
          p.summary ? h('div', { style: { fontSize: 11.5, color: 'var(--dnb-text-2)', lineHeight: 1.48 } }, p.summary) : null,
          detail
            ? h(
                'div',
                { style: { padding: '6px 8px', borderRadius: 7, background: 'var(--dnb-card)', fontSize: 11.5, color: 'var(--dnb-text-2)', lineHeight: 1.5, display: 'flex', flexDirection: 'column', gap: 4 } },
                Array.isArray(detail.points) && detail.points.length
                  ? detail.points.map((pt, pidx) => h('div', { key: pidx }, h('strong', { style: { color: 'var(--dnb-text)' } }, `• ${pt.title}：`), pt.detail || pt.cue || ''))
                  : h('div', { style: { whiteSpace: 'pre-wrap' } }, detail.body || detail.summary || ''),
              )
            : null,
          h(
            'div',
            { className: 'dnb-dossier-actions' },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 5 } },
              h('button', {
                type: 'button',
                className: 'dnb-mini-btn',
                'data-tone': isFlipped ? 'amber' : undefined,
                disabled: !isFlipped && !isBoundSession,
                onClick: e => {
                  e.stopPropagation()
                  void mutateArchiveApi(
                    { op: isFlipped ? 'sealBack' : 'flipOut', id: p.id, vaultScope: 'precipitated' },
                    isFlipped ? '已放回冷藏库' : '📌 已放到认知桌面',
                  )
                },
              }, isFlipped ? '放回冷库' : '📌 放上桌面'),
              h('button', {
                type: 'button',
                className: 'dnb-mini-btn',
                'data-tone': 'accent',
                onClick: e => {
                  e.stopPropagation()
                  openArchiveRelayModal([{ id: p.id, vaultScope: 'precipitated', title: p.title }])
                },
              }, '📨 递话'),
            ),
            h(
              'div',
              { className: 'dnb-more-wrap', onClick: e => e.stopPropagation() },
              h('button', {
                type: 'button',
                className: 'dnb-mini-btn',
                onClick: () => setOpenMenuKey(menuOpen ? '' : menuId),
              }, '⋯'),
              menuOpen
                ? h(
                    'div',
                    { className: 'dnb-more-menu', 'data-pos': 'up' },
                    h('button', {
                      type: 'button',
                      className: 'dnb-more-item',
                      disabled: !isBoundSession,
                      onClick: () => {
                        setOpenMenuKey('')
                        void mutateArchiveApi({ op: 'pullPrecipitated', id: p.id, targetScope: 'session', vaultScope: 'precipitated' }, '已复制到本局')
                      },
                    }, '⤵️ 复制到本局'),
                    h('button', {
                      type: 'button',
                      className: 'dnb-more-item',
                      onClick: () => {
                        setOpenMenuKey('')
                        void mutateArchiveApi({ op: 'pullPrecipitated', id: p.id, targetScope: 'global', vaultScope: 'precipitated' }, '已复制到全局')
                      },
                    }, '🌐 复制到全局'),
                    h('button', {
                      type: 'button',
                      className: 'dnb-more-item',
                      'data-active': isSelected ? '1' : '0',
                      onClick: () => {
                        setOpenMenuKey('')
                        patch({ archiveSelectMode: true })
                        toggleSelectArchive(p.id, 'precipitated', p.title)
                      },
                    }, isSelected ? '✓ 已勾选' : '☑️ 勾选批量递话'),
                    h('div', { className: 'dnb-more-sep' }),
                    h('button', {
                      type: 'button',
                      className: 'dnb-more-item',
                      'data-danger': '1',
                      onClick: () => {
                        setOpenMenuKey('')
                        if (!confirm('确定永久删除《' + clampTitle(p.title, 20) + '》吗？')) return
                        void mutateArchiveApi({ op: 'deletePrecipitated', id: p.id, vaultScope: 'precipitated' }, '已删除')
                      },
                    }, '🗑️ 删除'),
                  )
                : null,
            ),
          ),
        )
      : null,
  )
}
