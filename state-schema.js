/**
 * state-schema.js — 参谋状态常量、纯归一化校验器、紧缩阈值解析、JSON 容错提取与水泡目录
 *
 * 【核心职责】
 *   集中存放 `chief-state.js` 中零磁盘锁依赖的纯数据契约与无副作用助手：
 *   常量配额、LLM 账本统计/归一化、思考深度对齐、Workspace/Fact/Suggestion/Mail/Ledger 归一化、
 *   上下文紧缩阈值解析（`COMPACT_*`）、容错 JSON 提取（`extractJsonObject`）、活跃工作追踪及官方外部 Harness 目录。
 *
 * 【边界与无环约定】
 *   - 只单向依赖 `node:path`、`node:crypto` 与 `./safety/index.js`；
 *   - 绝不导入 `chief-state.js`、`state-media.js` 或访问文件系统状态锁，严禁出现 `export let`。
 */

import path from 'node:path'
import crypto from 'node:crypto'
import {
  DEFAULT_CHIEF_PERMISSION_MODE,
  normalizePermissionMode,
  normalizeAuditRecord,
  resolveRoleCapabilities,
  buildCapabilityScope,
  validatePolicyPluginList,
} from './safety/index.js'

export const APPROVALS_CAP = 30

export const AUDIT_LOG_CAP = 80

export const RESUME_TASKS_CAP = 20

export const TASK_LEDGER_CAP = 30

export const DEFAULT_RESUME_TTL_MS = 30 * 60 * 1000

const STATE_VERSION = 1

const activeResumingTaskIds = new Set()

export function markTaskResumingActive(taskId) {
  const id = String(taskId || '').trim()
  if (id) activeResumingTaskIds.add(id)
}

export function unmarkTaskResumingActive(taskId) {
  const id = String(taskId || '').trim()
  if (id) activeResumingTaskIds.delete(id)
}

export const FACTS_CAP = 120

export const FACT_TEXT_MAX = 260

export const CHAT_CAP = 36

export const MAIL_CAP = 80

export const SUGGESTIONS_CAP = 6

export const MODEL_TIMEOUT_MS = 90_000

export const CATALOG_TTL_MS = 10_000

export const REVIEW_DELAY_MS = 2_800

export const AUTO_SUMMARY_COOLDOWN_MS = 5 * 60_000

export const SMART_REVIEW_COOLDOWN_MS = 3 * 60_000

export const AUTO_REVIEW_COOLDOWN_MS = 90_000

// Thinking models spend several thousand output tokens on internal reasoning before emitting text;
// small caps (e.g. 2k-4k) starve the visible answer to empty string.
export const SUMMARY_MAX_TOKENS = 16_384

export const SUMMARY_RETRY_MAX_TOKENS = 32_768

export const CHIEF_UPDATE_SOURCE = 'dsh-chief-update'

export const CHIEF_RELAY_SOURCE = 'dsh-chief-relay'

export const CHIEF_INQUIRY_SOURCE = 'dsh-chief-inquiry'

export const CHIEF_EXEC_REQ_SOURCE = 'dsh-chief-execution-request'

export const CHAT_OPPORTUNISTIC_SUMMARY_COOLDOWN_MS = 60_000

export const CHIEF_RUN_MODES = ['off', 'patrol', 'managed']

export const DEFAULT_MANAGED_IDLE_TIMEOUT_MS = 15 * 60 * 1000

export const CHIEF_THINKING_EFFORTS = ['auto', 'off', 'low', 'medium', 'high', 'xhigh']

export const ALERT_EVENTS_CAP = 20

export const LLM_LEDGER_RECENT_CAP = 20

export const DEFAULT_MANAGED_BUDGET_MAX_CALLS = 30

export const DEFAULT_MANAGED_BUDGET_MAX_TOKENS = 300_000

export const CHIEF_UI_LANGS = ['auto', 'zh', 'en']

export const DEFAULT_EXTERNAL_MEMORY_CONFIG = {
  enabled: true,
  memorySlot: {
    enabled: true,
    kind: 'builtin-md',
    label: '参谋自带记事本',
    endpoint: '',
    vaultPath: '',
    cordisProviderId: '',
    authEnvVar: '',
    authToken: '',
    searchTool: '',
    writeTool: '',
    retractTool: '',
    autoSyncChat: true,
    syncPreCompress: true,
    syncLeadSummary: false,
    decayHalfLifeDays: 21,
    timeoutMs: 1800,
    charBudget: 1600,
    topK: 5,
  },
  moodSlot: {
    enabled: false,
    kind: 'none',
    label: '',
    endpoint: '',
    cordisProviderId: '',
    authEnvVar: '',
    authToken: '',
    workModeAutoMute: true,
    emotionSplitView: false,
    timeoutMs: 1500,
    charBudget: 400,
  },
  embedding: {
    enabled: false,
    provider: 'openai',
    baseUrl: '',
    model: '',
    apiKeyEnv: '',
    apiKey: '',
    timeoutMs: 2500,
    weight: 0.45,
  },
  autoDistill: {
    enabled: true,
    minTurns: 2,
    cooldownSec: 60,
  },
  workspacePolicies: {},
}

const EXT_MEM_KINDS = ['none', 'builtin-md', 'mcp-http', 'chief-http', 'markdown-vault', 'cordis']
const EXT_MOOD_KINDS = ['none', 'chief-http', 'cordis']
const EXT_WS_POLICIES = ['read-write', 'read-only', 'disabled']

function normalizeHttpEndpointUrl(raw) {
  const s = String(raw == null ? '' : raw).trim().slice(0, 320)
  if (!s) return ''
  try {
    const u = new URL(s)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
    return u.toString().replace(/\/+$/, '')
  } catch {
    return ''
  }
}

function normalizeEnvVarName(raw) {
  const s = String(raw == null ? '' : raw).trim().slice(0, 80)
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s) ? s : ''
}

function normalizeBoundedInt(raw, defVal, minVal, maxVal) {
  const n = Number(raw)
  if (!Number.isFinite(n)) return defVal
  return Math.min(maxVal, Math.max(minVal, Math.round(n)))
}

export function normalizeExternalMemoryConfig(raw, prevConfig = null) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const prev = prevConfig && typeof prevConfig === 'object' ? prevConfig : null
  const prevMem = prev && prev.memorySlot && typeof prev.memorySlot === 'object' ? prev.memorySlot : {}
  const prevMood = prev && prev.moodSlot && typeof prev.moodSlot === 'object' ? prev.moodSlot : {}
  const prevEmb = prev && prev.embedding && typeof prev.embedding === 'object' ? prev.embedding : {}
  const prevDistill = prev && prev.autoDistill && typeof prev.autoDistill === 'object' ? prev.autoDistill : {}
  const rawMem = src.memorySlot && typeof src.memorySlot === 'object' ? src.memorySlot : {}
  const rawMood = src.moodSlot && typeof src.moodSlot === 'object' ? src.moodSlot : {}
  const rawEmb = src.embedding && typeof src.embedding === 'object' ? src.embedding : {}
  const rawDistill = src.autoDistill && typeof src.autoDistill === 'object' ? src.autoDistill : {}

  const memKind = EXT_MEM_KINDS.includes(rawMem.kind)
    ? rawMem.kind
    : (EXT_MEM_KINDS.includes(prevMem.kind) && !('kind' in rawMem) ? prevMem.kind : DEFAULT_EXTERNAL_MEMORY_CONFIG.memorySlot.kind)
  const moodKind = EXT_MOOD_KINDS.includes(rawMood.kind) ? rawMood.kind : (EXT_MOOD_KINDS.includes(prevMood.kind) && !('kind' in rawMood) ? prevMood.kind : 'none')

  const resolveToken = (incoming, prevObj) => {
    if (incoming && incoming.clearAuthToken === true) return ''
    if (typeof incoming.authToken === 'string' && incoming.authToken.trim()) {
      return incoming.authToken.trim().slice(0, 512)
    }
    return typeof prevObj.authToken === 'string' ? prevObj.authToken.trim().slice(0, 512) : ''
  }

  const rawPolicies = src.workspacePolicies && typeof src.workspacePolicies === 'object'
    ? src.workspacePolicies
    : (prev && prev.workspacePolicies && typeof prev.workspacePolicies === 'object' ? prev.workspacePolicies : {})
  const workspacePolicies = {}
  for (const [k, v] of Object.entries(rawPolicies)) {
    const cleanKey = String(k || '').trim().slice(0, 140)
    if (!cleanKey) continue
    if (EXT_WS_POLICIES.includes(v)) workspacePolicies[cleanKey] = v
    if (Object.keys(workspacePolicies).length >= 100) break
  }

  const pickBool = (obj, prevObj, key, defVal) => {
    if (obj && typeof obj[key] === 'boolean') return obj[key]
    if (prevObj && typeof prevObj[key] === 'boolean') return prevObj[key]
    return defVal
  }
  const pickStr = (obj, prevObj, key, maxLen = 120) => {
    if (obj && typeof obj[key] === 'string') return obj[key].trim().slice(0, maxLen)
    if (prevObj && typeof prevObj[key] === 'string') return prevObj[key].trim().slice(0, maxLen)
    return ''
  }

  const memLabel = pickStr(rawMem, prevMem, 'label', 60)

  return {
    enabled: typeof src.enabled === 'boolean'
      ? src.enabled
      : (prev && typeof prev.enabled === 'boolean' ? prev.enabled : DEFAULT_EXTERNAL_MEMORY_CONFIG.enabled),
    memorySlot: {
      enabled: pickBool(rawMem, prevMem, 'enabled', DEFAULT_EXTERNAL_MEMORY_CONFIG.memorySlot.enabled),
      kind: memKind,
      label: memLabel || (memKind === 'builtin-md' ? DEFAULT_EXTERNAL_MEMORY_CONFIG.memorySlot.label : ''),
      endpoint: 'endpoint' in rawMem
        ? normalizeHttpEndpointUrl(rawMem.endpoint)
        : normalizeHttpEndpointUrl(prevMem.endpoint),
      vaultPath: pickStr(rawMem, prevMem, 'vaultPath', 360),
      cordisProviderId: pickStr(rawMem, prevMem, 'cordisProviderId', 80),
      authEnvVar: 'authEnvVar' in rawMem
        ? normalizeEnvVarName(rawMem.authEnvVar)
        : normalizeEnvVarName(prevMem.authEnvVar),
      authToken: resolveToken(rawMem, prevMem),
      searchTool: pickStr(rawMem, prevMem, 'searchTool', 80),
      writeTool: pickStr(rawMem, prevMem, 'writeTool', 80),
      retractTool: pickStr(rawMem, prevMem, 'retractTool', 80),
      autoSyncChat: pickBool(rawMem, prevMem, 'autoSyncChat', DEFAULT_EXTERNAL_MEMORY_CONFIG.memorySlot.autoSyncChat),
      syncPreCompress: pickBool(rawMem, prevMem, 'syncPreCompress', DEFAULT_EXTERNAL_MEMORY_CONFIG.memorySlot.syncPreCompress),
      syncLeadSummary: pickBool(rawMem, prevMem, 'syncLeadSummary', DEFAULT_EXTERNAL_MEMORY_CONFIG.memorySlot.syncLeadSummary),
      decayHalfLifeDays: normalizeBoundedInt(
        'decayHalfLifeDays' in rawMem ? rawMem.decayHalfLifeDays : prevMem.decayHalfLifeDays,
        DEFAULT_EXTERNAL_MEMORY_CONFIG.memorySlot.decayHalfLifeDays,
        3,
        365,
      ),
      timeoutMs: normalizeBoundedInt(
        'timeoutMs' in rawMem ? rawMem.timeoutMs : prevMem.timeoutMs,
        DEFAULT_EXTERNAL_MEMORY_CONFIG.memorySlot.timeoutMs,
        500,
        5000,
      ),
      charBudget: normalizeBoundedInt(
        'charBudget' in rawMem ? rawMem.charBudget : prevMem.charBudget,
        DEFAULT_EXTERNAL_MEMORY_CONFIG.memorySlot.charBudget,
        400,
        3000,
      ),
      topK: normalizeBoundedInt(
        'topK' in rawMem ? rawMem.topK : prevMem.topK,
        DEFAULT_EXTERNAL_MEMORY_CONFIG.memorySlot.topK,
        1,
        10,
      ),
    },
    moodSlot: {
      enabled: pickBool(rawMood, prevMood, 'enabled', DEFAULT_EXTERNAL_MEMORY_CONFIG.moodSlot.enabled),
      kind: moodKind,
      label: pickStr(rawMood, prevMood, 'label', 60),
      endpoint: 'endpoint' in rawMood
        ? normalizeHttpEndpointUrl(rawMood.endpoint)
        : normalizeHttpEndpointUrl(prevMood.endpoint),
      cordisProviderId: pickStr(rawMood, prevMood, 'cordisProviderId', 80),
      authEnvVar: 'authEnvVar' in rawMood
        ? normalizeEnvVarName(rawMood.authEnvVar)
        : normalizeEnvVarName(prevMood.authEnvVar),
      authToken: resolveToken(rawMood, prevMood),
      workModeAutoMute: pickBool(rawMood, prevMood, 'workModeAutoMute', DEFAULT_EXTERNAL_MEMORY_CONFIG.moodSlot.workModeAutoMute),
      emotionSplitView: pickBool(rawMood, prevMood, 'emotionSplitView', DEFAULT_EXTERNAL_MEMORY_CONFIG.moodSlot.emotionSplitView),
      timeoutMs: normalizeBoundedInt(
        'timeoutMs' in rawMood ? rawMood.timeoutMs : prevMood.timeoutMs,
        DEFAULT_EXTERNAL_MEMORY_CONFIG.moodSlot.timeoutMs,
        500,
        5000,
      ),
      charBudget: normalizeBoundedInt(
        'charBudget' in rawMood ? rawMood.charBudget : prevMood.charBudget,
        DEFAULT_EXTERNAL_MEMORY_CONFIG.moodSlot.charBudget,
        100,
        800,
      ),
    },
    embedding: (() => {
      const nextBaseUrl = 'baseUrl' in rawEmb
        ? normalizeHttpEndpointUrl(rawEmb.baseUrl)
        : normalizeHttpEndpointUrl(prevEmb.baseUrl)
      const detectUrlProvider = (u) => {
        const low = String(u || '').toLowerCase()
        if (!low) return ''
        if ((low.includes(':11434') && !/\/v1(?:\/embeddings)?$/i.test(low)) || low.includes('/api/embed')) return 'ollama'
        if (low.includes('generativelanguage.googleapis.com') || low.includes(':embedcontent')) return 'gemini'
        return ''
      }
      const allowed = ['openai', 'ollama', 'gemini']
      const rawP = typeof rawEmb.provider === 'string' ? rawEmb.provider.trim().toLowerCase() : ''
      const prevP = typeof prevEmb.provider === 'string' ? prevEmb.provider.trim().toLowerCase() : ''
      const urlP = detectUrlProvider(nextBaseUrl)
      const provider = (() => {
        if (rawP === 'ollama' || rawP === 'gemini') return rawP
        if (rawP === 'openai') {
          if (urlP === 'gemini' || (urlP === 'ollama' && !rawEmb.providerExplicit)) return urlP
          return 'openai'
        }
        if (urlP) return urlP
        if (allowed.includes(prevP)) return prevP
        return DEFAULT_EXTERNAL_MEMORY_CONFIG.embedding.provider
      })()
      return {
        enabled: pickBool(rawEmb, prevEmb, 'enabled', DEFAULT_EXTERNAL_MEMORY_CONFIG.embedding.enabled),
        provider,
        baseUrl: nextBaseUrl,
        model: pickStr(rawEmb, prevEmb, 'model', 120),
        apiKeyEnv: 'apiKeyEnv' in rawEmb
          ? normalizeEnvVarName(rawEmb.apiKeyEnv)
          : normalizeEnvVarName(prevEmb.apiKeyEnv),
      apiKey: (() => {
        if (rawEmb && rawEmb.clearApiKey === true) return ''
        if (typeof rawEmb.apiKey === 'string' && rawEmb.apiKey.trim()) {
          return rawEmb.apiKey.trim().slice(0, 512)
        }
        return typeof prevEmb.apiKey === 'string' ? prevEmb.apiKey.trim().slice(0, 512) : ''
      })(),
      timeoutMs: normalizeBoundedInt(
        'timeoutMs' in rawEmb ? rawEmb.timeoutMs : prevEmb.timeoutMs,
        DEFAULT_EXTERNAL_MEMORY_CONFIG.embedding.timeoutMs,
        500,
        8000,
      ),
        weight: (() => {
          const rawW = 'weight' in rawEmb ? Number(rawEmb.weight) : Number(prevEmb.weight)
          if (!Number.isFinite(rawW)) return DEFAULT_EXTERNAL_MEMORY_CONFIG.embedding.weight
          return Number(Math.min(0.9, Math.max(0.1, rawW)).toFixed(2))
        })(),
      }
    })(),
    autoDistill: {
      enabled: pickBool(rawDistill, prevDistill, 'enabled', DEFAULT_EXTERNAL_MEMORY_CONFIG.autoDistill.enabled),
      minTurns: normalizeBoundedInt(
        'minTurns' in rawDistill ? rawDistill.minTurns : prevDistill.minTurns,
        DEFAULT_EXTERNAL_MEMORY_CONFIG.autoDistill.minTurns,
        1,
        10,
      ),
      cooldownSec: normalizeBoundedInt(
        'cooldownSec' in rawDistill ? rawDistill.cooldownSec : prevDistill.cooldownSec,
        DEFAULT_EXTERNAL_MEMORY_CONFIG.autoDistill.cooldownSec,
        15,
        3600,
      ),
    },
    workspacePolicies,
  }
}

export function redactExternalMemoryConfigForUi(raw) {
  const norm = normalizeExternalMemoryConfig(raw)
  return {
    ...norm,
    memorySlot: {
      ...norm.memorySlot,
      authToken: '',
      hasAuthToken: Boolean(norm.memorySlot.authToken),
    },
    moodSlot: {
      ...norm.moodSlot,
      authToken: '',
      hasAuthToken: Boolean(norm.moodSlot.authToken),
    },
    embedding: {
      ...norm.embedding,
      apiKey: '',
      hasApiKey: Boolean(norm.embedding.apiKey),
    },
  }
}

export const DEFAULT_TTS_CONFIG = {
  enabled: false,
  provider: 'deepseek',
  voiceId: 'stella',
  format: 'wav',
  filterMarkdown: true,
  baseUrl: '',
  model: 'tts-1',
  apiKeyEnv: '',
  apiKey: '',
  browserVoice: '',
  speed: 1.0,
  volume: 0.9,
  autoSpeakAlerts: false,
  autoSpeakReplies: false,
  speechStyle: 'brief',
  fallbackToBrowser: true,
  timeoutMs: 18000,
  handsFreeVad: false,
  vadSilenceMs: 1300,
}

const TTS_PROVIDERS = ['deepseek', 'openai-compat', 'browser']
const TTS_FORMATS = ['wav', 'mp3', 'opus', 'pcm']
const TTS_SPEECH_STYLES = ['brief', 'full']

export function normalizeTtsConfig(raw, prevConfig = null) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const prev = prevConfig && typeof prevConfig === 'object' ? prevConfig : {}
  const pickBool = (key, defVal) => {
    if (typeof src[key] === 'boolean') return src[key]
    if (typeof prev[key] === 'boolean') return prev[key]
    return defVal
  }
  const pickStr = (key, defVal, maxLen = 120) => {
    if (typeof src[key] === 'string') {
      return src[key].replace(/[\r\n]+/g, ' ').trim().slice(0, maxLen)
    }
    if (typeof prev[key] === 'string') {
      return prev[key].replace(/[\r\n]+/g, ' ').trim().slice(0, maxLen)
    }
    return defVal
  }

  const rawProvider = typeof src.provider === 'string' ? src.provider.trim().toLowerCase() : ''
  const prevProvider = typeof prev.provider === 'string' ? prev.provider.trim().toLowerCase() : ''
  const provider = TTS_PROVIDERS.includes(rawProvider)
    ? rawProvider
    : (TTS_PROVIDERS.includes(prevProvider) ? prevProvider : DEFAULT_TTS_CONFIG.provider)

  const rawFormat = typeof src.format === 'string' ? src.format.trim().toLowerCase() : ''
  const prevFormat = typeof prev.format === 'string' ? prev.format.trim().toLowerCase() : ''
  const format = TTS_FORMATS.includes(rawFormat)
    ? rawFormat
    : (TTS_FORMATS.includes(prevFormat) ? prevFormat : DEFAULT_TTS_CONFIG.format)

  const rawStyle = typeof src.speechStyle === 'string' ? src.speechStyle.trim().toLowerCase() : ''
  const prevStyle = typeof prev.speechStyle === 'string' ? prev.speechStyle.trim().toLowerCase() : ''
  const speechStyle = TTS_SPEECH_STYLES.includes(rawStyle)
    ? rawStyle
    : (TTS_SPEECH_STYLES.includes(prevStyle) ? prevStyle : DEFAULT_TTS_CONFIG.speechStyle)

  const rawSpeed = 'speed' in src ? Number(src.speed) : Number(prev.speed)
  const speed = Number.isFinite(rawSpeed)
    ? Number(Math.min(1.5, Math.max(0.75, rawSpeed)).toFixed(2))
    : DEFAULT_TTS_CONFIG.speed

  const rawVolume = 'volume' in src ? Number(src.volume) : Number(prev.volume)
  const volume = Number.isFinite(rawVolume)
    ? Number(Math.min(1.0, Math.max(0.1, rawVolume)).toFixed(2))
    : DEFAULT_TTS_CONFIG.volume

  const apiKey = (() => {
    if (src.clearApiKey === true) return ''
    if (typeof src.apiKey === 'string' && src.apiKey.trim()) {
      return src.apiKey.trim().slice(0, 512)
    }
    return typeof prev.apiKey === 'string' ? prev.apiKey.trim().slice(0, 512) : ''
  })()

  return {
    enabled: pickBool('enabled', DEFAULT_TTS_CONFIG.enabled),
    provider,
    voiceId: pickStr('voiceId', DEFAULT_TTS_CONFIG.voiceId, 120) || DEFAULT_TTS_CONFIG.voiceId,
    format,
    filterMarkdown: pickBool('filterMarkdown', DEFAULT_TTS_CONFIG.filterMarkdown),
    baseUrl: 'baseUrl' in src
      ? normalizeHttpEndpointUrl(src.baseUrl)
      : normalizeHttpEndpointUrl(prev.baseUrl),
    model: pickStr('model', DEFAULT_TTS_CONFIG.model, 120) || DEFAULT_TTS_CONFIG.model,
    apiKeyEnv: 'apiKeyEnv' in src
      ? normalizeEnvVarName(src.apiKeyEnv)
      : normalizeEnvVarName(prev.apiKeyEnv),
    apiKey,
    browserVoice: pickStr('browserVoice', DEFAULT_TTS_CONFIG.browserVoice, 120),
    speed,
    volume,
    autoSpeakAlerts: pickBool('autoSpeakAlerts', DEFAULT_TTS_CONFIG.autoSpeakAlerts),
    autoSpeakReplies: pickBool('autoSpeakReplies', DEFAULT_TTS_CONFIG.autoSpeakReplies),
    speechStyle,
    fallbackToBrowser: pickBool('fallbackToBrowser', DEFAULT_TTS_CONFIG.fallbackToBrowser),
    timeoutMs: normalizeBoundedInt(
      'timeoutMs' in src ? src.timeoutMs : prev.timeoutMs,
      DEFAULT_TTS_CONFIG.timeoutMs,
      5000,
      45000,
    ),
    handsFreeVad: pickBool('handsFreeVad', DEFAULT_TTS_CONFIG.handsFreeVad),
    vadSilenceMs: normalizeBoundedInt(
      'vadSilenceMs' in src ? src.vadSilenceMs : prev.vadSilenceMs,
      DEFAULT_TTS_CONFIG.vadSilenceMs,
      600,
      3000,
    ),
  }
}

export function redactTtsConfigForUi(raw) {
  const norm = normalizeTtsConfig(raw)
  return {
    ...norm,
    apiKey: '',
    hasApiKey: Boolean(norm.apiKey),
  }
}

export const DEFAULT_PAGER_CONFIG = {
  enabled: false,
  channel: 'feishu',
  webhookUrl: '',
  secret: '',
  telegramBotToken: '',
  telegramChatId: '',
  quietPrefix: '[DSH 参谋长]',
  cooldownSec: 15,
  timeoutMs: 10000,
  events: {
    approvalRequired: true,
    wallBlocked: true,
    hazardHalt: true,
    taskDone: true,
    budgetBreak: true,
  },
}

const PAGER_CHANNELS = ['feishu', 'dingtalk', 'wecom', 'telegram', 'discord', 'webhook']

export function normalizePagerConfig(raw, prevConfig = null) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const prev = prevConfig && typeof prevConfig === 'object' ? prevConfig : {}
  const prevEv = prev.events && typeof prev.events === 'object' ? prev.events : {}
  const rawEv = src.events && typeof src.events === 'object' ? src.events : {}

  const pickBool = (key, defVal) => {
    if (typeof src[key] === 'boolean') return src[key]
    if (typeof prev[key] === 'boolean') return prev[key]
    return defVal
  }
  const pickEventBool = (key, defVal) => {
    if (typeof rawEv[key] === 'boolean') return rawEv[key]
    if (typeof prevEv[key] === 'boolean') return prevEv[key]
    return defVal
  }
  const pickStr = (key, defVal, maxLen = 120) => {
    if (typeof src[key] === 'string') {
      return src[key].replace(/[\r\n]+/g, ' ').trim().slice(0, maxLen)
    }
    if (typeof prev[key] === 'string') {
      return prev[key].replace(/[\r\n]+/g, ' ').trim().slice(0, maxLen)
    }
    return defVal
  }

  const rawCh = typeof src.channel === 'string' ? src.channel.trim().toLowerCase() : ''
  const prevCh = typeof prev.channel === 'string' ? prev.channel.trim().toLowerCase() : ''
  const channel = PAGER_CHANNELS.includes(rawCh)
    ? rawCh
    : (PAGER_CHANNELS.includes(prevCh) ? prevCh : DEFAULT_PAGER_CONFIG.channel)

  const webhookUrl = (() => {
    if (src.clearWebhookUrl === true) return ''
    if (typeof src.webhookUrl === 'string' && src.webhookUrl.trim()) {
      return normalizeHttpEndpointUrl(src.webhookUrl)
    }
    return typeof prev.webhookUrl === 'string' ? normalizeHttpEndpointUrl(prev.webhookUrl) : ''
  })()

  const secret = (() => {
    if (src.clearSecret === true) return ''
    if (typeof src.secret === 'string' && src.secret.trim()) {
      return src.secret.trim().slice(0, 512)
    }
    return typeof prev.secret === 'string' ? prev.secret.trim().slice(0, 512) : ''
  })()

  const telegramBotToken = (() => {
    if (src.clearTelegramBotToken === true) return ''
    if (typeof src.telegramBotToken === 'string' && src.telegramBotToken.trim()) {
      return src.telegramBotToken.trim().slice(0, 256)
    }
    return typeof prev.telegramBotToken === 'string' ? prev.telegramBotToken.trim().slice(0, 256) : ''
  })()

  return {
    enabled: pickBool('enabled', DEFAULT_PAGER_CONFIG.enabled),
    channel,
    webhookUrl,
    secret,
    telegramBotToken,
    telegramChatId: pickStr('telegramChatId', DEFAULT_PAGER_CONFIG.telegramChatId, 80),
    quietPrefix: pickStr('quietPrefix', DEFAULT_PAGER_CONFIG.quietPrefix, 40) || DEFAULT_PAGER_CONFIG.quietPrefix,
    cooldownSec: normalizeBoundedInt(
      'cooldownSec' in src ? src.cooldownSec : prev.cooldownSec,
      DEFAULT_PAGER_CONFIG.cooldownSec,
      3,
      300,
    ),
    timeoutMs: normalizeBoundedInt(
      'timeoutMs' in src ? src.timeoutMs : prev.timeoutMs,
      DEFAULT_PAGER_CONFIG.timeoutMs,
      3000,
      25000,
    ),
    events: {
      approvalRequired: pickEventBool('approvalRequired', DEFAULT_PAGER_CONFIG.events.approvalRequired),
      wallBlocked: pickEventBool('wallBlocked', DEFAULT_PAGER_CONFIG.events.wallBlocked),
      hazardHalt: pickEventBool('hazardHalt', DEFAULT_PAGER_CONFIG.events.hazardHalt),
      taskDone: pickEventBool('taskDone', DEFAULT_PAGER_CONFIG.events.taskDone),
      budgetBreak: pickEventBool('budgetBreak', DEFAULT_PAGER_CONFIG.events.budgetBreak),
    },
  }
}

export function redactPagerConfigForUi(raw) {
  const norm = normalizePagerConfig(raw)
  let webhookHostHint = ''
  if (norm.webhookUrl) {
    try {
      webhookHostHint = new URL(norm.webhookUrl).host
    } catch {}
  }
  return {
    ...norm,
    webhookUrl: '',
    secret: '',
    telegramBotToken: '',
    hasWebhookUrl: Boolean(norm.webhookUrl),
    webhookHostHint,
    hasSecret: Boolean(norm.secret),
    hasTelegramBotToken: Boolean(norm.telegramBotToken),
  }
}

export const CHIEF_SCENARIO_PRESETS = {
  observer: {
    id: 'observer',
    permissionMode: 'advisor',
    runMode: 'off',
    thinkingEffort: 'low',
    tacticalModes: {
      intervention: false,
      autoCompact: false,
      smartCompact: false,
      redlineSentinel: false,
    },
    notifyEnabled: true,
  },
  collab: {
    id: 'collab',
    permissionMode: 'strategist',
    runMode: 'patrol',
    thinkingEffort: 'auto',
    tacticalModes: {
      intervention: false,
      redlineSentinel: true,
    },
    notifyEnabled: true,
  },
  away: {
    id: 'away',
    permissionMode: 'chief',
    runMode: 'managed',
    thinkingEffort: 'auto',
    tacticalModes: {
      autoCompact: true,
      compactThresholdMode: 'pct',
      compactThresholdPct: 80,
      redlineSentinel: true,
    },
    notifyEnabled: true,
    managedBudgetMaxCalls: DEFAULT_MANAGED_BUDGET_MAX_CALLS,
    managedBudgetMaxTokens: DEFAULT_MANAGED_BUDGET_MAX_TOKENS,
  },
}

export function normalizeUiLang(raw) {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (s === 'zh' || s === 'zh-cn' || s === 'zh-hans') return 'zh'
  if (s === 'en' || s === 'en-us' || s === 'en-gb') return 'en'
  return 'auto'
}

export const CHIEF_UI_SKINS = ['glass', 'editorial', 'botanical', 'starlight', 'classic', 'tide', 'custom']

export function normalizeUiSkinPref(raw) {
  const clean = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return CHIEF_UI_SKINS.includes(clean) ? clean : ''
}

const SERVER_HEX6_RE = /^#[0-9a-f]{6}$/i
const SERVER_DATA_IMG_RE = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/

export function normalizeServerCustomSkin(raw) {
  if (raw === null || raw === false) return null
  if (!raw || typeof raw !== 'object') return null
  const pickHex = (v, fb) => {
    const s = String(v || '').trim()
    return SERVER_HEX6_RE.test(s) ? s.toLowerCase() : fb
  }
  const cleanName = String(raw.name || '').replace(/[\r\n<>"{}]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24)
  const cleanMood = String(raw.moodNote || '').replace(/[\r\n<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
  const rawImg = String(raw.bgImageUrl || '').trim()
  const bgImageUrl = (rawImg.length <= 480000 && SERVER_DATA_IMG_RE.test(rawImg)) ? rawImg : ''
  const bgImageStorage = bgImageUrl ? 'inline' : ''
  const rawOpacity = Number(raw.bgImageOpacity)
  const rawBlur = Number(raw.bgImageBlur)
  return {
    name: cleanName || '流光定制',
    accentHex: pickHex(raw.accentHex, '#8b7cf6'),
    secondaryHex: pickHex(raw.secondaryHex, '#5cc9a7'),
    warmHex: pickHex(raw.warmHex, '#f0b868'),
    bgTintHex: pickHex(raw.bgTintHex, '#171928'),
    bgImageUrl,
    bgImageStorage,
    bgImageEnabled: raw.bgImageEnabled !== false,
    bgImageOpacity: Number.isFinite(rawOpacity) ? Math.round(Math.min(0.80, Math.max(0.06, rawOpacity)) * 100) / 100 : 0.28,
    bgImageBlur: Number.isFinite(rawBlur) ? Math.round(Math.min(32, Math.max(0, rawBlur))) : 10,
    ambientGlow: raw.ambientGlow !== false,
    radius: ['round', 'medium', 'sharp'].includes(raw.radius) ? raw.radius : 'round',
    serifTitle: Boolean(raw.serifTitle),
    moodNote: cleanMood,
    source: ['image', 'chief', 'manual'].includes(raw.source) ? raw.source : 'manual',
    updatedAt: Math.max(0, Number(raw.updatedAt) || 0),
  }
}

export function normalizeManagedBudgetCalls(raw) {
  if (raw === 0 || raw === '0') return 0
  const n = Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_MANAGED_BUDGET_MAX_CALLS
  if (n <= 0) return 0
  return Math.min(500, Math.max(3, Math.round(n)))
}

export function normalizeManagedBudgetTokens(raw) {
  if (raw === 0 || raw === '0') return 0
  const n = Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_MANAGED_BUDGET_MAX_TOKENS
  if (n <= 0) return 0
  return Math.min(5_000_000, Math.max(10_000, Math.round(n)))
}

export function classifyChiefLlmCategory(reasonKind = '') {
  const rk = String(reasonKind || '').trim().toLowerCase()
  if (!rk) return 'chat'
  if (
    rk === 'dream_roam'
    || rk === 'precipitate'
    || rk === 'distill'
    || rk.startsWith('archive_')
  ) {
    return 'dream'
  }
  if (
    rk === 'turn_review'
    || rk === 'auto_summary'
    || rk === 'chat_summary'
    || rk === 'wall_blocked'
    || rk === 'strong_intervention'
    || rk === 'hazard_diagnosis'
    || rk === 'idle_watchdog'
    || rk === 'config_activated'
  ) {
    return 'review'
  }
  if (
    rk === 'ask_chief'
    || rk === 'consult_chief'
    || rk === 'blank_explore'
    || rk === 'craft_wall'
    || rk === 'extract_bounds'
    || rk === 'consolidate_bounds'
    || rk === 'suggest_objective'
    || rk === 'recommend_compact'
  ) {
    return 'chat'
  }
  return 'other'
}

export const LLM_LEDGER_CALLS_MAX = 1_000_000
export const LLM_LEDGER_TOKENS_MAX = 1_000_000_000

export function emptyLlmLedger() {
  return {
    totalCalls: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    byCategory: {
      chat: { calls: 0, tokens: 0 },
      review: { calls: 0, tokens: 0 },
      dream: { calls: 0, tokens: 0 },
      other: { calls: 0, tokens: 0 },
    },
    managedRun: {
      startedAt: 0,
      calls: 0,
      tokens: 0,
      tripped: false,
      trippedAt: 0,
      trippedReason: '',
    },
    recent: [],
  }
}

export function normalizeLlmLedger(raw) {
  const base = emptyLlmLedger()
  if (!raw || typeof raw !== 'object') return base
  const nonNegTs = v => Math.max(0, Math.round(Number(v) || 0))
  const clampCalls = v => Math.min(LLM_LEDGER_CALLS_MAX, Math.max(0, Math.round(Number(v) || 0)))
  const clampTokens = v => Math.min(LLM_LEDGER_TOKENS_MAX, Math.max(0, Math.round(Number(v) || 0)))
  base.totalCalls = clampCalls(raw.totalCalls)
  base.totalInputTokens = clampTokens(raw.totalInputTokens)
  base.totalOutputTokens = clampTokens(raw.totalOutputTokens)
  base.totalTokens = clampTokens(raw.totalTokens) || clampTokens(base.totalInputTokens + base.totalOutputTokens)
  const rawCats = raw.byCategory && typeof raw.byCategory === 'object' ? raw.byCategory : {}
  for (const k of ['chat', 'review', 'dream', 'other']) {
    const c = rawCats[k] && typeof rawCats[k] === 'object' ? rawCats[k] : {}
    base.byCategory[k] = { calls: clampCalls(c.calls), tokens: clampTokens(c.tokens) }
  }
  const mr = raw.managedRun && typeof raw.managedRun === 'object' ? raw.managedRun : {}
  base.managedRun = {
    startedAt: nonNegTs(mr.startedAt),
    calls: clampCalls(mr.calls),
    tokens: clampTokens(mr.tokens),
    tripped: Boolean(mr.tripped),
    trippedAt: nonNegTs(mr.trippedAt),
    trippedReason: clamp(mr.trippedReason || '', 220),
  }
  base.recent = (Array.isArray(raw.recent) ? raw.recent : [])
    .filter(r => r && typeof r === 'object')
    .slice(-LLM_LEDGER_RECENT_CAP)
    .map(r => {
      const inTok = clampTokens(r.inputTokens)
      const outTok = clampTokens(r.outputTokens)
      return {
        id: typeof r.id === 'string' && r.id ? r.id : nextId('llm'),
        at: nonNegTs(r.at) || Date.now(),
        category: ['chat', 'review', 'dream', 'other'].includes(r.category) ? r.category : 'other',
        reasonKind: clamp(r.reasonKind || '', 40),
        modelRef: clamp(r.modelRef || '', 80),
        inputTokens: inTok,
        outputTokens: outTok,
        totalTokens: clampTokens(r.totalTokens) || clampTokens(inTok + outTok),
        estimated: Boolean(r.estimated),
        ok: r.ok !== false,
      }
    })
  return base
}

export function summarizeLlmLedger(rawLedger, cfg = null) {
  const ledger = normalizeLlmLedger(rawLedger)
  const maxCalls = cfg && cfg.managedBudgetMaxCalls !== undefined
    ? normalizeManagedBudgetCalls(cfg.managedBudgetMaxCalls)
    : DEFAULT_MANAGED_BUDGET_MAX_CALLS
  const maxTokens = cfg && cfg.managedBudgetMaxTokens !== undefined
    ? normalizeManagedBudgetTokens(cfg.managedBudgetMaxTokens)
    : DEFAULT_MANAGED_BUDGET_MAX_TOKENS
  return {
    totalCalls: ledger.totalCalls,
    totalInputTokens: ledger.totalInputTokens,
    totalOutputTokens: ledger.totalOutputTokens,
    totalTokens: ledger.totalTokens,
    byCategory: {
      chat: { ...ledger.byCategory.chat },
      review: { ...ledger.byCategory.review },
      dream: { ...ledger.byCategory.dream },
      other: { ...ledger.byCategory.other },
    },
    managedRun: { ...ledger.managedRun },
    budget: {
      maxCalls,
      maxTokens,
    },
    recent: ledger.recent.slice(-8),
  }
}

export function normalizeAlertEvent(raw) {
  if (!raw || typeof raw !== 'object') return null
  const title = clamp(raw.title || '', 100)
  if (!title) return null
  const validKinds = [
    'pending_approval',
    'pending_elevation',
    'guard_wall_blocked',
    'safety_guard_blocked',
    'auto_continue_rescue',
    'managed_auto_sleep',
    'budget_circuit_break',
    'hazard_halt',
  ]
  const kind = validKinds.includes(raw.kind) ? raw.kind : 'pending_approval'
  const level = ['info', 'warn', 'danger', 'success'].includes(raw.level) ? raw.level : 'info'
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : nextId('alt'),
    kind,
    level,
    title,
    body: clamp(raw.body || '', 220),
    dedupeKey: clamp(raw.dedupeKey || '', 100),
    at: Number(raw.at) || Date.now(),
  }
}

const alertEventListeners = []

export function registerAlertEventListener(fn) {
  if (typeof fn !== 'function') return () => {}
  if (!alertEventListeners.includes(fn)) {
    alertEventListeners.push(fn)
  }
  return () => {
    const idx = alertEventListeners.indexOf(fn)
    if (idx >= 0) alertEventListeners.splice(idx, 1)
  }
}

export function pushAlertEventToWs(ws, spec = {}) {
  if (!ws || typeof ws !== 'object') return null
  if (!Array.isArray(ws.alertEvents)) ws.alertEvents = []
  const norm = normalizeAlertEvent(spec)
  if (!norm) return null
  if (norm.dedupeKey) {
    const dup = ws.alertEvents.find(
      a => a && a.dedupeKey === norm.dedupeKey && Math.abs(norm.at - (Number(a.at) || 0)) < 5_000,
    )
    if (dup) return dup
  }
  ws.alertEvents.push(norm)
  if (ws.alertEvents.length > ALERT_EVENTS_CAP) {
    ws.alertEvents = ws.alertEvents.slice(-ALERT_EVENTS_CAP)
  }
  for (const listener of alertEventListeners) {
    try {
      listener(norm, ws)
    } catch {}
  }
  return norm
}

export function normalizeRunMode(raw, fallbackCfg = null) {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (s === 'off' || s === 'patrol' || s === 'managed') return s
  if (s === 'stopped' || s === 'manual') return 'off'
  if (s === 'smart') return 'patrol'
  if (s === 'auto' || s === 'autopilot') return 'managed'
  if (fallbackCfg && typeof fallbackCfg === 'object') {
    if (fallbackCfg.stopped || fallbackCfg.paceMode === 'stopped') return 'off'
    if (fallbackCfg.autoPilot || fallbackCfg.paceMode === 'auto') return 'managed'
    if (fallbackCfg.paceMode === 'smart') return 'patrol'
  }
  return 'off'
}

export function normalizeThinkingEffort(raw) {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (CHIEF_THINKING_EFFORTS.includes(s)) return s
  return 'auto'
}

export function normalizeTeamEffortMode(raw) {
  return String(raw || '').trim().toLowerCase() === 'manual' ? 'manual' : 'auto'
}

export function normalizeLockedModelEfforts(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw)) {
    const cleanKey = String(k || '').trim().slice(0, 64)
    if (!cleanKey) continue
    if (v === true) out[cleanKey] = true
  }
  return out
}

const EFFORT_ORDER_LADDER = ['off', 'low', 'medium', 'high', 'xhigh']

export function resolveAlignedModelEffort(desiredEffort, supportedEfforts = []) {
  const list = Array.isArray(supportedEfforts)
    ? supportedEfforts.map(e => (typeof e === 'string' ? e : (e && e.id ? String(e.id) : ''))).filter(Boolean)
    : []
  if (!list.length) return undefined
  const want = String(desiredEffort || '').trim().toLowerCase()
  if (!want || want === 'auto') {
    if (list.includes('medium')) return 'medium'
    return list[Math.floor(list.length / 2)] || list[0]
  }
  if (list.includes(want)) return want
  const wantIdx = EFFORT_ORDER_LADDER.indexOf(want)
  if (wantIdx < 0) return list[0]
  for (let d = 1; d < EFFORT_ORDER_LADDER.length; d += 1) {
    if (wantIdx - d >= 0 && list.includes(EFFORT_ORDER_LADDER[wantIdx - d])) {
      return EFFORT_ORDER_LADDER[wantIdx - d]
    }
    if (wantIdx + d < EFFORT_ORDER_LADDER.length && list.includes(EFFORT_ORDER_LADDER[wantIdx + d])) {
      return EFFORT_ORDER_LADDER[wantIdx + d]
    }
  }
  return list[0]
}


const SECRET_PATTERN = /(?:sk-[a-zA-Z0-9_-]{16,}|ghp_[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|Bearer\s+[A-Za-z0-9._~+/=-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/

const CHIEF_NAME_SECRET_RES = [
  /\bsk-(?:proj-)?[a-zA-Z0-9_-]{12,}/i,
  /\bghp_[a-zA-Z0-9]{16,}/,
  /\bgho_[a-zA-Z0-9]{16,}/,
  /\bgithub_pat_[a-zA-Z0-9_]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{24,}/,
  /\bxox[baprs]-[a-zA-Z0-9-]{16,}/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /(?:api[_-]?key|secret|token|password|passwd)\s*[:=]\s*['"]?[A-Za-z0-9._~+/=-]{12,}['"]?/i,
]

export function containsChiefNameSecret(raw) {
  const s = String(raw == null ? '' : raw).trim()
  if (!s) return false
  return SECRET_PATTERN.test(s) || CHIEF_NAME_SECRET_RES.some(re => re.test(s))
}

const EXT_MEM_GLOBAL_SECRET_RES = [
  /(?:sk-[a-zA-Z0-9_-]{16,}|ghp_[a-zA-Z0-9]{20,}|gho_[a-zA-Z0-9]{16,}|github_pat_[a-zA-Z0-9_]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|xox[baprs]-[a-zA-Z0-9-]{16,})/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----|-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  /\b(api[_-]?key|secret|token|password|passwd)\s*([:=])\s*['"]?[A-Za-z0-9._~+/=-]{10,}['"]?/gi,
  /(https?:\/\/)([^:@/\s]+):([^@/\s]+)@/gi,
]

export function scrubExternalMemoryText(text) {
  let s = String(text == null ? '' : text)
  if (!s) return ''
  s = s.replace(EXT_MEM_GLOBAL_SECRET_RES[0], '[REDACTED]')
  s = s.replace(EXT_MEM_GLOBAL_SECRET_RES[1], 'Bearer [REDACTED]')
  s = s.replace(EXT_MEM_GLOBAL_SECRET_RES[2], '[REDACTED_PRIVATE_KEY]')
  s = s.replace(EXT_MEM_GLOBAL_SECRET_RES[3], '$1$2[REDACTED]')
  s = s.replace(EXT_MEM_GLOBAL_SECRET_RES[4], '$1[REDACTED]@')
  return s
}

export function normalizeChiefName(raw) {
  const s = String(raw == null ? '' : raw).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!s || containsChiefNameSecret(s)) return ''
  return s.slice(0, 24)
}

let idSeq = 0

export function nextId(prefix) {
  idSeq = (idSeq + 1) % 1000000
  return prefix + '-' + Date.now().toString(36) + '-' + idSeq.toString(36)
}

export function clamp(value, max) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  return text.slice(0, Math.max(0, max - 1)) + '…'
}

export function cleanMultiline(value, max) {
  const text = String(value == null ? '' : value).replace(/\r/g, '').trim()
  if (text.length <= max) return text
  return text.slice(0, Math.max(0, max - 1)) + '…'
}

export function secretLike(text) {
  return SECRET_PATTERN.test(String(text || ''))
}


export function canonicalSortJsonValue(val) {
  if (val === null || val === undefined) return null
  if (Array.isArray(val)) return val.map(v => canonicalSortJsonValue(v))
  if (typeof val === 'object') {
    const out = {}
    for (const k of Object.keys(val).sort()) {
      const v = val[k]
      if (v !== undefined) out[k] = canonicalSortJsonValue(v)
    }
    return out
  }
  return val
}

export function computeApprovalPayloadHash(kind = 'tool', payload = {}) {
  const canonical = JSON.stringify(canonicalSortJsonValue({
    kind: String(kind || 'tool'),
    payload: payload && typeof payload === 'object' ? payload : {},
  }))
  return crypto.createHash('sha256').update(canonical).digest('hex')
}

export function normalizeChiefRiskAck(raw) {
  if (!raw || typeof raw !== 'object' || raw.acknowledged !== true) return null
  const at = Number(raw.at) || 0
  if (at <= 0) return null
  return {
    acknowledged: true,
    at,
    by: clamp(raw.by || 'operator', 40),
    version: clamp(raw.version || '1.2.1', 20),
  }
}

export function hasValidChiefRiskAck(ws) {
  return Boolean(ws && ws.chiefRiskAck && ws.chiefRiskAck.acknowledged === true && Number(ws.chiefRiskAck.at) > 0)
}

export function normalizePendingApproval(raw) {
  if (!raw || typeof raw !== 'object') return null
  const opLabel = clamp(raw.operationLabel || raw.operation || '', 80)
  if (!opLabel) return null
  const validStatuses = ['pending', 'approved', 'rejected', 'executed', 'failed', 'expired']
  const status = validStatuses.includes(raw.status) ? raw.status : 'pending'
  const validKinds = ['tool', 'relay', 'compact', 'auto_continue', 'archive_op', 'model_effort']
  const kind = validKinds.includes(raw.kind) ? raw.kind : 'tool'
  const validCategories = ['workspace_file', 'system_command', 'main_workflow', 'subagent_workflow']
  const category = validCategories.includes(raw.category) ? raw.category : 'workspace_file'
  const payload = raw.payload && typeof raw.payload === 'object' ? raw.payload : {}
  const payloadHash = typeof raw.payloadHash === 'string' && raw.payloadHash.trim()
    ? raw.payloadHash.trim()
    : computeApprovalPayloadHash(kind, payload)
  const taskId = clamp(raw.taskId || raw.resumeTaskId || '', 80)
  const capabilityScope = raw.capabilityScope && typeof raw.capabilityScope === 'object'
    ? raw.capabilityScope
    : buildCapabilityScope({
        kind,
        tool: payload.tool || kind,
        args: payload.args || {},
        cwd: payload.cwd || '',
        target: payload.target || '',
      })
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : nextId('apr'),
    status,
    category,
    operationLabel: opLabel,
    targetLabel: clamp(raw.targetLabel || raw.target || '', 120),
    reason: clamp(raw.reason || '', 240),
    impact: clamp(raw.impact || '', 220),
    preview: cleanMultiline(raw.preview || '', 420),
    kind,
    payload,
    payloadHash,
    capabilityScope,
    taskId,
    resumeTaskId: taskId,
    expiresAt: Math.max(0, Number(raw.expiresAt) || 0),
    dedupeKey: clamp(raw.dedupeKey || '', 120),
    by: clamp(raw.by || 'chief', 40),
    createdAt: Number(raw.createdAt) || Date.now(),
    resolvedAt: Number(raw.resolvedAt) || 0,
    resolvedBy: clamp(raw.resolvedBy || '', 40),
    resultMessage: clamp(raw.resultMessage || '', 260),
  }
}

export function normalizePendingElevation(raw) {
  if (!raw || typeof raw !== 'object') return null
  if (raw.status && raw.status !== 'pending') return null
  const targetMode = normalizePermissionMode(raw.targetMode)
  if (targetMode === 'advisor') return null
  const createdAt = Number(raw.createdAt) || Date.now()
  const taskId = clamp(raw.taskId || raw.resumeTaskId || '', 80)
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : nextId('elv'),
    status: 'pending',
    fromMode: normalizePermissionMode(raw.fromMode || 'advisor'),
    targetMode,
    reason: clamp(raw.reason || '当前任务需要更高参谋权限才能继续执行', 260),
    requestedActionSummary: clamp(raw.requestedActionSummary || '', 220),
    requestedCapabilities: Array.isArray(raw.requestedCapabilities)
      ? raw.requestedCapabilities.map(c => clamp(c, 60)).filter(Boolean).slice(0, 12)
      : [],
    taskId,
    resumeTaskId: taskId,
    expiresAt: Math.max(0, Number(raw.expiresAt) || (createdAt + DEFAULT_RESUME_TTL_MS)),
    by: clamp(raw.by || 'chief', 40),
    createdAt,
  }
}

export const VALID_TASK_LEDGER_STATUSES = [
  'proposed',
  'awaiting_elevation',
  'awaiting_approval',
  'awaiting_inquiry',
  'dispatched',
  'running',
  'resuming',
  'verifying',
  'completed',
  'interrupted',
  'rejected',
  'cancelled',
  'expired',
  'failed',
]

export function normalizeTaskLedgerEntry(raw) {
  if (!raw || typeof raw !== 'object') return null
  const spec = raw.resumeSpec && typeof raw.resumeSpec === 'object' ? raw.resumeSpec : {}
  const originalText = cleanMultiline(spec.originalText || raw.originalText || '', 2000)
  if (!originalText) return null
  const status = VALID_TASK_LEDGER_STATUSES.includes(raw.status) ? raw.status : 'awaiting_approval'
  const createdAt = Number(raw.createdAt) || Date.now()
  const updatedAt = Number(raw.updatedAt) || createdAt
  const taskId = typeof (raw.taskId || raw.id) === 'string' && (raw.taskId || raw.id)
    ? String(raw.taskId || raw.id)
    : nextId('rtask')
  const validKinds = ['approval_resume', 'elevation_resume', 'tool_execution', 'inquiry', 'auto_continue']
  const kind = validKinds.includes(raw.kind)
    ? raw.kind
    : (raw.elevationId || status === 'awaiting_elevation' ? 'elevation_resume' : 'approval_resume')
  const forcedTarget = clamp(spec.forcedTarget !== undefined ? spec.forcedTarget : (raw.forcedTarget || ''), 64)
  const forcedModeRaw = spec.forcedMode !== undefined ? spec.forcedMode : raw.forcedMode
  const forcedMode = ['steer', 'followup', 'silent'].includes(forcedModeRaw) ? forcedModeRaw : 'steer'
  const rawImages = Array.isArray(spec.savedImagePaths) ? spec.savedImagePaths : raw.savedImagePaths
  const savedImagePaths = Array.isArray(rawImages)
    ? rawImages.slice(0, 4).filter(p => p && typeof p.path === 'string').map(p => ({
        index: Number(p.index) || 1,
        path: String(p.path),
        name: clamp(p.name || '', 80),
        mediaType: clamp(p.mediaType || '', 40),
        bytes: Math.max(0, Number(p.bytes) || 0),
      }))
    : []
  const rawCompleted = Array.isArray(spec.completedActions) ? spec.completedActions : raw.completedActions
  const completedActions = Array.isArray(rawCompleted)
    ? rawCompleted.map(x => clamp(x, 220)).filter(Boolean).slice(-12)
    : []
  const retryCount = Math.max(0, Math.min(4, Math.round(Number(raw.retryCount !== undefined ? raw.retryCount : raw.resumeDepth) || 0)))
  const capabilityScope = raw.capabilityScope && typeof raw.capabilityScope === 'object' ? raw.capabilityScope : null
  const payloadHash = typeof raw.payloadHash === 'string' ? raw.payloadHash.trim() : ''
  return {
    id: taskId,
    taskId,
    kind,
    status,
    capabilityScope,
    payloadHash,
    resumeSpec: {
      originalText,
      forcedTarget,
      forcedMode,
      savedImagePaths,
      completedActions,
    },
    originalText,
    forcedTarget,
    forcedMode,
    savedImagePaths,
    completedActions,
    pendingApprovalIds: Array.isArray(raw.pendingApprovalIds)
      ? [...new Set(raw.pendingApprovalIds.map(x => String(x || '').trim()).filter(Boolean))].slice(0, 12)
      : [],
    elevationId: clamp(raw.elevationId || '', 80),
    inquiryId: clamp(raw.inquiryId || '', 80),
    lastReceipt: cleanMultiline(raw.lastReceipt || '', 300),
    retryCount,
    resumeDepth: retryCount,
    createdAt,
    updatedAt,
    expiresAt: Math.max(0, Number(raw.expiresAt) || (createdAt + DEFAULT_RESUME_TTL_MS)),
    resolvedAt: Math.max(0, Number(raw.resolvedAt) || 0),
  }
}

export function recoverTaskLedgerEntriesOnDiskLoad(entries, now = Date.now()) {
  if (!Array.isArray(entries)) return []
  return entries.map((entry) => {
    if (!entry || typeof entry !== 'object') return entry
    const tid = entry.taskId || entry.id
    if (
      (entry.status === 'running' || entry.status === 'resuming' || entry.status === 'verifying')
      && !activeResumingTaskIds.has(tid)
    ) {
      return {
        ...entry,
        status: 'interrupted',
        updatedAt: now,
        lastReceipt: entry.lastReceipt || '检测到上次运行中断，已安全降级为 interrupted 等待人工确认续跑',
      }
    }
    if (
      (entry.status === 'proposed' || entry.status === 'awaiting_approval' || entry.status === 'awaiting_elevation' || entry.status === 'awaiting_inquiry')
      && entry.expiresAt > 0
      && now > entry.expiresAt
    ) {
      return {
        ...entry,
        status: 'expired',
        updatedAt: now,
        resolvedAt: entry.resolvedAt || now,
      }
    }
    return entry
  })
}

export function normalizeAuditEntry(raw) {
  return normalizeAuditRecord(raw, DEFAULT_CHIEF_PERMISSION_MODE)
}


export function emptyWorkspace() {
  const sharedLedger = []
  return {
    config: null,
    chiefRiskAck: null,
    pendingApprovals: [],
    pendingElevation: null,
    taskLedger: sharedLedger,
    resumeTasks: sharedLedger,
    auditLog: [],
    facts: [],
    narrative: { hash: '', text: '', at: 0, byModel: '', clusterSig: '' },
    suggestions: [],
    inquiries: [],
    chat: [],
    mailbox: [],
    seenMailAt: {},
    seenFactsAt: {},
    reviewCursors: {},
    runtimeGuard: {
      lastCompactedSeq: 0,
      lastCompactedAt: 0,
      interventionTurns: 0,
      lastDigestHash: '',
      unchangedCount: 0,
      cooldownUntil: 0,
      circuitBroken: false,
      circuitReason: '',
      hazardAlert: null,
      lastGoalAchievedSig: '',
      autoPilotStartedAt: 0,
      autoPilotHadTurn: false,
      managedStartedAt: 0,
      lastActivityAt: 0,
      lastDreamRoamAt: 0,
      lastAutoArchiveOrgAt: 0,
    },
    flippedPrecipitatedIds: [],
    llmLedger: emptyLlmLedger(),
    alertEvents: [],
    bubbleHarnesses: [],
    bubbleLock: { manualLocked: false, lockedAt: 0, reason: '' },
  }
}

export function normalizeFact(raw) {
  if (!raw || typeof raw !== 'object') return null
  const text = clamp(raw.text, FACT_TEXT_MAX)
  if (!text || secretLike(text)) return null
  const validCategories = ['discipline', 'architecture', 'progress', 'preference', 'team']
  const category = validCategories.includes(raw.category) ? raw.category : 'discipline'
  const peerRootIds = Array.isArray(raw.peerRootIds)
    ? [...new Set(raw.peerRootIds.map(x => String(x || '').trim()).filter(Boolean))].slice(0, 16)
    : []
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : nextId('fact'),
    text,
    category,
    by: clamp(raw.by || 'chief', 36),
    source: clamp(raw.source || '', 60),
    originRootId: typeof raw.originRootId === 'string' ? raw.originRootId.trim() : '',
    ...(peerRootIds.length ? { peerRootIds } : {}),
    pinned: Boolean(raw.pinned),
    addedAt: Number(raw.addedAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Number(raw.addedAt) || Date.now(),
  }
}

export function normalizeSuggestion(raw) {
  if (!raw || typeof raw !== 'object') return null
  const title = clamp(raw.title, 90)
  if (!title) return null
  const kind = ['bound', 'board', 'goal_approval', 'relay', 'advice', 'guard_wall', 'wall_removal', 'archive_op', 'model_effort'].includes(raw.kind) ? raw.kind : 'relay'
  const boundField = ['forbidden', 'allowed', 'notes'].includes(raw.boundField) ? raw.boundField : 'forbidden'
  const replaces = Array.isArray(raw.replaces)
    ? raw.replaces.map(x => String(x || '').trim()).filter(Boolean).slice(0, 20)
    : []
  const wallSpec = raw.wallSpec && typeof raw.wallSpec === 'object' ? { ...raw.wallSpec } : null
  const wallRemovalSpec = raw.wallRemovalSpec && typeof raw.wallRemovalSpec === 'object' ? { ...raw.wallRemovalSpec } : null
  const archiveSpec = (raw.archiveSpec && typeof raw.archiveSpec === 'object')
    ? { ...raw.archiveSpec }
    : ((raw.archiveOp && typeof raw.archiveOp === 'object') ? { ...raw.archiveOp } : null)
  const effortSpec = (raw.effortSpec && typeof raw.effortSpec === 'object')
    ? { ...raw.effortSpec }
    : ((raw.effortOp && typeof raw.effortOp === 'object') ? { ...raw.effortOp } : null)
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : nextId('sug'),
    kind,
    boundField,
    replaces,
    pinGlobal: Boolean(raw.pinGlobal),
    ...(wallSpec ? { wallSpec } : {}),
    ...(wallRemovalSpec ? { wallRemovalSpec } : {}),
    ...(archiveSpec ? { archiveSpec } : {}),
    ...(effortSpec ? { effortSpec } : {}),
    fromAgent: clamp(raw.fromAgent || '', 48),
    title,
    reason: clamp(raw.reason || '', 220),
    target: clamp(raw.target || (kind === 'bound' ? 'bounds' : (kind === 'guard_wall' || kind === 'wall_removal') ? 'guard_walls' : kind === 'goal_approval' ? 'board' : kind === 'archive_op' ? 'archive' : kind === 'model_effort' ? 'lead' : 'lead'), 64),
    targetLabel: clamp(raw.targetLabel || raw.target || (kind === 'bound' ? '工作边界' : kind === 'guard_wall' ? '自定义拦截规则' : kind === 'wall_removal' ? '关闭拦截规则申请' : kind === 'goal_approval' ? '目标结项批示' : kind === 'advice' ? '参谋进言' : kind === 'archive_op' ? '档案与桌面调配' : kind === 'model_effort' ? '模型思考强度调节' : '主对话'), 40),
    mode: ['steer', 'followup', 'silent'].includes(raw.mode) ? raw.mode : (kind === 'advice' ? 'followup' : 'steer'),
    draftText: cleanMultiline(raw.draftText || '', 600),
    evidence: cleanMultiline(raw.evidence || '', 600),
    missing: clamp(raw.missing || '', 300),
    boardOp: raw.boardOp && typeof raw.boardOp === 'object' ? raw.boardOp : null,
    popup: Boolean(raw.popup || kind === 'advice' || kind === 'wall_removal'),
    urgency: ['normal', 'high'].includes(raw.urgency) ? raw.urgency : (kind === 'wall_removal' ? 'high' : 'normal'),
    status: ['pending', 'applied', 'dismissed'].includes(raw.status) ? raw.status : 'pending',
    createdAt: Number(raw.createdAt) || Date.now(),
  }
}

export function normalizeInquiryItem(raw) {
  if (!raw || typeof raw !== 'object') return null
  const question = cleanMultiline(raw.question || raw.text || '', 600)
  if (!question) return null
  const status = ['pending', 'delivered', 'answered', 'expired'].includes(raw.status) ? raw.status : 'pending'
  const inquiryId = typeof (raw.inquiryId || raw.id) === 'string' && (raw.inquiryId || raw.id)
    ? String(raw.inquiryId || raw.id)
    : nextId('inq')
  return {
    id: inquiryId,
    inquiryId,
    taskId: clamp(raw.taskId || '', 80),
    target: clamp(raw.target || 'lead', 64),
    question,
    context: clamp(raw.context || '', 220),
    answer: cleanMultiline(raw.answer || '', 1200),
    status,
    by: clamp(raw.by || 'chief', 40),
    answeredBy: clamp(raw.answeredBy || '', 40),
    createdAt: Number(raw.createdAt) || Date.now(),
    deliveredAt: Number(raw.deliveredAt) || 0,
    answeredAt: Number(raw.answeredAt) || 0,
    expiresAt: Number(raw.expiresAt) || ((Number(raw.createdAt) || Date.now()) + DEFAULT_RESUME_TTL_MS),
  }
}

export function normalizeMail(raw) {
  if (!raw || typeof raw !== 'object') return null
  const imageCount = Math.max(0, Math.round(Number(raw.imageCount) || 0))
  const text = cleanMultiline(raw.text, 1500) || (imageCount > 0 ? `[附图 ×${imageCount}]` : '')
  if (!text) return null
  const participantRoots = Array.isArray(raw.participantRoots)
    ? [...new Set(raw.participantRoots.map(x => String(x || '').trim()).filter(Boolean))].sort().slice(0, 24)
    : []
  const validChannels = ['internal', 'pair', 'multi', 'broadcast']
  const channelType = validChannels.includes(raw.channelType) ? raw.channelType : ''
  const validRoutedStatuses = ['delivered', 'queued', 'unrouted', 'stale_target']
  const routedStatus = validRoutedStatuses.includes(raw.routedStatus) ? raw.routedStatus : ''
  const resolvedAgentId = typeof raw.resolvedAgentId === 'string' ? raw.resolvedAgentId.trim().slice(0, 128) : ''
  const resolvedVia = typeof raw.resolvedVia === 'string' ? raw.resolvedVia.trim().slice(0, 64) : ''
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : nextId('mail'),
    from: clamp(raw.from || 'agent', 48),
    fromSession: String(raw.fromSession || ''),
    fromRootId: String(raw.fromRootId || ''),
    to: clamp(raw.to || 'lead', 64),
    toSession: String(raw.toSession || ''),
    toRootId: String(raw.toRootId || ''),
    ...(participantRoots.length ? { participantRoots } : {}),
    ...(channelType ? { channelType } : {}),
    ...(raw.broadcastId ? { broadcastId: String(raw.broadcastId) } : {}),
    subject: clamp(raw.subject || '', 80),
    text,
    ...(imageCount > 0 ? { imageCount } : {}),
    mode: ['steer', 'followup', 'silent'].includes(raw.mode) ? raw.mode : 'steer',
    deliveredPhysical: Boolean(raw.deliveredPhysical),
    ...(routedStatus ? { routedStatus } : {}),
    ...(resolvedAgentId ? { resolvedAgentId } : {}),
    ...(resolvedVia ? { resolvedVia } : {}),
    readBy: Array.isArray(raw.readBy) ? raw.readBy.map(String).slice(0, 32) : [],
    at: Number(raw.at) || Date.now(),
  }
}

export function normalizeWorkspace(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const base = emptyWorkspace()
  base.facts = (Array.isArray(src.facts) ? src.facts : []).map(normalizeFact).filter(Boolean).slice(-FACTS_CAP)
  if (src.narrative && typeof src.narrative === 'object') {
    base.narrative = {
      hash: String(src.narrative.hash || ''),
      text: String(src.narrative.text || ''),
      at: Number(src.narrative.at) || 0,
      byModel: String(src.narrative.byModel || ''),
      clusterSig: String(src.narrative.clusterSig || ''),
    }
  }
  base.suggestions = (Array.isArray(src.suggestions) ? src.suggestions : [])
    .map(normalizeSuggestion)
    .filter(Boolean)
    .slice(-SUGGESTIONS_CAP * 2)
  base.inquiries = (Array.isArray(src.inquiries) ? src.inquiries : [])
    .map(normalizeInquiryItem)
    .filter(Boolean)
    .slice(-24)
  base.chat = (Array.isArray(src.chat) ? src.chat : [])
    .filter(item => item && typeof item === 'object' && typeof item.text === 'string')
    .slice(-CHAT_CAP)
    .map(item => {
      const imageCount = Math.max(0, Math.round(Number(item.imageCount) || 0))
      const kind = item.kind === 'receipt' ? 'receipt' : (item.kind === 'qa' ? 'qa' : '')
      const resumeTaskId = item.resumeTaskId ? String(item.resumeTaskId) : ''
      const thinkingEffort = typeof item.thinkingEffort === 'string' && item.thinkingEffort ? item.thinkingEffort : ''
      const thinkingEffortMode = item.thinkingEffortMode === 'auto' || item.thinkingEffortMode === 'manual' ? item.thinkingEffortMode : ''
      return {
        id: String(item.id || nextId('chat')),
        role: item.role === 'user' ? 'user' : 'chief',
        text: cleanMultiline(item.text, 2000),
        target: item.target ? String(item.target) : '',
        ...(kind ? { kind } : {}),
        ...(resumeTaskId ? { resumeTaskId } : {}),
        ...(thinkingEffort ? { thinkingEffort } : {}),
        ...(thinkingEffortMode ? { thinkingEffortMode } : {}),
        ...(item.isOneStopReport ? { isOneStopReport: true } : {}),
        ...(imageCount > 0 ? { imageCount } : {}),
        actions: Array.isArray(item.actions) ? item.actions.slice(0, 8) : [],
        at: Number(item.at) || Date.now(),
      }
    })
  base.mailbox = (Array.isArray(src.mailbox) ? src.mailbox : []).map(normalizeMail).filter(Boolean).slice(-MAIL_CAP)
  base.seenMailAt = src.seenMailAt && typeof src.seenMailAt === 'object' ? { ...src.seenMailAt } : {}
  base.seenFactsAt = src.seenFactsAt && typeof src.seenFactsAt === 'object' ? { ...src.seenFactsAt } : {}
  base.reviewCursors = src.reviewCursors && typeof src.reviewCursors === 'object' ? { ...src.reviewCursors } : {}
  const rg = src.runtimeGuard && typeof src.runtimeGuard === 'object' ? src.runtimeGuard : {}
  base.runtimeGuard = {
    lastCompactedSeq: Math.max(0, Math.round(Number(rg.lastCompactedSeq) || 0)),
    lastCompactedAt: Math.max(0, Number(rg.lastCompactedAt) || 0),
    autoCompactCount: Math.max(0, Math.round(Number(rg.autoCompactCount) || 0)),
    pendingSmartCompact: rg.pendingSmartCompact && typeof rg.pendingSmartCompact === 'object'
      ? {
          at: Number(rg.pendingSmartCompact.at) || Date.now(),
          reason: clamp(rg.pendingSmartCompact.reason || '', 240),
          by: clamp(rg.pendingSmartCompact.by || 'lead', 40),
        }
      : null,
    interventionTurns: Math.max(0, Math.round(Number(rg.interventionTurns) || 0)),
    lastDigestHash: String(rg.lastDigestHash || ''),
    unchangedCount: Math.max(0, Math.round(Number(rg.unchangedCount) || 0)),
    cooldownUntil: Math.max(0, Number(rg.cooldownUntil) || 0),
    circuitBroken: Boolean(rg.circuitBroken),
    circuitReason: String(rg.circuitReason || ''),
    hazardAlert: rg.hazardAlert && typeof rg.hazardAlert === 'object' && (rg.hazardAlert.reason || rg.hazardAlert.title)
      ? {
          id: String(rg.hazardAlert.id || ''),
          category: clamp(rg.hazardAlert.category || 'irreversible_risk', 40),
          title: clamp(rg.hazardAlert.title || '强介入安全煞停', 120),
          reason: cleanMultiline(rg.hazardAlert.reason || '', 600),
          objective: clamp(rg.hazardAlert.objective || '', 300),
          at: Math.max(0, Number(rg.hazardAlert.at) || 0),
        }
      : null,
    lastGoalAchievedSig: String(rg.lastGoalAchievedSig || ''),
    autoPilotStartedAt: Math.max(0, Number(rg.autoPilotStartedAt) || 0),
    autoPilotHadTurn: Boolean(rg.autoPilotHadTurn),
    managedStartedAt: Math.max(0, Number(rg.managedStartedAt) || Number(rg.autoPilotStartedAt) || 0),
    lastActivityAt: Math.max(0, Number(rg.lastActivityAt) || 0),
    lastDreamRoamAt: Math.max(0, Number(rg.lastDreamRoamAt) || 0),
    lastAutoArchiveOrgAt: Math.max(0, Number(rg.lastAutoArchiveOrgAt) || 0),
    peerDropState: rg.peerDropState && typeof rg.peerDropState === 'object' && Number(rg.peerDropState.at) > 0
      ? {
          at: Math.max(0, Number(rg.peerDropState.at) || 0),
          reason: clamp(rg.peerDropState.reason || '', 180),
          trigger: clamp(rg.peerDropState.trigger || '', 60),
          skipped: clamp(rg.peerDropState.skipped || '', 60),
        }
      : null,
  }
  base.chiefRiskAck = normalizeChiefRiskAck(src.chiefRiskAck)
  base.pendingApprovals = (Array.isArray(src.pendingApprovals) ? src.pendingApprovals : [])
    .map(normalizePendingApproval)
    .filter(Boolean)
    .slice(-APPROVALS_CAP)
  base.pendingElevation = normalizePendingElevation(src.pendingElevation)
  const rawLedgerSrc = Array.isArray(src.taskLedger) && src.taskLedger.length > 0
    ? src.taskLedger
    : (Array.isArray(src.resumeTasks) ? src.resumeTasks : [])
  const normalizedLedger = rawLedgerSrc
    .map(normalizeTaskLedgerEntry)
    .filter(Boolean)
    .slice(-TASK_LEDGER_CAP)
  base.taskLedger = normalizedLedger
  base.resumeTasks = normalizedLedger
  base.auditLog = (Array.isArray(src.auditLog) ? src.auditLog : [])
    .map(normalizeAuditEntry)
    .filter(Boolean)
    .slice(-AUDIT_LOG_CAP)
  const ackOk = hasValidChiefRiskAck(base)
  if (src.config && typeof src.config === 'object') {
    const validPaces = ['manual', 'smart', 'auto', 'stopped']
    const pm = validPaces.includes(src.config.paceMode) ? src.config.paceMode : undefined
    const rawStopped = typeof src.config.stopped === 'boolean' ? src.config.stopped : (pm === 'stopped')
    const rm = normalizeRunMode(src.config.runMode, { ...src.config, stopped: rawStopped, paceMode: pm })
    const rawPerm = typeof src.config.permissionMode === 'string'
      ? normalizePermissionMode(src.config.permissionMode, { requireAck: true, hasChiefRiskAck: ackOk })
      : DEFAULT_CHIEF_PERMISSION_MODE
    const plugCheck = validatePolicyPluginList(src.config.policyPlugins)
    const policyPlugins = plugCheck.ok ? plugCheck.plugins : []
    const lockedModelEfforts = normalizeLockedModelEfforts(src.config.lockedModelEfforts)
    const managedIdleTimeoutMs = Number.isFinite(Number(src.config.managedIdleTimeoutMs)) && Number(src.config.managedIdleTimeoutMs) >= 50
      ? Math.min(2 * 60 * 60 * 1000, Math.round(Number(src.config.managedIdleTimeoutMs)))
      : DEFAULT_MANAGED_IDLE_TIMEOUT_MS
    base.config = {
      ...(typeof src.config.modelRef === 'string' ? { modelRef: src.config.modelRef.trim() } : {}),
      ...(typeof src.config.sessionEnabled === 'boolean' ? { sessionEnabled: src.config.sessionEnabled } : {}),
      permissionMode: rawPerm,
      runMode: rm,
      managedIdleTimeoutMs,
      ...(typeof src.config.notifyEnabled === 'boolean' ? { notifyEnabled: src.config.notifyEnabled } : {}),
      ...(typeof src.config.notifySound === 'boolean' ? { notifySound: src.config.notifySound } : {}),
      ...(typeof src.config.uiLang === 'string' ? { uiLang: normalizeUiLang(src.config.uiLang) } : {}),
      ...(src.config.managedBudgetMaxCalls !== undefined ? { managedBudgetMaxCalls: normalizeManagedBudgetCalls(src.config.managedBudgetMaxCalls) } : {}),
      ...(src.config.managedBudgetMaxTokens !== undefined ? { managedBudgetMaxTokens: normalizeManagedBudgetTokens(src.config.managedBudgetMaxTokens) } : {}),
      ...(typeof src.config.thinkingEffort === 'string' ? { thinkingEffort: normalizeThinkingEffort(src.config.thinkingEffort) } : {}),
      ...(typeof src.config.teamEffortMode === 'string' ? { teamEffortMode: normalizeTeamEffortMode(src.config.teamEffortMode) } : {}),
      ...(Object.keys(lockedModelEfforts).length ? { lockedModelEfforts } : {}),
      ...(typeof src.config.stopped === 'boolean' || pm === 'stopped' ? { stopped: rawStopped } : {}),
      ...(pm ? { paceMode: pm, autoPilot: !rawStopped && pm === 'auto', autoReview: !rawStopped && pm !== 'manual' } : {}),
      ...(policyPlugins.length > 0 ? { policyPlugins } : {}),
      ...(src.config.tacticalModes && typeof src.config.tacticalModes === 'object'
        ? { tacticalModes: normalizeTacticalModes(src.config.tacticalModes) }
        : {}),
    }
  }
  base.flippedPrecipitatedIds = Array.isArray(src.flippedPrecipitatedIds)
    ? [...new Set(src.flippedPrecipitatedIds.map(x => String(x || '').trim()).filter(Boolean))].slice(0, 20)
    : []
  base.llmLedger = normalizeLlmLedger(src.llmLedger)
  base.alertEvents = (Array.isArray(src.alertEvents) ? src.alertEvents : [])
    .map(normalizeAlertEvent)
    .filter(Boolean)
    .slice(-ALERT_EVENTS_CAP)
  const rawHarnesses = Array.isArray(src.bubbleHarnesses) ? src.bubbleHarnesses : []
  const seenHarnesses = new Set()
  base.bubbleHarnesses = []
  for (const hItem of rawHarnesses) {
    const normH = normalizeBubbleHarness(hItem)
    if (!normH || seenHarnesses.has(normH.provider)) continue
    seenHarnesses.add(normH.provider)
    base.bubbleHarnesses.push(normH)
    if (base.bubbleHarnesses.length >= 12) break
  }
  const rawBl = src.bubbleLock && typeof src.bubbleLock === 'object' ? src.bubbleLock : {}
  base.bubbleLock = {
    manualLocked: Boolean(rawBl.manualLocked),
    lockedAt: Math.max(0, Number(rawBl.lockedAt) || 0),
    reason: clamp(rawBl.reason || '', 120),
  }
  return base
}

export const COMPACT_THRESHOLD_MIN_PCT = 10

export const COMPACT_THRESHOLD_MAX_PCT = 95

export const COMPACT_PCT_WARN_FLOOR = 25

export const COMPACT_TOKEN_HARD_MIN = 8_000

export const COMPACT_TOKEN_WARN_FLOOR = 32_000

/** Format a token threshold cleanly into compact K/M display notation (e.g. `64K`, `1M`). */
export function formatCompactTokenShort(tokens) {
  const n = Math.max(0, Math.round(Number(tokens) || 0))
  if (n >= 1_000_000 && n % 100_000 === 0) {
    const m = n / 1_000_000
    return (Number.isInteger(m) ? String(m) : m.toFixed(1).replace(/\.0$/, '')) + 'M'
  }
  if (n >= 1_000) {
    const k = n / 1_000
    return (k >= 100 ? String(Math.round(k)) : k.toFixed(1).replace(/\.0$/, '')) + 'K'
  }
  return String(n)
}

/**
 * Parse custom context size threshold input (`'1M'` -> 1,000,000; `'64K'` -> 64,000; bare `'64'` -> `64K`).
 * Bare numbers without a unit default to K, and values below `32K` attach a low-threshold warning.
 */
export function parseCompactTokensInput(rawInput) {
  const s = String(rawInput ?? '').trim()
  if (!s) return { ok: false, error: '请输入上下文阈值，例如 64K、1M 或纯数字（无单位默认为 K）' }
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(k|m|t|tokens?)?$/i)
  if (!m) return { ok: false, error: '格式无效：支持如 64K、1M 或纯数字（无单位默认为 K）' }
  const num = Number(m[1])
  if (!Number.isFinite(num) || num <= 0) return { ok: false, error: '上下文阈值必须大于 0' }
  const unit = (m[2] || 'k').toLowerCase()
  let rawTokens = 0
  if (unit === 'm') rawTokens = Math.round(num * 1_000_000)
  else if (unit === 'k') rawTokens = Math.round(num * 1_000)
  else rawTokens = Math.round(num)
  const tokens = Math.max(COMPACT_TOKEN_HARD_MIN, rawTokens)
  const displayInput = formatCompactTokenShort(tokens)
  const lowWarning = tokens < COMPACT_TOKEN_WARN_FLOOR
    ? `当前阈值（${displayInput}）低于安全建议线 32K，可能导致上下文频繁压缩丢失现场细节`
    : ''
  return {
    ok: true,
    tokens,
    rawTokens,
    clampedToMin: rawTokens < COMPACT_TOKEN_HARD_MIN,
    displayInput,
    lowWarning,
  }
}

/**
 * Determine whether DSH Chief is active for a specific root session.
 * Priority: explicit per-session flag > legacy configured/populated workspace > global defaultAutoEnableSessions (default false).
 */
export function isChiefSessionEnabled(state, sessionId = '') {
  const safeState = state && typeof state === 'object' ? state : {}
  const base = safeState.config && typeof safeState.config === 'object' ? safeState.config : {}
  const sid = String(sessionId || '').trim()
  if (!sid || sid === 'global') return Boolean(base.defaultAutoEnableSessions === true)
  const ws = safeState.workspaces && safeState.workspaces[sid] ? safeState.workspaces[sid] : null
  const wsCfg = ws && ws.config && typeof ws.config === 'object' ? ws.config : null
  if (wsCfg && typeof wsCfg.sessionEnabled === 'boolean') {
    return wsCfg.sessionEnabled
  }
  if (wsCfg) return true
  if (
    ws
    && (
      (Array.isArray(ws.chat) && ws.chat.length > 0)
      || (Array.isArray(ws.facts) && ws.facts.length > 0)
      || (Array.isArray(ws.mailbox) && ws.mailbox.length > 0)
      || (Array.isArray(ws.bubbleHarnesses) && ws.bubbleHarnesses.length > 0)
    )
  ) {
    return true
  }
  if (safeState.links && typeof safeState.links === 'object') {
    if (Array.isArray(safeState.links[sid]) && safeState.links[sid].length > 0) return true
    for (const arr of Object.values(safeState.links)) {
      if (Array.isArray(arr) && arr.includes(sid)) return true
    }
  }
  return Boolean(base.defaultAutoEnableSessions === true)
}

/** Resolve effective Chief config for a specific root session (isolates `intervention` and `permissionMode` per session). */
export function resolveWorkspaceConfig(state, sessionId = '') {
  const safeState = state && typeof state === 'object' ? state : {}
  const base = safeState.config && typeof safeState.config === 'object' ? safeState.config : {}
  const baseTactical = normalizeTacticalModes(base.tacticalModes)
  const sid = String(sessionId || '').trim()
  const ws = sid && safeState.workspaces && safeState.workspaces[sid] ? safeState.workspaces[sid] : null
  const wsCfg = ws && ws.config && typeof ws.config === 'object' ? ws.config : null
  const validPaces = ['manual', 'smart', 'auto', 'stopped']
  const basePaceSafe = validPaces.includes(base.paceMode) && !(sid && base.paceMode === 'auto')
    ? base.paceMode
    : 'manual'
  const rawPaceMode = wsCfg && validPaces.includes(wsCfg.paceMode)
    ? wsCfg.paceMode
    : basePaceSafe
  const explicitStopped = wsCfg && typeof wsCfg.stopped === 'boolean'
    ? wsCfg.stopped
    : (typeof base.stopped === 'boolean' ? base.stopped : false)
  const stopped = rawPaceMode === 'stopped' || explicitStopped
  const paceMode = stopped ? 'stopped' : rawPaceMode
  const modelRef = wsCfg && typeof wsCfg.modelRef === 'string'
    ? wsCfg.modelRef.trim()
    : (typeof base.modelRef === 'string' ? base.modelRef.trim() : '')
  const globalSafetyGuardEnabled = baseTactical.safetyGuardEnabled !== false
  const sessionSafetyGuardEnabled = !(wsCfg && wsCfg.tacticalModes && wsCfg.tacticalModes.safetyGuardEnabled === false)
  const mergedTactical = wsCfg && wsCfg.tacticalModes
    ? normalizeTacticalModes({ ...baseTactical, ...wsCfg.tacticalModes })
    : { ...baseTactical, ...(sid ? { intervention: false } : {}) }
  mergedTactical.safetyGuardEnabled = globalSafetyGuardEnabled && sessionSafetyGuardEnabled
  const ackOk = hasValidChiefRiskAck(ws)
  const rawPerm = (wsCfg && typeof wsCfg.permissionMode === 'string')
    ? wsCfg.permissionMode
    : DEFAULT_CHIEF_PERMISSION_MODE
  const globalPlugCheck = validatePolicyPluginList(base.policyPlugins)
  const wsPlugCheck = validatePolicyPluginList(wsCfg && wsCfg.policyPlugins)
  const policyPlugins = [
    ...(globalPlugCheck.ok ? globalPlugCheck.plugins : []),
    ...(wsPlugCheck.ok ? wsPlugCheck.plugins : []),
  ]
  const resolvedRoleCaps = resolveRoleCapabilities(rawPerm, {
    hasChiefRiskAck: ackOk,
    policyPlugins,
  })
  const permissionMode = resolvedRoleCaps.role
  const chiefRiskVerified = permissionMode === 'chief' ? ackOk : false
  const runMode = stopped
    ? 'off'
    : (wsCfg && typeof wsCfg.runMode === 'string' && CHIEF_RUN_MODES.includes(wsCfg.runMode)
        ? wsCfg.runMode
        : normalizeRunMode(undefined, { stopped, paceMode, autoPilot: paceMode === 'auto' }))
  const thinkingEffort = normalizeThinkingEffort(
    (wsCfg && typeof wsCfg.thinkingEffort === 'string' && wsCfg.thinkingEffort)
      || (typeof base.thinkingEffort === 'string' && base.thinkingEffort)
      || 'auto',
  )
  const teamEffortMode = normalizeTeamEffortMode(
    (wsCfg && typeof wsCfg.teamEffortMode === 'string' && wsCfg.teamEffortMode)
      || (typeof base.teamEffortMode === 'string' && base.teamEffortMode)
      || 'auto',
  )
  const lockedModelEfforts = normalizeLockedModelEfforts(wsCfg && wsCfg.lockedModelEfforts)
  const managedIdleTimeoutMs = wsCfg && Number.isFinite(Number(wsCfg.managedIdleTimeoutMs)) && Number(wsCfg.managedIdleTimeoutMs) >= 50
    ? Math.min(2 * 60 * 60 * 1000, Math.round(Number(wsCfg.managedIdleTimeoutMs)))
    : (Number.isFinite(Number(base.managedIdleTimeoutMs)) && Number(base.managedIdleTimeoutMs) >= 50
        ? Math.min(2 * 60 * 60 * 1000, Math.round(Number(base.managedIdleTimeoutMs)))
        : DEFAULT_MANAGED_IDLE_TIMEOUT_MS)
  const notifyEnabled = typeof (wsCfg && wsCfg.notifyEnabled) === 'boolean'
    ? wsCfg.notifyEnabled
    : (typeof base.notifyEnabled === 'boolean' ? base.notifyEnabled : true)
  const notifySound = typeof (wsCfg && wsCfg.notifySound) === 'boolean'
    ? wsCfg.notifySound
    : (typeof base.notifySound === 'boolean' ? base.notifySound : false)
  const uiLang = normalizeUiLang(
    (wsCfg && typeof wsCfg.uiLang === 'string' && wsCfg.uiLang)
      || (typeof base.uiLang === 'string' && base.uiLang)
      || 'auto',
  )
  const managedBudgetMaxCalls = (wsCfg && wsCfg.managedBudgetMaxCalls !== undefined)
    ? normalizeManagedBudgetCalls(wsCfg.managedBudgetMaxCalls)
    : (base.managedBudgetMaxCalls !== undefined
        ? normalizeManagedBudgetCalls(base.managedBudgetMaxCalls)
        : DEFAULT_MANAGED_BUDGET_MAX_CALLS)
  const managedBudgetMaxTokens = (wsCfg && wsCfg.managedBudgetMaxTokens !== undefined)
    ? normalizeManagedBudgetTokens(wsCfg.managedBudgetMaxTokens)
    : (base.managedBudgetMaxTokens !== undefined
        ? normalizeManagedBudgetTokens(base.managedBudgetMaxTokens)
        : DEFAULT_MANAGED_BUDGET_MAX_TOKENS)
  return {
    modelRef,
    chiefName: normalizeChiefName(base.chiefName),
    sessionEnabled: isChiefSessionEnabled(safeState, sid),
    defaultAutoEnableSessions: Boolean(base.defaultAutoEnableSessions === true),
    paceMode,
    runMode,
    managedIdleTimeoutMs,
    notifyEnabled,
    notifySound,
    uiLang,
    uiSkin: normalizeUiSkinPref(base.uiSkin),
    customSkin: normalizeServerCustomSkin(base.customSkin),
    managedBudgetMaxCalls,
    managedBudgetMaxTokens,
    thinkingEffort,
    teamEffortMode,
    lockedModelEfforts,
    stopped,
    permissionMode,
    capabilities: resolvedRoleCaps.capabilities,
    policyPlugins,
    chiefRiskVerified,
    autoPilot: !stopped && runMode === 'managed',
    autoReview: !stopped && runMode === 'managed',
    globalSafetyGuardEnabled,
    sessionSafetyGuardEnabled,
    externalMemory: normalizeExternalMemoryConfig(base.externalMemory),
    tts: normalizeTtsConfig(base.tts),
    remotePager: normalizePagerConfig(base.remotePager),
    tacticalModes: mergedTactical,
  }
}

export const DEFAULT_TACTICAL_MODES = {
  intervention: false,
  autoCompact: false,
  smartCompact: false,
  compactThresholdMode: 'pct',
  compactThresholdPct: 80,
  compactThresholdTokens: 64_000,
  compactThresholdInput: '64K',
  strictVerify: false,
  redlineSentinel: false,
  conciseBrief: false,
  safetyGuardEnabled: true,
  maxInterventionTurns: 10,
}

export function normalizeTacticalModes(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const pct = Math.round(Number(src.compactThresholdPct) || DEFAULT_TACTICAL_MODES.compactThresholdPct)
  const mode = src.compactThresholdMode === 'tokens' ? 'tokens' : 'pct'
  const rawTokens = Math.round(Number(src.compactThresholdTokens) || DEFAULT_TACTICAL_MODES.compactThresholdTokens)
  const compactThresholdTokens = Math.max(COMPACT_TOKEN_HARD_MIN, rawTokens)
  const compactThresholdInput = typeof src.compactThresholdInput === 'string' && src.compactThresholdInput.trim()
    ? src.compactThresholdInput.trim()
    : formatCompactTokenShort(compactThresholdTokens)
  const rawTurns = src.maxInterventionTurns
  const isZeroTurns = rawTurns === 0 || rawTurns === '0'
  const parsedTurns = isZeroTurns
    ? 0
    : Math.min(30, Math.max(1, Math.round(Number(rawTurns) || DEFAULT_TACTICAL_MODES.maxInterventionTurns)))
  return {
    intervention: Boolean(src.intervention),
    autoCompact: Boolean(src.autoCompact),
    smartCompact: Boolean(src.smartCompact),
    compactThresholdMode: mode,
    compactThresholdPct: Math.min(COMPACT_THRESHOLD_MAX_PCT, Math.max(COMPACT_THRESHOLD_MIN_PCT, pct)),
    compactThresholdTokens,
    compactThresholdInput,
    strictVerify: Boolean(src.strictVerify),
    redlineSentinel: Boolean(src.redlineSentinel),
    conciseBrief: Boolean(src.conciseBrief),
    safetyGuardEnabled: src.safetyGuardEnabled !== false,
    maxInterventionTurns: parsedTurns,
  }
}

export function normalizeState(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const cfg = src.config && typeof src.config === 'object' ? src.config : {}
  const links = {}
  if (src.links && typeof src.links === 'object') {
    for (const [k, list] of Object.entries(src.links)) {
      if (!k || !Array.isArray(list)) continue
      const clean = [...new Set(list.map(v => String(v || '').trim()).filter(v => v && v !== k))]
      if (clean.length) links[k] = clean
    }
  }
  const workspaces = {}
  if (src.workspaces && typeof src.workspaces === 'object') {
    for (const [k, ws] of Object.entries(src.workspaces)) {
      if (!k) continue
      workspaces[k] = normalizeWorkspace(ws)
    }
  }
  const validPaces = ['manual', 'smart', 'auto', 'stopped']
  // Default to 'manual' (human-paced, zero background token burn) unless explicitly set to smart/auto
  const rawPace = validPaces.includes(cfg.paceMode) ? cfg.paceMode : 'manual'
  const stopped = rawPace === 'stopped' || Boolean(cfg.stopped)
  const paceMode = stopped ? 'stopped' : rawPace
  const globalPlugRes = validatePolicyPluginList(cfg.policyPlugins)
  return {
    version: STATE_VERSION,
    config: {
      modelRef: typeof cfg.modelRef === 'string' ? cfg.modelRef.trim() : '',
      chiefName: normalizeChiefName(cfg.chiefName),
      defaultAutoEnableSessions: Boolean(cfg.defaultAutoEnableSessions),
      paceMode,
      runMode: stopped ? 'off' : normalizeRunMode(cfg.runMode, { stopped, paceMode }),
      managedIdleTimeoutMs: Number.isFinite(Number(cfg.managedIdleTimeoutMs)) && Number(cfg.managedIdleTimeoutMs) >= 50
        ? Math.min(2 * 60 * 60 * 1000, Math.round(Number(cfg.managedIdleTimeoutMs)))
        : DEFAULT_MANAGED_IDLE_TIMEOUT_MS,
      notifyEnabled: typeof cfg.notifyEnabled === 'boolean' ? cfg.notifyEnabled : true,
      notifySound: typeof cfg.notifySound === 'boolean' ? cfg.notifySound : false,
      uiLang: normalizeUiLang(cfg.uiLang),
      uiSkin: normalizeUiSkinPref(cfg.uiSkin),
      customSkin: normalizeServerCustomSkin(cfg.customSkin),
      managedBudgetMaxCalls: normalizeManagedBudgetCalls(cfg.managedBudgetMaxCalls),
      managedBudgetMaxTokens: normalizeManagedBudgetTokens(cfg.managedBudgetMaxTokens),
      thinkingEffort: normalizeThinkingEffort(cfg.thinkingEffort),
      teamEffortMode: normalizeTeamEffortMode(cfg.teamEffortMode),
      stopped,
      permissionMode: DEFAULT_CHIEF_PERMISSION_MODE,
      autoPilot: !stopped && paceMode === 'auto',
      autoReview: !stopped && paceMode !== 'manual',
      ...(globalPlugRes.ok && globalPlugRes.plugins.length > 0 ? { policyPlugins: globalPlugRes.plugins } : {}),
      externalMemory: normalizeExternalMemoryConfig(cfg.externalMemory),
      tts: normalizeTtsConfig(cfg.tts),
      remotePager: normalizePagerConfig(cfg.remotePager),
      tacticalModes: normalizeTacticalModes(cfg.tacticalModes),
      ...(Array.isArray(cfg.guardWallPresetsSeededPaths)
        ? {
            guardWallPresetsSeededPaths: cfg.guardWallPresetsSeededPaths
              .map(s => String(s || '').trim())
              .filter(Boolean)
              .slice(-24),
          }
        : {}),
    },
    links,
    workspaces,
  }
}


export function shortAgentBriefName(name) {
  const raw = String(name || '').trim()
  if (!raw) return ''
  return raw
    .split('/')
    .map(seg => seg.replace(/[-_]([0-9a-f]{8,40})$/i, (_, hex) => '·' + hex.slice(0, 4)))
    .join('/')
}

export function stripCheckpointNoise(text) {
  return String(text || '')
    .replace(/\[dsh-mnemon:[^\]]*\][\s\S]*/gi, '')
    .replace(/Bounded completed checkpoint[\s\S]*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isInternalCheckpointNoise(text) {
  const s = stripCheckpointNoise(text)
  if (!s) return true
  if (/^Mnemon idle checkpoint review\b/i.test(s)) return true
  return false
}

export function repairJsonInvalidEscapes(jsonStr) {
  let out = ''
  let inString = false
  for (let i = 0; i < jsonStr.length; i += 1) {
    const ch = jsonStr[i]
    if (!inString) {
      if (ch === '"') inString = true
      out += ch
      continue
    }
    if (ch === '"') {
      inString = false
      out += ch
      continue
    }
    if (ch === '\\') {
      const next = jsonStr[i + 1]
      if (next === undefined) {
        out += '\\\\'
        continue
      }
      if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(jsonStr.slice(i + 2, i + 6))) {
        out += jsonStr.slice(i, i + 6)
        i += 5
        continue
      }
      if ('"\\/bfnrt'.includes(next)) {
        out += '\\' + next
        i += 1
        continue
      }
      // Escape invalid bare backslash (e.g. regex \s, \., Windows D:\path) inside JSON strings
      out += '\\\\'
      continue
    }
    out += ch
  }
  return out
}

export function tryParseJsonRobust(candidate) {
  if (!candidate) return null
  try {
    const parsed = JSON.parse(candidate)
    if (parsed && typeof parsed === 'object') return parsed
  } catch {}
  try {
    const repaired = repairJsonInvalidEscapes(candidate)
    const parsed = JSON.parse(repaired)
    if (parsed && typeof parsed === 'object') return parsed
  } catch {}
  return null
}

export function extractJsonObject(raw) {
  const text = String(raw || '').trim()
  if (!text) return null
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const direct = tryParseJsonRobust(stripped)
  if (direct) return direct
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first !== -1 && last > first) {
    const sliced = tryParseJsonRobust(text.slice(first, last + 1))
    if (sliced) return sliced
  }
  return null
}

const activeChiefWorkMap = new Map()
const ACTIVE_CHIEF_WORK_TTL_MS = 90_000

export function beginChiefActiveWork(rootSessionId, spec = {}) {
  const key = String(rootSessionId || 'global').trim() || 'global'
  const id = 'cwork-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
  activeChiefWorkMap.set(key, {
    id,
    tone: String(spec.tone || 'neon'),
    tab: String(spec.tab || ''),
    boundSubTab: String(spec.boundSubTab || ''),
    label: String(spec.label || '参谋长正在自动维护中...'),
    startedAt: Date.now(),
  })
  return id
}

export function updateChiefActiveWork(rootSessionId, workId, patchSpec = {}) {
  const key = String(rootSessionId || 'global').trim() || 'global'
  const cur = activeChiefWorkMap.get(key)
  if (!cur || (workId && cur.id !== workId)) return false
  activeChiefWorkMap.set(key, {
    ...cur,
    ...(patchSpec.tone ? { tone: String(patchSpec.tone) } : {}),
    ...(patchSpec.tab !== undefined ? { tab: String(patchSpec.tab || '') } : {}),
    ...(patchSpec.boundSubTab !== undefined ? { boundSubTab: String(patchSpec.boundSubTab || '') } : {}),
    ...(patchSpec.label ? { label: String(patchSpec.label) } : {}),
  })
  return true
}

export function endChiefActiveWork(rootSessionId, workId = '') {
  const key = String(rootSessionId || 'global').trim() || 'global'
  const cur = activeChiefWorkMap.get(key)
  if (!cur) return false
  if (workId && cur.id !== workId) return false
  activeChiefWorkMap.delete(key)
  return true
}

export function getChiefActiveWork(rootSessionId) {
  const key = String(rootSessionId || 'global').trim() || 'global'
  const cur = activeChiefWorkMap.get(key)
  if (!cur) return null
  if (Date.now() - Number(cur.startedAt || 0) > ACTIVE_CHIEF_WORK_TTL_MS) {
    activeChiefWorkMap.delete(key)
    return null
  }
  return { ...cur }
}

/** Persist a critical alert event onto a workspace so UI can fire desktop notifications / gentle chimes without replay storms. */

export const OFFICIAL_HARNESS_CATALOG = [
  {
    provider: 'codex',
    label: 'Codex',
    packageName: '@deepseek-ai/dsh-subagent-codex',
    accent: '#10b981',
    roleHint: '独立代码实现 / 重构 / 单测',
  },
  {
    provider: 'claude-code',
    label: 'Claude Code',
    packageName: '@deepseek-ai/dsh-subagent-claude-code',
    accent: '#f59e0b',
    roleHint: '架构审查 / 深度排障 / 代码评审',
  },
  {
    provider: 'gemini',
    label: 'Gemini CLI',
    packageName: '@deepseek-ai/dsh-subagent-gemini',
    accent: '#38bdf8',
    roleHint: '长上下文分析 / 多文件检索 / 架构推演',
  },
  {
    provider: 'acp',
    label: 'ACP Agent',
    packageName: '@deepseek-ai/dsh-subagent-acp',
    accent: '#a855f7',
    roleHint: '通用 ACP 外部 Harness 进程',
  },
  {
    provider: 'dsh-sdk',
    label: 'DSH Sub-Instance',
    packageName: '@deepseek-ai/dsh-subagent-dsh-sdk',
    accent: '#38bdf8',
    roleHint: '独立 Profile / 模型 DSH 子实例',
  },
]

export function normalizeBubbleHarness(raw) {
  if (!raw || typeof raw !== 'object') return null
  const provider = clamp(String(raw.provider || '').trim(), 64)
  if (!provider || provider === 'spawn' || provider === 'fork') return null
  const meta = OFFICIAL_HARNESS_CATALOG.find(item => item.provider === provider)
  return {
    provider,
    label: clamp(raw.label || (meta ? meta.label : provider), 48),
    role: clamp(raw.role || (meta ? meta.roleHint : '外部 Harness 协同成员'), 90),
    accent: (meta && meta.accent) || '#38bdf8',
    joinedAt: Math.max(0, Number(raw.joinedAt) || Date.now()),
  }
}

/**
 * Strip Harmony / model-native `<|open|>tools<|sep|>...<|close|>` and `<|...|>`
 * control markup so raw protocol tokens never leak into Chief replies or logs.
 */
export function stripModelControlMarkup(rawText) {
  let s = String(rawText || '')
  if (!s) return ''
  // 1) Closed tool/call/internal-thinking envelopes (supports ASCII | and fullwidth ｜)
  s = s.replace(/<[|｜]open[|｜]>\s*tools\b[\s\S]*?<[|｜]close[|｜]>\s*tools(?:\s*<[|｜]sep[|｜]>)?/gi, '\n')
  s = s.replace(/<[|｜]open[|｜]>\s*call\b[\s\S]*?<[|｜]close[|｜]>\s*call(?:\s*<[|｜]sep[|｜]>)?/gi, '\n')
  s = s.replace(/<[|｜]open[|｜]>\s*(?:thought|thinking|analysis|reasoning)\b[\s\S]*?<[|｜]close[|｜]>\s*(?:thought|thinking|analysis|reasoning)(?:\s*<[|｜]sep[|｜]>)?/gi, '\n')
  // 2) Truncated/unclosed tool or thinking tails
  s = s.replace(/<[|｜]open[|｜]>\s*(?:tools|call|thought|thinking|analysis|reasoning)\b[\s\S]*$/gi, '')
  // 3) Outer control wrapper tags while keeping visible message body intact
  s = s.replace(/<[|｜](?:open|close)[|｜]>\s*(?:message|final|assistant|commentary|tools|call|thought|thinking|analysis|reasoning)(?:\s+[^<|｜\n]{0,160})?(?:\s*<[|｜]sep[|｜]>)?/gi, '')
  s = s.replace(/<[|｜](?:open|close|sep|start|end|channel|message|constrain|eot_id|im_start|im_end|return|end_of_turn)[^|｜>\n]{0,60}[|｜]>/gi, '')
  return s.replace(/\n{3,}/g, '\n\n').trim()
}

