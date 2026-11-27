/**
 * src/client/styles/chief.js — 参谋对话页签、工作流光动效、扇形思考深度仪与预算账本样式
 *
 * 【核心职责】
 *   承载边界小图钉戳（Pushpin Stamp）、DS-Bot 叙事记忆卡、主动建议胶囊、底部参谋输入条、
 *   参谋工作态流光边框与波纹 FX、半圆扇形思考深度仪、以及 v1.6.0 场景预设/LLM 账本/预算条样式。
 *
 * 【边界约定】
 *   - 聚焦「参谋」核心控制面与全域 AI 工作状态反馈视觉，不含协同水泡与待命池样式。
 */

export const CSS_CHIEF = `
  /* Pushpin Stamp (小图钉戳) for Global Shared Boundaries */
  .dnb-pin-stamp {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border-radius: 7px;
    border: 1px dashed var(--dnb-border-strong);
    background: transparent;
    color: var(--dnb-text-3);
    cursor: pointer;
    flex-shrink: 0;
    transition: transform 0.16s cubic-bezier(0.32, 0.72, 0, 1), background 0.16s ease, color 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease;
  }
  .dnb-pin-stamp:hover {
    color: #fbbf24;
    border-style: solid;
    border-color: rgba(245, 158, 11, 0.48);
    background: rgba(245, 158, 11, 0.1);
    transform: scale(1.06) rotate(-4deg);
  }
  .dnb-pin-stamp:active {
    transform: scale(0.92);
  }
  .dnb-pin-stamp[data-pinned="1"] {
    border-style: solid;
    border-color: rgba(245, 158, 11, 0.58);
    background: linear-gradient(135deg, rgba(245, 158, 11, 0.26) 0%, rgba(217, 119, 6, 0.16) 100%);
    color: #fbbf24;
    box-shadow: 0 2px 7px rgba(245, 158, 11, 0.22), inset 0 0.5px 0 rgba(255, 255, 255, 0.22);
  }
  .dnb-pin-badge {
    display: inline-flex;
    align-items: center;
    height: 16px;
    padding: 0 5px;
    border-radius: 5px;
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.2px;
    color: #fbbf24;
    background: rgba(245, 158, 11, 0.15);
    border: 1px solid rgba(245, 158, 11, 0.34);
    flex-shrink: 0;
  }
  .dnb-bound-check {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 15px;
    height: 15px;
    padding: 0;
    border-radius: 4px;
    border: 1px solid var(--dnb-border-strong);
    background: transparent;
    color: transparent;
    cursor: pointer;
    flex-shrink: 0;
    opacity: 0.22;
    transition: opacity 0.14s ease, border-color 0.14s ease, background 0.14s ease;
  }
  .dnb-cell:hover .dnb-bound-check,
  .dnb-wall-item:hover .dnb-bound-check,
  .dnb-bound-check:hover {
    opacity: 0.92;
    border-color: var(--dnb-accent);
  }
  .dnb-bound-check[data-checked="1"] {
    opacity: 1;
    border-color: var(--dnb-primary-bg, #2563eb);
    background: var(--dnb-primary-bg, #2563eb);
    color: var(--dnb-primary-fg, #fff);
  }

  /* DS-Bot Style Narrative Memory Card */
  .dnb-prose-card {
    background: var(--dnb-card);
    border: 1px solid var(--dnb-border);
    border-radius: 16px;
    padding: 14px 16px 16px;
    margin-bottom: 10px;
  }
  .dnb-prose-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding-bottom: 10px;
    margin-bottom: 12px;
    border-bottom: 1px solid var(--dnb-border);
  }
  .dnb-prose-h2 {
    font-size: 13.5px;
    font-weight: 700;
    color: var(--dnb-text);
    margin: 14px 0 6px;
    letter-spacing: -0.1px;
  }
  .dnb-prose-h2:first-child {
    margin-top: 0;
  }
  .dnb-struct-head {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 3px 8px;
    margin: 12px 0 6px;
    border-radius: 7px;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: -0.1px;
    line-height: 1.35;
  }
  .dnb-struct-head[data-compact="1"] {
    font-size: 11.8px;
    padding: 2px 7px;
    margin: 6px 0 4px;
  }
  .dnb-struct-bar {
    width: 3px;
    height: 13px;
    border-radius: 2px;
    flex-shrink: 0;
  }
  .dnb-struct-head[data-compact="1"] .dnb-struct-bar {
    height: 11px;
  }
  .dnb-prose-p {
    font-size: 12.8px;
    line-height: 1.72;
    color: var(--dnb-text-2);
    margin: 0 0 10px;
    word-break: break-word;
  }
  .dnb-prose-p:last-child {
    margin-bottom: 0;
  }

  /* Proactive Suggestion Capsule */
  .dnb-sug-card {
    margin: 0 12px 8px;
    padding: 9px 11px;
    border-radius: 13px;
    background: linear-gradient(135deg, rgba(245, 158, 11, 0.11), rgba(10, 132, 255, 0.08));
    border: 1px solid rgba(245, 158, 11, 0.30);
    flex-shrink: 0;
    animation: dnb-enter 0.2s cubic-bezier(0.32, 0.72, 0, 1);
  }

  /* Persistent Bottom Chief Input Bar (DS-Bot + iOS Style) */
  .dnb-sec-bar {
    flex-shrink: 0;
    padding: 7px calc(12px + var(--dnb-safe-right, 0px)) 10px 12px;
    border-top: 1px solid var(--dnb-border);
    background: var(--dsw-alias-bg-layer-2, rgba(28, 28, 31, 0.65));
    backdrop-filter: blur(16px);
    transition: border-color 0.16s ease, background 0.16s ease;
  }
  .dnb-sec-bar[data-dragover="1"] {
    border-top-color: var(--dnb-accent);
    background: rgba(10, 132, 255, 0.10);
  }
  .dnb-sec-img-strip {
    display: flex;
    align-items: center;
    gap: 7px;
    overflow-x: auto;
    padding: 2px 2px 7px;
    scrollbar-width: none;
  }
  .dnb-sec-img-strip::-webkit-scrollbar { display: none; }
  .dnb-sec-img-thumb {
    position: relative;
    width: 44px;
    height: 44px;
    border-radius: 9px;
    overflow: hidden;
    border: 1px solid var(--dnb-border-strong);
    background: var(--dnb-card);
    flex-shrink: 0;
  }
  .dnb-sec-img-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .dnb-sec-img-rm {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 15px;
    height: 15px;
    border-radius: 50%;
    border: none;
    background: rgba(0, 0, 0, 0.72);
    color: #fff;
    font-size: 11px;
    line-height: 1;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
  .dnb-sec-img-rm:hover {
    background: #ff453a;
  }
  .dnb-sec-targets {
    display: flex;
    align-items: center;
    gap: 5px;
    overflow-x: auto;
    padding-bottom: 6px;
    scrollbar-width: none;
  }
  .dnb-sec-targets::-webkit-scrollbar { display: none; }
  .dnb-sec-chip {
    height: 24px;
    padding: 0 9px;
    border-radius: 99px;
    border: 1px solid transparent;
    background: var(--dnb-card);
    color: var(--dnb-text-3);
    font: inherit;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    transition: background 0.14s ease, color 0.14s ease, border-color 0.14s ease;
  }
  .dnb-sec-chip:hover {
    color: var(--dnb-text);
    background: var(--dnb-fill);
  }
  .dnb-sec-chip[data-active="1"] {
    background: rgba(37, 99, 235, 0.13);
    border-color: rgba(37, 99, 235, 0.34);
    color: var(--dnb-accent);
  }
  .dnb-sec-shell {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 5px 4px 5px;
    border-radius: 20px;
    border: 1px solid var(--dnb-border-strong);
    background: var(--dnb-card);
    transition: border-color 0.18s ease, box-shadow 0.18s ease;
  }
  .dnb-sec-shell:focus-within {
    border-color: var(--dnb-accent);
    box-shadow: 0 0 0 2px rgba(10, 132, 255, 0.14);
  }
  .dnb-sec-attach {
    position: relative;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: none;
    background: transparent;
    color: var(--dnb-text-2);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.15s ease, color 0.15s ease;
  }
  .dnb-sec-attach:hover:not(:disabled) {
    background: var(--dnb-fill);
    color: var(--dnb-accent);
  }
  .dnb-sec-attach:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .dnb-sec-attach-badge {
    position: absolute;
    top: -1px;
    right: -1px;
    min-width: 13px;
    height: 13px;
    padding: 0 3px;
    border-radius: 99px;
    background: var(--dnb-primary-bg, #2563eb);
    color: var(--dnb-primary-fg, #fff);
    font-size: 9px;
    font-weight: 700;
    line-height: 13px;
    text-align: center;
  }
  .dnb-sec-input {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    color: var(--dnb-text);
    font: inherit;
    font-size: 12.5px;
    line-height: 1.4;
    padding: 4px 4px 4px 0;
    outline: none;
  }
  .dnb-sec-input::placeholder {
    color: var(--dnb-text-3);
  }
  .dnb-sec-send {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: none;
    background: var(--dnb-primary-bg, #2563eb);
    color: var(--dnb-primary-fg, #fff);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    transition: transform 0.14s ease, opacity 0.16s ease, background 0.16s ease;
  }
  .dnb-sec-send:hover:not(:disabled) { opacity: 0.92; transform: scale(1.04); }
  .dnb-sec-send:active:not(:disabled) { transform: scale(0.92); }
  .dnb-sec-send:disabled {
    background: var(--dnb-fill);
    color: var(--dnb-text-3);
    cursor: default;
  }
  .dnb-sec-reply {
    margin-bottom: 7px;
    padding: 8px 10px;
    border-radius: 12px;
    background: var(--dnb-elevated);
    border: 1px solid var(--dnb-border-strong);
    font-size: 12px;
    line-height: 1.5;
    animation: dnb-enter 0.18s ease-out;
  }

  .dnb-empty {
    padding: 28px 16px;
    text-align: center;
    color: var(--dnb-text-3);
    font-size: 12.5px;
  }
  .dnb-tag {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 11px;
    padding: 1px 7px;
    border-radius: 99px;
    background: var(--dnb-fill);
    color: var(--dnb-text-2);
  }
  .dnb-pre {
    white-space: pre-wrap;
    word-break: break-word;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    line-height: 1.55;
    padding: 10px 12px;
    margin: 0;
    max-height: 320px;
    overflow: auto;
    color: var(--dnb-text-2);
  }

  /* Chief Working Stage FX (Gradient Base + Running Border Beam + Frosted Glass + Jumping Text + Spinner) */
  @keyframes dnb-fx-neon-flow {
    0% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
  }
  @keyframes dnb-fx-beam-spin {
    from { transform: translate(-50%, -50%) rotate(0deg); }
    to { transform: translate(-50%, -50%) rotate(360deg); }
  }
  @keyframes dnb-fx-ring-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  @keyframes dnb-wave-jump {
    0%, 56%, 100% { transform: translateY(0) scale(1); }
    24% { transform: translateY(-6.5px) scale(1.06); }
    42% { transform: translateY(1px) scale(0.98); }
  }
  .dnb-chief-fx-border,
  .dnb-chief-fx-stage {
    --fx-color: #38bdf8;
    --fx-trail: rgba(56, 189, 248, 0.42);
    --fx-glow: rgba(56, 189, 248, 0.44);
    --fx-border: rgba(56, 189, 248, 0.72);
    --fx-grad: linear-gradient(125deg, #0ea5e9, #38bdf8, #22d3ee, #0ea5e9);
  }
  .dnb-chief-fx-border[data-tone="wall"],
  .dnb-chief-fx-stage[data-tone="wall"] {
    --fx-color: #f87171;
    --fx-trail: rgba(248, 113, 113, 0.44);
    --fx-glow: rgba(239, 68, 68, 0.50);
    --fx-border: rgba(248, 113, 113, 0.80);
    --fx-grad: linear-gradient(125deg, #ef4444, #fb7185, #f97316, #ef4444);
  }
  .dnb-chief-fx-border[data-tone="bounds"],
  .dnb-chief-fx-stage[data-tone="bounds"] {
    --fx-color: #fbbf24;
    --fx-trail: rgba(251, 191, 36, 0.44);
    --fx-glow: rgba(245, 158, 11, 0.48);
    --fx-border: rgba(251, 191, 36, 0.80);
    --fx-grad: linear-gradient(125deg, #f59e0b, #fde047, #fb923c, #f59e0b);
  }
  .dnb-chief-fx-border[data-tone="archive"],
  .dnb-chief-fx-stage[data-tone="archive"] {
    --fx-color: #38bdf8;
    --fx-trail: rgba(56, 189, 248, 0.44);
    --fx-glow: rgba(14, 165, 233, 0.48);
    --fx-border: rgba(56, 189, 248, 0.80);
    --fx-grad: linear-gradient(125deg, #0284c7, #38bdf8, #2dd4bf, #0284c7);
  }
  .dnb-chief-fx-border[data-tone="tasks"],
  .dnb-chief-fx-stage[data-tone="tasks"] {
    --fx-color: #34d399;
    --fx-trail: rgba(52, 211, 153, 0.44);
    --fx-glow: rgba(16, 185, 129, 0.48);
    --fx-border: rgba(52, 211, 153, 0.80);
    --fx-grad: linear-gradient(125deg, #10b981, #34d399, #a3e635, #10b981);
  }
  .dnb-chief-fx-border[data-tone="peers"],
  .dnb-chief-fx-stage[data-tone="peers"] {
    --fx-color: #a78bfa;
    --fx-trail: rgba(167, 139, 250, 0.44);
    --fx-glow: rgba(139, 92, 246, 0.48);
    --fx-border: rgba(167, 139, 250, 0.80);
    --fx-grad: linear-gradient(125deg, #8b5cf6, #c084fc, #60a5fa, #8b5cf6);
  }
  .dnb-chief-fx-border[data-tone="neon"],
  .dnb-chief-fx-stage[data-tone="neon"] {
    --fx-color: #f472b6;
    --fx-trail: rgba(192, 132, 252, 0.48);
    --fx-glow: rgba(168, 85, 247, 0.48);
    --fx-border: rgba(192, 132, 252, 0.82);
    --fx-grad: linear-gradient(120deg, #ff4d6d, #fbbf24, #34d399, #38bdf8, #a78bfa, #f472b6, #ff4d6d);
  }
  .dnb-chief-fx-border[data-tone="dream"],
  .dnb-chief-fx-stage[data-tone="dream"] {
    --fx-color: #a78bfa;
    --fx-trail: rgba(96, 165, 250, 0.46);
    --fx-glow: rgba(129, 140, 248, 0.56);
    --fx-border: rgba(167, 139, 250, 0.88);
    --fx-grad: linear-gradient(125deg, #6366f1, #a855f7, #38bdf8, #c084fc, #6366f1);
  }
  .dnb-chief-fx-border {
    position: absolute;
    inset: 2px;
    border-radius: 14px;
    padding: 2.5px;
    overflow: hidden;
    pointer-events: none;
    z-index: 93;
    filter: drop-shadow(0 0 9px var(--fx-glow));
    box-shadow: inset 0 0 14px var(--fx-glow);
    -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    mask-composite: exclude;
  }
  .dnb-chief-fx-border::after {
    content: "";
    position: absolute;
    inset: 0;
    background: var(--fx-grad);
    background-size: 260% 260%;
    opacity: 0.36;
    animation: dnb-fx-neon-flow 3.2s linear infinite;
  }
  .dnb-chief-fx-border::before {
    content: "";
    position: absolute;
    top: 50%;
    left: 50%;
    width: 260%;
    aspect-ratio: 1 / 1;
    background: conic-gradient(
      from 0deg,
      transparent 0deg,
      transparent 45deg,
      var(--fx-trail) 95deg,
      var(--fx-color) 148deg,
      #ffffff 174deg,
      var(--fx-color) 180deg,
      transparent 186deg,
      transparent 225deg,
      var(--fx-trail) 275deg,
      var(--fx-color) 328deg,
      #ffffff 354deg,
      var(--fx-color) 360deg
    );
    animation: dnb-fx-beam-spin 2.25s linear infinite;
  }
  .dnb-chief-fx-border[data-tone="neon"]::before {
    background: conic-gradient(
      from 0deg,
      #ff4d6d 0deg,
      #fbbf24 54deg,
      #ffffff 84deg,
      #34d399 124deg,
      #38bdf8 180deg,
      #a78bfa 234deg,
      #ffffff 264deg,
      #f472b6 312deg,
      #ff4d6d 360deg
    );
  }
  .dnb-chief-fx-stage {
    position: absolute;
    inset: 4px;
    border-radius: 12px;
    z-index: 92;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 20px;
    background: rgba(15, 23, 42, 0.30);
    backdrop-filter: blur(4px) saturate(1.18);
    -webkit-backdrop-filter: blur(4px) saturate(1.18);
    box-shadow: inset 0 0 28px var(--fx-glow);
    animation: dnb-enter 0.18s ease-out;
  }
  .dnb-chief-fx-hint {
    margin-top: 10px;
    font-size: 11.5px;
    font-weight: 600;
    color: rgba(226, 232, 240, 0.86);
    text-shadow: 0 1px 6px rgba(0, 0, 0, 0.55);
    letter-spacing: 0.2px;
    user-select: none;
  }
  html[data-ds-theme-source="light"] .dnb-chief-fx-hint,
  html[data-ds-theme="light"] .dnb-chief-fx-hint,
  [data-ds-theme-source="light"] .dnb-chief-fx-hint {
    color: rgba(30, 41, 59, 0.78);
    text-shadow: 0 1px 4px rgba(255, 255, 255, 0.65);
  }
  html[data-ds-theme-source="light"] .dnb-chief-fx-stage,
  html[data-ds-theme="light"] .dnb-chief-fx-stage,
  [data-ds-theme-source="light"] .dnb-chief-fx-stage {
    background: rgba(248, 250, 252, 0.42);
  }
  @media (prefers-color-scheme: light) {
    html:not([data-ds-theme-source="dark"]):not([data-ds-theme="dark"]) .dnb-chief-fx-stage {
      background: rgba(248, 250, 252, 0.36);
    }
  }
  .dnb-chief-fx-pill {
    display: inline-flex;
    align-items: center;
    gap: 11px;
    padding: 12px 18px;
    border-radius: 16px;
    max-width: 94%;
    background: rgba(15, 23, 42, 0.78);
    border: 1.5px solid var(--fx-border);
    box-shadow:
      0 14px 36px rgba(0, 0, 0, 0.34),
      0 0 24px var(--fx-glow);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }
  .dnb-chief-fx-ring {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    flex-shrink: 0;
    border: 2.5px solid rgba(255, 255, 255, 0.14);
    border-top-color: var(--fx-color);
    border-right-color: var(--fx-color);
    box-shadow: 0 0 10px var(--fx-glow);
    animation: dnb-fx-ring-spin 0.85s linear infinite;
  }
  .dnb-chief-fx-stage[data-tone="neon"] .dnb-chief-fx-ring {
    border: none;
    background: conic-gradient(from 0deg, #ff4d6d, #fbbf24, #34d399, #38bdf8, #a78bfa, #f472b6, #ff4d6d);
    -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2.5px));
    mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2.5px));
  }
  .dnb-chief-fx-text {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    font-size: 13.5px;
    font-weight: 700;
    line-height: 1.5;
    letter-spacing: 0.3px;
  }
  .dnb-wave-char {
    display: inline-block;
    color: var(--fx-color);
    text-shadow: 0 0 12px var(--fx-glow);
    animation: dnb-wave-jump 1.35s cubic-bezier(0.36, 0.07, 0.19, 0.97) infinite;
    animation-delay: calc(var(--char-i, 0) * 0.065s);
    will-change: transform;
  }
  .dnb-chief-fx-stage[data-tone="neon"] .dnb-wave-char {
    background: linear-gradient(110deg, #ff6b8b, #fbbf24, #34d399, #38bdf8, #c084fc, #ff6b8b);
    background-size: 260% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    text-shadow: none;
    filter: drop-shadow(0 0 6px rgba(168, 85, 247, 0.45));
    animation:
      dnb-wave-jump 1.35s cubic-bezier(0.36, 0.07, 0.19, 0.97) infinite,
      dnb-fx-neon-flow 2.8s linear infinite;
    animation-delay: calc(var(--char-i, 0) * 0.065s), 0s;
  }
  .dnb-chief-fx-stage[data-tone="dream"] .dnb-chief-fx-ring {
    border: none;
    background: conic-gradient(from 0deg, #6366f1, #38bdf8, #c084fc, #e0e7ff, #6366f1);
    -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2.5px));
    mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2.5px));
  }
  .dnb-chief-fx-stage[data-tone="dream"] .dnb-wave-char {
    background: linear-gradient(110deg, #a5b4fc, #38bdf8, #e879f9, #c084fc, #a5b4fc);
    background-size: 260% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    text-shadow: none;
    filter: drop-shadow(0 0 8px rgba(129, 140, 248, 0.55));
    animation:
      dnb-wave-jump 1.45s cubic-bezier(0.36, 0.07, 0.19, 0.97) infinite,
      dnb-fx-neon-flow 3.2s linear infinite;
    animation-delay: calc(var(--char-i, 0) * 0.065s), 0s;
  }

  /* Interactive Semicircular Fan Effort Gauge + Team Auto/Manual Switch */
  .dnb-fan-gauge {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    width: 100%;
    padding: 2px 0;
  }
  .dnb-fan-stage {
    position: relative;
    width: 224px;
    max-width: 100%;
    height: 118px;
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }
  .dnb-fan-gauge[data-compact="1"] .dnb-fan-stage {
    width: 208px;
    height: 110px;
  }
  .dnb-fan-svg {
    width: 100%;
    height: 100%;
    display: block;
    cursor: grab;
    user-select: none;
    touch-action: none;
    overflow: visible;
  }
  .dnb-fan-svg[data-dragging="1"] {
    cursor: grabbing;
  }
  .dnb-fan-needle {
    transform-origin: 0px 0px;
    transition: transform 0.16s ease-out;
  }
  .dnb-fan-needle[data-dragging="1"] {
    transition: none;
  }
  .dnb-fan-hub {
    position: absolute;
    left: 50%;
    bottom: 2px;
    transform: translateX(-50%);
    min-width: 68px;
    padding: 4px 10px 3px;
    border-radius: 99px;
    border: 1px solid var(--dnb-border-strong);
    background-color: #1f2024;
    background-image: linear-gradient(var(--dnb-popover), var(--dnb-popover));
    color: var(--dnb-text);
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    line-height: 1.15;
    cursor: pointer;
    z-index: 2;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.28);
    transition: transform 0.14s ease, border-color 0.16s ease, background-color 0.16s ease, box-shadow 0.16s ease;
  }
  .dnb-fan-hub:hover {
    border-color: rgba(129, 140, 248, 0.65);
    transform: translateX(-50%) scale(1.04);
  }
  .dnb-fan-hub:active {
    transform: translateX(-50%) scale(0.95);
  }
  .dnb-fan-hub[data-active="1"] {
    border-color: rgba(129, 140, 248, 0.72);
    background-color: #292c46;
    background-image: linear-gradient(rgba(99, 102, 241, 0.22), rgba(99, 102, 241, 0.22));
    color: #c7d2fe;
    box-shadow: 0 0 12px rgba(99, 102, 241, 0.24);
  }
  html[data-ds-theme-source="light"] .dnb-fan-hub[data-active="1"],
  html[data-ds-theme="light"] .dnb-fan-hub[data-active="1"],
  [data-ds-theme-source="light"] .dnb-fan-hub[data-active="1"] {
    background-color: #eef2ff;
    background-image: none;
    border-color: rgba(79, 70, 229, 0.48);
    color: #4338ca;
  }
  .dnb-fan-hub-main {
    font-size: 11px;
    font-weight: 700;
    white-space: nowrap;
  }
  .dnb-fan-hub-sub {
    font-size: 9px;
    opacity: 0.72;
    white-space: nowrap;
  }
  .dnb-team-effort-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding-top: 8px;
    margin-top: 2px;
    border-top: 1px dashed rgba(148, 163, 184, 0.22);
  }
  .dnb-team-effort-info {
    flex: 1 1 auto;
    min-width: 0;
  }
  .dnb-team-effort-title {
    font-size: 11.5px;
    font-weight: 600;
    color: var(--dnb-text);
    line-height: 1.3;
  }
  .dnb-team-effort-sub {
    font-size: 10.5px;
    color: var(--dnb-text-3);
    line-height: 1.35;
    margin-top: 1px;
  }
  .dnb-team-effort-seg {
    display: inline-flex;
    align-items: center;
    border-radius: 8px;
    padding: 2px;
    gap: 2px;
    background: rgba(148, 163, 184, 0.12);
    border: 1px solid var(--dnb-border);
    flex-shrink: 0;
  }
  .dnb-team-effort-btn {
    border: none;
    border-radius: 6px;
    padding: 3px 10px;
    font-size: 11px;
    font-weight: 600;
    line-height: 1.25;
    background: transparent;
    color: var(--dnb-text-2);
    cursor: pointer;
    transition: background 0.14s ease, color 0.14s ease;
  }
  .dnb-team-effort-btn:hover {
    color: var(--dnb-text);
  }
  .dnb-team-effort-btn[data-active="1"] {
    background: var(--dnb-primary-bg, #2563eb);
    color: var(--dnb-primary-fg, #ffffff);
  }

  /* v1.6.0 Closing Pack: Scenario Presets, Chief LLM Ledger & Budget Progress */
  .dnb-preset-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 6px;
    padding: 8px 10px 10px;
  }
  .dnb-preset-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    min-width: 0;
    overflow: hidden;
    padding: 8px 8px 9px;
    border-radius: 10px;
    border: 1px solid var(--dnb-border);
    background: var(--dnb-fill);
    color: var(--dnb-text);
    text-align: left;
    cursor: pointer;
    transition: border-color 0.16s ease, background-color 0.16s ease, transform 0.12s ease;
  }
  .dnb-preset-card:hover {
    border-color: var(--dnb-border-strong);
    background: var(--dnb-card-hover);
  }
  .dnb-preset-card:active {
    transform: scale(0.98);
  }
  .dnb-preset-card[data-active="1"] {
    border-color: var(--dnb-accent);
    background: rgba(10, 132, 255, 0.13);
    box-shadow: 0 0 0 1px rgba(10, 132, 255, 0.25);
  }
  .dnb-preset-title {
    font-size: 11.5px;
    font-weight: 700;
    color: var(--dnb-text);
    display: flex;
    align-items: center;
    gap: 4px;
    line-height: 1.25;
  }
  .dnb-preset-tag {
    font-size: 9.5px;
    font-weight: 600;
    padding: 1px 5px;
    border-radius: 99px;
    background: var(--dnb-card);
    color: var(--dnb-text-2);
    border: 1px solid var(--dnb-border);
    white-space: normal;
    max-width: 100%;
    line-height: 1.3;
    word-break: break-word;
  }
  .dnb-preset-card[data-active="1"] .dnb-preset-tag {
    color: var(--dnb-accent);
    border-color: rgba(10, 132, 255, 0.42);
  }
  .dnb-preset-desc {
    font-size: 10px;
    line-height: 1.4;
    color: var(--dnb-text-3);
  }

  .dnb-ledger-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
    margin: 6px 0 8px;
  }
  .dnb-ledger-chip {
    padding: 6px 8px;
    border-radius: 9px;
    background: var(--dnb-fill);
    border: 1px solid var(--dnb-border);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .dnb-ledger-chip-label {
    font-size: 10px;
    color: var(--dnb-text-3);
    font-weight: 500;
  }
  .dnb-ledger-chip-val {
    font-size: 11.5px;
    color: var(--dnb-text);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .dnb-budget-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 7px;
  }
  .dnb-budget-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11px;
    color: var(--dnb-text-2);
    font-variant-numeric: tabular-nums;
  }
  .dnb-budget-bar {
    height: 6px;
    border-radius: 99px;
    background: var(--dnb-fill);
    border: 1px solid var(--dnb-border);
    overflow: hidden;
  }
  .dnb-budget-fill {
    height: 100%;
    border-radius: 99px;
    background: var(--dnb-accent);
    transition: width 0.25s ease, background-color 0.2s ease;
  }
  .dnb-budget-fill[data-warn="1"] {
    background: #f59e0b;
  }
  .dnb-budget-fill[data-tripped="1"] {
    background: #ef4444;
  }
  .dnb-lang-inline-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 7px 10px 4px;
    margin-top: 6px;
    border-top: 1px solid var(--dnb-border);
  }
  html[data-ds-theme-source="light"] .dnb-preset-card[data-active="1"],
  html[data-ds-theme="light"] .dnb-preset-card[data-active="1"],
  [data-ds-theme-source="light"] .dnb-preset-card[data-active="1"] {
    background: rgba(37, 99, 235, 0.08);
    border-color: #2563eb;
  }
  html[data-ds-theme-source="light"] .dnb-ledger-chip,
  html[data-ds-theme="light"] .dnb-ledger-chip,
  [data-ds-theme-source="light"] .dnb-ledger-chip {
    background: rgba(15, 23, 42, 0.04);
  }
  .dnb-gear-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 7px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--dnb-text-3);
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
    margin: 0 -2px;
    transition: background-color 0.16s ease, color 0.16s ease, border-color 0.16s ease;
  }
  .dnb-gear-btn svg {
    transition: transform 0.42s cubic-bezier(0.34, 1.4, 0.64, 1);
    transform-origin: center;
  }
  .dnb-gear-btn:hover {
    background: var(--dnb-fill);
    color: var(--dnb-text);
    border-color: var(--dnb-border);
  }
  .dnb-gear-btn[data-active="1"] {
    background: rgba(10, 132, 255, 0.15);
    color: var(--dnb-accent);
    border-color: rgba(10, 132, 255, 0.36);
  }
  .dnb-settings-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 10px;
    margin-bottom: 10px;
    border-radius: 10px;
    background: var(--dnb-card);
    border: 1px solid var(--dnb-border);
  }
  html[data-ds-theme-source="light"] .dnb-gear-btn[data-active="1"],
  html[data-ds-theme="light"] .dnb-gear-btn[data-active="1"],
  [data-ds-theme-source="light"] .dnb-gear-btn[data-active="1"] {
    background: rgba(37, 99, 235, 0.1);
    border-color: rgba(37, 99, 235, 0.34);
    color: #2563eb;
  }
  @keyframes dnb-bubble-shake {
    0%, 100% { transform: translateX(0); }
    20% { transform: translateX(-5px); }
    45% { transform: translateX(5px); }
    70% { transform: translateX(-3px); }
    90% { transform: translateX(2px); }
  }
  .dnb-bubble-stage {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .dnb-bubble-status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 600;
    color: #34d399;
    padding: 3px 9px;
    border-radius: 999px;
    corner-shape: round;
    background: rgba(16, 185, 129, 0.11);
    border: 1px solid rgba(16, 185, 129, 0.30);
    max-width: 100%;
    min-width: 0;
  }
  .dnb-bubble-status[data-locked="1"] {
    color: #fcd34d;
    background: rgba(245, 158, 11, 0.14);
    border-color: rgba(245, 158, 11, 0.44);
  }
  .dnb-bubble-status-dot {
    width: 6.5px;
    height: 6.5px;
    border-radius: 50%;
    corner-shape: round;
    background: currentColor;
    flex-shrink: 0;
  }
  .dnb-bubble-estop-btn {
    border-color: rgba(239, 68, 68, 0.52) !important;
    background: rgba(239, 68, 68, 0.14) !important;
    color: #fca5a5 !important;
    font-weight: 700 !important;
  }
  .dnb-bubble-estop-btn[data-confirm="1"] {
    background: rgba(239, 68, 68, 0.28) !important;
    border-color: #ef4444 !important;
    color: #fee2e2 !important;
  }

`
