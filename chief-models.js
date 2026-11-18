/**
 * chief-models.js
 *
 * Model catalog discovery, route cooldown tracking, and ctx.llm invocation for DSH Chief.
 */

import {
  MODEL_TIMEOUT_MS,
  CATALOG_TTL_MS,
  SUMMARY_MAX_TOKENS,
  SUMMARY_RETRY_MAX_TOKENS,
  clamp,
  resolveWorkspaceConfig,
  loadChiefState,
  mutateChiefState,
} from './chief-state.js'

let dshLlmModulePromise = null

export async function loadDshLlm() {
  if (!dshLlmModulePromise) {
    dshLlmModulePromise = import('@deepseek-ai/dsh-llm').catch(() => null)
  }
  return dshLlmModulePromise
}

let modelCatalogCache = { at: 0, items: [] }

export function invalidateChiefModelCatalog() {
  modelCatalogCache = { at: 0, items: [] }
  unusableRouteUntil.clear()
}

function splitModelRef(ref) {
  const clean = String(ref || '').trim()
  const idx = clean.indexOf('/')
  if (idx <= 0 || idx >= clean.length - 1) return null
  return { provider: clean.slice(0, idx), model: clean.slice(idx + 1), ref: clean }
}

function stripVendorPrefixFromModelId(modelId) {
  const raw = String(modelId || '').trim()
  if (!raw.includes('/')) return raw
  const parts = raw.split('/').filter(Boolean)
  return parts.length > 1 ? parts.slice(1).join('/') : raw
}

function shortProviderTag(providerId, providerName) {
  const pid = String(providerId || '').toLowerCase()
  const pname = String(providerName || '').trim()
  if (pid === 'commandcode' || /command\s*code/i.test(pname)) return 'Command Code'
  if (pid.includes('account') || /account/i.test(pname)) return pname || 'DeepSeek Account'
  if (pid === 'our-free-model') return 'Free Model'
  return pname || providerId || ''
}

export function formatChiefModelLabel(ref, items = [], providers = [], compact = false) {
  const parsed = splitModelRef(ref)
  if (!parsed) return compact ? '自动跟随' : ''
  const hit = Array.isArray(items) ? items.find(it => it && it.ref === parsed.ref) : null
  const provObj = Array.isArray(providers) ? providers.find(p => p && p.id === parsed.provider) : null
  const provLabel = shortProviderTag(parsed.provider, (hit && hit.providerName) || (provObj && (provObj.name || provObj.label)) || parsed.provider)
  const rawModelName = (hit && hit.name) ? String(hit.name).trim() : stripVendorPrefixFromModelId(parsed.model)

  if (compact) {
    // Keep channel crystal-clear so Command Code DS is never confused with official DeepSeek API
    const shortProv = parsed.provider === 'commandcode' ? 'CC' : provLabel
    const alreadyTagged = /\(CC\)/i.test(rawModelName) && shortProv === 'CC'
    const base = alreadyTagged ? rawModelName : (shortProv ? `${shortProv} · ${rawModelName}` : rawModelName)
    return clamp(base, 24)
  }
  const alreadyHasProv = provLabel && rawModelName.toLowerCase().includes(provLabel.toLowerCase())
  return alreadyHasProv || !provLabel ? rawModelName : `${provLabel} · ${rawModelName}`
}

function detectUnkeyedProviders(runtime, llm) {
  const missing = new Set()
  if (!runtime || !llm || typeof llm.listConfigurableProviders !== 'function') return missing
  try {
    const settings = runtime.get('settings')
    const credentials = runtime.get('credentials')
    if (!settings || !credentials || typeof settings.describe !== 'function') return missing
    const sections = new Map((settings.describe({ redactSecrets: true }) || []).map(s => [s.ns, s]))
    for (const entry of (llm.listConfigurableProviders() || [])) {
      if (!entry || !entry.provider || !Array.isArray(entry.settingsPath)) continue
      const sec = sections.get(entry.settingsNs)
      const profile = entry.settingsPath.reduce((v, k) => v?.[k], sec?.value)
      const keyEnv = typeof profile?.apiKeyEnv === 'string' && profile.apiKeyEnv ? profile.apiKeyEnv : ''
      if (keyEnv && process.env[keyEnv] === '') {
        // Explicit empty env hint; async describe handled below when needed
      }
    }
  } catch {}
  return missing
}

async function detectMissingProviderKeysAsync(runtime, llm, providerIds) {
  const missing = detectUnkeyedProviders(runtime, llm)
  if (!runtime || !llm || typeof llm.listConfigurableProviders !== 'function') return missing
  try {
    const settings = runtime.get('settings')
    const credentials = runtime.get('credentials')
    if (!settings || !credentials || typeof settings.describe !== 'function' || typeof credentials.describe !== 'function') {
      return missing
    }
    const sections = new Map((settings.describe({ redactSecrets: true }) || []).map(s => [s.ns, s]))
    const keyRefs = new Map()
    for (const entry of (llm.listConfigurableProviders() || [])) {
      if (!entry || !entry.provider || !Array.isArray(entry.settingsPath)) continue
      const sec = sections.get(entry.settingsNs)
      const profile = entry.settingsPath.reduce((v, k) => v?.[k], sec?.value)
      if (typeof profile?.apiKeyEnv === 'string' && profile.apiKeyEnv) {
        keyRefs.set(entry.provider, profile.apiKeyEnv)
      }
    }
    await Promise.all(
      providerIds
        .filter(id => keyRefs.has(id))
        .map(async (id) => {
          const info = await Promise.resolve(credentials.describe(keyRefs.get(id))).catch(() => undefined)
          if (info && info.configured === false) missing.add(id)
        }),
    )
  } catch {}
  return missing
}

function extractAgentModelRef(agent) {
  if (!agent) return ''
  try {
    const sess = agent.session
    const header = sess && typeof sess.requestHeader === 'function'
      ? sess.requestHeader()
      : (sess && sess.header ? sess.header : null)
    const candidates = [
      header && header.config,
      header,
      sess && sess.config,
      sess && sess.modelSelection,
      agent.modelSelection,
      agent.config,
    ]
    for (const cfg of candidates) {
      if (cfg && typeof cfg.provider === 'string' && cfg.provider && typeof cfg.model === 'string' && cfg.model) {
        if (!cfg.provider.startsWith('local-agent')) {
          return `${cfg.provider}/${cfg.model}`
        }
      }
    }
  } catch {}
  return ''
}

function sessionModelRef(deps, sessionId) {
  if (!deps || !deps.runtime) return ''
  try {
    const agents = deps.runtime.get('agents')
    if (!agents || typeof agents.get !== 'function') return ''
    if (sessionId) {
      const direct = extractAgentModelRef(agents.get(sessionId))
      if (direct) return direct
      const rootId = deps.resolveRootSessionId ? deps.resolveRootSessionId(sessionId) : ''
      if (rootId && rootId !== sessionId) {
        const rootRef = extractAgentModelRef(agents.get(rootId))
        if (rootRef) return rootRef
      }
    }
  } catch {}
  return ''
}

function profileDefaultModelRef(runtime) {
  if (!runtime) return ''
  try {
    const sel = runtime.get('agentDefaultModel')?.currentSelection?.()
    if (sel && sel.provider && sel.model && !String(sel.provider).startsWith('local-agent')) {
      return `${sel.provider}/${sel.model}`
    }
  } catch {}
  return ''
}

export async function listChiefModels(deps, fresh = false, sessionId = '') {
  const llm = deps.getLlm ? deps.getLlm() : null
  const runtime = deps.runtime
  const state = loadChiefState()
  const rootSid = (deps && deps.resolveRootSessionId ? deps.resolveRootSessionId(sessionId) : '') || String(sessionId || '').trim()
  const effCfg = resolveWorkspaceConfig(state, rootSid)
  let selectedRef = effCfg.modelRef || ''

  const leadRef = sessionModelRef(deps, sessionId)
  const profileDefaultRef = profileDefaultModelRef(runtime)
  const followRef = leadRef || profileDefaultRef || ''

  if (!llm || typeof llm.listProviders !== 'function' || typeof llm.listModels !== 'function') {
    const resolvedRef = selectedRef || followRef || ''
    return {
      available: false,
      selectedRef,
      followRef,
      followLabel: formatChiefModelLabel(followRef, [], [], false),
      defaultRef: followRef,
      resolvedRef,
      resolvedLabel: formatChiefModelLabel(resolvedRef, [], [], true),
      models: [],
    }
  }

  const rawProviders = (llm.listProviders() || []).filter(p => p && p.id && !String(p.id).startsWith('local-agent'))
  const registeredProviderIds = new Set(rawProviders.map(p => String(p.id)))

  // Auto-heal stale selectedRef if its provider was uninstalled/removed (e.g. legacy `opendesign/...`)
  if (selectedRef) {
    const parsedSel = splitModelRef(selectedRef)
    if (!parsedSel || (registeredProviderIds.size > 0 && !registeredProviderIds.has(parsedSel.provider))) {
      selectedRef = ''
      mutateChiefState((s) => {
        s.config.modelRef = ''
      })
    }
  }

  let items = []
  if (!fresh && modelCatalogCache.items.length > 0 && Date.now() - modelCatalogCache.at < CATALOG_TTL_MS) {
    items = modelCatalogCache.items.slice()
  } else {
    try {
      const missingKeys = await detectMissingProviderKeysAsync(runtime, llm, [...registeredProviderIds])
      for (const provider of rawProviders) {
        const pid = String(provider.id)
        const pname = String(provider.name || provider.label || pid)
        const needsKey = missingKeys.has(pid)
        let models = []
        try {
          models = (await llm.listModels(pid)) || []
        } catch {
          continue
        }
        for (const m of models) {
          if (!m || !m.id) continue
          items.push({
            ref: `${pid}/${m.id}`,
            provider: pid,
            providerName: pname,
            id: String(m.id),
            name: String(m.name || m.label || m.id),
            ...(needsKey ? { needsKey: true } : {}),
          })
        }
      }
    } catch {}
    modelCatalogCache = { at: Date.now(), items: items.slice() }
  }

  // Ensure the active main-conversation model (`followRef`) & `profileDefaultRef` appear in the catalog
  // even when a dynamic provider (e.g. Command Code) only returned a subset in `listModels()`!
  const ensureListed = async (refToEnsure, markCurrent = false) => {
    const parsed = splitModelRef(refToEnsure)
    if (!parsed || !registeredProviderIds.has(parsed.provider)) return
    const existing = items.find(it => it.ref === parsed.ref)
    if (existing) {
      if (markCurrent) existing.isCurrentLead = true
      return
    }
    const provObj = rawProviders.find(p => String(p.id) === parsed.provider)
    const pname = String((provObj && (provObj.name || provObj.label)) || parsed.provider)
    let displayName = stripVendorPrefixFromModelId(parsed.model)
    try {
      if (typeof llm.resolveModelInfo === 'function') {
        const info = await llm.resolveModelInfo(parsed.provider, parsed.model)
        if (info && typeof info.name === 'string' && info.name.trim()) {
          displayName = info.name.trim()
        }
      }
    } catch {}
    const entry = {
      ref: parsed.ref,
      provider: parsed.provider,
      providerName: pname,
      id: parsed.model,
      name: displayName,
      ...(markCurrent ? { isCurrentLead: true } : {}),
    }
    // Insert at the top of its provider group so it is immediately visible without scrolling
    const firstProvIdx = items.findIndex(it => it.provider === parsed.provider)
    if (firstProvIdx >= 0) items.splice(firstProvIdx, 0, entry)
    else items.unshift(entry)
  }

  await ensureListed(followRef, true)
  if (profileDefaultRef && profileDefaultRef !== followRef) {
    await ensureListed(profileDefaultRef, false)
  }
  if (selectedRef && selectedRef !== followRef && selectedRef !== profileDefaultRef) {
    await ensureListed(selectedRef, false)
  }

  const picked = pickRouteFromItems(items, selectedRef, followRef, deps, sessionId, registeredProviderIds)
  const resolvedRef = (picked && picked.ref) || selectedRef || followRef || ''
  return {
    available: items.length > 0 || Boolean(resolvedRef),
    selectedRef,
    followRef,
    followLabel: formatChiefModelLabel(followRef, items, rawProviders, false),
    defaultRef: followRef,
    resolvedRef,
    resolvedLabel: formatChiefModelLabel(resolvedRef, items, rawProviders, true),
    models: items,
  }
}

const unusableRouteUntil = new Map()

function isRouteCoolingDown(ref, provider) {
  const now = Date.now()
  if (ref && (unusableRouteUntil.get(ref) || 0) > now) return true
  if (provider && (unusableRouteUntil.get('prov:' + provider) || 0) > now) return true
  return false
}

function markRouteFailure(route, err) {
  if (!route) return
  const msg = String(err && err.message ? err.message : err || '')
  const code = String(err && (err.code || err.failure?.code) ? (err.code || err.failure?.code) : '')
  // Missing API key / auth error / hosted loop engine cannot serve auxiliary completions
  if (/api[_ -]?key|unauthorized|authentication|401|403|not configured|missing key|no key|credentials/i.test(msg) || /AUTH|KEY/i.test(code)) {
    unusableRouteUntil.set('prov:' + route.provider, Date.now() + 90_000)
  } else if (/HOSTED_ENGINE_ROUTE|not a model endpoint|no adapter/i.test(msg) || code === 'HOSTED_ENGINE_ROUTE') {
    unusableRouteUntil.set(route.ref, Date.now() + 300_000)
  } else {
    unusableRouteUntil.set(route.ref, Date.now() + 20_000)
  }
}

function buildRouteQueue(items, selectedRef, followRef, deps, sessionId, registeredProviderIds = null) {
  const seen = new Set()
  const out = []
  const isProviderRegistered = (prov) => {
    if (!prov || String(prov).startsWith('local-agent')) return false
    if (registeredProviderIds && registeredProviderIds.size > 0) return registeredProviderIds.has(prov)
    return true
  }
  const pushCand = (cand, allowUnlisted = false) => {
    const parsed = splitModelRef(cand)
    if (!parsed || !isProviderRegistered(parsed.provider)) return
    if (seen.has(parsed.ref)) return
    if (!allowUnlisted && items.length > 0 && !items.some(it => it.ref === parsed.ref && !it.needsKey)) return
    seen.add(parsed.ref)
    out.push(parsed)
  }

  const liveLeadRef = sessionModelRef(deps, sessionId)
  const primaryFollow = liveLeadRef || followRef || profileDefaultModelRef(deps && deps.runtime)

  if (selectedRef) {
    // Explicit user-pinned Chief model: try it first, then same-provider models, then main session model
    pushCand(selectedRef, true)
    const selParsed = splitModelRef(selectedRef)
    if (selParsed) {
      for (const it of items) {
        if (it && it.provider === selParsed.provider && !it.needsKey) pushCand(it.ref, false)
        if (out.length >= 3) break
      }
    }
    if (primaryFollow) pushCand(primaryFollow, true)
  } else if (primaryFollow) {
    // Auto-follow main conversation mode:
    // MUST use the exact provider/model of the main conversation (e.g. `commandcode/deepseek/deepseek-v4.1-flash`)
    // and NEVER silently jump across to a paid official API provider (like `deepseek/...`)!
    pushCand(primaryFollow, true)
    if (followRef && followRef !== primaryFollow) pushCand(followRef, true)
    const followParsed = splitModelRef(primaryFollow)
    if (followParsed) {
      for (const it of items) {
        if (it && it.provider === followParsed.provider && !it.needsKey) pushCand(it.ref, false)
        if (out.length >= 4) break
      }
    }
  } else {
    // Only when neither a pinned model nor any main/default model exists at all: pick keyed catalog models
    const seenProviders = new Set()
    for (const it of items) {
      if (!it || !it.ref || it.needsKey || seenProviders.has(it.provider)) continue
      seenProviders.add(it.provider)
      pushCand(it.ref, false)
    }
  }

  // Prefer routes not currently cooling down, keeping cooled ones only as last-resort tail
  const healthy = out.filter(r => !isRouteCoolingDown(r.ref, r.provider))
  const cooled = out.filter(r => isRouteCoolingDown(r.ref, r.provider))
  return [...healthy, ...cooled]
}

function pickRouteFromItems(items, selectedRef, followRef, deps, sessionId, registeredProviderIds = null) {
  const queue = buildRouteQueue(items, selectedRef, followRef, deps, sessionId, registeredProviderIds)
  return queue[0] || null
}

async function callOneRoute(llm, route, system, userText, maxTokens = SUMMARY_MAX_TOKENS, sessionId = '', imageBlocks = []) {
  let effort
  let modelDefaultMaxTokens
  try {
    if (typeof llm.resolveModelInfo === 'function') {
      const info = await llm.resolveModelInfo(route.provider, route.model)
      if (typeof info?.defaultMaxTokens === 'number' && info.defaultMaxTokens > 0) {
        modelDefaultMaxTokens = info.defaultMaxTokens
      }
      const efforts = info?.reasoning?.efforts
      if (Array.isArray(efforts) && efforts.length > 0) {
        effort = efforts.some(e => e.id === 'off') ? 'off' : efforts[0]?.id
      }
    }
  } catch {}

  const targetBudget = Math.max(Number(maxTokens) || 0, SUMMARY_MAX_TOKENS)
  const firstBudget = modelDefaultMaxTokens ? Math.min(modelDefaultMaxTokens, targetBudget) : targetBudget
  const retryBudget = firstBudget < targetBudget ? targetBudget : SUMMARY_RETRY_MAX_TOKENS
  const budgets = retryBudget > firstBudget ? [firstBudget, retryBudget] : [firstBudget]
  const safeImages = Array.isArray(imageBlocks) ? imageBlocks : []

  const runOnce = async (budget) => {
    const userContent = [...safeImages, { type: 'text', text: userText || '请查看附图并回答。' }]
    const request = {
      provider: route.provider,
      model: route.model,
      ...(sessionId ? { sessionId } : {}),
      ...(effort !== undefined ? { reasoningEffort: effort } : {}),
      system,
      messages: [{ role: 'user', content: userContent }],
      maxTokens: budget,
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    }

    const dshLlm = await loadDshLlm()
    if (dshLlm && typeof dshLlm.BlockAssembler === 'function') {
      const assembler = new dshLlm.BlockAssembler()
      for await (const chunk of llm.stream(request)) {
        assembler.push(chunk)
      }
      const finish = assembler.finish
      if (finish && (finish.kind === 'error' || finish.kind === 'aborted')) {
        const err = new Error(finish.failure?.message || finish.failure?.code || finish.kind || 'LLM request error')
        err.failure = finish.failure
        throw err
      }
      const text = assembler
        .blocks()
        .filter(b => b && b.type === 'text' && typeof b.text === 'string')
        .map(b => b.text)
        .join('\n')
        .trim()
      return { text, finishKind: finish?.kind || '', modelRef: route.ref }
    }

    // Pure standalone fallback stream reader (for unit tests / lightweight hosts)
    const parts = []
    let finishKind = ''
    for await (const chunk of llm.stream(request)) {
      if (!chunk || typeof chunk !== 'object') continue
      if (chunk.type === 'text-delta' || chunk.type === 'text_delta') {
        if (typeof chunk.text === 'string') parts.push(chunk.text)
        else if (typeof chunk.delta === 'string') parts.push(chunk.delta)
      } else if (chunk.type === 'text' && typeof chunk.text === 'string') parts.push(chunk.text)
      else if (typeof chunk.content === 'string') parts.push(chunk.content)
      else if (chunk.type === 'finish') {
        finishKind = chunk.reason?.kind || chunk.finishReason || ''
        if (finishKind === 'error') {
          const err = new Error(chunk.reason?.failure?.message || 'LLM stream error')
          err.failure = chunk.reason?.failure
          throw err
        }
      }
    }
    return { text: parts.join('').trim(), finishKind, modelRef: route.ref }
  }

  let lastRes = { text: '', finishKind: '', modelRef: route.ref }
  for (let i = 0; i < budgets.length; i += 1) {
    const res = await runOnce(budgets[i])
    lastRes = res
    if (res.text && res.finishKind !== 'max-tokens') {
      return { text: res.text, modelRef: res.modelRef }
    }
  }
  return { text: lastRes.text, modelRef: lastRes.modelRef }
}

async function filterVisionRoutes(llm, queue) {
  const visionRoutes = []
  const unknownRoutes = []
  for (const route of queue) {
    let info = null
    try {
      if (typeof llm.resolveModelInfo === 'function') {
        info = await Promise.resolve(llm.resolveModelInfo(route.provider, route.model))
      }
    } catch {}
    const mods = Array.isArray(info?.inputModalities)
      ? info.inputModalities
      : (Array.isArray(route.inputModalities) ? route.inputModalities : null)
    if (mods) {
      if (mods.includes('image')) visionRoutes.push(route)
    } else {
      unknownRoutes.push(route)
    }
  }
  return [...visionRoutes, ...unknownRoutes]
}

export async function callChiefLlm(deps, {
  sessionId = '',
  system,
  prompt,
  maxTokens = SUMMARY_MAX_TOKENS,
  imageBlocks = [],
  allowTextFallbackOnVisionMiss = false,
}) {
  const safeImages = Array.isArray(imageBlocks) ? imageBlocks : []
  if (deps && typeof deps.callLlmOverride === 'function') {
    return deps.callLlmOverride({ sessionId, system, prompt, maxTokens, imageBlocks: safeImages, allowTextFallbackOnVisionMiss })
  }
  const llm = deps.getLlm ? deps.getLlm() : null
  if (!llm || typeof llm.stream !== 'function') {
    return { ok: false, error: '当前环境未挂载 LLM 服务' }
  }
  const catalog = await listChiefModels(deps, false, sessionId)
  const regSet = typeof llm.listProviders === 'function'
    ? new Set((llm.listProviders() || []).filter(p => p && p.id && !String(p.id).startsWith('local-agent')).map(p => String(p.id)))
    : null
  const baseQueue = buildRouteQueue(catalog.models, catalog.selectedRef, catalog.followRef || catalog.defaultRef, deps, sessionId, regSet)
  if (!baseQueue.length) {
    return { ok: false, error: '未找到可用的参谋长模型，请在 DSH 设置中配置模型供应商' }
  }

  let queue = baseQueue
  let sendImages = safeImages
  let degradedToTextOnly = false
  if (safeImages.length > 0) {
    const visionQueue = await filterVisionRoutes(llm, baseQueue)
    if (visionQueue.length > 0) {
      queue = visionQueue
    } else if (allowTextFallbackOnVisionMiss) {
      queue = baseQueue
      sendImages = []
      degradedToTextOnly = true
    } else {
      return {
        ok: false,
        error: '当前参谋长及备选模型均不支持图片输入（仅纯文本），请在右上角切换支持视觉的多模态模型（如 Gemini / Claude / GPT-4o / Qwen-VL 等）后再试。',
      }
    }
  }

  let lastError = '模型返回内容为空'
  for (const route of queue.slice(0, 4)) {
    try {
      const res = await callOneRoute(llm, route, system, prompt, maxTokens, sessionId, sendImages)
      if (res.text) return { ok: true, text: res.text, modelRef: res.modelRef, degradedToTextOnly }
      lastError = `${route.ref} 返回内容为空`
      markRouteFailure(route, new Error(lastError))
    } catch (err) {
      lastError = String(err && err.message ? err.message : err)
      if (sendImages.length > 0 && allowTextFallbackOnVisionMiss) {
        try {
          const textRes = await callOneRoute(llm, route, system, prompt, maxTokens, sessionId, [])
          if (textRes.text) return { ok: true, text: textRes.text, modelRef: textRes.modelRef, degradedToTextOnly: true }
        } catch {}
      }
      markRouteFailure(route, err)
    }
  }
  return { ok: false, error: lastError, degradedToTextOnly }
}

/* -------------------------------------------------------------------------- */
/* Peer Discovery & Cross-Conversation Delivery ("递话 / 插话")               */
/* -------------------------------------------------------------------------- */
