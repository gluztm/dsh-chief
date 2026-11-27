/**
 * src/client/tts.js — 参谋长前端 TTS 语音播报、LRU 音频缓存与自动口语提示引擎
 *
 * 【核心职责】
 *   1. 支持服务端代理音频流（DeepSeek 官方 TTS / OpenAI 兼容 TTS）与 Web Speech API 离线系统语音。
 *   2. 维护 12 条内存音频 Blob LRU 缓存、并发播放令牌（`ttsPlaybackSeq`）与 AbortController，防止叠音/乱序。
 *   3. 提供 `maybeAutoSpeakAlert`（关键节点自动口语告警）与 `maybeAutoSpeakIncomingChat`（per-session 基线静默抑制）。
 *
 * 【边界约定】
 *   - 顶层禁止裸调 `window` / `Audio` / `speechSynthesis`，确保 Node 直接 `import()` 门禁零异常；
 *   - 所有顶层声明采用专属 `tts` / `TTS_` / `speakChief` / `stopChief` / `playChief` / `maybeAutoSpeak` 前缀，避免打包重名。
 */

import { API } from './constants.js'
import { store, patch, runtimeRefs } from './store.js'
import { bi } from './i18n.js'

const TTS_CACHE_MAX = 12
const TTS_AUTO_ALERT_COOLDOWN_MS = 2000

const ttsBlobCache = new Map()
let ttsPlaybackSeq = 0
let ttsActiveAbort = null
let ttsActiveAudio = null
let ttsActiveObjectUrl = ''

function ttsSetPlayerState(next) {
  patch({
    ttsPlayer: {
      status: 'idle',
      itemId: '',
      label: '',
      provider: '',
      error: '',
      ...(next && typeof next === 'object' ? next : {}),
    },
  })
}

function ttsCacheGet(key) {
  if (!key || !ttsBlobCache.has(key)) return null
  const val = ttsBlobCache.get(key)
  ttsBlobCache.delete(key)
  ttsBlobCache.set(key, val)
  return val
}

function ttsCacheSet(key, val) {
  if (!key || !val) return
  if (ttsBlobCache.has(key)) ttsBlobCache.delete(key)
  ttsBlobCache.set(key, val)
  while (ttsBlobCache.size > TTS_CACHE_MAX) {
    const oldest = ttsBlobCache.keys().next().value
    if (oldest === undefined) break
    ttsBlobCache.delete(oldest)
  }
}

export function cleanClientTextForSpeech(rawText, style = 'full') {
  let s = String(rawText == null ? '' : rawText)
  if (!s.trim()) return ''
  // Scrub obvious secrets locally before any browser speech or cache key use
  s = s.replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, '「已隐藏敏感信息」')
  s = s.replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '「已隐藏敏感信息」')
  s = s.replace(/\bgh[pousr]_[A-Za-z0-9_]{16,}\b/g, '「已隐藏敏感信息」')
  s = s.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi, '「已隐藏敏感信息」')
  s = s.replace(/\b(api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|passwd)\s*[:=]\s*['"]?[A-Za-z0-9._~+/=-]{8,}['"]?/gi, '$1 已隐藏')
  s = s.replace(/<\|\s*[\s\S]*?\|>/g, ' ')
  s = s.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, ' ')
  s = s.replace(/```[\s\S]*?```/g, style === 'brief' ? ' ' : '（此处省略一段代码）')
  s = s.replace(/`([^`\r\n]{1,180})`/g, (_, inner) => {
    const t = String(inner || '').trim()
    if (!t) return ''
    if (/^(?:[A-Za-z]:[\\/]|\/|\.{1,2}[\\/])/.test(t) || t.length > 32) {
      const segs = t.split(/[\\/]+/).filter(Boolean)
      return segs.length > 0 && t.length <= 80 ? segs[segs.length - 1] : '相关代码'
    }
    return t
  })
  s = s.replace(/!\[([^\]]*)\]\([^)]+\)/g, (_, alt) => (alt || ''))
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  s = s.replace(/https?:\/\/[^\s)>"']+/gi, '相关链接')
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, '')
  s = s.replace(/^\s*>\s?/gm, '')
  s = s.replace(/^\s*(?:[-*+•]|\d+\.)\s+/gm, '')
  s = s.replace(/(\*\*|__|\*|~~)/g, '')
  s = s.replace(/\r?\n+/g, '。')
  s = s.replace(/[。]{2,}/g, '。')
  s = s.replace(/\s+/g, ' ').trim()
  if (style === 'brief') {
    const parts = s.split(/(?<=[。！？!?；;])/).map(x => x.trim()).filter(Boolean)
    const joined = (parts.length ? parts : [s]).slice(0, 3).join(' ')
    return joined.length > 240 ? joined.slice(0, 239).trimEnd() + '。' : joined
  }
  return s
}

export function ttsIsBrowserSpeechSupported() {
  try {
    return typeof window !== 'undefined'
      && typeof window.speechSynthesis === 'object'
      && window.speechSynthesis !== null
      && typeof window.SpeechSynthesisUtterance === 'function'
  } catch {
    return false
  }
}

export function listBrowserSpeechVoices() {
  if (!ttsIsBrowserSpeechSupported()) return []
  try {
    const list = window.speechSynthesis.getVoices() || []
    return list
      .filter(v => v && v.name)
      .slice()
      .sort((a, b) => {
        const az = /^zh/i.test(a.lang || '') ? 0 : (/^en/i.test(a.lang || '') ? 1 : 2)
        const bz = /^zh/i.test(b.lang || '') ? 0 : (/^en/i.test(b.lang || '') ? 1 : 2)
        if (az !== bz) return az - bz
        return String(a.name).localeCompare(String(b.name))
      })
      .map(v => ({
        name: String(v.name),
        lang: String(v.lang || ''),
        localService: Boolean(v.localService),
      }))
  } catch {
    return []
  }
}

function ttsReleaseAudioResources() {
  if (ttsActiveAudio) {
    try {
      ttsActiveAudio.onplay = null
      ttsActiveAudio.onended = null
      ttsActiveAudio.onerror = null
      ttsActiveAudio.pause()
      ttsActiveAudio.src = ''
    } catch {}
    ttsActiveAudio = null
  }
  if (ttsActiveObjectUrl) {
    try {
      if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(ttsActiveObjectUrl)
      }
    } catch {}
    ttsActiveObjectUrl = ''
  }
}

export function stopChiefSpeech() {
  ttsPlaybackSeq += 1
  if (ttsActiveAbort) {
    try { ttsActiveAbort.abort() } catch {}
    ttsActiveAbort = null
  }
  ttsReleaseAudioResources()
  if (ttsIsBrowserSpeechSupported()) {
    try { window.speechSynthesis.cancel() } catch {}
  }
  ttsSetPlayerState({ status: 'idle', itemId: '', label: '', provider: '', error: '' })
}

function ttsPlayAudioBlob(blob, { itemId = '', label = '', provider = 'deepseek', speed = 1.0, volume = 0.9, token = 0, isAuto = false } = {}) {
  return new Promise((resolve) => {
    if (token !== ttsPlaybackSeq) {
      resolve({ ok: false, cancelled: true })
      return
    }
    if (typeof window === 'undefined' || typeof Audio !== 'function' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      ttsSetPlayerState({ status: 'idle', itemId: '', label: '', provider: '', error: '' })
      resolve({ ok: false, error: '当前运行环境不支持音频播放' })
      return
    }
    ttsReleaseAudioResources()
    const objUrl = URL.createObjectURL(blob)
    ttsActiveObjectUrl = objUrl
    const audio = new Audio(objUrl)
    ttsActiveAudio = audio
    try {
      audio.playbackRate = Math.min(1.5, Math.max(0.75, Number(speed) || 1.0))
      if ('preservesPitch' in audio) audio.preservesPitch = true
      audio.volume = Math.min(1.0, Math.max(0.1, Number(volume) || 0.9))
    } catch {}

    let settled = false
    const finish = (res) => {
      if (settled) return
      settled = true
      if (token === ttsPlaybackSeq) {
        ttsReleaseAudioResources()
        ttsSetPlayerState({ status: 'idle', itemId: '', label: '', provider: '', error: '' })
      }
      resolve(res)
    }

    audio.onplay = () => {
      if (token !== ttsPlaybackSeq) return
      ttsSetPlayerState({ status: 'playing', itemId, label, provider, error: '' })
    }
    audio.onended = () => finish({ ok: true, provider })
    audio.onerror = () => {
      if (token === ttsPlaybackSeq && !isAuto) {
        patch({ error: bi('音频播放失败，请检查系统声音或改用本机系统语音', 'Audio playback failed') })
      }
      finish({ ok: false, error: '音频解码或播放失败' })
    }

    ttsSetPlayerState({ status: 'playing', itemId, label, provider, error: '' })
    Promise.resolve(audio.play()).catch((err) => {
      if (token === ttsPlaybackSeq && !isAuto) {
        const msg = String((err && err.message) || err || '')
        patch({
          notice: /notallowed|gesture|interact/i.test(msg)
            ? bi('浏览器拦截了自动发声，请先点一次页面或朗读按钮激活音频', 'Autoplay blocked by browser; click once to enable audio')
            : bi('音频播放被拦截或失败', 'Audio playback failed'),
        })
      }
      finish({ ok: false, error: String((err && err.message) || err || 'play failed') })
    })
  })
}

export async function playChiefAudioBase64(base64, mimeType = 'audio/wav', { itemId = 'probe', label = '试听', provider = 'deepseek', speed = 1.0, volume = 0.9 } = {}) {
  const b64 = String(base64 || '').trim()
  if (!b64 || typeof atob !== 'function' || typeof Blob !== 'function') {
    return { ok: false, error: '当前环境不支持解码音频预览' }
  }
  stopChiefSpeech()
  const token = ttsPlaybackSeq
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
  const blob = new Blob([bytes], { type: mimeType || 'audio/wav' })
  return ttsPlayAudioBlob(blob, { itemId, label, provider, speed, volume, token, isAuto: false })
}

function ttsSpeakWithBrowser(cleanText, { itemId = '', label = '', cfg = {}, token = 0, isAuto = false } = {}) {
  return new Promise((resolve) => {
    if (token !== ttsPlaybackSeq) {
      resolve({ ok: false, cancelled: true })
      return
    }
    if (!ttsIsBrowserSpeechSupported()) {
      ttsSetPlayerState({ status: 'idle', itemId: '', label: '', provider: '', error: '' })
      if (!isAuto) patch({ error: bi('当前浏览器不支持本机系统语音接口', 'Browser speech synthesis is unavailable') })
      resolve({ ok: false, error: 'speechSynthesis unavailable' })
      return
    }
    try { window.speechSynthesis.cancel() } catch {}
    const utter = new window.SpeechSynthesisUtterance(cleanText)
    const hasZh = /[\u4e00-\u9fff]/.test(cleanText)
    utter.lang = hasZh ? 'zh-CN' : 'en-US'
    utter.rate = Math.min(1.5, Math.max(0.75, Number(cfg.speed) || 1.0))
    utter.volume = Math.min(1.0, Math.max(0.1, Number(cfg.volume) || 0.9))

    try {
      const voices = window.speechSynthesis.getVoices() || []
      const wantedName = String(cfg.browserVoice || '').trim()
      const matched = (wantedName && voices.find(v => v && v.name === wantedName))
        || voices.find(v => v && (hasZh ? /^zh/i.test(v.lang || '') : /^en/i.test(v.lang || '')))
      if (matched) utter.voice = matched
    } catch {}

    let settled = false
    const finish = (res) => {
      if (settled) return
      settled = true
      if (token === ttsPlaybackSeq) {
        ttsSetPlayerState({ status: 'idle', itemId: '', label: '', provider: '', error: '' })
      }
      resolve(res)
    }

    utter.onstart = () => {
      if (token !== ttsPlaybackSeq) return
      ttsSetPlayerState({ status: 'playing', itemId, label, provider: 'browser', error: '' })
    }
    utter.onend = () => finish({ ok: true, provider: 'browser' })
    utter.onerror = () => finish({ ok: false, error: '系统语音播报失败' })

    ttsSetPlayerState({ status: 'playing', itemId, label, provider: 'browser', error: '' })
    try {
      window.speechSynthesis.speak(utter)
    } catch (err) {
      finish({ ok: false, error: String((err && err.message) || err) })
    }
  })
}

export async function speakChiefText(
  rawText,
  {
    itemId = '',
    label = '',
    style = 'full',
    allowFallback = true,
    isAuto = false,
    overrideConfig = null,
  } = {},
) {
  const curPlayer = store.ttsPlayer || {}
  if (itemId && curPlayer.itemId === itemId && (curPlayer.status === 'playing' || curPlayer.status === 'loading')) {
    stopChiefSpeech()
    return { ok: true, stopped: true }
  }

  const baseCfg = (store.chiefMeta && store.chiefMeta.tts) || {}
  const cfg = overrideConfig && typeof overrideConfig === 'object' ? { ...baseCfg, ...overrideConfig } : baseCfg
  const effStyle = style === 'brief' || style === 'full' ? style : (cfg.speechStyle || 'full')
  const cleanText = cleanClientTextForSpeech(rawText, effStyle)
  if (!cleanText) {
    if (!isAuto) patch({ notice: bi('这段内容没有可朗读的文字', 'Nothing readable to speak') })
    return { ok: false, code: 'EMPTY_TEXT' }
  }

  stopChiefSpeech()
  const token = ttsPlaybackSeq
  const provider = cfg.provider || 'deepseek'
  const voiceId = cfg.voiceId || 'stella'
  const format = cfg.format || 'wav'
  const speed = Math.min(1.5, Math.max(0.75, Number(cfg.speed) || 1.0))
  const volume = Math.min(1.0, Math.max(0.1, Number(cfg.volume) || 0.9))

  if (provider === 'browser') {
    return ttsSpeakWithBrowser(cleanText, { itemId, label, cfg, token, isAuto })
  }

  const cacheKey = `${provider}|${voiceId}|${format}|${effStyle}|${cleanText}`
  const cached = !overrideConfig ? ttsCacheGet(cacheKey) : null
  if (cached && cached.blob) {
    return ttsPlayAudioBlob(cached.blob, { itemId, label, provider, speed, volume, token, isAuto })
  }

  const ac = typeof AbortController === 'function' ? new AbortController() : null
  ttsActiveAbort = ac
  ttsSetPlayerState({ status: 'loading', itemId, label, provider, error: '' })

  try {
    const resp = await fetch(API + '/chief/fact', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        accept: 'audio/*, application/json',
      },
      body: JSON.stringify({
        session: store.sessionId || '',
        op: 'tts.synthesize',
        text: rawText,
        style: effStyle,
        binary: true,
        ...(overrideConfig && typeof overrideConfig === 'object' ? { config: overrideConfig } : {}),
      }),
      ...(ac ? { signal: ac.signal } : {}),
    })

    if (token !== ttsPlaybackSeq || (ac && ac.signal.aborted)) {
      return { ok: false, cancelled: true }
    }

    const ct = resp.headers && typeof resp.headers.get === 'function'
      ? String(resp.headers.get('content-type') || '').toLowerCase()
      : ''

    if (resp.ok && ct.includes('audio/')) {
      const blob = await resp.blob()
      if (token !== ttsPlaybackSeq || (ac && ac.signal.aborted)) {
        return { ok: false, cancelled: true }
      }
      if (!overrideConfig) ttsCacheSet(cacheKey, { mimeType: ct, blob })
      return ttsPlayAudioBlob(blob, { itemId, label, provider, speed, volume, token, isAuto })
    }

    let payload = null
    try { payload = await resp.json() } catch {}
    if (payload && payload.mode === 'browser' && payload.textUsed) {
      return ttsSpeakWithBrowser(payload.textUsed, { itemId, label, cfg, token, isAuto })
    }

    const errMsg = (payload && payload.error) || `HTTP ${resp.status}`
    if (allowFallback && cfg.fallbackToBrowser !== false && ttsIsBrowserSpeechSupported()) {
      if (!isAuto) {
        patch({ notice: bi('云端语音暂不可用，已自动改用本机系统语音：', 'Cloud TTS unavailable; using browser voice: ') + errMsg.slice(0, 60) })
      }
      return ttsSpeakWithBrowser(cleanText, { itemId, label, cfg, token, isAuto })
    }

    if (token === ttsPlaybackSeq) {
      ttsSetPlayerState({ status: 'idle', itemId: '', label: '', provider: '', error: errMsg })
      if (!isAuto) patch({ error: errMsg })
    }
    return { ok: false, error: errMsg }
  } catch (err) {
    if (token !== ttsPlaybackSeq || (ac && ac.signal.aborted)) {
      return { ok: false, cancelled: true }
    }
    const errMsg = String((err && err.message) || err || '语音请求失败')
    if (allowFallback && cfg.fallbackToBrowser !== false && ttsIsBrowserSpeechSupported()) {
      if (!isAuto) {
        patch({ notice: bi('云端语音请求异常，已改用本机系统语音', 'Cloud TTS error; using browser voice') })
      }
      return ttsSpeakWithBrowser(cleanText, { itemId, label, cfg, token, isAuto })
    }
    ttsSetPlayerState({ status: 'idle', itemId: '', label: '', provider: '', error: errMsg })
    if (!isAuto) patch({ error: errMsg })
    return { ok: false, error: errMsg }
  } finally {
    if (ttsActiveAbort === ac) ttsActiveAbort = null
  }
}

export function maybeAutoSpeakAlert(ev, alertCopy = {}) {
  const ttsCfg = store.chiefMeta && store.chiefMeta.tts
  if (!ttsCfg || !ttsCfg.enabled || !ttsCfg.autoSpeakAlerts) return false
  const now = Date.now()
  if (now - (Number(runtimeRefs.ttsLastAutoAlertAt) || 0) < TTS_AUTO_ALERT_COOLDOWN_MS) {
    return false
  }
  const title = String((alertCopy && alertCopy.title) || (ev && ev.title) || '')
    .replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/gu, '')
    .trim()
  const body = String((alertCopy && alertCopy.body) || (ev && ev.body) || '').trim()
  const spoken = [title, body].filter(Boolean).join('。')
  if (!spoken) return false
  runtimeRefs.ttsLastAutoAlertAt = now
  void speakChiefText(spoken, {
    itemId: 'alert:' + ((ev && ev.id) || now),
    label: title || bi('重要提醒', 'Alert'),
    style: 'brief',
    isAuto: true,
  })
  return true
}

export function maybeAutoSpeakIncomingChat(chatList, sessionId = '') {
  const list = Array.isArray(chatList) ? chatList.filter(c => c && c.id) : []
  const sessKey = String(sessionId || '__global__').trim() || '__global__'
  if (!runtimeRefs.ttsChatBaselineBySession || typeof runtimeRefs.ttsChatBaselineBySession !== 'object') {
    runtimeRefs.ttsChatBaselineBySession = {}
  }
  if (!runtimeRefs.ttsSeenChatIds || typeof runtimeRefs.ttsSeenChatIds !== 'object') {
    runtimeRefs.ttsSeenChatIds = {}
  }
  const seen = runtimeRefs.ttsSeenChatIds

  if (!runtimeRefs.ttsChatBaselineBySession[sessKey]) {
    runtimeRefs.ttsChatBaselineBySession[sessKey] = true
    for (const item of list) seen[item.id] = true
    return { initialized: true, spoken: false }
  }

  const freshChiefReplies = []
  for (const item of list) {
    if (seen[item.id]) continue
    seen[item.id] = true
    if (item.role === 'chief' && item.kind !== 'receipt' && item.kind !== 'system' && String(item.text || '').trim()) {
      freshChiefReplies.push(item)
    }
  }

  if (!freshChiefReplies.length) return { initialized: false, spoken: false }

  const ttsCfg = store.chiefMeta && store.chiefMeta.tts
  if (!ttsCfg || !ttsCfg.enabled || !ttsCfg.autoSpeakReplies) {
    return { initialized: false, spoken: false }
  }

  const latest = freshChiefReplies[freshChiefReplies.length - 1]
  void speakChiefText(latest.text, {
    itemId: 'chat:' + latest.id,
    label: bi('参谋回复', 'Chief Reply'),
    style: ttsCfg.speechStyle || 'brief',
    isAuto: true,
  })
  return { initialized: false, spoken: true, itemId: latest.id }
}

export function resetTtsSessionBaselines() {
  runtimeRefs.ttsChatBaselineBySession = {}
  runtimeRefs.ttsSeenChatIds = {}
  runtimeRefs.ttsLastAutoAlertAt = 0
}
