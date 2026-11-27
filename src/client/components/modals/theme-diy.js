/**
 * src/client/components/modals/theme-diy.js — 独立外观主题页 & 「自定义主题 DIY 工坊」
 *
 * 【核心职责】
 *   1. `ThemeStudioView`：独立整页主题工坊，包含「精选预设 (6 套含潮汐蓝)」与「DIY 工坊」双子页，
 *      顶部展示服务端 ~/.dsh/chief/ 多端同步状态（呼应 Issue #7）。
 *   2. `ThemeDiyWorkshop`（复用于独立工坊页与兼容弹窗 `CustomThemeModal`）：
 *      - 导入图片自动提色 + 原图壁纸半透明/模糊叠层；
 *      - 让参谋长 AI DIY（灵感芯片 + 风格描述 + 参考图）；
 *      - 4 槽精细调色、圆角/光晕/书卷体、配色 JSON 导入导出与实时双模预览 + 安全取消回滚。
 */

import { React, h } from '../../react-runtime.js'
import { UI_SKIN_OPTIONS } from '../../constants.js'
import { bi } from '../../i18n.js'
import { patch, saveUiSkin, saveCustomSkin } from '../../store.js'
import {
  DEFAULT_CUSTOM_SKIN,
  normalizeCustomSkinConfig,
  applyCustomSkinStyle,
  extractPaletteFromImageFile,
} from '../../custom-theme.js'
import { encodeImageForChief } from '../../utils.js'
import { designCustomThemeApi, copyText } from '../../api.js'
import { Icon } from '../common.js'

const AI_STYLE_INSPIRATIONS = [
  { labelZh: '赛博雨夜樱花', labelEn: 'Cyber Sakura', prompt: '赛博雨夜樱花霓虹，粉紫与青蓝撞色但不刺眼' },
  { labelZh: '京都雨抹茶', labelEn: 'Kyoto Matcha', prompt: '京都抹茶与原木古纸，书卷护眼松弛感' },
  { labelZh: '敦煌石青金', labelEn: 'Dunhuang', prompt: '敦煌飞天壁画石青配泥金朱砂，东方国风' },
  { labelZh: '北欧冰川极光', labelEn: 'Arctic Aurora', prompt: '北欧极简冰川晴蓝配极光薄荷绿，通透玻璃感' },
]

function applyDomSkinAttr(skinKey) {
  try {
    if (typeof document === 'undefined') return
    if (document.documentElement) document.documentElement.setAttribute('data-dnb-skin', skinKey)
    if (document.body) document.body.setAttribute('data-dnb-skin', skinKey)
    const panels = document.querySelectorAll('.dnb-panel')
    for (const p of panels) p.setAttribute('data-dnb-skin', skinKey)
  } catch {}
}

function ThemeDiyWorkshop({ view, embedded = false, active = true, onRequestClose, onCommitted }) {
  const [mode, setMode] = React.useState('image')
  const [draft, setDraft] = React.useState(() => normalizeCustomSkinConfig(view && view.customSkin))
  const [activeSlot, setActiveSlot] = React.useState('accentHex')
  const [extracted, setExtracted] = React.useState({ swatches: [], previewUrl: '', fileName: '' })
  const [paletteCursor, setPaletteCursor] = React.useState(0)
  const [dropOver, setDropOver] = React.useState(false)
  const [aiPrompt, setAiPrompt] = React.useState('')
  const [aiRefImage, setAiRefImage] = React.useState(null)
  const [aiRefSwatches, setAiRefSwatches] = React.useState([])
  const [aiBusy, setAiBusy] = React.useState(false)
  const [aiStatusNote, setAiStatusNote] = React.useState('')
  const [localError, setLocalError] = React.useState('')
  const [jsonBoxOpen, setJsonBoxOpen] = React.useState(false)
  const [jsonImportText, setJsonImportText] = React.useState('')

  const snapshotRef = React.useRef(null)
  const savedInSessionRef = React.useRef(false)
  const previewingCustomRef = React.useRef(!embedded)
  const imageInputRef = React.useRef(null)
  const aiImageInputRef = React.useRef(null)
  const pendingBlobRef = React.useRef(null)
  const draftPreviewUrlRef = React.useRef('')

  const revokeDraftPreviewUrl = () => {
    const u = draftPreviewUrlRef.current
    if (u && u.startsWith('blob:') && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      try { URL.revokeObjectURL(u) } catch {}
    }
    draftPreviewUrlRef.current = ''
  }

  const restoreSnapshot = () => {
    pendingBlobRef.current = null
    revokeDraftPreviewUrl()
    const snap = snapshotRef.current
    if (snap && (previewingCustomRef.current || !embedded)) {
      applyCustomSkinStyle(snap.prevCustom)
      applyDomSkinAttr(snap.prevSkin)
      saveUiSkin(snap.prevSkin)
    }
    previewingCustomRef.current = false
  }

  React.useEffect(() => {
    if (!active) return undefined
    const prevSkin = (view && view.uiSkin) || 'glass'
    const prevCustom = normalizeCustomSkinConfig(view && view.customSkin)
    snapshotRef.current = { prevSkin, prevCustom }
    savedInSessionRef.current = false
    const startPreview = !embedded || prevSkin === 'custom'
    previewingCustomRef.current = startPreview
    pendingBlobRef.current = null
    revokeDraftPreviewUrl()
    setDraft(prevCustom)
    setExtracted(prev => ({
      ...prev,
      previewUrl: prevCustom.bgImageUrl || '',
    }))
    setLocalError('')
    setAiStatusNote(prevCustom.moodNote || '')
    if (startPreview) {
      applyDomSkinAttr('custom')
      applyCustomSkinStyle(prevCustom)
    }
    return () => {
      if (!savedInSessionRef.current) restoreSnapshot()
    }
  }, [active])

  React.useEffect(() => {
    if (!active) return undefined
    if (previewingCustomRef.current) {
      applyDomSkinAttr('custom')
      applyCustomSkinStyle(draft)
    }
    return undefined
  }, [active, draft])

  React.useEffect(() => () => revokeDraftPreviewUrl(), [])

  if (!active) return null

  const cancelAndClose = () => {
    savedInSessionRef.current = false
    restoreSnapshot()
    if (typeof onRequestClose === 'function') onRequestClose()
  }

  const handleSaveAndApply = () => {
    const pendingBlob = pendingBlobRef.current
    pendingBlobRef.current = null
    const saved = saveCustomSkin(draft, {
      activate: true,
      wallpaperBlob: pendingBlob || undefined,
    })
    draftPreviewUrlRef.current = ''
    savedInSessionRef.current = true
    snapshotRef.current = { prevSkin: 'custom', prevCustom: saved }
    patch({
      notice: bi(`🎨 已应用并同步自定义主题「${saved.name}」`, `🎨 Custom theme applied & synced: ${saved.name}`),
    })
    if (typeof onCommitted === 'function') onCommitted(saved)
  }

  const handleExportColorJson = async () => {
    const payload = {
      name: draft.name,
      accentHex: draft.accentHex,
      secondaryHex: draft.secondaryHex,
      warmHex: draft.warmHex,
      bgTintHex: draft.bgTintHex,
      ambientGlow: draft.ambientGlow,
      radius: draft.radius,
      serifTitle: draft.serifTitle,
      moodNote: draft.moodNote,
    }
    const serialized = JSON.stringify(payload, null, 2)
    let copied = false
    try {
      if (typeof copyText === 'function') copied = Boolean(await copyText(serialized))
      else if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(serialized)
        copied = true
      }
    } catch {}
    setJsonImportText(serialized)
    setJsonBoxOpen(true)
    setAiStatusNote(
      copied
        ? bi('已复制纯净配色 JSON 到剪贴板（可直接跨设备粘贴导入）', 'Palette JSON copied to clipboard')
        : bi('已生成下方配色 JSON，可全选复制分享', 'Palette JSON generated below'),
    )
  }

  const handleImportColorJson = () => {
    const raw = String(jsonImportText || '').trim()
    if (!raw) {
      setLocalError(bi('请先粘贴主题配色 JSON', 'Paste theme palette JSON first'))
      return
    }
    try {
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setLocalError(bi('主题 JSON 必须是对象结构', 'Theme JSON must be an object'))
        return
      }
      setLocalError('')
      previewingCustomRef.current = true
      setDraft(prev => normalizeCustomSkinConfig({
        ...parsed,
        bgImageUrl: prev.bgImageUrl,
        bgImageStorage: prev.bgImageStorage,
        bgImageMeta: prev.bgImageMeta,
        bgImageEnabled: prev.bgImageEnabled,
        bgImageOpacity: prev.bgImageOpacity,
        bgImageBlur: prev.bgImageBlur,
        source: 'manual',
      }))
      setJsonBoxOpen(false)
      setAiStatusNote(bi('已导入配色 JSON 并实时预览，记得点「保存并应用」', 'Palette JSON loaded into live preview'))
    } catch {
      setLocalError(bi('JSON 格式无效，请检查括号或引号', 'Invalid JSON format'))
    }
  }

  const updateDraft = nextPartial => {
    previewingCustomRef.current = true
    setDraft(prev => normalizeCustomSkinConfig({ ...prev, ...(nextPartial || {}) }))
  }

  const applyCommunitySkin = opt => {
    if (!opt || !opt.key) return
    pendingBlobRef.current = null
    revokeDraftPreviewUrl()
    previewingCustomRef.current = false
    savedInSessionRef.current = true
    saveUiSkin(opt.key)
    applyDomSkinAttr(opt.key)
    snapshotRef.current = { prevSkin: opt.key, prevCustom: normalizeCustomSkinConfig(view && view.customSkin) }
    patch({ notice: bi('已切换主题：', 'Theme set to: ') + bi(opt.zh, opt.en) })
  }

  const applyExtractedWallpaper = res => {
    const previewUrl = res.previewObjectUrl || res.wallpaperUrl || ''
    if (previewUrl && previewUrl.startsWith('blob:') && previewUrl !== draftPreviewUrlRef.current) {
      revokeDraftPreviewUrl()
      draftPreviewUrlRef.current = previewUrl
    }
    pendingBlobRef.current = res.rawBlob || null
    const meta = (res.naturalWidth && res.naturalHeight)
      ? {
          width: res.naturalWidth,
          height: res.naturalHeight,
          sizeBytes: res.sizeBytes || 0,
          name: res.fileName || '',
        }
      : null
    return {
      previewUrl,
      patchFields: previewUrl
        ? {
            bgImageUrl: previewUrl,
            bgImageStorage: res.rawBlob ? 'idb' : 'inline',
            bgImageMeta: meta,
            bgImageEnabled: true,
          }
        : {},
    }
  }

  const handleExtractImage = async file => {
    if (!file) return
    setLocalError('')
    try {
      const res = await extractPaletteFromImageFile(file)
      const wp = applyExtractedWallpaper(res)
      setExtracted({
        swatches: res.swatches || [],
        previewUrl: wp.previewUrl,
        fileName: res.fileName || '',
      })
      setPaletteCursor(0)
      updateDraft({
        name: (res.fileName && res.fileName !== 'image') ? `${res.fileName.slice(0, 8)}·取色` : '画境拾色',
        accentHex: res.accentHex,
        secondaryHex: res.secondaryHex,
        warmHex: res.warmHex,
        bgTintHex: res.bgTintHex,
        ...wp.patchFields,
        source: 'image',
        moodNote: '已提取主色并加载高清原图半透明质感层',
      })
    } catch (err) {
      setLocalError(String((err && err.message) || err || '图片提色失败'))
    }
  }

  const rotateExtractedCombo = () => {
    const sw = extracted.swatches || []
    if (sw.length < 2) return
    const nextIdx = (paletteCursor + 1) % sw.length
    setPaletteCursor(nextIdx)
    const pick = offset => sw[(nextIdx + offset) % sw.length]
    updateDraft({
      accentHex: pick(0),
      secondaryHex: pick(1),
      warmHex: pick(Math.min(2, sw.length - 1)),
      bgTintHex: pick(Math.min(3, sw.length - 1)),
      source: 'image',
    })
  }

  const handleAttachAiRefImage = async file => {
    if (!file) return
    setLocalError('')
    try {
      const encoded = await encodeImageForChief(file)
      let sw = []
      let wp = null
      try {
        const pal = await extractPaletteFromImageFile(file)
        sw = pal.swatches || []
        wp = applyExtractedWallpaper(pal)
      } catch {}
      setAiRefImage(encoded)
      setAiRefSwatches(sw)
      if (wp && wp.previewUrl) {
        updateDraft(wp.patchFields)
        setExtracted(prev => ({ ...prev, previewUrl: wp.previewUrl }))
      }
    } catch (err) {
      setLocalError(String((err && err.message) || err || '加载参考图失败'))
    }
  }

  const handleAskChiefDiy = async (overridePrompt = '') => {
    if (aiBusy) return
    const usePrompt = String(overridePrompt || aiPrompt || '').trim()
    if (!usePrompt && !aiRefImage && extracted.swatches.length === 0) {
      setLocalError(bi('请先输入你想要的风格描述，或先附一张参考图', 'Describe your desired vibe or attach a reference image'))
      return
    }
    setLocalError('')
    setAiBusy(true)
    try {
      const res = await designCustomThemeApi({
        prompt: usePrompt,
        currentTheme: draft,
        images: aiRefImage ? [{ data: aiRefImage.data, mediaType: aiRefImage.mediaType, name: aiRefImage.name }] : [],
        extractedSwatches: aiRefSwatches.length > 0 ? aiRefSwatches : (extracted.swatches || []),
      })
      if (!res || res.ok === false || !res.theme) {
        setLocalError((res && res.error) || bi('参谋长定制主题失败', 'Failed to generate custom theme'))
      } else {
        updateDraft({
          ...res.theme,
          bgImageUrl: draft.bgImageUrl,
          bgImageStorage: draft.bgImageStorage,
          bgImageMeta: draft.bgImageMeta,
          bgImageEnabled: draft.bgImageEnabled,
          bgImageOpacity: draft.bgImageOpacity,
          bgImageBlur: draft.bgImageBlur,
          source: 'chief',
        })
        const tag = res.fallback
          ? bi('（已启用美学灵感引擎调色）', ' (Curated inspiration engine)')
          : (res.modelRef ? ` (${res.modelRef.split('/').pop()})` : '')
        setAiStatusNote(`${res.note || res.theme.moodNote || ''}${tag}`)
      }
    } catch (err) {
      setLocalError(String((err && err.message) || err || '请求失败'))
    } finally {
      setAiBusy(false)
    }
  }

  const handlePaste = e => {
    try {
      const items = e && e.clipboardData && e.clipboardData.items ? Array.from(e.clipboardData.items) : []
      const imgItem = items.find(it => it && it.kind === 'file' && /^image\//i.test(it.type || ''))
      if (!imgItem) return
      const file = imgItem.getAsFile()
      if (!file) return
      e.preventDefault()
      if (mode === 'chief') void handleAttachAiRefImage(file)
      else void handleExtractImage(file)
    } catch {}
  }

  const colorSlots = [
    { key: 'accentHex', zh: '主强调', en: 'Accent' },
    { key: 'secondaryHex', zh: '辅助绿', en: 'Secondary' },
    { key: 'warmHex', zh: '暖点缀', en: 'Warm' },
    { key: 'bgTintHex', zh: '底调锚', en: 'Bg Tint' },
  ]

  const communityOptions = UI_SKIN_OPTIONS.filter(o => o && o.community)
  const curActiveSkin = (view && view.uiSkin) || 'glass'

  const workshopBody = h(
    React.Fragment,
    null,
    // Community Contributed Themes inside DIY Workshop
    embedded && communityOptions.length > 0
      ? h(
          'div',
          { className: 'dnb-theme-community-box' },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 } },
            h('span', { style: { fontSize: 11.5, fontWeight: 600, color: 'var(--dnb-text-2)' } },
              bi('🌊 社区配色', '🌊 Community Themes')),
            h('span', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)' } },
              bi('直接启用深浅双模主题，或拿来微调', 'Apply directly or remix below')),
          ),
          communityOptions.map(opt => {
            const isCur = curActiveSkin === opt.key && !previewingCustomRef.current
            return h(
              'div',
              {
                key: opt.key,
                className: 'dnb-skin-card',
                'data-active': isCur ? '1' : '0',
                style: { cursor: 'default', padding: '8px 10px' },
              },
              h(
                'div',
                { className: 'dnb-skin-card-head', style: { flexWrap: 'wrap' } },
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } },
                  h('span', { className: 'dnb-skin-card-name' }, bi(opt.zh, opt.en)),
                  isCur
                    ? h('span', { className: 'dnb-acc-badge', 'data-tone': 'accent', style: { fontSize: 10 } }, bi('使用中', 'Active'))
                    : h('span', { className: 'dnb-skin-card-tag' }, bi(opt.tagZh, opt.tagEn)),
                ),
                h(
                  'div',
                  { className: 'dnb-skin-swatches' },
                  (opt.swatches || []).map(hex =>
                    h('span', { key: hex, className: 'dnb-skin-swatch-dot', style: { background: hex } })),
                ),
              ),
              h('div', { className: 'dnb-skin-card-desc' }, bi(opt.descZh, opt.descEn)),
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, marginTop: 3 } },
                h('button', {
                  type: 'button',
                  className: 'dnb-diy-chip',
                  onClick: () => {
                    updateDraft({ ...(opt.diySeed || {}), source: 'manual' })
                    setAiStatusNote(bi(`已将「${opt.zh}」色彩填入下方画板，可继续微调并保存`, `Loaded ${opt.en} into DIY editor below`))
                  },
                }, bi('拿来微调', 'Remix')),
                h('button', {
                  type: 'button',
                  className: isCur ? 'dnb-pill' : 'dnb-primary-btn',
                  disabled: isCur,
                  style: { height: 26, padding: '0 10px', fontSize: 11 },
                  onClick: () => applyCommunitySkin(opt),
                }, isCur ? bi('使用中', 'Active') : bi(`启用${opt.zh}`, `Use ${opt.en}`)),
              ),
            )
          }),
        )
      : null,

    // Mode switcher tabs
    h(
      'div',
      { className: 'dnb-diy-tabs' },
      h('button', {
        type: 'button',
        className: 'dnb-diy-tab',
        'data-active': mode === 'image' ? '1' : '0',
        onClick: () => setMode('image'),
      }, bi('🖼 导入图片调色', '🖼 Image Palette')),
      h('button', {
        type: 'button',
        className: 'dnb-diy-tab',
        'data-active': mode === 'chief' ? '1' : '0',
        onClick: () => setMode('chief'),
      }, bi('✨ 让参谋长 DIY', '✨ Ask Chief DIY')),
    ),

      // Mode 1: Import Image Palette Extraction (Zero-dep, instant)
      mode === 'image'
        ? h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
            h('input', {
              ref: imageInputRef,
              type: 'file',
              accept: 'image/*',
              style: { display: 'none' },
              onChange: e => {
                const file = e.target.files && e.target.files[0]
                e.target.value = ''
                void handleExtractImage(file)
              },
            }),
            h(
              'div',
              {
                className: 'dnb-diy-dropzone',
                'data-over': dropOver ? '1' : '0',
                onClick: () => imageInputRef.current && imageInputRef.current.click(),
                onDragOver: e => { e.preventDefault(); setDropOver(true) },
                onDragLeave: () => setDropOver(false),
                onDrop: e => {
                  e.preventDefault()
                  setDropOver(false)
                  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]
                  void handleExtractImage(file)
                },
              },
              extracted.previewUrl
                ? h('img', { src: extracted.previewUrl, alt: 'preview', className: 'dnb-diy-thumb' })
                : h(
                    'div',
                    {
                      style: {
                        width: 48,
                        height: 48,
                        borderRadius: 10,
                        background: 'var(--dnb-accent-soft)',
                        color: 'var(--dnb-accent)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      },
                    },
                    h(Icon, { name: 'image', size: 20 }),
                  ),
              h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 } },
                h('span', { style: { fontSize: 12, fontWeight: 550, color: 'var(--dnb-text)' } },
                  extracted.previewUrl
                    ? bi(`已提取：${extracted.fileName || '图片色卡'}（点此换图）`, `Loaded: ${extracted.fileName || 'image'} (click to replace)`)
                    : bi('点击选择 / 拖拽 / Ctrl+V 粘贴任意壁纸或截图', 'Drop, paste (Ctrl+V), or browse an image')),
                h('span', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', lineHeight: 1.4 } },
                  bi('本地毫秒级智能提色并自动校正深浅对比度，零 Token 消耗。', 'Instant local palette extraction with auto dark/light contrast.')),
              ),
            ),
            extracted.swatches.length > 0
              ? h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: 5 } },
                  h(
                    'div',
                    { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 } },
                    h('span', { style: { fontSize: 11, color: 'var(--dnb-text-3)' } },
                      bi(`提取到 ${extracted.swatches.length} 枚主色 · 点色卡填入当前选中槽位`, `${extracted.swatches.length} colors extracted · click to assign`)),
                    h('button', {
                      type: 'button',
                      className: 'dnb-diy-chip',
                      onClick: rotateExtractedCombo,
                    }, bi('🔀 换一组搭配', '🔀 Shuffle')),
                  ),
                  h(
                    'div',
                    { className: 'dnb-diy-swatch-row' },
                    extracted.swatches.map(hex =>
                      h(
                        'button',
                        {
                          key: hex,
                          type: 'button',
                          className: 'dnb-diy-swatch-chip',
                          title: bi(`点击将 ${hex} 设为当前槽位颜色`, `Use ${hex} for active slot`),
                          onClick: () => updateDraft({ [activeSlot]: hex, source: 'image' }),
                        },
                        h('span', { className: 'dnb-diy-swatch-dot', style: { background: hex } }),
                        h('span', null, hex),
                      )),
                  ),
                )
              : null,
          )
        : h(
            // Mode 2: Chief AI DIY Theme Designer
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
            h('input', {
              ref: aiImageInputRef,
              type: 'file',
              accept: 'image/*',
              style: { display: 'none' },
              onChange: e => {
                const file = e.target.files && e.target.files[0]
                e.target.value = ''
                void handleAttachAiRefImage(file)
              },
            }),
            h(
              'div',
              { className: 'dnb-diy-prompt-chips' },
              AI_STYLE_INSPIRATIONS.map(item =>
                h('button', {
                  key: item.labelEn,
                  type: 'button',
                  className: 'dnb-diy-chip',
                  onClick: () => {
                    setAiPrompt(item.prompt)
                    void handleAskChiefDiy(item.prompt)
                  },
                }, bi(item.labelZh, item.labelEn))),
            ),
            h('textarea', {
              className: 'dnb-input',
              rows: 2,
              value: aiPrompt,
              placeholder: bi('描述想要的氛围、IP 或色彩感，例如：赛博雨夜樱花、敦煌壁画金青、初音未来薄荷蓝…', 'Describe the vibe or aesthetic, e.g. Kyoto matcha, cyber sakura, Nordic glacier...'),
              style: { width: '100%', resize: 'vertical', fontSize: 12, padding: '8px 10px' },
              onChange: e => setAiPrompt(e.target.value),
              onKeyDown: e => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault()
                  void handleAskChiefDiy()
                }
              },
            }),
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' } },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                h('button', {
                  type: 'button',
                  className: 'dnb-pill',
                  style: { height: 28, padding: '0 10px', fontSize: 11 },
                  onClick: () => aiImageInputRef.current && aiImageInputRef.current.click(),
                }, aiRefImage ? bi('🖼 已附参考图', '🖼 Ref attached') : bi('📎 附参考图(可选)', '📎 Ref image (opt)')),
                aiRefImage
                  ? h('button', {
                      type: 'button',
                      className: 'dnb-ghost-btn',
                      onClick: () => { setAiRefImage(null); setAiRefSwatches([]) },
                    }, bi('移除', 'Clear'))
                  : null,
              ),
              h('button', {
                type: 'button',
                className: 'dnb-primary-btn',
                disabled: aiBusy,
                style: { height: 30, padding: '0 14px', fontSize: 11.5 },
                onClick: () => void handleAskChiefDiy(),
              }, aiBusy ? bi('✨ 参谋长调色中…', '✨ Designing…') : bi('✨ 让参谋长 DIY', '✨ Ask Chief to DIY')),
            ),
            aiStatusNote
              ? h('div', {
                  style: {
                    padding: '6px 9px',
                    borderRadius: 9,
                    background: 'var(--dnb-accent-soft)',
                    color: 'var(--dnb-accent)',
                    fontSize: 11,
                    lineHeight: 1.45,
                  },
                }, `🎨 ${aiStatusNote}`)
              : null,
          ),

      localError
        ? h('div', { style: { fontSize: 11, color: 'var(--dnb-coral)', padding: '4px 8px', borderRadius: 8, background: 'var(--dnb-coral-soft)' } }, localError)
        : null,

      // Shared fine-tune controls: Name + 4 Color Pickers + Radius / Glow / Serif
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 7, paddingTop: 4, borderTop: '1px solid var(--dnb-border)' } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', { style: { fontSize: 11, color: 'var(--dnb-text-3)', flexShrink: 0 } }, bi('主题命名', 'Name')),
          h('input', {
            type: 'text',
            className: 'dnb-input',
            value: draft.name,
            maxLength: 24,
            placeholder: bi('例如：夜樱私语', 'e.g. Velvet Dawn'),
            style: { flex: 1, height: 27, fontSize: 11.5, padding: '0 8px' },
            onChange: e => updateDraft({ name: e.target.value }),
          }),
        ),
        h(
          'div',
          { className: 'dnb-diy-color-grid' },
          colorSlots.map(slot => {
            const isSel = activeSlot === slot.key
            return h(
              'div',
              {
                key: slot.key,
                className: 'dnb-diy-slot-btn',
                'data-active': isSel ? '1' : '0',
                onClick: () => setActiveSlot(slot.key),
              },
              h('span', { style: { fontSize: 10.5 } }, bi(slot.zh, slot.en)),
              h('input', {
                type: 'color',
                className: 'dnb-diy-color-input',
                value: draft[slot.key],
                'aria-label': bi(slot.zh, slot.en),
                onChange: e => {
                  setActiveSlot(slot.key)
                  updateDraft({ [slot.key]: e.target.value, source: 'manual' })
                },
              }),
            )
          }),
        ),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 4 } },
            [
              { k: 'round', zh: '柔润圆角', en: 'Round' },
              { k: 'medium', zh: '均衡', en: 'Balanced' },
              { k: 'sharp', zh: '利落', en: 'Crisp' },
            ].map(r =>
              h('button', {
                key: r.k,
                type: 'button',
                className: 'dnb-diy-chip',
                style: draft.radius === r.k ? { borderColor: 'var(--dnb-accent)', background: 'var(--dnb-accent-soft)', color: 'var(--dnb-accent)', fontWeight: 600 } : null,
                onClick: () => updateDraft({ radius: r.k }),
              }, bi(r.zh, r.en))),
          ),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 5 } },
            h('button', {
              type: 'button',
              className: 'dnb-diy-chip',
              style: draft.ambientGlow ? { borderColor: 'var(--dnb-accent)', background: 'var(--dnb-accent-soft)', color: 'var(--dnb-accent)' } : null,
              onClick: () => updateDraft({ ambientGlow: !draft.ambientGlow }),
            }, bi('✨ 光晕', '✨ Glow')),
            h('button', {
              type: 'button',
              className: 'dnb-diy-chip',
              style: draft.serifTitle ? { borderColor: 'var(--dnb-accent)', background: 'var(--dnb-accent-soft)', color: 'var(--dnb-accent)' } : null,
              onClick: () => updateDraft({ serifTitle: !draft.serifTitle }),
            }, bi('Aa 书卷体', 'Aa Serif')),
          ),
        ),
        draft.bgImageUrl
          ? h(
              'div',
              { className: 'dnb-diy-bg-box' },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' } },
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: 5 } },
                  h('button', {
                    type: 'button',
                    className: 'dnb-diy-chip',
                    style: draft.bgImageEnabled
                      ? { borderColor: 'var(--dnb-accent)', background: 'var(--dnb-accent-soft)', color: 'var(--dnb-accent)', fontWeight: 600 }
                      : null,
                    onClick: () => updateDraft({ bgImageEnabled: !draft.bgImageEnabled }),
                  }, draft.bgImageEnabled ? bi('🖼 原图背景：已开启', '🖼 Backdrop: ON') : bi('🖼 原图背景：已关闭', '🖼 Backdrop: OFF')),
                  [
                    { zh: '清晰半透', en: 'Sheer', op: 0.24, blur: 0 },
                    { zh: '柔光毛玻璃', en: 'Frosted', op: 0.30, blur: 10 },
                    { zh: '梦幻柔焦', en: 'Dreamy', op: 0.42, blur: 22 },
                  ].map(p =>
                    h('button', {
                      key: p.en,
                      type: 'button',
                      className: 'dnb-diy-chip',
                      style: draft.bgImageEnabled && Math.abs(draft.bgImageOpacity - p.op) < 0.03 && draft.bgImageBlur === p.blur
                        ? { borderColor: 'var(--dnb-accent)', color: 'var(--dnb-accent)' }
                        : null,
                      onClick: () => updateDraft({ bgImageEnabled: true, bgImageOpacity: p.op, bgImageBlur: p.blur }),
                    }, bi(p.zh, p.en))),
                ),
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                  draft.bgImageMeta && draft.bgImageMeta.width > 0
                    ? h('span', { style: { fontSize: 10, color: 'var(--dnb-text-3)' } },
                        `${bi('原画', 'HD')} ${draft.bgImageMeta.width}×${draft.bgImageMeta.height}`)
                    : null,
                  h('button', {
                    type: 'button',
                    className: 'dnb-ghost-btn',
                    onClick: () => {
                      pendingBlobRef.current = null
                      revokeDraftPreviewUrl()
                      updateDraft({ bgImageUrl: '', bgImageStorage: '', bgImageMeta: null, bgImageEnabled: false })
                      setExtracted(prev => ({ ...prev, previewUrl: '' }))
                    },
                  }, bi('清除原图', 'Remove')),
                ),
              ),
              draft.bgImageEnabled
                ? h(
                    'div',
                    { className: 'dnb-diy-slider-grid' },
                    h(
                      'label',
                      { className: 'dnb-diy-slider-row' },
                      h('span', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', minWidth: 42 } }, bi('透明度', 'Opacity')),
                      h('input', {
                        type: 'range',
                        className: 'dnb-diy-range',
                        min: 6,
                        max: 80,
                        step: 1,
                        value: Math.round((draft.bgImageOpacity || 0.28) * 100),
                        onChange: e => updateDraft({ bgImageOpacity: Number(e.target.value) / 100 }),
                      }),
                      h('span', { style: { fontSize: 10.5, color: 'var(--dnb-text-2)', minWidth: 32, textAlign: 'right' } }, `${Math.round((draft.bgImageOpacity || 0.28) * 100)}%`),
                    ),
                    h(
                      'label',
                      { className: 'dnb-diy-slider-row' },
                      h('span', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', minWidth: 42 } }, bi('模糊度', 'Blur')),
                      h('input', {
                        type: 'range',
                        className: 'dnb-diy-range',
                        min: 0,
                        max: 32,
                        step: 1,
                        value: Math.round(draft.bgImageBlur ?? 10),
                        onChange: e => updateDraft({ bgImageBlur: Number(e.target.value) }),
                      }),
                      h('span', { style: { fontSize: 10.5, color: 'var(--dnb-text-2)', minWidth: 32, textAlign: 'right' } }, `${Math.round(draft.bgImageBlur ?? 10)}px`),
                    ),
                  )
                : null,
            )
          : h(
              'div',
              { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, fontSize: 10.5, color: 'var(--dnb-text-3)' } },
              h('span', null, bi('提示：导入图片后可叠加半透明 / 模糊原图作面板背景。', 'Tip: Upload an image to overlay a sheer or blurred backdrop.')),
              mode !== 'image'
                ? h('button', {
                    type: 'button',
                    className: 'dnb-diy-chip',
                    onClick: () => setMode('image'),
                  }, bi('+ 导入原图', '+ Add Image'))
                : null,
            ),
      ),

      // Palette JSON Export / Import (Issue #7 cross-device portability)
      h(
        'div',
        { className: 'dnb-theme-json-box' },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' } },
          h('span', { style: { fontSize: 11, color: 'var(--dnb-text-3)' } },
            bi('📦 配色 JSON 备份与跨端分享', '📦 Palette JSON Backup & Share')),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 5 } },
            h('button', {
              type: 'button',
              className: 'dnb-diy-chip',
              onClick: () => void handleExportColorJson(),
            }, bi('📋 复制配色 JSON', '📋 Copy JSON')),
            h('button', {
              type: 'button',
              className: 'dnb-diy-chip',
              onClick: () => setJsonBoxOpen(v => !v),
            }, jsonBoxOpen ? bi('收起导入框', 'Hide JSON') : bi('📥 导入配色 JSON', '📥 Import JSON')),
          ),
        ),
        jsonBoxOpen
          ? h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 } },
              h('textarea', {
                className: 'dnb-input',
                rows: 3,
                value: jsonImportText,
                placeholder: bi('在此粘贴配色 JSON（支持跨浏览器/跨主机迁移共享）…', 'Paste palette JSON here...'),
                style: { width: '100%', fontFamily: 'var(--dnb-font-mono, monospace)', fontSize: 11, padding: '6px 8px', resize: 'vertical' },
                onChange: e => setJsonImportText(e.target.value),
              }),
              h(
                'div',
                { style: { display: 'flex', justifyContent: 'flex-end', gap: 6 } },
                h('button', {
                  type: 'button',
                  className: 'dnb-pill',
                  style: { height: 26, fontSize: 11 },
                  onClick: handleImportColorJson,
                }, bi('解析并实时预览', 'Apply JSON Preview')),
              ),
            )
          : null,
      ),

      // Compact live mini preview
      h(
        'div',
        { className: 'dnb-diy-preview' },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11 } },
          h('span', { style: { fontFamily: 'var(--dnb-font-display)', fontWeight: 600, color: 'var(--dnb-text)' } },
            `${draft.name || bi('自定义主题', 'Custom')} · ${bi('实时双模预览', 'Live Preview')}`),
          h('span', { style: { color: 'var(--dnb-amber)', fontSize: 10.5 } }, '● ' + bi('暖徽章', 'Warm')),
        ),
        h(
          'div',
          { className: 'dnb-diy-preview-card' },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 6 } },
            h('span', {
              style: {
                padding: '2px 7px',
                borderRadius: 'var(--dnb-radius-pill)',
                background: 'var(--dnb-sage-soft)',
                color: 'var(--dnb-sage)',
                fontSize: 10.5,
                fontWeight: 500,
              },
            }, bi('推进正常', 'Active')),
            h('span', { style: { fontSize: 11, color: 'var(--dnb-text-2)' } }, bi('正文对照清晰', 'Readable text')),
          ),
          h('span', {
            style: {
              padding: '3px 9px',
              borderRadius: 'var(--dnb-radius-pill)',
              background: 'var(--dnb-primary-bg)',
              color: 'var(--dnb-primary-fg)',
              fontSize: 10.5,
              fontWeight: 600,
            },
          }, bi('主按钮', 'Primary')),
        ),
      ),

      // Footer
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingTop: 2, flexWrap: 'wrap' } },
        h('button', {
          type: 'button',
          className: 'dnb-ghost-btn',
          onClick: () => {
            pendingBlobRef.current = null
            revokeDraftPreviewUrl()
            setDraft(normalizeCustomSkinConfig(DEFAULT_CUSTOM_SKIN))
            setExtracted({ swatches: [], previewUrl: '', fileName: '' })
            setAiStatusNote('')
            setLocalError('')
          },
        }, bi('恢复默认', 'Reset')),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 6 } },
          h('button', {
            type: 'button',
            className: 'dnb-pill',
            onClick: cancelAndClose,
          }, embedded ? bi('取消回滚', 'Revert') : bi('取消', 'Cancel')),
          h('button', {
            type: 'button',
            className: 'dnb-primary-btn',
            onClick: handleSaveAndApply,
          }, bi('保存并应用', 'Save & Apply')),
        ),
      ),
  )

  if (embedded) {
    return h(
      'div',
      {
        className: 'dnb-theme-diy-embedded',
        onPaste: handlePaste,
      },
      workshopBody,
    )
  }

  return h(
    'div',
    {
      className: 'dnb-modal-backdrop',
      onClick: cancelAndClose,
      onPaste: handlePaste,
    },
    h(
      'div',
      {
        className: 'dnb-modal-card dnb-diy-modal',
        role: 'dialog',
        'aria-label': bi('自定义主题 DIY 工坊', 'Custom Theme DIY Studio'),
        onClick: e => e.stopPropagation(),
      },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 7 } },
          h(Icon, { name: 'palette', size: 15, style: { color: 'var(--dnb-accent)' } }),
          h('span', { style: { fontSize: 13.5, fontWeight: 600, color: 'var(--dnb-text)' } },
            bi('自定义主题 DIY 工坊', 'Custom Theme DIY Studio')),
        ),
        h('button', {
          type: 'button',
          className: 'dnb-ghost-btn',
          'aria-label': bi('关闭', 'Close'),
          onClick: cancelAndClose,
        }, '×'),
      ),
      workshopBody,
    ),
  )
}

export function CustomThemeModal({ view }) {
  const open = Boolean(view && view.customThemeModalOpen)
  if (!open) return null
  return h(ThemeDiyWorkshop, {
    view,
    embedded: false,
    active: open,
    onRequestClose: () => patch({ customThemeModalOpen: false }),
    onCommitted: () => patch({ customThemeModalOpen: false }),
  })
}

export function ThemeStudioView({ view }) {
  const activeSkin = (view && view.uiSkin) || 'glass'
  const studioTab = (view && view.themeStudioTab) === 'diy' ? 'diy' : 'presets'
  const presetOptions = UI_SKIN_OPTIONS.filter(o => o && o.key !== 'custom' && !o.community)
  const communityOptions = UI_SKIN_OPTIONS.filter(o => o && o.community)
  const activeCommunity = communityOptions.find(o => o.key === activeSkin) || null
  const customOpt = UI_SKIN_OPTIONS.find(o => o && o.key === 'custom')
  const cSkin = (view && view.customSkin) || {}
  const hasSavedCustom = Number(cSkin.updatedAt) > 0
  const customDisplayName = hasSavedCustom ? cSkin.name : bi((customOpt && customOpt.zh) || '自定义 DIY', (customOpt && customOpt.en) || 'Custom DIY')
  const customSwatches = Array.isArray(cSkin.swatches) && cSkin.swatches.length === 3
    ? cSkin.swatches
    : ((customOpt && customOpt.swatches) || ['#8b7cf6', '#5cc9a7', '#f0b868'])

  return h(
    'div',
    { className: 'dnb-view dnb-theme-studio' },
    // Dedicated Top Header with compact sync label
    h(
      'div',
      { className: 'dnb-settings-bar' },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flexWrap: 'wrap' } },
        h(Icon, { name: 'palette', size: 14, style: { color: 'var(--dnb-accent)', flexShrink: 0 } }),
        h('span', { style: { fontSize: 12.5, fontWeight: 600, color: 'var(--dnb-text)' } },
          bi('外观与主题工坊', 'Appearance & Theme Studio')),
        h('span', { style: { fontSize: 11, color: 'var(--dnb-text-3)', fontWeight: 400 } },
          bi('· 主题多端同步', '· Synced across devices')),
      ),
      h('button', {
        type: 'button',
        className: 'dnb-pill',
        style: { height: 22, padding: '0 8px', fontSize: 11 },
        onClick: () => patch({ themeOpen: false }),
      }, bi('← 返回', '← Back')),
    ),

    // Segmented Sub-Tab Bar: Curated Presets (5) vs DIY Workshop
    h(
      'div',
      { className: 'dnb-seg', style: { marginBottom: 4 } },
      h('button', {
        type: 'button',
        className: 'dnb-seg-btn',
        'data-active': studioTab === 'presets' ? '1' : '0',
        onClick: () => patch({ themeStudioTab: 'presets' }),
      }, bi(`🎨 精选预设 (${presetOptions.length})`, `🎨 Presets (${presetOptions.length})`)),
      h('button', {
        type: 'button',
        className: 'dnb-seg-btn',
        'data-active': studioTab === 'diy' ? '1' : '0',
        onClick: () => patch({ themeStudioTab: 'diy' }),
      }, bi('✨ DIY 工坊', '✨ DIY Workshop')),
    ),

    studioTab === 'presets'
      ? h(
          React.Fragment,
          null,
          h(
            'div',
            { className: 'dnb-skin-grid' },
            presetOptions.map(opt => {
              const isCur = activeSkin === opt.key
              return h(
                'button',
                {
                  key: opt.key,
                  type: 'button',
                  className: 'dnb-skin-card',
                  'data-active': isCur ? '1' : '0',
                  onClick: () => {
                    saveUiSkin(opt.key)
                    patch({ notice: bi('已切换主题：', 'Theme set to: ') + bi(opt.zh, opt.en) })
                  },
                },
                h(
                  'div',
                  { className: 'dnb-skin-card-head' },
                  h(
                    'div',
                    { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } },
                    h('span', { className: 'dnb-skin-card-name' }, bi(opt.zh, opt.en)),
                    isCur
                      ? h('span', { className: 'dnb-acc-badge', 'data-tone': 'accent', style: { fontSize: 10 } }, bi('使用中', 'Active'))
                      : h('span', { className: 'dnb-skin-card-tag' }, bi(opt.tagZh, opt.tagEn)),
                  ),
                  h(
                    'div',
                    { className: 'dnb-skin-swatches' },
                    (opt.swatches || []).map(hex =>
                      h('span', { key: hex, className: 'dnb-skin-swatch-dot', style: { background: hex } })),
                  ),
                ),
                h('div', { className: 'dnb-skin-card-desc' }, bi(opt.descZh, opt.descEn)),
              )
            }),
          ),

          // Dedicated DIY Workshop Launch Card
          h(
            'div',
            {
              className: 'dnb-skin-card dnb-theme-diy-banner',
              'data-active': (activeSkin === 'custom' || activeCommunity) ? '1' : '0',
              style: { cursor: 'default' },
            },
            h(
              'div',
              { className: 'dnb-skin-card-head', style: { flexWrap: 'wrap' } },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 } },
                h(Icon, { name: 'sparkles', size: 14, style: { color: 'var(--dnb-accent)', flexShrink: 0 } }),
                h('span', { className: 'dnb-skin-card-name' },
                  activeCommunity
                    ? bi(`✨ DIY 工坊 · 社区配色「${activeCommunity.zh}」`, `✨ DIY Workshop · ${activeCommunity.en}`)
                    : (hasSavedCustom
                        ? bi(`✨ 自定义 DIY · ${customDisplayName}`, `✨ Custom DIY · ${customDisplayName}`)
                        : bi('✨ 自定义 DIY 主题工坊', '✨ Custom DIY Theme Workshop'))),
                (activeSkin === 'custom' || activeCommunity)
                  ? h('span', { className: 'dnb-acc-badge', 'data-tone': 'accent', style: { fontSize: 10 } }, bi('使用中', 'Active'))
                  : null,
              ),
              h(
                'div',
                { className: 'dnb-skin-swatches' },
                (activeCommunity ? activeCommunity.swatches : customSwatches).map((hex, idx) =>
                  h('span', { key: `${hex}-${idx}`, className: 'dnb-skin-swatch-dot', style: { background: hex } })),
              ),
            ),
            h('div', { className: 'dnb-skin-card-desc' },
              bi('含社区配色、导入图片提色、让参谋长 AI 调色、4 槽色盘与配色 JSON 备份。',
                'Includes community themes, image palette extraction, Chief AI DIY & palette JSON.')),
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, marginTop: 4, flexWrap: 'wrap' } },
              hasSavedCustom && activeSkin !== 'custom'
                ? h('button', {
                    type: 'button',
                    className: 'dnb-pill',
                    style: { height: 26, padding: '0 10px', fontSize: 11 },
                    onClick: () => {
                      saveUiSkin('custom')
                      patch({ notice: bi('已启用自定义主题：', 'Custom theme enabled: ') + customDisplayName })
                    },
                  }, bi('启用当前 DIY', 'Use Saved DIY'))
                : null,
              h('button', {
                type: 'button',
                className: 'dnb-primary-btn',
                style: { height: 28, padding: '0 12px', fontSize: 11 },
                onClick: () => patch({ themeStudioTab: 'diy' }),
              }, bi('进入 DIY 工坊 →', 'Open DIY Workshop →')),
            ),
          ),
        )
      : h(ThemeDiyWorkshop, {
          view,
          embedded: true,
          active: studioTab === 'diy',
          onRequestClose: () => patch({ themeStudioTab: 'presets' }),
          onCommitted: () => patch({ themeStudioTab: 'presets' }),
        }),
  )
}
