/**
 * src/client/tabs/chief.js — 参谋总览页签与底部参谋输入条
 *
 * 【核心职责】
 *   1. `ChiefTab`：展示「当前进展摘要 / 极简目标汇报」与「问答与操作记录」卡片，
 *      并提供咨询、更新摘要、导出复盘报告与切换界面语言等快捷动作。
 *   2. `ChiefComposerBar`：底部常驻 DS-Bot 风格参谋输入条（含权限切换、点选对象、图片附件与开关面板）。
 *
 * 【边界约定】
 *   - 已去掉旧版「摘要 | 长期规矩」次级页与旧回合记忆视图，保持单页主视图零冗余。
 */

import { React, h } from '../react-runtime.js'
import {
  CHIEF_PERMISSION_LABELS,
  INTERVENTION_TIER_DESC,
  RELAY_MODES,
  SEC_MAX_IMAGES,
  THINKING_EFFORT_OPTIONS,
} from '../constants.js'
import { bi, permLabel, chiefDisplayName, chiefShortName } from '../i18n.js'
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
  ingestSecImageFiles,
  submitChiefBar,
  refresh,
  toggleSyncHandoffOnDigest,
  copyText,
  retractExternalMemoryApi,
} from '../api.js'
import { buildSessionReportMarkdown, downloadSessionReportMarkdown } from '../report.js'
import {
  Icon,
  Switch,
  AccCard,
  EffortFanGauge,
  renderStructuredHeading,
  parseNarrativeBlocks,
  renderStructuredItem,
  renderStructuredText,
  parseSixGoalBrief,
  isBenignQuietStatusText,
  extractReplySummaryLine,
  orderChatHistoryNewestFirst,
  groupChatHistoryTurnsNewestFirst,
} from '../components/common.js'

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
  const [emptyStatusExpanded, setEmptyStatusExpanded] = React.useState(false)
  const [expandedReplyIds, setExpandedReplyIds] = React.useState({})
  const [expandedRecallIds, setExpandedRecallIds] = React.useState({})

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

  const narrative = sec.narrative || {}
  const chat = Array.isArray(sec.chat) ? sec.chat : []
  const notes = (board && Array.isArray(board.notes)) ? board.notes : []
  const isConciseMode = Boolean(view.chiefMeta && view.chiefMeta.tacticalModes && view.chiefMeta.tacticalModes.conciseBrief)
  const sixGoalRows = parseSixGoalBrief(narrative.text || '')
  const useSixBriefCards = Boolean(sixGoalRows && (isConciseMode || sixGoalRows.length >= 4))
  const blocks = parseNarrativeBlocks(narrative.text || '')

  const hState = (board && board.handoff) || {}
  const hMeta = view.handoffMeta || {}
  const isHandoffPinned = Boolean(hState.pinned || hMeta.pinned)
  const syncOnDigest = Boolean(hState.syncOnDigest ?? hMeta.syncOnDigest)
  const exportReport = (copyOnly = false) => {
    const md = buildSessionReportMarkdown({
      board,
      secView: sec,
      chiefMeta: view.chiefMeta,
      subagents: view.subagents,
      guardWalls: view.guardWalls,
      sessionId: view.sessionId,
    })
    if (copyOnly) {
      copyText(md, bi('📋 复盘报告已复制到剪贴板', '📋 Report copied to clipboard'))
      return
    }
    const dl = downloadSessionReportMarkdown(md, view.sessionId)
    if (dl && dl.ok) {
      patch({ notice: bi('📄 已导出复盘报告：', '📄 Exported report: ') + dl.filename })
    } else {
      copyText(md, bi('📄 复盘报告已复制到剪贴板', '📋 Report copied to clipboard'))
    }
  }
  const digestStatusText = (narrative.summarizing || view.secRegenerating)
    ? bi('正在整理最新进展…', 'Updating summary…')
    : narrative.isLiveZeroToken
      ? bi('实时状态（不额外耗 Token）', 'Live overview (no extra tokens)')
      : ((narrative.at ? bi('更新于 ', 'Updated ') + relativeTimeLabel(narrative.at) : bi('已更新', 'Updated'))
          + (narrative.hasUnsummarizedChanges ? bi(' · 有新进展', ' · New updates') : ''))
  const digestPreview = sixGoalRows && sixGoalRows[0]
    ? clampTitle(sixGoalRows[0].body, 28)
    : digestStatusText
  const chiefLedger = sec.llmLedger || (view.chiefMeta && view.chiefMeta.llmLedgerSummary) || null
  const ledgerTotalCalls = chiefLedger ? (Number(chiefLedger.totalCalls) || 0) : 0
  const ledgerTotalTok = chiefLedger ? (Number(chiefLedger.totalTokens) || 0) : 0
  const ledgerChipLabel = ledgerTotalTok >= 1000
    ? `${ledgerTotalCalls}${bi('次', 'x')} · ${(ledgerTotalTok / 1000).toFixed(1).replace(/\.0$/, '')}K`
    : `${ledgerTotalCalls}${bi('次', 'x')} · ${ledgerTotalTok}`
  const modelLabel = narrative.byModel
    ? shortModelName(narrative.byModel, view.secModelsCatalog || (sec && sec.models), true)
    : ''

  // Partition 6-row goal brief into Goal / Real Alert / Core Prose / Quiet Empty Status
  const goalRow = useSixBriefCards ? (sixGoalRows.find(r => r.role === 'goal') || null) : null
  const blockedRow = useSixBriefCards ? (sixGoalRows.find(r => r.role === 'blocked') || null) : null
  const userNeedRow = useSixBriefCards ? (sixGoalRows.find(r => r.role === 'userNeed') || null) : null
  const alertRows = []
  const quietEmptyRows = []
  if (blockedRow) {
    if (isBenignQuietStatusText(blockedRow.body)) {
      quietEmptyRows.push({
        key: blockedRow.key,
        label: bi('受阻目标', 'Blockers'),
        shortPhrase: bi('暂无明确受阻', 'No active blockers'),
        body: blockedRow.body,
      })
    } else {
      alertRows.push({
        ...blockedRow,
        alertTone: 'coral',
        alertLabel: bi('当前受阻', 'Blocked'),
      })
    }
  }
  if (userNeedRow) {
    if (isBenignQuietStatusText(userNeedRow.body)) {
      quietEmptyRows.push({
        key: userNeedRow.key,
        label: bi('需你提供', 'Your input'),
        shortPhrase: bi('暂无需你额外提供', 'No input needed'),
        body: userNeedRow.body,
      })
    } else {
      alertRows.push({
        ...userNeedRow,
        alertTone: 'amber',
        alertLabel: bi('需你确认', 'Needs you'),
      })
    }
  }
  const mainBriefRows = useSixBriefCards
    ? sixGoalRows.filter(r => r.role !== 'goal' && r.role !== 'blocked' && r.role !== 'userNeed')
    : []

  const renderEditorialMeta = () => (
    h(
      'div',
      { className: 'dnb-editorial-meta' },
      modelLabel
        ? h('span', { title: narrative.byModel }, modelLabel)
        : null,
      ledgerTotalCalls > 0
        ? h('button', {
            type: 'button',
            className: 'dnb-editorial-meta-btn',
            title: bi('查看用量统计和托管模式上限', 'View usage stats and Managed mode limits'),
            onClick: e => {
              e.stopPropagation()
              patch({ settingsOpen: true })
            },
          }, ledgerChipLabel)
        : null,
      h('span', null, digestStatusText),
    )
  )

  return h(
    'div',
    { className: 'dnb-view' },
    // Editorial Goal Brief or Standard Structured Digest
    h('div', { 'data-dnb-section': 'chief-digest' },
      h(
        AccCard,
      {
        open: !view.chiefDigestCollapsed,
        onToggle: () => patch({ chiefDigestCollapsed: !view.chiefDigestCollapsed }),
        tone: 'slate',
        title: useSixBriefCards ? bi('当前目标进展', 'Current Goal Brief') : bi('当前进展摘要', 'Current Summary'),
        headTitle: view.chiefDigestCollapsed ? bi('点击展开摘要', 'Click to expand summary') : bi('点击收起摘要', 'Click to collapse summary'),
        preview: digestPreview,
        headerExtra: null,
        badges: null,
        actions: h(
          'div',
          {
            style: { display: 'inline-flex', alignItems: 'center', gap: 2 },
            onClick: e => e.stopPropagation(),
          },
          h('button', {
            type: 'button',
            className: 'dnb-ghost-btn',
            disabled: Boolean(view.secBusy),
            title: bi('问问参谋长现在进展顺不顺、卡在哪、接下来怎么走', 'Ask Chief how things are going, what is blocked, and what to do next'),
            onClick: () => void submitChiefBar(
              '请结合当前任务进展、对话上下文、边界红线与团队状态，给我坦诚、接地气的参谋建议：当前有什么需要关注的卡点或更好的推进方向？若一切顺利暂无建议，或涉及非参谋与会话能处理的事项，直接实话告诉我即可，不要强行凑执行项。',
              'consult_chief',
            ),
          }, bi('咨询', 'Consult')),
          h('button', {
            type: 'button',
            className: 'dnb-ghost-btn',
            style: {
              color: (!view.secRegenerating && !narrative.summarizing && narrative.hasUnsummarizedChanges)
                ? 'var(--dnb-accent)'
                : undefined,
            },
            disabled: view.secRegenerating || narrative.summarizing,
            title: narrative.hasUnsummarizedChanges
              ? bi('对话有了新内容，点这里更新摘要（平时不后台自动跑，省 Token）', 'New chat updates found. Click to update the summary without extra background cost.')
              : bi('让参谋长重新整理一份最新摘要', 'Update the summary now'),
            onClick: () => void loadChiefView(true, { syncHandoff: !isHandoffPinned && syncOnDigest }),
          },
            (view.secRegenerating || narrative.summarizing)
              ? h(Icon, { name: 'refresh', size: 10.5, style: { animation: 'dnb-spin 0.9s linear infinite' } })
              : null,
            (view.secRegenerating || narrative.summarizing) ? bi('整理中…', 'Updating…') : bi('更新摘要', 'Update'),
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
            { className: 'dnb-more-wrap' },
            h('button', {
              type: 'button',
              className: 'dnb-ghost-btn',
              style: { padding: '0 6px' },
              'data-active': view.chiefMoreMenuOpen ? '1' : '0',
              title: bi('导出报告或同步交接单', 'Export report or sync handoff'),
              onClick: () => patch({ chiefMoreMenuOpen: !view.chiefMoreMenuOpen }),
            }, '⋯'),
            view.chiefMoreMenuOpen
              ? h(
                  'div',
                  { className: 'dnb-more-menu', style: { minWidth: 212 } },
                  h('button', {
                    type: 'button',
                    className: 'dnb-more-item',
                    onClick: () => {
                      patch({ chiefMoreMenuOpen: false })
                      exportReport(false)
                    },
                  }, h('span', null, bi('📄 导出复盘报告 (.md)', '📄 Export Report (.md)'))),
                  h('button', {
                    type: 'button',
                    className: 'dnb-more-item',
                    onClick: () => {
                      patch({ chiefMoreMenuOpen: false })
                      exportReport(true)
                    },
                  }, h('span', null, bi('📋 复制复盘报告 (Markdown)', '📋 Copy Report (Markdown)'))),
                  h('div', { className: 'dnb-more-sep' }),
                  h('button', {
                    type: 'button',
                    className: 'dnb-more-item',
                    'data-active': (!isHandoffPinned && syncOnDigest) ? '1' : '0',
                    disabled: isHandoffPinned,
                    title: isHandoffPinned
                      ? bi('交接单已被你定住防改，参谋长不会覆盖它', 'Handoff is pinned by you, so Chief will not overwrite it.')
                      : bi('开启后，每次更新摘要时都会顺便更新交接单', 'Update the handoff card automatically whenever you refresh the summary.'),
                    onClick: () => {
                      patch({ chiefMoreMenuOpen: false })
                      void toggleSyncHandoffOnDigest(!syncOnDigest)
                    },
                  },
                    h('span', null, isHandoffPinned ? bi('🔒 交接单已定住', '🔒 Handoff Pinned') : bi('更新摘要时同步交接单', 'Auto-sync handoff on update')),
                    h('span', { style: { fontSize: 10.5, opacity: 0.78 } }, isHandoffPinned ? bi('锁定', 'Locked') : (syncOnDigest ? bi('开', 'On') : bi('关', 'Off'))),
                  ),
                  h('button', {
                    type: 'button',
                    className: 'dnb-more-item',
                    disabled: isHandoffPinned || view.secRegenerating || narrative.summarizing,
                    title: isHandoffPinned ? bi('交接单已定住防改，不能覆盖', 'Handoff is pinned and cannot be overwritten.') : bi('把当前摘要写进交接单', 'Copy the current summary into the handoff card'),
                    onClick: () => {
                      patch({ chiefMoreMenuOpen: false })
                      void loadChiefView(false, { syncHandoff: true })
                    },
                  }, h('span', null, isHandoffPinned ? bi('🔒 交接单已定住', '🔒 Handoff Pinned') : bi('↪ 立即更新交接单', '↪ Sync Handoff Now'))),
                )
              : null,
          ),
        ),
        bodyStyle: { padding: '6px 14px 12px' },
      },
      useSixBriefCards
        ? h(
            'div',
            { className: 'dnb-editorial-body' },
            goalRow
              ? h(
                  'div',
                  { className: 'dnb-editorial-goal' },
                  h('div', { className: 'dnb-editorial-goal-kicker' }, bi('总目标', 'Main Goal')),
                  h('div', { className: 'dnb-editorial-goal-text' }, goalRow.body),
                )
              : null,
            alertRows.length > 0
              ? h(
                  'div',
                  { className: 'dnb-editorial-alert' },
                  alertRows.map(ar =>
                    h(
                      'div',
                      { key: ar.key, className: 'dnb-editorial-alert-row', 'data-tone': ar.alertTone },
                      h('span', { className: 'dnb-editorial-alert-key' }, ar.alertLabel),
                      h('span', { className: 'dnb-editorial-alert-val' }, ar.body),
                    ),
                  ),
                )
              : null,
            mainBriefRows.length > 0
              ? h(
                  'div',
                  { className: 'dnb-six-brief' },
                  mainBriefRows.map(row =>
                    h(
                      'div',
                      { key: row.key, className: 'dnb-six-row', 'data-role': row.role || 'plain' },
                      h('span', { className: 'dnb-six-tag' }, row.shortKey || row.key),
                      h('span', { className: 'dnb-six-body' }, row.body),
                    ),
                  ),
                )
              : null,
            h(
              'div',
              { className: 'dnb-editorial-foot' },
              quietEmptyRows.length > 0
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'dnb-editorial-quiet-btn',
                      onClick: () => setEmptyStatusExpanded(v => !v),
                    },
                    h('span', { className: 'dnb-editorial-quiet-check' }, '✓'),
                    h('span', null, quietEmptyRows.map(q => q.shortPhrase).join(' · ')),
                    h('span', { className: 'dnb-editorial-quiet-more' },
                      emptyStatusExpanded ? bi('收起原文', 'Hide') : bi('查看原文', 'Details')),
                  )
                : (alertRows.length > 0
                    ? h('span', { className: 'dnb-editorial-alert-badge' },
                        bi(`● 存在 ${alertRows.length} 项待确认阻塞`, `● ${alertRows.length} item(s) need attention`))
                    : h('span', null)),
              renderEditorialMeta(),
            ),
            emptyStatusExpanded && quietEmptyRows.length > 0
              ? h(
                  'div',
                  { className: 'dnb-editorial-quiet-orig' },
                  quietEmptyRows.map(q =>
                    h(
                      'div',
                      { key: q.key, className: 'dnb-editorial-quiet-orig-row' },
                      h('span', { className: 'dnb-editorial-quiet-orig-key' }, q.label + '：'),
                      h('span', null, q.body),
                    ),
                  ),
                )
              : null,
          )
        : blocks.length
          ? h(
              'div',
              { className: 'dnb-editorial-body' },
              blocks.map((blk, i) =>
                h(
                  'div',
                  { key: i, style: { marginTop: i === 0 ? 0 : 10 } },
                  blk.heading ? renderStructuredHeading(blk.heading, false) : null,
                  (blk.items || []).map((it, j) => renderStructuredItem(it, `${i}-${j}`)),
                ),
              ),
              h(
                'div',
                { className: 'dnb-editorial-foot' },
                h('span', null),
                renderEditorialMeta(),
              ),
            )
          : h('p', { className: 'dnb-prose-p' },
              '目前还没有生成总结。你可以在下面的输入框存资料、设拦截规则，或让参谋长去干活。'),
      ),
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
            return (it && it.thinkingEffortMode === 'auto') ? `自动→${label}` : `${label}`
          }

          const isExpandableReply = (item) => {
            if (!item) return false
            if (isReceiptChatItem(item)) return true
            const txt = String(item.text || '')
            return txt.includes('\n') || txt.length > 96
          }

          const renderExtMemoryPill = (item, keyPrefix = '') => {
            const mr = item && item.memoryRecall
            const mb = item && item.moodBadge
            if ((!mr || !mr.count) && (!mb || !mb.text)) return null
            const recKey = `${keyPrefix}${item.id || item.at || 'latest'}`
            const recOpen = Boolean(expandedRecallIds[recKey])
            return h(
              'div',
              { style: { marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 } },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
                mr && mr.count
                  ? h('button', {
                      type: 'button',
                      className: 'dnb-mini-btn',
                      style: { fontSize: 10.5, padding: '2px 7px' },
                      onClick: () => setExpandedRecallIds(prev => ({ ...prev, [recKey]: !prev[recKey] })),
                    }, `${recOpen ? '▾' : '▸'} 🧠 ${bi(`已参考 ${mr.count} 条外部记忆`, `Referenced ${mr.count} external memor${mr.count > 1 ? 'ies' : 'y'}`)}${mr.provider ? ` · ${mr.provider}` : ''}${mr.latencyMs ? ` · ${mr.latencyMs}ms` : ''}`)
                  : null,
                mb && mb.text
                  ? h('span', {
                      className: 'dnb-tag',
                      title: mb.detail || mb.text,
                      style: { fontSize: 10.5, opacity: 0.9 },
                    }, `${mb.glyph || '💫'} ${mb.text}`)
                  : null,
              ),
              recOpen && mr && Array.isArray(mr.items) && mr.items.length > 0
                ? h(
                    'div',
                    {
                      style: {
                        padding: '6px 8px',
                        borderRadius: 8,
                        border: '1px solid var(--dnb-border)',
                        background: 'var(--dnb-surface-2, rgba(127,127,127,0.06))',
                        fontSize: 11,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                      },
                    },
                    mr.items.map((rec, rIdx) =>
                      h(
                        'div',
                        { key: rec.id || rIdx, style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 } },
                        h('span', { style: { color: 'var(--dnb-text-2)', lineHeight: 1.4 } },
                          `[${rec.evidence === 'observed' ? '实证' : rec.evidence === 'inferred' ? '推断' : '记录'}${rec.source ? ' · ' + rec.source : ''}] ${rec.preview}`),
                        mr.canRetract && rec.id
                          ? h('button', {
                              type: 'button',
                              className: 'dnb-mini-btn',
                              style: { fontSize: 10, flexShrink: 0 },
                              onClick: () => void retractExternalMemoryApi([rec.id]),
                            }, bi('撤回', 'Retract'))
                          : null,
                      ),
                    ),
                  )
                : null,
            )
          }

          const renderTurnReplyCard = (item) => {
            const isReceipt = isReceiptChatItem(item)
            const effortBadge = formatChiefReplyEffortBadge(item)
            const expandable = isExpandableReply(item)
            const isReplyOpen = !expandable || Boolean(expandedReplyIds[item.id])
            const actionsArr = Array.isArray(item.actions) ? item.actions.filter(Boolean) : []
            const primaryActionLabel = actionsArr[0] || (isReceipt ? bi('操作记录', 'Log') : bi('参谋回答', 'Reply'))
            const isSleepAction = /休眠|关停/.test(primaryActionLabel)
            const actionTone = isSleepAction ? 'muted' : (isReceipt ? 'sage' : 'accent')
            const summaryLine = extractReplySummaryLine(item.text) || clampTitle(String(item.text || ''), 88)
            const toggleReply = () => setExpandedReplyIds(prev => ({
              ...prev,
              [item.id]: !prev[item.id],
            }))

            if (!expandable) {
              return h(
                'div',
                {
                  key: item.id,
                  className: 'dnb-turn-reply-item',
                  'data-role': isReceipt ? 'receipt' : (item.role === 'chief' ? 'chief' : 'user'),
                  'data-open': '1',
                },
                h(
                  'div',
                  { className: 'dnb-reply-short-head' },
                  h('span', { className: 'dnb-reply-action-txt', 'data-tone': actionTone },
                    item.isOneStopReport
                      ? bi('一站式战报', 'Report')
                      : (item.resumeTaskId ? bi('授权后继续', 'Resumed') : primaryActionLabel)),
                  h(
                    'span',
                    { className: 'dnb-reply-time' },
                    effortBadge ? `${effortBadge} · ${timeLabel(item.at)}` : timeLabel(item.at),
                  ),
                ),
                renderStructuredText(item.text),
                renderExtMemoryPill(item, 'short-'),
              )
            }

            return h(
              'div',
              {
                key: item.id,
                className: 'dnb-turn-reply-item',
                'data-role': isReceipt ? 'receipt' : (item.role === 'chief' ? 'chief' : 'user'),
                'data-open': isReplyOpen ? '1' : '0',
              },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dnb-reply-summary-btn',
                  title: isReplyOpen ? bi('点击收起详情', 'Click to collapse') : bi('点击展开详情', 'Click to expand'),
                  onClick: toggleReply,
                },
                h(
                  'span',
                  { className: 'dnb-reply-summary-left' },
                  h('span', { className: 'dnb-reply-chevron' }, isReplyOpen ? '▾' : '▸'),
                  h('span', { className: 'dnb-reply-summary-text' }, summaryLine),
                ),
                h(
                  'span',
                  { className: 'dnb-reply-summary-right' },
                  h('span', { className: 'dnb-reply-action-txt', 'data-tone': actionTone }, primaryActionLabel),
                  h('span', { className: 'dnb-reply-time' }, timeLabel(item.at)),
                ),
              ),
              isReplyOpen
                ? h(
                    'div',
                    { className: 'dnb-reply-detail' },
                    renderStructuredText(item.text),
                    renderExtMemoryPill(item, 'exp-'),
                    (effortBadge || actionsArr.length > 1 || item.isOneStopReport || item.resumeTaskId)
                      ? h(
                          'div',
                          { className: 'dnb-reply-detail-meta' },
                          item.isOneStopReport ? h('span', null, bi('一站式战报回执', 'One-stop report')) : null,
                          item.resumeTaskId ? h('span', null, bi('授权后继续结果', 'Resumed after approval')) : null,
                          effortBadge ? h('span', null, `${bi('思考深度', 'Effort')}: ${effortBadge}`) : null,
                          actionsArr.map((actTag, idx) => h('span', { key: idx }, actTag)),
                        )
                      : null,
                  )
                : null,
            )
          }

          const collapsedMap = view.qaCollapsedTurnIds || {}
          const anyTurnCollapsed = filteredTurns.some(t => Boolean(collapsedMap[t.id]))
          const allRepliesExpanded = filteredTurns.every(t =>
            t.replies.every(r => !isExpandableReply(r) || Boolean(expandedReplyIds[r.id])),
          )
          const allExpandedNow = showHistory && filteredTurns.length > 0 && !anyTurnCollapsed && allRepliesExpanded

          return h(
            'div',
            { 'data-dnb-section': 'chief-chat' },
            h(
              AccCard,
              {
                open: showHistory,
                onToggle: () => setShowHistory(v => !v),
              tone: 'slate',
              className: 'dnb-qa-section',
              title: bi('问答与记录', 'Q&A & Log'),
              count: `${turns.length}`,
              bodyStyle: { padding: 0 },
              actions: h(
                'div',
                { className: 'dnb-text-filter-bar dnb-qa-filter-quiet', style: { padding: 0, gap: 4 } },
                [
                  { key: 'all', label: `${bi('全部', 'All')} ${turns.length}` },
                  { key: 'qa', label: `${bi('问答', 'Q&A')} ${qaCount}` },
                  { key: 'receipt', label: `${bi('记录', 'Log')} ${receiptCount}` },
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
                  ? h(
                      React.Fragment,
                      null,
                      h('span', { className: 'dnb-qa-filter-sep', 'aria-hidden': 'true' }, '|'),
                      h('button', {
                        type: 'button',
                        className: 'dnb-text-filter-btn',
                        title: allExpandedNow ? bi('全部折叠', 'Collapse all') : bi('全部展开', 'Expand all'),
                        onClick: () => {
                          if (!showHistory) {
                            setShowHistory(true)
                            patch({ qaCollapsedTurnIds: {} })
                            const nextExpanded = {}
                            for (const t of filteredTurns) {
                              for (const r of t.replies) {
                                if (isExpandableReply(r)) nextExpanded[r.id] = true
                              }
                            }
                            setExpandedReplyIds(nextExpanded)
                            return
                          }
                          if (allExpandedNow) {
                            const nextMap = {}
                            for (const t of filteredTurns) nextMap[t.id] = true
                            patch({ qaCollapsedTurnIds: nextMap })
                            setExpandedReplyIds({})
                          } else {
                            patch({ qaCollapsedTurnIds: {} })
                            const nextExpanded = {}
                            for (const t of filteredTurns) {
                              for (const r of t.replies) {
                                if (isExpandableReply(r)) nextExpanded[r.id] = true
                              }
                            }
                            setExpandedReplyIds(nextExpanded)
                          }
                        },
                      }, allExpandedNow ? bi('全部折叠', 'Collapse all') : bi('全部展开', 'Expand all')),
                    )
                  : null,
              ),
            },
            filteredTurns.length > 0
              ? h(
                  'div',
                  { className: 'dnb-qa-stream' },
                  filteredTurns.map(turn => {
                    const q = turn.question
                    const repliesToShow = chatFilter === 'receipt' && turn.kind === 'system'
                      ? turn.replies.filter(r => isReceiptChatItem(r))
                      : turn.replies
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
                              title: isTurnCollapsed ? '点击展开这轮对话' : '点击收起这轮对话',
                              onClick: toggleTurn,
                            },
                            h(
                              'div',
                              { className: 'dnb-turn-q-row' },
                              h(
                                'div',
                                { className: 'dnb-turn-q-main' },
                                h('span', { className: 'dnb-qa-who', 'data-role': 'user' }, bi('你', 'You')),
                                q.imageCount > 0
                                  ? h('span', { className: 'dnb-qa-img-pill' }, `🖼 ×${q.imageCount}`)
                                  : null,
                                q.text
                                  ? h('span', {
                                      className: 'dnb-turn-q-text',
                                      'data-clamped': isTurnCollapsed ? '1' : '0',
                                    }, q.text)
                                  : null,
                              ),
                              h(
                                'div',
                                { className: 'dnb-turn-q-meta' },
                                isTurnCollapsed && repliesToShow.length > 0
                                  ? h('span', null, `${repliesToShow.length} 条`)
                                  : null,
                                h('span', null, timeLabel(q.at)),
                                h(Icon, {
                                  name: 'chevron',
                                  size: 12,
                                  style: {
                                    color: 'var(--dnb-text-3)',
                                    transform: isTurnCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                                    transition: 'transform 0.16s ease',
                                  },
                                }),
                              ),
                            ),
                          )
                        : h(
                            'div',
                            {
                              className: 'dnb-turn-question',
                              title: isTurnCollapsed ? '点击展开这组记录' : '点击收起这组记录',
                              onClick: toggleTurn,
                            },
                            h(
                              'div',
                              { className: 'dnb-turn-q-row' },
                              h(
                                'div',
                                { className: 'dnb-turn-q-main' },
                                h('span', { className: 'dnb-qa-who', 'data-role': 'system' }, bi('系统', 'Sys')),
                                h('span', { className: 'dnb-turn-q-text', style: { color: 'var(--dnb-text-2)', fontWeight: 450 } },
                                  bi('系统自动记录', 'System log')),
                              ),
                              h(
                                'div',
                                { className: 'dnb-turn-q-meta' },
                                repliesToShow.length > 0
                                  ? h('span', null, `${repliesToShow.length} 条`)
                                  : null,
                                turn.at ? h('span', null, timeLabel(turn.at)) : null,
                                h(Icon, {
                                  name: 'chevron',
                                  size: 12,
                                  style: {
                                    color: 'var(--dnb-text-3)',
                                    transform: isTurnCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
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
                  chatFilter === 'receipt' ? '还没有操作记录' : '还没有提问记录'),
          ),
          )
        })()
      : null,
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
        '只看任务看板和项目情况',
        '帮你分析问题、提建议',
        '不会改你的任何文件',
        '不会插手主对话和子代理的活',
      ],
      footer: '只看不改，只在你问时给建议。',
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
        '包含 L0 顾问的全部能力',
        '可自己整理记忆、档案和任务看板',
        '不会直接改你的项目文件',
        '不会直接插话打断主对话',
      ],
      footer: '只整理笔记和看板，不碰你的项目代码。',
    },
    {
      key: 'strategist',
      tier: 'L2',
      icon: '🛡️',
      shortLabel: 'L2 参谋',
      title: 'L2 · 参谋模式',
      code: 'ADVISOR WITH APPROVAL',
      badgeText: '逐项问你',
      badgeTone: 'blue',
      bullets: [
        '包含 L1 助手的全部能力',
        '想改项目文件前会先发请求',
        '想调整主对话或子代理时也会先请示',
        '每次重要操作都会弹窗问你',
        '你点同意后才会执行',
      ],
      footer: '先提出修改方案，等你点头同意再动手。',
    },
    {
      key: 'chief',
      tier: 'L3',
      icon: '⚡',
      shortLabel: 'L3 参谋长',
      title: 'L3 · 参谋长模式',
      code: 'CHIEF OF STAFF',
      badgeText: '需确认风险',
      badgeTone: 'amber',
      bullets: [
        '包含 L2 参谋的全部能力',
        '不用逐个问你，可直接动手推进',
        '可以切换主对话的模型或状态',
        '可以协调子代理怎么干活',
        '开启前需要先看风险说明并打勾确认',
      ],
      footer: '权限很高，开启前请确认你了解风险。',
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
  const globalSafetyOn = meta.globalSafetyGuardEnabled !== false
  const sessionSafetyOn = meta.sessionSafetyGuardEnabled !== false
  const effectiveSafetyOn = Boolean(globalSafetyOn && sessionSafetyOn && tm.safetyGuardEnabled !== false)
  const customWallsList = Array.isArray(view.guardWalls) ? view.guardWalls : []
  const activeWallCount = customWallsList.filter(w => w && w.activeNow).length
  const totalWallCount = customWallsList.length
  const activeChipsCount = (tm.intervention ? 1 : 0)
    + (tm.autoCompact ? 1 : 0)
    + (!effectiveSafetyOn ? 1 : 0)
  const curRunMode = meta.stopped
    ? 'off'
    : (meta.runMode && ['off', 'patrol', 'managed'].includes(meta.runMode)
        ? meta.runMode
        : (meta.paceMode === 'auto' ? 'managed' : (meta.paceMode === 'smart' ? 'patrol' : 'off')))
  const isManagedMode = curRunMode === 'managed' || Boolean(meta.autoPilot)
  const showUrgentStrip = Boolean(tm.intervention || isManagedMode || !effectiveSafetyOn || guard.circuitBroken)
  const commitTokenThresholdInput = (rawText) => {
    const valStr = String(rawText ?? '').trim() || '64K'
    void updateSecConfig({
      tacticalModes: {
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
      void updateSecConfig({ tacticalModes: { maxInterventionTurns: safeN } })
      return
    }
    if (key === 'compactThresholdPct') {
      const targetPct = Math.min(95, Math.max(10, Math.round(Number(val) || 80)))
      void updateSecConfig({ tacticalModes: { compactThresholdMode: 'pct', compactThresholdPct: targetPct } })
      return
    }
    if (key === 'compactThresholdMode') {
      const nextM = val === 'tokens' ? 'tokens' : 'pct'
      patch({ compactInputDraft: null })
      void updateSecConfig({ tacticalModes: { compactThresholdMode: nextM } })
      return
    }
    if (key === 'smartCompact') {
      const nextSmart = Boolean(val)
      void updateSecConfig({
        tacticalModes: {
          smartCompact: nextSmart,
          ...(nextSmart ? { autoCompact: true } : {}),
        },
      })
      return
    }
    void updateSecConfig({ tacticalModes: { [key]: val } })
  }
  const placeholder = secImages.length > 0
    ? bi('已放 ' + secImages.length + ' 张图，按回车直接发送，或写点说明…', `${secImages.length} image(s) attached. Press Enter to send or add text…`)
    : (activeTarget === 'auto'
        ? bi(`直接说你想让${chiefShortName(view)}做什么：整理档案、加拦截规则、改计划或问问题…`, `Tell ${chiefShortName(view)} what to do: organize archives, add block rules, edit plans, or ask…`)
        : activeTarget === 'all'
          ? bi('给所有人发消息（', 'Message everyone (') + modeObj.label + ')…'
          : (bi('给 @', 'To @') + shortAgentName(activePeer ? activePeer.name : activeTarget, true) + ' ' + modeObj.label + '…'))

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
            h('span', { style: { fontSize: 12, fontWeight: 600, color: 'var(--dnb-text)', display: 'inline-flex', alignItems: 'center', gap: 6 } },
              h(Icon, { name: 'sliders', size: 13, style: { color: 'var(--dnb-accent)' } }),
              bi('参谋长控制面板', 'Chief Control Panel')),
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
          // Row 0: Unified One-Click Safety Block Switch (built-in auto-block + custom rules count)
          h(
            'div',
            { className: 'dnb-tactical-row' },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h(
                'div',
                { style: { fontSize: 12, fontWeight: 500, color: effectiveSafetyOn ? 'var(--dnb-sage, #63d1b0)' : 'var(--dnb-coral, #f28b88)', display: 'flex', alignItems: 'center', gap: 6 } },
                h(Icon, { name: effectiveSafetyOn ? 'shieldCheck' : 'shieldOff', size: 13 }),
                bi('安全拦截', 'Safety Block'),
                !effectiveSafetyOn
                  ? h('span', { className: 'dnb-tag', style: { fontSize: 10, color: 'var(--dnb-coral)', borderColor: 'var(--dnb-border-strong)' } }, !globalSafetyOn ? '全部对话已关' : '当前对话已关')
                  : null,
              ),
              h(
                'div',
                { style: { fontSize: 11, color: effectiveSafetyOn ? 'var(--dnb-text-3)' : 'var(--dnb-coral)', marginTop: 1 } },
                effectiveSafetyOn
                  ? `自动拦住删文件、改项目外文件、读密码等危险操作${totalWallCount ? ` · 自定义规则 ${activeWallCount}/${totalWallCount} 条生效` : ''}`
                  : `已关闭（${!globalSafetyOn ? '全部对话已关' : '当前对话已关'}）${activeWallCount ? ` · 还有 ${activeWallCount} 条自定义规则生效` : ' · 已全部放行'}`,
              ),
            ),
            h(Switch, {
              checked: effectiveSafetyOn,
              tone: effectiveSafetyOn ? undefined : 'red',
              onChange: on => {
                if (on) {
                  void updateSecConfig(
                    !globalSafetyOn
                      ? { globalSafetyGuardEnabled: true, ...(tm.safetyGuardEnabled === false || !sessionSafetyOn ? { tacticalModes: { safetyGuardEnabled: true } } : {}) }
                      : { tacticalModes: { safetyGuardEnabled: true } },
                  )
                } else {
                  patch({
                    tacticalMenuOpen: false,
                    safetyGuardModalOpen: true,
                    safetyGuardModalScope: 'session',
                    safetyGuardAgreed: false,
                    safetyGuardPauseWalls: activeWallCount > 0,
                  })
                }
              },
            }),
          ),
          // Row 1: Intervention + Max Turns Stepper
          h(
            'div',
            { className: 'dnb-tactical-row' },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h('div', { style: { fontSize: 12, fontWeight: 500, color: tm.intervention ? 'var(--dnb-amber, #f3be6d)' : 'var(--dnb-text)', display: 'flex', alignItems: 'center', gap: 6 } },
                h(Icon, { name: 'zap', size: 12.5, style: { color: tm.intervention ? 'var(--dnb-amber)' : 'var(--dnb-text-3)' } }),
                '强介入（权限越高，管得越直接）'),
              h('div', { style: { fontSize: 11, color: 'var(--dnb-text-3)', marginTop: 1 } },
                INTERVENTION_TIER_DESC[permMode] || INTERVENTION_TIER_DESC.advisor),
            ),
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 } },
              h(
                'div',
                { className: 'dnb-stepper', title: '最多连续推动多少轮（降到 1 轮后再点「-」可改为不限轮数）' },
                h('button', {
                  type: 'button',
                  disabled: isUnlimitedTurns,
                  style: isUnlimitedTurns ? { opacity: 0.35, cursor: 'not-allowed' } : undefined,
                  title: isUnlimitedTurns ? '现在是不限轮数' : (maxTurns <= 1 ? '再点一次会弹窗确认开启不限轮数' : '减少轮数上限'),
                  onClick: () => {
                    if (isUnlimitedTurns) return
                    toggleTacticalField('maxInterventionTurns', maxTurns <= 1 ? 0 : maxTurns - 1)
                  },
                }, '-'),
                h('span', { style: isUnlimitedTurns ? { color: 'var(--dnb-accent)', fontWeight: 600 } : undefined }, isUnlimitedTurns ? '∞' : `${maxTurns}轮`),
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
          // Row 2: Auto-Compact + Smart Co-Managed Mode (智选) + Dual Threshold (Pct 10%-95% | Context Tokens)
          h(
            'div',
            { className: 'dnb-tactical-row', style: { flexDirection: 'column', alignItems: 'stretch', gap: 7 } },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
              h(
                'div',
                { style: { flex: 1, minWidth: 0 } },
                h('div', { style: { fontSize: 12, fontWeight: 500, color: isSmartCompact ? 'var(--dnb-accent)' : 'var(--dnb-text)', display: 'flex', alignItems: 'center', gap: 6 } },
                  h(Icon, { name: 'layers', size: 12.5, style: { color: isSmartCompact ? 'var(--dnb-accent)' : 'var(--dnb-text-3)' } }),
                  '存好资料再自动压缩（每轮检查）'),
                h('div', { style: { fontSize: 11, color: 'var(--dnb-text-3)', marginTop: 1, lineHeight: 1.4 } },
                  isSmartCompact
                    ? '智选压缩已开：会在每段任务做完时，先存好关键资料再压缩'
                    : (thresholdMode === 'tokens'
                        ? `每轮检查：对话长度到 ${thresholdInputVal} 时先存档再自动压缩`
                        : `每轮检查：对话占满 ${pct}% 时先存档再自动压缩`)),
              ),
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 } },
                h('button', {
                  type: 'button',
                  className: 'dnb-mini-btn',
                  'data-tone': isSmartCompact ? 'accent' : undefined,
                  title: isSmartCompact
                    ? '已开启智选压缩，点这里切回按固定大小压缩'
                    : '开启智选压缩：在每段任务做完时自动先存档再压缩',
                  onClick: () => toggleTacticalField('smartCompact', !isSmartCompact),
                }, isSmartCompact ? '智选中' : '智选'),
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
                    }, '按 Token 数'),
                  ),
                  thresholdMode === 'pct'
                    ? h('select', {
                        value: String(pct),
                        title: '对话占满多少比例时自动存档并压缩（10%–95%，低于 25% 会提醒）',
                        style: {
                          height: 26,
                          minWidth: 74,
                          borderRadius: 8,
                          border: isLowPctThreshold ? '1px solid var(--dnb-amber)' : '1px solid var(--dnb-border-strong)',
                          background: 'var(--dnb-card)',
                          color: 'var(--dnb-text)',
                          fontSize: 11.5,
                          fontWeight: 500,
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
                          placeholder: '比如 1M 或 64（默认单位 K）',
                          title: '填 1M 就是 1M tokens；不写单位默认是 K（比如 64 就是 64K）；低于 32K 会提醒',
                          style: {
                            width: 112,
                            height: 26,
                            borderRadius: 8,
                            border: isLowTokenThreshold ? '1px solid var(--dnb-amber)' : '1px solid var(--dnb-border-strong)',
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
                    color: 'var(--dnb-amber, #f3be6d)',
                    background: 'var(--dnb-amber-soft, rgba(245, 158, 11, 0.1))',
                    border: '1px solid var(--dnb-border)',
                    borderRadius: 8,
                    padding: '4px 8px',
                  },
                }, isLowTokenThreshold
                  ? `你填的 ${tm.compactThresholdInput || '低于 32K'} 太小了（建议至少 32K），压缩太勤容易丢细节`
                  : (view.compactLowWarning
                      ? view.compactLowWarning
                      : `现在设的 ${pct}% 太低了，压缩太勤容易丢细节，建议选 30%–80%`))
              : null,
          ),
          // Row 3: Strict Verify
          h(
            'div',
            { className: 'dnb-tactical-row' },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h('div', { style: { fontSize: 12, fontWeight: 500, color: 'var(--dnb-text)', display: 'flex', alignItems: 'center', gap: 6 } },
                h(Icon, { name: 'checkCircle', size: 12.5, style: { color: tm.strictVerify ? 'var(--dnb-sage)' : 'var(--dnb-text-3)' } }),
                '完工前核实证据'),
              h('div', { style: { fontSize: 11, color: 'var(--dnb-text-3)', marginTop: 1 } }, '必须贴出文件或命令运行结果，没核实就不算完工'),
            ),
            h(Switch, { checked: Boolean(tm.strictVerify), onChange: v => toggleTacticalField('strictVerify', v) }),
          ),
          // Row 5: Concise Brief
          h(
            'div',
            { className: 'dnb-tactical-row' },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h('div', { style: { fontSize: 12, fontWeight: 500, color: 'var(--dnb-text)', display: 'flex', alignItems: 'center', gap: 6 } },
                h(Icon, { name: 'alignLeft', size: 12.5, style: { color: tm.conciseBrief ? 'var(--dnb-accent)' : 'var(--dnb-text-3)' } }),
                '极简汇报模式'),
              h('div', { style: { fontSize: 11, color: 'var(--dnb-text-3)', marginTop: 1 } }, '只用几句大白话汇报重点，少放复杂数字'),
            ),
            h(Switch, { checked: Boolean(tm.conciseBrief), onChange: v => toggleTacticalField('conciseBrief', v) }),
          ),
          // Row 5.5: Chief-exclusive External Memory quick toggle
          (() => {
            const extCfg = meta.externalMemory || {}
            const extStatus = meta.externalMemoryStatus || {}
            const sKey = view.sessionId ? `session:${view.sessionId}` : ''
            const curWsPol = (sKey && extCfg.workspacePolicies && extCfg.workspacePolicies[sKey]) || extStatus.policy || 'read-write'
            const extOn = Boolean(extCfg.enabled && extCfg.memorySlot && extCfg.memorySlot.kind !== 'none' && curWsPol !== 'disabled')
            return h(
              'div',
              { className: 'dnb-tactical-row' },
              h(
                'div',
                { style: { flex: 1, minWidth: 0 } },
                h('div', { style: { fontSize: 12, fontWeight: 500, color: 'var(--dnb-text)', display: 'flex', alignItems: 'center', gap: 6 } },
                  h(Icon, { name: 'brain', size: 12.5, style: { color: extOn ? 'var(--dnb-accent)' : 'var(--dnb-text-3)' } }),
                  bi('参谋长期记忆（不打扰主对话）', 'Chief Memory (0-byte @lead)')),
                h('div', { style: { fontSize: 11, color: 'var(--dnb-text-3)', marginTop: 1 } },
                  extOn
                    ? `${(extCfg.memorySlot && (extCfg.memorySlot.label || extCfg.memorySlot.kind)) || '记事本'} · ${curWsPol === 'read-only' ? bi('本局只读', 'Read-only') : bi('已启用', 'Active')}`
                    : bi('未开启 · 点右侧进入「记忆」页一键打开', 'Off · Open Memory tab for 1-click setup')),
              ),
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 } },
                h('button', {
                  type: 'button',
                  className: 'dnb-mini-btn',
                  onClick: () => patch({ tacticalMenuOpen: false, settingsOpen: false, tab: 'extmem' }),
                }, bi('记忆页', 'Memory')),
                h(Switch, {
                  checked: extOn,
                  onChange: on => {
                    if (!extCfg.memorySlot || extCfg.memorySlot.kind === 'none') {
                      const nextPols = { ...(extCfg.workspacePolicies || {}) }
                      if (sKey) nextPols[sKey] = 'read-write'
                      void updateSecConfig({
                        externalMemory: {
                          ...extCfg,
                          enabled: on,
                          memorySlot: { ...(extCfg.memorySlot || {}), enabled: true, kind: 'builtin-md', label: '参谋自带记事本' },
                          workspacePolicies: nextPols,
                        },
                      })
                      return
                    }
                    const nextPols = { ...(extCfg.workspacePolicies || {}) }
                    if (sKey) nextPols[sKey] = on ? 'read-write' : 'disabled'
                    void updateSecConfig({
                      externalMemory: {
                        ...extCfg,
                        enabled: on ? true : extCfg.enabled,
                        workspacePolicies: nextPols,
                      },
                    })
                  },
                }),
              ),
            )
          })(),
          // Row 6: Chief Thinking Effort Adaptive Control + Team Effort Mode (Auto / Manual)
          h(
            'div',
            { className: 'dnb-tactical-row', style: { flexDirection: 'column', alignItems: 'stretch', gap: 6 } },
            h('div', { style: { fontSize: 12, fontWeight: 500, color: 'var(--dnb-text)', display: 'flex', alignItems: 'center', gap: 6 } },
              h(Icon, { name: 'sparkles', size: 12.5, style: { color: 'var(--dnb-accent)' } }),
              '参谋长思考强度'),
            h(EffortFanGauge, {
              value: meta.thinkingEffort || 'auto',
              skin: view.uiSkin,
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
                  h('div', { className: 'dnb-team-effort-title' }, '主对话和子代理的思考深度'),
                  h('div', { className: 'dnb-team-effort-sub' },
                    teamMode === 'manual'
                      ? '手动：参谋长不插手，由你自己调'
                      : '自动（默认）：参谋长按任务难度帮你调'),
                ),
                h(
                  'div',
                  { className: 'dnb-team-effort-seg', role: 'group', 'aria-label': '团队思考深度调整方式' },
                  h('button', {
                    type: 'button',
                    className: 'dnb-team-effort-btn',
                    'data-active': teamMode === 'auto' ? '1' : '0',
                    title: '自动：按任务难度帮你调主对话和子代理的思考深度',
                    onClick: () => {
                      if (teamMode !== 'auto') void updateSecConfig({ teamEffortMode: 'auto' })
                    },
                  }, '自动'),
                  h('button', {
                    type: 'button',
                    className: 'dnb-team-effort-btn',
                    'data-active': teamMode === 'manual' ? '1' : '0',
                    title: '手动：参谋长不再改动主对话和子代理的思考深度',
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
              h('span', null, 'ⓘ 注意事项：模型效果和规则冲突'),
              h('span', { style: { fontSize: 10, opacity: 0.7 } }, view.chiefDisclaimerOpen ? '▴ 收起' : '▾ 展开'),
            ),
            view.chiefDisclaimerOpen
              ? h(
                  'div',
                  { className: 'dnb-disclaimer-box', style: { marginTop: 4 } },
                  h('div', { style: { marginBottom: 4 } },
                    h('strong', null, '说明 1（模型能力）：'),
                    '自动检查、存档压缩和规则拦截的效果，主要看你给参谋长选了哪个大模型。不同模型在拆任务和听指令上的表现差别很大。',
                  ),
                  h('div', null,
                    h('strong', null, '说明 2（规则冲突）：'),
                    '如果你在项目里加了太多其他的提示词或全局 Rules，可能会和本插件的规则打架，导致重复提醒或跑偏。',
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
              view.secLatestReply.memoryRecall && view.secLatestReply.memoryRecall.count
                ? h('div', { style: { marginTop: 5, fontSize: 10.5, color: 'var(--dnb-text-3)' } },
                    `🧠 ${bi(`已参考 ${view.secLatestReply.memoryRecall.count} 条外部记忆`, `Referenced ${view.secLatestReply.memoryRecall.count} external memor${view.secLatestReply.memoryRecall.count > 1 ? 'ies' : 'y'}`)}${view.secLatestReply.memoryRecall.provider ? ` (${view.secLatestReply.memoryRecall.provider})` : ''}${view.secLatestReply.moodBadge && view.secLatestReply.moodBadge.text ? ` · ${view.secLatestReply.moodBadge.glyph || '💫'} ${view.secLatestReply.moodBadge.text}` : ''}`)
                : (view.secLatestReply.moodBadge && view.secLatestReply.moodBadge.text
                    ? h('div', { style: { marginTop: 5, fontSize: 10.5, color: 'var(--dnb-text-3)' } },
                        `${view.secLatestReply.moodBadge.glyph || '💫'} ${view.secLatestReply.moodBadge.text}`)
                    : null),
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

    // Active Tactical Mode Strip (shows urgent modes only: intervention, safety off, circuit broken)
    showUrgentStrip
      ? h(
          'div',
          { className: 'dnb-tactical-strip' },
          tm.intervention
            ? h('button', {
                type: 'button',
                className: 'dnb-tac-chip',
                'data-tone': 'amber',
                onClick: () => patch({ tacticalMenuOpen: !view.tacticalMenuOpen }),
              }, h(Icon, { name: 'zap', size: 11 }), `强介入 ${Number(guard.interventionTurns ?? guard.consecutiveInterventionTurns ?? 0)}/${isUnlimitedTurns ? '∞' : maxTurns}`)
            : null,
          isManagedMode
            ? h('button', {
                type: 'button',
                className: 'dnb-tac-chip',
                'data-tone': 'accent',
                title: '当前处于托管模式，点击右侧急停可随时刹停',
                onClick: () => patch({ settingsOpen: false }),
              }, h(Icon, { name: 'bolt', size: 11 }), '🤖 托管中')
            : null,
          !effectiveSafetyOn
            ? h('button', {
                type: 'button',
                className: 'dnb-tac-chip',
                'data-tone': 'red',
                onClick: () => patch({ tacticalMenuOpen: !view.tacticalMenuOpen }),
                title: '安全拦截当前已关闭，点开控制面板可一键开启',
              }, h(Icon, { name: 'shieldOff', size: 11 }), '安全拦截已关')
            : null,
          guard.circuitBroken
            ? h('span', {
                className: 'dnb-tac-chip',
                style: { borderColor: 'var(--dnb-coral)', color: 'var(--dnb-coral)', background: 'var(--dnb-coral-soft)' },
                title: guard.circuitReason || '连续出错太多次，已自动停下',
              }, h(Icon, { name: 'alert', size: 11 }), '已停机')
            : null,
          (tm.intervention || isManagedMode)
            ? h('button', {
                type: 'button',
                className: 'dnb-stop-btn',
                title: '马上打断托管与强介入推进，当前任务计划会保留',
                onClick: () => void updateSecConfig({ emergencyStopIntervention: true }),
              }, h(Icon, { name: 'stop', size: 10.5 }), '急停')
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
              h('span', { style: { fontSize: 12.5, fontWeight: 600, color: 'var(--dnb-text)' } }, '权限档位（只对当前对话有效）'),
              h('button', {
                type: 'button',
                className: 'dnb-mini-btn',
                title: '查看每次操作的安全检查记录',
                onClick: () => patch({ secPermMenuOpen: false, auditLogModalOpen: true }),
              }, h(Icon, { name: 'fileText', size: 11 }), `安全记录 (${auditCount})`),
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
                  h('span', { style: { fontSize: 12.5, fontWeight: 600, color: opt.key === 'chief' ? 'var(--dnb-amber)' : 'var(--dnb-text)' } }, opt.title),
                  h(
                    'div',
                    { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } },
                    opt.badgeText
                      ? h('span', { className: 'dnb-perm-badge', 'data-tone': opt.badgeTone }, opt.badgeText)
                      : null,
                    active ? h(Icon, { name: 'check', size: 13, style: { color: opt.key === 'chief' ? 'var(--dnb-amber)' : 'var(--dnb-accent)' } }) : null,
                  ),
                ),
                h('div', { className: 'dnb-perm-subcode', style: opt.key === 'chief' ? { color: 'var(--dnb-amber)' } : undefined }, opt.code),
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
              { className: 'dnb-pipe-bar', title: '每次操作都要经过这 6 道安全检查' },
              h('span', { style: { fontWeight: 600, color: 'var(--dnb-text-2)', marginRight: 2 } }, '检查流程:'),
              ['当前权限', '发起请求', '硬红线检查', '权限检查', '执行操作', '记入日志'].map((step, idx, arr) =>
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
              background: 'var(--dnb-accent-soft)',
              border: '1px solid var(--dnb-border-strong)',
              color: 'var(--dnb-accent)',
            },
            onClick: () => {
              const nextDismissed = { ...(view.dismissedElevationIds || {}) }
              delete nextDismissed[pendingElevationObj.id]
              patch({ dismissedElevationIds: nextDismissed, elevationAgreed: false, elevationChosenMode: pendingElevationObj.targetMode || 'strategist' })
            },
          },
          h('span', { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 5 } },
            h(Icon, { name: 'arrowUp', size: 11.5 }),
            `参谋申请升权限：${CHIEF_PERMISSION_LABELS[pendingElevationObj.fromMode] || pendingElevationObj.fromMode} → ${CHIEF_PERMISSION_LABELS[pendingElevationObj.targetMode] || pendingElevationObj.targetMode}`),
          h('span', { style: { flexShrink: 0, textDecoration: 'underline' } }, '去确认 →'),
        )
      : null,

    pendingApprovalsList.length > 0
      ? h(
          'div',
          {
            className: 'dnb-pending-banner',
            style: {
              background: 'var(--dnb-amber-soft)',
              border: '1px solid var(--dnb-amber)',
              color: 'var(--dnb-amber)',
            },
            onClick: () => {
              const first = pendingApprovalsList[0]
              const nextDismissed = { ...(view.dismissedApprovalIds || {}) }
              if (first && first.id) delete nextDismissed[first.id]
              patch({ dismissedApprovalIds: nextDismissed, openApprovalModalId: (first && first.id) || '' })
            },
          },
          h('span', { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 5 } },
            h(Icon, { name: 'shieldCheck', size: 11.5 }),
            `${pendingApprovalsList[0].operationLabel || '敏感操作'}（还有 ${pendingApprovalsList.length} 项等你确认）`),
          h('span', { style: { flexShrink: 0, textDecoration: 'underline' } }, '点此确认 →'),
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
        title: `${activePermObj.title} — ${activePermObj.footer}（点这里切权限）`,
        onClick: () => patch({ secPermMenuOpen: !view.secPermMenuOpen, tacticalMenuOpen: false, secModelMenuOpen: false, secPaceMenuOpen: false }),
      },
        h('span', {
          style: {
            width: 6,
            height: 6,
            borderRadius: '50%',
            flexShrink: 0,
            background: permMode === 'chief'
              ? 'var(--dnb-amber)'
              : (permMode === 'strategist' ? 'var(--dnb-accent)' : (permMode === 'advisor' ? 'var(--dnb-sage)' : 'var(--dnb-text-3)')),
          },
        }),
        activePermObj.shortLabel,
      ),
      h('button', {
        className: 'dnb-sec-chip',
        'data-active': activeTarget === 'auto' ? '1' : '0',
        title: bi(`发给${chiefDisplayName(view)}处理：它会自动查进度、协调子代理或转达消息`, `Send to ${chiefDisplayName(view)} to check progress, coordinate subagents, or pass messages`),
        onClick: () => patch({ secTarget: 'auto' }),
      }, h(Icon, { name: 'sparkles', size: 10.5 }), `${bi('找', '')}${chiefShortName(view)}`),
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
            ? h('span', { className: 'dnb-spin-ring', style: { '--dnb-spin-size': '7.5px', color: 'var(--dnb-accent)' } })
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
            title: modeObj.hint + '（点这里切换）',
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
        title: '打开控制面板：可一键开关安全拦截、强介入、自动压缩和思考深度',
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
            : '上传图片（可直接拖进来，或按 Ctrl+V 粘贴截图）',
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
        placeholder: view.secBusy ? bi(`${chiefShortName(view)}正在处理…`, `${chiefShortName(view)} is thinking…`) : placeholder,
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
        title: bi(`发给 ${chiefDisplayName(view)}`, `Send to ${chiefDisplayName(view)}`),
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
