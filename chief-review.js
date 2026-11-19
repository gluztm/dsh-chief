/**
 * chief-review.js
 *
 * Post-turn background review, emergency hazard guard, and idle Auto-Pilot stop control for DSH Chief.
 */

import crypto from 'node:crypto'
import { loadArchiveStore } from './archives.js'
import { normalizePermissionMode, permissionRank } from './chief-executor.js'
import {
  CHAT_CAP,
  REVIEW_DELAY_MS,
  SMART_REVIEW_COOLDOWN_MS,
  AUTO_REVIEW_COOLDOWN_MS,
  DEFAULT_MANAGED_IDLE_TIMEOUT_MS,
  SUMMARY_MAX_TOKENS,
  archiveTargetForRoot,
  nextId,
  clamp,
  cleanMultiline,
  hasValidChiefRiskAck,
  pushAuditToWs,
  normalizeSuggestion,
  resolveWorkspaceConfig,
  normalizeTacticalModes,
  queueChiefApproval,
  loadChiefState,
  mutateChiefState,
  getLinkedCluster,
  ensureWorkspace,
  clusterView,
  isInternalCheckpointNoise,
  extractJsonObject,
  beginChiefActiveWork,
  updateChiefActiveWork,
  endChiefActiveWork,
} from './chief-state.js'
import { listChiefModels, callChiefLlm } from './chief-models.js'
import { listPeerDirectory, deliverCrossMessage } from './chief-network.js'
import { summarizingLocks, getChiefView, registerIdleAutoPilotHook } from './chief-view.js'
import { runManagedDreamRoam } from './chief-archives.js'
import {
  waitUntilAgentIdle,
  measureAgentSessionTokensFallback,
  recordSmartCompactionChatReceipt,
  executeHarvestAndCompact,
  maybeRunPreCompaction,
} from './chief-compaction.js'
import { applyFactChanges, applyBoardOps } from './chief-commands.js'
import { executeBatchSuggestions } from './chief-approvals.js'

const TURN_REVIEW_SYSTEM = [
  '你是「DSH 参谋长」（宰相级协同与督导中枢）的后台复盘与督导模块。某个对话刚结束一轮输出。',
  '请阅读最新对话片段、工作区核心目标、计划步骤、团队状态、生效边界（🚫 禁止红线 / ✅ 必做事项 / 💡 注意事项）、持久记忆与当前开启的战术开关，只输出一个 JSON 对象：',
  '',
  '1. `memoryChanges`：仅当出现跨轮次持久有效的规矩、分工、关键架构结论或踩坑教训时才新增/修订/删除；普通干活过程返回 `[]`。严禁保存密码或密钥。',
  '2. `boardOps`：若发现当前 `计划步骤 (Plan)` 明显仍对应旧需求/与最新 `总目标 (Objective)` 严重脱节（stale plan），务必输出 `{ "op": "plan.resetForGoal" }` 或 `{ "op": "plan.set", "steps": [...] }` 自动修正计划；也可更新 `task.update` / `cursor.set`。注意：当 `INTERVENTION_SUPERVISOR` 开启时，核心目标已锁定，严禁输出 `objective.set` 擅改目标！',
  '3. `planAssessment`：`{ "stale": true|false, "reason": "…" }`，指明当前计划步骤是否与总目标失配陈旧。',
  '4. `goalStatus` 与 `unmetMustDo`：当开启 `GOAL_MODE` 或 `INTERVENTION_SUPERVISOR`（主动强介入）时重点评估，取值 `"in_progress" | "achieved" | "blocked"`。',
  '   - **核心目标目的地铁律**：只要 `工作区核心目标 (Objective)` 非空，主动强介入的所有介入判断**一律以该核心目标有无完成作为最终目的地**（仅当核心目标为空时才退回对照最新用户原始诉求）。',
  '   - **必做事项核验铁律**：`已有工作边界` 中的 `必做事项 (allowed)` 为硬性交付清单！在主对话/子代理交上来的作业未完成任何一条适用必做事项或缺少对应交付/验证证据前，**必须将未完成项逐条写入 `unmetMustDo` 数组，并保持 `goalStatus: "in_progress"` 与 `shouldIntervene: true`**（严禁判为 `"achieved"`）！',
  '   - 仅当核心目标与全部适用必做事项均已完成并有实证支撑时，才可设 `goalStatus: "achieved"`（并填 `goalSummary` 与 `goalEvidence`）；否则填 `goalMissing`。',
  '5. `hazardStop`（**强介入紧急安全煞车与撞边界熔断 · 最高优先级，优先于一切续推！**）：',
  '   - `{ "triggered": false, "category": "none|irreversible_risk|boundary_collision", "title": "", "reason": "" }`',
  '   - 当 `INTERVENTION_SUPERVISOR` 或 `AUTO_PILOT_SESSION_ONLY` 开启时，你必须严密审查：主/子代理刚刚提出、准备执行、请求用户拍板，或接下来继续推进是否**存在重大不可逆风险，或继续推进必然会撞穿当前生效边界（尤其 🚫 禁止红线）**？',
  '   - **重要提示（下列仅是常见举例，绝不限于此！）**：包括但不限于实际花钱/扣费/下单/付费 API 调用、不可逆删除或清空文件/数据/仓库、下载超大文件占用巨额磁盘或流量、关闭/重启服务器或关键宿主服务、对外公开推送/发布不可撤回变更、破坏宿主机隔离边界、以及任何一旦继续推跑就会导致不可逆损失或必然撞穿红线的情形。',
  '   - 一旦命中任一上述风险或必然撞边界：**必须立即设 `"hazardStop": { "triggered": true, "category": "...", "title": "简短醒目告警标题", "reason": "用清晰人话说清具体会造成什么不可逆损失或必然撞上哪条边界，以及为何必须立即停下等用户处理" }`，并强制设 `"shouldIntervene": false`、`interventionText: ""`**（严禁再推下一轮！）。',
  '6. `shouldIntervene` & `interventionText`：当开启「主动强介入 (`INTERVENTION_SUPERVISOR`)」且 `hazardStop.triggered === false`、主代理停下时，对照「核心目标 + 必做事项 + 最新用户诉求」逐项核验！只要目标或必做事项尚未真正做完、缺少实测验证证据却自称完成，必须设 `shouldIntervene: true` 并写出清晰可执行、可直接投递给 `@lead` 继续推进下一回合的督导指令；若处于 `strictVerify` 模式但回复无实测输出证据，务必驳回自称完成并要求补跑验证；若开启 `conciseBrief`，督导指令严格限定在 3 条以内要点。仅当核心目标与必做事项均已完成 (`achieved`)、或正在等待子代理回信时，设 `shouldIntervene: false`。',
  '7. `suggestions`（最多 1 条，宁缺毋滥）：',
  '   - `"kind": "bound"`：明显撞墙或发现长期红线/必做规矩时请示注入边界；',
  '   - `"kind": "relay"`：发现明确跨对话信息差时的递话建议；',
  '   - `"kind": "advice"`：当主模型陷入明显可替代方案、环境坑点或需提醒用户拍板的关键决策时提出一句话建议，可带 `"popup": true|false`（仅关键分叉/阻塞决策设 `true`）。',
  '8. `shouldCompactNow` & `compactReason`：仅当 `SMART_COMPACT_CO_MANAGED`（✦ 智选）启用时评估！此时硬性上下文阈值已退让为辅助，由你与主会话共同把控压缩时机：只要一个完整阶段目标刚刚收口、工作流切换阶段、出现大量重复试错/工具噪音日志、或上下文估算已达 ≥30% 且适合归档脱水时，果断设 `shouldCompactNow: true` 并填写一句话 `compactReason`；仅在刚起步或上下文极轻时保持 `false`。',
  '9. `AUTO_PILOT_SESSION_ONLY`（全自动托管安全边界）：当激活标志包含 `AUTO_PILOT_SESSION_ONLY` 时，所有自动决策仅限本对话会话内部！严禁将本会话规律生成 `"pinGlobal": true` 的全局定住边界，严禁跨出本对话去篡改全局档案柜或无关独立窗口；发现跨窗口传递信息时可留待人工审批。',
  '',
  '输出格式（严格 JSON）：',
  '{',
  '  "memoryChanges": [{ "op": "add", "category": "discipline|architecture|progress|preference|team", "text": "…" }],',
  '  "boardOps": [],',
  '  "planAssessment": { "stale": false, "reason": "" },',
  '  "goalStatus": "in_progress",',
  '  "goalSummary": "",',
  '  "goalEvidence": "",',
  '  "goalMissing": "",',
  '  "unmetMustDo": [],',
  '  "hazardStop": { "triggered": false, "category": "none", "title": "", "reason": "" },',
  '  "shouldIntervene": false,',
  '  "interventionText": "",',
  '  "shouldCompactNow": false,',
  '  "compactReason": "",',
  '  "suggestions": []',
  '}',
].join('\n')

/** High-precision backup safety net if the turn-review model missed `hazardStop.triggered` despite unmistakable irreversible hazard or boundary collision cues. */
function detectEmergencyHazardFallback({ parsed, digestText = '', bounds = {}, isInterventionActive = false }) {
  const rawHs = parsed && parsed.hazardStop && typeof parsed.hazardStop === 'object' ? parsed.hazardStop : null
  if (rawHs && rawHs.triggered === true && (rawHs.reason || rawHs.title)) {
    return {
      triggered: true,
      category: clamp(rawHs.category || 'irreversible_risk', 40) || 'irreversible_risk',
      title: clamp(rawHs.title || '强介入安全煞车 · 已自动停止', 120),
      reason: cleanMultiline(rawHs.reason || rawHs.title || '继续推进存在不可逆重大风险或必然撞穿边界，已暂停强介入并等待您的指示。', 520),
    }
  }
  if (!isInterventionActive) {
    return { triggered: false, category: 'none', title: '', reason: '' }
  }

  const assistantParts = String(digestText || '').split(/(?:^|\n)Assistant:\s*/)
  const lastAssistant = assistantParts.length > 1 ? assistantParts[assistantParts.length - 1] : String(digestText || '')
  const reviewNotes = `${String(parsed?.goalMissing || '')}\n${String(parsed?.interventionText || '')}`

  if (String(parsed?.goalStatus || '') === 'blocked' && /(?:不可逆|重大损失|撞[^\n。]{0,8}(?:红线|边界)|违反[^\n。]{0,8}禁止|花钱|扣费|付费|下单|删库|永久删除|大文件|关闭服务器|停服|破坏宿主机)/.test(reviewNotes)) {
    return {
      triggered: true,
      category: /红线|边界|禁止/.test(reviewNotes) ? 'boundary_collision' : 'irreversible_risk',
      title: /红线|边界|禁止/.test(reviewNotes) ? '继续推进将撞穿工作边界 · 已急停' : '检测到重大不可逆风险 · 已急停',
      reason: cleanMultiline(parsed.goalMissing || parsed.interventionText || '继续推进可能导致不可逆损失或触犯工作边界，已立即停止主动强介入。', 520),
    }
  }

  const askHighRiskConfirmRe = /(?:需要|请)(?:您|用户)?(?:亲自|人工|手动)?(?:确认|授权|拍板|批准)[^\n。]{0,50}(?:花钱|扣费|付款|付费|下单|充值|永久删除|清空目录|格式化|关闭服务器|停服|重启宿主|下载[^\n。]{0,20}(?:GB|大文件)|不可逆)/i
  const mConfirm = lastAssistant.match(askHighRiskConfirmRe)
  if (mConfirm) {
    return {
      triggered: true,
      category: 'irreversible_risk',
      title: '高危/不可逆操作等待用户拍板 · 已急停',
      reason: cleanMultiline(`主对话提示需要您确认高风险操作（${mConfirm[0]}），为防止造成不可逆损失，已自动停止强介入推跑。`, 520),
    }
  }

  const forbiddenList = Array.isArray(bounds && bounds.forbidden) ? bounds.forbidden : []
  if (forbiddenList.length > 0 && /(?:继续[^\n。]{0,12}(?:必|将|会)[^\n。]{0,10}(?:触犯|违反|撞上)|已触及[^\n。]{0,8}禁止红线|必然撞边界)/.test(reviewNotes)) {
    return {
      triggered: true,
      category: 'boundary_collision',
      title: '继续推进必然撞穿禁止红线 · 已急停',
      reason: cleanMultiline(reviewNotes, 520),
    }
  }

  return { triggered: false, category: 'none', title: '', reason: '' }
}

const reviewTimers = new Map()

function extractLatestTurnDigest(agent, turn) {
  if (!agent || !agent.session) return null
  try {
    if (typeof agent.session.deriveMessages === 'function') {
      const msgs = agent.session.deriveMessages() || []
      let latestUserPrompt = ''
      for (let i = msgs.length - 1; i >= 0; i -= 1) {
        const um = msgs[i]
        if (!um || um.role !== 'user') continue
        if (um.source && um.source.kind && um.source.kind !== 'user') continue
        const uBlocks = Array.isArray(um.content) ? um.content : []
        const uTxt = uBlocks
          .filter(b => b && b.type === 'text' && typeof b.text === 'string')
          .map(b => b.text)
          .join('\n')
          .trim()
        if (uTxt && !isInternalCheckpointNoise(uTxt)) {
          latestUserPrompt = clamp(uTxt, 1000)
          break
        }
      }

      const tail = msgs.slice(-6)
      const lines = []
      let hasUser = false
      for (const m of tail) {
        if (!m || !m.role) continue
        if (m.source && m.source.kind && m.source.kind !== 'user' && m.role === 'user') continue
        const blocks = Array.isArray(m.content) ? m.content : []
        const txt = blocks
          .filter(b => b && b.type === 'text' && typeof b.text === 'string')
          .map(b => b.text)
          .join('\n')
          .trim()
        if (!txt || isInternalCheckpointNoise(txt)) continue
        if (m.role === 'user') {
          hasUser = true
          lines.push('User: ' + clamp(txt, 1200))
        } else if (m.role === 'assistant') {
          lines.push('Assistant: ' + clamp(txt, 900))
        }
      }
      if (lines.length > 0) return { text: lines.join('\n'), hasUser, latestUserPrompt, stamp: msgs.length }
    }
  } catch {}
  return null
}

const lastReviewAtByRoot = new Map()

export function scheduleChiefTurnReview(deps, { agent, sessionId, turn, abnormalTrigger = '' }) {
  const sid = String(sessionId || (agent && agent.id) || '').trim()
  if (!sid) return
  // Never waste tokens reviewing internal mnemon checkpoint / probe subagents
  if (/^mnemon-(?:review|run)/i.test(sid) || /^mnemon-(?:review|run)/i.test(String((agent && agent.name) || ''))) {
    return
  }
  const state = loadChiefState()
  const rootKey = (deps && deps.resolveRootSessionId ? deps.resolveRootSessionId(sid, agent) : '') || sid
  const effCfg = resolveWorkspaceConfig(state, rootKey)
  const runMode = effCfg.runMode || 'off'
  const tactical = normalizeTacticalModes(effCfg.tacticalModes)
  const wsSnap = state.workspaces && state.workspaces[rootKey] ? state.workspaces[rootKey] : null
  const pendingSmart = Boolean(wsSnap && wsSnap.runtimeGuard && wsSnap.runtimeGuard.pendingSmartCompact)
  const compactChannel = Boolean(tactical.autoCompact || tactical.smartCompact || pendingSmart)

  if (effCfg.stopped || (runMode === 'off' && !compactChannel)) {
    clearTimeout(reviewTimers.get(rootKey))
    reviewTimers.delete(rootKey)
    return
  }

  // In PATROL mode: normal turns consume 0 background tokens; wake ONLY on explicit abnormal triggers or compaction checks
  const hasAbnormal = Boolean(String(abnormalTrigger || '').trim())
  if (runMode === 'patrol' && !hasAbnormal && !compactChannel) {
    return
  }

  const board = deps && deps.boardForSession && deps.boardFileFor
    ? deps.boardForSession(deps.boardFileFor(rootKey))
    : null
  const isGoalMode = Boolean(board && board.mode === 'goal')
  const hasHighPriorityChannel = hasAbnormal || isGoalMode || compactChannel || tactical.intervention || tactical.redlineSentinel || tactical.strictVerify

  clearTimeout(reviewTimers.get(rootKey))
  const delayMs = hasHighPriorityChannel ? 1_200 : REVIEW_DELAY_MS
  const timer = setTimeout(() => {
    reviewTimers.delete(rootKey)
    runTurnReview(deps, { agent, sessionId: sid, turn, abnormalTrigger }).catch(() => {})
  }, delayMs)
  timer.unref?.()
  reviewTimers.set(rootKey, timer)
}

export async function runTurnReview(deps, { agent, sessionId, turn, force = false, abnormalTrigger = '' }) {
  const sid = String(sessionId || (agent && agent.id) || '').trim()
  if (!sid) return { ok: false, skipped: 'no-session' }
  const rootId = (deps.resolveRootSessionId && deps.resolveRootSessionId(sid, agent)) || sid

  const stateBefore = loadChiefState()
  const effCfgBefore = resolveWorkspaceConfig(stateBefore, rootId)
  const tactical = normalizeTacticalModes(effCfgBefore.tacticalModes)
  const runMode = effCfgBefore.runMode || 'off'
  const paceMode = effCfgBefore.paceMode || 'manual'
  const wsBefore = ensureWorkspace(stateBefore, rootId)
  const pendingSmart = Boolean(wsBefore.runtimeGuard && wsBefore.runtimeGuard.pendingSmartCompact)
  const compactChannel = Boolean(tactical.autoCompact || tactical.smartCompact || pendingSmart)
  const hasAbnormal = Boolean(String(abnormalTrigger || '').trim())

  if (!force && effCfgBefore.stopped) {
    return { ok: false, skipped: 'chief-stopped' }
  }
  if (!force && runMode === 'off' && !compactChannel) {
    return { ok: false, skipped: 'off' }
  }
  const board = deps.boardForSession && deps.boardFileFor
    ? deps.boardForSession(deps.boardFileFor(rootId))
    : null
  const isGoalMode = Boolean(board && board.mode === 'goal')
  const smartCoManaged = Boolean(tactical.smartCompact)
  const hasHighPriority = hasAbnormal || isGoalMode || tactical.intervention || tactical.redlineSentinel || tactical.strictVerify || compactChannel

  // Always check pre-compaction pipeline first when autoCompact/smartCompact/pendingSmartCompact is active
  if (compactChannel) {
    const preRes = await maybeRunPreCompaction(deps, { agent, sessionId: sid, rootId, bypassIdleWait: Boolean(force) })
      .catch((err) => {
        const msg = (err && err.message) || String(err || 'pre-compact-error')
        if (typeof deps.appendBoardLog === 'function' && rootId !== 'global') {
          deps.appendBoardLog(rootId, `⚠️ 自动压缩检测异常：${msg}`, 'chief')
        }
        return { ok: false, error: msg }
      })
    if (preRes && preRes.ok && preRes.smartCompacted) {
      return { ok: true, smartCompacted: true, harvestId: preRes.harvestId }
    }
  }

  // If runMode === 'off' and we only entered for standalone smartCompact/autoCompact pre-check,
  // exit cleanly once autoCompact threshold isn't forcing LLM, except when smartCoManaged needs its idle evaluation.
  if (!force && runMode === 'off' && !smartCoManaged) {
    return { ok: true, onlyCompactionChecked: true }
  }

  // If ONLY fixed-threshold autoCompact was on (without smartCompact or patrol-abnormal or managed), exit cleanly
  const needsSupervisorLlm = (runMode === 'managed')
    || (runMode === 'patrol' && hasAbnormal)
    || smartCoManaged
    || (force && (isGoalMode || tactical.intervention || tactical.redlineSentinel || tactical.strictVerify))
  if (!force && !needsSupervisorLlm && runMode !== 'patrol') {
    return { ok: true, onlyCompactionChecked: true }
  }

  const digest = extractLatestTurnDigest(agent, turn)
  if (!digest || !digest.text) return { ok: false, skipped: 'no-digest' }

  const hasWallCue = hasAbnormal || /(?:permission denied|eacces|eperm|forbidden|blocked|not allowed|sandbox|read-only|撞墙|受阻|权限拒绝|越界)/i.test(digest.text)
  if (!force && runMode === 'patrol' && !hasWallCue && !smartCoManaged) {
    return { ok: false, skipped: 'patrol-no-abnormal' }
  }

  const cursorKey = `${sid}`
  if (!force && wsBefore.reviewCursors[cursorKey] === digest.stamp) {
    return { ok: false, skipped: 'same-stamp' }
  }

  const identity = deps.resolveAgentIdentity ? deps.resolveAgentIdentity(deps.runtime, sid, agent) : null
  if (identity && /^mnemon-(?:review|run)/i.test(String(identity.self || ''))) return { ok: false, skipped: 'mnemon' }

  const now = Date.now()
  const lastAt = Number(lastReviewAtByRoot.get(rootId) || 0)
  const cooldownMs = hasHighPriority
    ? (smartCoManaged && !isGoalMode && !tactical.intervention && !hasAbnormal ? 12_000 : 4_000)
    : (runMode === 'patrol' ? (hasWallCue ? 45_000 : SMART_REVIEW_COOLDOWN_MS) : AUTO_REVIEW_COOLDOWN_MS)
  if (!force && now - lastAt < cooldownMs) return { ok: false, skipped: 'cooldown' }

  // Wait if supervisor/goal/smart-compact is active so turn-stopping settles to idle before evaluating usage
  if ((tactical.intervention || isGoalMode || smartCoManaged) && typeof deps.getAgentStatus === 'function' && !force) {
    await waitUntilAgentIdle(() => deps.getAgentStatus(sid), 5_000, 150)
  }

  const directory = await listPeerDirectory(deps, rootId)
  const realPeers = directory.targets.filter(t => !/^mnemon-(?:review|run)/i.test(String(t.name || t.handle || '')))

  let liveUsage = null
  if (smartCoManaged) {
    try {
      liveUsage = typeof deps.measureSessionTokens === 'function'
        ? await deps.measureSessionTokens(sid, agent)
        : measureAgentSessionTokensFallback(agent)
    } catch {}
  }

  // In 'smart' background mode (without supervisor/goal), gate LLM call on wall cue or multi-agent human turn;
  // when ONLY smartCoManaged is enabled in manual pace, evaluate only after enough turns or context pressure.
  if (!force && !isGoalMode && !tactical.intervention && !tactical.redlineSentinel && !tactical.strictVerify && !hasAbnormal) {
    if (smartCoManaged && runMode === 'off') {
      const ratio = liveUsage && liveUsage.contextWindow ? (Number(liveUsage.totalTokens) || 0) / Number(liveUsage.contextWindow) : 0
      const sinceCompact = now - ((wsBefore.runtimeGuard && wsBefore.runtimeGuard.lastCompactedAt) || 0)
      if ((digest.stamp < 4 && ratio < 0.25) || sinceCompact < 20_000) {
        return { ok: false, skipped: 'smart-compact-light' }
      }
    } else if (runMode === 'managed') {
      if (!digest.hasUser && realPeers.length <= 1 && !hasWallCue) return { ok: false, skipped: 'single-quiet' }
    }
  }

  if (!deps.callLlmOverride) {
    const modelsInfo = await listChiefModels(deps, false, rootId)
    if (!modelsInfo.available) return { ok: false, skipped: 'no-models' }
  }

  lastReviewAtByRoot.set(rootId, now)
  const isAutoPilotActiveNow = Boolean(runMode === 'managed' && !effCfgBefore.stopped)
  const reviewWorkId = beginChiefActiveWork(rootId, {
    tone: 'neon',
    tab: '',
    label: runMode === 'patrol'
      ? '参谋长正在巡检异常与诊断边界中...'
      : (isAutoPilotActiveNow ? '参谋长正在托管督导巡检中...' : '参谋长正在后台复盘研判中...'),
  })
  try {
  const speaker = identity && identity.isChild ? `子代理 @${identity.self}` : '主对话 (@lead)'
  const view = clusterView(stateBefore, rootId)
  const numberedFacts = view.facts.slice()
  const bounds = (board && board.bounds) || { allowed: [], forbidden: [], notes: [] }
  const planSteps = Array.isArray(board && board.plan) ? board.plan : []
  const tasks = Array.isArray(board && board.tasks) ? board.tasks : []

  const activeTargets = realPeers.filter(t => t.key === 'lead' || t.status === 'running').slice(0, 10)
  const idleCount = Math.max(0, realPeers.length - activeTargets.length)
  const activeFlags = [
    isGoalMode ? 'GOAL_MODE' : '',
    tactical.intervention ? 'INTERVENTION_SUPERVISOR' : '',
    smartCoManaged ? 'SMART_COMPACT_CO_MANAGED' : '',
    tactical.strictVerify ? 'STRICT_VERIFY' : '',
    tactical.redlineSentinel ? 'REDLINE_SENTINEL' : '',
    tactical.conciseBrief ? 'CONCISE_BRIEF_3_BULLETS' : '',
    Boolean(runMode === 'managed' && !effCfgBefore.stopped) ? 'AUTO_PILOT_SESSION_ONLY' : '',
    hasAbnormal ? `ABNORMAL_PATROL_TRIGGER(${abnormalTrigger})` : '',
  ].filter(Boolean)

  const smartUsageHint = smartCoManaged
    ? `智选共管状态（硬阈值已停用）：消息序号≈${digest.stamp}${liveUsage && liveUsage.totalTokens ? `，当前估算上下文 ${liveUsage.totalTokens}/${liveUsage.contextWindow} (${Math.round((liveUsage.totalTokens / liveUsage.contextWindow) * 100)}%)` : ''}`
    : ''

  const prompt = [
    `当前激活监督模式：${activeFlags.join(' | ') || runMode}`,
    ...(smartUsageHint ? [smartUsageHint] : []),
    `工作区总目标 (Objective)：${(board && board.objective) || '（暂未开启 /goal 固定目标 — 请对照下方最新用户原始诉求核验完成度）'}`,
    `最新用户原始诉求：${digest.latestUserPrompt || '（见下方对话片段）'}`,
    `当前计划步骤 (Plan)：${planSteps.length ? planSteps.map((s, i) => `${i + 1}.${s.done ? '[✓]' : '[ ]'} ${clamp(s.text, 60)}`).join('；') : '（空）'}`,
    `当前任务列表 (Tasks)：${tasks.length ? tasks.slice(0, 10).map(t => `[${t.status}] #${t.id} ${clamp(t.title, 48)}`).join('；') : '（空）'}`,
    `刚刚结束回合的对话身份：${speaker}（sessionId=${sid}）`,
    `活跃团队成员：${activeTargets.map(t => `${t.handle}[key=${t.key}, ${t.status}${t.taskTitle ? ', 任务:' + t.taskTitle : ''}]`).join('；')}${idleCount > 0 ? `（另有 ${idleCount} 名空闲子代理已折叠）` : ''}`,
    '',
    '已有工作边界（禁止红线严防撞穿；必做事项提交结项前须逐项核验是否完成）：',
    `- 禁止：${(bounds.forbidden || []).join('；') || '（暂无）'}`,
    `- 必做事项 (allowed · 必须交付确认)：${(bounds.allowed || []).join('；') || '（暂无）'}`,
    `- 注意：${(bounds.notes || []).join('；') || '（暂无）'}`,
    '',
    '已有持久记忆条目：',
    ...(numberedFacts.length ? numberedFacts.map((f, i) => `[${i + 1}] (${f.category}) ${f.text}`) : ['（暂无）']),
    '',
    '本轮最新对话片段：',
    digest.text,
  ].join('\n')

  const reviewReasonKind = hasAbnormal
    ? 'wall_blocked'
    : (tactical.intervention ? 'strong_intervention' : 'turn_review')
  const res = await callChiefLlm(deps, {
    sessionId: rootId,
    reasonKind: reviewReasonKind,
    system: TURN_REVIEW_SYSTEM,
    prompt,
    maxTokens: SUMMARY_MAX_TOKENS,
  })
  if (!res.ok) return { ok: false, error: res.error }

  const parsed = extractJsonObject(res.text)
  if (!parsed) return { ok: false, error: 'non-json-review' }

  const cfgNow = resolveWorkspaceConfig(loadChiefState(), rootId)
  const wsNowPerm = ensureWorkspace(loadChiefState(), rootId)
  const hasAckNow = hasValidChiefRiskAck(wsNowPerm)
  const permNow = normalizePermissionMode(cfgNow.permissionMode, { requireAck: true, hasChiefRiskAck: hasAckNow })
  const permRankNow = permissionRank(permNow)
  const autoPilot = Boolean(cfgNow.runMode === 'managed' && !cfgNow.stopped)
  const rawSuggestions = (Array.isArray(parsed.suggestions) ? parsed.suggestions : [])
    .map(raw => normalizeSuggestion({ ...raw, fromAgent: raw?.fromAgent || speaker }))
    .filter(Boolean)
    .slice(0, 1)

  // Stale plan check & auto-reconcile (L1+ only; L0 Advisor is strictly read-only)
  const isStalePlan = Boolean(parsed.planAssessment && parsed.planAssessment.stale)
  const parsedBoardOps = Array.isArray(parsed.boardOps) ? parsed.boardOps.slice() : []
  if (permRankNow >= 1 && isStalePlan && !parsedBoardOps.some(op => op && (op.op === 'plan.resetForGoal' || op.op === 'plan.set'))) {
    parsedBoardOps.unshift({ op: 'plan.resetForGoal' })
  }
  const executedOps = permRankNow >= 1 && parsedBoardOps.length > 0 && deps.runAction
    ? (() => {
        updateChiefActiveWork(rootId, reviewWorkId, { tone: 'tasks', tab: 'tasks', label: '参谋长正在自动同步看板与计划中...' })
        return applyBoardOps(deps, rootId, parsedBoardOps, { forceSessionOnly: autoPilot })
      })()
    : []

  const unmetMustDo = Array.isArray(parsed.unmetMustDo)
    ? parsed.unmetMustDo.map(x => clamp(String(x || '').trim(), 140)).filter(Boolean).slice(0, 6)
    : []
  const hazardInfo = detectEmergencyHazardFallback({
    parsed,
    digestText: digest.text,
    bounds,
    isInterventionActive: Boolean(tactical.intervention || autoPilot),
  })
  const hasObjectiveTarget = Boolean(board && String(board.objective || '').trim())
  const evalGoalCompletion = isGoalMode || (Boolean(tactical.intervention) && hasObjectiveTarget)
  const isGoalAchieved = !hazardInfo.triggered
    && evalGoalCompletion
    && String(parsed.goalStatus || '') === 'achieved'
    && unmetMustDo.length === 0
  let goalProposalCreated = false
  if (permRankNow >= 1 && isGoalAchieved && deps.runAction && hasObjectiveTarget) {
    const existingApproval = board && board.goalApproval
    const alreadyPendingSame = existingApproval
      && existingApproval.status === 'pending'
      && existingApproval.objective === board.objective
    if (!alreadyPendingSame) {
      const propRes = deps.runAction({
        action: 'goal.proposeApproval',
        objective: board.objective || '',
        summary: cleanMultiline(parsed.goalSummary || '核心目标及必做事项验证均已完成，建议结项。', 320),
        evidence: cleanMultiline(parsed.goalEvidence || '', 420),
        session: rootId,
        by: 'DSH 参谋长',
      })
      goalProposalCreated = Boolean(propRes && propRes.ok)
    }
  }

  let circuitTripped = false
  let circuitReason = ''
  let hazardStopped = false
  let hazardAlertCreated = null
  let interventionMessage = ''
  let interventionForApproval = ''
  let interventionDedupeKey = ''
  const autoRelays = []
  const relaysForApproval = []
  const autoBoundUpdates = []
  let shouldAutoOrganizeSession = false

  const isInternalRelayTarget = (targetRaw) => {
    const tq = String(targetRaw || '').trim().replace(/^@/, '')
    if (!tq) return false
    const lower = tq.toLowerCase()
    if (['lead', 'main', '主对话', '主代理'].includes(lower)) return true
    return realPeers.some(p =>
      p.kind !== 'peer-session'
      && p.kind !== 'session'
      && (p.key === tq || p.handle === tq || p.id === tq || p.name === tq)
    )
  }

  mutateChiefState((s) => {
    const ws = ensureWorkspace(s, rootId)
    ws.reviewCursors[cursorKey] = digest.stamp
    if (autoPilot) {
      ws.runtimeGuard.autoPilotHadTurn = true
    }
    if (permRankNow >= 1) {
      const activeCluster = getLinkedCluster(s, rootId)
      applyFactChanges(ws, numberedFacts, parsed.memoryChanges, speaker, {
        originRootId: rootId,
        peerRootIds: activeCluster.filter(id => id !== rootId),
      })

      // Goal achieved: create user approval suggestion pill (NEVER exit goal mode automatically!)
      if (isGoalAchieved) {
        const goalSig = crypto
          .createHash('sha1')
          .update(String((board && board.objective) || '') + '|' + String(parsed.goalEvidence || parsed.goalSummary || ''))
          .digest('hex')
          .slice(0, 12)
        const hasPendingGoalSug = ws.suggestions.some(
          sug => sug.status === 'pending' && sug.kind === 'goal_approval',
        )
        if (!hasPendingGoalSug) {
          const goalSug = normalizeSuggestion({
            kind: 'goal_approval',
            fromAgent: '🎯 目标督导参谋',
            title: '🎯 核心目标与必做事项已达成，请示批准结项',
            reason: cleanMultiline(parsed.goalSummary || '主对话已完成当前设定核心目标及全部必做事项，请批示是否结束督导。', 220),
            evidence: cleanMultiline(parsed.goalEvidence || '', 480),
            target: 'board',
            targetLabel: '目标结项',
            mode: 'silent',
            draftText: cleanMultiline(parsed.goalSummary || '批准结项并退出督导模式', 400),
          })
          if (goalSug) ws.suggestions.push(goalSug)
        }
        if (ws.runtimeGuard.lastGoalAchievedSig !== goalSig) {
          ws.runtimeGuard.lastGoalAchievedSig = goalSig
          ws.chat.push({
            id: nextId('chat'),
            role: 'chief',
            text: `- 【🎯 核心目标已达成 · 停止继续推送】${cleanMultiline(parsed.goalSummary || '核心目标与必做事项均已完成并核验通过。', 260)}`,
            actions: ['目标达成收口'],
            at: Date.now(),
          })
          if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
        }
      }

      const useOneStopRunnerNow = Boolean(permNow === 'chief' && hasAckNow && tactical.intervention)
      for (const sug of rawSuggestions) {
        if (!useOneStopRunnerNow && sug.kind === 'bound') {
          const colList = Array.isArray(bounds[sug.boundField]) ? bounds[sug.boundField] : []
          if (colList.some(x => String(x).trim() === sug.draftText)) continue
          if (autoPilot && sug.draftText) {
            sug.pinGlobal = false
            sug.status = 'applied'
            autoBoundUpdates.push({ field: sug.boundField, item: sug.draftText })
            continue
          }
        }
        if (!useOneStopRunnerNow && autoPilot && sug.kind === 'relay' && sug.draftText && isInternalRelayTarget(sug.target)) {
          if (permNow === 'chief' && hasAckNow) {
            sug.status = 'applied'
            autoRelays.push(sug)
            continue
          } else if (permNow === 'strategist') {
            sug.status = 'applied'
            relaysForApproval.push(sug)
            continue
          }
        }
        const dup = ws.suggestions.some(
          existing => existing.status === 'pending'
            && existing.kind === sug.kind
            && (sug.kind === 'bound'
              ? existing.draftText === sug.draftText
              : (sug.kind === 'advice'
                ? (existing.title === sug.title && existing.draftText === sug.draftText)
                : (existing.target === sug.target && existing.title === sug.title))),
        )
        if (!dup) {
          const pending = ws.suggestions.filter(item => item.status === 'pending')
          if (pending.length >= 5) {
            const victim = pending.find(item => item.kind !== 'bound' && item.kind !== 'goal_approval' && item.kind !== 'advice') || pending[0]
            victim.status = 'dismissed'
          }
          ws.suggestions.push(sug)
        }
      }

      if (autoPilot && permRankNow >= 1 && rootId && rootId !== 'global') {
        const lastOrgAt = Number(ws.runtimeGuard.lastAutoArchiveOrgAt || 0)
        if (!lastOrgAt || Date.now() - lastOrgAt > 60_000) {
          shouldAutoOrganizeSession = true
        }
      }
    }

    // 0) Emergency hazard / boundary-collision gate takes highest priority under Strong Intervention
    if (hazardInfo.triggered && (tactical.intervention || autoPilot)) {
      hazardStopped = true
      circuitTripped = true
      circuitReason = hazardInfo.reason || hazardInfo.title
      if (!ws.config || typeof ws.config !== 'object') ws.config = resolveWorkspaceConfig(s, rootId)
      ws.config.tacticalModes = {
        ...normalizeTacticalModes(ws.config.tacticalModes),
        intervention: false,
      }
      s.config.tacticalModes = {
        ...normalizeTacticalModes(s.config.tacticalModes),
        intervention: false,
      }
      hazardAlertCreated = {
        id: nextId('hazard'),
        category: hazardInfo.category || 'irreversible_risk',
        title: hazardInfo.title || '强介入紧急煞车 · 已停止推进',
        reason: hazardInfo.reason || '继续推进可能造成不可逆损失或必然撞穿工作边界，已立即停止强介入。',
        objective: clamp((board && board.objective) || '', 300),
        at: Date.now(),
      }
      ws.runtimeGuard.hazardAlert = hazardAlertCreated
      ws.runtimeGuard.circuitBroken = true
      ws.runtimeGuard.circuitReason = hazardAlertCreated.reason
      ws.runtimeGuard.interventionTurns = 0
      ws.runtimeGuard.unchangedCount = 0
      interventionMessage = ''
      ws.chat.push({
        id: nextId('chat'),
        role: 'chief',
        text: `- 【🚨 紧急煞车 · 强介入已停】${hazardAlertCreated.title}\n  理由：${hazardAlertCreated.reason}`,
        actions: ['高危急停'],
        at: Date.now(),
      })
      if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
      pushAuditToWs(ws, { mode: permNow, stage: 'safety_guard', decision: 'hazard_stop', operation: '强介入紧急煞车', target: 'lead', reason: hazardAlertCreated.reason, outcome: 'blocked', by: 'chief' })
    } else {
      // Intervention Supervisor follow-up + Circuit Breaker (differentiated across L0 / L1 / L2 / L3)
      const unmetMustDoFallback = unmetMustDo.length > 0
        ? '当前尚有以下【必做事项】未确认交付或缺少验证证据，请逐项补齐并交卷：\n' + unmetMustDo.map((u, idx) => `${idx + 1}. ${u}`).join('\n')
        : ''
      const candidateIntervention = parsed.interventionText
        || unmetMustDoFallback
        || (parsed.nextActionForLead && (parsed.shouldIntervene || parsed.goalStatus === 'in_progress') ? parsed.nextActionForLead : '')
      if (!isGoalAchieved && tactical.intervention && (parsed.shouldIntervene || parsed.goalStatus === 'in_progress' || unmetMustDo.length > 0) && candidateIntervention) {
        const assistantTail = (digest.text.split('Assistant:').pop() || digest.text)
        const sig = crypto
          .createHash('sha1')
          .update(JSON.stringify({
            objective: (board && board.objective) || '',
            goalStatus: parsed.goalStatus || '',
            donePlanCount: planSteps.filter(p => p.done).length,
            doneTaskCount: tasks.filter(t => t.status === 'done').length,
            blockedTaskCount: tasks.filter(t => t.status === 'blocked').length,
            assistantTail: clamp(assistantTail, 140),
          }))
          .digest('hex')
          .slice(0, 12)

        const prevSig = ws.runtimeGuard.lastDigestHash
        const nextUnchanged = prevSig === sig ? (ws.runtimeGuard.unchangedCount + 1) : 1
        const nextTurns = ws.runtimeGuard.interventionTurns + 1
        const isUnlimitedTurns = tactical.maxInterventionTurns === 0
        const maxTurns = isUnlimitedTurns ? Infinity : Math.max(1, Number(tactical.maxInterventionTurns) || 10)
        const unchangedLimit = isUnlimitedTurns ? 8 : 3

        if ((!isUnlimitedTurns && nextTurns > maxTurns) || nextUnchanged >= unchangedLimit) {
          circuitTripped = true
          circuitReason = !isUnlimitedTurns && nextTurns > maxTurns
            ? `接管督导连续介入已达上限 (${maxTurns} 轮)，触发安全熔断，已自动退回人工监督。`
            : `连续 ${unchangedLimit} 轮检测进展无实质变化，触发死循环熔断，已自动关闭接管督导并交还用户控制。`
          if (!ws.config || typeof ws.config !== 'object') ws.config = resolveWorkspaceConfig(s, rootId)
          ws.config.tacticalModes = {
            ...normalizeTacticalModes(ws.config.tacticalModes),
            intervention: false,
          }
          s.config.tacticalModes = {
            ...normalizeTacticalModes(s.config.tacticalModes),
            intervention: false,
          }
          ws.runtimeGuard.circuitBroken = true
          ws.runtimeGuard.circuitReason = circuitReason
          ws.runtimeGuard.interventionTurns = 0
          ws.runtimeGuard.unchangedCount = 0
          ws.chat.push({
            id: nextId('chat'),
            role: 'chief',
            text: `- 【⚠️ 安全熔断】${circuitReason}`,
            actions: ['熔断停机'],
            at: Date.now(),
          })
          if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
        } else {
          ws.runtimeGuard.lastDigestHash = sig
          ws.runtimeGuard.unchangedCount = nextUnchanged
          ws.runtimeGuard.interventionTurns = nextTurns
          ws.runtimeGuard.circuitBroken = false
          ws.runtimeGuard.circuitReason = ''
          const cleanBody = cleanMultiline(candidateIntervention, tactical.conciseBrief ? 420 : 1200)

          if (permRankNow === 0) {
            // L0 Advisor: strict read-only inspection brief in panel chat only (never touches board or @lead)
            if (prevSig !== sig || nextTurns === 1) {
              ws.chat.push({
                id: nextId('chat'),
                role: 'chief',
                text: `- 【👁 L0 顾问只读督导巡检】目标核验状态：\`${parsed.goalStatus || 'in_progress'}\`\n- 【诊断与建议】${clamp(cleanBody, 280)}`,
                actions: ['L0 只读巡检', '建议不下发'],
                at: Date.now(),
              })
              if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
            }
            pushAuditToWs(ws, { mode: permNow, stage: 'permission_gate', decision: 'readonly_inspection', operation: '强介入只读巡检', target: 'chief_panel', reason: clamp(cleanBody, 120), outcome: 'ok', by: 'chief' })
          } else if (permRankNow === 1) {
            // L1 Assistant: manages internal Chief board/facts/suggestions only; does NOT inject into @lead
            const sug = normalizeSuggestion({
              kind: 'advice',
              fromAgent: '🗂 L1 助手督导建议',
              title: 'L1 强介入建议（等待拍板，未自动递给主对话）',
              reason: clamp(parsed.goalMissing || 'L1 助手模式不接管主代理工作流，您可一键采纳递交主对话。', 200),
              target: 'lead',
              targetLabel: '主对话',
              mode: 'followup',
              draftText: cleanBody,
              popup: false,
            })
            if (sug) ws.suggestions.push(sug)
            ws.chat.push({
              id: nextId('chat'),
              role: 'chief',
              text: `- 【🗂 L1 助手督导建议】已整理本轮看板进展，并生成待采纳推进建议（L1 不自动插话主对话）：\n${clamp(cleanBody, 260)}`,
              actions: ['L1 内务自治', '转人工采纳'],
              at: Date.now(),
            })
            if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
            pushAuditToWs(ws, { mode: permNow, stage: 'permission_gate', decision: 'suggested_only', operation: '强介入转建议卡', target: 'lead', reason: clamp(cleanBody, 120), outcome: 'ok', by: 'chief' })
          } else if (permRankNow === 2) {
            // L2 Strategist: requires explicit user approval popup before sending followup into @lead!
            interventionForApproval = cleanBody
            interventionDedupeKey = `intv:${rootId}:${digest.stamp}:${sig}`
            pushAuditToWs(ws, { mode: permNow, stage: 'permission_gate', decision: 'pending_approval', operation: '强介入督导主对话', target: 'lead', reason: clamp(cleanBody, 120), outcome: 'pending', by: 'chief' })
          } else {
            // L3 Chief of Staff (ack verified): full autonomous intervention
            interventionMessage = cleanBody
            pushAuditToWs(ws, { mode: permNow, stage: 'executor', decision: 'executed', operation: '强介入自动督导推进', target: 'lead', reason: clamp(cleanBody, 120), outcome: 'ok', by: 'chief' })
          }
        }
      }
    }
  })

  if (hazardStopped && deps && typeof deps.cancelAutoContinue === 'function') {
    try { deps.cancelAutoContinue(sid, 'hazard-stop') } catch {}
    if (rootId && rootId !== sid) {
      try { deps.cancelAutoContinue(rootId, 'hazard-stop') } catch {}
    }
  }

  // When both Smart Compact & Intervention trigger on the same turn:
  // L3 runs harvest + compact silently first; L2 queues approval popup; L0/L1 never auto-compact.
  let smartCompacted = false
  if (permRankNow >= 2 && smartCoManaged && parsed.shouldCompactNow === true && typeof deps.compactSessionNow === 'function') {
    const wsNow = ensureWorkspace(loadChiefState(), rootId)
    const lastCompactedAt = (wsNow.runtimeGuard && wsNow.runtimeGuard.lastCompactedAt) || 0
    const sinceLast = Date.now() - lastCompactedAt
    if (force || !lastCompactedAt || sinceLast >= 20_000) {
      const compactReason = clamp(parsed.compactReason || '参谋长评估当前阶段已收口，执行智选归档压缩', 220)
      if (permRankNow === 2) {
        queueChiefApproval(rootId, {
          category: 'main_workflow',
          operationLabel: '✦ 智选压缩主对话上下文 (/compact)',
          targetLabel: '当前主会话',
          reason: compactReason,
          impact: '将先抢救摘要入本会话档案柜，随后压缩裁剪主对话历史',
          dedupeKey: `smart_compact:${rootId}:${wsNow.runtimeGuard.lastCompactedSeq || 0}:${digest.stamp}`,
          kind: 'compact',
          payload: { reason: compactReason },
          by: 'chief',
        })
      } else {
        let st = 'idle'
        try { if (typeof deps.getAgentStatus === 'function') st = deps.getAgentStatus(sid) || 'idle' } catch {}
        if (st === 'running' && !force && typeof deps.getAgentStatus === 'function') {
          await waitUntilAgentIdle(() => deps.getAgentStatus(sid), 8_000, 200)
          try { st = deps.getAgentStatus(sid) || 'idle' } catch {}
        }
        if (st === 'running' && !force) {
          mutateChiefState((s) => {
            const ws = ensureWorkspace(s, rootId)
            ws.runtimeGuard.pendingSmartCompact = { at: Date.now(), reason: compactReason, by: 'chief' }
          })
        } else {
          const contextWindow = Math.max(1000, Number(liveUsage && liveUsage.contextWindow) || 128_000)
          const totalTokens = Number(liveUsage && liveUsage.totalTokens) || 0
          const seq = Math.max(0, Math.round(Number(liveUsage && liveUsage.seq) || digest.stamp || 0))
          const ratioPct = totalTokens > 0 ? (totalTokens / contextWindow) * 100 : 0
          updateChiefActiveWork(rootId, reviewWorkId, {
            tone: 'archive',
            tab: 'archive',
            label: '参谋长正在自动抢救归档与压缩中...',
          })
          const cRes = await executeHarvestAndCompact(deps, {
            sid,
            rootId,
            agent,
            reason: compactReason,
            seq,
            ratioPct,
            totalTokens,
            contextWindow,
            logLabel: '✦ 智选压缩(参谋长判断)',
          }).catch((err) => {
            const msg = (err && err.message) || String(err || 'smart-compact-error')
            if (typeof deps.appendBoardLog === 'function' && rootId !== 'global') {
              deps.appendBoardLog(rootId, `⚠️ ✦ 智选压缩失败：${msg}`, 'chief')
            }
            return { ok: false, error: msg }
          })
          if (cRes && cRes.ok && !cRes.noop) {
            smartCompacted = true
            recordSmartCompactionChatReceipt(rootId, {
              cRes,
              ratioPct,
              totalTokens,
              contextWindow,
              via: '✦ 智选压缩',
            })
          }
        }
      }
    }
  }

  if (interventionForApproval) {
    queueChiefApproval(rootId, {
      category: 'main_workflow',
      operationLabel: '强介入督导主对话继续推进',
      targetLabel: '主对话 (@lead)',
      reason: '当前处于「L2 · 参谋模式」，强介入向主对话发推进指令前需您逐项授权',
      impact: '点击「允许本次操作」后将立即向主对话唤醒投递以下督导指令',
      preview: clamp(interventionForApproval, 260),
      dedupeKey: interventionDedupeKey,
      kind: 'relay',
      payload: {
        fromSession: rootId,
        fromLabel: 'DSH 参谋 (强介入逐项授权)',
        target: 'lead',
        subject: '参谋强介入督导推进',
        text: interventionForApproval,
        mode: 'followup',
      },
      by: 'chief',
    })
  }

  if (interventionMessage) {
    const tags = [
      tactical.strictVerify ? '严格校验实测' : '',
      tactical.redlineSentinel ? '红线哨兵巡检' : '',
      tactical.conciseBrief ? '精炼要点' : '',
    ].filter(Boolean).join(' · ')
    await deliverCrossMessage(deps, {
      fromSession: rootId,
      fromLabel: `DSH 参谋长 (接管督导${tags ? '·' + tags : ''})`,
      target: 'lead',
      subject: '参谋长自动督导推进',
      text: interventionMessage,
      mode: 'followup',
    })
  }

  if (permRankNow >= 1 && autoBoundUpdates.length > 0 && deps.runAction) {
    updateChiefActiveWork(rootId, reviewWorkId, {
      tone: 'bounds',
      tab: 'boundaries',
      boundSubTab: 'rules',
      label: '参谋长正在自动维护本局边界中...',
    })
    for (const b of autoBoundUpdates) {
      deps.runAction({
        action: 'bounds.add',
        field: b.field,
        item: b.item,
        pinned: false,
        session: rootId,
        by: 'DSH 参谋长 (全自动托管)',
      })
      executedOps.push(`本局自动边界(${b.field})：${clamp(b.item, 32)}`)
    }
  }

  let dreamRoamRes = null
  if (autoPilot && permRankNow >= 1 && !hazardStopped && rootId && rootId !== 'global') {
    try {
      const sessOpt = archiveTargetForRoot(deps, rootId, { vaultScope: 'session' })
      const globOpt = archiveTargetForRoot(deps, rootId, { vaultScope: 'global' })
      const stSess = loadArchiveStore(sessOpt)
      const stGlob = loadArchiveStore(globOpt)
      const hasWatch = Array.isArray(stSess.recentlyUnpinnedWatch) && stSess.recentlyUnpinnedWatch.length > 0
      const hasUnhookedSess = (stSess.items || []).some(it => !it.hasHook || it.folder === 'inbox' || it.organizedBy !== 'chief' || (it.points || []).length <= 1)
      const hasUnhookedGlob = (stGlob.items || []).some(it => !it.hasHook || it.folder === 'inbox' || it.organizedBy !== 'chief' || (it.points || []).length <= 1)
      if (hasWatch || ((shouldAutoOrganizeSession || force) && (hasUnhookedSess || hasUnhookedGlob))) {
        updateChiefActiveWork(rootId, reviewWorkId, {
          tone: 'dream',
          tab: 'archive',
          label: '🌙 参谋长正在梦境漫游 · 轻拢卷宗与织就钩子中...',
        })
        mutateChiefState((s) => {
          const ws = ensureWorkspace(s, rootId)
          ws.runtimeGuard.lastAutoArchiveOrgAt = Date.now()
        })
        dreamRoamRes = await runManagedDreamRoam(deps, { sessionId: rootId }).catch(() => null)
      }
    } catch {}
  }

  // L3 Chief + Strong Intervention: One-Stop Task Runner sweeping safe pending suggestions
  // (excludes guard_wall, goal_approval, pinGlobal global bounds, and superseded L1 fallback advice when live intervention ran)
  let oneStopReport = null
  if (permNow === 'chief' && hasAckNow && tactical.intervention && !hazardStopped) {
    try {
      const wsLatest = ensureWorkspace(loadChiefState(), rootId)
      const safePending = (wsLatest.suggestions || []).filter(s =>
        s
        && s.status === 'pending'
        && s.kind !== 'guard_wall'
        && s.kind !== 'wall_removal'
        && s.kind !== 'goal_approval'
        && !(s.kind === 'bound' && s.pinGlobal)
        && !(interventionMessage && s.title === 'L1 强介入建议（等待拍板，未自动递给主对话）'),
      )
      if (safePending.length > 0) {
        updateChiefActiveWork(rootId, reviewWorkId, {
          tone: 'neon',
          tab: 'chief',
          label: '🏁 参谋长正在一站式推进建议清单中...',
        })
        const batchOut = await executeBatchSuggestions(deps, {
          sessionId: rootId,
          ids: safePending.map(s => s.id),
          includeGoalApproval: false,
          skipGuardWalls: true,
          skipGlobalBounds: true,
          byAutoRunner: true,
          skipChatReceipt: true,
        })
        if (batchOut && (batchOut.executedCount > 0 || batchOut.blockedCount > 0 || batchOut.failedCount > 0)) {
          oneStopReport = {
            executedCount: batchOut.executedCount,
            blockedCount: batchOut.blockedCount,
            failedCount: batchOut.failedCount,
            skippedGoalCount: batchOut.skippedGoalCount,
            summaries: batchOut.summaries || [],
          }
          mutateChiefState((s) => {
            const ws = ensureWorkspace(s, rootId)
            ws.chat.push({
              id: nextId('chat'),
              role: 'chief',
              kind: 'receipt',
              isOneStopReport: true,
              ...(res.thinkingEffort ? { thinkingEffort: res.thinkingEffort } : {}),
              ...(res.thinkingEffortMode ? { thinkingEffortMode: res.thinkingEffortMode } : {}),
              text: [
                `- 【🏁 一站式战报回执】L3 强介入已顺序推进 ${batchOut.executedCount} 项安全建议${batchOut.blockedCount ? ` · 安全护栏拦禁 ${batchOut.blockedCount} 项` : ''}${batchOut.skippedGoalCount ? ` · 保留高危/结项/全局项 ${batchOut.skippedGoalCount} 项待您亲裁` : ''}`,
                ...(batchOut.summaries || []).map(line => `  ${line}`),
              ].join('\n'),
              actions: [
                `🏁 一站式执行 ×${batchOut.executedCount}`,
                ...(batchOut.blockedCount ? [`🛡️ 红线拦截 ×${batchOut.blockedCount}`] : []),
              ],
              at: Date.now(),
            })
            if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
          })
        }
      }
    } catch {}
  }

  for (const sug of relaysForApproval) {
    queueChiefApproval(rootId, {
      category: 'main_workflow',
      operationLabel: '向工作流成员投递自动指令',
      targetLabel: sug.target === 'lead' ? '主对话 (@lead)' : `@${sug.target}`,
      reason: clamp(sug.title || 'L2 参谋模式逐项授权自动递话', 140),
      impact: '允许后将把该条工作流指令投递给目标成员',
      preview: clamp(sug.draftText || '', 240),
      dedupeKey: `autorelay:${rootId}:${digest.stamp}:${sug.target}`,
      kind: 'relay',
      payload: {
        fromSession: rootId,
        fromLabel: 'DSH 参谋 (逐项授权)',
        target: sug.target,
        subject: sug.title,
        text: sug.draftText,
        mode: sug.mode || 'silent',
      },
      by: 'chief',
    })
  }

  for (const sug of autoRelays) {
    await deliverCrossMessage(deps, {
      fromSession: rootId,
      fromLabel: 'DSH 参谋长 (自动托管)',
      target: sug.target,
      subject: sug.title,
      text: sug.draftText,
      mode: sug.mode || 'silent',
    })
  }

  let autoPilotStopRes = null
  if (autoPilot && !interventionMessage && autoRelays.length === 0 && !circuitTripped) {
    autoPilotStopRes = await checkAndStopIdleAutoPilot(deps, rootId, {
      allowStartupGrace: false,
      goalAchievedFastStop: Boolean(isGoalAchieved),
      directory,
      fromViewCheck: false,
    }).catch(() => null)
  }

  return {
    ok: true,
    permissionMode: permNow,
    executedOps,
    isStalePlan,
    unmetMustDo,
    goalAchieved: isGoalAchieved,
    goalProposalCreated,
    hazardStopped,
    ...(hazardAlertCreated ? { hazardAlert: hazardAlertCreated } : {}),
    intervened: Boolean(interventionMessage),
    queuedInterventionApproval: Boolean(interventionForApproval),
    smartCompacted,
    circuitTripped,
    circuitReason,
    ...(res.thinkingEffort ? { thinkingEffort: res.thinkingEffort } : {}),
    ...(res.thinkingEffortMode ? { thinkingEffortMode: res.thinkingEffortMode } : {}),
    ...(dreamRoamRes ? { dreamRoam: dreamRoamRes } : {}),
    ...(oneStopReport ? { oneStopReport } : {}),
    ...(autoPilotStopRes ? { autoPilotStopped: Boolean(autoPilotStopRes.stopped) } : {}),
  }
  } finally {
    endChiefActiveWork(rootId, reviewWorkId)
  }
}

/**
 * 5-Condition Idle Auto-Sleep Guard for Managed mode (`runMode === 'managed'`):
 * Auto-stands down `managed -> off` ONLY when ALL 5 conditions hold:
 *  (1) Idle timeout elapsed (or goal-achieved fast stand-down) AND 0 running session agents;
 *  (2) 0 `doing` tasks on board;
 *  (3) 0 pending approvals / elevations;
 *  (4) 0 pending/delivered open inquiries;
 *  (5) 0 pending review timers AND empty `recentlyUnpinnedWatch` queue.
 */
export async function checkAndStopIdleAutoPilot(deps, sessionId, opts = {}) {
  const sidRaw = String(sessionId || '').trim()
  const rootId = String(
    (deps && typeof deps.resolveRootSessionId === 'function' ? deps.resolveRootSessionId(sidRaw) : sidRaw) || sidRaw || '',
  ).trim()
  if (!rootId || rootId === 'global') {
    return { ok: true, stopped: false, reason: 'not-session' }
  }

  const stBefore = loadChiefState()
  const effBefore = resolveWorkspaceConfig(stBefore, rootId)
  const wsBefore = ensureWorkspace(stBefore, rootId)
  if (effBefore.stopped || effBefore.runMode !== 'managed') {
    return { ok: true, stopped: false, reason: 'not-managed' }
  }
  // Condition 5a: 0 pending review timers
  if (reviewTimers.has(rootId)) {
    return { ok: true, stopped: false, reason: 'review-pending' }
  }
  // Condition 3: 0 pending approvals / elevations
  const hasPendingApr = Array.isArray(wsBefore.pendingApprovals) && wsBefore.pendingApprovals.some(a => a && a.status === 'pending')
  if (hasPendingApr || wsBefore.pendingElevation) {
    return { ok: true, stopped: false, reason: 'pending-approvals' }
  }
  // Condition 4: 0 pending / delivered inquiries
  const hasOpenInq = Array.isArray(wsBefore.inquiries) && wsBefore.inquiries.some(q => q && (q.status === 'pending' || q.status === 'delivered'))
  if (hasOpenInq) {
    return { ok: true, stopped: false, reason: 'pending-inquiries' }
  }
  // Condition 2: 0 doing tasks on board
  const board = deps && deps.boardForSession && deps.boardFileFor
    ? deps.boardForSession(deps.boardFileFor(rootId))
    : null
  const doingTasks = (board && Array.isArray(board.tasks) ? board.tasks : []).filter(t => t && t.status === 'doing')
  if (doingTasks.length > 0) {
    return { ok: true, stopped: false, reason: 'tasks-doing' }
  }
  // Condition 5b: empty `recentlyUnpinnedWatch` queue
  try {
    const sessOpt = archiveTargetForRoot(deps, rootId, { vaultScope: 'session' })
    const sStore = loadArchiveStore(sessOpt)
    if (Array.isArray(sStore.recentlyUnpinnedWatch) && sStore.recentlyUnpinnedWatch.length > 0) {
      return { ok: true, stopped: false, reason: 'unpinned-watch-pending' }
    }
  } catch {}

  const hasRunningInSession = (dirObj) => {
    try {
      if (deps && typeof deps.getAgentStatus === 'function' && deps.getAgentStatus(rootId) === 'running') {
        return true
      }
    } catch {}
    try {
      const agentsMap = deps && deps.runtime && typeof deps.runtime.get === 'function'
        ? deps.runtime.get('agents')
        : null
      if (agentsMap && typeof agentsMap[Symbol.iterator] === 'function') {
        for (const item of agentsMap) {
          const ag = Array.isArray(item) ? item[1] : item
          if (!ag || typeof ag !== 'object') continue
          const agSid = String(ag.id || '').trim()
          if (!agSid) continue
          const agRoot = (deps && typeof deps.resolveRootSessionId === 'function' ? deps.resolveRootSessionId(agSid, ag) : '') || agSid
          if (agRoot !== rootId) continue
          const agName = String(ag.name || ag.handle || '')
          if (/^mnemon-(?:review|run)/i.test(agName)) continue
          if (ag.status === 'running') return true
        }
      }
    } catch {}
    const targets = dirObj && Array.isArray(dirObj.targets) ? dirObj.targets : []
    for (const t of targets) {
      if (!t || t.kind === 'peer-session' || t.kind === 'session') continue
      if (t.rootId && t.rootId !== rootId) continue
      const tName = String(t.name || t.handle || '')
      if (/^mnemon-(?:review|run)/i.test(tName)) continue
      if (t.status === 'running') return true
    }
    return false
  }

  // Condition 1a: 0 running session agents
  const dirInitial = opts.directory || (deps ? await listPeerDirectory(deps, rootId) : { targets: [] })
  if (hasRunningInSession(dirInitial)) {
    return { ok: true, stopped: false, reason: 'agent-running' }
  }

  // Condition 1b: idle timeout elapsed (or explicit goal-achieved fast stand-down)
  const rg = (wsBefore.runtimeGuard && typeof wsBefore.runtimeGuard === 'object') ? wsBefore.runtimeGuard : {}
  const lastActivity = Math.max(Number(rg.lastActivityAt) || 0, Number(rg.autoPilotStartedAt) || 0)
  const idleTimeoutMs = Math.max(50, Number(effBefore.managedIdleTimeoutMs) || DEFAULT_MANAGED_IDLE_TIMEOUT_MS)
  if (!opts.goalAchievedFastStop) {
    if (opts.allowStartupGrace !== false) {
      const startedAt = Number(rg.autoPilotStartedAt || 0)
      const hadTurn = Boolean(rg.autoPilotHadTurn)
      if (!hadTurn && startedAt > 0 && Date.now() - startedAt < Math.min(15_000, idleTimeoutMs)) {
        return { ok: true, stopped: false, reason: 'startup-grace' }
      }
    }
    if (lastActivity > 0 && Date.now() - lastActivity < idleTimeoutMs) {
      return { ok: true, stopped: false, reason: 'idle-timeout-not-reached' }
    }
  }

  if (opts.currentFresh !== true && deps) {
    const preView = await getChiefView(deps, rootId, {
      regenerate: false,
      autoSummarize: false,
      _skipAutoPilotCheck: true,
    }).catch(() => null)
    const nar = preView && preView.narrative
    if (nar && nar.hasUnsummarizedChanges && !nar.fresh) {
      if (nar.summarizing) {
        return { ok: true, stopped: false, reason: 'summarizing' }
      }
      if (preView.models && preView.models.available && !summarizingLocks.has(rootId)) {
        await getChiefView(deps, rootId, {
          regenerate: true,
          autoSummarize: false,
          _skipAutoPilotCheck: true,
        }).catch(() => null)
      }
    }
  }

  if (reviewTimers.has(rootId)) {
    return { ok: true, stopped: false, reason: 'review-pending' }
  }
  const dirFinal = deps ? await listPeerDirectory(deps, rootId) : dirInitial
  if (hasRunningInSession(dirFinal)) {
    return { ok: true, stopped: false, reason: 'agent-running' }
  }

  let stoppedNow = false
  mutateChiefState((s) => {
    const ws = ensureWorkspace(s, rootId)
    const effNow = resolveWorkspaceConfig(s, rootId)
    if (effNow.stopped || effNow.runMode !== 'managed') return
    if (!ws.config || typeof ws.config !== 'object') ws.config = { ...effNow }
    ws.config.runMode = 'off'
    ws.config.paceMode = 'manual'
    ws.config.autoPilot = false
    ws.config.autoReview = false
    if (s.config && (s.config.runMode === 'managed' || s.config.paceMode === 'auto')) {
      s.config.runMode = 'off'
      s.config.paceMode = 'manual'
      s.config.autoPilot = false
      s.config.autoReview = false
    }
    ws.chat.push({
      id: nextId('chat'),
      role: 'chief',
      kind: 'receipt',
      text: '- 【🤖→⏸ 托管自动休眠】连续闲置达阈值且在途任务、待批弹窗、在途问询与卷宗梳理均已清零，已自动将运行模式切换回「⏸ 关停」以节省 Token，随时可再次开启。',
      actions: ['托管自动休眠'],
      at: Date.now(),
    })
    if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
    stoppedNow = true
  })

  return { ok: true, stopped: stoppedNow, reason: stoppedNow ? 'idle-completed' : 'already-stopped' }
}

registerIdleAutoPilotHook(checkAndStopIdleAutoPilot)

