/**
 * safety/index.js
 *
 * Unified entry point for the DSH Chief Safety Kernel (`pkg/safety/`).
 */

export {
  SECRET_REDACT_PATTERN,
  redactAuditText,
  auditJsonlPath,
  normalizeAuditRecord,
  appendAuditJsonlRecord,
  readRecentAuditJsonl,
} from './audit-log.js'

export {
  decodeEncodedPowerShell,
  normalizeCommandForSecurity,
  splitCompoundCommand,
  extractInlineScriptPayloads,
  analyzeCommand,
} from './command-analyzer.js'

export {
  HUMAN_BOUNDS_CONFIRM_TOKEN,
  safeRealpath,
  isPathInsideWorkspace,
  hasWindowsReservedDeviceName,
  hasForbiddenNtfsAds,
  isSensitiveCredentialPath,
  validateWorkspacePath,
  verifyBoundsWriteAuth,
} from './path-guard.js'

export {
  HARD_GUARD_RULE_IDS,
  isDestructiveShellCommand,
  commandTouchesSensitiveCredential,
  checkForbiddenBounds,
  evaluateSafetyGuardHardRules,
} from './invariant-guards.js'

export {
  FORBIDDEN_WEAKENING_KEYS,
  validatePolicyPlugin,
  validatePolicyPluginList,
  evaluatePolicyPlugins,
} from './policy-plugin.js'

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
} from './policy-engine.js'

export {
  evaluateChiefPermissionGate,
  evaluateUnifiedToolGate,
} from './tool-gate.js'

export {
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
} from './guard-walls.js'
