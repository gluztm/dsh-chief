/**
 * external-memory-connectors.js — 参谋专属三大零依赖通用连接器
 *
 * 【核心职责】
 *   1. `mcp-http`：纯原生 fetch 实现 MCP Streamable HTTP (JSON-RPC 2.0 + SSE)，自动发现并匹配读写/撤回工具。
 *   2. `chief-http`：极简 2+3 接口开放 HTTP 协议（/prefetch, /sync, /health, /pre-compress, /dream, /retract），通吃自建记忆与情感状态机。
 *   3. `markdown-vault`：纯 node:fs 本地目录只读扫描 + 中英双语 2-gram/词元相关性打分，零写入、零外部依赖。
 *
 * 【边界约定】
 *   - 仅单向依赖 `node:fs`、`node:path` 与 `./state-schema.js`；
 *   - 严禁导入 `node:child_process`、严禁反向导入 `chief-state.js` / `index.js`；
 *   - 所有外发文本强制经过 `scrubExternalMemoryText` 脱敏。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { clamp, scrubExternalMemoryText } from './state-schema.js'

const MCP_PROTOCOL_VERSION = '2024-11-05'
const MCP_CACHE_TTL_MS = 60_000
const MCP_CLIENT_INFO = { name: 'dsh-chief', version: '2.0.0' }
const mcpSessionCache = new Map()
let rpcSeq = 1

export function buildAuthHeaders(slotCfg = {}) {
  const headers = {}
  let token = ''
  const envName = typeof slotCfg.authEnvVar === 'string' ? slotCfg.authEnvVar.trim() : ''
  if (envName && process.env && typeof process.env[envName] === 'string' && process.env[envName].trim()) {
    token = process.env[envName].trim()
  } else if (typeof slotCfg.authToken === 'string' && slotCfg.authToken.trim()) {
    token = slotCfg.authToken.trim()
  }
  if (token) {
    headers.authorization = /^(?:Bearer|Token)\s+/i.test(token) ? token : `Bearer ${token}`
  }
  return headers
}

function mcpCacheKey(endpoint, headers = {}) {
  const auth = headers.authorization || ''
  return `${endpoint}::${auth.slice(0, 24)}`
}

export function clearMcpSessionCache(endpoint = '') {
  if (!endpoint) {
    mcpSessionCache.clear()
    return
  }
  for (const k of mcpSessionCache.keys()) {
    if (k.startsWith(endpoint + '::')) mcpSessionCache.delete(k)
  }
}

function parseSseJsonRpcResponse(rawText, expectedId) {
  const lines = String(rawText || '').split(/\r?\n/)
  let lastValid = null
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const dataPart = trimmed.slice(5).trim()
    if (!dataPart || dataPart === '[DONE]') continue
    try {
      const obj = JSON.parse(dataPart)
      if (obj && typeof obj === 'object') {
        lastValid = obj
        if (expectedId !== undefined && obj.id === expectedId) return obj
      }
    } catch {}
  }
  return lastValid
}

async function mcpJsonRpc(endpoint, method, params = {}, { headers = {}, mcpSessionId = '', signal, isNotification = false } = {}) {
  const id = isNotification ? undefined : (rpcSeq += 1)
  const payload = isNotification
    ? { jsonrpc: '2.0', method, params }
    : { jsonrpc: '2.0', id, method, params }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
      ...(mcpSessionId ? { 'mcp-session-id': mcpSessionId } : {}),
    },
    body: JSON.stringify(payload),
    signal,
  })

  const respSessionId = res.headers.get('mcp-session-id') || mcpSessionId || ''
  if (!res.ok) {
    const errTxt = await res.text().catch(() => '')
    const err = new Error(`MCP HTTP ${res.status}: ${clamp(errTxt || res.statusText || 'request failed', 160)}`)
    err.httpStatus = res.status
    err.mcpSessionId = respSessionId
    throw err
  }

  if (isNotification || res.status === 202 || res.status === 204) {
    return { ok: true, mcpSessionId: respSessionId, result: null }
  }

  const contentType = (res.headers.get('content-type') || '').toLowerCase()
  const rawText = await res.text()
  if (!rawText.trim()) {
    return { ok: true, mcpSessionId: respSessionId, result: null }
  }

  let msg = null
  if (contentType.includes('text/event-stream') || /^\s*(?:event:|data:)/m.test(rawText)) {
    msg = parseSseJsonRpcResponse(rawText, id)
  } else {
    try {
      msg = JSON.parse(rawText)
    } catch {
      msg = parseSseJsonRpcResponse(rawText, id)
    }
  }
  if (!msg || typeof msg !== 'object') {
    throw new Error('MCP returned invalid JSON-RPC payload')
  }
  if (msg.error) {
    const errMsg = typeof msg.error === 'string' ? msg.error : (msg.error.message || JSON.stringify(msg.error))
    const err = new Error(`MCP RPC error: ${clamp(errMsg, 180)}`)
    err.rpcCode = msg.error.code
    err.mcpSessionId = respSessionId
    throw err
  }
  return { ok: true, mcpSessionId: respSessionId, result: msg.result }
}

async function ensureMcpSessionAndTools(slotCfg, signal, { forceRefresh = false } = {}) {
  const endpoint = typeof slotCfg.endpoint === 'string' ? slotCfg.endpoint.trim() : ''
  if (!endpoint) throw new Error('MCP endpoint is empty')
  const headers = buildAuthHeaders(slotCfg)
  const key = mcpCacheKey(endpoint, headers)
  const cached = mcpSessionCache.get(key)
  if (!forceRefresh && cached && cached.tools && (Date.now() - cached.at < MCP_CACHE_TTL_MS)) {
    return { endpoint, headers, key, ...cached }
  }

  const initRes = await mcpJsonRpc(endpoint, 'initialize', {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: MCP_CLIENT_INFO,
  }, { headers, signal })

  const mcpSessionId = initRes.mcpSessionId || ''
  try {
    await mcpJsonRpc(endpoint, 'notifications/initialized', {}, {
      headers,
      mcpSessionId,
      signal,
      isNotification: true,
    })
  } catch {}

  const listRes = await mcpJsonRpc(endpoint, 'tools/list', {}, {
    headers,
    mcpSessionId,
    signal,
  })
  const tools = Array.isArray(listRes.result && listRes.result.tools) ? listRes.result.tools : []
  const entry = {
    mcpSessionId: listRes.mcpSessionId || mcpSessionId,
    tools,
    at: Date.now(),
  }
  mcpSessionCache.set(key, entry)
  return { endpoint, headers, key, ...entry }
}

async function callMcpToolWithAutoReconnect(slotCfg, toolName, args, signal) {
  let sess = await ensureMcpSessionAndTools(slotCfg, signal)
  try {
    return await mcpJsonRpc(sess.endpoint, 'tools/call', {
      name: toolName,
      arguments: args,
    }, {
      headers: sess.headers,
      mcpSessionId: sess.mcpSessionId,
      signal,
    })
  } catch (err) {
    if (err && (err.httpStatus === 404 || err.httpStatus === 400 || /session/i.test(String(err.message || '')))) {
      clearMcpSessionCache(sess.endpoint)
      sess = await ensureMcpSessionAndTools(slotCfg, signal, { forceRefresh: true })
      return await mcpJsonRpc(sess.endpoint, 'tools/call', {
        name: toolName,
        arguments: args,
      }, {
        headers: sess.headers,
        mcpSessionId: sess.mcpSessionId,
        signal,
      })
    }
    throw err
  }
}

export function resolveMcpTools(tools = [], slotCfg = {}) {
  const list = Array.isArray(tools) ? tools.filter(t => t && typeof t.name === 'string') : []
  const byName = new Map(list.map(t => [t.name, t]))

  const pickByPriority = (explicitName, exactList, fallbackRe) => {
    const clean = typeof explicitName === 'string' ? explicitName.trim() : ''
    if (clean && byName.has(clean)) return byName.get(clean)
    if (clean) return { name: clean, inputSchema: null }
    for (const candidate of exactList) {
      if (byName.has(candidate)) return byName.get(candidate)
    }
    return list.find(t => fallbackRe.test(t.name)) || null
  }

  return {
    searchTool: pickByPriority(
      slotCfg.searchTool,
      ['memory_search', 'search_memories', 'memory_recall', 'recall', 'memory_context', 'query_memories'],
      /(?:memory|mem).*(?:search|recall|query|context)|^(?:search|recall)/i,
    ),
    writeTool: pickByPriority(
      slotCfg.writeTool,
      ['memory_propose', 'memory_save', 'add_memory', 'remember', 'store_memory', 'save_memory'],
      /(?:memory|mem).*(?:propose|save|add|write|store)|^(?:remember|add_memory)/i,
    ),
    retractTool: pickByPriority(
      slotCfg.retractTool,
      ['memory_forget', 'delete_memory', 'forget', 'remove_memory'],
      /(?:memory|mem).*(?:forget|delete|remove)|^(?:forget)/i,
    ),
  }
}

function buildSearchToolArgs(toolDef, { query, topK, projectKey, sessionId }) {
  const props = (toolDef && toolDef.inputSchema && toolDef.inputSchema.properties) || null
  if (!props || typeof props !== 'object' || Object.keys(props).length === 0) {
    return {
      query,
      limit: topK,
      ...(projectKey ? { project: projectKey } : {}),
    }
  }
  const args = {}
  if ('query' in props) args.query = query
  else if ('q' in props) args.q = query
  else if ('text' in props) args.text = query
  else if ('input' in props) args.input = query
  else args.query = query

  if ('limit' in props) args.limit = topK
  else if ('top_k' in props) args.top_k = topK
  else if ('topK' in props) args.topK = topK
  else if ('k' in props) args.k = topK

  if ('project' in props && projectKey) args.project = projectKey
  if ('session_id' in props && sessionId) args.session_id = sessionId
  if ('sessionId' in props && sessionId) args.sessionId = sessionId
  return args
}

function buildWriteToolArgs(toolDef, { content, projectKey, sessionId, turnKind }) {
  const props = (toolDef && toolDef.inputSchema && toolDef.inputSchema.properties) || null
  const isPropose = toolDef && /propose/i.test(toolDef.name || '')
  if (!props || typeof props !== 'object' || Object.keys(props).length === 0) {
    return {
      content,
      kind: 'fact',
      scope: projectKey ? 'project' : 'global',
      ...(projectKey ? { project: projectKey } : {}),
      source: 'dsh-chief',
    }
  }
  const args = {}
  if ('content' in props) args.content = content
  else if ('text' in props) args.text = content
  else if ('memory' in props) args.memory = content
  else if ('fact' in props) args.fact = content
  else args.content = content

  if ('kind' in props) {
    const allowed = Array.isArray(props.kind.enum) ? props.kind.enum : []
    args.kind = allowed.includes('fact') ? 'fact' : (allowed[0] || 'fact')
  }
  if ('scope' in props) {
    const allowed = Array.isArray(props.scope.enum) ? props.scope.enum : []
    const preferred = projectKey ? 'project' : 'global'
    args.scope = allowed.length ? (allowed.includes(preferred) ? preferred : allowed[0]) : preferred
  }
  if ('project' in props && projectKey) args.project = projectKey
  if ('source' in props) args.source = 'dsh-chief'
  if ('source_id' in props && sessionId) args.source_id = String(sessionId).slice(0, 120)
  if ('approved' in props && !isPropose) args.approved = true
  if ('confidence' in props) args.confidence = turnKind === 'lead_summary' ? 0.75 : 0.9
  return args
}

function buildRetractToolArgs(toolDef, { id, sessionId }) {
  const props = (toolDef && toolDef.inputSchema && toolDef.inputSchema.properties) || null
  if (!props || typeof props !== 'object') return { id }
  const args = {}
  if ('id' in props) args.id = id
  else if ('memory_id' in props) args.memory_id = id
  else if ('memoryId' in props) args.memoryId = id
  else args.id = id
  if ('reason' in props) args.reason = 'retracted by chief operator'
  if ('session_id' in props && sessionId) args.session_id = sessionId
  return args
}

function normalizeEvidenceTag(raw) {
  const s = String(raw || '').trim().toLowerCase()
  if (s === 'observed' || s === 'direct' || s === 'verified' || s === 'fact') return 'observed'
  if (s === 'inferred' || s === 'candidate' || s === 'guess' || s === 'hypothesis') return 'inferred'
  return 'recorded'
}

function normalizeExternalItems(rawItems, fallbackSource = '') {
  if (!Array.isArray(rawItems)) return []
  const out = []
  for (const row of rawItems) {
    if (!row) continue
    if (typeof row === 'string') {
      const text = row.trim()
      if (!text) continue
      out.push({
        id: '',
        title: clamp(text, 48),
        preview: clamp(text, 240),
        evidence: 'recorded',
        source: fallbackSource,
        score: undefined,
      })
      continue
    }
    if (typeof row !== 'object') continue
    const preview = clamp(row.preview || row.content || row.text || row.summary || row.memory || '', 260)
    if (!preview) continue
    const evidence = normalizeEvidenceTag(row.evidence || row.status || row.kind)
    out.push({
      id: typeof row.id === 'string' ? row.id.slice(0, 80) : (typeof row.memory_id === 'string' ? row.memory_id.slice(0, 80) : ''),
      title: clamp(row.title || row.slot || row.kind || preview, 56),
      preview,
      evidence,
      source: clamp(row.source || row.project || fallbackSource || '', 60),
      score: Number.isFinite(Number(row.score)) ? Number(row.score) : undefined,
    })
  }
  return out
}

function parseMcpToolCallResult(result, sourceLabel = 'mcp') {
  if (!result || typeof result !== 'object') return { promptText: '', items: [] }
  if (result.isError) {
    const errTxt = Array.isArray(result.content)
      ? result.content.map(c => (c && c.text) || '').join(' ').trim()
      : ''
    throw new Error(errTxt || 'MCP tool returned isError=true')
  }
  const chunks = []
  if (Array.isArray(result.content)) {
    for (const part of result.content) {
      if (part && part.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
        chunks.push(part.text.trim())
      }
    }
  }
  const combinedText = chunks.join('\n').trim()
  if (!combinedText) return { promptText: '', items: [] }

  try {
    const parsed = JSON.parse(combinedText)
    if (Array.isArray(parsed)) {
      const items = normalizeExternalItems(parsed, sourceLabel)
      return { promptText: '', items }
    }
    if (parsed && typeof parsed === 'object') {
      const list = parsed.items || parsed.memories || parsed.results || parsed.hits || parsed.data || null
      if (Array.isArray(list)) {
        const items = normalizeExternalItems(list, sourceLabel)
        return {
          promptText: typeof parsed.promptText === 'string' ? parsed.promptText.trim() : '',
          items,
        }
      }
      if (typeof parsed.content === 'string' || typeof parsed.text === 'string' || typeof parsed.summary === 'string') {
        const items = normalizeExternalItems([parsed], sourceLabel)
        return { promptText: '', items }
      }
    }
  } catch {}

  const items = [{
    id: '',
    title: sourceLabel,
    preview: clamp(combinedText, 280),
    evidence: 'recorded',
    source: sourceLabel,
  }]
  return { promptText: combinedText, items }
}

export async function mcpPrefetch(slotCfg, { query, sessionId, projectKey, topK, signal }) {
  const sess = await ensureMcpSessionAndTools(slotCfg, signal)
  const resolved = resolveMcpTools(sess.tools, slotCfg)
  if (!resolved.searchTool) {
    throw new Error('MCP server exposes no memory search/recall tool')
  }
  const args = buildSearchToolArgs(resolved.searchTool, { query, topK, projectKey, sessionId })
  const callRes = await callMcpToolWithAutoReconnect(slotCfg, resolved.searchTool.name, args, signal)
  const parsed = parseMcpToolCallResult(callRes.result, slotCfg.label || resolved.searchTool.name)
  return {
    ...parsed,
    providerLabel: slotCfg.label || 'MCP Memory',
    toolUsed: resolved.searchTool.name,
  }
}

export async function mcpSyncTurn(slotCfg, { userText, chiefReply, sessionId, projectKey, turnKind, signal }) {
  const sess = await ensureMcpSessionAndTools(slotCfg, signal)
  const resolved = resolveMcpTools(sess.tools, slotCfg)
  if (!resolved.writeTool) {
    return { skipped: 'no-write-tool' }
  }
  const cleanUser = clamp(scrubExternalMemoryText(userText), 420)
  const cleanReply = clamp(scrubExternalMemoryText(chiefReply), 700)
  if (!cleanUser && !cleanReply) return { skipped: 'empty' }
  const content = turnKind === 'lead_summary'
    ? `[主对话摘要] ${cleanUser} → ${cleanReply}`
    : `[参谋对话] 问：${cleanUser}\n答：${cleanReply}`
  const args = buildWriteToolArgs(resolved.writeTool, { content, projectKey, sessionId, turnKind })
  const callRes = await callMcpToolWithAutoReconnect(slotCfg, resolved.writeTool.name, args, signal)
  let writtenIds = []
  try {
    const parsed = JSON.parse((callRes.result?.content?.[0]?.text) || '{}')
    if (parsed && typeof parsed.id === 'string' && parsed.id) writtenIds = [parsed.id]
  } catch {}
  return { ok: true, toolUsed: resolved.writeTool.name, writtenIds }
}

export async function mcpRetract(slotCfg, { ids = [], sessionId, signal }) {
  const sess = await ensureMcpSessionAndTools(slotCfg, signal)
  const resolved = resolveMcpTools(sess.tools, slotCfg)
  if (!resolved.retractTool) return { ok: false, error: '当前 MCP 未提供记忆撤回/遗忘工具' }
  const deleted = []
  for (const rawId of ids.slice(0, 10)) {
    const id = String(rawId || '').trim()
    if (!id) continue
    const args = buildRetractToolArgs(resolved.retractTool, { id, sessionId })
    await callMcpToolWithAutoReconnect(slotCfg, resolved.retractTool.name, args, signal)
    deleted.push(id)
  }
  return { ok: true, deleted }
}

export async function mcpProbe(slotCfg, { testQuery = '当前项目记忆', projectKey = '', sessionId = '', signal }) {
  const t0 = Date.now()
  const sess = await ensureMcpSessionAndTools(slotCfg, signal, { forceRefresh: true })
  const resolved = resolveMcpTools(sess.tools, slotCfg)
  let recallRes = { items: [], promptText: '' }
  if (resolved.searchTool && testQuery) {
    const args = buildSearchToolArgs(resolved.searchTool, { query: testQuery, topK: 4, projectKey, sessionId })
    const callRes = await callMcpToolWithAutoReconnect(slotCfg, resolved.searchTool.name, args, signal)
    recallRes = parseMcpToolCallResult(callRes.result, slotCfg.label || resolved.searchTool.name)
  }
  return {
    ok: true,
    kind: 'mcp-http',
    latencyMs: Date.now() - t0,
    tools: sess.tools.map(t => t.name),
    selectedTools: {
      search: resolved.searchTool ? resolved.searchTool.name : '',
      write: resolved.writeTool ? resolved.writeTool.name : '',
      retract: resolved.retractTool ? resolved.retractTool.name : '',
    },
    items: recallRes.items || [],
    promptText: recallRes.promptText || '',
  }
}

/* ------------------------------------------------------------------ chief-http */

export async function httpPostJson(url, payload, { headers = {}, signal } = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      ...headers,
    },
    body: JSON.stringify(payload),
    signal,
  })
  if (!res.ok) {
    const errTxt = await res.text().catch(() => '')
    const err = new Error(`HTTP ${res.status}: ${clamp(errTxt || res.statusText || 'failed', 160)}`)
    err.httpStatus = res.status
    throw err
  }
  const raw = await res.text()
  if (!raw.trim()) return {}
  return JSON.parse(raw)
}

export async function chiefHttpPrefetch(slotCfg, slotName, { query, sessionId, workspaceCwd, projectKey, reasonKind, isWorkMode, charBudget, topK, signal }) {
  const base = typeof slotCfg.endpoint === 'string' ? slotCfg.endpoint.replace(/\/+$/, '') : ''
  if (!base) throw new Error('HTTP endpoint is empty')
  const headers = buildAuthHeaders(slotCfg)
  const data = await httpPostJson(`${base}/prefetch`, {
    apiVersion: 'dsh-chief.provider/v1',
    slot: slotName,
    query: scrubExternalMemoryText(query),
    sessionId,
    workspaceCwd,
    projectKey,
    reasonKind,
    mode: isWorkMode ? 'work' : 'chat',
    charBudget,
    topK,
  }, { headers, signal })

  const promptText = typeof data.promptText === 'string'
    ? data.promptText.trim()
    : (typeof data.text === 'string' ? data.text.trim() : (typeof data.content === 'string' ? data.content.trim() : ''))
  const items = normalizeExternalItems(data.items || data.memories || data.results || [], slotCfg.label || slotName)
  const uiBadge = data.uiBadge && typeof data.uiBadge === 'object' && typeof data.uiBadge.text === 'string' && data.uiBadge.text.trim()
    ? {
        glyph: typeof data.uiBadge.glyph === 'string' ? data.uiBadge.glyph.slice(0, 6) : '',
        text: clamp(data.uiBadge.text, 48),
        detail: clamp(data.uiBadge.detail || '', 180),
      }
    : null
  return {
    promptText,
    items,
    uiBadge,
    providerLabel: slotCfg.label || (slotName === 'mood' ? 'HTTP 心境槽' : 'HTTP 记忆槽'),
  }
}

export async function chiefHttpPostEvent(slotCfg, subPath, bodyPayload, signal) {
  const base = typeof slotCfg.endpoint === 'string' ? slotCfg.endpoint.replace(/\/+$/, '') : ''
  if (!base) return { skipped: 'no-endpoint' }
  const headers = buildAuthHeaders(slotCfg)
  try {
    return await httpPostJson(`${base}${subPath}`, {
      apiVersion: 'dsh-chief.provider/v1',
      ...bodyPayload,
    }, { headers, signal })
  } catch (err) {
    if (subPath !== '/sync' && err && (err.httpStatus === 404 || err.httpStatus === 405)) {
      return { skipped: 'unsupported' }
    }
    throw err
  }
}

export async function chiefHttpProbe(slotCfg, slotName, { testQuery = '当前项目记忆', projectKey = '', sessionId = '', signal }) {
  const base = typeof slotCfg.endpoint === 'string' ? slotCfg.endpoint.replace(/\/+$/, '') : ''
  if (!base) throw new Error('HTTP endpoint is empty')
  const headers = buildAuthHeaders(slotCfg)
  const t0 = Date.now()
  let healthOk = false
  let healthDetail = ''
  try {
    const hRes = await fetch(`${base}/health`, { method: 'GET', headers, signal })
    if (hRes.ok) {
      healthOk = true
      const txt = await hRes.text().catch(() => '')
      healthDetail = clamp(txt, 120)
    }
  } catch {}
  const pre = await chiefHttpPrefetch(slotCfg, slotName, {
    query: testQuery,
    sessionId,
    workspaceCwd: '',
    projectKey,
    reasonKind: 'ask_chat',
    isWorkMode: false,
    charBudget: slotName === 'mood' ? 400 : 1200,
    topK: 4,
    signal,
  })
  return {
    ok: true,
    kind: 'chief-http',
    latencyMs: Date.now() - t0,
    healthOk,
    healthDetail,
    items: pre.items || [],
    promptText: pre.promptText || '',
    uiBadge: pre.uiBadge || null,
  }
}

/* -------------------------------------------------------------- markdown-vault */

const MD_SKIP_DIRS = new Set(['node_modules', '.git', '.obsidian', 'private', '.trash', 'dist', 'build'])
const MD_MAX_FILES = 120
const MD_MAX_FILE_BYTES = 64 * 1024
const MD_MAX_DEPTH = 3

function collectMarkdownFiles(rootDir, depth = 0, out = []) {
  if (depth > MD_MAX_DEPTH || out.length >= MD_MAX_FILES) return out
  let entries = []
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const ent of entries) {
    if (out.length >= MD_MAX_FILES) break
    const name = ent.name
    if (!name || name.startsWith('.')) {
      if (name !== '.memory' && name !== '.openclaw') continue
    }
    if (MD_SKIP_DIRS.has(name)) continue
    const full = path.join(rootDir, name)
    if (ent.isDirectory()) {
      collectMarkdownFiles(full, depth + 1, out)
    } else if (ent.isFile() && /\.(?:md|markdown|txt)$/i.test(name)) {
      out.push(full)
    }
  }
  return out
}

function tokenizeBilingualQuery(text) {
  const s = String(text || '').toLowerCase()
  const tokens = new Set()
  const enMatches = s.match(/[a-z0-9_.-]{2,}/g) || []
  for (const w of enMatches) tokens.add(w)
  const zhRuns = s.match(/[\u4e00-\u9fff]{2,}/g) || []
  for (const run of zhRuns) {
    if (run.length <= 4) tokens.add(run)
    for (let i = 0; i < run.length - 1; i += 1) {
      tokens.add(run.slice(i, i + 2))
    }
  }
  return [...tokens].slice(0, 48)
}

function splitMarkdownSections(rawText, relPath) {
  const sections = []
  const lines = String(rawText || '').replace(/\r\n/g, '\n').split('\n')
  let curTitle = path.basename(relPath)
  let buf = []
  const flush = () => {
    const body = buf.join('\n').trim()
    if (body.length >= 8) {
      sections.push({ title: curTitle, body })
    }
    buf = []
  }
  for (const line of lines) {
    const heading = line.match(/^#{1,4}\s+(.+)/)
    if (heading) {
      flush()
      curTitle = clamp(heading[1], 60)
    } else if (line.trim() === '' && buf.join('\n').length > 320) {
      flush()
    } else {
      buf.push(line)
    }
  }
  flush()
  return sections
}

export function markdownVaultPrefetch(slotCfg, { query, topK = 5 }) {
  const vaultPath = typeof slotCfg.vaultPath === 'string' ? slotCfg.vaultPath.trim() : ''
  if (!vaultPath || !fs.existsSync(vaultPath)) {
    throw new Error('Markdown vault directory does not exist')
  }
  const stat = fs.statSync(vaultPath)
  if (!stat.isDirectory()) {
    throw new Error('Markdown vault path is not a directory')
  }
  const files = collectMarkdownFiles(vaultPath)
  const tokens = tokenizeBilingualQuery(query)
  const candidates = []

  for (const file of files) {
    const relPath = path.relative(vaultPath, file).replace(/\\/g, '/')
    const baseLower = path.basename(file).toLowerCase()
    const isAnchorFile = /^(?:memory|user|soul|identity|preferences)\.md$/i.test(baseLower)
    let raw = ''
    try {
      const fd = fs.openSync(file, 'r')
      try {
        const buf = Buffer.allocUnsafe(MD_MAX_FILE_BYTES)
        const bytesRead = fs.readSync(fd, buf, 0, MD_MAX_FILE_BYTES, 0)
        raw = buf.toString('utf8', 0, bytesRead)
      } finally {
        fs.closeSync(fd)
      }
    } catch {
      continue
    }
    const sections = splitMarkdownSections(raw, relPath)
    for (const sec of sections) {
      const hay = `${relPath} ${sec.title} ${sec.body}`.toLowerCase()
      let score = isAnchorFile ? 1.2 : 0
      let matched = 0
      for (const tok of tokens) {
        if (hay.includes(tok)) {
          matched += 1
          score += tok.length >= 4 ? 2.2 : 1.3
          if (sec.title.toLowerCase().includes(tok)) score += 1.5
        }
      }
      if (tokens.length > 0 && matched === 0 && !isAnchorFile) continue
      if (tokens.length === 0 && !isAnchorFile) continue
      candidates.push({
        id: '',
        title: `${relPath} · ${sec.title}`,
        preview: clamp(sec.body, 260),
        evidence: 'recorded',
        source: relPath,
        score: Number(score.toFixed(2)),
      })
    }
  }

  candidates.sort((a, b) => (b.score || 0) - (a.score || 0))
  const picked = candidates.slice(0, Math.max(1, Math.min(10, topK)))
  return {
    items: picked,
    promptText: '',
    fileCount: files.length,
    providerLabel: slotCfg.label || 'Markdown 目录',
  }
}

/* ----------------------------------------------------- builtin-md & discovery */

export const EXT_MEM_CATEGORIES = ['preference', 'rule', 'decision', 'lesson', 'bond']

const KEYWORD_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'have', 'will', 'your', 'about', 'just',
  '我们', '你们', '他们', '这个', '那个', '一些', '已经', '需要', '进行', '通过', '如果', '但是', '因为', '所以',
  '可以', '没有', '不是', '时候', '什么', '怎么', '如何', '当前', '现在', '以后', '之前', '不要', '记住', '参谋',
])

export function inferMemoryCategory(text) {
  const s = String(text || '')
  if (/(?:绝不|禁止|严禁|底线|红线|千万别|不要再|规矩|必须|约定好|先商量|先确认|never|forbid|must not|\brule\b)/i.test(s)) {
    return 'rule'
  }
  if (/(?:踩坑|教训|报错|崩溃|\bbug\b|修复|根因|故障|排查|注意避免|pitfall|\bfix\b|\berror\b)/i.test(s)) {
    return 'lesson'
  }
  if (/(?:决定|架构|方案|采用|技术栈|端口|路径|仓库|版本|接口|protocol|schema|design|deploy)/i.test(s)) {
    return 'decision'
  }
  if (/(?:叫我|称呼|总司令|哈基米|纪念|心情|陪伴|朋友|喜欢聊|\btone\b|\bpersona\b|\bname\b)/i.test(s)) {
    return 'bond'
  }
  return 'preference'
}

export function extractMemoryKeywords(text) {
  const tokens = tokenizeBilingualQuery(text)
  const out = []
  for (const tok of tokens) {
    if (!tok || tok.length < 2 || KEYWORD_STOPWORDS.has(tok)) continue
    if (/^\d+$/.test(tok)) continue
    out.push(tok)
    if (out.length >= 5) break
  }
  return out
}

export function computeMemoryVitality(item, halfLifeDays = 21, nowMs = Date.now()) {
  const hl = Math.max(3, Math.min(365, Math.round(Number(halfLifeDays) || 21)))
  const rawDate = String((item && (item.lastActive || item.date)) || '').trim()
  let ts = 0
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    const [y, m, d] = rawDate.split('-').map(Number)
    ts = Date.UTC(y, m - 1, d)
  } else {
    ts = nowMs - 3 * 86400000
  }
  const daysSince = Math.max(0, Number(((nowMs - ts) / 86400000).toFixed(1)))
  if (item && item.pinned) {
    return { vitality: 100, daysSince, stage: 'pinned', halfLifeDays: hl }
  }
  const hits = Math.max(0, Number((item && item.hits) || 0))
  const effectiveHalfLife = hl * (1 + Math.min(8, hits) * 0.45)
  const retention = Math.exp((-daysSince * Math.LN2) / effectiveHalfLife)
  const vitality = Math.round(Math.max(0.12, Math.min(1, retention)) * 100)
  const stage = vitality >= 72 ? 'fresh' : (vitality >= 40 ? 'warm' : 'fading')
  return { vitality, daysSince, stage, halfLifeDays: hl }
}

export function defaultChiefMemoryDir() {
  const dshHome = (process.env && process.env.DSH_HOME && process.env.DSH_HOME.trim())
    ? process.env.DSH_HOME.trim()
    : path.join(os.homedir(), '.dsh')
  return path.join(dshHome, 'chief', 'memory')
}

export function defaultChiefMemoryFile(customDir = '') {
  const dir = customDir && String(customDir).trim() ? String(customDir).trim() : defaultChiefMemoryDir()
  return path.join(dir, 'MEMORY.md')
}

const BUILTIN_LINE_META_RE = /^-\s+\[([^\]]+)\]\s*(.+)$/
const BUILTIN_PLAIN_BULLET_RE = /^[-*]\s+(.+)$/

function parseBuiltinLine(trimmed, lineIndex, halfLifeDays = 21) {
  const mm = trimmed.match(BUILTIN_LINE_META_RE)
  if (mm) {
    const metaStr = mm[1]
    const text = mm[2].trim()
    if (!text) return null
    const parts = metaStr.split('|').map(s => s.trim()).filter(Boolean)
    let date = ''
    let id = ''
    let category = ''
    let pinned = false
    let hits = 0
    let lastActive = ''
    for (const part of parts) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(part)) {
        if (!date) date = part
      } else if (part.startsWith('id=')) {
        id = part.slice(3).trim()
      } else if (part.startsWith('cat=')) {
        const c = part.slice(4).trim()
        if (EXT_MEM_CATEGORIES.includes(c)) category = c
      } else if (part.startsWith('pin=')) {
        const p = part.slice(4).trim()
        pinned = p === '1' || p === 'true'
      } else if (part.startsWith('hits=')) {
        hits = Math.max(0, Math.round(Number(part.slice(5).trim()) || 0))
      } else if (part.startsWith('last=')) {
        const l = part.slice(5).trim()
        if (/^\d{4}-\d{2}-\d{2}$/.test(l)) lastActive = l
      }
    }
    if (!id) id = `line-${lineIndex}`
    const resolvedCat = category || inferMemoryCategory(text)
    const resolvedLast = lastActive || date
    const vit = computeMemoryVitality({ date, lastActive: resolvedLast, pinned, hits }, halfLifeDays)
    return {
      id,
      date,
      lastActive: resolvedLast,
      text,
      title: clamp(text, 48),
      preview: clamp(text, 280),
      category: resolvedCat,
      pinned,
      hits,
      vitality: vit.vitality,
      daysSince: vit.daysSince,
      stage: vit.stage,
      keywords: extractMemoryKeywords(text),
      source: 'MEMORY.md',
      evidence: 'recorded',
      lineIndex,
    }
  }
  const pm = trimmed.match(BUILTIN_PLAIN_BULLET_RE)
  if (pm && pm[1].trim()) {
    const text = pm[1].trim()
    const resolvedCat = inferMemoryCategory(text)
    const vit = computeMemoryVitality({ date: '', lastActive: '', pinned: false, hits: 0 }, halfLifeDays)
    return {
      id: `line-${lineIndex}`,
      date: '',
      lastActive: '',
      text,
      title: clamp(text, 48),
      preview: clamp(text, 280),
      category: resolvedCat,
      pinned: false,
      hits: 0,
      vitality: vit.vitality,
      daysSince: vit.daysSince,
      stage: vit.stage,
      keywords: extractMemoryKeywords(text),
      source: 'MEMORY.md',
      evidence: 'recorded',
      lineIndex,
    }
  }
  return null
}

function formatBuiltinLine(item) {
  const dateStr = item.date && /^\d{4}-\d{2}-\d{2}$/.test(item.date)
    ? item.date
    : new Date().toISOString().slice(0, 10)
  const id = item.id && !String(item.id).startsWith('line-')
    ? item.id
    : `cm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const cat = EXT_MEM_CATEGORIES.includes(item.category) ? item.category : inferMemoryCategory(item.text)
  const pin = item.pinned ? 1 : 0
  const hits = Math.max(0, Math.round(Number(item.hits) || 0))
  const last = item.lastActive && /^\d{4}-\d{2}-\d{2}$/.test(item.lastActive) ? item.lastActive : dateStr
  return `- [${dateStr} | id=${id} | cat=${cat} | pin=${pin} | hits=${hits} | last=${last}] ${item.text}`
}

function writeBuiltinLinesAtomic(file, lines) {
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  const content = lines.join('\n')
  const finalContent = content.endsWith('\n') || !content ? content : `${content}\n`
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`
  fs.writeFileSync(tmp, finalContent, 'utf8')
  fs.renameSync(tmp, file)
}

export function listBuiltinMemoryItems(customDir = '', { halfLifeDays = 21 } = {}) {
  const file = defaultChiefMemoryFile(customDir)
  if (!fs.existsSync(file)) return []
  let raw = ''
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  const items = []
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('>')) continue
    const parsed = parseBuiltinLine(trimmed, i, halfLifeDays)
    if (parsed) items.push(parsed)
  }
  return items.reverse()
}

export function addBuiltinMemoryItem(rawText, customDir = '', opts = {}) {
  const cleaned = clamp(scrubExternalMemoryText(String(rawText || '').replace(/[\r\n]+/g, ' ')), 360)
  if (!cleaned) return { ok: false, error: '记忆内容不能为空' }
  const halfLifeDays = opts && opts.halfLifeDays ? opts.halfLifeDays : 21
  const file = defaultChiefMemoryFile(customDir)
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  const existing = listBuiltinMemoryItems(dir, { halfLifeDays })
  const dup = existing.find(it => it.text === cleaned)
  if (dup) {
    return { ok: true, deduplicated: true, item: dup, items: existing, memoryPath: file }
  }
  const dateStr = new Date().toISOString().slice(0, 10)
  const id = `cm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const category = (opts && typeof opts.category === 'string' && EXT_MEM_CATEGORIES.includes(opts.category))
    ? opts.category
    : inferMemoryCategory(cleaned)
  const pinned = Boolean(opts && opts.pinned)
  const line = `${formatBuiltinLine({ id, date: dateStr, lastActive: dateStr, category, pinned, hits: 0, text: cleaned })}\n`
  const header = '# DSH 参谋长记忆本 (MEMORY.md)\n\n> 本文件为纯文本 Markdown，你可以随时用记事本或 Obsidian 打开修改；仅对参谋长生效，对主对话 @lead 保持 0 字节隔离。\n\n'
  const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : header
  const nextContent = prev.endsWith('\n') || !prev ? (prev + line) : (prev + '\n' + line)
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`
  fs.writeFileSync(tmp, nextContent, 'utf8')
  fs.renameSync(tmp, file)
  const itemsAfter = listBuiltinMemoryItems(dir, { halfLifeDays })
  const createdItem = itemsAfter.find(it => it.id === id) || {
    id,
    date: dateStr,
    lastActive: dateStr,
    text: cleaned,
    title: clamp(cleaned, 48),
    preview: cleaned,
    category,
    pinned,
    hits: 0,
    ...computeMemoryVitality({ date: dateStr, lastActive: dateStr, pinned, hits: 0 }, halfLifeDays),
    keywords: extractMemoryKeywords(cleaned),
    source: 'MEMORY.md',
    evidence: 'recorded',
  }
  return {
    ok: true,
    item: createdItem,
    items: itemsAfter,
    memoryPath: file,
  }
}

export function updateBuiltinMemoryItem(idOrText, patchFields = {}, customDir = '', opts = {}) {
  const target = String(idOrText || '').trim()
  if (!target) return { ok: false, error: '缺少待更新的记忆 ID' }
  const halfLifeDays = opts && opts.halfLifeDays ? opts.halfLifeDays : 21
  const file = defaultChiefMemoryFile(customDir)
  if (!fs.existsSync(file)) return { ok: false, error: '记忆本尚无内容' }
  const raw = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const lines = raw.split('\n')
  let updatedId = ''
  const nextLines = lines.map((line, idx) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('>')) return line
    const parsed = parseBuiltinLine(trimmed, idx, halfLifeDays)
    if (!parsed) return line
    const matched = parsed.id === target || `line-${idx}` === target || parsed.text === target
    if (!matched) return line
    const cleanText = typeof patchFields.text === 'string' && patchFields.text.trim()
      ? clamp(scrubExternalMemoryText(patchFields.text.replace(/[\r\n]+/g, ' ')), 360)
      : parsed.text
    if (!cleanText) return line
    const nextCat = (typeof patchFields.category === 'string' && EXT_MEM_CATEGORIES.includes(patchFields.category))
      ? patchFields.category
      : parsed.category
    const nextPin = typeof patchFields.pinned === 'boolean' ? patchFields.pinned : parsed.pinned
    const reinforce = Boolean(patchFields.reinforce)
    const nextHits = reinforce ? (parsed.hits + 1) : parsed.hits
    const todayStr = new Date().toISOString().slice(0, 10)
    const nextLast = reinforce ? todayStr : (parsed.lastActive || parsed.date || todayStr)
    const resolvedId = parsed.id.startsWith('line-')
      ? `cm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      : parsed.id
    updatedId = resolvedId
    return formatBuiltinLine({
      id: resolvedId,
      date: parsed.date || todayStr,
      lastActive: nextLast,
      category: nextCat,
      pinned: nextPin,
      hits: nextHits,
      text: cleanText,
    })
  })
  if (!updatedId) return { ok: false, error: '未找到对应记忆条目' }
  writeBuiltinLinesAtomic(file, nextLines)
  const dir = path.dirname(file)
  const itemsAfter = listBuiltinMemoryItems(dir, { halfLifeDays })
  return {
    ok: true,
    item: itemsAfter.find(it => it.id === updatedId) || null,
    items: itemsAfter,
    memoryPath: file,
  }
}

export function removeBuiltinMemoryItem(idOrText, customDir = '', opts = {}) {
  const target = String(idOrText || '').trim()
  if (!target) return { ok: false, error: '缺少待删除的记忆 ID' }
  const halfLifeDays = opts && opts.halfLifeDays ? opts.halfLifeDays : 21
  const file = defaultChiefMemoryFile(customDir)
  if (!fs.existsSync(file)) return { ok: false, error: '记忆本尚无内容' }
  const raw = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const lines = raw.split('\n')
  let removed = false
  const kept = lines.filter((line, idx) => {
    const t = line.trim()
    const parsed = parseBuiltinLine(t, idx, halfLifeDays)
    if (parsed && (parsed.id === target || parsed.text === target)) {
      removed = true
      return false
    }
    if (`line-${idx}` === target) {
      removed = true
      return false
    }
    return true
  })
  if (!removed) return { ok: false, error: '未找到对应记忆条目' }
  writeBuiltinLinesAtomic(file, kept)
  return { ok: true, removed: target, items: listBuiltinMemoryItems(path.dirname(file), { halfLifeDays }), memoryPath: file }
}

function touchBuiltinMemoryHits(ids = [], customDir = '') {
  const idSet = new Set((Array.isArray(ids) ? ids : []).map(x => String(x || '').trim()).filter(x => x && !x.startsWith('line-')))
  if (!idSet.size) return
  try {
    const file = defaultChiefMemoryFile(customDir)
    if (!fs.existsSync(file)) return
    const lines = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n')
    const todayStr = new Date().toISOString().slice(0, 10)
    let changed = false
    const nextLines = lines.map((line, idx) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('>')) return line
      const parsed = parseBuiltinLine(trimmed, idx)
      if (!parsed || !idSet.has(parsed.id)) return line
      changed = true
      return formatBuiltinLine({
        ...parsed,
        hits: parsed.hits + 1,
        lastActive: todayStr,
      })
    })
    if (changed) writeBuiltinLinesAtomic(file, nextLines)
  } catch {}
}

export function builtinMarkdownPrefetch(slotCfg, { query, topK = 5, recordHit = false, includeAllOnMiss = false } = {}) {
  const dir = (slotCfg && slotCfg.vaultPath && slotCfg.vaultPath.trim()) || defaultChiefMemoryDir()
  const halfLifeDays = (slotCfg && slotCfg.decayHalfLifeDays) || 21
  const all = listBuiltinMemoryItems(dir, { halfLifeDays })
  if (!all.length) {
    return { items: [], promptText: '', providerLabel: '参谋自带记事本' }
  }
  const tokens = tokenizeBilingualQuery(query)
  const scored = all.map((it, idx) => {
    const hay = it.text.toLowerCase()
    let lexScore = 0
    for (const tok of tokens) {
      if (hay.includes(tok)) lexScore += tok.length >= 4 ? 2.4 : 1.4
    }
    const pinBonus = it.pinned ? 1.1 : 0
    const vitBonus = ((it.vitality || 50) / 100) * 0.6
    const recencyBonus = Math.max(0, 0.45 - idx * 0.02)
    const total = lexScore + pinBonus + vitBonus + recencyBonus
    return { ...it, lexScore, score: Number(total.toFixed(2)) }
  })
  const hits = scored.filter(x => x.lexScore >= 1.2 || (x.pinned && x.lexScore > 0))
  let picked = hits.sort((a, b) => b.score - a.score).slice(0, topK)
  if (picked.length < topK) {
    const pickedIds = new Set(picked.map(p => p.id))
    const pinnedExtras = scored.filter(x => x.pinned && !pickedIds.has(x.id))
    for (const pe of pinnedExtras) {
      if (picked.length >= topK) break
      picked.push(pe)
      pickedIds.add(pe.id)
    }
  }
  if (includeAllOnMiss && picked.length < topK) {
    const pickedIds = new Set(picked.map(p => p.id))
    for (const cand of scored) {
      if (picked.length >= topK) break
      if (!pickedIds.has(cand.id)) {
        picked.push(cand)
        pickedIds.add(cand.id)
      }
    }
  } else if (!picked.length && all.length <= 8) {
    picked = scored.slice(0, Math.min(4, topK))
  }
  if (recordHit && picked.length > 0) {
    touchBuiltinMemoryHits(picked.map(p => p.id), dir)
  }
  return {
    items: picked,
    promptText: '',
    providerLabel: '参谋自带记事本',
  }
}

const PREFERENCE_SIGNAL_RE = /(?:记住|帮我记|别忘了|以后都|我习惯|我喜欢|我偏好|千万别|不要再|请总是|叫我|称呼|约定好)/

export function builtinMarkdownSyncTurn(slotCfg, { userText, turnKind = 'chief_chat' } = {}) {
  if (turnKind !== 'chief_chat') return { skipped: 'not-chief-chat' }
  const clean = scrubExternalMemoryText(userText).replace(/[\r\n]+/g, ' ').trim()
  if (!clean || clean.length < 4 || !PREFERENCE_SIGNAL_RE.test(clean)) {
    return { skipped: 'no-explicit-preference-signal' }
  }
  const dir = (slotCfg && slotCfg.vaultPath && slotCfg.vaultPath.trim()) || defaultChiefMemoryDir()
  return addBuiltinMemoryItem(clean, dir)
}

const PLUGIN_DATA_EXT_RE = /\.(?:md|markdown|txt|json)$/i
const PLUGIN_IMPORT_NOISE_RE = /(?:例行压缩维护|静默压缩|压缩流程|细节抢救归档|无实质新内容|context\s*compact|auto[- ]compact|routine maintenance)/i
const DOC_FILE_SKIP_RE = /^(?:readme|changelog|history|contributing|license|code_of_conduct|security|package(?:-lock)?|tsconfig|pnpm-lock|yarn\.lock)(?:\.[^/\\]+)?$/i

function collectPluginReadableFiles(rootDirs = [], maxFiles = 36) {
  const files = []
  const seen = new Set()
  const walk = (dir, depth) => {
    if (depth > 2 || files.length >= maxFiles) return
    let ents = []
    try {
      if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return
      if (/[/\\]node_modules(?:[/\\]|$)/i.test(path.resolve(dir))) return
      ents = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of ents) {
      if (files.length >= maxFiles) break
      const name = ent.name
      if (!name || name === 'node_modules' || name === '.git' || name === 'dist' || name === 'build') continue
      if (DOC_FILE_SKIP_RE.test(name)) continue
      const full = path.join(dir, name)
      if (ent.isDirectory()) {
        walk(full, depth + 1)
      } else if (ent.isFile() && PLUGIN_DATA_EXT_RE.test(name)) {
        const norm = path.resolve(full)
        if (!seen.has(norm)) {
          seen.add(norm)
          files.push(norm)
        }
      }
    }
  }
  for (const r of rootDirs) walk(r, 0)
  return files
}

export async function discoverLocalMemorySources({ cordisProviders = [] } = {}) {
  const sources = []
  const builtinDir = defaultChiefMemoryDir()
  const builtinItems = listBuiltinMemoryItems(builtinDir)
  sources.push({
    id: 'builtin-md',
    kind: 'builtin-md',
    slot: 'memory',
    pluginSlot: 'memory',
    importable: false,
    title: '参谋自带记事本',
    badge: '开箱即用',
    subtitle: builtinItems.length > 0 ? `已记住 ${builtinItems.length} 条 · 纯文本随时改` : '零配置秒用 · 存为透明 MEMORY.md',
    available: true,
    count: builtinItems.length,
    memoryPath: defaultChiefMemoryFile(builtinDir),
    applyPatch: {
      enabled: true,
      memorySlot: { enabled: true, kind: 'builtin-md', label: '参谋自带记事本', vaultPath: '' },
    },
  })

  // Probe generic local/configured MCP memory server; ONLY show card when actually reachable (never show stale host-specific offline card on fresh machines)
  const probeEndpoint = (process.env && typeof process.env.DSH_CHIEF_MCP_MEMORY_URL === 'string' && process.env.DSH_CHIEF_MCP_MEMORY_URL.trim())
    ? process.env.DSH_CHIEF_MCP_MEMORY_URL.trim()
    : 'http://127.0.0.1:8765/mcp'
  let mcpOnline = false
  if (probeEndpoint) {
    try {
      const ac = new AbortController()
      const timer = setTimeout(() => { try { ac.abort() } catch {} }, 400)
      timer.unref?.()
      try {
        const r = await fetch(probeEndpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 99999,
            method: 'initialize',
            params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: MCP_CLIENT_INFO },
          }),
          signal: ac.signal,
        })
        mcpOnline = r.ok || r.status === 200 || r.status === 202
      } finally {
        clearTimeout(timer)
      }
    } catch {}
  }
  if (mcpOnline) {
    sources.push({
      id: 'mcp-memory-local',
      kind: 'mcp-http',
      slot: 'memory',
      pluginSlot: 'memory',
      importable: false,
      title: 'MCP 记忆服务',
      badge: '在线',
      subtitle: '已检测到兼容 MCP 记忆服务，点击即可共享记忆',
      available: true,
      endpoint: probeEndpoint,
      applyPatch: {
        enabled: true,
        memorySlot: { enabled: true, kind: 'mcp-http', label: 'MCP 记忆服务', endpoint: probeEndpoint },
      },
    })
  }

  // Scan personal open Markdown memory directories only (never scrape node_modules or plugin docs)
  const home = os.homedir()
  const dirCandidates = [
    { id: 'local-mnemon-runtime', title: 'Mnemon 个人记忆文件', rel: path.join(home, '.mnemon', 'runtime') },
    { id: 'local-openclaw-ws', title: 'OpenClaw 本地记忆', rel: path.join(home, '.openclaw', 'workspace') },
    { id: 'local-openclaw-mem', title: 'OpenClaw 记忆目录', rel: path.join(home, '.openclaw', 'memory') },
  ]
  for (const cand of dirCandidates) {
    try {
      if (!fs.existsSync(cand.rel) || !fs.statSync(cand.rel).isDirectory()) continue
      const mdFiles = collectMarkdownFiles(cand.rel)
      if (!mdFiles.length) continue
      sources.push({
        id: cand.id,
        kind: 'markdown-vault',
        slot: 'memory',
        pluginSlot: 'memory',
        importable: true,
        title: cand.title,
        badge: `发现 ${mdFiles.length} 份笔记`,
        subtitle: '只读共享给参谋长，绝不改动原文件',
        available: true,
        fileCount: mdFiles.length,
        vaultPath: cand.rel,
        applyPatch: {
          enabled: true,
          memorySlot: { enabled: true, kind: 'markdown-vault', label: cand.title, vaultPath: cand.rel },
        },
      })
    } catch {}
  }

  for (const cp of (Array.isArray(cordisProviders) ? cordisProviders : [])) {
    if (!cp || !cp.id) continue
    sources.push({
      id: `cordis:${cp.id}`,
      kind: 'cordis',
      slot: cp.slot || 'memory',
      pluginSlot: cp.slot || 'memory',
      importable: false,
      title: cp.label || cp.id,
      badge: cp.slot === 'mood' ? '情感/心境插件' : 'DSH 记忆插件',
      subtitle: '已注册的 DSH 扩展接口，点一下即可直连',
      available: true,
      cordisProviderId: cp.id,
      applyPatch: cp.slot === 'mood'
        ? { enabled: true, moodSlot: { enabled: true, kind: 'cordis', label: cp.label || cp.id, cordisProviderId: cp.id } }
        : { enabled: true, memorySlot: { enabled: true, kind: 'cordis', label: cp.label || cp.id, cordisProviderId: cp.id } },
    })
  }

  return sources
}

function extractImportCandidatesFromJson(rawObj, out = [], depth = 0) {
  if (depth > 4 || out.length >= 120 || rawObj == null) return out
  if (typeof rawObj === 'string') {
    const clean = rawObj.replace(/[\r\n]+/g, ' ').trim()
    if (clean.length >= 8 && clean.length <= 360) out.push(clean)
    return out
  }
  if (Array.isArray(rawObj)) {
    for (const item of rawObj.slice(0, 80)) extractImportCandidatesFromJson(item, out, depth + 1)
    return out
  }
  if (typeof rawObj === 'object') {
    const preferredKeys = ['text', 'content', 'memory', 'summary', 'fact', 'note', 'preference', 'rule', 'description', 'title']
    let matchedKey = false
    for (const k of preferredKeys) {
      if (typeof rawObj[k] === 'string' && rawObj[k].trim().length >= 8) {
        out.push(rawObj[k].replace(/[\r\n]+/g, ' ').trim())
        matchedKey = true
        break
      }
    }
    if (!matchedKey) {
      for (const v of Object.values(rawObj)) {
        if (v && (typeof v === 'object' || Array.isArray(v))) {
          extractImportCandidatesFromJson(v, out, depth + 1)
        }
      }
    }
  }
  return out
}

function extractImportCandidatesFromText(rawText) {
  const lines = String(rawText || '').replace(/\r\n/g, '\n').split('\n')
  const out = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('>') || trimmed.startsWith('```')) continue
    const bullet = trimmed.match(/^[-*]\s+(?:\[[^\]]+\]\s*)?(.+)$/)
    const cand = bullet ? bullet[1].trim() : (trimmed.length >= 12 && !/^[\[{]/.test(trimmed) ? trimmed : '')
    if (cand && cand.length >= 6 && !PLUGIN_IMPORT_NOISE_RE.test(cand)) {
      out.push(cand)
    }
  }
  return out
}

export async function importMemoriesFromSource(sourceSpec = {}, targetDir = '', {
  maxItems = 60,
  halfLifeDays = 21,
  cordisProviders = [],
} = {}) {
  const src = sourceSpec && typeof sourceSpec === 'object' ? sourceSpec : {}
  const dir = (typeof targetDir === 'string' && targetDir.trim()) ? targetDir.trim() : defaultChiefMemoryDir()
  const cap = Math.max(1, Math.min(120, Number(maxItems) || 60))
  const sourceLabel = clamp(src.title || src.pluginName || src.kind || '外部记忆插件', 60)
  const rawCandidates = []
  let scannedFiles = 0

  if (src.kind === 'mcp-http' && src.endpoint) {
    try {
      const ac = new AbortController()
      const timer = setTimeout(() => { try { ac.abort() } catch {} }, 4000)
      timer.unref?.()
      try {
        const res = await mcpPrefetch({ endpoint: src.endpoint, label: sourceLabel }, { query: '偏好 规矩 决策 习惯 记忆', topK: 20, signal: ac.signal })
        for (const it of (res.items || [])) {
          if (it && (it.preview || it.title)) rawCandidates.push(String(it.preview || it.title))
        }
      } finally {
        clearTimeout(timer)
      }
    } catch {}
  } else if (src.kind === 'cordis' && src.cordisProviderId) {
    const prov = (Array.isArray(cordisProviders) ? cordisProviders : []).find(p => p && p.id === src.cordisProviderId)
    if (prov && typeof prov.prefetch === 'function') {
      try {
        const res = await prov.prefetch({ query: '偏好 规矩 决策 习惯 情感', topK: 20 }, new AbortController().signal)
        for (const it of (res?.items || [])) {
          if (it && (it.preview || it.title)) rawCandidates.push(String(it.preview || it.title))
        }
      } catch {}
    }
  }

  const dirsToScan = []
  if (typeof src.vaultPath === 'string' && src.vaultPath.trim()) dirsToScan.push(src.vaultPath.trim())
  if (Array.isArray(src.dataPaths)) {
    for (const dp of src.dataPaths) {
      if (typeof dp === 'string' && dp.trim()) dirsToScan.push(dp.trim())
    }
  }
  const files = collectPluginReadableFiles(dirsToScan, 36)
  scannedFiles = files.length
  for (const file of files) {
    if (rawCandidates.length >= cap * 2) break
    let raw = ''
    try {
      const fd = fs.openSync(file, 'r')
      try {
        const buf = Buffer.allocUnsafe(MD_MAX_FILE_BYTES)
        const n = fs.readSync(fd, buf, 0, MD_MAX_FILE_BYTES, 0)
        raw = buf.toString('utf8', 0, n)
      } finally {
        fs.closeSync(fd)
      }
    } catch {
      continue
    }
    if (/\.json$/i.test(file)) {
      try {
        extractImportCandidatesFromJson(JSON.parse(raw), rawCandidates)
      } catch {}
    } else {
      rawCandidates.push(...extractImportCandidatesFromText(raw))
    }
  }

  let importedCount = 0
  let skippedDuplicates = 0
  const seenLocal = new Set()
  const defaultCat = (src.pluginSlot === 'mood' || src.slot === 'mood') ? 'bond' : ''

  for (const cand of rawCandidates) {
    if (importedCount >= cap) break
    const scrubbed = clamp(scrubExternalMemoryText(String(cand || '').replace(/[\r\n]+/g, ' ')), 340)
    if (!scrubbed || scrubbed.length < 6 || PLUGIN_IMPORT_NOISE_RE.test(scrubbed)) continue
    const norm = scrubbed.toLowerCase()
    if (seenLocal.has(norm)) continue
    seenLocal.add(norm)
    const inferredCat = inferMemoryCategory(scrubbed)
    const cat = defaultCat && inferredCat === 'preference' ? 'bond' : inferredCat
    const addRes = addBuiltinMemoryItem(scrubbed, dir, { category: cat, halfLifeDays })
    if (addRes && addRes.ok) {
      if (addRes.deduplicated) skippedDuplicates += 1
      else importedCount += 1
    }
  }

  return {
    ok: true,
    sourceLabel,
    scannedFiles,
    importedCount,
    skippedDuplicates,
    items: listBuiltinMemoryItems(dir, { halfLifeDays }),
    memoryPath: defaultChiefMemoryFile(dir),
  }
}
