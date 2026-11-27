/**
 * src/client/notify.js
 *
 * Key-milestone desktop Notification & optional WebAudio gentle chime engine
 * with per-session baseline suppression so initial loads never replay old alerts.
 */

import { store, patch, runtimeRefs } from './store.js'
import { bi, formatBi } from './i18n.js'
import { maybeAutoSpeakAlert } from './tts.js'

const ALERT_RECENT_WINDOW_MS = 120_000
const TAB_BADGE_STORAGE_KEY = 'dsh-chief:tab-badge-enabled'

let tabBadgeTimer = null
let tabBadgeBaseTitle = ''
let tabBadgeListenersBound = false

export function isTabTitleBadgeEnabled() {
  try {
    if (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function') {
      const val = localStorage.getItem(TAB_BADGE_STORAGE_KEY)
      if (val === '0' || val === 'false') return false
    }
  } catch {}
  return true
}

export function setTabTitleBadgeEnabled(on) {
  const next = Boolean(on)
  try {
    if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
      localStorage.setItem(TAB_BADGE_STORAGE_KEY, next ? '1' : '0')
    }
  } catch {}
  if (!next) clearTabTitleBadge()
  return next
}

export function clearTabTitleBadge() {
  if (tabBadgeTimer) {
    clearInterval(tabBadgeTimer)
    tabBadgeTimer = null
  }
  try {
    if (typeof document !== 'undefined' && tabBadgeBaseTitle) {
      document.title = tabBadgeBaseTitle
    }
  } catch {}
  tabBadgeBaseTitle = ''
}

function bindTabBadgeClearListeners() {
  if (tabBadgeListenersBound || typeof document === 'undefined' || typeof window === 'undefined') return
  tabBadgeListenersBound = true
  try {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) clearTabTitleBadge()
    })
    window.addEventListener('focus', () => {
      clearTabTitleBadge()
    })
  } catch {}
}

/** Flash a compact alert badge in the browser tab title when waiting for user input. */
export function flashTabTitleBadge(prefix = '🔔 需要你', { force = false, autoResetMs = 20000 } = {}) {
  try {
    if (typeof document === 'undefined' || typeof document.title !== 'string') return false
    if (!force && !isTabTitleBadgeEnabled()) return false
    if (!force && typeof document.hidden === 'boolean' && !document.hidden) return false
    bindTabBadgeClearListeners()
    const cleanPrefix = String(prefix || '🔔 需要你').trim() || '🔔 需要你'
    if (!tabBadgeBaseTitle) {
      const curTitle = document.title.replace(/^\[?🔔[^\]]*\]?\s*·\s*/u, '').trim()
      tabBadgeBaseTitle = curTitle || 'DeepSeek Harness'
    }
    if (tabBadgeTimer) {
      clearInterval(tabBadgeTimer)
      tabBadgeTimer = null
    }
    let showBadge = true
    const applyFrame = () => {
      try {
        document.title = showBadge ? `${cleanPrefix} · ${tabBadgeBaseTitle}` : tabBadgeBaseTitle
      } catch {}
    }
    applyFrame()
    if (typeof setInterval === 'function') {
      const started = Date.now()
      tabBadgeTimer = setInterval(() => {
        if (Date.now() - started >= autoResetMs) {
          clearTabTitleBadge()
          return
        }
        showBadge = !showBadge
        applyFrame()
      }, 1100)
      if (tabBadgeTimer && typeof tabBadgeTimer.unref === 'function') tabBadgeTimer.unref()
    }
    return true
  } catch {
    return false
  }
}

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
        title: bi('🔐 等你确认操作', '🔐 Approval Needed'),
        body: body || bi('参谋想改文件或调流程，等你点确认。', 'Chief wants to edit files or adjust a workflow and needs your OK.'),
      }
    case 'pending_elevation':
      return {
        title: bi('⬆️ 参谋申请更高权限', '⬆️ Higher Permission Requested'),
        body: body || bi('这步需要更高权限，等你同意后才能继续。', 'This step needs a higher permission level before it can continue.'),
      }
    case 'guard_wall_blocked':
      return {
        title: bi('🚧 自定义拦截规则已拦下操作', '🚧 Custom Block Rule Triggered'),
        body: body || bi('命中你在边界页添加的自定义拦截规则，等你处理。', 'Stopped by your custom block rules. Please check.'),
      }
    case 'safety_guard_blocked':
      return {
        title: bi('🛡️ 安全拦截已拦下操作', '🛡️ Safety Block Triggered'),
        body: body || bi('拦住了危险操作（如删文件、改项目外文件或读密码），等你查看。', 'Blocked a risky action (e.g., file delete, outside edit, or secret read).'),
      }
    case 'auto_continue_rescue':
      return {
        title: bi('🔄 对话断了，已自动接着跑', '🔄 Chat Stopped, Resuming'),
        body: body || bi('主对话刚才突然断开了，已自动唤醒接着跑。', 'The main chat stopped unexpectedly and was resumed automatically.'),
      }
    case 'managed_auto_sleep':
      return {
        title: bi('🌙 托管已自动休眠', '🌙 Managed Mode Paused'),
        body: body || bi('手头的事都做完了，已切回「⏸ 关停」省 Token。', 'All tasks finished. Switched back to ⏸ Off to save tokens.'),
      }
    case 'budget_circuit_break':
      return {
        title: bi('🛑 托管已到用量上限停机', '🛑 Managed Usage Limit Reached'),
        body: body || bi('托管调用次数或 Token 已到上限，已切回「⏸ 关停」。', 'Managed calls or tokens hit the limit. Switched back to ⏸ Off.'),
      }
    case 'hazard_halt':
      return {
        title: bi('🚨 高危操作急停：已自动暂停', '🚨 High-Risk Halt: Paused'),
        body: body || bi('遇到高风险操作或反复卡住，已先帮你停下。', 'Paused after spotting a risky action or repeated block.'),
      }
    default:
      return {
        title: String(ev.title || bi('DSH 参谋长提醒', 'DSH Chief Alert')),
        body,
      }
  }
}

/** Dispatch a desktop notification (if granted) and optional chime for one milestone event. */
export function fireChiefAlertNotification(ev, { sound = false, flashTitle = false } = {}) {
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
  const flashedTitle = flashTabTitleBadge(bi('🔔 需要你', '🔔 Attention'), { force: Boolean(flashTitle) })
  const toast = body ? `${title}：${body}` : title
  return { title, body, toast, notifiedDesktop, playedSound, flashedTitle }
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
    const ttsCfg = store.chiefMeta && store.chiefMeta.tts
    if (ttsCfg && ttsCfg.enabled && ttsCfg.autoSpeakAlerts) {
      if (dispatchRes && dispatchRes.playedSound && typeof setTimeout === 'function') {
        const speakTid = setTimeout(() => {
          void maybeAutoSpeakAlert(latest, dispatchRes)
        }, 260)
        if (speakTid && typeof speakTid.unref === 'function') speakTid.unref()
      } else {
        void maybeAutoSpeakAlert(latest, dispatchRes)
      }
    }
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
