/**
 * state-media.js — 参谋附件图片落盘、路径解析与档案目标目录映射
 *
 * 【核心职责】
 *   承载 `resolveSessionWorkspaceCwd`、`archiveTargetForRoot`、`persistChiefImagesToWorkspace` 与
 *   `admitChiefImages`（含 `@deepseek-ai/dsh-attachment` 惰性加载），处理多模态附件安全入库。
 *
 * 【边界约定】
 *   - 仅依赖 `state-schema.js` 的纯函数（如 `clamp`），不反向导入 `chief-state.js` 状态锁层。
 */

import fs from 'node:fs'
import path from 'node:path'
import { clamp } from './state-schema.js'

let dshAttachmentModulePromise = null

export async function loadDshAttachment() {
  if (!dshAttachmentModulePromise) {
    dshAttachmentModulePromise = import('@deepseek-ai/dsh-attachment').catch(() => null)
  }
  return dshAttachmentModulePromise
}

const CHIEF_MAX_IMAGES = 4

const CHIEF_IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

export function normalizeUploadedImage(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  let mediaType = String(raw.mediaType || raw.mimeType || raw.type || '').trim().toLowerCase()
  let data = String(raw.data || raw.base64 || '').trim()
  const dataUrlMatch = data.match(/^data:([^;]+);base64,(.+)$/is)
  if (dataUrlMatch) {
    if (!mediaType) mediaType = dataUrlMatch[1].trim().toLowerCase()
    data = dataUrlMatch[2].trim()
  }
  if (mediaType === 'image/jpg') mediaType = 'image/jpeg'
  data = data.replace(/\s+/g, '')
  if (!CHIEF_IMAGE_MEDIA_TYPES.has(mediaType) || !data) return null
  const ext = mediaType === 'image/jpeg' ? 'jpg' : (mediaType.split('/')[1] || 'png')
  const name = typeof raw.name === 'string' && raw.name.trim()
    ? clamp(raw.name.trim(), 80)
    : `chief-image-${idx + 1}.${ext}`
  return { name, mediaType, data }
}

export function resolveSessionWorkspaceCwd(deps, sessionId) {
  const rootId = (deps && typeof deps.resolveRootSessionId === 'function' ? deps.resolveRootSessionId(sessionId) : '') || sessionId
  try {
    if (deps && typeof deps.getSessionCwd === 'function') {
      const c = deps.getSessionCwd(rootId) || deps.getSessionCwd(sessionId)
      if (c && fs.existsSync(c)) return c
    }
    if (deps && typeof deps.boardForSession === 'function' && typeof deps.boardFileFor === 'function') {
      const b = deps.boardForSession(deps.boardFileFor(rootId))
      const sess = b && b.sessions && (b.sessions[rootId] || b.sessions[sessionId])
      if (sess && sess.cwd && fs.existsSync(sess.cwd)) return sess.cwd
    }
  } catch {}
  return process.cwd()
}

export function archiveTargetForRoot(deps, rootId, extra = '') {
  const opts = extra && typeof extra === 'object' ? extra : { cabinetId: String(extra || '') }
  const vaultScope = opts.vaultScope === 'global' ? 'global' : 'session'
  const sharedFile = deps && (typeof deps.sharedBoardFile === 'function' ? deps.sharedBoardFile() : deps.sharedBoardFile)
  const cwd = resolveSessionWorkspaceCwd(deps, rootId)
  let cab = opts.cabinetId ? String(opts.cabinetId).trim() : ''
  if (vaultScope !== 'global' && !cab && deps && typeof deps.boardForSession === 'function' && typeof deps.boardFileFor === 'function' && rootId && rootId !== 'global') {
    try {
      const b = deps.boardForSession(deps.boardFileFor(rootId))
      if (b && typeof b.activeCabinetId === 'string') cab = b.activeCabinetId.trim()
    } catch {}
  }
  return {
    customSharedBoardFile: sharedFile || '',
    cwd,
    vaultScope,
    ...(vaultScope !== 'global' && rootId && rootId !== 'global' ? { rootSessionId: String(rootId).trim() } : {}),
    ...(cab ? { cabinetId: cab } : {}),
  }
}

/**
 * Chief-of-Staff visibility matrix (Three-Tier Hook Architecture):
 * - Session Working Cabinet: Chief can always read session items + `recentlyUnpinnedWatch`.
 * - Global Vault: Unorganized global items (without hooks) are 0-token invisible to Chief!
 *   Organized global items expose ONLY lightweight `globalHookIndex` (`hasHook: true`),
 *   until Chief explicitly pulls/mounts them (`chiefMountedSessions` / `chiefPulledSessions`).
 * - Precipitated Cold Vault: 100% invisible to Chief (0 disk read, 0 hook leak) unless User explicitly `flippedOut`!
 */

export function persistChiefImagesToWorkspace(deps, sessionId, rawImages) {
  const list = Array.isArray(rawImages) ? rawImages.slice(0, CHIEF_MAX_IMAGES) : []
  if (!list.length) return []
  const normalized = list.map((item, idx) => normalizeUploadedImage(item, idx)).filter(Boolean)
  if (!normalized.length) return []

  const cwd = resolveSessionWorkspaceCwd(deps, sessionId)
  const uploadDir = path.join(cwd, '.dsh-chief', 'uploads')
  fs.mkdirSync(uploadDir, { recursive: true })

  const d = new Date()
  const stamp = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('') + '-' + [
    String(d.getHours()).padStart(2, '0'),
    String(d.getMinutes()).padStart(2, '0'),
    String(d.getSeconds()).padStart(2, '0'),
  ].join('')

  const saved = []
  for (let idx = 0; idx < normalized.length; idx += 1) {
    const img = normalized[idx]
    const ext = img.mediaType === 'image/jpeg' ? 'jpg' : (img.mediaType.split('/')[1] || 'png')
    const baseRaw = path.basename(String(img.name || `image-${idx + 1}`), path.extname(String(img.name || '')))
    const safeName = baseRaw.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || `image-${idx + 1}`
    const fileName = `${stamp}-${idx + 1}-${safeName}.${ext}`
    const absPath = path.join(uploadDir, fileName)
    const buf = Buffer.from(img.data, 'base64')
    fs.writeFileSync(absPath, buf)
    saved.push({
      index: idx + 1,
      path: absPath,
      name: img.name || fileName,
      mediaType: img.mediaType,
      bytes: buf.length,
    })
  }
  return saved
}

export async function admitChiefImages(deps, rawImages) {
  const list = Array.isArray(rawImages) ? rawImages.slice(0, CHIEF_MAX_IMAGES) : []
  if (!list.length) return []
  const normalized = list.map((item, idx) => normalizeUploadedImage(item, idx)).filter(Boolean)
  if (!normalized.length) {
    throw new Error('上传的图片格式不受支持（仅支持 PNG / JPEG / WebP / GIF Base64）')
  }

  if (deps && typeof deps.admitImagesOverride === 'function') {
    const refs = await deps.admitImagesOverride(normalized)
    return (Array.isArray(refs) ? refs : []).filter(Boolean).map(attachment => ({ type: 'image', attachment }))
  }

  const attachmentsSvc = deps && typeof deps.getAttachments === 'function'
    ? deps.getAttachments()
    : (deps && deps.runtime && typeof deps.runtime.get === 'function' ? deps.runtime.get('attachments') : null)
  if (!attachmentsSvc) {
    throw new Error('当前 DSH 运行环境未挂载 attachments 图片服务，无法处理图片上传')
  }

  const attMod = await loadDshAttachment()
  if (attMod && typeof attMod.admitEncodedImages === 'function') {
    const refs = await attMod.admitEncodedImages(attachmentsSvc, normalized)
    return (Array.isArray(refs) ? refs : []).map(attachment => ({ type: 'image', attachment }))
  }

  if (typeof attachmentsSvc.saveImages === 'function') {
    const payload = normalized.map(img => ({
      data: Uint8Array.from(Buffer.from(img.data, 'base64')),
      mediaType: img.mediaType,
      name: img.name,
    }))
    const refs = await attachmentsSvc.saveImages(payload)
    return (Array.isArray(refs) ? refs : []).map(attachment => ({ type: 'image', attachment }))
  }

  throw new Error('attachments 服务缺少 saveImages / admitEncodedImages 接口')
}
