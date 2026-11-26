/**
 * src/client/api/board.js — 任务板、工作流操作、边界红线、记忆搜索与交接单 API
 *
 * 【核心职责】
 *   承载主面板任务增删改查（`refresh` / `act`）、跨窗口交接（`loadTargets` / `loadHandoff` / `transfer`）、
 *   记忆问答、红线规则与自定义拦截规则增删合并，以及任务编辑器预填动作。
 *
 * 【边界约定】
 *   - 仅依赖 `./transport.js`，不导入上层 `archives.js` 或 `chief.js`。
 *   - 模块加载时向 `apiBridge.refresh` 注册回调供底层状态同步使用。
 */

import { SIDE_ID } from '../constants.js'
import { store, patch, service, runtimeRefs } from '../store.js'
import { shortSession, snippetOf, sessionIdFromUrl, truncationNotice } from '../utils.js'
import { apiBridge, call, withChiefWorkFx } from './transport.js'

export async function refresh() {
  const fromUrl = sessionIdFromUrl()
  if (!store.sessionId && fromUrl) {
    patch({ sessionId: fromUrl })
  }
  try {
    await call('snapshot' + (store.sessionId ? '?session=' + encodeURIComponent(store.sessionId) : ''))
    const panelActive = Boolean(store.dock || store.panel === SIDE_ID || store.open)
    if (panelActive && (!store.secView || store.tab === 'chief' || store.tab === 'peers' || (store.chiefMeta && store.chiefMeta.pendingSuggestions > 0))) {
      if (apiBridge.loadChiefView) void apiBridge.loadChiefView(false)
    }
    if (store.error) patch({ error: '' })
  } catch (error) {
    patch({ error: String((error && error.message) || error) })
  }
}

export async function act(action) {
  patch({ busy: true, error: '' })
  try {
    const effSession = (action && action.session !== undefined)
      ? action.session
      : (store.sessionId || sessionIdFromUrl())
    const result = await call('action', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...action, session: effSession, by: (action && action.by) || 'user' }),
    })
    let notice = truncationNotice(result)
    if (!notice && result && result.dispatched) {
      notice = '已派发 @' + result.dispatched.agent
    } else if (!notice && result && result.interrupted) {
      notice = '已停止 @' + result.interrupted
    } else if (!notice && result && result.messageId && result.agent) {
      notice = '已发送给 @' + result.agent
    }
    if (notice) patch({ notice })
    return result
  } catch (error) {
    const msg = String((error && error.message) || error)
    if (/unknown action:/i.test(msg)) {
      patch({
        staleBackendDetected: true,
        staleBackendDismissed: false,
        error: '后台还在跑旧版本，新功能还没加载进来。请完全关闭再重新打开 DeepSeek Harness 客户端。',
      })
    } else {
      patch({ error: msg })
    }
    return null
  } finally {
    patch({ busy: false })
  }
}

export async function loadTargets() {
  try {
    const value = await call('sessions' + (store.sessionId ? '?session=' + encodeURIComponent(store.sessionId) : ''))
    patch({
      targets: (value && Array.isArray(value.sessions)) ? value.sessions : [],
      pending: (value && value.pending) || null,
      autoInject: !!(value && value.autoInject),
      guardIdle: !(value && value.guardIdle === false),
      guardMaxPerSession: Number.isFinite(Number(value && value.guardMaxPerSession))
        ? Number(value.guardMaxPerSession)
        : 3,
      guardShortAnswer: Number.isFinite(Number(value && value.guardShortAnswer))
        ? Number(value.guardShortAnswer)
        : 600,
    })
  } catch (error) {
    patch({ error: String((error && error.message) || error) })
  }
}

export async function loadHandoff() {
  patch({ handoffBusy: true, error: '' })
  try {
    const value = await call('handoff' + (store.sessionId ? '?session=' + encodeURIComponent(store.sessionId) : ''))
    const text = value && value.text ? value.text : ''
    const nextMeta = {
      source: (value && value.source) || 'auto',
      isCustom: Boolean(value && value.isCustom),
      pinned: Boolean(value && value.pinned),
      syncOnDigest: Boolean(value && value.syncOnDigest),
      isIncomplete: Boolean(value && value.isIncomplete),
      isStale: Boolean(value && value.isStale),
      hasNarrativeUpdate: Boolean(value && value.hasNarrativeUpdate),
      autoText: (value && value.autoText) || '',
      updatedAt: Number(value && (value.updatedAt || value.handoffAt)) || 0,
    }
    patch({
      handoffText: text,
      handoffMeta: nextMeta,
      ...(store.handoffEditing ? {} : { handoffDraft: text }),
    })
    return value || { ok: true, text, ...nextMeta }
  } catch (error) {
    patch({ error: String((error && error.message) || error) })
    return null
  } finally {
    patch({ handoffBusy: false })
  }
}

export async function saveHandoffCustom(text, pinAfter = false) {
  const cleanText = String(text || '')
  const res = await act({ action: 'handoff.save', text: cleanText, source: 'human', by: 'user' })
  if (res && res.ok) {
    if (pinAfter) {
      await act({ action: 'handoff.pin', pinned: true, by: 'user' })
    }
    patch({ handoffEditing: false, notice: pinAfter ? '✏️ 已保存交接单，并设好定住防改' : '✏️ 已保存你改的交接单' })
    await loadHandoff()
  }
  return res
}

export async function toggleHandoffPin(nextPinned, snapshotOverride = '') {
  let snapshotText = String(
    snapshotOverride
    || store.handoffText
    || (store.handoffMeta && store.handoffMeta.autoText)
    || '',
  )
  if (nextPinned && !snapshotText) {
    const loaded = await loadHandoff()
    snapshotText = String((loaded && loaded.text) || store.handoffText || '')
  }
  const res = await act({
    action: 'handoff.pin',
    pinned: Boolean(nextPinned),
    ...(nextPinned && snapshotText ? { snapshotText } : {}),
    by: 'user',
  })
  if (res && res.ok) {
    patch({ notice: nextPinned ? '📌 已定住防改：参谋长不会再自动覆盖这份交接单' : '🔓 已解除锁定，交接单可以重新自动更新了' })
    await loadHandoff()
  }
  return res
}

export async function resetHandoffAuto() {
  const res = await act({ action: 'handoff.reset', by: 'user' })
  if (res && res.ok) {
    patch({ handoffEditing: false, notice: '↺ 已改回由系统自动更新交接单' })
    await loadHandoff()
  }
  return res
}

export async function toggleSyncHandoffOnDigest(enabled) {
  if (store.board && store.board.handoff && store.board.handoff.pinned) {
    patch({ notice: '🔒 交接单已定住防改，先解锁才能开启自动同步' })
    return null
  }
  const res = await act({ action: 'handoff.setSyncOnDigest', enabled: Boolean(enabled), by: 'user' })
  if (res && res.ok) {
    patch({ notice: enabled ? '✦ 以后提炼摘要时会自动更新交接单' : '已关闭自动同步，之后只按你的修改为准' })
    await loadHandoff()
  }
  return res
}

export async function requestTransferWithGuard(target, opts = {}) {
  const info = await loadHandoff()
  const hMeta = (info && typeof info === 'object') ? info : (store.handoffMeta || {})
  const pinned = Boolean(hMeta.pinned || (store.board && store.board.handoff && store.board.handoff.pinned))
  const staleOrIncomplete = !pinned && Boolean(hMeta.isIncomplete || hMeta.isStale || hMeta.hasNarrativeUpdate)
  if (staleOrIncomplete) {
    const reason = hMeta.isIncomplete
      ? '交接单还缺目标、步骤或最新摘要，直接交接会让新对话接不上。'
      : '摘要已经更新了，但交接单还没同步。直接交接会让新窗口看到旧进度，建议先更新一下。'
    patch({
      handoffWarnModal: {
        target,
        opts,
        reason,
        isIncomplete: Boolean(hMeta.isIncomplete),
      },
    })
    return null
  }
  return transfer(target, opts)
}

export async function transfer(target, opts = {}) {
  patch({ transferNote: '正在交接…', error: '' })
  try {
    const value = await call('transfer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        target,
        session: store.sessionId,
        by: 'user',
        deployChief: opts.deployChief !== false,
        archiveTransferPolicy: opts.archiveTransferPolicy || store.deployArchivePolicy || 'none',
        ...(opts.archiveDrawer || store.deployDrawer ? { archiveDrawer: opts.archiveDrawer || store.deployDrawer } : {}),
        ...(opts.toCabinetId ? { toCabinetId: opts.toCabinetId } : {}),
        ...(opts.customNote ? { customNote: opts.customNote } : {}),
      }),
    })
    const created = value && value.mode === 'created' && value.sessionId ? String(value.sessionId) : ''
    let note = '已放入待领取队列（含参谋预部署）'
    if (value && value.mode === 'injected') note = '已交接到目标对话，并开启了参谋'
    if (created) {
      patch({ transferred: true })
      setTimeout(() => patch({ transferred: false }), 2000)
      note = '已创建新会话 ' + shortSession(created) + ' 并部署参谋'
      const sessionsSvc = service('sessions') || (runtimeRefs.navigation && runtimeRefs.navigation.sessions) || null
      if (sessionsSvc && typeof sessionsSvc.open === 'function') {
        try {
          sessionsSvc.open(created)
        } catch {}
      } else if (runtimeRefs.navigation && typeof runtimeRefs.navigation.openSession === 'function') {
        try {
          runtimeRefs.navigation.openSession(created)
        } catch {}
      }
    }
    patch({
      transferNote: note,
      notice: note,
      handoffText: value && value.text ? value.text : store.handoffText,
    })
    void loadTargets()
    return value
  } catch (error) {
    patch({ transferNote: '失败：' + String((error && error.message) || error) })
    return null
  }
}

export function searchBoard(term) {
  const needle = String(term || '').trim().toLowerCase()
  if (!needle) return []
  const board = store.board || {}
  const sec = store.secView || {}
  const hits = []
  const hit = text => String(text || '').toLowerCase().includes(needle)
  for (const task of board.tasks || []) {
    if (hit(task.title) || hit(task.note) || hit(task.intent) || hit(task.evidence)) {
      hits.push({ kind: '任务', tab: 'tasks', id: task.id, title: task.title, snippet: snippetOf(task.note || task.evidence || task.title, needle, 34) })
    }
  }
  for (const mail of sec.mailbox || []) {
    if (hit(mail.text) || hit(mail.subject) || hit(mail.from) || hit(mail.to)) {
      hits.push({ kind: '协同信箱', tab: 'peers', id: mail.id, title: (mail.from || '参谋长') + ' → ' + (mail.to || '成员'), snippet: snippetOf(mail.text, needle, 34) })
    }
  }
  for (const note of board.notes || []) {
    if (hit(note.title) || hit(note.body) || (note.tags || []).some(hit)) {
      hits.push({ kind: '临时便签', tab: 'archive', id: note.id, title: note.title || '无标题', snippet: snippetOf(note.body || note.title, needle, 36) })
    }
  }
  if (store.archiveLoaded && Array.isArray(store.archiveItems)) {
    for (const arch of store.archiveItems) {
      if (hit(arch.title) || hit(arch.summary) || (arch.tags || []).some(hit) || (arch.pointPreviews || []).some(hit)) {
        hits.push({
          kind: '工程档案',
          tab: 'archive',
          folderId: arch.folder,
          archiveId: arch.id,
          id: arch.id,
          title: (arch.paperclip === 'gold' ? '📎 ' : '') + (arch.title || '无标题'),
          snippet: snippetOf(arch.summary || (arch.pointPreviews || []).join(' · '), needle, 36),
        })
      }
    }
  }
  for (const step of board.plan || []) {
    if (hit(step.text)) hits.push({ kind: '规划', tab: 'tasks', id: step.id, title: step.text, snippet: '' })
  }
  if (hit(board.objective)) hits.push({ kind: '目标', tab: 'tasks', id: 'objective', title: '当前目标', snippet: snippetOf(board.objective, needle, 36) })
  return hits
}

export function sendToComposer(text) {
  const actions = store.inputActions
  if (!actions || typeof actions !== 'object') return null
  const setters = ['setDraft', 'setText', 'replaceText', 'updateText', 'appendText', 'insertText']
  for (const name of setters) {
    const fn = actions[name]
    if (typeof fn !== 'function') continue
    try {
      if (fn(text) === false) continue
    } catch {
      continue
    }
    const submit = typeof actions.submit === 'function' ? actions.submit : (typeof actions.send === 'function' ? actions.send : null)
    if (submit) {
      try {
        submit()
        return '已发到对话'
      } catch {}
    }
    return '已填入输入框'
  }
  return null
}

export async function askLeadModel(promptText, subject = '步骤咨询') {
  const clean = String(promptText || '').trim()
  if (!clean) return
  const sent = sendToComposer(clean)
  if (sent) {
    patch({ notice: sent + '，等主对话回复' })
    return
  }
  try {
    await call('chief/relay', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session: store.sessionId,
        by: '用户咨询',
        target: 'lead',
        subject,
        text: clean,
        mode: 'followup',
      }),
    })
    patch({ notice: '已发给主对话' })
  } catch (error) {
    copyText(clean, '已复制，去对话框粘贴就能提问')
  }
}

export function copyText(text, label = '已复制') {
  if (!text) return
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(String(text)).then(
        () => patch({ copied: true, notice: label }),
        () => {},
      )
      setTimeout(() => patch({ copied: false }), 1400)
    }
  } catch {}
}

/* ----------------------------------------------------------- Icons (SVG) */

export async function addBoundRule(field, item, pinned = false) {
  const res = await act({ action: 'bounds.add', field, item, pinned: Boolean(pinned) })
  if (!res || store.error) return
  patch({
    boundDraft: { ...store.boundDraft, [field]: '' },
    notice: pinned ? '📌 已添加为所有任务通用的边界' : '已添加到当前对话边界（点前面图钉可设为通用）',
  })
}

export async function toggleBoundPin(field, item, nextPinned) {
  const res = await act({ action: 'bounds.pin', field, item, pinned: Boolean(nextPinned) })
  if (!res || store.error) return
  patch({
    notice: nextPinned
      ? '📌 已固定为所有任务通用的边界'
      : '已取消通用固定，只在当前对话生效',
  })
}

export async function removeBoundRule(field, item) {
  const nextSel = { ...(store.boundSelected || { allowed: [], forbidden: [], notes: [] }) }
  if (Array.isArray(nextSel[field])) {
    nextSel[field] = nextSel[field].filter(x => x !== item)
    patch({ boundSelected: nextSel })
  }
  await act({ action: 'bounds.remove', field, item })
}

export async function editBoundRule(field, oldItem, nextItem) {
  const trimmed = String(nextItem || '').trim()
  if (!trimmed || trimmed === oldItem) return
  const res = await act({ action: 'bounds.edit', field, oldItem, item: trimmed })
  if (res && !store.error) patch({ notice: '已更新边界规则' })
}

export function toggleBoundSelect(field, item) {
  const curMap = store.boundSelected || { allowed: [], forbidden: [], notes: [] }
  const cur = Array.isArray(curMap[field]) ? curMap[field] : []
  const next = cur.includes(item) ? cur.filter(x => x !== item) : cur.concat(item)
  patch({ boundSelected: { ...curMap, [field]: next } })
}

export async function saveGuardWallApi({ id = '', title, ruleType = 'forbid_cmd', pattern = '', patterns = null, scope = 'global', reason = '', writeOnly = false, source = 'manual', silent = false }) {
  const cleanTitle = String(title || '').trim()
  const cleanPattern = String(pattern || '').trim()
  const patList = Array.isArray(patterns) && patterns.length > 0
    ? patterns
    : (cleanPattern ? cleanPattern.split(/[\r\n,;，；]+/).map(s => s.trim()).filter(Boolean) : [])
  if (!cleanTitle || !patList.length) {
    patch({ error: '请给拦截规则起个名字，并至少写 1 条拦截条件' })
    return null
  }
  const wallPayload = {
    ...(id ? { id: String(id).trim() } : {}),
    title: cleanTitle,
    ruleType,
    patterns: patList,
    scope,
    reason: String(reason || '').trim(),
    writeOnly: Boolean(writeOnly),
    source: String(source || 'manual').trim() || 'manual',
  }
  const res = await act({
    action: 'wall.save',
    wall: wallPayload,
  })
  if (res && res.ok && !silent) {
    patch({
      wallFormOpen: false,
      wallDraftTitle: '',
      wallDraftPattern: '',
      notice: `🚧 已启用拦截规则「${cleanTitle}」（${scope === 'workspace' ? '只管当前项目' : scope === 'paused' ? '⏸ 已暂停' : '🌐 所有项目通用'}）`,
    })
  }
  return res
}

export async function setGuardWallScopeApi(wallId, scope, { silent = false } = {}) {
  if (!wallId || !scope) return null
  const res = await act({ action: 'wall.setScope', wallId, scope })
  if (res && res.ok && !silent) {
    const labelMap = { global: '🌐 所有项目通用', workspace: '📁 只管当前项目', paused: '⏸ 已暂停' }
    patch({ notice: `🚧 拦截规则状态已改为：${labelMap[scope] || scope}` })
  }
  return res
}

export async function setAllGuardWallsScopeApi(scope, targetIds = null) {
  const walls = Array.isArray(store.guardWalls) ? store.guardWalls : []
  const allowedIds = Array.isArray(targetIds) && targetIds.length > 0 ? new Set(targetIds) : null
  const targets = walls.filter(w => {
    if (!w || !w.id) return false
    if (allowedIds && !allowedIds.has(w.id)) return false
    if (scope === 'paused') return w.scope !== 'paused'
    return w.scope === 'paused'
  })
  if (!targets.length) return { ok: true, count: 0 }
  let count = 0
  let lastRes = null
  for (const w of targets) {
    const res = await act({ action: 'wall.setScope', wallId: w.id, scope })
    if (res && res.ok) {
      count += 1
      lastRes = res
    }
  }
  if (count > 0) {
    patch({
      notice: scope === 'paused'
        ? `⏸ 已暂停 ${count} 条自定义拦截规则`
        : `🚧 已恢复 ${count} 条自定义拦截规则`,
    })
  }
  return { ok: count > 0, count, lastRes }
}

export async function removeGuardWallApi(wallId) {
  if (!wallId) return null
  const res = await act({ action: 'wall.remove', wallId })
  if (res && res.ok) {
    const curSel = Array.isArray(store.wallSelectedIds) ? store.wallSelectedIds : []
    patch({
      wallSelectedIds: curSel.filter(id => id !== wallId),
      wallMergeError: '',
      notice: '🚧 已删除这条自定义拦截规则',
    })
  }
  return res
}

export function toggleGuardWallSelect(wallId) {
  const id = String(wallId || '').trim()
  if (!id) return
  const prev = Array.isArray(store.wallSelectedIds) ? store.wallSelectedIds : []
  const next = prev.includes(id) ? prev.filter(x => x !== id) : prev.concat(id)
  patch({ wallSelectedIds: next, wallMergeError: '', error: '' })
}

export async function mergeGuardWallsApi({ wallIds = [], autoGroup = false } = {}) {
  const walls = Array.isArray(store.guardWalls) ? store.guardWalls : []
  if (!autoGroup) {
    const cleanIds = [...new Set((Array.isArray(wallIds) ? wallIds : []).filter(id => walls.some(w => w && w.id === id)))]
    if (cleanIds.length < 2) {
      const msg = '请至少选 2 条同类型的自定义拦截规则再合并'
      patch({ wallMergeError: msg, error: msg })
      return { ok: false, code: 'MERGE_MIN_TWO', error: msg }
    }
    const picked = walls.filter(w => cleanIds.includes(w.id))
    const ruleTypes = new Set(picked.map(w => w.ruleType))
    if (ruleTypes.size > 1) {
      const msg = '⛔ 不同类型的拦截规则不能混在一起合并，比如「禁碰路径」只能和「禁碰路径」合。请取消选错的那条。'
      patch({ wallMergeError: msg, error: msg })
      return { ok: false, code: 'CROSS_TYPE_MERGE_FORBIDDEN', error: msg }
    }
  }
  patch({ wallMergeError: '', error: '' })
  return await withChiefWorkFx(
    { tone: 'wall', tab: 'boundaries', boundSubTab: 'rules', label: '正在合并同类拦截规则…', minMs: 520 },
    async () => {
      const res = await act({
        action: 'wall.merge',
        wallIds: Array.isArray(wallIds) ? wallIds : [],
        autoGroup: Boolean(autoGroup),
      })
      if (!res || !res.ok) {
        const msg = (res && res.error) || store.error || '合并失败'
        patch({ wallMergeError: msg, error: msg })
        return res || { ok: false, error: msg }
      }
      patch({
        wallSelectedIds: [],
        wallMergeError: '',
        notice: `🚧 已把 ${res.mergedCount || 2} 条同类拦截规则合并成 ${res.createdCount || 1} 条`,
      })
      return res
    },
  )
}

export function openTaskEditor(task) {
  if (!task) return
  patch({
    selectedTaskId: task.id,
    editTaskId: task.id,
    editTaskTitle: task.title || '',
    editTaskNote: task.note || '',
    editTaskIntent: task.intent || '',
    editTaskEvidence: task.evidence || '',
    editTaskParentId: task.parentId || '',
    editTaskPlanStepId: task.planStepId || '',
    editTaskTargetPlanStepId: task.targetPlanStepId || '',
    editTaskBlockedBy: Array.isArray(task.blockedBy) ? [...task.blockedBy] : [],
  })
}

apiBridge.refresh = refresh
