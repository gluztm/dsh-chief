/**
 * src/client/api/archives.js — 工程记忆档案柜、沉淀/整理/蒸馏与接力转送 API
 *
 * 【核心职责】
 *   承载档案列表加载与详情缓存（`loadArchives` / `loadArchiveDetail`）、归档变更与 AI 自动整理、
 *   每轮经验收割与沉淀至全局冷库（`harvestArchivesApi` / `precipitateArchivesApi`）、
 *   档案跨窗口接力转送、冷库检索，以及目标变更审批/驳回接口。
 *
 * 【边界约定】
 *   - 依赖 `./transport.js` 与 `./board.js`；模块加载时向 `apiBridge` 注册档案头同步与刷新钩子。
 */

import { store, patch } from '../store.js'
import { shortAgentName, sessionIdFromUrl } from '../utils.js'
import { apiBridge, call, withChiefWorkFx } from './transport.js'
import { refresh, act, searchBoard, askLeadModel } from './board.js'

export function applyArchiveHeaders(payload, invalidateIds = null, requestedScope = '') {
  if (!payload || typeof payload !== 'object') return
  const isSystemGlobalResp = payload.isSystemGlobalVault === true
  const targetScope = String(
    requestedScope
    || payload.requestedScope
    || payload.vaultScope
    || payload.scope
    || ''
  ).toLowerCase()

  // Hard anti-bleed guard: if Global vault was requested but running host lacks `isSystemGlobalVault: true` (stale memory module),
  // block writing into `globalVaultItems` or `archiveItems` so local items NEVER bleed into Global!
  if (targetScope === 'global' && !isSystemGlobalResp) {
    patch({
      globalVaultLoaded: false,
      globalVaultItems: [],
      globalVaultStaleBlocked: true,
      staleBackendDetected: true,
    })
    return
  }

  const items = Array.isArray(payload.items) ? payload.items : []
  const folders = Array.isArray(payload.folders)
    ? payload.folders
    : (isSystemGlobalResp ? store.globalVaultFolders : store.archiveFolders)
  const precipitated = Array.isArray(payload.precipitated) ? payload.precipitated : store.archivePrecipitated
  const flippedPrecipitatedIds = Array.isArray(payload.flippedPrecipitatedIds)
    ? payload.flippedPrecipitatedIds
    : store.flippedPrecipitatedIds
  const nextCounts = (payload.counts && typeof payload.counts === 'object')
    ? { ...(store.archiveCounts || {}), ...payload.counts }
    : (store.archiveCounts || {})
  const nextDiffSummary = (payload.diffSummary && typeof payload.diffSummary === 'object')
    ? payload.diffSummary
    : store.archiveDiffSummary

  let nextDetails = store.archiveDetails || {}
  if (Array.isArray(invalidateIds) && invalidateIds.length) {
    nextDetails = { ...nextDetails }
    for (const id of invalidateIds) delete nextDetails[id]
  }
  if (Object.keys(nextDetails).length > 0 && items.length > 0) {
    let touched = false
    const headerMap = new Map(items.map(it => [it.id, it]))
    const synced = { ...nextDetails }
    for (const [id, det] of Object.entries(synced)) {
      const hdr = headerMap.get(id)
      if (!hdr) continue
      if (
        det.takenOut !== hdr.takenOut
        || det.chiefMounted !== hdr.chiefMounted
        || det.paperclip !== hdr.paperclip
        || det.folder !== hdr.folder
        || det.updatedAt !== hdr.updatedAt
      ) {
        if (det.updatedAt !== hdr.updatedAt) {
          delete synced[id]
        } else {
          synced[id] = {
            ...det,
            takenOut: hdr.takenOut,
            chiefMounted: hdr.chiefMounted,
            paperclip: hdr.paperclip,
            folder: hdr.folder,
          }
        }
        touched = true
      }
    }
    if (touched) nextDetails = synced
  }

  if (isSystemGlobalResp) {
    patch({
      archiveLoaded: true,
      globalVaultLoaded: true,
      globalVaultStaleBlocked: false,
      globalVaultFolders: folders,
      globalVaultItems: items,
      archivePrecipitated: precipitated,
      ...(Array.isArray(payload.precipitatedFolders) ? { precipitatedFolders: payload.precipitatedFolders } : {}),
      ...(payload.precipitatedViewerSummary ? { precipitatedViewerSummary: payload.precipitatedViewerSummary } : {}),
      ...(payload.desktop && typeof payload.desktop === 'object' ? { archiveDesktop: payload.desktop } : {}),
      ...(payload.viewerSummary && typeof payload.viewerSummary === 'object' ? { archiveViewerSummary: payload.viewerSummary } : {}),
      flippedPrecipitatedIds,
      archiveCounts: nextCounts,
      archiveDiffSummary: nextDiffSummary,
      archiveDetails: nextDetails,
      ...(Array.isArray(payload.deskItems) ? { archiveDeskItems: payload.deskItems, archiveDeskLoaded: true } : {}),
    })
    return
  }

  const cabinets = Array.isArray(payload.cabinets) ? payload.cabinets : store.archiveCabinets
  const activeCabinetId = payload.activeCabinetId !== undefined
    ? String(payload.activeCabinetId || '')
    : (store.archiveCabinetId || '')
  const projectKey = payload.projectKey !== undefined ? String(payload.projectKey || '') : (store.archiveProjectKey || '')
  const unboundSession = typeof payload.unboundSession === 'boolean'
    ? payload.unboundSession
    : Boolean(nextCounts && nextCounts.unboundSession)
  const openFolders = { ...(store.archiveOpenFolders || {}) }
  if (!store.archiveSessionLoaded && Object.keys(openFolders).length === 0) {
    const firstNonEmpty = folders.find(f => f && f.count > 0)
    if (firstNonEmpty) openFolders[firstNonEmpty.id] = true
  }

  patch({
    archiveLoaded: true,
    archiveSessionLoaded: true,
    archiveProjectKey: projectKey,
    archiveCabinetId: activeCabinetId,
    archiveCabinets: cabinets,
    archiveFolders: folders,
    archiveItems: items,
    archivePrecipitated: precipitated,
    ...(Array.isArray(payload.precipitatedFolders) ? { precipitatedFolders: payload.precipitatedFolders } : {}),
    ...(payload.precipitatedViewerSummary ? { precipitatedViewerSummary: payload.precipitatedViewerSummary } : {}),
    ...(payload.desktop && typeof payload.desktop === 'object' ? { archiveDesktop: payload.desktop } : {}),
    ...(payload.viewerSummary && typeof payload.viewerSummary === 'object' ? { archiveViewerSummary: payload.viewerSummary } : {}),
    flippedPrecipitatedIds,
    archiveCounts: nextCounts,
    archiveDiffSummary: nextDiffSummary,
    archiveUnboundSession: unboundSession,
    archiveOpenFolders: openFolders,
    archiveDetails: nextDetails,
    ...(Array.isArray(payload.deskItems) ? { archiveDeskItems: payload.deskItems, archiveDeskLoaded: true } : {}),
  })
}

function scopeValidArchiveIds(scope) {
  if (scope === 'global') {
    return new Set((Array.isArray(store.globalVaultItems) ? store.globalVaultItems : []).map(x => x && x.id).filter(Boolean))
  }
  if (scope === 'precipitated') {
    return new Set((Array.isArray(store.archivePrecipitated) ? store.archivePrecipitated : []).map(x => x && x.id).filter(Boolean))
  }
  return new Set((Array.isArray(store.archiveItems) ? store.archiveItems : []).map(x => x && x.id).filter(Boolean))
}

/** Tier-1 Lazy Load: called ONLY when the user opens or switches scope in the `档案` tab */
export async function loadArchives(force = false, cabinetIdOverride = '', scopeOverride = '') {
  if (store.archiveLoading) return null
  const rawScope = scopeOverride || store.archiveTabScope || 'desktop'
  const activeScope = rawScope === 'desktop' ? 'session' : rawScope
  const alreadyLoaded = activeScope === 'global'
    ? store.globalVaultLoaded
    : (activeScope === 'precipitated' ? store.archiveLoaded : store.archiveSessionLoaded)
  if (alreadyLoaded && !force && !cabinetIdOverride && !scopeOverride) return null
  patch({ archiveLoading: true, error: '' })
  try {
    const qs = new URLSearchParams()
    if (store.sessionId) qs.set('session', store.sessionId)
    qs.set('scope', activeScope)
    const cid = (activeScope === 'precipitated' || activeScope === 'global')
      ? ''
      : (cabinetIdOverride || store.archiveCabinetId || '')
    if (cid && cid !== 'cab-global') {
      qs.set('cabinetId', cid)
    }
    const value = await call('archives' + (qs.toString() ? '?' + qs.toString() : ''))
    if (value && value.ok) {
      applyArchiveHeaders(value, [], activeScope)
      const validIds = scopeValidArchiveIds(activeScope)
      const openIds = Object.keys(store.archiveOpenFiles || {}).filter(id => store.archiveOpenFiles[id] && validIds.has(id) && !store.archiveDetails[id])
      for (const id of openIds) {
        void loadArchiveDetail(id, true, { scope: activeScope, precipitated: activeScope === 'precipitated' })
      }
    }
    return value
  } catch (error) {
    patch({ error: String((error && error.message) || error) })
    return null
  } finally {
    patch({ archiveLoading: false })
  }
}

/** Tier-2 Lazy Load: called ONLY when the user clicks a paperclipped dossier card to unfold its points */
export async function loadArchiveDetail(archiveId, force = false, opts = {}) {
  const id = String(archiveId || '').trim()
  if (!id) return null
  if (!force && store.archiveDetails && store.archiveDetails[id]) {
    return store.archiveDetails[id]
  }
  if (store.archiveDetailLoading && store.archiveDetailLoading[id]) return null
  patch({ archiveDetailLoading: { ...(store.archiveDetailLoading || {}), [id]: true } })
  try {
    const rawScope = (opts && (opts.scope || opts.vaultScope)) || store.archiveTabScope || 'session'
    const activeScope = rawScope === 'desktop' ? 'session' : rawScope
    const isPrecip = Boolean((opts && opts.precipitated) || activeScope === 'precipitated' || id.startsWith('prec-'))
    const isGlobal = !isPrecip && (activeScope === 'global' || id.startsWith('glob-'))
    const qs = new URLSearchParams({ id })
    if (store.sessionId) qs.set('session', store.sessionId)
    if (isPrecip) {
      qs.set('scope', 'precipitated')
      qs.set('precipitated', '1')
    } else if (isGlobal) {
      qs.set('scope', 'global')
    } else if (store.archiveCabinetId) {
      qs.set('cabinetId', store.archiveCabinetId)
    }
    const value = await call('archives/detail?' + qs.toString())
    if (value && value.ok && value.item) {
      patch({
        archiveDetails: {
          ...(store.archiveDetails || {}),
          [value.item.id]: value.item,
        },
      })
      return value.item
    }
    return null
  } catch (error) {
    patch({ error: String((error && error.message) || error) })
    return null
  } finally {
    const nextLoad = { ...(store.archiveDetailLoading || {}) }
    delete nextLoad[id]
    patch({ archiveDetailLoading: nextLoad })
  }
}

export async function mutateArchiveApi(payload, toastLabel = '') {
  try {
    const vaultScope = (payload && (payload.vaultScope || payload.scope))
      || (store.archiveTabScope === 'global' ? 'global' : 'session')
    const cabinetId = vaultScope === 'global'
      ? ''
      : ((payload && payload.cabinetId !== undefined) ? payload.cabinetId : (store.archiveCabinetId || ''))
    const value = await call('archives', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session: store.sessionId || sessionIdFromUrl(),
        vaultScope,
        cabinetId,
        ...payload,
      }),
    })
    if (value && value.ok) {
      if (payload.op === 'switchCabinet' || payload.op === 'createCabinet' || payload.op === 'deleteCabinet') {
        patch({ archiveDetails: {}, archiveOpenFolders: {}, archiveOpenFiles: {} })
      }
      const relationSensitiveOp = payload.op === 'save'
        || payload.op === 'delete'
        || payload.op === 'cycleClip'
        || payload.op === 'setClip'
        || payload.op === 'rollbackHistory'
      let workingDetails = relationSensitiveOp ? {} : { ...(store.archiveDetails || {}) }
      if (value.item && value.item.id) {
        workingDetails[value.item.id] = value.item
      }
      if (payload.op === 'delete' && (payload.archiveId || payload.id)) {
        const delId = payload.archiveId || payload.id
        const nextOpen = { ...(store.archiveOpenFiles || {}) }
        delete nextOpen[delId]
        delete workingDetails[delId]
        patch({ archiveOpenFiles: nextOpen, archiveDetails: workingDetails })
      } else if (relationSensitiveOp || (value.item && value.item.id)) {
        patch({ archiveDetails: workingDetails })
      }
      if (value.archives && typeof value.archives === 'object') {
        const targetScopeForHeaders = payload.op === 'pullPrecipitated'
          ? (payload.targetScope === 'global' ? 'global' : 'session')
          : (vaultScope === 'global' ? 'global' : 'session')
        applyArchiveHeaders({
          ...value.archives,
          ...(value.counts && typeof value.counts === 'object' ? { counts: value.counts } : {}),
          ...(Array.isArray(value.flippedPrecipitatedIds) ? { flippedPrecipitatedIds: value.flippedPrecipitatedIds } : {}),
          ...(Array.isArray(value.deskItems) ? { deskItems: value.deskItems } : {}),
        }, [], targetScopeForHeaders)
      }
      const extraPatch = {}
      if (value.board && typeof value.board === 'object') {
        extraPatch.board = value.board
      }
      if (value.archiveMeta && typeof value.archiveMeta === 'object') {
        extraPatch.archiveMeta = value.archiveMeta
      }
      if (value.diffSummary && typeof value.diffSummary === 'object') {
        extraPatch.archiveDiffSummary = value.diffSummary
      }
      if (value.counts && typeof value.counts === 'object') {
        extraPatch.archiveCounts = { ...(store.archiveCounts || {}), ...value.counts }
      }
      if (Array.isArray(value.deskItems)) {
        extraPatch.archiveDeskItems = value.deskItems
        extraPatch.archiveDeskLoaded = true
      }
      if (payload.op === 'copyToGlobal') {
        extraPatch.globalVaultLoaded = false
      } else if (payload.op === 'copyToSession') {
        extraPatch.archiveSessionLoaded = false
      } else if (payload.op === 'pullPrecipitated') {
        if (payload.targetScope === 'global') extraPatch.globalVaultLoaded = false
        else extraPatch.archiveSessionLoaded = false
      }
      if (payload.op === 'precipitateNotes') {
        const swept = Number(value.sweptCount || 0)
        if (swept > 0) {
          const opened = {}
          const folders = Array.isArray(value.savedFolders) && value.savedFolders.length
            ? value.savedFolders
            : ['inbox']
          for (const fId of folders) {
            if (fId) opened[fId] = true
          }
          extraPatch.archiveOpenFolders = { ...(store.archiveOpenFolders || {}), ...opened }
          extraPatch.notice = `已将 ${swept} 篇临时便签封存入本会话档案柜`
        } else {
          extraPatch.notice = '当前暂无可收纳的临时便签'
        }
      } else if ((payload.op === 'cycleClip' || payload.op === 'setClip') && value.paperclip === 'copper' && Array.isArray(value.affectedDependents) && value.affectedDependents.length > 0) {
        const deps = value.affectedDependents
        const names = deps.slice(0, 3).map(d => `《${d.title || '未命名'}》`).join('、')
        extraPatch.notice = `⚠️ 已标为暗铜（作废）！仍有 ${deps.length} 份活跃档案正在引用它：${names}${deps.length > 3 ? ' 等' : ''}`
      } else if (payload.op === 'rollbackHistory') {
        extraPatch.notice = toastLabel || '⏪ 已回滚到该历史版本（原版本已自动留存快照）'
      } else if (toastLabel) {
        extraPatch.notice = toastLabel
      }
      if (Object.keys(extraPatch).length) patch(extraPatch)
      if (relationSensitiveOp) {
        const targetScopeForReload = vaultScope === 'global' ? 'global' : 'session'
        const updatedId = value.item && value.item.id ? value.item.id : ''
        const openIds = Object.keys(store.archiveOpenFiles || {}).filter(id => store.archiveOpenFiles[id] && id !== updatedId)
        for (const oid of openIds) {
          void loadArchiveDetail(oid, true, { scope: targetScopeForReload })
        }
      }
      if (payload.op === 'copyToGlobal' && store.archiveTabScope === 'global') {
        void loadArchives(true, '', 'global')
      } else if (payload.op === 'pullPrecipitated' && store.archiveTabScope === payload.targetScope) {
        void loadArchives(true, '', payload.targetScope)
      }
    }
    return value
  } catch (error) {
    patch({ error: String((error && error.message) || error) })
    return null
  }
}

export async function requestOrganizeArchives(opts = {}) {
  if (store.archiveOrganizing) return null
  const isDream = Boolean(opts.dream || opts.reasonKind === 'dream_roam')
  return await withChiefWorkFx(
    isDream
      ? { tone: 'dream', tab: 'archive', label: '🌙 参谋长正在梦境漫游，帮你整理档案…' }
      : { tone: 'archive', tab: 'archive', label: '参谋长正在整理档案…' },
    async () => {
      patch({ archiveOrganizing: true, error: '' })
      try {
        const vaultScope = opts.vaultScope || (store.archiveTabScope === 'global' ? 'global' : 'session')
        const value = await call('archives/organize', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            session: store.sessionId || sessionIdFromUrl(),
            vaultScope,
            cabinetId: vaultScope === 'global' ? '' : (opts.cabinetId !== undefined ? opts.cabinetId : (store.archiveCabinetId || '')),
            ids: Array.isArray(opts.ids) ? opts.ids : [],
            folder: opts.folder || '',
            scope: opts.scope || store.archiveOrganizeScope || 'unorganized',
            instruction: opts.instruction !== undefined ? opts.instruction : (store.archiveOrganizePrompt || ''),
            ...(isDream ? { reasonKind: 'dream_roam' } : {}),
          }),
        })
        if (value && value.ok) {
          const validIds = scopeValidArchiveIds(vaultScope)
          const openIds = Object.keys(store.archiveOpenFiles || {}).filter(k => store.archiveOpenFiles[k] && validIds.has(k))
          const nextDetails = { ...(store.archiveDetails || {}) }
          for (const k of openIds) delete nextDetails[k]
          patch({
            archiveDetails: nextDetails,
            archiveOrganizeOpen: false,
            archiveOrganizePrompt: '',
            notice: value.updatedCount > 0
              ? `✦ 已帮你把 ${value.updatedCount} 份档案分类整理好，原文完整保留`
              : (value.cleanedStaleWatch > 0
                  ? '✦ 撤下的档案已归位或清理完成，桌面提醒已刷新'
                  : '✦ 这些档案已经分类好了，不用重整'),
          })
          void loadArchives(true, '', vaultScope)
          if (vaultScope !== 'session' && (isDream || store.archiveTabScope === 'desktop')) {
            void loadArchives(true, '', 'session')
          }
          for (const k of openIds) {
            void loadArchiveDetail(k, true, { scope: vaultScope })
          }
        }
        return value
      } catch (error) {
        patch({ error: String((error && error.message) || error) })
        return null
      } finally {
        patch({ archiveOrganizing: false })
      }
    },
  )
}

export async function harvestArchivesApi(focusHint = '', opts = {}) {
  if (store.archiveHarvesting) return null
  return await withChiefWorkFx(
    { tone: 'archive', tab: 'archive', label: '正在从对话里提取关键记录…' },
    async () => {
      patch({ archiveHarvesting: true, error: '' })
      try {
        const vaultScope = (opts && opts.vaultScope) || (store.archiveTabScope === 'global' ? 'global' : 'session')
        const value = await call('archives/harvest', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            session: store.sessionId || sessionIdFromUrl(),
            vaultScope,
            cabinetId: (opts && opts.cabinetId !== undefined) ? opts.cabinetId : (store.archiveCabinetId || ''),
            focusHint,
          }),
        })
        if (value && value.ok) {
          patch({
            notice: value.count > 0
              ? `📥 已保存 ${value.count} 份重要记录，避免长对话压缩后忘掉`
              : '📥 这轮对话没有新的重要细节要保存',
          })
          void loadArchives(true)
        }
        return value
      } catch (error) {
        patch({ error: String((error && error.message) || error) })
        return null
      } finally {
        patch({ archiveHarvesting: false })
      }
    },
  )
}

export async function precipitateArchivesApi(opts = {}) {
  if (store.archivePrecipitating) return null
  return await withChiefWorkFx(
    { tone: 'archive', tab: 'archive', label: '正在把经验存进长期冷库…' },
    async () => {
      patch({ archivePrecipitating: true, error: '' })
      try {
        const vaultScope = opts.vaultScope || 'global'
        const value = await call('archives/precipitate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            session: store.sessionId || sessionIdFromUrl(),
            vaultScope,
            op: opts.op || 'cabinet',
            cabinetId: '',
            folder: opts.folder || '',
            ...(Array.isArray(opts.ids) && opts.ids.length > 0 ? { ids: opts.ids } : {}),
            clearSource: Boolean(opts.clearSource),
          }),
        })
        if (value && value.ok) {
          patch({
            precipitateModal: null,
            notice: value.count > 0
              ? `⏬ 已把 ${value.count} 条常用经验存进冷库（平时占 0 Token）`
              : '⏬ 暂时没有可以存进冷库的经验',
          })
          void loadArchives(true, '', vaultScope)
        }
        return value
      } catch (error) {
        patch({ error: String((error && error.message) || error) })
        return null
      } finally {
        patch({ archivePrecipitating: false })
      }
    },
  )
}

export function toggleSelectArchive(id, vaultScope = 'session', title = '') {
  const aid = String(id || '').trim()
  if (!aid) return
  const vs = vaultScope === 'global' ? 'global' : (vaultScope === 'precipitated' ? 'precipitated' : 'session')
  const key = vs + ':' + aid
  const prev = { ...(store.selectedArchiveMap || {}) }
  if (prev[key]) delete prev[key]
  else prev[key] = { id: aid, vaultScope: vs, title: String(title || aid) }
  patch({ selectedArchiveMap: prev })
}

export function clearSelectedArchives() {
  patch({ selectedArchiveMap: {} })
}

export function openArchiveRelayModal(items) {
  const list = Array.isArray(items) ? items.filter(x => x && x.id) : []
  if (!list.length) return
  patch({
    archiveRelayModal: {
      items: list.map(x => ({
        id: String(x.id),
        vaultScope: x.vaultScope === 'global' ? 'global' : (x.vaultScope === 'precipitated' ? 'precipitated' : 'session'),
        title: String(x.title || x.id),
      })),
      instruction: '',
      target: 'lead',
      mode: 'followup',
    },
  })
}

export async function relayArchivesWithChiefApi(modalState) {
  if (store.relayArchivesBusy) return null
  const items = Array.isArray(modalState && modalState.items) ? modalState.items : []
  if (!items.length) return null
  return await withChiefWorkFx(
    { tone: 'archive', tab: 'archive', label: '正在整理档案并准备发送…' },
    async () => {
      patch({ relayArchivesBusy: true, error: '' })
      try {
        const value = await call('chief/relay-archives', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            session: store.sessionId || sessionIdFromUrl(),
            cabinetId: store.archiveCabinetId || '',
            items: items.map(it => ({
              id: it.id,
              scope: it.vaultScope || it.scope || 'session',
              vaultScope: it.vaultScope || it.scope || 'session',
              title: it.title || it.id,
            })),
            instruction: String((modalState && modalState.instruction) || '').trim(),
            target: (modalState && modalState.target) || 'lead',
            mode: (modalState && modalState.mode) || 'followup',
          }),
        })
        if (value && value.ok) {
          patch({
            archiveRelayModal: null,
            selectedArchiveMap: {},
            notice: `📨 已把 ${items.length} 份档案和你的要求一起发给 @${modalState.target === 'lead' || !modalState.target ? '主对话' : shortAgentName(modalState.target, true)}`,
          })
          void refresh()
        }
        return value
      } catch (error) {
        patch({ error: String((error && error.message) || error) })
        return null
      } finally {
        patch({ relayArchivesBusy: false })
      }
    },
  )
}

export async function distillToGlobalApi(modalState) {
  if (store.distillBusy) return null
  return await withChiefWorkFx(
    { tone: 'archive', tab: 'archive', label: '正在整理要存入全局档案的经验…' },
    async () => {
      patch({ distillBusy: true, error: '' })
      try {
        const ids = Array.isArray(modalState && modalState.ids) && modalState.ids.length > 0
          ? modalState.ids
          : null
        const value = await call('archives/distill-to-global', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            session: store.sessionId || sessionIdFromUrl(),
            cabinetId: store.archiveCabinetId || '',
            ids,
            clearSource: Boolean(modalState && modalState.clearSource),
            instruction: String((modalState && modalState.instruction) || '').trim(),
          }),
        })
        if (value && value.ok) {
          const nextPatch = {
            distillGlobalModal: null,
            selectedArchiveMap: {},
            globalVaultLoaded: false,
            notice: value.createdCount > 0
              ? `✦ 已提取 ${value.createdCount} 份通用经验，存进「🌐 全局档案柜」`
              : '✦ 这轮对话暂时没有新的通用经验',
          }
          if (value.globalArchives && Array.isArray(value.globalArchives.items)) {
            nextPatch.globalVaultItems = value.globalArchives.items
            nextPatch.globalVaultLoaded = true
          }
          if (Array.isArray(value.deskItems)) {
            nextPatch.archiveDeskItems = value.deskItems
            nextPatch.archiveDeskLoaded = true
          }
          patch(nextPatch)
          if (ids && modalState && modalState.clearSource) void loadArchives(true, '', 'session')
        }
        return value
      } catch (error) {
        patch({ error: String((error && error.message) || error) })
        return null
      } finally {
        patch({ distillBusy: false })
      }
    },
  )
}

export async function approveGoalApi() {
  const value = await act({ action: 'goal.approve' })
  if (value && value.ok) patch({ notice: '✅ 已确认目标完成，切回普通计划模式' })
  return value
}

export async function rejectGoalApi(reason) {
  const text = String(reason || '').trim()
  if (!text) {
    patch({ error: '请简单写一下没通过的原因，或要补什么' })
    return null
  }
  const value = await act({ action: 'goal.reject', reason: text })
  if (value && value.ok) patch({ notice: '↩ 已退回重做，参谋长会继续盯着推进' })
  return value
}

export async function deliverArchiveToChat(headerOrDetail, point = null) {
  let detail = headerOrDetail
  if (!point && (!detail || !Array.isArray(detail.points))) {
    const loaded = await loadArchiveDetail(headerOrDetail && headerOrDetail.id)
    if (loaded) detail = loaded
  }
  if (!detail) return
  const lines = []
  if (point) {
    lines.push(`📎 调阅工程档案《${detail.title}》→ 记忆点「${point.title}」：`)
    lines.push(point.detail || point.cue || point.title)
  } else {
    lines.push(`📎 调阅工程档案《${detail.title}》：`)
    if (detail.summary) lines.push(`提要：${detail.summary}`)
    const pts = Array.isArray(detail.points) ? detail.points : []
    if (pts.length) {
      pts.slice(0, 8).forEach((p, idx) => {
        lines.push(`${idx + 1}. 【${p.title}】${p.detail || p.cue || ''}`)
      })
    } else if (detail.body) {
      lines.push(detail.body.slice(0, 1500))
    }
  }
  await askLeadModel(lines.join('\n'), '调阅工程档案')
}

export async function searchColdArchives(queryText) {
  const q = String(queryText || '').trim()
  if (!q || store.archiveSearchBusy) return
  patch({ archiveSearchBusy: true })
  try {
    const qs = new URLSearchParams({ q })
    const sid = store.sessionId || sessionIdFromUrl()
    if (sid) qs.set('session', sid)
    if (store.archiveTabScope === 'global') qs.set('scope', 'global')
    const value = await call('archives?' + qs.toString())
    if (value && value.ok && Array.isArray(value.items)) {
      const folderMap = new Map((value.folders || []).map(f => [f.id, f.label]))
      const archHits = value.items.slice(0, 12).map(it => ({
        kind: '封存档案',
        tab: 'archive',
        folderId: it.folder,
        archiveId: it.id,
        id: it.id,
        title: `${it.paperclip === 'gold' ? '📎 ' : ''}${it.title}`,
        snippet: `[${folderMap.get(it.folder) || it.folder}] ${it.summary || ''}`,
      }))
      const localHits = searchBoard(q).filter(hItem => hItem.tab !== 'archive')
      patch({
        askHits: [...archHits, ...localHits],
        notice: archHits.length ? `在档案库里找到 ${archHits.length} 份相关记录` : '档案库里没找到相关内容',
      })
    }
  } catch (error) {
    patch({ error: String((error && error.message) || error) })
  } finally {
    patch({ archiveSearchBusy: false })
  }
}


/** Bilingual BM25 archive search API for UI live search box (non-blocking against single-flight loadArchives) */
export async function searchArchivesRemoteApi(queryText, scope = 'session') {
  const q = String(queryText || '').trim()
  if (!q) return { ok: true, items: [] }
  const activeScope = scope === 'global' ? 'global' : 'session'
  const qs = new URLSearchParams({ q, scope: activeScope })
  const sid = store.sessionId || sessionIdFromUrl()
  if (sid) qs.set('session', sid)
  if (activeScope !== 'global' && store.archiveCabinetId && store.archiveCabinetId !== 'cab-global') {
    qs.set('cabinetId', store.archiveCabinetId)
  }
  return call('archives?' + qs.toString())
}

apiBridge.applyArchiveHeaders = applyArchiveHeaders
apiBridge.loadArchives = loadArchives
