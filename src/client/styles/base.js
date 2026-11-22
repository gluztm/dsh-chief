/**
 * src/client/styles/base.js — 基础面板设计令牌、通用控件与全局浮层样式
 *
 * 【核心职责】
 *   承载 `.dnb-panel` CSS 变量令牌、明暗基础覆盖、输入框入口按钮、顶栏与版本徽章（`.dnb-ver-chip`）、
 *   分段导航、按钮/开关/进度条、底部抽屉、右键气泡、Toast 提示，以及 Attention-First 手风琴基础样式。
 *
 * 【边界与接入】
 *   - 本模块排在 `styles.js` 中 `STYLE_SHEETS` 的首位，为后续所有页签提供公共变量与通用基础类。
 *   - 未来新增页签若需新增独立 CSS，请勿写入本文件，请在 `src/client/styles/` 下新建对应页签样式文件。
 */

export const CSS_BASE = `
  .dnb-panel {
    --dnb-card: var(--dsw-alias-card-fill, var(--dsw-alias-bg-layer-1, rgba(128,128,136,0.08)));
    --dnb-card-hover: var(--dsw-alias-card-fill-hover, var(--dsw-alias-bg-layer-2, rgba(128,128,136,0.13)));
    --dnb-fill: var(--dsw-alias-fill-l1, var(--dsw-alias-bg-layer-2, rgba(120,120,128,0.16)));
    --dnb-elevated: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-layer-3, #262629));
    --dnb-popover: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-layer-3, #252528));
    --dnb-border: var(--dsw-alias-border-l1, rgba(128,128,136,0.15));
    --dnb-border-strong: var(--dsw-alias-border-l2, rgba(128,128,136,0.26));
    --dnb-text: var(--dsw-alias-label-primary, #f2f2f7);
    --dnb-text-2: var(--dsw-alias-label-secondary, rgba(235,235,245,0.64));
    --dnb-text-3: var(--dsw-alias-label-tertiary, rgba(235,235,245,0.38));
    --dnb-accent: var(--dsw-alias-state-business-primary, #2563eb);
    --dnb-primary-bg: #2563eb;
    --dnb-primary-bg-hover: #1d4ed8;
    --dnb-primary-fg: #ffffff;

    position: fixed;
    top: 76px;
    right: 16px;
    width: 396px;
    max-width: calc(100vw - 32px);
    max-height: min(80vh, 780px);
    pointer-events: auto;
    display: flex;
    flex-direction: column;
    z-index: 70;
    border-radius: 18px;
    overflow: hidden;
    background: var(--dsw-alias-bg-layer-3, rgba(30, 30, 32, 0.96));
    backdrop-filter: blur(24px) saturate(1.2);
    color: var(--dnb-text);
    border: 1px solid var(--dnb-border-strong);
    box-shadow: 0 20px 48px rgba(0, 0, 0, 0.28);
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei UI", system-ui, sans-serif;
    font-size: 12.5px;
    line-height: 1.45;
    -webkit-font-smoothing: antialiased;
  }

  /* Explicit DSH Light Theme overrides (expanded to DSH Desktop body[data-ds-dark-theme] & html[data-dnb-theme="light"]) */
  html[data-ds-theme-source="light"] .dnb-panel,
  html[data-ds-theme="light"] .dnb-panel,
  [data-ds-theme-source="light"] .dnb-panel,
  html[data-ds-theme-source="light"] .dnb-menu,
  html[data-ds-theme="light"] .dnb-menu,
  [data-ds-theme-source="light"] .dnb-menu {
    --dnb-popover: #ffffff;
    --dnb-card: #ffffff;
    --dnb-card-hover: #f8fafc;
    --dnb-fill: rgba(15, 23, 42, 0.065);
    --dnb-elevated: #ffffff;
    --dnb-text: #0f172a;
    --dnb-text-2: #334155;
    --dnb-text-3: #5b6472;
    --dnb-border: #e2e8f0;
    --dnb-border-strong: #cbd5e1;
  }
  html[data-ds-theme-source="light"] .dnb-panel:not(.dnb-main),
  html[data-ds-theme="light"] .dnb-panel:not(.dnb-main),
  [data-ds-theme-source="light"] .dnb-panel:not(.dnb-main) {
    background: var(--dsw-alias-bg-layer-3, rgba(255, 255, 255, 0.96));
    box-shadow: 0 16px 40px rgba(15, 23, 42, 0.14);
  }
  html[data-ds-theme-source="light"] .dnb-tactical-pop,
  html[data-ds-theme="light"] .dnb-tactical-pop,
  [data-ds-theme-source="light"] .dnb-tactical-pop,
  html[data-ds-theme-source="light"] .dnb-perm-pop,
  html[data-ds-theme="light"] .dnb-perm-pop,
  [data-ds-theme-source="light"] .dnb-perm-pop,
  html[data-ds-theme-source="light"] .dnb-more-menu,
  html[data-ds-theme="light"] .dnb-more-menu,
  [data-ds-theme-source="light"] .dnb-more-menu {
    background-color: #ffffff;
    background-image: none;
    border-color: #cbd5e1;
    box-shadow: 0 16px 40px rgba(15, 23, 42, 0.14), 0 2px 8px rgba(15, 23, 42, 0.06);
  }
  html[data-ds-theme-source="light"] .dnb-tactical-pop {
    border-color: rgba(37, 99, 235, 0.28);
  }
  html[data-ds-theme-source="light"] .dnb-tactical-head {
    background: linear-gradient(90deg, #f8fafc 0%, #ffffff 100%);
    border-bottom-color: #e2e8f0;
  }
  html[data-ds-theme-source="light"] .dnb-tactical-row {
    border-radius: 8px;
    padding: 6px;
    border-bottom-color: #eef2f6;
  }
  html[data-ds-theme-source="light"] .dnb-tactical-row:hover {
    background: #f8fafc;
  }
  html[data-ds-theme-source="light"] .dnb-modal-backdrop {
    background: rgba(15, 23, 42, 0.28);
  }
  html[data-ds-theme-source="light"] .dnb-modal-card,
  html[data-ds-theme-source="light"] .dnb-toast {
    background-color: #ffffff;
    background-image: none;
    border-color: #cbd5e1;
    box-shadow: 0 14px 36px rgba(15, 23, 42, 0.14);
  }
  html[data-ds-theme-source="light"] .dnb-switch {
    background: #cbd5e1;
    box-shadow: inset 0 1px 2px rgba(15, 23, 42, 0.14);
  }
  html[data-ds-theme-source="light"] .dnb-switch[data-on="1"] {
    background: #16a34a;
    box-shadow: none;
  }
  html[data-ds-theme-source="light"] .dnb-switch[data-on="1"][data-tone="red"] {
    background: #dc2626;
    box-shadow: 0 0 8px rgba(220, 38, 38, 0.24);
  }
  html[data-ds-theme-source="light"] .dnb-stepper {
    background: #f8fafc;
    border-color: #cbd5e1;
    color: #0f172a;
  }
  html[data-ds-theme-source="light"] .dnb-mini-btn[data-tone="accent"] {
    background: #eff6ff;
    border-color: rgba(37, 99, 235, 0.34);
    color: #1d4ed8;
  }
  html[data-ds-theme-source="light"] .dnb-mini-btn[data-tone="amber"] {
    background: #fffbeb;
    border-color: rgba(217, 119, 6, 0.38);
    color: #b45309;
  }
  html[data-ds-theme-source="light"] .dnb-tac-chip[data-tone="amber"] {
    background: #fffbeb;
    border-color: rgba(217, 119, 6, 0.40);
    color: #b45309;
  }
  html[data-ds-theme-source="light"] .dnb-tac-chip[data-tone="accent"] {
    background: #eff6ff;
    border-color: rgba(37, 99, 235, 0.38);
    color: #1d4ed8;
  }
  html[data-ds-theme-source="light"] .dnb-tac-chip[data-tone="red"] {
    background: #fef2f2;
    border-color: rgba(220, 38, 38, 0.42);
    color: #dc2626;
    box-shadow: 0 1px 4px rgba(220, 38, 38, 0.12);
  }
  html[data-ds-theme-source="light"] .dnb-group,
  html[data-ds-theme-source="light"] .dnb-acc-card {
    box-shadow: 0 1px 3px rgba(15, 23, 42, 0.05);
  }
  html[data-ds-theme-source="light"] .dnb-menu,
  html[data-ds-theme="light"] .dnb-menu,
  [data-ds-theme-source="light"] .dnb-menu {
    background-color: #ffffff;
    background-image: none;
  }
  html[data-ds-theme-source="light"] .dnb-perm-badge[data-tone="green"],
  html[data-ds-theme="light"] .dnb-perm-badge[data-tone="green"] { color: #059669; }
  html[data-ds-theme-source="light"] .dnb-perm-badge[data-tone="blue"],
  html[data-ds-theme="light"] .dnb-perm-badge[data-tone="blue"] { color: #2563eb; }
  html[data-ds-theme-source="light"] .dnb-perm-badge[data-tone="amber"],
  html[data-ds-theme="light"] .dnb-perm-badge[data-tone="amber"] { color: #b45309; }
  html[data-ds-theme-source="light"] .dnb-fan-hub,
  html[data-ds-theme="light"] .dnb-fan-hub,
  [data-ds-theme-source="light"] .dnb-fan-hub {
    background-color: #ffffff;
    background-image: none;
    color: #0f172a;
    box-shadow: 0 3px 12px rgba(15, 23, 42, 0.12);
  }
  html[data-ds-theme-source="light"] .dnb-team-effort-seg,
  html[data-ds-theme="light"] .dnb-team-effort-seg,
  [data-ds-theme-source="light"] .dnb-team-effort-seg {
    background: rgba(15, 23, 42, 0.05);
  }

  .dnb-main {
    position: relative;
    top: auto;
    right: auto;
    width: 100%;
    max-width: none;
    max-height: none;
    height: 100%;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    z-index: auto;
    border-radius: 0;
    border: none;
    box-shadow: none;
    backdrop-filter: none;
    background: transparent;
  }

  .dnb-page {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    color: var(--dsw-alias-label-primary);
    background: var(--dsw-alias-bg-base, transparent);
  }

  .dnb-dock-page {
    background: transparent;
  }

  .dnb-conv-page {
    height: 100%;
    height: calc(var(--dsh-conversation-viewport-height, 100%) - var(--dsh-composer-height, 0px));
    max-height: 100%;
    min-height: 0;
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: transparent;
  }

  /* Main-page Chief view takes over the conversation scroll viewport and hides the host composer seat */
  [data-conversation-scroll]:has([data-dnb-conv-view="1"]) {
    display: flex !important;
    flex-direction: column !important;
    overflow: hidden !important;
    scrollbar-gutter: auto !important;
  }
  [data-conversation-scroll]:has([data-dnb-conv-view="1"]) > [data-composer-seat] {
    display: none !important;
  }
  [data-conversation-scroll]:has([data-dnb-conv-view="1"]) > :not([data-composer-seat]),
  [data-conversation-scroll]:has([data-dnb-conv-view="1"]) > [data-slot="conversation.session"] > * {
    flex: 1 1 0 !important;
    min-height: 0 !important;
    height: 100% !important;
    display: flex !important;
    flex-direction: column !important;
    overflow: hidden !important;
  }
  [data-conversation-scroll]:has([data-dnb-conv-view="1"]) .dnb-conv-page {
    height: var(--dsh-conversation-viewport-height, 100%);
    max-height: 100%;
  }

  .dnb-dock {
    height: 100%;
    flex: 1 1 auto;
    min-height: 0;
  }

  .dnb-brand-status-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--dnb-accent);
    flex-shrink: 0;
  }
  .dnb-brand-status-icon[data-working="1"] {
    --dnb-glow-soft: rgba(56, 189, 248, 0.22);
    --dnb-glow-strong: rgba(56, 189, 248, 0.68);
    --dnb-glow-ring-min: none;
    --dnb-glow-ring-max: none;
    animation: dnb-icon-breathe 2.4s ease-in-out infinite;
  }
  html[data-ds-theme-source="light"] .dnb-brand-status-icon[data-working="1"] {
    --dnb-glow-soft: rgba(37, 99, 235, 0.16);
    --dnb-glow-strong: rgba(37, 99, 235, 0.44);
  }

  @media (min-width: 820px) {
    .dnb-panel.dnb-main .dnb-seg-wrap > .dnb-seg,
    .dnb-panel.dnb-main .dnb-session-optin-wrap > .dnb-session-optin-banner,
    .dnb-panel.dnb-main .dnb-body > .dnb-view,
    .dnb-panel.dnb-main .dnb-sec-bar > .dnb-sec-targets,
    .dnb-panel.dnb-main .dnb-sec-bar > .dnb-sec-img-strip,
    .dnb-panel.dnb-main .dnb-sec-bar > .dnb-sec-shell,
    .dnb-panel.dnb-main .dnb-sec-bar > .dnb-tactical-strip,
    .dnb-panel.dnb-main .dnb-sec-bar > .dnb-pending-banner,
    .dnb-panel.dnb-main .dnb-sec-bar > .dnb-sec-reply {
      max-width: 1080px;
      width: 100%;
      margin-left: auto;
      margin-right: auto;
    }
  }

  /* Entry button in composer bar */
  .dnb-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    height: 28px;
    min-width: 28px;
    padding: 0 5px;
    border-radius: 8px;
    border: none;
    background: transparent;
    color: var(--dsw-alias-label-secondary);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    transition: background 0.18s ease, color 0.18s ease, transform 0.14s ease;
  }
  .dnb-btn:hover {
    background: var(--dsw-alias-bg-layer-2);
    color: var(--dsw-alias-label-primary);
  }
  .dnb-btn:active { transform: scale(0.94); }
  .dnb-btn[data-active="1"] { color: var(--dnb-accent, #2563eb); }
  .dnb-count {
    min-width: 15px;
    height: 15px;
    padding: 0 4px;
    border-radius: 99px;
    background: var(--dnb-primary-bg, #2563eb);
    color: var(--dnb-primary-fg, #fff);
    font-size: 10px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  /* Header */
  .dnb-head {
    container-type: inline-size;
    container-name: dnb-head;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px 8px;
    flex-shrink: 0;
  }
  .dnb-title {
    font-weight: 600;
    font-size: 14px;
    letter-spacing: -0.1px;
  }
  .dnb-session-chip {
    font-size: 11px;
    color: var(--dnb-text-3);
    background: var(--dnb-fill);
    padding: 1px 7px;
    border-radius: 99px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  .dnb-ver-chip {
    font-size: 10.5px;
    font-weight: 500;
    color: var(--dnb-text-3);
    background: var(--dnb-fill);
    border: 1px solid var(--dnb-border);
    padding: 1px 6px;
    border-radius: 99px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    line-height: 1.35;
    flex-shrink: 0;
  }
  .dnb-ver-chip[data-stale="1"] {
    color: #f59e0b;
    border-color: rgba(245, 158, 11, 0.45);
    background: rgba(245, 158, 11, 0.10);
  }
  @container dnb-head (max-width: 448px) {
    .dnb-ver-chip:not([data-stale="1"]) {
      display: none;
    }
  }
  .dnb-head-actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .dnb-icon-btn {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    border: none;
    background: transparent;
    color: var(--dnb-text-2);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.16s ease, color 0.16s ease, transform 0.14s ease;
  }
  .dnb-icon-btn:hover {
    background: var(--dnb-fill);
    color: var(--dnb-text);
  }
  .dnb-icon-btn:active { transform: scale(0.92); }
  .dnb-icon-btn[data-active="1"] {
    background: var(--dnb-fill);
    color: var(--dnb-accent);
  }

  @keyframes dnb-spin { to { transform: rotate(360deg); } }
  .dnb-spin { animation: dnb-spin 0.9s linear infinite; }

  /* iOS Segmented Control + Subtle Tab Identity (dark & light balanced) */
  .dnb-seg-wrap {
    padding: 0 12px 8px;
    flex-shrink: 0;
  }
  .dnb-seg {
    display: flex;
    padding: 2.5px;
    border-radius: 10px;
    background: var(--dnb-fill);
    border: 1px solid var(--dnb-border);
    gap: 2px;
  }
  .dnb-seg-btn {
    position: relative;
    flex: 1 1 0;
    min-width: 0;
    border: 1px solid transparent;
    background: transparent;
    color: var(--dnb-text-2);
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    padding: 5px 4px;
    border-radius: 7.5px;
    cursor: pointer;
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
    transition: background 0.2s cubic-bezier(0.32, 0.72, 0, 1), color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, transform 0.12s ease;
  }
  .dnb-seg-btn:hover { color: var(--dnb-text); background: rgba(128, 128, 140, 0.08); }
  .dnb-seg-btn:active { transform: scale(0.96); }
  .dnb-seg-btn[data-active="1"] {
    background: var(--dnb-elevated);
    border-color: var(--dnb-border-strong);
    color: var(--dnb-text);
    font-weight: 600;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.20);
  }
  .dnb-seg-btn[data-active="1"]::after {
    content: "";
    position: absolute;
    left: 22%;
    right: 22%;
    bottom: 1.5px;
    height: 2px;
    border-radius: 99px;
    background: var(--dnb-tab-bar, var(--dnb-accent));
    opacity: 0.9;
  }
  .dnb-seg-btn[data-active="1"][data-tab="chief"] {
    --dnb-tab-bar: #3b82f6;
    background: linear-gradient(180deg, rgba(59, 130, 246, 0.14), rgba(59, 130, 246, 0.05));
    border-color: rgba(59, 130, 246, 0.34);
  }
  .dnb-seg-btn[data-active="1"][data-tab="tasks"] {
    --dnb-tab-bar: #8b5cf6;
    background: linear-gradient(180deg, rgba(139, 92, 246, 0.14), rgba(139, 92, 246, 0.05));
    border-color: rgba(139, 92, 246, 0.34);
  }
  .dnb-seg-btn[data-active="1"][data-tab="peers"] {
    --dnb-tab-bar: #06b6d4;
    background: linear-gradient(180deg, rgba(6, 182, 212, 0.14), rgba(6, 182, 212, 0.05));
    border-color: rgba(6, 182, 212, 0.34);
  }
  .dnb-seg-btn[data-active="1"][data-tab="archive"] {
    --dnb-tab-bar: #f59e0b;
    background: linear-gradient(180deg, rgba(245, 158, 11, 0.14), rgba(245, 158, 11, 0.05));
    border-color: rgba(245, 158, 11, 0.34);
  }
  .dnb-seg-btn[data-active="1"][data-tab="boundaries"] {
    --dnb-tab-bar: #f43f5e;
    background: linear-gradient(180deg, rgba(244, 63, 94, 0.14), rgba(244, 63, 94, 0.05));
    border-color: rgba(244, 63, 94, 0.34);
  }
  html[data-ds-theme-source="light"] .dnb-seg {
    background: rgba(15, 23, 42, 0.055);
    border-color: rgba(15, 23, 42, 0.09);
  }
  html[data-ds-theme-source="light"] .dnb-seg-btn {
    color: #475569;
  }
  html[data-ds-theme-source="light"] .dnb-seg-btn:hover {
    color: #0f172a;
    background: rgba(255, 255, 255, 0.55);
  }
  html[data-ds-theme-source="light"] .dnb-seg-btn[data-active="1"] {
    background: #ffffff;
    color: #0f172a;
    border-color: rgba(15, 23, 42, 0.12);
    box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
  }
  html[data-ds-theme-source="light"] .dnb-seg-btn[data-active="1"][data-tab="chief"] {
    --dnb-tab-bar: #2563eb;
    background: linear-gradient(180deg, #eff6ff 0%, #ffffff 100%);
    border-color: rgba(37, 99, 235, 0.28);
    color: #1e40af;
  }
  html[data-ds-theme-source="light"] .dnb-seg-btn[data-active="1"][data-tab="tasks"] {
    --dnb-tab-bar: #7c3aed;
    background: linear-gradient(180deg, #f5f3ff 0%, #ffffff 100%);
    border-color: rgba(124, 58, 237, 0.28);
    color: #5b21b6;
  }
  html[data-ds-theme-source="light"] .dnb-seg-btn[data-active="1"][data-tab="peers"] {
    --dnb-tab-bar: #0891b2;
    background: linear-gradient(180deg, #ecfeff 0%, #ffffff 100%);
    border-color: rgba(8, 145, 178, 0.28);
    color: #155e75;
  }
  html[data-ds-theme-source="light"] .dnb-seg-btn[data-active="1"][data-tab="archive"] {
    --dnb-tab-bar: #d97706;
    background: linear-gradient(180deg, #fffbeb 0%, #ffffff 100%);
    border-color: rgba(217, 119, 6, 0.30);
    color: #92400e;
  }
  html[data-ds-theme-source="light"] .dnb-seg-btn[data-active="1"][data-tab="boundaries"] {
    --dnb-tab-bar: #e11d48;
    background: linear-gradient(180deg, #fff1f2 0%, #ffffff 100%);
    border-color: rgba(225, 29, 72, 0.28);
    color: #9f1239;
  }
  .dnb-seg-dot {
    font-size: 10px;
    opacity: 0.72;
    font-weight: 500;
  }

  /* Scrollable body */
  .dnb-body {
    padding: 4px 12px 14px;
    overflow-y: auto;
    overflow-x: hidden;
    flex: 1 1 auto;
    min-height: 0;
  }
  .dnb-body::-webkit-scrollbar { width: 5px; height: 5px; }
  .dnb-body::-webkit-scrollbar-thumb {
    background: var(--dsw-alias-scrollbar-bg-l1, rgba(128,128,136,0.24));
    border-radius: 99px;
  }

  @keyframes dnb-enter {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .dnb-view {
    animation: dnb-enter 0.2s cubic-bezier(0.32, 0.72, 0, 1);
  }

  /* iOS Inset Grouped Cards */
  .dnb-group {
    background: var(--dnb-card);
    border: 1px solid var(--dnb-border-strong);
    border-radius: 14px;
    margin-bottom: 10px;
    overflow: hidden;
  }
  .dnb-section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 2px 4px 6px;
    font-size: 11.5px;
    font-weight: 500;
    color: var(--dnb-text-2);
  }
  .dnb-cell {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 12px;
    position: relative;
    transition: background 0.15s ease;
  }
  .dnb-cell + .dnb-cell {
    border-top: 1px solid var(--dnb-border);
  }
  .dnb-cell-hover:hover {
    background: var(--dnb-card-hover);
  }
  .dnb-row-actions {
    opacity: 0;
    display: inline-flex;
    gap: 4px;
    transition: opacity 0.15s ease;
  }
  .dnb-cell:hover .dnb-row-actions,
  .dnb-note-card:hover .dnb-row-actions {
    opacity: 1;
  }

  /* Inputs & Areas */
  .dnb-input, .dnb-area {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid var(--dnb-border);
    border-radius: 10px;
    background: var(--dnb-card);
    color: var(--dnb-text);
    font: inherit;
    font-size: 12.5px;
    padding: 7px 10px;
    outline: none;
    transition: border-color 0.18s ease, background 0.18s ease;
  }
  .dnb-input::placeholder, .dnb-area::placeholder {
    color: var(--dnb-text-3);
  }
  .dnb-input:focus, .dnb-area:focus {
    border-color: var(--dnb-accent);
  }
  .dnb-input option,
  .dnb-area option,
  select.dnb-input option,
  .dnb-panel select option {
    background-color: var(--dnb-popover, #252528);
    color: var(--dnb-text, #f2f2f7);
  }
  .dnb-bare-area {
    width: 100%;
    box-sizing: border-box;
    border: none;
    background: transparent;
    color: var(--dnb-text);
    font: inherit;
    font-size: 13px;
    line-height: 1.55;
    padding: 10px 12px;
    resize: vertical;
    min-height: 60px;
    outline: none;
  }
  .dnb-bare-area::placeholder { color: var(--dnb-text-3); }

  /* Buttons & Pills */
  .dnb-primary-btn {
    height: 30px;
    padding: 0 12px;
    border-radius: 99px;
    border: none;
    background: var(--dnb-primary-bg, #2563eb);
    color: var(--dnb-primary-fg, #ffffff);
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    white-space: nowrap;
    transition: background 0.16s ease, opacity 0.16s ease, transform 0.14s ease;
  }
  .dnb-primary-btn:hover:not(:disabled) {
    background: var(--dnb-primary-bg-hover, #1d4ed8);
    opacity: 0.96;
  }
  .dnb-primary-btn:active:not(:disabled) { transform: scale(0.96); }
  .dnb-primary-btn:disabled { opacity: 0.4; cursor: default; }

  .dnb-pill {
    height: 26px;
    padding: 0 10px;
    border-radius: 99px;
    border: 1px solid var(--dnb-border);
    background: transparent;
    color: var(--dnb-text-2);
    font: inherit;
    font-size: 11.5px;
    font-weight: 500;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    white-space: nowrap;
    transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, transform 0.12s ease;
  }
  .dnb-pill:hover {
    background: var(--dnb-fill);
    color: var(--dnb-text);
    border-color: var(--dnb-border-strong);
  }
  .dnb-pill:active { transform: scale(0.96); }
  .dnb-pill[data-active="1"] {
    background: rgba(37, 99, 235, 0.13);
    border-color: rgba(37, 99, 235, 0.36);
    color: var(--dnb-accent);
  }
  .dnb-pill-accent {
    background: rgba(37, 99, 235, 0.11);
    border-color: rgba(37, 99, 235, 0.28);
    color: var(--dnb-accent);
  }
  .dnb-pill-danger {
    color: #ff453a;
    border-color: rgba(255, 69, 58, 0.22);
  }
  .dnb-pill-danger:hover {
    background: rgba(255, 69, 58, 0.12);
    color: #ff453a;
    border-color: rgba(255, 69, 58, 0.45);
  }

  /* iOS Circular Status Ring */
  .dnb-ring {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 1.8px solid var(--dnb-text-3);
    background: transparent;
    padding: 0;
    flex-shrink: 0;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    transition: all 0.18s cubic-bezier(0.32, 0.72, 0, 1);
  }
  .dnb-ring:hover { transform: scale(1.08); }
  .dnb-ring:active { transform: scale(0.9); }

  /* iOS Toggle Switch */
  .dnb-switch {
    position: relative;
    width: 38px;
    height: 22px;
    border-radius: 99px;
    border: none;
    padding: 2px;
    background: var(--dnb-fill);
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.22s cubic-bezier(0.32, 0.72, 0, 1);
  }
  .dnb-switch[data-on="1"] {
    background: #30d158;
  }
  .dnb-switch[data-on="1"][data-tone="red"] {
    background: #ef4444;
    box-shadow: 0 0 8px rgba(239, 68, 68, 0.35);
  }
  .dnb-switch-thumb {
    display: block;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0,0,0,0.28);
    transition: transform 0.22s cubic-bezier(0.32, 0.72, 0, 1);
  }
  .dnb-switch[data-on="1"] .dnb-switch-thumb {
    transform: translateX(16px);
  }
  .dnb-switch:disabled,
  .dnb-switch[data-disabled="1"] {
    opacity: 0.45;
    cursor: not-allowed;
    pointer-events: none;
  }

  /* Progress bar */
  .dnb-progress {
    height: 5px;
    border-radius: 999px;
    background: var(--dnb-fill);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.14);
    overflow: hidden;
    display: flex;
  }

  /* Bottom Sheet Inspector */
  .dnb-sheet {
    background: var(--dnb-elevated);
    border: 1px solid var(--dnb-border-strong);
    border-radius: 16px;
    padding: 10px 12px 12px;
    margin-top: 10px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
    animation: dnb-enter 0.2s cubic-bezier(0.32, 0.72, 0, 1);
  }
  .dnb-sheet-handle {
    width: 32px;
    height: 3.5px;
    border-radius: 99px;
    background: var(--dnb-border-strong);
    margin: 0 auto 8px;
  }

  /* Context Menu / Popover */
  .dnb-menu {
    position: fixed;
    z-index: 9999;
    min-width: 152px;
    padding: 5px;
    border-radius: 12px;
    background-color: #1f2024;
    background-image: linear-gradient(var(--dnb-popover), var(--dnb-popover));
    border: 1px solid var(--dnb-border-strong, rgba(128,128,136,0.28));
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.32);
    backdrop-filter: blur(20px);
    color: var(--dnb-text, #f2f2f7);
    font-size: 12px;
    animation: dnb-enter 0.14s ease-out;
  }
  .dnb-menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.12s ease;
  }
  .dnb-menu-item:hover {
    background: var(--dnb-fill, rgba(128,128,136,0.18));
  }

  /* Toast Notice */
  .dnb-toast {
    position: absolute;
    bottom: 82px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 90;
    padding: 6px 14px;
    border-radius: 99px;
    background: var(--dnb-popover);
    border: 1px solid var(--dnb-border-strong);
    box-shadow: 0 6px 20px rgba(0,0,0,0.24);
    font-size: 11.5px;
    font-weight: 500;
    color: var(--dnb-text);
    pointer-events: none;
    white-space: nowrap;
    max-width: calc(100% - 32px);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Header Compact Pills (Model Picker & Auto-Pilot) */
  .dnb-head-pill {
    height: 24px;
    padding: 0 8px;
    border-radius: 99px;
    border: 1px solid var(--dnb-border);
    background: var(--dnb-card);
    color: var(--dnb-text-2);
    font: inherit;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 3.5px;
    white-space: nowrap;
    transition: all 0.16s ease;
  }
  .dnb-head-pill:hover {
    background: var(--dnb-card-hover);
    color: var(--dnb-text);
    border-color: var(--dnb-border-strong);
  }
  .dnb-head-pill[data-pilot="1"] {
    background: rgba(48, 209, 88, 0.14);
    border-color: rgba(48, 209, 88, 0.42);
    color: #30d158;
  }

  /* Attention-First Collapsible Accordion Cards & Unified Design System */
  .dnb-acc-card {
    margin-top: 8px;
    border-radius: 12px;
    border: 1px solid var(--dnb-border);
    background: var(--dnb-card);
    overflow: visible;
    transition: border-color 0.15s ease;
  }
  .dnb-view > .dnb-acc-card:first-child {
    margin-top: 0;
  }
  .dnb-acc-card:hover {
    border-color: var(--dnb-border-strong);
  }
  .dnb-acc-card.dnb-wall-box {
    margin-top: 8px;
    margin-bottom: 0;
    border-radius: 12px;
    border: 1px solid var(--dnb-border);
    border-left: 3.5px solid rgba(239, 68, 68, 0.78);
    background: var(--dnb-card);
  }
  .dnb-fleet-card,
  .dnb-acc-card.dnb-fleet-card {
    border-left: 3.5px solid rgba(34, 211, 238, 0.85);
    background: linear-gradient(135deg, rgba(6, 182, 212, 0.08) 0%, var(--dnb-card) 44%);
  }
  .dnb-acc-card.dnb-fleet-card > .dnb-acc-head {
    background: linear-gradient(90deg, rgba(6, 182, 212, 0.12), rgba(6, 182, 212, 0.02) 55%, transparent);
  }
  .dnb-acc-card.dnb-obj-card {
    border-left: 3.5px solid rgba(59, 130, 246, 0.88);
    background: linear-gradient(135deg, rgba(59, 130, 246, 0.09) 0%, var(--dnb-card) 46%);
  }
  .dnb-acc-card.dnb-obj-card > .dnb-acc-head {
    background: linear-gradient(90deg, rgba(59, 130, 246, 0.12), rgba(59, 130, 246, 0.025) 58%, transparent);
  }
  .dnb-acc-card.dnb-topo-card {
    border-left: 3.5px solid rgba(16, 185, 129, 0.88);
    background: linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, var(--dnb-card) 44%);
  }
  .dnb-acc-card.dnb-topo-card > .dnb-acc-head {
    background: linear-gradient(90deg, rgba(16, 185, 129, 0.12), rgba(16, 185, 129, 0.02) 55%, transparent);
  }
  .dnb-acc-card.dnb-board-card {
    border-left: 3.5px solid rgba(139, 92, 246, 0.88);
    background: linear-gradient(135deg, rgba(139, 92, 246, 0.08) 0%, var(--dnb-card) 40%);
  }
  .dnb-acc-card.dnb-board-card > .dnb-acc-head {
    background: linear-gradient(90deg, rgba(139, 92, 246, 0.12), rgba(139, 92, 246, 0.02) 55%, transparent);
  }
  .dnb-acc-card.dnb-handoff-card {
    border-left: 3.5px solid rgba(245, 158, 11, 0.88);
    background: linear-gradient(135deg, rgba(245, 158, 11, 0.08) 0%, var(--dnb-card) 44%);
  }
  .dnb-acc-card.dnb-handoff-card > .dnb-acc-head {
    background: linear-gradient(90deg, rgba(245, 158, 11, 0.12), rgba(245, 158, 11, 0.02) 55%, transparent);
  }
  /* Unified 8-Tone Soft Accent Card System (Image 4 visual family across all tabs) */
  .dnb-acc-card[data-tone="cyan"] {
    border-left: 3.5px solid rgba(34, 211, 238, 0.84);
    background: linear-gradient(135deg, rgba(6, 182, 212, 0.075) 0%, var(--dnb-card) 44%);
  }
  .dnb-acc-card[data-tone="cyan"] > .dnb-acc-head {
    background: linear-gradient(90deg, rgba(6, 182, 212, 0.11), rgba(6, 182, 212, 0.02) 55%, transparent);
  }
  .dnb-acc-card[data-tone="blue"] {
    border-left: 3.5px solid rgba(59, 130, 246, 0.86);
    background: linear-gradient(135deg, rgba(59, 130, 246, 0.08) 0%, var(--dnb-card) 44%);
  }
  .dnb-acc-card[data-tone="blue"] > .dnb-acc-head {
    background: linear-gradient(90deg, rgba(59, 130, 246, 0.11), rgba(59, 130, 246, 0.02) 56%, transparent);
  }
  .dnb-acc-card[data-tone="indigo"] {
    border-left: 3.5px solid rgba(99, 102, 241, 0.86);
    background: linear-gradient(135deg, rgba(99, 102, 241, 0.075) 0%, var(--dnb-card) 44%);
  }
  .dnb-acc-card[data-tone="indigo"] > .dnb-acc-head {
    background: linear-gradient(90deg, rgba(99, 102, 241, 0.11), rgba(99, 102, 241, 0.02) 55%, transparent);
  }
  .dnb-acc-card[data-tone="emerald"] {
    border-left: 3.5px solid rgba(16, 185, 129, 0.86);
    background: linear-gradient(135deg, rgba(16, 185, 129, 0.075) 0%, var(--dnb-card) 44%);
  }
  .dnb-acc-card[data-tone="emerald"] > .dnb-acc-head {
    background: linear-gradient(90deg, rgba(16, 185, 129, 0.11), rgba(16, 185, 129, 0.02) 55%, transparent);
  }
  .dnb-acc-card[data-tone="violet"] {
    border-left: 3.5px solid rgba(139, 92, 246, 0.86);
    background: linear-gradient(135deg, rgba(139, 92, 246, 0.075) 0%, var(--dnb-card) 44%);
  }
  .dnb-acc-card[data-tone="violet"] > .dnb-acc-head {
    background: linear-gradient(90deg, rgba(139, 92, 246, 0.11), rgba(139, 92, 246, 0.02) 55%, transparent);
  }
  .dnb-acc-card[data-tone="amber"] {
    border-left: 3.5px solid rgba(245, 158, 11, 0.86);
    background: linear-gradient(135deg, rgba(245, 158, 11, 0.075) 0%, var(--dnb-card) 44%);
  }
  .dnb-acc-card[data-tone="amber"] > .dnb-acc-head {
    background: linear-gradient(90deg, rgba(245, 158, 11, 0.11), rgba(245, 158, 11, 0.02) 55%, transparent);
  }
  .dnb-acc-card[data-tone="rose"] {
    border-left: 3.5px solid rgba(244, 63, 94, 0.86);
    background: linear-gradient(135deg, rgba(244, 63, 94, 0.075) 0%, var(--dnb-card) 44%);
  }
  .dnb-acc-card[data-tone="rose"] > .dnb-acc-head {
    background: linear-gradient(90deg, rgba(244, 63, 94, 0.11), rgba(244, 63, 94, 0.02) 55%, transparent);
  }
  .dnb-acc-card[data-tone="slate"] {
    border-left: 3.5px solid rgba(148, 163, 184, 0.65);
    background: linear-gradient(135deg, rgba(148, 163, 184, 0.065) 0%, var(--dnb-card) 44%);
  }
  .dnb-acc-card[data-tone="slate"] > .dnb-acc-head {
    background: linear-gradient(90deg, rgba(148, 163, 184, 0.09), rgba(148, 163, 184, 0.015) 55%, transparent);
  }
  html[data-ds-theme-source="light"] .dnb-acc-card[data-tone="cyan"] {
    background: linear-gradient(135deg, #ecfeff 0%, #ffffff 42%);
    border-left-color: #0891b2;
  }
  html[data-ds-theme-source="light"] .dnb-acc-card[data-tone="cyan"] > .dnb-acc-head {
    background: linear-gradient(90deg, rgba(6, 182, 212, 0.13), rgba(6, 182, 212, 0.02) 55%, transparent);
  }
  html[data-ds-theme-source="light"] .dnb-acc-card[data-tone="blue"] {
    background: linear-gradient(135deg, #eff6ff 0%, #ffffff 44%);
    border-left-color: #2563eb;
  }
  html[data-ds-theme-source="light"] .dnb-acc-card[data-tone="blue"] > .dnb-acc-head {
    background: linear-gradient(90deg, rgba(37, 99, 235, 0.12), rgba(37, 99, 235, 0.02) 56%, transparent);
  }
  html[data-ds-theme-source="light"] .dnb-acc-card[data-tone="indigo"] {
    background: linear-gradient(135deg, #eef2ff 0%, #ffffff 42%);
    border-left-color: #4f46e5;
  }
  html[data-ds-theme-source="light"] .dnb-acc-card[data-tone="indigo"] > .dnb-acc-head {
    background: linear-gradient(90deg, rgba(79, 70, 229, 0.12), rgba(79, 70, 229, 0.02) 55%, transparent);
  }
  html[data-ds-theme-source="light"] .dnb-acc-card[data-tone="emerald"] {
    background: linear-gradient(135deg, #ecfdf5 0%, #ffffff 42%);
    border-left-color: #059669;
  }
  html[data-ds-theme-source="light"] .dnb-acc-card[data-tone="emerald"] > .dnb-acc-head {
    background: linear-gradient(90deg, rgba(16, 185, 129, 0.12), rgba(16, 185, 129, 0.02) 55%, transparent);
  }
  html[data-ds-theme-source="light"] .dnb-acc-card[data-tone="violet"] {
    background: linear-gradient(135deg, #f5f3ff 0%, #ffffff 40%);
    border-left-color: #7c3aed;
  }
  html[data-ds-theme-source="light"] .dnb-acc-card[data-tone="violet"] > .dnb-acc-head {
    background: linear-gradient(90deg, rgba(124, 58, 237, 0.12), rgba(124, 58, 237, 0.02) 55%, transparent);
  }
  html[data-ds-theme-source="light"] .dnb-acc-card[data-tone="amber"] {
    background: linear-gradient(135deg, #fffbeb 0%, #ffffff 42%);
    border-left-color: #d97706;
  }
  html[data-ds-theme-source="light"] .dnb-acc-card[data-tone="amber"] > .dnb-acc-head {
    background: linear-gradient(90deg, rgba(245, 158, 11, 0.13), rgba(245, 158, 11, 0.02) 55%, transparent);
  }
  html[data-ds-theme-source="light"] .dnb-acc-card[data-tone="rose"] {
    background: linear-gradient(135deg, #fff1f2 0%, #ffffff 42%);
    border-left-color: #e11d48;
  }
  html[data-ds-theme-source="light"] .dnb-acc-card[data-tone="rose"] > .dnb-acc-head {
    background: linear-gradient(90deg, rgba(225, 29, 72, 0.12), rgba(225, 29, 72, 0.02) 55%, transparent);
  }
  html[data-ds-theme-source="light"] .dnb-acc-card[data-tone="slate"] {
    background: linear-gradient(135deg, #f1f5f9 0%, #ffffff 42%);
    border-left-color: #64748b;
  }
  html[data-ds-theme-source="light"] .dnb-acc-card[data-tone="slate"] > .dnb-acc-head {
    background: linear-gradient(90deg, rgba(100, 116, 139, 0.12), rgba(100, 116, 139, 0.02) 55%, transparent);
  }
  .dnb-acc-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 36px;
    padding: 7px 11px;
    border-radius: 11px;
    cursor: pointer;
    user-select: none;
    transition: background-color 0.14s ease;
  }
  .dnb-acc-card[data-open="1"] > .dnb-acc-head {
    border-radius: 11px 11px 0 0;
  }
  .dnb-acc-head:hover {
    background: var(--dnb-card-hover);
  }
  .dnb-acc-title-wrap {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1 1 auto;
    min-width: 0;
    flex-wrap: wrap;
  }
  .dnb-acc-chevron {
    color: var(--dnb-text-3);
    flex-shrink: 0;
    transform: rotate(0deg);
    transition: transform 0.16s ease, color 0.14s ease;
  }
  .dnb-acc-card[data-open="1"] > .dnb-acc-head .dnb-acc-chevron {
    transform: rotate(90deg);
    color: var(--dnb-text-2);
  }
  .dnb-acc-title {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--dnb-text);
    white-space: nowrap;
  }
  .dnb-acc-preview {
    font-size: 11.5px;
    color: var(--dnb-text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    flex: 1;
  }
  .dnb-acc-card.dnb-obj-card .dnb-acc-preview {
    color: var(--dnb-text);
    opacity: 0.9;
  }
  .dnb-acc-count {
    font-size: 10.5px;
    color: var(--dnb-text-2);
    padding: 1px 6px;
    border-radius: 99px;
    background: var(--dnb-fill);
    white-space: nowrap;
  }
  .dnb-acc-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 99px;
    background: var(--dnb-fill);
    color: var(--dnb-text-2);
    white-space: nowrap;
  }
  .dnb-acc-badge[data-tone="amber"] {
    background: rgba(245, 158, 11, 0.16);
    color: #fbbf24;
  }
  .dnb-acc-badge[data-tone="accent"] {
    background: rgba(59, 130, 246, 0.16);
    color: #60a5fa;
  }
  .dnb-acc-ops {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-shrink: 0;
  }
  .dnb-acc-ops .dnb-seg .dnb-seg-btn {
    flex: 0 0 auto;
  }
  .dnb-acc-pull-hint {
    font-size: 10.5px;
    font-weight: 500;
    color: var(--dnb-text-3);
    padding: 1px 7px;
    border-radius: 99px;
    background: var(--dnb-fill);
    white-space: nowrap;
    cursor: pointer;
  }
  .dnb-acc-head:hover .dnb-acc-pull-hint {
    color: var(--dnb-text-2);
  }
  .dnb-acc-body {
    border-top: 1px solid var(--dnb-border);
    border-radius: 0 0 11px 11px;
    padding: 8px 10px 10px;
  }
  .dnb-acc-body > .dnb-cell:first-child {
    border-top: none;
  }
  .dnb-acc-body > .dnb-qa-stream > .dnb-qa-turn-box:first-child {
    margin-top: 2px;
  }

  .dnb-session-optin-wrap {
    padding: 0 12px 8px;
    flex-shrink: 0;
  }
  .dnb-session-optin-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
    padding: 8px 11px;
    border-radius: 10px;
    border: 1px solid rgba(56, 189, 248, 0.28);
    background: linear-gradient(135deg, rgba(56, 189, 248, 0.11), rgba(37, 99, 235, 0.06));
    color: var(--dnb-text);
    font-size: 11.5px;
    line-height: 1.45;
  }
  .dnb-session-optin-text {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    flex: 1 1 220px;
    color: var(--dnb-text-2);
  }
  .dnb-session-optin-dot {
    width: 6px;
    height: 6px;
    border-radius: 99px;
    background: #38bdf8;
    flex-shrink: 0;
    opacity: 0.9;
  }
  .dnb-session-optin-btn {
    flex-shrink: 0;
    height: 25px;
    padding: 0 10px;
    font-size: 11.5px;
    border-radius: 7px;
  }
  html[data-dnb-theme="light"] .dnb-session-optin-banner,
  html[data-ds-theme-source="light"] .dnb-session-optin-banner,
  html[data-ds-theme="light"] .dnb-session-optin-banner {
    border-color: rgba(2, 132, 199, 0.28);
    background: linear-gradient(135deg, rgba(2, 132, 199, 0.08), rgba(37, 99, 235, 0.04));
  }
  html[data-dnb-theme="light"] .dnb-session-optin-dot,
  html[data-ds-theme-source="light"] .dnb-session-optin-dot,
  html[data-ds-theme="light"] .dnb-session-optin-dot {
    background: #0284c7;
  }

`
