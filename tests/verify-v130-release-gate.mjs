#!/usr/bin/env node
/**
 * Self-contained v1.3.0 Expanded Release Gate Suite (`npm run test:ci`).
 *
 * Covers all 4 expanded v1.3.0 bundles + CI contract checks using only isolated temp storage:
 *   G1. Facade exports (chief=67, index=6, archives=42), version sync ('1.3.0'), zero `export let/var`, acyclic imports
 *   G2. E1 cross-process `chief-state.json` O_EXCL lock (40/40 concurrent writes preserved) & `chief-audit.jsonl` persistence
 *   G3. HTTP `guard()` fail-closed (403 on thrown error) & `subagent-runtime.resolveModelInfo` window cache write-back
 *   G4. Red-team hardening (A1/A2/A3/B1/B2, #6 payloadHash tamper rejection, F2 unknown/replayed approval rejection + audit)
 *   G5. Bundle 3 post-elevation & post-approval auto-resume transaction loop (+ reject/expiry non-resume guards)
 *   G6. Bundle 4 unified batch suggestion execution (+ hard guard filtering) & panel non-bounce-back / true toggle
 *   G7. `precipitateNotes` end-to-end HTTP route (session + shared `noteIds` + secret redaction + board/cabinet sync)
 *   G8. R1 credential evasion hardening (`copy x ".\"env`, CMD `^` caret, plus zero false positives on `./env/setup.js`)
 *   G9. R2 multi-worker (`8 worker_threads`) concurrent `note.write` + `task.add` zero-loss durability
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PKG = path.resolve(__dirname, '..')
const SRC_CLIENT = path.join(PKG, 'src', 'client')

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-chief-v130-gate-'))
const tmpWs = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-chief-v130-ws-'))
process.env.DSH_HOME = tmpHome

const prevDocument = globalThis.document
const prevGetComputedStyle = globalThis.getComputedStyle

function parseLocalSpecs(filePath) {
  const src = fs.readFileSync(filePath, 'utf8')
  const deps = new Set()
  const re = /(?:^|\n)\s*(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"](\.[^'"]+)['"]/g
  let m
  while ((m = re.exec(src)) !== null) {
    deps.add(m[1])
  }
  return { src, deps: [...deps] }
}

function walkJs(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) walkJs(full, out)
    else if (ent.isFile() && ent.name.endsWith('.js')) out.push(full)
  }
  return out
}

function checkCycles(graph, label) {
  const state = new Map()
  const dfs = (node, stack) => {
    const st = state.get(node) || 0
    assert.notEqual(st, 1, `Circular dependency in ${label}: ${[...stack, node].join(' -> ')}`)
    if (st === 2) return
    state.set(node, 1)
    for (const nxt of (graph.get(node) || [])) dfs(nxt, [...stack, node])
    state.set(node, 2)
  }
  for (const k of graph.keys()) dfs(k, [])
}

function makeTestDeps(boardDir, { callLlmOverride, executeSubagentAction } = {}) {
  const { createBoardStore } = boardStoreMod
  const { createSubagentRuntime } = subRtModGlobal
  const { createBoardActions } = boardActionsMod
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
  const deps = {
    hostState: fakeHostState,
    resolveRootSessionId: sid => String(sid || '').trim() || 'global',
    getSessionCwd: () => tmpWs,
    resolveWorkspaceIdForSession: () => 'ws-v130-gate',
    boardFile: () => path.join(boardDir, 'board.json'),
    boardFileFor: sid => path.join(boardDir, `${String(sid || 'global').replace(/[^\w-]/g, '')}.json`),
    boardForSession: null,
    withBoardLock: null,
    loadBoard: null,
    saveBoard: null,
    runAction: null,
    appendBoardLog: (sid, msg, by = 'chief') => {
      const f = deps.boardFileFor(sid)
      return deps.withBoardLock(f, () => {
        const b = deps.loadBoard(f)
        b.logs = Array.isArray(b.logs) ? b.logs : []
        b.logs.push({ at: Date.now(), by, msg })
        deps.saveBoard(b, f)
      })
    },
    getLlm: () => null,
    getAttachments: () => null,
    runtime: { get: () => null },
    sharedBoardFile: () => path.join(boardDir, 'board.json'),
    sessionName: () => 'test',
    callLlmOverride,
  }
  Object.assign(deps, createBoardStore(deps))
  deps.boardFile = () => path.join(boardDir, 'board.json')
  deps.boardFileFor = sid => path.join(boardDir, `${String(sid || 'global').replace(/[^\w-]/g, '')}.json`)
  deps.sharedBoardFile = () => path.join(boardDir, 'board.json')
  Object.assign(deps, createSubagentRuntime(deps))
  deps.resolveRootSessionId = sid => String(sid || '').trim() || 'global'
  deps.getSessionCwd = () => tmpWs
  deps.refreshSubagentTree = async (_rt, rid) => [{ id: rid || 'global', name: 'lead', status: 'idle' }]
  deps.fetchTeamTasks = () => []
  deps.listSubagents = () => []
  if (executeSubagentAction) deps.executeSubagentAction = executeSubagentAction
  Object.assign(deps, createBoardActions(deps))
  return deps
}

let boardStoreMod
let boardActionsMod
let subRtModGlobal

try {
  const pkgJson = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8'))
  const chiefMod = await import(pathToFileURL(path.join(PKG, 'chief.js')).href)
  const indexMod = await import(pathToFileURL(path.join(PKG, 'index.js')).href)
  const archivesMod = await import(pathToFileURL(path.join(PKG, 'archives.js')).href)
  const execMod = await import(pathToFileURL(path.join(PKG, 'chief-executor.js')).href)
  const schemaMod = await import(pathToFileURL(path.join(PKG, 'board-schema.js')).href)
  boardStoreMod = await import(pathToFileURL(path.join(PKG, 'board-store.js')).href)
  boardActionsMod = await import(pathToFileURL(path.join(PKG, 'board-actions.js')).href)
  const routesMod = await import(pathToFileURL(path.join(PKG, 'api-routes.js')).href)
  const subRtMod = subRtModGlobal = await import(pathToFileURL(path.join(PKG, 'subagent-runtime.js')).href)
  const constMod = await import(pathToFileURL(path.join(PKG, 'src', 'client', 'constants.js')).href)
  const storeClientMod = await import(pathToFileURL(path.join(PKG, 'src', 'client', 'store.js')).href)

  // -------------------------------------------------------------------------
  // G1. Facade Exports, Version Alignment, Zero Mutable Exports, Acyclic DAG
  // -------------------------------------------------------------------------
  assert.match(String(pkgJson.version || ''), /^(?:1\.(?:[4-9]|[1-9]\d)|[2-9]\.\d+)\.\d+/, 'package.json version must be >= 1.4.0')
  assert.equal(schemaMod.BACKEND_BUILD, pkgJson.version, 'BACKEND_BUILD must align with package.json version')
  assert.equal(constMod.EXPECTED_BACKEND_BUILD, pkgJson.version, 'EXPECTED_BACKEND_BUILD must align with package.json version')
  assert.equal(Object.keys(indexMod).length, 6, 'index.js must export 6 symbols')
  assert.equal(Object.keys(chiefMod).length, 67, 'chief.js must export 67 symbols')
  assert.equal(Object.keys(archivesMod).length, 42, 'archives.js must export 42 symbols')
  for (const sym of ['auditJsonlPath', 'computeApprovalPayloadHash', 'withChiefStateLock', 'executeBatchSuggestions']) {
    assert.equal(typeof chiefMod[sym], 'function', `Missing chief.js export: ${sym}`)
  }

  const safetyDir = path.join(PKG, 'safety')
  const safetyFiles = fs.existsSync(safetyDir)
    ? fs.readdirSync(safetyDir).filter(f => f.endsWith('.js')).sort().map(f => `safety/${f}`)
    : []
  const backendFiles = [
    ...fs.readdirSync(PKG).filter(f => f.endsWith('.js') && f !== 'client.js').sort(),
    ...safetyFiles,
  ]
  const clientFiles = walkJs(SRC_CLIENT).sort()
  const backendGraph = new Map()
  for (const relF of backendFiles) {
    const full = path.join(PKG, relF)
    const { src, deps } = parseLocalSpecs(full)
    assert.equal(/^export\s+(?:let|var)\s+[A-Za-z0-9_$]+/m.test(src), false, `Forbidden mutable export in ${relF}`)
    backendGraph.set(
      relF,
      deps
        .map(d => {
          const resolved = path.relative(PKG, path.resolve(path.dirname(full), d)).replace(/\\/g, '/')
          return resolved.endsWith('.js') ? resolved : `${resolved}.js`
        })
        .filter(d => backendFiles.includes(d)),
    )
  }
  checkCycles(backendGraph, 'backend')
  for (const cf of clientFiles) {
    const src = fs.readFileSync(cf, 'utf8')
    assert.equal(/^export\s+(?:let|var)\s+[A-Za-z0-9_$]+/m.test(src), false, `Forbidden mutable export in ${path.relative(PKG, cf)}`)
  }
  console.log('✓ G1 passed: facades (6/67/42), v1.4.0 version sync, zero mutable exports, 0 cycles')

  // -------------------------------------------------------------------------
  // G2. E1 Cross-Process `chief-state.json` Lock & `chief-audit.jsonl` Log
  // -------------------------------------------------------------------------
  const stateUrl = pathToFileURL(path.join(PKG, 'chief-state.js')).href
  const childCode = `
    import { mutateChiefState, pushAuditToWs, ensureWorkspace } from ${JSON.stringify(stateUrl)};
    const side = process.env.RT_SIDE;
    const count = Number(process.env.RT_N || 20);
    for (let i = 0; i < count; i += 1) {
      mutateChiefState((s) => {
        const ws = ensureWorkspace(s, 'global');
        pushAuditToWs(ws, { mode: 'advisor', stage: 'lock_race', decision: 'recorded', operation: 'concurrent-write', target: side, reason: side + '-' + i, outcome: 'ok', by: side }, 'global');
      });
    }
  `
  const N = 20
  await Promise.all(['A', 'B'].map(side => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', childCode], {
      env: { ...process.env, DSH_HOME: tmpHome, RT_SIDE: side, RT_N: String(N) },
      stdio: 'pipe',
    })
    let stderr = ''
    child.stderr?.on('data', d => { stderr += String(d) })
    child.on('exit', code => {
      if (code === 0) resolve()
      else reject(new Error(`E1 child ${side} exited ${code}: ${stderr}`))
    })
  })))

  const racedState = chiefMod.loadChiefState({ forceDisk: true })
  const racedLog = racedState.workspaces.global.auditLog || []
  const aCnt = racedLog.filter(e => /^A-\d+$/.test(e.reason || '')).length
  const bCnt = racedLog.filter(e => /^B-\d+$/.test(e.reason || '')).length
  assert.equal(aCnt, N, `Expected all ${N} concurrent writes from A, got ${aCnt}`)
  assert.equal(bCnt, N, `Expected all ${N} concurrent writes from B, got ${bCnt}`)

  const jsonlFile = chiefMod.auditJsonlPath()
  assert.ok(fs.existsSync(jsonlFile), 'chief-audit.jsonl must be created independently')
  const jsonlRows = fs.readFileSync(jsonlFile, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
  const jsonlA = jsonlRows.filter(r => /^A-\d+$/.test(r.reason || '')).length
  const jsonlB = jsonlRows.filter(r => /^B-\d+$/.test(r.reason || '')).length
  assert.equal(jsonlA, N, 'chief-audit.jsonl must preserve all A audit rows')
  assert.equal(jsonlB, N, 'chief-audit.jsonl must preserve all B audit rows')
  console.log('✓ G2 passed: E1 cross-process O_EXCL lock (40/40 writes) & chief-audit.jsonl append-only log')

  // -------------------------------------------------------------------------
  // G3. HTTP `guard()` Fail-Closed + `subagent-runtime.resolveModelInfo`
  // -------------------------------------------------------------------------
  const guardDeps = makeTestDeps(path.join(tmpHome, 'boards-g3'))
  guardDeps.runtime = {
    get: name => name === 'connection'
      ? { requestRejection: () => { throw new Error('connection guard exploded') } }
      : null,
  }
  const apiFactory = routesMod.createApiRoutes({
    ...guardDeps,
    collectDigestArchiveContext: () => ({ takenOutArchives: [], sessionArchiveBriefs: [], smartCompactActive: false, chiefPermissionMode: 'advisor' }),
    collectDeskItemsForUi: () => [],
    collectLinkedPeerDigestContext: () => ({ linkedPeersCount: 0, linkedPeersProgress: [] }),
    defaultTargetForSession: () => 'new',
    executeSubagentAction: async () => ({ ok: false }),
    fetchTeamTasks: () => [],
    getSessionContextBreakdown: () => ({}),
    listSubagents: () => [],
    makeChiefDeps: () => guardDeps,
    readPending: () => null,
    readPendingDeploy: () => null,
    refreshSubagentTree: async () => [],
    resolveAgentIdentity: () => null,
    resolveEffectiveHandoff: () => ({ text: '', autoText: '' }),
    runtimeHealth: () => ({}),
    sessionName: () => 'test',
    transferChief: async () => ({ ok: false }),
    transcriptTimes: () => new Map(),
  })
  const routes = apiFactory.routeTable(guardDeps.runtime)
  const snapshotRoute = routes.find(r => r.path === '/api/dsh-chief/snapshot')
  assert.ok(snapshotRoute, 'snapshot route must exist')
  let guardBody = ''
  const mockRes = {
    statusCode: 0,
    setHeader() {},
    end(txt) { guardBody = String(txt || '') },
  }
  await snapshotRoute.handler({ url: '/api/dsh-chief/snapshot', headers: {} }, mockRes)
  assert.equal(mockRes.statusCode, 403, `guard() exception MUST fail closed with 403, got ${mockRes.statusCode}`)
  assert.equal(JSON.parse(guardBody).ok, false)

  const rtDeps = makeTestDeps(path.join(tmpHome, 'boards-g3b'))
  rtDeps.hostState.activeLlm = {
    resolveModelInfo: (prov, mod) => prov === 'syncprov'
      ? { contextWindow: 256000 }
      : (prov === 'asyncprov' ? Promise.resolve({ contextWindow: 512000 }) : Promise.reject(new Error('missing adapter'))),
  }
  rtDeps.hostState.activeRuntime = {
    get: name => name === 'agents'
      ? {
          get: id => ({
            id,
            session: {
              ownEvents: () => [],
              requestHeader: () => ({
                config: {
                  provider: id === 's1' ? 'syncprov' : (id === 's3' ? 'asyncprov' : 'opendesign'),
                  model: 'm1',
                },
              }),
            },
          }),
        }
      : null,
  }
  const subRt = subRtMod.createSubagentRuntime(rtDeps)
  const brkSync = subRt.getSessionContextBreakdown(rtDeps.hostState.activeRuntime, 's1')
  assert.equal(brkSync.contextWindow, 256000, 'Synchronous resolveModelInfo contextWindow must apply immediately')
  const brkOpendesign = subRt.getSessionContextBreakdown(rtDeps.hostState.activeRuntime, 's2')
  assert.ok(brkOpendesign.contextWindow > 0, 'opendesign guard must prevent resolving removed provider without crash')
  subRt.getSessionContextBreakdown(rtDeps.hostState.activeRuntime, 's3')
  await Promise.resolve()
  const brkAsync2 = subRt.getSessionContextBreakdown(rtDeps.hostState.activeRuntime, 's3')
  assert.equal(brkAsync2.contextWindow, 512000, 'Async resolveModelInfo must populate modelWindowCache for next read')
  console.log('✓ G3 passed: HTTP guard() fail-closed 403 & resolveModelInfo contextWindow write-back')

  // -------------------------------------------------------------------------
  // G4. Red-Team Hardening Suite (A1, A2, A3, B1, B2, #6, F2)
  // -------------------------------------------------------------------------
  const boardPush = { bounds: { forbidden: ['禁止 git push'] } }
  const boardKey = { bounds: { forbidden: ['禁止触碰 secret.key'] } }
  const encPs = 'powershell -EncodedCommand ' + Buffer.from('git push origin main', 'utf16le').toString('base64')
  assert.equal(execMod.checkForbiddenBounds(boardPush, 'run_command', 'git\\ push origin main').blocked, true, 'A1 backslash must block')
  assert.equal(execMod.checkForbiddenBounds(boardPush, 'run_command', 'git\\\\ push origin main').blocked, true, 'A1 double backslash must block')
  assert.equal(execMod.checkForbiddenBounds(boardPush, 'run_command', 'cmd /c git push origin main').blocked, true, 'A1 cmd /c must block')
  assert.equal(execMod.checkForbiddenBounds(boardPush, 'run_command', 'git -c http.proxy=x push origin main').blocked, true, 'A1 git flag insertion must block')
  assert.equal(execMod.checkForbiddenBounds(boardPush, 'run_command', encPs).blocked, true, 'A1 -EncodedCommand must block')
  assert.equal(execMod.checkForbiddenBounds(boardPush, 'run_command', 'ｇｉｔ　ｐｕｓｈ origin main').blocked, true, 'A1 fullwidth must block')

  const g4Deps = makeTestDeps(path.join(tmpHome, 'boards-g4'))
  const a2Res = await execMod.executeChiefToolCall(g4Deps, {
    tool: 'write_file',
    args: { path: 'ok.txt', content: 'config: secret.key leaked here' },
  }, { rootId: 'g4', cwd: tmpWs, permissionMode: 'chief', hasChiefRiskAck: true, board: boardKey })
  assert.equal(a2Res.blockedBySafetyGuard, true, 'A2 write_file content redline must block')

  const a3Res = await execMod.executeChiefToolCall(g4Deps, {
    tool: 'edit_file',
    args: { path: 'safe.txt', target: 'foo', replacement: 'use secret.key' },
  }, { rootId: 'g4', cwd: tmpWs, permissionMode: 'chief', hasChiefRiskAck: true, board: boardKey })
  assert.equal(a3Res.blockedBySafetyGuard, true, 'A3 edit_file replacement redline must block')

  assert.equal(execMod.evaluateSafetyGuardHardRules({ command: 'cmd /c type nul > %tmp%\\..env' }).blocked, true, 'B1 %tmp%..env must block')
  assert.equal(execMod.evaluateSafetyGuardHardRules({ command: 'copy x ".\"env' }).blocked, true, 'B1 quote-split must block')
  assert.equal(execMod.evaluateSafetyGuardHardRules({ command: 'powershell $p=\'.\'+\'env\'; ni $p' }).blocked, true, 'B1 PS concat must block')
  assert.equal(execMod.evaluateSafetyGuardHardRules({ command: 'node -e "console.log(process.env.NODE_ENV)"' }).blocked, false, 'process.env must NOT false-positive')
  assert.equal(execMod.evaluateSafetyGuardHardRules({ command: 'echo $env:TEMP' }).blocked, false, '$env:TEMP must NOT false-positive')
  assert.equal(execMod.evaluateSafetyGuardHardRules({ tool: 'write_file', opClass: 'workspace', targetPath: 'safe.txt:.env', board: {} }).blocked, true, 'B2 NTFS ADS must block')

  const realSecretEnv = path.join(tmpWs, '.env')
  fs.writeFileSync(realSecretEnv, 'SECRET=123\n', 'utf8')
  const symlinkPath = path.join(tmpWs, 'harmless-link.txt')
  let symlinkTested = false
  try {
    fs.symlinkSync(realSecretEnv, symlinkPath)
    symlinkTested = true
  } catch {
    // Windows non-elevated symlink fallback using junction to dir or skip if OS policy denies
  }
  if (symlinkTested) {
    assert.equal(
      execMod.evaluateSafetyGuardHardRules({ tool: 'write_file', opClass: 'workspace', targetPath: symlinkPath, board: {} }).blocked,
      true,
      'B2 symlink to .env must block',
    )
  }

  // #6 payloadHash tamper rejection
  const tamperFile = path.join(tmpWs, 'tamper-original.txt')
  const evilFile = path.join(tmpWs, 'tamper-evil.txt')
  const queuedTamper = chiefMod.queueChiefApproval('g4-tamper', {
    kind: 'tool',
    operationLabel: '写入工作区文件',
    targetLabel: 'tamper-original.txt',
    payload: { tool: 'write_file', args: { path: tamperFile, content: 'hello' }, cwd: tmpWs, rootId: 'g4-tamper' },
  })
  assert.match(queuedTamper.payloadHash, /^[0-9a-f]{64}$/, 'pendingApproval must carry 64-char SHA-256 payloadHash')
  const statePath = path.join(tmpHome, 'chief', 'chief-state.json')
  const rawDisk = JSON.parse(fs.readFileSync(statePath, 'utf8'))
  rawDisk.workspaces['g4-tamper'].pendingApprovals[0].payload.args.path = evilFile
  fs.writeFileSync(statePath, JSON.stringify(rawDisk, null, 2), 'utf8')
  chiefMod.loadChiefState({ forceDisk: true })
  const tamperOut = await chiefMod.handleApprovalDecision(g4Deps, {
    sessionId: 'g4-tamper',
    approvalId: queuedTamper.id,
    decision: 'approve',
  })
  assert.equal(tamperOut.ok, false)
  assert.equal(tamperOut.tampered, true, '#6 tampered approval payload must be rejected')
  assert.equal(fs.existsSync(evilFile), false, 'tampered write MUST NOT touch disk')

  // F2 unknown + replayed approval audit
  const f2Unknown = await chiefMod.handleApprovalDecision(g4Deps, { sessionId: 'g4-tamper', approvalId: 'fake-id-999', decision: 'approve' })
  assert.equal(f2Unknown.ok, false)
  const legitApr = chiefMod.queueChiefApproval('g4-tamper', {
    kind: 'tool',
    operationLabel: '写入合规文件',
    targetLabel: 'legit.txt',
    payload: { tool: 'write_file', args: { path: path.join(tmpWs, 'legit.txt'), content: 'safe' }, cwd: tmpWs, rootId: 'g4-tamper' },
  })
  const leg1 = await chiefMod.handleApprovalDecision(g4Deps, { sessionId: 'g4-tamper', approvalId: legitApr.id, decision: 'approve' })
  assert.equal(leg1.ok, true)
  const legReplay = await chiefMod.handleApprovalDecision(g4Deps, { sessionId: 'g4-tamper', approvalId: legitApr.id, decision: 'approve' })
  assert.equal(legReplay.ok, false)
  const tamperAudit = chiefMod.loadChiefState({ forceDisk: true }).workspaces['g4-tamper'].auditLog
  assert.ok(tamperAudit.some(a => a.decision === 'tampered_approval_payload'), '#6 audit entry required')
  assert.ok(tamperAudit.some(a => a.decision === 'invalid_approval_id'), 'F2 unknown ID audit entry required')
  assert.ok(tamperAudit.some(a => a.decision === 'replayed_approval'), 'F2 replay audit entry required')
  console.log('✓ G4 passed: A1/A2/A3/B1/B2 hard guards, #6 payloadHash tamper lock, F2 spoof/replay audit')

  // -------------------------------------------------------------------------
  // G5. Bundle 3 Post-Elevation & Post-Approval Auto-Resume Transaction Loop
  // -------------------------------------------------------------------------
  // 5a: L0 -> request write_file -> elevation popup -> approve to L3 -> auto-resumes & writes file!
  const sessElev = 'g5-elev'
  const elevOutFile = path.join(tmpWs, 'after-elevation.txt')
  const g5Deps = makeTestDeps(path.join(tmpHome, 'boards-g5'), {
    callLlmOverride: async ({ prompt }) => {
      if (prompt.includes('第 1 步实权工具真实执行结果')) {
        return {
          ok: true,
          text: JSON.stringify({ reply: '当前为 L0 只读档，已向您提交提权申请，批准后将自动续跑写入。' }),
        }
      }
      if (prompt.includes('系统授权恢复执行上下文')) {
        return {
          ok: true,
          text: JSON.stringify({
            reply: '已获 L3 提权，立即补写文件',
            toolCalls: [{ tool: 'write_file', args: { path: elevOutFile, content: 'ELEV_OK' } }],
          }),
        }
      }
      return {
        ok: true,
        text: JSON.stringify({
          reply: '尝试写入文件',
          toolCalls: [{ tool: 'write_file', args: { path: elevOutFile, content: 'ELEV_OK' } }],
        }),
      }
    },
  })

  const askL0 = await chiefMod.askOrCommandChief(g5Deps, {
    sessionId: sessElev,
    text: '请帮我创建 after-elevation.txt 写入 ELEV_OK',
  })
  assert.ok(askL0.elevationRequested && askL0.elevationRequested.resumeTaskId, 'L0 denial must attach resumeTaskId to pendingElevation')

  const elevApproved = await chiefMod.handleElevationDecision(g5Deps, {
    sessionId: sessElev,
    elevationId: askL0.elevationRequested.id,
    decision: 'approve',
    targetMode: 'chief',
    confirmedChiefRisk: true,
  })
  assert.equal(elevApproved.ok, true)
  assert.equal(elevApproved.resumed, true, 'Approving elevation MUST auto-resume original task')
  assert.equal(fs.readFileSync(elevOutFile, 'utf8'), 'ELEV_OK', 'Auto-resumed turn must have written file cleanly')
  const stElev = chiefMod.loadChiefState({ forceDisk: true }).workspaces[sessElev]
  assert.equal(stElev.resumeTasks[0].status, 'completed')
  assert.equal(stElev.chat.filter(c => c.role === 'user').length, 1, 'Resume turn MUST NOT duplicate user chat message')
  assert.ok(stElev.chat.some(c => c.kind === 'receipt' && /ELEV_OK|自动续跑/.test(JSON.stringify(c))), 'Receipt entry required')

  // 5b: L2 strategist -> queue write_file -> approve -> executes write_file AND auto-resumes verification receipt!
  const sessApr = 'g5-l2-resume'
  chiefMod.updateChiefConfig({ sessionId: sessApr, permissionMode: 'strategist' })
  const l2TargetFile = path.join(tmpWs, 'l2-resumed.txt')
  const g5L2Deps = makeTestDeps(path.join(tmpHome, 'boards-g5-l2'), {
    callLlmOverride: async ({ prompt }) => {
      if (prompt.includes('第 1 步实权工具真实执行结果')) {
        return {
          ok: true,
          text: JSON.stringify({
            reply: prompt.includes('系统授权恢复执行上下文')
              ? '- 【✅ L2 授权后自动核验完成】已核实 L2_RESUMED_V1 写入成功。'
              : '已提交 write_file 等待逐项确认',
          }),
        }
      }
      if (prompt.includes('系统授权恢复执行上下文')) {
        return {
          ok: true,
          text: JSON.stringify({
            reply: '读取验证',
            toolCalls: [{ tool: 'read_file', args: { path: l2TargetFile } }],
          }),
        }
      }
      return {
        ok: true,
        text: JSON.stringify({
          reply: '请求写入文件',
          toolCalls: [{ tool: 'write_file', args: { path: l2TargetFile, content: 'L2_RESUMED_V1' } }],
        }),
      }
    },
  })
  const askL2 = await chiefMod.askOrCommandChief(g5L2Deps, {
    sessionId: sessApr,
    text: '请创建 l2-resumed.txt 写入 L2_RESUMED_V1 并读回验证',
  })
  assert.equal(askL2.pendingApprovals.length, 1)
  assert.ok(askL2.pendingApprovals[0].resumeTaskId, 'L2 approval must carry resumeTaskId')
  const l2Approved = await chiefMod.handleApprovalDecision(g5L2Deps, {
    sessionId: sessApr,
    approvalId: askL2.pendingApprovals[0].id,
    decision: 'approve',
  })
  assert.equal(l2Approved.ok, true)
  assert.equal(l2Approved.executed, true)
  assert.equal(l2Approved.resumed, true, 'L2 tool approval MUST trigger continuation resume')
  assert.equal(fs.readFileSync(l2TargetFile, 'utf8'), 'L2_RESUMED_V1')
  assert.match(l2Approved.resumeReply || '', /自动核验完成/)

  // 5c: Reject cancels resumeTask & expired task never auto-resumes
  const sessReject = 'g5-reject'
  chiefMod.updateChiefConfig({ sessionId: sessReject, permissionMode: 'strategist' })
  let rejResumeCalls = 0
  const g5RejDeps = makeTestDeps(path.join(tmpHome, 'boards-g5-rej'), {
    callLlmOverride: async ({ prompt }) => {
      if (prompt.includes('系统授权恢复执行上下文')) rejResumeCalls += 1
      if (prompt.includes('第 1 步实权工具真实执行结果')) {
        return { ok: true, text: JSON.stringify({ reply: '等待用户决定是否允许本次操作' }) }
      }
      return {
        ok: true,
        text: JSON.stringify({
          reply: '待批准',
          toolCalls: [{ tool: 'write_file', args: { path: path.join(tmpWs, 'should-not-exist.txt'), content: 'NO' } }],
        }),
      }
    },
  })
  const askRej = await chiefMod.askOrCommandChief(g5RejDeps, { sessionId: sessReject, text: '写入拒绝测试文件' })
  await chiefMod.handleApprovalDecision(g5RejDeps, { sessionId: sessReject, approvalId: askRej.pendingApprovals[0].id, decision: 'reject' })
  assert.equal(rejResumeCalls, 0, 'Rejected approval MUST NOT invoke resume LLM turn')
  assert.equal(chiefMod.loadChiefState({ forceDisk: true }).workspaces[sessReject].resumeTasks[0].status, 'cancelled')

  // Expired resumeTask guard
  const sessExp = 'g5-expired'
  chiefMod.updateChiefConfig({ sessionId: sessExp, permissionMode: 'strategist' })
  let expResumeCalls = 0
  const g5ExpDeps = makeTestDeps(path.join(tmpHome, 'boards-g5-exp'), {
    callLlmOverride: async ({ prompt }) => {
      if (prompt.includes('系统授权恢复执行上下文')) expResumeCalls += 1
      if (prompt.includes('第 1 步实权工具真实执行结果')) {
        return { ok: true, text: JSON.stringify({ reply: '等待授权' }) }
      }
      return {
        ok: true,
        text: JSON.stringify({
          reply: '待批准',
          toolCalls: [{ tool: 'write_file', args: { path: path.join(tmpWs, 'exp-file.txt'), content: 'EXP_ONLY' } }],
        }),
      }
    },
  })
  const askExp = await chiefMod.askOrCommandChief(g5ExpDeps, { sessionId: sessExp, text: '写入过期事务测试文件' })
  chiefMod.mutateChiefState((s) => {
    s.workspaces[sessExp].resumeTasks[0].expiresAt = Date.now() - 10_000
  })
  const expApproved = await chiefMod.handleApprovalDecision(g5ExpDeps, {
    sessionId: sessExp,
    approvalId: askExp.pendingApprovals[0].id,
    decision: 'approve',
  })
  assert.equal(expApproved.executed, true, 'Approved single tool step should still run')
  assert.equal(Boolean(expApproved.resumed), false, 'Expired resumeTask MUST NOT auto-resume')
  assert.equal(expResumeCalls, 0)
  assert.equal(chiefMod.loadChiefState({ forceDisk: true }).workspaces[sessExp].resumeTasks[0].status, 'expired')
  console.log('✓ G5 passed: Bundle 3 elevation & L2 approval auto-resume loops (+ cancellation guard)')

  // -------------------------------------------------------------------------
  // G6. Bundle 4 Batch Suggestions + Panel Toggle & Non-Bounce-Back
  // -------------------------------------------------------------------------
  const sessBatch = 'g6-batch'
  const deliveredRelays = []
  const g6Deps = makeTestDeps(path.join(tmpHome, 'boards-g6'))
  g6Deps.runtime = {
    get: name => name === 'agents'
      ? {
          list: () => [{ id: sessBatch, status: 'idle', name: '主对话', model: 'm' }],
          get: id => id === sessBatch ? { id, status: 'idle', followup: txt => deliveredRelays.push(txt) } : null,
        }
      : null,
  }
  g6Deps.runAction({ action: 'bounds.add', field: 'forbidden', item: '禁止 git push', session: sessBatch, by: 'user' })
  // Seed pending suggestions via state mutation
  chiefMod.mutateChiefState((s) => {
    const ws = s.workspaces[sessBatch] = s.workspaces[sessBatch] || {}
    ws.suggestions = [
      { id: 'sug-bound-1', kind: 'bound', boundField: 'allowed', title: '必做：跑单测', draftText: '修改后运行 npm test', reason: '规范', target: 'bounds', status: 'pending' },
      { id: 'sug-advice-1', kind: 'advice', title: '让主对话补充检查', draftText: '请检查 boundary 配置', reason: '收尾建议', target: 'lead', status: 'pending' },
      { id: 'sug-evil-1', kind: 'relay', title: '触发红线越界建议', draftText: 'git\\ push origin main', reason: '危险推送', target: 'lead', status: 'pending' },
      { id: 'sug-goal-1', kind: 'goal_approval', title: '目标达标请示', draftText: '全部完成', reason: '验收完结', target: 'board', status: 'pending' },
    ]
  })
  const batchOut = await chiefMod.executeBatchSuggestions(g6Deps, { sessionId: sessBatch, includeGoalApproval: false })
  assert.equal(batchOut.ok, true)
  assert.equal(batchOut.executedCount, 2, 'Should execute safe bound + advice suggestions')
  assert.equal(batchOut.blockedCount, 1, 'Unsafe git push suggestion MUST be blocked by Safety Guard')
  assert.equal(batchOut.skippedGoalCount, 1, 'Goal approval must wait unless explicitly included')
  assert.ok(batchOut.summaries.length >= 3)
  const stBatch = chiefMod.loadChiefState({ forceDisk: true }).workspaces[sessBatch]
  assert.equal(stBatch.suggestions.find(s => s.id === 'sug-goal-1').status, 'pending')
  assert.ok(stBatch.chat.some(c => c.kind === 'receipt' && (c.actions || []).some(a => a.includes('执行建议'))))

  // Panel non-bounce-back + true toggle regression check (Bundle 1 UI bugfix)
  let dockExpanded = false
  let rightTabOpened = false
  const fakeSidebarRight = {
    openTab: () => { rightTabOpened = true; dockExpanded = true },
    isExpanded: () => dockExpanded,
    toggleExpanded: () => { dockExpanded = !dockExpanded },
  }
  const fakeEmptyNode = {
    querySelectorAll: () => [{ children: [] }],
    querySelector: () => null,
  }
  globalThis.document = {
    querySelector: sel => (sel === '[data-dockkit-empty]' && !rightTabOpened ? fakeEmptyNode : null),
  }
  globalThis.getComputedStyle = () => ({ visibility: 'visible', display: 'block' })
  storeClientMod.runtimeRefs.hostCtx = { get: name => (name === 'sidebarRight' ? fakeSidebarRight : null) }
  storeClientMod.runtimeRefs.initialRightbarSeeded = false
  storeClientMod.runtimeRefs.userDismissedChief = false
  storeClientMod.patch({ open: false, dock: false, panel: '' })

  assert.equal(storeClientMod.seedRightbarIfEmpty(), true, 'First boot empty rightbar should seed Chief once')
  assert.equal(dockExpanded, true)
  storeClientMod.patch({ dock: true })
  assert.equal(storeClientMod.toggleChief(), 'dock', 'toggleChief while dock expanded must collapse dock')
  assert.equal(dockExpanded, false, 'toggleChief must collapse rightbar')
  assert.equal(storeClientMod.seedRightbarIfEmpty(), false, 'Closing panel MUST NEVER auto-reopen via seedRightbarIfEmpty!')
  assert.equal(dockExpanded, false, 'Rightbar must remain collapsed after user closed it')
  assert.equal(storeClientMod.toggleChief(), 'dock', 'Clicking bottom trigger while closed must reopen Chief')
  assert.equal(dockExpanded, true)
  console.log('✓ G6 passed: Bundle 4 unified batch suggestions & panel non-bounce-back / true toggle')

  // -------------------------------------------------------------------------
  // G7. `precipitateNotes` (一键收纳入柜) End-to-End Sweep
  // -------------------------------------------------------------------------
  const sessSweep = 'g7-sweep-sess'
  const g7Deps = makeTestDeps(path.join(tmpHome, 'chief'))
  Object.assign(g7Deps, boardStoreMod.createBoardStore(g7Deps))
  Object.assign(g7Deps, boardActionsMod.createBoardActions(g7Deps))
  g7Deps.sharedBoardFile = () => g7Deps.boardFile()
  g7Deps.runtime = {
    get: name => name === 'connection' ? { requestRejection: () => 0 } : null,
  }
  const rLocal = g7Deps.runAction({
    action: 'note.write',
    session: sessSweep,
    title: '本会话临时便签-1',
    body: '含测试令牌 sk-test1234567890abcdef1234 需要自动脱敏入柜',
    by: 'user',
  })
  assert.equal(rLocal.ok, true)
  const rShared = g7Deps.runAction({
    action: 'note.write',
    scope: 'shared',
    title: '共享临时便签-2',
    body: '这条共享便签在前台横幅可见，应可被显式 noteIds 精准收纳入柜',
    by: 'user',
  })
  assert.equal(rShared.ok, true)
  const mergedBefore = g7Deps.boardForSession(g7Deps.boardFileFor(sessSweep))
  assert.equal(mergedBefore.notes.length, 2, 'Banner view must see both local and shared notes before sweep')
  const sweptNoteIds = mergedBefore.notes.map(n => n.id)

  const makeG7Target = (rootId, opts = {}) => ({
    customSharedBoardFile: g7Deps.boardFile(),
    cwd: tmpWs,
    vaultScope: opts.vaultScope === 'global' ? 'global' : 'session',
    rootSessionId: rootId,
    ...(opts.cabinetId ? { cabinetId: opts.cabinetId } : {}),
  })
  const g7Routes = routesMod.createApiRoutes({
    ...g7Deps,
    archiveTarget: (rt, rootId, opts = {}) => makeG7Target(rootId, opts),
    boundaries: () => ({ allowed: [], forbidden: [], notes: [] }),
    collectDigestArchiveContext: () => ({ takenOutArchives: [], sessionArchiveBriefs: [], smartCompactActive: false, chiefPermissionMode: 'advisor' }),
    collectDeskItemsForUi: () => [],
    collectLinkedPeerDigestContext: () => ({ linkedPeersCount: 0, linkedPeersProgress: [] }),
    defaultTargetForSession: () => 'new',
    executeSubagentAction: async () => ({ ok: false }),
    fetchTeamTasks: () => [],
    getSessionContextBreakdown: () => ({}),
    linkedPeersForSession: () => [],
    listSubagents: () => [],
    makeChiefDeps: () => g7Deps,
    probeSubagentSupport: () => ({ supported: true }),
    readPending: () => null,
    readPendingDeploy: () => null,
    refreshSubagentTree: async () => [],
    resolveAgentIdentity: () => null,
    resolveEffectiveHandoff: () => ({ text: '', autoText: '' }),
    runtimeHealth: () => ({}),
    sessionName: () => 'test',
    transferChief: async () => ({ ok: false }),
    transcriptTimes: () => new Map(),
  }).routeTable(g7Deps.runtime)
  const archivesRoute = g7Routes.find(r => r.path === '/api/dsh-chief/archives')
  assert.ok(archivesRoute, '/api/dsh-chief/archives route must exist')
  const postPayload = JSON.stringify({
    op: 'precipitateNotes',
    session: sessSweep,
    vaultScope: 'session',
    noteIds: sweptNoteIds,
  })
  const mockPostReq = Readable.from([Buffer.from(postPayload, 'utf8')])
  mockPostReq.url = '/api/dsh-chief/archives'
  mockPostReq.method = 'POST'
  mockPostReq.headers = { host: '127.0.0.1', 'content-type': 'application/json' }
  let g7Raw = ''
  const mockPostRes = { statusCode: 0, setHeader() {}, end(txt) { g7Raw = String(txt || '') } }
  await archivesRoute.handler(mockPostReq, mockPostRes)
  assert.equal(mockPostRes.statusCode, 200, `Expected 200 from /archives, got ${mockPostRes.statusCode}: ${g7Raw}`)
  const g7Json = JSON.parse(g7Raw)
  assert.equal(g7Json.ok, true)
  assert.equal(g7Json.sweptCount, 2, 'Both session note and selected shared note must be swept')
  assert.equal(g7Json.board.notes.length, 0, 'Returned board.notes must be empty after sweep')
  assert.equal(g7Json.archives.items.length, 2, 'Both swept notes must appear in session archive cabinet')
  assert.equal(g7Json.counts.sessionCount, 2, 'Session count badge must reflect 2 swept dossiers')
  const redactedItem = g7Json.archives.items.find(it => it.title === '本会话临时便签-1')
  assert.ok(redactedItem, 'Redacted note must be saved')
  const redactedDetail = archivesMod.getArchiveDetail(
    redactedItem.id,
    sessSweep,
    makeG7Target(sessSweep, { vaultScope: 'session' }),
  )
  assert.ok(redactedDetail.ok && redactedDetail.item.body.includes('[REDACTED]'), 'Secret token in swept note must be redacted')
  console.log('✓ G7 passed: precipitateNotes sweeps session + matched shared notes with redaction & immediate sync')

  // -------------------------------------------------------------------------
  // G8. R1 Credential Quote-Backslash & Caret Evasion Hardening (0 false-positives)
  // -------------------------------------------------------------------------
  assert.equal(
    execMod.evaluateSafetyGuardHardRules({ command: String.raw`copy x ".\"env` }).blocked,
    true,
    'R1 quote-backslash .env obfuscation (variant B) MUST be blocked',
  )
  assert.equal(
    execMod.evaluateSafetyGuardHardRules({ command: String.raw`copy x ".\\"env` }).blocked,
    true,
    'R1 quote-double-backslash .env obfuscation (variant A) MUST be blocked',
  )
  assert.equal(
    execMod.evaluateSafetyGuardHardRules({ command: String.raw`copy x '.\'env` }).blocked,
    true,
    'R1 single-quote backslash .env obfuscation MUST be blocked',
  )
  assert.equal(
    execMod.evaluateSafetyGuardHardRules({ command: String.raw`copy x "."\env` }).blocked,
    true,
    'R1 post-quote backslash .env obfuscation MUST be blocked',
  )
  assert.equal(
    execMod.evaluateSafetyGuardHardRules({ command: 'copy x .^e^n^v' }).blocked,
    true,
    'CMD caret ^ .env obfuscation MUST be blocked',
  )
  assert.equal(
    execMod.evaluateSafetyGuardHardRules({ command: String.raw`node .\env\setup.js` }).blocked,
    false,
    'Legitimate .\\env\\ directory path MUST NOT false-positive',
  )
  assert.equal(
    execMod.evaluateSafetyGuardHardRules({ command: 'echo %NODE_ENV% && echo $env:TEMP' }).blocked,
    false,
    'Legitimate %NODE_ENV% and $env:TEMP MUST NOT false-positive',
  )
  for (const mixedCmd of [
    `cat '.'+"env"`,
    `cat "."+'e'+"nv"`,
    `cat '.cre'+"dentials"`,
    `cat "id_"+'rsa'`,
  ]) {
    assert.equal(
      execMod.evaluateSafetyGuardHardRules({ command: mixedCmd }).blocked,
      true,
      `Mixed-quote credential split (${mixedCmd}) MUST be blocked`,
    )
  }
  for (const safeMixedCmd of [
    `echo 'hello' + "world"`,
    `node -e "console.log('a' + 'b')"`,
  ]) {
    assert.equal(
      execMod.evaluateSafetyGuardHardRules({ command: safeMixedCmd }).blocked,
      false,
      `Safe mixed-quote command (${safeMixedCmd}) MUST NOT false-positive`,
    )
  }
  const r1Deps = makeTestDeps(path.join(tmpHome, 'boards-g8'))
  const r1L3Out = await execMod.executeChiefToolCall(r1Deps, {
    tool: 'run_command',
    args: { command: String.raw`copy x ".\"env` },
  }, { rootId: 'g8', cwd: tmpWs, permissionMode: 'chief', hasChiefRiskAck: true, board: {} })
  assert.equal(r1L3Out.blockedBySafetyGuard, true, 'R1 command must remain hard-blocked even in L3 chief mode')
  console.log('✓ G8 passed: R1 quote-backslash & CMD caret credential evasion blocked with 0 false-positives')

  // -------------------------------------------------------------------------
  // G9. R2 Multi-Worker Concurrent `note.write` + `task.add` Zero-Loss Durability
  // -------------------------------------------------------------------------
  const g9BoardDir = path.join(tmpHome, 'boards-g9')
  fs.mkdirSync(g9BoardDir, { recursive: true })
  const g9WorkerScript = [
    'import { parentPort, workerData } from "node:worker_threads"',
    'import path from "node:path"',
    'import { pathToFileURL } from "node:url"',
    'const { pkgDir, boardDir, workerIndex, opsPerWorker, sessionId } = workerData',
    'const { createBoardStore } = await import(pathToFileURL(path.join(pkgDir, "board-store.js")).href)',
    'const { createBoardActions } = await import(pathToFileURL(path.join(pkgDir, "board-actions.js")).href)',
    'const deps = { hostState: { activeRuntime: null, activeLlm: null, handoffSeq: 0, autoSteeredTurns: new Map(), subagentRootMap: new Map(), subagentTreeCache: new Map() } }',
    'deps.boardFile = () => path.join(boardDir, "board.json")',
    'deps.boardFileFor = sid => path.join(boardDir, `${String(sid || "global")}.json`)',
    'deps.resolveRootSessionId = sid => String(sid || "").trim()',
    'deps.resolveBoundRootSid = sid => String(sid || "").trim()',
    'deps.agentOf = () => undefined',
    'deps.fetchTeamTasks = () => []',
    'deps.getSessionCwd = () => process.cwd()',
    'deps.isInternalProfileCwd = () => false',
    'deps.makeChiefDeps = () => ({})',
    'deps.sessionName = () => "w"',
    'deps.resolveWorkspaceIdForSession = () => ""',
    'Object.assign(deps, createBoardStore(deps))',
    'deps.boardFile = () => path.join(boardDir, "board.json")',
    'deps.boardFileFor = sid => path.join(boardDir, `${String(sid || "global")}.json`)',
    'const actions = createBoardActions(deps)',
    'let errs = 0',
    'for (let i = 0; i < opsPerWorker; i++) {',
    '  const args = i % 2 === 1',
    '    ? { action: "note.write", title: `g9-note-w${workerIndex}-${i}`, body: `body-${i}`, session: sessionId, by: `w${workerIndex}` }',
    '    : { action: "task.add", title: `g9-task-w${workerIndex}-${i}`, note: `n-${i}`, session: sessionId, by: `w${workerIndex}` }',
    '  const res = actions.runAction(args)',
    '  if (!res || !res.ok) errs++',
    '}',
    'parentPort.postMessage({ errs })',
  ].join('\n')
  const g9Workers = 8
  const g9Ops = 30
  const g9Sess = 'g9-race-sess'
  const g9Results = await Promise.all(Array.from({ length: g9Workers }, (_, idx) => new Promise((resolve, reject) => {
    const w = new Worker(g9WorkerScript, {
      eval: true,
      workerData: { pkgDir: PKG, boardDir: g9BoardDir, workerIndex: idx, opsPerWorker: g9Ops, sessionId: g9Sess },
    })
    w.on('message', resolve)
    w.on('error', reject)
  })))
  for (const r of g9Results) assert.equal(r.errs, 0, 'Worker board ops must not error')
  const g9Store = boardStoreMod.createBoardStore({
    resolveRootSessionId: s => s,
    getSessionCwd: () => tmpWs,
    agentOf: () => 'main',
    sessionName: () => 'g9',
    hostState: {},
  })
  const g9Board = g9Store.loadBoard(path.join(g9BoardDir, `${g9Sess}.json`))
  assert.equal(g9Board.tasks.length, g9Workers * (g9Ops / 2), 'All concurrent worker tasks must persist (0 loss)')
  assert.equal(g9Board.notes.length, g9Workers * (g9Ops / 2), 'All concurrent worker notes must persist (0 loss)')
  assert.equal(fs.existsSync(path.join(g9BoardDir, `${g9Sess}.json.lock`)), false, 'No leaked board .lock file')
  console.log(`✓ G9 passed: ${g9Workers} concurrent worker_threads × ${g9Ops} ops = ${g9Board.tasks.length} tasks + ${g9Board.notes.length} notes persisted (0 loss)`)

  console.log('\nALL 9 V1.3.0 RELEASE GATE CHECKS (G1-G9) PASSED!')
} finally {
  if (prevDocument === undefined) delete globalThis.document
  else globalThis.document = prevDocument
  if (prevGetComputedStyle === undefined) delete globalThis.getComputedStyle
  else globalThis.getComputedStyle = prevGetComputedStyle
  fs.rmSync(tmpHome, { recursive: true, force: true })
  fs.rmSync(tmpWs, { recursive: true, force: true })
}
