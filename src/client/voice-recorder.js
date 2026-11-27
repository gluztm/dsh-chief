/**
 * src/client/voice-recorder.js — 前端轻量 16kHz 单声道 PCM16 录音与双通道转写器
 *
 * - 优先录制标准 16kHz mono PCM16 WAV，直连 DSH 宿主机离线 SenseVoice ONNX 或 DeepSeek ASR；
 * - 若设备禁用/缺少麦克风或后端识别不可用，可平滑提供 Web Speech API 浏览器兜底（若支持）；
 * - 模块顶层严格不触碰 window/navigator，确保 Node 端 `import()` 静态校验 100% 通过。
 */

import { call } from './api/transport.js'
import { store } from './store.js'

const TARGET_SAMPLE_RATE = 16000

export function voiceRecCanRecord() {
  try {
    return Boolean(
      typeof navigator !== 'undefined'
      && navigator.mediaDevices
      && typeof navigator.mediaDevices.getUserMedia === 'function'
      && typeof window !== 'undefined'
      && (window.AudioContext || window.webkitAudioContext)
    )
  } catch {
    return false
  }
}

export function voiceRecHasBrowserStt() {
  try {
    return Boolean(
      typeof window !== 'undefined'
      && (window.SpeechRecognition || window.webkitSpeechRecognition)
    )
  } catch {
    return false
  }
}

export function voiceRecPeakOf(floatSamples) {
  if (!floatSamples || !floatSamples.length) return 0
  let peak = 0
  for (let i = 0; i < floatSamples.length; i += 1) {
    const a = Math.abs(floatSamples[i])
    if (a > peak) peak = a
  }
  return peak
}

export function downsampleFloat32(samples, inRate, outRate = TARGET_SAMPLE_RATE) {
  const src = samples instanceof Float32Array ? samples : new Float32Array(samples || 0)
  const srIn = Number(inRate) || outRate
  const srOut = Number(outRate) || TARGET_SAMPLE_RATE
  if (!src.length || srIn === srOut || srIn <= 0) return src
  const ratio = srIn / srOut
  const outLen = Math.max(1, Math.round(src.length / ratio))
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i += 1) {
    const pos = i * ratio
    const idx = Math.floor(pos)
    const frac = pos - idx
    const s0 = src[idx] || 0
    const s1 = idx + 1 < src.length ? src[idx + 1] : s0
    const v = s0 + (s1 - s0) * frac
    out[i] = v > 1 ? 1 : (v < -1 ? -1 : v)
  }
  return out
}

export function voiceRecFloatToPcm16(floatSamples) {
  const src = floatSamples || []
  const out = new Int16Array(src.length)
  for (let i = 0; i < src.length; i += 1) {
    const s = Math.max(-1, Math.min(1, Number(src[i]) || 0))
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff)
  }
  return out
}

export function voiceRecEncodeWave(pcm16, sampleRate = TARGET_SAMPLE_RATE) {
  const samples = pcm16 instanceof Int16Array ? pcm16 : voiceRecFloatToPcm16(pcm16)
  const sr = Number(sampleRate) || TARGET_SAMPLE_RATE
  const dataBytes = samples.length * 2
  const buf = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buf)
  const bytes = new Uint8Array(buf)

  const writeAscii = (offset, str) => {
    for (let i = 0; i < str.length; i += 1) bytes[offset + i] = str.charCodeAt(i)
  }
  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true)  // Linear PCM
  view.setUint16(22, 1, true)  // Mono
  view.setUint32(24, sr, true)
  view.setUint32(28, sr * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(36, 'data')
  view.setUint32(40, dataBytes, true)

  for (let i = 0; i < samples.length; i += 1) {
    view.setInt16(44 + i * 2, samples[i], true)
  }
  return bytes
}

export function voiceRecUint8ToBase64(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0)
  if (typeof Buffer === 'function') {
    return Buffer.from(arr).toString('base64')
  }
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < arr.length; i += chunk) {
    bin += String.fromCharCode(...arr.subarray(i, i + chunk))
  }
  return btoa(bin)
}

export function createVoiceVadTracker({
  speechThreshold = 0.018,
  silenceMs = 1300,
  minSpeechMs = 320,
  maxIdleMs = 12000,
  startedAt = Date.now(),
} = {}) {
  const th = Math.max(0.004, Number(speechThreshold) || 0.018)
  const silWait = Math.max(400, Number(silenceMs) || 1300)
  const minSpeak = Math.max(120, Number(minSpeechMs) || 320)
  const idleLimit = Math.max(3000, Number(maxIdleMs) || 12000)

  let firstSpeechAt = 0
  let lastSpeechAt = 0
  let ended = false

  return {
    get heardSpeech() {
      return firstSpeechAt > 0
    },
    feed(peak, nowMs = Date.now()) {
      if (ended) return { vadEvent: 'none', heardSpeech: firstSpeechAt > 0 }
      const p = Number(peak) || 0
      const now = Number(nowMs) || Date.now()
      let vadEvent = 'none'

      if (p >= th) {
        if (!firstSpeechAt) {
          firstSpeechAt = now
          vadEvent = 'speech_start'
        }
        lastSpeechAt = now
        return { vadEvent, heardSpeech: true }
      }

      if (firstSpeechAt > 0) {
        const spokenDuration = Math.max(0, lastSpeechAt - firstSpeechAt)
        const quietDuration = Math.max(0, now - lastSpeechAt)
        if ((now - firstSpeechAt) >= minSpeak && spokenDuration >= minSpeak * 0.4 && quietDuration >= silWait) {
          ended = true
          return { vadEvent: 'silence_end', heardSpeech: true }
        }
        if (quietDuration >= silWait + 600 && (now - firstSpeechAt) >= minSpeak) {
          ended = true
          return { vadEvent: 'silence_end', heardSpeech: true }
        }
        return { vadEvent: 'none', heardSpeech: true }
      }

      if ((now - startedAt) >= idleLimit) {
        ended = true
        return { vadEvent: 'idle_timeout', heardSpeech: false }
      }
      return { vadEvent: 'none', heardSpeech: false }
    },
  }
}

export async function startChiefVoiceRecording({
  onLevel = null,
  onMaxDuration = null,
  maxDurationMs = 55000,
  vad = null,
} = {}) {
  if (!voiceRecCanRecord()) {
    throw new Error('当前环境不支持麦克风录音权限（未检测到 MediaDevices / AudioContext）')
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  })
  const AudioCtx = window.AudioContext || window.webkitAudioContext
  let audioCtx
  try {
    audioCtx = new AudioCtx({ sampleRate: TARGET_SAMPLE_RATE })
  } catch {
    audioCtx = new AudioCtx()
  }
  const source = audioCtx.createMediaStreamSource(stream)
  const processor = audioCtx.createScriptProcessor(4096, 1, 1)
  const silentGain = audioCtx.createGain()
  silentGain.gain.value = 0

  const chunks = []
  let totalSamples = 0
  let stopped = false
  const startedAt = Date.now()
  let maxTimer = null
  const vadEnabled = Boolean(vad && vad.enabled)
  const vadTracker = vadEnabled
    ? createVoiceVadTracker({
        speechThreshold: vad.speechThreshold || 0.018,
        silenceMs: vad.silenceMs || 1300,
        minSpeechMs: vad.minSpeechMs || 320,
        maxIdleMs: vad.maxIdleMs || 12000,
        startedAt,
      })
    : null

  const cleanup = () => {
    if (maxTimer) {
      clearTimeout(maxTimer)
      maxTimer = null
    }
    try { processor.onaudioprocess = null } catch {}
    try { processor.disconnect() } catch {}
    try { source.disconnect() } catch {}
    try { silentGain.disconnect() } catch {}
    try {
      for (const tr of stream.getTracks()) tr.stop()
    } catch {}
    try {
      if (audioCtx && audioCtx.state !== 'closed') void audioCtx.close()
    } catch {}
  }

  processor.onaudioprocess = (ev) => {
    if (stopped) return
    const input = ev && ev.inputBuffer ? ev.inputBuffer.getChannelData(0) : null
    if (!input || !input.length) return
    const copy = new Float32Array(input.length)
    copy.set(input)
    chunks.push(copy)
    totalSamples += copy.length
    const peakNow = voiceRecPeakOf(copy)
    const now = Date.now()
    if (typeof onLevel === 'function') {
      onLevel(peakNow, now - startedAt)
    }
    if (vadTracker) {
      const evVad = vadTracker.feed(peakNow, now)
      if (evVad.vadEvent === 'speech_start' && typeof vad.onSpeechStart === 'function') {
        vad.onSpeechStart()
      } else if (evVad.vadEvent === 'silence_end' && typeof vad.onAutoStop === 'function') {
        vad.onAutoStop('silence')
      } else if (evVad.vadEvent === 'idle_timeout' && typeof vad.onAutoStop === 'function') {
        vad.onAutoStop('idle-timeout')
      }
    }
  }

  source.connect(processor)
  processor.connect(silentGain)
  silentGain.connect(audioCtx.destination)

  if (maxDurationMs > 0) {
    maxTimer = setTimeout(() => {
      if (!stopped && typeof onMaxDuration === 'function') {
        onMaxDuration()
      }
    }, maxDurationMs)
  }

  return {
    stop() {
      if (stopped) return null
      stopped = true
      const elapsedMs = Math.max(1, Date.now() - startedAt)
      const inRate = Number(audioCtx && audioCtx.sampleRate) || TARGET_SAMPLE_RATE
      cleanup()
      const merged = new Float32Array(totalSamples)
      let offset = 0
      for (const c of chunks) {
        merged.set(c, offset)
        offset += c.length
      }
      const resampled = downsampleFloat32(merged, inRate, TARGET_SAMPLE_RATE)
      const peak = voiceRecPeakOf(resampled)
      const pcm16 = voiceRecFloatToPcm16(resampled)
      const wavBytes = voiceRecEncodeWave(pcm16, TARGET_SAMPLE_RATE)
      return {
        wavBytes,
        audioBase64: voiceRecUint8ToBase64(wavBytes),
        mimeType: 'audio/wav',
        sampleRate: TARGET_SAMPLE_RATE,
        durationMs: elapsedMs,
        peak,
      }
    },
    cancel() {
      if (stopped) return
      stopped = true
      cleanup()
    },
  }
}

export function startBrowserSpeechDictation({
  lang = 'zh-CN',
  continuous = false,
  onInterim = null,
  onResult = null,
  onError = null,
  onEnd = null,
} = {}) {
  if (!voiceRecHasBrowserStt()) return null
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition
  const rec = new Ctor()
  rec.lang = lang
  rec.interimResults = true
  rec.continuous = Boolean(continuous)
  let finalText = ''

  rec.onresult = (event) => {
    let interim = ''
    let deltaFinal = ''
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const res = event.results[i]
      const t = res && res[0] ? String(res[0].transcript || '') : ''
      if (res.isFinal) {
        finalText += t
        deltaFinal += t
      } else {
        interim += t
      }
    }
    if (interim && typeof onInterim === 'function') onInterim(interim)
    const outText = continuous ? deltaFinal.trim() : finalText.trim()
    if (outText && typeof onResult === 'function') onResult(outText)
  }
  rec.onerror = (ev) => {
    if (typeof onError === 'function') onError(String((ev && ev.error) || 'speech-error'))
  }
  rec.onend = () => {
    if (typeof onEnd === 'function') onEnd(finalText.trim())
  }
  rec.start()
  return {
    stop() { try { rec.stop() } catch {} },
    abort() { try { rec.abort() } catch {} },
  }
}

export async function transcribeRecordedWaveApi({
  audioBase64 = '',
  mimeType = 'audio/wav',
  mode = 'dictation',
  durationMs = 0,
  prefer = 'auto',
  saveToInbox = true,
} = {}) {
  return call('chief/fact', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      session: store.sessionId || '',
      op: 'tts.transcribe',
      audioBase64,
      mimeType,
      mode,
      durationMs,
      prefer,
      saveToInbox: saveToInbox !== false,
    }),
  })
}

const WAKE_PREFIX_RE = /^(?:(?:嗨|嘿|喂|哎|你好|您好|哈喽|早安|晚安|麻烦|请|叫一下|喊一下|hey|hi|hello)[\s,，!！、]*)+/i
const WAKE_GREETING_ONLY_RE = /^(?:在吗|在不在|你在吗|你好|您好|哈喽|醒醒|出来|听得到吗|听得见吗|能听到吗|帮我个忙|聊聊|聊聊天|hello|hi|hey|there)?[\s,，。!！?？~～]*$/i
const WAKE_HOMOPHONE_GROUPS = [
  ['杰米尼', '结米尼', '节米尼', '接米尼', '杰迷尼', '洁米尼', 'gemini'],
  ['哈基米', '哈吉米', '哈机米', '哈鸡米', '哈积米'],
  ['参谋长', '餐谋长', '参谋掌', '参谋涨', '小参谋'],
  ['小克', '小可', '晓克', 'claude', '克劳德'],
  ['鲸鱼娘', '小鲸鱼', '经语娘', 'deepseek'],
]

export function matchChiefWakeCall(rawText, chiefNames = [], opts = {}) {
  const raw = String(rawText || '').trim()
  if (!raw) return { matched: false, matchedName: '', remainder: '', isGreetingOnly: false }
  const seedNames = (Array.isArray(chiefNames) ? chiefNames : [chiefNames])
    .map(x => String(x || '').trim())
    .filter(x => x.length >= 2)
  const expanded = new Set([...seedNames, '参谋长', '小参谋'])
  for (const name of [...expanded]) {
    const low = name.toLowerCase()
    for (const grp of WAKE_HOMOPHONE_GROUPS) {
      if (grp.some(g => g.toLowerCase() === low)) {
        for (const alias of grp) expanded.add(alias)
      }
    }
  }
  const candidates = Array.from(expanded).sort((a, b) => b.length - a.length)

  const strippedPrefix = raw.replace(WAKE_PREFIX_RE, '').trim()
  for (const candidate of candidates) {
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`^${escaped}(?:$|[\\s,，。!！?？:：~～、]+([\\s\\S]*))$`, 'i')
    const m = strippedPrefix.match(re)
    if (m) {
      const remainder = String(m[1] || '').trim()
      const isGreetingOnly = !remainder || WAKE_GREETING_ONLY_RE.test(remainder)
      return { matched: true, matchedName: candidate, remainder, isGreetingOnly }
    }
  }
  if (opts && opts.allowAnywhere) {
    for (const candidate of candidates) {
      const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const prefixGuard = /^[a-z0-9]/i.test(candidate) ? '(?<![a-z0-9])' : '(?<![的了着过在是从把被对给])'
      const reAny = new RegExp(`${prefixGuard}${escaped}(?:$|[\\s,，。!！?？:：~～、]+([\\s\\S]*))$`, 'i')
      const m = raw.match(reAny)
      if (m) {
        const remainder = String(m[1] || '').trim()
        const isGreetingOnly = !remainder || WAKE_GREETING_ONLY_RE.test(remainder)
        return { matched: true, matchedName: candidate, remainder, isGreetingOnly }
      }
    }
  }
  return { matched: false, matchedName: '', remainder: '', isGreetingOnly: false }
}
