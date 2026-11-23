#!/usr/bin/env node
/**
 * verify-v170-dsh023-compat.mjs
 *
 * Self-contained regression gate for DSH 0.2.3-alpha.2 (Cordis 4.2) compatibility
 * and Chief <-> Lead link error reporting / anti-hijack guarantees:
 *  1. Cordis 4.2 strict Proxy: `spCtx.agent` without inject would throw, `apply(ctx)` registers `dsh-chief` safely via `spCtx.get('agent')` and renders digest.
 *  2. Lossless JSON validation (`walkJsonValue`): `buildMessageEnvelope` strips `undefined`, `NaN`, `Infinity`, normalizes `-0`, preserves valid metadata.
 *  3. `deliverCrossMessage` & `controlMainAgent`: bypasses missing `agentsSvc` gate to invoke `sessionController.resolveAgent`, surfaces `agent-preset/not-found` as `deliveryError` / `ok: false`.
 *  4. L2 approval (`decideChiefApproval`) & L3 relay (`askOrCommandChief`): never hijack `pending-transfer.json` when `deliveryError` occurs (even if `isBlankContext` is true).
 *  5. `isBlankContext` accuracy: cold/compacted non-blank sessions (`lastCompactedSeq > 0` or `board.log`) do NOT trigger `pending-transfer.json`, while genuinely blank sessions still do.
 *  6. `user/message` activity touch + `executeHostSessionCompaction` through isolated `agentPresets.serviceFor(ag, 'compaction')`.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PKG = path.resolve(__dirname, '..')

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-v170-023-compat-'))
const dshHome = path.join(tmpRoot, 'dsh-home')
const chiefDataDir = path.join(tmpRoot, 'chief-data')
const workDir = path.join(tmpRoot, 'workspace')
fs.mkdirSync(dshHome, { recursive: true })
fs.mkdirSync(chiefDataDir, { recursive: true })
fs.mkdirSync(workDir, { recursive: true })

process.env.DSH_HOME = dshHome
process.env.DSH_CHIEF_DATA_DIR = chiefDataDir
process.env.DSH_CHIEF_WALLS_FILE = path.join(chiefDataDir, 'guard-walls.json')

function modUrl(rel) {
  return pathToFileURL(path.join(PKG, rel)).href
}

/** Strict lossless JSON validator matching DSH 0.2.3-alpha.2 `dsh-util-values` `walkJsonValue`. */
function isLosslessJsonValue(value, seen = new Set()) {
  if (value === null) return true
  const t = typeof value
  if (t === 'boolean' || t === 'string') return true
  if (t === 'number') return Number.isFinite(value) && !Object.is(value, -0)
  if (t !== 'object') return false
  if (seen.has(value)) return false
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) return false
      if (Reflect.ownKeys(value).length !== value.length + 1) return false
      return value.every(item => isLosslessJsonValue(item, seen))
    }
    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) return false
    for (const sym of Object.getOwnPropertySymbols(value)) {
      if (Object.prototype.propertyIsEnumerable.call(value, sym)) return false
    }
    for (const k of Object.keys(value)) {
      if (!isLosslessJsonValue(value[k], seen)) return false
    }
    return true
  } finally {
    seen.delete(value)
  }
}

/** Build a Cordis 4.2-style strict Context Proxy that throws when accessing an uninjected service property. */
function makeStrictCordisContext(services, declaredInject = new Set(), handlers = new Map()) {
  const target = {
    get(name) {
      return Object.prototype.hasOwnProperty.call(services, name) ? services[name] : undefined
    },
    on(ev, fn) {
      if (!handlers.has(ev)) handlers.set(ev, [])
      handlers.get(ev).push(fn)
      return () => {}
    },
    effect(fn) {
      try {
        const res = typeof fn === 'function' ? fn() : null
        return typeof res === 'function' ? res : () => {}
      } catch {
        return () => {}
      }
    },
    inject(deps, cb) {
      const childDeclared = new Set(Array.isArray(deps) ? deps : [])
      const childCtx = makeStrictCordisContext(services, childDeclared, handlers)
      cb(childCtx)
      return () => {}
    },
  }
  return new Proxy(target, {
    get(t, prop, receiver) {
      if (typeof prop === 'symbol') return Reflect.get(t, prop, receiver)
      if (Object.prototype.hasOwnProperty.call(t, prop)) return t[prop]
      if (!declaredInject.has(prop)) {
        throw new Error(`cannot get property "${String(prop)}" without inject`)
      }
      return services[prop]
    },
  })
}

try {
  const storeMod = await import(modUrl('board-store.js'))
  const subagentMod = await import(modUrl('subagent-runtime.js'))
  const actionsMod = await import(modUrl('board-actions.js'))
  const toolsMod = await import(modUrl('model-tools.js'))
  const routesMod = await import(modUrl('api-routes.js'))
  const hooksMod = await import(modUrl('runtime-hooks.js'))
  const stateMod = await import(modUrl('chief-state.js'))
  const chiefMod = await import(modUrl('chief.js'))
  const guardMod = await import(modUrl('idle-guard.js'))
  const schemaMod = await import(modUrl('board-schema.js'))
  const reviewMod = await import(modUrl('chief-review.js'))
  const execMod = await import(modUrl('chief-executor.js'))

  // Sanity check that Proxy simulates Cordis 4.2 strictness faithfully
  {
    const strictProbe = makeStrictCordisContext({ systemPrompt: {}, agent: { id: 'probe' } }, new Set(['systemPrompt']))
    assert.throws(() => strictProbe.agent, /cannot get property "agent" without inject/)
    assert.equal(strictProbe.get('agent').id, 'probe')
  }

  const hostState = {
    activeRuntime: null,
    activeLlm: null,
    activeSubprocess: null,
    activeAutoContinue: null,
    autoSteeredTurns: new Map(),
    subagentRootMap: new Map(),
    subagentTreeCache: new Map(),
    detectedHarnessProviders: new Map(),
    activeBubbleRuns: new Map(),
    handoffSeq: 0,
  }
  const bus = { hostState }
  Object.assign(bus, storeMod.createBoardStore(bus))
  Object.assign(bus, subagentMod.createSubagentRuntime(bus))
  Object.assign(bus, actionsMod.createBoardActions(bus))
  Object.assign(bus, toolsMod.createModelTools(bus))
  Object.assign(bus, routesMod.createApiRoutes(bus))
  Object.assign(bus, hooksMod.createRuntimeHooks(bus))

  const promptSections = []
  const registeredTools = []
  const eventHandlers = new Map()
  const services = {
    systemPrompt: {
      section(def) {
        promptSections.push(def)
        return () => {}
      },
    },
    llm: { chat: async () => ({ content: 'ok' }) },
    subprocess: { spawn: () => {} },
    tools: {
      register(t) {
        registeredTools.push(t)
        return () => {}
      },
    },
    webServer: { register: () => () => {} },
    subagents: { providers: new Map() },
  }

  // =========================================================================
  // Scenario 1: Cordis 4.2 strict Proxy in runtime-hooks.js apply(ctx)
  // =========================================================================
  const strictRootCtx = makeStrictCordisContext(services, new Set(), eventHandlers)
  bus.apply(strictRootCtx)

  const chiefSec = promptSections.find(s => s && s.name === 'dsh-chief')
  assert.ok(chiefSec, 'S1: dsh-chief systemPrompt section must register cleanly under Cordis 4.2 strict proxy')

  const sidS1 = 'session-s1-cordis42'
  stateMod.activateChiefSession(sidS1, { force: true })
  const renderedDigest = chiefSec.text({
    agent: { id: sidS1 },
    session: { id: sidS1 },
    scope: { id: sidS1 },
  })
  assert.ok(renderedDigest.includes('## 参谋看板'), 'S1: prompt section text(promptCtx) must render Chief digest')
  console.log('[S1 PASS] Cordis 4.2 strict proxy registration & systemPrompt.section verified')

  // =========================================================================
  // Scenario 2: buildMessageEnvelope passes DSH 0.2.3 lossless JSON validator
  // =========================================================================
  const env1 = await chiefMod.buildMessageEnvelope('请执行核查', 'dsh-chief-relay', {
    senderName: 'chief',
    senderSessionId: undefined,
    nanField: Number.NaN,
    infField: Number.POSITIVE_INFINITY,
    negZero: -0,
    nested: { ok: true, dropMe: undefined, arr: [1, -0, undefined, { x: 'a', y: undefined }] },
    role: 'relay',
  })
  assert.equal(isLosslessJsonValue(env1), true, 'S2: buildMessageEnvelope output must pass strict lossless JSON check')
  assert.equal('senderSessionId' in env1.source, false, 'S2: undefined senderSessionId key must be omitted')
  assert.equal(Object.is(env1.source.negZero, 0), true, 'S2: -0 must normalize to +0')
  assert.equal(env1.source.nested.ok, true, 'S2: valid nested properties must be preserved')
  assert.equal(env1.source.nested.arr.length, 3, 'S2: undefined elements inside arrays must be dropped')
  console.log('[S2 PASS] buildMessageEnvelope lossless JSON sanitization verified')

  // =========================================================================
  // Scenario 3: resolveAgent error propagation even when agentsSvc is absent
  // =========================================================================
  const sidPresetBroken = 'session-s3-ops-ptc-broken'
  stateMod.activateChiefSession(sidPresetBroken, { force: true })
  const presetErrRuntime = {
    get(name) {
      // Deliberately return null for 'agents' to confirm no agentsSvc gating blocks sessionController
      if (name === 'agents') return null
      if (name === 'sessionController') {
        return {
          async resolveAgent(targetId) {
            if (targetId === sidPresetBroken) {
              return {
                error: Object.assign(new Error('Unknown agent preset: ops-ptc'), {
                  code: 'agent-preset/not-found',
                }),
              }
            }
            return { error: Object.assign(new Error('not found'), { code: 'session/not-found' }) }
          },
        }
      }
      if (name === 'workingDirectory') return { defaultDirectory: workDir, get: () => workDir }
      return null
    },
  }
  const s3Deps = bus.makeChiefDeps(presetErrRuntime)
  const s3Deliv = await chiefMod.deliverCrossMessage(s3Deps, {
    fromSession: sidPresetBroken,
    target: 'lead',
    text: '启动删除任务',
    mode: 'steer',
    envelopeKind: 'execution_request',
  })
  assert.equal(s3Deliv.deliveredPhysical, false, 'S3: deliveredPhysical must be false on preset resolution failure')
  assert.equal(s3Deliv.resolveErrorCode, 'agent-preset/not-found', 'S3: resolveErrorCode must be preserved')
  assert.ok(s3Deliv.deliveryError && s3Deliv.deliveryError.includes('ops-ptc'), 'S3: deliveryError must surface clear ops-ptc preset hint')
  assert.ok(s3Deliv.note && s3Deliv.note.includes('未能送达主对话'), 'S3: note must report delivery failure')

  const boardAfterS3 = bus.loadBoard(bus.boardFileFor(sidPresetBroken))
  assert.ok(
    (boardAfterS3.log || []).some(l => l && typeof l.text === 'string' && l.text.includes('⚠️ 未送达')),
    'S3: board.log must record ⚠️ 未送达 warning',
  )

  const prevRt = bus.hostState.activeRuntime
  bus.hostState.activeRuntime = presetErrRuntime
  const chiefDepsS3 = bus.makeChiefDeps(presetErrRuntime)
  const ctrlRes = await chiefDepsS3.controlMainAgent({
    rootId: sidPresetBroken,
    sessionId: sidPresetBroken,
    op: 'followup',
    message: '去删就是',
  })
  assert.equal(ctrlRes.ok, false, 'S3: controlMainAgent must return ok: false on deliveryError')
  assert.equal(ctrlRes.badge, '⚠️ 主代理未送达', 'S3: controlMainAgent badge must not report 已递话')
  assert.ok(ctrlRes.error && ctrlRes.error.includes('ops-ptc'), 'S3: controlMainAgent must include preset error detail')
  bus.hostState.activeRuntime = prevRt
  console.log('[S3 PASS] deliverCrossMessage & controlMainAgent surface resolveAgent error accurately')

  // =========================================================================
  // Scenario 4: L2 approval & L3 relay NEVER stage pending-transfer on deliveryError
  // =========================================================================
  const pendingPath = bus.pendingFile()
  if (fs.existsSync(pendingPath)) fs.unlinkSync(pendingPath)

  const sidL2L3 = 'session-s4-no-hijack'
  chiefMod.updateChiefConfig({
    session: sidL2L3,
    permissionMode: 'strategist',
    sessionEnabled: true,
  })
  const s4PresetErrRuntime = {
    get(name) {
      if (name === 'agents') return null
      if (name === 'sessionController') {
        return {
          async resolveAgent() {
            return {
              error: Object.assign(new Error('Unknown agent preset: ops-ptc'), {
                code: 'agent-preset/not-found',
              }),
            }
          },
        }
      }
      if (name === 'workingDirectory') return { defaultDirectory: workDir, get: () => workDir }
      return null
    },
  }
  const relayDepsS4 = {
    ...bus.makeChiefDeps(s4PresetErrRuntime),
    stagePendingTransfer: (text, fromSid, extra) => bus.writePending({ text, session: fromSid, ...(extra || {}) }),
    callLlmOverride: async () => ({
      ok: true,
      text: JSON.stringify({
        reply: '- 【准备递话】提交删除执行请求。',
        relays: [{ target: 'lead', subject: '删除机场', text: '立即执行删除', mode: 'steer' }],
      }),
    }),
  }

  // L2 ask on an otherwise empty session naturally sets isBlankContext=true on the approval payload
  const l2Ask = await chiefMod.askOrCommandChief(relayDepsS4, {
    sessionId: sidL2L3,
    text: '让主对话立即删除',
  })
  assert.equal(l2Ask.ok, true)
  const aprId = l2Ask.pendingApprovals[0].id
  assert.equal(l2Ask.pendingApprovals[0].payload.isBlankContext, true, 'S4 setup: payload.isBlankContext should be true to exercise anti-hijack guard')
  const l2Decide = await chiefMod.handleApprovalDecision(relayDepsS4, {
    sessionId: sidL2L3,
    approvalId: aprId,
    decision: 'approve',
  })
  assert.equal(l2Decide.executed, false, 'S4: L2 executed must be false when deliveryError occurs')
  assert.equal(l2Decide.executionOk, false, 'S4: L2 executionOk must be false when deliveryError occurs')
  assert.equal(l2Decide.approval.status, 'failed', 'S4: L2 approval status must be marked failed')
  assert.ok(l2Decide.approval.resultMessage && l2Decide.approval.resultMessage.includes('ops-ptc'), 'S4: L2 resultMessage must expose preset failure')
  assert.equal(fs.existsSync(pendingPath), false, 'S4: L2 failure must NOT create pending-transfer.json')

  // L3 direct relay
  chiefMod.updateChiefConfig({
    session: sidL2L3,
    permissionMode: 'chief',
    confirmedChiefRisk: true,
    sessionEnabled: true,
  })
  const l3Res = await chiefMod.askOrCommandChief(relayDepsS4, {
    sessionId: sidL2L3,
    text: '去删就是',
  })
  assert.equal(fs.existsSync(pendingPath), false, 'S4: L3 deliveryError must NOT hijack pending-transfer.json')
  assert.ok(l3Res.actionBadges.includes('⚠️ 未送达主对话'), 'S4: L3 must emit ⚠️ 未送达主对话 badge')
  assert.ok(l3Res.reply.includes('主对话通道受阻') && l3Res.reply.includes('ops-ptc'), 'S4: L3 reply must surface blocked channel reason')
  console.log('[S4 PASS] L2 & L3 never hijack pending-transfer.json on hard delivery failure')

  // =========================================================================
  // Scenario 5: isBlankContext distinguishes compacted existing sessions vs genuine blank sessions
  // =========================================================================
  const coldNoPresetRt = {
    get(name) {
      if (name === 'agents') return { get: () => null, list: () => [] }
      if (name === 'workingDirectory') return { defaultDirectory: workDir, get: () => workDir }
      return null
    },
  }
  const sidCompactedCold = 'session-s5-compacted-cold'
  chiefMod.updateChiefConfig({
    session: sidCompactedCold,
    permissionMode: 'chief',
    confirmedChiefRisk: true,
    sessionEnabled: true,
  })
  chiefMod.mutateChiefState((s) => {
    const ws = s.workspaces[sidCompactedCold]
    ws.runtimeGuard.lastCompactedSeq = 215
  })
  const s5Deps = {
    ...bus.makeChiefDeps(coldNoPresetRt),
    stagePendingTransfer: (text, fromSid, extra) => bus.writePending({ text, session: fromSid, ...(extra || {}) }),
    callLlmOverride: async () => ({
      ok: true,
      text: JSON.stringify({
        reply: '- 【准备递话】已通知主对话。',
        relays: [{ target: 'lead', subject: '继续排查', text: '继续执行核查', mode: 'steer' }],
      }),
    }),
  }
  const compactedRelay = await chiefMod.askOrCommandChief(s5Deps, {
    sessionId: sidCompactedCold,
    text: '继续干活',
  })
  assert.equal(fs.existsSync(pendingPath), false, 'S5: compacted cold session (lastCompactedSeq > 0) must NOT be misclassified as blank and stage pending-transfer.json')
  assert.equal(compactedRelay.actionBadges.includes('暂存待领 → 主对话'), false)

  // Genuinely blank session still stages pending-transfer.json
  const sidGenuineBlank = 'session-s5-genuine-blank'
  chiefMod.updateChiefConfig({
    session: sidGenuineBlank,
    permissionMode: 'chief',
    confirmedChiefRisk: true,
    sessionEnabled: true,
  })
  const blankRelay = await chiefMod.askOrCommandChief(s5Deps, {
    sessionId: sidGenuineBlank,
    text: '帮我交给下一个新会话执行',
  })
  assert.equal(fs.existsSync(pendingPath), true, 'S5: genuine blank session must continue staging pending-transfer.json')
  assert.ok(blankRelay.actionBadges.includes('暂存待领 → 主对话'), 'S5: genuine blank session emits staging badge')
  fs.unlinkSync(pendingPath)
  console.log('[S5 PASS] Compacted cold sessions do not trigger false blank transfer; blank sessions preserve staging')

  // =========================================================================
  // Scenario 6: `user/message` session/event refreshes activity & scoped compaction penetrates isolated preset
  // =========================================================================
  const sidS6 = 'session-s6-compat'
  stateMod.activateChiefSession(sidS6, { force: true })
  const sessionEventList = eventHandlers.get('session/event') || []
  assert.ok(sessionEventList.length > 0, 'S6: session/event listener must be registered')
  const beforeAct = chiefMod.loadChiefState().workspaces[sidS6].runtimeGuard.lastActivityAt || 0
  await new Promise(r => setTimeout(r, 15))
  for (const h of sessionEventList) {
    h({ id: sidS6 }, { type: 'user/message', seq: 1, data: { content: [{ type: 'text', text: 'hello' }] } })
  }
  const afterAct = chiefMod.loadChiefState({ forceDisk: true }).workspaces[sidS6].runtimeGuard.lastActivityAt || 0
  assert.ok(afterAct > beforeAct, 'S6: user/message event must refresh workspace lastActivityAt')

  let compactCalledWith = null
  const mockAgentS6 = { id: sidS6, status: 'idle', ctx: {} }
  const scopedCompRt = {
    get(name) {
      if (name === 'agents') return { get: (id) => (id === sidS6 ? mockAgentS6 : null) }
      if (name === 'compaction') return null // absent at root in 0.2.3 preset isolation
      if (name === 'agentPresets') {
        return {
          serviceFor(ag, svcName) {
            if (ag === mockAgentS6 && svcName === 'compaction') {
              return {
                async compactNow(agent, _signal, cmdId) {
                  compactCalledWith = { agentId: agent.id, cmdId }
                  return { shadowedSeqs: [1, 2, 3], shadowedTokenCount: 1500 }
                },
              }
            }
            return null
          },
        }
      }
      return null
    },
  }
  const compResult = await bus.executeHostSessionCompaction(scopedCompRt, sidS6, 'cmd-s6-test')
  assert.equal(compResult.ok, true, 'S6: executeHostSessionCompaction must succeed via agentPresets.serviceFor(ag, compaction)')
  assert.equal(compResult.via, 'compaction.compactNow')
  assert.deepEqual(compactCalledWith, { agentId: sidS6, cmdId: 'cmd-s6-test' })
  console.log('[S6 PASS] user/message activity refresh & preset-isolated compaction verified')

  // =========================================================================
  // Scenario 7: Safety Shield toggle anti-deadlock & human-only confirmation
  // =========================================================================
  const sidS7 = 'session-s7-safety-deadlock'
  stateMod.activateChiefSession(sidS7, { force: true })

  // AI attempt remains strictly blocked
  const aiToggleBlocked = stateMod.updateChiefConfig({
    sessionId: sidS7,
    tacticalModes: { safetyGuardEnabled: false },
    confirmedDisableSafetyGuard: true,
    by: 'chief',
  })
  assert.equal(aiToggleBlocked.ok, false)
  assert.equal(aiToggleBlocked.code, 'safety_guard_human_only')

  // Human disables per-session Safety Shield with confirmation
  const disableS7 = stateMod.updateChiefConfig({
    sessionId: sidS7,
    tacticalModes: { safetyGuardEnabled: false },
    confirmedDisableSafetyGuard: true,
    _fromUiPanel: true,
    byUser: true,
  })
  assert.equal(disableS7.ok, true)
  assert.equal(disableS7.config.tacticalModes.safetyGuardEnabled, false)

  // Subsequent tactical toggle WITHOUT confirmedDisableSafetyGuard MUST NOT deadlock
  // — even if stale UI payload still carries `safetyGuardEnabled: false`
  const stalePayloadToggle = stateMod.updateChiefConfig({
    sessionId: sidS7,
    tacticalModes: { safetyGuardEnabled: false, redlineSentinel: false },
    _fromUiPanel: true,
    byUser: true,
  })
  assert.equal(stalePayloadToggle.ok, true, 'S7: keeping already-disabled safetyGuardEnabled=false while toggling redlineSentinel must succeed without confirm deadlock')
  assert.equal(stalePayloadToggle.config.tacticalModes.redlineSentinel, false)

  const partialToggle = stateMod.updateChiefConfig({
    sessionId: sidS7,
    tacticalModes: { redlineSentinel: true },
    _fromUiPanel: true,
    byUser: true,
  })
  assert.equal(partialToggle.ok, true, 'S7: partial tactical update while Safety Shield is off must succeed')
  assert.equal(partialToggle.config.tacticalModes.redlineSentinel, true)
  assert.equal(partialToggle.config.tacticalModes.safetyGuardEnabled, false)

  // Also test global Safety Shield off -> partial tactical update does not deadlock
  const disableGlobalS7 = stateMod.updateChiefConfig({
    sessionId: sidS7,
    globalSafetyGuardEnabled: false,
    confirmedDisableSafetyGuard: true,
    _fromUiPanel: true,
    byUser: true,
  })
  assert.equal(disableGlobalS7.ok, true)
  const toggleUnderGlobalOff = stateMod.updateChiefConfig({
    sessionId: sidS7,
    tacticalModes: { conciseBrief: false },
    _fromUiPanel: true,
    byUser: true,
  })
  assert.equal(toggleUnderGlobalOff.ok, true, 'S7: toggling tactical switches while global Safety Shield is off must succeed')

  // Re-enable both -> unconfirmed disable MUST prompt confirmation again
  stateMod.updateChiefConfig({ sessionId: sidS7, globalSafetyGuardEnabled: true, _fromUiPanel: true, byUser: true })
  stateMod.updateChiefConfig({ sessionId: sidS7, tacticalModes: { safetyGuardEnabled: true }, _fromUiPanel: true, byUser: true })
  const reDisableWithoutConfirm = stateMod.updateChiefConfig({
    sessionId: sidS7,
    tacticalModes: { safetyGuardEnabled: false },
    _fromUiPanel: true,
    byUser: true,
  })
  assert.equal(reDisableWithoutConfirm.ok, false)
  assert.equal(reDisableWithoutConfirm.requireSafetyGuardConfirm, true, 'S7: turning ON->OFF without confirm must still require confirmation')
  console.log('[S7 PASS] Safety Shield anti-deadlock & human-only confirm flow verified')

  // =========================================================================
  // Scenario 8: Idle-guard premature promise cues + completed sentence non-trigger
  // =========================================================================
  const realStallText = '现在执行独立黑盒验证（验收 B-F）。该测试文件本身就是独立黑盒（自包含、隔离环境、严格 Cordis 代理模拟），已通过。补充验证：确认运行态加载的插件与磁盘一致性（哈希比对）。'
  const realCue = guardMod.detectPrematurePromiseText(realStallText)
  assert.ok(realCue.length > 0, 'S8: multi-sentence wrap-up ending with 补充验证：确认... must trigger premature promise cue')

  assert.equal(
    guardMod.detectPrematurePromiseText('回归验证已通过，补充验证已完成，全部完成。'),
    '',
    'S8: genuinely completed summary must NOT false-trigger premature promise cue',
  )

  const sidS8 = 'session-s8-idle-cue'
  const s8Board = schemaMod.normalizeBoard({
    objective: '完成 1.7.1 本地部署与运行态一致性验收',
    plan: [{ id: 'p1', text: '运行态插件一致性哈希核验', done: false }],
    tasks: [{ id: 'verify171-blackbox', title: '独立黑盒验证', status: 'doing' }],
  })
  const s8Session = {
    snapshotEvents: () => [
      { type: 'tool/call', data: { turn: 2, name: 'chief_board', arguments: JSON.stringify({ action: 'task.update', id: 'verify171-regressions', status: 'done' }) } },
      { type: 'assistant/message', data: { turn: 2, message: { content: [{ type: 'text', text: realStallText }] } } },
    ],
  }
  const s8Verdict = guardMod.shouldGuard({
    board: s8Board,
    session: s8Session,
    sessionId: sidS8,
    turn: 2,
    settings: { guardIdle: true },
    strongIntervention: false,
  })
  assert.ok(s8Verdict && s8Verdict.kind === 'premature-promise', `S8: expected premature-promise even after prior task.update, got ${JSON.stringify(s8Verdict)}`)
  console.log('[S8 PASS] Idle-guard catches "现在执行 / 补充验证" stall without false-firing on done summaries')

  // =========================================================================
  // Scenario 9: Smart Compact anti-premature/stall gating + safety vs custom rule alert split
  // =========================================================================
  const sidS9Low = 'session-s9-low-ctx'
  chiefMod.updateChiefConfig({
    sessionId: sidS9Low,
    permissionMode: 'strategist',
    runMode: 'patrol',
    sessionEnabled: true,
    tacticalModes: { autoCompact: true, smartCompact: true, intervention: false },
    _fromUiPanel: true,
    byUser: true,
  })
  let s9LowCompacted = 0
  const s9LowAgent = {
    id: sidS9Low,
    status: 'idle',
    session: {
      deriveMessages: () => [
        { role: 'user', content: [{ type: 'text', text: '帮我测试 1.7.1' }] },
        { role: 'assistant', content: [{ type: 'text', text: '测试套件已全部通过，本阶段测试结论如下：全部 14 项检查退出码为 0。' }] },
      ],
    },
  }
  const s9LowDeps = {
    ...bus.makeChiefDeps({ get: () => null }),
    getAgentStatus: () => 'idle',
    measureSessionTokens: async () => ({ totalTokens: 12_800, contextWindow: 128_000, seq: 6 }),
    compactSessionNow: async () => { s9LowCompacted += 1; return { ok: true } },
    callLlmOverride: async () => ({
      ok: true,
      text: JSON.stringify({
        memoryChanges: [],
        boardOps: [],
        planAssessment: { stale: false, reason: '' },
        goalStatus: 'in_progress',
        hazardStop: { triggered: false },
        shouldIntervene: false,
        shouldCompactNow: true,
        compactReason: '阶段刚刚完成，建议归档压缩',
        suggestions: [],
      }),
    }),
  }
  await reviewMod.runTurnReview(s9LowDeps, { agent: s9LowAgent, sessionId: sidS9Low, turn: 1 })
  const wsS9Low = stateMod.loadChiefState({ forceDisk: true }).workspaces[sidS9Low]
  assert.equal(
    (wsS9Low.pendingApprovals || []).some(a => a && a.kind === 'compact' && a.status === 'pending'),
    false,
    'S9: Smart Compact must be suppressed at 10% low context (12.8K/128K)',
  )
  assert.equal(s9LowCompacted, 0)

  // Premature verbal-promise stall suppresses Smart Compact even above 50% context & emits ⏸ 空转提醒 card
  const sidS9Stall = 'session-s9-stall-no-compact'
  chiefMod.updateChiefConfig({
    sessionId: sidS9Stall,
    permissionMode: 'strategist',
    runMode: 'patrol',
    sessionEnabled: true,
    tacticalModes: { autoCompact: true, smartCompact: true, intervention: false },
    _fromUiPanel: true,
    byUser: true,
  })
  const bFileS9Stall = bus.boardFileFor(sidS9Stall)
  bus.withBoardLock(bFileS9Stall, () => {
    const b = bus.loadBoard(bFileS9Stall)
    b.tasks = [schemaMod.normalizeTask({ id: 't-s9-open', title: '核对运行态哈希', status: 'doing' })]
    bus.saveBoard(b, bFileS9Stall)
  })
  const s9StallAgent = {
    id: sidS9Stall,
    status: 'idle',
    session: {
      deriveMessages: () => [
        { role: 'user', content: [{ type: 'text', text: '跑完回归并核验运行态一致' }] },
        { role: 'assistant', content: [{ type: 'text', text: realStallText }] },
      ],
    },
  }
  const s9StallDeps = {
    ...bus.makeChiefDeps({ get: () => null }),
    getAgentStatus: () => 'idle',
    measureSessionTokens: async () => ({ totalTokens: 65_000, contextWindow: 128_000, seq: 12 }),
    compactSessionNow: async () => ({ ok: true }),
    callLlmOverride: async () => ({
      ok: true,
      text: JSON.stringify({
        memoryChanges: [],
        boardOps: [],
        planAssessment: { stale: false, reason: '' },
        goalStatus: 'in_progress',
        hazardStop: { triggered: false },
        shouldIntervene: false,
        shouldCompactNow: true,
        compactReason: '阶段切换，可压缩',
        suggestions: [],
      }),
    }),
  }
  await reviewMod.runTurnReview(s9StallDeps, { agent: s9StallAgent, sessionId: sidS9Stall, turn: 2 })
  const wsS9Stall = stateMod.loadChiefState({ forceDisk: true }).workspaces[sidS9Stall]
  assert.equal(
    (wsS9Stall.pendingApprovals || []).some(a => a && a.kind === 'compact' && a.status === 'pending'),
    false,
    'S9: Smart Compact must NOT trigger ahead of a premature-promise stall even at >50% context',
  )
  assert.ok(
    (wsS9Stall.suggestions || []).some(s => s && s.status === 'pending' && s.fromAgent === '⏸ 空转提醒'),
    'S9: Smart Compact stall avoidance must surface lightweight ⏸ 空转提醒 suggestion card when intervention is off',
  )

  // Verify runtime-hooks splits Safety Shield blocks vs Custom Block Rule blocks cleanly
  const preExecHandlers = eventHandlers.get('tools/pre-execute') || []
  assert.ok(preExecHandlers.length > 0, 'S9: tools/pre-execute handler must be registered')
  const preExec = preExecHandlers[preExecHandlers.length - 1]
  const sidS9Hook = 'session-s9-preexec-split'
  stateMod.activateChiefSession(sidS9Hook, { force: true })

  const shieldDeny = await preExec(
    { name: 'run_command', arguments: { command: 'rm -rf /' }, agent: { id: sidS9Hook } },
    async () => ({ kind: 'allow' }),
  )
  assert.equal(shieldDeny.kind, 'deny')
  assert.ok(shieldDeny.reason.includes('安全拦截'), `S9: Safety Block deny must label 安全拦截, got ${shieldDeny.reason}`)

  const customWallRes = execMod.mutateGuardWalls({
    op: 'save',
    wall: {
      id: 's9-custom-wall',
      title: 'S9 测试拦截规则',
      ruleType: 'forbid_cmd',
      patterns: ['danger_s9_cmd'],
      scope: 'global',
    },
    cwd: workDir,
    callerOrigin: 'human_ui',
    humanConfirmToken: execMod.HUMAN_BOUNDS_CONFIRM_TOKEN,
  })
  assert.equal(customWallRes.ok, true)
  try {
    const wallDeny = await preExec(
      { name: 'run_command', arguments: { command: 'danger_s9_cmd --now' }, agent: { id: sidS9Hook } },
      async () => ({ kind: 'allow' }),
    )
    assert.equal(wallDeny.kind, 'deny')
    assert.ok(wallDeny.reason.includes('自定义拦截规则'), `S9: Custom rule deny must label 自定义拦截规则, got ${wallDeny.reason}`)
  } finally {
    execMod.mutateGuardWalls({
      op: 'remove',
      wallId: 's9-custom-wall',
      cwd: workDir,
      callerOrigin: 'human_ui',
      humanConfirmToken: execMod.HUMAN_BOUNDS_CONFIRM_TOKEN,
    })
  }
  const wsS9Hook = stateMod.loadChiefState({ forceDisk: true }).workspaces[sidS9Hook]
  assert.ok(
    (wsS9Hook.alertEvents || []).some(a => a && a.kind === 'safety_guard_blocked' && a.title.includes('安全拦截')),
    'S9: alertEvents must emit safety_guard_blocked for built-in Safety Block',
  )
  assert.ok(
    (wsS9Hook.alertEvents || []).some(a => a && a.kind === 'guard_wall_blocked' && a.title.includes('自定义拦截规则')),
    'S9: alertEvents must emit guard_wall_blocked for custom block rule',
  )
  console.log('[S9 PASS] Smart Compact low-context & stall guardrails + Safety Shield vs Custom Block Rule alert split verified')

  console.log('\nALL v1.7.0/v1.7.1 DSH 0.2.3-alpha.2 COMPATIBILITY & SAFETY UX CHECKS (S1-S9) PASSED!')
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
}
