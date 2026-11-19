/**
 * safety/policy-plugin.js
 *
 * Restrict-only Policy Plugin validation and runtime evaluation for DSH Chief.
 * Plugins may tighten or narrow permissions and rules, NEVER weaken Hard Guards.
 */

import path from 'node:path'
import { analyzeCommand } from './command-analyzer.js'
import { safeRealpath } from './path-guard.js'

const ROLE_ORDER = {
  advisor: 0,
  assistant: 1,
  strategist: 2,
  chief: 3,
}

export const FORBIDDEN_WEAKENING_KEYS = Object.freeze([
  'disableHardGuard',
  'bypassHardGuard',
  'allowOutsideWorkspace',
  'allowSensitiveCredentials',
  'allowDestructiveCommands',
  'bypassApproval',
  'relaxForbiddenBounds',
  'overrideExecutor',
  'autoApproveAll',
  'allowFifthRole',
  'skipHardGuard',
  'disableAudit',
  'allowNtfsAds',
  'allowBoundsWriteFromTool',
  'unrestrictedWrite',
])

const ALLOWED_TOP_KEYS = new Set(['id', 'name', 'version', 'source', 'enabled', 'description', 'rules'])
const ALLOWED_RULE_KEYS = new Set([
  'maxRoleCeiling',
  'maxSubagentRoleCeiling',
  'denyTools',
  'requireApprovalTools',
  'forbidPathPrefixes',
  'restrictFsWritePrefixes',
  'forbidCommandPatterns',
  'requireApprovalCommandPatterns',
])
const SUBAGENT_SAFE_ROLES = new Set(['advisor', 'assistant'])

function containsFunctionValue(obj, depth = 0) {
  if (depth > 8 || obj == null) return false
  if (typeof obj === 'function') return true
  if (typeof obj !== 'object') return false
  if (Array.isArray(obj)) return obj.some(v => containsFunctionValue(v, depth + 1))
  for (const val of Object.values(obj)) {
    if (containsFunctionValue(val, depth + 1)) return true
  }
  return false
}

function normalizeStringArray(raw, { fieldName, maxItems = 40, maxLen = 160 } = {}) {
  if (raw === undefined) return { ok: true, list: [] }
  if (!Array.isArray(raw)) {
    return { ok: false, code: 'POLICY_PLUGIN_SCHEMA_INVALID', error: `规则字段 ${fieldName} 必须为字符串数组` }
  }
  if (raw.length > maxItems) {
    return { ok: false, code: 'POLICY_PLUGIN_SCHEMA_INVALID', error: `规则字段 ${fieldName} 条目数超出上限 (${maxItems})` }
  }
  const out = []
  for (const entry of raw) {
    if (typeof entry !== 'string') {
      return { ok: false, code: 'POLICY_PLUGIN_SCHEMA_INVALID', error: `规则字段 ${fieldName} 仅允许字符串条目` }
    }
    const clean = entry.trim()
    if (!clean) continue
    if (clean.length > maxLen) {
      return { ok: false, code: 'POLICY_PLUGIN_SCHEMA_INVALID', error: `规则字段 ${fieldName} 单条长度超出上限 (${maxLen})` }
    }
    out.push(clean)
  }
  return { ok: true, list: [...new Set(out)] }
}

function validateSafeRegexPatterns(list, fieldName) {
  for (const pat of list) {
    // Reject obvious catastrophic backtracking constructs such as `(a+)+` or `(.*)*`
    if (/\([^)]*[+*][^)]*\)[+*{]/.test(pat)) {
      return { ok: false, code: 'POLICY_PLUGIN_UNSAFE_PATTERN', error: `拒绝含嵌套量词的正则规则 (${fieldName}): ${pat}` }
    }
    try {
      // eslint-disable-next-line no-new
      new RegExp(pat, 'i')
    } catch {
      return { ok: false, code: 'POLICY_PLUGIN_SCHEMA_INVALID', error: `策略插件正则语法无效 (${fieldName}): ${pat}` }
    }
  }
  return { ok: true }
}

export function validatePolicyPlugin(rawPlugin) {
  if (!rawPlugin || typeof rawPlugin !== 'object' || Array.isArray(rawPlugin)) {
    return { ok: false, code: 'POLICY_PLUGIN_SCHEMA_INVALID', error: '策略插件必须是 JSON 对象' }
  }
  if (containsFunctionValue(rawPlugin)) {
    return { ok: false, code: 'POLICY_PLUGIN_WEAKENING_FORBIDDEN', error: '策略插件禁止携带可执行函数回调（仅允许声明式 JSON 规则）' }
  }

  for (const k of Object.keys(rawPlugin)) {
    if (FORBIDDEN_WEAKENING_KEYS.includes(k)) {
      return {
        ok: false,
        code: 'POLICY_PLUGIN_WEAKENING_FORBIDDEN',
        error: `策略插件禁止包含削弱/关闭安全卫兵的字段 "${k}"（只允许收紧规则）`,
      }
    }
    if (!ALLOWED_TOP_KEYS.has(k)) {
      return { ok: false, code: 'POLICY_PLUGIN_SCHEMA_INVALID', error: `策略插件包含未定义顶层字段 "${k}"` }
    }
  }

  const id = String(rawPlugin.id || '').trim()
  const name = String(rawPlugin.name || id).trim()
  const version = String(rawPlugin.version || '1.0.0').trim()
  const source = String(rawPlugin.source || 'workspace').trim()
  if (!id || !/^[a-zA-Z0-9._-]{2,64}$/.test(id)) {
    return { ok: false, code: 'POLICY_PLUGIN_SCHEMA_INVALID', error: '策略插件缺少合法 id（仅允许字母/数字/._-，2~64字符）' }
  }
  if (!name || name.length > 80) {
    return { ok: false, code: 'POLICY_PLUGIN_SCHEMA_INVALID', error: '策略插件 name 必须为 1~80 字符' }
  }
  if (rawPlugin.enabled !== undefined && typeof rawPlugin.enabled !== 'boolean') {
    return { ok: false, code: 'POLICY_PLUGIN_SCHEMA_INVALID', error: '策略插件 enabled 必须为布尔值' }
  }

  const rawRules = rawPlugin.rules && typeof rawPlugin.rules === 'object' && !Array.isArray(rawPlugin.rules)
    ? rawPlugin.rules
    : (rawPlugin.rules === undefined ? {} : null)
  if (!rawRules) {
    return { ok: false, code: 'POLICY_PLUGIN_SCHEMA_INVALID', error: '策略插件 rules 必须为对象' }
  }

  for (const rk of Object.keys(rawRules)) {
    if (FORBIDDEN_WEAKENING_KEYS.includes(rk)) {
      return {
        ok: false,
        code: 'POLICY_PLUGIN_WEAKENING_FORBIDDEN',
        error: `策略插件 rules 禁止包含削弱安全规则的字段 "${rk}"`,
      }
    }
    if (!ALLOWED_RULE_KEYS.has(rk)) {
      return { ok: false, code: 'POLICY_PLUGIN_SCHEMA_INVALID', error: `策略插件 rules 包含未授权字段 "${rk}"` }
    }
  }

  let maxRoleCeiling = ''
  if (rawRules.maxRoleCeiling !== undefined) {
    const r = String(rawRules.maxRoleCeiling || '').trim().toLowerCase()
    if (!Object.prototype.hasOwnProperty.call(ROLE_ORDER, r)) {
      return { ok: false, code: 'POLICY_PLUGIN_SCHEMA_INVALID', error: `无效的 maxRoleCeiling 值：${r}` }
    }
    maxRoleCeiling = r
  }

  let maxSubagentRoleCeiling = ''
  if (rawRules.maxSubagentRoleCeiling !== undefined) {
    const sr = String(rawRules.maxSubagentRoleCeiling || '').trim().toLowerCase()
    if (!SUBAGENT_SAFE_ROLES.has(sr)) {
      return {
        ok: false,
        code: 'POLICY_PLUGIN_WEAKENING_FORBIDDEN',
        error: `子代理角色上限只允许收紧至 advisor 或 assistant（收到 "${sr}"）`,
      }
    }
    maxSubagentRoleCeiling = sr
  }

  const denyToolsRes = normalizeStringArray(rawRules.denyTools, { fieldName: 'denyTools' })
  if (!denyToolsRes.ok) return denyToolsRes

  const reqAprToolsRes = normalizeStringArray(rawRules.requireApprovalTools, { fieldName: 'requireApprovalTools' })
  if (!reqAprToolsRes.ok) return reqAprToolsRes

  const forbidPathsRes = normalizeStringArray(rawRules.forbidPathPrefixes, { fieldName: 'forbidPathPrefixes' })
  if (!forbidPathsRes.ok) return forbidPathsRes

  const restrictWriteRes = normalizeStringArray(rawRules.restrictFsWritePrefixes, { fieldName: 'restrictFsWritePrefixes' })
  if (!restrictWriteRes.ok) return restrictWriteRes
  if (restrictWriteRes.list.some(p => p === '*' || p === '**' || p === '/' || p === '.')) {
    return {
      ok: false,
      code: 'POLICY_PLUGIN_WEAKENING_FORBIDDEN',
      error: 'restrictFsWritePrefixes 仅用于限定子目录白名单，禁止填写通配放宽符 (* / .)',
    }
  }

  const forbidCmdsRes = normalizeStringArray(rawRules.forbidCommandPatterns, { fieldName: 'forbidCommandPatterns' })
  if (!forbidCmdsRes.ok) return forbidCmdsRes
  const patCheck1 = validateSafeRegexPatterns(forbidCmdsRes.list, 'forbidCommandPatterns')
  if (!patCheck1.ok) return patCheck1

  const reqAprCmdsRes = normalizeStringArray(rawRules.requireApprovalCommandPatterns, { fieldName: 'requireApprovalCommandPatterns' })
  if (!reqAprCmdsRes.ok) return reqAprCmdsRes
  const patCheck2 = validateSafeRegexPatterns(reqAprCmdsRes.list, 'requireApprovalCommandPatterns')
  if (!patCheck2.ok) return patCheck2

  return {
    ok: true,
    plugin: {
      id,
      name,
      version: version.slice(0, 32),
      source: source.slice(0, 48),
      enabled: rawPlugin.enabled !== false,
      description: String(rawPlugin.description || '').trim().slice(0, 200),
      rules: {
        ...(maxRoleCeiling ? { maxRoleCeiling } : {}),
        ...(maxSubagentRoleCeiling ? { maxSubagentRoleCeiling } : {}),
        denyTools: denyToolsRes.list,
        requireApprovalTools: reqAprToolsRes.list,
        forbidPathPrefixes: forbidPathsRes.list,
        restrictFsWritePrefixes: restrictWriteRes.list,
        forbidCommandPatterns: forbidCmdsRes.list,
        requireApprovalCommandPatterns: reqAprCmdsRes.list,
      },
    },
  }
}

export function validatePolicyPluginList(list) {
  if (list === undefined || list === null) return { ok: true, plugins: [] }
  if (!Array.isArray(list)) {
    return { ok: false, code: 'POLICY_PLUGIN_SCHEMA_INVALID', error: 'policyPlugins 必须为数组' }
  }
  if (list.length > 20) {
    return { ok: false, code: 'POLICY_PLUGIN_SCHEMA_INVALID', error: 'policyPlugins 数量超出上限 (20)' }
  }
  const out = []
  const seenIds = new Set()
  for (const raw of list) {
    const res = validatePolicyPlugin(raw)
    if (!res.ok) return res
    if (seenIds.has(res.plugin.id)) {
      return { ok: false, code: 'POLICY_PLUGIN_SCHEMA_INVALID', error: `存在重复的策略插件 id: ${res.plugin.id}` }
    }
    seenIds.add(res.plugin.id)
    out.push(res.plugin)
  }
  return { ok: true, plugins: out }
}

function normalizeRelPrefix(cwd, targetPath) {
  if (!targetPath) return ''
  const rootAbs = cwd ? safeRealpath(cwd) : ''
  const abs = rootAbs ? path.resolve(rootAbs, String(targetPath)) : path.resolve(String(targetPath))
  const rel = rootAbs ? path.relative(rootAbs, abs) : abs
  return rel.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()
}

function intersectPrefixes(existing, incoming) {
  if (!incoming || !incoming.length) return existing
  const cleanIncoming = incoming.map(p => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '').toLowerCase()).filter(Boolean)
  if (!cleanIncoming.length) return existing
  if (existing === null) return cleanIncoming
  const merged = []
  for (const a of existing) {
    for (const b of cleanIncoming) {
      if (a === b || a.startsWith(b + '/')) merged.push(a)
      else if (b.startsWith(a + '/')) merged.push(b)
    }
  }
  return [...new Set(merged)]
}

export function evaluatePolicyPlugins(plugins = [], {
  tool = '',
  opClass = '',
  targetPath = '',
  command = '',
  cwd = '',
  role = 'advisor',
} = {}) {
  const list = Array.isArray(plugins) ? plugins : []
  let effectiveMaxRole = role
  let restrictedWritePrefixes = null
  let forceApproval = false
  let forceApprovalPluginId = ''
  let forceApprovalReason = ''

  const toolName = String(tool || '').trim()
  const relTarget = normalizeRelPrefix(cwd, targetPath)
  const cmdProbes = command
    ? (() => {
        const a = analyzeCommand(command)
        return [a.raw, a.normalized, ...a.segments, ...a.inlinePayloads].filter(Boolean)
      })()
    : []

  for (const rawPlugin of list) {
    const v = validatePolicyPlugin(rawPlugin)
    if (!v.ok) {
      return {
        decision: 'block',
        stage: 'policy_plugin',
        rule: 'policy_plugin_invalid',
        pluginId: (rawPlugin && rawPlugin.id) || 'invalid',
        reason: v.error,
        badge: '🛡️ 非法策略插件拦截',
      }
    }
    const plugin = v.plugin
    if (!plugin.enabled) continue
    const rules = plugin.rules || {}

    if (rules.maxRoleCeiling && ROLE_ORDER[rules.maxRoleCeiling] < ROLE_ORDER[effectiveMaxRole]) {
      effectiveMaxRole = rules.maxRoleCeiling
    }

    if (opClass === 'workspace' && rules.restrictFsWritePrefixes && rules.restrictFsWritePrefixes.length > 0) {
      restrictedWritePrefixes = intersectPrefixes(restrictedWritePrefixes, rules.restrictFsWritePrefixes)
    }

    if (toolName && rules.denyTools.includes(toolName)) {
      return {
        decision: 'block',
        stage: 'policy_plugin',
        rule: `policy_plugin:${plugin.id}:deny_tool`,
        pluginId: plugin.id,
        reason: `策略插件「${plugin.name}」明确禁止调用工具 ${toolName}`,
        badge: '🛡️ 策略插件禁工具',
      }
    }

    if (relTarget && rules.forbidPathPrefixes.length > 0) {
      for (const rawPref of rules.forbidPathPrefixes) {
        const pref = rawPref.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '').toLowerCase()
        if (pref && (relTarget === pref || relTarget.startsWith(pref + '/') || relTarget.includes('/' + pref + '/'))) {
          return {
            decision: 'block',
            stage: 'policy_plugin',
            rule: `policy_plugin:${plugin.id}:forbid_path`,
            pluginId: plugin.id,
            reason: `策略插件「${plugin.name}」禁止访问受保护路径前缀 ${rawPref}`,
            badge: '🛡️ 策略插件拦路径',
          }
        }
      }
    }

    if (cmdProbes.length > 0 && rules.forbidCommandPatterns.length > 0) {
      for (const pat of rules.forbidCommandPatterns) {
        const re = new RegExp(pat, 'i')
        if (cmdProbes.some(p => re.test(p))) {
          return {
            decision: 'block',
            stage: 'policy_plugin',
            rule: `policy_plugin:${plugin.id}:forbid_cmd`,
            pluginId: plugin.id,
            reason: `策略插件「${plugin.name}」拦截受限命令模式 (${pat})`,
            badge: '🛡️ 策略插件拦命令',
          }
        }
      }
    }

    if (!forceApproval && toolName && rules.requireApprovalTools.includes(toolName)) {
      forceApproval = true
      forceApprovalPluginId = plugin.id
      forceApprovalReason = `策略插件「${plugin.name}」要求工具 ${toolName} 必须经用户逐项审批`
    }

    if (!forceApproval && cmdProbes.length > 0 && rules.requireApprovalCommandPatterns.length > 0) {
      for (const pat of rules.requireApprovalCommandPatterns) {
        const re = new RegExp(pat, 'i')
        if (cmdProbes.some(p => re.test(p))) {
          forceApproval = true
          forceApprovalPluginId = plugin.id
          forceApprovalReason = `策略插件「${plugin.name}」要求该命令模式 (${pat}) 经用户逐项审批`
          break
        }
      }
    }
  }

  return {
    decision: forceApproval ? 'require_approval' : 'pass',
    effectiveMaxRole,
    restrictedWritePrefixes,
    pluginId: forceApprovalPluginId,
    reason: forceApprovalReason,
  }
}
