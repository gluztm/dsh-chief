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
        'L0 顾问档：只读巡检诊断并在面板输出建议，不修改工作区或向主对话/子代理注入强推指令',
        'L0 Advisor: read-only diagnosis & panel suggestions; never edits workspace files or pushes main/subagents.',
      )
    case 'assistant':
      return bi(
        'L1 助手档：仅自主维护记忆/档案/看板与建议卡片，不改工作区文件且不直接插话主对话',
        'L1 Assistant: maintains memory/archives/board & suggestions; never edits workspace files or interrupts lead.',
      )
    case 'strategist':
      return bi(
        'L2 参谋档：自动分析并生成关键动作（工作区改动/递话/压缩），逐项弹窗授权后才执行',
        'L2 Strategist: drafts actions & relays behind explicit per-item human approval popups.',
      )
    case 'chief':
      return bi(
        'L3 参谋长档：高自主闭环督导（直控主对话/子代理、纠偏、压缩与续跑），含防死循环熔断',
        'L3 Chief: autonomous supervision, steering, compaction & resume within guard walls & loop/budget breakers.',
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
        label: bi('⏸ 关停', '⏸ Off'),
        shortLabel: bi('⏸ 关停', '⏸ Off'),
        hint: bi(
          '0 后台消耗，仅显式 Q&A / 按钮触发；禁止自动巡检、梦境漫游或断线续跑',
          'Zero background LLM usage; triggers only on explicit Q&A or buttons.',
        ),
      }
    case 'patrol':
      return {
        key: 'patrol',
        label: bi('🛡 巡检', '🛡 Patrol'),
        shortLabel: bi('🛡 巡检', '🛡 Patrol'),
        hint: bi(
          '常规回合 0 Token；仅在阻墙拦截/异常/断流时精准唤醒，支持 Auto continue',
          'Zero idle cost; wakes only on guard-wall blocks, errors, or stream drops.',
        ),
      }
    case 'managed':
      return {
        key: 'managed',
        label: bi('🤖 托管', '🤖 Managed'),
        shortLabel: bi('🤖 托管', '🤖 Managed'),
        hint: bi(
          '持续后台监工 + 🌙 梦境漫游整理卷宗织钩子 + 15 分钟 5 条件自动休眠 + 硬预算熔断',
          'Continuous supervision + 🌙 Dream Roam + 5-condition auto-sleep + hard budget cap.',
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
        label: bi('🪄 自适应', '🪄 Auto'),
        shortLabel: bi('🪄 自动', '🪄 Auto'),
        badge: bi('🪄 自动换挡', '🪄 Auto Effort'),
        hint: bi(
          '按当前任务复杂度自动升降挡（摘要/梦境漫游→关，诊断/筑墙→高/极高）',
          'Adapts reasoning depth by task complexity (off for summaries, high/xhigh for diagnosis).',
        ),
      }
    case 'off':
      return {
        key: 'off',
        label: bi('⚡ 关闭思考', '⚡ Off'),
        shortLabel: bi('⚡ 关', '⚡ Off'),
        badge: bi('⚡ 关闭思考', '⚡ No Thinking'),
        hint: bi('极速低延迟文本输出，不开深度推理链', 'Fastest low-latency text output without reasoning chain.'),
      }
    case 'low':
      return {
        key: 'low',
        label: bi('🔅 低强度', '🔅 Low'),
        shortLabel: bi('🔅 低', '🔅 Low'),
        badge: bi('🔅 低思考', '🔅 Low'),
        hint: bi('轻量校验与一般问答', 'Lightweight checks and quick Q&A.'),
      }
    case 'medium':
      return {
        key: 'medium',
        label: bi('⚖️ 中强度', '⚖️ Medium'),
        shortLabel: bi('⚖️ 中', '⚖️ Med'),
        badge: bi('⚖️ 中思考', '⚖️ Medium'),
        hint: bi('日常均衡推理与复盘', 'Balanced reasoning for reviews and planning.'),
      }
    case 'high':
      return {
        key: 'high',
        label: bi('🔥 高强度', '🔥 High'),
        shortLabel: bi('🔥 高', '🔥 High'),
        badge: bi('🔥 高思考', '🔥 High'),
        hint: bi('复杂排障、筑墙、强介入与经验沉淀', 'Complex debugging, guard walls, intervention & synthesis.'),
      }
    case 'xhigh':
      return {
        key: 'xhigh',
        label: bi('🧠 极高强度', '🧠 XHigh'),
        shortLabel: bi('🧠 极高', '🧠 XHigh'),
        badge: bi('🧠 极高思考', '🧠 XHigh'),
        hint: bi('多边界碰撞、紧急危情诊断与全局深推演', 'Multi-wall conflicts, hazard diagnosis & deep global analysis.'),
      }
    default:
      return { key: String(key || 'auto'), label: String(key || ''), shortLabel: String(key || ''), badge: String(key || ''), hint: '' }
  }
}

export function factCatLabel(key) {
  switch (key) {
    case 'discipline': return bi('纪律', 'Discipline')
    case 'architecture': return bi('架构', 'Architecture')
    case 'team': return bi('分工', 'Roles')
    case 'progress': return bi('进展', 'Progress')
    case 'preference': return bi('偏好', 'Preference')
    default: return String(key || '')
  }
}

export function boundListLabel(field) {
  switch (field) {
    case 'allowed': return bi('必做事项', 'Must Do')
    case 'forbidden': return bi('禁止红线', 'Forbidden')
    case 'notes': return bi('注意事项', 'Watchouts')
    default: return String(field || '')
  }
}

export function presetList() {
  return [
    {
      id: 'observer',
      icon: '👁',
      title: bi('只读旁观', 'Observer'),
      tag: bi('L0 · 关停 · 低思考', 'L0 · Off · Low'),
      desc: bi('零打扰零介入，只提供按需摘要与顾问建议，绝不触碰工作区。', 'Read-only observation with zero autonomous actions or edits.'),
    },
    {
      id: 'collab',
      icon: '🤝',
      title: bi('日常协作', 'Co-Pilot'),
      tag: bi('L2 · 巡检 · 红线哨兵', 'L2 · Patrol · Sentinel'),
      desc: bi('平时 0 Token 耗电，报错/撞墙再唤醒；重大操作逐项弹窗审批。', '0 idle cost; wakes on failures & walls with explicit approvals.'),
    },
    {
      id: 'away',
      icon: '🚀',
      title: bi('离桌托管', 'Away Mode'),
      tag: bi('L3 · 托管 · 30次/300K 熔断', 'L3 · Managed · Budget Cap'),
      desc: bi('高自主监督 + 80% 自动压缩 + 30次/300K 硬预算熔断 + 关键节点通知。', 'Supervised autopilot + 80% compact + 30-call/300K cap + alerts.'),
    },
  ]
}
