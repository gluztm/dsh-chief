/**
 * src/client/components/modals/workflow.js — 档案接力、全局蒸馏、参谋建议、沉淀与交接协同弹窗
 *
 * 【核心职责】
 *   承载 `ArchiveRelayModal`、`DistillToGlobalModal`、`ChiefAdviceModal`、`HazardHaltModal`、
 *   `PrecipitateConfirmModal`、`PeerLinkConfirmModal` 与 `HandoffWarnModal`。
 *
 * 【边界约定】
 *   - 聚焦跨会话协同、档案流转与长程交接类业务流弹窗。
 */

import { React, h } from '../../react-runtime.js'
import { patch, focusSecInput } from '../../store.js'
import { clampTitle, shortSession, shortAgentName } from '../../utils.js'
import {
  loadChiefView,
  updateSecConfig,
  togglePeerSessionLink,
  decideSuggestion,
  prefillSuggestion,
  submitChiefBar,
  precipitateArchivesApi,
  relayArchivesWithChiefApi,
  distillToGlobalApi,
  transfer,
} from '../../api.js'
import { Icon } from '../common.js'

export function ArchiveRelayModal({ view }) {
  const m = view.archiveRelayModal
  if (!m) return null
  const items = Array.isArray(m.items) ? m.items : []
  const peers = (view.secView && Array.isArray(view.secView.peers)) ? view.secView.peers : []
  const busy = Boolean(view.relayArchivesBusy)
  const scopeBadgeText = s => (s === 'global' ? '全局' : (s === 'precipitated' ? '沉淀' : '本局'))
  return h(
    'div',
    {
      className: 'dnb-modal-backdrop',
      onClick: e => {
        if (e.target === e.currentTarget && !busy) patch({ archiveRelayModal: null })
      },
    },
    h(
      'div',
      { className: 'dnb-modal-card' },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h('span', { style: { fontSize: 13.5, fontWeight: 700, color: 'var(--dnb-accent)' } },
          `📨 带上资料发给对话（已选 ${items.length} 份）`),
        h('button', {
          type: 'button',
          className: 'dnb-icon-btn',
          style: { width: 24, height: 24 },
          disabled: busy,
          onClick: () => patch({ archiveRelayModal: null }),
        }, h(Icon, { name: 'x', size: 13 })),
      ),
      h(
        'div',
        { style: { display: 'flex', flexWrap: 'wrap', gap: 5, maxHeight: 108, overflowY: 'auto' } },
        items.map((it, idx) =>
          h(
            'span',
            {
              key: (it.vaultScope || 'session') + ':' + (it.id || idx),
              className: 'dnb-tag',
              style: { fontSize: 11, padding: '2px 8px', background: 'var(--dnb-card)', border: '1px solid var(--dnb-border)' },
            },
            `[${scopeBadgeText(it.vaultScope)}] ${clampTitle(it.title || it.id, 22)}`,
          ),
        ),
      ),
      h(
        'div',
        { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } },
        h('span', { style: { fontSize: 11.5, color: 'var(--dnb-text-3)' } }, '发给谁：'),
        h('select', {
          value: m.target || 'lead',
          disabled: busy,
          style: {
            height: 28,
            borderRadius: 7,
            border: '1px solid var(--dnb-border-strong)',
            background: 'var(--dnb-card)',
            color: 'var(--dnb-text)',
            fontSize: 11.5,
            padding: '0 8px',
            flex: 1,
            minWidth: 120,
          },
          onChange: e => patch({ archiveRelayModal: { ...m, target: e.target.value } }),
        },
          h('option', { value: 'lead' }, '@主对话 (lead)'),
          peers.filter(p => p && p.key && p.key !== 'lead').map(p =>
            h('option', { key: p.key, value: p.key }, '@' + shortAgentName(p.name || p.key, true)),
          ),
        ),
        h('select', {
          value: m.mode || 'followup',
          disabled: busy,
          style: {
            height: 28,
            borderRadius: 7,
            border: '1px solid var(--dnb-border-strong)',
            background: 'var(--dnb-card)',
            color: 'var(--dnb-text)',
            fontSize: 11.5,
            padding: '0 8px',
          },
          onChange: e => patch({ archiveRelayModal: { ...m, mode: e.target.value } }),
        },
          h('option', { value: 'followup' }, '排队发送'),
          h('option', { value: 'steer' }, '立刻插话'),
        ),
      ),
      h('textarea', {
        className: 'dnb-textarea',
        rows: 3,
        disabled: busy,
        style: { fontSize: 12, minHeight: 74, resize: 'vertical' },
        placeholder: '写一句附带要求，参谋长会连同资料一起发过去（比如：改代码时别动现有测试）…',
        value: m.instruction || '',
        onChange: e => patch({ archiveRelayModal: { ...m, instruction: e.target.value } }),
      }),
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 2 } },
        h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: { height: 32, padding: '0 14px', fontSize: 12.5 },
          disabled: busy,
          onClick: () => patch({ archiveRelayModal: null }),
        }, '取消'),
        h('button', {
          type: 'button',
          className: 'dnb-primary-btn',
          style: { height: 32, padding: '0 15px', fontSize: 12.5, fontWeight: 700 },
          disabled: busy || items.length === 0,
          onClick: () => void relayArchivesWithChiefApi(m),
        }, busy ? '正在发送…' : `📨 发给 @${m.target === 'lead' || !m.target ? '主对话' : shortAgentName(m.target, true)}`),
      ),
    ),
  )
}

export function DistillToGlobalModal({ view }) {
  const m = view.distillGlobalModal
  if (!m) return null
  const busy = Boolean(view.distillBusy)
  const countLabel = Array.isArray(m.ids) && m.ids.length > 0
    ? `选中的 ${m.ids.length} 份档案`
    : '当前对话里值得长期留存的经验'
  return h(
    'div',
    {
      className: 'dnb-modal-backdrop',
      onClick: e => {
        if (e.target === e.currentTarget && !busy) patch({ distillGlobalModal: null })
      },
    },
    h(
      'div',
      { className: 'dnb-modal-card' },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h('span', { style: { fontSize: 13.5, fontWeight: 700, color: 'var(--dnb-accent)' } }, '✦ 把经验存到全局档案库'),
        h('button', {
          type: 'button',
          className: 'dnb-icon-btn',
          style: { width: 24, height: 24 },
          disabled: busy,
          onClick: () => patch({ distillGlobalModal: null }),
        }, h(Icon, { name: 'x', size: 13 })),
      ),
      h(
        'div',
        { style: { fontSize: 12, color: 'var(--dnb-text-2)', lineHeight: 1.5 } },
        `参谋长会从「${countLabel}」里挑出以后还能用的经验，存到「🌐 全局档案柜」。一次性的过程记录会自动过滤，原档案默认保留。`,
      ),
      h('textarea', {
        className: 'dnb-textarea',
        rows: 2,
        disabled: busy,
        style: { fontSize: 12, minHeight: 56, resize: 'vertical' },
        placeholder: '可选：告诉参谋长重点留哪些内容（比如：打包命令或踩坑记录）…',
        value: m.instruction || '',
        onChange: e => patch({ distillGlobalModal: { ...m, instruction: e.target.value } }),
      }),
      h(
        'label',
        { style: { display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 11.5, color: 'var(--dnb-text)', cursor: 'pointer', lineHeight: 1.45 } },
        h('input', {
          type: 'checkbox',
          checked: Boolean(m.clearSource),
          disabled: busy,
          style: { marginTop: 2 },
          onChange: e => patch({ distillGlobalModal: { ...m, clearSource: Boolean(e.target.checked) } }),
        }),
        '保存成功后，顺便删掉当前对话里的原档案（默认保留）',
      ),
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 2 } },
        h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: { height: 32, padding: '0 14px', fontSize: 12.5 },
          disabled: busy,
          onClick: () => patch({ distillGlobalModal: null }),
        }, '取消'),
        h('button', {
          type: 'button',
          className: 'dnb-primary-btn',
          style: { height: 32, padding: '0 15px', fontSize: 12.5, fontWeight: 700 },
          disabled: busy,
          onClick: () => void distillToGlobalApi(m),
        }, busy ? '正在整理保存…' : '✦ 存到全局档案'),
      ),
    ),
  )
}

export function ChiefAdviceModal({ view }) {
  const m = view.chiefAdviceModal
  if (!m) return null
  const busy = Boolean(view.secBusy)
  const draft = String(m.draftText || m.title || '').trim()
  return h(
    'div',
    {
      className: 'dnb-modal-backdrop',
      onClick: e => {
        if (e.target === e.currentTarget && !busy) patch({ chiefAdviceModal: null })
      },
    },
    h(
      'div',
      { className: 'dnb-modal-card' },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h('span', { style: { fontSize: 13.5, fontWeight: 700, color: 'var(--dnb-accent)' } }, '💡 参谋长给你的建议'),
        h('button', {
          type: 'button',
          className: 'dnb-icon-btn',
          style: { width: 24, height: 24 },
          disabled: busy,
          onClick: () => patch({ chiefAdviceModal: null }),
        }, h(Icon, { name: 'x', size: 13 })),
      ),
      h(
        'div',
        { style: { fontSize: 13, fontWeight: 600, color: 'var(--dnb-text)', lineHeight: 1.5 } },
        m.title || '参谋长有一条新建议',
      ),
      m.reason
        ? h('div', { style: { fontSize: 12, color: 'var(--dnb-text-2)', lineHeight: 1.5 } }, m.reason)
        : null,
      m.draftText && m.draftText !== m.title
        ? h(
            'div',
            {
              style: {
                padding: '8px 10px',
                borderRadius: 9,
                border: '1px solid var(--dnb-border)',
                background: 'var(--dnb-card)',
                fontSize: 12,
                color: 'var(--dnb-text-2)',
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
              },
            },
            m.draftText,
          )
        : null,
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'flex-end', gap: 7, flexWrap: 'wrap', marginTop: 2 } },
        h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: { height: 32, padding: '0 12px', fontSize: 12 },
          disabled: busy,
          onClick: () => patch({ chiefAdviceModal: null }),
        }, '稍后再看'),
        !m.isSynthetic && m.id
          ? h('button', {
              type: 'button',
              className: 'dnb-pill',
              style: { height: 32, padding: '0 12px', fontSize: 12, color: 'var(--dnb-text-3)' },
              disabled: busy,
              onClick: async () => {
                await decideSuggestion(m, 'dismiss')
                patch({ chiefAdviceModal: null })
              },
            }, '忽略这条')
          : null,
        draft
          ? h('button', {
              type: 'button',
              className: 'dnb-pill',
              style: { height: 32, padding: '0 12px', fontSize: 12 },
              disabled: busy,
              onClick: () => {
                prefillSuggestion({ ...m, draftText: draft, target: m.target || 'auto' })
                patch({ chiefAdviceModal: null })
                focusSecInput()
              },
            }, '放到输入框改改')
          : null,
        h('button', {
          type: 'button',
          className: 'dnb-primary-btn',
          style: { height: 32, padding: '0 15px', fontSize: 12.5, fontWeight: 700 },
          disabled: busy,
          onClick: async () => {
            if (m.isSynthetic || !m.id) {
              patch({ chiefAdviceModal: null })
              await submitChiefBar('请采纳此参谋建议并递交主对话推进：' + draft)
            } else {
              await decideSuggestion(m, 'approve')
              patch({ chiefAdviceModal: null })
            }
          },
        }, busy ? '正在发送…' : '📨 采纳并告诉主对话'),
      ),
    ),
  )
}

export function HazardHaltModal({ view }) {
  const m = view.hazardHaltModal
  const [ackBusy, setAckBusy] = React.useState(false)
  if (!m) return null
  const isBoundHit = m.category === 'boundary_collision'
  const dismissAndAck = async (goTab) => {
    if (ackBusy) return
    setAckBusy(true)
    const alertId = m.id
    patch({
      hazardHaltModal: null,
      ...(goTab ? { tab: goTab, settingsOpen: false } : {}),
    })
    try {
      if (alertId) {
        await updateSecConfig({ ackHazardAlertId: alertId })
      }
    } finally {
      setAckBusy(false)
    }
  }
  return h(
    'div',
    {
      className: 'dnb-modal-backdrop',
      onClick: e => {
        if (e.target === e.currentTarget && !ackBusy) void dismissAndAck('')
      },
    },
    h(
      'div',
      {
        className: 'dnb-modal-card',
        style: { borderColor: 'rgba(255, 69, 58, 0.65)', boxShadow: '0 14px 40px rgba(255, 69, 58, 0.22)' },
      },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h(
          'span',
          { style: { fontSize: 13.5, fontWeight: 700, color: '#ff6961' } },
          isBoundHit ? '🚫 踩到红线，强介入已自动停下' : '🚨 检测到高风险，强介入已自动停下',
        ),
        h('button', {
          type: 'button',
          className: 'dnb-icon-btn',
          style: { width: 22, height: 22 },
          disabled: ackBusy,
          onClick: () => void dismissAndAck(''),
        }, h(Icon, { name: 'x', size: 13 })),
      ),
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
        h(
          'span',
          {
            className: 'dnb-tag',
            style: {
              background: 'rgba(255, 69, 58, 0.16)',
              color: '#ff6961',
              border: '1px solid rgba(255, 69, 58, 0.35)',
              fontWeight: 700,
            },
          },
          isBoundHit ? '即将触犯边界' : '可能有不可逆风险',
        ),
        m.title
          ? h('span', { style: { fontSize: 12.5, fontWeight: 700, color: 'var(--dnb-text)' } }, m.title)
          : null,
      ),
      h(
        'div',
        {
          style: {
            padding: '9px 11px',
            borderRadius: 9,
            border: '1px solid rgba(255, 69, 58, 0.36)',
            background: 'rgba(255, 69, 58, 0.08)',
            fontSize: 12,
            color: 'var(--dnb-text)',
            lineHeight: 1.55,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          },
        },
        m.reason || '继续操作可能会改坏东西或触犯红线，参谋长已经停了下来。',
      ),
      m.objective
        ? h(
            'div',
            { style: { fontSize: 11, color: 'var(--dnb-text-3)', lineHeight: 1.4 } },
            '暂停前的目标：',
            m.objective,
          )
        : null,
      h(
        'div',
        { style: { fontSize: 11.5, color: 'var(--dnb-text-2)', lineHeight: 1.45 } },
        '已经帮你关掉「⚡ 强介入」和自动续跑，避免继续操作出错。请先检查一下情况，确认没问题后再决定要不要重启。',
      ),
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'flex-end', gap: 7, flexWrap: 'wrap', marginTop: 2 } },
        h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: { height: 32, padding: '0 12px', fontSize: 12 },
          disabled: ackBusy,
          onClick: () => void dismissAndAck('boundaries'),
        }, '查看边界规则'),
        h('button', {
          type: 'button',
          className: 'dnb-primary-btn',
          style: { height: 32, padding: '0 16px', fontSize: 12.5, fontWeight: 700, background: '#ff453a', color: '#fff' },
          disabled: ackBusy,
          onClick: () => void dismissAndAck(''),
        }, ackBusy ? '确认中…' : '我知道了'),
      ),
    ),
  )
}

export function PrecipitateConfirmModal({ view }) {
  const m = view.precipitateModal
  if (!m) return null
  return h(
    'div',
    {
      className: 'dnb-modal-backdrop',
      onClick: e => {
        if (e.target === e.currentTarget && !view.archivePrecipitating) patch({ precipitateModal: null })
      },
    },
    h(
      'div',
      { className: 'dnb-modal-card' },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h('span', { style: { fontSize: 13.5, fontWeight: 700, color: 'var(--dnb-accent)' } }, '⏬ 把常用经验存到长期冷库'),
        h('button', {
          type: 'button',
          className: 'dnb-icon-btn',
          style: { width: 22, height: 22 },
          disabled: Boolean(view.archivePrecipitating),
          onClick: () => patch({ precipitateModal: null }),
        }, h(Icon, { name: 'x', size: 13 })),
      ),
      h(
        'div',
        { style: { fontSize: 12, color: 'var(--dnb-text-2)', lineHeight: 1.5 } },
        `会把「${m.label || '当前档案'}」里值得复用的经验提炼出来，存进项目长期冷库。冷库里的内容平时 `,
        h('strong', { style: { color: 'var(--dnb-text)' } }, '占 0 Token'),
        '，只有你点「翻出」时才会发给当前对话。',
      ),
      h(
        'label',
        { style: { display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 11.5, color: 'var(--dnb-text)', cursor: 'pointer', lineHeight: 1.45 } },
        h('input', {
          type: 'checkbox',
          checked: Boolean(m.clearSource),
          disabled: Boolean(view.archivePrecipitating),
          style: { marginTop: 2 },
          onChange: e => patch({ precipitateModal: { ...m, clearSource: Boolean(e.target.checked) } }),
        }),
        '存进冷库后，顺便删掉原来的零散记录',
      ),
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'flex-end', gap: 7 } },
        h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: { height: 28, padding: '0 12px', fontSize: 12 },
          disabled: Boolean(view.archivePrecipitating),
          onClick: () => patch({ precipitateModal: null }),
        }, '取消'),
        h('button', {
          type: 'button',
          className: 'dnb-primary-btn',
          style: { height: 28, padding: '0 14px', fontSize: 12, fontWeight: 600 },
          disabled: Boolean(view.archivePrecipitating),
          onClick: () => void precipitateArchivesApi({
            op: m.op || 'cabinet',
            vaultScope: m.vaultScope || 'global',
            cabinetId: '',
            folder: m.folder || '',
            ...(Array.isArray(m.ids) && m.ids.length > 0 ? { ids: m.ids } : {}),
            clearSource: Boolean(m.clearSource),
          }),
        }, view.archivePrecipitating ? '正在整理保存…' : '开始保存'),
      ),
    ),
  )
}

export function PeerLinkConfirmModal({ view }) {
  const m = view.peerLinkConfirmModal
  if (!m) return null
  return h(
    'div',
    {
      className: 'dnb-modal-backdrop',
      onClick: e => {
        if (e.target === e.currentTarget) patch({ peerLinkConfirmModal: null })
      },
    },
    h(
      'div',
      { className: 'dnb-modal-card' },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h('span', { style: { fontSize: 13.5, fontWeight: 700, color: '#f59e0b' } }, '⚠️ 确认连接另一个对话窗口'),
        h('button', {
          type: 'button',
          className: 'dnb-icon-btn',
          style: { width: 22, height: 22 },
          onClick: () => patch({ peerLinkConfirmModal: null }),
        }, h(Icon, { name: 'x', size: 13 })),
      ),
      h(
        'div',
        {
          style: {
            borderRadius: 9,
            padding: '8px 10px',
            border: '1px solid var(--dnb-border)',
            background: 'var(--dnb-card)',
            fontSize: 11.5,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          },
        },
        h('div', null, h('strong', null, '要连接的窗口：'), m.peerTitle || shortSession(m.peerId)),
        m.peerObjective
          ? h('div', { style: { color: 'var(--dnb-text-2)' } }, h('strong', null, '对方的目标：'), m.peerObjective)
          : null,
      ),
      h(
        'div',
        { className: 'dnb-disclaimer-box' },
        '连上之后，两个窗口会共享进度和消息。\n',
        h('strong', null, '如果它们做的不是同一件事，连在一起会把两边的资料和摘要弄混。'),
        '\n请确认这两个对话有关联再连接。以后随时断开，资料也会立刻分开。',
      ),
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'flex-end', gap: 7 } },
        h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: { height: 28, padding: '0 12px', fontSize: 12 },
          onClick: () => patch({ peerLinkConfirmModal: null }),
        }, '先不连接'),
        h('button', {
          type: 'button',
          className: 'dnb-primary-btn',
          style: { height: 28, padding: '0 14px', fontSize: 12, background: '#f59e0b', color: '#111', fontWeight: 700 },
          onClick: async () => {
            const pid = m.peerId
            patch({ peerLinkConfirmModal: null })
            await togglePeerSessionLink(pid, true)
          },
        }, '确认相关并连接'),
      ),
    ),
  )
}

export function HandoffWarnModal({ view }) {
  const m = view.handoffWarnModal
  if (!m) return null
  return h(
    'div',
    {
      className: 'dnb-modal-backdrop',
      onClick: e => {
        if (e.target === e.currentTarget && !view.secRegenerating) patch({ handoffWarnModal: null })
      },
    },
    h(
      'div',
      { className: 'dnb-modal-card' },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h('span', { style: { fontSize: 13.5, fontWeight: 700, color: '#f59e0b' } }, '⚠️ 交接单还没更新到最新进度'),
        h('button', {
          type: 'button',
          className: 'dnb-icon-btn',
          style: { width: 22, height: 22 },
          disabled: Boolean(view.secRegenerating),
          onClick: () => patch({ handoffWarnModal: null }),
        }, h(Icon, { name: 'x', size: 13 })),
      ),
      h(
        'div',
        { className: 'dnb-disclaimer-box' },
        m.reason || '交接单是给新对话看的前情提要。现在还没写最新进展，直接交接会让新对话接不上，建议先更新一下再交接。',
      ),
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'flex-end', gap: 6, flexWrap: 'wrap' } },
        h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: { height: 28, padding: '0 10px', fontSize: 11.5 },
          disabled: Boolean(view.secRegenerating),
          onClick: () => {
            patch({ handoffWarnModal: null, handoffEditing: true, handoffDraft: view.handoffText || '' })
          },
        }, '自己去改'),
        h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: { height: 28, padding: '0 10px', fontSize: 11.5 },
          disabled: Boolean(view.secRegenerating),
          onClick: () => {
            patch({ handoffWarnModal: null })
            void transfer(m.target, m.opts)
          },
        }, '直接交接'),
        h('button', {
          type: 'button',
          className: 'dnb-primary-btn',
          style: { height: 28, padding: '0 12px', fontSize: 11.5, fontWeight: 700 },
          disabled: Boolean(view.secRegenerating),
          onClick: async () => {
            await loadChiefView(true, { syncHandoff: true })
            patch({ handoffWarnModal: null })
            await transfer(m.target, m.opts)
          },
        }, view.secRegenerating ? '正在更新交接单…' : '✦ 更新交接单并交接'),
      ),
    ),
  )
}

