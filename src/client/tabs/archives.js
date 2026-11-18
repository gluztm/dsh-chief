/**
 * tabs/archives.js
 *
 * Three-tier archive cabinets UI, paperclips, dossier editor, and ArchiveTab.
 */

import { React, h } from '../react-runtime.js'
import { PAPERCLIP_META, FOLDER_EAR_TAG } from '../constants.js'
import { store, patch } from '../store.js'
import { clampTitle, timeLabel } from '../utils.js'
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
  refresh,
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
        width: 18,
        height: 23,
        viewBox: '0 0 18 24',
        fill: 'none',
        stroke: meta.pinStroke || meta.color,
        strokeWidth: paperclip === 'gold' ? 2.25 : 1.95,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        style: meta.glow && meta.glow !== 'none' ? { filter: meta.glow } : undefined,
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

function ArchiveEditorCard({ folders, editor, defaultScope = '' }) {
  if (!editor) return null
  const isEdit = Boolean(editor.id)
  const editorScope = editor.vaultScope || defaultScope || store.archiveTabScope || 'session'
  const isGlobalEditor = editorScope === 'global'
  const folderList = Array.isArray(folders) && folders.length
    ? folders
    : [{ id: 'coords', label: '工程坐标与部署锚点' }, { id: 'incidents', label: '排障实录与硬事实' }, { id: 'inbox', label: '待分拣工作便签' }]

  const updateField = (patchObj) => {
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
      ? (isGlobalEditor ? '系统全局冷档案已更新' : '工程卷宗已更新')
      : (isGlobalEditor ? '已存入系统全局冷库（0 Token 不跟上下文）' : '新卷宗已分块归入本会话档案柜'))
    if (out && out.ok) {
      const savedItem = out.item
      const nextOpenFolders = { ...(store.archiveOpenFolders || {}) }
      const nextOpenFiles = { ...(store.archiveOpenFiles || {}) }
      if (savedItem && savedItem.folder) nextOpenFolders[savedItem.folder] = true
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
      style: {
        padding: 11,
        marginBottom: 10,
        borderColor: 'rgba(10, 132, 255, 0.4)',
      },
    },
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 } },
      h('span', { style: { fontSize: 12.5, fontWeight: 600, color: 'var(--dnb-accent)' } },
        isGlobalEditor
          ? (isEdit ? '🌐 编辑系统全局冷档案（0 Token）' : '🌐 新建系统全局冷档案（0 Token 不跟上下文）')
          : (isEdit ? '✎ 编辑本会话工程档案卷宗' : '📎 新建本会话工程卷宗（默认封存懒加载）')),
      h('button', {
        className: 'dnb-icon-btn',
        style: { width: 22, height: 22 },
        onClick: () => patch({ archiveEditor: null }),
      }, h(Icon, { name: 'x', size: 13 })),
    ),
    h(
      'div',
      { style: { display: 'flex', gap: 6, marginBottom: 7, flexWrap: 'wrap' } },
      h('select', {
        className: 'dnb-input',
        style: { flex: 1, minWidth: 140, height: 29, fontSize: 11.5, padding: '0 8px' },
        value: editor.folder || 'coords',
        onChange: e => updateField({ folder: e.target.value }),
      }, folderList.map(f => h('option', { key: f.id, value: f.id }, '抽屉：' + f.label))),
      h('select', {
        className: 'dnb-input',
        style: { width: 118, height: 29, fontSize: 11.5, padding: '0 8px' },
        value: editor.paperclip || 'silver',
        onChange: e => updateField({ paperclip: e.target.value }),
      },
        h('option', { value: 'gold' }, '📎 核心金针'),
        h('option', { value: 'silver' }, '📎 标准银针'),
        h('option', { value: 'copper' }, '📎 历史铜针'),
      ),
    ),
    h('input', {
      className: 'dnb-input',
      style: { marginBottom: 6, fontWeight: 600 },
      placeholder: '卷宗标题（如：DSH 反代链路端口与部署坐标）',
      value: editor.title || '',
      onChange: e => updateField({ title: e.target.value }),
    }),
    h('input', {
      className: 'dnb-input',
      style: { marginBottom: 6, fontSize: 11.5 },
      placeholder: '一句话卷宗提要（选填，留空自动提炼）',
      value: editor.summary || '',
      onChange: e => updateField({ summary: e.target.value }),
    }),
    h('textarea', {
      className: 'dnb-textarea',
      rows: 6,
      style: { marginBottom: 6, fontSize: 12, lineHeight: 1.55 },
      placeholder: '支持用 ## 小标题、键：值、或分段记录工程细节。保存后自动拆成可逐层点开的「记忆点 → 小点记忆」，也可随时请参谋长精编收纳…',
      value: editor.body || '',
      onChange: e => updateField({ body: e.target.value }),
    }),
    h('input', {
      className: 'dnb-input',
      style: { marginBottom: 8, fontSize: 11.5 },
      placeholder: '标签（逗号分隔，如：anchor, 部署, sing-box）',
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
      }, isEdit ? '保存修改' : '封存入柜'),
    ),
  )
}

function diffBadgeForArchive(diffStatus, isGlobalScope) {
  if (isGlobalScope) {
    if (diffStatus === 'synced') return { label: '✓ 与本会话同步', bg: 'rgba(16, 185, 129, 0.14)', color: '#10b981', border: 'rgba(16, 185, 129, 0.35)' }
    if (diffStatus === 'differs') return { label: '⚡ 与本会话版本不同', bg: 'rgba(245, 158, 11, 0.16)', color: '#f59e0b', border: 'rgba(245, 158, 11, 0.4)' }
    if (diffStatus === 'global_only') return { label: '🌐 全局独有', bg: 'rgba(10, 132, 255, 0.13)', color: 'var(--dnb-accent)', border: 'rgba(10, 132, 255, 0.32)' }
    return { label: '系统冷库', bg: 'var(--dnb-elevated)', color: 'var(--dnb-text-3)', border: 'var(--dnb-border)' }
  }
  if (diffStatus === 'synced') return { label: '✓ 已同步全局', bg: 'rgba(16, 185, 129, 0.14)', color: '#10b981', border: 'rgba(16, 185, 129, 0.35)' }
  if (diffStatus === 'local_modified') return { label: '⚡ 本地已改（未同步全局）', bg: 'rgba(245, 158, 11, 0.16)', color: '#f59e0b', border: 'rgba(245, 158, 11, 0.4)' }
  return { label: '仅本会话', bg: 'var(--dnb-elevated)', color: 'var(--dnb-text-3)', border: 'var(--dnb-border)' }
}

function ArchiveDossierCard({ item, idx, folders, view, scopeOverride = '' }) {
  const activeScope = scopeOverride || view.archiveTabScope || 'session'
  const isGlobalScope = activeScope === 'global'
  const isOpen = Boolean(view.archiveOpenFiles && view.archiveOpenFiles[item.id])
  const detail = view.archiveDetails && view.archiveDetails[item.id] ? view.archiveDetails[item.id] : null
  const loadingDetail = Boolean(view.archiveDetailLoading && view.archiveDetailLoading[item.id])
  const showRaw = Boolean(view.archiveRawView && view.archiveRawView[item.id])
  const movingThis = view.archiveMoveId === item.id
  const clip = PAPERCLIP_META[item.paperclip] || PAPERCLIP_META.silver
  const diffBadge = diffBadgeForArchive(item.diffStatus, isGlobalScope)
  const points = detail && Array.isArray(detail.points) ? detail.points : []
  const pointCount = points.length || item.pointCount || 0

  const toggleOpenFile = () => {
    const nextOpen = !isOpen
    patch({
      archiveOpenFiles: {
        ...(view.archiveOpenFiles || {}),
        [item.id]: nextOpen,
      },
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

  return h(
    'div',
    {
      className: 'dnb-dossier-card',
      'data-open': isOpen ? '1' : '0',
      'data-out': (item.takenOut || (isGlobalScope && item.chiefMounted)) ? '1' : '0',
      style: { animationDelay: Math.min(idx * 24, 140) + 'ms' },
    },
    // Clipped Paperclip Pin on Top-Left Edge
    h(PaperclipPin, {
      paperclip: item.paperclip,
      onClick: () => void mutateArchiveApi({ op: 'cycleClip', archiveId: item.id, vaultScope: activeScope }, '已切换卷宗曲别针等级'),
    }),

    // Clickable Dossier Header (Unfolds Structured Memory Points)
    h(
      'div',
      {
        className: 'dnb-dossier-head',
        onClick: toggleOpenFile,
        title: isOpen ? '点击合上此卷宗' : '点击展开此卷宗的分块记忆点',
      },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'flex-start', gap: 7, flex: 1, minWidth: 0 } },
          h('input', {
            type: 'checkbox',
            className: 'dnb-archive-check',
            style: { marginTop: 2.5 },
            checked: isSelected,
            title: '勾选以便多选并让参谋长带要求一起递话',
            onClick: e => e.stopPropagation(),
            onChange: () => toggleSelectArchive(item.id, isGlobalScope ? 'global' : 'session', item.title),
          }),
          h(
            'div',
            { style: { fontWeight: 600, fontSize: 12.5, color: 'var(--dnb-text)', lineHeight: 1.4, flex: 1, minWidth: 0 } },
            item.title || '未命名工程卷宗',
          ),
        ),
        h(
          'span',
          {
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              fontSize: 10.5,
              color: isOpen ? 'var(--dnb-accent)' : 'var(--dnb-text-3)',
              flexShrink: 0,
              marginTop: 1,
            },
          },
          pointCount ? (pointCount + ' 记忆点') : '展开',
          h(Icon, {
            name: 'chevron',
            size: 12,
            style: {
              transform: isOpen ? 'rotate(90deg)' : 'none',
              transition: 'transform 0.16s ease',
            },
          }),
        ),
      ),
      item.summary
        ? h('div', {
            style: {
              fontSize: 11.5,
              color: 'var(--dnb-text-2)',
              lineHeight: 1.45,
              marginTop: 3,
              display: '-webkit-box',
              WebkitLineClamp: isOpen ? 3 : 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            },
          }, item.summary)
        : null,
      ((item.tags && item.tags.length) || item.organizedBy === 'chief')
        ? h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginTop: 5 } },
            item.organizedBy === 'chief'
              ? h('span', {
                  className: 'dnb-tag',
                  style: { fontSize: 10, color: 'var(--dnb-accent)', background: 'rgba(10, 132, 255, 0.12)' },
                }, '✦ 参谋长已精编')
              : null,
            (item.tags || []).slice(0, 5).map(t => h('span', { key: t, className: 'dnb-tag', style: { fontSize: 10 } }, t)),
          )
        : null,
    ),

    // Always-Visible Flat Action Strip (Session vs System Global Cold Vault isolation rules)
    h(
      'div',
      { className: 'dnb-dossier-actions' },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', fontSize: 10.5, color: 'var(--dnb-text-3)' } },
        h('span', {
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            padding: '0 6px',
            height: 18,
            borderRadius: 99,
            background: clip.bg,
            border: '1px solid ' + clip.border,
            color: clip.color,
            fontSize: 10,
            fontWeight: 600,
          },
        }, clip.short),
        h('span', {
          style: (item.takenOut || (isGlobalScope && item.chiefMounted))
            ? {
                display: 'inline-flex',
                alignItems: 'center',
                padding: '0 6px',
                height: 18,
                borderRadius: 99,
                background: item.takenOut ? 'rgba(245, 158, 11, 0.16)' : 'rgba(129, 140, 248, 0.16)',
                border: item.takenOut ? '1px solid rgba(245, 158, 11, 0.42)' : '1px solid rgba(129, 140, 248, 0.42)',
                color: item.takenOut ? '#f59e0b' : '#a5b4fc',
                fontSize: 10,
                fontWeight: 600,
              }
            : undefined,
        },
          isGlobalScope
            ? (item.takenOut
                ? '📌 已摆上桌面（主+参谋可见）'
                : (item.chiefMounted ? '👁️ 本会话参谋参阅中' : '0 Token 封存中'))
            : (item.takenOut ? '📌 已摆上桌面（主+参谋可见）' : '封存懒加载')),
        h('span', {
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            padding: '0 6px',
            height: 18,
            borderRadius: 99,
            background: diffBadge.bg,
            border: '1px solid ' + diffBadge.border,
            color: diffBadge.color,
            fontSize: 10,
            fontWeight: 600,
          },
        }, diffBadge.label),
        item.updatedAt ? h('span', null, timeLabel(item.updatedAt)) : null,
      ),
      (() => {
        const isBoundSession = Boolean(view.sessionId && !view.archiveUnboundSession)
        if (isGlobalScope) {
          const isMounted = Boolean(item.chiefMounted)
          const isOnDesk = Boolean(item.takenOut)
          const importLabel = item.diffStatus === 'synced'
            ? '✓ 已在本局'
            : (item.diffStatus === 'differs' ? '⤵️ 覆盖本局' : '⤵️ 调入本局')
          return h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' } },
            h('button', {
              type: 'button',
              className: 'dnb-mini-btn',
              'data-tone': isOnDesk ? 'amber' : undefined,
              disabled: !isOnDesk && !isBoundSession,
              title: isOnDesk
                ? '从本会话桌面放回全局封存（恢复主对话不可见，全局冷库保留）'
                : (isBoundSession
                    ? '摆上桌面备查：主模型与参谋长均重点可见此全局卷宗（不删全局原档）'
                    : '需先发送消息建立具体会话才可摆上桌面'),
              onClick: e => {
                e.stopPropagation()
                if (!isOnDesk && !isBoundSession) return
                void mutateArchiveApi(
                  { op: isOnDesk ? 'putBack' : 'takeOut', archiveId: item.id, vaultScope: 'global' },
                  isOnDesk ? '📥 已从桌面放回全局封存' : '📌 已摆上本会话桌面（主模型与参谋长均重点可见）',
                )
              },
            }, isOnDesk ? '📥 放回冷存' : '📌 摆上桌面'),
            h('button', {
              type: 'button',
              className: 'dnb-mini-btn',
              'data-tone': isMounted ? 'accent' : undefined,
              disabled: !isMounted && !isBoundSession,
              title: isMounted
                ? '取消参谋长专属挂载（恢复 0 Token）'
                : (isBoundSession
                    ? '仅让当前会话的参谋长参阅此全局卷宗（主对话仍隔离）'
                    : '需先发送消息建立具体会话才可让参谋长参阅'),
              onClick: e => {
                e.stopPropagation()
                if (!isMounted && !isBoundSession) return
                void mutateArchiveApi(
                  { op: isMounted ? 'unmountChief' : 'mountChief', archiveId: item.id, vaultScope: 'global' },
                  isMounted ? '📥 已取消参谋参阅挂载' : '👁️ 已开放本会话参谋长参阅',
                )
              },
            }, isMounted ? '👁️ 参谋参阅中' : '👁️ 仅参谋参阅'),
            h('button', {
              type: 'button',
              className: 'dnb-mini-btn',
              'data-tone': isBoundSession && item.diffStatus !== 'synced' ? 'accent' : undefined,
              disabled: !isBoundSession,
              title: isBoundSession
                ? '无损调入本会话档案柜（保留全局库原档不删除）'
                : '需先发送消息建立具体会话才可调入本局',
              onClick: e => {
                e.stopPropagation()
                if (!isBoundSession) return
                void mutateArchiveApi(
                  { op: 'copyToSession', archiveId: item.id, vaultScope: 'global' },
                  '⤵️ 已无损调入本会话档案柜（全局原档保留）',
                )
              },
            }, importLabel),
            h('button', {
              type: 'button',
              className: 'dnb-mini-btn',
              'data-tone': 'accent',
              title: '点击填好要求，由参谋长带要求递交给主对话或子代理',
              onClick: e => {
                e.stopPropagation()
                openArchiveRelayModal([{ id: item.id, vaultScope: 'global', title: item.title }])
              },
            }, h(Icon, { name: 'send', size: 11 }), '递话'),
            h('button', {
              type: 'button',
              className: 'dnb-mini-btn',
              title: '遵循三层梯度：从全局工作卷宗提炼封存至 0-Token 沉淀冷档案柜',
              onClick: e => {
                e.stopPropagation()
                patch({
                  precipitateModal: {
                    op: 'single',
                    vaultScope: 'global',
                    cabinetId: '',
                    ids: [item.id],
                    label: `全局卷宗《${clampTitle(item.title, 24)}》`,
                    clearSource: false,
                  },
                })
              },
            }, '🏛️ 沉淀冷库'),
          )
        }
        const copyGlobalLabel = item.diffStatus === 'synced'
          ? '✓ 已升全局'
          : (item.diffStatus === 'local_modified' ? '↻ 同步全局' : '🌐 升级入全局')
        return h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' } },
          h('button', {
            type: 'button',
            className: 'dnb-mini-btn',
            'data-tone': item.takenOut ? 'amber' : undefined,
            title: item.takenOut
              ? '当前已摆到本会话桌面（主模型与参谋均可见）；点击放回档案柜恢复封存'
              : '将此卷宗摆上桌面备查（主模型与参谋长均重点可见，其余会话仍隔离）',
            onClick: e => {
              e.stopPropagation()
              void mutateArchiveApi(
                { op: item.takenOut ? 'putBack' : 'takeOut', archiveId: item.id, vaultScope: 'session' },
                item.takenOut ? '已放回档案柜封存（主对话恢复隔离）' : '📌 已摆上桌面（主模型与参谋长均重点可见）',
              )
            },
          },
            h(Icon, { name: item.takenOut ? 'trayIn' : 'trayOut', size: 11 }),
            item.takenOut ? '放回封存' : '📌 摆上桌面',
          ),
          h('button', {
            type: 'button',
            className: 'dnb-mini-btn',
            'data-tone': item.diffStatus === 'local_modified' ? 'amber' : undefined,
            style: item.diffStatus === 'synced'
              ? { borderColor: 'rgba(16, 185, 129, 0.42)', color: '#10b981' }
              : undefined,
            title: item.diffStatus === 'local_modified'
              ? '本地卷宗已修改，点击将最新版本同步覆盖至系统全局冷库'
              : (item.diffStatus === 'synced'
                  ? '与系统全局冷库版本一致（点击可再次同步覆盖）'
                  : '升入系统全局档案柜（逐级上升第一步）'),
            onClick: e => {
              e.stopPropagation()
              void mutateArchiveApi(
                { op: 'copyToGlobal', archiveId: item.id, vaultScope: 'session' },
                item.diffStatus === 'local_modified'
                  ? '↻ 已将本地改动同步更新至系统全局冷库'
                  : '🌐 已升级入系统全局档案柜（0 Token 封存）',
              )
            },
          }, copyGlobalLabel),
          h('button', {
            type: 'button',
            className: 'dnb-mini-btn',
            'data-tone': 'accent',
            title: '点击填好要求，由参谋长带要求递交给主对话或子代理查阅',
            onClick: e => {
              e.stopPropagation()
              openArchiveRelayModal([{ id: item.id, vaultScope: 'session', title: item.title }])
            },
          }, h(Icon, { name: 'send', size: 11 }), '递话'),
        )
      })(),
    ),

    // Tier-3 Unfolded Sheet: Structured Memory Points -> Click to Expand Sub-Point Detail
    isOpen
      ? h(
          'div',
          { className: 'dnb-points-sheet' },
          // Dossier Curation & Inspection Toolbar
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 5, flexWrap: 'wrap' } },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' } },
              points.length > 1
                ? h('button', {
                    type: 'button',
                    className: 'dnb-mini-btn',
                    onClick: toggleAllPoints,
                  }, allPointsExpanded ? '收起全部小点' : '展开全部小点')
                : null,
              h('button', {
                type: 'button',
                className: 'dnb-mini-btn',
                'data-tone': 'accent',
                disabled: view.archiveOrganizing,
                title: '请 DSH 参谋长重新精炼本卷摘要并拆分为清晰的分条记忆点与小点记忆（原文 100% 保留）',
                onClick: () => void requestOrganizeArchives({ ids: [item.id], scope: 'selected', vaultScope: activeScope }),
              },
                h(Icon, { name: 'sparkles', size: 10.5 }),
                view.archiveOrganizing ? '整理中…' : '请参谋长重拆此卷',
              ),
              h('button', {
                type: 'button',
                className: 'dnb-mini-btn',
                onClick: () => patch({
                  archiveRawView: { ...(view.archiveRawView || {}), [item.id]: !showRaw },
                }),
              }, showRaw ? '收起原文' : '原文对照'),
            ),
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 4 } },
              !isGlobalScope
                ? h('button', {
                    type: 'button',
                    className: 'dnb-mini-btn',
                    title: '移入其他档案柜抽屉',
                    onClick: () => patch({ archiveMoveId: movingThis ? '' : item.id }),
                  }, h(Icon, { name: 'folder', size: 10.5 }), '移抽屉')
                : null,
              h('button', {
                type: 'button',
                className: 'dnb-icon-btn',
                style: { width: 22, height: 22 },
                title: '编辑卷宗',
                onClick: () => void openEditorForThis(),
              }, h(Icon, { name: 'edit', size: 11.5 })),
              h('button', {
                type: 'button',
                className: 'dnb-icon-btn',
                style: { width: 22, height: 22, color: '#ff453a' },
                title: '删除此卷宗',
                onClick: () => {
                  if (!confirm('确认从档案柜删除卷宗《' + clampTitle(item.title, 20) + '》？')) return
                  void mutateArchiveApi({ op: 'delete', archiveId: item.id, vaultScope: activeScope }, '已删除工程卷宗')
                },
              }, h(Icon, { name: 'trash', size: 11.5 })),
            ),
          ),

          // Inline Folder Switcher Pills (when `移抽屉` clicked in session scope)
          !isGlobalScope && movingThis
            ? h(
                'div',
                {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    flexWrap: 'wrap',
                    padding: '6px 8px',
                    borderRadius: 8,
                    background: 'var(--dnb-card)',
                    border: '1px solid var(--dnb-border)',
                  },
                },
                h('span', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)' } }, '移至抽屉：'),
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
                      void mutateArchiveApi({ op: 'moveFolder', archiveId: item.id, folder: f.id, vaultScope: activeScope }, '已移入「' + f.label + '」抽屉')
                    },
                  }, f.label),
                ),
              )
            : null,

          // Loading state vs Structured Memory Points
          loadingDetail && !detail
            ? h(
                'div',
                { style: { padding: '8px 4px', fontSize: 11.5, color: 'var(--dnb-text-3)', display: 'flex', alignItems: 'center', gap: 6 } },
                h(Icon, { name: 'refresh', size: 12, style: { animation: 'dnb-spin 0.9s linear infinite' } }),
                '正在按需调阅卷宗记忆点…',
              )
            : points.length
              ? points.map((pt, pIdx) => {
                  const ptId = pt.id || ('pt-' + (pIdx + 1))
                  const pKey = item.id + ':' + ptId
                  const ptOpen = Boolean(view.archiveOpenPoints && view.archiveOpenPoints[pKey])
                  const numBadge = String(pIdx + 1).padStart(2, '0')
                  return h(
                    'div',
                    {
                      key: ptId,
                      className: 'dnb-mem-point',
                      'data-open': ptOpen ? '1' : '0',
                    },
                    h(
                      'div',
                      {
                        className: 'dnb-mem-point-row',
                        onClick: () => patch({
                          archiveOpenPoints: {
                            ...(view.archiveOpenPoints || {}),
                            [pKey]: !ptOpen,
                          },
                        }),
                        title: ptOpen ? '点击收起小点记忆' : '点击展开此条小点记忆详情',
                      },
                      h('span', { className: 'dnb-mem-point-idx' }, numBadge),
                      h(
                        'div',
                        { style: { flex: 1, minWidth: 0 } },
                        h('div', { style: { fontSize: 12, fontWeight: 600, color: 'var(--dnb-text)', lineHeight: 1.4 } },
                          pt.title || ('记忆点 ' + (pIdx + 1))),
                        !ptOpen && pt.cue && pt.cue !== pt.title
                          ? h('div', {
                              style: {
                                fontSize: 11,
                                color: 'var(--dnb-text-3)',
                                marginTop: 2,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              },
                            }, pt.cue)
                          : null,
                      ),
                      h(Icon, {
                        name: 'chevron',
                        size: 12,
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
                            { style: { display: 'flex', justifyContent: 'flex-end', gap: 5, marginTop: 7 } },
                            h('button', {
                              type: 'button',
                              className: 'dnb-mini-btn',
                              onClick: () => copyText(
                                `【${item.title} · ${pt.title}】\n${pt.detail || pt.cue || ''}`,
                                '已复制此条小点记忆',
                              ),
                            }, h(Icon, { name: 'copy', size: 10.5 }), '复制小点'),
                            h('button', {
                              type: 'button',
                              className: 'dnb-mini-btn',
                              'data-tone': 'accent',
                              onClick: () => void deliverArchiveToChat(detail || item, pt),
                            }, h(Icon, { name: 'send', size: 10.5 }), '递给对话'),
                          ),
                        )
                      : null,
                  )
                })
              : h('div', { style: { fontSize: 11.5, color: 'var(--dnb-text-3)', padding: '4px 2px' } }, '暂无结构化记忆点，可点击「请参谋长重拆此卷」自动梳理。'),

          // Lossless Raw Body Viewer
          showRaw && detail
            ? h(
                'div',
                {
                  style: {
                    marginTop: 4,
                    borderRadius: 9,
                    border: '1px solid var(--dnb-border)',
                    background: 'var(--dnb-card)',
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
                      padding: '5px 10px',
                      borderBottom: '1px solid var(--dnb-border)',
                      fontSize: 10.5,
                      color: 'var(--dnb-text-3)',
                    },
                  },
                  h('span', null, `无损原始正文（${(detail.body || '').length} 字）`),
                  h('button', {
                    type: 'button',
                    className: 'dnb-mini-btn',
                    style: { height: 20 },
                    onClick: () => copyText(detail.body || '', '已复制完整原文'),
                  }, h(Icon, { name: 'copy', size: 10 }), '复制全文'),
                ),
                h('pre', { className: 'dnb-pre', style: { maxHeight: 240 } }, detail.body || '（此卷无附加原始正文）'),
              )
            : null,
        )
      : null,
  )
}

export function ArchiveTab({ board, view }) {
  const activeScope = view.archiveTabScope || 'session'
  const counts = view.archiveCounts || {}
  const isBoundSession = Boolean(view.sessionId && !view.archiveUnboundSession)

  // Lazy-load archive headers when entering tab, switching session, or switching vault tier
  React.useEffect(() => {
    void loadArchives(false, '', activeScope)
  }, [view.sessionId, activeScope])

  const meta = view.archiveMeta || {}
  const sessionFolders = Array.isArray(view.archiveFolders) ? view.archiveFolders : []
  const globalFolders = Array.isArray(view.globalVaultFolders) && view.globalVaultFolders.length
    ? view.globalVaultFolders
    : sessionFolders
  const folders = activeScope === 'global' ? globalFolders : sessionFolders
  const sessionItems = isBoundSession && Array.isArray(view.archiveItems) ? view.archiveItems : []
  const globalItems = Array.isArray(view.globalVaultItems) ? view.globalVaultItems : []
  const items = activeScope === 'global' ? globalItems : sessionItems
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
  const globalBadgeCount = view.globalVaultLoaded
    ? globalItems.length
    : Number(counts.globalCount || 0)
  const precipBadgeCount = precipList.length || Number(counts.precipitatedCount || 0)
  const flippedBadgeCount = flippedSet.size || Number(counts.flippedCount || 0)

  const switchScope = nextScope => {
    if (!nextScope || nextScope === activeScope) return
    patch({
      archiveTabScope: nextScope,
      archiveDetails: {},
      archiveMoveId: '',
      archiveOrganizeOpen: false,
      archiveEditor: null,
      archiveNewCabinetOpen: false,
      archiveNewFolderOpen: false,
      ...(nextScope === 'session' && view.archiveCabinetId === 'cab-global' ? { archiveCabinetId: '' } : {}),
    })
    void loadArchives(true, '', nextScope)
  }

  const scopeBannerInfo = activeScope === 'global'
    ? {
        icon: '🌐',
        color: 'var(--dnb-accent)',
        text: '0-Token 全局档案柜 · 封存卷宗默认不注入主对话（参谋长后台关注）；点「📌 摆上桌面」即向主模型与参谋重点强调；支持无损「⤵️ 调入本局」（保留全局原档）或沉淀至冷库',
      }
    : activeScope === 'precipitated'
      ? {
          icon: '🏛️',
          color: '#f59e0b',
          text: '0-Token 沉淀冷档案柜 · 跨对话长期经验；封存态不注入主对话（参谋长后台关注）；点「📌 摆上桌面」即重点强调，或一键无损「⤵️ 调入本局 / 🌐 调入全局」（原沉淀档案不删）',
        }
      : {
          icon: '🔒',
          color: '#10b981',
          text: '本会话档案柜 · 封存卷宗默认不注入主对话（参谋长关注）；一旦「📌 摆上桌面」主模型与参谋均可见；须先升入全局才可逐级沉淀，不可越级直接沉淀',
        }

  const matchesArchiveFilter = it => {
    if (!it) return false
    if (clipFilter !== 'all' && it.paperclip !== clipFilter) return false
    if (!query) return true
    const hay = [
      it.title,
      it.summary,
      (it.tags || []).join(' '),
      (it.pointPreviews || []).join(' '),
    ].join(' ').toLowerCase()
    return hay.includes(query)
  }

  // Filter session headers client-side for instant zero-lag drawer filtering
  const filteredItems = sessionItems.filter(matchesArchiveFilter)

  // Global Cold Vault filter + live diff counters
  const gMountedCount = isBoundSession ? globalItems.filter(it => it && it.chiefMounted).length : 0
  const gOnlyCount = globalItems.filter(it => it && (it.diffStatus === 'global_only' || !isBoundSession)).length
  const gSyncedCount = isBoundSession ? globalItems.filter(it => it && it.diffStatus === 'synced').length : 0
  const gDiffersCount = isBoundSession ? globalItems.filter(it => it && it.diffStatus === 'differs').length : 0
  const localBriefs = isBoundSession && Array.isArray(diff.localOnlyBriefs) ? diff.localOnlyBriefs : []
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
    const hay = [p.title, p.summary, p.category, (p.tags || []).join(' ')].join(' ').toLowerCase()
    return hay.includes(query)
  })

  const takenOutItems = activeScope === 'session' ? sessionItems.filter(it => it && it.takenOut) : []
  const rawDesk = Array.isArray(view.archiveDeskItems) ? view.archiveDeskItems : []
  const fallbackDesk = [
    ...sessionItems.filter(it => it && it.takenOut).map(it => ({ ...it, vaultScope: 'session' })),
    ...globalItems.filter(it => it && it.takenOut).map(it => ({ ...it, vaultScope: 'global' })),
    ...precipList.filter(p => p && flippedSet.has(p.id)).map(p => ({ ...p, vaultScope: 'precipitated' })),
  ]
  const deskList = view.archiveDeskLoaded ? rawDesk : fallbackDesk
  const selectedArchivesList = Object.values(view.selectedArchiveMap || {}).filter(x => x && x.id)
  const byFolder = new Map()
  for (const f of sessionFolders) byFolder.set(f.id, [])
  for (const it of filteredItems) {
    const fId = it.folder || 'inbox'
    if (!byFolder.has(fId)) byFolder.set(fId, [])
    byFolder.get(fId).push(it)
  }

  // Build ordered folder drawers (include any orphan folder id gracefully)
  const drawerList = [...sessionFolders]
  for (const fId of byFolder.keys()) {
    if (!drawerList.some(f => f.id === fId)) {
      drawerList.push({ id: fId, label: fId, hint: '工程记忆抽屉', accent: '#64748b', count: byFolder.get(fId).length })
    }
  }

  const visibleDrawers = (query || clipFilter !== 'all')
    ? drawerList.filter(f => (byFolder.get(f.id) || []).length > 0)
    : drawerList

  const anyDrawerOpen = visibleDrawers.some(f => Boolean(view.archiveOpenFolders && view.archiveOpenFolders[f.id]))
  const toggleAllDrawers = () => {
    const next = {}
    if (!anyDrawerOpen) {
      for (const f of visibleDrawers) {
        if ((byFolder.get(f.id) || []).length > 0) next[f.id] = true
      }
    }
    patch({ archiveOpenFolders: next })
  }

  const submitNewFolder = async () => {
    const name = String(view.archiveNewFolderName || '').trim()
    if (!name) return
    const out = await mutateArchiveApi({ op: 'createFolder', label: name, vaultScope: 'session' }, '已新增档案柜抽屉「' + name + '」')
    if (out && out.ok && out.folder) {
      patch({
        archiveNewFolderOpen: false,
        archiveNewFolderName: '',
        archiveOpenFolders: { ...(view.archiveOpenFolders || {}), [out.folder.id]: true },
      })
    }
  }

  const renderOrganizeDeck = (targetScope) => {
    if (!view.archiveOrganizeOpen) return null
    return h(
      'div',
      {
        className: 'dnb-group',
        style: {
          padding: '9px 11px',
          marginBottom: 9,
          borderColor: 'rgba(10, 132, 255, 0.36)',
        },
      },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 } },
        h('span', { style: { fontSize: 12, fontWeight: 600, color: 'var(--dnb-accent)' } },
          targetScope === 'global' ? '✦ 吩咐 DSH 参谋长精编系统全局冷档案' : '✦ 吩咐 DSH 参谋长整理收纳本会话档案柜'),
        h('button', {
          className: 'dnb-icon-btn',
          style: { width: 20, height: 20 },
          onClick: () => patch({ archiveOrganizeOpen: false }),
        }, h(Icon, { name: 'x', size: 12 })),
      ),
      h('div', { style: { fontSize: 11, color: 'var(--dnb-text-2)', lineHeight: 1.45, marginBottom: 7 } },
        '参谋长会自动归纳类别、标记金/银/铜曲别针、提炼一句话提要，并将长文拆解为层次清晰的「记忆点 → 小点记忆」，同时 100% 无损保留原始正文。'),
      h(
        'div',
        { style: { display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 7 } },
        [
          { key: 'unorganized', label: '整理待精编卷宗' + (meta.unorganizedCount ? ` (${meta.unorganizedCount})` : '') },
          { key: 'all', label: '全柜重新梳理' },
        ].map(opt =>
          h('button', {
            key: opt.key,
            type: 'button',
            className: 'dnb-mini-btn',
            'data-tone': (view.archiveOrganizeScope || 'unorganized') === opt.key ? 'accent' : undefined,
            onClick: () => patch({ archiveOrganizeScope: opt.key }),
          }, opt.label),
        ),
      ),
      h(
        'div',
        { style: { display: 'flex', gap: 6, alignItems: 'center' } },
        h('input', {
          className: 'dnb-input',
          style: { height: 28, fontSize: 11.5, borderRadius: 99, padding: '0 11px' },
          placeholder: '可选补充要求（如：把命令与路径单独拆成小点）…',
          value: view.archiveOrganizePrompt || '',
          onChange: e => patch({ archiveOrganizePrompt: e.target.value }),
          onKeyDown: e => {
            if (e.key === 'Enter') void requestOrganizeArchives({ vaultScope: targetScope })
          },
        }),
        h('button', {
          type: 'button',
          className: 'dnb-primary-btn',
          style: { height: 28, padding: '0 12px', fontSize: 11.5, flexShrink: 0 },
          disabled: view.archiveOrganizing,
          onClick: () => void requestOrganizeArchives({ vaultScope: targetScope }),
        }, view.archiveOrganizing ? '整理中…' : '立即整理'),
      ),
    )
  }

  const renderPrecipFooter = () => h(
    'div',
    {
      className: 'dnb-cell dnb-cell-hover',
      style: { marginTop: 10, borderRadius: 10, border: '1px solid var(--dnb-border)', background: 'var(--dnb-card)', padding: '7px 11px', justifyContent: 'space-between', cursor: 'pointer' },
      onClick: () => switchScope('precipitated'),
    },
    h('span', { style: { fontSize: 11.5, color: 'var(--dnb-text-2)' } },
      `🏛️ 沉淀档案柜现有 ${precipBadgeCount} 条跨对话冷封存经验` + (flippedBadgeCount > 0 ? `（本会话已取出 ${flippedBadgeCount} 条）` : '（默认双盲 0 Token）')),
    h('span', { style: { fontSize: 11, color: 'var(--dnb-accent)', fontWeight: 600 } }, '前往管理 →'),
  )

  const totalCount = sessionItems.length || meta.totalCount || 0

  return h(
    'div',
    { className: 'dnb-view' },

    // Three-Tier Vault Scope Segmented Switcher
    h(
      'div',
      { className: 'dnb-vault-seg', role: 'tablist', 'aria-label': '三层工程档案柜' },
      [
        { key: 'session', label: '💬 本会话档案柜', count: sessionBadgeCount },
        { key: 'global', label: '🌐 全局档案柜', count: globalBadgeCount },
        { key: 'precipitated', label: '🏛️ 沉淀档案柜', count: precipBadgeCount, extra: flippedBadgeCount },
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
          h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, seg.label),
          h('span', { className: 'dnb-vault-seg-badge' }, String(seg.count)),
          seg.extra > 0
            ? h('span', {
                className: 'dnb-vault-seg-badge',
                style: { background: 'rgba(10,132,255,0.18)', color: 'var(--dnb-accent)' },
                title: `本会话已取出 ${seg.extra} 条沉淀经验`,
              }, `取${seg.extra}`)
            : null,
        ),
      ),
    ),

    // 1-Line Visibility Boundary Banner
    h(
      'div',
      { className: 'dnb-vault-perm-banner' },
      h('span', { style: { color: scopeBannerInfo.color, fontWeight: 600, flexShrink: 0 } }, scopeBannerInfo.icon),
      h('span', { style: { flex: 1, minWidth: 0 } }, scopeBannerInfo.text),
    ),

    // Unified 3-Vault Active Desk Tray (Items placed on Desk are high-priority & visible to BOTH @lead and Chief)
    deskList.length > 0
      ? h(
          'div',
          { className: 'dnb-desk-tray' },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 6, flexWrap: 'wrap' } },
            h(
              'span',
              { style: { fontSize: 12, fontWeight: 600, color: '#f59e0b', display: 'inline-flex', alignItems: 'center', gap: 5 } },
              h(Icon, { name: 'paperclip', size: 12.5 }),
              `📌 桌面重点备查（${deskList.length} 卷生效中 · 主模型与参谋均可见）`,
            ),
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 5 } },
              h('button', {
                type: 'button',
                className: 'dnb-mini-btn',
                'data-tone': 'accent',
                onClick: () => openArchiveRelayModal(deskList.map(it => ({
                  id: it.id,
                  vaultScope: it.vaultScope || 'session',
                  title: it.title,
                }))),
              }, '📨 全桌面带要求递话'),
              deskList.length > 1
                ? h('button', {
                    type: 'button',
                    className: 'dnb-mini-btn',
                    onClick: async () => {
                      for (const it of deskList) {
                        const vs = it.vaultScope || 'session'
                        if (vs === 'precipitated') {
                          await mutateArchiveApi({ op: 'sealBack', id: it.id, vaultScope: 'precipitated' })
                        } else {
                          await mutateArchiveApi({ op: 'putBack', archiveId: it.id, vaultScope: vs })
                        }
                      }
                      patch({ notice: '已全部放回原档案柜封存（主对话恢复隔离）' })
                    },
                  }, '全部放回封存')
                : null,
            ),
          ),
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 5 } },
            deskList.map(it => {
              const vs = it.vaultScope || 'session'
              const vsTag = vs === 'global' ? '全局' : (vs === 'precipitated' ? '沉淀' : '本局')
              return h(
                'div',
                {
                  key: 'desk-' + vs + '-' + it.id,
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 6,
                    padding: '5px 8px',
                    borderRadius: 8,
                    background: 'var(--dnb-elevated)',
                    border: '1px solid var(--dnb-border)',
                  },
                },
                h(
                  'div',
                  {
                    style: { fontSize: 11.5, fontWeight: 500, color: 'var(--dnb-text)', cursor: 'pointer', flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 5 },
                    title: '点击切换至所在档案柜并展开查看此卷宗',
                    onClick: () => {
                      if (vs !== activeScope) switchScope(vs)
                      if (vs === 'precipitated') {
                        patch({ archiveOpenFiles: { ...(view.archiveOpenFiles || {}), ['prec_' + it.id]: true } })
                        void loadArchiveDetail(it.id, false, { precipitated: true })
                      } else {
                        patch({
                          archiveOpenFolders: { ...(view.archiveOpenFolders || {}), [it.folder || 'inbox']: true },
                          archiveOpenFiles: { ...(view.archiveOpenFiles || {}), [it.id]: true },
                        })
                        void loadArchiveDetail(it.id, false, { scope: vs })
                      }
                    },
                  },
                  h('span', {
                    className: 'dnb-tag',
                    style: {
                      fontSize: 10,
                      flexShrink: 0,
                      color: vs === 'global' ? 'var(--dnb-accent)' : (vs === 'precipitated' ? '#f59e0b' : '#10b981'),
                    },
                  }, vsTag),
                  h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, '📌 ' + (it.title || it.id)),
                ),
                h(
                  'div',
                  { style: { display: 'flex', gap: 5, flexShrink: 0 } },
                  h('button', {
                    type: 'button',
                    className: 'dnb-mini-btn',
                    onClick: () => openArchiveRelayModal([{ id: it.id, vaultScope: vs, title: it.title }]),
                  }, '📨 递话'),
                  h('button', {
                    type: 'button',
                    className: 'dnb-mini-btn',
                    'data-tone': 'amber',
                    onClick: () => {
                      if (vs === 'precipitated') {
                        void mutateArchiveApi({ op: 'sealBack', id: it.id, vaultScope: 'precipitated' }, '📥 已封回沉淀冷库')
                      } else {
                        void mutateArchiveApi({ op: 'putBack', archiveId: it.id, vaultScope: vs }, '已放回原档案柜封存')
                      }
                    },
                  }, '放回'),
                ),
              )
            }),
          ),
        )
      : null,

    // Multi-Select Batch Relay Bar (across any vault tier)
    selectedArchivesList.length > 0
      ? h(
          'div',
          { className: 'dnb-batch-bar' },
          h('span', { style: { fontSize: 12, fontWeight: 600, color: 'var(--dnb-accent)' } },
            `已勾选 ${selectedArchivesList.length} 条档案（支持跨库合并递话）`),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto', flexWrap: 'wrap' } },
            h('button', {
              type: 'button',
              className: 'dnb-mini-btn',
              'data-tone': 'accent',
              onClick: () => openArchiveRelayModal(selectedArchivesList),
            }, '📨 带要求合并递话'),
            h('button', {
              type: 'button',
              className: 'dnb-mini-btn',
              onClick: () => clearSelectedArchives(),
            }, '清空勾选'),
          ),
        )
      : null,

    // Scope A: Precipitated Cold Vault Dedicated Page
    activeScope === 'precipitated'
      ? h(
          React.Fragment,
          null,
          h(
            'div',
            { style: { display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 } },
            h('input', {
              className: 'dnb-input',
              style: { height: 28, borderRadius: 99, padding: '0 11px', fontSize: 11.5 },
              placeholder: '筛选沉淀经验标题、类别、关键词…',
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
          filteredPrecip.length === 0
            ? h(
                'div',
                { className: 'dnb-group', style: { padding: '16px 14px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' } },
                h('div', { style: { fontSize: 12.5, fontWeight: 600, color: 'var(--dnb-text)' } },
                  precipList.length === 0 ? '🏛️ 沉淀档案柜暂空' : '没有匹配的沉淀经验条目'),
                h('div', { style: { fontSize: 11.5, color: 'var(--dnb-text-3)', lineHeight: 1.5, maxWidth: 320 } },
                  precipList.length === 0
                    ? '实行三层档案梯度：本会话卷宗须先「🌐 升级入全局」，再前往「🌐 全局档案柜」点击「⏬ 沉淀可复用经验」或单卡「🏛️ 沉淀冷库」封存于此。'
                    : '可尝试清空搜索词查看全部跨对话沉淀条目。'),
              )
            : h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 7 } },
                filteredPrecip.map(p => {
                  const isFlipped = flippedSet.has(p.id)
                  const isOpen = Boolean(view.archiveOpenFiles && view.archiveOpenFiles['prec_' + p.id])
                  const detail = (view.archiveDetails && view.archiveDetails[p.id]) || null
                  const isChecked = Boolean(view.selectedArchiveMap && view.selectedArchiveMap['precipitated:' + p.id])
                  return h(
                    'div',
                    {
                      key: p.id,
                      style: {
                        borderRadius: 10,
                        border: isFlipped ? '1px solid rgba(245, 158, 11, 0.48)' : '1px solid var(--dnb-border)',
                        background: isFlipped ? 'rgba(245, 158, 11, 0.06)' : 'var(--dnb-elevated)',
                        padding: '9px 11px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 5,
                      },
                    },
                    h(
                      'div',
                      {
                        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, cursor: 'pointer' },
                        onClick: () => {
                          const key = 'prec_' + p.id
                          const nextOpen = !isOpen
                          patch({ archiveOpenFiles: { ...(view.archiveOpenFiles || {}), [key]: nextOpen } })
                          if (nextOpen && !detail) void loadArchiveDetail(p.id, false, { precipitated: true })
                        },
                      },
                      h(
                        'div',
                        { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 } },
                        h('input', {
                          type: 'checkbox',
                          className: 'dnb-archive-check',
                          checked: isChecked,
                          title: '勾选以便多选合并递话',
                          onClick: e => e.stopPropagation(),
                          onChange: () => toggleSelectArchive(p.id, 'precipitated', p.title),
                        }),
                        h('span', { className: 'dnb-tag', style: { fontSize: 10, flexShrink: 0 } }, p.category || '经验'),
                        h('span', { style: { fontSize: 12.5, fontWeight: 600, color: 'var(--dnb-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, p.title),
                        isFlipped
                          ? h('span', { className: 'dnb-tag', style: { fontSize: 10, background: 'rgba(245,158,11,0.18)', color: '#f59e0b', flexShrink: 0 } }, '📌 已摆上桌面')
                          : h('span', { className: 'dnb-tag', style: { fontSize: 10, color: 'var(--dnb-text-3)', flexShrink: 0 } }, '封存中'),
                      ),
                      h('span', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', flexShrink: 0 } }, isOpen ? '收起' : `${p.pointsCount || 0} 要点`),
                    ),
                    p.summary
                      ? h('div', { style: { fontSize: 11.5, color: 'var(--dnb-text-2)', lineHeight: 1.45 } }, p.summary)
                      : null,
                    isOpen && detail
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
                      { style: { display: 'flex', alignItems: 'center', gap: 5, marginTop: 2, flexWrap: 'wrap' } },
                      h('button', {
                        type: 'button',
                        className: 'dnb-mini-btn',
                        'data-tone': isFlipped ? 'amber' : undefined,
                        disabled: !isFlipped && !isBoundSession,
                        title: !isBoundSession && !isFlipped
                          ? '当前处于空白未绑定新窗口；请先进入具体会话后再点击摆上桌面'
                          : (isFlipped
                              ? '放回冷库后立即从主对话可见桌面隐藏（恢复零注入，参谋长仅后台关注）'
                              : '摆上桌面备查后，主对话与参谋长均重点可见此条沉淀经验'),
                        onClick: () => void mutateArchiveApi(
                          { op: isFlipped ? 'sealBack' : 'flipOut', id: p.id, vaultScope: 'precipitated' },
                          isFlipped ? '📥 已封回冷库（恢复仅参谋关注）' : '📌 已摆上桌面（主对话与参谋长均重点可见）',
                        ),
                      }, isFlipped ? '📥 放回冷库' : '📌 摆上桌面'),
                      h('button', {
                        type: 'button',
                        className: 'dnb-mini-btn',
                        disabled: !isBoundSession,
                        title: isBoundSession
                          ? '无损调入本会话档案柜作为本地参考卷宗（原沉淀冷库档案保留不删）'
                          : '需先发送消息建立具体会话才可调入本局',
                        onClick: () => void mutateArchiveApi(
                          { op: 'pullPrecipitated', id: p.id, targetScope: 'session', vaultScope: 'precipitated' },
                          '⤵️ 已无损调入本会话档案柜（沉淀原档保留）',
                        ),
                      }, '⤵️ 调入本局'),
                      h('button', {
                        type: 'button',
                        className: 'dnb-mini-btn',
                        title: '无损调入全局档案柜长期备用（原沉淀冷库档案保留不删）',
                        onClick: () => void mutateArchiveApi(
                          { op: 'pullPrecipitated', id: p.id, targetScope: 'global', vaultScope: 'precipitated' },
                          '🌐 已无损调入全局档案柜（沉淀原档保留）',
                        ),
                      }, '🌐 调入全局'),
                      h('button', {
                        type: 'button',
                        className: 'dnb-mini-btn',
                        'data-tone': 'accent',
                        title: '带要求让参谋长递交给主对话或子代理',
                        onClick: () => openArchiveRelayModal([{ id: p.id, vaultScope: 'precipitated', title: p.title }]),
                      }, '📨 递话'),
                      h('button', {
                        type: 'button',
                        className: 'dnb-mini-btn',
                        style: { marginLeft: 'auto', color: '#ff453a' },
                        onClick: () => {
                          if (!confirm('确认永久删除沉淀条目《' + clampTitle(p.title, 20) + '》？')) return
                          void mutateArchiveApi({ op: 'deletePrecipitated', id: p.id, vaultScope: 'precipitated' }, '已删除沉淀条目')
                        },
                      }, '删除'),
                    ),
                  )
                }),
              ),
        )
      // Scope B: System Global Cold Vault (`global-vault/vault-chief-global.json`) + Local ↔ Global Bidirectional Diff
      : activeScope === 'global'
        ? (view.globalVaultStaleBlocked
            ? h(
                'div',
                {
                  className: 'dnb-group',
                  style: {
                    padding: '18px 14px',
                    textAlign: 'center',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 9,
                    alignItems: 'center',
                    borderColor: 'rgba(245, 158, 11, 0.45)',
                    background: 'rgba(245, 158, 11, 0.08)',
                  },
                },
                h('div', { style: { fontSize: 13, fontWeight: 700, color: '#f59e0b' } }, '⚠️ 检测到 DeepSeek Harness 宿主仍在运行旧版内存模块'),
                h('div', { style: { fontSize: 11.5, color: 'var(--dnb-text-2)', lineHeight: 1.55, maxWidth: 350 } },
                  '为防止旧后端接口将当前对话的本地档案误返回并串入全局柜，前端已主动拦截旧模块响应。请重启一次 DeepSeek Harness 客户端以启用 v1.2.0-r5 独立「系统全局冷库（global-vault）」。'),
                h('button', {
                  type: 'button',
                  className: 'dnb-mini-btn',
                  'data-tone': 'amber',
                  onClick: () => void loadArchives(true, '', 'global'),
                }, '重新检测宿主版本'),
              )
            : h(
                React.Fragment,
                null,
                // G1. System Global Cold Vault Status & Curation Banner (no session cab switcher / no current-turn harvest)
                h(
                  'div',
                  { className: 'dnb-vault-banner' },
                  h(
                    'div',
                    { style: { minWidth: 0 } },
                    h(
                      'div',
                      { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--dnb-text)' } },
                      h(Icon, { name: 'archive', size: 13.5, style: { color: 'var(--dnb-accent)' } }),
                      `🌐 系统全局档案柜 · ${globalItems.length} 卷`,
                    ),
                    h(
                      'div',
                      { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', marginTop: 1 } },
                      gMountedCount > 0
                        ? `本会话参谋参阅中 ${gMountedCount} 卷 · 其余 0 Token 冷封存 · 不随对话上下文跟跑`
                        : '系统级 0-Token 冷封存（不跟对话上下文跑）· 仅提问检索或手动挂载时参谋可见，主对话不可直读',
                    ),
                  ),
                  h(
                    'div',
                    { style: { display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' } },
                    h('button', {
                      type: 'button',
                      className: 'dnb-pill dnb-pill-accent',
                      style: { height: 26, padding: '0 9px', fontSize: 11 },
                      disabled: view.archiveOrganizing || globalItems.length === 0,
                      title: '请 DSH 参谋长精编整理系统全局冷库中的卷宗（原文 100% 无损保留）',
                      onClick: () => patch({ archiveOrganizeOpen: !view.archiveOrganizeOpen }),
                    },
                      view.archiveOrganizing
                        ? h(Icon, { name: 'refresh', size: 11.5, style: { animation: 'dnb-spin 0.9s linear infinite' } })
                        : h(Icon, { name: 'sparkles', size: 11.5 }),
                      view.archiveOrganizing ? '参谋长收纳中…' : '✦ 参谋一键整理',
                    ),
                    h('button', {
                      type: 'button',
                      className: 'dnb-pill',
                      style: { height: 26, padding: '0 9px', fontSize: 11 },
                      disabled: Boolean(view.archivePrecipitating) || globalItems.length === 0,
                      title: '从系统全局档案柜提炼通用经验进入 0-Token 沉淀冷库',
                      onClick: () => patch({
                        precipitateModal: {
                          op: 'cabinet',
                          vaultScope: 'global',
                          cabinetId: '',
                          label: '🌐 系统全局档案柜',
                          clearSource: false,
                        },
                      }),
                    }, '⏬ 沉淀可复用经验'),
                    h('button', {
                      type: 'button',
                      className: 'dnb-pill',
                      style: { height: 26, padding: '0 9px', fontSize: 11 },
                      onClick: () => patch({
                        archiveEditor: {
                          id: '',
                          vaultScope: 'global',
                          title: '',
                          summary: '',
                          folder: 'coords',
                          paperclip: 'silver',
                          tags: '',
                          body: '',
                        },
                      }),
                    }, h(Icon, { name: 'plus', size: 11.5 }), '新建全局档案'),
                  ),
                ),

                // G2. Collapsible Organize Command Deck & Inline Global Editor
                renderOrganizeDeck('global'),
                view.archiveEditor ? h(ArchiveEditorCard, { folders: globalFolders, editor: view.archiveEditor, defaultScope: 'global' }) : null,

                // G3. Local ↔ Global Bidirectional Diff Strip
                isBoundSession
                  ? h(
                      'div',
                      {
                        className: 'dnb-group',
                        style: { padding: '8px 10px', marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 6 },
                      },
                      h(
                        'div',
                        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' } },
                        h('span', { style: { fontSize: 11, fontWeight: 600, color: 'var(--dnb-text-2)' } }, '⇄ 本会话 ↔ 系统全局 双向差分'),
                        h(
                          'div',
                          { style: { display: 'flex', gap: 4, flexWrap: 'wrap' } },
                          [
                            { key: 'all', label: `全部 (${globalItems.length})` },
                            { key: 'global_only', label: `🌐 全局独有 (${gOnlyCount})` },
                            { key: 'synced', label: `✓ 双端已同步 (${gSyncedCount})` },
                            { key: 'differs', label: `⚡ 双端内容有异 (${gDiffersCount})` },
                            { key: 'mounted', label: `👁️ 参谋参阅中 (${gMountedCount})` },
                          ].map(opt =>
                            h('button', {
                              key: opt.key,
                              type: 'button',
                              className: 'dnb-mini-btn',
                              'data-tone': globalDiffFilter === opt.key ? 'accent' : undefined,
                              onClick: () => patch({ globalVaultDiffFilter: opt.key }),
                            }, opt.label),
                          ),
                        ),
                      ),
                      localBriefs.length > 0
                        ? h(
                            'div',
                            {
                              style: {
                                borderTop: '1px dashed var(--dnb-border)',
                                paddingTop: 6,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 5,
                              },
                            },
                            h(
                              'div',
                              {
                                style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, cursor: 'pointer', fontSize: 11.5 },
                                onClick: () => patch({ globalShowLocalOnlyDrawer: !view.globalShowLocalOnlyDrawer }),
                              },
                              h('span', { style: { color: '#f59e0b', fontWeight: 600 } },
                                `⇄ 本地差分：本会话尚有 ${diff.localOnlyCount || 0} 卷未入全局`
                                + ((diff.modifiedCount || 0) > 0 ? ` · ${diff.modifiedCount} 卷本地已改待更新` : '')),
                              h('span', { style: { color: 'var(--dnb-accent)', fontSize: 11, fontWeight: 600, flexShrink: 0 } },
                                view.globalShowLocalOnlyDrawer ? '收起 ∧' : '展开逐条推送 ∨'),
                            ),
                            view.globalShowLocalOnlyDrawer
                              ? h(
                                  'div',
                                  { style: { display: 'flex', flexDirection: 'column', gap: 4, marginTop: 2 } },
                                  localBriefs.map(b =>
                                    h(
                                      'div',
                                      {
                                        key: 'lb-' + b.id,
                                        style: {
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'space-between',
                                          gap: 8,
                                          padding: '5px 8px',
                                          borderRadius: 8,
                                          background: 'var(--dnb-elevated)',
                                          border: '1px solid var(--dnb-border)',
                                        },
                                      },
                                      h(
                                        'div',
                                        { style: { flex: 1, minWidth: 0 } },
                                        h(
                                          'div',
                                          { style: { display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 } },
                                          h('span', {
                                            className: 'dnb-tag',
                                            style: b.diffStatus === 'local_modified'
                                              ? { fontSize: 10, background: 'rgba(245, 158, 11, 0.16)', color: '#f59e0b', flexShrink: 0 }
                                              : { fontSize: 10, color: 'var(--dnb-text-3)', flexShrink: 0 },
                                          }, b.diffStatus === 'local_modified' ? '⚡ 本地已改' : '仅本会话'),
                                          h('span', {
                                            style: { fontSize: 11.5, fontWeight: 600, color: 'var(--dnb-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                                          }, b.title || '未命名卷宗'),
                                        ),
                                        b.summary
                                          ? h('div', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 } }, b.summary)
                                          : null,
                                      ),
                                      h('button', {
                                        type: 'button',
                                        className: 'dnb-mini-btn',
                                        'data-tone': b.diffStatus === 'local_modified' ? 'amber' : 'accent',
                                        style: { flexShrink: 0 },
                                        onClick: () => void mutateArchiveApi(
                                          { op: 'copyToGlobal', archiveId: b.id, vaultScope: 'session' },
                                          b.diffStatus === 'local_modified' ? '↻ 已将本地改动同步覆盖至系统全局冷库' : '🌐 已推送存入系统全局冷库（0 Token 冷封存）',
                                        ),
                                      }, b.diffStatus === 'local_modified' ? '↻ 覆盖更新全局' : '🌐 推送至全局'),
                                    ),
                                  ),
                                )
                              : null,
                          )
                        : null,
                    )
                  : null,

                // G4. Search & Clip Filters
                h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 } },
                  h(
                    'div',
                    { style: { display: 'flex', gap: 6, alignItems: 'center' } },
                    h('input', {
                      className: 'dnb-input',
                      style: { height: 28, borderRadius: 99, padding: '0 11px', fontSize: 11.5 },
                      placeholder: '筛选全局档案标题、标签、记忆点线索…',
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
                  h(
                    'div',
                    { style: { display: 'flex', gap: 4, flexWrap: 'wrap' } },
                    [
                      { key: 'all', label: '全部曲别针' },
                      { key: 'gold', label: '📎 核心金针' },
                      { key: 'silver', label: '标准银针' },
                      { key: 'copper', label: '历史铜针' },
                    ].map(c =>
                      h('button', {
                        key: c.key,
                        type: 'button',
                        className: 'dnb-mini-btn',
                        'data-tone': clipFilter === c.key ? 'accent' : undefined,
                        onClick: () => patch({ archiveFilterClip: c.key }),
                      }, c.label),
                    ),
                  ),
                ),

                // G5. Global Cold Vault Dossier Card List
                view.archiveLoading && !view.globalVaultLoaded
                  ? h(
                      'div',
                      { className: 'dnb-empty' },
                      h(Icon, { name: 'refresh', size: 14, style: { animation: 'dnb-spin 0.9s linear infinite', marginRight: 6 } }),
                      '正在读取系统全局冷库…',
                    )
                  : filteredGlobalItems.length === 0
                    ? h(
                        'div',
                        { className: 'dnb-group', style: { padding: '16px 14px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' } },
                        h('div', { style: { fontSize: 12.5, fontWeight: 600, color: 'var(--dnb-text)' } },
                          globalItems.length === 0 ? '🌐 系统全局冷库暂空' : '没有匹配的全局冷档案'),
                        h('div', { style: { fontSize: 11.5, color: 'var(--dnb-text-3)', lineHeight: 1.5, maxWidth: 340 } },
                          globalItems.length === 0
                            ? '系统全局档案柜保存在本机系统冷库（global-vault），默认不随任何对话上下文跟跑。您可点右上角「新建全局档案」录入，或从「💬 本会话档案柜」点「🌐 存入全局」推送沉淀。'
                            : '可尝试清空搜索词或切换上方差分筛选标签查看全部全局条目。'),
                      )
                    : h(
                        'div',
                        { style: { display: 'flex', flexDirection: 'column', gap: 7 } },
                        filteredGlobalItems.map((it, idx) =>
                          h(ArchiveDossierCard, {
                            key: 'glob-' + it.id,
                            item: it,
                            idx,
                            folders: globalFolders,
                            view,
                            scopeOverride: 'global',
                          }),
                        ),
                      ),

                renderPrecipFooter(),
              ))
      // Scope C: Unbound Blank Session Empty State (when activeScope === 'session' and no sessionId bound)
      : !isBoundSession
        ? h(
            'div',
            {
              className: 'dnb-group',
              style: { padding: '18px 14px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 9, alignItems: 'center' },
            },
            h('div', { style: { fontSize: 13, fontWeight: 700, color: 'var(--dnb-text)' } }, '💬 尚未进入具体会话 · 本会话档案柜暂未激活'),
            h('div', { style: { fontSize: 11.5, color: 'var(--dnb-text-2)', lineHeight: 1.55, maxWidth: 340 } },
              '为防止与历史窗口串柜，新建空白对话不会回退展示全局或其他对话的工作档案。在主对话发出第一条消息建立会话后，本会话专属档案柜即自动创建；您也可以先切到全局冷库或沉淀冷库。'),
            h(
              'div',
              { style: { display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center', marginTop: 2 } },
              h('button', {
                type: 'button',
                className: 'dnb-mini-btn',
                'data-tone': 'accent',
                onClick: () => switchScope('global'),
              }, `🌐 查看全局档案柜 (${globalBadgeCount})`),
              h('button', {
                type: 'button',
                className: 'dnb-mini-btn',
                onClick: () => switchScope('precipitated'),
              }, `🏛️ 查看沉淀冷库 (${precipBadgeCount})`),
            ),
          )
        // Scope D: Active Session Working Cabinet (1:1 isolated per root conversation)
        : h(
            React.Fragment,
            null,
            // 0. Session Cabinet Switcher Bar
            (() => {
              const cabinets = Array.isArray(view.archiveCabinets) && view.archiveCabinets.length
                ? view.archiveCabinets
                : [{
                    id: view.archiveCabinetId || '',
                    name: '本会话工作档案柜',
                    count: sessionItems.length,
                  }]
              const activeCabId = view.archiveCabinetId || (cabinets[0] && cabinets[0].id) || ''
              return h(
                'div',
                { className: 'dnb-cab-bar' },
                h('span', { style: { fontSize: 11.5, fontWeight: 600, color: 'var(--dnb-text-2)' } }, '本会话分柜：'),
                h('select', {
                  className: 'dnb-input',
                  style: { flex: 1, minWidth: 110, height: 26, padding: '0 8px', borderRadius: 8, fontSize: 11.5 },
                  value: activeCabId,
                  onChange: e => {
                    const nextCid = e.target.value
                    patch({ archiveCabinetId: nextCid })
                    void mutateArchiveApi({ op: 'switchCabinet', cabinetId: nextCid, vaultScope: 'session' }, '已切换工作档案柜')
                  },
                }, cabinets.map(c => {
                  const cabCount = (c.id === activeCabId && view.archiveSessionLoaded)
                    ? sessionItems.length
                    : (c.count ?? 0)
                  return h('option', { key: c.id, value: c.id }, `${c.name} (${cabCount})`)
                })),
                h('span', {
                  className: 'dnb-tag',
                  style: { fontSize: 10, background: 'rgba(16,185,129,0.12)', color: '#10b981', fontWeight: 600 },
                  title: '本会话档案柜按当前根会话严格隔离，绝不与其他对话混用',
                }, '🔒 仅限本对话'),
                h('button', {
                  type: 'button',
                  className: 'dnb-mini-btn',
                  onClick: () => patch({ archiveNewCabinetOpen: !view.archiveNewCabinetOpen }),
                }, '+ 新柜'),
                view.archiveNewCabinetOpen
                  ? h(
                      'div',
                      { style: { display: 'flex', gap: 5, width: '100%', marginTop: 2 } },
                      h('input', {
                        className: 'dnb-input',
                        style: { height: 26, fontSize: 11.5, borderRadius: 8, flex: 1 },
                        placeholder: '输入本会话新分柜名称（如：压测专项）…',
                        value: view.archiveNewCabinetName || '',
                        onChange: e => patch({ archiveNewCabinetName: e.target.value }),
                        onKeyDown: async e => {
                          if (e.key === 'Enter' && (view.archiveNewCabinetName || '').trim()) {
                            const nm = view.archiveNewCabinetName.trim()
                            patch({ archiveNewCabinetName: '', archiveNewCabinetOpen: false })
                            await mutateArchiveApi({ op: 'createCabinet', name: nm, vaultScope: 'session' }, `已新建并切入「${nm}」`)
                          }
                        },
                      }),
                      h('button', {
                        type: 'button',
                        className: 'dnb-primary-btn',
                        style: { height: 26, padding: '0 10px', fontSize: 11 },
                        onClick: async () => {
                          const nm = String(view.archiveNewCabinetName || '').trim()
                          if (!nm) return
                          patch({ archiveNewCabinetName: '', archiveNewCabinetOpen: false })
                          await mutateArchiveApi({ op: 'createCabinet', name: nm, vaultScope: 'session' }, `已新建并切入「${nm}」`)
                        },
                      }, '创建'),
                    )
                  : null,
              )
            })(),

            // 1. Top Session Vault Status & Chief Curation Bar
            h(
              'div',
              { className: 'dnb-vault-banner' },
              h(
                'div',
                { style: { minWidth: 0 } },
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--dnb-text)' } },
                  h(Icon, { name: 'archive', size: 13.5, style: { color: '#f59e0b' } }),
                  `工作卷宗 · ${totalCount} 卷`,
                ),
                h(
                  'div',
                  { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', marginTop: 1 } },
                  takenOutItems.length > 0
                    ? `本局已摆上桌面 ${takenOutItems.length} 卷（主对话与参谋长均可见）· 其余封存`
                    : '封存卷宗主对话不可见（参谋长后台关注）；点「📌 摆上桌面」即向主对话与参谋重点强调',
                ),
              ),
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' } },
                h('button', {
                  type: 'button',
                  className: 'dnb-pill',
                  style: { borderColor: 'rgba(16, 185, 129, 0.4)', color: '#10b981' },
                  disabled: Boolean(view.archiveHarvesting || !isBoundSession),
                  title: '从最近对话中抢救命令、文件路径、接口决策与踩坑细节并归档入本会话柜',
                  onClick: () => void harvestArchivesApi('', { vaultScope: 'session' }),
                }, view.archiveHarvesting ? '抢救中…' : '📥 抢救细节'),
                h('button', {
                  type: 'button',
                  className: 'dnb-pill',
                  style: { borderColor: 'rgba(10, 132, 255, 0.42)', color: 'var(--dnb-accent)' },
                  disabled: Boolean(view.distillBusy || !isBoundSession || sessionItems.length === 0),
                  title: '让参谋长从本局档案库摘除可跨对话复用的经验，总结提炼后存入全局档案柜（已勾选则优先按勾选提炼）',
                  onClick: () => {
                    const selSessionIds = selectedArchivesList
                      .filter(s => s && s.vaultScope === 'session')
                      .map(s => s.id)
                    patch({
                      distillGlobalModal: {
                        ids: selSessionIds.length > 0 ? selSessionIds : null,
                        instruction: '',
                        clearSource: false,
                      },
                    })
                  },
                }, view.distillBusy ? '提炼中…' : '✦ 提炼入全局'),
                h('button', {
                  type: 'button',
                  className: 'dnb-pill dnb-pill-accent',
                  disabled: view.archiveOrganizing,
                  title: '请 DSH 参谋长把本会话档案按抽屉分类、打曲别针等级，并拆成可展开的记忆点与小点记忆',
                  onClick: () => patch({ archiveOrganizeOpen: !view.archiveOrganizeOpen }),
                },
                  view.archiveOrganizing
                    ? h(Icon, { name: 'refresh', size: 11.5, style: { animation: 'dnb-spin 0.9s linear infinite' } })
                    : h(Icon, { name: 'sparkles', size: 11.5 }),
                  view.archiveOrganizing ? '参谋长收纳中…' : '✦ 参谋一键整理',
                ),
                null,
                h('button', {
                  type: 'button',
                  className: 'dnb-pill',
                  onClick: () => patch({
                    archiveEditor: {
                      id: '',
                      vaultScope: 'session',
                      title: '',
                      summary: '',
                      folder: 'coords',
                      paperclip: 'silver',
                      tags: '',
                      body: '',
                    },
                  }),
                }, h(Icon, { name: 'plus', size: 11.5 }), '建卷宗'),
              ),
            ),

            // 2. Collapsible Chief Organize Command Deck
            renderOrganizeDeck('session'),

            // 3. Inline Dossier Creator / Editor
            view.archiveEditor ? h(ArchiveEditorCard, { folders: drawerList, editor: view.archiveEditor, defaultScope: 'session' }) : null,

            // 4. Temporary Session Notes Precipitation Banner (session tab only)
            activeScope === 'session' && tempNotes.length > 0
              ? h(
                  'div',
                  {
                    className: 'dnb-group',
                    style: {
                      padding: '8px 11px',
                      marginBottom: 9,
                      borderColor: 'rgba(16, 185, 129, 0.38)',
                      background: 'rgba(16, 185, 129, 0.07)',
                    },
                  },
                  h(
                    'div',
                    { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
                    h(
                      'div',
                      { style: { fontSize: 11.5, color: 'var(--dnb-text)', lineHeight: 1.45 } },
                      h('strong', { style: { color: '#10b981' } }, `发现 ${tempNotes.length} 篇本轮临时便签`),
                      ' · 沉淀入本会话档案柜后即可分抽屉封存，不再每轮挤占提示词。',
                    ),
                    h('button', {
                      type: 'button',
                      className: 'dnb-mini-btn',
                      disabled: Boolean(view.archiveSweeping),
                      style: { borderColor: 'rgba(16, 185, 129, 0.45)', color: '#10b981', flexShrink: 0 },
                      onClick: async () => {
                        patch({ archiveSweeping: true })
                        try {
                          const noteIds = tempNotes.map(n => n && n.id).filter(Boolean)
                          await mutateArchiveApi(
                            { op: 'precipitateNotes', vaultScope: 'session', noteIds },
                            '已将临时便签封存入本会话档案柜',
                          )
                        } finally {
                          patch({ archiveSweeping: false })
                        }
                      },
                    }, h(Icon, { name: 'archive', size: 11 }), view.archiveSweeping ? '收纳中…' : '一键收纳入柜'),
                  ),
                )
              : null,

            // 5. Filter, Clip Selector & Drawer Master Controls
            h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 } },
              h(
                'div',
                { style: { display: 'flex', gap: 6, alignItems: 'center' } },
                h('input', {
                  className: 'dnb-input',
                  style: { height: 28, borderRadius: 99, padding: '0 11px', fontSize: 11.5 },
                  placeholder: '筛选档案标题、标签、记忆点线索…',
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
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 5, flexWrap: 'wrap' } },
                h(
                  'div',
                  { style: { display: 'flex', gap: 4, flexWrap: 'wrap' } },
                  [
                    { key: 'all', label: '全部' },
                    { key: 'gold', label: '📎 核心金针' },
                    { key: 'silver', label: '标准银针' },
                    { key: 'copper', label: '历史铜针' },
                  ].map(c =>
                    h('button', {
                      key: c.key,
                      type: 'button',
                      className: 'dnb-mini-btn',
                      'data-tone': clipFilter === c.key ? 'accent' : undefined,
                      onClick: () => patch({ archiveFilterClip: c.key }),
                    }, c.label),
                  ),
                ),
                h(
                  'div',
                  { style: { display: 'flex', gap: 4, alignItems: 'center' } },
                  h('button', {
                    type: 'button',
                    className: 'dnb-mini-btn',
                    onClick: () => patch({ archiveNewFolderOpen: !view.archiveNewFolderOpen }),
                  }, '+ 抽屉'),
                  h('button', {
                    type: 'button',
                    className: 'dnb-mini-btn',
                    onClick: toggleAllDrawers,
                  }, anyDrawerOpen ? '合上抽屉' : '拉开抽屉'),
                ),
              ),
              view.archiveNewFolderOpen
                ? h(
                    'div',
                    { style: { display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 } },
                    h('input', {
                      className: 'dnb-input',
                      style: { height: 27, fontSize: 11.5, borderRadius: 99, padding: '0 11px' },
                      placeholder: '新文件夹抽屉名称（如：云端网关与反代）…',
                      value: view.archiveNewFolderName || '',
                      onChange: e => patch({ archiveNewFolderName: e.target.value }),
                      onKeyDown: e => { if (e.key === 'Enter') void submitNewFolder() },
                    }),
                    h('button', {
                      type: 'button',
                      className: 'dnb-primary-btn',
                      style: { height: 27, padding: '0 11px', fontSize: 11 },
                      onClick: () => void submitNewFolder(),
                    }, '创建'),
                  )
                : null,
            ),

            // 7. Filing Cabinet Folder Drawers -> Pull Drawer to Unfold Paperclipped Dossiers
            view.archiveLoading && !view.archiveSessionLoaded
              ? h(
                  'div',
                  { className: 'dnb-empty' },
                  h(Icon, { name: 'refresh', size: 14, style: { animation: 'dnb-spin 0.9s linear infinite', marginRight: 6 } }),
                  '正在打开本会话工程档案柜…',
                )
              : visibleDrawers.length === 0
                ? h('div', { className: 'dnb-empty' },
                    query || clipFilter !== 'all'
                      ? '没有匹配的工程档案卷宗'
                      : '本会话档案柜暂空，可点击右上角「建卷宗」或「📥 抢救细节」收纳本对话工程记忆')
                : visibleDrawers.map(folder => {
                    const fItems = byFolder.get(folder.id) || []
                    const autoOpen = Boolean(query || clipFilter !== 'all')
                    const drawerOpen = autoOpen || Boolean(view.archiveOpenFolders && view.archiveOpenFolders[folder.id])
                    const accent = folder.accent || '#0a84ff'
                    const earTag = FOLDER_EAR_TAG[folder.id] || 'CABINET · 抽屉'
                    const goldCount = fItems.filter(it => it.paperclip === 'gold').length

                    return h(
                      'div',
                      {
                        key: folder.id,
                        className: 'dnb-cabinet-drawer',
                        'data-open': drawerOpen ? '1' : '0',
                      },
                      h(
                        'div',
                        { className: 'dnb-folder-ear' },
                        h('span', { style: { width: 6, height: 6, borderRadius: '50%', background: accent } }),
                        earTag,
                      ),
                      h(
                        'div',
                        { className: 'dnb-drawer-box' },
                        h(
                          'div',
                          {
                            className: 'dnb-drawer-front',
                            onClick: () => patch({
                              archiveOpenFolders: {
                                ...(view.archiveOpenFolders || {}),
                                [folder.id]: !drawerOpen,
                              },
                            }),
                            title: drawerOpen ? '点击推回合上抽屉' : '点击拉开抽屉逐条查看卷宗',
                          },
                          h('span', { className: 'dnb-drawer-spine', style: { background: accent } }),
                          h(Icon, {
                            name: drawerOpen ? 'folderOpen' : 'folder',
                            size: 16,
                            style: { color: accent },
                          }),
                          h(
                            'div',
                            { style: { flex: 1, minWidth: 0 } },
                            h(
                              'div',
                              { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                              h('span', { style: { fontWeight: 600, fontSize: 13, color: 'var(--dnb-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, folder.label),
                              goldCount > 0
                                ? h('span', {
                                    style: {
                                      fontSize: 10,
                                      padding: '0 5px',
                                      borderRadius: 99,
                                      background: 'rgba(245, 158, 11, 0.14)',
                                      color: '#f59e0b',
                                      fontWeight: 600,
                                      flexShrink: 0,
                                    },
                                  }, '📎 ' + goldCount)
                                : null,
                            ),
                            folder.hint
                              ? h('div', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 } }, folder.hint)
                              : null,
                          ),
                          h('span', { className: 'dnb-tag', style: { fontWeight: 600, flexShrink: 0 } }, fItems.length + ' 卷'),
                          h(
                            'span',
                            { className: 'dnb-drawer-handle' },
                            h(Icon, {
                              name: 'chevron',
                              size: 12,
                              style: {
                                transform: drawerOpen ? 'rotate(90deg)' : 'none',
                                transition: 'transform 0.18s ease',
                              },
                            }),
                          ),
                        ),
                        drawerOpen
                          ? h(
                              'div',
                              { className: 'dnb-drawer-well' },
                              h(
                                'div',
                                { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: '0 2px 2px' } },
                                h('span', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)' } },
                                  fItems.length ? '点击文件展开记忆点 · 再点记忆点展开小点记忆' : '此抽屉暂无卷宗'),
                                h(
                                  'div',
                                  { style: { display: 'flex', gap: 5 } },
                                  fItems.length > 0
                                    ? h('button', {
                                        type: 'button',
                                        className: 'dnb-mini-btn',
                                        'data-tone': 'accent',
                                        disabled: view.archiveOrganizing,
                                        onClick: () => void requestOrganizeArchives({ folder: folder.id, scope: 'folder', vaultScope: activeScope }),
                                      }, h(Icon, { name: 'sparkles', size: 10 }), '整理本抽屉')
                                    : null,
                                  fItems.length > 0 && activeScope === 'global'
                                    ? h('button', {
                                        type: 'button',
                                        className: 'dnb-mini-btn',
                                        disabled: view.archivePrecipitating,
                                        title: '仅全局档案可从抽屉提炼通用经验进入 0-Token 沉淀冷库（三级梯度制度）',
                                        onClick: () => patch({
                                          precipitateModal: {
                                            op: 'drawer',
                                            vaultScope: 'global',
                                            cabinetId: view.archiveCabinetId || '',
                                            folder: folder.id,
                                            label: '全局 ' + folder.label + '抽屉',
                                            clearSource: false,
                                          },
                                        }),
                                      }, '⏬ 沉淀')
                                    : null,
                                  h('button', {
                                    type: 'button',
                                    className: 'dnb-mini-btn',
                                    onClick: () => patch({
                                      archiveEditor: {
                                        id: '',
                                        vaultScope: 'session',
                                        title: '',
                                        summary: '',
                                        folder: folder.id,
                                        paperclip: 'silver',
                                        tags: '',
                                        body: '',
                                      },
                                    }),
                                  }, h(Icon, { name: 'plus', size: 10 }), '在此建卷'),
                                ),
                              ),
                              fItems.map((it, idx) =>
                                h(ArchiveDossierCard, {
                                  key: it.id,
                                  item: it,
                                  idx,
                                  folders: drawerList,
                                  view,
                                  scopeOverride: 'session',
                                }),
                              ),
                            )
                          : null,
                      ),
                    )
                  }),

            // Lightweight Footer Pointer to Precipitated Vault
            renderPrecipFooter(),
          ),
  )
}

/* ---------------------------------------------------------- Handoff Tab */
