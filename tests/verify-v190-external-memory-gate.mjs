#!/usr/bin/env node
/**
 * verify-v190-external-memory-gate.mjs
 *
 * Self-contained regression gate for Chief Memory Bridge (`dsh-chief.provider/v1`):
 *   - M1: Module invariants (files[] contains external-memory*.js, 27 HTTP routes, 0 child_process, client markers, 0 B1 forbidden words)
 *   - M2: Strict 0-byte @lead isolation (systemPrompt, renderDigest, agent/pre-step, zero plain-session activation)
 *   - M3: mcp-http connector E2E (initialize, mcp-session-id, tools/list auto-discovery, prefetch, async sync, secret egress scrub)
 *   - M4: chief-http dual-slot + KV Cache static/dynamic split + trivial query gate + work-mode mood mute + numeric-blind uiBadge
 *   - M5: markdown-vault read-only bilingual BM25 recall without touching source files
 *   - M6: cordis-provider (`ctx.provide('chiefMemoryHost')`) + workspace `read-only` & `disabled` policies
 *   - M7: Hard timeout + 3-failure circuit breaker silent degradation
 *   - M8: pre-compress / dream hooks + `/chief/fact` `ext_mem.*` ops + authToken redaction in `/snapshot` & `/chief/view`
 */

import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PKG = path.resolve(__dirname, '..')

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-v190-extmem-'))
const dshHome = path.join(tmpRoot, 'dsh-home')
const chiefDataDir = path.join(tmpRoot, 'chief-data')
const wsDir = path.join(tmpRoot, 'workspace-main')
const vaultDir = path.join(tmpRoot, 'obsidian-vault')
fs.mkdirSync(dshHome, { recursive: true })
fs.mkdirSync(chiefDataDir, { recursive: true })
fs.mkdirSync(wsDir, { recursive: true })
fs.mkdirSync(vaultDir, { recursive: true })

process.env.DSH_HOME = dshHome
process.env.DSH_CHIEF_DATA_DIR = chiefDataDir
process.env.DSH_CHIEF_WALLS_FILE = path.join(tmpRoot, 'walls.json')

function modUrl(rel) {
  return pathToFileURL(path.join(PKG, rel)).href
}

// Local dual-protocol mock server (MCP Streamable HTTP at /mcp + chief-http at /http-mem & /http-mood & /slow)
const mcpRequests = []
const mcpStored = []
const mcpDeleted = []
const httpMemLog = { prefetch: [], sync: [], preCompress: [], dream: [], retract: [] }
const httpMoodLog = { prefetch: [], sync: [] }
let failSlowMode = true

const server = http.createServer(async (req, res) => {
  const chunks = []
  for await (const ch of req) chunks.push(ch)
  const raw = Buffer.concat(chunks).toString('utf8')
  const body = raw.trim() ? JSON.parse(raw) : {}
  const url = req.url || '/'

  if (url.startsWith('/slow')) {
    if (failSlowMode) {
      await new Promise(r => setTimeout(r, 1500))
      res.statusCode = 500
      res.end(JSON.stringify({ error: 'simulated slow failure' }))
      return
    }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ promptText: 'recovered', items: [] }))
    return
  }

  if (url === '/mcp') {
    mcpRequests.push({ method: body.method, headers: req.headers, params: body.params })
    if (body.method === 'initialize') {
      res.setHeader('content-type', 'application/json')
      res.setHeader('mcp-session-id', 'mock-mcp-sess-1')
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        result: { protocolVersion: '2024-11-05', serverInfo: { name: 'mock-unified-memory', version: '1.0.0' }, capabilities: { tools: {} } },
      }))
      return
    }
    if (body.method === 'notifications/initialized') {
      res.statusCode = 202
      res.end('')
      return
    }
    if (body.method === 'tools/list') {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          tools: [
            {
              name: 'memory_search',
              inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' }, project: { type: 'string' } } },
            },
            {
              name: 'memory_propose',
              inputSchema: { type: 'object', properties: { content: { type: 'string' }, kind: { type: 'string' }, scope: { type: 'string' }, project: { type: 'string' }, source: { type: 'string' } } },
            },
            {
              name: 'memory_forget',
              inputSchema: { type: 'object', properties: { id: { type: 'string' }, reason: { type: 'string' } } },
            },
          ],
        },
      }))
      return
    }
    if (body.method === 'tools/call') {
      const tName = body.params && body.params.name
      const args = (body.params && body.params.arguments) || {}
      res.setHeader('content-type', 'application/json')
      if (tName === 'memory_search') {
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            content: [{
              type: 'text',
              text: JSON.stringify([
                { id: 'mcp-mem-1', title: '统一记忆架构约束', content: 'EXT_SECRET_MCP_TOKEN_9981：用户要求参谋外部记忆绝不能污染主对话。', kind: 'decision', scope: 'project', source: 'unified-memory', score: 0.96 },
              ]),
            }],
          },
        }))
        return
      }
      if (tName === 'memory_propose') {
        mcpStored.push(args)
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: { content: [{ type: 'text', text: JSON.stringify({ id: 'mcp-new-1', status: 'candidate' }) }] },
        }))
        return
      }
      if (tName === 'memory_forget') {
        mcpDeleted.push(args.id)
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: { content: [{ type: 'text', text: JSON.stringify({ ok: true, id: args.id }) }] },
        }))
        return
      }
    }
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'unknown mcp method' }))
    return
  }

  if (url === '/v1/embeddings') {
    const arr = Array.isArray(body.input) ? body.input : [String(body.input || '')]
    const data = arr.map((txt, idx) => {
      const s = String(txt || '')
      const semHit = /(?:大白话|通俗|精简|简洁|plain|jargon|语义匹配测试)/i.test(s) ? 1.0 : 0.05
      const otherHit = /(?:部署|数据库|sqlite|mysql)/i.test(s) ? 1.0 : 0.05
      return {
        index: idx,
        embedding: [semHit, otherHit, 0.1, 0.2],
      }
    })
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ object: 'list', data, model: body.model || 'mock-emb' }))
    return
  }

  if (url.startsWith('/http-mem/')) {
    res.setHeader('content-type', 'application/json')
    if (url === '/http-mem/health') {
      res.end(JSON.stringify({ ok: true, name: 'mock-http-mem' }))
      return
    }
    if (url === '/http-mem/prefetch') {
      httpMemLog.prefetch.push(body)
      res.end(JSON.stringify({
        promptText: 'HTTP_MEM_MARKER_7741：上次确认优先保护 KV Cache 命中率。',
        items: [{ id: 'hm-1', title: 'KV Cache 原则', preview: '静态前置、动态后置', evidence: 'observed', source: 'chief-http' }],
      }))
      return
    }
    if (url === '/http-mem/sync') {
      httpMemLog.sync.push(body)
      res.end(JSON.stringify({ ok: true }))
      return
    }
    if (url === '/http-mem/pre-compress') {
      httpMemLog.preCompress.push(body)
      res.end(JSON.stringify({ ok: true }))
      return
    }
    if (url === '/http-mem/dream') {
      httpMemLog.dream.push(body)
      res.end(JSON.stringify({ ok: true }))
      return
    }
    if (url === '/http-mem/retract') {
      httpMemLog.retract.push(body)
      res.end(JSON.stringify({ ok: true }))
      return
    }
  }

  if (url.startsWith('/http-mood/')) {
    res.setHeader('content-type', 'application/json')
    if (url === '/http-mood/health') {
      res.end(JSON.stringify({ ok: true }))
      return
    }
    if (url === '/http-mood/prefetch') {
      httpMoodLog.prefetch.push(body)
      res.end(JSON.stringify({
        promptText: 'MOOD_PROMPT_TEXT_ONLY：今天沟通节奏稳健从容，适合娓娓道来。score=88',
        uiBadge: { glyph: '✨', text: 'UI_BADGE_NUMERIC_SECRET_99', detail: 'affection=99, energy=72' },
      }))
      return
    }
    if (url === '/http-mood/sync') {
      httpMoodLog.sync.push(body)
      res.end(JSON.stringify({ ok: true }))
      return
    }
  }

  res.statusCode = 404
  res.end('{}')
})

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const baseUrl = `http://127.0.0.1:${port}`

const cleanups = []

try {
  // =========================================================================
  // M1: Module invariants & client markers
  // =========================================================================
  const pkgJson = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8'))
  assert.ok(pkgJson.files.includes('external-memory.js'), 'M1 files[] must include external-memory.js')
  assert.ok(pkgJson.files.includes('external-memory-connectors.js'), 'M1 files[] must include external-memory-connectors.js')

  for (const rel of ['external-memory.js', 'external-memory-connectors.js']) {
    const src = fs.readFileSync(path.join(PKG, rel), 'utf8')
    assert.equal(/(?:from|import\s*\(|require\s*\()\s*['"](?:node:)?child_process['"]/.test(src), false, `M1 ${rel} must not import child_process`)
  }
  const clientBundle = fs.readFileSync(path.join(PKG, 'client.js'), 'utf8')
  for (const needle of ['ExternalMemoryTab', 'extmem', 'probeExternalMemoryApi', 'retractExternalMemoryApi', 'ext_mem.probe']) {
    assert.ok(clientBundle.includes(needle), `M1 client.js missing marker: ${needle}`)
  }
  for (const forbidden of ['PrivateBrainPage', 'dnb-brain-page', 'dnb-brain-graph-svg', 'brain.recall_test', 'brain.resolve_conflict', 'brain.export_markdown']) {
    assert.equal(clientBundle.includes(forbidden), false, `M1 client.js must NOT include forbidden symbol: ${forbidden}`)
  }
  console.log('[M1 PASS] Module invariants, zero child_process & client markers verified')

  const stateMod = await import(modUrl('state-schema.js'))
  const chiefStateMod = await import(modUrl('chief-state.js'))
  const extMod = await import(modUrl('external-memory.js'))
  const storeMod = await import(modUrl('board-store.js'))
  const subagentMod = await import(modUrl('subagent-runtime.js'))
  const actionsMod = await import(modUrl('board-actions.js'))
  const toolsMod = await import(modUrl('model-tools.js'))
  const routesMod = await import(modUrl('api-routes.js'))
  const hooksMod = await import(modUrl('runtime-hooks.js'))
  const cmdMod = await import(modUrl('chief-commands.js'))
  const compactMod = await import(modUrl('chief-compaction.js'))
  const archMod = await import(modUrl('chief-archives.js'))

  // Wire fake host bus + apply(ctx)
  const bus = {
    hostState: {
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
    },
  }
  Object.assign(bus, storeMod.createBoardStore(bus))
  Object.assign(bus, subagentMod.createSubagentRuntime(bus))
  Object.assign(bus, actionsMod.createBoardActions(bus))
  Object.assign(bus, toolsMod.createModelTools(bus))
  Object.assign(bus, routesMod.createApiRoutes(bus))
  Object.assign(bus, hooksMod.createRuntimeHooks(bus))

  let registeredSystemPrompt = null
  let registeredPreStep = null
  let providedChiefMemoryHost = null
  let registeredRoutes = []
  const sidMain = 'sess-v190-main'
  const sidPlain = 'sess-v190-plain-unactivated'
  const fakeAgentsMap = new Map([
    [sidMain, { id: sidMain, cwd: wsDir, status: 'idle', session: { id: sidMain, cwd: wsDir, ownEvents: () => [] } }],
    [sidPlain, { id: sidPlain, cwd: wsDir, status: 'idle', session: { id: sidPlain, cwd: wsDir, ownEvents: () => [] } }],
  ])

  const runEffect = (fn) => {
    const cleanups = []

try {
      const c = typeof fn === 'function' ? fn() : null
      if (typeof c === 'function') cleanups.push(c)
    } catch {}
  }
  const fakeCtx = {
    inject: (names, cb) => cb({
      get: (n) => {
        if (n === 'systemPrompt') return { section: (spec) => { registeredSystemPrompt = spec; return () => {} } }
        if (n === 'webServer') return { route: () => () => {} }
        if (n === 'tools') return { register: () => () => {} }
        if (n === 'agents') return { get: (id) => fakeAgentsMap.get(id) || null, list: () => [...fakeAgentsMap.values()] }
        if (n === 'sessions') return { get: (id) => ({ id, blank: false, seq: 3 }) }
        return null
      },
      effect: runEffect,
      on: () => () => {},
    }),
    get: (n) => {
      if (n === 'agents') return { get: (id) => fakeAgentsMap.get(id) || null, list: () => [...fakeAgentsMap.values()] }
      if (n === 'sessions') return { get: (id) => ({ id, blank: false, seq: 3 }) }
      if (n === 'workspaceRegistry') return { resolve: () => ({ id: 'ws-v190', cwd: wsDir }) }
      return null
    },
    on: (ev, fn) => {
      if (ev === 'agent/pre-step') registeredPreStep = fn
      return () => {}
    },
    effect: runEffect,
    provide: (name, svc) => {
      if (name === 'chiefMemoryHost') providedChiefMemoryHost = svc
    },
  }
  bus.apply(fakeCtx)
  const runtimeLocator = fakeCtx
  registeredRoutes = bus.routeTable(runtimeLocator)
  assert.equal(registeredRoutes.length, 27, 'M1 api-routes must preserve exact 27 routes')
  assert.ok(providedChiefMemoryHost && typeof providedChiefMemoryHost.registerProvider === 'function', 'M1 must provide chiefMemoryHost service')

  const invokeRoute = async (routePath, { method = 'GET', query = '', body = null } = {}) => {
    const entry = registeredRoutes.find(r => r.path === routePath)
    assert.ok(entry, `Missing route: ${routePath}`)
    let resStatus = 200
    let resText = ''
    const req = {
      method,
      url: routePath + query,
      headers: {},
      on: (ev, fn) => {
        if (ev === 'data' && body !== null) fn(Buffer.from(JSON.stringify(body), 'utf8'))
        if (ev === 'end') fn()
      },
    }
    const res = {
      statusCode: 200,
      setHeader: () => {},
      end: (txt) => { resStatus = res.statusCode; resText = String(txt || '') },
    }
    await entry.handler(req, res)
    return { status: resStatus, data: resText ? JSON.parse(resText) : {} }
  }

  // =========================================================================
  // M2 & M3: Config isolation + mcp-http E2E + Secret scrub + 0-byte @lead isolation
  // =========================================================================
  const cfgMcpRes = await invokeRoute('/api/dsh-chief/chief/config', {
    method: 'POST',
    body: {
      session: sidPlain,
      externalMemory: {
        enabled: true,
        memorySlot: {
          enabled: true,
          kind: 'mcp-http',
          label: 'unified-memory',
          endpoint: `${baseUrl}/mcp`,
          authToken: 'secret-token-never-leak-ui',
          autoSyncChat: true,
          syncPreCompress: true,
        },
        moodSlot: {
          enabled: true,
          kind: 'chief-http',
          label: 'MockMood',
          endpoint: `${baseUrl}/http-mood`,
          authToken: 'mood-secret-never-leak-ui',
          workModeAutoMute: true,
        },
      },
    },
  })
  assert.equal(cfgMcpRes.status, 200)
  assert.equal(chiefStateMod.isChiefSessionEnabled(chiefStateMod.loadChiefState(), sidPlain), false, 'M2 updating externalMemory must NOT activate plain unenabled sessions')
  assert.equal(cfgMcpRes.data.config.externalMemory.memorySlot.authToken, '', 'M8 config response must redact authToken')
  assert.equal(cfgMcpRes.data.config.externalMemory.memorySlot.hasAuthToken, true, 'M8 must report hasAuthToken=true')

  chiefStateMod.activateChiefSession(sidMain, { force: true })
  await chiefStateMod.updateChiefConfig({ session: sidMain, permissionMode: 'advisor' })

  let capSysM3 = ''
  let capPromptM3 = ''
  const depsM3 = {
    ...bus.makeChiefDeps(runtimeLocator),
    callLlmOverride: async (opts) => {
      capSysM3 = String(opts?.system || '')
      capPromptM3 = String(opts?.prompt || '')
      return {
        ok: true,
        text: JSON.stringify({
          reply: '已查到统一记忆原则；附带测试密钥 sk-proj-secretvalue1234567890 检查脱敏。',
          toolCalls: [],
          relays: [],
          memoryChanges: [],
          boardOps: [],
        }),
      }
    },
  }

  const askM3 = await cmdMod.askOrCommandChief(depsM3, {
    sessionId: sidMain,
    text: '请结合历史决策说明为什么参谋记忆不能污染主对话？密钥 sk-testkey1234567890abcdef 请顺便过滤',
  })
  assert.equal(askM3.ok, true)
  assert.ok(capSysM3.includes('严禁顺口圆谎'), 'M3 system prompt must contain static anti-confabulation block')
  assert.ok(capPromptM3.includes('EXT_SECRET_MCP_TOKEN_9981'), 'M3 chief prompt must receive mcp-http recall')
  assert.ok(capPromptM3.includes('MOOD_PROMPT_TEXT_ONLY'), 'M3 chief prompt must receive mood promptText in chat mode')
  assert.equal(capPromptM3.includes('score=88'), false, 'M4 mood numeric gauge must be stripped from prompt')
  assert.equal(capPromptM3.includes('UI_BADGE_NUMERIC_SECRET_99'), false, 'M4 uiBadge must NEVER leak into model prompt')
  assert.equal(askM3.moodBadge?.text, 'UI_BADGE_NUMERIC_SECRET_99', 'M4 uiBadge must reach UI response')
  assert.ok(askM3.memoryRecall && askM3.memoryRecall.count >= 1, 'M3 response must include memoryRecall metadata')

  await new Promise(r => setTimeout(r, 120))
  assert.equal(mcpStored.length, 1, 'M3 mcpSyncTurn must asynchronously call memory_propose')
  assert.equal(mcpStored[0].content.includes('sk-testkey1234567890abcdef'), false, 'M3 user secret must be scrubbed before egress')
  assert.equal(mcpStored[0].content.includes('sk-proj-secretvalue1234567890'), false, 'M3 reply secret must be scrubbed before egress')
  assert.ok(mcpStored[0].content.includes('[REDACTED]'), 'M3 scrubbed text must carry [REDACTED]')

  // M2 strict 0-byte @lead verification
  const spLeadText = await registeredSystemPrompt.text({ agent: fakeAgentsMap.get(sidMain), session: fakeAgentsMap.get(sidMain).session })
  assert.equal(spLeadText.includes('EXT_SECRET_MCP_TOKEN_9981'), false, 'M2 @lead systemPrompt must remain 0-byte isolated from external memory')
  assert.equal(spLeadText.includes('MOOD_PROMPT_TEXT_ONLY'), false, 'M2 @lead systemPrompt must remain 0-byte isolated from mood slot')
  assert.equal(spLeadText.includes('UI_BADGE_NUMERIC_SECRET_99'), false, 'M2 @lead systemPrompt must remain 0-byte isolated from uiBadge')
  if (registeredPreStep) {
    const preDecision = await registeredPreStep(
      { agent: fakeAgentsMap.get(sidMain), messages: [], signal: new AbortController().signal },
      async () => ({ kind: 'enter', messages: [] }),
    )
    const preTxt = JSON.stringify(preDecision)
    assert.equal(preTxt.includes('EXT_SECRET_MCP_TOKEN_9981'), false, 'M2 @lead pre-step must be 0-byte isolated')
    assert.equal(preTxt.includes('MOOD_PROMPT_TEXT_ONLY'), false, 'M2 @lead pre-step must be 0-byte isolated')
  }
  console.log('[M2 & M3 PASS] Strict @lead 0-byte isolation, mcp-http E2E & egress secret scrub verified')

  // =========================================================================
  // M4: chief-http + trivial query gate + workModeAutoMute + KV Cache layout
  // =========================================================================
  await chiefStateMod.updateChiefConfig({
    session: sidMain,
    externalMemory: {
      enabled: true,
      memorySlot: { enabled: true, kind: 'chief-http', label: 'HttpMem', endpoint: `${baseUrl}/http-mem`, clearAuthToken: true },
      moodSlot: { enabled: true, kind: 'chief-http', label: 'HttpMood', endpoint: `${baseUrl}/http-mood`, workModeAutoMute: true, clearAuthToken: true },
    },
  })
  const prevMemPrefCount = httpMemLog.prefetch.length
  const prevMoodPrefCount = httpMoodLog.prefetch.length
  await cmdMod.askOrCommandChief(depsM3, { sessionId: sidMain, text: '好的' })
  assert.equal(httpMemLog.prefetch.length, prevMemPrefCount, 'M4 trivial query "好的" must skip memory prefetch')
  const prevMoodAfterTrivial = httpMoodLog.prefetch.length

  // Serious work mode (craft_wall) must auto-mute mood slot
  let workPrompt = ''
  const depsM4 = {
    ...depsM3,
    callLlmOverride: async (opts) => {
      workPrompt = String(opts?.prompt || '')
      return { ok: true, text: JSON.stringify({ reply: '规则已评估', toolCalls: [], relays: [] }) }
    },
  }
  await cmdMod.askOrCommandChief(depsM4, { sessionId: sidMain, text: '帮我筑墙拦截 rm -rf 危险命令' })
  assert.ok(httpMemLog.prefetch.length > prevMemPrefCount, 'M4 serious work query still uses memory slot')
  assert.equal(httpMoodLog.prefetch.length, prevMoodAfterTrivial, 'M4 craft_wall work mode must auto-mute mood slot')
  assert.ok(workPrompt.includes('HTTP_MEM_MARKER_7741'), 'M4 chief-http memory prefetch injected')
  assert.ok(
    workPrompt.indexOf('## 10.5 参谋专属外部记忆召回') < workPrompt.indexOf('## 用户刚刚对你说的话：'),
    'M4 dynamic recall must sit at tail right before current user input (KV Cache friendly)',
  )
  console.log('[M4 PASS] chief-http, trivial gate, workModeAutoMute & KV Cache layout verified')

  // =========================================================================
  // M5: markdown-vault read-only bilingual BM25 recall
  // =========================================================================
  const memMdPath = path.join(vaultDir, 'MEMORY.md')
  const projMdPath = path.join(vaultDir, 'project-notes.md')
  const memMdContent = '# 核心偏好\n用户最看重主对话绝对干净，参谋外部记忆不可污染工作区。\n'
  const projMdContent = '# 架构决策\n采用三合一通用插座，支持中文双字检索与 Obsidian 目录只读挂载。\n'
  fs.writeFileSync(memMdPath, memMdContent, 'utf8')
  fs.writeFileSync(projMdPath, projMdContent, 'utf8')

  await chiefStateMod.updateChiefConfig({
    session: sidMain,
    externalMemory: {
      enabled: true,
      memorySlot: { enabled: true, kind: 'markdown-vault', label: 'Obsidian', vaultPath: vaultDir },
      moodSlot: { enabled: false, kind: 'none' },
    },
  })
  let mdPrompt = ''
  await cmdMod.askOrCommandChief({
    ...depsM3,
    callLlmOverride: async (opts) => {
      mdPrompt = String(opts?.prompt || '')
      return { ok: true, text: JSON.stringify({ reply: '已读取本地笔记', toolCalls: [] }) }
    },
  }, { sessionId: sidMain, text: '查一下中文双字检索的架构决策' })
  assert.ok(mdPrompt.includes('三合一通用插座'), 'M5 markdown-vault must recall Chinese sections accurately')
  assert.equal(fs.readFileSync(memMdPath, 'utf8'), memMdContent, 'M5 markdown-vault must never modify MEMORY.md')
  assert.equal(fs.readFileSync(projMdPath, 'utf8'), projMdContent, 'M5 markdown-vault must never modify project-notes.md')
  console.log('[M5 PASS] markdown-vault bilingual recall & strict read-only preservation verified')

  // =========================================================================
  // M6: cordis-provider + workspace read-only & disabled policies
  // =========================================================================
  const cordisWrites = []
  const disposeProv = providedChiefMemoryHost.registerProvider({
    id: 'mock-dsh-emotion-mem',
    slot: 'hybrid',
    label: 'MockDSHPlugin',
    prefetch: async () => ({
      promptText: 'CORDIS_PROVIDER_HIT_5521',
      items: [{ id: 'cp-1', preview: '来自同进程 DSH 插件的记忆', evidence: 'observed', source: 'cordis' }],
      uiBadge: { glyph: '🌙', text: '深夜陪伴' },
    }),
    syncTurn: async (payload) => { cordisWrites.push(payload) },
  })
  await chiefStateMod.updateChiefConfig({
    session: sidMain,
    externalMemory: {
      enabled: true,
      memorySlot: { enabled: true, kind: 'cordis', cordisProviderId: 'mock-dsh-emotion-mem', autoSyncChat: true },
      workspacePolicies: { [`session:${sidMain}`]: 'read-only' },
    },
  })
  let cordisPrompt = ''
  await cmdMod.askOrCommandChief({
    ...depsM3,
    callLlmOverride: async (opts) => {
      cordisPrompt = String(opts?.prompt || '')
      return { ok: true, text: JSON.stringify({ reply: '只读模式测试完成', toolCalls: [] }) }
    },
  }, { sessionId: sidMain, text: '看看进程内插件能不能正常读出来' })
  await new Promise(r => setTimeout(r, 80))
  assert.ok(cordisPrompt.includes('CORDIS_PROVIDER_HIT_5521'), 'M6 read-only policy must still allow prefetch')
  assert.equal(cordisWrites.length, 0, 'M6 read-only policy must block syncTurn writes')

  await chiefStateMod.updateChiefConfig({
    session: sidMain,
    externalMemory: {
      workspacePolicies: { [`session:${sidMain}`]: 'disabled' },
    },
  })
  let disabledPrompt = ''
  await cmdMod.askOrCommandChief({
    ...depsM3,
    callLlmOverride: async (opts) => {
      disabledPrompt = String(opts?.prompt || '')
      return { ok: true, text: JSON.stringify({ reply: '禁用模式测试完成', toolCalls: [] }) }
    },
  }, { sessionId: sidMain, text: '再次检查禁用工作区' })
  assert.equal(disabledPrompt.includes('CORDIS_PROVIDER_HIT_5521'), false, 'M6 disabled policy must mute external memory completely')
  disposeProv()
  console.log('[M6 PASS] cordis-provider registration & read-only/disabled workspace policies verified')

  // =========================================================================
  // M7: Timeout + 3-failure circuit breaker silent degradation
  // =========================================================================
  extMod.resetExternalMemoryCircuit()
  const slowCfg = {
    enabled: true,
    memorySlot: { enabled: true, kind: 'chief-http', endpoint: `${baseUrl}/slow`, timeoutMs: 500 },
  }
  const tStart = Date.now()
  for (let i = 0; i < 3; i += 1) {
    const r = await extMod.prefetchForChief(slowCfg, { query: '测试超时熔断第几次调用 ' + i, sessionId: sidMain })
    assert.equal(r.memorySectionLines.length, 0)
  }
  const stAfter3 = extMod.getExternalMemoryRuntimeStatus(slowCfg, { sessionId: sidMain })
  assert.equal(stAfter3.memory.degraded, true, 'M7 3 consecutive failures must trip circuit breaker')
  const tFast0 = Date.now()
  await extMod.prefetchForChief(slowCfg, { query: '熔断期立即跳过', sessionId: sidMain })
  assert.ok(Date.now() - tFast0 < 150, 'M7 open circuit must skip network immediately')
  assert.ok(Date.now() - tStart < 4500, 'M7 timeouts must stay bounded')
  extMod.resetExternalMemoryCircuit()
  console.log('[M7 PASS] Hard timeout & 3-failure circuit breaker silent degradation verified')

  // =========================================================================
  // M8: pre-compress, dream hooks + HTTP ext_mem.* routes + redaction
  // =========================================================================
  await chiefStateMod.updateChiefConfig({
    session: sidMain,
    externalMemory: {
      enabled: true,
      memorySlot: {
        enabled: true,
        kind: 'chief-http',
        endpoint: `${baseUrl}/http-mem`,
        authToken: 'secret-token-check-redaction',
        syncPreCompress: true,
      },
      workspacePolicies: { [`session:${sidMain}`]: 'read-write' },
    },
  })

  // pre-compress hook
  const compRes = await compactMod.executeHarvestAndCompact({
    ...depsM3,
    compactSessionNow: async () => ({ ok: true, noop: false }),
    callLlmOverride: async () => ({
      ok: true,
      text: JSON.stringify({ title: '压缩前抢救记录', summary: '包含关键上下文摘要', points: [{ title: '要点', detail: '已安全归档' }] }),
    }),
  }, { sid: sidMain, rootId: sidMain, reason: 'M8 test compact', seq: 5, ratioPct: 65, totalTokens: 65000, contextWindow: 100000 })
  assert.equal(compRes.ok, true)
  await new Promise(r => setTimeout(r, 80))
  assert.ok(httpMemLog.preCompress.length >= 1, 'M8 executeHarvestAndCompact must fire pre-compress hook')

  // dream_roam hook via HTTP ext_mem.sync_now
  const syncNowHttp = await invokeRoute('/api/dsh-chief/chief/fact', {
    method: 'POST',
    body: { session: sidMain, op: 'ext_mem.sync_now' },
  })
  assert.equal(syncNowHttp.status, 200)
  assert.ok(httpMemLog.dream.length >= 1, 'M8 ext_mem.sync_now must trigger /dream hook')

  // HTTP ext_mem.probe on mcp-http
  const probeHttp = await invokeRoute('/api/dsh-chief/chief/fact', {
    method: 'POST',
    body: {
      session: sidMain,
      op: 'ext_mem.probe',
      slot: 'memory',
      query: '统一记忆',
      config: { enabled: true, memorySlot: { enabled: true, kind: 'mcp-http', endpoint: `${baseUrl}/mcp` } },
    },
  })
  assert.equal(probeHttp.status, 200)
  assert.equal(probeHttp.data.ok, true)
  assert.ok(probeHttp.data.tools.includes('memory_search'), 'M8 probe must auto-discover MCP tools')

  // HTTP ext_mem.retract
  const retractHttp = await invokeRoute('/api/dsh-chief/chief/fact', {
    method: 'POST',
    body: { session: sidMain, op: 'ext_mem.retract', ids: ['hm-1'] },
  })
  assert.equal(retractHttp.status, 200)
  assert.equal(httpMemLog.retract.length, 1, 'M8 ext_mem.retract must forward to active provider')

  // /snapshot & /chief/view redaction check
  const snapRes = await invokeRoute('/api/dsh-chief/snapshot', { query: `?session=${sidMain}` })
  assert.equal(snapRes.status, 200)
  assert.equal(snapRes.data.chiefMeta.externalMemory.memorySlot.authToken, '', 'M8 /snapshot must redact authToken')
  assert.equal(snapRes.data.chiefMeta.externalMemory.memorySlot.hasAuthToken, true)

  const viewRes = await invokeRoute('/api/dsh-chief/chief/view', { query: `?session=${sidMain}` })
  assert.equal(viewRes.status, 200)
  assert.equal(viewRes.data.config.externalMemory.memorySlot.authToken, '', 'M8 /chief/view must redact authToken')
  assert.ok(viewRes.data.externalMemoryStatus && viewRes.data.externalMemoryStatus.apiVersion === 'dsh-chief.provider/v1')

  console.log('[M8 PASS] pre-compress, dream hooks, HTTP ext_mem.* ops & snapshot/view secret redaction verified')

  // =========================================================================
  // M9: Beginner builtin-md out-of-the-box notebook + auto-discover + archives scope fix
  // =========================================================================
  await chiefStateMod.updateChiefConfig({
    session: sidMain,
    externalMemory: {
      enabled: true,
      memorySlot: { enabled: true, kind: 'builtin-md', label: '参谋自带记事本', vaultPath: '' },
      workspacePolicies: { [`session:${sidMain}`]: 'read-write' },
    },
  })

  const discRes = await invokeRoute('/api/dsh-chief/chief/fact', {
    method: 'POST',
    body: { session: sidMain, op: 'ext_mem.discover' },
  })
  assert.equal(discRes.status, 200)
  assert.ok(Array.isArray(discRes.data.sources) && discRes.data.sources.some(s => s.kind === 'builtin-md'), 'M9 discover must list builtin-md')

  // Fresh machine portability: unreachable local MCP server must NOT appear as an offline placeholder card
  const prevMcpProbeEnv = process.env.DSH_CHIEF_MCP_MEMORY_URL
  process.env.DSH_CHIEF_MCP_MEMORY_URL = 'http://127.0.0.1:1/mcp'
  try {
    const cleanDiscRes = await invokeRoute('/api/dsh-chief/chief/fact', {
      method: 'POST',
      body: { session: sidMain, op: 'ext_mem.discover' },
    })
    assert.equal(cleanDiscRes.status, 200)
    assert.equal(
      (cleanDiscRes.data.sources || []).some(s => s.available === false),
      false,
      'M9 discover must never emit host-specific offline placeholder cards',
    )
  } finally {
    if (prevMcpProbeEnv === undefined) delete process.env.DSH_CHIEF_MCP_MEMORY_URL
    else process.env.DSH_CHIEF_MCP_MEMORY_URL = prevMcpProbeEnv
  }

  const addRes = await invokeRoute('/api/dsh-chief/chief/fact', {
    method: 'POST',
    body: { session: sidMain, op: 'ext_mem.add', text: 'BUILTIN_MD_PREF_881：回复保持大白话，密钥 sk-builtinsecret1234567890 不能漏' },
  })
  assert.equal(addRes.status, 200)
  assert.equal(addRes.data.ok, true)

  const listRes = await invokeRoute('/api/dsh-chief/chief/fact', {
    method: 'POST',
    body: { session: sidMain, op: 'ext_mem.list' },
  })
  assert.equal(listRes.status, 200)
  assert.equal(listRes.data.kind, 'builtin-md')
  assert.equal(listRes.data.items.length, 1)
  assert.equal(listRes.data.items[0].text.includes('sk-builtinsecret1234567890'), false, 'M9 builtin-md must scrub secrets')
  assert.ok(listRes.data.items[0].text.includes('[REDACTED]'))

  let builtinPrompt = ''
  await cmdMod.askOrCommandChief({
    ...depsM3,
    callLlmOverride: async (opts) => {
      builtinPrompt = String(opts?.prompt || '')
      return { ok: true, text: JSON.stringify({ reply: '收到，会用大白话回答', toolCalls: [] }) }
    },
  }, { sessionId: sidMain, text: '我之前交代的回复风格是什么' })
  assert.ok(builtinPrompt.includes('BUILTIN_MD_PREF_881'), 'M9 builtin-md must inject saved preference into Chief prompt')

  const spLeadM9 = await registeredSystemPrompt.text({ agent: fakeAgentsMap.get(sidMain), session: fakeAgentsMap.get(sidMain).session })
  assert.equal(spLeadM9.includes('BUILTIN_MD_PREF_881'), false, 'M9 builtin-md must stay 0-byte isolated from @lead')

  const remRes = await invokeRoute('/api/dsh-chief/chief/fact', {
    method: 'POST',
    body: { session: sidMain, op: 'ext_mem.remove', id: listRes.data.items[0].id },
  })
  assert.equal(remRes.status, 200)
  assert.equal(remRes.data.items.length, 0, 'M9 ext_mem.remove must delete item cleanly')

  // Verify archives scope-isolation fix for precipitated/global cross-scope error
  const archApiSrc = fs.readFileSync(path.join(PKG, 'src', 'client', 'api', 'archives.js'), 'utf8')
  assert.ok(archApiSrc.includes('scopeValidArchiveIds'), 'M9 archives.js must validate openIds against active scope')
  assert.ok(archApiSrc.includes("id.startsWith('prec-')") && archApiSrc.includes("id.startsWith('glob-')"), 'M9 loadArchiveDetail must infer scope by id prefix')

  console.log('[M9 PASS] builtin-md out-of-the-box notebook, discover & archives scope isolation verified')

  // =========================================================================
  // M10: Starfield taxonomy, Ebbinghaus vitality, reinforce/pin/edit & bundle guard
  // =========================================================================
  const connMod = await import(modUrl('external-memory-connectors.js'))
  const vMemDir = path.join(tmpRoot, 'vitality-mem')
  fs.mkdirSync(vMemDir, { recursive: true })
  const vMemFile = connMod.defaultChiefMemoryFile(vMemDir)
  // Mix legacy format + plain bullet + old dated line
  const oldDate = '2026-06-01'
  const todayDate = new Date().toISOString().slice(0, 10)
  fs.writeFileSync(
    vMemFile,
    [
      '# DSH 参谋长记忆本 (MEMORY.md)',
      '',
      `- [${oldDate} | id=legacy-old-1] 绝不擅自修改核心安全策略，务必先看方案`,
      '- 用户平时喜欢简体中文和大白话解答',
      `- [${todayDate} | id=fresh-pin-1 | cat=decision | pin=1 | hits=0 | last=${todayDate}] 确定采用 2+3 开放记忆桥接架构`,
      '',
    ].join('\n'),
    'utf8',
  )
  const vListed = connMod.listBuiltinMemoryItems(vMemDir, { halfLifeDays: 21 })
  assert.equal(vListed.length, 3, 'M10 must parse both legacy, plain-bullet and v2 metadata lines')
  const oldItem = vListed.find(it => it.id === 'legacy-old-1')
  const plainItem = vListed.find(it => it.id.startsWith('line-'))
  const pinItem = vListed.find(it => it.id === 'fresh-pin-1')
  assert.ok(oldItem && oldItem.category === 'rule', 'M10 must infer rule category for legacy item')
  assert.ok(oldItem.vitality >= 12 && oldItem.vitality < 50, `M10 old item should gently fade >= 12, got ${oldItem.vitality}`)
  assert.ok(plainItem && plainItem.category === 'preference', 'M10 plain bullet must parse cleanly')
  assert.equal(pinItem.vitality, 100, 'M10 pinned memory must always hold 100% vitality')

  // Update via HTTP ext_mem.add + ext_mem.update + ext_mem.probe
  const m10Add = await invokeRoute('/api/dsh-chief/chief/fact', {
    method: 'POST',
    body: { session: sidMain, op: 'ext_mem.add', text: '踩坑备忘：Windows PowerShell 5.1 不支持 &&', category: 'lesson', pinned: false },
  })
  assert.equal(m10Add.status, 200)
  assert.ok(m10Add.data.item && m10Add.data.item.category === 'lesson')
  assert.ok(m10Add.data.stats && m10Add.data.stats.total >= 1)

  const m10Upd = await invokeRoute('/api/dsh-chief/chief/fact', {
    method: 'POST',
    body: { session: sidMain, op: 'ext_mem.update', id: m10Add.data.item.id, pinned: true, reinforce: true },
  })
  assert.equal(m10Upd.status, 200)
  assert.equal(m10Upd.data.item.pinned, true, 'M10 ext_mem.update must toggle pin')
  assert.equal(m10Upd.data.item.hits, 1, 'M10 ext_mem.update reinforce must increment hits')
  assert.equal(m10Upd.data.item.vitality, 100)

  const m10Probe = await invokeRoute('/api/dsh-chief/chief/fact', {
    method: 'POST',
    body: { session: sidMain, op: 'ext_mem.probe', slot: 'memory', query: 'PowerShell 踩坑' },
  })
  assert.equal(m10Probe.status, 200)
  assert.ok(Array.isArray(m10Probe.data.formattedLines) && m10Probe.data.formattedLines.length >= 1, 'M10 probe must expose formattedLines for X-Ray UI')
  assert.ok(typeof m10Probe.data.usedChars === 'number' && m10Probe.data.charBudget >= 400, 'M10 probe must return budget stats')

  // Client bundle verification (new starfield & curve markers present, zero forbidden B1 symbols)
  const clientJsPath = path.join(PKG, 'client.js')
  if (fs.existsSync(clientJsPath)) {
    const bundleTxt = fs.readFileSync(clientJsPath, 'utf8')
    for (const reqMarker of ['ExtMemStarCanvas', 'ExtMemDecayChart', 'dnb-extmem-sky', 'dnb-extmem-hero']) {
      assert.ok(bundleTxt.includes(reqMarker), `M10 client.js must contain ${reqMarker}`)
    }
    for (const forbidden of ['PrivateBrainPage', 'dnb-brain-page', 'dnb-brain-graph-svg', 'brain.recall_test', 'brain.resolve_conflict', 'brain.export_markdown']) {
      assert.equal(bundleTxt.includes(forbidden), false, `M10 client.js must NEVER contain forbidden B1 symbol ${forbidden}`)
    }
  }
  console.log('[M10 PASS] Starfield taxonomy, Ebbinghaus vitality, HTTP update/probe & B1 symbol isolation verified')

  // =========================================================================
  // M11: Chief Brand Easter Egg (Name <-> Model <-> Signature Skin Sync)
  // =========================================================================
  {
    const prevWin11 = globalThis.window
    const prevDoc11 = globalThis.document
    globalThis.window = { location: { href: 'http://127.0.0.1:8498/', search: '' } }
    globalThis.document = { documentElement: {} }
    try {
      const utilsMod11 = await import(modUrl('src/client/utils.js'))
      const constMod11 = await import(modUrl('src/client/constants.js'))
      assert.ok(constMod11.CHIEF_BRAND_EASTER_EGGS && constMod11.CHIEF_BRAND_EASTER_EGGS.deepseek.skin === 'classic')
      assert.equal(utilsMod11.detectChiefBrandFromName('Claude')?.skin, 'editorial')
      assert.equal(utilsMod11.detectChiefBrandFromName('小克')?.skin, 'editorial')
      assert.equal(utilsMod11.detectChiefBrandFromName('克老师')?.skin, 'editorial')
      assert.equal(utilsMod11.detectChiefBrandFromName('小螃蟹')?.skin, 'editorial')
      assert.equal(utilsMod11.detectChiefBrandFromName('Clawd')?.skin, 'editorial')
      assert.equal(utilsMod11.detectChiefBrandFromName('大小姐')?.skin, 'editorial')
      assert.equal(utilsMod11.detectChiefBrandFromName('小龙虾'), null, 'M11 removed alias 小龙虾 must not match')
      assert.equal(utilsMod11.detectChiefBrandFromName('GPT')?.skin, 'botanical')
      assert.equal(utilsMod11.detectChiefBrandFromName('白龙娘')?.skin, 'botanical')
      assert.equal(utilsMod11.detectChiefBrandFromName('Codex')?.skin, 'botanical')
      assert.equal(utilsMod11.detectChiefBrandFromName('小G')?.skin, 'botanical')
      assert.equal(utilsMod11.detectChiefBrandFromName('恰特')?.skin, 'botanical')
      assert.equal(utilsMod11.detectChiefBrandFromName('G宝')?.skin, 'botanical')
      assert.equal(utilsMod11.detectChiefBrandFromName('GPT老师')?.skin, 'botanical')
      assert.equal(utilsMod11.detectChiefBrandFromName('Gemini')?.skin, 'starlight')
      assert.equal(utilsMod11.detectChiefBrandFromName('哈基米')?.skin, 'starlight')
      assert.equal(utilsMod11.detectChiefBrandFromName('芥末泥')?.skin, 'starlight')
      assert.equal(utilsMod11.detectChiefBrandFromName('小Gem')?.skin, 'starlight')
      assert.equal(utilsMod11.detectChiefBrandFromName('DeepSeek')?.skin, 'classic')
      assert.equal(utilsMod11.detectChiefBrandFromName('鲸鱼娘')?.skin, 'classic')
      assert.equal(utilsMod11.detectChiefBrandFromName('小肥鲸')?.skin, 'classic')
      assert.equal(utilsMod11.detectChiefBrandFromName('大肥鱼')?.skin, 'classic')
      assert.equal(utilsMod11.detectChiefBrandFromName('哦鲸鲸')?.skin, 'classic')
      assert.equal(utilsMod11.detectChiefBrandFromName('D老师')?.skin, 'classic')
      assert.equal(utilsMod11.detectChiefBrandFromName('梁文锋')?.skin, 'classic')
      assert.equal(utilsMod11.detectChiefBrandFromName('梁武锋')?.skin, 'classic')
      assert.equal(utilsMod11.detectChiefBrandFromName('梁文谷')?.skin, 'classic')
      assert.equal(utilsMod11.detectChiefBrandFromName('梁武谷')?.skin, 'classic')
      assert.equal(utilsMod11.detectChiefBrandFromName('溟月'), null, 'M11 removed alias 溟月 must not match')
      assert.equal(utilsMod11.detectChiefBrandFromName('锋哥'), null, 'M11 removed alias 锋哥 must not match')
      assert.equal(utilsMod11.detectChiefBrandFromName('贾维斯'), null, 'M11 unrelated custom names must not false-trigger')
      assert.equal(utilsMod11.detectChiefBrandFromName('Jarvis'), null)
      assert.equal(utilsMod11.detectChiefBrandFromName('小美'), null)

      assert.equal(utilsMod11.detectChiefBrandFromModelRef('anthropic/claude-opus-4-6')?.skin, 'editorial')
      assert.equal(utilsMod11.detectChiefBrandFromModelRef('openai/gpt-5.4')?.skin, 'botanical')
      assert.equal(utilsMod11.detectChiefBrandFromModelRef('google/gemini-3-pro')?.skin, 'starlight')
      assert.equal(utilsMod11.detectChiefBrandFromModelRef('deepseek/deepseek-reasoner')?.skin, 'classic')

      for (const bk of ['claude', 'gpt', 'gemini', 'deepseek']) {
        const picked = utilsMod11.rollChiefBrandNickname(bk, constMod11.CHIEF_BRAND_EASTER_EGGS[bk].nicknames[0])
        assert.ok(constMod11.CHIEF_BRAND_EASTER_EGGS[bk].nicknames.includes(picked), `M11 rolled nickname must belong to ${bk}`)
        assert.notEqual(picked, constMod11.CHIEF_BRAND_EASTER_EGGS[bk].nicknames[0], `M11 roll must avoid excluded name for ${bk}`)
      }
      console.log('[M11 PASS] Brand Easter Egg name/model matching, skin mapping & nickname rolling verified')
    } finally {
      if (prevWin11 === undefined) delete globalThis.window
      else globalThis.window = prevWin11
      if (prevDoc11 === undefined) delete globalThis.document
      else globalThis.document = prevDoc11
    }
  }
  // =========================================================================
  // M12: Dream-roam cross-scope auto-routing & stale recentlyUnpinnedWatch cleanup
  // =========================================================================
  {
    const addGlob = await invokeRoute('/api/dsh-chief/archives', {
      method: 'POST',
      body: {
        session: sidMain,
        vaultScope: 'global',
        op: 'save',
        title: '全局认知桌面测试卷宗',
        body: '核心坐标路径：D:/project/app.js，注意热更端口 8788。',
        tags: ['coords', 'test'],
      },
    })
    assert.equal(addGlob.status, 200)
    const globId = addGlob.data?.item?.id || ''
    assert.ok(globId.startsWith('glob-'), `M12 created item must be glob-*, got ${globId}`)

    const pinRes = await invokeRoute('/api/dsh-chief/archives', {
      method: 'POST',
      body: { session: sidMain, vaultScope: 'global', op: 'takeOut', id: globId },
    })
    assert.equal(pinRes.status, 200)

    const unpinRes = await invokeRoute('/api/dsh-chief/archives', {
      method: 'POST',
      body: { session: sidMain, vaultScope: 'global', op: 'putBack', id: globId },
    })
    assert.equal(unpinRes.status, 200)
    const getSessAfterUnpin = await invokeRoute('/api/dsh-chief/archives', {
      query: `?session=${sidMain}&scope=session`,
    })
    assert.equal(getSessAfterUnpin.status, 200)
    const watchBefore = (getSessAfterUnpin.data?.desktop?.recentlyUnpinnedWatch || []).map(w => w.id)
    assert.ok(watchBefore.includes(globId), 'M12 unpinned global item must appear in recentlyUnpinnedWatch')

    // Even when vaultScope=session is passed (reproducing UI mismatch), dream_roam must cross-route to global & clear watch
    const dreamGlobRes = await invokeRoute('/api/dsh-chief/archives/organize', {
      method: 'POST',
      body: {
        session: sidMain,
        vaultScope: 'session',
        ids: [globId],
        reasonKind: 'dream_roam',
        instruction: '整理撤下桌面的卷宗',
      },
    })
    assert.equal(dreamGlobRes.status, 200, `M12 cross-scope dream_roam must succeed cleanly, got ${JSON.stringify(dreamGlobRes.data)}`)
    assert.equal(dreamGlobRes.data.ok, true)
    assert.ok(dreamGlobRes.data.updatedCount >= 1, 'M12 must organize the global dossier across scope')

    const getSessAfterDream = await invokeRoute('/api/dsh-chief/archives', {
      query: `?session=${sidMain}&scope=session`,
    })
    const watchAfterDream = (getSessAfterDream.data?.desktop?.recentlyUnpinnedWatch || []).map(w => w.id)
    assert.equal(watchAfterDream.includes(globId), false, 'M12 organized global item must be cleared from recentlyUnpinnedWatch')

    // Stale/deleted watch ID during dream_roam must reset gracefully instead of failing with 未找到符合筛选范围的工程档案
    const staleDreamRes = await invokeRoute('/api/dsh-chief/archives/organize', {
      method: 'POST',
      body: {
        session: sidMain,
        vaultScope: 'session',
        ids: ['ghost-deleted-watch-999'],
        reasonKind: 'dream_roam',
      },
    })
    assert.equal(staleDreamRes.status, 200, 'M12 stale watch ID must not fail dream_roam')
    assert.equal(staleDreamRes.data.ok, true)
    assert.ok(staleDreamRes.data.cleanedStaleWatch >= 1, 'M12 must report cleanedStaleWatch')
    console.log('[M12 PASS] Dream-roam cross-scope routing, watch clearing & stale watch cleanup verified')
  }

  // =========================================================================
  // M13: Cognitive Desktop capacity expansion (setDesktopCapacity + >6 pinned)
  // =========================================================================
  {
    const archMod13 = await import(modUrl('archives.js'))
    const capRes = await invokeRoute('/api/dsh-chief/archives', {
      method: 'POST',
      body: {
        session: sidMain,
        vaultScope: 'session',
        op: 'setDesktopCapacity',
        maxItems: 12,
        tokenBudget: 4800,
      },
    })
    assert.equal(capRes.status, 200)
    assert.equal(capRes.data.ok, true)
    assert.equal(capRes.data.archives?.desktop?.maxItems, 12, 'M13 maxItems must persist as 12')
    assert.equal(capRes.data.archives?.desktop?.tokenBudget, 4800, 'M13 tokenBudget must persist as 4800')

    // Create & pin 7 session archives (exceeding legacy 6-item cap)
    const pinnedIds = []
    for (let k = 1; k <= 7; k += 1) {
      const sv = await invokeRoute('/api/dsh-chief/archives', {
        method: 'POST',
        body: {
          session: sidMain,
          vaultScope: 'session',
          op: 'save',
          title: `扩容测试卷宗 #${k}`,
          body: `第 ${k} 份认知桌面验证条目。`,
        },
      })
      assert.equal(sv.status, 200)
      const aid = sv.data?.item?.id
      pinnedIds.push(aid)
      const tk = await invokeRoute('/api/dsh-chief/archives', {
        method: 'POST',
        body: { session: sidMain, vaultScope: 'session', op: 'takeOut', id: aid },
      })
      assert.equal(tk.status, 200)
    }

    const listAfter7 = await invokeRoute('/api/dsh-chief/archives', {
      query: `?session=${sidMain}&scope=session`,
    })
    assert.equal(listAfter7.data?.desktop?.pinnedDocuments?.length, 7, 'M13 expanded desktop must hold all 7 pinned dossiers')

    const takenOut = archMod13.getTakenOutArchivesForSession(sidMain, { cwd: wsDir })
    assert.equal(takenOut.length, 7, 'M13 getTakenOutArchivesForSession must respect expanded maxItems=12')

    // Extreme values must clamp cleanly to [4..24] and [1200..12000]
    const clampRes = await invokeRoute('/api/dsh-chief/archives', {
      method: 'POST',
      body: {
        session: sidMain,
        vaultScope: 'session',
        op: 'setDesktopCapacity',
        maxItems: 999,
        tokenBudget: 999999,
      },
    })
    assert.equal(clampRes.status, 200)
    assert.equal(clampRes.data.maxItems, 24)
    assert.equal(clampRes.data.tokenBudget, 12000)
    console.log('[M13 PASS] Cognitive Desktop capacity expansion, 7+ pinning & safety clamping verified')
  }

  // =========================================================================
  // M14: Custom DIY Theme (Palette Extractor, CSS Generator, Chief AI DIY & 0-byte @lead Isolation)
  // =========================================================================
  {
    const constMod14 = await import(modUrl('src/client/constants.js'))
    const themeMod14 = await import(modUrl('src/client/custom-theme.js'))

    assert.ok(constMod14.UI_SKIN_OPTIONS.length >= 6, 'M14 UI_SKIN_OPTIONS must include 6th custom DIY option')
    assert.equal(constMod14.DEFAULT_UI_SKIN, 'glass', 'M14 DEFAULT_UI_SKIN must remain glass')
    assert.ok(constMod14.UI_SKIN_OPTIONS.some(o => o.key === 'custom'), 'M14 UI_SKIN_OPTIONS must contain key=custom')

    const tokens14 = themeMod14.deriveCustomSkinTokens({
      name: '测试主题',
      accentHex: '#ff6b9d',
      secondaryHex: '#4ecdc4',
      warmHex: 'not-a-hex',
      bgTintHex: '#19223c',
      radius: 'medium',
      serifTitle: true,
    })
    assert.equal(tokens14.config.warmHex, themeMod14.DEFAULT_CUSTOM_SKIN.warmHex, 'M14 invalid hex must fallback cleanly')
    assert.equal(tokens14.dark['--dnb-font-display'].includes('serif'), true, 'M14 serifTitle must map serif font')
    assert.ok(/^#[0-9a-f]{6}$/.test(tokens14.dark['--dnb-skin-bg']), 'M14 dark skin bg must be valid 6-char hex')
    assert.ok(/^#[0-9a-f]{6}$/.test(tokens14.light['--dnb-text']), 'M14 light text must be valid 6-char hex')

    const css14 = themeMod14.buildCustomSkinCss({ accentHex: '#ec78a8', secondaryHex: '#52c7b8' })
    assert.ok(css14.includes('data-dnb-skin="custom"'), 'M14 CSS must target custom skin attribute')
    assert.ok(css14.includes('html[data-dnb-theme="light"]'), 'M14 CSS must expand light theme selector')
    assert.ok(css14.includes('content: none'), 'M14 custom skin without wallpaper must disable ::before')

    // Wallpaper sanitization, IndexedDB metadata persistence & sharp 1:1 CSS generation checks
    assert.equal(themeMod14.sanitizeCustomImageUrl('javascript:alert(1)'), '', 'M14 must reject javascript: URIs')
    assert.equal(themeMod14.sanitizeCustomImageUrl('https://evil.example/bg.png'), '', 'M14 must reject remote URLs')
    assert.equal(themeMod14.sanitizeCustomImageUrl('data:image/png;base64,iVBORw0KGgo=")'), '', 'M14 must reject CSS quote breakouts')
    const validBlobUri = 'blob:http://127.0.0.1:8788/550e8400-e29b-41d4-a716-446655440000'
    assert.equal(themeMod14.sanitizeCustomImageUrl(validBlobUri), validBlobUri, 'M14 must accept clean blob: object URLs')
    assert.equal(themeMod14.sanitizeCustomImageUrl('blob:http://evil.test/550e8400-e29b-41d4-a716-446655440000")'), '', 'M14 must reject malformed blob: injection')
    const validPngUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    assert.equal(themeMod14.sanitizeCustomImageUrl(validPngUri), validPngUri, 'M14 must accept clean base64 image data URI')

    const clampedBgTokens = themeMod14.deriveCustomSkinTokens({
      accentHex: '#ec78a8',
      bgImageUrl: validBlobUri,
      bgImageStorage: 'idb',
      bgImageMeta: { width: 3840, height: 2160, sizeBytes: 4200000, name: '4k-wall' },
      bgImageEnabled: true,
      bgImageOpacity: 9,
      bgImageBlur: 999,
    })
    assert.equal(clampedBgTokens.config.bgImageOpacity, 0.8, 'M14 wallpaper opacity must clamp to <=0.80')
    assert.equal(clampedBgTokens.config.bgImageBlur, 32, 'M14 wallpaper blur must clamp to <=32')
    assert.equal(clampedBgTokens.config.bgImageMeta.width, 3840, 'M14 must preserve HD width metadata')
    assert.ok(clampedBgTokens.dark['--dnb-card'].startsWith('rgba('), 'M14 cards must become frosted translucent when wallpaper enabled')
    assert.ok(clampedBgTokens.light['--dnb-card'].startsWith('rgba('), 'M14 light cards must become frosted translucent when wallpaper enabled')

    // writeSavedCustomSkin must strip volatile blob: URL when persisting to localStorage
    const lsFake = new Map()
    const prevLs14 = globalThis.localStorage
    globalThis.localStorage = {
      getItem: k => (lsFake.has(k) ? lsFake.get(k) : null),
      setItem: (k, v) => { lsFake.set(k, String(v)) },
    }
    try {
      themeMod14.writeSavedCustomSkin({
        accentHex: '#ec78a8',
        bgImageUrl: validBlobUri,
        bgImageStorage: 'idb',
        bgImageMeta: { width: 2560, height: 1440, sizeBytes: 1200000, name: '2k' },
      })
      const persistedRaw = JSON.parse(lsFake.get(themeMod14.CUSTOM_SKIN_STORAGE_KEY) || '{}')
      assert.equal(persistedRaw.bgImageUrl, '', 'M14 localStorage must never persist volatile blob: URL')
      assert.equal(persistedRaw.bgImageStorage, 'idb', 'M14 localStorage must persist idb storage marker')
      assert.equal(persistedRaw.bgImageMeta.width, 2560, 'M14 localStorage must persist wallpaper resolution meta')
    } finally {
      if (prevLs14 === undefined) delete globalThis.localStorage
      else globalThis.localStorage = prevLs14
    }

    const cssSharpBg14 = themeMod14.buildCustomSkinCss({
      accentHex: '#ec78a8',
      bgImageUrl: validBlobUri,
      bgImageEnabled: true,
      bgImageOpacity: 0.35,
      bgImageBlur: 0,
    })
    assert.ok(cssSharpBg14.includes('inset: 0;'), 'M14 blur=0 must use sharp 1:1 inset: 0')
    assert.ok(cssSharpBg14.includes('transform: none;'), 'M14 blur=0 must not scale/soften pixels')

    const cssWithBg14 = themeMod14.buildCustomSkinCss({
      accentHex: '#ec78a8',
      bgImageUrl: validPngUri,
      bgImageEnabled: true,
      bgImageOpacity: 0.35,
      bgImageBlur: 14,
    })
    assert.ok(cssWithBg14.includes('.dnb-panel[data-dnb-skin="custom"]::before'), 'M14 wallpaper CSS must render ::before backdrop layer')
    assert.ok(cssWithBg14.includes('opacity: 0.35'), 'M14 wallpaper CSS must apply configured opacity')
    assert.ok(cssWithBg14.includes('blur(14px)'), 'M14 wallpaper CSS must apply configured blur')

    const cssDisabledBg14 = themeMod14.buildCustomSkinCss({
      accentHex: '#ec78a8',
      bgImageUrl: validPngUri,
      bgImageEnabled: false,
    })
    assert.ok(cssDisabledBg14.includes('content: none'), 'M14 disabled wallpaper must disable ::before backdrop layer')

    // Synthetic 4x4 RGBA image (rose, cyan, amber, deep navy quadrants)
    const rgba14 = new Uint8Array(4 * 4 * 4)
    const paletteQuadrants = [
      [235, 92, 138, 255],
      [64, 210, 198, 255],
      [242, 188, 86, 255],
      [22, 30, 56, 255],
    ]
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        const q = (y < 2 ? 0 : 2) + (x < 2 ? 0 : 1)
        const idx = (y * 4 + x) * 4
        rgba14[idx] = paletteQuadrants[q][0]
        rgba14[idx + 1] = paletteQuadrants[q][1]
        rgba14[idx + 2] = paletteQuadrants[q][2]
        rgba14[idx + 3] = paletteQuadrants[q][3]
      }
    }
    const pal14 = themeMod14.extractPaletteFromImageData(rgba14, 4, 4)
    assert.ok(Array.isArray(pal14.swatches) && pal14.swatches.length >= 3, 'M14 must extract >=3 distinct swatches from image data')
    for (const field of ['accentHex', 'secondaryHex', 'warmHex', 'bgTintHex']) {
      assert.ok(/^#[0-9a-f]{6}$/.test(pal14[field]), `M14 extracted ${field} must be valid #rrggbb`)
    }

    // Check 0-byte @lead isolation across op: 'theme.diy'
    const snapBefore14 = await invokeRoute('/api/dsh-chief/snapshot', { query: `?session=${sidMain}` })
    const bBefore14 = JSON.stringify(snapBefore14.data?.board || {})

    const diyRes14 = await invokeRoute('/api/dsh-chief/chief/fact', {
      method: 'POST',
      body: {
        session: sidMain,
        op: 'theme.diy',
        prompt: '赛博雨夜樱花霓虹',
        extractedSwatches: ['#ff66aa', '#5ce1e6', '#f7c95c'],
      },
    })
    assert.equal(diyRes14.status, 200, 'M14 op=theme.diy must return 200')
    assert.equal(diyRes14.data.ok, true)
    assert.ok(diyRes14.data.theme && diyRes14.data.theme.name, 'M14 theme.diy must return named theme')
    for (const field of ['accentHex', 'secondaryHex', 'warmHex', 'bgTintHex']) {
      assert.ok(/^#[0-9a-f]{6}$/.test(diyRes14.data.theme[field]), `M14 Chief DIY ${field} must be valid #rrggbb`)
    }

    const snapAfter14 = await invokeRoute('/api/dsh-chief/snapshot', { query: `?session=${sidMain}` })
    const bAfter14 = JSON.stringify(snapAfter14.data?.board || {})
    assert.equal(bAfter14, bBefore14, 'M14 theme.diy must preserve 0-byte @lead board isolation')

    // Client bundle verification
    const clientBundle14 = fs.readFileSync(path.join(PKG, 'client.js'), 'utf8')
    for (const marker of ['CustomThemeModal', 'extractPaletteFromImageData', 'designCustomThemeApi', 'dnb-diy-modal', 'saveNavLayout', 'dnb-workspace-rail', 'dnb-workspace-shell']) {
      assert.ok(clientBundle14.includes(marker), `M14 client.js must contain ${marker}`)
    }
    for (const forbidden of ['PrivateBrainPage', 'dnb-brain-page', 'dnb-brain-graph-svg', 'brain.recall_test', 'brain.resolve_conflict', 'brain.export_markdown']) {
      assert.equal(clientBundle14.includes(forbidden), false, `M14 client.js must NEVER contain forbidden B1 symbol ${forbidden}`)
    }
    console.log('[M14 PASS] Custom DIY theme engine, image extractor, Chief AI DIY & 0-byte @lead isolation verified')
  }

  // =========================================================================
  // M15: Embedding API, Diary, Locked User Profile, Prompt Studio, Auto-Distill & Studio Layout Fixes
  // =========================================================================
  {
    const extStudioMod = await import(modUrl('external-memory-studio.js'))
    const studioMemDir = path.join(tmpRoot, 'studio-mem')
    fs.mkdirSync(studioMemDir, { recursive: true })

    // 1. Compound trivial query blocker
    assert.equal(extMod.isTrivialMemoryQuery('好的，继续吧'), true, 'M15 must block compound trivial confirmation')
    assert.equal(extMod.isTrivialMemoryQuery('嗯嗯好的'), true, 'M15 must block repeated acknowledgment')
    assert.equal(extMod.isTrivialMemoryQuery('ok, continue'), true, 'M15 must block compound English confirmation')
    assert.equal(extMod.isTrivialMemoryQuery('帮我查一下之前的架构约定'), false, 'M15 must allow real recall query')

    // 2. Config save sets builtin-md pointed to isolated studioMemDir + optional embedding API
    const embCfgRes = await invokeRoute('/api/dsh-chief/chief/config', {
      method: 'POST',
      body: {
        session: sidMain,
        externalMemory: {
          enabled: true,
          memorySlot: { enabled: true, kind: 'builtin-md', label: '参谋自带记事本', vaultPath: studioMemDir },
          moodSlot: { enabled: false, kind: 'none' },
          embedding: {
            enabled: true,
            baseUrl: `${baseUrl}/v1`,
            model: 'BAAI/bge-m3',
            apiKey: 'mock-emb-secret-key-999',
          },
          autoDistill: { enabled: true, minTurns: 1, cooldownSec: 15 },
        },
      },
    })
    assert.equal(embCfgRes.status, 200)
    assert.equal(embCfgRes.data.config.externalMemory.embedding.apiKey, '', 'M15 embedding apiKey must be redacted in UI payload')
    assert.equal(embCfgRes.data.config.externalMemory.embedding.hasApiKey, true, 'M15 embedding hasApiKey must be true')

    // Embedding connectivity probe
    const probeEmb = await invokeRoute('/api/dsh-chief/chief/fact', {
      method: 'POST',
      body: { session: sidMain, op: 'ext_mem.embedding_probe' },
    })
    assert.equal(probeEmb.status, 200, 'M15 ext_mem.embedding_probe must succeed against mock /v1/embeddings')
    assert.equal(probeEmb.data.ok, true)
    assert.equal(probeEmb.data.dimensions, 4)

    // Add semantically distinct notes without overlapping exact lexical keywords with query
    await invokeRoute('/api/dsh-chief/chief/fact', {
      method: 'POST',
      body: { session: sidMain, op: 'ext_mem.add', text: '解释问题时请使用通俗大白话，不要晦涩黑话', category: 'preference' },
    })
    await invokeRoute('/api/dsh-chief/chief/fact', {
      method: 'POST',
      body: { session: sidMain, op: 'ext_mem.add', text: '数据库备份采用每天凌晨增量归档策略', category: 'decision' },
    })
    const probeRecall = await invokeRoute('/api/dsh-chief/chief/fact', {
      method: 'POST',
      body: { session: sidMain, op: 'ext_mem.probe', query: '语义匹配测试' },
    })
    assert.equal(probeRecall.status, 200)
    assert.ok(probeRecall.data.items?.[0]?.text.includes('通俗大白话'), 'M15 embedding rerank must promote semantic match first')

    // Embedding failure must degrade gracefully without throwing
    const badRerank = await extStudioMod.rerankBuiltinItemsWithEmbeddings(
      [{ id: '1', text: 'a', score: 1 }],
      'query',
      { enabled: true, baseUrl: 'http://127.0.0.1:9/bad', model: 'x', timeoutMs: 500 },
      studioMemDir,
    )
    assert.equal(badRerank.length, 1, 'M15 failed embedding endpoint must degrade silently')

    // 3. Diary CRUD + secret scrubbing + DIARY.md
    const drAdd = await invokeRoute('/api/dsh-chief/chief/fact', {
      method: 'POST',
      body: {
        session: sidMain,
        op: 'ext_mem.diary_add',
        title: '完成记忆工作台重构',
        summary: '验证零本地向量直连方案，过滤 sk-diarysecret1234567890abcdef 测试。',
        moodTag: '破局',
      },
    })
    assert.equal(drAdd.status, 200)
    assert.equal(drAdd.data.ok, true)
    assert.equal(drAdd.data.entry.summary.includes('sk-diarysecret1234567890abcdef'), false, 'M15 diary must scrub secrets')
    assert.ok(fs.existsSync(path.join(studioMemDir, 'DIARY.md')), 'M15 DIARY.md must exist')

    const drId = drAdd.data.entry.id
    const drUpd = await invokeRoute('/api/dsh-chief/chief/fact', {
      method: 'POST',
      body: { session: sidMain, op: 'ext_mem.diary_update', id: drId, title: '记忆工作台完成验收' },
    })
    assert.equal(drUpd.data.entry.title, '记忆工作台完成验收')
    const drDel = await invokeRoute('/api/dsh-chief/chief/fact', {
      method: 'POST',
      body: { session: sidMain, op: 'ext_mem.diary_delete', id: drId },
    })
    assert.equal(drDel.data.ok, true)

    // 4. User Profile save + strict locked immutability on auto merge + USER_PROFILE.md
    const profSave = await invokeRoute('/api/dsh-chief/chief/fact', {
      method: 'POST',
      body: {
        session: sidMain,
        op: 'ext_mem.profile_save',
        profile: {
          sections: {
            salutation: [{ id: 'lock-1', text: '称呼我为总司令', locked: true, source: 'manual' }],
            communication: [{ id: 'auto-1', text: '先给核心结论', locked: false, source: 'auto' }],
          },
        },
      },
    })
    assert.equal(profSave.status, 200)
    assert.ok(fs.existsSync(path.join(studioMemDir, 'USER_PROFILE.md')), 'M15 USER_PROFILE.md must exist')

    const mergedProf = extStudioMod.mergeAutoProfilePatch({
      salutation: ['称呼我为普通用户'],
      engineering: ['零外部依赖，尽量轻量化'],
    }, studioMemDir)
    assert.ok(mergedProf.profile.sections.salutation.some(it => it.id === 'lock-1' && it.locked && it.text === '称呼我为总司令'), 'M15 locked profile item must stay untouched')
    assert.ok(mergedProf.profile.sections.engineering.some(it => it.text.includes('零外部依赖')), 'M15 unlocked section must merge auto updates')

    // 5. Prompt Studio CRUD + recall_inject reflected on Chief prompt while @lead remains 0-byte isolated
    const prSave = await invokeRoute('/api/dsh-chief/chief/fact', {
      method: 'POST',
      body: {
        session: sidMain,
        op: 'ext_mem.prompts_save',
        key: 'recall_inject',
        content: 'STUDIO_PROMPT_MARKER_8812：已参考 {{memory_count}} 条长期档案。',
      },
    })
    assert.equal(prSave.status, 200)
    assert.ok(prSave.data.prompts.some(p => p.key === 'recall_inject' && p.customized === true))

    let studioChiefPrompt = ''
    await cmdMod.askOrCommandChief({
      ...bus.makeChiefDeps(runtimeLocator),
      callLlmOverride: async opts => {
        studioChiefPrompt = String(opts?.prompt || '')
        return { ok: true, text: JSON.stringify({ reply: '收到，保持大白话。', toolCalls: [] }) }
      },
    }, { sessionId: sidMain, text: '查询语义匹配测试并汇报进展' })
    assert.ok(studioChiefPrompt.includes('STUDIO_PROMPT_MARKER_8812'), 'M15 customized recall_inject prompt must enter Chief prompt')
    assert.ok(studioChiefPrompt.includes('称呼我为总司令'), 'M15 user profile must enter Chief prompt')

    const spLeadStudio = await registeredSystemPrompt.text({ agent: fakeAgentsMap.get(sidMain), session: fakeAgentsMap.get(sidMain).session })
    assert.equal(spLeadStudio.includes('STUDIO_PROMPT_MARKER_8812'), false, 'M15 @lead must remain 0-byte isolated from Prompt Studio')
    assert.equal(spLeadStudio.includes('称呼我为总司令'), false, 'M15 @lead must remain 0-byte isolated from User Profile')

    const prReset = await invokeRoute('/api/dsh-chief/chief/fact', {
      method: 'POST',
      body: { session: sidMain, op: 'ext_mem.prompts_reset', key: 'recall_inject' },
    })
    assert.equal(prReset.data.prompts.find(p => p.key === 'recall_inject')?.customized, false)

    // 6. On-demand background distill endpoint (ext_mem.distill_now)
    const distillRes = await invokeRoute('/api/dsh-chief/chief/fact', {
      method: 'POST',
      body: {
        session: sidMain,
        op: 'ext_mem.distill_now',
        forceHeuristic: true,
        turns: [{ userText: '记住以后所有工作台弹窗都保留清晰的圆角与留白', chiefReply: '已记录你的视觉留白偏好，将在后续设计中遵循。' }],
      },
    })
    assert.equal(distillRes.status, 200)
    assert.equal(distillRes.data.ok, true)
    assert.ok(distillRes.data.addedMemories.length >= 1, 'M15 distill_now must extract durable memory')
    assert.ok(distillRes.data.diaryEntry, 'M15 distill_now must generate diary entry')

    // 7. Default nav layout ('sidebar'), no layout toggle data-active, and right-pane width bugfix checks
    const clientBundle15 = fs.readFileSync(path.join(PKG, 'client.js'), 'utf8')
    const panelSrc15 = fs.readFileSync(path.join(PKG, 'src/client/components/Panel.js'), 'utf8')
    const storeSrc15 = fs.readFileSync(path.join(PKG, 'src/client/store.js'), 'utf8')
    assert.ok(storeSrc15.includes("return clean === 'top' ? 'top' : 'sidebar'"), 'M15 default navLayout must be sidebar')
    assert.equal(/dnb-layout-toggle-btn['"]\s*,\s*\n?\s*['"]data-active['"]/.test(panelSrc15), false, 'M15 layout toggle button must NOT carry data-active attribute')
    for (const marker of ['ExtMemDiaryView', 'ExtMemProfileView', 'ExtMemPromptsView', 'align-items: stretch', 'data-dnb-section', '.dnb-vault-seg', 'dnb-head-rail-moved', 'dnb-skin-pop-rail', 'peers:net']) {
      assert.ok(clientBundle15.includes(marker), `M15 client.js must contain ${marker}`)
    }
    console.log('[M15 PASS] Embedding API, Diary, Locked Profile, Prompt Studio, Auto-Distill & Studio Layout Fixes verified')
  }

  // =========================================================================
  // M16: Noise-Free Auto-Distill (No Auto-Diary), Zero node_modules Scraping, Slim 3-Tab Studio & Light Theme
  // =========================================================================
  {
    const extStudioMod = await import(modUrl('external-memory-studio.js'))
    const extConnMod = await import(modUrl('external-memory-connectors.js'))
    const studioMemDir = path.join(tmpRoot, 'studio-mem')

    // 1. Noise / compaction maintenance rejection (never fabricate spam diary)
    const noiseDistill = await extStudioMod.distillMemoryBatch({
      rawCfg: { enabled: true, memorySlot: { enabled: true, kind: 'builtin-md', vaultPath: studioMemDir } },
      turns: [{
        userText: '例行压缩维护',
        chiefReply: '本日对话仅含多轮上下文静默压缩记录，已完成细节抢救归档，无实质新内容。压缩流程监控正常，占用从8%降至7%',
      }],
      sessionId: sidMain,
      customDir: studioMemDir,
      forceHeuristic: true,
    })
    assert.equal(noiseDistill.ok, true)
    assert.equal(noiseDistill.skipped, 'no-substantive-content', 'M16 must skip routine compaction maintenance noise')
    assert.equal(noiseDistill.diaryEntry, null, 'M16 must NEVER create filler diary on compaction noise')
    assert.equal(noiseDistill.addedMemories.length, 0)

    // Background auto-distill skips diary creation even on real preference turns (no unsolicited diary clutter)
    const bgRes = await extStudioMod.maybeAutoDistillTurnAsync({
      rawCfg: {
        enabled: true,
        memorySlot: { enabled: true, kind: 'builtin-md', vaultPath: studioMemDir },
        autoDistill: { enabled: true, minTurns: 1, cooldownSec: 15 },
      },
      userText: '记住以后记忆列表默认展示简洁工程条目，不要写乱七八糟日记',
      chiefReply: '好的，已经为您调整为简洁工程条目清单并关闭自动流水账日记。',
      sessionId: 'bg-no-diary-sess',
    })
    assert.equal(bgRes.diaryEntry || null, null, 'M16 background auto-distill must NOT write diary entries')

    // 2. Discovery NEVER scrapes node_modules packages; explicit vault import skips README/CHANGELOG/package.json
    const discovered = await extConnMod.discoverLocalMemorySources()
    assert.equal(discovered.some(s => String(s.id || '').startsWith('plugin:')), false, 'M16 discoverLocalMemorySources must NOT scrape node_modules plugins')

    const cleanVaultDir = path.join(tmpRoot, 'personal-notes-vault')
    fs.mkdirSync(cleanVaultDir, { recursive: true })
    const readmeTxt = '# Developer Docs\n- `pnpm verify` checks Host behavior and package exports.\n'
    const personalNotesTxt = '# 个人备忘\n- 我的工作习惯：重要修改前先给看简要方案；测试密钥 sk-vaultsecret1234567890abcd 不导出\n'
    fs.writeFileSync(path.join(cleanVaultDir, 'README.md'), readmeTxt, 'utf8')
    fs.writeFileSync(path.join(cleanVaultDir, 'CHANGELOG.md'), '# Changelog\n- Release v1.0.0\n', 'utf8')
    fs.writeFileSync(path.join(cleanVaultDir, 'personal.md'), personalNotesTxt, 'utf8')

    const vaultSource = {
      id: 'local-clean-vault',
      kind: 'markdown-vault',
      slot: 'memory',
      title: 'Personal Notes Vault',
      vaultPath: cleanVaultDir,
    }
    const imp1 = await invokeRoute('/api/dsh-chief/chief/fact', {
      method: 'POST',
      body: { session: sidMain, op: 'ext_mem.import_source', source: vaultSource },
    })
    assert.equal(imp1.status, 200)
    assert.equal(imp1.data.ok, true)
    assert.ok(imp1.data.importedCount >= 1, 'M16 explicit vault import must import personal notes')
    assert.equal(
      imp1.data.items.some(it => String(it.text || '').includes('pnpm verify')),
      false,
      'M16 importer must skip README.md developer docs',
    )
    assert.equal(
      imp1.data.items.some(it => String(it.text || '').includes('sk-vaultsecret1234567890abcd')),
      false,
      'M16 imported memories must scrub secrets',
    )
    assert.equal(fs.readFileSync(path.join(cleanVaultDir, 'personal.md'), 'utf8'), personalNotesTxt, 'M16 must remain strictly read-only')

    // 3. Optional emotionSplitView persistence
    const splitCfg = await invokeRoute('/api/dsh-chief/chief/config', {
      method: 'POST',
      body: {
        session: sidMain,
        externalMemory: {
          enabled: true,
          moodSlot: { enabled: true, kind: 'cordis', cordisProviderId: 'mock-mood', emotionSplitView: true },
        },
      },
    })
    assert.equal(splitCfg.status, 200)
    assert.equal(splitCfg.data.config.externalMemory.moodSlot.emotionSplitView, true, 'M16 emotionSplitView must persist in config')

    // 4. Slim 3-tab Memory Studio, 'book' default, icon alignment & anti-glare light theme markers
    const commonSrc16 = fs.readFileSync(path.join(PKG, 'src/client/components/common.js'), 'utf8')
    const panelSrc16 = fs.readFileSync(path.join(PKG, 'src/client/components/Panel.js'), 'utf8')
    const storeSrc16 = fs.readFileSync(path.join(PKG, 'src/client/store.js'), 'utf8')
    const extmemSrc16 = fs.readFileSync(path.join(PKG, 'src/client/tabs/extmem.js'), 'utf8')
    const clientBundle16 = fs.readFileSync(path.join(PKG, 'client.js'), 'utf8')
    assert.ok(commonSrc16.includes("case 'user':"), 'M16 common.js must define user icon')
    assert.ok(commonSrc16.includes("case 'heart':"), 'M16 common.js must define heart icon')
    assert.ok(storeSrc16.includes("extMemSubTab: 'book'"), 'M16 default extMemSubTab must be book (clean memory list)')
    assert.equal(panelSrc16.includes("{ k: 'diary'"), false, 'M16 standalone diary rail tab must be removed from Panel.js')
    assert.equal(panelSrc16.includes("{ k: 'prompts', zh: '提示词工坊'"), false, 'M16 prompts must not clutter primary extmem rail')
    assert.equal(extmemSrc16.includes('一键导入记忆'), false, 'M16 third-party node_modules scraping button must be removed')
    for (const marker of ['emotionSplitView', '高级调试与远程参数', '#e4dcd0', '#f3eee5', '#dde3ee', '#dfe9f5']) {
      assert.ok(clientBundle16.includes(marker), `M16 client.js must contain ${marker}`)
    }
    console.log('[M16 PASS] Subtraction, zero node_modules scraping, 3-tab Memory Studio, user icon & light theme verified')
  }

  // =========================================================================
  // M17: Out-of-the-box Guard Wall Preset Packs (3 streamlined packs + v1->v2 cleanup)
  // =========================================================================
  {
    const presetsMod = await import(modUrl('guard-wall-presets.js'))
    const execMod17 = await import(modUrl('chief-executor.js'))
    const prevWallsEnv = process.env.DSH_CHIEF_WALLS_FILE
    const m17WallsFile = path.join(tmpRoot, 'walls-m17.json')
    process.env.DSH_CHIEF_WALLS_FILE = m17WallsFile
    try {
      assert.equal(presetsMod.DEFAULT_GUARD_WALL_PRESETS.length, 3, 'M17 streamlined preset catalog must have exactly 3 presets')
      const seedRes1 = presetsMod.ensureDefaultGuardWallPresets({ cwd: wsDir })
      assert.equal(seedRes1.ok, true)
      assert.equal(seedRes1.seededIds.length, 2, 'M17 must seed 2 default-ON presets on fresh setup')
      assert.deepEqual(seedRes1.seededIds, ['preset-secret-files', 'preset-git-safety'])
      const listed1 = execMod17.listGuardWalls({ cwd: wsDir })
      assert.equal(listed1.some(w => w.id === 'preset-readonly-audit'), false, 'M17 readonly preset must stay off until toggled')

      // Physical pre-execute blocking with built-in safetyGuard off
      const secretDeny = execMod17.evaluatePreExecuteDefense({
        tool: 'read_file',
        args: { path: path.join(wsDir, '.env') },
        cwd: wsDir,
        board: {},
        safetyGuardEnabled: false,
      })
      assert.equal(secretDeny.decision, 'deny', 'M17 preset-secret-files must block reading .env out of the box')

      const gitDeny = execMod17.evaluatePreExecuteDefense({
        tool: 'run_command',
        args: { command: 'git push --force origin main' },
        cwd: wsDir,
        board: {},
        safetyGuardEnabled: false,
      })
      assert.equal(gitDeny.decision, 'deny', 'M17 preset-git-safety must block git push --force')

      // Pausing a preset persists and re-seeding is idempotent
      const pauseRes = execMod17.mutateGuardWalls({
        op: 'set_scope',
        wallId: 'preset-secret-files',
        scope: 'paused',
        cwd: wsDir,
        callerOrigin: 'human_ui',
        humanConfirmToken: execMod17.HUMAN_BOUNDS_CONFIRM_TOKEN,
      })
      assert.equal(pauseRes.ok, true)

      const seedRes2 = presetsMod.ensureDefaultGuardWallPresets({ cwd: wsDir })
      assert.equal(seedRes2.alreadySeeded, true, 'M17 re-seeding must be idempotent across calls')
      const secretAfterPause = execMod17.listGuardWalls({ cwd: wsDir }).find(w => w.id === 'preset-secret-files')
      assert.equal(secretAfterPause?.scope, 'paused', 'M17 re-seeding must never override manual pause')

      const secretAllow = execMod17.evaluatePreExecuteDefense({
        tool: 'read_file',
        args: { path: path.join(wsDir, '.env') },
        cwd: wsDir,
        board: {},
        safetyGuardEnabled: false,
      })
      assert.equal(secretAllow.decision, 'allow', 'M17 paused preset must immediately stop blocking')

      // Enabling optional readonly audit preset blocks file writes
      const roTpl = presetsMod.DEFAULT_GUARD_WALL_PRESETS.find(p => p.id === 'preset-readonly-audit')
      assert.ok(roTpl)
      const saveRo = execMod17.mutateGuardWalls({
        op: 'save',
        wall: {
          id: roTpl.id,
          title: roTpl.title,
          ruleType: roTpl.ruleType,
          patterns: [...roTpl.patterns],
          scope: 'global',
          reason: roTpl.reason,
          source: 'manual',
        },
        cwd: wsDir,
        callerOrigin: 'human_ui',
        humanConfirmToken: execMod17.HUMAN_BOUNDS_CONFIRM_TOKEN,
      })
      assert.equal(saveRo.ok, true)
      const roDeny = execMod17.evaluatePreExecuteDefense({
        tool: 'write_file',
        args: { path: path.join(wsDir, 'src', 'app.js') },
        cwd: wsDir,
        board: {},
        safetyGuardEnabled: false,
      })
      assert.equal(roDeny.decision, 'deny', 'M17 preset-readonly-audit must block write_file when switched ON')

      // v1 -> v2 upgrade cleanup: deprecated v1 presets are removed while user custom rules stay intact
      const m17UpgradeWallsFile = path.join(tmpRoot, 'walls-m17-upgrade.json')
      process.env.DSH_CHIEF_WALLS_FILE = m17UpgradeWallsFile
      const depSave = execMod17.mutateGuardWalls({
        op: 'save',
        wall: {
          id: 'preset-publish-gate',
          title: '对外发版与发布先请示',
          ruleType: 'require_approval_cmd',
          patterns: ['npm\\s+publish'],
          scope: 'global',
          source: 'manual',
        },
        cwd: wsDir,
        callerOrigin: 'human_ui',
        humanConfirmToken: execMod17.HUMAN_BOUNDS_CONFIRM_TOKEN,
      })
      assert.equal(depSave.ok, true)
      const userSave = execMod17.mutateGuardWalls({
        op: 'save',
        wall: {
          id: 'wall-user-keep',
          title: '老手手搓规则',
          ruleType: 'forbid_cmd',
          patterns: ['rm\\s+-rf\\s+dist'],
          scope: 'global',
          source: 'manual',
        },
        cwd: wsDir,
        callerOrigin: 'human_ui',
        humanConfirmToken: execMod17.HUMAN_BOUNDS_CONFIRM_TOKEN,
      })
      assert.equal(userSave.ok, true)

      const upgradeRes = presetsMod.ensureDefaultGuardWallPresets({ cwd: wsDir })
      assert.equal(upgradeRes.ok, true)
      assert.ok(upgradeRes.removedIds.includes('preset-publish-gate'), 'M17 v2 upgrade must remove deprecated v1 preset-publish-gate')
      assert.deepEqual(upgradeRes.seededIds, ['preset-secret-files', 'preset-git-safety'])
      const afterUpgrade = execMod17.listGuardWalls({ cwd: wsDir })
      assert.equal(afterUpgrade.some(w => w.id === 'preset-publish-gate'), false, 'M17 deprecated preset must be gone after upgrade')
      assert.ok(afterUpgrade.some(w => w.id === 'wall-user-keep'), 'M17 user custom rules must stay intact during v2 upgrade')
      assert.ok(afterUpgrade.some(w => w.id === 'preset-secret-files'))
      assert.ok(afterUpgrade.some(w => w.id === 'preset-git-safety'))

      const clientBundle17 = fs.readFileSync(path.join(PKG, 'client.js'), 'utf8')
      for (const marker of ['preset-secret-files', 'preset-git-safety', 'preset-readonly-audit', 'dnb-tpl-card', '恢复默认']) {
        assert.ok(clientBundle17.includes(marker), `M17 client.js must contain ${marker}`)
      }
      for (const removedMarker of ['preset-db-prod', 'preset-ci-workflow']) {
        assert.equal(clientBundle17.includes(removedMarker), false, `M17 client.js must not contain removed ${removedMarker}`)
      }
      const hooksSrc17 = fs.readFileSync(path.join(PKG, 'runtime-hooks.js'), 'utf8')
      assert.equal(hooksSrc17.includes('上下文压力：干预计数耗尽，交接单已自动生成并放入待领取'), false, 'M17 idle-guard exhaustion must NOT silently enqueue global pending-transfer')
      assert.ok(hooksSrc17.includes('交接单已保存至本会话看板'), 'M17 idle-guard exhaustion must back up handoff inside session board only')
      console.log('[M17 PASS] Guard wall 3-preset streamlining, v1->v2 cleanup, pre-execute block & UI markers verified')
    } finally {
      if (prevWallsEnv === undefined) delete process.env.DSH_CHIEF_WALLS_FILE
      else process.env.DSH_CHIEF_WALLS_FILE = prevWallsEnv
    }
  }
  console.log('\nALL V1.9.0 EXTERNAL MEMORY BRIDGE, EASTER EGG, DESKTOP & STUDIO GATES PASSED (M1–M17)')
} finally {
  for (const fn of cleanups) { const cleanups = []

try { fn() } catch {} }
  server.close()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
}
