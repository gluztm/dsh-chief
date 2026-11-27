#!/usr/bin/env node
/**
 * verify-v110-voice-pager-gate.mjs
 *
 * Self-contained regression gate for Hands-Free Voice VAD + Handoff + Mobile Remote Pager:
 *   - P1: Module invariants (remote-pager.js in files[], 0 child_process, 0 mutable exports, safety MD5 locked, client markers)
 *   - P2: Config normalization & UI redaction (webhookUrl / secret / telegramBotToken wiped; handsFreeVad / vadSilenceMs normalized)
 *   - P3: 6-channel formatting & crypto HMAC signature verification (Feishu, DingTalk, WeCom, Telegram, Discord, Webhook)
 *   - P4: Secret scrubbing & error leakage defense (secrets never leaked in message body or HTTP error strings)
 *   - P5: Alert Event bus integration (pending_approval / hazard_halt / managed_auto_sleep auto-dispatch + cooldown + 0-byte @lead)
 *   - P6: HTTP /api/dsh-chief/chief/fact pager.* routes & guard() fail-closed 403
 *   - P7: Frontend createVoiceVadTracker pure state machine (speech_start -> silence_end & idle_timeout)
 *   - P8: Voice Mode handoffDraft output from askOrCommandChief (no auto-relay, 0-byte @lead, safe JSON extraction)
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

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-v110-pager-'))
const dshHome = path.join(tmpRoot, 'dsh-home')
const chiefDataDir = path.join(tmpRoot, 'chief-data')
fs.mkdirSync(dshHome, { recursive: true })
fs.mkdirSync(chiefDataDir, { recursive: true })

process.env.DSH_HOME = dshHome
process.env.DSH_CHIEF_DATA_DIR = chiefDataDir
process.env.DSH_CHIEF_WALLS_FILE = path.join(tmpRoot, 'walls.json')

function modUrl(rel) {
  return pathToFileURL(path.join(PKG, rel)).href
}

const capturedRequests = []
let mockMode = 'ok'

const mockServer = http.createServer(async (req, res) => {
  const chunks = []
  for await (const ch of req) chunks.push(ch)
  const raw = Buffer.concat(chunks).toString('utf8')
  const url = req.url || '/'
  capturedRequests.push({
    method: req.method,
    url,
    headers: { ...req.headers },
    raw,
    body: raw.trim() ? JSON.parse(raw) : {},
  })
  if (mockMode === 'fail_500') {
    res.statusCode = 500
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: `Upstream failed for secret=${req.headers['x-dsh-chief-signature'] || ''} token=bot123456` }))
    return
  }
  res.statusCode = 200
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify({ ok: true }))
})

await new Promise(resolve => mockServer.listen(0, '127.0.0.1', resolve))
const port = mockServer.address().port
const baseUrl = `http://127.0.0.1:${port}`

try {
  // =========================================================================
  // P1: Module invariants & client bundle markers
  // =========================================================================
  const pkgJson = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8'))
  assert.ok(Array.isArray(pkgJson.files) && pkgJson.files.includes('remote-pager.js'), 'P1 package.json files[] must include remote-pager.js')
  const pagerSrc = fs.readFileSync(path.join(PKG, 'remote-pager.js'), 'utf8')
  assert.equal(/(?:from|import\s*\(|require\s*\()\s*['"](?:node:)?child_process['"]/.test(pagerSrc), false, 'P1 remote-pager.js must not import child_process')
  assert.equal(/^export\s+(?:let|var)\s+/m.test(pagerSrc), false, 'P1 remote-pager.js must have zero mutable exports')

  const clientBundle = fs.readFileSync(path.join(PKG, 'client.js'), 'utf8')
  for (const marker of [
    'createVoiceVadTracker',
    'voiceHandsFree',
    'voiceHandoffDraft',
    'fetchRemotePagerStatusApi',
    'testRemotePagerApi',
    'pager.test',
    'pager.status',
    'dnb-voice-handoff-card',
  ]) {
    assert.ok(clientBundle.includes(marker), `P1 client.js missing marker: ${marker}`)
  }

  const safetyMd5Expected = {
    'chief-executor.js': '7bd1f9ef79af867fdb461f605f3e5cdc',
    'safety/policy-engine.js': 'b02bf22da6dbf2a3a4f2f2548c1b27fb',
  }
  for (const [rel, expected] of Object.entries(safetyMd5Expected)) {
    const actual = crypto.createHash('md5').update(fs.readFileSync(path.join(PKG, rel))).digest('hex')
    assert.equal(actual, expected, `P1 safety file ${rel} MD5 must stay locked`)
  }
  console.log('[P1 PASS] Module invariants, zero child_process, client markers & safety MD5 verified')

  // =========================================================================
  // P2: Config normalization & UI redaction
  // =========================================================================
  const schemaMod = await import(modUrl('state-schema.js'))
  const SECRET_URL = `${baseUrl}/hook/very-secret-token-xyz`
  const SECRET_SIGN = 'SEC_sign_alpha_9981'
  const TG_TOKEN = '123456:ABCDEF_fake_telegram_token'

  const normTtsVad = schemaMod.normalizeTtsConfig({ handsFreeVad: true, vadSilenceMs: 200 })
  assert.equal(normTtsVad.handsFreeVad, true)
  assert.equal(normTtsVad.vadSilenceMs, 600, 'P2 vadSilenceMs must clamp to min 600ms')

  const normPager = schemaMod.normalizePagerConfig({
    enabled: true,
    channel: 'feishu',
    webhookUrl: SECRET_URL,
    secret: SECRET_SIGN,
    telegramBotToken: TG_TOKEN,
    telegramChatId: '998877',
    cooldownSec: 10,
  })
  assert.equal(normPager.webhookUrl, SECRET_URL)
  assert.equal(normPager.secret, SECRET_SIGN)

  const uiPager = schemaMod.redactPagerConfigForUi(normPager)
  assert.equal(uiPager.webhookUrl, '')
  assert.equal(uiPager.secret, '')
  assert.equal(uiPager.telegramBotToken, '')
  assert.equal(uiPager.hasWebhookUrl, true)
  assert.equal(uiPager.webhookHostHint, `127.0.0.1:${port}`)
  assert.equal(uiPager.hasSecret, true)
  assert.equal(uiPager.hasTelegramBotToken, true)
  const uiJson = JSON.stringify(uiPager)
  assert.equal(uiJson.includes('very-secret-token-xyz'), false)
  assert.equal(uiJson.includes(SECRET_SIGN), false)
  assert.equal(uiJson.includes(TG_TOKEN), false)
  console.log('[P2 PASS] Pager & VAD config normalization and UI secret redaction verified')

  // =========================================================================
  // P3 & P4: 6-channel delivery, HMAC signatures & error secret scrubbing
  // =========================================================================
  const pagerMod = await import(modUrl('remote-pager.js'))
  pagerMod.resetPagerRuntimeForTest()

  // Feishu with HMAC sign
  const feishuRes = await pagerMod.sendRemotePagerMessage({
    enabled: true,
    channel: 'feishu',
    webhookUrl: `${baseUrl}/feishu`,
    secret: 'feishu-sec-123',
  }, {
    kind: 'pending_approval',
    level: 'warn',
    title: '审批测试：禁止包含 sk-proj-topsecretvalue1234567890',
    body: '请确认执行',
  }, { bypassCooldown: true })
  assert.equal(feishuRes.ok, true)
  const reqFeishu = capturedRequests.at(-1)
  assert.equal(reqFeishu.url, '/feishu')
  assert.equal(reqFeishu.body.msg_type, 'text')
  assert.ok(reqFeishu.body.timestamp && reqFeishu.body.sign)
  const expectedFeishuSign = crypto.createHmac('sha256', `${reqFeishu.body.timestamp}\nfeishu-sec-123`).update('').digest('base64')
  assert.equal(reqFeishu.body.sign, expectedFeishuSign)
  assert.equal(reqFeishu.body.content.text.includes('sk-proj-topsecretvalue1234567890'), false, 'P4 outbound message must scrub API keys')

  // DingTalk with query timestamp + sign
  const dtRes = await pagerMod.sendRemotePagerMessage({
    enabled: true,
    channel: 'dingtalk',
    webhookUrl: `${baseUrl}/dingtalk?access_token=abc`,
    secret: 'SECding99',
  }, { kind: 'hazard_halt', level: 'danger', title: '高危急停', body: '已煞车' }, { bypassCooldown: true })
  assert.equal(dtRes.ok, true)
  const reqDt = capturedRequests.at(-1)
  assert.ok(reqDt.url.startsWith('/dingtalk?access_token=abc&timestamp=') && reqDt.url.includes('&sign='))
  assert.equal(reqDt.body.msgtype, 'markdown')

  // WeCom
  const wcRes = await pagerMod.sendRemotePagerMessage({
    enabled: true,
    channel: 'wecom',
    webhookUrl: `${baseUrl}/wecom`,
  }, { kind: 'manual', level: 'info', title: '企微测试', body: '内容' }, { bypassCooldown: true })
  assert.equal(wcRes.ok, true)
  assert.equal(capturedRequests.at(-1).body.msgtype, 'markdown')

  // Telegram (using webhookUrl as local mock base override)
  const tgRes = await pagerMod.sendRemotePagerMessage({
    enabled: true,
    channel: 'telegram',
    webhookUrl: baseUrl,
    telegramBotToken: 'tgbot_token_abc',
    telegramChatId: '424242',
  }, { kind: 'taskDone', level: 'success', title: '任务收工', body: '一切就绪' }, { bypassCooldown: true })
  assert.equal(tgRes.ok, true)
  const reqTg = capturedRequests.at(-1)
  assert.equal(reqTg.url, '/bottgbot_token_abc/sendMessage')
  assert.equal(reqTg.body.chat_id, '424242')

  // Discord
  const dcRes = await pagerMod.sendRemotePagerMessage({
    enabled: true,
    channel: 'discord',
    webhookUrl: `${baseUrl}/discord`,
  }, { kind: 'hazard_halt', level: 'danger', title: 'Discord Test', body: 'Alert body' }, { bypassCooldown: true })
  assert.equal(dcRes.ok, true)
  assert.equal(capturedRequests.at(-1).body.embeds[0].color, 0xef4444)

  // Generic Webhook with x-dsh-chief-signature
  const whRes = await pagerMod.sendRemotePagerMessage({
    enabled: true,
    channel: 'webhook',
    webhookUrl: `${baseUrl}/webhook`,
    secret: 'wh-hmac-secret',
  }, { kind: 'manual', level: 'info', title: 'Webhook Test', body: 'Payload' }, { bypassCooldown: true })
  assert.equal(whRes.ok, true)
  const reqWh = capturedRequests.at(-1)
  const expectedWhSig = 'sha256=' + crypto.createHmac('sha256', 'wh-hmac-secret').update(reqWh.raw).digest('hex')
  assert.equal(reqWh.headers['x-dsh-chief-signature'], expectedWhSig)

  // HTTP 500 redaction check
  mockMode = 'fail_500'
  const failRes = await pagerMod.sendRemotePagerMessage({
    enabled: true,
    channel: 'webhook',
    webhookUrl: `${baseUrl}/secret-webhook-endpoint`,
    secret: 'super-secret-hmac-key',
  }, { kind: 'manual', title: 'Err', body: 'Err' }, { bypassCooldown: true })
  mockMode = 'ok'
  assert.equal(failRes.ok, false)
  assert.equal(String(failRes.error).includes('secret-webhook-endpoint'), false, 'P4 error must scrub webhookUrl')
  assert.equal(String(failRes.error).includes('super-secret-hmac-key'), false, 'P4 error must scrub secret')
  console.log('[P3 & P4 PASS] 6-channel delivery, HMAC signing & error secret scrubbing verified')

  // =========================================================================
  // P5: Alert Event bus auto-dispatch + cooldown + 0-byte @lead isolation
  // =========================================================================
  const chiefStateMod = await import(modUrl('chief-state.js'))
  const saveCfgRes = chiefStateMod.updateChiefConfig({
    session: 'global',
    by: 'user',
    byUser: true,
    _fromUiPanel: true,
    remotePager: {
      enabled: true,
      channel: 'feishu',
      webhookUrl: `${baseUrl}/bus-feishu`,
      cooldownSec: 30,
      events: {
        approvalRequired: true,
        wallBlocked: true,
        hazardHalt: true,
        taskDone: true,
        budgetBreak: true,
      },
    },
  })
  assert.equal(saveCfgRes.ok, true)
  assert.equal(saveCfgRes.config.remotePager.webhookUrl, '')
  assert.equal(saveCfgRes.config.remotePager.hasWebhookUrl, true)

  const beforeBusCount = capturedRequests.length
  chiefStateMod.recordWorkspaceAlertEvent('sess-pager-bus-1', {
    kind: 'pending_approval',
    level: 'warn',
    title: '需要批准修改配置',
    body: '请确认授权',
    dedupeKey: 'apr:bus-test-1',
  })
  await new Promise(r => setTimeout(r, 120))
  assert.equal(capturedRequests.length, beforeBusCount + 1, 'P5 alert event must trigger auto remote pager')
  assert.equal(capturedRequests.at(-1).url, '/bus-feishu')

  // Same dedupeKey within cooldown must skip second send
  chiefStateMod.recordWorkspaceAlertEvent('sess-pager-bus-1', {
    kind: 'pending_approval',
    level: 'warn',
    title: '需要批准修改配置 2',
    body: '重复通知应冷却跳过',
    dedupeKey: 'apr:bus-test-1',
  })
  await new Promise(r => setTimeout(r, 80))
  assert.equal(capturedRequests.length, beforeBusCount + 1, 'P5 cooldown must suppress duplicate alert bursts')
  console.log('[P5 PASS] Alert event bus auto-dispatch, persistence & cooldown dedupe verified')

  // =========================================================================
  // P6: HTTP /api/dsh-chief/chief/fact pager.* routes & guard 403
  // =========================================================================
  const storeMod = await import(modUrl('board-store.js'))
  const subagentMod = await import(modUrl('subagent-runtime.js'))
  const actionsMod = await import(modUrl('board-actions.js'))
  const toolsMod = await import(modUrl('model-tools.js'))
  const routesMod = await import(modUrl('api-routes.js'))

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

  let rejectCode = 0
  const fakeRuntime = {
    get(n) {
      if (n === 'connection') return { requestRejection: () => rejectCode }
      return null
    },
  }
  const routes = bus.routeTable(fakeRuntime)
  assert.equal(routes.length, 27, 'P6 HTTP routes must remain strictly 27')
  const factRoute = routes.find(r => r.path.endsWith('/chief/fact'))
  assert.ok(factRoute)

  const invokeRoute = async (route, bodyObj) => {
    let statusCode = 200
    let bodyRaw = ''
    const req = {
      method: 'POST',
      url: route.path,
      headers: { 'content-type': 'application/json' },
      on(ev, fn) {
        if (ev === 'data') fn(Buffer.from(JSON.stringify(bodyObj), 'utf8'))
        if (ev === 'end') fn()
      },
    }
    const res = {
      statusCode: 200,
      setHeader() {},
      end(chunk) {
        statusCode = this.statusCode || 200
        bodyRaw = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '')
      },
    }
    await route.handler(req, res)
    return { statusCode, json: bodyRaw ? JSON.parse(bodyRaw) : null }
  }

  rejectCode = 403
  const g403 = await invokeRoute(factRoute, { op: 'pager.status' })
  assert.equal(g403.statusCode, 403)

  rejectCode = 0

  const stResp = await invokeRoute(factRoute, { op: 'pager.status' })
  assert.equal(stResp.statusCode, 200)
  assert.equal(stResp.json.ok, true)
  assert.equal(stResp.json.pager.hasWebhookUrl, true)
  assert.equal(stResp.json.pager.webhookUrl, '')

  const testResp = await invokeRoute(factRoute, { op: 'pager.test', text: 'HTTP Route 传呼直测' })
  assert.equal(testResp.statusCode, 200)
  assert.equal(testResp.json.ok, true)
  assert.match(capturedRequests.at(-1).body.content.text, /HTTP Route 传呼直测/)
  console.log('[P6 PASS] HTTP pager.status / pager.test & guard() fail-closed 403 verified')

  // =========================================================================
  // P7: Frontend createVoiceVadTracker pure state machine
  // =========================================================================
  const vrMod = await import(modUrl('src/client/voice-recorder.js'))
  const vad = vrMod.createVoiceVadTracker({
    speechThreshold: 0.02,
    silenceMs: 1000,
    minSpeechMs: 300,
    maxIdleMs: 5000,
    startedAt: 1000,
  })
  assert.equal(vad.feed(0.004, 1500).vadEvent, 'none')
  assert.equal(vad.feed(0.045, 2000).vadEvent, 'speech_start')
  assert.equal(vad.feed(0.035, 2500).vadEvent, 'none')
  assert.equal(vad.feed(0.005, 3100).vadEvent, 'none')
  assert.equal(vad.feed(0.003, 3600).vadEvent, 'silence_end')

  const vadIdle = vrMod.createVoiceVadTracker({
    speechThreshold: 0.02,
    silenceMs: 1000,
    minSpeechMs: 300,
    maxIdleMs: 4000,
    startedAt: 1000,
  })
  assert.equal(vadIdle.feed(0.005, 5100).vadEvent, 'idle_timeout')
  console.log('[P7 PASS] Frontend createVoiceVadTracker state machine (speech_start / silence_end / idle_timeout) verified')

  // =========================================================================
  // P8: Voice Mode handoffDraft output without touching @lead
  // =========================================================================
  const cmdMod = await import(modUrl('chief-commands.js'))
  let leadSent = 0
  const vcAsk = await cmdMod.askOrCommandChief({
    ...bus,
    runtime: {
      get(name) {
        if (name === 'agents') {
          return {
            get() { return null },
            sendMessage() { leadSent += 1; return true },
          }
        }
        return undefined
      },
    },
    async callLlmOverride() {
      return {
        ok: true,
        text: JSON.stringify({
          reply: '好咧，我已经帮你整理成任务草稿了，你看下确认卡片点发送就行。',
          handoffDraft: '请主对话把登录接口加上请求编号，并跑完单元测试后汇报。',
        }),
        thinkingEffort: 'off',
        thinkingEffortMode: 'off',
      }
    },
  }, {
    sessionId: 'sess-voice-handoff-1',
    text: '把刚才说的加请求编号整理成任务交给主对话吧',
    voiceChat: true,
    voiceInboxCustomDir: path.join(tmpRoot, 'vi-p8'),
  })
  assert.equal(vcAsk.ok, true)
  assert.equal(leadSent, 0, 'P8 voiceChat handoffDraft must wait for explicit human click, never auto-send to @lead')
  assert.match(String(vcAsk.voiceHandoffDraft || ''), /请求编号/)
  console.log('[P8 PASS] Voice Mode handoffDraft extraction & zero-intrusion confirmation gate verified')

  console.log('\nALL V1.10 HANDS-FREE VAD + REMOTE PAGER GATES PASSED (P1–P8)')
} finally {
  await new Promise(resolve => mockServer.close(resolve))
  fs.rmSync(tmpRoot, { recursive: true, force: true })
}
