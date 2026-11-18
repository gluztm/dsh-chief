/**
 * 三层工程档案系统对外门面 (Three-Tier Archive Store Facade · 详契见 ./ARCHITECTURE.md)
 *
 * 模块：archives.js
 * 职责：聚合三层档案系统（Session 档案柜 / Project Global 档案库 / 沉淀冷库），完整保留 42 个历史公共导出。
 * 允许依赖：./archive-core.js → ./archive-cabinets.js → ./archive-precipitated.js → ./archive-dossiers.js
 * 禁止依赖：./index.js / ./chief.js / ./board-*.js (严禁 4 个 archive-* 子模块反向导入 ./archives.js)
 * 公开 API：42 个统一重导出 (`mutateArchive`, `mutatePrecipitated`, `copyPrecipitatedToVault`, `loadArchiveStore`, ...)
 * 持有状态：无 (唯一 `heldArchiveLocks`、`archiveCache` 与 `seq` 集中于 archive-core.js)
 * 副作用：读写 `~/.dsh/notebook/archives/` 与工作区冷库文件，使用独占 `.lock` 与原子临时文件重命名。
 * 安全边界：`SECRET_PATTERN` 拦截凭据落库；沉淀冷库默认 0-token 封存 (`flipOut` 门控)；`copyPrecipitatedToVault` 先释锁再写目标库防死锁。
 */

export {
  DEFAULT_ARCHIVE_FOLDERS,
  normalizeCwd,
  resolveProjectKey,
  legacyArchiveFilePath,
  cabinetsDirPath,
  cabinetRegistryPath,
  cabinetFilePath,
  globalChiefVaultFilePath,
  globalPrecipitatedFilePath,
  precipitatedFilePath,
  invalidateArchiveCache,
  classifyNoteFolder,
  extractStructuredPoints,
  smartParseNoteToDossier,
} from './archive-core.js'
export {
  archiveFilePath,
  listProjectCabinets,
  bootstrapArchivesFromSharedBoard,
  loadGlobalVaultRaw,
  saveGlobalVaultRaw,
  loadArchiveStore,
  saveArchiveStore,
  withArchiveLock,
} from './archive-cabinets.js'
export {
  getFlippedOutPrecipitatedForSession,
  copyPrecipitatedToVault,
  collectSealedWatchSummary,
  listPrecipitatedHeaders,
  getPrecipitatedDetail,
  savePrecipitatedEntry,
  mutatePrecipitated,
} from './archive-precipitated.js'
export {
  getChiefMountedGlobalForSession,
  getTakenOutGlobalForSession,
  computeSessionGlobalDiff,
  getArchiveMeta,
  getThreeTierArchiveCounts,
  listArchiveHeaders,
  getArchiveDetail,
  getTakenOutArchivesForSession,
  searchArchives,
  searchGlobalVaultForChief,
  mutateArchive,
  applyChiefArchiveCurations,
  copyArchivesBetweenSessionsOrCabinets,
} from './archive-dossiers.js'
