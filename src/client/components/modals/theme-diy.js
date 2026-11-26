/**
 * src/client/components/modals/theme-diy.js — 「自定义主题 DIY 工坊」弹窗
 *
 * 【核心职责】
 *   支持两种零门槛自定义主题途径，并带实时整面板预览与安全取消回滚：
 *     1. 🖼 导入图片调色（纯前端 Canvas 提取 6 枚主色色卡，0 Token，点击色块/换一组实时换肤）；
 *     2. ✨ 参谋长 AI DIY（输入风格描述 + 可选传参考图，调用 `op: 'theme.diy'` 由参谋长生成和谐双模配色）。
 */

import { React, h } from '../../react-runtime.js'
import { bi } from '../../i18n.js'
import { patch, saveUiSkin, saveCustomSkin } from '../../store.js'
import {
  DEFAULT_CUSTOM_SKIN,
  normalizeCustomSkinConfig,
  applyCustomSkinStyle,
  extractPaletteFromImageFile,
} from '../../custom-theme.js'
import { encodeImageForChief } from '../../utils.js'
import { designCustomThemeApi } from '../../api.js'
import { Icon } from '../common.js'

const AI_STYLE_INSPIRATIONS = [
  { labelZh: '赛博雨夜樱花', labelEn: 'Cyber Sakura', prompt: '赛博雨夜樱花霓虹，粉紫与青蓝撞色但不刺眼' },
  { labelZh: '京都雨抹茶', labelEn: 'Kyoto Matcha', prompt: '京都抹茶与原木古纸，书卷护眼松弛感' },
  { labelZh: '敦煌石青金', labelEn: 'Dunhuang', prompt: '敦煌飞天壁画石青配泥金朱砂，东方国风' },
  { labelZh: '北欧冰川极光', labelEn: 'Arctic Aurora', prompt: '北欧极简冰川晴蓝配极光薄荷绿，通透玻璃感' },
]

export function CustomThemeModal({ view }) {
  const open = Boolean(view && view.customThemeModalOpen)
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

  const snapshotRef = React.useRef(null)
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

  React.useEffect(() => {
    if (!open) return undefined
    const prevSkin = (view && view.uiSkin) || 'glass'
    const prevCustom = normalizeCustomSkinConfig(view && view.customSkin)
    snapshotRef.current = { prevSkin, prevCustom }
    pendingBlobRef.current = null
    revokeDraftPreviewUrl()
    setDraft(prevCustom)
    setExtracted(prev => ({
      ...prev,
      previewUrl: prevCustom.bgImageUrl || '',
    }))
    setLocalError('')
    setAiStatusNote(prevCustom.moodNote || '')
    try {
      if (typeof document !== 'undefined') {
        if (document.documentElement) document.documentElement.setAttribute('data-dnb-skin', 'custom')
        if (document.body) document.body.setAttribute('data-dnb-skin', 'custom')
        const panels = document.querySelectorAll('.dnb-panel')
        for (const p of panels) p.setAttribute('data-dnb-skin', 'custom')
      }
      applyCustomSkinStyle(prevCustom)
    } catch {}
    return undefined
  }, [open])

  React.useEffect(() => {
    if (!open) return undefined
    applyCustomSkinStyle(draft)
    return undefined
  }, [open, draft])

  React.useEffect(() => () => revokeDraftPreviewUrl(), [])

  if (!open) return null

  const cancelAndClose = () => {
    pendingBlobRef.current = null
    revokeDraftPreviewUrl()
    const snap = snapshotRef.current
    if (snap) {
      applyCustomSkinStyle(snap.prevCustom)
      try {
        if (typeof document !== 'undefined') {
          if (document.documentElement) document.documentElement.setAttribute('data-dnb-skin', snap.prevSkin)
          if (document.body) document.body.setAttribute('data-dnb-skin', snap.prevSkin)
          const panels = document.querySelectorAll('.dnb-panel')
          for (const p of panels) p.setAttribute('data-dnb-skin', snap.prevSkin)
        }
      } catch {}
      saveUiSkin(snap.prevSkin)
    }
    patch({ customThemeModalOpen: false })
  }

  const updateDraft = nextPartial => {
    setDraft(prev => normalizeCustomSkinConfig({ ...prev, ...(nextPartial || {}) }))
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

  const handleSaveAndApply = () => {
    const pendingBlob = pendingBlobRef.current
    pendingBlobRef.current = null
    const saved = saveCustomSkin(draft, {
      activate: true,
      wallpaperBlob: pendingBlob || undefined,
    })
    draftPreviewUrlRef.current = ''
    patch({
      customThemeModalOpen: false,
      notice: bi(`🎨 已应用自定义主题「${saved.name}」`, `🎨 Custom theme applied: ${saved.name}`),
    })
  }

  const colorSlots = [
    { key: 'accentHex', zh: '主强调', en: 'Accent' },
    { key: 'secondaryHex', zh: '辅助绿', en: 'Secondary' },
    { key: 'warmHex', zh: '暖点缀', en: 'Warm' },
    { key: 'bgTintHex', zh: '底调锚', en: 'Bg Tint' },
  ]

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
      // Header
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
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingTop: 2 } },
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
          }, bi('取消', 'Cancel')),
          h('button', {
            type: 'button',
            className: 'dnb-primary-btn',
            onClick: handleSaveAndApply,
          }, bi('保存并应用', 'Save & Apply')),
        ),
      ),
    ),
  )
}
