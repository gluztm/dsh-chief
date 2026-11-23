/**
 * command-helpers.js — 参谋命令提示词模板、离线确定性兜底回复与会话摘要构建器
 *
 * 【核心职责】
 *   集中提供 `askOrCommandChief` 与 `command-ops.js` 共用的系统提示词常数（`ASK_CHIEF_SYSTEM` 等）、
 *   三方职责边界说明、同组活会话摘要采集（`collectLiveConversationsDigest`）、
 *   纯状态问询/紧缩指令判定、离线智能兜底报告（`buildSmartFallbackReply`）与边界聚合纯算法。
 *
 * 【边界约定】
 *   - 仅依赖 `node:path`、`./chief-executor.js`（纯函数）、`./chief-state.js` 与 `./chief-view.js`，
 *     绝对不依赖 `chief-commands.js` 或 `command-ops.js`。
 */

import path from 'node:path'
import { normalizePermissionMode } from './chief-executor.js'
import {
  clamp,
  secretLike,
  shortAgentBriefName,
  stripCheckpointNoise,
  isInternalCheckpointNoise,
} from './chief-state.js'
import { buildConciseSixLineReport, summarizeSubagentsCompact } from './chief-view.js'

export const ASK_CHIEF_SYSTEM = [
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
  '    { "target": "成员 key 或名字（如 lead / 子代理名 / session-xxx / all / 或协同水泡中的外部工具 provider 如 claude-code、codex）", "mode": "steer|followup|silent", "subject": "简短事由", "text": "替用户转化好的清晰可执行执行请求" }',
  '  ],',
  '  "inquiries": [',
  '    { "target": "lead", "question": "缺情报时向主对话提出的优先问询（禁止凭空瞎猜）", "context": "简短问询背景" }',
  '  ],',
  '  "wallProposals": [',
  '    {',
  '      "title": "自定义拦截规则名称",',
  '      "scope": "global|workspace",',
  '      "ruleType": "forbid_path|restrict_write|forbid_cmd|require_approval_cmd|deny_tool",',
  '      "patterns": ["被锁路径前缀/目录名 或 禁跑命令正则"],',
  '      "writeOnly": false,',
  '      "reason": "添加这条自定义拦截规则的原因"',
  '    }',
  '  ],',
  '  "wallRemovalProposals": [',
  '    {',
  '      "wallId": "阻塞任务的自定义拦截规则 ID（必须精确匹配上下文清单中的 wallId，极低概率仅在确认无替代路时填写）",',
  '      "wallTitle": "对应自定义拦截规则名称",',
  '      "action": "pause|remove",',
  '      "blockerEvidence": "主/子代理命中拦截且确无绕过可能的实测证据（必填）",',
  '      "reason": "为何必须申请暂停/删除这条拦截规则才能继续当前任务"',
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
  '- 【懒介入与主会话优先铁律（严禁抢活越俎代庖）】：即使你已拥有高权限，也必须遏制亲自写代码或跑项目命令的冲动！凡是修改项目源码、跑构建测试、长程勘探排障，只要主对话在线可用且用户没有明确指定“参谋长你亲自来做/别找主对话”，一律优先放在 `"relays"` 中以正式执行请求形式交由 `@lead` 动手执行！只有用户点名直办、纯参谋内务（看板/档案/记忆/边界/拦截规则草案）或主对话失联卡死时才亲自调工具。',
  '- 【协同水泡与外部工具（Claude Code / Codex）差遣】：当用户要求调用外部工具（如让 Claude Code 审查、让 Codex 实现/重构）或水泡内已编入外部工具时，直接在 `"relays"` 中填写 `target="claude-code"` 或 `target="codex"` 与清晰可执行任务（系统将按当前 L0–L3 权限门禁审批/执行、自动附带禁止红线与自定义拦截规则并锁死水泡防误拆，完工后自动把回执写回信箱与对话）。',
  '- 【优先问询渠道（缺信息就问主对话，严禁瞎猜）】：无论是在自主调配还是回答用户问题时，只要缺乏代码细节或实时状态确认，请输出 `"inquiries"` 向 `@lead` 发出优先问询，主对话会在不打断手头动作的情况下原路快答。',
  '- 【生成自定义拦截规则与极低概率请示关闭】：\n  1) 当用户让你“筑一堵物理墙/加条拦截规则/锁死某个目录/禁跑某个高危命令”时，直接将大白话诉求编译成 `"wallProposals"`（跨会话常驻设 `"scope": "global"`），呈交用户一键确认落锁；\n  2) **关闭规则红线（极低触发）**：任何权限下（哪怕是 L3 最高权限）你都绝无权私改或绕过自定义拦截规则！仅当主代理或子代理真实撞墙并确认无法绕过、向你上报阻断情况，且你独立复核确认确因该条规则导致任务彻底无法推进、无合法替代路径时，才允许填入 `"wallRemovalProposals"` 向人类提交暂停/删除审批申请（内置安全防护硬规则永远不可申请拆除）；平时一切情形严禁主动填 `"wallRemovalProposals"`。',
  '- 【许愿框全权自治与三层档案隔离】：无论整理/分类/织钩/提炼档案入全局、`pin_to_desktop` 摆上认知桌面（2400 Tokens / 6 份上限）、`deliver_to_lead` 一次性向主对话递送关键档案、还是设定边界/重编任务、`effortOps` 调配主对话/子代理思考深度，只要符合当前权限，直接输出对应 JSON ops 执行到位。严禁触碰或读取冷藏档案柜（`precipitated` 100% 人类专属）；严禁越级让本局档案直接跳级沉淀，必须遵循 `本局 -> 全局 -> 冷藏` 梯度。',
  '- 【严守当前权限与禁止红线】：绝不越过当前权限等级上限，也绝不执行触发 `禁止红线 (forbidden)` 的写操作或高危命令。',
  '- 【问进展 / 问步骤 / 问卡点 / 求建议】：当用户询问“现在在做什么 / 处于什么步骤 / 目前进度如何 / 卡在哪里”等态势问题时，你面前的上下文已经完整包含「实时对话流快照」+「小任务板 (Plan)」+「任务图」+「断点游标」！直接用简明人话分点作答并放进 JSON 的 `reply` 字段，**严禁退化成纯工具 XML/DSML 标签输出，更严禁盲目运行 `run_command` / `list_dir` 扫盘**！只有用户明确要求去核查具体源码文件/跑命令实测时，才在 JSON `toolCalls` 里调工具。',
  '- 【代维护看板】：当用户让你「把某任务标为完成/受阻」「记一下下一步干啥」「改总目标」时，直接通过 `boardOps`（`task.update` / `cursor.set` / `objective.set` / `task.add`）落实（若强介入已锁定核心目标，则提示先解锁或关闭强介入）。',
  '- 【边界奏请与零散浓缩】：',
  '  1) 总结踩坑红线或必做要求时，生成 `boundProposals` 呈交用户拍板（若用户提到「全局定住/以后所有任务都生效」则设 `"pinGlobal": true`）；只有用户明确下令「直接写进禁止/必做边界」时才用 `boardOps`。',
  '  2) 当用户要求「把重要的零散边界总结成一条 / 合并重复边界」时，仔细阅读现有边界，保留关键命令名/路径/硬红线，浓缩为 1 条精炼总则放入 `boundProposals[0].item`，并把被它吸收替代的旧条文原样放进 `replaces` 数组（若被合并旧规中含 📌 全局定住项，则 `"pinGlobal": true`）。',
  '- 【看图与带图拆话】：当用户附带上传图片时，请直接结合图片画面诊断 UI 样式、报错截图或架构图；若你在 relays 中向代理拆话派活，系统会自动把用户附带的图片一并转送给目标代理。',
].join('\n')

export const CONCISE_BRIEF_ASK_EXTRA = [
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
  '- ⚠️ JSON 顶层结构铁律：上述六句话战报只能作为顶层合法 JSON 对象内 `"reply"` 字段的字符串值！绝不允许直接裸输出 Markdown！若用户要求生成自定义拦截规则或提炼/总结工作边界（或你在回复中提出了要补充/禁用的红线或边界），必须同步将完整条目填入 `"wallProposals"` 与 `"boundProposals"` 数组（JSON 字符串内的正则反斜杠须写双反斜杠 `\\\\`）。',
].join('\n')

export const CONSULT_CHIEF_EXTRA = [
  '',
  '💡 【当前为「参谋页面咨询（按需给建议）」模式 — 实事求是铁律】：',
  '- 请结合当前任务进展、最近对话、工作边界与团队状态，在 `"reply"` 中坦诚给出真正有价值的观察、风险提醒或推进建议。',
  '- 若当前推进顺利确实暂无建议，或用户关心的事项属于人类拍板/外部事务/非参谋与代理会话能管得了的范畴：**直接如实告诉用户就行！严禁为了凑动作而硬编 `"relays"`、`"boardOps"`、`"archiveOps"`、`"boundProposals"` 或执行建议，上述动作数组务必全部留空 `[]`**！',
  '- 仅当确实存在可落地的具体动作建议时，才填入对应 JSON 字段，并严格遵守当前四级权限（L0 仅文本分析与必要提权申请，L1–L3 按对应权限审批/执行机制运行）。',
].join('\n')

export function extractFallbackBoundProposalsFromText(rawText = '', userInput = '') {
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

export const CONSOLIDATE_BOUNDS_SYSTEM = [
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
export function collectLiveConversationsDigest(deps, rootId, directory) {
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


export function isPureStatusInquiry(rawText) {
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
export function buildSmartFallbackReply({ input, board, liveDigest, directory, facts = [], mailbox = [], conciseBrief = false }) {
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

export function deterministicConsolidateClauses(items) {
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

export function describeThreePartyBoundariesForPrompt(permissionMode) {
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
  return '- 四级权限当前档 [L3 · 参谋长模式 CHIEF OF STAFF · 主动风险知悉]：已获用户勾选确认风险，允许在安全防护硬规则与禁止红线内直接读写工作区、执行命令、切换或协调主对话及子代理工作流并完成维护与压缩。'
}

/**
 * Prime Minister Boundary Proposal API (`chief_board` action `"bounds.propose"`).
 * Lead or subagents submit wall-hits / boundary lessons here instead of silently mutating global bounds;
 * DSH Chief curates them and prompts the user for approval before injecting into `board.bounds`.
 */

export const OBJECTIVE_SUGGEST_SYSTEM = [
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
