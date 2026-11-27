/**
 * voice-inbox.js — 语音转文字独立收件区与梦境漫游自动消化引擎
 *
 * 【核心职责】
 *   1. 为「语音输入」与「语音模式唠嗑」开辟独立收件目录（`~/.dsh/chief/voice-inbox/`）：
 *      - `pending/*.md`：待梦境漫游整理的原始语音手记（前置经 `scrubExternalMemoryText` 脱敏）；
 *      - `processed/*.md`：已完成记忆分解并附带整理回执的已归档语音手记；
 *      - `index.json`：原子写入的结构化索引，供界面透明展示与状态跟踪。
 *   2. 供参谋长「梦境漫游」（`runManagedDreamRoam`）自动扫描 `pending/`：
 *      - 经由 `distillMemoryBatch` 自动分解写入长期记忆（`MEMORY.md`）、用户画像（`USER_PROFILE.md`）与参谋日记（`DIARY.md`）；
 *      - 对具备项目/任务/备忘价值的语音笔记，经由 `upsertArchiveFn` 归整进档案柜；
 *      - 全程与 `@lead` 保持 0 字节隔离，绝不私自推送至主对话桌面。
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { clamp, scrubExternalMemoryText } from './state-schema.js'
import { defaultChiefMemoryDir } from './external-memory-connectors.js'
import { distillMemoryBatch } from './external-memory-studio.js'

function parseJsonObjectSafe(raw = '') {
  const s = String(raw || '').trim()
  if (!s) return null
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const cand = (fence ? fence[1] : s).trim()
  const first = cand.indexOf('{')
  const last = cand.lastIndexOf('}')
  if (first < 0 || last <= first) return null
  try { return JSON.parse(cand.slice(first, last + 1)) } catch { return null }
}

const MAX_INDEX_ENTRIES = 120
const MAX_PENDING_TEXT = 6000
const MAX_REPLY_TEXT = 4000

export function voiceInboxDir(customDir = '') {
  const clean = typeof customDir === 'string' ? customDir.trim() : ''
  if (clean) return path.resolve(clean)
  return path.join(path.dirname(defaultChiefMemoryDir()), 'voice-inbox')
}

function ensureInboxLayout(baseDir) {
  const pendingDir = path.join(baseDir, 'pending')
  const processedDir = path.join(baseDir, 'processed')
  fs.mkdirSync(pendingDir, { recursive: true })
  fs.mkdirSync(processedDir, { recursive: true })
  return { baseDir, pendingDir, processedDir, indexPath: path.join(baseDir, 'index.json') }
}

function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`)
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  fs.renameSync(tmp, filePath)
}

function readIndex(indexPath) {
  try {
    if (!fs.existsSync(indexPath)) return { version: 1, entries: [], lastDigest: null }
    const raw = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
    return {
      version: 1,
      entries: Array.isArray(raw && raw.entries) ? raw.entries.filter(Boolean) : [],
      lastDigest: raw && raw.lastDigest && typeof raw.lastDigest === 'object' ? raw.lastDigest : null,
    }
  } catch {
    return { version: 1, entries: [], lastDigest: null }
  }
}

function parseVoiceMarkdownFile(rawText = '', fallbackFile = '') {
  const text = String(rawText || '').replace(/\r\n/g, '\n')
  const fmMatch = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  const meta = {}
  let body = text
  if (fmMatch) {
    for (const line of fmMatch[1].split('\n')) {
      const idx = line.indexOf(':')
      if (idx > 0) {
        const k = line.slice(0, idx).trim()
        const v = line.slice(idx + 1).trim()
        meta[k] = v
      }
    }
    body = fmMatch[2]
  }
  const replySplit = body.split(/\n##\s+参谋长口语回复\s*\n/)
  const userPart = String(replySplit[0] || '')
    .replace(/^#\s+用户语音手记\s*\n*/m, '')
    .trim()
  const replyAndFooter = String(replySplit[1] || '').split(/\n##\s+梦境整理回执\s*\n/)
  const chiefReply = String(replyAndFooter[0] || '').trim()
  const id = meta.id || path.basename(fallbackFile, '.md') || `vi_${crypto.createHash('sha1').update(text).digest('hex').slice(0, 10)}`
  const createdMs = meta.createdAt ? Date.parse(meta.createdAt) : NaN
  return {
    id,
    fileName: path.basename(fallbackFile || `${id}.md`),
    mode: meta.mode === 'voice_chat' ? 'voice_chat' : 'dictation',
    provider: meta.provider || 'unknown',
    sessionId: meta.sessionId || 'global',
    durationMs: Number(meta.durationMs) || 0,
    status: meta.status === 'processed' ? 'processed' : 'pending',
    createdAt: Number.isFinite(createdMs) ? createdMs : Date.now(),
    userText: userPart,
    chiefReply,
  }
}

function formatVoiceMarkdown({
  id,
  mode = 'dictation',
  provider = 'unknown',
  sessionId = 'global',
  durationMs = 0,
  status = 'pending',
  createdAt = Date.now(),
  userText = '',
  chiefReply = '',
  receiptNote = '',
}) {
  const lines = [
    '---',
    `id: ${id}`,
    'kind: voice_transcript',
    `mode: ${mode === 'voice_chat' ? 'voice_chat' : 'dictation'}`,
    `provider: ${String(provider || 'unknown').replace(/[\r\n]+/g, ' ')}`,
    `sessionId: ${String(sessionId || 'global').replace(/[\r\n]+/g, ' ')}`,
    `durationMs: ${Math.max(0, Math.round(Number(durationMs) || 0))}`,
    `createdAt: ${new Date(createdAt || Date.now()).toISOString()}`,
    `status: ${status === 'processed' ? 'processed' : 'pending'}`,
    '---',
    '',
    '# 用户语音手记',
    '',
    String(userText || '').trim(),
  ]
  if (chiefReply && String(chiefReply).trim()) {
    lines.push('', '## 参谋长口语回复', '', String(chiefReply).trim())
  }
  if (receiptNote && String(receiptNote).trim()) {
    lines.push('', '## 梦境整理回执', '', String(receiptNote).trim())
  }
  lines.push('')
  return lines.join('\n')
}

function syncIndexWithDisk(layout) {
  const idx = readIndex(layout.indexPath)
  const byId = new Map()
  for (const row of idx.entries) {
    if (row && row.id) byId.set(row.id, { ...row })
  }

  const scanFolder = (dirPath, statusTag) => {
    let files = []
    try {
      files = fs.readdirSync(dirPath).filter(name => name.endsWith('.md'))
    } catch {
      files = []
    }
    const seen = new Set()
    for (const fileName of files) {
      const fullPath = path.join(dirPath, fileName)
      try {
        const raw = fs.readFileSync(fullPath, 'utf8')
        const parsed = parseVoiceMarkdownFile(raw, fileName)
        seen.add(parsed.id)
        const prev = byId.get(parsed.id) || {}
        byId.set(parsed.id, {
          ...prev,
          id: parsed.id,
          fileName,
          mode: prev.mode || parsed.mode,
          provider: prev.provider || parsed.provider,
          sessionId: prev.sessionId || parsed.sessionId,
          durationMs: prev.durationMs || parsed.durationMs,
          status: statusTag,
          createdAt: Number(prev.createdAt) || parsed.createdAt,
          preview: clamp(parsed.userText.replace(/\s+/g, ' '), 120),
          replyPreview: parsed.chiefReply ? clamp(parsed.chiefReply.replace(/\s+/g, ' '), 100) : (prev.replyPreview || ''),
          digestedTo: Array.isArray(prev.digestedTo) ? prev.digestedTo : [],
        })
      } catch {}
    }
    return seen
  }

  const pendingIds = scanFolder(layout.pendingDir, 'pending')
  const processedIds = scanFolder(layout.processedDir, 'processed')
  const entries = []
  for (const [id, row] of byId.entries()) {
    if (!pendingIds.has(id) && !processedIds.has(id)) continue
    entries.push({
      ...row,
      status: pendingIds.has(id) ? 'pending' : 'processed',
    })
  }
  entries.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
  return {
    version: 1,
    entries: entries.slice(0, MAX_INDEX_ENTRIES),
    lastDigest: idx.lastDigest || null,
  }
}

export function appendVoiceTranscript({
  text = '',
  mode = 'dictation',
  provider = 'dsh-local',
  sessionId = 'global',
  durationMs = 0,
  chiefReply = '',
  customDir = '',
} = {}) {
  const cleanText = clamp(scrubExternalMemoryText(String(text || '').trim()), MAX_PENDING_TEXT)
  if (!cleanText || cleanText.length < 1) {
    return { ok: false, error: '没有可保存的语音转写文本' }
  }
  const cleanReply = chiefReply
    ? clamp(scrubExternalMemoryText(String(chiefReply).trim()), MAX_REPLY_TEXT)
    : ''
  const cleanMode = mode === 'voice_chat' ? 'voice_chat' : 'dictation'
  const cleanSession = String(sessionId || 'global').trim().slice(0, 80) || 'global'
  const createdAt = Date.now()
  const stamp = new Date(createdAt).toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)
  const rand = crypto.randomBytes(3).toString('hex')
  const id = `vi_${stamp}_${rand}`
  const fileName = `${id}.md`

  const layout = ensureInboxLayout(voiceInboxDir(customDir))
  const filePath = path.join(layout.pendingDir, fileName)
  const md = formatVoiceMarkdown({
    id,
    mode: cleanMode,
    provider,
    sessionId: cleanSession,
    durationMs,
    status: 'pending',
    createdAt,
    userText: cleanText,
    chiefReply: cleanReply,
  })
  fs.writeFileSync(filePath, md, 'utf8')

  const idx = syncIndexWithDisk(layout)
  const existingIdx = idx.entries.findIndex(e => e.id === id)
  const record = {
    id,
    fileName,
    mode: cleanMode,
    provider: String(provider || 'dsh-local'),
    sessionId: cleanSession,
    durationMs: Math.max(0, Math.round(Number(durationMs) || 0)),
    status: 'pending',
    createdAt,
    preview: clamp(cleanText.replace(/\s+/g, ' '), 120),
    replyPreview: cleanReply ? clamp(cleanReply.replace(/\s+/g, ' '), 100) : '',
    digestedTo: [],
  }
  if (existingIdx >= 0) idx.entries[existingIdx] = record
  else idx.entries.unshift(record)
  writeJsonAtomic(layout.indexPath, idx)

  return {
    ok: true,
    id,
    fileName,
    filePath,
    dir: layout.baseDir,
    entry: record,
  }
}

export function attachVoiceTranscriptReply(id, chiefReply, { customDir = '', sessionId = '' } = {}) {
  const cleanId = String(id || '').trim()
  const cleanReply = clamp(scrubExternalMemoryText(String(chiefReply || '').trim()), MAX_REPLY_TEXT)
  if (!cleanId || !cleanReply) return { ok: false, skipped: true }

  const layout = ensureInboxLayout(voiceInboxDir(customDir))
  const idx = syncIndexWithDisk(layout)
  const entry = idx.entries.find(e => e && e.id === cleanId)
  if (!entry || entry.status !== 'pending') {
    return { ok: false, skipped: true }
  }
  const filePath = path.join(layout.pendingDir, entry.fileName)
  if (!fs.existsSync(filePath)) return { ok: false, skipped: true }

  const parsed = parseVoiceMarkdownFile(fs.readFileSync(filePath, 'utf8'), entry.fileName)
  const nextMd = formatVoiceMarkdown({
    id: parsed.id,
    mode: parsed.mode || 'voice_chat',
    provider: parsed.provider || entry.provider,
    sessionId: sessionId || parsed.sessionId || entry.sessionId,
    durationMs: parsed.durationMs || entry.durationMs,
    status: 'pending',
    createdAt: entry.createdAt || parsed.createdAt,
    userText: parsed.userText,
    chiefReply: cleanReply,
  })
  fs.writeFileSync(filePath, nextMd, 'utf8')
  entry.replyPreview = clamp(cleanReply.replace(/\s+/g, ' '), 100)
  entry.updatedAt = Date.now()
  writeJsonAtomic(layout.indexPath, idx)
  return { ok: true, id: cleanId, entry }
}

export function listVoiceTranscripts({ customDir = '', limit = 40 } = {}) {
  const layout = ensureInboxLayout(voiceInboxDir(customDir))
  const idx = syncIndexWithDisk(layout)
  writeJsonAtomic(layout.indexPath, idx)
  const pending = idx.entries.filter(e => e.status === 'pending')
  const processed = idx.entries.filter(e => e.status === 'processed')
  const cap = Math.max(5, Math.min(80, Number(limit) || 40))
  return {
    ok: true,
    dir: layout.baseDir,
    pendingDir: layout.pendingDir,
    processedDir: layout.processedDir,
    pendingCount: pending.length,
    processedCount: processed.length,
    pending: pending.slice(0, cap),
    processed: processed.slice(0, Math.min(20, cap)),
    lastDigest: idx.lastDigest || null,
  }
}

export function deleteVoiceTranscript(id, { customDir = '' } = {}) {
  const cleanId = String(id || '').trim()
  if (!cleanId) return { ok: false, error: '缺少手记 ID' }
  const layout = ensureInboxLayout(voiceInboxDir(customDir))
  const idx = syncIndexWithDisk(layout)
  const entry = idx.entries.find(e => e && e.id === cleanId)
  if (!entry) return { ok: false, error: '未找到指定语音手记' }

  for (const folder of [layout.pendingDir, layout.processedDir]) {
    const fp = path.join(folder, entry.fileName)
    try {
      if (fs.existsSync(fp)) fs.unlinkSync(fp)
    } catch {}
  }
  idx.entries = idx.entries.filter(e => e && e.id !== cleanId)
  writeJsonAtomic(layout.indexPath, idx)
  return { ok: true, id: cleanId }
}

export async function digestVoiceInboxForDreamRoam({
  rawCfg = {},
  sessionId = 'global',
  customDir = '',
  memoryDir = '',
  callLlm = null,
  upsertArchiveFn = null,
  maxItems = 10,
} = {}) {
  const layout = ensureInboxLayout(voiceInboxDir(customDir))
  const idx = syncIndexWithDisk(layout)
  const pendingEntries = idx.entries
    .filter(e => e && e.status === 'pending')
    .sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0))
    .slice(0, Math.max(1, Math.min(24, Number(maxItems) || 10)))

  if (!pendingEntries.length) {
    return {
      ok: true,
      processedCount: 0,
      memoryAdded: 0,
      diaryAdded: 0,
      profileUpdated: false,
      archivesCreated: 0,
      mode: 'empty',
    }
  }

  const parsedItems = []
  for (const entry of pendingEntries) {
    const fp = path.join(layout.pendingDir, entry.fileName)
    if (!fs.existsSync(fp)) continue
    try {
      const parsed = parseVoiceMarkdownFile(fs.readFileSync(fp, 'utf8'), entry.fileName)
      if (parsed.userText && parsed.userText.trim()) {
        parsedItems.push({ entry, parsed, filePath: fp })
      }
    } catch {}
  }

  if (!parsedItems.length) {
    return {
      ok: true,
      processedCount: 0,
      memoryAdded: 0,
      diaryAdded: 0,
      profileUpdated: false,
      archivesCreated: 0,
      mode: 'empty',
    }
  }

  const turns = parsedItems.map(it => ({
    userText: `[语音手记/${it.parsed.mode === 'voice_chat' ? '语音对话' : '听写'}] ${it.parsed.userText}`,
    chiefReply: it.parsed.chiefReply || '已收到这条语音记录，等待梦境整理入库。',
  }))

  let distillRes = null
  try {
    distillRes = await distillMemoryBatch({
      rawCfg,
      turns,
      sessionId,
      customDir: memoryDir,
      callLlm: typeof callLlm === 'function' ? callLlm : null,
      forceHeuristic: typeof callLlm !== 'function',
      skipDiary: false,
    })
  } catch (err) {
    distillRes = {
      ok: false,
      error: String((err && err.message) || err || 'distill error'),
      addedMemories: [],
      diaryEntry: null,
      profileUpdated: false,
    }
  }

  const memoryAdded = Array.isArray(distillRes && distillRes.addedMemories) ? distillRes.addedMemories.length : 0
  const diaryAdded = distillRes && distillRes.diaryEntry ? 1 : 0
  const profileUpdated = Boolean(distillRes && distillRes.profileUpdated)

  let archivesCreated = 0
  if (typeof upsertArchiveFn === 'function') {
    let plannedArchives = null
    if (typeof callLlm === 'function') {
      try {
        const notesDigest = parsedItems
          .map((it, i) => `(${i + 1}) [${it.parsed.mode}] 用户说：${it.parsed.userText}${it.parsed.chiefReply ? `\n参谋回复：${it.parsed.chiefReply}` : ''}`)
          .join('\n\n')
        const llmArc = await callLlm({
          reasonKind: 'dream_roam',
          system: '你是参谋长梦境档案归整器。请从用户的语音手记中提取值得放入项目档案柜的决策、方案或备忘。仅输出合法 JSON：{"archives":[{"title":"简短标题","folder":"inbox","summary":"一句话摘要","body":"整理后的清晰正文","tags":["语音手记"],"vaultScope":"session"}]}，若无具体事项可输出 {"archives":[]}。',
          prompt: `请整理以下 ${parsedItems.length} 条语音手记：\n\n${notesDigest}`,
          maxTokens: 1000,
        })
        const parsedJson = parseJsonObjectSafe(llmArc && (llmArc.text || llmArc.reply || ''))
        if (parsedJson && Array.isArray(parsedJson.archives)) {
          plannedArchives = parsedJson.archives.slice(0, 3)
        }
      } catch {}
    }

    if (!plannedArchives) {
      const substantive = parsedItems.filter(it => String(it.parsed.userText || '').trim().length >= 8)
      if (substantive.length > 0) {
        const dateTag = new Date().toISOString().slice(0, 10)
        const bodyLines = substantive.map((it, i) => {
          const tag = it.parsed.mode === 'voice_chat' ? '语音唠嗑' : '语音输入'
          return `### ${i + 1}. [${tag}] ${clamp(it.parsed.userText.replace(/\s+/g, ' '), 40)}\n\n${it.parsed.userText}${it.parsed.chiefReply ? `\n\n> 参谋回应：${it.parsed.chiefReply}` : ''}`
        })
        plannedArchives = [{
          title: `语音手记梦境归档（${dateTag} · ${substantive.length} 条）`,
          folder: 'inbox',
          summary: clamp(substantive.map(it => it.parsed.userText.replace(/\s+/g, ' ')).join('；'), 110),
          body: bodyLines.join('\n\n'),
          tags: ['语音手记', '梦境整理'],
          vaultScope: sessionId && sessionId !== 'global' ? 'session' : 'global',
        }]
      } else {
        plannedArchives = []
      }
    }

    for (const arc of plannedArchives) {
      if (!arc || !String(arc.body || arc.summary || '').trim()) continue
      try {
        const upRes = await upsertArchiveFn({
          folder: arc.folder || 'inbox',
          title: clamp(String(arc.title || '语音手记归档'), 60),
          summary: clamp(String(arc.summary || ''), 140),
          body: String(arc.body || arc.summary || '').trim(),
          tags: Array.isArray(arc.tags) && arc.tags.length ? arc.tags : ['语音手记'],
          vaultScope: arc.vaultScope === 'global' ? 'global' : 'session',
        })
        if (!upRes || upRes.ok !== false) archivesCreated += 1
      } catch {}
    }
  }

  const processedAt = Date.now()
  const digestedTargets = []
  if (memoryAdded > 0) digestedTargets.push(`记忆+${memoryAdded}`)
  if (profileUpdated) digestedTargets.push('用户画像已更新')
  if (diaryAdded > 0) digestedTargets.push('参谋日记+1')
  if (archivesCreated > 0) digestedTargets.push(`档案柜+${archivesCreated}`)
  if (!digestedTargets.length) digestedTargets.push('已归档检视（无新增重复项）')
  const receiptText = `整理时间：${new Date(processedAt).toISOString()}\n分解去向：${digestedTargets.join(' · ')}\n整理模式：${(distillRes && distillRes.mode) || 'heuristic'}`

  let processedCount = 0
  for (const it of parsedItems) {
    const destPath = path.join(layout.processedDir, it.entry.fileName)
    const processedMd = formatVoiceMarkdown({
      id: it.parsed.id,
      mode: it.parsed.mode,
      provider: it.parsed.provider,
      sessionId: it.parsed.sessionId || sessionId,
      durationMs: it.parsed.durationMs,
      status: 'processed',
      createdAt: it.entry.createdAt || it.parsed.createdAt,
      userText: it.parsed.userText,
      chiefReply: it.parsed.chiefReply,
      receiptNote: receiptText,
    })
    fs.writeFileSync(destPath, processedMd, 'utf8')
    try {
      if (fs.existsSync(it.filePath)) fs.unlinkSync(it.filePath)
    } catch {}
    const row = idx.entries.find(e => e && e.id === it.entry.id)
    if (row) {
      row.status = 'processed'
      row.processedAt = processedAt
      row.digestedTo = [...digestedTargets]
    }
    processedCount += 1
  }

  const lastDigest = {
    at: processedAt,
    processedCount,
    memoryAdded,
    diaryAdded,
    profileUpdated,
    archivesCreated,
    targets: digestedTargets,
    mode: (distillRes && distillRes.mode) || 'heuristic',
  }
  idx.lastDigest = lastDigest
  writeJsonAtomic(layout.indexPath, idx)

  return {
    ok: true,
    ...lastDigest,
  }
}
