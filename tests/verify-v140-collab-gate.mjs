#!/usr/bin/env node
/**
 * Self-contained v1.4.0 Part 2 Collaboration, Pre-Execute Defense, Dynamic Guard Walls,
 * and Visual Clarity Gate Suite (`verify-v140-collab-gate.mjs`).
 *
 * Covers C1-C8 in completely isolated temporary directories:
 *   C1. Lazy intervention (defer workspace writes/commands to live @lead) & explicit Chief override + [EXECUTION_REQUEST]
 *   C2. Blank new session first-turn explore -> graph.plan -> chief.request report strategy prompt
 *   C3. Opportunistic background digest refresh on chat replies (`chatTriggered: true`, 60s debounce)
 *   C4. Chief Inquiry Channel (`inquiries` -> `agent/pre-step` `[INQUIRY #id]` -> non-interrupting `inquiry.reply`)
 *   C5. Lead-to-Chief direct request (`chief.request` & `mail.send(target:'chief')`) across L0/L1/L2/L3 tiers
 *   C6. Whole-session `tools/pre-execute` physical hook defense across Lead & Subagents (`{ kind: 'deny' }`)
 *   C7. Dynamic persistent `guard-walls.json` (`global` / `workspace` / `paused`), Chief `wallProposals`, & anti-AI delete
 *   C8. Built frontend `client.js` visual clarity selectors/red shield icon & zero forbidden terminology check
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PKG = path.resolve(__dirname, '..')
const ROOT = path.resolve(PKG, '..')

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-chief-v140-c-home-'))
const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-chief-v140-c-ws-'))
const tmpWs = path.join(tmpBase, 'proj-alpha')
const tmpSiblingWs = path.join(tmpBase, 'proj-beta')
const tmpOutside = path.join(tmpBase, 'outside-vault')
fs.mkdirSync(path.join(tmpWs, 'src'), { recursive: true })
fs.mkdirSync(path.join(tmpSiblingWs, 'src'), { recursive: true })
fs.mkdirSync(tmpOutside, { recursive: true })
fs.writeFileSync(path.join(tmpWs, 'src', 'index.js'), 'export const v = 1\n', 'utf8')
fs.writeFileSync(path.join(tmpSiblingWs, 'src', 'app.js'), 'export const beta = 1\n', 'utf8')

process.env.DSH_HOME = tmpHome
process.env.DSH_CHIEF_DATA_DIR = path.join(tmpHome, 'notebook')
process.env.DSH_CHIEF_WALLS_FILE = path.join(tmpHome, 'chief', 'guard-walls.json')

try {
  const chiefMod = await import(pathToFileURL(path.join(PKG, 'chief.js')).href)
  const execMod = await import(pathToFileURL(path.join(PKG, 'chief-executor.js')).href)
  const stateMod = await import(pathToFileURL(path.join(PKG, 'chief-state.js')).href)
  const storeMod = await import(pathToFileURL(path.join(PKG, 'board-store.js')).href)
  const actionsMod = await import(pathToFileURL(path.join(PKG, 'board-actions.js')).href)
  const toolsMod = await import(pathToFileURL(path.join(PKG, 'model-tools.js')).href)
  const hooksMod = await import(pathToFileURL(path.join(PKG, 'runtime-hooks.js')).href)
  const subMod = await import(pathToFileURL(path.join(PKG, 'subagent-runtime.js')).href)
  const approvMod = await import(pathToFileURL(path.join(PKG, 'chief-approvals.js')).href)
  const reviewMod = await import(pathToFileURL(path.join(PKG, 'chief-review.js')).href)
  const guardWallsMod = await import(pathToFileURL(path.join(PKG, 'safety', 'guard-walls.js')).href)

  function makeTestDeps(boardDir, {
    callLlmOverride,
    agentsMap = new Map(),
    llmMock = null,
    cwdOverride = tmpWs,
  } = {}) {
    fs.mkdirSync(boardDir, { recursive: true })
    const fakeHostState = {
      activeRuntime: null,
      activeLlm: null,
      activeAutoContinue: null,
      autoSteeredTurns: new Set(),
      subagentRootMap: new Map(),
      subagentTreeCache: new Map(),
      modelWindowCache: new Map(),
      handoffSeq: 0,
    }
    const runtime = {
      get(name) {
        if (name === 'agents') return agentsMap
        if (name === 'llm') return llmMock
        return null
      },
    }
    const deps = {
      hostState: fakeHostState,
      resolveRootSessionId: sid => String(sid || '').trim() || 'global',
      getSessionCwd: (_rtOrSid, maybeSid) => {
        const sid = maybeSid || _rtOrSid
        if (sid === 'c7-beta') return tmpSiblingWs
        return cwdOverride
      },
      resolveWorkspaceIdForSession: () => 'ws-v140-collab',
      boardFile: () => path.join(boardDir, 'board.json'),
      boardFileFor: sid => path.join(boardDir, `${String(sid || 'global').replace(/[^\w-]/g, '')}.json`),
      sharedBoardFile: () => path.join(boardDir, 'board.json'),
      sessionName: () => 'test-v140-collab',
      getLlm: () => llmMock,
      getAttachments: () => null,
      runtime,
      callLlmOverride,
      appendBoardLog: () => {},
      agentOf: () => 'lead',
      fetchTeamTasks: () => [],
      listSubagents: () => [],
      refreshSubagentTree: async (_rt, rid) => [{ id: rid || 'global', name: 'lead', status: 'idle' }],
      resolveAgentIdentity: (_rt, sid) => ({
        self: String(sid || '').includes('sub') ? 'coder' : 'lead',
        isChild: String(sid || '').includes('sub'),
        rootId: String(sid || '').includes('sub') ? 'c6-lead' : (sid || 'global'),
      }),
      resolveEffectiveHandoff: () => ({ text: '', autoText: '' }),
      executeSubagentAction: async () => ({ ok: false }),
      isInternalProfileCwd: () => false,
      readPending: () => null,
      writePending: () => {},
      clearPending: () => {},
      readPendingDeploy: () => null,
      writePendingDeploy: () => {},
      clearPendingDeploy: () => {},
      resolveBoundRootSid: sid => String(sid || '').trim() || '',
      makeChiefDeps: () => deps,
      boardTool: () => ({ name: 'chief_board' }),
      boundariesTool: () => ({ name: 'chief_boundaries' }),
      handoffTool: () => ({ name: 'chief_handoff' }),
      memoryTool: () => ({ name: 'chief_memory' }),
      routeTable: () => [],
      getSubagentRoster: () => [],
      syncObjective: () => {},
      injectInto: () => {},
      linkedPeersForSession: () => [],
      noteSubagentStatus: () => {},
      collectDigestArchiveContext: () => '',
      probeSubagentSupport: () => ({ present: true, namedSubagentsSupported: true }),
      promptBoardFor: () => ({}),
      subagentRosterText: () => '',
      syncPlanFromTodos: () => {},
      syncSubagentToolCall: () => {},
    }
    Object.assign(deps, storeMod.createBoardStore(deps))
    Object.assign(deps, actionsMod.createBoardActions(deps))
    return deps
  }

  // -------------------------------------------------------------------------
  // C1. Lazy Intervention + Explicit Direct Override + [EXECUTION_REQUEST] Envelope
  // -------------------------------------------------------------------------
  const c1Sess = 'c1-lazy'
  chiefMod.updateChiefConfig({ sessionId: c1Sess, permissionMode: 'chief', confirmedChiefRisk: true })
  const c1Followups = []
  const c1Agents = new Map([
    [c1Sess, {
      id: c1Sess,
      name: 'lead',
      status: 'idle',
      followup: (env) => c1Followups.push(env),
      steer: (env) => c1Followups.push(env),
      inject: (env) => c1Followups.push(env),
    }],
  ])
  let c1Step = 0
  const c1Deps = makeTestDeps(path.join(tmpHome, 'boards-c1'), {
    agentsMap: c1Agents,
    callLlmOverride: async ({ prompt }) => {
      c1Step += 1
      if (c1Step === 1 && !prompt.includes('工具真实执行结果')) {
        return {
          ok: true,
          text: JSON.stringify({
            toolCalls: [{ tool: 'write_file', args: { path: 'src/lazy-blocked.js', content: 'bad\n' } }],
          }),
        }
      }
      return {
        ok: true,
        text: JSON.stringify({
          reply: '已将代码修改请求派发给主对话 @lead 执行。',
          relays: [{ target: 'lead', mode: 'followup', subject: '修改代码', text: '请由主对话完成 src/lazy-blocked.js 的创建。' }],
        }),
      }
    },
  })
  const c1LazyRes = await chiefMod.askOrCommandChief(c1Deps, {
    sessionId: c1Sess,
    text: '帮我新建 src/lazy-blocked.js 写入模块导出',
  })
  assert.equal(c1LazyRes.ok, true)
  assert.equal(fs.existsSync(path.join(tmpWs, 'src', 'lazy-blocked.js')), false, 'Lazy intervention must block Chief direct write when @lead is online')
  assert.ok(c1LazyRes.toolRecords.some(r => r && r.result && r.result.deferredByLazyIntervention === true), 'Tool record must indicate deferredByLazyIntervention')
  assert.ok(c1Followups.length >= 1, 'Relay must be delivered to @lead')
  const envText = JSON.stringify(c1Followups[0])
  assert.ok(envText.includes('[EXECUTION_REQUEST'), 'Relay must wrap in [EXECUTION_REQUEST] envelope')
  assert.ok(envText.includes('DSH 参谋长 (执行请求)'), 'Relay must identify sender as Chief execution request, never impersonating user')

  // Explicit user request to act directly bypasses lazy intervention
  let c1DirectStep = 0
  const c1DirectDeps = makeTestDeps(path.join(tmpHome, 'boards-c1'), {
    agentsMap: c1Agents,
    callLlmOverride: async ({ prompt }) => {
      c1DirectStep += 1
      if (c1DirectStep === 1 && !prompt.includes('工具真实执行结果')) {
        return {
          ok: true,
          text: JSON.stringify({
            toolCalls: [{ tool: 'write_file', args: { path: 'src/direct-ok.js', content: 'export const direct = true\n' } }],
          }),
        }
      }
      return { ok: true, text: JSON.stringify({ reply: '参谋长已亲自写完 src/direct-ok.js。' }) }
    },
  })
  const c1DirectRes = await chiefMod.askOrCommandChief(c1DirectDeps, {
    sessionId: c1Sess,
    text: '参谋长你自己亲自改一下，创建 src/direct-ok.js',
  })
  assert.equal(c1DirectRes.ok, true)
  assert.equal(fs.existsSync(path.join(tmpWs, 'src', 'direct-ok.js')), true, 'Explicit Chief command must execute write directly')
  console.log('✓ C1 passed: lazy intervention defers to @lead with [EXECUTION_REQUEST], explicit override executes directly')

  // -------------------------------------------------------------------------
  // C2. Blank New Session First-Turn Explore -> Plan Mode -> Chief Request
  // -------------------------------------------------------------------------
  const c2Sess = 'c2-blank'
  let capturedBlankSys = ''
  const c2Deps = makeTestDeps(path.join(tmpHome, 'boards-c2'), {
    callLlmOverride: async ({ system }) => {
      capturedBlankSys = system
      return {
        ok: true,
        text: JSON.stringify({
          reply: '空白新会话已申请授权向主对话下发只读勘探与计划立项指令。',
          elevationRequest: { targetMode: 'strategist', reason: '空白新对话首轮需授权向主对话派发勘探计划请求' },
        }),
      }
    },
  })
  const c2Res = await chiefMod.askOrCommandChief(c2Deps, { sessionId: c2Sess, text: '先帮我梳理这个项目的整体结构' })
  assert.equal(c2Res.ok, true)
  assert.ok(capturedBlankSys.includes('空白新上下文'), 'Blank session prompt must activate blank context section')
  assert.ok(capturedBlankSys.includes('只读勘探') && capturedBlankSys.includes('graph.plan') && capturedBlankSys.includes('chief.request'), 'Blank session must instruct Lead explore -> plan -> report')
  console.log('✓ C2 passed: blank new session activates explore -> graph.plan -> chief.request first-turn policy')

  // -------------------------------------------------------------------------
  // C3. Opportunistic Background Digest Refresh on Chat (60s debounce)
  // -------------------------------------------------------------------------
  const c3Sess = 'c3-digest'
  let c3SummaryCalls = 0
  const c3MockLlm = {
    listProviders: () => [{ id: 'mock', name: 'MockProvider' }],
    listModels: async () => [{ id: 'fast', name: 'MockFast' }],
  }
  const c3Deps = makeTestDeps(path.join(tmpHome, 'boards-c3'), {
    llmMock: c3MockLlm,
    callLlmOverride: async ({ system }) => {
      if (system.includes('摘要')) {
        c3SummaryCalls += 1
        return { ok: true, modelRef: 'mock/fast', text: `## 摘要\n- 【总目标】顺势刷新第 ${c3SummaryCalls} 次` }
      }
      return { ok: true, text: JSON.stringify({ reply: '收到，顺便帮你看一眼全局态势。' }) }
    },
  })
  c3Deps.runAction({ action: 'objective.set', session: c3Sess, objective: '验证聊天顺势更新摘要', by: 'user' })
  await chiefMod.getChiefView(c3Deps, c3Sess, { chatTriggered: true })
  const deadline = Date.now() + 1500
  while (c3SummaryCalls === 0 && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 25))
  }
  assert.equal(c3SummaryCalls, 1, 'chatTriggered must opportunistically refresh stale narrative once')
  c3Deps.runAction({ action: 'objective.set', session: c3Sess, objective: '60秒内二次变动', by: 'user' })
  await chiefMod.getChiefView(c3Deps, c3Sess, { chatTriggered: true })
  await new Promise(r => setTimeout(r, 60))
  assert.equal(c3SummaryCalls, 1, 'Subsequent chatTriggered within 60s cooldown must NOT re-burn tokens')

  // Background auto-maintenance exposes live `activeWork` during execution and clears cleanly in finally
  const c3RevSess = 'c3-active-work'
  let observedWorkInsideReview = null
  const c3RevDeps = makeTestDeps(path.join(tmpHome, 'boards-c3-rev'), {
    llmMock: c3MockLlm,
    callLlmOverride: async () => {
      observedWorkInsideReview = stateMod.getChiefActiveWork(c3RevSess)
      return { ok: true, text: JSON.stringify({ goalStatus: 'achieved', shouldIntervene: false }) }
    },
  })
  c3RevDeps.runAction({ action: 'objective.set', session: c3RevSess, objective: '验证后台自动维护特效状态暴露', by: 'user' })
  const c3MockAgent = {
    id: c3RevSess,
    status: 'idle',
    session: {
      deriveMessages: () => [
        { role: 'user', content: [{ type: 'text', text: '请核查当前阶段完成度' }] },
        { role: 'assistant', content: [{ type: 'text', text: '已完成全部阶段实现与单测。' }] },
      ],
    },
  }
  await reviewMod.runTurnReview(c3RevDeps, { agent: c3MockAgent, sessionId: c3RevSess, turn: 1, force: true })
  assert.ok(observedWorkInsideReview && observedWorkInsideReview.id && observedWorkInsideReview.label, 'Backend review must expose activeWork while running')
  assert.equal(stateMod.getChiefActiveWork(c3RevSess), null, 'Backend review must clear activeWork once finished')
  console.log('✓ C3 passed: opportunistic background digest refresh triggers on chat with 60s debounce & backend activeWork lifecycle')

  // -------------------------------------------------------------------------
  // C4. Chief Inquiry Channel ([INQUIRY #id] via pre-step & non-interrupting inquiry.reply)
  // -------------------------------------------------------------------------
  const c4Sess = 'c4-inquiry'
  chiefMod.updateChiefConfig({ sessionId: c4Sess, permissionMode: 'chief', confirmedChiefRisk: true })
  const c4Deps = makeTestDeps(path.join(tmpHome, 'boards-c4'), {
    callLlmOverride: async () => ({
      ok: true,
      text: JSON.stringify({
        reply: '我先向主对话发送一条高优问询确认端口细节。',
        inquiries: [{ target: 'lead', question: '请确认服务监听端口是 8080 还是 3000？', context: '部署参数核实' }],
      }),
    }),
  })
  const c4Ask = await chiefMod.askOrCommandChief(c4Deps, { sessionId: c4Sess, text: '核实一下服务监听端口' })
  assert.equal(c4Ask.ok, true)
  assert.ok(Array.isArray(c4Ask.inquiries) && c4Ask.inquiries.length === 1, 'Chief must enqueue structured inquiry')
  const inqId = c4Ask.inquiries[0].inquiryId

  const preStepEnv = await chiefMod.consumePreStepDelta(c4Deps, { id: c4Sess })
  assert.ok(preStepEnv, 'pre-step delta must return priority inquiry envelope')
  const preText = JSON.stringify(preStepEnv)
  assert.ok(preText.includes(`[INQUIRY #${inqId}`), 'pre-step must inject [INQUIRY #id]')
  assert.ok(preText.includes('inquiry.reply'), 'pre-step must instruct non-interrupting inquiry.reply')

  const modelToolsApi = toolsMod.createModelTools(c4Deps)
  const boardToolDef = modelToolsApi.boardTool(c4Deps.runtime)
  const inqReplyRes = await boardToolDef.execute({
    action: 'inquiry.reply',
    session: c4Sess,
    inquiryId: inqId,
    text: '已核对 server.js，实际监听端口是 8080。',
    by: 'lead',
  })
  assert.equal(inqReplyRes.ok, true)
  assert.equal(inqReplyRes.continueOwnWork, true)
  assert.equal(inqReplyRes.inquiryAnswered.status, 'answered')
  assert.ok(inqReplyRes.inquiryAnswered.answer.includes('8080'))
  const c4StateAfter = stateMod.loadChiefState({ forceDisk: true }).workspaces[c4Sess]
  assert.ok(c4StateAfter.chat.some(m => m && m.kind === 'receipt' && m.text.includes('优先问询回执')), 'Receipt must persist to chief chat')
  assert.ok(c4StateAfter.taskLedger.some(t => t && t.kind === 'inquiry' && t.status === 'completed'), 'Inquiry TaskLedger entry must resolve completed')
  console.log('✓ C4 passed: Chief Inquiry Channel injects via pre-step and receives non-interrupting reply')

  // -------------------------------------------------------------------------
  // C5. Lead-to-Chief Direct Request across L0 / L1 / L2 / L3 Tiers
  // -------------------------------------------------------------------------
  const c5Sess = 'c5-lead-req'
  const c5Followups = []
  const c5Agents = new Map([
    [c5Sess, { id: c5Sess, status: 'idle', followup: env => c5Followups.push(env), steer: env => c5Followups.push(env) }],
  ])
  const c5Deps = makeTestDeps(path.join(tmpHome, 'boards-c5'), {
    agentsMap: c5Agents,
    callLlmOverride: async () => ({ ok: true, text: JSON.stringify({ reply: 'L3 参谋长已直接协同处置完毕，请按计划继续。' }) }),
  })
  const c5BoardTool = toolsMod.createModelTools(c5Deps).boardTool(c5Deps.runtime)

  // L0 advisor
  chiefMod.updateChiefConfig({ sessionId: c5Sess, permissionMode: 'advisor' })
  const l0Req = await c5BoardTool.execute({ action: 'chief.request', session: c5Sess, subject: 'L0求助', text: '帮我分析是否需提权改文件', by: 'lead' })
  assert.equal(l0Req.ok, true)
  assert.equal(l0Req.chiefRequest.actionTaken, 'suggested_or_elevation_requested')
  assert.ok(stateMod.loadChiefState({ forceDisk: true }).workspaces[c5Sess].pendingElevation, 'L0 request must offer strategist elevation')

  // L1 assistant via mail.send(target:'chief')
  chiefMod.updateChiefConfig({ sessionId: c5Sess, permissionMode: 'assistant' })
  const l1Deliv = await chiefMod.deliverCrossMessage(c5Deps, { fromSession: c5Sess, target: 'chief', subject: 'L1求助', text: '同步一下进度' })
  assert.equal(l1Deliv.ok, true)
  assert.equal(l1Deliv.actionTaken, 'suggested_or_elevation_requested')

  // L2 strategist
  chiefMod.updateChiefConfig({ sessionId: c5Sess, permissionMode: 'strategist' })
  const l2Req = await c5BoardTool.execute({ action: 'chief.request', session: c5Sess, subject: 'L2协同', text: '请向子代理补充测试约束', by: 'lead' })
  assert.equal(l2Req.ok, true)
  assert.equal(l2Req.chiefRequest.actionTaken, 'queued_for_approval')
  assert.ok(stateMod.loadChiefState({ forceDisk: true }).workspaces[c5Sess].pendingApprovals.length >= 1, 'L2 request must queue user approval')

  // L3 chief
  chiefMod.updateChiefConfig({ sessionId: c5Sess, permissionMode: 'chief', confirmedChiefRisk: true })
  const l3Req = await c5BoardTool.execute({ action: 'chief.request', session: c5Sess, subject: 'L3批复', text: '可直接拍板并回报给我', by: 'lead' })
  assert.equal(l3Req.ok, true)
  assert.equal(l3Req.chiefRequest.actionTaken, 'executed_directly')
  assert.ok(c5Followups.length >= 1, 'L3 execution must deliver Chief reply back to @lead')
  console.log('✓ C5 passed: Lead-to-Chief request enforces L0/L1/L2/L3 tiered response behavior')

  // -------------------------------------------------------------------------
  // C6. Whole-Session `tools/pre-execute` Physical Hook Defense (Lead & Subagents)
  // -------------------------------------------------------------------------
  const c6Deps = {
    ...makeTestDeps(path.join(tmpHome, 'boards-c6')),
    resolveRootSessionId: sid => (String(sid || '').includes('sub') ? 'c6-lead' : (String(sid || '').trim() || 'global')),
  }
  const preExecHandlers = []
  const mockCordisCtx = {
    get: name => (name === 'agents' ? new Map() : null),
    on: () => () => {},
    effect: fn => fn(),
    inject: (names, cb) => {
      if (Array.isArray(names) && names.includes('tools')) {
        cb({
          effect: fn => fn(),
          tools: { register: () => () => {} },
          on: (evt, fn) => {
            if (evt === 'tools/pre-execute') preExecHandlers.push(fn)
            return () => {}
          },
        })
      }
    },
  }
  hooksMod.createRuntimeHooks(c6Deps).apply(mockCordisCtx)
  assert.equal(preExecHandlers.length, 1, 'tools/pre-execute hook must be registered')
  const preExecHook = preExecHandlers[0]

  // Unactivated normal session must bypass Chief pre-execute defense completely (zero intrusion)
  const c6UninitializedWriteAllow = await preExecHook(
    { name: 'write_file', arguments: { path: path.join(tmpOutside, 'uninit.txt'), content: 'ok' }, agent: { id: 'c6-uninitialized' } },
    async () => ({ kind: 'allow' }),
  )
  assert.equal(c6UninitializedWriteAllow.kind, 'allow', 'Unactivated session must bypass tools/pre-execute outside-workspace write blocking')
  const c6UninitializedShellAllow = await preExecHook(
    { name: 'bash', arguments: { command: 'head -n 3 /etc/hosts', cwd: tmpOutside }, agent: { id: 'c6-uninitialized' } },
    async () => ({ kind: 'allow' }),
  )
  assert.equal(c6UninitializedShellAllow.kind, 'allow', 'Unactivated session must bypass tools/pre-execute outside-workspace shell blocking')

  stateMod.updateChiefConfig({ sessionId: 'c6-lead', sessionEnabled: true, byUser: true, _fromUiPanel: true })

  const c6DenyCmd = await preExecHook(
    { name: 'run_command', arguments: { command: 'rm -rf /' }, agent: { id: 'c6-lead' } },
    async () => ({ kind: 'allow' }),
  )
  assert.equal(c6DenyCmd.kind, 'deny', 'tools/pre-execute must hard-deny destructive shell command on Lead')

  const c6DenySubagentEscape = await preExecHook(
    { name: 'write_file', arguments: { path: path.join(tmpOutside, 'leak.txt'), content: 'x' }, agent: { id: 'c6-sub-worker' } },
    async () => ({ kind: 'allow' }),
  )
  assert.equal(c6DenySubagentEscape.kind, 'deny', 'tools/pre-execute must hard-deny workspace escape on Subagents')

  const c6AllowSafe = await preExecHook(
    { name: 'read_file', arguments: { path: path.join(tmpWs, 'src', 'index.js') }, agent: { id: 'c6-lead' } },
    async () => ({ kind: 'allow' }),
  )
  assert.equal(c6AllowSafe.kind, 'allow', 'Safe in-workspace read must proceed via next()')

  // DSH 0.2.2-rc.5 native tool compatibility: write/edit (`file_path`), `apply_patch` (`input`), `str_replace_editor` (`view` vs `str_replace`), and native `ask` approval
  const c6DenyNativeWrite = await preExecHook(
    { name: 'write', arguments: { file_path: path.join(tmpOutside, 'rc5-escape.txt'), content: 'bad' }, agent: { id: 'c6-lead' } },
    async () => ({ kind: 'allow' }),
  )
  assert.equal(c6DenyNativeWrite.kind, 'deny', 'DSH rc5 `write` with out-of-workspace file_path must be blocked')

  const c6DenyPatch = await preExecHook(
    {
      name: 'apply_patch',
      arguments: { input: `*** Begin Patch\n*** Update File: ${path.join(tmpOutside, 'leak.js')}\n@@\n-a\n+b\n*** End Patch` },
      agent: { id: 'c6-lead' },
    },
    async () => ({ kind: 'allow' }),
  )
  assert.equal(c6DenyPatch.kind, 'deny', 'DSH rc5 `apply_patch` touching outside path must be parsed and blocked')

  execMod.mutateGuardWalls({
    op: 'save',
    wall: { id: 'c6-wo-wall', title: 'rc5只读放行测试墙', ruleType: 'forbid_path', patterns: ['secret-dir'], writeOnly: true, scope: 'global' },
    cwd: tmpWs,
    callerOrigin: 'human_ui',
    humanConfirmToken: execMod.HUMAN_BOUNDS_CONFIRM_TOKEN,
  })
  const c6AllowStrView = await preExecHook(
    { name: 'str_replace_editor', arguments: { command: 'view', path: path.join(tmpWs, 'secret-dir', 'a.js') }, agent: { id: 'c6-lead' } },
    async () => ({ kind: 'allow' }),
  )
  assert.equal(c6AllowStrView.kind, 'allow', 'str_replace_editor command=view must be treated as read under writeOnly wall')
  const c6DenyStrReplace = await preExecHook(
    { name: 'str_replace_editor', arguments: { command: 'str_replace', path: path.join(tmpWs, 'secret-dir', 'a.js'), old_str: 'x', new_str: 'y' }, agent: { id: 'c6-lead' } },
    async () => ({ kind: 'allow' }),
  )
  assert.equal(c6DenyStrReplace.kind, 'deny', 'str_replace_editor command=str_replace must be blocked under writeOnly wall')

  execMod.mutateGuardWalls({
    op: 'save',
    wall: { id: 'c6-ask-wall', title: 'rc5审批命令墙', ruleType: 'require_approval_cmd', patterns: ['npm\\s+dist-tag'], scope: 'global' },
    cwd: tmpWs,
    callerOrigin: 'human_ui',
    humanConfirmToken: execMod.HUMAN_BOUNDS_CONFIRM_TOKEN,
  })
  const c6AskNative = await preExecHook(
    { name: 'pwsh', arguments: { command: 'npm dist-tag ls pkg' }, agent: { id: 'c6-lead' } },
    async () => ({ kind: 'allow' }),
  )
  assert.equal(c6AskNative.kind, 'ask', 'require_approval_cmd wall must return DSH rc5 native `{ kind: "ask" }` decision on tools/pre-execute')
  assert.ok(c6AskNative.displayReason, 'native ask decision must carry displayReason')
  execMod.mutateGuardWalls({ op: 'remove', wallId: 'c6-wo-wall', cwd: tmpWs, callerOrigin: 'human_ui', humanConfirmToken: execMod.HUMAN_BOUNDS_CONFIRM_TOKEN })
  execMod.mutateGuardWalls({ op: 'remove', wallId: 'c6-ask-wall', cwd: tmpWs, callerOrigin: 'human_ui', humanConfirmToken: execMod.HUMAN_BOUNDS_CONFIRM_TOKEN })

  console.log('✓ C6 passed: tools/pre-execute physically blocks dangerous Lead & Subagent calls, supports DSH 0.2.2-rc.5 tools/ask gate, and allows safe reads')

  // -------------------------------------------------------------------------
  // C7. Dynamic Persistent Guard Walls (`global` / `workspace` / `paused`) + Chief Craft + Anti-AI Remove
  // -------------------------------------------------------------------------
  const protectedOtherRepo = path.join(tmpBase, 'DSHGuard', 'main.js')
  const aiSaveAttempt = c7RunWallAction('model_tool', 'wall.save', {
    wall: { title: '非法AI篡改', ruleType: 'forbid_cmd', patterns: ['echo'] },
  })
  function c7RunWallAction(origin, action, extra) {
    return c6Deps.runAction({ action, session: 'c7-sess', _callerOrigin: origin, ...extra })
  }
  assert.equal(aiSaveAttempt.ok, false, 'AI model tool must NEVER save/remove guard walls without human confirmation token')

  const saveGlobalRes = execMod.mutateGuardWalls({
    op: 'save',
    wall: {
      id: 'wall-protect-dshguard',
      title: '保护核心仓库 DSHGuard',
      ruleType: 'forbid_path',
      patterns: ['DSHGuard'],
      scope: 'global',
      reason: '禁止任何会话越界修改或删除 DSHGuard',
    },
    cwd: tmpWs,
    callerOrigin: 'human_ui',
    humanConfirmToken: execMod.HUMAN_BOUNDS_CONFIRM_TOKEN,
  })
  assert.equal(saveGlobalRes.ok, true)

  const gHitAlpha = guardWallsMod.evaluatePreExecuteDefense({
    tool: 'write_file',
    args: { path: protectedOtherRepo },
    cwd: tmpWs,
    board: {},
  })
  const gHitBeta = guardWallsMod.evaluatePreExecuteDefense({
    tool: 'edit_file',
    args: { path: protectedOtherRepo },
    cwd: tmpSiblingWs,
    board: {},
  })
  assert.equal(gHitAlpha.decision, 'deny', 'Global guard wall must apply in project A')
  assert.equal(gHitBeta.decision, 'deny', 'Global guard wall must travel dynamically to project B')

  // Switch wall to workspace-only (scoped to tmpWs) -> blocks in tmpWs, allows in tmpSiblingWs
  const wsSwitch = execMod.mutateGuardWalls({
    op: 'set_scope',
    wallId: 'wall-protect-dshguard',
    scope: 'workspace',
    cwd: tmpWs,
    callerOrigin: 'human_ui',
    humanConfirmToken: execMod.HUMAN_BOUNDS_CONFIRM_TOKEN,
  })
  assert.equal(wsSwitch.ok, true)
  const localForbid = execMod.mutateGuardWalls({
    op: 'save',
    wall: {
      id: 'wall-local-cmd',
      title: '禁止本项目跑 rm -rf build',
      ruleType: 'forbid_cmd',
      patterns: ['npm\\s+publish'],
      scope: 'workspace',
    },
    cwd: tmpWs,
    callerOrigin: 'human_ui',
    humanConfirmToken: execMod.HUMAN_BOUNDS_CONFIRM_TOKEN,
  })
  assert.equal(localForbid.ok, true)
  assert.equal(
    guardWallsMod.evaluatePreExecuteDefense({ tool: 'run_command', args: { command: 'npm publish' }, cwd: tmpWs, board: {} }).decision,
    'deny',
    'Workspace wall must block in owning project',
  )
  assert.equal(
    guardWallsMod.evaluatePreExecuteDefense({ tool: 'run_command', args: { command: 'npm publish' }, cwd: tmpSiblingWs, board: {} }).decision,
    'allow',
    'Workspace wall must NOT leak to unrelated project',
  )

  // Pause wall -> allowed even in owning project
  execMod.mutateGuardWalls({
    op: 'set_scope',
    wallId: 'wall-local-cmd',
    scope: 'paused',
    cwd: tmpWs,
    callerOrigin: 'human_ui',
    humanConfirmToken: execMod.HUMAN_BOUNDS_CONFIRM_TOKEN,
  })
  assert.equal(
    guardWallsMod.evaluatePreExecuteDefense({ tool: 'run_command', args: { command: 'npm publish' }, cwd: tmpWs, board: {} }).decision,
    'allow',
    'Paused wall must temporarily suspend enforcement',
  )

  // Chief crafts wallProposals -> queued as pending guard_wall suggestion -> batch approved & locked
  const c7Sess = 'c7-craft'
  chiefMod.updateChiefConfig({ sessionId: c7Sess, permissionMode: 'assistant' })
  const c7Deps = makeTestDeps(path.join(tmpHome, 'boards-c7'), {
    callLlmOverride: async () => ({
      ok: true,
      text: JSON.stringify({
        reply: '已为你手搓一条防强推物理墙提案，请在上方确认落锁。',
        wallProposals: [{
          title: '禁止强推主分支',
          ruleType: 'forbid_cmd',
          patterns: ['git\\s+push\\s+.*--force'],
          scope: 'global',
          reason: '保护远程仓库主历史不被覆盖',
        }],
      }),
    }),
  })
  const c7CraftRes = await chiefMod.askOrCommandChief(c7Deps, { sessionId: c7Sess, text: '帮我手搓一堵物理墙禁止强制 push' })
  assert.equal(c7CraftRes.ok, true)
  assert.equal(c7CraftRes.wallProposals.length, 1)
  assert.equal(c7CraftRes.wallProposals[0].kind, 'guard_wall')

  const c7BatchRes = await approvMod.executeBatchSuggestions(c7Deps, { sessionId: c7Sess })
  assert.equal(c7BatchRes.ok, true)
  assert.equal(c7BatchRes.executedCount, 1)
  const wallsNow = execMod.listGuardWalls({ cwd: tmpWs })
  assert.ok(wallsNow.some(w => w.title === '禁止强推主分支' && w.source === 'chief_crafted'), 'Approved wallProposal must persist into guard-walls.json')

  const aiRemoveAttempt = c7RunWallAction('model_tool', 'wall.remove', { wallId: 'wall-protect-dshguard' })
  assert.equal(aiRemoveAttempt.ok, false, 'AI model tool must be blocked from removing guard walls')

  // Single-backslash regex JSON repair (`git\s+...`, `.\env`) in extractJsonObject
  const rawEscapedJson = '{"reply":"ok","wallProposals":[{"title":"防单反斜杠漏解析","ruleType":"forbid_cmd","patterns":["git\\s+(checkout|reset)"],"scope":"global"}],"boundProposals":[{"field":"forbidden","item":"禁止直接修改 .\\env 文件"}]}'.replace(/\\\\/g, '\\')
  const repairedParsed = stateMod.extractJsonObject(rawEscapedJson)
  assert.ok(repairedParsed && Array.isArray(repairedParsed.wallProposals) && repairedParsed.wallProposals.length === 1, 'extractJsonObject must repair invalid bare backslashes in regex/paths')
  assert.equal(repairedParsed.boundProposals.length, 1)

  // ConciseBrief Markdown fallback extracts boundProposals when LLM returns bare Markdown
  const c7FallbackSess = 'c7-fallback-bounds'
  chiefMod.updateChiefConfig({ sessionId: c7FallbackSess, permissionMode: 'strategist', tacticalModes: { conciseBrief: true } })
  const c7FbDeps = makeTestDeps(path.join(tmpHome, 'boards-c7-fb'), {
    callLlmOverride: async () => ({
      ok: true,
      text: [
        '## 极简目标战报',
        '- 【🎯 总目标】保护源码',
        '- 【💡 参谋长建议】请批示下方两条边界',
        '- 【提案1·红线】禁止未经确认强改 pkg 源码（📌全局）',
        '- 【提案2·必做】改动后必须跑齐 6 道门禁',
      ].join('\n'),
    }),
  })
  const c7FbRes = await chiefMod.askOrCommandChief(c7FbDeps, {
    sessionId: c7FallbackSess,
    text: '提炼新边界并向我发起 boundProposals',
  })
  assert.equal(c7FbRes.ok, true)
  assert.equal(c7FbRes.boundProposals.length, 2, 'Markdown fallback must extract proposed bounds instead of dropping them')

  // Batch execute 2 guard_wall suggestions produces ONLY 1 unified summary receipt card (never 3 cards)
  const c7BatchSess = 'c7-batch-dedup'
  chiefMod.updateChiefConfig({ sessionId: c7BatchSess, permissionMode: 'assistant' })
  const c7BatchDeps = makeTestDeps(path.join(tmpHome, 'boards-c7-batch'), {
    callLlmOverride: async () => ({
      ok: true,
      text: JSON.stringify({
        reply: '已准备两堵墙供确认。',
        wallProposals: [
          { title: '批量墙A', ruleType: 'forbid_cmd', patterns: ['danger_cmd_a'], scope: 'global' },
          { title: '批量墙B', ruleType: 'forbid_path', patterns: ['danger_dir_b'], scope: 'global' },
        ],
      }),
    }),
  })
  await chiefMod.askOrCommandChief(c7BatchDeps, { sessionId: c7BatchSess, text: '手搓两堵物理墙' })
  const chatBeforeBatch = stateMod.loadChiefState({ forceDisk: true }).workspaces[c7BatchSess].chat.length
  const batchDedupRes = await approvMod.executeBatchSuggestions(c7BatchDeps, { sessionId: c7BatchSess })
  assert.equal(batchDedupRes.executedCount, 2)
  const chatAfterBatch = stateMod.loadChiefState({ forceDisk: true }).workspaces[c7BatchSess].chat.length
  assert.equal(chatAfterBatch - chatBeforeBatch, 1, 'Batch execution must write only 1 unified summary receipt card')

  // Guard Walls manual merge, cross-type forbid, autoGroup same-type merge & anti-AI tampering
  const c7MergeHomeWalls = path.join(tmpHome, 'guard-walls-merge-test.json')
  const prevWallsEnv = process.env.DSH_CHIEF_WALLS_FILE
  process.env.DSH_CHIEF_WALLS_FILE = c7MergeHomeWalls
  try {
    const seedSpecs = [
      { id: 'wm-p1', title: 'pkg目录禁写', ruleType: 'forbid_path', patterns: ['pkg', 'WorkShop/pkg'], scope: 'global' },
      { id: 'wm-p2', title: '凭据路径禁写', ruleType: 'forbid_path', patterns: ['.npmrc', '.env', '*.pem'], scope: 'global' },
      { id: 'wm-c1', title: '高危git禁跑', ruleType: 'forbid_cmd', patterns: ['git\\s+(checkout|reset)'], scope: 'global' },
      { id: 'wm-a1', title: 'npm发布审批', ruleType: 'require_approval_cmd', patterns: ['npm publish', 'npm unpublish'], scope: 'global' },
      { id: 'wm-a2', title: 'GitHub工作流审批', ruleType: 'require_approval_cmd', patterns: ['gh release delete', 'gh auth token'], scope: 'global' },
      { id: 'wm-a3', title: '工作流写入审批', ruleType: 'require_approval_cmd', patterns: ['\\.github/workflows'], scope: 'global' },
    ]
    for (const w of seedSpecs) {
      const sr = execMod.mutateGuardWalls({
        op: 'save',
        wall: w,
        cwd: tmpWs,
        callerOrigin: 'human_ui',
        humanConfirmToken: execMod.HUMAN_BOUNDS_CONFIRM_TOKEN,
      })
      assert.equal(sr.ok, true)
    }

    const aiMergeAttempt = c7RunWallAction('model_tool', 'wall.merge', { autoGroup: true })
    assert.equal(aiMergeAttempt.ok, false, 'AI model tool must NEVER invoke wall.merge without human token')

    const crossTypeFail = execMod.mutateGuardWalls({
      op: 'merge',
      wallIds: ['wm-p1', 'wm-a1'],
      cwd: tmpWs,
      callerOrigin: 'human_ui',
      humanConfirmToken: execMod.HUMAN_BOUNDS_CONFIRM_TOKEN,
    })
    assert.equal(crossTypeFail.ok, false, 'Manual merge across different ruleTypes MUST be rejected')
    assert.equal(crossTypeFail.code, 'CROSS_TYPE_MERGE_FORBIDDEN')
    assert.equal(execMod.listGuardWalls({ cwd: tmpWs }).length, 6, 'Failed cross-type merge must keep original 6 walls intact')

    const sameTypeOk = execMod.mutateGuardWalls({
      op: 'merge',
      wallIds: ['wm-p1', 'wm-p2'],
      cwd: tmpWs,
      callerOrigin: 'human_ui',
      humanConfirmToken: execMod.HUMAN_BOUNDS_CONFIRM_TOKEN,
    })
    assert.equal(sameTypeOk.ok, true, 'Manual merge of two forbid_path walls must succeed')
    assert.equal(sameTypeOk.mergedCount, 2)
    assert.equal(sameTypeOk.createdCount, 1)
    assert.equal(sameTypeOk.wall.ruleType, 'forbid_path')
    assert.deepEqual(sameTypeOk.wall.patterns, ['pkg', 'WorkShop/pkg', '.npmrc', '.env', '*.pem'])
    assert.equal(execMod.listGuardWalls({ cwd: tmpWs }).length, 5)

    const autoMergeOk = execMod.mutateGuardWalls({
      op: 'merge',
      autoGroup: true,
      cwd: tmpWs,
      callerOrigin: 'human_ui',
      humanConfirmToken: execMod.HUMAN_BOUNDS_CONFIRM_TOKEN,
    })
    assert.equal(autoMergeOk.ok, true, 'One-click autoGroup merge must succeed on 3 require_approval_cmd walls')
    assert.equal(autoMergeOk.mergedCount, 3)
    assert.equal(autoMergeOk.createdCount, 1)
    const afterAuto = execMod.listGuardWalls({ cwd: tmpWs })
    assert.equal(afterAuto.length, 3, '6 walls across 3 types must cleanly collapse into 3 single-type walls')
    assert.ok(afterAuto.some(w => w.ruleType === 'forbid_path' && w.patterns.includes('.npmrc')))
    assert.ok(afterAuto.some(w => w.ruleType === 'forbid_cmd' && w.patterns.length === 1))
    assert.ok(afterAuto.some(w => w.ruleType === 'require_approval_cmd' && w.patterns.length === 5))
  } finally {
    if (prevWallsEnv === undefined) delete process.env.DSH_CHIEF_WALLS_FILE
    else process.env.DSH_CHIEF_WALLS_FILE = prevWallsEnv
  }

  console.log('✓ C7 passed: dynamic Guard Walls support global/workspace/paused lifecycle, Chief crafting, same-type merge, cross-type block, JSON backslash repair, fallback bounds, batch dedup & anti-AI tampering')

  // -------------------------------------------------------------------------
  // C8. Built Client Visual Selectors & Clean Terminology Gate
  // -------------------------------------------------------------------------
  const clientJs = fs.readFileSync(path.join(PKG, 'client.js'), 'utf8')
  for (const needle of [
    'shieldSentinel',
    'dnb-qa-turn-box',
    'dnb-turn-question',
    'dnb-wall-actions-row',
    'groupChatHistoryTurnsNewestFirst',
    'dnb-wall-box',
    'data-tone',
    '物理驻墙',
    'wall.merge',
    'CROSS_TYPE_MERGE_FORBIDDEN',
    'dnb-chief-fx-stage',
    'dnb-wave-char',
    'qaCollapsedTurnIds',
    '一键收起',
    '一键合并',
    '管理边界',
    'dnb-fx-beam-spin',
    'syncBackendActiveWork',
    'activeWork',
  ]) {
    assert.ok(clientJs.includes(needle), `Built pkg/client.js must contain ${needle}`)
  }

  const forbiddenTermRe = new RegExp([String.fromCharCode(99, 99), 'safety', 'net'].join('-?'), 'i')
  const filesToAudit = []
  const scanDir = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        if (['node_modules', '.git'].includes(ent.name)) continue
        scanDir(full)
      } else if (ent.isFile() && /\.(?:m?js|md|json)$/i.test(ent.name)) {
        filesToAudit.push(full)
      }
    }
  }
  scanDir(PKG)
  const planDoc = path.join(ROOT, 'PLAN-v1.3-v1.6.md')
  if (fs.existsSync(planDoc)) filesToAudit.push(planDoc)
  for (const f of filesToAudit) {
    const content = fs.readFileSync(f, 'utf8')
    assert.equal(forbiddenTermRe.test(content), false, `Forbidden third-party reference found in ${path.relative(ROOT, f)}`)
  }
  console.log('✓ C8 passed: client UI visual clarity assets compiled & zero forbidden third-party terms across repo')

  console.log('\nALL 8 V1.4.0 COLLABORATION & DEFENSE GATE CHECKS (C1-C8) PASSED!')
} finally {
  fs.rmSync(tmpHome, { recursive: true, force: true })
  fs.rmSync(tmpBase, { recursive: true, force: true })
}
