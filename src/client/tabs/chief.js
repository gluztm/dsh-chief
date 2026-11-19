/**
 * tabs/chief.js
 *
 * Chief situation view tab and composer bar.
 */

import { React, h } from '../react-runtime.js'
import {
  CHIEF_PERMISSION_LABELS,
  INTERVENTION_TIER_DESC,
  FACT_CATEGORIES,
  FACT_CAT_LABEL,
  FACT_CAT_TONE,
  RELAY_MODES,
  SEC_MAX_IMAGES,
  THINKING_EFFORT_OPTIONS,
} from '../constants.js'
import { store, patch, runtimeRefs } from '../store.js'
import {
  normalizeMaxTurnsVal,
  clampTitle,
  timeLabel,
  relativeTimeLabel,
  shortModelName,
  shortAgentName,
} from '../utils.js'
import {
  loadChiefView,
  updateSecConfig,
  mutateFact,
  ingestSecImageFiles,
  submitChiefBar,
  refresh,
  toggleSyncHandoffOnDigest,
} from '../api.js'
import {
  Icon,
  Switch,
  EffortFanGauge,
  renderStructuredHeading,
  parseNarrativeBlocks,
  renderStructuredItem,
  renderStructuredText,
  parseSixGoalBrief,
  orderChatHistoryNewestFirst,
  groupChatHistoryTurnsNewestFirst,
} from '../components/common.js'
import { MemoryTab } from './plan.js'

export function isReceiptChatItem(item) {
  if (!item || typeof item !== 'object') return false
  if (item.kind === 'receipt') return true
  if (item.kind === 'qa') return false
  if (item.role !== 'chief') return false
  const acts = Array.isArray(item.actions) ? item.actions : []
  if (acts.length > 0) return true
  return /^\s*-?\s*【(?:✅|⛔|⚠️|🛡️|🔐|📋|⚡|已允许|已拒绝|已批准|已执行|统一执行)/.test(String(item.text || ''))
}

export function ChiefTab({ board, view }) {
  const [showHistory, setShowHistory] = React.useState(true)
  const [chatFilter, setChatFilter] = React.useState('all')
  const [editingFactId, setEditingFactId] = React.useState('')
  const [editingFactText, setEditingFactText] = React.useState('')

  React.useEffect(() => {
    void loadChiefView(false)
  }, [view.sessionId])

  React.useEffect(() => {
    if (!view.chiefMoreMenuOpen) return
    const close = () => patch({ chiefMoreMenuOpen: false })
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [view.chiefMoreMenuOpen])

  const sec = view.secView || {}

  const subTab = view.secSubTab || 'digest'
  const narrative = sec.narrative || {}
  const facts = Array.isArray(sec.facts) ? sec.facts : []
  const chat = Array.isArray(sec.chat) ? sec.chat : []
  const notes = (board && Array.isArray(board.notes)) ? board.notes : []
  const isConciseMode = Boolean(view.chiefMeta && view.chiefMeta.tacticalModes && view.chiefMeta.tacticalModes.conciseBrief)
  const sixGoalRows = parseSixGoalBrief(narrative.text || '')
  const useSixBriefCards = Boolean(sixGoalRows && (isConciseMode || sixGoalRows.length >= 4))
  const blocks = parseNarrativeBlocks(narrative.text || '')

  const submitNewFact = () => {
    const txt = String(view.secNewFactText || '').trim()
    if (!txt) return
    const cat = view.secNewFactCat || 'discipline'
    patch({ secNewFactText: '' })
    void mutateFact({ op: 'add', text: txt, category: cat })
  }

  return h(
    'div',
    { className: 'dnb-view' },
    // Sub-view Segmented Pills
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 10 } },
      h(
        'div',
        { style: { display: 'flex', gap: 5 } },
        h('button', {
          className: 'dnb-pill',
          'data-active': subTab === 'digest' ? '1' : '0',
          onClick: () => patch({ secSubTab: 'digest' }),
        }, '摘要'),
        h('button', {
          className: 'dnb-pill',
          'data-active': subTab !== 'digest' ? '1' : '0',
          onClick: () => patch({ secSubTab: 'facts' }),
        }, '纪律与条目', facts.length ? h('span', { className: 'dnb-seg-dot' }, String(facts.length)) : null),
      ),
      subTab === 'digest'
        ? (() => {
            const hState = (board && board.handoff) || {}
            const hMeta = view.handoffMeta || {}
            const isHandoffPinned = Boolean(hState.pinned || hMeta.pinned)
            const syncOnDigest = Boolean(hState.syncOnDigest ?? hMeta.syncOnDigest)
            return h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end' } },
              h('button', {
                type: 'button',
                className: 'dnb-pill',
                style: { height: 25, padding: '0 9px', fontSize: 11, gap: 4 },
                disabled: Boolean(view.secBusy),
                title: '向参谋长咨询当前局势与可行建议（无建议或超出能力范围会直接说明，不强行凑执行）',
                onClick: () => void submitChiefBar(
                  '请结合当前任务进展、对话上下文、边界红线与团队状态，给我坦诚、接地气的参谋建议：当前有什么需要关注的卡点或更好的推进方向？若一切顺利暂无建议，或涉及非参谋与会话能处理的事项，直接实话告诉我即可，不要强行凑执行项。',
                  'consult_chief',
                ),
              }, h(Icon, { name: 'sparkles', size: 11 }), '咨询'),
              h('button', {
                className: 'dnb-pill',
                style: {
                  height: 25,
                  padding: '0 10px',
                  fontSize: 11,
                  gap: 4,
                  color: (!view.secRegenerating && !narrative.summarizing && narrative.hasUnsummarizedChanges)
                    ? 'var(--dnb-accent)'
                    : undefined,
                },
                disabled: view.secRegenerating || narrative.summarizing,
                title: narrative.hasUnsummarizedChanges
                  ? '上下文有新进展，点击让参谋长按需提炼最新摘要（平时后台不空转耗费 Token）'
                  : '立即让参谋长提炼结构化摘要',
                onClick: () => void loadChiefView(true, { syncHandoff: !isHandoffPinned && syncOnDigest }),
              },
                (view.secRegenerating || narrative.summarizing)
                  ? h(Icon, { name: 'refresh', size: 11, style: { animation: 'dnb-spin 0.9s linear infinite' } })
                  : h(Icon, { name: 'sparkles', size: 11 }),
                (view.secRegenerating || narrative.summarizing) ? '提炼中…' : '提炼摘要',
                (!view.secRegenerating && !narrative.summarizing && narrative.hasUnsummarizedChanges)
                  ? h('span', {
                      style: {
                        width: 5,
                        height: 5,
                        borderRadius: '50%',
                        background: 'var(--dnb-accent)',
                        flexShrink: 0,
                      },
                    })
                  : null,
              ),
              h(
                'div',
                { className: 'dnb-more-wrap', onClick: e => e.stopPropagation() },
                h('button', {
                  type: 'button',
                  className: 'dnb-pill',
                  style: { height: 25, padding: '0 7px', fontSize: 11 },
                  'data-active': view.chiefMoreMenuOpen ? '1' : '0',
                  title: '更多交接与摘要选项',
                  onClick: () => patch({ chiefMoreMenuOpen: !view.chiefMoreMenuOpen }),
                }, '⋯'),
                view.chiefMoreMenuOpen
                  ? h(
                      'div',
                      { className: 'dnb-more-menu', style: { minWidth: 196 } },
                      h('button', {
                        type: 'button',
                        className: 'dnb-more-item',
                        'data-active': (!isHandoffPinned && syncOnDigest) ? '1' : '0',
                        disabled: isHandoffPinned,
                        title: isHandoffPinned
                          ? '交接单已被人类定住锁定，参谋长不可覆盖；如需恢复同步请前往「规划」页解除定住'
                          : '开启后，点击「提炼摘要」完成时会自动一键同步更新交接单',
                        onClick: () => {
                          patch({ chiefMoreMenuOpen: false })
                          void toggleSyncHandoffOnDigest(!syncOnDigest)
                        },
                      },
                        h('span', null, isHandoffPinned ? '🔒 交接已定住' : '提炼时自动同步交接单'),
                        h('span', { style: { fontSize: 10.5, opacity: 0.78 } }, isHandoffPinned ? '锁定' : (syncOnDigest ? '开' : '关')),
                      ),
                      h('div', { className: 'dnb-more-sep' }),
                      h('button', {
                        type: 'button',
                        className: 'dnb-more-item',
                        disabled: isHandoffPinned || view.secRegenerating || narrative.summarizing,
                        title: isHandoffPinned ? '交接单已被人类定住，无法一键同步覆盖' : '将当前参谋摘要与态势一键写入交接单',
                        onClick: () => {
                          patch({ chiefMoreMenuOpen: false })
                          void loadChiefView(false, { syncHandoff: true })
                        },
                      }, h('span', null, isHandoffPinned ? '🔒 交接已定住' : '↪ 立即更新交接单')),
                    )
                  : null,
              ),
            )
          })()
        : null,
    ),

    // Sub-view 1: Concise 6-Sentence Goal Brief or Standard Structured Digest
    subTab === 'digest'
      ? h(
          React.Fragment,
          null,
          h(
            'div',
            { className: 'dnb-prose-card' },
            h(
              'div',
              { className: 'dnb-prose-meta' },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0, flexWrap: 'wrap' } },
                h('span', { style: { fontWeight: 600, fontSize: 13.5, color: 'var(--dnb-text)' } },
                  useSixBriefCards ? '⚡ 极简目标战报' : '摘要'),
                h('span', { style: { fontSize: 11.5, color: 'var(--dnb-text-3)' } },
                  (narrative.summarizing || view.secRegenerating)
                    ? '正在提炼最新上下文…'
                    : narrative.isLiveZeroToken
                      ? '实时看板速览 · 零 Token（按需点右上角提炼）'
                      : ((narrative.at ? '更新于 ' + relativeTimeLabel(narrative.at) : '已提炼')
                          + (narrative.hasUnsummarizedChanges ? ' · 有新进展待提炼' : ''))),
              ),
              narrative.byModel
                ? h('span', {
                    className: 'dnb-tag',
                    style: { fontSize: 10, flexShrink: 0, opacity: 0.78 },
                    title: narrative.byModel,
                  }, shortModelName(narrative.byModel, view.secModelsCatalog || (sec && sec.models), true))
                : null,
            ),
            useSixBriefCards
              ? h(
                  'div',
                  { className: 'dnb-six-brief' },
                  sixGoalRows.map(row =>
                    h(
                      'div',
                      { key: row.key, className: 'dnb-six-row' },
                      h(
                        'span',
                        {
                          className: 'dnb-six-tag',
                          style: { color: row.color, background: row.bg },
                        },
                        row.key,
                      ),
                      h('span', { style: { flex: 1, fontSize: 12.2, color: 'var(--dnb-text)', lineHeight: 1.5 } }, row.body),
                    ),
                  ),
                )
              : blocks.length
                ? blocks.map((blk, i) =>
                    h(
                      'div',
                      { key: i, style: { marginTop: i === 0 ? 0 : 12 } },
                      blk.heading ? renderStructuredHeading(blk.heading, false) : null,
                      (blk.items || []).map((it, j) => renderStructuredItem(it, `${i}-${j}`)),
                    ),
                  )
                : h('p', { className: 'dnb-prose-p' },
                    '当前会话尚未沉淀持久规矩或阶段结论。你可以在下方许愿框直接立规矩、整档案、定边界或吩咐参谋长调度。'),
          ),

          // Partitioned Chief Q&A Turn Collections vs System / Execution Receipts
          chat.length > 0
            ? (() => {
                const turns = groupChatHistoryTurnsNewestFirst(chat.slice(-32))
                const qaCount = turns.filter(t => t.kind === 'turn').length
                const receiptCount = turns.filter(t => t.replies.some(r => isReceiptChatItem(r))).length
                const filteredTurns = chatFilter === 'receipt'
                  ? turns.filter(t => t.replies.some(r => isReceiptChatItem(r)))
                  : (chatFilter === 'qa' ? turns.filter(t => t.kind === 'turn') : turns)

                const formatChiefReplyEffortBadge = (it) => {
                  const eff = String((it && it.thinkingEffort) || '').trim().toLowerCase()
                  if (!eff) return ''
                  const opt = THINKING_EFFORT_OPTIONS.find(o => o.key === eff)
                  const label = opt ? opt.shortLabel : eff
                  return (it && it.thinkingEffortMode === 'auto') ? `🪄 自动→${label}` : `🧠 ${label}`
                }

                const renderTurnReplyCard = (item) => {
                  const isReceipt = isReceiptChatItem(item)
                  const effortBadge = formatChiefReplyEffortBadge(item)
                  return h(
                    'div',
                    {
                      key: item.id,
                      className: 'dnb-turn-reply-item',
                      'data-role': isReceipt ? 'receipt' : (item.role === 'chief' ? 'chief' : 'user'),
                    },
                    h(
                      'div',
                      { style: { display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: 'var(--dnb-text-3)', gap: 6, flexWrap: 'wrap' } },
                      h(
                        'div',
                        { style: { display: 'flex', alignItems: 'center', gap: 5 } },
                        isReceipt
                          ? h('span', { className: 'dnb-receipt-badge' },
                              item.isOneStopReport
                                ? '🏁 一站式战报回执'
                                : (item.resumeTaskId ? '⚡ 授权续跑回执' : '📋 执行回执'))
                          : h('span', { className: 'dnb-qa-badge', 'data-role': 'chief' }, '✦ 参谋回答'),
                      ),
                      h(
                        'div',
                        { style: { display: 'flex', alignItems: 'center', gap: 5 } },
                        effortBadge
                          ? h('span', {
                              className: 'dnb-chat-effort-badge',
                              title: item.thinkingEffortMode === 'auto' ? '自适应换挡本次实际生效思考强度' : '本次回复固定思考强度',
                            }, effortBadge)
                          : null,
                        h('span', null, timeLabel(item.at)),
                      ),
                    ),
                    renderStructuredText(item.text),
                    Array.isArray(item.actions) && item.actions.length
                      ? h(
                          'div',
                          { style: { display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 } },
                          item.actions.map((actTag, idx) =>
                            h('span', { key: idx, className: 'dnb-tag', style: { color: isReceipt ? '#34d399' : 'var(--dnb-accent)' } }, actTag)),
                        )
                      : null,
                  )
                }

                return h(
                  'div',
                  { className: 'dnb-group' },
                  h(
                    'div',
                    {
                      className: 'dnb-cell dnb-cell-hover',
                      style: { cursor: 'pointer', justifyContent: 'space-between', padding: '8px 12px', gap: 6, flexWrap: 'wrap' },
                      onClick: () => setShowHistory(v => !v),
                    },
                    h('span', { style: { fontSize: 12, color: 'var(--dnb-text-2)', fontWeight: 600 } },
                      '参谋问答与执行回执'),
                    (() => {
                      const collapsedMap = view.qaCollapsedTurnIds || {}
                      const allTurnsCollapsed = showHistory && filteredTurns.length > 0 && filteredTurns.every(t => Boolean(collapsedMap[t.id]))
                      return h(
                        'div',
                        { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }, onClick: e => e.stopPropagation() },
                        h(
                          'div',
                          { className: 'dnb-text-filter-bar', style: { padding: 0, gap: 3 } },
                          [
                            { key: 'all', label: `全部 ${turns.length}` },
                            { key: 'qa', label: `问答 ${qaCount}` },
                            { key: 'receipt', label: `回执 ${receiptCount}` },
                          ].map(opt =>
                            h('button', {
                              key: opt.key,
                              type: 'button',
                              className: 'dnb-text-filter-btn',
                              'data-active': chatFilter === opt.key ? '1' : '0',
                              onClick: () => {
                                setChatFilter(opt.key)
                                if (!showHistory) setShowHistory(true)
                              },
                            }, opt.label),
                          ),
                          filteredTurns.length > 0
                            ? h('button', {
                                type: 'button',
                                className: 'dnb-text-filter-btn',
                                style: { marginLeft: 2 },
                                title: allTurnsCollapsed ? '展开全部会话条目' : '收起全部会话条目',
                                onClick: () => {
                                  if (!showHistory) {
                                    setShowHistory(true)
                                    patch({ qaCollapsedTurnIds: {} })
                                    return
                                  }
                                  if (allTurnsCollapsed) {
                                    patch({ qaCollapsedTurnIds: {} })
                                  } else {
                                    const nextMap = {}
                                    for (const t of filteredTurns) nextMap[t.id] = true
                                    patch({ qaCollapsedTurnIds: nextMap })
                                  }
                                },
                              }, allTurnsCollapsed ? '全展开' : '全收起')
                            : null,
                        ),
                        h('button', {
                          type: 'button',
                          className: 'dnb-icon-btn',
                          style: { width: 20, height: 20 },
                          onClick: () => setShowHistory(v => !v),
                        }, h(Icon, {
                          name: 'chevron',
                          size: 13,
                          style: {
                            color: 'var(--dnb-text-3)',
                            transform: showHistory ? 'rotate(90deg)' : 'none',
                            transition: 'transform 0.18s ease',
                          },
                        })),
                      )
                    })(),
                  ),
                  showHistory
                    ? (filteredTurns.length > 0
                        ? h(
                            'div',
                            { className: 'dnb-qa-stream' },
                            filteredTurns.map(turn => {
                              const q = turn.question
                              const repliesToShow = chatFilter === 'receipt' && turn.kind === 'system'
                                ? turn.replies.filter(r => isReceiptChatItem(r))
                                : turn.replies
                              const collapsedMap = view.qaCollapsedTurnIds || {}
                              const isTurnCollapsed = Boolean(collapsedMap[turn.id])
                              const toggleTurn = () => patch({
                                qaCollapsedTurnIds: {
                                  ...(view.qaCollapsedTurnIds || {}),
                                  [turn.id]: !isTurnCollapsed,
                                },
                              })
                              return h(
                                'div',
                                {
                                  key: turn.id,
                                  className: 'dnb-qa-turn-box',
                                  'data-turn-kind': turn.kind,
                                  'data-collapsed': isTurnCollapsed ? '1' : '0',
                                },
                                q
                                  ? h(
                                      'div',
                                      {
                                        className: 'dnb-turn-question',
                                        title: isTurnCollapsed ? '点击拉开该轮对话与回执' : '点击收起该轮对话与回执',
                                        onClick: toggleTurn,
                                      },
                                      h(
                                        'div',
                                        { style: { display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: 'var(--dnb-text-3)', gap: 6 } },
                                        h(
                                          'div',
                                          { style: { display: 'flex', alignItems: 'center', gap: 5 } },
                                          h('span', { className: 'dnb-qa-badge', 'data-role': 'user' }, '🙋 你的提问'),
                                          repliesToShow.length > 0
                                            ? h('span', { style: { fontSize: 10, color: 'var(--dnb-text-3)' } }, `含 ${repliesToShow.length} 条回复/回执`)
                                            : null,
                                        ),
                                        h(
                                          'div',
                                          { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
                                          h('span', null, timeLabel(q.at)),
                                          h(Icon, {
                                            name: 'chevron',
                                            size: 12,
                                            style: {
                                              color: 'var(--dnb-text-3)',
                                              transform: isTurnCollapsed ? 'none' : 'rotate(90deg)',
                                              transition: 'transform 0.16s ease',
                                            },
                                          }),
                                        ),
                                      ),
                                      !isTurnCollapsed && q.imageCount > 0
                                        ? h(
                                            'div',
                                            {
                                              style: {
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: 4,
                                                padding: '1px 7px',
                                                width: 'fit-content',
                                                borderRadius: 999,
                                                background: 'rgba(10, 132, 255, 0.15)',
                                                color: '#409cff',
                                                fontSize: 10.5,
                                                fontWeight: 600,
                                              },
                                            },
                                            `🖼 附图 ×${q.imageCount}`,
                                          )
                                        : null,
                                      q.text
                                        ? h('div', {
                                            style: isTurnCollapsed
                                              ? {
                                                  fontSize: 12,
                                                  color: 'var(--dnb-text)',
                                                  lineHeight: 1.45,
                                                  overflow: 'hidden',
                                                  textOverflow: 'ellipsis',
                                                  whiteSpace: 'nowrap',
                                                }
                                              : { fontSize: 12, color: 'var(--dnb-text)', lineHeight: 1.5, whiteSpace: 'pre-wrap' },
                                          }, q.text)
                                        : null,
                                    )
                                  : h(
                                      'div',
                                      {
                                        className: 'dnb-turn-question',
                                        title: isTurnCollapsed ? '点击拉开该组回执' : '点击收起该组回执',
                                        onClick: toggleTurn,
                                      },
                                      h(
                                        'div',
                                        { style: { display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: 'var(--dnb-text-3)', gap: 6 } },
                                        h(
                                          'div',
                                          { style: { display: 'flex', alignItems: 'center', gap: 5 } },
                                          h('span', { className: 'dnb-receipt-badge' }, '📋 系统回执集合'),
                                          repliesToShow.length > 0
                                            ? h('span', { style: { fontSize: 10, color: 'var(--dnb-text-3)' } }, `含 ${repliesToShow.length} 条回执`)
                                            : null,
                                        ),
                                        h(
                                          'div',
                                          { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
                                          turn.at ? h('span', null, timeLabel(turn.at)) : null,
                                          h(Icon, {
                                            name: 'chevron',
                                            size: 12,
                                            style: {
                                              color: 'var(--dnb-text-3)',
                                              transform: isTurnCollapsed ? 'none' : 'rotate(90deg)',
                                              transition: 'transform 0.16s ease',
                                            },
                                          }),
                                        ),
                                      ),
                                    ),
                                !isTurnCollapsed && repliesToShow.length > 0
                                  ? h(
                                      'div',
                                      { className: 'dnb-turn-replies' },
                                      repliesToShow.map(renderTurnReplyCard),
                                    )
                                  : null,
                              )
                            }),
                          )
                        : h('div', { className: 'dnb-cell', style: { fontSize: 11.5, color: 'var(--dnb-text-3)' } },
                            chatFilter === 'receipt' ? '暂无执行与系统回执记录' : '暂无问答对话记录'))
                    : null,
                )
              })()
            : null,
        )
      : h(
          React.Fragment,
          null,
          // Quick Add Durable Fact
            h(
              'div',
              { className: 'dnb-group', style: { padding: 8, marginBottom: 10 } },
              h(
                'div',
                { style: { display: 'flex', gap: 6, alignItems: 'center' } },
                h('select', {
                  className: 'dnb-input',
                  style: { width: 74, height: 28, padding: '0 6px', borderRadius: 99, fontSize: 11.5, flexShrink: 0 },
                  value: view.secNewFactCat || 'discipline',
                  onChange: e => patch({ secNewFactCat: e.target.value }),
                }, FACT_CATEGORIES.map(c => h('option', { key: c.key, value: c.key }, c.label))),
                h('input', {
                  className: 'dnb-input',
                  style: { height: 28, borderRadius: 99, padding: '0 11px', fontSize: 12 },
                  placeholder: '立一条长期规矩或团队约定…',
                  value: view.secNewFactText || '',
                  onChange: e => patch({ secNewFactText: e.target.value }),
                  onKeyDown: e => { if (e.key === 'Enter') submitNewFact() },
                }),
                (view.secNewFactText || '').trim()
                  ? h('button', { className: 'dnb-primary-btn', style: { height: 28, padding: '0 10px' }, onClick: submitNewFact }, '记住')
                  : null,
              ),
            ),

            facts.length
              ? h(
                  'div',
                  { className: 'dnb-group' },
                  facts.map(fact => {
                    const isEditing = editingFactId === fact.id
                    return h(
                      'div',
                      { key: fact.id, className: 'dnb-cell dnb-cell-hover', style: { flexDirection: 'column', alignItems: 'flex-start', gap: 5 } },
                      h(
                        'div',
                        { style: { display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 6 } },
                        h(
                          'div',
                          { style: { display: 'flex', alignItems: 'center', gap: 5 } },
                          fact.pinned ? h(Icon, { name: 'pin', size: 11.5, style: { color: 'var(--dnb-accent)' } }) : null,
                          (() => {
                            const ft = FACT_CAT_TONE[fact.category]
                            return h('span', {
                              className: 'dnb-tag',
                              style: ft ? { background: ft.bg, color: ft.fg, border: '1px solid ' + ft.border } : undefined,
                            }, FACT_CAT_LABEL[fact.category] || '条目')
                          })(),
                          h('span', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)' } }, relativeTimeLabel(fact.updatedAt || fact.addedAt)),
                        ),
                        h(
                          'div',
                          { className: 'dnb-row-actions' },
                          h('button', {
                            className: 'dnb-icon-btn',
                            style: { width: 22, height: 22, color: fact.pinned ? 'var(--dnb-accent)' : undefined },
                            title: fact.pinned ? '取消锁定（允许参谋长自动修订）' : '锁定置顶',
                            onClick: () => void mutateFact({ op: 'pin', id: fact.id, pinned: !fact.pinned }),
                          }, h(Icon, { name: 'pin', size: 11.5 })),
                          h('button', {
                            className: 'dnb-icon-btn',
                            style: { width: 22, height: 22 },
                            title: '编辑',
                            onClick: () => {
                              setEditingFactId(isEditing ? '' : fact.id)
                              setEditingFactText(fact.text || '')
                            },
                          }, h(Icon, { name: 'edit', size: 11.5 })),
                          h('button', {
                            className: 'dnb-icon-btn',
                            style: { width: 22, height: 22, color: '#ff453a' },
                            title: '删除',
                            onClick: () => void mutateFact({ op: 'remove', id: fact.id }),
                          }, h(Icon, { name: 'trash', size: 11.5 })),
                        ),
                      ),
                      isEditing
                        ? h(
                            'div',
                            { style: { display: 'flex', width: '100%', gap: 6, marginTop: 2 } },
                            h('input', {
                              className: 'dnb-input',
                              style: { height: 28, fontSize: 12 },
                              value: editingFactText,
                              onChange: e => setEditingFactText(e.target.value),
                              onKeyDown: e => {
                                if (e.key === 'Enter' && editingFactText.trim()) {
                                  void mutateFact({ op: 'edit', id: fact.id, text: editingFactText.trim(), category: fact.category })
                                  setEditingFactId('')
                                }
                              },
                            }),
                            h('button', {
                              className: 'dnb-primary-btn',
                              style: { height: 28, padding: '0 10px' },
                              onClick: () => {
                                if (!editingFactText.trim()) return
                                void mutateFact({ op: 'edit', id: fact.id, text: editingFactText.trim(), category: fact.category })
                                setEditingFactId('')
                              },
                            }, '保存'),
                          )
                        : h('div', { style: { fontSize: 12.5, color: 'var(--dnb-text)', lineHeight: 1.55, wordBreak: 'break-word' } }, fact.text),
                    )
                  }),
                )
              : h('div', { className: 'dnb-empty', style: { padding: '18px 12px' } }, '暂无持久纪律条目'),

            // Collapsible Raw Turn Memory (Original MemoryTab)
            h(
              'div',
              { className: 'dnb-group', style: { marginTop: 10 } },
              h(
                'div',
                {
                  className: 'dnb-cell dnb-cell-hover',
                  style: { cursor: 'pointer', justifyContent: 'space-between' },
                  onClick: () => patch({ secShowRawTurns: !view.secShowRawTurns }),
                },
                h('span', { style: { fontSize: 12, color: 'var(--dnb-text-2)', fontWeight: 500 } },
                  '每轮原始自动流水记录' + (view.memCount ? ' (' + view.memCount + ')' : '')),
                h(Icon, {
                  name: 'chevron',
                  size: 13,
                  style: {
                    color: 'var(--dnb-text-3)',
                    transform: view.secShowRawTurns ? 'rotate(90deg)' : 'none',
                    transition: 'transform 0.18s ease',
                  },
                }),
              ),
            ),
            view.secShowRawTurns ? h(MemoryTab, { board }) : null,
          ),
  )
}

/* ------------------------------------------- Cross-Conversation Peers Tab */

export function ChiefComposerBar({ view, barRef }) {
  const fileInputRef = React.useRef(null)
  const secImages = Array.isArray(view.secImages) ? view.secImages : []
  const canSend = (Boolean((view.secInput || '').trim()) || secImages.length > 0) && !view.secBusy
  const peers = (view.secView && Array.isArray(view.secView.peers)) ? view.secView.peers : []
  const fallbackChildren = Array.isArray(view.subagents)
    ? view.subagents.filter(a => a && a.name && a.name !== 'lead').map(a => ({
        key: a.name,
        name: a.name,
        kind: 'subagent',
        status: a.status,
      }))
    : []
  const rawTargetChips = peers.length
    ? peers
    : [{ key: 'lead', name: '主对话', kind: 'lead', status: 'idle' }, ...fallbackChildren]
  // Keep running & lead targets first, and hide idle internal mnemon probes so horizontal bar stays crisp
  const targetChips = [...rawTargetChips]
    .filter(p => p.key === 'lead' || p.status === 'running' || p.key === (view.secTarget || '') || !/^mnemon-review/i.test(String(p.name || p.key || '')))
    .sort((a, b) => {
      if (a.key === 'lead') return -1
      if (b.key === 'lead') return 1
      const ra = a.status === 'running' ? 1 : 0
      const rb = b.status === 'running' ? 1 : 0
      return rb - ra
    })

  const activeTarget = view.secTarget || 'auto'
  const activePeer = targetChips.find(p => p.key === activeTarget) || null
  const modeObj = RELAY_MODES.find(m => m.key === (view.secMode || 'steer')) || RELAY_MODES[0]
  const meta = view.chiefMeta || {}
  const tm = meta.tacticalModes || {}
  const guard = meta.runtimeGuard || {}
  const permMode = ['advisor', 'assistant', 'strategist', 'chief'].includes(meta.permissionMode)
    ? meta.permissionMode
    : 'advisor'
  const PERM_OPTIONS = [
    {
      key: 'advisor',
      tier: 'L0',
      icon: '👁',
      shortLabel: 'L0 顾问',
      title: 'L0 · 顾问模式',
      code: 'READ ONLY',
      badgeText: '默认模式',
      badgeTone: 'green',
      bullets: [
        '读取看板和允许访问的项目状态',
        '分析任务、提供建议',
        '不修改工作区',
        '不修改主代理和子代理工作流',
      ],
      footer: '只观察、只分析、只建议。',
    },
    {
      key: 'assistant',
      tier: 'L1',
      icon: '🧰',
      shortLabel: 'L1 助手',
      title: 'L1 · 助手模式',
      code: 'ASSISTANT',
      badgeText: '',
      badgeTone: '',
      bullets: [
        '顾问模式全部能力',
        '管理自己的参谋系统',
        '修改自己的记忆、档案和看板配置',
        '不直接修改项目工作区',
        '不接管主代理工作流',
      ],
      footer: '允许自主维护参谋系统。',
    },
    {
      key: 'strategist',
      tier: 'L2',
      icon: '🛡️',
      shortLabel: 'L2 参谋',
      title: 'L2 · 参谋模式',
      code: 'ADVISOR WITH APPROVAL',
      badgeText: '逐项授权',
      badgeTone: 'blue',
      bullets: [
        '助手模式全部能力',
        '可以申请修改工作区文件',
        '可以申请修改主对话和子代理工作流',
        '每项受控操作执行前弹窗',
        '用户确认后才能执行',
      ],
      footer: 'Agent 提出操作，用户决定是否执行。',
    },
    {
      key: 'chief',
      tier: 'L3',
      icon: '⚡',
      shortLabel: 'L3 参谋长',
      title: 'L3 · 参谋长模式',
      code: 'CHIEF OF STAFF',
      badgeText: '主动风险知悉',
      badgeTone: 'amber',
      bullets: [
        '参谋模式全部能力',
        '获得更高的自主执行权限',
        '可以切换主代理',
        '可以协调子代理及其工作流',
        '启用前必须阅读风险声明并主动勾选确认',
      ],
      footer: '用户明确接受更高自主权带来的操作风险。',
    },
  ]
  const activePermObj = PERM_OPTIONS.find(p => p.key === permMode) || PERM_OPTIONS[0]
  const pendingApprovalsList = (Array.isArray(meta.pendingApprovals) ? meta.pendingApprovals : [])
    .filter(item => item && item.status === 'pending')
  const pendingElevationObj = (meta.pendingElevation && meta.pendingElevation.status === 'pending')
    ? meta.pendingElevation
    : null
  const auditCount = Array.isArray(meta.auditLog) ? meta.auditLog.length : 0
  const maxTurns = normalizeMaxTurnsVal(tm.maxInterventionTurns)
  const isUnlimitedTurns = maxTurns === 0
  const pct = Math.min(95, Math.max(10, Math.round(Number(tm.compactThresholdPct) || 80)))
  const thresholdMode = tm.compactThresholdMode === 'tokens' ? 'tokens' : 'pct'
  const thresholdTokensNum = Math.max(4000, Number(tm.compactThresholdTokens) || 64000)
  const thresholdInputVal = view.compactInputDraft !== null && view.compactInputDraft !== undefined
    ? String(view.compactInputDraft)
    : String(tm.compactThresholdInput || '64K')
  const isLowTokenThreshold = thresholdMode === 'tokens' && thresholdTokensNum < 32000
  const isLowPctThreshold = thresholdMode === 'pct' && pct < 25
  const pctSelectChoices = Array.from(new Set([10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, pct])).sort((a, b) => a - b)
  const isSmartCompact = Boolean(tm.smartCompact)
  const activeChipsCount = (tm.intervention ? 1 : 0)
    + (tm.autoCompact ? 1 : 0)
    + (tm.redlineSentinel ? 1 : 0)
  const commitTokenThresholdInput = (rawText) => {
    const valStr = String(rawText ?? '').trim() || '64K'
    void updateSecConfig({
      tacticalModes: {
        ...tm,
        compactThresholdMode: 'tokens',
        compactThresholdInput: valStr,
      },
    })
  }
  const toggleTacticalField = (key, val) => {
    if (key === 'intervention' && val === true) {
      patch({ tacticalMenuOpen: false, unlimitedTurnsModalOpen: false, interventionModalOpen: true, interventionAgreed: false })
      return
    }
    if (key === 'maxInterventionTurns') {
      if (val === 0 || val === '0') {
        if (!isUnlimitedTurns) {
          patch({ tacticalMenuOpen: false, unlimitedTurnsModalOpen: true })
        }
        return
      }
      const safeN = Math.min(30, Math.max(1, Math.round(Number(val) || 1)))
      void updateSecConfig({ tacticalModes: { ...tm, maxInterventionTurns: safeN } })
      return
    }
    if (key === 'compactThresholdPct') {
      const targetPct = Math.min(95, Math.max(10, Math.round(Number(val) || 80)))
      void updateSecConfig({ tacticalModes: { ...tm, compactThresholdMode: 'pct', compactThresholdPct: targetPct } })
      return
    }
    if (key === 'compactThresholdMode') {
      const nextM = val === 'tokens' ? 'tokens' : 'pct'
      patch({ compactInputDraft: null })
      void updateSecConfig({ tacticalModes: { ...tm, compactThresholdMode: nextM } })
      return
    }
    if (key === 'smartCompact') {
      const nextSmart = Boolean(val)
      void updateSecConfig({
        tacticalModes: {
          ...tm,
          smartCompact: nextSmart,
          ...(nextSmart ? { autoCompact: true } : {}),
        },
      })
      return
    }
    void updateSecConfig({ tacticalModes: { ...tm, [key]: val } })
  }
  const placeholder = secImages.length > 0
    ? ('已附 ' + secImages.length + ' 张图，回车可直接发送或补充说明…')
    : (activeTarget === 'auto'
        ? '✦ 许愿框：整理/提炼档案、设定边界、重设任务、调整协同网络或吩咐参谋长…'
        : activeTarget === 'all'
          ? '向全体成员广播（' + modeObj.label + '）…'
          : ('给 @' + shortAgentName(activePeer ? activePeer.name : activeTarget, true) + ' ' + modeObj.label + '…'))

  return h(
    'div',
    {
      ref: barRef,
      className: 'dnb-sec-bar',
      'data-dragover': view.secDragOver ? '1' : '0',
      onDragOver: e => {
        if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
          e.preventDefault()
          if (!view.secDragOver) patch({ secDragOver: true })
        }
      },
      onDragLeave: e => {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          if (view.secDragOver) patch({ secDragOver: false })
        }
      },
      onDrop: e => {
        e.preventDefault()
        patch({ secDragOver: false })
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
          void ingestSecImageFiles(e.dataTransfer.files)
        }
      },
    },
    // Tactical Cockpit Popover (Anchored above `+` button)
    view.tacticalMenuOpen
      ? h(
          'div',
          {
            className: 'dnb-tactical-pop',
          },
          h(
            'div',
            { className: 'dnb-tactical-head' },
            h('span', { style: { fontSize: 12, fontWeight: 700, color: 'var(--dnb-text)' } }, '🎛 参谋长战术驾驶舱'),
            h('button', {
              type: 'button',
              className: 'dnb-icon-btn',
              style: { width: 20, height: 20 },
              onClick: () => patch({ tacticalMenuOpen: false }),
            }, h(Icon, { name: 'x', size: 12 })),
          ),
          h(
            'div',
            { className: 'dnb-tactical-body' },
          // Row 1: Intervention + Max Turns Stepper
          h(
            'div',
            { className: 'dnb-tactical-row' },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h('div', { style: { fontSize: 12, fontWeight: 600, color: tm.intervention ? '#f59e0b' : 'var(--dnb-text)' } }, '⚡ 主动强介入（随四档权限联动）'),
              h('div', { style: { fontSize: 11, color: 'var(--dnb-text-3)', marginTop: 1 } },
                INTERVENTION_TIER_DESC[permMode] || INTERVENTION_TIER_DESC.advisor),
            ),
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 } },
              h(
                'div',
                { className: 'dnb-stepper', title: '连续主动介入轮数上限（从 1 轮点「-」可切为 ♾️ 无限督导）' },
                h('button', {
                  type: 'button',
                  disabled: isUnlimitedTurns,
                  style: isUnlimitedTurns ? { opacity: 0.35, cursor: 'not-allowed' } : undefined,
                  title: isUnlimitedTurns ? '当前已为无限轮次' : (maxTurns <= 1 ? '点按将弹窗确认是否切换为 ♾️ 无限督导' : '减少轮次上限'),
                  onClick: () => {
                    if (isUnlimitedTurns) return
                    toggleTacticalField('maxInterventionTurns', maxTurns <= 1 ? 0 : maxTurns - 1)
                  },
                }, '-'),
                h('span', { style: isUnlimitedTurns ? { color: 'var(--dnb-accent)', fontWeight: 700 } : undefined }, isUnlimitedTurns ? '♾️' : `${maxTurns}轮`),
                h('button', {
                  type: 'button',
                  disabled: !isUnlimitedTurns && maxTurns >= 30,
                  style: (!isUnlimitedTurns && maxTurns >= 30) ? { opacity: 0.35, cursor: 'not-allowed' } : undefined,
                  onClick: () => {
                    if (isUnlimitedTurns) toggleTacticalField('maxInterventionTurns', 1)
                    else toggleTacticalField('maxInterventionTurns', Math.min(30, maxTurns + 1))
                  },
                }, '+'),
              ),
              h(Switch, { checked: Boolean(tm.intervention), onChange: v => toggleTacticalField('intervention', v) }),
            ),
          ),
          // Row 2: Auto-Compact + Smart Co-Managed Mode (✦ 智选) + Dual Threshold (Pct 10%-95% | Context Tokens)
          h(
            'div',
            { className: 'dnb-tactical-row', style: { flexDirection: 'column', alignItems: 'stretch', gap: 7 } },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
              h(
                'div',
                { style: { flex: 1, minWidth: 0 } },
                h('div', { style: { fontSize: 12, fontWeight: 600, color: isSmartCompact ? 'var(--dnb-accent)' : 'var(--dnb-text)' } },
                  '🗜 压缩前抢救 + 自动压缩（每轮核查）'),
                h('div', { style: { fontSize: 11, color: 'var(--dnb-text-3)', marginTop: 1, lineHeight: 1.4 } },
                  isSmartCompact
                    ? '✦ 智选已开启：每轮结束后由参谋长与主对话在阶段收口处协同压缩'
                    : (thresholdMode === 'tokens'
                        ? `每轮结束后核查：上下文达 ${thresholdInputVal} 时先抢救实档再静默压缩`
                        : `每轮结束后核查：占用达 ${pct}% 时先抢救实档再压缩`)),
              ),
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 } },
                h('button', {
                  type: 'button',
                  className: 'dnb-mini-btn',
                  'data-tone': isSmartCompact ? 'accent' : undefined,
                  title: isSmartCompact
                    ? '当前已开启 ✦ 智选（每轮协同判断压缩时机）；点击切回固定阈值模式'
                    : '开启 ✦ 智选：由参谋长与主对话在阶段收口处协同把控压缩时机',
                  onClick: () => toggleTacticalField('smartCompact', !isSmartCompact),
                }, isSmartCompact ? '✦ 智选中' : '✦ 智选'),
                h(Switch, { checked: Boolean(tm.autoCompact), onChange: v => toggleTacticalField('autoCompact', v) }),
              ),
            ),
            !isSmartCompact
              ? h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap', paddingTop: 2 } },
                  h(
                    'div',
                    { style: { display: 'inline-flex', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--dnb-border-strong)' } },
                    h('button', {
                      type: 'button',
                      style: {
                        padding: '3px 9px',
                        fontSize: 11,
                        fontWeight: 500,
                        border: 'none',
                        cursor: 'pointer',
                        background: thresholdMode === 'pct' ? 'var(--dnb-primary-bg, #2563eb)' : 'transparent',
                        color: thresholdMode === 'pct' ? 'var(--dnb-primary-fg, #fff)' : 'var(--dnb-text-2)',
                      },
                      onClick: () => toggleTacticalField('compactThresholdMode', 'pct'),
                    }, '按比例'),
                    h('button', {
                      type: 'button',
                      style: {
                        padding: '3px 9px',
                        fontSize: 11,
                        fontWeight: 500,
                        border: 'none',
                        cursor: 'pointer',
                        background: thresholdMode === 'tokens' ? 'var(--dnb-primary-bg, #2563eb)' : 'transparent',
                        color: thresholdMode === 'tokens' ? 'var(--dnb-primary-fg, #fff)' : 'var(--dnb-text-2)',
                      },
                      onClick: () => toggleTacticalField('compactThresholdMode', 'tokens'),
                    }, '自填上下文'),
                  ),
                  thresholdMode === 'pct'
                    ? h('select', {
                        value: String(pct),
                        title: '选择触发抢救与自动压缩的上下文占用比例（10%–95%，低于 25% 会提示过早压缩风险）',
                        style: {
                          height: 26,
                          minWidth: 74,
                          borderRadius: 8,
                          border: isLowPctThreshold ? '1px solid rgba(245, 158, 11, 0.7)' : '1px solid var(--dnb-border-strong)',
                          background: 'var(--dnb-card)',
                          color: 'var(--dnb-text)',
                          fontSize: 11.5,
                          fontWeight: 600,
                          padding: '0 8px',
                          cursor: 'pointer',
                        },
                        onChange: e => toggleTacticalField('compactThresholdPct', Number(e.target.value)),
                      }, pctSelectChoices.map(v =>
                        h('option', { key: v, value: String(v) }, `${v}%`),
                      ))
                    : h(
                        'div',
                        { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                        h('input', {
                          type: 'text',
                          value: thresholdInputVal,
                          placeholder: '如 1M 或 64(默认K)',
                          title: '输入 1M 即 1M tokens；不填单位默认为 K（如填 64 即 64K）；低于 32K 会警告',
                          style: {
                            width: 112,
                            height: 26,
                            borderRadius: 8,
                            border: isLowTokenThreshold ? '1px solid rgba(245, 158, 11, 0.7)' : '1px solid var(--dnb-border-strong)',
                            background: 'var(--dnb-card)',
                            color: 'var(--dnb-text)',
                            fontSize: 11.5,
                            padding: '0 8px',
                          },
                          onChange: e => patch({ compactInputDraft: e.target.value }),
                          onKeyDown: e => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              commitTokenThresholdInput(e.currentTarget.value)
                            }
                          },
                          onBlur: e => {
                            if (view.compactInputDraft !== null && view.compactInputDraft !== undefined) {
                              commitTokenThresholdInput(e.currentTarget.value)
                            }
                          },
                        }),
                        h('button', {
                          type: 'button',
                          className: 'dnb-mini-btn',
                          'data-tone': 'accent',
                          onClick: () => commitTokenThresholdInput(thresholdInputVal),
                        }, '应用'),
                      ),
                )
              : null,
            !isSmartCompact && (isLowTokenThreshold || isLowPctThreshold || view.compactLowWarning)
              ? h('div', {
                  style: {
                    fontSize: 10.5,
                    color: '#f59e0b',
                    background: 'rgba(245, 158, 11, 0.1)',
                    border: '1px solid rgba(245, 158, 11, 0.32)',
                    borderRadius: 6,
                    padding: '3px 7px',
                  },
                }, isLowTokenThreshold
                  ? `⚠️ 当前自填阈值（${tm.compactThresholdInput || '低于32K'}）低于安全建议线 32K，可能导致上下文频繁压缩丢失现场细节`
                  : (view.compactLowWarning
                      ? ('⚠️ ' + view.compactLowWarning)
                      : `⚠️ 当前压缩比例（${pct}%）低于 25%，可能导致上下文过早频繁压缩，建议设为 30%–80%`))
              : null,
          ),
          // Row 3: Strict Verify
          h(
            'div',
            { className: 'dnb-tactical-row' },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h('div', { style: { fontSize: 12, fontWeight: 600, color: 'var(--dnb-text)' } }, '✓ 严格实证核验'),
              h('div', { style: { fontSize: 11, color: 'var(--dnb-text-3)', marginTop: 1 } }, '要求结论附文件/命令证据，未核实不放行结项'),
            ),
            h(Switch, { checked: Boolean(tm.strictVerify), onChange: v => toggleTacticalField('strictVerify', v) }),
          ),
          // Row 4: Redline Sentinel
          h(
            'div',
            { className: 'dnb-tactical-row' },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h(
                'div',
                { style: { fontSize: 12, fontWeight: 600, color: tm.redlineSentinel ? '#f87171' : 'var(--dnb-text)', display: 'flex', alignItems: 'center' } },
                h(Icon, {
                  name: 'shieldSentinel',
                  size: 14,
                  style: {
                    color: tm.redlineSentinel ? '#ef4444' : 'var(--dnb-text-3)',
                    marginRight: 5,
                    filter: tm.redlineSentinel ? 'drop-shadow(0 0 4px rgba(239,68,68,0.45))' : undefined,
                  },
                }),
                '红线越界哨兵',
              ),
              h('div', { style: { fontSize: 11, color: 'var(--dnb-text-3)', marginTop: 1 } }, '触碰禁止红线或物理驻墙时立即高优拦截'),
            ),
            h(Switch, { checked: Boolean(tm.redlineSentinel), tone: 'red', onChange: v => toggleTacticalField('redlineSentinel', v) }),
          ),
          // Row 5: Concise Brief
          h(
            'div',
            { className: 'dnb-tactical-row' },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h('div', { style: { fontSize: 12, fontWeight: 600, color: 'var(--dnb-text)' } }, '📝 极简战报模式'),
              h('div', { style: { fontSize: 11, color: 'var(--dnb-text-3)', marginTop: 1 } }, '分结构多条短句汇报、剥离繁琐数字参数（细节归其他页）'),
            ),
            h(Switch, { checked: Boolean(tm.conciseBrief), onChange: v => toggleTacticalField('conciseBrief', v) }),
          ),
          // Row 6: Chief Thinking Effort Fan Gauge + Team Effort Mode (Auto / Manual)
          h(
            'div',
            { className: 'dnb-tactical-row', style: { flexDirection: 'column', alignItems: 'stretch', gap: 6 } },
            h('div', { style: { fontSize: 12, fontWeight: 600, color: 'var(--dnb-text)' } }, '🧠 参谋长思考强度'),
            h(EffortFanGauge, {
              value: meta.thinkingEffort || 'auto',
              onChange: nextKey => void updateSecConfig({ thinkingEffort: nextKey }),
            }),
            (() => {
              const teamMode = meta.teamEffortMode === 'manual' ? 'manual' : 'auto'
              return h(
                'div',
                { className: 'dnb-team-effort-row' },
                h(
                  'div',
                  { className: 'dnb-team-effort-info' },
                  h('div', { className: 'dnb-team-effort-title' }, '团队思考强度（主/子代理）'),
                  h('div', { className: 'dnb-team-effort-sub' },
                    teamMode === 'manual'
                      ? '手动模式：参谋长不自动调节，由你自行掌控'
                      : '默认自动：由参谋长按当前权限范围自动调节'),
                ),
                h(
                  'div',
                  { className: 'dnb-team-effort-seg', role: 'group', 'aria-label': '团队思考强度调控模式' },
                  h('button', {
                    type: 'button',
                    className: 'dnb-team-effort-btn',
                    'data-active': teamMode === 'auto' ? '1' : '0',
                    title: '默认自动：由参谋长按当前权限范围自动调节主对话与子代理思考强度',
                    onClick: () => {
                      if (teamMode !== 'auto') void updateSecConfig({ teamEffortMode: 'auto' })
                    },
                  }, '自动'),
                  h('button', {
                    type: 'button',
                    className: 'dnb-team-effort-btn',
                    'data-active': teamMode === 'manual' ? '1' : '0',
                    title: '手动模式：参谋长停止自动调节主对话与子代理思考强度',
                    onClick: () => {
                      if (teamMode !== 'manual') void updateSecConfig({ teamEffortMode: 'manual' })
                    },
                  }, '手动'),
                ),
              )
            })(),
          ),
          // Collapsible Dual Mandatory Disclaimer Footer
          h(
            'div',
            { style: { marginTop: 2 } },
            h('button', {
              type: 'button',
              className: 'dnb-text-filter-btn',
              style: { width: '100%', justifyContent: 'space-between', padding: '4px 6px', fontSize: 10.5 },
              onClick: () => patch({ chiefDisclaimerOpen: !view.chiefDisclaimerOpen }),
            },
              h('span', null, 'ⓘ 模型能力与规则冲突说明'),
              h('span', { style: { fontSize: 10, opacity: 0.7 } }, view.chiefDisclaimerOpen ? '▴ 收起' : '▾ 展开'),
            ),
            view.chiefDisclaimerOpen
              ? h(
                  'div',
                  { className: 'dnb-disclaimer-box', style: { marginTop: 4 } },
                  h('div', { style: { marginBottom: 4 } },
                    h('strong', null, '免责声明 1（模型依赖）：'),
                    '参谋长的一切自动审查、强介入驱动、压缩前抢救与红线拦截能力均高度依赖您为参谋长配置的底层大模型能力与上下文质量，不同模型在规划严谨度与遵循指令上的表现存在客观差异。',
                  ),
                  h('div', null,
                    h('strong', null, '免责声明 2（规则冲突）：'),
                    '若主会话或当前项目中挂载了过多的系统提示词（System Prompt）、Rules 或硬性规则，可能与本插件的自主干预逻辑产生指令冲突，进而导致介入循环异常、提前熔断或执行偏离预期。',
                  ),
                )
              : null,
          ),
        ),
        )
      : null,

    // Dismissible Structured Latest Reply Bubble
    view.secLatestReply
      ? h(
          'div',
          { className: 'dnb-sec-reply' },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 } },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              renderStructuredText(view.secLatestReply.text),
              Array.isArray(view.secLatestReply.actions) && view.secLatestReply.actions.length
                ? h(
                    'div',
                    { style: { display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 5 } },
                    view.secLatestReply.actions.map((actStr, idx) =>
                      h('span', { key: idx, className: 'dnb-tag', style: { color: 'var(--dnb-accent)', fontSize: 10.5 } }, actStr)),
                  )
                : null,
            ),
            h('button', {
              className: 'dnb-icon-btn',
              style: { width: 20, height: 20, flexShrink: 0 },
              onClick: () => patch({ secLatestReply: null }),
            }, h(Icon, { name: 'x', size: 12 })),
          ),
        )
      : null,

    // Active Tactical Mode Strip (shows smart-compact or hard threshold chip)
    activeChipsCount > 0 || guard.circuitBroken
      ? h(
          'div',
          { className: 'dnb-tactical-strip' },
          tm.intervention
            ? h('button', {
                type: 'button',
                className: 'dnb-tac-chip',
                'data-tone': 'amber',
                onClick: () => patch({ tacticalMenuOpen: !view.tacticalMenuOpen }),
              }, `⚡ 强介入 ${Number(guard.interventionTurns ?? guard.consecutiveInterventionTurns ?? 0)}/${isUnlimitedTurns ? '♾️' : maxTurns}`)
            : null,
          tm.autoCompact
            ? h('button', {
                type: 'button',
                className: 'dnb-tac-chip',
                'data-tone': 'accent',
                onClick: () => patch({ tacticalMenuOpen: !view.tacticalMenuOpen }),
                title: isSmartCompact
                  ? '✦ 智选已开启：参谋长与主对话协同把控压缩时机'
                  : (thresholdMode === 'tokens'
                      ? `固定上下文压缩线：${tm.compactThresholdInput || '64K'}`
                      : `按比例自动压缩线：${pct}%`),
              }, isSmartCompact ? '✦ 智选压缩' : `🗜 自动压缩 ${thresholdMode === 'tokens' ? (tm.compactThresholdInput || '64K') : (pct + '%')}`)
            : null,
          tm.redlineSentinel
            ? h('button', {
                type: 'button',
                className: 'dnb-tac-chip',
                'data-tone': 'red',
                onClick: () => patch({ tacticalMenuOpen: !view.tacticalMenuOpen }),
              }, h(Icon, { name: 'shieldSentinel', size: 13, style: { color: '#ef4444' } }), '红线哨兵')
            : null,
          guard.circuitBroken
            ? h('span', {
                className: 'dnb-tac-chip',
                style: { borderColor: 'rgba(255,69,58,0.45)', color: '#ff453a', background: 'rgba(255,69,58,0.1)' },
                title: guard.circuitReason || '已触发自动防死循环熔断',
              }, '⛔ 已熔断')
            : null,
          tm.intervention
            ? h('button', {
                type: 'button',
                className: 'dnb-stop-btn',
                title: '立即急停主动强介入与后台自驱，保留当前计划',
                onClick: () => void updateSecConfig({ emergencyStopIntervention: true }),
              }, '⏹ 急停')
            : null,
        )
      : null,

    // Permission Picker Popover (Fig 1: L0-L3 4-Tier Permission Cards + 6-Stage Pipeline & Audit)
    view.secPermMenuOpen
      ? h(
          React.Fragment,
          null,
          h('div', {
            style: { position: 'fixed', inset: 0, zIndex: 68 },
            onClick: () => patch({ secPermMenuOpen: false }),
          }),
          h(
            'div',
            { className: 'dnb-menu dnb-perm-pop' },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '2px 2px 2px' } },
              h('span', { style: { fontSize: 12.5, fontWeight: 700, color: 'var(--dnb-text)' } }, 'DSH Chief 四级权限模型（严格会话隔离）'),
              h('button', {
                type: 'button',
                className: 'dnb-mini-btn',
                title: '查看 6 级安全流水线实时判定与审计日志',
                onClick: () => patch({ secPermMenuOpen: false, auditLogModalOpen: true }),
              }, `📜 审计 (${auditCount})`),
            ),
            PERM_OPTIONS.map(opt => {
              const active = permMode === opt.key
              return h(
                'div',
                {
                  key: opt.key,
                  className: 'dnb-perm-card',
                  'data-active': active ? '1' : '0',
                  'data-tier': opt.key,
                  onClick: () => {
                    if (opt.key === 'chief') {
                      if (permMode === 'chief') {
                        patch({ secPermMenuOpen: false })
                        return
                      }
                      patch({
                        secPermMenuOpen: false,
                        chiefRiskModalOpen: true,
                        chiefRiskAgreed: false,
                      })
                      return
                    }
                    patch({ secPermMenuOpen: false })
                    void updateSecConfig({ permissionMode: opt.key })
                  },
                },
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
                  h('span', { style: { fontSize: 12.5, fontWeight: 700, color: opt.key === 'chief' ? '#f59e0b' : 'var(--dnb-text)' } }, opt.title),
                  h(
                    'div',
                    { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } },
                    opt.badgeText
                      ? h('span', { className: 'dnb-perm-badge', 'data-tone': opt.badgeTone }, opt.badgeText)
                      : null,
                    active ? h(Icon, { name: 'check', size: 13, style: { color: opt.key === 'chief' ? '#f59e0b' : 'var(--dnb-accent)' } }) : null,
                  ),
                ),
                h('div', { className: 'dnb-perm-subcode', style: opt.key === 'chief' ? { color: '#d97706' } : undefined }, opt.code),
                h(
                  'ul',
                  { className: 'dnb-perm-bullets' },
                  opt.bullets.map((line, i) => h('li', { key: i }, line)),
                ),
                h('div', { className: 'dnb-perm-foot' }, opt.footer),
              )
            }),
            h(
              'div',
              { className: 'dnb-pipe-bar', title: '统一 6 级安全架构流水线' },
              h('span', { style: { fontWeight: 700, color: 'var(--dnb-text-2)', marginRight: 2 } }, '流水线:'),
              ['用户模式', '操作请求', '安全卫兵硬性规则', '权限判定', '执行器', '审计日志'].map((step, idx, arr) =>
                h(
                  React.Fragment,
                  { key: step },
                  h('span', { className: 'dnb-pipe-node' }, step),
                  idx < arr.length - 1 ? h('span', null, '→') : null,
                ),
              ),
            ),
          ),
        )
      : null,

    // Pending Model Elevation & Pending L2 Operation Approval Banners
    pendingElevationObj
      ? h(
          'div',
          {
            className: 'dnb-pending-banner',
            style: {
              background: 'rgba(37, 99, 235, 0.14)',
              border: '1px solid rgba(37, 99, 235, 0.42)',
              color: '#60a5fa',
            },
            onClick: () => {
              const nextDismissed = { ...(view.dismissedElevationIds || {}) }
              delete nextDismissed[pendingElevationObj.id]
              patch({ dismissedElevationIds: nextDismissed, elevationAgreed: false, elevationChosenMode: pendingElevationObj.targetMode || 'strategist' })
            },
          },
          h('span', { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            `⬆️ 模型申请提权：${CHIEF_PERMISSION_LABELS[pendingElevationObj.fromMode] || pendingElevationObj.fromMode} → ${CHIEF_PERMISSION_LABELS[pendingElevationObj.targetMode] || pendingElevationObj.targetMode}`),
          h('span', { style: { flexShrink: 0, textDecoration: 'underline' } }, '去审批 →'),
        )
      : null,

    pendingApprovalsList.length > 0
      ? h(
          'div',
          {
            className: 'dnb-pending-banner',
            style: {
              background: 'rgba(245, 158, 11, 0.14)',
              border: '1px solid rgba(245, 158, 11, 0.45)',
              color: '#fbbf24',
            },
            onClick: () => {
              const first = pendingApprovalsList[0]
              const nextDismissed = { ...(view.dismissedApprovalIds || {}) }
              if (first && first.id) delete nextDismissed[first.id]
              patch({ dismissedApprovalIds: nextDismissed, openApprovalModalId: (first && first.id) || '' })
            },
          },
          h('span', { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            `🛡️ ${pendingApprovalsList[0].operationLabel || '受控操作'}（等待逐项授权 ${pendingApprovalsList.length} 项）`),
          h('span', { style: { flexShrink: 0, textDecoration: 'underline' } }, '弹窗确认 →'),
        )
      : null,

    // Compact Target, Permission & Posture Strip
    h(
      'div',
      { className: 'dnb-sec-targets' },
      h('button', {
        type: 'button',
        className: 'dnb-sec-chip',
        'data-active': view.secPermMenuOpen ? '1' : '0',
        title: `${activePermObj.title}（${activePermObj.code}）— ${activePermObj.footer}（点击切换四级权限模型）`,
        onClick: () => patch({ secPermMenuOpen: !view.secPermMenuOpen, tacticalMenuOpen: false, secModelMenuOpen: false, secPaceMenuOpen: false }),
      },
        h('span', {
          style: {
            width: 6,
            height: 6,
            borderRadius: '50%',
            flexShrink: 0,
            background: permMode === 'chief'
              ? '#f59e0b'
              : (permMode === 'strategist' ? '#60a5fa' : (permMode === 'advisor' ? '#34d399' : '#94a3b8')),
          },
        }),
        activePermObj.shortLabel,
      ),
      h('button', {
        className: 'dnb-sec-chip',
        'data-active': activeTarget === 'auto' ? '1' : '0',
        title: '由 DSH 参谋长研判实时进展、亲自实权查改/调度子代理或拆话递给对应成员',
        onClick: () => patch({ secTarget: 'auto' }),
      }, '✦ 参谋/拆话'),
      targetChips.map(p =>
        h('button', {
          key: p.key,
          className: 'dnb-sec-chip',
          'data-active': activeTarget === p.key ? '1' : '0',
          onClick: () => patch({
            secTarget: activeTarget === p.key ? 'auto' : p.key,
            secMode: p.status === 'running' ? 'steer' : 'followup',
          }),
        },
          p.status === 'running'
            ? h('span', { className: 'dnb-spin-ring', style: { '--dnb-spin-size': '7.5px', color: '#409cff' } })
            : h(Icon, { name: p.key === 'lead' ? 'agentLead' : 'agentSub', size: 10.5 }),
          '@' + clampTitle(p.key === 'lead' ? '主对话' : shortAgentName(p.name, true), 9.5),
        ),
      ),
      targetChips.length > 1
        ? h('button', {
            className: 'dnb-sec-chip',
            'data-active': activeTarget === 'all' ? '1' : '0',
            onClick: () => patch({ secTarget: activeTarget === 'all' ? 'auto' : 'all' }),
          }, '@全体')
        : null,
      activeTarget !== 'auto'
        ? h('button', {
            className: 'dnb-sec-chip',
            style: { marginLeft: 'auto', color: 'var(--dnb-text-2)', borderColor: 'var(--dnb-border-strong)' },
            title: modeObj.hint + '（点击切换）',
            onClick: () => {
              const idx = RELAY_MODES.findIndex(m => m.key === modeObj.key)
              const next = RELAY_MODES[(idx + 1) % RELAY_MODES.length]
              patch({ secMode: next.key })
            },
          }, modeObj.label + ' ↻')
        : null,
    ),

    // Attached Image Preview Strip (only when attached)
    secImages.length > 0
      ? h(
          'div',
          { className: 'dnb-sec-img-strip' },
          secImages.map(img =>
            h(
              'div',
              { key: img.id, className: 'dnb-sec-img-thumb', title: img.name || '附图' },
              h('img', {
                src: img.previewUrl || ('data:' + img.mediaType + ';base64,' + img.data),
                alt: img.name || '附图',
              }),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dnb-sec-img-rm',
                  title: '移除图片',
                  onClick: () => {
                    const next = (store.secImages || []).filter(item => item.id !== img.id)
                    patch({ secImages: next })
                  },
                },
                '×',
              ),
            ),
          ),
          h(
            'span',
            { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', marginLeft: 'auto', alignSelf: 'center', flexShrink: 0 } },
            '附图 ' + secImages.length + '/' + SEC_MAX_IMAGES,
          ),
        )
      : null,

    // DS-Bot Style Rounded Pill Input + Centered `+` Tactical Button + Attach Image + Up-Arrow Send Button
    h(
      'div',
      { className: 'dnb-sec-shell' },
      h('button', {
        type: 'button',
        className: 'dnb-plus-btn',
        'data-active': (view.tacticalMenuOpen || activeChipsCount > 0) ? '1' : '0',
        'data-danger': tm.intervention ? '1' : '0',
        title: '打开参谋长战术驾驶舱（强介入 / 智选压缩 / 红线哨兵 / 核验开关）',
        onClick: () => patch({ tacticalMenuOpen: !view.tacticalMenuOpen, secPermMenuOpen: false, secModelMenuOpen: false, secPaceMenuOpen: false }),
      }, h(Icon, { name: view.tacticalMenuOpen ? 'x' : 'plus', size: 14, style: { display: 'block', verticalAlign: 0 } })),
      h('input', {
        ref: fileInputRef,
        type: 'file',
        accept: 'image/png,image/jpeg,image/webp,image/gif',
        multiple: true,
        style: { display: 'none' },
        onChange: e => {
          const files = e.target && e.target.files
          if (files && files.length) void ingestSecImageFiles(files)
          if (e.target) e.target.value = ''
        },
      }),
      h(
        'button',
        {
          type: 'button',
          className: 'dnb-sec-attach',
          disabled: Boolean(view.secBusy) || secImages.length >= SEC_MAX_IMAGES,
          title: secImages.length >= SEC_MAX_IMAGES
            ? `最多可附 ${SEC_MAX_IMAGES} 张图片`
            : '上传图片（支持拖拽或 Ctrl+V 粘贴截图）',
          onClick: () => {
            if (fileInputRef.current) fileInputRef.current.click()
          },
        },
        h(Icon, { name: 'image', size: 15 }),
        secImages.length > 0
          ? h('span', { className: 'dnb-sec-attach-badge' }, String(secImages.length))
          : null,
      ),
      h('input', {
        ref: el => { runtimeRefs.secInputEl = el },
        className: 'dnb-sec-input',
        placeholder: view.secBusy ? '参谋长正在处理…' : placeholder,
        disabled: view.secBusy,
        value: view.secInput || '',
        onChange: e => patch({ secInput: e.target.value }),
        onPaste: e => {
          const items = (e.clipboardData && e.clipboardData.items) ? Array.from(e.clipboardData.items) : []
          let imgFiles = items
            .filter(it => it && it.kind === 'file' && String(it.type || '').startsWith('image/'))
            .map(it => it.getAsFile())
            .filter(Boolean)
          if (!imgFiles.length && e.clipboardData && e.clipboardData.files) {
            imgFiles = Array.from(e.clipboardData.files).filter(f => f && String(f.type || '').startsWith('image/'))
          }
          if (imgFiles.length) {
            e.preventDefault()
            void ingestSecImageFiles(imgFiles)
          }
        },
        onKeyDown: e => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            void submitChiefBar()
          }
        },
      }),
      h('button', {
        type: 'button',
        className: 'dnb-sec-send',
        disabled: !canSend,
        title: '发送给 DSH 参谋长',
        onClick: () => void submitChiefBar(),
      },
        view.secBusy
          ? h(Icon, { name: 'refresh', size: 13, style: { animation: 'dnb-spin 0.9s linear infinite' } })
          : h(Icon, { name: 'arrowUp', size: 15 }),
      ),
    ),
  )
}

/* ----------------------------------------------------------- Main Panel */
