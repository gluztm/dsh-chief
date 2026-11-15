import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

export const CHIEF_PERMISSION_MODES = ['read-only', 'workspace-write', 'danger-full-access', 'auto-review']
export const DEFAULT_CHIEF_PERMISSION_MODE = 'danger-full-access'

export function normalizePermissionMode(raw) {
  const v = String(raw || '').trim()
  return CHIEF_PERMISSION_MODES.includes(v) ? v : DEFAULT_CHIEF_PERMISSION_MODE
}

export const CHIEF_TOOLS_PROMPT_GUIDE = [
  '【参谋长实权工具协议（`toolCalls`）】',
  '你默认拥有最高「完全权限 (`danger-full-access`)」，绝不只是传话筒！当需要查证代码、修改文件、跑命令/测试验证、维护档案、立刻压缩或直接派发/插话/中断子代理时，可在输出 JSON 中附加 `"toolCalls"` 数组（每轮最多 4 项，系统将立即执行并把真实输出回传给你，直到你给出最终答复 JSON 且不再包含 `"toolCalls"`）：',
  '- `read_file`: `{ "path": "相对或绝对路径", "startLine": 1, "endLine": 180 }`',
  '- `list_dir`: `{ "path": "可选目录路径，默认当前工作区" }`',
  '- `search_files`: `{ "pattern": "正则或关键词", "path": "可选目录", "maxHits": 30 }`',
  '- `write_file`: `{ "path": "文件路径", "content": "完整新文件内容" }`',
  '- `edit_file`: `{ "path": "文件路径", "target": "精确旧文本", "replacement": "精确新文本" }`',
  '- `run_command`: `{ "command": "终端命令", "cwd": "可选工作目录", "timeoutMs": 20000 }`',
  '- `subagent_dispatch`: `{ "taskId": "可选已有任务ID", "title": "无taskId时自动建卡标题", "agent": "子代理名", "prompt": "委派指令", "preset": "可选", "force": false }`',
  '- `subagent_steer`: `{ "agent": "子代理名", "taskId": "可选", "message": "纠偏指令" }`',
  '- `subagent_interrupt`: `{ "agent": "子代理名", "taskId": "可选" }`',
  '- `archive_write`: `{ "vaultScope": "session|global", "folder": "coords|case|spec|ops|plan|inbox", "title": "标题", "summary": "摘要", "body": "正文", "tags": [] }`',
  '- `session_compact`: `{ "reason": "触发原因" }`',
  '注意：',
  '1) 若需调用工具，请输出合法 JSON `{ "toolCalls": [...], "reply": "当前排查中的简要进度" }`。**严禁**输出 `<｜DSML｜...>`、`< | | DSML | | ...>`、`<|DSML|...>`、`<function_calls>` 或 `<invoke>` 等原生 XML 工具标记！',
  '2) **小白状态/步骤追问禁扫目录铁律**：当用户只是问「主对话现在在做什么」「处于什么步骤」「当前进度如何」「到哪一步了」「卡在哪」时，提示词中的【实时对话流现场快照】、【核心目标】与【小任务板/任务列表】已经包含完整状态，**严禁调用 `run_command` 或 `list_dir` 扫描本地磁盘目录**，请直接输出最终 JSON `{ "reply": "…" }` 用通俗人话回答！',
  '3) 工具返回结果回传给你后，若已完成查验与执行，请输出最终 JSON（去掉 `"toolCalls"`），并在 `reply` 中以实测事实作答；任何权限或红线拦截时如实汇报，绝不伪造输出。',
].join('\n')

const DSML_OPEN_RE = /<(?:\s*\|\s*\|\s*DSML\s*\|\s*\|\s*|[｜|]DSML[｜|])(?:calls|invoke)\b/i

/**
 * Strip DeepSeek DSML / XML tool-call markup (`<｜DSML｜calls>`, `< | | DSML | | ...>`,
 * `<function_calls>`, `<invoke>`, `<tool_call>`, or unclosed trailing DSML tails) so raw
 * internal tool syntax NEVER leaks into Chief UI or user replies.
 */
export function stripToolCallMarkup(rawText) {
  let s = String(rawText || '')
  if (!s) return ''
  // 1) Closed DSML blocks (with optional whitespace around vertical bars or fullwidth ｜)
  s = s.replace(/<(?:\s*\|\s*\|\s*DSML\s*\|\s*\|\s*|[｜|]DSML[｜|])calls\b[^>]*>[\s\S]*?<\/(?:\s*\|\s*\|\s*DSML\s*\|\s*\|\s*|[｜|]DSML[｜|])calls\s*>/gi, '\n')
  s = s.replace(/<(?:\s*\|\s*\|\s*DSML\s*\|\s*\|\s*|[｜|]DSML[｜|])invoke\b[^>]*>[\s\S]*?<\/(?:\s*\|\s*\|\s*DSML\s*\|\s*\|\s*|[｜|]DSML[｜|])invoke\s*>/gi, '\n')
  // 2) Generic XML tool-call envelopes
  s = s.replace(/<function_calls\b[^>]*>[\s\S]*?<\/function_calls\s*>/gi, '\n')
  s = s.replace(/<tool_call\b[^>]*>[\s\S]*?<\/tool_call\s*>/gi, '\n')
  s = s.replace(/<invoke\b[^>]*>[\s\S]*?<\/invoke\s*>/gi, '\n')
  // 3) Unclosed / truncated DSML or XML tool-call tails
  s = s.replace(/<(?:\s*\|\s*\|\s*DSML\s*\|\s*\|\s*|[｜|]DSML[｜|])(?:calls|invoke|parameter)\b[\s\S]*$/gi, '')
  s = s.replace(/<(?:function_calls|tool_call|invoke)\b[\s\S]*$/gi, '')
  // 4) Leftover single DSML tags
  s = s.replace(/<\/?(?:\s*\|\s*\|\s*DSML\s*\|\s*\|\s*|[｜|]DSML[｜|])[a-z_-]*\b[^>]*>/gi, '')
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
  const invokeRe = /<(?:\s*\|\s*\|\s*DSML\s*\|\s*\|\s*|[｜|]DSML[｜|])invoke\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/(?:\s*\|\s*\|\s*DSML\s*\|\s*\|\s*|[｜|]DSML[｜|])invoke\s*>/gi
  let m
  while ((m = invokeRe.exec(s)) !== null && calls.length < 4) {
    let toolName = String(m[1] || '').trim()
    const body = String(m[2] || '')
    const paramRe = /<(?:\s*\|\s*\|\s*DSML\s*\|\s*\|\s*|[｜|]DSML[｜|])parameter\s+name="([^"]+)"([^>]*)>([\s\S]*?)<\/(?:\s*\|\s*\|\s*DSML\s*\|\s*\|\s*|[｜|]DSML[｜|])parameter\s*>/gi
    const rawParams = {}
    let pm
    while ((pm = paramRe.exec(body)) !== null) {
      const pName = String(pm[1] || '').trim()
      const attrs = String(pm[2] || '')
      let pVal = String(pm[3] || '').trim()
      const isStr = /string="true"/i.test(attrs)
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

function truncateMiddle(text, maxBytes = 12_288) {
  const s = String(text || '')
  if (s.length <= maxBytes) return s
  const head = Math.floor(maxBytes * 0.65)
  const tail = maxBytes - head
  return s.slice(0, head) + `\n...[已截断 ${s.length - maxBytes} 字符]...\n` + s.slice(-tail)
}

function safeRealpath(targetPath) {
  try {
    return fs.realpathSync.native ? fs.realpathSync.native(targetPath) : fs.realpathSync(targetPath)
  } catch {
    return path.resolve(targetPath)
  }
}

export function isPathInsideWorkspace(workspaceRoot, targetPath) {
  if (!workspaceRoot || !targetPath) return false
  const rootAbs = safeRealpath(workspaceRoot)
  let probe = path.resolve(rootAbs, targetPath)
  if (!fs.existsSync(probe)) {
    const parent = path.dirname(probe)
    probe = fs.existsSync(parent) ? path.join(safeRealpath(parent), path.basename(probe)) : path.resolve(probe)
  } else {
    probe = safeRealpath(probe)
  }
  const cmpRoot = process.platform === 'win32' ? rootAbs.toLowerCase() : rootAbs
  const cmpTarget = process.platform === 'win32' ? probe.toLowerCase() : probe
  const rel = path.relative(cmpRoot, cmpTarget)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

function isSensitiveCredentialPath(filePath) {
  const base = path.basename(String(filePath || '')).toLowerCase()
  const normalized = String(filePath || '').replace(/\\/g, '/').toLowerCase()
  if (base === '.env' || base.startsWith('.env.') || base === '.credentials.yaml' || base.startsWith('.credentials.')) {
    return true
  }
  if (/(?:id_rsa|id_ed25519|id_dsa|\.pem$|\.p12$|\.pfx$|credentials\.json$|secrets?\.(?:json|ya?ml)$)/.test(normalized)) {
    return true
  }
  return false
}

const READ_ONLY_COMMAND_PATTERNS = [
  /^\s*git\s+(?:status|diff|log|rev-parse|branch|show|tag|remote\s+-v)\b/i,
  /^\s*node\s+(?:--check|-v|--version)\b/i,
  /^\s*(?:python|python3)\s+(?:--version|-V|-m\s+py_compile)\b/i,
  /^\s*(?:rg|grep|findstr|dir|ls|cat|type|pwd|whoami|echo|where|which|Get-ChildItem|Get-Content|Select-String|Get-Location)\b/i,
]

function isReadOnlyShellCommand(command) {
  const cmd = String(command || '').trim()
  if (!cmd) return false
  if (/[><`]|;\s*\S|\&\&|\|\||\b(?:rm|del|erase|rmdir|Remove-Item|Move-Item|Copy-Item|Set-Content|Add-Content|Out-File|mv|cp|mkdir|npm\s+install|pnpm\s+add|git\s+(?:push|commit|reset|clean|checkout|add|merge|rebase))\b/i.test(cmd)) {
    return false
  }
  return READ_ONLY_COMMAND_PATTERNS.some(re => re.test(cmd))
}

/**
 * 无论当前处于何种权限级别（包括 danger-full-access），都坚决守住用户在看板中设定的禁止红线。
 */
export function checkForbiddenBounds(board, actionDesc = '', commandOrPath = '') {
  const forbidden = [
    ...((board && board.bounds && Array.isArray(board.bounds.forbidden)) ? board.bounds.forbidden : []),
    ...((board && board.pinnedBounds && Array.isArray(board.pinnedBounds.forbidden)) ? board.pinnedBounds.forbidden : []),
  ]
  if (!forbidden.length) return { blocked: false }
  const haystack = `${actionDesc} ${commandOrPath}`.replace(/\\/g, '/').toLowerCase()

  for (const rule of forbidden) {
    const rText = String(rule || '').trim()
    if (!rText) continue
    const ruleNorm = rText.replace(/\\/g, '/')
    const ruleLower = ruleNorm.toLowerCase()

    // 1. 提取反引号或引号内的受禁命令或路径字面量，如 `git push`、`npm publish`、"secret.env"
    const quoted = [
      ...[...ruleNorm.matchAll(/`([^`]{2,80})`/g)].map(m => m[1]),
      ...[...ruleNorm.matchAll(/["'「『]([^"'」』]{2,80})["'」』]/g)].map(m => m[1]),
    ].map(s => s.trim().toLowerCase())
    for (const token of quoted) {
      if (token && haystack.includes(token)) {
        return { blocked: true, matchedRule: rText, trigger: token }
      }
    }

    // 2. 提取不带反引号的文件名、路径片段、点文件或扩展名（如 secret.env、src/auth.js、package.json、.env）
    const pathTokens = [...ruleLower.matchAll(/(?:[a-z0-9_.-]+\/[a-z0-9_.\-\/]+|\.[a-z0-9_-]{2,16}|[a-z0-9_-]{2,40}\.[a-z0-9]{1,10})/g)]
      .map(m => m[0].trim())
    for (const tok of pathTokens) {
      if (tok && tok.length >= 3 && haystack.includes(tok)) {
        return { blocked: true, matchedRule: rText, trigger: tok }
      }
    }

    // 3. 匹配常见高危动词组合
    const dangerousCmds = [
      'git push',
      'npm publish',
      'git reset --hard',
      'rm -rf',
      'del /f',
      'format ',
      'drop table',
      'drop database',
    ]
    for (const cmdTok of dangerousCmds) {
      if (ruleLower.includes(cmdTok) && haystack.includes(cmdTok)) {
        return { blocked: true, matchedRule: rText, trigger: cmdTok }
      }
    }

    // 4. 若用户直接写了极短裸禁止词（去前缀后 >= 4 字符的命令行或目录标记）
    const stripped = ruleLower
      .replace(/^(?:严禁|禁止|不得|切勿|不要|不能|不可|不允许|勿|do\s+not|never|forbid)\s*/i, '')
      .replace(/^(?:改动|修改|编辑|写入|删除|覆盖|执行|运行|推送|发布|触碰)\s*/i, '')
      .trim()
    if (stripped.length >= 4 && /^[a-z0-9_.\-\/:\s]{4,64}$/.test(stripped) && haystack.includes(stripped)) {
      return { blocked: true, matchedRule: rText, trigger: stripped }
    }
  }
  return { blocked: false }
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

/** 执行单个参谋长工具调用，实施四档权限与禁止红线护栏。 */
export async function executeChiefToolCall(deps, call, execCtx = {}) {
  const tool = String(call && (call.tool || call.name) || '').trim()
  const args = (call && call.args && typeof call.args === 'object') ? call.args : (call && typeof call === 'object' ? call : {})
  const permissionMode = normalizePermissionMode(execCtx.permissionMode)
  const cwd = String(execCtx.cwd || process.cwd())
  const rootId = String(execCtx.rootId || '')
  const board = execCtx.board || {}
  const readOnlyToolsOnly = Boolean(execCtx.readOnlyToolsOnly)

  const deny = (error, badge) => ({
    tool,
    ok: false,
    denied: true,
    error,
    badge: badge || `⛔ 拒绝 ${tool}`,
  })

  if (!tool) return deny('缺少工具名 tool')
  if (readOnlyToolsOnly && !['read_file', 'list_dir', 'search_files'].includes(tool)) {
    return deny(`后台复盘轮次仅允许只读核验工具（${tool} 已跳过）`)
  }

  switch (tool) {
    case 'read_file': {
      const targetRel = String(args.path || '').trim()
      if (!targetRel) return deny('read_file 需要 path 参数')
      const abs = path.resolve(cwd, targetRel)
      if (isSensitiveCredentialPath(abs)) {
        return deny(`安全护栏拒绝读取凭据文件：${path.basename(abs)}`, `🛡️ 拦截读取凭据`)
      }
      if (!fs.existsSync(abs)) return { tool, ok: false, error: `文件不存在：${abs}`, badge: `⚠️ 未找到 ${path.basename(abs)}` }
      try {
        const raw = fs.readFileSync(abs, 'utf8')
        const lines = raw.split(/\r?\n/)
        const startLine = Math.max(1, Math.round(Number(args.startLine) || 1))
        const endLine = Math.min(lines.length, Math.max(startLine, Math.round(Number(args.endLine) || (startLine + 179))))
        const numbered = lines.slice(startLine - 1, endLine).map((l, idx) => `${startLine + idx}: ${l}`).join('\n')
        return {
          tool,
          ok: true,
          path: abs,
          totalLines: lines.length,
          range: `${startLine}-${endLine}`,
          content: truncateMiddle(numbered, 14_000),
          badge: `📖 读取 ${path.basename(abs)}`,
        }
      } catch (err) {
        return { tool, ok: false, error: String(err && err.message ? err.message : err), badge: `⚠️ 读取失败` }
      }
    }

    case 'list_dir': {
      const targetRel = String(args.path || '.').trim() || '.'
      const abs = path.resolve(cwd, targetRel)
      if (!fs.existsSync(abs)) return { tool, ok: false, error: `目录不存在：${abs}`, badge: `⚠️ 目录不存在` }
      try {
        const items = fs.readdirSync(abs, { withFileTypes: true }).slice(0, 120).map(ent => {
          let size = 0
          if (ent.isFile()) {
            try { size = fs.statSync(path.join(abs, ent.name)).size } catch {}
          }
          return { name: ent.name, type: ent.isDirectory() ? 'dir' : 'file', ...(ent.isFile() ? { size } : {}) }
        })
        return { tool, ok: true, path: abs, items, badge: `📂 列目录 ${path.basename(abs) || abs}` }
      } catch (err) {
        return { tool, ok: false, error: String(err && err.message ? err.message : err), badge: `⚠️ 列目录失败` }
      }
    }

    case 'search_files': {
      const pattern = String(args.pattern || args.query || '').trim()
      if (!pattern) return deny('search_files 需要 pattern 参数')
      const searchRoot = path.resolve(cwd, String(args.path || '.').trim() || '.')
      if (!fs.existsSync(searchRoot)) return { tool, ok: false, error: `搜索目录不存在：${searchRoot}`, badge: `⚠️ 搜索目录不存在` }
      const maxHits = Math.min(50, Math.max(1, Math.round(Number(args.maxHits) || 30)))
      let hits = await runRgSearch(searchRoot, pattern, maxHits)
      if (hits === null) hits = searchFilesFallbackNode(searchRoot, pattern, maxHits)
      return { tool, ok: true, path: searchRoot, pattern, hits, count: hits.length, badge: `🔎 搜索 "${clamp(pattern, 18)}"` }
    }

    case 'write_file': {
      const targetRel = String(args.path || '').trim()
      if (!targetRel) return deny('write_file 需要 path 参数')
      const abs = path.resolve(cwd, targetRel)
      if (permissionMode === 'read-only') {
        return deny('当前参谋长权限为「👁 仅可查看」，已拦截文件写入。请切至「工作区内修改」或「🛡️ 完全权限」。', '🔒 仅可查看拦写')
      }
      if (permissionMode === 'auto-review') {
        return deny('当前参谋长权限为「🔍 自动审查 EXP」，写入需转为人工确认或切回「🛡️ 完全权限」。', '🔍 待审查拦写')
      }
      if (permissionMode === 'workspace-write' && !isPathInsideWorkspace(cwd, abs)) {
        return deny(`当前权限为「工作区内修改」，拒绝写入工作区外的路径：${abs}`, '🔒 越界拦写')
      }
      if (isSensitiveCredentialPath(abs)) {
        return deny(`安全护栏拒绝写入凭据文件：${path.basename(abs)}`, '🛡️ 拦截写凭据')
      }
      const boundCheck = checkForbiddenBounds(board, 'write_file', abs)
      if (boundCheck.blocked) {
        return deny(`命中禁止红线【${boundCheck.matchedRule}】，已拦截写入 ${abs}`, '🛡 红线拦写')
      }
      try {
        fs.mkdirSync(path.dirname(abs), { recursive: true })
        fs.writeFileSync(abs, String(args.content ?? ''), 'utf8')
        return { tool, ok: true, path: abs, bytes: Buffer.byteLength(String(args.content ?? ''), 'utf8'), badge: `✍️ 写入 ${path.basename(abs)}` }
      } catch (err) {
        return { tool, ok: false, error: String(err && err.message ? err.message : err), badge: `⚠️ 写入失败` }
      }
    }

    case 'edit_file': {
      const targetRel = String(args.path || '').trim()
      const targetStr = String(args.target ?? '')
      const replaceStr = String(args.replacement ?? '')
      if (!targetRel || !targetStr) return deny('edit_file 需要 path 与 target 参数')
      const abs = path.resolve(cwd, targetRel)
      if (permissionMode === 'read-only') {
        return deny('当前参谋长权限为「👁 仅可查看」，已拦截文件编辑。', '🔒 仅可查看拦改')
      }
      if (permissionMode === 'auto-review') {
        return deny('当前参谋长权限为「🔍 自动审查 EXP」，修改文件请切回「🛡️ 完全权限」。', '🔍 待审查拦改')
      }
      if (permissionMode === 'workspace-write' && !isPathInsideWorkspace(cwd, abs)) {
        return deny(`当前权限为「工作区内修改」，拒绝编辑工作区外的路径：${abs}`, '🔒 越界拦改')
      }
      if (isSensitiveCredentialPath(abs)) {
        return deny(`安全护栏拒绝编辑凭据文件：${path.basename(abs)}`, '🛡️ 拦截改凭据')
      }
      const boundCheck = checkForbiddenBounds(board, 'edit_file', abs)
      if (boundCheck.blocked) {
        return deny(`命中禁止红线【${boundCheck.matchedRule}】，已拦截编辑 ${abs}`, '🛡 红线拦改')
      }
      if (!fs.existsSync(abs)) return { tool, ok: false, error: `目标文件不存在：${abs}`, badge: `⚠️ 未找到 ${path.basename(abs)}` }
      try {
        const prev = fs.readFileSync(abs, 'utf8')
        const idx = prev.indexOf(targetStr)
        if (idx < 0) return { tool, ok: false, error: `未在 ${path.basename(abs)} 中匹配到 target 文本`, badge: `⚠️ 替换未命中` }
        const next = prev.slice(0, idx) + replaceStr + prev.slice(idx + targetStr.length)
        fs.writeFileSync(abs, next, 'utf8')
        return { tool, ok: true, path: abs, badge: `✏️ 修改 ${path.basename(abs)}` }
      } catch (err) {
        return { tool, ok: false, error: String(err && err.message ? err.message : err), badge: `⚠️ 编辑失败` }
      }
    }

    case 'run_command': {
      const command = String(args.command || args.cmd || '').trim()
      if (!command) return deny('run_command 需要 command 参数')
      const runCwd = path.resolve(cwd, String(args.cwd || '.').trim() || '.')
      const boundCheck = checkForbiddenBounds(board, 'run_command', command)
      if (boundCheck.blocked) {
        return deny(`命中禁止红线【${boundCheck.matchedRule}】，参谋长拒绝执行命令：${clamp(command, 80)}`, '🛡 红线拦截命令')
      }
      if (permissionMode === 'read-only' && !isReadOnlyShellCommand(command)) {
        return deny(`当前权限为「👁 仅可查看」，仅允许只读检查命令，已拦截：${clamp(command, 60)}`, '🔒 仅查看拦截命令')
      }
      if (permissionMode === 'auto-review' && !isReadOnlyShellCommand(command)) {
        return deny(`当前权限为「🔍 自动审查 EXP」，变更性命令需人工授权或切至「🛡️ 完全权限」：${clamp(command, 60)}`, '🔍 待审查拦截')
      }
      if (permissionMode === 'workspace-write' && !isPathInsideWorkspace(cwd, runCwd)) {
        return deny(`当前权限为「工作区内修改」，拒绝在工作区外目录执行命令：${runCwd}`, '🔒 工作区外拒跑')
      }
      if (!fs.existsSync(runCwd)) return { tool, ok: false, error: `工作目录不存在：${runCwd}`, badge: `⚠️ 目录不存在` }
      const execOut = await runSubprocess(command, runCwd, args.timeoutMs)
      return {
        tool,
        ok: execOut.ok,
        exitCode: execOut.exitCode,
        timedOut: execOut.timedOut,
        cwd: runCwd,
        stdout: execOut.stdout,
        stderr: execOut.stderr,
        badge: `⚡ 执行 (${execOut.timedOut ? '超时' : 'exit ' + execOut.exitCode})`,
      }
    }

    case 'subagent_dispatch': {
      if (permissionMode === 'read-only') {
        return deny('当前权限为「👁 仅可查看」，无法派发子代理任务。', '🔒 只读禁派')
      }
      const prompt = String(args.prompt || args.message || args.text || '').trim()
      if (!prompt) return deny('subagent_dispatch 需要 prompt 指令')
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
        return { tool, ok: false, error: '当前宿主未挂载子代理调度接口', badge: '⚠️ 无子代理引擎' }
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
      return {
        tool,
        ok: Boolean(dRes && dRes.ok),
        ...(dRes || {}),
        badge: dRes && dRes.ok ? `🚀 派发 @${dRes.dispatched?.agent || args.agent || 'worker'}` : '⚠️ 派发失败',
      }
    }

    case 'subagent_steer': {
      if (permissionMode === 'read-only') return deny('当前权限为「👁 仅可查看」，无法向子代理发指令。')
      if (typeof deps.executeSubagentAction !== 'function') return { tool, ok: false, error: '当前宿主未挂载子代理接口' }
      const sRes = await deps.executeSubagentAction({
        action: 'team.steer',
        agent: args.agent || args.target || '',
        id: args.taskId || args.id || '',
        message: args.message || args.prompt || args.text || '',
        session: rootId,
        by: 'chief',
      })
      return { tool, ok: Boolean(sRes && sRes.ok), ...(sRes || {}), badge: sRes && sRes.ok ? `💬 引导 @${args.agent || 'worker'}` : '⚠️ 引导失败' }
    }

    case 'subagent_interrupt': {
      if (permissionMode === 'read-only') return deny('当前权限为「👁 仅可查看」，无法中断子代理。')
      if (typeof deps.executeSubagentAction !== 'function') return { tool, ok: false, error: '当前宿主未挂载子代理接口' }
      const iRes = await deps.executeSubagentAction({
        action: 'team.interrupt',
        agent: args.agent || args.target || '',
        id: args.taskId || args.id || '',
        session: rootId,
        by: 'chief',
      })
      return { tool, ok: Boolean(iRes && iRes.ok), ...(iRes || {}), badge: iRes && iRes.ok ? `⏹ 中断 @${args.agent || 'worker'}` : '⚠️ 中断失败' }
    }

    case 'archive_write': {
      if (permissionMode === 'read-only') return deny('当前权限为「👁 仅可查看」，不能写入档案柜。')
      if (typeof execCtx.upsertArchiveFn !== 'function') {
        return { tool, ok: false, error: '档案写入服务未就绪', badge: '⚠️ 无档案写口' }
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
      return {
        tool,
        ok: Boolean(out && out.ok),
        ...(out || {}),
        badge: out && out.ok ? `🗄️ 归档(${scope === 'global' ? '全局' : '本会话'})` : '⚠️ 归档失败',
      }
    }

    case 'session_compact': {
      if (permissionMode === 'read-only') return deny('当前权限为「👁 仅可查看」，不能触发上下文压缩。')
      if (typeof execCtx.compactNowFn !== 'function') {
        return { tool, ok: false, error: '压缩服务未就绪', badge: '⚠️ 无压缩引擎' }
      }
      const cRes = await execCtx.compactNowFn(String(args.reason || '参谋长主动执行抢救与上下文压缩'))
      return {
        tool,
        ok: Boolean(cRes && cRes.ok),
        ...(cRes || {}),
        badge: cRes && cRes.ok ? '🗜 完成抢救压缩' : '⚠️ 压缩跳过',
      }
    }

    default:
      return deny(`未知参谋长工具：${tool}`, `⚠️ 未知工具 ${tool}`)
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
  board = null,
  maxSteps = 4,
  readOnlyToolsOnly = false,
  disableTools = false,
  callLlmFn,
  extractJsonFn,
  upsertArchiveFn,
  compactNowFn,
} = {}) {
  const perm = normalizePermissionMode(permissionMode)
  const cwd = (typeof deps?.getSessionCwd === 'function' ? deps.getSessionCwd(rootId || sessionId) : '') || process.cwd()
  const toolBadges = []
  const toolRecords = []
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
      return { ok: false, llmRes: lastLlmRes, parsed: null, toolBadges, toolRecords }
    }
    const cleanedRes = cleanRes(lastLlmRes)
    parsed = typeof extractJsonFn === 'function' ? extractJsonFn(cleanedRes.text) : null
    if (parsed && typeof parsed.reply === 'string') {
      parsed.reply = stripToolCallMarkup(parsed.reply)
    }
    return { ok: true, llmRes: cleanedRes, parsed, toolBadges, toolRecords }
  }

  const permHeader = `\n\n[当前参谋长权限级别] permissionMode="${perm}"${perm === 'danger-full-access' ? '（最高完全权限：允许直接读写文件、执行命令、调度子代理、治理看板与归档压缩）' : perm === 'workspace-write' ? `（工作区内修改：仅限 ${cwd} 内写入与跑命令）` : perm === 'read-only' ? '（仅可查看：只读检查，拒绝一切写入和变更操作）' : '（自动审查 EXP：可只读查证，变更需转建议或切完全权限）'}`
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
      return { ok: false, llmRes: lastLlmRes, parsed: null, toolBadges, toolRecords }
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
      return { ok: true, llmRes: cleanedRes, parsed, toolBadges, toolRecords }
    }

    // 执行本轮工具调用
    ranToolsOnLastStep = true
    const stepOutputs = []
    for (const c of calls) {
      const execRes = await executeChiefToolCall(deps, c, {
        rootId,
        sessionId: sessionId || rootId,
        cwd,
        permissionMode: perm,
        board,
        readOnlyToolsOnly,
        upsertArchiveFn,
        compactNowFn,
      })
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
      isFinalStepSoon
        ? '你已接近本轮工具调用步数上限，请立即基于上述真实回执输出最终结论 JSON（务必不要再带 `"toolCalls"` 或任何 DSML/XML 标签）。'
        : '请根据上述真实回执决定：若仍需进一步查看/修改/验证则继续附带下一批 `"toolCalls"`；否则直接输出最终结论 JSON（不再包含 `"toolCalls"` 或 DSML 标签）。',
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
  return { ok: Boolean(finalRes && finalRes.ok), llmRes: finalRes, parsed, toolBadges, toolRecords }
}
