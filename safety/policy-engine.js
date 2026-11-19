/**
 * safety/policy-engine.js
 *
 * Four-role + granular capability model (`role + capabilities`) and single-use
 * `capabilityScope` binding/verification for DSH Chief.
 */

import crypto from 'node:crypto'
import path from 'node:path'
import { validatePolicyPlugin } from './policy-plugin.js'

export const CHIEF_PERMISSION_MODES = ['advisor', 'assistant', 'strategist', 'chief']
export const DEFAULT_CHIEF_PERMISSION_MODE = 'advisor'

export const CHIEF_PERMISSION_META = {
  advisor: {
    key: 'advisor',
    rank: 0,
    level: 'L0',
    icon: '👁',
    shortLabel: 'L0 顾问',
    title: '顾问模式',
    enTitle: 'READ ONLY',
    badge: '默认模式',
    tagline: '只观察、只分析、只建议。',
    desc: 'L0 默认只读档：仅读取看板与允许访问的项目状态，分析任务并提建议，绝不修改工作区或任何工作流。',
    bullets: [
      '读取看板和允许访问的项目状态',
      '分析任务、提供建议',
      '不修改工作区',
      '不修改主代理和子代理工作流',
    ],
  },
  assistant: {
    key: 'assistant',
    rank: 1,
    level: 'L1',
    icon: '🗂',
    shortLabel: 'L1 助手',
    title: '助手模式',
    enTitle: 'ASSISTANT',
    badge: '',
    tagline: '允许自主维护参谋系统。',
    desc: 'L1 参谋内务档：具备顾问全部能力，允许维护自身记忆、档案与看板配置，但不改工作区、不接管主子代理工作流。',
    bullets: [
      '顾问模式全部能力',
      '管理自己的参谋系统',
      '修改自己的记忆、档案和看板配置',
      '不直接修改项目工作区',
      '不接管主代理工作流',
    ],
  },
  strategist: {
    key: 'strategist',
    rank: 2,
    level: 'L2',
    icon: '🛡️',
    shortLabel: 'L2 参谋',
    title: '参谋模式',
    enTitle: 'ADVISOR WITH APPROVAL',
    badge: '逐项授权',
    tagline: 'Agent 提出操作，用户决定是否执行。',
    desc: 'L2 逐项确认档：可申请修改工作区文件、运行系统命令及调整主对话/子代理工作流，每项受控操作执行前均弹窗由您逐项确认。',
    bullets: [
      '助手模式全部能力',
      '可以申请修改工作区文件',
      '可以申请修改主对话和子代理工作流',
      '每项受控操作执行前弹窗',
      '用户确认后才能执行',
    ],
  },
  chief: {
    key: 'chief',
    rank: 3,
    level: 'L3',
    icon: '⚡',
    shortLabel: 'L3 参谋长',
    title: '参谋长模式',
    enTitle: 'CHIEF OF STAFF',
    badge: '主动风险知悉',
    tagline: '用户明确接受更高自主权带来的操作风险。',
    desc: 'L3 高权限自主档：可自主修改工作区、执行命令、切换主代理并协调子代理工作流；启用前必须阅读风险声明并主动勾选确认。',
    bullets: [
      '参谋模式全部能力',
      '获得更高的自主执行权限',
      '可以切换主代理',
      '可以协调子代理及其工作流',
      '启用前必须阅读风险声明并主动勾选确认',
    ],
  },
}

const PERM_ALIAS_MAP = {
  advisor: 'advisor',
  l0: 'advisor',
  'read-only': 'advisor',
  assistant: 'assistant',
  l1: 'assistant',
  strategist: 'strategist',
  counselor: 'strategist',
  l2: 'strategist',
  'workspace-write': 'strategist',
  'auto-review': 'strategist',
  chief: 'chief',
  'chief-of-staff': 'chief',
  l3: 'chief',
}

export function normalizePermissionMode(raw, opts = {}) {
  const v = String(raw || '').trim().toLowerCase()
  const hasAck = Boolean(opts && opts.hasChiefRiskAck)
  const requireAck = Boolean(opts && opts.requireAck)
  if (v === 'danger-full-access') {
    return hasAck ? 'chief' : DEFAULT_CHIEF_PERMISSION_MODE
  }
  const mapped = PERM_ALIAS_MAP[v] || DEFAULT_CHIEF_PERMISSION_MODE
  if (mapped === 'chief' && requireAck && !hasAck) {
    return DEFAULT_CHIEF_PERMISSION_MODE
  }
  return mapped
}

export function permissionRank(mode) {
  const norm = normalizePermissionMode(mode)
  return (CHIEF_PERMISSION_META[norm] && CHIEF_PERMISSION_META[norm].rank) ?? 0
}

export function getToolOpClass(tool) {
  switch (String(tool || '').trim()) {
    case 'read_file':
    case 'list_dir':
    case 'search_files':
      return 'read'
    case 'request_permission_elevation':
      return 'elevation_request'
    case 'archive_write':
      return 'chief_system'
    case 'write_file':
    case 'edit_file':
    case 'run_command':
      return 'workspace'
    case 'subagent_dispatch':
    case 'subagent_steer':
    case 'subagent_interrupt':
    case 'main_agent_control':
    case 'session_compact':
      return 'workflow'
    default:
      return 'workflow'
  }
}

export function resolveRoleCapabilities(role, { hasChiefRiskAck = false, policyPlugins = [] } = {}) {
  let effectiveRole = normalizePermissionMode(role, { requireAck: true, hasChiefRiskAck })
  let restrictedWritePrefixes = null

  for (const rawPlugin of (Array.isArray(policyPlugins) ? policyPlugins : [])) {
    const v = validatePolicyPlugin(rawPlugin)
    if (!v.ok || !v.plugin.enabled) continue
    const rules = v.plugin.rules || {}
    if (rules.maxRoleCeiling && permissionRank(rules.maxRoleCeiling) < permissionRank(effectiveRole)) {
      effectiveRole = rules.maxRoleCeiling
    }
    if (rules.restrictFsWritePrefixes && rules.restrictFsWritePrefixes.length > 0) {
      const next = rules.restrictFsWritePrefixes.map(p => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '').toLowerCase()).filter(Boolean)
      if (next.length > 0) {
        if (restrictedWritePrefixes === null) {
          restrictedWritePrefixes = next
        } else {
          const inter = []
          for (const a of restrictedWritePrefixes) {
            for (const b of next) {
              if (a === b || a.startsWith(b + '/')) inter.push(a)
              else if (b.startsWith(a + '/')) inter.push(b)
            }
          }
          restrictedWritePrefixes = [...new Set(inter)]
        }
      }
    }
  }

  const capabilities = (() => {
    switch (effectiveRole) {
      case 'advisor':
        return {
          fsReadWorkspace: true,
          fsWritePrefixes: [],
          allowBoardAdmin: false,
          allowBoundsPropose: true,
          allowArchiveCurate: false,
          allowNetworkLink: false,
          allowWorkspaceWrite: 'deny',
          allowShellExec: 'deny',
          allowMainRelay: 'deny',
          allowSubagentDispatch: 'deny',
          allowSessionCompact: 'deny',
        }
      case 'assistant':
        return {
          fsReadWorkspace: true,
          fsWritePrefixes: [],
          allowBoardAdmin: true,
          allowBoundsPropose: true,
          allowArchiveCurate: true,
          allowNetworkLink: true,
          allowWorkspaceWrite: 'deny',
          allowShellExec: 'deny',
          allowMainRelay: 'deny',
          allowSubagentDispatch: 'deny',
          allowSessionCompact: 'deny',
        }
      case 'strategist':
        return {
          fsReadWorkspace: true,
          fsWritePrefixes: restrictedWritePrefixes !== null ? restrictedWritePrefixes : ['*'],
          allowBoardAdmin: true,
          allowBoundsPropose: true,
          allowArchiveCurate: true,
          allowNetworkLink: true,
          allowWorkspaceWrite: 'approval',
          allowShellExec: 'approval',
          allowMainRelay: 'approval',
          allowSubagentDispatch: 'approval',
          allowSessionCompact: 'approval',
        }
      case 'chief':
      default:
        return {
          fsReadWorkspace: true,
          fsWritePrefixes: restrictedWritePrefixes !== null ? restrictedWritePrefixes : ['*'],
          allowBoardAdmin: true,
          allowBoundsPropose: true,
          allowArchiveCurate: true,
          allowNetworkLink: true,
          allowWorkspaceWrite: 'allow',
          allowShellExec: 'allow',
          allowMainRelay: 'allow',
          allowSubagentDispatch: 'allow',
          allowSessionCompact: 'allow',
        }
    }
  })()

  return {
    role: effectiveRole,
    capabilities,
  }
}

export function buildCapabilityScope({ kind = 'tool', tool = '', args = {}, cwd = '', target = '' } = {}) {
  const safeKind = String(kind || 'tool').trim()
  const safeTool = String(tool || (safeKind === 'relay' ? 'relay' : safeKind)).trim()
  const argObj = args && typeof args === 'object' ? args : {}
  const baseCwd = cwd ? path.resolve(String(cwd)) : process.cwd()

  const scope = {
    kind: safeKind,
    tool: safeTool,
    opClass: getToolOpClass(safeTool),
  }

  if (safeTool === 'write_file' || safeTool === 'edit_file' || safeTool === 'read_file' || safeTool === 'list_dir' || safeTool === 'search_files') {
    const rawPath = String(argObj.path || '').trim()
    if (rawPath) {
      scope.allowedPaths = [path.resolve(baseCwd, rawPath)]
    }
  }

  if (safeTool === 'run_command') {
    const cmdText = String(argObj.command || argObj.cmd || '').trim()
    if (cmdText) {
      scope.commandSha256 = crypto.createHash('sha256').update(cmdText).digest('hex')
    }
    const runCwd = path.resolve(baseCwd, String(argObj.cwd || '.').trim() || '.')
    scope.allowedCwd = runCwd
  }

  if (safeTool === 'relay' || safeTool === 'subagent_dispatch' || safeTool === 'subagent_steer' || safeTool === 'subagent_interrupt') {
    const tgt = String(target || argObj.agent || argObj.subagent || argObj.target || '').trim()
    if (tgt) scope.targetAgent = tgt
  }

  if (safeTool === 'main_agent_control') {
    scope.controlOp = String(argObj.op || 'steer').trim()
  }

  return scope
}

function sameResolvedPath(a, b) {
  const na = path.resolve(String(a || ''))
  const nb = path.resolve(String(b || ''))
  return process.platform === 'win32' ? na.toLowerCase() === nb.toLowerCase() : na === nb
}

export function verifyCapabilityScope(scope, { kind = 'tool', tool = '', args = {}, cwd = '', target = '' } = {}) {
  if (!scope || typeof scope !== 'object') {
    return { ok: true }
  }
  const actualKind = String(kind || 'tool').trim()
  const actualTool = String(tool || '').trim()
  const argObj = args && typeof args === 'object' ? args : {}
  const baseCwd = cwd ? path.resolve(String(cwd)) : process.cwd()

  if (scope.kind && scope.kind !== actualKind) {
    return {
      ok: false,
      rule: 'capability_scope_mismatch',
      error: `单次授权作用域类型不匹配：预期 ${scope.kind}，实际 ${actualKind}`,
    }
  }

  if (scope.tool && actualTool && scope.tool !== actualTool) {
    return {
      ok: false,
      rule: 'capability_scope_mismatch',
      error: `单次授权工具作用域不匹配：预期 ${scope.tool}，实际 ${actualTool}`,
    }
  }

  if (Array.isArray(scope.allowedPaths) && scope.allowedPaths.length > 0) {
    const rawPath = String(argObj.path || '').trim()
    if (!rawPath) {
      return {
        ok: false,
        rule: 'capability_scope_mismatch',
        error: '单次授权要求显式路径且必须落在已批准路径范围内',
      }
    }
    const actualAbs = path.resolve(baseCwd, rawPath)
    if (!scope.allowedPaths.some(p => sameResolvedPath(p, actualAbs))) {
      return {
        ok: false,
        rule: 'capability_scope_mismatch',
        error: `单次授权作用域拒绝越权路径访问：未批准写入 ${rawPath}`,
      }
    }
  }

  if (scope.commandSha256) {
    const cmdText = String(argObj.command || argObj.cmd || '').trim()
    const actualHash = crypto.createHash('sha256').update(cmdText).digest('hex')
    if (actualHash !== scope.commandSha256) {
      return {
        ok: false,
        rule: 'capability_scope_mismatch',
        error: '单次授权作用域校验失败：执行命令与已批准内容不一致',
      }
    }
  }

  if (scope.allowedCwd) {
    const actualCwd = path.resolve(baseCwd, String(argObj.cwd || '.').trim() || '.')
    if (!sameResolvedPath(scope.allowedCwd, actualCwd)) {
      return {
        ok: false,
        rule: 'capability_scope_mismatch',
        error: '单次授权作用域校验失败：命令工作目录与已批准目录不一致',
      }
    }
  }

  if (scope.targetAgent) {
    const actualTarget = String(target || argObj.agent || argObj.subagent || argObj.target || '').trim()
    if (actualTarget && actualTarget !== scope.targetAgent) {
      return {
        ok: false,
        rule: 'capability_scope_mismatch',
        error: `单次授权目标代理不匹配：预期 ${scope.targetAgent}，实际 ${actualTarget}`,
      }
    }
  }

  if (scope.controlOp) {
    const actualOp = String(argObj.op || 'steer').trim()
    if (actualOp !== scope.controlOp) {
      return {
        ok: false,
        rule: 'capability_scope_mismatch',
        error: `单次授权主代理控制动作不匹配：预期 ${scope.controlOp}，实际 ${actualOp}`,
      }
    }
  }

  return { ok: true }
}
