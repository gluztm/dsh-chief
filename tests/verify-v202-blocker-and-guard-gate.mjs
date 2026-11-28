#!/usr/bin/env node
/**
 * verify-v202-blocker-and-guard-gate.mjs
 *
 * Self-contained regression gate covering session.v4.jsonl fixes (B1 ~ B5):
 *   - B1: idle-guard no false positive on "重启命令" & explicit blocked cursor/tasks
 *   - B2: chief-review external hard-blocker pause stops unmetMustDo nag loop
 *   - B3: chief-review structural anti-spin hash stops rephrased empty loops (and keeps active work unblocked)
 *   - B4: command-ops L3 user-escalation chief.request does NOT bounce back to @lead
 *   - B5: chief-review pre-delivery freshness check drops stale or agent-running interventions
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PKG = path.resolve(__dirname, '..')

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-v202-blocker-gate-'))
const dshHome = path.join(tmpRoot, 'dsh-home')
const chiefDataDir = path.join(tmpRoot, 'chief-data')
const boardDir = path.join(tmpRoot, 'boards')
fs.mkdirSync(dshHome, { recursive: true })
fs.mkdirSync(chiefDataDir, { recursive: true })
fs.mkdirSync(boardDir, { recursive: true })

process.env.DSH_HOME = dshHome
process.env.DSH_CHIEF_DATA_DIR = chiefDataDir

function modUrl(rel) {
  return pathToFileURL(path.join(PKG, rel)).href
}

try {
  const schemaMod = await import(modUrl('board-schema.js'))
  const storeMod = await import(modUrl('board-store.js'))
  const actionsMod = await import(modUrl('board-actions.js'))
  const subagentMod = await import(modUrl('subagent-runtime.js'))
  const stateMod = await import(modUrl('chief-state.js'))
  const guardMod = await import(modUrl('idle-guard.js'))
  const reviewMod = await import(modUrl('chief-review.js'))
  const cmdOpsMod = await import(modUrl('command-ops.js'))

  // =========================================================================
  // B1: idle-guard false positive & blocked board exemptions
  // =========================================================================
  const l462Text = '已回报。两条必做事项都卡在用户拍板，不是我这轮能单方面完成的：\n\n- **黑盒实测**：缺 SSH 接入信息（host/port/凭证、config.json 路径、重启命令）\n- **清扫现场**：`_routing_review` 里两份产物本身就是验收证据和待执行的 diff 草稿，验收前删等于销毁成果\n\n板子已更新断点，明确写了「卡在」的具体缺失项。这轮收工。'
  assert.equal(guardMod.detectPrematurePromiseText(l462Text), '', 'B1: "重启命令" + "卡在用户拍板" must not trigger detectPrematurePromiseText')
  assert.equal(guardMod.detectPrematurePromiseText('缺少云机 config 路径与重启命令，已上报用户。'), '', 'B1: noun phrase "重启命令" must not trigger promise detector')
  assert.ok(guardMod.detectPrematurePromiseText('只欠 backb 3 张。重启 ComfyUI 补跑。'), 'B1: genuine promise "重启 ComfyUI 补跑" must still trigger')

  const b1BlockedBoard = schemaMod.normalizeBoard({
    objective: '完成生图路由改造并实测验收',
    plan: [{ id: 'p1', text: '列出云机接入方式清单转呈用户拍板', done: false }],
    tasks: [{ id: 't1', title: '黑盒实测云机路由', status: 'blocked', note: '缺 SSH 接入' }],
    cursor: { step: '已产出两份文档并发送协同信箱', blocked: '缺云机 SSH 凭证，等用户拍板' },
  })
  const b1Sess = {
    snapshotEvents: () => [
      { type: 'tool/call', data: { turn: 11, name: 'chief_board', arguments: JSON.stringify({ action: 'cursor.set', blocked: '缺 SSH' }) } },
      { type: 'assistant/message', data: { turn: 11, message: { content: [{ type: 'text', text: l462Text }] } } },
    ],
  }
  const vB1 = guardMod.shouldGuard({
    board: b1BlockedBoard,
    session: b1Sess,
    sessionId: 'sess-b1-blocked',
    turn: 11,
    settings: { guardIdle: true },
    strongIntervention: true,
    maxInterventionTurns: 0,
  })
  assert.equal(vB1, null, 'B1: blocked board + Turn 11 explanation must return null from shouldGuard')

  const b1DoingBoard = schemaMod.normalizeBoard({
    objective: '联调测试',
    plan: [{ id: 'p1', text: '继续', done: false }],
    tasks: [{ id: 't1', title: '联调', status: 'doing' }],
  })
  const vB1Ungrounded = guardMod.shouldGuard({
    board: b1DoingBoard,
    session: {
      snapshotEvents: () => [
        { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '等待外部输入。' }] } } },
      ],
    },
    sessionId: 'sess-b1-ungrounded',
    turn: 1,
    settings: { guardIdle: true },
    hasRunningSubagent: false,
    hasLinkedPeers: false,
  })
  assert.equal(vB1Ungrounded?.kind, 'idle-close', 'B1: ungrounded waiting text must still trigger idle-close')
  console.log('[B1 PASS] idle-guard excludes noun "重启命令" and honors explicit hard-blocker state')

  // Shared mock host harness for B2 ~ B5
  const agentsMap = new Map()
  const followups = []
  const steers = []
  const cancelledAuto = []
  let llmHandler = async () => ({ ok: true, text: '{}' })

  const hostState = {
    activeRuntime: null,
    activeLlm: null,
    activeAutoContinue: null,
    autoSteeredTurns: new Map(),
    subagentRootMap: new Map(),
    subagentTreeCache: new Map(),
    handoffSeq: 0,
  }
  const runtime = {
    get: name => (name === 'agents' ? agentsMap : null),
  }
  const bus = {
    hostState,
    runtime,
    boardFile: () => path.join(boardDir, 'shared.json'),
    boardFileFor: sid => path.join(boardDir, `${String(sid || 'main').replace(/[^\w-]/g, '_')}.json`),
    sharedBoardFile: () => path.join(boardDir, 'shared.json'),
    resolveRootSessionId: s => String(s || 'global').trim() || 'global',
    getSessionCwd: () => tmpRoot,
    getAgentStatus: sid => (agentsMap.get(sid)?.status || 'idle'),
    appendBoardLog: () => {},
    cancelAutoContinue: (sid, reason) => cancelledAuto.push({ sid, reason }),
    callLlmOverride: async opts => llmHandler(opts),
  }
  Object.assign(bus, storeMod.createBoardStore(bus))
  Object.assign(bus, subagentMod.createSubagentRuntime(bus))
  Object.assign(bus, actionsMod.createBoardActions(bus))
  bus.hostState.activeRuntime = runtime

  function regAgent(sid, msgs, { status = 'idle' } = {}) {
    const ag = {
      id: sid,
      name: 'lead',
      status,
      session: {
        deriveMessages: () => msgs,
        snapshotEvents: () => [],
      },
      followup: async msg => {
        followups.push({ sid, msg })
        return { ok: true }
      },
      steer: msg => {
        steers.push({ sid, msg })
        return { ok: true }
      },
    }
    agentsMap.set(sid, ag)
    return ag
  }

  // =========================================================================
  // B2: Hard-blocker stop valve suppresses unmetMustDoFallback & pauses intervention
  // =========================================================================
  for (const [idx, caseSpec] of [
    { sid: 'sess-b2-blocked-status', goalStatus: 'blocked', shouldIntervene: false },
    { sid: 'sess-b2-unmet-with-inprogress', goalStatus: 'in_progress', shouldIntervene: false },
  ].entries()) {
    const sid = caseSpec.sid
    const msgs = [
      { id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '改造云机生图路由并黑盒实测' }] },
      { id: 'a1', role: 'assistant', content: [{ type: 'text', text: l462Text }] },
    ]
    const ag = regAgent(sid, msgs, { status: 'idle' })
    bus.runAction({ action: 'objective.set', session: sid, objective: '完成生图路由改造并黑盒实测验收', _fromInterventionSetup: true })
    bus.runAction({ action: 'task.add', session: sid, id: `t-${idx}`, title: '云机实测复跑', status: 'blocked', note: '缺云机 SSH 接入，等待用户拍板' })
    bus.runAction({ action: 'cursor.set', session: sid, step: '已提交对比表与 diff 草稿', blocked: '缺云机 SSH 接入，等待用户拍板' })
    await stateMod.updateChiefConfig({
      session: sid,
      permissionMode: 'chief',
      confirmedChiefRisk: true,
      runMode: 'managed',
      confirmedAutoPilot: true,
      tacticalModes: { intervention: true, maxInterventionTurns: 0, strictVerify: true, redlineSentinel: true },
      confirmedInterventionRisk: true,
      confirmedUnlimitedTurns: true,
    })

    llmHandler = async () => ({
      ok: true,
      text: JSON.stringify({
        memoryChanges: [],
        boardOps: [],
        planAssessment: { stale: false, reason: '' },
        goalStatus: caseSpec.goalStatus,
        goalMissing: '缺云机 SSH 接入方式（host/port/凭证）及用户 A/B/C 拍板',
        unmetMustDo: [
          '黑盒实测复测断言（缺云机接入，无法执行）',
          '清扫 _routing_review 临时产物（须待验收后处置）',
        ],
        hazardStop: { triggered: false },
        shouldIntervene: caseSpec.shouldIntervene,
        interventionText: '',
        suggestions: [],
      }),
    })

    const fBefore = followups.length
    const res = await reviewMod.runTurnReview(bus, { agent: ag, sessionId: sid, turn: 12 })
    assert.equal(res.ok, true)
    assert.equal(res.blockerPaused, true, `B2(${sid}): must trigger hard-blocker pause`)
    assert.equal(res.intervened, false, `B2(${sid}): must NOT nag @lead`)
    assert.equal(followups.length, fBefore, `B2(${sid}): 0 followup deliveries expected`)

    const stAfter = stateMod.loadChiefState({ forceDisk: true })
    const wsAfter = stateMod.ensureWorkspace(stAfter, sid)
    assert.equal(stateMod.resolveWorkspaceConfig(stAfter, sid).tacticalModes.intervention, false, `B2(${sid}): intervention must pause`)
    assert.ok(wsAfter.chat.some(c => c && c.text && c.text.includes('外部硬阻塞 · 强介入已暂停待您拍板')), `B2(${sid}): panel chat pause card expected`)
    assert.ok(wsAfter.alertEvents.some(a => a && a.kind === 'blocker_halt'), `B2(${sid}): blocker_halt alert expected`)
  }
  console.log('[B2 PASS] External hard-blocker pause stops unmetMustDo loop & pauses intervention')

  // =========================================================================
  // B3: Structural anti-spin hash defeats rephrased empty loops without false trips on real tool work
  // =========================================================================
  const sidB3 = 'sess-b3-spin'
  const b3Msgs = [
    { id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '继续执行任务' }] },
    { id: 'a1', role: 'assistant', content: [{ type: 'text', text: '第1次换句话说明卡住了，请看报告。' }] },
  ]
  const agB3 = regAgent(sidB3, b3Msgs, { status: 'idle' })
  bus.runAction({ action: 'objective.set', session: sidB3, objective: '完成某项本地改造并验证', _fromInterventionSetup: true })
  bus.runAction({ action: 'task.add', session: sidB3, id: 't-b3', title: '本地改造验证', status: 'doing' })
  await stateMod.updateChiefConfig({
    session: sidB3,
    permissionMode: 'chief',
    confirmedChiefRisk: true,
    runMode: 'managed',
    confirmedAutoPilot: true,
    tacticalModes: { intervention: true, maxInterventionTurns: 0 },
    confirmedInterventionRisk: true,
    confirmedUnlimitedTurns: true,
  })
  llmHandler = async () => ({
    ok: true,
    text: JSON.stringify({
      memoryChanges: [],
      boardOps: [],
      planAssessment: { stale: false, reason: '' },
      goalStatus: 'in_progress',
      goalMissing: '尚未验证通过',
      unmetMustDo: [],
      hazardStop: { triggered: false },
      shouldIntervene: true,
      interventionText: '请调用工具推进当前任务并提交输出。',
      suggestions: [],
    }),
  })
  const b3Replies = [
    '第1次换句话说明，当前没有新动作。',
    '第2次更换措辞：任务并无新变化，无法推进。',
    '第3次再次换说法：重复说明只会消耗额度。',
    '第4次换句表述：依然零实质工具执行。',
  ]
  let trippedRes = null
  for (let i = 0; i < b3Replies.length; i += 1) {
    b3Msgs.push({
      id: `a-${i + 2}`,
      role: 'assistant',
      content: [
        { type: 'text', text: b3Replies[i] },
        { type: 'tool_use', name: 'chief_board', input: { action: 'cursor.set', step: `重述 #${i}` } },
      ],
    })
    const r = await reviewMod.runTurnReview(bus, { agent: agB3, sessionId: sidB3, turn: i + 1, force: true })
    if (r.circuitTripped) {
      trippedRes = r
      break
    }
  }
  assert.ok(trippedRes && trippedRes.circuitTripped === true, 'B3: rephrased empty loops must trip structural circuit breaker within 4 rounds')
  assert.equal(stateMod.resolveWorkspaceConfig(stateMod.loadChiefState({ forceDisk: true }), sidB3).tacticalModes.intervention, false, 'B3: circuit breaker must turn off intervention')

  // Control group: 4 rounds with distinct substantive workspace tools must NOT trip
  const sidB3Active = 'sess-b3-active-work'
  const b3ActiveMsgs = [
    { id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '逐步排查四个模块' }] },
  ]
  const agB3Active = regAgent(sidB3Active, b3ActiveMsgs, { status: 'idle' })
  bus.runAction({ action: 'objective.set', session: sidB3Active, objective: '完成四模块测试', _fromInterventionSetup: true })
  await stateMod.updateChiefConfig({
    session: sidB3Active,
    permissionMode: 'chief',
    confirmedChiefRisk: true,
    tacticalModes: { intervention: true, maxInterventionTurns: 0 },
    confirmedInterventionRisk: true,
    confirmedUnlimitedTurns: true,
  })
  for (let i = 1; i <= 4; i += 1) {
    b3ActiveMsgs.push({ id: `u-step-${i}`, role: 'user', source: { kind: 'dsh-chief-execution-request' }, content: [{ type: 'text', text: `继续第 ${i} 步` }] })
    b3ActiveMsgs.push({
      id: `a-step-${i}`,
      role: 'assistant',
      content: [
        { type: 'text', text: `第 ${i} 个模块检查完成。` },
        { type: 'tool_use', name: 'bash', input: { command: `node test-mod-${i}.mjs` } },
      ],
    })
    const r = await reviewMod.runTurnReview(bus, { agent: agB3Active, sessionId: sidB3Active, turn: i, force: true })
    assert.equal(r.circuitTripped, false, `B3 control step ${i}: substantive distinct tool calls must NOT trip breaker`)
  }
  console.log('[B3 PASS] Structural anti-spin hash catches rephrased idle loops & spares active tool progress')

  // =========================================================================
  // B4: command-ops L3 user-escalation chief.request does NOT bounce to @lead
  // =========================================================================
  const sidB4 = 'sess-b4-escalate'
  regAgent(sidB4, [
    { id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '改造云机路由' }] },
  ], { status: 'idle' })
  await stateMod.updateChiefConfig({
    session: sidB4,
    permissionMode: 'chief',
    confirmedChiefRisk: true,
    tacticalModes: { intervention: true, maxInterventionTurns: 0 },
    confirmedInterventionRisk: true,
    confirmedUnlimitedTurns: true,
  })
  const b4Prompts = []
  cmdOpsMod.registerAskOrCommandChiefRunner(async (_deps, opts) => {
    b4Prompts.push(opts.text)
    if (opts.text.includes('递呈用户') || opts.text.includes('三选一')) {
      return {
        ok: true,
        relays: [],
        reply: '## 极简目标战报\n- 【⛔ 受阻目标】改造必须登上云机才能动手，而云机的 SSH 接入信息只有您有\n- 【🙋 用户需要提供什么】请您在三选一里挑一个并直接回复：A / B / C',
      }
    }
    return {
      ok: true,
      relays: [],
      reply: '已核准你的单测补充方案，请直接修改 tests/foo.mjs 后跑一遍。',
    }
  })

  const dBeforeEsc = followups.length + steers.length
  const escRes = await cmdOpsMod.handleLeadDirectRequestToChief(bus, {
    fromSession: sidB4,
    subject: '请求用户拍板三选一',
    text: '请求参谋长把以下三选一递呈用户（不是继续催我）：A 放弃修改；B 仅留本地草案；C 提供 SSH 接入方式。',
  })
  assert.equal(escRes.ok, true)
  assert.equal(escRes.actionTaken, 'escalated_to_user', 'B4: user escalation must return escalated_to_user')
  assert.equal(escRes.pausedIntervention, true, 'B4: escalation must pause active strong intervention')
  assert.equal(followups.length + steers.length, dBeforeEsc, 'B4: user-facing blocker reply MUST NOT be bounced back into @lead')
  const stB4After = stateMod.loadChiefState({ forceDisk: true })
  assert.equal(stateMod.resolveWorkspaceConfig(stB4After, sidB4).tacticalModes.intervention, false, 'B4: tacticalModes.intervention must be false after escalation')
  assert.ok(cancelledAuto.some(c => c.sid === sidB4), 'B4: auto-continue must be cancelled on user escalation')

  // Normal L3 chief.request (not user-blocker escalation) must STILL deliver back to @lead
  const sidB4Normal = 'sess-b4-normal'
  regAgent(sidB4Normal, [
    { id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '写单元测试' }] },
  ], { status: 'idle' })
  await stateMod.updateChiefConfig({ session: sidB4Normal, permissionMode: 'chief', confirmedChiefRisk: true })
  const dBeforeNormal = followups.length + steers.length
  const normalRes = await cmdOpsMod.handleLeadDirectRequestToChief(bus, {
    fromSession: sidB4Normal,
    subject: 'L3 常规协同',
    text: '可直接拍板并回报给我：单测应该写到哪？',
  })
  assert.equal(normalRes.ok, true)
  assert.equal(normalRes.actionTaken, 'executed_directly', 'B4 control: normal L3 request still returns executed_directly')
  assert.equal(followups.length + steers.length, dBeforeNormal + 1, 'B4 control: normal L3 reply still delivers to @lead')
  console.log('[B4 PASS] User-escalation chief.request pauses intervention without bouncing prompt back to @lead')

  // =========================================================================
  // B5: Pre-delivery freshness check skips stale / agent-running interventions
  // =========================================================================
  for (const mode of ['agent-running', 'stale-turn']) {
    const sidB5 = `sess-b5-${mode}`
    const b5Msgs = [
      { id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '把本地配置整理完并交验' }] },
      { id: 'a1', role: 'assistant', content: [{ type: 'text', text: '我先把现状理清楚。' }] },
    ]
    const agB5 = regAgent(sidB5, b5Msgs, { status: 'idle' })
    bus.runAction({ action: 'objective.set', session: sidB5, objective: '完成本地配置整理并交验', _fromInterventionSetup: true })
    await stateMod.updateChiefConfig({
      session: sidB5,
      permissionMode: 'chief',
      confirmedChiefRisk: true,
      tacticalModes: { intervention: true, maxInterventionTurns: 0 },
      confirmedInterventionRisk: true,
      confirmedUnlimitedTurns: true,
    })
    llmHandler = async () => {
      // Simulate lead starting next step/turn while background review LLM was in flight
      if (mode === 'agent-running') {
        agB5.status = 'running'
      } else {
        b5Msgs.push({ id: 'a2-newer', role: 'assistant', content: [{ type: 'text', text: '已自动开始后续修改并写完校验脚本。' }] })
      }
      return {
        ok: true,
        text: JSON.stringify({
          memoryChanges: [],
          boardOps: [],
          planAssessment: { stale: false, reason: '' },
          goalStatus: 'in_progress',
          goalMissing: '尚未验证',
          unmetMustDo: [],
          hazardStop: { triggered: false },
          shouldIntervene: true,
          interventionText: '请立刻执行本地验证！',
          suggestions: [],
        }),
      }
    }
    const fBeforeB5 = followups.length
    const resB5 = await reviewMod.runTurnReview(bus, { agent: agB5, sessionId: sidB5, turn: 1 })
    assert.equal(resB5.ok, true)
    assert.equal(resB5.intervened, false, `B5(${mode}): stale/running intervention must NOT deliver`)
    assert.equal(resB5.staleInterventionSkipped, mode, `B5(${mode}): must report exact stale skip reason`)
    assert.equal(followups.length, fBeforeB5, `B5(${mode}): 0 followup deliveries expected`)
    const wsB5 = stateMod.ensureWorkspace(stateMod.loadChiefState({ forceDisk: true }), sidB5)
    assert.equal(wsB5.runtimeGuard.interventionTurns, 0, `B5(${mode}): skipped stale intervention must roll back interventionTurns`)
  }
  console.log('[B5 PASS] Stale or mid-turn running interventions are cleanly discarded before delivery')
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
}
