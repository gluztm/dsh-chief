/**
 * src/client/i18n.js
 *
 * Bilingual (`zh` / `en`) runtime helpers for DSH Chief UI.
 * Keeps zero local module dependencies so every client layer can import safely without cycles.
 */

const UI_LANG_STORAGE_KEY = 'dsh-chief:ui-lang'

const i18nState = {
  pref: 'auto',
}

/** Normalize any language preference string to `'auto' | 'zh' | 'en'`. */
export function normalizeClientUiLang(raw) {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (s === 'zh' || s === 'zh-cn' || s === 'zh-hans') return 'zh'
  if (s === 'en' || s === 'en-us' || s === 'en-gb') return 'en'
  return 'auto'
}

/** Detect host UI language from document/navigator, safely defaulting to `'zh'` in headless Node tests. */
export function detectHostLang() {
  try {
    if (typeof document !== 'undefined' && document.documentElement) {
      const root = document.documentElement
      const docLang = (
        (typeof root.lang === 'string' && root.lang)
        || (typeof root.getAttribute === 'function' && (root.getAttribute('data-locale') || root.getAttribute('data-lang')))
        || ''
      ).trim().toLowerCase()
      if (docLang.startsWith('en')) return 'en'
      if (docLang.startsWith('zh')) return 'zh'
    }
  } catch {}
  try {
    if (typeof navigator !== 'undefined') {
      const navLang = (
        (Array.isArray(navigator.languages) && navigator.languages[0])
        || navigator.language
        || ''
      )
      const clean = String(navLang || '').trim().toLowerCase()
      if (clean.startsWith('en')) return 'en'
      if (clean.startsWith('zh')) return 'zh'
    }
  } catch {}
  return 'zh'
}

/** Read persisted UI language preference from localStorage and sync module runtime state. */
export function readSavedUiLang() {
  let saved = 'auto'
  try {
    if (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function') {
      saved = normalizeClientUiLang(localStorage.getItem(UI_LANG_STORAGE_KEY))
    }
  } catch {}
  i18nState.pref = saved
  return saved
}

readSavedUiLang()

/** Set active runtime language preference (`'auto' | 'zh' | 'en'`) and persist to localStorage. */
export function setRuntimeUiLang(pref) {
  const norm = normalizeClientUiLang(pref)
  i18nState.pref = norm
  try {
    if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
      localStorage.setItem(UI_LANG_STORAGE_KEY, norm)
    }
  } catch {}
  return norm
}

export function getUiLangPref() {
  return i18nState.pref || 'auto'
}

export function getUiLang() {
  const pref = getUiLangPref()
  if (pref === 'zh' || pref === 'en') return pref
  return detectHostLang()
}

export function isEn() {
  return getUiLang() === 'en'
}

/** Inline bilingual selector preserving exact Chinese strings in the bundle while supporting instant English switch. */
export function bi(zhText, enText) {
  return isEn() ? enText : zhText
}

/** Simple `{var}` placeholder formatter over bilingual templates. */
export function formatBi(zhTpl, enTpl, vars = {}) {
  let out = String(isEn() ? enTpl : zhTpl)
  for (const [k, v] of Object.entries(vars || {})) {
    out = out.replaceAll('{' + k + '}', String(v === undefined || v === null ? '' : v))
  }
  return out
}

export function tabLabel(key) {
  switch (key) {
    case 'chief': return bi('参谋', 'Chief')
    case 'tasks': return bi('任务', 'Tasks')
    case 'peers': return bi('协同', 'Peers')
    case 'archive': return bi('档案', 'Archives')
    case 'boundaries': return bi('边界', 'Guards')
    default: return String(key || '')
  }
}

export function statusLabel(key) {
  switch (key) {
    case 'todo': return bi('待推进', 'To Do')
    case 'doing': return bi('推进中', 'Doing')
    case 'blocked': return bi('受阻', 'Blocked')
    case 'done': return bi('已完成', 'Done')
    default: return String(key || '')
  }
}

export function statusBadge(key) {
  switch (key) {
    case 'todo': return bi('○ 待推进', '○ To Do')
    case 'doing': return bi('推进中', 'Doing')
    case 'blocked': return bi('⚠ 受阻', '⚠ Blocked')
    case 'done': return bi('✓ 已完成', '✓ Done')
    default: return String(key || '')
  }
}

export function permLabel(key) {
  switch (key) {
    case 'advisor': return bi('L0 · 顾问模式', 'L0 · Advisor')
    case 'assistant': return bi('L1 · 助手模式', 'L1 · Assistant')
    case 'strategist': return bi('L2 · 参谋模式', 'L2 · Strategist')
    case 'chief': return bi('L3 · 参谋长模式', 'L3 · Chief')
    default: return String(key || '')
  }
}

export function permDesc(key) {
  switch (key) {
    case 'advisor':
      return bi(
        'L0 顾问档：只看并给建议。不改项目文件，也不打断主对话或子代理。',
        'L0 Advisor: reads only and gives advice. Never edits files or interrupts main or subagent chats.',
      )
    case 'assistant':
      return bi(
        'L1 助手档：会自动整理记忆、档案和看板。不改项目文件，也不插话主对话。',
        'L1 Assistant: organizes memory, archives, and tasks. Never edits files or interrupts the main chat.',
      )
    case 'strategist':
      return bi(
        'L2 参谋档：会起草改文件、递话和压缩操作，每项都弹窗问你同意后再执行。',
        'L2 Strategist: drafts file edits, relays, and compaction, then asks you to approve each item.',
      )
    case 'chief':
      return bi(
        'L3 参谋长档：直接带主对话和子代理干活、纠偏、压缩并续跑，带防死循环保护。',
        'L3 Chief: guides main and subagent chats, fixes course, compacts, and resumes, with loop protection.',
      )
    default:
      return ''
  }
}

export function runModeMeta(key) {
  switch (key) {
    case 'off':
      return {
        key: 'off',
        label: bi('关停', 'Off'),
        shortLabel: bi('关停', 'Off'),
        hint: bi(
          '平时完全不动不花钱，只有你主动问它或点按钮时才干活。',
          'Completely quiet while idle; responds only when you ask or click.',
        ),
      }
    case 'patrol':
      return {
        key: 'patrol',
        label: bi('巡检', 'Patrol'),
        shortLabel: bi('巡检', 'Patrol'),
        hint: bi(
          '平时不动不花钱，只有在出错、断线或被安全拦截时才出来帮忙。',
          'No background calls while idle; wakes only on errors, drops, or safety blocks.',
        ),
      }
    case 'managed':
      return {
        key: 'managed',
        label: bi('托管', 'Managed'),
        shortLabel: bi('托管', 'Managed'),
        hint: bi(
          '一直在后台盯着把事做完，有空时顺手整理资料；闲置 15 分钟自动停，带费用上限。',
          'Keeps watching progress and tidies archives in idle time. Auto-sleeps after 15m idle, with a usage cap.',
        ),
      }
    default:
      return { key: String(key || 'off'), label: String(key || ''), shortLabel: String(key || ''), hint: '' }
  }
}

export function effortMeta(key) {
  switch (key) {
    case 'auto':
      return {
        key: 'auto',
        label: bi('自适应', 'Auto'),
        shortLabel: bi('自动', 'Auto'),
        badge: bi('自动换挡', 'Auto Effort'),
        hint: bi(
          '按任务难易自动调思考深度。写摘要或梦境漫游时关闭，排查或设拦截规则时调高。',
          'Adjusts thinking depth by task: off for summaries or Dream Roam, higher for debugging or guard rules.',
        ),
      }
    case 'off':
      return {
        key: 'off',
        label: bi('关闭思考', 'Off'),
        shortLabel: bi('关', 'Off'),
        badge: bi('关闭思考', 'No Thinking'),
        hint: bi('直接输出回答，不做深度思考，速度最快。', 'Replies directly without deep thinking for the fastest output.'),
      }
    case 'low':
      return {
        key: 'low',
        label: bi('低强度', 'Low'),
        shortLabel: bi('低', 'Low'),
        badge: bi('低思考', 'Low'),
        hint: bi('简单检查和日常问答。', 'Quick checks and everyday Q&A.'),
      }
    case 'medium':
      return {
        key: 'medium',
        label: bi('中强度', 'Medium'),
        shortLabel: bi('中', 'Med'),
        badge: bi('中思考', 'Medium'),
        hint: bi('日常推理、写代码和复盘。', 'Balanced thinking for coding, reviews, and daily work.'),
      }
    case 'high':
      return {
        key: 'high',
        label: bi('高强度', 'High'),
        shortLabel: bi('高', 'High'),
        badge: bi('高思考', 'High'),
        hint: bi('处理复杂问题、设拦截规则、强介入和总结经验。', 'Complex debugging, guard rules, strong intervention, and takeaways.'),
      }
    case 'xhigh':
      return {
        key: 'xhigh',
        label: bi('极高强度', 'XHigh'),
        shortLabel: bi('极高', 'XHigh'),
        badge: bi('极高思考', 'XHigh'),
        hint: bi('处理多条规则冲突、严重故障和复杂分析。', 'Resolving rule conflicts, critical issues, and deep analysis.'),
      }
    default:
      return { key: String(key || 'auto'), label: String(key || ''), shortLabel: String(key || ''), badge: String(key || ''), hint: '' }
  }
}

export function boundListLabel(field) {
  switch (field) {
    case 'allowed': return bi('必须做', 'Must Do')
    case 'forbidden': return bi('不要做', 'Don\'t Do')
    case 'notes': return bi('注意', 'Watchouts')
    default: return String(field || '')
  }
}

export function presetList() {
  return [
    {
      id: 'observer',
      icon: '',
      title: bi('只读旁观', 'Observer'),
      tag: bi('L0 · 关停 · 低思考', 'L0 · Off · Low'),
      desc: bi('只看不改：不自动执行任何操作，需要时给摘要和建议。', 'Read-only: no automatic actions or edits; gives summaries and advice when asked.'),
    },
    {
      id: 'collab',
      icon: '',
      title: bi('日常协作', 'Co-Pilot'),
      tag: bi('L2 · 巡检 · 改前先问你', 'L2 · Patrol · Ask First'),
      desc: bi('平时不动不花钱，出错或被拦时才出来帮忙；重要改动会先弹窗问你。', 'No background calls while idle; steps in on errors or blocks and asks before important edits.'),
    },
    {
      id: 'away',
      icon: '',
      title: bi('离桌托管', 'Away Mode'),
      tag: bi('L3 · 托管 · 30次/300K 熔断', 'L3 · Managed · Budget Cap'),
      desc: bi('持续盯进度，上下文到 80% 自动压缩，30 次调用或 300K Token 后自动停，关键节点发通知。', 'Keeps watching progress, auto-compacts at 80%, stops after 30 calls or 300K tokens, and sends alerts at key points.'),
    },
  ]
}

/** Resolve user-defined Chief name with graceful default fallback (`DSH 参谋长` / `DSH Chief`). */
export function chiefDisplayName(viewOrMeta) {
  const v = viewOrMeta && typeof viewOrMeta === 'object' ? viewOrMeta : {}
  const meta = (v.chiefMeta && typeof v.chiefMeta === 'object') ? v.chiefMeta : v
  const custom = meta && typeof meta.chiefName === 'string' ? meta.chiefName.trim() : ''
  return custom || bi('DSH 参谋长', 'DSH Chief')
}

/** Resolve concise inline Chief label (`<customName>` or `参谋长` / `Chief`). */
export function chiefShortName(viewOrMeta) {
  const v = viewOrMeta && typeof viewOrMeta === 'object' ? viewOrMeta : {}
  const meta = (v.chiefMeta && typeof v.chiefMeta === 'object') ? v.chiefMeta : v
  const custom = meta && typeof meta.chiefName === 'string' ? meta.chiefName.trim() : ''
  return custom || bi('参谋长', 'Chief')
}
