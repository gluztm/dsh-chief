/**
 * tabs/boundaries.js
 *
 * Global & session boundaries editor cards and BoundariesTab.
 */

import { React, h } from '../react-runtime.js'
import { BOUND_LISTS, BOUND_CAP } from '../constants.js'
import { bi } from '../i18n.js'
import { store, patch } from '../store.js'
import {
  requestConsolidateBounds,
  submitChiefBar,
  copyText,
  addBoundRule,
  toggleBoundPin,
  removeBoundRule,
  editBoundRule,
  toggleBoundSelect,
  saveGuardWallApi,
  setGuardWallScopeApi,
  setAllGuardWallsScopeApi,
  removeGuardWallApi,
  toggleGuardWallSelect,
  mergeGuardWallsApi,
  updateSecConfig,
} from '../api.js'
import { Icon, AccCard, Switch } from '../components/common.js'

const WALL_TYPE_META = {
  forbid_cmd: { label: '禁跑命令', placeholder: '输入禁跑的命令关键词（如 npm publish、git push --force）…' },
  forbid_path: { label: '禁碰路径', placeholder: '输入禁止读写的文件夹或文件（如 .github/workflows、DSHGuard）…' },
  restrict_write: { label: '仅限某目录可写', placeholder: '输入唯一允许写入的文件夹路径…' },
  require_approval_cmd: { label: '高危命令先请示', placeholder: '输入运行前要先问你的命令（如 prisma migrate）…' },
  deny_tool: { label: '禁用工具', placeholder: '输入要禁用的工具名（如 run_command、write_file）…' },
}

const GUARD_WALL_PRESET_PACKS = [
  {
    id: 'preset-secret-files',
    title: '涉密文件防泄露',
    desc: '不让 AI 偷看或乱改密码、密钥和账号配置文件（.env、私钥、凭据等）',
    ruleType: 'forbid_path',
    defaultEnabled: true,
    patterns: ['.env', '.env.*', '.npmrc', '.netrc', '*.pem', '*.key', 'id_rsa', 'id_ed25519', 'credentials', 'secrets.*', '.aws/credentials'],
    reason: '预设包：默认保护密码、密钥与凭据文件，防止 AI 误读泄露或误改',
  },
  {
    id: 'preset-git-safety',
    title: '高危操作防误删',
    desc: '直接拦住强推覆盖、强行清空本地改动和强删分支等不可逆操作',
    ruleType: 'forbid_cmd',
    defaultEnabled: true,
    patterns: ['git\\s+push.*--force', 'git\\s+push\\s+-f\\b', 'git\\s+reset\\s+--hard', 'git\\s+clean\\s+-f', 'git\\s+branch\\s+-D'],
    reason: '预设包：防止误运行不可逆 Git 破坏性命令导致本地改动或远端历史丢失',
  },
  {
    id: 'preset-readonly-audit',
    title: '只读看代码模式',
    desc: '只想让 AI 看代码、查问题或出方案时打开，彻底禁止改文件和删文件',
    ruleType: 'deny_tool',
    defaultEnabled: false,
    patterns: ['write_file', 'edit_file', 'write', 'edit', 'apply_patch', 'delete_file', 'remove_file'],
    reason: '预设包：临时锁死所有写文件工具，确保只读审查期间源码零改动',
  },
]

function GuardWallsCard({ view }) {
  const [wallMenuOpen, setWallMenuOpen] = React.useState(false)
  const [tplOpen, setTplOpen] = React.useState(true)
  const [presetBusy, setPresetBusy] = React.useState(false)
  const wallImportRef = React.useRef(null)
  React.useEffect(() => {
    if (!wallMenuOpen) return
    const close = () => setWallMenuOpen(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [wallMenuOpen])

  const walls = Array.isArray(view.guardWalls) ? view.guardWalls : []
  const presetIdSet = new Set(GUARD_WALL_PRESET_PACKS.map(p => p.id))
  const presetTitleSet = new Set(GUARD_WALL_PRESET_PACKS.map(p => p.title))
  const findPresetWall = tpl => walls.find(w => w && (w.id === tpl.id || w.title === tpl.title))
  const customWalls = walls.filter(w => w && !presetIdSet.has(w.id) && !presetTitleSet.has(w.title))
  const activeCount = walls.filter(w => w && w.activeNow).length
  const activePresetCount = GUARD_WALL_PRESET_PACKS.filter(tpl => {
    const w = findPresetWall(tpl)
    return w && w.activeNow
  }).length
  const collapsed = Boolean(view.wallCollapsed)
  const formOpen = Boolean(view.wallFormOpen)
  const draftField = WALL_TYPE_META[view.wallDraftField] ? view.wallDraftField : 'forbid_cmd'
  const draftScope = view.wallDraftScope === 'workspace' ? 'workspace' : 'global'
  const draftTitle = view.wallDraftTitle || ''
  const draftPattern = view.wallDraftPattern || ''
  const selectedIds = (Array.isArray(view.wallSelectedIds) ? view.wallSelectedIds : [])
    .filter(id => customWalls.some(w => w && w.id === id))
  const selectedSet = new Set(selectedIds)

  const bucketCounts = {}
  for (const w of customWalls) {
    if (!w || !w.ruleType) continue
    const k = (w.scope === 'paused' ? 'paused|' : 'active|') + w.ruleType
    bucketCounts[k] = (bucketCounts[k] || 0) + 1
  }
  const hasMergeableWallGroup = Object.values(bucketCounts).some(c => c >= 2)

  const submitNewWall = () => {
    void saveGuardWallApi({
      title: draftTitle,
      ruleType: draftField,
      pattern: draftPattern,
      scope: draftScope,
    })
  }

  const togglePresetPack = async (tpl, nextOn) => {
    if (!tpl || presetBusy) return
    setPresetBusy(true)
    try {
      const existing = findPresetWall(tpl)
      if (existing) {
        const targetScope = nextOn
          ? (existing.scope === 'workspace' ? 'workspace' : 'global')
          : 'paused'
        await setGuardWallScopeApi(existing.id, targetScope)
      } else if (nextOn) {
        await saveGuardWallApi({
          id: tpl.id,
          title: tpl.title,
          ruleType: tpl.ruleType,
          patterns: tpl.patterns,
          scope: 'global',
          reason: tpl.reason,
          source: 'manual',
        })
      }
    } finally {
      setPresetBusy(false)
    }
  }

  const changePresetScope = async (tpl, targetScope) => {
    if (!tpl || !targetScope || presetBusy) return
    setPresetBusy(true)
    try {
      const existing = findPresetWall(tpl)
      if (existing) {
        if (existing.scope !== targetScope) {
          await setGuardWallScopeApi(existing.id, targetScope)
        }
      } else {
        await saveGuardWallApi({
          id: tpl.id,
          title: tpl.title,
          ruleType: tpl.ruleType,
          patterns: tpl.patterns,
          scope: targetScope,
          reason: tpl.reason,
          source: 'manual',
        })
      }
    } finally {
      setPresetBusy(false)
    }
  }

  const restoreDefaultPresets = async () => {
    if (presetBusy) return
    setPresetBusy(true)
    try {
      for (const tpl of GUARD_WALL_PRESET_PACKS) {
        const existing = findPresetWall(tpl)
        if (tpl.defaultEnabled) {
          if (existing) {
            if (existing.scope === 'paused') {
              await setGuardWallScopeApi(existing.id, 'global', { silent: true })
            }
          } else {
            await saveGuardWallApi({
              id: tpl.id,
              title: tpl.title,
              ruleType: tpl.ruleType,
              patterns: tpl.patterns,
              scope: 'global',
              reason: tpl.reason,
              source: 'manual',
              silent: true,
            })
          }
        } else if (existing && existing.scope !== 'paused') {
          await setGuardWallScopeApi(existing.id, 'paused', { silent: true })
        }
      }
      patch({ notice: bi('🛡️ 已恢复默认开启 2 套常用防泄密与防误删预设', '🛡️ Restored 2 default safety presets') })
    } finally {
      setPresetBusy(false)
    }
  }

  const pauseAllPresets = async () => {
    if (presetBusy) return
    setPresetBusy(true)
    try {
      for (const tpl of GUARD_WALL_PRESET_PACKS) {
        const existing = findPresetWall(tpl)
        if (existing && existing.scope !== 'paused') {
          await setGuardWallScopeApi(existing.id, 'paused', { silent: true })
        }
      }
      patch({ notice: bi('⏸ 已暂停全部预设拦截包，随时可一键重新开启', '⏸ Paused all preset guard packs') })
    } finally {
      setPresetBusy(false)
    }
  }

  const exportWallsJson = () => {
    const clean = walls.map(w => ({
      title: w.title,
      ruleType: w.ruleType,
      patterns: w.patterns,
      scope: w.scope === 'workspace' ? 'workspace' : 'global',
      reason: w.reason || '',
    }))
    const jsonText = JSON.stringify({ version: 1, guardWalls: clean }, null, 2)
    try {
      if (typeof document !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined' && URL.createObjectURL) {
        const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'dsh-chief-guard-walls.json'
        document.body.appendChild(a)
        a.click()
        setTimeout(() => {
          try { URL.revokeObjectURL(url) } catch {}
          try { a.remove() } catch {}
        }, 400)
        patch({ notice: bi(`📤 已导出 ${clean.length} 条自定义拦截规则`, `📤 Exported ${clean.length} block rule(s)`) })
        return
      }
    } catch {}
    copyText(jsonText, bi('📋 已复制拦截规则 JSON 到剪贴板', '📋 Copied block rules JSON'))
  }

  const handleImportWalls = async (e) => {
    const file = e && e.target && e.target.files && e.target.files[0]
    if (e && e.target) e.target.value = ''
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text())
      const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed && parsed.guardWalls) ? parsed.guardWalls : [])
      let added = 0
      for (const raw of arr.slice(0, 16)) {
        if (!raw || !raw.title || !Array.isArray(raw.patterns) || !raw.patterns.length) continue
        if (walls.some(w => w && w.title === raw.title)) continue
        await saveGuardWallApi({
          title: String(raw.title),
          ruleType: WALL_TYPE_META[raw.ruleType] ? raw.ruleType : 'forbid_cmd',
          pattern: raw.patterns.join(', '),
          scope: raw.scope === 'workspace' ? 'workspace' : 'global',
        })
        added += 1
      }
      patch({ notice: bi(`📥 已导入 ${added} 条自定义拦截规则（重复项已自动跳过）`, `📥 Imported ${added} custom rule(s) (duplicates skipped)`) })
    } catch (err) {
      patch({ error: bi('导入拦截规则失败：', 'Import failed: ') + String((err && err.message) || err) })
    }
  }

  return h(
    AccCard,
    {
      open: !collapsed,
      onToggle: () => patch({ wallCollapsed: !collapsed }),
      className: 'dnb-wall-box',
      tone: 'rose',
      icon: h(Icon, { name: 'shieldSentinel', size: 13.5, style: { color: activeCount > 0 ? 'var(--dnb-coral, #f28b88)' : 'var(--dnb-text-3)', flexShrink: 0 } }),
      title: bi('自定义拦截规则', 'Custom Block Rules'),
      preview: walls.length
        ? `${activeCount} ${bi('生效', 'active')} · ${walls.slice(0, 2).map(w => w.title).join(bi('、', ', '))}`
        : bi('你指定不能碰的文件或命令，AI 一碰就会被直接拦下', 'Files or commands you forbid are blocked before execution'),
      bodyStyle: { padding: 0 },
      badges: h(
        'span',
        {
          className: 'dnb-seg-dot',
          style: activeCount > 0 ? { background: 'var(--dnb-coral-soft, rgba(242,139,136,0.14))', color: 'var(--dnb-coral, #f28b88)', padding: '1px 6px', borderRadius: 99 } : undefined,
        },
        bi(`${activeCount}/${walls.length} 生效`, `${activeCount}/${walls.length} active`),
      ),
      actions: h(
        React.Fragment,
        null,
        walls.length > 0
          ? h('button', {
              type: 'button',
              className: 'dnb-pill',
              style: { height: 22, padding: '0 8px', fontSize: 10.5 },
              title: activeCount > 0 ? bi('一键暂停所有自定义拦截规则', 'Pause all custom block rules') : bi('一键启用所有自定义拦截规则', 'Enable all custom block rules'),
              onClick: () => void setAllGuardWallsScopeApi(activeCount > 0 ? 'paused' : 'global'),
            }, h(Icon, { name: activeCount > 0 ? 'pause' : 'play', size: 10.5 }), activeCount > 0 ? bi('全部暂停', 'Pause All') : bi('全部启用', 'Enable All'))
          : null,
        h('button', {
          type: 'button',
          className: 'dnb-pill',
          'data-active': tplOpen ? '1' : '0',
          style: { height: 22, padding: '0 8px', fontSize: 10.5 },
          title: bi('查看并一键开关预设安全拦截包与导出导入备份', 'Toggle built-in safety guard packs & import/export'),
          onClick: () => {
            const nextTpl = !tplOpen
            setTplOpen(nextTpl)
            if (nextTpl && collapsed) patch({ wallCollapsed: false })
          },
        }, h(Icon, { name: 'layers', size: 10.5 }), tplOpen ? bi('收起预设包', 'Hide Presets') : bi('预设包', 'Presets')),
        h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: { height: 22, padding: '0 8px', fontSize: 10.5 },
          onClick: () => {
            const nextOpen = !formOpen
            patch({ wallFormOpen: nextOpen, ...(nextOpen ? { wallCollapsed: false } : {}) })
          },
        }, formOpen ? '收起' : '+ 加规则'),
        h(
          'div',
          { className: 'dnb-more-wrap' },
          h('button', {
            type: 'button',
            className: 'dnb-pill',
            style: { height: 22, padding: '0 7px', fontSize: 10.5 },
            'data-active': wallMenuOpen ? '1' : '0',
            title: '更多规则与合并操作',
            onClick: e => {
              e.stopPropagation()
              setWallMenuOpen(v => !v)
            },
          }, selectedIds.length >= 2 ? `⋯ (${selectedIds.length})` : '⋯'),
          wallMenuOpen
            ? h(
                'div',
                { className: 'dnb-more-menu', style: { minWidth: 184 } },
                h('button', {
                  type: 'button',
                  className: 'dnb-more-item',
                  disabled: view.secBusy,
                  title: '让参谋长按项目情况帮你写规则，确认后生效',
                  onClick: () => {
                    setWallMenuOpen(false)
                    void submitChiefBar(
                      '请帮我根据当前工程重点保护目录与高危操作，生成可复用的自定义拦截规则提案（wallProposals），默认 global 随身生效；若同时识别到需要补充的工作边界红线/必做项，也请一并填入 boundProposals，全部写入 JSON 数组供我一键确认落锁。',
                      'craft_wall',
                    )
                  },
                }, h('span', null, view.secBusy && view.chiefQuickAction === 'craft_wall' ? '⏳ 生成规则中…' : '✨ 让参谋长写规则')),
                selectedIds.length >= 2
                  ? h('button', {
                      type: 'button',
                      className: 'dnb-more-item',
                      'data-danger': '1',
                      title: '把勾选的同类型规则合为一条',
                      onClick: () => {
                        setWallMenuOpen(false)
                        void mergeGuardWallsApi({ wallIds: selectedIds })
                      },
                    }, h('span', null, `⇄ 合并所选 (${selectedIds.length})`))
                  : (hasMergeableWallGroup
                      ? h('button', {
                          type: 'button',
                          className: 'dnb-more-item',
                          title: '按类型自动合并重复规则，不同类型不混并',
                          onClick: () => {
                            setWallMenuOpen(false)
                            void mergeGuardWallsApi({ autoGroup: true })
                          },
                        }, h('span', null, '✦ 同类一键合并'))
                      : null),
              )
            : null,
        ),
      ),
    },
    view.wallMergeError
      ? h(
          'div',
          {
            style: {
              padding: '7px 11px',
              borderBottom: '1px solid var(--dnb-coral, #f28b88)',
              background: 'var(--dnb-coral-soft, rgba(242, 139, 136, 0.13))',
              color: 'var(--dnb-coral, #f28b88)',
              fontSize: 11.5,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            },
          },
          h('span', null, view.wallMergeError),
          h('span', { style: { cursor: 'pointer', paddingLeft: 6, flexShrink: 0 }, onClick: () => patch({ wallMergeError: '', error: '' }) }, '×'),
        )
      : null,
    tplOpen
      ? h(
          'div',
          { className: 'dnb-tpl-drawer' },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' } },
            h('span', { style: { fontSize: 11.5, fontWeight: 600, color: 'var(--dnb-text)', display: 'inline-flex', alignItems: 'center', gap: 5 } },
              h(Icon, { name: 'layers', size: 12, style: { color: 'var(--dnb-accent)' } }),
              bi(
                `快捷安全预设（默认开 2 项，随时切 · ${activePresetCount}/${GUARD_WALL_PRESET_PACKS.length} 生效）`,
                `Quick Safety Presets (${activePresetCount}/${GUARD_WALL_PRESET_PACKS.length} active)`,
              )),
            h(
              'div',
              { style: { display: 'inline-flex', gap: 5, flexWrap: 'wrap' } },
              h('button', {
                type: 'button',
                className: 'dnb-pill',
                style: { height: 22, padding: '0 8px', fontSize: 10.5 },
                disabled: presetBusy,
                title: bi('一键恢复默认开启 2 套防泄密与防误删预设', 'Restore 2 default safety presets'),
                onClick: () => void restoreDefaultPresets(),
              }, h(Icon, { name: 'refresh', size: 10.5 }), bi('恢复默认', 'Restore Defaults')),
              h('button', {
                type: 'button',
                className: 'dnb-pill',
                style: { height: 22, padding: '0 8px', fontSize: 10.5 },
                disabled: presetBusy || activePresetCount === 0,
                title: bi('临时暂停全部预设拦截包', 'Pause all preset guard packs'),
                onClick: () => void pauseAllPresets(),
              }, h(Icon, { name: 'pause', size: 10.5 }), bi('全部暂停', 'Pause Presets')),
              h('button', {
                type: 'button',
                className: 'dnb-pill',
                style: { height: 22, padding: '0 8px', fontSize: 10.5 },
                onClick: exportWallsJson,
              }, h(Icon, { name: 'download', size: 10.5 }), bi('导出规则', 'Export')),
              h('button', {
                type: 'button',
                className: 'dnb-pill',
                style: { height: 22, padding: '0 8px', fontSize: 10.5 },
                onClick: () => { if (wallImportRef.current) wallImportRef.current.click() },
              }, h(Icon, { name: 'upload', size: 10.5 }), bi('导入规则', 'Import')),
              h('input', {
                ref: wallImportRef,
                type: 'file',
                accept: '.json,application/json',
                style: { display: 'none' },
                onChange: e => void handleImportWalls(e),
              }),
            ),
          ),
          h(
            'div',
            { className: 'dnb-tpl-grid' },
            GUARD_WALL_PRESET_PACKS.map(tpl => {
              const existing = findPresetWall(tpl)
              const isOn = Boolean(existing && existing.scope !== 'paused')
              const currentScope = existing ? existing.scope : 'paused'
              const typeMeta = WALL_TYPE_META[tpl.ruleType] || { label: tpl.ruleType }
              return h(
                'div',
                { key: tpl.id, className: 'dnb-tpl-card', 'data-active': isOn ? '1' : '0' },
                h(
                  'div',
                  { className: 'dnb-tpl-head' },
                  h(
                    'div',
                    { style: { display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, flexWrap: 'wrap' } },
                    h('span', { className: 'dnb-tpl-title' }, tpl.title),
                    h('span', { className: 'dnb-tag', style: { fontSize: 9.5 } }, typeMeta.label),
                  ),
                  h(Switch, {
                    checked: isOn,
                    small: true,
                    disabled: presetBusy,
                    title: isOn ? bi(`点击暂停「${tpl.title}」`, `Pause "${tpl.title}"`) : bi(`点击开启「${tpl.title}」`, `Enable "${tpl.title}"`),
                    onChange: next => void togglePresetPack(tpl, next),
                  }),
                ),
                h('div', { className: 'dnb-tpl-desc' }, tpl.desc),
                h(
                  'div',
                  { className: 'dnb-tpl-foot' },
                  h(
                    'div',
                    { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
                    [
                      { key: 'global', label: bi('🌐 全局', '🌐 Global') },
                      { key: 'workspace', label: bi('📁 仅本工程', '📁 Project') },
                    ].map(opt =>
                      h('button', {
                        key: opt.key,
                        type: 'button',
                        className: 'dnb-wall-scope-btn',
                        disabled: presetBusy,
                        'data-active': isOn && currentScope === opt.key ? '1' : '0',
                        onClick: () => void changePresetScope(tpl, opt.key),
                      }, opt.label)),
                  ),
                  h(
                    'span',
                    {
                      className: 'dnb-tag',
                      style: {
                        fontSize: 9.5,
                        color: isOn ? 'var(--dnb-sage, #4ade80)' : 'var(--dnb-text-3)',
                      },
                    },
                    isOn ? (tpl.defaultEnabled ? bi('默认开启', 'Default ON') : bi('已开启', 'Active')) : bi('已暂停', 'Paused'),
                  ),
                ),
              )
            }),
          ),
          h(
            'div',
            { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', paddingTop: 2 } },
            bi(
              '需要发版审批、CI 或更细的目录/命令限制？老手可直接点右上角「+ 加规则」手搓，或让参谋长帮你写。',
              'Need finer publish, CI, or path rules? Click "+ Add Rule" above to craft your own.',
            ),
          ),
        )
      : null,
    formOpen
      ? h(
          'div',
          { style: { padding: '8px 12px 10px', borderBottom: '1px solid var(--dnb-border)', display: 'flex', flexDirection: 'column', gap: 7 } },
          h(
            'div',
            { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
            h('input', {
              className: 'dnb-input',
              style: { flex: '1 1 140px', height: 28, fontSize: 11.5 },
              placeholder: '给规则起个名（如：禁止发布到生产 / 保护配置）',
              value: draftTitle,
              onChange: e => patch({ wallDraftTitle: e.target.value }),
            }),
            h(
              'select',
              {
                className: 'dnb-input',
                style: { width: 'auto', height: 28, fontSize: 11, padding: '0 8px' },
                value: draftField,
                onChange: e => patch({ wallDraftField: e.target.value }),
              },
              Object.entries(WALL_TYPE_META).map(([k, meta]) =>
                h('option', { key: k, value: k }, meta.label)),
            ),
          ),
          h('input', {
            className: 'dnb-input',
            style: { height: 28, fontSize: 11.5 },
            placeholder: (WALL_TYPE_META[draftField] && WALL_TYPE_META[draftField].placeholder) || '输入拦截内容，多个用逗号隔开',
            value: draftPattern,
            onChange: e => patch({ wallDraftPattern: e.target.value }),
            onKeyDown: e => { if (e.key === 'Enter') submitNewWall() },
          }),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' } },
            h(
              'div',
              { style: { display: 'flex', gap: 5 } },
              h('button', {
                type: 'button',
                className: 'dnb-wall-scope-btn',
                'data-active': draftScope === 'global' ? '1' : '0',
                onClick: () => patch({ wallDraftScope: 'global' }),
              }, '🌐 全局随身'),
              h('button', {
                type: 'button',
                className: 'dnb-wall-scope-btn',
                'data-active': draftScope === 'workspace' ? '1' : '0',
                onClick: () => patch({ wallDraftScope: 'workspace' }),
              }, '📁 仅本工程'),
            ),
            h('button', {
              type: 'button',
              className: 'dnb-primary-btn',
              style: { height: 26, padding: '0 10px', fontSize: 11 },
              disabled: !draftTitle.trim() || !draftPattern.trim() || view.busy,
              onClick: submitNewWall,
            }, '🧱 保存并启用'),
          ),
        )
      : null,
    customWalls.length > 0
      ? customWalls.map(w => {
          const typeMeta = WALL_TYPE_META[w.ruleType] || { label: w.ruleType }
          const patText = Array.isArray(w.patterns) ? w.patterns.join(' , ') : ''
          const isChecked = selectedSet.has(w.id)
          return h(
            'div',
            { key: w.id, className: 'dnb-wall-item', style: w.scope === 'paused' ? { opacity: 0.62 } : undefined },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 } },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 } },
                h('span', { style: { fontSize: 12, fontWeight: 600, color: w.activeNow ? 'var(--dnb-text)' : 'var(--dnb-text-2)' } }, w.title),
                h('span', { className: 'dnb-tag', style: { fontSize: 10 } }, typeMeta.label),
                w.source === 'chief_crafted'
                  ? h('span', { className: 'dnb-tag', style: { fontSize: 10, color: 'var(--dnb-accent)' } }, '参谋生成')
                  : null,
              ),
              h(
                'div',
                { style: { display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0 } },
                customWalls.length >= 2
                  ? h('button', {
                      type: 'button',
                      className: 'dnb-bound-check',
                      'data-checked': isChecked ? '1' : '0',
                      title: isChecked ? '已勾选，点右上角合并同类规则' : '勾选几条同类规则，可合并成一条',
                      onClick: () => toggleGuardWallSelect(w.id),
                    }, h(Icon, { name: 'check', size: 10.5 }))
                  : null,
                h('button', {
                  type: 'button',
                  className: 'dnb-icon-btn',
                  style: { width: 20, height: 20, flexShrink: 0, color: 'var(--dnb-text-3)' },
                  title: '删除这条规则（AI 无法自己删）',
                  onClick: () => void removeGuardWallApi(w.id),
                }, h(Icon, { name: 'x', size: 11 })),
              ),
            ),
            h('code', {
              style: {
                display: 'block',
                width: '100%',
                fontSize: 11,
                lineHeight: 1.45,
                color: w.activeNow ? 'var(--dnb-coral, #f28b88)' : 'var(--dnb-text-3)',
                fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
                wordBreak: 'break-all',
              },
            }, patText),
            h(
              'div',
              { className: 'dnb-wall-actions-row' },
              [
                { key: 'global', label: bi('全局', 'Global') },
                { key: 'workspace', label: bi('本工程', 'Project') },
                { key: 'paused', label: bi('暂挂', 'Paused') },
              ].map(opt =>
                h('button', {
                  key: opt.key,
                  type: 'button',
                  className: 'dnb-wall-scope-btn',
                  'data-active': w.scope === opt.key ? '1' : '0',
                  onClick: () => { if (w.scope !== opt.key) void setGuardWallScopeApi(w.id, opt.key) },
                }, opt.label)),
            ),
          )
        })
      : h(
          'div',
          { style: { padding: '10px 12px', fontSize: 11, color: 'var(--dnb-text-3)' } },
          bi(
            '暂无其他手写自定义规则。上方预设包已提供常见事前拦截；如需针对本项目的专属拦截，可点右上角「+ 加规则」。',
            'No extra custom rules yet. Built-in presets above already cover common pre-execute guards.',
          ),
        ),
  )
}

function BoundCard({ field, label, dot, items, pinnedItems, view }) {
  const [editingItem, setEditingItem] = React.useState('')
  const [editingVal, setEditingVal] = React.useState('')

  const collapsedCols = (view && view.boundCollapsedCols) || store.boundCollapsedCols || {}
  const isColCollapsed = Boolean(collapsedCols[field])
  const toggleColCollapsed = () => patch({
    boundCollapsedCols: { ...collapsedCols, [field]: !isColCollapsed },
  })

  const draft = (store.boundDraft && store.boundDraft[field]) || ''
  const pinDraft = Boolean(store.boundPinDraft && store.boundPinDraft[field])
  const list = Array.isArray(items) ? items : []
  const pinnedSet = new Set(Array.isArray(pinnedItems) ? pinnedItems : [])
  const selected = ((store.boundSelected && store.boundSelected[field]) || []).filter(x => list.includes(x))
  const full = list.length >= BOUND_CAP
  const isConsolidatingCol = store.boundConsolidating === field

  const commit = () => {
    const text = draft.trim()
    if (!text || full) return
    if (!list.includes(text)) void addBoundRule(field, text, pinDraft)
    else patch({ boundDraft: { ...store.boundDraft, [field]: '' } })
  }

  const saveInlineEdit = () => {
    const nextText = editingVal.trim()
    const prevText = editingItem
    setEditingItem('')
    setEditingVal('')
    if (prevText && nextText && nextText !== prevText) {
      void editBoundRule(field, prevText, nextText)
    }
  }

  const pinnedCountInCol = list.filter(x => pinnedSet.has(x)).length

  const uiLabel = (label === '必须做' || label === '必做事项' || field === 'allowed')
    ? bi('必须做', 'Must Do')
    : ((label === '不要做' || label === '禁止红线' || field === 'forbidden')
        ? bi('不要做', 'Don\'t Do')
        : ((label === '注意' || label === '注意事项' || field === 'notes')
            ? bi('注意', 'Watchouts')
            : label))
  const boundTone = field === 'allowed' ? 'emerald' : (field === 'forbidden' ? 'rose' : 'amber')
  const softDot = field === 'allowed' ? 'var(--dnb-sage, #63d1b0)' : (field === 'forbidden' ? 'var(--dnb-coral, #f28b88)' : (dot || 'var(--dnb-amber, #f3be6d)'))
  return h(
    AccCard,
    {
      open: !isColCollapsed,
      onToggle: toggleColCollapsed,
      tone: boundTone,
      title: uiLabel,
      headTitle: isColCollapsed ? bi(`展开「${uiLabel}」`, `Expand ${uiLabel}`) : bi(`收起「${uiLabel}」`, `Collapse ${uiLabel}`),
      icon: h('span', { style: { width: 7, height: 7, borderRadius: '50%', background: softDot, flexShrink: 0 } }),
      count: list.length ? String(list.length) : '',
      badges: pinnedCountInCol > 0
        ? h('span', { className: 'dnb-acc-badge', 'data-tone': 'amber', style: { display: 'inline-flex', alignItems: 'center', gap: 3 } },
            h(Icon, { name: 'pin', size: 10 }),
            String(pinnedCountInCol))
        : null,
      preview: list.length ? list.slice(0, 2).join('；') : '还没有规则',
      bodyStyle: { padding: 0 },
      actions: list.length >= 2
        ? h('button', {
            type: 'button',
            className: 'dnb-pill',
            style: {
              height: 21,
              padding: '0 7px',
              fontSize: 10.5,
              color: selected.length >= 2 ? 'var(--dnb-primary-fg, #fff)' : 'var(--dnb-accent)',
              background: selected.length >= 2 ? 'var(--dnb-primary-bg, #2563eb)' : 'var(--dnb-accent-soft, rgba(159, 142, 255, 0.14))',
              borderColor: 'var(--dnb-border-strong)',
            },
            disabled: Boolean(store.secBusy),
            title: selected.length >= 2
              ? `把勾选的 ${selected.length} 条规则合并成一条`
              : `把「${label}」下的 ${list.length} 条规则精简成一条`,
            onClick: () => void requestConsolidateBounds(field, selected.length >= 2 ? selected : []),
          },
          h(Icon, { name: 'sparkles', size: 10.5 }),
          isConsolidatingCol
            ? '整理中…'
            : (selected.length >= 2 ? `合并 ${selected.length} 条` : '合并为一条'))
        : null,
    },
    field === 'forbidden'
      ? h('div', {
          style: {
            padding: '6px 12px',
            fontSize: 11,
            lineHeight: 1.45,
            color: 'var(--dnb-text-3)',
            background: 'var(--dnb-coral-soft, rgba(242, 139, 136, 0.08))',
            borderBottom: '1px solid var(--dnb-border)',
          },
        }, bi(
          '说明：开着「安全拦截」时，这里写的高危命令也会顺带拦下；普通文字要求请写到「注意」里。',
          'Note: With Safety Block on, dangerous commands mentioned here may also be blocked; put general reminders under Watchouts.',
        ))
      : null,
    list.map((item, idx) => {
      const isPinned = pinnedSet.has(item)
      const isChecked = selected.includes(item)
      const isRowEditing = editingItem === item

      return h(
        'div',
        {
          key: idx + ':' + item,
          className: 'dnb-cell dnb-cell-hover',
          style: {
            justifyContent: 'space-between',
            gap: 8,
            boxShadow: isPinned ? 'inset 2.5px 0 0 var(--dnb-amber, #f3be6d)' : undefined,
          },
        },
        // Front Pushpin Stamp (小图钉戳)
        h('button', {
          className: 'dnb-pin-stamp',
          'data-pinned': isPinned ? '1' : '0',
          title: isPinned
            ? '已固定到全局，点一下改回仅本次有效'
            : '仅本次有效，点一下固定到全局',
          onClick: () => void toggleBoundPin(field, item, !isPinned),
        }, h(Icon, { name: 'pinStamp', size: 13 })),

        isRowEditing
          ? h('input', {
              className: 'dnb-input',
              style: { flex: 1, height: 26, fontSize: 12, padding: '0 7px' },
              autoFocus: true,
              value: editingVal,
              onChange: e => setEditingVal(e.target.value),
              onBlur: saveInlineEdit,
              onKeyDown: e => {
                if (e.key === 'Enter') saveInlineEdit()
                else if (e.key === 'Escape') {
                  setEditingItem('')
                  setEditingVal('')
                }
              },
            })
          : h(
              'div',
              {
                style: { display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 },
                onDoubleClick: () => {
                  setEditingItem(item)
                  setEditingVal(item)
                },
              },
              isPinned ? h('span', { className: 'dnb-pin-badge' }, '全局') : null,
              h('span', {
                style: {
                  fontSize: 12.5,
                  wordBreak: 'break-word',
                  flex: 1,
                  fontWeight: isPinned ? 500 : 400,
                },
              }, item),
            ),

        h(
          'div',
          { style: { display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 } },
          list.length >= 2 && !isRowEditing
            ? h('button', {
                className: 'dnb-bound-check',
                'data-checked': isChecked ? '1' : '0',
                title: isChecked ? '已勾选，可合并成一条' : '勾选多条规则后合并成一条',
                onClick: () => toggleBoundSelect(field, item),
              }, h(Icon, { name: 'check', size: 10.5 }))
            : null,
          !isRowEditing
            ? h('button', {
                className: 'dnb-icon-btn dnb-row-actions',
                style: { width: 22, height: 22 },
                title: '编辑',
                onClick: () => {
                  setEditingItem(item)
                  setEditingVal(item)
                },
              }, h(Icon, { name: 'edit', size: 11.5 }))
            : null,
          h('button', {
            className: 'dnb-icon-btn dnb-row-actions',
            style: { width: 22, height: 22, color: 'var(--dnb-coral, #f28b88)' },
            title: '删除这条规则',
            onClick: () => void removeBoundRule(field, item),
          }, h(Icon, { name: 'x', size: 12 })),
        ),
      )
    }),
    h(
      'div',
      { className: 'dnb-cell', style: { padding: '6px 10px', gap: 7 } },
      h('button', {
        className: 'dnb-pin-stamp',
        'data-pinned': pinDraft ? '1' : '0',
        title: pinDraft ? '新规则会固定到全局（点图钉切换）' : '新规则仅本次有效（点图钉固定）',
        onClick: () => patch({ boundPinDraft: { ...(store.boundPinDraft || {}), [field]: !pinDraft } }),
      }, h(Icon, { name: 'pinStamp', size: 12.5 })),
      h('input', {
        className: 'dnb-input',
        style: { border: 'none', background: 'transparent', padding: '2px 4px', height: 24, flex: 1 },
        placeholder: full
          ? '已达上限'
          : (pinDraft ? '输入全局规则（所有任务都生效）…' : '输入本任务规则（点左边图钉可固定到全局）…'),
        disabled: full,
        value: draft,
        onChange: e => patch({ boundDraft: { ...store.boundDraft, [field]: e.target.value } }),
        onKeyDown: e => { if (e.key === 'Enter') commit() },
      }),
      draft.trim()
        ? h('button', {
            className: 'dnb-pill dnb-pill-accent',
            style: { height: 24 },
            onClick: commit,
          }, pinDraft ? '📌 固定添加' : '添加')
        : null,
    ),
  )
}

export function BoundariesTab({ store: view }) {
  const [showEnv, setShowEnv] = React.useState(() => (view && view.boundSubTab) === 'env')
  React.useEffect(() => {
    if (view && view.boundSubTab === 'env') setShowEnv(true)
  }, [view && view.boundSubTab])
  React.useEffect(() => {
    if (!view.boundMoreMenuOpen) return
    const close = () => patch({ boundMoreMenuOpen: false })
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [view.boundMoreMenuOpen])

  const bounds = (view.board && view.board.bounds) || {}
  const pinnedBounds = (view.board && view.board.pinnedBounds) || {}
  const hasConsolidatableCol = BOUND_LISTS.some(b => ((bounds[b.field] || []).length >= 2))
  const totalPinnedCount = BOUND_LISTS.reduce((acc, b) => acc + ((pinnedBounds[b.field] || []).length), 0)
  const collapsedCols = view.boundCollapsedCols || {}
  const allSectionsCollapsed = Boolean(view.wallCollapsed)
    && BOUND_LISTS.every(b => Boolean(collapsedCols[b.field]))
  const toggleAllBoundSections = () => {
    if (allSectionsCollapsed) {
      patch({ wallCollapsed: false, boundCollapsedCols: {} })
    } else {
      setShowEnv(false)
      patch({
        wallCollapsed: true,
        boundCollapsedCols: { allowed: true, forbidden: true, notes: true },
      })
    }
  }
  const info = view.boundaries || {}
  const meta = view.chiefMeta || {}
  const globalSafetyOn = meta.globalSafetyGuardEnabled !== false
  const sessionSafetyOn = meta.sessionSafetyGuardEnabled !== false
  const safetyDisabled = Boolean(!globalSafetyOn || !sessionSafetyOn || (meta.tacticalModes && meta.tacticalModes.safetyGuardEnabled === false))
  const wallsList = Array.isArray(view.guardWalls) ? view.guardWalls : []
  const activeWallCount = wallsList.filter(w => w && w.activeNow).length
  const rows = [
    [bi('工作目录', 'Working Dir'), info.sessionWorkingDirectory || info.workingDirectory],
    [bi('沙箱模式', 'Sandbox'), info.sessionSandboxMode || info.sandboxMode],
    [bi('可写路径', 'Writable Root'), info.workspaceRoot],
    [bi('数据文件', 'Board File'), info.boardFile],
    [bi('会话 ID', 'Session ID'), view.sessionId],
  ].filter(([, val]) => val)

  return h(
    'div',
    { className: 'dnb-view' },
    // Section 1: Safety Block (hard pre-tool blocking)
    h(
      'div',
      { 'data-dnb-section': 'bound-walls' },
      h(
        'div',
        { className: 'dnb-bound-sec-head' },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flexWrap: 'wrap' } },
          h('span', { style: { fontSize: 12.5, fontWeight: 550, color: 'var(--dnb-text)', display: 'inline-flex', alignItems: 'center', gap: 5 } },
            h(Icon, { name: 'shieldCheck', size: 13.5, style: { color: 'var(--dnb-sage, #63d1b0)' } }),
            bi('安全拦截', 'Safety Block')),
          h('span', { style: { fontSize: 11, color: 'var(--dnb-text-3)' } }, bi('程序直接拦住，AI 绕不过', 'Enforced before tools run')),
        ),
      ),
      h(
        'div',
        {
          className: 'dnb-safety-banner',
          'data-off': safetyDisabled ? '1' : '0',
        },
        h(
          'div',
          { style: { flex: '1 1 200px', minWidth: 0 } },
          h(
            'div',
            { className: 'dnb-safety-banner-title' },
            h(Icon, { name: safetyDisabled ? 'shieldOff' : 'shieldCheck', size: 13 }),
            safetyDisabled
              ? (!globalSafetyOn
                  ? bi('自动防误操作 · 已关闭（全部对话）', 'Auto Protection · Off (All Chats)')
                  : bi('自动防误操作 · 已关闭（当前对话）', 'Auto Protection · Off (This Chat)'))
              : bi('自动防误操作 · 已开启', 'Auto Protection · On'),
          ),
          h(
            'div',
            { className: 'dnb-safety-banner-sub' },
            safetyDisabled
              ? bi(
                  `已放行内置拦截${activeWallCount ? `（下方仍有 ${activeWallCount} 条自定义规则生效）` : ''}`,
                  `Built-in blocks bypassed${activeWallCount ? ` (${activeWallCount} custom rule(s) still active below)` : ''}`,
                )
              : bi(
                  '自动拦住删文件、改项目外文件、读 .env/密钥等危险操作',
                  'Blocks risky file deletes, edits outside workspace, and secret reads',
                ),
          ),
        ),
        safetyDisabled
          ? h('button', {
              type: 'button',
              className: 'dnb-primary-btn',
              style: { height: 26, padding: '0 10px', fontSize: 11, flexShrink: 0 },
              onClick: () => void updateSecConfig(
                !globalSafetyOn
                  ? { globalSafetyGuardEnabled: true, ...(!sessionSafetyOn ? { tacticalModes: { safetyGuardEnabled: true } } : {}) }
                  : { tacticalModes: { safetyGuardEnabled: true } },
              ),
            }, bi('一键开启', 'Enable'))
          : h('button', {
              type: 'button',
              className: 'dnb-pill',
              style: { height: 26, padding: '0 10px', fontSize: 11, flexShrink: 0 },
              onClick: () => patch({
                safetyGuardModalOpen: true,
                safetyGuardModalScope: 'session',
                safetyGuardAgreed: false,
                safetyGuardPauseWalls: activeWallCount > 0,
              }),
            }, bi('关闭', 'Turn Off')),
      ),
      h(GuardWallsCard, { view }),
    ),
    // Section 2: Guidelines for AI (prompt-injected rules)
    h(
      'div',
      { 'data-dnb-section': 'bound-rules' },
      h(
        'div',
        { className: 'dnb-bound-sec-head', style: { marginTop: 16 } },
      h(
        'div',
        {
          style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flexWrap: 'wrap' },
          title: bi(
            `已固定 ${totalPinnedCount} 条全局规矩（点图钉切换）`,
            `${totalPinnedCount} global rules pinned (click pin to toggle)`,
          ),
        },
        h('span', { style: { fontSize: 12.5, fontWeight: 550, color: 'var(--dnb-text)', display: 'inline-flex', alignItems: 'center', gap: 5 } },
          h(Icon, { name: 'listChecks', size: 13.5, style: { color: 'var(--dnb-accent)' } }),
          bi('给 AI 的规矩', 'Rules for AI')),
        totalPinnedCount > 0
          ? h('span', { className: 'dnb-acc-count', style: { fontSize: 10.5, display: 'inline-flex', alignItems: 'center', gap: 3 } },
              h(Icon, { name: 'pin', size: 10 }),
              String(totalPinnedCount))
          : null,
        h('span', { style: { fontSize: 11, color: 'var(--dnb-text-3)' } }, bi('每轮提醒 AI 照着做', 'Shown to AI every turn')),
      ),
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 5, marginLeft: 'auto', flexShrink: 0 } },
        h('button', {
          className: 'dnb-pill',
          style: { height: 25, padding: '0 9px', fontSize: 11 },
          disabled: view.secBusy,
          title: '让参谋长根据本次踩坑整理出新规矩',
          onClick: () => {
            void submitChiefBar(
              '请结合当前会话的踩坑撞墙记录、工具权限约束与工作约定，简明分点总结给 AI 的工作规矩，并务必完整填入 JSON 的 boundProposals 数组向我发起请示（若提到具体条文请每条都放进 boundProposals）。',
              'extract_bounds',
            )
          },
        }, h(Icon, { name: 'sparkles', size: 11 }), view.secBusy && view.chiefQuickAction === 'extract_bounds' ? '提炼中…' : (view.secBusy && !view.boundConsolidating ? '提炼中…' : '提炼新规矩')),
        h(
          'div',
          { className: 'dnb-more-wrap', onClick: e => e.stopPropagation() },
          h('button', {
            type: 'button',
            className: 'dnb-pill',
            style: { height: 25, padding: '0 7px', fontSize: 11 },
            'data-active': view.boundMoreMenuOpen ? '1' : '0',
            title: '更多规矩操作',
            onClick: () => patch({ boundMoreMenuOpen: !view.boundMoreMenuOpen }),
          }, '⋯'),
          view.boundMoreMenuOpen
            ? h(
                'div',
                { className: 'dnb-more-menu', style: { minWidth: 184 } },
                h('button', {
                  type: 'button',
                  className: 'dnb-more-item',
                  onClick: () => {
                    patch({ boundMoreMenuOpen: false })
                    toggleAllBoundSections()
                  },
                }, h('span', null, allSectionsCollapsed ? '↕ 全部展开' : '↕ 全部收起')),
                hasConsolidatableCol
                  ? h('button', {
                      type: 'button',
                      className: 'dnb-more-item',
                      disabled: view.secBusy,
                      title: '让参谋长把零散、重复的规矩合并精简',
                      onClick: () => {
                        patch({ boundMoreMenuOpen: false })
                        void requestConsolidateBounds('', [])
                      },
                    }, h('span', null, view.boundConsolidating === 'all' ? '整理中…' : '✦ 全部精简合并'))
                  : null,
              )
            : null,
        ),
      ),
    ),
    BOUND_LISTS.map(b =>
      h(BoundCard, {
        key: b.field,
        field: b.field,
        label: b.label,
        dot: b.dot,
        items: bounds[b.field] || [],
        pinnedItems: pinnedBounds[b.field] || [],
        view,
      }),
    ),
    ),
    h(
      'div',
      { 'data-dnb-section': 'bound-env' },
      h(
        AccCard,
        {
          open: showEnv,
          onToggle: () => setShowEnv(v => !v),
          tone: 'slate',
          title: bi('运行环境', 'Runtime Info'),
          count: rows.length ? String(rows.length) : '',
          preview: info.sessionWorkingDirectory || info.workingDirectory || info.workspaceRoot || '',
          bodyStyle: { padding: 0 },
        },
        rows.map(([k, v]) =>
          h(
            'div',
            {
              key: k,
              className: 'dnb-cell dnb-cell-hover',
              style: { justifyContent: 'space-between', cursor: 'pointer' },
              title: '点击复制',
              onClick: () => copyText(v, '已复制 ' + k),
            },
            h('span', { style: { fontSize: 11.5, color: 'var(--dnb-text-3)', flexShrink: 0 } }, k),
            h('span', {
              style: {
                fontSize: 11,
                color: 'var(--dnb-text-2)',
                fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: '68%',
              },
            }, String(v)),
          ),
        ),
      ),
    ),
  )
}

/* ------------------------------------------- DSH Chief Core Views */
