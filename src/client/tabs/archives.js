/**
 * src/client/tabs/archives.js — 工程记忆档案四页总控页签
 *
 * 【核心职责】
 *   组织 📌 桌面 (Cognitive Desktop) | 🗂️ 本局 | 🌐 全局 | 🧊 冷藏 四页视图切换、
 *   顶部操作条、搜索/筛选状态及多选接力工具栏；单卡与文件夹抽屉组件已拆出至 `archives-cards.js`。
 *
 * 【导出】
 *   - `ArchiveTab({ board, view })`
 */

import { React, h } from '../react-runtime.js'
import { patch } from '../store.js'
import { bi } from '../i18n.js'
import {
  loadArchives,
  loadArchiveDetail,
  mutateArchiveApi,
  requestOrganizeArchives,
  harvestArchivesApi,
  clearSelectedArchives,
  openArchiveRelayModal,
  fetchVoiceInboxApi,
  dreamDigestVoiceInboxApi,
  deleteVoiceInboxApi,
  searchArchivesRemoteApi,
} from '../api.js'
import { Icon } from '../components/common.js'
import {
  ArchiveEditorCard,
  renderArchiveFolderDrawer,
  ArchiveDossierCard,
  ArchiveColdCard,
} from './archives-cards.js'

function isVoiceNoteArchive(it) {
  if (!it || typeof it !== 'object') return false
  if (String(it.title || '').includes('语音手记')) return true
  return Array.isArray(it.tags) && it.tags.some(t => /语音手记|^手记$/.test(String(t || '').trim()))
}

function quickClientBilingualHits(hay, query) {
  if (!query) return true
  if (hay.includes(query)) return true
  const segs = []
  const lat = query.match(/[a-z0-9][a-z0-9._-]*/g)
  if (lat) segs.push(...lat)
  const cjk = query.match(/[\u4e00-\u9fff]+/g)
  if (cjk) {
    for (const s of cjk) {
      if (s.length <= 2) { segs.push(s); continue }
      for (let i = 0; i < s.length - 1; i += 1) segs.push(s.slice(i, i + 2))
    }
  }
  if (!segs.length) return false
  let hits = 0
  for (const t of segs) {
    if (hay.includes(t)) hits += 1
  }
  return hits >= Math.max(1, Math.ceil(segs.length * 0.3))
}

export function ArchiveTab({ board, view }) {
  const [openMenuKey, setOpenMenuKey] = React.useState('')
  const [notesInboxBusy, setNotesInboxBusy] = React.useState(false)
  const [showVoiceInboxPath, setShowVoiceInboxPath] = React.useState(false)
  const [remoteSearch, setRemoteSearch] = React.useState({ scope: '', query: '', ids: null, order: null })
  const activeScope = ['desktop', 'session', 'global', 'notes', 'precipitated'].includes(view.archiveTabScope)
    ? view.archiveTabScope
    : 'desktop'
  const fetchScope = activeScope === 'desktop' ? 'session' : (activeScope === 'notes' ? 'global' : activeScope)
  const counts = view.archiveCounts || {}
  const isBoundSession = Boolean(view.sessionId && !view.archiveUnboundSession)

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      if (activeScope === 'notes' || !view.voiceInboxData) {
        void fetchVoiceInboxApi()
      }
      await loadArchives(false, '', fetchScope)
      if (cancelled) return
      if (fetchScope !== 'global' && !view.globalVaultLoaded) {
        await loadArchives(false, '', 'global')
      }
      if (!cancelled && activeScope === 'notes' && isBoundSession) {
        await loadArchives(false, '', 'session')
      }
    })()
    return () => { cancelled = true }
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

  React.useEffect(() => {
    const cleanQ = String(view.archiveQuery || '').trim()
    if (!cleanQ || (activeScope !== 'session' && activeScope !== 'global')) {
      setRemoteSearch({ scope: '', query: '', ids: null, order: null })
      return undefined
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await searchArchivesRemoteApi(cleanQ, activeScope)
          if (cancelled || !res || !res.ok || !Array.isArray(res.items)) return
          const ids = new Set()
          const order = new Map()
          res.items.forEach((it, idx) => {
            if (!it || !it.id) return
            ids.add(it.id)
            order.set(it.id, idx)
          })
          setRemoteSearch({ scope: activeScope, query: cleanQ.toLowerCase(), ids, order })
        } catch {}
      })()
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [view.archiveQuery, activeScope, view.sessionId, view.archiveCabinetId, sessionItems.length, globalItems.length])

  const sessionNoteItems = sessionItems.filter(isVoiceNoteArchive)
  const sessionRegularItems = sessionItems.filter(it => !isVoiceNoteArchive(it))
  const globalNoteItems = globalItems.filter(isVoiceNoteArchive)
  const globalRegularItems = globalItems.filter(it => !isVoiceNoteArchive(it))
  const seenNoteIds = new Set()
  const allNoteArchiveItems = []
  for (const it of globalNoteItems) {
    if (!it || !it.id || seenNoteIds.has(it.id)) continue
    seenNoteIds.add(it.id)
    allNoteArchiveItems.push({ ...it, vaultScope: 'global' })
  }
  for (const it of sessionNoteItems) {
    if (!it || !it.id || seenNoteIds.has(it.id)) continue
    seenNoteIds.add(it.id)
    allNoteArchiveItems.push({ ...it, vaultScope: 'session' })
  }
  allNoteArchiveItems.sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))

  const vData = view.voiceInboxData || null
  const vPending = Array.isArray(vData && vData.pending) ? vData.pending : []
  const vPendingCount = vData ? (Number(vData.pendingCount) || 0) : 0
  const vProcessedCount = vData ? (Number(vData.processedCount) || 0) : 0

  const sessionBadgeCount = isBoundSession
    ? (view.archiveSessionLoaded ? sessionRegularItems.length : Number(counts.sessionCount || 0))
    : 0
  const globalBadgeCount = view.globalVaultLoaded ? globalRegularItems.length : Number(counts.globalCount || 0)
  const notesBadgeCount = vPendingCount + allNoteArchiveItems.length
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
    if (nextScope === 'notes') {
      void fetchVoiceInboxApi()
      void (async () => {
        await loadArchives(true, '', 'global')
        if (isBoundSession) await loadArchives(true, '', 'session')
      })()
      return
    }
    void loadArchives(true, '', nextScope === 'desktop' ? 'session' : nextScope)
  }

  const activeRemoteSearch = remoteSearch
    && remoteSearch.ids instanceof Set
    && remoteSearch.scope === activeScope
    && remoteSearch.query === query
    ? remoteSearch
    : null

  const matchesArchiveFilter = it => {
    if (!it) return false
    if (clipFilter !== 'all' && it.paperclip !== clipFilter) return false
    if (!query) return true
    if (activeRemoteSearch) return activeRemoteSearch.ids.has(it.id)
    const hay = [
      it.title,
      it.summary,
      it.hookCue,
      (it.hookKeywords || []).join(' '),
      (it.tags || []).join(' '),
      (it.pointPreviews || []).join(' '),
    ].join(' ').toLowerCase()
    return quickClientBilingualHits(hay, query)
  }

  const sortByBm25IfReady = list => {
    if (!activeRemoteSearch || !activeRemoteSearch.order) return list
    return list.slice().sort((a, b) => {
      const ia = activeRemoteSearch.order.has(a.id) ? activeRemoteSearch.order.get(a.id) : 999999
      const ib = activeRemoteSearch.order.has(b.id) ? activeRemoteSearch.order.get(b.id) : 999999
      return ia - ib
    })
  }

  const jumpToLinkedArchive = (targetId, targetFolder = '', targetScope = '') => {
    const cleanId = String(targetId || '').trim()
    if (!cleanId) return
    const nextScope = targetScope || (activeScope === 'global' ? 'global' : 'session')
    const folderKey = nextScope === 'global' && targetFolder ? ('global:' + targetFolder) : targetFolder
    patch({
      ...(nextScope !== activeScope ? { archiveTabScope: nextScope } : {}),
      archiveQuery: '',
      archiveOpenFolders: {
        ...(view.archiveOpenFolders || {}),
        ...(folderKey ? { [folderKey]: true } : {}),
      },
      archiveOpenFiles: {
        ...(view.archiveOpenFiles || {}),
        [cleanId]: true,
      },
    })
    void loadArchiveDetail(cleanId, true, { scope: nextScope })
  }

  const filteredItems = sortByBm25IfReady(sessionRegularItems.filter(matchesArchiveFilter))
  const filteredGlobalItems = sortByBm25IfReady(globalRegularItems.filter(it => {
    if (!matchesArchiveFilter(it)) return false
    if (!isBoundSession || globalDiffFilter === 'all') return true
    if (globalDiffFilter === 'mounted') return Boolean(it.chiefMounted)
    if (globalDiffFilter === 'global_only') return it.diffStatus === 'global_only'
    if (globalDiffFilter === 'synced') return it.diffStatus === 'synced'
    if (globalDiffFilter === 'differs') return it.diffStatus === 'differs'
    return true
  }))
  const filteredNoteArchives = allNoteArchiveItems.filter(matchesArchiveFilter)
  const filteredPrecip = precipList.filter(p => {
    if (!p) return false
    if (!query) return true
    const hay = [p.title, p.summary, p.category, p.hookCue, (p.hookKeywords || []).join(' '), (p.tags || []).join(' ')].join(' ').toLowerCase()
    return quickClientBilingualHits(hay, query)
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
          h(
            'div',
            { className: 'dnb-more-wrap', onClick: e => e.stopPropagation() },
            h('button', {
              type: 'button',
              className: 'dnb-mini-btn',
              title: bi('桌面扩容与操作', 'Desktop capacity & actions'),
              onClick: () => setOpenMenuKey(deskMenuOpen ? '' : 'desk-more'),
            }, '⋯'),
            deskMenuOpen
              ? h(
                  'div',
                  { className: 'dnb-more-menu', style: { minWidth: 224 } },
                  h('div', { style: { padding: '4px 9px 3px', fontSize: 10.5, fontWeight: 600, color: 'var(--dnb-text-3)' } },
                    bi(`📐 桌面容量（当前 ${maxItems} 份 / ${tokenBudget.toLocaleString()}t）`, `📐 Capacity (${maxItems} items / ${tokenBudget.toLocaleString()}t)`)),
                  [
                    { maxItems: 6, tokenBudget: 2400, zh: '标准 · 6 份 / 2,400t', en: 'Standard · 6 / 2,400t' },
                    { maxItems: 10, tokenBudget: 4000, zh: '宽敞 · 10 份 / 4,000t', en: 'Roomy · 10 / 4,000t' },
                    { maxItems: 16, tokenBudget: 6400, zh: '大桌 · 16 份 / 6,400t', en: 'Wide · 16 / 6,400t' },
                    { maxItems: 24, tokenBudget: 9600, zh: '巨幕 · 24 份 / 9,600t', en: 'Max · 24 / 9,600t' },
                  ].map(preset => {
                    const isCur = maxItems === preset.maxItems && tokenBudget === preset.tokenBudget
                    return h('button', {
                      key: preset.maxItems,
                      type: 'button',
                      className: 'dnb-more-item',
                      style: { justifyContent: 'space-between', fontWeight: isCur ? 650 : 400, color: isCur ? 'var(--dnb-accent)' : undefined },
                      onClick: () => {
                        setOpenMenuKey('')
                        void mutateArchiveApi(
                          { op: 'setDesktopCapacity', vaultScope: 'session', maxItems: preset.maxItems, tokenBudget: preset.tokenBudget },
                          bi(`📐 认知桌面已扩为 ${preset.maxItems} 份 / ${preset.tokenBudget.toLocaleString()}t`, `📐 Desktop set to ${preset.maxItems} / ${preset.tokenBudget}t`),
                        )
                      },
                    },
                    h('span', null, bi(preset.zh, preset.en)),
                    isCur ? h('span', null, '✓') : null)
                  }),
                  h(
                    'div',
                    {
                      style: {
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                        padding: '5px 8px',
                        marginTop: 2,
                        borderTop: '1px solid var(--dnb-border)',
                        fontSize: 11,
                        color: 'var(--dnb-text-2)',
                      },
                    },
                    h(
                      'div',
                      { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 } },
                      h('span', null, bi('最多份数', 'Max items')),
                      h(
                        'div',
                        { style: { display: 'flex', alignItems: 'center', gap: 4 } },
                        h('button', {
                          type: 'button',
                          className: 'dnb-mini-btn',
                          disabled: maxItems <= 4,
                          onClick: () => void mutateArchiveApi({ op: 'setDesktopCapacity', vaultScope: 'session', maxItems: Math.max(4, maxItems - 2), tokenBudget }),
                        }, '−'),
                        h('span', { style: { minWidth: 32, textAlign: 'center', fontWeight: 600 } }, `${maxItems}${bi('份', '')}`),
                        h('button', {
                          type: 'button',
                          className: 'dnb-mini-btn',
                          disabled: maxItems >= 24,
                          onClick: () => void mutateArchiveApi({ op: 'setDesktopCapacity', vaultScope: 'session', maxItems: Math.min(24, maxItems + 2), tokenBudget }),
                        }, '+'),
                      ),
                    ),
                    h(
                      'div',
                      { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 } },
                      h('span', null, bi('字数上限', 'Token cap')),
                      h(
                        'div',
                        { style: { display: 'flex', alignItems: 'center', gap: 4 } },
                        h('button', {
                          type: 'button',
                          className: 'dnb-mini-btn',
                          disabled: tokenBudget <= 1200,
                          onClick: () => void mutateArchiveApi({ op: 'setDesktopCapacity', vaultScope: 'session', maxItems, tokenBudget: Math.max(1200, tokenBudget - 800) }),
                        }, '−'),
                        h('span', { style: { minWidth: 44, textAlign: 'center', fontWeight: 600 } }, `${tokenBudget}t`),
                        h('button', {
                          type: 'button',
                          className: 'dnb-mini-btn',
                          disabled: tokenBudget >= 12000,
                          onClick: () => void mutateArchiveApi({ op: 'setDesktopCapacity', vaultScope: 'session', maxItems, tokenBudget: Math.min(12000, tokenBudget + 800) }),
                        }, '+'),
                      ),
                    ),
                  ),
                  deskPinned.length > 0
                    ? h(
                        React.Fragment,
                        null,
                        h('div', { style: { height: 1, background: 'var(--dnb-border)', margin: '3px 0' } }),
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
                      )
                    : null,
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
          ),
        ),
      ),
      h('div', { className: 'dnb-token-track', title: bi(`认知桌面：每轮发给主对话的资料（${usedTokens}/${tokenBudget} Tokens）`, `Cognitive Desktop: sent each turn (${usedTokens}/${tokenBudget} tokens)`) },
        h('div', { className: 'dnb-token-fill', 'data-warn': warnLevel, style: { width: Math.max(deskPinned.length ? 4 : 0, usagePct) + '%' } }),
      ),
      deskPinned.length === 0
        ? h(
            'div',
            { style: { padding: '22px 10px 16px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' } },
            h('div', { style: { fontSize: 12, color: 'var(--dnb-text-2)' } }, bi(`认知桌面是空的：这里放的资料每轮都会发给主对话（最多 ${maxItems} 份 / ${tokenBudget.toLocaleString()} Tokens）`, `Desktop is empty. Pinned items are sent each turn (up to ${maxItems} / ${tokenBudget.toLocaleString()} tokens).`)),
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
              onClick: () => {
                const allGlobalWatch = watchList.length > 0
                  && watchList.every(w => w && (w.vaultScope === 'global' || String(w.id || '').startsWith('glob-')))
                void requestOrganizeArchives({
                  vaultScope: allGlobalWatch ? 'global' : 'session',
                  ids: watchList.map(w => w.id),
                  dream: true,
                  instruction: '请整理撤下桌面的卷宗归入抽屉并织就线索钩子',
                })
              },
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
          title: bi(`全局档案 · ${globalRegularItems.length} 份`, `Global Vault · ${globalRegularItems.length}`),
          sub: isBoundSession ? bi(`参谋参阅 ${globalRegularItems.filter(it => it && it.chiefMounted).length}`, `Chief Ref ${globalRegularItems.filter(it => it && it.chiefMounted).length}`) : '',
          hint: bi('跨对话共用的工程资料。打标签后参谋长可按需查看，不发给主对话。', 'Shared across chats. Chief reads tagged notes on demand; never sent to main chat.'),
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
            title: bi(`本局档案 · ${sessionRegularItems.length} 份`, `Session Vault · ${sessionRegularItems.length}`),
            sub: isBoundSession && sessionRegularItems.some(it => it && it.leadPulled)
              ? bi(`主拉 ${sessionRegularItems.filter(it => it && it.leadPulled).length}`, `Pulled ${sessionRegularItems.filter(it => it && it.leadPulled).length}`)
              : '',
            hint: bi('仅限当前对话的工程资料。打标签后主对话可按需查看。', 'For this chat only. Main chat can pull tagged notes on demand.'),
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
              disabled: view.archiveOrganizing || (activeScope === 'session' ? (!isBoundSession || sessionRegularItems.length === 0) : globalRegularItems.length === 0),
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
          placeholder: bi('搜标题、正文或长句（支持中文智能分词）…', 'Search titles, body, or bilingual phrases…'),
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
                    onJumpToArchive: (id, fId) => jumpToLinkedArchive(id, fId, 'session'),
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
          ? h('div', { className: 'dnb-empty' }, globalRegularItems.length === 0 ? bi('全局工程档案还是空的。语音手记已独立放在「🎙️ 手记」页签里。', 'Global engineering vault is empty. Voice notes live in the Voice Notes subtab.') : bi('没有找到匹配的全局档案', 'No matching global notes'))
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
                  onJumpToArchive: (id, fId) => jumpToLinkedArchive(id, fId, 'global'),
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

  // ── Page 3.5: Dedicated Voice Notes & Manuscripts (`notes`) ──
  const runNotesDreamDigest = async () => {
    if (notesInboxBusy) return
    setNotesInboxBusy(true)
    try {
      const res = await dreamDigestVoiceInboxApi()
      await Promise.all([
        fetchVoiceInboxApi(),
        loadArchives(true, '', 'global'),
        ...(isBoundSession ? [loadArchives(true, '', 'session')] : []),
      ])
      if (res && res.ok) {
        patch({
          notice: res.voiceProcessed > 0
            ? bi(`🌙 梦境整理完成：消化 ${res.voiceProcessed} 条语音手记`, `🌙 Dream Roam digested ${res.voiceProcessed} voice note(s)`)
            : bi('🌙 当前没有待整理的语音手记', '🌙 Voice Inbox is already clean'),
        })
      }
    } finally {
      setNotesInboxBusy(false)
    }
  }

  const renderNotesPage = () => h(
    React.Fragment,
    null,
    h(
      'div',
      { className: 'dnb-strip-bar', style: { '--dnb-strip-color': '#a855f7', flexWrap: 'wrap', rowGap: 6, height: 'auto' } },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0, flexWrap: 'wrap', flex: '1 1 160px' } },
        h('span', { style: { fontSize: 12.5, fontWeight: 600, color: 'var(--dnb-text)', whiteSpace: 'nowrap' } },
          bi(`🎙️ 语音手记 · ${allNoteArchiveItems.length} 份文稿`, `🎙️ Voice Notes · ${allNoteArchiveItems.length}`)),
        h('span', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', whiteSpace: 'nowrap' } },
          bi(`· 待整理 ${vPendingCount} · 已消化 ${vProcessedCount}`, `· ${vPendingCount} pending · ${vProcessedCount} digested`)),
      ),
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, marginLeft: 'auto', flexWrap: 'wrap' } },
        h('button', {
          type: 'button',
          className: 'dnb-icon-btn',
          'data-active': view.archiveSearchOpen ? '1' : '0',
          style: { width: 24, height: 24 },
          title: bi('搜索手记文稿', 'Search voice notes'),
          onClick: () => patch({ archiveSearchOpen: !view.archiveSearchOpen }),
        }, h(Icon, { name: 'search', size: 13 })),
        vPendingCount > 0
          ? h('button', {
              type: 'button',
              className: 'dnb-mini-btn',
              'data-tone': 'accent',
              disabled: notesInboxBusy,
              onClick: () => void runNotesDreamDigest(),
            }, notesInboxBusy ? bi('整理中…', 'Dreaming…') : bi('🌙 梦境整理', '🌙 Dream Digest'))
          : null,
        h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: { height: 24, padding: '0 9px', fontSize: 11 },
          onClick: () => patch({
            archiveEditor: {
              id: '',
              vaultScope: 'global',
              title: '',
              summary: '',
              folder: 'inbox',
              paperclip: 'silver',
              tags: '语音手记',
              body: '',
            },
          }),
        }, bi('+ 写手记', '+ Write Note')),
      ),
    ),

    renderSearchAndFilterStrip(),
    view.archiveEditor ? h(ArchiveEditorCard, { folders: globalFolders, editor: view.archiveEditor, defaultScope: 'global' }) : null,

    // Section 1: Pending Voice Transcripts Inbox
    h(
      'div',
      { className: 'dnb-voice-inbox-card', style: { marginBottom: 10 } },
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            padding: '8px 10px',
            flexWrap: 'wrap',
          },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
          h(Icon, { name: 'mic', size: 13, style: { color: 'var(--dnb-accent)' } }),
          h('span', { style: { fontSize: 12, fontWeight: 600, color: 'var(--dnb-text)' } },
            bi('待整理语音收件区', 'Pending Voice Inbox')),
          h('span', { className: 'dnb-acc-badge', 'data-tone': vPendingCount > 0 ? 'accent' : undefined, style: { fontSize: 10 } },
            bi(`待整理 ${vPendingCount} · 已消化 ${vProcessedCount}`, `${vPendingCount} pending · ${vProcessedCount} digested`)),
        ),
        vData && vData.dir
          ? h('button', {
              type: 'button',
              className: 'dnb-mini-btn',
              style: { fontSize: 10.5 },
              onClick: () => setShowVoiceInboxPath(v => !v),
            }, showVoiceInboxPath ? bi('▾ 隐藏路径', '▾ Hide path') : bi('📁 文件位置', '📁 Folder'))
          : null,
      ),
      showVoiceInboxPath && vData && vData.dir
        ? h('div', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', padding: '0 10px 6px', wordBreak: 'break-all' } },
            `${bi('存放目录：', 'Directory: ')}${vData.dir}`)
        : null,
      vData && vData.lastDigest && vData.lastDigest.processedCount > 0
        ? h('div', { style: { fontSize: 10.5, color: 'var(--dnb-sage)', padding: '0 10px 6px' } },
            bi(`最近梦境整理：消化 ${vData.lastDigest.processedCount} 条 → ${(vData.lastDigest.targets || []).join(' · ')}`,
              `Last Dream Roam: ${vData.lastDigest.processedCount} notes → ${(vData.lastDigest.targets || []).join(' · ')}`))
        : null,
      vPending.length > 0
        ? vPending.map(row =>
            h(
              'div',
              { key: row.id, className: 'dnb-voice-inbox-row' },
              h(
                'div',
                { style: { flex: 1, minWidth: 0 } },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 } },
                  h('span', { className: 'dnb-acc-badge', style: { fontSize: 9.5 } },
                    row.mode === 'voice_chat' ? bi('✨ 语音唠嗑', '✨ Voice Chat') : bi('🎤 语音输入', '🎤 Dictation')),
                  h('span', { style: { fontSize: 10, color: 'var(--dnb-text-3)' } }, row.provider || ''),
                ),
                h('div', { style: { color: 'var(--dnb-text)', lineHeight: 1.45, wordBreak: 'break-word' } }, row.preview || ''),
                row.replyPreview
                  ? h('div', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', marginTop: 3 } }, `↳ ${row.replyPreview}`)
                  : null,
              ),
              h('button', {
                type: 'button',
                className: 'dnb-mini-btn',
                style: { color: 'var(--dnb-coral, #f28b88)', flexShrink: 0 },
                onClick: () => void deleteVoiceInboxApi(row.id),
              }, h(Icon, { name: 'trash', size: 11 })),
            ))
        : h('div', { style: { padding: '6px 10px 8px', fontSize: 11, color: 'var(--dnb-text-3)', borderTop: '1px solid var(--dnb-border)' } },
            bi('当前暂无待整理的语音转写；语音输入或语音唠嗑内容会先落入此处，梦境整理后归档到下方文稿。',
              'No pending voice transcripts. Voice dictation/chat queues here until digested into manuscripts below.')),
    ),

    // Section 2: Archived Voice Note Manuscripts
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, margin: '4px 2px 6px', flexWrap: 'wrap' } },
      h('span', { style: { fontSize: 11.5, fontWeight: 600, color: 'var(--dnb-text-2)' } },
        bi(`📄 已归档手记文稿 (${filteredNoteArchives.length})`, `📄 Voice Manuscripts (${filteredNoteArchives.length})`)),
      h('span', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)' } },
        bi('日后随时展开阅读，或点右上角「钉上桌面 / 记入记忆」', 'Expand to read anytime or pin to Desk / Memory')),
    ),
    (view.archiveLoading && !view.globalVaultLoaded)
      ? h('div', { className: 'dnb-empty' }, bi('正在加载手记文稿…', 'Loading voice notes…'))
      : filteredNoteArchives.length === 0
        ? h('div', { className: 'dnb-empty' },
            allNoteArchiveItems.length === 0
              ? bi('还没有已归档的语音手记文稿。使用语音聊天/输入并经梦境整理，或点上方「+ 写手记」即可沉淀到这里。',
                  'No archived voice manuscripts yet. Use Voice Mode or click "+ Write Note" above.')
              : bi('没有找到匹配的手记文稿', 'No matching voice notes'))
        : h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            filteredNoteArchives.map((it, idx) =>
              h(ArchiveDossierCard, {
                key: 'vnote-' + it.vaultScope + '-' + it.id,
                item: it,
                idx,
                folders: globalFolders,
                view,
                scopeOverride: it.vaultScope || 'global',
                openMenuKey,
                setOpenMenuKey,
                onJumpToArchive: (id, fId) => jumpToLinkedArchive(id, fId, it.vaultScope || 'global'),
              })),
          ),
  )

  return h(
    'div',
    { className: 'dnb-view' },

    // Clean 5-Tab Vault Segmented Bar (`📌 桌面 | 🗂️ 本局 | 🌐 全局 | 🎙️ 手记 | 🧊 冷藏`)
    h(
      'div',
      { className: 'dnb-vault-seg', role: 'tablist', 'aria-label': bi('桌面和档案手记', 'Desktop, Vaults and Notes') },
      [
        { key: 'desktop', label: bi('📌 桌面', '📌 Desk'), count: deskPinned.length },
        { key: 'session', label: bi('🗂️ 本局', '🗂️ Session'), count: sessionBadgeCount },
        { key: 'global', label: bi('🌐 全局', '🌐 Global'), count: globalBadgeCount },
        { key: 'notes', label: bi('🎙️ 手记', '🎙️ Notes'), count: notesBadgeCount },
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
            'data-scope': seg.key,
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
        : activeScope === 'notes'
          ? renderNotesPage()
          : activeScope === 'precipitated'
            ? renderColdPage()
            : renderSessionPage(),
  )
}
