/**
 * src/client/styles/extmem.js — 「记忆」高定星图工作台样式（对标 LivingMemory 极简双栏/微网格风格）
 *
 * 【设计要点】
 *   1. 基于 CSS Container Query (`@container`) 自适应：宽屏呈现左导航右大画布经典工作台，窄侧栏自动折叠为顶部细胶囊条；
 *   2. 极简 4 格左竖色条 KPI 概览带（可一键收起让星图全屏沉浸）；
 *   3. 44px 工程微网格沉浸星图画布，内置顶部居中浮窗搜索条、左下角分类图例、右下角极简微控条与右侧滑出式星辰详情浮层；
 *   4. 完整自适应 DSH 深色与浅色宿主，以及全部自定义 DIY 皮肤令牌。
 *
 * 【边界约定】
 *   - 全部样式类名严格使用 `.dnb-extmem-*` 前缀，严禁出现旧版私有脑禁用词。
 */

export const CSS_EXTMEM = `
  /* === Root Workspace & Responsive 2-Column LivingMemory Shell === */
  .dnb-extmem-root {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
  }
  .dnb-extmem-shell {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
    width: 100%;
    min-width: 0;
  }
  @container (min-width: 640px) {
    .dnb-extmem-shell {
      display: grid;
      grid-template-columns: 158px minmax(0, 1fr);
      gap: 12px;
      align-items: start;
    }
    .dnb-extmem-root[data-outer-rail="1"] .dnb-extmem-shell {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      width: 100%;
      gap: 10px;
    }
    .dnb-extmem-root[data-outer-rail="1"] .dnb-extmem-rail {
      display: none;
    }
  }

  /* === Left Workspace Rail (Sidebar in Wide Mode, Slim Strip in Narrow Mode) === */
  .dnb-extmem-rail {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px;
    border-radius: var(--dnb-radius-card, 14px);
    border: 1px solid var(--dnb-border);
    background: var(--dnb-card);
    box-shadow: var(--dnb-skin-shadow);
  }
  .dnb-extmem-rail-brand {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 2px 4px 6px;
    border-bottom: 1px solid var(--dnb-border);
  }
  .dnb-extmem-rail-brand-left {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }
  .dnb-extmem-rail-logo {
    width: 24px;
    height: 24px;
    border-radius: 7px;
    background: var(--dnb-accent-soft, rgba(139, 124, 246, 0.16));
    border: 1px solid color-mix(in srgb, var(--dnb-accent, #8b7cf6) 38%, transparent);
    color: var(--dnb-accent, #9f8eff);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .dnb-extmem-rail-name {
    font-size: 12.5px;
    font-weight: 650;
    color: var(--dnb-text);
    letter-spacing: -0.01em;
    white-space: nowrap;
  }
  .dnb-extmem-rail-nav {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
  }
  .dnb-extmem-rail-btn {
    flex: 1 1 auto;
    appearance: none;
    border: 1px solid transparent;
    background: transparent;
    color: var(--dnb-text-2);
    border-radius: 9px;
    padding: 6px 5px;
    font: inherit;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    min-width: 0;
    transition: background 0.14s ease, border-color 0.14s ease, color 0.14s ease;
  }
  .dnb-extmem-rail-btn:hover {
    background: var(--dnb-fill);
    color: var(--dnb-text);
  }
  .dnb-extmem-rail-btn[data-active="1"] {
    background: var(--dnb-accent-soft, rgba(108, 92, 231, 0.16));
    border-color: color-mix(in srgb, var(--dnb-accent, #8b7cf6) 42%, transparent);
    color: var(--dnb-text);
    font-weight: 600;
  }
  .dnb-extmem-rail-count {
    font-size: 10px;
    color: var(--dnb-text-3);
    font-variant-numeric: tabular-nums;
  }
  .dnb-extmem-rail-btn[data-active="1"] .dnb-extmem-rail-count {
    color: var(--dnb-accent);
  }
  .dnb-extmem-rail-foot {
    display: none;
  }
  @container (max-width: 450px) {
    .dnb-extmem-rail-count { display: none; }
    .dnb-extmem-rail-btn { padding: 6px 3px; font-size: 10.5px; gap: 3px; }
  }
  @container (min-width: 640px) {
    .dnb-extmem-rail {
      position: sticky;
      top: 0;
      padding: 10px 8px;
      gap: 10px;
    }
    .dnb-extmem-rail-brand-switch {
      display: none;
    }
    .dnb-extmem-rail-nav {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .dnb-extmem-rail-btn {
      justify-content: space-between;
      padding: 7px 9px;
      font-size: 12px;
    }
    .dnb-extmem-rail-btn-label {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dnb-extmem-rail-foot {
      display: flex;
      flex-direction: column;
      gap: 7px;
      padding: 8px 4px 2px;
      border-top: 1px solid var(--dnb-border);
    }
  }

  /* === Main Canvas Stage + Top Header + 4-Card KPI Strip (.dnb-extmem-hero) === */
  .dnb-extmem-main {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
  }
  .dnb-extmem-hero {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .dnb-extmem-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
    padding: 2px 2px 0;
  }
  .dnb-extmem-topbar-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .dnb-extmem-title {
    font-size: 14.5px;
    font-weight: 650;
    color: var(--dnb-text);
    letter-spacing: -0.01em;
  }
  .dnb-extmem-status-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid var(--dnb-border);
    background: var(--dnb-surface-sub);
    font-size: 10.5px;
    color: var(--dnb-text-3);
  }
  .dnb-extmem-status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--dnb-text-3);
    flex-shrink: 0;
  }
  .dnb-extmem-status-pill[data-live="1"] .dnb-extmem-status-dot {
    background: var(--dnb-sage, #30d158);
    box-shadow: 0 0 6px var(--dnb-sage, #30d158);
  }
  .dnb-extmem-status-pill[data-live="1"] {
    color: var(--dnb-text-2);
  }
  .dnb-extmem-topbar-actions {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-wrap: wrap;
  }
  .dnb-extmem-tool-btn {
    height: 26px;
    padding: 0 9px;
    border-radius: 8px;
    border: 1px solid var(--dnb-border);
    background: var(--dnb-card);
    color: var(--dnb-text-2);
    font: inherit;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
    transition: border-color 0.14s ease, background 0.14s ease, color 0.14s ease;
  }
  .dnb-extmem-tool-btn:hover {
    border-color: var(--dnb-border-strong);
    background: var(--dnb-card-hover);
    color: var(--dnb-text);
  }
  .dnb-extmem-tool-btn[data-active="1"] {
    border-color: var(--dnb-accent);
    background: var(--dnb-accent-soft);
    color: var(--dnb-accent);
    font-weight: 600;
  }

  /* 4-Card Minimal Accent-Stripe KPI Row */
  .dnb-extmem-kpi-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
  }
  @container (max-width: 440px) {
    .dnb-extmem-kpi-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  .dnb-extmem-kpi-card {
    appearance: none;
    text-align: left;
    cursor: pointer;
    border-radius: 10px;
    border: 1px solid var(--dnb-border);
    background: var(--dnb-card);
    padding: 8px 11px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    transition: border-color 0.15s ease, background 0.15s ease, transform 0.12s ease;
  }
  .dnb-extmem-kpi-card:hover {
    border-color: var(--dnb-border-strong);
    background: var(--dnb-card-hover);
    transform: translateY(-1px);
  }
  .dnb-extmem-kpi-inner {
    padding-left: 9px;
    border-left: 2.5px solid var(--kpi-accent, var(--dnb-accent));
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .dnb-extmem-kpi-label {
    font-size: 10.5px;
    color: var(--dnb-text-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dnb-extmem-kpi-val {
    font-size: 19px;
    font-weight: 650;
    line-height: 1.15;
    color: var(--dnb-text);
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
  }
  .dnb-extmem-kpi-val-wrap {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }
  .dnb-extmem-kpi-sub {
    font-size: 10px;
    color: var(--dnb-text-3);
  }

  /* Kept for Vitality Ring component */
  .dnb-extmem-ring-wrap {
    position: relative;
    width: 42px;
    height: 42px;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .dnb-extmem-ring-val {
    position: absolute;
    font-size: 10px;
    font-weight: 650;
    color: var(--dnb-text);
    font-variant-numeric: tabular-nums;
  }

  /* === Quick Capture Drawer === */
  .dnb-extmem-capture {
    border-radius: var(--dnb-radius-card, 13px);
    border: 1px solid var(--dnb-border-strong);
    background: var(--dnb-card);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .dnb-extmem-cat-pills {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-wrap: wrap;
  }
  .dnb-extmem-cat-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 9px;
    border-radius: 999px;
    border: 1px solid var(--dnb-border);
    background: var(--dnb-surface-sub);
    color: var(--dnb-text-2);
    font: inherit;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: border-color 0.14s ease, background 0.14s ease, color 0.14s ease;
  }
  .dnb-extmem-cat-pill:hover {
    border-color: var(--dnb-border-strong);
    color: var(--dnb-text);
  }
  .dnb-extmem-cat-pill[data-active="1"] {
    border-color: var(--cat-color, var(--dnb-accent));
    background: color-mix(in srgb, var(--cat-color, var(--dnb-accent)) 14%, transparent);
    color: var(--dnb-text);
    font-weight: 600;
  }
  .dnb-extmem-cat-dot {
    width: 6.5px;
    height: 6.5px;
    border-radius: 50%;
    background: var(--cat-color, var(--dnb-accent));
    flex-shrink: 0;
  }

  /* === LivingMemory-Style Architectural Micro-Grid Starfield (.dnb-extmem-sky) === */
  .dnb-extmem-sky {
    position: relative;
    border-radius: var(--dnb-radius-card, 14px);
    border: 1px solid var(--dnb-border-strong);
    background-color: #0b0f17;
    background-image:
      linear-gradient(to right, rgba(148, 163, 184, 0.055) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(148, 163, 184, 0.055) 1px, transparent 1px);
    background-size: 44px 44px;
    overflow: hidden;
    box-shadow: var(--dnb-skin-shadow);
  }
  .dnb-extmem-sky-stage {
    position: relative;
    width: 100%;
    height: 368px;
    user-select: none;
  }
  @container (min-width: 640px) {
    .dnb-extmem-sky-stage {
      height: clamp(420px, 56vh, 530px);
    }
  }
  .dnb-extmem-sky-svg,
  .dnb-extmem-sky-canvas3d {
    width: 100%;
    height: 100%;
    display: block;
    cursor: grab;
  }
  .dnb-extmem-sky-svg[data-dragging="1"],
  .dnb-extmem-sky-canvas3d[data-dragging="1"] {
    cursor: grabbing;
  }

  /* Floating Glass Top-Center Search Capsule */
  .dnb-extmem-float-search {
    position: absolute;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 8;
    display: flex;
    align-items: center;
    gap: 5px;
    width: min(calc(100% - 24px), 348px);
    padding: 3px 3px 3px 10px;
    border-radius: 10px;
    background: rgba(15, 21, 34, 0.78);
    border: 1px solid rgba(148, 163, 184, 0.22);
    backdrop-filter: blur(12px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.36);
  }
  .dnb-extmem-float-search-input {
    flex: 1 1 auto;
    min-width: 0;
    height: 26px;
    border: none;
    background: transparent;
    color: #f1f5f9;
    font: inherit;
    font-size: 11.5px;
    outline: none;
  }
  .dnb-extmem-float-search-input::placeholder {
    color: rgba(148, 163, 184, 0.65);
  }
  .dnb-extmem-float-search-btn {
    height: 26px;
    padding: 0 10px;
    border-radius: 7px;
    border: none;
    background: var(--dnb-primary-bg, #2563eb);
    color: var(--dnb-primary-fg, #ffffff);
    font: inherit;
    font-size: 11px;
    font-weight: 550;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    transition: background 0.14s ease;
  }
  .dnb-extmem-float-search-btn:hover {
    background: var(--dnb-primary-bg-hover, #1d4ed8);
  }

  /* Hover Lightweight Tooltip */
  .dnb-extmem-sky-tooltip {
    position: absolute;
    left: 12px;
    top: 52px;
    z-index: 7;
    max-width: min(82%, 300px);
    padding: 7px 10px;
    border-radius: 9px;
    background: rgba(14, 20, 32, 0.90);
    border: 1px solid rgba(148, 163, 184, 0.24);
    backdrop-filter: blur(10px);
    color: #f8fafc;
    font-size: 11px;
    line-height: 1.45;
    pointer-events: none;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.36);
  }

  /* Bottom-Left Floating Category Legend Pill */
  .dnb-extmem-float-legend {
    position: absolute;
    left: 12px;
    bottom: 12px;
    z-index: 8;
    max-width: calc(100% - 140px);
    display: flex;
    align-items: center;
    gap: 3px;
    flex-wrap: wrap;
    padding: 4px 7px;
    border-radius: 9px;
    background: rgba(15, 21, 34, 0.76);
    border: 1px solid rgba(148, 163, 184, 0.20);
    backdrop-filter: blur(10px);
  }
  .dnb-extmem-legend-chip {
    appearance: none;
    border: 1px solid transparent;
    background: transparent;
    color: rgba(226, 232, 240, 0.80);
    border-radius: 6px;
    padding: 2px 6px;
    font: inherit;
    font-size: 10px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    transition: background 0.14s ease, border-color 0.14s ease, color 0.14s ease;
  }
  .dnb-extmem-legend-chip:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #ffffff;
  }
  .dnb-extmem-legend-chip[data-active="1"] {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.26);
    color: #ffffff;
    font-weight: 600;
  }

  /* Bottom-Right Floating Zoom / Link / Timeline Controls */
  .dnb-extmem-float-controls {
    position: absolute;
    right: 12px;
    bottom: 12px;
    z-index: 8;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
  }
  .dnb-extmem-ctrl-bar {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 3px;
    border-radius: 9px;
    background: rgba(15, 21, 34, 0.78);
    border: 1px solid rgba(148, 163, 184, 0.20);
    backdrop-filter: blur(10px);
  }
  .dnb-extmem-ctrl-btn {
    height: 24px;
    min-width: 24px;
    padding: 0 7px;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: rgba(226, 232, 240, 0.82);
    font: inherit;
    font-size: 10.5px;
    font-weight: 500;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
    transition: background 0.13s ease, color 0.13s ease;
  }
  .dnb-extmem-ctrl-btn:hover {
    background: rgba(255, 255, 255, 0.10);
    color: #ffffff;
  }
  .dnb-extmem-ctrl-btn[data-active="1"] {
    background: color-mix(in srgb, var(--dnb-accent, #8b7cf6) 26%, transparent);
    color: #ffffff;
    font-weight: 600;
  }
  .dnb-extmem-timeline-pop {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 5px 9px;
    border-radius: 9px;
    background: rgba(15, 21, 34, 0.86);
    border: 1px solid rgba(148, 163, 184, 0.22);
    backdrop-filter: blur(10px);
    font-size: 10.5px;
    color: #e2e8f0;
  }
  .dnb-extmem-timeline-slider {
    width: 112px;
    accent-color: var(--dnb-accent, #60a5fa);
    cursor: pointer;
  }

  /* Empty State Frosted Center Prompt */
  .dnb-extmem-empty-float {
    position: absolute;
    left: 50%;
    top: 52%;
    transform: translate(-50%, -50%);
    z-index: 6;
    width: min(calc(100% - 36px), 410px);
    padding: 13px 15px;
    border-radius: 12px;
    background: rgba(14, 20, 34, 0.84);
    border: 1px solid rgba(148, 163, 184, 0.22);
    backdrop-filter: blur(12px);
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 8px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.38);
  }

  /* Floating Right Star Inspector Drawer inside Sky Container */
  .dnb-extmem-inspector {
    border-top: 1px solid var(--dnb-border);
    background: var(--dnb-card);
    padding: 11px 13px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    animation: dnb-extmem-pop 0.16s ease-out;
  }
  @container (min-width: 640px) {
    .dnb-extmem-inspector-float {
      position: absolute;
      top: 52px;
      right: 12px;
      bottom: 48px;
      width: 274px;
      z-index: 9;
      border: 1px solid rgba(148, 163, 184, 0.26);
      border-radius: 11px;
      background: rgba(15, 21, 34, 0.88);
      backdrop-filter: blur(14px);
      overflow-y: auto;
      box-shadow: 0 12px 34px rgba(0, 0, 0, 0.44);
    }
  }
  @keyframes dnb-extmem-pop {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .dnb-extmem-vitalbar {
    height: 4px;
    border-radius: 999px;
    background: var(--dnb-fill);
    overflow: hidden;
  }
  .dnb-extmem-vitalfill {
    height: 100%;
    border-radius: 999px;
    transition: width 0.25s ease;
  }

  /* === Clean Notebook Cards === */
  .dnb-extmem-card {
    border-radius: calc(var(--dnb-radius-card, 13px) - 2px);
    border: 1px solid var(--dnb-border);
    background: var(--dnb-card);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 7px;
    transition: border-color 0.15s ease, background 0.15s ease;
  }
  .dnb-extmem-card:hover {
    border-color: var(--dnb-border-strong);
    background: var(--dnb-card-hover);
  }
  .dnb-extmem-card[data-pinned="1"] {
    border-color: color-mix(in srgb, var(--dnb-amber, #f3be6d) 44%, var(--dnb-border));
  }

  /* === Curve & X-Ray Containers === */
  .dnb-extmem-curve-box,
  .dnb-extmem-xray-box {
    border-radius: var(--dnb-radius-card, 14px);
    border: 1px solid var(--dnb-border);
    background: var(--dnb-card);
    box-shadow: var(--dnb-skin-shadow);
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 9px;
  }
  .dnb-extmem-xray-pre {
    margin: 0;
    padding: 10px 12px;
    border-radius: 9px;
    border: 1px solid var(--dnb-border);
    background: var(--dnb-surface-sub);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    line-height: 1.55;
    color: var(--dnb-text-2);
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 220px;
    overflow-y: auto;
  }

  /* === Light Theme Clean Anti-Glare Adaptation === */
  html[data-ds-theme-source="light"] .dnb-extmem-sky {
    background-color: #e5ebf3;
    background-image:
      linear-gradient(to right, rgba(15, 23, 42, 0.075) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(15, 23, 42, 0.075) 1px, transparent 1px);
    background-size: 44px 44px;
    border-color: #b8c5d6;
  }
  html[data-ds-theme-source="light"] .dnb-extmem-float-search,
  html[data-ds-theme-source="light"] .dnb-extmem-float-legend,
  html[data-ds-theme-source="light"] .dnb-extmem-ctrl-bar,
  html[data-ds-theme-source="light"] .dnb-extmem-timeline-pop,
  html[data-ds-theme-source="light"] .dnb-extmem-empty-float {
    background: rgba(243, 246, 251, 0.92);
    border-color: rgba(71, 85, 105, 0.28);
    color: #0f172a;
    box-shadow: 0 8px 24px rgba(15, 23, 42, 0.11);
  }
  html[data-ds-theme-source="light"] .dnb-extmem-float-search-input {
    color: #0f172a;
  }
  html[data-ds-theme-source="light"] .dnb-extmem-float-search-input::placeholder {
    color: #52627a;
  }
  html[data-ds-theme-source="light"] .dnb-extmem-legend-chip,
  html[data-ds-theme-source="light"] .dnb-extmem-ctrl-btn {
    color: #334155;
  }
  html[data-ds-theme-source="light"] .dnb-extmem-legend-chip:hover,
  html[data-ds-theme-source="light"] .dnb-extmem-ctrl-btn:hover {
    background: rgba(15, 23, 42, 0.08);
    color: #0f172a;
  }
  html[data-ds-theme-source="light"] .dnb-extmem-legend-chip[data-active="1"],
  html[data-ds-theme-source="light"] .dnb-extmem-ctrl-btn[data-active="1"] {
    background: var(--dnb-accent-soft);
    border-color: var(--dnb-accent);
    color: var(--dnb-accent);
  }
  html[data-ds-theme-source="light"] .dnb-extmem-sky-tooltip {
    background: rgba(243, 246, 251, 0.96);
    border-color: #b8c5d6;
    color: #0f172a;
    box-shadow: 0 8px 22px rgba(15, 23, 42, 0.13);
  }
  @container (min-width: 640px) {
    html[data-ds-theme-source="light"] .dnb-extmem-inspector-float {
      background: rgba(243, 246, 251, 0.94);
      border-color: #b8c5d6;
      box-shadow: 0 12px 32px rgba(15, 23, 42, 0.14);
    }
  }

  /* === Diary, User Profile & Prompt Studio Cards === */
  .dnb-extmem-studio-head {
    border-radius: var(--dnb-radius-card, 14px);
    border: 1px solid var(--dnb-border);
    background: var(--dnb-card);
    padding: 11px 14px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
  }
  .dnb-extmem-diary-card {
    border-radius: calc(var(--dnb-radius-card, 13px) - 1px);
    border: 1px solid var(--dnb-border);
    background: var(--dnb-card);
    padding: 11px 13px;
    display: flex;
    flex-direction: column;
    gap: 7px;
    transition: border-color 0.14s ease, background 0.14s ease;
  }
  .dnb-extmem-diary-card:hover {
    border-color: var(--dnb-border-strong);
    background: var(--dnb-card-hover);
  }
  .dnb-extmem-diary-highlights {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 6px 9px;
    border-radius: 8px;
    background: var(--dnb-surface-sub);
    border: 1px solid var(--dnb-border);
    font-size: 11px;
    color: var(--dnb-text-2);
  }
  .dnb-extmem-profile-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 9px;
  }
  .dnb-extmem-profile-sec {
    border-radius: calc(var(--dnb-radius-card, 13px) - 1px);
    border: 1px solid var(--dnb-border);
    background: var(--dnb-card);
    padding: 11px 12px;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .dnb-extmem-profile-item {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 7px;
    padding: 6px 8px;
    border-radius: 8px;
    border: 1px solid var(--dnb-border);
    background: var(--dnb-surface-sub);
    font-size: 11.5px;
    line-height: 1.45;
  }
  .dnb-extmem-profile-item[data-locked="1"] {
    border-color: color-mix(in srgb, var(--dnb-amber, #f3be6d) 45%, var(--dnb-border));
  }
  .dnb-extmem-prompt-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 9px;
  }
  .dnb-extmem-prompt-card {
    border-radius: calc(var(--dnb-radius-card, 13px) - 1px);
    border: 1px solid var(--dnb-border);
    background: var(--dnb-card);
    padding: 11px 12px;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .dnb-extmem-prompt-pre {
    margin: 0;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid var(--dnb-border);
    background: var(--dnb-surface-sub);
    font-size: 11px;
    line-height: 1.5;
    color: var(--dnb-text-2);
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 140px;
    overflow-y: auto;
  }
  .dnb-extmem-var-chip {
    display: inline-flex;
    align-items: center;
    padding: 1.5px 6px;
    border-radius: 5px;
    border: 1px solid var(--dnb-border);
    background: var(--dnb-fill);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 10px;
    color: var(--dnb-accent);
  }
`
