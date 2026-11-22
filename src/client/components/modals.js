/**
 * src/client/components/modals.js — 弹出气泡与全局确认弹窗统一出口桶文件
 *
 * 【核心职责】
 *   汇总并 re-export 原本集中在单一巨石文件里的全部 18 个弹窗与气泡组件，
 *   让 `Panel.js` 等消费方保持零路径改动的稳定导入面。
 *
 * 【子模块划分（`src/client/components/modals/`）】
 *   - `modals/pickers.js`       `ModelPickerPopover`、`PacePickerPopover`、`SuggestionBanner`
 *   - `modals/intervention.js`  `InterventionConfirmModal`、`UnlimitedTurnsConfirmModal`、`AutoPilotConfirmModal`、`AwayPresetConfirmModal`
 *   - `modals/workflow.js`      `ArchiveRelayModal`、`DistillToGlobalModal`、`ChiefAdviceModal`、`HazardHaltModal`、`PrecipitateConfirmModal`、`PeerLinkConfirmModal`、`HandoffWarnModal`
 *   - `modals/safety.js`        `ChiefRiskConfirmModal`、`OperationApprovalModal`、`ElevationRequestModal`、`AuditLogModal`
 */

import { ModelPickerPopover, PacePickerPopover, SuggestionBanner } from './modals/pickers.js'
import {
  InterventionConfirmModal,
  UnlimitedTurnsConfirmModal,
  AutoPilotConfirmModal,
  AwayPresetConfirmModal,
} from './modals/intervention.js'
import {
  ArchiveRelayModal,
  DistillToGlobalModal,
  ChiefAdviceModal,
  HazardHaltModal,
  PrecipitateConfirmModal,
  PeerLinkConfirmModal,
  HandoffWarnModal,
} from './modals/workflow.js'
import {
  ChiefRiskConfirmModal,
  SafetyGuardConfirmModal,
  OperationApprovalModal,
  ElevationRequestModal,
  AuditLogModal,
} from './modals/safety.js'

export {
  ModelPickerPopover,
  PacePickerPopover,
  SuggestionBanner,
  InterventionConfirmModal,
  UnlimitedTurnsConfirmModal,
  AutoPilotConfirmModal,
  AwayPresetConfirmModal,
  ArchiveRelayModal,
  DistillToGlobalModal,
  ChiefAdviceModal,
  HazardHaltModal,
  PrecipitateConfirmModal,
  PeerLinkConfirmModal,
  HandoffWarnModal,
  ChiefRiskConfirmModal,
  SafetyGuardConfirmModal,
  OperationApprovalModal,
  ElevationRequestModal,
  AuditLogModal,
}
