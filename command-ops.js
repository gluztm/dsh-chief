/**
 * command-ops.js — 参谋建议落地执行器（Fact / Board / Archive / Network）、边界归并、目标建议与 Lead 直连处理
 *
 * 【核心职责】
 *   1. 提供 `applyFactChanges`、`applyBoardOps`、`executeChiefArchiveInjectionOp`、`applyArchiveOps`、
 *      `applyNetworkOps` 等原子落盘动作，供 `askOrCommandChief` 与自动审阅复用。
 *   2. 提供 `consolidateBoundsWithChief`、`proposeBoundToChief` 与 `suggestCoreObjectiveWithChief`。
 *   3. 承载 `handleLeadDirectRequestToChief`（主代理 `chief.request` / 邮箱直传参谋长分档处置）及
 *      `registerAskOrCommandChiefRunner` 回调注入。
 *
 * 【边界约定】
 *   - 依赖 `command-helpers.js` 与底层领域模块，绝不反向依赖 `chief-commands.js`。
 */

import {
  loadArchiveStore,
  getArchiveDetail,
  mutateArchive,
} from './archives.js'
import {
  DEFAULT_CHIEF_PERMISSION_MODE,
  CHIEF_PERMISSION_META,
  normalizePermissionMode,
  permissionRank,
  buildCapabilityScope,
  listGuardWalls,
  stripToolCallMarkup,
} from './chief-executor.js'
import {
  FACTS_CAP,
  FACT_TEXT_MAX,
  CHAT_CAP,
  SUGGESTIONS_CAP,
  SUMMARY_MAX_TOKENS,
  archiveTargetForRoot,
  nextId,
  hasValidChiefRiskAck,
  queueChiefApproval,
  requestChiefElevation,
  upsertTaskLedgerOnWs,
  resolveSessionWorkspaceCwd,
  clamp,
  cleanMultiline,
  secretLike,
  normalizeFact,
  normalizeSuggestion,
  resolveWorkspaceConfig,
  normalizeTacticalModes,
  pushAlertEventToWs,
  pushAuditToWs,
  loadChiefState,
  mutateChiefState,
  setPeerLink,
  ensureWorkspace,
  clusterView,
  extractJsonObject,
  beginChiefActiveWork,
  endChiefActiveWork,
  stripModelControlMarkup,
} from './chief-state.js'
import { callChiefLlm } from './chief-models.js'
import { listPeerDirectory, deliverCrossMessage } from './chief-network.js'
import { getChiefView } from './chief-view.js'
import { organizeArchivesWithChief, distillSessionArchivesToGlobal } from './chief-archives.js'
import { CONSOLIDATE_BOUNDS_SYSTEM, collectLiveConversationsDigest, deterministicConsolidateClauses, OBJECTIVE_SUGGEST_SYSTEM } from './command-helpers.js'

let askOrCommandChiefRunner = null

/** Register `askOrCommandChief` executor from `chief-commands.js` without creating a circular ESM import. */
export function registerAskOrCommandChiefRunner(fn) {
  askOrCommandChiefRunner = typeof fn === 'function' ? fn : null
}

export function applyFactChanges(ws, numberedFacts, changes, actor = 'user', meta = {}) {
  const applied = []
  if (!Array.isArray(changes) || !changes.length) return applied
  const originRootId = typeof meta.originRootId === 'string' ? meta.originRootId : ''
  const clusterRoots = Array.isArray(meta.peerRootIds) ? meta.peerRootIds : []

  for (const ch of changes.slice(0, 12)) {
    if (!ch || typeof ch !== 'object') continue
    const op = String(ch.op || '').trim()
    if (op === 'add') {
      const category = ch.category || 'discipline'
      const fact = normalizeFact({
        text: ch.text,
        category,
        by: actor,
        source: 'chief',
        originRootId: originRootId && originRootId !== 'global' ? originRootId : '',
        peerRootIds: category === 'team' ? clusterRoots : [],
      })
      if (!fact) continue
      const dup = ws.facts.find(f => f.text === fact.text)
      if (dup) {
        dup.updatedAt = Date.now()
        continue
      }
      ws.facts.push(fact)
      if (ws.facts.length > FACTS_CAP) ws.facts = ws.facts.slice(-FACTS_CAP)
      applied.push({ op: 'add', text: fact.text, category: fact.category })
    } else if (op === 'edit') {
      const target = numberedFacts[Number(ch.index) - 1]
      const nextText = clamp(ch.text, FACT_TEXT_MAX)
      if (!target || !nextText || secretLike(nextText)) continue
      const found = ws.facts.find(f => f.id === target.id)
      if (found && !found.pinned) {
        const prevText = found.text
        found.text = nextText
        found.updatedAt = Date.now()
        applied.push({ op: 'edit', text: nextText, oldText: prevText, category: found.category || 'discipline' })
      }
    } else if (op === 'remove') {
      const target = numberedFacts[Number(ch.index) - 1]
      if (!target) continue
      const idx = ws.facts.findIndex(f => f.id === target.id)
      if (idx !== -1 && !ws.facts[idx].pinned) {
        const [removed] = ws.facts.splice(idx, 1)
        applied.push({ op: 'remove', text: removed.text, category: removed.category || 'discipline' })
      }
    }
  }
  return applied
}

export function applyBoardOps(deps, rootId, boardOps, opts = {}) {
  const executed = []
  if (!Array.isArray(boardOps) || !boardOps.length || !deps || typeof deps.runAction !== 'function') return executed
  const forceSessionOnly = Boolean(opts && opts.forceSessionOnly)
  const allowLockedObjectiveWrite = Boolean(opts && opts.allowLockedObjectiveWrite)
  const callerOrigin = String((opts && opts.callerOrigin) || 'chief_llm')
  const effCfg = resolveWorkspaceConfig(loadChiefState(), rootId)
  const objectiveLocked = Boolean(effCfg && effCfg.tacticalModes && effCfg.tacticalModes.intervention) && !allowLockedObjectiveWrite

  for (const opItem of boardOps.slice(0, 10)) {
    if (!opItem || typeof opItem !== 'object') continue
    const op = String(opItem.op || '').trim()
    if (op === 'objective.set' && opItem.objective) {
      if (objectiveLocked) {
        executed.push('核心目标已锁定（强介入进行中，跳过改写）')
        continue
      }
      deps.runAction({ action: 'objective.set', objective: String(opItem.objective), session: rootId, by: 'chief' })
      executed.push('更新目标：' + clamp(opItem.objective, 40))
    } else if (op === 'task.add' && opItem.title) {
      deps.runAction({
        action: 'task.add',
        title: String(opItem.title),
        owner: opItem.owner ? String(opItem.owner) : '',
        subagent: opItem.owner ? String(opItem.owner) : '',
        priority: opItem.priority || 'normal',
        session: rootId,
        by: 'chief',
      })
      executed.push('新增任务：' + clamp(opItem.title, 40))
    } else if (op === 'task.update' && (opItem.id || opItem.taskId)) {
      const tid = String(opItem.id || opItem.taskId).trim()
      const res = deps.runAction({
        action: 'task.update',
        id: tid,
        ...(typeof opItem.status === 'string' ? { status: opItem.status } : {}),
        ...(typeof opItem.note === 'string' ? { note: opItem.note } : {}),
        ...(typeof opItem.evidence === 'string' ? { evidence: opItem.evidence } : {}),
        ...(typeof opItem.owner === 'string' ? { owner: opItem.owner } : {}),
        session: rootId,
        by: 'chief',
      })
      if (res && res.ok) executed.push(`更新任务 #${tid}${opItem.status ? ' → ' + opItem.status : ''}`)
    } else if (op === 'task.remove' && (opItem.id || opItem.taskId)) {
      const tid = String(opItem.id || opItem.taskId).trim()
      const res = deps.runAction({ action: 'task.remove', id: tid, session: rootId, by: 'chief' })
      if (res && res.ok) executed.push(`移除任务 #${tid}`)
    } else if (op === 'task.reset') {
      const res = deps.runAction({
        action: 'task.reset',
        ...(typeof opItem.status === 'string' ? { status: opItem.status } : {}),
        ...(opItem.resetPlan !== undefined ? { resetPlan: Boolean(opItem.resetPlan) } : {}),
        session: rootId,
        by: 'chief',
      })
      if (res && res.ok) executed.push(`重设任务看板(${res.removedCount ?? 0}项)`)
    } else if ((op === 'graph.plan' || op === 'task.batch') && Array.isArray(opItem.tasks) && opItem.tasks.length > 0) {
      const canSetObj = !objectiveLocked && typeof opItem.objective === 'string' && opItem.objective.trim()
      const res = deps.runAction({
        action: 'graph.plan',
        tasks: opItem.tasks,
        ...(canSetObj ? { objective: opItem.objective } : {}),
        ...(opItem.replace !== undefined ? { replace: Boolean(opItem.replace) } : {}),
        session: rootId,
        by: 'chief',
      })
      if (res && res.ok) executed.push(`重编任务拓扑(${(res.tasks || opItem.tasks).length}项)`)
    } else if (op === 'cursor.set') {
      const res = deps.runAction({
        action: 'cursor.set',
        ...(typeof opItem.step === 'string' ? { step: opItem.step } : {}),
        ...(typeof opItem.next === 'string' ? { next: opItem.next } : {}),
        ...(typeof opItem.blocked === 'string' ? { blocked: opItem.blocked } : {}),
        session: rootId,
        by: 'chief',
      })
      if (res && res.ok) executed.push('更新推进断点')
    } else if (op === 'plan.resetForGoal') {
      const res = deps.runAction({ action: 'plan.resetForGoal', session: rootId, by: 'chief' })
      if (res && res.ok) executed.push('清空陈旧计划以便按新目标重编')
    } else if (op === 'plan.set' && Array.isArray(opItem.steps)) {
      const steps = opItem.steps.map(s => (typeof s === 'string' ? { text: s, done: false } : s)).filter(Boolean)
      if (steps.length > 0) {
        const res = deps.runAction({ action: 'plan.set', steps, session: rootId, by: 'chief' })
        if (res && res.ok) executed.push(`更新计划共 ${steps.length} 步`)
      }
    } else if (op === 'goal.proposeApproval') {
      const res = deps.runAction({
        action: 'goal.proposeApproval',
        objective: String(opItem.objective || ''),
        summary: String(opItem.summary || ''),
        evidence: String(opItem.evidence || ''),
        session: rootId,
        by: 'chief',
      })
      if (res && res.ok) executed.push('呈批目标结项')
    } else if (op === 'bounds.set') {
      const rawField = String(opItem.field || '').trim().toLowerCase()
      const normField = rawField === 'must' ? 'allowed' : rawField
      const col = ['forbidden', 'allowed', 'notes'].includes(normField) ? normField : ''
      if (col && Array.isArray(opItem.items)) {
        const items = opItem.items.map(x => clamp(x, 220)).filter(Boolean)
        const res = deps.runAction({ action: 'bounds.set', field: col, items, session: rootId, by: 'chief', _callerOrigin: callerOrigin })
        if (res && res.ok) executed.push(`覆写边界(${col})共 ${items.length} 条`)
        else if (res && res.blockedBySafetyGuard) executed.push(`🛡️ 已拦截覆写红线(${col})`)
      } else if (Array.isArray(opItem.allowed) || Array.isArray(opItem.must) || Array.isArray(opItem.forbidden) || Array.isArray(opItem.notes)) {
        const allowList = Array.isArray(opItem.allowed) ? opItem.allowed : opItem.must
        const res = deps.runAction({
          action: 'bounds.set',
          ...(Array.isArray(allowList) ? { allowed: allowList.map(x => clamp(x, 220)).filter(Boolean) } : {}),
          ...(Array.isArray(opItem.forbidden) ? { forbidden: opItem.forbidden.map(x => clamp(x, 220)).filter(Boolean) } : {}),
          ...(Array.isArray(opItem.notes) ? { notes: opItem.notes.map(x => clamp(x, 220)).filter(Boolean) } : {}),
          session: rootId,
          by: 'chief',
          _callerOrigin: callerOrigin,
        })
        if (res && res.ok) executed.push('重置边界列表')
        else if (res && res.blockedBySafetyGuard) executed.push('🛡️ 已拦截批量覆写边界')
      }
    } else if ((op === 'bounds.forbid' || op === 'bounds.allow' || op === 'bounds.must' || op === 'bounds.note') && opItem.item) {
      const field = op === 'bounds.forbid' ? 'forbidden' : (op === 'bounds.note' ? 'notes' : 'allowed')
      const label = field === 'forbidden' ? '红线' : (field === 'notes' ? '注意' : '必做')
      const val = clamp(opItem.item, 220)
      const pinned = forceSessionOnly ? false : Boolean(opItem.pinGlobal)
      if (val) {
        const res = deps.runAction({
          action: 'bounds.add',
          field,
          item: val,
          pinned,
          session: rootId,
          by: 'chief',
          _callerOrigin: callerOrigin,
        })
        if (res && res.ok) {
          executed.push(`${pinned ? '📌全局' : '本任务'}${label}：${clamp(val, 30)}`)
        } else if (res && res.blockedBySafetyGuard) {
          executed.push(`🛡️ 已拦截写入边界(${field})`)
        }
      }
    } else if (op === 'bounds.remove' && opItem.item) {
      const field = ['forbidden', 'allowed', 'notes'].includes(opItem.field) ? opItem.field : 'forbidden'
      const val = clamp(opItem.item, 220)
      const pinned = forceSessionOnly ? false : Boolean(opItem.pinGlobal)
      if (val) {
        const res = deps.runAction({
          action: 'bounds.remove',
          field,
          item: val,
          pinned,
          session: rootId,
          by: 'chief',
          _callerOrigin: callerOrigin,
        })
        if (res && res.ok) {
          executed.push(`移除边界：${clamp(val, 30)}`)
        } else if (res && res.blockedBySafetyGuard) {
          executed.push(`🛡️ 已拦截移除红线(${field})`)
        }
      }
    }
  }
  return executed
}

/**
 * Execute Wishing-Box `archiveOps` across Session / Global / Precipitated vaults
 * while strictly preserving the upward gradient (`session -> global -> precipitated`;
 * direct session -> precipitated jump is forbidden).
 */
export const MAIN_INJECT_ARCHIVE_OPS = new Set(['pin_to_desktop', 'unpin_from_desktop', 'take_out', 'put_back', 'deliver_to_lead'])

export function normalizeArchiveOpName(rawOp) {
  const s = String(rawOp || '').trim()
  if (s === 'take_out') return 'pin_to_desktop'
  if (s === 'put_back') return 'unpin_from_desktop'
  return s
}

export function resolveItemIdForChiefScope(scope, rawId, rawTitle, { sessionOpt, globalOpt }) {
  const idQ = String(rawId || '').trim()
  const titleQ = String(rawTitle || '').trim().toLowerCase()
  const opt = scope === 'global' ? globalOpt : sessionOpt
  if (!opt) return idQ
  const store = loadArchiveStore(opt)
  const items = Array.isArray(store.items) ? store.items : []
  if (idQ) {
    const exact = items.find(it => it.id === idQ)
    if (exact) return exact.id
  }
  if (titleQ) {
    const byTitle = items.find(it => String(it.title || '').toLowerCase().includes(titleQ))
    if (byTitle) return byTitle.id
  }
  return idQ
}

/**
 * Shared Chief executor for main-session archive injection ops (`pin_to_desktop`, `unpin_from_desktop`, `deliver_to_lead`)
 * and `pull_global`, enforcing strict cold-vault isolation and dual-channel injection rules.
 */
export async function executeChiefArchiveInjectionOp(deps, rootId, opItem = {}, opts = {}) {
  const sid = rootId && rootId !== 'global' ? String(rootId).trim() : ''
  const op = normalizeArchiveOpName(opItem.op)
  const scope = opItem.vaultScope === 'precipitated'
    ? 'precipitated'
    : (opItem.vaultScope === 'global' ? 'global' : 'session')
  if (scope === 'precipitated' || op === 'pull_precipitated') {
    return { ok: false, blocked: true, error: '冷藏档案柜 100% 归属人类专属隔离，参谋无权读档或推送。' }
  }
  if (!sid) {
    return { ok: false, error: '当前为空白未绑定会话，无法推上桌面或递送主对话。' }
  }
  const globalOpt = archiveTargetForRoot(deps, sid, { vaultScope: 'global' })
  const sessionOpt = archiveTargetForRoot(deps, sid, { vaultScope: 'session' })
  const hitId = resolveItemIdForChiefScope(scope, opItem.id || opItem.archiveId, opItem.title, { sessionOpt, globalOpt })
  if (!hitId) {
    return { ok: false, error: '未匹配到目标工程档案。' }
  }
  const targetOpt = scope === 'global' ? globalOpt : sessionOpt

  if (op === 'pin_to_desktop' || op === 'unpin_from_desktop') {
    const mOp = op === 'pin_to_desktop' ? 'pinToDesktop' : 'unpinFromDesktop'
    const r = mutateArchive({
      op: mOp,
      vaultScope: scope,
      rootSessionId: sid,
      id: hitId,
      by: opts.by || 'chief',
    }, targetOpt)
    if (!r || !r.ok) {
      return { ok: false, error: (r && r.error) || '桌面调配失败' }
    }
    const ev = Array.isArray(r.evicted) && r.evicted.length > 0 ? `（超 2400 Tokens/6 份自动撤回：${r.evicted.map(x => `《${clamp(x.title, 18)}》`).join('、')}）` : ''
    const actionText = `${op === 'pin_to_desktop' ? '📌 摆上桌面' : '撤出桌面'} #${hitId}${ev}`
    return { ok: true, op, scope, id: hitId, evicted: r.evicted || [], actionText }
  }

  if (op === 'deliver_to_lead') {
    const det = getArchiveDetail(hitId, sid, targetOpt)
    if (!det || !det.ok || !det.item) {
      return { ok: false, error: '未读取到待递送档案内容' }
    }
    const it = det.item
    const ptLines = Array.isArray(it.points) && it.points.length > 0
      ? it.points.slice(0, 5).map(pt => `- ${pt.title}：${clamp(pt.detail || pt.cue, 180)}`)
      : []
    const instr = cleanMultiline(opItem.instruction || opItem.note || '', 240)
    const msgBody = [
      `[DSH 参谋长档案馆 · 一次性重点递送（不占桌面置顶槽）]`,
      `来源：${scope === 'global' ? '🌐 全局档案柜（参谋核准后专递）' : '🗂️ 本局档案柜'} · 《${clamp(it.title, 48)}》 (id=${it.id})`,
      instr ? `参谋附言：${instr}` : '',
      it.summary ? `提要：${clamp(it.summary, 200)}` : '',
      ...(ptLines.length ? ['核心要点：', ...ptLines] : []),
      !ptLines.length && it.body ? `正文节选：\n${clamp(it.body, 900)}` : '',
    ].filter(Boolean).join('\n')

    const deliverTarget = String(opItem.target || 'lead').trim() || 'lead'
    const deliv = await deliverCrossMessage(deps, {
      fromSession: sid,
      fromLabel: opts.byLabel || 'DSH 参谋长 (档案馆重点递送)',
      target: deliverTarget,
      subject: `档案馆递送《${clamp(it.title, 28)}》`,
      text: msgBody,
      mode: 'steer',
      envelopeKind: 'execution_request',
      recordBoardLog: true,
    })
    mutateArchive({ op: 'markDeliveredToLead', vaultScope: scope, rootSessionId: sid, id: hitId }, targetOpt)
    return {
      ok: Boolean(deliv && deliv.ok),
      op,
      scope,
      id: hitId,
      delivery: deliv,
      actionText: deliv && deliv.ok
        ? `📨 递送档案《${clamp(it.title, 20)}》→ ${deliv.target || deliverTarget}`
        : `递送失败：${(deliv && deliv.error) || '目标不可达'}`,
    }
  }

  if (op === 'pull_global') {
    const r = mutateArchive({ op: 'pullByChief', vaultScope: 'global', rootSessionId: sid, id: hitId }, globalOpt)
    if (r && r.ok) {
      return { ok: true, op, scope: 'global', id: hitId, actionText: `👁️ 参谋拉阅全局档案 #${hitId}` }
    }
    return { ok: false, error: (r && r.error) || '全局拉阅失败' }
  }

  return { ok: false, error: `不支持的档案注入指令：${op}` }
}

/**
 * Execute Wishing-Box `archiveOps` requested by user in natural language (`整理`/`提炼入全局`/内务操作),
 * strictly enforcing cold-vault 0-byte isolation (`precipitated` blocked) and upward gradient (`session -> global -> precipitated`).
 */
export async function applyArchiveOps(deps, rootId, archiveOps, ctx = {}) {
  const executed = []
  if (!Array.isArray(archiveOps) || !archiveOps.length) return { executed, changed: false }
  const sid = rootId && rootId !== 'global' ? String(rootId).trim() : ''
  const globalOpt = archiveTargetForRoot(deps, sid || 'global', { vaultScope: 'global' })
  const sessionOpt = sid ? archiveTargetForRoot(deps, sid, { vaultScope: 'session' }) : null
  let changed = false

  const resolveItemInScope = (scope, rawId, rawTitle) =>
    resolveItemIdForChiefScope(scope, rawId, rawTitle, { sessionOpt, globalOpt })

  for (const opItem of archiveOps.slice(0, 8)) {
    if (!opItem || typeof opItem !== 'object') continue
    const op = normalizeArchiveOpName(opItem.op)
    const scope = opItem.vaultScope === 'precipitated'
      ? 'precipitated'
      : (opItem.vaultScope === 'global' ? 'global' : 'session')

    // Cold vault (`precipitated`) is 100% human-only: Chief may never inspect, pin, or pull from it.
    if (scope === 'precipitated' || op === 'pull_precipitated') {
      executed.push('🧊 已拦截：冷藏档案柜仅人类可见，参谋无权读取或调取')
      continue
    }

    if (op === 'organize') {
      const orgScope = opItem.vaultScope === 'global' ? 'global' : 'session'
      if (orgScope === 'session' && !sid) continue
      const r = await organizeArchivesWithChief(deps, {
        sessionId: sid || 'global',
        vaultScope: orgScope,
        ids: Array.isArray(opItem.ids) ? opItem.ids : [],
        scope: opItem.scope === 'all' ? 'all' : 'unorganized',
        instruction: String(opItem.instruction || ctx.input || ''),
      }).catch(() => null)
      if (r && r.ok) {
        changed = true
        executed.push(`整理${orgScope === 'global' ? '全局' : '本局'}档案 ×${r.updatedCount ?? 0}`)
      }
    } else if (op === 'distill_to_global' || op === 'distill') {
      if (!sid) continue
      const r = await distillSessionArchivesToGlobal(deps, {
        sessionId: sid,
        ids: Array.isArray(opItem.ids) ? opItem.ids : (opItem.id ? [opItem.id] : []),
        instruction: String(opItem.instruction || ctx.input || ''),
      }).catch(() => null)
      if (r && r.ok) {
        changed = true
        executed.push(`提炼入全局 ×${r.createdCount ?? 0}`)
      }
    } else if (op === 'pull_global') {
      const r = await executeChiefArchiveInjectionOp(deps, rootId, { ...opItem, op: 'pull_global', vaultScope: 'global' })
      if (r && r.ok) {
        changed = true
        executed.push(r.actionText)
      }
    } else if (op === 'save' || op === 'create') {
      if (scope === 'session' && !sid) continue
      const targetOpt = scope === 'global' ? globalOpt : sessionOpt
      const allowPin = Boolean(opItem.takeOut) && optsTakeOutAllowed(ctx)
      const r = mutateArchive({
        op: 'save',
        vaultScope: scope,
        rootSessionId: sid,
        folder: opItem.folder || 'inbox',
        paperclip: ['gold', 'silver', 'copper'].includes(opItem.paperclip) ? opItem.paperclip : 'silver',
        title: clamp(opItem.title || '参谋长工作归档', 160),
        summary: clamp(opItem.summary || '', 400),
        body: cleanMultiline(opItem.body || opItem.summary || opItem.title || '', 12000),
        takeOutNow: allowPin,
        organizedBy: 'chief',
        by: 'chief',
      }, targetOpt)
      if (r && r.ok) {
        changed = true
        executed.push(`存档(${scope === 'global' ? '全局' : '本局'})：《${clamp(opItem.title || '', 24)}》`)
      }
    } else if (op === 'pin_to_desktop' || op === 'unpin_from_desktop' || op === 'deliver_to_lead') {
      const r = await executeChiefArchiveInjectionOp(deps, rootId, opItem, ctx)
      if (r && r.ok) {
        changed = true
        executed.push(r.actionText)
      }
    } else if (op === 'mount_chief' || op === 'unmount_chief') {
      if (!sid) continue
      const hitId = resolveItemInScope('global', opItem.id || opItem.archiveId, opItem.title)
      if (!hitId) continue
      const r = mutateArchive({
        op: op === 'mount_chief' ? 'mountChief' : 'unmountChief',
        vaultScope: 'global',
        rootSessionId: sid,
        id: hitId,
      }, globalOpt)
      if (r && r.ok) {
        changed = true
        executed.push(`${op === 'mount_chief' ? '参阅全局档案' : '取消全局参阅'} #${hitId}`)
      }
    } else if (op === 'copy_to_global') {
      if (!sid) continue
      const hitId = resolveItemInScope('session', opItem.id || opItem.archiveId, opItem.title)
      if (!hitId) continue
      const r = mutateArchive({ op: 'copyToGlobal', vaultScope: 'session', rootSessionId: sid, id: hitId }, sessionOpt)
      if (r && r.ok) {
        changed = true
        executed.push(`升入全局档案 #${hitId}`)
      }
    } else if (op === 'copy_to_session') {
      if (!sid) continue
      const hitId = resolveItemInScope('global', opItem.id || opItem.archiveId, opItem.title)
      if (!hitId) continue
      const r = mutateArchive({ op: 'copyToSession', vaultScope: 'global', rootSessionId: sid, id: hitId }, globalOpt)
      if (r && r.ok) {
        changed = true
        executed.push(`全局调入本局 #${hitId}`)
      }
    } else if (op === 'move_folder' && opItem.folder) {
      if (scope === 'session' && !sid) continue
      const targetOpt = scope === 'global' ? globalOpt : sessionOpt
      const hitId = resolveItemInScope(scope, opItem.id || opItem.archiveId, opItem.title)
      if (!hitId) continue
      const r = mutateArchive({ op: 'moveFolder', vaultScope: scope, rootSessionId: sid, id: hitId, folder: opItem.folder }, targetOpt)
      if (r && r.ok) {
        changed = true
        executed.push(`移动档案分类 → ${opItem.folder}`)
      }
    } else if (op === 'delete' || op === 'remove') {
      if (scope === 'session' && !sid) continue
      const targetOpt = scope === 'global' ? globalOpt : sessionOpt
      const hitId = resolveItemInScope(scope, opItem.id || opItem.archiveId, opItem.title)
      if (!hitId) continue
      const r = mutateArchive({ op: 'delete', vaultScope: scope, rootSessionId: sid, id: hitId }, targetOpt)
      if (r && r.ok) {
        changed = true
        executed.push(`移除${scope === 'global' ? '全局' : '本局'}档案 #${hitId}`)
      }
    }
  }

  return { executed, changed }
}

export function optsTakeOutAllowed(ctx) {
  return Boolean(ctx && ctx.allowPinToDesktop !== false)
}

/** Execute Wishing-Box `networkOps` to link or unlink standalone DSH sessions. */
export function applyNetworkOps(rootId, networkOps, directory) {
  const executed = []
  if (!Array.isArray(networkOps) || !networkOps.length || !rootId || rootId === 'global') return executed
  const otherSessions = (directory && Array.isArray(directory.otherSessions)) ? directory.otherSessions : []

  for (const opItem of networkOps.slice(0, 6)) {
    if (!opItem || typeof opItem !== 'object') continue
    const op = String(opItem.op || '').trim()
    if (op !== 'link' && op !== 'unlink') continue
    const rawQ = String(opItem.targetSessionId || opItem.target || opItem.sessionId || opItem.name || '').trim()
    if (!rawQ) continue
    const qLower = rawQ.toLowerCase()
    const match = otherSessions.find(s =>
      s.id === rawQ
      || String(s.id).toLowerCase().includes(qLower)
      || (s.name && String(s.name).toLowerCase().includes(qLower))
    )
    const targetSid = match ? match.id : (/^session-/i.test(rawQ) ? rawQ : '')
    if (!targetSid || targetSid === rootId) continue
    const r = setPeerLink(rootId, targetSid, op === 'link')
    if (r && r.ok) {
      executed.push(`${op === 'link' ? '连接协同窗口' : '断开协同窗口'}：${match ? match.name : targetSid.slice(0, 14)}`)
    }
  }
  return executed
}

/** Detect pure beginner progress/status questions where all truth is already in live snapshot + board (zero disk/shell tools needed). */

export async function consolidateBoundsWithChief(deps, {
  sessionId = '',
  field = '',
  items = [],
  instruction = '',
} = {}) {
  const rootId = (deps.resolveRootSessionId && deps.resolveRootSessionId(sessionId)) || String(sessionId || 'global')
  const board = deps.boardForSession && deps.boardFileFor
    ? deps.boardForSession(deps.boardFileFor(rootId))
    : { bounds: { allowed: [], forbidden: [], notes: [] }, pinnedBounds: { allowed: [], forbidden: [], notes: [] } }
  const bounds = (board && board.bounds) || { allowed: [], forbidden: [], notes: [] }
  const pinnedBounds = (board && board.pinnedBounds) || { allowed: [], forbidden: [], notes: [] }
  const BOUND_COL_LABEL = { forbidden: '禁止红线', allowed: '必做事项', notes: '注意事项' }

  // Determine which column(s) to consolidate
  const targetCols = []
  const explicitItems = Array.isArray(items)
    ? items.map(x => String(x || '').trim()).filter(Boolean)
    : []

  const normField = String(field || '').trim().toLowerCase() === 'must' ? 'allowed' : field
  if (['forbidden', 'allowed', 'notes'].includes(normField)) {
    const colList = Array.isArray(bounds[normField]) ? bounds[normField] : []
    const chosen = explicitItems.length >= 2
      ? colList.filter(x => explicitItems.includes(x))
      : colList
    if (chosen.length < 2) {
      return { ok: false, error: `【${BOUND_COL_LABEL[normField]}】当前不足 2 条规则，无需浓缩合并。` }
    }
    targetCols.push({ col: normField, sourceItems: chosen })
  } else if (explicitItems.length >= 2) {
    // Infer column with most matches, default forbidden
    let bestCol = 'forbidden'
    let bestHits = -1
    for (const c of ['forbidden', 'allowed', 'notes']) {
      const hits = (bounds[c] || []).filter(x => explicitItems.includes(x)).length
      if (hits > bestHits) {
        bestHits = hits
        bestCol = c
      }
    }
    targetCols.push({ col: bestCol, sourceItems: explicitItems })
  } else {
    for (const c of ['forbidden', 'allowed', 'notes']) {
      const colList = Array.isArray(bounds[c]) ? bounds[c] : []
      if (colList.length >= 2) {
        targetCols.push({ col: c, sourceItems: colList })
      }
    }
    if (!targetCols.length) {
      return { ok: false, error: '当前各边界分栏均不足 2 条零散规则，暂时无需合并。' }
    }
  }

  const consWorkId = beginChiefActiveWork(rootId, {
    tone: 'bounds',
    tab: 'boundaries',
    boundSubTab: 'rules',
    label: '参谋长正在浓缩边界中...',
  })
  try {
    const createdProposals = []
    for (const { col, sourceItems } of targetCols) {
      const colLabel = BOUND_COL_LABEL[col] || '禁止红线'
      const hadPinned = sourceItems.some(x => (pinnedBounds[col] || []).includes(x))
      const prompt = [
        `目标边界分栏：【${colLabel}】（${col}）`,
        instruction ? `用户额外要求：${clamp(instruction, 200)}` : '',
        `待浓缩合并的 ${sourceItems.length} 条零散边界：`,
        ...sourceItems.map((it, idx) => `${idx + 1}. ${(pinnedBounds[col] || []).includes(it) ? '[📌全局定住] ' : ''}${it}`),
        '',
        '请将以上零散规则浓缩合并为唯一 1 条高密度总则（保留具体命令、路径与硬红线），只输出 JSON：',
      ].filter(Boolean).join('\n')

      const llmRes = await callChiefLlm(deps, {
        sessionId: rootId,
        reasonKind: 'consolidate_bounds',
        system: CONSOLIDATE_BOUNDS_SYSTEM,
        prompt,
        maxTokens: SUMMARY_MAX_TOKENS,
      })

      const parsed = llmRes.ok ? extractJsonObject(llmRes.text) : null
      const mergedText = clamp(
        (parsed && (parsed.item || parsed.draftText || parsed.text)) || deterministicConsolidateClauses(sourceItems),
        220,
      )
      const mergedReason = clamp(
        (parsed && parsed.reason) || `已将【${colLabel}】下 ${sourceItems.length} 条零散边界浓缩合成为 1 条总则，批准后自动替换原零散条目。`,
        180,
      )

      if (!mergedText || secretLike(mergedText)) continue

      mutateChiefState((s) => {
        const ws = ensureWorkspace(s, rootId)
        // Dismiss older pending consolidation proposals for the exact same column to avoid clutter
        for (const existing of ws.suggestions) {
          if (existing.status === 'pending' && existing.kind === 'bound' && existing.boundField === col && Array.isArray(existing.replaces) && existing.replaces.length > 0) {
            existing.status = 'dismissed'
          }
        }
        const sug = normalizeSuggestion({
          kind: 'bound',
          boundField: col,
          fromAgent: '✦ 参谋长浓缩',
          title: `${colLabel} ${sourceItems.length} 合 1：${clamp(mergedText, 26)}`,
          reason: mergedReason,
          target: 'bounds',
          targetLabel: colLabel,
          mode: 'silent',
          draftText: mergedText,
          replaces: sourceItems,
          pinGlobal: hadPinned,
        })
        if (sug) {
          ws.suggestions.push(sug)
          createdProposals.push(sug)
        }
      })
    }

    if (!createdProposals.length) {
      return { ok: false, error: '未能生成浓缩边界，请稍后重试。' }
    }

    const replyLines = createdProposals.map(p =>
      `- 【${p.targetLabel} · ${p.replaces.length} 合 1】${p.draftText}（可在上方请示卡片选「📌 定住全局」或「仅本任务」一键替换）`,
    )

    return {
      ok: true,
      proposals: createdProposals,
      reply: replyLines.join('\n'),
      view: await getChiefView(deps, rootId, { autoSummarize: false }),
    }
  } finally {
    endChiefActiveWork(rootId, consWorkId)
  }
}


export function proposeBoundToChief(deps, { sessionId, callerAgent, by, field, item, items, reason }) {
  const sid = String(sessionId || (callerAgent && callerAgent.id) || '').trim()
  const rootId = (deps.resolveRootSessionId && deps.resolveRootSessionId(sid, callerAgent)) || sid || 'global'
  const identity = deps.resolveAgentIdentity ? deps.resolveAgentIdentity(deps.runtime, sid, callerAgent) : null
  const speaker = identity && identity.isChild
    ? `@${identity.self}`
    : (by && by !== 'agent' ? String(by) : '@lead')

  const rawCol = String(field || '').trim().toLowerCase()
  const normCol = rawCol === 'must' ? 'allowed' : rawCol
  const col = ['forbidden', 'allowed', 'notes'].includes(normCol) ? normCol : 'forbidden'
  const BOUND_COL_LABEL = { forbidden: '禁止红线', allowed: '必做事项', notes: '注意事项' }
  const colLabel = BOUND_COL_LABEL[col] || '禁止红线'

  const rawItems = []
  if (typeof item === 'string' && item.trim()) rawItems.push(item.trim())
  if (Array.isArray(items)) {
    for (const entry of items) {
      if (typeof entry === 'string' && entry.trim()) rawItems.push(entry.trim())
    }
  }
  if (!rawItems.length) {
    return { ok: false, error: 'bounds.propose requires item (string) or items (string[])' }
  }

  const board = deps.boardForSession && deps.boardFileFor && rootId !== 'global'
    ? deps.boardForSession(deps.boardFileFor(rootId))
    : null
  const existingCol = Array.isArray(board?.bounds?.[col]) ? board.bounds[col] : []

  const proposed = []
  const skippedDuplicates = []

  mutateChiefState((state) => {
    const ws = ensureWorkspace(state, rootId)
    for (const rawRule of rawItems.slice(0, 6)) {
      const ruleText = clamp(rawRule, 220)
      if (!ruleText || secretLike(ruleText)) continue
      if (existingCol.some(x => String(x).trim() === ruleText)) {
        skippedDuplicates.push(ruleText)
        continue
      }
      const dupPending = ws.suggestions.some(
        s => s.status === 'pending' && s.kind === 'bound' && s.draftText === ruleText,
      )
      if (dupPending) {
        skippedDuplicates.push(ruleText)
        continue
      }
      const sug = normalizeSuggestion({
        kind: 'bound',
        boundField: col,
        fromAgent: speaker,
        title: `拟入${colLabel}：${clamp(ruleText, 30)}`,
        reason: clamp(reason || `${speaker} 在执行中上报的边界约束，请批准后注入全局边界。`, 180),
        target: 'bounds',
        targetLabel: colLabel,
        mode: 'silent',
        draftText: ruleText,
      })
      if (sug) {
        const pendingNonBound = ws.suggestions.filter(s => s.status === 'pending' && s.kind !== 'bound')
        const pendingAll = ws.suggestions.filter(s => s.status === 'pending')
        if (pendingAll.length >= SUGGESTIONS_CAP && pendingNonBound.length > 0) {
          pendingNonBound[0].status = 'dismissed'
        }
        ws.suggestions.push(sug)
        proposed.push(sug)
      }
    }
  })

  if (proposed.length && typeof deps.appendBoardLog === 'function' && rootId !== 'global') {
    deps.appendBoardLog(
      rootId,
      `🏛 收到边界奏请 (${colLabel})：${proposed.map(p => clamp(p.draftText, 40)).join('；')}`,
      speaker,
    )
  }

  return {
    ok: true,
    proposed: proposed.map(p => ({ id: p.id, field: p.boundField, item: p.draftText, from: p.fromAgent })),
    skippedDuplicates,
    message: proposed.length
      ? `已呈交 DSH 参谋长（共 ${proposed.length} 条），参谋长正请示用户批准后注入全局【${colLabel}】。`
      : '该边界已在全局边界或待批请示列表中，无需重复上报。',
  }
}


export async function suggestCoreObjectiveWithChief(deps, {
  sessionId = '',
  draft = '',
  mode = 'auto',
  previousSuggestions = [],
} = {}) {
  const rootId = (deps && typeof deps.resolveRootSessionId === 'function' ? deps.resolveRootSessionId(sessionId) : sessionId) || String(sessionId || 'global')
  const rawDraft = String(draft || '').replace(/\s+/g, ' ').trim()
  const prevList = (Array.isArray(previousSuggestions) ? previousSuggestions : [])
    .map(x => String(x || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(-12)

  const normalizedDraft = rawDraft.toLowerCase()
  const isCycleOfPreviousAi = Boolean(
    rawDraft && prevList.some(p => p.toLowerCase() === normalizedDraft),
  )
  const effectiveMode = (mode === 'refine' || (mode === 'auto' && rawDraft && !isCycleOfPreviousAi))
    ? 'refine'
    : 'guess'

  const directory = await listPeerDirectory(deps, rootId)
  const board = deps && deps.boardForSession && deps.boardFileFor
    ? deps.boardForSession(deps.boardFileFor(rootId))
    : null
  const liveDigest = collectLiveConversationsDigest(deps, rootId, directory)
  const state = loadChiefState()
  const view = clusterView(state, rootId)
  const numberedFacts = view.facts.slice(-8)
  const planSteps = Array.isArray(board && board.plan) ? board.plan.filter(Boolean) : []
  const openPlan = planSteps.filter(s => !s.done)
  const tasks = Array.isArray(board && board.tasks) ? board.tasks : []
  const activeTasks = tasks.filter(t => t && (t.status === 'doing' || t.status === 'todo' || t.status === 'blocked'))
  const bounds = (board && board.bounds) || { allowed: [], forbidden: [], notes: [] }
  const leadEntry = (liveDigest.entries || []).find(e => e.kind === 'lead') || (liveDigest.entries || [])[0] || null
  const latestUser = (leadEntry && leadEntry.lastUser) ? leadEntry.lastUser : ''
  const existingObj = board && board.objective ? String(board.objective).trim() : ''

  // Build non-repeating deterministic fallback candidates ordered by attempt index
  const buildFallbackCandidate = () => {
    if (effectiveMode === 'refine' && rawDraft) {
      const cleanDraft = clamp(rawDraft.replace(/[。；;]+$/, ''), 96)
      const refined = /完成|实现|通过|验证|修复|交付|生成|输出/.test(cleanDraft)
        ? `${cleanDraft}，确保可实测验收后收尾`
        : `完成「${cleanDraft}」并完成实测核验`
      return {
        suggestion: clamp(refined, 120),
        rationale: '已保留您原有核心意图，并补充清晰的可验收收口标准。',
      }
    }

    const candidates = []
    if (latestUser) {
      candidates.push({
        suggestion: clamp(`彻底完成用户当前诉求「${clamp(latestUser, 72)}」并经实测核验交付`, 120),
        rationale: '根据主对话最近一次真实诉求提炼的核心目标。',
      })
    }
    if (openPlan.length > 0) {
      candidates.push({
        suggestion: clamp(`按小任务板推进完成：${openPlan.slice(0, 2).map(s => clamp(s.text, 38)).join(' → ')}`, 120),
        rationale: '聚焦小任务板当前尚未勾选的待办节点。',
      })
    }
    if (activeTasks.length > 0) {
      candidates.push({
        suggestion: clamp(`攻克在手关键任务（${activeTasks.slice(0, 2).map(t => clamp(t.title, 36)).join('、')}）并通过验证`, 120),
        rationale: '围绕目前推进中与待办的核心任务收敛目标。',
      })
    }
    if (existingObj) {
      candidates.push({
        suggestion: clamp(`${existingObj.replace(/[。；;]+$/, '')}，完成全部必做事项与实证验收`, 120),
        rationale: '在当前规划核心目标基础上强化完结验收基准。',
      })
    }
    if (bounds.allowed && bounds.allowed.length > 0) {
      candidates.push({
        suggestion: clamp(`推进完成本轮主线研发与交付（必做：${clamp(bounds.allowed[0], 55)}）`, 120),
        rationale: '结合当前必做事项清单拟定的可监督落地目标。',
      })
    }
    if (leadEntry && leadEntry.lastAssistant) {
      candidates.push({
        suggestion: clamp(`收口当前主线工作（${clamp(leadEntry.lastAssistant, 68)}）并验证通过`, 120),
        rationale: '结合主对话最新工作现场推断的收尾目标。',
      })
    }
    candidates.push(
      {
        suggestion: '完整实现本轮设定功能需求、完成自测校验并清晰交付最终结果',
        rationale: '通用端到端实现与实测交付目标。',
      },
      {
        suggestion: '排查解决当前阻断卡点与遗留缺陷，确保系统运行稳定并通过复测',
        rationale: '偏向排查修复与稳定收口的兜底目标。',
      },
    )

    const prevNormSet = new Set(prevList.map(x => x.toLowerCase()))
    const chosen = candidates.find(c => !prevNormSet.has(String(c.suggestion || '').toLowerCase()))
      || candidates[prevList.length % candidates.length]
    return chosen
  }

  const promptLines = [
    `当前执行模式: ${effectiveMode === 'refine' ? 'refine（在用户已有核心目标文字上微调润色）' : 'guess（结合现场上下文猜想用户想要的核心目标，允许反复点建议继续猜）'}`,
    `工作区当前已填核心目标: ${existingObj || '（空）'}`,
    ...(rawDraft ? [`用户输入框当前文字: ${rawDraft}`] : ['用户输入框当前文字: （空）']),
    ...(prevList.length > 0 ? [`已给过的建议（严禁重复或仅微调措辞，须从新角度继续猜）:\n${prevList.map((p, i) => `  ${i + 1}. ${p}`).join('\n')}`] : []),
    `主对话最近用户原始诉求: ${latestUser || '（暂未捕捉）'}`,
    `小任务板 (Plan) 未完步骤: ${openPlan.slice(0, 4).map(s => clamp(s.text, 60)).join('；') || '（无）'}`,
    `在手任务 (doing/blocked/todo): ${activeTasks.slice(0, 5).map(t => `[${t.status}] ${clamp(t.title, 48)}`).join('；') || '（无）'}`,
    `必做事项 (allowed): ${(bounds.allowed || []).slice(0, 4).join('；') || '（无）'}`,
    `禁止红线 (forbidden): ${(bounds.forbidden || []).slice(0, 4).join('；') || '（无）'}`,
    `主对话现场摘要: ${leadEntry ? clamp(leadEntry.lastAssistant || '', 260) : '（无）'}`,
    ...(numberedFacts.length ? [`近期重要结论: ${numberedFacts.slice(-4).map(f => clamp(f.text, 90)).join('；')}`] : []),
  ]

  let suggestion = ''
  let rationale = ''
  let llmUsed = false

  try {
    const llmRes = await callChiefLlm(deps, {
      sessionId: rootId,
      reasonKind: 'suggest_objective',
      system: OBJECTIVE_SUGGEST_SYSTEM,
      prompt: promptLines.join('\n'),
      maxTokens: 320,
    })
    if (llmRes && llmRes.ok && llmRes.text) {
      const parsed = extractJsonObject(llmRes.text)
      if (parsed && typeof parsed.suggestion === 'string' && parsed.suggestion.trim()) {
        const cleaned = cleanMultiline(stripModelControlMarkup(stripToolCallMarkup(parsed.suggestion)), 160).replace(/\s+/g, ' ').trim()
        const isDuplicateGuess = effectiveMode === 'guess' && prevList.some(p => p.toLowerCase() === cleaned.toLowerCase())
        if (cleaned && !isDuplicateGuess) {
          suggestion = clamp(cleaned, 120)
          rationale = clamp(String(parsed.rationale || '').trim(), 90)
          llmUsed = true
        }
      }
    }
  } catch {}

  if (!suggestion) {
    const fb = buildFallbackCandidate()
    suggestion = fb.suggestion
    rationale = fb.rationale
  }

  return {
    ok: true,
    suggestion,
    rationale: rationale || (effectiveMode === 'refine' ? '已在您原文基础上完成微调。' : '已结合当前对话态势为您揣摩建议。'),
    mode: effectiveMode,
    llmUsed,
  }
}

/**
 * Lead-to-Chief direct communication handler (`chief.request` / `mail.send({ target: 'chief' })`).
 * Applies L0–L3 permission-tiered handling so Lead requests either queue advice + elevation (L0/L1),
 * queue one-click user approval (L2), or execute & reply directly via Chief (L3).
 */
export async function handleLeadDirectRequestToChief(deps, {
  fromSession = '',
  fromLabel = '主对话 (@lead)',
  subject = '',
  text = '',
} = {}) {
  const cleanBody = cleanMultiline(text, 2400)
  if (!cleanBody) return { ok: false, error: '传话给参谋长的内容不能为空' }
  const rootId = (deps && typeof deps.resolveRootSessionId === 'function' ? deps.resolveRootSessionId(fromSession) : '') || String(fromSession || 'global')
  const state = loadChiefState()
  const ownWs = ensureWorkspace(state, rootId)
  const effCfg = resolveWorkspaceConfig(state, rootId)
  const hasChiefRiskAck = hasValidChiefRiskAck(ownWs)
  const permissionMode = normalizePermissionMode(effCfg.permissionMode || DEFAULT_CHIEF_PERMISSION_MODE, {
    requireAck: true,
    hasChiefRiskAck,
  })
  const permRank = permissionRank(permissionMode)
  const summaryTitle = clamp(subject || cleanBody, 48)
  let ledgerTaskId = ''

  // Rare path: Lead / Subagent reports an insurmountable dynamic guard-wall blocker -> read-only Chief evaluation first; any wall removal still requires explicit human approval across L0-L3
  const combinedReqText = `${subject || ''} ${cleanBody}`
  const isWallBlockerEscalation = /(?:撞墙阻断|物理驻墙|物理墙|自定义拦截规则|拦截规则|无法绕过|事前物理拦截|guard_wall|wall-[a-z0-9]+)/i.test(combinedReqText)
  if (isWallBlockerEscalation) {
    const cwdNow = resolveSessionWorkspaceCwd(deps, rootId)
    const activeWallsNow = listGuardWalls({ cwd: cwdNow }).filter(w => w && w.scope !== 'paused')
    if (activeWallsNow.length > 0) {
      if (!askOrCommandChiefRunner) throw new Error('askOrCommandChief runner not registered')
      const evalRes = await askOrCommandChiefRunner(deps, {
        sessionId: rootId,
        text: `[来自 ${fromLabel} 的阻断上报 · ${subject || '拦截规则评估'}]\n${cleanBody}`,
        _fromLeadRequest: true,
        _wallBlockerEscalation: true,
      })
      if (evalRes && Array.isArray(evalRes.wallRemovalProposals) && evalRes.wallRemovalProposals.length > 0) {
        return {
          ok: true,
          mode: permissionMode,
          actionTaken: 'wall_removal_requested',
          wallRemovalProposals: evalRes.wallRemovalProposals,
          reply: evalRes.reply || '',
          ...(evalRes.view ? { view: evalRes.view } : {}),
        }
      }
      if (evalRes && evalRes.ok) {
        return {
          ok: true,
          mode: permissionMode,
          actionTaken: 'wall_blocker_evaluated',
          reply: evalRes.reply || '',
          ...(evalRes.view ? { view: evalRes.view } : {}),
        }
      }
    }
  }

  mutateChiefState((s) => {
    const ws = ensureWorkspace(s, rootId)
    const entry = upsertTaskLedgerOnWs(ws, {
      kind: permRank < 2 ? 'elevation_resume' : (permRank === 2 ? 'approval_resume' : 'tool_execution'),
      status: permRank < 2 ? 'awaiting_elevation' : (permRank === 2 ? 'awaiting_approval' : 'running'),
      originalText: `[主对话直传求助 · ${fromLabel}] ${subject ? subject + '：' : ''}${cleanBody}`,
      forcedTarget: 'lead',
      lastReceipt: `收到 ${fromLabel} 直传协同请求，按 ${permissionMode} 权限处置中`,
    })
    if (entry) ledgerTaskId = entry.taskId
  })

  // L0 (advisor) / L1 (assistant): queue readable advice + optional elevation request (never mutate workspace directly)
  if (permRank < 2) {
    const curWs = ensureWorkspace(loadChiefState(), rootId)
    const existingPendingElev = curWs.pendingElevation && curWs.pendingElevation.status === 'pending'
      ? { ...curWs.pendingElevation }
      : null
    const elv = existingPendingElev || requestChiefElevation(rootId, {
      fromMode: permissionMode,
      targetMode: 'strategist',
      reason: `主对话（${fromLabel}）请求参谋长协同处置：${clamp(subject || cleanBody, 90)}`,
      requestedActionSummary: clamp(cleanBody, 160),
      by: 'chief',
    })
    mutateChiefState((s) => {
      const ws = ensureWorkspace(s, rootId)
      const sug = normalizeSuggestion({
        kind: 'advice',
        fromAgent: '📨 主对话直传求助',
        title: `参谋建议 · 响应主对话：${clamp(summaryTitle, 32)}`,
        reason: `主对话主动发起协同请示（当前 ${CHIEF_PERMISSION_META[permissionMode]?.level || permissionMode} 只读/参谋档），请您拍板或批准升档执行。`,
        target: 'lead',
        targetLabel: '主对话 (@lead)',
        mode: 'followup',
        draftText: clamp(`关于「${subject || '协同请求'}」的参谋建议：请先评估影响范围与验证方案；如已批准升档，我可进一步协调执行。原请求：${cleanBody}`, 420),
      })
      if (sug) {
        ws.suggestions.push(sug)
        if (ws.suggestions.length > SUGGESTIONS_CAP) ws.suggestions = ws.suggestions.slice(-SUGGESTIONS_CAP)
      }
      if (ledgerTaskId) {
        upsertTaskLedgerOnWs(ws, {
          id: ledgerTaskId,
          taskId: ledgerTaskId,
          kind: 'elevation_resume',
          status: 'awaiting_elevation',
          originalText: `[主对话直传求助 · ${fromLabel}] ${cleanBody}`,
          elevationId: elv ? elv.id : '',
          lastReceipt: `已生成参谋建议${elv ? '并发起 L2 提权请示' : ''}`,
        })
      }
      ws.chat.push({
        id: nextId('chat'),
        role: 'chief',
        kind: 'receipt',
        text: [
          `- 【📨 收到主对话直传请求（当前 ${CHIEF_PERMISSION_META[permissionMode]?.level || permissionMode}）】来自 ${fromLabel}${subject ? ` · ${subject}` : ''}`,
          `- 【请求摘要】${clamp(cleanBody, 220)}`,
          `- 【处置结果】已生成参谋建议并${elv ? '向您发起「🔐 升至 L2 · 参谋模式」提权请示' : '记入建议栏'}；您拍板或提权后即可向主对话投递执行批复。`,
        ].join('\n'),
        actions: ['主对话直传求助', ...(elv ? ['🔐 请示提权 L2'] : ['💡 已呈报建议'])],
        at: Date.now(),
      })
      if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
    })
    return {
      ok: true,
      mode: permissionMode,
      actionTaken: 'suggested_or_elevation_requested',
      taskId: ledgerTaskId,
      ...(elv ? { elevationRequested: elv } : {}),
    }
  }

  // L2 (strategist): queue actionable approval & suggestion for one-click human confirmation
  if (permRank === 2) {
    const replyDraft = `已核准来自主对话的协同请求（${subject || '协同处理'}）：请按约定继续推进，并在完成后提交验证证据。`
    const apr = queueChiefApproval(rootId, {
      category: 'main_workflow',
      operationLabel: '响应主对话直接协同请求',
      targetLabel: '主对话 (@lead)',
      reason: clamp(subject || '主对话请求参谋长协同处置', 140),
      impact: '点击「允许本次操作」后，将向主对话投递参谋协同批复执行请求',
      preview: clamp(cleanBody, 240),
      kind: 'relay',
      capabilityScope: buildCapabilityScope({ kind: 'relay', tool: 'relay', target: 'lead' }),
      payload: {
        fromSession: rootId,
        fromLabel: 'DSH 参谋 (获批响应主对话)',
        target: 'lead',
        subject: subject || '参谋协同批复',
        text: replyDraft,
        mode: 'steer',
        envelopeKind: 'execution_request',
        taskId: ledgerTaskId,
      },
      by: 'chief',
    })
    mutateChiefState((s) => {
      const ws = ensureWorkspace(s, rootId)
      const sug = normalizeSuggestion({
        kind: 'relay',
        fromAgent: '📨 主对话直传求助',
        title: `批复主对话：${clamp(summaryTitle, 32)}`,
        reason: 'L2 参谋模式下已挂入逐项授权弹窗，也可直接点击上方「执行建议」批准投递。',
        target: 'lead',
        targetLabel: '主对话 (@lead)',
        mode: 'steer',
        draftText: replyDraft,
      })
      if (sug) {
        ws.suggestions.push(sug)
        if (ws.suggestions.length > SUGGESTIONS_CAP) ws.suggestions = ws.suggestions.slice(-SUGGESTIONS_CAP)
      }
      if (ledgerTaskId) {
        upsertTaskLedgerOnWs(ws, {
          id: ledgerTaskId,
          taskId: ledgerTaskId,
          kind: 'approval_resume',
          status: 'awaiting_approval',
          originalText: `[主对话直传求助 · ${fromLabel}] ${cleanBody}`,
          pendingApprovalIds: apr ? [apr.id] : [],
          lastReceipt: '已挂入 L2 待确认审批与参谋建议',
        })
      }
      ws.chat.push({
        id: nextId('chat'),
        role: 'chief',
        kind: 'receipt',
        text: [
          `- 【📨 收到主对话直传请求（L2 · 参谋逐项授权）】来自 ${fromLabel}${subject ? ` · ${subject}` : ''}`,
          `- 【请求摘要】${clamp(cleanBody, 220)}`,
          `- 【处置结果】已生成待确认动作${apr ? `（#${apr.id}）` : ''}并弹出授权提示，您确认后将立刻投递给主对话。`,
        ].join('\n'),
        actions: ['主对话直传求助', '🛡️ 待逐项确认'],
        at: Date.now(),
      })
      if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
    })
    return {
      ok: true,
      mode: 'strategist',
      actionTaken: 'queued_for_approval',
      taskId: ledgerTaskId,
      approval: apr,
    }
  }

  // L3 (chief): directly run Chief handling & reply back to @lead via execution_request
  // UNLESS Lead explicitly escalated a user-facing decision / hard blocker (prevent echoing human prompts back to @lead)
  if (!askOrCommandChiefRunner) throw new Error('askOrCommandChief runner not registered')
  const isHumanEscalationReq = /(?:(?:递呈|转呈|转交|提交|上报|交给|呈报)(?:给)?(?:用户|人类|总司令|老板)|请(?:用户|您)拍板|不是继续催我|不要(?:再)?催我|硬阻塞[^\n]{0,30}(?:用户|拍板|SSH|凭证)|等待用户(?:拍板|提供|确认))/i.test(combinedReqText)
  const execRes = await askOrCommandChiefRunner(deps, {
    sessionId: rootId,
    text: `[来自 ${fromLabel} 的直接协同请求${subject ? ` · ${subject}` : ''}]\n${cleanBody}`,
    _fromLeadRequest: true,
  })
  const replyTxt = String((execRes && execRes.reply) || '')
  const isUserAddressedBlockerReply = /(?:请您|请直接回复|等您过目拍板|用户需要提供什么|需要您拍板|三选一)/i.test(replyTxt)
    && /(?:受阻|阻塞|SSH|凭证|拍板|三选一|无法继续|已停滞)/i.test(replyTxt)
  const alreadyRelayed = Boolean(execRes && Array.isArray(execRes.relays) && execRes.relays.some(r => r && r.ok))
  if (!alreadyRelayed && (isHumanEscalationReq || isUserAddressedBlockerReply)) {
    let pausedIntervention = false
    mutateChiefState((s) => {
      const ws = ensureWorkspace(s, rootId)
      const cfg = resolveWorkspaceConfig(s, rootId)
      if (cfg && cfg.tacticalModes && cfg.tacticalModes.intervention) {
        if (!ws.config || typeof ws.config !== 'object') ws.config = { ...cfg }
        ws.config.tacticalModes = {
          ...normalizeTacticalModes(ws.config.tacticalModes),
          intervention: false,
        }
        if (s.config && typeof s.config === 'object') {
          s.config.tacticalModes = {
            ...normalizeTacticalModes(s.config.tacticalModes),
            intervention: false,
          }
        }
        pausedIntervention = true
      }
      ws.runtimeGuard.circuitBroken = true
      ws.runtimeGuard.circuitReason = '主对话已上报外部硬阻塞并转呈用户拍板，强介入已自动暂停'
      ws.runtimeGuard.interventionTurns = 0
      ws.runtimeGuard.unchangedCount = 0
      pushAuditToWs(ws, {
        mode: permissionMode,
        stage: 'safety_guard',
        decision: 'escalated_to_user',
        operation: '硬阻塞升级用户拍板（停止回弹主对话）',
        target: 'user',
        reason: clamp(replyTxt || cleanBody, 160),
        outcome: 'paused',
        by: 'chief',
      })
      pushAlertEventToWs(ws, {
        kind: 'blocker_halt',
        level: 'warn',
        title: '主对话上报硬阻塞 · 请您拍板',
        body: clamp(replyTxt || cleanBody, 240),
        dedupeKey: `esc:${rootId}:${Math.floor(Date.now() / 15_000)}`,
        at: Date.now(),
      })
      if (ledgerTaskId) {
        upsertTaskLedgerOnWs(ws, {
          id: ledgerTaskId,
          taskId: ledgerTaskId,
          kind: 'tool_execution',
          status: 'completed',
          originalText: `[主对话直传求助 · ${fromLabel}] ${cleanBody}`,
          lastReceipt: '已转呈用户拍板并暂停强介入（未回弹主对话）',
          resolvedAt: Date.now(),
        })
      }
    })
    if (deps && typeof deps.cancelAutoContinue === 'function') {
      try { deps.cancelAutoContinue(rootId, 'blocker-escalated') } catch {}
    }
    return {
      ok: Boolean(execRes && execRes.ok !== false),
      mode: 'chief',
      actionTaken: 'escalated_to_user',
      pausedIntervention,
      taskId: ledgerTaskId,
      reply: replyTxt,
      ...(execRes && execRes.view ? { view: execRes.view } : {}),
    }
  }
  if (!alreadyRelayed && execRes && execRes.reply) {
    try {
      await deliverCrossMessage(deps, {
        fromSession: rootId,
        fromLabel: 'DSH 参谋长 (L3 协同批复)',
        target: 'lead',
        subject: subject || '参谋长协同批复',
        text: execRes.reply,
        mode: 'steer',
        envelopeKind: 'execution_request',
        taskId: ledgerTaskId,
      })
    } catch {}
  }
  mutateChiefState((s) => {
    const ws = ensureWorkspace(s, rootId)
    if (ledgerTaskId) {
      upsertTaskLedgerOnWs(ws, {
        id: ledgerTaskId,
        taskId: ledgerTaskId,
        kind: 'tool_execution',
        status: execRes && execRes.ok === false ? 'failed' : 'completed',
        originalText: `[主对话直传求助 · ${fromLabel}] ${cleanBody}`,
        lastReceipt: clamp((execRes && (execRes.reply || execRes.error)) || 'L3 参谋长已完成处置', 220),
        resolvedAt: Date.now(),
      })
    }
  })
  return {
    ok: Boolean(execRes && execRes.ok !== false),
    mode: 'chief',
    actionTaken: 'executed_directly',
    taskId: ledgerTaskId,
    reply: (execRes && execRes.reply) || '',
    ...(execRes && execRes.view ? { view: execRes.view } : {}),
  }
}
