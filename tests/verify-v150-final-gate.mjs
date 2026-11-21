#!/usr/bin/env node
/**
 * verify-v150-final-gate.mjs
 *
 * Self-contained v1.5.0 release gate covering F1 ~ F9:
 *  - F1: Version alignment (1.5.0), client bundle selectors & frosted dream glass, zero stale dream wording, light-theme, responsive version chip & subagent-entry guards
 *  - F2: Part A Three-Tier Hook Visibility, "Who's Watching" status, & archive.pull / pull_global isolation
 *  - F3: Part A Cognitive Desktop (2400 Tokens / 6 Items) eviction budget & Dual-Channel L0-L3 gating
 *  - F4: Part B Orthogonal 4x3 Matrix (off/patrol/managed) & Managed Dream Roam (`runManagedDreamRoam`)
 *  - F5: Part B 5-Condition Auto-Sleep Guard (`checkAndStopIdleAutoPilot`)
 *  - F6: Part B Auto-Continue Dual-Mode (`patrol`/`managed`) & L3 Strong-Intervention One-Stop Runner
 *  - F7: Part C Model Capability Alignment, Adaptive Thinking Effort, Cross-Model Shifts & User Lock Veto (incl. NEW-EFF human-only gate)
 *  - F8: NEW-INQ Inquiry Replay Rejection (idempotent guard & audit preservation)
 *  - F9: Rare Blocker-Driven Guard-Wall Removal Request (all tiers require human approval), Consult Chief No-Force Mode & Lock/Intervention UX Fixes
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PKG = path.resolve(__dirname, '..')

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-v150-final-gate-'))
const dshHome = path.join(tmpRoot, 'dsh-home')
const chiefDataDir = path.join(tmpRoot, 'chief-data')
const wallsFile = path.join(tmpRoot, 'walls.json')
const workDir = path.join(tmpRoot, 'workspace')
fs.mkdirSync(dshHome, { recursive: true })
fs.mkdirSync(chiefDataDir, { recursive: true })
fs.mkdirSync(workDir, { recursive: true })

process.env.DSH_HOME = dshHome
process.env.DSH_CHIEF_DATA_DIR = chiefDataDir
process.env.DSH_CHIEF_WALLS_FILE = wallsFile

function modUrl(rel) {
  return pathToFileURL(path.join(PKG, rel)).href
}

function makeTestHarness({
  storeMod,
  subagentMod,
  actionsMod,
  toolsMod,
  routesMod,
  hooksMod,
  modelsMod,
}) {
  const hostState = {
    activeRuntime: null,
    activeLlm: null,
    activeAutoContinue: null,
    autoSteeredTurns: new Map(),
    subagentRootMap: new Map(),
    subagentTreeCache: new Map(),
    handoffSeq: 0,
  }

  const bus = { hostState }
  Object.assign(bus, storeMod.createBoardStore(bus))
  Object.assign(bus, subagentMod.createSubagentRuntime(bus))
  Object.assign(bus, actionsMod.createBoardActions(bus))
  Object.assign(bus, toolsMod.createModelTools(bus))
  Object.assign(bus, routesMod.createApiRoutes(bus))
  Object.assign(bus, hooksMod.createRuntimeHooks(bus))

  const agents = new Map()
  const deliveredMessages = []
  const compactedCalls = []
  const routes = new Map()
  const tools = new Map()
  const promptSections = []
  const eventHandlers = new Map()
  const cleanups = []
  let mockLlmObj = null
  let llmOverrideFn = null

  const ctrl = {
    selectModel: async ({ sessionId, provider, model, reasoningEffort }) => {
      const ag = agents.get(sessionId)
      if (!ag) return { ok: false, error: 'missing-agent' }
      if (ag.model && typeof ag.model.select === 'function') {
        await ag.model.select({ provider, model, reasoningEffort })
      }
      return { ok: true, provider, model, reasoningEffort }
    },
    resolveAgent: async (sid) => {
      const ag = agents.get(sid)
      return ag ? { agent: ag } : null
    },
    compact: async ({ sessionId }) => {
      compactedCalls.push(sessionId)
      return { ok: true, beforeTokens: 12000, afterTokens: 2000 }
    },
  }

  const runtime = {
    get(name) {
      return this[name] || null
    },
    workingDirectory: {
      defaultDirectory: workDir,
      get: (sess) => (sess && sess.header && sess.header.cwd) || workDir,
    },
    workspaceRegistry: {
      list: () => [{ id: 'ws-v150-gate', path: workDir, sessionIds: [...agents.keys()], updatedAt: Date.now() }],
      archivedSessionIds: [],
    },
    sessionController: ctrl,
    agents: {
      list: () => [...agents.values()],
      get: (sid) => agents.get(String(sid || '')) || null,
    },
    subagents: {
      rootOf: (ag) => (ag && ag.parentId ? (agents.get(ag.parentId) || { id: ag.parentId }) : ag),
      namesOf: (ag) => (ag && ag.parentId ? { self: ag.name || 'worker', parent: 'lead' } : { self: 'lead', parent: '' }),
      async listDescendants(rootId) {
        return [...agents.values()]
          .filter(a => a && a.parentId === rootId)
          .map(a => ({ id: a.id, parentId: rootId, path: a.name, name: a.name, label: a.name, mode: 'continuable' }))
      },
      async resolveName(leadAg, targetKey) {
        for (const [id, ag] of agents.entries()) {
          if (ag && ag.parentId === (leadAg && leadAg.id) && (ag.name === targetKey || id === targetKey)) {
            return id
          }
        }
        return ''
      },
      async sendMessage(_caller, targetId, blocks) {
        const text = Array.isArray(blocks) ? blocks.map(b => b.text || '').join('\n') : String(blocks || '')
        deliveredMessages.push({ to: targetId, kind: 'subagent.sendMessage', msg: { content: [{ type: 'text', text }] } })
        return `msg_sub_${deliveredMessages.length}`
      },
    },
    get llm() {
      return mockLlmObj
    },
    commands: {
      async execute(_ctx, cmd) {
        compactedCalls.push(cmd)
        return { commandId: `cmd-${compactedCalls.length}`, result: { kind: 'success', text: 'Compacted' } }
      },
    },
    webServer: {
      register(route) {
        routes.set(route.path, route.handler)
        return () => routes.delete(route.path)
      },
    },
    tools: {
      register(def) {
        tools.set(def.name, def)
        return () => tools.delete(def.name)
      },
    },
    systemPrompt: {
      section(def) {
        promptSections.push(def)
        return () => {}
      },
    },
  }

  const ctx = {
    get: (name) => runtime[name] || null,
    inject(_names, fn) {
      return fn({
        get: (name) => runtime.get(name),
        effect: (fn2) => {
          const d = typeof fn2 === 'function' ? fn2() : undefined
          if (typeof d === 'function') cleanups.push(d)
        },
        webServer: runtime.webServer,
        tools: runtime.tools,
        systemPrompt: runtime.systemPrompt,
        get llm() { return mockLlmObj },
      })
    },
    effect(fn) {
      const d = typeof fn === 'function' ? fn() : undefined
      if (typeof d === 'function') cleanups.push(d)
    },
    on(event, fn) {
      if (!eventHandlers.has(event)) eventHandlers.set(event, [])
      eventHandlers.get(event).push(fn)
      return () => {}
    },
  }

  bus.apply(ctx)

  const deps = {
    ...bus.makeChiefDeps(runtime),
    getLlm: () => mockLlmObj,
    readRecentTranscript: () => '[user] 继续推进测试\n[assistant] 已完成初步核验',
    buildTranscriptDigest: (sid) => `[user] 会话 ${sid} 刚刚结束一轮输出。`,
    compactSessionNow: async (sid) => {
      compactedCalls.push(sid)
      return { ok: true, beforeTokens: 12000, afterTokens: 2000 }
    },
    injectInto: async (sid, text, meta) => {
      deliveredMessages.push({ to: sid, text, meta, via: 'injectInto' })
      return { ok: true }
    },
  }

  function setCallLlmOverride(fn) {
    llmOverrideFn = typeof fn === 'function' ? fn : null
    if (llmOverrideFn) {
      deps.callLlmOverride = async (req) => llmOverrideFn(req)
    } else {
      delete deps.callLlmOverride
    }
  }

  function setMockLlm(llm) {
    mockLlmObj = llm
    hostState.activeLlm = llm
    modelsMod.invalidateChiefModelCatalog()
  }

  function registerMockAgent(id, { name = 'lead', parentId = '', modelRef = 'testprov/reasoner-x', status = 'idle', cwd = workDir } = {}) {
    let cur = {
      provider: modelRef.includes('/') ? modelRef.split('/')[0] : 'testprov',
      model: modelRef.includes('/') ? modelRef.split('/')[1] : modelRef,
      reasoningEffort: 'medium',
    }
    const pushDelivery = (kind, msg) => {
      deliveredMessages.push({ to: id, kind, msg })
      return true
    }
    const ag = {
      id,
      name,
      handle: name,
      parentId: parentId || undefined,
      cwd,
      status,
      model: {
        current: () => ({ ...cur }),
        select: async (next) => {
          cur = { ...cur, ...next }
        },
      },
      session: {
        providerId: cur.provider,
        modelId: cur.model,
        header: { cwd, config: { provider: cur.provider, model: cur.model } },
        requestHeader: () => ({ cwd, config: { provider: cur.provider, model: cur.model } }),
        deriveMessages: () => [
          { role: 'user', content: [{ type: 'text', text: '请推进当前任务并给出验证结果' }] },
          { role: 'assistant', content: [{ type: 'text', text: `会话 ${id} 已完成一轮检查。` }] },
        ],
        snapshotEvents: () => ([
          { type: 'user/message', data: { turn: 1, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '请检查进度' }] } },
          { type: 'assistant/message', data: { turn: 1, message: { role: 'assistant', content: [{ type: 'text', text: `会话 ${id} 一轮输出完成。` }] } } },
        ]),
      },
      inject: (msg) => pushDelivery('inject', msg),
      followup: (msg) => pushDelivery('followup', msg),
      steer: (msg) => pushDelivery('steer', msg),
      send: async (msg) => {
        pushDelivery('send', msg)
        return { ok: true, messageId: `msg_${deliveredMessages.length}` }
      },
      post: async (msg) => {
        pushDelivery('post', msg)
        return { ok: true, messageId: `msg_${deliveredMessages.length}` }
      },
    }
    agents.set(id, ag)
    if (parentId) hostState.subagentRootMap.set(id, parentId)
    return ag
  }

  function dispose() {
    for (const fn of cleanups) {
      try { fn() } catch {}
    }
    try { hostState.activeAutoContinue?.dispose?.() } catch {}
  }

  return {
    bus,
    deps,
    hostState,
    runtime,
    agents,
    deliveredMessages,
    compactedCalls,
    registerMockAgent,
    setCallLlmOverride,
    setMockLlm,
    dispose,
  }
}

let h = null
try {
  const pkgJson = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8'))
  const schemaMod = await import(modUrl('board-schema.js'))
  const constMod = await import(modUrl('src/client/constants.js'))
  const archivesMod = await import(modUrl('archives.js'))
  const digestMod = await import(modUrl('digest.js'))
  const storeMod = await import(modUrl('board-store.js'))
  const subagentMod = await import(modUrl('subagent-runtime.js'))
  const actionsMod = await import(modUrl('board-actions.js'))
  const toolsMod = await import(modUrl('model-tools.js'))
  const routesMod = await import(modUrl('api-routes.js'))
  const hooksMod = await import(modUrl('runtime-hooks.js'))
  const stateMod = await import(modUrl('chief-state.js'))
  const modelsMod = await import(modUrl('chief-models.js'))
  const chiefArchMod = await import(modUrl('chief-archives.js'))
  const cmdMod = await import(modUrl('chief-commands.js'))
  const apprMod = await import(modUrl('chief-approvals.js'))
  const reviewMod = await import(modUrl('chief-review.js'))
  const execMod = await import(modUrl('chief-executor.js'))

  // =========================================================================
  // F1: Version alignment, client selectors & frosted dream glass, 0 stale term
  // =========================================================================
  assert.match(String(pkgJson.version || ''), /^1\.[5-9]\.\d+/, 'F1 package.json version must be >= 1.5.0')
  assert.equal(schemaMod.BACKEND_BUILD, pkgJson.version, 'F1 board-schema BACKEND_BUILD must align with package.json')
  assert.equal(constMod.EXPECTED_BACKEND_BUILD, pkgJson.version, 'F1 constants EXPECTED_BACKEND_BUILD must align with package.json')

  const clientBundle = fs.readFileSync(path.join(PKG, 'client.js'), 'utf8')
  for (const needle of [
    '.dnb-paper-dossier',
    'dnb-desktop-zone',
    'data-tone="dream"',
    '梦境漫游',
    'dnb-run-mode-pill',
    'html[data-ds-theme-source="light"] .dnb-panel',
    '@container dnb-head',
    'dnb-obj-flash-red',
    'dnb-fan-gauge',
    'dnb-team-effort-row',
    'teamEffortMode',
    'agentLead',
    'agentSub',
    'consult_chief',
    'wall_removal',
    'dnb-chief-fx-hint',
    'setDismissedKey',
    'data-dismissed',
  ]) {
    assert.ok(clientBundle.includes(needle), `F1 client.js missing required v1.5.0 marker: ${needle}`)
  }
  for (const forbidden of [
    'dnb-fan-explain',
    'dnb-fan-auto-sweep',
    'dnb-tactical-grip',
  ]) {
    assert.equal(clientBundle.includes(forbidden), false, `F1 client.js must not contain removed selector/animation: ${forbidden}`)
  }
  assert.equal(
    clientBundle.includes('--dnb-popover: var(--dsw-alias-hovercard-bg'),
    false,
    'F1 client.js must not bind --dnb-popover to fixed-dark --dsw-alias-hovercard-bg (Issue #3)',
  )

  const clientStoreMod = await import(modUrl('src/client/store.js'))
  const prevHostCtx = clientStoreMod.runtimeRefs.hostCtx
  try {
    clientStoreMod.runtimeRefs.hostCtx = {
      get: (name) => name === 'sessions'
        ? { subagentAddress: (id) => (id === 'sub-gate-1' ? { parentSessionId: 'main-gate-1' } : undefined) }
        : null,
    }
    assert.equal(clientStoreMod.isSubagentSessionId('sub-gate-1'), true, 'F1 Issue #4 detects subagent sessionId')
    assert.equal(clientStoreMod.isSubagentSessionId('main-gate-1'), false, 'F1 Issue #4 allows lead sessionId')
  } finally {
    clientStoreMod.runtimeRefs.hostCtx = prevHostCtx
  }

  const staleDreamWord = '\u505a\u68a6'
  const scanFiles = []
  for (const name of fs.readdirSync(PKG)) {
    if (name.endsWith('.js')) scanFiles.push(path.join(PKG, name))
  }
  const clientDir = path.join(PKG, 'src', 'client')
  for (const walkEntry of fs.readdirSync(clientDir, { recursive: true })) {
    const p = path.join(clientDir, String(walkEntry))
    if (p.endsWith('.js') && fs.statSync(p).isFile()) scanFiles.push(p)
  }
  scanFiles.push(path.join(PKG, 'ARCHITECTURE.md'), path.join(PKG, 'CHANGELOG.md'))
  let staleCount = 0
  for (const fp of scanFiles) {
    const txt = fs.readFileSync(fp, 'utf8')
    if (txt.includes(staleDreamWord)) staleCount += 1
  }
  assert.equal(staleCount, 0, 'F1 stale dream term must appear 0 times across pkg code & docs')
  console.log('[F1 PASS] Version 1.5.0 aligned, client selectors/frosted glass present, 0 stale term hits')

  h = makeTestHarness({
    storeMod,
    subagentMod,
    actionsMod,
    toolsMod,
    routesMod,
    hooksMod,
    modelsMod,
  })

  // =========================================================================
  // F2: Three-Tier Hook Visibility, "Who's Watching", archive.pull & pull_global
  // =========================================================================
  const sidF2 = 'sess-f2-hooks'
  h.registerMockAgent(sidF2, { name: 'lead-f2', modelRef: 'testprov/reasoner-x' })

  const sessOpt = h.bus.archiveTarget(h.runtime, sidF2, { vaultScope: 'session' })
  const globOpt = h.bus.archiveTarget(h.runtime, sidF2, { vaultScope: 'global' })
  const coldProjectKey = archivesMod.resolveProjectKey(workDir)

  const sessDraft = archivesMod.mutateArchive({
    op: 'save',
    vaultScope: 'session',
    rootSessionId: sidF2,
    folder: 'inbox',
    title: 'F2 本局未整理草稿',
    summary: 'SECRET_SESSION_DRAFT_SUMMARY',
    body: 'SECRET_SESSION_DRAFT_BODY',
  }, sessOpt)
  assert.ok(sessDraft.ok && sessDraft.item.id, 'F2 create unhooked session draft')

  const globDraft = archivesMod.mutateArchive({
    op: 'save',
    vaultScope: 'global',
    rootSessionId: sidF2,
    folder: 'inbox',
    title: 'F2 全局未整理草稿',
    summary: 'SECRET_GLOBAL_DRAFT_SUMMARY',
    body: 'SECRET_GLOBAL_DRAFT_BODY',
  }, globOpt)
  assert.ok(globDraft.ok && globDraft.item.id, 'F2 create unhooked global draft')

  const coldSaved = archivesMod.savePrecipitatedEntry(coldProjectKey, {
    title: 'F2 冷藏机密经验',
    category: 'pitfalls',
    summary: 'SECRET_COLD_SUMMARY',
    body: 'SECRET_COLD_BODY',
  }, { ...sessOpt, projectKey: coldProjectKey })
  assert.ok(coldSaved.ok && coldSaved.entry.id, 'F2 create cold entry')

  // Unhooked checks:
  const ctxBefore = h.bus.collectDigestArchiveContext(h.runtime, sidF2)
  assert.ok(!('sessionArchiveBriefs' in ctxBefore), 'F2 sessionArchiveBriefs leak key must not exist')
  const digestBefore = digestMod.renderDigest(h.bus.boardForSession(h.bus.boardFileFor(sidF2)), ctxBefore)
  assert.ok(!digestBefore.includes('F2 本局未整理草稿') && !digestBefore.includes('SECRET_SESSION_DRAFT'), 'F2 unhooked session draft hidden from Lead digest')
  assert.ok(!digestBefore.includes('F2 全局未整理草稿') && !digestBefore.includes('SECRET_GLOBAL_DRAFT'), 'F2 unhooked global draft hidden from Lead digest')
  assert.ok(!digestBefore.includes('F2 冷藏机密经验') && !digestBefore.includes('SECRET_COLD'), 'F2 cold entry hidden from Lead digest')

  const chiefVisBefore = stateMod.collectChiefVisibleArchives(h.deps, sidF2, stateMod.loadChiefState())
  assert.ok(chiefVisBefore.sessionItems.some(it => it.id === sessDraft.item.id), 'F2 Chief can read unhooked session draft')
  assert.ok(!chiefVisBefore.globalHookIndex.some(it => it.id === globDraft.item.id), 'F2 unhooked global draft must be blind to Chief')
  assert.ok(!JSON.stringify(chiefVisBefore).includes('SECRET_COLD'), 'F2 cold entry must be 0-byte blind to Chief')

  const coldBlocked = await cmdMod.executeChiefArchiveInjectionOp(h.deps, sidF2, {
    op: 'pin_to_desktop',
    vaultScope: 'precipitated',
    id: coldSaved.entry.id,
  })
  assert.equal(coldBlocked.ok, false, 'F2 cold vault injection must fail')
  assert.equal(coldBlocked.blocked, true, 'F2 cold vault injection must report blocked=true')

  // Organize session + global via Chief (`organizeArchivesWithChief` with mocked LLM)
  h.setCallLlmOverride(async ({ prompt }) => {
    if (prompt.includes(sessDraft.item.id)) {
      return {
        ok: true,
        text: JSON.stringify({
          items: [{
            id: sessDraft.item.id,
            folder: 'contracts',
            summary: 'SESSION_HOOK_BODY_ONLY_ON_PULL',
            hookKeywords: ['鉴权', '协议钩子'],
            hookCue: '接口契约与错误码映射',
            points: [{ title: '契约约定', cue: '错误码规范', detail: 'SESSION_POINT_DETAIL_409' }],
          }],
        }),
      }
    }
    return {
      ok: true,
      text: JSON.stringify({
        items: [{
          id: globDraft.item.id,
          folder: 'ops',
          summary: 'GLOBAL_HOOK_SUMMARY',
          hookKeywords: ['多端口', '运维钩子'],
          hookCue: 'Windows 端口防冲突方案',
          points: [{ title: '端口规则', cue: '避免端口占用', detail: 'GLOBAL_DETAIL_PORT_LOCK' }],
        }],
      }),
    }
  })

  await stateMod.updateChiefConfig({ session: sidF2, permissionMode: 'assistant' })
  const orgSessRes = await chiefArchMod.organizeArchivesWithChief(h.deps, { sessionId: sidF2, vaultScope: 'session', ids: [sessDraft.item.id] })
  assert.ok(orgSessRes.ok && orgSessRes.updatedCount >= 1, 'F2 session archive organized with hook')
  const orgGlobRes = await chiefArchMod.organizeArchivesWithChief(h.deps, { sessionId: sidF2, vaultScope: 'global', ids: [globDraft.item.id] })
  assert.ok(orgGlobRes.ok && orgGlobRes.updatedCount >= 1, 'F2 global archive organized with hook')

  // Lead sees Session Hook in digest (WITHOUT full body), can archive.pull Session ID, DENIED on Global ID
  const ctxAfterOrg = h.bus.collectDigestArchiveContext(h.runtime, sidF2)
  const digestAfterOrg = digestMod.renderDigest(h.bus.boardForSession(h.bus.boardFileFor(sidF2)), ctxAfterOrg)
  assert.ok(digestAfterOrg.includes('F2 本局未整理草稿'), 'F2 Lead digest shows hooked session dossier title')
  assert.ok(digestAfterOrg.includes('#鉴权') || digestAfterOrg.includes('协议钩子'), 'F2 Lead digest shows session hook keywords')
  assert.ok(!digestAfterOrg.includes('SESSION_POINT_DETAIL_409') && !digestAfterOrg.includes('SECRET_SESSION_DRAFT_BODY'), 'F2 Lead digest hides unpulled session body')
  assert.ok(!digestAfterOrg.includes('F2 全局未整理草稿') && !digestAfterOrg.includes('GLOBAL_DETAIL_PORT_LOCK'), 'F2 Lead digest 0-byte blind to organized global dossier')

  const leadPullGlobal = h.bus.runAction({ action: 'archive.pull', vaultScope: 'global', id: globDraft.item.id, session: sidF2 })
  assert.equal(leadPullGlobal.ok, false, 'F2 Lead must be denied archive.pull on global vault')

  const leadPullGlobalById = h.bus.runAction({ action: 'archive.pull', id: globDraft.item.id, session: sidF2 })
  assert.equal(leadPullGlobalById.ok, false, 'F2 Lead archive.pull without vaultScope must still not find global ID')

  const leadPullSess = h.bus.runAction({ action: 'archive.pull', id: sessDraft.item.id, session: sidF2 })
  assert.ok(leadPullSess.ok && leadPullSess.archiveItem && leadPullSess.archiveItem.body.includes('SECRET_SESSION_DRAFT_BODY'), 'F2 Lead pulls session dossier body')

  const sessHdrAfterPull = archivesMod.listArchiveHeaders(sidF2, { vaultScope: 'session' }, sessOpt)
  const pulledRow = sessHdrAfterPull.items.find(x => x.id === sessDraft.item.id)
  assert.ok(pulledRow && pulledRow.leadPulled && pulledRow.viewerStatus && pulledRow.viewerStatus.label.includes('📖 主代理已拉阅'), 'F2 session dossier lights up 📖 主代理已拉阅 badge')

  // Chief sees Global Hook Index, pulls global into mountedGlobalItems (👁️ 参谋参阅中), Lead still 0-byte blind
  const chiefVisAfterOrg = stateMod.collectChiefVisibleArchives(h.deps, sidF2, stateMod.loadChiefState())
  assert.ok(chiefVisAfterOrg.globalHookIndex.some(x => x.id === globDraft.item.id), 'F2 Chief sees organized global hook index')
  assert.ok(!chiefVisAfterOrg.mountedGlobalItems.some(x => x.id === globDraft.item.id), 'F2 global detail not mounted before pull_global')

  const chiefPullGlob = await cmdMod.executeChiefArchiveInjectionOp(h.deps, sidF2, {
    op: 'pull_global',
    vaultScope: 'global',
    id: globDraft.item.id,
  })
  assert.ok(chiefPullGlob.ok, 'F2 Chief pull_global succeeds')
  const chiefVisAfterPull = stateMod.collectChiefVisibleArchives(h.deps, sidF2, stateMod.loadChiefState())
  assert.ok(chiefVisAfterPull.mountedGlobalItems.some(x => x.id === globDraft.item.id && String(x.body).includes('SECRET_GLOBAL_DRAFT_BODY')), 'F2 mountedGlobalItems carries pulled global body for Chief')
  const globHdrAfterPull = archivesMod.listArchiveHeaders(sidF2, { vaultScope: 'global' }, globOpt)
  const globRow = globHdrAfterPull.items.find(x => x.id === globDraft.item.id)
  assert.ok(globRow && globRow.chiefPulled && globRow.viewerStatus && globRow.viewerStatus.label.includes('👁️ 参谋参阅中'), 'F2 global dossier lights up 👁️ 参谋参阅中 badge')

  const digestStillBlind = digestMod.renderDigest(
    h.bus.boardForSession(h.bus.boardFileFor(sidF2)),
    h.bus.collectDigestArchiveContext(h.runtime, sidF2),
  )
  assert.ok(!digestStillBlind.includes('SECRET_GLOBAL_DRAFT_BODY') && !digestStillBlind.includes('F2 全局未整理草稿'), 'F2 Lead remains 0-byte blind after Chief pulls global')
  console.log('[F2 PASS] Three-tier hooks, status badges & Lead/Chief vault isolation verified')

  // =========================================================================
  // F3: Cognitive Desktop 2400 Tokens / 6 Items Budget & Dual-Channel L0-L3
  // =========================================================================
  const sidF3 = 'sess-f3-desktop'
  h.registerMockAgent(sidF3, { name: 'lead-f3' })
  const f3Opt = h.bus.archiveTarget(h.runtime, sidF3, { vaultScope: 'session' })
  const longText = 'TokenPressureLine '.repeat(95)
  const createdIds = []
  for (let i = 1; i <= 7; i += 1) {
    const sv = archivesMod.mutateArchive({
      op: 'save',
      vaultScope: 'session',
      rootSessionId: sidF3,
      folder: 'plans',
      title: `F3 桌面压测档-${i}`,
      summary: `摘要-${i}`,
      body: `第${i}份压测正文：` + (i <= 5 ? longText : '短正文'),
      paperclip: i === 1 ? 'copper' : 'gold',
      organizedBy: 'chief',
      hasHook: true,
      hookKeywords: [`F3KW${i}`],
      hookCue: `提示-${i}`,
    }, f3Opt)
    assert.ok(sv.ok, `F3 create item ${i}`)
    createdIds.push(sv.item.id)
    const pinRes = archivesMod.mutateArchive({
      op: 'pinToDesktop',
      vaultScope: 'session',
      rootSessionId: sidF3,
      id: sv.item.id,
      by: 'chief',
    }, f3Opt)
    assert.ok(pinRes.ok, `F3 pin item ${i}`)
  }
  const f3Headers = archivesMod.listArchiveHeaders(sidF3, { vaultScope: 'session' }, f3Opt)
  assert.ok(f3Headers.desktop.usedTokens <= 2400, `F3 desktop usedTokens (${f3Headers.desktop.usedTokens}) <= 2400`)
  assert.ok(f3Headers.desktop.pinnedDocuments.length >= 1 && f3Headers.desktop.pinnedDocuments.length <= 6, `F3 desktop count (${f3Headers.desktop.pinnedDocuments.length}) <= 6`)
  assert.ok(f3Headers.desktop.recentlyUnpinnedWatch.length >= 1, 'F3 evicted lower-priority item entered recentlyUnpinnedWatch')
  assert.ok(f3Headers.desktop.recentlyUnpinnedWatch.some(w => w.id === createdIds[0]), 'F3 copper priority item #1 evicted first')

  archivesMod.mutateArchive({ op: 'clearUnpinnedWatch', vaultScope: 'session', rootSessionId: sidF3 }, f3Opt)
  const f3ChannelDoc = archivesMod.mutateArchive({
    op: 'save',
    vaultScope: 'session',
    rootSessionId: sidF3,
    folder: 'contracts',
    title: 'F3 双通道靶标卷宗',
    summary: '双通道测试摘要',
    body: 'F3 双通道完整规范正文内容',
    organizedBy: 'chief',
    hasHook: true,
    hookKeywords: ['双通道', '门禁'],
    hookCue: 'L0-L3 注入测试',
    points: [{ title: '关键点', cue: '门禁验收', detail: 'F3_CHANNEL_POINT_DETAIL' }],
  }, f3Opt).item

  // L0 Advisor
  const deliveredBeforeF3 = h.deliveredMessages.length
  await stateMod.updateChiefConfig({ session: sidF3, permissionMode: 'advisor' })
  h.setCallLlmOverride(async () => ({
    ok: true,
    text: JSON.stringify({
      reply: 'L0 建议先摆上桌面或递送',
      archiveOps: [
        { op: 'pin_to_desktop', vaultScope: 'session', id: f3ChannelDoc.id },
        { op: 'deliver_to_lead', vaultScope: 'session', id: f3ChannelDoc.id, target: 'lead', instruction: 'L0测试递送' },
      ],
    }),
  }))
  const l0Ask = await cmdMod.askOrCommandChief(h.deps, { sessionId: sidF3, text: '把双通道靶标放桌面并递给主对话' })
  assert.ok(l0Ask.ok, 'F3 L0 ask succeeds')
  assert.equal(archivesMod.getArchiveDetail(f3ChannelDoc.id, sidF3, f3Opt).item.takenOut, false, 'F3 L0 pin_to_desktop does not mutate desktop')
  assert.equal(h.deliveredMessages.length, deliveredBeforeF3, 'F3 L0 deliver_to_lead sends 0 messages')
  assert.ok(l0Ask.view.suggestions.some(s => s.kind === 'archive_op' && s.status === 'pending'), 'F3 L0 creates archive_op suggestion')

  // L1 Assistant
  stateMod.mutateChiefState((st) => {
    stateMod.ensureWorkspace(st, sidF3).suggestions = []
  })
  await stateMod.updateChiefConfig({ session: sidF3, permissionMode: 'assistant' })
  const l1Ask = await cmdMod.askOrCommandChief(h.deps, { sessionId: sidF3, text: 'L1 再试一次双通道注入' })
  assert.ok(l1Ask.ok, 'F3 L1 ask succeeds')
  assert.equal(archivesMod.getArchiveDetail(f3ChannelDoc.id, sidF3, f3Opt).item.takenOut, false, 'F3 L1 pin_to_desktop does not mutate desktop')
  assert.equal(h.deliveredMessages.length, deliveredBeforeF3, 'F3 L1 deliver_to_lead sends 0 messages')
  assert.ok(l1Ask.view.suggestions.some(s => s.kind === 'archive_op' && s.status === 'pending'), 'F3 L1 creates archive_op suggestion')

  // L2 Strategist
  stateMod.mutateChiefState((st) => {
    const ws = stateMod.ensureWorkspace(st, sidF3)
    ws.suggestions = []
    ws.pendingApprovals = []
  })
  await stateMod.updateChiefConfig({ session: sidF3, permissionMode: 'strategist' })
  const l2Ask = await cmdMod.askOrCommandChief(h.deps, { sessionId: sidF3, text: 'L2 请申请注入双通道靶标' })
  assert.ok(l2Ask.ok, 'F3 L2 ask succeeds')
  const wsAfterL2 = stateMod.ensureWorkspace(stateMod.loadChiefState(), sidF3)
  const archApprovals = (wsAfterL2.pendingApprovals || []).filter(a => a && a.kind === 'archive_op' && a.status === 'pending')
  assert.equal(archApprovals.length, 2, 'F3 L2 queued 2 pendingApprovals for pin_to_desktop + deliver_to_lead')
  assert.ok((wsAfterL2.taskLedger || []).some(t => t.kind === 'approval_resume' && archApprovals.every(a => (t.pendingApprovalIds || []).includes(a.id))), 'F3 L2 created TaskLedger entries linked to archive_op approvals')
  assert.equal(h.deliveredMessages.length, deliveredBeforeF3, 'F3 L2 does not execute before approval')
  for (const apr of archApprovals) {
    const apRes = await apprMod.handleApprovalDecision(h.deps, { sessionId: sidF3, approvalId: apr.id, decision: 'approve' })
    assert.ok(apRes.ok, `F3 L2 approve ${apr.id}`)
  }
  assert.equal(archivesMod.getArchiveDetail(f3ChannelDoc.id, sidF3, f3Opt).item.takenOut, true, 'F3 L2 approve pins item to desktop')
  assert.ok(
    h.deliveredMessages.slice(deliveredBeforeF3).some(m => m.to === sidF3 && JSON.stringify(m.msg).includes('F3 双通道靶标卷宗')),
    'F3 L2 approve delivers Channel B envelope',
  )

  // L3 Chief direct Channel B without occupying desktop slot
  archivesMod.mutateArchive({ op: 'unpinFromDesktop', vaultScope: 'session', rootSessionId: sidF3, id: f3ChannelDoc.id }, f3Opt)
  const deliverCountBeforeL3 = h.deliveredMessages.length
  await stateMod.updateChiefConfig({
    session: sidF3,
    permissionMode: 'chief',
    confirmedChiefRisk: true,
  })
  h.setCallLlmOverride(async () => ({
    ok: true,
    text: JSON.stringify({
      reply: 'L3 直接通过通道 B 一次性递送给主对话',
      archiveOps: [
        { op: 'deliver_to_lead', vaultScope: 'session', id: f3ChannelDoc.id, target: 'lead', instruction: 'L3 专递' },
      ],
    }),
  }))
  const l3Ask = await cmdMod.askOrCommandChief(h.deps, { sessionId: sidF3, text: '直接给主对话专递 F3 双通道靶标' })
  assert.ok(l3Ask.ok, 'F3 L3 ask succeeds')
  assert.equal(h.deliveredMessages.length, deliverCountBeforeL3 + 1, 'F3 L3 deliver_to_lead executes immediately')
  const f3AfterL3 = archivesMod.getArchiveDetail(f3ChannelDoc.id, sidF3, f3Opt).item
  assert.equal(f3AfterL3.takenOut, false, 'F3 Channel B deliver_to_lead does not consume desktop slot')
  const f3RawAfterL3 = archivesMod.loadArchiveStore(f3Opt).items.find(x => x.id === f3ChannelDoc.id)
  assert.ok(f3RawAfterL3 && f3RawAfterL3.chiefDeliveredSessions.includes(sidF3), 'F3 Channel B records chiefDeliveredSessions')
  const f3HdrAfterL3 = archivesMod.listArchiveHeaders(sidF3, { vaultScope: 'session' }, f3Opt).items.find(x => x.id === f3ChannelDoc.id)
  assert.equal(f3HdrAfterL3.chiefDelivered, true, 'F3 Channel B lists chiefDelivered=true')
  console.log('[F3 PASS] Desktop 2400T/6 budget & Dual-Channel L0-L3 gates verified')

  // =========================================================================
  // F4: Orthogonal 4x3 Matrix & Managed Dream Roam (`runManagedDreamRoam`)
  // =========================================================================
  const sidF4 = 'sess-f4-matrix'
  const leadF4 = h.registerMockAgent(sidF4, { name: 'lead-f4' })
  let reviewLlmCount = 0
  h.setCallLlmOverride(async () => {
    reviewLlmCount += 1
    return {
      ok: true,
      text: JSON.stringify({
        memoryChanges: [],
        boardOps: [],
        planAssessment: { stale: false, reason: '' },
        goalStatus: 'in_progress',
        hazardStop: { triggered: false },
        shouldIntervene: false,
        suggestions: [],
      }),
    }
  })

  // off: 0 review LLM calls on normal or abnormal turn
  await stateMod.updateChiefConfig({ session: sidF4, runMode: 'off', tacticalModes: { autoCompact: false, smartCompact: false } })
  reviewMod.scheduleChiefTurnReview(h.deps, { agent: leadF4, sessionId: sidF4, turn: { ok: true } })
  const offRunRes = await reviewMod.runTurnReview(h.deps, { agent: leadF4, sessionId: sidF4, turn: { ok: true }, abnormalTrigger: 'guard_wall_blocked' })
  assert.equal(offRunRes.skipped, 'off', 'F4 runMode=off skips runTurnReview')
  assert.equal(reviewLlmCount, 0, 'F4 off mode triggers 0 review LLM calls')

  // patrol: normal turn does not wake; abnormal trigger wakes review
  await stateMod.updateChiefConfig({ session: sidF4, runMode: 'patrol' })
  const boardFileF4 = h.bus.boardFileFor(sidF4)
  h.bus.withBoardLock(boardFileF4, () => {
    const b = h.bus.loadBoard(boardFileF4)
    b.mode = 'free'
    h.bus.saveBoard(b, boardFileF4)
  })
  reviewMod.scheduleChiefTurnReview(h.deps, { agent: leadF4, sessionId: sidF4, turn: { ok: true } })
  const patrolRunNormal = await reviewMod.runTurnReview(h.deps, { agent: leadF4, sessionId: sidF4, turn: { ok: true } })
  assert.equal(patrolRunNormal.skipped, 'patrol-no-abnormal', 'F4 patrol normal turn skips runTurnReview')
  await new Promise(r => setTimeout(r, 80))
  assert.equal(reviewLlmCount, 0, 'F4 patrol normal turn consumes 0 background LLM calls')

  const patrolRunAbn = await reviewMod.runTurnReview(h.deps, { agent: leadF4, sessionId: sidF4, turn: { error: 'wall blocked' }, abnormalTrigger: 'guard_wall_blocked' })
  assert.ok(patrolRunAbn.ok && reviewLlmCount === 1, 'F4 patrol wakes immediately on abnormalTrigger')

  // managed + L1: Dream Roam weaves hooks & clears recentlyUnpinnedWatch without touching desktop or code
  const f4Opt = h.bus.archiveTarget(h.runtime, sidF4, { vaultScope: 'session' })
  const f4RawDoc = archivesMod.mutateArchive({
    op: 'save',
    vaultScope: 'session',
    rootSessionId: sidF4,
    folder: 'inbox',
    title: 'F4 待梦境漫游归档',
    summary: '未织钩子草稿',
    body: '梦境漫游需要将其分类到 contracts 并生成两个关键词钩子',
  }, f4Opt).item
  const f4WatchDoc = archivesMod.mutateArchive({
    op: 'save',
    vaultScope: 'session',
    rootSessionId: sidF4,
    folder: 'ops',
    title: 'F4 撤下桌面待随视卷宗',
    summary: '已织钩子',
    body: '撤下桌面后等待梦境漫游确认并清空 watch',
    organizedBy: 'chief',
    hasHook: true,
    hookKeywords: ['归位', '监测'],
    hookCue: '随视测试',
    points: [{ title: 'A', cue: 'B', detail: 'C' }, { title: 'D', cue: 'E', detail: 'F' }],
  }, f4Opt).item
  archivesMod.mutateArchive({ op: 'pinToDesktop', vaultScope: 'session', rootSessionId: sidF4, id: f4WatchDoc.id }, f4Opt)
  archivesMod.mutateArchive({ op: 'unpinFromDesktop', vaultScope: 'session', rootSessionId: sidF4, id: f4WatchDoc.id }, f4Opt)
  assert.ok(archivesMod.loadArchiveStore(f4Opt).recentlyUnpinnedWatch.length >= 1, 'F4 recentlyUnpinnedWatch seeded')

  let sawDreamTone = false
  h.setCallLlmOverride(async ({ reasonKind }) => {
    const activeWork = stateMod.getChiefActiveWork(sidF4)
    if (activeWork && activeWork.tone === 'dream' && String(activeWork.label || '').includes('梦境漫游')) {
      sawDreamTone = true
    }
    assert.equal(reasonKind, 'dream_roam', 'F4 dream roam must pass reasonKind=dream_roam for eco effort')
    return {
      ok: true,
      text: JSON.stringify({
        items: [{
          id: f4RawDoc.id,
          folder: 'contracts',
          summary: '漫游织钩完成',
          hookKeywords: ['漫游钩子', '零散归拢'],
          hookCue: '自动归档并织就钩子',
          points: [
            { title: '规则1', cue: '摘要1', detail: '细节1' },
            { title: '规则2', cue: '摘要2', detail: '细节2' },
          ],
        }],
      }),
    }
  })

  const cfgF4Managed = await stateMod.updateChiefConfig({
    session: sidF4,
    permissionMode: 'assistant',
    runMode: 'managed',
    confirmedAutoPilot: true,
  })
  assert.equal(cfgF4Managed.ok, true, `F4 enable managed mode: ${cfgF4Managed.error || ''}`)
  const msgCountBeforeDream = h.deliveredMessages.length
  const dreamRes = await chiefArchMod.runManagedDreamRoam(h.deps, { sessionId: sidF4 })
  assert.ok(dreamRes.ok && dreamRes.sessionProcessed >= 1, 'F4 managed Dream Roam processed raw dossier')
  assert.ok(sawDreamTone, 'F4 managed Dream Roam sets data-tone=dream with 梦境漫游 frosted-glass label')
  const f4RawAfter = archivesMod.getArchiveDetail(f4RawDoc.id, sidF4, f4Opt).item
  assert.equal(f4RawAfter.hasHook, true, 'F4 Dream Roam wove hooks on raw dossier')
  assert.equal(f4RawAfter.takenOut, false, 'F4 Dream Roam never pushes items to desktop unsolicited')
  assert.equal(archivesMod.loadArchiveStore(f4Opt).recentlyUnpinnedWatch.length, 0, 'F4 Dream Roam cleared recentlyUnpinnedWatch')
  assert.equal(h.deliveredMessages.length, msgCountBeforeDream, 'F4 Dream Roam injects 0 messages into Lead')
  console.log('[F4 PASS] Orthogonal runMode matrix & Managed 🌙 梦境漫游 verified')

  // =========================================================================
  // F5: 5-Condition Auto-Sleep Guard (`checkAndStopIdleAutoPilot`)
  // =========================================================================
  const sidF5 = 'sess-f5-sleep'
  const leadF5 = h.registerMockAgent(sidF5, { name: 'lead-f5', status: 'idle' })
  const cfgF5Init = await stateMod.updateChiefConfig({
    session: sidF5,
    runMode: 'managed',
    confirmedAutoPilot: true,
    managedIdleTimeoutMs: 50,
  })
  assert.equal(cfgF5Init.ok, true, `F5 enable managed mode: ${cfgF5Init.error || ''}`)
  const f5Opt = h.bus.archiveTarget(h.runtime, sidF5, { vaultScope: 'session' })
  const f5File = h.bus.boardFileFor(sidF5)
  const makeOldActivity = () => {
    stateMod.mutateChiefState((s) => {
      const ws = stateMod.ensureWorkspace(s, sidF5)
      ws.runtimeGuard.lastActivityAt = Date.now() - 5_000
      ws.runtimeGuard.autoPilotStartedAt = Date.now() - 5_000
    })
  }
  makeOldActivity()

  // Blocker 1: doing task
  h.bus.runAction({ action: 'task.add', session: sidF5, title: 'F5 Doing Task', status: 'doing' })
  const rDoing = await reviewMod.checkAndStopIdleAutoPilot(h.deps, sidF5, { allowStartupGrace: false })
  assert.equal(rDoing.reason, 'tasks-doing', `F5 sleep blocked by doing task, got: ${JSON.stringify(rDoing)}`)
  const b5 = h.bus.loadBoard(f5File)
  const taskDoneRes = h.bus.runAction({ action: 'task.update', session: sidF5, id: b5.tasks[0].id, status: 'done' })
  assert.equal(taskDoneRes.ok, true, 'F5 mark task done')

  // Blocker 2: pending approval
  stateMod.queueChiefApproval(sidF5, {
    category: 'main_workflow',
    operationLabel: 'F5 Test Approval',
    targetLabel: 'lead',
    reason: 'test',
    kind: 'relay',
    payload: { target: 'lead', text: 'noop' },
  })
  const rApr = await reviewMod.checkAndStopIdleAutoPilot(h.deps, sidF5, { allowStartupGrace: false })
  assert.equal(rApr.reason, 'pending-approvals', `F5 sleep blocked by pending approval, got: ${JSON.stringify(rApr)}`)
  stateMod.mutateChiefState((s) => { stateMod.ensureWorkspace(s, sidF5).pendingApprovals = [] })

  // Blocker 3: open inquiry
  stateMod.mutateChiefState((s) => {
    stateMod.enqueueChiefInquiryOnWs(stateMod.ensureWorkspace(s, sidF5), { target: 'lead', question: 'F5 open inquiry' })
  })
  const rInq = await reviewMod.checkAndStopIdleAutoPilot(h.deps, sidF5, { allowStartupGrace: false })
  assert.equal(rInq.reason, 'pending-inquiries', `F5 sleep blocked by open inquiry, got: ${JSON.stringify(rInq)}`)
  stateMod.mutateChiefState((s) => { stateMod.ensureWorkspace(s, sidF5).inquiries = [] })

  // Blocker 4: non-empty recentlyUnpinnedWatch
  const f5Doc = archivesMod.mutateArchive({
    op: 'save',
    vaultScope: 'session',
    rootSessionId: sidF5,
    title: 'F5 Watch Doc',
    body: 'watch',
    hasHook: true,
    organizedBy: 'chief',
  }, f5Opt).item
  archivesMod.mutateArchive({ op: 'pinToDesktop', vaultScope: 'session', rootSessionId: sidF5, id: f5Doc.id }, f5Opt)
  archivesMod.mutateArchive({ op: 'unpinFromDesktop', vaultScope: 'session', rootSessionId: sidF5, id: f5Doc.id }, f5Opt)
  const rWatch = await reviewMod.checkAndStopIdleAutoPilot(h.deps, sidF5, { allowStartupGrace: false })
  assert.equal(rWatch.reason, 'unpinned-watch-pending', `F5 sleep blocked by watch queue, got: ${JSON.stringify(rWatch)}`)
  archivesMod.mutateArchive({ op: 'clearUnpinnedWatch', vaultScope: 'session', rootSessionId: sidF5 }, f5Opt)

  // Blocker 5a: not yet timed out
  stateMod.mutateChiefState((s) => {
    const ws = stateMod.ensureWorkspace(s, sidF5)
    ws.runtimeGuard.lastActivityAt = Date.now()
    ws.runtimeGuard.autoPilotStartedAt = Date.now()
  })
  await stateMod.updateChiefConfig({ session: sidF5, managedIdleTimeoutMs: 600_000 })
  const rNotTimeout = await reviewMod.checkAndStopIdleAutoPilot(h.deps, sidF5, { allowStartupGrace: false })
  assert.equal(rNotTimeout.reason, 'idle-timeout-not-reached', `F5 sleep blocked before timeout, got: ${JSON.stringify(rNotTimeout)}`)

  // Blocker 5b: running session agent
  await stateMod.updateChiefConfig({ session: sidF5, managedIdleTimeoutMs: 50 })
  makeOldActivity()
  leadF5.status = 'running'
  const rRunning = await reviewMod.checkAndStopIdleAutoPilot(h.deps, sidF5, { allowStartupGrace: false })
  assert.equal(rRunning.reason, 'agent-running', `F5 sleep blocked while agent running, got: ${JSON.stringify(rRunning)}`)
  leadF5.status = 'idle'

  // All 5 conditions pass -> immediate sleep to runMode='off' + receipt
  makeOldActivity()
  const rSleepOk = await reviewMod.checkAndStopIdleAutoPilot(h.deps, sidF5, { allowStartupGrace: false })
  assert.equal(rSleepOk.stopped, true, `F5 all 5 conditions satisfied -> transitions managed to off, got: ${JSON.stringify(rSleepOk)}`)
  const stAfterSleep = stateMod.loadChiefState()
  assert.equal(stateMod.resolveWorkspaceConfig(stAfterSleep, sidF5).runMode, 'off', 'F5 runMode switched back to off')
  assert.ok(stateMod.ensureWorkspace(stAfterSleep, sidF5).chat.some(c => c && c.text.includes('🤖→⏸ 托管自动休眠')), 'F5 sleep receipt recorded')
  console.log('[F5 PASS] 5-condition Auto-Sleep Guard verified')

  // =========================================================================
  // F6: Auto continue Dual-Mode & L3+Intervention One-Stop Runner
  // =========================================================================
  const sidF6 = 'sess-f6-autocont'
  const leadF6 = h.registerMockAgent(sidF6, { name: 'lead-f6' })
  const acEngine = h.hostState.activeAutoContinue
  assert.ok(acEngine, 'F6 activeAutoContinue engine wired by bus.apply')

  // Off -> auto-continue blocked
  await stateMod.updateChiefConfig({ session: sidF6, runMode: 'off', permissionMode: 'chief', confirmedChiefRisk: true })
  const trigOff = await acEngine.fireNow(sidF6, 'turn/end:interrupted', { detail: 'stream aborted' })
  assert.equal(trigOff.ok, false, 'F6 auto-continue blocked in runMode=off')

  // Patrol + Forbidden bound -> blocked
  await stateMod.updateChiefConfig({ session: sidF6, runMode: 'patrol', permissionMode: 'chief', confirmedChiefRisk: true })
  h.bus.runAction({
    action: 'bounds.add',
    field: 'forbidden',
    item: '严禁执行 `DROP_DATABASE_PROD`',
    session: sidF6,
    _callerOrigin: 'human_ui',
    _humanConfirmToken: schemaMod.HUMAN_BOUNDS_CONFIRM_TOKEN,
  })
  const trigBound = await acEngine.fireNow(sidF6, 'turn/end:interrupted', { detail: '准备运行 DROP_DATABASE_PROD' })
  assert.equal(trigBound.ok, false, 'F6 auto-continue blocked when forbidden bound matches detail')

  // Patrol + L1 assistant -> blocked + creates suggestion
  await stateMod.updateChiefConfig({ session: sidF6, runMode: 'patrol', permissionMode: 'assistant' })
  const trigL1 = await acEngine.fireNow(sidF6, 'turn/end:interrupted', { detail: '正常测试断流恢复' })
  assert.equal(trigL1.ok, false, 'F6 L1 does not wake lead directly')
  assert.ok(stateMod.ensureWorkspace(stateMod.loadChiefState(), sidF6).suggestions.some(s => s.title.includes('主对话断流待手动续跑')), 'F6 L1 creates reconnect suggestion')

  // Managed + L2 strategist -> queues auto_continue approval card
  const cfgF6Mgd = await stateMod.updateChiefConfig({
    session: sidF6,
    runMode: 'managed',
    confirmedAutoPilot: true,
    permissionMode: 'strategist',
  })
  assert.equal(cfgF6Mgd.ok, true, `F6 enable managed mode: ${cfgF6Mgd.error || ''}`)
  const trigL2 = await acEngine.fireNow(sidF6, 'turn/end:interrupted', { detail: '正常断流申请L2续跑' })
  assert.equal(trigL2.ok, false, 'F6 L2 pauses awaiting approval')
  assert.ok(stateMod.ensureWorkspace(stateMod.loadChiefState(), sidF6).pendingApprovals.some(a => a.kind === 'auto_continue' && a.status === 'pending'), 'F6 L2 queues auto_continue approval')

  // Managed + L3 chief -> sends [EXECUTION_REQUEST #taskId] envelope
  const cfgF6L3 = await stateMod.updateChiefConfig({
    session: sidF6,
    runMode: 'managed',
    confirmedAutoPilot: true,
    permissionMode: 'chief',
    confirmedChiefRisk: true,
  })
  assert.equal(cfgF6L3.ok, true, `F6 enable L3 managed: ${cfgF6L3.error || ''}`)
  const msgBeforeCont = h.deliveredMessages.length
  const trigL3 = await acEngine.fireNow(sidF6, 'turn/end:interrupted', { detail: '正常断流L3自动恢复' })
  assert.ok(trigL3.ok, 'F6 L3 managed auto-continue dispatches envelope')
  assert.equal(h.deliveredMessages.length, msgBeforeCont + 1, 'F6 L3 sent 1 message to Lead')
  const sentObj = h.deliveredMessages[h.deliveredMessages.length - 1].msg
  const sentTxt = Array.isArray(sentObj?.content)
    ? sentObj.content.map(c => c.text || '').join('\n')
    : String(sentObj?.text || sentObj || '')
  assert.ok(/\[EXECUTION_REQUEST #[a-z0-9_-]+\]/i.test(sentTxt), `F6 L3 envelope carries [EXECUTION_REQUEST #taskId], got: ${sentTxt.slice(0, 80)}`)

  // L3 + Strong Intervention One-Stop Runner
  const f6Opt = h.bus.archiveTarget(h.runtime, sidF6, { vaultScope: 'session' })
  const f6Arch = archivesMod.mutateArchive({
    op: 'save',
    vaultScope: 'session',
    rootSessionId: sidF6,
    folder: 'plans',
    title: 'F6 一站式自动置顶档',
    body: 'Safe archive_op pending item',
    hasHook: true,
    organizedBy: 'chief',
  }, f6Opt).item
  stateMod.mutateChiefState((s) => {
    const ws = stateMod.ensureWorkspace(s, sidF6)
    ws.suggestions = [
      stateMod.normalizeSuggestion({
        kind: 'bound',
        title: 'F6 安全本局边界建议',
        boundField: 'allowed',
        draftText: 'F6 验证完成后写清回归摘要',
        pinGlobal: false,
      }),
      stateMod.normalizeSuggestion({
        kind: 'archive_op',
        title: 'F6 安全推桌面建议',
        archiveSpec: {
          op: 'pin_to_desktop',
          vaultScope: 'session',
          id: f6Arch.id,
          title: f6Arch.title,
        },
      }),
      stateMod.normalizeSuggestion({
        kind: 'guard_wall',
        title: 'F6 高危物理墙建议（应跳过）',
        draftText: '禁止修改 *.lock',
      }),
      stateMod.normalizeSuggestion({
        kind: 'goal_approval',
        title: 'F6 结项拍板（应跳过）',
      }),
      stateMod.normalizeSuggestion({
        kind: 'bound',
        title: 'F6 全局边界（应跳过）',
        boundField: 'forbidden',
        draftText: '全局禁令测试',
        pinGlobal: true,
      }),
    ].filter(Boolean)
  })
  const cfgF6Intv = await stateMod.updateChiefConfig({
    session: sidF6,
    permissionMode: 'chief',
    confirmedChiefRisk: true,
    runMode: 'managed',
    confirmedAutoPilot: true,
    tacticalModes: { intervention: true },
    confirmedInterventionRisk: true,
  })
  assert.equal(cfgF6Intv.ok, true, `F6 enable L3 + intervention: ${cfgF6Intv.error || ''}`)
  h.setCallLlmOverride(async () => ({
    ok: true,
    text: JSON.stringify({
      memoryChanges: [],
      boardOps: [],
      planAssessment: { stale: false, reason: '' },
      goalStatus: 'in_progress',
      hazardStop: { triggered: false },
      shouldIntervene: false,
      suggestions: [],
    }),
  }))
  const oneStopRes = await reviewMod.runTurnReview(h.deps, { agent: leadF6, sessionId: sidF6, turn: { ok: true }, force: true })
  assert.ok(oneStopRes.ok, 'F6 one-stop review succeeds')
  const wsF6After = stateMod.ensureWorkspace(stateMod.loadChiefState(), sidF6)
  const bF6After = h.bus.loadBoard(h.bus.boardFileFor(sidF6))
  assert.ok(bF6After.bounds.allowed.includes('F6 验证完成后写清回归摘要'), 'F6 one-stop executed safe session bound')
  assert.equal(archivesMod.getArchiveDetail(f6Arch.id, sidF6, f6Opt).item.takenOut, true, 'F6 one-stop executed safe archive_op')
  assert.ok(wsF6After.suggestions.some(s => s.kind === 'guard_wall' && s.status === 'pending'), 'F6 one-stop preserved pending guard_wall')
  assert.ok(wsF6After.suggestions.some(s => s.kind === 'goal_approval' && s.status === 'pending'), 'F6 one-stop preserved pending goal_approval')
  assert.ok(wsF6After.suggestions.some(s => s.kind === 'bound' && s.pinGlobal && s.status === 'pending'), 'F6 one-stop preserved pending pinGlobal bound')
  assert.ok(wsF6After.chat.some(c => c && c.isOneStopReport === true && c.text.includes('🏁 一站式战报回执')), 'F6 one-stop recorded 🏁 一站式战报回执')
  console.log('[F6 PASS] Auto continue dual-mode & L3+Intervention One-Stop Runner verified')

  // =========================================================================
  // F7: Capability Alignment, Adaptive Thinking Effort, Cross-Model Shifts & User Lock Veto
  // =========================================================================
  const sidF7 = 'sess-f7-effort'
  const leadF7 = h.registerMockAgent(sidF7, { name: 'lead-f7', modelRef: 'mockprov/non-reasoner' })
  const subF7 = h.registerMockAgent('sub-f7-coder', { name: 'coder', parentId: sidF7, modelRef: 'mockprov/reasoner-pro' })

  const seenRequests = []
  h.setCallLlmOverride(null) // Run REAL callChiefLlm -> llm.stream
  h.setMockLlm({
    listProviders: () => [{ id: 'mockprov', name: 'MockProvider' }],
    listModels: async () => [
      { provider: 'mockprov', id: 'non-reasoner', name: 'Non-Reasoner', reasoning: { efforts: [] } },
      { provider: 'mockprov', id: 'reasoner-pro', name: 'Reasoner Pro', reasoning: { efforts: ['low', 'medium', 'high', 'xhigh'] } },
    ],
    resolveModelInfo: async (_prov, model) => {
      if (model === 'non-reasoner') return { defaultMaxTokens: 4096, reasoning: { efforts: [] } }
      return { defaultMaxTokens: 8192, reasoning: { efforts: ['low', 'medium', 'high', 'xhigh'] } }
    },
    stream: async function* (request) {
      seenRequests.push({ ...request })
      yield { type: 'text', text: '{"reply":"来自真实 callChiefLlm 的响应"}' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  })

  await stateMod.updateChiefConfig({
    session: sidF7,
    modelRef: 'mockprov/non-reasoner',
    thinkingEffort: 'high',
    permissionMode: 'chief',
    confirmedChiefRisk: true,
  })
  const nonReasonCall = await modelsMod.callChiefLlm(h.deps, {
    sessionId: sidF7,
    system: 'test',
    prompt: 'hello',
    userText: 'hello',
    reasonKind: 'ask_chat',
  })
  assert.ok(nonReasonCall.ok, 'F7 non-reasoning model call succeeds')
  assert.equal(seenRequests[0].reasoningEffort, undefined, 'F7 non-reasoning model strips reasoningEffort from request')

  assert.equal(modelsMod.decideAdaptiveChiefEffort({ reasonKind: 'chat_summary' }), 'off', 'F7 chat_summary adaptive=off')
  assert.equal(modelsMod.decideAdaptiveChiefEffort({ reasonKind: 'dream_roam' }), 'off', 'F7 dream_roam adaptive=off')
  assert.equal(modelsMod.decideAdaptiveChiefEffort({ reasonKind: 'quick_status' }), 'off', 'F7 quick_status adaptive=off')
  assert.equal(modelsMod.decideAdaptiveChiefEffort({ reasonKind: 'craft_wall' }), 'high', 'F7 craft_wall adaptive=high')
  assert.equal(modelsMod.decideAdaptiveChiefEffort({ reasonKind: 'hazard_diagnosis' }), 'xhigh', 'F7 hazard_diagnosis adaptive=xhigh')

  await stateMod.updateChiefConfig({
    session: sidF7,
    modelRef: 'mockprov/reasoner-pro',
    thinkingEffort: 'auto',
  })
  const askBadgeRes = await cmdMod.askOrCommandChief(h.deps, {
    sessionId: sidF7,
    text: '请深度分析整个架构死锁的根因',
  })
  assert.ok(askBadgeRes.ok, 'F7 auto-effort ask succeeds on reasoning model')
  const latestReq = seenRequests[seenRequests.length - 1]
  assert.equal(latestReq.reasoningEffort, 'high', 'F7 deep analysis auto effort shifts to high')
  const wsF7Chat = stateMod.ensureWorkspace(stateMod.loadChiefState(), sidF7).chat
  assert.ok(wsF7Chat.some(c => c && c.role === 'chief' && c.thinkingEffort === 'high'), 'F7 ws.chat stamps thinkingEffort badge on Chief reply')

  // Non-reasoning Lead refused cleanly first while leadF7 is still mockprov/non-reasoner
  const leadNonReasonShift = await h.deps.controlMainAgent({
    rootId: sidF7,
    sessionId: sidF7,
    op: 'set_effort',
    target: 'lead',
    modelRef: 'mockprov/non-reasoner',
    reasoningEffort: 'xhigh',
    byUser: false,
  })
  assert.equal(leadNonReasonShift.ok, false, 'F7 set_effort refused on non-reasoning Lead')
  assert.equal(leadNonReasonShift.nonReasoningModel, true, 'F7 set_effort on non-reasoning Lead reports nonReasoningModel=true')

  // Switch Lead to reasoning model then verify hot effort shifts + 🔒 lock veto
  await leadF7.model.select({ provider: 'mockprov', model: 'reasoner-pro', reasoningEffort: 'medium' })
  const leadShift = await h.deps.controlMainAgent({
    rootId: sidF7,
    sessionId: sidF7,
    op: 'set_effort',
    target: 'lead',
    reasoningEffort: 'high',
    reason: 'F7 Lead 升级高思考',
    byUser: false,
  })
  assert.ok(leadShift.ok && leadF7.model.current().reasoningEffort === 'high', 'F7 Chief hot-shifted Lead reasoningEffort to high')

  const subShift = await h.deps.controlMainAgent({
    rootId: sidF7,
    sessionId: sidF7,
    op: 'set_effort',
    target: 'coder',
    reasoningEffort: 'low',
    reason: 'F7 子代理切轻量',
    byUser: false,
  })
  assert.ok(subShift.ok && subF7.model.current().reasoningEffort === 'low', 'F7 Chief hot-shifted subagent @coder reasoningEffort to low')

  const lockUnauthorized = await stateMod.updateChiefConfig({ session: sidF7, lockedModelEfforts: { lead: true } })
  assert.equal(lockUnauthorized.ok, false, 'F7 NEW-EFF rejects lock mutation without byUser / UI marker')
  assert.equal(lockUnauthorized.blocked, true, 'F7 NEW-EFF sets blocked=true on unauthorized lock attempt')
  assert.equal(lockUnauthorized.code, 'effort_lock_human_only', 'F7 NEW-EFF reports effort_lock_human_only code')

  const cfgF7Lock = await stateMod.updateChiefConfig({ session: sidF7, lockedModelEfforts: { lead: true }, byUser: true })
  assert.equal(cfgF7Lock.ok, true, `F7 lock Lead effort: ${cfgF7Lock.error || ''}`)
  assert.equal(stateMod.resolveWorkspaceConfig(stateMod.loadChiefState(), sidF7).lockedModelEfforts.lead, true, 'F7 Lead 🔒 lock active')

  const unlockBypassNoFlag = await stateMod.updateChiefConfig({ session: sidF7, lockedModelEfforts: { lead: false } })
  assert.equal(unlockBypassNoFlag.ok, false, 'F7 NEW-EFF blocks non-human unlock without byUser')
  const unlockBypassAdvisor = await stateMod.updateChiefConfig({ session: sidF7, lockedModelEfforts: { lead: false }, byUser: true, by: 'advisor' })
  assert.equal(unlockBypassAdvisor.ok, false, 'F7 NEW-EFF blocks advisor spoofed unlock even with byUser=true')
  assert.equal(stateMod.resolveWorkspaceConfig(stateMod.loadChiefState(), sidF7).lockedModelEfforts.lead, true, 'F7 Lead 🔒 lock remains intact after bypass attempts')

  const chiefLockOk = await stateMod.updateChiefConfig({
    session: sidF7,
    _fromUiPanel: true,
    toggleLockAgentEffort: { target: 'chief', locked: true },
  })
  assert.equal(chiefLockOk.ok, true, 'F7 UI panel toggleLockAgentEffort locks chief effort')
  assert.equal(stateMod.resolveWorkspaceConfig(stateMod.loadChiefState(), sidF7).lockedModelEfforts.chief, true, 'F7 chief 🔒 lock active')
  const nonHumanChiefShift = await stateMod.updateChiefConfig({ session: sidF7, thinkingEffort: 'low', by: 'strategist' })
  assert.equal(nonHumanChiefShift.ok, false, 'F7 NEW-EFF blocks non-human updateChiefConfig thinkingEffort when chief is locked')

  const blockedByLock = await h.deps.controlMainAgent({
    rootId: sidF7,
    sessionId: sidF7,
    op: 'set_effort',
    target: 'lead',
    reasoningEffort: 'low',
    byUser: false,
  })
  assert.equal(blockedByLock.ok, false, 'F7 locked Lead blocks Chief set_effort')
  assert.equal(blockedByLock.lockedByUser, true, 'F7 blocked response reports lockedByUser=true')
  const wsF7Audit = stateMod.ensureWorkspace(stateMod.loadChiefState(), sidF7).auditLog || []
  assert.ok(wsF7Audit.some(l => l && l.stage === 'model_effort_lock' && l.decision === 'blocked'), 'F7 lock block writes model_effort_lock audit log')

  const allowedForUser = await h.deps.controlMainAgent({
    rootId: sidF7,
    sessionId: sidF7,
    op: 'set_effort',
    target: 'lead',
    reasoningEffort: 'xhigh',
    byUser: true,
  })
  assert.ok(allowedForUser.ok && leadF7.model.current().reasoningEffort === 'xhigh', 'F7 user override (byUser=true) still works while 🔒 locked')

  // teamEffortMode ('auto' default vs 'manual' global human-only toggle)
  assert.equal(stateMod.resolveWorkspaceConfig(stateMod.loadChiefState(), sidF7).teamEffortMode, 'auto', 'F7 teamEffortMode defaults to auto')
  const unauthorizedTeamMode = await stateMod.updateChiefConfig({ session: sidF7, teamEffortMode: 'manual' })
  assert.equal(unauthorizedTeamMode.ok, false, 'F7 rejects non-human teamEffortMode mutation')
  assert.equal(unauthorizedTeamMode.code, 'effort_lock_human_only', 'F7 teamEffortMode mutation guarded by effort_lock_human_only')
  const manualTeamOk = await stateMod.updateChiefConfig({ session: sidF7, teamEffortMode: 'manual', byUser: true })
  assert.equal(manualTeamOk.ok, true, 'F7 human can switch teamEffortMode to manual')
  assert.equal(stateMod.resolveWorkspaceConfig(stateMod.loadChiefState(), sidF7).teamEffortMode, 'manual', 'F7 teamEffortMode persisted as manual')
  const blockedByManualTeam = await h.deps.controlMainAgent({
    rootId: sidF7,
    sessionId: sidF7,
    op: 'set_effort',
    target: 'coder',
    reasoningEffort: 'high',
    byUser: false,
  })
  assert.equal(blockedByManualTeam.ok, false, 'F7 manual teamEffortMode blocks Chief set_effort')
  assert.equal(blockedByManualTeam.manualMode, true, 'F7 blocked response reports manualMode=true')
  const autoTeamOk = await stateMod.updateChiefConfig({ session: sidF7, teamEffortMode: 'auto', byUser: true })
  assert.equal(autoTeamOk.ok, true, 'F7 human can switch teamEffortMode back to auto')
  const subAfterAuto = await h.deps.controlMainAgent({
    rootId: sidF7,
    sessionId: sidF7,
    op: 'set_effort',
    target: 'coder',
    reasoningEffort: 'high',
    byUser: false,
  })
  assert.ok(subAfterAuto.ok && subF7.model.current().reasoningEffort === 'high', 'F7 restoring teamEffortMode=auto allows Chief shift on unlocked subagent')
  console.log('[F7 PASS] Model capability alignment, adaptive effort, cross-model shifts, teamEffortMode & 🔒 user lock verified')

  // =========================================================================
  // F8: NEW-INQ Inquiry Reply Idempotent Replay Guard
  // =========================================================================
  const sidF8 = 'sess-f8-inquiry-replay'
  stateMod.mutateChiefState((st) => {
    const ws = stateMod.ensureWorkspace(st, sidF8)
    ws.inquiries = []
    ws.chat = []
    stateMod.enqueueChiefInquiryOnWs(ws, {
      inquiryId: 'inq-f8-gate',
      question: '请确认 F8 幂等防重放状态',
      target: 'lead',
      taskId: 'task-f8-1',
    })
  })
  const f8First = stateMod.answerChiefInquiry(sidF8, { inquiryId: 'inq-f8-gate', answer: '首次有效答复', by: 'lead' })
  assert.equal(f8First.ok, true, 'F8 first inquiry.reply succeeds')
  const wsF8Mid = stateMod.ensureWorkspace(stateMod.loadChiefState(), sidF8)
  const chatLenMid = wsF8Mid.chat.length
  const f8Replay = stateMod.answerChiefInquiry(sidF8, { inquiryId: 'inq-f8-gate', answer: '恶意重放篡改', by: 'lead' })
  assert.equal(f8Replay.ok, false, 'F8 NEW-INQ rejects replay on already-answered inquiry')
  assert.equal(f8Replay.alreadyAnswered, true, 'F8 NEW-INQ returns alreadyAnswered=true')
  assert.equal(f8Replay.code, 'inquiry_already_answered', 'F8 NEW-INQ returns inquiry_already_answered code')
  const wsF8After = stateMod.ensureWorkspace(stateMod.loadChiefState(), sidF8)
  assert.equal(wsF8After.inquiries[0].answer, '首次有效答复', 'F8 NEW-INQ preserves original answer without overwrite')
  assert.equal(wsF8After.chat.length, chatLenMid, 'F8 NEW-INQ does not emit duplicate receipt chat bubble')
  assert.ok(
    (wsF8After.auditLog || []).some(a => a && a.rule === 'inquiry_reply_replay_rejected' && a.decision === 'rejected'),
    'F8 NEW-INQ records inquiry_reply_replay_rejected audit entry',
  )
  console.log('[F8 PASS] Inquiry reply replay rejected idempotently with intact answer & audit')

  // =========================================================================
  // F9: Rare Blocker-Only Wall Removal Requests (L0-L3 Human Approval) & Consult Mode
  // =========================================================================
  const sidF9 = 'sess-f9-wall-removal'
  h.registerMockAgent(sidF9, { name: 'lead-f9', modelRef: 'mockprov/reasoner-pro' })
  const wallBuilt = execMod.mutateGuardWalls({
    op: 'save',
    wall: {
      title: 'F9 测试物理墙',
      scope: 'global',
      ruleType: 'forbid_path',
      patterns: ['f9-locked-dir/'],
      reason: 'F9 testing',
      source: 'user',
    },
    cwd: workDir,
    callerOrigin: 'human_ui',
    humanConfirmToken: execMod.HUMAN_BOUNDS_CONFIRM_TOKEN,
  })
  assert.ok(wallBuilt.ok && wallBuilt.wall && wallBuilt.wall.id, 'F9 fixture wall created')
  const f9WallId = wallBuilt.wall.id

  // 1) Spurious wallRemovalProposals WITHOUT real blocker evidence MUST be rejected (even in L3)
  await stateMod.updateChiefConfig({ session: sidF9, permissionMode: 'chief', confirmedChiefRisk: true })
  h.setCallLlmOverride(async () => ({
    ok: true,
    text: JSON.stringify({
      reply: '尝试无依据拆墙',
      wallRemovalProposals: [
        {
          wallId: f9WallId,
          wallTitle: 'F9 测试物理墙',
          action: 'pause',
          blockerEvidence: '无真实撞墙记录的臆测',
          reason: '无依据尝试',
        },
      ],
    }),
  }))
  const spuriousWr = await cmdMod.askOrCommandChief(h.deps, { sessionId: sidF9, text: '随便聊聊项目现状' })
  assert.equal((spuriousWr.wallRemovalProposals || []).length, 0, 'F9 rejects wallRemovalProposals when no blocker evidence exists')
  const wsF9NoEv = stateMod.ensureWorkspace(stateMod.loadChiefState(), sidF9)
  assert.ok(
    (wsF9NoEv.auditLog || []).some(a => a && a.rule === 'wall_removal_denied_no_blocker_evidence'),
    'F9 logs wall_removal_denied_no_blocker_evidence audit entry',
  )

  // 2) Lead reports insurmountable wall blocker via chief.request under L0 (advisor) -> Chief evaluates read-only & queues human-approval wall_removal
  await stateMod.updateChiefConfig({ session: sidF9, permissionMode: 'advisor' })
  h.setCallLlmOverride(async () => ({
    ok: true,
    text: JSON.stringify({
      reply: '已核实主代理撞上 F9 测试物理墙且无合法替代途径，已按规定提交人工拆墙审批申请。',
      wallRemovalProposals: [
        {
          wallId: f9WallId,
          wallTitle: 'F9 测试物理墙',
          action: 'pause',
          blockerEvidence: 'Lead 执行必须读取 f9-locked-dir/ 核对契约，无其他只读替代路径',
          reason: '确认撞墙阻塞关键任务，请人类批准暂挂此墙',
        },
      ],
    }),
  }))
  const escalatedWr = await cmdMod.handleLeadDirectRequestToChief(h.deps, {
    fromSession: sidF9,
    subject: '撞墙阻断上报',
    text: `被物理墙 ${f9WallId} 阻断，尝试替代方式均无法绕过，请参谋长评估是否可申请拆墙`,
  })
  assert.equal(escalatedWr.ok, true, 'F9 escalation succeeds under L0')
  assert.equal(escalatedWr.actionTaken, 'wall_removal_requested', 'F9 escalation returns wall_removal_requested under L0')
  assert.equal(escalatedWr.wallRemovalProposals.length, 1, 'F9 queues 1 pending wall_removal proposal')
  const wrSug = escalatedWr.wallRemovalProposals[0]
  assert.equal(wrSug.kind, 'wall_removal')
  assert.equal(execMod.listGuardWalls({ cwd: workDir }).find(w => w.id === f9WallId).scope, 'global', 'F9 wall stays active before human approval')

  // 3) Upgrade to L3 & verify Auto-Runner MUST skip wall_removal (human approval mandatory across all tiers)
  await stateMod.updateChiefConfig({ session: sidF9, permissionMode: 'chief', confirmedChiefRisk: true })
  const batchSkipWr = await apprMod.executeBatchSuggestions(h.deps, {
    sessionId: sidF9,
    ids: [wrSug.id],
    byAutoRunner: true,
  })
  assert.equal(batchSkipWr.executedCount, 0, 'F9 L3 auto-runner must NOT auto-execute wall_removal')
  assert.equal(execMod.listGuardWalls({ cwd: workDir }).find(w => w.id === f9WallId).scope, 'global', 'F9 wall still stays active after L3 auto-runner')

  // 4) Human explicitly approves wall_removal suggestion -> pauses target wall cleanly
  const humanApprWr = await apprMod.handleSuggestionDecision(h.deps, {
    sessionId: sidF9,
    suggestionId: wrSug.id,
    decision: 'approve',
    _byUserClick: true,
  })
  assert.ok(humanApprWr.ok && humanApprWr.wallRemoved && humanApprWr.wallRemoved.action === 'pause', 'F9 human approval pauses blocked wall')
  assert.equal(execMod.listGuardWalls({ cwd: workDir }).find(w => w.id === f9WallId).scope, 'paused', 'F9 wall is now paused after human confirmation')

  // 5) Consult mode: when Chief replies honestly with no actionable ops, NO forced suggestion cards are created
  const sugsBeforeConsult = stateMod.ensureWorkspace(stateMod.loadChiefState(), sidF9).suggestions.filter(s => s && s.status === 'pending').length
  h.setCallLlmOverride(async () => ({
    ok: true,
    text: JSON.stringify({
      reply: '当前分支均已稳妥收尾，暂无需额外干预建议；若涉及外部平台发版仍需由您本人操作。',
      relays: [],
      boardOps: [],
      archiveOps: [],
      boundProposals: [],
      wallProposals: [],
      effortOps: [],
    }),
  }))
  const consultOut = await cmdMod.askOrCommandChief(h.deps, {
    sessionId: sidF9,
    text: '给点建议',
    quickAction: 'consult_chief',
  })
  assert.equal(consultOut.ok, true, 'F9 consult_chief completes cleanly')
  const sugsAfterConsult = stateMod.ensureWorkspace(stateMod.loadChiefState(), sidF9).suggestions.filter(s => s && s.status === 'pending').length
  assert.equal(sugsAfterConsult, sugsBeforeConsult, 'F9 consult_chief with empty ops creates zero forced execution suggestions')

  console.log('[F9 PASS] Blocker-gated wall removal (L0-L3 human approval) & honest consult_chief verified')

  console.log('V150_FINAL_GATE OK (checks=F1-F9, mode=full, tempIsolated=true)')
} finally {
  try { h?.dispose?.() } catch {}
  fs.rmSync(tmpRoot, { recursive: true, force: true })
}
