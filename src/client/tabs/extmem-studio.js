/**
 * tabs/extmem-studio.js — 记忆工作台三大核心子视图：参谋日记本、用户画像、提示词工坊
 *
 * 【边界约定】
 *   - 严格保持对 `@lead` 的 0 字节隔离（全部读取与修改只通过 `ext_mem.*` 私有接口）；
 *   - 所有顶层声明采用唯一 `ExtMem*` / `EXTMEM_*` 命名，不与其他客户端模块冲突。
 */

import { React, h } from '../react-runtime.js'
import { bi } from '../i18n.js'
import { patch } from '../store.js'
import { Icon } from '../components/common.js'

const EXTMEM_PROFILE_SECTIONS = [
  { key: 'salutation', zh: '称呼与身份', en: 'Identity & Addressing', hintZh: '例如：总司令、团队角色', hintEn: 'How Chief addresses you' },
  { key: 'communication', zh: '沟通节奏与习惯', en: 'Communication Style', hintZh: '例如：先给结论、少用黑话', hintEn: 'Tone, verbosity, plain-speak' },
  { key: 'engineering', zh: '工程偏好与红线', en: 'Tech & Rules', hintZh: '例如：不动 git、轻量零依赖', hintEn: 'Engineering conventions' },
  { key: 'projects', zh: '长期项目与重心', en: 'Ongoing Projects', hintZh: '例如：dsh-chief、本地工具链', hintEn: 'Active long-running work' },
  { key: 'traits', zh: '性格印象与偏好', en: 'Traits & Tastes', hintZh: '例如：偏爱极简风、彩蛋称呼', hintEn: 'Personal preferences & style' },
]

export function ExtMemDiaryView({
  entries = [],
  diaryPath = '',
  loading = false,
  distilling = false,
  onAddDiary,
  onUpdateDiary,
  onDeleteDiary,
  onDistillNow,
}) {
  const [composeOpen, setComposeOpen] = React.useState(false)
  const [titleDraft, setTitleDraft] = React.useState('')
  const [summaryDraft, setSummaryDraft] = React.useState('')
  const [moodDraft, setMoodDraft] = React.useState('日常')
  const [editingId, setEditingId] = React.useState('')
  const [editTitle, setEditTitle] = React.useState('')
  const [editSummary, setEditSummary] = React.useState('')

  const submitAdd = async () => {
    if (!summaryDraft.trim() || !onAddDiary) return
    const ok = await onAddDiary({
      title: titleDraft.trim(),
      summary: summaryDraft.trim(),
      moodTag: moodDraft.trim() || '日常',
    })
    if (ok !== false) {
      setTitleDraft('')
      setSummaryDraft('')
      setComposeOpen(false)
    }
  }

  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
    h(
      'div',
      { className: 'dnb-extmem-studio-head' },
      h('div', null,
        h('div', { style: { fontSize: 13, fontWeight: 600, color: 'var(--dnb-text)' } },
          bi('参谋日记本（并肩协作编年史）', 'Chief Chronicle Diary')),
        h('div', { style: { fontSize: 11, color: 'var(--dnb-text-3)', marginTop: 2 } },
          bi('后台聊天会自动总结并记下共同经历与关键收获，也支持随时补记或删改。',
            'Auto-generated from meaningful conversations, with full manual editing.')),
      ),
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
        h('button', {
          type: 'button',
          className: 'dnb-mini-btn',
          'data-tone': composeOpen ? 'accent' : undefined,
          onClick: () => setComposeOpen(v => !v),
        }, h(Icon, { name: composeOpen ? 'x' : 'plus', size: 11 }), composeOpen ? bi('收起', 'Close') : bi('手写一篇', 'New Entry')),
        h('button', {
          type: 'button',
          className: 'dnb-primary-btn',
          style: { minHeight: 28, padding: '0 11px', fontSize: 11.5 },
          disabled: distilling,
          onClick: () => { if (onDistillNow) void onDistillNow() },
        }, distilling ? bi('复盘提炼中…', 'Distilling…') : bi('✦ 立即从对话写日记', '✦ Auto-Write from Chat')),
      ),
    ),

    composeOpen
      ? h(
          'div',
          { className: 'dnb-extmem-capture' },
          h(
            'div',
            { style: { display: 'flex', gap: 7, flexWrap: 'wrap' } },
            h('input', {
              className: 'dnb-input',
              style: { flex: '1 1 180px', minHeight: 32, fontSize: 12 },
              placeholder: bi('这篇日记的小标题（可选）…', 'Optional entry title…'),
              value: titleDraft,
              onChange: e => setTitleDraft(e.target.value),
            }),
            h('input', {
              className: 'dnb-input',
              style: { width: 110, minHeight: 32, fontSize: 12 },
              placeholder: bi('氛围标签', 'Mood tag'),
              value: moodDraft,
              onChange: e => setMoodDraft(e.target.value),
            }),
          ),
          h('textarea', {
            className: 'dnb-input',
            rows: 3,
            style: { width: '100%', padding: '7px 10px', fontSize: 12, lineHeight: 1.5, boxSizing: 'border-box' },
            placeholder: bi('写下今天一起做了什么、有哪些关键决定或心情感想…', 'Record what happened today…'),
            value: summaryDraft,
            onChange: e => setSummaryDraft(e.target.value),
          }),
          h(
            'div',
            { style: { display: 'flex', justifyContent: 'flex-end', gap: 6 } },
            h('button', {
              type: 'button',
              className: 'dnb-primary-btn',
              style: { minHeight: 30, padding: '0 14px', fontSize: 11.5 },
              disabled: !summaryDraft.trim(),
              onClick: () => void submitAdd(),
            }, bi('存入日记本', 'Save Entry')),
          ),
        )
      : null,

    loading && entries.length === 0
      ? h('div', { style: { padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--dnb-text-3)' } },
          bi('正在打开日记本…', 'Loading diary…'))
      : entries.length > 0
        ? entries.map(entry => {
            const isEdit = editingId && editingId === entry.id
            return h(
              'div',
              { key: entry.id, className: 'dnb-extmem-diary-card' },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' } },
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, flexWrap: 'wrap' } },
                  h('span', { style: { fontSize: 11, color: 'var(--dnb-accent)', fontVariantNumeric: 'tabular-nums', fontWeight: 600 } },
                    `${entry.date} ${entry.time || ''}`.trim()),
                  h('span', { style: { fontSize: 13, fontWeight: 600, color: 'var(--dnb-text)' } }, entry.title),
                  h('span', { className: 'dnb-tag', style: { fontSize: 10 } }, entry.moodTag || '日常'),
                  entry.source === 'auto'
                    ? h('span', { className: 'dnb-acc-badge', 'data-tone': 'accent', style: { fontSize: 10 } }, bi('自动总结', 'Auto'))
                    : null,
                ),
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: 4 } },
                  h('button', {
                    type: 'button',
                    className: 'dnb-mini-btn',
                    onClick: () => {
                      setEditingId(isEdit ? '' : entry.id)
                      setEditTitle(entry.title || '')
                      setEditSummary(entry.summary || '')
                    },
                  }, h(Icon, { name: 'edit', size: 11 }), isEdit ? bi('取消', 'Cancel') : bi('编辑', 'Edit')),
                  h('button', {
                    type: 'button',
                    className: 'dnb-mini-btn',
                    style: { color: 'var(--dnb-coral, #f28b88)' },
                    onClick: () => { if (onDeleteDiary) void onDeleteDiary(entry.id) },
                  }, h(Icon, { name: 'trash', size: 11 })),
                ),
              ),
              isEdit
                ? h(
                    'div',
                    { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                    h('input', {
                      className: 'dnb-input',
                      style: { minHeight: 30, fontSize: 12 },
                      value: editTitle,
                      onChange: e => setEditTitle(e.target.value),
                    }),
                    h('textarea', {
                      className: 'dnb-input',
                      rows: 3,
                      style: { width: '100%', padding: '7px 10px', fontSize: 12, lineHeight: 1.5, boxSizing: 'border-box' },
                      value: editSummary,
                      onChange: e => setEditSummary(e.target.value),
                    }),
                    h(
                      'div',
                      { style: { display: 'flex', justifyContent: 'flex-end', gap: 6 } },
                      h('button', {
                        type: 'button',
                        className: 'dnb-primary-btn',
                        style: { minHeight: 28, padding: '0 12px', fontSize: 11.5 },
                        disabled: !editSummary.trim(),
                        onClick: async () => {
                          if (onUpdateDiary) {
                            await onUpdateDiary({ id: entry.id, title: editTitle.trim(), summary: editSummary.trim() })
                          }
                          setEditingId('')
                        },
                      }, bi('保存修改', 'Save')),
                    ),
                  )
                : h('div', { style: { fontSize: 12.2, lineHeight: 1.6, color: 'var(--dnb-text-2)', whiteSpace: 'pre-wrap' } },
                    entry.summary),
              Array.isArray(entry.highlights) && entry.highlights.length > 0 && !isEdit
                ? h(
                    'div',
                    { className: 'dnb-extmem-diary-highlights' },
                    entry.highlights.map((hl, i) => h('div', { key: i }, `• ${hl}`)),
                  )
                : null,
            )
          })
        : h(
            'div',
            { className: 'dnb-extmem-diary-card', style: { alignItems: 'center', textAlign: 'center', padding: 24 } },
            h('div', { style: { fontSize: 12.5, fontWeight: 550, color: 'var(--dnb-text)' } },
              bi('日记本还是空的', 'No diary entries yet')),
            h('div', { style: { fontSize: 11.5, color: 'var(--dnb-text-3)', maxWidth: 420 } },
              bi('和参谋长聊几句后后台会自动生成共同经历日记；你也可以点上方「✦ 立即从对话写日记」或「手写一篇」。',
                'Diary entries grow automatically as you chat, or click Auto-Write / New Entry above.')),
          ),

    diaryPath
      ? h('div', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', padding: '0 4px', wordBreak: 'break-all' } },
          `${bi('明文存储文件：', 'Plain file: ')}${diaryPath}`)
      : null,
  )
}

export function ExtMemProfileView({
  profile = null,
  profilePath = '',
  loading = false,
  distilling = false,
  onSaveProfile,
  onDistillNow,
}) {
  const [draftInputs, setDraftInputs] = React.useState({})
  const sections = (profile && profile.sections) || {}
  const totalCount = EXTMEM_PROFILE_SECTIONS.reduce((acc, s) => acc + ((sections[s.key] || []).length), 0)

  const addItem = async secKey => {
    const text = String(draftInputs[secKey] || '').trim()
    if (!text || !onSaveProfile) return
    const nextSections = {
      ...sections,
      [secKey]: [
        ...(Array.isArray(sections[secKey]) ? sections[secKey] : []),
        { id: `pf-${Date.now().toString(36)}`, text, locked: true, source: 'manual', updatedAt: Date.now() },
      ],
    }
    setDraftInputs(prev => ({ ...prev, [secKey]: '' }))
    await onSaveProfile({ ...profile, sections: nextSections })
  }

  const toggleLock = async (secKey, itemId) => {
    if (!onSaveProfile) return
    const nextList = (sections[secKey] || []).map(it =>
      it && it.id === itemId ? { ...it, locked: !it.locked, updatedAt: Date.now() } : it)
    await onSaveProfile({ ...profile, sections: { ...sections, [secKey]: nextList } })
  }

  const removeItem = async (secKey, itemId) => {
    if (!onSaveProfile) return
    const nextList = (sections[secKey] || []).filter(it => it && it.id !== itemId)
    await onSaveProfile({ ...profile, sections: { ...sections, [secKey]: nextList } })
  }

  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
    h(
      'div',
      { className: 'dnb-extmem-studio-head' },
      h('div', null,
        h('div', { style: { fontSize: 13, fontWeight: 600, color: 'var(--dnb-text)' } },
          bi(`用户画像档案（${totalCount} 项印象）`, `User Profile (${totalCount} traits)`)),
        h('div', { style: { fontSize: 11, color: 'var(--dnb-text-3)', marginTop: 2 } },
          bi('越相处越懂你的偏好档案。带「已锁定」小锁头的条目，后台自动复盘绝不会覆盖或删改。',
            'Auto-evolving portrait of your preferences. Locked items are never overwritten by background updates.')),
      ),
      h('button', {
        type: 'button',
        className: 'dnb-primary-btn',
        style: { minHeight: 28, padding: '0 11px', fontSize: 11.5 },
        disabled: distilling,
        onClick: () => { if (onDistillNow) void onDistillNow() },
      }, distilling ? bi('分析更新中…', 'Updating…') : bi('✦ 从对话更新画像', '✦ Auto-Update Profile')),
    ),

    loading && !profile
      ? h('div', { style: { padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--dnb-text-3)' } },
          bi('正在读取用户画像…', 'Loading profile…'))
      : h(
          'div',
          { className: 'dnb-extmem-profile-grid' },
          EXTMEM_PROFILE_SECTIONS.map(sec => {
            const list = Array.isArray(sections[sec.key]) ? sections[sec.key] : []
            const inputVal = draftInputs[sec.key] || ''
            return h(
              'div',
              { key: sec.key, className: 'dnb-extmem-profile-sec' },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 } },
                h('span', { style: { fontSize: 12.2, fontWeight: 600, color: 'var(--dnb-text)' } }, bi(sec.zh, sec.en)),
                h('span', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)' } }, String(list.length)),
              ),
              list.length > 0
                ? h(
                    'div',
                    { style: { display: 'flex', flexDirection: 'column', gap: 5 } },
                    list.map(it =>
                      h(
                        'div',
                        { key: it.id, className: 'dnb-extmem-profile-item', 'data-locked': it.locked ? '1' : '0' },
                        h('span', { style: { flex: 1, color: 'var(--dnb-text)', wordBreak: 'break-word' } }, it.text),
                        h(
                          'div',
                          { style: { display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0 } },
                          h('button', {
                            type: 'button',
                            className: 'dnb-mini-btn',
                            style: { padding: '1px 6px', fontSize: 10 },
                            'data-tone': it.locked ? 'amber' : undefined,
                            title: it.locked ? bi('已锁定：后台自动更新不会修改它（点击解锁）', 'Locked from auto-edits (click to unlock)') : bi('自动可更新（点击锁定保护）', 'Click to lock'),
                            onClick: () => void toggleLock(sec.key, it.id),
                          }, it.locked ? bi('🔒 锁', '🔒 Lock') : bi('自动', 'Auto')),
                          h('button', {
                            type: 'button',
                            className: 'dnb-icon-btn',
                            style: { width: 20, height: 20, color: 'var(--dnb-text-3)' },
                            title: bi('移除', 'Remove'),
                            onClick: () => void removeItem(sec.key, it.id),
                          }, h(Icon, { name: 'x', size: 11 })),
                        ),
                      )),
                  )
                : h('div', { style: { fontSize: 11, color: 'var(--dnb-text-3)', padding: '6px 2px' } },
                    bi('暂无记录，可在下方手动添加一条或等后台自动归纳。', 'Empty so far; add below or let auto-distill fill.')),
              h(
                'div',
                { style: { display: 'flex', gap: 5, marginTop: 'auto', paddingTop: 3 } },
                h('input', {
                  className: 'dnb-input',
                  style: { flex: 1, minHeight: 28, fontSize: 11.5, padding: '3px 8px' },
                  placeholder: bi(sec.hintZh, sec.hintEn),
                  value: inputVal,
                  onChange: e => setDraftInputs(prev => ({ ...prev, [sec.key]: e.target.value })),
                  onKeyDown: e => {
                    if (e.key === 'Enter' && inputVal.trim()) void addItem(sec.key)
                  },
                }),
                h('button', {
                  type: 'button',
                  className: 'dnb-mini-btn',
                  disabled: !inputVal.trim(),
                  onClick: () => void addItem(sec.key),
                }, '+'),
              ),
            )
          }),
        ),

    profilePath
      ? h('div', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', padding: '0 4px', wordBreak: 'break-all' } },
          `${bi('明文存储文件：', 'Plain file: ')}${profilePath}`)
      : null,
  )
}

export function ExtMemPromptsView({
  prompts = [],
  promptsPath = '',
  loading = false,
  onSavePrompt,
  onResetPrompt,
}) {
  const [editingKey, setEditingKey] = React.useState('')
  const [draftContent, setDraftContent] = React.useState('')

  const groups = [
    { key: 'processing', title: bi('后台提取与记录规则', 'Processing & Distillation'), desc: bi('控制如何从对话中提炼记忆、写日记与更新画像', 'Controls memory extraction, diary writing & profile refinement') },
    { key: 'injection', title: bi('记忆召回注入语', 'Recall Injection'), desc: bi('向参谋模型注入历史记录前的引导语句（不影响 @lead）', 'Guidance before injected recall lines (0-byte isolated from @lead)') },
  ]

  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
    h(
      'div',
      { className: 'dnb-extmem-studio-head' },
      h('div', null,
        h('div', { style: { fontSize: 13, fontWeight: 600, color: 'var(--dnb-text)' } },
          bi('记录提示词工坊（教模型怎么记）', 'Prompt Studio')),
        h('div', { style: { fontSize: 11, color: 'var(--dnb-text-3)', marginTop: 2 } },
          bi('完全透明地调教参谋长记录记忆、写作日记和注入回忆的规则，随时可一键恢复默认。',
            'Customize how Chief extracts memories, writes diary entries, and injects context.')),
      ),
      prompts.some(p => p.customized)
        ? h('button', {
            type: 'button',
            className: 'dnb-mini-btn',
            onClick: () => { if (onResetPrompt) void onResetPrompt('all') },
          }, h(Icon, { name: 'refresh', size: 11 }), bi('全部恢复默认', 'Reset All'))
        : null,
    ),

    loading && prompts.length === 0
      ? h('div', { style: { padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--dnb-text-3)' } },
          bi('正在加载提示词模板…', 'Loading prompt templates…'))
      : groups.map(grp => {
          const list = prompts.filter(p => p.group === grp.key)
          if (!list.length) return null
          return h(
            'div',
            { key: grp.key, style: { display: 'flex', flexDirection: 'column', gap: 7 } },
            h(
              'div',
              { style: { padding: '0 2px' } },
              h('div', { style: { fontSize: 12, fontWeight: 600, color: 'var(--dnb-text)' } }, grp.title),
              h('div', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)' } }, grp.desc),
            ),
            h(
              'div',
              { className: 'dnb-extmem-prompt-grid' },
              list.map(pr => {
                const isEdit = editingKey === pr.key
                return h(
                  'div',
                  { key: pr.key, className: 'dnb-extmem-prompt-card' },
                  h(
                    'div',
                    { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' } },
                    h(
                      'div',
                      { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
                      h('span', { style: { fontSize: 12.5, fontWeight: 600, color: 'var(--dnb-text)' } }, bi(pr.title, pr.titleEn)),
                      pr.expectsJson
                        ? h('span', { className: 'dnb-acc-badge', 'data-tone': 'amber', style: { fontSize: 9.5 } }, 'JSON')
                        : null,
                      pr.customized
                        ? h('span', { className: 'dnb-acc-badge', 'data-tone': 'accent', style: { fontSize: 9.5 } }, bi('已自定义', 'Custom'))
                        : h('span', { className: 'dnb-tag', style: { fontSize: 9.5 } }, bi('默认', 'Default')),
                    ),
                    h(
                      'div',
                      { style: { display: 'flex', gap: 4 } },
                      pr.customized
                        ? h('button', {
                            type: 'button',
                            className: 'dnb-mini-btn',
                            onClick: () => {
                              if (onResetPrompt) void onResetPrompt(pr.key)
                              if (isEdit) setEditingKey('')
                            },
                          }, bi('还原', 'Reset'))
                        : null,
                      h('button', {
                        type: 'button',
                        className: 'dnb-mini-btn',
                        'data-tone': isEdit ? 'accent' : undefined,
                        onClick: () => {
                          if (isEdit) {
                            setEditingKey('')
                          } else {
                            setEditingKey(pr.key)
                            setDraftContent(pr.content || pr.defaultContent || '')
                          }
                        },
                      }, h(Icon, { name: 'edit', size: 11 }), isEdit ? bi('取消', 'Cancel') : bi('编辑', 'Edit')),
                    ),
                  ),
                  h('div', { style: { fontSize: 11, color: 'var(--dnb-text-3)', lineHeight: 1.4 } }, bi(pr.desc, pr.descEn)),
                  isEdit
                    ? h(
                        'div',
                        { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                        h('textarea', {
                          className: 'dnb-input',
                          rows: 5,
                          style: { width: '100%', padding: '7px 9px', fontSize: 11.5, lineHeight: 1.5, boxSizing: 'border-box', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
                          value: draftContent,
                          onChange: e => setDraftContent(e.target.value),
                        }),
                        h(
                          'div',
                          { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 } },
                          h('button', {
                            type: 'button',
                            className: 'dnb-mini-btn',
                            onClick: () => setDraftContent(pr.defaultContent || ''),
                          }, bi('填入默认模板', 'Fill Default')),
                          h('button', {
                            type: 'button',
                            className: 'dnb-primary-btn',
                            style: { minHeight: 28, padding: '0 13px', fontSize: 11.5 },
                            disabled: !draftContent.trim(),
                            onClick: async () => {
                              if (onSavePrompt) await onSavePrompt(pr.key, draftContent)
                              setEditingKey('')
                            },
                          }, bi('保存模板', 'Save')),
                        ),
                      )
                    : h('pre', { className: 'dnb-extmem-prompt-pre' }, pr.content),
                  Array.isArray(pr.vars) && pr.vars.length > 0
                    ? h(
                        'div',
                        { style: { display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' } },
                        h('span', { style: { fontSize: 10, color: 'var(--dnb-text-3)' } }, bi('可用变量：', 'Vars:')),
                        pr.vars.map(v => h('span', {
                          key: v,
                          className: 'dnb-extmem-var-chip',
                          title: bi('点击插入或复制变量', 'Variable placeholder'),
                          onClick: () => {
                            if (isEdit) setDraftContent(prev => prev + v)
                            else patch({ notice: `${bi('变量占位符：', 'Variable: ')}${v}` })
                          },
                        }, v)),
                      )
                    : null,
                )
              }),
            ),
          )
        }),

    promptsPath
      ? h('div', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', padding: '0 4px', wordBreak: 'break-all' } },
          `${bi('配置文件：', 'Config file: ')}${promptsPath}`)
      : null,
  )
}
