#!/usr/bin/env node
/**
 * verify-v190-tts-gate.mjs
 *
 * Self-contained regression gate for Voice Chief TTS Playback (`chief-tts.js` + `src/client/tts.js`):
 *   - T1: Module invariants (files[] contains chief-tts.js, 27 HTTP routes, 0 child_process, 0 mutable exports, client markers)
 *   - T2: scrubSecretsForSpeech & prepareSpeechText (Markdown/code/paths/hashes/secrets redaction, brief vs full truncation)
 *   - T3: DeepSeek TTS E2E (auto-reuses runtime credentials DEEPSEEK_API_KEY, verifies payload, wav pass-through & pcm 24kHz RIFF wrap)
 *   - T4: OpenAI-compatible TTS E2E (/audio/speech resolution, model/input/voice/response_format/speed, local no-key & Bearer auth)
 *   - T5: HTTP /api/dsh-chief/chief/fact tts.* routes & guard 403 + binary/JSON modes + snapshot/view/config apiKey redaction
 *   - T6: 0-byte @lead isolation & plain unactivated session non-intrusion
 *   - T7: Error & fallback handling (missing key, HTTP 401, timeout, empty text, zero key leakage in error messages)
 *   - T8: Frontend src/client/tts.js Node direct-import, cleanClientTextForSpeech, per-session baseline suppression, stopChiefSpeech reset
 *   - T9: DSH Official Account credential auto-reuse (`deepseekAccount.resolveToken` + `readRecord('deepseek-account-platform/default')`, `x-dsh-auth-token`, no `rejectToken` on 401)
 *   - T10: Dual-path STT (`speechToText` local SenseVoice + DeepSeek `/v1/tools/asr` multipart FormData fallback)
 *   - T11: Composer Voice Mode `voiceChat: true` (`reasonKind: 'voice_chat'`, `effortOverride: 'off'`, `voice-inbox` reply attachment, 0-byte `@lead`)
 *   - T12: Voice Inbox markdown lifecycle & `runManagedDreamRoam` decomposition into Memory / Profile / Diary / Archives
 *   - T13: Frontend `src/client/voice-recorder.js` Node ESM import, 16kHz PCM16 WAV header & `client.js` Phase 2 markers
 */

import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PKG = path.resolve(__dirname, '..')

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-v190-tts-'))
const dshHome = path.join(tmpRoot, 'dsh-home')
const chiefDataDir = path.join(tmpRoot, 'chief-data')
const wsDir = path.join(tmpRoot, 'workspace-main')
fs.mkdirSync(dshHome, { recursive: true })
fs.mkdirSync(chiefDataDir, { recursive: true })
fs.mkdirSync(wsDir, { recursive: true })

const prevDsKey = process.env.DEEPSEEK_API_KEY
const prevDsBase = process.env.DEEPSEEK_BASE_URL
delete process.env.DEEPSEEK_API_KEY
delete process.env.DEEPSEEK_BASE_URL
process.env.DSH_HOME = dshHome
process.env.DSH_CHIEF_DATA_DIR = chiefDataDir
process.env.DSH_CHIEF_WALLS_FILE = path.join(tmpRoot, 'walls.json')

function modUrl(rel) {
  return pathToFileURL(path.join(PKG, rel)).href
}

// Create minimal valid WAV buffer (RIFF....WAVE) & raw 24kHz PCM buffer
function makeFakeWavBuffer(payloadBytes = 64) {
  const buf = Buffer.alloc(44 + payloadBytes)
  buf.write('RIFF', 0, 4, 'ascii')
  buf.writeUInt32LE(36 + payloadBytes, 4)
  buf.write('WAVE', 8, 4, 'ascii')
  buf.write('fmt ', 12, 4, 'ascii')
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(24000, 24)
  buf.writeUInt32LE(48000, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36, 4, 'ascii')
  buf.writeUInt32LE(payloadBytes, 40)
  return buf
}

const dsRequests = []
const oaiRequests = []
const fakeWav = makeFakeWavBuffer(96)
const fakePcm = Buffer.alloc(128, 0x2a)
const fakeMp3 = Buffer.from('ID3fake-mp3-audio-payload-123456')

let dsMode = 'ok' // 'ok' | 'unauth' | 'slow'

const server = http.createServer(async (req, res) => {
  const chunks = []
  for await (const ch of req) chunks.push(ch)
  const rawBuf = Buffer.concat(chunks)
  const raw = rawBuf.toString('utf8')
  const url = req.url || '/'

  if (url === '/v1/tools/asr') {
    const hasFile = raw.includes('filename="speech.wav"') || raw.includes('RIFF')
    res.statusCode = hasFile ? 200 : 400
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(hasFile ? { text: '云端 ASR 识别结果：记得把日志加上请求编号' } : { error: 'missing file' }))
    return
  }

  const body = raw.trim() ? JSON.parse(raw) : {}

  if (url === '/v1/tools/tts') {
    dsRequests.push({ headers: req.headers, body })
    if (dsMode === 'unauth') {
      res.statusCode = 401
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: `Invalid token ${String(req.headers.authorization || '')}` }))
      return
    }
    if (dsMode === 'slow') {
      await new Promise(r => {
        const t = setTimeout(r, 6200)
        t.unref?.()
      })
      res.statusCode = 200
      res.end(fakeWav)
      return
    }
    if (body.format === 'pcm') {
      res.statusCode = 200
      res.setHeader('content-type', 'audio/pcm')
      res.end(fakePcm)
      return
    }
    res.statusCode = 200
    res.setHeader('content-type', 'audio/wav')
    res.end(fakeWav)
    return
  }

  if (url === '/v1/audio/speech' || url === '/local-tts/v1/audio/speech') {
    oaiRequests.push({ url, headers: req.headers, body })
    res.statusCode = 200
    res.setHeader('content-type', body.response_format === 'wav' ? 'audio/wav' : 'audio/mpeg')
    res.end(body.response_format === 'wav' ? fakeWav : fakeMp3)
    return
  }

  res.statusCode = 404
  res.end(JSON.stringify({ error: 'not found' }))
})

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const baseUrl = `http://127.0.0.1:${port}`

try {
  // =========================================================================
  // T1: Module invariants, files[] whitelist, 0 child_process, client markers
  // =========================================================================
  const pkgJson = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8'))
  assert.ok(Array.isArray(pkgJson.files) && pkgJson.files.includes('chief-tts.js'), 'T1 package.json files[] must include chief-tts.js')
  assert.ok(pkgJson.files.includes('voice-inbox.js'), 'T1 package.json files[] must include voice-inbox.js')
  const ttsSrc = fs.readFileSync(path.join(PKG, 'chief-tts.js'), 'utf8')
  const viSrc = fs.readFileSync(path.join(PKG, 'voice-inbox.js'), 'utf8')
  assert.equal(/(?:from|import\s*\(|require\s*\()\s*['"](?:node:)?child_process['"]/.test(ttsSrc), false, 'T1 chief-tts.js must not import child_process')
  assert.equal(/(?:from|import\s*\(|require\s*\()\s*['"](?:node:)?child_process['"]/.test(viSrc), false, 'T1 chief-voice-inbox.js must not import child_process')
  assert.equal(/^export\s+(?:let|var)\s+/m.test(ttsSrc), false, 'T1 chief-tts.js must have zero mutable exports')
  assert.equal(/^export\s+(?:let|var)\s+/m.test(viSrc), false, 'T1 chief-voice-inbox.js must have zero mutable exports')

  const clientBundle = fs.readFileSync(path.join(PKG, 'client.js'), 'utf8')
  for (const marker of [
    'speakChiefText',
    'stopChiefSpeech',
    'playChiefAudioBase64',
    'fetchChiefTtsStatusApi',
    'probeChiefTtsApi',
    'dnb-tts-nowbar',
    'tts.synthesize',
    'tts.transcribe',
    'tts.voice_inbox_list',
    'tts.voice_inbox_dream_now',
    'dnb-voice-btn',
    'voiceSpark',
    'transcribeRecordedWaveApi',
    'ChiefVoiceModeStage',
    'dnb-voice-stage',
    'dnb-voice-orb',
    'matchChiefWakeCall',
    'voiceWakeListening',
  ]) {
    assert.ok(clientBundle.includes(marker), `T1 client.js missing TTS/Voice marker: ${marker}`)
  }

  const safetyMd5Expected = {
    'chief-executor.js': '7bd1f9ef79af867fdb461f605f3e5cdc',
    'safety/policy-engine.js': 'b02bf22da6dbf2a3a4f2f2548c1b27fb',
  }
  for (const [rel, expected] of Object.entries(safetyMd5Expected)) {
    const actual = crypto.createHash('md5').update(fs.readFileSync(path.join(PKG, rel))).digest('hex')
    assert.equal(actual, expected, `T1 safety file ${rel} MD5 must stay locked`)
  }
  console.log('[T1 PASS] Module invariants, zero child_process, client markers & safety MD5 verified')

  // =========================================================================
  // T2: scrubSecretsForSpeech & prepareSpeechText
  // =========================================================================
  const ttsMod = await import(modUrl('chief-tts.js'))
  const secretRaw = '请检查 sk-proj-topsecretvalue1234567890 和 Bearer abcdefghijklmnop12345 以及 api_key=my_secret_value_9981'
  const scrubbed = ttsMod.scrubSecretsForSpeech(secretRaw)
  assert.equal(scrubbed.includes('sk-proj-topsecretvalue1234567890'), false, 'T2 sk- key must be redacted')
  assert.equal(scrubbed.includes('abcdefghijklmnop12345'), false, 'T2 Bearer token must be redacted')
  assert.equal(scrubbed.includes('my_secret_value_9981'), false, 'T2 api_key= must be redacted')

  const mdSample = [
    '# 第三步完成汇报',
    '- 已修改 `D:\\Agents WorkSpace\\DSH-Data\\WorkShop\\notebook-panel\\pkg\\chief-tts.js` 并补齐回归测试。',
    '- 详情请看 [说明文档](https://example.com/docs/tts) 或 `https://api.deepseek.com/v1/tools/tts`。',
    '```js\nconsole.log("ignore long code block")\n```',
    '所有测试 8/8 均已通过，请老板确认是否继续发版。',
    '第四句补充说明可以作为完整版补充展示内容。',
  ].join('\n')

  const briefOut = ttsMod.prepareSpeechText(mdSample, { style: 'brief' })
  assert.ok(briefOut.text.length > 0 && briefOut.text.length <= 240, 'T2 brief style must cap at <= 240 chars')
  assert.equal(briefOut.text.includes('```'), false, 'T2 brief must strip fenced code blocks')
  assert.equal(briefOut.text.includes('https://'), false, 'T2 brief must replace raw URLs')
  assert.equal(briefOut.text.includes('D:\\Agents'), false, 'T2 brief must shorten absolute paths')

  const fullOut = ttsMod.prepareSpeechText('这是一段很长很长的话。'.repeat(40), { style: 'full', maxChars: 160 })
  assert.equal(fullOut.truncated, true, 'T2 long full text must be truncated')
  assert.ok(fullOut.text.includes('其余细节请查看文字内容'), 'T2 truncated full text must append polite tail')
  console.log('[T2 PASS] Secret scrubbing & spoken text preparation verified')

  // =========================================================================
  // T3 & T4: DeepSeek TTS E2E (host credential reuse + PCM->WAV) & OpenAI-compat E2E
  // =========================================================================
  const HOST_DS_KEY = 'sk-deepseek-host-runtime-secret-998877'
  const mockRuntime = {
    get(name) {
      if (name === 'settings') {
        return {
          describe: () => [{ ns: 'llm-deepseek', value: { apiKeyEnv: 'DEEPSEEK_API_KEY', baseURL: baseUrl } }],
        }
      }
      if (name === 'credentials') {
        return {
          describe: async (ref) => ref === 'DEEPSEEK_API_KEY' ? { configured: true, source: 'keychain' } : { configured: false },
          resolve: async (ref) => ref === 'DEEPSEEK_API_KEY' ? { value: HOST_DS_KEY, source: 'keychain' } : undefined,
        }
      }
      return null
    },
  }

  const hostStatus = await ttsMod.getChiefTtsStatus(mockRuntime, { provider: 'deepseek', voiceId: 'stella' })
  assert.equal(hostStatus.hostDeepSeek.configured, true, 'T3 host DeepSeek key status must detect credentials.describe')
  assert.equal(hostStatus.tts.apiKey, '', 'T3 status must never expose plaintext apiKey')

  const dsWavRes = await ttsMod.synthesizeChiefSpeech(mockRuntime, {
    provider: 'deepseek',
    voiceId: 'tide',
    format: 'wav',
    filterMarkdown: true,
    baseUrl,
  }, { text: '**测试播报**：`pkg/chief-tts.js` 已就绪。' })
  assert.equal(dsWavRes.ok, true, 'T3 DeepSeek wav synthesis must succeed')
  assert.equal(dsWavRes.mimeType, 'audio/wav')
  assert.equal(dsWavRes.buffer.slice(0, 4).toString('ascii'), 'RIFF')
  assert.equal(dsRequests[0].headers.authorization, `Bearer ${HOST_DS_KEY}`, 'T3 must reuse host credential')
  assert.equal(dsRequests[0].body.voice_id, 'tide')
  assert.equal(dsRequests[0].body.filter_markdown, true)

  const dsPcmRes = await ttsMod.synthesizeChiefSpeech(mockRuntime, {
    provider: 'deepseek',
    voiceId: 'stella',
    format: 'pcm',
    baseUrl,
  }, { text: 'PCM 自动封装 WAV 测试。' })
  assert.equal(dsPcmRes.ok, true, 'T3 DeepSeek pcm synthesis must succeed')
  assert.equal(dsPcmRes.mimeType, 'audio/wav')
  assert.equal(dsPcmRes.buffer.slice(0, 4).toString('ascii'), 'RIFF', 'T3 PCM must wrap with RIFF header')
  assert.equal(dsPcmRes.buffer.slice(8, 12).toString('ascii'), 'WAVE', 'T3 PCM must wrap with WAVE header')
  assert.equal(dsPcmRes.buffer.length, 44 + fakePcm.length, 'T3 wrapped WAV size must equal 44 + PCM length')

  const oaiLocalRes = await ttsMod.synthesizeChiefSpeech(mockRuntime, {
    provider: 'openai-compat',
    baseUrl: `${baseUrl}/local-tts`,
    model: 'kokoro',
    voiceId: 'zf_xiaobei',
    format: 'mp3',
    speed: 1.15,
  }, { text: '本地语音代理测试。' })
  assert.equal(oaiLocalRes.ok, true, 'T4 local OpenAI-compat without key must succeed')
  assert.equal(oaiLocalRes.mimeType, 'audio/mpeg')
  assert.equal(oaiRequests[0].url, '/local-tts/v1/audio/speech')
  assert.equal(oaiRequests[0].headers.authorization, undefined, 'T4 local no-key must omit Authorization header')
  assert.equal(oaiRequests[0].body.model, 'kokoro')
  assert.equal(oaiRequests[0].body.voice, 'zf_xiaobei')
  assert.equal(oaiRequests[0].body.speed, 1.15)
  console.log('[T3 & T4 PASS] DeepSeek TTS (host credential + PCM->WAV) & OpenAI-compat E2E verified')

  // =========================================================================
  // T5 & T6: Full HTTP routes (27/27), guard 403, binary/JSON, redaction, 0-byte @lead isolation
  // =========================================================================
  const stateMod = await import(modUrl('state-schema.js'))
  const chiefStateMod = await import(modUrl('chief-state.js'))
  const storeMod = await import(modUrl('board-store.js'))
  const subagentMod = await import(modUrl('subagent-runtime.js'))
  const actionsMod = await import(modUrl('board-actions.js'))
  const toolsMod = await import(modUrl('model-tools.js'))
  const routesMod = await import(modUrl('api-routes.js'))
  const hooksMod = await import(modUrl('runtime-hooks.js'))

  const bus = {
    hostState: {
      activeRuntime: null,
      activeLlm: null,
      activeSubprocess: null,
      activeAutoContinue: null,
      autoSteeredTurns: new Map(),
      subagentRootMap: new Map(),
      subagentTreeCache: new Map(),
      detectedHarnessProviders: new Map(),
      activeBubbleRuns: new Map(),
      handoffSeq: 0,
    },
  }
  Object.assign(bus, storeMod.createBoardStore(bus))
  Object.assign(bus, subagentMod.createSubagentRuntime(bus))
  Object.assign(bus, actionsMod.createBoardActions(bus))
  Object.assign(bus, toolsMod.createModelTools(bus))
  Object.assign(bus, routesMod.createApiRoutes(bus))
  Object.assign(bus, hooksMod.createRuntimeHooks(bus))

  const sidPlain = 'sess-tts-plain-01'
  let rejectCode = 0
  let registeredSystemPrompt = null
  const fakeAgentPlain = { id: sidPlain, cwd: wsDir, status: 'idle', session: { id: sidPlain, cwd: wsDir, ownEvents: () => [] } }
  const runEffect = (fn) => {
    try { if (typeof fn === 'function') fn() } catch {}
  }
  const fakeRuntime = {
    inject: (names, cb) => cb({
      get: (n) => {
        if (n === 'systemPrompt') return { section: (spec) => { registeredSystemPrompt = spec; return () => {} } }
        if (n === 'webServer') return { route: () => () => {} }
        if (n === 'tools') return { register: () => () => {} }
        if (n === 'agents') return { get: () => fakeAgentPlain, list: () => [fakeAgentPlain] }
        if (n === 'sessions') return { get: (id) => ({ id, blank: false, seq: 1 }) }
        return null
      },
      effect: runEffect,
      on: () => () => {},
    }),
    get(n) {
      if (n === 'connection') return { requestRejection: () => rejectCode }
      if (n === 'agents') return { get: () => fakeAgentPlain, list: () => [fakeAgentPlain] }
      if (n === 'sessions') return { get: (id) => ({ id, blank: false, seq: 1 }) }
      if (n === 'settings') return mockRuntime.get('settings')
      if (n === 'credentials') return mockRuntime.get('credentials')
      return null
    },
    on: () => () => {},
    effect: runEffect,
    provide: () => {},
  }
  bus.apply(fakeRuntime)
  const routes = bus.routeTable(fakeRuntime)
  assert.equal(routes.length, 27, 'T5 api-routes must preserve exactly 27 routes')

  const invoke = async (routePath, { method = 'POST', query = '', headers = {}, body = null } = {}) => {
    const entry = routes.find(r => r.path === routePath)
    assert.ok(entry, `Missing route: ${routePath}`)
    let resStatus = 200
    const resHeaders = {}
    const resChunks = []
    const req = {
      method,
      url: routePath + query,
      headers,
      on: (ev, fn) => {
        if (ev === 'data' && body !== null) fn(Buffer.from(JSON.stringify(body), 'utf8'))
        if (ev === 'end') fn()
      },
    }
    const res = {
      statusCode: 200,
      setHeader: (k, v) => { resHeaders[String(k).toLowerCase()] = String(v) },
      end: (chunk) => {
        resStatus = res.statusCode
        if (chunk !== undefined && chunk !== null) {
          resChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8'))
        }
      },
    }
    await entry.handler(req, res)
    const buf = Buffer.concat(resChunks)
    return { status: resStatus, headers: resHeaders, buffer: buf, text: buf.toString('utf8') }
  }

  // Guard 403 check
  rejectCode = 403
  const blockedRes = await invoke('/api/dsh-chief/chief/fact', { body: { op: 'tts.status' } })
  assert.equal(blockedRes.status, 403, 'T5 tts route must enforce same-origin guard 403')
  rejectCode = 0

  // Save custom secret key via /chief/config on plain unactivated session
  const customSecret = 'sk-custom-tts-never-expose-123456'
  const cfgSaveRes = await invoke('/api/dsh-chief/chief/config', {
    body: {
      session: sidPlain,
      tts: {
        enabled: true,
        provider: 'deepseek',
        voiceId: 'stella',
        baseUrl,
        apiKey: customSecret,
        autoSpeakAlerts: true,
      },
    },
  })
  assert.equal(cfgSaveRes.status, 200)
  const cfgJson = JSON.parse(cfgSaveRes.text)
  assert.equal(cfgJson.config.tts.apiKey, '', 'T5 /chief/config must redact tts.apiKey')
  assert.equal(cfgJson.config.tts.hasApiKey, true, 'T5 /chief/config must report hasApiKey=true')
  assert.equal(chiefStateMod.isChiefSessionEnabled(chiefStateMod.loadChiefState(), sidPlain), false, 'T6 changing TTS config must NOT activate plain session')

  // Check /snapshot and /chief/view redaction
  const snapRes = await invoke('/api/dsh-chief/snapshot', { method: 'GET', query: `?session=${sidPlain}` })
  const snapJson = JSON.parse(snapRes.text)
  assert.equal(snapJson.chiefMeta.tts.apiKey, '', 'T5 /snapshot must redact tts.apiKey')
  assert.equal(snapJson.chiefMeta.tts.hasApiKey, true, 'T5 /snapshot must expose hasApiKey=true')
  assert.equal(snapRes.text.includes(customSecret), false, 'T5 /snapshot must not contain plaintext TTS apiKey')

  const viewRes = await invoke('/api/dsh-chief/chief/view', { method: 'GET', query: `?session=${sidPlain}` })
  const viewJson = JSON.parse(viewRes.text)
  assert.equal(viewJson.config.tts.apiKey, '', 'T5 /chief/view must redact tts.apiKey')
  assert.equal(viewRes.text.includes(customSecret), false, 'T5 /chief/view must not contain plaintext TTS apiKey')

  // Check 0-byte @lead isolation on systemPrompt
  assert.ok(registeredSystemPrompt && typeof registeredSystemPrompt.text === 'function', 'T6 systemPrompt.section must register text fn')
  const promptResult = await registeredSystemPrompt.text({ agent: fakeAgentPlain, session: fakeAgentPlain.session })
  assert.equal(Boolean(promptResult), false, 'T6 plain session with TTS enabled must inject 0 bytes into @lead systemPrompt')

  // Check tts.status, tts.probe, tts.synthesize (binary & JSON)
  const stRouteRes = await invoke('/api/dsh-chief/chief/fact', { body: { session: sidPlain, op: 'tts.status' } })
  assert.equal(stRouteRes.status, 200)
  assert.equal(stRouteRes.text.includes(customSecret), false, 'T5 tts.status must redact apiKey')

  const probeRes = await invoke('/api/dsh-chief/chief/fact', { body: { session: sidPlain, op: 'tts.probe' } })
  assert.equal(probeRes.status, 200)
  const probeJson = JSON.parse(probeRes.text)
  assert.equal(probeJson.ok, true, 'T5 tts.probe must return ok=true')
  assert.ok(typeof probeJson.audioBase64 === 'string' && probeJson.audioBase64.length > 10, 'T5 tts.probe must return audioBase64')

  const binRes = await invoke('/api/dsh-chief/chief/fact', {
    headers: { accept: 'audio/*, application/json' },
    body: { session: sidPlain, op: 'tts.synthesize', text: '二进制流直出验证', binary: true },
  })
  assert.equal(binRes.status, 200)
  assert.equal(binRes.headers['content-type'], 'audio/wav', 'T5 binary mode must return audio/wav content-type')
  assert.equal(binRes.buffer.slice(0, 4).toString('ascii'), 'RIFF', 'T5 binary response must be valid RIFF audio')
  assert.equal(chiefStateMod.isChiefSessionEnabled(chiefStateMod.loadChiefState(), sidPlain), false, 'T6 calling tts.* must NOT activate plain session')
  console.log('[T5 & T6 PASS] HTTP guard 403, binary/JSON streaming, redaction & 0-byte @lead isolation verified')

  // =========================================================================
  // T7: Error handling (missing key, HTTP 401 redaction, timeout, empty text)
  // =========================================================================
  const emptyRuntime = { get: () => null }
  const missingKeyErr = await ttsMod.synthesizeChiefSpeech(emptyRuntime, {
    provider: 'deepseek',
    baseUrl,
  }, { text: '缺少密钥测试' })
  assert.equal(missingKeyErr.ok, false)
  assert.equal(missingKeyErr.code, 'MISSING_API_KEY')
  assert.equal(missingKeyErr.canFallbackBrowser, true)

  dsMode = 'unauth'
  const LEAK_TEST_KEY = 'sk-leak-probe-abcdefg123456'
  const unauthErr = await ttsMod.synthesizeChiefSpeech(emptyRuntime, {
    provider: 'deepseek',
    baseUrl,
    apiKey: LEAK_TEST_KEY,
  }, { text: '401 脱敏测试' })
  assert.equal(unauthErr.ok, false)
  assert.equal(unauthErr.code, 'UPSTREAM_ERROR')
  assert.equal(String(unauthErr.error).includes(LEAK_TEST_KEY), false, 'T7 error message must never leak apiKey')

  dsMode = 'slow'
  const timeoutErr = await ttsMod.synthesizeChiefSpeech(emptyRuntime, {
    provider: 'deepseek',
    baseUrl,
    apiKey: LEAK_TEST_KEY,
    timeoutMs: 5000,
  }, { text: '超时熔断测试' })
  assert.equal(timeoutErr.ok, false)
  assert.equal(timeoutErr.code, 'TIMEOUT')
  assert.equal(timeoutErr.canFallbackBrowser, true)
  dsMode = 'ok'

  const emptyErr = await ttsMod.synthesizeChiefSpeech(emptyRuntime, { provider: 'deepseek', apiKey: 'sk-x' }, { text: '```js\n1\n```' })
  assert.equal(emptyErr.ok, false)
  assert.equal(emptyErr.code, 'EMPTY_TEXT')
  console.log('[T7 PASS] Missing key, 401 key redaction, timeout & empty-text handling verified')

  // =========================================================================
  // T8: Frontend src/client/tts.js Node direct import & baseline suppression
  // =========================================================================
  const prevWin = globalThis.window
  const prevDoc = globalThis.document
  const prevLs = globalThis.localStorage
  globalThis.window = { location: { href: 'http://127.0.0.1/', search: '' }, addEventListener: () => {}, removeEventListener: () => {} }
  globalThis.document = { addEventListener: () => {}, removeEventListener: () => {}, querySelector: () => null, body: {} }
  globalThis.localStorage = { getItem: () => null, setItem: () => {} }
  try {
    const clientTtsMod = await import(modUrl('src/client/tts.js'))
    const storeModClient = await import(modUrl('src/client/store.js'))
    const cleaned = clientTtsMod.cleanClientTextForSpeech('**你好** `sk-secretvalue123456789` [文档](https://a.b)', 'brief')
    assert.equal(cleaned.includes('sk-secretvalue123456789'), false, 'T8 client cleaner must scrub secrets')
    assert.equal(cleaned.includes('**'), false, 'T8 client cleaner must strip markdown')

    clientTtsMod.resetTtsSessionBaselines()
    storeModClient.patch({
      chiefMeta: {
        ...storeModClient.store.chiefMeta,
        tts: { ...stateMod.DEFAULT_TTS_CONFIG, enabled: true, autoSpeakReplies: true, provider: 'browser' },
      },
    })
    const initRes = clientTtsMod.maybeAutoSpeakIncomingChat([
      { id: 'c-old-1', role: 'chief', kind: 'answer', text: '旧消息不重播' },
    ], 'sess-client-tts-1')
    assert.equal(initRes.initialized, true, 'T8 first session load must initialize baseline silently')
    assert.equal(initRes.spoken, false, 'T8 baseline must not replay old messages')

    const followRes = clientTtsMod.maybeAutoSpeakIncomingChat([
      { id: 'c-old-1', role: 'chief', kind: 'answer', text: '旧消息不重播' },
      { id: 'c-new-2', role: 'chief', kind: 'answer', text: '新的一条参谋回复' },
    ], 'sess-client-tts-1')
    assert.equal(followRes.spoken, true, 'T8 new chief reply after baseline must trigger auto-speak')
    assert.equal(followRes.itemId, 'c-new-2')

    clientTtsMod.stopChiefSpeech()
    assert.equal(storeModClient.store.ttsPlayer.status, 'idle', 'T8 stopChiefSpeech must reset ttsPlayer to idle')
  } finally {
    if (prevWin === undefined) delete globalThis.window
    else globalThis.window = prevWin
    if (prevDoc === undefined) delete globalThis.document
    else globalThis.document = prevDoc
    if (prevLs === undefined) delete globalThis.localStorage
    else globalThis.localStorage = prevLs
  }
  console.log('[T8 PASS] Frontend src/client/tts.js Node import, baseline suppression & state reset verified')

  // =========================================================================
  // T9: DSH Official Account credential auto-reuse (`x-dsh-auth-token`, no rejectToken)
  // =========================================================================
  const DSH_GRANT_SECRET = 'dsh_grant_secret_token_alpha99'
  let rejectCalled = false
  const accountRuntime = {
    get(name) {
      if (name === 'deepseekAccount') {
        return {
          async resolveToken(url) {
            return String(url).startsWith('https://api.deepseek.com') ? DSH_GRANT_SECRET : undefined
          },
          rejectToken() {
            rejectCalled = true
          },
        }
      }
      if (name === 'credentials') {
        return {
          async describe() { return { configured: false, source: 'none' } },
          async describeRecord(k) { return { exists: k === 'deepseek-account-platform/default' } },
          async readRecord() { return null },
          async resolve() { return '' },
        }
      }
      return undefined
    },
  }
  const acctStatus = await ttsMod.getChiefTtsStatus(accountRuntime, { provider: 'deepseek' })
  assert.equal(acctStatus.hostDeepSeek.configured, true)
  assert.equal(acctStatus.hostDeepSeek.authMode, 'dsh-account')
  assert.equal(acctStatus.hostDeepSeek.accountSignedIn, true)
  assert.equal(JSON.stringify(acctStatus).includes(DSH_GRANT_SECRET), false, 'T9 status must never leak account grant token')

  let seenAccountHeaders = null
  const mockFetchAcct = async (_url, init) => {
    seenAccountHeaders = init && init.headers ? { ...init.headers } : {}
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'audio/wav' },
      async arrayBuffer() { return fakeWav },
    }
  }
  const acctTtsOut = await ttsMod.synthesizeChiefSpeech(accountRuntime, { provider: 'deepseek' }, {
    text: '官方登录免密播报验证',
    fetchImpl: mockFetchAcct,
  })
  assert.equal(acctTtsOut.ok, true)
  assert.equal(seenAccountHeaders['x-dsh-auth-token'], DSH_GRANT_SECRET)
  assert.equal(seenAccountHeaders.authorization, undefined, 'T9 grant auth must not send Bearer header')

  const mockFetch401 = async () => ({
    ok: false,
    status: 401,
    headers: { get: () => 'application/json' },
    async text() { return `Bad grant ${DSH_GRANT_SECRET}` },
  })
  const acct401 = await ttsMod.synthesizeChiefSpeech(accountRuntime, { provider: 'deepseek' }, {
    text: '触发401也不注销登录',
    fetchImpl: mockFetch401,
  })
  assert.equal(acct401.ok, false)
  assert.equal(rejectCalled, false, 'T9 must NEVER call rejectToken on 401')
  assert.equal(String(acct401.error).includes(DSH_GRANT_SECRET), false, 'T9 401 error must redact grant token')

  const fallbackRecordRuntime = {
    get(name) {
      if (name === 'credentials') {
        return {
          async describe() { return { configured: false, source: 'none' } },
          async describeRecord() { return { exists: true } },
          async readRecord(k) {
            if (k !== 'deepseek-account-platform/default') return null
            return {
              kind: 'grant',
              payload: {
                token: 'dsh_record_fallback_tok_5566',
                issuer: 'https://platform.deepseek.com',
              },
            }
          },
          async resolve() { return '' },
        }
      }
      return undefined
    },
  }
  let fallbackSeenTok = ''
  const fbOut = await ttsMod.synthesizeChiefSpeech(fallbackRecordRuntime, { provider: 'deepseek' }, {
    text: 'credentials readRecord 回退验证',
    fetchImpl: async (_url, init) => {
      fallbackSeenTok = init?.headers?.['x-dsh-auth-token'] || ''
      return { ok: true, status: 200, headers: { get: () => 'audio/wav' }, async arrayBuffer() { return fakeWav } }
    },
  })
  assert.equal(fbOut.ok, true)
  assert.equal(fallbackSeenTok, 'dsh_record_fallback_tok_5566')

  // Priority & 401 retry when both signed-in DSH account and stale env key exist
  let retryHeadersSeen = []
  const dualCredRuntime = {
    get(name) {
      if (name === 'deepseekAccount') {
        return {
          async resolveToken() { return DSH_GRANT_SECRET },
          rejectToken() { rejectCalled = true },
        }
      }
      if (name === 'credentials') {
        return {
          async describe() { return { configured: true, source: 'env' } },
          async resolve(ref) { return ref === 'DEEPSEEK_API_KEY' ? { value: 'sk-stale-env-shadow-123456', source: 'env' } : null },
        }
      }
      return undefined
    },
  }
  const dualStatus = await ttsMod.getChiefTtsStatus(dualCredRuntime, { provider: 'deepseek' })
  assert.equal(dualStatus.hostDeepSeek.authMode, 'dsh-account', 'T9 signed-in DSH account must take priority over env key')
  const dualRetryOut = await ttsMod.synthesizeChiefSpeech(dualCredRuntime, { provider: 'deepseek' }, {
    text: '双凭据401回退验证',
    fetchImpl: async (_url, init) => {
      retryHeadersSeen.push({ ...(init?.headers || {}) })
      if (retryHeadersSeen.length === 1) {
        return { ok: false, status: 401, headers: { get: () => 'application/json' }, async text() { return 'first failed' } }
      }
      return { ok: true, status: 200, headers: { get: () => 'audio/wav' }, async arrayBuffer() { return fakeWav } }
    },
  })
  assert.equal(dualRetryOut.ok, true)
  assert.equal(retryHeadersSeen.length, 2, 'T9 must retry once with secondary credential on 401')
  assert.equal(retryHeadersSeen[0]['x-dsh-auth-token'], DSH_GRANT_SECRET)
  assert.equal(retryHeadersSeen[1].authorization, 'Bearer sk-stale-env-shadow-123456')
  assert.equal(rejectCalled, false)
  console.log('[T9 PASS] DSH Official Account priority (`x-dsh-auth-token`), readRecord fallback, 401 retry & non-eviction verified')

  // =========================================================================
  // T10: Dual-path STT (`speechToText` SenseVoice + DeepSeek `/v1/tools/asr`)
  // =========================================================================
  const localSttWav = makeFakeWavBuffer(320)
  let capturedSpeechAudioLen = 0
  const sttLocalRuntime = {
    get(name) {
      if (name === 'speechToText') {
        return {
          listProviders: () => [{ id: 'sensevoice', preparation: { phase: 'ready' } }],
          snapshot: () => ({ providers: [{ id: 'sensevoice', preparation: { phase: 'ready' } }] }),
          resolve: ({ audio }) => ({ providerId: 'sensevoice', audio }),
          async transcribe(spec) {
            capturedSpeechAudioLen = spec.audio ? spec.audio.length : 0
            return { text: '本地 SenseVoice 识别到：今天先跑回归测试' }
          },
        }
      }
      return undefined
    },
  }
  const localSttRes = await ttsMod.transcribeChiefAudio(sttLocalRuntime, { provider: 'deepseek' }, {
    audioBase64: localSttWav.toString('base64'),
  })
  assert.equal(localSttRes.ok, true)
  assert.equal(localSttRes.provider, 'dsh-local')
  assert.equal(capturedSpeechAudioLen, localSttWav.length)
  assert.match(localSttRes.text, /SenseVoice/)

  const cloudAsrRes = await ttsMod.transcribeChiefAudio(emptyRuntime, {
    provider: 'deepseek',
    baseUrl,
    apiKey: 'sk-asr-test-12345',
  }, {
    audioBase64: localSttWav.toString('base64'),
    prefer: 'cloud',
  })
  assert.equal(cloudAsrRes.ok, true, `T10 cloud ASR failed: ${cloudAsrRes.error || ''}`)
  assert.equal(cloudAsrRes.provider, 'deepseek-asr')
  assert.match(cloudAsrRes.text, /请求编号/)
  console.log('[T10 PASS] Dual-path STT (DSH SenseVoice local + DeepSeek /v1/tools/asr FormData) verified')

  // =========================================================================
  // T11: Voice Mode `voiceChat: true` -> effortOverride 'off', zero tools, voice-inbox reply attach
  // =========================================================================
  const voiceInboxIso = path.join(tmpRoot, 'voice-inbox-iso')
  const memoryIso = path.join(tmpRoot, 'memory-iso')
  fs.mkdirSync(voiceInboxIso, { recursive: true })
  fs.mkdirSync(memoryIso, { recursive: true })

  const voiceInboxMod = await import(modUrl('voice-inbox.js'))
  const cmdMod = await import(modUrl('chief-commands.js'))
  const archivesMod = await import(modUrl('chief-archives.js'))

  const vcRec = voiceInboxMod.appendVoiceTranscript({
    text: '参谋长，帮我口头过一下今天是不是只要专心修完语音模式就行？',
    mode: 'voice_chat',
    provider: 'dsh-local',
    sessionId: 'sess-voice-chat-1',
    durationMs: 1850,
    customDir: voiceInboxIso,
  })
  assert.equal(vcRec.ok, true)

  const capturedLlmCalls = []
  let leadDeliveredCount = 0
  const askDeps = {
    ...bus,
    runtime: {
      get(name) {
        if (name === 'agents') {
          return {
            get() { return null },
            sendMessage() { leadDeliveredCount += 1; return true },
          }
        }
        return undefined
      },
    },
    async callLlmOverride(opts) {
      capturedLlmCalls.push(opts)
      return {
        ok: true,
        text: JSON.stringify({ reply: '对，今天就把语音输入、语音聊天和梦境整理三件事打通就稳了。' }),
        thinkingEffort: 'off',
        thinkingEffortMode: 'off',
      }
    },
  }
  const vcAskOut = await cmdMod.askOrCommandChief(askDeps, {
    sessionId: 'sess-voice-chat-1',
    text: '参谋长，帮我口头过一下今天是不是只要专心修完语音模式就行？',
    voiceChat: true,
    voiceTranscriptId: vcRec.id,
    voiceInboxCustomDir: voiceInboxIso,
  })
  assert.equal(vcAskOut.ok, true)
  assert.ok(capturedLlmCalls.length >= 1)
  assert.equal(capturedLlmCalls[0].reasonKind, 'voice_chat')
  assert.equal(capturedLlmCalls[0].desiredEffort, 'off')
  const modelsMod = await import(modUrl('chief-models.js'))
  assert.equal(modelsMod.decideAdaptiveChiefEffort({ reasonKind: 'voice_chat', userText: '随便聊聊' }), 'off')
  assert.match(String(capturedLlmCalls[0].system || ''), /语音聊天模式/)
  assert.equal(leadDeliveredCount, 0, 'T11 voice_chat must not send anything to @lead')

  const vcFileText = fs.readFileSync(vcRec.filePath, 'utf8')
  assert.match(vcFileText, /## 参谋长口语回复/)
  assert.match(vcFileText, /三件事打通就稳了/)

  const voicePushInboxIso = path.join(tmpRoot, 'voice-inbox-push-iso')
  fs.mkdirSync(voicePushInboxIso, { recursive: true })
  const vcStateMod = await import(modUrl('chief-state.js'))
  let pushDeliveredCount = 0
  vcStateMod.updateChiefConfig({ sessionId: 'sess-voice-push-1', permissionMode: 'assistant' })
  const vcPushL1Out = await cmdMod.askOrCommandChief({
    ...askDeps,
    appendBoardLog() {},
    runtime: {
      get(name) {
        if (name === 'agents') {
          return {
            get() { return null },
            sendMessage() { pushDeliveredCount += 1; return true },
          }
        }
        return undefined
      },
    },
    async callLlmOverride() {
      return {
        ok: true,
        text: '好嘞，已经替你催主对话继续开工啦——让它接着推进第一步！',
        thinkingEffort: 'off',
        thinkingEffortMode: 'off',
      }
    },
  }, {
    sessionId: 'sess-voice-push-1',
    text: '现在主会话暂停了，你帮我 push 一下主对话继续干活',
    voiceChat: true,
    voiceInboxCustomDir: voicePushInboxIso,
  })
  assert.equal(vcPushL1Out.ok, true)
  assert.equal(pushDeliveredCount, 0, 'T11b L1 push must NOT deliver directly before elevation approval')
  assert.equal(vcPushL1Out.elevationRequested && vcPushL1Out.elevationRequested.targetMode, 'strategist', 'T11b L1 push must trigger L2 strategist elevation modal')
  assert.equal(String(vcPushL1Out.reply || '').includes('已经替你催主对话'), false, 'T11b L1 push must rewrite false lip-service claim')
  assert.match(String(vcPushL1Out.reply || ''), /提权/, 'T11b L1 push reply must honestly state elevation confirmation needed')

  vcStateMod.updateChiefConfig({ sessionId: 'sess-voice-push-3', permissionMode: 'chief', confirmedChiefRisk: true })
  const vcPushL3Out = await cmdMod.askOrCommandChief({
    ...askDeps,
    appendBoardLog() {},
    runtime: {
      get(name) {
        if (name === 'sessions') {
          return { get: (id) => (id === 'sess-voice-push-3' ? { id, seq: 3, status: 'idle', blank: false } : null) }
        }
        if (name === 'agents') {
          return {
            get: (id) => (id === 'sess-voice-push-3'
              ? {
                  id,
                  status: 'idle',
                  followup() { pushDeliveredCount += 1; return true },
                }
              : null),
            sendMessage() { pushDeliveredCount += 1; return true },
          }
        }
        return undefined
      },
    },
    async callLlmOverride() {
      return {
        ok: true,
        text: JSON.stringify({
          reply: '好嘞，已经替你催主对话继续推进了。',
          relays: [],
        }),
        thinkingEffort: 'off',
        thinkingEffortMode: 'off',
      }
    },
  }, {
    sessionId: 'sess-voice-push-3',
    text: '现在主会话暂停了，你。准，备push他一下。',
    voiceChat: true,
    voiceInboxCustomDir: voicePushInboxIso,
  })
  assert.equal(vcPushL3Out.ok, true)
  assert.equal(pushDeliveredCount, 1, 'T11c L3 Voice Mode push must physically execute deliverCrossMessage to @lead even when model omits relays')
  assert.ok(Array.isArray(vcPushL3Out.relays) && vcPushL3Out.relays.length >= 1 && vcPushL3Out.relays[0].ok, 'T11c L3 Voice Mode push must report real relay delivery')

  console.log('[T11 PASS] Voice Mode zero-thinking chat, reply attachment, L1 elevation & L3 real relay execution verified')

  // =========================================================================
  // T12: Dream Roam auto-digests voice-inbox -> Memory / Profile / Diary / Archives
  // =========================================================================
  const dictRec = voiceInboxMod.appendVoiceTranscript({
    text: '记住我的工程习惯：以后所有后端接口返回都要带 requestId，绝不硬编码密钥 sk-inbox-leak-99887766。',
    mode: 'dictation',
    provider: 'deepseek-asr',
    sessionId: 'sess-voice-chat-1',
    durationMs: 2400,
    customDir: voiceInboxIso,
  })
  assert.equal(dictRec.ok, true)
  const dictDiskContent = fs.readFileSync(dictRec.filePath, 'utf8')
  assert.equal(dictDiskContent.includes('sk-inbox-leak-99887766'), false, 'T12 voice-inbox must redact secrets before saving .md')

  const roamRes = await archivesMod.runManagedDreamRoam({
    ...bus,
    runtime: askDeps.runtime,
    offlineHeuristicOnly: true,
  }, {
    sessionId: 'sess-voice-chat-1',
    voiceInboxCustomDir: voiceInboxIso,
    memoryCustomDir: memoryIso,
  })
  assert.equal(roamRes.ok, true)
  assert.equal(roamRes.voiceProcessed, 2, 'T12 Dream Roam must process both pending voice transcripts')
  assert.equal(leadDeliveredCount, 0, 'T12 Dream Roam must keep 0-byte isolation from @lead')

  const afterInbox = voiceInboxMod.listVoiceTranscripts({ customDir: voiceInboxIso })
  assert.equal(afterInbox.pendingCount, 0)
  assert.equal(afterInbox.processedCount, 2)
  assert.ok(fs.existsSync(path.join(voiceInboxIso, 'processed', dictRec.fileName)))
  assert.match(fs.readFileSync(path.join(voiceInboxIso, 'processed', dictRec.fileName), 'utf8'), /## 梦境整理回执/)
  assert.ok(fs.existsSync(path.join(memoryIso, 'MEMORY.md')) || fs.existsSync(path.join(memoryIso, 'DIARY.md')), 'T12 Dream Roam must write memory artifacts')
  console.log('[T12 PASS] Voice Inbox secret redaction, Dream Roam digestion & processed archival verified')

  // =========================================================================
  // T13: Frontend src/client/voice-recorder.js WAV encoding & Node import
  // =========================================================================
  const vrMod = await import(modUrl('src/client/voice-recorder.js'))
  const pcm16 = vrMod.voiceRecFloatToPcm16(new Float32Array([0, 0.5, -0.5, 1, -1]))
  assert.equal(pcm16.length, 5)
  const wav16k = vrMod.voiceRecEncodeWave(pcm16, 16000)
  assert.equal(wav16k.length, 44 + 10)
  assert.equal(Buffer.from(wav16k.slice(0, 4)).toString('ascii'), 'RIFF')
  assert.equal(Buffer.from(wav16k.slice(8, 12)).toString('ascii'), 'WAVE')
  const view16 = new DataView(wav16k.buffer, wav16k.byteOffset, wav16k.byteLength)
  assert.equal(view16.getUint16(22, true), 1, 'T13 mono channel')
  assert.equal(view16.getUint32(24, true), 16000, 'T13 16kHz sample rate')
  assert.equal(view16.getUint16(34, true), 16, 'T13 16-bit PCM')
  const dsArr = vrMod.downsampleFloat32(new Float32Array(4800), 48000, 16000)
  assert.equal(dsArr.length, 1600)
  const w1 = vrMod.matchChiefWakeCall('哈基米', ['哈基米'])
  assert.equal(w1.matched, true)
  assert.equal(w1.isGreetingOnly, true)
  const w2 = vrMod.matchChiefWakeCall('参谋长，帮我看看当前任务', ['哈基米'])
  assert.equal(w2.matched, true)
  assert.equal(w2.isGreetingOnly, false)
  assert.equal(w2.remainder, '帮我看看当前任务')
  const w3 = vrMod.matchChiefWakeCall('帮我改一下参谋长的样式', ['哈基米'])
  assert.equal(w3.matched, false)
  const w4 = vrMod.matchChiefWakeCall('嗯那个结米尼，帮我push一下主对话', ['杰米尼'], { allowAnywhere: true })
  assert.equal(w4.matched, true)
  assert.equal(w4.isGreetingOnly, false)
  assert.equal(w4.remainder, '帮我push一下主对话')
  const w5 = vrMod.matchChiefWakeCall('喂，参谋长。', ['哈基米'], { allowAnywhere: true })
  assert.equal(w5.matched, true)
  assert.equal(w5.isGreetingOnly, true)
  console.log('[T13 PASS] Frontend voice-recorder.js Node ESM import, resampling, 16kHz WAV header & wake-call matcher verified')

  console.log('\nALL V1.9.0 VOICE CHIEF TTS + VOICE MODE GATES PASSED (T1–T13)')
} finally {
  if (prevDsKey === undefined) delete process.env.DEEPSEEK_API_KEY
  else process.env.DEEPSEEK_API_KEY = prevDsKey
  if (prevDsBase === undefined) delete process.env.DEEPSEEK_BASE_URL
  else process.env.DEEPSEEK_BASE_URL = prevDsBase
  server.close()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
}
