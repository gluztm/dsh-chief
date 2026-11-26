/**
 * guard-wall-presets.js — 自定义拦截墙预设模板包与默认启用种子工具
 *
 * 【核心职责】
 *   1. 提供开箱即用、贴近日常安全痛点（涉密文件、高危 Git、对外发版、CI 保护、删库审批、只读模式）的预设包目录；
 *   2. 对新装或尚未初始化预设包的用户，在后台启动与首次加载面板时自动默认开启 4 套常用事前拦截规则，并支持在 UI 随时一键暂停或恢复。
 *
 * 【边界约定】
 *   - 仅单向依赖 `./chief-state.js` 与 `./chief-executor.js`；
 *   - 只初始化一次（按 walls 文件路径记录于 `global.guardWallPresetsSeededPaths`），绝不强行覆盖用户手动暂停或删除后的状态。
 */

import { loadChiefState, mutateChiefState } from './chief-state.js'
import {
  HUMAN_BOUNDS_CONFIRM_TOKEN,
  guardWallsFilePath,
  listGuardWalls,
  mutateGuardWalls,
} from './chief-executor.js'

export const GUARD_WALL_PRESET_VERSION = 2

export const DEPRECATED_GUARD_WALL_PRESET_IDS = Object.freeze([
  'preset-publish-gate',
  'preset-ci-workflow',
  'preset-db-prod',
])

export const DEFAULT_GUARD_WALL_PRESETS = Object.freeze([
  Object.freeze({
    id: 'preset-secret-files',
    title: '涉密文件防泄露',
    titleEn: 'Protect Secret Files',
    desc: '不让 AI 偷看或乱改密码、密钥和账号配置文件（.env、私钥、凭据等）',
    descEn: 'Blocks reading or editing .env, private keys, and credential files',
    ruleType: 'forbid_path',
    writeOnly: false,
    defaultEnabled: true,
    patterns: Object.freeze([
      '.env',
      '.env.*',
      '.npmrc',
      '.netrc',
      '*.pem',
      '*.key',
      'id_rsa',
      'id_ed25519',
      'credentials',
      'secrets.*',
      '.aws/credentials',
    ]),
    reason: '预设包：默认保护密码、密钥与凭据文件，防止 AI 误读泄露或误改',
  }),
  Object.freeze({
    id: 'preset-git-safety',
    title: '高危操作防误删',
    titleEn: 'Block Destructive Git Ops',
    desc: '直接拦住强推覆盖、强行清空本地改动和强删分支等不可逆操作',
    descEn: 'Blocks force push, hard reset, clean -f, and force branch delete',
    ruleType: 'forbid_cmd',
    writeOnly: false,
    defaultEnabled: true,
    patterns: Object.freeze([
      'git\\s+push.*--force',
      'git\\s+push\\s+-f\\b',
      'git\\s+reset\\s+--hard',
      'git\\s+clean\\s+-f',
      'git\\s+branch\\s+-D',
    ]),
    reason: '预设包：防止误运行不可逆 Git 破坏性命令导致本地改动或远端历史丢失',
  }),
  Object.freeze({
    id: 'preset-readonly-audit',
    title: '只读看代码模式',
    titleEn: 'Read-Only Code Review',
    desc: '只想让 AI 看代码、查问题或出方案时打开，彻底禁止改文件和删文件',
    descEn: 'Disables file write/edit/patch/delete tools for pure read-only inspection',
    ruleType: 'deny_tool',
    writeOnly: false,
    defaultEnabled: false,
    patterns: Object.freeze([
      'write_file',
      'edit_file',
      'write',
      'edit',
      'apply_patch',
      'delete_file',
      'remove_file',
    ]),
    reason: '预设包：临时锁死所有写文件工具，确保只读审查期间源码零改动',
  }),
])

export function ensureDefaultGuardWallPresets({ cwd = '', force = false } = {}) {
  const wallsFile = guardWallsFilePath()
  const seedKey = `${GUARD_WALL_PRESET_VERSION}:${wallsFile}`
  const st = loadChiefState()
  const seededList = Array.isArray(st?.config?.guardWallPresetsSeededPaths)
    ? st.config.guardWallPresetsSeededPaths
    : []

  if (!force && seededList.includes(seedKey)) {
    return { ok: true, alreadySeeded: true, seededIds: [], removedIds: [] }
  }

  let existing = listGuardWalls({ cwd })
  const deprecatedSet = new Set(DEPRECATED_GUARD_WALL_PRESET_IDS)
  const removedIds = []

  for (const w of existing) {
    if (!w || !deprecatedSet.has(w.id)) continue
    const rmRes = mutateGuardWalls({
      op: 'remove',
      wallId: w.id,
      cwd,
      callerOrigin: 'human_ui',
      humanConfirmToken: HUMAN_BOUNDS_CONFIRM_TOKEN,
    })
    if (rmRes && rmRes.ok) {
      removedIds.push(w.id)
    }
  }

  if (removedIds.length > 0) {
    existing = listGuardWalls({ cwd })
  }

  const existingIds = new Set(existing.map(w => w && w.id).filter(Boolean))
  const existingTitles = new Set(existing.map(w => w && w.title).filter(Boolean))
  const seededIds = []

  for (const tpl of DEFAULT_GUARD_WALL_PRESETS) {
    if (!tpl.defaultEnabled && !force) continue
    if (existingIds.has(tpl.id) || existingTitles.has(tpl.title)) continue
    const res = mutateGuardWalls({
      op: 'save',
      wall: {
        id: tpl.id,
        title: tpl.title,
        ruleType: tpl.ruleType,
        patterns: [...tpl.patterns],
        writeOnly: Boolean(tpl.writeOnly),
        scope: 'global',
        reason: tpl.reason,
        source: 'manual',
      },
      cwd,
      callerOrigin: 'human_ui',
      humanConfirmToken: HUMAN_BOUNDS_CONFIRM_TOKEN,
    })
    if (res && res.ok) {
      seededIds.push(tpl.id)
    }
  }

  mutateChiefState(draft => {
    if (!draft.config || typeof draft.config !== 'object') draft.config = {}
    const prev = Array.isArray(draft.config.guardWallPresetsSeededPaths)
      ? draft.config.guardWallPresetsSeededPaths
      : []
    if (!prev.includes(seedKey)) {
      draft.config.guardWallPresetsSeededPaths = [...prev, seedKey].slice(-24)
    }
  })

  return { ok: true, alreadySeeded: false, seededIds, removedIds }
}
