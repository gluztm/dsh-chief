/**
 * src/client/components/modals/intervention.js — 参谋介入授权、无限轮次、托管与离家预设确认弹窗
 *
 * 【核心职责】
 *   承载 `InterventionConfirmModal`（含 `MODAL_WALL_TYPE_TAG`）、`UnlimitedTurnsConfirmModal`、
 *   `AutoPilotConfirmModal` 与 `AwayPresetConfirmModal`，把控参谋接管深度与托管预算风险确认。
 *
 * 【边界约定】
 *   - 专注参谋介入级别与托管行为确认弹窗；高危工具操作审批见 `modals/safety.js`。
 */

import { React, h } from '../../react-runtime.js'
import { INTERVENTION_TIER_DESC } from '../../constants.js'
import { bi } from '../../i18n.js'
import { patch } from '../../store.js'
import { normalizeMaxTurnsVal } from '../../utils.js'
import { call, updateSecConfig, applyScenarioPreset } from '../../api.js'
import { Icon } from '../common.js'

const MODAL_WALL_TYPE_TAG = {
  forbid_cmd: '🚫 禁跑命令',
  forbid_path: '🚧 禁碰路径',
  restrict_write: '🔐 仅限目录可写',
  require_approval_cmd: '🛡️ 高危命令先请示',
  deny_tool: '⛔ 禁用工具',
}

export function InterventionConfirmModal({ view, board }) {
  const meta = view.chiefMeta || {}
  const tm = meta.tacticalModes || {}
  const rawBounds = (board && board.bounds) || (view.board && view.board.bounds) || {}
  const savedBoardObj = (board && board.objective) ? String(board.objective).trim() : ''
  const forbiddenList = (Array.isArray(rawBounds.forbidden) ? rawBounds.forbidden : [])
    .map(f => (typeof f === 'string' ? f.trim() : String((f && f.text) || '').trim()))
    .filter(Boolean)
  const allWalls = Array.isArray(view.guardWalls) ? view.guardWalls : []
  const activeWalls = allWalls.filter(w => w && w.scope !== 'paused' && w.activeNow !== false)
  const pausedWallsCount = allWalls.filter(w => w && w.scope === 'paused').length

  const [objDraft, setObjDraft] = React.useState(savedBoardObj)
  const [objLocked, setObjLocked] = React.useState(false)
  const [objFlashRed, setObjFlashRed] = React.useState(false)
  const [objGuardHint, setObjGuardHint] = React.useState('')
  const [suggestBusy, setSuggestBusy] = React.useState(false)
  const [suggestHistory, setSuggestHistory] = React.useState([])
  const [lastAiText, setLastAiText] = React.useState('')
  const [lastWasAiGuess, setLastWasAiGuess] = React.useState(false)
  const [suggestRationale, setSuggestRationale] = React.useState('')
  const [confirmBusy, setConfirmBusy] = React.useState(false)
  const [wallsSecCollapsed, setWallsSecCollapsed] = React.useState(false)
  const [redlinesSecCollapsed, setRedlinesSecCollapsed] = React.useState(false)
  const objBoxRef = React.useRef(null)

  React.useEffect(() => {
    if (!view.interventionModalOpen) return
    setObjDraft(savedBoardObj)
    setObjLocked(false)
    setObjFlashRed(false)
    setObjGuardHint('')
    setSuggestBusy(false)
    setSuggestHistory([])
    setLastAiText('')
    setLastWasAiGuess(false)
    setSuggestRationale('')
    setConfirmBusy(false)
    setWallsSecCollapsed(false)
    setRedlinesSecCollapsed(false)
  }, [view.interventionModalOpen])

  if (!view.interventionModalOpen) return null
  const permMode = ['advisor', 'assistant', 'strategist', 'chief'].includes(meta.permissionMode) ? meta.permissionMode : 'advisor'
  const trimmedDraft = String(objDraft || '').trim()
  const triggerObjRedFlash = (hintMsg) => {
    setObjGuardHint(hintMsg || '请先写好总目标，再点右上角「锁定目标」，然后开启强介入。')
    setObjFlashRed(false)
    const fire = () => setObjFlashRed(true)
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fire)
    else setTimeout(fire, 16)
    try {
      if (objBoxRef.current && typeof objBoxRef.current.scrollIntoView === 'function') {
        objBoxRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    } catch {}
  }
  const noDefenseRules = activeWalls.length === 0 && forbiddenList.length === 0
  const allDefenseCollapsed = wallsSecCollapsed && redlinesSecCollapsed
  const toggleAllDefense = () => {
    const next = !allDefenseCollapsed
    setWallsSecCollapsed(next)
    setRedlinesSecCollapsed(next)
  }

  const handleSuggestObjective = async () => {
    if (suggestBusy) return
    if (objLocked) {
      patch({ notice: '目标已锁定，先点「已锁定目标」解锁后再改。' })
      return
    }
    const curText = String(objDraft || '').trim()
    const shouldGuess = !curText || (lastWasAiGuess && lastAiText && curText === lastAiText.trim())
    const nextMode = shouldGuess ? 'guess' : 'refine'
    setSuggestBusy(true)
    try {
      const out = await call('chief/suggest-objective', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          session: view.sessionId,
          draft: curText,
          mode: nextMode,
          previousSuggestions: suggestHistory,
        }),
      })
      if (out && out.suggestion) {
        const nextText = String(out.suggestion).trim()
        setObjDraft(nextText)
        setLastAiText(nextText)
        setLastWasAiGuess(nextMode === 'guess')
        setSuggestHistory(prev => prev.concat(nextText).slice(-12))
        setSuggestRationale(String(out.rationale || ''))
      }
    } catch (error) {
      patch({ error: String((error && error.message) || error) })
    } finally {
      setSuggestBusy(false)
    }
  }

  return h(
    'div',
    {
      className: 'dnb-modal-backdrop',
      onClick: e => {
        if (e.target === e.currentTarget && !confirmBusy) patch({ interventionModalOpen: false })
      },
    },
    h(
      'div',
      { className: 'dnb-modal-card', style: { maxHeight: '86vh', overflowY: 'auto' } },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h('span', { style: { fontSize: 13.5, fontWeight: 700, color: '#f59e0b' } }, '⚡ 开启强介入：确认目标与安全规则'),
        h('button', {
          type: 'button',
          className: 'dnb-icon-btn',
          style: { width: 22, height: 22 },
          disabled: confirmBusy,
          onClick: () => patch({ interventionModalOpen: false }),
        }, h(Icon, { name: 'x', size: 13 })),
      ),
      // Core Objective Destination Editor inside Modal (建议 + 必须先点选锁定)
      h(
        'div',
        {
          ref: objBoxRef,
          className: objFlashRed ? 'dnb-obj-flash-red' : undefined,
          style: {
            borderRadius: 9,
            padding: '9px 10px',
            border: objLocked
              ? '1px solid rgba(245, 158, 11, 0.58)'
              : '1.5px solid rgba(255, 69, 58, 0.62)',
            background: objLocked ? 'rgba(245, 158, 11, 0.08)' : 'rgba(255, 69, 58, 0.06)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            fontSize: 11.5,
          },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' } },
          h('span', { style: { fontWeight: 700, color: objLocked ? 'var(--dnb-text)' : '#ff6961' } },
            objLocked
              ? '🎯 总目标（已锁定，开启后马上开始）'
              : '🎯 总目标（写好后请点右侧「锁定目标」）'),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 5 } },
            h('button', {
              type: 'button',
              className: 'dnb-mini-btn',
              'data-tone': 'blue',
              disabled: suggestBusy || objLocked,
              title: trimmedDraft && !(lastWasAiGuess && trimmedDraft === lastAiText.trim())
                ? '根据你写的内容，让参谋长帮你改得更清楚'
                : '让参谋长按当前对话帮你写一个目标，可多点几次换个写法',
              onClick: () => void handleSuggestObjective(),
            }, suggestBusy
              ? '生成中…'
              : (trimmedDraft && !(lastWasAiGuess && trimmedDraft === lastAiText.trim()) ? '✦ 帮我改改' : '✦ 帮我写')),
            h('button', {
              type: 'button',
              className: 'dnb-mini-btn',
              'data-tone': objLocked ? 'amber' : 'red',
              title: objLocked ? '点一下解锁就能修改' : '确认目标没问题后点这里锁定',
              onClick: () => {
                if (!objLocked && !trimmedDraft) {
                  triggerObjRedFlash('请先写清楚总目标，再点「锁定目标」。')
                  return
                }
                setObjLocked(v => {
                  const nextLocked = !v
                  if (nextLocked) {
                    setObjFlashRed(false)
                    setObjGuardHint('')
                  }
                  return nextLocked
                })
              },
            }, objLocked ? '🔒 已锁定目标' : '🔓 锁定目标'),
          ),
        ),
        h('textarea', {
          className: 'dnb-input',
          rows: 3,
          readOnly: objLocked,
          placeholder: '写下你要完成的目标；留空直接点右上角「✦ 帮我写」也可以…',
          style: {
            width: '100%',
            minHeight: 62,
            padding: '7px 9px',
            borderRadius: 7,
            fontSize: 12,
            lineHeight: 1.45,
            resize: 'vertical',
            borderColor: !objLocked ? 'rgba(255, 69, 58, 0.52)' : undefined,
            opacity: objLocked ? 0.88 : 1,
            cursor: objLocked ? 'not-allowed' : 'text',
          },
          value: objDraft,
          onChange: e => {
            if (objLocked) return
            setObjDraft(e.target.value)
            setLastWasAiGuess(false)
            if (objFlashRed) setObjFlashRed(false)
            if (objGuardHint) setObjGuardHint('')
          },
        }),
        suggestRationale
          ? h('div', { style: { fontSize: 11, color: '#60a5fa', lineHeight: 1.4 } }, '💡 为什么这么定：' + suggestRationale)
          : null,
        h('div', { style: { fontSize: 11, color: 'var(--dnb-text-3)', lineHeight: 1.4 } },
          !trimmedDraft
            ? h('span', { style: { color: '#ff6961', fontWeight: 600 } }, objGuardHint || '⚠ 请先写好目标（也可以点「✦ 帮我写」），然后点「锁定目标」。')
            : (!objLocked
                ? h('span', { style: { color: '#ff6961', fontWeight: 600 } }, objGuardHint || '⚠ 还差一步：点右上角「🔓 锁定目标」，才能开启强介入。')
                : '✓ 目标已锁定。点下方按钮就会马上按这个目标往下跑，不用再发“继续”。')),
      ),
      // Live Boundaries & Guard Walls Readback (Physical Guard Walls + Forbidden Redlines)
      h(
        'div',
        {
          style: {
            borderRadius: 9,
            padding: '8px 10px',
            border: noDefenseRules ? '1px solid rgba(255, 69, 58, 0.48)' : '1px solid var(--dnb-border)',
            background: noDefenseRules ? 'rgba(255, 69, 58, 0.08)' : 'var(--dnb-card)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            fontSize: 11.5,
          },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', minWidth: 0 } },
            h('strong', null, '🛡️ 安全规则检查：'),
            noDefenseRules
              ? h('span', { style: { color: '#ff453a', fontWeight: 600 } }, '还没设物理驻墙和禁止红线（直接自动跑风险较高）')
              : h(
                  React.Fragment,
                  null,
                  h('span', { style: { color: activeWalls.length > 0 ? '#f87171' : 'var(--dnb-text-3)', fontWeight: 700 } },
                    `🧱 物理驻墙 ${activeWalls.length} 条`),
                  h('span', { style: { color: 'var(--dnb-text-3)' } }, '·'),
                  h('span', { style: { color: forbiddenList.length > 0 ? '#34d399' : 'var(--dnb-text-3)', fontWeight: 700 } },
                    `🚫 禁止红线 ${forbiddenList.length} 条`),
                ),
          ),
          h(
            'div',
            { style: { display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0 } },
            !noDefenseRules
              ? h('button', {
                  type: 'button',
                  className: 'dnb-mini-btn',
                  title: allDefenseCollapsed ? '展开查看物理驻墙和红线详情' : '收起物理驻墙和红线详情',
                  onClick: toggleAllDefense,
                }, allDefenseCollapsed ? '↕ 一键拉开' : '↕ 一键收起')
              : null,
            h('button', {
              type: 'button',
              className: 'dnb-mini-btn',
              'data-tone': noDefenseRules ? 'amber' : 'blue',
              onClick: () => patch({ interventionModalOpen: false, tab: 'boundaries', settingsOpen: false }),
            }, '管理边界'),
          ),
        ),
        // Sub-section 1: Physical Guard Walls
        h(
          'div',
          {
            style: {
              borderRadius: 7,
              border: '1px solid rgba(248, 113, 113, 0.28)',
              background: 'rgba(239, 68, 68, 0.05)',
              overflow: 'hidden',
            },
          },
          h(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 6,
                padding: '5px 8px',
                cursor: 'pointer',
                userSelect: 'none',
              },
              onClick: () => setWallsSecCollapsed(v => !v),
            },
            h('span', { style: { fontSize: 11, fontWeight: 700, color: '#f87171' } },
              `🧱 物理驻墙（踩线直接拦住 · 已生效 ${activeWalls.length} 条${pausedWallsCount > 0 ? ` · ${pausedWallsCount} 条暂停` : ''}）`),
            h(Icon, {
              name: 'chevron',
              size: 12,
              style: {
                color: 'var(--dnb-text-3)',
                transform: wallsSecCollapsed ? 'none' : 'rotate(90deg)',
                transition: 'transform 0.16s ease',
              },
            }),
          ),
          !wallsSecCollapsed
            ? h(
                'div',
                { style: { padding: '0 8px 6px', display: 'flex', flexDirection: 'column', gap: 3.5 } },
                activeWalls.length > 0
                  ? [
                      ...activeWalls.slice(0, 4).map(w => {
                        const scopeTag = w.scope === 'workspace' ? '📁当前项目' : '🌐全局'
                        const typeTag = MODAL_WALL_TYPE_TAG[w.ruleType] || w.ruleType
                        const patStr = Array.isArray(w.patterns) ? w.patterns.join(', ') : ''
                        const previewPat = patStr.length > 52 ? patStr.slice(0, 52) + '…' : patStr
                        return h(
                          'div',
                          { key: w.id, style: { fontSize: 11, color: 'var(--dnb-text-2)', lineHeight: 1.45, wordBreak: 'break-word' } },
                          h('span', { style: { color: '#fca5a5', fontWeight: 600 } }, `• [${scopeTag} · ${typeTag}] `),
                          h('span', { style: { color: 'var(--dnb-text)', fontWeight: 600 } }, w.title || ''),
                          previewPat
                            ? h('span', { style: { color: 'var(--dnb-text-3)', fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 10.5 } }, ` — ${previewPat}`)
                            : null,
                        )
                      }),
                      activeWalls.length > 4
                        ? h('div', { key: 'more-walls', style: { fontSize: 10.5, color: 'var(--dnb-text-3)' } },
                            `…还有 ${activeWalls.length - 4} 条物理驻墙正在生效`)
                        : null,
                    ]
                  : h('div', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)' } },
                      '还没设物理驻墙（可点右上角「管理边界」添加）'),
              )
            : null,
        ),
        // Sub-section 2: Forbidden Redlines
        h(
          'div',
          {
            style: {
              borderRadius: 7,
              border: '1px solid var(--dnb-border)',
              background: 'rgba(148, 163, 184, 0.05)',
              overflow: 'hidden',
            },
          },
          h(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 6,
                padding: '5px 8px',
                cursor: 'pointer',
                userSelect: 'none',
              },
              onClick: () => setRedlinesSecCollapsed(v => !v),
            },
            h('span', { style: { fontSize: 11, fontWeight: 700, color: forbiddenList.length > 0 ? '#34d399' : 'var(--dnb-text-2)' } },
              `🚫 禁止红线（全局和当前规则 · 共 ${forbiddenList.length} 条）`),
            h(Icon, {
              name: 'chevron',
              size: 12,
              style: {
                color: 'var(--dnb-text-3)',
                transform: redlinesSecCollapsed ? 'none' : 'rotate(90deg)',
                transition: 'transform 0.16s ease',
              },
            }),
          ),
          !redlinesSecCollapsed
            ? h(
                'div',
                { style: { padding: '0 8px 6px', display: 'flex', flexDirection: 'column', gap: 3 } },
                forbiddenList.length > 0
                  ? [
                      ...forbiddenList.slice(0, 4).map((item, idx) =>
                        h('div', {
                          key: idx,
                          style: { fontSize: 11, color: 'var(--dnb-text-2)', lineHeight: 1.45, wordBreak: 'break-word' },
                        }, '• ' + (item.length > 88 ? item.slice(0, 88) + '…' : item)),
                      ),
                      forbiddenList.length > 4
                        ? h('div', { key: 'more-redlines', style: { fontSize: 10.5, color: 'var(--dnb-text-3)' } },
                            `…还有 ${forbiddenList.length - 4} 条禁止红线正在生效`)
                        : null,
                    ]
                  : h('div', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)' } }, '还没设禁止红线'),
              )
            : null,
        ),
      ),
      // 3 Concrete Operational Risks + 4-Tier Permission Behavior
      h(
        'div',
        { style: { fontSize: 11.5, color: 'var(--dnb-text-2)', lineHeight: 1.55 } },
        h('div', { style: { fontWeight: 600, color: 'var(--dnb-text)', marginBottom: 3 } }, '开启后会发生什么（请注意风险）：'),
        h('div', { style: { color: '#60a5fa', marginBottom: 4, fontWeight: 600 } },
          `• 当前权限：${INTERVENTION_TIER_DESC[permMode] || INTERVENTION_TIER_DESC.advisor}`),
        h('div', null, '• 会多花 Token：主对话每次停下来，参谋长都会检查一遍，还可能继续发消息。'),
        h('div', null, '• 会主动插话：参谋长会自己插话或安排下一步；点红色「⏹ 急停」能随时停下。'),
        h('div', null, `• 卡住会自动停：到 ${normalizeMaxTurnsVal(tm.maxInterventionTurns) === 0 ? '♾️ 不限轮数' : (normalizeMaxTurnsVal(tm.maxInterventionTurns) + ' 轮')} 或连续没进展时，会自动停下来防止死循环。`),
      ),
      // Dual Mandatory Disclaimers
      h(
        'div',
        { className: 'dnb-disclaimer-box' },
        h('div', { style: { marginBottom: 4 } },
          h('strong', null, '说明 1（效果看模型）：'),
          '参谋长检查准不准、能不能守住红线，很依赖你选的模型能力。不同模型理解规则的稳定度不一样，效果也会有差别。',
        ),
        h('div', null,
          h('strong', null, '说明 2（规则冲突）：'),
          '如果主对话或项目里设了太多系统规则，可能会和这里的自动提示打架，导致提前停机或跑偏。',
        ),
      ),
      // Explicit Checkbox Agreement
      h(
        'label',
        { style: { display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 11.5, color: 'var(--dnb-text)', cursor: 'pointer', lineHeight: 1.45 } },
        h('input', {
          type: 'checkbox',
          checked: Boolean(view.interventionAgreed),
          style: { marginTop: 2 },
          onChange: e => patch({ interventionAgreed: Boolean(e.target.checked) }),
        }),
        '我已核对好目标和安全规则，了解模型和规则可能带来的影响，确认开启强介入。',
      ),
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 } },
        h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: { height: 32, padding: '0 14px', fontSize: 12.5 },
          onClick: () => patch({ interventionModalOpen: false, interventionAgreed: false }),
        }, '取消'),
        h('button', {
          type: 'button',
          className: 'dnb-primary-btn',
          style: {
            height: 32,
            padding: '0 15px',
            fontSize: 12.5,
            background: '#f59e0b',
            color: '#111',
            fontWeight: 700,
            opacity: (view.interventionAgreed && objLocked && trimmedDraft && !confirmBusy) ? 1 : 0.48,
          },
          disabled: confirmBusy,
          onClick: async () => {
            if (!trimmedDraft) {
              triggerObjRedFlash('⚠ 请先写好总目标，并点「锁定目标」，再开启强介入。')
              return
            }
            if (!objLocked) {
              triggerObjRedFlash('⚠ 请先点右上角的「🔓 锁定目标」，锁定后再开启强介入。')
              return
            }
            if (!view.interventionAgreed) {
              patch({ notice: '请先勾选下面的确认框' })
              return
            }
            setConfirmBusy(true)
            try {
              const curMax = normalizeMaxTurnsVal(tm.maxInterventionTurns)
              const ok = await updateSecConfig({
                tacticalModes: { ...tm, intervention: true, maxInterventionTurns: curMax },
                confirmedInterventionRisk: true,
                ...(curMax === 0 ? { confirmedUnlimitedTurns: true } : {}),
                coreObjective: trimmedDraft,
                objectiveLocked: true,
                startImmediately: true,
              })
              if (ok) patch({ interventionModalOpen: false, interventionAgreed: false })
            } finally {
              setConfirmBusy(false)
            }
          },
        }, confirmBusy ? '正在开启…' : '确认锁定并开启'),
      ),
    ),
  )
}

export function UnlimitedTurnsConfirmModal({ view }) {
  if (!view.unlimitedTurnsModalOpen) return null
  const meta = view.chiefMeta || {}
  const tm = meta.tacticalModes || {}
  return h(
    'div',
    {
      className: 'dnb-modal-backdrop',
      onClick: e => {
        if (e.target === e.currentTarget) patch({ unlimitedTurnsModalOpen: false })
      },
    },
    h(
      'div',
      { className: 'dnb-modal-card' },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h('span', { style: { fontSize: 13.5, fontWeight: 700, color: '#f59e0b' } }, '♾️ 开启不限轮数自动推进 — 风险确认'),
        h('button', {
          type: 'button',
          className: 'dnb-icon-btn',
          style: { width: 24, height: 24 },
          onClick: () => patch({ unlimitedTurnsModalOpen: false }),
        }, h(Icon, { name: 'x', size: 13 })),
      ),
      h(
        'div',
        { className: 'dnb-disclaimer-box' },
        h('div', { style: { marginBottom: 4 } },
          h('strong', null, '会一直往下推：'),
          '开启后，只要参谋长觉得任务还没做完，就会一直发指令让它继续跑，不再限制轮数。',
        ),
        h('div', null,
          h('strong', null, '费钱且可能反复拉锯：'),
          '遇到难题时，两边模型可能来回讨论很久，花掉大量 Token。只有连续 8 轮没新进展才会自动停，你随时可以点「⏹ 急停」或把模式切回「⏸ 关停」。',
        ),
      ),
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 } },
        h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: { height: 32, padding: '0 14px', fontSize: 12.5 },
          onClick: () => patch({ unlimitedTurnsModalOpen: false }),
        }, '还是限制轮数'),
        h('button', {
          type: 'button',
          className: 'dnb-primary-btn',
          style: { height: 32, padding: '0 15px', fontSize: 12.5, background: '#f59e0b', color: '#111', fontWeight: 700 },
          onClick: async () => {
            const ok = await updateSecConfig({
              tacticalModes: { ...tm, maxInterventionTurns: 0 },
              confirmedUnlimitedTurns: true,
            })
            if (ok) patch({ unlimitedTurnsModalOpen: false })
          },
        }, '确认不限轮数'),
      ),
    ),
  )
}

export function AutoPilotConfirmModal({ view }) {
  if (!view.autoPilotConfirmOpen) return null
  return h(
    'div',
    {
      className: 'dnb-modal-backdrop',
      onClick: e => {
        if (e.target === e.currentTarget) patch({ autoPilotConfirmOpen: false })
      },
    },
    h(
      'div',
      { className: 'dnb-modal-card' },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h('span', { style: { fontSize: 13.5, fontWeight: 700, color: '#34d399' } },
          bi('🤖 开启托管模式：确认后台整理与费用上限', '🤖 Enable Managed Mode: Cleanup & Budget Limits')),
        h('button', {
          type: 'button',
          className: 'dnb-icon-btn',
          style: { width: 24, height: 24 },
          onClick: () => patch({ autoPilotConfirmOpen: false }),
        }, h(Icon, { name: 'x', size: 13 })),
      ),
      h(
        'div',
        { className: 'dnb-disclaimer-box' },
        h('div', { style: { marginBottom: 4 } },
          h('strong', null, bi('1. 后台盯着进度（不串台）：', '1. Watch progress per chat: ')),
          bi(
            '参谋长会按你的权限等级（L0–L3）盯着目标和红线，出错或断线时帮忙续上。它不会改全局固定红线，也不会翻看长期冷库资料。',
            'Watches goals and rules under your permission level (L0–L3) and resumes dropped chats. Never edits global pinned rules or cold archives.',
          ),
        ),
        h('div', { style: { marginBottom: 4 } },
          h('strong', null, bi('2. 🌙 后台「梦境漫游」轻拢卷宗：', '2. 🌙 Background Dream Roam: ')),
          bi(
            'L1+ 权限时，后台会自动将未织钩子草稿与刚撤下桌面的卷宗分拣入抽屉并织就轻量钩子（只做收纳梳理，不改代码，不擅自回推桌面）。',
            'At L1+, sorts unhooked drafts into archive folders and weaves keyword hooks without modifying code.',
          ),
        ),
        h('div', null,
          h('strong', null, bi('3. 闲置自动停机与费用上限：', '3. Auto-pause & spending cap: ')),
          bi(
            '闲置满 15 分钟（或目标完成且没待办）会自动切回「⏸ 关停」。达到费用上限时也会立刻停下，帮你省钱。',
            'Switches back to ⏸ Off after 15m idle with no open tasks, or right away if the budget cap is reached.',
          ),
        ),
      ),
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 } },
        h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: { height: 32, padding: '0 14px', fontSize: 12.5 },
          onClick: () => patch({ autoPilotConfirmOpen: false }),
        }, bi('暂不开启', 'Cancel')),
        h('button', {
          type: 'button',
          className: 'dnb-primary-btn',
          style: { height: 32, padding: '0 15px', fontSize: 12.5, fontWeight: 700 },
          onClick: async () => {
            const ok = await updateSecConfig({
              runMode: 'managed',
              paceMode: 'auto',
              autoPilot: true,
              confirmedAutoPilot: true,
            })
            if (ok) patch({ autoPilotConfirmOpen: false })
          },
        }, bi('🤖 确认开启托管', '🤖 Confirm Managed Mode')),
      ),
    ),
  )
}

export function AwayPresetConfirmModal({ view }) {
  if (!view.awayPresetModalOpen) return null
  const agreed = Boolean(view.awayPresetAgreed)
  const busy = Boolean(view.chiefRiskBusy)
  return h(
    'div',
    {
      className: 'dnb-modal-backdrop',
      onClick: e => {
        if (e.target === e.currentTarget && !busy) patch({ awayPresetModalOpen: false, awayPresetAgreed: false })
      },
    },
    h(
      'div',
      { className: 'dnb-modal-card' },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h('span', { style: { fontSize: 13.5, fontWeight: 700, color: '#f59e0b' } },
          bi('🚀 开启「离桌托管」预设', '🚀 Enable "Away Mode" Preset')),
        h('button', {
          type: 'button',
          className: 'dnb-icon-btn',
          style: { width: 22, height: 22 },
          disabled: busy,
          onClick: () => patch({ awayPresetModalOpen: false, awayPresetAgreed: false }),
        }, h(Icon, { name: 'x', size: 13 })),
      ),
      h(
        'div',
        { className: 'dnb-risk-box' },
        h('div', { style: { fontSize: 12.5, fontWeight: 700, color: '#f59e0b' } },
          bi('⚠️ 开启后会同时打开以下设置（仍受物理驻墙和红线限制）：', '⚠️ Turns on these settings (still bound by guard walls and rules):')),
        h(
          'ul',
          { style: { margin: '0 0 0 18px', padding: 0, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--dnb-text)' } },
          h('li', null, bi('权限升到 L3 · 参谋长模式（可自动调度对话和子代理、断线续跑）', 'Permission: L3 · Chief (auto-guides chats, subagents, and resumes)')),
          h('li', null, bi('工作方式切到 🤖 托管（后台盯进度，用梦境漫游整理档案，闲置 15 分钟自动停）', 'Run mode: 🤖 Managed (watches progress, runs Dream Roam cleanup, auto-pauses after 15m idle)')),
          h('li', null, bi('对话满 80% 自动压缩，并开启 🛡 红线哨兵提醒越界风险', 'Auto-compacts at 80% context and turns on 🛡 Sentinel alerts')),
          h('li', null, bi('设置费用上限（30 次调用或 300K Tokens 自动停），关键节点发桌面通知', 'Stops at budget limit (30 calls or 300K tokens) and sends desktop alerts')),
        ),
      ),
      h(
        'label',
        { className: 'dnb-risk-check' },
        h('input', {
          type: 'checkbox',
          checked: agreed,
          disabled: busy,
          style: { marginTop: 3 },
          onChange: e => patch({ awayPresetAgreed: Boolean(e.target.checked) }),
        }),
        h('span', null, bi(
          '我已了解 L3 高权限和自动托管的风险，确认开启「离桌托管」。',
          'I understand the L3 and auto-managed risks, and confirm enabling Away Mode.',
        )),
      ),
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
        h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: { height: 32, padding: '0 14px', fontSize: 12.5 },
          disabled: busy,
          onClick: () => patch({ awayPresetModalOpen: false, awayPresetAgreed: false }),
        }, bi('取消', 'Cancel')),
        h('button', {
          type: 'button',
          className: 'dnb-primary-btn',
          style: {
            height: 32,
            padding: '0 16px',
            fontSize: 12.5,
            background: agreed ? '#d97706' : 'var(--dnb-fill)',
            color: agreed ? '#fff' : 'var(--dnb-text-3)',
            fontWeight: 700,
          },
          disabled: !agreed || busy,
          onClick: async () => {
            patch({ chiefRiskBusy: true })
            try {
              const ok = await applyScenarioPreset('away', {
                confirmedChiefRisk: true,
                confirmedAutoPilot: true,
              })
              if (ok) patch({ awayPresetModalOpen: false, awayPresetAgreed: false })
            } finally {
              patch({ chiefRiskBusy: false })
            }
          },
        }, busy ? bi('正在开启…', 'Enabling…') : bi('确认开启离桌托管', 'Enable Away Mode')),
      ),
    ),
  )
}

