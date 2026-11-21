/**
 * tabs/archives.js
 *
 * Four-page Engineering Archives UI:
 *   📌 桌面 (Cognitive Desktop) | 🗂️ 本局 | 🌐 全局 | 🧊 冷藏
 * Ultra-clean top strip + color rails + top-down stacked paper dossiers ("一沓纸").
 */

import { React, h } from '../react-runtime.js'
import { PAPERCLIP_META } from '../constants.js'
import { store, patch } from '../store.js'
import { clampTitle, timeLabel } from '../utils.js'
import { bi } from '../i18n.js'
import {
  loadArchives,
  loadArchiveDetail,
  mutateArchiveApi,
  requestOrganizeArchives,
  harvestArchivesApi,
  toggleSelectArchive,
  clearSelectedArchives,
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

function ArchiveEditorCard({ folders, editor, defaultScope = '' }) {
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

function renderArchiveFolderDrawer({
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
        h('span', { className: 'dnb-acc-pull-hint' }, drawerOpen ? '收起 ▴' : '拉起 ▾'),
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

function ArchiveDossierCard({ item, idx, folders, view, scopeOverride = '', openMenuKey, setOpenMenuKey }) {
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

function ArchiveColdCard({ p, idx, view, flippedSet, isBoundSession, openMenuKey, setOpenMenuKey }) {
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

export function ArchiveTab({ board, view }) {
  const [openMenuKey, setOpenMenuKey] = React.useState('')
  const activeScope = ['desktop', 'session', 'global', 'precipitated'].includes(view.archiveTabScope)
    ? view.archiveTabScope
    : 'desktop'
  const fetchScope = activeScope === 'desktop' ? 'session' : activeScope
  const counts = view.archiveCounts || {}
  const isBoundSession = Boolean(view.sessionId && !view.archiveUnboundSession)

  React.useEffect(() => {
    void loadArchives(false, '', fetchScope)
  }, [view.sessionId, activeScope])

  React.useEffect(() => {
    if (!openMenuKey) return undefined
    const close = () => setOpenMenuKey('')
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [openMenuKey])

  const meta = view.archiveMeta || {}
  const sessionFolders = Array.isArray(view.archiveFolders) ? view.archiveFolders : []
  const globalFolders = Array.isArray(view.globalVaultFolders) && view.globalVaultFolders.length
    ? view.globalVaultFolders
    : sessionFolders
  const sessionItems = isBoundSession && Array.isArray(view.archiveItems) ? view.archiveItems : []
  const globalItems = Array.isArray(view.globalVaultItems) ? view.globalVaultItems : []
  const diff = (view.archiveDiffSummary && typeof view.archiveDiffSummary === 'object') ? view.archiveDiffSummary : {}
  const precipList = Array.isArray(view.archivePrecipitated) ? view.archivePrecipitated : []
  const flippedSet = new Set(Array.isArray(view.flippedPrecipitatedIds) ? view.flippedPrecipitatedIds : [])
  const tempNotes = (board && Array.isArray(board.notes)) ? board.notes : []
  const query = String(view.archiveQuery || '').trim().toLowerCase()
  const clipFilter = view.archiveFilterClip || 'all'
  const globalDiffFilter = view.globalVaultDiffFilter || 'all'

  const sessionBadgeCount = isBoundSession
    ? (view.archiveSessionLoaded ? sessionItems.length : Number(counts.sessionCount || 0))
    : 0
  const globalBadgeCount = view.globalVaultLoaded ? globalItems.length : Number(counts.globalCount || 0)
  const precipBadgeCount = precipList.length || Number(counts.precipitatedCount || 0)

  const rawDesk = Array.isArray(view.archiveDeskItems) ? view.archiveDeskItems : []
  const fallbackDesk = [
    ...sessionItems.filter(it => it && it.takenOut).map(it => ({ ...it, vaultScope: 'session' })),
    ...globalItems.filter(it => it && it.takenOut).map(it => ({ ...it, vaultScope: 'global' })),
    ...precipList.filter(p => p && flippedSet.has(p.id)).map(p => ({ ...p, vaultScope: 'precipitated' })),
  ]
  const deskList = view.archiveDeskLoaded ? rawDesk : fallbackDesk
  const desktopData = (view.archiveDesktop && typeof view.archiveDesktop === 'object') ? view.archiveDesktop : null
  const deskPinned = (desktopData && Array.isArray(desktopData.pinnedDocuments) && desktopData.pinnedDocuments.length)
    ? desktopData.pinnedDocuments
    : deskList

  const switchScope = nextScope => {
    if (!nextScope || nextScope === activeScope) return
    setOpenMenuKey('')
    patch({
      archiveTabScope: nextScope,
      archiveDetails: {},
      archiveMoveId: '',
      archiveOrganizeOpen: false,
      archiveEditor: null,
      archiveNewCabinetOpen: false,
      archiveNewFolderOpen: false,
      archiveSearchOpen: false,
      ...(nextScope === 'session' && view.archiveCabinetId === 'cab-global' ? { archiveCabinetId: '' } : {}),
    })
    void loadArchives(true, '', nextScope === 'desktop' ? 'session' : nextScope)
  }

  const matchesArchiveFilter = it => {
    if (!it) return false
    if (clipFilter !== 'all' && it.paperclip !== clipFilter) return false
    if (!query) return true
    const hay = [
      it.title,
      it.summary,
      it.hookCue,
      (it.hookKeywords || []).join(' '),
      (it.tags || []).join(' '),
      (it.pointPreviews || []).join(' '),
    ].join(' ').toLowerCase()
    return hay.includes(query)
  }

  const filteredItems = sessionItems.filter(matchesArchiveFilter)
  const filteredGlobalItems = globalItems.filter(it => {
    if (!matchesArchiveFilter(it)) return false
    if (!isBoundSession || globalDiffFilter === 'all') return true
    if (globalDiffFilter === 'mounted') return Boolean(it.chiefMounted)
    if (globalDiffFilter === 'global_only') return it.diffStatus === 'global_only'
    if (globalDiffFilter === 'synced') return it.diffStatus === 'synced'
    if (globalDiffFilter === 'differs') return it.diffStatus === 'differs'
    return true
  })
  const filteredPrecip = precipList.filter(p => {
    if (!p) return false
    if (!query) return true
    const hay = [p.title, p.summary, p.category, p.hookCue, (p.hookKeywords || []).join(' '), (p.tags || []).join(' ')].join(' ').toLowerCase()
    return hay.includes(query)
  })

  const selectedArchivesList = Object.values(view.selectedArchiveMap || {}).filter(x => x && x.id)

  // Group session drawers
  const byFolder = new Map()
  for (const f of sessionFolders) byFolder.set(f.id, [])
  for (const it of filteredItems) {
    const fId = it.folder || 'inbox'
    if (!byFolder.has(fId)) byFolder.set(fId, [])
    byFolder.get(fId).push(it)
  }
  const drawerList = [...sessionFolders]
  for (const fId of byFolder.keys()) {
    if (!drawerList.some(f => f.id === fId)) {
      drawerList.push({ id: fId, label: fId, hint: '工作抽屉', accent: '#64748b', count: byFolder.get(fId).length })
    }
  }
  const nonEmptySessionDrawers = drawerList.filter(f => (byFolder.get(f.id) || []).length > 0)
  const emptySessionDrawers = drawerList.filter(f => (byFolder.get(f.id) || []).length === 0)
  const visibleSessionDrawers = (query || clipFilter !== 'all' || view.archiveShowEmptyDrawers)
    ? (query || clipFilter !== 'all' ? nonEmptySessionDrawers : drawerList)
    : nonEmptySessionDrawers

  const anySessionDrawerOpen = visibleSessionDrawers.some(f => Boolean(view.archiveOpenFolders && view.archiveOpenFolders[f.id]))
  const toggleAllSessionDrawers = () => {
    const next = {}
    if (!anySessionDrawerOpen) {
      for (const f of nonEmptySessionDrawers) next[f.id] = true
    }
    patch({ archiveOpenFolders: next })
  }

  const submitNewFolder = async () => {
    const name = String(view.archiveNewFolderName || '').trim()
    if (!name) return
    const out = await mutateArchiveApi({ op: 'createFolder', label: name, vaultScope: 'session' }, '已新建抽屉「' + name + '」')
    if (out && out.ok && out.folder) {
      patch({
        archiveNewFolderOpen: false,
        archiveNewFolderName: '',
        archiveOpenFolders: { ...(view.archiveOpenFolders || {}), [out.folder.id]: true },
      })
    }
  }

  const renderOrganizeDeck = targetScope => {
    if (!view.archiveOrganizeOpen) return null
    return h(
      'div',
      { className: 'dnb-group', style: { padding: '8px 10px', marginBottom: 8 } },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 6 } },
        h(
          'div',
          { style: { display: 'flex', gap: 4 } },
          [
            { key: 'unorganized', label: '只整理未梳理的' + (meta.unorganizedCount ? ` (${meta.unorganizedCount})` : '') },
            { key: 'all', label: '全部重新整理' },
          ].map(opt =>
            h('button', {
              key: opt.key,
              type: 'button',
              className: 'dnb-text-filter-btn',
              'data-active': (view.archiveOrganizeScope || 'unorganized') === opt.key ? '1' : '0',
              onClick: () => patch({ archiveOrganizeScope: opt.key }),
            }, opt.label),
          ),
        ),
        h('button', {
          className: 'dnb-icon-btn',
          style: { width: 20, height: 20 },
          onClick: () => patch({ archiveOrganizeOpen: false }),
        }, h(Icon, { name: 'x', size: 12 })),
      ),
      h(
        'div',
        { style: { display: 'flex', gap: 6, alignItems: 'center' } },
        h('input', {
          className: 'dnb-input',
          style: { height: 27, fontSize: 11.5, borderRadius: 99, padding: '0 10px' },
          placeholder: '补充整理要求（可不填）…',
          value: view.archiveOrganizePrompt || '',
          onChange: e => patch({ archiveOrganizePrompt: e.target.value }),
          onKeyDown: e => { if (e.key === 'Enter') void requestOrganizeArchives({ vaultScope: targetScope }) },
        }),
        h('button', {
          type: 'button',
          className: 'dnb-primary-btn',
          style: { height: 27, padding: '0 11px', fontSize: 11, flexShrink: 0 },
          disabled: view.archiveOrganizing,
          onClick: () => void requestOrganizeArchives({ vaultScope: targetScope }),
        }, view.archiveOrganizing ? '整理中…' : '开始'),
      ),
    )
  }

  // ── Page 1: Independent Cognitive Desktop (`activeScope === 'desktop'`) ──
  const renderDesktopPage = () => {
    const usedTokens = desktopData ? Number(desktopData.usedTokens || 0) : deskPinned.reduce((a, x) => a + (Number(x.estimatedTokens) || 120), 0)
    const tokenBudget = desktopData ? Number(desktopData.tokenBudget || 2400) : 2400
    const maxItems = desktopData ? Number(desktopData.maxItems || 6) : 6
    const usagePct = Math.min(100, Math.round((usedTokens / tokenBudget) * 100))
    const warnLevel = usagePct >= 95 ? 'crit' : (usagePct >= 75 ? 'high' : 'ok')
    const watchList = (desktopData && Array.isArray(desktopData.recentlyUnpinnedWatch)) ? desktopData.recentlyUnpinnedWatch : []
    const deskMenuOpen = openMenuKey === 'desk-more'

    return h(
      'div',
      { className: 'dnb-desktop-zone' },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h('span', { style: { fontSize: 12.5, fontWeight: 600, color: 'var(--dnb-text)' } },
          bi(`📌 认知桌面 · ${deskPinned.length}/${maxItems}`, `📌 Cognitive Desktop · ${deskPinned.length}/${maxItems}`)),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 6 } },
          h('span', {
            style: {
              fontSize: 11,
              fontWeight: 600,
              color: warnLevel === 'crit' ? '#ef4444' : (warnLevel === 'high' ? '#f59e0b' : 'var(--dnb-text-3)'),
            },
          }, `${usedTokens} / ${tokenBudget}t`),
          deskPinned.length > 0
            ? h(
                'div',
                { className: 'dnb-more-wrap', onClick: e => e.stopPropagation() },
                h('button', {
                  type: 'button',
                  className: 'dnb-mini-btn',
                  title: bi('桌面操作', 'Desktop actions'),
                  onClick: () => setOpenMenuKey(deskMenuOpen ? '' : 'desk-more'),
                }, '⋯'),
                deskMenuOpen
                  ? h(
                      'div',
                      { className: 'dnb-more-menu' },
                      h('button', {
                        type: 'button',
                        className: 'dnb-more-item',
                        onClick: () => {
                          setOpenMenuKey('')
                          openArchiveRelayModal(deskPinned.map(it => ({
                            id: it.id,
                            vaultScope: it.vaultScope || 'session',
                            title: it.title,
                          })))
                        },
                      }, bi('📨 把桌面资料一起发给对话', '📨 Send Desktop Items to Chat')),
                      deskPinned.length > 1
                        ? h('button', {
                            type: 'button',
                            className: 'dnb-more-item',
                            onClick: async () => {
                              setOpenMenuKey('')
                              for (const it of deskPinned) {
                                const vs = it.vaultScope || 'session'
                                if (vs === 'precipitated') {
                                  await mutateArchiveApi({ op: 'sealBack', id: it.id, vaultScope: 'precipitated' })
                                } else {
                                  await mutateArchiveApi({ op: 'unpinFromDesktop', archiveId: it.id, vaultScope: vs })
                                }
                              }
                              patch({ notice: bi('已全部撤回档案柜', 'Moved all items back') })
                            },
                          }, bi('📥 全部撤下桌面', '📥 Remove All from Desktop'))
                        : null,
                    )
                  : null,
              )
            : null,
        ),
      ),
      h('div', { className: 'dnb-token-track', title: bi(`认知桌面：每轮发给主对话的资料（${usedTokens}/${tokenBudget} Tokens）`, `Cognitive Desktop: sent each turn (${usedTokens}/${tokenBudget} tokens)`) },
        h('div', { className: 'dnb-token-fill', 'data-warn': warnLevel, style: { width: Math.max(deskPinned.length ? 4 : 0, usagePct) + '%' } }),
      ),
      deskPinned.length === 0
        ? h(
            'div',
            { style: { padding: '22px 10px 16px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' } },
            h('div', { style: { fontSize: 12, color: 'var(--dnb-text-2)' } }, bi('认知桌面是空的：这里放的资料每轮都会发给主对话（最多 6 份 / 2,400 Tokens）', 'Desktop is empty. Pinned items are sent each turn (up to 6 / 2,400 tokens).')),
            h('div', { style: { fontSize: 11, color: 'var(--dnb-text-3)' } }, bi('想让主对话一直记住的资料，可以从本局档案放过来。', 'Pin key notes from Session Vault so the main chat keeps seeing them.')),
            h('button', {
              type: 'button',
              className: 'dnb-pill',
              onClick: () => switchScope('session'),
            }, bi('去本局档案选资料 →', 'Pick from Session Vault →')),
          )
        : h(
            'div',
            { className: 'dnb-paper-stack' },
            deskPinned.map((it, dIdx) => {
              const vs = it.vaultScope || 'session'
              const railViewer = vs === 'global' ? 'chief-reading' : (vs === 'precipitated' ? 'human' : 'desktop')
              const vsTag = vs === 'global' ? '全局' : (vs === 'precipitated' ? '冷藏' : '本局')
              const hooks = Array.isArray(it.hookKeywords) && it.hookKeywords.length ? it.hookKeywords.slice(0, 3) : []
              return h(
                'div',
                {
                  key: 'desk-' + vs + '-' + it.id,
                  className: 'dnb-paper-dossier',
                  'data-expanded': '1',
                  'data-viewer': railViewer,
                  style: { margin: dIdx === 0 ? '2px 0 6px' : '0 0 6px', padding: '8px 11px 8px 14px', cursor: 'pointer' },
                  onClick: () => {
                    switchScope(vs)
                    if (vs === 'precipitated') {
                      patch({ archiveOpenFiles: { ...(view.archiveOpenFiles || {}), ['prec_' + it.id]: true } })
                      void loadArchiveDetail(it.id, false, { precipitated: true })
                    } else {
                      patch({
                        archiveOpenFolders: {
                          ...(view.archiveOpenFolders || {}),
                          [vs === 'global' ? ('global:' + (it.folder || 'inbox')) : (it.folder || 'inbox')]: true,
                        },
                        archiveOpenFiles: { ...(view.archiveOpenFiles || {}), [it.id]: true },
                      })
                      void loadArchiveDetail(it.id, false, { scope: vs })
                    }
                  },
                },
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
                  h(
                    'div',
                    { style: { flex: 1, minWidth: 0 } },
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } },
                      h('span', { className: 'dnb-paper-title' }, it.title || it.id),
                      h('span', { style: { fontSize: 10, color: 'var(--dnb-text-3)', flexShrink: 0 } },
                        `${vsTag}${it.estimatedTokens ? ` · ~${it.estimatedTokens}t` : ''}`),
                    ),
                    hooks.length > 0
                      ? h('div', { className: 'dnb-hook-strip' }, hooks.map(kw => h('span', { key: kw, className: 'dnb-hook-chip' }, '#', kw)))
                      : null,
                  ),
                  h(
                    'div',
                    { style: { display: 'flex', gap: 4, flexShrink: 0 }, onClick: e => e.stopPropagation() },
                    h('button', {
                      type: 'button',
                      className: 'dnb-mini-btn',
                      onClick: () => openArchiveRelayModal([{ id: it.id, vaultScope: vs, title: it.title }]),
                    }, '递话'),
                    h('button', {
                      type: 'button',
                      className: 'dnb-mini-btn',
                      onClick: () => {
                        if (vs === 'precipitated') {
                          void mutateArchiveApi({ op: 'sealBack', id: it.id, vaultScope: 'precipitated' }, '已放回冷藏库')
                        } else {
                          void mutateArchiveApi({ op: 'unpinFromDesktop', archiveId: it.id, vaultScope: vs }, '已撤下桌面')
                        }
                      },
                    }, '撤出'),
                  ),
                ),
              )
            }),
          ),
      watchList.length > 0
        ? h(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 6,
                padding: '6px 9px',
                borderRadius: 8,
                background: 'rgba(139, 92, 246, 0.08)',
                border: '1px solid rgba(139, 92, 246, 0.24)',
                fontSize: 11,
              },
            },
            h('span', { style: { color: '#c4b5fd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
              bi(`🫧 刚撤下 ${watchList.length} 份，建议整理一下（${watchList.slice(0, 2).map(w => w.title).join('、')}）`, `🫧 ${watchList.length} unpinned, ready to organize (${watchList.slice(0, 2).map(w => w.title).join(', ')})`)),
            h('button', {
              type: 'button',
              className: 'dnb-mini-btn',
              disabled: view.archiveOrganizing,
              style: { color: '#c4b5fd', borderColor: 'rgba(167, 139, 250, 0.36)' },
              onClick: () => void requestOrganizeArchives({
                vaultScope: 'session',
                ids: watchList.map(w => w.id),
                dream: true,
                instruction: '请整理撤下桌面的卷宗归入抽屉并织就线索钩子',
              }),
            }, bi('🌙 梦境漫游归位', '🌙 Dream Organize')),
          )
        : null,
    )
  }

  // ── Shared Minimal Single-Line Vault Strip Bar (Session / Global / Cold) ──
  const renderVaultStripBar = () => {
    const stripMeta = activeScope === 'global'
      ? {
          color: '#a855f7',
          title: bi(`全局档案 · ${globalItems.length} 份`, `Global Vault · ${globalItems.length}`),
          sub: isBoundSession ? bi(`参谋参阅 ${globalItems.filter(it => it && it.chiefMounted).length}`, `Chief Ref ${globalItems.filter(it => it && it.chiefMounted).length}`) : '',
          hint: bi('跨对话共用的资料。打标签后参谋长可按需查看，不发给主对话。', 'Shared across chats. Chief reads tagged notes on demand; never sent to main chat.'),
        }
      : activeScope === 'precipitated'
        ? {
            color: '#94a3b8',
            title: bi(`冷藏档案 · ${precipBadgeCount} 份`, `Cold Vault · ${precipBadgeCount}`),
            sub: flippedSet.size > 0 ? bi(`已置顶 ${flippedSet.size}`, `Pinned ${flippedSet.size}`) : '',
            hint: bi('只给你自己看的私密资料，主对话和参谋长都看不到。', 'Private vault for you only. Main chat and Chief never see it.'),
          }
        : {
            color: '#38bdf8',
            title: bi(`本局档案 · ${sessionItems.length} 份`, `Session Vault · ${sessionItems.length}`),
            sub: isBoundSession && sessionItems.some(it => it && it.leadPulled)
              ? bi(`主拉 ${sessionItems.filter(it => it && it.leadPulled).length}`, `Pulled ${sessionItems.filter(it => it && it.leadPulled).length}`)
              : '',
            hint: bi('仅限当前对话的资料。打标签后主对话可按需查看。', 'For this chat only. Main chat can pull tagged notes on demand.'),
          }

    const topMenuOpen = openMenuKey === 'vault-top'

    return h(
      'div',
      {
        className: 'dnb-strip-bar',
        style: { '--dnb-strip-color': stripMeta.color },
      },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }, title: stripMeta.hint },
        h('span', { style: { fontSize: 12.5, fontWeight: 600, color: 'var(--dnb-text)', whiteSpace: 'nowrap' } }, stripMeta.title),
        stripMeta.sub
          ? h('span', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', whiteSpace: 'nowrap' } }, '· ' + stripMeta.sub)
          : null,
      ),
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 } },
        h('button', {
          type: 'button',
          className: 'dnb-icon-btn',
          'data-active': view.archiveSearchOpen ? '1' : '0',
          style: { width: 24, height: 24 },
          title: bi('搜索或筛选档案', 'Search or filter archives'),
          onClick: () => patch({ archiveSearchOpen: !view.archiveSearchOpen }),
        }, h(Icon, { name: 'search', size: 13 })),
        activeScope !== 'precipitated'
          ? h('button', {
              type: 'button',
              className: 'dnb-pill',
              style: { height: 24, padding: '0 9px', fontSize: 11 },
              disabled: view.archiveOrganizing || (activeScope === 'session' ? (!isBoundSession || sessionItems.length === 0) : globalItems.length === 0),
              onClick: () => patch({ archiveOrganizeOpen: !view.archiveOrganizeOpen }),
            }, view.archiveOrganizing ? bi('整理中…', 'Organizing…') : bi('✦ 整理', '✦ Organize'))
          : null,
        h(
          'div',
          { className: 'dnb-more-wrap', onClick: e => e.stopPropagation() },
          h('button', {
            type: 'button',
            className: 'dnb-icon-btn',
            style: { width: 24, height: 24 },
            title: bi('更多操作', 'More actions'),
            onClick: () => setOpenMenuKey(topMenuOpen ? '' : 'vault-top'),
          }, '⋯'),
          topMenuOpen
            ? h(
                'div',
                { className: 'dnb-more-menu' },
                activeScope === 'session'
                  ? h(
                      React.Fragment,
                      null,
                      h('button', {
                        type: 'button',
                        className: 'dnb-more-item',
                        disabled: !isBoundSession,
                        onClick: () => {
                          setOpenMenuKey('')
                          patch({
                            archiveEditor: {
                              id: '', vaultScope: 'session', title: '', summary: '', folder: 'coords', paperclip: 'silver', tags: '', body: '',
                            },
                          })
                        },
                      }, bi('+ 新建本局档案', '+ New Session Note')),
                      h('button', {
                        type: 'button',
                        className: 'dnb-more-item',
                        disabled: Boolean(view.archiveHarvesting || !isBoundSession),
                        onClick: () => { setOpenMenuKey(''); void harvestArchivesApi('', { vaultScope: 'session' }) },
                      }, view.archiveHarvesting ? bi('提取中…', 'Extracting…') : bi('📥 从对话里提取档案', '📥 Extract Notes from Chat')),
                      h('button', {
                        type: 'button',
                        className: 'dnb-more-item',
                        disabled: Boolean(view.distillBusy || !isBoundSession || sessionItems.length === 0),
                        onClick: () => {
                          setOpenMenuKey('')
                          const selSessionIds = selectedArchivesList.filter(s => s && s.vaultScope === 'session').map(s => s.id)
                          patch({ distillGlobalModal: { ids: selSessionIds.length > 0 ? selSessionIds : null, instruction: '', clearSource: false } })
                        },
                      }, bi('✦ 整理进全局档案', '✦ Save to Global Vault')),
                      h('div', { className: 'dnb-more-sep' }),
                      h('button', {
                        type: 'button',
                        className: 'dnb-more-item',
                        disabled: !isBoundSession,
                        onClick: () => { setOpenMenuKey(''); patch({ archiveSearchOpen: true, archiveNewCabinetOpen: true }) },
                      }, bi('🗂️ 切换 / 新建分柜', '🗂️ Switch / New Cabinet')),
                      h('button', {
                        type: 'button',
                        className: 'dnb-more-item',
                        disabled: !isBoundSession,
                        onClick: () => { setOpenMenuKey(''); patch({ archiveSearchOpen: true, archiveNewFolderOpen: true }) },
                      }, bi('+ 新建抽屉', '+ New Drawer')),
                      h('button', {
                        type: 'button',
                        className: 'dnb-more-item',
                        disabled: nonEmptySessionDrawers.length === 0,
                        onClick: () => { setOpenMenuKey(''); toggleAllSessionDrawers() },
                      }, anySessionDrawerOpen ? bi('↕ 全部收起', '↕ Collapse All') : bi('↕ 全部展开', '↕ Expand All')),
                    )
                  : activeScope === 'global'
                    ? h(
                        React.Fragment,
                        null,
                        h('button', {
                          type: 'button',
                          className: 'dnb-more-item',
                          onClick: () => {
                            setOpenMenuKey('')
                            patch({
                              archiveEditor: {
                                id: '', vaultScope: 'global', title: '', summary: '', folder: 'coords', paperclip: 'silver', tags: '', body: '',
                              },
                            })
                          },
                        }, bi('+ 新建全局档案', '+ New Global Note')),
                        h('button', {
                          type: 'button',
                          className: 'dnb-more-item',
                          disabled: Boolean(view.archivePrecipitating) || globalItems.length === 0,
                          onClick: () => {
                            setOpenMenuKey('')
                            patch({
                              precipitateModal: { op: 'cabinet', vaultScope: 'global', cabinetId: '', label: bi('全局档案柜', 'Global Vault'), clearSource: false },
                            })
                          },
                        }, bi('🧊 转入冷藏库', '🧊 Move to Cold Vault')),
                        isBoundSession
                          ? h('button', {
                              type: 'button',
                              className: 'dnb-more-item',
                              'data-active': view.globalShowLocalOnlyDrawer ? '1' : '0',
                              onClick: () => {
                                setOpenMenuKey('')
                                patch({ globalShowLocalOnlyDrawer: !view.globalShowLocalOnlyDrawer })
                              },
                            }, `⇄ 本局独有 (${diff.localOnlyCount || 0})`)
                          : null,
                        h('div', { className: 'dnb-more-sep' }),
                      )
                    : null,
                h('button', {
                  type: 'button',
                  className: 'dnb-more-item',
                  'data-active': view.archiveSelectMode ? '1' : '0',
                  onClick: () => {
                    setOpenMenuKey('')
                    patch({ archiveSelectMode: !view.archiveSelectMode })
                  },
                }, view.archiveSelectMode ? '✓ 退出多选' : '☑️ 批量选中递话'),
              )
            : null,
        ),
      ),
    )
  }

  // ── Collapsible Filter / Search / Cabinet Strip (hidden by default!) ──
  const renderSearchAndFilterStrip = () => {
    if (!view.archiveSearchOpen) return null
    const cabinets = Array.isArray(view.archiveCabinets) && view.archiveCabinets.length
      ? view.archiveCabinets
      : [{ id: view.archiveCabinetId || '', name: '默认分柜', count: sessionItems.length }]
    const activeCabId = view.archiveCabinetId || (cabinets[0] && cabinets[0].id) || ''

    return h(
      'div',
      { className: 'dnb-group', style: { padding: '8px 10px', marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 6 } },
      h(
        'div',
        { style: { display: 'flex', gap: 6, alignItems: 'center' } },
        h('input', {
          className: 'dnb-input',
          style: { height: 27, borderRadius: 99, padding: '0 10px', fontSize: 11.5 },
          placeholder: '搜标题或关键词…',
          value: view.archiveQuery || '',
          onChange: e => patch({ archiveQuery: e.target.value }),
        }),
        view.archiveQuery
          ? h('button', {
              type: 'button',
              className: 'dnb-mini-btn',
              onClick: () => patch({ archiveQuery: '' }),
            }, '清空')
          : null,
      ),
      activeScope !== 'precipitated'
        ? h(
            'div',
            { className: 'dnb-text-filter-bar', style: { paddingBottom: 0 } },
            [
              { key: 'all', label: '全部' },
              { key: 'gold', label: '金针' },
              { key: 'silver', label: '银针' },
              { key: 'copper', label: '铜针' },
            ].map(c =>
              h('button', {
                key: c.key,
                type: 'button',
                className: 'dnb-text-filter-btn',
                'data-active': clipFilter === c.key ? '1' : '0',
                onClick: () => patch({ archiveFilterClip: c.key }),
              }, c.label),
            ),
          )
        : null,
      activeScope === 'global' && isBoundSession
        ? h(
            'div',
            { className: 'dnb-text-filter-bar', style: { paddingBottom: 0 } },
            [
              { key: 'all', label: '全部' },
              { key: 'global_only', label: '全局独有' },
              { key: 'synced', label: '已同步' },
              { key: 'differs', label: '内容有异' },
              { key: 'mounted', label: '参谋参阅' },
            ].map(opt =>
              h('button', {
                key: opt.key,
                type: 'button',
                className: 'dnb-text-filter-btn',
                'data-active': globalDiffFilter === opt.key ? '1' : '0',
                onClick: () => patch({ globalVaultDiffFilter: opt.key }),
              }, opt.label),
            ),
          )
        : null,
      activeScope === 'session' && isBoundSession
        ? h(
            'div',
            { style: { display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap', paddingTop: 2, borderTop: '1px solid var(--dnb-border)' } },
            h('span', { style: { fontSize: 11, color: 'var(--dnb-text-3)' } }, '分柜：'),
            h('select', {
              className: 'dnb-input',
              style: { flex: 1, minWidth: 110, height: 24, padding: '0 6px', borderRadius: 6, fontSize: 11 },
              value: activeCabId,
              onChange: e => {
                const nextCid = e.target.value
                patch({ archiveCabinetId: nextCid })
                void mutateArchiveApi({ op: 'switchCabinet', cabinetId: nextCid, vaultScope: 'session' }, '已切换分柜')
              },
            }, cabinets.map(c => h('option', { key: c.id, value: c.id }, `${c.name} (${c.id === activeCabId ? sessionItems.length : (c.count ?? 0)})`))),
            h('button', {
              type: 'button',
              className: 'dnb-mini-btn',
              style: { height: 24, fontSize: 10.5 },
              onClick: () => patch({ archiveNewCabinetOpen: !view.archiveNewCabinetOpen }),
            }, '+ 新柜'),
            h('button', {
              type: 'button',
              className: 'dnb-mini-btn',
              style: { height: 24, fontSize: 10.5 },
              onClick: () => patch({ archiveNewFolderOpen: !view.archiveNewFolderOpen }),
            }, '+ 抽屉'),
          )
        : null,
      activeScope === 'session' && view.archiveNewCabinetOpen
        ? h(
            'div',
            { style: { display: 'flex', gap: 5 } },
            h('input', {
              className: 'dnb-input',
              style: { height: 26, fontSize: 11, borderRadius: 8, flex: 1 },
              placeholder: '新分柜名称…',
              value: view.archiveNewCabinetName || '',
              onChange: e => patch({ archiveNewCabinetName: e.target.value }),
              onKeyDown: async e => {
                if (e.key === 'Enter' && (view.archiveNewCabinetName || '').trim()) {
                  const nm = view.archiveNewCabinetName.trim()
                  patch({ archiveNewCabinetName: '', archiveNewCabinetOpen: false })
                  await mutateArchiveApi({ op: 'createCabinet', name: nm, vaultScope: 'session' }, `已切入「${nm}」`)
                }
              },
            }),
            h('button', {
              type: 'button',
              className: 'dnb-primary-btn',
              style: { height: 26, padding: '0 9px', fontSize: 11 },
              onClick: async () => {
                const nm = String(view.archiveNewCabinetName || '').trim()
                if (!nm) return
                patch({ archiveNewCabinetName: '', archiveNewCabinetOpen: false })
                await mutateArchiveApi({ op: 'createCabinet', name: nm, vaultScope: 'session' }, `已切入「${nm}」`)
              },
            }, '创建'),
          )
        : null,
      activeScope === 'session' && view.archiveNewFolderOpen
        ? h(
            'div',
            { style: { display: 'flex', gap: 5 } },
            h('input', {
              className: 'dnb-input',
              style: { height: 26, fontSize: 11, borderRadius: 8, flex: 1 },
              placeholder: '新抽屉名称…',
              value: view.archiveNewFolderName || '',
              onChange: e => patch({ archiveNewFolderName: e.target.value }),
              onKeyDown: e => { if (e.key === 'Enter') void submitNewFolder() },
            }),
            h('button', {
              type: 'button',
              className: 'dnb-primary-btn',
              style: { height: 26, padding: '0 9px', fontSize: 11 },
              onClick: () => void submitNewFolder(),
            }, '创建'),
          )
        : null,
    )
  }

  // ── Page 2: Session Working Cabinet ──
  const renderSessionPage = () => {
    if (!isBoundSession) {
      return h(
        'div',
        { className: 'dnb-group', style: { padding: '20px 14px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' } },
        h('div', { style: { fontSize: 12.5, fontWeight: 600, color: 'var(--dnb-text)' } }, bi('新对话还没开始，本局档案暂未建立', 'New chat: session vault not created yet')),
        h('div', { style: { fontSize: 11, color: 'var(--dnb-text-3)', maxWidth: 320 } }, bi('发第一条消息后会自动建一个独立档案柜，不会和旧对话混在一起。', 'Starts an isolated vault on your first message so chats stay separate.')),
        h(
          'div',
          { style: { display: 'flex', gap: 6, marginTop: 4 } },
          h('button', { type: 'button', className: 'dnb-pill', onClick: () => switchScope('global') }, bi(`看全局 (${globalBadgeCount})`, `Global (${globalBadgeCount})`)),
          h('button', { type: 'button', className: 'dnb-pill', onClick: () => switchScope('precipitated') }, bi(`看冷藏 (${precipBadgeCount})`, `Cold (${precipBadgeCount})`)),
        ),
      )
    }

    return h(
      React.Fragment,
      null,
      renderVaultStripBar(),
      renderSearchAndFilterStrip(),
      renderOrganizeDeck('session'),
      view.archiveEditor ? h(ArchiveEditorCard, { folders: drawerList, editor: view.archiveEditor, defaultScope: 'session' }) : null,
      tempNotes.length > 0
        ? h(
            'div',
            {
              className: 'dnb-strip-bar',
              style: { '--dnb-strip-color': '#10b981', marginBottom: 8 },
            },
            h('span', { style: { fontSize: 11.5, color: 'var(--dnb-text-2)' } }, bi(`有 ${tempNotes.length} 条临时便签可以存入档案`, `${tempNotes.length} temp notes ready to save`)),
            h('button', {
              type: 'button',
              className: 'dnb-mini-btn',
              disabled: Boolean(view.archiveSweeping),
              onClick: async () => {
                patch({ archiveSweeping: true })
                try {
                  const noteIds = tempNotes.map(n => n && n.id).filter(Boolean)
                  await mutateArchiveApi({ op: 'precipitateNotes', vaultScope: 'session', noteIds }, bi('已存进本局档案', 'Saved to Session Vault'))
                } finally {
                  patch({ archiveSweeping: false })
                }
              },
            }, view.archiveSweeping ? bi('收纳中…', 'Storing…') : bi('一键收纳', 'Store All')),
          )
        : null,
      view.archiveLoading && !view.archiveSessionLoaded
        ? h('div', { className: 'dnb-empty' }, bi('正在加载本局档案…', 'Loading session vault…'))
        : filteredItems.length === 0 && !view.archiveShowEmptyDrawers
          ? h(
              'div',
              { className: 'dnb-empty' },
              query || clipFilter !== 'all' ? bi('没有找到匹配的档案', 'No matching notes') : bi('本局档案还是空的。点右上角 ⋯ 可以新建，或从对话里提取。', 'Session vault is empty. Click ⋯ above to add or extract notes.'),
            )
          : h(
              React.Fragment,
              null,
              visibleSessionDrawers.map(folder => {
                const fItems = byFolder.get(folder.id) || []
                const autoOpen = Boolean(query || clipFilter !== 'all')
                const drawerOpen = autoOpen || Boolean(view.archiveOpenFolders && view.archiveOpenFolders[folder.id])
                return renderArchiveFolderDrawer({
                  drawerKey: folder.id,
                  folder,
                  items: fItems,
                  drawerOpen,
                  openMenuKey,
                  setOpenMenuKey,
                  onToggle: () => patch({
                    archiveOpenFolders: { ...(view.archiveOpenFolders || {}), [folder.id]: !drawerOpen },
                  }),
                  onOrganize: () => void requestOrganizeArchives({ folder: folder.id, scope: 'folder', vaultScope: 'session' }),
                  onCreateInFolder: () => patch({
                    archiveEditor: {
                      id: '', vaultScope: 'session', title: '', summary: '', folder: folder.id, paperclip: 'silver', tags: '', body: '',
                    },
                  }),
                  renderChild: (it, idx) => h(ArchiveDossierCard, {
                    key: it.id,
                    item: it,
                    idx,
                    folders: drawerList,
                    view,
                    scopeOverride: 'session',
                    openMenuKey,
                    setOpenMenuKey,
                  }),
                })
              }),
              emptySessionDrawers.length > 0 && !query && clipFilter === 'all'
                ? h(
                    'div',
                    { style: { textAlign: 'center', marginTop: 4 } },
                    h('button', {
                      type: 'button',
                      className: 'dnb-text-filter-btn',
                      onClick: () => patch({ archiveShowEmptyDrawers: !view.archiveShowEmptyDrawers }),
                    }, view.archiveShowEmptyDrawers ? '隐藏空抽屉 ∧' : `空抽屉 (${emptySessionDrawers.length}) ▾`),
                  )
                : null,
            ),
    )
  }

  // ── Page 3: Global Vault ──
  const renderGlobalPage = () => {
    if (view.globalVaultStaleBlocked) {
      return h(
        'div',
        { className: 'dnb-group', style: { padding: '18px 14px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' } },
        h('div', { style: { fontSize: 12.5, fontWeight: 600, color: '#f59e0b' } }, '系统版本较旧，请重启 DSH 后再看全局档案'),
        h('button', { type: 'button', className: 'dnb-pill', onClick: () => void loadArchives(true, '', 'global') }, '重试'),
      )
    }

    const localBriefs = isBoundSession && Array.isArray(diff.localOnlyBriefs) ? diff.localOnlyBriefs : []
    const gByFolder = new Map()
    for (const gf of globalFolders) gByFolder.set(gf.id, [])
    for (const it of filteredGlobalItems) {
      const fId = it.folder || 'inbox'
      if (!gByFolder.has(fId)) gByFolder.set(fId, [])
      gByFolder.get(fId).push(it)
    }
    const gDrawers = [...globalFolders]
    for (const fId of gByFolder.keys()) {
      if (!gDrawers.some(x => x.id === fId)) gDrawers.push({ id: fId, label: fId, hint: '全局抽屉', accent: '#a855f7' })
    }
    const nonEmptyG = gDrawers.filter(d => (gByFolder.get(d.id) || []).length > 0)

    return h(
      React.Fragment,
      null,
      renderVaultStripBar(),
      renderSearchAndFilterStrip(),
      renderOrganizeDeck('global'),
      view.archiveEditor ? h(ArchiveEditorCard, { folders: globalFolders, editor: view.archiveEditor, defaultScope: 'global' }) : null,
      isBoundSession && view.globalShowLocalOnlyDrawer && localBriefs.length > 0
        ? h(
            'div',
            { className: 'dnb-group', style: { padding: '8px 10px', marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 5 } },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--dnb-text-2)' } },
              h('span', null, `本局还有 ${localBriefs.length} 份可以存到全局`),
              h('button', {
                type: 'button',
                className: 'dnb-icon-btn',
                style: { width: 20, height: 20 },
                onClick: () => patch({ globalShowLocalOnlyDrawer: false }),
              }, h(Icon, { name: 'x', size: 12 })),
            ),
            localBriefs.map(b =>
              h(
                'div',
                { key: 'lb-' + b.id, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '4px 6px', borderRadius: 7, background: 'var(--dnb-elevated)' } },
                h('span', { style: { fontSize: 11.5, color: 'var(--dnb-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 } }, b.title || '未命名'),
                h('button', {
                  type: 'button',
                  className: 'dnb-mini-btn',
                  onClick: () => void mutateArchiveApi({ op: 'copyToGlobal', archiveId: b.id, vaultScope: 'session' }, '已存到全局档案'),
                }, b.diffStatus === 'local_modified' ? '更新全局版本' : '存到全局'),
              ),
            ),
          )
        : null,
      view.archiveLoading && !view.globalVaultLoaded
        ? h('div', { className: 'dnb-empty' }, bi('正在加载全局档案…', 'Loading global vault…'))
        : nonEmptyG.length === 0
          ? h('div', { className: 'dnb-empty' }, globalItems.length === 0 ? bi('全局档案还是空的。可以从本局整理进来，或直接新建。', 'Global vault is empty. Save notes from a session or add one.') : bi('没有找到匹配的全局档案', 'No matching global notes'))
          : nonEmptyG.map(gf => {
              const fItems = gByFolder.get(gf.id) || []
              const gKey = 'global:' + gf.id
              const isGOpen = !(view.archiveOpenFolders && view.archiveOpenFolders[gKey] === false)
              return renderArchiveFolderDrawer({
                drawerKey: gKey,
                folder: gf,
                items: fItems,
                drawerOpen: isGOpen,
                openMenuKey,
                setOpenMenuKey,
                onToggle: () => patch({ archiveOpenFolders: { ...(view.archiveOpenFolders || {}), [gKey]: !isGOpen } }),
                onOrganize: () => void requestOrganizeArchives({ folder: gf.id, scope: 'folder', vaultScope: 'global' }),
                onPrecipitate: () => patch({
                  precipitateModal: {
                    op: 'drawer',
                    vaultScope: 'global',
                    cabinetId: '',
                    folder: gf.id,
                    ids: fItems.map(x => x.id),
                    label: `全局抽屉「${gf.label}」(${fItems.length} 份)`,
                    clearSource: false,
                  },
                }),
                renderChild: (it, idx) => h(ArchiveDossierCard, {
                  key: 'glob-' + it.id,
                  item: it,
                  idx,
                  folders: globalFolders,
                  view,
                  scopeOverride: 'global',
                  openMenuKey,
                  setOpenMenuKey,
                }),
              })
            }),
    )
  }

  // ── Page 4: Cold Vault (`precipitated`) ──
  const renderColdPage = () => {
    const pFolderDefs = Array.isArray(view.precipitatedFolders) && view.precipitatedFolders.length
      ? view.precipitatedFolders
      : [
          { id: 'coords', label: '项目入口与路径', hint: '常用入口、脚本和端口', accent: '#38bdf8' },
          { id: 'incidents', label: '踩坑与排查记录', hint: '常见问题和原因', accent: '#f59e0b' },
          { id: 'contracts', label: '接口与规则约定', hint: '接口说明和安全要求', accent: '#a855f7' },
          { id: 'ops', label: '日常操作经验', hint: '常用的好做法', accent: '#10b981' },
          { id: 'plans', label: '旧版方案记录', hint: '过去的阶段规划', accent: '#64748b' },
        ]
    const pByFolder = new Map()
    for (const pf of pFolderDefs) pByFolder.set(pf.id, [])
    for (const p of filteredPrecip) {
      const fId = p.folder || 'ops'
      if (!pByFolder.has(fId)) pByFolder.set(fId, [])
      pByFolder.get(fId).push(p)
    }
    const drawers = [...pFolderDefs]
    for (const k of pByFolder.keys()) {
      if (!drawers.some(x => x.id === k)) drawers.push({ id: k, label: k, hint: '冷藏抽屉', accent: '#64748b' })
    }
    const nonEmptyDrawers = drawers.filter(d => (pByFolder.get(d.id) || []).length > 0)

    return h(
      React.Fragment,
      null,
      renderVaultStripBar(),
      renderSearchAndFilterStrip(),
      filteredPrecip.length === 0
        ? h('div', { className: 'dnb-empty' }, precipList.length === 0 ? bi('冷藏库还是空的。可以把全局档案里长期不改的经验转到这里。', 'Cold vault is empty. Move long-term notes here from Global Vault.') : bi('没有找到匹配的冷藏档案', 'No matching cold notes'))
        : nonEmptyDrawers.map(pf => {
            const fItems = pByFolder.get(pf.id) || []
            const isDrawerOpen = !(view.precipOpenDrawers && view.precipOpenDrawers[pf.id] === false)
            return renderArchiveFolderDrawer({
              drawerKey: 'cold:' + pf.id,
              folder: pf,
              items: fItems,
              drawerOpen: isDrawerOpen,
              openMenuKey,
              setOpenMenuKey,
              onToggle: () => patch({ precipOpenDrawers: { ...(view.precipOpenDrawers || {}), [pf.id]: !isDrawerOpen } }),
              renderChild: (p, pIdx) => h(ArchiveColdCard, {
                key: p.id,
                p,
                idx: pIdx,
                view,
                flippedSet,
                isBoundSession,
                openMenuKey,
                setOpenMenuKey,
              }),
            })
          }),
    )
  }

  return h(
    'div',
    { className: 'dnb-view' },

    // Clean 4-Tab Vault Segmented Bar (`📌 桌面 | 🗂️ 本局 | 🌐 全局 | 🧊 冷藏`)
    h(
      'div',
      { className: 'dnb-vault-seg', role: 'tablist', 'aria-label': bi('桌面和三类档案柜', 'Desktop and Archive Vaults') },
      [
        { key: 'desktop', label: bi('📌 桌面', '📌 Desk'), count: deskPinned.length },
        { key: 'session', label: bi('🗂️ 本局', '🗂️ Session'), count: sessionBadgeCount },
        { key: 'global', label: bi('🌐 全局', '🌐 Global'), count: globalBadgeCount },
        { key: 'precipitated', label: bi('🧊 冷藏', '🧊 Cold'), count: precipBadgeCount },
      ].map(seg =>
        h(
          'button',
          {
            key: seg.key,
            type: 'button',
            role: 'tab',
            'aria-selected': activeScope === seg.key ? 'true' : 'false',
            className: 'dnb-vault-seg-btn',
            'data-active': activeScope === seg.key ? '1' : '0',
            onClick: () => switchScope(seg.key),
          },
          h('span', { style: { whiteSpace: 'nowrap' } }, seg.label),
          seg.count > 0 ? h('span', { className: 'dnb-vault-seg-badge' }, String(seg.count)) : null,
        ),
      ),
    ),

    // Multi-Select Floating Bar (visible ONLY when user ticks checkboxes)
    selectedArchivesList.length > 0
      ? h(
          'div',
          { className: 'dnb-batch-bar' },
          h('span', { style: { fontSize: 11.5, fontWeight: 600, color: 'var(--dnb-accent)' } }, bi(`已选 ${selectedArchivesList.length} 卷`, `${selectedArchivesList.length} selected`)),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 5, marginLeft: 'auto' } },
            h('button', {
              type: 'button',
              className: 'dnb-mini-btn',
              'data-tone': 'accent',
              onClick: () => openArchiveRelayModal(selectedArchivesList),
            }, bi('📨 合并递话', '📨 Relay Selected')),
            h('button', {
              type: 'button',
              className: 'dnb-mini-btn',
              onClick: () => {
                clearSelectedArchives()
                patch({ archiveSelectMode: false })
              },
            }, bi('取消', 'Cancel')),
          ),
        )
      : null,

    activeScope === 'desktop'
      ? renderDesktopPage()
      : activeScope === 'global'
        ? renderGlobalPage()
        : activeScope === 'precipitated'
          ? renderColdPage()
          : renderSessionPage(),
  )
}
