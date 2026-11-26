/**
 * chief-theme-diy.js — 参谋长「自定义 DIY 主题配色」后端引擎
 *
 * 【核心职责】
 *   响应 `POST /api/dsh-chief/chief/fact` (`op: 'theme.diy'`)，根据用户描述、可选参考图或前端提取色卡，
 *   调用参谋长辅助模型生成结构化高定主题配色（`accentHex` / `secondaryHex` / `warmHex` / `bgTintHex` / 圆角 / 衬线），
 *   并在无模型/离线环境下提供高审美东方与潮流语义兜底方案。
 *
 * 【安全与隔离边界】
 *   - 零外部 npm 依赖，不改动 `chief.js` 67 项门面导出，不增加 HTTP 路由；
 *   - 严格保持 0 字节 `@lead` 隔离：绝不写 `board`、`facts` 或向主对话注入任何消息；
 *   - 所有输出 Hex 色值经过严格白名单校验，防止 CSS 注入。
 */

import { callChiefLlm } from './chief-models.js'
import { admitChiefImages } from './chief-state.js'

const HEX6_RE = /^#([0-9a-fA-F]{6})$/
const HEX3_RE = /^#([0-9a-fA-F]{3})$/

const DEFAULT_DIY_THEME = {
  name: '流光定制',
  accentHex: '#8b7cf6',
  secondaryHex: '#5cc9a7',
  warmHex: '#f0b868',
  bgTintHex: '#171928',
  ambientGlow: true,
  radius: 'round',
  serifTitle: false,
  moodNote: '清透柔和的双模协调配色，兼具辨识度与长时间阅读舒适感。',
  source: 'chief',
}

export function sanitizeThemeHex(raw, fallback = '#8b7cf6') {
  const s = String(raw || '').trim()
  if (HEX6_RE.test(s)) return s.toLowerCase()
  const m3 = s.match(HEX3_RE)
  if (m3) {
    const [r, g, b] = m3[1].split('')
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  return HEX6_RE.test(String(fallback || '')) ? String(fallback).toLowerCase() : '#8b7cf6'
}

function normalizeRadius(raw) {
  const s = String(raw || '').trim().toLowerCase()
  if (s === 'sharp' || s === 'medium' || s === 'round') return s
  return 'round'
}

export function sanitizeThemePayload(raw, fallback = DEFAULT_DIY_THEME) {
  const fb = fallback && typeof fallback === 'object' ? fallback : DEFAULT_DIY_THEME
  const src = raw && typeof raw === 'object' ? raw : {}
  const nameRaw = String(src.name || '').replace(/[\r\n<>"{}]/g, ' ').replace(/\s+/g, ' ').trim()
  const noteRaw = String(src.moodNote || src.note || '').replace(/[\r\n<>]/g, ' ').replace(/\s+/g, ' ').trim()
  return {
    name: (nameRaw || fb.name || DEFAULT_DIY_THEME.name).slice(0, 24),
    accentHex: sanitizeThemeHex(src.accentHex, fb.accentHex || DEFAULT_DIY_THEME.accentHex),
    secondaryHex: sanitizeThemeHex(src.secondaryHex, fb.secondaryHex || DEFAULT_DIY_THEME.secondaryHex),
    warmHex: sanitizeThemeHex(src.warmHex, fb.warmHex || DEFAULT_DIY_THEME.warmHex),
    bgTintHex: sanitizeThemeHex(src.bgTintHex, fb.bgTintHex || DEFAULT_DIY_THEME.bgTintHex),
    ambientGlow: typeof src.ambientGlow === 'boolean' ? src.ambientGlow : (fb.ambientGlow !== false),
    radius: normalizeRadius(src.radius || fb.radius),
    serifTitle: typeof src.serifTitle === 'boolean' ? src.serifTitle : Boolean(fb.serifTitle),
    moodNote: (noteRaw || fb.moodNote || DEFAULT_DIY_THEME.moodNote).slice(0, 120),
    source: 'chief',
  }
}

const CURATED_PRESETS = [
  {
    re: /(樱花|sakura|peach|桃|莓|粉|恋|春|ros|blossom)/i,
    theme: {
      name: '春樱微醺',
      accentHex: '#ea8ca8',
      secondaryHex: '#7bc6b5',
      warmHex: '#f1c27d',
      bgTintHex: '#1f1722',
      ambientGlow: true,
      radius: 'round',
      serifTitle: false,
      moodNote: '绯樱粉作主强调，薄荷青绿平衡甜度，暮紫微尘托底。',
    },
  },
  {
    re: /(赛博|霓虹|cyber|neon|未来|电音|机甲|夜城|vapor|synth)/i,
    theme: {
      name: '赛博夜霓虹',
      accentHex: '#ff5ea8',
      secondaryHex: '#38e8d4',
      warmHex: '#f7c95c',
      bgTintHex: '#121528',
      ambientGlow: true,
      radius: 'medium',
      serifTitle: false,
      moodNote: '电光品红撞击青碧湖蓝，克制柔化眩光以保障长看护眼。',
    },
  },
  {
    re: /(敦煌|壁画|飞天|金青|青金|千里江山|故宫|朱红|国风|古风|东方|墨)/i,
    theme: {
      name: '敦煌石青金',
      accentHex: '#4fa3b8',
      secondaryHex: '#d87c5a',
      warmHex: '#dfb462',
      bgTintHex: '#17191c',
      ambientGlow: false,
      radius: 'medium',
      serifTitle: true,
      moodNote: '石青为骨、朱砂为缀、泥金点睛，搭配衬线标题呈书画卷气。',
    },
  },
  {
    re: /(抹茶|京都|茶|竹|森|森林|moss|matcha|sage|jade|翡翠|绿)/i,
    theme: {
      name: '京都雨抹茶',
      accentHex: '#73b48c',
      secondaryHex: '#d4a36a',
      warmHex: '#e2c278',
      bgTintHex: '#141a16',
      ambientGlow: false,
      radius: 'medium',
      serifTitle: true,
      moodNote: '宇治抹茶青映衬原木琥珀，低噪护眼适合专注深思。',
    },
  },
  {
    re: /(冰川|极光|海|深海|星海|蔚蓝|海洋|ocean|ice|arctic|nordic|蓝|雪)/i,
    theme: {
      name: '北欧极光蓝',
      accentHex: '#6eb5f7',
      secondaryHex: '#5fd4be',
      warmHex: '#e9be78',
      bgTintHex: '#121924',
      ambientGlow: true,
      radius: 'round',
      serifTitle: false,
      moodNote: '冰川晴蓝与极光薄荷青交织，通透清冽而富有呼吸感。',
    },
  },
  {
    re: /(日落|落日|晚霞|琥珀|秋|焦糖|咖啡|拿铁|奶茶|暖|autumn|sunset|latte)/i,
    theme: {
      name: '暮色焦糖霞',
      accentHex: '#e0895c',
      secondaryHex: '#84b59f',
      warmHex: '#eab76a',
      bgTintHex: '#1c1614',
      ambientGlow: true,
      radius: 'round',
      serifTitle: true,
      moodNote: '暖阳陶土橙与烘焙琥珀层层过渡，仿佛黄昏窗边阅读时刻。',
    },
  },
  {
    re: /(黑金|曜石|极简|黑白|高端|商务|奢侈|obsidian|gold|minimal)/i,
    theme: {
      name: '曜石鎏金',
      accentHex: '#d9b56c',
      secondaryHex: '#72b8a8',
      warmHex: '#f0ca7d',
      bgTintHex: '#131418',
      ambientGlow: false,
      radius: 'sharp',
      serifTitle: false,
      moodNote: '克制曜石底调镶以哑光香槟金，线条利落高阶。',
    },
  },
  {
    re: /(紫|熏衣草|薰衣草|星空|梦境|魔法|星云|violet|lavender|nebula)/i,
    theme: {
      name: '星云薰衣草',
      accentHex: '#b18df8',
      secondaryHex: '#6dd2be',
      warmHex: '#f2bd79',
      bgTintHex: '#171527',
      ambientGlow: true,
      radius: 'round',
      serifTitle: false,
      moodNote: '暮紫星云为主调，薄荷青与暖星金点亮层次而不喧宾夺主。',
    },
  },
]

function hslToHexServer(hDeg, sPct, lPct) {
  const h = ((Number(hDeg) % 360) + 360) % 360
  const s = Math.max(0, Math.min(100, Number(sPct))) / 100
  const l = Math.max(0, Math.min(100, Number(lPct))) / 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const toHex = v => Math.round(Math.max(0, Math.min(255, (v + m) * 255))).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function buildFallbackTheme(prompt = '', extractedSwatches = []) {
  const cleanPrompt = String(prompt || '').trim()
  const validSwatches = (Array.isArray(extractedSwatches) ? extractedSwatches : [])
    .map(c => sanitizeThemeHex(c, ''))
    .filter(Boolean)

  for (const preset of CURATED_PRESETS) {
    if (cleanPrompt && preset.re.test(cleanPrompt)) {
      const base = { ...preset.theme }
      if (validSwatches.length >= 2) {
        base.secondaryHex = validSwatches[1]
      }
      return sanitizeThemePayload(base)
    }
  }

  if (validSwatches.length >= 1) {
    return sanitizeThemePayload({
      name: cleanPrompt ? cleanPrompt.slice(0, 12) : '灵感拾色定制',
      accentHex: validSwatches[0],
      secondaryHex: validSwatches[1] || '#62ccb1',
      warmHex: validSwatches[2] || '#eeb868',
      bgTintHex: validSwatches[3] || '#171926',
      ambientGlow: true,
      radius: 'round',
      serifTitle: false,
      moodNote: cleanPrompt
        ? `依据「${cleanPrompt.slice(0, 20)}」与提取色卡调和而成的专属双模配色。`
        : '依据参考图主色盘智能协调，兼顾深浅模式辨识度。',
    })
  }

  // Deterministic pleasant hue from prompt string
  let hash = 2166136261
  const seed = cleanPrompt || 'default-harmony'
  for (let i = 0; i < seed.length; i += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619)
  }
  const hue = Math.abs(hash) % 360
  return sanitizeThemePayload({
    name: cleanPrompt ? cleanPrompt.slice(0, 12) : '灵感调色盘',
    accentHex: hslToHexServer(hue, 72, 66),
    secondaryHex: hslToHexServer((hue + 142) % 360, 56, 62),
    warmHex: hslToHexServer((hue + 38) % 360, 74, 68),
    bgTintHex: hslToHexServer(hue, 24, 14),
    ambientGlow: true,
    radius: 'round',
    serifTitle: false,
    moodNote: cleanPrompt
      ? `由灵感词「${cleanPrompt.slice(0, 24)}」生成的和谐三色高定主题。`
      : '高对比柔和双模配色，随深浅宿主自动适配。',
  })
}

function extractJsonObject(rawText = '') {
  const s = String(rawText || '').trim()
  if (!s) return null
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fence ? fence[1].trim() : s
  const first = candidate.indexOf('{')
  const last = candidate.lastIndexOf('}')
  if (first < 0 || last <= first) return null
  try {
    return JSON.parse(candidate.slice(first, last + 1))
  } catch {
    return null
  }
}

export async function designCustomThemeWithChief(deps, opts = {}) {
  const sessionId = typeof opts.sessionId === 'string' ? opts.sessionId.trim() : ''
  const rawPrompt = typeof opts.prompt === 'string' ? opts.prompt.trim().slice(0, 400) : ''
  const extractedSwatches = Array.isArray(opts.extractedSwatches)
    ? opts.extractedSwatches.map(c => sanitizeThemeHex(c, '')).filter(Boolean).slice(0, 8)
    : []
  const currentTheme = opts.currentTheme && typeof opts.currentTheme === 'object' ? opts.currentTheme : null
  const fallback = buildFallbackTheme(rawPrompt, extractedSwatches)

  if (!rawPrompt && extractedSwatches.length === 0 && (!Array.isArray(opts.images) || opts.images.length === 0)) {
    return {
      ok: true,
      fallback: true,
      theme: fallback,
      note: fallback.moodNote,
    }
  }

  let imageBlocks = []
  const rawImages = Array.isArray(opts.images) ? opts.images.slice(0, 1) : []
  if (rawImages.length > 0 && deps) {
    try {
      imageBlocks = await admitChiefImages(deps, rawImages)
    } catch {
      imageBlocks = []
    }
  }

  const system = [
    '你是 DSH 参谋长的顶级 UI 视觉与色彩总监。用户希望你为其打造一套专属面板视觉主题（需同时适配深色与浅色双模式，柔和护眼不刺眼）。',
    '你必须只返回严格合法的单个 JSON 对象，不要附加多余解释或 Markdown 前后缀。JSON 字段规范如下：',
    '{',
    '  "name": "简洁优雅的2~8字中文主题名",',
    '  "accentHex": "#xxxxxx（主强调色，鲜明但不刺眼，避免纯荧光高亮）",',
    '  "secondaryHex": "#xxxxxx（次级语义/成功色，与主色形成舒服对比）",',
    '  "warmHex": "#xxxxxx（暖色高光/徽章点缀色）",',
    '  "bgTintHex": "#xxxxxx（低饱和深色底调锚点色相，例如 #171928）",',
    '  "ambientGlow": true或false（是否开启背景柔光晕）,",',
    '  "radius": "round" | "medium" | "sharp"（圆角气质）,',
    '  "serifTitle": true或false（标题是否使用书卷衬线体）,',
    '  "moodNote": "一句话说明这套配色的氛围与色彩巧思（不超过45字）"',
    '}',
  ].join('\n')

  const promptLines = [
    rawPrompt ? `用户氛围描述：${rawPrompt}` : '用户希望你根据附图或色卡自由设计一套高质感配色。',
    extractedSwatches.length ? `参考图片已提取的候选色卡：${extractedSwatches.join(', ')}` : '',
    currentTheme && currentTheme.name ? `当前参考主题：${String(currentTheme.name).slice(0, 24)} (${sanitizeThemeHex(currentTheme.accentHex, '')})` : '',
    '请直接输出 JSON 对象。',
  ].filter(Boolean)

  try {
    const llmRes = await callChiefLlm(deps, {
      sessionId,
      system,
      prompt: promptLines.join('\n'),
      maxTokens: 600,
      imageBlocks,
      allowTextFallbackOnVisionMiss: true,
      reasonKind: 'theme_diy',
      userText: rawPrompt || 'DIY 自定义主题配色',
    })
    if (llmRes && llmRes.ok && llmRes.text) {
      const parsed = extractJsonObject(llmRes.text)
      if (parsed && typeof parsed === 'object') {
        const theme = sanitizeThemePayload(parsed, fallback)
        return {
          ok: true,
          fallback: false,
          modelRef: llmRes.modelRef || '',
          degradedToTextOnly: Boolean(llmRes.degradedToTextOnly),
          theme,
          note: theme.moodNote,
        }
      }
    }
    return {
      ok: true,
      fallback: true,
      fallbackReason: (llmRes && llmRes.error) || '已启用内置美学灵感引擎生成',
      theme: fallback,
      note: fallback.moodNote,
    }
  } catch (err) {
    return {
      ok: true,
      fallback: true,
      fallbackReason: String(err && err.message ? err.message : err),
      theme: fallback,
      note: fallback.moodNote,
    }
  }
}
