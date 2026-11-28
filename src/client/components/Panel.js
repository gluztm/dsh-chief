/**
 * components/Panel.js
 *
 * Root PanelInner layout, header, navigation tabs, shell slot wrappers, and ErrorBoundary-wrapped Panel.
 */

import { React, h } from '../react-runtime.js'
import {
  API,
  SIDE_ID,
  BRAND_NAME,
  EXPECTED_BACKEND_BUILD,
  STATUS_BG,
  TABS,
  DOCK_POLL_MS,
  RUN_MODE_OPTIONS,
  THINKING_EFFORT_OPTIONS,
  DEFAULT_UI_SKIN,
} from '../constants.js'
import { bi, tabLabel, runModeMeta, effortMeta, chiefDisplayName, chiefShortName } from '../i18n.js'
import {
  store,
  patch,
  subscribe,
  useStore,
  service,
  isSubagentSessionId,
  focusObjectiveInPyramid,
  selectPanel,
  rightbarExpanded,
  openChief,
  openChiefInMainPage,
  openChiefInRightbar,
  switchConversationView,
  closeChief,
  toggleChief,
  reserveCornerSpace,
  saveNavLayout,
  scrollWorkspaceSection,
  openThemeStudio,
  runtimeRefs,
} from '../store.js'
import {
  clampTitle,
  shortSession,
  shortModelName,
  fullModelWithChannel,
  isInternalProbeName,
  sessionIdFromUrl,
  normalizeCursorBlocked,
} from '../utils.js'
import {
  loadChiefView,
  loadChiefModels,
  updateSecConfig,
  loadArchives,
  refresh,
  adoptSession,
  fetchGithubStarStatus,
  toggleGithubStarApi,
  submitChiefBar,
} from '../api.js'
import { Style } from '../styles.js'
import { speakChiefText, stopChiefSpeech } from '../tts.js'
import { Icon, ChiefErrorBoundary, SearchDrawer } from './common.js'
import {
  ModelPickerPopover,
  SuggestionBanner,
  InterventionConfirmModal,
  UnlimitedTurnsConfirmModal,
  AutoPilotConfirmModal,
  ArchiveRelayModal,
  DistillToGlobalModal,
  ChiefAdviceModal,
  HazardHaltModal,
  PrecipitateConfirmModal,
  PeerLinkConfirmModal,
  HandoffWarnModal,
  ChiefRiskConfirmModal,
  SafetyGuardConfirmModal,
  OperationApprovalModal,
  ElevationRequestModal,
  AuditLogModal,
  AwayPresetConfirmModal,
  CustomThemeModal,
  ThemeStudioView,
} from './modals.js'
import { TasksTab } from '../tabs/tasks.js'
import { ArchiveTab } from '../tabs/archives.js'
import { ExternalMemoryTab } from '../tabs/extmem.js'
import { BoundariesTab } from '../tabs/boundaries.js'
import { ChiefTab, ChiefComposerBar } from '../tabs/chief.js'
import { PeersTab } from '../tabs/peers.js'
import { HandoffTab } from '../tabs/plan.js'

const GITHUB_REPO_STAR_URL = 'https://github.com/gluztm/dsh-chief'
const GITHUB_STAR_STORAGE_KEY = 'dsh-chief:github-starred'

function readSavedStarState() {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(GITHUB_STAR_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function formatGithubStarCount(n) {
  const num = Number(n)
  if (!Number.isFinite(num) || num < 0) return ''
  if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(Math.round(num))
}

function GithubStarButton({ ghState }) {
  const gs = ghState && typeof ghState === 'object' ? ghState : {}
  const [localStarred, setLocalStarred] = React.useState(readSavedStarState)
  const [burstKey, setBurstKey] = React.useState(0)
  const [bursting, setBursting] = React.useState(false)
  const pendingWebReturnRef = React.useRef(false)
  const countAtLeaveRef = React.useRef(null)

  const ghSynced = gs.syncedVia === 'gh' && typeof gs.starred === 'boolean'
  const starred = ghSynced ? Boolean(gs.starred) : localStarred
  const starCountText = typeof gs.starCount === 'number' ? formatGithubStarCount(gs.starCount) : ''

  React.useEffect(() => {
    const t = setTimeout(() => {
      void fetchGithubStarStatus({ checkPersonal: true })
    }, 180)
    return () => clearTimeout(t)
  }, [])

  React.useEffect(() => {
    if (!ghSynced) return
    setLocalStarred(Boolean(gs.starred))
    try {
      if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
        localStorage.setItem(GITHUB_STAR_STORAGE_KEY, gs.starred ? '1' : '0')
      }
    } catch {}
  }, [ghSynced, gs.starred])

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined
    const onFocus = async () => {
      if (!pendingWebReturnRef.current) return
      pendingWebReturnRef.current = false
      const prevCnt = countAtLeaveRef.current
      const res = await fetchGithubStarStatus({ checkPersonal: true, force: true })
      if (res && typeof res.starCount === 'number' && typeof prevCnt === 'number' && res.starCount > prevCnt) {
        setBurstKey(k => k + 1)
        patch({
          notice: bi('🎉 检测到仓库 Star +1，感谢你的支持！', '🎉 Star count increased — thanks for supporting dsh-chief!'),
        })
      }
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  React.useEffect(() => {
    if (!burstKey) return undefined
    setBursting(true)
    const timer = setTimeout(() => setBursting(false), 720)
    return () => clearTimeout(timer)
  }, [burstKey])

  const handleStarClick = (e) => {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation()

    // Case A: Local GitHub CLI authenticated & Shift+Click when already starred -> unstar cleanly
    if (ghSynced && starred && e && e.shiftKey) {
      e.preventDefault()
      setBurstKey(k => k + 1)
      void toggleGithubStarApi({ desired: false }).then(res => {
        if (res && res.mode === 'gh_direct') {
          patch({ notice: bi('☆ 已通过本机 gh CLI 取消仓库 Star 同步', '☆ Unstarred via local GitHub CLI') })
        }
      })
      return
    }

    // Case B: Local GitHub CLI available & not yet starred -> Direct 1-click real GitHub star!
    if (gs.ghAvailable && gs.ghAuthenticated && !starred) {
      if (e && typeof e.preventDefault === 'function') e.preventDefault()
      setBurstKey(k => k + 1)
      setLocalStarred(true)
      void toggleGithubStarApi({ desired: true }).then(res => {
        if (res && res.mode === 'gh_direct') {
          try {
            if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
              localStorage.setItem(GITHUB_STAR_STORAGE_KEY, '1')
            }
          } catch {}
          patch({
            notice: bi(
              '⭐ 已通过本机 GitHub CLI 直连为 gluztm/dsh-chief 点亮 Star！',
              '⭐ Starred gluztm/dsh-chief directly via local GitHub CLI!',
            ),
          })
          return
        }
        if (res && res.mode === 'already_starred') {
          patch({ notice: bi('✨ 你的 GitHub 账号此前已点亮过本仓库～', '✨ You already starred gluztm/dsh-chief on GitHub!') })
          return
        }
        // Fallback: open GitHub repo page if CLI lacked scope or failed
        pendingWebReturnRef.current = true
        countAtLeaveRef.current = typeof gs.starCount === 'number' ? gs.starCount : null
        try {
          if (typeof window !== 'undefined' && typeof window.open === 'function') {
            window.open(GITHUB_REPO_STAR_URL, '_blank', 'noopener,noreferrer')
          }
        } catch {}
        patch({ notice: bi('已打开 GitHub 仓库页，顺手点亮 Star 支持一下～', 'Opened GitHub repo — tap Star to support us!') })
      })
      return
    }

    // Case C: Already starred (normal click) or web fallback -> open GitHub repo directly
    setBurstKey(k => k + 1)
    if (!starred) {
      setLocalStarred(true)
      try {
        if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
          localStorage.setItem(GITHUB_STAR_STORAGE_KEY, '1')
        }
      } catch {}
      pendingWebReturnRef.current = true
      countAtLeaveRef.current = typeof gs.starCount === 'number' ? gs.starCount : null
    }
    patch({
      notice: ghSynced && starred
        ? bi('✨ 已通过 GitHub CLI 同步点亮状态 · 正在前往仓库主页', '✨ Synced via gh CLI · Opening repository')
        : bi('⭐ 感谢点亮！已直达 GitHub 仓库，点亮后切回自动同步人数～', '⭐ Opened GitHub repo — count syncs when you return!'),
    })
  }

  return h(
    'a',
    {
      href: GITHUB_REPO_STAR_URL,
      target: '_blank',
      rel: 'noopener noreferrer',
      className: 'dnb-star-btn',
      'data-starred': starred ? '1' : '0',
      'data-burst': bursting ? '1' : '0',
      'data-synced': ghSynced ? 'gh' : 'web',
      'aria-label': bi('前往 GitHub 点赞 Star', 'Star on GitHub'),
      title: ghSynced
        ? (starred
            ? bi('已通过本机 GitHub CLI 同步点亮（点击查看仓库 / Shift+点击可取消）', 'Starred & synced via gh CLI (click to open repo / Shift+click to unstar)')
            : bi('检测到本机已登录 gh CLI：点击直接为 gluztm/dsh-chief 点亮真实 Star！', 'gh CLI detected: click to star gluztm/dsh-chief directly!'))
        : (starred
            ? bi('已点亮 ✨ 感谢你的 Star（点击前往 GitHub 仓库）', 'Starred ✨ Click to open GitHub repo')
            : bi('点亮这颗星 ⭐ 直达 GitHub 给个 Star 支持一下', 'Click to light up & Star gluztm/dsh-chief on GitHub')),
      onClick: handleStarClick,
    },
    bursting && burstKey > 0
      ? h(
          React.Fragment,
          { key: 'burst-' + burstKey },
          h('span', { className: 'dnb-star-ring', 'aria-hidden': true }),
          [0, 60, 120, 180, 240, 300].map(ang =>
            h('span', {
              key: ang,
              className: 'dnb-star-spark',
              'aria-hidden': true,
              style: { '--ang': ang + 'deg' },
            })),
        )
      : null,
    h(
      'span',
      { className: 'dnb-star-svg', key: 'icon-' + burstKey },
      h(Icon, { name: 'star', size: 12.5, filled: starred }),
    ),
    h('span', { className: 'dnb-star-label' }, starred ? 'Starred' : 'Star'),
    starCountText
      ? h('span', { className: 'dnb-star-count' }, starCountText)
      : null,
  )
}

function ChiefWorkStageOverlay({ fx }) {
  const fxKey = fx && fx.label ? String(fx.token || fx.id || (fx.tone || 'neon') + ':' + String(fx.label)) : ''
  const [dismissedKey, setDismissedKey] = React.useState('')
  React.useEffect(() => {
    if (!fxKey && dismissedKey) setDismissedKey('')
  }, [fxKey, dismissedKey])
  if (!fxKey) return null
  const stageDismissed = dismissedKey === fxKey
  const tone = fx.tone || 'neon'
  const chars = Array.from(String(fx.label))
  return h(
    React.Fragment,
    null,
    h('div', {
      className: 'dnb-chief-fx-border',
      'data-tone': tone,
      'data-dismissed': stageDismissed ? '1' : '0',
      'aria-hidden': true,
    }),
    !stageDismissed
      ? h(
          'div',
          {
            className: 'dnb-chief-fx-stage',
            'data-tone': tone,
            role: 'status',
            'aria-live': 'polite',
            title: '点任意处收起遮罩继续操作（外框亮着说明后台还在跑）',
            onClick: e => {
              e.stopPropagation()
              setDismissedKey(fxKey)
            },
          },
          h(
            'div',
            { className: 'dnb-chief-fx-pill' },
            h('span', { className: 'dnb-chief-fx-ring', 'aria-hidden': true }),
            h(
              'div',
              { className: 'dnb-chief-fx-text' },
              chars.map((ch, idx) =>
                h(
                  'span',
                  {
                    key: idx,
                    className: 'dnb-wave-char',
                    style: { '--char-i': idx },
                  },
                  ch === ' ' ? '\u00A0' : ch,
                ),
              ),
            ),
          ),
          h(
            'div',
            { className: 'dnb-chief-fx-hint' },
            bi('点任意处收起遮罩，外框亮着说明后台还在跑', 'Click anywhere to hide overlay. Glowing border means still working.'),
          ),
        )
      : null,
  )
}

function ChiefVoiceModeStage({ view }) {
  if (!view || !view.voiceModeActive || view.voiceStageMinimized) return null
  const isRecording = view.voiceRecState === 'recording'
  const isThinking = view.voiceRecState === 'transcribing' || Boolean(view.secBusy)
  const ttsPlayer = view.ttsPlayer || {}
  const isSpeaking = ttsPlayer.status === 'playing' || ttsPlayer.status === 'loading'
  const stageState = isRecording
    ? 'recording'
    : (isThinking ? 'thinking' : (isSpeaking ? 'speaking' : 'idle'))

  const secElapsed = Math.max(0, Math.round((Number(view.voiceRecElapsedMs) || 0) / 1000))
  const lv = isRecording ? Math.min(1, Math.max(0, Number(view.voiceRecLevel) || 0)) : 0
  const rawCaption = view.voiceInterimText
    || (view.secLatestReply && view.secLatestReply.text ? view.secLatestReply.text : '')
  const captionText = String(rawCaption || '')
    .replace(/^\s*[-•]\s*【[^】]+】\s*/gm, '')
    .trim()

  const statusTitle = stageState === 'recording'
    ? bi(`正在聆听 · ${secElapsed}s`, `Listening · ${secElapsed}s`)
    : (stageState === 'thinking'
        ? (view.voiceRecState === 'transcribing'
            ? bi('正在转写语音手记…', 'Transcribing voice note…')
            : bi(`${chiefDisplayName(view)} 正在组织口语回复…`, `${chiefDisplayName(view)} is replying…`))
        : (stageState === 'speaking'
            ? bi(`${chiefDisplayName(view)} 正在语音回答…`, `${chiefDisplayName(view)} is speaking…`)
            : bi(`与 ${chiefDisplayName(view)} 语音面聊中`, `Voice Chat with ${chiefDisplayName(view)}`)))

  const isHandsFree = Boolean(view.voiceHandsFree)
  const vadHeard = Boolean(view.voiceVadHeardSpeech)
  const handoffDraft = typeof view.voiceHandoffDraft === 'string' ? view.voiceHandoffDraft.trim() : ''

  const statusSub = stageState === 'recording'
    ? (isHandsFree
        ? (vadHeard
            ? bi('已听见声音 · 说完停顿约 1.3 秒自动发送', 'Speech detected · pauses auto-send')
            : bi('免提倾听中 · 请直接开口说话（停顿自动发送）', 'Hands-free listening · speak naturally'))
        : bi('轻触光球结束录音并发送（极速口语 · 秒回不写长文）', 'Tap the orb to send your voice note'))
    : (stageState === 'thinking'
        ? bi('极速口语快答，完成后自动语音播报', 'Fast spoken reply · auto-speaks result')
        : (stageState === 'speaking'
            ? bi(isHandsFree ? '轻触光球随时插话打断 · 播完自动继续听' : '轻触光球可随时打断当前播报', 'Tap orb to interrupt speech')
            : bi('轻触光球开口说话 · 语音自动存入手记待梦境整理', 'Tap the orb to speak · queued for Dream Roam')))

  const onOrbClick = () => {
    if (stageState === 'thinking') return
    if (stageState === 'speaking') {
      stopChiefSpeech()
      if (isHandsFree && typeof runtimeRefs.triggerVoiceAction === 'function') {
        setTimeout(() => {
          if (store.voiceModeActive && store.voiceRecState === 'idle' && typeof runtimeRefs.triggerVoiceAction === 'function') {
            void runtimeRefs.triggerVoiceAction('voice_chat')
          }
        }, 120)
      }
      return
    }
    if (typeof runtimeRefs.triggerVoiceAction === 'function') {
      void runtimeRefs.triggerVoiceAction('voice_chat')
    }
  }

  const toggleHandsFree = () => {
    const next = !isHandsFree
    patch({ voiceHandsFree: next })
    if (next && stageState === 'idle' && typeof runtimeRefs.triggerVoiceAction === 'function') {
      void runtimeRefs.triggerVoiceAction('voice_chat')
    }
  }

  return h(
    'div',
    {
      className: 'dnb-voice-stage',
      'data-state': stageState,
      role: 'dialog',
      'aria-label': bi('语音面聊舞台', 'Voice Chat Stage'),
    },
    h('div', { className: 'dnb-voice-stage-glow', 'aria-hidden': true }),
    h(
      'div',
      { className: 'dnb-voice-orb-wrap' },
      h('span', { className: 'dnb-voice-orb-ring', 'aria-hidden': true }),
      h('span', { className: 'dnb-voice-orb-ring-2', 'aria-hidden': true }),
      h(
        'button',
        {
          type: 'button',
          className: 'dnb-voice-orb',
          disabled: stageState === 'thinking',
          style: { '--voice-lv': lv.toFixed(3) },
          title: statusSub,
          onClick: onOrbClick,
        },
        h('span', { className: 'dnb-voice-orb-halo', 'aria-hidden': true }),
        h(
          'span',
          { className: 'dnb-voice-orb-blobs', 'aria-hidden': true },
          h('span', { className: 'dnb-voice-orb-blob-a' }),
          h('span', { className: 'dnb-voice-orb-blob-b' }),
          h('span', { className: 'dnb-voice-orb-blob-c' }),
        ),
        h('span', { className: 'dnb-voice-orb-glass', 'aria-hidden': true }),
        h(
          'span',
          { className: 'dnb-voice-orb-core' },
          stageState === 'recording'
            ? h(Icon, { name: 'mic', size: 30 })
            : (stageState === 'thinking'
                ? h(Icon, { name: 'refresh', size: 28, style: { animation: 'dnb-spin 0.9s linear infinite' } })
                : (stageState === 'speaking'
                    ? h('span', { className: 'dnb-tts-wave', style: { transform: 'scale(1.85)' } }, h('span'), h('span'), h('span'))
                    : h(Icon, { name: 'voiceSpark', size: 32 }))),
        ),
      ),
    ),
    h('div', { className: 'dnb-voice-stage-title' }, statusTitle),
    h('div', { className: 'dnb-voice-stage-sub' }, statusSub),
    captionText
      ? h('div', { className: 'dnb-voice-caption' }, captionText)
      : null,
    handoffDraft
      ? h(
          'div',
          { className: 'dnb-voice-handoff-card' },
          h('div', { style: { fontSize: 11, fontWeight: 650, opacity: 0.9 } },
            bi('🎯 参谋长整理好的待办（需你点确认再发给主对话）：', '🎯 Task Draft for @lead (confirm to send):')),
          h('div', { style: { fontSize: 11.5, lineHeight: 1.45, opacity: 0.95, wordBreak: 'break-word' } }, handoffDraft),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' } },
            h('button', {
              type: 'button',
              className: 'dnb-mini-btn',
              'data-tone': 'accent',
              disabled: Boolean(view.secBusy),
              onClick: () => {
                const msg = handoffDraft
                patch({ voiceHandoffDraft: '', voiceStageMinimized: true })
                void submitChiefBar(msg, '', { voiceChat: false })
              },
            }, bi('📨 确认发给 @主对话', '📨 Send to @lead')),
            h('button', {
              type: 'button',
              className: 'dnb-mini-btn',
              onClick: () => patch({ voiceHandoffDraft: '' }),
            }, bi('忽略', 'Dismiss')),
          ),
        )
      : null,
    h(
      'div',
      { className: 'dnb-voice-stage-actions' },
      h('button', {
        type: 'button',
        className: 'dnb-voice-stage-pill-btn',
        'data-active': isHandsFree ? '1' : '0',
        onClick: toggleHandsFree,
      }, h(Icon, { name: 'waves', size: 12 }), isHandsFree ? bi('免提连续：开', 'Hands-Free: ON') : bi('免提连续：关', 'Hands-Free: OFF')),
      h('button', {
        type: 'button',
        className: 'dnb-voice-stage-pill-btn',
        'data-active': view.voiceWakeEnabled ? '1' : '0',
        title: bi('开启后喊参谋长名字会自动回复并进入语音模式', 'Say Chief name to wake and start voice chat'),
        onClick: () => {
          if (typeof runtimeRefs.toggleWakeWord === 'function') void runtimeRefs.toggleWakeWord()
        },
      }, h(Icon, { name: 'mic', size: 12 }), view.voiceWakeEnabled ? bi('叫名唤醒：开', 'Wake Call: ON') : bi('叫名唤醒：关', 'Wake Call: OFF')),
      h('button', {
        type: 'button',
        className: 'dnb-voice-stage-pill-btn',
        onClick: () => patch({ voiceStageMinimized: true }),
      }, h(Icon, { name: 'eye', size: 12 }), bi('收起看内容', 'Show Panel')),
      stageState === 'speaking'
        ? h('button', {
            type: 'button',
            className: 'dnb-voice-stage-pill-btn',
            onClick: () => stopChiefSpeech(),
          }, h(Icon, { name: 'stop', size: 11.5 }), bi('停止播报', 'Stop Speech'))
        : (view.secLatestReply && view.secLatestReply.text
            ? h('button', {
                type: 'button',
                className: 'dnb-voice-stage-pill-btn',
                onClick: () => void speakChiefText(view.secLatestReply.text, {
                  itemId: `voice-replay:${view.secLatestReply.at || 1}`,
                  label: bi('重听回答', 'Replay'),
                  style: 'full',
                }),
              }, h(Icon, { name: 'volume', size: 12 }), bi('重听上句', 'Replay'))
            : null),
      h('button', {
        type: 'button',
        className: 'dnb-voice-stage-pill-btn',
        onClick: () => {
          if (typeof runtimeRefs.exitVoiceMode === 'function') runtimeRefs.exitVoiceMode()
          else patch({ voiceModeActive: false, voiceStageMinimized: false, voiceHandsFree: false, voiceHandoffDraft: '' })
        },
      }, h(Icon, { name: 'x', size: 12 }), bi('退出语音', 'Exit Voice')),
    ),
  )
}

function PanelInner(props) {
  const view = useStore()
  const [gearDeg, setGearDeg] = React.useState(0)
  const [expandedRailTabs, setExpandedRailTabs] = React.useState(() => ({ [(view && view.tab === 'plan' ? 'tasks' : (view && view.tab)) || 'chief']: true }))
  const isPage = !!(props && props.variant === 'main')
  const isDock = !!(props && props.variant === 'dock')
  const inConvView = !!(props && props.inConversationView)
  const selfRef = React.useRef(null)

  const secBarRef = React.useRef(null)
  const activeSkin = (view && view.uiSkin) || DEFAULT_UI_SKIN

  React.useEffect(() => {
    const tKey = (view && view.tab === 'plan') ? 'tasks' : ((view && view.tab) || 'chief')
    setExpandedRailTabs({ [tKey]: true })
  }, [view && view.tab])

  React.useEffect(() => {
    try {
      if (typeof document !== 'undefined') {
        if (document.documentElement) document.documentElement.setAttribute('data-dnb-skin', activeSkin)
        if (document.body) document.body.setAttribute('data-dnb-skin', activeSkin)
      }
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent('dnb-skin-change', { detail: { skin: activeSkin } }))
      }
    } catch {}
  }, [activeSkin])

  React.useEffect(() => {
    if (!isDock && !isPage && !view.open) return undefined
    const onShortcut = e => {
      if (e && e.altKey && !e.ctrlKey && !e.metaKey && String(e.key || '').toLowerCase() === 'v') {
        e.preventDefault()
        if (typeof runtimeRefs.toggleVoiceMode === 'function') {
          void runtimeRefs.toggleVoiceMode()
        } else {
          patch({ voiceModeActive: !store.voiceModeActive, voiceStageMinimized: false })
        }
      }
    }
    document.addEventListener('keydown', onShortcut)
    return () => document.removeEventListener('keydown', onShortcut)
  }, [isDock, isPage, view.open])

  React.useEffect(() => {
    const host = isDock || isPage || view.open ? selfRef.current : null
    if (!host) return undefined
    const measure = () => {
      try {
        host.style.removeProperty('--dnb-safe-top')
        host.style.removeProperty('--dnb-safe-bottom')
        const reserve = reserveCornerSpace(host, secBarRef.current)
        const key = String(reserve.right || 0)
        if (key === host.dataset.dnbReserve) return
        host.dataset.dnbReserve = key
        host.style.setProperty('--dnb-safe-right', (reserve.right || 0) + 'px')
      } catch {}
    }
    const timer = setInterval(measure, 3500)
    const first = setTimeout(measure, 450)
    return () => {
      clearInterval(timer)
      clearTimeout(first)
    }
  }, [view.open, isDock, isPage])

  if (!isPage && !isDock && !view.open) return null

  const board = view.board
  const tasks = (board && Array.isArray(board.tasks)) ? board.tasks : []
  const openCount = tasks.filter(t => t && t.status !== 'done').length
  const meta = view.chiefMeta || {}
  const subagentChildrenCount = Array.isArray(view.subagents)
    ? view.subagents.filter(a => (
        a
        && a.name
        && a.name !== 'lead'
        && (view.showInternalProbes || a.status === 'running' || !isInternalProbeName(a.name))
      )).length
    : 0
  const peersBadge = subagentChildrenCount + (meta.linkedPeersCount || 0)
  const secBadge = (meta.pendingSuggestions || 0)
  const archMeta = view.archiveMeta || {}
  const archiveBadge = archMeta.takenOutCount || 0
  const extMemBadge = Boolean(
    meta.externalMemory
    && meta.externalMemory.enabled
    && meta.externalMemory.memorySlot
    && meta.externalMemory.memorySlot.kind !== 'none'
    && (!meta.externalMemoryStatus || meta.externalMemoryStatus.policy !== 'disabled'),
  )
  const extMemDegraded = Boolean(meta.externalMemoryStatus && meta.externalMemoryStatus.memory && meta.externalMemoryStatus.memory.degraded)
  const panelWorking = Boolean(
    meta.sessionEnabled !== false
    && (
      view.chiefWorkFx
      || (meta && meta.activeWork)
      || view.secBusy
      || view.secRegenerating
      || (Array.isArray(view.subagents) && view.subagents.some(a => a && a.status === 'running'))
    ),
  )

  const chiefTitleLabel = chiefDisplayName(view)

  const body = view.settingsOpen
    ? h(
        'div',
        { className: 'dnb-view' },
        h(
          'div',
          { className: 'dnb-settings-bar' },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--dnb-text)' } },
            h(Icon, { name: 'settings', size: 13.5, style: { color: 'var(--dnb-accent)' } }),
            bi('设置', 'Settings'),
          ),
          h('button', {
            type: 'button',
            className: 'dnb-pill',
            style: { height: 22, padding: '0 8px', fontSize: 11 },
            onClick: () => {
              setGearDeg(d => d + 180)
              patch({ settingsOpen: false })
            },
          }, bi('← 返回', '← Back')),
        ),
        h(HandoffTab, { view }),
      )
    : view.themeOpen
      ? h(ThemeStudioView, { view })
      : view.tab === 'chief'
        ? h(ChiefTab, { board, view })
        : view.tab === 'peers'
          ? h(PeersTab, { view })
          : view.tab === 'archive'
            ? h(ArchiveTab, { board, view })
            : view.tab === 'extmem'
              ? h(ExternalMemoryTab, { view })
              : view.tab === 'boundaries'
                ? h(BoundariesTab, { store: view })
                : h(TasksTab, { board, view })

  const cursorBlocked = normalizeCursorBlocked(board && board.cursor && board.cursor.blocked)
  const cursorText = board && board.cursor && (board.cursor.next || board.cursor.step || cursorBlocked)
    ? (cursorBlocked ? '卡住了：' + cursorBlocked : (board.cursor.next || board.cursor.step))
    : ''

  const activeRailSub = (() => {
    if (view.settingsOpen || view.themeOpen) return ''
    const curTab = view.tab === 'plan' ? 'tasks' : (view.tab || 'chief')
    if (curTab === 'chief') return `chief:${view.chiefSubTab || 'all'}`
    if (curTab === 'tasks') return `tasks:${view.tasksSubTab || 'plan'}`
    if (curTab === 'peers') return `peers:${view.peersSubTab || 'all'}`
    if (curTab === 'boundaries') return `boundaries:${view.boundSubTab || 'walls'}`
    return ''
  })()

  return h(
    React.Fragment,
    null,
    h(Style, null),
    h(
      'div',
      {
        className: isDock ? 'dnb-panel dnb-main dnb-dock' : isPage ? 'dnb-panel dnb-main' : 'dnb-panel',
        'data-dnb-skin': activeSkin,
        'data-dnb-nav-layout': view.navLayout || 'sidebar',
        role: isPage || isDock ? 'region' : 'dialog',
        'aria-label': BRAND_NAME,
        ref: node => {
          runtimeRefs.panelEl = node
          selfRef.current = node
        },
      },
      // Clean iOS Header with Chief Model Picker & Auto-Pilot Switch
      h(
        'div',
        { className: 'dnb-head', style: { position: 'relative' } },
        h('span', {
          className: 'dnb-title',
          style: { display: 'inline-flex', alignItems: 'center', gap: 5 },
          title: `${chiefTitleLabel} v${EXPECTED_BACKEND_BUILD}${meta.backendBuild ? (view.staleBackendDetected ? bi(`（后台还是旧版 v${meta.backendBuild}，重启 DSH 后生效）`, ` (background is still v${meta.backendBuild}; restart DSH to update)`) : bi('（版本已同步）', ' (synced)')) : ''}${view.sessionId ? ` · ${bi('对话', 'Chat')} ${shortSession(view.sessionId)}` : ''}`,
        },
          h('span', { className: 'dnb-brand-status-icon', 'data-working': panelWorking ? '1' : '0' },
            h(Icon, { name: 'sparkles', size: 14, style: { color: 'currentColor' } }),
          ),
          chiefTitleLabel,
        ),
        h(GithubStarButton, { ghState: view.githubStarState }),
        h(
          'div',
          { className: 'dnb-head-rail-moved' },
          h('button', {
            type: 'button',
            className: 'dnb-gear-btn dnb-skin-head-btn',
            'data-active': view.themeOpen ? '1' : '0',
            'aria-label': bi('外观与主题工坊', 'Appearance & Theme Studio'),
            'aria-pressed': view.themeOpen ? 'true' : 'false',
            title: bi('打开外观主题与 DIY 工坊页（6 套精选预设 + 自定义工坊）', 'Open Appearance & DIY Theme Studio page'),
            onClick: e => {
              e.stopPropagation()
              if (view.themeOpen) patch({ themeOpen: false })
              else openThemeStudio()
            },
          }, h(Icon, { name: 'palette', size: 13.5 })),
          h('button', {
            type: 'button',
            className: 'dnb-gear-btn dnb-layout-toggle-btn',
            'aria-label': bi('切换导航排列样式', 'Toggle Navigation Layout'),
            title: (view.navLayout || 'sidebar') === 'sidebar'
              ? bi('当前：左侧极简工作台（宽屏生效）· 点一下切回顶部标签', 'Current: Left Rail Studio · Click to switch to Top Tabs')
              : bi('当前：顶部经典标签 · 点一下切换左侧极简工作台（宽屏生效）', 'Current: Top Tabs · Click to switch to Left Rail Studio'),
            onClick: e => {
              e.stopPropagation()
              if (e.currentTarget && typeof e.currentTarget.blur === 'function') e.currentTarget.blur()
              const next = (view.navLayout || 'sidebar') === 'sidebar' ? 'top' : 'sidebar'
              saveNavLayout(next)
              patch({
                notice: next === 'sidebar'
                  ? bi('已切换为左侧极简工作台（宽屏生效）', 'Switched to Left Rail Studio (wide view)')
                  : bi('已切回顶部经典标签排列', 'Switched to Top Classic Tabs'),
              })
            },
          }, h(
            'svg',
            { width: 13.5, height: 13.5, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.85, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
            h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2.5 }),
            h('path', { d: (view.navLayout || 'sidebar') === 'sidebar' ? 'M9 4v16' : 'M3 9h18' }),
          )),
          (() => {
            const ttsPlayer = view.ttsPlayer || {}
            const isTtsActive = ttsPlayer.status === 'playing' || ttsPlayer.status === 'loading'
            return isTtsActive
              ? h('button', {
                  type: 'button',
                  className: 'dnb-gear-btn dnb-tts-head-btn',
                  'aria-label': bi('停止语音播报', 'Stop speech playback'),
                  title: bi('正在语音播报，点击立即静音停止', 'Speaking now — click to stop'),
                  onClick: e => {
                    e.stopPropagation()
                    stopChiefSpeech()
                  },
                }, h(Icon, { name: 'waves', size: 13.5 }))
              : null
          })(),
          h('button', {
            type: 'button',
            className: 'dnb-gear-btn',
            'data-active': view.settingsOpen ? '1' : '0',
            'aria-label': bi('设置', 'Settings'),
            'aria-pressed': view.settingsOpen ? 'true' : 'false',
            title: bi('设置：给参谋长取名、模式预设、桌面通知和用量上限', 'Settings: Chief name, presets, alerts, and caps'),
            onClick: () => {
              setGearDeg(d => d + 180)
              patch({
                settingsOpen: !view.settingsOpen,
                themeOpen: false,
                secModelMenuOpen: false,
                secPaceMenuOpen: false,
                secPermMenuOpen: false,
              })
            },
          }, h(Icon, { name: 'settings', size: 13.5, style: { transform: `rotate(${gearDeg}deg)` } })),
        ),
        view.staleBackendDetected
          ? h('span', {
              className: 'dnb-ver-chip',
              'data-stale': '1',
              title: bi(`面板已更新到 v${EXPECTED_BACKEND_BUILD}，后台还是 v${meta.backendBuild || '旧版'}，重启 DSH 后即可同步`, `UI is v${EXPECTED_BACKEND_BUILD}, background is still v${meta.backendBuild || 'older'}. Restart DSH to sync.`),
            }, `${bi('待重启', 'Restart')} · v${EXPECTED_BACKEND_BUILD}`)
          : null,
        meta.linkedPeersCount > 0
          ? h('button', {
              className: 'dnb-head-pill',
              style: { height: 21, padding: '0 6px', fontSize: 10.5, color: 'var(--dnb-accent)' },
              title: bi('已连上其他对话窗口，点击查看', 'Linked to other chat windows. Click to view.'),
              onClick: () => patch({ tab: 'peers', settingsOpen: false }),
            }, h(Icon, { name: 'link', size: 10.5 }), String(meta.linkedPeersCount))
          : null,
        h(
          'div',
          { className: 'dnb-head-actions' },
          h('button', {
            type: 'button',
            className: 'dnb-head-pill dnb-model-pill',
            title: (() => {
              const cat = view.secModelsCatalog || (view.secView && view.secView.models) || null
              const eff = meta.modelRef || meta.resolvedModelRef || meta.followModelRef || ''
              const label = fullModelWithChannel(eff, cat)
              if (!meta.modelRef) {
                return bi('正在跟着主对话用同一个模型', 'Using the main chat model') + (label ? ': ' + label + ' [' + eff + ']' : '') + bi('（点这里可单独指定模型）', ' (click to pick a separate model)')
              }
              return bi('参谋长单独使用的模型：', 'Chief model: ') + (label || eff) + ' [' + eff + ']' + bi('（点这里切回跟着主对话）', ' (click to follow main chat)')
            })(),
            onClick: () => {
              const nextOpen = !view.secModelMenuOpen
              patch({ secModelMenuOpen: nextOpen, secPaceMenuOpen: false, secPermMenuOpen: false })
              if (nextOpen) void loadChiefModels(true)
            },
          }, (() => {
            const cat = view.secModelsCatalog || (view.secView && view.secView.models) || null
            const eff = meta.modelRef || meta.resolvedModelRef || meta.followModelRef || ''
            const effortKey = meta.thinkingEffort || 'auto'
            const effortOpt = effortMeta(effortKey) || THINKING_EFFORT_OPTIONS.find(x => x.key === effortKey)
            const effBadge = effortOpt ? effortOpt.shortLabel : bi('自动', 'Auto')
            const rawShort = eff ? shortModelName(eff, cat, false).replace(/^deepseek[\s\-_]*/i, '').trim() : ''
            const tag = rawShort ? clampTitle(rawShort, 16) : (eff ? clampTitle(shortModelName(eff, cat, false), 16) : bi('自动', 'Auto'))
            return `${tag} · ${effBadge}`
          })()),
          (() => {
            const curRunMode = meta.stopped
              ? 'off'
              : (meta.runMode && ['off', 'patrol', 'managed'].includes(meta.runMode)
                  ? meta.runMode
                  : (meta.paceMode === 'auto' ? 'managed' : (meta.paceMode === 'smart' ? 'patrol' : 'off')))
            return h(
              'div',
              { className: 'dnb-run-mode-pill', role: 'group', 'aria-label': bi('后台运行模式', 'Background run mode') },
              RUN_MODE_OPTIONS.map(opt => {
                const rm = runModeMeta(opt.key)
                return h('button', {
                  key: opt.key,
                  type: 'button',
                  className: 'dnb-run-mode-btn',
                  'data-active': curRunMode === opt.key ? '1' : '0',
                  'data-rm': opt.key,
                  title: rm.hint || opt.hint,
                  onClick: () => {
                    if (opt.key === 'managed' && curRunMode !== 'managed') {
                      patch({ autoPilotConfirmOpen: true, secPaceMenuOpen: false })
                      return
                    }
                    patch({ secPaceMenuOpen: false })
                    void updateSecConfig({
                      runMode: opt.key,
                      ...(opt.key === 'off' ? { paceMode: 'manual', autoPilot: false } : {}),
                    })
                  },
                }, rm.shortLabel || opt.shortLabel)
              }),
            )
          })(),
          h('button', {
            type: 'button',
            className: 'dnb-icon-btn',
            'data-active': (view.voiceModeActive && !view.voiceStageMinimized) ? '1' : '0',
            style: view.voiceModeActive ? { color: 'var(--dnb-accent)' } : undefined,
            title: view.voiceModeActive
              ? bi('正在语音面聊（点击退出，快捷键 Alt+V）', 'Voice Chat Active (Alt+V to exit)')
              : bi(`一键唤起语音面聊（快捷键 Alt+V，或叫「${chiefShortName(view)}」）`, `Quick Voice Chat (Alt+V, or call "${chiefShortName(view)}")`),
            onClick: () => {
              if (typeof runtimeRefs.toggleVoiceMode === 'function') {
                void runtimeRefs.toggleVoiceMode()
              } else {
                patch({ voiceModeActive: !view.voiceModeActive, voiceStageMinimized: false })
              }
            },
          }, h(Icon, { name: 'voiceSpark', size: 15 })),
          h('button', {
            className: 'dnb-icon-btn',
            'data-active': view.searchOpen ? '1' : '0',
            title: bi('搜索或问参谋长', 'Search or ask Chief'),
            onClick: () => patch({ searchOpen: !view.searchOpen, askHits: null }),
          }, h(Icon, { name: 'search', size: 15 })),
          h('button', {
            className: 'dnb-icon-btn',
            title: bi('刷新状态', 'Refresh'),
            onClick: () => {
              void refresh()
              if (view.tab === 'archive') void loadArchives(true)
              else void loadChiefView(false)
            },
          }, h(Icon, { name: 'refresh', size: 15, style: view.busy ? { animation: 'dnb-spin 0.9s linear infinite' } : undefined })),
          h('button', {
            className: 'dnb-icon-btn',
            title: isPage ? bi('切回右侧栏', 'Switch to Right Sidebar') : bi('在主页面全屏打开', 'Open in Main Page'),
            onClick: () => {
              if (isPage) openChiefInRightbar()
              else openChiefInMainPage()
            },
          }, h(Icon, { name: isPage ? 'sidebarRight' : 'maximize', size: 14.5 })),
          h('button', {
            className: 'dnb-icon-btn',
            title: isPage ? bi('回到对话', 'Back to Chat') : bi('收起', 'Collapse'),
            onClick: () => {
              if (inConvView) {
                if (props && typeof props.openView === 'function') {
                  try {
                    props.openView('chat', '')
                    return
                  } catch {}
                }
                if (switchConversationView('chat')) return
              }
              if (closeChief()) return
              if (isPage) {
                selectPanel(null)
                return
              }
              patch({ open: false })
            },
          }, h(Icon, { name: 'x', size: 15 })),
        ),
        h(ModelPickerPopover, { view }),
      ),

      // Live Cursor Pill (only when active; clickable to spotlight advancing/blocked subagents)
      cursorText
        ? h(
            'div',
            { className: 'dnb-live-cursor-wrap', style: { padding: '0 12px 8px', flexShrink: 0 } },
            h(
              'div',
              {
                className: 'dnb-live-cursor-bar',
                'data-blocked': cursorBlocked ? '1' : '0',
                title: bi('点这里查看正在跑或卡住的子代理', 'Click to view active or blocked subagents'),
                onClick: () => {
                  const targetTask = (board.cursor.expectedTaskId && tasks.find(t => t && t.id === board.cursor.expectedTaskId))
                    || tasks.find(t => t && (cursorBlocked ? t.status === 'blocked' : t.status === 'doing'))
                  if (targetTask) focusObjectiveInPyramid(targetTask.id)
                  else patch({ tab: 'tasks', taskBoardMode: 'beam', settingsOpen: false })
                },
              },
              cursorBlocked
                ? h(Icon, { name: 'alert', size: 12.5, style: { flexShrink: 0 } })
                : h('span', { className: 'dnb-spin-ring', style: { '--dnb-spin-size': '10px', color: 'currentColor' } }),
              h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 } }, cursorText),
            ),
          )
        : null,

      // Proactive Suggestion Capsule Banner
      h(SuggestionBanner, { view }),

      h(SearchDrawer, { view }),

      // Opt-in Banner when Chief has not been activated for this session yet
      view.sessionId && meta.sessionEnabled === false
        ? h(
            'div',
            { className: 'dnb-session-optin-wrap' },
            h(
              'div',
              { className: 'dnb-session-optin-banner', role: 'status' },
              h(
                'div',
                { className: 'dnb-session-optin-text' },
                h('span', { className: 'dnb-session-optin-dot', 'aria-hidden': 'true' }),
                h('span', null, bi(
                  '本会话未启用参谋长（普通模式：不提示，也不触发安全拦截）',
                  'Chief is off in this chat (no prompts or Safety Block checks)',
                )),
              ),
              h('button', {
                type: 'button',
                className: 'dnb-primary-btn dnb-session-optin-btn',
                onClick: () => void updateSecConfig({ sessionEnabled: true }),
              }, bi('在本会话启用', 'Enable for This Session')),
            ),
          )
        : null,

      // Responsive Workspace Host (Top Classic Tabs vs Left Minimalist Rail Studio)
      h(
        'div',
        {
          className: 'dnb-workspace-host',
          'data-layout': view.navLayout || 'sidebar',
          ...(activeRailSub ? { 'data-rail-sub': activeRailSub } : {}),
        },

        // Top Segmented Tab Strip (Always visible in 'top' layout or narrow screens)
        h(
          'div',
          { className: 'dnb-seg-wrap' },
          h(
            'div',
            { className: 'dnb-seg' },
            TABS.map(tab => {
              const count = tab.key === 'tasks'
                ? openCount
                : tab.key === 'peers'
                  ? peersBadge
                  : tab.key === 'chief'
                    ? secBadge
                    : tab.key === 'archive'
                      ? archiveBadge
                      : 0
              const isSegActive = !view.settingsOpen && !view.themeOpen && (view.tab === tab.key || (tab.key === 'tasks' && view.tab === 'plan'))
              return h(
                'button',
                {
                  key: tab.key,
                  type: 'button',
                  className: 'dnb-seg-btn',
                  'data-tab': tab.key,
                  'data-active': isSegActive ? '1' : '0',
                  'aria-pressed': isSegActive ? 'true' : 'false',
                  onClick: () => patch({
                    tab: tab.key,
                    settingsOpen: false,
                    themeOpen: false,
                    secModelMenuOpen: false,
                    secPaceMenuOpen: false,
                    secPermMenuOpen: false,
                    tacticalMenuOpen: false,
                    boundMoreMenuOpen: false,
                  }),
                },
                tabLabel(tab.key) || tab.label,
                tab.key === 'extmem' && extMemBadge
                  ? h('span', {
                      className: 'dnb-seg-dot',
                      style: {
                        color: extMemDegraded ? 'var(--dnb-coral, #ff453a)' : 'var(--dnb-sage, #30d158)',
                        opacity: 1,
                        fontWeight: 700,
                      },
                    }, extMemDegraded ? '!' : '•')
                  : (count
                      ? h('span', {
                          className: 'dnb-seg-dot',
                          style: tab.key === 'chief'
                            ? { color: 'var(--dnb-accent)', opacity: 1, fontWeight: 600 }
                            : tab.key === 'archive'
                              ? { color: 'var(--dnb-amber, #f3be6d)', opacity: 1, fontWeight: 600 }
                              : undefined,
                        }, String(count))
                      : null),
              )
            }),
          ),
        ),

        // Notice & Error Banners (shared above workspace shell)
        view.staleBackendDetected && !view.staleBackendDismissed
          ? h(
              'div',
              {
                style: {
                  margin: '0 12px 8px',
                  padding: '6px 10px',
                  borderRadius: 10,
                  border: '1px solid rgba(245, 158, 11, 0.42)',
                  background: 'rgba(245, 158, 11, 0.12)',
                  color: '#f59e0b',
                  fontSize: 11.5,
                  lineHeight: 1.45,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 8,
                },
              },
              h('span', null, '⚠ 后台还在跑旧版本（面板 v' + EXPECTED_BACKEND_BUILD + (meta.backendBuild ? '，后台 v' + meta.backendBuild : '') + '），请重启 DeepSeek Harness 或重新加载插件后生效。'),
              h('span', { style: { cursor: 'pointer', paddingLeft: 6, flexShrink: 0 }, onClick: () => patch({ staleBackendDismissed: true }) }, '×'),
            )
          : null,

        view.hostCompat && view.hostCompat.present && view.hostCompat.namedSubagentsSupported === false && !view.hostCompatDismissed
          ? h(
              'div',
              {
                style: {
                  margin: '0 12px 8px',
                  padding: '6px 10px',
                  borderRadius: 10,
                  border: '1px solid rgba(245, 158, 11, 0.42)',
                  background: 'rgba(245, 158, 11, 0.12)',
                  color: '#f59e0b',
                  fontSize: 11.5,
                  lineHeight: 1.45,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 8,
                },
              },
              h('span', null, '⚠ ' + (view.hostCompat.warning || '当前 DSH 版本太旧，不支持子代理协作功能，请升级到 0.2.2-rc.2 或以上。')),
              h('span', { style: { cursor: 'pointer', paddingLeft: 6, flexShrink: 0 }, onClick: () => patch({ hostCompatDismissed: true }) }, '×'),
            )
          : null,

        view.error
          ? h(
              'div',
              {
                style: {
                  margin: '0 12px 8px',
                  padding: '6px 10px',
                  borderRadius: 10,
                  background: STATUS_BG.blocked,
                  color: '#ff453a',
                  fontSize: 11.5,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                },
              },
              h('span', null, /^failed to fetch$/i.test(String(view.error).trim())
                ? bi('与本地服务暂时断开连接，正在自动重连…', 'Temporarily disconnected from local service, reconnecting…')
                : view.error),
              h('span', { style: { cursor: 'pointer', paddingLeft: 8 }, onClick: () => patch({ error: '' }) }, '×'),
            )
          : null,

        // Two-Column Workspace Shell when 'sidebar' layout on Wide Views
        h(
          'div',
          {
            className: 'dnb-workspace-shell',
            'data-voice-stage': (view.voiceModeActive && !view.voiceStageMinimized) ? '1' : '0',
          },
          (view.navLayout || 'sidebar') === 'sidebar'
            ? h(
                'aside',
                { className: 'dnb-workspace-rail', 'aria-label': bi('主导航', 'Main Navigation') },
                h(
                  'div',
                  { className: 'dnb-workspace-rail-head' },
                  h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 650, color: 'var(--dnb-text)' } },
                    h(Icon, { name: 'sparkles', size: 13, style: { color: 'var(--dnb-accent)' } }),
                    bi('参谋工作台', 'Workspace')),
                ),
                h(
                  'div',
                  { className: 'dnb-workspace-rail-list' },
                  TABS.map(tab => {
                    const isTabCur = !view.settingsOpen && !view.themeOpen && (view.tab === tab.key || (tab.key === 'tasks' && view.tab === 'plan'))
                    const isExpanded = Boolean(expandedRailTabs[tab.key])
                    const tabIcon = tab.key === 'chief'
                      ? 'sparkles'
                      : tab.key === 'tasks'
                        ? 'list'
                        : tab.key === 'peers'
                          ? 'network'
                          : tab.key === 'archive'
                            ? 'archive'
                            : tab.key === 'extmem'
                              ? 'brain'
                              : 'sliders'
                    const count = tab.key === 'tasks'
                      ? openCount
                      : tab.key === 'peers'
                        ? peersBadge
                        : tab.key === 'chief'
                          ? secBadge
                          : tab.key === 'archive'
                            ? archiveBadge
                            : 0
                    const railSubsMap = {
                      chief: [
                        { k: 'all', zh: '全部总览', en: 'Overview' },
                        { k: 'digest', zh: '局势简报', en: 'Digest' },
                        { k: 'chat', zh: '参谋对话', en: 'Chief Q&A' },
                      ],
                      tasks: [
                        { k: 'plan', zh: '主线计划', en: 'Main Plan' },
                        { k: 'board', zh: '任务看板', en: 'Work Map' },
                        { k: 'handoff', zh: '交接流转', en: 'Handoff' },
                      ],
                      peers: [
                        { k: 'all', zh: '全部协同', en: 'All Squad' },
                        { k: 'net', zh: '协同编队', en: 'Collab Canvas' },
                        { k: 'mail', zh: '消息记录', en: 'Team Messages' },
                      ],
                      archive: [
                        { k: 'desktop', zh: '认知桌面', en: 'Desktop' },
                        { k: 'session', zh: '本局档案', en: 'Session' },
                        { k: 'global', zh: '全局档案', en: 'Global' },
                        { k: 'notes', zh: '语音手记', en: 'Voice Notes' },
                        { k: 'precipitated', zh: '冷藏档案', en: 'Cold Vault' },
                      ],
                      extmem: [
                        { k: 'book', zh: '记忆清单', en: 'Memories' },
                        ...((meta.externalMemory?.moodSlot?.enabled && meta.externalMemory?.moodSlot?.emotionSplitView)
                          ? [{ k: 'emotion', zh: '情感记忆', en: 'Emotion' }]
                          : []),
                        { k: 'profile', zh: '用户画像', en: 'Profile' },
                        { k: 'bridge', zh: '接入与设置', en: 'Setup' },
                      ],
                      boundaries: [
                        { k: 'walls', zh: '拦截墙', en: 'Block Rules' },
                        { k: 'rules', zh: '行为规矩', en: 'AI Rules' },
                        { k: 'env', zh: '运行环境', en: 'Runtime' },
                      ],
                    }
                    const subList = isExpanded ? (railSubsMap[tab.key] || []) : []
                    const isSubActive = (subKey) => {
                      if (!isTabCur) return false
                      if (tab.key === 'chief') return (view.chiefSubTab || 'all') === subKey
                      if (tab.key === 'tasks') return (view.tasksSubTab || 'plan') === subKey
                      if (tab.key === 'peers') return (view.peersSubTab || 'all') === subKey
                      if (tab.key === 'archive') return (view.archiveTabScope || 'desktop') === subKey
                      if (tab.key === 'extmem') {
                        const rawSub = view.extMemSubTab || 'book'
                        const splitOn = Boolean(meta.externalMemory?.moodSlot?.enabled && meta.externalMemory?.moodSlot?.emotionSplitView)
                        let effSub = rawSub
                        if (rawSub === 'sky' || rawSub === 'diary' || (rawSub === 'emotion' && !splitOn)) effSub = 'book'
                        else if (rawSub === 'prompts' || rawSub === 'probe' || rawSub === 'curve') effSub = 'bridge'
                        return effSub === subKey
                      }
                      if (tab.key === 'boundaries') return (view.boundSubTab || 'walls') === subKey
                      return false
                    }
                    const handleSubClick = (subKey) => {
                      if (tab.key === 'chief') {
                        const patchObj = { tab: 'chief', settingsOpen: false, themeOpen: false, chiefSubTab: subKey }
                        if (subKey === 'all') {
                          patchObj.chiefDigestCollapsed = false
                        } else if (subKey === 'digest') {
                          patchObj.chiefDigestCollapsed = false
                        }
                        patch(patchObj)
                        scrollWorkspaceSection(subKey === 'chat' ? 'chief-chat' : 'chief-digest')
                        return
                      }
                      if (tab.key === 'tasks') {
                        const patchObj = { tab: 'tasks', settingsOpen: false, themeOpen: false, tasksSubTab: subKey }
                        if (subKey === 'plan') patchObj.planObjCollapsed = false
                        if (subKey === 'board') patchObj.boardSectionCollapsed = false
                        if (subKey === 'handoff') patchObj.handoffSectionCollapsed = false
                        patch(patchObj)
                        scrollWorkspaceSection(`tasks-${subKey}`)
                        return
                      }
                      if (tab.key === 'peers') {
                        const patchObj = { tab: 'peers', settingsOpen: false, themeOpen: false, peersSubTab: subKey }
                        if (subKey === 'all') {
                          patchObj.peersNetCollapsed = false
                          patchObj.peersMailCollapsed = false
                        } else if (subKey === 'net') {
                          patchObj.peersNetCollapsed = false
                        } else if (subKey === 'mail') {
                          patchObj.peersMailCollapsed = false
                        }
                        patch(patchObj)
                        scrollWorkspaceSection(subKey === 'mail' ? 'peers-mail' : 'peers-net')
                        return
                      }
                      if (tab.key === 'archive') {
                        patch({ tab: 'archive', settingsOpen: false, themeOpen: false, archiveTabScope: subKey })
                        if (subKey === 'notes') {
                          void loadArchives(false, '', 'global')
                          if (view.sessionId) void loadArchives(false, '', 'session')
                        } else {
                          void loadArchives(false)
                        }
                        return
                      }
                      if (tab.key === 'extmem') {
                        patch({ tab: 'extmem', settingsOpen: false, themeOpen: false, extMemSubTab: subKey })
                        return
                      }
                      if (tab.key === 'boundaries') {
                        const patchObj = { tab: 'boundaries', settingsOpen: false, themeOpen: false, boundSubTab: subKey }
                        if (subKey === 'walls') patchObj.wallCollapsed = false
                        if (subKey === 'rules') patchObj.boundCollapsedCols = {}
                        patch(patchObj)
                        scrollWorkspaceSection(`bound-${subKey}`)
                      }
                    }
                    return h(
                      React.Fragment,
                      { key: tab.key },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'dnb-workspace-nav-btn',
                          'data-active': isTabCur ? '1' : '0',
                          onClick: () => {
                            if (isTabCur) {
                              setExpandedRailTabs(prev => ({ [tab.key]: !prev[tab.key] }))
                              return
                            }
                            patch({
                              tab: tab.key,
                              settingsOpen: false,
                              themeOpen: false,
                              secModelMenuOpen: false,
                              secPaceMenuOpen: false,
                              secPermMenuOpen: false,
                              tacticalMenuOpen: false,
                              boundMoreMenuOpen: false,
                            })
                            setExpandedRailTabs({ [tab.key]: true })
                          },
                        },
                        h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 0 } },
                          h(Icon, { name: tabIcon, size: 13.5 }),
                          h('span', null, tabLabel(tab.key) || tab.label)),
                        h(
                          'span',
                          { style: { display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0 } },
                          tab.key === 'extmem' && extMemBadge
                            ? h('span', {
                                style: {
                                  width: 6.5,
                                  height: 6.5,
                                  borderRadius: '50%',
                                  background: extMemDegraded ? 'var(--dnb-coral, #ff453a)' : 'var(--dnb-sage, #30d158)',
                                },
                              })
                            : (count ? h('span', { className: 'dnb-workspace-rail-badge' }, String(count)) : null),
                          h('span', { className: 'dnb-workspace-chevron', 'data-open': isExpanded ? '1' : '0' },
                            h(Icon, { name: 'chevron', size: 10.5 })),
                        ),
                      ),
                      subList.length > 0
                        ? h(
                            'div',
                            { className: 'dnb-workspace-subnav' },
                            subList.map(sub =>
                              h('button', {
                                key: sub.k,
                                type: 'button',
                                className: 'dnb-workspace-sub-btn',
                                'data-active': isSubActive(sub.k) ? '1' : '0',
                                onClick: () => handleSubClick(sub.k),
                              }, bi(sub.zh, sub.en))),
                          )
                        : null,
                    )
                  }),
                ),
                h(
                  'div',
                  { className: 'dnb-workspace-rail-foot' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dnb-workspace-nav-btn',
                      'data-active': view.themeOpen ? '1' : '0',
                      onClick: e => {
                        e.stopPropagation()
                        if (view.themeOpen) patch({ themeOpen: false })
                        else openThemeStudio()
                      },
                    },
                    h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 7 } },
                      h(Icon, { name: 'palette', size: 13 }),
                      bi('外观主题', 'Appearance')),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dnb-workspace-nav-btn',
                      'data-active': view.settingsOpen ? '1' : '0',
                      onClick: () => {
                        patch({ settingsOpen: !view.settingsOpen, themeOpen: false })
                      },
                    },
                    h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 7 } },
                      h(Icon, { name: 'settings', size: 13 }),
                      bi('偏好设置', 'Settings')),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dnb-workspace-nav-btn',
                      onClick: () => {
                        saveNavLayout('top')
                        patch({ notice: bi('已切回顶部经典标签排列', 'Switched to Top Classic Tabs') })
                      },
                    },
                    h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 7, color: 'var(--dnb-text-3)' } },
                      h(Icon, { name: 'sliders', size: 12.5 }),
                      bi('切回顶部栏', 'Use Top Tabs')),
                  ),
                ),
              )
            : null,

          // Tab Body Protected by Error Boundary + Inline Screen Voice Stage (no global blur overlay)
          (() => {
            const showVoiceStage = Boolean(view.voiceModeActive && !view.voiceStageMinimized)
            return h(
              'div',
              {
                className: 'dnb-body',
                style: showVoiceStage
                  ? { display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }
                  : undefined,
              },
              showVoiceStage ? h(ChiefVoiceModeStage, { view }) : null,
              h(
                'div',
                { style: showVoiceStage ? { display: 'none' } : undefined },
                h(ChiefErrorBoundary, { key: view.tab + ':' + (view.sessionId || 'none') }, body),
              ),
            )
          })(),
        ),
      ),

      // Persistent Bottom Chief Input & Relay Bar
      h(ChiefComposerBar, { view, barRef: secBarRef }),

      // Chief System Active Working Stage FX Overlay (suppressed while inline Voice Stage is open)
      h(ChiefWorkStageOverlay, {
        fx: (view.voiceModeActive && !view.voiceStageMinimized)
          ? null
          : (view.chiefWorkFx || (meta && meta.activeWork) || null),
      }),

      // Scoped Modal Overlays (Strictly bounded inside .dnb-panel)
      h(ChiefRiskConfirmModal, { view }),
      h(SafetyGuardConfirmModal, { view }),
      h(OperationApprovalModal, { view }),
      h(ElevationRequestModal, { view }),
      h(AuditLogModal, { view }),
      h(InterventionConfirmModal, { view, board }),
      h(HazardHaltModal, { view }),
      h(UnlimitedTurnsConfirmModal, { view }),
      h(AutoPilotConfirmModal, { view }),
      h(AwayPresetConfirmModal, { view }),
      h(ArchiveRelayModal, { view }),
      h(DistillToGlobalModal, { view }),
      h(ChiefAdviceModal, { view }),
      h(PrecipitateConfirmModal, { view }),
      h(PeerLinkConfirmModal, { view }),
      h(HandoffWarnModal, { view }),
      h(CustomThemeModal, { view }),

      // Floating iOS Toast
      view.notice ? h('div', { className: 'dnb-toast' }, view.notice) : null,
    ),
  )
}

export function Panel(props) {
  return h(ChiefErrorBoundary, null, h(PanelInner, props))
}

/* -------------------------------------------------- Session & Triggers */

function useIsSubagentSession(sessionId) {
  const [isSub, setIsSub] = React.useState(isSubagentSessionId(sessionId))
  React.useEffect(() => {
    const check = () => {
      const next = isSubagentSessionId(sessionId)
      setIsSub(prev => (prev === next ? prev : next))
    }
    check()
    const unsubStore = subscribe(check)
    const sessions = service('sessions')
    let unsubSessions = null
    try {
      if (sessions && sessions.list && typeof sessions.list.subscribe === 'function') {
        unsubSessions = sessions.list.subscribe(check)
      } else if (sessions && typeof sessions.subscribe === 'function') {
        unsubSessions = sessions.subscribe(check)
      }
    } catch {}
    return () => {
      unsubStore()
      if (typeof unsubSessions === 'function') {
        try { unsubSessions() } catch {}
      }
    }
  }, [sessionId])
  return isSub
}

export function SessionProbe(props) {
  const sessionId = props && props.sessionId ? String(props.sessionId) : ''
  const inputActions = props ? props.inputActions : null
  const isSubagent = useIsSubagentSession(sessionId)
  React.useEffect(() => {
    if (!sessionId || isSubagent) {
      adoptSession('header', '')
      return undefined
    }
    adoptSession('header', sessionId, inputActions)
    return () => adoptSession('header', '')
  }, [sessionId, inputActions, isSubagent])
  return null
}

function useDockShown() {
  const view = useStore()
  const [expanded, setExpanded] = React.useState(() => rightbarExpanded())
  React.useEffect(() => {
    const read = () => {
      const next = rightbarExpanded()
      setExpanded(prev => (prev === next ? prev : next))
    }
    read()
    const timer = setInterval(read, DOCK_POLL_MS)
    return () => clearInterval(timer)
  }, [])
  return !!(view.dock && expanded)
}

export function ChiefIcon(props) {
  const size = props && typeof props.size === 'number' && props.size > 0 ? props.size : 18
  const active = !!(props && props.active)
  return h(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: active ? 2 : 1.65,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
      focusable: false,
      style: { display: 'block' },
    },
    h('path', { d: 'M13 3.5H7.5A2.5 2.5 0 0 0 5 6v12a2.5 2.5 0 0 0 2.5 2.5h9A2.5 2.5 0 0 0 19 18v-5.5' }),
    h('path', { d: 'M8.5 10h5.5M8.5 13.5h7M8.5 17h4' }),
    h('path', { d: 'M18 3l.9 2.1L21 6l-2.1.9L18 9l-.9-2.1L15 6l2.1-.9L18 3z' }),
  )
}

function TriggerButton(props) {
  const view = useStore()
  const tasks = (view.board && Array.isArray(view.board.tasks)) ? view.board.tasks : []
  const openCount = tasks.filter(t => t && t.status !== 'done').length
  const pendingSug = (view.chiefMeta && view.chiefMeta.pendingSuggestions) || 0
  const badgeCount = openCount + pendingSug
  const dockShown = useDockShown()
  const showing = view.panel === SIDE_ID || dockShown
  const compact = !!(props && props.compact)
  return h(
    'button',
    {
      className: 'dnb-btn',
      'data-active': showing || view.open ? '1' : '0',
      title: (showing || view.open) ? (bi('收起 ', 'Collapse ') + bi(BRAND_NAME, 'DSH Chief')) : (bi('打开 ', 'Open ') + bi(BRAND_NAME, 'DSH Chief')),
      'aria-label': bi(BRAND_NAME, 'DSH Chief'),
      'aria-expanded': showing || view.open ? 'true' : 'false',
      onClick: () => {
        toggleChief()
      },
    },
    h(ChiefIcon, { size: 16, active: showing || view.open }),
    compact ? null : h('span', null, bi(BRAND_NAME, 'DSH Chief')),
    badgeCount ? h('span', { className: 'dnb-count' }, String(badgeCount)) : null,
  )
}

export function ComposerEntry(props) {
  const view = useStore()
  const sessionId = props && props.sessionId ? String(props.sessionId) : ''
  const inputActions = props ? props.inputActions : null
  const isSubagent = useIsSubagentSession(sessionId)
  React.useEffect(() => {
    if (!sessionId || isSubagent) {
      adoptSession('composer', '')
      return undefined
    }
    adoptSession('composer', sessionId, inputActions)
    return () => adoptSession('composer', '')
  }, [sessionId, inputActions, isSubagent])
  const pref = view.placementPref || {}
  if (isSubagent && pref.hideInSubagent !== false) return null
  if (pref.showComposerEntry === false) return null
  return h(React.Fragment, null, h(Style, null), h(TriggerButton, { compact: true }))
}

export function CornerTrigger() {
  const view = useStore()
  const dockShown = useDockShown()
  const urlSid = sessionIdFromUrl()
  const isSubagent = useIsSubagentSession(urlSid)
  const placement = (view.placementPref && view.placementPref.placement) || 'both'
  const showCorner = (view.placementPref && view.placementPref.showCornerTrigger) !== false
  const hideSub = (view.placementPref && view.placementPref.hideInSubagent) !== false
  const showing = view.open || view.convView || view.panel === SIDE_ID || dockShown || (placement === 'topTab' && Boolean(urlSid || view.sessionId))
  if (!showCorner || showing || (isSubagent && hideSub)) return null
  return h(
    'button',
    {
      className: 'dnb-btn',
      title: '打开 ' + BRAND_NAME,
      'aria-label': BRAND_NAME,
      onClick: () => {
        if (!urlSid && !view.sessionId) {
          if (selectPanel(SIDE_ID)) {
            setTimeout(() => {
              if (!store.panel && !store.open && !store.convView) patch({ open: true })
            }, 110)
            return
          }
          patch({ open: true })
          return
        }
        if (openChief()) return
        patch({ open: true })
      },
      style: {
        position: 'fixed',
        right: '20px',
        bottom: '20px',
        zIndex: 30,
        width: '34px',
        height: '34px',
        borderRadius: '17px',
        border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,136,0.25))',
        background: 'var(--dsw-alias-bg-elevated, rgba(38,38,42,0.9))',
        backdropFilter: 'blur(12px)',
        boxShadow: '0 4px 14px rgba(0,0,0,0.2)',
        color: 'var(--dsw-alias-label-primary)',
      },
    },
    h(ChiefIcon, { size: 17 }),
  )
}

export function MainPanel() {
  React.useEffect(() => {
    patch({ panel: SIDE_ID })
    return () => {
      if (store.panel === SIDE_ID) patch({ panel: '' })
    }
  }, [])
  return h('div', { className: 'dnb-page' }, h(Panel, { variant: 'main' }))
}

export function ConversationChiefView(props) {
  const view = useStore()
  const sessionId = props && props.sessionId ? String(props.sessionId) : ''
  const inputActions = props ? props.inputActions : null
  const openView = props && typeof props.openView === 'function' ? props.openView : null
  const isSubagent = useIsSubagentSession(sessionId)
  const [allowSubPreview, setAllowSubPreview] = React.useState(false)

  React.useEffect(() => {
    runtimeRefs.convViewOpenView = openView
    patch({ convView: true })
    return () => {
      if (runtimeRefs.convViewOpenView === openView) runtimeRefs.convViewOpenView = null
      if (store.convView) patch({ convView: false })
    }
  }, [openView])

  React.useEffect(() => {
    if (!sessionId || isSubagent) {
      adoptSession('conv-view', '')
      return undefined
    }
    adoptSession('conv-view', sessionId, inputActions)
    return () => adoptSession('conv-view', '')
  }, [sessionId, inputActions, isSubagent])

  const hideSub = (view.placementPref && view.placementPref.hideInSubagent) !== false
  if (isSubagent && hideSub && !allowSubPreview) {
    return h(
      'div',
      {
        className: 'dnb-page dnb-conv-page',
        'data-conversation-composer-overlay': '',
        'data-dnb-conv-view': '1',
        style: { alignItems: 'center', justifyContent: 'center', padding: 24 },
      },
      h(Style, null),
      h(
        'div',
        {
          className: 'dnb-group',
          style: { maxWidth: 420, padding: '18px 20px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 10 },
        },
        h('div', { style: { fontSize: 13.5, fontWeight: 600, color: 'var(--dnb-text)' } },
          bi('当前处于子代理会话窗口', 'This is a subagent chat window')),
        h('div', { style: { fontSize: 12, color: 'var(--dnb-text-2)', lineHeight: 1.55 } },
          bi('为避免混淆各子代理进度，DSH 参谋长主页面默认只在主对话窗口绑定展示。', 'To keep main-session state clean, DSH Chief binds to your primary conversation by default.')),
        h(
          'div',
          { style: { display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4 } },
          openView
            ? h('button', {
                type: 'button',
                className: 'dnb-primary-btn',
                onClick: () => openView('chat', ''),
              }, bi('返回子代理对话', 'Back to Chat'))
            : null,
          h('button', {
            type: 'button',
            className: 'dnb-pill',
            onClick: () => setAllowSubPreview(true),
          }, bi('仍在此查看主会话看板', 'View Main Board Anyway')),
        ),
      ),
    )
  }

  return h(
    'div',
    {
      className: 'dnb-page dnb-conv-page',
      'data-conversation-composer-overlay': '',
      'data-dnb-conv-view': '1',
    },
    h(Panel, { variant: 'main', inConversationView: true, openView }),
  )
}

export function SidebarChiefTab(props) {
  const sessionId = props && props.sessionId ? String(props.sessionId) : ''
  const isSubagent = useIsSubagentSession(sessionId)
  React.useEffect(() => {
    runtimeRefs.dockMountCount += 1
    patch({ dock: true })
    return () => {
      runtimeRefs.dockMountCount = Math.max(0, runtimeRefs.dockMountCount - 1)
      if (runtimeRefs.dockMountCount === 0 && store.dock) patch({ dock: false })
    }
  }, [])
  React.useEffect(() => {
    if (!sessionId || isSubagent) {
      adoptSession('dock', '')
      return undefined
    }
    adoptSession('dock', sessionId, null)
    return () => adoptSession('dock', '')
  }, [sessionId, isSubagent])
  return h('div', { className: 'dnb-page dnb-dock-page' }, h(Panel, { variant: 'dock' }))
}
