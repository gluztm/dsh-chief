/**
 * safety/invariant-guards.js
 *
 * Non-overridable Hard Guards: destructive shell command prevention,
 * credential touch blocking, workspace boundary containment, and user
 * `bounds.forbidden` enforcement across compound commands and inline scripts.
 */

import path from 'node:path'
import { analyzeCommand, normalizeCommandForSecurity } from './command-analyzer.js'
import { validateWorkspacePath } from './path-guard.js'

export const HARD_GUARD_RULE_IDS = Object.freeze([
  'sensitive_credential',
  'sensitive_credential_cmd',
  'inline_script_credential',
  'windows_reserved_device',
  'ntfs_ads_stream',
  'workspace_escape',
  'destructive_command',
  'forbidden_bound',
])

const DESTRUCTIVE_COMMAND_PATTERNS = [
  /\brm\s+-[a-z]*(?:r[a-z]*f|f[a-z]*r)[a-z]*\s+(?:\/(?:etc|usr|bin|sbin|var|lib|boot|dev|proc|sys|root|home|\*)?(?=$|[\s/'")])|~|\*|\.\.)/i,
  /\bgit\s+(?:reset\s+--hard|clean\s+-[a-z]*f[a-z]*d|push\s+(?:--force|-f)\b)/i,
  /(?:^|[;&|]\s*|(?:(?:sudo|doas|nohup|command)\s+)+|(?:cmd(?:\.exe)?\s+\/[ck]|(?:powershell|pwsh)(?:\.exe)?\s+-[a-z]*c\w*|(?:bash|sh|zsh)\s+-[a-z]*c)\s+["']?)\b(?:diskpart(?:\.exe)?|cipher(?:\.exe)?\s+\/w|bcdedit(?:\.exe)?)\b/i,
  /(?:^|[;&|]\s*|(?:cmd(?:\.exe)?\s+\/c|powershell(?:\.exe)?\s+-[a-z]*c\w*|pwsh(?:\.exe)?\s+-[a-z]*c\w*)\s+["']?)\bformat(?:\.com)?\s+(?:[a-z]:|\/(?:fs|q|v|x|p|y)\b)/i,
  /\bdel\s+\/[fqs][^\n]*[a-z]:\\/i,
  /\bRemove-Item\b[^\n]*-Recurse[^\n]*-Force[^\n]*(?:[a-z]:\\|\*)/i,
  /(?:^|[;&|]\s*|(?:(?:sudo|doas|nohup|command)\s+)+|(?:cmd(?:\.exe)?\s+\/[ck]|(?:powershell|pwsh)(?:\.exe)?\s+-[a-z]*c\w*|(?:bash|sh|zsh)\s+-[a-z]*c)\s+["']?)(?:(?:\/usr)?\/s?bin\/)?(?:shutdown(?:\.exe)?|restart-computer|stop-computer|mkfs(?:\.[a-z0-9]+)?)(?=$|[\s;'"])/i,
  /\b(?:shutdown(?:\.exe)?\s+(?:-[hrspPfk]|\/[srphtl]|now\b)|mkfs(?:\.[a-z0-9]+)?\s+\/dev\/|dd\s+if=\S+[^\n]*\bof=\/dev\/)/i,
  /\breg(?:\.exe)?\s+delete\s+(?:hklm|hkcr|hkcu\\software\\microsoft)\b/i,
  /\bdrop\s+(?:database|schema)\b/i,
]

const CREDENTIAL_TOUCH_RE = /(?:^|[\s"'=/\\:;>|&(\[,])(?:\.+\\*env(?:\.[a-z0-9_-]+)?|\.+\\*credentials(?:\.[a-z0-9_-]+)?|\.\\*(?:git-credentials|npmrc|pypirc|netrc)|id_rsa|id_ed25519|id_ecdsa|id_dsa|[a-z0-9_.-]+\.(?:pem|p12|pfx))(?:$|[\s"';&|><)\],\r\n])/i

function stripQuotedBackslashSplits(text) {
  return String(text || '')
    .replace(/\\+(["'`])/g, '$1')
    .replace(/(["'`])\\+(?=[a-zA-Z0-9_.-])/g, '$1')
    .replace(/["'`]/g, '')
}

function clamp(text, maxLen = 200) {
  const s = String(text || '').trim()
  return s.length > maxLen ? s.slice(0, maxLen) + '...' : s
}

function expandEnvPlaceholdersForCheck(text) {
  return String(text || '')
    .replace(/%[A-Za-z0-9_]+%/g, '/')
    .replace(/\$env:[A-Za-z0-9_]+/gi, '/')
    .replace(/\$\{[A-Za-z0-9_]+\}/g, '/')
}

const DANGEROUS_PIPE_CONSUMER_RE = /\|\s*(?:sudo\s+)?(?:(?:\/usr)?\/s?bin\/)?(?:sh|bash|zsh|dash|ksh|cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh(?:\.exe)?|node(?:\.exe)?|python\d*|py|perl|ruby|php|mysql|psql|sqlite3?|sqlcmd|eval|iex|xargs)\b/i
const EXEC_SCRIPT_EXT_RE = /\.(?:sh|bash|zsh|ps1|bat|cmd)$/i

function stripLeadingEnvAssignments(seg) {
  return String(seg || '')
    .trim()
    .replace(/^(?:export\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"]*"|\S*)\s+)*/i, '')
    .trim()
}

function stripNonExecHeredocBodies(command) {
  const raw = String(command || '')
  if (!raw.includes('<<')) return raw
  const lines = raw.split(/\r?\n/)
  const out = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    out.push(line)
    const hdMatch = line.match(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_-]*)\1/)
    if (!hdMatch || !hdMatch[2]) continue
    const delim = hdMatch[2]
    let endIdx = -1
    for (let j = i + 1; j < lines.length; j += 1) {
      if (lines[j].trim() === delim) {
        endIdx = j
        break
      }
    }
    if (endIdx < 0) continue

    const lastSeg = line.split(/;|&&|\|\|/).pop() || ''
    const hasDangerPipe = DANGEROUS_PIPE_CONSUMER_RE.test(line)
    const cmdHead = stripLeadingEnvAssignments(lastSeg)
    const cmdM = cmdHead.match(/^([^\s;&|]+)/)
    const primaryCmd = cmdM ? path.basename(cmdM[1]).toLowerCase() : ''
    const isCatOrTee = primaryCmd === 'cat' || primaryCmd === 'tee' || primaryCmd === 'cat.exe' || primaryCmd === 'tee.exe'

    const redirM = lastSeg.match(/>>?\s*(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/)
    const teeArgM = primaryCmd.startsWith('tee')
      ? cmdHead.replace(/^tee(?:\.exe)?(?:\s+-[a-z]+)*\s+/i, '').match(/^(?:"([^"]+)"|'([^']+)'|([^\s;&|<>]+))/)
      : null
    const targetFile = (redirM && (redirM[1] || redirM[2] || redirM[3]))
      || (teeArgM && (teeArgM[1] || teeArgM[2] || teeArgM[3]))
      || ''
    const safeTarget = Boolean(targetFile)
      && !/^\/dev\//i.test(targetFile)
      && !EXEC_SCRIPT_EXT_RE.test(targetFile.trim())

    if (isCatOrTee && safeTarget && !hasDangerPipe) {
      for (let k = i + 1; k < endIdx; k += 1) out.push('')
      out.push(lines[endIdx])
      i = endIdx
    }
  }
  return out.join('\n')
}

function isBenignGitReadOrCommit(cmdText) {
  const tokens = String(cmdText || '').trim().split(/\s+/).filter(Boolean)
  if (!tokens.length || !/^git(?:\.exe)?$/i.test(path.basename(tokens[0]))) return false
  const valFlags = new Set(['-C', '--git-dir', '--work-tree'])
  const boolFlags = new Set(['-p', '--paginate', '-P', '--no-pager', '--bare'])
  let i = 1
  while (i < tokens.length) {
    const tok = tokens[i]
    if (valFlags.has(tok)) {
      i += 2
      continue
    }
    if (boolFlags.has(tok) || /^--(?:git-dir|work-tree)=/i.test(tok)) {
      i += 1
      continue
    }
    if (tok.startsWith('-')) return false
    break
  }
  const sub = tokens[i] ? tokens[i].toLowerCase() : ''
  return sub === 'log' || sub === 'show' || sub === 'diff' || sub === 'status' || sub === 'branch' || sub === 'commit'
}

function isBenignTextOnlySegment(seg, hasDangerousConsumer) {
  const s = String(seg || '').trim()
  if (!s) return false
  if (/\$\(|`|>\s*\/dev\/|>>?\s*["']?[^\s"']+\.(?:sh|bash|zsh|ps1|bat|cmd)(?:["'\s]|$)/i.test(s)) {
    return false
  }
  const cleaned = stripLeadingEnvAssignments(s)
  if (!cleaned) return true
  if (/^(?:grep|egrep|fgrep|rg|ag|ack)(?:\.exe)?(?=\s|$)/i.test(cleaned)) {
    return true
  }
  if (isBenignGitReadOrCommit(cleaned)) {
    return true
  }
  if (/^(?:echo|printf)(?:\.exe)?(?=\s|$)/i.test(cleaned) && !hasDangerousConsumer) {
    return true
  }
  return false
}

export function isDestructiveShellCommand(command) {
  const raw = String(command || '').trim()
  if (!raw) return false
  const sanitized = stripNonExecHeredocBodies(raw)
  const hasDangerousConsumer = DANGEROUS_PIPE_CONSUMER_RE.test(sanitized)
  const analysis = analyzeCommand(sanitized)
  for (const seg of analysis.segments) {
    if (!seg) continue
    if (isBenignTextOnlySegment(seg, hasDangerousConsumer)) continue
    if (DESTRUCTIVE_COMMAND_PATTERNS.some(re => re.test(seg))) return true
    const normSeg = normalizeCommandForSecurity(seg)
    if (normSeg && DESTRUCTIVE_COMMAND_PATTERNS.some(re => re.test(normSeg))) return true
  }
  for (const payload of analysis.inlinePayloads) {
    if (!payload) continue
    if (DESTRUCTIVE_COMMAND_PATTERNS.some(re => re.test(payload))) return true
    const normPayload = normalizeCommandForSecurity(payload)
    if (normPayload && DESTRUCTIVE_COMMAND_PATTERNS.some(re => re.test(normPayload))) return true
  }
  return false
}

export function commandTouchesSensitiveCredential(command) {
  const raw = String(command || '')
  if (!raw.trim()) return { touched: false, viaInline: false }
  const analysis = analyzeCommand(raw)

  for (const payload of analysis.inlinePayloads) {
    const normPayload = normalizeCommandForSecurity(payload)
    const expPayload = expandEnvPlaceholdersForCheck(normPayload)
    const strippedPayload = stripQuotedBackslashSplits(payload)
    if (
      CREDENTIAL_TOUCH_RE.test(payload)
      || CREDENTIAL_TOUCH_RE.test(strippedPayload)
      || CREDENTIAL_TOUCH_RE.test(normPayload)
      || CREDENTIAL_TOUCH_RE.test(expPayload)
    ) {
      return { touched: true, viaInline: true }
    }
  }

  const probes = [
    raw,
    stripQuotedBackslashSplits(raw),
    analysis.normalized,
    stripQuotedBackslashSplits(analysis.normalized),
    expandEnvPlaceholdersForCheck(analysis.normalized),
    ...analysis.segments,
    ...analysis.segments.map(seg => stripQuotedBackslashSplits(seg)),
    ...analysis.segments.map(seg => expandEnvPlaceholdersForCheck(normalizeCommandForSecurity(seg))),
  ]
  for (const probe of probes) {
    if (probe && CREDENTIAL_TOUCH_RE.test(probe)) {
      return { touched: true, viaInline: false }
    }
  }
  return { touched: false, viaInline: false }
}

/**
 * 无论当前处于何种权限级别（包括 chief），都坚决守住用户在看板中设定的禁止红线。
 */
export function checkForbiddenBounds(board, actionDesc = '', commandOrPath = '', extraContent = '') {
  const forbidden = [
    ...((board && board.bounds && Array.isArray(board.bounds.forbidden)) ? board.bounds.forbidden : []),
    ...((board && board.pinnedBounds && Array.isArray(board.pinnedBounds.forbidden)) ? board.pinnedBounds.forbidden : []),
  ]
  if (!forbidden.length) return { blocked: false }
  const primary = String(commandOrPath || '')
  const analysis = analyzeCommand(primary)
  const normCmd = analysis.normalized
  const contentSample = String(extraContent || '').slice(0, 8192).normalize('NFKC')
  const extraSegments = [
    ...analysis.segments,
    ...analysis.inlinePayloads,
  ].join(' \n ')
  const haystack = [
    String(actionDesc || ''),
    primary,
    primary.replace(/\\/g, '/'),
    normCmd,
    normCmd.replace(/\\/g, '/'),
    extraSegments,
    extraSegments.replace(/\\/g, '/'),
    contentSample,
    contentSample.replace(/\\/g, '/'),
  ].join(' \n ').toLowerCase()

  for (const rule of forbidden) {
    const rText = String(rule || '').trim()
    if (!rText) continue
    const ruleNorm = rText.replace(/\\/g, '/')
    const ruleLower = ruleNorm.toLowerCase()

    // 1. 提取反引号或引号内的受禁命令或路径字面量
    const quoted = [
      ...[...ruleNorm.matchAll(/`([^`]{2,80})`/g)].map(m => m[1]),
      ...[...ruleNorm.matchAll(/["'「『]([^"'」』]{2,80})["'」』]/g)].map(m => m[1]),
    ].map(s => s.trim().toLowerCase())
    for (const token of quoted) {
      if (token && haystack.includes(token)) {
        return { blocked: true, matchedRule: rText, trigger: token }
      }
    }

    // 2. 提取不带反引号的文件名、路径片段、点文件或扩展名
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

const WORKSPACE_SCOPED_FS_TOOLS = new Set(['read_file', 'write_file', 'edit_file', 'list_dir', 'search_files'])

/** 安全卫兵硬性规则：优先于四级权限判定与策略插件，L3 与逐项放行均不可绕过。 */
export function evaluateSafetyGuardHardRules({
  tool = '',
  opClass = '',
  targetPath = '',
  command = '',
  content = '',
  target = '',
  replacement = '',
  extraContent = '',
  args = null,
  cwd = '',
  board = null,
  safetyGuardEnabled = true,
} = {}) {
  if (safetyGuardEnabled === false) {
    return { blocked: false, bypassedBySafetyGuardToggle: true }
  }
  const argObj = args && typeof args === 'object' ? args : {}
  const resolvedPath = targetPath || (typeof argObj.path === 'string' ? argObj.path : '')
  const resolvedCommand = command || (typeof argObj.command === 'string' ? argObj.command : (typeof argObj.cmd === 'string' ? argObj.cmd : ''))

  if (resolvedPath) {
    const enforceRoot = WORKSPACE_SCOPED_FS_TOOLS.has(String(tool || '').trim()) ? cwd : ''
    const pathCheck = validateWorkspacePath(enforceRoot, resolvedPath, { mode: opClass === 'read' ? 'read' : 'write' })
    if (pathCheck.blocked) {
      return pathCheck
    }
  }

  if (tool === 'run_command' && cwd && typeof argObj.cwd === 'string' && argObj.cwd.trim()) {
    const runCwdCheck = validateWorkspacePath(cwd, path.resolve(cwd, argObj.cwd.trim()), { mode: 'write' })
    if (runCwdCheck.blocked) {
      return {
        ...runCwdCheck,
        reason: runCwdCheck.rule === 'workspace_escape'
          ? `安全卫兵拦截工作区外命令执行目录 (cwd)：${argObj.cwd}`
          : runCwdCheck.reason,
      }
    }
  }

  if (resolvedCommand) {
    const credTouch = commandTouchesSensitiveCredential(resolvedCommand)
    if (credTouch.touched) {
      return {
        blocked: true,
        stage: 'safety_guard',
        rule: credTouch.viaInline ? 'inline_script_credential' : 'sensitive_credential_cmd',
        reason: credTouch.viaInline
          ? '安全卫兵拦截内联脚本（node -e / python -c / pwsh）触及敏感凭据文件（.env / .credentials / 私钥）'
          : '安全卫兵拦截触及敏感凭据路径（.env / .credentials / 私钥证书）的终端命令',
        badge: '🛡️ 卫兵拦凭据命令',
      }
    }
    if (isDestructiveShellCommand(resolvedCommand)) {
      return {
        blocked: true,
        stage: 'safety_guard',
        rule: 'destructive_command',
        reason: `安全卫兵拦截高危毁灭性系统命令：${clamp(resolvedCommand, 80)}`,
        badge: '🛡️ 卫兵拦高危命令',
      }
    }
  }

  if (opClass !== 'read' && opClass !== 'elevation_request') {
    const checkInput = resolvedPath || resolvedCommand
    const payloadParts = [
      content,
      target,
      replacement,
      extraContent,
      argObj.content,
      argObj.target,
      argObj.replacement,
      argObj.prompt,
      argObj.message,
      argObj.text,
      argObj.body,
    ]
      .filter(v => v !== undefined && v !== null && String(v).trim())
      .map(v => String(v).slice(0, 8192))
    const mergedExtra = payloadParts.join('\n').slice(0, 12_288)
    const boundCheck = checkForbiddenBounds(board, tool, checkInput, mergedExtra)
    if (boundCheck.blocked) {
      return {
        blocked: true,
        stage: 'safety_guard',
        rule: 'forbidden_bound',
        matchedRule: boundCheck.matchedRule,
        reason: `安全卫兵命中禁止红线【${boundCheck.matchedRule}】，坚决拦截：${clamp(checkInput || tool, 80)}`,
        badge: '🛡️ 卫兵拦红线',
      }
    }
  }
  return { blocked: false }
}
