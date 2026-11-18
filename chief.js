/**
 * DSH Chief Engine Facade (DSH 参谋长核心引擎门面 · 详契见 ./ARCHITECTURE.md)
 *
 * 模块：chief.js
 * 职责：参谋长引擎唯一对外门面，保持 67 个对外导出；内部按 L1→L9 无环分拆至 `chief-*.js`。
 * 允许依赖：./chief-executor.js (独立安全执行层)、./chief-state.js .. ./chief-approvals.js (9 个子模块)
 * 禁止依赖：./index.js / ./board-*.js / ./api-routes.js / ./runtime-hooks.js (严禁子模块反向导入 ./chief.js)
 * 公开 API：67 个聚合导出 (4 个权限常量/归一化函数源自 chief-executor.js + 63 个引擎业务导出)
 * 持有状态：无 (纯重导出门面；持久化状态由 chief-state.js 唯一持有)
 * 副作用：无 (随首次 import 触发子模块静态初始化并向 chief-view.js 注册 idleAutoPilotHook)
 * 安全边界：所有工具调用与 L2 审批放行唯一经 chief-executor.js (MD5 锁定) 执行；严禁绕过权限门禁与硬规则。
 *
 * 分层映射：
 *   L1 chief-state(状态/锁/审计/审批队列) → L2 chief-models(模型路由) → L3 chief-network(跨窗信封/邮箱)
 *   L4 chief-view(态势摘要) → L5 chief-archives(收割/沉淀/蒸馏) → L6 chief-compaction(抢救压缩)
 *   L7 chief-commands(自然语言指令/工具编排) → L8 chief-review(回合审查/自动驾驶) → L9 chief-approvals(裁决回执)
 */

export {
  CHIEF_PERMISSION_MODES,
  DEFAULT_CHIEF_PERMISSION_MODE,
  CHIEF_PERMISSION_META,
  normalizePermissionMode,
} from './chief-executor.js'
export {
  CHIEF_UPDATE_SOURCE,
  CHIEF_RELAY_SOURCE,
  auditJsonlPath,
  computeApprovalPayloadHash,
  withChiefStateLock,
  persistChiefImagesToWorkspace,
  admitChiefImages,
  hasValidChiefRiskAck,
  COMPACT_THRESHOLD_MIN_PCT,
  COMPACT_THRESHOLD_MAX_PCT,
  COMPACT_PCT_WARN_FLOOR,
  COMPACT_TOKEN_HARD_MIN,
  COMPACT_TOKEN_WARN_FLOOR,
  formatCompactTokenShort,
  parseCompactTokensInput,
  resolveWorkspaceConfig,
  appendChiefAuditLog,
  enqueueApprovalToWs,
  queueChiefApproval,
  enqueueElevationToWs,
  requestChiefElevation,
  loadChiefState,
  saveChiefState,
  mutateChiefState,
  getLinkedCluster,
  computeClusterSig,
  setPeerLink,
  updateWorkspaceFlippedIds,
  deployChiefWorkspaceState,
  updateChiefConfig,
  mutateChiefFact,
} from './chief-state.js'
export {
  invalidateChiefModelCatalog,
  formatChiefModelLabel,
  listChiefModels,
  callChiefLlm,
} from './chief-models.js'
export {
  buildMessageEnvelope,
  collectClusterPeerProgress,
  listPeerDirectory,
  deliverCrossMessage,
  consumePreStepDelta,
  readMailboxForAgent,
} from './chief-network.js'
export { sanitizeConciseBriefText, getChiefView } from './chief-view.js'
export {
  organizeArchivesWithChief,
  harvestTurnDetailsToArchive,
  precipitateExperienceWithChief,
  distillSessionArchivesToGlobal,
  relayArchivesWithChief,
} from './chief-archives.js'
export { requestSmartCompactFromLead, maybeRunPreCompaction, recommendAndSetCompactThreshold } from './chief-compaction.js'
export {
  isExplicitCompactCommand,
  consolidateBoundsWithChief,
  askOrCommandChief,
  proposeBoundToChief,
  suggestCoreObjectiveWithChief,
} from './chief-commands.js'
export { scheduleChiefTurnReview, runTurnReview, checkAndStopIdleAutoPilot } from './chief-review.js'
export {
  handleSuggestionDecision,
  executeBatchSuggestions,
  handleApprovalDecision,
  handleElevationDecision,
} from './chief-approvals.js'
