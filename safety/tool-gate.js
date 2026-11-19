/**
 * safety/tool-gate.js
 *
 * Unified Tool Gate ordering:
 *   Hard Guards -> Policy Plugins (restrict-only) -> Role + Capabilities -> CapabilityScope Verification
 */

import { evaluateSafetyGuardHardRules } from './invariant-guards.js'
import { evaluateGuardWalls } from './guard-walls.js'
import { evaluatePolicyPlugins } from './policy-plugin.js'
import {
  CHIEF_PERMISSION_META,
  DEFAULT_CHIEF_PERMISSION_MODE,
  normalizePermissionMode,
  resolveRoleCapabilities,
  verifyCapabilityScope,
} from './policy-engine.js'

/** 四级权限与策略门禁判定：advisor(L0) / assistant(L1) / strategist(L2) / chief(L3)。 */
export function evaluateChiefPermissionGate({
  permissionMode = DEFAULT_CHIEF_PERMISSION_MODE,
  hasChiefRiskAck = false,
  opClass = 'read',
  tool = '',
  approvedOnce = false,
  capabilityScope = null,
  actualRequest = null,
  policyPlugins = [],
  targetPath = '',
  command = '',
  cwd = '',
} = {}) {
  const { role: mode, capabilities } = resolveRoleCapabilities(permissionMode, { hasChiefRiskAck, policyPlugins })
  const meta = CHIEF_PERMISSION_META[mode] || CHIEF_PERMISSION_META.advisor

  const pluginEval = evaluatePolicyPlugins(policyPlugins, {
    tool,
    opClass,
    targetPath,
    command,
    cwd,
    role: mode,
  })
  if (pluginEval.decision === 'block') {
    return {
      decision: 'deny_policy_plugin',
      mode,
      capabilities,
      rule: pluginEval.rule,
      pluginId: pluginEval.pluginId,
      error: pluginEval.reason,
      badge: pluginEval.badge || '🛡️ 策略插件拦截',
    }
  }

  if (approvedOnce && capabilityScope) {
    const scopeRes = verifyCapabilityScope(capabilityScope, actualRequest || {
      kind: capabilityScope.kind || 'tool',
      tool,
      cwd,
    })
    if (!scopeRes.ok) {
      return {
        decision: 'deny_scope_mismatch',
        mode,
        capabilities,
        rule: scopeRes.rule,
        error: scopeRes.error,
        badge: '🛡️ 授权作用域不匹配',
      }
    }
  }

  if (opClass === 'read' || opClass === 'elevation_request') {
    if (pluginEval.decision === 'require_approval' && !approvedOnce && opClass === 'read') {
      return {
        decision: 'require_approval',
        mode,
        capabilities,
        requiredMode: mode,
        rule: 'policy_plugin_require_approval',
        error: pluginEval.reason || `策略插件要求调用 ${tool} 前先经用户确认`,
        badge: '🛡️ 插件要求确认',
      }
    }
    return { decision: 'allow', mode, capabilities }
  }

  if (opClass === 'chief_system') {
    if (!capabilities.allowBoardAdmin && !capabilities.allowArchiveCurate) {
      return {
        decision: 'deny_mode',
        mode,
        capabilities,
        requiredMode: 'assistant',
        rule: 'role_deny_chief_system',
        error: '当前处于「L0 · 顾问模式（只读）」，仅允许分析与建议，不能修改参谋记忆、档案或看板配置。可向用户申请提权至「L1 · 助手模式」。',
        badge: '🔒 L0禁改参谋系统',
      }
    }
    if (pluginEval.decision === 'require_approval' && !approvedOnce) {
      return {
        decision: 'require_approval',
        mode,
        capabilities,
        requiredMode: mode,
        rule: 'policy_plugin_require_approval',
        error: pluginEval.reason || `策略插件要求调用 ${tool} 前先经用户确认`,
        badge: '🛡️ 插件要求确认',
      }
    }
    return { decision: 'allow', mode, capabilities }
  }

  // 'workspace' or 'workflow'
  const capPolicy = opClass === 'workspace'
    ? (tool === 'run_command' ? capabilities.allowShellExec : capabilities.allowWorkspaceWrite)
    : (tool === 'session_compact'
        ? capabilities.allowSessionCompact
        : (tool === 'main_agent_control' || tool === 'relay' ? capabilities.allowMainRelay : capabilities.allowSubagentDispatch))

  if (capPolicy === 'deny' || mode === 'advisor' || mode === 'assistant') {
    const targetDesc = opClass === 'workspace' ? '修改项目工作区或执行系统命令' : '调整主对话及子代理工作流'
    return {
      decision: 'deny_mode',
      mode,
      capabilities,
      requiredMode: 'strategist',
      rule: `role_deny_${opClass}`,
      error: `当前处于「${meta.level} · ${meta.title}」，禁止${targetDesc}（${tool}）。如需执行，请向用户申请提权至「L2 · 参谋模式（逐项授权）」或「L3 · 参谋长模式」。`,
      badge: `🔒 ${meta.level}禁止操作`,
    }
  }

  if (mode === 'strategist' || pluginEval.decision === 'require_approval') {
    if (approvedOnce) {
      return { decision: 'allow_approved', mode, capabilities }
    }
    return {
      decision: 'require_approval',
      mode,
      capabilities,
      requiredMode: mode === 'chief' ? 'chief' : 'strategist',
      rule: pluginEval.decision === 'require_approval' ? 'policy_plugin_require_approval' : 'strategist_require_approval',
      error: pluginEval.decision === 'require_approval'
        ? (pluginEval.reason || '策略插件要求该操作先通过授权弹窗确认。')
        : '「L2 · 参谋模式」要求先通过操作授权弹窗由用户逐项确认。',
      badge: '🛡️ 待逐项确认',
    }
  }

  // mode === 'chief'
  const rawModeNorm = normalizePermissionMode(permissionMode)
  if (rawModeNorm === 'chief' && !hasChiefRiskAck) {
    return {
      decision: 'deny_unacknowledged_l3',
      mode: 'advisor',
      capabilities: resolveRoleCapabilities('advisor', { policyPlugins }).capabilities,
      requiredMode: 'chief',
      rule: 'unacknowledged_l3',
      error: '未检测到「L3 · 参谋长模式」风险知悉确认状态（chiefRiskAck），后端拒绝高权限自主执行。',
      badge: '🛡️ L3未授权拦截',
    }
  }
  return { decision: approvedOnce ? 'allow_approved' : 'allow', mode: 'chief', capabilities }
}

export function evaluateUnifiedToolGate({
  tool = '',
  opClass = 'read',
  targetPath = '',
  command = '',
  args = null,
  cwd = '',
  board = null,
  permissionMode = DEFAULT_CHIEF_PERMISSION_MODE,
  hasChiefRiskAck = false,
  approvedOnce = false,
  capabilityScope = null,
  policyPlugins = [],
} = {}) {
  const hardGuard = evaluateSafetyGuardHardRules({
    tool,
    opClass,
    targetPath,
    command,
    args,
    cwd,
    board,
  })
  if (hardGuard.blocked) {
    return {
      allowed: false,
      stage: 'safety_guard',
      decision: 'blocked',
      rule: hardGuard.rule || 'hard_guard',
      reason: hardGuard.reason,
      badge: hardGuard.badge,
      blockedBySafetyGuard: true,
    }
  }

  const wallRes = evaluateGuardWalls({
    tool,
    opClass,
    targetPath,
    command,
    args,
    cwd,
  })
  if (wallRes.decision === 'block') {
    return {
      allowed: false,
      stage: 'guard_wall',
      decision: 'blocked',
      rule: wallRes.rule || 'guard_wall_block',
      wallId: wallRes.wallId,
      wallTitle: wallRes.wallTitle,
      reason: wallRes.reason,
      badge: wallRes.badge || '🧱 物理墙拦截',
      blockedByGuardWall: true,
      blockedBySafetyGuard: true,
    }
  }
  if (wallRes.decision === 'require_approval' && !approvedOnce) {
    return {
      allowed: false,
      stage: 'guard_wall',
      decision: 'require_approval',
      rule: wallRes.rule || 'guard_wall_require_approval',
      wallId: wallRes.wallId,
      wallTitle: wallRes.wallTitle,
      reason: wallRes.reason,
      badge: wallRes.badge || '🧱 物理墙待确认',
      requireApproval: true,
    }
  }

  const gateRes = evaluateChiefPermissionGate({
    permissionMode,
    hasChiefRiskAck,
    opClass,
    tool,
    approvedOnce,
    capabilityScope,
    actualRequest: { kind: (capabilityScope && capabilityScope.kind) || 'tool', tool, args, cwd },
    policyPlugins,
    targetPath,
    command,
    cwd,
  })

  if (gateRes.decision === 'allow' || gateRes.decision === 'allow_approved') {
    return {
      allowed: true,
      stage: 'permission_gate',
      decision: gateRes.decision,
      mode: gateRes.mode,
      capabilities: gateRes.capabilities,
    }
  }

  return {
    allowed: false,
    stage: gateRes.decision === 'deny_policy_plugin' ? 'policy_plugin' : (gateRes.decision === 'deny_scope_mismatch' ? 'scope_guard' : 'permission_gate'),
    decision: gateRes.decision,
    mode: gateRes.mode,
    capabilities: gateRes.capabilities,
    requiredMode: gateRes.requiredMode,
    rule: gateRes.rule || gateRes.decision,
    reason: gateRes.error,
    badge: gateRes.badge,
    deniedByMode: gateRes.decision === 'deny_mode' || gateRes.decision === 'deny_unacknowledged_l3',
    deniedByPolicyPlugin: gateRes.decision === 'deny_policy_plugin',
    deniedByScopeMismatch: gateRes.decision === 'deny_scope_mismatch',
    requireApproval: gateRes.decision === 'require_approval',
  }
}
