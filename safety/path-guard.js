/**
 * safety/path-guard.js
 *
 * Workspace containment, symlink/junction escape detection, Windows reserved
 * device & NTFS ADS checks, sensitive credential path matching, and bounds.*
 * human confirmation guard.
 */

import fs from 'node:fs'
import path from 'node:path'

export const HUMAN_BOUNDS_CONFIRM_TOKEN = Symbol.for('dsh-chief.humanBoundsConfirm')

const SENSITIVE_CREDENTIAL_BASENAMES = /^(?:\.+env(?:\.[a-z0-9_-]+)?|\.credentials(?:\.[a-z0-9_-]+)?|\.(?:git-credentials|npmrc|pypirc|netrc))$/i
const SENSITIVE_CREDENTIAL_FULLPATH = /(?:id_rsa|id_ed25519|id_ecdsa|id_dsa|\.pem$|\.p12$|\.pfx$|credentials\.json$|secrets?\.(?:json|ya?ml)$)/i
const WINDOWS_RESERVED_DEVICE_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.[^.]*)?$/i

export function safeRealpath(targetPath) {
  try {
    return fs.realpathSync.native ? fs.realpathSync.native(targetPath) : fs.realpathSync(targetPath)
  } catch {
    return path.resolve(targetPath)
  }
}

function resolveDeepestExistingPath(absPath) {
  if (fs.existsSync(absPath)) {
    return safeRealpath(absPath)
  }
  const missingTail = []
  let probe = absPath
  while (probe && !fs.existsSync(probe)) {
    const parent = path.dirname(probe)
    if (parent === probe) break
    missingTail.unshift(path.basename(probe))
    probe = parent
  }
  const realBase = fs.existsSync(probe) ? safeRealpath(probe) : path.resolve(probe)
  return missingTail.length ? path.join(realBase, ...missingTail) : realBase
}

export function isPathInsideWorkspace(workspaceRoot, targetPath) {
  if (!workspaceRoot || !targetPath) return false
  const rootAbs = safeRealpath(workspaceRoot)
  const resolvedCandidate = path.resolve(rootAbs, String(targetPath))
  const realTarget = resolveDeepestExistingPath(resolvedCandidate)
  const cmpRoot = process.platform === 'win32' ? rootAbs.toLowerCase() : rootAbs
  const cmpTarget = process.platform === 'win32' ? realTarget.toLowerCase() : realTarget
  const rel = path.relative(cmpRoot, cmpTarget)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

export function hasWindowsReservedDeviceName(filePath) {
  const raw = String(filePath || '').trim()
  if (!raw) return false
  const withoutDrive = raw.replace(/^[a-zA-Z]:(?=[\\/]|$)/, '')
  const parts = withoutDrive.split(/[\\/]+/).filter(Boolean)
  return parts.some(seg => WINDOWS_RESERVED_DEVICE_RE.test(seg))
}

export function hasForbiddenNtfsAds(filePath) {
  const raw = String(filePath || '').trim()
  if (!raw) return false
  const withoutDrive = raw.replace(/^[a-zA-Z]:(?=[\\/]|$)/, '')
  return withoutDrive.includes(':')
}

function isSensitiveNameOrStream(candidate) {
  const s = String(candidate || '').trim()
  if (!s || s === '$DATA') return false
  const slashNorm = s.replace(/\\/g, '/').toLowerCase()
  const base = path.basename(slashNorm)
  if (SENSITIVE_CREDENTIAL_BASENAMES.test(base)) return true
  if (SENSITIVE_CREDENTIAL_FULLPATH.test(slashNorm)) return true
  return false
}

function resolveWithSymlinkTarget(filePath) {
  const out = []
  const raw = String(filePath || '').trim()
  if (!raw) return out
  out.push(raw)
  try {
    const abs = path.resolve(raw)
    out.push(abs)
    try {
      const lst = fs.lstatSync(abs)
      if (lst.isSymbolicLink()) {
        const linkTarget = fs.readlinkSync(abs)
        out.push(linkTarget)
        out.push(path.resolve(path.dirname(abs), linkTarget))
      }
    } catch {}
    out.push(safeRealpath(abs))
    const parent = path.dirname(abs)
    if (fs.existsSync(parent)) {
      out.push(path.join(safeRealpath(parent), path.basename(abs)))
    }
  } catch {}
  return out
}

export function isSensitiveCredentialPath(filePath) {
  const candidates = resolveWithSymlinkTarget(filePath)
  for (const cand of candidates) {
    if (isSensitiveNameOrStream(cand)) return true
    // Strip Windows drive letter `C:` then inspect any NTFS Alternate Data Streams (`file.txt:.env:$DATA`)
    const withoutDrive = String(cand || '').replace(/^[a-zA-Z]:(?=[\\/]|$)/, '')
    if (withoutDrive.includes(':')) {
      for (const streamPart of withoutDrive.split(':')) {
        if (isSensitiveNameOrStream(streamPart)) return true
      }
    }
  }
  return false
}

export function validateWorkspacePath(workspaceRoot, targetPath, { mode = 'write', allowedSubPrefixes = null } = {}) {
  const raw = String(targetPath || '').trim()
  if (!raw) return { blocked: false, resolvedPath: '' }

  if (hasWindowsReservedDeviceName(raw)) {
    return {
      blocked: true,
      stage: 'safety_guard',
      rule: 'windows_reserved_device',
      reason: `安全卫兵拦截 Windows 保留设备名路径：${path.basename(raw)}`,
      badge: '🛡️ 卫兵拦保留设备名',
    }
  }

  if (hasForbiddenNtfsAds(raw)) {
    return {
      blocked: true,
      stage: 'safety_guard',
      rule: 'ntfs_ads_stream',
      reason: `安全卫兵拦截 NTFS 交替数据流 (ADS) 路径：${path.basename(raw)}`,
      badge: '🛡️ 卫兵拦ADS流',
    }
  }

  if (isSensitiveCredentialPath(raw)) {
    return {
      blocked: true,
      stage: 'safety_guard',
      rule: 'sensitive_credential',
      reason: `安全卫兵拦截访问敏感凭据文件：${path.basename(raw)}`,
      badge: '🛡️ 卫兵拦凭据',
    }
  }

  if (workspaceRoot && !isPathInsideWorkspace(workspaceRoot, raw)) {
    return {
      blocked: true,
      stage: 'safety_guard',
      rule: 'workspace_escape',
      reason: `安全卫兵拦截工作区越界路径：${raw}`,
      badge: '🛡️ 卫兵拦越界路径',
    }
  }

  const resolvedAbs = workspaceRoot ? path.resolve(safeRealpath(workspaceRoot), raw) : path.resolve(raw)
  if (mode === 'write' && Array.isArray(allowedSubPrefixes) && allowedSubPrefixes.length > 0 && !allowedSubPrefixes.includes('*') && workspaceRoot) {
    const rootAbs = safeRealpath(workspaceRoot)
    const rel = path.relative(rootAbs, resolveDeepestExistingPath(resolvedAbs)).replace(/\\/g, '/').toLowerCase()
    const matched = allowedSubPrefixes.some(pref => {
      const clean = String(pref || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '').toLowerCase()
      if (!clean) return false
      return rel === clean || rel.startsWith(clean + '/')
    })
    if (!matched) {
      return {
        blocked: true,
        stage: 'permission_gate',
        rule: 'capability_prefix_denied',
        reason: `当前授权写前缀未覆盖目标路径：${rel || '.'}`,
        badge: '🔒 路径前缀未授权',
      }
    }
  }

  return { blocked: false, resolvedPath: resolvedAbs }
}

const BOUNDS_WRITE_ACTIONS = new Set([
  'bounds.set',
  'bounds.add',
  'bounds.pin',
  'bounds.remove',
  'bounds.edit',
  'bounds.consolidate',
])

export function verifyBoundsWriteAuth({
  action = '',
  field = '',
  callerOrigin = '',
  humanConfirmToken = null,
} = {}) {
  const act = String(action || '').trim()
  if (!BOUNDS_WRITE_ACTIONS.has(act)) return { ok: true }
  if (humanConfirmToken === HUMAN_BOUNDS_CONFIRM_TOKEN) return { ok: true }

  const origin = String(callerOrigin || '').trim()
  if (origin === 'human_ui' || origin === 'human_approval') return { ok: true }

  if (origin === 'model_tool') {
    return {
      ok: false,
      rule: 'bounds_human_only',
      error: '安全卫兵拦截：模型工具禁止直接改动或覆写工作边界（bounds.*），请改用 action="bounds.propose" 提交参谋长由用户拍板。',
    }
  }

  if (origin === 'chief_llm') {
    const normField = String(field || '').trim().toLowerCase()
    if (act === 'bounds.remove' || (act === 'bounds.set' && (!normField || normField === 'forbidden'))) {
      return {
        ok: false,
        rule: 'bounds_forbidden_protected',
        error: '安全卫兵拦截：禁止红线（forbidden）受人类确认保护，参谋不可未经用户拍板直接移除或覆写。',
      }
    }
  }

  return { ok: true }
}
