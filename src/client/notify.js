/**
 * src/client/notify.js
 *
 * Key-milestone desktop Notification & optional WebAudio gentle chime engine
 * with per-session baseline suppression so initial loads never replay old alerts.
 */

import { store, patch, runtimeRefs } from './store.js'
import { bi, formatBi } from './i18n.js'

const ALERT_RECENT_WINDOW_MS = 120_000

/** Play a brief, soft 2-note WebAudio chime when audible cues are enabled. */
export function playGentleChime(level = 'info') {
  try {
    if (typeof window === 'undefined') return false
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (typeof AudioCtx !== 'function') return false
    const ctx = new AudioCtx()
    if (!ctx || typeof ctx.createOscillator !== 'function' || typeof ctx.createGain !== 'function') {
      return false
    }
    const now = Number(ctx.currentTime) || 0
    const notes = (level === 'danger' || level === 'warn') ? [440, 349.23] : [587.33, 880]
    const oscType = (level === 'danger' || level === 'warn') ? 'triangle' : 'sine'
    notes.forEach((freq, idx) => {
      const t0 = now + idx * 0.11
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = oscType
      osc.frequency.setValueAtTime(freq, t0)
      gain.gain.setValueAtTime(0.0001, t0)
      gain.gain.exponentialRampToValueAtTime(0.055, t0 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(t0)
      osc.stop(t0 + 0.17)
    })
    if (typeof setTimeout === 'function' && typeof ctx.close === 'function') {
      const tid = setTimeout(() => {
        try { ctx.close().catch(() => {}) } catch {}
      }, 450)
      if (tid && typeof tid.unref === 'function') tid.unref()
    }
    return true
  } catch {
    return false
  }
}

export function getNotificationPermissionState() {
  try {
    if (typeof window !== 'undefined' && typeof window.Notification === 'function') {
      return window.Notification.permission || 'default'
    }
    if (typeof Notification === 'function') {
      return Notification.permission || 'default'
    }
  } catch {}
  return 'unsupported'
}

export async function requestNotificationPermission() {
  try {
    const N = (typeof window !== 'undefined' && typeof window.Notification === 'function')
      ? window.Notification
      : (typeof Notification === 'function' ? Notification : null)
    if (!N || typeof N.requestPermission !== 'function') return 'unsupported'
    if (N.permission === 'granted' || N.permission === 'denied') return N.permission
    const res = await N.requestPermission()
    return res || N.permission || 'default'
  } catch {
    return 'unsupported'
  }
}

function localizedAlertCopy(ev) {
  if (!ev || typeof ev !== 'object') {
    return { title: bi('DSH 参谋长提醒', 'DSH Chief Alert'), body: '' }
  }
  const body = String(ev.body || '').trim()
  switch (ev.kind) {
    case 'pending_approval':
      return {
        title: bi('🔐 等待人类逐项审批', '🔐 Approval Required'),
        body: body || bi('参谋请求审批关键工作区或工作流操作。', 'A strategist action is waiting for your sign-off.'),
      }
    case 'pending_elevation':
      return {
        title: bi('⬆️ 参谋申请提升权限', '⬆️ Elevation Requested'),
        body: body || bi('当前任务需要更高参谋权限才能继续执行。', 'Chief requests higher permission tier to continue.'),
      }
    case 'guard_wall_blocked':
      return {
        title: bi('🧱 物理驻墙已拦截越界调用', '🧱 Guard Wall Blocked Call'),
        body: body || bi('已触发事前物理驻墙拦截，等待人工处置。', 'Pre-execute guard wall intercepted a risky call.'),
      }
    case 'auto_continue_rescue':
      return {
        title: bi('🔄 断流救活已触发续跑', '🔄 Stream Rescue Triggered'),
        body: body || bi('检测到主会话意外中断，已尝试自动唤醒续跑。', 'Interrupted turn detected; auto-continue fired.'),
      }
    case 'managed_auto_sleep':
      return {
        title: bi('🌙 托管已自动休眠收工', '🌙 Managed Auto-Sleep'),
        body: body || bi('在途待办与问询均已清零，已切回「⏸ 关停」以节省 Token。', 'All work cleared; returned to ⏸ Off to save tokens.'),
      }
    case 'budget_circuit_break':
      return {
        title: bi('🛑 托管已触及硬预算上限熔断', '🛑 Hard Budget Breaker Tripped'),
        body: body || bi('托管后台调用/Token 达到上限，已自动切回「⏸ 关停」。', 'Managed budget limit reached; auto-stopped.'),
      }
    case 'hazard_halt':
      return {
        title: bi('🚨 强介入紧急安全煞停', '🚨 Emergency Hazard Halt'),
        body: body || bi('检测到重大不可逆风险或必然撞墙，已暂停推进。', 'High irreversible hazard detected; execution halted.'),
      }
    default:
      return {
        title: String(ev.title || bi('DSH 参谋长提醒', 'DSH Chief Alert')),
        body,
      }
  }
}

/** Dispatch a desktop notification (if granted) and optional chime for one milestone event. */
export function fireChiefAlertNotification(ev, { sound = false } = {}) {
  const { title, body } = localizedAlertCopy(ev)
  let notifiedDesktop = false
  try {
    const N = (typeof window !== 'undefined' && typeof window.Notification === 'function')
      ? window.Notification
      : (typeof Notification === 'function' ? Notification : null)
    if (N && N.permission === 'granted') {
      new N(title, {
        body,
        tag: ev && ev.id ? 'dsh-chief-' + ev.id : 'dsh-chief-alert',
      })
      notifiedDesktop = true
    }
  } catch {}
  let playedSound = false
  if (sound) {
    playedSound = playGentleChime(ev && ev.level ? ev.level : 'info')
  }
  const toast = body ? `${title}：${body}` : title
  return { title, body, toast, notifiedDesktop, playedSound }
}

/**
 * Incrementally process incoming backend alert events for a session.
 * The first batch observed for a session initializes the baseline silently without replaying old alerts.
 */
export function processIncomingAlertEvents(events, { notifyEnabled = true, notifySound = false, sessionId = '', nowMs = Date.now() } = {}) {
  const list = Array.isArray(events) ? events.filter(e => e && e.id) : []
  const sessKey = String(sessionId || '__global__').trim() || '__global__'
  const seen = { ...(store.seenAlertEventIds || {}) }
  if (!runtimeRefs.alertBaselineBySession || typeof runtimeRefs.alertBaselineBySession !== 'object') {
    runtimeRefs.alertBaselineBySession = {}
  }

  if (!runtimeRefs.alertBaselineBySession[sessKey]) {
    runtimeRefs.alertBaselineBySession[sessKey] = true
    for (const ev of list) seen[ev.id] = true
    if (list.length > 0) patch({ seenAlertEventIds: seen })
    return { initialized: true, fired: [] }
  }

  const fresh = []
  for (const ev of list) {
    if (seen[ev.id]) continue
    seen[ev.id] = true
    const age = nowMs - (Number(ev.at) || 0)
    if (age <= ALERT_RECENT_WINDOW_MS) fresh.push(ev)
  }

  if (fresh.length === 0) {
    if (list.some(e => !((store.seenAlertEventIds || {})[e.id]))) {
      patch({ seenAlertEventIds: seen })
    }
    return { initialized: false, fired: [] }
  }

  fresh.sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0))
  const latest = fresh[0]
  let dispatchRes = null
  if (notifyEnabled !== false) {
    dispatchRes = fireChiefAlertNotification(latest, { sound: Boolean(notifySound) })
    patch({
      seenAlertEventIds: seen,
      notice: formatBi('{msg}', '{msg}', { msg: dispatchRes.toast.slice(0, 120) }),
    })
  } else {
    patch({ seenAlertEventIds: seen })
  }
  return {
    initialized: false,
    fired: notifyEnabled !== false ? [latest] : [],
    dispatchRes,
  }
}

export function resetAlertSessionBaselines() {
  runtimeRefs.alertBaselineBySession = {}
  patch({ seenAlertEventIds: {} })
}
