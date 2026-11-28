/**
 * chief-tts.js — 参谋长原生 TTS 语音合成与口语净化引擎
 *
 * 【核心职责】
 *   1. 支持三类发音引擎：
 *      - `deepseek`：对接 DeepSeek 官方原生 `POST /v1/tools/tts`（零配置自动复用 DSH 宿主 `DEEPSEEK_API_KEY`）；
 *      - `openai-compat`：对接标准 `POST /v1/audio/speech`（兼容本地 Kokoro/CosyVoice/Edge-TTS 代理及云端服务）；
 *      - `browser`：返回净化后的口语文本交由前端 Web Speech API 离线朗读。
 *   2. 提供 `scrubSecretsForSpeech` / `prepareSpeechText` 对敏感密钥、Markdown、长路径、代码块与哈希脱敏净化。
 *   3. 提供 `wrapPcm24kMonoToWav` 将 24kHz 16-bit mono PCM 自动封装为通用可播 WAV。
 *
 * 【安全与隔离边界】
 *   - 零外部 npm 依赖，零 `child_process`，绝不改动 `chief.js` 导出或向 `@lead` 注入任何字节；
 *   - 上游 API Key 仅在后端按需解析，绝不下发前端，报错消息彻底剥离密钥字样。
 */

import { normalizeTtsConfig, redactTtsConfigForUi } from './state-schema.js'

const MAX_AUDIO_BYTES = 8 * 1024 * 1024
const MAX_STT_AUDIO_BYTES = 7 * 1024 * 1024
const DSH_ACCOUNT_RECORD_KEY = 'deepseek-account-platform/default'

function isLoopbackHost(rawUrl) {
  try {
    const h = String(new URL(String(rawUrl || '')).hostname || '').toLowerCase()
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]'
  } catch {
    return false
  }
}

function isOfficialDeepSeekEndpoint(rawUrl) {
  try {
    return new URL(String(rawUrl || '')).origin === 'https://api.deepseek.com'
  } catch {
    return false
  }
}

export const TTS_VOICE_CATALOG = {
  deepseek: [
    { id: 'stella', label: 'Stella · 女声（清晰自然）', en: 'Stella · Female (Clear)' },
    { id: 'tide', label: 'Tide · 男声（沉稳干练）', en: 'Tide · Male (Steady)' },
  ],
  'openai-compat': [
    { id: 'alloy', label: 'Alloy（均衡中性）', en: 'Alloy (Balanced)' },
    { id: 'nova', label: 'Nova（明快亲和）', en: 'Nova (Bright)' },
    { id: 'shimmer', label: 'Shimmer（柔和清透）', en: 'Shimmer (Soft)' },
    { id: 'echo', label: 'Echo（低沉男声）', en: 'Echo (Deep)' },
    { id: 'onyx', label: 'Onyx（厚重沉稳）', en: 'Onyx (Steady)' },
    { id: 'fable', label: 'Fable（叙事娓娓）', en: 'Fable (Narrative)' },
  ],
}

const ttsRuntimeStats = {
  synthesisCount: 0,
  sttCount: 0,
  lastProvider: '',
  lastLatencyMs: 0,
  lastError: '',
  lastErrorAt: 0,
  lastSttProvider: '',
  lastSttError: '',
}

export function scrubSecretsForSpeech(text) {
  let s = String(text == null ? '' : text)
  if (!s) return ''
  s = s.replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, '「已隐藏敏感信息」')
  s = s.replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '「已隐藏敏感信息」')
  s = s.replace(/\bgh[pousr]_[A-Za-z0-9_]{16,}\b/g, '「已隐藏敏感信息」')
  s = s.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi, '「已隐藏敏感信息」')
  s = s.replace(/\b(api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|passwd)\s*[:=]\s*['"]?[A-Za-z0-9._~+/=-]{8,}['"]?/gi, '$1 已隐藏')
  s = s.replace(/(?<![A-Za-z0-9])[0-9a-f]{32,}(?![A-Za-z0-9])/gi, '「长哈希」')
  return s
}

function shortenPathTokenForSpeech(rawPath) {
  const clean = String(rawPath || '').replace(/[`'"]/g, '').trim()
  const segs = clean.split(/[\\/]+/).filter(Boolean)
  const tail = segs.length > 0 ? segs[segs.length - 1] : clean
  return tail || '相关文件'
}

export function prepareSpeechText(rawText, { style = 'full', maxChars = 1800 } = {}) {
  const original = String(rawText == null ? '' : rawText)
  const originalChars = original.length
  const cleanStyle = style === 'brief' ? 'brief' : 'full'
  if (!original.trim()) {
    return { text: '', truncated: false, originalChars }
  }

  let s = scrubSecretsForSpeech(original)
  // Strip model internal control markup & tool call blocks
  s = s.replace(/<\|\s*[\s\S]*?\|>/g, ' ')
  s = s.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, ' ')
  // Handle fenced code blocks
  s = s.replace(/```[\s\S]*?```/g, cleanStyle === 'brief' ? ' ' : '（此处省略一段代码）')
  // Inline code: keep short readable labels, shorten long paths/commands
  s = s.replace(/`([^`\r\n]{1,180})`/g, (_, inner) => {
    const t = String(inner || '').trim()
    if (!t) return ''
    if (/^(?:[A-Za-z]:[\\/]|\/|\.{1,2}[\\/])/.test(t) || (t.includes('/') && t.length > 24) || (t.includes('\\') && t.length > 24)) {
      return shortenPathTokenForSpeech(t)
    }
    return t.length <= 32 ? t : '相关代码'
  })
  // Markdown links & URLs
  s = s.replace(/!\[([^\]]*)\]\([^)]+\)/g, (_, alt) => (alt ? `图片 ${alt}` : '图片'))
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  s = s.replace(/https?:\/\/[^\s)>"']+/gi, '相关链接')
  // Strip bare absolute file paths in prose
  s = s.replace(/(?:[A-Za-z]:[\\/][^\s,，。；;：:"'()[\]<>]+|\/(?:Users|home|var|etc|opt|tmp|mnt|srv|usr|app|workspace)[^\s,，。；;：:"'()[\]<>]+)/g, m => shortenPathTokenForSpeech(m))
  // Strip UUIDs & long hex SHAs
  s = s.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '该编号')
  // Strip markdown formatting tokens
  s = s.replace(/^\s*\|?[\s:-]+\|[\s|:-]*$/gm, ' ')
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, '')
  s = s.replace(/^\s*>\s?/gm, '')
  s = s.replace(/^\s*(?:[-*+•]|\d+\.)\s+/gm, '')
  s = s.replace(/(\*\*|__|\*|~~)/g, '')
  // Turn line breaks into natural pauses
  s = s.replace(/\r?\n+/g, '。')
  s = s.replace(/[。]{2,}/g, '。')
  s = s.replace(/\s+/g, ' ').trim()
  s = s.replace(/^[,，.。;；:：\s]+/, '').trim()

  if (!s) {
    return { text: '', truncated: false, originalChars }
  }

  if (cleanStyle === 'brief') {
    const rawSentences = s
      .split(/(?<=[。！？!?；;])/)
      .map(part => part.replace(/^[,，.。;；:：\s]+/, '').trim())
      .filter(part => part && !/^(?:好的|收到|明白|了解|嗯|ok)[。！!]?$/i.test(part))
    const picked = (rawSentences.length > 0 ? rawSentences : [s]).slice(0, 3).join(' ')
    const briefMax = 240
    if (picked.length > briefMax) {
      return {
        text: picked.slice(0, briefMax - 1).trimEnd() + '。',
        truncated: true,
        originalChars,
      }
    }
    return {
      text: picked,
      truncated: picked.length < s.length,
      originalChars,
    }
  }

  const limit = Math.min(4000, Math.max(120, Math.round(Number(maxChars) || 1800)))
  if (s.length <= limit) {
    return { text: s, truncated: false, originalChars }
  }

  const sliceLimit = Math.max(80, limit - 16)
  const head = s.slice(0, sliceLimit)
  const lastStop = Math.max(
    head.lastIndexOf('。'),
    head.lastIndexOf('！'),
    head.lastIndexOf('？'),
    head.lastIndexOf('；'),
    head.lastIndexOf('.'),
    head.lastIndexOf('，'),
  )
  const cut = lastStop >= Math.floor(sliceLimit * 0.5) ? head.slice(0, lastStop + 1) : head
  return {
    text: `${cut.trimEnd()}……其余细节请查看文字内容。`,
    truncated: true,
    originalChars,
  }
}

export function wrapPcm24kMonoToWav(pcmBuffer, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
  const pcm = Buffer.isBuffer(pcmBuffer) ? pcmBuffer : Buffer.from(pcmBuffer || [])
  const byteRate = Math.round(sampleRate * channels * (bitsPerSample / 8))
  const blockAlign = Math.round(channels * (bitsPerSample / 8))
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 4, 'ascii')
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8, 4, 'ascii')
  header.write('fmt ', 12, 4, 'ascii')
  header.writeUInt32LE(16, 16) // PCM fmt chunk size
  header.writeUInt16LE(1, 20) // PCM linear format
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write('data', 36, 4, 'ascii')
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

async function resolveDeepSeekAccountGrant(runtime, endpoint) {
  if (!isOfficialDeepSeekEndpoint(endpoint)) return ''
  try {
    const acct = runtime && typeof runtime.get === 'function' ? runtime.get('deepseekAccount') : null
    if (acct && typeof acct.resolveToken === 'function') {
      const tok = await Promise.resolve(acct.resolveToken(endpoint)).catch(() => '')
      if (typeof tok === 'string' && tok.trim() && !tok.trim().startsWith('dsh_mock_')) {
        return tok.trim()
      }
    }
  } catch {}

  try {
    const credentials = runtime && typeof runtime.get === 'function' ? runtime.get('credentials') : null
    if (credentials && typeof credentials.readRecord === 'function') {
      const rec = await Promise.resolve(credentials.readRecord(DSH_ACCOUNT_RECORD_KEY)).catch(() => null)
      const tok = rec && rec.kind === 'grant' && rec.payload && typeof rec.payload.token === 'string'
        ? rec.payload.token.trim()
        : ''
      const issuer = rec && rec.payload && typeof rec.payload.issuer === 'string'
        ? rec.payload.issuer.trim()
        : ''
      if (tok && !tok.startsWith('dsh_mock_') && (!issuer || !isLoopbackHost(issuer))) {
        return tok
      }
    }
  } catch {}

  return ''
}

async function hasHostDeepSeekAccountGrant(runtime) {
  try {
    const acct = runtime && typeof runtime.get === 'function' ? runtime.get('deepseekAccount') : null
    if (acct && typeof acct.resolveToken === 'function') {
      const tok = await Promise.resolve(acct.resolveToken('https://api.deepseek.com/v1/tools/tts')).catch(() => '')
      if (typeof tok === 'string' && tok.trim() && !tok.trim().startsWith('dsh_mock_')) return true
    }
  } catch {}
  try {
    const credentials = runtime && typeof runtime.get === 'function' ? runtime.get('credentials') : null
    if (credentials && typeof credentials.describeRecord === 'function') {
      const desc = await Promise.resolve(credentials.describeRecord(DSH_ACCOUNT_RECORD_KEY)).catch(() => null)
      if (desc && desc.exists) return true
    }
    if (credentials && typeof credentials.readRecord === 'function') {
      const rec = await Promise.resolve(credentials.readRecord(DSH_ACCOUNT_RECORD_KEY)).catch(() => null)
      if (rec && rec.kind === 'grant' && rec.payload && typeof rec.payload.token === 'string' && rec.payload.token.trim()) {
        return true
      }
    }
  } catch {}
  return false
}

export async function resolveHostDeepSeekTtsContext(runtime) {
  let apiKeyEnv = 'DEEPSEEK_API_KEY'
  let baseUrl = (typeof process.env.DEEPSEEK_BASE_URL === 'string' && process.env.DEEPSEEK_BASE_URL.trim())
    ? process.env.DEEPSEEK_BASE_URL.trim().replace(/\/+$/, '')
    : 'https://api.deepseek.com'
  let configured = false
  let source = ''
  let authMode = 'none'
  let accountSignedIn = false

  try {
    const settings = runtime && typeof runtime.get === 'function' ? runtime.get('settings') : null
    if (settings && typeof settings.describe === 'function') {
      const sections = settings.describe({ redactSecrets: true }) || []
      const dsSec = Array.isArray(sections) ? sections.find(sec => sec && sec.ns === 'llm-deepseek') : null
      const val = dsSec && dsSec.value && typeof dsSec.value === 'object' ? dsSec.value : null
      if (val) {
        if (typeof val.apiKeyEnv === 'string' && val.apiKeyEnv.trim()) {
          apiKeyEnv = val.apiKeyEnv.trim()
        }
        if (typeof val.baseURL === 'string' && val.baseURL.trim() && !process.env.DEEPSEEK_BASE_URL) {
          baseUrl = val.baseURL.trim().replace(/\/+$/, '')
        }
      }
    }
  } catch {}

  accountSignedIn = await hasHostDeepSeekAccountGrant(runtime)
  if (accountSignedIn && isOfficialDeepSeekEndpoint(baseUrl)) {
    configured = true
    source = 'dsh-account'
    authMode = 'dsh-account'
    return { apiKeyEnv, baseUrl, configured, source, authMode, accountSignedIn }
  }

  try {
    const credentials = runtime && typeof runtime.get === 'function' ? runtime.get('credentials') : null
    if (credentials && typeof credentials.describe === 'function') {
      const info = await Promise.resolve(credentials.describe(apiKeyEnv)).catch(() => null)
      if (info && typeof info.configured === 'boolean') {
        configured = info.configured
        if (configured) {
          source = info.source ? String(info.source) : 'credentials'
          authMode = 'api-key'
        }
      }
    }
  } catch {}

  if (!configured && typeof process.env[apiKeyEnv] === 'string' && process.env[apiKeyEnv].trim()) {
    configured = true
    source = 'env'
    authMode = 'api-key'
  }

  return { apiKeyEnv, baseUrl, configured, source, authMode, accountSignedIn }
}

async function resolveCredentialByRef(runtime, ref) {
  const cleanRef = String(ref || '').trim()
  if (!cleanRef) return ''
  try {
    const credentials = runtime && typeof runtime.get === 'function' ? runtime.get('credentials') : null
    if (credentials && typeof credentials.resolve === 'function') {
      const hit = await Promise.resolve(credentials.resolve(cleanRef)).catch(() => null)
      const val = typeof hit === 'string'
        ? hit
        : (hit && typeof hit.value === 'string' ? hit.value : '')
      if (val && val.trim()) return val.trim()
    }
  } catch {}
  if (typeof process.env[cleanRef] === 'string' && process.env[cleanRef].trim()) {
    return process.env[cleanRef].trim()
  }
  return ''
}

async function resolveDeepSeekAuthCandidates(runtime, ttsCfg, hostCtx, endpoint) {
  const direct = ttsCfg && typeof ttsCfg.apiKey === 'string' ? ttsCfg.apiKey.trim() : ''
  if (direct) {
    return [{ headerName: 'authorization', headerValue: `Bearer ${direct}`, secret: direct, authMode: 'manual-key' }]
  }
  const list = []
  const seen = new Set()
  const pushUnique = (cand) => {
    if (!cand || !cand.headerName || !cand.headerValue) return
    const key = `${cand.headerName}:${cand.headerValue}`
    if (seen.has(key)) return
    seen.add(key)
    list.push(cand)
  }
  if (ttsCfg && ttsCfg.apiKeyEnv) {
    const byCfg = await resolveCredentialByRef(runtime, ttsCfg.apiKeyEnv)
    if (byCfg) {
      pushUnique({ headerName: 'authorization', headerValue: `Bearer ${byCfg}`, secret: byCfg, authMode: 'api-key' })
    }
  }
  const grantTok = await resolveDeepSeekAccountGrant(runtime, endpoint)
  if (grantTok) {
    pushUnique({ headerName: 'x-dsh-auth-token', headerValue: grantTok, secret: grantTok, authMode: 'dsh-account' })
  }
  if (hostCtx && hostCtx.apiKeyEnv) {
    const byHost = await resolveCredentialByRef(runtime, hostCtx.apiKeyEnv)
    if (byHost) {
      pushUnique({ headerName: 'authorization', headerValue: `Bearer ${byHost}`, secret: byHost, authMode: 'api-key' })
    }
  }
  return list
}

async function resolveDeepSeekAuthHeader(runtime, ttsCfg, hostCtx, endpoint) {
  const list = await resolveDeepSeekAuthCandidates(runtime, ttsCfg, hostCtx, endpoint)
  return list[0] || null
}

async function resolveTtsApiKey(runtime, ttsCfg, hostCtx) {
  if (ttsCfg.apiKey && ttsCfg.apiKey.trim()) {
    return ttsCfg.apiKey.trim()
  }
  if (ttsCfg.apiKeyEnv) {
    const byCfgEnv = await resolveCredentialByRef(runtime, ttsCfg.apiKeyEnv)
    if (byCfgEnv) return byCfgEnv
  }
  if (ttsCfg.provider === 'deepseek' && hostCtx && hostCtx.apiKeyEnv) {
    const byHost = await resolveCredentialByRef(runtime, hostCtx.apiKeyEnv)
    if (byHost) return byHost
  }
  return ''
}

function redactKeyFromErrorText(rawMsg, secretKey = '') {
  let msg = scrubSecretsForSpeech(String(rawMsg || ''))
  if (secretKey && secretKey.length >= 6) {
    msg = msg.split(secretKey).join('***')
  }
  return msg.replace(/\s+/g, ' ').trim().slice(0, 220)
}

function buildDeepSeekTtsEndpoint(rawBase) {
  const clean = String(rawBase || 'https://api.deepseek.com').trim().replace(/\/+$/, '')
  if (/\/tools\/tts$/i.test(clean)) return clean
  if (/\/v1$/i.test(clean)) return `${clean}/tools/tts`
  return `${clean}/v1/tools/tts`
}

function buildDeepSeekAsrEndpoint(rawBase) {
  const clean = String(rawBase || 'https://api.deepseek.com').trim().replace(/\/+$/, '')
  if (/\/tools\/asr$/i.test(clean)) return clean
  if (/\/v1$/i.test(clean)) return `${clean}/tools/asr`
  return `${clean}/v1/tools/asr`
}

function buildOpenAiSpeechEndpoint(rawBase) {
  const clean = String(rawBase || '').trim().replace(/\/+$/, '')
  if (!clean) return ''
  if (/\/audio\/speech$/i.test(clean)) return clean
  if (/\/v1$/i.test(clean)) return `${clean}/audio/speech`
  return `${clean}/v1/audio/speech`
}

function mimeForOpenAiFormat(fmt, headerType = '') {
  const ct = String(headerType || '').split(';')[0].trim().toLowerCase()
  if (ct.startsWith('audio/')) return ct
  if (fmt === 'wav') return 'audio/wav'
  if (fmt === 'opus') return 'audio/ogg'
  return 'audio/mpeg'
}

export function probeHostSpeechToText(runtime) {
  try {
    const speech = runtime && typeof runtime.get === 'function' ? runtime.get('speechToText') : null
    if (!speech || typeof speech.transcribe !== 'function' || typeof speech.resolve !== 'function') {
      return { available: false, ready: false, phase: 'unavailable', providerId: '' }
    }
    const snap = typeof speech.snapshot === 'function' ? speech.snapshot() : null
    const snapProviders = Array.isArray(snap && snap.providers) ? snap.providers : []
    const listed = typeof speech.listProviders === 'function' ? (speech.listProviders() || []) : []
    const providers = snapProviders.length > 0 ? snapProviders : listed
    if (!Array.isArray(providers) || providers.length === 0) {
      return { available: true, ready: true, phase: 'ready', providerId: 'dsh-local' }
    }
    const readyHit = providers.find(p => {
      const ph = String(p && p.preparation && p.preparation.phase || '').toLowerCase()
      return ph === 'ready' || ph === 'standby'
    })
    if (readyHit) {
      return {
        available: true,
        ready: true,
        phase: String(readyHit.preparation.phase || 'ready').toLowerCase(),
        providerId: String(readyHit.id || 'sensevoice'),
      }
    }
    const first = providers[0]
    return {
      available: true,
      ready: false,
      phase: String(first && first.preparation && first.preparation.phase || 'unprepared').toLowerCase(),
      providerId: String(first && first.id || 'sensevoice'),
    }
  } catch {
    return { available: false, ready: false, phase: 'unavailable', providerId: '' }
  }
}

export async function getChiefTtsStatus(runtime, rawTtsCfg = null) {
  const hostDeepSeek = await resolveHostDeepSeekTtsContext(runtime)
  const localStt = probeHostSpeechToText(runtime)
  const sttReady = Boolean(localStt.ready || hostDeepSeek.configured)
  return {
    ok: true,
    tts: redactTtsConfigForUi(rawTtsCfg),
    hostDeepSeek,
    stt: {
      local: localStt,
      deepseekAsr: Boolean(hostDeepSeek.configured),
      ready: sttReady,
    },
    runtime: { ...ttsRuntimeStats },
    voices: TTS_VOICE_CATALOG,
  }
}

export async function synthesizeChiefSpeech(
  runtime,
  rawTtsCfg = null,
  {
    text = '',
    style,
    voiceId,
    speed,
    format,
    maxChars,
    fetchImpl = globalThis.fetch,
  } = {},
) {
  const cfg = normalizeTtsConfig(rawTtsCfg)
  const effectiveStyle = style === 'brief' || style === 'full' ? style : cfg.speechStyle
  const effectiveVoice = (typeof voiceId === 'string' && voiceId.trim()) ? voiceId.trim().slice(0, 120) : cfg.voiceId
  const effectiveSpeed = Number.isFinite(Number(speed))
    ? Number(Math.min(1.5, Math.max(0.75, Number(speed))).toFixed(2))
    : cfg.speed
  const prepared = prepareSpeechText(text, { style: effectiveStyle, maxChars })
  if (!prepared.text) {
    return {
      ok: false,
      code: 'EMPTY_TEXT',
      error: '没有可用于语音朗读的正文内容',
      canFallbackBrowser: false,
    }
  }

  if (cfg.provider === 'browser') {
    return {
      ok: true,
      mode: 'browser',
      provider: 'browser',
      voiceId: cfg.browserVoice || 'system',
      textUsed: prepared.text,
      truncated: prepared.truncated,
      chars: prepared.text.length,
    }
  }

  if (typeof fetchImpl !== 'function') {
    return {
      ok: false,
      code: 'FETCH_UNAVAILABLE',
      error: '当前运行环境不支持 HTTP 语音请求',
      canFallbackBrowser: true,
    }
  }

  const hostCtx = await resolveHostDeepSeekTtsContext(runtime)
  let apiKey = ''
  let endpoint = ''
  const reqHeaders = { 'content-type': 'application/json' }
  let reqBody = null
  let effectiveFormat = cfg.format
  let authAttempts = [{ headerName: '', headerValue: '', secret: '' }]

  if (cfg.provider === 'deepseek') {
    const rawFmt = typeof format === 'string' && format.trim() ? format.trim().toLowerCase() : cfg.format
    effectiveFormat = rawFmt === 'pcm' ? 'pcm' : 'wav'
    endpoint = buildDeepSeekTtsEndpoint(cfg.baseUrl || hostCtx.baseUrl || 'https://api.deepseek.com')
    const dsCandidates = await resolveDeepSeekAuthCandidates(runtime, cfg, hostCtx, endpoint)
    if (!dsCandidates.length) {
      return {
        ok: false,
        code: 'MISSING_API_KEY',
        error: `未检测到 DeepSeek 凭据：请先在 DSH 登录官方账号、配置 ${hostCtx.apiKeyEnv || 'DEEPSEEK_API_KEY'}、填写专属密钥，或切换为「本机系统语音」。`,
        canFallbackBrowser: true,
      }
    }
    authAttempts = dsCandidates
    reqBody = {
      text: prepared.text,
      voice_id: effectiveVoice || 'stella',
      format: effectiveFormat,
      filter_markdown: cfg.filterMarkdown !== false,
    }
  } else {
    apiKey = await resolveTtsApiKey(runtime, cfg, hostCtx)
    endpoint = buildOpenAiSpeechEndpoint(cfg.baseUrl)
    if (!endpoint) {
      return {
        ok: false,
        code: 'MISSING_BASE_URL',
        error: 'OpenAI 兼容 TTS 尚未填写 Base URL（如 http://127.0.0.1:8880/v1）',
        canFallbackBrowser: true,
      }
    }
    const rawFmt = typeof format === 'string' && format.trim() ? format.trim().toLowerCase() : cfg.format
    effectiveFormat = ['mp3', 'wav', 'opus'].includes(rawFmt) ? rawFmt : 'mp3'
    authAttempts = [
      apiKey
        ? { headerName: 'authorization', headerValue: `Bearer ${apiKey}`, secret: apiKey }
        : { headerName: '', headerValue: '', secret: '' },
    ]
    reqBody = {
      model: cfg.model || 'tts-1',
      input: prepared.text,
      voice: effectiveVoice || 'alloy',
      response_format: effectiveFormat,
      speed: effectiveSpeed,
    }
  }

  const startedAt = Date.now()
  const ac = new AbortController()
  const timer = setTimeout(() => {
    try { ac.abort(new Error('timeout')) } catch {}
  }, cfg.timeoutMs)
  if (timer && typeof timer.unref === 'function') timer.unref()

  try {
    let resp = null
    for (let i = 0; i < authAttempts.length; i += 1) {
      const cand = authAttempts[i]
      apiKey = cand.secret || ''
      const attemptHeaders = { ...reqHeaders }
      if (cand.headerName && cand.headerValue) {
        attemptHeaders[cand.headerName] = cand.headerValue
      }
      resp = await fetchImpl(endpoint, {
        method: 'POST',
        headers: attemptHeaders,
        body: JSON.stringify(reqBody),
        signal: ac.signal,
      })
      const st = resp ? resp.status : 0
      if ((st === 401 || st === 403) && i + 1 < authAttempts.length) {
        continue
      }
      break
    }
    if (!resp || !resp.ok) {
      const status = resp ? resp.status : 0
      let rawErr = ''
      try { rawErr = resp ? await resp.text() : '' } catch {}
      const cleanErr = redactKeyFromErrorText(rawErr, apiKey)
      const errMsg = status === 401 || status === 403
        ? `语音接口鉴权失败（HTTP ${status}），请检查 DSH 登录态或 API Key 是否有效。`
        : `语音接口返回异常（HTTP ${status || 'network'}）${cleanErr ? `：${cleanErr}` : ''}`
      ttsRuntimeStats.lastProvider = cfg.provider
      ttsRuntimeStats.lastError = errMsg
      ttsRuntimeStats.lastErrorAt = Date.now()
      return {
        ok: false,
        code: 'UPSTREAM_ERROR',
        status,
        error: errMsg,
        canFallbackBrowser: true,
      }
    }

    const ab = await resp.arrayBuffer()
    let audioBuf = Buffer.from(ab)
    if (!audioBuf.length) {
      return {
        ok: false,
        code: 'EMPTY_AUDIO',
        error: '语音接口返回了空音频',
        canFallbackBrowser: true,
      }
    }
    if (audioBuf.length > MAX_AUDIO_BYTES) {
      return {
        ok: false,
        code: 'AUDIO_TOO_LARGE',
        error: '语音音频体积超过 8 MiB 限制',
        canFallbackBrowser: true,
      }
    }

    const respType = resp.headers && typeof resp.headers.get === 'function'
      ? String(resp.headers.get('content-type') || '')
      : ''
    let mimeType = cfg.provider === 'deepseek'
      ? 'audio/wav'
      : mimeForOpenAiFormat(effectiveFormat, respType)

    if (cfg.provider === 'deepseek') {
      const isRiff = audioBuf.length >= 4 && audioBuf.slice(0, 4).toString('ascii') === 'RIFF'
      if (!isRiff && (effectiveFormat === 'pcm' || /pcm/i.test(respType))) {
        audioBuf = wrapPcm24kMonoToWav(audioBuf, 24000, 1, 16)
      }
      mimeType = 'audio/wav'
    }

    const latencyMs = Math.max(1, Date.now() - startedAt)
    ttsRuntimeStats.synthesisCount += 1
    ttsRuntimeStats.lastProvider = cfg.provider
    ttsRuntimeStats.lastLatencyMs = latencyMs
    ttsRuntimeStats.lastError = ''
    ttsRuntimeStats.lastErrorAt = 0

    return {
      ok: true,
      mode: 'audio',
      provider: cfg.provider,
      voiceId: reqBody.voice_id || reqBody.voice || effectiveVoice,
      format: effectiveFormat,
      mimeType,
      buffer: audioBuf,
      bytes: audioBuf.length,
      chars: prepared.text.length,
      truncated: prepared.truncated,
      textUsed: prepared.text,
      latencyMs,
    }
  } catch (err) {
    const isTimeout = Boolean(ac.signal.aborted) || /abort|timeout/i.test(String(err && err.message || err))
    const errMsg = isTimeout
      ? `语音合成超时（超过 ${Math.round(cfg.timeoutMs / 1000)} 秒）`
      : `语音合成请求失败：${redactKeyFromErrorText(err && err.message ? err.message : err, apiKey)}`
    ttsRuntimeStats.lastProvider = cfg.provider
    ttsRuntimeStats.lastError = errMsg
    ttsRuntimeStats.lastErrorAt = Date.now()
    return {
      ok: false,
      code: isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
      error: errMsg,
      canFallbackBrowser: true,
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function probeChiefTts(
  runtime,
  rawTtsCfg = null,
  { sampleText = '', fetchImpl = globalThis.fetch } = {},
) {
  const sample = String(sampleText || '').trim() || '你好，参谋长语音播报已就绪。'
  const out = await synthesizeChiefSpeech(runtime, rawTtsCfg, {
    text: sample,
    style: 'full',
    fetchImpl,
  })
  if (!out || !out.ok) return out
  if (out.mode === 'browser') {
    return out
  }
  return {
    ok: true,
    mode: 'audio',
    provider: out.provider,
    voiceId: out.voiceId,
    format: out.format,
    mimeType: out.mimeType,
    bytes: out.bytes,
    chars: out.chars,
    truncated: out.truncated,
    textUsed: out.textUsed,
    latencyMs: out.latencyMs,
    audioBase64: out.buffer.toString('base64'),
  }
}

export async function transcribeChiefAudio(
  runtime,
  rawTtsCfg = null,
  {
    audioBase64 = '',
    buffer = null,
    mimeType = 'audio/wav',
    prefer = 'auto',
    fetchImpl = globalThis.fetch,
  } = {},
) {
  let audioBuf = Buffer.isBuffer(buffer)
    ? buffer
    : (buffer instanceof Uint8Array ? Buffer.from(buffer) : null)

  if (!audioBuf && typeof audioBase64 === 'string' && audioBase64.trim()) {
    const rawB64 = audioBase64.trim().replace(/^data:audio\/[^;]+;base64,/i, '')
    try {
      audioBuf = Buffer.from(rawB64, 'base64')
    } catch {
      return { ok: false, code: 'INVALID_AUDIO', error: '录音数据编码无效' }
    }
  }

  if (!audioBuf || audioBuf.length < 46) {
    return { ok: false, code: 'EMPTY_AUDIO', error: '录音时长过短或音频为空' }
  }
  if (audioBuf.length > MAX_STT_AUDIO_BYTES) {
    return { ok: false, code: 'AUDIO_TOO_LARGE', error: '录音音频超过 7 MiB 上限，请分段录制' }
  }

  const startedAt = Date.now()
  const cleanPrefer = prefer === 'local' || prefer === 'cloud' ? prefer : 'auto'
  const localInfo = probeHostSpeechToText(runtime)

  if (cleanPrefer !== 'cloud' && localInfo.ready) {
    const speech = runtime && typeof runtime.get === 'function' ? runtime.get('speechToText') : null
    if (speech && typeof speech.resolve === 'function' && typeof speech.transcribe === 'function') {
      const ac = new AbortController()
      const timer = setTimeout(() => {
        try { ac.abort(new Error('timeout')) } catch {}
      }, 25000)
      if (timer && typeof timer.unref === 'function') timer.unref()
      try {
        const spec = speech.resolve({ audio: new Uint8Array(audioBuf) })
        const res = await speech.transcribe(spec, ac.signal)
        const text = String((res && res.text) || '').trim()
        if (text) {
          const latencyMs = Math.max(1, Date.now() - startedAt)
          ttsRuntimeStats.sttCount += 1
          ttsRuntimeStats.lastSttProvider = 'dsh-local'
          ttsRuntimeStats.lastSttError = ''
          return {
            ok: true,
            text,
            provider: 'dsh-local',
            providerId: localInfo.providerId || 'sensevoice',
            latencyMs,
          }
        }
        return { ok: false, code: 'EMPTY_TRANSCRIPT', error: '未识别到有效语音内容' }
      } catch (err) {
        const msg = redactKeyFromErrorText(err && err.message ? err.message : err)
        ttsRuntimeStats.lastSttError = msg
        if (cleanPrefer === 'local') {
          return { ok: false, code: 'LOCAL_STT_ERROR', error: `本地语音识别失败：${msg}` }
        }
      } finally {
        clearTimeout(timer)
      }
    }
  }

  if (cleanPrefer === 'local') {
    return {
      ok: false,
      code: 'LOCAL_STT_UNAVAILABLE',
      error: localInfo.available ? '本地 SenseVoice 语音识别模型尚未就绪' : 'DSH 本地语音识别服务不可用',
    }
  }

  const cfg = normalizeTtsConfig(rawTtsCfg)
  const hostCtx = await resolveHostDeepSeekTtsContext(runtime)
  const isDeepSeekTtsCfg = cfg.provider === 'deepseek'
  const asrBaseUrl = (isDeepSeekTtsCfg && cfg.baseUrl)
    ? cfg.baseUrl
    : (hostCtx.baseUrl || 'https://api.deepseek.com')
  const endpoint = buildDeepSeekAsrEndpoint(asrBaseUrl)
  const dsCandidates = await resolveDeepSeekAuthCandidates(runtime, isDeepSeekTtsCfg ? cfg : null, hostCtx, endpoint)
  if (!dsCandidates.length) {
    return {
      ok: false,
      code: 'MISSING_STT_CREDENTIAL',
      error: '本地离线语音模型未就绪，且未检测到 DeepSeek 官方登录态或 API Key。',
    }
  }
  if (typeof fetchImpl !== 'function' || typeof FormData !== 'function' || typeof Blob !== 'function') {
    return { ok: false, code: 'FETCH_UNAVAILABLE', error: '当前运行环境不支持云端 ASR 请求' }
  }

  const ac = new AbortController()
  const timer = setTimeout(() => {
    try { ac.abort(new Error('timeout')) } catch {}
  }, Math.max(cfg.timeoutMs || 15000, 20000))
  if (timer && typeof timer.unref === 'function') timer.unref()

  let lastSecret = dsCandidates[0].secret || ''
  let usedAuthMode = dsCandidates[0].authMode || 'dsh-account'
  try {
    const cleanMime = String(mimeType || 'audio/wav').split(';')[0].trim() || 'audio/wav'
    let resp = null
    for (let i = 0; i < dsCandidates.length; i += 1) {
      const cand = dsCandidates[i]
      lastSecret = cand.secret || ''
      usedAuthMode = cand.authMode || ''
      const form = new FormData()
      form.append('file', new Blob([audioBuf], { type: cleanMime }), 'speech.wav')
      resp = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { [cand.headerName]: cand.headerValue },
        body: form,
        signal: ac.signal,
      })
      const st = resp ? resp.status : 0
      if ((st === 401 || st === 403) && i + 1 < dsCandidates.length) {
        continue
      }
      break
    }
    if (!resp || !resp.ok) {
      const status = resp ? resp.status : 0
      let rawErr = ''
      try { rawErr = resp ? await resp.text() : '' } catch {}
      const cleanErr = redactKeyFromErrorText(rawErr, lastSecret)
      const errMsg = status === 401 || status === 403
        ? `语音识别鉴权失败（HTTP ${status}），请检查 DSH 登录状态或 API Key。`
        : `语音识别接口异常（HTTP ${status || 'network'}）${cleanErr ? `：${cleanErr}` : ''}`
      ttsRuntimeStats.lastSttProvider = 'deepseek-asr'
      ttsRuntimeStats.lastSttError = errMsg
      return { ok: false, code: 'UPSTREAM_ERROR', status, error: errMsg }
    }
    const payload = await resp.json().catch(() => null)
    const text = String((payload && payload.text) || '').trim()
    if (!text) {
      return { ok: false, code: 'EMPTY_TRANSCRIPT', error: '未识别出清晰的语音内容，请再说一次' }
    }
    const latencyMs = Math.max(1, Date.now() - startedAt)
    ttsRuntimeStats.sttCount += 1
    ttsRuntimeStats.lastSttProvider = 'deepseek-asr'
    ttsRuntimeStats.lastSttError = ''
    return {
      ok: true,
      text,
      provider: 'deepseek-asr',
      authMode: usedAuthMode,
      latencyMs,
    }
  } catch (err) {
    const isTimeout = Boolean(ac.signal.aborted) || /abort|timeout/i.test(String(err && err.message || err))
    const errMsg = isTimeout
      ? '语音识别请求超时'
      : `语音识别请求失败：${redactKeyFromErrorText(err && err.message ? err.message : err, lastSecret)}`
    ttsRuntimeStats.lastSttProvider = 'deepseek-asr'
    ttsRuntimeStats.lastSttError = errMsg
    return { ok: false, code: isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR', error: errMsg }
  } finally {
    clearTimeout(timer)
  }
}
