/**
 * safety/guard-walls.js
 *
 * Dynamic, reusable physical guard walls (`guard-walls.json`) and whole-session
 * `tools/pre-execute` physical defense gate for DSH Chief.
 *
 * Walls persist independently of individual conversations (supporting `global`,
 * `workspace`, and `paused` states) and require human confirmation to mutate.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { threadId } from 'node:worker_threads'
import { analyzeCommand, normalizeCommandForSecurity } from './command-analyzer.js'
import {
  HUMAN_BOUNDS_CONFIRM_TOKEN,
  hasForbiddenNtfsAds,
  hasWindowsReservedDeviceName,
  isSensitiveCredentialPath,
  safeRealpath,
  validateWorkspacePath,
  verifyBoundsWriteAuth,
} from './path-guard.js'
import {
  checkForbiddenBounds,
  commandTouchesSensitiveCredential,
  isDestructiveShellCommand,
} from './invariant-guards.js'

const GUARD_WALLS_CAP = 80
const GUARD_WALL_LOCK_STALE_MS = 10_000
const GUARD_WALL_LOCK_WAIT_MS = 3_500
const heldGuardWallLocks = new Set()

let cachedGuardWallStore = null

export const GUARD_WALL_RULE_TYPES = Object.freeze([
  'forbid_path',
  'restrict_write',
  'forbid_cmd',
  'require_approval_cmd',
  'deny_tool',
])

export const GUARD_WALL_SCOPES = Object.freeze(['global', 'workspace', 'paused'])

const SAFE_META_TOOLS = new Set([
  'chief_board',
  'chief_memory',
  'chief_boundaries',
  'chief_handoff',
  'todo_write',
  'create_goal',
  'update_goal',
  'team_task_list',
])

const READ_ONLY_FS_TOOLS = new Set([
  'read',
  'read_image',
  'read_file',
  'view_file',
  'list_dir',
  'glob',
  'grep',
  'search_files',
  'find_by_name',
])

const SHELL_TOOLS = new Set([
  'run_command',
  'bash',
  'sh',
  'shell',
  'powershell',
  'pwsh',
  'cmd',
  'terminal',
  'exec',
  'execute_command',
])

const WORKSPACE_WRITE_TOOLS = new Set([
  'write',
  'edit',
  'write_file',
  'edit_file',
  'multi_edit',
  'replace_file_content',
  'multi_replace_file_content',
  'apply_patch',
  'create_file',
  'delete_file',
  'remove_file',
  'move_file',
  'rename_file',
  'notebook_edit',
])

function sleepSync(ms) {
  if (!ms || ms <= 0) return
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  } catch {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      // spin fallback
    }
  }
}

export function guardWallsFilePath() {
  const override = String(process.env.DSH_CHIEF_WALLS_FILE || '').trim()
  if (override) return path.resolve(override)
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'chief', 'guard-walls.json')
}

function normalizeCmpPath(rawPath) {
  if (!rawPath) return ''
  const resolved = safeRealpath(String(rawPath).trim())
  const slash = resolved.replace(/\\/g, '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? slash.toLowerCase() : slash
}

function isSubOrEqualPath(baseCmp, targetCmp) {
  if (!baseCmp || !targetCmp) return false
  if (baseCmp === targetCmp) return true
  return targetCmp.startsWith(baseCmp + '/')
}

function acquireGuardWallLock(file) {
  const lockFile = file + '.lock'
  fs.mkdirSync(path.dirname(lockFile), { recursive: true })
  const deadline = Date.now() + GUARD_WALL_LOCK_WAIT_MS
  let spin = 0
  while (true) {
    try {
      const fd = fs.openSync(lockFile, 'wx')
      try {
        fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, threadId, at: Date.now() }))
      } finally {
        fs.closeSync(fd)
      }
      heldGuardWallLocks.add(lockFile)
      let released = false
      return () => {
        if (released) return
        released = true
        heldGuardWallLocks.delete(lockFile)
        try { fs.unlinkSync(lockFile) } catch {}
      }
    } catch (err) {
      const code = err && err.code
      if (code === 'EEXIST' || code === 'EPERM' || code === 'EACCES' || code === 'EBUSY') {
        try {
          const st = fs.statSync(lockFile)
          if (Date.now() - st.mtimeMs > GUARD_WALL_LOCK_STALE_MS) {
            try { fs.unlinkSync(lockFile) } catch {}
            continue
          }
        } catch {}
        if (Date.now() >= deadline) {
          throw new Error('guard-walls.json 并发写锁超时')
        }
        sleepSync(Math.min(25, 4 + spin * 2 + Math.floor(Math.random() * 6)))
        spin += 1
        continue
      }
      throw err
    }
  }
}

function atomicWriteGuardWalls(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${threadId}.${Date.now()}.tmp`
  const json = JSON.stringify(payload, null, 2)
  fs.writeFileSync(tmp, json, 'utf8')
  for (let i = 0; i < 6; i += 1) {
    try {
      fs.renameSync(tmp, file)
      break
    } catch (err) {
      const code = err && err.code
      if ((code === 'EPERM' || code === 'EACCES' || code === 'EBUSY') && i < 5) {
        sleepSync(12 * (i + 1))
        continue
      }
      try { fs.unlinkSync(tmp) } catch {}
      throw err
    }
  }
  let mtimeMs = 0
  try { mtimeMs = fs.statSync(file).mtimeMs } catch {}
  cachedGuardWallStore = { file, mtimeMs, data: payload }
}

function clampStr(text, maxLen = 160) {
  return String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, maxLen)
}

const GUARD_WALL_TYPE_LABELS = Object.freeze({
  forbid_path: '禁碰路径',
  restrict_write: '仅限目录可写',
  forbid_cmd: '禁跑命令',
  require_approval_cmd: '高危命令先请示',
  deny_tool: '禁用工具',
})

function validatePatternsForRule(ruleType, patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) {
    return { ok: false, error: '物理驻墙必须至少包含 1 条有效匹配规则 (patterns)' }
  }
  const clean = []
  for (const entry of patterns.slice(0, 96)) {
    if (typeof entry !== 'string') {
      return { ok: false, error: '物理驻墙规则条目必须为字符串' }
    }
    const trimmed = entry.trim()
    if (!trimmed) continue
    if (trimmed.length > 200) {
      return { ok: false, error: '单条物理驻墙规则长度不可超过 200 字符' }
    }
    if (ruleType === 'restrict_write' && (trimmed === '*' || trimmed === '**' || trimmed === '/' || trimmed === '.')) {
      return { ok: false, error: 'restrict_write 仅限收窄子目录白名单，禁止通配放宽符' }
    }
    if (ruleType === 'forbid_cmd' || ruleType === 'require_approval_cmd') {
      if (/\([^)]*[+*][^)]*\)[+*{]/.test(trimmed)) {
        return { ok: false, error: `物理墙命令规则含不安全嵌套量词：${trimmed}` }
      }
      try {
        // eslint-disable-next-line no-new
        new RegExp(trimmed, 'i')
      } catch {
        return { ok: false, error: `物理墙命令正则语法无效：${trimmed}` }
      }
    }
    clean.push(trimmed)
  }
  if (!clean.length) {
    return { ok: false, error: '物理驻墙必须至少包含 1 条非空规则' }
  }
  return { ok: true, list: [...new Set(clean)] }
}

export function validateGuardWallInput(raw, { cwd = '' } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '物理驻墙对象格式无效' }
  }
  const title = clampStr(raw.title || '', 100)
  if (!title) {
    return { ok: false, error: '物理驻墙缺少名称 (title)' }
  }
  const ruleTypeRaw = String(raw.ruleType || 'forbid_path').trim()
  const ruleType = GUARD_WALL_RULE_TYPES.includes(ruleTypeRaw) ? ruleTypeRaw : ''
  if (!ruleType) {
    return { ok: false, error: `不支持的物理驻墙规则类型：${ruleTypeRaw}` }
  }
  const scopeRaw = String(raw.scope || 'global').trim().toLowerCase()
  const scope = GUARD_WALL_SCOPES.includes(scopeRaw) ? scopeRaw : 'global'
  const rawPatterns = Array.isArray(raw.patterns)
    ? raw.patterns
    : (typeof raw.pattern === 'string'
        ? raw.pattern.split(/[\r\n,;，；]+/).map(s => s.trim()).filter(Boolean)
        : [])
  const patCheck = validatePatternsForRule(ruleType, rawPatterns)
  if (!patCheck.ok) return patCheck

  const rawProj = String(raw.projectKey || raw.workspaceRoot || (scope === 'workspace' ? cwd : '') || '').trim()
  const projectKey = rawProj ? normalizeCmpPath(rawProj) : ''
  if (scope === 'workspace' && !projectKey) {
    return { ok: false, error: '按工程绑定的物理驻墙需要有效的当前工程目录 (projectKey / cwd)' }
  }

  const now = Date.now()
  const idRaw = String(raw.id || '').trim()
  const id = idRaw && /^[a-zA-Z0-9._-]{2,64}$/.test(idRaw)
    ? idRaw
    : ('wall-' + crypto.randomBytes(4).toString('hex'))

  return {
    ok: true,
    wall: {
      id,
      title,
      scope,
      projectKey,
      ruleType,
      patterns: patCheck.list,
      writeOnly: Boolean(raw.writeOnly),
      source: raw.source === 'chief_crafted' ? 'chief_crafted' : 'manual',
      pinnedByUser: raw.pinnedByUser !== false,
      reason: clampStr(raw.reason || '', 200),
      createdAt: Number(raw.createdAt) || now,
      updatedAt: now,
    },
  }
}

export function normalizeGuardWall(raw, cwd = '') {
  const checked = validateGuardWallInput(raw, { cwd })
  return checked.ok ? checked.wall : null
}

function loadGuardWallStoreFromDisk(file) {
  if (!fs.existsSync(file)) {
    return { version: 1, walls: [] }
  }
  try {
    const st = fs.statSync(file)
    if (cachedGuardWallStore && cachedGuardWallStore.file === file && cachedGuardWallStore.mtimeMs === st.mtimeMs) {
      return cachedGuardWallStore.data
    }
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    const walls = (Array.isArray(parsed && parsed.walls) ? parsed.walls : [])
      .map(w => normalizeGuardWall(w, w && w.projectKey ? w.projectKey : ''))
      .filter(Boolean)
      .slice(0, GUARD_WALLS_CAP)
    const data = { version: 1, walls }
    cachedGuardWallStore = { file, mtimeMs: st.mtimeMs, data }
    return data
  } catch {
    return { version: 1, walls: [] }
  }
}

export function isGuardWallActiveForCwd(wall, cwd = '') {
  if (!wall || wall.scope === 'paused') return false
  if (wall.scope === 'global') return true
  if (wall.scope === 'workspace') {
    const wallRoot = String(wall.projectKey || '').trim()
    const curCmp = normalizeCmpPath(cwd)
    if (!wallRoot || !curCmp) return false
    return isSubOrEqualPath(wallRoot, curCmp) || isSubOrEqualPath(curCmp, wallRoot)
  }
  return false
}

export function listGuardWalls({ cwd = '' } = {}) {
  const file = guardWallsFilePath()
  const store = loadGuardWallStoreFromDisk(file)
  const list = Array.isArray(store && store.walls) ? store.walls : []
  return list.map(w => ({
    ...w,
    activeNow: isGuardWallActiveForCwd(w, cwd),
  }))
}

function mergeSameTypeWallGroup(group, customTitle, cwd, now) {
  if (!Array.isArray(group) || group.length < 2) {
    return { ok: false, error: '合并同类物理驻墙需要至少 2 条同类型规则' }
  }
  const ruleType = group[0].ruleType
  const seenPat = new Set()
  const mergedPatterns = []
  for (const w of group) {
    for (const pat of (Array.isArray(w.patterns) ? w.patterns : [])) {
      const s = String(pat || '').trim()
      if (!s || seenPat.has(s)) continue
      seenPat.add(s)
      mergedPatterns.push(s)
    }
  }
  if (mergedPatterns.length > 96) {
    return { ok: false, error: '合并后的规则条目超出单墙上限（96 条），请分批合并' }
  }
  const patCheck = validatePatternsForRule(ruleType, mergedPatterns)
  if (!patCheck.ok) return patCheck

  const hasGlobal = group.some(w => w.scope === 'global')
  const hasWorkspace = group.some(w => w.scope === 'workspace')
  const scope = hasGlobal ? 'global' : (hasWorkspace ? 'workspace' : 'paused')
  const firstProj = group.map(w => w.projectKey).find(Boolean) || normalizeCmpPath(cwd)
  const projectKey = scope === 'workspace' ? firstProj : ''
  if (scope === 'workspace' && !projectKey) {
    return { ok: false, error: '合并本工程物理驻墙缺少有效工程路径' }
  }

  const typeLabel = GUARD_WALL_TYPE_LABELS[ruleType] || ruleType
  const uniqueTitles = [...new Set(group.map(w => clampStr(w.title || '', 36)).filter(Boolean))]
  const previewTitles = uniqueTitles.slice(0, 2).join(' + ') + (uniqueTitles.length > 2 ? ' 等' : '')
  const finalTitle = clampStr(customTitle || '', 100)
    || clampStr(`${typeLabel}合集（${group.length} 合 1）${previewTitles ? '：' + previewTitles : ''}`, 100)
  const uniqueReasons = [...new Set(group.map(w => clampStr(w.reason || '', 120)).filter(Boolean))]
  const mergedReason = clampStr(uniqueReasons.join('；'), 200)
  const earliestCreated = group.reduce((min, w) => {
    const t = Number(w.createdAt) || now
    return t < min ? t : min
  }, now)

  return {
    ok: true,
    wall: {
      id: 'wall-' + crypto.randomBytes(4).toString('hex'),
      title: finalTitle,
      scope,
      projectKey,
      ruleType,
      patterns: patCheck.list,
      writeOnly: group.every(w => Boolean(w.writeOnly)),
      source: group.every(w => w.source === 'chief_crafted') ? 'chief_crafted' : 'manual',
      pinnedByUser: group.some(w => w.pinnedByUser !== false),
      reason: mergedReason,
      createdAt: earliestCreated,
      updatedAt: now,
    },
  }
}

export function mutateGuardWalls({
  op = 'save',
  wall = null,
  wallId = '',
  wallIds = [],
  autoGroup = false,
  title = '',
  scope = '',
  cwd = '',
  callerOrigin = '',
  humanConfirmToken = null,
} = {}) {
  const isHumanVerified = humanConfirmToken === HUMAN_BOUNDS_CONFIRM_TOKEN
    && (callerOrigin === 'human_ui' || callerOrigin === 'human_approval')
  const auth = isHumanVerified
    ? verifyBoundsWriteAuth({ action: 'bounds.set', callerOrigin, humanConfirmToken })
    : { ok: false }
  if (!auth.ok) {
    return {
      ok: false,
      blockedBySafetyGuard: true,
      rule: 'guard_wall_human_only',
      error: '安全卫兵硬拦截：物理驻墙仅允许人类在面板确认筑墙或调整状态，严禁任何模型私自改动或解除物理墙！',
    }
  }

  const file = guardWallsFilePath()
  const release = acquireGuardWallLock(file)
  try {
    const store = loadGuardWallStoreFromDisk(file)
    const walls = Array.isArray(store.walls) ? store.walls.map(w => ({ ...w })) : []
    const now = Date.now()
    let targetWall = null
    let mergedCount = 0
    let createdCount = 0

    if (op === 'save') {
      const res = validateGuardWallInput(wall, { cwd })
      if (!res.ok) return { ok: false, error: res.error }
      const nextWall = res.wall
      const idx = walls.findIndex(w => w.id === nextWall.id)
      if (idx >= 0) {
        nextWall.createdAt = walls[idx].createdAt || nextWall.createdAt
        walls[idx] = nextWall
      } else {
        if (walls.length >= GUARD_WALLS_CAP) {
          walls.shift()
        }
        walls.push(nextWall)
      }
      targetWall = nextWall
    } else if (op === 'set_scope') {
      const id = String(wallId || (wall && wall.id) || '').trim()
      const idx = walls.findIndex(w => w.id === id)
      if (idx < 0) return { ok: false, error: `未找到物理驻墙：${id || '空 ID'}` }
      const nextScope = String(scope || '').trim().toLowerCase()
      if (!GUARD_WALL_SCOPES.includes(nextScope)) {
        return { ok: false, error: `无效的物理驻墙状态：${scope}` }
      }
      const nextProj = nextScope === 'workspace'
        ? (walls[idx].projectKey || normalizeCmpPath(cwd))
        : walls[idx].projectKey
      if (nextScope === 'workspace' && !nextProj) {
        return { ok: false, error: '切换为「仅当前工程」前缺少有效工程路径' }
      }
      walls[idx] = {
        ...walls[idx],
        scope: nextScope,
        projectKey: nextProj,
        updatedAt: now,
      }
      targetWall = walls[idx]
    } else if (op === 'remove') {
      const id = String(wallId || (wall && wall.id) || '').trim()
      const idx = walls.findIndex(w => w.id === id)
      if (idx < 0) return { ok: false, error: `未找到物理驻墙：${id || '空 ID'}` }
      targetWall = walls[idx]
      walls.splice(idx, 1)
    } else if (op === 'merge') {
      if (autoGroup) {
        const buckets = new Map()
        for (const w of walls) {
          if (!w || !w.ruleType) continue
          if (w.scope !== 'paused' && w.scope !== 'global' && !isGuardWallActiveForCwd(w, cwd)) continue
          const bucketKey = (w.scope === 'paused' ? 'paused|' : 'active|') + w.ruleType
          if (!buckets.has(bucketKey)) buckets.set(bucketKey, [])
          buckets.get(bucketKey).push(w)
        }
        const mergeGroups = [...buckets.values()].filter(g => g.length >= 2)
        if (!mergeGroups.length) {
          return { ok: false, code: 'NOTHING_TO_MERGE', error: '当前没有 2 条及以上相同类型的物理驻墙可供合并' }
        }
        const replaceAtFirstId = new Map()
        const dropIds = new Set()
        for (const g of mergeGroups) {
          const built = mergeSameTypeWallGroup(g, '', cwd, now)
          if (!built.ok) return built
          replaceAtFirstId.set(g[0].id, built.wall)
          for (let i = 1; i < g.length; i += 1) dropIds.add(g[i].id)
          mergedCount += g.length
          createdCount += 1
          targetWall = built.wall
        }
        const rebuiltWalls = []
        for (const w of walls) {
          if (dropIds.has(w.id)) continue
          rebuiltWalls.push(replaceAtFirstId.get(w.id) || w)
        }
        walls.length = 0
        walls.push(...rebuiltWalls)
      } else {
        const cleanIds = [...new Set((Array.isArray(wallIds) ? wallIds : []).map(x => String(x || '').trim()).filter(Boolean))]
        if (cleanIds.length < 2) {
          return { ok: false, code: 'MERGE_MIN_TWO', error: '请至少勾选 2 条相同类型的物理驻墙后再合并' }
        }
        const idSet = new Set(cleanIds)
        const picked = walls.filter(w => idSet.has(w.id))
        if (picked.length !== cleanIds.length) {
          return { ok: false, error: '部分所选物理驻墙不存在或已被移除，请刷新后重试' }
        }
        const distinctTypes = [...new Set(picked.map(w => w.ruleType))]
        if (distinctTypes.length > 1) {
          const distinctLabels = distinctTypes.map(t => GUARD_WALL_TYPE_LABELS[t] || t).join('、')
          return {
            ok: false,
            code: 'CROSS_TYPE_MERGE_FORBIDDEN',
            error: `⛔ 禁止跨类型合并物理驻墙：您同时勾选了「${distinctLabels}」，仅允许相同拦截类型的物理驻墙合并！`,
          }
        }
        const built = mergeSameTypeWallGroup(picked, title, cwd, now)
        if (!built.ok) return built
        const firstIdx = walls.findIndex(w => w.id === picked[0].id)
        const rebuiltWalls = []
        for (let i = 0; i < walls.length; i += 1) {
          if (i === firstIdx) {
            rebuiltWalls.push(built.wall)
            continue
          }
          if (idSet.has(walls[i].id)) continue
          rebuiltWalls.push(walls[i])
        }
        walls.length = 0
        walls.push(...rebuiltWalls)
        targetWall = built.wall
        mergedCount = picked.length
        createdCount = 1
      }
    } else {
      return { ok: false, error: `不支持的物理墙操作：${op}` }
    }

    const nextPayload = { version: 1, walls }
    atomicWriteGuardWalls(file, nextPayload)
    return {
      ok: true,
      op,
      mergedCount,
      createdCount,
      wall: targetWall ? { ...targetWall, activeNow: isGuardWallActiveForCwd(targetWall, cwd) } : null,
      walls: walls.map(w => ({ ...w, activeNow: isGuardWallActiveForCwd(w, cwd) })),
    }
  } finally {
    release()
  }
}

function extractPathFromArgs(args = {}) {
  if (!args || typeof args !== 'object') return ''
  const raw = args.path
    || args.file_path
    || args.filePath
    || args.target_file
    || args.targetFile
    || args.destination
    || args.TargetFile
    || args.AbsolutePath
    || args.SearchPath
    || ''
  return typeof raw === 'string' ? raw.trim() : ''
}

function extractPatchPaths(patchText) {
  const text = String(patchText || '')
  if (!text) return []
  const out = []
  const seen = new Set()
  const re = /^\*\*\*\s+(?:Add|Update|Delete)\s+File:\s*(.+)$|^\*\*\*\s+Move\s+to:\s*(.+)$/gm
  let m
  while ((m = re.exec(text)) !== null) {
    const p = String(m[1] || m[2] || '').trim()
    if (p && !seen.has(p)) {
      seen.add(p)
      out.push(p)
    }
  }
  return out
}

function extractAllPathsFromArgs(toolLower, args = {}) {
  const out = []
  const seen = new Set()
  const pushPath = (p) => {
    const clean = String(p || '').trim()
    if (clean && !seen.has(clean)) {
      seen.add(clean)
      out.push(clean)
    }
  }
  pushPath(extractPathFromArgs(args))
  const patchBody = args && typeof args === 'object' ? (args.input || args.patch || '') : ''
  if (
    toolLower === 'apply_patch'
    || (typeof patchBody === 'string' && /^\*\*\*\s+(?:Begin\s+Patch|(?:Add|Update|Delete)\s+File:)/m.test(patchBody))
  ) {
    for (const p of extractPatchPaths(patchBody)) pushPath(p)
  }
  return out
}

function extractCmdFromArgs(args = {}, toolLower = '') {
  if (!args || typeof args !== 'object') return ''
  // `str_replace_editor` uses `args.command` as editor subcommand (`view`/`create`/`str_replace`/`insert`), NOT a shell command.
  if (toolLower === 'str_replace_editor') return ''
  const raw = args.command || args.cmd || args.CommandLine || args.script || ''
  return typeof raw === 'string' ? raw.trim() : ''
}

function matchPathAgainstPattern(resolvedAbsPath, cwd, pattern) {
  const patRaw = String(pattern || '').trim()
  if (!patRaw || !resolvedAbsPath) return false
  const cmpTarget = normalizeCmpPath(resolvedAbsPath)
  if (!cmpTarget) return false

  // Direct absolute path or workspace-relative path match
  const baseForRel = cwd || process.cwd()
  const patAbs = path.isAbsolute(patRaw) ? patRaw : path.resolve(baseForRel, patRaw)
  const cmpPat = normalizeCmpPath(patAbs)
  if (cmpPat && isSubOrEqualPath(cmpPat, cmpTarget)) return true

  // Segment / relative path token match (for cross-project guards such as `DSHGuard` or `.github/workflows`)
  const normPatToken = patRaw.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase()
  if (!normPatToken) return false
  if (normPatToken.includes('/')) {
    return cmpTarget === normPatToken || cmpTarget.endsWith('/' + normPatToken) || cmpTarget.includes('/' + normPatToken + '/')
  }
  const segs = cmpTarget.split('/').filter(Boolean)
  return segs.includes(normPatToken)
}

function matchCommandAgainstPathPattern(command, pattern) {
  const patRaw = String(pattern || '').trim()
  const cmdRaw = String(command || '').trim()
  if (!patRaw || !cmdRaw) return false
  const normPat = patRaw.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase()
  if (!normPat || normPat.length < 2) return false
  const analysis = analyzeCommand(cmdRaw)
  const probes = [
    cmdRaw,
    analysis.normalized,
    ...analysis.segments,
    ...analysis.inlinePayloads,
  ]
    .filter(Boolean)
    .map(p => p.replace(/\\/g, '/').toLowerCase())

  for (const probe of probes) {
    if (probe.includes(normPat)) return true
  }
  return false
}

export function evaluateGuardWalls({
  tool = '',
  opClass = 'read',
  targetPath = '',
  command = '',
  args = null,
  cwd = '',
  walls = null,
} = {}) {
  const argObj = args && typeof args === 'object' ? args : {}
  const resolvedTool = String(tool || '').trim()
  const toolLower = resolvedTool.toLowerCase()
  const allRawPaths = extractAllPathsFromArgs(toolLower, argObj)
  const explicitRaw = String(targetPath || '').trim()
  if (explicitRaw && !allRawPaths.includes(explicitRaw)) allRawPaths.unshift(explicitRaw)
  const rawPath = allRawPaths[0] || ''
  const rawCmd = String(command || extractCmdFromArgs(argObj, toolLower) || '').trim()
  const rawExecCwd = toolLower === 'run_command' || SHELL_TOOLS.has(toolLower)
    ? String(argObj.cwd || argObj.Cwd || '').trim()
    : ''
  const activeWalls = (Array.isArray(walls) ? walls : listGuardWalls({ cwd }))
    .filter(w => w && w.scope !== 'paused' && (Array.isArray(walls) ? isGuardWallActiveForCwd(w, cwd) : w.activeNow !== false))

  if (!activeWalls.length) return { decision: 'allow' }

  const absTargetPaths = allRawPaths.map(p => path.resolve(cwd || process.cwd(), p))
  const absExecCwd = rawExecCwd ? path.resolve(cwd || process.cwd(), rawExecCwd) : ''

  for (const w of activeWalls) {
    if (w.ruleType === 'deny_tool') {
      if (w.patterns.some(p => p.toLowerCase() === toolLower)) {
        return {
          decision: 'block',
          wallId: w.id,
          wallTitle: w.title,
          rule: 'guard_wall_deny_tool',
          reason: `动态物理墙「${w.title}」禁止调用工具 \`${resolvedTool}\``,
          badge: '🧱 物理墙禁调工具',
        }
      }
      continue
    }

    if (w.ruleType === 'forbid_path') {
      if (w.writeOnly && opClass === 'read' && !rawCmd) continue
      const hitTargetPath = absTargetPaths.some(absP => w.patterns.some(p => matchPathAgainstPattern(absP, cwd, p)))
      const hitExecCwd = absExecCwd && w.patterns.some(p => matchPathAgainstPattern(absExecCwd, cwd, p))
      const hitCmdPath = rawCmd && w.patterns.some(p => matchCommandAgainstPathPattern(rawCmd, p))
      if (hitTargetPath || hitExecCwd || hitCmdPath) {
        return {
          decision: 'block',
          wallId: w.id,
          wallTitle: w.title,
          rule: 'guard_wall_forbid_path',
          reason: `动态物理墙「${w.title}」已锁死禁止触碰该路径/目标（${w.patterns.join(', ')}）`,
          badge: '🧱 物理墙锁路径',
        }
      }
      continue
    }

    if (w.ruleType === 'restrict_write' && opClass !== 'read' && absTargetPaths.length > 0) {
      const violatedIdx = absTargetPaths.findIndex(absP => !w.patterns.some(p => matchPathAgainstPattern(absP, cwd, p)))
      if (violatedIdx >= 0) {
        return {
          decision: 'block',
          wallId: w.id,
          wallTitle: w.title,
          rule: 'guard_wall_restrict_write',
          reason: `动态物理墙「${w.title}」将写入范围严格限定于 [${w.patterns.join(', ')}]，禁止写入 ${allRawPaths[violatedIdx] || rawPath}`,
          badge: '🧱 物理墙收窄写区',
        }
      }
      continue
    }

    if ((w.ruleType === 'forbid_cmd' || w.ruleType === 'require_approval_cmd') && rawCmd) {
      const analysis = analyzeCommand(rawCmd)
      const probes = [
        rawCmd,
        analysis.normalized,
        ...analysis.segments,
        ...analysis.inlinePayloads,
      ].filter(Boolean)

      for (const pat of w.patterns) {
        let re = null
        try { re = new RegExp(pat, 'i') } catch { re = null }
        if (!re) continue
        if (probes.some(probe => re.test(probe) || re.test(normalizeCommandForSecurity(probe)))) {
          if (w.ruleType === 'forbid_cmd') {
            return {
              decision: 'block',
              wallId: w.id,
              wallTitle: w.title,
              rule: 'guard_wall_forbid_cmd',
              reason: `动态物理墙「${w.title}」事前拦截高危/受禁命令规则 (${pat})`,
              badge: '🧱 物理墙拦命令',
            }
          }
          return {
            decision: 'require_approval',
            wallId: w.id,
            wallTitle: w.title,
            rule: 'guard_wall_require_approval_cmd',
            reason: `动态物理墙「${w.title}」要求执行该命令前先获人工确认 (${pat})`,
            badge: '🧱 物理墙待确认',
          }
        }
      }
    }
  }

  return { decision: 'allow' }
}

/**
 * Unified pre-execution physical defense gate for ALL agents (`@lead`, subagents,
 * and Chief tools), triggered directly on host `tools/pre-execute`.
 */
export function evaluatePreExecuteDefense({
  tool = '',
  args = null,
  cwd = '',
  board = null,
  walls = null,
} = {}) {
  const toolName = String(tool || '').trim()
  const lower = toolName.toLowerCase()
  if (!toolName || SAFE_META_TOOLS.has(lower)) {
    return { decision: 'allow' }
  }

  const argObj = args && typeof args === 'object' ? args : {}
  const allPaths = extractAllPathsFromArgs(lower, argObj)
  const resolvedPath = allPaths[0] || ''
  const resolvedCmd = extractCmdFromArgs(argObj, lower)

  const isStrReplaceRead = lower === 'str_replace_editor' && String(argObj.command || '').trim().toLowerCase() === 'view'
  const isShell = SHELL_TOOLS.has(lower) || (Boolean(resolvedCmd) && !READ_ONLY_FS_TOOLS.has(lower) && !isStrReplaceRead)
  const isWrite = !isStrReplaceRead && (
    WORKSPACE_WRITE_TOOLS.has(lower)
    || (lower === 'str_replace_editor' && Boolean(argObj.command))
    || /(?:write|edit|patch|delete|remove|unlink|mkdir|rmdir|move|rename)/i.test(lower)
  )
  const opClass = (isShell || isWrite) ? 'workspace' : 'read'

  // 1) Dynamic Guard Walls check first (covers read/read_file/list_dir on forbidden global walls + writes/shell)
  const wallVerdict = evaluateGuardWalls({
    tool: toolName,
    opClass,
    targetPath: resolvedPath,
    command: resolvedCmd,
    args: argObj,
    cwd,
    walls,
  })
  if (wallVerdict.decision === 'block') {
    return {
      decision: 'deny',
      stage: 'guard_wall',
      rule: wallVerdict.rule,
      wallId: wallVerdict.wallId,
      wallTitle: wallVerdict.wallTitle,
      reason: wallVerdict.reason,
      badge: wallVerdict.badge,
    }
  }
  if (wallVerdict.decision === 'require_approval') {
    return {
      decision: 'ask',
      stage: 'guard_wall',
      rule: wallVerdict.rule,
      wallId: wallVerdict.wallId,
      wallTitle: wallVerdict.wallTitle,
      reason: `${wallVerdict.reason}（受动态物理墙保护，需要人工单次批准后方可执行）`,
      displayReason: `🧱 物理驻墙「${wallVerdict.wallTitle}」：${wallVerdict.reason}`,
      badge: wallVerdict.badge,
    }
  }

  const extraText = [
    argObj.content,
    argObj.new_string,
    argObj.new_str,
    argObj.insert_text,
    argObj.file_text,
    argObj.input,
    argObj.target,
    argObj.replacement,
    argObj.TargetContent,
    argObj.ReplacementContent,
    argObj.CodeContent,
    argObj.text,
  ]
    .filter(v => v !== undefined && v !== null && String(v).trim())
    .map(v => String(v).slice(0, 8192))
    .join('\n')
    .slice(0, 12_288)

  // 2) Built-in non-overridable pre-execute invariant checks for commands
  if (resolvedCmd) {
    const credTouch = commandTouchesSensitiveCredential(resolvedCmd)
    if (credTouch.touched) {
      return {
        decision: 'deny',
        stage: 'safety_guard',
        rule: credTouch.viaInline ? 'inline_script_credential' : 'sensitive_credential_cmd',
        reason: credTouch.viaInline
          ? '安全卫兵事前拦截内联脚本（node -e / python -c / pwsh）触及敏感凭据路径'
          : '安全卫兵事前拦截触及敏感凭据路径的终端命令',
        badge: '🛡️ 事前拦凭据命令',
      }
    }
    if (isDestructiveShellCommand(resolvedCmd)) {
      return {
        decision: 'deny',
        stage: 'safety_guard',
        rule: 'destructive_command',
        reason: `安全卫兵事前拦截高危破坏性系统命令：${clampStr(resolvedCmd, 80)}`,
        badge: '🛡️ 事前拦高危命令',
      }
    }
    if (isShell && cwd) {
      const rawRunCwd = String(argObj.cwd || argObj.Cwd || '').trim()
      if (rawRunCwd) {
        const cwdCheck = validateWorkspacePath(cwd, path.resolve(cwd, rawRunCwd), { mode: 'write' })
        if (cwdCheck.blocked) {
          return {
            decision: 'deny',
            stage: 'safety_guard',
            rule: cwdCheck.rule || 'workspace_escape',
            reason: `安全卫兵事前拦截越界执行目录 (${rawRunCwd})`,
            badge: '🛡️ 事前拦越界目录',
          }
        }
      }
    }
    const boundCmdCheck = checkForbiddenBounds(board, toolName, resolvedCmd, extraText)
    if (boundCmdCheck.blocked) {
      return {
        decision: 'deny',
        stage: 'safety_guard',
        rule: 'forbidden_bound',
        matchedRule: boundCmdCheck.matchedRule,
        reason: `安全卫兵命中禁止红线【${boundCmdCheck.matchedRule}】，事前拒止执行`,
        badge: '🛡️ 事前拦红线',
      }
    }
  }

  // 3) Built-in invariant checks for file paths (all paths including apply_patch targets)
  for (const pathItem of allPaths) {
    if (hasWindowsReservedDeviceName(pathItem)) {
      return {
        decision: 'deny',
        stage: 'safety_guard',
        rule: 'windows_reserved_device',
        reason: `安全卫兵事前拦截 Windows 保留设备名路径：${pathItem}`,
        badge: '🛡️ 事前拦设备名',
      }
    }
    if (hasForbiddenNtfsAds(pathItem)) {
      return {
        decision: 'deny',
        stage: 'safety_guard',
        rule: 'ntfs_ads_stream',
        reason: `安全卫兵事前拦截 NTFS 备用数据流 (ADS)：${pathItem}`,
        badge: '🛡️ 事前拦 ADS',
      }
    }
    if (isSensitiveCredentialPath(pathItem)) {
      return {
        decision: 'deny',
        stage: 'safety_guard',
        rule: 'sensitive_credential',
        reason: `安全卫兵事前拦截敏感凭据文件触及（${path.basename(pathItem)}）`,
        badge: '🛡️ 事前拦凭据',
      }
    }
    if (opClass !== 'read') {
      const absTarget = path.resolve(cwd || process.cwd(), pathItem)
      const writeCheck = validateWorkspacePath(cwd, absTarget, { mode: 'write' })
      if (writeCheck.blocked) {
        return {
          decision: 'deny',
          stage: 'safety_guard',
          rule: writeCheck.rule || 'workspace_escape',
          reason: writeCheck.reason,
          badge: writeCheck.badge || '🛡️ 事前拦越界写',
        }
      }
      const boundPathCheck = checkForbiddenBounds(board, toolName, absTarget, extraText)
      if (boundPathCheck.blocked) {
        return {
          decision: 'deny',
          stage: 'safety_guard',
          rule: 'forbidden_bound',
          matchedRule: boundPathCheck.matchedRule,
          reason: `安全卫兵命中禁止红线【${boundPathCheck.matchedRule}】，事前拒止改动 ${path.basename(pathItem)}`,
          badge: '🛡️ 事前拦红线',
        }
      }
    }
  }

  return { decision: 'allow' }
}

export { HUMAN_BOUNDS_CONFIRM_TOKEN }
