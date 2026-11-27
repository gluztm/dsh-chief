/**
 * external-memory-studio.js — 参谋记忆工坊：可选向量重排、后台自动蒸馏、日记本、用户画像与提示词工坊
 *
 * 【核心职责】
 *   1. Embedding API（完全可选，默认关闭）：对接任意 OpenAI 兼容 `/embeddings` 接口，
 *      搭配本地 SHA1 缓存与余弦相似度进行轻量语义重排；未配置或出错时静默退回零配置词法召回。
 *   2. 提示词工坊（`PROMPTS.json`）：透明化管理记忆提炼、日记写作、画像更新与召回注入 4 套提示词。
 *   3. 自动用户画像（`USER_PROFILE.json` + `USER_PROFILE.md`）：5 维结构化画像，支持锁定条目不被后台覆盖。
 *   4. 参谋日记本（`DIARY.json` + `DIARY.md`）：按时间轴沉淀并肩经历、高亮要点与氛围标签。
 *   5. 后台自动蒸馏引擎：在不阻塞主对话的前提下，定期通过参谋模型或规则兜底自动生长记忆、日记与画像。
 *
 * 【边界约定】
 *   - 仅单向依赖 `node:crypto`、`node:fs`、`node:path`、`./state-schema.js`、`./external-memory-connectors.js`；
 *   - 严禁导入 `node:child_process`、`chief-state.js`、`index.js`；
 *   - 所有文本写入前强制经由 `scrubExternalMemoryText` 脱敏，对 `@lead` 保持 0 字节隔离。
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { clamp, normalizeExternalMemoryConfig, scrubExternalMemoryText } from './state-schema.js'
import {
  EXT_MEM_CATEGORIES,
  addBuiltinMemoryItem,
  defaultChiefMemoryDir,
  listBuiltinMemoryItems,
} from './external-memory-connectors.js'

const EMBEDDING_CACHE_CAP = 500
const PROFILE_SECTION_KEYS = ['salutation', 'communication', 'engineering', 'projects', 'traits']
const PROFILE_SECTION_LABELS = {
  salutation: '称呼与身份',
  communication: '沟通节奏与习惯',
  engineering: '工程偏好与红线',
  projects: '长期项目与关注点',
  traits: '性格印象与偏好',
}

const distillSessionBuffers = new Map()
const distillCooldownMap = new Map()

function atomicWriteFile(filePath, content) {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = `${filePath}.${process.pid}.${Date.now().toString(36)}.tmp`
  fs.writeFileSync(tmp, content, 'utf8')
  fs.renameSync(tmp, filePath)
}

function safeReadJson(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback
    const raw = fs.readFileSync(filePath, 'utf8')
    if (!raw.trim()) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

function resolveStudioDir(customDir = '') {
  const s = typeof customDir === 'string' ? customDir.trim() : ''
  return s || defaultChiefMemoryDir()
}

function makeStudioId(prefix = 'st') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/* ============================================================================
 * 1. Optional OpenAI-Compatible Embedding API & Local Cache
 * ============================================================================ */

export function resolveEmbeddingApiKey(embCfg = {}) {
  const envName = typeof embCfg.apiKeyEnv === 'string' ? embCfg.apiKeyEnv.trim() : ''
  if (envName && process.env && typeof process.env[envName] === 'string' && process.env[envName].trim()) {
    return process.env[envName].trim()
  }
  return typeof embCfg.apiKey === 'string' ? embCfg.apiKey.trim() : ''
}

function resolveEmbeddingProvider(embCfg = {}) {
  const explicit = typeof embCfg.provider === 'string' ? embCfg.provider.trim().toLowerCase() : ''
  if (explicit === 'ollama' || explicit === 'gemini' || explicit === 'openai') return explicit
  const url = String(embCfg.baseUrl || '').toLowerCase()
  if (url.includes(':11434') || url.includes('/api/embed')) return 'ollama'
  if (url.includes('generativelanguage.googleapis.com') || url.includes(':embedcontent')) return 'gemini'
  return 'openai'
}

function buildEmbeddingEndpoint(baseUrl = '', provider = 'openai', model = '') {
  const clean = String(baseUrl || '').trim().replace(/\/+$/, '')
  if (!clean) return ''
  if (provider === 'ollama') {
    const root = clean.replace(/\/(?:v1|api\/embed(?:dings)?)$/i, '')
    return `${root}/api/embed`
  }
  if (provider === 'gemini') {
    if (/:embedContent$/i.test(clean)) return clean
    const m = String(model || '').trim().replace(/^models\//, '')
    return `${clean}/models/${encodeURIComponent(m)}:embedContent`
  }
  return /\/embeddings$/i.test(clean) ? clean : `${clean}/embeddings`
}

export async function fetchEmbeddingVectors(embCfg = {}, texts = [], signal = null) {
  const provider = resolveEmbeddingProvider(embCfg)
  const model = typeof embCfg.model === 'string' ? embCfg.model.trim() : ''
  const endpoint = buildEmbeddingEndpoint(embCfg.baseUrl, provider, model)
  const inputs = (Array.isArray(texts) ? texts : [texts]).map(t => String(t || '').trim()).filter(Boolean)
  if (!endpoint || !model || !inputs.length) return []

  const apiKey = resolveEmbeddingApiKey(embCfg)
  const timeoutMs = Math.max(500, Math.min(8000, Number(embCfg.timeoutMs) || 2500))
  const ac = new AbortController()
  const timer = setTimeout(() => {
    try { ac.abort(new Error(`Embedding timeout after ${timeoutMs}ms`)) } catch {}
  }, timeoutMs)
  timer.unref?.()
  const onParentAbort = () => {
    try { ac.abort(new Error('Embedding aborted')) } catch {}
  }
  if (signal && typeof signal.addEventListener === 'function') {
    if (signal.aborted) onParentAbort()
    else signal.addEventListener('abort', onParentAbort, { once: true })
  }

  try {
    if (provider === 'ollama') {
      const headers = { 'content-type': 'application/json' }
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, input: inputs }),
        signal: ac.signal,
      })
      if (res.status === 404) {
        const legacyEndpoint = endpoint.replace(/\/api\/embed$/i, '/api/embeddings')
        const out = []
        for (const text of inputs) {
          const legRes = await fetch(legacyEndpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify({ model, prompt: text }),
            signal: ac.signal,
          })
          if (!legRes.ok) {
            const errTxt = await legRes.text().catch(() => '')
            throw new Error(`HTTP ${legRes.status}: ${clamp(errTxt || legRes.statusText || 'ollama embedding failed', 160)}`)
          }
          const legPayload = await legRes.json()
          out.push(Array.isArray(legPayload && legPayload.embedding) ? legPayload.embedding.map(Number) : [])
        }
        return out
      }
      if (!res.ok) {
        const errTxt = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status}: ${clamp(errTxt || res.statusText || 'ollama embedding failed', 160)}`)
      }
      const payload = await res.json()
      const rows = Array.isArray(payload && payload.embeddings)
        ? payload.embeddings
        : (Array.isArray(payload && payload.embedding) ? [payload.embedding] : [])
      return rows.map(vec => (Array.isArray(vec) ? vec.map(Number) : []))
    }

    if (provider === 'gemini') {
      const headers = {
        'content-type': 'application/json',
        ...(apiKey ? { 'x-goog-api-key': apiKey } : {}),
      }
      const out = []
      for (const text of inputs) {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: model.startsWith('models/') ? model : `models/${model}`,
            content: { parts: [{ text }] },
          }),
          signal: ac.signal,
        })
        if (!res.ok) {
          const errTxt = await res.text().catch(() => '')
          throw new Error(`HTTP ${res.status}: ${clamp(errTxt || res.statusText || 'gemini embedding failed', 160)}`)
        }
        const payload = await res.json()
        const vals = payload && payload.embedding && Array.isArray(payload.embedding.values)
          ? payload.embedding.values
          : []
        out.push(vals.map(Number))
      }
      return out
    }

    const headers = {
      'content-type': 'application/json',
      ...(apiKey ? { authorization: /^(?:Bearer|Token)\s+/i.test(apiKey) ? apiKey : `Bearer ${apiKey}` } : {}),
    }
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, input: inputs }),
      signal: ac.signal,
    })
    if (!res.ok) {
      const errTxt = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}: ${clamp(errTxt || res.statusText || 'embedding failed', 160)}`)
    }
    const payload = await res.json()
    const rows = Array.isArray(payload && payload.data) ? payload.data : []
    rows.sort((a, b) => (Number(a?.index) || 0) - (Number(b?.index) || 0))
    return rows.map(r => (Array.isArray(r && r.embedding) ? r.embedding.map(Number) : []))
  } finally {
    clearTimeout(timer)
    if (signal && typeof signal.removeEventListener === 'function') {
      try { signal.removeEventListener('abort', onParentAbort) } catch {}
    }
  }
}

export function cosineSimilarity(a = [], b = []) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i += 1) {
    const va = Number(a[i]) || 0
    const vb = Number(b[i]) || 0
    dot += va * vb
    normA += va * va
    normB += vb * vb
  }
  if (normA <= 0 || normB <= 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

function embeddingCachePath(customDir = '') {
  return path.join(resolveStudioDir(customDir), 'EMBEDDINGS_CACHE.json')
}

function makeEmbeddingKey(model, text) {
  const hash = crypto.createHash('sha1').update(String(text || '')).digest('hex')
  return `${model}::${hash}`
}

function loadEmbeddingCache(customDir = '') {
  const raw = safeReadJson(embeddingCachePath(customDir), null)
  return raw && typeof raw === 'object' && raw.entries && typeof raw.entries === 'object'
    ? raw.entries
    : {}
}

function saveEmbeddingCache(entries, customDir = '') {
  const keys = Object.keys(entries)
  if (keys.length > EMBEDDING_CACHE_CAP) {
    keys.sort((a, b) => (entries[a]?.at || 0) - (entries[b]?.at || 0))
    const drop = keys.length - EMBEDDING_CACHE_CAP
    for (let i = 0; i < drop; i += 1) {
      delete entries[keys[i]]
    }
  }
  atomicWriteFile(embeddingCachePath(customDir), JSON.stringify({ version: 1, entries }))
}

export async function rerankBuiltinItemsWithEmbeddings(items = [], query = '', embCfg = {}, customDir = '', signal = null) {
  if (!Array.isArray(items) || !items.length) return items
  const q = String(query || '').trim()
  if (!q || !embCfg || !embCfg.enabled || !embCfg.baseUrl || !embCfg.model) return items

  try {
    const model = String(embCfg.model).trim()
    const cache = loadEmbeddingCache(customDir)
    let cacheDirty = false

    const qKey = makeEmbeddingKey(model, q)
    const missingTexts = []
    const missingKeys = []

    if (!cache[qKey] || !Array.isArray(cache[qKey].vec)) {
      missingTexts.push(q)
      missingKeys.push(qKey)
    }
    const itemKeys = items.map(it => {
      const txt = String(it?.text || it?.preview || '').trim()
      const k = makeEmbeddingKey(model, txt)
      if (txt && (!cache[k] || !Array.isArray(cache[k].vec)) && !missingKeys.includes(k)) {
        missingTexts.push(txt)
        missingKeys.push(k)
      }
      return k
    })

    if (missingTexts.length > 0) {
      const fetched = await fetchEmbeddingVectors(embCfg, missingTexts.slice(0, 24), signal)
      const now = Date.now()
      for (let i = 0; i < fetched.length; i += 1) {
        if (Array.isArray(fetched[i]) && fetched[i].length > 0 && missingKeys[i]) {
          cache[missingKeys[i]] = { vec: fetched[i], at: now }
          cacheDirty = true
        }
      }
      if (cacheDirty) {
        try { saveEmbeddingCache(cache, customDir) } catch {}
      }
    }

    const qVec = cache[qKey]?.vec
    if (!Array.isArray(qVec) || !qVec.length) return items
    const weight = Math.min(0.9, Math.max(0.1, Number(embCfg.weight) || 0.45))

    const rescored = items.map((it, idx) => {
      const iVec = cache[itemKeys[idx]]?.vec
      const vectorScore = Array.isArray(iVec) && iVec.length ? Math.max(0, cosineSimilarity(qVec, iVec)) : 0
      const baseScore = Number(it.score) || 0
      const blended = Number((baseScore + vectorScore * 4.5 * weight).toFixed(2))
      return {
        ...it,
        vectorScore: Number(vectorScore.toFixed(3)),
        score: blended,
      }
    })
    rescored.sort((a, b) => (b.score || 0) - (a.score || 0))
    return rescored
  } catch {
    return items
  }
}

function formatFriendlyEmbeddingProbeError(err, provider = 'openai', baseUrl = '') {
  const rawMsg = clamp((err && err.message) || String(err || '向量连接测试失败'), 200)
  const low = rawMsg.toLowerCase()
  if (low.includes('timeout') || low.includes('abort')) {
    return provider === 'ollama'
      ? '连接本地 Ollama 超时，请确认服务已启动且模型未卡在首次加载'
      : '连接向量接口超时，请检查网络或接口地址是否正确'
  }
  if (low.includes('fetch failed') || low.includes('econnrefused') || low.includes('enotfound')) {
    if (provider === 'ollama') {
      return `无法连接到本地 Ollama（${baseUrl || 'http://127.0.0.1:11434'}），请确认 Ollama 服务已开启`
    }
    return `无法连接到向量接口（${baseUrl || provider}），请检查网络、代理或 Base URL 是否正确`
  }
  if (provider === 'gemini' && (low.includes('401') || low.includes('403') || low.includes('api key'))) {
    return 'Gemini API Key 无效或无权访问该模型，请检查密钥设置'
  }
  if (low.includes('404') && provider === 'ollama') {
    return 'Ollama 接口返回 404，请确认模型已 pull 到本机且 Ollama 版本正常'
  }
  return rawMsg
}

export async function probeEmbeddingApi(embCfg = {}) {
  const provider = resolveEmbeddingProvider(embCfg)
  const model = typeof embCfg.model === 'string' ? embCfg.model.trim() : ''
  const endpoint = buildEmbeddingEndpoint(embCfg.baseUrl, provider, model)
  if (!endpoint || !model) {
    return { ok: false, provider, error: '请先填写向量 API 地址与模型名称' }
  }
  const probeCfg = provider === 'ollama'
    ? { ...embCfg, timeoutMs: Math.max(Number(embCfg.timeoutMs) || 2500, 5000) }
    : embCfg
  const t0 = Date.now()
  try {
    const vecs = await fetchEmbeddingVectors(probeCfg, ['connectivity test'])
    const first = vecs[0]
    if (!Array.isArray(first) || first.length === 0) {
      return { ok: false, provider, model, latencyMs: Date.now() - t0, error: '接口未返回有效的向量数组' }
    }
    return {
      ok: true,
      provider,
      model,
      dimensions: first.length,
      latencyMs: Date.now() - t0,
    }
  } catch (err) {
    return {
      ok: false,
      provider,
      model,
      latencyMs: Date.now() - t0,
      error: formatFriendlyEmbeddingProbeError(err, provider, embCfg.baseUrl),
    }
  }
}

/* ============================================================================
 * 2. Prompt Studio (`PROMPTS.json`)
 * ============================================================================ */

export const DEFAULT_MEMORY_PROMPTS = {
  memory_extract: {
    key: 'memory_extract',
    group: 'processing',
    title: '记忆提炼规则',
    titleEn: 'Memory Extraction',
    desc: '教参谋长从对话中提炼高价值偏好、规矩、决策与踩坑，略过寒暄与例行压缩。',
    descEn: 'Extract durable engineering preferences, rules, decisions, and lessons.',
    expectsJson: true,
    vars: ['{{conversation}}', '{{current_date}}', '{{existing_memories}}'],
    defaultContent: [
      '请分析 {{current_date}} 的对话记录：',
      '{{conversation}}',
      '',
      '参考已有记忆（避免重复）：{{existing_memories}}',
      '',
      '请提炼 0-3 条值得长期保存的工程事实、用户习惯、项目决策或踩坑教训（自动去掉“记住/帮我记一条我的习惯：”等口语触发前缀，提炼为精炼陈述句）。仅输出 JSON 数组或字段 `memories`: [{ "text": "...", "category": "preference|rule|decision|lesson|bond", "pinned": false }]。遇到日常寒暄、例行上下文压缩、静默巡检或“无实质新内容”记录时必须返回空数组 []。',
    ].join('\n'),
  },
  diary_write: {
    key: 'diary_write',
    group: 'processing',
    title: '里程碑笔记风格',
    titleEn: 'Milestone Note Style',
    desc: '决定沉淀重要工程节点或里程碑的记录口吻；日常无实质变化与例行压缩不会生成。',
    descEn: 'Guide how Chief summarizes meaningful engineering milestones without maintenance spam.',
    expectsJson: true,
    vars: ['{{conversation}}', '{{current_date}}', '{{user_profile}}'],
    defaultContent: [
      '结合 {{current_date}} 的对话与用户档案：',
      '{{user_profile}}',
      '对话：{{conversation}}',
      '',
      '仅当对话包含明确的功能攻克、架构拍板或重要体验改善时，才生成不超过 120 字的字段 `diary`: { "title": "10字内小标题", "summary": "做了什么与结果", "highlights": ["关键收获1"], "moodTag": "专注/顺畅/破局" }；若仅为日常寒暄、例行上下文压缩或无实质新进展，必须返回 `diary: null`，严禁凑数。',
    ].join('\n'),
  },
  profile_update: {
    key: 'profile_update',
    group: 'processing',
    title: '用户画像更新规则',
    titleEn: 'User Profile Rules',
    desc: '教模型温和增补用户的称呼、沟通偏好与项目重心，绝不臆测贴标签。',
    descEn: 'Incrementally refine structured user traits without over-assuming.',
    expectsJson: true,
    vars: ['{{conversation}}', '{{current_date}}', '{{user_profile}}'],
    defaultContent: [
      '当前用户画像：',
      '{{user_profile}}',
      '',
      '基于 {{current_date}} 新对话（{{conversation}}），仅当出现明确证据时输出精炼增量陈述（去掉“记住/我习惯：”等口语触发前缀）到 `profileUpdates`: { "salutation": [], "communication": [], "engineering": [], "projects": [], "traits": [] }；无新增则留空对象。',
    ].join('\n'),
  },
  recall_inject: {
    key: 'recall_inject',
    group: 'injection',
    title: '记忆召回注入语',
    titleEn: 'Recall Injection Guidance',
    desc: '向参谋模型注入历史记忆时的语气提示；可自由调整如何自然衔接。',
    descEn: 'Optional guidance line included before injected memory recall lines.',
    expectsJson: false,
    vars: ['{{current_date}}', '{{memory_count}}'],
    defaultContent: '以下是截至 {{current_date}} 筛选出的 {{memory_count}} 条参谋参考记录，请自然融入回应但勿生硬复读。',
  },
}

function promptsFilePath(customDir = '') {
  return path.join(resolveStudioDir(customDir), 'PROMPTS.json')
}

function renderPromptVars(template = '', varsMap = {}) {
  let out = String(template || '')
  for (const [k, v] of Object.entries(varsMap)) {
    const token = k.startsWith('{{') ? k : `{{${k}}}`
    out = out.split(token).join(String(v == null ? '' : v))
  }
  return out
}

export function getMemoryPrompts(customDir = '') {
  const file = promptsFilePath(customDir)
  const stored = safeReadJson(file, {})
  const customMap = stored && typeof stored === 'object' && stored.prompts && typeof stored.prompts === 'object'
    ? stored.prompts
    : {}
  const prompts = Object.values(DEFAULT_MEMORY_PROMPTS).map(def => {
    const entry = customMap[def.key]
    const customContent = entry && typeof entry.content === 'string' && entry.content.trim() ? entry.content : ''
    return {
      key: def.key,
      group: def.group,
      title: def.title,
      titleEn: def.titleEn,
      desc: def.desc,
      descEn: def.descEn,
      expectsJson: def.expectsJson,
      vars: [...def.vars],
      content: customContent || def.defaultContent,
      defaultContent: def.defaultContent,
      customized: Boolean(customContent && customContent !== def.defaultContent),
      updatedAt: (entry && Number(entry.updatedAt)) || 0,
    }
  })
  return { ok: true, prompts, promptsPath: file }
}

export function saveMemoryPrompt(key, content, customDir = '') {
  const cleanKey = String(key || '').trim()
  if (!DEFAULT_MEMORY_PROMPTS[cleanKey]) {
    return { ok: false, error: `未知提示词标识: ${cleanKey || '(empty)'}` }
  }
  const cleanContent = scrubExternalMemoryText(String(content == null ? '' : content)).trim().slice(0, 2400)
  if (!cleanContent) {
    return { ok: false, error: '提示词内容不能为空' }
  }
  const file = promptsFilePath(customDir)
  const stored = safeReadJson(file, {})
  const promptsMap = stored && stored.prompts && typeof stored.prompts === 'object' ? { ...stored.prompts } : {}
  if (cleanContent === DEFAULT_MEMORY_PROMPTS[cleanKey].defaultContent) {
    delete promptsMap[cleanKey]
  } else {
    promptsMap[cleanKey] = { content: cleanContent, updatedAt: Date.now() }
  }
  atomicWriteFile(file, JSON.stringify({ version: 1, prompts: promptsMap }, null, 2) + '\n')
  return getMemoryPrompts(customDir)
}

export function resetMemoryPrompt(key = 'all', customDir = '') {
  const cleanKey = String(key || 'all').trim()
  const file = promptsFilePath(customDir)
  const stored = safeReadJson(file, {})
  const promptsMap = stored && stored.prompts && typeof stored.prompts === 'object' ? { ...stored.prompts } : {}
  if (cleanKey === 'all') {
    for (const k of Object.keys(promptsMap)) delete promptsMap[k]
  } else if (DEFAULT_MEMORY_PROMPTS[cleanKey]) {
    delete promptsMap[cleanKey]
  } else {
    return { ok: false, error: `未知提示词标识: ${cleanKey}` }
  }
  atomicWriteFile(file, JSON.stringify({ version: 1, prompts: promptsMap }, null, 2) + '\n')
  return getMemoryPrompts(customDir)
}

/* ============================================================================
 * 3. Auto User Profile (`USER_PROFILE.json` + `USER_PROFILE.md`)
 * ============================================================================ */

function userProfileJsonPath(customDir = '') {
  return path.join(resolveStudioDir(customDir), 'USER_PROFILE.json')
}

function userProfileMdPath(customDir = '') {
  return path.join(resolveStudioDir(customDir), 'USER_PROFILE.md')
}

function emptyUserProfileData() {
  return {
    version: 1,
    updatedAt: 0,
    sections: {
      salutation: [],
      communication: [],
      engineering: [],
      projects: [],
      traits: [],
    },
  }
}

function normalizeProfileItem(raw, fallbackSource = 'manual') {
  if (!raw) return null
  const textRaw = typeof raw === 'string' ? raw : (raw.text || '')
  const text = clamp(scrubExternalMemoryText(String(textRaw).replace(/[\r\n]+/g, ' ')), 220)
  if (!text) return null
  return {
    id: (typeof raw === 'object' && typeof raw.id === 'string' && raw.id.trim()) ? raw.id.trim().slice(0, 60) : makeStudioId('pf'),
    text,
    locked: Boolean(typeof raw === 'object' && raw.locked),
    source: (typeof raw === 'object' && raw.source === 'auto') ? 'auto' : (fallbackSource === 'auto' ? 'auto' : 'manual'),
    updatedAt: (typeof raw === 'object' && Number(raw.updatedAt)) || Date.now(),
  }
}

function normalizeUserProfileData(raw) {
  const base = emptyUserProfileData()
  if (!raw || typeof raw !== 'object') return base
  const rawSec = raw.sections && typeof raw.sections === 'object' ? raw.sections : raw
  for (const key of PROFILE_SECTION_KEYS) {
    const arr = Array.isArray(rawSec[key]) ? rawSec[key] : []
    const seen = new Set()
    const clean = []
    for (const row of arr) {
      const item = normalizeProfileItem(row)
      if (!item) continue
      const normKey = item.text.toLowerCase()
      if (seen.has(normKey)) continue
      seen.add(normKey)
      clean.push(item)
      if (clean.length >= 20) break
    }
    base.sections[key] = clean
  }
  base.updatedAt = Number(raw.updatedAt) || 0
  return base
}

function renderUserProfileMarkdown(profile) {
  const lines = [
    '# 用户画像档案 (USER_PROFILE.md)',
    '',
    '> 仅参谋长可见，对主对话 `@lead` 严格保持 0 字节隔离。带 `[锁定]` 标记的条目不会被后台自动复盘改写。',
    '',
  ]
  for (const key of PROFILE_SECTION_KEYS) {
    const list = profile.sections[key] || []
    lines.push(`## ${PROFILE_SECTION_LABELS[key] || key}`)
    if (!list.length) {
      lines.push('- （暂无记录）')
    } else {
      for (const it of list) {
        const lockTag = it.locked ? '[锁定] ' : ''
        const srcTag = it.source === 'auto' ? ' _(自动)_' : ''
        lines.push(`- ${lockTag}${it.text}${srcTag}`)
      }
    }
    lines.push('')
  }
  return lines.join('\n')
}

export function loadUserProfile(customDir = '') {
  const jsonFile = userProfileJsonPath(customDir)
  const mdFile = userProfileMdPath(customDir)
  const raw = safeReadJson(jsonFile, null)
  const profile = normalizeUserProfileData(raw)
  return {
    ok: true,
    profile,
    profilePath: mdFile,
    profileJsonPath: jsonFile,
  }
}

export function saveUserProfile(profilePayload = {}, customDir = '') {
  const jsonFile = userProfileJsonPath(customDir)
  const mdFile = userProfileMdPath(customDir)
  const next = normalizeUserProfileData(profilePayload)
  next.updatedAt = Date.now()
  atomicWriteFile(jsonFile, JSON.stringify(next, null, 2) + '\n')
  atomicWriteFile(mdFile, renderUserProfileMarkdown(next))
  return {
    ok: true,
    profile: next,
    profilePath: mdFile,
    profileJsonPath: jsonFile,
  }
}

export function mergeAutoProfilePatch(delta = {}, customDir = '') {
  if (!delta || typeof delta !== 'object') return loadUserProfile(customDir)
  const current = loadUserProfile(customDir).profile
  const srcSec = delta.sections && typeof delta.sections === 'object' ? delta.sections : delta
  let changed = false

  for (const key of PROFILE_SECTION_KEYS) {
    const incoming = Array.isArray(srcSec[key]) ? srcSec[key] : []
    if (!incoming.length) continue
    const existingList = current.sections[key] || []
    const lockedItems = existingList.filter(it => it && it.locked)
    const unlockedItems = existingList.filter(it => it && !it.locked)
    const seen = new Set(existingList.map(it => it.text.toLowerCase()))

    for (const row of incoming) {
      const item = normalizeProfileItem(row, 'auto')
      if (!item) continue
      const normKey = item.text.toLowerCase()
      if (seen.has(normKey)) continue
      seen.add(normKey)
      unlockedItems.push({ ...item, locked: false, source: 'auto' })
      changed = true
    }
    // Never touch locked items; cap unlocked additions gracefully
    current.sections[key] = [...lockedItems, ...unlockedItems].slice(0, 20)
  }

  if (!changed) return loadUserProfile(customDir)
  return saveUserProfile(current, customDir)
}

export function formatUserProfileForPrompt(customDir = '', charBudget = 320) {
  const { profile } = loadUserProfile(customDir)
  const chunks = []
  for (const key of PROFILE_SECTION_KEYS) {
    const list = profile.sections[key] || []
    if (!list.length) continue
    const texts = list.slice(0, 3).map(it => it.text).join('；')
    chunks.push(`${PROFILE_SECTION_LABELS[key]}：${texts}`)
  }
  if (!chunks.length) return ''
  return clamp(chunks.join(' | '), Math.max(80, Math.min(800, Number(charBudget) || 320)))
}

/* ============================================================================
 * 4. Chief Diary (`DIARY.json` + `DIARY.md`)
 * ============================================================================ */

function diaryJsonPath(customDir = '') {
  return path.join(resolveStudioDir(customDir), 'DIARY.json')
}

function diaryMdPath(customDir = '') {
  return path.join(resolveStudioDir(customDir), 'DIARY.md')
}

function normalizeDiaryEntry(raw = {}) {
  const now = new Date()
  const dateStr = (typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date.trim()))
    ? raw.date.trim()
    : now.toISOString().slice(0, 10)
  const timeStr = (typeof raw.time === 'string' && /^\d{2}:\d{2}/.test(raw.time.trim()))
    ? raw.time.trim().slice(0, 5)
    : now.toTimeString().slice(0, 5)
  const title = clamp(scrubExternalMemoryText(String(raw.title || '').replace(/[\r\n]+/g, ' ')), 60)
  const summary = clamp(scrubExternalMemoryText(String(raw.summary || raw.text || '').replace(/\r\n/g, '\n')), 600)
  if (!summary) return null
  const highlights = Array.isArray(raw.highlights)
    ? raw.highlights.map(x => clamp(scrubExternalMemoryText(String(x || '').replace(/[\r\n]+/g, ' ')), 120)).filter(Boolean).slice(0, 5)
    : []
  const linkedMemoryIds = Array.isArray(raw.linkedMemoryIds)
    ? raw.linkedMemoryIds.map(x => String(x || '').trim()).filter(Boolean).slice(0, 10)
    : []
  return {
    id: (typeof raw.id === 'string' && raw.id.trim()) ? raw.id.trim().slice(0, 64) : makeStudioId('dr'),
    date: dateStr,
    time: timeStr,
    title: title || clamp(summary, 22),
    summary,
    highlights,
    moodTag: clamp(scrubExternalMemoryText(String(raw.moodTag || '日常').replace(/[\r\n]+/g, ' ')), 20) || '日常',
    linkedMemoryIds,
    source: raw.source === 'auto' ? 'auto' : 'manual',
    sessionId: typeof raw.sessionId === 'string' ? raw.sessionId.trim().slice(0, 80) : '',
    createdAt: Number(raw.createdAt) || Date.now(),
  }
}

function readAllDiaryEntries(customDir = '') {
  const raw = safeReadJson(diaryJsonPath(customDir), null)
  const list = raw && Array.isArray(raw.entries) ? raw.entries : []
  return list.map(normalizeDiaryEntry).filter(Boolean)
}

function writeAllDiaryEntries(entries, customDir = '') {
  const clean = entries.slice(0, 200)
  atomicWriteFile(diaryJsonPath(customDir), JSON.stringify({ version: 1, entries: clean }, null, 2) + '\n')
  const mdLines = [
    '# 参谋日记本 (DIARY.md)',
    '',
    '> 按时间记录与总司令并肩协作的点滴，仅参谋长可见（对 `@lead` 严格 0 字节隔离）。',
    '',
  ]
  for (const e of clean) {
    mdLines.push(`## ${e.date} ${e.time} · ${e.title} [${e.moodTag}]`)
    mdLines.push('')
    mdLines.push(e.summary)
    if (e.highlights.length) {
      mdLines.push('')
      for (const h of e.highlights) mdLines.push(`- ${h}`)
    }
    mdLines.push('')
  }
  atomicWriteFile(diaryMdPath(customDir), mdLines.join('\n'))
  return clean
}

export function listDiaryEntries(customDir = '', limit = 40) {
  const entries = readAllDiaryEntries(customDir)
  const capped = entries.slice(0, Math.max(1, Math.min(200, Number(limit) || 40)))
  return {
    ok: true,
    entries: capped,
    total: entries.length,
    diaryPath: diaryMdPath(customDir),
  }
}

export function addDiaryEntry(entry = {}, customDir = '') {
  const norm = normalizeDiaryEntry(entry)
  if (!norm) return { ok: false, error: '日记内容不能为空' }
  const existing = readAllDiaryEntries(customDir)
  const next = writeAllDiaryEntries([norm, ...existing], customDir)
  return {
    ok: true,
    entry: norm,
    entries: next,
    total: next.length,
    diaryPath: diaryMdPath(customDir),
  }
}

export function updateDiaryEntry(id = '', patchFields = {}, customDir = '') {
  const target = String(id || '').trim()
  if (!target) return { ok: false, error: '缺少日记 ID' }
  const existing = readAllDiaryEntries(customDir)
  let updated = null
  const next = existing.map(e => {
    if (e.id !== target) return e
    const merged = normalizeDiaryEntry({
      ...e,
      ...(typeof patchFields.title === 'string' ? { title: patchFields.title } : {}),
      ...(typeof patchFields.summary === 'string' ? { summary: patchFields.summary } : {}),
      ...(Array.isArray(patchFields.highlights) ? { highlights: patchFields.highlights } : {}),
      ...(typeof patchFields.moodTag === 'string' ? { moodTag: patchFields.moodTag } : {}),
    })
    updated = merged || e
    return updated
  })
  if (!updated) return { ok: false, error: '未找到指定日记条目' }
  const saved = writeAllDiaryEntries(next, customDir)
  return { ok: true, entry: updated, entries: saved, total: saved.length, diaryPath: diaryMdPath(customDir) }
}

export function removeDiaryEntry(id = '', customDir = '') {
  const target = String(id || '').trim()
  if (!target) return { ok: false, error: '缺少日记 ID' }
  const existing = readAllDiaryEntries(customDir)
  const kept = existing.filter(e => e.id !== target)
  if (kept.length === existing.length) return { ok: false, error: '未找到指定日记条目' }
  const saved = writeAllDiaryEntries(kept, customDir)
  return { ok: true, removed: target, entries: saved, total: saved.length, diaryPath: diaryMdPath(customDir) }
}

/* ============================================================================
 * 5. Background Auto-Distillation Engine
 * ============================================================================ */

function parseDistillJsonFromText(rawText = '') {
  const txt = String(rawText || '').trim()
  if (!txt) return null
  const fenced = txt.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fenced ? fenced[1] : txt).trim()
  try {
    const obj = JSON.parse(candidate)
    return obj && typeof obj === 'object' ? obj : null
  } catch {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        const obj = JSON.parse(candidate.slice(start, end + 1))
        return obj && typeof obj === 'object' ? obj : null
      } catch {}
    }
    return null
  }
}

const HEURISTIC_PREF_RE = /(?:记住|帮我记|别忘了|以后都|我习惯|我喜欢|我偏好|千万别|不要再|请总是|叫我|称呼|约定好)/
const HEURISTIC_RULE_RE = /(?:严禁|绝对禁止|千万别|不要擅自|红线|禁碰)/
const SYSTEM_MAINTENANCE_NOISE_RE = /(?:例行压缩维护|静默压缩|多轮上下文.*压缩|压缩流程|细节抢救归档|无实质新内容|无实质进展|占位从\s*\d+%|占用从\s*\d+%|context\s*compact|auto[- ]compact|routine maintenance|no substantive new content|【⏹\s*水泡急停|【🗜|【🧹\s*已清理|【⚡\s*强介入已锁定)/i

export function isSystemMaintenanceNoise(text = '') {
  const s = String(text || '').trim()
  if (!s) return false
  return SYSTEM_MAINTENANCE_NOISE_RE.test(s)
}

function filterSubstantiveTurns(turns = []) {
  return (Array.isArray(turns) ? turns : [])
    .map(t => ({
      userText: clamp(scrubExternalMemoryText(t?.userText || ''), 500),
      chiefReply: clamp(scrubExternalMemoryText(t?.chiefReply || ''), 700),
    }))
    .filter(t => {
      if (!t.userText && !t.chiefReply) return false
      if (isSystemMaintenanceNoise(t.userText) || isSystemMaintenanceNoise(t.chiefReply)) {
        return false
      }
      if (!t.userText && t.chiefReply.length < 40) return false
      return true
    })
}

/** Strip oral "please remember / my personal habit:" trigger prefixes when auto-distilling notes. */
export function distillOralMemoryText(rawText = '') {
  const original = clamp(scrubExternalMemoryText(String(rawText || '').replace(/[\r\n]+/g, ' ')), 260).trim()
  if (!original) return ''
  let cleaned = original
  // Loop up to 2 passes to strip nested polite/category wrappers like "帮我记住一条我的个人习惯：..."
  for (let pass = 0; pass < 2; pass += 1) {
    const next = cleaned
      .replace(/^(?:请|麻烦|帮我|请你|顺便)?(?:一定|务必)?(?:记住|记一下|记下来|记一笔|别忘了|提醒你|记一条|记住一条)(?:一[条个项句段])?(?:关于)?(?:我的)?(?:个人)?(?:习惯|偏好|规矩|要求|底线|原则|约定|设置|风格)?(?:就是|是|为)?[：:，,\s]*/i, '')
      .replace(/^(?:我(?:的)?(?:个人)?(?:习惯|偏好|规矩|要求|原则)(?:就是|是|为)?)[：:，,\s]+/i, '')
      .replace(/^(?:please\s+)?(?:remember|note|keep\s+in\s+mind)(?:\s+that)?[:,\s]+/i, '')
      .replace(/^[「『"“'‘]+(.*?)[」』"”'’]+$/, '$1')
      .trim()
    if (next === cleaned) break
    cleaned = next
  }
  return cleaned.length >= 4 ? cleaned : original
}

function runHeuristicDistill(turns = [], sessionId = '') {
  const memories = []
  const profileUpdates = { salutation: [], communication: [], engineering: [], projects: [], traits: [] }
  const highlights = []

  for (const t of turns) {
    const rawU = clamp(scrubExternalMemoryText(t?.userText || ''), 360)
    if (!rawU || rawU.length < 6 || isSystemMaintenanceNoise(rawU)) continue
    if (HEURISTIC_PREF_RE.test(rawU)) {
      const cat = HEURISTIC_RULE_RE.test(rawU) ? 'rule' : 'preference'
      const refined = distillOralMemoryText(rawU)
      if (!refined || refined.length < 4) continue
      memories.push({ text: refined, category: cat, pinned: cat === 'rule' })
      if (/叫我|称呼|我是/.test(rawU)) profileUpdates.salutation.push(refined)
      else if (HEURISTIC_RULE_RE.test(rawU)) profileUpdates.engineering.push(refined)
      else profileUpdates.communication.push(refined)
      highlights.push(clamp(refined, 80))
    }
  }

  const lastTurn = turns[turns.length - 1]
  const uLast = clamp(scrubExternalMemoryText(lastTurn?.userText || ''), 120)
  const rLast = clamp(scrubExternalMemoryText(lastTurn?.chiefReply || ''), 180)
  const hasRealContent = !isSystemMaintenanceNoise(uLast) && !isSystemMaintenanceNoise(rLast)
  const diary = (hasRealContent && (memories.length > 0 || (uLast.length >= 16 && rLast.length >= 40)))
    ? {
        title: clamp(uLast || '重要推进记录', 20),
        summary: rLast ? `围绕「${clamp(uLast, 50)}」展开交流：${clamp(rLast, 160)}` : `记录了需求与想法：${uLast}`,
        highlights: highlights.slice(0, 3),
        moodTag: memories.length > 0 ? '沉淀' : '推进',
        sessionId,
      }
    : null

  return { memories, diary, profileUpdates }
}

export async function distillMemoryBatch({
  rawCfg = {},
  turns = [],
  sessionId = '',
  customDir = '',
  callLlm = null,
  forceHeuristic = false,
  skipDiary = false,
} = {}) {
  const cfg = normalizeExternalMemoryConfig(rawCfg)
  const slot = cfg.memorySlot || {}
  const dir = resolveStudioDir(customDir || slot.vaultPath || '')
  const cleanTurns = filterSubstantiveTurns(turns)

  if (!cleanTurns.length) {
    return {
      ok: true,
      skipped: 'no-substantive-content',
      mode: 'skipped',
      addedMemories: [],
      diaryEntry: null,
      profileUpdated: false,
    }
  }

  const today = new Date().toISOString().slice(0, 10)
  const conversationText = cleanTurns
    .map((t, idx) => `[#${idx + 1}] 用户: ${t.userText}\n参谋: ${t.chiefReply}`)
    .join('\n\n')
  const existingMemories = listBuiltinMemoryItems(dir, { halfLifeDays: slot.decayHalfLifeDays || 21 })
    .slice(0, 12)
    .map(it => `- ${it.text}`)
    .join('\n') || '（暂无）'
  const profileSummary = formatUserProfileForPrompt(dir, 320) || '（暂无）'

  const promptList = getMemoryPrompts(dir).prompts
  const byKey = Object.fromEntries(promptList.map(p => [p.key, p.content]))
  const vars = {
    '{{conversation}}': conversationText,
    '{{current_date}}': today,
    '{{existing_memories}}': existingMemories,
    '{{user_profile}}': profileSummary,
  }

  let distilled = null
  let mode = 'heuristic'

  if (!forceHeuristic && typeof callLlm === 'function') {
    const combinedPrompt = [
      '请一次性输出一个严格合法的 JSON 对象，包含三个顶层键：`memories`（数组）、`diary`（对象或 null）、`profileUpdates`（对象）。不要输出任何 Markdown 解释文字以外的废话。',
      '',
      '### 任务一：记忆提炼',
      renderPromptVars(byKey.memory_extract || DEFAULT_MEMORY_PROMPTS.memory_extract.defaultContent, vars),
      '',
      '### 任务二：参谋日记',
      renderPromptVars(byKey.diary_write || DEFAULT_MEMORY_PROMPTS.diary_write.defaultContent, vars),
      '',
      '### 任务三：用户画像增量',
      renderPromptVars(byKey.profile_update || DEFAULT_MEMORY_PROMPTS.profile_update.defaultContent, vars),
    ].join('\n')

    try {
      const llmRes = await callLlm({
        system: '你是参谋长后台记忆整理器。仅输出合法 JSON，严格脱敏且绝不臆测用户未表达的信息。',
        prompt: combinedPrompt,
        reasonKind: 'auto_summary',
        maxTokens: 1600,
      })
      const parsed = parseDistillJsonFromText(llmRes && (llmRes.text || llmRes.reply || ''))
      if (parsed) {
        distilled = parsed
        mode = 'llm'
      }
    } catch {}
  }

  if (!distilled) {
    distilled = runHeuristicDistill(cleanTurns, sessionId)
    mode = 'heuristic'
  }

  const addedMemories = []
  const canWriteBuiltin = !slot.kind || slot.kind === 'none' || slot.kind === 'builtin-md'
  if (canWriteBuiltin && Array.isArray(distilled.memories)) {
    for (const row of distilled.memories.slice(0, 4)) {
      const rawTxt = typeof row === 'string' ? row : (row?.text || '')
      const txt = distillOralMemoryText(rawTxt)
      if (!txt || String(txt).trim().length < 4 || isSystemMaintenanceNoise(txt)) continue
      const cat = typeof row === 'object' && EXT_MEM_CATEGORIES.includes(row.category) ? row.category : ''
      const res = addBuiltinMemoryItem(txt, dir, {
        category: cat,
        pinned: Boolean(typeof row === 'object' && row.pinned),
        halfLifeDays: slot.decayHalfLifeDays || 21,
      })
      if (res && res.ok && res.item && !res.deduplicated) {
        addedMemories.push(res.item)
      }
    }
  }

  let diaryEntry = null
  if (!skipDiary) {
    const rawDiary = distilled.diary && typeof distilled.diary === 'object' ? distilled.diary : null
    const rawDiaryText = rawDiary ? `${rawDiary.title || ''} ${rawDiary.summary || rawDiary.text || ''}`.trim() : ''
    if (rawDiary && (rawDiary.summary || rawDiary.text) && !isSystemMaintenanceNoise(rawDiaryText)) {
      const dRes = addDiaryEntry({
        ...rawDiary,
        linkedMemoryIds: addedMemories.map(m => m.id).filter(Boolean),
        source: 'auto',
        sessionId,
      }, dir)
      if (dRes && dRes.ok) diaryEntry = dRes.entry
    }
  }

  let profileUpdated = false
  if (distilled.profileUpdates && typeof distilled.profileUpdates === 'object') {
    const cleanPatch = {}
    let hasAny = false
    for (const k of PROFILE_SECTION_KEYS) {
      const arr = Array.isArray(distilled.profileUpdates[k]) ? distilled.profileUpdates[k] : []
      const mapped = arr
        .map(row => (typeof row === 'string' ? distillOralMemoryText(row) : (row && typeof row === 'object' ? { ...row, text: distillOralMemoryText(row.text || '') } : null)))
        .filter(item => item && (typeof item === 'string' ? item.length >= 2 : item.text.length >= 2))
      if (mapped.length > 0) {
        cleanPatch[k] = mapped
        hasAny = true
      }
    }
    if (hasAny) {
      mergeAutoProfilePatch(cleanPatch, dir)
      profileUpdated = true
    }
  }

  return {
    ok: true,
    mode,
    addedMemories,
    diaryEntry,
    profileUpdated,
  }
}

export async function maybeAutoDistillTurnAsync({
  rawCfg = {},
  userText = '',
  chiefReply = '',
  sessionId = 'global',
  workspaceCwd = '',
  projectKey = '',
  callLlm = null,
} = {}) {
  try {
    const cfg = normalizeExternalMemoryConfig(rawCfg)
    if (!cfg.enabled || !cfg.autoDistill || !cfg.autoDistill.enabled) {
      return { skipped: 'disabled' }
    }
    const sid = String(sessionId || 'global').trim() || 'global'
    const map = cfg.workspacePolicies || {}
    const policy = map[`session:${sid}`] || map[sid] || map[`project:${projectKey}`] || map[workspaceCwd] || 'read-write'
    if (policy !== 'read-write') return { skipped: `policy:${policy}` }

    const cleanUser = clamp(scrubExternalMemoryText(userText), 500)
    const cleanReply = clamp(scrubExternalMemoryText(chiefReply), 700)
    if (cleanUser.length < 6 && cleanReply.length < 30) return { skipped: 'trivial' }
    if (isSystemMaintenanceNoise(cleanUser) || isSystemMaintenanceNoise(cleanReply)) {
      return { skipped: 'system-maintenance-noise' }
    }

    const buf = distillSessionBuffers.get(sid) || []
    buf.push({ userText: cleanUser, chiefReply: cleanReply, at: Date.now() })
    if (buf.length > 10) buf.splice(0, buf.length - 10)
    distillSessionBuffers.set(sid, buf)

    const minTurns = Math.max(1, Math.min(10, Number(cfg.autoDistill.minTurns) || 2))
    const cooldownMs = Math.max(15, Number(cfg.autoDistill.cooldownSec) || 90) * 1000
    const lastAt = distillCooldownMap.get(sid) || 0
    const strongSignal = HEURISTIC_PREF_RE.test(cleanUser) && cleanUser.length >= 16
    if (buf.length < minTurns && !strongSignal) return { skipped: 'buffering' }
    if (Date.now() - lastAt < cooldownMs) return { skipped: 'cooldown' }

    distillCooldownMap.set(sid, Date.now())
    const snapshot = buf.splice(0, buf.length)
    return await distillMemoryBatch({
      rawCfg: cfg,
      turns: snapshot,
      sessionId: sid,
      callLlm,
      skipDiary: true,
    })
  } catch {
    return { skipped: 'error' }
  }
}
