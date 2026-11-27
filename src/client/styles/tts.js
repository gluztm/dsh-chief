/**
 * src/client/styles/tts.js — 参谋长 TTS 语音播报与设置工作台双模样式
 */

export const CSS_TTS = `
  .dnb-panel[data-dnb-skin] .dnb-reply-summary-row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
  }
  .dnb-panel[data-dnb-skin] .dnb-reply-summary-row .dnb-reply-summary-btn {
    flex: 1;
    min-width: 0;
  }
  .dnb-panel[data-dnb-skin] .dnb-tts-btn {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    height: 21px;
    padding: 0 6px;
    border-radius: 999px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--dnb-text-3);
    font-size: 10.5px;
    line-height: 1;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.14s ease, color 0.14s ease, border-color 0.14s ease;
  }
  .dnb-panel[data-dnb-skin] .dnb-tts-btn:hover {
    background: var(--dnb-hover);
    color: var(--dnb-accent);
    border-color: var(--dnb-border);
  }
  .dnb-panel[data-dnb-skin] .dnb-tts-btn[data-active="1"] {
    background: var(--dnb-accent-soft);
    color: var(--dnb-accent);
    border-color: var(--dnb-accent);
  }
  .dnb-panel[data-dnb-skin] .dnb-tts-head-btn {
    color: var(--dnb-accent);
    background: var(--dnb-accent-soft);
    border-color: var(--dnb-accent);
  }
  .dnb-panel[data-dnb-skin] .dnb-tts-nowbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 5px 10px;
    margin-bottom: 6px;
    border-radius: 10px;
    border: 1px solid var(--dnb-border-strong);
    background: var(--dnb-accent-soft);
    color: var(--dnb-text);
    font-size: 11px;
  }
  .dnb-panel[data-dnb-skin] .dnb-tts-nowbar-left {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    flex: 1;
  }
  .dnb-panel[data-dnb-skin] .dnb-tts-nowbar-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }
  .dnb-panel[data-dnb-skin] .dnb-tts-nowbar-tag {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--dnb-surface-2, rgba(127, 127, 127, 0.12));
    color: var(--dnb-text-2);
    flex-shrink: 0;
  }
  .dnb-panel[data-dnb-skin] .dnb-tts-wave {
    display: inline-flex;
    align-items: flex-end;
    gap: 2px;
    height: 11px;
    flex-shrink: 0;
  }
  .dnb-panel[data-dnb-skin] .dnb-tts-wave > span {
    width: 2px;
    height: 4px;
    border-radius: 2px;
    background: var(--dnb-accent);
    animation: dnb-tts-eq 0.9s ease-in-out infinite;
  }
  .dnb-panel[data-dnb-skin] .dnb-tts-wave > span:nth-child(2) {
    height: 9px;
    animation-delay: 0.18s;
  }
  .dnb-panel[data-dnb-skin] .dnb-tts-wave > span:nth-child(3) {
    height: 6px;
    animation-delay: 0.36s;
  }
  @keyframes dnb-tts-eq {
    0%, 100% { transform: scaleY(0.5); opacity: 0.75; }
    50% { transform: scaleY(1.25); opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .dnb-panel[data-dnb-skin] .dnb-tts-wave > span {
      animation: none;
    }
  }
  .dnb-panel[data-dnb-skin] .dnb-tts-field-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 7px;
  }
  .dnb-panel[data-dnb-skin] .dnb-tts-status-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 8px;
    border-radius: 8px;
    font-size: 11px;
    border: 1px solid var(--dnb-border);
    background: var(--dnb-surface-2, rgba(127, 127, 127, 0.08));
    color: var(--dnb-text-2);
  }
  .dnb-panel[data-dnb-skin] .dnb-tts-status-pill[data-tone="green"] {
    border-color: var(--dnb-sage);
    background: rgba(48, 209, 88, 0.1);
    color: var(--dnb-sage);
  }
  .dnb-panel[data-dnb-skin] .dnb-tts-status-pill[data-tone="amber"] {
    border-color: var(--dnb-amber);
    background: var(--dnb-amber-soft);
    color: var(--dnb-amber);
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-btn {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: 1px solid transparent;
    border-radius: 50%;
    background: transparent;
    color: var(--dnb-text-3);
    cursor: pointer;
    flex-shrink: 0;
    transition: background-color 0.14s ease, color 0.14s ease, border-color 0.14s ease, transform 0.14s ease;
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-btn:hover:not(:disabled) {
    background: var(--dnb-surface-2, rgba(127, 127, 127, 0.12));
    color: var(--dnb-text);
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-btn:disabled {
    opacity: 0.42;
    cursor: not-allowed;
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-btn[data-recording="1"] {
    background: rgba(239, 68, 68, 0.16);
    border-color: rgba(239, 68, 68, 0.55);
    color: #ef4444;
    animation: dnb-voice-pulse 1.25s ease-in-out infinite;
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-btn[data-active="1"] {
    background: var(--dnb-accent-soft, rgba(99, 102, 241, 0.16));
    border-color: var(--dnb-accent);
    color: var(--dnb-accent);
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-btn[data-wake="1"] {
    background: var(--dnb-sage-soft, rgba(45, 212, 191, 0.14));
    border-color: var(--dnb-sage, #2dd4bf);
    color: var(--dnb-sage, #2dd4bf);
  }
  @keyframes dnb-voice-pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.35); }
    50% { box-shadow: 0 0 0 5px rgba(239, 68, 68, 0); }
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-rec-strip {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 11px;
    margin-bottom: 6px;
    border-radius: 13px;
    border: 1px solid rgba(239, 68, 68, 0.44);
    background: linear-gradient(135deg, rgba(239, 68, 68, 0.16), rgba(245, 158, 11, 0.1));
    backdrop-filter: blur(16px) saturate(1.45);
    -webkit-backdrop-filter: blur(16px) saturate(1.45);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.16), 0 8px 22px rgba(0, 0, 0, 0.16);
    font-size: 11.5px;
    color: var(--dnb-text);
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-mode-dock {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 11px;
    margin-bottom: 6px;
    border-radius: 13px;
    border: 1px solid rgba(99, 102, 241, 0.48);
    background: linear-gradient(135deg, rgba(99, 102, 241, 0.18), rgba(56, 189, 248, 0.12));
    backdrop-filter: blur(16px) saturate(1.45);
    -webkit-backdrop-filter: blur(16px) saturate(1.45);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.16), 0 8px 24px rgba(0, 0, 0, 0.16);
    font-size: 11.5px;
    color: var(--dnb-text);
  }
  .dnb-panel[data-dnb-skin] .dnb-sec-shell[data-voice-mode="1"] {
    border-color: var(--dnb-accent);
    box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.25), 0 6px 22px rgba(99, 102, 241, 0.16);
  }
  .dnb-panel[data-dnb-skin] .dnb-workspace-shell {
    position: relative;
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-stage {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 100%;
    flex: 1 1 auto;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 20px 16px;
    overflow: hidden;
    background: var(--dnb-bg);
    color: var(--dnb-text);
    animation: dnb-enter 0.2s cubic-bezier(0.22, 1, 0.36, 1);
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-stage-glow {
    position: absolute;
    inset: -12%;
    pointer-events: none;
    filter: blur(42px);
    opacity: 0.34;
    background:
      radial-gradient(circle at 28% 24%, rgba(56, 189, 248, 0.24), transparent 45%),
      radial-gradient(circle at 76% 74%, rgba(168, 85, 247, 0.24), transparent 46%);
    transition: background 0.35s ease, opacity 0.35s ease;
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-stage[data-state="recording"] .dnb-voice-stage-glow {
    background:
      radial-gradient(circle at 30% 28%, rgba(244, 63, 94, 0.34), transparent 46%),
      radial-gradient(circle at 72% 72%, rgba(251, 146, 60, 0.3), transparent 48%);
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-stage[data-state="speaking"] .dnb-voice-stage-glow {
    background:
      radial-gradient(circle at 26% 30%, rgba(45, 212, 191, 0.32), transparent 46%),
      radial-gradient(circle at 74% 68%, rgba(99, 102, 241, 0.34), transparent 48%);
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-stage[data-state="thinking"] .dnb-voice-stage-glow {
    background:
      radial-gradient(circle at 50% 42%, rgba(129, 140, 248, 0.34), transparent 52%),
      radial-gradient(circle at 30% 72%, rgba(56, 189, 248, 0.26), transparent 46%);
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-orb-wrap {
    position: relative;
    width: 146px;
    height: 146px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-orb-ring,
  .dnb-panel[data-dnb-skin] .dnb-voice-orb-ring-2 {
    position: absolute;
    inset: 14px;
    border-radius: 50%;
    border: 1.5px solid rgba(129, 140, 248, 0.42);
    opacity: 0;
    pointer-events: none;
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-stage[data-state="recording"] .dnb-voice-orb-ring,
  .dnb-panel[data-dnb-skin] .dnb-voice-stage[data-state="recording"] .dnb-voice-orb-ring-2 {
    border-color: rgba(251, 113, 133, 0.62);
    animation: dnb-voice-ring-out 2s cubic-bezier(0.2, 0.7, 0.3, 1) infinite;
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-stage[data-state="speaking"] .dnb-voice-orb-ring,
  .dnb-panel[data-dnb-skin] .dnb-voice-stage[data-state="speaking"] .dnb-voice-orb-ring-2 {
    border-color: rgba(56, 189, 248, 0.58);
    animation: dnb-voice-ring-out 2.2s cubic-bezier(0.2, 0.7, 0.3, 1) infinite;
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-stage .dnb-voice-orb-ring-2 {
    animation-delay: 1s;
  }
  @keyframes dnb-voice-ring-out {
    0% { transform: scale(0.95); opacity: 0.72; }
    100% { transform: scale(1.48); opacity: 0; }
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-orb {
    position: relative;
    width: 118px;
    height: 118px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.28);
    padding: 0;
    cursor: pointer;
    overflow: visible;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(15, 23, 42, 0.28);
    transform: scale(calc(1 + var(--voice-lv, 0) * 0.14));
    transition: transform 0.12s ease-out, box-shadow 0.25s ease, border-color 0.25s ease;
    box-shadow: 0 12px 38px rgba(79, 70, 229, 0.32), inset 0 1px 2px rgba(255, 255, 255, 0.36);
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-orb:hover:not(:disabled) {
    border-color: rgba(255, 255, 255, 0.5);
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-orb:disabled {
    cursor: wait;
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-orb-halo {
    position: absolute;
    inset: -18px;
    border-radius: 50%;
    background: conic-gradient(from 0deg, #6366f1, #38bdf8, #a855f7, #6366f1);
    filter: blur(26px);
    opacity: 0.56;
    pointer-events: none;
    animation: dnb-voice-swirl 8s linear infinite;
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-stage[data-state="recording"] .dnb-voice-orb-halo {
    background: conic-gradient(from 0deg, #f43f5e, #fb923c, #ec4899, #f43f5e);
    opacity: 0.72;
    animation-duration: 3.6s;
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-stage[data-state="speaking"] .dnb-voice-orb-halo {
    background: conic-gradient(from 0deg, #2dd4bf, #38bdf8, #818cf8, #c084fc, #2dd4bf);
    opacity: 0.72;
    animation-duration: 4.5s;
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-stage[data-state="thinking"] .dnb-voice-orb-halo {
    background: conic-gradient(from 0deg, #818cf8, #e0e7ff, #38bdf8, #818cf8);
    opacity: 0.65;
    animation-duration: 2.2s;
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-orb-blobs {
    position: absolute;
    inset: 3px;
    border-radius: 50%;
    overflow: hidden;
    pointer-events: none;
    background: radial-gradient(circle at 32% 28%, rgba(255, 255, 255, 0.24), rgba(15, 23, 42, 0.42));
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-orb-blob-a,
  .dnb-panel[data-dnb-skin] .dnb-voice-orb-blob-b,
  .dnb-panel[data-dnb-skin] .dnb-voice-orb-blob-c {
    position: absolute;
    border-radius: 50%;
    filter: blur(18px);
    mix-blend-mode: screen;
    opacity: 0.9;
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-orb-blob-a {
    width: 82px;
    height: 82px;
    top: -12px;
    left: -10px;
    background: #6366f1;
    animation: dnb-voice-float-a 6.5s ease-in-out infinite alternate;
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-orb-blob-b {
    width: 78px;
    height: 78px;
    bottom: -14px;
    right: -12px;
    background: #38bdf8;
    animation: dnb-voice-float-b 5.4s ease-in-out infinite alternate;
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-orb-blob-c {
    width: 68px;
    height: 68px;
    top: 26px;
    left: 28px;
    background: #a855f7;
    animation: dnb-voice-float-c 7.2s ease-in-out infinite alternate;
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-stage[data-state="recording"] .dnb-voice-orb-blob-a { background: #f43f5e; animation-duration: 2.8s; }
  .dnb-panel[data-dnb-skin] .dnb-voice-stage[data-state="recording"] .dnb-voice-orb-blob-b { background: #fb923c; animation-duration: 2.4s; }
  .dnb-panel[data-dnb-skin] .dnb-voice-stage[data-state="recording"] .dnb-voice-orb-blob-c { background: #f472b6; animation-duration: 3.1s; }
  .dnb-panel[data-dnb-skin] .dnb-voice-stage[data-state="speaking"] .dnb-voice-orb-blob-a { background: #2dd4bf; animation-duration: 3.2s; }
  .dnb-panel[data-dnb-skin] .dnb-voice-stage[data-state="speaking"] .dnb-voice-orb-blob-b { background: #38bdf8; animation-duration: 2.9s; }
  .dnb-panel[data-dnb-skin] .dnb-voice-stage[data-state="speaking"] .dnb-voice-orb-blob-c { background: #a78bfa; animation-duration: 3.6s; }
  .dnb-panel[data-dnb-skin] .dnb-voice-stage[data-state="thinking"] .dnb-voice-orb-blob-a { background: #818cf8; animation-duration: 1.7s; }
  .dnb-panel[data-dnb-skin] .dnb-voice-stage[data-state="thinking"] .dnb-voice-orb-blob-b { background: #60a5fa; animation-duration: 1.5s; }
  .dnb-panel[data-dnb-skin] .dnb-voice-stage[data-state="thinking"] .dnb-voice-orb-blob-c { background: #e879f9; animation-duration: 1.9s; }
  @keyframes dnb-voice-swirl {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  @keyframes dnb-voice-float-a {
    from { transform: translate(0px, 0px) scale(1); }
    to { transform: translate(26px, 22px) scale(1.18); }
  }
  @keyframes dnb-voice-float-b {
    from { transform: translate(0px, 0px) scale(1.06); }
    to { transform: translate(-24px, -20px) scale(0.92); }
  }
  @keyframes dnb-voice-float-c {
    from { transform: translate(-12px, 8px) scale(0.92); }
    to { transform: translate(16px, -16px) scale(1.16); }
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-orb-glass {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    background:
      radial-gradient(circle at 32% 24%, rgba(255, 255, 255, 0.44), rgba(255, 255, 255, 0.06) 44%, rgba(0, 0, 0, 0.14) 100%);
    box-shadow: inset 0 2px 6px rgba(255, 255, 255, 0.34), inset 0 -6px 14px rgba(15, 23, 42, 0.35);
    pointer-events: none;
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-orb-core {
    position: relative;
    z-index: 2;
    color: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.36));
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-stage-title {
    position: relative;
    z-index: 2;
    font-size: 14px;
    font-weight: 700;
    color: #f8fafc;
    text-shadow: 0 2px 10px rgba(0, 0, 0, 0.42);
    text-align: center;
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-stage-sub {
    position: relative;
    z-index: 2;
    font-size: 11.5px;
    color: rgba(226, 232, 240, 0.86);
    text-align: center;
    max-width: 90%;
  }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-voice-stage-title,
  html[data-ds-theme="light"] .dnb-panel[data-dnb-skin] .dnb-voice-stage-title,
  [data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-voice-stage-title {
    color: #0f172a;
    text-shadow: 0 1px 6px rgba(255, 255, 255, 0.72);
  }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-voice-stage-sub,
  html[data-ds-theme="light"] .dnb-panel[data-dnb-skin] .dnb-voice-stage-sub,
  [data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-voice-stage-sub {
    color: rgba(30, 41, 59, 0.82);
  }
  @media (prefers-color-scheme: light) {
    html:not([data-ds-theme-source="dark"]):not([data-ds-theme="dark"]) .dnb-panel[data-dnb-skin] .dnb-voice-stage-title {
      color: #0f172a;
      text-shadow: 0 1px 6px rgba(255, 255, 255, 0.72);
    }
    html:not([data-ds-theme-source="dark"]):not([data-ds-theme="dark"]) .dnb-panel[data-dnb-skin] .dnb-voice-stage-sub {
      color: rgba(30, 41, 59, 0.82);
    }
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-caption {
    position: relative;
    z-index: 2;
    max-width: min(92%, 440px);
    max-height: 112px;
    overflow-y: auto;
    padding: 9px 14px;
    border-radius: 14px;
    border: 1px solid var(--dnb-border-strong, var(--dnb-border));
    background: var(--dnb-card);
    color: var(--dnb-text);
    font-size: 12.5px;
    line-height: 1.55;
    text-align: center;
    box-shadow: var(--dnb-skin-shadow, 0 6px 20px rgba(0, 0, 0, 0.12));
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-stage-actions {
    position: relative;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-stage-pill-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 12px;
    border-radius: 999px;
    border: 1px solid var(--dnb-border-strong, var(--dnb-border));
    background: var(--dnb-card);
    color: var(--dnb-text);
    font-size: 11.5px;
    font-weight: 500;
    cursor: pointer;
    transition: transform 0.14s ease, background-color 0.14s ease, border-color 0.14s ease;
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-stage-pill-btn:hover {
    background: var(--dnb-card-hover, var(--dnb-surface-2));
    border-color: var(--dnb-accent);
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-stage-pill-btn[data-active="1"] {
    border-color: var(--dnb-accent);
    background: var(--dnb-accent-soft, rgba(99, 102, 241, 0.18));
    color: var(--dnb-accent);
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-handoff-card {
    position: relative;
    z-index: 2;
    max-width: min(92%, 440px);
    width: 100%;
    padding: 9px 12px;
    border-radius: 13px;
    border: 1px solid var(--dnb-accent);
    background: var(--dnb-card);
    color: var(--dnb-text);
    display: flex;
    flex-direction: column;
    gap: 7px;
    box-shadow: var(--dnb-skin-shadow, 0 8px 22px rgba(0, 0, 0, 0.14));
  }
  @media (prefers-reduced-motion: reduce) {
    .dnb-panel[data-dnb-skin] .dnb-voice-orb-halo,
    .dnb-panel[data-dnb-skin] .dnb-voice-orb-blob-a,
    .dnb-panel[data-dnb-skin] .dnb-voice-orb-blob-b,
    .dnb-panel[data-dnb-skin] .dnb-voice-orb-blob-c,
    .dnb-panel[data-dnb-skin] .dnb-voice-orb-ring,
    .dnb-panel[data-dnb-skin] .dnb-voice-orb-ring-2 {
      animation: none !important;
    }
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-inbox-card {
    border: 1px solid var(--dnb-border);
    border-radius: 11px;
    background: var(--dnb-surface);
    overflow: hidden;
  }
  .dnb-panel[data-dnb-skin] .dnb-voice-inbox-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
    border-top: 1px solid var(--dnb-border);
    font-size: 11.5px;
  }
`
