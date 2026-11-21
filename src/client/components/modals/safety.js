/**
 * src/client/components/modals/safety.js — 高权限风险签认、工具拦截审批、权限提权与审计日志弹窗
 *
 * 【核心职责】
 *   承载 `ChiefRiskConfirmModal`、`OperationApprovalModal`、`ElevationRequestModal` 与 `AuditLogModal`，
 *   确保任何越权写操作/危险命令必须经由人工签认与明确授权后才放行。
 *
 * 【边界约定】
 *   - 仅处理安全门禁与审计日志 UI 展示与回执提交，实际拦截校验完全由后端锁定内核负责。
 */

import { React, h } from '../../react-runtime.js'
import { CHIEF_PERMISSION_LABELS } from '../../constants.js'
import { bi } from '../../i18n.js'
import { patch } from '../../store.js'
import { updateSecConfig, decideApproval, decideElevation } from '../../api.js'
import { Icon } from '../common.js'

export function ChiefRiskConfirmModal({ view }) {
  if (!view.chiefRiskModalOpen) return null
  const agreed = Boolean(view.chiefRiskAgreed)
  const busy = Boolean(view.chiefRiskBusy)
  return h(
    'div',
    {
      className: 'dnb-modal-backdrop',
      onClick: e => {
        if (e.target === e.currentTarget && !busy) patch({ chiefRiskModalOpen: false, chiefRiskAgreed: false })
      },
    },
    h(
      'div',
      { className: 'dnb-modal-card' },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h('span', { style: { fontSize: 13.5, fontWeight: 700, color: '#f59e0b' } },
          bi('L3 · 参谋长模式：确认风险', 'L3 · Chief Mode: Confirm Risks')),
        h('button', {
          type: 'button',
          className: 'dnb-icon-btn',
          style: { width: 22, height: 22 },
          disabled: busy,
          onClick: () => patch({ chiefRiskModalOpen: false, chiefRiskAgreed: false }),
        }, h(Icon, { name: 'x', size: 13 })),
      ),
      h(
        'div',
        { className: 'dnb-risk-box' },
        h('div', { style: { fontSize: 13.5, fontWeight: 700, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 6 } },
          bi('⚠️ 开启高权限前请确认', '⚠️ Before turning on high permissions')),
        h('div', { style: { fontSize: 12, color: 'var(--dnb-text-2)' } }, bi('开启后，AI 可能会自己做这些事：', 'Once enabled, the AI can do these on its own:')),
        h(
          'ul',
          { style: { margin: '0 0 0 18px', padding: 0, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--dnb-text)' } },
          h('li', null, bi('修改你项目里的文件', 'Edit files in your project')),
          h('li', null, bi('运行终端命令', 'Run system commands')),
          h('li', null, bi('调度主对话和子代理的工作', 'Guide main chat and subagents')),
          h('li', null, bi('做一些删改后难以撤回的操作', 'Make changes that are hard to undo')),
        ),
        h('div', { style: { fontSize: 12, fontWeight: 600, color: 'var(--dnb-text-2)' } },
          bi('就算开了安全规则保护，也不能保证不出意外。', 'Even with safety rules on, some risk remains.')),
      ),
      h(
        'label',
        { className: 'dnb-risk-check' },
        h('input', {
          type: 'checkbox',
          checked: agreed,
          disabled: busy,
          style: { marginTop: 3 },
          onChange: e => patch({ chiefRiskAgreed: Boolean(e.target.checked) }),
        }),
        h('span', null, bi('我已阅读并知悉上述风险，理解高权限模式可能造成的后果。', 'I have read and acknowledge these risks and understand the consequences of high-permission mode.')),
      ),
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
        h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: { height: 32, padding: '0 14px', fontSize: 12.5 },
          disabled: busy,
          onClick: () => patch({ chiefRiskModalOpen: false, chiefRiskAgreed: false }),
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
              const ok = await updateSecConfig({
                permissionMode: 'chief',
                confirmedChiefRisk: true,
              })
              if (ok) patch({ chiefRiskModalOpen: false, chiefRiskAgreed: false })
            } finally {
              patch({ chiefRiskBusy: false })
            }
          },
        }, busy ? bi('正在开启…', 'Enabling…') : bi('确认开启', 'Confirm')),
      ),
      h('div', { style: { fontSize: 10.5, color: 'var(--dnb-text-3)', lineHeight: 1.4 } },
        '切换回低权限或开新对话时，高权限会自动关闭，需要重新确认。'),
    ),
  )
}

export function OperationApprovalModal({ view }) {
  const meta = view.chiefMeta || {}
  const list = (Array.isArray(meta.pendingApprovals) ? meta.pendingApprovals : [])
    .filter(item => item && item.status === 'pending')
  if (!list.length) return null
  const dismissedMap = view.dismissedApprovalIds || {}
  const active = (view.openApprovalModalId && list.find(item => item.id === view.openApprovalModalId))
    || list.find(item => !dismissedMap[item.id])
    || null
  if (!active) return null
  const busy = view.approvalBusyId === active.id
  const idx = list.findIndex(item => item.id === active.id)
  const dismissCurrent = () => {
    if (busy) return
    patch({
      dismissedApprovalIds: { ...dismissedMap, [active.id]: true },
      openApprovalModalId: '',
    })
  }
  return h(
    'div',
    {
      className: 'dnb-modal-backdrop',
      onClick: e => {
        if (e.target === e.currentTarget && !busy) dismissCurrent()
      },
    },
    h(
      'div',
      { className: 'dnb-modal-card' },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h('span', { style: { fontSize: 13.5, fontWeight: 700, color: '#f59e0b' } },
          `L2 · 参谋模式：逐项确认${list.length > 1 ? ` (${idx + 1}/${list.length})` : ''}`),
        h('button', {
          type: 'button',
          className: 'dnb-icon-btn',
          style: { width: 22, height: 22 },
          title: '先不处理（提示会留在底部）',
          disabled: busy,
          onClick: dismissCurrent,
        }, h(Icon, { name: 'x', size: 13 })),
      ),
      h(
        'div',
        { className: 'dnb-op-box' },
        h('div', { style: { fontSize: 13, fontWeight: 700, color: '#d97706', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
          '🛡️ 请你确认这项操作',
          active.kind === 'archive_op'
            ? h('span', { className: 'dnb-tag', style: { fontSize: 10, color: '#fbbf24' } }, '📌 向主对话发资料')
            : (active.kind === 'model_effort'
                ? h('span', { className: 'dnb-tag', style: { fontSize: 10, color: '#a5b4fc' } }, '🧠 调整思考深度')
                : (active.kind === 'auto_continue'
                    ? h('span', { className: 'dnb-tag', style: { fontSize: 10, color: '#38bdf8' } }, '⚡ 断线后继续跑')
                    : null)),
        ),
        h('div', { className: 'dnb-op-kv' },
          h('span', { className: 'dnb-op-k' }, '操作：'),
          h('span', null, active.operationLabel || '需要你批准的操作'),
        ),
        h('div', { className: 'dnb-op-kv' },
          h('span', { className: 'dnb-op-k' }, '目标：'),
          h('span', { className: 'dnb-op-code' }, active.targetLabel || '当前项目'),
        ),
        h('div', { className: 'dnb-op-kv' },
          h('span', { className: 'dnb-op-k' }, '原因：'),
          h('span', null, active.reason || '为了推进当前任务'),
        ),
        h('div', { className: 'dnb-op-kv' },
          h('span', { className: 'dnb-op-k' }, '影响：'),
          h('span', null, active.impact || '只会执行这一次，之后如需继续会再问你'),
        ),
        active.preview
          ? h('pre', {
              style: {
                margin: '2px 0 0',
                padding: '6px 8px',
                borderRadius: 7,
                background: 'var(--dnb-elevated)',
                border: '1px solid var(--dnb-border)',
                fontSize: 10.5,
                maxHeight: 90,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                color: 'var(--dnb-text-2)',
              },
            }, String(active.preview).slice(0, 420))
          : null,
      ),
      h(
        'div',
        { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 2 } },
        h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: { height: 34, justifyContent: 'center', fontSize: 12.5, fontWeight: 600 },
          disabled: busy,
          onClick: () => void decideApproval(active.id, 'reject'),
        }, '拒绝'),
        h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: {
            height: 34,
            justifyContent: 'center',
            fontSize: 12.5,
            fontWeight: 700,
            borderColor: 'rgba(16, 185, 129, 0.52)',
            background: 'rgba(16, 185, 129, 0.14)',
            color: '#10b981',
          },
          disabled: busy,
          onClick: () => void decideApproval(active.id, 'approve'),
        }, busy ? '执行中…' : '允许本次操作'),
      ),
    ),
  )
}

export function ElevationRequestModal({ view }) {
  const meta = view.chiefMeta || {}
  const req = meta.pendingElevation
  if (!req || req.status !== 'pending') return null
  const dismissedMap = view.dismissedElevationIds || {}
  if (dismissedMap[req.id]) return null
  const busy = Boolean(view.elevationBusy)
  const chosenMode = ['assistant', 'strategist', 'chief'].includes(view.elevationChosenMode)
    ? view.elevationChosenMode
    : (req.targetMode || 'strategist')
  const needsRiskCheck = chosenMode === 'chief'
  const agreed = Boolean(view.elevationAgreed)
  const dismissSelf = () => {
    if (busy) return
    patch({ dismissedElevationIds: { ...dismissedMap, [req.id]: true } })
  }
  return h(
    'div',
    {
      className: 'dnb-modal-backdrop',
      onClick: e => {
        if (e.target === e.currentTarget && !busy) dismissSelf()
      },
    },
    h(
      'div',
      { className: 'dnb-modal-card' },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h('span', { style: { fontSize: 13.5, fontWeight: 700, color: '#60a5fa' } }, '⬆️ 参谋长申请更高权限'),
        h('button', {
          type: 'button',
          className: 'dnb-icon-btn',
          style: { width: 22, height: 22 },
          disabled: busy,
          onClick: dismissSelf,
        }, h(Icon, { name: 'x', size: 13 })),
      ),
      h(
        'div',
        { className: 'dnb-op-box' },
        h('div', { className: 'dnb-op-kv' },
          h('span', { className: 'dnb-op-k' }, '权限变化：'),
          h('span', null, `${CHIEF_PERMISSION_LABELS[req.fromMode] || req.fromMode} → 申请 ${CHIEF_PERMISSION_LABELS[req.targetMode] || req.targetMode}`),
        ),
        h('div', { className: 'dnb-op-kv' },
          h('span', { className: 'dnb-op-k' }, '谁发起的：'),
          h('span', { className: 'dnb-op-code' }, req.by || 'chief'),
        ),
        h('div', { className: 'dnb-op-kv' },
          h('span', { className: 'dnb-op-k' }, '原因：'),
          h('span', null, req.reason || '当前任务需要更多权限才能继续'),
        ),
        req.requestedActionSummary
          ? h('div', { className: 'dnb-op-kv' },
              h('span', { className: 'dnb-op-k' }, '准备做什么：'),
              h('span', null, req.requestedActionSummary),
            )
          : null,
      ),
      h(
        'div',
        { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
        (req.targetMode === 'chief'
          ? ['strategist', 'chief']
          : ['assistant', 'strategist']
        ).map(modeKey => {
          const selected = chosenMode === modeKey
          return h('button', {
            key: modeKey,
            type: 'button',
            className: 'dnb-mini-btn',
            'data-tone': selected ? (modeKey === 'chief' ? 'amber' : 'accent') : undefined,
            disabled: busy,
            onClick: () => patch({ elevationChosenMode: modeKey, elevationAgreed: false }),
          }, modeKey === 'strategist' ? '🛡️ 更稳妥：只开到 L2 · 参谋模式（每步问你）' : (CHIEF_PERMISSION_LABELS[modeKey] || modeKey))
        }),
      ),
      needsRiskCheck
        ? h(
            React.Fragment,
            null,
            h(
              'div',
              { className: 'dnb-risk-box' },
              h('div', { style: { fontSize: 13, fontWeight: 700, color: '#f59e0b' } }, '⚠️ 升级到 L3 高权限的风险'),
              h('div', { style: { fontSize: 11.5, color: 'var(--dnb-text-2)' } },
                '进入 L3 · 参谋长模式后，AI 可以直接改项目文件、跑命令，也能调度其他助手。就算有安全规则保护，也不能保证不出意外。'),
            ),
            h(
              'label',
              { className: 'dnb-risk-check' },
              h('input', {
                type: 'checkbox',
                checked: agreed,
                disabled: busy,
                style: { marginTop: 3 },
                onChange: e => patch({ elevationAgreed: Boolean(e.target.checked) }),
              }),
              h('span', null, '我已阅读并知悉上述风险，理解高权限模式可能造成的后果。'),
            ),
          )
        : null,
      h(
        'div',
        { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 2 } },
        h('button', {
          type: 'button',
          className: 'dnb-pill',
          style: { height: 32, padding: '0 14px', fontSize: 12.5 },
          disabled: busy,
          onClick: () => void decideElevation(req.id, 'reject'),
        }, '不批准'),
        h('button', {
          type: 'button',
          className: 'dnb-primary-btn',
          style: {
            height: 32,
            padding: '0 15px',
            fontSize: 12.5,
            fontWeight: 700,
            background: needsRiskCheck ? (agreed ? '#d97706' : 'var(--dnb-fill)') : 'var(--dnb-primary-bg, #2563eb)',
            color: needsRiskCheck ? (agreed ? '#fff' : 'var(--dnb-text-3)') : 'var(--dnb-primary-fg, #fff)',
          },
          disabled: busy || (needsRiskCheck && !agreed),
          onClick: () => void decideElevation(req.id, 'approve', chosenMode, needsRiskCheck ? agreed : false),
        }, busy ? '正在开启…' : `同意进入 ${CHIEF_PERMISSION_LABELS[chosenMode] || chosenMode}`),
      ),
    ),
  )
}

export function AuditLogModal({ view }) {
  if (!view.auditLogModalOpen) return null
  const meta = view.chiefMeta || {}
  const logs = Array.isArray(meta.auditLog) ? meta.auditLog : []
  return h(
    'div',
    {
      className: 'dnb-modal-backdrop',
      onClick: e => {
        if (e.target === e.currentTarget) patch({ auditLogModalOpen: false })
      },
    },
    h(
      'div',
      { className: 'dnb-modal-card' },
      h(
        'div',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h('span', { style: { fontSize: 13.5, fontWeight: 700, color: 'var(--dnb-text)' } },
          bi('📜 安全检查流程与操作记录', '📜 Security Flow & Action Log')),
        h('button', {
          type: 'button',
          className: 'dnb-icon-btn',
          style: { width: 22, height: 22 },
          onClick: () => patch({ auditLogModalOpen: false }),
        }, h(Icon, { name: 'x', size: 13 })),
      ),
      h(
        'div',
        { className: 'dnb-pipe-bar' },
        [
          bi('权限等级', 'Level'),
          bi('申请操作', 'Request'),
          bi('硬性红线检查', 'Guard Rules'),
          bi('权限检查', 'Permission'),
          bi('实际执行', 'Run'),
          bi('记录留存', 'Log'),
        ].map((step, idx, arr) =>
          h(
            React.Fragment,
            { key: step },
            h('span', { className: 'dnb-pipe-node' }, step),
            idx < arr.length - 1 ? h('span', null, '→') : null,
          ),
        ),
      ),
      logs.length === 0
        ? h('div', { style: { padding: '18px 8px', textAlign: 'center', fontSize: 12, color: 'var(--dnb-text-3)' } },
            bi('目前还没有操作记录。以后切换权限、拦截违规操作或你点同意时，都会记在这里。', 'No records yet. Permission changes, blocked actions, and your approvals will appear here.'))
        : h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 340, overflowY: 'auto' } },
            logs.map(entry => {
              const dec = String(entry.decision || '').toLowerCase()
              const isGreen = ['allow', 'approved', 'approved_by_user', 'executed', 'executed_approved', 'elevation_approved', 'mode_changed', 'reset_to_l0'].includes(dec)
              const isBlue = ['prompt', 'pending_approval', 'elevation_requested', 'pending'].includes(dec)
              const decisionColor = isGreen ? '#34d399' : (isBlue ? '#60a5fa' : '#ff6961')
              const ruleTag = entry.rule ? ` [${entry.rule}]` : ''
              const durTag = entry.durationMs > 0 ? `${entry.durationMs}ms · ` : ''
              const detailText = entry.summary || entry.reason || entry.outcome || ''
              return h(
                'div',
                { key: entry.id, className: 'dnb-audit-row' },
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 } },
                  h('span', { style: { fontWeight: 700, color: decisionColor } },
                    `${entry.stage || 'gate'} · ${entry.decision || ''}${ruleTag} (${CHIEF_PERMISSION_LABELS[entry.mode] || entry.mode || 'advisor'})`),
                  h('span', { style: { fontSize: 10, color: 'var(--dnb-text-3)' } },
                    `${durTag}${entry.at ? new Date(entry.at).toLocaleTimeString() : ''}`),
                ),
                h('div', { style: { color: 'var(--dnb-text)' } },
                  `${entry.operation || ''}${entry.target ? ' · ' + entry.target : ''}`),
                detailText
                  ? h('div', { style: { color: 'var(--dnb-text-2)', wordBreak: 'break-word' } }, detailText)
                  : null,
              )
            }),
          ),
    ),
  )
}
