/**
 * src/client/custom-theme.js — 零依赖自定义 DIY 主题色彩引擎与图片提色器
 *
 * 【核心职责】
 *   1. 纯前端 HSL/WCAG 数学计算引擎：仅凭 4 个基础色值（主强调色 / 辅助点缀色 / 暖色高光 / 底调色）
 *      自动生成同时兼容 DSH 深色与浅色宿主的完整 `--dnb-*` 样式令牌，并保障文本对比度。
 *   2. 零依赖本地图片提色算法 `extractPaletteFromImageData` / `extractPaletteFromImageFile`：
 *      通过 `<canvas>` 像素量化与色距聚类提取 6 枚和谐主色色卡，自动分配角色。
 *   3. 动态 `<style id="dnb-custom-skin-style">` 注入与 `localStorage` 持久化。
 *
 * 【边界约定】
 *   - 仅依赖 `styles/theme.js` (`expandLightThemeSelectors`)，严禁反向导入 `store.js` / `styles.js`。
 */

import { expandLightThemeSelectors } from './styles/theme.js'

export const CUSTOM_SKIN_STORAGE_KEY = 'dsh-chief:custom-skin-v1'
export const CUSTOM_WALLPAPER_IDB_NAME = 'dsh-chief-assets-v1'
export const CUSTOM_WALLPAPER_IDB_STORE = 'wallpapers'
export const CUSTOM_WALLPAPER_IDB_KEY = 'custom-bg'
export const MAX_WALLPAPER_BYTES = 25 * 1024 * 1024

export const DEFAULT_CUSTOM_SKIN = {
  name: '流光定制',
  accentHex: '#8b7cf6',
  secondaryHex: '#5cc9a7',
  warmHex: '#f0b868',
  bgTintHex: '#171928',
  bgImageUrl: '',
  bgImageStorage: '',
  bgImageMeta: null,
  bgImageEnabled: true,
  bgImageOpacity: 0.28,
  bgImageBlur: 10,
  ambientGlow: true,
  radius: 'round',
  serifTitle: false,
  moodNote: '',
  source: 'manual',
  updatedAt: 0,
}

const DIY_HEX6_RE = /^#([0-9a-fA-F]{6})$/
const DIY_HEX3_RE = /^#([0-9a-fA-F]{3})$/
const DIY_DATA_IMG_RE = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/
const DIY_BLOB_IMG_RE = /^blob:(?:[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^"'()\s<>\\]+|null)\/[0-9a-fA-F-]{8,64}$/

let activeWallpaperObjectUrl = ''

export function sanitizeCustomImageUrl(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  if (DIY_BLOB_IMG_RE.test(s) && s.length <= 240) return s
  if (s.length <= 480000 && DIY_DATA_IMG_RE.test(s)) return s
  return ''
}

export function createManagedWallpaperUrl(blob) {
  if (!blob || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return ''
  try {
    const nextUrl = URL.createObjectURL(blob)
    const clean = sanitizeCustomImageUrl(nextUrl)
    if (!clean) {
      if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(nextUrl)
      return ''
    }
    if (activeWallpaperObjectUrl && activeWallpaperObjectUrl !== clean && typeof URL.revokeObjectURL === 'function') {
      try { URL.revokeObjectURL(activeWallpaperObjectUrl) } catch {}
    }
    activeWallpaperObjectUrl = clean
    return clean
  } catch {
    return ''
  }
}

export function revokeManagedWallpaperUrl() {
  if (!activeWallpaperObjectUrl) return
  try {
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(activeWallpaperObjectUrl)
    }
  } catch {}
  activeWallpaperObjectUrl = ''
}

function openWallpaperIdb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined' || typeof indexedDB.open !== 'function') {
      return reject(new Error('INDEXEDDB_UNAVAILABLE'))
    }
    try {
      const req = indexedDB.open(CUSTOM_WALLPAPER_IDB_NAME, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (db && !db.objectStoreNames.contains(CUSTOM_WALLPAPER_IDB_STORE)) {
          db.createObjectStore(CUSTOM_WALLPAPER_IDB_STORE)
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error || new Error('IDB open failed'))
    } catch (err) {
      reject(err)
    }
  })
}

export async function saveCustomWallpaperBlob(blob) {
  if (!blob || typeof Blob === 'undefined' || !(blob instanceof Blob)) return { ok: false }
  if (blob.size > MAX_WALLPAPER_BYTES) return { ok: false, error: 'IMAGE_TOO_LARGE' }
  let db = null
  try {
    db = await openWallpaperIdb()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(CUSTOM_WALLPAPER_IDB_STORE, 'readwrite')
      const storeObj = tx.objectStore(CUSTOM_WALLPAPER_IDB_STORE)
      storeObj.put(blob, CUSTOM_WALLPAPER_IDB_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error || new Error('IDB write failed'))
      tx.onabort = () => reject(tx.error || new Error('IDB write aborted'))
    })
    return { ok: true, sizeBytes: blob.size }
  } catch {
    return { ok: false }
  } finally {
    try { if (db && typeof db.close === 'function') db.close() } catch {}
  }
}

export async function loadCustomWallpaperBlob() {
  let db = null
  try {
    db = await openWallpaperIdb()
    const res = await new Promise((resolve, reject) => {
      const tx = db.transaction(CUSTOM_WALLPAPER_IDB_STORE, 'readonly')
      const req = tx.objectStore(CUSTOM_WALLPAPER_IDB_STORE).get(CUSTOM_WALLPAPER_IDB_KEY)
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => reject(req.error || new Error('IDB read failed'))
    })
    return (typeof Blob !== 'undefined' && res instanceof Blob) ? res : null
  } catch {
    return null
  } finally {
    try { if (db && typeof db.close === 'function') db.close() } catch {}
  }
}

export async function deleteCustomWallpaperBlob() {
  revokeManagedWallpaperUrl()
  let db = null
  try {
    db = await openWallpaperIdb()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(CUSTOM_WALLPAPER_IDB_STORE, 'readwrite')
      tx.objectStore(CUSTOM_WALLPAPER_IDB_STORE).delete(CUSTOM_WALLPAPER_IDB_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error || new Error('IDB delete failed'))
    })
    return true
  } catch {
    return false
  } finally {
    try { if (db && typeof db.close === 'function') db.close() } catch {}
  }
}

function diyClamp(n, min, max) {
  const num = Number(n)
  if (!Number.isFinite(num)) return min
  return Math.max(min, Math.min(max, num))
}

export function sanitizeCustomHex(raw, fallback = '#8b7cf6') {
  const s = String(raw || '').trim()
  if (DIY_HEX6_RE.test(s)) return s.toLowerCase()
  const m3 = s.match(DIY_HEX3_RE)
  if (m3) {
    const [r, g, b] = m3[1].split('')
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  const fb = String(fallback || '').trim()
  return DIY_HEX6_RE.test(fb) ? fb.toLowerCase() : '#8b7cf6'
}

export function normalizeCustomSkinConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const nameClean = String(src.name || '').replace(/[\r\n<>"{}]/g, ' ').replace(/\s+/g, ' ').trim()
  const noteClean = String(src.moodNote || '').replace(/[\r\n<>]/g, ' ').replace(/\s+/g, ' ').trim()
  const radius = ['round', 'medium', 'sharp'].includes(src.radius) ? src.radius : DEFAULT_CUSTOM_SKIN.radius
  const accentHex = sanitizeCustomHex(src.accentHex, DEFAULT_CUSTOM_SKIN.accentHex)
  const secondaryHex = sanitizeCustomHex(src.secondaryHex, DEFAULT_CUSTOM_SKIN.secondaryHex)
  const warmHex = sanitizeCustomHex(src.warmHex, DEFAULT_CUSTOM_SKIN.warmHex)
  const bgTintHex = sanitizeCustomHex(src.bgTintHex, DEFAULT_CUSTOM_SKIN.bgTintHex)
  const bgImageUrl = sanitizeCustomImageUrl(src.bgImageUrl)
  const rawStorage = String(src.bgImageStorage || '').trim()
  const bgImageStorage = ['idb', 'inline'].includes(rawStorage)
    ? rawStorage
    : (bgImageUrl.startsWith('blob:') ? 'idb' : (bgImageUrl.startsWith('data:') ? 'inline' : ''))
  const rawMeta = src.bgImageMeta && typeof src.bgImageMeta === 'object' ? src.bgImageMeta : null
  const bgImageMeta = rawMeta
    ? {
        width: Math.max(0, Math.round(Number(rawMeta.width) || 0)),
        height: Math.max(0, Math.round(Number(rawMeta.height) || 0)),
        sizeBytes: Math.max(0, Math.round(Number(rawMeta.sizeBytes) || 0)),
        name: String(rawMeta.name || '').replace(/[\r\n<>"{}]/g, ' ').trim().slice(0, 24),
      }
    : null
  const bgImageEnabled = src.bgImageEnabled !== false
  const bgImageOpacity = Math.round(
    diyClamp(src.bgImageOpacity ?? DEFAULT_CUSTOM_SKIN.bgImageOpacity, 0.06, 0.80) * 100,
  ) / 100
  const bgImageBlur = Math.round(diyClamp(src.bgImageBlur ?? DEFAULT_CUSTOM_SKIN.bgImageBlur, 0, 32))
  const source = ['image', 'chief', 'manual'].includes(src.source) ? src.source : 'manual'
  return {
    name: (nameClean || DEFAULT_CUSTOM_SKIN.name).slice(0, 24),
    accentHex,
    secondaryHex,
    warmHex,
    bgTintHex,
    bgImageUrl,
    bgImageStorage,
    bgImageMeta,
    bgImageEnabled,
    bgImageOpacity,
    bgImageBlur,
    ambientGlow: src.ambientGlow !== false,
    radius,
    serifTitle: Boolean(src.serifTitle),
    moodNote: noteClean.slice(0, 120),
    source,
    updatedAt: Math.max(0, Number(src.updatedAt) || 0),
    swatches: [accentHex, secondaryHex, warmHex],
  }
}

export function readSavedCustomSkin() {
  try {
    if (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function') {
      const raw = localStorage.getItem(CUSTOM_SKIN_STORAGE_KEY)
      if (raw) return normalizeCustomSkinConfig(JSON.parse(raw))
    }
  } catch {}
  return normalizeCustomSkinConfig(DEFAULT_CUSTOM_SKIN)
}

export function writeSavedCustomSkin(cfg) {
  const clean = normalizeCustomSkinConfig(cfg)
  const forStorage = (clean.bgImageStorage === 'idb' || clean.bgImageUrl.startsWith('blob:'))
    ? { ...clean, bgImageUrl: '' }
    : clean
  try {
    if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
      localStorage.setItem(CUSTOM_SKIN_STORAGE_KEY, JSON.stringify(forStorage))
    }
  } catch {
    try {
      if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function' && forStorage.bgImageUrl) {
        const stripped = { ...forStorage, bgImageUrl: '', bgImageStorage: '' }
        localStorage.setItem(CUSTOM_SKIN_STORAGE_KEY, JSON.stringify(stripped))
        return normalizeCustomSkinConfig({ ...clean, bgImageStorage: clean.bgImageStorage || '' })
      }
    } catch {}
  }
  return clean
}

function diyHexToRgb(hex) {
  const clean = sanitizeCustomHex(hex, '#8b7cf6').slice(1)
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  }
}

function diyRgbToHex(r, g, b) {
  const f = v => Math.round(diyClamp(v, 0, 255)).toString(16).padStart(2, '0')
  return `#${f(r)}${f(g)}${f(b)}`
}

function diyRgbToHsl(r, g, b) {
  const rn = diyClamp(r, 0, 255) / 255
  const gn = diyClamp(g, 0, 255) / 255
  const bn = diyClamp(b, 0, 255) / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === rn) h = ((gn - bn) / d) + (gn < bn ? 6 : 0)
    else if (max === gn) h = ((bn - rn) / d) + 2
    else h = ((rn - gn) / d) + 4
    h *= 60
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) }
}

function diyHslToRgb(hDeg, sPct, lPct) {
  const h = ((Number(hDeg) % 360) + 360) % 360
  const s = diyClamp(sPct, 0, 100) / 100
  const l = diyClamp(lPct, 0, 100) / 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  }
}

function diyHslToHex(h, s, l) {
  const { r, g, b } = diyHslToRgb(h, s, l)
  return diyRgbToHex(r, g, b)
}

function diyHslToRgba(h, s, l, alpha) {
  const { r, g, b } = diyHslToRgb(h, s, l)
  return `rgba(${r}, ${g}, ${b}, ${diyClamp(alpha, 0, 1).toFixed(3).replace(/\.?0+$/, '')})`
}

function diyHexToRgba(hex, alpha) {
  const { r, g, b } = diyHexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${diyClamp(alpha, 0, 1).toFixed(3).replace(/\.?0+$/, '')})`
}

function diyRelativeLum(hex) {
  const { r, g, b } = diyHexToRgb(hex)
  const conv = v => {
    const n = v / 255
    return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * conv(r) + 0.7152 * conv(g) + 0.0722 * conv(b)
}

function diyContrastTextFor(bgHex) {
  const lum = diyRelativeLum(bgHex)
  const whiteRatio = 1.05 / (lum + 0.05)
  const darkRatio = (lum + 0.05) / 0.068
  return whiteRatio >= darkRatio ? '#ffffff' : '#14161f'
}

export function deriveCustomSkinTokens(rawConfig) {
  const cfg = normalizeCustomSkinConfig(rawConfig)
  const accentHsl = diyRgbToHsl(...Object.values(diyHexToRgb(cfg.accentHex)))
  const secHsl = diyRgbToHsl(...Object.values(diyHexToRgb(cfg.secondaryHex)))
  const warmHsl = diyRgbToHsl(...Object.values(diyHexToRgb(cfg.warmHex)))
  const tintHsl = diyRgbToHsl(...Object.values(diyHexToRgb(cfg.bgTintHex)))

  const bgHue = tintHsl.s < 6 ? accentHsl.h : tintHsl.h
  const darkSat = diyClamp(tintHsl.s, 10, 26)
  const lightSat = diyClamp(Math.round(darkSat * 0.68), 6, 18)

  // Readable color clamping for dark background
  const darkAccent = diyHslToHex(accentHsl.h, diyClamp(accentHsl.s, 36, 86), diyClamp(accentHsl.l, 60, 74))
  const darkPrimary = diyHslToHex(accentHsl.h, diyClamp(accentHsl.s, 44, 86), diyClamp(accentHsl.l, 45, 56))
  const darkPrimaryHover = diyHslToHex(accentHsl.h, diyClamp(accentHsl.s, 46, 88), diyClamp(accentHsl.l - 6, 38, 49))
  const darkSage = diyHslToHex(secHsl.h, diyClamp(secHsl.s, 34, 76), diyClamp(secHsl.l, 56, 70))
  const darkAmber = diyHslToHex(warmHsl.h, diyClamp(warmHsl.s, 42, 82), diyClamp(warmHsl.l, 62, 74))
  const darkSwitchOn = diyHslToHex(secHsl.h, diyClamp(secHsl.s, 38, 72), diyClamp(secHsl.l, 48, 60))

  // Readable color clamping for light background
  const lightAccent = diyHslToHex(accentHsl.h, diyClamp(accentHsl.s, 44, 86), diyClamp(accentHsl.l, 35, 47))
  const lightPrimary = diyHslToHex(accentHsl.h, diyClamp(accentHsl.s, 46, 86), diyClamp(accentHsl.l, 36, 48))
  const lightPrimaryHover = diyHslToHex(accentHsl.h, diyClamp(accentHsl.s, 48, 88), diyClamp(accentHsl.l - 7, 29, 41))
  const lightSage = diyHslToHex(secHsl.h, diyClamp(secHsl.s, 36, 74), diyClamp(secHsl.l, 32, 43))
  const lightAmber = diyHslToHex(warmHsl.h, diyClamp(warmHsl.s, 46, 82), diyClamp(warmHsl.l, 35, 45))
  const lightSwitchOn = diyHslToHex(secHsl.h, diyClamp(secHsl.s, 38, 74), diyClamp(secHsl.l, 36, 46))

  const radii = cfg.radius === 'sharp'
    ? { panel: '12px', card: '8px', pill: '6px' }
    : cfg.radius === 'medium'
      ? { panel: '16px', card: '12px', pill: '10px' }
      : { panel: '22px', card: '15px', pill: '999px' }
  const displayFont = cfg.serifTitle ? 'Georgia, "Noto Serif SC", "Songti SC", serif' : 'inherit'

  const hasWallpaper = Boolean(cfg.bgImageEnabled && cfg.bgImageUrl)
  const darkAmbient = cfg.ambientGlow
    ? `radial-gradient(circle at 14% 10%, ${diyHexToRgba(darkAccent, 0.16)}, transparent 44%), radial-gradient(circle at 86% 18%, ${diyHexToRgba(darkSage, 0.12)}, transparent 44%)`
    : 'none'
  const lightAmbient = cfg.ambientGlow
    ? `radial-gradient(circle at 14% 10%, ${diyHexToRgba(lightAccent, 0.10)}, transparent 45%), radial-gradient(circle at 86% 18%, ${diyHexToRgba(lightSage, 0.08)}, transparent 45%)`
    : 'none'

  const dark = {
    '--dnb-skin-bg': diyHslToHex(bgHue, darkSat, 9),
    '--dnb-skin-ambient': darkAmbient,
    '--dnb-card': hasWallpaper ? diyHslToRgba(bgHue, darkSat, 13, 0.72) : diyHslToHex(bgHue, darkSat, 14),
    '--dnb-card-hover': hasWallpaper ? diyHslToRgba(bgHue, darkSat, 17, 0.80) : diyHslToHex(bgHue, darkSat, 18),
    '--dnb-surface-sub': hasWallpaper ? diyHslToRgba(bgHue, darkSat, 10, 0.64) : diyHslToHex(bgHue, darkSat, 11),
    '--dnb-head-tint': diyHslToRgba(bgHue, Math.max(8, darkSat), 92, 0.048),
    '--dnb-fill': diyHslToRgba(bgHue, Math.max(8, darkSat), 90, hasWallpaper ? 0.105 : 0.085),
    '--dnb-elevated': diyHslToHex(bgHue, darkSat, 19),
    '--dnb-popover': diyHslToHex(bgHue, darkSat, 16),
    '--dnb-border': diyHslToRgba(bgHue, Math.max(8, darkSat), 90, hasWallpaper ? 0.20 : 0.16),
    '--dnb-border-strong': diyHslToRgba(bgHue, Math.max(8, darkSat), 90, hasWallpaper ? 0.32 : 0.28),
    '--dnb-text': diyHslToHex(bgHue, 14, 95),
    '--dnb-text-2': diyHslToRgba(bgHue, 14, 92, 0.78),
    '--dnb-text-3': diyHslToRgba(bgHue, 14, 88, 0.54),
    '--dnb-accent': darkAccent,
    '--dnb-accent-soft': diyHexToRgba(darkAccent, 0.165),
    '--dnb-primary-bg': darkPrimary,
    '--dnb-primary-bg-hover': darkPrimaryHover,
    '--dnb-primary-fg': diyContrastTextFor(darkPrimary),
    '--dnb-sage': darkSage,
    '--dnb-sage-soft': diyHexToRgba(darkSage, 0.14),
    '--dnb-amber': darkAmber,
    '--dnb-amber-soft': diyHexToRgba(darkAmber, 0.14),
    '--dnb-coral': '#ef8787',
    '--dnb-coral-soft': 'rgba(239, 135, 135, 0.13)',
    '--dnb-switch-on': darkSwitchOn,
    '--dnb-switch-off': 'rgba(235, 238, 248, 0.19)',
    '--dnb-radius-panel': radii.panel,
    '--dnb-radius-card': radii.card,
    '--dnb-radius-pill': radii.pill,
    '--dnb-font-display': displayFont,
    '--dnb-skin-shadow': '0 20px 48px rgba(6, 8, 18, 0.48), inset 0 1px 0 rgba(255, 255, 255, 0.07)',
  }

  const light = {
    '--dnb-skin-bg': diyHslToHex(bgHue, lightSat, 88),
    '--dnb-skin-ambient': lightAmbient,
    '--dnb-card': hasWallpaper ? diyHslToRgba(bgHue, lightSat, 95, 0.84) : diyHslToHex(bgHue, lightSat, 95),
    '--dnb-card-hover': hasWallpaper ? diyHslToRgba(bgHue, lightSat, 92, 0.90) : diyHslToHex(bgHue, lightSat, 92),
    '--dnb-surface-sub': hasWallpaper ? diyHslToRgba(bgHue, lightSat, 91, 0.78) : diyHslToHex(bgHue, lightSat, 91),
    '--dnb-head-tint': diyHslToRgba(bgHue, Math.max(8, lightSat + 6), 28, 0.055),
    '--dnb-fill': diyHslToRgba(bgHue, Math.max(8, lightSat + 6), 28, hasWallpaper ? 0.095 : 0.082),
    '--dnb-elevated': diyHslToHex(bgHue, lightSat, 96),
    '--dnb-popover': diyHslToHex(bgHue, lightSat, 96),
    '--dnb-border': diyHslToRgba(bgHue, Math.max(8, lightSat + 8), 30, hasWallpaper ? 0.25 : 0.22),
    '--dnb-border-strong': diyHslToRgba(bgHue, Math.max(8, lightSat + 8), 30, hasWallpaper ? 0.36 : 0.34),
    '--dnb-text': diyHslToHex(bgHue, Math.max(10, lightSat), 13),
    '--dnb-text-2': diyHslToHex(bgHue, Math.max(8, lightSat), 32),
    '--dnb-text-3': diyHslToHex(bgHue, Math.max(6, lightSat), 46),
    '--dnb-accent': lightAccent,
    '--dnb-accent-soft': diyHexToRgba(lightAccent, 0.12),
    '--dnb-primary-bg': lightPrimary,
    '--dnb-primary-bg-hover': lightPrimaryHover,
    '--dnb-primary-fg': diyContrastTextFor(lightPrimary),
    '--dnb-sage': lightSage,
    '--dnb-sage-soft': diyHexToRgba(lightSage, 0.115),
    '--dnb-amber': lightAmber,
    '--dnb-amber-soft': diyHexToRgba(lightAmber, 0.115),
    '--dnb-coral': '#be4d4d',
    '--dnb-coral-soft': 'rgba(190, 77, 77, 0.105)',
    '--dnb-switch-on': lightSwitchOn,
    '--dnb-switch-off': diyHslToHex(bgHue, lightSat, 77),
    '--dnb-skin-shadow': '0 14px 36px rgba(32, 42, 68, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.5)',
  }

  return { dark, light, swatches: cfg.swatches, config: cfg }
}

function formatCssVarsBlock(varsObj) {
  return Object.entries(varsObj)
    .map(([k, v]) => `    ${k}: ${v};`)
    .join('\n')
}

export function buildCustomSkinCss(rawConfig) {
  const { dark, light, config } = deriveCustomSkinTokens(rawConfig)
  const hasWallpaper = Boolean(config.bgImageEnabled && config.bgImageUrl)
  const sharpMode = config.bgImageBlur <= 0
  const panelInset = sharpMode ? '0' : '-24px'
  const previewInset = sharpMode ? '0' : '-16px'
  const filterRule = sharpMode ? 'none' : `blur(${config.bgImageBlur}px) saturate(1.08)`
  const transformRule = sharpMode ? 'none' : 'scale(1.04)'
  const wallpaperCss = hasWallpaper
    ? `
  .dnb-panel[data-dnb-skin="custom"] {
    isolation: isolate;
  }
  .dnb-panel[data-dnb-skin="custom"]::before {
    content: "";
    position: absolute;
    inset: ${panelInset};
    z-index: 0;
    pointer-events: none;
    background-image: url("${config.bgImageUrl}");
    background-size: cover;
    background-position: center center;
    background-repeat: no-repeat;
    opacity: ${config.bgImageOpacity};
    filter: ${filterRule};
    transform: ${transformRule};
    transition: opacity 0.2s ease, filter 0.2s ease;
  }
  .dnb-panel[data-dnb-skin="custom"] > .dnb-body,
  .dnb-panel[data-dnb-skin="custom"] > .dnb-seg-wrap,
  .dnb-panel[data-dnb-skin="custom"] > .dnb-live-cursor-wrap,
  .dnb-panel[data-dnb-skin="custom"] > .dnb-session-optin-wrap,
  .dnb-panel[data-dnb-skin="custom"] > .dnb-search-drawer {
    position: relative;
    z-index: 2;
  }
  .dnb-panel[data-dnb-skin="custom"] .dnb-diy-preview {
    position: relative;
    overflow: hidden;
    isolation: isolate;
  }
  .dnb-panel[data-dnb-skin="custom"] .dnb-diy-preview::before {
    content: "";
    position: absolute;
    inset: ${previewInset};
    z-index: 0;
    pointer-events: none;
    background-image: url("${config.bgImageUrl}");
    background-size: cover;
    background-position: center center;
    opacity: ${config.bgImageOpacity};
    filter: ${filterRule};
    transform: ${transformRule};
  }
  .dnb-panel[data-dnb-skin="custom"] .dnb-diy-preview > * {
    position: relative;
    z-index: 1;
  }
`
    : `
  .dnb-panel[data-dnb-skin="custom"]::before,
  .dnb-panel[data-dnb-skin="custom"] .dnb-diy-preview::before {
    content: none;
    display: none;
  }
`
  const rawCss = `
  html[data-dnb-skin="custom"],
  html[data-dnb-skin="custom"] .dnb-menu,
  html[data-dnb-skin="custom"] .dnb-modal-card,
  html[data-dnb-skin="custom"] .dnb-toast,
  .dnb-panel[data-dnb-skin="custom"] {
${formatCssVarsBlock(dark)}
  }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin="custom"],
  html[data-ds-theme-source="light"][data-dnb-skin="custom"],
  html[data-ds-theme-source="light"][data-dnb-skin="custom"] .dnb-menu,
  html[data-ds-theme-source="light"][data-dnb-skin="custom"] .dnb-modal-card,
  html[data-ds-theme-source="light"][data-dnb-skin="custom"] .dnb-toast {
${formatCssVarsBlock(light)}
  }
${wallpaperCss}
`
  return expandLightThemeSelectors(rawCss)
}

export function applyCustomSkinStyle(rawConfig) {
  const cssText = buildCustomSkinCss(rawConfig)
  if (typeof document === 'undefined') return cssText
  try {
    const head = document.head || document.documentElement
    if (!head || typeof document.createElement !== 'function') return cssText
    let styleEl = typeof document.getElementById === 'function' ? document.getElementById('dnb-custom-skin-style') : null
    if (!styleEl && typeof document.querySelector === 'function') {
      styleEl = document.querySelector('style[data-dnb-custom-skin]')
    }
    if (!styleEl) {
      styleEl = document.createElement('style')
      styleEl.id = 'dnb-custom-skin-style'
      styleEl.setAttribute('data-dnb-custom-skin', '1')
      head.appendChild(styleEl)
    }
    if (styleEl.textContent !== cssText) styleEl.textContent = cssText
  } catch {}
  return cssText
}

function diyHueDist(h1, h2) {
  const d = Math.abs(Number(h1) - Number(h2)) % 360
  return d > 180 ? 360 - d : d
}

/**
 * Pure zero-dependency dominant & accent palette extractor from RGBA pixel buffer.
 * Can be run both in browser Canvas and in headless Node unit tests.
 */
export function extractPaletteFromImageData(rgbaData, width = 0, height = 0) {
  const data = rgbaData && typeof rgbaData.length === 'number' ? rgbaData : []
  const buckets = new Map()
  const totalPixels = width > 0 && height > 0 ? width * height : Math.floor(data.length / 4)
  const stride = Math.max(1, Math.floor(totalPixels / 4096))

  for (let px = 0; px < totalPixels; px += stride) {
    const i = px * 4
    if (i + 3 >= data.length) break
    const a = data[i + 3]
    if (a < 128) continue
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const qr = r >> 3
    const qg = g >> 3
    const qb = b >> 3
    const key = (qr << 10) | (qg << 5) | qb
    let entry = buckets.get(key)
    if (!entry) {
      entry = { count: 0, rSum: 0, gSum: 0, bSum: 0 }
      buckets.set(key, entry)
    }
    entry.count += 1
    entry.rSum += r
    entry.gSum += g
    entry.bSum += b
  }

  const clusters = []
  for (const b of buckets.values()) {
    const r = Math.round(b.rSum / b.count)
    const g = Math.round(b.gSum / b.count)
    const bl = Math.round(b.bSum / b.count)
    const hsl = diyRgbToHsl(r, g, bl)
    const hex = diyRgbToHex(r, g, bl)
    const lNorm = hsl.l / 100
    const sNorm = hsl.s / 100
    const vibrancy = Math.sqrt(b.count) * (0.32 + sNorm * 1.45) * (1 - Math.abs(lNorm - 0.54) * 0.85)
    clusters.push({
      r,
      g,
      b: bl,
      hex,
      hsl,
      count: b.count,
      vibrancy,
    })
  }

  clusters.sort((a, b) => b.vibrancy - a.vibrancy)

  const swatches = []
  for (const c of clusters) {
    if (c.hsl.l < 7 || c.hsl.l > 95) continue
    const tooClose = swatches.some(prev => {
      const rgbDist = Math.hypot(c.r - prev.r, c.g - prev.g, c.b - prev.b)
      const bothColored = c.hsl.s >= 14 && prev.hsl.s >= 14
      if (bothColored && diyHueDist(c.hsl.h, prev.hsl.h) < 24 && rgbDist < 68) return true
      return rgbDist < 42
    })
    if (!tooClose) swatches.push(c)
    if (swatches.length >= 6) break
  }
  if (swatches.length < 3) {
    for (const c of clusters) {
      if (!swatches.some(s => s.hex === c.hex)) swatches.push(c)
      if (swatches.length >= 6) break
    }
  }

  const vibrantPool = swatches.filter(c => c.hsl.s >= 18)
  const accentCand = vibrantPool[0] || swatches[0] || {
    hex: DEFAULT_CUSTOM_SKIN.accentHex,
    hsl: diyRgbToHsl(...Object.values(diyHexToRgb(DEFAULT_CUSTOM_SKIN.accentHex))),
    r: 139, g: 124, b: 246,
  }
  const accentHex = diyHslToHex(
    accentCand.hsl.h,
    diyClamp(accentCand.hsl.s, 38, 86),
    diyClamp(accentCand.hsl.l, 54, 70),
  )

  let secCand = null
  let bestSecScore = -1
  for (const c of swatches) {
    if (c.hex === accentCand.hex) continue
    const hGap = diyHueDist(c.hsl.h, accentCand.hsl.h)
    const score = hGap + c.hsl.s * 0.45
    if (score > bestSecScore) {
      bestSecScore = score
      secCand = c
    }
  }
  const secondaryHex = secCand
    ? diyHslToHex(secCand.hsl.h, diyClamp(secCand.hsl.s, 36, 76), diyClamp(secCand.hsl.l, 52, 68))
    : diyHslToHex((accentCand.hsl.h + 145) % 360, 56, 62)

  let warmCand = null
  let bestWarmScore = -1
  for (const c of swatches) {
    if (c.hex === accentCand.hex || c.hex === (secCand && secCand.hex)) continue
    const warmProximity = 180 - diyHueDist(c.hsl.h, 42)
    const score = warmProximity + c.hsl.s * 0.4
    if (score > bestWarmScore) {
      bestWarmScore = score
      warmCand = c
    }
  }
  const warmHex = warmCand
    ? diyHslToHex(warmCand.hsl.h, diyClamp(warmCand.hsl.s, 42, 82), diyClamp(warmCand.hsl.l, 60, 73))
    : diyHslToHex((accentCand.hsl.h + 42) % 360, 74, 67)

  const byCount = [...clusters].sort((a, b) => b.count - a.count)
  const bgCand = byCount.find(c => c.hsl.s >= 10 && c.hsl.l >= 10 && c.hsl.l <= 65)
    || byCount[0]
    || accentCand
  const bgTintHex = diyHslToHex(bgCand.hsl.h, diyClamp(bgCand.hsl.s, 12, 28), 14)

  const swatchHexes = swatches.map(s => s.hex)
  while (swatchHexes.length < 3) {
    const fallbackPool = [accentHex, secondaryHex, warmHex, bgTintHex]
    swatchHexes.push(fallbackPool[swatchHexes.length] || DEFAULT_CUSTOM_SKIN.accentHex)
  }

  return {
    swatches: swatchHexes.slice(0, 6),
    accentHex,
    secondaryHex,
    warmHex,
    bgTintHex,
  }
}

function compressWallpaperCanvas(img) {
  const w = img.naturalWidth || img.width || 64
  const h = img.naturalHeight || img.height || 64
  const steps = [
    { maxSide: 1080, quality: 0.78 },
    { maxSide: 760, quality: 0.66 },
    { maxSide: 560, quality: 0.56 },
  ]
  for (const step of steps) {
    try {
      const scale = Math.min(1, step.maxSide / Math.max(w, h))
      const tw = Math.max(8, Math.round(w * scale))
      const th = Math.max(8, Math.round(h * scale))
      const canvas = document.createElement('canvas')
      canvas.width = tw
      canvas.height = th
      const ctx = canvas.getContext('2d')
      if (!ctx) break
      ctx.drawImage(img, 0, 0, tw, th)
      let out = ''
      try {
        out = canvas.toDataURL('image/webp', step.quality)
      } catch {}
      if (!out || !out.startsWith('data:image/webp')) {
        out = canvas.toDataURL('image/jpeg', step.quality)
      }
      const clean = sanitizeCustomImageUrl(out)
      if (clean && clean.length <= 360000) return clean
    } catch {}
  }
  return ''
}

export async function buildInlineWallpaperFallback(blob) {
  if (!blob || typeof Image === 'undefined' || typeof document === 'undefined') return ''
  let objUrl = ''
  try {
    objUrl = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : ''
    if (!objUrl) return ''
    const img = await new Promise((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('decode failed'))
      el.src = objUrl
    })
    return compressWallpaperCanvas(img)
  } catch {
    return ''
  } finally {
    if (objUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      try { URL.revokeObjectURL(objUrl) } catch {}
    }
  }
}

export function extractPaletteFromImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || typeof Image === 'undefined' || typeof document === 'undefined') {
      return reject(new Error('当前环境不支持本地图片解析'))
    }
    if (file.size && file.size > MAX_WALLPAPER_BYTES) {
      return reject(new Error('图片体积超过 25MB 上限，请换一张轻一点的图片'))
    }
    const useObjectUrl = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
    const finishWithSrc = (imgSrc, isBlobUrl) => {
      const img = new Image()
      img.onerror = () => {
        if (isBlobUrl && typeof URL.revokeObjectURL === 'function') {
          try { URL.revokeObjectURL(imgSrc) } catch {}
        }
        reject(new Error('解码图片失败'))
      }
      img.onload = () => {
        try {
          const w = img.naturalWidth || img.width || 64
          const h = img.naturalHeight || img.height || 64
          const maxSide = 64
          const scale = Math.min(1, maxSide / Math.max(w, h))
          const tw = Math.max(4, Math.round(w * scale))
          const th = Math.max(4, Math.round(h * scale))
          const canvas = document.createElement('canvas')
          canvas.width = tw
          canvas.height = th
          const ctx = canvas.getContext('2d')
          if (!ctx) return reject(new Error('画布初始化失败'))
          ctx.drawImage(img, 0, 0, tw, th)
          const imgData = ctx.getImageData(0, 0, tw, th)
          const palette = extractPaletteFromImageData(imgData.data, tw, th)
          const cleanPreviewObjUrl = isBlobUrl ? sanitizeCustomImageUrl(imgSrc) : ''
          const inlineFallback = cleanPreviewObjUrl ? '' : compressWallpaperCanvas(img)
          if (isBlobUrl && !cleanPreviewObjUrl && typeof URL.revokeObjectURL === 'function') {
            try { URL.revokeObjectURL(imgSrc) } catch {}
          }
          resolve({
            ...palette,
            rawBlob: file,
            naturalWidth: w,
            naturalHeight: h,
            sizeBytes: Number(file.size) || 0,
            previewObjectUrl: cleanPreviewObjUrl || inlineFallback,
            wallpaperUrl: cleanPreviewObjUrl || inlineFallback,
            fileName: String(file.name || 'image').replace(/\.[^.]+$/, '').slice(0, 18),
          })
        } catch (err) {
          if (isBlobUrl && typeof URL.revokeObjectURL === 'function') {
            try { URL.revokeObjectURL(imgSrc) } catch {}
          }
          reject(err)
        }
      }
      img.src = imgSrc
    }

    if (useObjectUrl) {
      const objUrl = URL.createObjectURL(file)
      return finishWithSrc(objUrl, true)
    }
    if (typeof FileReader === 'undefined') {
      return reject(new Error('当前环境不支持读取本地图片'))
    }
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取图片文件失败'))
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : ''
      if (!dataUrl) return reject(new Error('图片内容为空'))
      finishWithSrc(dataUrl, false)
    }
    reader.readAsDataURL(file)
  })
}
