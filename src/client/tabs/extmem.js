/**
 * tabs/extmem.js — 参谋专属「记忆」工作台（对标 LivingMemory 极简双栏星图界面）
 *
 * 【核心职责】
 *   1. 左导航 + 右画布响应式布局（宽屏双栏工作台、窄侧栏自动收折为顶部细栏），保留所有 0-byte @lead 隔离与接入能力；
 *   2. 4 格可折叠左竖色条 KPI 概览带：总记忆 / 常驻星辰 / 语义关联 / 平均活力；
 *   3. 5 大视图：记忆星图 (2D/3D) · 记忆管理 · 召回测试 (X-Ray) · 遗忘曲线 · 接入与心境设置。
 */

import { React, h } from '../react-runtime.js'
import { bi } from '../i18n.js'
import { patch } from '../store.js'
import {
  updateSecConfig,
  probeExternalMemoryApi,
  discoverExternalMemoryApi,
  listExternalMemoryApi,
  addExternalMemoryApi,
  updateExternalMemoryApi,
  removeExternalMemoryApi,
  probeEmbeddingApi,
  getMemoryProfileApi,
  saveMemoryProfileApi,
  getMemoryPromptsApi,
  saveMemoryPromptApi,
  resetMemoryPromptApi,
  distillMemoryNowApi,
  fetchVoiceInboxApi,
} from '../api.js'
import { Icon, Switch, AccCard } from '../components/common.js'
import {
  EXTMEM_CAT_ORDER,
  extMemCatMeta,
  ExtMemVitalityRing,
  ExtMemStarCanvas,
  ExtMemDecayChart,
} from './extmem-starfield.js'
import {
  ExtMemProfileView,
  ExtMemPromptsView,
} from './extmem-studio.js'

const EXTMEM_DEFAULT_DRAFT = {
  enabled: false,
  memorySlot: {
    enabled: true,
    kind: 'none',
    label: '',
    endpoint: '',
    vaultPath: '',
    cordisProviderId: '',
    authEnvVar: '',
    authToken: '',
    hasAuthToken: false,
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
    hasAuthToken: false,
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
    hasApiKey: false,
    timeoutMs: 2500,
    weight: 0.45,
  },
  autoDistill: {
    enabled: true,
    minTurns: 2,
    cooldownSec: 90,
  },
  workspacePolicies: {},
}

function mergeExtMemTabDraft(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  return {
    enabled: Boolean(src.enabled),
    memorySlot: { ...EXTMEM_DEFAULT_DRAFT.memorySlot, ...(src.memorySlot || {}) },
    moodSlot: { ...EXTMEM_DEFAULT_DRAFT.moodSlot, ...(src.moodSlot || {}) },
    embedding: { ...EXTMEM_DEFAULT_DRAFT.embedding, ...(src.embedding || {}) },
    autoDistill: { ...EXTMEM_DEFAULT_DRAFT.autoDistill, ...(src.autoDistill || {}) },
    workspacePolicies: { ...(src.workspacePolicies || {}) },
  }
}

const EXTMEM_INPUT_STYLE = {
  width: '100%',
  minHeight: 34,
  padding: '6px 10px',
  fontSize: 12,
  lineHeight: 1.45,
  boxSizing: 'border-box',
}

const EXTMEM_SAMPLE_NOTES_ZH = [
  '始终用简体中文交流，解释技术问题尽量用大白话',
  '改动重要代码或删文件前，先给我看方案不要擅自下手',
  '主对话专注干活保持干净，偏好和长期记事放参谋长这边',
]

const EXTMEM_SAMPLE_NOTES_EN = [
  'Keep explanations plain and concise without heavy jargon',
  'Always show the plan before modifying critical files',
  'Keep @lead clean and focused; keep personal preferences on Chief only',
]

function computeClientStats(items = [], halfLifeDays = 21) {
  const list = Array.isArray(items) ? items : []
  let pinned = 0
  let fresh = 0
  let warm = 0
  let fading = 0
  let sumVit = 0
  const byCategory = { preference: 0, rule: 0, decision: 0, lesson: 0, bond: 0 }
  for (const it of list) {
    if (!it) continue
    const cat = byCategory[it.category] !== undefined ? it.category : 'preference'
    byCategory[cat] += 1
    if (it.pinned) pinned += 1
    if (it.stage === 'fresh' || it.stage === 'pinned' || (it.vitality || 0) >= 72) fresh += 1
    else if (it.stage === 'warm' || (it.vitality || 0) >= 40) warm += 1
    else fading += 1
    sumVit += Number(it.vitality) || 80
  }
  return {
    total: list.length,
    pinned,
    fresh,
    warm,
    fading,
    avgVitality: list.length ? Math.round(sumVit / list.length) : 100,
    halfLifeDays,
    byCategory,
  }
}

export function ExternalMemoryTab({ view }) {
  const meta = view.chiefMeta || {}
  const [draft, setDraft] = React.useState(() => mergeExtMemTabDraft(meta.externalMemory))
  const emotionSplitActive = Boolean(draft.moodSlot.enabled && draft.moodSlot.emotionSplitView)
  const rawSub = (view && view.extMemSubTab) || 'book'
  const subTab = (rawSub === 'profile')
    ? 'profile'
    : (rawSub === 'bridge' || rawSub === 'probe' || rawSub === 'prompts' || rawSub === 'curve')
      ? 'bridge'
      : (rawSub === 'emotion' && emotionSplitActive)
        ? 'emotion'
        : 'book'
  const setSubTab = next => patch({ extMemSubTab: next })
  const outerRailMode = (view && view.navLayout) === 'sidebar'
  const [bookDisplayMode, setBookDisplayMode] = React.useState(() => (rawSub === 'sky' ? 'sky' : 'list'))
  const [advTool, setAdvTool] = React.useState(() => (['probe', 'prompts', 'curve'].includes(rawSub) ? rawSub : 'probe'))
  const [newEmotionText, setNewEmotionText] = React.useState('')
  const [skyMode, setSkyMode] = React.useState('2d')
  const [skyResetTick, setSkyResetTick] = React.useState(0)
  const [importingMd, setImportingMd] = React.useState(false)
  const importMdInputRef = React.useRef(null)
  const [sources, setSources] = React.useState([])
  const [scanning, setScanning] = React.useState(false)
  const [items, setItems] = React.useState([])
  const [serverStats, setServerStats] = React.useState(null)
  const [itemsLoading, setItemsLoading] = React.useState(false)
  const [writable, setWritable] = React.useState(true)
  const [memoryPath, setMemoryPath] = React.useState('')

  // Studio states: User Profile, Prompt Studio & Optional Embedding Probe
  const [profileData, setProfileData] = React.useState(null)
  const [profilePath, setProfilePath] = React.useState('')
  const [profileLoading, setProfileLoading] = React.useState(false)
  const [promptsList, setPromptsList] = React.useState([])
  const [promptsPath, setPromptsPath] = React.useState('')
  const [promptsLoading, setPromptsLoading] = React.useState(false)
  const [distillingNow, setDistillingNow] = React.useState(false)
  const [clearEmbKey, setClearEmbKey] = React.useState(false)
  const [embProbeBusy, setEmbProbeBusy] = React.useState(false)
  const [embProbeResult, setEmbProbeResult] = React.useState(null)

  // Quick capture state
  const [captureOpen, setCaptureOpen] = React.useState(false)
  const [newMemoryText, setNewMemoryText] = React.useState('')
  const [newCategory, setNewCategory] = React.useState('')
  const [newPinned, setNewPinned] = React.useState(false)
  const [savingNote, setSavingNote] = React.useState(false)

  // Notebook filters & inline editing
  const [catFilter, setCatFilter] = React.useState('all')
  const [stageFilter, setStageFilter] = React.useState('all')
  const [bookSearch, setBookSearch] = React.useState('')
  const [editingId, setEditingId] = React.useState('')
  const [editingText, setEditingText] = React.useState('')

  // X-ray probe & advanced settings
  const [advancedOpen, setAdvancedOpen] = React.useState(false)
  const [clearMemTok, setClearMemTok] = React.useState(false)
  const [probeQuery, setProbeQuery] = React.useState('我平时的回复习惯和项目规矩有哪些')
  const [probeBusy, setProbeBusy] = React.useState(false)
  const [probeResult, setProbeResult] = React.useState(null)
  const [showMemoryFilePath, setShowMemoryFilePath] = React.useState(false)

  React.useEffect(() => {
    void fetchVoiceInboxApi()
  }, [subTab])

  const latestReplyAt = (view.secLatestReply && view.secLatestReply.at) || 0
  React.useEffect(() => {
    if (latestReplyAt > 0 && view.tab === 'extmem' && subTab === 'book') {
      void refreshDiscoveryAndList()
    }
  }, [latestReplyAt])

  React.useEffect(() => {
    setDraft(mergeExtMemTabDraft(meta.externalMemory))
    setClearMemTok(false)
    setClearEmbKey(false)
  }, [JSON.stringify(meta.externalMemory || null)])

  const loadUserProfileState = async () => {
    setProfileLoading(true)
    try {
      const res = await getMemoryProfileApi()
      if (res && res.ok) {
        setProfileData(res.profile || null)
        if (res.profilePath) setProfilePath(res.profilePath)
      }
    } finally {
      setProfileLoading(false)
    }
  }

  const loadPromptsState = async () => {
    setPromptsLoading(true)
    try {
      const res = await getMemoryPromptsApi()
      if (res && res.ok) {
        setPromptsList(Array.isArray(res.prompts) ? res.prompts : [])
        if (res.promptsPath) setPromptsPath(res.promptsPath)
      }
    } finally {
      setPromptsLoading(false)
    }
  }

  React.useEffect(() => {
    if (subTab === 'profile') void loadUserProfileState()
    else if (subTab === 'bridge' && advancedOpen && advTool === 'prompts') void loadPromptsState()
  }, [subTab, advancedOpen, advTool, view.sessionId])

  const applyListResponse = listRes => {
    if (!listRes) return
    if (Array.isArray(listRes.items)) setItems(listRes.items)
    if (listRes.stats && typeof listRes.stats === 'object') setServerStats(listRes.stats)
    if (typeof listRes.writable === 'boolean') setWritable(listRes.writable)
    if (typeof listRes.memoryPath === 'string') setMemoryPath(listRes.memoryPath)
  }

  const refreshDiscoveryAndList = async (cfgOverride = null) => {
    setScanning(true)
    setItemsLoading(true)
    try {
      const [discRes, listRes] = await Promise.all([
        discoverExternalMemoryApi(),
        listExternalMemoryApi(cfgOverride),
      ])
      if (discRes && Array.isArray(discRes.sources)) setSources(discRes.sources)
      applyListResponse(listRes)
    } finally {
      setScanning(false)
      setItemsLoading(false)
    }
  }

  React.useEffect(() => {
    void refreshDiscoveryAndList()
  }, [
    view.sessionId,
    draft.memorySlot.kind,
    draft.memorySlot.endpoint,
    draft.memorySlot.vaultPath,
    draft.memorySlot.decayHalfLifeDays,
  ])

  const status = meta.externalMemoryStatus || {}
  const cordisProviders = Array.isArray(status.cordisProviders) ? status.cordisProviders : []
  const sessionKey = view.sessionId ? `session:${view.sessionId}` : ''
  const wsPolicy = (sessionKey && draft.workspacePolicies[sessionKey]) || status.policy || 'read-write'
  const memDegraded = Boolean(status.memory && status.memory.degraded)
  const activeKind = draft.memorySlot.kind || 'none'
  const isEffectiveOn = Boolean(draft.enabled && activeKind !== 'none' && wsPolicy !== 'disabled')
  const halfLifeDays = draft.memorySlot.decayHalfLifeDays || 21
  const stats = serverStats && serverStats.total === items.length
    ? serverStats
    : computeClientStats(items, halfLifeDays)

  const buildSavePayload = (nextDraft = draft) => ({
    enabled: Boolean(nextDraft.enabled),
    memorySlot: {
      ...nextDraft.memorySlot,
      ...(clearMemTok ? { clearAuthToken: true, authToken: '' } : {}),
    },
    moodSlot: {
      ...nextDraft.moodSlot,
    },
    embedding: {
      ...nextDraft.embedding,
      ...(clearEmbKey ? { clearApiKey: true, apiKey: '' } : {}),
    },
    autoDistill: {
      ...nextDraft.autoDistill,
    },
    workspacePolicies: nextDraft.workspacePolicies,
  })

  const saveConfig = async (nextDraft, toastMsg = '') => {
    setDraft(nextDraft)
    const res = await updateSecConfig({ externalMemory: buildSavePayload(nextDraft) })
    if (res && res.ok !== false && toastMsg) {
      patch({ notice: toastMsg })
    }
    return res
  }

  const toggleMasterSwitch = async on => {
    const nextKind = on && activeKind === 'none' ? 'builtin-md' : activeKind
    const next = {
      ...draft,
      enabled: on,
      memorySlot: {
        ...draft.memorySlot,
        enabled: true,
        kind: nextKind,
        label: nextKind === 'builtin-md' && !draft.memorySlot.label ? '参谋自带记事本' : draft.memorySlot.label,
      },
    }
    await saveConfig(
      next,
      on
        ? bi('已开启参谋记忆系统（主对话保持 0 字节隔离）', 'Chief memory enabled (0-byte @lead isolation)')
        : bi('已暂停参谋记忆', 'Chief memory paused'),
    )
    if (on) void refreshDiscoveryAndList(buildSavePayload(next))
  }

  const pickDiscoveredSource = async src => {
    if (!src || !src.applyPatch) return
    const p = src.applyPatch
    const next = {
      ...draft,
      enabled: true,
      memorySlot: p.memorySlot ? { ...draft.memorySlot, ...p.memorySlot } : draft.memorySlot,
      moodSlot: p.moodSlot ? { ...draft.moodSlot, ...p.moodSlot } : draft.moodSlot,
    }
    await saveConfig(next, bi(`已切换到「${src.title}」`, `Switched to "${src.title}"`))
    void refreshDiscoveryAndList(buildSavePayload(next))
  }

  const isSourceSelected = src => {
    if (!draft.enabled || !src) return false
    if (src.slot === 'mood') {
      return draft.moodSlot.enabled && draft.moodSlot.kind === 'cordis' && draft.moodSlot.cordisProviderId === src.cordisProviderId
    }
    if (src.kind === 'builtin-md') return activeKind === 'builtin-md'
    if (src.kind === 'mcp-http') return activeKind === 'mcp-http' && draft.memorySlot.endpoint === src.endpoint
    if (src.kind === 'markdown-vault') return activeKind === 'markdown-vault' && draft.memorySlot.vaultPath === src.vaultPath
    if (src.kind === 'cordis') return activeKind === 'cordis' && draft.memorySlot.cordisProviderId === src.cordisProviderId
    return false
  }

  const submitAddMemory = async (rawText, overrideOpts = {}) => {
    const text = String(rawText !== undefined ? rawText : newMemoryText).trim()
    if (!text || savingNote) return
    setSavingNote(true)
    try {
      if (!draft.enabled || activeKind === 'none') {
        const autoDraft = {
          ...draft,
          enabled: true,
          memorySlot: { ...draft.memorySlot, enabled: true, kind: 'builtin-md', label: '参谋自带记事本' },
        }
        await saveConfig(autoDraft)
      }
      const res = await addExternalMemoryApi(text, {
        category: overrideOpts.category !== undefined ? overrideOpts.category : newCategory,
        pinned: overrideOpts.pinned !== undefined ? overrideOpts.pinned : newPinned,
      })
      if (res && res.ok) {
        if (rawText === undefined) {
          setNewMemoryText('')
          setNewCategory('')
          setNewPinned(false)
        }
        applyListResponse(res)
      }
    } finally {
      setSavingNote(false)
    }
  }

  const reinforceMemory = async id => {
    const res = await updateExternalMemoryApi({ id, reinforce: true })
    if (res && res.ok) applyListResponse(res)
  }

  const togglePinMemory = async (id, pinned) => {
    const res = await updateExternalMemoryApi({ id, pinned })
    if (res && res.ok) applyListResponse(res)
  }

  const updateMemoryItem = async payload => {
    const res = await updateExternalMemoryApi(payload)
    if (res && res.ok) applyListResponse(res)
    return res
  }

  const forgetMemory = async id => {
    const res = await removeExternalMemoryApi(id)
    if (res && res.ok) applyListResponse(res)
  }

  const changeHalfLife = async days => {
    const next = {
      ...draft,
      memorySlot: { ...draft.memorySlot, decayHalfLifeDays: days },
    }
    await saveConfig(next, bi(`遗忘半衰期已设为 ${days} 天`, `Decay half-life set to ${days}d`))
    void refreshDiscoveryAndList(buildSavePayload(next))
  }

  const runProbe = async (customQ = '') => {
    const q = (customQ || probeQuery).trim() || '当前偏好与约定'
    if (customQ) setProbeQuery(customQ)
    setProbeBusy(true)
    setProbeResult(null)
    try {
      const res = await probeExternalMemoryApi({
        slot: 'memory',
        query: q,
        config: buildSavePayload(draft),
      })
      setProbeResult(res || { ok: false, error: '测试失败' })
    } finally {
      setProbeBusy(false)
    }
  }

  const updateMemSlot = patchFields => setDraft(prev => ({
    ...prev,
    memorySlot: { ...prev.memorySlot, ...patchFields },
  }))
  const updateMoodSlot = patchFields => setDraft(prev => ({
    ...prev,
    moodSlot: { ...prev.moodSlot, ...patchFields },
  }))
  const updateEmbeddingSlot = patchFields => setDraft(prev => ({
    ...prev,
    embedding: { ...prev.embedding, ...patchFields },
  }))
  const updateAutoDistillSlot = patchFields => setDraft(prev => ({
    ...prev,
    autoDistill: { ...prev.autoDistill, ...patchFields },
  }))

  const handleDistillNow = async () => {
    if (distillingNow) return
    setDistillingNow(true)
    try {
      const res = await distillMemoryNowApi()
      if (res && res.ok) {
        if (Array.isArray(res.items)) setItems(res.items)
        if (res.stats) setServerStats(res.stats)
        if (res.profile) setProfileData(res.profile)
        if (res.profilePath) setProfilePath(res.profilePath)
        const addedLen = Array.isArray(res.addedMemories) ? res.addedMemories.length : 0
        patch({
          notice: bi(
            `✦ 复盘完成：新增 ${addedLen} 条记忆${res.profileUpdated ? ' · 画像已更新' : ''}`,
            `✦ Distill complete: +${addedLen} memories${res.profileUpdated ? ' · profile updated' : ''}`,
          ),
        })
      } else {
        patch({ notice: (res && res.error) || bi('当前没有新的对话内容可复盘', 'No recent conversation turns to distill') })
      }
    } finally {
      setDistillingNow(false)
    }
  }

  const runEmbeddingProbe = async () => {
    setEmbProbeBusy(true)
    setEmbProbeResult(null)
    try {
      const res = await probeEmbeddingApi({
        ...draft.embedding,
        ...(clearEmbKey ? { clearApiKey: true, apiKey: '' } : {}),
      })
      setEmbProbeResult(res || { ok: false, error: '连接测试失败' })
    } finally {
      setEmbProbeBusy(false)
    }
  }

  const activeSourceTitle = (() => {
    const hit = sources.find(s => isSourceSelected(s) && s.slot !== 'mood')
    if (hit) return hit.title
    if (activeKind === 'builtin-md' || activeKind === 'none') return bi('参谋自带记事本', 'Chief Notebook')
    return draft.memorySlot.label || activeKind
  })()

  const engCatOrder = emotionSplitActive
    ? EXTMEM_CAT_ORDER.filter(c => c !== 'bond')
    : EXTMEM_CAT_ORDER.filter(c => c !== 'bond' || draft.moodSlot.enabled || (stats.byCategory.bond || 0) > 0)

  const emotionItems = items.filter(it => it && it.category === 'bond')

  const filteredBookItems = items.filter(it => {
    if (!it) return false
    if (emotionSplitActive && it.category === 'bond') return false
    if (catFilter !== 'all' && it.category !== catFilter) return false
    if (stageFilter === 'pinned' && !it.pinned) return false
    if (stageFilter === 'fading' && (it.vitality || 0) >= 60) return false
    if (bookSearch.trim()) {
      const q = bookSearch.trim().toLowerCase()
      if (!String(it.text || it.preview || '').toLowerCase().includes(q)) return false
    }
    return true
  })

  const exportMemoryMarkdown = () => {
    const today = new Date().toISOString().slice(0, 10)
    const lines = [
      '# DSH 参谋长记忆本 (MEMORY.md)',
      '',
      '> 纯文本可携带迁移备份，仅对参谋长生效。',
      '',
      ...items.map(it => {
        const d = it.date && /^\d{4}-\d{2}-\d{2}$/.test(it.date) ? it.date : today
        const last = it.lastActive && /^\d{4}-\d{2}-\d{2}$/.test(it.lastActive) ? it.lastActive : d
        const id = it.id || `cm-${Date.now().toString(36)}`
        const cat = EXTMEM_CAT_ORDER.includes(it.category) ? it.category : 'preference'
        const pin = it.pinned ? 1 : 0
        const hits = Math.max(0, Math.round(Number(it.hits) || 0))
        const txt = String(it.text || it.preview || '').replace(/[\r\n]+/g, ' ').trim()
        return txt ? `- [${d} | id=${id} | cat=${cat} | pin=${pin} | hits=${hits} | last=${last}] ${txt}` : ''
      }).filter(Boolean),
      '',
    ]
    try {
      const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `chief-memory-${today}.md`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => { try { URL.revokeObjectURL(url) } catch {} }, 1500)
      patch({ notice: bi(`已导出 ${items.length} 条记忆备份`, `Exported ${items.length} memory items`) })
    } catch {
      patch({ error: bi('导出失败', 'Export failed') })
    }
  }

  const importMemoryMarkdown = async file => {
    if (!file || importingMd) return
    setImportingMd(true)
    try {
      const raw = await file.text()
      const lines = raw.replace(/\r\n/g, '\n').split('\n')
      let count = 0
      for (const line of lines) {
        const t = line.trim()
        if (!t || t.startsWith('#') || t.startsWith('>')) continue
        let text = ''
        let category = ''
        let pinned = false
        const mm = t.match(/^-\s+\[([^\]]+)\]\s*(.+)$/)
        if (mm) {
          text = mm[2].trim()
          for (const part of mm[1].split('|').map(s => s.trim())) {
            if (part.startsWith('cat=') && EXTMEM_CAT_ORDER.includes(part.slice(4))) category = part.slice(4)
            else if (part.startsWith('pin=')) pinned = part.slice(4) === '1' || part.slice(4) === 'true'
          }
        } else {
          const pm = t.match(/^[-*]\s+(.+)$/)
          if (pm) text = pm[1].trim()
        }
        if (!text) continue
        const res = await addExternalMemoryApi(text, { category, pinned })
        if (res && res.ok) {
          count += 1
          applyListResponse(res)
        }
      }
      patch({ notice: bi(`已从备份导入 ${count} 条记忆`, `Imported ${count} memory items`) })
    } catch (err) {
      patch({ error: String((err && err.message) || err || '导入失败') })
    } finally {
      setImportingMd(false)
    }
  }

  const moodCordisList = cordisProviders.filter(p => p && (p.slot === 'mood' || p.slot === 'hybrid'))
  const detectedMoodSources = sources.filter(s => s && (s.slot === 'mood' || s.pluginSlot === 'mood' || s.pluginSlot === 'hybrid'))
  const sampleNotes = bi('zh', 'en') === 'en' ? EXTMEM_SAMPLE_NOTES_EN : EXTMEM_SAMPLE_NOTES_ZH
  const fadingItems = items.filter(it => it && !it.pinned && (it.vitality || 0) < 60)

  const navItems = [
    { key: 'book', icon: 'list', label: bi('记忆清单', 'Memories'), count: emotionSplitActive ? (stats.total - emotionItems.length) : stats.total },
    ...(emotionSplitActive
      ? [{ key: 'emotion', icon: 'heart', label: bi('情感记忆', 'Emotion'), count: emotionItems.length }]
      : []),
    { key: 'profile', icon: 'user', label: bi('用户画像', 'Profile') },
    { key: 'bridge', icon: 'sliders', label: bi('接入与设置', 'Setup') },
  ]
  const currentNavMeta = navItems.find(n => n.key === subTab) || navItems[0]

  const statusText = !draft.enabled
    ? bi('未开启', 'Off')
    : memDegraded
      ? bi('离线降级', 'Offline')
      : wsPolicy === 'disabled'
        ? bi('本窗口静音', 'Muted')
        : bi('运转中', 'Live')

  return h(
    'div',
    { className: 'dnb-view dnb-extmem-root', 'data-outer-rail': outerRailMode ? '1' : '0' },

    h(
      'div',
      { className: 'dnb-extmem-shell' },

      // =========================================================================
      // Left Sidebar Rail (Collapses cleanly to slim top bar on narrow views)
      // =========================================================================
      h(
        'aside',
        { className: 'dnb-extmem-rail' },
        h(
          'div',
          { className: 'dnb-extmem-rail-brand' },
          h(
            'div',
            { className: 'dnb-extmem-rail-brand-left' },
            h('span', { className: 'dnb-extmem-rail-logo' }, h(Icon, { name: 'brain', size: 13.5 })),
            h('span', { className: 'dnb-extmem-rail-name' }, bi('记忆空间', 'Memory')),
          ),
          h(
            'div',
            { className: 'dnb-extmem-rail-brand-switch' },
            h(Switch, {
              checked: Boolean(draft.enabled),
              onChange: on => void toggleMasterSwitch(on),
            }),
          ),
        ),
        h(
          'div',
          { className: 'dnb-extmem-rail-nav' },
          navItems.map(n =>
            h(
              'button',
              {
                key: n.key,
                type: 'button',
                className: 'dnb-extmem-rail-btn',
                'data-active': subTab === n.key ? '1' : '0',
                onClick: () => setSubTab(n.key),
              },
              h(
                'span',
                { className: 'dnb-extmem-rail-btn-label' },
                h(Icon, { name: n.icon, size: 13 }),
                h('span', null, n.label),
              ),
              n.count !== undefined
                ? h('span', { className: 'dnb-extmem-rail-count' }, String(n.count))
                : null,
            )),
        ),
        h(
          'div',
          { className: 'dnb-extmem-rail-foot' },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 } },
            h('span', { style: { fontSize: 11, color: 'var(--dnb-text-2)' } }, bi('记忆桥接', 'Bridge')),
            h(Switch, {
              checked: Boolean(draft.enabled),
              onChange: on => void toggleMasterSwitch(on),
            }),
          ),
          h('div', { style: { fontSize: 10, color: 'var(--dnb-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            activeSourceTitle),
          h('div', { style: { fontSize: 10, color: 'var(--dnb-text-3)' } },
            bi('@lead 保持 0 字节隔离', '0-byte @lead isolation')),
        ),
      ),

      // =========================================================================
      // Right Main Workspace Area
      // =========================================================================
      h(
        'div',
        { className: 'dnb-extmem-main' },

        // Header Bar (.dnb-extmem-hero)
        h(
          'div',
          { className: 'dnb-extmem-hero' },
          h(
            'div',
            { className: 'dnb-extmem-topbar' },
            h(
              'div',
              { className: 'dnb-extmem-topbar-left' },
              h('span', { className: 'dnb-extmem-title' }, currentNavMeta.label),
              h(
                'span',
                { className: 'dnb-extmem-status-pill', 'data-live': isEffectiveOn ? '1' : '0' },
                h('span', { className: 'dnb-extmem-status-dot' }),
                statusText,
              ),
              h(
                'span',
                { style: { fontSize: 11, color: 'var(--dnb-text-3)', fontVariantNumeric: 'tabular-nums' } },
                bi(`共 ${stats.total} 条 · ${stats.pinned} 常驻`, `${stats.total} notes · ${stats.pinned} pinned`),
              ),
            ),
            h(
              'div',
              { className: 'dnb-extmem-topbar-actions' },
              subTab === 'book'
                ? h(
                    'div',
                    { className: 'dnb-seg', style: { padding: 2 } },
                    [
                      { key: 'list', label: bi('清单', 'List') },
                      { key: 'sky', label: bi('星图', 'Map') },
                    ].map(dm =>
                      h('button', {
                        key: dm.key,
                        type: 'button',
                        className: 'dnb-seg-btn',
                        style: { padding: '2px 8px', fontSize: 10.5 },
                        'data-active': bookDisplayMode === dm.key ? '1' : '0',
                        onClick: () => setBookDisplayMode(dm.key),
                      }, dm.label)),
                  )
                : null,
              (subTab === 'book' && bookDisplayMode === 'sky')
                ? h(
                    React.Fragment,
                    null,
                    h('button', {
                      type: 'button',
                      className: 'dnb-extmem-tool-btn',
                      'data-active': skyMode === '2d' ? '1' : '0',
                      onClick: () => setSkyMode(skyMode === '2d' ? '3d' : '2d'),
                    }, skyMode === '2d' ? '2D' : '3D'),
                    h('button', {
                      type: 'button',
                      className: 'dnb-extmem-tool-btn',
                      onClick: () => setSkyResetTick(t => t + 1),
                    }, h(Icon, { name: 'refresh', size: 11 }), bi('重置视角', 'Reset')),
                  )
                : null,
              writable
                ? h('button', {
                    type: 'button',
                    className: 'dnb-extmem-tool-btn',
                    'data-active': captureOpen ? '1' : '0',
                    onClick: () => setCaptureOpen(v => !v),
                  }, h(Icon, { name: captureOpen ? 'x' : 'plus', size: 11.5 }), captureOpen ? bi('收起', 'Close') : bi('记一条', 'Add Note'))
                : null,
            ),
          ),
        ),

        // Quick Capture Drawer
        (captureOpen && writable)
          ? h(
              'div',
              { className: 'dnb-extmem-capture' },
              h(
                'div',
                { style: { display: 'flex', gap: 8, alignItems: 'center' } },
                h('input', {
                  className: 'dnb-input',
                  style: { ...EXTMEM_INPUT_STYLE, flex: 1 },
                  placeholder: bi('一句话写下你的偏好、规矩或项目决策（自动归类点亮星图）…', 'Write a habit, rule, or decision…'),
                  value: newMemoryText,
                  onChange: e => setNewMemoryText(e.target.value),
                  onKeyDown: e => {
                    if (e.key === 'Enter' && newMemoryText.trim()) void submitAddMemory()
                  },
                }),
                h('button', {
                  type: 'button',
                  className: 'dnb-primary-btn',
                  style: { minHeight: 34, padding: '0 14px', fontSize: 12, flexShrink: 0 },
                  disabled: savingNote || !newMemoryText.trim(),
                  onClick: () => void submitAddMemory(),
                }, savingNote ? bi('保存中…', 'Saving…') : bi('记住这条', 'Save')),
              ),
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' } },
                h(
                  'div',
                  { className: 'dnb-extmem-cat-pills' },
                  h('button', {
                    type: 'button',
                    className: 'dnb-extmem-cat-pill',
                    'data-active': newCategory === '' ? '1' : '0',
                    onClick: () => setNewCategory(''),
                  }, bi('自动归类', 'Auto')),
                  EXTMEM_CAT_ORDER.map(cat => {
                    const m = extMemCatMeta(cat)
                    return h('button', {
                      key: cat,
                      type: 'button',
                      className: 'dnb-extmem-cat-pill',
                      style: { '--cat-color': m.color },
                      'data-active': newCategory === cat ? '1' : '0',
                      onClick: () => setNewCategory(cat),
                    }, h('span', { className: 'dnb-extmem-cat-dot' }), bi(m.labelZh, m.labelEn))
                  }),
                ),
                h('button', {
                  type: 'button',
                  className: 'dnb-mini-btn',
                  'data-tone': newPinned ? 'amber' : undefined,
                  onClick: () => setNewPinned(v => !v),
                }, h(Icon, { name: 'pin', size: 11 }), newPinned ? bi('常驻不遗忘', 'Pinned') : bi('设为常驻', 'Pin')),
              ),
            )
          : null,

        // View 1: 记忆清单（默认极简列表 · 右上角可切换星图）
        subTab === 'book'
          ? (bookDisplayMode === 'sky'
              ? h(ExtMemStarCanvas, {
                  items,
                  writable,
                  mode: skyMode,
                  onModeChange: setSkyMode,
                  resetSignal: skyResetTick,
                  activeCategoryFilter: catFilter,
                  onCategoryFilterChange: setCatFilter,
                  sampleNotes,
                  onQuickAddSample: s => void submitAddMemory(s),
                  onReinforce: reinforceMemory,
                  onTogglePin: togglePinMemory,
                  onUpdateItem: updateMemoryItem,
                  onForget: forgetMemory,
                })
              : h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                  (() => {
                    const vData = view.voiceInboxData || null
                    const vPendingCount = vData ? (Number(vData.pendingCount) || 0) : 0
                    if (!vPendingCount) return null
                    return h(
                      'div',
                      {
                        className: 'dnb-strip-bar',
                        style: { '--dnb-strip-color': 'var(--dnb-accent)', padding: '6px 10px' },
                      },
                      h('span', { style: { fontSize: 11.5, color: 'var(--dnb-text-2)', display: 'inline-flex', alignItems: 'center', gap: 6 } },
                        h(Icon, { name: 'mic', size: 12.5, style: { color: 'var(--dnb-accent)' } }),
                        bi(`🎙️ 有 ${vPendingCount} 条待整理语音手记`, `${vPendingCount} pending voice note(s)`)),
                      h('button', {
                        type: 'button',
                        className: 'dnb-mini-btn',
                        'data-tone': 'accent',
                        onClick: () => patch({ tab: 'archive', archiveTabScope: 'notes' }),
                      }, bi('去档案·手记查看 →', 'Open Archive Notes →')),
                    )
                  })(),
                  !(items.length === 0 && !String(bookSearch || '').trim() && catFilter === 'all' && stageFilter === 'all')
                    ? h(
                        'div',
                        { className: 'dnb-extmem-capture', style: { gap: 8 } },
                        h(
                          'div',
                          { style: { display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' } },
                          h('input', {
                            className: 'dnb-input',
                            style: { ...EXTMEM_INPUT_STYLE, flex: '1 1 160px' },
                            placeholder: bi('检索关键词…', 'Filter notes…'),
                            value: bookSearch,
                            onChange: e => setBookSearch(e.target.value),
                          }),
                          [
                            { key: 'all', label: bi('全部', 'All') },
                            { key: 'pinned', label: bi('常驻', 'Pinned') },
                            { key: 'fading', label: bi('渐淡', 'Fading') },
                          ].map(sf =>
                            h('button', {
                              key: sf.key,
                              type: 'button',
                              className: 'dnb-mini-btn',
                              'data-tone': stageFilter === sf.key ? 'accent' : undefined,
                              onClick: () => setStageFilter(sf.key),
                            }, sf.label)),
                          draft.moodSlot.enabled
                            ? h('button', {
                                type: 'button',
                                className: 'dnb-mini-btn',
                                'data-tone': emotionSplitActive ? 'accent' : undefined,
                                onClick: () => {
                                  const nextSplit = !emotionSplitActive
                                  void saveConfig({
                                    ...draft,
                                    moodSlot: { ...draft.moodSlot, emotionSplitView: nextSplit },
                                  }, nextSplit ? bi('已拆分为独立「情感记忆」分栏', 'Split Emotion Memory into separate view') : bi('已合并回「记忆清单」', 'Merged Emotion Memory into list'))
                                  if (nextSplit) setSubTab('emotion')
                                },
                              }, h(Icon, { name: 'heart', size: 11 }), emotionSplitActive ? bi('已分栏', 'Split') : bi('拆出情感', 'Split Emotion'))
                            : null,
                        ),
                        h(
                          'div',
                          { className: 'dnb-extmem-cat-pills' },
                          h('button', {
                            type: 'button',
                            className: 'dnb-extmem-cat-pill',
                            'data-active': catFilter === 'all' ? '1' : '0',
                            onClick: () => setCatFilter('all'),
                          }, `${bi('全部', 'All')} (${emotionSplitActive ? (stats.total - emotionItems.length) : stats.total})`),
                          engCatOrder.map(cat => {
                            const m = extMemCatMeta(cat)
                            const cnt = stats.byCategory[cat] || 0
                            return h('button', {
                              key: cat,
                              type: 'button',
                              className: 'dnb-extmem-cat-pill',
                              style: { '--cat-color': m.color },
                              'data-active': catFilter === cat ? '1' : '0',
                              onClick: () => setCatFilter(catFilter === cat ? 'all' : cat),
                            }, h('span', { className: 'dnb-extmem-cat-dot' }), `${bi(m.labelZh, m.labelEn)} ${cnt}`)
                          }),
                        ),
                      )
                    : null,

              !writable
                ? h('div', { style: { fontSize: 11.5, color: 'var(--dnb-text-3)', padding: '8px 11px', borderRadius: 9, border: '1px solid var(--dnb-border)', background: 'var(--dnb-surface-sub)' } },
                    bi('当前为只读共享笔记目录，参谋不修改原文件。如需直接增改，请在「接入设置」切换回参谋记事本。',
                      'Read-only vault. Switch to Chief Notebook under Setup to edit directly.'))
                : null,

              itemsLoading && items.length === 0
                ? h('div', { style: { fontSize: 12, color: 'var(--dnb-text-3)', padding: 18, textAlign: 'center' } }, bi('正在读取记忆列表…', 'Loading memories…'))
                : filteredBookItems.length > 0
                  ? filteredBookItems.map((it, idx) => {
                      const m = extMemCatMeta(it.category)
                      const vit = Number.isFinite(Number(it.vitality)) ? Number(it.vitality) : 85
                      const isEdit = editingId && editingId === it.id
                      const barColor = it.pinned ? '#e6b865' : (vit >= 72 ? '#58c9a8' : (vit >= 40 ? '#5eb8e5' : '#94a3b8'))
                      return h(
                        'div',
                        {
                          key: it.id || idx,
                          className: 'dnb-extmem-card',
                          'data-pinned': it.pinned ? '1' : '0',
                          style: { borderLeft: `2.5px solid ${m.color}` },
                        },
                        h(
                          'div',
                          { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' } },
                          h(
                            'div',
                            { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                            h('span', { className: 'dnb-extmem-cat-dot', style: { '--cat-color': m.color } }),
                            h('span', { style: { fontSize: 11, fontWeight: 600, color: 'var(--dnb-text-2)' } }, bi(m.labelZh, m.labelEn)),
                            it.pinned
                              ? h('span', { className: 'dnb-acc-badge', 'data-tone': 'amber', style: { fontSize: 10 } }, bi('常驻', 'Pinned'))
                              : h('span', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', fontVariantNumeric: 'tabular-nums' } }, `${bi('活力', 'Vitality')} ${vit}%`),
                          ),
                          h('span', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)' } },
                            [it.date, it.hits > 0 ? bi(`命中 ${it.hits} 次`, `${it.hits} hits`) : ''].filter(Boolean).join(' · ')),
                        ),
                        h('div', { className: 'dnb-extmem-vitalbar' },
                          h('div', { className: 'dnb-extmem-vitalfill', style: { width: `${vit}%`, background: barColor } }),
                        ),
                        isEdit
                          ? h(
                              'div',
                              { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                              h('textarea', {
                                className: 'dnb-input',
                                rows: 2,
                                style: { ...EXTMEM_INPUT_STYLE, minHeight: 54 },
                                value: editingText,
                                onChange: e => setEditingText(e.target.value),
                              }),
                              h(
                                'div',
                                { style: { display: 'flex', gap: 6, justifyContent: 'flex-end' } },
                                h('button', {
                                  type: 'button',
                                  className: 'dnb-mini-btn',
                                  onClick: () => setEditingId(''),
                                }, bi('取消', 'Cancel')),
                                h('button', {
                                  type: 'button',
                                  className: 'dnb-primary-btn',
                                  style: { height: 28, padding: '0 12px', fontSize: 11.5 },
                                  disabled: !editingText.trim(),
                                  onClick: async () => {
                                    await updateMemoryItem({ id: it.id, text: editingText.trim() })
                                    setEditingId('')
                                  },
                                }, bi('保存', 'Save')),
                              ),
                            )
                          : h('div', { style: { fontSize: 12.2, color: 'var(--dnb-text)', lineHeight: 1.55, wordBreak: 'break-word' } },
                              it.text || it.preview),
                        writable && it.id
                          ? h(
                              'div',
                              { style: { display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' } },
                              !it.pinned
                                ? h('button', {
                                    type: 'button',
                                    className: 'dnb-mini-btn',
                                    onClick: () => void reinforceMemory(it.id),
                                  }, h(Icon, { name: 'bolt', size: 11 }), bi('强化', 'Boost'))
                                : null,
                              h('button', {
                                type: 'button',
                                className: 'dnb-mini-btn',
                                'data-tone': it.pinned ? 'amber' : undefined,
                                onClick: () => void togglePinMemory(it.id, !it.pinned),
                              }, h(Icon, { name: 'pin', size: 11 }), it.pinned ? bi('取消常驻', 'Unpin') : bi('常驻', 'Pin')),
                              h('button', {
                                type: 'button',
                                className: 'dnb-mini-btn',
                                onClick: () => {
                                  setEditingId(it.id)
                                  setEditingText(it.text || it.preview || '')
                                },
                              }, h(Icon, { name: 'edit', size: 11 }), bi('编辑', 'Edit')),
                              h('button', {
                                type: 'button',
                                className: 'dnb-mini-btn',
                                style: { marginLeft: 'auto', color: 'var(--dnb-coral, #f28b88)' },
                                onClick: () => void forgetMemory(it.id),
                              }, h(Icon, { name: 'trash', size: 11 }), bi('忘掉', 'Delete')),
                            )
                          : null,
                      )
                    })
                  : h(
                      'div',
                      { className: 'dnb-extmem-card', style: { alignItems: 'center', padding: 20, textAlign: 'center' } },
                      h('div', { style: { fontSize: 12, color: 'var(--dnb-text-3)' } },
                        items.length === 0
                          ? bi('还没有记忆条目，点击下方示例或右上角「记一条」开始。', 'No memories yet. Tap a starter below or Add Note.')
                          : bi('当前筛选条件下没有匹配的记忆条目。', 'No matching memories for current filters.')),
                      items.length === 0
                        ? h(
                            'div',
                            { style: { display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center', marginTop: 4 } },
                            sampleNotes.map((sample, idx) =>
                              h('button', {
                                key: idx,
                                type: 'button',
                                className: 'dnb-mini-btn',
                                onClick: () => void submitAddMemory(sample),
                              }, `+ ${sample}`)),
                          )
                        : null,
                    ),
              memoryPath
                ? h('div', { style: { padding: '0 4px', display: 'flex', flexDirection: 'column', gap: 4 } },
                    h('button', {
                      type: 'button',
                      className: 'dnb-mini-btn',
                      style: { alignSelf: 'flex-start', fontSize: 10.5 },
                      onClick: () => setShowMemoryFilePath(v => !v),
                    }, showMemoryFilePath ? bi('▾ 隐藏明文路径', '▾ Hide file path') : bi('📁 查看本地文件位置', '📁 View local file path')),
                    showMemoryFilePath
                      ? h('div', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', wordBreak: 'break-all' } },
                          `${bi('明文存储文件：', 'Plain file: ')}${memoryPath}`)
                      : null)
                : null,
                ))
          : null,

        // View 2b: Optional Separated Emotion / Bond Memory Sub-View
        (subTab === 'emotion' && emotionSplitActive)
          ? h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
              h(
                'div',
                { className: 'dnb-extmem-studio-head' },
                h('div', null,
                  h('div', { style: { fontSize: 13, fontWeight: 600, color: 'var(--dnb-text)', display: 'flex', alignItems: 'center', gap: 6 } },
                    h(Icon, { name: 'heart', size: 13, style: { color: '#e990ab' } }),
                    bi('情感与陪伴记忆（已分栏）', 'Emotion & Companion Memory')),
                  h('div', { style: { fontSize: 11, color: 'var(--dnb-text-3)', marginTop: 2 } },
                    bi('此处独立存放人物称呼、相处分寸与情感插件记录，不混入工程技术记忆；干正事时心境槽自动静默。',
                      'Dedicated space for relational tone and emotion plugins, cleanly separated from engineering notes.')),
                ),
                h('button', {
                  type: 'button',
                  className: 'dnb-mini-btn',
                  onClick: () => {
                    void saveConfig({
                      ...draft,
                      moodSlot: { ...draft.moodSlot, emotionSplitView: false },
                    }, bi('已合并回「记忆管理」统一展示', 'Merged Emotion view into Manage'))
                    setSubTab('book')
                  },
                }, bi('合并回记忆管理', 'Merge Back')),
              ),
              writable
                ? h(
                    'div',
                    { className: 'dnb-extmem-capture' },
                    h(
                      'div',
                      { style: { display: 'flex', gap: 8, alignItems: 'center' } },
                      h('input', {
                        className: 'dnb-input',
                        style: { ...EXTMEM_INPUT_STYLE, flex: 1 },
                        placeholder: bi('记录相处习惯、称呼彩蛋或陪伴约定（归入情感/人物约定）…', 'Add a relational note or companion preference…'),
                        value: newEmotionText,
                        onChange: e => setNewEmotionText(e.target.value),
                        onKeyDown: e => {
                          if (e.key === 'Enter' && newEmotionText.trim()) {
                            void submitAddMemory(newEmotionText.trim(), { category: 'bond' })
                            setNewEmotionText('')
                          }
                        },
                      }),
                      h('button', {
                        type: 'button',
                        className: 'dnb-primary-btn',
                        style: { minHeight: 34, padding: '0 14px', fontSize: 12, flexShrink: 0 },
                        disabled: savingNote || !newEmotionText.trim(),
                        onClick: () => {
                          void submitAddMemory(newEmotionText.trim(), { category: 'bond' })
                          setNewEmotionText('')
                        },
                      }, bi('存入情感栏', 'Save')),
                    ),
                  )
                : null,
              emotionItems.length > 0
                ? emotionItems.map((it, idx) =>
                    h(
                      'div',
                      {
                        key: it.id || idx,
                        className: 'dnb-extmem-card',
                        style: { borderLeft: '2.5px solid #e990ab' },
                      },
                      h(
                        'div',
                        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 } },
                        h('span', { style: { fontSize: 11, fontWeight: 600, color: '#e990ab' } }, bi('情感与称呼', 'Emotion & Bond')),
                        h('span', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)' } }, it.date || ''),
                      ),
                      h('div', { style: { fontSize: 12.2, color: 'var(--dnb-text)', lineHeight: 1.55 } }, it.text || it.preview),
                      writable && it.id
                        ? h(
                            'div',
                            { style: { display: 'flex', alignItems: 'center', gap: 5 } },
                            h('button', {
                              type: 'button',
                              className: 'dnb-mini-btn',
                              'data-tone': it.pinned ? 'amber' : undefined,
                              onClick: () => void togglePinMemory(it.id, !it.pinned),
                            }, h(Icon, { name: 'pin', size: 11 }), it.pinned ? bi('取消常驻', 'Unpin') : bi('常驻', 'Pin')),
                            h('button', {
                              type: 'button',
                              className: 'dnb-mini-btn',
                              style: { marginLeft: 'auto', color: 'var(--dnb-coral, #f28b88)' },
                              onClick: () => void forgetMemory(it.id),
                            }, h(Icon, { name: 'trash', size: 11 }), bi('忘掉', 'Delete')),
                          )
                        : null,
                    ))
                : h('div', { className: 'dnb-extmem-card', style: { padding: 18, textAlign: 'center', fontSize: 12, color: 'var(--dnb-text-3)' } },
                    bi('暂无单独的情感记忆条，可从上方输入或去「接入设置」一键导入本地情感插件数据。',
                      'No emotion notes yet. Add one above or import from a local plugin under Setup.')),
            )
          : null,

        subTab === 'profile'
          ? h(ExtMemProfileView, {
              profile: profileData,
              profilePath,
              loading: profileLoading,
              distilling: distillingNow,
              onDistillNow: handleDistillNow,
              onSaveProfile: async nextProfile => {
                const res = await saveMemoryProfileApi(nextProfile)
                if (res && res.ok) {
                  setProfileData(res.profile || nextProfile)
                  if (res.profilePath) setProfilePath(res.profilePath)
                  patch({ notice: bi('✅ 用户画像已更新', '✅ Profile saved') })
                }
              },
            })
          : null,

        // View 3: 接入与设置（后端直连 + 隐私与可选扩展 + 收起的高级调试面板）
        subTab === 'bridge'
          ? h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
              h(
                'div',
                { className: 'dnb-section', style: { padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 9 } },
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
                  h('span', { style: { fontSize: 12.5, fontWeight: 600, color: 'var(--dnb-text)' } },
                    bi('记忆存储源（通用开箱 + 生态自动发现）', 'Memory Backend (Portable & Auto-Discover)')),
                  h(
                    'div',
                    { style: { display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' } },
                    h('input', {
                      ref: importMdInputRef,
                      type: 'file',
                      accept: '.md,.txt,text/markdown,text/plain',
                      style: { display: 'none' },
                      onChange: e => {
                        const file = e.target.files && e.target.files[0]
                        e.target.value = ''
                        void importMemoryMarkdown(file)
                      },
                    }),
                    h('button', {
                      type: 'button',
                      className: 'dnb-mini-btn',
                      onClick: exportMemoryMarkdown,
                    }, bi('导出迁移', 'Export .md')),
                    h('button', {
                      type: 'button',
                      className: 'dnb-mini-btn',
                      disabled: importingMd || !writable,
                      onClick: () => importMdInputRef.current && importMdInputRef.current.click(),
                    }, importingMd ? bi('导入中…', 'Importing…') : bi('导入迁移', 'Import .md')),
                    h('button', {
                      type: 'button',
                      className: 'dnb-mini-btn',
                      disabled: scanning,
                      onClick: () => void refreshDiscoveryAndList(),
                    }, h(Icon, { name: 'refresh', size: 11 }), scanning ? bi('扫描中…', 'Scanning…') : bi('重新扫描', 'Rescan')),
                  ),
                ),
                h(
                  'div',
                  { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(195px, 1fr))', gap: 8 } },
                  (sources.length > 0
                    ? sources
                    : [{
                        id: 'builtin-md',
                        kind: 'builtin-md',
                        slot: 'memory',
                        title: bi('参谋自带记事本', 'Chief Notebook'),
                        badge: bi('开箱即用', 'Ready'),
                        subtitle: bi('零配置秒用 · 纯文本随时改', 'Zero setup · Plain MEMORY.md'),
                        available: true,
                        applyPatch: { enabled: true, memorySlot: { enabled: true, kind: 'builtin-md', label: '参谋自带记事本' } },
                      }]
                  ).map(src => {
                    const picked = isSourceSelected(src)
                    return h(
                      'button',
                      {
                        key: src.id,
                        type: 'button',
                        className: 'dnb-preset-card',
                        'data-active': picked ? '1' : '0',
                        style: {
                          textAlign: 'left',
                          padding: '9px 10px',
                          minHeight: 68,
                          opacity: src.available === false && !picked ? 0.68 : 1,
                        },
                        onClick: () => void pickDiscoveredSource(src),
                      },
                      h(
                        'div',
                        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 } },
                        h('div', { className: 'dnb-preset-title', style: { fontSize: 12 } }, src.title),
                        h('span', {
                          className: 'dnb-acc-badge',
                          'data-tone': picked ? 'accent' : (src.available ? 'green' : undefined),
                          style: { fontSize: 10 },
                        }, picked ? bi('使用中', 'Active') : src.badge),
                      ),
                      h('div', { className: 'dnb-preset-desc', style: { marginTop: 4, fontSize: 10.5 } },
                        src.kind === 'builtin-md'
                          ? (stats.total > 0
                              ? bi(`已记住 ${stats.total} 条 · 纯文本随时改`, `${stats.total} notes saved · Plain MEMORY.md`)
                              : bi('零配置秒用 · 存为透明 MEMORY.md', 'Zero setup · Plain MEMORY.md'))
                          : src.subtitle),
                    )
                  }),
                ),
              ),

              h(
                'div',
                { className: 'dnb-section', style: { padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 } },
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
                  h('div', null,
                    h('div', { style: { fontSize: 12, fontWeight: 600, color: 'var(--dnb-text)' } },
                      bi('向量增强（可选 · OpenAI 兼容 / 本地 Ollama / Gemini）', 'Optional Embedding (OpenAI / Ollama / Gemini)')),
                    h('div', { style: { fontSize: 11, color: 'var(--dnb-text-3)', marginTop: 2 } },
                      bi('不配完全不影响使用；可连接本机 Ollama 免费运行，或使用云端 OpenAI / Gemini Embedding 进行语义近义词重排。',
                        'Optional: boosts semantic recall via local Ollama, Google Gemini, or any OpenAI-compatible /embeddings API.')),
                  ),
                  h(Switch, {
                    checked: Boolean(draft.embedding.enabled),
                    onChange: on => void saveConfig({
                      ...draft,
                      embedding: { ...draft.embedding, enabled: on },
                    }, on ? bi('已开启向量增强', 'Embedding API enabled') : bi('已关闭向量增强，使用轻量纯文本检索', 'Embedding API off')),
                  }),
                ),
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingTop: 6, borderTop: '1px solid var(--dnb-border)' } },
                  h('span', { style: { fontSize: 11.5, color: 'var(--dnb-text-2)' } },
                    bi('后台自动提炼习惯记忆与用户画像（不写流水账日记）', 'Background Auto-Distill (Habits & Profile; no filler diary)')),
                  h(Switch, {
                    checked: Boolean(draft.autoDistill.enabled),
                    onChange: on => void saveConfig({
                      ...draft,
                      autoDistill: { ...draft.autoDistill, enabled: on },
                    }, on ? bi('已开启后台自动复盘', 'Auto-distill enabled') : bi('已暂停后台自动复盘', 'Auto-distill paused')),
                  }),
                ),
                draft.embedding.enabled
                  ? h(
                      'div',
                      { style: { display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 6, borderTop: '1px solid var(--dnb-border)' } },
                      h(
                        'div',
                        { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } },
                        h('span', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)' } }, bi('接入协议：', 'Protocol:')),
                        h(
                          'div',
                          { className: 'dnb-seg', style: { padding: 2, flexWrap: 'wrap', width: 'auto' } },
                          [
                            { key: 'openai', label: bi('OpenAI 兼容', 'OpenAI-Compat') },
                            { key: 'ollama', label: bi('本地 Ollama', 'Local Ollama') },
                            { key: 'gemini', label: 'Google Gemini' },
                          ].map(opt =>
                            h('button', {
                              key: opt.key,
                              type: 'button',
                              className: 'dnb-seg-btn',
                              style: { padding: '3px 10px', fontSize: 11, flex: '0 0 auto', whiteSpace: 'nowrap' },
                              'data-active': (draft.embedding.provider || 'openai') === opt.key ? '1' : '0',
                              onClick: () => {
                                const patchEmb = { provider: opt.key, providerExplicit: opt.key === 'openai' }
                                if (opt.key === 'ollama') {
                                  if (!draft.embedding.baseUrl || !String(draft.embedding.baseUrl).includes(':11434')) {
                                    patchEmb.baseUrl = 'http://127.0.0.1:11434'
                                  }
                                  if (!draft.embedding.model) patchEmb.model = 'bge-m3'
                                } else if (opt.key === 'gemini') {
                                  if (!draft.embedding.baseUrl || !String(draft.embedding.baseUrl).includes('googleapis.com')) {
                                    patchEmb.baseUrl = 'https://generativelanguage.googleapis.com/v1beta'
                                  }
                                  if (!draft.embedding.model || draft.embedding.model === 'bge-m3') {
                                    patchEmb.model = 'gemini-embedding-001'
                                  }
                                }
                                setEmbProbeResult(null)
                                updateEmbeddingSlot(patchEmb)
                              },
                            }, opt.label)),
                        ),
                      ),
                      h(
                        'div',
                        { style: { display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' } },
                        h('span', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)' } }, bi('快速填入：', 'Presets:')),
                        [
                          { label: '本地 Ollama (bge-m3)', provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'bge-m3' },
                          { label: 'Google Gemini', provider: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-embedding-001' },
                          { label: 'SiliconFlow (bge-m3)', provider: 'openai', baseUrl: 'https://api.siliconflow.cn/v1', model: 'BAAI/bge-m3' },
                          { label: 'OpenAI (3-small)', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'text-embedding-3-small' },
                          { label: '通义 DashScope', provider: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'text-embedding-v3' },
                        ].map(pre =>
                          h('button', {
                            key: pre.label,
                            type: 'button',
                            className: 'dnb-mini-btn',
                            onClick: () => {
                              setEmbProbeResult(null)
                              updateEmbeddingSlot({
                                provider: pre.provider,
                                providerExplicit: pre.provider === 'openai',
                                baseUrl: pre.baseUrl,
                                model: pre.model,
                              })
                            },
                          }, pre.label)),
                      ),
                      h(
                        'div',
                        { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 7 } },
                        h('input', {
                          className: 'dnb-input',
                          style: EXTMEM_INPUT_STYLE,
                          placeholder: draft.embedding.provider === 'ollama'
                            ? bi('Ollama 地址（默认 http://127.0.0.1:11434）', 'Ollama URL (http://127.0.0.1:11434)')
                            : (draft.embedding.provider === 'gemini'
                                ? bi('Gemini API（https://generativelanguage.googleapis.com/v1beta）', 'Gemini API Base URL')
                                : bi('Base URL（如 https://api.siliconflow.cn/v1）', 'Base URL')),
                          value: draft.embedding.baseUrl,
                          onChange: e => {
                            const val = e.target.value
                            const low = val.toLowerCase()
                            const inferred = (low.includes(':11434') && !/\/v1(?:\/embeddings)?$/i.test(low)) || low.includes('/api/embed')
                              ? 'ollama'
                              : (low.includes('generativelanguage.googleapis.com') || low.includes(':embedcontent') ? 'gemini' : '')
                            updateEmbeddingSlot({
                              baseUrl: val,
                              ...(inferred ? { provider: inferred, providerExplicit: false } : {}),
                            })
                          },
                        }),
                        h('input', {
                          className: 'dnb-input',
                          style: EXTMEM_INPUT_STYLE,
                          placeholder: draft.embedding.provider === 'ollama'
                            ? bi('本地模型（如 bge-m3 / nomic-embed-text）', 'Ollama model (e.g. bge-m3)')
                            : (draft.embedding.provider === 'gemini'
                                ? bi('模型名（如 gemini-embedding-001）', 'Model (e.g. gemini-embedding-001)')
                                : bi('模型名称（如 BAAI/bge-m3）', 'Model name')),
                          value: draft.embedding.model,
                          onChange: e => updateEmbeddingSlot({ model: e.target.value }),
                        }),
                      ),
                      draft.embedding.provider === 'ollama'
                        ? h('div', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', padding: '2px 2px' } },
                            bi('💡 本地 Ollama 默认免 API Key 直连（自动优先请求 /api/embed，旧版自动回退 /api/embeddings）。',
                              '💡 Local Ollama connects without an API key (uses /api/embed with automatic /api/embeddings fallback).'))
                        : h(
                            'div',
                            { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 7 } },
                            h('input', {
                              className: 'dnb-input',
                              style: EXTMEM_INPUT_STYLE,
                              placeholder: bi('API Key 环境变量名（推荐）', 'API Key Env Var'),
                              value: draft.embedding.apiKeyEnv,
                              onChange: e => updateEmbeddingSlot({ apiKeyEnv: e.target.value }),
                            }),
                            h(
                              'div',
                              { style: { display: 'flex', gap: 5, alignItems: 'center' } },
                              h('input', {
                                type: 'password',
                                className: 'dnb-input',
                                style: EXTMEM_INPUT_STYLE,
                                placeholder: draft.embedding.hasApiKey ? bi('已存 API Key（留空不变）', 'Saved key') : bi('或直接填 API Key', 'Or API Key'),
                                value: draft.embedding.apiKey,
                                onChange: e => {
                                  setClearEmbKey(false)
                                  updateEmbeddingSlot({ apiKey: e.target.value })
                                },
                              }),
                              draft.embedding.hasApiKey
                                ? h('button', {
                                    type: 'button',
                                    className: 'dnb-mini-btn',
                                    onClick: () => {
                                      setClearEmbKey(true)
                                      updateEmbeddingSlot({ apiKey: '', hasApiKey: false })
                                    },
                                  }, bi('清除', 'Clear'))
                                : null,
                            ),
                          ),
                      embProbeResult
                        ? h('div', {
                            style: {
                              fontSize: 11,
                              padding: '6px 9px',
                              borderRadius: 8,
                              border: '1px solid var(--dnb-border)',
                              background: 'var(--dnb-surface-sub)',
                              color: embProbeResult.ok ? 'var(--dnb-sage, #58c9a8)' : 'var(--dnb-coral, #f28b88)',
                            },
                          }, embProbeResult.ok
                            ? bi(`✅ [${embProbeResult.provider || 'openai'}] 向量接口正常 · ${embProbeResult.model} (${embProbeResult.dimensions} 维) · ${embProbeResult.latencyMs}ms`,
                                `✅ [${embProbeResult.provider || 'openai'}] Connected · ${embProbeResult.model} (${embProbeResult.dimensions}d) · ${embProbeResult.latencyMs}ms`)
                            : `[${embProbeResult.provider || draft.embedding.provider || 'openai'}] ${embProbeResult.error || bi('连接失败', 'Connection failed')}`)
                        : null,
                      h(
                        'div',
                        { style: { display: 'flex', justifyContent: 'flex-end', gap: 7 } },
                        h('button', {
                          type: 'button',
                          className: 'dnb-mini-btn',
                          disabled: embProbeBusy,
                          onClick: () => void runEmbeddingProbe(),
                        }, embProbeBusy ? bi('测试中…', 'Testing…') : bi('测试向量连通', 'Test Embedding')),
                        h('button', {
                          type: 'button',
                          className: 'dnb-primary-btn',
                          style: { minHeight: 30, padding: '0 13px', fontSize: 11.5 },
                          onClick: () => void saveConfig({ ...draft, enabled: true }, bi('向量配置已保存', 'Embedding settings saved')),
                        }, bi('保存向量配置', 'Save Embedding')),
                      ),
                    )
                  : null,
              ),

              h(
                'div',
                { className: 'dnb-section', style: { padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 } },
                sessionKey
                  ? h(
                      'div',
                      { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' } },
                      h('span', { style: { fontSize: 12, fontWeight: 600, color: 'var(--dnb-text)' } },
                        bi('本窗口隐私策略（涉密可设只读）', 'Window Privacy Policy')),
                      h(
                        'div',
                        { className: 'dnb-seg', style: { padding: 2 } },
                        [
                          { key: 'read-write', label: bi('读写', 'R/W') },
                          { key: 'read-only', label: bi('只读不写', 'Read-only') },
                          { key: 'disabled', label: bi('本局静音', 'Muted') },
                        ].map(opt =>
                          h('button', {
                            key: opt.key,
                            type: 'button',
                            className: 'dnb-seg-btn',
                            style: { padding: '3px 9px', fontSize: 11 },
                            'data-active': wsPolicy === opt.key ? '1' : '0',
                            onClick: () => void saveConfig({
                              ...draft,
                              workspacePolicies: { ...draft.workspacePolicies, [sessionKey]: opt.key },
                            }),
                          }, opt.label)),
                      ),
                    )
                  : null,

                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingTop: sessionKey ? 8 : 0, borderTop: sessionKey ? '1px solid var(--dnb-border)' : 'none' } },
                  h('div', null,
                    h('div', { style: { fontSize: 12, fontWeight: 600, color: 'var(--dnb-text)' } },
                      bi('情感 / 心境副槽（可选外挂）', 'Optional Mood / Relation Slot')),
                    h('div', { style: { fontSize: 11, color: 'var(--dnb-text-3)', marginTop: 2 } },
                      bi('内部数值仅作 UI 展示，绝不进入模型提示词；严肃工作模式自动静默。',
                        'Numeric gauges stay UI-only; auto-muted during serious work.')),
                  ),
                  h(Switch, {
                    checked: Boolean(draft.moodSlot.enabled),
                    onChange: on => void saveConfig({
                      ...draft,
                      moodSlot: { ...draft.moodSlot, enabled: on },
                    }),
                  }),
                ),
                draft.moodSlot.enabled
                  ? h(
                      'div',
                      { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                      detectedMoodSources.length > 0
                        ? h(
                            'div',
                            { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } },
                            h('span', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)' } }, bi('已检测情感插件：', 'Detected mood plugins:')),
                            detectedMoodSources.map(ms =>
                              h('button', {
                                key: ms.id,
                                type: 'button',
                                className: 'dnb-mini-btn',
                                'data-tone': draft.moodSlot.cordisProviderId === ms.cordisProviderId ? 'accent' : undefined,
                                onClick: () => void pickDiscoveredSource(ms),
                              }, ms.title)),
                          )
                        : null,
                      h(
                        'div',
                        { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
                        [
                          { key: 'chief-http', label: 'HTTP (chief-http)' },
                          { key: 'cordis', label: bi(`DSH 插件 (${moodCordisList.length})`, `Cordis (${moodCordisList.length})`) },
                        ].map(opt =>
                          h('button', {
                            key: opt.key,
                            type: 'button',
                            className: 'dnb-mini-btn',
                            'data-tone': draft.moodSlot.kind === opt.key ? 'accent' : undefined,
                            onClick: () => updateMoodSlot({ kind: opt.key }),
                          }, opt.label)),
                      ),
                      draft.moodSlot.kind === 'chief-http'
                        ? h('input', {
                            className: 'dnb-input',
                            style: EXTMEM_INPUT_STYLE,
                            placeholder: 'http://127.0.0.1:8789',
                            value: draft.moodSlot.endpoint,
                            onChange: e => updateMoodSlot({ endpoint: e.target.value }),
                          })
                        : (draft.moodSlot.kind === 'cordis'
                            ? h('input', {
                                className: 'dnb-input',
                                style: EXTMEM_INPUT_STYLE,
                                placeholder: moodCordisList.length ? moodCordisList.map(p => p.id).join(', ') : 'mood provider id',
                                value: draft.moodSlot.cordisProviderId,
                                onChange: e => updateMoodSlot({ cordisProviderId: e.target.value }),
                              })
                            : null),
                      h(
                        'div',
                        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
                        h('span', { style: { fontSize: 11, color: 'var(--dnb-text-3)' } }, bi('干正事时自动静默心境槽', 'Auto-mute mood in serious work')),
                        h(Switch, {
                          checked: Boolean(draft.moodSlot.workModeAutoMute),
                          onChange: on => void saveConfig({
                            ...draft,
                            moodSlot: { ...draft.moodSlot, workModeAutoMute: on },
                          }),
                        }),
                      ),
                      h(
                        'div',
                        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
                        h('span', { style: { fontSize: 11, color: 'var(--dnb-text-3)' } }, bi('情感记忆单独分栏展示（从工程记忆管理拆分）', 'Show Emotion Memory in a separate tab')),
                        h(Switch, {
                          checked: Boolean(draft.moodSlot.emotionSplitView),
                          onChange: on => void saveConfig({
                            ...draft,
                            moodSlot: { ...draft.moodSlot, emotionSplitView: on },
                          }, on ? bi('已开启独立「情感记忆」分栏', 'Separated Emotion Memory tab enabled') : bi('已合并到「记忆管理」', 'Merged into Manage tab')),
                        }),
                      ),
                    )
                  : null,
              ),

              h(
                AccCard,
                {
                  open: advancedOpen,
                  onToggle: () => setAdvancedOpen(v => !v),
                  tone: 'cyan',
                  icon: h(Icon, { name: 'sliders', size: 13.5, style: { color: 'var(--dnb-accent)' } }),
                  title: bi('高级调试与远程参数（召回测试 / 提示词 / 遗忘曲线 / 远程端口）', 'Advanced (Recall Probe / Prompts / Decay / Custom Endpoints)'),
                  preview: bi('平时无需展开 · 含召回模拟测试、提示词定制、遗忘半衰期与远程连接参数', 'Optional · X-Ray recall probe, prompts, decay curve & custom endpoints'),
                  bodyStyle: { padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 },
                },
                h(
                  'div',
                  { style: { display: 'flex', gap: 6, flexWrap: 'wrap', paddingBottom: 4, borderBottom: '1px solid var(--dnb-border)' } },
                  [
                    { key: 'probe', label: bi('召回测试', 'Recall Probe') },
                    { key: 'prompts', label: bi('提示词工坊', 'Prompts') },
                    { key: 'curve', label: bi('遗忘曲线', 'Decay Curve') },
                    { key: 'manual', label: bi('远程与同步参数', 'Remote & Sync') },
                  ].map(tool =>
                    h('button', {
                      key: tool.key,
                      type: 'button',
                      className: 'dnb-mini-btn',
                      'data-tone': advTool === tool.key ? 'accent' : undefined,
                      onClick: () => setAdvTool(tool.key),
                    }, tool.label)),
                ),

                advTool === 'probe'
                  ? h(
                      'div',
                      { style: { display: 'flex', flexDirection: 'column', gap: 9 } },
                      h(
                        'div',
                        { style: { display: 'flex', gap: 7, alignItems: 'center' } },
                        h('input', {
                          className: 'dnb-input',
                          style: { ...EXTMEM_INPUT_STYLE, flex: 1 },
                          placeholder: bi('输入测试问题…', 'Enter a sample question…'),
                          value: probeQuery,
                          onChange: e => setProbeQuery(e.target.value),
                          onKeyDown: e => {
                            if (e.key === 'Enter') void runProbe()
                          },
                        }),
                        h('button', {
                          type: 'button',
                          className: 'dnb-primary-btn',
                          style: { minHeight: 34, padding: '0 14px', fontSize: 11.5, flexShrink: 0 },
                          disabled: probeBusy,
                          onClick: () => void runProbe(),
                        }, probeBusy ? bi('测试中…', 'Probing…') : bi('实测召回', 'Run Probe')),
                      ),
                      probeResult
                        ? probeResult.ok
                          ? h(
                              'div',
                              { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                              h(
                                'div',
                                { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: 'var(--dnb-text-2)' } },
                                h('span', null, `${bi('命中', 'Hits')} ${Array.isArray(probeResult.items) ? probeResult.items.length : 0} ${bi('条', 'items')} · ${probeResult.latencyMs || 0}ms`),
                                h('span', { style: { fontVariantNumeric: 'tabular-nums' } },
                                  `${bi('预算占用', 'Budget')} ${probeResult.usedChars || 0} / ${probeResult.charBudget || draft.memorySlot.charBudget || 1600} ${bi('字', 'chars')}`),
                              ),
                              Array.isArray(probeResult.formattedLines) && probeResult.formattedLines.length > 0
                                ? h('pre', { className: 'dnb-extmem-xray-pre' },
                                    `## 10.5 参谋专属外部记忆召回（仅参谋长可见 · 对主对话 @lead 0 字节隔离）\n${probeResult.formattedLines.join('\n')}`)
                                : h('div', { style: { fontSize: 11.5, color: 'var(--dnb-text-3)' } },
                                    bi('当前没有命中的外部记忆条目；参谋长本轮将保持零注入并严格按现场代码作答。',
                                      'No external hits matched; Chief will stay clean without hallucination.')),
                            )
                          : h('div', { style: { fontSize: 11.5, color: 'var(--dnb-coral, #f28b88)' } },
                              probeResult.error || bi('连接测试失败', 'Probe failed'))
                        : null,
                    )
                  : null,

                advTool === 'prompts'
                  ? h(ExtMemPromptsView, {
                      prompts: promptsList,
                      promptsPath,
                      loading: promptsLoading,
                      onSavePrompt: async (key, content) => {
                        const res = await saveMemoryPromptApi(key, content)
                        if (res && res.ok) {
                          setPromptsList(res.prompts || [])
                          patch({ notice: bi('✅ 提示词规则已保存', '✅ Prompt saved') })
                        }
                      },
                      onResetPrompt: async key => {
                        const res = await resetMemoryPromptApi(key)
                        if (res && res.ok) {
                          setPromptsList(res.prompts || [])
                          patch({ notice: bi('↩️ 已恢复默认提示词', '↩️ Prompt reset to default') })
                        }
                      },
                    })
                  : null,

                advTool === 'curve'
                  ? h(
                      'div',
                      { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
                      h(
                        'div',
                        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' } },
                        h(
                          'div',
                          { style: { display: 'flex', alignItems: 'center', gap: 10 } },
                          h(ExtMemVitalityRing, { percent: stats.avgVitality, size: 42 }),
                          h('div', null,
                            h('div', { style: { fontSize: 12.5, fontWeight: 600, color: 'var(--dnb-text)' } },
                              bi('艾宾浩斯遗忘半衰期', 'Ebbinghaus Retention Half-Life')),
                            h('div', { style: { fontSize: 11, color: 'var(--dnb-text-3)', marginTop: 2 } },
                              bi('长期不用的记忆柔和变淡（12% 托底不丢）；召回或强化可延长保留期。',
                                'Unused notes dim softly (12% floor); recalls & boosts extend half-life.'))),
                        ),
                        h(
                          'div',
                          { className: 'dnb-seg', style: { padding: 2 } },
                          [
                            { days: 7, label: bi('轻快 7天', '7d') },
                            { days: 21, label: bi('均衡 21天', '21d') },
                            { days: 60, label: bi('长情 60天', '60d') },
                          ].map(opt =>
                            h('button', {
                              key: opt.days,
                              type: 'button',
                              className: 'dnb-seg-btn',
                              style: { padding: '3px 9px', fontSize: 11 },
                              'data-active': halfLifeDays === opt.days ? '1' : '0',
                              onClick: () => void changeHalfLife(opt.days),
                            }, opt.label)),
                        ),
                      ),
                      h(ExtMemDecayChart, {
                        items,
                        halfLifeDays,
                        onReinforce: reinforceMemory,
                      }),
                      fadingItems.length > 0
                        ? h('div', { style: { fontSize: 11, color: 'var(--dnb-text-3)' } },
                            bi(`当前有 ${fadingItems.length} 条记忆活力较低，可在「记忆清单 → 渐淡」里点「强化」巩固。`,
                              `${fadingItems.length} fading notes can be boosted under Memories -> Fading.`))
                        : null,
                    )
                  : null,

                advTool === 'manual'
                  ? h(
                      React.Fragment,
                      null,
                      h(
                        'div',
                        { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
                        [
                          { key: 'builtin-md', label: bi('自带记事本', 'Notebook') },
                          { key: 'mcp-http', label: 'MCP HTTP' },
                          { key: 'chief-http', label: 'HTTP (chief-http)' },
                          { key: 'markdown-vault', label: bi('自定义笔记目录', 'Custom Vault') },
                          { key: 'cordis', label: bi('DSH 插件', 'Cordis') },
                        ].map(opt =>
                          h('button', {
                            key: opt.key,
                            type: 'button',
                            className: 'dnb-mini-btn',
                            'data-tone': activeKind === opt.key ? 'accent' : undefined,
                            onClick: () => updateMemSlot({ kind: opt.key, enabled: true }),
                          }, opt.label)),
                      ),
                      (activeKind === 'mcp-http' || activeKind === 'chief-http')
                        ? h(
                            React.Fragment,
                            null,
                            h('input', {
                              className: 'dnb-input',
                              style: EXTMEM_INPUT_STYLE,
                              placeholder: activeKind === 'mcp-http' ? 'http://127.0.0.1:8765/mcp' : 'http://127.0.0.1:8788',
                              value: draft.memorySlot.endpoint,
                              onChange: e => updateMemSlot({ endpoint: e.target.value }),
                            }),
                            h(
                              'div',
                              { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 7 } },
                              h('input', {
                                className: 'dnb-input',
                                style: EXTMEM_INPUT_STYLE,
                                placeholder: bi('密钥环境变量名（推荐）', 'Auth Env Var Name'),
                                value: draft.memorySlot.authEnvVar,
                                onChange: e => updateMemSlot({ authEnvVar: e.target.value }),
                              }),
                              h(
                                'div',
                                { style: { display: 'flex', gap: 5, alignItems: 'center' } },
                                h('input', {
                                  type: 'password',
                                  className: 'dnb-input',
                                  style: EXTMEM_INPUT_STYLE,
                                  placeholder: draft.memorySlot.hasAuthToken ? bi('已存密钥（留空不变）', 'Saved token') : bi('或可选 Token', 'Optional Token'),
                                  value: draft.memorySlot.authToken,
                                  onChange: e => {
                                    setClearMemTok(false)
                                    updateMemSlot({ authToken: e.target.value })
                                  },
                                }),
                                draft.memorySlot.hasAuthToken
                                  ? h('button', {
                                      type: 'button',
                                      className: 'dnb-mini-btn',
                                      onClick: () => {
                                        setClearMemTok(true)
                                        updateMemSlot({ authToken: '', hasAuthToken: false })
                                      },
                                    }, bi('清除', 'Clear'))
                                  : null,
                              ),
                            ),
                          )
                        : null,
                      activeKind === 'markdown-vault'
                        ? h('input', {
                            className: 'dnb-input',
                            style: EXTMEM_INPUT_STYLE,
                            placeholder: bi('填写本地笔记文件夹路径（只读不改）', 'Local Markdown directory (read-only)'),
                            value: draft.memorySlot.vaultPath,
                            onChange: e => updateMemSlot({ vaultPath: e.target.value }),
                          })
                        : null,
                      activeKind === 'cordis'
                        ? h('input', {
                            className: 'dnb-input',
                            style: EXTMEM_INPUT_STYLE,
                            placeholder: bi('输入 DSH 进程插件 provider ID', 'Cordis provider ID'),
                            value: draft.memorySlot.cordisProviderId,
                            onChange: e => updateMemSlot({ cordisProviderId: e.target.value }),
                          })
                        : null,

                      h(
                        'div',
                        { style: { display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 6, borderTop: '1px solid var(--dnb-border)' } },
                        h(
                          'div',
                          { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
                          h('span', { style: { fontSize: 11.5 } }, bi('自动捕捉“记住/习惯”等约定与压缩前抢救', 'Auto-capture explicit habits & pre-compact')),
                          h(Switch, {
                            checked: Boolean(draft.memorySlot.autoSyncChat),
                            onChange: on => updateMemSlot({ autoSyncChat: on, syncPreCompress: on }),
                          }),
                        ),
                        h(
                          'div',
                          { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
                          h('span', { style: { fontSize: 11.5 } }, bi('单向同步主对话脱敏摘要（默认关）', 'One-way sync scrubbed @lead summary')),
                          h(Switch, {
                            checked: Boolean(draft.memorySlot.syncLeadSummary),
                            onChange: on => updateMemSlot({ syncLeadSummary: on }),
                          }),
                        ),
                      ),

                      h(
                        'div',
                        { style: { display: 'flex', justifyContent: 'flex-end', gap: 7 } },
                        h('button', {
                          type: 'button',
                          className: 'dnb-mini-btn',
                          onClick: () => { setAdvTool('probe'); void runProbe() },
                        }, bi('测试并查看召回', 'Probe & X-Ray')),
                        h('button', {
                          type: 'button',
                          className: 'dnb-primary-btn',
                          style: { minHeight: 32, padding: '0 14px', fontSize: 11.5 },
                          onClick: () => void saveConfig({ ...draft, enabled: true }, bi('进阶配置已保存', 'Advanced settings saved')),
                        }, bi('保存进阶配置', 'Save')),
                      ),
                    )
                  : null,
              ),
            )
          : null,
      ),
    ),
  )
}
