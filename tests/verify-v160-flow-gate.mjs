#!/usr/bin/env node
/**
 * verify-v160-flow-gate.mjs
 *
 * Self-contained v1.6.0 workflow pipeline topology & Managed/Bilingual gate covering W1 ~ W16:
 *  - W1: Version alignment (1.6.0), client bundle workflow & v1.6 Option A/B markers, light-theme overrides
 *  - W2: planStepId / targetPlanStepId persistence, auto-binding active step, graph.plan backfill & backward compat
 *  - W3: derivePlanFlowProgress 5-step sequential colors, subagent branches, cross-step return edges & task-root fallback
 *  - W4: digest.js step ID anchors & subagent-runtime.js dispatch brief step + return hints
 *  - W5: Client src/client/tabs/tasks-flow.js model (incl. grandchild subagents) & TD/LR SVG layout + React render smoke
 *  - W6~W11: --format safety, Strong Intervention + Idle Guard + Mid-Turn Spin regression gates
 *  - W12: LLM usage ledger categorization (chat/patrol/dream) & hard Managed budget circuit breaker
 *  - W13: Milestone alertEvents persistence & notify.js baseline suppression + incremental Notification/AudioContext chime
 *  - W14: Bilingual Markdown retrospective report generation & secret redaction (report.js)
 *  - W15: 3 Scenario Presets (observer / collab / away) + L3/Managed risk gate enforcement
 *  - W16: Bilingual locale/zh.json + locale/en.json schema & i18n.js host detection / runtime switching
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PKG = path.resolve(__dirname, '..')

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-v160-flow-gate-'))
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

function makeFakeReact() {
  return {
    createElement: (type, props, ...children) => ({ $$typeof: 'react.el', type, props: { ...(props || {}), children } }),
    Fragment: 'Fragment',
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: () => {},
    useRef: (init) => ({ current: init }),
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
  }
}

try {
  const pkgJson = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8'))
  const schemaMod = await import(modUrl('board-schema.js'))
  const constMod = await import(modUrl('src/client/constants.js'))
  const storeMod = await import(modUrl('board-store.js'))
  const subagentMod = await import(modUrl('subagent-runtime.js'))
  const actionsMod = await import(modUrl('board-actions.js'))
  const digestMod = await import(modUrl('digest.js'))

  // =========================================================================
  // W1: Version alignment (>= 1.6.0), client bundle markers & light-theme rules
  // =========================================================================
  assert.ok(/^1\.([6-9]|[1-9]\d)\.\d+/.test(pkgJson.version), `W1 package.json must be >= 1.6.0 (got ${pkgJson.version})`)
  assert.equal(schemaMod.BACKEND_BUILD, pkgJson.version, 'W1 board-schema BACKEND_BUILD must align with package.json')
  assert.equal(constMod.EXPECTED_BACKEND_BUILD, pkgJson.version, 'W1 constants EXPECTED_BACKEND_BUILD must align with package.json')

  const clientBundle = fs.readFileSync(path.join(PKG, 'client.js'), 'utf8')
  for (const needle of [
    '.dnb-flow-stage',
    '.dnb-flow-return-badge',
    '.dnb-acc-card',
    '.dnb-flow-done-fold',
    '.dnb-pyr-node-detail',
    'function AccCard(',
    'TaskFlowPipelineView',
    'TaskFlowCanvasView',
    'computeFlowCanvasLayout',
    'buildTaskFlowModel',
    'topoSectionCollapsed',
    'html[data-ds-theme-source="light"] .dnb-flow-stage',
    "taskViewMode: 'canvas'",
    'dnb-preset-card',
    'dnb-budget-bar',
    'buildSessionReportMarkdown',
    'processIncomingAlertEvents',
    'setRuntimeUiLang',
    'AwayPresetConfirmModal',
  ]) {
    assert.ok(clientBundle.includes(needle), `W1 client.js missing required v1.6.0 marker: ${needle}`)
  }
  console.log(`[W1 PASS] Version ${pkgJson.version} aligned & client workflow markers verified`)

  // =========================================================================
  // W2: planStepId / targetPlanStepId persistence, auto-binding & backfill
  // =========================================================================
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
  bus.boardFile = () => path.join(boardDir, 'shared.json')
  bus.boardFileFor = (sid) => path.join(boardDir, `${String(sid || 'main').replace(/[^\w-]/g, '_')}.json`)
  bus.sharedBoardFile = () => path.join(boardDir, 'shared.json')
  Object.assign(bus, subagentMod.createSubagentRuntime(bus))
  Object.assign(bus, actionsMod.createBoardActions(bus))

  const sid = 'session-w2-flow'
  const rPlan = bus.runAction({
    action: 'plan.set',
    session: sid,
    by: 'lead',
    objective: '上线推进流拓扑',
    steps: [
      { id: 'st-1', text: '摸清现状与契约', done: false },
      { id: 'st-2', text: '并行拆解与实现', done: false },
      { id: 'st-3', text: '集成联调与门禁', done: false },
      { id: 'st-4', text: '回归验收与文档', done: false },
      { id: 'st-5', text: '打包校验收口', done: false },
    ],
  })
  assert.equal(rPlan.ok, true)

  // Task without explicit planStepId auto-binds to active Step 1
  const tAuto1 = bus.runAction({
    action: 'task.add',
    session: sid,
    by: 'lead',
    title: '扫描仓库模块边界',
  })
  assert.equal(tAuto1.ok, true)
  assert.equal(tAuto1.task.planStepId, 'st-1', 'W2 task.add without planStepId must bind to active step st-1')

  // Mark Step 1 done -> next auto task binds to Step 2
  bus.runAction({
    action: 'plan.set',
    session: sid,
    by: 'lead',
    steps: [
      { id: 'st-1', text: '摸清现状与契约', done: true, summary: '边界与接口清单已核对' },
      { id: 'st-2', text: '并行拆解与实现', done: false },
      { id: 'st-3', text: '集成联调与门禁', done: false },
      { id: 'st-4', text: '回归验收与文档', done: false },
      { id: 'st-5', text: '打包校验收口', done: false },
    ],
  })
  const tAuto2 = bus.runAction({
    action: 'task.add',
    session: sid,
    by: 'lead',
    title: '实现后端状态推演',
    subagent: 'worker-a',
  })
  assert.equal(tAuto2.task.planStepId, 'st-2', 'W2 task.add after step 1 done must bind to step st-2')

  // Explicit cross-step targetPlanStepId
  const tCross = bus.runAction({
    action: 'task.add',
    session: sid,
    by: 'lead',
    title: '编写边界门禁并交卷至联调步',
    subagent: 'worker-c',
    planStepId: 'st-2',
    targetPlanStepId: 'st-3',
  })
  assert.equal(tCross.task.planStepId, 'st-2')
  assert.equal(tCross.task.targetPlanStepId, 'st-3')

  // Check summary() includes planStepId & targetPlanStepId
  const boardAfter = bus.loadBoard(bus.boardFileFor(sid))
  const sum = schemaMod.summary(boardAfter)
  const sumCross = sum.tasks.find(x => x.id === tCross.task.id)
  assert.equal(sumCross.planStepId, 'st-2')
  assert.equal(sumCross.targetPlanStepId, 'st-3')
  assert.equal(boardAfter.plan[0].summary, '边界与接口清单已核对')

  // graph.plan on fresh session with no plan auto-generates plan & backfills planStepId
  const sidGraph = 'session-w2-graph'
  const rGraph = bus.runAction({
    action: 'graph.plan',
    session: sidGraph,
    by: 'lead',
    tasks: [
      { id: 'root-a', title: '第一步基建', status: 'done' },
      { id: 'child-a1', title: '基建子任务', parentId: 'root-a', status: 'done' },
      { id: 'root-b', title: '第二步联调', blockedBy: ['root-a'], status: 'doing' },
    ],
  })
  assert.equal(rGraph.ok, true)
  const bGraph = bus.loadBoard(bus.boardFileFor(sidGraph))
  assert.equal(bGraph.plan.length, 2)
  assert.equal(bGraph.tasks.find(t => t.id === 'root-a').planStepId, 's-root-a')
  assert.equal(bGraph.tasks.find(t => t.id === 'child-a1').planStepId, 's-root-a', 'W2 child task must inherit root step id on backfill')

  // Backward compat: normalizeBoard on old board without planStepId
  const legacyBoard = schemaMod.normalizeBoard({
    plan: [{ id: 'old-1', text: 'Legacy Step', done: false }],
    tasks: [{ id: 'old-t1', title: 'Legacy Task', status: 'doing' }],
  })
  assert.equal(legacyBoard.tasks[0].planStepId, '')
  assert.equal(legacyBoard.tasks[0].targetPlanStepId, '')
  console.log('[W2 PASS] planStepId/targetPlanStepId persistence, auto-binding, graph.plan backfill & compat verified')

  // =========================================================================
  // W3: derivePlanFlowProgress 5-step colors, branches, return edges & fallback
  // =========================================================================
  const flowBoard = schemaMod.normalizeBoard({
    objective: '端到端流程验证',
    plan: [
      { id: 'p1', text: '步骤一：调研', done: true },
      { id: 'p2', text: '步骤二：编码', done: false },
      { id: 'p3', text: '步骤三：联调', done: false },
      { id: 'p4', text: '步骤四：回归', done: false },
      { id: 'p5', text: '步骤五：收口', done: false },
    ],
    tasks: [
      { id: 't1', title: '调研完结', status: 'done', planStepId: 'p1' },
      { id: 't2a', title: '代码审计', status: 'done', subagent: 'auditor', planStepId: 'p2' },
      { id: 't2b', title: '核心编写', status: 'doing', subagent: 'coder', planStepId: 'p2' },
      { id: 't2c', title: '边界排查', status: 'blocked', subagent: 'guard-check', planStepId: 'p2', targetPlanStepId: 'p3' },
    ],
  })
  const mockSubagents = [
    { name: 'lead', id: 'lead-1', status: 'running' },
    { name: 'auditor', id: 'sub-1', parentId: 'lead-1', status: 'inactive' },
    { name: 'coder', id: 'sub-2', parentId: 'lead-1', status: 'running' },
    { name: 'guard-check', id: 'sub-3', parentId: 'lead-1', status: 'inactive' },
    { name: 'untracked-runner', id: 'sub-4', parentId: 'lead-1', status: 'running' },
  ]
  const derived = schemaMod.derivePlanFlowProgress(flowBoard, mockSubagents)
  assert.equal(derived.mode, 'plan')
  assert.equal(derived.stages.length, 5)
  assert.equal(derived.stages[0].status, 'done', 'Step 1 must be green/done')
  assert.equal(derived.stages[1].status, 'blocked', 'Step 2 with blocked subagent must report blocked')
  assert.equal(derived.stages[2].status, 'todo')
  assert.equal(derived.stages[3].status, 'todo')
  assert.equal(derived.stages[4].status, 'todo')

  const st2 = derived.stages[1]
  const edgeAudit = st2.returnEdges.find(e => e.fromAgent === 'auditor')
  const edgeCoder = st2.returnEdges.find(e => e.fromAgent === 'coder')
  const edgeGuard = st2.returnEdges.find(e => e.fromAgent === 'guard-check')
  const orphanAgent = st2.agents.find(a => a.name === 'untracked-runner')
  assert.ok(edgeAudit && edgeAudit.status === 'done' && edgeAudit.toStepId === 'p2' && !edgeAudit.crossStep)
  assert.ok(edgeCoder && edgeCoder.status === 'doing' && edgeCoder.toStepId === 'p2')
  assert.ok(edgeGuard && edgeGuard.status === 'blocked' && edgeGuard.toStepId === 'p3' && edgeGuard.crossStep)
  assert.ok(orphanAgent && orphanAgent.agentStatus === 'doing', 'Untracked running subagent must mount on active step')

  // Task-root topological fallback when plan[] is empty
  const noPlanBoard = schemaMod.normalizeBoard({
    tasks: [
      { id: 'b', title: '后置任务', blockedBy: ['a'], status: 'todo', createdAt: 10 },
      { id: 'a', title: '前置任务', status: 'done', createdAt: 20 },
    ],
  })
  const fallbackFlow = schemaMod.derivePlanFlowProgress(noPlanBoard, [])
  assert.equal(fallbackFlow.mode, 'task-root')
  assert.deepEqual(fallbackFlow.stages.map(s => s.rootTaskId), ['a', 'b'], 'Task-root fallback must respect topological dependency order')
  console.log('[W3 PASS] derivePlanFlowProgress state colors, branches, cross-step return edges & fallback verified')

  // =========================================================================
  // W4: digest.js step IDs & subagent-runtime.js task.dispatch brief + auto step
  // =========================================================================
  const digestText = digestMod.renderDigest(flowBoard, { subagents: mockSubagents })
  assert.ok(digestText.includes('(id:p2)'), 'W4 digest must expose open plan step id for model planStepId binding')

  // Issue #6 comment #7075636856 Bug A: non-blocking cursor.blocked remarks must normalize to ''
  const benignCursorSamples = [
    '',
    '—',
    '（无）',
    '无',
    '无（已获用户批准执行）',
    '无，一切正常',
    '暂无',
    '暂无阻塞',
    '已解除：用户已批准',
    '已获用户批准执行',
    '用户已接受当前配置…禁止再拿改码前的备份按 tree_code 做差异比较。',
    'none',
    'None (user approved)',
    'N/A',
    'Not blocked - continuing',
    'Resolved',
  ]
  for (const sample of benignCursorSamples) {
    assert.equal(schemaMod.normalizeCursorBlocked(sample), '', `benign cursor.blocked should normalize to empty: ${sample}`)
    const bNorm = schemaMod.normalizeBoard({ cursor: { step: '步骤2', next: '继续', blocked: sample } })
    assert.equal(bNorm.cursor.blocked, '', `normalizeBoard must clear benign cursor.blocked: ${sample}`)
  }
  const realCursorBlockers = [
    '无法连接 MySQL：ECONNREFUSED',
    '无权限写入 /etc/nginx/nginx.conf',
    '没有找到 package.json',
    '等待用户批准 L3 升级',
    '用户已确认方案，但仍缺少生产库凭据',
    'None of the unit tests passed',
    'No permission to read ~/.ssh/id_rsa',
    'npm test failed on S2',
  ]
  for (const sample of realCursorBlockers) {
    assert.equal(schemaMod.normalizeCursorBlocked(sample), sample, `real blocker must be preserved: ${sample}`)
    const bReal = schemaMod.normalizeBoard({ cursor: { step: '步骤2', next: '等待', blocked: sample } })
    assert.equal(bReal.cursor.blocked, sample, `normalizeBoard must keep real blocker: ${sample}`)
  }
  const approvedCursorDigest = digestMod.renderDigest(
    schemaMod.normalizeBoard({ cursor: { step: '步骤2', next: '运行测试', blocked: '无（已获用户批准执行）' } }),
    { subagents: mockSubagents },
  )
  assert.ok(!approvedCursorDigest.includes('卡在:'), 'renderDigest must omit 卡在: for normalized approved cursor')

  let capturedBrief = ''
  const mockRuntime = {
    get(k) { return this[k] || null },
    agents: {
      get: (id) => (id === sid ? { id: sid, header: {} } : null),
      list: () => [{ id: sid }],
    },
    subagents: {
      rootOf: (ag) => ag,
      namesOf: () => ({ self: 'lead', parent: '' }),
      listDescendants: async () => [],
      resolveName: async () => '',
      startActivation: async (opts) => {
        capturedBrief = (opts && opts.prompt && opts.prompt[0] && opts.prompt[0].text) || ''
        return { name: opts.name, childId: 'child-w4-1' }
      },
    },
  }

  const dispatchRes = await bus.executeSubagentAction(mockRuntime, {
    action: 'task.dispatch',
    session: sid,
    id: tCross.task.id,
    agent: 'worker-c',
  }, { id: sid })
  assert.equal(dispatchRes.ok, true)
  assert.equal(dispatchRes.task.planStepId, 'st-2')
  assert.ok(capturedBrief.includes('**所属推进步骤**: 第 2 步「并行拆解与实现」'), 'W4 dispatch brief must include source plan step')
  assert.ok(capturedBrief.includes('完成后成果回指第 3 步「集成联调与门禁」'), 'W4 dispatch brief must include cross-step return target')

  const rNoStep = bus.runAction({
    action: 'task.add',
    session: sid,
    by: 'lead',
    title: '无显式步骤子任务',
    planStepId: '',
  })
  const dAuto = await bus.executeSubagentAction(null, {
    action: 'task.dispatch',
    session: sid,
    id: rNoStep.task.id,
    agent: 'worker-auto',
  })
  assert.equal(dAuto.ok, true)
  assert.equal(dAuto.task.planStepId, 'st-2', 'W4 task.dispatch must auto-populate empty planStepId')
  console.log('[W4 PASS] digest step anchors & task.dispatch brief + step auto-binding verified')

  // =========================================================================
  // W5: Client tasks-flow.js model (incl. grandchildren) & TD/LR render smoke
  // =========================================================================
  const prevWin = globalThis.window
  const prevDoc = globalThis.document
  const prevReact = globalThis.React
  globalThis.window = { location: { href: 'http://127.0.0.1:8498/?session=s1', search: '?session=s1' } }
  globalThis.document = { documentElement: { getAttribute: () => 'dark' }, querySelector: () => null }
  globalThis.React = makeFakeReact()

  try {
    const utilsMod = await import(modUrl('src/client/utils.js'))
    const flowClientMod = await import(modUrl('src/client/tabs/tasks-flow.js'))

    const subList = [
      { name: 'lead', id: 's1', status: 'running' },
      { name: 'backend-lead', id: 'sub-b', parentId: 's1', status: 'running' },
      { name: 'backend-lead/sql-helper', id: 'sub-b2', parentId: 'sub-b', status: 'inactive' },
    ]
    const bClient = schemaMod.normalizeBoard({
      objective: '客户端推进流验证',
      plan: [
        { id: 'c1', text: '需求梳理', done: true },
        { id: 'c2', text: '架构改造', done: false },
        { id: 'c3', text: '测试发版', done: false },
      ],
      tasks: [
        { id: 'ct1', title: '梳理完成', status: 'done', planStepId: 'c1' },
        { id: 'ct2', title: '接口改造', status: 'doing', subagent: 'backend-lead', planStepId: 'c2' },
        { id: 'ct3', title: 'SQL 优化交卷', status: 'done', subagent: 'backend-lead/sql-helper', planStepId: 'c2', targetPlanStepId: 'c3' },
      ],
    })
    const hier = utilsMod.buildAgentHierarchy(subList, { rootId: 's1' })
    const model = flowClientMod.buildTaskFlowModel(bClient, bClient.tasks, bClient.tasks, hier, {
      statusFilter: 'all',
      filterAgent: '',
      focusedTaskScopeSet: new Set(),
      focusedAgentSet: new Set(),
    })

    assert.equal(model.stages.length, 3)
    assert.equal(model.stages[0].status, 'done')
    assert.equal(model.stages[1].status, 'doing')
    assert.equal(model.stages[1].agentBranches.length, 1, 'Grandchild must nest under parent branch')
    const parentBranch = model.stages[1].agentBranches[0]
    assert.equal(parentBranch.children.length, 1)
    assert.equal(parentBranch.children[0].status, 'done')
    assert.equal(parentBranch.children[0].returnTargetIndex, 3)
    assert.equal(parentBranch.children[0].isCrossStep, true)

    const tdLayout = flowClientMod.computeFlowCanvasLayout(model, false)
    const lrLayout = flowClientMod.computeFlowCanvasLayout(model, true)
    assert.equal(tdLayout.stageBoxes.length, 3)
    assert.equal(tdLayout.agentBoxes.length, 2)
    assert.equal(tdLayout.returnEdges.length, 2)
    assert.equal(lrLayout.returnEdges.length, 2)
    assert.ok(tdLayout.svgW > 300 && tdLayout.svgH > 200)

    const pipeEl = flowClientMod.TaskFlowPipelineView({
      flowModel: model,
      board: bClient,
      collapsed: new Set(),
      onToggleCollapse: () => {},
      selectedTask: bClient.tasks[1],
      renderInspector: () => ({ $$typeof: 'react.el', type: 'div', props: {} }),
    })
    const canvasEl = flowClientMod.TaskFlowCanvasView({
      flowModel: model,
      flowLayout: tdLayout,
      board: bClient,
      isLR: false,
      zoom: 1,
      setZoom: () => {},
      canvasRef: { current: null },
      panRef: { current: null },
      selectedTask: bClient.tasks[1],
      renderInspector: () => ({ $$typeof: 'react.el', type: 'div', props: {} }),
    })
    assert.ok(pipeEl && pipeEl.$$typeof === 'react.el')
    assert.ok(canvasEl && canvasEl.$$typeof === 'react.el')

    // Verify unified board features: done-task folding inside active stage, hideRail, and unified stepApi buttons
    const findInFakeTree = (node, pred) => {
      if (!node || typeof node !== 'object') return false
      if (Array.isArray(node)) return node.some(x => findInFakeTree(x, pred))
      if (pred(node)) return true
      const ch = node.props && node.props.children
      return Array.isArray(ch) ? ch.some(x => findInFakeTree(x, pred)) : false
    }
    const bFold = schemaMod.normalizeBoard({
      objective: '注意力量化与折叠测试',
      plan: [
        { id: 'f1', text: '步骤一进行中', done: false },
        { id: 'f2', text: '步骤二已完成', done: true },
      ],
      tasks: [
        { id: 'ft-done', title: '历史已完成任务', status: 'done', planStepId: 'f1' },
        { id: 'ft-live', title: '正在推进任务', status: 'doing', planStepId: 'f1' },
      ],
    })
    const foldModel = flowClientMod.buildTaskFlowModel(bFold, bFold.tasks, bFold.tasks, hier, {
      statusFilter: 'all',
      filterAgent: '',
      focusedTaskScopeSet: new Set(),
      focusedAgentSet: new Set(),
    })
    const unifiedAll = flowClientMod.TaskFlowPipelineView({
      flowModel: foldModel,
      board: bFold,
      collapsed: new Set(),
      onToggleCollapse: () => {},
      hideRail: true,
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
    assert.equal(findInFakeTree(unifiedAll, n => String(n.props?.className || '').includes('dnb-flow-done-fold')), true, 'W5 active stage must fold done subtasks by default')
    assert.equal(findInFakeTree(unifiedAll, n => String(n.props?.className || '').includes('dnb-flow-rail')), false, 'W5 hideRail must suppress duplicate rail')
    assert.equal(findInFakeTree(unifiedAll, n => String(n.props?.className || '').includes('dnb-flow-step-text-btn')), true, 'W5 stepApi must render integrated step actions')

    const foldDoneOnlyModel = flowClientMod.buildTaskFlowModel(
      bFold,
      bFold.tasks,
      bFold.tasks.filter(t => t.status === 'done'),
      hier,
      { statusFilter: 'done', filterAgent: '', focusedTaskScopeSet: new Set(), focusedAgentSet: new Set() },
    )
    const unifiedDone = flowClientMod.TaskFlowPipelineView({
      flowModel: foldDoneOnlyModel,
      board: bFold,
      collapsed: new Set(),
      onToggleCollapse: () => {},
      hideRail: true,
      statusFilter: 'done',
    })
    assert.equal(findInFakeTree(unifiedDone, n => String(n.props?.className || '').includes('dnb-flow-done-fold')), false, 'W5 statusFilter=done must show done subtasks directly without double-folding')
    console.log('[W5 PASS] Client tasks-flow model (with nested grandchildren), TD/LR layouts, done-task folding & React smoke verified')
  } finally {
    if (prevWin === undefined) delete globalThis.window
    else globalThis.window = prevWin
    if (prevDoc === undefined) delete globalThis.document
    else globalThis.document = prevDoc
    if (prevReact === undefined) delete globalThis.React
    else globalThis.React = prevReact
  }

  // =========================================================================
  // W6: --format CLI flag zero false-positive vs real `format C:` hard guard
  // =========================================================================
  const safetyMod = await import(modUrl('safety/index.js'))
  const emptyBoardClean = schemaMod.emptyBoard()
  const safeCmds = [
    '"C:/Program Files/Git/usr/bin/ssh.exe" -o BatchMode=yes -o ConnectTimeout=25 astrbot "sudo -n docker ps --format \'table {{.Names}}\\t{{.Status}}\\t{{.Ports}}\'"',
    'git log -n 5 --format="%h %s"',
    'npm run format',
    'npx prettier --write src/index.js --format',
  ]
  for (const cmd of safeCmds) {
    assert.equal(safetyMod.isDestructiveShellCommand(cmd), false, `W6 safe command must not be flagged destructive: ${cmd}`)
    const def = safetyMod.evaluatePreExecuteDefense({
      tool: 'run_command',
      args: { command: cmd },
      cwd: tmpRoot,
      board: emptyBoardClean,
      walls: { walls: [] },
    })
    assert.notEqual(def.decision, 'deny', `W6 safe command must not be denied by pre-execute: ${cmd} (got: ${def.reason})`)
  }
  const dangerCmds = [
    'format C:',
    'format.com D: /q /y',
    'cmd /c format c: /fs:ntfs',
    'echo ok && format E:',
    'format /fs:ntfs F:',
  ]
  for (const cmd of dangerCmds) {
    assert.equal(safetyMod.isDestructiveShellCommand(cmd), true, `W6 destructive disk format must be caught: ${cmd}`)
    const def = safetyMod.evaluatePreExecuteDefense({
      tool: 'run_command',
      args: { command: cmd },
      cwd: tmpRoot,
      board: emptyBoardClean,
      walls: { walls: [] },
    })
    assert.equal(def.decision, 'deny', `W6 destructive disk format must be denied: ${cmd}`)
  }
  assert.equal(constMod.TABS.length, 5, 'W6 TABS must contain 5 merged tabs (plan merged into tasks)')
  console.log('[W6 PASS] --format zero false-positive, real disk format hard guard & 5-tab layout verified')

  // =========================================================================
  // W7 ~ W11: Strong Intervention + Idle Guard + Mid-Turn Spin Regression Gates
  // =========================================================================
  const stateMod = await import(modUrl('chief-state.js'))
  const reviewMod = await import(modUrl('chief-review.js'))
  const guardMod = await import(modUrl('idle-guard.js'))
  const toolsMod = await import(modUrl('model-tools.js'))
  const routesMod = await import(modUrl('api-routes.js'))
  const hooksMod = await import(modUrl('runtime-hooks.js'))

  Object.assign(bus, toolsMod.createModelTools(bus))
  Object.assign(bus, routesMod.createApiRoutes(bus))
  Object.assign(bus, hooksMod.createRuntimeHooks(bus))

  const wAgents = new Map()
  const wFollowups = []
  const wSteers = []
  let wLlmHandler = async () => ({
    ok: true,
    text: JSON.stringify({
      memoryChanges: [],
      boardOps: [],
      planAssessment: { stale: false, reason: '' },
      goalStatus: 'in_progress',
      hazardStop: { triggered: false },
      shouldIntervene: true,
      interventionText: '请立即继续推进剩余步骤并附验证结果。',
      suggestions: [],
    }),
  })
  const wRuntime = {
    get(k) {
      if (k === 'agents') {
        return {
          get: id => wAgents.get(id),
          list: () => [...wAgents.values()],
        }
      }
      if (k === 'workingDirectory') return { defaultDirectory: tmpRoot, get: () => tmpRoot }
      return null
    },
  }
  const wDepsBase = {
    runtime: wRuntime,
    resolveRootSessionId: sid => sid,
    boardFile: () => bus.boardFile(),
    boardFileFor: sid => bus.boardFileFor(sid),
    loadBoard: f => bus.loadBoard(f),
    saveBoard: (b, f) => bus.saveBoard(b, f),
    boardForSession: f => bus.boardForSession(f),
    runAction: args => bus.runAction(args),
    appendBoardLog: () => {},
    getAgentStatus: sid => (wAgents.get(sid) && wAgents.get(sid).status) || 'idle',
    refreshSubagentTree: (...args) => bus.refreshSubagentTree(...args),
    sessionName: (_rt, ag) => (ag && ag.name) || '主对话',
    resolveAgentIdentity: (_rt, sid) => ({ self: sid, isChild: false }),
    findLiveCallerAgent: (_rt, sid) => wAgents.get(sid) || null,
    getSessionCwd: () => tmpRoot,
    callLlmOverride: async opts => wLlmHandler(opts),
  }
  bus.hostState.activeRuntime = wRuntime

  function regWAgent(sid, msgs, { status = 'idle' } = {}) {
    const ag = {
      id: sid,
      name: 'lead',
      status,
      session: {
        deriveMessages: () => msgs,
        snapshotEvents: () => [],
      },
      followup: async msg => {
        wFollowups.push({ sid, msg })
        return { ok: true }
      },
      steer: msg => {
        wSteers.push({ sid, msg })
      },
    }
    wAgents.set(sid, ag)
    return ag
  }

  // W7: Strong intervention works under runMode='off' and 'patrol', and checkAndStopIdleAutoPilot never sleeps while intervention is active
  const sidW7 = 'sess-w7-intv-modes'
  const w7Msgs = [
    { id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '跑完 12 张立绘并目检交付' }] },
    { id: 'a1', role: 'assistant', content: [{ type: 'text', text: '只欠 backb 3 张。重启 ComfyUI 补跑。' }] },
  ]
  const agW7 = regWAgent(sidW7, w7Msgs, { status: 'idle' })
  bus.runAction({ action: 'objective.set', session: sidW7, objective: '产出并目检全部 12 张立绘后交付', _fromInterventionSetup: true })

  const cfgW7Off = await stateMod.updateChiefConfig({
    session: sidW7,
    permissionMode: 'chief',
    confirmedChiefRisk: true,
    runMode: 'off',
    tacticalModes: { intervention: true, maxInterventionTurns: 0 },
    confirmedInterventionRisk: true,
    confirmedUnlimitedTurns: true,
  })
  assert.equal(cfgW7Off.ok, true, `W7 off config failed: ${cfgW7Off.error || ''}`)
  const fBeforeW7 = wFollowups.length
  const rW7Off = await reviewMod.runTurnReview(wDepsBase, { agent: agW7, sessionId: sidW7, turn: 1 })
  assert.equal(rW7Off.ok, true, `W7 runMode=off with intervention=true must not skip: ${JSON.stringify(rW7Off)}`)
  assert.equal(rW7Off.intervened, true, 'W7 L3 intervention under runMode=off must deliver followup')
  assert.equal(wFollowups.length, fBeforeW7 + 1)

  // Clear review stamp gap by adding a new message & switch to patrol (waiting out cooldown cleanly with lastAt shift or new session for patrol)
  const sidW7Patrol = 'sess-w7-patrol'
  const agW7P = regWAgent(sidW7Patrol, w7Msgs, { status: 'idle' })
  bus.runAction({ action: 'objective.set', session: sidW7Patrol, objective: '验证 patrol + 强介入唤醒', _fromInterventionSetup: true })
  const cfgW7P = await stateMod.updateChiefConfig({
    session: sidW7Patrol,
    permissionMode: 'chief',
    confirmedChiefRisk: true,
    runMode: 'patrol',
    tacticalModes: { intervention: true, maxInterventionTurns: 0 },
    confirmedInterventionRisk: true,
    confirmedUnlimitedTurns: true,
  })
  assert.equal(cfgW7P.ok, true, `W7 patrol config failed: ${cfgW7P.error || ''}`)
  const rW7Patrol = await reviewMod.runTurnReview(wDepsBase, { agent: agW7P, sessionId: sidW7Patrol, turn: 1 })
  assert.equal(rW7Patrol.ok, true, `W7 patrol with intervention=true must not skip: ${JSON.stringify(rW7Patrol)}`)
  assert.equal(rW7Patrol.intervened, true, 'W7 L3 intervention under patrol must deliver followup')

  // Managed idle auto-sleep must refuse to sleep while tactical.intervention === true
  const sidW7Sleep = 'sess-w7-nosleep'
  regWAgent(sidW7Sleep, w7Msgs, { status: 'idle' })
  const cfgW7S = await stateMod.updateChiefConfig({
    session: sidW7Sleep,
    permissionMode: 'chief',
    confirmedChiefRisk: true,
    runMode: 'managed',
    confirmedAutoPilot: true,
    managedIdleTimeoutMs: 50,
    tacticalModes: { intervention: true },
    confirmedInterventionRisk: true,
  })
  assert.equal(cfgW7S.ok, true, `W7 sleep config failed: ${cfgW7S.error || ''}`)
  stateMod.mutateChiefState(s => {
    const ws = stateMod.ensureWorkspace(s, sidW7Sleep)
    ws.runtimeGuard.lastActivityAt = Date.now() - 10_000
    ws.runtimeGuard.autoPilotStartedAt = Date.now() - 10_000
  })
  const rW7Sleep = await reviewMod.checkAndStopIdleAutoPilot(wDepsBase, sidW7Sleep, { allowStartupGrace: false })
  assert.equal(rW7Sleep.stopped, false, 'W7 managed mode must not auto-sleep while strong intervention is active')
  assert.equal(rW7Sleep.reason, 'intervention-active')
  console.log('[W7 PASS] Strong intervention works in off/patrol modes & never sleeps prematurely')

  // W8: Anti-collision stamp after compaction + Chief->Lead directive & tool call trace extraction
  const sidW8 = 'sess-w8-digest'
  const w8Msgs = [
    { id: 'u-old', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '几个小时前的旧消息' }] },
    { id: 'c-rel', role: 'user', source: { kind: 'dsh-chief-execution-request' }, content: [{ type: 'text', text: '继续 round-5 补齐 backb 3 张' }] },
    { id: 'a-tool', role: 'assistant', content: [{ type: 'tool_use', name: 'run_code', input: { command: 'ls r5_backb*' } }] },
  ]
  const agW8 = regWAgent(sidW8, w8Msgs, { status: 'idle' })
  bus.runAction({ action: 'objective.set', session: sidW8, objective: 'W8 验证压缩后游标与参谋指令保留', _fromInterventionSetup: true })
  await stateMod.updateChiefConfig({
    session: sidW8,
    permissionMode: 'chief',
    confirmedChiefRisk: true,
    runMode: 'managed',
    confirmedAutoPilot: true,
    tacticalModes: { intervention: true },
    confirmedInterventionRisk: true,
  })
  // Simulate historical cursor colliding with msgs.length (3)
  stateMod.mutateChiefState(s => {
    const ws = stateMod.ensureWorkspace(s, sidW8)
    ws.reviewCursors[sidW8] = w8Msgs.length
  })
  let capturedPromptW8 = ''
  wLlmHandler = async ({ prompt }) => {
    capturedPromptW8 = prompt
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
  }
  const rW8 = await reviewMod.runTurnReview(wDepsBase, { agent: agW8, sessionId: sidW8, turn: 27 })
  assert.notEqual(rW8.skipped, 'same-stamp', 'W8 compressed msgs.length === old numeric cursor must not collide as same-stamp')
  assert.equal(rW8.ok, true)
  assert.ok(capturedPromptW8.includes('Chief->Lead: 继续 round-5 补齐 backb 3 张'), 'W8 digest must retain Chief->Lead directives')
  assert.ok(capturedPromptW8.includes('Assistant Tools: run_code(ls r5_backb*)'), 'W8 digest must retain assistant tool trail')
  console.log('[W8 PASS] Anti-collision review stamp & Chief->Lead + tool trail digest extraction verified')

  // W9: premature-promise detection & shouldGuard with wrote=true + >3 cap under strongIntervention
  assert.ok(guardMod.detectPrematurePromiseText('r5_backa_73003 已落盘（重启前跑完了），只欠 backb 3 张。重启 ComfyUI 补跑。'))
  assert.ok(guardMod.detectPrematurePromiseText('就绪。写 round-5 驱动。'))
  assert.equal(guardMod.detectPrematurePromiseText('全部完成，已交付完毕。'), '')
  assert.equal(guardMod.detectPrematurePromiseText('是否需要我重启 ComfyUI 补跑？'), '')

  const sidW9 = 'sess-w9-promise'
  const makePromiseSession = (turnNo, text) => ({
    snapshotEvents: () => [
      { type: 'tool/call', data: { turn: turnNo, name: 'chief_board', arguments: JSON.stringify({ action: 'cursor.set', step: '准备重启' }) } },
      { type: 'assistant/message', data: { turn: turnNo, message: { content: [{ type: 'text', text }] } } },
    ],
  })
  const w9Board = schemaMod.normalizeBoard({
    objective: '完成 r5 全部 12 张',
    plan: [{ id: 'p1', text: '补跑 backb 3 张', done: false }],
    tasks: [{ id: 'tw9', title: 'r5 补跑', status: 'doing' }],
  })
  // Even though wrote === true, premature promise must still be blocked
  const vW9 = guardMod.shouldGuard({
    board: w9Board,
    session: makePromiseSession(1, 'r5_backa_73003 已落盘（重启前跑完了），只欠 backb 3 张。重启 ComfyUI 补跑。'),
    sessionId: sidW9,
    turn: 1,
    settings: { guardIdle: true },
    strongIntervention: true,
    maxInterventionTurns: 0,
  })
  assert.ok(vW9 && vW9.kind === 'premature-promise', `W9 expected premature-promise verdict, got ${JSON.stringify(vW9)}`)
  const noticeW9 = guardMod.buildNotice({ ...vW9, board: w9Board })
  assert.ok(noticeW9.content[0].text.includes('只用文字预告了下一步动作'))

  // Strong intervention allows >3 idle-guard nudges while non-strong mode stays capped at 3
  const sidW9CapOff = 'sess-w9-cap-off'
  const sidW9CapOn = 'sess-w9-cap-on'
  for (let i = 1; i <= 5; i += 1) {
    const vOff = guardMod.shouldGuard({
      board: w9Board,
      session: makePromiseSession(i, '就绪。写 round-5 驱动。'),
      sessionId: sidW9CapOff,
      turn: i,
      settings: { guardIdle: true, guardMaxPerSession: 3 },
      strongIntervention: false,
    })
    if (i <= 3) {
      assert.ok(vOff, `W9 default guard should fire on turn ${i}`)
      guardMod.noteIntervention(sidW9CapOff, i)
    } else {
      assert.equal(vOff, null, `W9 non-strong mode must stay capped at 3 on turn ${i}`)
    }

    const vOn = guardMod.shouldGuard({
      board: w9Board,
      session: makePromiseSession(i, '就绪。写 round-5 驱动。'),
      sessionId: sidW9CapOn,
      turn: i,
      settings: { guardIdle: true, guardMaxPerSession: 3 },
      strongIntervention: true,
      maxInterventionTurns: 0,
    })
    assert.ok(vOn, `W9 strongIntervention must still guard on turn ${i} (>3 cap)`)
    guardMod.noteIntervention(sidW9CapOn, i)
  }
  console.log('[W9 PASS] premature-promise guard (even with wrote=true) & strongIntervention >3 cap verified')

  // W10: Mid-turn spin live detection (exact-loop, fuzzy-loop, error-thrash, planWrite exempt, cooldown)
  const sidW10 = 'sess-w10-spin'
  guardMod.clearMidTurnSpin(sidW10)
  for (let i = 0; i < 3; i += 1) {
    guardMod.noteCallTrail(sidW10, 'run_command', JSON.stringify({ command: 'curl -s http://127.0.0.1:8188/queue' }))
  }
  assert.equal(guardMod.detectMidTurnSpin(sidW10, { strongIntervention: false })?.kind, undefined)
  assert.equal(guardMod.detectMidTurnSpin(sidW10, { strongIntervention: true })?.kind, 'exact-loop')

  // Varying numbers/timestamps should trigger fuzzy-loop on 4th call in strong mode
  guardMod.clearMidTurnSpin(sidW10)
  for (let i = 1; i <= 4; i += 1) {
    guardMod.noteCallTrail(sidW10, 'run_command', JSON.stringify({ command: `curl http://127.0.0.1:8188/history?t=${1795000 + i}&try=${i}` }))
  }
  const fSpin = guardMod.detectMidTurnSpin(sidW10, { strongIntervention: true })
  assert.equal(fSpin?.kind, 'fuzzy-loop', `W10 varying-arg polling must trigger fuzzy-loop, got ${JSON.stringify(fSpin)}`)
  guardMod.markMidTurnSpinActed(sidW10)
  assert.equal(guardMod.detectMidTurnSpin(sidW10, { strongIntervention: true }), null, 'W10 markMidTurnSpinActed must enforce cooldown')

  // Plan writes must be exempt from fuzzy-loop
  const sidW10Plan = 'sess-w10-planwrite'
  guardMod.clearMidTurnSpin(sidW10Plan)
  for (let i = 1; i <= 5; i += 1) {
    guardMod.noteCallTrail(sidW10Plan, 'chief_board', JSON.stringify({ action: 'task.update', id: `t${i}`, status: 'doing' }))
  }
  assert.equal(guardMod.detectMidTurnSpin(sidW10Plan, { strongIntervention: true }), null, 'W10 planWrite calls must never trigger fuzzy-loop')

  // Consecutive failing tool results trigger error-thrash; a successful call resets it
  guardMod.clearMidTurnSpin(sidW10Plan)
  for (let i = 1; i <= 3; i += 1) {
    guardMod.noteCallResult(sidW10Plan, { name: 'run_command', isError: true, error: `Error: ECONNREFUSED attempt ${i}` })
  }
  assert.equal(guardMod.detectMidTurnSpin(sidW10Plan, { strongIntervention: true }), null)
  guardMod.noteCallResult(sidW10Plan, { name: 'run_command', isError: false, result: 'ok' })
  assert.equal(guardMod.detectMidTurnSpin(sidW10Plan, { strongIntervention: true }), null, 'W10 success result resets error streak')
  for (let i = 1; i <= 4; i += 1) {
    guardMod.noteCallResult(sidW10Plan, { name: 'run_command', text: 'Error: ENOENT missing file' })
  }
  assert.equal(guardMod.detectMidTurnSpin(sidW10Plan, { strongIntervention: true })?.kind, 'error-thrash')
  console.log('[W10 PASS] Mid-turn spin detection (exact/fuzzy/error-thrash + planWrite exempt + cooldown) verified')

  // W11: Cooldown rescheduling, goalMissing/premature fallback intervention & ws.chat receipt
  const sidW11 = 'sess-w11-fallback'
  const w11Msgs = [
    { id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '继续执行任务' }] },
    { id: 'a1', role: 'assistant', content: [{ type: 'text', text: '我准备重启服务，现在先停在这里。' }] },
  ]
  const agW11 = regWAgent(sidW11, w11Msgs, { status: 'idle' })
  bus.runAction({ action: 'objective.set', session: sidW11, objective: '完成 backb 3 张并交付', _fromInterventionSetup: true })
  const cfgW11 = await stateMod.updateChiefConfig({
    session: sidW11,
    permissionMode: 'chief',
    confirmedChiefRisk: true,
    runMode: 'managed',
    confirmedAutoPilot: true,
    tacticalModes: { intervention: true, maxInterventionTurns: 0 },
    confirmedInterventionRisk: true,
    confirmedUnlimitedTurns: true,
  })
  assert.equal(cfgW11.ok, true, `W11 config failed: ${cfgW11.error || ''}`)
  // Omit interventionText and set shouldIntervene=false while keeping goalStatus='in_progress' + goalMissing
  wLlmHandler = async () => ({
    ok: true,
    text: JSON.stringify({
      memoryChanges: [],
      boardOps: [],
      planAssessment: { stale: false, reason: '' },
      goalStatus: 'in_progress',
      goalMissing: '尚缺 backb 3 张生成与目检交付',
      hazardStop: { triggered: false },
      shouldIntervene: false,
      interventionText: '',
      suggestions: [],
    }),
  })
  const fBeforeW11 = wFollowups.length
  const rW11 = await reviewMod.runTurnReview(wDepsBase, { agent: agW11, sessionId: sidW11, turn: 1 })
  assert.equal(rW11.ok, true)
  assert.equal(rW11.intervened, true, 'W11 empty interventionText with goalMissing must trigger fallback intervention')
  assert.equal(wFollowups.length, fBeforeW11 + 1)
  const wsW11 = stateMod.ensureWorkspace(stateMod.loadChiefState(), sidW11)
  assert.ok(wsW11.chat.some(c => c && c.role === 'chief' && c.text.includes('【⚡ 强介入督导')), 'W11 ws.chat must record intervention delivery receipt')

  // Immediately firing non-forced runTurnReview inside 4s cooldown must reschedule instead of dropping
  w11Msgs.push({ id: 'a2', role: 'assistant', content: [{ type: 'text', text: '补一条结果' }] })
  const rW11Cd = await reviewMod.runTurnReview(wDepsBase, { agent: agW11, sessionId: sidW11, turn: 2 })
  assert.equal(rW11Cd.skipped, 'cooldown')
  assert.equal(rW11Cd.rescheduled, true, 'W11 cooldown under strong intervention must reschedule rather than drop')
  console.log('[W11 PASS] Cooldown reschedule, goalMissing/premature fallback & ws.chat receipt verified')

  // =========================================================================
  // W12: Chief LLM Usage Ledger Categorization & Hard Managed Budget Breaker
  // =========================================================================
  const modelsMod = await import(modUrl('chief-models.js'))
  assert.ok(modelsMod.estimateTokensRough('hello world 测试统计') > 0, 'W12 estimateTokensRough must return positive estimate')

  const sidW12 = 'sess-w12-budget'
  const cfgW12 = await stateMod.updateChiefConfig({
    session: sidW12,
    permissionMode: 'chief',
    confirmedChiefRisk: true,
    runMode: 'managed',
    confirmedAutoPilot: true,
    managedBudgetMaxCalls: 3,
    managedBudgetMaxTokens: 50000,
  })
  assert.equal(cfgW12.ok, true, `W12 initial config failed: ${cfgW12.error || ''}`)
  assert.equal(cfgW12.config.managedBudgetMaxCalls, 3)

  let w12MockCalls = 0
  const w12Deps = {
    resolveRootSessionId: s => s,
    callLlmOverride: async () => {
      w12MockCalls += 1
      return {
        ok: true,
        text: 'mock-ok-' + w12MockCalls,
        usage: { inputTokens: 120, outputTokens: 80, totalTokens: 200 },
      }
    },
  }

  const c1 = await modelsMod.callChiefLlm(w12Deps, {
    sessionId: sidW12,
    system: 'sys',
    prompt: 'turn review prompt',
    reasonKind: 'turn_review',
  })
  assert.equal(c1.ok, true, 'W12 call 1 (turn_review) must succeed')

  const c2 = await modelsMod.callChiefLlm(w12Deps, {
    sessionId: sidW12,
    system: 'sys',
    prompt: 'dream roam prompt',
    reasonKind: 'dream_roam',
  })
  assert.equal(c2.ok, true, 'W12 call 2 (dream_roam) must succeed')

  const c3 = await modelsMod.callChiefLlm(w12Deps, {
    sessionId: sidW12,
    system: 'sys',
    prompt: 'archive harvest prompt',
    reasonKind: 'archive_harvest',
  })
  assert.equal(c3.ok, true, 'W12 call 3 (archive_harvest) must succeed')

  // 4th managed/background call must be blocked by the 3-call circuit breaker without invoking LLM
  const c4Blocked = await modelsMod.callChiefLlm(w12Deps, {
    sessionId: sidW12,
    system: 'sys',
    prompt: 'over-budget turn review',
    reasonKind: 'turn_review',
  })
  assert.equal(c4Blocked.ok, false, 'W12 4th background call must be rejected by managed budget breaker')
  assert.equal(w12MockCalls, 3, 'W12 blocked call must not invoke LLM backend')

  const wsW12 = stateMod.ensureWorkspace(stateMod.loadChiefState(), sidW12)
  assert.equal(wsW12.config.runMode, 'off', 'W12 circuit breaker must downgrade runMode to off')
  assert.equal(wsW12.llmLedger.managedRun.tripped, true, 'W12 managedRun.tripped must be true')
  assert.equal(wsW12.llmLedger.byCategory.review.calls, 1)
  assert.equal(wsW12.llmLedger.byCategory.dream.calls, 2)
  assert.ok(wsW12.llmLedger.totalTokens >= 600, 'W12 ledger must accumulate token counts')
  assert.ok(
    Array.isArray(wsW12.alertEvents) && wsW12.alertEvents.some(e => e && e.kind === 'budget_circuit_break'),
    'W12 circuit break must emit budget_circuit_break alertEvent',
  )

  // Manual user Q&A (ask_chief -> category chat) must NEVER be blocked even after managed breaker trips
  const c5Manual = await modelsMod.callChiefLlm(w12Deps, {
    sessionId: sidW12,
    system: 'sys',
    prompt: 'user direct question',
    reasonKind: 'ask_chief',
    userText: 'Why did it stop?',
  })
  assert.equal(c5Manual.ok, true, 'W12 manual ask_chief must remain unblocked after managed breaker trips')
  assert.equal(w12MockCalls, 4)
  const wsW12AfterChat = stateMod.ensureWorkspace(stateMod.loadChiefState(), sidW12)
  assert.equal(wsW12AfterChat.llmLedger.byCategory.chat.calls, 1)

  // Resetting managed budget clears run counters & tripped state
  const cfgW12Reset = await stateMod.updateChiefConfig({ session: sidW12, resetManagedBudget: true })
  assert.equal(cfgW12Reset.ok, true)
  const wsW12Reset = stateMod.ensureWorkspace(stateMod.loadChiefState(), sidW12)
  assert.equal(wsW12Reset.llmLedger.managedRun.calls, 0)
  assert.equal(wsW12Reset.llmLedger.managedRun.tokens, 0)
  assert.equal(wsW12Reset.llmLedger.managedRun.tripped, false)

  // Extreme dirty ledger values must clamp cleanly while preserving timestamps
  const clampedLedger = stateMod.normalizeLlmLedger({
    totalCalls: 1e12,
    totalInputTokens: 1e18,
    totalOutputTokens: 1e18,
    totalTokens: 1e18,
    byCategory: { chat: { calls: 1e9, tokens: 1e18 } },
    managedRun: { startedAt: 1795000000000, calls: 1e9, tokens: 1e18 },
  })
  assert.equal(clampedLedger.totalCalls, 1_000_000)
  assert.equal(clampedLedger.totalInputTokens, 1_000_000_000)
  assert.equal(clampedLedger.totalTokens, 1_000_000_000)
  assert.equal(clampedLedger.byCategory.chat.tokens, 1_000_000_000)
  assert.equal(clampedLedger.managedRun.calls, 1_000_000)
  assert.equal(clampedLedger.managedRun.tokens, 1_000_000_000)
  assert.equal(clampedLedger.managedRun.startedAt, 1795000000000)
  console.log('[W12 PASS] LLM usage ledger categorization, hard budget circuit breaker & manual chat exemption verified')

  // =========================================================================
  // W13: Alert Events Persistence & Incremental Notification / Audio Engine
  // =========================================================================
  const sidW13 = 'sess-w13-notify'
  await stateMod.queueChiefApproval(sidW13, {
    operationLabel: 'Approve build step',
    summary: 'Need human sign-off for release build',
    kind: 'tool',
    payload: { tool: 'ping', args: {} },
  })
  await stateMod.requestChiefElevation(sidW13, {
    targetMode: 'chief',
    reason: 'Need autonomous troubleshooting',
  })
  await stateMod.recordWorkspaceAlertEvent(sidW13, {
    kind: 'hazard_halt',
    level: 'danger',
    title: '🚨 强介入紧急煞停',
    body: 'Blocked unsafe destructive push',
  })
  const wsW13 = stateMod.ensureWorkspace(stateMod.loadChiefState(), sidW13)
  assert.ok(wsW13.alertEvents.some(e => e.kind === 'pending_approval'), 'W13 pending_approval alert must persist')
  assert.ok(wsW13.alertEvents.some(e => e.kind === 'pending_elevation'), 'W13 pending_elevation alert must persist')
  assert.ok(wsW13.alertEvents.some(e => e.kind === 'hazard_halt'), 'W13 hazard_halt alert must persist')

  const notifyMod = await import(modUrl('src/client/notify.js'))
  const i18nW13 = await import(modUrl('src/client/i18n.js'))
  notifyMod.resetAlertSessionBaselines()

  const hadWinDesc = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const hadNotifDesc = Object.getOwnPropertyDescriptor(globalThis, 'Notification')
  const sentNotifs = []
  let oscCreated = 0
  class MockNotification {
    static permission = 'granted'
    static async requestPermission() { return 'granted' }
    constructor(title, opts) {
      sentNotifs.push({ title, body: opts?.body || '', tag: opts?.tag || '' })
    }
  }
  class MockAudioContext {
    constructor() {
      this.currentTime = 0
      this.destination = {}
    }
    createOscillator() {
      oscCreated += 1
      return {
        type: 'sine',
        frequency: { setValueAtTime: () => {} },
        connect: () => {},
        start: () => {},
        stop: () => {},
      }
    }
    createGain() {
      return {
        gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
        connect: () => {},
      }
    }
    close() { return Promise.resolve() }
  }

  try {
    globalThis.Notification = MockNotification
    globalThis.window = { Notification: MockNotification, AudioContext: MockAudioContext }

    const nowMs = Date.now()
    const baselineRes = notifyMod.processIncomingAlertEvents(wsW13.alertEvents, {
      notifyEnabled: true,
      notifySound: true,
      sessionId: sidW13,
      nowMs,
    })
    assert.equal(baselineRes.initialized, true, 'W13 first session batch must initialize baseline silently')
    assert.equal(baselineRes.fired.length, 0)
    assert.equal(sentNotifs.length, 0, 'W13 historical alerts must not replay on initial load')

    const freshAlert = {
      id: 'alert-w13-fresh-' + nowMs,
      kind: 'guard_wall_blocked',
      level: 'warn',
      title: '🚧 自定义拦截规则已拦截',
      at: nowMs,
      body: 'Pre-tool wall intercepted rm -rf',
    }
    const staleAlert = {
      id: 'alert-w13-stale-' + nowMs,
      kind: 'hazard_halt',
      level: 'danger',
      title: '🚨 历史紧急煞停',
      at: nowMs - 200_000,
      body: 'Expired alert outside recency window',
    }
    i18nW13.setRuntimeUiLang('zh')
    const nextRes = notifyMod.processIncomingAlertEvents([...wsW13.alertEvents, freshAlert, staleAlert], {
      notifyEnabled: true,
      notifySound: true,
      sessionId: sidW13,
      nowMs: nowMs + 50,
    })
    assert.equal(nextRes.initialized, false)
    assert.equal(nextRes.fired.length, 1, 'W13 only fresh unseen alert inside recency window must fire')
    assert.equal(sentNotifs.length, 1)
    assert.ok(sentNotifs[0].title.includes('自定义拦截规则'), 'W13 desktop notification title must reflect localized custom block rule copy')
    assert.ok(oscCreated >= 2, 'W13 optional chime must trigger WebAudio 2-note oscillator')

    i18nW13.setRuntimeUiLang('en')
    const freshAlertEn = {
      id: 'alert-w13-en-' + nowMs,
      kind: 'guard_wall_blocked',
      level: 'warn',
      title: '🚧 Custom Block Rule Triggered',
      at: nowMs + 10,
      body: 'Pre-tool rule intercepted rm -rf',
    }
    const nextEnRes = notifyMod.processIncomingAlertEvents([...wsW13.alertEvents, freshAlert, staleAlert, freshAlertEn], {
      notifyEnabled: true,
      notifySound: true,
      sessionId: sidW13,
      nowMs: nowMs + 60,
    })
    assert.equal(nextEnRes.fired.length, 1, 'W13 incremental unseen English alert must fire once')
    assert.equal(sentNotifs.length, 2)
    assert.ok(sentNotifs[1].title.includes('Custom Block Rule'), 'W13 English notification title must reflect localized custom block rule copy')
  } finally {
    i18nW13.setRuntimeUiLang('auto')
    if (hadWinDesc) Object.defineProperty(globalThis, 'window', hadWinDesc)
    else delete globalThis.window
    if (hadNotifDesc) Object.defineProperty(globalThis, 'Notification', hadNotifDesc)
    else delete globalThis.Notification
    notifyMod.resetAlertSessionBaselines()
  }
  console.log('[W13 PASS] Milestone alertEvents persistence & baseline-suppressed Notification/chime engine verified')

  // =========================================================================
  // W14: Bilingual Markdown Retrospective Report & Secret Redaction
  // =========================================================================
  const reportMod = await import(modUrl('src/client/report.js'))
  const redacted = reportMod.redactReportSecrets(
    'API=sk-projAbCdEfGh1234567890 GH=ghp_1234567890abcdefghij12345 OK=clean',
  )
  assert.ok(!redacted.includes('sk-proj'), 'W14 OpenAI-like secret must be redacted')
  assert.ok(!redacted.includes('ghp_1234'), 'W14 GitHub PAT must be redacted')
  assert.ok(redacted.includes('[REDACTED]') && redacted.includes('OK=clean'))

  const sampleBoard = {
    objective: 'Ship v1.6.0 Away & Bilingual pack cleanly',
    mode: 'goal',
    goalApproval: { status: 'approved' },
    plan: [
      { id: 'st1', text: 'Implement backend ledger & alerts', done: true, summary: 'Verified via unit checks' },
      { id: 'st2', text: 'Run full CI gate', done: false },
    ],
    tasks: [
      { id: 't1', title: 'Add budget breaker', status: 'done', owner: 'lead', evidence: 'Passed Bearer SuperSecretTokenValue123456789012345 check' },
      { id: 't2', title: 'Verify local bundle', status: 'doing', subagent: 'qa-worker', note: 'Pending final SHA check' },
    ],
    bounds: {
      allowed: ['Run npm test'],
      forbidden: ['Never push without consent'],
      notes: ['Check Windows CRLF'],
    },
  }
  const sampleSecView = {
    narrative: { text: 'Supervisor stabilized pipeline and redacted sk-testSecretKey1234567890abcd in log.' },
    facts: [{ category: 'discipline', text: 'Always verify hashes before reporting' }],
    llmLedger: stateMod.summarizeLlmLedger(wsW12AfterChat.llmLedger, wsW12AfterChat.config),
  }
  const mdZh = reportMod.buildSessionReportMarkdown({
    board: sampleBoard,
    secView: sampleSecView,
    chiefMeta: { permissionMode: 'chief', runMode: 'managed', managedBudgetMaxCalls: 30, managedBudgetMaxTokens: 300000 },
    subagents: [{ name: 'qa-worker', status: 'running' }],
    guardWalls: [{ ruleType: 'command', title: 'No force push', activeNow: true }],
    sessionId: 'sess-w14-report',
    lang: 'zh',
  })
  const mdEn = reportMod.buildSessionReportMarkdown({
    board: sampleBoard,
    secView: sampleSecView,
    chiefMeta: { permissionMode: 'chief', runMode: 'managed', managedBudgetMaxCalls: 30, managedBudgetMaxTokens: 300000 },
    subagents: [{ name: 'qa-worker', status: 'running' }],
    guardWalls: [{ ruleType: 'command', title: 'No force push', activeNow: true }],
    sessionId: 'sess-w14-report',
    lang: 'en',
  })
  assert.ok(mdZh.includes('DSH 参谋长 · 任务复盘战报'), 'W14 zh Markdown header missing')
  assert.ok(mdEn.includes('DSH Chief · Session Retrospective Report'), 'W14 en Markdown header missing')
  assert.ok(mdZh.includes('[REDACTED]') && mdEn.includes('[REDACTED]'), 'W14 secret values inside task/digest must be redacted')
  assert.ok(!mdZh.includes('SuperSecretTokenValue') && !mdEn.includes('sk-testSecretKey'), 'W14 raw tokens must never leak into report')
  const dlFallback = reportMod.downloadSessionReportMarkdown(mdEn, 'sess-w14-report')
  assert.equal(dlFallback.fallbackCopy, true, 'W14 headless download helper must gracefully return fallbackCopy')
  console.log('[W14 PASS] Bilingual Markdown retrospective report generation & secret redaction verified')

  // =========================================================================
  // W15: 3 Scenario Presets (Observer / Co-Pilot / Away Mode) & Consent Gate
  // =========================================================================
  const sidW15 = 'sess-w15-presets'
  const pObs = await stateMod.updateChiefConfig({ session: sidW15, preset: 'observer' })
  assert.equal(pObs.ok, true)
  assert.equal(pObs.config.permissionMode, 'advisor')
  assert.equal(pObs.config.runMode, 'off')
  assert.equal(pObs.config.thinkingEffort, 'low')

  const pCollab = await stateMod.updateChiefConfig({ session: sidW15, preset: 'collab' })
  assert.equal(pCollab.ok, true)
  assert.equal(pCollab.config.permissionMode, 'strategist')
  assert.equal(pCollab.config.runMode, 'patrol')
  assert.equal(pCollab.config.tacticalModes.redlineSentinel, true)

  // Away preset elevates to L3 Chief + Managed AutoPilot -> MUST fail without explicit consent flags
  const pAwayNoConsent = await stateMod.updateChiefConfig({ session: sidW15, preset: 'away' })
  assert.equal(pAwayNoConsent.ok, false, 'W15 away preset without risk consent must be rejected')

  const pAwayOk = await stateMod.updateChiefConfig({
    session: sidW15,
    preset: 'away',
    confirmedChiefRisk: true,
    confirmedAutoPilot: true,
  })
  assert.equal(pAwayOk.ok, true, `W15 away preset with consent failed: ${pAwayOk.error || ''}`)
  assert.equal(pAwayOk.config.permissionMode, 'chief')
  assert.equal(pAwayOk.config.runMode, 'managed')
  assert.equal(pAwayOk.config.tacticalModes.autoCompact, true)
  assert.equal(pAwayOk.config.tacticalModes.compactThresholdMode, 'pct')
  assert.equal(pAwayOk.config.tacticalModes.compactThresholdPct, 80)
  assert.equal(pAwayOk.config.managedBudgetMaxCalls, 30)
  assert.equal(pAwayOk.config.managedBudgetMaxTokens, 300000)
  console.log('[W15 PASS] 3 Scenario presets (Observer / Co-Pilot / Away Mode) & L3 risk gate verified')

  // =========================================================================
  // W16: Bilingual locale/*.json Integrity & i18n.js Runtime Language Switching
  // =========================================================================
  const zhLoc = JSON.parse(fs.readFileSync(path.join(PKG, 'locale', 'zh.json'), 'utf8'))
  const enLoc = JSON.parse(fs.readFileSync(path.join(PKG, 'locale', 'en.json'), 'utf8'))
  for (const loc of [zhLoc, enLoc]) {
    assert.ok(loc.meta && loc.meta.title && loc.meta.description, 'W16 locale meta.title/description required')
    assert.ok(loc.ui && loc.ui.tabs && loc.ui.runModes && loc.ui.perms && loc.ui.presets, 'W16 locale ui sections required')
  }
  assert.deepEqual(Object.keys(zhLoc.ui.tabs).sort(), Object.keys(enLoc.ui.tabs).sort(), 'W16 zh/en tabs keys must match')

  const i18nMod = await import(modUrl('src/client/i18n.js'))
  const hadDocDesc = Object.getOwnPropertyDescriptor(globalThis, 'document')
  try {
    globalThis.document = {
      documentElement: {
        lang: 'en-US',
        getAttribute: name => (name === 'data-locale' ? 'en-US' : ''),
      },
    }
    i18nMod.setRuntimeUiLang('auto')
    assert.equal(i18nMod.detectHostLang(), 'en', 'W16 detectHostLang must detect host document lang en-US')
    assert.equal(i18nMod.getUiLang(), 'en')
    assert.equal(i18nMod.bi('中文标签', 'English Label'), 'English Label')
    assert.equal(i18nMod.tabLabel('chief'), 'Chief')

    i18nMod.setRuntimeUiLang('zh')
    assert.equal(i18nMod.getUiLang(), 'zh', 'W16 explicit zh override must win over English host document')
    assert.equal(i18nMod.bi('中文标签', 'English Label'), '中文标签')
    assert.equal(i18nMod.tabLabel('chief'), '参谋')
  } finally {
    i18nMod.setRuntimeUiLang('auto')
    if (hadDocDesc) Object.defineProperty(globalThis, 'document', hadDocDesc)
    else delete globalThis.document
  }
  console.log('[W16 PASS] Bilingual locale JSON integrity & i18n runtime host/manual language switching verified')

  console.log('ALL V1.6.0 WORKFLOW PIPELINE, MANAGED & BILINGUAL GATES PASSED (W1-W16)')
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
}
