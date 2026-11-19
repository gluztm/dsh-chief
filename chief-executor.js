import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import {
  CHIEF_PERMISSION_MODES,
  DEFAULT_CHIEF_PERMISSION_MODE,
  CHIEF_PERMISSION_META,
  normalizePermissionMode,
  permissionRank,
  getToolOpClass,
  resolveRoleCapabilities,
  buildCapabilityScope,
  verifyCapabilityScope,
  HUMAN_BOUNDS_CONFIRM_TOKEN,
  safeRealpath,
  isPathInsideWorkspace,
  hasWindowsReservedDeviceName,
  hasForbiddenNtfsAds,
  isSensitiveCredentialPath,
  validateWorkspacePath,
  verifyBoundsWriteAuth,
  decodeEncodedPowerShell,
  normalizeCommandForSecurity,
  splitCompoundCommand,
  extractInlineScriptPayloads,
  analyzeCommand,
  HARD_GUARD_RULE_IDS,
  isDestructiveShellCommand,
  commandTouchesSensitiveCredential,
  checkForbiddenBounds,
  evaluateSafetyGuardHardRules,
  FORBIDDEN_WEAKENING_KEYS,
  validatePolicyPlugin,
  validatePolicyPluginList,
  evaluatePolicyPlugins,
  evaluateChiefPermissionGate,
  evaluateUnifiedToolGate,
  GUARD_WALL_RULE_TYPES,
  GUARD_WALL_SCOPES,
  guardWallsFilePath,
  validateGuardWallInput,
  normalizeGuardWall,
  isGuardWallActiveForCwd,
  listGuardWalls,
  mutateGuardWalls,
  evaluateGuardWalls,
  evaluatePreExecuteDefense,
  redactAuditText,
} from './safety/index.js'

export {
  CHIEF_PERMISSION_MODES,
  DEFAULT_CHIEF_PERMISSION_MODE,
  CHIEF_PERMISSION_META,
  normalizePermissionMode,
  permissionRank,
  getToolOpClass,
  resolveRoleCapabilities,
  buildCapabilityScope,
  verifyCapabilityScope,
  HUMAN_BOUNDS_CONFIRM_TOKEN,
  safeRealpath,
  isPathInsideWorkspace,
  hasWindowsReservedDeviceName,
  hasForbiddenNtfsAds,
  isSensitiveCredentialPath,
  validateWorkspacePath,
  verifyBoundsWriteAuth,
  decodeEncodedPowerShell,
  normalizeCommandForSecurity,
  splitCompoundCommand,
  extractInlineScriptPayloads,
  analyzeCommand,
  HARD_GUARD_RULE_IDS,
  isDestructiveShellCommand,
  commandTouchesSensitiveCredential,
  checkForbiddenBounds,
  evaluateSafetyGuardHardRules,
  FORBIDDEN_WEAKENING_KEYS,
  validatePolicyPlugin,
  validatePolicyPluginList,
  evaluatePolicyPlugins,
  evaluateChiefPermissionGate,
  evaluateUnifiedToolGate,
  GUARD_WALL_RULE_TYPES,
  GUARD_WALL_SCOPES,
  guardWallsFilePath,
  validateGuardWallInput,
  normalizeGuardWall,
  isGuardWallActiveForCwd,
  listGuardWalls,
  mutateGuardWalls,
  evaluateGuardWalls,
  evaluatePreExecuteDefense,
}

export const CHIEF_TOOLS_PROMPT_GUIDE = [
  '【DSH 参谋系统实权工具协议（`toolCalls`）】',
  '工具调用遵循统一安全架构：`用户模式 -> 操作请求 -> 安全卫兵硬性规则 -> 权限判定 -> 执行器 -> 审计日志`。不同档位权限边界不同：',
  '- `read_file`: `{ "path": "相对或绝对路径", "startLine": 1, "endLine": 180 }` （L0+ 只读）',
  '- `list_dir`: `{ "path": "可选目录路径，默认当前工作区" }` （L0+ 只读）',
  '- `search_files`: `{ "pattern": "正则或关键词", "path": "可选目录", "maxHits": 30 }` （L0+ 只读）',
  '- `archive_write`: `{ "vaultScope": "session|global", "folder": "coords|case|spec|ops|plan|inbox", "title": "标题", "summary": "摘要", "body": "正文", "tags": [] }` （需 L1 助手+）',
  '- `write_file`: `{ "path": "文件路径", "content": "完整新文件内容", "reason": "修改原因" }` （L2 弹窗逐项确认 / L3 自主执行）',
  '- `edit_file`: `{ "path": "文件路径", "target": "精确旧文本", "replacement": "精确新文本", "reason": "修改原因" }` （L2 弹窗逐项确认 / L3 自主执行）',
  '- `run_command`: `{ "command": "终端命令", "cwd": "可选工作目录", "timeoutMs": 20000, "reason": "运行原因" }` （L2 弹窗逐项确认 / L3 自主执行）',
  '- `main_agent_control`: `{ "op": "switch_model|steer|followup|interrupt", "modelRef": "switch_model时填写provider/model", "message": "steer/followup时填写指令", "reason": "调整主代理原因" }` （L2 弹窗逐项确认 / L3 自主执行）',
  '- `subagent_dispatch`: `{ "taskId": "可选已有任务ID", "title": "无taskId时自动建卡标题", "agent": "子代理名", "prompt": "委派指令", "preset": "可选", "force": false, "reason": "派发原因" }` （L2 弹窗逐项确认 / L3 自主执行）',
  '- `subagent_steer`: `{ "agent": "子代理名", "taskId": "可选", "message": "纠偏指令", "reason": "引导原因" }` （L2 弹窗逐项确认 / L3 自主执行）',
  '- `subagent_interrupt`: `{ "agent": "子代理名", "taskId": "可选", "reason": "中断原因" }` （L2 弹窗逐项确认 / L3 自主执行）',
  '- `session_compact`: `{ "reason": "触发原因" }` （L2 弹窗逐项确认 / L3 自主执行）',
  '- `request_permission_elevation`: `{ "targetMode": "assistant|strategist|chief", "reason": "为何需要提权", "requestedActionSummary": "拟执行的具体受控操作简述" }` （L0+ 可随时向用户申请提权！）',
  '注意：',
  '1) 若需调用工具，请输出合法 JSON `{ "toolCalls": [...], "reply": "当前排查中的简要进度" }`。**严禁**输出 `<｜DSML｜...>`、`< | | DSML | | ...>`、`<|DSML|...>`、`<function_calls>` 或 `<invoke>` 等原生 XML 工具标记！',
  '2) 若当前权限等级不足（如 L0 无法改看板/工作区、L1 无法改工作区或调度工作流），可先做只读分析，再调用 `request_permission_elevation`（或输出 JSON `"elevationRequest"`）写明申请目标档位与原因，由用户弹窗决定是否放行（申请 L3 参谋长模式将额外强制进行风险确认打勾）。若处于 L2 调用受控工具返回 `pendingApproval: true`，请如实告知用户已弹出「操作授权请求」弹窗等待点击「允许本次操作」，切勿重复调用同一工具！',
  '3) **小白状态/步骤追问禁扫目录铁律**：当用户只是问「主对话现在在做什么」「处于什么步骤」「当前进度如何」「到哪一步了」「卡在哪」时，提示词中的【实时对话流现场快照】、【核心目标】与【小任务板/任务列表】已经包含完整状态，**严禁调用 `run_command` 或 `list_dir` 扫描本地磁盘目录**，请直接输出最终 JSON `{ "reply": "…" }` 用通俗人话回答！',
  '4) 工具返回结果回传给你后，若已完成查验与执行，请输出最终 JSON（去掉 `"toolCalls"`），并在 `reply` 中以实测事实作答；任何权限或红线拦截时如实汇报，绝不伪造输出。',
].join('\n')

const DSML_PREFIX = '(?:[\\s|｜¦│┃]*DSML[\\s|｜¦│┃]*)'
const DSML_OPEN_RE = new RegExp(`<${DSML_PREFIX}(?:calls|invoke)\\b`, 'i')

/**
 * Strip DeepSeek DSML / XML tool-call markup (`<｜DSML｜calls>`, `<｜｜DSML｜｜ calls>`,
 * `< | | DSML | | ...>`, `<function_calls>`, `<invoke>`, `<tool_call>`, or unclosed tails)
 * so raw internal tool syntax NEVER leaks into Chief UI or user replies.
 */
export function stripToolCallMarkup(rawText) {
  let s = String(rawText || '')
  if (!s) return ''
  // 1) Closed DSML blocks (ASCII |, fullwidth ｜, repeated bars, optional whitespace)
  s = s.replace(new RegExp(`<${DSML_PREFIX}calls\\b[^>]*>[\\s\\S]*?</${DSML_PREFIX}calls\\s*>`, 'gi'), '\n')
  s = s.replace(new RegExp(`<${DSML_PREFIX}invoke\\b[^>]*>[\\s\\S]*?</${DSML_PREFIX}invoke\\s*>`, 'gi'), '\n')
  // 2) Generic XML tool-call envelopes
  s = s.replace(/<function_calls\b[^>]*>[\s\S]*?<\/function_calls\s*>/gi, '\n')
  s = s.replace(/<tool_call\b[^>]*>[\s\S]*?<\/tool_call\s*>/gi, '\n')
  s = s.replace(/<invoke\b[^>]*>[\s\S]*?<\/invoke\s*>/gi, '\n')
  // 3) Unclosed / truncated DSML or XML tool-call tails
  s = s.replace(new RegExp(`<${DSML_PREFIX}(?:calls|invoke|parameter)\\b[\\s\\S]*$`, 'gi'), '')
  s = s.replace(/<(?:function_calls|tool_call|invoke)\b[\s\S]*$/gi, '')
  // 4) Leftover single DSML tags
  s = s.replace(new RegExp(`</?${DSML_PREFIX}[a-z_-]*\\b[^>]*>`, 'gi'), '')
  // 5) Stray standalone "toolCalls" JSON object envelope if the entire text is just raw tool scheduling
  const trimmed = s.trim()
  if (/^\s*\{[\s\S]*"toolCalls"\s*:\s*\[[\s\S]*\}\s*$/i.test(trimmed)) {
    try {
      const obj = JSON.parse(trimmed)
      if (obj && typeof obj === 'object' && Array.isArray(obj.toolCalls) && typeof obj.reply === 'string') {
        s = obj.reply
      } else {
        s = ''
      }
    } catch {
      if (!/[\u4e00-\u9fa5]{4,}/.test(trimmed)) s = ''
    }
  }
  return s.replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Fallback parser when a DeepSeek model emits native DSML tool invocations
 * (`< | | DSML | | invoke name="list_dir">...`) instead of JSON `"toolCalls"`.
 */
export function parseDsmlToolCalls(rawText) {
  const s = String(rawText || '')
  if (!s || !DSML_OPEN_RE.test(s)) return []
  const calls = []
  const invokeRe = new RegExp(
    `<${DSML_PREFIX}invoke\\s+name=["']([^"']+)["'][^>]*>([\\s\\S]*?)(?:</${DSML_PREFIX}invoke\\s*>|(?=<${DSML_PREFIX}invoke\\b|</${DSML_PREFIX}calls\\s*>|$))`,
    'gi',
  )
  let m
  while ((m = invokeRe.exec(s)) !== null && calls.length < 4) {
    let toolName = String(m[1] || '').trim()
    const body = String(m[2] || '')
    const paramRe = new RegExp(
      `<${DSML_PREFIX}parameter\\s+name=["']([^"']+)["']([^>]*)>([\\s\\S]*?)(?:</${DSML_PREFIX}parameter\\s*>|(?=<${DSML_PREFIX}parameter\\b|</${DSML_PREFIX}(?:invoke|calls)\\s*>|$))`,
      'gi',
    )
    const rawParams = {}
    let pm
    while ((pm = paramRe.exec(body)) !== null) {
      const pName = String(pm[1] || '').trim()
      const attrs = String(pm[2] || '')
      let pVal = String(pm[3] || '').trim()
      const isStr = /string\s*=\s*["']true["']/i.test(attrs)
        || (['content', 'text', 'target', 'replacement', 'body', 'command', 'cmd'].includes(pName) && !/string\s*=\s*["']false["']/i.test(attrs))
      if (!isStr && (pVal.startsWith('{') || pVal.startsWith('[') || pVal === 'true' || pVal === 'false' || /^-?\d+(?:\.\d+)?$/.test(pVal))) {
        try {
          pVal = JSON.parse(pVal)
        } catch {}
      }
      if (pName) rawParams[pName] = pVal
    }
    if (typeof rawParams.tool === 'string' && rawParams.tool.trim()) {
      toolName = rawParams.tool.trim()
    }
    let finalArgs = {}
    if (rawParams.args && typeof rawParams.args === 'object' && !Array.isArray(rawParams.args)) {
      finalArgs = rawParams.args
    } else if (typeof rawParams.args === 'string' && rawParams.args.trim().startsWith('{')) {
      try {
        const parsedArgs = JSON.parse(rawParams.args)
        if (parsedArgs && typeof parsedArgs === 'object') finalArgs = parsedArgs
      } catch {
        finalArgs = { ...rawParams }
      }
    } else {
      for (const [k, v] of Object.entries(rawParams)) {
        if (k === 'tool' || k === 'args') continue
        finalArgs[k] = v
      }
    }
    if (toolName) calls.push({ tool: toolName, args: finalArgs })
  }
  return calls
}

function clamp(text, maxLen = 200) {
  const s = String(text || '').trim()
  return s.length > maxLen ? s.slice(0, maxLen) + '...' : s
}

function normalizeTextContent(value) {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value ?? '')
}

function truncateMiddle(text, maxBytes = 12_288) {
  const s = String(text || '')
  if (s.length <= maxBytes) return s
  const head = Math.floor(maxBytes * 0.65)
  const tail = maxBytes - head
  return s.slice(0, head) + `\n...[已截断 ${s.length - maxBytes} 字符]...\n` + s.slice(-tail)
}

function runSubprocess(command, cwd, timeoutMs = 20_000) {
  return new Promise((resolve) => {
    const clampedTimeout = Math.min(45_000, Math.max(2_000, Number(timeoutMs) || 20_000))
    const isWin = process.platform === 'win32'
    const file = isWin ? 'powershell.exe' : 'sh'
    const args = isWin
      ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command]
      : ['-lc', command]
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false

    let child
    try {
      child = spawn(file, args, { cwd, windowsHide: true })
    } catch (err) {
      resolve({ ok: false, exitCode: -1, stdout: '', stderr: String(err && err.message ? err.message : err), timedOut: false })
      return
    }

    const timer = setTimeout(() => {
      timedOut = true
      try { child.kill('SIGTERM') } catch {}
      setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, 800).unref?.()
    }, clampedTimeout)

    child.stdout?.on('data', chunk => {
      if (stdout.length < 32_768) stdout += String(chunk)
    })
    child.stderr?.on('data', chunk => {
      if (stderr.length < 32_768) stderr += String(chunk)
    })

    child.on('error', err => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        ok: false,
        exitCode: -1,
        stdout: truncateMiddle(stdout),
        stderr: truncateMiddle(stderr + '\n' + String(err && err.message ? err.message : err)),
        timedOut,
      })
    })

    child.on('close', code => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        ok: code === 0 && !timedOut,
        exitCode: typeof code === 'number' ? code : -1,
        stdout: truncateMiddle(stdout.trim()),
        stderr: truncateMiddle(stderr.trim()),
        timedOut,
      })
    })
  })
}

function searchFilesFallbackNode(rootDir, pattern, maxHits = 30) {
  const hits = []
  let re = null
  try {
    re = new RegExp(pattern, 'i')
  } catch {
    re = null
  }
  const needle = String(pattern || '').toLowerCase()
  const skipDirs = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.dsh', '.cache'])

  const walk = (dir, depth = 0) => {
    if (hits.length >= maxHits || depth > 6) return
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      if (hits.length >= maxHits) break
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        if (!skipDirs.has(ent.name)) walk(full, depth + 1)
      } else if (ent.isFile()) {
        try {
          const st = fs.statSync(full)
          if (st.size > 512 * 1024) continue
          const content = fs.readFileSync(full, 'utf8')
          if (content.includes('\u0000')) continue
          const lines = content.split(/\r?\n/)
          for (let i = 0; i < lines.length; i += 1) {
            const line = lines[i]
            const matched = re ? re.test(line) : line.toLowerCase().includes(needle)
            if (matched) {
              hits.push(`${path.relative(rootDir, full) || ent.name}:${i + 1}: ${clamp(line, 180)}`)
              if (hits.length >= maxHits) break
            }
          }
        } catch {}
      }
    }
  }
  walk(rootDir, 0)
  return hits
}

function runRgSearch(rootDir, pattern, maxHits = 30) {
  return new Promise((resolve) => {
    const child = spawn('rg', ['-n', '--no-heading', '-S', '--max-count', '6', '-g', '!node_modules/**', '-g', '!.git/**', pattern, '.'], {
      cwd: rootDir,
      windowsHide: true,
    })
    let out = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { child.kill('SIGTERM') } catch {}
      resolve(null)
    }, 5_000)

    child.stdout?.on('data', d => {
      if (out.length < 24_000) out += String(d)
    })
    child.on('error', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(null)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === 0 || code === 1) {
        const lines = out.split(/\r?\n/).filter(Boolean).slice(0, maxHits)
        resolve(lines)
      } else {
        resolve(null)
      }
    })
  })
}

function displayRelTarget(cwd, rawTarget) {
  const raw = String(rawTarget || '').trim()
  if (!raw) return '工作区'
  const abs = path.resolve(cwd || process.cwd(), raw)
  if (cwd && isPathInsideWorkspace(cwd, abs)) {
    const rel = path.relative(safeRealpath(cwd), safeRealpath(abs))
    return (rel || path.basename(abs) || '.').replace(/\\/g, '/')
  }
  return abs
}

/** 为 L2 参谋模式逐项授权弹窗生成清晰人类可读的 操作 / 目标 / 原因 / 影响。 */
export function describeControlledOperationMeta(tool, args = {}, cwd = '') {
  const reasonArg = clamp(args.reason || args.rationale || args.subject || '', 140)
  const relPath = args.path ? displayRelTarget(cwd, args.path) : ''
  const baseName = relPath ? path.basename(relPath).toLowerCase() : ''

  switch (tool) {
    case 'edit_file':
      return {
        category: 'workspace_file',
        operationLabel: '修改工作区文件',
        targetLabel: relPath || '指定文件',
        reason: reasonArg || 'Agent 请求更新该文件内容',
        impact: baseName === 'package.json' ? '可能改变项目依赖关系或构建脚本' : '将局部修改项目源码或配置文件',
        preview: args.target ? `替换片段：${clamp(args.target, 100)} -> ${clamp(args.replacement || '', 100)}` : '',
      }
    case 'write_file': {
      const exists = args.path && fs.existsSync(path.resolve(cwd || process.cwd(), String(args.path)))
      const previewText = normalizeTextContent(args.content)
      return {
        category: 'workspace_file',
        operationLabel: exists ? '覆盖写入工作区文件' : '新建工作区文件',
        targetLabel: relPath || '新文件',
        reason: reasonArg || 'Agent 请求写入工作区文件',
        impact: baseName === 'package.json'
          ? '可能改变项目依赖关系或构建脚本'
          : (exists ? '将覆盖目标文件现有全部内容' : '将在项目工作区创建新文件'),
        preview: previewText ? `写入内容 (${Buffer.byteLength(previewText, 'utf8')} 字节)：${clamp(previewText, 110)}` : '',
      }
    }
    case 'run_command': {
      const cmd = String(args.command || args.cmd || '').trim()
      return {
        category: 'system_command',
        operationLabel: '执行系统命令',
        targetLabel: clamp(cmd || '终端命令', 90),
        reason: reasonArg || 'Agent 请求在工作区运行终端命令',
        impact: /(?:npm|pnpm|yarn)\s+(?:i|install|add|remove|uninstall)\b/i.test(cmd)
          ? '可能安装或变更项目依赖包'
          : '将在本机工作目录启动子进程并可能改变文件状态',
        preview: args.cwd ? `执行目录：${displayRelTarget(cwd, args.cwd)}` : '',
      }
    }
    case 'main_agent_control': {
      const op = String(args.op || 'steer').trim()
      const opTitle = op === 'switch_model'
        ? '切换主代理模型'
        : op === 'interrupt'
          ? '中断主代理当前回合'
          : '调整主对话工作流'
      const target = op === 'switch_model'
        ? (args.modelRef || args.model || '主对话模型')
        : '主对话 (@lead)'
      return {
        category: 'main_workflow',
        operationLabel: opTitle,
        targetLabel: String(target),
        reason: reasonArg || clamp(args.message || '参谋请求调整主对话执行', 120),
        impact: op === 'switch_model'
          ? '将改变主对话后续轮次所使用的底层大模型'
          : '将直接影响主对话当前执行节奏与工作流状态',
        preview: args.message ? clamp(args.message, 140) : '',
      }
    }
    case 'subagent_dispatch':
      return {
        category: 'subagent_workflow',
        operationLabel: '派发子代理工作流',
        targetLabel: '@' + String(args.agent || args.subagent || '新子代理'),
        reason: reasonArg || clamp(args.title || args.prompt || '请求调度子代理协同处理任务', 120),
        impact: '将创建或唤醒子代理并向其下发任务提示词',
        preview: clamp(args.prompt || args.message || '', 140),
      }
    case 'subagent_steer':
      return {
        category: 'subagent_workflow',
        operationLabel: '引导子代理工作流',
        targetLabel: '@' + String(args.agent || args.target || '子代理'),
        reason: reasonArg || clamp(args.message || '请求向运行中的子代理插话纠偏', 120),
        impact: '将实时向子代理注入纠偏指令并改变其下一步行动',
        preview: clamp(args.message || '', 140),
      }
    case 'subagent_interrupt':
      return {
        category: 'subagent_workflow',
        operationLabel: '中断子代理工作流',
        targetLabel: '@' + String(args.agent || args.target || '子代理'),
        reason: reasonArg || '请求立即中断子代理当前执行',
        impact: '将强行中止目标子代理正在运行的回合',
        preview: '',
      }
    case 'session_compact':
      return {
        category: 'main_workflow',
        operationLabel: '压缩主对话上下文 (/compact)',
        targetLabel: '当前主会话',
        reason: reasonArg || '压缩历史上下文前将先抢救摘要入档案柜',
        impact: '会触发主会话历史压缩，减少上下文占用并重置部分窗口细节',
        preview: '',
      }
    default:
      return {
        category: 'workspace_file',
        operationLabel: `执行受控操作 (${tool})`,
        targetLabel: relPath || '当前会话',
        reason: reasonArg || 'Agent 申请执行受控操作',
        impact: '将对当前工作区或对话工作流产生变更',
        preview: '',
      }
  }
}

/**
 * 统一六段执行管线入口：
 * 用户模式 -> 操作请求 -> 安全卫兵硬性规则 -> 权限判定 -> 执行器 -> 审计日志
 */
export async function executeChiefToolCall(deps, call, execCtx = {}) {
  const startedAt = performance.now()
  const tool = String(call && (call.tool || call.name) || '').trim()
  const args = (call && call.args && typeof call.args === 'object') ? call.args : (call && typeof call === 'object' ? call : {})
  const hasChiefRiskAck = Boolean(execCtx.hasChiefRiskAck)
  const policyPlugins = Array.isArray(execCtx.policyPlugins) ? execCtx.policyPlugins : []
  const permissionMode = normalizePermissionMode(execCtx.permissionMode, { requireAck: true, hasChiefRiskAck })
  const cwd = String(execCtx.cwd || process.cwd())
  const rootId = String(execCtx.rootId || '')
  const board = execCtx.board || {}
  const readOnlyToolsOnly = Boolean(execCtx.readOnlyToolsOnly)
  const approvedOnce = Boolean(execCtx.approvedOnce)
  const capabilityScope = execCtx.capabilityScope || null

  const writeAudit = (entry) => {
    if (typeof execCtx.recordAuditFn === 'function') {
      try {
        const durationMs = Math.max(0, Math.round(performance.now() - startedAt))
        execCtx.recordAuditFn({
          mode: permissionMode,
          tool,
          durationMs,
          summary: redactAuditText(entry.summary || entry.reason || '', 220),
          by: execCtx.by || 'chief',
          ...entry,
        })
      } catch {}
    }
  }

  const deny = (error, badge, extra = {}) => ({
    tool,
    ok: false,
    denied: true,
    error,
    badge: badge || `⛔ 拒绝 ${tool}`,
    ...extra,
  })

  if (!tool) return deny('缺少工具名 tool')

  const opClass = getToolOpClass(tool)
  if (readOnlyToolsOnly && opClass !== 'read') {
    writeAudit({ stage: 'read_only_guard', rule: 'read_only_guard', decision: 'denied', operation: tool, target: '', reason: '后台复盘仅允许只读核验', outcome: 'blocked' })
    return deny(`后台复盘轮次仅允许只读核验工具（${tool} 已跳过）`)
  }

  const rawTargetPath = (tool === 'read_file' || tool === 'write_file' || tool === 'edit_file' || tool === 'list_dir' || tool === 'search_files')
    ? String(args.path || '').trim()
    : ''
  const resolvedAbsTarget = rawTargetPath ? path.resolve(cwd, rawTargetPath) : ''
  const rawCommand = tool === 'run_command' ? String(args.command || args.cmd || '').trim() : ''

  // Stage 3: 安全卫兵硬性规则（优先于任何权限等级、策略插件与逐项批准）
  const guardRes = evaluateSafetyGuardHardRules({
    tool,
    opClass,
    targetPath: resolvedAbsTarget,
    command: rawCommand,
    args,
    cwd,
    board,
  })
  if (guardRes.blocked) {
    writeAudit({
      stage: 'safety_guard',
      rule: guardRes.rule || 'hard_guard',
      decision: 'blocked',
      operation: tool,
      target: displayRelTarget(cwd, resolvedAbsTarget) || clamp(rawCommand, 80) || tool,
      reason: guardRes.reason,
      outcome: 'blocked',
    })
    return deny(guardRes.reason, guardRes.badge, { blockedBySafetyGuard: true, rule: guardRes.rule || 'hard_guard' })
  }

  // Stage 3.5: 动态物理驻墙检验（同样不受 L3 与逐项放行绕过，require_approval_cmd 转为弹窗确认）
  const wallRes = evaluateGuardWalls({
    tool,
    opClass,
    targetPath: resolvedAbsTarget,
    command: rawCommand,
    args,
    cwd,
  })
  if (wallRes.decision === 'block') {
    writeAudit({
      stage: 'guard_wall',
      rule: wallRes.rule || 'guard_wall_block',
      decision: 'blocked',
      operation: tool,
      target: displayRelTarget(cwd, resolvedAbsTarget) || clamp(rawCommand, 80) || tool,
      reason: wallRes.reason,
      outcome: 'blocked',
    })
    return deny(wallRes.reason, wallRes.badge || '🧱 物理墙拦截', {
      blockedByGuardWall: true,
      blockedBySafetyGuard: true,
      rule: wallRes.rule || 'guard_wall_block',
      wallId: wallRes.wallId,
    })
  }
  if (wallRes.decision === 'require_approval' && !approvedOnce) {
    const meta = describeControlledOperationMeta(tool, args, cwd)
    const computedScope = buildCapabilityScope({ kind: 'tool', tool, args, cwd })
    const approvalObj = typeof execCtx.queueApprovalFn === 'function'
      ? await execCtx.queueApprovalFn({
          category: meta.category,
          operationLabel: meta.operationLabel,
          targetLabel: meta.targetLabel,
          reason: wallRes.reason,
          impact: meta.impact,
          preview: meta.preview,
          kind: 'tool',
          capabilityScope: computedScope,
          payload: { tool, args: { ...args }, cwd, rootId, sessionId: execCtx.sessionId || rootId },
          by: execCtx.by || 'guard_wall',
        })
      : null
    writeAudit({
      stage: 'guard_wall',
      rule: wallRes.rule || 'guard_wall_require_approval',
      decision: 'pending_approval',
      operation: meta.operationLabel,
      target: meta.targetLabel,
      reason: wallRes.reason,
      outcome: 'pending',
    })
    return {
      tool,
      ok: false,
      pendingApproval: true,
      approvalId: (approvalObj && approvalObj.id) || '',
      approval: approvalObj || null,
      error: `${wallRes.reason}。已为您弹出「操作授权请求」弹窗，等待点击「允许本次操作」。`,
      badge: wallRes.badge || '🧱 物理墙待确认',
    }
  }

  // Stage 4: 四级权限 + capabilities + Policy Plugin + 单次作用域判定
  const gateRes = evaluateChiefPermissionGate({
    permissionMode,
    hasChiefRiskAck,
    opClass,
    tool,
    approvedOnce,
    capabilityScope,
    actualRequest: { kind: 'tool', tool, args, cwd },
    policyPlugins,
    targetPath: resolvedAbsTarget,
    command: rawCommand,
    cwd,
  })
  if (gateRes.decision === 'deny_policy_plugin') {
    writeAudit({
      stage: 'policy_plugin',
      rule: gateRes.rule || 'policy_plugin',
      decision: 'blocked',
      operation: tool,
      target: rawTargetPath || clamp(rawCommand, 60) || tool,
      reason: gateRes.error,
      outcome: 'blocked',
    })
    return deny(gateRes.error, gateRes.badge, {
      blockedByPolicyPlugin: true,
      pluginId: gateRes.pluginId || '',
      rule: gateRes.rule || 'policy_plugin',
    })
  }
  if (gateRes.decision === 'deny_scope_mismatch') {
    writeAudit({
      stage: 'scope_guard',
      rule: gateRes.rule || 'capability_scope_mismatch',
      decision: 'rejected',
      operation: tool,
      target: rawTargetPath || clamp(rawCommand, 60) || tool,
      reason: gateRes.error,
      outcome: 'rejected',
    })
    return deny(gateRes.error, gateRes.badge, {
      deniedByScopeMismatch: true,
      rule: gateRes.rule || 'capability_scope_mismatch',
    })
  }
  if (gateRes.decision === 'deny_mode' || gateRes.decision === 'deny_unacknowledged_l3') {
    writeAudit({
      stage: 'permission_gate',
      rule: gateRes.rule || gateRes.decision,
      decision: gateRes.decision,
      operation: tool,
      target: rawTargetPath || clamp(rawCommand, 60) || String(args.agent || args.op || tool),
      reason: gateRes.error,
      outcome: 'denied',
    })
    return deny(gateRes.error, gateRes.badge, {
      deniedByMode: true,
      requiredMode: gateRes.requiredMode,
      currentMode: gateRes.mode,
    })
  }
  if (gateRes.decision === 'require_approval') {
    const meta = describeControlledOperationMeta(tool, args, cwd)
    const computedScope = buildCapabilityScope({ kind: 'tool', tool, args, cwd })
    const approvalObj = typeof execCtx.queueApprovalFn === 'function'
      ? await execCtx.queueApprovalFn({
          category: meta.category,
          operationLabel: meta.operationLabel,
          targetLabel: meta.targetLabel,
          reason: meta.reason,
          impact: meta.impact,
          preview: meta.preview,
          kind: 'tool',
          capabilityScope: computedScope,
          payload: { tool, args: { ...args }, cwd, rootId, sessionId: execCtx.sessionId || rootId },
          by: execCtx.by || 'chief',
        })
      : null
    writeAudit({
      stage: 'permission_gate',
      rule: gateRes.rule || 'require_approval',
      decision: 'pending_approval',
      operation: meta.operationLabel,
      target: meta.targetLabel,
      reason: meta.reason,
      outcome: 'pending',
    })
    return {
      tool,
      ok: false,
      pendingApproval: true,
      approvalId: (approvalObj && approvalObj.id) || '',
      approval: approvalObj || null,
      error: `当前处于「${CHIEF_PERMISSION_META[gateRes.mode]?.level || 'L2'} · ${CHIEF_PERMISSION_META[gateRes.mode]?.title || '参谋模式'}」，操作「${meta.operationLabel} → ${meta.targetLabel}」已提交操作授权弹窗，等待用户点击「允许本次操作」。`,
      badge: `🛡️ 待确认 ${clamp(meta.targetLabel, 18)}`,
    }
  }

  // Stage 5: 执行器（包含写入路径能力前缀二次确认）
  const allowedWritePrefixes = gateRes && gateRes.capabilities && Array.isArray(gateRes.capabilities.fsWritePrefixes)
    ? gateRes.capabilities.fsWritePrefixes
    : null
  if ((tool === 'write_file' || tool === 'edit_file') && rawTargetPath) {
    const writePathCheck = validateWorkspacePath(cwd, resolvedAbsTarget, {
      mode: 'write',
      allowedSubPrefixes: allowedWritePrefixes,
    })
    if (writePathCheck.blocked) {
      writeAudit({
        stage: writePathCheck.stage || 'safety_guard',
        rule: writePathCheck.rule || 'workspace_write_denied',
        decision: 'blocked',
        operation: tool,
        target: displayRelTarget(cwd, resolvedAbsTarget),
        reason: writePathCheck.reason,
        outcome: 'blocked',
      })
      return deny(writePathCheck.reason, writePathCheck.badge, {
        blockedBySafetyGuard: writePathCheck.stage === 'safety_guard',
        rule: writePathCheck.rule,
      })
    }
  }

  const finish = (res, opLabel, targetLabel) => {
    writeAudit({
      stage: 'executor',
      rule: approvedOnce ? 'approved_once' : 'role_allow',
      decision: approvedOnce ? 'executed_approved' : 'executed',
      operation: opLabel || tool,
      target: targetLabel || '',
      reason: clamp(args.reason || res.error || '', 140),
      outcome: res.ok ? 'ok' : 'error',
    })
    return res
  }

  switch (tool) {
    case 'read_file': {
      const targetRel = String(args.path || '').trim()
      if (!targetRel) return finish(deny('read_file 需要 path 参数'), '读取文件', '')
      const abs = path.resolve(cwd, targetRel)
      if (!fs.existsSync(abs)) return finish({ tool, ok: false, error: `文件不存在：${abs}`, badge: `⚠️ 未找到 ${path.basename(abs)}` }, '读取文件', displayRelTarget(cwd, abs))
      try {
        const raw = fs.readFileSync(abs, 'utf8')
        const lines = raw.split(/\r?\n/)
        const startLine = Math.max(1, Math.round(Number(args.startLine) || 1))
        const endLine = Math.min(lines.length, Math.max(startLine, Math.round(Number(args.endLine) || (startLine + 179))))
        const numbered = lines.slice(startLine - 1, endLine).map((l, idx) => `${startLine + idx}: ${l}`).join('\n')
        return finish({
          tool,
          ok: true,
          path: abs,
          totalLines: lines.length,
          range: `${startLine}-${endLine}`,
          content: truncateMiddle(numbered, 14_000),
          badge: `📖 读取 ${path.basename(abs)}`,
        }, '读取文件', displayRelTarget(cwd, abs))
      } catch (err) {
        return finish({ tool, ok: false, error: String(err && err.message ? err.message : err), badge: '⚠️ 读取失败' }, '读取文件', displayRelTarget(cwd, abs))
      }
    }

    case 'list_dir': {
      const targetRel = String(args.path || '.').trim() || '.'
      const abs = path.resolve(cwd, targetRel)
      if (!fs.existsSync(abs)) return finish({ tool, ok: false, error: `目录不存在：${abs}`, badge: '⚠️ 目录不存在' }, '列目录', displayRelTarget(cwd, abs))
      try {
        const items = fs.readdirSync(abs, { withFileTypes: true }).slice(0, 120).map(ent => {
          let size = 0
          if (ent.isFile()) {
            try { size = fs.statSync(path.join(abs, ent.name)).size } catch {}
          }
          return { name: ent.name, type: ent.isDirectory() ? 'dir' : 'file', ...(ent.isFile() ? { size } : {}) }
        })
        return finish({ tool, ok: true, path: abs, items, badge: `📂 列目录 ${path.basename(abs) || abs}` }, '列目录', displayRelTarget(cwd, abs))
      } catch (err) {
        return finish({ tool, ok: false, error: String(err && err.message ? err.message : err), badge: '⚠️ 列目录失败' }, '列目录', displayRelTarget(cwd, abs))
      }
    }

    case 'search_files': {
      const pattern = String(args.pattern || args.query || '').trim()
      if (!pattern) return finish(deny('search_files 需要 pattern 参数'), '搜索代码', '')
      const searchRoot = path.resolve(cwd, String(args.path || '.').trim() || '.')
      if (!fs.existsSync(searchRoot)) return finish({ tool, ok: false, error: `搜索目录不存在：${searchRoot}`, badge: '⚠️ 搜索目录不存在' }, '搜索代码', displayRelTarget(cwd, searchRoot))
      const maxHits = Math.min(50, Math.max(1, Math.round(Number(args.maxHits) || 30)))
      let hits = await runRgSearch(searchRoot, pattern, maxHits)
      if (hits === null) hits = searchFilesFallbackNode(searchRoot, pattern, maxHits)
      return finish({ tool, ok: true, path: searchRoot, pattern, hits, count: hits.length, badge: `🔎 搜索 "${clamp(pattern, 18)}"` }, '搜索代码', clamp(pattern, 40))
    }

    case 'request_permission_elevation': {
      const rawTarget = String(args.targetMode || args.target_mode || args.target || 'strategist').trim()
      const targetMode = normalizePermissionMode(rawTarget)
      if (permissionRank(targetMode) <= permissionRank(permissionMode)) {
        return finish({
          tool,
          ok: false,
          error: `目标权限 ${CHIEF_PERMISSION_META[targetMode].level} 不高于当前权限 ${CHIEF_PERMISSION_META[permissionMode].level}`,
          badge: '⚠️ 无需提权',
        }, '申请提权', targetMode)
      }
      const reason = clamp(args.reason || args.rationale || '执行当前工作任务需要更高权限', 220)
      const summaryText = clamp(args.requestedActionSummary || args.action_summary || args.actionSummary || args.summary || '', 180)
      const reqObj = typeof execCtx.requestElevationFn === 'function'
        ? await execCtx.requestElevationFn({
            fromMode: permissionMode,
            targetMode,
            reason,
            requestedActionSummary: summaryText,
            by: execCtx.by || 'chief',
          })
        : null
      return finish({
        tool,
        ok: true,
        elevationRequested: true,
        elevation: reqObj || { fromMode: permissionMode, targetMode, reason, requestedActionSummary: summaryText },
        badge: `🔐 已请示提权至 ${CHIEF_PERMISSION_META[targetMode].level}`,
      }, '申请提权', `${CHIEF_PERMISSION_META[permissionMode].level} -> ${CHIEF_PERMISSION_META[targetMode].level}`)
    }

    case 'write_file': {
      const targetRel = String(args.path || '').trim()
      if (!targetRel) return finish(deny('write_file 需要 path 参数'), '写入文件', '')
      const abs = path.resolve(cwd, targetRel)
      const contentStr = normalizeTextContent(args.content)
      try {
        fs.mkdirSync(path.dirname(abs), { recursive: true })
        fs.writeFileSync(abs, contentStr, 'utf8')
        return finish({ tool, ok: true, path: abs, bytes: Buffer.byteLength(contentStr, 'utf8'), badge: `✍️ 写入 ${path.basename(abs)}` }, '写入工作区文件', displayRelTarget(cwd, abs))
      } catch (err) {
        return finish({ tool, ok: false, error: String(err && err.message ? err.message : err), badge: '⚠️ 写入失败' }, '写入工作区文件', displayRelTarget(cwd, abs))
      }
    }

    case 'edit_file': {
      const targetRel = String(args.path || '').trim()
      const targetStr = String(args.target ?? '')
      const replaceStr = String(args.replacement ?? '')
      if (!targetRel || !targetStr) return finish(deny('edit_file 需要 path 与 target 参数'), '修改工作区文件', '')
      const abs = path.resolve(cwd, targetRel)
      if (!fs.existsSync(abs)) return finish({ tool, ok: false, error: `目标文件不存在：${abs}`, badge: `⚠️ 未找到 ${path.basename(abs)}` }, '修改工作区文件', displayRelTarget(cwd, abs))
      try {
        const prev = fs.readFileSync(abs, 'utf8')
        const idx = prev.indexOf(targetStr)
        if (idx < 0) return finish({ tool, ok: false, error: `未在 ${path.basename(abs)} 中匹配到 target 文本`, badge: '⚠️ 替换未命中' }, '修改工作区文件', displayRelTarget(cwd, abs))
        const next = prev.slice(0, idx) + replaceStr + prev.slice(idx + targetStr.length)
        fs.writeFileSync(abs, next, 'utf8')
        return finish({ tool, ok: true, path: abs, badge: `✏️ 修改 ${path.basename(abs)}` }, '修改工作区文件', displayRelTarget(cwd, abs))
      } catch (err) {
        return finish({ tool, ok: false, error: String(err && err.message ? err.message : err), badge: '⚠️ 编辑失败' }, '修改工作区文件', displayRelTarget(cwd, abs))
      }
    }

    case 'run_command': {
      const command = String(args.command || args.cmd || '').trim()
      if (!command) return finish(deny('run_command 需要 command 参数'), '执行系统命令', '')
      const runCwd = path.resolve(cwd, String(args.cwd || '.').trim() || '.')
      if (!fs.existsSync(runCwd)) return finish({ tool, ok: false, error: `工作目录不存在：${runCwd}`, badge: '⚠️ 目录不存在' }, '执行系统命令', clamp(command, 60))
      const execOut = await runSubprocess(command, runCwd, args.timeoutMs)
      return finish({
        tool,
        ok: execOut.ok,
        exitCode: execOut.exitCode,
        timedOut: execOut.timedOut,
        cwd: runCwd,
        stdout: execOut.stdout,
        stderr: execOut.stderr,
        badge: `⚡ 执行 (${execOut.timedOut ? '超时' : 'exit ' + execOut.exitCode})`,
      }, '执行系统命令', clamp(command, 60))
    }

    case 'main_agent_control': {
      if (typeof deps.controlMainAgent !== 'function') {
        return finish({ tool, ok: false, error: '当前宿主未挂载主代理控制接口', badge: '⚠️ 无主代理控制' }, '调整主代理', String(args.op || 'control'))
      }
      const ctrlRes = await deps.controlMainAgent({
        rootId,
        sessionId: execCtx.sessionId || rootId,
        op: String(args.op || 'steer').trim(),
        modelRef: String(args.modelRef || args.model || '').trim(),
        reasoningEffort: String(args.reasoningEffort || '').trim(),
        message: String(args.message || args.prompt || args.text || '').trim(),
        reason: String(args.reason || '').trim(),
      })
      return finish({
        tool,
        ok: Boolean(ctrlRes && ctrlRes.ok),
        ...(ctrlRes || {}),
        badge: ctrlRes && ctrlRes.ok ? (ctrlRes.badge || '🎛 已调整主代理') : '⚠️ 主代理控制失败',
      }, '调整主代理', String(args.modelRef || args.op || 'lead'))
    }

    case 'subagent_dispatch': {
      const prompt = String(args.prompt || args.message || args.text || '').trim()
      if (!prompt) return finish(deny('subagent_dispatch 需要 prompt 指令'), '派发子代理', '')
      let taskId = String(args.taskId || args.id || '').trim()
      if (!taskId && typeof deps.runAction === 'function') {
        const addRes = deps.runAction({
          action: 'task.add',
          title: clamp(args.title || prompt, 60),
          owner: String(args.agent || args.subagent || '').trim(),
          session: rootId,
          by: 'chief',
        })
        if (addRes && addRes.ok && addRes.task && addRes.task.id) {
          taskId = String(addRes.task.id)
        }
      }
      if (typeof deps.executeSubagentAction !== 'function') {
        return finish({ tool, ok: false, error: '当前宿主未挂载子代理调度接口', badge: '⚠️ 无子代理引擎' }, '派发子代理', String(args.agent || ''))
      }
      const dRes = await deps.executeSubagentAction({
        action: 'task.dispatch',
        id: taskId,
        agent: args.agent || args.subagent || '',
        prompt,
        preset: args.preset || '',
        force: Boolean(args.force),
        session: rootId,
        by: 'chief',
      })
      return finish({
        tool,
        ok: Boolean(dRes && dRes.ok),
        ...(dRes || {}),
        badge: dRes && dRes.ok ? `🚀 派发 @${dRes.dispatched?.agent || args.agent || 'worker'}` : '⚠️ 派发失败',
      }, '派发子代理', '@' + String((dRes && dRes.dispatched && dRes.dispatched.agent) || args.agent || 'worker'))
    }

    case 'subagent_steer': {
      if (typeof deps.executeSubagentAction !== 'function') {
        return finish({ tool, ok: false, error: '当前宿主未挂载子代理接口' }, '引导子代理', String(args.agent || ''))
      }
      const sRes = await deps.executeSubagentAction({
        action: 'team.steer',
        agent: args.agent || args.target || '',
        id: args.taskId || args.id || '',
        message: args.message || args.prompt || args.text || '',
        session: rootId,
        by: 'chief',
      })
      return finish({
        tool,
        ok: Boolean(sRes && sRes.ok),
        ...(sRes || {}),
        badge: sRes && sRes.ok ? `💬 引导 @${args.agent || 'worker'}` : '⚠️ 引导失败',
      }, '引导子代理', '@' + String(args.agent || args.target || 'worker'))
    }

    case 'subagent_interrupt': {
      if (typeof deps.executeSubagentAction !== 'function') {
        return finish({ tool, ok: false, error: '当前宿主未挂载子代理接口' }, '中断子代理', String(args.agent || ''))
      }
      const iRes = await deps.executeSubagentAction({
        action: 'team.interrupt',
        agent: args.agent || args.target || '',
        id: args.taskId || args.id || '',
        session: rootId,
        by: 'chief',
      })
      return finish({
        tool,
        ok: Boolean(iRes && iRes.ok),
        ...(iRes || {}),
        badge: iRes && iRes.ok ? `⏹ 中断 @${args.agent || 'worker'}` : '⚠️ 中断失败',
      }, '中断子代理', '@' + String(args.agent || args.target || 'worker'))
    }

    case 'archive_write': {
      if (typeof execCtx.upsertArchiveFn !== 'function') {
        return finish({ tool, ok: false, error: '档案写入服务未就绪', badge: '⚠️ 无档案写口' }, '写参谋档案', String(args.title || ''))
      }
      const scope = args.vaultScope === 'global' ? 'global' : 'session'
      const out = await execCtx.upsertArchiveFn({
        vaultScope: scope,
        folder: args.folder || 'inbox',
        title: clamp(args.title || '参谋长工作归档', 72),
        summary: clamp(args.summary || '', 160),
        body: String(args.body || args.text || ''),
        tags: Array.isArray(args.tags) ? args.tags : [],
      })
      return finish({
        tool,
        ok: Boolean(out && out.ok),
        ...(out || {}),
        badge: out && out.ok ? `🗄️ 归档(${scope === 'global' ? '全局' : '本会话'})` : '⚠️ 归档失败',
      }, '写参谋档案', clamp(args.title || scope, 40))
    }

    case 'session_compact': {
      if (typeof execCtx.compactNowFn !== 'function') {
        return finish({ tool, ok: false, error: '压缩服务未就绪', badge: '⚠️ 无压缩引擎' }, '压缩主对话', 'current')
      }
      try {
        const cRes = await execCtx.compactNowFn(String(args.reason || '参谋长主动执行抢救与上下文压缩'))
        if (cRes && cRes.ok) {
          return finish({
            tool,
            ok: true,
            ...cRes,
            badge: cRes.noop ? '🗄️ 已归档(免压)' : '🗜 完成抢救压缩',
          }, '压缩主对话', 'current')
        }
        return finish({
          tool,
          ok: false,
          ...(cRes && typeof cRes === 'object' ? cRes : { error: String(cRes || '压缩未完成') }),
          error: (cRes && cRes.error) || '压缩未完成',
          badge: '⚠️ 压缩未完成',
        }, '压缩主对话', 'current')
      } catch (e) {
        return finish({
          tool,
          ok: false,
          error: (e && e.message) || String(e || '压缩执行异常'),
          badge: '⚠️ 压缩异常',
        }, '压缩主对话', 'current')
      }
    }

    default:
      return finish(deny(`未知参谋工具：${tool}`, `⚠️ 未知工具 ${tool}`), tool, '')
  }
}

/**
 * 参谋长多步实权 Agentic 循环：支持最多 `maxSteps` 轮工具自驱执行后综合汇报。
 */
export async function runChiefAgenticLoop(deps, {
  rootId = '',
  sessionId = '',
  system = '',
  initialPrompt = '',
  imageBlocks = [],
  allowTextFallbackOnVisionMiss = false,
  permissionMode = DEFAULT_CHIEF_PERMISSION_MODE,
  hasChiefRiskAck = false,
  policyPlugins = [],
  board = null,
  maxSteps = 4,
  readOnlyToolsOnly = false,
  disableTools = false,
  lazyDeferWorkspaceWritesToLead = false,
  callLlmFn,
  extractJsonFn,
  upsertArchiveFn,
  compactNowFn,
  queueApprovalFn,
  requestElevationFn,
  recordAuditFn,
} = {}) {
  const perm = normalizePermissionMode(permissionMode, { requireAck: true, hasChiefRiskAck })
  const cwd = (typeof deps?.getSessionCwd === 'function' ? deps.getSessionCwd(rootId || sessionId) : '') || process.cwd()
  const toolBadges = []
  const toolRecords = []
  const pendingApprovals = []
  const elevationRequests = []
  let prompt = String(initialPrompt || '')
  let lastLlmRes = null
  let parsed = null

  const cleanRes = (res) => {
    if (!res || typeof res !== 'object') return res
    const raw = typeof res.text === 'string' ? res.text : ''
    const cleaned = stripToolCallMarkup(raw)
    return { ...res, text: cleaned }
  }

  if (disableTools) {
    lastLlmRes = await callLlmFn({
      prompt,
      system,
      imageBlocks,
      allowTextFallbackOnVisionMiss,
    })
    if (!lastLlmRes || !lastLlmRes.ok) {
      return { ok: false, llmRes: lastLlmRes, parsed: null, toolBadges, toolRecords, pendingApprovals, elevationRequests }
    }
    const cleanedRes = cleanRes(lastLlmRes)
    parsed = typeof extractJsonFn === 'function' ? extractJsonFn(cleanedRes.text) : null
    if (parsed && typeof parsed.reply === 'string') {
      parsed.reply = stripToolCallMarkup(parsed.reply)
    }
    return { ok: true, llmRes: cleanedRes, parsed, toolBadges, toolRecords, pendingApprovals, elevationRequests }
  }

  const meta = CHIEF_PERMISSION_META[perm] || CHIEF_PERMISSION_META.advisor
  const permHeader = `\n\n[当前参谋系统权限级别] permissionMode="${perm}" (${meta.level} · ${meta.title}) — ${meta.tagline}${perm === 'strategist' ? ' 所有工作区/系统命令/工作流变更工具均会进入「逐项操作授权弹窗」，需用户点击允许后方可执行。' : ''}`
  const stepsLimit = Math.max(1, maxSteps)
  let ranToolsOnLastStep = false

  for (let step = 0; step < stepsLimit; step += 1) {
    ranToolsOnLastStep = false
    lastLlmRes = await callLlmFn({
      prompt: step === 0 ? (prompt + permHeader) : prompt,
      system,
      imageBlocks: step === 0 ? imageBlocks : [],
      allowTextFallbackOnVisionMiss,
    })
    if (!lastLlmRes || !lastLlmRes.ok) {
      return { ok: false, llmRes: lastLlmRes, parsed: null, toolBadges, toolRecords, pendingApprovals, elevationRequests }
    }
    parsed = typeof extractJsonFn === 'function' ? extractJsonFn(lastLlmRes.text) : null
    const jsonCalls = parsed && Array.isArray(parsed.toolCalls) ? parsed.toolCalls.filter(c => c && (c.tool || c.name)).slice(0, 4) : []
    const dsmlCalls = !jsonCalls.length ? parseDsmlToolCalls(lastLlmRes.text) : []
    const calls = jsonCalls.length ? jsonCalls : dsmlCalls
    if (!calls.length) {
      const cleanedRes = parsed ? lastLlmRes : cleanRes(lastLlmRes)
      if (!parsed && typeof extractJsonFn === 'function') {
        parsed = extractJsonFn(cleanedRes.text)
      }
      if (parsed && typeof parsed.reply === 'string') {
        parsed.reply = stripToolCallMarkup(parsed.reply)
      }
      return { ok: true, llmRes: cleanedRes, parsed, toolBadges, toolRecords, pendingApprovals, elevationRequests }
    }

    ranToolsOnLastStep = true
    const stepOutputs = []
    for (const c of calls) {
      const cToolName = String(c && (c.tool || c.name) || '').trim()
      if (
        lazyDeferWorkspaceWritesToLead
        && (cToolName === 'write_file' || cToolName === 'edit_file' || cToolName === 'run_command')
      ) {
        const preDef = evaluatePreExecuteDefense({
          tool: cToolName,
          args: (c && c.args && typeof c.args === 'object') ? c.args : {},
          cwd,
          board,
        })
        if (!preDef || preDef.decision !== 'deny') {
          if (typeof recordAuditFn === 'function') {
            try {
              recordAuditFn({
                mode: perm,
                stage: 'lazy_intervention',
                rule: 'lead_first_defer',
                decision: 'deferred_to_lead',
                operation: cToolName,
                target: clamp(String((c.args && (c.args.path || c.args.command || c.args.cmd)) || cToolName), 80),
                reason: '懒介入机制生效：主对话在线且用户未指定参谋长亲自操作，改为派发 @lead 执行请求',
                outcome: 'deferred',
                by: 'chief',
              })
            } catch {}
          }
          const deferRes = {
            tool: cToolName,
            ok: false,
            denied: true,
            deferredByLazyIntervention: true,
            badge: '🤝 懒介入转主对话',
            error: '懒介入机制生效：当前主对话 (@lead) 在线可用且用户未指定参谋长亲自操刀，已遏制直接改动工作区或跑终端命令。请去掉工作区 toolCalls，改为在最终 JSON 的 relays 中向 target="lead" 下发结构化执行请求！',
          }
          toolRecords.push({ step: step + 1, call: c, result: deferRes })
          if (!toolBadges.includes(deferRes.badge)) toolBadges.push(deferRes.badge)
          stepOutputs.push({ tool: cToolName, args: c.args || {}, result: deferRes })
          continue
        }
      }
      const execRes = await executeChiefToolCall(deps, c, {
        rootId,
        sessionId: sessionId || rootId,
        cwd,
        permissionMode: perm,
        hasChiefRiskAck,
        policyPlugins,
        board,
        readOnlyToolsOnly,
        upsertArchiveFn,
        compactNowFn,
        queueApprovalFn,
        requestElevationFn,
        recordAuditFn,
      })
      if (execRes.pendingApproval && execRes.approval) pendingApprovals.push(execRes.approval)
      if (execRes.elevationRequested && execRes.elevation) elevationRequests.push(execRes.elevation)
      toolRecords.push({ step: step + 1, call: c, result: execRes })
      if (execRes.badge && !toolBadges.includes(execRes.badge)) {
        toolBadges.push(execRes.badge)
      }
      stepOutputs.push({
        tool: execRes.tool,
        args: c.args || {},
        result: execRes,
      })
    }

    const allWaitingUser = stepOutputs.every(s =>
      s.result && (s.result.pendingApproval || s.result.elevationRequested || s.result.deniedByMode),
    )
    const obsBlock = stepOutputs.map((item, i) => [
      `### 工具 #${i + 1} \`${item.tool}\` 执行回执`,
      JSON.stringify(item.result, null, 2),
    ].join('\n')).join('\n\n')

    const isFinalStepSoon = step + 2 >= stepsLimit
    prompt = [
      prompt,
      '',
      `## 第 ${step + 1} 步实权工具真实执行结果`,
      obsBlock,
      '',
      allWaitingUser
        ? '以上受控操作已拦截并进入等待用户弹窗确认或申请提权流程。**严禁再重复调用同一被拒/待批工具**；若尚未调用 `request_permission_elevation` 且需要更高权限，可在最终 JSON 中附带 `"elevationRequest"` 或只读汇总当前分析结果后去掉 `"toolCalls"` 结束本轮。'
        : (isFinalStepSoon
            ? '你已接近本轮工具调用步数上限，请立即基于上述真实回执输出最终结论 JSON（务必不要再带 `"toolCalls"` 或任何 DSML/XML 标签）。'
            : '请根据上述真实回执决定：若仍需进一步查看/修改/验证则继续附带下一批 `"toolCalls"`；否则直接输出最终结论 JSON（不再包含 `"toolCalls"` 或 DSML 标签）。'),
    ].join('\n')
  }

  // Reached maxSteps while still invoking tools: perform one tool-free synthesis call so raw tool markup NEVER exits the loop
  if (ranToolsOnLastStep) {
    try {
      const synthRes = await callLlmFn({
        prompt: prompt + '\n\n【重要停手收口】工具调用步数已用尽！现在严禁再输出任何 `toolCalls`、`<｜DSML｜calls>` 或 `<invoke>` 标签，请直接根据上面已拿到的真实信息与对话快照，用中文给出最终 `{ "reply": "…" }`！',
        system,
        imageBlocks: [],
        allowTextFallbackOnVisionMiss,
      })
      if (synthRes && synthRes.ok) {
        lastLlmRes = cleanRes(synthRes)
        parsed = typeof extractJsonFn === 'function' ? extractJsonFn(lastLlmRes.text) : null
      }
    } catch {}
  }

  const finalRes = cleanRes(lastLlmRes)
  if (!parsed && finalRes && finalRes.ok && typeof extractJsonFn === 'function') {
    parsed = extractJsonFn(finalRes.text)
  }
  if (parsed && typeof parsed.reply === 'string') {
    parsed.reply = stripToolCallMarkup(parsed.reply)
  }
  return { ok: Boolean(finalRes && finalRes.ok), llmRes: finalRes, parsed, toolBadges, toolRecords, pendingApprovals, elevationRequests }
}
