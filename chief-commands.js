/**
 * chief-commands.js
 *
 * Natural-language command execution, tool loop orchestration, boundary consolidation, and objective suggestion for DSH Chief.
 */

import path from 'node:path'
import {
  resolveProjectKey,
  loadArchiveStore,
  listArchiveHeaders,
  getArchiveDetail,
  searchArchives,
  searchGlobalVaultForChief,
  mutateArchive,
  copyPrecipitatedToVault,
  getFlippedOutPrecipitatedForSession,
  listPrecipitatedHeaders,
  mutatePrecipitated,
} from './archives.js'
import {
  DEFAULT_CHIEF_PERMISSION_MODE,
  CHIEF_PERMISSION_META,
  normalizePermissionMode,
  permissionRank,
  getToolOpClass,
  evaluateSafetyGuardHardRules,
  evaluateChiefPermissionGate,
  buildCapabilityScope,
  validateGuardWallInput,
  listGuardWalls,
  CHIEF_TOOLS_PROMPT_GUIDE,
  runChiefAgenticLoop,
  stripToolCallMarkup,
} from './chief-executor.js'
import {
  FACTS_CAP,
  FACT_TEXT_MAX,
  CHAT_CAP,
  SUGGESTIONS_CAP,
  SUMMARY_MAX_TOKENS,
  archiveTargetForRoot,
  collectChiefVisibleArchives,
  persistChiefImagesToWorkspace,
  admitChiefImages,
  nextId,
  clamp,
  cleanMultiline,
  secretLike,
  hasValidChiefRiskAck,
  normalizeFact,
  normalizeSuggestion,
  resolveWorkspaceConfig,
  appendChiefAuditLog,
  pushAuditToWs,
  queueChiefApproval,
  requestChiefElevation,
  upsertTaskLedgerOnWs,
  enqueueChiefInquiryOnWs,
  loadChiefState,
  mutateChiefState,
  getLinkedCluster,
  setPeerLink,
  ensureWorkspace,
  clusterView,
  shortAgentBriefName,
  stripCheckpointNoise,
  isInternalCheckpointNoise,
  updateWorkspaceFlippedIds,
  extractJsonObject,
  resolveSessionWorkspaceCwd,
  CHIEF_INQUIRY_SOURCE,
  beginChiefActiveWork,
  endChiefActiveWork,
} from './chief-state.js'
import { callChiefLlm } from './chief-models.js'
import {
  collectClusterPeerProgress,
  listPeerDirectory,
  deliverCrossMessage,
  registerChiefDirectRequestHook,
} from './chief-network.js'
import {
  sanitizeConciseBriefText,
  buildConciseSixLineReport,
  summarizeSubagentsCompact,
  getChiefView,
} from './chief-view.js'
import { organizeArchivesWithChief, distillSessionArchivesToGlobal, buildChiefArchiveUpsertFn } from './chief-archives.js'
import { buildChiefCompactFn } from './chief-compaction.js'

const ASK_CHIEF_SYSTEM = [
  '你是「DSH 参谋长」（DSH Chief）——遵循四级权限安全架构（`L0 顾问 advisor` / `L1 助手 assistant` / `L2 参谋 strategist` / `L3 参谋长 chief`）的协同参谋中枢，新对话默认位于最低只读档 `L0 顾问模式`。',
  '你**绝不只是**被动的记忆检索器或传话筒！在当前所处权限允许范围内，你既可以动用实权工具直接核验/执行（或申请提权），也实时掌握：',
  '1) 主代理（@lead）与各子代理的**实时对话流快照**（刚刚说了什么、正在调什么工具、卡在哪里）；',
  '2) 参谋看板总目标、实时断点游标（cursor）、计划（plan）与任务拓扑（推进中 / 受阻 / 待办 / 已完成证据）；',
  '3) 双层工作边界（📌 定住全局跨任务共享边界 vs 仅当前任务边界）与持久记忆、便签、协同信箱。',
  '',
  '请精准洞悉用户意图——你的输入框就是用户的【全能许愿框】（态势汇报、只读核查、整理/维护看板与档案、修改工作区文件、调整主代理与子代理工作流、连接/断开协同网络或申请提权），并**只输出一个合法 JSON 对象**：',
  '{',
  '  "reply": "必须【简明、结构化、分点作答】！用换行 `- 【标签】结论` 列出（优先使用语义清晰标签：如【总目标】【实测执行】【推进中】【已完】【已验证】【结论】【待办】【受阻】【禁止红线】【权限提示】【下一步建议】），直给干货，绝不说『记忆里没有这条』，绝不堆砌废话或暴露内部 sessionId",',
  '  "toolCalls": [',
  '    { "tool": "read_file|list_dir|search_files|write_file|edit_file|run_command|main_agent_control|subagent_dispatch|subagent_steer|subagent_interrupt|archive_write|session_compact|request_permission_elevation", "args": {} }',
  '  ],',
  '  "elevationRequest": {',
  '    "targetMode": "assistant|strategist|chief",',
  '    "reason": "说明为何需要用户批准提权",',
  '    "requestedActionSummary": "拟执行的核心动作简述"',
  '  },',
  '  "relays": [',
  '    { "target": "成员 key 或名字（如 lead / 子代理名 / session-xxx / all）", "mode": "steer|followup|silent", "subject": "简短事由", "text": "替用户转化好的清晰可执行执行请求" }',
  '  ],',
  '  "inquiries": [',
  '    { "target": "lead", "question": "缺情报时向主对话提出的优先问询（禁止凭空瞎猜）", "context": "简短问询背景" }',
  '  ],',
  '  "wallProposals": [',
  '    {',
  '      "title": "物理驻墙名称",',
  '      "scope": "global|workspace",',
  '      "ruleType": "forbid_path|restrict_write|forbid_cmd|require_approval_cmd|deny_tool",',
  '      "patterns": ["被锁路径前缀/目录名 或 禁跑命令正则"],',
  '      "writeOnly": false,',
  '      "reason": "手搓这堵物理墙的原因"',
  '    }',
  '  ],',
  '  "wallRemovalProposals": [',
  '    {',
  '      "wallId": "阻塞任务的动态物理驻墙 ID（必须精确匹配上下文清单中的 wallId，极低概率仅在确认无替代路时填写）",',
  '      "wallTitle": "对应物理驻墙名称",',
  '      "action": "pause|remove",',
  '      "blockerEvidence": "主/子代理撞墙且确无绕过可能的实测证据（必填）",',
  '      "reason": "为何必须申请暂挂/拆除这堵物理墙才能继续当前任务"',
  '    }',
  '  ],',
  '  "memoryChanges": [',
  '    { "op": "add", "category": "discipline|architecture|progress|preference|team", "text": "一句独立完整的持久事实或规矩（不超过200字，绝不存密钥密码）" },',
  '    { "op": "edit", "index": 2, "text": "替换第2条的新内容" },',
  '    { "op": "remove", "index": 3 }',
  '  ],',
  '  "boundProposals": [',
  '    {',
  '      "field": "forbidden|allowed|notes",',
  '      "item": "拟请示用户注入的一句话高密度边界条文",',
  '      "reason": "撞墙教训、提炼依据或浓缩说明",',
  '      "replaces": ["可选：当把多条零散边界浓缩合并成一条时，逐字列出被合并替代的原边界条文"],',
  '      "pinGlobal": false',
  '    }',
  '  ],',
  '  "boardOps": [',
  '    { "op": "objective.set", "objective": "新总目标" },',
  '    { "op": "task.add", "title": "任务名", "owner": "可选负责人", "priority": "high|normal|low" },',
  '    { "op": "task.update", "id": "已有任务ID", "status": "todo|doing|blocked|done", "note": "可选进展或阻塞说明", "evidence": "可选完成证据", "owner": "可选负责人" },',
  '    { "op": "task.remove", "id": "要删除的任务ID" },',
  '    { "op": "task.reset", "status": "可选(all|open|done)，清空/重设任务列表", "resetPlan": false },',
  '    { "op": "graph.plan", "replace": false, "objective": "可选新目标", "tasks": [{ "id": "step1", "title": "重编任务", "owner": "", "priority": "high|normal|low", "blockedBy": [] }] },',
  '    { "op": "cursor.set", "step": "当前步骤", "next": "下一步具体动作", "blocked": "阻塞点（无则空串）" },',
  '    { "op": "bounds.set", "field": "forbidden|allowed|notes", "items": ["整列覆盖的新边界条文列表"] },',
  '    { "op": "bounds.forbid", "item": "用户明确下令立即写入的禁止红线", "pinGlobal": false },',
  '    { "op": "bounds.allow", "item": "用户明确下令立即写入的必做事项", "pinGlobal": false },',
  '    { "op": "bounds.note", "item": "用户明确下令立即写入的注意事项", "pinGlobal": false },',
  '    { "op": "bounds.remove", "field": "forbidden|allowed|notes", "item": "要移除的旧边界条文", "pinGlobal": false }',
  '  ],',
  '  "archiveOps": [',
  '    { "op": "organize", "vaultScope": "session|global", "scope": "unorganized|all", "instruction": "整理分类并织就钩子要求" },',
  '    { "op": "distill_to_global", "ids": ["可选：指定本局档案ID，留空自动筛选可复用本局经验"], "instruction": "提炼入全局要求" },',
  '    { "op": "pull_global", "id": "全局钩子档案ID", "title": "或标题关键词（参谋见全局钩子后按需拉阅全文）" },',
  '    { "op": "pin_to_desktop|unpin_from_desktop|deliver_to_lead", "vaultScope": "session|global", "id": "档案ID", "title": "或标题关键词", "target": "lead", "instruction": "可选附言（仅本局/已织钩全局；严禁触碰冷藏柜）" },',
  '    { "op": "copy_to_global|copy_to_session|move_folder|delete", "vaultScope": "session|global", "id": "目标档案ID", "title": "或标题关键词", "folder": "可选抽屉ID" },',
  '    { "op": "save", "vaultScope": "session|global", "title": "档案标题", "folder": "inbox|coords|incidents|contracts|ops|plans", "summary": "摘要", "body": "正文", "takeOut": false }',
  '  ],',
  '  "effortOps": [',
  '    { "target": "lead 或子代理名（如 coder）", "effort": "off|low|medium|high|xhigh", "reason": "为何调整该模型思考强度" }',
  '  ],',
  '  "networkOps": [',
  '    { "op": "link|unlink", "targetSessionId": "目标独立会话ID或名称关键词" }',
  '  ]',
  '}',
  '',
  '宰相参谋与行事准则：',
  '- 【懒介入与主会话优先铁律（严禁抢活越俎代庖）】：即使你已拥有高权限，也必须遏制亲自写代码或跑项目命令的冲动！凡是修改项目源码、跑构建测试、长程勘探排障，只要主对话在线可用且用户没有明确指定“参谋长你亲自来做/别找主对话”，一律优先放在 `"relays"` 中以正式执行请求形式交由 `@lead` 动手执行！只有用户点名直办、纯参谋内务（看板/档案/记忆/边界/物理墙草案）或主对话失联卡死时才亲自调工具。',
  '- 【优先问询渠道（缺信息就问主对话，严禁瞎猜）】：无论是在自主调配还是回答用户问题时，只要缺乏代码细节或实时状态确认，请输出 `"inquiries"` 向 `@lead` 发出优先问询，主对话会在不打断手头动作的情况下原路快答。',
  '- 【手搓动态物理墙与极低概率请示拆墙】：\n  1) 当用户让你“筑一堵物理墙/锁死某个目录或仓库/禁跑某个高危命令”时，直接将大白话诉求编译成 `"wallProposals"`（跨会话常驻设 `"scope": "global"`），呈交用户一键确认落锁；\n  2) **拆墙红线（极低触发）**：任何权限下（哪怕是 L3 最高权限）你都绝无权私拆或绕过物理驻墙！仅当主代理或子代理真实撞墙并确认无法绕过、向你上报阻断情况，且你独立复核确认确因该动态物理墙导致任务彻底无法推进、无合法替代路径时，才允许填入 `"wallRemovalProposals"` 向人类提交拆墙审批申请（硬安全内核规则永远不可申请拆除）；平时一切情形严禁主动填 `"wallRemovalProposals"`。',
  '- 【许愿框全权自治与三层档案隔离】：无论整理/分类/织钩/提炼档案入全局、`pin_to_desktop` 摆上认知桌面（2400 Tokens / 6 份上限）、`deliver_to_lead` 一次性向主对话递送关键档案、还是设定边界/重编任务、`effortOps` 调配主对话/子代理思考深度，只要符合当前权限，直接输出对应 JSON ops 执行到位。严禁触碰或读取冷藏档案柜（`precipitated` 100% 人类专属）；严禁越级让本局档案直接跳级沉淀，必须遵循 `本局 -> 全局 -> 冷藏` 梯度。',
  '- 【严守当前权限与禁止红线】：绝不越过当前权限等级上限，也绝不执行触发 `禁止红线 (forbidden)` 的写操作或高危命令。',
  '- 【问进展 / 问步骤 / 问卡点 / 求建议】：当用户询问“现在在做什么 / 处于什么步骤 / 目前进度如何 / 卡在哪里”等态势问题时，你面前的上下文已经完整包含「实时对话流快照」+「小任务板 (Plan)」+「任务图」+「断点游标」！直接用简明人话分点作答并放进 JSON 的 `reply` 字段，**严禁退化成纯工具 XML/DSML 标签输出，更严禁盲目运行 `run_command` / `list_dir` 扫盘**！只有用户明确要求去核查具体源码文件/跑命令实测时，才在 JSON `toolCalls` 里调工具。',
  '- 【代维护看板】：当用户让你「把某任务标为完成/受阻」「记一下下一步干啥」「改总目标」时，直接通过 `boardOps`（`task.update` / `cursor.set` / `objective.set` / `task.add`）落实（若强介入已锁定核心目标，则提示先解锁或关闭强介入）。',
  '- 【边界奏请与零散浓缩】：',
  '  1) 总结踩坑红线或必做要求时，生成 `boundProposals` 呈交用户拍板（若用户提到「全局定住/以后所有任务都生效」则设 `"pinGlobal": true`）；只有用户明确下令「直接写进禁止/必做边界」时才用 `boardOps`。',
  '  2) 当用户要求「把重要的零散边界总结成一条 / 合并重复边界」时，仔细阅读现有边界，保留关键命令名/路径/硬红线，浓缩为 1 条精炼总则放入 `boundProposals[0].item`，并把被它吸收替代的旧条文原样放进 `replaces` 数组（若被合并旧规中含 📌 全局定住项，则 `"pinGlobal": true`）。',
  '- 【看图与带图拆话】：当用户附带上传图片时，请直接结合图片画面诊断 UI 样式、报错截图或架构图；若你在 relays 中向代理拆话派活，系统会自动把用户附带的图片一并转送给目标代理。',
].join('\n')

const CONCISE_BRIEF_ASK_EXTRA = [
  '',
  '⚡ 【极简战报模式已开启 — reply 字段强约束（六句话目标边界系列）】：',
  '- 一切以目标为导向，说人话，拒绝任何文件/代码/命令/端口/数字/计数等事务细节！',
  '- 总结现状或汇报进度时，优先按如下 6 条一句话边界结构输出：',
  '  ## 极简目标战报',
  '  - 【🎯 总目标】一句话说清最终目标',
  '  - 【🚀 当前推进目标】一句话说清正在推进的目标',
  '  - 【⛔ 受阻目标】一句话点明受阻处或“当前暂无受阻目标”',
  '  - 【🧰 需要什么】一句话说明还需什么条件或验证',
  '  - 【🙋 用户需要提供什么】一句话说明需用户提供/拍板的内容（或“暂无需您额外提供”）',
  '  - 【💡 参谋长建议】一句话给出明确建议',
  '- ⚠️ JSON 顶层结构铁律：上述六句话战报只能作为顶层合法 JSON 对象内 `"reply"` 字段的字符串值！绝不允许直接裸输出 Markdown！若用户要求手搓物理驻墙或提炼/总结工作边界（或你在回复中提出了要补充/禁用的红线或边界），必须同步将完整条目填入 `"wallProposals"` 与 `"boundProposals"` 数组（JSON 字符串内的正则反斜杠须写双反斜杠 `\\\\`）。',
].join('\n')

const CONSULT_CHIEF_EXTRA = [
  '',
  '💡 【当前为「参谋页面咨询（按需给建议）」模式 — 实事求是铁律】：',
  '- 请结合当前任务进展、最近对话、工作边界与团队状态，在 `"reply"` 中坦诚给出真正有价值的观察、风险提醒或推进建议。',
  '- 若当前推进顺利确实暂无建议，或用户关心的事项属于人类拍板/外部事务/非参谋与代理会话能管得了的范畴：**直接如实告诉用户就行！严禁为了凑动作而硬编 `"relays"`、`"boardOps"`、`"archiveOps"`、`"boundProposals"` 或执行建议，上述动作数组务必全部留空 `[]`**！',
  '- 仅当确实存在可落地的具体动作建议时，才填入对应 JSON 字段，并严格遵守当前四级权限（L0 仅文本分析与必要提权申请，L1–L3 按对应权限审批/执行机制运行）。',
].join('\n')

function extractFallbackBoundProposalsFromText(rawText = '', userInput = '') {
  const txt = String(rawText || '')
  if (!txt.trim()) return []
  const wantBounds = /boundProposals|提炼.*边界|总结.*边界|边界注入/i.test(String(userInput || ''))
    || /(?:提案\s*\d+|boundProposals)/i.test(txt)
  if (!wantBounds) return []
  const out = []
  const seen = new Set()
  for (const line of txt.split(/\r?\n/)) {
    const clean = line.trim()
    const m = clean.match(/^[-*•]?\s*【(?:提案\s*\d*[·:：\s]*)?(红线|禁止红线|禁止|必做事项|必做|允许|注意事项|注意)[^】]*】\s*(.+)$/)
    if (!m) continue
    const kindWord = m[1]
    const field = /必做|允许/.test(kindWord) ? 'allowed' : (/注意/.test(kindWord) ? 'notes' : 'forbidden')
    const rawItem = m[2]
      .replace(/[（(]\s*(?:📌\s*)?(?:全局|本任务)[^）)]*[）)]\s*$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    const item = clamp(rawItem, 220)
    if (!item || seen.has(item)) continue
    seen.add(item)
    out.push({
      field,
      item,
      pinGlobal: /📌|全局/.test(clean),
      reason: '从参谋长提炼建议自动提取入审，请用户拍板确认。',
    })
    if (out.length >= 4) break
  }
  return out
}

const CONSOLIDATE_BOUNDS_SYSTEM = [
  '你是「DSH 参谋长」（宰相级边界治理中枢）。用户的边界列表中积累了多条零散、重复或同一主题的规则。',
  '请将给定的多条零散边界**浓缩合并成唯一 1 条**高信息密度、表述清晰、可直接执行的精炼总则（不超过 180 字）。',
  '硬性要求：',
  '- 必须完整保留关键具象锚点（如禁止的具体命令 `git push` / `install_bundle`、具体目录路径、权限红线），绝不能浓缩成空洞套话！',
  '- 用紧凑的分号或并列短句收纳核心约束，去除重复啰嗦的铺垫词。',
  '- **只输出一个合法 JSON 对象**：',
  '{',
  '  "item": "浓缩合并后的单条精炼边界总则（≤180字）",',
  '  "reason": "简述合并了哪几类零散约束（≤70字）"',
  '}',
].join('\n')

/**
 * Inspect live in-memory conversation streams (`agent.session.deriveMessages()`)
 * across `@lead` and active/recent `@subagents` so DSH Chief has real-time
 * situational awareness even before a turn settles into `board.tasks` or `board.memory`.
 */
function collectLiveConversationsDigest(deps, rootId, directory) {
  const entries = []
  const runtime = deps && deps.runtime
  const agentsSvc = runtime ? runtime.get('agents') : null
  if (!agentsSvc || typeof agentsSvc.get !== 'function') {
    return { entries, summaryLines: [] }
  }

  const allTargets = Array.isArray(directory && directory.targets) ? directory.targets : []
  // Filter out idle internal checkpoint probes (`mnemon-review-*`) so real workers stand out
  const meaningfulTargets = allTargets.filter(t => {
    if (!t || !t.id) return false
    if (t.kind === 'lead') return true
    if (t.status === 'running') return true
    return !/^mnemon-review/i.test(String(t.name || t.handle || ''))
  })

  // Prioritize: lead first, then running subagents/peers, then up to 4 recent workers
  const ordered = [
    ...meaningfulTargets.filter(t => t.kind === 'lead'),
    ...meaningfulTargets.filter(t => t.kind !== 'lead' && t.status === 'running'),
    ...meaningfulTargets.filter(t => t.kind !== 'lead' && t.status !== 'running'),
  ].slice(0, 6)

  if (!ordered.length && rootId) {
    ordered.push({ key: 'lead', id: rootId, handle: 'lead', name: '主对话', kind: 'lead', status: 'idle', taskTitle: '' })
  }

  for (const peer of ordered) {
    let agent = null
    try {
      agent = agentsSvc.get(peer.id)
    } catch {}
    if (!agent || !agent.session || typeof agent.session.deriveMessages !== 'function') continue

    let msgs = []
    try {
      msgs = agent.session.deriveMessages() || []
    } catch {
      continue
    }
    if (!Array.isArray(msgs) || !msgs.length) continue

    const liveStatus = agent.status === 'running' ? 'running' : (peer.status || 'idle')
    let lastUser = ''
    const recentAssistant = []
    const recentTools = []

    const tail = msgs.slice(-8)
    for (const m of tail) {
      if (!m || !m.role) continue
      const isInjected = m.source && m.source.kind && m.source.kind !== 'user'
      const blocks = Array.isArray(m.content)
        ? m.content
        : (typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : [])

      const textParts = []
      for (const b of blocks) {
        if (!b || typeof b !== 'object') continue
        if (b.type === 'text' && typeof b.text === 'string') {
          textParts.push(b.text)
        } else if ((b.type === 'tool_use' || b.type === 'tool-call' || b.type === 'toolCall') && (b.name || b.toolName)) {
          const tName = String(b.name || b.toolName)
          let argHint = ''
          try {
            const rawArgs = b.input || b.arguments || b.args
            const obj = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs
            if (obj && typeof obj === 'object') {
              const keyVal = obj.command || obj.cmd || obj.action || obj.path || obj.file_path || obj.query || obj.url || obj.agent || obj.title || ''
              if (keyVal && !secretLike(String(keyVal))) argHint = clamp(String(keyVal), 48)
            }
          } catch {}
          recentTools.push(argHint ? `${tName}(${argHint})` : tName)
        }
      }

      const txt = stripCheckpointNoise(textParts.join('\n').trim())
      if (!txt || isInternalCheckpointNoise(txt) || secretLike(txt)) continue

      if (m.role === 'user' && !isInjected) {
        lastUser = clamp(txt, 260)
      } else if (m.role === 'assistant') {
        recentAssistant.push(clamp(txt, 380))
      }
    }

    if (!lastUser && !recentAssistant.length && !recentTools.length) continue
    entries.push({
      key: peer.key,
      handle: peer.handle || peer.name || peer.key,
      kind: peer.kind,
      status: liveStatus,
      taskTitle: peer.taskTitle || '',
      lastUser,
      lastAssistant: recentAssistant.length ? recentAssistant[recentAssistant.length - 1] : '',
      recentTools: recentTools.slice(-4),
    })
  }

  const summaryLines = entries.map((e) => {
    const parts = [`- **@${e.handle}** [${e.status === 'running' ? '🟢运行中' : '⚪空闲'}]${e.taskTitle ? '（负责：' + clamp(e.taskTitle, 48) + '）' : ''}`]
    if (e.lastUser) parts.push(`  · 最近用户指令：${e.lastUser}`)
    if (e.recentTools.length) parts.push(`  · 近期工具动作：${e.recentTools.join(' → ')}`)
    if (e.lastAssistant) parts.push(`  · 最新回复/进展：${e.lastAssistant}`)
    return parts.join('\n')
  })

  return { entries, summaryLines }
}

export function applyFactChanges(ws, numberedFacts, changes, actor = 'user', meta = {}) {
  const applied = []
  if (!Array.isArray(changes) || !changes.length) return applied
  const originRootId = typeof meta.originRootId === 'string' ? meta.originRootId : ''
  const clusterRoots = Array.isArray(meta.peerRootIds) ? meta.peerRootIds : []

  for (const ch of changes.slice(0, 12)) {
    if (!ch || typeof ch !== 'object') continue
    const op = String(ch.op || '').trim()
    if (op === 'add') {
      const category = ch.category || 'discipline'
      const fact = normalizeFact({
        text: ch.text,
        category,
        by: actor,
        source: 'chief',
        originRootId: originRootId && originRootId !== 'global' ? originRootId : '',
        peerRootIds: category === 'team' ? clusterRoots : [],
      })
      if (!fact) continue
      const dup = ws.facts.find(f => f.text === fact.text)
      if (dup) {
        dup.updatedAt = Date.now()
        continue
      }
      ws.facts.push(fact)
      if (ws.facts.length > FACTS_CAP) ws.facts = ws.facts.slice(-FACTS_CAP)
      applied.push({ op: 'add', text: fact.text })
    } else if (op === 'edit') {
      const target = numberedFacts[Number(ch.index) - 1]
      const nextText = clamp(ch.text, FACT_TEXT_MAX)
      if (!target || !nextText || secretLike(nextText)) continue
      const found = ws.facts.find(f => f.id === target.id)
      if (found && !found.pinned) {
        found.text = nextText
        found.updatedAt = Date.now()
        applied.push({ op: 'edit', text: nextText })
      }
    } else if (op === 'remove') {
      const target = numberedFacts[Number(ch.index) - 1]
      if (!target) continue
      const idx = ws.facts.findIndex(f => f.id === target.id)
      if (idx !== -1 && !ws.facts[idx].pinned) {
        const [removed] = ws.facts.splice(idx, 1)
        applied.push({ op: 'remove', text: removed.text })
      }
    }
  }
  return applied
}

export function applyBoardOps(deps, rootId, boardOps, opts = {}) {
  const executed = []
  if (!Array.isArray(boardOps) || !boardOps.length || !deps || typeof deps.runAction !== 'function') return executed
  const forceSessionOnly = Boolean(opts && opts.forceSessionOnly)
  const allowLockedObjectiveWrite = Boolean(opts && opts.allowLockedObjectiveWrite)
  const callerOrigin = String((opts && opts.callerOrigin) || 'chief_llm')
  const effCfg = resolveWorkspaceConfig(loadChiefState(), rootId)
  const objectiveLocked = Boolean(effCfg && effCfg.tacticalModes && effCfg.tacticalModes.intervention) && !allowLockedObjectiveWrite

  for (const opItem of boardOps.slice(0, 10)) {
    if (!opItem || typeof opItem !== 'object') continue
    const op = String(opItem.op || '').trim()
    if (op === 'objective.set' && opItem.objective) {
      if (objectiveLocked) {
        executed.push('核心目标已锁定（强介入进行中，跳过改写）')
        continue
      }
      deps.runAction({ action: 'objective.set', objective: String(opItem.objective), session: rootId, by: 'chief' })
      executed.push('更新目标：' + clamp(opItem.objective, 40))
    } else if (op === 'task.add' && opItem.title) {
      deps.runAction({
        action: 'task.add',
        title: String(opItem.title),
        owner: opItem.owner ? String(opItem.owner) : '',
        subagent: opItem.owner ? String(opItem.owner) : '',
        priority: opItem.priority || 'normal',
        session: rootId,
        by: 'chief',
      })
      executed.push('新增任务：' + clamp(opItem.title, 40))
    } else if (op === 'task.update' && (opItem.id || opItem.taskId)) {
      const tid = String(opItem.id || opItem.taskId).trim()
      const res = deps.runAction({
        action: 'task.update',
        id: tid,
        ...(typeof opItem.status === 'string' ? { status: opItem.status } : {}),
        ...(typeof opItem.note === 'string' ? { note: opItem.note } : {}),
        ...(typeof opItem.evidence === 'string' ? { evidence: opItem.evidence } : {}),
        ...(typeof opItem.owner === 'string' ? { owner: opItem.owner } : {}),
        session: rootId,
        by: 'chief',
      })
      if (res && res.ok) executed.push(`更新任务 #${tid}${opItem.status ? ' → ' + opItem.status : ''}`)
    } else if (op === 'task.remove' && (opItem.id || opItem.taskId)) {
      const tid = String(opItem.id || opItem.taskId).trim()
      const res = deps.runAction({ action: 'task.remove', id: tid, session: rootId, by: 'chief' })
      if (res && res.ok) executed.push(`移除任务 #${tid}`)
    } else if (op === 'task.reset') {
      const res = deps.runAction({
        action: 'task.reset',
        ...(typeof opItem.status === 'string' ? { status: opItem.status } : {}),
        ...(opItem.resetPlan !== undefined ? { resetPlan: Boolean(opItem.resetPlan) } : {}),
        session: rootId,
        by: 'chief',
      })
      if (res && res.ok) executed.push(`重设任务看板(${res.removedCount ?? 0}项)`)
    } else if ((op === 'graph.plan' || op === 'task.batch') && Array.isArray(opItem.tasks) && opItem.tasks.length > 0) {
      const canSetObj = !objectiveLocked && typeof opItem.objective === 'string' && opItem.objective.trim()
      const res = deps.runAction({
        action: 'graph.plan',
        tasks: opItem.tasks,
        ...(canSetObj ? { objective: opItem.objective } : {}),
        ...(opItem.replace !== undefined ? { replace: Boolean(opItem.replace) } : {}),
        session: rootId,
        by: 'chief',
      })
      if (res && res.ok) executed.push(`重编任务拓扑(${(res.tasks || opItem.tasks).length}项)`)
    } else if (op === 'cursor.set') {
      const res = deps.runAction({
        action: 'cursor.set',
        ...(typeof opItem.step === 'string' ? { step: opItem.step } : {}),
        ...(typeof opItem.next === 'string' ? { next: opItem.next } : {}),
        ...(typeof opItem.blocked === 'string' ? { blocked: opItem.blocked } : {}),
        session: rootId,
        by: 'chief',
      })
      if (res && res.ok) executed.push('更新推进断点')
    } else if (op === 'plan.resetForGoal') {
      const res = deps.runAction({ action: 'plan.resetForGoal', session: rootId, by: 'chief' })
      if (res && res.ok) executed.push('清空陈旧计划以便按新目标重编')
    } else if (op === 'plan.set' && Array.isArray(opItem.steps)) {
      const steps = opItem.steps.map(s => (typeof s === 'string' ? { text: s, done: false } : s)).filter(Boolean)
      if (steps.length > 0) {
        const res = deps.runAction({ action: 'plan.set', steps, session: rootId, by: 'chief' })
        if (res && res.ok) executed.push(`更新计划共 ${steps.length} 步`)
      }
    } else if (op === 'goal.proposeApproval') {
      const res = deps.runAction({
        action: 'goal.proposeApproval',
        objective: String(opItem.objective || ''),
        summary: String(opItem.summary || ''),
        evidence: String(opItem.evidence || ''),
        session: rootId,
        by: 'chief',
      })
      if (res && res.ok) executed.push('呈批目标结项')
    } else if (op === 'bounds.set') {
      const rawField = String(opItem.field || '').trim().toLowerCase()
      const normField = rawField === 'must' ? 'allowed' : rawField
      const col = ['forbidden', 'allowed', 'notes'].includes(normField) ? normField : ''
      if (col && Array.isArray(opItem.items)) {
        const items = opItem.items.map(x => clamp(x, 220)).filter(Boolean)
        const res = deps.runAction({ action: 'bounds.set', field: col, items, session: rootId, by: 'chief', _callerOrigin: callerOrigin })
        if (res && res.ok) executed.push(`覆写边界(${col})共 ${items.length} 条`)
        else if (res && res.blockedBySafetyGuard) executed.push(`🛡️ 已拦截覆写红线(${col})`)
      } else if (Array.isArray(opItem.allowed) || Array.isArray(opItem.must) || Array.isArray(opItem.forbidden) || Array.isArray(opItem.notes)) {
        const allowList = Array.isArray(opItem.allowed) ? opItem.allowed : opItem.must
        const res = deps.runAction({
          action: 'bounds.set',
          ...(Array.isArray(allowList) ? { allowed: allowList.map(x => clamp(x, 220)).filter(Boolean) } : {}),
          ...(Array.isArray(opItem.forbidden) ? { forbidden: opItem.forbidden.map(x => clamp(x, 220)).filter(Boolean) } : {}),
          ...(Array.isArray(opItem.notes) ? { notes: opItem.notes.map(x => clamp(x, 220)).filter(Boolean) } : {}),
          session: rootId,
          by: 'chief',
          _callerOrigin: callerOrigin,
        })
        if (res && res.ok) executed.push('重置边界列表')
        else if (res && res.blockedBySafetyGuard) executed.push('🛡️ 已拦截批量覆写边界')
      }
    } else if ((op === 'bounds.forbid' || op === 'bounds.allow' || op === 'bounds.must' || op === 'bounds.note') && opItem.item) {
      const field = op === 'bounds.forbid' ? 'forbidden' : (op === 'bounds.note' ? 'notes' : 'allowed')
      const label = field === 'forbidden' ? '红线' : (field === 'notes' ? '注意' : '必做')
      const val = clamp(opItem.item, 220)
      const pinned = forceSessionOnly ? false : Boolean(opItem.pinGlobal)
      if (val) {
        const res = deps.runAction({
          action: 'bounds.add',
          field,
          item: val,
          pinned,
          session: rootId,
          by: 'chief',
          _callerOrigin: callerOrigin,
        })
        if (res && res.ok) {
          executed.push(`${pinned ? '📌全局' : '本任务'}${label}：${clamp(val, 30)}`)
        } else if (res && res.blockedBySafetyGuard) {
          executed.push(`🛡️ 已拦截写入边界(${field})`)
        }
      }
    } else if (op === 'bounds.remove' && opItem.item) {
      const field = ['forbidden', 'allowed', 'notes'].includes(opItem.field) ? opItem.field : 'forbidden'
      const val = clamp(opItem.item, 220)
      const pinned = forceSessionOnly ? false : Boolean(opItem.pinGlobal)
      if (val) {
        const res = deps.runAction({
          action: 'bounds.remove',
          field,
          item: val,
          pinned,
          session: rootId,
          by: 'chief',
          _callerOrigin: callerOrigin,
        })
        if (res && res.ok) {
          executed.push(`移除边界：${clamp(val, 30)}`)
        } else if (res && res.blockedBySafetyGuard) {
          executed.push(`🛡️ 已拦截移除红线(${field})`)
        }
      }
    }
  }
  return executed
}

/**
 * Execute Wishing-Box `archiveOps` across Session / Global / Precipitated vaults
 * while strictly preserving the upward gradient (`session -> global -> precipitated`;
 * direct session -> precipitated jump is forbidden).
 */
const MAIN_INJECT_ARCHIVE_OPS = new Set(['pin_to_desktop', 'unpin_from_desktop', 'take_out', 'put_back', 'deliver_to_lead'])

function normalizeArchiveOpName(rawOp) {
  const s = String(rawOp || '').trim()
  if (s === 'take_out') return 'pin_to_desktop'
  if (s === 'put_back') return 'unpin_from_desktop'
  return s
}

function resolveItemIdForChiefScope(scope, rawId, rawTitle, { sessionOpt, globalOpt }) {
  const idQ = String(rawId || '').trim()
  const titleQ = String(rawTitle || '').trim().toLowerCase()
  const opt = scope === 'global' ? globalOpt : sessionOpt
  if (!opt) return idQ
  const store = loadArchiveStore(opt)
  const items = Array.isArray(store.items) ? store.items : []
  if (idQ) {
    const exact = items.find(it => it.id === idQ)
    if (exact) return exact.id
  }
  if (titleQ) {
    const byTitle = items.find(it => String(it.title || '').toLowerCase().includes(titleQ))
    if (byTitle) return byTitle.id
  }
  return idQ
}

/**
 * Shared Chief executor for main-session archive injection ops (`pin_to_desktop`, `unpin_from_desktop`, `deliver_to_lead`)
 * and `pull_global`, enforcing strict cold-vault isolation and dual-channel injection rules.
 */
export async function executeChiefArchiveInjectionOp(deps, rootId, opItem = {}, opts = {}) {
  const sid = rootId && rootId !== 'global' ? String(rootId).trim() : ''
  const op = normalizeArchiveOpName(opItem.op)
  const scope = opItem.vaultScope === 'precipitated'
    ? 'precipitated'
    : (opItem.vaultScope === 'global' ? 'global' : 'session')
  if (scope === 'precipitated' || op === 'pull_precipitated') {
    return { ok: false, blocked: true, error: '冷藏档案柜 100% 归属人类专属隔离，参谋无权读档或推送。' }
  }
  if (!sid) {
    return { ok: false, error: '当前为空白未绑定会话，无法推上桌面或递送主对话。' }
  }
  const globalOpt = archiveTargetForRoot(deps, sid, { vaultScope: 'global' })
  const sessionOpt = archiveTargetForRoot(deps, sid, { vaultScope: 'session' })
  const hitId = resolveItemIdForChiefScope(scope, opItem.id || opItem.archiveId, opItem.title, { sessionOpt, globalOpt })
  if (!hitId) {
    return { ok: false, error: '未匹配到目标工程档案。' }
  }
  const targetOpt = scope === 'global' ? globalOpt : sessionOpt

  if (op === 'pin_to_desktop' || op === 'unpin_from_desktop') {
    const mOp = op === 'pin_to_desktop' ? 'pinToDesktop' : 'unpinFromDesktop'
    const r = mutateArchive({
      op: mOp,
      vaultScope: scope,
      rootSessionId: sid,
      id: hitId,
      by: opts.by || 'chief',
    }, targetOpt)
    if (!r || !r.ok) {
      return { ok: false, error: (r && r.error) || '桌面调配失败' }
    }
    const ev = Array.isArray(r.evicted) && r.evicted.length > 0 ? `（超 2400 Tokens/6 份自动撤回：${r.evicted.map(x => `《${clamp(x.title, 18)}》`).join('、')}）` : ''
    const actionText = `${op === 'pin_to_desktop' ? '📌 摆上桌面' : '撤出桌面'} #${hitId}${ev}`
    return { ok: true, op, scope, id: hitId, evicted: r.evicted || [], actionText }
  }

  if (op === 'deliver_to_lead') {
    const det = getArchiveDetail(hitId, sid, targetOpt)
    if (!det || !det.ok || !det.item) {
      return { ok: false, error: '未读取到待递送档案内容' }
    }
    const it = det.item
    const ptLines = Array.isArray(it.points) && it.points.length > 0
      ? it.points.slice(0, 5).map(pt => `- ${pt.title}：${clamp(pt.detail || pt.cue, 180)}`)
      : []
    const instr = cleanMultiline(opItem.instruction || opItem.note || '', 240)
    const msgBody = [
      `[DSH 参谋长档案馆 · 一次性重点递送（不占桌面置顶槽）]`,
      `来源：${scope === 'global' ? '🌐 全局档案柜（参谋核准后专递）' : '🗂️ 本局档案柜'} · 《${clamp(it.title, 48)}》 (id=${it.id})`,
      instr ? `参谋附言：${instr}` : '',
      it.summary ? `提要：${clamp(it.summary, 200)}` : '',
      ...(ptLines.length ? ['核心要点：', ...ptLines] : []),
      !ptLines.length && it.body ? `正文节选：\n${clamp(it.body, 900)}` : '',
    ].filter(Boolean).join('\n')

    const deliverTarget = String(opItem.target || 'lead').trim() || 'lead'
    const deliv = await deliverCrossMessage(deps, {
      fromSession: sid,
      fromLabel: opts.byLabel || 'DSH 参谋长 (档案馆重点递送)',
      target: deliverTarget,
      subject: `档案馆递送《${clamp(it.title, 28)}》`,
      text: msgBody,
      mode: 'steer',
      envelopeKind: 'execution_request',
      recordBoardLog: true,
    })
    mutateArchive({ op: 'markDeliveredToLead', vaultScope: scope, rootSessionId: sid, id: hitId }, targetOpt)
    return {
      ok: Boolean(deliv && deliv.ok),
      op,
      scope,
      id: hitId,
      delivery: deliv,
      actionText: deliv && deliv.ok
        ? `📨 递送档案《${clamp(it.title, 20)}》→ ${deliv.target || deliverTarget}`
        : `递送失败：${(deliv && deliv.error) || '目标不可达'}`,
    }
  }

  if (op === 'pull_global') {
    const r = mutateArchive({ op: 'pullByChief', vaultScope: 'global', rootSessionId: sid, id: hitId }, globalOpt)
    if (r && r.ok) {
      return { ok: true, op, scope: 'global', id: hitId, actionText: `👁️ 参谋拉阅全局档案 #${hitId}` }
    }
    return { ok: false, error: (r && r.error) || '全局拉阅失败' }
  }

  return { ok: false, error: `不支持的档案注入指令：${op}` }
}

/**
 * Execute Wishing-Box `archiveOps` requested by user in natural language (`整理`/`提炼入全局`/内务操作),
 * strictly enforcing cold-vault 0-byte isolation (`precipitated` blocked) and upward gradient (`session -> global -> precipitated`).
 */
async function applyArchiveOps(deps, rootId, archiveOps, ctx = {}) {
  const executed = []
  if (!Array.isArray(archiveOps) || !archiveOps.length) return { executed, changed: false }
  const sid = rootId && rootId !== 'global' ? String(rootId).trim() : ''
  const globalOpt = archiveTargetForRoot(deps, sid || 'global', { vaultScope: 'global' })
  const sessionOpt = sid ? archiveTargetForRoot(deps, sid, { vaultScope: 'session' }) : null
  let changed = false

  const resolveItemInScope = (scope, rawId, rawTitle) =>
    resolveItemIdForChiefScope(scope, rawId, rawTitle, { sessionOpt, globalOpt })

  for (const opItem of archiveOps.slice(0, 8)) {
    if (!opItem || typeof opItem !== 'object') continue
    const op = normalizeArchiveOpName(opItem.op)
    const scope = opItem.vaultScope === 'precipitated'
      ? 'precipitated'
      : (opItem.vaultScope === 'global' ? 'global' : 'session')

    // Cold vault (`precipitated`) is 100% human-only: Chief may never inspect, pin, or pull from it.
    if (scope === 'precipitated' || op === 'pull_precipitated') {
      executed.push('🧊 已拦截：冷藏档案柜仅人类可见，参谋无权读取或调取')
      continue
    }

    if (op === 'organize') {
      const orgScope = opItem.vaultScope === 'global' ? 'global' : 'session'
      if (orgScope === 'session' && !sid) continue
      const r = await organizeArchivesWithChief(deps, {
        sessionId: sid || 'global',
        vaultScope: orgScope,
        ids: Array.isArray(opItem.ids) ? opItem.ids : [],
        scope: opItem.scope === 'all' ? 'all' : 'unorganized',
        instruction: String(opItem.instruction || ctx.input || ''),
      }).catch(() => null)
      if (r && r.ok) {
        changed = true
        executed.push(`整理${orgScope === 'global' ? '全局' : '本局'}档案 ×${r.updatedCount ?? 0}`)
      }
    } else if (op === 'distill_to_global' || op === 'distill') {
      if (!sid) continue
      const r = await distillSessionArchivesToGlobal(deps, {
        sessionId: sid,
        ids: Array.isArray(opItem.ids) ? opItem.ids : (opItem.id ? [opItem.id] : []),
        instruction: String(opItem.instruction || ctx.input || ''),
      }).catch(() => null)
      if (r && r.ok) {
        changed = true
        executed.push(`提炼入全局 ×${r.createdCount ?? 0}`)
      }
    } else if (op === 'pull_global') {
      const r = await executeChiefArchiveInjectionOp(deps, rootId, { ...opItem, op: 'pull_global', vaultScope: 'global' })
      if (r && r.ok) {
        changed = true
        executed.push(r.actionText)
      }
    } else if (op === 'save' || op === 'create') {
      if (scope === 'session' && !sid) continue
      const targetOpt = scope === 'global' ? globalOpt : sessionOpt
      const allowPin = Boolean(opItem.takeOut) && optsTakeOutAllowed(ctx)
      const r = mutateArchive({
        op: 'save',
        vaultScope: scope,
        rootSessionId: sid,
        folder: opItem.folder || 'inbox',
        paperclip: ['gold', 'silver', 'copper'].includes(opItem.paperclip) ? opItem.paperclip : 'silver',
        title: clamp(opItem.title || '参谋长工作归档', 160),
        summary: clamp(opItem.summary || '', 400),
        body: cleanMultiline(opItem.body || opItem.summary || opItem.title || '', 12000),
        takeOutNow: allowPin,
        organizedBy: 'chief',
        by: 'chief',
      }, targetOpt)
      if (r && r.ok) {
        changed = true
        executed.push(`存档(${scope === 'global' ? '全局' : '本局'})：《${clamp(opItem.title || '', 24)}》`)
      }
    } else if (op === 'pin_to_desktop' || op === 'unpin_from_desktop' || op === 'deliver_to_lead') {
      const r = await executeChiefArchiveInjectionOp(deps, rootId, opItem, ctx)
      if (r && r.ok) {
        changed = true
        executed.push(r.actionText)
      }
    } else if (op === 'mount_chief' || op === 'unmount_chief') {
      if (!sid) continue
      const hitId = resolveItemInScope('global', opItem.id || opItem.archiveId, opItem.title)
      if (!hitId) continue
      const r = mutateArchive({
        op: op === 'mount_chief' ? 'mountChief' : 'unmountChief',
        vaultScope: 'global',
        rootSessionId: sid,
        id: hitId,
      }, globalOpt)
      if (r && r.ok) {
        changed = true
        executed.push(`${op === 'mount_chief' ? '参阅全局档案' : '取消全局参阅'} #${hitId}`)
      }
    } else if (op === 'copy_to_global') {
      if (!sid) continue
      const hitId = resolveItemInScope('session', opItem.id || opItem.archiveId, opItem.title)
      if (!hitId) continue
      const r = mutateArchive({ op: 'copyToGlobal', vaultScope: 'session', rootSessionId: sid, id: hitId }, sessionOpt)
      if (r && r.ok) {
        changed = true
        executed.push(`升入全局档案 #${hitId}`)
      }
    } else if (op === 'copy_to_session') {
      if (!sid) continue
      const hitId = resolveItemInScope('global', opItem.id || opItem.archiveId, opItem.title)
      if (!hitId) continue
      const r = mutateArchive({ op: 'copyToSession', vaultScope: 'global', rootSessionId: sid, id: hitId }, globalOpt)
      if (r && r.ok) {
        changed = true
        executed.push(`全局调入本局 #${hitId}`)
      }
    } else if (op === 'move_folder' && opItem.folder) {
      if (scope === 'session' && !sid) continue
      const targetOpt = scope === 'global' ? globalOpt : sessionOpt
      const hitId = resolveItemInScope(scope, opItem.id || opItem.archiveId, opItem.title)
      if (!hitId) continue
      const r = mutateArchive({ op: 'moveFolder', vaultScope: scope, rootSessionId: sid, id: hitId, folder: opItem.folder }, targetOpt)
      if (r && r.ok) {
        changed = true
        executed.push(`移动档案分类 → ${opItem.folder}`)
      }
    } else if (op === 'delete' || op === 'remove') {
      if (scope === 'session' && !sid) continue
      const targetOpt = scope === 'global' ? globalOpt : sessionOpt
      const hitId = resolveItemInScope(scope, opItem.id || opItem.archiveId, opItem.title)
      if (!hitId) continue
      const r = mutateArchive({ op: 'delete', vaultScope: scope, rootSessionId: sid, id: hitId }, targetOpt)
      if (r && r.ok) {
        changed = true
        executed.push(`移除${scope === 'global' ? '全局' : '本局'}档案 #${hitId}`)
      }
    }
  }

  return { executed, changed }
}

function optsTakeOutAllowed(ctx) {
  return Boolean(ctx && ctx.allowPinToDesktop !== false)
}

/** Execute Wishing-Box `networkOps` to link or unlink standalone DSH sessions. */
function applyNetworkOps(rootId, networkOps, directory) {
  const executed = []
  if (!Array.isArray(networkOps) || !networkOps.length || !rootId || rootId === 'global') return executed
  const otherSessions = (directory && Array.isArray(directory.otherSessions)) ? directory.otherSessions : []

  for (const opItem of networkOps.slice(0, 6)) {
    if (!opItem || typeof opItem !== 'object') continue
    const op = String(opItem.op || '').trim()
    if (op !== 'link' && op !== 'unlink') continue
    const rawQ = String(opItem.targetSessionId || opItem.target || opItem.sessionId || opItem.name || '').trim()
    if (!rawQ) continue
    const qLower = rawQ.toLowerCase()
    const match = otherSessions.find(s =>
      s.id === rawQ
      || String(s.id).toLowerCase().includes(qLower)
      || (s.name && String(s.name).toLowerCase().includes(qLower))
    )
    const targetSid = match ? match.id : (/^session-/i.test(rawQ) ? rawQ : '')
    if (!targetSid || targetSid === rootId) continue
    const r = setPeerLink(rootId, targetSid, op === 'link')
    if (r && r.ok) {
      executed.push(`${op === 'link' ? '连接协同窗口' : '断开协同窗口'}：${match ? match.name : targetSid.slice(0, 14)}`)
    }
  }
  return executed
}

/** Detect pure beginner progress/status questions where all truth is already in live snapshot + board (zero disk/shell tools needed). */
function isPureStatusInquiry(rawText) {
  const q = String(rawText || '').trim()
  if (!q || q.length > 90) return false
  if (/read_file|write_file|edit_file|run_command|list_dir|search_files|执行|运行|测试|跑一下|改一下|写一个|修一下|删除|新建|创建|安装|部署|派发|递话|转告|中断|清[空理]|重设|重置|提炼|浓缩|合并/.test(q)) {
    return false
  }
  return /(?:现在在做什么|在做什么|在干嘛|在干什么|处于什么步骤|什么步骤|第几步|到哪一步|到哪了|做到哪|进度|进展|情况如何|怎么样了|当前状态|实时状态|团队在|主对话在|主代理在|子代理在)/.test(q)
}

/** Detect explicit user requests asking Chief to immediately compress/compact context. */
export function isExplicitCompactCommand(rawText) {
  const q = String(rawText || '').trim()
  if (!q || q.length > 80) return false
  if (/不要压缩|别压缩|不用压缩|停止压缩|关闭压缩|取消压缩|为什么|为啥|没触发|未触发|不能|无法|报错|失败|是什么|原理|区别|开关|怎么(?:设置|用|开|关)/.test(q)) {
    return false
  }
  if (/^\/compact(?:\s|$)/i.test(q)) return true
  if (!/压缩/.test(q)) return false
  if (/文件|图片|视频|音频|zip|tar|gzip|rar|7z|打包/i.test(q) && !/上下文|对话|会话|历史|记忆|session|context/i.test(q)) {
    return false
  }
  return /^(?:请|麻烦|帮我|给我|你|可以|先|赶紧|立即|立刻|马上|现在|把[\u4e00-\u9fa5]{0,12})*(?:执行|触发|做一下|跑一下|开始|进行|归档并|抢救并)?(?:一键|手动|静默)?(?:当前|一下|下)?(?:上下文|对话|会话|历史|内容|内存)?压缩(?:当前|一下|下)?(?:上下文|对话|会话|历史|内存)?(?:吧|一下|下|呀|啊|哦|嘛|呢|好了|好吗|可以吗|！|!|。|\.)*$/i.test(q)
}

/**
 * Holistic offline/fallback intelligence synthesizer so DSH Chief NEVER
 * utters "记忆里没有这条" even if every configured LLM provider is unreachable.
 */
function buildSmartFallbackReply({ input, board, liveDigest, directory, facts = [], mailbox = [], conciseBrief = false }) {
  const q = String(input || '').trim()
  const qLower = q.toLowerCase()
  const tasks = Array.isArray(board && board.tasks) ? board.tasks : []
  const planSteps = Array.isArray(board && board.plan) ? board.plan.filter(Boolean) : []
  const openPlan = planSteps.filter(s => !s.done)
  const donePlan = planSteps.filter(s => s.done)
  const doing = tasks.filter(t => t.status === 'doing')
  const blocked = tasks.filter(t => t.status === 'blocked')
  const todo = tasks.filter(t => t.status === 'todo')
  const done = tasks.filter(t => t.status === 'done')
  const cursor = (board && board.cursor) || {}
  const bounds = (board && board.bounds) || { allowed: [], forbidden: [], notes: [] }
  const pinnedBounds = (board && board.pinnedBounds) || { allowed: [], forbidden: [], notes: [] }
  const workers = ((directory && directory.targets) || []).filter(t => t.kind === 'subagent')
  const runningWorkers = workers.filter(w => w.status === 'running')
  const liveEntries = (liveDigest && liveDigest.entries) || []
  const leadLive = liveEntries.find(e => e.kind === 'lead') || liveEntries[0] || null
  const cleanMem = (Array.isArray(board && board.memory) ? board.memory : [])
    .filter(m => m && !isInternalCheckpointNoise(m.title || m.text))

  if (conciseBrief) {
    return buildConciseSixLineReport({ board, blocked, doing, todo, done, workers })
  }

  const asksBounds = /边界|红线|禁止|允许|必做|规矩|约束/.test(q)
  const asksTeam = /子代理|团队|谁在|分工|成员|subagent|worker/i.test(qLower)
  const asksBlocked = /卡在哪|受阻|阻塞|报错|问题|风险|撞墙|block/i.test(qLower)
  const asksProgress = /进展|进度|怎么样|到哪|在做什么|在干嘛|干什么|处于什么步骤|什么步骤|第几步|情况|状态|汇报|总结|下一步|status|progress/i.test(qLower)

  const bullets = []

  if (asksBounds) {
    const fList = bounds.forbidden || []
    const aList = bounds.allowed || []
    const nList = bounds.notes || []
    const pinCount = (pinnedBounds.forbidden?.length || 0) + (pinnedBounds.allowed?.length || 0) + (pinnedBounds.notes?.length || 0)
    bullets.push(`- 【生效边界概览】共 ${fList.length + aList.length + nList.length} 条生效（其中 📌 定住全局共享 ${pinCount} 条）。`)
    if (fList.length) bullets.push(`- 【禁止红线】${fList.slice(0, 5).map(x => (pinnedBounds.forbidden?.includes(x) ? '📌' : '') + clamp(x, 60)).join('；')}`)
    if (aList.length) bullets.push(`- 【必做事项】${aList.slice(0, 4).map(x => (pinnedBounds.allowed?.includes(x) ? '📌' : '') + clamp(x, 60)).join('；')}`)
    if (nList.length) bullets.push(`- 【注意事项】${nList.slice(0, 3).map(x => (pinnedBounds.notes?.includes(x) ? '📌' : '') + clamp(x, 60)).join('；')}`)
    if (!fList.length && !aList.length && !nList.length) {
      bullets.push('- 【提示】当前尚未配置边界规则，可在「边界」页添加并点击 📌 定住为跨任务共享，或点「✦ 提炼新边界」。')
    }
    return bullets.join('\n')
  }

  if (asksTeam && !asksProgress) {
    bullets.push(`- 【团队编制】${workers.length ? summarizeSubagentsCompact(workers) : '当前仅主代理（@lead）单线作业，尚未派生子代理。'}`)
    for (const w of runningWorkers.slice(0, 5)) {
      bullets.push(`- 【运行中 · @${shortAgentBriefName(w.handle)}】${w.taskTitle ? clamp(w.taskTitle, 80) : '正在执行委派任务'}`)
    }
    for (const e of liveEntries.filter(x => x.kind !== 'lead').slice(0, 3)) {
      if (e.lastAssistant || e.recentTools.length) {
        bullets.push(`- 【@${shortAgentBriefName(e.handle)} 现场】${e.recentTools.length ? '调用 ' + e.recentTools.join(' → ') + '；' : ''}${clamp(e.lastAssistant, 100)}`)
      }
    }
    return bullets.join('\n')
  }

  // Keyword match across tasks, facts, notes, live stream, and memory if user asked a specific domain question
  if (!asksProgress && !asksBlocked) {
    const tokens = qLower
      .replace(/[？?！!。，,、：:“”"'()（）[\]【】]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 2 && !/^(现在|目前|什么|怎么|请问|帮我|一下|看看|告诉)$/.test(t))

    const hits = []
    for (const t of tasks) {
      const hay = `${t.title} ${t.note || ''} ${t.evidence || ''}`.toLowerCase()
      if (tokens.some(tk => hay.includes(tk))) {
        hits.push(`- 【任务 #${t.id} · ${t.status}】${clamp(t.title, 65)}${t.evidence ? '（证据：' + clamp(t.evidence, 70) + '）' : t.note ? '（' + clamp(t.note, 70) + '）' : ''}`)
      }
    }
    for (const f of facts) {
      if (tokens.some(tk => String(f.text || '').toLowerCase().includes(tk))) {
        hits.push(`- 【持久记录】${clamp(f.text, 120)}`)
      }
    }
    for (const m of cleanMem.slice(-15)) {
      const txt = stripCheckpointNoise(m.title || m.text)
      if (tokens.some(tk => txt.toLowerCase().includes(tk))) {
        hits.push(`- 【近期回合】${clamp(txt, 120)}`)
      }
    }
    if (hits.length > 0) {
      return hits.slice(0, 6).join('\n')
    }
  }

  // Comprehensive Live Situation & Progress Briefing (default + asksProgress + asksBlocked)
  if (board && board.objective) {
    bullets.push(`- 【核心目标】${clamp(board.objective, 130)}`)
  }
  if (cursor.step || cursor.next || cursor.blocked) {
    const curParts = []
    if (cursor.step) curParts.push(`正在推进「${clamp(cursor.step, 70)}」`)
    if (cursor.blocked) curParts.push(`卡点：${clamp(cursor.blocked, 80)}`)
    if (cursor.next) curParts.push(`下一步：${clamp(cursor.next, 80)}`)
    bullets.push(`- 【实时断点】${curParts.join('；')}`)
  }
  if (planSteps.length > 0) {
    bullets.push(`- 【小任务板 (${donePlan.length}/${planSteps.length})】${openPlan.length ? '当前待推进：' + clamp(openPlan[0].text, 90) : '全部步骤已勾选完成'}${donePlan.length ? '（最近已完成：' + clamp(donePlan[donePlan.length - 1].text, 55) + '）' : ''}`)
  }
  if (tasks.length > 0) {
    bullets.push(`- 【任务盘点】共 ${tasks.length} 项：🟢推进中 ${doing.length} · 🔴受阻 ${blocked.length} · ⏳待办 ${todo.length} · ✅已完成 ${done.length}`)
    for (const b of blocked.slice(0, 3)) {
      bullets.push(`- 【🔴 受阻卡点】#${b.id} ${clamp(b.title, 64)}${b.note ? ' — ' + clamp(b.note, 85) : ''}`)
    }
    for (const d of doing.slice(0, 3)) {
      const ownerTag = d.subagent || d.owner ? `（@${shortAgentBriefName(d.subagent || d.owner)}）` : ''
      bullets.push(`- 【🟢 正在推进】#${d.id} ${clamp(d.title, 68)}${ownerTag}${d.note ? '：' + clamp(d.note, 65) : ''}`)
    }
    if (!doing.length && !blocked.length && done.length > 0) {
      const lastDone = done[done.length - 1]
      bullets.push(`- 【最近完工】#${lastDone.id} ${clamp(lastDone.title, 68)}${lastDone.evidence ? '（' + clamp(lastDone.evidence, 80) + '）' : ''}`)
    }
  }
  if (runningWorkers.length > 0) {
    bullets.push(`- 【活跃子代理】${runningWorkers.length} 名正在运行：${runningWorkers.slice(0, 4).map(w => '@' + shortAgentBriefName(w.handle) + (w.taskTitle ? '（' + clamp(w.taskTitle, 32) + '）' : '')).join('、')}`)
  }
  if (leadLive && (leadLive.lastAssistant || leadLive.recentTools.length || leadLive.lastUser)) {
    const toolStr = leadLive.recentTools.length ? `刚执行 ${leadLive.recentTools.slice(-3).join(' → ')}；` : ''
    const msgStr = leadLive.lastAssistant
      ? clamp(leadLive.lastAssistant, 140)
      : (leadLive.lastUser ? `收到指令「${clamp(leadLive.lastUser, 90)}」` : '')
    bullets.push(`- 【主对话现场 (${leadLive.status === 'running' ? '运行中' : '就绪'})】${toolStr}${msgStr}`)
  } else if (cleanMem.length > 0) {
    const latest = stripCheckpointNoise(cleanMem[cleanMem.length - 1].title || cleanMem[cleanMem.length - 1].text)
    if (latest) bullets.push(`- 【最新回合结论】${clamp(latest, 140)}`)
  }
  if (mailbox.length > 0) {
    const lastMail = mailbox[mailbox.length - 1]
    if (lastMail && lastMail.text) {
      bullets.push(`- 【最新协同通信】${lastMail.from || '成员'} → @${lastMail.to || 'lead'}：${clamp(lastMail.text, 90)}`)
    }
  }

  // Tactical next-step suggestion
  if (blocked.length > 0) {
    bullets.push(`- 【参谋建议】当前有 ${blocked.length} 项任务受阻，建议优先排障 #${blocked[0].id}，或让我直接向主代理/对应子代理插话调整方案。`)
  } else if (doing.length > 0 || runningWorkers.length > 0) {
    bullets.push('- 【参谋建议】主线正在推进中；如需纠偏方向或补充约束，可直接告诉我「让 @某成员 注意……」，我立即替你插话传达。')
  } else if (openPlan.length > 0) {
    bullets.push(`- 【参谋建议】小任务板下一待办步骤为「${clamp(openPlan[0].text, 55)}」，可直接确认执行或让我转告主对话继续。`)
  } else if (todo.length > 0) {
    bullets.push(`- 【参谋建议】当前无运行中代理，尚有 ${todo.length} 项待办（首项：#${todo[0].id} ${clamp(todo[0].title, 40)}），可吩咐主对话继续推进。`)
  } else if (!bullets.length) {
    bullets.push('- 【当前态势】本会话尚未开始任务或记录目标；你可以直接在主对话下达任务，或在下方让我替你立目标、定边界、派分工。')
  }

  return bullets.join('\n')
}

function deterministicConsolidateClauses(items) {
  const seen = new Set()
  const clauses = []
  for (const raw of items) {
    const parts = String(raw || '')
      .split(/[；;。\n]+/)
      .map(s => s.replace(/^[•·\-*\d.)\s📌]+/, '').trim())
      .filter(Boolean)
    for (const p of parts) {
      const norm = p.toLowerCase().replace(/\s+/g, '')
      if (!norm || seen.has(norm)) continue
      if ([...seen].some(existing => existing.includes(norm) || (norm.length > 6 && norm.includes(existing)))) {
        if (norm.length > 6) {
          for (const ex of [...seen]) {
            if (norm.includes(ex) && norm !== ex) {
              const idx = clauses.findIndex(c => c.toLowerCase().replace(/\s+/g, '') === ex)
              if (idx !== -1) {
                clauses[idx] = p
                seen.delete(ex)
                seen.add(norm)
              }
            }
          }
        }
        continue
      }
      seen.add(norm)
      clauses.push(p)
    }
  }
  return clamp(clauses.join('；'), 220)
}

/**
 * Consolidate multiple scattered/overlapping boundary rules into ONE concise master rule,
 * creating a pending Prime Minister approval card (`replaces: sourceItems`) so the user
 * can approve & optionally pin it globally (`📌 定住全局`).
 */
export async function consolidateBoundsWithChief(deps, {
  sessionId = '',
  field = '',
  items = [],
  instruction = '',
} = {}) {
  const rootId = (deps.resolveRootSessionId && deps.resolveRootSessionId(sessionId)) || String(sessionId || 'global')
  const board = deps.boardForSession && deps.boardFileFor
    ? deps.boardForSession(deps.boardFileFor(rootId))
    : { bounds: { allowed: [], forbidden: [], notes: [] }, pinnedBounds: { allowed: [], forbidden: [], notes: [] } }
  const bounds = (board && board.bounds) || { allowed: [], forbidden: [], notes: [] }
  const pinnedBounds = (board && board.pinnedBounds) || { allowed: [], forbidden: [], notes: [] }
  const BOUND_COL_LABEL = { forbidden: '禁止红线', allowed: '必做事项', notes: '注意事项' }

  // Determine which column(s) to consolidate
  const targetCols = []
  const explicitItems = Array.isArray(items)
    ? items.map(x => String(x || '').trim()).filter(Boolean)
    : []

  const normField = String(field || '').trim().toLowerCase() === 'must' ? 'allowed' : field
  if (['forbidden', 'allowed', 'notes'].includes(normField)) {
    const colList = Array.isArray(bounds[normField]) ? bounds[normField] : []
    const chosen = explicitItems.length >= 2
      ? colList.filter(x => explicitItems.includes(x))
      : colList
    if (chosen.length < 2) {
      return { ok: false, error: `【${BOUND_COL_LABEL[normField]}】当前不足 2 条规则，无需浓缩合并。` }
    }
    targetCols.push({ col: normField, sourceItems: chosen })
  } else if (explicitItems.length >= 2) {
    // Infer column with most matches, default forbidden
    let bestCol = 'forbidden'
    let bestHits = -1
    for (const c of ['forbidden', 'allowed', 'notes']) {
      const hits = (bounds[c] || []).filter(x => explicitItems.includes(x)).length
      if (hits > bestHits) {
        bestHits = hits
        bestCol = c
      }
    }
    targetCols.push({ col: bestCol, sourceItems: explicitItems })
  } else {
    for (const c of ['forbidden', 'allowed', 'notes']) {
      const colList = Array.isArray(bounds[c]) ? bounds[c] : []
      if (colList.length >= 2) {
        targetCols.push({ col: c, sourceItems: colList })
      }
    }
    if (!targetCols.length) {
      return { ok: false, error: '当前各边界分栏均不足 2 条零散规则，暂时无需合并。' }
    }
  }

  const consWorkId = beginChiefActiveWork(rootId, {
    tone: 'bounds',
    tab: 'boundaries',
    boundSubTab: 'rules',
    label: '参谋长正在浓缩边界中...',
  })
  try {
    const createdProposals = []
    for (const { col, sourceItems } of targetCols) {
      const colLabel = BOUND_COL_LABEL[col] || '禁止红线'
      const hadPinned = sourceItems.some(x => (pinnedBounds[col] || []).includes(x))
      const prompt = [
        `目标边界分栏：【${colLabel}】（${col}）`,
        instruction ? `用户额外要求：${clamp(instruction, 200)}` : '',
        `待浓缩合并的 ${sourceItems.length} 条零散边界：`,
        ...sourceItems.map((it, idx) => `${idx + 1}. ${(pinnedBounds[col] || []).includes(it) ? '[📌全局定住] ' : ''}${it}`),
        '',
        '请将以上零散规则浓缩合并为唯一 1 条高密度总则（保留具体命令、路径与硬红线），只输出 JSON：',
      ].filter(Boolean).join('\n')

      const llmRes = await callChiefLlm(deps, {
        sessionId: rootId,
        system: CONSOLIDATE_BOUNDS_SYSTEM,
        prompt,
        maxTokens: SUMMARY_MAX_TOKENS,
      })

      const parsed = llmRes.ok ? extractJsonObject(llmRes.text) : null
      const mergedText = clamp(
        (parsed && (parsed.item || parsed.draftText || parsed.text)) || deterministicConsolidateClauses(sourceItems),
        220,
      )
      const mergedReason = clamp(
        (parsed && parsed.reason) || `已将【${colLabel}】下 ${sourceItems.length} 条零散边界浓缩合成为 1 条总则，批准后自动替换原零散条目。`,
        180,
      )

      if (!mergedText || secretLike(mergedText)) continue

      mutateChiefState((s) => {
        const ws = ensureWorkspace(s, rootId)
        // Dismiss older pending consolidation proposals for the exact same column to avoid clutter
        for (const existing of ws.suggestions) {
          if (existing.status === 'pending' && existing.kind === 'bound' && existing.boundField === col && Array.isArray(existing.replaces) && existing.replaces.length > 0) {
            existing.status = 'dismissed'
          }
        }
        const sug = normalizeSuggestion({
          kind: 'bound',
          boundField: col,
          fromAgent: '✦ 参谋长浓缩',
          title: `${colLabel} ${sourceItems.length} 合 1：${clamp(mergedText, 26)}`,
          reason: mergedReason,
          target: 'bounds',
          targetLabel: colLabel,
          mode: 'silent',
          draftText: mergedText,
          replaces: sourceItems,
          pinGlobal: hadPinned,
        })
        if (sug) {
          ws.suggestions.push(sug)
          createdProposals.push(sug)
        }
      })
    }

    if (!createdProposals.length) {
      return { ok: false, error: '未能生成浓缩边界，请稍后重试。' }
    }

    const replyLines = createdProposals.map(p =>
      `- 【${p.targetLabel} · ${p.replaces.length} 合 1】${p.draftText}（可在上方请示卡片选「📌 定住全局」或「仅本任务」一键替换）`,
    )

    return {
      ok: true,
      proposals: createdProposals,
      reply: replyLines.join('\n'),
      view: await getChiefView(deps, rootId, { autoSummarize: false }),
    }
  } finally {
    endChiefActiveWork(rootId, consWorkId)
  }
}

export async function askOrCommandChief(deps, {
  sessionId = '',
  text = '',
  forcedTarget = '',
  forcedMode = 'steer',
  quickAction = '',
  images = [],
  _resumeCtx = null,
  _fromLeadRequest = false,
  _wallBlockerEscalation = false,
}) {
  const rawInput = cleanMultiline(text, 2000)
  const rawImages = Array.isArray(images) ? images : []
  if (!rawInput && !rawImages.length) {
    return { ok: false, error: '请输入要询问或吩咐参谋长的内容或上传图片' }
  }

  const rootId = deps.resolveRootSessionId(sessionId) || String(sessionId || 'global')
  const resumeTaskId = _resumeCtx && typeof _resumeCtx.resumeTaskId === 'string' ? _resumeCtx.resumeTaskId : ''
  const resumeDepth = _resumeCtx && Number.isFinite(_resumeCtx.resumeDepth) ? Number(_resumeCtx.resumeDepth) : 0
  const isResumeTurn = Boolean(resumeTaskId)
  const canAttachResume = resumeDepth < 2

  const savedImagePaths = rawImages.length > 0
    ? persistChiefImagesToWorkspace(deps, rootId, rawImages)
    : (_resumeCtx && Array.isArray(_resumeCtx.savedImagePaths) ? _resumeCtx.savedImagePaths : [])
  let imageBlocks = []
  if (rawImages.length > 0) {
    try {
      imageBlocks = await admitChiefImages(deps, rawImages)
    } catch (err) {
      if (!savedImagePaths.length) {
        return { ok: false, error: String(err && err.message ? err.message : err) }
      }
      imageBlocks = []
    }
  }

  const effectiveImgCount = Math.max(imageBlocks.length, savedImagePaths.length)
  const input = rawInput || '请结合我上传的图片进行分析处理。'
  const userDisplayText = rawInput || `[上传图片 ×${effectiveImgCount}]`
  const imgMeta = effectiveImgCount > 0 ? { imageCount: effectiveImgCount } : {}

  const directory = await listPeerDirectory(deps, rootId)
  const board = deps.boardForSession(deps.boardFileFor(rootId))
  const state = loadChiefState()
  const effCfg = resolveWorkspaceConfig(state, rootId)
  const policyPlugins = Array.isArray(effCfg.policyPlugins) ? effCfg.policyPlugins : []
  const ownWs = ensureWorkspace(state, rootId)
  const hasChiefRiskAck = hasValidChiefRiskAck(ownWs)
  const permissionMode = normalizePermissionMode(effCfg.permissionMode || DEFAULT_CHIEF_PERMISSION_MODE, {
    requireAck: true,
    hasChiefRiskAck,
  })
  const permRank = permissionRank(permissionMode)
  const isConciseBrief = Boolean(effCfg.tacticalModes && effCfg.tacticalModes.conciseBrief)
  const view = clusterView(state, rootId)
  const targetOpt = archiveTargetForRoot(deps, rootId)
  const peerProgress = Array.isArray(directory.cluster) && directory.cluster.length > 1
    ? collectClusterPeerProgress(deps, directory.cluster, rootId)
    : []

  const persistTurnChatAndResume = (ws, {
    chiefText,
    actions = [],
    elevationObj = null,
    pendingApprovalList = [],
    target = '',
    forceReceipt = false,
    thinkingEffort = '',
    thinkingEffortMode = '',
  }) => {
    const cleanActions = Array.isArray(actions) ? actions.filter(Boolean) : []
    const isReceipt = Boolean(isResumeTurn || _fromLeadRequest || forceReceipt || elevationObj || pendingApprovalList.length > 0 || cleanActions.length > 0)
    const finalActions = isResumeTurn
      ? [...new Set(['⚡ 授权自动续跑', ...cleanActions])].slice(0, 8)
      : cleanActions.slice(0, 8)
    if (!isResumeTurn && !_fromLeadRequest) {
      ws.chat.push({
        id: nextId('chat'),
        role: 'user',
        text: userDisplayText,
        ...(target ? { target } : {}),
        ...imgMeta,
        actions: [],
        at: Date.now(),
      })
    }
    let attachedTaskId = resumeTaskId
    if (canAttachResume && (elevationObj || pendingApprovalList.length > 0)) {
      const aprIds = pendingApprovalList.map(a => a && a.id).filter(Boolean)
      const primaryApr = pendingApprovalList.find(Boolean) || null
      const task = upsertTaskLedgerOnWs(ws, {
        ...(resumeTaskId ? { id: resumeTaskId, taskId: resumeTaskId } : {}),
        kind: aprIds.length > 0 ? 'approval_resume' : 'elevation_resume',
        status: aprIds.length > 0 ? 'awaiting_approval' : 'awaiting_elevation',
        capabilityScope: primaryApr && primaryApr.capabilityScope ? primaryApr.capabilityScope : null,
        payloadHash: primaryApr && primaryApr.payloadHash ? primaryApr.payloadHash : '',
        resumeSpec: {
          originalText: input,
          forcedTarget,
          forcedMode,
          savedImagePaths,
        },
        originalText: input,
        forcedTarget,
        forcedMode,
        savedImagePaths,
        retryCount: resumeDepth,
        resumeDepth,
        elevationId: elevationObj ? elevationObj.id : '',
        pendingApprovalIds: aprIds,
        ...(_resumeCtx && _resumeCtx.executedSummary ? { appendCompletedAction: _resumeCtx.executedSummary } : {}),
      })
      if (task) {
        attachedTaskId = task.id
        if (elevationObj) {
          elevationObj.taskId = task.id
          elevationObj.resumeTaskId = task.id
          if (task.expiresAt) elevationObj.expiresAt = task.expiresAt
          if (ws.pendingElevation && ws.pendingElevation.id === elevationObj.id) {
            ws.pendingElevation.taskId = task.id
            ws.pendingElevation.resumeTaskId = task.id
            if (task.expiresAt) ws.pendingElevation.expiresAt = task.expiresAt
          }
        }
        if (aprIds.length > 0) {
          const idSet = new Set(aprIds)
          for (const listRef of [pendingApprovalList, ws.pendingApprovals]) {
            if (!Array.isArray(listRef)) continue
            for (const apr of listRef) {
              if (apr && idSet.has(apr.id)) {
                apr.taskId = task.id
                apr.resumeTaskId = task.id
                if (task.expiresAt && !apr.expiresAt) apr.expiresAt = task.expiresAt
              }
            }
          }
        }
      }
    }
    ws.chat.push({
      id: nextId('chat'),
      role: 'chief',
      kind: isReceipt ? 'receipt' : 'qa',
      ...(attachedTaskId ? { resumeTaskId: attachedTaskId } : {}),
      ...(thinkingEffort ? { thinkingEffort } : {}),
      ...(thinkingEffortMode ? { thinkingEffortMode } : {}),
      text: chiefText,
      actions: finalActions,
      at: Date.now(),
    })
    if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
    return attachedTaskId
  }

  const denyChiefSystemInAdvisor = async (opName, reasonText) => {
    const elev = requestChiefElevation(rootId, {
      fromMode: permissionMode,
      targetMode: 'assistant',
      reason: reasonText,
      requestedActionSummary: clamp(input, 160),
      by: 'chief',
    })
    appendChiefAuditLog(rootId, {
      mode: permissionMode,
      stage: 'permission_gate',
      decision: 'deny_mode',
      operation: opName,
      target: 'chief_system',
      reason: reasonText,
      outcome: 'denied',
      by: 'chief',
    })
    const denyReply = `- 【🔒 权限受限（当前 L0 顾问只读）】${reasonText}\n- 【🔐 已发起提权请示】请点击顶部「🔐 同意提权至 L1 · 助手模式」弹窗后再执行参谋系统维护。`
    mutateChiefState((s) => {
      const ws = ensureWorkspace(s, rootId)
      persistTurnChatAndResume(ws, {
        chiefText: denyReply,
        actions: ['🔒 L0 顾问只读', ...(elev ? ['🔐 请示提权 L1'] : [])],
        elevationObj: elev,
        forceReceipt: true,
      })
    })
    return {
      ok: true,
      deniedByMode: true,
      elevationRequested: elev,
      reply: denyReply,
      relays: [],
      memoryChanges: [],
      boardOps: [],
      actionBadges: ['🔒 L0 顾问只读', ...(elev ? ['🔐 请示提权 L1'] : [])],
      view: await getChiefView(deps, rootId, { autoSummarize: false }),
    }
  }

  // Fast path: if user explicitly picked a concrete target pill AND used direct relay mode without asking chief to decompose
  if (forcedTarget && forcedTarget !== 'auto') {
    const delivery = await deliverCrossMessage(deps, {
      fromSession: rootId,
      fromLabel: '用户 (经 DSH 参谋长)',
      target: forcedTarget,
      text: rawInput || '请查看随信附带的图片与落盘路径。',
      mode: ['steer', 'followup', 'silent'].includes(forcedMode) ? forcedMode : 'steer',
      imageBlocks,
      savedImagePaths,
    })
    const reply = delivery.ok
      ? `已按你的指定向 ${delivery.target || forcedTarget} ${forcedMode === 'steer' ? '插话' : forcedMode === 'silent' ? '投递备忘纸条' : '递话'}${effectiveImgCount ? `（附带 ${effectiveImgCount} 张图片，原图已落盘）` : ''}${delivery.note ? '（' + delivery.note + '）' : '。'}`
      : `投递失败：${delivery.error}`

    mutateChiefState((s) => {
      const ws = ensureWorkspace(s, rootId)
      persistTurnChatAndResume(ws, {
        chiefText: reply,
        target: forcedTarget,
        actions: [delivery.ok ? `→ ${delivery.target || forcedTarget}` : '投递失败'],
        forceReceipt: true,
      })
    })

    return {
      ok: delivery.ok,
      reply,
      relays: [delivery],
      savedImagePaths,
      memoryChanges: [],
      boardOps: [],
      view: await getChiefView(deps, rootId, { autoSummarize: false, chatTriggered: !_fromLeadRequest }),
    }
  }

  // Direct natural-language command to organize/curate the Engineering Archive Cabinet (`整理档案` / `收纳档案`)
  if (!forcedTarget || forcedTarget === 'auto') {
    if (/(?:档案|卷宗|老笔记)/.test(input) && /(?:整理|收纳|归类|分拣|拆解)/.test(input)) {
      if (permRank < 1) {
        return denyChiefSystemInAdvisor('整理参谋档案', '整理与归类档案库属于「参谋系统维护」操作，需「L1 · 助手模式」及以上权限。')
      }
      const orgScope = /全局/.test(input) ? 'global' : 'session'
      const orgRes = await organizeArchivesWithChief(deps, {
        sessionId: rootId,
        vaultScope: orgScope,
        scope: /全部|所有|全柜/.test(input) ? 'all' : 'unorganized',
        instruction: input,
      })
      if (orgRes.ok) {
        appendChiefAuditLog(rootId, {
          mode: permissionMode,
          stage: 'executor',
          decision: 'executed',
          operation: '整理参谋档案',
          target: orgScope,
          reason: clamp(input, 120),
          outcome: 'ok',
          by: 'chief',
        })
        if (isResumeTurn) {
          mutateChiefState((s) => {
            const ws = ensureWorkspace(s, rootId)
            persistTurnChatAndResume(ws, {
              chiefText: orgRes.reply,
              actions: [`收纳档案 ${orgRes.updatedCount} 卷`],
              forceReceipt: true,
            })
          })
        }
        return {
          ok: true,
          reply: orgRes.reply,
          relays: [],
          memoryChanges: [],
          boardOps: [`收纳档案 ${orgRes.updatedCount} 卷`],
          archives: orgRes.archives,
          view: orgRes.view,
        }
      }
    }
  }

  // 0-Token Precipitated Vault Contract: ONLY read precipitated vault if this session EXPLICITLY flipped entries out!
  const flippedIds = Array.isArray(ownWs.flippedPrecipitatedIds) ? ownWs.flippedPrecipitatedIds : []
  const flippedVaultLines = []
  if (flippedIds.length > 0) {
    const projectKey = resolveProjectKey(targetOpt.cwd)
    const flippedItems = getFlippedOutPrecipitatedForSession(projectKey, rootId, true, targetOpt)
    if (flippedItems.length > 0) {
      flippedVaultLines.push('', '## 8. 本会话已显式翻出的跨会话沉淀经验（仅包含用户显式翻出授权的条目）')
      for (const entry of flippedItems) {
        flippedVaultLines.push(`- 🏛️ [沉淀/${entry.category}] 《${entry.title}》：${entry.summary}`)
        if (Array.isArray(entry.points) && entry.points.length > 0) {
          for (const pt of entry.points.slice(0, 4)) {
            flippedVaultLines.push(`    * ${pt.title}：${clamp(pt.detail || pt.cue, 200)}`)
          }
        } else if (entry.body) {
          flippedVaultLines.push(`    * 正文：${clamp(entry.body, 280)}`)
        }
      }
    }
  }

  // Watch session & hooked global archives in background (cold vault is 100% isolated from Chief & Lead!)
  const visibleArchives = collectChiefVisibleArchives(deps, rootId, state)
  const watchLines = []
  const fmtWatchTag = (label, it) => `[${label}${it.id ? ` | id=${it.id}` : ''}] 《${clamp(it.title, 36)}》：${clamp(it.summary || it.hookCue, 80)}`
  const watchEntries = [
    ...visibleArchives.deskSessionItems.map(it => fmtWatchTag('桌面·本局(主与参谋共阅)', it)),
    ...visibleArchives.deskGlobalItems.map(it => fmtWatchTag('桌面·全局(主与参谋共阅)', it)),
    ...visibleArchives.deskFlippedItems.map(it => fmtWatchTag('桌面·冷藏已翻牌(主与参谋共阅)', it)),
    ...visibleArchives.mountedGlobalItems.map(it => fmtWatchTag('全局已拉阅·主隐', it)),
    ...((visibleArchives.sessionItems || []).filter(it => !it.takenOut).slice(0, 8).map(it => `[本局档案·参谋随时可读${it.hasHook ? ' 🪝已织钩' : ' (未织钩)'} | id=${it.id}] 《${clamp(it.title, 36)}》：${clamp(it.summary, 70)}`)),
    ...((visibleArchives.recentlyUnpinnedWatch || []).slice(0, 4).map(w => `[刚撤下桌面·待观察归位 | id=${w.id}] 《${clamp(w.title, 36)}》`)),
    ...((visibleArchives.globalHookIndex || []).slice(0, 8).map(it => `[全局钩子·参谋见钩可拉(发 pull_global) | id=${it.id}] 《${clamp(it.title, 36)}》 🪝[${(it.hookKeywords || []).slice(0, 3).join('·')}] ${clamp(it.hookCue, 60)}`)),
  ]
  if (watchEntries.length > 0) {
    watchLines.push('', '## 9. 参谋长档案馆线索与认知桌面（冷库严密隔离；桌面主对话可见；全局仅暴露已织钩子）', ...watchEntries.map(x => '- ' + x))
  }

  // On-demand lazy archive lookup ONLY when the user explicitly asks Chief about archives (searches Session + Hooked Global Vault; unhooked Global/Cold blocked)
  const asksArchiveExplicitly = /(?:档案|卷宗|归档|以前|历史记录|工程坐标|老笔记|全局|查一下.*(?:怎么|路径|命令|配置))/.test(input)
  const onDemandArchiveLines = []
  if (asksArchiveExplicitly) {
    const sessionTarget = rootId && rootId !== 'global' ? archiveTargetForRoot(deps, rootId, { vaultScope: 'session' }) : null
    const globalTarget = archiveTargetForRoot(deps, rootId, { vaultScope: 'global' })
    const foundSess = sessionTarget ? searchArchives(input, { limit: 3, vaultScope: 'session' }, sessionTarget) : { ok: true, hits: [] }
    const foundGlobRaw = searchGlobalVaultForChief(input, { limit: 5 }, globalTarget)
    const pulledOrDeskGlobIds = new Set([
      ...(visibleArchives.mountedGlobalItems || []).map(x => x.id),
      ...(visibleArchives.deskGlobalItems || []).map(x => x.id),
    ])
    const foundGlobHits = (Array.isArray(foundGlobRaw.hits) ? foundGlobRaw.hits : []).filter(h => h && h.hasHook === true).slice(0, 3)
    const combinedHits = [
      ...(Array.isArray(foundSess.hits) ? foundSess.hits.map(h => ({ ...h, _scope: 'session', _scopeLabel: '本会话档案', _target: sessionTarget })) : []),
      ...foundGlobHits.map(h => ({ ...h, _scope: 'global', _scopeLabel: '系统全局档案(已织钩)', _target: globalTarget })),
    ]
    if (combinedHits.length > 0) {
      onDemandArchiveLines.push('', '## 7. 按需检索到的档案卷宗（仅本局与已织钩全局；未拉阅全局仅展示钩子）')
      for (let i = 0; i < combinedHits.length; i += 1) {
        const hit = combinedHits[i]
        if (hit._scope === 'global' && !pulledOrDeskGlobIds.has(hit.id)) {
          onDemandArchiveLines.push(`- 🪝 [全局钩子待拉阅/${hit.folderLabel} | id=${hit.id}] 《${hit.title}》 关键词=[${(hit.hookKeywords || []).join('·')}] ${clamp(hit.hookCue || hit.summary, 90)}（如需详情可输出 archiveOps pull_global）`)
          continue
        }
        onDemandArchiveLines.push(`- 📎 [${hit._scopeLabel}/${hit.folderLabel}] 《${hit.title}》：${hit.summary}`)
        if (i < 3) {
          const det = getArchiveDetail(hit.id, rootId, hit._target)
          if (det.ok && det.item && Array.isArray(det.item.points)) {
            for (const pt of det.item.points.slice(0, 4)) {
              onDemandArchiveLines.push(`    * ${pt.title}：${clamp(pt.detail || pt.cue, 180)}`)
            }
          }
        }
      }
    }
  }

  // Gather real-time conversation stream + cursor + dual-tier bounds + task breakdown
  const liveDigest = collectLiveConversationsDigest(deps, rootId, directory)
  const numberedFacts = view.facts.slice()
  const tasks = Array.isArray(board && board.tasks) ? board.tasks : []
  const doingTasks = tasks.filter(t => t.status === 'doing')
  const blockedTasks = tasks.filter(t => t.status === 'blocked')
  const todoTasks = tasks.filter(t => t.status === 'todo')
  const doneTasks = tasks.filter(t => t.status === 'done')
  const cursor = (board && board.cursor) || {}
  const pinnedBounds = (board && board.pinnedBounds) || { allowed: [], forbidden: [], notes: [] }
  const allBounds = (board && board.bounds) || { allowed: [], forbidden: [], notes: [] }
  const fmtBoundCol = (col) => {
    const list = allBounds[col] || []
    if (!list.length) return '（无）'
    const pinSet = new Set(pinnedBounds[col] || [])
    return list.map(x => `${pinSet.has(x) ? '📌[全局定住] ' : '[本任务] '}${x}`).join('；')
  }

  const meaningfulPeers = directory.targets.filter(
    t => t.kind === 'lead' || t.status === 'running' || !/^mnemon-review/i.test(String(t.name || t.handle || '')),
  )
  const hiddenIdleProbes = Math.max(0, directory.targets.length - meaningfulPeers.length)

  const promptLines = [
    '## 1. 当前可通信成员名录 (Peers)',
    ...(meaningfulPeers.length
      ? meaningfulPeers.slice(0, 16).map(t => `- key="${t.key}" | 名称="${t.handle}" | 类型=${t.kind} | 状态=${t.status}${t.taskTitle ? ' | 当前负责: ' + t.taskTitle : ''}`)
      : ['- key="lead" | 名称="主对话" | 类型=lead']),
    ...(hiddenIdleProbes > 0 ? [`（另有 ${hiddenIdleProbes} 个已空闲后台检查点探针已折叠）`] : []),
    ...((directory.otherSessions && directory.otherSessions.length > 0)
      ? [
          '',
          '## 1.5 本机其他独立会话窗口（可用许愿框 networkOps 连接 link / 断开 unlink）',
          ...directory.otherSessions.slice(0, 12).map(s => `- sessionId="${s.id}" | 名称="${s.name}" | 状态=${s.status} | 已互联=${s.linked ? '是' : '否'}${s.objective ? ' | 目标=' + clamp(s.objective, 50) : ''}`),
        ]
      : []),
    '',
    '## 2. 主对话与子代理【实时对话流现场快照】(Live Transcripts)',
    ...(liveDigest.summaryLines.length
      ? liveDigest.summaryLines
      : ['（当前暂无活跃对话流消息）']),
    '',
    '## 3. 参谋看板目标、断点游标与任务图态势',
    `- 总目标: ${board.objective || '（未设）'}`,
    `- 实时断点游标 (Cursor): 当前步骤="${cursor.step || '无'}" | 下一步="${cursor.next || '无'}" | 阻塞点="${cursor.blocked || '无'}"`,
    `- 计划步骤 (Plan): ${((board.plan || []).slice(0, 8).map(s => `${s.done ? '[✓]' : '[ ]'} ${clamp(s.text, 60)}`).join('；')) || '（无）'}`,
    `- 🔴 受阻任务 (${blockedTasks.length} 项): ${blockedTasks.slice(0, 6).map(t => `#${t.id} ${t.title}${t.owner ? '(@' + shortAgentBriefName(t.owner) + ')' : ''}${t.note ? ' [原因:' + clamp(t.note, 80) + ']' : ''}`).join('；') || '（无）'}`,
    `- 🔵 推进中任务 (${doingTasks.length} 项): ${doingTasks.slice(0, 6).map(t => `#${t.id} ${t.title}${t.owner ? '(@' + shortAgentBriefName(t.owner) + ')' : ''}${t.note ? ' [' + clamp(t.note, 60) + ']' : ''}`).join('；') || '（无）'}`,
    `- ⚪ 待办任务 (${todoTasks.length} 项): ${todoTasks.slice(0, 6).map(t => `#${t.id} ${t.title}${t.owner ? '(@' + shortAgentBriefName(t.owner) + ')' : ''}`).join('；') || '（无）'}`,
    `- ✅ 最近完成 (${doneTasks.length} 项): ${doneTasks.slice(-5).map(t => `#${t.id} ${t.title}${t.evidence ? ' [证据:' + clamp(t.evidence, 60) + ']' : ''}`).join('；') || '（无）'}`,
    '',
    '## 4. 当前生效边界（📌全局定住 vs 本任务）',
    `- 禁止红线 (forbidden): ${fmtBoundCol('forbidden')}`,
    `- 必做事项 (allowed): ${fmtBoundCol('allowed')}`,
    `- 注意事项 (notes): ${fmtBoundCol('notes')}`,
    '',
    '## 5. 编号持久记忆条目 (Facts)',
    ...(numberedFacts.length
      ? numberedFacts.map((f, idx) => `[${idx + 1}] (${f.category}) ${f.text}`)
      : ['（暂无条目）']),
    '',
    '## 6. 近期回合摘要与协同信箱参考',
    ...((board.memory || [])
      .filter(m => m && !isInternalCheckpointNoise(m.title || m.text))
      .slice(-6)
      .map(m => `- [回合/${m.section}] ${clamp(stripCheckpointNoise(m.title || m.text), 150)}`)),
    ...(peerProgress.length > 0
      ? [
          '',
          '## 6.5 当前互通协同网络邻居实时进度（已共享进度）',
          ...peerProgress.map(p => `- 🌐 [${p.title}] ${p.objective ? `目标="${p.objective}" | ` : ''}${p.progressSummary || '暂无板卡进度'}${p.cursorStep ? ` | 当前="${p.cursorStep}"` : ''}`),
        ]
      : []),
    ...(view.mailbox.slice(-4).map(m => `- [信箱 ${m.from} → @${m.to}] ${clamp(m.text, 120)}`)),
    ...onDemandArchiveLines,
    ...flippedVaultLines,
    ...watchLines,
    '',
    `## 参谋长执行权限与显示模式：permissionMode=${permissionMode}${isConciseBrief ? ' | 极简战报=开启' : ''}`,
    describeThreePartyBoundariesForPrompt(permissionMode),
    '## 用户刚刚对你说的话：',
    input,
    ...(_resumeCtx && _resumeCtx.resumeTaskId
      ? [
          '',
          `## ⚡ 系统授权恢复执行上下文（自动续跑事务 #${_resumeCtx.resumeTaskId}，当前权限：${permissionMode}）`,
          _resumeCtx.triggerKind === 'elevation'
            ? '- 用户已刚刚批准上述权限升级请求！现在请直接基于用户原始指令调用所需实权工具或动作继续完成任务、核验结果并输出总结回执（切勿只回复“收到”或重复申请刚才的提权）。'
            : `- 用户已逐项批准并执行完成上一步受控操作：\n${_resumeCtx.executedSummary || '（已执行完成）'}\n- **严禁重复调用刚才已执行完毕的同一写操作/终端命令**！请立即核验当前状态、继续执行用户原指令中尚未完成的后续步骤（若有），完成后输出清晰的结构化结项回执。`,
        ]
      : []),
    ...(savedImagePaths.length > 0
      ? [
          '',
          `🖼️ 用户随信上传了 ${savedImagePaths.length} 张原图（已真实落盘到工作区）：`,
          ...savedImagePaths.map(p => `- ${p.path}`),
          '（重要提示：若当前参谋长模型不支持视觉看图，请把任务与上述绝对路径直接调度/递话给支持看图或读文件工具的主对话 @lead / 子代理处理，严禁臆造图内细节！）',
        ]
      : []),
  ]

  const isBlankContext = liveDigest.summaryLines.length === 0 && !board.objective && !(board.plan || []).length
  const resolvedCwd = deps && typeof deps.getSessionCwd === 'function' ? deps.getSessionCwd(rootId) : ''
  const cwdForPromptWalls = resolveSessionWorkspaceCwd(deps, rootId) || resolvedCwd
  const activeDynamicWalls = listGuardWalls({ cwd: cwdForPromptWalls }).filter(w => w && w.scope !== 'paused')
  if (activeDynamicWalls.length > 0) {
    promptLines.push(
      '',
      '## 6.8 当前生效动态物理驻墙参考（仅作阻断排查，严禁私拆；仅代理撞墙无法绕过上报且确无法继续时才可请示审批）',
      ...activeDynamicWalls.slice(0, 8).map(w => `- [${w.id}] (${w.scope}/${w.ruleType}) ${w.title} :: ${Array.isArray(w.patterns) ? w.patterns.join(', ') : ''}`),
    )
  }
  const explicitCompactReq = !imageBlocks.length && isExplicitCompactCommand(input)
  const statusOnlyInquiry = !imageBlocks.length && !explicitCompactReq && quickAction !== 'consult_chief' && !_wallBlockerEscalation && isPureStatusInquiry(input)
  const userExplicitDirect = /(?:参谋长.*?(?:亲自|自己|直接|别找主)|你自己(?:动手|改|跑|查|写)|别派发|勿转主对话)/.test(input)
  const hasLiveLead = Boolean(
    deps
    && deps.runtime
    && typeof deps.runtime.get === 'function'
    && deps.runtime.get('agents')
    && typeof deps.runtime.get('agents').get === 'function'
    && deps.runtime.get('agents').get(rootId),
  )
  const lazyDeferWorkspaceWritesToLead = Boolean(
    !isResumeTurn
    && !_fromLeadRequest
    && !userExplicitDirect
    && hasLiveLead
    && permissionMode === 'chief',
  )

  const effectiveSystem = [
    ASK_CHIEF_SYSTEM,
    ...(isConciseBrief ? [CONCISE_BRIEF_ASK_EXTRA] : []),
    ...(quickAction === 'consult_chief' ? [CONSULT_CHIEF_EXTRA] : []),
    ...(_wallBlockerEscalation
      ? [
          '',
          '🧱 【当前正在评估主/子代理提交的“撞墙阻断上报”】：',
          '- 请严格核对代理是否真的撞到了上述动态物理驻墙，以及**是否真的没有任何合法替代途径继续完成任务**；',
          '- 若有替代做法（如改用只读核查、调整目标路径/命令或分步处理），**绝不申请拆墙**，直接在 `reply` 中给出合法绕行路径即可；',
          '- 只有确认确被某堵动态墙彻底卡死无法推进时，才可在 `"wallRemovalProposals"` 中提出针对该精确 `wallId` 的暂挂/拆墙申请单供人类逐项批示！',
        ]
      : []),
    ...(isBlankContext
      ? [
          '',
          '🌱 【当前处于空白新上下文（主对话尚未开聊 · 首轮勘探与计划立项策略）】：',
          resolvedCwd ? `- 当前已解析工作区根目录：${resolvedCwd}` : '',
          !userExplicitDirect
            ? '- 默认开场铁律：首轮优先通过 `"relays"`（`target: "lead"`, `mode: "followup"`）向主对话 @lead 下发开场执行请求，要求主对话：① 先只读勘探代码库与目录结构；② 调用 `chief_board({ action: "graph.plan" })` / 计划工具进入计划模式立项拆解；③ 得出明确结论后调用 `chief_board({ action: "chief.request", subject: "勘探与计划回报", text: "..." })` 回报给参谋长。若当前为 L0/L1 权限不足以投递工作流指令，请同时填写 `"elevationRequest": { "targetMode": "strategist", "reason": "空白新对话首轮需授权向主对话下发勘探与计划立项指令" }`，并将完整勘探请求放进 `"relays"` 或建议备妥（绝对禁止向用户输出 `<｜DSML｜calls>` 等原始工具标签）。'
            : '- 用户已明确点名由你亲自排查/处理工作区，请依据当前 `permissionMode` 调用真实 JSON `toolCalls` 工具（`list_dir` / `search_files` / `read_file` / `edit_file` / `run_command`）处理并如实汇报；绝对禁止向用户输出 `<｜DSML｜calls>` 等原始工具调用标签！',
          '- 若尚无主对话历史，除非用户明确命令且会话已存在，不要无故调用 `session_compact`。',
        ].filter(Boolean)
      : []),
    ...(statusOnlyInquiry
      ? [
          '',
          '⚡ 【当前问题属于「主对话/团队实时态势询问」快速通道】：',
          '- 严禁调用任何工具，严禁输出任何 XML/DSML 工具标签（如 `<｜DSML｜calls>`），严禁扫盘或运行 Shell！',
          '- 请直接根据上下文里已经给出的「实时对话流快照」「小任务板 (Plan)」「任务图」「断点游标」与「协同邻居进度」，输出唯一合法 JSON（仅填 `"reply"`，`"toolCalls": []`）。',
        ]
      : []),
    '',
    CHIEF_TOOLS_PROMPT_GUIDE,
  ].join('\n')

  const upsertArchiveFn = buildChiefArchiveUpsertFn(deps, rootId)
  const compactNowFn = buildChiefCompactFn(deps, rootId)

  const askReasonKind = statusOnlyInquiry
    ? 'quick_status'
    : (/筑墙|物理墙|guard.?wall/i.test(input)
        ? 'craft_wall'
        : (isBlankContext
            ? 'blank_explore'
            : ((effCfg.tacticalModes && effCfg.tacticalModes.intervention) ? 'strong_intervention' : 'ask_chat')))

  const loopRes = await runChiefAgenticLoop(deps, {
    rootId,
    sessionId: rootId,
    system: effectiveSystem,
    initialPrompt: promptLines.join('\n'),
    imageBlocks,
    allowTextFallbackOnVisionMiss: savedImagePaths.length > 0,
    permissionMode,
    hasChiefRiskAck,
    policyPlugins,
    board,
    maxSteps: statusOnlyInquiry ? 1 : 4,
    readOnlyToolsOnly: false,
    disableTools: statusOnlyInquiry || (_wallBlockerEscalation && permRank < 3),
    lazyDeferWorkspaceWritesToLead,
    callLlmFn: (callOpts) => callChiefLlm(deps, { reasonKind: askReasonKind, ...callOpts, maxTokens: SUMMARY_MAX_TOKENS }),
    extractJsonFn: extractJsonObject,
    upsertArchiveFn,
    compactNowFn,
    queueApprovalFn: (item) => queueChiefApproval(rootId, item),
    requestElevationFn: (req) => requestChiefElevation(rootId, req),
    recordAuditFn: (entry) => appendChiefAuditLog(rootId, entry),
  })

  const llmRes = (loopRes && loopRes.llmRes) || { ok: false, error: 'agentic loop no response' }
  if (imageBlocks.length > 0 && !llmRes.ok && !savedImagePaths.length) {
    return {
      ok: false,
      error: llmRes.error || '当前参谋长模型无法识别图片，请在右上角切换支持视觉的多模态模型后重试',
    }
  }

  let parsed = (loopRes && loopRes.parsed) || (llmRes.ok ? extractJsonObject(llmRes.text) : null)
  const loopBadges = Array.isArray(loopRes && loopRes.toolBadges) ? [...loopRes.toolBadges] : []
  const loopToolRecords = Array.isArray(loopRes && loopRes.toolRecords) ? loopRes.toolRecords : []
  const queuedApprovals = Array.isArray(loopRes && loopRes.pendingApprovals) ? [...loopRes.pendingApprovals] : []
  const queuedElevations = Array.isArray(loopRes && loopRes.elevationRequests) ? [...loopRes.elevationRequests] : []
  const compactToolRec = loopToolRecords.find(r => r && r.tool === 'session_compact') || null
  let forcedCompactOut = null
  let workflowBlockedNeedsElevation = false
  let chiefSystemBlockedNeedsElevation = false

  if (explicitCompactReq && !compactToolRec) {
    const compactGuard = evaluateSafetyGuardHardRules({ tool: 'session_compact', opClass: 'workflow', board })
    if (compactGuard.blocked) {
      forcedCompactOut = { ok: false, blockedBySafetyGuard: true, error: compactGuard.reason }
      loopBadges.push(compactGuard.badge || '🛡️ 卫兵拦截压缩')
      appendChiefAuditLog(rootId, { mode: permissionMode, stage: 'safety_guard', decision: 'blocked', operation: '压缩主对话', target: 'current', reason: compactGuard.reason, outcome: 'blocked', by: 'chief' })
    } else {
      const compactGate = evaluateChiefPermissionGate({ permissionMode, hasChiefRiskAck, policyPlugins, opClass: 'workflow', tool: 'session_compact' })
      if (compactGate.decision === 'deny_mode' || compactGate.decision === 'deny_unacknowledged_l3' || compactGate.decision === 'deny_policy_plugin') {
        workflowBlockedNeedsElevation = compactGate.decision !== 'deny_policy_plugin'
        forcedCompactOut = { ok: false, deniedByMode: true, error: compactGate.error }
        loopBadges.push(compactGate.badge || '🔒 权限禁压')
        appendChiefAuditLog(rootId, { mode: permissionMode, stage: compactGate.decision === 'deny_policy_plugin' ? 'policy_plugin' : 'permission_gate', rule: compactGate.rule || compactGate.decision, decision: compactGate.decision, operation: '压缩主对话', target: 'current', reason: compactGate.error, outcome: 'denied', by: 'chief' })
      } else if (compactGate.decision === 'require_approval') {
        const apr = queueChiefApproval(rootId, {
          category: 'main_workflow',
          operationLabel: '压缩主对话上下文 (/compact)',
          targetLabel: '当前主会话',
          reason: clamp(input, 140),
          impact: '会触发主会话历史压缩，先抢救细节入本会话档案柜再压缩裁剪历史上下文',
          kind: 'compact',
          capabilityScope: buildCapabilityScope({ kind: 'compact', tool: 'session_compact' }),
          payload: { reason: `用户指令触发：${input}` },
          by: 'chief',
        })
        if (apr) queuedApprovals.push(apr)
        forcedCompactOut = { ok: false, pendingApproval: true, error: '当前处于「L2 · 参谋模式」，压缩主对话请求已提交操作授权弹窗，请点击「允许本次操作」后执行。' }
        loopBadges.push('🛡️ 待确认 /compact')
        appendChiefAuditLog(rootId, { mode: permissionMode, stage: 'permission_gate', decision: 'pending_approval', operation: '压缩主对话', target: 'current', reason: clamp(input, 120), outcome: 'pending', by: 'chief' })
      } else {
        forcedCompactOut = await compactNowFn(`用户指令触发：${input}`).catch(err => ({
          ok: false,
          error: (err && err.message) || String(err || '压缩执行失败'),
        }))
        appendChiefAuditLog(rootId, {
          mode: permissionMode,
          stage: 'executor',
          decision: 'executed',
          operation: '压缩主对话',
          target: 'current',
          reason: clamp(input, 120),
          outcome: forcedCompactOut && forcedCompactOut.ok ? 'ok' : 'error',
          by: 'chief',
        })
        if (forcedCompactOut && forcedCompactOut.ok) {
          loopBadges.push(forcedCompactOut.noop ? '🗄️ 已归档(免压)' : '🗜 完成抢救压缩')
        } else {
          loopBadges.push('⚠️ 压缩未完成')
        }
      }
    }
  }

  // Graceful intelligent fallback if LLM is offline / unconfigured / returned non-JSON
  if (!parsed) {
    // 1) Explicit @peer relay syntax
    const mentionMatch = input.match(/^@([^\s:：,，]+)[:：,，\s]+([\s\S]+)$/)
    if (mentionMatch) {
      const targetName = mentionMatch[1]
      const msgBody = mentionMatch[2].trim()
      const delivery = await deliverCrossMessage(deps, {
        fromSession: rootId,
        fromLabel: '用户 (经 DSH 参谋长)',
        target: targetName,
        text: msgBody,
        mode: 'steer',
        imageBlocks,
        savedImagePaths,
      })
      const fallbackReply = delivery.ok
        ? `- 【已递话】已向 @${delivery.target} 插话传达指令${savedImagePaths.length ? `（附原图路径 ×${savedImagePaths.length}）` : ''}。`
        : `- 【投递失败】未找到目标 ${targetName}（${delivery.error}）`
      mutateChiefState((s) => {
        const ws = ensureWorkspace(s, rootId)
        persistTurnChatAndResume(ws, {
          chiefText: fallbackReply,
          actions: [delivery.ok ? `→ ${delivery.target || targetName}` : '投递失败'],
          forceReceipt: true,
        })
      })
      return {
        ok: delivery.ok,
        reply: fallbackReply,
        relays: [delivery],
        savedImagePaths,
        memoryChanges: [],
        boardOps: [],
        view: await getChiefView(deps, rootId, { autoSummarize: false, chatTriggered: !_fromLeadRequest }),
      }
    }

    // 2) Natural-language request to consolidate scattered boundaries into one
    if (!imageBlocks.length && /边界|红线/.test(input) && /总结成一条|合并成一条|浓缩|合一|整合/.test(input)) {
      if (permRank < 1) {
        return denyChiefSystemInAdvisor('浓缩呈批工作边界', '总结与呈批工作边界需要「L1 · 助手模式」及以上权限。')
      }
      const targetCol = /允许|必做/.test(input) ? 'allowed' : /注意/.test(input) ? 'notes' : ''
      const consRes = await consolidateBoundsWithChief(deps, {
        sessionId: rootId,
        field: targetCol,
        instruction: input,
      })
      if (consRes.ok) {
        mutateChiefState((s) => {
          const ws = ensureWorkspace(s, rootId)
          persistTurnChatAndResume(ws, {
            chiefText: consRes.reply,
            actions: ['呈批浓缩边界'],
            forceReceipt: true,
          })
        })
        return {
          ok: true,
          reply: consRes.reply,
          relays: [],
          memoryChanges: [],
          boardOps: [],
          boundProposals: consRes.proposals,
          view: consRes.view,
        }
      }
    }

    // 2.5) Wishing Box offline shortcuts: distill to global / reset tasks / unlink peer sessions
    if (!imageBlocks.length && /(?:提炼|摘取|抽取|总结)/.test(input) && /全局/.test(input)) {
      if (permRank < 1) {
        return denyChiefSystemInAdvisor('提炼入全局档案', '提炼经验写入全局冷库需要「L1 · 助手模式」及以上权限。')
      }
      const distRes = await distillSessionArchivesToGlobal(deps, {
        sessionId: rootId,
        instruction: input,
      })
      if (distRes.ok) {
        mutateChiefState((s) => {
          const ws = ensureWorkspace(s, rootId)
          persistTurnChatAndResume(ws, {
            chiefText: distRes.reply,
            actions: [`提炼入全局 ×${distRes.createdCount || 0}`],
            forceReceipt: true,
          })
        })
        return {
          ok: true,
          reply: distRes.reply,
          relays: [],
          memoryChanges: [],
          boardOps: [],
          archiveOps: [`提炼入全局 ×${distRes.createdCount || 0}`],
          archives: distRes.archives,
          view: distRes.view,
        }
      }
    }

    if (!imageBlocks.length && /(?:清空|重设|重置)/.test(input) && /(?:任务|看板)/.test(input)) {
      if (permRank < 1) {
        return denyChiefSystemInAdvisor('重设任务看板', '修改或重设参谋看板任务需要「L1 · 助手模式」及以上权限。')
      }
      const resetRes = deps.runAction
        ? deps.runAction({ action: 'task.reset', status: 'all', resetPlan: /计划|全部/.test(input), session: rootId, by: 'chief' })
        : { ok: false }
      if (resetRes && resetRes.ok) {
        const msg = '- 【已重设任务看板】已按你的要求清空重设本会话任务列表。'
        mutateChiefState((s) => {
          const ws = ensureWorkspace(s, rootId)
          persistTurnChatAndResume(ws, {
            chiefText: msg,
            actions: ['重设任务看板'],
            forceReceipt: true,
          })
        })
        return {
          ok: true,
          reply: msg,
          relays: [],
          memoryChanges: [],
          boardOps: ['重设任务看板'],
          board: resetRes.board,
          view: await getChiefView(deps, rootId, { autoSummarize: false, chatTriggered: !_fromLeadRequest }),
        }
      }
    }

    if (!imageBlocks.length && /(?:断开|取消|解除)/.test(input) && /(?:协同|网络|连接|关联)/.test(input)) {
      if (permRank < 1) {
        return denyChiefSystemInAdvisor('调整协同网络', '连接或断开跨窗口协同网络需要「L1 · 助手模式」及以上权限。')
      }
      const linkedPeers = ((directory && directory.otherSessions) || []).filter(p => p.linked)
      const qLower = input.toLowerCase()
      const targetsToUnlink = /全部|所有/.test(input)
        ? linkedPeers
        : linkedPeers.filter(p => qLower.includes(String(p.id).toLowerCase()) || (p.name && qLower.includes(String(p.name).toLowerCase())))
      const chosen = targetsToUnlink.length > 0 ? targetsToUnlink : (linkedPeers.length === 1 ? linkedPeers : [])
      if (chosen.length > 0) {
        const badges = []
        for (const p of chosen) {
          const r = setPeerLink(rootId, p.id, false)
          if (r && r.ok) badges.push(`断开协同：${p.name}`)
        }
        if (badges.length > 0) {
          const msg = `- 【已断开协同网络】${badges.join('；')}`
          mutateChiefState((s) => {
            const ws = ensureWorkspace(s, rootId)
            persistTurnChatAndResume(ws, {
              chiefText: msg,
              actions: badges,
              forceReceipt: true,
            })
          })
          return {
            ok: true,
            reply: msg,
            relays: [],
            memoryChanges: [],
            boardOps: [],
            networkOps: badges,
            view: await getChiefView(deps, rootId, { autoSummarize: false, chatTriggered: !_fromLeadRequest }),
          }
        }
      }
    }

    // 2.5) Deterministic reply when user explicitly requested compaction
    if (forcedCompactOut) {
      const compactMsg = forcedCompactOut.ok
        ? (forcedCompactOut.noop
            ? `- 【已归档(免压)】已抢救当前现场记录入本会话档案柜${forcedCompactOut.harvestId ? `（#${forcedCompactOut.harvestId}）` : ''}；当前主对话历史暂无需压缩。`
            : `- 【已完成抢救与上下文压缩】已将关键细节抢救入本会话档案柜${forcedCompactOut.harvestId ? `（#${forcedCompactOut.harvestId}）` : ''}，并完成主对话上下文静默压缩。`)
        : (forcedCompactOut.pendingApproval
            ? `- 【🛡️ 待逐项确认】${forcedCompactOut.error}`
            : forcedCompactOut.deniedByMode
              ? `- 【🔒 权限受限】${forcedCompactOut.error}`
              : `- 【压缩未完成】${forcedCompactOut.error || '当前暂无可压缩历史或宿主压缩服务暂未就绪。'}`)
      let autoElevOut = null
      if (workflowBlockedNeedsElevation && !queuedElevations.length) {
        autoElevOut = requestChiefElevation(rootId, {
          fromMode: permissionMode,
          targetMode: 'strategist',
          reason: '执行主对话上下文压缩 (/compact) 需要「L2 · 参谋模式（逐项确认）」或以上权限',
          requestedActionSummary: clamp(input, 140),
          by: 'chief',
        })
      }
      mutateChiefState((s) => {
        const ws = ensureWorkspace(s, rootId)
        persistTurnChatAndResume(ws, {
          chiefText: compactMsg,
          actions: loopBadges,
          elevationObj: autoElevOut,
          pendingApprovalList: queuedApprovals,
          forceReceipt: true,
          thinkingEffort: llmRes.thinkingEffort || '',
          thinkingEffortMode: llmRes.thinkingEffortMode || effCfg.thinkingEffort || 'auto',
        })
      })
      return {
        ok: true,
        reply: compactMsg,
        relays: [],
        memoryChanges: [],
        boardOps: [],
        actionBadges: loopBadges,
        toolRecords: loopToolRecords,
        pendingApprovals: queuedApprovals,
        ...(autoElevOut ? { elevationRequested: autoElevOut } : {}),
        view: await getChiefView(deps, rootId, { autoSummarize: false, chatTriggered: !_fromLeadRequest }),
      }
    }

    // 3) Fallback summary + auto-elevation if a read-only/assistant tool wall occurred
    const deniedToolRec = loopToolRecords.find(r => r && r.result && r.result.deniedByMode)
    let fallbackElev = queuedElevations[0] || null
    if (deniedToolRec && !fallbackElev) {
      fallbackElev = requestChiefElevation(rootId, {
        fromMode: permissionMode,
        targetMode: deniedToolRec.result.requiredMode || 'strategist',
        reason: deniedToolRec.result.error || '执行请求的操作需要更高权限',
        requestedActionSummary: clamp(input, 160),
        by: 'chief',
      })
    }
    const strippedPlain = llmRes.ok && llmRes.text ? stripToolCallMarkup(llmRes.text).trim() : ''
    const usablePlainLlm = strippedPlain && !strippedPlain.startsWith('{') && strippedPlain.length >= 6
      ? cleanMultiline(strippedPlain, 2200)
      : ''
    const archiveFallback = onDemandArchiveLines.length > 1
      ? ['- 【已从沉淀档案柜按需检索到以下卷宗】', ...onDemandArchiveLines.slice(2)].join('\n')
      : ''
    const rawFallbackReply = usablePlainLlm || archiveFallback || buildSmartFallbackReply({
      input,
      board,
      liveDigest,
      directory,
      facts: numberedFacts,
      mailbox: view.mailbox,
      conciseBrief: isConciseBrief,
    })
    const replyText = isConciseBrief ? sanitizeConciseBriefText(rawFallbackReply) : rawFallbackReply
    const fallbackBounds = (permRank >= 1 && quickAction !== 'consult_chief') ? extractFallbackBoundProposalsFromText(rawFallbackReply, input) : []
    const createdFallbackBounds = []
    const BOUND_COL_LABEL_FB = { forbidden: '禁止红线', allowed: '必做事项', notes: '注意事项' }

    mutateChiefState((s) => {
      const ws = ensureWorkspace(s, rootId)
      const existingFb = (board && board.bounds) || { allowed: [], forbidden: [], notes: [] }
      for (const fb of fallbackBounds) {
        const col = ['forbidden', 'allowed', 'notes'].includes(fb.field) ? fb.field : 'forbidden'
        const colList = Array.isArray(existingFb[col]) ? existingFb[col] : []
        if (colList.some(x => String(x).trim() === fb.item)) continue
        if (ws.suggestions.some(ex => ex && ex.status === 'pending' && ex.kind === 'bound' && ex.draftText === fb.item)) continue
        const colLabel = BOUND_COL_LABEL_FB[col] || '禁止红线'
        const sug = normalizeSuggestion({
          kind: 'bound',
          boundField: col,
          fromAgent: '✦ 参谋长提炼',
          title: `拟入${colLabel}：${clamp(fb.item, 30)}`,
          reason: fb.reason,
          target: 'bounds',
          targetLabel: colLabel,
          mode: 'silent',
          draftText: fb.item,
          pinGlobal: Boolean(fb.pinGlobal),
        })
        if (sug) {
          ws.suggestions.push(sug)
          if (ws.suggestions.length > SUGGESTIONS_CAP) ws.suggestions = ws.suggestions.slice(-SUGGESTIONS_CAP)
          createdFallbackBounds.push(sug)
          loopBadges.push(`呈批${colLabel}：${clamp(fb.item, 18)}`)
        }
      }
      persistTurnChatAndResume(ws, {
        chiefText: replyText,
        actions: loopBadges,
        elevationObj: fallbackElev,
        pendingApprovalList: queuedApprovals,
        forceReceipt: createdFallbackBounds.length > 0,
        thinkingEffort: llmRes.thinkingEffort || '',
        thinkingEffortMode: llmRes.thinkingEffortMode || effCfg.thinkingEffort || 'auto',
      })
    })
    return {
      ok: true,
      reply: replyText,
      relays: [],
      memoryChanges: [],
      boardOps: [],
      boundProposals: createdFallbackBounds,
      actionBadges: loopBadges,
      toolRecords: loopToolRecords,
      pendingApprovals: queuedApprovals,
      ...(fallbackElev ? { elevationRequested: fallbackElev } : {}),
      view: await getChiefView(deps, rootId, { autoSummarize: false, chatTriggered: !_fromLeadRequest }),
    }
  }

  // Execute decomposed relays with strict 4-tier workflow permission gating
  const relayResults = []
  const actionBadges = [...loopBadges]
  const relayGate = evaluateChiefPermissionGate({
    permissionMode,
    hasChiefRiskAck,
    policyPlugins,
    opClass: 'workflow',
    tool: 'relay',
  })

  for (const r of (Array.isArray(parsed.relays) ? parsed.relays : []).slice(0, 8)) {
    if (!r || !r.text) continue
    const targetName = r.target || 'lead'
    const isLeadTarget = /^(?:lead|main|主对话)$/i.test(String(targetName).trim())
    const relayMode = ['steer', 'followup', 'silent'].includes(r.mode) ? r.mode : 'steer'

    const relayGuard = evaluateSafetyGuardHardRules({ tool: 'relay', opClass: 'workflow', command: r.text, board })
    if (relayGuard.blocked) {
      actionBadges.push(relayGuard.badge || '🛡️ 卫兵拦递话')
      relayResults.push({ ok: false, target: targetName, blockedBySafetyGuard: true, error: relayGuard.reason })
      appendChiefAuditLog(rootId, { mode: permissionMode, stage: 'safety_guard', rule: relayGuard.rule || 'hard_guard', decision: 'blocked', operation: '工作流递话', target: String(targetName), reason: relayGuard.reason, outcome: 'blocked', by: 'chief' })
      continue
    }

    if (relayGate.decision === 'deny_mode' || relayGate.decision === 'deny_unacknowledged_l3' || relayGate.decision === 'deny_policy_plugin') {
      if (relayGate.decision !== 'deny_policy_plugin') workflowBlockedNeedsElevation = true
      actionBadges.push(relayGate.badge || '🔒 权限禁调工作流')
      relayResults.push({ ok: false, target: targetName, deniedByMode: true, error: relayGate.error })
      appendChiefAuditLog(rootId, { mode: permissionMode, stage: relayGate.decision === 'deny_policy_plugin' ? 'policy_plugin' : 'permission_gate', rule: relayGate.rule || relayGate.decision, decision: relayGate.decision, operation: isLeadTarget ? '调整主对话工作流' : '调整子代理工作流', target: String(targetName), reason: relayGate.error, outcome: 'denied', by: 'chief' })
      continue
    }

    if (relayGate.decision === 'require_approval') {
      const apr = queueChiefApproval(rootId, {
        category: isLeadTarget ? 'main_workflow' : 'subagent_workflow',
        operationLabel: isLeadTarget ? '调整主对话工作流（投递指令）' : '调整子代理工作流（投递指令）',
        targetLabel: isLeadTarget ? '主对话 (@lead)' : `@${targetName}`,
        reason: clamp(r.subject || '参谋建议向代理投递工作流指令', 140),
        impact: isLeadTarget ? '将向主对话注入工作流指令并触发继续推进' : '将唤醒或引导子代理执行新任务指令',
        preview: clamp(r.text, 240),
        kind: 'relay',
        capabilityScope: buildCapabilityScope({ kind: 'relay', tool: 'relay', target: targetName }),
        payload: {
          fromSession: rootId,
          fromLabel: 'DSH 参谋 (执行请求 · 逐项授权)',
          target: targetName,
          subject: r.subject || '',
          text: r.text,
          mode: relayMode,
          envelopeKind: 'execution_request',
          taskId: r.taskId || '',
          imageBlocks,
          savedImagePaths,
          isBlankContext,
        },
        by: 'chief',
      })
      if (apr) queuedApprovals.push(apr)
      actionBadges.push(`🛡️ 待确认递话 → ${isLeadTarget ? '主对话' : targetName}`)
      relayResults.push({ ok: false, pendingApproval: true, approvalId: apr && apr.id, target: targetName })
      appendChiefAuditLog(rootId, { mode: permissionMode, stage: 'permission_gate', decision: 'pending_approval', operation: isLeadTarget ? '主对话工作流递话' : '子代理工作流递话', target: String(targetName), reason: clamp(r.subject || r.text, 120), outcome: 'pending', by: 'chief' })
      continue
    }

    // L3 Chief mode: execute via explicit execution_request envelope (never impersonate user)
    const deliv = await deliverCrossMessage(deps, {
      fromSession: rootId,
      fromLabel: 'DSH 参谋长 (执行请求)',
      target: targetName,
      subject: r.subject || '',
      text: r.text,
      mode: relayMode,
      envelopeKind: 'execution_request',
      taskId: r.taskId || '',
      imageBlocks,
      savedImagePaths,
    })
    if (isLeadTarget && (!deliv.ok || (isBlankContext && !deliv.deliveredPhysical)) && typeof deps.stagePendingTransfer === 'function') {
      const staged = deps.stagePendingTransfer(
        `[DSH 参谋长预派发指令${r.subject ? ' · ' + r.subject : ''}]\n${r.text}`,
        rootId,
        { by: 'chief', subject: r.subject || '' },
      )
      if (staged) {
        relayResults.push({ ...deliv, ok: true, target: '主对话(待领)', mode: 'pending-transfer', stagedPending: true })
        actionBadges.push('暂存待领 → 主对话')
        appendChiefAuditLog(rootId, { mode: permissionMode, stage: 'executor', decision: 'executed', operation: '主对话待领递话', target: '主对话', reason: clamp(r.subject || r.text, 120), outcome: 'ok', by: 'chief' })
        continue
      }
    }
    relayResults.push(deliv)
    appendChiefAuditLog(rootId, { mode: permissionMode, stage: 'executor', decision: 'executed', operation: isLeadTarget ? '主对话递话' : '子代理递话', target: String(deliv.target || targetName), reason: clamp(r.subject || r.text, 120), outcome: deliv.ok ? 'ok' : 'error', by: 'chief' })
    if (deliv.ok) actionBadges.push(`${relayMode === 'steer' ? '插话' : '递话'} → ${deliv.target}`)
  }

  // Execute Chief-system ops (L1 Assistant+ required; strictly denied in L0 Advisor)
  const rawInquiries = Array.isArray(parsed.inquiries) ? parsed.inquiries.slice(0, 3) : []
  const rawWallListSrc = Array.isArray(parsed.wallProposals)
    ? parsed.wallProposals
    : (Array.isArray(parsed.guardWalls) ? parsed.guardWalls : [])
  const rawWallProposals = rawWallListSrc.slice(0, 4)
  const rawBoundListSrc = Array.isArray(parsed.boundProposals) && parsed.boundProposals.length > 0
    ? parsed.boundProposals
    : (Array.isArray(parsed.boundaryProposals) && parsed.boundaryProposals.length > 0
        ? parsed.boundaryProposals
        : extractFallbackBoundProposalsFromText(parsed.reply || '', input))
  const rawArchiveOps = Array.isArray(parsed.archiveOps) ? parsed.archiveOps.slice(0, 8) : []
  const rawEffortOps = Array.isArray(parsed.effortOps) ? parsed.effortOps.slice(0, 6) : []
  const internalArchiveOps = []
  const mainInjectArchiveOps = []
  for (const opItem of rawArchiveOps) {
    if (!opItem || typeof opItem !== 'object') continue
    const normOp = normalizeArchiveOpName(opItem.op)
    const sc = opItem.vaultScope === 'precipitated'
      ? 'precipitated'
      : (opItem.vaultScope === 'global' ? 'global' : 'session')
    if (sc === 'precipitated' || normOp === 'pull_precipitated') {
      internalArchiveOps.push(opItem)
    } else if (MAIN_INJECT_ARCHIVE_OPS.has(normOp)) {
      mainInjectArchiveOps.push({ ...opItem, op: normOp, vaultScope: sc })
    } else if (normOp === 'save' && opItem.takeOut) {
      internalArchiveOps.push({ ...opItem, takeOut: false })
      mainInjectArchiveOps.push({ op: 'pin_to_desktop', vaultScope: sc, title: opItem.title, instruction: opItem.summary || '' })
    } else {
      internalArchiveOps.push(opItem)
    }
  }
  const hasSystemOps = Boolean(
    (Array.isArray(parsed.boardOps) && parsed.boardOps.length > 0)
    || internalArchiveOps.length > 0
    || (Array.isArray(parsed.networkOps) && parsed.networkOps.length > 0)
    || (Array.isArray(parsed.memoryChanges) && parsed.memoryChanges.length > 0)
    || rawBoundListSrc.length > 0
    || rawWallProposals.length > 0,
  )
  const systemGate = evaluateChiefPermissionGate({
    permissionMode,
    hasChiefRiskAck,
    policyPlugins,
    opClass: 'chief_system',
    tool: 'chief_system',
  })

  let executedBoardOps = []
  let executedArchiveOps = []
  let executedNetworkOps = []
  let executedEffortOps = []
  const pendingArchiveSuggestions = []
  const pendingEffortSuggestions = []
  let appliedFacts = []
  const proposedBounds = []
  const existingBounds = (board && board.bounds) || { allowed: [], forbidden: [], notes: [] }
  const rawBoundProposals = rawBoundListSrc.slice(0, 4)

  if (hasSystemOps && systemGate.decision !== 'allow' && systemGate.decision !== 'allow_approved') {
    chiefSystemBlockedNeedsElevation = systemGate.decision === 'deny_mode'
    actionBadges.push(systemGate.badge || '🔒 L0禁改参谋系统')
    appendChiefAuditLog(rootId, {
      mode: permissionMode,
      stage: systemGate.decision === 'deny_policy_plugin' ? 'policy_plugin' : 'permission_gate',
      rule: systemGate.rule || systemGate.decision,
      decision: systemGate.decision,
      operation: '修改参谋系统(看板/记忆/档案)',
      target: 'chief_system',
      reason: systemGate.error,
      outcome: 'denied',
      by: 'chief',
    })
  } else if (hasSystemOps) {
    executedBoardOps = applyBoardOps(deps, rootId, parsed.boardOps, { callerOrigin: 'chief_llm' })
    for (const b of executedBoardOps) actionBadges.push(b)

    const archiveExec = await applyArchiveOps(deps, rootId, internalArchiveOps, { input, allowPinToDesktop: false })
    executedArchiveOps = archiveExec.executed || []
    for (const a of executedArchiveOps) actionBadges.push(a)

    executedNetworkOps = applyNetworkOps(rootId, parsed.networkOps, directory)
    for (const n of executedNetworkOps) actionBadges.push(n)

    if (executedBoardOps.length || executedArchiveOps.length || executedNetworkOps.length) {
      appendChiefAuditLog(rootId, {
        mode: permissionMode,
        stage: 'executor',
        decision: 'executed',
        operation: '维护参谋系统',
        target: [...executedBoardOps, ...executedArchiveOps, ...executedNetworkOps].slice(0, 3).join('；'),
        reason: clamp(input, 120),
        outcome: 'ok',
        by: 'chief',
      })
    }
  }

  // Dual-channel main injection from archives (Channel A: desktop pin/unpin, Channel B: deliver_to_lead)
  // L0/L1 -> Suggestion pill; L2 -> Approval card + TaskLedger; L3 -> Direct execution
  for (const item of mainInjectArchiveOps) {
    const scopeLabel = item.vaultScope === 'global' ? '全局档案柜' : '本局档案柜'
    const refText = item.title ? `《${clamp(item.title, 28)}》` : `#${item.id || item.archiveId || '?'}`
    const opDesc = item.op === 'pin_to_desktop'
      ? `将${scopeLabel}档案置顶桌面`
      : (item.op === 'unpin_from_desktop' ? `将${scopeLabel}档案撤回抽屉` : `向主对话递送${scopeLabel}档案`)
    if (relayGate.decision === 'deny_mode' || relayGate.decision === 'deny_unacknowledged_l3' || relayGate.decision === 'deny_policy_plugin') {
      if (relayGate.decision !== 'deny_policy_plugin' && permRank < 2) {
        pendingArchiveSuggestions.push({
          kind: 'archive_op',
          fromAgent: '📌 参谋档案馆通道',
          title: `${opDesc}：${refText}`,
          reason: clamp(item.instruction || `当前处于 L${permRank} 只读/助手档，后台不直接注入主会话；点「执行建议」即刻落位。`, 180),
          target: item.target || 'lead',
          targetLabel: item.op === 'deliver_to_lead' ? '主对话 (@lead)' : '📌 认知桌面',
          mode: 'steer',
          draftText: `${opDesc} ${refText}${item.instruction ? ' — ' + item.instruction : ''}`,
          archiveSpec: {
            op: item.op,
            vaultScope: item.vaultScope,
            id: item.id || item.archiveId || '',
            title: item.title || '',
            target: item.target || 'lead',
            instruction: item.instruction || '',
          },
        })
        actionBadges.push(`💡 建议档案注入：${refText}`)
      } else {
        workflowBlockedNeedsElevation = workflowBlockedNeedsElevation || relayGate.decision !== 'deny_policy_plugin'
        actionBadges.push(relayGate.badge || '🔒 权限禁注档案')
      }
      continue
    }
    if (relayGate.decision === 'require_approval') {
      const apr = queueChiefApproval(rootId, {
        category: 'main_workflow',
        operationLabel: opDesc,
        targetLabel: `${scopeLabel} · ${refText}`,
        reason: clamp(item.instruction || 'L2 参谋模式：向主对话桌面或正文注入档案前需逐项确认', 140),
        impact: item.op === 'deliver_to_lead' ? '将把该卷宗摘要与要点投递至主对话并唤醒查收' : '将调整主对话共享认知桌面置顶列表（受 2400 Tokens/6 份预算约束）',
        preview: clamp(`${opDesc} ${refText}${item.instruction ? '\n附言：' + item.instruction : ''}`, 240),
        kind: 'archive_op',
        capabilityScope: buildCapabilityScope({ kind: 'archive_op', tool: 'archive_op', target: refText }),
        payload: {
          op: item.op,
          vaultScope: item.vaultScope,
          id: item.id || item.archiveId || '',
          title: item.title || '',
          target: item.target || 'lead',
          instruction: item.instruction || '',
        },
        by: 'chief',
      })
      if (apr) queuedApprovals.push(apr)
      actionBadges.push(`🛡️ 待确认档案注入：${refText}`)
      appendChiefAuditLog(rootId, { mode: permissionMode, stage: 'permission_gate', decision: 'pending_approval', operation: opDesc, target: refText, reason: clamp(input, 120), outcome: 'pending', by: 'chief' })
      continue
    }
    const execOut = await executeChiefArchiveInjectionOp(deps, rootId, item, { input })
    if (execOut && execOut.ok) {
      executedArchiveOps.push(execOut.actionText)
      actionBadges.push(execOut.actionText)
      appendChiefAuditLog(rootId, { mode: permissionMode, stage: 'executor', decision: 'executed', operation: opDesc, target: refText, reason: clamp(input, 120), outcome: 'ok', by: 'chief' })
    }
  }

  // Hot reasoning-effort shifting (`effortOps`) with 4-tier permission gate + teamEffortMode + per-agent user 🔒 veto lock
  const userLocks = (effCfg && effCfg.lockedModelEfforts && typeof effCfg.lockedModelEfforts === 'object') ? effCfg.lockedModelEfforts : {}
  const isManualTeamEffort = Boolean(effCfg && effCfg.teamEffortMode === 'manual')
  if (isManualTeamEffort && rawEffortOps.length > 0) {
    actionBadges.push('✋ 团队思考强度已设为手动，跳过自动调挡')
    appendChiefAuditLog(rootId, {
      mode: permissionMode,
      stage: 'model_effort_lock',
      decision: 'blocked',
      operation: '调节模型思考强度',
      target: rawEffortOps.map(ef => String((ef && (ef.target || ef.agent)) || 'lead').replace(/^@/, '')).join(','),
      reason: '团队思考强度处于「手动」模式，已跳过自动调挡',
      outcome: 'blocked',
      by: 'chief',
    })
  }
  for (const ef of (isManualTeamEffort ? [] : rawEffortOps)) {
    if (!ef || typeof ef !== 'object') continue
    const efTarget = clamp(String(ef.target || ef.agent || 'lead').trim().replace(/^@/, ''), 64) || 'lead'
    const rawEf = String(ef.effort || ef.reasoningEffort || 'medium').trim().toLowerCase()
    const efVal = ['off', 'low', 'medium', 'high', 'xhigh'].includes(rawEf) ? rawEf : 'medium'
    const efReason = clamp(String(ef.reason || '按任务复杂度协同调节模型思考强度').trim(), 180)
    const shortEfTarget = efTarget.split('/').pop()
    const isUserLocked = Boolean(userLocks[efTarget] === true || userLocks[shortEfTarget] === true)
    if (isUserLocked) {
      actionBadges.push(`🔒 用户已锁挡 @${efTarget}`)
      appendChiefAuditLog(rootId, { mode: permissionMode, stage: 'model_effort_lock', decision: 'blocked', operation: '调节模型思考强度', target: efTarget, reason: `用户开启「🔒 锁挡」，阻止调为 ${efVal}`, outcome: 'blocked', by: 'chief' })
      continue
    }
    if (relayGate.decision === 'deny_mode' || relayGate.decision === 'deny_unacknowledged_l3' || relayGate.decision === 'deny_policy_plugin') {
      if (relayGate.decision !== 'deny_policy_plugin' && permRank < 2) {
        pendingEffortSuggestions.push({
          kind: 'model_effort',
          fromAgent: '🧠 思考强度建议',
          title: `建议调挡 @${efTarget} → ${efVal}`,
          reason: efReason,
          target: efTarget,
          targetLabel: efTarget === 'lead' ? '主对话 (@lead)' : `@${efTarget}`,
          mode: 'silent',
          draftText: `将 @${efTarget} 思考强度设为 ${efVal}（${efReason}）`,
          effortSpec: { target: efTarget, effort: efVal, reason: efReason },
        })
        actionBadges.push(`💡 建议调挡 @${efTarget}→${efVal}`)
      } else {
        workflowBlockedNeedsElevation = workflowBlockedNeedsElevation || relayGate.decision !== 'deny_policy_plugin'
        actionBadges.push(relayGate.badge || '🔒 权限禁调档位')
      }
      continue
    }
    if (relayGate.decision === 'require_approval') {
      const apr = queueChiefApproval(rootId, {
        category: 'main_workflow',
        operationLabel: '调节模型思考强度',
        targetLabel: efTarget === 'lead' ? '主对话 (@lead)' : `@${efTarget}`,
        reason: efReason,
        impact: `批准后将静默热调节 @${efTarget} 的推理思考深度为 ${efVal}`,
        preview: `@${efTarget} → ${efVal}`,
        kind: 'model_effort',
        capabilityScope: buildCapabilityScope({ kind: 'model_effort', tool: 'model_effort', target: efTarget }),
        payload: { target: efTarget, reasoningEffort: efVal, reason: efReason },
        by: 'chief',
      })
      if (apr) queuedApprovals.push(apr)
      actionBadges.push(`🛡️ 待确认调挡 @${efTarget}→${efVal}`)
      appendChiefAuditLog(rootId, { mode: permissionMode, stage: 'permission_gate', decision: 'pending_approval', operation: '调节模型思考强度', target: efTarget, reason: efReason, outcome: 'pending', by: 'chief' })
      continue
    }
    if (deps && typeof deps.controlMainAgent === 'function') {
      const ctrlRes = await deps.controlMainAgent({
        rootId,
        sessionId: rootId,
        op: 'set_effort',
        target: efTarget,
        reasoningEffort: efVal,
        reason: efReason,
        byUser: false,
      }).catch(e => ({ ok: false, error: (e && e.message) || 'effort-control-failed' }))
      if (ctrlRes && ctrlRes.ok) {
        const tag = `🧠 调挡 @${efTarget} → ${ctrlRes.reasoningEffort || efVal}`
        executedEffortOps.push(tag)
        actionBadges.push(tag)
      } else if (ctrlRes && ctrlRes.lockedByUser) {
        actionBadges.push(`🔒 用户已锁挡 @${efTarget}`)
      }
    }
  }

  // Handle explicit model elevationRequest OR auto-generate when an action hit mode wall
  let finalElevation = queuedElevations[0] || null
  if (parsed.elevationRequest && typeof parsed.elevationRequest === 'object' && parsed.elevationRequest.targetMode) {
    const reqTarget = normalizePermissionMode(parsed.elevationRequest.targetMode)
    if (permissionRank(reqTarget) > permRank) {
      const elv = requestChiefElevation(rootId, {
        fromMode: permissionMode,
        targetMode: reqTarget,
        reason: clamp(parsed.elevationRequest.reason || '完成用户当前任务需要提升参谋权限', 240),
        requestedActionSummary: clamp(parsed.elevationRequest.requestedActionSummary || input, 180),
        by: 'chief',
      })
      if (elv) {
        finalElevation = elv
        actionBadges.push(`🔐 请示提权 ${CHIEF_PERMISSION_META[reqTarget].level}`)
      }
    }
  } else if (!finalElevation) {
    const deniedToolRec = loopToolRecords.find(r => r && r.result && r.result.deniedByMode)
    const neededMode = (deniedToolRec && deniedToolRec.result && deniedToolRec.result.requiredMode)
      || (workflowBlockedNeedsElevation ? 'strategist' : (chiefSystemBlockedNeedsElevation ? 'assistant' : ''))
    if (neededMode && permissionRank(neededMode) > permRank) {
      const elv = requestChiefElevation(rootId, {
        fromMode: permissionMode,
        targetMode: neededMode,
        reason: neededMode === 'assistant'
          ? '该操作需要维护参谋看板、记忆或档案（需「L1 · 助手模式」及以上）'
          : '该操作需要修改工作区或调度主对话/子代理工作流（需「L2 · 参谋模式」或以上）',
        requestedActionSummary: clamp(input, 180),
        by: 'chief',
      })
      if (elv) {
        finalElevation = elv
        actionBadges.push(`🔐 请示提权 ${CHIEF_PERMISSION_META[neededMode].level}`)
      }
    }
  }

  const cleanedParsedReply = stripToolCallMarkup(parsed.reply || '').trim()
  const compactOutcomeNote = forcedCompactOut
    ? (forcedCompactOut.ok
        ? (forcedCompactOut.noop
            ? `【已归档(免压)】已将本轮现场记录存入本会话档案柜${forcedCompactOut.harvestId ? `（#${forcedCompactOut.harvestId}）` : ''}，宿主历史暂无需进一步压缩。`
            : `【已完成抢救与上下文压缩】已将关键细节存入本会话档案柜${forcedCompactOut.harvestId ? `（#${forcedCompactOut.harvestId}）` : ''}，并完成主对话静默压缩。`)
        : (forcedCompactOut.pendingApproval
            ? `【🛡️ 待逐项确认】${forcedCompactOut.error}`
            : `【压缩未完成】${forcedCompactOut.error || '宿主压缩服务未就绪'}`))
    : (compactToolRec && compactToolRec.ok === false && !compactToolRec.pendingApproval
        ? `（⚠️ 实测压缩提示：${compactToolRec.error || '压缩未完成'}）`
        : '')
  const permissionStatusNotes = []
  if (queuedApprovals.length > 0 && !/操作授权|允许本次操作/.test(cleanedParsedReply)) {
    permissionStatusNotes.push(`- 【🛡️ 待逐项确认】已为您弹出「操作授权请求」弹窗（共 ${queuedApprovals.length} 项受控操作），点击「允许本次操作」后才会实际执行。`)
  }
  if (finalElevation && !/提权/.test(cleanedParsedReply)) {
    const tgtMeta = CHIEF_PERMISSION_META[finalElevation.targetMode] || {}
    permissionStatusNotes.push(`- 【🔐 已申请提权】当前为「${CHIEF_PERMISSION_META[permissionMode].level} · ${CHIEF_PERMISSION_META[permissionMode].title}」，已向您发起提权至「${tgtMeta.level || ''} · ${tgtMeta.title || finalElevation.targetMode}」的申请弹窗。`)
  }
  const baseParsedReply = cleanedParsedReply || buildSmartFallbackReply({ input, board, liveDigest, directory, facts: numberedFacts, mailbox: view.mailbox, conciseBrief: isConciseBrief }) || '- 【已执行】已按你的吩咐安排妥当。'
  const combinedParsedReply = [
    compactOutcomeNote,
    baseParsedReply,
    ...permissionStatusNotes,
  ].filter(Boolean).join('\n')
  const rawReplyText = cleanMultiline(combinedParsedReply, 1800)
  const replyText = isConciseBrief ? sanitizeConciseBriefText(rawReplyText) : rawReplyText

  const BOUND_COL_LABEL = { forbidden: '禁止红线', allowed: '必做事项', notes: '注意事项' }
  const createdInquiries = []
  const proposedWalls = []
  const proposedWallRemovals = []
  const cwdForWall = resolveSessionWorkspaceCwd(deps, rootId)
  const rawWallRemovalProposals = Array.isArray(parsed.wallRemovalProposals) ? parsed.wallRemovalProposals.slice(0, 2) : []

  mutateChiefState((s) => {
    const ws = ensureWorkspace(s, rootId)

    // Ultra-strict, all-tier (L0-L3) Human Approval Wall-Removal Proposal Gate
    if (rawWallRemovalProposals.length > 0) {
      const hasWallBlockLog = (Array.isArray(ws.auditLog) ? ws.auditLog : [])
        .some(e => e && e.stage === 'guard_wall' && e.outcome === 'blocked')
      const mentionsBlocker = /(?:撞墙|物理驻墙|物理墙|无法绕过|事前物理拦截|guard_wall|wall-)/i.test(input)
      const hasWallBlockerEvidence = Boolean(_wallBlockerEscalation || (hasWallBlockLog && mentionsBlocker))
      if (!hasWallBlockerEvidence) {
        pushAuditToWs(ws, {
          mode: permissionMode,
          stage: 'guard_wall',
          rule: 'wall_removal_denied_no_blocker_evidence',
          decision: 'rejected',
          operation: '拦截无依据拆墙提议',
          target: 'guard_walls',
          reason: '未收到主/子代理真实撞墙且无法绕过阻断上报，拒绝生成拆墙申请',
          outcome: 'rejected',
          by: 'chief',
        }, rootId)
      } else {
        const activeWalls = listGuardWalls({ cwd: cwdForWall }).filter(w => w && w.scope !== 'paused')
        for (const rawWr of rawWallRemovalProposals) {
          if (!rawWr || typeof rawWr !== 'object') continue
          const reqId = String(rawWr.wallId || rawWr.id || '').trim()
          const reqTitle = String(rawWr.wallTitle || rawWr.title || '').trim()
          const matchedWall = activeWalls.find(w =>
            (reqId && w.id === reqId)
            || (reqTitle && w.title === reqTitle),
          )
          if (!matchedWall) continue
          const blockerEv = cleanMultiline(rawWr.blockerEvidence || rawWr.evidence || '', 260)
          const removeReason = cleanMultiline(rawWr.reason || '', 220)
          if (!blockerEv || !removeReason) continue
          const dupWr = ws.suggestions.some(ex =>
            ex
            && ex.status === 'pending'
            && ex.kind === 'wall_removal'
            && ex.wallRemovalSpec
            && ex.wallRemovalSpec.wallId === matchedWall.id,
          )
          if (dupWr) continue
          const actMode = String(rawWr.action || '').trim().toLowerCase() === 'remove' ? 'remove' : 'pause'
          const patStr = Array.isArray(matchedWall.patterns) ? matchedWall.patterns.join(', ') : ''
          const sug = normalizeSuggestion({
            kind: 'wall_removal',
            fromAgent: '⚠️ 参谋请示拆墙（极低概率 · 阻断复核）',
            title: `请示${actMode === 'remove' ? '拆除' : '暂挂'}物理墙：${clamp(matchedWall.title, 28)}`,
            reason: clamp(removeReason, 200),
            target: 'guard_walls',
            targetLabel: clamp(matchedWall.title, 36),
            mode: 'silent',
            draftText: [
              `目标物理驻墙：${matchedWall.title} (${matchedWall.id})`,
              `拦截规则：[${matchedWall.ruleType}] ${patStr}`,
              `代理阻断依据：${blockerEv}`,
              `拟批准操作：${actMode === 'remove' ? '永久移除该物理驻墙' : '暂挂休眠该物理驻墙（可随时恢复）'}`,
            ].join('\n'),
            evidence: blockerEv,
            wallRemovalSpec: {
              wallId: matchedWall.id,
              wallTitle: matchedWall.title,
              action: actMode,
              patterns: matchedWall.patterns || [],
              reason: removeReason,
              blockerEvidence: blockerEv,
              reportedBy: _fromLeadRequest ? 'lead/subagent' : 'chief_review',
            },
            popup: true,
            urgency: 'high',
          })
          if (sug) {
            ws.suggestions.push(sug)
            if (ws.suggestions.length > SUGGESTIONS_CAP) ws.suggestions = ws.suggestions.slice(-SUGGESTIONS_CAP)
            proposedWallRemovals.push(sug)
            actionBadges.push(`⚠️ 请示拆墙：${clamp(matchedWall.title, 18)}`)
            pushAuditToWs(ws, {
              mode: permissionMode,
              stage: 'guard_wall',
              rule: 'wall_removal_requested',
              decision: 'pending_approval',
              operation: '参谋呈报人工审批拆墙',
              target: `${matchedWall.title} (${matchedWall.id})`,
              reason: clamp(removeReason, 180),
              outcome: 'pending',
              by: 'chief',
            }, rootId)
          }
        }
      }
    }
    for (const rawInq of rawInquiries) {
      if (!rawInq || typeof rawInq !== 'object') continue
      const qText = cleanMultiline(rawInq.question || rawInq.text || '', 500)
      if (!qText || secretLike(qText)) continue
      const inqTarget = clamp(rawInq.target || 'lead', 48) || 'lead'
      const inqTask = upsertTaskLedgerOnWs(ws, {
        kind: 'inquiry',
        status: 'awaiting_inquiry',
        originalText: `问询 @${inqTarget}：${qText}`,
        forcedTarget: inqTarget,
      })
      const inqItem = enqueueChiefInquiryOnWs(ws, {
        target: inqTarget,
        question: qText,
        context: cleanMultiline(rawInq.context || '', 240),
        taskId: inqTask ? inqTask.taskId : '',
      })
      if (inqItem) {
        createdInquiries.push(inqItem)
        if (inqTask) {
          upsertTaskLedgerOnWs(ws, {
            id: inqTask.taskId,
            taskId: inqTask.taskId,
            kind: 'inquiry',
            status: 'awaiting_inquiry',
            originalText: inqTask.originalText,
            inquiryId: inqItem.inquiryId,
          })
        }
        actionBadges.push(`⚡ 问询 @${inqItem.target} #${inqItem.inquiryId}`)
      }
    }

    if (systemGate.decision === 'allow' || systemGate.decision === 'allow_approved') {
      const activeCluster = getLinkedCluster(s, rootId)
      appliedFacts = applyFactChanges(ws, numberedFacts, parsed.memoryChanges, 'user', {
        originRootId: rootId,
        peerRootIds: activeCluster.filter(id => id !== rootId),
      })
      for (const f of appliedFacts) {
        actionBadges.push((f.op === 'add' ? '记入：' : f.op === 'edit' ? '修订：' : '移除：') + clamp(f.text, 24))
      }

      for (const rawWp of rawWallProposals) {
        if (!rawWp || typeof rawWp !== 'object') continue
        const mappedRuleType = rawWp.ruleType || rawWp.type
          || (rawWp.field === 'path' ? 'forbid_path' : (rawWp.field === 'command' ? 'forbid_cmd' : undefined))
        const wp = {
          ...rawWp,
          title: rawWp.title || rawWp.name || '',
          ...(mappedRuleType ? { ruleType: mappedRuleType } : {}),
          patterns: rawWp.patterns || rawWp.pattern || rawWp.rules,
        }
        const val = validateGuardWallInput(wp, { cwd: cwdForWall })
        if (!val || !val.ok || !val.wall) continue
        if (secretLike(val.wall.title) || val.wall.patterns.some(p => secretLike(p))) continue
        const dupPendingWall = ws.suggestions.some(
          existing => existing
            && existing.status === 'pending'
            && existing.kind === 'guard_wall'
            && existing.wallSpec
            && existing.wallSpec.title === val.wall.title,
        )
        if (dupPendingWall) continue
        const sug = normalizeSuggestion({
          kind: 'guard_wall',
          fromAgent: '🧱 参谋长筑墙提案',
          title: `拟筑物理墙：${clamp(val.wall.title, 30)}`,
          reason: clamp(val.wall.reason || '事前硬拦截高危命令或敏感路径，确认后写入 guard-walls 持久落锁。', 180),
          target: 'guard_walls',
          targetLabel: val.wall.scope === 'workspace' ? '📁 本工程驻墙' : '🌐 全局随身驻墙',
          mode: 'silent',
          draftText: `[${val.wall.ruleType}] ${val.wall.patterns.join(', ')}`,
          wallSpec: val.wall,
        })
        if (sug) {
          ws.suggestions.push(sug)
          if (ws.suggestions.length > SUGGESTIONS_CAP) ws.suggestions = ws.suggestions.slice(-SUGGESTIONS_CAP)
          proposedWalls.push(sug)
          actionBadges.push(`🧱 呈批驻墙：${clamp(val.wall.title, 18)}`)
        }
      }

      for (const rawBp of rawBoundProposals) {
        if (!rawBp) continue
        const bp = typeof rawBp === 'string'
          ? { field: 'forbidden', item: rawBp, reason: '根据会话上下文提炼的工作边界，请拍板注入。' }
          : rawBp
        if (!bp || typeof bp !== 'object') continue
        const rawBpField = String(bp.field || '').trim().toLowerCase()
        const normBpField = rawBpField === 'must' ? 'allowed' : rawBpField
        const col = ['forbidden', 'allowed', 'notes'].includes(normBpField) ? normBpField : 'forbidden'
        const itemText = clamp(bp.item || bp.rule || bp.content || bp.draftText || bp.text || '', 220)
        if (!itemText || secretLike(itemText)) continue
        const replaces = Array.isArray(bp.replaces)
          ? bp.replaces.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim().slice(0, 240)).slice(0, 20)
          : []
        const colExisting = Array.isArray(existingBounds[col]) ? existingBounds[col] : []
        if (!replaces.length && colExisting.some(x => String(x).trim() === itemText)) continue
        const dupPending = ws.suggestions.some(
          existing => existing.status === 'pending' && existing.kind === 'bound' && existing.draftText === itemText,
        )
        if (dupPending) continue
        const colLabel = BOUND_COL_LABEL[col] || '禁止红线'
        const hadPinnedInReplaces = replaces.some(r => ((board.pinnedBounds && board.pinnedBounds[col]) || []).includes(r))
        const sug = normalizeSuggestion({
          kind: 'bound',
          boundField: col,
          fromAgent: replaces.length ? '✦ 参谋长浓缩' : '✦ 参谋长提炼',
          title: replaces.length
            ? `${colLabel} ${replaces.length} 合 1：${clamp(itemText, 26)}`
            : `拟入${colLabel}：${clamp(itemText, 30)}`,
          reason: clamp(
            bp.reason || (replaces.length
              ? `将 ${replaces.length} 条零散边界浓缩合成为 1 条，请拍板替换。`
              : '根据会话上下文总结的工作边界，请拍板注入。'),
            180,
          ),
          target: 'bounds',
          targetLabel: colLabel,
          mode: 'silent',
          draftText: itemText,
          replaces,
          pinGlobal: Boolean(bp.pinGlobal) || hadPinnedInReplaces,
        })
        if (sug) {
          ws.suggestions.push(sug)
          proposedBounds.push(sug)
          actionBadges.push(`${replaces.length ? '浓缩' : '呈批'}${colLabel}：${clamp(itemText, 18)}`)
        }
      }
    }

    for (const rawSug of [...pendingArchiveSuggestions, ...pendingEffortSuggestions]) {
      const sug = normalizeSuggestion(rawSug)
      if (!sug) continue
      const dup = ws.suggestions.some(ex => ex && ex.status === 'pending' && ex.kind === sug.kind && ex.title === sug.title)
      if (!dup) {
        ws.suggestions.push(sug)
        if (ws.suggestions.length > SUGGESTIONS_CAP) ws.suggestions = ws.suggestions.slice(-SUGGESTIONS_CAP)
      }
    }

    persistTurnChatAndResume(ws, {
      chiefText: replyText,
      actions: actionBadges,
      elevationObj: finalElevation,
      pendingApprovalList: queuedApprovals,
      thinkingEffort: llmRes.thinkingEffort || '',
      thinkingEffortMode: llmRes.thinkingEffortMode || effCfg.thinkingEffort || 'auto',
      forceReceipt: Boolean(
        relayResults.length > 0
        || createdInquiries.length > 0
        || proposedWalls.length > 0
        || proposedWallRemovals.length > 0
        || appliedFacts.length > 0
        || executedBoardOps.length > 0
        || executedArchiveOps.length > 0
        || executedEffortOps.length > 0
        || executedNetworkOps.length > 0
        || loopToolRecords.some(r => {
          const tName = r && ((r.call && (r.call.tool || r.call.name)) || (r.result && r.result.tool) || r.tool || '')
          return Boolean(tName && getToolOpClass(tName) !== 'read')
        })
      ),
    })
  })

  // Gently wake idle lead/peer for queued inquiries (if currently running, agent/pre-step picks them up without interruption)
  if (createdInquiries.length > 0 && deps && deps.runtime && typeof deps.runtime.get === 'function') {
    const agentsSvc = deps.runtime.get('agents')
    const leadAgent = agentsSvc && typeof agentsSvc.get === 'function' ? agentsSvc.get(rootId) : null
    if (leadAgent && leadAgent.status && leadAgent.status !== 'running') {
      for (const inqItem of createdInquiries) {
        if (!/^(?:lead|主对话)$/i.test(inqItem.target || 'lead')) continue
        try {
          const nudgeRes = await deliverCrossMessage(deps, {
            fromSession: rootId,
            fromLabel: 'DSH 参谋长 (优先问询)',
            target: inqItem.target || 'lead',
            subject: `#${inqItem.inquiryId}`,
            text: `${inqItem.question}${inqItem.context ? `\n背景：${inqItem.context}` : ''}\n请调用 chief_board({ action: "inquiry.reply", inquiryId: "${inqItem.inquiryId}", text: "..." }) 原路回传，无需中断原计划。`,
            mode: 'followup',
            envelopeKind: 'inquiry',
            taskId: inqItem.inquiryId,
            recordBoardLog: false,
          })
          if (nudgeRes && nudgeRes.deliveredPhysical) {
            mutateChiefState((s) => {
              const ws = ensureWorkspace(s, rootId)
              const rec = Array.isArray(ws.inquiries) && ws.inquiries.find(q => q && q.inquiryId === inqItem.inquiryId)
              if (rec && rec.status === 'pending') {
                rec.status = 'delivered'
                rec.deliveredAt = Date.now()
              }
            })
          }
        } catch {}
      }
    }
  }

  // Refresh narrative summary in background if facts, board, archives, or network changed (plus 60s debounced opportunistic refresh on user chat)
  const shouldRefreshNarrative = appliedFacts.length > 0
    || executedBoardOps.length > 0
    || executedArchiveOps.length > 0
    || executedNetworkOps.length > 0
  const freshView = await getChiefView(deps, rootId, {
    autoSummarize: shouldRefreshNarrative,
    chatTriggered: !_fromLeadRequest,
  })
  const freshBoard = executedBoardOps.length > 0 && deps.boardForSession && deps.boardFileFor
    ? deps.boardForSession(deps.boardFileFor(rootId))
    : undefined
  let freshArchives
  if (executedArchiveOps.length > 0) {
    try {
      const sc = rootId && rootId !== 'global' ? 'session' : 'global'
      const opt = archiveTargetForRoot(deps, rootId, { vaultScope: sc })
      const flIds = (freshView && freshView.flippedPrecipitatedIds) || []
      freshArchives = listArchiveHeaders(rootId, { vaultScope: sc, includePrecipitated: true, flippedIds: flIds }, opt)
    } catch {}
  }

  return {
    ok: true,
    reply: replyText,
    relays: relayResults,
    inquiries: createdInquiries,
    wallProposals: proposedWalls,
    wallRemovalProposals: proposedWallRemovals,
    actionBadges,
    memoryChanges: appliedFacts,
    boardOps: executedBoardOps,
    archiveOps: executedArchiveOps,
    effortOps: executedEffortOps,
    networkOps: executedNetworkOps,
    boundProposals: proposedBounds,
    toolRecords: loopToolRecords,
    pendingApprovals: queuedApprovals,
    thinkingEffort: llmRes.thinkingEffort || '',
    thinkingEffortMode: llmRes.thinkingEffortMode || effCfg.thinkingEffort || 'auto',
    ...(finalElevation ? { elevationRequested: finalElevation } : {}),
    permissionMode,
    ...(freshBoard ? { board: freshBoard } : {}),
    ...(freshArchives ? { archives: freshArchives } : {}),
    view: freshView,
  }
}

function describeThreePartyBoundariesForPrompt(permissionMode) {
  const mode = normalizePermissionMode(permissionMode)
  if (mode === 'advisor') {
    return '- 四级权限当前档 [L0 · 顾问模式 READ ONLY · 默认模式]：仅允许读取看板与允许访问的项目状态、分析与建言；严禁修改工作区文件、运行系统命令、修改参谋系统或调整主对话/子代理工作流（需要时可调用 request_permission_elevation 申请提权）。'
  }
  if (mode === 'assistant') {
    return '- 四级权限当前档 [L1 · 助手模式 ASSISTANT]：允许只读查证项目，并自主维护参谋系统（记忆、档案柜、看板配置、边界呈批）；严禁直接修改项目工作区或接管主对话/子代理工作流（需要时可申请提权至 L2/L3）。'
  }
  if (mode === 'strategist') {
    return '- 四级权限当前档 [L2 · 参谋模式 ADVISOR WITH APPROVAL · 逐项授权]：可自主维护参谋系统；涉及修改工作区文件、执行系统命令或调整主对话/子代理工作流时，每项受控操作均会弹窗等待用户逐项点击「允许本次操作」后方可执行。'
  }
  return '- 四级权限当前档 [L3 · 参谋长模式 CHIEF OF STAFF · 主动风险知悉]：已获用户勾选确认风险，允许在安全卫兵硬性规则与禁止红线护栏内直接读写工作区、执行命令、切换或协调主对话及子代理工作流并完成维护与压缩。'
}

/**
 * Prime Minister Boundary Proposal API (`chief_board` action `"bounds.propose"`).
 * Lead or subagents submit wall-hits / boundary lessons here instead of silently mutating global bounds;
 * DSH Chief curates them and prompts the user for approval before injecting into `board.bounds`.
 */
export function proposeBoundToChief(deps, { sessionId, callerAgent, by, field, item, items, reason }) {
  const sid = String(sessionId || (callerAgent && callerAgent.id) || '').trim()
  const rootId = (deps.resolveRootSessionId && deps.resolveRootSessionId(sid, callerAgent)) || sid || 'global'
  const identity = deps.resolveAgentIdentity ? deps.resolveAgentIdentity(deps.runtime, sid, callerAgent) : null
  const speaker = identity && identity.isChild
    ? `@${identity.self}`
    : (by && by !== 'agent' ? String(by) : '@lead')

  const rawCol = String(field || '').trim().toLowerCase()
  const normCol = rawCol === 'must' ? 'allowed' : rawCol
  const col = ['forbidden', 'allowed', 'notes'].includes(normCol) ? normCol : 'forbidden'
  const BOUND_COL_LABEL = { forbidden: '禁止红线', allowed: '必做事项', notes: '注意事项' }
  const colLabel = BOUND_COL_LABEL[col] || '禁止红线'

  const rawItems = []
  if (typeof item === 'string' && item.trim()) rawItems.push(item.trim())
  if (Array.isArray(items)) {
    for (const entry of items) {
      if (typeof entry === 'string' && entry.trim()) rawItems.push(entry.trim())
    }
  }
  if (!rawItems.length) {
    return { ok: false, error: 'bounds.propose requires item (string) or items (string[])' }
  }

  const board = deps.boardForSession && deps.boardFileFor && rootId !== 'global'
    ? deps.boardForSession(deps.boardFileFor(rootId))
    : null
  const existingCol = Array.isArray(board?.bounds?.[col]) ? board.bounds[col] : []

  const proposed = []
  const skippedDuplicates = []

  mutateChiefState((state) => {
    const ws = ensureWorkspace(state, rootId)
    for (const rawRule of rawItems.slice(0, 6)) {
      const ruleText = clamp(rawRule, 220)
      if (!ruleText || secretLike(ruleText)) continue
      if (existingCol.some(x => String(x).trim() === ruleText)) {
        skippedDuplicates.push(ruleText)
        continue
      }
      const dupPending = ws.suggestions.some(
        s => s.status === 'pending' && s.kind === 'bound' && s.draftText === ruleText,
      )
      if (dupPending) {
        skippedDuplicates.push(ruleText)
        continue
      }
      const sug = normalizeSuggestion({
        kind: 'bound',
        boundField: col,
        fromAgent: speaker,
        title: `拟入${colLabel}：${clamp(ruleText, 30)}`,
        reason: clamp(reason || `${speaker} 在执行中上报的边界约束，请批准后注入全局边界。`, 180),
        target: 'bounds',
        targetLabel: colLabel,
        mode: 'silent',
        draftText: ruleText,
      })
      if (sug) {
        const pendingNonBound = ws.suggestions.filter(s => s.status === 'pending' && s.kind !== 'bound')
        const pendingAll = ws.suggestions.filter(s => s.status === 'pending')
        if (pendingAll.length >= SUGGESTIONS_CAP && pendingNonBound.length > 0) {
          pendingNonBound[0].status = 'dismissed'
        }
        ws.suggestions.push(sug)
        proposed.push(sug)
      }
    }
  })

  if (proposed.length && typeof deps.appendBoardLog === 'function' && rootId !== 'global') {
    deps.appendBoardLog(
      rootId,
      `🏛 收到边界奏请 (${colLabel})：${proposed.map(p => clamp(p.draftText, 40)).join('；')}`,
      speaker,
    )
  }

  return {
    ok: true,
    proposed: proposed.map(p => ({ id: p.id, field: p.boundField, item: p.draftText, from: p.fromAgent })),
    skippedDuplicates,
    message: proposed.length
      ? `已呈交 DSH 参谋长（共 ${proposed.length} 条），参谋长正请示用户批准后注入全局【${colLabel}】。`
      : '该边界已在全局边界或待批请示列表中，无需重复上报。',
  }
}

/* -------------------------------------------------------------------------- */
/* Post-Turn Silent Review & Proactive Suggestion Pills                       */
/* -------------------------------------------------------------------------- */

const OBJECTIVE_SUGGEST_SYSTEM = [
  '你是「DSH 参谋长」（宰相级总目标顾问）。用户正准备开启「主动强介入模式」，需要锁定一条「核心目标」作为所有后续参谋介入判断与验收的唯一最终目的地。',
  '有两种协作模式，请严格遵循：',
  '1. `mode = "refine"`（微调已有文字）：输入框中已有用户自己写下的核心目标草案。你必须在**严格尊重保留用户原有核心意图、主语、约束和具象锚点**的前提下，将其微调润色为一条表述更凝练、验收标准更清晰、适合强介入持续核验的一句话核心目标（不超过 120 字），严禁推翻或另起炉灶。',
  '2. `mode = "guess"`（建议 / 反复揣摩用户意图）：用户未填写核心目标，或认为上一轮建议还不够贴切并**继续点击「建议」让你重新猜**。请综合当前主对话与子代理实时流、最新用户原始诉求、小任务板（Plan）、任务表、必做事项与近期结论，猜出用户此刻最核心的真实落地目标；**严禁与 `已给过的建议列表 (previousSuggestions)` 重复或仅换一两个虚词**，每次重猜都应尝试更贴合场景、不同切入维度或更具体可验收的表述（不超过 120 字）。',
  '',
  '只输出一个合法 JSON 对象：',
  '{',
  '  "suggestion": "建议或微调后的核心目标一句话（≤120字，不要加引号或序号）",',
  '  "rationale": "一句简明大白话说明为何这样拟定/微调（≤55字）"',
  '}',
].join('\n')

/**
 * Suggest (with repeated intent guessing) or micro-tune an existing draft Core Objective
 * when enabling Strong Intervention mode.
 */
export async function suggestCoreObjectiveWithChief(deps, {
  sessionId = '',
  draft = '',
  mode = 'auto',
  previousSuggestions = [],
} = {}) {
  const rootId = (deps && typeof deps.resolveRootSessionId === 'function' ? deps.resolveRootSessionId(sessionId) : sessionId) || String(sessionId || 'global')
  const rawDraft = String(draft || '').replace(/\s+/g, ' ').trim()
  const prevList = (Array.isArray(previousSuggestions) ? previousSuggestions : [])
    .map(x => String(x || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(-12)

  const normalizedDraft = rawDraft.toLowerCase()
  const isCycleOfPreviousAi = Boolean(
    rawDraft && prevList.some(p => p.toLowerCase() === normalizedDraft),
  )
  const effectiveMode = (mode === 'refine' || (mode === 'auto' && rawDraft && !isCycleOfPreviousAi))
    ? 'refine'
    : 'guess'

  const directory = await listPeerDirectory(deps, rootId)
  const board = deps && deps.boardForSession && deps.boardFileFor
    ? deps.boardForSession(deps.boardFileFor(rootId))
    : null
  const liveDigest = collectLiveConversationsDigest(deps, rootId, directory)
  const state = loadChiefState()
  const view = clusterView(state, rootId)
  const numberedFacts = view.facts.slice(-8)
  const planSteps = Array.isArray(board && board.plan) ? board.plan.filter(Boolean) : []
  const openPlan = planSteps.filter(s => !s.done)
  const tasks = Array.isArray(board && board.tasks) ? board.tasks : []
  const activeTasks = tasks.filter(t => t && (t.status === 'doing' || t.status === 'todo' || t.status === 'blocked'))
  const bounds = (board && board.bounds) || { allowed: [], forbidden: [], notes: [] }
  const leadEntry = (liveDigest.entries || []).find(e => e.kind === 'lead') || (liveDigest.entries || [])[0] || null
  const latestUser = (leadEntry && leadEntry.lastUser) ? leadEntry.lastUser : ''
  const existingObj = board && board.objective ? String(board.objective).trim() : ''

  // Build non-repeating deterministic fallback candidates ordered by attempt index
  const buildFallbackCandidate = () => {
    if (effectiveMode === 'refine' && rawDraft) {
      const cleanDraft = clamp(rawDraft.replace(/[。；;]+$/, ''), 96)
      const refined = /完成|实现|通过|验证|修复|交付|生成|输出/.test(cleanDraft)
        ? `${cleanDraft}，确保可实测验收后收尾`
        : `完成「${cleanDraft}」并完成实测核验`
      return {
        suggestion: clamp(refined, 120),
        rationale: '已保留您原有核心意图，并补充清晰的可验收收口标准。',
      }
    }

    const candidates = []
    if (latestUser) {
      candidates.push({
        suggestion: clamp(`彻底完成用户当前诉求「${clamp(latestUser, 72)}」并经实测核验交付`, 120),
        rationale: '根据主对话最近一次真实诉求提炼的核心目标。',
      })
    }
    if (openPlan.length > 0) {
      candidates.push({
        suggestion: clamp(`按小任务板推进完成：${openPlan.slice(0, 2).map(s => clamp(s.text, 38)).join(' → ')}`, 120),
        rationale: '聚焦小任务板当前尚未勾选的待办节点。',
      })
    }
    if (activeTasks.length > 0) {
      candidates.push({
        suggestion: clamp(`攻克在手关键任务（${activeTasks.slice(0, 2).map(t => clamp(t.title, 36)).join('、')}）并通过验证`, 120),
        rationale: '围绕目前推进中与待办的核心任务收敛目标。',
      })
    }
    if (existingObj) {
      candidates.push({
        suggestion: clamp(`${existingObj.replace(/[。；;]+$/, '')}，完成全部必做事项与实证验收`, 120),
        rationale: '在当前规划核心目标基础上强化完结验收基准。',
      })
    }
    if (bounds.allowed && bounds.allowed.length > 0) {
      candidates.push({
        suggestion: clamp(`推进完成本轮主线研发与交付（必做：${clamp(bounds.allowed[0], 55)}）`, 120),
        rationale: '结合当前必做事项清单拟定的可监督落地目标。',
      })
    }
    if (leadEntry && leadEntry.lastAssistant) {
      candidates.push({
        suggestion: clamp(`收口当前主线工作（${clamp(leadEntry.lastAssistant, 68)}）并验证通过`, 120),
        rationale: '结合主对话最新工作现场推断的收尾目标。',
      })
    }
    candidates.push(
      {
        suggestion: '完整实现本轮设定功能需求、完成自测校验并清晰交付最终结果',
        rationale: '通用端到端实现与实测交付目标。',
      },
      {
        suggestion: '排查解决当前阻断卡点与遗留缺陷，确保系统运行稳定并通过复测',
        rationale: '偏向排查修复与稳定收口的兜底目标。',
      },
    )

    const prevNormSet = new Set(prevList.map(x => x.toLowerCase()))
    const chosen = candidates.find(c => !prevNormSet.has(String(c.suggestion || '').toLowerCase()))
      || candidates[prevList.length % candidates.length]
    return chosen
  }

  const promptLines = [
    `当前执行模式: ${effectiveMode === 'refine' ? 'refine（在用户已有核心目标文字上微调润色）' : 'guess（结合现场上下文猜想用户想要的核心目标，允许反复点建议继续猜）'}`,
    `工作区当前已填核心目标: ${existingObj || '（空）'}`,
    ...(rawDraft ? [`用户输入框当前文字: ${rawDraft}`] : ['用户输入框当前文字: （空）']),
    ...(prevList.length > 0 ? [`已给过的建议（严禁重复或仅微调措辞，须从新角度继续猜）:\n${prevList.map((p, i) => `  ${i + 1}. ${p}`).join('\n')}`] : []),
    `主对话最近用户原始诉求: ${latestUser || '（暂未捕捉）'}`,
    `小任务板 (Plan) 未完步骤: ${openPlan.slice(0, 4).map(s => clamp(s.text, 60)).join('；') || '（无）'}`,
    `在手任务 (doing/blocked/todo): ${activeTasks.slice(0, 5).map(t => `[${t.status}] ${clamp(t.title, 48)}`).join('；') || '（无）'}`,
    `必做事项 (allowed): ${(bounds.allowed || []).slice(0, 4).join('；') || '（无）'}`,
    `禁止红线 (forbidden): ${(bounds.forbidden || []).slice(0, 4).join('；') || '（无）'}`,
    `主对话现场摘要: ${leadEntry ? clamp(leadEntry.lastAssistant || '', 260) : '（无）'}`,
    ...(numberedFacts.length ? [`近期重要结论: ${numberedFacts.slice(-4).map(f => clamp(f.text, 90)).join('；')}`] : []),
  ]

  let suggestion = ''
  let rationale = ''
  let llmUsed = false

  try {
    const llmRes = await callChiefLlm(deps, {
      sessionId: rootId,
      system: OBJECTIVE_SUGGEST_SYSTEM,
      prompt: promptLines.join('\n'),
      maxTokens: 320,
    })
    if (llmRes && llmRes.ok && llmRes.text) {
      const parsed = extractJsonObject(llmRes.text)
      if (parsed && typeof parsed.suggestion === 'string' && parsed.suggestion.trim()) {
        const cleaned = cleanMultiline(stripToolCallMarkup(parsed.suggestion), 160).replace(/\s+/g, ' ').trim()
        const isDuplicateGuess = effectiveMode === 'guess' && prevList.some(p => p.toLowerCase() === cleaned.toLowerCase())
        if (cleaned && !isDuplicateGuess) {
          suggestion = clamp(cleaned, 120)
          rationale = clamp(String(parsed.rationale || '').trim(), 90)
          llmUsed = true
        }
      }
    }
  } catch {}

  if (!suggestion) {
    const fb = buildFallbackCandidate()
    suggestion = fb.suggestion
    rationale = fb.rationale
  }

  return {
    ok: true,
    suggestion,
    rationale: rationale || (effectiveMode === 'refine' ? '已在您原文基础上完成微调。' : '已结合当前对话态势为您揣摩建议。'),
    mode: effectiveMode,
    llmUsed,
  }
}

/**
 * Lead-to-Chief direct communication handler (`chief.request` / `mail.send({ target: 'chief' })`).
 * Applies L0–L3 permission-tiered handling so Lead requests either queue advice + elevation (L0/L1),
 * queue one-click user approval (L2), or execute & reply directly via Chief (L3).
 */
export async function handleLeadDirectRequestToChief(deps, {
  fromSession = '',
  fromLabel = '主对话 (@lead)',
  subject = '',
  text = '',
} = {}) {
  const cleanBody = cleanMultiline(text, 2400)
  if (!cleanBody) return { ok: false, error: '传话给参谋长的内容不能为空' }
  const rootId = (deps && typeof deps.resolveRootSessionId === 'function' ? deps.resolveRootSessionId(fromSession) : '') || String(fromSession || 'global')
  const state = loadChiefState()
  const ownWs = ensureWorkspace(state, rootId)
  const effCfg = resolveWorkspaceConfig(state, rootId)
  const hasChiefRiskAck = hasValidChiefRiskAck(ownWs)
  const permissionMode = normalizePermissionMode(effCfg.permissionMode || DEFAULT_CHIEF_PERMISSION_MODE, {
    requireAck: true,
    hasChiefRiskAck,
  })
  const permRank = permissionRank(permissionMode)
  const summaryTitle = clamp(subject || cleanBody, 48)
  let ledgerTaskId = ''

  // Rare path: Lead / Subagent reports an insurmountable dynamic guard-wall blocker -> read-only Chief evaluation first; any wall removal still requires explicit human approval across L0-L3
  const combinedReqText = `${subject || ''} ${cleanBody}`
  const isWallBlockerEscalation = /(?:撞墙阻断|物理驻墙|物理墙|无法绕过|事前物理拦截|guard_wall|wall-[a-z0-9]+)/i.test(combinedReqText)
  if (isWallBlockerEscalation) {
    const cwdNow = resolveSessionWorkspaceCwd(deps, rootId)
    const activeWallsNow = listGuardWalls({ cwd: cwdNow }).filter(w => w && w.scope !== 'paused')
    if (activeWallsNow.length > 0) {
      const evalRes = await askOrCommandChief(deps, {
        sessionId: rootId,
        text: `[来自 ${fromLabel} 的撞墙阻断上报 · ${subject || '物理墙评估'}]\n${cleanBody}`,
        _fromLeadRequest: true,
        _wallBlockerEscalation: true,
      })
      if (evalRes && Array.isArray(evalRes.wallRemovalProposals) && evalRes.wallRemovalProposals.length > 0) {
        return {
          ok: true,
          mode: permissionMode,
          actionTaken: 'wall_removal_requested',
          wallRemovalProposals: evalRes.wallRemovalProposals,
          reply: evalRes.reply || '',
          ...(evalRes.view ? { view: evalRes.view } : {}),
        }
      }
    }
  }

  mutateChiefState((s) => {
    const ws = ensureWorkspace(s, rootId)
    const entry = upsertTaskLedgerOnWs(ws, {
      kind: permRank < 2 ? 'elevation_resume' : (permRank === 2 ? 'approval_resume' : 'tool_execution'),
      status: permRank < 2 ? 'awaiting_elevation' : (permRank === 2 ? 'awaiting_approval' : 'running'),
      originalText: `[主对话直传求助 · ${fromLabel}] ${subject ? subject + '：' : ''}${cleanBody}`,
      forcedTarget: 'lead',
      lastReceipt: `收到 ${fromLabel} 直传协同请求，按 ${permissionMode} 权限处置中`,
    })
    if (entry) ledgerTaskId = entry.taskId
  })

  // L0 (advisor) / L1 (assistant): queue readable advice + optional elevation request (never mutate workspace directly)
  if (permRank < 2) {
    const elv = requestChiefElevation(rootId, {
      fromMode: permissionMode,
      targetMode: 'strategist',
      reason: `主对话（${fromLabel}）请求参谋长协同处置：${clamp(subject || cleanBody, 90)}`,
      requestedActionSummary: clamp(cleanBody, 160),
      by: 'chief',
    })
    mutateChiefState((s) => {
      const ws = ensureWorkspace(s, rootId)
      const sug = normalizeSuggestion({
        kind: 'advice',
        fromAgent: '📨 主对话直传求助',
        title: `参谋建议 · 响应主对话：${clamp(summaryTitle, 32)}`,
        reason: `主对话主动发起协同请示（当前 ${CHIEF_PERMISSION_META[permissionMode]?.level || permissionMode} 只读/参谋档），请您拍板或批准升档执行。`,
        target: 'lead',
        targetLabel: '主对话 (@lead)',
        mode: 'followup',
        draftText: clamp(`关于「${subject || '协同请求'}」的参谋建议：请先评估影响范围与验证方案；如已批准升档，我可进一步协调执行。原请求：${cleanBody}`, 420),
      })
      if (sug) {
        ws.suggestions.push(sug)
        if (ws.suggestions.length > SUGGESTIONS_CAP) ws.suggestions = ws.suggestions.slice(-SUGGESTIONS_CAP)
      }
      if (ledgerTaskId) {
        upsertTaskLedgerOnWs(ws, {
          id: ledgerTaskId,
          taskId: ledgerTaskId,
          kind: 'elevation_resume',
          status: 'awaiting_elevation',
          originalText: `[主对话直传求助 · ${fromLabel}] ${cleanBody}`,
          elevationId: elv ? elv.id : '',
          lastReceipt: `已生成参谋建议${elv ? '并发起 L2 提权请示' : ''}`,
        })
      }
      ws.chat.push({
        id: nextId('chat'),
        role: 'chief',
        kind: 'receipt',
        text: [
          `- 【📨 收到主对话直传请求（当前 ${CHIEF_PERMISSION_META[permissionMode]?.level || permissionMode}）】来自 ${fromLabel}${subject ? ` · ${subject}` : ''}`,
          `- 【请求摘要】${clamp(cleanBody, 220)}`,
          `- 【处置结果】已生成参谋建议并${elv ? '向您发起「🔐 升至 L2 · 参谋模式」提权请示' : '记入建议栏'}；您拍板或提权后即可向主对话投递执行批复。`,
        ].join('\n'),
        actions: ['主对话直传求助', ...(elv ? ['🔐 请示提权 L2'] : ['💡 已呈报建议'])],
        at: Date.now(),
      })
      if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
    })
    return {
      ok: true,
      mode: permissionMode,
      actionTaken: 'suggested_or_elevation_requested',
      taskId: ledgerTaskId,
      ...(elv ? { elevationRequested: elv } : {}),
    }
  }

  // L2 (strategist): queue actionable approval & suggestion for one-click human confirmation
  if (permRank === 2) {
    const replyDraft = `已核准来自主对话的协同请求（${subject || '协同处理'}）：请按约定继续推进，并在完成后提交验证证据。`
    const apr = queueChiefApproval(rootId, {
      category: 'main_workflow',
      operationLabel: '响应主对话直接协同请求',
      targetLabel: '主对话 (@lead)',
      reason: clamp(subject || '主对话请求参谋长协同处置', 140),
      impact: '点击「允许本次操作」后，将向主对话投递参谋协同批复执行请求',
      preview: clamp(cleanBody, 240),
      kind: 'relay',
      capabilityScope: buildCapabilityScope({ kind: 'relay', tool: 'relay', target: 'lead' }),
      payload: {
        fromSession: rootId,
        fromLabel: 'DSH 参谋 (获批响应主对话)',
        target: 'lead',
        subject: subject || '参谋协同批复',
        text: replyDraft,
        mode: 'steer',
        envelopeKind: 'execution_request',
        taskId: ledgerTaskId,
      },
      by: 'chief',
    })
    mutateChiefState((s) => {
      const ws = ensureWorkspace(s, rootId)
      const sug = normalizeSuggestion({
        kind: 'relay',
        fromAgent: '📨 主对话直传求助',
        title: `批复主对话：${clamp(summaryTitle, 32)}`,
        reason: 'L2 参谋模式下已挂入逐项授权弹窗，也可直接点击上方「执行建议」批准投递。',
        target: 'lead',
        targetLabel: '主对话 (@lead)',
        mode: 'steer',
        draftText: replyDraft,
      })
      if (sug) {
        ws.suggestions.push(sug)
        if (ws.suggestions.length > SUGGESTIONS_CAP) ws.suggestions = ws.suggestions.slice(-SUGGESTIONS_CAP)
      }
      if (ledgerTaskId) {
        upsertTaskLedgerOnWs(ws, {
          id: ledgerTaskId,
          taskId: ledgerTaskId,
          kind: 'approval_resume',
          status: 'awaiting_approval',
          originalText: `[主对话直传求助 · ${fromLabel}] ${cleanBody}`,
          pendingApprovalIds: apr ? [apr.id] : [],
          lastReceipt: '已挂入 L2 待确认审批与参谋建议',
        })
      }
      ws.chat.push({
        id: nextId('chat'),
        role: 'chief',
        kind: 'receipt',
        text: [
          `- 【📨 收到主对话直传请求（L2 · 参谋逐项授权）】来自 ${fromLabel}${subject ? ` · ${subject}` : ''}`,
          `- 【请求摘要】${clamp(cleanBody, 220)}`,
          `- 【处置结果】已生成待确认动作${apr ? `（#${apr.id}）` : ''}并弹出授权提示，您确认后将立刻投递给主对话。`,
        ].join('\n'),
        actions: ['主对话直传求助', '🛡️ 待逐项确认'],
        at: Date.now(),
      })
      if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
    })
    return {
      ok: true,
      mode: 'strategist',
      actionTaken: 'queued_for_approval',
      taskId: ledgerTaskId,
      approval: apr,
    }
  }

  // L3 (chief): directly run Chief handling & reply back to @lead via execution_request
  const execRes = await askOrCommandChief(deps, {
    sessionId: rootId,
    text: `[来自 ${fromLabel} 的直接协同请求${subject ? ` · ${subject}` : ''}]\n${cleanBody}`,
    _fromLeadRequest: true,
  })
  const alreadyRelayed = Boolean(execRes && Array.isArray(execRes.relays) && execRes.relays.some(r => r && r.ok))
  if (!alreadyRelayed && execRes && execRes.reply) {
    try {
      await deliverCrossMessage(deps, {
        fromSession: rootId,
        fromLabel: 'DSH 参谋长 (L3 协同批复)',
        target: 'lead',
        subject: subject || '参谋长协同批复',
        text: execRes.reply,
        mode: 'steer',
        envelopeKind: 'execution_request',
        taskId: ledgerTaskId,
      })
    } catch {}
  }
  mutateChiefState((s) => {
    const ws = ensureWorkspace(s, rootId)
    if (ledgerTaskId) {
      upsertTaskLedgerOnWs(ws, {
        id: ledgerTaskId,
        taskId: ledgerTaskId,
        kind: 'tool_execution',
        status: execRes && execRes.ok === false ? 'failed' : 'completed',
        originalText: `[主对话直传求助 · ${fromLabel}] ${cleanBody}`,
        lastReceipt: clamp((execRes && (execRes.reply || execRes.error)) || 'L3 参谋长已完成处置', 220),
        resolvedAt: Date.now(),
      })
    }
  })
  return {
    ok: Boolean(execRes && execRes.ok !== false),
    mode: 'chief',
    actionTaken: 'executed_directly',
    taskId: ledgerTaskId,
    reply: (execRes && execRes.reply) || '',
    ...(execRes && execRes.view ? { view: execRes.view } : {}),
  }
}

registerChiefDirectRequestHook(handleLeadDirectRequestToChief)

