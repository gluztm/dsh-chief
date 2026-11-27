#!/usr/bin/env node
/**
 * verify-v180-brain-collab-gate.mjs
 *
 * Self-contained v1.8.0 regression gate covering in isolated temp directories:
 *   - B1: Version alignment (1.8.0), files[] (github-star.js present, private-brain.js removed), client markers
 *         (5 skins, EffortFanGauge, TaskBeamFlowView, GithubStarButton, Collaboration 2.0, PrivateBrainPage removed)
 *   - B1.5: TaskBeamFlowView (Route B serpentine beam canvas) render smoke
 *   - B6 & B7: Collaboration 2.0 (Gemini CLI local binary probe, redacted live stream, 2-hop chain relay & depth=1 guard)
 *   - B10: Global Custom Chief Naming E2E (/chief/config + /snapshot + /chief/view, secret hard-block & 0-byte @lead isolation)
 *   - B12: Option 1 Real GitHub Star Sync (web fallback, gh CLI 404 -> PUT -> already_starred -> DELETE cycle & zero plain-session intrusion)
 *   - B13: Collaboration Routing & Anti-Self-Steer Regression Gate (no phantom subagent rootId binding, Test x 2 disambiguation,
 *          Path A native subagent send, Path B cross-root/self-bounce rejection + readBy invariant + Chief->lead keepalive)
 *   - B14: Collab Friction & Guard Regression Gate (auto-continue silent wait / child no-wake, idle-guard external wait & waitPoll spin,
 *          cross-session duplicate child disambiguation + targetKind receipts, runtime-hooks activeAutoContinue guards)
 *   - B15: Peer Drop Recovery & Sync Gate (mid-turn steer resets turnOutput/tools, board-all-done exempts unanswered peer mail & fresh directive,
 *          onRecoveryBlocked -> syncPeerDropToWaitingSenders idempotent alert/mailbox + directory interrupted state + turn/start clear)
 */

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PKG = path.resolve(__dirname, '..')

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-v180-gate-'))
const dshHome = path.join(tmpRoot, 'dsh-home')
const chiefDataDir = path.join(tmpRoot, 'chief-data')
const wsDirA = path.join(tmpRoot, 'workspace-alpha')
const fakeBinsDir = path.join(tmpRoot, 'fake-bins')
fs.mkdirSync(dshHome, { recursive: true })
fs.mkdirSync(chiefDataDir, { recursive: true })
fs.mkdirSync(wsDirA, { recursive: true })
fs.mkdirSync(fakeBinsDir, { recursive: true })

process.env.DSH_HOME = dshHome
process.env.DSH_CHIEF_DATA_DIR = chiefDataDir
process.env.DSH_CHIEF_WALLS_FILE = path.join(tmpRoot, 'walls.json')

function modUrl(rel) {
  return pathToFileURL(path.join(PKG, rel)).href
}

function makeFakeStream() {
  const ee = new EventEmitter()
  return {
    on: (ev, fn) => ee.on(ev, fn),
    pushChunk: (s) => ee.emit('data', Buffer.from(String(s), 'utf8')),
  }
}

try {
  // =========================================================================
  // B1: Version alignment (1.8.0), files[] & v1.8.0 client bundle markers
  // =========================================================================
  const pkgJson = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8'))
  const schemaMod = await import(modUrl('board-schema.js'))
  const constMod = await import(modUrl('src/client/constants.js'))
  assert.ok(/^(?:1\.(?:[89]|[1-9]\d)|[2-9]\.\d+)\.\d+/.test(pkgJson.version), `B1 package.json must be >= 1.8.0, got ${pkgJson.version}`)
  assert.equal(schemaMod.BACKEND_BUILD, pkgJson.version, 'B1 board-schema BACKEND_BUILD must align with package.json')
  assert.equal(constMod.EXPECTED_BACKEND_BUILD, pkgJson.version, 'B1 constants EXPECTED_BACKEND_BUILD must align with package.json')
  assert.ok(Array.isArray(pkgJson.files) && pkgJson.files.includes('github-star.js'), 'B1 package.json files must include github-star.js')
  assert.equal(pkgJson.files.includes('private-brain.js'), false, 'B1 package.json files must NOT include private-brain.js')
  assert.equal(fs.existsSync(path.join(PKG, 'private-brain.js')), false, 'B1 private-brain.js must be removed')
  assert.equal(fs.existsSync(path.join(PKG, 'src', 'client', 'tabs', 'brain.js')), false, 'B1 src/client/tabs/brain.js must be removed')
  assert.equal(constMod.DEFAULT_UI_SKIN, 'glass', 'B1 default UI skin must be glass (Frosted Mist)')
  assert.ok(Array.isArray(constMod.UI_SKIN_OPTIONS) && constMod.UI_SKIN_OPTIONS.length >= 5, 'B1 UI_SKIN_OPTIONS must include 5 built-in skins')

  const clientBundle = fs.readFileSync(path.join(PKG, 'client.js'), 'utf8')
  for (const needle of [
    'GithubStarButton',
    'dnb-star-btn',
    'dnb-star-pop',
    'dnb-star-count',
    'github.star_toggle',
    'https://github.com/gluztm/dsh-chief',
    'chiefDisplayName',
    "provider === 'gemini'",
    'dnb-stream-box',
    'dnb-chain-row',
    'GUARD_WALL_PRESET_PACKS',
    'dnb-tpl-drawer',
    'dnb-skin-card',
    'dnb-skin-pop',
    'data-dnb-skin',
    'dsh-chief:ui-skin',
    'EffortFanGauge',
    'dnb-fan-stage',
    'dnb-fan-hub',
    'dnb-safety-banner',
    'TaskBeamFlowView',
    'dnb-bento-hero',
    'dnb-bento-ring',
    'dnb-beam-pipeline',
    'dnb-beam-node',
    'dnb-beam-edge',
    'dnb-beam-drawer',
    'dnb-beam-agent-node',
    'dnb-beam-dispatch',
    'dnb-beam-return',
    'dnb-live-cursor-bar',
  ]) {
    assert.ok(clientBundle.includes(needle), `B1 client.js missing required v1.8.0 marker: ${needle}`)
  }
  for (const forbidden of [
    'PrivateBrainPage',
    'dnb-brain-page',
    'dnb-brain-graph-svg',
    'brain.recall_test',
    'brain.resolve_conflict',
    'brain.export_markdown',
  ]) {
    assert.equal(clientBundle.includes(forbidden), false, `B1 client.js must NOT include stripped Private Brain symbol: ${forbidden}`)
  }
  console.log(`[B1 PASS] Version ${pkgJson.version} aligned, Private Brain stripped & all retained v1.8.0 markers verified`)

  // =========================================================================
  // B1.5: TaskBeamFlowView (Route B Serpentine Beam Canvas) Render Smoke
  // =========================================================================
  {
    const prevWin = globalThis.window
    const prevDoc = globalThis.document
    const prevReact = globalThis.React
    globalThis.window = { location: { href: 'http://127.0.0.1:8498/?session=s-beam', search: '?session=s-beam' } }
    globalThis.document = { documentElement: { getAttribute: () => 'dark' }, querySelector: () => null }
    globalThis.React = {
      createElement: (type, props, ...children) => ({ $$typeof: 'react.el', type, props: { ...(props || {}), children } }),
      Fragment: 'Fragment',
      useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
      useEffect: () => {},
      useRef: (init) => ({ current: init }),
      useMemo: (fn) => fn(),
      useCallback: (fn) => fn,
    }
    try {
      const utilsMod = await import(modUrl('src/client/utils.js'))
      const flowClientMod = await import(modUrl('src/client/tabs/tasks-flow.js'))
      const bBeam = schemaMod.normalizeBoard({
        objective: '验证 Route B 贝塞尔流光节点渲染',
        plan: [
          { id: 'bs1', text: '步骤一已完成', done: true },
          { id: 'bs2', text: '步骤二推进中', done: false },
          { id: 'bs3', text: '步骤三待开始', done: false },
        ],
        tasks: [
          { id: 'bt1', title: '子任务一', status: 'done', planStepId: 'bs2' },
          { id: 'bt2', title: '子任务二', status: 'doing', planStepId: 'bs2' },
          { id: 'bt3', title: '子代理支线任务', status: 'doing', subagent: 'worker-sub', planStepId: 'bs2', targetPlanStepId: 'bs3' },
        ],
      })
      const hierBeam = utilsMod.buildAgentHierarchy([
        { name: 'lead', id: 's-beam', status: 'running' },
        { name: 'worker-sub', id: 'sub-1', parentId: 's-beam', status: 'running' },
      ], { rootId: 's-beam' })
      const beamModel = flowClientMod.buildTaskFlowModel(bBeam, bBeam.tasks, bBeam.tasks, hierBeam, {
        statusFilter: 'all',
        filterAgent: '',
        focusedTaskScopeSet: new Set(),
        focusedAgentSet: new Set(),
      })
      const beamEl = flowClientMod.TaskBeamFlowView({
        flowModel: beamModel,
        board: bBeam,
        collapsed: new Set(),
        onToggleCollapse: () => {},
        statusFilter: 'all',
        stepApi: {
          consultIdx: -1,
          secAskingIdx: -1,
          secAnswers: {},
          onToggleStep: () => {},
          onExplainStep: () => {},
          onConsultStep: () => {},
          onOpenStepMenu: () => {},
          onAppendStep: () => {},
          renderStepConsult: () => null,
        },
      })
      const findTree = (node, pred) => {
        if (!node || typeof node !== 'object') return false
        if (Array.isArray(node)) return node.some(x => findTree(x, pred))
        if (pred(node)) return true
        const ch = node.props && node.props.children
        return Array.isArray(ch) ? ch.some(x => findTree(x, pred)) : false
      }
      assert.ok(beamEl && beamEl.$$typeof === 'react.el')
      assert.equal(findTree(beamEl, n => String(n.props?.className || '').includes('dnb-beam-pipeline')), true, 'B1.5 must render dnb-beam-pipeline')
      assert.equal(findTree(beamEl, n => String(n.props?.className || '').includes('dnb-beam-node')), true, 'B1.5 must render dnb-beam-node cards')
      assert.equal(findTree(beamEl, n => String(n.props?.className || '').includes('dnb-beam-agent-node')), true, 'B1.5 must render dnb-beam-agent-node subagent pills')
      assert.equal(findTree(beamEl, n => String(n.props?.className || '').includes('dnb-beam-drawer')), true, 'B1.5 must render dnb-beam-drawer inspector')
      assert.equal(findTree(beamEl, n => String(n.props?.className || '').includes('dnb-flow-step-text-btn')), true, 'B1.5 must render step action buttons')
      console.log('[B1.5 PASS] TaskBeamFlowView serpentine node grid & inline drawer render smoke verified')
    } finally {
      if (prevWin === undefined) delete globalThis.window
      else globalThis.window = prevWin
      if (prevDoc === undefined) delete globalThis.document
      else globalThis.document = prevDoc
      if (prevReact === undefined) delete globalThis.React
      else globalThis.React = prevReact
    }
  }

  // Mount index.js once for B10, B12, and 27-route invariant checks
  const idxMod = await import(modUrl('index.js'))
  const stateMod = await import(modUrl('chief-state.js'))
  const netMod = await import(modUrl('chief-network.js'))
  const storeMod = await import(modUrl('board-store.js'))
  const subagentMod = await import(modUrl('subagent-runtime.js'))

  const routes = new Map()
  const tools = new Map()
  const hooks = new Map()
  let spProvider = null
  const cleanups = []
  const fakeAgents = new Map()
  const fakeSubprocessRef = { current: null }
  const sidB10 = 'sess-v180-b10'
  fakeAgents.set(sidB10, {
    id: sidB10,
    status: 'idle',
    session: {
      id: sidB10,
      header: { cwd: wsDirA, config: { provider: 'deepseek', model: 'deepseek-chat' } },
      deriveMessages: () => [{ role: 'user', content: 'hi' }],
    },
  })

  const fakeCtx = {
    get(name) {
      if (name === 'connection') return { requestRejection: () => null }
      if (name === 'webServer') {
        return {
          register: (r) => { routes.set(r.path, r.handler); return () => routes.delete(r.path) },
        }
      }
      if (name === 'tools') {
        return {
          register: (t) => { tools.set(t.name, t); return () => tools.delete(t.name) },
        }
      }
      if (name === 'agents') {
        return {
          get: (id) => fakeAgents.get(String(id || '')) || null,
          list: () => [...fakeAgents.values()],
        }
      }
      if (name === 'workingDirectory') return { defaultDirectory: wsDirA, get: () => wsDirA }
      if (name === 'workspaceRegistry') {
        return { list: () => [{ id: 'ws-b10', path: wsDirA, sessionIds: [sidB10], updatedAt: Date.now() }], archivedSessionIds: [] }
      }
      if (name === 'systemPrompt') {
        return {
          section: (def) => {
            spProvider = def
            return () => { spProvider = null }
          },
        }
      }
      if (name === 'subprocess') return fakeSubprocessRef.current
      return null
    },
    inject(_deps, cb) {
      cb({
        get: (name) => fakeCtx.get(name),
        systemPrompt: fakeCtx.get('systemPrompt'),
        webServer: fakeCtx.get('webServer'),
        tools: fakeCtx.get('tools'),
        effect: (fn) => {
          const d = fn()
          if (typeof d === 'function') cleanups.push(d)
        },
      })
    },
    on(ev, fn) {
      hooks.set(ev, fn)
      return () => hooks.delete(ev)
    },
    effect(fn) {
      const d = fn()
      if (typeof d === 'function') cleanups.push(d)
    },
  }

  idxMod.apply(fakeCtx)
  assert.equal(routes.size, 27, `B1 route count invariant violated: expected 27, got ${routes.size}`)

  function invokeRoute(routePath, { method = 'GET', query = '', body = null } = {}) {
    return new Promise((resolve, reject) => {
      const handler = routes.get(routePath)
      const req = new EventEmitter()
      req.method = method
      req.url = routePath + query
      req.headers = {}
      req.destroy = () => {}
      const res = {
        statusCode: 200,
        setHeader: () => {},
        end: (raw = '') => {
          try {
            resolve({ status: res.statusCode, data: raw ? JSON.parse(String(raw)) : null })
          } catch (e) {
            reject(e)
          }
        },
      }
      Promise.resolve(handler(req, res)).catch(reject)
      if (body !== null) {
        queueMicrotask(() => {
          req.emit('data', Buffer.from(JSON.stringify(body), 'utf8'))
          req.emit('end')
        })
      }
    })
  }

  // =========================================================================
  // B6 & B7: Gemini CLI probe, Live Stream redaction & 2-Hop Chain Relay
  // =========================================================================
  const fakeGemini = path.join(fakeBinsDir, process.platform === 'win32' ? 'gemini.cmd' : 'gemini')
  const fakeCodex = path.join(fakeBinsDir, process.platform === 'win32' ? 'codex.cmd' : 'codex')
  fs.writeFileSync(fakeGemini, '@echo off\r\necho fake\r\n', 'utf8')
  fs.writeFileSync(fakeCodex, '@echo off\r\necho fake\r\n', 'utf8')
  process.env.DSH_CHIEF_GEMINI_BIN = fakeGemini
  process.env.DSH_CHIEF_CODEX_BIN = fakeCodex

  try {
    const detected = netMod.detectLocalHarnessBinaries({ force: true })
    assert.ok(detected.has('gemini'), 'B6 detectLocalHarnessBinaries must discover Gemini CLI via DSH_CHIEF_GEMINI_BIN')
    assert.equal(detected.get('gemini').transport, 'local-cli')

    const spawnedRuns = []
    const depsMock = {
      hostState: {
        activeBubbleRuns: new Map(),
        recentBubbleRuns: [],
        activeSubprocess: {
          spawn(spec) {
            const stdout = makeFakeStream()
            const stderr = makeFakeStream()
            let resolveDone
            const done = new Promise((r) => { resolveDone = r })
            const rec = { spec, stdout, stderr, resolveDone, terminated: false }
            spawnedRuns.push(rec)
            return {
              stdout,
              stderr,
              done,
              terminate: () => { rec.terminated = true; resolveDone({ exitCode: 130 }) },
            }
          },
        },
      },
      getSessionCwd: () => wsDirA,
      boardForSession: () => schemaMod.emptyBoard(),
      boardFileFor: () => path.join(tmpRoot, 'board-b6.json'),
      runtime: {
        get: (n) => (n === 'subprocess' ? depsMock.hostState.activeSubprocess : null),
      },
    }

    const d1 = await netMod.dispatchBubbleHarness(depsMock, {
      rootId: sidB10,
      provider: 'codex',
      text: '优化接口代码',
      label: 'Codex Refactor',
      chainNext: { provider: 'gemini', instruction: '请复核 Codex 修改结果' },
    })
    assert.equal(d1.ok, true)
    assert.equal(spawnedRuns.length, 1)

    spawnedRuns[0].stdout.pushChunk('step1 ok\nTOKEN=sk-secret9999888877776666\nREADY_FOR_REVIEW')
    const midBubble = netMod.computeBubbleState(depsMock, sidB10, stateMod.loadChiefState(), { cluster: [sidB10], targets: [] })
    assert.equal(midBubble.liveStreams.length, 1)
    assert.ok(midBubble.liveStreams[0].tail.includes('[REDACTED]'), 'B6 live stream must redact secrets')
    assert.ok(!midBubble.liveStreams[0].tail.includes('sk-secret9999888877776666'))
    assert.ok(midBubble.liveStreams[0].tail.includes('READY_FOR_REVIEW'))

    spawnedRuns[0].resolveDone({ exitCode: 0 })
    await new Promise(r => setTimeout(r, 80))

    assert.equal(spawnedRuns.length, 2, 'B7 Hop 2 (gemini) must trigger automatically after Hop 1 success')
    assert.ok(
      String(spawnedRuns[1].spec.stdio.stdin.data).includes('READY_FOR_REVIEW'),
      'B7 Hop 2 prompt must forward Hop 1 output summary',
    )
    spawnedRuns[1].stdout.pushChunk('Gemini 复核通过')
    spawnedRuns[1].resolveDone({ exitCode: 0 })
    await new Promise(r => setTimeout(r, 60))

    const endBubble = netMod.computeBubbleState(depsMock, sidB10, stateMod.loadChiefState(), { cluster: [sidB10], targets: [] })
    assert.equal(endBubble.liveStreams.length, 0)
    assert.ok(endBubble.recentRuns.length >= 2, 'B6 recentRuns must preserve finished stream tails')

    const dFail = await netMod.dispatchBubbleHarness(depsMock, {
      rootId: sidB10,
      provider: 'codex',
      text: 'will fail',
      chainNext: { provider: 'gemini', instruction: 'should not run' },
    })
    assert.equal(dFail.ok, true)
    const idxFail = spawnedRuns.length - 1
    spawnedRuns[idxFail].stderr.pushChunk('fatal crash')
    spawnedRuns[idxFail].resolveDone({ exitCode: 1 })
    await new Promise(r => setTimeout(r, 60))
    assert.equal(spawnedRuns.length, idxFail + 1, 'B7 failed Hop 1 must NOT trigger Hop 2 chain relay')

    const dDepth = await netMod.dispatchBubbleHarness(depsMock, {
      rootId: sidB10,
      provider: 'codex',
      text: 'depth capped',
      chainNext: { provider: 'gemini', instruction: 'should not run at depth 1' },
      _chainDepth: 1,
    })
    assert.equal(dDepth.ok, true)
    const idxDepth = spawnedRuns.length - 1
    spawnedRuns[idxDepth].resolveDone({ exitCode: 0 })
    await new Promise(r => setTimeout(r, 60))
    assert.equal(spawnedRuns.length, idxDepth + 1, 'B7 _chainDepth=1 must prevent unbounded chain recursion')
    console.log('[B6 & B7 PASS] Gemini CLI probe, redacted live streams, 2-hop chain relay & safety guards verified')
  } finally {
    delete process.env.DSH_CHIEF_GEMINI_BIN
    delete process.env.DSH_CHIEF_CODEX_BIN
    netMod.detectLocalHarnessBinaries({ force: true })
  }

  // =========================================================================
  // B10: Global Custom Chief Naming E2E, secret blocking & 0-byte @lead isolation
  // =========================================================================
  const sidPlainNaming = 'sess-plain-naming-only'
  const secretCfgHttp = await invokeRoute('/api/dsh-chief/chief/config', {
    method: 'POST',
    body: { session: sidPlainNaming, chiefName: 'sk-proj-forbiddenkey12345678' },
  })
  assert.equal(secretCfgHttp.status, 400)
  assert.equal(secretCfgHttp.data.blocked, true, 'B10 chief naming via /chief/config must hard-block secrets')

  const renamePlainHttp = await invokeRoute('/api/dsh-chief/chief/config', {
    method: 'POST',
    body: { session: sidPlainNaming, chiefName: '哈基米' },
  })
  assert.equal(renamePlainHttp.status, 200)
  assert.equal(renamePlainHttp.data.chiefName, '哈基米')
  assert.equal(
    stateMod.isChiefSessionEnabled(stateMod.loadChiefState(), sidPlainNaming),
    false,
    'B10 global chiefName update MUST NOT activate unenabled plain chat sessions',
  )

  stateMod.activateChiefSession(sidB10, { force: true })
  const snapNamed = await invokeRoute('/api/dsh-chief/snapshot', { query: `?session=${sidB10}` })
  assert.equal(snapNamed.status, 200)
  assert.equal(snapNamed.data.chiefMeta.chiefName, '哈基米', 'B10 chiefName must synchronize globally across sessions')
  assert.ok(
    stateMod.buildChiefIdentityPromptLine(snapNamed.data.chiefMeta).includes('哈基米'),
    'B10 buildChiefIdentityPromptLine must render Chief-only identity instruction',
  )

  const renameCfgHttp = await invokeRoute('/api/dsh-chief/chief/config', {
    method: 'POST',
    body: { session: sidB10, chiefName: '贾维斯' },
  })
  assert.equal(renameCfgHttp.status, 200)
  assert.equal(renameCfgHttp.data.chiefName, '贾维斯')
  assert.equal(renameCfgHttp.data.view.config.chiefName, '贾维斯')
  assert.equal('privateBrain' in renameCfgHttp.data.view, false, 'B10 view must NOT expose stripped privateBrain field')

  if (spProvider && typeof spProvider.content === 'function') {
    const spTextNamed = await spProvider.content({ agent: fakeAgents.get(sidB10), session: fakeAgents.get(sidB10).session })
    assert.ok(!String(spTextNamed || '').includes('贾维斯'), 'B10 custom Chief name must stay 0-byte isolated from @lead systemPrompt!')
  }
  console.log('[B10 PASS] Global custom Chief naming (/chief/config + /snapshot + /chief/view), secret block & @lead 0-byte isolation verified')

  // =========================================================================
  // B12: Option 1 Real GitHub Star Sync & Zero Plain-Session Intrusion
  // =========================================================================
  const starMod = await import(modUrl('github-star.js'))
  const prevDisableFetch = process.env.DSH_CHIEF_DISABLE_GITHUB_FETCH
  const prevGhBin = process.env.DSH_CHIEF_GH_BIN
  try {
    process.env.DSH_CHIEF_DISABLE_GITHUB_FETCH = '1'

    process.env.DSH_CHIEF_GH_BIN = path.join(fakeBinsDir, 'missing-gh')
    fakeSubprocessRef.current = null
    starMod.resetGithubStarCacheForTests()
    const fbRes = await invokeRoute('/api/dsh-chief/chief/fact', {
      method: 'POST',
      body: { session: 'sess-plain-star-1', op: 'github.star_toggle' },
    })
    assert.equal(fbRes.status, 200)
    assert.equal(fbRes.data.mode, 'web_fallback')
    assert.equal(fbRes.data.ghAvailable, false)
    assert.equal(fbRes.data.fallbackUrl, 'https://github.com/gluztm/dsh-chief')

    const fakeGh = path.join(fakeBinsDir, process.platform === 'win32' ? 'gh.cmd' : 'gh')
    fs.writeFileSync(fakeGh, '@echo off\r\necho mock-gh\r\n', 'utf8')
    process.env.DSH_CHIEF_GH_BIN = fakeGh
    starMod.resetGithubStarCacheForTests()

    let mockStarred = false
    fakeSubprocessRef.current = {
      spawn(spec) {
        const stdout = makeFakeStream()
        const stderr = makeFakeStream()
        let resolveDone
        const done = new Promise((r) => { resolveDone = r })
        const cmdLine = Array.isArray(spec.argv) ? spec.argv.join(' ') : ''
        queueMicrotask(() => {
          if (cmdLine.includes('-X PUT')) {
            mockStarred = true
            resolveDone({ exitCode: 0 })
          } else if (cmdLine.includes('-X DELETE')) {
            mockStarred = false
            resolveDone({ exitCode: 0 })
          } else if (mockStarred) {
            resolveDone({ exitCode: 0 })
          } else {
            stderr.pushChunk('HTTP 404: Not Found')
            resolveDone({ exitCode: 1 })
          }
        })
        return {
          stdout,
          stderr,
          done,
          terminate: () => resolveDone({ exitCode: 130 }),
        }
      },
    }

    const sidPlainStar = 'sess-plain-star-unactivated'
    const stInitial = await invokeRoute('/api/dsh-chief/chief/fact', {
      method: 'POST',
      body: { session: sidPlainStar, op: 'github.star_status', checkPersonal: true, force: true },
    })
    assert.equal(stInitial.status, 200)
    assert.equal(stInitial.data.ghAvailable, true)
    assert.equal(stInitial.data.ghAuthenticated, true)
    assert.equal(stInitial.data.starred, false)
    assert.equal(stInitial.data.syncedVia, 'gh')

    const putRes = await invokeRoute('/api/dsh-chief/chief/fact', {
      method: 'POST',
      body: { session: sidPlainStar, op: 'github.star_toggle' },
    })
    assert.equal(putRes.status, 200)
    assert.equal(putRes.data.mode, 'gh_direct')
    assert.equal(putRes.data.changed, true)
    assert.equal(putRes.data.starred, true)

    const noopRes = await invokeRoute('/api/dsh-chief/chief/fact', {
      method: 'POST',
      body: { session: sidPlainStar, op: 'github.star_toggle' },
    })
    assert.equal(noopRes.status, 200)
    assert.equal(noopRes.data.mode, 'already_starred')
    assert.equal(noopRes.data.changed, false)
    assert.equal(noopRes.data.starred, true)

    const delRes = await invokeRoute('/api/dsh-chief/chief/fact', {
      method: 'POST',
      body: { session: sidPlainStar, op: 'github.star_toggle', desired: false },
    })
    assert.equal(delRes.status, 200)
    assert.equal(delRes.data.mode, 'gh_direct')
    assert.equal(delRes.data.changed, true)
    assert.equal(delRes.data.starred, false)

    assert.equal(
      stateMod.isChiefSessionEnabled(stateMod.loadChiefState(), sidPlainStar),
      false,
      'B12 github.star_* polling/toggling MUST NOT activate unenabled plain chat sessions',
    )
    console.log('[B12 PASS] Option 1 GitHub Star web fallback, gh CLI 404/PUT/DELETE sync & plain-session isolation verified')
  } finally {
    fakeSubprocessRef.current = null
    starMod.resetGithubStarCacheForTests()
    if (prevDisableFetch === undefined) delete process.env.DSH_CHIEF_DISABLE_GITHUB_FETCH
    else process.env.DSH_CHIEF_DISABLE_GITHUB_FETCH = prevDisableFetch
    if (prevGhBin === undefined) delete process.env.DSH_CHIEF_GH_BIN
    else process.env.DSH_CHIEF_GH_BIN = prevGhBin
  }

  // =========================================================================
  // B13: Collaboration Routing & Anti-Self-Steer Regression Gate
  // =========================================================================
  {
    const leadRootId = 'session-88c4c059-lead'
    const peerTestId = 'session-570b81eb-test'
    const realChildId = 'session-child-real-1'
    const hijackedChildId = 'session-child-hijack'

    let leadSteerCount = 0
    let peerTestFollowupCount = 0
    const pathASent = []
    let forcePathAThrowFor = ''
    let listDescendantsRows = []

    const boardsBySid = new Map()
    const boardPathMap = new Map()
    const bLead = schemaMod.normalizeBoard({
      objective: '协同闭环与目录一致性验证',
      tasks: [
        { id: 't-phantom', title: '协同探针验证任务', status: 'doing', owner: '协同探针', subagent: '协同探针', session: leadRootId },
        { id: 't-test-legacy', title: 'Test 历史同名任务', status: 'todo', owner: 'Test', subagent: 'Test', session: leadRootId },
      ],
    })
    boardsBySid.set(leadRootId, bLead)
    boardsBySid.set(peerTestId, schemaMod.normalizeBoard({ objective: 'Test 独立主窗口目标' }))
    const b13BoardDir = path.join(tmpRoot, 'b13-boards')
    fs.mkdirSync(b13BoardDir, { recursive: true })
    const bFileFor = (sid) => {
      const f = path.join(b13BoardDir, `${sid}.json`)
      boardPathMap.set(f, sid)
      return f
    }

    const b13Agents = new Map([
      [leadRootId, {
        id: leadRootId,
        status: 'running',
        session: { id: leadRootId, header: { title: '主研发窗口', cwd: wsDirA } },
        steer: () => { leadSteerCount += 1 },
      }],
      [peerTestId, {
        id: peerTestId,
        status: 'idle',
        session: { id: peerTestId, header: { title: 'Test', cwd: wsDirA } },
        followup: () => { peerTestFollowupCount += 1 },
      }],
      [realChildId, {
        id: realChildId,
        parentId: leadRootId,
        status: 'running',
        session: { id: realChildId, header: { cwd: wsDirA } },
      }],
      [hijackedChildId, {
        id: hijackedChildId,
        parentId: leadRootId,
        status: 'running',
        session: { id: hijackedChildId, header: { cwd: wsDirA } },
        steer: () => { leadSteerCount += 1 },
      }],
    ])

    const b13HostState = {
      activeRuntime: null,
      activeSubprocess: null,
      subagentRootMap: new Map(),
      subagentTreeCache: new Map(),
      dormantTitleCache: new Map(),
      detectedHarnessProviders: new Map(),
      activeBubbleRuns: new Map(),
      recentBubbleRuns: [],
    }
    const b13Runtime = {
      get(name) {
        if (name === 'agents') {
          return {
            get: (id) => b13Agents.get(String(id || '')) || null,
            list: () => [...b13Agents.values()],
          }
        }
        if (name === 'subagents') {
          return {
            async listDescendants(rid) {
              return rid === leadRootId ? listDescendantsRows : []
            },
            async resolveName(_caller, _nm) {
              return ''
            },
            async sendMessage(caller, childId, blocks) {
              if (forcePathAThrowFor && childId === forcePathAThrowFor) {
                throw new Error('simulated native subagent transport failure')
              }
              pathASent.push({ callerId: caller.id, childId, blocks })
            },
            rootOf(ag) {
              if (!ag) return null
              if (ag.id === hijackedChildId && forcePathAThrowFor === hijackedChildId) {
                return { id: 'session-wrong-other-root' }
              }
              return ag.parentId ? { id: ag.parentId } : { id: ag.id }
            },
            namesOf(ag) {
              if (ag.id === realChildId) return { self: 'worker1', parent: 'lead' }
              if (ag.id === hijackedChildId) return { self: 'hijackedWorker', parent: 'lead' }
              return { self: 'lead', parent: '' }
            },
          }
        }
        if (name === 'workingDirectory') return { defaultDirectory: wsDirA, get: () => wsDirA }
        return null
      },
    }
    b13HostState.activeRuntime = b13Runtime

    const noop = () => {}
    const subRt = subagentMod.createSubagentRuntime({
      hostState: b13HostState,
      boardFile: () => bFileFor(leadRootId),
      boardFileFor: bFileFor,
      boardForSession: (f) => boardsBySid.get(boardPathMap.get(f) || leadRootId) || schemaMod.emptyBoard(),
      composeHandoffFromNarrative: () => ({}),
      injectInto: noop,
      loadBoard: (f) => boardsBySid.get(boardPathMap.get(f) || leadRootId) || schemaMod.emptyBoard(),
      runAction: () => ({ ok: true }),
      saveBoard: noop,
      withBoardLock: (_f, fn) => fn(),
      writePending: noop,
    })

    const b13Deps = {
      hostState: b13HostState,
      runtime: b13Runtime,
      resolveRootSessionId: (sid, ag) => {
        if (sid === hijackedChildId && forcePathAThrowFor === hijackedChildId) return 'session-wrong-other-root'
        return subRt.resolveRootSessionId(sid, ag)
      },
      resolveAgentIdentity: subRt.resolveAgentIdentity,
      boardFileFor: bFileFor,
      boardForSession: (f) => boardsBySid.get(boardPathMap.get(f) || leadRootId) || schemaMod.emptyBoard(),
      loadBoard: (f) => boardsBySid.get(boardPathMap.get(f) || leadRootId) || schemaMod.emptyBoard(),
      refreshSubagentTree: subRt.refreshSubagentTree,
      sessionName: (_rt, agOrSid) => {
        const ag = typeof agOrSid === 'string' ? b13Agents.get(agOrSid) : agOrSid
        return ag && ag.session && ag.session.header ? (ag.session.header.title || '') : ''
      },
      findLiveCallerAgent: subRt.findLiveCallerAgent,
      appendBoardLog: noop,
      getSessionCwd: () => wsDirA,
    }

    stateMod.activateChiefSession(leadRootId, { force: true })
    stateMod.activateChiefSession(peerTestId, { force: true })
    stateMod.setPeerLink(leadRootId, peerTestId, true)

    // Case 1: Phantom board owner ("协同探针") with t.session = leadRootId & NO native descendant
    listDescendantsRows = [
      // Even if a corrupted diagnostic entry echoes leadRootId, refreshSubagentTree MUST strip its id!
      { kind: 'diagnostic', id: leadRootId, path: '诊断回显探针', reason: 'unavailable' },
    ]
    const roster1 = await subRt.refreshSubagentTree(b13Runtime, leadRootId, bLead)
    const phantomRow = roster1.find(r => r.name === '协同探针')
    assert.ok(phantomRow, 'B13.1 board owner row may exist as historical task reference')
    assert.equal(phantomRow.id, '', 'B13.1 phantom task owner MUST NOT inherit leadRootId from t.session')
    assert.equal(phantomRow.status, 'stale', 'B13.1 phantom task owner MUST NOT forge running status')
    assert.equal(phantomRow.verifiedInstance, false)

    const dir1 = await netMod.listPeerDirectory(b13Deps, leadRootId)
    const phantomPeer = dir1.targets.find(t => t.name === '协同探针')
    assert.ok(phantomPeer)
    assert.equal(phantomPeer.kind, 'stale', 'B13.1 listPeerDirectory must mark unbacked task owner as kind=stale')
    assert.equal(phantomPeer.id, '')
    assert.equal(phantomPeer.routable, false)

    const phantomSend = await netMod.deliverCrossMessage(b13Deps, {
      fromSession: leadRootId,
      fromLabel: 'agent',
      target: '协同探针',
      text: '确认能否收到消息',
      mode: 'steer',
    })
    assert.equal(phantomSend.ok, false, 'B13.1 sending to stale phantom must return ok=false')
    assert.equal(phantomSend.deliveredPhysical, false)
    assert.equal(phantomSend.deliveryMode, 'unrouted')
    assert.equal(phantomSend.routedStatus, 'stale_target')
    assert.equal(leadSteerCount, 0, 'B13.1 sending to phantom subagent MUST NEVER steer lead!')
    assert.deepEqual(phantomSend.mail.readBy, [], 'B13.1 rejected delivery MUST NEVER mark recipient readBy')

    const auditSt = stateMod.loadChiefState().workspaces[leadRootId].auditLog || []
    assert.ok(
      auditSt.some(a => a && a.stage === 'mail_routing' && a.outcome === 'stale_target'),
      'B13.1 must write mail_routing audit telemetry for stale_target',
    )

    // Pre-step on lead MUST NOT leak stale_target mail into lead
    const leadPreStep = await netMod.consumePreStepDelta(b13Deps, b13Agents.get(leadRootId))
    assert.ok(!leadPreStep || !String(leadPreStep.text || '').includes('确认能否收到消息'), 'B13.1 lead pre-step must not absorb failed subagent mail')

    // Case 2: Same-name collision ("Test" peer-session vs "Test" task owner)
    const testPeers = dir1.targets.filter(t => String(t.name).toLowerCase() === 'test')
    assert.equal(testPeers.length, 1, 'B13.2 same-name task owner matching linked peer-session Test must be suppressed')
    assert.equal(testPeers[0].kind, 'peer-session')
    assert.equal(testPeers[0].id, peerTestId)

    const testSend = await netMod.deliverCrossMessage(b13Deps, {
      fromSession: leadRootId,
      fromLabel: 'agent',
      target: 'Test',
      text: '独立会话握手',
      mode: 'followup',
    })
    assert.equal(testSend.ok, true)
    assert.equal(testSend.deliveredPhysical, true)
    assert.equal(testSend.routedStatus, 'delivered')
    assert.equal(testSend.resolvedAgentId, peerTestId)
    assert.equal(peerTestFollowupCount, 1, 'B13.2 target="Test" must route directly to peer-session Test')
    assert.equal(leadSteerCount, 0, 'B13.2 target="Test" must NOT bounce into lead')

    // Case 3: Genuine native subagent ("worker1") via Path A subagents.sendMessage
    listDescendantsRows = [
      { id: realChildId, parentId: leadRootId, name: 'worker1', path: 'worker1', mode: 'continuable' },
    ]
    const dir3 = await netMod.listPeerDirectory(b13Deps, leadRootId)
    const realChildPeer = dir3.targets.find(t => t.name === 'worker1')
    assert.ok(realChildPeer && realChildPeer.kind === 'subagent')
    assert.equal(realChildPeer.id, realChildId)
    assert.equal(realChildPeer.parentRootId, leadRootId)
    assert.equal(realChildPeer.verifiedInstance, true)

    const realSend = await netMod.deliverCrossMessage(b13Deps, {
      fromSession: leadRootId,
      fromLabel: 'agent',
      target: 'worker1',
      text: '执行实测任务',
      mode: 'steer',
    })
    assert.equal(realSend.ok, true)
    assert.equal(realSend.deliveredPhysical, true)
    assert.equal(realSend.deliveryMode, 'subagent-send')
    assert.equal(realSend.routedStatus, 'delivered')
    assert.equal(realSend.resolvedAgentId, realChildId)
    assert.equal(pathASent.length, 1)
    assert.equal(pathASent[0].childId, realChildId)
    assert.ok(realSend.mail.readBy.includes(realChildId), 'B13.3 confirmed Path A delivery must record readBy with resolved childId')

    // Case 4: Path B root mismatch / self-bounce guard + legitimate Chief->lead delivery keepalive
    listDescendantsRows = [
      { id: hijackedChildId, parentId: leadRootId, name: 'hijackedWorker', path: 'hijackedWorker', mode: 'continuable' },
    ]
    await subRt.refreshSubagentTree(b13Runtime, leadRootId, bLead)
    forcePathAThrowFor = hijackedChildId
    b13HostState.subagentRootMap.delete(hijackedChildId)

    const hijackSend = await netMod.deliverCrossMessage(b13Deps, {
      fromSession: leadRootId,
      fromLabel: 'agent',
      target: 'hijackedWorker',
      text: 'should fail binding check',
      mode: 'steer',
    })
    assert.equal(hijackSend.ok, false, 'B13.4 Path B must reject child agent whose resolved rootId != peer.rootId')
    assert.equal(hijackSend.deliveredPhysical, false)
    assert.equal(hijackSend.deliveryMode, 'unrouted')
    assert.equal(hijackSend.routedStatus, 'unrouted')
    assert.deepEqual(hijackSend.mail.readBy, [], 'B13.4 blocked Path B delivery must leave readBy empty')
    assert.equal(leadSteerCount, 0, 'B13.4 blocked Path B must NOT invoke target.steer')

    forcePathAThrowFor = ''
    const chiefToLeadSend = await netMod.deliverCrossMessage(b13Deps, {
      fromSession: leadRootId,
      fromLabel: 'DSH 参谋长',
      target: 'lead',
      text: '请主对话继续推进下一步',
      mode: 'steer',
      envelopeKind: 'execution_request',
    })
    assert.equal(chiefToLeadSend.ok, true, 'B13.4 legitimate Chief -> lead steer must remain operational')
    assert.equal(chiefToLeadSend.deliveredPhysical, true)
    assert.equal(chiefToLeadSend.routedStatus, 'delivered')
    assert.equal(chiefToLeadSend.resolvedAgentId, leadRootId)
    assert.equal(leadSteerCount, 1)

    console.log('[B13 PASS] Anti-self-steer guard, phantom stale isolation, Test x 2 disambiguation & Path A/B routing verified')
  }

  // =========================================================================
  // B14: Collab Friction & Guard Regression Gate (Auto-Continue, Idle-Guard, Cross-Session Disambiguation & Hooks)
  // =========================================================================
  {
    const acMod = await import(modUrl('auto-continue.js'))
    const guardMod = await import(modUrl('idle-guard.js'))
    const actionsMod = await import(modUrl('board-actions.js'))
    const toolsMod = await import(modUrl('model-tools.js'))
    const routesMod = await import(modUrl('api-routes.js'))
    const hooksMod = await import(modUrl('runtime-hooks.js'))

    // B14.1: auto-continue silent-end & child anti-wake
    const leadB14 = 'lead-root-b14'
    const childB14 = 'sub-b14-agent1'
    const acAgents = new Map([
      [leadB14, { id: leadB14, status: 'idle', followup: () => {} }],
      [childB14, { id: childB14, status: 'inactive', followup: () => {} }],
    ])
    const ac = acMod.createAutoContinueEngine({
      getAgent: (sid) => acAgents.get(sid) || null,
      resolveRootSessionId: (sid) => (sid === childB14 ? leadB14 : sid),
      isChiefStopped: () => false,
      baseDelayMs: 5000,
    })

    ac.onSessionEvent({ id: childB14 }, { type: 'turn/start', data: { turn: 1 } })
    const childSilentRes = ac.onSessionEvent({ id: childB14 }, { type: 'turn/end', data: { turn: 1, reason: 'no-visible-output' } })
    assert.equal(childSilentRes?.action, 'child-silent-skipped', 'B14.1 child no-visible-output must never wake subagent')
    assert.equal(childSilentRes?.scheduled, false)

    ac.onSessionEvent({ id: childB14 }, { type: 'turn/start', data: { turn: 2 } })
    ac.onSessionEvent({ id: childB14 }, { type: 'llm/start', data: { turn: 2 } })
    const childSilentCompleted = ac.onSessionEvent({ id: childB14 }, { type: 'turn/end', data: { turn: 2, reason: 'completed' } })
    assert.equal(childSilentCompleted?.action, 'child-silent-skipped', 'B14.1 child silent completion must be skipped')
    assert.equal(childSilentCompleted?.scheduled, false)

    ac.onSessionEvent({ id: leadB14 }, { type: 'turn/start', data: { turn: 1 } })
    ac.onSessionEvent({ id: leadB14 }, { type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: '已向对端确认完毕。' } } })
    const leadVisibleRes = ac.onSessionEvent({ id: leadB14 }, { type: 'turn/end', data: { turn: 1, reason: 'no-visible-output' } })
    assert.equal(leadVisibleRes?.action, 'completed', 'B14.1 lead with visible chunk must not trigger silent auto-continue')
    assert.equal(leadVisibleRes?.scheduled, false)

    ac.onSessionEvent({ id: leadB14 }, { type: 'turn/start', data: { turn: 2 } })
    ac.onSessionEvent({ id: leadB14 }, { type: 'tool/call', data: { turn: 2, id: 'tc-w1', name: 'wait_agent', arguments: '{}' } })
    const leadWaitRes = ac.onSessionEvent({ id: leadB14 }, { type: 'turn/end', data: { turn: 2, reason: 'no-visible-output' } })
    assert.equal(leadWaitRes?.action, 'completed', 'B14.1 lead calling wait_agent must not trigger silent auto-continue')
    assert.equal(leadWaitRes?.scheduled, false)

    ac.onSessionEvent({ id: leadB14 }, { type: 'turn/start', data: { turn: 3 } })
    ac.onSessionEvent({ id: leadB14 }, { type: 'tool/call', data: { turn: 3, id: 'tc-m1', name: 'chief_board', arguments: JSON.stringify({ action: 'mail.send', target: 'Test', text: 'challenge' }) } })
    const leadMailRes = ac.onSessionEvent({ id: leadB14 }, { type: 'turn/end', data: { turn: 3, reason: 'no-visible-output' } })
    assert.equal(leadMailRes?.action, 'completed', 'B14.1 lead calling chief_board(mail.send) must not trigger silent auto-continue')
    assert.equal(leadMailRes?.scheduled, false)

    ac.onSessionEvent({ id: leadB14 }, { type: 'turn/start', data: { turn: 4 } })
    const leadTrueSilent = ac.onSessionEvent({ id: leadB14 }, { type: 'turn/end', data: { turn: 4, reason: 'no-visible-output' } })
    assert.equal(leadTrueSilent?.action, 'silent-scheduled', 'B14.1 genuine zero-output/zero-tool lead turn must still schedule auto-continue')
    assert.equal(leadTrueSilent?.scheduled, true)
    ac.dispose()

    // B14.2: idle-guard grounded external wait + anti-bypass + waitPoll threshold
    const b14Board = schemaMod.normalizeBoard({
      objective: '跨会话联调验证',
      plan: [{ id: 'p1', text: '等待外部响应后复核', done: false }],
      tasks: [{ id: 't1', title: '跨窗口联调', status: 'doing' }],
    })
    const b14BlockedBoard = schemaMod.normalizeBoard({
      objective: '跨会话联调验证',
      plan: [{ id: 'p1', text: '等待外部输入', done: false }],
      tasks: [{ id: 't1', title: '跨窗口联调', status: 'blocked', note: '等待对端复核' }],
    })
    const makeWaitSess = (events) => ({ snapshotEvents: () => events })

    const vMailWait = guardMod.shouldGuard({
      board: b14Board,
      session: makeWaitSess([
        { type: 'tool/call', data: { turn: 1, name: 'chief_board', arguments: JSON.stringify({ action: 'mail.send', target: 'Test', text: '挑战原文' }) } },
        { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '已向 Test 发信，等待对方回复。' }] } } },
      ]),
      sessionId: 'sess-b14-guard-1',
      turn: 1,
      settings: { guardIdle: true },
    })
    assert.equal(vMailWait, null, 'B14.2 mail.send + waiting reply text must be treated as valid external wait')

    const vChildWait = guardMod.shouldGuard({
      board: b14Board,
      session: makeWaitSess([
        { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '当前存在在途子代理，等待子代理完成回报。' }] } } },
      ]),
      sessionId: 'sess-b14-guard-2',
      turn: 1,
      settings: { guardIdle: true },
      hasRunningSubagent: true,
    })
    assert.equal(vChildWait, null, 'B14.2 hasRunningSubagent + waiting text must be treated as valid external wait')

    const vPeerWait = guardMod.shouldGuard({
      board: b14Board,
      session: makeWaitSess([
        { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '已发送协同挑战，等待跨会话回复。' }] } } },
      ]),
      sessionId: 'sess-b14-guard-3',
      turn: 1,
      settings: { guardIdle: true },
      hasLinkedPeers: true,
    })
    assert.equal(vPeerWait, null, 'B14.2 hasLinkedPeers + waiting text must be treated as valid external wait')

    const vBlockedWait = guardMod.shouldGuard({
      board: b14BlockedBoard,
      session: makeWaitSess([
        { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '当前等待外部输入后继续。' }] } } },
      ]),
      sessionId: 'sess-b14-guard-4',
      turn: 1,
      settings: { guardIdle: true },
    })
    assert.equal(vBlockedWait, null, 'B14.2 all blocked tasks + waiting text must be treated as valid external wait')

    const vUngrounded = guardMod.shouldGuard({
      board: b14Board,
      session: makeWaitSess([
        { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '等待外部输入。' }] } } },
      ]),
      sessionId: 'sess-b14-guard-ungrounded',
      turn: 1,
      settings: { guardIdle: true },
      hasRunningSubagent: false,
      hasLinkedPeers: false,
    })
    assert.equal(vUngrounded?.kind, 'idle-close', 'B14.2 ungrounded "等待外部输入" excuse MUST still trigger idle-close guard')

    for (const [label, tName, tArgs] of [
      ['wait_agent', 'wait_agent', '{}'],
      ['mail.inbox', 'chief_board', JSON.stringify({ action: 'mail.inbox' })],
    ]) {
      const spinSid = `sess-b14-spin-${label}`
      guardMod.clearMidTurnSpin(spinSid)
      for (let i = 0; i < 5; i += 1) guardMod.noteCallTrail(spinSid, tName, tArgs)
      assert.equal(guardMod.detectMidTurnSpin(spinSid, { strongIntervention: true }), null, `B14.2 ${label} ×5 must not trigger mid-turn spin`)
      for (let i = 0; i < 3; i += 1) guardMod.noteCallTrail(spinSid, tName, tArgs)
      const hitSpin = guardMod.detectMidTurnSpin(spinSid, { strongIntervention: true })
      assert.equal(hitSpin?.kind, 'exact-loop', `B14.2 ${label} ×8 must trigger exact-loop`)
      assert.equal(hitSpin?.waitPoll, true, `B14.2 ${label} must set waitPoll=true`)
      const spinText = guardMod.buildMidTurnSpinNotice(hitSpin, b14Board).content[0].text
      assert.ok(spinText.includes('超时') && spinText.includes('mail.send') && spinText.includes('blocked'), `B14.2 ${label} spin notice must include wait-timeout guidance`)
    }

    // B14.3: Cross-session duplicate child disambiguation ("Alpha/agent-1" vs "Beta/agent-1") + targetKind receipts
    const alphaRoot = 'sess-b14-alpha'
    const betaRoot = 'sess-b14-beta'
    const gammaRoot = 'sess-b14-gamma'
    const alphaChild = 'sess-b14-alpha-a1'
    const betaChild = 'sess-b14-beta-a1'

    const b14SentLog = []
    let betaLeadFollowups = 0
    const b14Agents = new Map([
      [alphaRoot, { id: alphaRoot, status: 'running', session: { id: alphaRoot, header: { title: 'Alpha', cwd: wsDirA } } }],
      [betaRoot, { id: betaRoot, status: 'idle', session: { id: betaRoot, header: { title: 'Beta', cwd: wsDirA } }, followup: () => { betaLeadFollowups += 1 } }],
      [gammaRoot, { id: gammaRoot, status: 'running', session: { id: gammaRoot, header: { title: 'Gamma', cwd: wsDirA } } }],
      [alphaChild, { id: alphaChild, parentId: alphaRoot, status: 'running', session: { id: alphaChild, header: { cwd: wsDirA } } }],
      [betaChild, { id: betaChild, parentId: betaRoot, status: 'running', session: { id: betaChild, header: { cwd: wsDirA } } }],
    ])
    const b14BoardDir = path.join(tmpRoot, 'b14-boards')
    fs.mkdirSync(b14BoardDir, { recursive: true })
    const b14HostState = {
      activeRuntime: null,
      subagentRootMap: new Map([[alphaChild, alphaRoot], [betaChild, betaRoot]]),
      subagentTreeCache: new Map(),
      dormantTitleCache: new Map(),
    }
    const b14Runtime = {
      get(name) {
        if (name === 'agents') {
          return {
            get: (id) => b14Agents.get(String(id || '')) || null,
            list: () => [...b14Agents.values()],
          }
        }
        if (name === 'subagents') {
          return {
            async listDescendants(rid) {
              if (rid === alphaRoot) return [{ id: alphaChild, parentId: alphaRoot, name: 'agent-1', path: 'agent-1', mode: 'continuable' }]
              if (rid === betaRoot) return [{ id: betaChild, parentId: betaRoot, name: 'agent-1', path: 'agent-1', mode: 'continuable' }]
              return []
            },
            async resolveName(caller, nm) {
              if (nm === 'agent-1' && caller.id === alphaRoot) return alphaChild
              if (nm === 'agent-1' && caller.id === betaRoot) return betaChild
              return ''
            },
            async sendMessage(caller, childId, blocks) {
              b14SentLog.push({ callerId: caller.id, childId, text: blocks?.[0]?.text || '' })
            },
            rootOf: (ag) => (ag && ag.parentId ? { id: ag.parentId } : { id: ag.id }),
            namesOf: (ag) => (ag && ag.parentId ? { self: 'agent-1', parent: 'lead' } : { self: 'lead', parent: '' }),
          }
        }
        if (name === 'workingDirectory') return { defaultDirectory: wsDirA, get: () => wsDirA }
        return null
      },
    }
    b14HostState.activeRuntime = b14Runtime
    const b14SubRt = subagentMod.createSubagentRuntime({
      hostState: b14HostState,
      boardFile: () => path.join(b14BoardDir, 'shared.json'),
      boardFileFor: (sid) => path.join(b14BoardDir, `${sid}.json`),
      boardForSession: () => schemaMod.normalizeBoard({ objective: 'B14 cross-session disambiguation' }),
      composeHandoffFromNarrative: () => ({}),
      injectInto: () => {},
      loadBoard: () => schemaMod.emptyBoard(),
      runAction: () => ({ ok: true }),
      saveBoard: () => {},
      withBoardLock: (_f, fn) => fn(),
      writePending: () => {},
    })
    const b14NetDeps = {
      hostState: b14HostState,
      runtime: b14Runtime,
      resolveRootSessionId: b14SubRt.resolveRootSessionId,
      resolveAgentIdentity: b14SubRt.resolveAgentIdentity,
      boardFileFor: (sid) => path.join(b14BoardDir, `${sid}.json`),
      boardForSession: () => schemaMod.normalizeBoard({ objective: 'B14 cross-session disambiguation' }),
      loadBoard: () => schemaMod.emptyBoard(),
      refreshSubagentTree: b14SubRt.refreshSubagentTree,
      sessionName: (_rt, agOrSid) => {
        const ag = typeof agOrSid === 'string' ? b14Agents.get(agOrSid) : agOrSid
        return ag?.session?.header?.title || ''
      },
      findLiveCallerAgent: b14SubRt.findLiveCallerAgent,
      appendBoardLog: () => {},
      getSessionCwd: () => wsDirA,
    }
    stateMod.activateChiefSession(alphaRoot, { force: true })
    stateMod.activateChiefSession(betaRoot, { force: true })
    stateMod.activateChiefSession(gammaRoot, { force: true })
    stateMod.setPeerLink(gammaRoot, alphaRoot, true)
    stateMod.setPeerLink(gammaRoot, betaRoot, true)
    stateMod.setPeerLink(alphaRoot, betaRoot, true)

    const ambRes = await netMod.deliverCrossMessage(b14NetDeps, {
      fromSession: gammaRoot,
      fromLabel: 'Gamma',
      target: 'agent-1',
      text: '挑战测试',
      mode: 'steer',
    })
    assert.equal(ambRes.ok, false, 'B14.3 ambiguous bare "agent-1" from Gamma must fail fast')
    assert.ok(Array.isArray(ambRes.ambiguousTargets) && ambRes.ambiguousTargets.includes('Alpha/agent-1') && ambRes.ambiguousTargets.includes('Beta/agent-1'), 'B14.3 must list both Alpha/agent-1 and Beta/agent-1')
    assert.equal(b14SentLog.length, 0, 'B14.3 ambiguous mail must not wake either child')

    const explicitRemoteRes = await netMod.deliverCrossMessage(b14NetDeps, {
      fromSession: gammaRoot,
      fromLabel: 'Gamma',
      target: 'Beta/agent-1',
      text: '青竹过江鱼跃龙门',
      mode: 'steer',
    })
    assert.equal(explicitRemoteRes.ok, true)
    assert.equal(explicitRemoteRes.resolvedAgentId, betaChild)
    assert.equal(explicitRemoteRes.targetKind, 'subagent')
    assert.equal(explicitRemoteRes.crossSession, true)

    const localChildRes = await netMod.deliverCrossMessage(b14NetDeps, {
      fromSession: alphaRoot,
      fromLabel: 'Alpha',
      target: 'agent-1',
      text: '本地子代理直达',
      mode: 'steer',
    })
    assert.equal(localChildRes.ok, true, 'B14.3 Alpha resolving bare "agent-1" must prefer its own local child')
    assert.equal(localChildRes.resolvedAgentId, alphaChild)
    assert.equal(localChildRes.targetKind, 'subagent')
    assert.equal(localChildRes.crossSession, false)

    const remotePeerLeadRes = await netMod.deliverCrossMessage(b14NetDeps, {
      fromSession: alphaRoot,
      fromLabel: 'Alpha',
      target: 'Beta',
      text: '跨窗口直接发给目标 lead',
      mode: 'followup',
    })
    assert.equal(remotePeerLeadRes.ok, true)
    assert.equal(remotePeerLeadRes.resolvedAgentId, betaRoot)
    assert.equal(remotePeerLeadRes.targetKind, 'peer-session')
    assert.equal(remotePeerLeadRes.crossSession, true)
    assert.equal(betaLeadFollowups, 1)

    const b14RenderOut = toolsMod.createModelTools({ hostState: b14HostState }).boardTool(b14Runtime).output.render({}, {
      ok: true,
      mailDelivered: {
        target: 'Beta',
        mode: 'agent-followup',
        resolvedAgentId: betaRoot,
        resolvedVia: 'agents.get:agent-followup',
        targetKind: 'peer-session',
        crossSession: true,
      },
    })
    const b14RenderStr = Array.isArray(b14RenderOut) ? (b14RenderOut[0]?.text || '') : String(b14RenderOut || '')
    assert.ok(b14RenderStr.includes('[peer-session, cross-session]'), `B14.3 boardTool render must include targetKind tag, got: ${b14RenderStr}`)

    // B14.4: Full runtime-hooks activeAutoContinue end-to-end verification
    const b14HookLead = 'sess-b14-hook-lead'
    const b14HookChild = 'sess-b14-hook-child'
    let hookChildWoken = 0
    const hookAgents = new Map([
      [b14HookLead, { id: b14HookLead, status: 'idle', session: { id: b14HookLead, header: { title: 'HookLead', cwd: wsDirA } }, followup: () => {} }],
      [b14HookChild, { id: b14HookChild, parentId: b14HookLead, name: 'agent-1', status: 'inactive', session: { id: b14HookChild, header: { cwd: wsDirA } }, followup: () => { hookChildWoken += 1 } }],
    ])
    const hookBus = {
      hostState: {
        activeRuntime: null,
        activeLlm: null,
        activeAutoContinue: null,
        autoSteeredTurns: new Map(),
        subagentRootMap: new Map([[b14HookChild, b14HookLead]]),
        subagentTreeCache: new Map(),
        handoffSeq: 0,
      },
    }
    Object.assign(hookBus, storeMod.createBoardStore(hookBus))
    Object.assign(hookBus, subagentMod.createSubagentRuntime(hookBus))
    Object.assign(hookBus, actionsMod.createBoardActions(hookBus))
    Object.assign(hookBus, toolsMod.createModelTools(hookBus))
    Object.assign(hookBus, routesMod.createApiRoutes(hookBus))
    Object.assign(hookBus, hooksMod.createRuntimeHooks(hookBus))

    const hookCleanups = []
    const hookCtx = {
      get(name) {
        if (name === 'agents') return { get: (id) => hookAgents.get(String(id || '')) || null, list: () => [...hookAgents.values()] }
        if (name === 'sessionController') return { resolveAgent: async (sid) => (hookAgents.has(sid) ? { agent: hookAgents.get(sid) } : null) }
        if (name === 'workingDirectory') return { defaultDirectory: wsDirA, get: () => wsDirA }
        if (name === 'workspaceRegistry') return { list: () => [{ id: 'ws-b14-hook', path: wsDirA, sessionIds: [b14HookLead], updatedAt: Date.now() }], archivedSessionIds: [] }
        if (name === 'subagents') {
          return {
            rootOf: (ag) => (ag && ag.parentId ? (hookAgents.get(ag.parentId) || { id: ag.parentId }) : ag),
            namesOf: (ag) => (ag && ag.parentId ? { self: 'agent-1', parent: 'lead' } : { self: 'lead', parent: '' }),
            listDescendants: async (rid) => (rid === b14HookLead ? [{ id: b14HookChild, parentId: b14HookLead, name: 'agent-1', path: 'agent-1', mode: 'continuable' }] : []),
            resolveName: async () => b14HookChild,
          }
        }
        return null
      },
      inject: () => {},
      on: () => () => {},
      effect: (fn) => {
        const d = fn()
        if (typeof d === 'function') hookCleanups.push(d)
      },
    }
    hookBus.apply(hookCtx)
    const hookAc = hookBus.hostState.activeAutoContinue
    assert.ok(hookAc, 'B14.4 activeAutoContinue must be wired by createRuntimeHooks.apply')

    stateMod.activateChiefSession(b14HookLead, { force: true })
    await stateMod.updateChiefConfig({
      session: b14HookLead,
      runMode: 'managed',
      confirmedAutoPilot: true,
      permissionMode: 'chief',
      confirmedChiefRisk: true,
    })
    hookBus.withBoardLock(hookBus.boardFileFor(b14HookLead), () => {
      const b = hookBus.loadBoard(hookBus.boardFileFor(b14HookLead))
      b.tasks.push(schemaMod.normalizeTask({ id: 't-b14-done', title: '子代理已完工任务', status: 'done', owner: 'agent-1', subagent: 'agent-1', session: b14HookChild }))
      hookBus.saveBoard(b, hookBus.boardFileFor(b14HookLead))
    })

    const doneChildFire = await hookAc.fireNow(b14HookChild, 'turn/end:interrupted', { detail: 'network hiccup' })
    assert.equal(doneChildFire.ok, false, 'B14.4 done child subagent must NOT be woken by auto-continue')
    assert.equal(doneChildFire.skipped, 'child-subagent-done')
    assert.equal(hookChildWoken, 0)

    hookAgents.get(b14HookChild).status = 'running'
    await hookBus.refreshSubagentTree(hookBus.hostState.activeRuntime, b14HookLead, hookBus.loadBoard(hookBus.boardFileFor(b14HookLead)))
    const leadWaitFire = await hookAc.fireNow(b14HookLead, 'turn/end:no-visible-output:silent')
    assert.equal(leadWaitFire.ok, false, 'B14.4 lead waiting on running child subagent must NOT fire silent auto-continue')
    assert.equal(leadWaitFire.skipped, 'waiting-running-subagent')

    hookAc.dispose()
    for (const d of hookCleanups) {
      try { d() } catch {}
    }

    console.log('[B14 PASS] Collab friction & guard regressions (auto-continue, idle-guard, cross-session disambiguation & hooks) verified')
  }

  // =========================================================================
  // B15: Peer Drop Recovery & Cross-Session Sync Gate
  // =========================================================================
  {
    const acMod = await import(modUrl('auto-continue.js'))
    const actionsMod = await import(modUrl('board-actions.js'))
    const toolsMod = await import(modUrl('model-tools.js'))
    const routesMod = await import(modUrl('api-routes.js'))
    const hooksMod = await import(modUrl('runtime-hooks.js'))

    // B15.1: Mid-turn dsh-chief-relay steer resets stale turnOutput/tools so subsequent silent end recovers
    const hSid = 'sess-b15-helper-ac'
    const ac15 = acMod.createAutoContinueEngine({
      getAgent: () => ({ id: hSid, status: 'idle', followup: () => {} }),
      resolveRootSessionId: (sid) => sid,
      isChiefStopped: () => false,
      baseDelayMs: 5000,
    })
    ac15.onSessionEvent({ id: hSid }, { type: 'turn/start', data: { turn: 1 } })
    ac15.onSessionEvent({ id: hSid }, { type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: '挑战原文已发出' } } })
    ac15.onSessionEvent({ id: hSid }, {
      type: 'tool/call',
      data: { turn: 1, id: 'tc-b15-1', name: 'chief_board', arguments: JSON.stringify({ action: 'mail.send', target: 'lead', text: 'challenge' }) },
    })
    const relayRes = ac15.onSessionEvent({ id: hSid }, {
      type: 'user/message',
      data: { id: 'msg-b15-relay', source: { kind: 'dsh-chief-relay', senderSessionId: 'sess-b15-peer-other' } },
    })
    assert.equal(relayRes?.action, 'incoming-relay-tracked', 'B15.1 incoming dsh-chief-relay must reset turn tracking')
    const afterSteerEnd = ac15.onSessionEvent({ id: hSid }, { type: 'turn/end', data: { turn: 1, reason: 'completed' } })
    assert.equal(afterSteerEnd?.action, 'silent-scheduled', 'B15.1 silent drop after mid-turn relay steer MUST schedule auto-continue')
    assert.equal(afterSteerEnd?.scheduled, true)
    ac15.dispose()

    // B15.2 & B15.3: Full runtime-hooks peer drop recovery, board-all-done exemptions & cross-session drop sync
    const leadB15 = 'sess-b15-main'
    const helperB15 = 'sess-b15-helper'
    let helperFollowups = 0
    const hookAgents15 = new Map([
      [leadB15, {
        id: leadB15,
        status: 'idle',
        session: { id: leadB15, header: { title: '出报告主会话', cwd: wsDirA } },
        followup: () => {},
      }],
      [helperB15, {
        id: helperB15,
        status: 'idle',
        session: { id: helperB15, header: { title: '辅助Test', cwd: wsDirA } },
        followup: () => { helperFollowups += 1 },
      }],
    ])
    const hookEvents15 = new Map()
    const hookCleanups15 = []
    const hookBus15 = {
      hostState: {
        activeRuntime: null,
        activeLlm: null,
        activeAutoContinue: null,
        autoSteeredTurns: new Map(),
        subagentRootMap: new Map(),
        subagentTreeCache: new Map(),
        dormantTitleCache: new Map(),
        detectedHarnessProviders: new Map(),
        activeBubbleRuns: new Map(),
        recentBubbleRuns: [],
        handoffSeq: 0,
      },
    }
    Object.assign(hookBus15, storeMod.createBoardStore(hookBus15))
    Object.assign(hookBus15, subagentMod.createSubagentRuntime(hookBus15))
    Object.assign(hookBus15, actionsMod.createBoardActions(hookBus15))
    Object.assign(hookBus15, toolsMod.createModelTools(hookBus15))
    Object.assign(hookBus15, routesMod.createApiRoutes(hookBus15))
    Object.assign(hookBus15, hooksMod.createRuntimeHooks(hookBus15))

    const hookCtx15 = {
      get(name) {
        if (name === 'agents') return { get: (id) => hookAgents15.get(String(id || '')) || null, list: () => [...hookAgents15.values()] }
        if (name === 'sessionController') return { resolveAgent: async (sid) => (hookAgents15.has(sid) ? { agent: hookAgents15.get(sid) } : null) }
        if (name === 'sessionTitle') return { get: (sess) => (sess && sess.header && sess.header.title ? { title: sess.header.title } : null) }
        if (name === 'workingDirectory') return { defaultDirectory: wsDirA, get: () => wsDirA }
        if (name === 'workspaceRegistry') return { list: () => [{ id: 'ws-b15', path: wsDirA, sessionIds: [leadB15, helperB15], updatedAt: Date.now() }], archivedSessionIds: [] }
        if (name === 'subagents') {
          return {
            rootOf: (ag) => ({ id: ag?.id || leadB15 }),
            namesOf: () => ({ self: 'lead', parent: '' }),
            listDescendants: async () => [],
            resolveName: async () => '',
          }
        }
        return null
      },
      inject: () => {},
      on: (ev, fn) => {
        hookEvents15.set(ev, fn)
        return () => hookEvents15.delete(ev)
      },
      effect: (fn) => {
        const d = fn()
        if (typeof d === 'function') hookCleanups15.push(d)
      },
    }
    hookBus15.apply(hookCtx15)
    const hookAc15 = hookBus15.hostState.activeAutoContinue
    const onSessEv15 = hookEvents15.get('session/event')
    assert.ok(hookAc15 && typeof onSessEv15 === 'function', 'B15 must wire activeAutoContinue & session/event listener')

    stateMod.activateChiefSession(leadB15, { force: true })
    stateMod.activateChiefSession(helperB15, { force: true })
    stateMod.setPeerLink(leadB15, helperB15, true)
    await stateMod.updateChiefConfig({
      session: helperB15,
      runMode: 'managed',
      confirmedAutoPilot: true,
      permissionMode: 'chief',
      confirmedChiefRisk: true,
    })

    const oldTs = Date.now() - 60_000
    hookBus15.withBoardLock(hookBus15.boardFileFor(helperB15), () => {
      const b = hookBus15.loadBoard(hookBus15.boardFileFor(helperB15))
      b.plan.push({ id: 'p-old', text: '旧已完成步骤', done: true })
      const doneTask = schemaMod.normalizeTask({ id: 't-old-done', title: '上一轮旧任务', status: 'done', owner: 'lead' })
      doneTask.updatedAt = oldTs
      b.tasks.push(doneTask)
      hookBus15.saveBoard(b, hookBus15.boardFileFor(helperB15))
    })

    const b15NetDeps = hookBus15.makeChiefDeps(hookBus15.hostState.activeRuntime)

    // B15.2a: Purely done board with NO new peer mail or fresh directive still skips as board-all-done
    const skipDoneRes = await hookAc15.fireNow(helperB15, 'turn/end:completed:silent')
    assert.equal(skipDoneRes.ok, false)
    assert.equal(skipDoneRes.skipped, 'board-all-done', 'B15.2a purely done board with no new work must keep board-all-done')

    // B15.2b: Unanswered incoming pair mail exempts board-all-done so helper auto-continues
    const peerReq1 = await netMod.deliverCrossMessage(b15NetDeps, {
      fromSession: leadB15,
      fromLabel: '出报告主会话',
      target: '辅助Test',
      text: '请核对青竹回归结果',
      mode: 'silent',
    })
    assert.equal(peerReq1.ok, true)
    const wakeByMailRes = await hookAc15.fireNow(helperB15, 'turn/end:completed:silent')
    assert.equal(wakeByMailRes.ok, true, `B15.2b unanswered incoming peer mail must exempt board-all-done, got ${JSON.stringify(wakeByMailRes)}`)
    assert.equal(helperFollowups, 1)

    // Reply clears unanswered status; fresh incoming directive after oldTs still exempts board-all-done
    await netMod.deliverCrossMessage(b15NetDeps, {
      fromSession: helperB15,
      fromLabel: '辅助Test',
      target: '出报告主会话',
      text: '已核对完毕 PASS',
      mode: 'silent',
    })
    assert.equal(netMod.hasUnansweredIncomingPeerMail(stateMod.loadChiefState(), helperB15), false, 'B15.2 reply must mark pair mail answered')
    onSessEv15({ id: helperB15 }, { type: 'turn/start', data: { turn: 2 } })
    onSessEv15({ id: helperB15 }, { type: 'user/message', data: { id: 'u-b15-fresh', source: { kind: 'user' } } })
    const wakeByFreshDir = await hookAc15.fireNow(helperB15, 'turn/end:completed:silent')
    assert.equal(wakeByFreshDir.ok, true, `B15.2c fresh user/relay directive after oldTs must exempt board-all-done, got ${JSON.stringify(wakeByFreshDir)}`)
    assert.equal(helperFollowups, 2)

    // B15.3: Peer drop sync + dedupe + directory/progress markers + turn/start auto-clear
    const peerReq2 = await netMod.deliverCrossMessage(b15NetDeps, {
      fromSession: leadB15,
      fromLabel: '出报告主会话',
      target: '辅助Test',
      text: '第二轮待复核结果',
      mode: 'silent',
    })
    assert.equal(peerReq2.ok, true)
    await stateMod.updateChiefConfig({
      session: helperB15,
      runMode: 'off',
      tacticalModes: { intervention: false },
    })

    onSessEv15({ id: helperB15 }, { type: 'turn/start', data: { turn: 3 } })
    onSessEv15({ id: helperB15 }, { type: 'turn/end', data: { turn: 3, reason: 'interrupted' } })
    // Duplicate abnormal end for same incoming mail must stay idempotent
    onSessEv15({ id: helperB15 }, { type: 'turn/end', data: { turn: 3, reason: { kind: 'error', error: { status: 401, code: 'UNAUTHORIZED', message: 'auth' } } } })

    const dropMails = (stateMod.loadChiefState().workspaces[leadB15]?.mailbox || []).filter(m =>
      m && String(m.broadcastId || '').startsWith(`peerdrop:${helperB15}:`),
    )
    assert.equal(dropMails.length, 1, 'B15.3 peer-drop sync must deliver exactly 1 idempotent notice per incoming mail')

    const dirB15 = await netMod.listPeerDirectory(b15NetDeps, leadB15)
    const droppedPeer = dirB15.targets.find(t => t.id === helperB15)
    assert.ok(droppedPeer && droppedPeer.interrupted === true && droppedPeer.dropReason, 'B15.3 listPeerDirectory must mark dropped peer interrupted')

    const progB15 = netMod.collectClusterPeerProgress(b15NetDeps, [leadB15, helperB15], leadB15)
    const droppedProg = progB15.find(p => p.rootId === helperB15)
    assert.ok(droppedProg && droppedProg.interrupted === true && droppedProg.progressSummary.includes('⚠️ 断流未恢复'), 'B15.3 collectClusterPeerProgress must include interrupted drop notice')

    const renderPeersOut = hookBus15.boardTool(hookBus15.hostState.activeRuntime).output.render({}, { ok: true, inbox: [], peers: dirB15.targets })
    const renderPeersStr = Array.isArray(renderPeersOut) ? (renderPeersOut[0]?.text || '') : String(renderPeersOut || '')
    assert.ok(renderPeersStr.includes('⚠️ interrupted'), 'B15.3 mail.inbox peers render must highlight interrupted peer')

    const leadInbox = netMod.readMailboxForAgent(b15NetDeps, { sessionId: leadB15, callerAgent: hookAgents15.get(leadB15) })
    assert.ok(leadInbox.some(m => m && String(m.text || '').includes('中途断流未恢复')), 'B15.3 waiting lead mail.inbox must contain peer-drop alert')

    // Recreate unread check via consumePreStepDelta (reset readBy on dropMail for pre-step assertion)
    stateMod.mutateChiefState((s) => {
      const m = (s.workspaces[leadB15]?.mailbox || []).find(x => x && x.id === dropMails[0].id)
      if (m) m.readBy = []
    })
    const leadDelta = await netMod.consumePreStepDelta(b15NetDeps, hookAgents15.get(leadB15))
    const leadDeltaTxt = Array.isArray(leadDelta?.content)
      ? leadDelta.content.map(c => c?.text || '').join('\n')
      : String(leadDelta?.text || '')
    assert.ok(leadDelta && leadDeltaTxt.includes('中途断流未恢复'), 'B15.3 consumePreStepDelta must inject peer-drop alert into waiting lead')

    // Turn/start on helper clears peerDropState automatically
    onSessEv15({ id: helperB15 }, { type: 'turn/start', data: { turn: 4 } })
    assert.equal(stateMod.loadChiefState().workspaces[helperB15]?.runtimeGuard?.peerDropState, null, 'B15.3 turn/start on recovered helper must clear peerDropState')
    const dirRecovered = await netMod.listPeerDirectory(b15NetDeps, leadB15)
    const recPeer = dirRecovered.targets.find(t => t.id === helperB15)
    assert.ok(recPeer && !recPeer.interrupted, 'B15.3 recovered peer must no longer show interrupted')

    hookAc15.dispose()
    for (const d of hookCleanups15) {
      try { d() } catch {}
    }

    console.log('[B15 PASS] Peer drop recovery (mid-turn steer reset, board-all-done exemption & cross-session drop sync) verified')
  }

  // =========================================================================
  // B16: Smart Compact pressure-tier hint, cooldown reschedule & 40%+ fallback
  // =========================================================================
  {
    const reviewMod = await import(modUrl('chief-review.js'))
    const actionsMod = await import(modUrl('board-actions.js'))
    const toolsMod = await import(modUrl('model-tools.js'))

    const bus16 = {
      hostState: {
        activeRuntime: null,
        activeLlm: null,
        activeAutoContinue: null,
        autoSteeredTurns: new Map(),
        subagentRootMap: new Map(),
        subagentTreeCache: new Map(),
        dormantTitleCache: new Map(),
        detectedHarnessProviders: new Map(),
        activeBubbleRuns: new Map(),
        recentBubbleRuns: [],
        handoffSeq: 0,
      },
    }
    Object.assign(bus16, storeMod.createBoardStore(bus16))
    Object.assign(bus16, subagentMod.createSubagentRuntime(bus16))
    Object.assign(bus16, actionsMod.createBoardActions(bus16))
    Object.assign(bus16, toolsMod.createModelTools(bus16))

    const mkMessages = (assistantText) => [
      { role: 'user', content: [{ type: 'text', text: '第 1 步排查已完成' }] },
      { role: 'assistant', content: [{ type: 'text', text: '收到，已完成初步检索' }] },
      { role: 'user', content: [{ type: 'text', text: '继续第 2 步核对并汇总' }] },
      { role: 'assistant', content: [{ type: 'text', text: assistantText }] },
    ]

    // B16.1: At 42% (54K/128K), smartUsageHint labels 中高压甜点区 & 40%+ high-pressure fallback fires even if LLM forgets shouldCompactNow
    const sidB16Mid = 'sess-b16-mid-compact'
    stateMod.activateChiefSession(sidB16Mid, { force: true })
    await stateMod.updateChiefConfig({
      session: sidB16Mid,
      permissionMode: 'chief',
      confirmedChiefRisk: true,
      runMode: 'patrol',
      tacticalModes: { autoCompact: true, smartCompact: true, intervention: false },
    })
    let compactCalls16 = 0
    const capturedPrompts16 = []
    const agentB16Mid = {
      id: sidB16Mid,
      status: 'idle',
      session: {
        deriveMessages: () => mkMessages('第 2 步全部核对完毕，核心结论如下：配置一致且检查通过。'),
      },
    }
    const depsB16Mid = {
      ...bus16.makeChiefDeps({ get: () => null }),
      getAgentStatus: () => 'idle',
      measureSessionTokens: async () => ({ totalTokens: 54_000, contextWindow: 128_000, seq: 60 }),
      compactSessionNow: async () => { compactCalls16 += 1; return { ok: true } },
      callLlmOverride: async (opts) => {
        capturedPrompts16.push(String(opts?.prompt || ''))
        return {
          ok: true,
          text: JSON.stringify({
            memoryChanges: [],
            boardOps: [],
            planAssessment: { stale: false, reason: '' },
            goalStatus: 'in_progress',
            hazardStop: { triggered: false },
            shouldIntervene: false,
            shouldCompactNow: false,
            compactReason: '',
            suggestions: [],
          }),
        }
      },
    }
    const res16Mid = await reviewMod.runTurnReview(depsB16Mid, { agent: agentB16Mid, sessionId: sidB16Mid, turn: 1 })
    assert.equal(res16Mid.ok, true)
    assert.equal(res16Mid.smartCompacted, true, 'B16.1 >=40% clean phase must trigger Smart Compact even when LLM omits shouldCompactNow')
    assert.equal(compactCalls16, 1, 'B16.1 compactSessionNow must be called once')
    assert.ok(capturedPrompts16[0] && capturedPrompts16[0].includes('中高压甜点区'), 'B16.1 smartUsageHint must expose 中高压甜点区 pressure tier at 42%')
    const ws16Mid = stateMod.loadChiefState({ forceDisk: true }).workspaces[sidB16Mid]
    assert.ok((ws16Mid.chat || []).some(c => c && String(c.text || '').includes('✦ 智选压缩')), 'B16.1 ws.chat must record ✦ 智选压缩 receipt')

    // B16.2a: <20% && <35K low-context guardrail still blocks compaction even if LLM requests shouldCompactNow: true
    const sidB16Low = 'sess-b16-low-suppress'
    stateMod.activateChiefSession(sidB16Low, { force: true })
    await stateMod.updateChiefConfig({
      session: sidB16Low,
      permissionMode: 'chief',
      confirmedChiefRisk: true,
      runMode: 'patrol',
      tacticalModes: { autoCompact: true, smartCompact: true, intervention: false },
    })
    let compactCallsLow = 0
    let lowPrompt = ''
    const res16Low = await reviewMod.runTurnReview({
      ...bus16.makeChiefDeps({ get: () => null }),
      getAgentStatus: () => 'idle',
      measureSessionTokens: async () => ({ totalTokens: 18_000, contextWindow: 128_000, seq: 12 }),
      compactSessionNow: async () => { compactCallsLow += 1; return { ok: true } },
      callLlmOverride: async (opts) => {
        lowPrompt = String(opts?.prompt || '')
        return {
          ok: true,
          text: JSON.stringify({
            memoryChanges: [],
            boardOps: [],
            planAssessment: { stale: false, reason: '' },
            goalStatus: 'in_progress',
            hazardStop: { triggered: false },
            shouldIntervene: false,
            shouldCompactNow: true,
            compactReason: '试探压缩',
            suggestions: [],
          }),
        }
      },
    }, {
      agent: { id: sidB16Low, status: 'idle', session: { deriveMessages: () => mkMessages('阶段完成，无异常。') } },
      sessionId: sidB16Low,
      turn: 1,
    })
    assert.equal(res16Low.smartCompacted, false, 'B16.2a <20% low context must remain suppressed')
    assert.equal(compactCallsLow, 0)
    assert.ok(lowPrompt.includes('轻载'), 'B16.2a smartUsageHint must expose 轻载 pressure tier at 14%')

    // B16.2b: Premature-promise stall still blocks Smart Compact fallback even at 45%
    const sidB16Stall = 'sess-b16-stall-suppress'
    stateMod.activateChiefSession(sidB16Stall, { force: true })
    await stateMod.updateChiefConfig({
      session: sidB16Stall,
      permissionMode: 'chief',
      confirmedChiefRisk: true,
      runMode: 'patrol',
      tacticalModes: { autoCompact: true, smartCompact: true, intervention: false },
    })
    bus16.withBoardLock(bus16.boardFileFor(sidB16Stall), () => {
      const b = bus16.loadBoard(bus16.boardFileFor(sidB16Stall))
      b.tasks = [schemaMod.normalizeTask({ id: 't-b16-open', title: '落实修改并验证', status: 'doing' })]
      bus16.saveBoard(b, bus16.boardFileFor(sidB16Stall))
    })
    let compactCallsStall = 0
    const res16Stall = await reviewMod.runTurnReview({
      ...bus16.makeChiefDeps({ get: () => null }),
      getAgentStatus: () => 'idle',
      measureSessionTokens: async () => ({ totalTokens: 58_000, contextWindow: 128_000, seq: 30 }),
      compactSessionNow: async () => { compactCallsStall += 1; return { ok: true } },
      callLlmOverride: async () => ({
        ok: true,
        text: JSON.stringify({
          memoryChanges: [],
          boardOps: [],
          planAssessment: { stale: false, reason: '' },
          goalStatus: 'in_progress',
          hazardStop: { triggered: false },
          shouldIntervene: false,
          shouldCompactNow: false,
          compactReason: '',
          suggestions: [],
        }),
      }),
    }, {
      agent: { id: sidB16Stall, status: 'idle', session: { deriveMessages: () => mkMessages('接下来开始验证并补充测试。') } },
      sessionId: sidB16Stall,
      turn: 1,
    })
    assert.equal(res16Stall.smartCompacted, false, 'B16.2b premature-promise stall must suppress 45% fallback compaction')
    assert.equal(compactCallsStall, 0)

    // B16.3: patrol + smartCompact cooldown must reschedule instead of silently dropping
    const res16Cooldown = await reviewMod.runTurnReview(depsB16Mid, {
      agent: {
        id: sidB16Mid,
        status: 'idle',
        session: { deriveMessages: () => mkMessages('紧接着又完成了一轮追加补充检查，输出全部通过。') },
      },
      sessionId: sidB16Mid,
      turn: 2,
    })
    assert.equal(res16Cooldown.ok, false)
    assert.equal(res16Cooldown.skipped, 'cooldown')
    assert.equal(res16Cooldown.rescheduled, true, 'B16.3 smartCompact in patrol mode must reschedule when hitting cooldown')
    await stateMod.updateChiefConfig({ session: sidB16Mid, stopped: true })
    reviewMod.scheduleChiefTurnReview(depsB16Mid, { sessionId: sidB16Mid, turn: 2 })

    console.log('[B16 PASS] Smart Compact pressure-tier hints, cooldown reschedule & 40%+ fallback + S9 guardrails verified')
  }

  // =========================================================================
  // B17: Chief short-term chat sliding window (anti-amnesia, receipt filtering & 6-turn cap)
  // =========================================================================
  {
    const cmdMod = await import(modUrl('chief-commands.js'))
    const actionsMod = await import(modUrl('board-actions.js'))
    const toolsMod = await import(modUrl('model-tools.js'))

    const bus17 = {
      hostState: {
        activeRuntime: null,
        activeLlm: null,
        activeAutoContinue: null,
        autoSteeredTurns: new Map(),
        subagentRootMap: new Map(),
        subagentTreeCache: new Map(),
        dormantTitleCache: new Map(),
        detectedHarnessProviders: new Map(),
        activeBubbleRuns: new Map(),
        recentBubbleRuns: [],
        handoffSeq: 0,
      },
    }
    Object.assign(bus17, storeMod.createBoardStore(bus17))
    Object.assign(bus17, subagentMod.createSubagentRuntime(bus17))
    Object.assign(bus17, actionsMod.createBoardActions(bus17))
    Object.assign(bus17, toolsMod.createModelTools(bus17))

    const sidB17 = 'sess-b17-short-mem'
    stateMod.activateChiefSession(sidB17, { force: true })
    await stateMod.updateChiefConfig({ session: sidB17, permissionMode: 'advisor' })

    stateMod.mutateChiefState((s) => {
      const ws = stateMod.ensureWorkspace(s, sidB17)
      ws.chat = [
        { id: 'c0u', role: 'user', text: '最老轮用户问：最早我们聊过什么？', at: 1 },
        { id: 'c0c', role: 'chief', text: '最老轮参谋答：那是很久以前的第一轮话题。', at: 2 },
        { id: 'c1u', role: 'user', text: '第1点方案怎么排期？', at: 3 },
        { id: 'c1c', role: 'chief', text: '建议三步：第一点先做接口鉴权，第二点是优先做缓存预热，第三点压测兜底。', at: 4 },
        { id: 'cr1', role: 'chief', kind: 'receipt', text: '- 【⚡ 强介入督导 · 第 1 轮】系统回执不应混入滑窗', at: 5 },
        { id: 'c2u', role: 'user', text: '接口鉴权用 JWT 还是 Session？', at: 6 },
        { id: 'c2c', role: 'chief', text: '按现有网关架构推荐无状态短 Token。', at: 7 },
        { id: 'cr2', role: 'chief', text: '- 【✦ 智选压缩】已先将本轮关键细节抢救入本会话档案柜（#arch-b17），并完成主对话静默压缩。', at: 8 },
        { id: 'c3u', role: 'user', text: '压测目标是多少 QPS？', at: 9 },
        { id: 'c3c', role: 'chief', text: '首阶段按 1500 QPS 设计，留足 2 倍冗余。', at: 10 },
        { id: 'c4u', role: 'user', text: '监控看哪些核心指标？', at: 11 },
        { id: 'c4c', role: 'chief', text: '重点盯 P99 延迟、缓存命中率与错峰重试队列长度。', at: 12 },
        { id: 'c5u', role: 'user', text: '上线前需要谁审核？', at: 13 },
        { id: 'c5c', role: 'chief', text: '由你最后点头即可上线。', at: 14 },
        { id: 'c6u', role: 'user', text: '好的先收下这几条建议。', at: 15 },
        { id: 'c6c', role: 'chief', text: '收到，随时追问哪一条我都接着讲。', at: 16 },
      ]
    })

    let capturedSys17 = ''
    let capturedPrompt17 = ''
    const deps17 = {
      ...bus17.makeChiefDeps({ get: () => null }),
      callLlmOverride: async (opts) => {
        capturedSys17 = String(opts?.system || '')
        capturedPrompt17 = String(opts?.prompt || '')
        return {
          ok: true,
          text: JSON.stringify({
            reply: '- 【结论】已接续前面说的第二点「优先做缓存预热」，建议分热点 key 预载与冷启动限流两步走。',
            toolCalls: [],
            relays: [],
            memoryChanges: [],
            boardOps: [],
          }),
        }
      },
    }

    const res17 = await cmdMod.askOrCommandChief(deps17, {
      sessionId: sidB17,
      text: '把你刚才说的第二点再展开讲讲',
    })
    assert.equal(res17.ok, true)
    assert.ok(capturedSys17.includes('短期对话衔接与防失忆'), 'B17 ASK_CHIEF_SYSTEM must guide anti-amnesia follow-up alignment')
    assert.ok(capturedPrompt17.includes('## 10. 您与参谋长最近几轮对话'), 'B17 prompt must include section 10 short-term chat window')
    assert.ok(capturedPrompt17.includes('第二点是优先做缓存预热'), 'B17 sliding window must preserve recent 6 turns context')
    assert.equal(capturedPrompt17.includes('系统回执不应混入滑窗'), false, 'B17 sliding window must filter kind=receipt entries')
    assert.equal(capturedPrompt17.includes('#arch-b17'), false, 'B17 sliding window must filter ✦ 智选压缩 system receipts')
    assert.equal(capturedPrompt17.includes('最老轮用户问'), false, 'B17 sliding window must evict turns older than 6 turns (12 entries)')

    const secStart = capturedPrompt17.indexOf('## 10. 您与参谋长最近几轮对话')
    const secEnd = capturedPrompt17.indexOf('## 用户刚刚对你说的话：')
    const secText = secStart >= 0 && secEnd > secStart ? capturedPrompt17.slice(secStart, secEnd) : ''
    assert.ok(secText.length > 0 && secText.length <= 3000, `B17 short-term chat window must stay compact (<=3000 chars), got ${secText.length}`)

    console.log('[B17 PASS] Chief short-term chat sliding window (anti-amnesia, receipt filtering & 6-turn cap) verified')
  }

  for (const fn of cleanups) {
    try { fn() } catch {}
  }

  console.log('\nALL V1.8.0 STRIPPED-BRAIN, NAMING, COLLAB 2.0 & ROUTING GATES PASSED (B1, B1.5, B6, B7, B10, B12, B13, B14, B15, B16, B17)')
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
}
